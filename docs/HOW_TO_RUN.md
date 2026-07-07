# How to run this project

Complete run guide: environment setup, starting the vector DB, ingesting data, and querying.

## 1. Set up the Python environment

```bash
python -m venv venv
source venv/bin/activate       # or venv/bin/activate on some shells
pip install -r requirements.txt
```

Copy the env template and fill in your Groq API key:

```bash
cp .env.example .env
```

```
GROQ_API_KEY=your-key-here
```

`.env.example` also documents the optional `VECTOR_BACKEND` / `DEVDB_URL` overrides (defaults
are fine for a local single-machine setup).

## 2. Start the DevDB server

DevDB (the custom Rust HNSW vector engine — see [DB.md](DB.md) for the API and
[DEVDB_INTERNALS.md](DEVDB_INTERNALS.md) for how the graph itself works) runs as a small HTTP
server that the Python app talks to. It must be running before you ingest or query.

```bash
cd db/DevDB
make serve      # cargo run --release --features server --bin devdb-server
```

This binds `http://localhost:8080` by default. Leave it running in this terminal (or run it
in the background / via `make docker-build && make docker-up`).

Verify it's up:

```bash
curl http://localhost:8080/health   # -> ok
```

## 3. Ingest data

From the repo root (in a second terminal, with the venv activated):

```bash
python ingest.py
```

This is a **full-corpus rebuild** every time you run it: it walks everything under
`Manual_data/` — country folders (`US/`, `Norway/`, `UK/`, ...) tagged by folder name,
root-level files tagged `Global` (e.g. the CMO commodity data), and `Manual_data/source.pdf`
specifically overridden to country `India` — loads each file with the right format loader
(PDF, CSV, or Excel), chunks it, embeds every chunk, and writes a fresh DevDB collection to
`index/devdb.snapshot` (plus `index/chunks.pkl` and `index/meta.json`). The ingestion summary
prints total chunk counts broken down by country and by format.

Notes on what's skipped:
- The 5 large EIA time-series `.txt` files under `Manual_data/US/` (each 24-345MB of
  JSON-lines time series) — out of scope for this ingestion pass, see [DB.md](DB.md).
- `Manual_data/US/ZIPs/` — duplicate archives of data already ingested from plain files.
- Duplicate downloads (e.g. `"file (1).pdf"` when `"file.pdf"` already exists).

## 4. Inspect what got ingested

Before (or instead of) querying, you can browse what actually landed in the index. This reads
`index/chunks.pkl` directly, so it works even with the DevDB server stopped and doesn't need
the embedding model loaded:

```bash
python inspect_data.py                            # summary: counts by country / format / source file
python inspect_data.py --country Norway            # summary scoped to one country
python inspect_data.py --country Norway --sample 5 # + 5 sample chunks from Norway
python inspect_data.py --source fields.xlsx        # scope to one source file (substring match)
python inspect_data.py --search "royalty"          # substring search over chunk text, with samples
```

This is the fastest way to sanity-check an ingestion run — confirm a country or file actually
produced chunks, see what the row/page text looks like after chunking, or spot-check that a
keyword you expect is actually present before debugging a query that returns nothing.

## 5. Query

```bash
python query.py                                  # interactive REPL
python query.py -q "your question"               # single-shot
python query.py -q "..." --country Norway         # scope retrieval to one country
python query.py --compress                        # enable contextual compression
python query.py --verbose                         # show expanded queries
```

In the REPL:

- `/country Norway` — scope subsequent questions to Norway; `/country` (no argument) clears it.
- `/sources` — show the full retrieved passages for the last answer (source file, country,
  page/row, score).
- `/compress`, `/verbose`, `/clear`, `/help`, `/quit` — see `/help` for the full list.

Answers cite `[source_file, Country, Page/Row N]` for every fact, since with many source
documents a bare page number is ambiguous.

## 6. Run the tests

```bash
pytest
```

Pure-logic tests (chunking, dedup, MMR, config) always run. `tests/test_rust_store.py` runs
live against the DevDB server and skips automatically if it isn't reachable.

Rust-side tests (the DevDB library itself):

```bash
cd db/DevDB
cargo test
```
