from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]


@dataclass
class Settings:
    """Runtime settings; environment variables take precedence over JSON."""

    host: str = "127.0.0.1"
    port: int = 8787
    model_name: str = "hy-mt2-7b:q6_k"
    model_dir: str = ""
    runtime_root: str = ""
    llama_runtime_variant: str = "cuda-13.3"
    llama_release: str = "b10545"
    unload_on_exit: bool = True
    keep_alive: str = "10m"
    request_timeout_seconds: float = 600.0
    max_input_chars: int = 16000
    max_output_tokens: int = 4096
    num_ctx: int = 8192
    temperature: float = 0.7
    top_p: float = 0.6
    top_k: int = 20
    repetition_penalty: float = 1.05
    seed: int = 42
    default_target_language: str = ""
    retry_on_bad_output: bool = True
    log_file: str = str(PROJECT_ROOT / ".lat-runtime" / "translator.log")

    @classmethod
    def from_file(cls, path: str | Path | None = None) -> "Settings":
        config_path = Path(path) if path else PROJECT_ROOT / "translator.config.json"
        values: dict[str, Any] = {}
        if config_path.exists():
            with config_path.open("r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if not isinstance(loaded, dict):
                raise ValueError(f"配置文件必须是 JSON 对象: {config_path}")
            values.update(loaded)

        allowed = {field.name for field in fields(cls)}
        settings = cls(**{key: value for key, value in values.items() if key in allowed})
        settings.apply_environment()
        return settings

    def apply_environment(self) -> None:
        mapping = {
            "host": ("LLM_TRANSLATOR_HOST", str),
            "port": ("LLM_TRANSLATOR_PORT", int),
            "model_name": ("LAT_MODEL_NAME", str),
            "model_dir": ("LAT_MODEL_DIR", str),
            "runtime_root": ("LAT_RUNTIME_ROOT", str),
            "llama_runtime_variant": ("LAT_LLAMA_RUNTIME_VARIANT", str),
            "llama_release": ("LAT_LLAMA_RELEASE", str),
            "keep_alive": ("LLM_TRANSLATOR_KEEP_ALIVE", str),
            "request_timeout_seconds": ("LLM_TRANSLATOR_TIMEOUT", float),
            "max_input_chars": ("LLM_TRANSLATOR_MAX_INPUT_CHARS", int),
            "max_output_tokens": ("LLM_TRANSLATOR_MAX_OUTPUT_TOKENS", int),
            "num_ctx": ("LLM_TRANSLATOR_NUM_CTX", int),
            "temperature": ("LLM_TRANSLATOR_TEMPERATURE", float),
            "top_p": ("LLM_TRANSLATOR_TOP_P", float),
            "top_k": ("LLM_TRANSLATOR_TOP_K", int),
            "repetition_penalty": ("LLM_TRANSLATOR_REPETITION_PENALTY", float),
            "seed": ("LLM_TRANSLATOR_SEED", int),
            "default_target_language": ("LLM_TRANSLATOR_DEFAULT_TARGET", str),
        }
        for attribute, (name, converter) in mapping.items():
            raw = os.environ.get(name)
            if raw is not None and raw != "":
                setattr(self, attribute, converter(raw))

        for attribute, name in (
            ("unload_on_exit", "LLM_TRANSLATOR_UNLOAD_ON_EXIT"),
            ("retry_on_bad_output", "LLM_TRANSLATOR_RETRY_ON_BAD_OUTPUT"),
        ):
            raw = os.environ.get(name)
            if raw is not None:
                setattr(self, attribute, raw.strip().lower() not in {"0", "false", "no", "off"})

    @property
    def resolved_data_root(self) -> Path:
        return (Path(self.runtime_root).expanduser() if self.runtime_root else PROJECT_ROOT / ".lat-runtime").resolve()

    @property
    def resolved_model_dir(self) -> Path:
        if self.model_dir:
            return Path(self.model_dir).expanduser().resolve()
        return self.resolved_data_root / "models"

    @property
    def resolved_runtime_dir(self) -> Path:
        return self.resolved_data_root / "runtime" / "llama.cpp" / self.llama_release

    @property
    def resolved_model_path(self) -> Path:
        return self.resolved_model_dir / "HY-MT2-7B-Q6_K.gguf"

    @property
    def resolved_log_file(self) -> Path:
        if self.log_file == str(PROJECT_ROOT / ".lat-runtime" / "translator.log"):
            return self.resolved_data_root / "logs" / "translator.log"
        return Path(self.log_file).expanduser().resolve()