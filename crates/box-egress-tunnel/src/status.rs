//! Config + probe used by `box-host` (`capabilities.egress_tunnel`, `GET /v1/egress`).
//!
//! `ready` means a laptop client is **currently attached**. Enabled but no
//! client is `enabled: true, ready: false`. The CONNECT proxy fail-closes in
//! that state.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use box_common::{container_local_host, env_bool};
use serde::{Deserialize, Serialize};

use crate::config::parse_addr;
use crate::protocol::PROTOCOL_NAME;

const DEFAULT_WS: &str = "127.0.0.1:8790";
const DEFAULT_PROXY: &str = "127.0.0.1:8791";
const DEFAULT_ADMIN: &str = "127.0.0.1:8792";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EgressConfig {
    pub enabled: bool,
    pub ws_bind: SocketAddr,
    pub proxy_bind: SocketAddr,
    pub admin_bind: SocketAddr,
}

impl EgressConfig {
    pub fn from_env() -> Self {
        Self {
            enabled: env_bool("BOX_EGRESS_TUNNEL", false),
            ws_bind: parse_addr("BOX_EGRESS_WS_BIND", DEFAULT_WS),
            proxy_bind: parse_addr("BOX_EGRESS_PROXY_BIND", DEFAULT_PROXY),
            admin_bind: parse_addr("BOX_EGRESS_ADMIN_BIND", DEFAULT_ADMIN),
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            ws_bind: DEFAULT_WS.parse().expect("default ws"),
            proxy_bind: DEFAULT_PROXY.parse().expect("default proxy"),
            admin_bind: DEFAULT_ADMIN.parse().expect("default admin"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EgressStatus {
    pub enabled: bool,
    /// A client is attached and CONNECT will be relayed.
    pub ready: bool,
    pub client_attached: bool,
    pub protocol: String,
    /// Container-local listen inventory (unspecified rewritten to loopback).
    pub ws: String,
    pub proxy: String,
}

impl EgressStatus {
    pub fn from_config(cfg: &EgressConfig, ready: bool) -> Self {
        Self {
            enabled: cfg.enabled,
            ready,
            client_attached: ready,
            protocol: PROTOCOL_NAME.to_string(),
            ws: format_bind(cfg.ws_bind),
            proxy: format_bind(cfg.proxy_bind),
        }
    }
}

pub fn format_bind(bind: SocketAddr) -> String {
    let host = container_local_host(bind);
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{}", bind.port())
    } else {
        format!("{host}:{}", bind.port())
    }
}

/// Honest probe: when disabled, do not touch the admin port. When enabled,
/// `GET /v1/status` on the admin loopback. Process down → enabled, not ready.
pub fn probe_egress(cfg: &EgressConfig) -> EgressStatus {
    if !cfg.enabled {
        return EgressStatus::from_config(cfg, false);
    }
    match fetch_admin(cfg.admin_bind) {
        Some(mut st) => {
            st.enabled = true;
            st.ready = st.client_attached;
            if st.protocol.is_empty() {
                st.protocol = PROTOCOL_NAME.to_string();
            }
            st
        }
        None => EgressStatus::from_config(cfg, false),
    }
}

fn fetch_admin(addr: SocketAddr) -> Option<EgressStatus> {
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(200)).ok()?;
    stream
        .set_read_timeout(Some(Duration::from_millis(400)))
        .ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(200)))
        .ok()?;
    let host = addr.ip();
    let req = format!(
        "GET /v1/status HTTP/1.0\r\nHost: {host}:{}\r\nConnection: close\r\n\r\n",
        addr.port()
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    if !(text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200")) {
        return None;
    }
    let split = text.find("\r\n\r\n").or_else(|| text.find("\n\n"))?;
    let start = if text[split..].starts_with("\r\n\r\n") {
        split + 4
    } else {
        split + 2
    };
    serde_json::from_str(text[start..].trim()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_is_not_ready() {
        let st = probe_egress(&EgressConfig::disabled());
        assert!(!st.enabled);
        assert!(!st.ready);
        assert!(!st.client_attached);
        assert_eq!(st.protocol, PROTOCOL_NAME);
    }

    #[test]
    fn closed_admin_is_enabled_not_ready() {
        let cfg = EgressConfig {
            enabled: true,
            ws_bind: "127.0.0.1:8790".parse().unwrap(),
            proxy_bind: "127.0.0.1:8791".parse().unwrap(),
            admin_bind: "127.0.0.1:1".parse().unwrap(),
        };
        let st = probe_egress(&cfg);
        assert!(st.enabled);
        assert!(!st.ready);
        assert_eq!(st.proxy, "127.0.0.1:8791");
    }
}
