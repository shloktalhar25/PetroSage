# -*- coding: utf-8 -*-
"""Document viewer API: stable ids, safe file access, real PDF pages (uses the repo's index)."""

import pytest
from fastapi.testclient import TestClient

from api import server, sources

pytestmark = pytest.mark.skipif(
    not (sources.PROJECT_ROOT / "index" / "chunks.pkl").exists(), reason="index not built"
)

client = TestClient(server.app)  # not entered as a context manager: no pipeline/DevDB startup


def _sid(suffix):
    return next(k for k, v in sources._load_registry().items() if v.endswith(suffix))


def test_source_id_is_stable_across_path_separators():
    assert sources.source_id("Manual_data/US/a b.pdf") == sources.source_id("Manual_data\\US\\a b.pdf")


def test_pdf_metadata_has_real_page_count():
    info = client.get(f"/api/sources/{_sid('source.pdf')}").json()
    assert info == {"name": "source.pdf", "kind": "pdf", "pageCount": 15}


def test_pdf_page_renders_and_bounds_are_enforced():
    sid = _sid("source.pdf")
    ok = client.get(f"/api/sources/{sid}/pages/1.png")
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/png"
    assert ok.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert client.get(f"/api/sources/{sid}/pages/0.png").status_code == 404
    assert client.get(f"/api/sources/{sid}/pages/16.png").status_code == 404
    assert client.get(f"/api/sources/{sid}/pages/1.png?zoom=10").status_code == 422


def test_filenames_with_spaces_and_spreadsheets():
    sid = _sid("WorldWide Rig Count Report.xlsm")
    assert client.get(f"/api/sources/{sid}").json()["kind"] == "spreadsheet"
    assert client.get(f"/api/sources/{sid}/pages/1.png").status_code == 400
    f = client.get(f"/api/sources/{sid}/file")
    assert f.status_code == 200 and "Rig%20Count%20Report.xlsm" in f.headers["content-disposition"]


def test_download_returns_the_real_file():
    sid = _sid("source.pdf")
    f = client.get(f"/api/sources/{sid}/file")
    assert f.status_code == 200 and f.headers["content-type"] == "application/pdf"
    assert f.content == (sources.PROJECT_ROOT / "Manual_data" / "source.pdf").read_bytes()


@pytest.mark.parametrize("bad", ["deadbeefdeadbeef", "..%2F..%2Fetc%2Fpasswd", "%2Fetc%2Fpasswd"])
def test_unknown_or_traversal_ids_are_404(bad):
    assert client.get(f"/api/sources/{bad}").status_code == 404
    assert client.get(f"/api/sources/{bad}/file").status_code == 404


def test_registry_entry_outside_data_dir_is_refused(monkeypatch):
    monkeypatch.setitem(sources._load_registry(), "evil", "Manual_data/../.env")
    assert sources.resolve("evil") is None
