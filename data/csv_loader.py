# -*- coding: utf-8 -*-
"""
data/csv_loader.py - Document source connector for CSV files.

Each row becomes one chunk-shaped block directly (no merge/split needed -
a row is already a complete, self-contained unit of text).
"""

import csv
from pathlib import Path
from typing import List, Dict, Any


def load_csv(path: Path) -> List[Dict[str, Any]]:
    """Read a CSV file, returning one block per row."""
    blocks: List[Dict[str, Any]] = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=1):
            parts = [f"{k}: {v}" for k, v in row.items() if v not in (None, "")]
            if not parts:
                continue
            blocks.append({
                "text": f"{path.stem.replace('_', ' ')}: " + ", ".join(parts),
                "row": i,
            })
    return blocks
