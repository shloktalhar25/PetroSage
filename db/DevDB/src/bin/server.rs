//! DevDB HTTP server.
//!
//! A minimal blocking JSON-over-HTTP wrapper around `devdb::Collection`, so
//! the engine can be reached from other languages (e.g. the Python RAG app)
//! without a native binding. Not part of the core library — enabled only
//! with `--features server`.
//!
//! Routes:
//!   GET  /health     -> "ok"
//!   GET  /info       -> {"count": u64, "dim": u64}
//!   POST /collection -> {"dim": u64, "m"?: u64, "ef_construction"?: u64, "ef_search"?: u64}
//!   POST /points     -> {"points": [{"id": u64, "vector": [f32], "page"?: f64, "country"?: string}]}
//!   POST /search     -> {"vector": [f32], "top_k": u64, "page_min"?: f64, "page_max"?: f64, "country"?: string}
//!   POST /save       -> {"path": string}
//!   POST /load       -> {"path": string}

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tiny_http::{Method, Response, Server};

use devdb::{Collection, CollectionConfig, Condition, Filter, Value};

struct AppState {
    col: Option<Collection>,
    dim: usize,
}

#[derive(Deserialize)]
struct CreateCollectionReq {
    dim: usize,
    m: Option<usize>,
    ef_construction: Option<usize>,
    ef_search: Option<usize>,
}

#[derive(Deserialize)]
struct PointIn {
    id: u64,
    vector: Vec<f32>,
    page: Option<f64>,
    country: Option<String>,
}

#[derive(Deserialize)]
struct PointsReq {
    points: Vec<PointIn>,
}

#[derive(Deserialize)]
struct SearchReq {
    vector: Vec<f32>,
    top_k: usize,
    page_min: Option<f64>,
    page_max: Option<f64>,
    country: Option<String>,
}

#[derive(Serialize)]
struct SearchHit {
    id: u64,
    distance: f32,
}

#[derive(Serialize)]
struct SearchResp {
    results: Vec<SearchHit>,
}

#[derive(Deserialize)]
struct PathReq {
    path: String,
}

#[derive(Serialize)]
struct InfoResp {
    count: usize,
    dim: usize,
}

#[derive(Serialize)]
struct ErrorResp {
    error: String,
}

fn json_response(body: &impl Serialize, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let json = serde_json::to_string(body).unwrap_or_else(|_| "{}".to_string());
    Response::from_string(json)
        .with_status_code(status)
        .with_header(
            "Content-Type: application/json"
                .parse::<tiny_http::Header>()
                .unwrap(),
        )
}

fn error_response(status: u16, message: impl Into<String>) -> Response<std::io::Cursor<Vec<u8>>> {
    json_response(
        &ErrorResp {
            error: message.into(),
        },
        status,
    )
}

fn read_body(request: &mut tiny_http::Request) -> String {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    body
}

fn main() {
    let addr = std::env::var("DEVDB_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let server = Server::http(&addr).expect("failed to bind DevDB HTTP server");
    println!("DevDB server listening on {addr}");

    let state = Mutex::new(AppState { col: None, dim: 0 });

    for mut request in server.incoming_requests() {
        let method = request.method().clone();
        let url = request.url().to_string();

        let response = match (&method, url.as_str()) {
            (Method::Get, "/health") => Response::from_string("ok").with_status_code(200),

            (Method::Get, "/info") => {
                let st = state.lock().unwrap();
                match &st.col {
                    Some(col) => json_response(
                        &InfoResp {
                            count: col.len(),
                            dim: col.dim(),
                        },
                        200,
                    ),
                    None => error_response(404, "no collection created yet"),
                }
            }

            (Method::Post, "/collection") => {
                let body = read_body(&mut request);
                match serde_json::from_str::<CreateCollectionReq>(&body) {
                    Ok(req) => {
                        let mut hnsw = devdb::index::hnsw::HnswConfig::with_m(req.m.unwrap_or(16));
                        if let Some(ef_c) = req.ef_construction {
                            hnsw.ef_construction = ef_c;
                        }
                        if let Some(ef_s) = req.ef_search {
                            hnsw.ef_search = ef_s;
                        }
                        let mut st = state.lock().unwrap();
                        st.dim = req.dim;
                        st.col = Some(Collection::new(CollectionConfig {
                            dim: req.dim,
                            hnsw: Some(hnsw),
                        }));
                        json_response(&InfoResp { count: 0, dim: req.dim }, 201)
                    }
                    Err(e) => error_response(400, format!("bad request body: {e}")),
                }
            }

            (Method::Post, "/points") => {
                let body = read_body(&mut request);
                match serde_json::from_str::<PointsReq>(&body) {
                    Ok(req) => {
                        let mut st = state.lock().unwrap();
                        match &mut st.col {
                            Some(col) => {
                                let mut inserted = 0usize;
                                let mut first_err: Option<String> = None;
                                for p in req.points {
                                    let mut payload: HashMap<String, Value> = HashMap::new();
                                    if let Some(page) = p.page {
                                        payload.insert("page".to_string(), Value::Number(page));
                                    }
                                    if let Some(country) = p.country {
                                        payload.insert("country".to_string(), Value::String(country));
                                    }
                                    match col.insert(p.id, &p.vector, payload) {
                                        Ok(()) => inserted += 1,
                                        Err(e) => {
                                            first_err = Some(e.to_string());
                                            break;
                                        }
                                    }
                                }
                                match first_err {
                                    Some(e) => error_response(400, e),
                                    None => json_response(
                                        &InfoResp {
                                            count: inserted,
                                            dim: col.dim(),
                                        },
                                        200,
                                    ),
                                }
                            }
                            None => error_response(404, "no collection created yet"),
                        }
                    }
                    Err(e) => error_response(400, format!("bad request body: {e}")),
                }
            }

            (Method::Post, "/search") => {
                let body = read_body(&mut request);
                match serde_json::from_str::<SearchReq>(&body) {
                    Ok(req) => {
                        let mut st = state.lock().unwrap();
                        match &mut st.col {
                            Some(col) => {
                                let mut conditions = Vec::new();
                                if let (Some(min), Some(max)) = (req.page_min, req.page_max) {
                                    conditions.push(Condition::Range(
                                        "page".to_string(),
                                        min,
                                        max,
                                    ));
                                } else if let Some(min) = req.page_min {
                                    conditions
                                        .push(Condition::GreaterThanOrEqual("page".to_string(), min));
                                } else if let Some(max) = req.page_max {
                                    conditions
                                        .push(Condition::LessThanOrEqual("page".to_string(), max));
                                }
                                if let Some(country) = req.country {
                                    conditions.push(Condition::Equals(
                                        "country".to_string(),
                                        Value::String(country),
                                    ));
                                }
                                let filter = if conditions.is_empty() {
                                    None
                                } else {
                                    Some(Filter { conditions })
                                };

                                match col.search(&req.vector, req.top_k, filter) {
                                    Ok(hits) => json_response(
                                        &SearchResp {
                                            results: hits
                                                .into_iter()
                                                .map(|(id, distance)| SearchHit { id, distance })
                                                .collect(),
                                        },
                                        200,
                                    ),
                                    Err(e) => error_response(400, e.to_string()),
                                }
                            }
                            None => error_response(404, "no collection created yet"),
                        }
                    }
                    Err(e) => error_response(400, format!("bad request body: {e}")),
                }
            }

            (Method::Post, "/save") => {
                let body = read_body(&mut request);
                match serde_json::from_str::<PathReq>(&body) {
                    Ok(req) => {
                        let st = state.lock().unwrap();
                        match &st.col {
                            Some(col) => match col.save(std::path::Path::new(&req.path)) {
                                Ok(()) => Response::from_string("ok").with_status_code(200),
                                Err(e) => error_response(500, e.to_string()),
                            },
                            None => error_response(404, "no collection created yet"),
                        }
                    }
                    Err(e) => error_response(400, format!("bad request body: {e}")),
                }
            }

            (Method::Post, "/load") => {
                let body = read_body(&mut request);
                match serde_json::from_str::<PathReq>(&body) {
                    Ok(req) => match Collection::load(std::path::Path::new(&req.path)) {
                        Ok(col) => {
                            let mut st = state.lock().unwrap();
                            st.dim = col.dim();
                            let count = col.len();
                            st.col = Some(col);
                            json_response(&InfoResp { count, dim: st.dim }, 200)
                        }
                        Err(e) => error_response(500, e.to_string()),
                    },
                    Err(e) => error_response(400, format!("bad request body: {e}")),
                }
            }

            _ => error_response(404, "not found"),
        };

        let _ = request.respond(response);
    }
}
