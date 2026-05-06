"""No-op provider used when enrichment is disabled. Every call raises
ProviderNotConfiguredError so the API layer can return a clean 503."""

from typing import Optional

from enrichment_provider import (
    EntityCandidate,
    ProviderNotConfiguredError,
    RelatedEntity,
)


class NullProvider:
    name = "null"

    def __init__(self, reason: str) -> None:
        self._reason = reason

    def search(self, query: str, limit: int = 5) -> list[EntityCandidate]:
        raise ProviderNotConfiguredError(self._reason)

    def lookup(self, entity_id: str) -> Optional[EntityCandidate]:
        raise ProviderNotConfiguredError(self._reason)

    def related(self, entity_id: str, limit: int = 25) -> list[RelatedEntity]:
        raise ProviderNotConfiguredError(self._reason)
