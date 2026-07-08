//! Distance and similarity functions for vector comparison.
//!
//! DevDB normalizes all vectors to unit length at insert time, which reduces cosine
//! similarity to a plain dot product — eliminating per-query sqrt and division. This
//! module provides the hot-loop dot product plus a conversion to a distance metric
//! (1 − dot) for use in nearest-neighbor search where *lower is closer*.

/// Computes the dot product of two equal-length slices.
///
/// This is the single hottest loop in the engine: it runs once per candidate pair
/// during every search. The implementation uses `iter().zip().map().sum()` — a
/// pattern the Rust compiler reliably auto-vectorizes into SIMD instructions
/// (SSE/AVX on x86, NEON on ARM) when compiled with `-C opt-level=2` or higher.
///
/// We deliberately avoid hand-written `std::arch` SIMD intrinsics because:
/// 1. The compiler-generated code is within a few percent of hand-tuned intrinsics
///    for this simple reduction pattern.
/// 2. Auto-vectorization is portable across ISAs without `#[cfg(target_arch)]` branches.
/// 3. Hand-written intrinsics are fragile, hard to audit, and a maintenance burden
///    disproportionate to the marginal gain.
///
/// # Panics
///
/// Debug-mode assertion if slices differ in length. In release builds this is
/// unchecked for performance — callers must guarantee equal lengths.
#[inline]
pub fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len(), "dot_product: mismatched slice lengths");
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// Converts a dot-product similarity into a distance: `1.0 − dot(a, b)`.
///
/// For unit vectors this equals the cosine distance. The result is non-negative
/// and zero only when `a == b`. Search algorithms minimize this value.
#[inline]
pub fn cosine_distance(a: &[f32], b: &[f32]) -> f32 {
    1.0 - dot_product(a, b)
}

/// Computes the squared Euclidean (L2²) distance between two slices.
///
/// Provided as an alternative metric. For unit-normalized vectors,
/// L2² = 2(1 − dot), so it is monotonically equivalent to cosine distance.
/// Having it available lets callers pick the metric that matches their upstream
/// embedding model's training objective.
#[inline]
pub fn euclidean_distance_squared(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len(), "euclidean: mismatched slice lengths");
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| {
            let d = x - y;
            d * d
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dot_product_identical_unit_vector() {
        // A unit vector dotted with itself should yield 1.0.
        let v = [0.6, 0.8]; // |v| = 1.0
        let result = dot_product(&v, &v);
        assert!((result - 1.0).abs() < 1e-6, "got {result}");
    }

    #[test]
    fn dot_product_orthogonal() {
        let a = [1.0, 0.0];
        let b = [0.0, 1.0];
        assert!((dot_product(&a, &b)).abs() < 1e-6);
    }

    #[test]
    fn cosine_distance_identical() {
        let v = [0.6, 0.8];
        assert!((cosine_distance(&v, &v)).abs() < 1e-6);
    }

    #[test]
    fn cosine_distance_orthogonal() {
        let a = [1.0, 0.0];
        let b = [0.0, 1.0];
        assert!((cosine_distance(&a, &b) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn euclidean_squared_zero_for_same() {
        let v = [1.0, 2.0, 3.0];
        assert!((euclidean_distance_squared(&v, &v)).abs() < 1e-6);
    }

    #[test]
    fn euclidean_squared_known_value() {
        let a = [0.0, 0.0];
        let b = [3.0, 4.0];
        // expected: 9 + 16 = 25
        assert!((euclidean_distance_squared(&a, &b) - 25.0).abs() < 1e-6);
    }
}
