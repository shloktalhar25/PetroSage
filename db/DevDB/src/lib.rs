//! # DevDB — Single-node in-memory vector search engine
//!
//! DevDB is a lightweight vector database built for RAG retrieval workloads.
//! It stores dense float embeddings with metadata payloads, indexes them with
//! HNSW for ~O(log n) approximate nearest-neighbor search, and supports
//! conjunctive post-filter predicates on payload fields.
//!
//! ## Quick start
//!
//! ```rust
//! use devdb::{Collection, CollectionConfig};
//! use std::collections::HashMap;
//!
//! let mut db = Collection::new(CollectionConfig { dim: 3, ..Default::default() });
//! db.insert(1, &[1.0, 0.0, 0.0], HashMap::new()).unwrap();
//! let results = db.search(&[1.0, 0.0, 0.0], 1, None).unwrap();
//! assert_eq!(results[0].0, 1);
//! ```

#![warn(missing_docs)]

/// The top-level collection that ties together vector storage, indexing, and payloads.
pub mod collection;
/// Distance and similarity functions for vector comparison.
pub mod distance;
/// Unified error type for all DevDB operations.
pub mod error;
/// Search index implementations (brute-force and HNSW).
pub mod index;
/// Metadata storage and filter predicates.
pub mod payload;
/// Snapshot save/load for collections.
pub mod persistence;
/// Flat contiguous vector storage with normalize-on-insert.
pub mod vector_store;

// Re-export the primary public API types at crate root for ergonomic imports.
pub use collection::{Collection, CollectionConfig};
pub use error::DevDbError;
pub use index::SearchResult;
pub use payload::{Condition, Filter, Value};
