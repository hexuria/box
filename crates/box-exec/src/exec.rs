use std::process::Stdio;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::Json;
use box_common::{resolve_in_canonical_jail, ApiError};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::AppState;

const STRIP_ENV: &[&str] = &["BOX_TOKEN", "BOX_HOST_TOKEN", "BOX_VNC_PASSWORD"];

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
    pub env: Option<std::collections::HashMap<String, String>>,
    pub stdin: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum CommandSpec {
    Argv(Vec<String>),
    Shell(String),
}

#[derive(Debug, Serialize)]
pub struct ExecResponse {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub duration_ms: u64,
    pub truncated: bool,
    pub cwd: String,
}

pub async fn handle(
    State(state): State<AppState>,
    Json(req): Json<ExecRequest>,
) -> Result<Json<ExecResponse>, ApiError> {
    let argv = match req.command {
        CommandSpec::Argv(parts) => {
            if parts.is_empty() {
                return Err(ApiError::invalid_request("command argv must not be empty"));
            }
            // SAFETY: `parts` is non-empty.
            if unsafe { parts.get_unchecked(0) }.is_empty() {
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

    let timeout = clamp_timeout(&state, req.timeout_ms);
    let started = Instant::now();

    let mut cmd = Command::new(&argv[0]);
    cmd.args(&argv[1..])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if req.stdin.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }

    apply_child_env(&mut cmd, req.env.as_ref())?;

    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn().map_err(|err| {
        ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "exec_failed",
            format!("failed to spawn command: {err}"),
        )
    })?;

    if let Some(data) = req.stdin {
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

    let wait_result = tokio::time::timeout(timeout, child.wait()).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    let (timed_out, exit_code) = match wait_result {
        Ok(Ok(status)) => (false, status.code()),
        Ok(Err(err)) => {
            stdout_task.abort();
            stderr_task.abort();
            return Err(ApiError::io(err.to_string()));
        }
        Err(_) => {
            kill_process_group(&mut child);
            let _ = child.start_kill();
            let _ = child.wait().await;
            (true, None)
        }
    };

    let drain = async {
        let stdout = stdout_task.await.unwrap_or_else(|_| Capped::default());
        let stderr = stderr_task.await.unwrap_or_else(|_| Capped::default());
        (stdout, stderr)
    };
    let (stdout, stderr) = tokio::time::timeout(Duration::from_secs(2), drain)
        .await
        .unwrap_or_default();

    Ok(Json(ExecResponse {
        truncated: stdout.truncated || stderr.truncated,
        stdout: bytes_to_string(stdout.bytes),
        stderr: bytes_to_string(stderr.bytes),
        exit_code,
        timed_out,
        duration_ms,
        cwd: cwd.display().to_string(),
    }))
}

fn apply_child_env(
    cmd: &mut Command,
    extra: Option<&std::collections::HashMap<String, String>>,
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

fn kill_process_group(child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        let pgid = pid as i32;
        // Safety: `cmd.process_group(0)` put this child in its own group,
        // so `-pgid` signals only that group (not box-exec). `pid` came from
        // `Child::id` for this spawn and is still the live group leader until
        // wait reaps it.
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use box_cua::CuaConfig;

    #[test]
    fn clamp_respects_max() {
        let state = AppState {
            workspace: std::path::PathBuf::from("/tmp").canonicalize().unwrap(),
            token: "t".into(),
            max_file_bytes: 1,
            default_timeout: Duration::from_secs(30),
            max_timeout: Duration::from_secs(60),
            max_output_bytes: 8,
            cua: CuaConfig::disabled(),
        };
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
