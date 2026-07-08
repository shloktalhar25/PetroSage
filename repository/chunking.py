# -*- coding: utf-8 -*-
"""
repository/chunking.py - Hierarchical, paragraph-aware chunking.

Merges consecutive same-page blocks into paragraphs, then splits any long
paragraph into overlapping token-sized chunks. id/hash assignment is a
separate step (finalize_chunks) so multiple source files can share one
globally-unique id space.
"""

import hashlib
from typing import List, Dict

from core.config import CHUNK_SIZE, CHUNK_OVERLAP, MIN_CHUNK_CHARS
from core.console import console


def merge_blocks_into_paragraphs(blocks: List[Dict]) -> List[Dict]:
    """Merge consecutive same-page blocks separated by small gaps."""
    if not blocks:
        return []

    paragraphs = []
    current = blocks[0].copy()

    for b in blocks[1:]:
        same_page = (b["page"] == current["page"])
        if same_page:
            current["text"] += " " + b["text"]
        else:
            paragraphs.append(current)
            current = b.copy()

    paragraphs.append(current)
    return paragraphs


def token_approx(text: str) -> int:
    return len(text) // 4


def split_paragraph(para: Dict, chunk_size: int, overlap: int) -> List[Dict]:
    """Split a long paragraph into overlapping chunks."""
    text = para["text"]
    words = text.split()
    chunks = []
    step = max(1, chunk_size - overlap)

    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk_text = " ".join(words[start:end])
        chunk = {
            **{k: v for k, v in para.items() if k != "text"},
            "text": chunk_text,
            "chunk_index": len(chunks),
        }
        chunks.append(chunk)
        if end == len(words):
            break
        start += step

    return chunks


def create_chunks(blocks: List[Dict]) -> List[Dict]:
    """Full chunking pipeline: merge -> paragraph split -> size split."""
    paragraphs = merge_blocks_into_paragraphs(blocks)
    all_chunks: List[Dict] = []

    for para in paragraphs:
        t_len = token_approx(para["text"])
        if t_len <= CHUNK_SIZE:
            if len(para["text"]) >= MIN_CHUNK_CHARS:
                para["chunk_index"] = 0
                all_chunks.append(para)
        else:
            sub = split_paragraph(para, CHUNK_SIZE, CHUNK_OVERLAP)
            for s in sub:
                if len(s["text"]) >= MIN_CHUNK_CHARS:
                    all_chunks.append(s)

    return all_chunks


def finalize_chunks(chunks: List[Dict]) -> List[Dict]:
    """Assign globally-unique sequential ids + content hashes across all sources.

    Called once, after chunks from every source file (PDF, CSV, Excel, ...)
    have been collected, so ids never collide across files.
    """
    for i, c in enumerate(chunks):
        c["id"] = i
        c["hash"] = hashlib.md5(c["text"].encode()).hexdigest()
    console.print(f"  [cyan]Finalized[/cyan] {len(chunks)} chunks")
    return chunks
