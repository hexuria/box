use axum::extract::State;
use axum::middleware;
use axum::routing::{get, post};
use axum::Json;
use axum::Router;
use serde::Serialize;

use crate::middleware::require_token;
use crate::{exec, files, AppState};

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

pub fn app(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/exec", post(exec::handle))
        .route("/v1/files", get(files::get).put(files::put))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    Router::new()
        .route("/v1/health", get(health))
        .merge(protected)
        .with_state(state)
}

async fn health(State(_state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "box-exec",
        version: env!("CARGO_PKG_VERSION"),
    })
}
