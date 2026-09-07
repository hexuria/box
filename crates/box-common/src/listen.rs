//! Container-local listen URLs for `/v1/info`.
//!
//! These describe what the process bound inside the guest. Callers must still
//! supply their own published exec/host URLs to SDKs and the CLI.

use std::net::{IpAddr, SocketAddr};

/// Loopback rewrite of an unspecified bind IP.
pub fn container_local_host(bind: SocketAddr) -> String {
    match bind.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => "127.0.0.1".to_string(),
        IpAddr::V6(ip) if ip.is_unspecified() => "::1".to_string(),
        other => other.to_string(),
    }
}

/// `http://` base URL for a listen address, rewritten to loopback when the
/// process bound `0.0.0.0` / `::`.
pub fn container_local_http_url(bind: SocketAddr) -> String {
    let host = container_local_host(bind);
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{}", bind.port())
    } else {
        format!("http://{host}:{}", bind.port())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unspecified_v4_becomes_loopback() {
        let bind: SocketAddr = "0.0.0.0:1337".parse().unwrap();
        assert_eq!(container_local_host(bind), "127.0.0.1");
        assert_eq!(container_local_http_url(bind), "http://127.0.0.1:1337");
    }

    #[test]
    fn explicit_bind_is_kept() {
        let bind: SocketAddr = "10.0.0.9:1340".parse().unwrap();
        assert_eq!(container_local_http_url(bind), "http://10.0.0.9:1340");
    }

    #[test]
    fn unspecified_v6_becomes_loopback() {
        let bind: SocketAddr = "[::]:1340".parse().unwrap();
        assert_eq!(container_local_http_url(bind), "http://[::1]:1340");
    }
}
