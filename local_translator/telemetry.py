"""Bounded, cached local NVIDIA telemetry. Values describe whole GPUs."""
from __future__ import annotations

from collections import deque
import csv
import math
import subprocess
import threading
import time
from typing import Any


def number(value: str) -> float | None:
    try:
        result = float(value.strip())
        return result if math.isfinite(result) and result >= 0 else None
    except ValueError:
        return None


class GpuTelemetry:
    def __init__(self):
        self._lock = threading.Lock()
        self._updated = float('-inf')
        self._sample: dict[str, Any] = {}
        self._history: deque[dict[str, Any]] = deque(maxlen=601)
        self._state_lock = threading.Lock()
        self._interval = 2.0
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

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

    def _record(self, sample: dict[str, Any]) -> None:
        with self._state_lock:
            if not self._history or sample["timestamp"] > self._history[-1]["timestamp"]:
                self._history.append(sample)
            cutoff = sample["timestamp"] - 300
            while self._history and self._history[0]["timestamp"] < cutoff:
                self._history.popleft()

    def snapshot(self) -> dict[str, Any]:
        with self._state_lock:
            cutoff = time.time() - 300
            samples = [sample for sample in self._history if sample["timestamp"] >= cutoff]
            latest = samples[-1] if samples else {"timestamp": time.time(), "gpus": [], "message": "正在读取显卡…"}
            return {**latest, "samples": samples, "interval": self._interval}

    def _collect(self) -> None:
        while not self._stop.is_set():
            self._wake.clear()
            started = time.monotonic()
            self._record(self.sample(force=True))
            with self._state_lock:
                interval = self._interval
            self._wake.wait(max(0.01, interval - (time.monotonic() - started)))


    def sample(self, *, force: bool = False) -> dict[str, Any]:
        with self._lock:
            if not force and time.monotonic() - self._updated < 0.4:
                return self._sample
            gpus = []
            message = ""
            try:
                result = subprocess.run([
                    "nvidia-smi",
                    "--query-gpu=uuid,name,memory.used,memory.total,utilization.gpu,power.draw,power.limit,temperature.gpu",
                    "--format=csv,noheader,nounits",
                ], capture_output=True, text=True, timeout=2, check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if result.returncode != 0:
                    message = "暂时无法读取 NVIDIA 显卡数据"
                else:
                    keys = ("memory_used_mib", "memory_total_mib", "utilization_pct", "power_w", "power_limit_w", "temperature_c")
                    for row in csv.reader(result.stdout.splitlines()):
                        if len(row) != 8:
                            continue
                        gpus.append({"id": row[0].strip(), "name": row[1].strip(),
                                     **{key: number(value) for key, value in zip(keys, row[2:])}})
            except (OSError, subprocess.TimeoutExpired):
                message = "显卡监测不可用，请检查 NVIDIA 驱动"
            self._sample = {"timestamp": time.time(), "gpus": gpus,
                            "message": message or ("" if gpus else "未检测到可监测的 NVIDIA 显卡")}
            self._updated = time.monotonic()
            return self._sample
