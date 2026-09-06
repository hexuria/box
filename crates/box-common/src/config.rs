use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use crate::DEV_BOX_TOKEN;

/// Process-wide configuration shared by `box-exec` and `box-host`.
#[derive(Clone, Debug)]
pub struct BoxConfig {
    pub box_id: String,
    pub token: String,
    pub host_token: String,
    pub workspace: PathBuf,
    pub exec_bind: SocketAddr,
    pub host_bind: SocketAddr,
    pub exec_url: String,
    pub max_file_bytes: u64,
    pub default_timeout: Duration,
    pub max_timeout: Duration,
    pub max_output_bytes: usize,
}

impl BoxConfig {
    pub fn from_env() -> Self {
        let token = env_nonempty("BOX_TOKEN").unwrap_or_else(|| {
            tracing::warn!(
                "BOX_TOKEN is unset; using {} (local development only)",
                DEV_BOX_TOKEN
            );
            DEV_BOX_TOKEN.to_string()
        });
        let host_token = env_nonempty("BOX_HOST_TOKEN").unwrap_or_else(|| token.clone());
        let workspace = PathBuf::from(env::var("WORKSPACE_ROOT").unwrap_or_else(|_| {
            if std::path::Path::new("/workspace").is_dir() {
                "/workspace".into()
            } else {
                "./workspace-data".into()
            }
        }));
        Self {
            box_id: default_box_id(),
            token,
            host_token,
            workspace,
            exec_bind: parse_addr("BOX_EXEC_BIND", "0.0.0.0:1337"),
            host_bind: parse_addr("BOX_HOST_BIND", "0.0.0.0:1340"),
            exec_url: env::var("BOX_EXEC_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:1337".to_string()),
            max_file_bytes: parse_u64("BOX_MAX_FILE_BYTES", 10 * 1024 * 1024),
            default_timeout: Duration::from_millis(parse_u64("BOX_DEFAULT_TIMEOUT_MS", 30_000)),
            max_timeout: Duration::from_millis(parse_u64("BOX_MAX_TIMEOUT_MS", 10 * 60 * 1000)),
            max_output_bytes: parse_u64("BOX_MAX_OUTPUT_BYTES", 8 * 1024 * 1024) as usize,
        }
    }
}

fn env_nonempty(var: &str) -> Option<String> {
    env::var(var).ok().filter(|s| !s.is_empty())
}

fn default_box_id() -> String {
    env::var("BOX_ID")
        .or_else(|_| env::var("HOSTNAME"))
        .or_else(|_| std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string()))
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "grok-box".to_string())
}

fn parse_addr(var: &str, default: &str) -> SocketAddr {
    env::var(var)
        .unwrap_or_else(|_| default.to_string())
        .parse()
        .unwrap_or_else(|_| default.parse().expect("hardcoded bind addr"))
}

fn parse_u64(var: &str, default: u64) -> u64 {
    env::var(var)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_box_id_never_empty() {
        assert!(!default_box_id().is_empty());
    }
}
