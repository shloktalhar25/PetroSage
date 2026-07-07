# -*- coding: utf-8 -*-
"""
data/excel_loader.py - Document source connector for Excel files (.xlsx, .xlsm).

For each sheet, the header row is found heuristically (first row with at
least two non-empty cells - this skips title rows and blank spacer rows),
then every subsequent non-empty row becomes one chunk-shaped block.
"""

from pathlib import Path
from typing import List, Dict, Any

# pyrefly: ignore [import-error, missing-import]
import openpyxl


def _find_header_row(rows: List[tuple]) -> int:
    """Return the index (0-based) of the first row with >= 2 non-empty cells."""
    for i, row in enumerate(rows):
        non_empty = sum(1 for v in row if v is not None and str(v).strip() != "")
        if non_empty >= 2:
            return i
    return 0


def load_excel(path: Path) -> List[Dict[str, Any]]:
    """Read an Excel workbook, returning one block per populated data row."""
    blocks: List[Dict[str, Any]] = []
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        header_idx = _find_header_row(rows)
        headers = rows[header_idx]

        for i, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
            if all(v is None for v in row):
                continue
            parts = [
                f"{h}: {v}"
                for h, v in zip(headers, row)
                if h is not None and v is not None and str(v).strip() != ""
            ]
            if not parts:
                continue
            blocks.append({
                "text": ", ".join(parts),
                "sheet": sheet_name,
                "row": i,
            })

    wb.close()
    return blocks
