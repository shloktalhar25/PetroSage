# -*- coding: utf-8 -*-
"""Tests for data/text_loader.py."""

from data.text_loader import load_text


def test_one_block_per_long_paragraph_and_short_ones_dropped(tmp_path):
    f = tmp_path / "leads.txt"
    f.write_text(
        "TITLE\n\n"
        "[LEAD-01] " + "a" * 120 + "\n\n"
        "[LEAD-02] " + "b" * 120 + "\n",
        encoding="utf-8",
    )
    blocks = load_text(f)
    assert [b["row"] for b in blocks] == [2, 3]
    assert blocks[0]["text"].startswith("[LEAD-01]")
