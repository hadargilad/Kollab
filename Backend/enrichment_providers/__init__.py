"""Provider factory for the Public Intelligence Enrichment feature.
Reads ENRICHMENT_PROVIDER at import time and exposes a single module-level
`provider` instance."""

import logging
import os

from enrichment_provider import EnrichmentProvider

from .null_provider import NullProvider
from .wikidata import WikidataProvider


_log = logging.getLogger("audiointel.enrichment")


def _build_provider() -> EnrichmentProvider:
    choice = (os.getenv("ENRICHMENT_PROVIDER") or "wikidata").strip().lower()

    if choice == "null":
        _log.info("Enrichment provider disabled (ENRICHMENT_PROVIDER=null).")
        return NullProvider("Enrichment is disabled (ENRICHMENT_PROVIDER=null).")

    if choice == "wikidata":
        _log.info("Enrichment provider: Wikidata.")
        return WikidataProvider()

    _log.warning("Unknown ENRICHMENT_PROVIDER=%r — falling back to disabled.", choice)
    return NullProvider(f"Unknown ENRICHMENT_PROVIDER={choice!r}.")


provider: EnrichmentProvider = _build_provider()
