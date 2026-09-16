from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterator

from .config import Settings
from .errors import LlamaError, LlamaHTTPError


class LlamaServerClient:
    """Small OpenAI-compatible client for the managed llama-server process."""

    def __init__(self, base_url: str, settings: Settings):
        self.base_url = base_url.rstrip("/")
        self.settings = settings

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", path.lstrip("/")),
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout if timeout is not None else self.settings.request_timeout_seconds,
            ) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise LlamaHTTPError(error.code, detail or str(error)) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise LlamaError(f"无法连接 llama.cpp 服务 ({self.base_url}): {error}") from error
        if not raw:
            return {}
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise LlamaError(f"llama.cpp 返回了无效 JSON: {raw[:300]!r}") from error
        if not isinstance(value, dict):
            raise LlamaError("llama.cpp 返回的数据不是 JSON 对象")
        return value

    def is_ready(self) -> bool:
        try:
            self._request("GET", "/health", timeout=2.0)
            return True
        except LlamaError:
            return False

    def resolve_model(self) -> str:
        return self.settings.model_name

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "temperature": options.get("temperature", 0.7),
            "top_p": options.get("top_p", 0.6),
            "top_k": options.get("top_k", 20),
            "repeat_penalty": options.get("repeat_penalty", 1.05),
            "seed": options.get("seed", 42),
            "max_tokens": options.get("max_tokens", 4096),
        }
        response = self._request("POST", "/v1/chat/completions", payload)
        choices = response.get("choices")
        first_choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
        message = first_choice.get("message")
        content = message.get("content", "") if isinstance(message, dict) else ""
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        timings = response.get("timings") if isinstance(response.get("timings"), dict) else {}
        predicted_ms = timings.get("predicted_ms")
        return {
            "message": {"content": content if isinstance(content, str) else ""},
            "eval_count": usage.get("completion_tokens"),
            "eval_duration": predicted_ms * 1_000_000 if isinstance(predicted_ms, (int, float)) else None,
            "done_reason": first_choice.get("finish_reason"),
        }

    def chat_stream(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any],
    ) -> Iterator[dict[str, Any]]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "temperature": options.get("temperature", 0.7),
            "top_p": options.get("top_p", 0.6),
            "top_k": options.get("top_k", 20),
            "repeat_penalty": options.get("repeat_penalty", 1.05),
            "seed": options.get("seed", 42),
            "max_tokens": options.get("max_tokens", 4096),
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", "v1/chat/completions"),
            data=body,
            headers={"Accept": "text/event-stream", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.settings.request_timeout_seconds) as response:
                usage: dict[str, Any] = {}
                done_reason: str | None = None
                done_emitted = False
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        if done_reason is None:
                            raise LlamaError("incomplete_stream: 模型未报告终止原因")
                        yield {
                            "done": True,
                            "done_reason": done_reason,
                            "eval_count": usage.get("completion_tokens"),
                        }
                        done_emitted = True
                        break
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError as error:
                        raise LlamaError(f"llama.cpp 流式响应包含无效 JSON: {data[:300]!r}") from error
                    if not isinstance(event, dict):
                        continue
                    if isinstance(event.get("usage"), dict):
                        usage = event["usage"]
                    choices = event.get("choices")
                    if not isinstance(choices, list) or not choices:
                        continue
                    choice = choices[0] if isinstance(choices[0], dict) else {}
                    delta = choice.get("delta") if isinstance(choice, dict) else {}
                    content = delta.get("content", "") if isinstance(delta, dict) else ""
                    if isinstance(content, str) and content:
                        yield {"message": {"content": content}}
                    if isinstance(choice.get("finish_reason"), str):
                        done_reason = choice["finish_reason"]
                if not done_emitted:
                    if done_reason is None:
                        raise LlamaError("incomplete_stream: 模型连接提前结束，未收到完成确认")
                    yield {
                        "done": True,
                        "done_reason": done_reason,
                        "eval_count": usage.get("completion_tokens"),
                    }
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise LlamaHTTPError(error.code, detail or str(error)) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise LlamaError(f"llama.cpp 流式连接失败 ({self.base_url}): {error}") from error
