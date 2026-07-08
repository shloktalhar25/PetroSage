/// Unified error type for all DevDB operations.
///
/// Every fallible library function returns `Result<T, DevDbError>` so callers get
/// structured, matchable errors instead of panics. The `#[from]` attributes allow
/// `?` propagation from IO and serialization layers without manual mapping.
use thiserror::Error;

/// Enumerates everything that can go wrong inside DevDB.
#[derive(Debug, Error)]
pub enum DevDbError {
    /// The vector supplied to insert or search has the wrong number of elements
    /// for this collection's configured dimensionality.
    #[error("dimension mismatch: expected {expected}, got {got}")]
    DimensionMismatch {
        /// The dimensionality the collection was created with.
        expected: usize,
        /// The dimensionality of the vector that was passed in.
        got: usize,
    },

    /// A lookup by point ID found no matching entry.
    #[error("point id {0} not found")]
    PointNotFound(u64),

    /// An IO error during snapshot save or load.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    /// A serialization or deserialization error from the persistence layer.
    #[error("serialization error: {0}")]
    Serialization(#[from] bincode::Error),

    /// The collection is empty; search has no vectors to compare against.
    #[error("collection is empty — nothing to search")]
    EmptyCollection,

    /// A zero-magnitude vector cannot be normalized for cosine similarity.
    #[error("zero-magnitude vector cannot be normalized")]
    ZeroVector,

    /// The collection is read-only (memory-mapped) and does not support mutations.
    #[error("collection is read-only (memory-mapped)")]
    ReadOnly,
}
