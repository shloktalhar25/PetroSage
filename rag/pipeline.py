# -*- coding: utf-8 -*-
"""
rag/pipeline.py - The RAG orchestrator.

Wires the retrieval (store), providers (data), and RAG steps together:
  query expansion (HyDE + multi-query) -> multi-query retrieval -> dedup
  -> MMR re-rank -> optional contextual compression -> answer generation.
"""

from typing import List, Optional

from core.config import GROQ_MODEL, TOP_K, MMR_K
from core.console import console
from core.models import Chunk, RAGResponse
from data.embeddings import Embedder
from data.llm import LLMProvider
from db import get_vector_store
from store.retriever import Retriever, deduplicate
from rag.expansion import expand_query
from rag.rerank import mmr_rerank
from rag.compression import compress_chunks
from rag.generation import generate_answer, generate_general_answer, is_insufficient
from rag.crag import evaluate_chunks

NOT_FOUND_MESSAGE = "I could not find relevant information in the knowledge base for your question."
CRAG_EMPTY_MESSAGE = (
    "Based on my evaluation (Corrective RAG), none of the retrieved information is relevant "
    "to your question. Therefore, I cannot provide a factual answer."
)


class RAGPipeline:
    def __init__(self, compress: bool = False, crag: bool = False):
        """
        Args:
            compress: Enable LLM-based contextual compression (extra API calls).
            crag: Enable Corrective RAG to filter out irrelevant chunks.
        """
        store = get_vector_store()
        store.load()
        self.retriever = Retriever(store)
        self.embedder  = Embedder.get()
        self.llm       = LLMProvider()
        self.compress  = compress
        self.crag      = crag

    def _no_answer(
        self, question: str, queries: List[str], message: str, general_fallback: bool
    ) -> RAGResponse:
        """The index couldn't answer: fall back to the model's own knowledge, or say so."""
        if general_fallback:
            return RAGResponse(
                answer=generate_general_answer(self.llm, question),
                chunks=[],
                queries_used=queries,
                model=GROQ_MODEL,
                answer_source="general",
            )
        return RAGResponse(answer=message, chunks=[], queries_used=queries, model=GROQ_MODEL)

    def query(
        self,
        question: str,
        verbose: bool = False,
        country: Optional[str] = None,
        general_fallback: bool = False,
    ) -> RAGResponse:
        """
        Args:
            general_fallback: When nothing relevant is retrieved, answer from the LLM's
                own knowledge (marked answer_source="general") instead of declining.
        """
        # 1. Query expansion
        alt_queries, hypo_passage = expand_query(self.llm, question)

        # 2. Build all query vectors (original + alternatives + HyDE)
        all_queries = [question] + alt_queries
        if hypo_passage:
            all_queries.append(hypo_passage)

        if verbose:
            console.log(f"[blue]Expanded queries[/blue] ({len(all_queries)}): {all_queries}")

        # 3. Multi-query retrieval
        all_candidates: List[Chunk] = []
        for q in all_queries:
            vec = self.embedder.encode([q])[0]
            hits = self.retriever.retrieve(vec, TOP_K, country=country)
            all_candidates.extend(hits)

        if not all_candidates:
            return self._no_answer(question, all_queries, NOT_FOUND_MESSAGE, general_fallback)

        # 4. Deduplicate
        candidates = deduplicate(all_candidates)
        if verbose:
            console.log(f"[blue]Candidates after dedup[/blue]: {len(candidates)}")

        # 5. MMR re-rank
        query_vec = self.embedder.encode([question])[0]
        final_chunks = mmr_rerank(candidates, query_vec, self.embedder, k=MMR_K)

        # 5.5 Optional Corrective RAG (CRAG) evaluation
        if self.crag:
            original_len = len(final_chunks)
            final_chunks = evaluate_chunks(question, final_chunks, verbose=verbose)
            
            # Print explicit CRAG feedback to the console
            console.print(f"  [dim]↳ CRAG evaluated chunks: retained {len(final_chunks)} of {original_len} relevant chunks.[/dim]")

            if not final_chunks:
                # If all chunks were deemed irrelevant
                return self._no_answer(question, all_queries, CRAG_EMPTY_MESSAGE, general_fallback)

        # 6. Optional contextual compression
        if self.compress:
            final_chunks = compress_chunks(self.llm, question, final_chunks)
            if verbose:
                console.log(f"[blue]After compression[/blue]: {len(final_chunks)} chunks remain")

        # 7. Generate answer
        answer = generate_answer(self.llm, question, final_chunks)
        if is_insufficient(answer):
            return self._no_answer(question, all_queries, NOT_FOUND_MESSAGE, general_fallback)

        return RAGResponse(
            answer=answer,
            chunks=final_chunks,
            queries_used=all_queries,
            model=GROQ_MODEL,
        )
