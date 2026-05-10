"""
Pluggable public-knowledge enrichment provider for the
"Public Intelligence Enrichment / Entity Relationship Suggestions" feature.

The backend never queries an external knowledge source directly — it goes
through this interface so the choice of provider (Wikidata, a future
LinkedIn integration, a no-op for offline environments) is a single config
flag in Backend/enrichment_providers/__init__.py.

Important framing: these results are *suggestions* derived from public data,
not authoritative claims that two people are connected. The UI surfaces them
as dashed/secondary edges so an analyst can confirm before treating them as
real intelligence.
"""

from dataclasses import dataclass
from typing import Optional, Protocol


class ProviderNotConfiguredError(RuntimeError):
    """Raised when a provider that requires credentials/network was selected
    but is unusable. The API layer translates this into a 503 with a clear
    message — the rest of the app keeps working."""


@dataclass
class EntityCandidate:
    """A candidate match returned by a name search. The Step 2 UI lists these
    so an analyst can disambiguate (e.g. multiple John Smiths on Wikidata)."""
    entity_id: str       # provider-specific ID, e.g. "Q9682" for Wikidata
    label: str           # display name, e.g. "Lewis Hamilton"
    description: str     # short tagline, e.g. "British racing driver (born 1985)"
    image_url: str       # may be empty if no image is on file


@dataclass
class RelatedEntity:
    """A suggested related entity surfaced by Step 3, with the human-readable
    *reason* the provider attached to the connection."""
    entity_id: str
    label: str
    description: str
    image_url: str
    reason: str          # e.g. "Member of Mercedes-AMG Petronas", "Spouse"


class EnrichmentProvider(Protocol):
    """A read-only adapter over a public-knowledge graph."""

    name: str  # short identifier used in logs and config

    def search(self, query: str, limit: int = 5) -> list[EntityCandidate]:
        """Look up entities by name. Returns the top matches in relevance
        order. Empty list if nothing matches. Raises
        ProviderNotConfiguredError if the provider is unusable."""
        ...

    def lookup(self, entity_id: str) -> Optional[EntityCandidate]:
        """Resolve a known entity id to a fresh candidate snapshot."""
        ...

    def related(self, entity_id: str, limit: int = 25) -> list[RelatedEntity]:
        """Return suggested related entities with reasons."""
        ...
