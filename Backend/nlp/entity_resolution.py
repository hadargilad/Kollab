"""Entity resolution and Ghost speaker promotion.

Pipeline per audio:
  1. extract NER spans from every segment
  2. for each span, resolve against the global Entities table via 4-stage cascade:
       A. exact match on NormalizedText
       B. phonetic match via Double Metaphone (PERSON only)
       C. Jaro-Winkler string similarity >= 0.92
       D. embedding-context tiebreaker (requires Segments.Embedding populated by Hadar)
  3. upsert Entities + insert EntityMentions
  4. promote PERSON entities that cross the ghost threshold to ghost Speakers

Public API (called from api.py / nlp/__init__.py):
    extract_and_resolve_entities(audio_id: int) -> None
"""

from __future__ import annotations

import logging
import re
import struct
from collections import defaultdict
from typing import Optional

log = logging.getLogger(__name__)

# ── thresholds ────────────────────────────────────────────────────────────────

JARO_THRESHOLD = 0.92          # step C
EMBED_COSINE_THRESHOLD = 0.50  # step D tiebreaker minimum
GHOST_MIN_AUDIOS = 3           # promote if mentioned in ≥ N distinct audios …
GHOST_MIN_SPEAKERS = 2         # … OR by ≥ N distinct speakers


# ── phonetics helper ──────────────────────────────────────────────────────────

def _double_metaphone(name: str) -> tuple[str, str]:
    """Thin wrapper — returns (primary, secondary) codes.

    Uses the `phonetics` library when available, falls back to a trivial
    first-letter code so the pipeline degrades gracefully in test envs
    without the C extension.
    """
    try:
        import phonetics  # type: ignore
        result = phonetics.dmetaphone(name)
        return result[0] or "", result[1] or ""
    except Exception:
        c = name[0].upper() if name else ""
        return c, c


def _metaphone_key(name: str) -> str:
    primary, secondary = _double_metaphone(name)
    return primary or secondary


# ── Jaro-Winkler helper ───────────────────────────────────────────────────────

def _jaro_winkler(s1: str, s2: str) -> float:
    try:
        import jellyfish  # type: ignore
        return jellyfish.jaro_winkler_similarity(s1, s2)
    except Exception:
        # trivial fallback: exact == 1.0, else 0.0
        return 1.0 if s1 == s2 else 0.0


# ── embedding cosine helper ───────────────────────────────────────────────────

def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _blob_to_floats(blob: bytes) -> list[float]:
    n = len(blob) // 4
    return list(struct.unpack(f"{n}f", blob[:n * 4]))


# ── resolution core ───────────────────────────────────────────────────────────

class EntityResolver:
    """Stateful resolver that holds the in-memory entity index for one call."""

    def __init__(self, existing_entities: list[dict]) -> None:
        # index structures built from DB rows
        self._by_norm: dict[str, list[dict]] = defaultdict(list)
        self._by_phonetic: dict[str, list[dict]] = defaultdict(list)
        self._all: list[dict] = []

        for ent in existing_entities:
            self._all.append(ent)
            self._by_norm[ent["normalizedText"]].append(ent)
            pk = ent.get("phoneticKey") or ""
            if pk:
                self._by_phonetic[pk].append(ent)

    def resolve(
        self,
        normalized: str,
        entity_type: str,
        phonetic_key: Optional[str],
        mention_embedding: Optional[list[float]],
        speaker_context_embeddings: dict[int, list[float]],
    ) -> tuple[Optional[dict], str]:
        """Return (matched_entity_row | None, method_name)."""

        # Step A — exact
        candidates = self._by_norm.get(normalized)
        if candidates:
            best = self._pick_by_embedding(candidates, mention_embedding, speaker_context_embeddings)
            return best, "exact"

        # Step B — phonetic (PERSON only)
        if entity_type == "PERSON" and phonetic_key:
            candidates = self._by_phonetic.get(phonetic_key)
            if candidates:
                best = self._pick_by_embedding(candidates, mention_embedding, speaker_context_embeddings)
                return best, "phonetic"

        # Step C — Jaro-Winkler
        jw_candidates = [
            ent for ent in self._all
            if ent["type"] == entity_type
            and _jaro_winkler(normalized, ent["normalizedText"]) >= JARO_THRESHOLD
        ]
        if jw_candidates:
            best = self._pick_by_embedding(jw_candidates, mention_embedding, speaker_context_embeddings)
            return best, "jaro"

        # Step D — no match
        return None, "none"

    def _pick_by_embedding(
        self,
        candidates: list[dict],
        mention_emb: Optional[list[float]],
        speaker_ctx: dict[int, list[float]],
    ) -> dict:
        if len(candidates) == 1 or mention_emb is None:
            return candidates[0]
        # Find which candidate's ghost/related speaker context is closest
        best, best_score = candidates[0], -1.0
        for cand in candidates:
            gid = cand.get("ghostSpeakerId")
            if gid and gid in speaker_ctx:
                score = _cosine(mention_emb, speaker_ctx[gid])
                if score > best_score:
                    best, best_score = cand, score
        return best

    def register(self, entity_row: dict) -> None:
        self._all.append(entity_row)
        self._by_norm[entity_row["normalizedText"]].append(entity_row)
        pk = entity_row.get("phoneticKey") or ""
        if pk:
            self._by_phonetic[pk].append(entity_row)


# ── main entry point ──────────────────────────────────────────────────────────

def extract_and_resolve_entities(audio_id: int) -> None:
    """Run NER on every segment of *audio_id* and persist Entities / EntityMentions."""
    import database
    from .ner import extract_entities

    segments = database.get_segments_by_audio(audio_id)
    if not segments:
        return

    # Build speaker context embeddings + per-segment embedding lookup
    speaker_ctx: dict[int, list[float]] = {}
    seg_emb_lookup: dict[int, list[float]] = {}
    all_segs_for_ctx = database.get_all_segment_embeddings()
    by_speaker: dict[int, list[list[float]]] = defaultdict(list)
    for row in all_segs_for_ctx:
        if row.get("embedding"):
            vec = _blob_to_floats(row["embedding"])
            if vec:
                seg_emb_lookup[row["id"]] = vec
                sid = row.get("speakerId")
                if sid:
                    by_speaker[sid].append(vec)
    for sid, vecs in by_speaker.items():
        dim = len(vecs[0])
        mean = [sum(v[i] for v in vecs) / len(vecs) for i in range(dim)]
        speaker_ctx[sid] = mean

    existing_entities = database.get_all_entities()
    resolver = EntityResolver(existing_entities)

    for seg in segments:
        text = seg.get("text", "")
        if not text.strip():
            continue

        seg_id = seg["id"]
        speaker_id: Optional[int] = seg.get("speakerId")

        mention_emb: Optional[list[float]] = seg_emb_lookup.get(seg_id)

        spans = extract_entities(text)
        for span in spans:
            pk: Optional[str] = None
            if span.entity_type == "PERSON":
                pk = _metaphone_key(span.normalized_text) or None

            matched_ent, method = resolver.resolve(
                span.normalized_text,
                span.entity_type,
                pk,
                mention_emb,
                speaker_ctx,
            )

            if matched_ent is None:
                # Create new entity
                entity_id = database.upsert_entity(
                    entity_type=span.entity_type,
                    raw_text=span.raw_text,
                    normalized_text=span.normalized_text,
                    phonetic_key=pk,
                )
                matched_ent = database.get_entity(entity_id)
                if matched_ent:
                    resolver.register(matched_ent)
            else:
                entity_id = matched_ent["id"]
                database.upsert_entity(
                    entity_type=span.entity_type,
                    raw_text=span.raw_text,
                    normalized_text=span.normalized_text,
                    phonetic_key=pk,
                    existing_id=entity_id,
                )

            database.insert_entity_mention(
                entity_id=entity_id,
                segment_id=seg_id,
                offset=span.offset,
                length=span.length,
                confidence=span.confidence,
                resolved_speaker_id=speaker_id,
                resolution_method=method,
            )

            # upsert "mentioned" relation between speaker and ghost (if promoted)
            if matched_ent and matched_ent.get("ghostSpeakerId") and speaker_id:
                database.upsert_mention_relation(speaker_id, matched_ent["ghostSpeakerId"])

    # After processing all segments: check ghost promotion
    _promote_ghosts(audio_id)


def _promote_ghosts(audio_id: int) -> None:
    """Promote PERSON entities that cross the ghost threshold to ghost Speakers."""
    import database

    candidates = database.get_ghost_promotion_candidates(
        min_audios=GHOST_MIN_AUDIOS,
        min_speakers=GHOST_MIN_SPEAKERS,
    )
    for ent in candidates:
        ghost_id = ent.get("ghostSpeakerId")
        if not ghost_id:
            ghost_id = database.create_ghost_speaker(ent["id"], ent["rawText"])
            if ghost_id:
                log.info(
                    "[entity_resolution] promoted entity %d ('%s') to ghost speaker %d",
                    ent["id"],
                    ent["rawText"],
                    ghost_id,
                )
        if ghost_id:
            # Sync "mentioned" edges for all existing mentions (idempotent)
            mentions = database.get_entity_mentions(ent["id"])
            for m in mentions:
                sid = m.get("resolvedSpeakerId")
                if sid:
                    database.upsert_mention_relation(sid, ghost_id)
