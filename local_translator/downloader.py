from __future__ import annotations

import hashlib
import logging
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterator

from .catalog import DownloadAsset
from .errors import ChecksumMismatch, DownloadCancelled, LlamaError


LOGGER = logging.getLogger(__name__)
MAX_RETRIES = 5


class AssetDownloader:
    """Download, resume and verify one release asset at a time."""

    def __init__(self, user_agent: str):
        self.user_agent = user_agent
        self.cancel_event = threading.Event()
        self._response: Any | None = None

    def reset(self) -> None:
        self.cancel_event.clear()

    def cancel(self) -> None:
        self.cancel_event.set()
        response = self._response
        if response is not None:
            try:
                response.close()
            except (OSError, ValueError):
                pass

    @staticmethod
    def sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def is_verified(path: Path, expected_size: int | None, expected_sha256: str) -> bool:
        if not path.exists() or (expected_size is not None and path.stat().st_size != expected_size):
            return False
        marker = path.with_suffix(path.suffix + ".sha256")
        return marker.exists() and marker.read_text(encoding="utf-8").strip().lower() == expected_sha256.lower()

    def download(
        self,
        asset: DownloadAsset,
        destination: Path,
        phase: str,
        file_index: int | None = None,
        file_count: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        destination.parent.mkdir(parents=True, exist_ok=True)
        metadata = {
            "file_index": file_index,
            "file_count": file_count,
            "file_name": asset.name,
        }

        def emit(status: str, **values: Any) -> dict[str, Any]:
            return {"type": "download", "phase": phase, "status": status, **metadata, **values}

        if self.is_verified(destination, asset.size, asset.sha256):
            size = destination.stat().st_size
            yield emit(
                "already_present",
                percent=100.0,
                completed_bytes=size,
                total_bytes=size,
                speed_bytes_per_second=0.0,
                speed_mib_per_second=0.0,
            )
            return
        if self.cancel_event.is_set():
            raise DownloadCancelled("下载已取消")

        partial = destination.with_suffix(destination.suffix + ".part")
        total_bytes = asset.size
        retry_count = 0
        while True:
            if self.cancel_event.is_set():
                raise DownloadCancelled("下载已取消")
            current = partial.stat().st_size if partial.exists() else 0
            headers = {"User-Agent": self.user_agent}
            if current:
                headers["Range"] = f"bytes={current}-"
            request = urllib.request.Request(asset.url, headers=headers)
            attempt_started = time.monotonic()
            try:
                response = urllib.request.urlopen(request, timeout=30.0)
                status_code = getattr(response, "status", 200)
                if current and status_code != 206:
                    current = 0
                    partial.unlink(missing_ok=True)
                mode = "ab" if current else "wb"
                if total_bytes is None:
                    try:
                        content_length = int(response.headers.get("Content-Length", "0"))
                    except (TypeError, ValueError):
                        content_length = 0
                    if content_length:
                        total_bytes = content_length + current

                self._response = response
                completed = current
                try:
                    with response, partial.open(mode) as handle:
                        yield emit(
                            "connecting",
                            percent=round(completed * 100 / total_bytes, 1) if total_bytes else 0.0,
                            completed_bytes=completed,
                            total_bytes=total_bytes,
                            speed_bytes_per_second=0.0,
                            speed_mib_per_second=0.0,
                            retry_count=retry_count,
                        )
                        while True:
                            if self.cancel_event.is_set():
                                raise DownloadCancelled("下载已取消 已保留已下载内容")
                            try:
                                chunk = response.read(1024 * 1024)
                            except (TimeoutError, socket.timeout, urllib.error.URLError, OSError, ValueError) as error:
                                if self.cancel_event.is_set():
                                    raise DownloadCancelled("下载已取消 已保留已下载内容") from error
                                raise LlamaError(f"下载 {asset.name} 响应中断: {error}") from error
                            if not chunk:
                                break
                            handle.write(chunk)
                            completed += len(chunk)
                            elapsed = max(time.monotonic() - attempt_started, 0.001)
                            speed = (completed - current) / elapsed
                            percent = min(100.0, completed * 100 / total_bytes) if total_bytes else 0.0
                            yield emit(
                                "downloading",
                                percent=round(percent, 1),
                                completed_bytes=completed,
                                total_bytes=total_bytes,
                                speed_bytes_per_second=round(speed, 1),
                                speed_mib_per_second=round(speed / (1024 * 1024), 3),
                                retry_count=retry_count,
                            )
                finally:
                    self._response = None

                if self.cancel_event.is_set():
                    raise DownloadCancelled("下载已取消 已保留已下载内容")
                completed = partial.stat().st_size
                if asset.size is not None and completed != asset.size:
                    raise LlamaError(f"下载提前结束 {completed}/{asset.size} bytes")
                if total_bytes is not None and completed < total_bytes:
                    raise LlamaError(f"下载提前结束 {completed}/{total_bytes} bytes")
                digest = self.sha256(partial)
                if digest.lower() != asset.sha256.lower():
                    partial.unlink(missing_ok=True)
                    raise ChecksumMismatch("SHA-256 校验失败 已删除不完整的临时文件")
                os.replace(partial, destination)
                destination.with_suffix(destination.suffix + ".sha256").write_text(asset.sha256, encoding="utf-8")
                elapsed = max(time.monotonic() - attempt_started, 0.001)
                transferred = max(0, completed - current)
                speed = transferred / elapsed
                yield emit(
                    "verified",
                    percent=100.0,
                    completed_bytes=completed,
                    total_bytes=total_bytes or completed,
                    speed_bytes_per_second=round(speed, 1),
                    speed_mib_per_second=round(speed / (1024 * 1024), 3),
                    sha256=digest,
                    retry_count=retry_count,
                )
                return
            except DownloadCancelled:
                self._response = None
                raise
            except ChecksumMismatch:
                self._response = None
                raise
            except urllib.error.HTTPError as error:
                self._response = None
                if error.code < 500:
                    raise LlamaError(f"下载 {asset.name} 失败 HTTP {error.code}") from error
                failure: Exception = error
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, LlamaError) as error:
                self._response = None
                failure = error

            current = partial.stat().st_size if partial.exists() else 0
            if retry_count >= MAX_RETRIES:
                raise LlamaError(f"下载 {asset.name} 失败 已重试 {retry_count} 次: {failure}") from failure
            retry_count += 1
            delay = min(8.0, 1.5 * (2 ** (retry_count - 1)))
            LOGGER.warning(
                "download %s interrupted, retry %s/%s in %.1fs: %s",
                asset.name,
                retry_count,
                MAX_RETRIES,
                delay,
                failure,
            )
            yield emit(
                "retrying",
                percent=round(current * 100 / total_bytes, 1) if total_bytes else 0.0,
                completed_bytes=current,
                total_bytes=total_bytes,
                speed_bytes_per_second=0.0,
                speed_mib_per_second=0.0,
                retry_count=retry_count,
                message=f"网络波动 正在重试 {retry_count}/{MAX_RETRIES}",
            )
            for _ in range(max(1, round(delay * 10))):
                if self.cancel_event.is_set():
                    raise DownloadCancelled("下载已取消 已保留已下载内容")
                time.sleep(0.1)
