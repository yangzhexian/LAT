"""Session-local model call metrics, without retaining prompts or output text."""
from __future__ import annotations

from collections import deque
import math
import threading
import time
import uuid
from typing import Any


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        result = float(value)
    except (OverflowError, ValueError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def token_count(value: Any) -> int | None:
    number = finite_number(value)
    return int(number) if number is not None and number.is_integer() and number <= 2**53 - 1 else None


def response_metrics(response: dict[str, Any]) -> dict[str, Any]:
    """Normalize real llama.cpp counters; SSE fragments are never token counts."""
    usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
    timings = response.get("timings") if isinstance(response.get("timings"), dict) else {}
    prompt = token_count(usage.get("prompt_tokens"))
    processed = token_count(timings.get("prompt_n"))
    cached = token_count(timings.get("cache_n"))
    if prompt is None and processed is not None and cached is not None:
        prompt = processed + cached
    generated = token_count(usage.get("completion_tokens"))
    if generated is None:
        generated = token_count(timings.get("predicted_n"))
    total = token_count(usage.get("total_tokens"))
    if total is None and prompt is not None and generated is not None:
        total = prompt + generated
    prompt_ms = finite_number(timings.get("prompt_ms"))
    decode_ms = finite_number(timings.get("predicted_ms"))
    decode_speed = finite_number(timings.get("predicted_per_second"))
    if decode_speed is None and generated is not None and decode_ms:
        decode_speed = finite_number(generated / decode_ms * 1000)
    prompt_speed = finite_number(timings.get("prompt_per_second"))
    if prompt_speed is None and processed is not None and prompt_ms:
        prompt_speed = finite_number(processed / prompt_ms * 1000)
    return {
        "prompt_tokens": prompt, "generated_tokens": generated, "total_tokens": total,
        "prompt_processed_tokens": processed, "cached_prompt_tokens": cached,
        "prompt_ms": prompt_ms, "decode_ms": decode_ms,
        "tokens_per_second": decode_speed, "prompt_tokens_per_second": prompt_speed,
    }


class InferenceTelemetry:
    """A bounded history of actual model calls, including retries and segments."""
    def __init__(self, history_limit: int = 120):
        self._lock = threading.Lock()
        self._started = time.time()
        self._active: dict[str, Any] | None = None
        self._active_started = 0.0
        self._history: deque[dict[str, Any]] = deque(maxlen=history_limit)
        self._latest: dict[str, Any] | None = None
        self._summary = dict(calls=0, completed_calls=0, cancelled_calls=0, failed_calls=0,
                             prompt_tokens=0, generated_tokens=0, total_tokens=0, unknown_token_calls=0)

    def begin(self, model: str, *, job_id: str | None, segment_index: int | None, attempt: int) -> str:
        record = {
            "id": uuid.uuid4().hex, "model": model, "job_id": job_id,
            "segment_index": segment_index, "attempt": attempt, "status": "running",
            "phase": "prefill", "started_at": time.time(), "finished_at": None,
            "elapsed_ms": 0.0, "first_token_ms": None, "output_chars": 0,
            "tokens_complete": False, "token_source": "unknown", "speed_source": "unknown",
            **response_metrics({}),
        }
        with self._lock:
            self._active = record
            self._active_started = time.perf_counter()
            self._summary["calls"] += 1
        return record["id"]

    def observe(self, call_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            record = self._active
            if record is None or record["id"] != call_id:
                return
            record["elapsed_ms"] = round((time.perf_counter() - self._active_started) * 1000, 1)
            message = event.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, str) and content:
                if record["first_token_ms"] is None:
                    record["first_token_ms"] = record["elapsed_ms"]
                record["phase"] = "decode"
                record["output_chars"] += len(content)
            metrics = event.get("inference_metrics")
            if not isinstance(metrics, dict):
                metrics = response_metrics(event)
                # Existing clients/test doubles use the older normalized keys.
                if metrics["generated_tokens"] is None:
                    metrics["generated_tokens"] = token_count(event.get("eval_count"))
                duration = finite_number(event.get("eval_duration"))
                if metrics["decode_ms"] is None and duration is not None:
                    metrics["decode_ms"] = duration / 1_000_000
                if metrics["tokens_per_second"] is None and metrics["generated_tokens"] is not None and duration:
                    metrics["tokens_per_second"] = metrics["generated_tokens"] / duration * 1_000_000_000
            for key in response_metrics({}):
                value = metrics.get(key)
                if finite_number(value) is not None:
                    record[key] = value
            if record["prompt_tokens"] is not None and record["generated_tokens"] is not None:
                record["total_tokens"] = record["prompt_tokens"] + record["generated_tokens"]
            if any(record[key] is not None for key in ("prompt_tokens", "generated_tokens", "total_tokens")):
                record["token_source"] = "llama.cpp"
            if record["tokens_per_second"] is not None or record["prompt_tokens_per_second"] is not None:
                record["speed_source"] = "llama.cpp"
            if event.get("done") is True:
                record["tokens_complete"] = all(record[key] is not None for key in ("prompt_tokens", "generated_tokens", "total_tokens"))

    def finish(self, call_id: str, status: str) -> None:
        with self._lock:
            record = self._active
            if record is None or record["id"] != call_id:
                return
            record.update(status=status, phase="idle", finished_at=time.time(),
                          elapsed_ms=round((time.perf_counter() - self._active_started) * 1000, 1))
            self._summary[f"{status}_calls"] += 1
            if not record["tokens_complete"]:
                self._summary["unknown_token_calls"] += 1
            for key in ("prompt_tokens", "generated_tokens", "total_tokens"):
                if record[key] is not None:
                    self._summary[key] += record[key]
                elif key == "total_tokens":
                    # Partial input/output counters still establish a lower
                    # bound, without claiming that this call's total is known.
                    self._summary[key] += (record["prompt_tokens"] or 0) + (record["generated_tokens"] or 0)
            self._history.append(dict(record))
            self._latest = dict(record)
            self._active = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            active = dict(self._active) if self._active else None
            if active is not None:
                active["elapsed_ms"] = round((time.perf_counter() - self._active_started) * 1000, 1)
            return {"session_started_at": self._started, "summary": dict(self._summary),
                    "active": active, "latest": dict(self._latest) if self._latest else None,
                    "history": [dict(record) for record in self._history]}
