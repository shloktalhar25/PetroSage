# Repository structure

A file-by-file map of the project. For *why* it's laid out this way (the layering rationale
and the `VectorStore` seam), see the root [README.md](../README.md). For the vector DB
internals, see [DEVDB_INTERNALS.md](DEVDB_INTERNALS.md).

```
MJP/
├── core/                     Shared foundation — every other layer depends on this, nothing else.
│   ├── config.py             Single source of truth for all paths, model names, chunking and
│   │                         retrieval hyperparameters, DevDB/HNSW knobs. Loads .env.
│   ├── models.py             Chunk and RAGResponse dataclasses used across every layer.
│   └── console.py            Shared rich Console factory (forces UTF-8 stdout).
│
├── data/                     Providers & format connectors — talk to the outside world.
│   ├── embeddings.py         Embedder singleton (sentence-transformers), batched encode with
│   │                         a progress bar for ingestion.
│   ├── llm.py                LLMProvider: thin wrapper around the Groq chat API.
│   ├── pdf_loader.py         Extracts text blocks (page + bbox) from a PDF via PyMuPDF.
│   ├── csv_loader.py         Reads a CSV, one block per row.
│   └── excel_loader.py       Reads .xlsx/.xlsm, one block per populated row per sheet
│                             (auto-detects the header row).
│
├── db/                       The vector DB layer — the swappable-backend seam.
│   ├── base.py                VectorStore abstract interface: create/insert/search/save/load.
│   ├── factory.py             get_vector_store() — picks the backend via VECTOR_BACKEND.
│   ├── rust_store.py          RustVectorStore: HTTP client implementing VectorStore against DevDB.
│   └── DevDB/                 The custom vector engine itself (Rust). See below.
│
├── store/                    "Interacting with the DB" — the read/search service.
│   └── retriever.py           Retriever: wraps VectorStore.search, builds Chunk objects,
│                              applies the MIN_SCORE floor; deduplicate() for multi-query merge.
│
├── repository/                "Ingesting into the DB" — the write path.
│   ├── chunking.py            Paragraph-aware merge/split for prose (PDF); finalize_chunks()
│   │                          assigns global ids/hashes across every source file.
│   ├── manual_data_loader.py  Walks Manual_data/, tags country by folder, applies skip rules
│   │                          (huge time-series .txt, ZIPs/, duplicate downloads), dispatches
│   │                          each file to the right data/ loader.
│   └── ingest_repository.py   Orchestrator: discover sources -> load -> chunk -> embed ->
│                              store.create()/insert()/save(). Entry point for ingest.py.
│
├── rag/                       RAG logic — the retrieval-augmented generation pipeline steps.
│   ├── expansion.py            Query expansion: HyDE hypothetical passage + multi-query.
│   ├── rerank.py                MMR (Maximal Marginal Relevance) re-ranking for diversity.
│   ├── compression.py           Optional LLM-based contextual compression of retrieved chunks.
│   ├── generation.py            Builds the context string + citations, calls the LLM for the
│   │                            final answer.
│   └── pipeline.py               RAGPipeline: wires expansion -> retrieval -> dedup -> MMR ->
│                                  (compression) -> generation into one query() call.
│
├── cli/                       Presentation layer.
│   ├── query_cli.py             Interactive REPL + single-shot CLI (query.py's implementation):
│   │                            argparse, /commands, rich-formatted answers and source tables.
│   └── inspect_cli.py            Browses ingested data straight from index/chunks.pkl (no
│                                 DevDB server or embedding model needed) - inspect_data.py's implementation.
│
├── tests/                     pytest suite.
│   ├── test_chunking.py         Paragraph merge/split, finalize_chunks id/hash assignment.
│   ├── test_dedup.py             deduplicate() keeps highest score per id.
│   ├── test_mmr.py               MMR re-ranking with a fake embedder (no model load).
│   ├── test_config.py            Sanity checks on config constants/paths.
│   ├── test_vector_store_interface.py  In-memory fake VectorStore - proves the interface
│   │                             seam works without DevDB; also the country-filter conformance test.
│   └── test_rust_store.py        Live tests against a running DevDB server (auto-skip if down).
│
├── Manual_data/                 All manually acquired input data, organized by country folder
│                                (US/, Norway/, UK/, ...); source.pdf sits at the root (tagged
│                                country "India" at ingest) alongside other root-level "Global"
│                                files (e.g. the CMO commodity spreadsheets).
├── index/                       Generated ingestion artifacts (gitignored contents, folder tracked):
│   ├── devdb.snapshot            DevDB's own binary snapshot (vectors + payloads + HNSW graph).
│   ├── chunks.pkl                 Python-side full chunk records (text, metadata), keyed by id.
│   └── meta.json                  Ingestion metadata (chunk count, embed model, chunk size...).
│
├── docs/                        This documentation.
│   ├── REPO_STRUCTURE.md          This file.
│   ├── DB.md                       The db/ layer + DevDB's HTTP API + country filtering.
│   ├── DEVDB_INTERNALS.md           How DevDB's HNSW graph actually works.
│   └── HOW_TO_RUN.md                 Full setup/ingest/query/test run guide.
│
├── frontend/                    Placeholder for a future UI (README.md only, no code yet).
├── IMP/                          Sample terminal output captured from an earlier query.py run
│                                (a demo/reference artifact, not code — see README note below).
│
├── ingest.py                     Thin entrypoint -> repository/ingest_repository.py:main()
├── query.py                       Thin entrypoint -> cli/query_cli.py:main()
├── inspect_data.py                 Thin entrypoint -> cli/inspect_cli.py:main()
├── requirements.txt                  Python dependencies.
├── .env.example                      Template for the .env file (copy to .env, fill in secrets).
└── README.md                         Project overview, quick start, links into docs/.
```

## `db/DevDB/` (the Rust engine)

```
db/DevDB/
├── src/
│   ├── lib.rs                 Public API re-exports: Collection, CollectionConfig, DevDbError, ...
│   ├── collection.rs           Collection facade: insert/search/save/load, id mapping.
│   ├── vector_store.rs          Flat f32 vector storage, normalize-on-insert.
│   ├── distance.rs               dot_product / cosine_distance.
│   ├── payload.rs                  Value, Condition, Filter (metadata + conjunctive filtering).
│   ├── persistence.rs               Bincode snapshot format (v1 legacy, v2 mmap).
│   ├── index/
│   │   ├── mod.rs                   Index trait, SearchResult.
│   │   ├── hnsw.rs                    The production HNSW index.
│   │   └── brute_force.rs              O(n) baseline / correctness oracle.
│   └── bin/
│       └── server.rs                  HTTP server (feature-gated: `--features server`) that
│                                       this project's Python `db/rust_store.py` talks to.
├── examples/                    oil_gas_demo.rs, recall_curve.rs (`cargo run --example ...`).
├── benches/search.rs             Criterion benchmarks (`cargo bench`).
├── tests/integration.rs          Rust-side integration tests.
├── Cargo.toml / Cargo.lock         Crate manifest (the `server` feature adds tiny_http + serde_json).
├── Dockerfile / docker-compose.yml   Container build for devdb-server (+ Qdrant for comparison).
├── Makefile                         build / test / bench / run / serve / docker-* / check targets.
├── README.md                         DevDB's own project readme (quickstart, headline numbers).
└── HOW_IT_WORKS.md                    DevDB's own detailed design writeup (source for
                                        docs/DEVDB_INTERNALS.md, with full benchmark tables).
```

## Dependency direction

```
cli -> rag -> store -> db (VectorStore interface) -> RustVectorStore (HTTP) -> DevDB server
        |       ^
        +--> data (embeddings, llm)
repository -> data + db(interface) + core
everything -> core (config, models, console)
```

`store/`, `rag/`, and `repository/` only ever import `db.base.VectorStore` — never a concrete
backend — so the vector engine is swappable without touching retrieval, RAG, or ingestion code.
