# -*- coding: utf-8 -*-
"""Tests for api/adapters.py - RAG output -> frontend JSON shapes (no model/DB needed)."""

from core.models import Chunk
from api import adapters


def _chunk(cid, source, country="Norway", page=-1, row=None):
    extra = {"row": row} if row else {}
    return Chunk(id=cid, text="t", page=page, country=country, source_file=source, extra=extra)


CHUNKS = [
    _chunk(1, "Manual_data/Norway/fields.xlsx", row=4),
    _chunk(2, "Manual_data/Norway/fields.xlsx", row=9),
    _chunk(3, "Manual_data/regulations/laws.txt", page=6, country="India"),
]


def test_build_sources_groups_by_file_and_numbers_in_order():
    sources = adapters.build_sources(CHUNKS)
    assert [s["name"] for s in sources] == ["fields.xlsx", "laws.txt"]
    assert [s["id"] for s in sources] == [1, 2]
    assert sources[0]["pages"] == [4, 9] and sources[0]["unit"] == "row"
    assert sources[1]["pages"] == [6] and sources[1]["unit"] == "pg."


def test_paragraph_citations_are_stripped_and_mapped_to_source_ids():
    answer = (
        "Norway has 3 fields [fields.xlsx, Norway, Row 4].\n\n"
        "The Act applies [laws.txt, India, Page 6] and [fields.xlsx, Norway, Row 9]."
    )
    paras = adapters.to_search_response(answer, CHUNKS)["paragraphs"]
    assert paras[0] == {"text": "Norway has 3 fields.", "citeIds": [1]}
    assert paras[1]["citeIds"] == [1, 2]
    assert "[" not in paras[1]["text"]


def test_passage_style_citations_map_through_chunk_order():
    paras = adapters.to_search_response("Licensing is open [Passage 3].", CHUNKS)["paragraphs"]
    assert paras[0]["citeIds"] == [2]  # passage 3 -> laws.txt -> source id 2


def test_unrecognised_brackets_are_left_alone():
    paras = adapters.to_search_response("Value is [approx] 5.", CHUNKS)["paragraphs"]
    assert paras[0] == {"text": "Value is [approx] 5.", "citeIds": []}


def test_meta_counts_sources():
    assert adapters.to_search_response("x", CHUNKS)["meta"]["citations"] == 2


def test_refs_are_deduplicated_and_labelled():
    refs = adapters.build_refs(CHUNKS + [CHUNKS[0]])
    assert [r["loc"] for r in refs] == ["Row 4", "Row 9", "Page 6"]


def test_midstream_highlights_known_assets_and_flies_to_centroid():
    positions = {"T01": (10.0, 20.0, "Truck A"), "R01": (12.0, 24.0, "Refinery A"), "R02": (0.0, 0.0, "Refinery B")}
    resp = adapters.to_midstream_response(
        "Send T01 to R01.\n\nBoth are near Kakinada.", CHUNKS, positions
    )
    assert resp["highlight"] == ["T01", "R01"]
    assert resp["flyTo"] == {"lat": 11.0, "lng": 22.0, "zoom": 6}
    assert resp["route"] is None
    assert resp["text"] == "Send T01 to R01." and resp["detail"] == "Both are near Kakinada."


def test_midstream_without_matches_has_no_flyto():
    resp = adapters.to_midstream_response("Nothing relevant.", CHUNKS, {"T01": (1.0, 2.0, "Truck A")})
    assert resp["highlight"] == [] and resp["flyTo"] is None


def test_midstream_id_match_is_whole_word():
    resp = adapters.to_midstream_response("Refinery R010 only.", CHUNKS, {"R01": (1.0, 2.0, "Refinery A")})
    assert resp["highlight"] == []


def test_source_name_handles_windows_paths():
    src = adapters.build_sources([_chunk(1, "Manual_data\\Norway\\fields.xlsx", row=1)])
    assert src[0]["name"] == "fields.xlsx"


def test_paragraph_left_empty_after_stripping_citation_is_dropped():
    paras = adapters.to_search_response(
        "Real text.\n\n*Source: [fields.xlsx, Norway, Row 4].*", CHUNKS
    )["paragraphs"]
    assert [p["text"] for p in paras] == ["Real text."]


def test_midstream_matches_asset_by_name_despite_non_breaking_hyphen():
    resp = adapters.to_midstream_response(
        "Truck\u202fKG\u201133 is en route.", CHUNKS, {"T01": (16.5, 81.6, "Truck KG-33")}
    )
    assert resp["highlight"] == ["T01"]
    assert resp["flyTo"]["zoom"] == 9


def test_fullwidth_bracket_citations_are_stripped():
    paras = adapters.to_search_response("Fact.\u3010fields.xlsx, Norway, Row 4\u3011", CHUNKS)["paragraphs"]
    assert paras[0] == {"text": "Fact.", "citeIds": [1]}


def test_br_tags_in_table_cells_become_separators():
    paras = adapters.to_search_response("| a | b |\n|--|--|\n| x<br>y | z |", CHUNKS)["paragraphs"]
    assert "<br" not in paras[0]["text"] and "x; y" in paras[0]["text"]


def test_sources_carry_stable_id_and_cited_excerpts():
    src = adapters.build_sources(CHUNKS)[0]
    assert src["sourceId"] == adapters.source_id("Manual_data/Norway/fields.xlsx")
    assert [(e["row"], e["page"]) for e in src["excerpts"]] == [(4, None), (9, None)]
    assert src["excerpts"][0]["chunkId"] == "1" and src["excerpts"][0]["text"] == "t"


def test_answer_source_is_reported():
    assert adapters.to_search_response("x", CHUNKS)["meta"]["answerSource"] == "knowledge_base"
    assert adapters.to_search_response("x", [], "general")["meta"]["answerSource"] == "general"
    assert adapters.to_text_response("x", [], "general")["answerSource"] == "general"
    assert adapters.to_midstream_response("x", [], {}, "general")["answerSource"] == "general"
