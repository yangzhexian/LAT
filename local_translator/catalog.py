from __future__ import annotations

from dataclasses import dataclass


MODEL_ID = "hy-mt2-7b:q6_k"
MODEL_FILENAME = "HY-MT2-7B-Q6_K.gguf"
MODEL_SIZE = 6_164_482_720
MODEL_SHA256 = "88ef0aba59952a4cfe4be36cb5baf797dbb370bc60e9dcbd7297036021e52831"


@dataclass(frozen=True)
class DownloadAsset:
    name: str
    url: str
    sha256: str
    size: int | None = None


@dataclass(frozen=True)
class ModelVariant:
    """A directly deployable Hy-MT2 GGUF variant."""

    id: str
    label: str
    parameter_size: str
    quantization: str
    filename: str
    size: int
    sha256: str
    recommended_vram_gib: float
    quality_rank: int
    repo: str

    @property
    def assets(self) -> tuple[DownloadAsset, ...]:
        return (
            DownloadAsset(
                self.filename,
                f"https://hf-mirror.com/{self.repo}/resolve/main/{self.filename}?download=true",
                self.sha256,
                self.size,
            ),
            DownloadAsset(
                self.filename,
                f"https://huggingface.co/{self.repo}/resolve/main/{self.filename}?download=true",
                self.sha256,
                self.size,
            ),
        )


MODEL_VARIANTS: tuple[ModelVariant, ...] = (
    ModelVariant(
        "hy-mt2-1.8b:q4_k_m",
        "Hy-MT2 1.8B · Q4_K_M",
        "1.8B",
        "Q4_K_M",
        "Hy-MT2-1.8B-Q4_K_M.gguf",
        1_133_080_448,
        "dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699",
        4.0,
        70,
        "tencent/Hy-MT2-1.8B-GGUF",
    ),
    ModelVariant(
        "hy-mt2-1.8b:q6_k",
        "Hy-MT2 1.8B · Q6_K",
        "1.8B",
        "Q6_K",
        "Hy-MT2-1.8B-Q6_K.gguf",
        1_474_785_120,
        "d98fe604dec1f28f58f80d7d560f7177e584d3b8e5835862687660e5ff97cb40",
        4.0,
        74,
        "tencent/Hy-MT2-1.8B-GGUF",
    ),
    ModelVariant(
        "hy-mt2-1.8b:q8_0",
        "Hy-MT2 1.8B · Q8_0",
        "1.8B",
        "Q8_0",
        "Hy-MT2-1.8B-Q8_0.gguf",
        1_908_528_192,
        "5c3fe0b1408a5ceb0143184ef247b11b579c525f4b02b060e6c851bb76fef1a4",
        5.0,
        78,
        "tencent/Hy-MT2-1.8B-GGUF",
    ),
    ModelVariant(
        "hy-mt2-1.8b:2bit",
        "Hy-MT2 1.8B · 2-bit",
        "1.8B",
        "2-bit",
        "Hy-MT2-1.8B-2Bit.gguf",
        600_534_880,
        "dcc33bbae9b28d923c8c76a64f6157840841d26f8774f3dfd770d5fabeeb1cd7",
        2.0,
        55,
        "tencent/Hy-MT2-1.8B-2Bit-GGUF",
    ),
    ModelVariant(
        "hy-mt2-1.8b:1.25bit",
        "Hy-MT2 1.8B · 1.25-bit",
        "1.8B",
        "1.25-bit",
        "Hy-MT2-1.8B-1.25Bit.gguf",
        461_860_800,
        "cc497fe8f033b52b3b8b00a7669e9661435432f9d4cd43f7ed24400c01507a93",
        2.0,
        45,
        "tencent/Hy-MT2-1.8B-1.25Bit-GGUF",
    ),
    ModelVariant(
        "hy-mt2-7b:q4_k_m",
        "Hy-MT2 7B · Q4_K_M",
        "7B",
        "Q4_K_M",
        "Hy-MT2-7B-Q4_K_M.gguf",
        4_624_648_896,
        "9f96256500f3fc1ab4d64336b58f52a949a95ad7516b0c229476eef782f9f77b",
        8.0,
        88,
        "tencent/Hy-MT2-7B-GGUF",
    ),
    ModelVariant(
        "hy-mt2-7b:q6_k",
        "Hy-MT2 7B · Q6_K",
        "7B",
        "Q6_K",
        "HY-MT2-7B-Q6_K.gguf",
        MODEL_SIZE,
        MODEL_SHA256,
        10.0,
        94,
        "tencent/Hy-MT2-7B-GGUF",
    ),
    ModelVariant(
        "hy-mt2-7b:q8_0",
        "Hy-MT2 7B · Q8_0",
        "7B",
        "Q8_0",
        "HY-MT2-7B-Q8_0.gguf",
        7_981_928_896,
        "58b3ad55dd6f6fa08c695cddc34fb5f8f708a844f78ae10508071914b0ed67c0",
        13.0,
        100,
        "tencent/Hy-MT2-7B-GGUF",
    ),
)

MODEL_CATALOG = {variant.id: variant for variant in MODEL_VARIANTS}


def get_model_variant(model_id: str | None = None) -> ModelVariant:
    return MODEL_CATALOG.get(model_id or MODEL_ID, MODEL_CATALOG[MODEL_ID])


def model_options() -> list[dict[str, object]]:
    return [
        {
            "id": variant.id,
            "label": variant.label,
            "parameter_size": variant.parameter_size,
            "quantization": variant.quantization,
            "filename": variant.filename,
            "size_bytes": variant.size,
            "size_gib": round(variant.size / (1024**3), 2),
            "recommended_vram_gib": variant.recommended_vram_gib,
            "quality_rank": variant.quality_rank,
        }
        for variant in MODEL_VARIANTS
    ]


# Backward-compatible exports for callers that still refer to the default model.
MODEL_ASSETS = get_model_variant(MODEL_ID).assets

RUNTIME_ASSETS: dict[str, tuple[DownloadAsset, ...]] = {
    "cuda-13.3": (
        DownloadAsset(
            "llama-server",
            "https://github.com/ggml-org/llama.cpp/releases/download/b10545/llama-b10545-bin-win-cuda-13.3-x64.zip",
            "59e053f64837d6da766708272f6b814ddcf8286acf39e3a4632fcc535a3fa1b5",
        ),
        DownloadAsset(
            "cuda-runtime",
            "https://github.com/ggml-org/llama.cpp/releases/download/b10545/cudart-llama-bin-win-cuda-13.3-x64.zip",
            "1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e",
        ),
    ),
    "cuda-12.4": (
        DownloadAsset(
            "llama-server",
            "https://github.com/ggml-org/llama.cpp/releases/download/b10545/llama-b10545-bin-win-cuda-12.4-x64.zip",
            "7caaceb18f9b3af89ff06482f6142c68d2fe384e1f55a352a129fdeb41529121",
        ),
        DownloadAsset(
            "cuda-runtime",
            "https://github.com/ggml-org/llama.cpp/releases/download/b10545/cudart-llama-bin-win-cuda-12.4-x64.zip",
            "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
        ),
    ),
}
