"""NER extraction for transcribed segments.

Uses dslim/bert-base-NER (via the shared singleton in models.py) plus
regex patterns to catch entity types BERT doesn't cover (phone, email,
money, date).

Public API:
    extract_entities(text: str) -> list[EntitySpan]
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class EntitySpan:
    entity_type: str   # PERSON / ORG / LOC / MISC / PHONE / EMAIL / MONEY
    raw_text: str
    normalized_text: str
    offset: int        # char offset in original text
    length: int
    confidence: float


# ── normalization helpers ─────────────────────────────────────────────────────

_STRIP_SUFFIXES = re.compile(
    r"(?i)\b(jr\.?|sr\.?|ii|iii|iv|phd\.?|md\.?|esq\.?)$"
)
_ARTICLES = re.compile(r"(?i)^(the |a |an )")
_POSSESSIVE = re.compile(r"'s$")


def _normalize(text: str) -> str:
    t = text.strip()
    t = _POSSESSIVE.sub("", t)
    t = _STRIP_SUFFIXES.sub("", t).strip(" ,.")
    t = _ARTICLES.sub("", t).strip()
    return t.lower()


# ── regex patterns ────────────────────────────────────────────────────────────

_PHONE_RE = re.compile(
    r"(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}"
)
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_MONEY_RE = re.compile(
    r"\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s?(?:million|billion|thousand|[kmb]))?",
    re.IGNORECASE,
)

# label → (type_name, pattern)
_REGEX_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("EMAIL", _EMAIL_RE),   # email before phone so addresses don't get sliced
    ("PHONE", _PHONE_RE),
    ("MONEY", _MONEY_RE),
]

# Map bert-base-NER labels to our canonical type names
_BERT_LABEL_MAP = {
    "PER": "PERSON",
    "ORG": "ORG",
    "LOC": "LOC",
    "MISC": "MISC",
}


# ── main extraction function ──────────────────────────────────────────────────

def extract_entities(text: str) -> list[EntitySpan]:
    """Return all entity spans found in *text* (deduped, non-overlapping)."""
    spans: list[EntitySpan] = []
    covered: list[tuple[int, int]] = []  # (start, end) of already-claimed chars

    def _overlaps(start: int, end: int) -> bool:
        return any(s < end and start < e for s, e in covered)

    # 1. Regex entities (highest precision for structural types)
    for etype, pattern in _REGEX_PATTERNS:
        for m in pattern.finditer(text):
            s, e = m.start(), m.end()
            raw = m.group()
            if len(raw) < 4 or _overlaps(s, e):
                continue
            covered.append((s, e))
            spans.append(EntitySpan(
                entity_type=etype,
                raw_text=raw,
                normalized_text=_normalize(raw),
                offset=s,
                length=e - s,
                confidence=1.0,
            ))

    # 2. BERT NER
    try:
        from .models import get_ner_model
        pipe = get_ner_model()
        results = pipe(text)
    except Exception:
        results = []

    for ent in results:
        label = ent.get("entity_group", "")
        etype = _BERT_LABEL_MAP.get(label)
        if etype is None:
            continue
        raw = ent.get("word", "").strip()
        # bert may return "##suffix" artifacts — skip
        if not raw or raw.startswith("##"):
            continue
        score = float(ent.get("score", 0.0))
        if score < 0.6:
            continue
        # find the char offset by searching from beginning
        start = text.find(raw)
        if start == -1:
            continue
        end = start + len(raw)
        if _overlaps(start, end):
            continue
        covered.append((start, end))
        spans.append(EntitySpan(
            entity_type=etype,
            raw_text=raw,
            normalized_text=_normalize(raw),
            offset=start,
            length=len(raw),
            confidence=score,
        ))

    spans.sort(key=lambda s: s.offset)
    return spans
