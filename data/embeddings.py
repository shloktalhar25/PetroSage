# -*- coding: utf-8 -*-
"""
data/embeddings.py - Embedding provider.

Wraps the sentence-transformers model as a singleton so the ingestion and
retrieval paths share a single loaded model. Also provides a batched helper
with a progress bar for the ingestion path.
"""

from typing import List, Optional

# pyrefly: ignore [import-error, missing-import]
import numpy as np
# pyrefly: ignore [import-error, missing-import]
from sentence_transformers import SentenceTransformer
# pyrefly: ignore [import-error, missing-import]
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn

from core.config import EMBED_MODEL, EMBED_MODEL_PATH
from core.console import console


class Embedder:
    """Singleton wrapper around a SentenceTransformer model."""

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

    def encode_batched(self, texts: List[str], batch_size: int = 64) -> np.ndarray:
        """Encode a large list of texts with a progress bar (ingestion path)."""
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("[yellow]Embedding chunks...", total=len(texts))
            embeddings = []
            for i in range(0, len(texts), batch_size):
                batch = texts[i : i + batch_size]
                emb = self.model.encode(
                    batch, normalize_embeddings=True, show_progress_bar=False
                )
                embeddings.append(emb)
                progress.advance(task, len(batch))

        return np.vstack(embeddings).astype("float32")
