//! Smart waits while a recipe runs: Chromium mapped/focused, title or CDP URL
//! changed. Used by cook so raw v1 (and compressed v2/v3) do not type into a
//! window that is not on screen yet.

use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::Command;

use crate::CuaConfig;

const POLL_MS: u64 = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WinInfo {
    pub id: String,
    pub class: String,
    pub title: String,
}

impl WinInfo {
    pub fn is_app(&self) -> bool {
        let class = self.class.to_ascii_lowercase();
        class.contains("chromium")
            || class.contains("chrome")
            || class.contains("xfce4-terminal")
            || class.contains("thunar")
    }

    pub fn is_chromium(&self) -> bool {
        let class = self.class.to_ascii_lowercase();
        class.contains("chromium") || class.contains("chrome")
    }

    pub fn usable(&self) -> bool {
        self.is_app() && !self.title.trim().is_empty()
    }
}

pub(crate) fn parse_wmctrl_lx(stdout: &str) -> Vec<WinInfo> {
    stdout.lines().filter_map(parse_wmctrl_lx_line).collect()
}

pub(crate) fn parse_wmctrl_lx_line(line: &str) -> Option<WinInfo> {
    let mut parts = line.split_whitespace();
    let id = parts.next()?.to_string();
    let _desktop = parts.next()?;
    let class = parts.next()?.to_string();
    let _host = parts.next()?;
    let title = parts.collect::<Vec<_>>().join(" ");
    if id.is_empty() {
        return None;
    }
    Some(WinInfo { id, class, title })
}

// remainder of settle.rs is uploaded in follow-up commits with the rest of the cook stack
