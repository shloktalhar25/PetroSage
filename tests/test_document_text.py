# -*- coding: utf-8 -*-
"""Uploaded-document text extraction (PDF / DOCX / TXT) for the compliance review."""

import io
import zipfile

import fitz
import pytest

from data.document_text import DocumentError, extract_sections

BODY = "The rig will discharge produced water directly into the sea without any treatment at all."


def _pdf(pages):
    doc = fitz.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text)
    return doc.tobytes()


def _docx(paragraphs):
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w='
           '"http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
           f"{body}</w:body></w:document>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


def test_text_paragraphs_become_numbered_sections_and_headings_merge():
    out = extract_sections(f"1. WASTE PLAN\n\n{BODY}\n\nSecond paragraph that is long enough to stand on its own as a section.".encode(), "text")
    secs = out["sections"]
    assert [s["id"] for s in secs] == ["S1", "S2"]
    assert secs[0]["text"].startswith("1. WASTE PLAN\nThe rig will discharge")  # heading merged
    assert out["pageCount"] is None


def test_pdf_sections_keep_page_numbers():
    out = extract_sections(_pdf([BODY, "Page two says the operator will obtain every required clearance first."]), "pdf")
    assert out["pageCount"] == 2
    assert {s["page"] for s in out["sections"]} == {1, 2}


def test_docx_paragraphs_are_extracted():
    secs = extract_sections(_docx([BODY, "Another paragraph with enough words to be its own section here."]), "docx")["sections"]
    assert secs[0]["text"] == BODY and len(secs) == 2


@pytest.mark.parametrize("data,kind,msg", [
    (b"not a pdf at all", "pdf", "not a valid PDF"),
    (b"%PDF-1.7 garbage", "pdf", "could not be opened"),
    (b"PK\x03\x04 broken zip", "docx", "not a valid .docx"),
    (b"bin\x00ary", "text", "does not look like a text file"),
    (b"too short", "text", "No readable text"),
])
def test_bad_documents_raise_user_safe_errors(data, kind, msg):
    with pytest.raises(DocumentError, match=msg):
        extract_sections(data, kind)


def test_scanned_pdf_without_text_is_rejected_with_ocr_hint():
    blank = fitz.open(); blank.new_page()
    with pytest.raises(DocumentError, match="OCR"):
        extract_sections(blank.tobytes(), "pdf")
