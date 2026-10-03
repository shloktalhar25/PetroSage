# -*- coding: utf-8 -*-
"""Compliance review: finding validation (pure) and the upload/analysis API (AI mocked)."""

import os
import time

import pytest
from fastapi.testclient import TestClient

from api import compliance, server
from rag import compliance as review

SECTIONS = [
    {"id": "S1", "page": None, "text": "1. PERMITS\nThe rig can proceed without prior MoEFCC Environmental Clearance."},
    {"id": "S2", "page": None, "text": "2. WASTE\nProduced water will be discharged directly into the sea."},
]
PASSAGES = [
    {"chunkId": "7", "sourceFile": "Manual_data/regulations/laws.txt", "name": "laws.txt", "page": None,
     "row": 2, "text": "All offshore projects require prior Environmental Clearance."},
    {"chunkId": "8", "sourceFile": "Manual_data/regulations/laws.txt", "name": "laws.txt", "page": None,
     "row": 3, "text": "Discharge of untreated produced water is prohibited."},
]


# ── Pure validation ──────────────────────────────────────────────────────────

def test_locate_quote_ignores_case_punctuation_and_spacing():
    text = SECTIONS[0]["text"]
    start, end = review.locate_quote("“can proceed without prior MoEFCC environmental-clearance”", text)
    assert text[start:end] == "can proceed without prior MoEFCC Environmental Clearance"


def test_locate_quote_uses_longest_fragment_around_ellipsis():
    span = review.locate_quote("The rig ... without prior MoEFCC Environmental Clearance", SECTIONS[0]["text"])
    assert span is not None


def test_findings_citing_unknown_law_are_dropped():
    raw = [{"section": "S1", "quote": "without prior MoEFCC", "law": "L9", "severity": "high"}]
    assert review.validate_findings(raw, SECTIONS, PASSAGES) == []


def test_finding_is_pinned_and_wrong_section_is_corrected():
    raw = [{"section": "S1", "quote": "discharged directly into the sea", "law": "[L2]", "severity": "Critical",
            "title": "Untreated discharge", "explanation": "e", "remediation": "r"}]
    [f] = review.validate_findings(raw, SECTIONS, PASSAGES)
    assert f["sectionId"] == "S2" and f["quoteVerified"] and f["severity"] == "high"
    assert SECTIONS[1]["text"][f["start"]:f["end"]] == "discharged directly into the sea"
    assert f["law"]["chunkId"] == "8" and f["law"]["row"] == 3


def test_paraphrased_quote_in_valid_section_is_kept_unverified():
    raw = [{"section": "S2", "quote": "they plan to dump water", "law": "L2", "severity": "medium"}]
    [f] = review.validate_findings(raw, SECTIONS, PASSAGES)
    assert f["quoteVerified"] is False and f["start"] is None and f["sectionId"] == "S2"


def test_paraphrase_without_valid_section_is_dropped():
    raw = [{"section": "S7", "quote": "something not in the document", "law": "L1"}]
    assert review.validate_findings(raw, SECTIONS, PASSAGES) == []


@pytest.mark.parametrize("reply", ['```json\n{"findings": [], "summary": "ok"}\n```', 'Here: {"findings": []}'])
def test_parse_response_tolerates_fences_and_prose(reply):
    assert review.parse_response(reply)["findings"] == []


@pytest.mark.parametrize("reply", ["no json here", '{"findings": "nope"}', "{broken"])
def test_parse_response_rejects_bad_replies(reply):
    with pytest.raises(review.AnalysisError):
        review.parse_response(reply)


def test_long_documents_are_batched_and_marked_truncated():
    sections = [{"id": f"S{i}", "page": None, "text": "x" * 3000} for i in range(10)]
    batches, truncated = review.batch_sections(sections)
    assert len(batches) == review.MAX_BATCHES and truncated


class _TopicEmbedder:
    """One dimension per topic word, so similarity is exactly 'shares the topic'."""
    TOPICS = ("safety", "discharge", "lease")

    def encode(self, texts):
        return [[float(t in text.lower()) for t in self.TOPICS] for text in texts]


def test_select_gives_every_section_its_best_passage():
    law = "Manual_data/regulations/India_Offshore_Maritime_Laws.txt"
    records = [{"id": i, "source_file": law, "row": i, "text": text} for i, text in enumerate([
        "Offshore safety rules apply to platforms.", "Safety standards cover installations.",
        "Untreated discharge into the sea is prohibited.",
        "A petroleum lease is required before production.",
    ])]
    corpus = review.LawCorpus(records, _TopicEmbedder())
    sections = [
        "The platform follows offshore safety rules, safety standards and safety zones. " * 3,
        "Discharge plan: produced water goes overboard daily. " * 4,
        "Short title: lease",
    ]

    texts = [p["text"] for p in corpus.select(sections, k=2)]

    # Ranking passages globally gives both slots to the safety section; the title doesn't compete.
    assert texts == [records[0]["text"], records[2]["text"]]


# ── API (analysis mocked, files in a temp dir) ───────────────────────────────

class _InlineExecutor:
    def submit(self, fn, *args):
        fn(*args)


FAKE_RESULT = {
    "findings": [{
        "id": "F1", "severity": "high", "title": "No clearance", "sectionId": "S1", "page": None,
        "quote": "without prior", "start": 0, "end": 5, "quoteVerified": True,
        "explanation": "why", "remediation": "fix",
        "law": {**PASSAGES[0]},
    }],
    "summary": "One issue.", "analyzedSections": 1, "totalSections": 1, "truncated": False,
    "lawSources": ["laws.txt"],
}

DOC = b"1. PERMITS\n\nThe rig can proceed without prior MoEFCC Environmental Clearance or any approval."


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(compliance, "UPLOAD_ROOT", tmp_path)
    monkeypatch.setattr(compliance, "_executor", _InlineExecutor())
    monkeypatch.setattr(compliance, "_get_llm", lambda: object())
    monkeypatch.setattr("data.embeddings.Embedder.get", classmethod(lambda cls: object()))
    monkeypatch.setattr(review, "analyze", lambda sections, llm, emb: {
        **FAKE_RESULT, "findings": [dict(f, law=dict(f["law"])) for f in FAKE_RESULT["findings"]]})
    return TestClient(server.app)


def _upload(client, name="plan.txt", data=DOC):
    return client.post("/api/compliance/documents", files={"file": (name, data, "text/plain")})


def test_upload_analyses_and_serves_report_and_original(client, tmp_path):
    r = _upload(client)
    assert r.status_code == 201
    doc_id = r.json()["document"]["id"]
    body = client.get(f"/api/compliance/documents/{doc_id}").json()
    assert body["analysis"]["status"] == "succeeded"
    finding = body["analysis"]["findings"][0]
    assert finding["law"]["sourceId"] and "sourceFile" not in finding["law"]  # no paths leak
    report = client.get(f"/api/compliance/documents/{doc_id}/report")
    assert report.status_code == 200 and "## F1. No clearance (HIGH)" in report.text
    assert "not legal advice" in report.text
    assert client.get(f"/api/compliance/documents/{doc_id}/file").content == DOC
    assert [d["id"] for d in client.get("/api/compliance/documents").json()] == [doc_id]


def test_unsafe_filename_is_display_only(client, tmp_path):
    doc_id = _upload(client, name="../../etc/evil.txt").json()["document"]["id"]
    assert client.get(f"/api/compliance/documents/{doc_id}").json()["document"]["name"] == "evil.txt"
    assert sorted(p.name for p in (tmp_path / doc_id).iterdir()) == ["analysis.json", "document.json", "original.txt"]


@pytest.mark.parametrize("name,data,status", [
    ("plan.exe", DOC, 400),
    ("plan.doc", DOC, 400),
    ("plan.txt", b"", 422),
    ("plan.pdf", b"this is not a pdf", 422),
    ("plan.txt", b"short", 422),
])
def test_invalid_uploads_are_rejected(client, name, data, status):
    assert _upload(client, name, data).status_code == status


def test_oversized_upload_is_rejected(client, monkeypatch):
    monkeypatch.setattr(compliance, "MAX_BYTES", 100)
    assert _upload(client, data=DOC * 5).status_code == 413


@pytest.mark.parametrize("bad", ["../../etc", "0" * 31, "Z" * 32, "deadbeef" * 4])
def test_unknown_or_malformed_ids_are_404(client, bad):
    assert client.get(f"/api/compliance/documents/{bad}").status_code == 404
    assert client.delete(f"/api/compliance/documents/{bad}").status_code == 404


def test_delete_removes_files(client, tmp_path):
    doc_id = _upload(client).json()["document"]["id"]
    assert client.delete(f"/api/compliance/documents/{doc_id}").status_code == 204
    assert not (tmp_path / doc_id).exists()
    assert client.get(f"/api/compliance/documents/{doc_id}").status_code == 404


def test_second_analysis_while_running_is_409(client, monkeypatch):
    doc_id = _upload(client).json()["document"]["id"]
    monkeypatch.setattr(compliance, "_executor", type("Hold", (), {"submit": lambda self, *a: None})())
    assert client.post(f"/api/compliance/documents/{doc_id}/analyze").status_code == 202
    assert client.post(f"/api/compliance/documents/{doc_id}/analyze").status_code == 409


def test_report_before_analysis_finishes_is_409(client, monkeypatch):
    monkeypatch.setattr(compliance, "_executor", type("Hold", (), {"submit": lambda self, *a: None})())
    doc_id = _upload(client).json()["document"]["id"]
    assert client.get(f"/api/compliance/documents/{doc_id}/report").status_code == 409


def test_provider_failure_is_recorded_with_safe_message(client, monkeypatch):
    class RateLimitError(Exception):
        pass

    def boom(*_):
        raise RateLimitError("429 org_secret details")
    monkeypatch.setattr(review, "analyze", boom)
    doc_id = _upload(client).json()["document"]["id"]
    analysis = client.get(f"/api/compliance/documents/{doc_id}").json()["analysis"]
    assert analysis["status"] == "failed"
    assert "rate limit" in analysis["error"] and "org_secret" not in analysis["error"]


def test_job_lost_to_restart_reports_failed(client, monkeypatch):
    monkeypatch.setattr(compliance, "_executor", type("Hold", (), {"submit": lambda self, *a: None})())
    doc_id = _upload(client).json()["document"]["id"]
    compliance._active.discard(doc_id)  # simulate a fresh process
    analysis = client.get(f"/api/compliance/documents/{doc_id}").json()["analysis"]
    assert analysis["status"] == "failed" and "interrupted" in analysis["error"]


def test_expired_uploads_are_cleaned_up_on_next_upload(client, tmp_path):
    old_id = _upload(client).json()["document"]["id"]
    old = time.time() - (compliance.COMPLIANCE_RETENTION_HOURS + 1) * 3600
    os.utime(tmp_path / old_id, (old, old))
    _upload(client)
    assert not (tmp_path / old_id).exists()


def test_sample_proposal_loads(client):
    r = client.post("/api/compliance/sample")
    assert r.status_code == 201 and r.json()["document"]["name"] == "Company_Rig_Proposal_2026.txt"
