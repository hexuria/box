use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use box_common::{new_prefixed_id, resolve_in_canonical_jail, ApiError};
use bytes::Bytes;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::{AppState, DetachedJob};

const STRIP_ENV: &[&str] = &["BOX_TOKEN", "BOX_HOST_TOKEN", "BOX_VNC_PASSWORD"];
const MAX_DETACHED_JOBS: usize = 64;

/// Sensible tty-ish defaults so `clear`, `tput`, and color-aware tools work
/// even though exec is a pipe, not a PTY. Callers can override via `env`.
const DEFAULT_CHILD_ENV: &[(&str, &str)] = &[
    ("TERM", "xterm-256color"),
    ("COLORTERM", "truecolor"),
    ("COLUMNS", "120"),
    ("LINES", "32"),
];

#[derive(Debug, Deserialize)]
pub struct ExecRequest {
    /// Argv (`["echo","ok"]`) or a shell string (`"echo ok"` → `/bin/sh -c`).
    pub command: CommandSpec,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub env: Option<HashMap<String, String>>,
    pub stdin: Option<String>,
    /// Deferred. PTY exec is not implemented; use `/v1/exec/stream`.
    pub pty: Option<bool>,
    /// Return immediately; poll `GET /v1/exec/{id}`.
    pub detach: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum CommandSpec {
    Argv(Vec<String>),
    Shell(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecResponse {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub truncated: bool,
    pub cwd: String,
    pub exec_id: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub detached: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StreamEvent {
    Stdout {
        data: String,
    },
    Stderr {
        data: String,
    },
    Exit {
        exec_id: String,
        exit_code: Option<i32>,
        timed_out: bool,
        duration_ms: u64,
        truncated: bool,
        cwd: String,
    },
}

struct Prepared {
    argv: Vec<String>,
    cwd: PathBuf,
    timeout: Duration,
    env: Option<HashMap<String, String>>,
    stdin: Option<String>,
    exec_id: String,
}

struct SlotGuard {
    _permit: tokio::sync::OwnedSemaphorePermit,
    inflight: Arc<std::sync::atomic::AtomicUsize>,
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        self.inflight.fetch_sub(1, Ordering::Relaxed);
    }
}

pub async fn handle(
    State(state): State<AppState>,
    Json(req): Json<ExecRequest>,
) -> Result<Json<ExecResponse>, ApiError> {
    reject_pty(&req)?;
    let detach = req.detach.unwrap_or(false);
    let prepared = prepare(&state, req)?;
    if detach {
        return detach_run(state, prepared).await;
    }
    let _slot = admit(&state)?;
    Ok(Json(run_blocking(&state, prepared).await?))
}

pub async fn handle_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ExecRequest>,
) -> Result<Response, ApiError> {
    reject_pty(&req)?;
    let sse = wants_sse(&headers);
    let prepared = prepare(&state, req)?;
    let slot = admit(&state)?;
    let (tx, rx) = mpsc::channel::<StreamEvent>(64);
    let exec_id = prepared.exec_id.clone();
    let cwd_display = prepared.cwd.display().to_string();
    let kill_grace = state.kill_grace;
    let max_output = state.max_output_bytes;

    tokio::spawn(async move {
        let _slot = slot;
        if let Err(err) = stream_child(prepared, kill_grace, max_output, tx.clone()).await {
            let _ = tx
                .send(StreamEvent::Stderr {
                    data: format!("exec failed: {err}"),
                })
                .await;
            let _ = tx
                .send(StreamEvent::Exit {
                    exec_id,
                    exit_code: None,
                    timed_out: false,
                    duration_ms: 0,
                    truncated: false,
                    cwd: cwd_display,
                })
                .await;
        }
    });

    let stream = ReceiverStream::new(rx).map(move |evt| {
        let payload = serde_json::to_vec(&evt).unwrap_or_else(|_| b"{}".to_vec());
        let bytes = if sse {
            let mut v = b"data: ".to_vec();
            v.extend_from_slice(&payload);
            v.extend_from_slice(b"\n\n");
            Bytes::from(v)
        } else {
            let mut v = payload;
            v.push(b'\n');
            Bytes::from(v)
        };
        Ok::<_, std::io::Error>(bytes)
    });
    let ctype = if sse {
        "text/event-stream"
    } else {
        "application/x-ndjson"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, ctype)
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(stream))
        .map_err(|err| ApiError::internal(err.to_string()))
}

pub async fn status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ExecResponse>, ApiError> {
    let jobs = state.jobs.lock().await;
    let job = jobs
        .get(&id)
        .ok_or_else(|| ApiError::not_found("exec id not found"))?;
    if let Some(result) = job.result.clone() {
        return Ok(Json(result));
    }
    Ok(Json(ExecResponse {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: None,
        timed_out: false,
        duration_ms: 0,
        truncated: false,
        cwd: String::new(),
        exec_id: id,
        detached: true,
        status: Some(job.status),
    }))
}

fn reject_pty(req: &ExecRequest) -> Result<(), ApiError> {
    if req.pty.unwrap_or(false) {
        return Err(ApiError::invalid_request(
            "pty exec is not implemented; use POST /v1/exec/stream for incremental stdout/stderr",
        ));
    }
    Ok(())
}

fn wants_sse(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(',')
        .any(|p| p.trim().starts_with("text/event-stream"))
}

fn admit(state: &AppState) -> Result<SlotGuard, ApiError> {
    match state.exec_slots.clone().try_acquire_owned() {
        Ok(permit) => {
            state.execs_in_flight.fetch_add(1, Ordering::Relaxed);
            state.execs_started.fetch_add(1, Ordering::Relaxed);
            Ok(SlotGuard {
                _permit: permit,
                inflight: state.execs_in_flight.clone(),
            })
        }
        Err(_) => Err(ApiError::busy(format!(
            "too many concurrent execs (max {})",
            state.max_concurrent_execs
        ))),
    }
}

fn prepare(state: &AppState, req: ExecRequest) -> Result<Prepared, ApiError> {
    let argv = match req.command {
        CommandSpec::Argv(parts) => {
            if parts.is_empty() {
                return Err(ApiError::invalid_request("command argv must not be empty"));
            }
            if parts[0].is_empty() {
                return Err(ApiError::invalid_request("command[0] must not be empty"));
            }
            parts
        }
        CommandSpec::Shell(script) => {
            if script.is_empty() {
                return Err(ApiError::invalid_request("command must not be empty"));
            }
            vec!["/bin/sh".to_string(), "-c".to_string(), script]
        }
    };

    let cwd_input = req.cwd.as_deref().unwrap_or("");
    let cwd = resolve_in_canonical_jail(&state.workspace, cwd_input)?;
    if !cwd.is_dir() {
        return Err(ApiError::invalid_request(format!(
            "cwd is not a directory: {}",
            cwd.display()
        )));
    }

    Ok(Prepared {
        argv,
        cwd,
        timeout: clamp_timeout(state, req.timeout_ms),
        env: req.env,
        stdin: req.stdin,
        exec_id: new_prefixed_id("exec"),
    })
}

async fn detach_run(state: AppState, prepared: Prepared) -> Result<Json<ExecResponse>, ApiError> {
    let slot = admit(&state)?;
    let exec_id = prepared.exec_id.clone();
    let cwd = prepared.cwd.display().to_string();
    {
        let mut jobs = state.jobs.lock().await;
        prune_jobs(&mut jobs);
        jobs.insert(
            exec_id.clone(),
            DetachedJob {
                status: "running",
                result: None,
            },
        );
    }
    let state_clone = state.clone();
    tokio::spawn(async move {
        let _slot = slot;
        let id = prepared.exec_id.clone();
        let result = run_blocking(&state_clone, prepared).await;
        let mut jobs = state_clone.jobs.lock().await;
        match result {
            Ok(mut response) => {
                response.detached = true;
                response.status = Some("done");
                jobs.insert(
                    id,
                    DetachedJob {
                        status: "done",
                        result: Some(response),
                    },
                );
            }
            Err(err) => {
                jobs.insert(
                    id.clone(),
                    DetachedJob {
                        status: "done",
                        result: Some(ExecResponse {
                            stdout: String::new(),
                            stderr: err.to_string(),
                            exit_code: None,
                            timed_out: false,
                            duration_ms: 0,
                            truncated: false,
                            cwd: String::new(),
                            exec_id: id,
                            detached: true,
                            status: Some("error"),
                        }),
                    },
                );
            }
        }
    });
    Ok(Json(ExecResponse {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: None,
        timed_out: false,
        duration_ms: 0,
        truncated: false,
        cwd,
        exec_id,
        detached: true,
        status: Some("running"),
    }))
}

fn prune_jobs(jobs: &mut HashMap<String, DetachedJob>) {
    if jobs.len() < MAX_DETACHED_JOBS {
        return;
    }
    let done: Vec<String> = jobs
        .iter()
        .filter(|(_, j)| j.status != "running")
        .map(|(k, _)| k.clone())
        .collect();
    for k in done {
        jobs.remove(&k);
        if jobs.len() < MAX_DETACHED_JOBS {
            break;
        }
    }
}

async fn run_blocking(state: &AppState, prepared: Prepared) -> Result<ExecResponse, ApiError> {
    let exec_id = prepared.exec_id.clone();
    let cwd_display = prepared.cwd.display().to_string();
    let mut child = spawn_child(
        prepared.argv,
        &prepared.cwd,
        prepared.env,
        prepared.stdin.is_some(),
    )?;
    if let Some(data) = prepared.stdin {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(data.as_bytes())
                .await
                .map_err(|err| ApiError::io(err.to_string()))?;
            stdin
                .shutdown()
                .await
                .map_err(|err| ApiError::io(err.to_string()))?;
        }
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::internal("missing stdout pipe"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::internal("missing stderr pipe"))?;

    let max = state.max_output_bytes;
    let stdout_task = tokio::spawn(fill_capped(stdout, max));
    let stderr_task = tokio::spawn(fill_capped(stderr, max));
    let started = Instant::now();

    let (timed_out, exit_code) = wait_or_kill(child, prepared.timeout, state.kill_grace).await?;
    let duration_ms = started.elapsed().as_millis() as u64;

    let drain = async {
        let stdout = stdout_task.await.unwrap_or_else(|_| Capped::default());
        let stderr = stderr_task.await.unwrap_or_else(|_| Capped::default());
        (stdout, stderr)
    };
    let (stdout, stderr) = tokio::time::timeout(Duration::from_secs(2), drain)
        .await
        .unwrap_or_default();

    Ok(ExecResponse {
        truncated: stdout.truncated || stderr.truncated,
        stdout: bytes_to_string(stdout.bytes),
        stderr: bytes_to_string(stderr.bytes),
        exit_code,
        timed_out,
        duration_ms,
        cwd: cwd_display,
        exec_id,
        detached: false,
        status: None,
    })
}

async fn stream_child(
    prepared: Prepared,
    kill_grace: Duration,
    max_output: usize,
    tx: mpsc::Sender<StreamEvent>,
) -> Result<(), ApiError> {
    let exec_id = prepared.exec_id.clone();
    let cwd_display = prepared.cwd.display().to_string();
    let mut child = spawn_child(
        prepared.argv,
        &prepared.cwd,
        prepared.env,
        prepared.stdin.is_some(),
    )?;
    if let Some(data) = prepared.stdin {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(data.as_bytes())
                .await
                .map_err(|err| ApiError::io(err.to_string()))?;
            stdin
                .shutdown()
                .await
                .map_err(|err| ApiError::io(err.to_string()))?;
        }
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::internal("missing stdout pipe"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::internal("missing stderr pipe"))?;

    let tx_out = tx.clone();
    let tx_err = tx.clone();
    let out_task = tokio::spawn(pump_stream(stdout, max_output, true, tx_out));
    let err_task = tokio::spawn(pump_stream(stderr, max_output, false, tx_err));
    let started = Instant::now();
    let (timed_out, exit_code) = wait_or_kill(child, prepared.timeout, kill_grace).await?;
    let duration_ms = started.elapsed().as_millis() as u64;
    let out_trunc = out_task.await.unwrap_or(false);
    let err_trunc = err_task.await.unwrap_or(false);
    let _ = tx
        .send(StreamEvent::Exit {
            exec_id,
            exit_code,
            timed_out,
            duration_ms,
            truncated: out_trunc || err_trunc,
            cwd: cwd_display,
        })
        .await;
    Ok(())
}

async fn pump_stream<R: AsyncReadExt + Unpin>(
    mut reader: R,
    max: usize,
    is_stdout: bool,
    tx: mpsc::Sender<StreamEvent>,
) -> bool {
    let mut seen = 0usize;
    let mut truncated = false;
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if seen >= max {
                    truncated = true;
                    continue;
                }
                let room = max.saturating_sub(seen);
                let take = n.min(room);
                seen += take;
                if take < n {
                    truncated = true;
                }
                let data = String::from_utf8_lossy(&buf[..take]).into_owned();
                let evt = if is_stdout {
                    StreamEvent::Stdout { data }
                } else {
                    StreamEvent::Stderr { data }
                };
                if tx.send(evt).await.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    truncated
}

fn spawn_child(
    argv: Vec<String>,
    cwd: &std::path::Path,
    env: Option<HashMap<String, String>>,
    has_stdin: bool,
) -> Result<tokio::process::Child, ApiError> {
    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..])
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if has_stdin {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    apply_child_env(&mut cmd, env.as_ref())?;
    #[cfg(unix)]
    cmd.process_group(0);
    cmd.spawn().map_err(|err| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "exec_failed",
            format!("failed to spawn command: {err}"),
        )
    })
}

async fn wait_or_kill(
    mut child: tokio::process::Child,
    timeout: Duration,
    kill_grace: Duration,
) -> Result<(bool, Option<i32>), ApiError> {
    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => Ok((false, status.code())),
        Ok(Err(err)) => Err(ApiError::io(err.to_string())),
        Err(_) => {
            signal_process_group(&mut child, term_signal());
            match tokio::time::timeout(kill_grace, child.wait()).await {
                Ok(Ok(status)) => Ok((true, status.code())),
                Ok(Err(err)) => Err(ApiError::io(err.to_string())),
                Err(_) => {
                    signal_process_group(&mut child, kill_signal());
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    Ok((true, None))
                }
            }
        }
    }
}

fn term_signal() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGTERM
    }
    #[cfg(not(unix))]
    {
        15
    }
}

fn kill_signal() -> i32 {
    #[cfg(unix)]
    {
        libc::SIGKILL
    }
    #[cfg(not(unix))]
    {
        9
    }
}

fn apply_child_env(
    cmd: &mut Command,
    extra: Option<&HashMap<String, String>>,
) -> Result<(), ApiError> {
    for key in STRIP_ENV {
        cmd.env_remove(key);
    }
    for (key, value) in DEFAULT_CHILD_ENV {
        let overridden = extra
            .map(|env| env.keys().any(|k| k.eq_ignore_ascii_case(key)))
            .unwrap_or(false);
        if !overridden {
            cmd.env(*key, *value);
        }
    }
    if let Some(env) = extra {
        for (key, value) in env {
            if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
                return Err(ApiError::invalid_request(
                    "invalid environment variable name or value",
                ));
            }
            if is_secret_key(key) {
                continue;
            }
            cmd.env(key, value);
        }
    }
    for key in STRIP_ENV {
        cmd.env_remove(key);
    }
    Ok(())
}

fn is_secret_key(key: &str) -> bool {
    STRIP_ENV
        .iter()
        .any(|secret| secret.eq_ignore_ascii_case(key))
}

#[derive(Default)]
struct Capped {
    bytes: Vec<u8>,
    truncated: bool,
}

async fn fill_capped<R: AsyncReadExt + Unpin>(mut reader: R, max: usize) -> Capped {
    let mut cap = Capped::default();
    cap.bytes.reserve(8192.min(max));
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if cap.bytes.len() >= max {
                    cap.truncated = true;
                    continue;
                }
                let room = max.saturating_sub(cap.bytes.len());
                let take = n.min(room);
                cap.bytes.extend_from_slice(&buf[..take]);
                if take < n {
                    cap.truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    cap
}

fn bytes_to_string(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes)
        .unwrap_or_else(|err| String::from_utf8_lossy(err.as_bytes()).into_owned())
}

fn clamp_timeout(state: &AppState, requested: Option<u64>) -> Duration {
    let requested = requested
        .map(Duration::from_millis)
        .unwrap_or(state.default_timeout);
    if requested < Duration::from_millis(1) {
        Duration::from_millis(1)
    } else if requested > state.max_timeout {
        state.max_timeout
    } else {
        requested
    }
}

fn signal_process_group(child: &mut tokio::process::Child, sig: i32) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        let pgid = pid as i32;
        // Safety: `cmd.process_group(0)` put this child in its own group.
        unsafe {
            libc::kill(-pgid, sig);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = sig;
        let _ = child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppState;

    #[test]
    fn clamp_respects_max() {
        let dir = tempfile::TempDir::new().unwrap();
        let state = AppState::for_test(dir.path().canonicalize().unwrap(), "t");
        let mut state = state;
        state.max_timeout = Duration::from_secs(60);
        state.default_timeout = Duration::from_secs(30);
        assert_eq!(
            clamp_timeout(&state, Some(120_000)),
            Duration::from_secs(60)
        );
        assert_eq!(clamp_timeout(&state, Some(0)), Duration::from_millis(1));
    }

    #[test]
    fn secret_keys_are_detected() {
        assert!(is_secret_key("BOX_TOKEN"));
        assert!(is_secret_key("box_token"));
        assert!(is_secret_key("BOX_HOST_TOKEN"));
        assert!(is_secret_key("BOX_VNC_PASSWORD"));
        assert!(!is_secret_key("PATH"));
        assert!(!is_secret_key("TERM"));
    }
}
