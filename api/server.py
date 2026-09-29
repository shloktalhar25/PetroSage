# -*- coding: utf-8 -*-
"""
api/server.py - FastAPI wrapper around RAGPipeline for the React frontend.

Run from the repo root (core/config.py uses relative paths):

    uvicorn api.server:app --port 8000

Endpoints (the frontend reaches them through the Vite dev proxy):
    GET  /api/health          API + DevDB status
    POST /api/rag             DataSearch page       -> {paragraphs, sources, meta}
    POST /api/rag/market      Intelligence Review   -> {paragraphs, sources, meta}
    POST /api/upstream/ai     Upstream page         -> {text, refs}
    POST /api/midstream/ai    Midstream page        -> {text, detail, highlight, flyTo, refs}
"""

import csv
import logging
import threading
from contextlib import asynccontextmanager
from typing import Dict, Optional, Tuple

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from api import adapters
from core.config import DEVDB_URL, MANUAL_DATA_DIR
from core.models import RAGResponse
from rag.pipeline import RAGPipeline

log = logging.getLogger("petrosage.api")

MIDSTREAM_CSV = MANUAL_DATA_DIR / "midstream" / "midstream_assets_final.csv"

_pipeline: Optional[RAGPipeline] = None
_pipeline_lock = threading.Lock()


class QueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    country: Optional[str] = None


def get_pipeline() -> RAGPipeline:
    """Lazily build the pipeline once (loads embedding model + DevDB snapshot)."""
    global _pipeline
    with _pipeline_lock:
        if _pipeline is None:
            _pipeline = RAGPipeline()
        return _pipeline


def _load_midstream_assets() -> Dict[str, Tuple[float, float, str]]:
    """AssetID -> (lat, lng, name) so answers can highlight assets on the map."""
    if not MIDSTREAM_CSV.exists():
        log.warning("Midstream CSV not found at %s; map highlighting disabled", MIDSTREAM_CSV)
        return {}
    with open(MIDSTREAM_CSV, newline="", encoding="utf-8") as f:
        return {
            row["AssetID"]: (float(row["Lat"]), float(row["Lng"]), row.get("Name", ""))
            for row in csv.DictReader(f)
            if row.get("AssetID") and row.get("Lat") and row.get("Lng")
        }


@asynccontextmanager
async def lifespan(_: FastAPI):
    app.state.midstream_assets = _load_midstream_assets()
    try:
        get_pipeline()  # warm up so the first user query isn't slow
        log.info("RAG pipeline ready")
    except Exception as e:  # DevDB may simply not be up yet; retried on first query
        log.warning("RAG pipeline not ready at startup: %s", e)
    yield


app = FastAPI(title="PetroSage API", lifespan=lifespan)


def _run_rag(req: QueryRequest, scope: Optional[str] = None) -> RAGResponse:
    """`scope` pins retrieval to a Manual_data folder (tagged as the chunk's country)."""
    try:
        pipeline = get_pipeline()
    except (RuntimeError, FileNotFoundError, EnvironmentError, httpx.HTTPError) as e:
        log.exception("Pipeline unavailable")
        raise HTTPException(status_code=503, detail=str(e))
    try:
        return pipeline.query(req.query.strip(), country=scope or req.country or None)
    except Exception as e:
        log.exception("RAG query failed")
        raise HTTPException(status_code=502, detail=f"RAG query failed: {e}")


@app.get("/api/health")
def health() -> Dict:
    try:
        devdb_ok = httpx.get(f"{DEVDB_URL}/health", timeout=2.0).status_code == 200
    except httpx.HTTPError:
        devdb_ok = False
    return {"api": "ok", "devdb": devdb_ok, "pipeline_loaded": _pipeline is not None}


@app.post("/api/rag")
@app.post("/api/rag/market")
def rag(req: QueryRequest) -> Dict:
    resp = _run_rag(req)
    return adapters.to_search_response(resp.answer, resp.chunks)


@app.post("/api/upstream/ai")
def upstream_ai(req: QueryRequest) -> Dict:
    resp = _run_rag(req, scope="upstream")
    return adapters.to_text_response(resp.answer, resp.chunks)


@app.post("/api/midstream/ai")
def midstream_ai(req: QueryRequest) -> Dict:
    resp = _run_rag(req, scope="midstream")
    return adapters.to_midstream_response(
        resp.answer, resp.chunks, app.state.midstream_assets
    )
