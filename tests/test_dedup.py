# -*- coding: utf-8 -*-
"""Unit tests for deduplication in the retriever."""

from core.models import Chunk
from store.retriever import deduplicate


def test_dedup_keeps_highest_score():
    chunks = [
        Chunk(id=1, text="a", page=1, score=0.5),
        Chunk(id=1, text="a", page=1, score=0.9),
        Chunk(id=2, text="b", page=1, score=0.7),
    ]
    result = deduplicate(chunks)
    assert len(result) == 2
    by_id = {c.id: c for c in result}
    assert by_id[1].score == 0.9
    assert by_id[2].score == 0.7


def test_dedup_sorted_descending():
    chunks = [
        Chunk(id=1, text="a", page=1, score=0.3),
        Chunk(id=2, text="b", page=1, score=0.8),
        Chunk(id=3, text="c", page=1, score=0.6),
    ]
    scores = [c.score for c in deduplicate(chunks)]
    assert scores == sorted(scores, reverse=True)


def test_dedup_empty():
    assert deduplicate([]) == []
