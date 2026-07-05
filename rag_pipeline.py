# -*- coding: utf-8 -*-
"""
rag_pipeline.py - Advanced RAG pipeline with:
  * Query expansion (HyDE -- hypothetical document embeddings)
  * Multi-query retrieval
  * MMR (Maximal Marginal Relevance) re-ranking for diversity
  * Contextual compression / relevance scoring
  * Groq LLM (openai/gpt-oss-120b)
"""

import os
import sys
import json
import pickle
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, field

# pyrefly: ignore [missing-import]
import numpy as np
# pyrefly: ignore [import-error, missing-import]
import faiss
# pyrefly: ignore [import-error, missing-import]
from sentence_transformers import SentenceTransformer
# pyrefly: ignore [import-error, missing-import]
from groq import Groq
# pyrefly: ignore [import-error, missing-import]
from rich.console import Console
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv(override=True)

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
INDEX_DIR       = Path("index")
INDEX_PATH      = INDEX_DIR / "faiss.index"
CHUNKS_PATH     = INDEX_DIR / "chunks.pkl"
META_PATH       = INDEX_DIR / "meta.json"

EMBED_MODEL     = "sentence-transformers/all-MiniLM-L6-v2"
# Use local HF cache snapshot to avoid network download
_HF_CACHE       = Path.home() / ".cache" / "huggingface" / "hub"
_MODEL_SNAPSHOT = (
    _HF_CACHE
    / "models--sentence-transformers--all-MiniLM-L6-v2"
    / "snapshots"
    / "c9745ed1d9f207416be6d2e6f8de32d1f16199bf"
)
EMBED_MODEL_PATH = str(_MODEL_SNAPSHOT) if _MODEL_SNAPSHOT.exists() else EMBED_MODEL

GROQ_MODEL      = "openai/gpt-oss-120b"

# Retrieval hyper-params
TOP_K           = 20    # candidates before MMR
MMR_K           = 6     # final chunks after diversity re-rank
MMR_LAMBDA      = 0.6   # relevance vs. diversity trade-off (0=diversity, 1=relevance)
EXPANSION_N     = 3     # number of extra HyDE queries to generate
MIN_SCORE       = 0.25  # cosine score floor (drop noisy results)

# Force UTF-8 output on Windows
console = Console(file=open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1))


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Chunk:
    id: int
    text: str
    page: int
    score: float = 0.0
    extra: Dict = field(default_factory=dict)


@dataclass
class RAGResponse:
    answer: str
    chunks: List[Chunk]
    queries_used: List[str]
    model: str


# ─────────────────────────────────────────────────────────────────────────────
# Index loader
# ─────────────────────────────────────────────────────────────────────────────
class IndexStore:
    def __init__(self):
        if not INDEX_PATH.exists():
            raise FileNotFoundError(
                f"Index not found at '{INDEX_PATH}'.\n"
                "Run  python ingest.py  first to build the index."
            )
        self.index = faiss.read_index(str(INDEX_PATH))
        with open(CHUNKS_PATH, "rb") as f:
            raw = pickle.load(f)
        self.chunks: List[Dict] = raw
        self.meta = json.loads(META_PATH.read_text())
        console.log(f"[dim]Loaded index: {len(self.chunks)} chunks[/dim]")


# ─────────────────────────────────────────────────────────────────────────────
# Embedder (singleton)
# ─────────────────────────────────────────────────────────────────────────────
class Embedder:
    _instance: Optional["Embedder"] = None

    def __init__(self):
        console.log(f"[dim]Loading embed model from local cache: {EMBED_MODEL}[/dim]")
        self.model = SentenceTransformer(EMBED_MODEL_PATH)

    @classmethod
    def get(cls) -> "Embedder":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def encode(self, texts: List[str]) -> np.ndarray:
        return self.model.encode(
            texts, normalize_embeddings=True, show_progress_bar=False
        ).astype("float32")


# ─────────────────────────────────────────────────────────────────────────────
# Groq client helper
# ─────────────────────────────────────────────────────────────────────────────
def get_groq_client() -> Groq:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise EnvironmentError("GROQ_API_KEY not set in .env")
    return Groq(api_key=api_key)


def llm_call(
    client: Groq,
    messages: List[Dict],
    temperature: float = 0.2,
    max_tokens: int = 1024,
) -> str:
    resp = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Query Expansion (HyDE + Multi-query)
# ─────────────────────────────────────────────────────────────────────────────
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


def expand_query(client: Groq, question: str, n: int = EXPANSION_N) -> Tuple[List[str], str]:
    """Return (alternative_queries, hypothetical_passage)."""
    prompt = EXPANSION_PROMPT.format(n=n, question=question)
    try:
        raw = llm_call(
            client,
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


# ─────────────────────────────────────────────────────────────────────────────
# Retrieval helpers
# ─────────────────────────────────────────────────────────────────────────────
def retrieve_for_query(
    query_vec: np.ndarray,
    index: faiss.Index,
    chunks: List[Dict],
    k: int,
) -> List[Chunk]:
    """FAISS search -> list of Chunk objects with scores."""
    scores, ids = index.search(query_vec.reshape(1, -1), k)
    results = []
    for score, idx in zip(scores[0], ids[0]):
        if idx < 0 or score < MIN_SCORE:
            continue
        raw = chunks[idx]
        results.append(Chunk(
            id=raw["id"],
            text=raw["text"],
            page=raw.get("page", -1),
            score=float(score),
            extra={k: v for k, v in raw.items() if k not in ("id", "text", "page")},
        ))
    return results


def deduplicate(chunks: List[Chunk]) -> List[Chunk]:
    """Keep the highest-scored occurrence of each chunk id."""
    seen: Dict[int, Chunk] = {}
    for c in chunks:
        if c.id not in seen or c.score > seen[c.id].score:
            seen[c.id] = c
    return sorted(seen.values(), key=lambda x: x.score, reverse=True)


def mmr_rerank(
    candidates: List[Chunk],
    query_vec: np.ndarray,
    embedder: Embedder,
    k: int = MMR_K,
    lam: float = MMR_LAMBDA,
) -> List[Chunk]:
    """
    Maximal Marginal Relevance re-ranking.
    Balances relevance (cosine with query) and diversity (pairwise similarity).
    """
    if len(candidates) <= k:
        return candidates

    texts = [c.text for c in candidates]
    cand_vecs = embedder.encode(texts)   # (N, D)

    selected_idx: List[int] = []
    remaining = list(range(len(candidates)))

    for _ in range(k):
        if not remaining:
            break

        scores = []
        for i in remaining:
            rel = float(np.dot(query_vec, cand_vecs[i]))   # relevance
            if selected_idx:
                sim_to_sel = max(
                    float(np.dot(cand_vecs[i], cand_vecs[j])) for j in selected_idx
                )
            else:
                sim_to_sel = 0.0
            mmr = lam * rel - (1 - lam) * sim_to_sel
            scores.append((mmr, i))

        best = max(scores, key=lambda x: x[0])[1]
        selected_idx.append(best)
        remaining.remove(best)

    return [candidates[i] for i in selected_idx]


# ─────────────────────────────────────────────────────────────────────────────
# Contextual compression / relevance filter
# ─────────────────────────────────────────────────────────────────────────────
COMPRESS_PROMPT = """\
You are a relevance filter. Given a user question and a text passage, extract ONLY the sentences from the passage that are directly relevant to answering the question.
If nothing is relevant, return an empty string.
Return only the extracted text, no preamble.

Question: {question}
Passage: {passage}
"""


def compress_chunks(client: Groq, question: str, chunks: List[Chunk]) -> List[Chunk]:
    """Compress each chunk to only its relevant sentences. Drops empty results."""
    compressed = []
    for chunk in chunks:
        prompt = COMPRESS_PROMPT.format(question=question, passage=chunk.text)
        try:
            result = llm_call(
                client,
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


# ─────────────────────────────────────────────────────────────────────────────
# Answer generation
# ─────────────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """\
You are an expert research assistant with access to a curated knowledge base.

Instructions:
- Answer the user's question using ONLY the provided context passages.
- Be thorough, accurate, and structured. Use bullet points or numbered lists when appropriate.
- If the answer spans multiple context passages, synthesize them coherently.
- If the context does not contain enough information, say so clearly -- do NOT hallucinate.
- Cite the page number (if available) when referencing specific information, e.g. [Page 3].
- Conclude with a concise summary if the answer is long.
"""


def build_context_string(chunks: List[Chunk]) -> str:
    parts = []
    for i, c in enumerate(chunks, 1):
        page_ref = f"  [Page {c.page}]" if c.page > 0 else ""
        parts.append(f"--- Passage {i}{page_ref} ---\n{c.text}")
    return "\n\n".join(parts)


def generate_answer(client: Groq, question: str, chunks: List[Chunk]) -> str:
    context = build_context_string(chunks)
    user_msg = f"Context:\n{context}\n\nQuestion: {question}"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]
    return llm_call(client, messages, temperature=0.15, max_tokens=2048)


# ─────────────────────────────────────────────────────────────────────────────
# Main RAG pipeline
# ─────────────────────────────────────────────────────────────────────────────
class RAGPipeline:
    def __init__(self, compress: bool = False):
        """
        Args:
            compress: Enable LLM-based contextual compression (uses extra API calls).
        """
        self.store    = IndexStore()
        self.embedder = Embedder.get()
        self.client   = get_groq_client()
        self.compress = compress

    def query(self, question: str, verbose: bool = False) -> RAGResponse:
        # 1. Query expansion
        alt_queries, hypo_passage = expand_query(self.client, question)

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
            hits = retrieve_for_query(vec, self.store.index, self.store.chunks, TOP_K)
            all_candidates.extend(hits)

        if not all_candidates:
            return RAGResponse(
                answer="I could not find relevant information in the knowledge base for your question.",
                chunks=[],
                queries_used=all_queries,
                model=GROQ_MODEL,
            )

        # 4. Deduplicate
        candidates = deduplicate(all_candidates)
        if verbose:
            console.log(f"[blue]Candidates after dedup[/blue]: {len(candidates)}")

        # 5. MMR re-rank
        query_vec = self.embedder.encode([question])[0]
        final_chunks = mmr_rerank(candidates, query_vec, self.embedder, k=MMR_K)

        # 6. Optional contextual compression
        if self.compress:
            final_chunks = compress_chunks(self.client, question, final_chunks)
            if verbose:
                console.log(f"[blue]After compression[/blue]: {len(final_chunks)} chunks remain")

        # 7. Generate answer
        answer = generate_answer(self.client, question, final_chunks)

        return RAGResponse(
            answer=answer,
            chunks=final_chunks,
            queries_used=all_queries,
            model=GROQ_MODEL,
        )
