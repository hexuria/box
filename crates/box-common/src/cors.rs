//! Guest CORS. Default is **no** browser origins (server-to-server does not
//! need CORS). `BOX_CORS_ORIGINS` is an explicit allowlist; `*` is ignored.

use std::time::Duration;

use axum::http::{header, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

/// CORS layer for `box-exec` and `box-host`. Never permissive.
pub fn layer() -> CorsLayer {
    let origins: Vec<HeaderValue> = std::env::var("BOX_CORS_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "*")
        .filter_map(|s| s.parse().ok())
        .collect();
    if origins.is_empty() {
        return CorsLayer::new();
    }
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::ACCEPT])
        .max_age(Duration::from_secs(600))
}
