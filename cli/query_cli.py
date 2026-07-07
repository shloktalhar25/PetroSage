# -*- coding: utf-8 -*-
"""
cli/query_cli.py - Interactive CLI / REPL for the Advanced RAG system.

Usage (inside activated venv):
    python query.py                          # interactive REPL
    python query.py --compress               # enable contextual compression
    python query.py -q "your question"       # single-shot query
    python query.py --verbose                # show expanded queries
    python query.py --country Norway -q "..."  # scope retrieval to one country
"""

import argparse
import sys
import time
from pathlib import Path

# pyrefly: ignore [import-error, missing-import]
from rich.panel import Panel
# pyrefly: ignore [import-error, missing-import]
from rich.rule import Rule
# pyrefly: ignore [import-error, missing-import]
from rich.table import Table
# pyrefly: ignore [import-error, missing-import]
from rich.markdown import Markdown
# pyrefly: ignore [import-error, missing-import]
from rich.prompt import Prompt

from core.console import console
from core.models import RAGResponse
from rag.pipeline import RAGPipeline

BANNER = """
[bold cyan]
  Advanced RAG  |  Groq  |  openai/gpt-oss-120b
[/bold cyan]
[dim]Type your question and press Enter.
Commands: [bold]/help[/bold]  [bold]/sources[/bold]  [bold]/verbose[/bold]  [bold]/compress[/bold]  [bold]/country[/bold]  [bold]/clear[/bold]  [bold]/quit[/bold][/dim]
"""

HELP_TEXT = """
[bold cyan]Commands[/bold cyan]
  /help          -- Show this help message
  /sources       -- Show retrieved source passages for the last query
  /clear         -- Clear screen
  /verbose       -- Toggle verbose mode (show expanded queries)
  /compress      -- Toggle contextual compression (extra LLM calls, better quality)
  /country <name> -- Scope retrieval to one country (e.g. /country Norway)
  /country        -- Clear the country filter (search all countries)
  /quit          -- Exit

[bold cyan]Tips[/bold cyan]
  - Ask specific, detailed questions for best results.
  - Verbose mode shows how the query was expanded internally.
  - Compression mode filters each passage to only relevant sentences.
"""


def _location(c) -> str:
    source_name = Path(c.source_file).name if c.source_file else "-"
    if c.page and c.page > 0:
        location = f"Page {c.page}"
    elif c.extra.get("row"):
        location = f"Row {c.extra['row']}"
    else:
        location = "-"
    country = c.country or "-"
    return f"{source_name} | {country} | {location}"


def print_response(resp: RAGResponse, verbose: bool = False):
    console.print()
    console.print(Panel(
        Markdown(resp.answer),
        title=f"[bold green]Answer[/bold green]  [dim](model: {resp.model})[/dim]",
        border_style="green",
        padding=(1, 2),
    ))

    if verbose and resp.queries_used:
        console.print(Rule("[dim]Queries used[/dim]"))
        for i, q in enumerate(resp.queries_used, 1):
            console.print(f"  [dim]{i}.[/dim] {q}")

    console.print(Rule("[dim]Sources[/dim]"))
    for i, c in enumerate(resp.chunks, 1):
        score_pct = f"{c.score * 100:.1f}%"
        preview = c.text[:120].replace("\n", " ") + ("..." if len(c.text) > 120 else "")
        console.print(
            f"  [cyan]{i}.[/cyan] [{_location(c)}] [dim]score={score_pct}[/dim]  {preview}"
        )
    console.print()


def show_sources(resp: RAGResponse):
    if not resp:
        console.print("[yellow]No query has been run yet.[/yellow]")
        return

    table = Table(title="Retrieved Passages", show_lines=True, header_style="bold magenta")
    table.add_column("#", style="cyan", width=4)
    table.add_column("Source", style="yellow", width=24)
    table.add_column("Country", style="magenta", width=10)
    table.add_column("Loc.", style="yellow", width=8)
    table.add_column("Score", style="green", width=8)
    table.add_column("Text", style="white", no_wrap=False)

    for i, c in enumerate(resp.chunks, 1):
        if c.page and c.page > 0:
            loc = f"P{c.page}"
        elif c.extra.get("row"):
            loc = f"R{c.extra['row']}"
        else:
            loc = "-"
        table.add_row(
            str(i),
            Path(c.source_file).name if c.source_file else "-",
            c.country or "-",
            loc,
            f"{c.score:.4f}",
            c.text[:500] + ("..." if len(c.text) > 500 else ""),
        )
    console.print(table)


def run_repl(pipeline: RAGPipeline, verbose: bool, country: str | None):
    console.print(BANNER)

    last_response: RAGResponse | None = None

    while True:
        country_label = f" [dim](country: {country})[/dim]" if country else ""
        try:
            user_input = Prompt.ask(f"[bold yellow]>[/bold yellow]{country_label}").strip()
        except (KeyboardInterrupt, EOFError):
            console.print("\n[dim]Goodbye![/dim]")
            break

        if not user_input:
            continue

        # Commands
        if user_input.lower() in ("/quit", "/exit", "quit", "exit"):
            console.print("[dim]Goodbye![/dim]")
            break
        elif user_input.lower() == "/help":
            console.print(Panel(HELP_TEXT, title="Help", border_style="cyan"))
            continue
        elif user_input.lower() == "/sources":
            show_sources(last_response)
            continue
        elif user_input.lower() == "/clear":
            console.clear()
            console.print(BANNER)
            continue
        elif user_input.lower() == "/verbose":
            verbose = not verbose
            state = "[green]ON[/green]" if verbose else "[red]OFF[/red]"
            console.print(f"  Verbose mode: {state}")
            continue
        elif user_input.lower() == "/compress":
            pipeline.compress = not pipeline.compress
            state = "[green]ON[/green]" if pipeline.compress else "[red]OFF[/red]"
            console.print(f"  Contextual compression: {state}")
            continue
        elif user_input.lower() == "/country" or user_input.lower().startswith("/country "):
            arg = user_input[len("/country"):].strip()
            country = arg or None
            state = f"[green]{country}[/green]" if country else "[red]OFF (all countries)[/red]"
            console.print(f"  Country filter: {state}")
            continue

        # Run query
        console.print(f"\n[dim]Thinking...[/dim]")
        start = time.perf_counter()
        try:
            last_response = pipeline.query(user_input, verbose=verbose, country=country)
        except Exception as e:
            console.print(f"[red]Error:[/red] {e}")
            continue
        elapsed = time.perf_counter() - start

        print_response(last_response, verbose=verbose)
        console.print(f"[dim]  Answered in {elapsed:.2f}s[/dim]\n")


def run_single(pipeline: RAGPipeline, question: str, verbose: bool, country: str | None):
    console.print(f"\n[bold yellow]Question:[/bold yellow] {question}")
    if country:
        console.print(f"[dim]Country filter: {country}[/dim]")
    console.print()
    start = time.perf_counter()
    resp = pipeline.query(question, verbose=verbose, country=country)
    elapsed = time.perf_counter() - start
    print_response(resp, verbose=verbose)
    console.print(f"[dim]  Answered in {elapsed:.2f}s[/dim]\n")


def main():
    parser = argparse.ArgumentParser(description="Advanced RAG CLI -- Groq / openai/gpt-oss-120b")
    parser.add_argument("-q", "--question", help="Single-shot question (skip REPL)")
    parser.add_argument("--compress", action="store_true", help="Enable contextual compression")
    parser.add_argument("--verbose", action="store_true", help="Show expanded queries")
    parser.add_argument("--country", help="Scope retrieval to one country (e.g. Norway)")
    args = parser.parse_args()

    try:
        pipeline = RAGPipeline(compress=args.compress)
    except FileNotFoundError as e:
        console.print(f"[red]Setup error:[/red] {e}")
        sys.exit(1)
    except EnvironmentError as e:
        console.print(f"[red]Config error:[/red] {e}")
        sys.exit(1)

    if args.question:
        run_single(pipeline, args.question, verbose=args.verbose, country=args.country)
    else:
        run_repl(pipeline, verbose=args.verbose, country=args.country)


if __name__ == "__main__":
    main()
