"""
Wikidata enrichment provider. Free, no API key, no auth.

Two endpoints:
  - Action API (https://www.wikidata.org/w/api.php) for entity search
    and image filename resolution.
  - SPARQL endpoint (https://query.wikidata.org/sparql) for related-entity
    discovery with human-readable reasons.

The SPARQL query is the key piece of work — it returns each related entity
along with a label describing *why* the connection exists ("Member of
Mercedes-AMG Petronas", "Spouse", "Worked at same employer as ..."). This
is what makes the suggestions auditable and not just a black-box list.
"""

import logging
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

from enrichment_provider import (
    EntityCandidate,
    ProviderNotConfiguredError,
    RelatedEntity,
)


_log = logging.getLogger("audiointel.enrichment.wikidata")


_WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_SPARQL_API = "https://query.wikidata.org/sparql"
_COMMONS_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/"

# Wikidata's SPARQL endpoint asks every requester to identify themselves
# with a meaningful User-Agent (https://meta.wikimedia.org/wiki/User-Agent_policy).
_USER_AGENT = "AudioIntel/1.0 (https://github.com/; enrichment feature)"

# How long to keep a successful response in memory.
_CACHE_TTL_SEC = 3600
_cache: dict[tuple[str, str], tuple[float, Any]] = {}


def _cache_get(method: str, key: str) -> Optional[Any]:
    hit = _cache.get((method, key))
    if hit and hit[0] > time.time():
        return hit[1]
    if hit:
        _cache.pop((method, key), None)
    return None


def _cache_put(method: str, key: str, value: Any) -> None:
    _cache[(method, key)] = (time.time() + _CACHE_TTL_SEC, value)


# SPARQL query for related entities with reasons. The VALUES line below is
# substituted at runtime with the entity QID. Each UNION block produces a
# different reason; LIMIT keeps response size predictable.
#
# Patterns covered:
#   - Direct claims: spouse, parent, child, sibling, employer, member of team,
#     country of citizenship, place of birth, occupation
#   - Co-membership: same sports team, same employer, same alma mater
#
# Property labels come from Wikidata directly so they're already i18n-ready.
_RELATED_SPARQL = """
SELECT DISTINCT ?related ?relatedLabel ?relatedDescription ?image ?reason WHERE {{
  {{
    # Direct: spouse, parent, child, sibling, employer, member of team
    VALUES (?prop ?reasonText) {{
      (wdt:P26  "Spouse")
      (wdt:P40  "Child")
      (wdt:P22  "Father")
      (wdt:P25  "Mother")
      (wdt:P3373 "Sibling")
      (wdt:P108 "Employer")
      (wdt:P54  "Member of team / club")
      (wdt:P1308 "Officeholder relation")
      (wdt:P3342 "Significant person")
    }}
    wd:{qid} ?prop ?related .
    BIND(?reasonText AS ?reason)
  }}
  UNION
  {{
    # Inverse: someone whose claim points back at the source
    VALUES (?prop ?reasonText) {{
      (wdt:P26  "Spouse")
      (wdt:P3373 "Sibling")
      (wdt:P22  "Child of")
      (wdt:P25  "Child of")
      (wdt:P40  "Parent of")
    }}
    ?related ?prop wd:{qid} .
    BIND(?reasonText AS ?reason)
  }}
  UNION
  {{
    # Co-membership: shares a team / employer / alma mater with the source
    VALUES (?coprop ?reasonText) {{
      (wdt:P54  "Shared sports team")
      (wdt:P108 "Same employer")
      (wdt:P69  "Same alma mater")
    }}
    wd:{qid} ?coprop ?org .
    ?related ?coprop ?org .
    FILTER(?related != wd:{qid})
    ?org rdfs:label ?orgLabel .
    FILTER(LANG(?orgLabel) = "en")
    BIND(CONCAT(?reasonText, ": ", ?orgLabel) AS ?reason)
  }}
  OPTIONAL {{ ?related wdt:P18 ?image . }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
LIMIT {limit}
""".strip()


class WikidataProvider:
    name = "wikidata"

    def __init__(self) -> None:
        self._client = httpx.Client(
            timeout=20.0,
            headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
        )

    # ---- Search by name ----------------------------------------------------

    def search(self, query: str, limit: int = 5) -> list[EntityCandidate]:
        q = query.strip()
        if not q:
            return []
        cache_key = f"{q}|{limit}"
        cached = _cache_get("search", cache_key)
        if cached is not None:
            return cached

        try:
            r = self._client.get(_WIKIDATA_API, params={
                "action": "wbsearchentities",
                "search": q,
                "language": "en",
                "format": "json",
                "limit": limit,
                "type": "item",
            })
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise ProviderNotConfiguredError(f"Wikidata unreachable: {e}") from e

        results: list[EntityCandidate] = []
        for item in data.get("search", [])[:limit]:
            qid = item.get("id") or ""
            if not qid:
                continue
            results.append(EntityCandidate(
                entity_id=qid,
                label=item.get("label") or qid,
                description=item.get("description") or "",
                image_url="",  # search endpoint doesn't return images; lookup() fills it
            ))
        # Inflate image URLs for the top results so Step 2 can show avatars.
        for cand in results:
            cand.image_url = self._image_for(cand.entity_id) or ""
        _cache_put("search", cache_key, results)
        return results

    # ---- Lookup by id ------------------------------------------------------

    def lookup(self, entity_id: str) -> Optional[EntityCandidate]:
        qid = entity_id.strip().upper()
        if not qid.startswith("Q") or not qid[1:].isdigit():
            return None
        cached = _cache_get("lookup", qid)
        if cached is not None:
            return cached or None

        try:
            r = self._client.get(_WIKIDATA_API, params={
                "action": "wbgetentities",
                "ids": qid,
                "props": "labels|descriptions|claims",
                "languages": "en",
                "format": "json",
            })
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPError as e:
            raise ProviderNotConfiguredError(f"Wikidata unreachable: {e}") from e

        ent = (data.get("entities") or {}).get(qid)
        if not ent or ent.get("missing") is not None:
            _cache_put("lookup", qid, None)
            return None
        label = ((ent.get("labels") or {}).get("en") or {}).get("value") or qid
        desc = ((ent.get("descriptions") or {}).get("en") or {}).get("value") or ""
        image = _extract_image_filename(ent)
        cand = EntityCandidate(
            entity_id=qid,
            label=label,
            description=desc,
            image_url=_commons_url(image) if image else "",
        )
        _cache_put("lookup", qid, cand)
        return cand

    # ---- Related entities via SPARQL --------------------------------------

    def related(self, entity_id: str, limit: int = 25) -> list[RelatedEntity]:
        qid = entity_id.strip().upper()
        if not qid.startswith("Q") or not qid[1:].isdigit():
            return []
        cache_key = f"{qid}|{limit}"
        cached = _cache_get("related", cache_key)
        if cached is not None:
            return cached

        sparql = _RELATED_SPARQL.format(qid=qid, limit=limit)
        try:
            r = self._client.get(_SPARQL_API, params={
                "query": sparql,
                "format": "json",
            })
            r.raise_for_status()
            payload = r.json()
        except httpx.HTTPError as e:
            raise ProviderNotConfiguredError(f"Wikidata SPARQL unreachable: {e}") from e

        bindings = (payload.get("results") or {}).get("bindings", [])
        seen: dict[str, RelatedEntity] = {}
        for row in bindings:
            related_uri = (row.get("related") or {}).get("value") or ""
            if not related_uri.startswith("http://www.wikidata.org/entity/Q"):
                continue
            rid = related_uri.rsplit("/", 1)[-1]
            if rid == qid or rid in seen:
                continue
            label = (row.get("relatedLabel") or {}).get("value") or rid
            desc = (row.get("relatedDescription") or {}).get("value") or ""
            reason = (row.get("reason") or {}).get("value") or "Related"
            image_uri = (row.get("image") or {}).get("value") or ""
            seen[rid] = RelatedEntity(
                entity_id=rid,
                label=label,
                description=desc,
                image_url=image_uri,  # SPARQL gives a direct file URL
                reason=reason,
            )

        results = list(seen.values())[:limit]
        _cache_put("related", cache_key, results)
        return results

    # ---- Helpers -----------------------------------------------------------

    def _image_for(self, qid: str) -> Optional[str]:
        cand = self.lookup(qid)
        return cand.image_url if cand else None


def _extract_image_filename(entity: dict) -> Optional[str]:
    """P18 is 'image'. Returns the bare filename (no namespace prefix) so we
    can build a Special:FilePath URL."""
    claims = (entity.get("claims") or {}).get("P18") or []
    for claim in claims:
        try:
            value = claim["mainsnak"]["datavalue"]["value"]
            if isinstance(value, str) and value:
                return value
        except (KeyError, TypeError):
            continue
    return None


def _commons_url(filename: str) -> str:
    return f"{_COMMONS_FILE}{quote(filename.replace(' ', '_'))}"
