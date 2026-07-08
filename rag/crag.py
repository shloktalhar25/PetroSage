# -*- coding: utf-8 -*-
"""
rag/crag.py - Corrective RAG evaluation.

Evaluates retrieved chunks for relevance to the question.
"""

import json
from typing import List

from core.models import Chunk
from data.llm import LLMProvider
from core.console import console

# The user explicitly requested to use this model for the CRAG evaluation.
CRAG_MODEL = "qwen/qwen3-32b"


def evaluate_chunks(question: str, chunks: List[Chunk], verbose: bool = False) -> List[Chunk]:
    """
    Corrective RAG: Evaluate whether the retrieved chunks are relevant to the question.
    Only keep chunks that are relevant.
    """
    if not chunks:
        return []

    # Instantiate the LLM provider with the requested model.
    try:
        crag_llm = LLMProvider(model=CRAG_MODEL)
    except Exception as e:
        if verbose:
            console.log(f"[yellow]CRAG initialization failed:[/yellow] {e}")
        return chunks

    # Build prompt
    chunks_text = ""
    for i, c in enumerate(chunks):
        chunks_text += f"\n--- Chunk {i} ---\n{c.text}\n"

    prompt = f"""You are a strict relevance evaluator. 
Given the following question and a list of retrieved document chunks, determine if each chunk contains information relevant to answering the question.
Respond with a JSON array of booleans, where true means relevant and false means irrelevant. 
The array must have exactly {len(chunks)} elements corresponding to the chunks in order.
Do not provide any explanation, markdown formatting, or text outside the JSON array. Just output the JSON array.

Question: {question}

Chunks:
{chunks_text}
"""
    try:
        messages = [{"role": "user", "content": prompt}]
        response = crag_llm.call(messages, temperature=0.0, max_tokens=256)
        
        response_text = response.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()
        elif response_text.startswith("```"):
            response_text = response_text[3:-3].strip()

        is_relevant_list = json.loads(response_text)
        
        if not isinstance(is_relevant_list, list) or len(is_relevant_list) != len(chunks):
            if verbose:
                console.log(f"[yellow]CRAG returned invalid shape:[/yellow] {is_relevant_list}")
            return chunks

        relevant_chunks = [c for c, is_rev in zip(chunks, is_relevant_list) if is_rev]
        
        if verbose:
            console.log(f"[blue]CRAG filtered chunks[/blue]: {len(chunks)} -> {len(relevant_chunks)}")
            
        return relevant_chunks
    except Exception as e:
        if verbose:
            console.log(f"[yellow]CRAG evaluation failed:[/yellow] {e}")
        return chunks
