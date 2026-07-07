# -*- coding: utf-8 -*-
"""Unit tests for MMR re-ranking using a fake embedder (no model load)."""

import numpy as np

from core.models import Chunk
from rag.rerank import mmr_rerank


class FakeEmbedder:
    """Maps chunk text -> a fixed unit vector, so tests are deterministic."""

    def __init__(self, vectors):
        self.vectors = vectors  # {text: np.ndarray}

    def encode(self, texts):
        return np.vstack([self.vectors[t] for t in texts]).astype("float32")


def _unit(v):
    v = np.array(v, dtype="float32")
    return v / np.linalg.norm(v)


def test_mmr_returns_k():
    vecs = {
        "a": _unit([1, 0, 0]),
        "b": _unit([0, 1, 0]),
        "c": _unit([0, 0, 1]),
        "d": _unit([1, 1, 0]),
    }
    candidates = [Chunk(id=i, text=t, page=1, score=1.0) for i, t in enumerate("abcd")]
    query_vec = _unit([1, 0, 0])
    result = mmr_rerank(candidates, query_vec, FakeEmbedder(vecs), k=2, lam=0.6)
    assert len(result) == 2


def test_mmr_picks_most_relevant_first():
    vecs = {
        "near": _unit([1, 0, 0]),
        "far": _unit([0, 0, 1]),
        "mid": _unit([1, 1, 0]),
    }
    candidates = [Chunk(id=i, text=t, page=1, score=1.0)
                  for i, t in enumerate(["near", "far", "mid"])]
    query_vec = _unit([1, 0, 0])
    result = mmr_rerank(candidates, query_vec, FakeEmbedder(vecs), k=2, lam=1.0)
    # lam=1.0 -> pure relevance: the closest vector to the query wins first.
    assert result[0].text == "near"


def test_mmr_no_rerank_when_fewer_than_k():
    candidates = [Chunk(id=0, text="a", page=1, score=1.0)]
    result = mmr_rerank(candidates, np.array([1.0, 0, 0]), FakeEmbedder({}), k=6)
    assert result == candidates
