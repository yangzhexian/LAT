from __future__ import annotations

import json
import os
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Settings:
    """Runtime settings; environment variables take precedence over JSON."""

    host: str = "127.0.0.1"
    port: int = 8787
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_executable: str = ""
    model_name: str = "hy-mt2-7b:q6_k"
    model_aliases: tuple[str, ...] = ("hy-mt2-7b:q6_k", "hy-mt2-7b-q6_k")
    # Empty means: let the installed Ollama service use its own model store.
    # Development setups can override this with translator.config.json or
    # OLLAMA_MODELS without baking a machine-specific path into the app.
    model_dir: str = ""
    auto_start_ollama: bool = True
    unload_on_exit: bool = True
    keep_alive: str = "10m"
    request_timeout_seconds: float = 600.0
    max_input_chars: int = 16000
    max_output_tokens: int = 4096
    num_ctx: int = 8192
    temperature: float = 0.2
    top_p: float = 0.6
    top_k: int = 20
    repetition_penalty: float = 1.05
    seed: int = 42
    default_target_language: str = ""
    retry_on_bad_output: bool = True
    log_file: str = str(PROJECT_ROOT / ".ollama-runtime" / "translator.log")

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
        values = {key: value for key, value in values.items() if key in allowed}
        settings = cls(**values)
        settings.apply_environment()
        return settings

    def apply_environment(self) -> None:
        mapping = {
            "host": ("LLM_TRANSLATOR_HOST", str),
            "port": ("LLM_TRANSLATOR_PORT", int),
            "ollama_url": ("OLLAMA_TRANSLATOR_URL", str),
            "ollama_executable": ("OLLAMA_EXE", str),
            "model_name": ("OLLAMA_TRANSLATOR_MODEL", str),
            "model_dir": ("OLLAMA_MODELS", str),
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

        aliases = os.environ.get("OLLAMA_TRANSLATOR_MODEL_ALIASES")
        if aliases:
            self.model_aliases = tuple(item.strip() for item in aliases.split(",") if item.strip())

        for attribute, name in (
            ("auto_start_ollama", "LLM_TRANSLATOR_AUTO_START"),
            ("unload_on_exit", "LLM_TRANSLATOR_UNLOAD_ON_EXIT"),
            ("retry_on_bad_output", "LLM_TRANSLATOR_RETRY_ON_BAD_OUTPUT"),
        ):
            raw = os.environ.get(name)
            if raw is not None:
                setattr(self, attribute, raw.strip().lower() not in {"0", "false", "no", "off"})

    @property
    def resolved_model_dir(self) -> Path:
        return (Path(self.model_dir).expanduser() if self.model_dir else PROJECT_ROOT).resolve()

    @property
    def resolved_log_file(self) -> Path:
        return Path(self.log_file).expanduser().resolve()
