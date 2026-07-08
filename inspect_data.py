# -*- coding: utf-8 -*-
"""
inspect_data.py - Browse what's been ingested into the vector DB.

    python inspect_data.py                     # summary by country/format/source
    python inspect_data.py --country Norway --sample 5
    python inspect_data.py --search "royalty"

The implementation lives in cli/inspect_cli.py. Reads index/chunks.pkl
directly - no DevDB server or embedding model needed.
"""

from cli.inspect_cli import main

if __name__ == "__main__":
    main()
