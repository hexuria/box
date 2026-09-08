//! Connect-only HTTP client for a running grok-box guest.
//!
//! The caller starts the container and passes the **published** exec URL, host
//! URL, and bearer token. This crate never runs Docker and never replaces those
//! URLs with `/v1/info.endpoints` (those are container-local listen addresses).

mod error;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{Request, Uri};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub use error::Error;

type HttpClient = Client<hyper_util::client::legacy::connect::HttpConnector, Full<Bytes>>;

fn trim_slash(url: impl Into<String>) -> String {
    let url = url.into();
    url.trim().trim_end_matches('/').to_string()
}

/// Typed client. Construct with [`GrokBox::connect`].
#[derive(Clone, Debug)]
pub struct GrokBox {
    exec_url: String,
    host_url: String,
    token: String,
    http: HttpClient,
}

impl GrokBox {
    /// Connect to an already-running guest. URLs are used as given.
    pub fn connect(
        exec_url: impl Into<String>,
        host_url: impl Into<String>,
        token: impl Into<String>,
    ) -> Result<Self, Error> {
        let exec_url = trim_slash(exec_url);
        let host_url = trim_slash(host_url);
        let token = token.into();
        if exec_url.is_empty() || host_url.is_empty() || token.is_empty() {
            return Err(Error::Connect(
                "exec URL, host URL, and token are required".into(),
            ));
        }
        let http = Client::builder(TokioExecutor::new()).build_http();
        Ok(Self {
            exec_url,
            host_url,
            token,
            http,
        })
    }

    pub fn exec_url(&self) -> &str {
        &self.exec_url
    }

    pub fn host_url(&self) -> &str {
        &self.host_url
    }

    pub async fn health_exec(&self) -> Result<Value, Error> {
        self.send_json("GET", &format!("{}/v1/health", self.exec_url), None, false)
            .await
    }

    pub async fn health_host(&self) -> Result<Value, Error> {
        self.send_json("GET", &format!("{}/v1/health", self.host_url), None, false)
            .await
    }

    pub async fn ready(&self) -> Result<Value, Error> {
        self.send_json("GET", &format!("{}/v1/ready", self.host_url), None, true)
            .await
    }

    /// Capability inventory. Advertised endpoint URLs are container-local;
    /// this client keeps using the URLs passed to [`connect`](Self::connect).
    pub async fn info(&self) -> Result<Value, Error> {
        self.send_json("GET", &format!("{}/v1/info", self.host_url), None, true)
            .await
    }

    pub async fn exec(&self, request: &ExecRequest) -> Result<ExecResponse, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/exec", self.exec_url),
            Some(json!(request)),
            true,
        )
        .await
    }

    pub async fn files_get(&self, path: &str, encoding: Option<&str>) -> Result<Value, Error> {
        let mut url = format!("{}/v1/files?path={}", self.exec_url, urlencoding(path));
        if let Some(encoding) = encoding {
            url.push_str("&encoding=");
            url.push_str(&urlencoding(encoding));
        }
        self.send_json("GET", &url, None, true).await
    }

    pub async fn files_put(&self, request: &FilePutRequest) -> Result<FilePutResponse, Error> {
        self.send_json(
            "PUT",
            &format!("{}/v1/files", self.exec_url),
            Some(json!(request)),
            true,
        )
        .await
    }

    pub async fn files_delete(
        &self,
        path: &str,
        recursive: bool,
    ) -> Result<FileDeleteResponse, Error> {
        let mut url = format!("{}/v1/files?path={}", self.exec_url, urlencoding(path));
        if recursive {
            url.push_str("&recursive=true");
        }
        self.send_json("DELETE", &url, None, true).await
    }

    pub async fn files_mkdir(&self, request: &MkdirRequest) -> Result<MkdirResponse, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/files/mkdir", self.exec_url),
            Some(json!(request)),
            true,
        )
        .await
    }

    pub async fn screenshot(&self) -> Result<ScreenshotResponse, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/screenshot", self.exec_url),
            None,
            true,
        )
        .await
    }

    pub async fn screenshot_png(&self) -> Result<Vec<u8>, Error> {
        let (status, bytes, _) = self
            .send(
                "POST",
                &format!("{}/v1/cua/screenshot?format=png", self.exec_url),
                None,
                true,
                "image/png",
            )
            .await?;
        if !(200..300).contains(&status) {
            let text = String::from_utf8_lossy(&bytes);
            return Err(Error::from_status(status, &text));
        }
        Ok(bytes.to_vec())
    }

    pub async fn click(&self, x: i32, y: i32, button: Option<u8>) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/click", self.exec_url),
            Some(json!({ "x": x, "y": y, "button": button })),
            true,
        )
        .await
    }

    pub async fn double_click(&self, x: i32, y: i32, button: Option<u8>) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/double-click", self.exec_url),
            Some(json!({ "x": x, "y": y, "button": button })),
            true,
        )
        .await
    }

    pub async fn move_pointer(&self, x: i32, y: i32) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/move", self.exec_url),
            Some(json!({ "x": x, "y": y })),
            true,
        )
        .await
    }

    pub async fn drag(
        &self,
        x1: i32,
        y1: i32,
        x2: i32,
        y2: i32,
        button: Option<u8>,
    ) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/drag", self.exec_url),
            Some(json!({ "x1": x1, "y1": y1, "x2": x2, "y2": y2, "button": button })),
            true,
        )
        .await
    }

    pub async fn press(&self, x: i32, y: i32, button: Option<u8>) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/press", self.exec_url),
            Some(json!({ "x": x, "y": y, "button": button })),
            true,
        )
        .await
    }

    pub async fn release(
        &self,
        x: Option<i32>,
        y: Option<i32>,
        button: Option<u8>,
        path: Option<Vec<(i32, i32)>>,
    ) -> Result<CuaOk, Error> {
        let path = path.map(|pts| {
            pts.into_iter()
                .map(|(x, y)| json!({ "x": x, "y": y }))
                .collect::<Vec<_>>()
        });
        self.send_json(
            "POST",
            &format!("{}/v1/cua/release", self.exec_url),
            Some(json!({ "x": x, "y": y, "button": button, "path": path })),
            true,
        )
        .await
    }

    pub async fn type_text(&self, text: &str) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/type", self.exec_url),
            Some(json!({ "text": text })),
            true,
        )
        .await
    }

    pub async fn key(&self, key: &str) -> Result<CuaOk, Error> {
        self.key_action(key, None).await
    }

    pub async fn key_action(&self, key: &str, action: Option<&str>) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/key", self.exec_url),
            Some(json!({ "key": key, "action": action })),
            true,
        )
        .await
    }

    pub async fn scroll(&self, x: i32, y: i32, dx: i32, dy: i32) -> Result<CuaOk, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/scroll", self.exec_url),
            Some(json!({ "x": x, "y": y, "dx": dx, "dy": dy })),
            true,
        )
        .await
    }

    /// Run many CUA steps in one request. The guest validates the whole plan
    /// before moving the pointer.
    pub async fn recipe(&self, request: &Value) -> Result<Value, Error> {
        self.send_json(
            "POST",
            &format!("{}/v1/cua/recipe", self.exec_url),
            Some(request.clone()),
            true,
        )
        .await
    }

    async fn send_json<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        url: &str,
        body: Option<Value>,
        auth: bool,
    ) -> Result<T, Error> {
        let (status, bytes, _) = self
            .send(method, url, body, auth, "application/json")
            .await?;
        if !(200..300).contains(&status) {
            let text = String::from_utf8_lossy(&bytes);
            return Err(Error::from_status(status, &text));
        }
        serde_json::from_slice(&bytes).map_err(|err| Error::Transport(err.to_string()))
    }

    async fn send(
        &self,
        method: &str,
        url: &str,
        body: Option<Value>,
        auth: bool,
        accept: &str,
    ) -> Result<(u16, Bytes, String), Error> {
        let uri: Uri = url
            .parse()
            .map_err(|err: hyper::http::uri::InvalidUri| Error::Connect(err.to_string()))?;
        let payload = match &body {
            Some(value) => {
                serde_json::to_vec(value).map_err(|err| Error::Transport(err.to_string()))?
            }
            None => Vec::new(),
        };
        let mut builder = Request::builder().method(method).uri(uri);
        if auth {
            builder = builder.header("authorization", format!("Bearer {}", self.token));
        }
        builder = builder.header("accept", accept);
        if body.is_some() {
            builder = builder.header("content-type", "application/json");
        }
        let request = builder
            .body(Full::new(Bytes::from(payload)))
            .map_err(|err| Error::Transport(err.to_string()))?;
        let response = self
            .http
            .request(request)
            .await
            .map_err(|err| Error::Transport(err.to_string()))?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let bytes = response
            .into_body()
            .collect()
            .await
            .map_err(|err| Error::Transport(err.to_string()))?
            .to_bytes();
        Ok((status, bytes, content_type))
    }
}

fn urlencoding(value: &str) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Debug, Serialize)]
pub struct ExecRequest {
    pub command: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ExecResponse {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub truncated: bool,
    pub cwd: String,
}

#[derive(Debug, Serialize)]
pub struct FilePutRequest {
    pub path: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_dirs: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct FilePutResponse {
    pub path: String,
    pub bytes_written: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct FileDeleteResponse {
    pub path: String,
    pub deleted: bool,
}

#[derive(Debug, Serialize)]
pub struct MkdirRequest {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parents: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MkdirResponse {
    pub path: String,
    pub created: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ScreenshotResponse {
    pub encoding: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
    pub bytes: usize,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CuaOk {
    pub ok: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_requires_all_three() {
        assert!(GrokBox::connect("", "http://127.0.0.1:1340", "t").is_err());
        assert!(GrokBox::connect("http://127.0.0.1:1337", "", "t").is_err());
        assert!(GrokBox::connect("http://127.0.0.1:1337", "http://127.0.0.1:1340", "").is_err());
        let box_client =
            GrokBox::connect("http://127.0.0.1:1337/", "http://127.0.0.1:1340/", "tok").unwrap();
        assert_eq!(box_client.exec_url(), "http://127.0.0.1:1337");
        assert_eq!(box_client.host_url(), "http://127.0.0.1:1340");
    }
}
