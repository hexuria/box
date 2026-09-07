//! Chromium launch metadata for the Linux Grok Box image.
//!
//! Chrome (or Chromium) is started by `docker/entrypoint.sh` on `DISPLAY=:1`.
//! The profile lives at `/home/box/chrome-profile` (compose volume). Optional
//! Chrome DevTools Protocol listens on **localhost only**.

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

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
    let running = pidfile_alive(Path::new(PID_FILE))
        || cdp_listening(cfg.cdp_port)
        || chromium_on_display(&cfg.display);
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
    Path::new(&format!("/proc/{pid}")).exists() && is_chrome_pid(pid)
}

fn is_chrome_pid(pid: u32) -> bool {
    looks_like_chrome(
        &read_comm(&pid.to_string()),
        &read_exe(&pid.to_string()),
        &read_cmdline(&pid.to_string()),
    ) && !is_chrome_helper(
        &read_comm(&pid.to_string()),
        &read_cmdline(&pid.to_string()),
    )
}

fn cdp_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
}

/// Look for a chromium/chrome process. DISPLAY may live in environ rather than argv.
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
        let comm = read_comm(pid.as_ref());
        let exe = read_exe(pid.as_ref());
        let cmdline = read_cmdline(pid.as_ref());
        if !looks_like_chrome(&comm, &exe, &cmdline) {
            continue;
        }
        if is_chrome_helper(&comm, &cmdline) {
            continue;
        }
        if display_env_matches(pid.as_ref(), display)
            || cmdline.contains(display)
            || cmdline.contains("--remote-debugging-port")
            || cmdline.contains("--user-data-dir")
        {
            return true;
        }
        // A chrome/chromium browser process on this box is enough.
        if comm_is_browser(&comm) || exe_is_browser(&exe) {
            return true;
        }
    }
    false
}

fn read_comm(pid: &str) -> String {
    std::fs::read_to_string(format!("/proc/{pid}/comm")).unwrap_or_default()
}

fn read_exe(pid: &str) -> String {
    std::fs::read_link(format!("/proc/{pid}/exe"))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn read_cmdline(pid: &str) -> String {
    let raw = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    String::from_utf8_lossy(&raw).into_owned()
}

fn comm_is_browser(comm: &str) -> bool {
    let comm = comm.trim();
    matches!(
        comm,
        "chrome" | "chromium" | "chromium-browse" | "google-chrome" | "chrome-headless"
    )
}

fn exe_is_browser(exe: &str) -> bool {
    let exe = exe.to_ascii_lowercase();
    (exe.contains("chromium") || exe.contains("/chrome") || exe.ends_with("/chrome"))
        && !exe.contains("crashpad")
}

fn looks_like_chrome(comm: &str, exe: &str, cmdline: &str) -> bool {
    comm_is_browser(comm)
        || exe_is_browser(exe)
        || cmdline.contains("chromium")
        || cmdline.contains("google-chrome")
        || cmdline.split('\0').any(|part| {
            let base = Path::new(part)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            matches!(
                base,
                "chrome"
                    | "chromium"
                    | "chromium-browser"
                    | "google-chrome"
                    | "google-chrome-stable"
            )
        })
}

fn is_chrome_helper(comm: &str, cmdline: &str) -> bool {
    let hay = format!("{comm} {cmdline}").to_ascii_lowercase();
    hay.contains("crashpad")
        || hay.contains("nacl_helper")
        || hay.contains("chrome_crashpad")
        || hay.contains("crash-handler")
}

fn display_env_matches(pid: &str, display: &str) -> bool {
    let Ok(env) = std::fs::read(format!("/proc/{pid}/environ")) else {
        return false;
    };
    String::from_utf8_lossy(&env).split('\0').any(|entry| {
        entry == format!("DISPLAY={display}") || entry == format!("DISPLAY={display}.0")
    })
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

    #[test]
    fn helpers_are_not_the_browser() {
        assert!(is_chrome_helper(
            "chrome_crashpad",
            "chrome_crashpad_handler"
        ));
        assert!(!is_chrome_helper("chromium", "/usr/lib/chromium/chromium"));
        assert!(comm_is_browser("chromium-browse"));
        assert!(exe_is_browser("/usr/lib/chromium/chromium"));
        assert!(!exe_is_browser("/usr/lib/chromium/chrome_crashpad_handler"));
    }
}
