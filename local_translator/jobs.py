"""Session-local translation checkpoints. No source content is written to disk."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any


class TranslationCancelled(Exception):
    pass


@dataclass
class TranslationJob:
    id: str
    fingerprint: str
    source: str
    model: str
    queue: list[tuple[str, int]]
    completed: list[str] = field(default_factory=list)
    completed_chars: int = 0
    cache: dict[str, dict[str, Any]] = field(default_factory=dict)
    issues: set[str] = field(default_factory=set)
    generated_tokens: int = 0
    tokens_known: bool = True
    eval_ns: int = 0
    eval_known: bool = True
    elapsed_ms: float = 0
    updated_at: float = field(default_factory=time.monotonic)
    cancel: threading.Event = field(default_factory=threading.Event)

    def progress(self) -> dict[str, Any]:
        return {
            "job_id": self.id,
            "completed_chars": self.completed_chars,
            "total_chars": len(self.source),
            "completed_chunks": len(self.completed),
            "total_chunks": len(self.queue),
        }

    def checkpoint(self) -> dict[str, Any]:
        return {**self.progress(), "translation": "".join(self.completed)}
