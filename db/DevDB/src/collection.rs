/// The `Collection` is DevDB's top-level abstraction: it ties together the
/// vector store, payload store, and search index into a single coherent API.
///
/// External callers interact only with this module — they insert vectors with
/// metadata, run filtered searches, and save/load snapshots. The collection
/// manages the mapping between external point IDs (user-supplied `u64`) and
/// internal sequential indices.
use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::DevDbError;
use crate::index::hnsw::{HnswConfig, HnswIndex};
use crate::index::Index;
use crate::payload::{Filter, PayloadStore, Value};
use crate::persistence;
use crate::vector_store::VectorStore;

/// Configuration for a new collection.
#[derive(Debug, Clone)]
pub struct CollectionConfig {
    /// Vector dimensionality. All inserted vectors must match this.
    pub dim: usize,
    /// HNSW index parameters. If `None`, sensible defaults are used.
    pub hnsw: Option<HnswConfig>,
}

impl Default for CollectionConfig {
    fn default() -> Self {
        Self {
            dim: 384,
            hnsw: None,
        }
    }
}

/// The serializable internals of a collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionData {
    /// The vector store (flat contiguous f32 buffer).
    pub(crate) vectors: VectorStore,
    /// The metadata payload store.
    pub(crate) payloads: PayloadStore,
    /// The HNSW index (graph topology).
    pub(crate) index: HnswIndex,
    /// Mapping from external point ID to internal sequential index.
    pub(crate) id_to_internal: HashMap<u64, usize>,
    /// Mapping from internal index to external point ID.
    pub(crate) internal_to_id: Vec<u64>,
}

/// A read-only collection backend backed by a memory-mapped snapshot file.
pub struct MmapCollection {
    /// Owned memory-mapped file handle.
    mmap: memmap2::Mmap,
    /// Vector dimensionality.
    dim: usize,
    /// Number of nodes/vectors stored.
    pub(crate) node_count: usize,
    /// Entry point node index in the HNSW graph.
    entry_point: Option<usize>,
    /// Maximum layer index in the HNSW graph.
    max_layer: usize,
    /// Search beam size parameter.
    ef_search: std::sync::atomic::AtomicUsize,

    /// Byte offset where vectors start.
    vectors_offset: usize,
    /// Size of vectors section in bytes.
    vectors_len: usize,
    /// Byte offset where HNSW offsets start.
    hnsw_offsets_offset: usize,
    /// Size of HNSW offsets section in bytes.
    hnsw_offsets_len: usize,
    /// Byte offset where HNSW node adjacency starts.
    hnsw_nodes_offset: usize,
    /// Size of HNSW node adjacency section in bytes.
    hnsw_nodes_len: usize,

    /// In-memory deserialized metadata payloads.
    payloads: PayloadStore,
    /// In-memory deserialized mapping from external ID to internal index.
    id_to_internal: HashMap<u64, usize>,
    /// In-memory deserialized mapping from internal index to external ID.
    internal_to_id: Vec<u64>,
}

impl MmapCollection {
    /// Creates a new memory-mapped collection from a file handle.
    pub fn new(mmap: memmap2::Mmap) -> Result<Self, DevDbError> {
        if mmap.len() < 192 {
            return Err(DevDbError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "file too short for DevDB header",
            )));
        }

        let header = persistence::MmapHeader::read_from_slice(&mmap[0..192]);
        if &header.magic != b"DVDB" {
            return Err(DevDbError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "not a DevDB snapshot file (bad magic)",
            )));
        }

        if header.version != 2 {
            return Err(DevDbError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("expected snapshot version 2, got {}", header.version),
            )));
        }

        // Deserialize payloads
        let payloads_slice = &mmap[header.payloads_offset as usize
            ..header.payloads_offset as usize + header.payloads_len as usize];
        let payloads: PayloadStore = bincode::deserialize(payloads_slice)?;

        // Deserialize ID mappings
        let mappings_slice = &mmap[header.id_mappings_offset as usize
            ..header.id_mappings_offset as usize + header.id_mappings_len as usize];
        let (id_to_internal, internal_to_id): (HashMap<u64, usize>, Vec<u64>) =
            bincode::deserialize(mappings_slice)?;

        let entry_point = if header.entry_point == -1 {
            None
        } else {
            Some(header.entry_point as usize)
        };

        Ok(Self {
            mmap,
            dim: header.dim as usize,
            node_count: header.node_count as usize,
            entry_point,
            max_layer: header.max_layer as usize,
            ef_search: std::sync::atomic::AtomicUsize::new(header.ef_search as usize),

            vectors_offset: header.vectors_offset as usize,
            vectors_len: header.vectors_len as usize,
            hnsw_offsets_offset: header.hnsw_offsets_offset as usize,
            hnsw_offsets_len: header.hnsw_offsets_len as usize,
            hnsw_nodes_offset: header.hnsw_nodes_offset as usize,
            hnsw_nodes_len: header.hnsw_nodes_len as usize,

            payloads,
            id_to_internal,
            internal_to_id,
        })
    }

    /// Returns a temporary read-only view of the vector store section.
    pub fn get_vector_store(&self) -> crate::vector_store::MmapVectorStore<'_> {
        let bytes = &self.mmap[self.vectors_offset..self.vectors_offset + self.vectors_len];
        crate::vector_store::MmapVectorStore::new(self.dim, self.node_count, bytes)
    }

    /// Returns a temporary read-only view of the HNSW index graph.
    pub fn get_hnsw_index(&self) -> crate::index::hnsw::MmapHnswIndex<'_> {
        let offsets_bytes =
            &self.mmap[self.hnsw_offsets_offset..self.hnsw_offsets_offset + self.hnsw_offsets_len];
        assert_eq!(
            offsets_bytes
                .as_ptr()
                .align_offset(std::mem::align_of::<u64>()),
            0
        );
        let hnsw_offsets = unsafe {
            std::slice::from_raw_parts(offsets_bytes.as_ptr() as *const u64, self.node_count)
        };
        let hnsw_nodes =
            &self.mmap[self.hnsw_nodes_offset..self.hnsw_nodes_offset + self.hnsw_nodes_len];

        crate::index::hnsw::MmapHnswIndex::new(
            self.node_count,
            self.entry_point,
            self.max_layer,
            self.ef_search.load(std::sync::atomic::Ordering::Relaxed),
            hnsw_offsets,
            hnsw_nodes,
        )
    }

    /// Performs nearest neighbor search on the memory-mapped collection.
    pub fn search(
        &self,
        query: &[f32],
        top_k: usize,
        filter: Option<Filter>,
    ) -> Result<Vec<(u64, f32)>, DevDbError> {
        if self.node_count == 0 {
            return Err(DevDbError::EmptyCollection);
        }

        let norm = query.iter().map(|&x| x * x).sum::<f32>().sqrt();
        if norm < f32::EPSILON {
            return Err(DevDbError::ZeroVector);
        }
        if query.len() != self.dim {
            return Err(DevDbError::DimensionMismatch {
                expected: self.dim,
                got: query.len(),
            });
        }
        let inv_norm = 1.0 / norm;
        let normalized_query: Vec<f32> = query.iter().map(|&x| x * inv_norm).collect();

        let fetch_k = match &filter {
            Some(_) => top_k * 4,
            None => top_k,
        };

        let vectors = self.get_vector_store();
        let index = self.get_hnsw_index();

        let candidates = index.search(&normalized_query, fetch_k, &vectors);

        let results: Vec<(u64, f32)> = candidates
            .into_iter()
            .filter(|r| match &filter {
                None => true,
                Some(f) => self.payloads.get(r.index).is_some_and(|p| f.matches(p)),
            })
            .take(top_k)
            .map(|r| {
                let ext_id = self.internal_to_id[r.index];
                (ext_id, r.distance)
            })
            .collect();

        Ok(results)
    }

    /// Gets a stored vector by its external ID.
    pub fn get_vector(&self, id: u64) -> Result<&[f32], DevDbError> {
        let &internal = self
            .id_to_internal
            .get(&id)
            .ok_or(DevDbError::PointNotFound(id))?;
        let bytes = &self.mmap[self.vectors_offset..self.vectors_offset + self.vectors_len];
        let f32_ptr = bytes.as_ptr() as *const f32;
        let data = unsafe { std::slice::from_raw_parts(f32_ptr, self.node_count * self.dim) };
        Ok(&data[internal * self.dim..(internal + 1) * self.dim])
    }
}

enum CollectionInner {
    InMemory(CollectionData),
    Mmapped(MmapCollection),
}

/// A vector search collection with HNSW indexing and metadata filtering.
pub struct Collection {
    inner: CollectionInner,
}

impl Collection {
    /// Creates a new empty collection with the given configuration.
    pub fn new(config: CollectionConfig) -> Self {
        let hnsw_config = config.hnsw.unwrap_or_default();
        Self {
            inner: CollectionInner::InMemory(CollectionData {
                vectors: VectorStore::new(config.dim),
                payloads: PayloadStore::new(),
                index: HnswIndex::new(hnsw_config),
                id_to_internal: HashMap::new(),
                internal_to_id: Vec::new(),
            }),
        }
    }

    /// Inserts a vector with its external ID and metadata payload.
    ///
    /// The vector is normalized to unit length at insert time. The HNSW graph
    /// is updated incrementally (no full rebuild needed).
    ///
    /// # Errors
    ///
    /// - [`DevDbError::DimensionMismatch`] if the vector length doesn't match.
    /// - [`DevDbError::ZeroVector`] if the vector has zero magnitude.
    /// - [`DevDbError::ReadOnly`] if the collection is memory-mapped.
    pub fn insert(
        &mut self,
        id: u64,
        vector: &[f32],
        payload: HashMap<String, Value>,
    ) -> Result<(), DevDbError> {
        match &mut self.inner {
            CollectionInner::InMemory(data) => {
                let internal_idx = data.vectors.push(vector)?;
                data.payloads.push(payload);
                data.id_to_internal.insert(id, internal_idx);
                data.internal_to_id.push(id);

                let CollectionData {
                    ref vectors,
                    ref mut index,
                    ..
                } = *data;
                let vec_data = vectors.get(internal_idx);
                index.insert(internal_idx, vec_data, vectors);

                Ok(())
            }
            CollectionInner::Mmapped(_) => Err(DevDbError::ReadOnly),
        }
    }

    /// Searches for the `top_k` nearest vectors to `query`, optionally filtered.
    ///
    /// Returns `Vec<(external_id, score)>` sorted by ascending distance.
    /// Score is cosine distance (0 = identical, 1 = orthogonal).
    pub fn search(
        &mut self,
        query: &[f32],
        top_k: usize,
        filter: Option<Filter>,
    ) -> Result<Vec<(u64, f32)>, DevDbError> {
        match &mut self.inner {
            CollectionInner::InMemory(data) => {
                if data.vectors.is_empty() {
                    return Err(DevDbError::EmptyCollection);
                }

                let normalized_query = data.vectors.normalize_query(query)?;

                let fetch_k = match &filter {
                    Some(_) => top_k * 4,
                    None => top_k,
                };

                let CollectionData {
                    ref vectors,
                    ref mut index,
                    ref payloads,
                    ref internal_to_id,
                    ..
                } = *data;

                let candidates = index.search(&normalized_query, fetch_k, vectors);

                let results: Vec<(u64, f32)> = candidates
                    .into_iter()
                    .filter(|r| match &filter {
                        None => true,
                        Some(f) => payloads.get(r.index).is_some_and(|p| f.matches(p)),
                    })
                    .take(top_k)
                    .map(|r| {
                        let ext_id = internal_to_id[r.index];
                        (ext_id, r.distance)
                    })
                    .collect();

                Ok(results)
            }
            CollectionInner::Mmapped(mmap_col) => mmap_col.search(query, top_k, filter),
        }
    }

    /// Returns the number of vectors in the collection.
    pub fn len(&self) -> usize {
        match &self.inner {
            CollectionInner::InMemory(data) => data.vectors.len(),
            CollectionInner::Mmapped(mmap_col) => mmap_col.node_count,
        }
    }

    /// Returns `true` if the collection contains no vectors.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Returns the configured dimensionality.
    pub fn dim(&self) -> usize {
        match &self.inner {
            CollectionInner::InMemory(data) => data.vectors.dim(),
            CollectionInner::Mmapped(mmap_col) => mmap_col.dim,
        }
    }

    /// Saves the entire collection (vectors, payloads, graph) to a file.
    pub fn save(&self, path: &Path) -> Result<(), DevDbError> {
        match &self.inner {
            CollectionInner::InMemory(data) => persistence::save(path, data),
            CollectionInner::Mmapped(_) => Err(DevDbError::ReadOnly),
        }
    }

    /// Loads a collection from a previously saved snapshot.
    ///
    /// Detects file format version and automatically routes to memory-mapped
    /// zero-copy backend for version 2 snapshots, or legacy in-memory bincode
    /// backend for version 1.
    pub fn load(path: &Path) -> Result<Self, DevDbError> {
        let file = std::fs::File::open(path)?;
        let mut reader = std::io::BufReader::new(&file);

        let mut magic = [0u8; 4];
        use std::io::Read;
        reader.read_exact(&mut magic)?;
        if &magic != b"DVDB" {
            return Err(DevDbError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "not a DevDB snapshot file (bad magic)",
            )));
        }

        let mut ver_bytes = [0u8; 4];
        reader.read_exact(&mut ver_bytes)?;
        let ver = u32::from_le_bytes(ver_bytes);

        if ver == 1 {
            let data = persistence::load_legacy_v1(&mut reader)?;
            let mut col = Self {
                inner: CollectionInner::InMemory(data),
            };
            if let CollectionInner::InMemory(ref mut d) = col.inner {
                d.index.rebuild_visited_stamps();
            }
            Ok(col)
        } else if ver == 2 {
            let mmap = unsafe { memmap2::Mmap::map(&file)? };
            let mmap_col = MmapCollection::new(mmap)?;
            Ok(Self {
                inner: CollectionInner::Mmapped(mmap_col),
            })
        } else {
            Err(DevDbError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unsupported snapshot version {ver}"),
            )))
        }
    }

    /// Provides mutable access to the HNSW index for parameter tuning.
    pub fn hnsw_mut(&mut self) -> &mut HnswIndex {
        match &mut self.inner {
            CollectionInner::InMemory(data) => &mut data.index,
            CollectionInner::Mmapped(_) => {
                panic!("cannot tune HNSW config on a read-only memory-mapped collection");
            }
        }
    }

    /// Retrieves a stored vector by its external ID.
    pub fn get_vector(&self, id: u64) -> Result<&[f32], DevDbError> {
        match &self.inner {
            CollectionInner::InMemory(data) => {
                let &internal = data
                    .id_to_internal
                    .get(&id)
                    .ok_or(DevDbError::PointNotFound(id))?;
                Ok(data.vectors.get(internal))
            }
            CollectionInner::Mmapped(mmap_col) => mmap_col.get_vector(id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payload::{Condition, Value};

    fn test_collection() -> Collection {
        let mut col = Collection::new(CollectionConfig {
            dim: 3,
            hnsw: Some(HnswConfig::with_m(4)),
        });

        let mut p1 = HashMap::new();
        p1.insert("type".into(), Value::String("well_log".into()));
        p1.insert("depth".into(), Value::Number(1500.0));

        let mut p2 = HashMap::new();
        p2.insert("type".into(), Value::String("report".into()));
        p2.insert("depth".into(), Value::Number(3000.0));

        let mut p3 = HashMap::new();
        p3.insert("type".into(), Value::String("well_log".into()));
        p3.insert("depth".into(), Value::Number(2000.0));

        col.insert(100, &[1.0, 0.0, 0.0], p1).unwrap();
        col.insert(200, &[0.0, 1.0, 0.0], p2).unwrap();
        col.insert(300, &[0.0, 0.0, 1.0], p3).unwrap();

        col
    }

    #[test]
    fn insert_and_search_unfiltered() {
        let mut col = test_collection();
        let results = col.search(&[1.0, 0.0, 0.0], 1, None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, 100);
    }

    #[test]
    fn search_with_equality_filter() {
        let mut col = test_collection();
        let filter = Filter {
            conditions: vec![Condition::Equals(
                "type".into(),
                Value::String("report".into()),
            )],
        };
        let results = col.search(&[1.0, 0.0, 0.0], 3, Some(filter)).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, 200);
    }

    #[test]
    fn search_with_range_filter() {
        let mut col = test_collection();
        let filter = Filter {
            conditions: vec![Condition::Range("depth".into(), 1000.0, 2500.0)],
        };
        let results = col.search(&[1.0, 0.0, 0.0], 10, Some(filter)).unwrap();
        let ids: Vec<u64> = results.iter().map(|r| r.0).collect();
        assert!(ids.contains(&100));
        assert!(ids.contains(&300));
        assert!(!ids.contains(&200));
    }

    #[test]
    fn dimension_mismatch_on_insert() {
        let mut col = Collection::new(CollectionConfig {
            dim: 3,
            ..Default::default()
        });
        let result = col.insert(1, &[1.0, 2.0], HashMap::new());
        assert!(matches!(result, Err(DevDbError::DimensionMismatch { .. })));
    }

    #[test]
    fn empty_collection_search_error() {
        let mut col = Collection::new(CollectionConfig::default());
        let result = col.search(&[1.0; 384], 10, None);
        assert!(matches!(result, Err(DevDbError::EmptyCollection)));
    }

    #[test]
    fn get_vector_by_id() {
        let col = test_collection();
        let v = col.get_vector(100).unwrap();
        assert!((v[0] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn mmap_save_load_round_trip() {
        let col = test_collection();
        let dir = std::env::temp_dir().join("devdb_test_mmap");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test_mmap.devdb");

        col.save(&path).unwrap();
        let mut loaded = Collection::load(&path).unwrap();

        assert_eq!(loaded.len(), 3);
        assert_eq!(loaded.dim(), 3);

        let results = loaded.search(&[1.0, 0.0, 0.0], 1, None).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, 100);

        let v = loaded.get_vector(100).unwrap();
        assert!((v[0] - 1.0).abs() < 1e-6);

        // Cleanup
        std::fs::remove_dir_all(&dir).ok();
    }
}
