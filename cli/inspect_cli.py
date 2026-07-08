# -*- coding: utf-8 -*-
"""
cli/inspect_cli.py - Browse what's actually been ingested, without needing
the DevDB server or the embedding model running.

Reads index/chunks.pkl + index/meta.json directly (the same records that
were inserted into DevDB), so it's fast and works even if the vector DB
server is down.

Usage:
    python inspect_data.py                          # summary: counts by country/format/source
    python inspect_data.py --country Norway          # summary scoped to one country
    python inspect_data.py --country Norway --sample 5   # + 5 sample chunks
    python inspect_data.py --search "royalty"        # substring search over chunk text
    python inspect_data.py --source fields.xlsx       # substring match on source file path
"""

import argparse
import pickle
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

# pyrefly: ignore [import-error, missing-import]
from rich.table import Table

from core.config import CHUNKS_PATH, META_PATH
from core.console import console


def _location(c: Dict) -> str:
    if c.get("page") and c["page"] > 0:
        return f"Page {c['page']}"
    if c.get("row"):
        return f"Row {c['row']}"
    return "-"


def load_records() -> List[Dict]:
    if not CHUNKS_PATH.exists():
        console.print(
            f"[red]No ingested data found at {CHUNKS_PATH}.[/red]\n"
            "Run [yellow]python ingest.py[/yellow] first."
        )
        return []
    with open(CHUNKS_PATH, "rb") as f:
        return pickle.load(f)


def print_summary(records: List[Dict]):
    if META_PATH.exists():
        import json
        meta = json.loads(META_PATH.read_text())
        console.print(
            f"[bold]Index metadata[/bold]  embed_model={meta.get('embed_model')}  "
            f"chunk_size={meta.get('chunk_size')}  backend={meta.get('backend')}"
        )

    country_counts = Counter(r.get("country", "") for r in records)
    format_counts = Counter(Path(r.get("source_file", "")).suffix.lower() for r in records)
    source_counts = Counter(r.get("source_file", "") for r in records)

    console.print(f"\n[bold cyan]Total chunks:[/bold cyan] {len(records)}\n")

    t = Table(title="By Country", header_style="bold magenta")
    t.add_column("Country", style="cyan")
    t.add_column("Chunks", style="white")
    for country, count in country_counts.most_common():
        t.add_row(country or "(none)", str(count))
    console.print(t)

    t = Table(title="By Format", header_style="bold magenta")
    t.add_column("Format", style="cyan")
    t.add_column("Chunks", style="white")
    for ext, count in format_counts.most_common():
        t.add_row(ext or "(none)", str(count))
    console.print(t)

    t = Table(title="By Source File", header_style="bold magenta", show_lines=False)
    t.add_column("Source File", style="yellow")
    t.add_column("Chunks", style="white")
    for source, count in source_counts.most_common():
        t.add_row(source, str(count))
    console.print(t)


def print_samples(records: List[Dict], limit: int):
    if not records:
        console.print("[yellow]No chunks match that filter.[/yellow]")
        return

    t = Table(title=f"Sample Chunks (showing {min(limit, len(records))} of {len(records)})",
               show_lines=True, header_style="bold magenta")
    t.add_column("Id", style="cyan", width=6)
    t.add_column("Country", style="magenta", width=10)
    t.add_column("Source", style="yellow", width=28)
    t.add_column("Loc.", style="yellow", width=8)
    t.add_column("Text", style="white", no_wrap=False)

    for r in records[:limit]:
        preview = r["text"][:200] + ("..." if len(r["text"]) > 200 else "")
        t.add_row(
            str(r.get("id", "-")),
            r.get("country", "-"),
            Path(r.get("source_file", "")).name or "-",
            _location(r),
            preview,
        )
    console.print(t)


def main():
    parser = argparse.ArgumentParser(description="Inspect data already ingested into the vector DB")
    parser.add_argument("--country", help="Filter to one country (case-insensitive)")
    parser.add_argument("--source", help="Filter by substring match on source file path")
    parser.add_argument("--search", help="Filter by substring match on chunk text (case-insensitive)")
    parser.add_argument("--sample", type=int, default=0,
                         help="Show N sample chunks matching the filters (default: 0, summary only)")
    args = parser.parse_args()

    records = load_records()
    if not records:
        return

    filtered = records
    if args.country:
        filtered = [r for r in filtered if r.get("country", "").lower() == args.country.lower()]
    if args.source:
        filtered = [r for r in filtered if args.source.lower() in r.get("source_file", "").lower()]
    if args.search:
        filtered = [r for r in filtered if args.search.lower() in r.get("text", "").lower()]

    if args.country or args.source or args.search:
        console.print(f"[dim]Filter matched {len(filtered)} of {len(records)} total chunks.[/dim]\n")

    print_summary(filtered if (args.country or args.source) else records)

    if args.sample or args.search:
        print_samples(filtered, args.sample or 10)


if __name__ == "__main__":
    main()
