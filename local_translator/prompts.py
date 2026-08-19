from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


LANGUAGE_NAMES: dict[str, str] = {
    "zh": "Chinese",
    "zh-cn": "Simplified Chinese",
    "zh-hans": "Simplified Chinese",
    "zh-hant": "Traditional Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "it": "Italian",
    "tr": "Turkish",
    "vi": "Vietnamese",
    "th": "Thai",
    "id": "Indonesian",
    "ms": "Malay",
    "hi": "Hindi",
    "pl": "Polish",
    "nl": "Dutch",
    "uk": "Ukrainian",
    "he": "Hebrew",
    "cs": "Czech",
    "fa": "Persian",
    "yue": "Cantonese",
    "中文": "Chinese",
    "简体中文": "Simplified Chinese",
    "繁体中文": "Traditional Chinese",
    "英语": "English",
    "日语": "Japanese",
    "韩语": "Korean",
    "法语": "French",
    "德语": "German",
    "西班牙语": "Spanish",
    "葡萄牙语": "Portuguese",
    "俄语": "Russian",
    "阿拉伯语": "Arabic",
    "意大利语": "Italian",
    "越南语": "Vietnamese",
}

_LANGUAGE_ALIASES = sorted(
    {alias for alias in LANGUAGE_NAMES} | {value for value in LANGUAGE_NAMES.values()},
    key=len,
    reverse=True,
)


def normalize_language(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip().strip("`'\"[](){} ")
    if not candidate:
        return None
    return LANGUAGE_NAMES.get(candidate.lower(), LANGUAGE_NAMES.get(candidate, candidate))


def _message_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for part in value:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return "".join(parts)
    return ""


def infer_target_language(text: str) -> str | None:
    lowered = text.lower()
    # Prefer the language occurring after a target/into/to marker.
    markers = (
        r"(?:target\s+language|target|translate(?:d)?\s+(?:into|to)|into|to)\s*[:=：]?\s*",
        r"(?:目标语言|翻译(?:为|成|到|至))\s*[:：]?\s*",
    )
    for marker in markers:
        match = re.search(marker, lowered, flags=re.IGNORECASE)
        if not match:
            continue
        tail = text[match.end() : match.end() + 50]
        for language in _LANGUAGE_ALIASES:
            if re.match(r"\s*[`'\"\[({]?" + re.escape(language) + r"\b", tail, flags=re.IGNORECASE):
                return normalize_language(language)

    # Some clients send `target_lang: English` or just `翻译成中文`.
    for language in _LANGUAGE_ALIASES:
        if re.search(r"(?:target[_ -]?lang|to|into|翻译成|翻译为)\s*[:=：]?\s*" + re.escape(language), lowered, re.I):
            return normalize_language(language)
    return None


def extract_source_text(content: str) -> str:
    """Extract source from common OpenAI translator prompt wrappers."""
    if not content:
        return ""
    patterns = (
        r"(?:\[source text\]|\[待翻译文本\]|〖待翻译文本〗|文本输入|text to translate)\s*[:：]?\s*\n?",
        r"(?:source text|待翻译文本)\s*[:：]\s*",
    )
    for pattern in patterns:
        matches = list(re.finditer(pattern, content, flags=re.IGNORECASE))
        if matches:
            extracted = content[matches[-1].end() :].strip()
            extracted = re.split(
                r"\n\s*(?:\[end source text\]|\[translation\]|translation\s*:|译文\s*[:：])",
                extracted,
                maxsplit=1,
                flags=re.IGNORECASE,
            )[0]
            return _strip_code_fence(extracted.strip())
    # A number of OpenAI-compatible clients put the instruction and source in
    # the same user message, e.g. `Translate into English:\n你好`. Remove the
    # instruction line instead of translating it as part of the source.
    lines = content.strip().splitlines()
    if len(lines) > 1 and infer_target_language(lines[0]) is not None:
        return _strip_code_fence("\n".join(lines[1:]).strip())
    return _strip_code_fence(content.strip())


def _strip_code_fence(value: str) -> str:
    match = re.fullmatch(r"```[^\n]*\n(.*?)\n?```", value, flags=re.DOTALL)
    return match.group(1) if match else value


@dataclass
class TranslationInput:
    source_text: str
    target_language: str
    source_language: str | None = None
    style: str | None = None
    glossary: list[tuple[str, str]] | None = None


def parse_translation_input(body: dict[str, Any], default_target: str = "") -> TranslationInput:
    explicit_target = (
        body.get("target_language")
        or body.get("target_lang")
        or body.get("to")
        or body.get("target")
    )
    target = normalize_language(explicit_target)
    messages = body.get("messages")
    message_items = messages if isinstance(messages, list) else []
    all_messages = "\n".join(
        _message_text(item.get("content"))
        for item in message_items
        if isinstance(item, dict)
    )
    if target is None:
        target = infer_target_language(all_messages)
    if target is None:
        target = normalize_language(default_target)
    if target is None:
        raise ValueError(
            "无法从请求中识别目标语言；请在请求中加入 target_language，或让提示词包含“translate into English/翻译成中文”"
        )

    explicit_source = body.get("text") or body.get("source_text") or body.get("input")
    source = _message_text(explicit_source)
    if not source and message_items:
        user_contents = [
            _message_text(item.get("content"))
            for item in message_items
            if isinstance(item, dict) and item.get("role") in {"user", "developer"}
        ]
        source = extract_source_text(user_contents[-1] if user_contents else all_messages)
    source = source.strip()
    if not source:
        raise ValueError("待翻译文本为空")

    source_language = normalize_language(
        body.get("source_language") or body.get("source_lang") or body.get("from")
    )
    style = body.get("style") or body.get("target_style")
    if not isinstance(style, str) or not style.strip():
        style = None
    glossary = body.get("glossary") or body.get("terminology")
    normalized_glossary: list[tuple[str, str]] = []
    if isinstance(glossary, dict):
        normalized_glossary = [(str(key), str(value)) for key, value in glossary.items()]
    elif isinstance(glossary, list):
        for item in glossary:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                normalized_glossary.append((str(item[0]), str(item[1])))
            elif isinstance(item, dict) and "source" in item and "target" in item:
                normalized_glossary.append((str(item["source"]), str(item["target"])))

    return TranslationInput(
        source_text=source,
        target_language=target,
        source_language=source_language,
        style=style,
        glossary=normalized_glossary or None,
    )


def build_translation_prompt(request: TranslationInput, protected_source: str) -> str:
    source_hint = (
        f"Translate from {request.source_language} into {request.target_language}."
        if request.source_language
        else f"Translate into {request.target_language}."
    )
    lines = [
        "You are a professional machine translation engine.",
        source_hint,
        "Return ONLY the translated text. Do not output explanations, reasoning, labels, the source text, or this prompt.",
        "Preserve the source text's meaning, paragraph boundaries, line breaks, punctuation, whitespace, and formatting.",
        "Preserve every protected marker exactly; do not translate, remove, reorder, or add protected markers. Translate all prose around the markers and continue until the complete source text is translated.",
    ]
    if request.style:
        lines.append(f"The translation style must strictly conform to [{request.style.strip()}].")
    if request.glossary:
        lines.append("Use the following terminology consistently:")
        lines.extend(f"- {source} => {target}" for source, target in request.glossary)
    lines.extend(
        [
            "",
            "[Source Text]",
            protected_source,
            "[End Source Text]",
            "",
            "[Translation]",
        ]
    )
    return "\n".join(lines)
