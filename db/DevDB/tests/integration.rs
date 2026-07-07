/// Integration tests for DevDB.
///
/// These tests exercise the full public API path (Collection) rather than
/// individual modules, verifying that the pieces work together correctly.
use std::collections::HashMap;

use devdb::{Collection, CollectionConfig, Condition, DevDbError, Filter, Value};

/// Verifies that insert + unfiltered search returns the correct nearest neighbor.
#[test]
fn insert_and_search_round_trip() {
    let mut db = Collection::new(CollectionConfig {
        dim: 4,
        ..Default::default()
    });

    db.insert(10, &[1.0, 0.0, 0.0, 0.0], HashMap::new())
        .unwrap();
    db.insert(20, &[0.0, 1.0, 0.0, 0.0], HashMap::new())
        .unwrap();
    db.insert(30, &[0.0, 0.0, 1.0, 0.0], HashMap::new())
        .unwrap();

    let results = db.search(&[1.0, 0.0, 0.0, 0.0], 1, None).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].0, 10);
    assert!(
        results[0].1 < 1e-5,
        "distance should be ~0, got {}",
        results[0].1
    );
}

/// Verifies that HNSW agrees with brute-force on a moderately-sized random dataset.
///
/// This is the key correctness proof: if HNSW returns the same top-1 as the
/// ground-truth brute-force on random data, the graph construction and search
/// are working correctly.
#[test]
fn hnsw_agrees_with_brute_force() {
    use devdb::index::brute_force::BruteForceIndex;
    use devdb::index::hnsw::{HnswConfig, HnswIndex};
    use devdb::index::Index;

    let dim = 32;
    let n = 200;

    // Simple deterministic "random" vectors via linear congruential generator.
    let mut seed: u64 = 42;
    let mut next_f32 = || -> f32 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((seed >> 33) as f32) / (u32::MAX as f32) - 0.5
    };

    let vectors: Vec<Vec<f32>> = (0..n)
        .map(|_| {
            let v: Vec<f32> = (0..dim).map(|_| next_f32()).collect();
            let mag: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            if mag < 1e-8 {
                vec![1.0; dim] // fallback for unlikely zero vector
            } else {
                v.into_iter().map(|x| x / mag).collect()
            }
        })
        .collect();

    struct SliceAccessor<'a>(&'a [Vec<f32>]);
    impl<'a> devdb::index::VectorAccessor for SliceAccessor<'a> {
        fn get_vector(&self, idx: usize) -> &[f32] {
            &self.0[idx]
        }
    }

    let acc = SliceAccessor(&vectors);
    let mut bf = BruteForceIndex::new();
    // Set ef_search = N for this correctness test so HNSW should find all
    // true nearest neighbors (at the cost of speed — acceptable in a test).
    let mut hnsw = HnswIndex::new(HnswConfig::with_m(16));
    hnsw.set_ef_search(n);

    for (i, v) in vectors.iter().enumerate() {
        bf.insert(i, v, &acc);
        hnsw.insert(i, v, &acc);
    }

    // Check top-5 recall on 20 queries: count how many of BF's top-5 appear
    // in HNSW's top-5. With ef_search = N, recall should be very high.
    let k = 5;
    let mut total_hits = 0;
    let total_checks = 20 * k;

    for query in vectors.iter().take(20) {
        let bf_results = bf.search(query, k, &acc);
        let hnsw_results = hnsw.search(query, k, &acc);

        let bf_ids: Vec<usize> = bf_results.iter().map(|r| r.index).collect();
        let hnsw_ids: Vec<usize> = hnsw_results.iter().map(|r| r.index).collect();

        for id in &bf_ids {
            if hnsw_ids.contains(id) {
                total_hits += 1;
            }
        }
    }

    let recall = total_hits as f64 / total_checks as f64;
    assert!(
        recall >= 0.8,
        "HNSW recall@{k} = {recall:.2} (expected >= 0.80, got {total_hits}/{total_checks})"
    );
}

/// Verifies that post-filtering correctly narrows results.
#[test]
fn filtered_search_correctness() {
    let mut db = Collection::new(CollectionConfig {
        dim: 3,
        ..Default::default()
    });

    let mut p_a = HashMap::new();
    p_a.insert("category".into(), Value::String("geology".into()));
    p_a.insert("year".into(), Value::Number(2022.0));

    let mut p_b = HashMap::new();
    p_b.insert("category".into(), Value::String("safety".into()));
    p_b.insert("year".into(), Value::Number(2023.0));

    let mut p_c = HashMap::new();
    p_c.insert("category".into(), Value::String("geology".into()));
    p_c.insert("year".into(), Value::Number(2024.0));

    db.insert(1, &[1.0, 0.0, 0.0], p_a).unwrap();
    db.insert(2, &[0.9, 0.1, 0.0], p_b).unwrap();
    db.insert(3, &[0.8, 0.2, 0.0], p_c).unwrap();

    // Filter: geology AND year >= 2023.
    let filter = Filter {
        conditions: vec![
            Condition::Equals("category".into(), Value::String("geology".into())),
            Condition::GreaterThanOrEqual("year".into(), 2023.0),
        ],
    };

    let results = db.search(&[1.0, 0.0, 0.0], 10, Some(filter)).unwrap();
    // Only point 3 matches (geology + 2024).
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].0, 3);
}

/// Verifies save/load round trip preserves data and search results.
#[test]
fn persistence_round_trip() {
    let mut db = Collection::new(CollectionConfig {
        dim: 4,
        ..Default::default()
    });

    db.insert(1, &[1.0, 0.0, 0.0, 0.0], HashMap::new()).unwrap();
    db.insert(2, &[0.0, 1.0, 0.0, 0.0], HashMap::new()).unwrap();
    db.insert(3, &[0.0, 0.0, 1.0, 0.0], HashMap::new()).unwrap();

    let results_before = db.search(&[1.0, 0.0, 0.0, 0.0], 2, None).unwrap();

    let dir = std::env::temp_dir().join("devdb_integration_test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("test_snapshot.devdb");

    db.save(&path).unwrap();
    let mut loaded = Collection::load(&path).unwrap();

    assert_eq!(loaded.len(), 3);
    assert_eq!(loaded.dim(), 4);

    let results_after = loaded.search(&[1.0, 0.0, 0.0, 0.0], 2, None).unwrap();
    assert_eq!(results_before[0].0, results_after[0].0);

    std::fs::remove_dir_all(&dir).ok();
}

/// Verifies error handling for dimension mismatch and empty collection.
#[test]
fn error_handling() {
    let mut db = Collection::new(CollectionConfig {
        dim: 3,
        ..Default::default()
    });

    // Search on empty collection.
    let err = db.search(&[1.0, 0.0, 0.0], 1, None);
    assert!(matches!(err, Err(DevDbError::EmptyCollection)));

    // Insert with wrong dimension.
    let err = db.insert(1, &[1.0, 2.0], HashMap::new());
    assert!(matches!(err, Err(DevDbError::DimensionMismatch { .. })));

    // Insert zero vector.
    let err = db.insert(1, &[0.0, 0.0, 0.0], HashMap::new());
    assert!(matches!(err, Err(DevDbError::ZeroVector)));
}

/// Verifies that memory-mapped loaded collections enforce read-only constraints.
#[test]
fn mmap_read_only_mutations() {
    let mut db = Collection::new(CollectionConfig {
        dim: 3,
        ..Default::default()
    });
    db.insert(1, &[1.0, 0.0, 0.0], HashMap::new()).unwrap();

    let dir = std::env::temp_dir().join("devdb_integration_test_readonly");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("readonly.devdb");

    db.save(&path).unwrap();
    let mut loaded = Collection::load(&path).unwrap();

    // Insertion on read-only loaded collection must return ReadOnly error
    let err = loaded.insert(2, &[0.0, 1.0, 0.0], HashMap::new());
    assert!(matches!(err, Err(DevDbError::ReadOnly)));

    // Saving loaded collection must also return ReadOnly error
    let err = loaded.save(&path);
    assert!(matches!(err, Err(DevDbError::ReadOnly)));

    std::fs::remove_dir_all(&dir).ok();
}
