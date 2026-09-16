from __future__ import annotations

import re
from dataclasses import dataclass


FORMULA_PATTERNS = (
    re.compile(r"\$\$[\s\S]*?\$\$"),
    re.compile(r"\\\[[\s\S]*?\\\]"),
    re.compile(r"\\\([\s\S]*?\\\)"),
    re.compile(r"(?<!\$)\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)"),
)

PROTECTED_PATTERNS = (
    re.compile(r"```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~"),
    re.compile(r"\[(?:end source text|end translation|source text|translation|结束源文本|结束翻译|源文本结束)\]", re.I),
    re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE),
    re.compile(r"`[^`\n]+`"),
    re.compile(r"<[^>\n]+>"),
    re.compile(r"\{\{[^{}\n]+\}\}|\$\{[^{}\n]+\}|%[sdif]"),
    re.compile(r"(?<!\w)@[\w.-]+|(?<!\w)#[\w-]+"),
)


@dataclass
class ProtectedText:
    source: str
    protected: str
    tokens: dict[str, str]


def protect_text(source: str) -> ProtectedText:
    tokens: dict[str, str] = {}
    protected = source
    counter = 0

    # LaTeX is replaced with an ASCII marker before it reaches Hy-MT2. The
    # model can terminate early when it sees a raw '$', while an ASCII marker
    # lets it translate the surrounding prose and keeps the formula intact.
    for pattern in (PROTECTED_PATTERNS[0], *FORMULA_PATTERNS):
        def replace_formula(match: re.Match[str]) -> str:
            nonlocal counter
            token = f"__LAT_FORMULA_{counter}__"
            tokens[token] = match.group(0)
            counter += 1
            return token

        protected = pattern.sub(replace_formula, protected)

    for pattern in PROTECTED_PATTERNS[1:]:
        def replace(match: re.Match[str]) -> str:
            nonlocal counter
            token = f"⟦KEEP_{counter}⟧"
            tokens[token] = match.group(0)
            counter += 1
            return token

        protected = pattern.sub(replace, protected)
    return ProtectedText(source, protected, tokens)


def restore_tokens(value: str, protected: ProtectedText) -> str:
    restored = value
    for token, original in protected.tokens.items():
        variants = (
            token,
            token.replace("⟦", "[").replace("⟧", "]"),
            token.replace("⟦", "(").replace("⟧", ")"),
            token.replace("_", " "),
        )
        for variant in variants:
            restored = restored.replace(variant, original)
    return restored


def _remove_thinking(value: str) -> str:
    value = re.sub(r"<think>.*?</think>", "", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<analysis>.*?</analysis>", "", value, flags=re.IGNORECASE | re.DOTALL)
    return value.strip()


def clean_model_output(value: str, protected: ProtectedText) -> str:
    result = _remove_thinking(value).strip()
    if result.startswith("```") and result.endswith("```"):
        result = re.sub(r"^```[^\n]*\n?", "", result)
        result = re.sub(r"\n?```$", "", result).strip()

    # Remove labels only when they are a leading line. Colons inside a real
    # translation are intentionally left untouched.
    result = re.sub(
        r"^(?:translation|translated text|译文|翻译结果)\s*[:：]\s*",
        "",
        result,
        flags=re.IGNORECASE,
    ).strip()
    for marker in ("[Translation]", "〖翻译结果〗"):
        if marker in result:
            result = result.split(marker, 1)[1].lstrip(" \n:")
    result = re.split(
        r"\n\s*(?:\[end translation\]|\[结束翻译\]|\[source text\]|translation tasks:)\s*",
        result,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()
    # Strip only standalone trailing wrapper lines absent from the source.
    boundary = re.compile(r"\s*\[(?:end source text|end translation|结束源文本|结束翻译|源文本结束)\]\s*$", re.I)
    while (match := boundary.search(result)) is not None:
        if match.group(0).strip().lower() in protected.source.lower():
            break
        result = result[:match.start()].rstrip()
    return restore_tokens(result, protected)


def quality_issues(raw: str, cleaned: str, protected: ProtectedText, source: str) -> list[str]:
    issues: list[str] = []
    if not cleaned.strip():
        issues.append("empty_output")
    # Harmless trailing delimiters are cleaned first; actual prompt echoes
    # remain fatal. Do not interpret source-owned literal markers as leaks.
    checked_raw = raw
    checked_raw = re.sub(r"(?:\s*\[(?:end source text|end translation|结束源文本|结束翻译|源文本结束)\])+\s*$", "", checked_raw, flags=re.I)
    for original in protected.tokens.values():
        checked_raw = checked_raw.replace(original, "")
    lowered = checked_raw.lower()
    leak_markers = (
        "[source text]",
        "[end source text]",
        "translation tasks",
        "translate the following text",
        "you are a professional machine translation engine",
        "<|system|>",
        "<|user|>",
    )
    if any(marker in lowered for marker in leak_markers):
        issues.append("prompt_leak")
    if source.strip() and cleaned.strip() == source.strip():
        # This is not necessarily wrong for same-language translation, so it
        # is a soft issue and is not treated as a fatal error by the engine.
        issues.append("unchanged_output")
    for token in protected.tokens:
        if token not in raw and protected.tokens[token] not in cleaned:
            issues.append("missing_protected_token")
            break
    expected = list(protected.tokens.values())
    # Count source occurrences (identical formulas may legitimately repeat).
    for original in set(expected):
        if cleaned.count(original) != source.count(original):
            issues.append("protected_content_mismatch")
            break
    if expected:
        originals = re.compile("|".join(re.escape(value) for value in sorted(set(expected), key=len, reverse=True)))
        if originals.findall(source) != originals.findall(cleaned):
            issues.append("protected_content_order")
    prose = cleaned
    for original in protected.tokens.values():
        prose = prose.replace(original, "")
    if re.search(r"(.{12,}?)(?:\1){2,}", prose, flags=re.DOTALL) and not re.search(r"(.{12,}?)(?:\1){2,}", source, flags=re.DOTALL):
        issues.append("repetition")
    if len(cleaned) > max(4000, len(source) * 12 + 1000):
        issues.append("abnormally_long")
    return issues


def is_fatal(issues: list[str]) -> bool:
    return any(issue in {"empty_output", "prompt_leak", "missing_protected_token", "protected_content_mismatch", "protected_content_order", "repetition", "abnormally_long", "output_truncated", "incomplete_stream"} for issue in issues)
