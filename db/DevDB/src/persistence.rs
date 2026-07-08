/// Snapshot persistence for DevDB collections.
///
/// Version 2 format stores vectors and HNSW graph topology in a contiguous binary
/// layout with strict alignments to allow direct zero-copy memory-mapping.
/// Metadata payloads and ID maps are serialized with bincode and appended.
use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;

use crate::collection::CollectionData;
use crate::error::DevDbError;

/// Four-byte magic number identifying a DevDB snapshot file.
pub const MAGIC: &[u8; 4] = b"DVDB";

/// Layout structure for the binary file header.
#[derive(Debug, Clone, Copy)]
pub struct MmapHeader {
    /// Magic bytes for format validation (must be b"DVDB").
    pub magic: [u8; 4],
    /// Format version number (currently 2).
    pub version: u32,
    /// Dimensionality of the vectors in this collection.
    pub dim: u64,
    /// Number of nodes/vectors stored in the collection.
    pub node_count: u64,
    /// The entry point node ID in the HNSW graph (-1 if none).
    pub entry_point: i64,
    /// The maximum layer index in the HNSW graph.
    pub max_layer: u64,
    /// HNSW graph construction parameter M.
    pub m: u64,
    /// HNSW graph construction parameter M_max0.
    pub m_max0: u64,
    /// HNSW graph construction parameter ef_construction.
    pub ef_construction: u64,
    /// HNSW graph search parameter ef_search.
    pub ef_search: u64,

    /// Byte offset where the raw vector coordinate f32 array starts.
    pub vectors_offset: u64,
    /// Size in bytes of the raw vector coordinate f32 array.
    pub vectors_len: u64,

    /// Byte offset where the array of offsets to individual node data starts.
    pub hnsw_offsets_offset: u64,
    /// Size in bytes of the HNSW offsets array.
    pub hnsw_offsets_len: u64,
    /// Byte offset where the sequential node adjacency data block starts.
    pub hnsw_nodes_offset: u64,
    /// Size in bytes of the HNSW node adjacency data block.
    pub hnsw_nodes_len: u64,

    /// Byte offset where the bincode-serialized PayloadStore starts.
    pub payloads_offset: u64,
    /// Size in bytes of the bincode-serialized PayloadStore.
    pub payloads_len: u64,

    /// Byte offset where the bincode-serialized ID mapping tables start.
    pub id_mappings_offset: u64,
    /// Size in bytes of the bincode-serialized ID mapping tables.
    pub id_mappings_len: u64,
}

impl MmapHeader {
    /// Writes the header fields into a target byte slice using Little Endian byte order.
    pub fn write_to_slice(&self, slice: &mut [u8]) {
        slice[0..4].copy_from_slice(&self.magic);
        slice[4..8].copy_from_slice(&self.version.to_le_bytes());
        slice[8..16].copy_from_slice(&self.dim.to_le_bytes());
        slice[16..24].copy_from_slice(&self.node_count.to_le_bytes());
        slice[24..32].copy_from_slice(&self.entry_point.to_le_bytes());
        slice[32..40].copy_from_slice(&self.max_layer.to_le_bytes());
        slice[40..48].copy_from_slice(&self.m.to_le_bytes());
        slice[48..56].copy_from_slice(&self.m_max0.to_le_bytes());
        slice[56..64].copy_from_slice(&self.ef_construction.to_le_bytes());
        slice[64..72].copy_from_slice(&self.ef_search.to_le_bytes());

        slice[72..80].copy_from_slice(&self.vectors_offset.to_le_bytes());
        slice[80..88].copy_from_slice(&self.vectors_len.to_le_bytes());

        slice[88..96].copy_from_slice(&self.hnsw_offsets_offset.to_le_bytes());
        slice[96..104].copy_from_slice(&self.hnsw_offsets_len.to_le_bytes());
        slice[104..112].copy_from_slice(&self.hnsw_nodes_offset.to_le_bytes());
        slice[112..120].copy_from_slice(&self.hnsw_nodes_len.to_le_bytes());

        slice[120..128].copy_from_slice(&self.payloads_offset.to_le_bytes());
        slice[128..136].copy_from_slice(&self.payloads_len.to_le_bytes());

        slice[136..144].copy_from_slice(&self.id_mappings_offset.to_le_bytes());
        slice[144..152].copy_from_slice(&self.id_mappings_len.to_le_bytes());
    }

    /// Reads header fields from a byte slice using Little Endian byte order.
    pub fn read_from_slice(slice: &[u8]) -> Self {
        let mut magic = [0u8; 4];
        magic.copy_from_slice(&slice[0..4]);

        Self {
            magic,
            version: u32::from_le_bytes(slice[4..8].try_into().unwrap()),
            dim: u64::from_le_bytes(slice[8..16].try_into().unwrap()),
            node_count: u64::from_le_bytes(slice[16..24].try_into().unwrap()),
            entry_point: i64::from_le_bytes(slice[24..32].try_into().unwrap()),
            max_layer: u64::from_le_bytes(slice[32..40].try_into().unwrap()),
            m: u64::from_le_bytes(slice[40..48].try_into().unwrap()),
            m_max0: u64::from_le_bytes(slice[48..56].try_into().unwrap()),
            ef_construction: u64::from_le_bytes(slice[56..64].try_into().unwrap()),
            ef_search: u64::from_le_bytes(slice[64..72].try_into().unwrap()),

            vectors_offset: u64::from_le_bytes(slice[72..80].try_into().unwrap()),
            vectors_len: u64::from_le_bytes(slice[80..88].try_into().unwrap()),

            hnsw_offsets_offset: u64::from_le_bytes(slice[88..96].try_into().unwrap()),
            hnsw_offsets_len: u64::from_le_bytes(slice[96..104].try_into().unwrap()),
            hnsw_nodes_offset: u64::from_le_bytes(slice[104..112].try_into().unwrap()),
            hnsw_nodes_len: u64::from_le_bytes(slice[112..120].try_into().unwrap()),

            payloads_offset: u64::from_le_bytes(slice[120..128].try_into().unwrap()),
            payloads_len: u64::from_le_bytes(slice[128..136].try_into().unwrap()),

            id_mappings_offset: u64::from_le_bytes(slice[136..144].try_into().unwrap()),
            id_mappings_len: u64::from_le_bytes(slice[144..152].try_into().unwrap()),
        }
    }
}

fn align_to_8(len: usize) -> usize {
    (len + 7) & !7
}

/// Writes a collection snapshot to the given path in the Version 2 memory-mappable layout.
pub fn save(path: &Path, data: &CollectionData) -> Result<(), DevDbError> {
    let file = fs::File::create(path)?;
    let mut writer = BufWriter::new(file);

    let mut buf = Vec::new();
    let header_size = 192;
    buf.resize(header_size, 0);

    // 1. Vectors Section (aligned to 4-byte boundary naturally since header is 192 bytes, which is a multiple of 8)
    let vectors_offset = buf.len() as u64;
    let raw_vectors_bytes = unsafe {
        std::slice::from_raw_parts(
            data.vectors.data.as_ptr() as *const u8,
            data.vectors.data.len() * 4,
        )
    };
    buf.extend_from_slice(raw_vectors_bytes);
    let vectors_len = buf.len() as u64 - vectors_offset;

    // Align to 8-byte boundary
    let align_pad = align_to_8(buf.len()) - buf.len();
    buf.resize(buf.len() + align_pad, 0);

    // 2. HNSW offsets
    let hnsw_offsets_offset = buf.len() as u64;
    let node_count = data.vectors.len();
    let hnsw_offsets_len = (node_count * 8) as u64;
    buf.resize(buf.len() + hnsw_offsets_len as usize, 0);

    // Align to 8-byte boundary
    let align_pad = align_to_8(buf.len()) - buf.len();
    buf.resize(buf.len() + align_pad, 0);

    // 3. HNSW Nodes
    let hnsw_nodes_offset = buf.len() as u64;
    let mut offsets = Vec::with_capacity(node_count);

    for node in &data.index.nodes {
        let relative_offset = (buf.len() as u64) - hnsw_nodes_offset;
        offsets.push(relative_offset);

        // internal_idx: u64
        buf.extend_from_slice(&(node.internal_idx as u64).to_le_bytes());
        // num_layers: u32
        let num_layers = node.neighbors.len();
        buf.extend_from_slice(&(num_layers as u32).to_le_bytes());

        for layer_neighbors in &node.neighbors {
            // neighbor_count: u32
            buf.extend_from_slice(&(layer_neighbors.len() as u32).to_le_bytes());
            for &neighbor in layer_neighbors {
                buf.extend_from_slice(&(neighbor as u32).to_le_bytes());
            }
        }
    }
    let hnsw_nodes_len = (buf.len() as u64) - hnsw_nodes_offset;

    // Write back actual node offsets
    for (i, &offset) in offsets.iter().enumerate() {
        let start = (hnsw_offsets_offset as usize) + i * 8;
        buf[start..start + 8].copy_from_slice(&offset.to_le_bytes());
    }

    // Align to 8-byte boundary
    let align_pad = align_to_8(buf.len()) - buf.len();
    buf.resize(buf.len() + align_pad, 0);

    // 4. Payloads
    let payloads_offset = buf.len() as u64;
    let payload_bytes = bincode::serialize(&data.payloads)?;
    buf.extend_from_slice(&payload_bytes);
    let payloads_len = payload_bytes.len() as u64;

    // Align to 8-byte boundary
    let align_pad = align_to_8(buf.len()) - buf.len();
    buf.resize(buf.len() + align_pad, 0);

    // 5. ID mappings
    let id_mappings_offset = buf.len() as u64;
    let mappings_bytes = bincode::serialize(&(&data.id_to_internal, &data.internal_to_id))?;
    buf.extend_from_slice(&mappings_bytes);
    let id_mappings_len = mappings_bytes.len() as u64;

    // Construct Header
    let header = MmapHeader {
        magic: *b"DVDB",
        version: 2,
        dim: data.vectors.dim() as u64,
        node_count: node_count as u64,
        entry_point: data.index.entry_point.map(|ep| ep as i64).unwrap_or(-1),
        max_layer: data.index.max_layer as u64,
        m: data.index.config.m as u64,
        m_max0: data.index.config.m_max0 as u64,
        ef_construction: data.index.config.ef_construction as u64,
        ef_search: data.index.config.ef_search as u64,

        vectors_offset,
        vectors_len,

        hnsw_offsets_offset,
        hnsw_offsets_len,
        hnsw_nodes_offset,
        hnsw_nodes_len,

        payloads_offset,
        payloads_len,

        id_mappings_offset,
        id_mappings_len,
    };

    header.write_to_slice(&mut buf[0..header_size]);

    writer.write_all(&buf)?;
    writer.flush()?;
    Ok(())
}

/// Loads a legacy version 1 collection snapshot from the given reader.
pub fn load_legacy_v1(reader: &mut dyn std::io::Read) -> Result<CollectionData, DevDbError> {
    let data: CollectionData = bincode::deserialize_from(reader)?;
    Ok(data)
}
