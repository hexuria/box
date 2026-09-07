use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::{Request, State};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use box_chrome::{probe_chrome, ChromeConfig, ChromeStatus};
use box_common::{
    bearer_token, container_local_host, container_local_http_url, cors_layer, tokens_equal,
    ApiError, BoxConfig, PROTOCOL_VERSION,
};
use box_cua::CuaConfig;
use box_desktop::{DesktopConfig, DesktopStatus};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tower_http::trace::TraceLayer;

#[derive(Clone, Debug)]
pub struct AppState {
    pub box_id: String,
    pub token: String,
    pub workspace: String,
    pub exec_url: String,
    pub exec_bind: SocketAddr,
    pub host_bind: SocketAddr,
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
            exec_bind: config.exec_bind,
            host_bind: config.host_bind,
            desktop: DesktopConfig::from_env(),
            chrome: ChromeConfig::from_env(),
            cua: CuaConfig::from_env(),
        }
    }
}
