# How DevDB works internally

[docs/DB.md](DB.md) covers the `db/` layer and how the Python app talks to DevDB over HTTP.
This document goes one level deeper: how DevDB itself — the custom Rust vector engine at
[db/DevDB/](../db/DevDB/) — stores vectors and finds nearest neighbors. If you just want to
run the project, see [HOW_TO_RUN.md](HOW_TO_RUN.md) instead.

## 1. What DevDB is

DevDB is a single-node, in-memory vector search engine, purpose-built for RAG-style
retrieval. It stores dense float embeddings with key/value metadata payloads, indexes them
with **HNSW** for approximate nearest-neighbor search, supports conjunctive post-filter
predicates on payload fields, and snapshots its full state (vectors + payloads + graph) to
disk. It is a Rust *library* — not a distributed system, not cloud-managed, and it doesn't
expose a network API on its own (that's what [server.rs](../db/DevDB/src/bin/server.rs)
wraps it in). Total source is ~2.1k lines including tests.

## 2. Module map

| Module | Role |
|---|---|
| [vector_store.rs](../db/DevDB/src/vector_store.rs) | Owns a flat `Vec<f32>` buffer. Vector `i` of dimension `d` occupies `data[i*d..(i+1)*d]`. Vectors are normalized to unit length on insert. |
| [distance.rs](../db/DevDB/src/distance.rs) | Dot product and cosine distance over `&[f32]`. Plain iterator chains, no hand-written SIMD. |
| [payload.rs](../db/DevDB/src/payload.rs) | A `HashMap<String, Value>` per vector, with `Filter`/`Condition` predicates (`Equals`, `Range`, `>=`, `<=`). |
| [index/brute_force.rs](../db/DevDB/src/index/brute_force.rs) | O(n) linear scan baseline. Correctness oracle for HNSW and a benchmark floor. |
| [index/hnsw.rs](../db/DevDB/src/index/hnsw.rs) | The production index (~510 lines including tests). |
| [collection.rs](../db/DevDB/src/collection.rs) | Top-level facade. Maintains the `u64` external-ID ↔ internal-index mapping and orchestrates insert/search/save/load. |
| [persistence.rs](../db/DevDB/src/persistence.rs) | Bincode snapshot with a 4-byte magic header + version word; v2 snapshots are memory-mappable. |
| [bin/server.rs](../db/DevDB/src/bin/server.rs) | The HTTP wrapper this project's Python side talks to (not part of the core library). |

## 3. Why HNSW beats brute force

Brute force computes the distance from the query to *every* stored vector: O(n) per query.
HNSW (Hierarchical Navigable Small World) instead organizes vectors into a multi-layer
proximity **graph**:

- Upper layers are sparse — few nodes, long-range links — for fast coarse navigation across
  the whole dataset.
- Layer 0 contains *every* node, for the final fine-grained search.

A query starts at an entry point in the top layer, greedily walks toward the query vector,
drops down a layer once no closer neighbor is found, and repeats until layer 0, where a wider
beam search (`ef_search` candidates) produces the final top-k. Query cost is roughly
**O(log n)** instead of O(n) — the gap widens as the collection grows:

| N       | brute force (median) | HNSW ef=50 (median) | speedup |
|---------|-----------------------|----------------------|---------|
| 1,000   | 42.8 µs               | 38.6 µs              | 1.1×    |
| 10,000  | 412 µs                | 75.9 µs              | 5.4×    |
| 100,000 | 5.32 ms               | 200 µs               | 26.6×   |

*(128-dim vectors, top-10, `m=16`, `ef_construction=200`. Reproduce with `cargo bench` in
`db/DevDB/`.)*

## 4. Insert algorithm (building the graph)

Each new vector picks a random top layer via a geometric distribution (`1/ln(m)` controls the
skew — most nodes only exist at layer 0, a few reach higher layers, mirroring a skip list).
Starting from the current entry point, the insert walks down from the top layer, and at each
layer from the vector's assigned top layer downward:

1. Runs a beam search (width `ef_construction`) from the current layer's frontier to find the
   `ef_construction` closest existing nodes.
2. Selects up to `m` of them (`m_max0 = 2m` at layer 0, since every node lives there and it
   benefits from a denser graph) as this node's neighbors — DevDB's selector keeps the
   simplest correct choice, the closest `m` candidates (see *Limitations* below).
3. Adds bidirectional edges, pruning any neighbor whose edge list now exceeds its layer's
   cap.

If the new node's top layer exceeds the graph's current max layer, it becomes the new entry
point.

## 5. Search algorithm (querying the graph)

1. Normalize the query vector to unit length (so cosine similarity becomes a plain dot
   product — see §6).
2. Start at the entry point, at the top layer. At each layer above 0, do a **greedy**
   single-path descent: move to the neighbor closest to the query if it's closer than the
   current node, otherwise drop to the next layer down.
3. At layer 0, run a **beam search** of width `ef_search` (the primary recall/latency knob):
   maintain a candidate frontier and a result set, repeatedly expanding the closest
   unvisited candidate's neighbors, until no candidate in the frontier could improve the
   current top-k.
4. Return the `k` closest nodes found, by cosine distance.

If a metadata filter was requested, DevDB currently **over-fetches**: it asks the graph for
`4 * top_k` candidates, then drops any whose payload doesn't match the filter, then truncates
to `top_k`. This is why the country/page filters in this project's `/search` endpoint can
occasionally return slightly fewer than `top_k` results for very selective filters — see
*Limitations*.

## 6. Four efficiency techniques

**Flat contiguous memory.** All vectors live in one `Vec<f32>`, not `Vec<Vec<f32>>`. A linear
scan (or the beam search's per-candidate distance calls) walks one allocation, keeping the
prefetcher and L1/L2 caches warm. `Vec<Vec<f32>>` would put each vector in a separate heap
allocation, turning every comparison into a pointer chase and a likely cache miss.

**Normalize once, then dot product.** Cosine similarity is `dot(a,b) / (|a|·|b|)`. If `a` and
`b` are both unit vectors, that collapses to plain `dot(a,b)`. DevDB normalizes every vector
at insert time and every query at query time, so the hot loop in `distance.rs` is a bare dot
product — no per-comparison sqrt or division.

**Auto-vectorization over hand-written SIMD.** The dot product is
`a.iter().zip(b.iter()).map(|(x,y)| x*y).sum()`. At `-C opt-level=2` or higher, LLVM reliably
lowers this to SSE/AVX (x86) or NEON (ARM) instructions. DevDB deliberately skips hand-written
`std::arch` intrinsics: they're within a few percent of compiler output for this simple
reduction, but need `#[cfg(target_arch)]` branching and are a maintenance burden
disproportionate to the gain.

**Versioned visited-set (stamp array, not `HashSet`).** The beam search needs to mark nodes
"already visited" within one query. A `HashSet<usize>` needs allocation and clearing every
query. DevDB instead keeps a `Vec<u64>` of stamps plus one `u64` counter: "mark visited" writes
the current counter into `stamps[node_id]`; "check visited" compares `stamps[node_id] ==
counter`; "reset for next query" just increments the counter. All O(1), regardless of graph
size — 8 bytes/node, dwarfed by the vector data itself.

## 7. Tunable parameters

| Param | Default | Effect |
|---|---|---|
| `m` | 16 | Neighbors per node on layers ≥ 1 (`m_max0 = 2m` at layer 0). Higher ⇒ better recall, more memory, slower inserts. 16 is the canonical sweet spot from the original HNSW paper. |
| `ef_construction` | 200 | Beam width at insert time. Bigger ⇒ better graph quality ⇒ better recall later, slower builds. |
| `ef_search` | 100 in this project (configurable) | Beam width at query time — **the** recall/latency dial. Raise it for better recall, lower it for speed. No rebuild needed: `Collection::hnsw_mut().set_ef_search(n)`. |

Measured recall/latency curve (N=10k, dim=128, k=10, `m=16`, `ef_construction=200`):

| ef_search | recall@10 | avg latency (µs) |
|-----------|-----------|-------------------|
| 10        | 0.225     | 34.8              |
| 50        | 0.573     | 121.7             |
| 100       | 0.768     | 219.9             |
| 200       | 0.920     | 378.3             |
| 400       | 0.987     | 616.6             |

This project sets `HNSW_M`, `HNSW_EF_CONSTRUCTION`, `HNSW_EF_SEARCH` in
[core/config.py](../core/config.py) and passes them to `POST /collection` at ingest time.

## 8. Persistence & the mmap constraint

`Collection::save()` writes a bincode snapshot — vectors, payloads, and the full HNSW graph —
behind a `DVDB` magic header. Version-2 snapshots are loaded via `memmap2::Mmap`: the OS maps
the file directly into the process's address space with zero deserialization cost, which is
why loading a saved index is instant even for large collections.

**The trade-off:** a memory-mapped collection is read-only. `Collection::insert()` returns
`DevDbError::ReadOnly` on anything loaded from a snapshot. This is why this project's
ingestion ([repository/ingest_repository.py](../repository/ingest_repository.py)) is a
**full-corpus rebuild** every run rather than an incremental upsert — see
[docs/DB.md](DB.md#country-as-a-filter) and *Limitations* below.

## 9. Limitations (by design, not oversight)

These are documented in [db/DevDB/HOW_IT_WORKS.md](../db/DevDB/HOW_IT_WORKS.md) §6 and worth
knowing if you extend DevDB:

- **Filters are post-applied, not integrated into the graph walk.** Selective filters can
  return fewer than `top_k` results. A pre-filtered traversal (à la ACORN or Qdrant's
  filterable HNSW) would fix this but is substantially more engineering.
- **Simplest-correct neighbor selection.** The insert algorithm keeps the closest `m`
  candidates rather than the angle-diversifying heuristic from the original HNSW paper
  (Malkov & Yashunin §4.1.2), which would improve recall at low `ef_search` by ~10-20 points.
- **No disk-resident index.** The whole collection must fit in RAM (though the mmap load is
  effectively free once it's on disk).
- **No concurrent inserts.** `insert()` takes `&mut self`, so writers are serialized at the
  API boundary — fine for this project's ingest-then-query usage pattern.
- **No deletes.** Would need tombstones + compaction, or a soft-delete scheme.
- **No quantization.** Vectors are raw `f32`; product/scalar quantization would shrink memory
  4-8× at a small recall cost.

## 10. Further reading

[db/DevDB/HOW_IT_WORKS.md](../db/DevDB/HOW_IT_WORKS.md) is the engine's own design writeup —
full benchmark methodology, DevDB-vs-Qdrant framing, and more. `db/DevDB/examples/` has a
runnable demo (`cargo run --example oil_gas_demo`) and a recall-curve reproduction
(`cargo run --release --example recall_curve`).
