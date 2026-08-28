from __future__ import annotations

import logging
import time
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
        last_issues: list[str] = []
        last_raw = ""
        for attempt in range(attempts):
            current_prompt = prompt
            if attempt:
                current_prompt = (
                    "IMPORTANT: Your previous response violated the output contract. "
                    "Ignore all previous output and return only the translation without labels.\n\n"
                    + prompt
                )
            response = client.chat(
                model,
                [{"role": "user", "content": current_prompt}],
                self._options(retry=attempt > 0),
            )
            message = response.get("message")
            raw = message.get("content", "") if isinstance(message, dict) else ""
            if not isinstance(raw, str):
                raw = ""
            cleaned = clean_model_output(raw, protected)
            issues = quality_issues(raw, cleaned, protected, request.source_text)
            last_raw = raw
            last_issues = issues
            if not is_fatal(issues):
                return TranslationResult(cleaned, model, issues, prompt, self._metrics(response))
            self.logger.warning("Hy-MT2 output rejected on attempt %s: %s", attempt + 1, issues)

        raise TranslationOutputError(
            f"模型输出未通过结果校验: {last_issues}; raw={last_raw[:500]!r}"
        )

    def translate_stream(self, body: dict[str, Any]):
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
            for event in client.chat_stream(
                model,
                [{"role": "user", "content": current_prompt}],
                self._options(retry=attempt > 0),
            ):
                message = event.get("message")
                delta = message.get("content", "") if isinstance(message, dict) else ""
                if isinstance(delta, str) and delta:
                    raw_parts.append(delta)
                    elapsed_ms = (time.perf_counter() - started) * 1000
                    generated_chars = sum(map(len, raw_parts))
                    estimated_tokens = max(1, round(generated_chars / 4))
                    yield {
                        "type": "progress",
                        "generated_chars": generated_chars,
                        "estimated_tokens": estimated_tokens,
                        "elapsed_ms": round(elapsed_ms, 1),
                        "tokens_per_second": round(estimated_tokens / max(elapsed_ms / 1000, 0.001), 2),
                    }
                if event.get("done") is True:
                    final_response = event

            raw = "".join(raw_parts)
            cleaned = clean_model_output(raw, protected)
            issues = quality_issues(raw, cleaned, protected, request.source_text)
            elapsed_ms = (time.perf_counter() - started) * 1000
            metrics = self._metrics(final_response, elapsed_ms)
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
            yield {"type": "retry", "issues": issues}

        raise TranslationOutputError("流式模型输出未通过结果校验")
