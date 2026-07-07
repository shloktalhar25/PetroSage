# -*- coding: utf-8 -*-
"""
core/models.py - Shared data structures used across all layers.
"""

from typing import List, Dict
from dataclasses import dataclass, field


@dataclass
class Chunk:
    id: int
    text: str
    page: int
    score: float = 0.0
    country: str = ""
    source_file: str = ""
    extra: Dict = field(default_factory=dict)


@dataclass
class RAGResponse:
    answer: str
    chunks: List[Chunk]
    queries_used: List[str]
    model: str
