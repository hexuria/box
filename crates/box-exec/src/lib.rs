//! HTTP exec daemon for grok-box (`box-exec`).
//!
//! Shell, workspace files, and Computer Use (CUA) actuators against the
//! box X display. Inference stays in L4.

mod cua;
mod exec;
mod files;
mod middleware;
mod routes;

use std::path::PathBuf;
use std::time::Duration;

use axum::Router;
use box_common::BoxConfig;
use box_cua::CuaConfig;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

pub use routes::app;

#[cfg(test)]
mod tests;

#[derive(Clone, Debug)]
pub struct AppState {
    pub workspace: PathBuf,
    pub token: String,
    pub max_file_bytes: u64,
    pub default_timeout: Duration,
    pub max_timeout: Duration,
    pub max_output_bytes: usize,
    pub cua: CuaConfig,
}

impl AppState {
    pub fn from_config(config: &BoxConfig) -> Self {
        Self {
            workspace: config.workspace.clone(),
            token: config.token.clone(),
            max_file_bytes: config.max_file_bytes,
            default_timeout: config.default_timeout,
            max_timeout: config.max_timeout,
            max_output_bytes: config.max_output_bytes,
            cua: CuaConfig::from_env(),
        }
    }
}

pub fn router(state: AppState) -> Router {
    let body_limit = (state.max_file_bytes as usize).saturating_add(256 * 1024);
    app(state)
        .layer(RequestBodyLimitLayer::new(body_limit))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
}

pub async fn serve(config: BoxConfig) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    std::fs::create_dir_all(&config.workspace)?;
    let bind = config.exec_bind;
    let app = router(AppState::from_config(&config));
    tracing::info!(
        %bind,
        workspace = %config.workspace.display(),
        "box-exec listening"
    );
    let listener = TcpListener::bind(bind).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
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
