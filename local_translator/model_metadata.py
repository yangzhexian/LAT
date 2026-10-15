"""Read bounded GGUF metadata and tensor descriptors without loading weights.

Format: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import threading
from typing import Any, BinaryIO

from .inference_telemetry import token_count


MAX_HEADER_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 200_000
MAX_ARRAY_ENTRIES = 2_000_000
MAX_BLOCK_TENSORS = 4096
SCALARS = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f",
           7: "?", 10: "Q", 11: "q", 12: "d"}
FILE_TYPES = {0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 7: "Q8_0", 8: "Q5_0", 9: "Q5_1",
              10: "Q2_K", 11: "Q3_K_S", 12: "Q3_K_M", 13: "Q3_K_L", 14: "Q4_K_S", 15: "Q4_K_M",
              16: "Q5_K_S", 17: "Q5_K_M", 18: "Q6_K", 30: "IQ4_XS", 32: "BF16"}


class GgufHeader:
    def __init__(self, handle: BinaryIO, size: int):
        self.handle = handle
        self.limit = min(size, MAX_HEADER_BYTES)
        self.endian = "<"

    def read(self, length: int) -> bytes:
        if length < 0 or self.handle.tell() + length > self.limit:
            raise ValueError("GGUF header exceeds the bounded metadata range")
        value = self.handle.read(length)
        if len(value) != length:
            raise ValueError("GGUF header is truncated")
        return value

    def skip(self, length: int) -> None:
        if length < 0 or self.handle.tell() + length > self.limit:
            raise ValueError("GGUF metadata exceeds the bounded header range")
        self.handle.seek(length, 1)

    def unpack(self, kind: str):
        return struct.unpack(self.endian + kind, self.read(struct.calcsize(kind)))[0]

    def string(self, *, keep: bool, max_length: int = 4 * 1024 * 1024) -> str | None:
        length = self.unpack("Q")
        if length > max_length:
            raise ValueError("GGUF metadata string is too large")
        if keep:
            return self.read(length).decode("utf-8")
        self.skip(length)
        return None

    def value(self, kind: int, *, keep: bool = True):
        if kind in SCALARS:
            value = self.unpack(SCALARS[kind])
            return value if keep else None
        if kind == 8:
            return self.string(keep=keep)
        if kind == 9:
            element_kind, length = self.unpack("I"), self.unpack("Q")
            if length > MAX_ARRAY_ENTRIES:
                raise ValueError("GGUF metadata array is too large")
            # Tokenizer vocabulary is skipped, never allocated or exposed.
            if element_kind in SCALARS:
                self.skip(length * struct.calcsize(SCALARS[element_kind]))
            elif element_kind == 8:
                for _ in range(length):
                    self.string(keep=False)
            else:
                raise ValueError("Unsupported GGUF metadata array type")
            return None
        raise ValueError("Unsupported GGUF metadata type")


def unavailable(model: str, message: str) -> dict[str, Any]:
    return {
        "available": False, "source": "unavailable", "model": model, "message": message,
        **{key: None for key in ("architecture", "name", "block_count", "embedding_length", "attention_heads",
                               "kv_heads", "feed_forward_length", "context_length", "expert_count", "expert_used_count",
                               "tensor_count", "parameter_count", "quantization", "vocab_size", "head_dim")},
        "block_tensors": [], "block_tensors_truncated": False,
    }


def read_architecture(path: Path, model: str) -> dict[str, Any]:
    if not path.is_file():
        return unavailable(model, "本地 GGUF 尚未安装，安装后可读取模型架构")
    try:
        with path.open("rb") as handle:
            header = GgufHeader(handle, path.stat().st_size)
            if header.read(4) != b"GGUF":
                raise ValueError("not a GGUF model")
            raw_version = header.read(4)
            version = struct.unpack("<I", raw_version)[0]
            if version not in (2, 3):
                header.endian = ">"
                version = struct.unpack(">I", raw_version)[0]
            if version not in (2, 3):
                raise ValueError("unsupported GGUF version")
            tensor_count, metadata_count = header.unpack("Q"), header.unpack("Q")
            if tensor_count > MAX_ENTRIES or metadata_count > MAX_ENTRIES:
                raise ValueError("GGUF header entry count is too large")
            metadata = {}
            wanted_suffixes = (".block_count", ".embedding_length", ".attention.head_count",
                               ".attention.head_count_kv", ".feed_forward_length", ".context_length",
                               ".expert_count", ".expert_used_count", ".vocab_size", ".attention.key_length")
            for _ in range(metadata_count):
                key = header.string(keep=True, max_length=512)
                keep = key in ("general.architecture", "general.name", "general.file_type") or key.endswith(wanted_suffixes)
                value = header.value(header.unpack("I"), keep=keep)
                if keep:
                    metadata[key] = value
            parameters = 0
            block_tensors = []
            block_tensors_truncated = False
            embedding_vocab = None
            for _ in range(tensor_count):
                name = header.string(keep=True, max_length=512)
                dimensions = header.unpack("I")
                if not 1 <= dimensions <= 4:
                    raise ValueError("unsupported GGUF tensor shape")
                shape = [header.unpack("Q") for _ in range(dimensions)]
                if not all(shape):
                    raise ValueError("invalid GGUF tensor shape")
                elements = math.prod(shape)
                parameters += elements
                # Shapes use GGUF's stored dimension order. Never read weights,
                # vocabulary entries, or follow the tensor data offset.
                if name == "token_embd.weight" and len(shape) == 2:
                    embedding_vocab = token_count(shape[1])
                block = re.fullmatch(r"blk\.(\d{1,6})\.(.+)", name)
                if block and all(token_count(value) is not None for value in shape):
                    if len(block_tensors) < MAX_BLOCK_TENSORS:
                        block_tensors.append({"layer": int(block[1]) + 1, "name": name,
                                              "shape": shape, "elements": token_count(elements)})
                    else:
                        block_tensors_truncated = True
                header.unpack("I")  # Tensor type; no tensor data is accessed.
                header.unpack("Q")  # Tensor offset; never followed.
        architecture = metadata.get("general.architecture")
        if not isinstance(architecture, str) or not architecture:
            return unavailable(model, "GGUF 未声明模型架构")
        def dimension(suffix):
            return token_count(metadata.get(f"{architecture}.{suffix}"))
        file_type = token_count(metadata.get("general.file_type"))
        head_dim = dimension("attention.key_length")
        embedding_length, attention_heads = dimension("embedding_length"), dimension("attention.head_count")
        if head_dim is None and architecture == "hunyuan-dense" and embedding_length and attention_heads:
            if embedding_length % attention_heads == 0:
                head_dim = embedding_length // attention_heads
        return {
            "available": True, "source": "gguf", "model": model, "architecture": architecture,
            "name": metadata.get("general.name") if isinstance(metadata.get("general.name"), str) else None,
            "block_count": dimension("block_count"), "embedding_length": dimension("embedding_length"),
            "attention_heads": dimension("attention.head_count"), "kv_heads": dimension("attention.head_count_kv"),
            "feed_forward_length": dimension("feed_forward_length"), "context_length": dimension("context_length"),
            "expert_count": dimension("expert_count"), "expert_used_count": dimension("expert_used_count"),
            "tensor_count": tensor_count, "parameter_count": token_count(parameters),
            "vocab_size": embedding_vocab if embedding_vocab is not None else dimension("vocab_size"),
            "head_dim": head_dim, "block_tensors": block_tensors,
            "block_tensors_truncated": block_tensors_truncated,
            "quantization": FILE_TYPES.get(file_type, f"GGUF type {file_type}" if file_type is not None else None),
            "message": "来自选中本地 GGUF 的架构元数据；参数量为存储张量元素总数，动画为计算阶段示意",
        }
    except (OSError, ValueError, UnicodeError, struct.error):
        return unavailable(model, "暂时无法读取本地 GGUF 架构元数据，推理统计仍可使用")


class ArchitectureMetadataCache:
    def __init__(self):
        self._lock = threading.Lock()
        self._key = None
        self._value = None
        self._response: bytes | None = None
        self._etag: str | None = None

    def _refresh(self, path: Path, model: str) -> None:
        try:
            stat = path.stat()
            key = (str(path), model, stat.st_size, stat.st_mtime_ns)
        except OSError:
            key = (str(path), model, None, None)
        if key != self._key:
            self._value = read_architecture(path, model)
            self._key = key
            self._response = None
            self._etag = None

    def snapshot(self, path: Path, model: str) -> dict[str, Any]:
        with self._lock:
            self._refresh(path, model)
            return copy.deepcopy(self._value)

    def response(self, path: Path, model: str, if_none_match: str | None = None) -> tuple[str, bytes | None]:
        """Return cached JSON bytes, or None for a matching conditional GET."""
        with self._lock:
            self._refresh(path, model)
            if self._response is None:
                self._response = json.dumps({"architecture": self._value}, ensure_ascii=False).encode("utf-8")
                self._etag = '"' + hashlib.sha256(self._response).hexdigest() + '"'
            # GET uses weak ETag comparison; browsers may send a validator list.
            validators = [value.strip().removeprefix("W/") for value in (if_none_match or "").split(",")]
            unchanged = "*" in validators or self._etag in validators
            return self._etag, None if unchanged else self._response
