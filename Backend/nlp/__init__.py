"""NLP subpackage — text-layer analysis on top of stored Segments.

Currently owned by Ofir (coded-language detection). Hadar's semantic_search and
Ofek's NER/entity_resolution will live alongside in this package; both will
share the model singletons in `models.py`.
"""

from .coded_language import score_coded_language  # noqa: F401
from .euphemism_expansion import expand_euphemisms  # noqa: F401
