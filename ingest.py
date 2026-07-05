# -*- coding: utf-8 -*-
"""
ingest.py - Advanced PDF ingestion with smart chunking, metadata enrichment,
             and FAISS vector index creation.

Usage (inside venv):
    python ingest.py
"""

from typing import override
import os
import sys
import json
import pickle
import hashlib
import re
from pathlib import Path
from typing import List, Dict, Any

# pyrefly: ignore [import-error, missing-import]
import fitz  # PyMuPDF
# pyrefly: ignore [import-error, missing-import]
import numpy as np
# pyrefly: ignore [import-error, missing-import]
import faiss
# pyrefly: ignore [import-error, missing-import]
from sentence_transformers import SentenceTransformer
# pyrefly: ignore [import-error, missing-import]
from rich.console import Console
# pyrefly: ignore [import-error, missing-import]
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
# pyrefly: ignore [missing-import]
from rich.panel import Panel
# pyrefly: ignore [missing-import]
from rich.table import Table
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv(override=True)

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
DATA_DIR        = Path("data")
INDEX_DIR       = Path("index")
PDF_PATH        = DATA_DIR / "source.pdf"
INDEX_PATH      = INDEX_DIR / "faiss.index"
CHUNKS_PATH     = INDEX_DIR / "chunks.pkl"
META_PATH       = INDEX_DIR / "meta.json"

EMBED_MODEL     = "sentence-transformers/all-MiniLM-L6-v2"
# Use local HF cache to avoid re-downloading the model
_HF_CACHE       = Path.home() / ".cache" / "huggingface" / "hub"
_MODEL_SNAPSHOT = (
    _HF_CACHE
    / "models--sentence-transformers--all-MiniLM-L6-v2"
    / "snapshots"
    / "c9745ed1d9f207416be6d2e6f8de32d1f16199bf"
)
EMBED_MODEL_PATH = str(_MODEL_SNAPSHOT) if _MODEL_SNAPSHOT.exists() else EMBED_MODEL

CHUNK_SIZE      = 512   # tokens (approx characters / 4)
CHUNK_OVERLAP   = 80    # overlap in tokens
MIN_CHUNK_CHARS = 100   # drop tiny fragments

# Force UTF-8 output so Unicode chars print correctly on Windows cp1252 terminals
console = Console(file=open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1))


# ─────────────────────────────────────────────────────────────────────────────
# Text extraction & cleaning
# ─────────────────────────────────────────────────────────────────────────────
def extract_text_blocks(pdf_path: Path) -> List[Dict[str, Any]]:
    """Extract text from PDF with page metadata and block structure."""
    doc = fitz.open(str(pdf_path))
    blocks = []

    for page_num, page in enumerate(doc, start=1):
        raw_blocks = page.get_text("blocks")
        for b in raw_blocks:
            # b = (x0, y0, x1, y1, text, block_no, block_type)
            text = b[4].strip()
            if not text or b[6] != 0:   # skip non-text blocks
                continue
            text = _clean_text(text)
            if len(text) < 20:
                continue
            blocks.append({
                "text": text,
                "page": page_num,
                "block_no": b[5],
                "bbox": (b[0], b[1], b[2], b[3]),
            })

    doc.close()
    console.print(f"  [cyan]Extracted[/cyan] {len(blocks)} raw blocks from {pdf_path.name}")
    return blocks


def _clean_text(text: str) -> str:
    """Normalise whitespace, remove control characters."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Hierarchical chunking (paragraph-aware, then token-size split)
# ─────────────────────────────────────────────────────────────────────────────
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

    # Assign global IDs and fingerprints
    for i, c in enumerate(all_chunks):
        c["id"] = i
        c["hash"] = hashlib.md5(c["text"].encode()).hexdigest()

    console.print(f"  [cyan]Created[/cyan]   {len(all_chunks)} chunks")
    return all_chunks


# ─────────────────────────────────────────────────────────────────────────────
# Embedding & indexing
# ─────────────────────────────────────────────────────────────────────────────
def embed_chunks(chunks: List[Dict], model: SentenceTransformer) -> np.ndarray:
    texts = [c["text"] for c in chunks]
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("[yellow]Embedding chunks...", total=len(texts))
        batch_size = 64
        embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            emb = model.encode(batch, normalize_embeddings=True, show_progress_bar=False)
            embeddings.append(emb)
            progress.advance(task, len(batch))

    return np.vstack(embeddings).astype("float32")


def build_faiss_index(embeddings: np.ndarray) -> faiss.Index:
    dim = embeddings.shape[1]
    # Use IVFFlat for larger corpora; fall back to Flat for small ones
    if len(embeddings) < 500:
        index = faiss.IndexFlatIP(dim)   # Inner Product (cosine with L2-normed vecs)
    else:
        nlist = min(64, len(embeddings) // 10)
        quantizer = faiss.IndexFlatIP(dim)
        index = faiss.IndexIVFFlat(quantizer, dim, nlist, faiss.METRIC_INNER_PRODUCT)
        index.train(embeddings)
    index.add(embeddings)
    return index


# ─────────────────────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────────────────────
def save_index(index, chunks, pdf_path: Path):
    INDEX_DIR.mkdir(exist_ok=True)
    faiss.write_index(index, str(INDEX_PATH))
    with open(CHUNKS_PATH, "wb") as f:
        pickle.dump(chunks, f)

    meta = {
        "source": str(pdf_path),
        "num_chunks": len(chunks),
        "embed_model": EMBED_MODEL,
        "chunk_size": CHUNK_SIZE,
        "chunk_overlap": CHUNK_OVERLAP,
    }
    META_PATH.write_text(json.dumps(meta, indent=2))
    console.print(f"  [green]Saved[/green]    index -> {INDEX_DIR}/")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    console.print(Panel("[bold cyan]Advanced RAG - Ingestion Pipeline[/bold cyan]", expand=False))

    if not PDF_PATH.exists():
        console.print(
            f"[red]PDF not found:[/red] {PDF_PATH}\n"
            f"Place your PDF at [bold]{PDF_PATH}[/bold] and re-run."
        )
        return

    console.print(f"\n[bold]Step 1/4[/bold]  Loading PDF: [yellow]{PDF_PATH}[/yellow]")
    blocks = extract_text_blocks(PDF_PATH)

    console.print(f"\n[bold]Step 2/4[/bold]  Chunking ...")
    chunks = create_chunks(blocks)
    if not chunks:
        console.print("[red]No usable text found in PDF.[/red]")
        return

    console.print(f"\n[bold]Step 3/4[/bold]  Loading embedding model ...")
    console.print(f"  [dim]Model path: {EMBED_MODEL_PATH}[/dim]")
    model = SentenceTransformer(EMBED_MODEL_PATH)

    console.print(f"\n[bold]Step 4/4[/bold]  Building FAISS index ...")
    embeddings = embed_chunks(chunks, model)
    index = build_faiss_index(embeddings)
    save_index(index, chunks, PDF_PATH)

    # Summary table
    table = Table(title="Ingestion Summary", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="white")
    table.add_row("PDF", PDF_PATH.name)
    table.add_row("Raw blocks", str(len(blocks)))
    table.add_row("Chunks", str(len(chunks)))
    table.add_row("Embedding dim", str(embeddings.shape[1]))
    table.add_row("Index type", type(index).__name__)
    console.print(table)
    console.print(
        "\n[bold green]Done![/bold green]  "
        "Run [yellow]python query.py[/yellow] to start querying.\n"
    )


if __name__ == "__main__":
    main()
