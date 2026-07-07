# -*- coding: utf-8 -*-
"""
repository/ingest_repository.py - The ingestion (write) path.

Orchestrates: discover sources (Manual_data/) -> load -> chunk -> embed ->
vector store create + insert + save. Writes go through the VectorStore
interface, so the backend is swappable.

This is a full-corpus rebuild every run: every source file is re-loaded,
re-chunked, and re-embedded, then the collection is created fresh and saved
once. DevDB's saved snapshots load read-only (mmap), so incremental
insert-after-load isn't possible - rebuilding is the simplest correct model
and matches how this pipeline has always worked.
"""

from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

# pyrefly: ignore [import-error, missing-import]
from rich.panel import Panel
# pyrefly: ignore [import-error, missing-import]
from rich.table import Table

from core.config import PDF_PATH, PDF_COUNTRY, MANUAL_DATA_DIR
from core.console import console
from data.embeddings import Embedder
from db import get_vector_store
from repository.chunking import create_chunks, finalize_chunks
from repository.manual_data_loader import discover_files, load_file


def _collect_sources() -> List[Tuple[Path, str]]:
    """Discover every ingestible file under Manual_data/, with source.pdf's
    country overridden from the generic "Global" default to PDF_COUNTRY."""
    sources = discover_files(MANUAL_DATA_DIR)
    return [
        (path, PDF_COUNTRY if path == PDF_PATH else country)
        for path, country in sources
    ]


def _load_and_chunk(path: Path, country: str) -> List[Dict]:
    blocks = load_file(path)
    if not blocks:
        return []

    for b in blocks:
        b["country"] = country
        b["source_file"] = str(path)

    if path.suffix.lower() == ".pdf":
        return create_chunks(blocks)
    return blocks  # tabular rows are already chunk-shaped


def run_ingestion() -> None:
    console.print(Panel("[bold cyan]Advanced RAG - Ingestion Pipeline[/bold cyan]", expand=False))

    sources = _collect_sources()
    if not sources:
        console.print("[red]No sources found to ingest.[/red]")
        return

    console.print(f"\n[bold]Step 1/4[/bold]  Discovered {len(sources)} source file(s)")

    console.print(f"\n[bold]Step 2/4[/bold]  Loading & chunking ...")
    all_chunks: List[Dict] = []
    format_counts: Counter = Counter()
    for path, country in sources:
        chunks = _load_and_chunk(path, country)
        all_chunks.extend(chunks)
        format_counts[path.suffix.lower()] += len(chunks)

    if not all_chunks:
        console.print("[red]No usable text found in any source.[/red]")
        return

    all_chunks = finalize_chunks(all_chunks)
    country_counts = Counter(c["country"] for c in all_chunks)

    console.print(f"\n[bold]Step 3/4[/bold]  Loading embedding model ...")
    embedder = Embedder.get()

    console.print(f"\n[bold]Step 4/4[/bold]  Building vector index ...")
    embeddings = embedder.encode_batched([c["text"] for c in all_chunks])

    store = get_vector_store()
    store.source = str(MANUAL_DATA_DIR)
    store.create(embeddings.shape[1])
    for i, chunk in enumerate(all_chunks):
        store.insert(chunk["id"], embeddings[i], chunk)
    store.save()

    # Summary tables
    table = Table(title="Ingestion Summary", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="white")
    table.add_row("Source files", str(len(sources)))
    table.add_row("Total chunks", str(len(all_chunks)))
    table.add_row("Embedding dim", str(embeddings.shape[1]))
    table.add_row("Backend", type(store).__name__)
    console.print(table)

    by_country = Table(title="Chunks by Country", show_header=True, header_style="bold magenta")
    by_country.add_column("Country", style="cyan")
    by_country.add_column("Chunks", style="white")
    for country, count in sorted(country_counts.items(), key=lambda x: -x[1]):
        by_country.add_row(country, str(count))
    console.print(by_country)

    by_format = Table(title="Chunks by Format", show_header=True, header_style="bold magenta")
    by_format.add_column("Format", style="cyan")
    by_format.add_column("Chunks", style="white")
    for ext, count in sorted(format_counts.items(), key=lambda x: -x[1]):
        by_format.add_row(ext or "(none)", str(count))
    console.print(by_format)

    console.print(
        "\n[bold green]Done![/bold green]  "
        "Run [yellow]python query.py[/yellow] to start querying.\n"
    )


def main() -> None:
    run_ingestion()


if __name__ == "__main__":
    main()
