# DevDB

A single-node, in-memory vector search engine written in Rust. It stores dense float embeddings with key/value metadata, indexes them with HNSW for approximate nearest-neighbor search at ~O(log n), supports conjunctive post-filter predicates, and snapshots its full state to disk. About 2.1k lines of original code, no external ANN dependencies.

## Quickstart

```bash
make build        # cargo build
make test         # all unit + integration tests
make run          # cargo run --example oil_gas_demo
make bench        # criterion benchmarks (set DEVDB_BENCH_BIG=1 for the 100k tier)
make check        # fmt + clippy + tests, the pre-submit gate
```

Minimal use:

```rust
use devdb::{Collection, CollectionConfig};
use std::collections::HashMap;

let mut db = Collection::new(CollectionConfig { dim: 384, ..Default::default() });
db.insert(1, &embedding, HashMap::new())?;
let hits = db.search(&query, 10, None)?;     // Vec<(u64, f32)>
db.save("snapshot.devdb".as_ref())?;
```

## Headline numbers

At N=100,000 vectors, dim=128, top-10: HNSW (ef=50) returns in ~200 µs vs ~5.3 ms for brute force — a **26× speedup**, with recall tunable via `ef_search`.

See [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md) for architecture, the four efficiency techniques (flat memory, normalize-once, auto-vectorization, versioned visited-set), full benchmark tables, and limitations.
