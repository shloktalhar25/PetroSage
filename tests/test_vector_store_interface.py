# -*- coding: utf-8 -*-
"""
Proves the VectorStore seam: a trivial in-memory backend satisfies the
interface (create/insert/search/save/load) AND drives store/retriever without
needing DevDB or a live server. This is the conformance test any backend
(including RustVectorStore) must pass.
"""

from typing import List, Dict, Tuple, Any, Optional

import numpy as np

from core.config import MIN_SCORE
from db.base import VectorStore
from store.retriever import Retriever


class InMemoryVectorStore(VectorStore):
    """Brute-force cosine-similarity store, no external deps."""

    def __init__(self):
        self.vectors: List[np.ndarray] = []
        self.records: List[Dict[str, Any]] = []
        self.dim: int = 0

    def create(self, dim: int) -> None:
        self.dim = dim
        self.vectors = []
        self.records = []

    def insert(self, id: int, vector: np.ndarray, record: Dict[str, Any]) -> None:
        self.vectors.append(np.array(vector, dtype="float32"))
        self.records.append(record)

    def search(
        self, vector: np.ndarray, k: int, country: Optional[str] = None
    ) -> List[Tuple[Dict[str, Any], float]]:
        candidates = [
            (i, r) for i, r in enumerate(self.records)
            if country is None or r.get("country") == country
        ]
        if not candidates:
            return []
        idxs = [i for i, _ in candidates]
        matrix = np.vstack([self.vectors[i] for i in idxs])
        sims = matrix @ np.array(vector, dtype="float32")
        order = np.argsort(sims)[::-1][:k]
        return [(candidates[i][1], float(sims[i])) for i in order]

    def save(self) -> None:  # not needed for the test
        pass

    def load(self) -> None:
        pass

    @property
    def count(self) -> int:
        return len(self.records)


def _unit(v):
    v = np.array(v, dtype="float32")
    return v / np.linalg.norm(v)


def test_in_memory_store_conforms_and_drives_retriever():
    store = InMemoryVectorStore()
    vectors = np.vstack([_unit([1, 0, 0]), _unit([0, 1, 0]), _unit([0, 0, 1])])
    records = [
        {"id": 0, "text": "x axis", "page": 1},
        {"id": 1, "text": "y axis", "page": 2},
        {"id": 2, "text": "z axis", "page": 3},
    ]
    store.add(vectors, records)  # base-class default: create() + insert() loop
    assert store.count == 3

    retriever = Retriever(store)
    chunks = retriever.retrieve(_unit([1, 0, 0]), k=3)

    # Highest-similarity record comes back first, as a Chunk with metadata.
    assert chunks[0].id == 0
    assert chunks[0].text == "x axis"
    assert chunks[0].page == 1
    # The score floor is applied by the retriever.
    assert all(c.score >= MIN_SCORE for c in chunks)


def test_insert_is_usable_directly_without_add():
    store = InMemoryVectorStore()
    store.create(dim=2)
    store.insert(0, _unit([1, 0]), {"id": 0, "text": "a", "page": 1})
    store.insert(1, _unit([0, 1]), {"id": 1, "text": "b", "page": 2})
    assert store.count == 2

    hits = store.search(_unit([1, 0]), k=2)
    assert hits[0][0]["text"] == "a"


def test_country_filter_restricts_results():
    store = InMemoryVectorStore()
    store.create(dim=2)
    store.insert(0, _unit([1, 0]), {"id": 0, "text": "norway field", "page": 1, "country": "Norway"})
    store.insert(1, _unit([1, 0]), {"id": 1, "text": "us field", "page": 1, "country": "US"})

    all_hits = store.search(_unit([1, 0]), k=2)
    assert len(all_hits) == 2

    norway_hits = store.search(_unit([1, 0]), k=2, country="Norway")
    assert len(norway_hits) == 1
    assert norway_hits[0][0]["text"] == "norway field"

    retriever = Retriever(store)
    chunks = retriever.retrieve(_unit([1, 0]), k=2, country="US")
    assert len(chunks) == 1
    assert chunks[0].country == "US"
