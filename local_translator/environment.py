from __future__ import annotations

import csv
import subprocess
from typing import Any


DOWNLOAD_MODEL = "hy-mt2-7b:q6_k"
REQUIRED_VRAM_GIB = 10.0


def _number(value: str) -> float | None:
    try:
        return float(value.strip())
    except (TypeError, ValueError):
        return None


def detect_nvidia_gpus() -> list[dict[str, Any]]:
    """Read NVIDIA GPU memory without opening a console window on Windows."""
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free",
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
        if len(row) < 3:
            continue
        total_mib = _number(row[1])
        free_mib = _number(row[2])
        if total_mib is None or free_mib is None:
            continue
        gpus.append(
            {
                "name": row[0].strip() or "NVIDIA GPU",
                "total_vram_gib": round(total_mib / 1024, 2),
                "free_vram_gib": round(free_mib / 1024, 2),
            }
        )
    return gpus


def inspect_download_environment(model: str = DOWNLOAD_MODEL) -> dict[str, Any]:
    gpus = detect_nvidia_gpus()
    result: dict[str, Any] = {
        "model": model,
        "recommended_vram_gib": REQUIRED_VRAM_GIB,
        "required_vram_gib": REQUIRED_VRAM_GIB,
        "gpus": gpus,
        "status": "ready",
        "message": "GPU 显存满足 Hy-MT2 Q6_K 的建议配置",
        "suggestion": "",
    }
    if not gpus:
        result.update(
            {
                "status": "unknown",
                "message": "未检测到 NVIDIA GPU 显存信息",
                "suggestion": "请确认 NVIDIA 驱动和 nvidia-smi 可用 或改用更小模型",
            }
        )
        return result

    gpu = max(gpus, key=lambda item: float(item.get("free_vram_gib", 0)))
    total = float(gpu["total_vram_gib"])
    free = float(gpu["free_vram_gib"])
    result["best_gpu"] = gpu
    if total < REQUIRED_VRAM_GIB:
        result.update(
            {
                "status": "insufficient",
                "message": f"{gpu['name']} 只有 {total:.2f} GiB 显存 低于建议值 {REQUIRED_VRAM_GIB:.0f} GiB",
                "suggestion": "建议改用 Hy-MT2-1.8B 或更低量化模型",
            }
        )
    elif free < REQUIRED_VRAM_GIB:
        result.update(
            {
                "status": "busy",
                "message": f"当前可用显存 {free:.2f} GiB 低于建议值 {REQUIRED_VRAM_GIB:.0f} GiB",
                "suggestion": "建议关闭占用 GPU 的程序 或改用 Hy-MT2-1.8B",
            }
        )
    return result