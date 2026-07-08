# -*- coding: utf-8 -*-
"""
rag/rerank.py - Maximal Marginal Relevance (MMR) re-ranking.

Balances relevance (cosine with the query) and diversity (pairwise similarity
between selected chunks).
"""

from typing import List

# pyrefly: ignore [import-error, missing-import]
import numpy as np

from core.config import MMR_K, MMR_LAMBDA
from core.models import Chunk
from data.embeddings import Embedder


def mmr_rerank(
    candidates: List[Chunk],
    query_vec: np.ndarray,
    embedder: Embedder,
    k: int = MMR_K,
    lam: float = MMR_LAMBDA,
) -> List[Chunk]:
    """Re-rank candidates for relevance/diversity balance, returning up to k."""
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
