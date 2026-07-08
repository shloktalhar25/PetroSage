# -*- coding: utf-8 -*-
"""
rag/compression.py - Contextual compression / relevance filtering.

Uses the LLM to extract only the sentences of each passage that are directly
relevant to the question. Drops passages that compress to nothing.
"""

from typing import List

from core.models import Chunk
from data.llm import LLMProvider

COMPRESS_PROMPT = """\
You are a relevance filter. Given a user question and a text passage, extract ONLY the sentences from the passage that are directly relevant to answering the question.
If nothing is relevant, return an empty string.
Return only the extracted text, no preamble.

Question: {question}
Passage: {passage}
"""


def compress_chunks(llm: LLMProvider, question: str, chunks: List[Chunk]) -> List[Chunk]:
    """Compress each chunk to only its relevant sentences. Drops empty results."""
    compressed = []
    for chunk in chunks:
        prompt = COMPRESS_PROMPT.format(question=question, passage=chunk.text)
        try:
            result = llm.call(
                [{"role": "user", "content": prompt}],
                temperature=0.0,
                max_tokens=256,
            )
        except Exception:
            result = chunk.text  # fallback: keep original
        if result.strip():
            compressed.append(Chunk(
                id=chunk.id,
                text=result.strip(),
                page=chunk.page,
                score=chunk.score,
                extra=chunk.extra,
            ))
    return compressed
