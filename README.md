# Advanced RAG

A retrieval-augmented generation system: multi-format, multi-country data ingestion (PDF,
CSV, Excel), HNSW vector search (backed by a custom Rust engine, [DevDB](db/DevDB/)), query
expansion, MMR re-ranking, country-scoped filtering, and Groq-powered answer generation, all
wired together as small, single-responsibility layers.

**See [docs/HOW_TO_RUN.md](docs/HOW_TO_RUN.md) for the full run guide**,
[docs/REPO_STRUCTURE.md](docs/REPO_STRUCTURE.md) for a file-by-file map of the codebase, and
[docs/DB.md](docs/DB.md) / [docs/DEVDB_INTERNALS.md](docs/DEVDB_INTERNALS.md) for the vector
DB layer and how DevDB's HNSW graph works internally.

## Project structure

```
MJP/
  core/          shared config, data models (Chunk, RAGResponse), console
  data/          providers & connectors: embeddings, LLM (Groq), PDF/CSV/Excel loaders
  db/            the vector DB layer: VectorStore interface + DevDB HTTP client
    DevDB/       the custom Rust HNSW vector engine (see docs/DB.md)
  store/         "interacting with the DB": read/search service (retriever)
  repository/    "ingesting into the DB": write path (loaders, chunking, ingestion orchestration)
  rag/           RAG logic: query expansion, MMR rerank, compression, answer generation
  cli/           the interactive query CLI / REPL
  tests/         unit tests + a live DevDB conformance test
  Manual_data/   all manually acquired input data: source.pdf (tagged "India") plus
                 country folders (US, Norway, UK, ...) and root-level "Global" files
  index/         generated artifacts (DevDB snapshot, chunk records, metadata)
  docs/          REPO_STRUCTURE.md, DB.md, DEVDB_INTERNALS.md, HOW_TO_RUN.md
  frontend/      placeholder for a future UI
  IMP/           a sample terminal output from an earlier run (reference only, not code)
  ingest.py      thin entrypoint -> repository/ingest_repository.py
  query.py       thin entrypoint -> cli/query_cli.py
  inspect_data.py thin entrypoint -> cli/inspect_cli.py (browse ingested data)
```

### Dependency direction

```
cli -> rag -> store -> db (VectorStore interface) -> RustVectorStore (HTTP) -> DevDB server
        |       ^
        +--> data (embeddings, llm)
repository -> data + db(interface) + core
everything -> core (config, models, console)
```

`store/`, `rag/`, and `repository/` only ever depend on `db/base.py`'s `VectorStore`
interface — never on a specific backend. That's what makes the vector-DB engine swappable
without touching retrieval, RAG, or ingestion code.

## Country-scoped retrieval

Every ingested chunk is tagged with the country its source data came from (the top-level
folder name under `Manual_data/`, or `"Global"` for country-agnostic sources like the CMO
commodity data). Queries can be scoped with `python query.py --country Norway` or the REPL's
`/country Norway` command, and every citation in an answer includes the source file, country,
and page/row — see [docs/DB.md](docs/DB.md#country-as-a-filter) for how the filter flows
end-to-end.

## Quick start

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in GROQ_API_KEY

cd db/DevDB && make serve &     # start the vector DB server
cd ../..
python ingest.py                # ingest everything under Manual_data/
python inspect_data.py          # sanity-check what got ingested
python query.py -q "your question" --country Norway
```

Full details, including what's skipped during ingestion and every CLI/REPL option, are in
**[docs/HOW_TO_RUN.md](docs/HOW_TO_RUN.md)**.

## Tests

```bash
pytest
```

Pure-logic tests (chunking, dedup, MMR, config) always run. `tests/test_rust_store.py` runs
live against DevDB and skips automatically if the server isn't up.
