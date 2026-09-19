//! `box-egress-tunnel`: guest-side HTTP CONNECT proxy muxed over a WebSocket
//! to a client on the operator's machine.
//!
//! This is **our** wire (`box-egress-v1`). It is not Cursor's
//! `sand-egress-tunnel` and does not re-host any proprietary binary.
//!
//! Layout:
//! - **server** (inside the guest): WebSocket for the laptop client, HTTP
//!   CONNECT proxy for Chromium, loopback admin status.
//! - **client** (on the laptop): attaches to the WS URL with Bearer, dials
//!   outbound TCP for each CONNECT session.
//!
//! See `docs/EGRESS.md` in the repo root for the operator story and the
//! byte-level protocol.

pub mod allowlist;
pub mod client;
pub mod config;
pub mod destination;
pub mod http1;
pub mod protocol;
pub mod server;
pub mod status;

pub use allowlist::Allowlist;
pub use config::{TunnelClientConfig, TunnelServerConfig};
pub use protocol::{PROTOCOL_NAME, WIRE_VERSION};
pub use status::{probe_egress, EgressConfig, EgressStatus};

#[cfg(test)]
mod relay_tests;
