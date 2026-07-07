# -*- coding: utf-8 -*-
"""
db/rust_store.py - HTTP client for DevDB, the custom Rust HNSW vector engine.

DevDB (db/DevDB/) is a single-node, in-memory vector search engine with a
graph-based HNSW index (~O(log n) approximate nearest-neighbor search) and
conjunctive metadata filtering. It runs as a small HTTP server
(db/DevDB/src/bin/server.rs); this module is the Python-side client that
implements the VectorStore interface against it.

Distance <-> similarity: DevDB returns cosine *distance* (0 = identical,
lower = closer). This client converts to similarity via `1 - distance`, which
for unit-normalized vectors is exactly cosine similarity / inner product -
matching what the rest of the pipeline (MIN_SCORE floor, MMR, dedup) expects.
"""

from typing import List, Dict, Tuple, Any, Optional

# pyrefly: ignore [import-error, missing-import]
import httpx
# pyrefly: ignore [import-error, missing-import]
import numpy as np

from core.config import (
    DEVDB_URL, SNAPSHOT_PATH, HNSW_M, HNSW_EF_CONSTRUCTION, HNSW_EF_SEARCH,
)
from db.base import VectorStore

_INSERT_BATCH_SIZE = 256


class RustVectorStore(VectorStore):
    """DevDB-backed VectorStore, talking to the devdb-server HTTP API."""

    def __init__(self, base_url: str = DEVDB_URL, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout)
        self.records: List[Dict[str, Any]] = []
        self._by_id: Dict[int, Dict[str, Any]] = {}
        self._buffer: List[Dict[str, Any]] = []
        self.source: str = ""
        self._dim: int = 0

    # ── HTTP helper ─────────────────────────────────────────────────────────
    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            resp = self._client.post(path, json=payload)
        except httpx.ConnectError as e:
            raise RuntimeError(
                f"Could not reach DevDB server at {self.base_url}. "
                "Start it first: `make serve` (or `docker compose up`) in db/DevDB/."
            ) from e
        if resp.status_code >= 400:
            raise RuntimeError(f"DevDB request to {path} failed: {resp.text}")
        if resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return {}

    # ── Write path ──────────────────────────────────────────────────────────
    def create(self, dim: int) -> None:
        self._dim = dim
        self.records = []
        self._by_id = {}
        self._buffer = []
        self._post("/collection", {
            "dim": dim,
            "m": HNSW_M,
            "ef_construction": HNSW_EF_CONSTRUCTION,
            "ef_search": HNSW_EF_SEARCH,
        })

    def insert(self, id: int, vector: np.ndarray, record: Dict[str, Any]) -> None:
        self.records.append(record)
        self._by_id[id] = record
        self._buffer.append({
            "id": id,
            "vector": np.asarray(vector, dtype="float32").tolist(),
            "page": float(record["page"]) if record.get("page") is not None else None,
            "country": record.get("country") or None,
        })
        if len(self._buffer) >= _INSERT_BATCH_SIZE:
            self._flush()

    def _flush(self) -> None:
        if not self._buffer:
            return
        self._post("/points", {"points": self._buffer})
        self._buffer = []

    # ── Read path ───────────────────────────────────────────────────────────
    def search(
        self, vector: np.ndarray, k: int, country: Optional[str] = None
    ) -> List[Tuple[Dict[str, Any], float]]:
        body = {
            "vector": np.asarray(vector, dtype="float32").tolist(),
            "top_k": k,
        }
        if country:
            body["country"] = country
        resp = self._post("/search", body)
        results: List[Tuple[Dict[str, Any], float]] = []
        for hit in resp.get("results", []):
            record = self._by_id.get(hit["id"])
            if record is None:
                continue
            similarity = 1.0 - hit["distance"]
            results.append((record, similarity))
        return results

    # ── Persistence ─────────────────────────────────────────────────────────
    def save(self) -> None:
        self._flush()
        from core.config import INDEX_DIR, CHUNKS_PATH, META_PATH, EMBED_MODEL, CHUNK_SIZE, CHUNK_OVERLAP
        import json
        import pickle

        INDEX_DIR.mkdir(exist_ok=True)
        self._post("/save", {"path": str(SNAPSHOT_PATH.resolve())})

        with open(CHUNKS_PATH, "wb") as f:
            pickle.dump(self.records, f)

        meta = {
            "source": self.source,
            "num_chunks": len(self.records),
            "embed_model": EMBED_MODEL,
            "chunk_size": CHUNK_SIZE,
            "chunk_overlap": CHUNK_OVERLAP,
            "backend": "devdb",
        }
        META_PATH.write_text(json.dumps(meta, indent=2))

    def load(self) -> None:
        from core.config import CHUNKS_PATH, META_PATH
        import json
        import pickle

        if not SNAPSHOT_PATH.exists():
            raise FileNotFoundError(
                f"Index not found at '{SNAPSHOT_PATH}'.\n"
                "Run  python ingest.py  first to build the index."
            )
        info = self._post("/load", {"path": str(SNAPSHOT_PATH.resolve())})
        self._dim = info.get("dim", 0)

        with open(CHUNKS_PATH, "rb") as f:
            self.records = pickle.load(f)
        self._by_id = {r["id"]: r for r in self.records}
        self.meta = json.loads(META_PATH.read_text())

    @property
    def count(self) -> int:
        return len(self.records)
