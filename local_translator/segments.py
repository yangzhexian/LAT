"""Bounded semantic chunks. Splitting and rejoining never edits source bytes."""
from __future__ import annotations

import re

from .quality import protect_text, restore_tokens


def token_cost(value: str) -> int:
    # Conservative planning estimate; runtime context errors trigger subdivision.
    return max(1, (len(value.encode("utf-8")) + 1) // 2)


def split_source(source: str, budget: int) -> list[str]:
    protected = protect_text(source)
    marker = r"__LAT_FORMULA_\d+__|⟦KEEP_\d+⟧"
    atoms = re.findall(marker + r"|[\s\S]", protected.protected)
    chunks: list[str] = []
    start = 0
    while start < len(atoms):
        end = start
        cost = 0
        boundary = None
        sentence_start = start
        seen_sentences: set[str] = set()
        while end < len(atoms):
            next_cost = len(atoms[end].encode("utf-8")) / 2
            if cost + next_cost > budget and end > start:
                break
            cost += next_cost
            end += 1
            if atoms[end - 1] in "。！？.!?" and (end == len(atoms) or atoms[end].isspace() or atoms[end - 1] in "。！？"):
                sentence = "".join(atoms[sentence_start:end]).strip()
                if len(sentence) >= 16 and sentence in seen_sentences and sentence_start > start:
                    end = sentence_start
                    boundary = end
                    break
                seen_sentences.add(sentence)
                sentence_start = end
            # Never ask the model to deduplicate or merge separate paragraphs.
            # Include the full separator in this chunk for exact reconstruction.
            if end >= start + 2 and atoms[end - 1] == "\n" and atoms[end - 2] == "\n":
                while end < len(atoms) and atoms[end].isspace():
                    end += 1
                boundary = end
                break
            if atoms[end - 1] in "\n。！？.!?" and cost >= budget // 3:
                boundary = end
        if end < len(atoms) and boundary is not None:
            end = boundary
        chunks.append(restore_tokens("".join(atoms[start:end]), protected))
        start = end
    return chunks
