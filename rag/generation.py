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
- If the context only partly answers the question, answer what it supports and say clearly
  what is missing -- do NOT hallucinate.
- If the context contains NOTHING relevant to the question, reply with exactly
  INSUFFICIENT_CONTEXT and nothing else.
- Cite the source file, country, and page/row (if available) when referencing specific
  information, e.g. [fields.xlsx, Norway, Row 4] or [source.pdf, India, Page 6]. The same
  page/row number can appear in different source files, so always include the source file.
- Conclude with a concise summary if the answer is long.
"""


# Reply the model gives when the retrieved passages don't address the question at all.
INSUFFICIENT_CONTEXT = "INSUFFICIENT_CONTEXT"

GENERAL_SYSTEM_PROMPT = """\
You are an expert oil and gas industry analyst (upstream, midstream, downstream, markets,
and regulation).

The user's curated knowledge base had no information on this question, so answer it from
your own general knowledge.

Instructions:
- Be accurate, structured, and concise. Use bullet points or tables when helpful.
- Do NOT cite documents, file names, pages, or rows -- you have no sources here.
- Figures, prices, and regulations change over time: give approximate values with the
  period they refer to, and say when something may be out of date.
- If you don't know, say so rather than guessing.
"""


def is_insufficient(answer: str) -> bool:
    """True when the model signalled that the context had nothing relevant."""
    return answer.strip().strip("`*_ .").upper().startswith(INSUFFICIENT_CONTEXT)


def _location_label(c: Chunk) -> str:
    source_name = Path(c.source_file).name if c.source_file else ""
    location = ""
    if c.page and c.page > 0:
        location = f"Page {c.page}"
    elif c.extra.get("row"):
        location = f"Row {c.extra['row']}"

    parts = [p for p in (source_name, c.country, location) if p]
    return f"  [{', '.join(parts)}]" if parts else ""


# Groq's free tier allows ~8k tokens per request (prompt + 2048 answer tokens),
# so the context is capped at ~4.5k tokens (~4 chars/token). Spreadsheet rows
# can be very wide, so each passage is also truncated.
MAX_CONTEXT_CHARS = 18000
MAX_PASSAGE_CHARS = 2500


def build_context_string(chunks: List[Chunk]) -> str:
    parts = []
    used = 0
    for i, c in enumerate(chunks, 1):
        text = c.text if len(c.text) <= MAX_PASSAGE_CHARS else c.text[:MAX_PASSAGE_CHARS] + " ..."
        part = f"--- Passage {i}{_location_label(c)} ---\n{text}"
        if parts and used + len(part) > MAX_CONTEXT_CHARS:
            break
        parts.append(part)
        used += len(part)
    return "\n\n".join(parts)


def generate_answer(llm: LLMProvider, question: str, chunks: List[Chunk]) -> str:
    context = build_context_string(chunks)
    user_msg = f"Context:\n{context}\n\nQuestion: {question}"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]
    return llm.call(messages, temperature=0.15, max_tokens=2048)


def generate_general_answer(llm: LLMProvider, question: str) -> str:
    """Answer from the model's own knowledge, for questions the index can't answer."""
    messages = [
        {"role": "system", "content": GENERAL_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    return llm.call(messages, temperature=0.3, max_tokens=2048)
