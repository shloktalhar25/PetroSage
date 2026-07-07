# -*- coding: utf-8 -*-
"""Unit tests for the chunking logic (no network / model required)."""

from repository.chunking import (
    merge_blocks_into_paragraphs,
    token_approx,
    split_paragraph,
    create_chunks,
    finalize_chunks,
)


def test_token_approx():
    assert token_approx("a" * 400) == 100
    assert token_approx("") == 0


def test_merge_blocks_same_page_join():
    blocks = [
        {"text": "Hello", "page": 1},
        {"text": "world", "page": 1},
        {"text": "Next page", "page": 2},
    ]
    paras = merge_blocks_into_paragraphs(blocks)
    assert len(paras) == 2
    assert paras[0]["text"] == "Hello world"
    assert paras[1]["text"] == "Next page"


def test_merge_blocks_empty():
    assert merge_blocks_into_paragraphs([]) == []


def test_split_paragraph_overlap():
    words = " ".join(str(i) for i in range(1000))
    para = {"text": words, "page": 1}
    chunks = split_paragraph(para, chunk_size=512, overlap=80)
    assert len(chunks) >= 2
    # Every chunk carries page metadata and a chunk_index.
    assert all(c["page"] == 1 for c in chunks)
    assert [c["chunk_index"] for c in chunks] == list(range(len(chunks)))


def test_create_chunks_splits_long_paragraphs():
    # One long paragraph that will be split; create_chunks no longer assigns
    # id/hash - that's finalize_chunks's job, so multiple sources can share
    # one global id space.
    long_text = " ".join(["word"] * 3000)
    blocks = [{"text": long_text, "page": 1}]
    chunks = create_chunks(blocks)
    assert len(chunks) > 1
    assert all("id" not in c for c in chunks)


def test_create_chunks_drops_tiny_fragments():
    blocks = [{"text": "too short", "page": 1}]
    assert create_chunks(blocks) == []


def test_finalize_chunks_assigns_ids_and_hashes():
    chunks = [{"text": "a"}, {"text": "b"}, {"text": "c"}]
    finalized = finalize_chunks(chunks)
    assert [c["id"] for c in finalized] == [0, 1, 2]
    assert all("hash" in c for c in finalized)


def test_finalize_chunks_ids_are_global_across_sources():
    # Simulates combining chunks from two different source files.
    from_pdf = [{"text": "pdf chunk 1"}, {"text": "pdf chunk 2"}]
    from_csv = [{"text": "csv row 1"}]
    combined = finalize_chunks(from_pdf + from_csv)
    assert [c["id"] for c in combined] == [0, 1, 2]
