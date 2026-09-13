//! Echo `x-request-id` (or mint one) on every response.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;
use http::header::{HeaderName, HeaderValue};

/// Header name, lowercase as sent on the wire.
pub static REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");

static SEQ: AtomicU64 = AtomicU64::new(1);

/// Correlation id stored in request extensions.
#[derive(Clone, Debug)]
pub struct RequestId(pub String);

/// Generate a unique id (timestamp-nanos + counter). Not a UUID.
pub fn new_id() -> String {
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}-{n:x}")
}

/// `prefix-{id}` for exec ids and similar.
pub fn new_prefixed_id(prefix: &str) -> String {
    format!("{prefix}-{}", new_id())
}

fn valid_request_id(raw: &str) -> bool {
    let t = raw.trim();
    !t.is_empty()
        && t.len() <= 128
        && t.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

/// Middleware: honor inbound `x-request-id` or mint one; always echo it.
pub async fn echo_request_id(mut request: Request, next: Next) -> Response {
    let id = request
        .headers()
        .get(&REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|s| valid_request_id(s))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(new_id);
    request.extensions_mut().insert(RequestId(id.clone()));
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&id) {
        response
            .headers_mut()
            .insert(REQUEST_ID_HEADER.clone(), value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_spaces_and_oversize() {
        assert!(valid_request_id("abc-123"));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id("has space"));
        assert!(!valid_request_id(&"a".repeat(129)));
        assert!(valid_request_id("req:1.2_3"));
    }

    #[test]
    fn ids_are_unique() {
        let a = new_id();
        let b = new_id();
        assert_ne!(a, b);
        assert!(new_prefixed_id("exec").starts_with("exec-"));
    }
}
