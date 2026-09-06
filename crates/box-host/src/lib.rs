//! Thin host gateway for grok-box (`box-host`).
//!
//! This process does **not** run inference. It advertises box identity,
//! capabilities (exec, files, desktop, chrome, cua), and readiness of
//! `box-exec` (and the X display when desktop is required).

use std::time::Duration;

use axum::extract::{Request, State};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use box_chrome::{probe_chrome, ChromeConfig, ChromeStatus};
use box_common::{bearer_token, tokens_equal, ApiError, BoxConfig, PROTOCOL_VERSION};
use box_cua::CuaConfig;
use box_desktop::{DesktopConfig, DesktopStatus};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[derive(Clone, Debug)]
pub struct AppState {
    pub box_id: String,
    pub token: String,
    pub workspace: String,
    pub exec_url: String,
    pub host_bind: String,
    pub desktop: DesktopConfig,
    pub chrome: ChromeConfig,
    pub cua: CuaConfig,
}

impl AppState {
    pub fn from_config(config: &BoxConfig) -> Self {
        Self {
            box_id: config.box_id.clone(),
            token: config.host_token.clone(),
            workspace: config.workspace.display().to_string(),
            exec_url: config.exec_url.trim_end_matches('/').to_string(),
            host_bind: config.host_bind.to_string(),
            desktop: DesktopConfig::from_env(),
            chrome: ChromeConfig::from_env(),
            cua: CuaConfig::from_env(),
        }
    }
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct ReadyResponse {
    status: &'static str,
    service: &'static str,
    exec_ready: bool,
    desktop_ready: bool,
}

#[derive(Serialize)]
struct InfoResponse {
    box_id: String,
    service: &'static str,
    protocol: &'static str,
    version: VersionInfo,
    capabilities: Capabilities,
    endpoints: Endpoints,
    workspace: String,
}

#[derive(Serialize)]
struct VersionInfo {
    box_host: &'static str,
    box_exec: &'static str,
    protocol: &'static str,
}

#[derive(Serialize)]
struct Capabilities {
    exec: bool,
    files: bool,
    desktop: bool,
    chrome: bool,
    cua: bool,
}

#[derive(Serialize)]
struct Endpoints {
    exec: String,
    host: String,
}

pub fn app(state: AppState) -> Router {
    let protected = Router::new()
        .route("/v1/info", get(info))
        .route("/v1/desktop", get(desktop))
        .route("/v1/chrome", get(chrome))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/ready", get(ready))
        .merge(protected)
        .with_state(state)
}

pub fn router(state: AppState) -> Router {
    app(state)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
}

pub async fn serve(config: BoxConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bind = config.host_bind;
    let app = router(AppState::from_config(&config));
    tracing::info!(%bind, box_id = %config.box_id, "box-host listening");
    let listener = TcpListener::bind(bind).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "box-host",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn ready(State(state): State<AppState>) -> Result<Json<ReadyResponse>, ApiError> {
    let exec_ready = probe_exec_health(&state.exec_url).await;
    let desktop_ready = state.desktop.probe_display();
    if !exec_ready {
        return Err(ApiError::new(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "not_ready",
            "box-exec is not reachable",
        ));
    }
    if state.desktop.required && !desktop_ready {
        return Err(ApiError::new(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "not_ready",
            "desktop display is not up",
        ));
    }
    Ok(Json(ReadyResponse {
        status: "ready",
        service: "box-host",
        exec_ready: true,
        desktop_ready,
    }))
}

async fn info(State(state): State<AppState>) -> Json<InfoResponse> {
    Json(InfoResponse {
        box_id: state.box_id.clone(),
        service: "box-host",
        protocol: PROTOCOL_VERSION,
        version: VersionInfo {
            box_host: env!("CARGO_PKG_VERSION"),
            box_exec: env!("CARGO_PKG_VERSION"),
            protocol: PROTOCOL_VERSION,
        },
        capabilities: Capabilities {
            exec: true,
            files: true,
            desktop: state.desktop.probe_display(),
            chrome: probe_chrome(&state.chrome).running,
            cua: state.cua.capability_ready(),
        },
        endpoints: Endpoints {
            exec: state.exec_url.clone(),
            host: format!("http://{}", advertised_host(&state.host_bind)),
        },
        workspace: state.workspace.clone(),
    })
}

async fn desktop(State(state): State<AppState>) -> Json<DesktopStatus> {
    let host = advertised_host(&state.host_bind);
    Json(DesktopStatus::from_config(&state.desktop, &host))
}

async fn chrome(State(state): State<AppState>) -> Json<ChromeStatus> {
    Json(probe_chrome(&state.chrome))
}

async fn require_token(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let presented = bearer_token(request.headers()).ok_or_else(ApiError::unauthorized)?;
    if !tokens_equal(presented, &state.token) {
        return Err(ApiError::unauthorized());
    }
    Ok(next.run(request).await)
}

/// Tiny HTTP/1.1 probe so box-host does not need an HTTP client crate.
async fn probe_exec_health(exec_url: &str) -> bool {
    let Some(addr) = host_port_from_url(exec_url) else {
        return false;
    };
    let Ok(Ok(mut stream)) =
        tokio::time::timeout(Duration::from_secs(1), TcpStream::connect(&addr)).await
    else {
        return false;
    };
    let req = format!("GET /v1/health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).await.is_err() {
        return false;
    }
    let mut buf = vec![0u8; 256];
    let Ok(n) = stream.read(&mut buf).await else {
        return false;
    };
    let text = String::from_utf8_lossy(&buf[..n]);
    text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200")
}

fn host_port_from_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))?;
    let hostport = rest.split('/').next().unwrap_or(rest);
    if hostport.contains(':') {
        Some(hostport.to_string())
    } else {
        Some(format!("{hostport}:80"))
    }
}

fn advertised_host(bind: &str) -> String {
    if bind.starts_with("0.0.0.0:") {
        bind.replacen("0.0.0.0", "127.0.0.1", 1)
    } else {
        bind.to_string()
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    fn state() -> AppState {
        AppState {
            box_id: "test-box".into(),
            token: "host-secret".into(),
            workspace: "/workspace".into(),
            exec_url: "http://127.0.0.1:1337".into(),
            host_bind: "0.0.0.0:1340".into(),
            desktop: DesktopConfig::disabled(),
            chrome: ChromeConfig::disabled(),
            cua: CuaConfig::disabled(),
        }
    }

    async fn send(req: Request<Body>) -> (StatusCode, Value) {
        let response = app(state()).oneshot(req).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        (status, json)
    }

    #[tokio::test]
    async fn health_public() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["service"], "box-host");
    }

    #[tokio::test]
    async fn info_rejects_missing_auth() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/info")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["code"], "unauthorized");
    }

    #[tokio::test]
    async fn info_rejects_wrong_token() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/info")
                .header("authorization", "Bearer nope")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["code"], "unauthorized");
    }

    #[tokio::test]
    async fn info_ok_with_token() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/info")
                .header("authorization", "Bearer host-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["box_id"], "test-box");
        assert_eq!(body["capabilities"]["exec"], true);
        assert_eq!(body["capabilities"]["files"], true);
        assert_eq!(body["capabilities"]["desktop"], false);
        assert_eq!(body["capabilities"]["chrome"], false);
        assert_eq!(body["capabilities"]["cua"], false);
    }

    #[tokio::test]
    async fn chrome_ok_when_disabled() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/chrome")
                .header("authorization", "Bearer host-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["enabled"], false);
        assert_eq!(body["running"], false);
        assert!(body["cdp"].is_null());
    }

    #[tokio::test]
    async fn desktop_rejects_missing_auth() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/desktop")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["code"], "unauthorized");
    }

    #[tokio::test]
    async fn desktop_ok_when_disabled() {
        let (status, body) = send(
            Request::builder()
                .uri("/v1/desktop")
                .header("authorization", "Bearer host-secret")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["available"], false);
        assert_eq!(body["display"], ":1");
        assert_eq!(body["viewer"]["port"], 6080);
        assert_eq!(body["viewer"]["path"], "/vnc.html");
    }

    #[test]
    fn parse_exec_url() {
        assert_eq!(
            host_port_from_url("http://127.0.0.1:1337"),
            Some("127.0.0.1:1337".into())
        );
        assert_eq!(
            host_port_from_url("http://127.0.0.1:1337/v1/health"),
            Some("127.0.0.1:1337".into())
        );
    }
}
