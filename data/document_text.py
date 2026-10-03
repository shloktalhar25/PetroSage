# -*- coding: utf-8 -*-
"""
data/document_text.py - Turn an uploaded document (PDF, DOCX, TXT/MD) into numbered sections.

A section is one paragraph-sized piece of text: {"id": "S3", "page": 2 | None, "text": "..."}.
The compliance review cites findings by section id and highlights quotes inside a section,
so sections keep the document's own wording (only whitespace is normalised for PDFs).
"""

import io
import re
import zipfile
from typing import Dict, List, Optional
from xml.etree import ElementTree

# pyrefly: ignore [import-error, missing-import]
import fitz  # PyMuPDF

SUPPORTED_EXTENSIONS = {".pdf": "pdf", ".docx": "docx", ".txt": "text", ".md": "text"}

MAX_PDF_PAGES = 200
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024   # uncompressed word/document.xml (zip-bomb guard)
MIN_TEXT_CHARS = 40                     # less than this = nothing to review
_HEADING_CHARS = 80                     # shorter pieces are merged into the following one
_MAX_SECTION_CHARS = 1500               # longer text paragraphs are split on line breaks

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocumentError(ValueError):
    """The upload is not a readable document of its declared type (safe to show the user)."""


def _clean(text: str) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _merge_headings(pieces: List[Dict]) -> List[Dict]:
    """Attach short pieces (headings, labels) to the next piece on the same page."""
    merged: List[Dict] = []
    pending: Optional[Dict] = None
    for p in pieces:
        if pending and pending["page"] == p["page"]:
            p = {"page": p["page"], "text": pending["text"] + "\n" + p["text"]}
        elif pending:
            merged.append(pending)
        pending = None
        if len(p["text"]) < _HEADING_CHARS:
            pending = p
        else:
            merged.append(p)
    if pending:
        merged.append(pending)
    return merged


def _split_long(text: str) -> List[str]:
    """Split an over-long paragraph on line breaks into pieces of at most ~_MAX_SECTION_CHARS."""
    if len(text) <= _MAX_SECTION_CHARS:
        return [text]
    out, current = [], ""
    for line in text.split("\n"):
        if current and len(current) + len(line) + 1 > _MAX_SECTION_CHARS:
            out.append(current)
            current = line
        else:
            current = f"{current}\n{line}" if current else line
    if current:
        out.append(current)
    return out


def _pdf_pieces(data: bytes) -> tuple:
    if not data.startswith(b"%PDF-"):
        raise DocumentError("This file is not a valid PDF.")
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        raise DocumentError("This PDF could not be opened (it may be corrupted).") from e
    with doc:
        if doc.needs_pass:
            raise DocumentError("Password-protected PDFs are not supported.")
        if doc.page_count > MAX_PDF_PAGES:
            raise DocumentError(f"PDFs are limited to {MAX_PDF_PAGES} pages.")
        pieces = []
        for page_no, page in enumerate(doc, start=1):
            for block in page.get_text("blocks"):
                if block[6] != 0:  # not a text block
                    continue
                text = re.sub(r"\s+", " ", _clean(block[4]))
                if text:
                    pieces.append({"page": page_no, "text": text})
        return pieces, doc.page_count


def _docx_pieces(data: bytes) -> List[Dict]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise DocumentError("This Word document is too large to process.")
            root = ElementTree.fromstring(z.read(info))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as e:
        raise DocumentError("This file is not a valid .docx Word document.") from e
    pieces = []
    for para in root.iter(f"{_W}p"):
        parts = []
        for node in para.iter():
            if node.tag == f"{_W}t" and node.text:
                parts.append(node.text)
            elif node.tag == f"{_W}tab":
                parts.append(" ")
            elif node.tag in (f"{_W}br", f"{_W}cr"):
                parts.append("\n")
        text = _clean("".join(parts))
        if text:
            pieces.append({"page": None, "text": text})
    return pieces


def _text_pieces(data: bytes) -> List[Dict]:
    if b"\x00" in data:
        raise DocumentError("This does not look like a text file.")
    try:
        raw = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raw = data.decode("cp1252", errors="replace")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    pieces = []
    for para in re.split(r"\n\s*\n", raw):
        para = "\n".join(_clean(line) for line in para.strip().split("\n"))
        for piece in _split_long(para):
            if piece.strip():
                pieces.append({"page": None, "text": piece.strip()})
    return pieces


def extract_sections(data: bytes, kind: str) -> Dict:
    """
    -> {"sections": [{"id", "page", "text"}], "pageCount": int | None}
    Raises DocumentError for unreadable input or documents with no usable text.
    """
    page_count = None
    if kind == "pdf":
        pieces, page_count = _pdf_pieces(data)
    elif kind == "docx":
        pieces = _docx_pieces(data)
    elif kind == "text":
        pieces = _text_pieces(data)
    else:
        raise DocumentError("Unsupported file type.")

    pieces = _merge_headings(pieces)
    if sum(len(p["text"]) for p in pieces) < MIN_TEXT_CHARS:
        hint = " If it is a scanned PDF, it needs OCR first." if kind == "pdf" else ""
        raise DocumentError("No readable text was found in this document." + hint)
    sections = [{"id": f"S{i}", "page": p["page"], "text": p["text"]} for i, p in enumerate(pieces, 1)]
    return {"sections": sections, "pageCount": page_count}
