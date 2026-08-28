from __future__ import annotations

import csv
import subprocess
from typing import Any

from .catalog import MODEL_ID, MODEL_VARIANTS, get_model_variant, model_options


# These are conservative total-VRAM thresholds. They include the GGUF weights,
# llama.cpp buffers and a normal translation context rather than free VRAM.
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


def _recommended_variant(total_vram_gib: float | None):
    if total_vram_gib is None:
        return get_model_variant("hy-mt2-1.8b:q4_k_m")
    fitting = [
        variant
        for variant in MODEL_VARIANTS
        if total_vram_gib >= variant.recommended_vram_gib
    ]
    return max(fitting or list(MODEL_VARIANTS), key=lambda variant: variant.quality_rank)


def inspect_download_environment(model: str = MODEL_ID) -> dict[str, Any]:
    selected = get_model_variant(model)
    gpus = detect_nvidia_gpus()
    best_gpu = max(gpus, key=lambda item: float(item.get("total_vram_gib", 0))) if gpus else None
    total = float(best_gpu["total_vram_gib"]) if best_gpu else None
    recommended = _recommended_variant(total)
    options = model_options()
    for option in options:
        option["recommended"] = option["id"] == recommended.id
        option["fits_total_vram"] = total is None or total >= float(option["recommended_vram_gib"])

    result: dict[str, Any] = {
        "model": selected.id,
        "recommended_model": recommended.id,
        "recommended_vram_gib": selected.recommended_vram_gib,
        "required_vram_gib": selected.recommended_vram_gib,
        "gpus": gpus,
        "models": options,
        "best_gpu": best_gpu,
        "status": "ready",
        "message": f"{selected.label} 建议总显存 {selected.recommended_vram_gib:.0f} GiB",
        "suggestion": f"推荐下载 {recommended.label} · {recommended.benchmark}",
    }
    if not gpus:
        result.update(
            {
                "status": "unknown",
                "message": "未检测到 NVIDIA GPU 总显存信息",
                "suggestion": f"建议优先选择 {recommended.label} 并确认显卡驱动可用",
            }
        )
        return result

    if total < selected.recommended_vram_gib:
        result.update(
            {
                "status": "insufficient",
                "message": f"{best_gpu['name']} 总显存 {total:.2f} GiB 低于 {selected.label} 的建议值 {selected.recommended_vram_gib:.0f} GiB",
                "suggestion": f"建议改用 {recommended.label} · {recommended.benchmark}",
            }
        )
    elif selected.id == recommended.id:
        result["message"] = f"{best_gpu['name']} 总显存 {total:.2f} GiB 适合 {selected.label}"
    else:
        result["message"] = f"{best_gpu['name']} 总显存 {total:.2f} GiB 满足 {selected.label}"
    return result