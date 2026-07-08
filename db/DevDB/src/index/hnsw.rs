/// Hierarchical Navigable Small World (HNSW) approximate nearest-neighbor index.
///
/// HNSW organizes vectors into a multi-layer proximity graph. Upper layers are
/// sparse for fast coarse navigation; layer 0 contains all nodes for fine search.
/// Query complexity is ~O(log n) vs brute-force O(n).
///
/// Key design decisions documented inline:
/// - Versioned visited-set for O(1) per-query reset (see `visited_stamps`)
/// - Geometric distribution for probabilistic layer assignment
/// - Simple closest-M neighbor selection with capacity pruning
use std::collections::BinaryHeap;

use serde::{Deserialize, Serialize};

use super::{Index, SearchResult, VectorAccessor};
use crate::distance::cosine_distance;

/// Tunable parameters controlling the recall/speed/memory trade-off.
///
/// - `m`: links per node on layers >= 1. More = better recall, more memory.
/// - `m_max0`: max links at layer 0 (usually `2*m`), denser since all nodes live here.
/// - `ef_construction`: beam width at insert time — bigger = better graph, slower builds.
/// - `ef_search`: beam width at query time — the primary recall-vs-latency knob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HnswConfig {
    /// Neighbors per node on layers >= 1.
    pub m: usize,
    /// Max neighbors at layer 0.
    pub m_max0: usize,
    /// Beam width during insertion.
    pub ef_construction: usize,
    /// Beam width during search.
    pub ef_search: usize,
    /// `1 / ln(m)` — controls layer distribution.
    ml: f64,
}

impl HnswConfig {
    /// Builds a config from `m`, deriving `m_max0` and `ml`.
    pub fn with_m(m: usize) -> Self {
        Self {
            m,
            m_max0: 2 * m,
            ef_construction: 200,
            ef_search: 50,
            ml: 1.0 / (m as f64).ln(),
        }
    }
}

impl Default for HnswConfig {
    fn default() -> Self {
        Self::with_m(16)
    }
}

/// A node in the HNSW graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Node {
    /// Internal index into the VectorStore.
    pub(crate) internal_idx: usize,
    /// `neighbors[layer]` = connected node IDs at that layer.
    pub(crate) neighbors: Vec<Vec<usize>>,
}

/// Candidate during search, ordered by distance ascending (larger distance = Greater).
#[derive(Debug, Clone, Copy)]
struct Candidate {
    distance: f32,
    node_id: usize,
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.distance == other.distance && self.node_id == other.node_id
    }
}
impl Eq for Candidate {}

impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.distance
            .partial_cmp(&other.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| self.node_id.cmp(&other.node_id))
    }
}

/// The HNSW index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HnswIndex {
    pub(crate) config: HnswConfig,
    pub(crate) nodes: Vec<Node>,
    pub(crate) entry_point: Option<usize>,
    pub(crate) max_layer: usize,

    /// Versioned visited-set: `visited_stamps[node_id]` stores the `query_counter`
    /// value of the last query/insert that visited this node.
    ///
    /// **WHY NOT A HASHSET:** A `HashSet` must be allocated and cleared every
    /// query, costing O(visited_count) per reset. The stamp vector is allocated
    /// once, grown incrementally, and "reset" by bumping a single `u64` — O(1)
    /// per query regardless of graph size. At high throughput (100k+ queries/sec)
    /// this eliminates significant allocator pressure. Memory cost: 8 bytes per
    /// node, negligible next to vector data.
    #[serde(skip)]
    visited_stamps: Vec<u64>,
    #[serde(skip)]
    query_counter: u64,

    /// xorshift64 RNG for layer assignment. Avoids a runtime `rand` dependency.
    rng_state: u64,
}

impl HnswIndex {
    /// Creates a new empty HNSW index.
    pub fn new(config: HnswConfig) -> Self {
        Self {
            config,
            nodes: Vec::new(),
            entry_point: None,
            max_layer: 0,
            visited_stamps: Vec::new(),
            query_counter: 0,
            rng_state: 0xDEAD_BEEF_CAFE_1337,
        }
    }

    /// Changes `ef_search` without rebuilding.
    pub fn set_ef_search(&mut self, ef: usize) {
        self.config.ef_search = ef;
    }

    /// Returns the current `ef_search`.
    pub fn ef_search(&self) -> usize {
        self.config.ef_search
    }

    /// Rebuilds transient visited-stamps after deserialization.
    pub fn rebuild_visited_stamps(&mut self) {
        self.visited_stamps = vec![0u64; self.nodes.len()];
        self.query_counter = 0;
    }

    /// Geometric layer assignment: most nodes -> layer 0, exponentially fewer higher.
    fn random_layer(&mut self) -> usize {
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 7;
        self.rng_state ^= self.rng_state << 17;
        let uniform = (self.rng_state as f64) / (u64::MAX as f64);
        (-uniform.max(1e-18).ln() * self.config.ml).floor() as usize
    }

    #[inline]
    fn mark_visited(&mut self, node_id: usize) {
        self.visited_stamps[node_id] = self.query_counter;
    }

    #[inline]
    fn is_visited(&self, node_id: usize) -> bool {
        self.visited_stamps[node_id] == self.query_counter
    }

    fn begin_query(&mut self) {
        self.query_counter += 1;
    }

    fn grow_visited(&mut self) {
        if self.visited_stamps.len() < self.nodes.len() {
            self.visited_stamps.resize(self.nodes.len(), 0);
        }
    }

    /// Greedy single-best descent on a layer. Returns the closest node found.
    fn greedy_search_layer(
        &self,
        query: &[f32],
        mut current: usize,
        layer: usize,
        accessor: &dyn VectorAccessor,
    ) -> usize {
        let mut best_dist =
            cosine_distance(query, accessor.get_vector(self.nodes[current].internal_idx));

        loop {
            let mut improved = false;
            for &neighbor in &self.nodes[current].neighbors[layer] {
                let d = cosine_distance(
                    query,
                    accessor.get_vector(self.nodes[neighbor].internal_idx),
                );
                if d < best_dist {
                    best_dist = d;
                    current = neighbor;
                    improved = true;
                }
            }
            if !improved {
                return current;
            }
        }
    }

    /// Beam search with width `ef` on a single layer.
    fn beam_search_layer(
        &mut self,
        query: &[f32],
        entries: &[usize],
        ef: usize,
        layer: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<Candidate> {
        self.begin_query();

        // candidates is a min-heap over distance (closest candidate popped first)
        let mut candidates: BinaryHeap<std::cmp::Reverse<Candidate>> = BinaryHeap::new();
        // results is a max-heap over distance bounded to size ef (farthest candidate popped when size > ef)
        let mut results: BinaryHeap<Candidate> = BinaryHeap::new();

        for &ep in entries {
            let dist = cosine_distance(query, accessor.get_vector(self.nodes[ep].internal_idx));
            let c = Candidate {
                distance: dist,
                node_id: ep,
            };
            candidates.push(std::cmp::Reverse(c));
            results.push(c);
            self.mark_visited(ep);
        }

        while let Some(std::cmp::Reverse(current)) = candidates.pop() {
            let farthest = results.peek().map(|f| f.distance).unwrap_or(f32::MAX);
            if current.distance > farthest {
                break;
            }

            let neighbors = self.nodes[current.node_id].neighbors[layer].clone();
            for neighbor in neighbors {
                if self.is_visited(neighbor) {
                    continue;
                }
                self.mark_visited(neighbor);

                let dist = cosine_distance(
                    query,
                    accessor.get_vector(self.nodes[neighbor].internal_idx),
                );
                let farthest = results.peek().map(|f| f.distance).unwrap_or(f32::MAX);

                if results.len() < ef || dist < farthest {
                    let c = Candidate {
                        distance: dist,
                        node_id: neighbor,
                    };
                    candidates.push(std::cmp::Reverse(c));
                    results.push(c);
                    if results.len() > ef {
                        results.pop();
                    }
                }
            }
        }

        let mut out: Vec<Candidate> = results.into_vec();
        out.sort();
        out
    }

    /// Selects up to `m` closest candidates.
    fn select_neighbors(candidates: &[Candidate], m: usize) -> Vec<usize> {
        candidates.iter().take(m).map(|c| c.node_id).collect()
    }

    /// Trims a neighbor list to `m_max`, keeping the closest.
    fn prune_neighbors(
        &self,
        node_id: usize,
        layer: usize,
        m_max: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<usize> {
        let neighbors = &self.nodes[node_id].neighbors[layer];
        if neighbors.len() <= m_max {
            return neighbors.clone();
        }

        let node_vec = accessor.get_vector(self.nodes[node_id].internal_idx);
        let mut scored: Vec<Candidate> = neighbors
            .iter()
            .map(|&n| Candidate {
                distance: cosine_distance(
                    node_vec,
                    accessor.get_vector(self.nodes[n].internal_idx),
                ),
                node_id: n,
            })
            .collect();
        scored.sort();
        scored.into_iter().take(m_max).map(|c| c.node_id).collect()
    }
}

impl Index for HnswIndex {
    fn insert(&mut self, internal_idx: usize, vector: &[f32], accessor: &dyn VectorAccessor) {
        let new_layer = self.random_layer();
        let node_id = self.nodes.len();

        self.nodes.push(Node {
            internal_idx,
            neighbors: vec![Vec::new(); new_layer + 1],
        });
        self.grow_visited();

        if node_id == 0 {
            self.entry_point = Some(0);
            self.max_layer = new_layer;
            return;
        }

        // Safe: entry_point is set when node 0 is inserted above, and we only
        // reach this branch when node_id > 0, so an entry point must exist.
        let Some(mut current_ep) = self.entry_point else {
            return;
        };

        // Phase 1: Greedy descent on layers above the new node's top layer.
        if self.max_layer > new_layer {
            for layer in (new_layer + 1..=self.max_layer).rev() {
                current_ep = self.greedy_search_layer(vector, current_ep, layer, accessor);
            }
        }

        // Phase 2: Insert at each layer from min(new_layer, max_layer) down to 0.
        let insert_top = new_layer.min(self.max_layer);
        for layer in (0..=insert_top).rev() {
            let m_max = if layer == 0 {
                self.config.m_max0
            } else {
                self.config.m
            };

            let found = self.beam_search_layer(
                vector,
                &[current_ep],
                self.config.ef_construction,
                layer,
                accessor,
            );

            let selected = Self::select_neighbors(&found, self.config.m);
            self.nodes[node_id].neighbors[layer] = selected.clone();

            // Bidirectional linking with pruning.
            for &neighbor in &selected {
                self.nodes[neighbor].neighbors[layer].push(node_id);
                if self.nodes[neighbor].neighbors[layer].len() > m_max {
                    let pruned = self.prune_neighbors(neighbor, layer, m_max, accessor);
                    self.nodes[neighbor].neighbors[layer] = pruned;
                }
            }

            if !found.is_empty() {
                current_ep = found[0].node_id;
            }
        }

        if new_layer > self.max_layer {
            self.entry_point = Some(node_id);
            self.max_layer = new_layer;
        }
    }

    fn search(
        &mut self,
        query: &[f32],
        k: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<SearchResult> {
        if self.nodes.is_empty() {
            return Vec::new();
        }
        let ep = match self.entry_point {
            Some(ep) => ep,
            None => return Vec::new(),
        };

        // Phase 1: Greedy descent from top layer to layer 1.
        let mut current_ep = ep;
        for layer in (1..=self.max_layer).rev() {
            current_ep = self.greedy_search_layer(query, current_ep, layer, accessor);
        }

        // Phase 2: Beam search on layer 0.
        let ef = self.config.ef_search.max(k);
        let candidates = self.beam_search_layer(query, &[current_ep], ef, 0, accessor);

        candidates
            .into_iter()
            .take(k)
            .map(|c| SearchResult {
                index: self.nodes[c.node_id].internal_idx,
                distance: c.distance,
            })
            .collect()
    }

    fn len(&self) -> usize {
        self.nodes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct SliceAccessor<'a>(&'a [Vec<f32>]);
    impl<'a> VectorAccessor for SliceAccessor<'a> {
        fn get_vector(&self, idx: usize) -> &[f32] {
            &self.0[idx]
        }
    }

    #[test]
    fn config_defaults() {
        let c = HnswConfig::default();
        assert_eq!(c.m, 16);
        assert_eq!(c.m_max0, 32);
        assert!(c.ml > 0.0);
    }

    #[test]
    fn random_layer_mostly_zero() {
        let mut idx = HnswIndex::new(HnswConfig::default());
        let mut counts = [0usize; 10];
        for _ in 0..10_000 {
            let l = idx.random_layer();
            if l < 10 {
                counts[l] += 1;
            }
        }
        assert!(counts[0] > 5000, "layer 0 got {}", counts[0]);
    }

    #[test]
    fn visited_set_o1_reset() {
        let mut idx = HnswIndex::new(HnswConfig::default());
        idx.visited_stamps = vec![0; 100];
        idx.query_counter = 1;
        idx.mark_visited(42);
        assert!(idx.is_visited(42));
        idx.begin_query();
        assert!(!idx.is_visited(42));
    }

    #[test]
    fn insert_single_and_search() {
        let vectors: Vec<Vec<f32>> = vec![vec![1.0, 0.0]];
        let acc = SliceAccessor(&vectors);
        let mut idx = HnswIndex::new(HnswConfig::with_m(4));
        idx.insert(0, &vectors[0], &acc);
        let results = idx.search(&[1.0, 0.0], 1, &acc);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].index, 0);
    }

    #[test]
    fn insert_multiple_finds_nearest() {
        let vectors: Vec<Vec<f32>> = vec![
            vec![1.0, 0.0],
            vec![0.0, 1.0],
            vec![
                std::f32::consts::FRAC_1_SQRT_2,
                std::f32::consts::FRAC_1_SQRT_2,
            ],
        ];
        let acc = SliceAccessor(&vectors);
        let mut idx = HnswIndex::new(HnswConfig::with_m(4));
        for (i, v) in vectors.iter().enumerate() {
            idx.insert(i, v, &acc);
        }
        let results = idx.search(&[1.0, 0.0], 1, &acc);
        assert_eq!(results[0].index, 0);
        assert!(results[0].distance < 1e-6);
    }

    #[test]
    fn agrees_with_brute_force_small_n() {
        use crate::index::brute_force::BruteForceIndex;

        let vectors: Vec<Vec<f32>> = vec![
            vec![1.0, 0.0, 0.0],
            vec![0.0, 1.0, 0.0],
            vec![0.0, 0.0, 1.0],
            vec![0.577, 0.577, 0.577],
            vec![0.707, 0.707, 0.0],
        ];
        let acc = SliceAccessor(&vectors);
        let mut bf = BruteForceIndex::new();
        let mut hnsw = HnswIndex::new(HnswConfig::with_m(4));

        for (i, v) in vectors.iter().enumerate() {
            bf.insert(i, v, &acc);
            hnsw.insert(i, v, &acc);
        }

        let query = &[0.8, 0.2, 0.0];
        let bf_results = bf.search(query, 3, &acc);
        let hnsw_results = hnsw.search(query, 3, &acc);

        assert_eq!(bf_results[0].index, hnsw_results[0].index);
    }
}

thread_local! {
    static VISITED_CACHE: std::cell::RefCell<(Vec<u64>, u64)> = const { std::cell::RefCell::new((Vec::new(), 0)) };
}

/// A read-only view of the HNSW index backed by a memory-mapped byte slice.
pub struct MmapHnswIndex<'a> {
    /// Number of nodes in the graph.
    node_count: usize,
    /// Entry point node index in the graph.
    entry_point: Option<usize>,
    /// Maximum layer index in the graph.
    max_layer: usize,
    /// Search beam size parameter.
    ef_search: usize,
    /// Array of offsets mapping node IDs to their data start within `hnsw_nodes`.
    hnsw_offsets: &'a [u64],
    /// Sequential block containing adjacency lists and metadata for all nodes.
    hnsw_nodes: &'a [u8],
}

impl<'a> MmapHnswIndex<'a> {
    /// Creates a new read-only view of the HNSW index from mapped parts.
    pub fn new(
        node_count: usize,
        entry_point: Option<usize>,
        max_layer: usize,
        ef_search: usize,
        hnsw_offsets: &'a [u64],
        hnsw_nodes: &'a [u8],
    ) -> Self {
        Self {
            node_count,
            entry_point,
            max_layer,
            ef_search,
            hnsw_offsets,
            hnsw_nodes,
        }
    }

    /// Resolves the internal index into the VectorStore for the given node ID.
    pub fn get_internal_idx(&self, node_id: usize) -> usize {
        let start = self.hnsw_offsets[node_id] as usize;
        let bytes = &self.hnsw_nodes[start..start + 8];
        u64::from_le_bytes(bytes.try_into().unwrap()) as usize
    }

    /// Retrieves the list of neighbor node IDs for the given node at the specified layer.
    pub fn get_neighbors(&self, node_id: usize, layer: usize) -> Vec<usize> {
        let start = self.hnsw_offsets[node_id] as usize;
        let num_layers =
            u32::from_le_bytes(self.hnsw_nodes[start + 8..start + 12].try_into().unwrap()) as usize;
        if layer >= num_layers {
            return Vec::new();
        }
        let mut offset = start + 12;
        for l in 0..num_layers {
            let neighbor_count =
                u32::from_le_bytes(self.hnsw_nodes[offset..offset + 4].try_into().unwrap())
                    as usize;
            if l == layer {
                let mut neighbors = Vec::with_capacity(neighbor_count);
                for i in 0..neighbor_count {
                    let n_offset = offset + 4 + i * 4;
                    let n_id = u32::from_le_bytes(
                        self.hnsw_nodes[n_offset..n_offset + 4].try_into().unwrap(),
                    ) as usize;
                    neighbors.push(n_id);
                }
                return neighbors;
            }
            offset += 4 + neighbor_count * 4;
        }
        Vec::new()
    }

    fn greedy_search_layer(
        &self,
        query: &[f32],
        mut current: usize,
        layer: usize,
        accessor: &dyn VectorAccessor,
    ) -> usize {
        let mut best_dist =
            cosine_distance(query, accessor.get_vector(self.get_internal_idx(current)));

        loop {
            let mut improved = false;
            let neighbors = self.get_neighbors(current, layer);
            for &neighbor in &neighbors {
                let d =
                    cosine_distance(query, accessor.get_vector(self.get_internal_idx(neighbor)));
                if d < best_dist {
                    best_dist = d;
                    current = neighbor;
                    improved = true;
                }
            }
            if !improved {
                return current;
            }
        }
    }

    fn beam_search_layer(
        &self,
        query: &[f32],
        entries: &[usize],
        ef: usize,
        layer: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<SearchResult> {
        VISITED_CACHE.with(|cache| {
            let mut cache_borrow = cache.borrow_mut();
            let (ref mut visited_stamps, ref mut query_counter) = *cache_borrow;

            if visited_stamps.len() < self.node_count {
                visited_stamps.resize(self.node_count, 0);
            }

            *query_counter += 1;
            let current_counter = *query_counter;

            let mut candidates: BinaryHeap<std::cmp::Reverse<Candidate>> = BinaryHeap::new();
            let mut results: BinaryHeap<Candidate> = BinaryHeap::new();

            for &ep in entries {
                let dist = cosine_distance(query, accessor.get_vector(self.get_internal_idx(ep)));
                let c = Candidate {
                    distance: dist,
                    node_id: ep,
                };
                candidates.push(std::cmp::Reverse(c));
                results.push(c);
                visited_stamps[ep] = current_counter;
            }

            while let Some(std::cmp::Reverse(current)) = candidates.pop() {
                let farthest = results.peek().map(|f| f.distance).unwrap_or(f32::MAX);
                if current.distance > farthest {
                    break;
                }

                let neighbors = self.get_neighbors(current.node_id, layer);
                for neighbor in neighbors {
                    if visited_stamps[neighbor] == current_counter {
                        continue;
                    }
                    visited_stamps[neighbor] = current_counter;

                    let dist = cosine_distance(
                        query,
                        accessor.get_vector(self.get_internal_idx(neighbor)),
                    );
                    let farthest = results.peek().map(|f| f.distance).unwrap_or(f32::MAX);

                    if results.len() < ef || dist < farthest {
                        let c = Candidate {
                            distance: dist,
                            node_id: neighbor,
                        };
                        candidates.push(std::cmp::Reverse(c));
                        results.push(c);
                        if results.len() > ef {
                            results.pop();
                        }
                    }
                }
            }

            let mut out: Vec<Candidate> = results.into_vec();
            out.sort();
            out.into_iter()
                .map(|c| SearchResult {
                    index: self.get_internal_idx(c.node_id),
                    distance: c.distance,
                })
                .collect()
        })
    }

    /// Searches the HNSW graph view for the k nearest neighbors of the query vector.
    pub fn search(
        &self,
        query: &[f32],
        k: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<SearchResult> {
        if self.node_count == 0 {
            return Vec::new();
        }
        let ep = match self.entry_point {
            Some(ep) => ep,
            None => return Vec::new(),
        };

        let mut current_ep = ep;
        for layer in (1..=self.max_layer).rev() {
            current_ep = self.greedy_search_layer(query, current_ep, layer, accessor);
        }

        let ef = self.ef_search.max(k);
        self.beam_search_layer(query, &[current_ep], ef, 0, accessor)
    }
}
