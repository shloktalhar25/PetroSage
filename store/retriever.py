# -*- coding: utf-8 -*-
"""
store/retriever.py - The read/search service layer ("interacting with the DB").

Sits on top of the VectorStore interface (never touches FAISS directly). It
turns raw (record, score) hits into Chunk objects, applies the score floor, and
deduplicates across multi-query retrieval.
"""

from typing import List, Dict, Optional

# pyrefly: ignore [import-error, missing-import]
import numpy as np

from core.config import MIN_SCORE
from core.models import Chunk
from db.base import VectorStore

_CHUNK_FIELDS = ("id", "text", "page", "country", "source_file")


class Retriever:
    def __init__(self, store: VectorStore):
        self.store = store

    def retrieve(
        self, query_vec: np.ndarray, k: int, country: Optional[str] = None
    ) -> List[Chunk]:
        """Search the store for one query vector -> list of Chunk objects."""
        hits = self.store.search(query_vec, k, country=country)
        results: List[Chunk] = []
        for record, score in hits:
            if score < MIN_SCORE:
                continue
            results.append(Chunk(
                id=record["id"],
                text=record["text"],
                page=record.get("page", -1),
                score=score,
                country=record.get("country", ""),
                source_file=record.get("source_file", ""),
                extra={x: v for x, v in record.items() if x not in _CHUNK_FIELDS},
            ))
        return results


def deduplicate(chunks: List[Chunk]) -> List[Chunk]:
    """Keep the highest-scored occurrence of each chunk id, sorted by score."""
    seen: Dict[int, Chunk] = {}
    for c in chunks:
        if c.id not in seen or c.score > seen[c.id].score:
            seen[c.id] = c
    return sorted(seen.values(), key=lambda x: x.score, reverse=True)
