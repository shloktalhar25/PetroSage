# -*- coding: utf-8 -*-
"""
db/base.py - The VectorStore interface.

This is the seam that decouples the application from any particular vector
database. Today it is implemented by RustVectorStore (DevDB, our from-scratch
HNSW engine, reached over HTTP). Nothing in the store/, rag/, or repository/
layers needs to change to swap backends — they only ever touch this interface.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Tuple, Any, Optional

# pyrefly: ignore [import-error, missing-import]
import numpy as np


class VectorStore(ABC):
    """Abstract contract every vector-DB backend must satisfy.

    A "record" is the per-chunk metadata dict (id, text, page, ...). Vectors
    and records are added in parallel: vectors[i] corresponds to records[i].
    """

    @abstractmethod
    def create(self, dim: int) -> None:
        """Initialize a fresh, empty collection of the given dimensionality."""
        raise NotImplementedError

    @abstractmethod
    def insert(self, id: int, vector: "np.ndarray", record: Dict[str, Any]) -> None:
        """Insert a single vector and its metadata record under `id`."""
        raise NotImplementedError

    def add(self, vectors: "np.ndarray", records: List[Dict[str, Any]]) -> None:
        """Bulk-load convenience: create(dim) then insert() each vector/record pair.

        Backends may override this for a more efficient bulk path, but the
        default loop is correct for any conforming backend.
        """
        self.create(vectors.shape[1])
        for i, record in enumerate(records):
            self.insert(record["id"], vectors[i], record)

    @abstractmethod
    def search(
        self, vector: "np.ndarray", k: int, country: Optional[str] = None
    ) -> List[Tuple[Dict[str, Any], float]]:
        """Return up to k (record, score) pairs most similar to `vector`.

        Scores are cosine similarity (inner product on L2-normalised vectors);
        higher is more relevant. If `country` is given, results are restricted
        to records tagged with that country. Score thresholding (MIN_SCORE) is
        a caller concern.
        """
        raise NotImplementedError

    @abstractmethod
    def save(self) -> None:
        """Persist the store to disk."""
        raise NotImplementedError

    @abstractmethod
    def load(self) -> None:
        """Load the store from disk."""
        raise NotImplementedError

    @property
    @abstractmethod
    def count(self) -> int:
        """Number of records currently held."""
        raise NotImplementedError
