/// Flat contiguous storage for dense floating-point vectors.
///
/// All vectors are packed into a single `Vec<f32>` instead of `Vec<Vec<f32>>`.
/// This layout keeps vectors contiguous in memory so the CPU prefetcher and L1/L2
/// caches work effectively during distance computations — instead of chasing a
/// separate heap pointer per vector, sequential scans stream straight through
/// a single allocation.
///
/// Every vector is normalized to unit length at insert time. This means cosine
/// similarity reduces to a plain dot product at query time, eliminating a
/// per-comparison sqrt and division from the hot path.
use serde::{Deserialize, Serialize};

use crate::error::DevDbError;
use crate::index::VectorAccessor;

/// Stores a collection of fixed-dimension vectors in a flat `f32` buffer.
///
/// Vector `i` of dimension `d` occupies `data[i*d .. (i+1)*d]`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorStore {
    /// The dimensionality every vector must match.
    dim: usize,
    /// Flat buffer: `data[i*dim .. (i+1)*dim]` holds vector `i`.
    pub(crate) data: Vec<f32>,
}

impl VectorStore {
    /// Creates a new empty store for vectors of the given dimensionality.
    pub fn new(dim: usize) -> Self {
        Self {
            dim,
            data: Vec::new(),
        }
    }

    /// Returns the dimensionality configured at construction time.
    pub fn dim(&self) -> usize {
        self.dim
    }

    /// Returns the number of vectors currently stored.
    pub fn len(&self) -> usize {
        self.data.len() / self.dim
    }

    /// Returns `true` if no vectors have been inserted.
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Appends a vector after normalizing it to unit length.
    ///
    /// Returns the internal index assigned to this vector (zero-based, sequential).
    ///
    /// # Errors
    ///
    /// - [`DevDbError::DimensionMismatch`] if `vector.len() != self.dim`.
    /// - [`DevDbError::ZeroVector`] if the vector has zero magnitude (cannot normalize).
    pub fn push(&mut self, vector: &[f32]) -> Result<usize, DevDbError> {
        if vector.len() != self.dim {
            return Err(DevDbError::DimensionMismatch {
                expected: self.dim,
                got: vector.len(),
            });
        }

        let norm = magnitude(vector);
        if norm < f32::EPSILON {
            return Err(DevDbError::ZeroVector);
        }

        let idx = self.len();
        // Normalize-on-insert: after this, cosine similarity between any two
        // stored vectors is just their dot product — no per-query sqrt needed.
        let inv_norm = 1.0 / norm;
        self.data.extend(vector.iter().map(|&x| x * inv_norm));
        Ok(idx)
    }

    /// Returns a borrowed slice of the normalized vector at internal index `idx`.
    ///
    /// # Panics
    ///
    /// Panics if `idx >= self.len()`. Callers inside the crate already bounds-check
    /// via the point-id mapping, so a panic here signals a logic bug, not user error.
    #[inline]
    pub fn get(&self, idx: usize) -> &[f32] {
        let start = idx * self.dim;
        &self.data[start..start + self.dim]
    }

    /// Normalizes a query vector in place, returning it as a new `Vec<f32>`.
    ///
    /// This is used to normalize incoming query vectors so dot-product comparison
    /// against the already-normalized stored vectors yields cosine similarity.
    ///
    /// # Errors
    ///
    /// - [`DevDbError::DimensionMismatch`] if `query.len() != self.dim`.
    /// - [`DevDbError::ZeroVector`] if the query has zero magnitude.
    pub fn normalize_query(&self, query: &[f32]) -> Result<Vec<f32>, DevDbError> {
        if query.len() != self.dim {
            return Err(DevDbError::DimensionMismatch {
                expected: self.dim,
                got: query.len(),
            });
        }
        let norm = magnitude(query);
        if norm < f32::EPSILON {
            return Err(DevDbError::ZeroVector);
        }
        let inv = 1.0 / norm;
        Ok(query.iter().map(|&x| x * inv).collect())
    }
}

/// Computes the L2 magnitude (Euclidean norm) of a slice.
fn magnitude(v: &[f32]) -> f32 {
    v.iter().map(|&x| x * x).sum::<f32>().sqrt()
}

/// Allows the index to look up stored vectors by internal index.
impl VectorAccessor for VectorStore {
    fn get_vector(&self, idx: usize) -> &[f32] {
        self.get(idx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_get_round_trip() {
        let mut store = VectorStore::new(3);
        let v = [3.0, 4.0, 0.0]; // magnitude = 5
        let idx = store.push(&v).unwrap();
        assert_eq!(idx, 0);

        let stored = store.get(0);
        // Should be normalized: [0.6, 0.8, 0.0]
        assert!((stored[0] - 0.6).abs() < 1e-6);
        assert!((stored[1] - 0.8).abs() < 1e-6);
        assert!((stored[2] - 0.0).abs() < 1e-6);
    }

    #[test]
    fn dimension_mismatch_is_error() {
        let mut store = VectorStore::new(3);
        let result = store.push(&[1.0, 2.0]);
        assert!(matches!(result, Err(DevDbError::DimensionMismatch { .. })));
    }

    #[test]
    fn zero_vector_is_error() {
        let mut store = VectorStore::new(2);
        let result = store.push(&[0.0, 0.0]);
        assert!(matches!(result, Err(DevDbError::ZeroVector)));
    }

    #[test]
    fn stored_vectors_are_unit_length() {
        let mut store = VectorStore::new(4);
        store.push(&[1.0, 2.0, 3.0, 4.0]).unwrap();
        let v = store.get(0);
        let mag: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((mag - 1.0).abs() < 1e-5, "magnitude was {mag}");
    }

    #[test]
    fn sequential_indices() {
        let mut store = VectorStore::new(2);
        assert_eq!(store.push(&[1.0, 0.0]).unwrap(), 0);
        assert_eq!(store.push(&[0.0, 1.0]).unwrap(), 1);
        assert_eq!(store.push(&[1.0, 1.0]).unwrap(), 2);
        assert_eq!(store.len(), 3);
    }

    #[test]
    fn normalize_query_matches_stored() {
        let mut store = VectorStore::new(3);
        store.push(&[3.0, 4.0, 0.0]).unwrap();
        let q = store.normalize_query(&[3.0, 4.0, 0.0]).unwrap();
        let stored = store.get(0);
        // Normalized query and stored vector should be identical.
        for (a, b) in q.iter().zip(stored.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }
}

/// A read-only view of a VectorStore backed by a memory-mapped byte slice.
pub struct MmapVectorStore<'a> {
    /// Dimension size of the vectors.
    dim: usize,
    /// Number of vectors stored.
    len: usize,
    /// Slice containing the raw vector coordinate f32 values.
    data: &'a [f32],
}

impl<'a> MmapVectorStore<'a> {
    /// Creates a new view, casting raw bytes to an f32 slice.
    ///
    /// # Panics
    ///
    /// Panics if the bytes are not aligned to a 4-byte boundary or the length is incorrect.
    pub fn new(dim: usize, len: usize, bytes: &'a [u8]) -> Self {
        assert_eq!(bytes.len(), len * dim * 4);
        assert_eq!(bytes.as_ptr().align_offset(std::mem::align_of::<f32>()), 0);
        let data = unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const f32, len * dim) };
        Self { dim, len, data }
    }

    /// Gets the vector at the specified index.
    pub fn get(&self, idx: usize) -> &[f32] {
        let start = idx * self.dim;
        &self.data[start..start + self.dim]
    }

    /// Returns the number of vectors stored in the view.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Returns `true` if the view contains no vectors.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl<'a> VectorAccessor for MmapVectorStore<'a> {
    fn get_vector(&self, idx: usize) -> &[f32] {
        self.get(idx)
    }
}
