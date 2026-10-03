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
    GET  /api/config/public   Settings page         -> read-only model/retrieval/index info
    GET  /api/sources         Data Extraction page  -> every indexed document
    GET  /api/sources/{id}                          -> document viewer metadata
    GET  /api/sources/{id}/pages/{n}.png            -> rendered PDF page (cited text highlighted)
    GET  /api/sources/{id}/file                     -> original source file download
    /api/compliance/*         Regulations page      -> upload + compliance review (api/compliance.py)

RAG endpoints answer from the indexed data when it covers the question; otherwise (unless
the request sends allow_general=false) the model answers from its own knowledge and the
response is marked answerSource="general".
"""

import csv
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from api import adapters, compliance, sources
from core import config
from core.config import DEVDB_URL, MANUAL_DATA_DIR
from core.models import RAGResponse
from rag.pipeline import RAGPipeline

log = logging.getLogger("petrosage.api")

MIDSTREAM_CSV = MANUAL_DATA_DIR / "midstream" / "midstream_assets_final.csv"

_pipeline: Optional[RAGPipeline] = None
_pipeline_lock = threading.Lock()


MAX_QUERY_LEN = 2000


class QueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_QUERY_LEN)
    country: Optional[str] = None
    # Answer from the model's own knowledge when the index has nothing relevant.
    allow_general: bool = True


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
app.include_router(compliance.router)  # /api/compliance/* - Regulations page


def _run_rag(req: QueryRequest, scope: Optional[str] = None) -> RAGResponse:
    """`scope` pins retrieval to a Manual_data folder (tagged as the chunk's country)."""
    try:
        pipeline = get_pipeline()
    except (RuntimeError, FileNotFoundError, EnvironmentError, httpx.HTTPError) as e:
        log.exception("Pipeline unavailable")
        raise HTTPException(status_code=503, detail=str(e))
    question = req.query.strip()
    country = scope or req.country or adapters.detect_country(question)
    auto_country = bool(country) and not (scope or req.country)
    # With a guessed country, hold the general fallback until the unscoped retry below.
    fallback_now = req.allow_general and not auto_country
    try:
        try:
            resp = pipeline.query(question, country=country, general_fallback=fallback_now)
        except RuntimeError as e:
            # DevDB was restarted or its collection replaced (e.g. by live tests): reload our snapshot once.
            if "dimension mismatch" not in str(e) and "no collection" not in str(e):
                raise
            log.warning("DevDB lost the index (%s); reloading snapshot", e)
            pipeline.retriever.store.load()
            resp = pipeline.query(question, country=country, general_fallback=fallback_now)
        # An auto-detected country can be wrong; retry unscoped rather than answer "not found".
        if not resp.chunks and auto_country:
            resp = pipeline.query(question, general_fallback=req.allow_general)
        return resp
    except Exception as e:
        log.exception("RAG query failed")
        raise HTTPException(status_code=502, detail=f"RAG query failed: {e}")


@app.get("/api/health")
def health() -> Dict:
    try:
        devdb_ok = httpx.get(f"{DEVDB_URL}/health", timeout=2.0).status_code == 200
    except httpx.HTTPError:
        devdb_ok = False
    return {
        "api": "ok",
        "devdb": devdb_ok,
        "pipeline_loaded": _pipeline is not None,
        "snapshot": (sources.PROJECT_ROOT / config.SNAPSHOT_PATH).exists(),
        "groq_key_configured": bool(os.getenv("GROQ_API_KEY")),  # never the key itself
    }


@app.get("/api/config/public")
def public_config() -> Dict:
    """Read-only server settings for the Settings page. Contains no secrets."""
    from rag.crag import CRAG_MODEL  # local import: keeps the module light for health checks

    meta_path = sources.PROJECT_ROOT / config.META_PATH
    index = json.loads(meta_path.read_text()) if meta_path.exists() else None
    return {
        "provider": "Groq",
        "model": config.GROQ_MODEL,
        "cragModel": CRAG_MODEL,
        "embedModel": config.EMBED_MODEL,
        "vectorBackend": config.VECTOR_BACKEND,
        "retrieval": {
            "topK": config.TOP_K,
            "mmrK": config.MMR_K,
            "mmrLambda": config.MMR_LAMBDA,
            "minScore": config.MIN_SCORE,
            "expansionQueries": config.EXPANSION_N,
        },
        "index": {"chunks": index.get("num_chunks"), "source": index.get("source")} if index else None,
        "maxQueryLength": MAX_QUERY_LEN,
    }


@app.post("/api/rag")
@app.post("/api/rag/market")
def rag(req: QueryRequest) -> Dict:
    resp = _run_rag(req)
    return adapters.to_search_response(resp.answer, resp.chunks, resp.answer_source)


@app.post("/api/upstream/ai")
def upstream_ai(req: QueryRequest) -> Dict:
    resp = _run_rag(req, scope="upstream")
    return adapters.to_text_response(resp.answer, resp.chunks, resp.answer_source)


@app.post("/api/midstream/ai")
def midstream_ai(req: QueryRequest) -> Dict:
    resp = _run_rag(req, scope="midstream")
    return adapters.to_midstream_response(
        resp.answer, resp.chunks, app.state.midstream_assets, resp.answer_source
    )


def _source_path(source_id: str):
    path = sources.resolve(source_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Source file not found.")
    return path


@app.get("/api/sources")
def source_list() -> List[Dict]:
    return sources.list_sources()


@app.get("/api/sources/{source_id}")
def source_info(source_id: str) -> Dict:
    return sources.describe(_source_path(source_id))


@app.get("/api/sources/{source_id}/pages/{page_no}.png")
def source_page(
    source_id: str,
    page_no: int,
    zoom: float = Query(1.5, ge=sources.MIN_ZOOM, le=sources.MAX_ZOOM),
    hl: str = Query("", max_length=500, description="comma-separated chunk ids to highlight"),
) -> Response:
    path = _source_path(source_id)
    if sources.kind_of(path) != "pdf":
        raise HTTPException(status_code=400, detail="Only PDF sources have rendered pages.")
    png = sources.render_page(path, page_no, zoom, [c for c in hl.split(",") if c])
    if png is None:
        raise HTTPException(status_code=404, detail=f"Page {page_no} does not exist.")
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/sources/{source_id}/file")
def source_file(source_id: str) -> FileResponse:
    path = _source_path(source_id)
    return FileResponse(path, filename=path.name)
