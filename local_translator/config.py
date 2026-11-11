from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

from .catalog import MODEL_ID, get_model_variant


PROJECT_ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]


@dataclass
class Settings:
    """Runtime settings; environment variables take precedence over JSON."""

    host: str = "127.0.0.1"
    port: int = 8787
    model_dir: str = ""
    model_name: str = MODEL_ID
    runtime_root: str = ""
    llama_runtime_variant: str = "cuda-13.3"
    llama_release: str = "b10545"
    request_timeout_seconds: float = 600.0
    connect_timeout_seconds: float = 3.0
    first_response_timeout_seconds: float = 120.0
    stream_idle_timeout_seconds: float = 30.0
    admin_token: str = ""
    api_key: str = ""
    allowed_origins: list[str] = field(default_factory=list)
    gateway_instance_id: str = ""
    max_pending_translations: int = 8
    queue_wait_timeout_seconds: float = 120.0
    batch_size: int = 2048
    ubatch_size: int = 512
    flash_attention: str = "auto"
    kv_cache_type: str = "f16"
    cache_prompt: bool = True
    max_input_chars: int = 100000
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
        settings.validate()
        return settings

    def validate(self) -> None:
        if not isinstance(self.allowed_origins, list) or any(not isinstance(origin, str) or "://" not in origin or "*" in origin or any(char.isspace() for char in origin) for origin in self.allowed_origins):
            raise ValueError("allowed_origins 必须是明确的 Origin 列表，不能包含通配符")
        for name in ("request_timeout_seconds", "connect_timeout_seconds", "first_response_timeout_seconds", "stream_idle_timeout_seconds", "queue_wait_timeout_seconds"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} 必须是有限的正数")
        for name, minimum, maximum in (("max_pending_translations", 1, 32), ("batch_size", 32, 8192), ("ubatch_size", 16, 2048)):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
                raise ValueError(f"{name} 必须是 {minimum} 至 {maximum} 的整数")
        if self.ubatch_size > self.batch_size:
            raise ValueError("ubatch_size 不能大于 batch_size")
        if self.flash_attention not in ("auto", "on", "off"):
            raise ValueError("flash_attention 必须是 auto、on 或 off")
        if self.kv_cache_type not in ("f16", "q8_0"):
            raise ValueError("kv_cache_type 必须是 f16 或 q8_0")
        if self.kv_cache_type == "q8_0" and self.flash_attention == "off":
            raise ValueError("q8_0 KV 缓存需要启用 Flash Attention，请使用 auto 或 on")
        if not isinstance(self.cache_prompt, bool):
            raise ValueError("cache_prompt 必须是布尔值")
        for name in ("admin_token", "api_key", "gateway_instance_id"):
            value = getattr(self, name)
            if not isinstance(value, str) or len(value) > 512 or any(not 33 <= ord(char) <= 126 for char in value):
                raise ValueError(f"{name} 必须是最多 512 位可打印 ASCII 字符，不能包含空白")

    def apply_environment(self) -> None:
        mapping = {
            "host": ("LLM_TRANSLATOR_HOST", str),
            "port": ("LLM_TRANSLATOR_PORT", int),
            "model_dir": ("LAT_MODEL_DIR", str),
            "model_name": ("LAT_MODEL", str),
            "runtime_root": ("LAT_RUNTIME_ROOT", str),
            "llama_runtime_variant": ("LAT_LLAMA_RUNTIME_VARIANT", str),
            "llama_release": ("LAT_LLAMA_RELEASE", str),
            "request_timeout_seconds": ("LLM_TRANSLATOR_TIMEOUT", float),
            "connect_timeout_seconds": ("LAT_CONNECT_TIMEOUT", float),
            "first_response_timeout_seconds": ("LAT_FIRST_RESPONSE_TIMEOUT", float),
            "stream_idle_timeout_seconds": ("LAT_STREAM_IDLE_TIMEOUT", float),
            "admin_token": ("LAT_ADMIN_TOKEN", str),
            "api_key": ("LAT_API_KEY", str),
            "gateway_instance_id": ("LAT_GATEWAY_INSTANCE_ID", str),
            "max_pending_translations": ("LAT_MAX_PENDING_TRANSLATIONS", int),
            "queue_wait_timeout_seconds": ("LAT_QUEUE_WAIT_TIMEOUT", float),
            "batch_size": ("LAT_BATCH_SIZE", int),
            "ubatch_size": ("LAT_UBATCH_SIZE", int),
            "flash_attention": ("LAT_FLASH_ATTENTION", str),
            "kv_cache_type": ("LAT_KV_CACHE_TYPE", str),
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

        raw = os.environ.get("LLM_TRANSLATOR_RETRY_ON_BAD_OUTPUT")
        if raw is not None:
            self.retry_on_bad_output = raw.strip().lower() not in {"0", "false", "no", "off"}
        raw = os.environ.get("LAT_CACHE_PROMPT")
        if raw is not None:
            if raw.strip().lower() not in {"0", "1", "false", "true", "no", "yes", "off", "on"}:
                raise ValueError("LAT_CACHE_PROMPT 必须是 true/false 或 1/0")
            self.cache_prompt = raw.strip().lower() in {"1", "true", "yes", "on"}

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
        return self.resolved_model_dir / get_model_variant(self.model_name).filename

    @property
    def resolved_log_file(self) -> Path:
        if self.log_file == str(PROJECT_ROOT / ".lat-runtime" / "translator.log"):
            return self.resolved_data_root / "logs" / "translator.log"
        return Path(self.log_file).expanduser().resolve()
