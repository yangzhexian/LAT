from __future__ import annotations

import logging
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Iterator

from .catalog import MODEL_VARIANTS, RUNTIME_ASSETS, DownloadAsset, ModelVariant, get_model_variant
from .config import Settings
from .downloader import AssetDownloader
from .errors import DownloadCancelled, LlamaError
from .llama_client import LlamaServerClient
from .version import __version__


LOGGER = logging.getLogger(__name__)


class LlamaCppProcessManager:
    """Install and manage the llama-server process owned by LAT."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.owned_process: subprocess.Popen[Any] | None = None
        self.server_port: int | None = None
        self.client: LlamaServerClient | None = None
        self.download_lock = threading.Lock()
        self.downloader = AssetDownloader(f"LAT/{__version__}")
        self._remember_data_root(settings.resolved_data_root)

    def set_data_root(self, root: str) -> dict[str, Any]:
        path = Path(root).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        self.shutdown()
        self.settings.runtime_root = str(path)
        self.settings.model_dir = ""
        self._remember_data_root(path)
        return self.status()

    @staticmethod
    def _remember_data_root(path: Path) -> None:
        if os.name != "nt":
            return
        try:
            import winreg

            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\LAT") as key:
                winreg.SetValueEx(key, "DataRoot", 0, winreg.REG_SZ, str(path))
        except (ImportError, OSError):
            LOGGER.debug("unable to persist LAT data root", exc_info=True)

    def cancel_download(self) -> None:
        self.downloader.cancel()

    @property
    def runtime_assets(self) -> tuple[DownloadAsset, ...]:
        assets = RUNTIME_ASSETS.get(self.settings.llama_runtime_variant)
        if assets is None:
            raise LlamaError(f"不支持的 llama.cpp 运行时版本: {self.settings.llama_runtime_variant}")
        return assets

    def _server_executable(self) -> Path | None:
        root = self.settings.resolved_runtime_dir
        if not root.exists():
            return None
        direct = root / "llama-server.exe"
        if direct.exists():
            return direct
        return next(iter(root.rglob("llama-server.exe")), None)

    def _verified(self, path: Path, expected_size: int | None, expected_sha256: str) -> bool:
        return self.downloader.is_verified(path, expected_size, expected_sha256)

    def _download_asset(
        self,
        asset: DownloadAsset,
        destination: Path,
        phase: str,
        file_index: int | None = None,
        file_count: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        yield from self.downloader.download(asset, destination, phase, file_index, file_count)

    def _download_model(
        self,
        destination: Path,
        file_index: int,
        file_count: int,
        variant: ModelVariant | None = None,
    ) -> Iterator[dict[str, Any]]:
        selected = variant or get_model_variant(self.settings.model_name)
        assets = selected.assets
        last_error: LlamaError | None = None
        for source_index, asset in enumerate(assets):
            try:
                yield from self._download_asset(asset, destination, "model", file_index, file_count)
                return
            except DownloadCancelled:
                raise
            except LlamaError as error:
                last_error = error
                if source_index >= len(assets) - 1:
                    raise
                destination.with_suffix(destination.suffix + ".part").unlink(missing_ok=True)
                LOGGER.warning(
                    "model source failed, switching source %s/%s: %s",
                    source_index + 1,
                    len(assets),
                    error,
                )
                yield {
                    "type": "download",
                    "phase": "model",
                    "status": "switching_source",
                    "percent": 0.0,
                    "completed_bytes": 0,
                    "total_bytes": selected.size,
                    "file_index": file_index,
                    "file_count": file_count,
                    "file_name": selected.filename,
                    "message": f"当前下载源不可用 正在切换备用源 {source_index + 2}/{len(assets)}",
                }
        if last_error is not None:
            raise last_error
        raise LlamaError("没有可用的模型下载源")

    def _extract_runtime(self, archives: list[Path]) -> None:
        stage = Path(tempfile.mkdtemp(prefix="lat-llama-", dir=str(self.settings.resolved_data_root)))
        try:
            stage_root = stage.resolve()
            for archive in archives:
                with zipfile.ZipFile(archive) as bundle:
                    for item in bundle.infolist():
                        target = (stage / item.filename).resolve()
                        try:
                            safe = os.path.commonpath([str(stage_root), str(target)]) == str(stage_root)
                        except ValueError:
                            safe = False
                        if not safe:
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

    def install_stream(self, model: str | None = None) -> Iterator[dict[str, Any]]:
        if not self.download_lock.acquire(blocking=False):
            raise LlamaError("已有下载任务正在运行")
        selected = get_model_variant(model or self.settings.model_name)
        self.settings.model_name = selected.id
        self.downloader.reset()
        try:
            self.settings.resolved_data_root.mkdir(parents=True, exist_ok=True)
            assets = self.runtime_assets
            file_count = len(assets) + 1
            if self._server_executable() is None:
                archives: list[Path] = []
                for index, asset in enumerate(assets, start=1):
                    archive = self.settings.resolved_data_root / "downloads" / f"{asset.name}.zip"
                    archives.append(archive)
                    yield from self._download_asset(asset, archive, "runtime", index, file_count)
                self._extract_runtime(archives)
                yield {
                    "type": "download",
                    "phase": "runtime",
                    "status": "installed",
                    "percent": 100.0,
                    "file_index": len(assets),
                    "file_count": file_count,
                    "file_name": "llama.cpp runtime",
                }
            else:
                yield {
                    "type": "download",
                    "phase": "runtime",
                    "status": "already_present",
                    "percent": 100.0,
                    "file_index": len(assets),
                    "file_count": file_count,
                    "file_name": "llama.cpp runtime",
                }

            model_path = self.settings.resolved_model_path
            yield from self._download_model(model_path, file_count, file_count, selected)
            if not self._verified(model_path, selected.size, selected.sha256):
                raise LlamaError("模型下载完成但校验未通过")
            yield {
                "type": "download",
                "phase": "model",
                "status": "installed",
                "percent": 100.0,
                "file_index": file_count,
                "file_count": file_count,
                "file_name": selected.filename,
            }
            yield {
                "type": "download",
                "phase": "model",
                "status": "complete",
                "percent": 100.0,
                "file_index": file_count,
                "file_count": file_count,
                "file_name": selected.filename,
                "message": "全部文件下载并校验完成",
            }
        finally:
            self.download_lock.release()

    @staticmethod
    def _choose_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return int(sock.getsockname()[1])

    def ensure_server(self) -> LlamaServerClient:
        if (
            self.owned_process is not None
            and self.owned_process.poll() is None
            and self.client is not None
            and self.client.is_ready()
        ):
            return self.client
        selected = get_model_variant(self.settings.model_name)
        executable = self._server_executable()
        model_path = self.settings.resolved_model_path
        if executable is None:
            raise LlamaError("尚未安装 llama.cpp 运行时 请先在启动界面安装")
        if not self._verified(model_path, selected.size, selected.sha256):
            raise LlamaError(f"尚未安装或校验 {selected.label} 模型")
        self.settings.resolved_log_file.parent.mkdir(parents=True, exist_ok=True)
        port = self._choose_port()
        log_handle = self.settings.resolved_log_file.open("ab")
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        command = [
            str(executable),
            "-m",
            str(model_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--jinja",
            "-ngl",
            "999",
            "-c",
            str(self.settings.num_ctx),
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
                exit_code = process.returncode
                self.shutdown()
                raise LlamaError(f"llama.cpp 启动失败 退出码 {exit_code} 请查看 {self.settings.resolved_log_file}")
            time.sleep(0.25)
        self.shutdown()
        raise LlamaError(f"llama.cpp 启动超时 请查看 {self.settings.resolved_log_file}")

    def shutdown(self) -> None:
        self.cancel_download()
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
        selected = get_model_variant(self.settings.model_name)
        executable = self._server_executable()
        model = self.settings.resolved_model_path
        process_running = self.owned_process is not None and self.owned_process.poll() is None
        ready = bool(self.client and process_running and self.client.is_ready())
        model_verified = self._verified(model, selected.size, selected.sha256)
        models: list[dict[str, Any]] = []
        for variant in MODEL_VARIANTS:
            path = self.settings.resolved_model_dir / variant.filename
            if not self._verified(path, variant.size, variant.sha256):
                continue
            models.append(
                {
                    "name": variant.id,
                    "model": variant.id,
                    "size": variant.size,
                    "details": {
                        "family": "Hy-MT2",
                        "parameter_size": variant.parameter_size,
                        "quantization_level": variant.quantization,
                        "format": "GGUF",
                    },
                }
            )
        active = next((item for item in models if item["name"] == selected.id), None)
        result: dict[str, Any] = {
            "backend": "llama.cpp",
            "ready": ready,
            "owned_process": process_running,
            "model_configured": selected.id,
            "active_model": selected.id if ready else None,
            "resolved_model": selected.id,
            "version": self.settings.llama_release,
            "runtime": {
                "installed": executable is not None,
                "verified": executable is not None,
                "variant": self.settings.llama_runtime_variant,
                "root_dir": str(self.settings.resolved_data_root),
            },
            "model": {
                "installed": model_verified,
                "verified": model_verified,
                "path": str(model),
                "size_bytes": selected.size,
            },
            "models": models,
            "running_models": [active] if ready and active else [],
        }
        if not ready and executable is None:
            result["warning"] = "尚未安装 llama.cpp 运行时"
        elif not ready and not model_verified:
            result["warning"] = f"尚未下载或校验 {selected.label} 模型"
        return result
