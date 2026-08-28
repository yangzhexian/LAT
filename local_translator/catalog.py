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


MODEL_ASSETS = (
    DownloadAsset(
        MODEL_FILENAME,
        "https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main/HY-MT2-7B-Q6_K.gguf?download=true",
        MODEL_SHA256,
        MODEL_SIZE,
    ),
    DownloadAsset(
        MODEL_FILENAME,
        "https://hf-mirror.com/tencent/Hy-MT2-7B-GGUF/resolve/main/HY-MT2-7B-Q6_K.gguf?download=true",
        MODEL_SHA256,
        MODEL_SIZE,
    ),
)

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
