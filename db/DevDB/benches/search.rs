/// Benchmarks: HNSW vs brute-force search and ef_search sweep.
///
/// Generates random vectors, inserts them into both indexes, and measures
/// query throughput and latency at various scales and ef_search values.
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use devdb::index::brute_force::BruteForceIndex;
use devdb::index::hnsw::{HnswConfig, HnswIndex};
use devdb::index::{Index, VectorAccessor};
use rand::Rng;

const DIM: usize = 128;

struct SliceAccessor<'a>(&'a [Vec<f32>]);

impl<'a> VectorAccessor for SliceAccessor<'a> {
    fn get_vector(&self, idx: usize) -> &[f32] {
        &self.0[idx]
    }
}

/// Generates `n` random unit vectors of dimension `dim`.
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

fn bench_search(c: &mut Criterion) {
    // Skip 100k unless explicitly requested — HNSW build at 100k takes minutes.
    let sizes: &[usize] = if std::env::var("DEVDB_BENCH_BIG").is_ok() {
        &[1_000, 10_000, 100_000]
    } else {
        &[1_000, 10_000]
    };

    for &n in sizes {
        let vectors = random_vectors(n, DIM);
        let query = &random_vectors(1, DIM)[0];
        let acc = SliceAccessor(&vectors);

        // Build brute-force index.
        let mut bf = BruteForceIndex::new();
        for (i, v) in vectors.iter().enumerate() {
            bf.insert(i, v, &acc);
        }

        // Build HNSW index.
        let mut hnsw = HnswIndex::new(HnswConfig::with_m(16));
        for (i, v) in vectors.iter().enumerate() {
            hnsw.insert(i, v, &acc);
        }

        let mut group = c.benchmark_group(format!("search_n{n}"));
        // Cap sample size at larger N — each brute-force query is O(n).
        if n >= 100_000 {
            group.sample_size(10);
        }

        group.bench_function(BenchmarkId::new("brute_force", n), |b| {
            b.iter(|| bf.search(query, 10, &acc))
        });

        group.bench_function(BenchmarkId::new("hnsw_ef50", n), |b| {
            b.iter(|| hnsw.search(query, 10, &acc))
        });

        group.finish();
    }
}

fn bench_ef_sweep(c: &mut Criterion) {
    let n = 10_000;
    let vectors = random_vectors(n, DIM);
    let query = &random_vectors(1, DIM)[0];
    let acc = SliceAccessor(&vectors);

    let mut hnsw = HnswIndex::new(HnswConfig::with_m(16));
    for (i, v) in vectors.iter().enumerate() {
        hnsw.insert(i, v, &acc);
    }

    let mut group = c.benchmark_group("ef_sweep_10k");
    for &ef in &[10, 25, 50, 100, 200, 400] {
        hnsw.set_ef_search(ef);
        group.bench_function(BenchmarkId::new("ef", ef), |b| {
            b.iter(|| hnsw.search(query, 10, &acc))
        });
    }
    group.finish();
}

criterion_group!(benches, bench_search, bench_ef_sweep);
criterion_main!(benches);
