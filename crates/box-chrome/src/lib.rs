//! Chromium launch metadata for the Linux Grok Box image.
//!
//! Chrome (or Chromium) is started by `docker/entrypoint.sh` on `DISPLAY=:1`.
//! The profile lives at `/home/box/chrome-profile` (compose volume). Optional
//! Chrome DevTools Protocol listens on **localhost only**.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Default Chromium `--user-data-dir`.
pub const DEFAULT_PROFILE: &str = "/home/box/chrome-profile";

/// CDP is never published; agents inside the box talk to this loopback port.
pub const DEFAULT_CDP_PORT: u16 = 9222;

pub const PID_FILE: &str = "/tmp/box-chrome.pid";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChromeConfig {
    pub enabled: bool,
    pub profile: PathBuf,
    pub cdp_port: u16,
    pub display: String,
}

impl ChromeConfig {
    pub fn from_env() -> Self {
        let enabled = env_truthy("BOX_CHROME").unwrap_or(true);
        let profile = std::env::var("BOX_CHROME_PROFILE")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_PROFILE));
        let cdp_port = std::env::var("BOX_CDP_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_CDP_PORT);
        let display = std::env::var("BOX_DISPLAY").unwrap_or_else(|_| ":1".into());
        Self {
            enabled,
            profile,
            cdp_port,
            display,
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            profile: PathBuf::from(DEFAULT_PROFILE),
            cdp_port: DEFAULT_CDP_PORT,
            display: ":1".into(),
        }
    }

    pub fn cdp_bind(&self) -> String {
        format!("127.0.0.1:{}", self.cdp_port)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChromeStatus {
    pub enabled: bool,
    pub running: bool,
    pub profile: String,
    pub cdp: Option<String>,
    pub display: String,
}

pub fn probe_chrome(cfg: &ChromeConfig) -> ChromeStatus {
    if !cfg.enabled {
        return ChromeStatus {
            enabled: false,
            running: false,
            profile: cfg.profile.display().to_string(),
            cdp: None,
            display: cfg.display.clone(),
        };
    }
    let running = pidfile_alive(Path::new(PID_FILE)) || chromium_on_display(&cfg.display);
    ChromeStatus {
        enabled: true,
        running,
        profile: cfg.profile.display().to_string(),
        cdp: Some(cfg.cdp_bind()),
        display: cfg.display.clone(),
    }
}

fn pidfile_alive(path: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return false;
    };
    let Ok(pid) = raw.trim().parse::<u32>() else {
        return false;
    };
    Path::new(&format!("/proc/{pid}")).exists()
}

/// Fallback when the pidfile is missing: look for a chromium/chrome cmdline
/// that mentions the configured DISPLAY.
fn chromium_on_display(display: &str) -> bool {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    for entry in entries.flatten() {
        let pid = entry.file_name();
        let pid = pid.to_string_lossy();
        if !pid.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
        let text = String::from_utf8_lossy(&cmdline);
        let is_chrome = text.contains("chromium") || text.contains("chrome");
        if is_chrome && (text.contains(display) || display_env_matches(pid.as_ref(), display)) {
            return true;
        }
    }
    false
}

fn display_env_matches(pid: &str, display: &str) -> bool {
    let Ok(env) = std::fs::read(format!("/proc/{pid}/environ")) else {
        return false;
    };
    String::from_utf8_lossy(&env).contains(&format!("DISPLAY={display}"))
}

fn env_truthy(key: &str) -> Option<bool> {
    std::env::var(key)
        .ok()
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_is_not_running() {
        let st = probe_chrome(&ChromeConfig::disabled());
        assert!(!st.enabled);
        assert!(!st.running);
        assert!(st.cdp.is_none());
    }

    #[test]
    fn cdp_is_loopback_only() {
        let cfg = ChromeConfig::disabled();
        assert!(cfg.cdp_bind().starts_with("127.0.0.1:"));
    }
}
