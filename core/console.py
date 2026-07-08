# -*- coding: utf-8 -*-
"""
core/console.py - Shared rich Console factory.

Forces UTF-8 output so Unicode characters print correctly on terminals whose
default encoding is not UTF-8 (e.g. Windows cp1252).
"""

import sys

# pyrefly: ignore [import-error, missing-import]
from rich.console import Console


def get_console() -> Console:
    """Return a Console that writes UTF-8 to stdout."""
    return Console(
        file=open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
    )


# Module-level shared instance for convenience.
console = get_console()
