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
    for pattern in FORMULA_PATTERNS:
        def replace_formula(match: re.Match[str]) -> str:
            nonlocal counter
            token = f"__LAT_FORMULA_{counter}__"
            tokens[token] = match.group(0)
            counter += 1
            return token

        protected = pattern.sub(replace_formula, protected)

    for pattern in PROTECTED_PATTERNS:
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
    return restore_tokens(result, protected)


def quality_issues(raw: str, cleaned: str, protected: ProtectedText, source: str) -> list[str]:
    issues: list[str] = []
    if not cleaned.strip():
        issues.append("empty_output")
    lowered = raw.lower()
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
    if re.search(r"(.{12,}?)(?:\1){2,}", cleaned, flags=re.DOTALL):
        issues.append("repetition")
    if len(cleaned) > max(4000, len(source) * 12 + 1000):
        issues.append("abnormally_long")
    return issues


def is_fatal(issues: list[str]) -> bool:
    return any(issue in {"empty_output", "prompt_leak", "missing_protected_token", "repetition", "abnormally_long"} for issue in issues)
