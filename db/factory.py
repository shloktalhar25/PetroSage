# -*- coding: utf-8 -*-
"""
db/factory.py - Backend selection.

DevDB (Rust HNSW engine, over HTTP) is the vector-DB backend. Override with
the VECTOR_BACKEND env var if additional backends are added later.
"""

from core.config import VECTOR_BACKEND
from db.base import VectorStore


def get_vector_store() -> VectorStore:
    if VECTOR_BACKEND == "rust":
        from db.rust_store import RustVectorStore
        return RustVectorStore()
    raise ValueError(f"Unknown vector-store backend: {VECTOR_BACKEND!r}")
