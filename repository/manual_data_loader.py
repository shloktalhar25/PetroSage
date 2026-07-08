# -*- coding: utf-8 -*-
"""
repository/manual_data_loader.py - Discovers and loads files from Manual_data/.

Manual_data/ is organized by country (top-level subdirectories); files sitting
directly under Manual_data/ (not in a country folder) - including source.pdf
and the CMO commodity files - are tagged "Global" by default (the ingestion
orchestrator overrides source.pdf's country to PDF_COUNTRY). This module
walks the tree, applies skip rules (huge EIA time-series .txt dumps, the
ZIPs/ archive folder, duplicate downloads), and dispatches each remaining
file to the right format loader.
"""

from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from core.config import MAX_TEXT_FILE_MB
from core.console import console
from data.pdf_loader import extract_text_blocks
from data.csv_loader import load_csv
from data.excel_loader import load_excel

_SKIP_DIR_NAMES = {"zips"}


def _is_duplicate_download(path: Path, siblings: set) -> bool:
    """True if `path` looks like "<base> (1).<ext>" and "<base>.<ext>" exists."""
    stem = path.stem
    if stem.endswith(")") and " (" in stem:
        base_stem = stem.rsplit(" (", 1)[0]
        base_name = base_stem + path.suffix
        if base_name in siblings:
            return True
    return False


def discover_files(base: Path) -> List[Tuple[Path, str]]:
    """Walk `base`, returning (file_path, country) pairs to ingest."""
    if not base.exists():
        return []

    discovered: List[Tuple[Path, str]] = []

    for country_dir in sorted(base.iterdir()):
        if country_dir.is_file():
            continue
        if country_dir.name.lower() in _SKIP_DIR_NAMES:
            continue
        country = country_dir.name
        discovered.extend(_walk_country(country_dir, country))

    # Files directly under Manual_data/ (not inside a country folder).
    for path in sorted(base.iterdir()):
        if path.is_file():
            discovered.append((path, "Global"))

    return [
        (path, country)
        for path, country in discovered
        if _should_ingest(path)
    ]


def _walk_country(country_dir: Path, country: str) -> List[Tuple[Path, str]]:
    results: List[Tuple[Path, str]] = []
    for path in sorted(country_dir.rglob("*")):
        if path.is_dir():
            continue
        if any(part.lower() in _SKIP_DIR_NAMES for part in path.relative_to(country_dir).parts[:-1]):
            continue
        results.append((path, country))
    return results


def _should_ingest(path: Path) -> bool:
    if path.suffix.lower() == ".txt":
        size_mb = path.stat().st_size / (1024 * 1024)
        if size_mb > MAX_TEXT_FILE_MB:
            console.print(
                f"  [yellow]Skipping[/yellow] {path} ({size_mb:.0f}MB > "
                f"{MAX_TEXT_FILE_MB}MB threshold - time-series file, out of scope)"
            )
            return False

    siblings = {p.name for p in path.parent.iterdir()} if path.parent.exists() else set()
    if _is_duplicate_download(path, siblings):
        console.print(f"  [yellow]Skipping[/yellow] {path} (duplicate download)")
        return False

    return True


def load_file(path: Path) -> Optional[List[Dict[str, Any]]]:
    """Dispatch a file to its format loader. Returns None (skip) for unknown types."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_text_blocks(path)
    if suffix == ".csv":
        return load_csv(path)
    if suffix in (".xlsx", ".xlsm"):
        return load_excel(path)

    console.print(f"  [yellow]Skipping[/yellow] {path} (unsupported file type {suffix!r})")
    return None
