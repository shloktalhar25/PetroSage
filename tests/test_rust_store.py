# -*- coding: utf-8 -*-
"""
Live end-to-end test against a running DevDB server. Skips automatically if
the server isn't reachable (start it with `make serve` in db/DevDB/, or via
`docker compose up` there) so this doesn't fail CI/local runs that don't have
the Rust server running.
"""

import numpy as np
import os

import pytest

# pyrefly: ignore [import-error, missing-import]
import httpx

from core.config import DEVDB_URL
from db.rust_store import RustVectorStore


def _server_is_up() -> bool:
    try:
        resp = httpx.get(f"{DEVDB_URL}/health", timeout=1.0)
        return resp.status_code == 200
    except httpx.HTTPError:
        return False


# These tests replace the server's loaded collection, which breaks a running app,
# so they only run when explicitly requested: DEVDB_LIVE_TESTS=1 pytest
pytestmark = pytest.mark.skipif(
    os.getenv("DEVDB_LIVE_TESTS") != "1" or not _server_is_up(),
    reason="set DEVDB_LIVE_TESTS=1 with a DevDB server running (it overwrites the loaded index)",
)


def _unit(v):
    v = np.array(v, dtype="float32")
    return v / np.linalg.norm(v)


def test_insert_and_search_round_trip():
    store = RustVectorStore()
    store.create(dim=3)
    store.insert(100, _unit([1, 0, 0]), {"id": 100, "text": "x axis", "page": 1})
    store.insert(200, _unit([0, 1, 0]), {"id": 200, "text": "y axis", "page": 2})
    store.insert(300, _unit([0, 0, 1]), {"id": 300, "text": "z axis", "page": 3})
    store._flush()

    assert store.count == 3

    hits = store.search(_unit([1, 0, 0]), k=3)
    assert hits[0][0]["text"] == "x axis"
    # Identical vector -> distance 0 -> similarity 1.0.
    assert hits[0][1] == pytest.approx(1.0, abs=1e-5)
    # Similarity is sorted descending (closest first).
    scores = [s for _, s in hits]
    assert scores == sorted(scores, reverse=True)


def test_page_payload_round_trips():
    store = RustVectorStore()
    store.create(dim=2)
    store.insert(1, _unit([1, 0]), {"id": 1, "text": "a", "page": 42})
    store._flush()

    hits = store.search(_unit([1, 0]), k=1)
    assert hits[0][0]["page"] == 42


def test_country_filter_round_trip():
    store = RustVectorStore()
    store.create(dim=2)
    store.insert(1, _unit([1, 0]), {"id": 1, "text": "norway field", "page": 1, "country": "Norway"})
    store.insert(2, _unit([1, 0]), {"id": 2, "text": "us field", "page": 1, "country": "US"})
    store._flush()

    all_hits = store.search(_unit([1, 0]), k=2)
    assert len(all_hits) == 2

    norway_hits = store.search(_unit([1, 0]), k=2, country="Norway")
    assert len(norway_hits) == 1
    assert norway_hits[0][0]["text"] == "norway field"
