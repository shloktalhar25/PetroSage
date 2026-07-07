# db/ — the vector database layer

This layer is the seam between the RAG application and whatever engine actually stores and
searches vectors. Everything above it (`store/`, `rag/`, `repository/`) talks only to the
`VectorStore` interface in [../db/base.py](../db/base.py) — never to a concrete backend.
That's what lets the backend be swapped (or reimplemented from scratch, as here) without
touching retrieval, RAG, or ingestion code.

## Layout

```
db/
  base.py         VectorStore abstract interface
  factory.py      picks the backend (get_vector_store())
  rust_store.py   RustVectorStore: HTTP client for DevDB
  DevDB/          the vector engine itself (Rust, HNSW graph index)
```

## DevDB

[../db/DevDB](../db/DevDB/) is a from-scratch, single-node, in-memory vector search engine
written in Rust (~2.1k lines, no external ANN dependencies — see
[../db/DevDB/HOW_IT_WORKS.md](../db/DevDB/HOW_IT_WORKS.md) for the full design writeup). It
stores dense float embeddings with key/value metadata payloads and indexes them with **HNSW**
(Hierarchical Navigable Small World) — a multi-layer proximity *graph* that gives ~O(log n)
approximate nearest-neighbor search instead of brute force's O(n). It also supports
conjunctive post-filter predicates on payload fields (equals / range / >= / <=) and snapshots
its full state (vectors + payloads + graph) to disk as a memory-mappable file.

DevDB is a library, not a service — so it's wrapped in a small HTTP server
([../db/DevDB/src/bin/server.rs](../db/DevDB/src/bin/server.rs), built with `--features
server`) that the Python side talks to.

### Running the server

```bash
cd db/DevDB
make serve      # cargo run --release --features server --bin devdb-server
```

Binds `0.0.0.0:8080` by default (override with `DEVDB_ADDR`). Or via Docker:
`make docker-build && make docker-up` (also starts a Qdrant instance for side-by-side
comparison benchmarks).

### HTTP API

| Method | Path          | Body                                                                    | Notes                              |
|--------|---------------|--------------------------------------------------------------------------|-------------------------------------|
| GET    | `/health`     | —                                                                        | liveness check                      |
| GET    | `/info`       | —                                                                        | `{count, dim}`                      |
| POST   | `/collection` | `{dim, m?, ef_construction?, ef_search?}`                               | (re)creates an empty collection     |
| POST   | `/points`     | `{points: [{id, vector, page?, country?}]}`                             | batch insert                        |
| POST   | `/search`     | `{vector, top_k, page_min?, page_max?, country?}`                       | optional page-range + country filter (AND'd) |
| POST   | `/save`       | `{path}`                                                                 | snapshot to disk                    |
| POST   | `/load`       | `{path}`                                                                 | load snapshot (read-only mmap)      |

### The `VectorStore` interface (base.py)

```python
class VectorStore(ABC):
    def create(self, dim: int) -> None: ...
    def insert(self, id: int, vector, record: dict) -> None: ...
    def add(self, vectors, records) -> None: ...   # default: create() + insert() loop
    def search(self, vector, k, country: str | None = None) -> list[tuple[dict, float]]: ...
    def save(self) -> None: ...
    def load(self) -> None: ...
    count: int
```

`RustVectorStore` (`../db/rust_store.py`) implements this against the HTTP API above.
Insert is a first-class operation — it's what maps 1:1 onto DevDB's own per-point `insert`,
batched client-side into `/points` calls for efficiency.

### Distance vs. similarity

DevDB normalizes every vector to unit length on insert, so cosine similarity collapses to a
plain dot product, and DevDB's `search` returns **cosine distance** = `1 - dot(a, b)`
(lower = closer). The rest of this codebase (MMR, the `MIN_SCORE` floor, dedup, the `score%`
shown in the CLI) expects **similarity**, where higher = more relevant. `RustVectorStore`
converts at the boundary: `similarity = 1.0 - distance`.

### Metadata: what lives where

DevDB payloads only support scalar values (`String | Number | Bool`), so only `page` (a
`Number`) and `country` (a `String`) are pushed into DevDB — enough to exercise its
`Range`/`>=`/`<=`/`Equals` filters. The full chunk record (id, text, page, country,
source_file, hash, row/sheet for tabular sources, ...) is kept Python-side, pickled to
`index/chunks.pkl`, and looked up by id after each DevDB search.

### Country as a filter

Every chunk is tagged with the country its source data came from (the top-level folder name
under `Manual_data/`, `"Global"` for files sitting directly under `Manual_data/` (not in a
country folder), or an explicit override to `"India"` for `Manual_data/source.pdf`).
`query.py --country Norway` (or the REPL's `/country Norway`) scopes
retrieval to just that country: the filter flows `cli → rag/pipeline.py → store/retriever.py
→ RustVectorStore.search(..., country=...) → POST /search {country: ...} →` a
`Condition::Equals("country", ...)` on the Rust side, conjunctively AND'd with any page filter.

### Tuning HNSW

Three knobs, set in [../core/config.py](../core/config.py) and passed to `POST /collection`:

- **`HNSW_M`** (default 16) — neighbors per node; higher = better recall, more memory, slower inserts.
- **`HNSW_EF_CONSTRUCTION`** (default 200) — beam width at insert time; higher = better graph, slower builds.
- **`HNSW_EF_SEARCH`** (default 100) — beam width at query time; the primary recall/latency dial.

### On-disk artifacts (in `index/`)

- `devdb.snapshot` — DevDB's own binary snapshot (vectors + payloads + HNSW graph), loaded as
  a read-only memory-mapped file.
- `chunks.pkl` — the Python-side records list (full chunk metadata, keyed by the same ids).
- `meta.json` — ingestion metadata (source PDF, chunk count, embed model, chunk size/overlap).

### Swapping backends

`db/factory.py`'s `get_vector_store()` reads `VECTOR_BACKEND` (default `"rust"`). Adding a new
backend means implementing `VectorStore` and adding a branch there — nothing else changes.
