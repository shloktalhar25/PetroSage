# -*- coding: utf-8 -*-
"""
core/config.py - Single source of truth for all configuration.

Previously these constants were duplicated across ingest.py and rag_pipeline.py.
"""

import os
from pathlib import Path

# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv(override=True)

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
MANUAL_DATA_DIR = Path("Manual_data")
INDEX_DIR       = Path("index")
PDF_PATH        = MANUAL_DATA_DIR / "source.pdf"
PDF_COUNTRY     = "India"
SNAPSHOT_PATH   = INDEX_DIR / "devdb.snapshot"
CHUNKS_PATH     = INDEX_DIR / "chunks.pkl"
META_PATH       = INDEX_DIR / "meta.json"

# Skip any single .txt file above this size when walking MANUAL_DATA_DIR (the
# EIA time-series JSON-lines dumps are 24-345MB and need a dedicated
# summarizing loader - out of scope for the generic ingestion walk).
MAX_TEXT_FILE_MB = 5

# ─────────────────────────────────────────────────────────────────────────────
# Vector DB backend (DevDB, our from-scratch Rust HNSW engine, over HTTP)
# ─────────────────────────────────────────────────────────────────────────────
VECTOR_BACKEND       = os.getenv("VECTOR_BACKEND", "rust")
DEVDB_URL            = os.getenv("DEVDB_URL", "http://localhost:8080")
HNSW_M               = 16
HNSW_EF_CONSTRUCTION = 200
HNSW_EF_SEARCH       = 100

# ─────────────────────────────────────────────────────────────────────────────
# Embedding model
# ─────────────────────────────────────────────────────────────────────────────
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
# Use local HF cache snapshot to avoid re-downloading the model.
_HF_CACHE       = Path.home() / ".cache" / "huggingface" / "hub"
_MODEL_SNAPSHOT = (
    _HF_CACHE
    / "models--sentence-transformers--all-MiniLM-L6-v2"
    / "snapshots"
    / "c9745ed1d9f207416be6d2e6f8de32d1f16199bf"
)
EMBED_MODEL_PATH = str(_MODEL_SNAPSHOT) if _MODEL_SNAPSHOT.exists() else EMBED_MODEL

# ─────────────────────────────────────────────────────────────────────────────
# LLM provider
# ─────────────────────────────────────────────────────────────────────────────
GROQ_MODEL = "openai/gpt-oss-120b"

# ─────────────────────────────────────────────────────────────────────────────
# Chunking
# ─────────────────────────────────────────────────────────────────────────────
CHUNK_SIZE      = 512   # tokens (approx characters / 4)
CHUNK_OVERLAP   = 80    # overlap in tokens
MIN_CHUNK_CHARS = 100   # drop tiny fragments

# ─────────────────────────────────────────────────────────────────────────────
# Retrieval hyper-parameters
# ─────────────────────────────────────────────────────────────────────────────
TOP_K       = 20    # candidates before MMR
MMR_K       = 10    # final chunks after diversity re-rank (rows are short; 6 missed too much)
MMR_LAMBDA  = 0.6   # relevance vs. diversity trade-off (0=diversity, 1=relevance)
EXPANSION_N = 3     # number of extra HyDE queries to generate
MIN_SCORE   = 0.25  # cosine score floor (drop noisy results)
