from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from .config import Settings


class OllamaError(RuntimeError):
    pass


class OllamaHTTPError(OllamaError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class OllamaClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base_url = settings.ollama_url.rstrip("/")
        self.active_model: str | None = None

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        body = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
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
            raise OllamaHTTPError(error.code, detail or str(error)) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise OllamaError(f"无法连接 Ollama ({self.base_url}): {error}") from error
        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError as error:
            raise OllamaError(f"Ollama 返回了无效 JSON: {raw[:300]!r}") from error
        if not isinstance(data, dict):
            raise OllamaError("Ollama 返回的数据不是 JSON 对象")
        return data

    def is_ready(self) -> bool:
        try:
            self._request("GET", "/api/version", timeout=2.0)
            return True
        except OllamaError:
            return False

    def version(self) -> dict[str, Any]:
        return self._request("GET", "/api/version", timeout=5.0)

    def tags(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/tags", timeout=10.0)
        models = data.get("models", [])
        return models if isinstance(models, list) else []

    def running_models(self) -> list[dict[str, Any]]:
        data = self._request("GET", "/api/ps", timeout=10.0)
        models = data.get("models", [])
        return models if isinstance(models, list) else []

    def resolve_model(self) -> str:
        names = []
        for item in self.tags():
            if isinstance(item, dict) and isinstance(item.get("name"), str):
                names.append(item["name"])
        candidates = [self.active_model, self.settings.model_name, *self.settings.model_aliases]
        for candidate in candidates:
            if candidate and candidate in names:
                return candidate
        # A missing /api/tags entry is dealt with by Ollama's own useful error.
        return self.settings.model_name

    def select_model(self, model: str) -> str:
        requested = model.strip()
        if not requested:
            raise OllamaError("模型名称不能为空")
        names = {
            item.get("name")
            for item in self.tags()
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        if requested not in names:
            raise OllamaError(f"本机 Ollama 未发现模型: {requested}")
        self.active_model = requested
        return requested

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any],
        keep_alive: str | int | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": options,
        }
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        return self._request("POST", "/api/chat", payload)

    def chat_stream(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any],
        keep_alive: str | int | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Yield Ollama's newline-delimited chat events without buffering."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": options,
        }
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", "api/chat"),
            data=body,
            headers={"Accept": "application/x-ndjson", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.settings.request_timeout_seconds) as response:
                for raw_line in response:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError) as error:
                        raise OllamaError(f"Ollama 流式响应包含无效 JSON: {line[:300]!r}") from error
                    if isinstance(event, dict):
                        yield event
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise OllamaHTTPError(error.code, detail or str(error)) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise OllamaError(f"Ollama 流式连接失败 ({self.base_url}): {error}") from error

    def pull_stream(self, model: str) -> Iterator[dict[str, Any]]:
        """Yield Ollama model download events from the newline-delimited API."""
        payload = {"model": model, "stream": True}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", "api/pull"),
            data=body,
            headers={"Accept": "application/x-ndjson", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=max(self.settings.request_timeout_seconds, 3600.0),
            ) as response:
                for raw_line in response:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError) as error:
                        raise OllamaError(f"Ollama 下载响应包含无效 JSON: {line[:300]!r}") from error
                    if isinstance(event, dict):
                        yield event
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise OllamaHTTPError(error.code, detail or str(error)) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise OllamaError(f"Ollama 模型下载连接失败 ({self.base_url}): {error}") from error

    def load(self, model: str) -> dict[str, Any]:
        return self.chat(model, [], {}, self.settings.keep_alive)

    def unload(self, model: str) -> dict[str, Any]:
        return self.chat(model, [], {}, 0)


@dataclass
class ManagedProcess:
    process: subprocess.Popen[Any]
    executable: str


class OllamaProcessManager:
    """Use an existing Ollama server when present; otherwise own one safely."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = OllamaClient(settings)
        self.owned_process: ManagedProcess | None = None

    def _find_executable(self) -> str:
        configured = self.settings.ollama_executable.strip()
        candidates = [configured] if configured else []
        which = shutil.which("ollama")
        if which:
            candidates.append(which)
        candidates.extend(
            [
                r"C:\Users\Admin\AppData\Local\Programs\Ollama\ollama.exe",
                r"C:\Program Files\Ollama\ollama.exe",
                r"C:\Program Files\Ollama\ollama app.exe",
                r"D:\Tools\Ollama\ollama.exe",
            ]
        )
        for candidate in candidates:
            if candidate and Path(candidate).exists():
                return candidate
        raise OllamaError(
            "找不到 ollama.exe。请把 Ollama 加入 PATH，或设置环境变量 OLLAMA_EXE="
            r"C:\Users\<用户名>\AppData\Local\Programs\Ollama\ollama.exe"
        )

    def ensure_server(self) -> OllamaClient:
        if self.client.is_ready():
            return self.client
        if not self.settings.auto_start_ollama:
            raise OllamaError(f"Ollama 未运行: {self.settings.ollama_url}")
        executable = self._find_executable()
        log_path = self.settings.resolved_log_file
        log_path.parent.mkdir(parents=True, exist_ok=True)
        environment = os.environ.copy()
        environment["OLLAMA_HOST"] = self.settings.ollama_url.removeprefix("http://").removeprefix("https://")
        if self.settings.model_dir:
            environment["OLLAMA_MODELS"] = str(self.settings.resolved_model_dir)
        log_handle = log_path.open("ab")
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            process = subprocess.Popen(
                [executable, "serve"],
                cwd=str(self.settings.resolved_model_dir.parent if self.settings.model_dir else Path.cwd()),
                env=environment,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
        except OSError:
            log_handle.close()
            raise
        # The child inherited the file descriptor; closing our copy is safe.
        log_handle.close()
        self.owned_process = ManagedProcess(process, executable)
        deadline = time.monotonic() + 30.0
        while time.monotonic() < deadline:
            if self.client.is_ready():
                return self.client
            if process.poll() is not None:
                raise OllamaError(
                    f"Ollama 启动失败，退出码 {process.returncode}。请查看 {log_path}"
                )
            time.sleep(0.25)
        raise OllamaError(f"Ollama 启动超时，请查看 {log_path}")

    def shutdown(self) -> None:
        model = self.settings.model_name
        try:
            if self.client.is_ready() and self.settings.unload_on_exit:
                self.client.unload(self.client.resolve_model())
        except OllamaError:
            pass
        managed = self.owned_process
        self.owned_process = None
        if managed is None or managed.process.poll() is not None:
            return
        try:
            managed.process.terminate()
            managed.process.wait(timeout=5)
        except (subprocess.TimeoutExpired, OSError):
            try:
                managed.process.kill()
            except OSError:
                pass

    def status(self) -> dict[str, Any]:
        ready = self.client.is_ready()
        result: dict[str, Any] = {
            "ollama_url": self.settings.ollama_url,
            "ready": ready,
            "owned_process": self.owned_process is not None,
            "model_configured": self.settings.model_name,
            "active_model": self.client.active_model,
        }
        if not ready:
            return result
        try:
            result["version"] = self.client.version().get("version")
            result["models"] = self.client.tags()
            result["running_models"] = self.client.running_models()
            result["resolved_model"] = self.client.resolve_model()
        except OllamaError as error:
            result["warning"] = str(error)
        return result
