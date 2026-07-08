# How DevDB Works

## 1. What DevDB is

DevDB is a single-node, in-memory vector search engine for RAG-style retrieval. It stores dense float embeddings with key/value metadata, indexes them with HNSW for approximate nearest-neighbor search, supports conjunctive post-filter predicates on payload fields, and snapshots its full state (vectors + payloads + graph) to disk. It is **not** distributed, **not** cloud-managed, and does not expose a network API — it's a Rust library you embed in your application. Total source is ~2.1k lines including tests.

## 2. How it works

The codebase is split into small modules, each doing one thing:

- **`vector_store`** — owns a flat `Vec<f32>` buffer. Vector `i` of dimension `d` occupies `data[i*d..(i+1)*d]`. Vectors are normalized to unit length on insert.
- **`distance`** — dot product and cosine distance over `&[f32]`. Plain iterator chains, no hand-written SIMD.
- **`payload`** — a `HashMap<String, Value>` per vector, with `Filter`/`Condition` predicates (`Equals`, `Range`, `>=`, `<=`).
- **`index::brute_force`** — O(n) linear scan baseline. Serves as a correctness oracle for HNSW and as a benchmark floor.
- **`index::hnsw`** — the production index. ~510 lines including tests.
- **`collection`** — top-level facade. Maintains the `u64` external-ID ↔ internal-index mapping and orchestrates insert/search/save/load.
- **`persistence`** — bincode snapshot with a 4-byte magic header + version word.

### Why HNSW beats brute force

Brute force computes distance to every vector: O(n) per query. HNSW organizes vectors into a multi-layer proximity graph; upper layers are sparse (few nodes, long-range links for coarse navigation), and layer 0 contains every node for the final fine-grained beam search. Query cost is approximately O(log n).

The measured speedup at our test scale (128-dim, query top-10):

| N       | brute force | HNSW (ef=50) | speedup |
|---------|-------------|--------------|---------|
| 1k      | 42.8 µs     | 38.6 µs      | 1.1×    |
| 10k     | 412 µs      | 75.9 µs      | 5.4×    |
| 100k    | 5.32 ms     | 200 µs       | 26.6×   |

The gap widens with N, as expected: brute-force is linear in N, HNSW is sub-linear.

### Four efficiency techniques

**Flat contiguous memory.** All vectors live in a single `Vec<f32>` rather than `Vec<Vec<f32>>`. A linear scan walks one allocation; the prefetcher and L1/L2 caches stay warm. With `Vec<Vec<f32>>` each inner vector is a separate heap allocation, so the scan chases pointers and pays a cache miss per vector.

**Normalize once, then dot product.** Cosine similarity is `dot(a,b) / (|a| · |b|)`. If `a` and `b` are unit vectors, that collapses to `dot(a,b)`. DevDB normalizes every vector at insert time and every query at query time, then the hot loop is a plain dot product — no per-comparison sqrt or division.

**Auto-vectorization, not intrinsics.** The dot product is `a.iter().zip(b.iter()).map(|(x,y)| x*y).sum()`. With `-C opt-level=2` or higher, LLVM reliably lowers this to SSE/AVX (x86) or NEON (ARM) SIMD instructions. We deliberately avoid hand-written `std::arch` intrinsics: they're within a few percent of compiler output for this simple reduction, but require `#[cfg(target_arch)]` branching and are a maintenance burden.

**Versioned visited-set (stamp array, not HashSet).** HNSW's beam search needs to mark nodes as "already visited" within a single query. A `HashSet<usize>` works but must be allocated and cleared every query — O(visited_count) of allocator and hash work per reset. DevDB uses a `Vec<u64>` of stamps and a single `u64` counter. To "mark visited," write the current counter to `stamps[node_id]`; to "check visited," compare `stamps[node_id] == counter`; to reset for the next query, increment the counter by 1 — O(1) regardless of graph size. Memory cost is 8 bytes per node, dwarfed by the vector data itself.

## 3. HNSW parameters

Three knobs trade recall for latency and memory:

- **`m`** — neighbors per node on layers ≥1 (and `m_max0 = 2m` on layer 0). Higher `m` ⇒ denser graph ⇒ better recall, more memory, slower inserts. Default 16, which is the canonical sweet spot from the original HNSW paper.
- **`ef_construction`** — beam width during insertion. Bigger ⇒ better graph quality ⇒ better recall at query time, slower builds. Default 200.
- **`ef_search`** — beam width during query. This is the **primary recall/latency dial.** Tune this per workload — the others are usually left at defaults.

**Trading accuracy for speed: raise or lower `ef_search`.** No rebuild needed; use `Collection::hnsw_mut().set_ef_search(n)`.

Measured curve at N=10k, dim=128, k=10, m=16, ef_construction=200, 200 random queries:

| ef_search | recall@10 | avg latency (µs) | p95 latency (µs) |
|-----------|-----------|------------------|------------------|
| 10        | 0.225     | 34.8             | 51.2             |
| 25        | 0.389     | 68.5             | 85.2             |
| 50        | 0.573     | 121.7            | 143.6            |
| 100       | 0.768     | 219.9            | 244.7            |
| 200       | 0.920     | 378.3            | 405.4            |
| 400       | 0.987     | 616.6            | 635.0            |

Recall climbs roughly logarithmically; latency climbs roughly linearly. The honest read: DevDB's graph is competitive at high `ef_search` but lower-recall at small `ef_search` than a hand-tuned production HNSW (FAISS, Qdrant, hnswlib). The neighbor-selection rule is "closest M candidates" — the simplest correct choice. A heuristic selector (Malkov & Yashunin §4.1.2) that diversifies neighbors would improve recall at low `ef_search`; see *Limitations* below.

## 4. How to use it

Build the library and the demo:

```bash
make build         # debug build
make release       # optimized
make test          # cargo test
make bench         # criterion benchmarks (1k, 10k; set DEVDB_BENCH_BIG=1 for 100k)
make run           # runs examples/oil_gas_demo
make check         # fmt + clippy + tests, the pre-submit gate
```

Docker:

```bash
make docker-build
make docker-up     # starts DevDB + Qdrant via docker-compose for side-by-side runs
```

The API (full demo lives in `examples/oil_gas_demo.rs`):

```rust
use devdb::{Collection, CollectionConfig, Condition, Filter, Value};
use std::collections::HashMap;

let mut db = Collection::new(CollectionConfig { dim: 384, ..Default::default() });

let mut payload = HashMap::new();
payload.insert("type".into(), Value::String("well_log".into()));
payload.insert("year".into(), Value::Number(2024.0));
db.insert(42, &embedding, payload)?;

let filter = Filter {
    conditions: vec![
        Condition::Equals("type".into(), Value::String("well_log".into())),
        Condition::GreaterThanOrEqual("year".into(), 2023.0),
    ],
};
let results = db.search(&query, 10, Some(filter))?;  // Vec<(u64, f32)>

db.save("snapshot.devdb".as_ref())?;
let mut loaded = Collection::load("snapshot.devdb".as_ref())?;
```

Filters are conjunctive (AND). Search returns `(external_id, cosine_distance)` pairs sorted by ascending distance.

## 5. Benchmarks

### Setup

- CPU: Intel Core Ultra 7 155H (22 threads), 30 GiB RAM, Linux 7.0 kernel.
- Build: `cargo bench` (release mode, `-C opt-level=3`).
- Vectors: random `f32` in [-0.5, 0.5], then L2-normalized to unit length.
- Dim: 128. Top-k: 10.
- HNSW config: `m = 16`, `m_max0 = 32`, `ef_construction = 200`.
- Brute-force baseline uses the same `cosine_distance` function and a bounded max-heap top-k.
- For 100k, criterion sample size is capped at 10; for 1k/10k it's the default 100.

### HNSW vs brute force

| N       | brute force (median) | HNSW ef=50 (median) | speedup | BF QPS  | HNSW QPS |
|---------|----------------------|---------------------|---------|---------|----------|
| 1 000   | 42.8 µs              | 38.6 µs             | 1.1×    | 23 400  | 25 900   |
| 10 000  | 412 µs               | 75.9 µs             | 5.4×    | 2 425   | 13 180   |
| 100 000 | 5.32 ms              | 200 µs              | 26.6×   | 188     | 5 002    |

At N=1k, brute-force is already fast enough that HNSW's graph-walk overhead barely wins. From N=10k onward the asymptotic gap dominates and HNSW pulls clearly ahead.

### ef_search recall-vs-latency curve

(N=10k, dim=128, k=10, 200 random queries; recall measured against brute-force ground truth.)

| ef_search | recall@10 | avg latency (µs) | p95 latency (µs) |
|-----------|-----------|------------------|------------------|
| 10        | 0.225     | 34.8             | 51.2             |
| 25        | 0.389     | 68.5             | 85.2             |
| 50        | 0.573     | 121.7            | 143.6            |
| 100       | 0.768     | 219.9            | 244.7            |
| 200       | 0.920     | 378.3            | 405.4            |
| 400       | 0.987     | 616.6            | 635.0            |

Reproduce with `cargo run --release --example recall_curve`.

### DevDB vs Qdrant

Not run for this report. The docker-compose harness exists (`docker-compose.yml` defines both services) but a fair head-to-head requires identical vectors, identical queries, identical HNSW parameters, and warmed-up clients on both sides — and at single-node scale we'd expect comparable latencies in the same complexity class, not a DevDB win. The honest framing of DevDB's value is **"competitive single-node ANN performance in ~2.1k lines of original Rust,"** not "beats Qdrant."

## 6. Limitations & future work

- **Integrated filtered-HNSW.** Filters are post-applied today: HNSW returns `4·top_k` candidates and non-matches are dropped. With selective filters this can return fewer than `top_k` results or visit many discarded nodes. A pre-filtered traversal that consults the predicate inside the graph walk (e.g. ACORN, or Qdrant's filterable HNSW) would handle low-selectivity filters cleanly.
- **Heuristic neighbor selection.** The current selector keeps the closest `m` candidates. The Malkov & Yashunin heuristic (§4.1.2) diversifies neighbor angles and typically lifts recall at small `ef_search` by 10–20 percentage points. Straightforward to add — would directly improve the low end of the recall curve above.
- **Disk-resident index.** The entire collection lives in RAM. A memory-mapped layer-0 graph plus a vector page cache (à la DiskANN) would let DevDB index datasets that don't fit in memory, at a moderate latency cost.
- **Concurrent inserts.** Insert mutates the graph behind `&mut self`, so concurrent writers are serialized at the API boundary. Lock-free or RCU-based concurrent insertion (hnswlib's approach) is a substantial but well-understood project.
- **Deletes.** Not supported. The graph would need either tombstones with periodic compaction or HNSW-with-deletes (Filtered-DiskANN style soft deletes).
- **Quantization.** All vectors are stored as raw `f32`. Product quantization or scalar quantization would shrink the footprint 4–8× with a small recall hit.
