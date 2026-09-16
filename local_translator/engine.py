from __future__ import annotations

import logging
import time
import threading
from contextlib import closing
from dataclasses import dataclass
from typing import Any

from .config import Settings
from .errors import LlamaError
from .prompts import build_translation_prompt, parse_translation_input
from .quality import clean_model_output, is_fatal, protect_text, quality_issues
from .runtime import LlamaCppProcessManager


class TranslationRequestError(ValueError):
    pass


class TranslationOutputError(RuntimeError):
    pass


@dataclass
class TranslationResult:
    text: str
    model: str
    issues: list[str]
    prompt: str
    metrics: dict[str, Any] | None = None


class TranslationEngine:
    def __init__(self, settings: Settings, manager: LlamaCppProcessManager | None = None):
        self.settings = settings
        self.manager = manager or LlamaCppProcessManager(settings)
        self.logger = logging.getLogger(__name__)
        self._translation_lock = threading.Lock()

    def _options(self, retry: bool = False) -> dict[str, Any]:
        return {
            "temperature": 0.0 if retry else self.settings.temperature,
            "top_p": self.settings.top_p,
            "top_k": self.settings.top_k,
            "repeat_penalty": self.settings.repetition_penalty,
            "seed": self.settings.seed,
            "num_ctx": self.settings.num_ctx,
            "max_tokens": self.settings.max_output_tokens,
        }

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """Estimate streamed token count without making a second model request."""
        asian_count = sum(
            1
            for char in text
            if (
                0x2E80 <= ord(char) <= 0x9FFF
                or 0xAC00 <= ord(char) <= 0xD7AF
                or 0xF900 <= ord(char) <= 0xFAFF
            )
        )
        other_count = max(0, len(text) - asian_count)
        return max(1, asian_count + round(other_count / 4))

    @staticmethod
    def _metrics(response: dict[str, Any], elapsed_ms: float | None = None) -> dict[str, Any]:
        eval_count = response.get("eval_count")
        eval_duration = response.get("eval_duration")
        tokens_per_second = None
        if isinstance(eval_count, (int, float)) and isinstance(eval_duration, (int, float)) and eval_duration > 0:
            tokens_per_second = round(float(eval_count) / float(eval_duration) * 1_000_000_000, 2)
        elif isinstance(eval_count, (int, float)) and elapsed_ms is not None and elapsed_ms > 0:
            tokens_per_second = round(float(eval_count) / elapsed_ms * 1000, 2)
        metrics: dict[str, Any] = {
            "generated_tokens": eval_count,
            "eval_duration_ns": eval_duration,
            "load_duration_ns": response.get("load_duration"),
            "tokens_per_second": tokens_per_second,
            "done_reason": response.get("done_reason"),
        }
        if elapsed_ms is not None:
            metrics["elapsed_ms"] = round(elapsed_ms, 1)
        return metrics

    def translate(self, body: dict[str, Any]) -> TranslationResult:
        for event in self.translate_stream(body):
            if event["type"] == "complete":
                return TranslationResult(event["translation"], event["model"], event["quality_issues"], "", event["metrics"])
        raise TranslationOutputError("incomplete_stream: 翻译未完成")

    def translate_stream(self, body: dict[str, Any]):
        if not self._translation_lock.acquire(blocking=False):
            raise TranslationRequestError("translation_busy: 模型正在处理另一个翻译任务，请稍后重试")
        try:
            yield from self._translate_document(body)
        finally:
            self._translation_lock.release()

    def _translate_document(self, body: dict[str, Any]):
        from .segments import split_source, token_cost
        try:
            request = parse_translation_input(body, self.settings.default_target_language)
        except ValueError as error:
            raise TranslationRequestError(str(error)) from error
        source = request.source_text
        if len(source) > self.settings.max_input_chars:
            raise TranslationRequestError(f"待翻译文本过长（{len(source)} 字符），当前上限为 {self.settings.max_input_chars}")
        overhead = token_cost(build_translation_prompt(request, "")) + 256
        budget = min(1200, (self.settings.num_ctx - overhead) // 3, self.settings.max_output_tokens // 2)
        if budget < 64:
            raise TranslationRequestError("context_budget: 上下文或输出预算太小，请增加 num_ctx / max_output_tokens")
        queue = [(part, 0) for part in split_source(source, budget)]
        started = time.perf_counter()
        completed_chars = 0
        completed_parts: list[str] = []
        segment_cache: dict[str, dict[str, Any]] = {}
        all_issues: list[str] = []
        generated_tokens = 0
        tokens_known = True
        total_eval_ns = 0
        eval_known = True
        model = self.settings.model_name
        yield {"type": "plan", "total_chunks": len(queue), "total_chars": len(source), "completed_chars": 0, "completed_chunks": 0}
        index = 0
        while index < len(queue):
            part, depth = queue[index]
            prefix = part[:len(part) - len(part.lstrip())]
            suffix = part[len(part.rstrip()):] if part.rstrip() != part else ""
            content = part.strip()
            segment_body = dict(body, text=content)
            base = {"chunk_index": index + 1, "total_chunks": len(queue), "completed_chunks": index,
                    "completed_chars": completed_chars, "total_chars": len(source)}
            try:
                protected_part = protect_text(content)
                remaining = protected_part.protected
                for token in protected_part.tokens:
                    remaining = remaining.replace(token, "")
                if content in segment_cache:
                    events = iter([segment_cache[content]])
                elif not content or not remaining.strip():
                    events = iter([{"type": "complete", "translation": content, "model": model, "quality_issues": [], "metrics": {}}])
                else:
                    events = self._translate_segment_stream(segment_body)
                try:
                    for event in events:
                        if event["type"] == "usage":
                            usage = event["metrics"]
                            if usage.get("generated_tokens") is None:
                                tokens_known = False
                            else:
                                generated_tokens += usage["generated_tokens"]
                            if usage.get("eval_duration_ns") is None:
                                eval_known = False
                            else:
                                total_eval_ns += usage["eval_duration_ns"]
                        elif event["type"] == "complete":
                            segment_result = event
                        else:
                            event.update(base)
                            event["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
                            yield event
                finally:
                    close = getattr(events, "close", None)
                    if close:
                        close()
            except (TranslationOutputError, LlamaError) as error:
                message = str(error)
                if depth < 2 and any(word in message.lower() for word in ("output_truncated", "context", "exceed")):
                    smaller = split_source(part, max(32, token_cost(protect_text(part).protected) // 2))
                    if len(smaller) > 1:
                        queue[index:index + 1] = [(item, depth + 1) for item in smaller]
                        yield {"type": "retry", **base, "total_chunks": len(queue), "issues": ["segment_subdivided"]}
                        continue
                raise TranslationOutputError(f"第 {index + 1}/{len(queue)} 段失败；已保留 {index} 段。原因: {message}") from error
            translated = prefix + segment_result["translation"] + suffix if content else part
            segment_cache[content] = segment_result
            completed_parts.append(translated)
            completed_chars += len(part)
            all_issues.extend(segment_result.get("quality_issues", []))
            model = segment_result.get("model", model)
            index += 1
            yield {"type": "segment_complete", "translation": translated, "chunk_index": index,
                   "completed_chunks": index, "total_chunks": len(queue), "completed_chars": completed_chars,
                   "total_chars": len(source)}
        elapsed_ms = (time.perf_counter() - started) * 1000
        metrics = self._metrics({"eval_count": generated_tokens if tokens_known else None,
                                 "eval_duration": total_eval_ns if eval_known else None, "done_reason": "stop"}, elapsed_ms)
        yield {"type": "complete", "translation": "".join(completed_parts), "model": model,
               "quality_issues": sorted(set(all_issues)), "metrics": metrics,
               "completed_chars": len(source), "total_chars": len(source), "completed_chunks": len(queue), "total_chunks": len(queue)}

    def _translate_segment_stream(self, body: dict[str, Any]):
        try:
            request = parse_translation_input(body, self.settings.default_target_language)
        except ValueError as error:
            raise TranslationRequestError(str(error)) from error
        if len(request.source_text) > self.settings.max_input_chars:
            raise TranslationRequestError(
                f"待翻译文本过长（{len(request.source_text)} 字符），当前上限为 {self.settings.max_input_chars}"
            )

        protected = protect_text(request.source_text)
        prompt = build_translation_prompt(request, protected.protected)
        client = self.manager.ensure_server()
        model = client.resolve_model()
        attempts = 2 if self.settings.retry_on_bad_output else 1
        for attempt in range(attempts):
            current_prompt = prompt
            if attempt:
                current_prompt = (
                    "IMPORTANT: Your previous response violated the output contract. "
                    "Ignore all previous output and return only the translation without labels.\n\n"
                    + prompt
                )
            started = time.perf_counter()
            raw_parts: list[str] = []
            final_response: dict[str, Any] = {}
            yield {"type": "attempt", "attempt": attempt + 1, "max_attempts": attempts}
            emitted_at = 0.0
            generated_chars = 0
            estimated_tokens = 0.0
            from .segments import token_cost
            options = self._options(retry=attempt > 0)
            options["max_tokens"] = min(self.settings.max_output_tokens, self.settings.num_ctx - token_cost(current_prompt) - 256)
            if options["max_tokens"] < 32:
                raise TranslationOutputError("context_budget: 当前分段没有足够的输出预算")
            stream = client.chat_stream(
                model,
                [{"role": "user", "content": current_prompt}],
                options,
            )
            with closing(stream):
                for event in stream:
                    message = event.get("message")
                    delta = message.get("content", "") if isinstance(message, dict) else ""
                    if isinstance(delta, str) and delta:
                        raw_parts.append(delta)
                        elapsed_ms = (time.perf_counter() - started) * 1000
                        generated_chars += len(delta)
                        estimated_tokens += sum(1 if ord(char) >= 0x2E80 else 0.25 for char in delta)
                        if event.get("done") is True:
                            final_response = event
                        if elapsed_ms - emitted_at < 100:
                            continue
                        emitted_at = elapsed_ms

                        yield {
                            "type": "progress",
                            "generated_chars": generated_chars,
                            "estimated_tokens": round(estimated_tokens),
                            "elapsed_ms": round(elapsed_ms, 1),
                            "tokens_per_second": round(estimated_tokens / max(elapsed_ms / 1000, 0.001), 2),
                        }
                    if event.get("done") is True:
                        final_response = event

            raw = "".join(raw_parts)
            cleaned = clean_model_output(raw, protected)
            issues = quality_issues(raw, cleaned, protected, request.source_text)
            if final_response.get("done_reason") == "length":
                issues.append("output_truncated")
            if not final_response:
                issues.append("incomplete_stream")
            elapsed_ms = (time.perf_counter() - started) * 1000
            metrics = self._metrics(final_response, elapsed_ms)
            yield {"type": "usage", "metrics": metrics}
            if not is_fatal(issues):
                yield {
                    "type": "complete",
                    "translation": cleaned,
                    "model": model,
                    "quality_issues": issues,
                    "metrics": metrics,
                }
                return
            self.logger.warning("Hy-MT2 streamed output rejected on attempt %s: %s", attempt + 1, issues)
            if attempt + 1 < attempts:
                yield {"type": "retry", "issues": issues}

        raise TranslationOutputError(f"流式模型输出未通过结果校验: {issues}")
