# -*- coding: utf-8 -*-
"""
data/pdf_loader.py - Document source connector for PDF files.

Extracts text blocks with page/position metadata and normalises whitespace.
"""

import re
from pathlib import Path
from typing import List, Dict, Any

# pyrefly: ignore [import-error, missing-import]
import fitz  # PyMuPDF

from core.console import console


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
            text = clean_text(text)
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


def clean_text(text: str) -> str:
    """Normalise whitespace, remove control characters."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()
