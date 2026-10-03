# -*- coding: utf-8 -*-
"""
api/sources.py - Read-only access to the indexed source files for the document viewer.

Every file that produced chunks in index/chunks.pkl gets a stable id (a hash of its
indexed path). The browser only ever sends that id, never a path, and a file is served
only if it is in the index *and* resolves inside Manual_data/ - so there is no way to
reach anything else on disk.
"""

import hashlib
import logging
import pickle
import re
import threading
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

# pyrefly: ignore [import-error, missing-import]
import fitz  # PyMuPDF

from core.config import CHUNKS_PATH, MANUAL_DATA_DIR

log = logging.getLogger("petrosage.api")

# Indexed paths are stored relative to the repo root (e.g. "Manual_data/US/x.pdf").
PROJECT_ROOT = Path(__file__).resolve().parents[1]
_DATA_ROOT = (PROJECT_ROOT / MANUAL_DATA_DIR).resolve()

MIN_ZOOM, MAX_ZOOM = 0.5, 3.0
_HIGHLIGHT_WORDS = 8  # leading words of a chunk used to find it on the rendered page

_registry: Optional[Dict[str, str]] = None
_stats: Dict[str, Dict] = {}  # source id -> {"chunks": n, "country": most common chunk country}
_pdf_chunk_text: Dict[str, str] = {}  # chunk id -> text, PDF chunks only (for highlighting)
_registry_lock = threading.Lock()


def source_id(source_file: str) -> str:
    """Stable id for an indexed source path (same id on Windows- or Unix-built indexes)."""
    normalized = source_file.replace("\\", "/")
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16]


def _load_registry() -> Dict[str, str]:
    """source id -> indexed relative path, built once from index/chunks.pkl."""
    global _registry
    with _registry_lock:
        if _registry is None:
            path = PROJECT_ROOT / CHUNKS_PATH
            if not path.exists():
                log.warning("Chunk records not found at %s; document viewer disabled", path)
                return {}
            with open(path, "rb") as f:
                records = pickle.load(f)
            files = {r.get("source_file", "") for r in records}
            _registry = {source_id(s): s.replace("\\", "/") for s in files if s}
            countries: Dict[str, Counter] = {}
            for r in records:
                if r.get("source_file"):
                    countries.setdefault(source_id(r["source_file"]), Counter())[r.get("country") or ""] += 1
            _stats.update(
                (sid, {"chunks": sum(c.values()), "country": c.most_common(1)[0][0] or None})
                for sid, c in countries.items()
            )
            _pdf_chunk_text.update(
                (str(r["id"]), r.get("text", "")) for r in records
                if str(r.get("source_file", "")).lower().endswith(".pdf")
            )
        return _registry


def resolve(sid: str) -> Optional[Path]:
    """The on-disk file for a source id, or None if unknown, missing, or outside Manual_data/."""
    rel = _load_registry().get(sid)
    if rel is None:
        return None
    path = (PROJECT_ROOT / rel).resolve()
    if not path.is_relative_to(_DATA_ROOT) or not path.is_file():
        return None
    return path


def kind_of(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "pdf"
    if suffix in (".xlsx", ".xlsm", ".xls"):
        return "spreadsheet"
    if suffix == ".csv":
        return "csv"
    return "text"


def describe(path: Path) -> Dict:
    """Viewer metadata for a source file (page count comes from the PDF itself)."""
    info = {"name": path.name, "kind": kind_of(path), "pageCount": None}
    if info["kind"] == "pdf":
        with fitz.open(path) as doc:
            info["pageCount"] = doc.page_count
    return info


def list_sources() -> List[Dict]:
    """Every indexed source file still on disk, with viewer metadata and index stats."""
    out = []
    for sid, rel in _load_registry().items():
        path = resolve(sid)
        if path is None:
            continue
        info = describe(path)
        folder = str(Path(rel).parent.relative_to(MANUAL_DATA_DIR.as_posix()))
        out.append({
            "sourceId": sid,
            **info,
            "folder": "" if folder == "." else folder,
            "sizeBytes": path.stat().st_size,
            **_stats.get(sid, {"chunks": 0, "country": None}),
        })
    return sorted(out, key=lambda d: (d["folder"].lower(), d["name"].lower()))


def _highlight_rects(page: "fitz.Page", texts: List[str]) -> List["fitz.Rect"]:
    """Rectangles of each cited passage's opening words on this page (best effort)."""
    rects: List[fitz.Rect] = []
    for text in texts:
        words = re.sub(r"\s+", " ", text).strip().split(" ")
        # Try a long phrase first, then a shorter one if line breaks/hyphens defeat the match.
        for n in (_HIGHLIGHT_WORDS, 4):
            phrase = " ".join(words[:n])
            if len(phrase) < 12:
                break
            hits = page.search_for(phrase)
            if hits:
                rects.extend(hits)
                break
    return rects


def render_page(path: Path, page_no: int, zoom: float, chunk_ids: List[str]) -> Optional[bytes]:
    """PNG of one PDF page with the given chunks highlighted, or None if the page doesn't exist."""
    zoom = min(max(zoom, MIN_ZOOM), MAX_ZOOM)
    _load_registry()
    highlights = [_pdf_chunk_text[c] for c in chunk_ids if c in _pdf_chunk_text]
    with fitz.open(path) as doc:  # opened read-only in memory; the file is never modified
        if not 1 <= page_no <= doc.page_count:
            return None
        page = doc[page_no - 1]
        for rect in _highlight_rects(page, highlights):
            page.draw_rect(rect, color=None, fill=(1, 0.85, 0.1), fill_opacity=0.35, overlay=True)
        return page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).tobytes("png")
