use std::time::Duration;

use crate::{app, AppState};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use box_cua::CuaConfig;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;

fn state(dir: &TempDir) -> AppState {
    AppState {
        workspace: dir.path().to_path_buf(),
        token: "secret-token".into(),
        max_file_bytes: 1024 * 1024,
        default_timeout: Duration::from_secs(5),
        max_timeout: Duration::from_secs(10),
        max_output_bytes: 64 * 1024,
        cua: CuaConfig::disabled(),
    }
}

async fn send(state: AppState, builder: Request<Body>) -> (StatusCode, Value) {
    let app = app(state);
    let response = app.oneshot(builder).await.expect("response");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let json: Value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({"raw": String::from_utf8_lossy(&bytes)}));
    (status, json)
}

fn auth_json(method: &str, uri: &str, token: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn health_is_public() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .uri("/v1/health")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert!(body.get("service").is_none());
    assert!(body.get("version").is_none());
}

#[tokio::test]
async fn exec_rejects_missing_auth() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .method("POST")
            .uri("/v1/exec")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"command":["echo","ok"]}"#))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn exec_rejects_wrong_token() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "POST",
            "/v1/exec",
            "wrong",
            json!({"command":["echo","ok"]}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn exec_echo_ok() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "POST",
            "/v1/exec",
            "secret-token",
            json!({"command":["echo","ok"]}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["exit_code"], 0);
    assert_eq!(body["timed_out"], false);
    assert!(body["stdout"].as_str().unwrap().contains("ok"));
}

#[tokio::test]
async fn files_reject_path_escape() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .method("GET")
            .uri("/v1/files?path=../etc/passwd")
            .header("authorization", "Bearer secret-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "path_escape");
}

#[tokio::test]
async fn files_put_and_get() {
    let dir = TempDir::new().unwrap();
    let s = state(&dir);
    let (status, body) = send(
        s.clone(),
        auth_json(
            "PUT",
            "/v1/files",
            "secret-token",
            json!({"path":"notes/hello.txt","content":"hello from grok-box"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bytes_written"], "hello from grok-box".len());

    let (status, body) = send(
        s,
        Request::builder()
            .method("GET")
            .uri("/v1/files?path=notes/hello.txt")
            .header("authorization", "Bearer secret-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["kind"], "file");
    assert_eq!(body["content"], "hello from grok-box");
}

#[tokio::test]
async fn files_put_rejects_absolute_escape() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "PUT",
            "/v1/files",
            "secret-token",
            json!({"path":"/etc/passwd","content":"nope"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "path_escape");
}

#[tokio::test]
async fn cua_rejects_missing_auth() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .method("POST")
            .uri("/v1/cua/screenshot")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "unauthorized");
}

#[tokio::test]
async fn cua_screenshot_disabled() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .method("POST")
            .uri("/v1/cua/screenshot")
            .header("authorization", "Bearer secret-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"]["code"], "cua_disabled");
}

#[tokio::test]
async fn cua_click_disabled() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "POST",
            "/v1/cua/click",
            "secret-token",
            json!({"x": 10, "y": 10}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"]["code"], "cua_disabled");
}

#[tokio::test]
async fn cua_type_key_scroll_disabled() {
    let dir = TempDir::new().unwrap();
    let s = state(&dir);
    for (uri, payload) in [
        ("/v1/cua/type", json!({"text": "hi"})),
        ("/v1/cua/key", json!({"key": "Return"})),
        (
            "/v1/cua/scroll",
            json!({"x": 10, "y": 10, "dx": 0, "dy": 1}),
        ),
        ("/v1/cua/double-click", json!({"x": 10, "y": 10})),
        ("/v1/cua/move", json!({"x": 10, "y": 10})),
        (
            "/v1/cua/drag",
            json!({"x1": 10, "y1": 10, "x2": 20, "y2": 20}),
        ),
    ] {
        let (status, body) = send(s.clone(), auth_json("POST", uri, "secret-token", payload)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{uri}");
        assert_eq!(body["error"]["code"], "cua_disabled", "{uri}");
    }
}

#[tokio::test]
async fn cua_screenshot_png_query_still_json_error_when_disabled() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .method("POST")
            .uri("/v1/cua/screenshot?format=png")
            .header("authorization", "Bearer secret-token")
            .header("accept", "image/png")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"]["code"], "cua_disabled");
}

#[tokio::test]
async fn files_mkdir_and_delete() {
    let dir = TempDir::new().unwrap();
    let s = state(&dir);
    let (status, body) = send(
        s.clone(),
        auth_json(
            "POST",
            "/v1/files/mkdir",
            "secret-token",
            json!({"path": "notes/sub", "parents": true}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["created"], true);

    let (status, body) = send(
        s.clone(),
        auth_json(
            "PUT",
            "/v1/files",
            "secret-token",
            json!({"path": "notes/sub/a.txt", "content": "x"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bytes_written"], 1);

    let (status, body) = send(
        s.clone(),
        Request::builder()
            .method("DELETE")
            .uri("/v1/files?path=notes/sub/a.txt")
            .header("authorization", "Bearer secret-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], true);

    let (status, body) = send(
        s,
        Request::builder()
            .method("DELETE")
            .uri("/v1/files?path=notes/sub&recursive=true")
            .header("authorization", "Bearer secret-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["deleted"], true);
}

#[tokio::test]
async fn files_delete_rejects_root() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        Request::builder()
            .method("DELETE")
            .uri("/v1/files?path=")
            .header("authorization", "Bearer secret-token")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "invalid_request");
}

#[tokio::test]
async fn exec_strips_box_token_from_child_env() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "POST",
            "/v1/exec",
            "secret-token",
            json!({
                "command": ["sh", "-c", r#"if [ -n "${BOX_TOKEN+x}" ]; then echo LEAKED; else echo STRIPPED; fi"#],
                "env": {"BOX_TOKEN": "injected-secret"}
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["exit_code"], 0);
    assert!(body["stdout"].as_str().unwrap().contains("STRIPPED"));
    assert!(!body["stdout"].as_str().unwrap().contains("LEAKED"));
}

#[tokio::test]
async fn exec_closes_stdin_so_cat_exits() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "POST",
            "/v1/exec",
            "secret-token",
            json!({
                "command": ["cat"],
                "stdin": "from-stdin\n",
                "timeout_ms": 2000
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["timed_out"], false);
    assert_eq!(body["exit_code"], 0);
    assert!(body["stdout"].as_str().unwrap().contains("from-stdin"));
}

#[tokio::test]
async fn exec_timeout_keeps_stdout() {
    let dir = TempDir::new().unwrap();
    let (status, body) = send(
        state(&dir),
        auth_json(
            "POST",
            "/v1/exec",
            "secret-token",
            json!({
                "command": ["sh", "-c", "echo hello >.timeout-out; cat .timeout-out; sleep 30"],
                "timeout_ms": 500
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["timed_out"], true);
    assert!(body["exit_code"].is_null());
    assert!(
        body["stdout"].as_str().unwrap().contains("hello"),
        "timeout discarded stdout: {body}"
    );
}
