# -*- coding: utf-8 -*-
"""
data/text_loader.py - Document source connector for small plain-text files.

Each blank-line-separated paragraph becomes one chunk-shaped block directly
(the news-lead and regulation notes are already written one entry per paragraph).
"""

import re
from pathlib import Path
from typing import List, Dict, Any

from core.config import MIN_CHUNK_CHARS


def load_text(path: Path) -> List[Dict[str, Any]]:
    """Read a .txt file, returning one block per paragraph (1-based index in `row`)."""
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", raw)]
    return [
        {"text": p, "row": i}
        for i, p in enumerate(paragraphs, start=1)
        if len(p) >= MIN_CHUNK_CHARS
    ]
