//! Index trait and implementations for nearest-neighbor search.
//!
//! Both brute-force and HNSW implement the [`Index`] trait. A [`VectorAccessor`]
//! trait decouples the index from vector storage, letting the collection pass
//! its `VectorStore` directly.

/// O(n) linear scan baseline index.
pub mod brute_force;
/// HNSW approximate nearest-neighbor index.
pub mod hnsw;

/// Result of a nearest-neighbor search: an internal vector index and its distance.
///
/// Ordered by distance (ascending) so sorted output gives closest match first.
/// The `Ord` implementation treats NaN as greater than all finite values.
#[derive(Debug, Clone, Copy)]
pub struct SearchResult {
    /// Internal sequential index of the vector in the store.
    pub index: usize,
    /// Distance from the query vector (lower is more similar).
    pub distance: f32,
}

impl PartialEq for SearchResult {
    fn eq(&self, other: &Self) -> bool {
        self.distance == other.distance && self.index == other.index
    }
}

impl Eq for SearchResult {}

impl PartialOrd for SearchResult {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SearchResult {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.distance
            .partial_cmp(&other.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| self.index.cmp(&other.index))
    }
}

/// Retrieves a vector by internal index. Implemented by `VectorStore` but
/// passed as a reference to decouple the index from the store.
pub trait VectorAccessor {
    /// Returns the normalized vector slice for the given internal index.
    fn get_vector(&self, idx: usize) -> &[f32];
}

/// Common interface for vector search indexes.
///
/// `insert` and `search` receive a `&dyn VectorAccessor` to look up previously
/// stored vectors. This avoids lifetime issues with closure-based approaches
/// while keeping the index decoupled from the vector store.
pub trait Index {
    /// Registers a new vector and builds any necessary graph edges.
    fn insert(&mut self, internal_idx: usize, vector: &[f32], accessor: &dyn VectorAccessor);

    /// Finds the `k` nearest vectors to `query`.
    ///
    /// Takes `&mut self` because HNSW mutates its visited-set counters during search.
    /// Brute-force doesn't need mutation but conforms to the shared trait signature.
    fn search(
        &mut self,
        query: &[f32],
        k: usize,
        accessor: &dyn VectorAccessor,
    ) -> Vec<SearchResult>;

    /// Returns the number of indexed vectors.
    fn len(&self) -> usize;

    /// Returns `true` if the index is empty.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
