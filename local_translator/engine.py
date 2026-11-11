from __future__ import annotations

import hashlib
import json
import uuid
import logging
import time
import threading
from contextlib import closing, contextmanager
from dataclasses import asdict, dataclass
from typing import Any

from .config import Settings
from .errors import LlamaError, ModelBusyError
from .prompts import build_translation_prompt, parse_translation_input
from .quality import clean_model_output, is_fatal, protect_text, quality_issues
from .runtime import LlamaCppProcessManager
from .jobs import TranslationCancelled, TranslationJob
from .segments import split_source, token_cost
from .inference_telemetry import InferenceTelemetry
from .scheduler import SchedulingError, TranslationScheduler


class TranslationRequestError(ValueError):
    def __init__(self, message: str, code: str = "invalid_request"):
        super().__init__(message)
        self.code = code


class TranslationOutputError(RuntimeError):
    def __init__(self, message: str, code: str = "model_output_error"):
        super().__init__(message)
        self.code = code


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
        self._admission_lock = threading.Lock()
        self._jobs: dict[str, TranslationJob] = {}
        self._active_job: TranslationJob | None = None
        self.inference = InferenceTelemetry()
        self._jobs_lock = threading.RLock()
        self._stopping = threading.Event()
        self.scheduler = TranslationScheduler(
            getattr(settings, "max_pending_translations", 8),
            getattr(settings, "queue_wait_timeout_seconds", 120),
        )

    @contextmanager
    def management(self):
        if not self._translation_lock.acquire(blocking=False):
            raise ModelBusyError("翻译或模型操作正在进行，请完成或取消后重试")
        try:
            if self._stopping.is_set():
                raise ModelBusyError("网关正在退出")
            if self.scheduler.busy:
                raise ModelBusyError("翻译任务正在运行或等待，请完成或取消后重试")
            yield
        finally:
            self._translation_lock.release()

    def begin_shutdown(self):
        self._stopping.set()
        self.scheduler.shutdown()

    def cancel_active(self):
        job = self._active_job
        if job is not None:
            job.cancel.set()

    def _options(self, retry: bool = False) -> dict[str, Any]:
        return {
            "temperature": 0.0 if retry else self.settings.temperature,
            "top_p": self.settings.top_p,
            "top_k": self.settings.top_k,
            "repeat_penalty": self.settings.repetition_penalty,
            "seed": self.settings.seed,
            "num_ctx": self.settings.num_ctx,
            "max_tokens": self.settings.max_output_tokens,
            "cache_prompt": self.settings.cache_prompt,
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
            if event["type"] == "cancelled":
                raise TranslationRequestError("翻译已取消，已完成分段保留", "translation_cancelled")
        raise TranslationOutputError("incomplete_stream: 翻译未完成")

    def cancel_translation(self, job_id: str, owner: str | None = None) -> None:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
        if job is None or (owner is not None and job.owner != owner):
            raise TranslationRequestError("checkpoint_expired: 翻译断点已过期，请重新翻译", "checkpoint_expired")
        job.cancel.set()

    def translate_stream(self, body: dict[str, Any]):
        job = None
        admitted = False
        try:
            if self._stopping.is_set():
                raise TranslationRequestError("网关正在退出", "gateway_stopping")
            require_ready = body.get("require_ready", False)
            if not isinstance(require_ready, bool):
                raise TranslationRequestError("require_ready 必须是布尔值")
            source = body.get("_request_source", "api")
            if source not in ("selection", "workspace", "api"):
                raise TranslationRequestError("request_source 无效")
            if require_ready:
                # This read-only health check can take up to its own short
                # timeout. Do not hold admission or inference while probing.
                self.manager.require_ready_server()
            # Only admission and management share this lock. Inference leases
            # belong to the scheduler and are released between validated parts.
            with self._admission_lock:
                if not self._translation_lock.acquire(blocking=False):
                    raise TranslationRequestError("translation_busy: 模型管理操作正在进行，请稍后重试", "translation_busy")
                try:
                    if self._stopping.is_set():
                        raise TranslationRequestError("网关正在退出", "gateway_stopping")
                    self.scheduler.check_capacity()
                    # Keep lookup/creation and the live mark atomic with LRU
                    # pruning by other requests finishing concurrently. Lock
                    # order is jobs -> scheduler; finish releases scheduler
                    # before it acquires jobs. _get_job also takes this RLock.
                    with self._jobs_lock:
                        job = self._get_job(body)
                        self.scheduler.admit(job.id, source, job.cancel)
                        admitted = True
                        job.live = True
                finally:
                    self._translation_lock.release()
            yield from self._translate_document(body, job)
        except TranslationCancelled:
            if job is None:
                raise TranslationRequestError("翻译已取消", "translation_cancelled")
            yield {"type": "cancelled", **job.checkpoint(), "message": "已取消，已完成分段保留，可继续翻译"}
        except SchedulingError as error:
            raise TranslationRequestError(str(error), error.code) from error
        finally:
            if admitted:
                if self._active_job is job:
                    self._active_job = None
                self.scheduler.finish(job.id)
                with self._jobs_lock:
                    job.live = False
                    job.updated_at = time.monotonic()
                    self._prune_jobs_locked()

    def _get_job(self, body: dict[str, Any]) -> TranslationJob:
        with self._jobs_lock:
            return self._get_job_locked(body)

    def _prune_jobs_locked(self, max_inactive: int = 8) -> None:
        now = time.monotonic()
        for key, job in list(self._jobs.items()):
            if not job.live and now - job.updated_at > 3600:
                del self._jobs[key]
        inactive = sorted((job for job in self._jobs.values() if not job.live), key=lambda job: job.updated_at)
        for job in inactive[:max(0, len(inactive) - max_inactive)]:
            del self._jobs[job.id]

    def _get_job_locked(self, body: dict[str, Any]) -> TranslationJob:
        try:
            request = parse_translation_input(body, self.settings.default_target_language)
        except ValueError as error:
            raise TranslationRequestError(str(error)) from error
        source = request.source_text
        if len(source) > self.settings.max_input_chars:
            raise TranslationRequestError(f"待翻译文本过长（{len(source)} 字符），当前上限为 {self.settings.max_input_chars}")
        fingerprint = hashlib.sha256(json.dumps({
            "request": asdict(request), "model": self.settings.model_name,
            "owner": body.get("_owner", ""),
            "runtime_root": str(self.settings.resolved_data_root), "options": self._options(),
        }, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
        now = time.monotonic()
        self._prune_jobs_locked()
        resume_id = body.get("job_id")
        if resume_id is not None:
            if not isinstance(resume_id, str) or resume_id not in self._jobs:
                raise TranslationRequestError("checkpoint_expired: 翻译断点已过期，请选择重新翻译", "checkpoint_expired")
            job = self._jobs[resume_id]
            if job.fingerprint != fingerprint:
                raise TranslationRequestError("checkpoint_mismatch: 原文、语言、模型或推理配置已改变，请重新翻译", "checkpoint_mismatch")
            if job.live:
                raise TranslationRequestError("translation_busy: 此任务仍在运行或等待，请稍后继续", "translation_busy")
            # Never clear a transport event: a disconnected caller must stay
            # cancelled, and a previous request retains its own Event object.
            job.cancel = threading.Event()
            if isinstance(body.get("_cancel"), threading.Event):
                job.cancel = body["_cancel"]
            job.updated_at = now
            return job
        overhead = token_cost(build_translation_prompt(request, "")) + 256
        budget = min(1200, (self.settings.num_ctx - overhead) // 3, self.settings.max_output_tokens // 2)
        if budget < 64:
            raise TranslationRequestError("context_budget: 上下文或输出预算太小，请增加 num_ctx / max_output_tokens", "context_budget")
        self._prune_jobs_locked(max_inactive=7)
        job = TranslationJob(uuid.uuid4().hex, fingerprint, source, self.settings.model_name,
                             [(part, 0) for part in split_source(source, budget)])
        job.owner = body.get("_owner", "")
        if isinstance(body.get("_cancel"), threading.Event):
            job.cancel = body["_cancel"]
        self._jobs[job.id] = job
        return job

    def _translate_document(self, body: dict[str, Any], job: TranslationJob):
        if self._stopping.is_set():
            job.cancel.set()
        started = time.perf_counter()
        in_flight = False
        elapsed = lambda: job.elapsed_ms + (time.perf_counter() - started) * 1000
        try:
            if job.cancel.is_set():
                raise TranslationCancelled()
            yield from self.scheduler.acquire(job.id)
            self._active_job = job
            # The server's checkpoint is authoritative, even if the client lost
            # the last segment event while disconnecting. Never append it twice.
            yield {"type": "plan", **job.checkpoint(), "elapsed_ms": round(elapsed(), 1)}
            while len(job.completed) < len(job.queue):
                if job.cancel.is_set():
                    raise TranslationCancelled()
                yield from self.scheduler.acquire(job.id)
                self._active_job = job
                index = len(job.completed)
                part, depth = job.queue[index]
                prefix = part[:len(part) - len(part.lstrip())]
                suffix = part[len(part.rstrip()):] if part.rstrip() != part else ""
                content = part.strip()
                base = {**job.progress(), "chunk_index": index + 1}
                try:
                    protected_part = protect_text(content)
                    remaining = protected_part.protected
                    for token in protected_part.tokens:
                        remaining = remaining.replace(token, "")
                    if content in job.cache:
                        events = iter([job.cache[content]])
                    elif not content or not remaining.strip():
                        events = iter([{"type": "complete", "translation": content, "model": job.model, "quality_issues": []}])
                    else:
                        in_flight = True
                        events = self._translate_segment_stream(dict(body, text=content), job.cancel)
                    segment_result = None
                    try:
                        for event in events:
                            if job.cancel.is_set():
                                raise TranslationCancelled()
                            if event["type"] == "usage":
                                usage = event["metrics"]
                                if usage.get("prompt_tokens") is None:
                                    job.prompt_tokens_known = False
                                else:
                                    job.prompt_tokens += usage["prompt_tokens"]
                                if usage.get("generated_tokens") is None:
                                    job.tokens_known = False
                                else:
                                    job.generated_tokens += usage["generated_tokens"]
                                if usage.get("eval_duration_ns") is None:
                                    job.eval_known = False
                                else:
                                    job.eval_ns += usage["eval_duration_ns"]
                            elif event["type"] == "complete":
                                segment_result = event
                            else:
                                yield {**event, **base, "elapsed_ms": round(elapsed(), 1)}
                    finally:
                        close = getattr(events, "close", None)
                        if close:
                            close()
                    in_flight = False
                    if segment_result is None:
                        raise TranslationOutputError("incomplete_stream: 当前分段未收到完成确认")
                except (TranslationOutputError, LlamaError) as error:
                    if job.cancel.is_set():
                        raise TranslationCancelled() from error
                    message = str(error)
                    if depth < 2 and any(word in message.lower() for word in ("output_truncated", "context", "exceed")):
                        smaller = split_source(part, max(32, token_cost(protect_text(part).protected) // 2))
                        if len(smaller) > 1:
                            job.queue[index:index + 1] = [(item, depth + 1) for item in smaller]
                            self._active_job = None
                            self.scheduler.release(job.id)
                            yield {"type": "retry", **job.progress(), "chunk_index": index + 1, "issues": ["segment_subdivided"]}
                            continue
                    raise TranslationOutputError(
                        f"第 {index + 1}/{len(job.queue)} 段失败；已保留 {index} 段，可重试剩余分段。原因: {message}",
                        error.code,
                    ) from error
                if job.cancel.is_set():
                    raise TranslationCancelled()
                translated = prefix + segment_result["translation"] + suffix if content else part
                job.cache[content] = segment_result
                job.completed.append(translated)
                job.completed_chars += len(part)
                job.issues.update(segment_result.get("quality_issues", []))
                job.model = segment_result.get("model", job.model)
                job.updated_at = time.monotonic()
                # The checkpoint is committed before another job can acquire
                # inference; failed quality attempts never become resumable.
                self._active_job = None
                self.scheduler.release(job.id, pending=len(job.completed) < len(job.queue))
                yield {"type": "segment_complete", **job.progress(), "translation": translated,
                       "chunk_index": len(job.completed), "elapsed_ms": round(elapsed(), 1)}
            metrics = self._metrics({"eval_count": job.generated_tokens if job.tokens_known else None,
                                     "eval_duration": job.eval_ns if job.eval_known else None, "done_reason": "stop"}, elapsed())
            metrics["prompt_tokens"] = job.prompt_tokens if job.prompt_tokens_known else None
            metrics["total_tokens"] = job.prompt_tokens + job.generated_tokens if job.prompt_tokens_known and job.tokens_known else None
            yield {"type": "complete", **job.checkpoint(), "model": job.model,
                   "quality_issues": sorted(job.issues), "metrics": metrics}
        except TranslationCancelled:
            if in_flight:
                job.tokens_known = False
                job.prompt_tokens_known = False
                job.eval_known = False
            yield {"type": "cancelled", **job.checkpoint(), "message": "已取消，已完成分段保留，可继续翻译"}
        except (GeneratorExit, Exception):
            if in_flight:
                job.tokens_known = False
                job.prompt_tokens_known = False
                job.eval_known = False
            raise
        finally:
            job.elapsed_ms = elapsed()
            job.updated_at = time.monotonic()

    def _translate_segment_stream(self, body: dict[str, Any], cancel: threading.Event | None = None):
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
        client = self.manager.require_ready_server() if body.get("require_ready") is True else self.manager.ensure_server(cancel=cancel)
        model = client.resolve_model()
        attempts = 2 if self.settings.retry_on_bad_output else 1
        for attempt in range(attempts):
            if cancel is not None and cancel.is_set():
                raise TranslationCancelled()
            current_prompt = prompt if attempt == 0 else build_translation_prompt(request, protected.protected, preserve_formatting=False)
            started = time.perf_counter()
            raw_parts: list[str] = []
            final_response: dict[str, Any] = {}
            yield {"type": "attempt", "attempt": attempt + 1, "max_attempts": attempts}
            emitted_at = 0.0
            generated_chars = 0
            estimated_tokens = 0.0
            from .segments import token_cost
            options = self._options(retry=attempt > 0)
            options["_cancel"] = cancel
            options["max_tokens"] = min(self.settings.max_output_tokens, self.settings.num_ctx - token_cost(current_prompt) - 256)
            if options["max_tokens"] < 32:
                raise TranslationOutputError("context_budget: 当前分段没有足够的输出预算")
            stream = self._tracked_stream(
                client,
                model,
                [{"role": "user", "content": current_prompt}],
                options,
                attempt + 1,
                cancel,
            )
            with closing(stream):
                for event in stream:
                    if cancel is not None and cancel.is_set():
                        raise TranslationCancelled()
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
            inference_metrics = final_response.get("inference_metrics") or {}
            metrics["prompt_tokens"] = inference_metrics.get("prompt_tokens")
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

    def _tracked_stream(self, client, model, messages, options, attempt, cancel):
        job = self._active_job
        call_id = self.inference.begin(model, job_id=job.id if job else None,
                                       segment_index=len(job.completed) + 1 if job else None, attempt=attempt)
        status = "failed"
        try:
            with closing(client.chat_stream(model, messages, options)) as stream:
                for event in stream:
                    self.inference.observe(call_id, event)
                    if cancel is not None and cancel.is_set():
                        raise TranslationCancelled()
                    yield event
            status = "completed"
        except (TranslationCancelled, GeneratorExit):
            status = "cancelled"
            raise
        finally:
            self.inference.finish(call_id, status)
