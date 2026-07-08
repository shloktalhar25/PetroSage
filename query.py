# -*- coding: utf-8 -*-
"""
query.py - Entrypoint for the interactive RAG CLI.

    python query.py                    # interactive REPL
    python query.py -q "your question" # single-shot query

The implementation lives in cli/query_cli.py.
"""

from cli.query_cli import main

if __name__ == "__main__":
    main()
