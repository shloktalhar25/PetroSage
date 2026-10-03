# -*- coding: utf-8 -*-
"""
rag/compliance.py - Check a document's sections against the indexed law passages.

Flow:
  1. The law corpus is every indexed chunk from config.COMPLIANCE_LAW_SOURCES, split into
     ~700-character passages so each citation points at a specific provision.
  2. For each batch of document sections, the passages most similar to those sections
     (embedding cosine) are selected - the corpus is small, so this is done in memory and
     does not need DevDB.
  3. The LLM gets the numbered sections [S1..] and passages [L1..] and must return JSON
     findings that each quote the document and cite one passage.
  4. Every finding is validated: an unknown passage id drops the finding (no claim without
     a source), and the quote is located in the document text so the UI can highlight it.
"""

import json
import logging
import pickle
import re
import threading
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

# pyrefly: ignore [import-error, missing-import]
import numpy as np

from core.config import CHUNKS_PATH, COMPLIANCE_LAW_SOURCES

log = logging.getLogger("petrosage.compliance")

_PASSAGE_CHARS = 700
BATCH_CHARS = 6000           # document text per LLM call (Groq free tier: ~8k tokens/request)
MAX_BATCHES = 3              # longer documents are analysed up to this point and marked truncated
PASSAGES_PER_BATCH = 9      # ~6.3k chars of law text; keeps each request under ~6k tokens
MAX_OUTPUT_TOKENS = 4000     # includes the model's reasoning; ~7 findings overflowed 2500
_MIN_SELECT_CHARS = 150     # shorter sections (titles, tables, signatures) don't pick law passages
SEVERITIES = ("high", "medium", "low")

SYSTEM_PROMPT = """\
You are a regulatory compliance reviewer for oil and gas operations in India.

You receive a PROPOSAL split into numbered sections [S1], [S2], ... and LAW passages
[L1], [L2], ... taken from the regulations on file.

Find statements in the proposal that conflict with, or skip a requirement of, a LAW passage.

Rules:
- Only report an issue that a specific LAW passage supports. Cite exactly one passage id.
- One statement can break several laws (for example a missing environmental clearance AND a
  missing government or defence authorization): report a separate finding for each law.
- "quote" must be copied word-for-word from the cited proposal section: the single sentence
  that conflicts, max 200 characters.
- Keep "explanation" and "remediation" to one or two sentences each.
- Do not report issues the LAW passages do not address, and do not invent laws or sections.
- severity: "high" = the proposal goes ahead with something the law prohibits or without a
  mandatory approval; "medium" = a required compliance step is missing or unclear;
  "low" = a documentation or clarity gap.
- If nothing conflicts, return an empty findings list.

Reply with JSON only, no markdown fences:
{"findings": [{"section": "S3", "quote": "...", "law": "L2", "severity": "high",
  "title": "short issue title", "explanation": "why this conflicts, referring to the passage",
  "remediation": "what the proposal should change"}],
 "summary": "two or three sentences on the overall compliance position"}
"""


class AnalysisError(RuntimeError):
    """The analysis could not be completed (message is safe to show the user)."""


# ── Law corpus ────────────────────────────────────────────────────────────────

def _split_passages(text: str) -> List[str]:
    """Split a chunk into sentence-aligned passages of about _PASSAGE_CHARS."""
    sentences = re.split(r"(?<=[.;:])\s+|\n+", text)
    out, current = [], ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if current and len(current) + len(s) + 1 > _PASSAGE_CHARS:
            out.append(current)
            current = s
        else:
            current = f"{current} {s}" if current else s
    if current:
        out.append(current)
    return out


_STOPWORDS = set(
    "the and for with that this from are was were will shall any all its not into such under "
    "per has have been their which within without onto than other also may can must".split()
)


def _terms(text: str) -> set:
    """Lower-cased content words and numbers (e.g. "12", "7(5)" -> "7"), for keyword overlap."""
    return {w for w in re.findall(r"[a-z0-9]+", text.lower())
            if (len(w) >= 3 or w.isdigit()) and w not in _STOPWORDS}


class LawCorpus:
    """Law passages plus their (normalised) embeddings, built once per process."""

    def __init__(self, records: Sequence[Dict], embedder):
        wanted = {s.replace("\\", "/") for s in COMPLIANCE_LAW_SOURCES}
        self.passages: List[Dict] = []
        for r in records:
            source = str(r.get("source_file", "")).replace("\\", "/")
            if source not in wanted:
                continue
            for text in _split_passages(r.get("text", "")):
                self.passages.append({
                    "chunkId": str(r["id"]),
                    "sourceFile": source,
                    "name": Path(source).name,
                    "page": int(r["page"]) if r.get("page") not in (None, "", -1) else None,
                    "row": int(r["row"]) if r.get("row") not in (None, "") else None,
                    "text": text,
                })
        if not self.passages:
            raise AnalysisError("No regulation sources are indexed. Run python ingest.py first.")
        self.embedder = embedder
        self.vectors = np.asarray(embedder.encode([p["text"] for p in self.passages]), dtype="float32")
        self._terms = [_terms(p["text"]) for p in self.passages]

    @property
    def source_names(self) -> List[str]:
        return sorted({p["name"] for p in self.passages})

    def select(self, section_texts: Sequence[str], k: int = PASSAGES_PER_BATCH) -> List[Dict]:
        """
        Up to k passages relevant to these sections, taken round-robin: every section's best
        passage first (strongest sections first), then every section's second best, and so on.

        Score = 70% embedding similarity + 30% keyword overlap. The small embedding model
        alone ranks generic overview text above the specific provision (e.g. the EEZ Act
        for a "24 NM offshore rig"); shared terms like "EEZ", "12 NM" or "clearance" fix that.
        Round-robin stops a few sections with high-scoring generic matches from taking every
        slot, and short pieces (titles, tables, signature blocks) don't compete at all.
        """
        texts = [t for t in section_texts if len(t) >= _MIN_SELECT_CHARS] or list(section_texts)
        vecs = np.asarray(self.embedder.encode(texts), dtype="float32")
        semantic = vecs @ self.vectors.T                                  # (sections, passages)
        keyword = np.array([
            [len(st & pt) / max(1, len(st)) for pt in self._terms]
            for st in (_terms(t) for t in texts)
        ])
        scores = 0.7 * semantic + 0.3 * keyword
        ranked = np.argsort(-scores, axis=1)
        section_order = np.argsort(-scores.max(axis=1))
        chosen: List[int] = []
        for rank in range(ranked.shape[1]):
            for s in section_order:
                p = int(ranked[s, rank])
                if p not in chosen:
                    chosen.append(p)
                    if len(chosen) == k:
                        return [self.passages[i] for i in chosen]
        return [self.passages[i] for i in chosen]


_corpus: Optional[LawCorpus] = None
_corpus_lock = threading.Lock()


def get_corpus(embedder, chunks_path: Path = CHUNKS_PATH) -> LawCorpus:
    global _corpus
    with _corpus_lock:
        if _corpus is None:
            if not chunks_path.exists():
                raise AnalysisError("The search index is missing. Run python ingest.py first.")
            with open(chunks_path, "rb") as f:
                _corpus = LawCorpus(pickle.load(f), embedder)
        return _corpus


# ── Prompting and validation ─────────────────────────────────────────────────

def batch_sections(sections: Sequence[Dict]) -> Tuple[List[List[Dict]], bool]:
    """Group sections into batches of ~BATCH_CHARS; True if the document was cut off."""
    batches: List[List[Dict]] = []
    current: List[Dict] = []
    size = 0
    for s in sections:
        if current and size + len(s["text"]) > BATCH_CHARS:
            batches.append(current)
            current, size = [], 0
        current.append(s)
        size += len(s["text"])
    if current:
        batches.append(current)
    return batches[:MAX_BATCHES], len(batches) > MAX_BATCHES


def build_messages(sections: Sequence[Dict], passages: Sequence[Dict]) -> List[Dict]:
    proposal = "\n\n".join(f"[{s['id']}] {s['text']}" for s in sections)
    law = "\n\n".join(
        f"[L{i}] ({p['name']}{', page ' + str(p['page']) if p['page'] else ''}) {p['text']}"
        for i, p in enumerate(passages, 1)
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"PROPOSAL:\n{proposal}\n\nLAW:\n{law}"},
    ]


def parse_response(text: str) -> Dict:
    """The JSON object in a model reply (tolerates code fences and surrounding prose)."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise AnalysisError("The AI reply was not in the expected format. Please retry.")
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise AnalysisError("The AI reply was not in the expected format. Please retry.") from e
    if not isinstance(data, dict) or not isinstance(data.get("findings", []), list):
        raise AnalysisError("The AI reply was not in the expected format. Please retry.")
    return data


def locate_quote(quote: str, text: str) -> Optional[Tuple[int, int]]:
    """(start, end) of the quote in text, ignoring case, punctuation and spacing differences."""
    quote = quote.strip().strip("\"'“”‘’").replace("…", "...")
    fragments = [f for f in quote.split("...") if len(re.findall(r"\w+", f)) >= 2] or [quote]
    for fragment in sorted(fragments, key=len, reverse=True):
        words = re.findall(r"\w+", fragment)
        if not words:
            continue
        match = re.search(r"\W*".join(re.escape(w) for w in words), text, re.IGNORECASE)
        if match:
            return match.start(), match.end()
    return None


def _severity(value) -> str:
    v = str(value or "").strip().lower()
    if v in ("high", "critical", "severe"):
        return "high"
    if v in ("low", "minor", "info"):
        return "low"
    return "medium"


def validate_findings(raw: Sequence, sections: Sequence[Dict], passages: Sequence[Dict]) -> List[Dict]:
    """Keep findings that cite a real passage; pin each quote to its place in the document."""
    by_id = {s["id"]: s for s in sections}
    findings: List[Dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        law_match = re.fullmatch(r"\[?L(\d+)\]?", str(item.get("law", "")).strip(), re.IGNORECASE)
        law_idx = int(law_match.group(1)) - 1 if law_match else -1
        if not 0 <= law_idx < len(passages):
            log.info("Dropped finding citing unknown law passage %r", item.get("law"))
            continue

        quote = str(item.get("quote", ""))[:400]
        section = by_id.get(str(item.get("section", "")).strip("[] "))
        span = locate_quote(quote, section["text"]) if section else None
        if span is None:  # the model may have cited the wrong section; look everywhere
            for s in sections:
                span = locate_quote(quote, s["text"])
                if span:
                    section = s
                    break
        if section is None:
            log.info("Dropped finding whose quote and section were not found: %r", quote[:80])
            continue

        p = passages[law_idx]
        findings.append({
            "severity": _severity(item.get("severity")),
            "title": str(item.get("title") or "Possible non-compliance")[:160],
            "sectionId": section["id"],
            "page": section.get("page"),
            "quote": section["text"][span[0]:span[1]] if span else quote,
            "start": span[0] if span else None,
            "end": span[1] if span else None,
            "quoteVerified": span is not None,
            "explanation": str(item.get("explanation") or "")[:1500],
            "remediation": str(item.get("remediation") or "")[:1500],
            "law": {
                "chunkId": p["chunkId"], "sourceFile": p["sourceFile"], "name": p["name"],
                "page": p["page"], "row": p["row"], "text": p["text"],
            },
        })
    return findings


def _dedupe(findings: List[Dict]) -> List[Dict]:
    seen, out = set(), []
    for f in findings:
        key = (f["sectionId"], f["law"]["chunkId"], f["start"])
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def analyze(sections: Sequence[Dict], llm, embedder) -> Dict:
    """Run the full review. Raises AnalysisError with a user-safe message on failure."""
    corpus = get_corpus(embedder)
    batches, truncated = batch_sections(sections)
    findings: List[Dict] = []
    summaries: List[str] = []
    for batch in batches:
        passages = corpus.select([s["text"] for s in batch])
        reply = llm.call(build_messages(batch, passages), temperature=0.0, max_tokens=MAX_OUTPUT_TOKENS)
        data = parse_response(reply)
        findings.extend(validate_findings(data.get("findings", []), batch, passages))
        if data.get("summary"):
            summaries.append(str(data["summary"]).strip())

    order = {s: i for i, s in enumerate(SEVERITIES)}
    section_pos = {s["id"]: i for i, s in enumerate(sections)}
    findings = _dedupe(findings)
    findings.sort(key=lambda f: (order[f["severity"]], section_pos[f["sectionId"]]))
    for i, f in enumerate(findings, 1):
        f["id"] = f"F{i}"
    analyzed = sum(len(b) for b in batches)
    return {
        "findings": findings,
        "summary": " ".join(summaries)[:2000],
        "analyzedSections": analyzed,
        "totalSections": len(sections),
        "truncated": truncated,
        "lawSources": corpus.source_names,
    }
