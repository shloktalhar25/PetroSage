# -*- coding: utf-8 -*-
"""
api/compliance.py - Regulations page: upload a proposal, review it against the indexed law.

Storage: each upload gets a random 32-hex id and a folder under uploads/compliance/<id>/
holding original.<ext>, document.json (extracted sections) and analysis.json (job state and
findings). Client-supplied names are only ever displayed, never used as paths. Folders older
than COMPLIANCE_RETENTION_HOURS are deleted whenever a new document is uploaded.

Analysis runs on a single background worker (one Groq-heavy job at a time); the client polls
GET /documents/{id} until the status is "succeeded" or "failed".

    GET    /api/compliance/documents                 recent uploads (newest first)
    POST   /api/compliance/documents                 upload a file (multipart "file") -> starts analysis
    POST   /api/compliance/sample                    load the bundled sample proposal -> starts analysis
    GET    /api/compliance/documents/{id}            document sections + analysis status/findings
    POST   /api/compliance/documents/{id}/analyze    re-run the analysis (409 while one is running)
    GET    /api/compliance/documents/{id}/file       download the original upload
    GET    /api/compliance/documents/{id}/report     download the findings as a Markdown report
    DELETE /api/compliance/documents/{id}            delete the upload and its analysis
"""

import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.concurrency import run_in_threadpool

from api.sources import PROJECT_ROOT, source_id
from core.config import (
    COMPLIANCE_MAX_UPLOAD_MB, COMPLIANCE_RETENTION_HOURS, COMPLIANCE_SAMPLE_PATH,
    COMPLIANCE_UPLOAD_DIR, GROQ_MODEL,
)
from data.document_text import SUPPORTED_EXTENSIONS, DocumentError, extract_sections

log = logging.getLogger("petrosage.compliance")
router = APIRouter(prefix="/api/compliance")

UPLOAD_ROOT = PROJECT_ROOT / COMPLIANCE_UPLOAD_DIR
MAX_BYTES = COMPLIANCE_MAX_UPLOAD_MB * 1024 * 1024
_ID_RE = re.compile(r"^[0-9a-f]{32}$")
DISCLAIMER = (
    "Machine-assisted review against the regulation excerpts indexed in PetroSage only. "
    "It is not legal advice, may miss issues, and should be confirmed by qualified counsel."
)

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="compliance")
_active: set = set()           # document ids queued or running in this process
_active_lock = threading.Lock()
_llm = None


# ── Storage helpers ──────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _doc_dir(doc_id: str) -> Path:
    if not _ID_RE.fullmatch(doc_id):
        raise HTTPException(status_code=404, detail="Document not found.")
    path = UPLOAD_ROOT / doc_id
    if not (path / "document.json").is_file():
        raise HTTPException(status_code=404, detail="Document not found. It may have expired.")
    return path


def _read_json(path: Path) -> Optional[Dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_json(path: Path, data: Dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)  # atomic: pollers never see a half-written file


def _display_name(name: str) -> str:
    name = re.split(r"[\\/]", name or "")[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:150] or "document"


def _cleanup_expired() -> None:
    if not UPLOAD_ROOT.is_dir():
        return
    cutoff = time.time() - COMPLIANCE_RETENTION_HOURS * 3600
    for child in UPLOAD_ROOT.iterdir():
        if child.is_dir() and _ID_RE.fullmatch(child.name) and child.stat().st_mtime < cutoff:
            with _active_lock:
                if child.name in _active:
                    continue
            shutil.rmtree(child, ignore_errors=True)
            log.info("Deleted expired compliance upload %s", child.name)


def _analysis_state(doc_id: str, folder: Path) -> Dict:
    analysis = _read_json(folder / "analysis.json") or {"status": "not_started"}
    with _active_lock:
        in_flight = doc_id in _active
    if analysis["status"] in ("queued", "running") and not in_flight:
        # The process restarted while this job was running.
        analysis = {**analysis, "status": "failed",
                    "error": "The analysis was interrupted (the server restarted). Run it again."}
    return analysis


def _public_document(meta: Dict) -> Dict:
    return {k: meta[k] for k in ("id", "name", "kind", "size", "uploadedAt", "pageCount", "sections")}


# ── Analysis job ─────────────────────────────────────────────────────────────

def _get_llm():
    global _llm
    if _llm is None:
        from data.llm import LLMProvider
        _llm = LLMProvider()
    return _llm


def _safe_error(e: Exception) -> str:
    from rag.compliance import AnalysisError
    if isinstance(e, AnalysisError):
        return str(e)
    if isinstance(e, EnvironmentError) and "GROQ_API_KEY" in str(e):
        return "The Groq API key is not configured on the server (GROQ_API_KEY in .env)."
    name = type(e).__name__
    if name == "RateLimitError":
        return "The AI provider's rate limit was reached. Wait about a minute and retry."
    if name in ("APIConnectionError", "APITimeoutError"):
        return "The AI provider could not be reached. Check the server's internet connection and retry."
    if name in ("AuthenticationError", "PermissionDeniedError"):
        return "The AI provider rejected the server's API key."
    return "The analysis failed unexpectedly. Retry, and check the API server log if it keeps failing."


def _run_analysis(doc_id: str) -> None:
    folder = UPLOAD_ROOT / doc_id
    path = folder / "analysis.json"
    try:
        meta = _read_json(folder / "document.json")
        if meta is None:
            return  # deleted while queued
        state = {**(_read_json(path) or {}), "status": "running", "startedAt": _now()}
        _write_json(path, state)

        from data.embeddings import Embedder
        from rag import compliance as review
        result = review.analyze(meta["sections"], _get_llm(), Embedder.get())
        for f in result["findings"]:
            f["law"]["sourceId"] = source_id(f["law"].pop("sourceFile"))
        if folder.is_dir():
            _write_json(path, {**state, **result, "status": "succeeded", "finishedAt": _now(),
                               "model": GROQ_MODEL, "disclaimer": DISCLAIMER})
    except Exception as e:  # recorded for the UI; full detail stays in the server log
        log.exception("Compliance analysis failed for %s", doc_id)
        if folder.is_dir():
            _write_json(path, {**(_read_json(path) or {}), "status": "failed",
                               "finishedAt": _now(), "error": _safe_error(e)})
    finally:
        with _active_lock:
            _active.discard(doc_id)


def _start_analysis(doc_id: str) -> Dict:
    with _active_lock:
        if doc_id in _active:
            raise HTTPException(status_code=409, detail="An analysis of this document is already running.")
        _active.add(doc_id)
    state = {"status": "queued", "queuedAt": _now()}
    _write_json(UPLOAD_ROOT / doc_id / "analysis.json", state)
    _executor.submit(_run_analysis, doc_id)
    return state


def _store_document(name: str, data: bytes) -> Dict:
    ext = Path(name).suffix.lower()
    kind = SUPPORTED_EXTENSIONS.get(ext)
    if kind is None:
        allowed = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Upload one of: {allowed}.")
    try:
        extracted = extract_sections(data, kind)
    except DocumentError as e:
        raise HTTPException(status_code=422, detail=str(e))

    _cleanup_expired()
    doc_id = uuid.uuid4().hex
    folder = UPLOAD_ROOT / doc_id
    folder.mkdir(parents=True)
    (folder / f"original{ext}").write_bytes(data)
    meta = {
        "id": doc_id, "name": _display_name(name), "kind": kind, "ext": ext, "size": len(data),
        "uploadedAt": _now(), **extracted,
    }
    _write_json(folder / "document.json", meta)
    analysis = _start_analysis(doc_id)
    return {"document": _public_document(meta), "analysis": analysis}


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/documents")
def list_documents() -> List[Dict]:
    if not UPLOAD_ROOT.is_dir():
        return []
    docs = []
    for child in UPLOAD_ROOT.iterdir():
        meta = _read_json(child / "document.json") if _ID_RE.fullmatch(child.name) else None
        if meta:
            analysis = _analysis_state(child.name, child)
            docs.append({
                "id": meta["id"], "name": meta["name"], "uploadedAt": meta["uploadedAt"],
                "status": analysis["status"],
                "findings": len(analysis.get("findings", [])) if analysis["status"] == "succeeded" else None,
            })
    return sorted(docs, key=lambda d: d["uploadedAt"], reverse=True)


@router.post("/documents", status_code=201)
async def upload_document(request: Request, file: UploadFile = File(...)) -> Dict:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES + 64 * 1024:
        raise HTTPException(status_code=413, detail=f"Files are limited to {COMPLIANCE_MAX_UPLOAD_MB} MB.")
    chunks, total = [], 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"Files are limited to {COMPLIANCE_MAX_UPLOAD_MB} MB.")
        chunks.append(chunk)
    if total == 0:
        raise HTTPException(status_code=422, detail="The file is empty.")
    # Extraction is CPU-bound (PDF parsing), so keep it off the event loop.
    return await run_in_threadpool(_store_document, file.filename or "document", b"".join(chunks))


@router.post("/sample", status_code=201)
def load_sample() -> Dict:
    path = PROJECT_ROOT / COMPLIANCE_SAMPLE_PATH
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The sample proposal is not available.")
    return _store_document(path.name, path.read_bytes())


@router.get("/documents/{doc_id}")
def get_document(doc_id: str) -> Dict:
    folder = _doc_dir(doc_id)
    meta = _read_json(folder / "document.json")
    return {"document": _public_document(meta), "analysis": _analysis_state(doc_id, folder)}


@router.post("/documents/{doc_id}/analyze", status_code=202)
def reanalyze(doc_id: str) -> Dict:
    _doc_dir(doc_id)
    return _start_analysis(doc_id)


@router.get("/documents/{doc_id}/file")
def download_original(doc_id: str) -> FileResponse:
    folder = _doc_dir(doc_id)
    meta = _read_json(folder / "document.json")
    return FileResponse(folder / f"original{meta['ext']}", filename=meta["name"])


def _location(page: Optional[int], row: Optional[int]) -> str:
    return f"page {page}" if page else f"paragraph {row}" if row else ""


def build_report(meta: Dict, analysis: Dict) -> str:
    """Markdown compliance report for one analysed document."""
    findings = analysis.get("findings", [])
    counts = {s: sum(f["severity"] == s for f in findings) for s in ("high", "medium", "low")}
    lines = [
        f"# Compliance review: {meta['name']}",
        "",
        f"- Reviewed: {analysis.get('finishedAt', '')} (UTC)",
        f"- Model: {analysis.get('model', '')}",
        f"- Checked against: {', '.join(analysis.get('lawSources', []))}",
        f"- Findings: {len(findings)} (high {counts['high']}, medium {counts['medium']}, low {counts['low']})",
    ]
    if analysis.get("truncated"):
        lines.append(f"- Note: only the first {analysis['analyzedSections']} of "
                     f"{analysis['totalSections']} sections were reviewed (document too long).")
    lines += ["", f"> {DISCLAIMER}", "", "## Summary", "", analysis.get("summary") or "No summary.", ""]
    if not findings:
        lines += ["## Findings", "", "No conflicts with the indexed regulation excerpts were found.", ""]
    for f in findings:
        where = f"Section {f['sectionId'][1:]}" + (f", page {f['page']}" if f.get("page") else "")
        law = f["law"]
        law_where = _location(law.get("page"), law.get("row"))
        lines += [
            f"## {f['id']}. {f['title']} ({f['severity'].upper()})",
            "",
            f"**Where:** {where}",
            "",
            f"> {f['quote']}",
            "",
            f"**Regulation:** {law['name']}{', ' + law_where if law_where else ''}",
            "",
            f"> {law['text']}",
            "",
            f"**Why it matters:** {f['explanation']}",
            "",
            f"**Recommended change:** {f['remediation']}",
            "",
        ]
    return "\n".join(lines)


@router.get("/documents/{doc_id}/report")
def download_report(doc_id: str) -> Response:
    folder = _doc_dir(doc_id)
    analysis = _analysis_state(doc_id, folder)
    if analysis["status"] != "succeeded":
        raise HTTPException(status_code=409, detail="The analysis has not finished yet.")
    meta = _read_json(folder / "document.json")
    stem = re.sub(r"[^\w.-]+", "_", Path(meta["name"]).stem)[:80] or "document"
    return Response(
        build_report(meta, analysis),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="compliance-report-{stem}.md"'},
    )


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str) -> Response:
    shutil.rmtree(_doc_dir(doc_id), ignore_errors=True)
    return Response(status_code=204)
