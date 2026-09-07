use std::env;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;

use crate::DEV_BOX_TOKEN;

/// Minimum accepted length for `BOX_TOKEN` / `BOX_HOST_TOKEN` unless
/// `BOX_ALLOW_INSECURE_DEV=1` and both daemon binds are loopback.
pub const MIN_TOKEN_LEN: usize = 16;

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

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("{0}")]
pub struct ConfigError(pub String);

impl BoxConfig {
    /// Load config from the environment, then drop bearer/VNC secrets from
    /// this process's environ so they are not visible in `/proc/self/environ`.
    pub fn from_env() -> Result<Self, ConfigError> {
        let token = env_nonempty("BOX_TOKEN").ok_or_else(|| {
            ConfigError("BOX_TOKEN must be set and non-empty".into())
        })?;
        let host_token = env_nonempty("BOX_HOST_TOKEN").unwrap_or_else(|| token.clone());
        let exec_bind = parse_addr("BOX_EXEC_BIND", "127.0.0.1:1337");
        let host_bind = parse_addr("BOX_HOST_BIND", "127.0.0.1:1340");

        validate_token("BOX_TOKEN", &token, exec_bind, host_bind)?;
        if host_token != token {
            validate_token("BOX_HOST_TOKEN", &host_token, exec_bind, host_bind)?;
        }

        let workspace = PathBuf::from(env::var("WORKSPACE_ROOT").unwrap_or_else(|_| {
            if std::path::Path::new("/workspace").is_dir() {
                "/workspace".into()
            } else {
                "./workspace-data".into()
            }
        }));

        let config = Self {
            box_id: default_box_id(),
            token,
            host_token,
            workspace,
            exec_bind,
            host_bind,
            exec_url: env::var("BOX_EXEC_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:1337".to_string()),
            max_file_bytes: parse_u64("BOX_MAX_FILE_BYTES", 10 * 1024 * 1024),
            default_timeout: Duration::from_millis(parse_u64("BOX_DEFAULT_TIMEOUT_MS", 30_000)),
            max_timeout: Duration::from_millis(parse_u64("BOX_MAX_TIMEOUT_MS", 10 * 60 * 1000)),
            max_output_bytes: parse_u64("BOX_MAX_OUTPUT_BYTES", 8 * 1024 * 1024) as usize,
        };

        wipe_secret_environ();
        Ok(config)
    }
}

/// Names removed from the daemon process environment after config load.
pub const SECRET_ENV_KEYS: &[&str] = &["BOX_TOKEN", "BOX_HOST_TOKEN", "BOX_VNC_PASSWORD"];

/// Drop secrets from this process's environment. Call after copying values
/// into memory. Does not affect child processes already spawned.
pub fn wipe_secret_environ() {
    for key in SECRET_ENV_KEYS {
        env::remove_var(key);
    }
}

fn validate_token(
    name: &str,
    token: &str,
    exec_bind: SocketAddr,
    host_bind: SocketAddr,
) -> Result<(), ConfigError> {
    if !token_is_insecure(token) {
        return Ok(());
    }
    if allow_insecure_dev() && binds_are_loopback(exec_bind, host_bind) {
        tracing::warn!(
            "{name} is a well-known, empty, or short value; accepted because BOX_ALLOW_INSECURE_DEV=1 and binds are loopback"
        );
        return Ok(());
    }
    Err(ConfigError(format!(
        "{name} is missing, shorter than {MIN_TOKEN_LEN} characters, or a well-known insecure value ({DEV_BOX_TOKEN}). Set a long random token, or BOX_ALLOW_INSECURE_DEV=1 with loopback BOX_EXEC_BIND and BOX_HOST_BIND for local demos."
    )))
}

pub fn token_is_insecure(token: &str) -> bool {
    token.is_empty() || token.len() < MIN_TOKEN_LEN || token == DEV_BOX_TOKEN
}

fn allow_insecure_dev() -> bool {
    env::var("BOX_ALLOW_INSECURE_DEV").ok().as_deref() == Some("1")
}

fn binds_are_loopback(exec_bind: SocketAddr, host_bind: SocketAddr) -> bool {
    ip_is_loopback(exec_bind.ip()) && ip_is_loopback(host_bind.ip())
}

fn ip_is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
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
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        saved: Vec<(String, Option<String>)>,
    }

    impl EnvGuard {
        fn apply(pairs: &[(&str, Option<&str>)]) -> Self {
            let saved = pairs
                .iter()
                .map(|(key, value)| {
                    let prev = env::var(key).ok();
                    match value {
                        Some(v) => env::set_var(key, v),
                        None => env::remove_var(key),
                    }
                    ((*key).to_string(), prev)
                })
                .collect();
            Self { saved }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, prev) in &self.saved {
                match prev {
                    Some(v) => env::set_var(key, v),
                    None => env::remove_var(key),
                }
            }
        }
    }

    fn isolate(pairs: &[(&str, Option<&str>)]) -> (std::sync::MutexGuard<'static, ()>, EnvGuard) {
        let lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        (lock, EnvGuard::apply(pairs))
    }

    #[test]
    fn default_box_id_never_empty() {
        assert!(!default_box_id().is_empty());
    }

    #[test]
    fn token_is_insecure_flags_known_bad_values() {
        assert!(token_is_insecure(""));
        assert!(token_is_insecure("short"));
        assert!(token_is_insecure(DEV_BOX_TOKEN));
        assert!(!token_is_insecure("local-smoke-box-token"));
    }

    #[test]
    fn from_env_requires_token() {
        let (_lock, _guard) = isolate(&[
            ("BOX_TOKEN", None),
            ("BOX_HOST_TOKEN", None),
            ("BOX_VNC_PASSWORD", None),
            ("BOX_ALLOW_INSECURE_DEV", None),
            ("BOX_EXEC_BIND", Some("127.0.0.1:1337")),
            ("BOX_HOST_BIND", Some("127.0.0.1:1340")),
        ]);
        let err = BoxConfig::from_env().unwrap_err();
        assert!(err.0.contains("BOX_TOKEN must be set"), "{err}");
    }

    #[test]
    fn from_env_rejects_dev_token_without_opt_in() {
        let (_lock, _guard) = isolate(&[
            ("BOX_TOKEN", Some(DEV_BOX_TOKEN)),
            ("BOX_HOST_TOKEN", None),
            ("BOX_VNC_PASSWORD", Some("vncpass1")),
            ("BOX_ALLOW_INSECURE_DEV", None),
            ("BOX_EXEC_BIND", Some("127.0.0.1:1337")),
            ("BOX_HOST_BIND", Some("127.0.0.1:1340")),
        ]);
        let err = BoxConfig::from_env().unwrap_err();
        assert!(err.0.contains("insecure"), "{err}");
    }

    #[test]
    fn from_env_rejects_insecure_token_on_unspecified_bind_even_with_opt_in() {
        let (_lock, _guard) = isolate(&[
            ("BOX_TOKEN", Some(DEV_BOX_TOKEN)),
            ("BOX_HOST_TOKEN", None),
            ("BOX_VNC_PASSWORD", Some("vncpass1")),
            ("BOX_ALLOW_INSECURE_DEV", Some("1")),
            ("BOX_EXEC_BIND", Some("0.0.0.0:1337")),
            ("BOX_HOST_BIND", Some("0.0.0.0:1340")),
        ]);
        let err = BoxConfig::from_env().unwrap_err();
        assert!(err.0.contains("loopback"), "{err}");
    }

    #[test]
    fn from_env_allows_insecure_token_on_loopback_with_opt_in() {
        let (_lock, _guard) = isolate(&[
            ("BOX_TOKEN", Some(DEV_BOX_TOKEN)),
            ("BOX_HOST_TOKEN", None),
            ("BOX_VNC_PASSWORD", Some("vncpass1")),
            ("BOX_ALLOW_INSECURE_DEV", Some("1")),
            ("BOX_EXEC_BIND", Some("127.0.0.1:1337")),
            ("BOX_HOST_BIND", Some("127.0.0.1:1340")),
            ("WORKSPACE_ROOT", Some("/tmp")),
        ]);
        let config = BoxConfig::from_env().unwrap();
        assert_eq!(config.token, DEV_BOX_TOKEN);
        assert!(env::var("BOX_TOKEN").is_err());
        assert!(env::var("BOX_VNC_PASSWORD").is_err());
    }

    #[test]
    fn from_env_accepts_long_token_and_wipes_environ() {
        let (_lock, _guard) = isolate(&[
            ("BOX_TOKEN", Some("local-smoke-box-token")),
            ("BOX_HOST_TOKEN", Some("local-smoke-host-token")),
            ("BOX_VNC_PASSWORD", Some("vncpass1")),
            ("BOX_ALLOW_INSECURE_DEV", None),
            ("BOX_EXEC_BIND", Some("0.0.0.0:1337")),
            ("BOX_HOST_BIND", Some("0.0.0.0:1340")),
            ("WORKSPACE_ROOT", Some("/tmp")),
        ]);
        let config = BoxConfig::from_env().unwrap();
        assert_eq!(config.token, "local-smoke-box-token");
        assert_eq!(config.host_token, "local-smoke-host-token");
        assert_eq!(config.exec_bind, "0.0.0.0:1337".parse().unwrap());
        assert!(env::var("BOX_TOKEN").is_err());
        assert!(env::var("BOX_HOST_TOKEN").is_err());
        assert!(env::var("BOX_VNC_PASSWORD").is_err());
    }

    #[test]
    fn rust_default_bind_is_loopback() {
        let addr: SocketAddr = parse_addr("BOX_EXEC_BIND_MISSING_FOR_TEST", "127.0.0.1:1337");
        assert!(addr.ip().is_loopback());
    }
}
