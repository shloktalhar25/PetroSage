/// Metadata storage and filter predicates for vector payloads.
///
/// Each vector in a collection can carry a key-value payload (e.g. document type,
/// well name, year). Filter predicates are applied **post-search**: HNSW runs
/// with a slightly enlarged `ef` and then non-matching results are discarded.
///
/// Integrated/pre-filtered HNSW (checking filter predicates inside the graph
/// traversal) is deliberately out of scope — it requires modifying the beam
/// search to handle dead-end filtered nodes and is a multi-week engineering
/// effort. Post-filtering is correct and sufficient at single-node scale where
/// the filter selectivity is moderate.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// A dynamically-typed value that can appear in a payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Value {
    /// UTF-8 string value.
    String(String),
    /// 64-bit floating-point number.
    Number(f64),
    /// Boolean flag.
    Bool(bool),
}

/// A single filter condition on one payload field.
#[derive(Debug, Clone)]
pub enum Condition {
    /// Field must exactly equal the given value.
    Equals(String, Value),
    /// Numeric field must be ≥ the given threshold.
    GreaterThanOrEqual(String, f64),
    /// Numeric field must be ≤ the given threshold.
    LessThanOrEqual(String, f64),
    /// Numeric field must fall within `[min, max]` inclusive.
    Range(String, f64, f64),
}

/// A conjunctive filter: all conditions must hold (AND semantics).
///
/// Empty conditions match every payload.
#[derive(Debug, Clone)]
pub struct Filter {
    /// Every condition must be satisfied for a payload to pass.
    pub conditions: Vec<Condition>,
}

impl Filter {
    /// Tests whether a payload satisfies all conditions in this filter.
    pub fn matches(&self, payload: &HashMap<String, Value>) -> bool {
        self.conditions.iter().all(|cond| match cond {
            Condition::Equals(key, expected) => payload.get(key) == Some(expected),
            Condition::GreaterThanOrEqual(key, threshold) => {
                payload.get(key).is_some_and(|v| match v {
                    Value::Number(n) => n >= threshold,
                    _ => false,
                })
            }
            Condition::LessThanOrEqual(key, threshold) => {
                payload.get(key).is_some_and(|v| match v {
                    Value::Number(n) => n <= threshold,
                    _ => false,
                })
            }
            Condition::Range(key, min, max) => payload.get(key).is_some_and(|v| match v {
                Value::Number(n) => n >= min && n <= max,
                _ => false,
            }),
        })
    }
}

/// Stores payloads indexed by internal vector index.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PayloadStore {
    /// `payloads[internal_idx]` = that vector's metadata.
    payloads: Vec<HashMap<String, Value>>,
}

impl PayloadStore {
    /// Creates a new empty payload store.
    pub fn new() -> Self {
        Self {
            payloads: Vec::new(),
        }
    }

    /// Appends a payload, returning its index (should match the VectorStore index).
    pub fn push(&mut self, payload: HashMap<String, Value>) -> usize {
        let idx = self.payloads.len();
        self.payloads.push(payload);
        idx
    }

    /// Retrieves the payload for a given internal index, if it exists.
    pub fn get(&self, idx: usize) -> Option<&HashMap<String, Value>> {
        self.payloads.get(idx)
    }

    /// Returns the number of stored payloads.
    pub fn len(&self) -> usize {
        self.payloads.len()
    }

    /// Returns `true` if no payloads are stored.
    pub fn is_empty(&self) -> bool {
        self.payloads.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> HashMap<String, Value> {
        let mut p = HashMap::new();
        p.insert("type".into(), Value::String("report".into()));
        p.insert("year".into(), Value::Number(2024.0));
        p.insert("active".into(), Value::Bool(true));
        p
    }

    #[test]
    fn equals_string_match() {
        let f = Filter {
            conditions: vec![Condition::Equals(
                "type".into(),
                Value::String("report".into()),
            )],
        };
        assert!(f.matches(&sample_payload()));
    }

    #[test]
    fn equals_string_no_match() {
        let f = Filter {
            conditions: vec![Condition::Equals(
                "type".into(),
                Value::String("memo".into()),
            )],
        };
        assert!(!f.matches(&sample_payload()));
    }

    #[test]
    fn range_filter() {
        let f = Filter {
            conditions: vec![Condition::Range("year".into(), 2020.0, 2025.0)],
        };
        assert!(f.matches(&sample_payload()));
    }

    #[test]
    fn range_filter_outside() {
        let f = Filter {
            conditions: vec![Condition::Range("year".into(), 2025.0, 2030.0)],
        };
        assert!(!f.matches(&sample_payload()));
    }

    #[test]
    fn and_semantics() {
        let f = Filter {
            conditions: vec![
                Condition::Equals("type".into(), Value::String("report".into())),
                Condition::GreaterThanOrEqual("year".into(), 2024.0),
                Condition::Equals("active".into(), Value::Bool(true)),
            ],
        };
        assert!(f.matches(&sample_payload()));
    }

    #[test]
    fn missing_key_fails() {
        let f = Filter {
            conditions: vec![Condition::Equals("nonexistent".into(), Value::Bool(false))],
        };
        assert!(!f.matches(&sample_payload()));
    }

    #[test]
    fn empty_filter_matches_all() {
        let f = Filter { conditions: vec![] };
        assert!(f.matches(&sample_payload()));
        assert!(f.matches(&HashMap::new()));
    }
}
