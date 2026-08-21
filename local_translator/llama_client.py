from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from .config import Settings


LOGGER = logging.getLogger(__name__)
MODEL_ID = "hy-mt2-7b:q6_k"
MODEL_FILENAME = "HY-MT2-7B-Q6_K.gguf"
MODEL_URL = "https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/HY-MT2-7B-Q6_K.gguf?download=true"
MODEL_SIZE = 6_164_482_720
MODEL_SHA256 = "88ef0aba59952a4cfe4be36cb5baf797dbb370bc60e9dcbd7297036021e52831"
RUNTIME_ASSETS: dict[str, tuple[dict[str, str], ...]] = {
    "cuda-13.3": (
        {
            "name": "llama-server",
            "url": "https://github.com/ggml-org/llama.cpp/releases/download/b10545/llama-b10545-bin-win-cuda-13.3-x64.zip",
            "sha256": "59e053f64837d6da766708272f6b814ddcf8286acf39e3a4632fcc535a3fa1b5",
        },
        {
            "name": "cuda-runtime",
            "url": "https://github.com/ggml-org/llama.cpp/releases/download/b10545/cudart-llama-bin-win-cuda-13.3-x64.zip",
            "sha256": "1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e",
        },
    ),
    "cuda-12.4": (
        {
            "name": "llama-server",
            "url": "https://github.com/ggml-org/llama.cpp/releases/download/b10545/llama-b10545-bin-win-cuda-12.4-x64.zip",
            "sha256": "7caaceb18f9b3af89ff06482f6142c68d2fe384e1f55a352a129fdeb41529121",
        },
        {
            "name": "cuda-runtime",
            "url": "https://github.com/ggml-org/llama.cpp/releases/download/b10545/cudart-llama-bin-win-cuda-12.4-x64.zip",
            "sha256": "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
        },
    ),
}


class LlamaError(RuntimeError):
    pass


class LlamaHTTPError(LlamaError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class DownloadAsset:
    name: str
    url: str
    sha256: str
    size: int | None = None


class LlamaServerClient:
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

    def version(self) -> dict[str, Any]:
        return self._request("GET", "/props", timeout=5.0)

    def resolve_model(self) -> str:
        return MODEL_ID

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any],
        keep_alive: str | int | None = None,
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
        content = ""
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            message = choices[0].get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                content = message["content"]
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        return {
            "message": {"content": content},
            "eval_count": usage.get("completion_tokens"),
            "eval_duration": response.get("timings", {}).get("predicted_ms", 0) * 1_000_000 if isinstance(response.get("timings"), dict) else None,
            "done_reason": choices[0].get("finish_reason") if isinstance(choices, list) and choices and isinstance(choices[0], dict) else None,
        }

    def chat_stream(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any],
        keep_alive: str | int | None = None,
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
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        yield {"done": True, "eval_count": usage.get("completion_tokens")}
                        continue
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
                    if choice.get("finish_reason") is not None:
                        yield {"done": True, "done_reason": choice.get("finish_reason"), "eval_count": usage.get("completion_tokens")}
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise LlamaHTTPError(error.code, detail or str(error)) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise LlamaError(f"llama.cpp 流式连接失败 ({self.base_url}): {error}") from error


class LlamaCppProcessManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.owned_process: subprocess.Popen[Any] | None = None
        self.server_port: int | None = None
        self.client: LlamaServerClient | None = None

    def set_data_root(self, root: str) -> dict[str, Any]:
        path = Path(root).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        self.shutdown()
        self.settings.runtime_root = str(path)
        self.settings.model_dir = ""
        return self.status()

    @property
    def runtime_assets(self) -> tuple[DownloadAsset, ...]:
        assets = RUNTIME_ASSETS.get(self.settings.llama_runtime_variant)
        if assets is None:
            raise LlamaError(f"不支持的 llama.cpp 运行时版本: {self.settings.llama_runtime_variant}")
        return tuple(DownloadAsset(**item) for item in assets)

    def _server_executable(self) -> Path | None:
        root = self.settings.resolved_runtime_dir
        if not root.exists():
            return None
        direct = root / "llama-server.exe"
        if direct.exists():
            return direct
        matches = list(root.rglob("llama-server.exe"))
        return matches[0] if matches else None

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _verified(self, path: Path, expected_size: int | None, expected_sha256: str) -> bool:
        if not path.exists() or (expected_size is not None and path.stat().st_size != expected_size):
            return False
        marker = path.with_suffix(path.suffix + ".sha256")
        if marker.exists():
            return marker.read_text(encoding="utf-8").strip().lower() == expected_sha256.lower()
        return False

    def _download_asset(self, asset: DownloadAsset, destination: Path, phase: str) -> Iterator[dict[str, Any]]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if self._verified(destination, asset.size, asset.sha256):
            yield {"type": "download", "phase": phase, "status": "already_present", "percent": 100.0, "completed_bytes": destination.stat().st_size, "total_bytes": asset.size}
            return

        partial = destination.with_suffix(destination.suffix + ".part")
        current = partial.stat().st_size if partial.exists() else 0
        headers = {"User-Agent": "LAT/0.1.1"}
        if current:
            headers["Range"] = f"bytes={current}-"
        request = urllib.request.Request(asset.url, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=max(self.settings.request_timeout_seconds, 3600.0))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise LlamaError(f"下载 {asset.name} 失败: {error}") from error

        status = getattr(response, "status", 200)
        if current and status != 206:
            current = 0
            partial.unlink(missing_ok=True)
        mode = "ab" if current else "wb"
        completed = current
        with response, partial.open(mode) as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                completed += len(chunk)
                percent = min(100.0, completed * 100 / asset.size) if asset.size else 0.0
                yield {"type": "download", "phase": phase, "status": "downloading", "percent": round(percent, 1), "completed_bytes": completed, "total_bytes": asset.size}

        if asset.size is not None and completed != asset.size:
            raise LlamaError(f"{asset.name} 下载不完整: {completed}/{asset.size} bytes")
        digest = self._sha256(partial)
        if digest.lower() != asset.sha256.lower():
            partial.unlink(missing_ok=True)
            raise LlamaError(f"{asset.name} SHA-256 校验失败")
        os.replace(partial, destination)
        destination.with_suffix(destination.suffix + ".sha256").write_text(asset.sha256, encoding="utf-8")
        yield {"type": "download", "phase": phase, "status": "verified", "percent": 100.0, "completed_bytes": completed, "total_bytes": asset.size, "sha256": digest}

    def _extract_runtime(self, archives: list[Path]) -> None:
        stage = Path(tempfile.mkdtemp(prefix="lat-llama-", dir=str(self.settings.resolved_data_root)))
        try:
            for archive in archives:
                with zipfile.ZipFile(archive) as bundle:
                    for item in bundle.infolist():
                        target = (stage / item.filename).resolve()
                        if not str(target).startswith(str(stage.resolve())):
                            raise LlamaError("运行时压缩包包含不安全路径")
                    bundle.extractall(stage)
            server = next(iter(stage.rglob("llama-server.exe")), None)
            if server is None:
                raise LlamaError("运行时压缩包中没有 llama-server.exe")
            destination = self.settings.resolved_runtime_dir
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(stage, destination)
        finally:
            shutil.rmtree(stage, ignore_errors=True)

    def install_stream(self) -> Iterator[dict[str, Any]]:
        self.settings.resolved_data_root.mkdir(parents=True, exist_ok=True)
        if self._server_executable() is None:
            archives: list[Path] = []
            for asset in self.runtime_assets:
                archive = self.settings.resolved_data_root / "downloads" / f"{asset.name}.zip"
                archives.append(archive)
                yield from self._download_asset(asset, archive, "runtime")
            self._extract_runtime(archives)
            yield {"type": "download", "phase": "runtime", "status": "installed", "percent": 100.0}
        else:
            yield {"type": "download", "phase": "runtime", "status": "already_present", "percent": 100.0}

        model_asset = DownloadAsset(MODEL_FILENAME, MODEL_URL, MODEL_SHA256, MODEL_SIZE)
        yield from self._download_asset(model_asset, self.settings.resolved_model_path, "model")
        yield {"type": "download", "phase": "model", "status": "installed", "percent": 100.0}

    def _choose_port(self) -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def ensure_server(self) -> LlamaServerClient:
        if self.owned_process is not None and self.owned_process.poll() is None and self.client is not None and self.client.is_ready():
            return self.client
        executable = self._server_executable()
        model_path = self.settings.resolved_model_path
        if executable is None:
            raise LlamaError("尚未安装 llama.cpp 运行时 请先在启动界面安装")
        if not self._verified(model_path, MODEL_SIZE, MODEL_SHA256):
            raise LlamaError("尚未安装或校验 Hy-MT2-7B Q6_K 模型")
        self.settings.resolved_log_file.parent.mkdir(parents=True, exist_ok=True)
        port = self._choose_port()
        log_handle = self.settings.resolved_log_file.open("ab")
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        command = [
            str(executable),
            "-m", str(model_path),
            "--host", "127.0.0.1",
            "--port", str(port),
            "--jinja",
            "-ngl", "999",
            "-c", str(self.settings.num_ctx),
        ]
        try:
            process = subprocess.Popen(
                command,
                cwd=str(executable.parent),
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
        except OSError as error:
            log_handle.close()
            raise LlamaError(f"启动 llama.cpp 失败: {error}") from error
        log_handle.close()
        self.owned_process = process
        self.server_port = port
        self.client = LlamaServerClient(f"http://127.0.0.1:{port}", self.settings)
        deadline = time.monotonic() + 90.0
        while time.monotonic() < deadline:
            if self.client.is_ready():
                return self.client
            if process.poll() is not None:
                raise LlamaError(f"llama.cpp 启动失败 退出码 {process.returncode} 请查看 {self.settings.resolved_log_file}")
            time.sleep(0.25)
        self.shutdown()
        raise LlamaError(f"llama.cpp 启动超时 请查看 {self.settings.resolved_log_file}")

    def shutdown(self) -> None:
        process = self.owned_process
        self.owned_process = None
        self.client = None
        self.server_port = None
        if process is None or process.poll() is not None:
            return
        try:
            process.terminate()
            process.wait(timeout=8)
        except (subprocess.TimeoutExpired, OSError):
            try:
                process.kill()
            except OSError:
                pass

    def status(self) -> dict[str, Any]:
        executable = self._server_executable()
        model = self.settings.resolved_model_path
        ready = bool(self.client and self.client.is_ready() and self.owned_process and self.owned_process.poll() is None)
        result: dict[str, Any] = {
            "backend": "llama.cpp",
            "ready": ready,
            "owned_process": self.owned_process is not None,
            "model_configured": MODEL_ID,
            "active_model": MODEL_ID if ready else None,
            "resolved_model": MODEL_ID,
            "version": self.settings.llama_release,
            "runtime": {
                "installed": executable is not None,
                "verified": executable is not None,
                "variant": self.settings.llama_runtime_variant,
                "root_dir": str(self.settings.resolved_data_root),
            },
            "model": {
                "installed": model.exists() and model.stat().st_size == MODEL_SIZE,
                "verified": self._verified(model, MODEL_SIZE, MODEL_SHA256),
                "path": str(model),
                "size_bytes": MODEL_SIZE,
            },
            "models": [],
            "running_models": [],
        }
        if result["model"]["installed"]:
            result["models"] = [{"name": MODEL_ID, "model": MODEL_ID, "size": MODEL_SIZE, "details": {"family": "Hy-MT2", "quantization_level": "Q6_K", "format": "GGUF"}}]
        if not ready and executable is None:
            result["warning"] = "尚未安装 llama.cpp 运行时"
        elif not ready and not result["model"]["verified"]:
            result["warning"] = "尚未下载或校验 Hy-MT2-7B Q6_K 模型"
        return result