# -*- coding: utf-8 -*-
"""
rag/generation.py - Final answer generation from retrieved context.
"""

from pathlib import Path
from typing import List

from core.models import Chunk
from data.llm import LLMProvider

SYSTEM_PROMPT = """\
You are an expert research assistant with access to a curated, multi-country knowledge base.

Instructions:
- Answer the user's question using ONLY the provided context passages.
- Be thorough, accurate, and structured. Use bullet points or numbered lists when appropriate.
- If the answer spans multiple context passages, synthesize them coherently.
- If the context does not contain enough information, say so clearly -- do NOT hallucinate.
- Cite the source file, country, and page/row (if available) when referencing specific
  information, e.g. [fields.xlsx, Norway, Row 4] or [source.pdf, India, Page 6]. The same
  page/row number can appear in different source files, so always include the source file.
- Conclude with a concise summary if the answer is long.
"""


def _location_label(c: Chunk) -> str:
    source_name = Path(c.source_file).name if c.source_file else ""
    location = ""
    if c.page and c.page > 0:
        location = f"Page {c.page}"
    elif c.extra.get("row"):
        location = f"Row {c.extra['row']}"

    parts = [p for p in (source_name, c.country, location) if p]
    return f"  [{', '.join(parts)}]" if parts else ""


def build_context_string(chunks: List[Chunk]) -> str:
    parts = []
    for i, c in enumerate(chunks, 1):
        parts.append(f"--- Passage {i}{_location_label(c)} ---\n{c.text}")
    return "\n\n".join(parts)


def generate_answer(llm: LLMProvider, question: str, chunks: List[Chunk]) -> str:
    context = build_context_string(chunks)
    user_msg = f"Context:\n{context}\n\nQuestion: {question}"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]
    return llm.call(messages, temperature=0.15, max_tokens=2048)
