"""Bounded, cached local NVIDIA telemetry. Values describe whole GPUs."""
from __future__ import annotations

from collections import deque
import math
import threading
import time
from typing import Any
from uuid import uuid4

from .gpu_provider import GpuProvider


class GpuTelemetry:
    def __init__(self):
        self._provider = GpuProvider()
        self._session_id = str(uuid4())
        self._lock = threading.Lock()
        self._updated = float('-inf')
        self._sample: dict[str, Any] = {}
        self._history: deque[dict[str, Any]] = deque(maxlen=601)
        self._state_lock = threading.Lock()
        self._interval = 2.0
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def session_id(self) -> str:
        return self._session_id

    def configure(self, interval: float) -> None:
        if isinstance(interval, bool) or interval not in (0.5, 1, 2, 5):
            raise ValueError("刷新间隔必须为 0.5、1、2 或 5 秒")
        with self._state_lock:
            self._interval = float(interval)
        self._wake.set()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._collect, name="lat-gpu-telemetry", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
        if self._thread is None or not self._thread.is_alive():
            with self._lock:
                self._provider.close()
                self._updated = float("-inf")

    def _record(self, sample: dict[str, Any]) -> None:
        with self._state_lock:
            if not self._history or sample["timestamp"] > self._history[-1]["timestamp"]:
                self._history.append(sample)
            cutoff = sample["timestamp"] - 300
            while self._history and self._history[0]["timestamp"] < cutoff:
                self._history.popleft()

    def snapshot(self, since: float | None = None) -> dict[str, Any]:
        if since is not None and (isinstance(since, bool) or not isinstance(since, (int, float)) or not math.isfinite(since) or since < 0):
            raise ValueError("采样游标必须是非负有限时间戳")
        with self._state_lock:
            now = time.time()
            samples = [sample for sample in self._history if sample["timestamp"] >= now - 300]
            latest = samples[-1] if samples else {"timestamp": now, "gpus": [], "message": "正在读取显卡…",
                                                  "provider": None, "provider_status": "starting", "provider_message": "", "provider_interval": None}
            cursor = samples[-1]["timestamp"] if samples else None
            reset = since is not None and (cursor is None or since > cursor)
            selected = samples if since is None or reset else [sample for sample in samples if sample["timestamp"] > since]
            return {**latest, "samples": selected, "interval": self._interval,
                    "session_id": self._session_id, "cursor": cursor, "reset": reset}

    def _collect(self) -> None:
        try:
            while not self._stop.is_set():
                self._wake.clear()
                started = time.monotonic()
                self._record(self.sample(force=True))
                with self._state_lock:
                    interval = self._interval
                self._wake.wait(max(0.01, interval - (time.monotonic() - started)))
        finally:
            # Cleanup occurs on the collector even if a native read outlasts stop's join.
            with self._lock:
                self._provider.close()
                self._updated = float("-inf")

    def sample(self, *, force: bool = False) -> dict[str, Any]:
        with self._lock:
            if not force and time.monotonic() - self._updated < 0.4:
                return self._sample
            self._sample = self._provider.read()
            self._updated = time.monotonic()
            return self._sample
