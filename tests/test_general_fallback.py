# -*- coding: utf-8 -*-
"""The pipeline falls back to a general-knowledge answer only when the index can't answer."""

import numpy as np
import pytest

from core.models import Chunk
from rag import pipeline as pl
from rag.generation import is_insufficient


class FakeLLM:
    def __init__(self, grounded_reply):
        self.grounded_reply = grounded_reply
        self.calls = []

    def call(self, messages, **_):
        self.calls.append(messages[0]["content"])
        if "ONLY the provided context" in messages[0]["content"]:
            return self.grounded_reply
        return "General answer about the topic."


class FakeEmbedder:
    def encode(self, texts):
        return np.ones((len(texts), 4), dtype="float32")


class FakeRetriever:
    def __init__(self, chunks):
        self.chunks = chunks

    def retrieve(self, vec, k, country=None):
        return list(self.chunks)


def make_pipeline(monkeypatch, chunks, grounded_reply):
    monkeypatch.setattr(pl, "expand_query", lambda llm, q: ([], ""))
    monkeypatch.setattr(pl, "mmr_rerank", lambda cands, qv, emb, k: cands[:k])
    p = object.__new__(pl.RAGPipeline)  # skip __init__: no DevDB / model / API key needed
    p.llm, p.embedder, p.retriever = FakeLLM(grounded_reply), FakeEmbedder(), FakeRetriever(chunks)
    p.compress = p.crag = False
    return p


CHUNKS = [Chunk(id=1, text="Brent averaged $80/bbl in 2025.", page=2, score=0.9, source_file="a.pdf")]


@pytest.mark.parametrize("reply", ["INSUFFICIENT_CONTEXT", "  **INSUFFICIENT_CONTEXT**", "`INSUFFICIENT_CONTEXT`."])
def test_sentinel_detection(reply):
    assert is_insufficient(reply)


def test_normal_answer_is_not_sentinel():
    assert not is_insufficient("Brent averaged $80/bbl [a.pdf, Page 2].")


def test_grounded_answer_is_kept(monkeypatch):
    p = make_pipeline(monkeypatch, CHUNKS, "Brent averaged $80/bbl [a.pdf, Page 2].")
    resp = p.query("brent price?", general_fallback=True)
    assert resp.answer_source == "knowledge_base"
    assert resp.chunks and "Brent" in resp.answer
    assert len(p.llm.calls) == 1


def test_falls_back_when_context_is_irrelevant(monkeypatch):
    p = make_pipeline(monkeypatch, CHUNKS, "INSUFFICIENT_CONTEXT")
    resp = p.query("what is a christmas tree in drilling?", general_fallback=True)
    assert resp.answer_source == "general"
    assert resp.answer == "General answer about the topic."
    assert resp.chunks == []  # no citations for a general answer


def test_falls_back_when_nothing_retrieved(monkeypatch):
    p = make_pipeline(monkeypatch, [], "unused")
    resp = p.query("anything", general_fallback=True)
    assert resp.answer_source == "general"


def test_without_fallback_says_not_found(monkeypatch):
    p = make_pipeline(monkeypatch, CHUNKS, "INSUFFICIENT_CONTEXT")
    resp = p.query("off-topic question")  # CLI default: no fallback
    assert resp.answer == pl.NOT_FOUND_MESSAGE
    assert resp.answer_source == "knowledge_base" and resp.chunks == []
    assert len(p.llm.calls) == 1
