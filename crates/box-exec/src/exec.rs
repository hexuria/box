use std::process::Stdio;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::Json;
use box_common::{resolve_in_jail, ApiError};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::AppState;

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
            if parts.is_empty() || parts.iter().any(|p| p.is_empty() && parts.len() == 1) {
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
    let cwd = resolve_in_jail(&state.workspace, cwd_input)?;
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

    if let Some(env) = &req.env {
        for (key, value) in env {
            if key.is_empty() || key.contains('=') || key.contains('\0') || value.contains('\0') {
                return Err(ApiError::invalid_request(
                    "invalid environment variable name or value",
                ));
            }
            cmd.env(key, value);
        }
    }

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
        }
    }

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::internal("missing stdout pipe"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::internal("missing stderr pipe"))?;

    let max = state.max_output_bytes;
    let collect = async {
        let stdout_task = read_capped(&mut stdout, max);
        let stderr_task = read_capped(&mut stderr, max);
        let wait_task = child.wait();
        tokio::try_join!(
            async { Ok::<_, std::io::Error>(stdout_task.await) },
            async { Ok::<_, std::io::Error>(stderr_task.await) },
            wait_task
        )
    };

    let result = tokio::time::timeout(timeout, collect).await;
    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(Ok((stdout, stderr, status))) => Ok(Json(ExecResponse {
            truncated: stdout.truncated || stderr.truncated,
            stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
            stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
            exit_code: status.code(),
            timed_out: false,
            duration_ms,
            cwd: cwd.display().to_string(),
        })),
        Ok(Err(err)) => Err(ApiError::io(err.to_string())),
        Err(_) => {
            kill_process_group(&mut child);
            let _ = child.start_kill();
            let _ = child.wait().await;
            Ok(Json(ExecResponse {
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                timed_out: true,
                duration_ms,
                truncated: false,
                cwd: cwd.display().to_string(),
            }))
        }
    }
}

struct Capped {
    bytes: Vec<u8>,
    truncated: bool,
}

async fn read_capped<R: AsyncReadExt + Unpin>(reader: &mut R, max: usize) -> Capped {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                if bytes.len() >= max {
                    truncated = true;
                    continue;
                }
                let room = max.saturating_sub(bytes.len());
                let take = n.min(room);
                bytes.extend_from_slice(&buf[..take]);
                if take < n {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    Capped { bytes, truncated }
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
            workspace: std::path::PathBuf::from("/tmp"),
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
}
