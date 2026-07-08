//! Recall-vs-latency sweep for HNSW.
//!
//! Builds an HNSW index over 10k random 128-dim vectors, then for each value of
//! `ef_search` measures (a) recall@10 against brute-force ground truth and
//! (b) average single-query latency. Prints a markdown table the docs paste in.

use std::time::Instant;

use devdb::index::brute_force::BruteForceIndex;
use devdb::index::hnsw::{HnswConfig, HnswIndex};
use devdb::index::{Index, VectorAccessor};
use rand::Rng;

const DIM: usize = 128;
const N: usize = 10_000;
const Q: usize = 200;
const K: usize = 10;

struct SliceAccessor<'a>(&'a [Vec<f32>]);
impl<'a> VectorAccessor for SliceAccessor<'a> {
    fn get_vector(&self, idx: usize) -> &[f32] {
        &self.0[idx]
    }
}

fn random_vectors(n: usize, dim: usize) -> Vec<Vec<f32>> {
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| {
            let v: Vec<f32> = (0..dim).map(|_| rng.gen::<f32>() - 0.5).collect();
            let mag: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
            v.into_iter().map(|x| x / mag).collect()
        })
        .collect()
}

fn main() {
    println!("# DevDB recall-vs-latency curve");
    println!("N={N}, dim={DIM}, k={K}, queries={Q}, m=16, ef_construction=200\n");

    let vectors = random_vectors(N, DIM);
    let queries = random_vectors(Q, DIM);
    let acc = SliceAccessor(&vectors);

    let build_start = Instant::now();
    let mut hnsw = HnswIndex::new(HnswConfig::with_m(16));
    for (i, v) in vectors.iter().enumerate() {
        hnsw.insert(i, v, &acc);
    }
    let build_ms = build_start.elapsed().as_secs_f64() * 1000.0;

    let mut bf = BruteForceIndex::new();
    for (i, v) in vectors.iter().enumerate() {
        bf.insert(i, v, &acc);
    }

    // Ground-truth top-K per query.
    let truth: Vec<Vec<usize>> = queries
        .iter()
        .map(|q| bf.search(q, K, &acc).into_iter().map(|r| r.index).collect())
        .collect();

    println!("HNSW build time: {build_ms:.0} ms\n");
    println!("| ef_search | recall@{K} | avg latency (µs) | p95 latency (µs) |");
    println!("|-----------|-----------|------------------|------------------|");

    for &ef in &[10usize, 25, 50, 100, 200, 400] {
        hnsw.set_ef_search(ef);

        let mut hits = 0usize;
        let mut latencies: Vec<f64> = Vec::with_capacity(Q);
        for (qi, q) in queries.iter().enumerate() {
            let t0 = Instant::now();
            let res = hnsw.search(q, K, &acc);
            let us = t0.elapsed().as_secs_f64() * 1e6;
            latencies.push(us);
            for r in &res {
                if truth[qi].contains(&r.index) {
                    hits += 1;
                }
            }
        }

        let recall = hits as f64 / (Q * K) as f64;
        let avg = latencies.iter().sum::<f64>() / latencies.len() as f64;
        latencies.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let p95 = latencies[(latencies.len() as f64 * 0.95) as usize];

        println!("| {ef:>9} | {recall:>9.3} | {avg:>16.1} | {p95:>16.1} |");
    }
}
