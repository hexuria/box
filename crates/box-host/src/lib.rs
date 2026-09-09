//! Thin host gateway for grok-box (`box-host`).
//!
//! This process does **not** run inference. It advertises box identity,
//! capabilities (exec, files, desktop, chrome, cua), and readiness of
//! `box-exec` (and the X display when desktop is required). Heap: same
//! mimalloc feature as `box-exec`.

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
    ApiError, BoxConfig, GLOBAL_ALLOCATOR, PROTOCOL_VERSION,
};
use box_cua::CuaConfig;
use box_desktop::{DesktopConfig, DesktopStatus};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tower_http::trace::TraceLayer;
