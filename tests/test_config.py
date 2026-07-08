# -*- coding: utf-8 -*-
"""Sanity checks that config constants and paths resolve."""

from pathlib import Path

from core import config


def test_paths_are_paths():
    assert isinstance(config.PDF_PATH, Path)
    assert config.PDF_PATH == config.MANUAL_DATA_DIR / "source.pdf"
    assert config.SNAPSHOT_PATH == config.INDEX_DIR / "devdb.snapshot"


def test_hyperparams_sane():
    assert config.MMR_K <= config.TOP_K
    assert 0.0 <= config.MMR_LAMBDA <= 1.0
    assert 0.0 <= config.MIN_SCORE <= 1.0
    assert config.CHUNK_OVERLAP < config.CHUNK_SIZE
