# -*- coding: utf-8 -*-
"""
api/adapters.py - Pure functions turning a RAGResponse into the JSON shapes the
frontend pages already render (no FastAPI / pipeline imports, so they unit-test
without the model or DB).

Answers cite sources as "[file.xlsx, Norway, Row 4]" (see rag/generation.py) and
sometimes as "[Passage 2]". Both are stripped from the text and turned into the
numeric citation ids the UI shows as clickable [1], [2] buttons.
"""

import re
from datetime import datetime
from typing import Dict, List, Sequence, Tuple

from api.sources import source_id
from core.models import Chunk

_BRACKET_RE = re.compile(r"[ \t]*[\[【]([^\[\]【】]+)[\]】]")
_PASSAGE_RE = re.compile(r"Passage\s+(\d+)", re.IGNORECASE)
_SHORT_NAME_LEN = 18
_EXCERPT_CHARS = 1500  # cap per cited passage sent to the document viewer
_EMPTY_LABEL_RE = re.compile(r"^\W*(sources?|citations?)\W*$", re.IGNORECASE)


# Question keyword -> country tag on indexed chunks. The index is dominated by
# huge UK/US spreadsheets, so an unscoped Norway or India question is easily
# drowned out; pinning the country fixes that.
_COUNTRY_KEYWORDS = [
    ("Norway", r"\b(norway|norwegian|norsk|equinor)\b"),
    ("UK", r"\b(uk|u\.k\.|united kingdom|britain|british|ukcs)\b"),
    ("US", r"\b(u\.s\.|usa|united states|texas|american|california)\b"),
    ("India", r"\b(india|indian)\b"),
    ("Global", r"\b(brent|wti|dubai crude|commodity|commodities|pink sheet|crude oil prices?|oil prices?|gas prices?|henry hub|lng price)\b"),
]


def detect_country(question: str):
    """The single country a question names, or None if it names zero or several."""
    q = question.lower()
    hits = [tag for tag, pattern in _COUNTRY_KEYWORDS if re.search(pattern, q)]
    return hits[0] if len(hits) == 1 else None


def _normalize(text: str) -> str:
    """Plain spaces/hyphens instead of the non-breaking variants the model likes to emit; no raw <br>."""
    text = text.translate({0x202F: " ", 0x00A0: " ", 0x2011: "-", 0x2010: "-"})
    return re.sub(r"\s*<br\s*/?>\s*", "; ", text, flags=re.IGNORECASE)  # <br> inside table cells


def _source_name(chunk: Chunk) -> str:
    # The index may have been built on Windows, so split on both separators.
    return re.split(r"[\\/]", chunk.source_file)[-1] if chunk.source_file else "unknown"


def _location(chunk: Chunk) -> Tuple[str, int]:
    """('pg.'|'row', number) for a chunk, or ('', 0) when it has neither."""
    if chunk.page and chunk.page > 0:
        return "pg.", int(chunk.page)
    row = chunk.extra.get("row")
    if row:
        return "row", int(row)
    return "", 0


def _short_name(name: str) -> str:
    return name if len(name) <= _SHORT_NAME_LEN else name[:_SHORT_NAME_LEN] + "..."


def _excerpt(chunk: Chunk, unit: str, number: int) -> Dict:
    """The cited passage itself, so the viewer shows real retrieved text."""
    text = chunk.text if len(chunk.text) <= _EXCERPT_CHARS else chunk.text[:_EXCERPT_CHARS] + " ..."
    return {
        "chunkId": str(chunk.id),
        "page": number if unit == "pg." else None,
        "row": number if unit == "row" else None,
        "sheet": chunk.extra.get("sheet"),
        "text": text,
    }


def build_sources(chunks: Sequence[Chunk]) -> List[Dict]:
    """One entry per distinct source file, numbered 1..n in retrieval order."""
    by_name: Dict[str, Dict] = {}
    for c in chunks:
        name = _source_name(c)
        src = by_name.setdefault(name, {
            "id": len(by_name) + 1,
            "sourceId": source_id(c.source_file) if c.source_file else None,
            "name": name,
            "shortName": _short_name(name),
            "country": c.country,
            "unit": "pg.",
            "pages": set(),
            "excerpts": [],
        })
        unit, number = _location(c)
        if number:
            src["unit"] = unit
            src["pages"].add(number)
        src["excerpts"].append(_excerpt(c, unit, number))
    for src in by_name.values():
        src["pages"] = sorted(src["pages"])
    return list(by_name.values())


def _cited_ids(marker: str, chunks: Sequence[Chunk], name_to_id: Dict[str, int]) -> List[int]:
    ids = [sid for name, sid in name_to_id.items() if name in marker]
    for m in _PASSAGE_RE.finditer(marker):
        i = int(m.group(1)) - 1
        if 0 <= i < len(chunks):
            ids.append(name_to_id[_source_name(chunks[i])])
    return ids


def to_paragraphs(answer: str, chunks: Sequence[Chunk], sources: Sequence[Dict]) -> List[Dict]:
    """Split the answer into paragraphs with per-paragraph citation ids."""
    name_to_id = {s["name"]: s["id"] for s in sources}
    paragraphs: List[Dict] = []
    for block in re.split(r"\n\s*\n", _normalize(answer).strip()):
        ids: List[int] = []

        def strip_citation(m: "re.Match[str]") -> str:
            found = _cited_ids(m.group(1), chunks, name_to_id)
            if not found:
                return m.group(0)
            ids.extend(found)
            return ""

        text = _BRACKET_RE.sub(strip_citation, block).strip()
        if _EMPTY_LABEL_RE.match(text):  # e.g. "*Source:.*" left after stripping its citation
            continue
        if text:
            paragraphs.append({"text": text, "citeIds": sorted(set(ids))})
    return paragraphs


def _now_label() -> str:
    return datetime.now().strftime("%I:%M %p").lstrip("0")


def to_search_response(
    answer: str, chunks: Sequence[Chunk], answer_source: str = "knowledge_base"
) -> Dict:
    """Shape for DataSearch and Dashboard: {paragraphs, sources, meta}."""
    sources = build_sources(chunks)
    return {
        "paragraphs": to_paragraphs(answer, chunks, sources),
        "sources": sources,
        "meta": {"time": _now_label(), "citations": len(sources), "answerSource": answer_source},
    }


def build_refs(chunks: Sequence[Chunk]) -> List[Dict]:
    """Shape for Midstream / Upstream popups: [{id, label, loc}], deduplicated."""
    refs: List[Dict] = []
    seen = set()
    for c in chunks:
        unit, number = _location(c)
        loc = f"{'Page' if unit == 'pg.' else 'Row'} {number}" if number else "-"
        key = (_source_name(c), loc)
        if key in seen:
            continue
        seen.add(key)
        refs.append({"id": len(refs) + 1, "label": key[0], "loc": loc})
    return refs


def _headline_and_detail(answer: str, chunks: Sequence[Chunk]) -> Tuple[str, str]:
    """First paragraph -> headline text; the rest -> detail block (citations stripped)."""
    paragraphs = to_paragraphs(answer, chunks, build_sources(chunks))
    if not paragraphs:
        return "", ""
    return paragraphs[0]["text"], "\n\n".join(p["text"] for p in paragraphs[1:])


def to_text_response(
    answer: str, chunks: Sequence[Chunk], answer_source: str = "knowledge_base"
) -> Dict:
    """Shape for Upstream: {text, refs, answerSource}."""
    text, detail = _headline_and_detail(answer, chunks)
    return {
        "text": "\n\n".join(p for p in (text, detail) if p),
        "refs": build_refs(chunks),
        "answerSource": answer_source,
    }


def to_midstream_response(
    answer: str,
    chunks: Sequence[Chunk],
    assets: Dict[str, Tuple[float, float, str]],
    answer_source: str = "knowledge_base",
) -> Dict:
    """
    Shape for Midstream: {text, detail, highlight, route, flyTo, refs, answerSource}.

    `assets` maps AssetID -> (lat, lng, name). An asset is highlighted when its id
    (e.g. T01) or its name (e.g. "Truck KG-33") appears in the answer; the map
    flies to their centroid. `route` is always null - the model doesn't return a
    geometry, so no line is drawn.
    """
    text, detail = _headline_and_detail(answer, chunks)
    haystack = _normalize(answer)
    highlight = [
        asset_id for asset_id, (_, _, name) in assets.items()
        if re.search(rf"\b{re.escape(asset_id)}\b", haystack)
        or (name and name.lower() in haystack.lower())
    ]
    fly_to = None
    if highlight:
        lats = [assets[a][0] for a in highlight]
        lngs = [assets[a][1] for a in highlight]
        fly_to = {
            "lat": sum(lats) / len(lats),
            "lng": sum(lngs) / len(lngs),
            "zoom": 9 if len(highlight) == 1 else 6,
        }
    return {
        "text": text,
        "detail": detail,
        "highlight": highlight,
        "route": None,
        "flyTo": fly_to,
        "refs": build_refs(chunks),
        "answerSource": answer_source,
    }
