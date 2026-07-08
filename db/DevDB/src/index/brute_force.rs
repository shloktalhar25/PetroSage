/// Brute-force (flat scan) nearest-neighbor search.
///
/// Computes distance from the query to every stored vector. Serves as:
/// 1. **Correctness oracle** — HNSW results are validated against this.
/// 2. **Benchmark baseline** — O(n) per query makes HNSW's ~O(log n) shine.
///
/// Uses a bounded max-heap for O(n log k) top-k without sorting the full set.
use std::collections::BinaryHeap;

use serde::{Deserialize, Serialize};

use super::{Index, SearchResult, VectorAccessor};
use crate::distance::cosine_distance;

/// Brute-force index that tracks all inserted internal indices.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BruteForceIndex {
    indices: Vec<usize>,
}

impl BruteForceIndex {
    /// Creates a new empty brute-force index.
    pub fn new() -> Self {
        Self {
            indices: Vec::new(),
        }
    }
}

impl Default for BruteForceIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl Index for BruteForceIndex {
    fn insert(&mut self, internal_idx: usize, _vector: &[f32], _accessor: &dyn VectorAccessor) {
        self.indices.push(internal_idx);
    }

    fn search(
        &mut self,
        query: &[f32],
        k: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<SearchResult> {
        // SearchResult Ord treats larger distance as Greater.
        // BinaryHeap is a max-heap, so heap.peek() returns the candidate with largest distance.
        let mut heap: BinaryHeap<SearchResult> = BinaryHeap::with_capacity(k + 1);

        for &idx in &self.indices {
            let dist = cosine_distance(query, accessor.get_vector(idx));
            let entry = SearchResult {
                index: idx,
                distance: dist,
            };

            if heap.len() < k {
                heap.push(entry);
            } else if let Some(worst) = heap.peek() {
                if dist < worst.distance {
                    heap.pop();
                    heap.push(entry);
                }
            }
        }

        let mut results: Vec<SearchResult> = heap.into_vec();
        results.sort();
        results
    }

    fn len(&self) -> usize {
        self.indices.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Simple accessor backed by a Vec<Vec<f32>> for unit tests.
    struct SliceAccessor<'a>(&'a [Vec<f32>]);

    impl<'a> VectorAccessor for SliceAccessor<'a> {
        fn get_vector(&self, idx: usize) -> &[f32] {
            &self.0[idx]
        }
    }

    fn small_dataset() -> (Vec<Vec<f32>>, BruteForceIndex) {
        let vectors: Vec<Vec<f32>> = vec![
            vec![1.0, 0.0],
            vec![0.0, 1.0],
            vec![
                std::f32::consts::FRAC_1_SQRT_2,
                std::f32::consts::FRAC_1_SQRT_2,
            ],
        ];
        let acc = SliceAccessor(&vectors);
        let mut idx = BruteForceIndex::new();
        for (i, v) in vectors.iter().enumerate() {
            idx.insert(i, v, &acc);
        }
        (vectors, idx)
    }

    #[test]
    fn finds_exact_match() {
        let (vectors, mut idx) = small_dataset();
        let acc = SliceAccessor(&vectors);
        let results = idx.search(&[1.0, 0.0], 1, &acc);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].index, 0);
        assert!(results[0].distance < 1e-6);
    }

    #[test]
    fn returns_correct_top_k_order() {
        let (vectors, mut idx) = small_dataset();
        let acc = SliceAccessor(&vectors);
        let results = idx.search(&[1.0, 0.0], 3, &acc);
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].index, 0);
        assert_eq!(results[1].index, 2);
        assert_eq!(results[2].index, 1);
    }

    #[test]
    fn k_larger_than_dataset() {
        let (vectors, mut idx) = small_dataset();
        let acc = SliceAccessor(&vectors);
        let results = idx.search(&[1.0, 0.0], 10, &acc);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn empty_index_returns_empty() {
        let mut idx = BruteForceIndex::new();
        let vecs: Vec<Vec<f32>> = vec![];
        let acc = SliceAccessor(&vecs);
        let results = idx.search(&[1.0, 0.0], 5, &acc);
        assert!(results.is_empty());
    }
}
