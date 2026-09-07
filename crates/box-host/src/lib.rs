use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::info;

use box_chrome::ChromeStatus;
use box_common::cors_layer;
use box_common::container_local_http_url;
use box_common::listen_addr;
use box_common::token::{auth_layer, TokenStore};
use box_cua::CuaEngine;

mod cua;
mod files;
mod screenshot;
mod vnc;

#[derive(Clone)]
pub struct AppState {
    pub started: Instant,
    pub token: TokenStore,
    pub cua: Arc<CuaEngine>,
    pub chrome: Arc<Mutex<ChromeStatus>>,
    pub vnc_password: String,
    pub desktop: bool,
    pub exec_listen: SocketAddr,
    pub host_listen: SocketAddr,
    pub vnc_listen: SocketAddr,
}

impl AppState {
    pub fn new(
        token: TokenStore,
        cua: Arc<CuaEngine>,
        chrome: Arc<Mutex<ChromeStatus>>,
        vnc_password: String,
        desktop: bool,
        exec_listen: SocketAddr,
        host_listen: SocketAddr,
        vnc_listen: SocketAddr,
    ) -> Self {
        Self {
            started: Instant::now(),
            token,
            cua,
            chrome,
            vnc_password,
            desktop,
            exec_listen,
            host_listen,
            vnc_listen,
        }
    }
}

#[derive(Serialize)]
struct HealthBody {
    ok: bool,
    service: &'static str,
}

#[derive(Serialize)]
struct ReadyBody {
    ok: bool,
    service: &'static str,
    desktop: bool,
    chrome: ChromeStatus,
}

#[derive(Serialize)]
struct InfoBody {
    product: &'static str,
    service: &'static str,
    version: &'static str,
    uptime_ms: u128,
    desktop: bool,
    chrome: ChromeStatus,
    endpoints: InfoEndpoints,
    note: &'static str,
}

#[derive(Serialize)]
struct InfoEndpoints {
    /// Container-local listen addresses. Remote callers must use the URL they
    /// already connected with; SDKs ignore these fields.
    exec_url: String,
    host_url: String,
    vnc_ws_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    novnc_url: Option<String>,
    scope: &'static str,
}

async fn health() -> Json<HealthBody> {
    Json(HealthBody {
        ok: true,
        service: "box-host",
    })
}

async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    let chrome = state.chrome.lock().await.clone();
    let body = ReadyBody {
        ok: true,
        service: "box-host",
        desktop: state.desktop,
        chrome,
    };
    (StatusCode::OK, Json(body))
}

async fn info(State(state): State<AppState>) -> Json<InfoBody> {
    let chrome = state.chrome.lock().await.clone();
    Json(InfoBody {
        product: "grok-box",
        service: "box-host",
        version: env!("CARGO_PKG_VERSION"),
        uptime_ms: state.started.elapsed().as_millis(),
        desktop: state.desktop,
        chrome,
        endpoints: InfoEndpoints {
            exec_url: container_local_http_url(state.exec_listen),
            host_url: container_local_http_url(state.host_listen),
            vnc_ws_url: format!("ws://{}/websockify", state.vnc_listen),
            novnc_url: if state.desktop {
                Some(format!("http://{}/vnc.html", state.vnc_listen))
            } else {
                None
            },
            scope: "container-local",
        },
        note: "endpoints are the daemons' listen addresses inside this container. Clients must keep using the exec URL, host URL, and token they connected with.",
    })
}

fn public_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/ready", get(ready))
        .with_state(state)
}

fn protected_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/info", get(info))
        .nest("/v1/files", files::router())
        .nest("/v1/cua", cua::router())
        .nest("/v1/screenshot", screenshot::router())
        .nest("/v1/vnc", vnc::router())
        .with_state(state)
        .layer(auth_layer())
}

fn app(state: AppState) -> Router {
    public_router(state.clone())
        .merge(protected_router(state))
        .layer(cors_layer())
}

pub async fn serve(addr: SocketAddr, state: AppState) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await?;n    info!(%addr, "box-host listening");
    axum::serve(listener, app(state)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use box_common::token::TokenStore;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> AppState {
        AppState::new(
            TokenStore::from_plain("test-token"),
            Arc::new(CuaEngine::default()),
            Arc::new(Mutex::new(ChromeStatus {
                running: false,
                pid: None,
                cdp_port: 9222,
            })),
            "secret".into(),
            false,
            "127.0.0.1:1337".parse().unwrap(),
            "127.0.0.1:1340".parse().unwrap(),
            "127.0.0.1:6080".parse().unwrap(),
        )
    }

    #[tokio::test]
    async fn health_is_public() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn ready_is_public() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn info_requires_token() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/info")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn info_with_token_reports_container_local_urls() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/info")
                    .header("authorization", "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["endpoints"]["scope"], "container-local");
        assert_eq!(body["endpoints"]["exec_url"], "http://127.0.0.1:1337");
        assert_eq!(body["endpoints"]["host_url"], "http://127.0.0.1:1340");
        assert_eq!(
            body["note"].as_str().unwrap().contains("listen addresses"),
            true
        );
    }

    #[tokio::test]
    async fn screenshot_requires_token() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/screenshot")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn files_requires_token() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/files?path=/tmp/x")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn cua_requires_token() {
        let response = app(test_state())
            .oneshot(
                Request::builder()
                    .uri("/v1/cua/click")
                    .method("POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}
