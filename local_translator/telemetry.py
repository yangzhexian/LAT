"""Bounded, cached local NVIDIA telemetry. Values describe whole GPUs."""
from __future__ import annotations

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

    def sample(self) -> dict[str, Any]:
        with self._lock:
            if time.monotonic() - self._updated < 1:
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
