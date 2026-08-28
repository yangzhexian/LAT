from __future__ import annotations

import csv
import subprocess
from typing import Any

from .catalog import MODEL_ID

REQUIRED_VRAM_GIB = 10.0


def _number(value: str) -> float | None:
    try:
        return float(value.strip())
    except (TypeError, ValueError):
        return None


def detect_nvidia_gpus() -> list[dict[str, Any]]:
    """Read total NVIDIA GPU memory without opening a console window on Windows."""
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            creationflags=creationflags,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return []

    if result.returncode != 0:
        return []

    gpus: list[dict[str, Any]] = []
    for row in csv.reader(result.stdout.splitlines()):
        if len(row) < 2:
            continue
        total_mib = _number(row[1])
        if total_mib is None:
            continue
        gpus.append(
            {
                "name": row[0].strip() or "NVIDIA GPU",
                "total_vram_gib": round(total_mib / 1024, 2),
            }
        )
    return gpus


def inspect_download_environment(model: str = MODEL_ID) -> dict[str, Any]:
    gpus = detect_nvidia_gpus()
    result: dict[str, Any] = {
        "model": model,
        "recommended_vram_gib": REQUIRED_VRAM_GIB,
        "required_vram_gib": REQUIRED_VRAM_GIB,
        "gpus": gpus,
        "status": "ready",
        "message": "GPU 总显存满足 Hy-MT2 Q6_K 的建议配置",
        "suggestion": "",
    }
    if not gpus:
        result.update(
            {
                "status": "unknown",
                "message": "未检测到 NVIDIA GPU 总显存信息",
                "suggestion": "请确认 NVIDIA 驱动和 nvidia-smi 可用 或改用更小模型",
            }
        )
        return result

    gpu = max(gpus, key=lambda item: float(item.get("total_vram_gib", 0)))
    total = float(gpu["total_vram_gib"])
    result["best_gpu"] = gpu
    if total < REQUIRED_VRAM_GIB:
        result.update(
            {
                "status": "insufficient",
                "message": f"{gpu['name']} 总显存 {total:.2f} GiB 低于建议值 {REQUIRED_VRAM_GIB:.0f} GiB",
                "suggestion": "建议改用 Hy-MT2-1.8B 或更低量化模型",
            }
        )
    return result
