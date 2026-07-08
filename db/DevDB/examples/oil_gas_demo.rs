/// Oil & gas domain demo: loads sample embeddings, runs filtered queries.
///
/// This example demonstrates the full DevDB workflow:
/// 1. Create a collection with 384-dimensional embeddings
/// 2. Insert documents with metadata payloads
/// 3. Run unfiltered and filtered nearest-neighbor searches
/// 4. Save and reload a snapshot
use std::collections::HashMap;

use devdb::{Collection, CollectionConfig, Condition, Filter, Value};

fn main() {
    println!("=== DevDB Oil & Gas RAG Demo ===\n");

    let mut db = Collection::new(CollectionConfig {
        dim: 8,
        ..Default::default()
    });

    // Simulate document embeddings for oil & gas domain.
    // In production these come from an upstream embedding model.
    let docs: Vec<(u64, &str, &str, f64, Vec<f32>)> = vec![
        (
            1,
            "well_log",
            "Permian Basin Well A — porosity log showing 18% avg",
            2023.0,
            vec![0.8, 0.1, 0.1, 0.0, 0.3, 0.2, 0.1, 0.4],
        ),
        (
            2,
            "report",
            "Q4 2023 Production Report — Eagle Ford",
            2023.0,
            vec![0.1, 0.9, 0.0, 0.1, 0.2, 0.3, 0.5, 0.1],
        ),
        (
            3,
            "well_log",
            "Delaware Basin Well C — resistivity anomaly at 8500ft",
            2024.0,
            vec![0.7, 0.2, 0.3, 0.1, 0.4, 0.1, 0.0, 0.5],
        ),
        (
            4,
            "safety",
            "HSE Incident Report — H2S detection protocol update",
            2024.0,
            vec![0.0, 0.1, 0.9, 0.8, 0.1, 0.0, 0.2, 0.1],
        ),
        (
            5,
            "report",
            "Reserves Estimation — Midland Basin 2024 update",
            2024.0,
            vec![0.2, 0.7, 0.1, 0.0, 0.5, 0.4, 0.3, 0.2],
        ),
    ];

    for (id, doc_type, title, year, embedding) in &docs {
        let mut payload = HashMap::new();
        payload.insert("type".into(), Value::String(doc_type.to_string()));
        payload.insert("title".into(), Value::String(title.to_string()));
        payload.insert("year".into(), Value::Number(*year));
        db.insert(*id, embedding, payload).unwrap();
    }

    println!("Inserted {} documents\n", db.len());

    // Query 1: Find documents similar to a well log query, no filter.
    let query = vec![0.75, 0.15, 0.2, 0.05, 0.35, 0.15, 0.05, 0.45];
    let results = db.search(&query, 3, None).unwrap();
    println!("--- Query 1: Nearest to a well log embedding (unfiltered) ---");
    for (id, dist) in &results {
        println!("  ID {id}: distance = {dist:.4}");
    }

    // Query 2: Same query but filtered to only "well_log" documents.
    let filter = Filter {
        conditions: vec![Condition::Equals(
            "type".into(),
            Value::String("well_log".into()),
        )],
    };
    let results = db.search(&query, 3, Some(filter)).unwrap();
    println!("\n--- Query 2: Same query, filtered to well_log type ---");
    for (id, dist) in &results {
        println!("  ID {id}: distance = {dist:.4}");
    }

    // Query 3: Reports from 2024.
    let report_query = vec![0.15, 0.8, 0.05, 0.05, 0.4, 0.35, 0.4, 0.15];
    let filter = Filter {
        conditions: vec![
            Condition::Equals("type".into(), Value::String("report".into())),
            Condition::GreaterThanOrEqual("year".into(), 2024.0),
        ],
    };
    let results = db.search(&report_query, 3, Some(filter)).unwrap();
    println!("\n--- Query 3: Reports from 2024+ ---");
    for (id, dist) in &results {
        println!("  ID {id}: distance = {dist:.4}");
    }

    // Save and reload.
    let snap_path = std::path::Path::new("/tmp/oil_gas_demo.devdb");
    db.save(snap_path).unwrap();
    println!("\nSnapshot saved to {}", snap_path.display());

    let mut loaded = Collection::load(snap_path).unwrap();
    println!(
        "Loaded snapshot: {} vectors, dim={}",
        loaded.len(),
        loaded.dim()
    );

    // Verify loaded collection works.
    let results = loaded.search(&query, 1, None).unwrap();
    println!("Post-load search: closest ID = {}", results[0].0);

    // Cleanup
    std::fs::remove_file(snap_path).ok();

    println!("\n=== Demo complete ===");
}
