# -*- coding: utf-8 -*-
"""
rag/expansion.py - Query expansion (HyDE + multi-query).

Given a user question, generate diverse alternative queries plus a hypothetical
answer passage for HyDE retrieval.
"""

import json
from typing import List, Tuple

from core.config import EXPANSION_N
from core.console import console
from data.llm import LLMProvider

EXPANSION_PROMPT = """\
You are a search query expansion assistant.
Given a user question, generate {n} diverse alternative search queries that cover different aspects or phrasings of the original question.
Also write a short hypothetical answer passage that would perfectly answer the question (used for HyDE retrieval).

Respond ONLY with valid JSON matching this schema:
{{
  "alternative_queries": ["query1", "query2", ...],
  "hypothetical_passage": "A short paragraph that would be the ideal answer..."
}}

User question: {question}
"""


def expand_query(llm: LLMProvider, question: str, n: int = EXPANSION_N) -> Tuple[List[str], str]:
    """Return (alternative_queries, hypothetical_passage)."""
    prompt = EXPANSION_PROMPT.format(n=n, question=question)
    try:
        raw = llm.call(
            [{"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=512,
        )
        # Strip markdown code fences if present
        raw = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = json.loads(raw)
        alt_queries = data.get("alternative_queries", [])[:n]
        hypo = data.get("hypothetical_passage", "")
        return alt_queries, hypo
    except Exception as e:
        console.log(f"[yellow]Query expansion failed ({e}), using original query only.[/yellow]")
        return [], ""
