//! Phase 2 stub — virtual desktop inside the box.
//!
//! Planned stack (not started in Phase 1):
//! - `Xvfb` on `DISPLAY=:1` (or `BOX_DISPLAY`)
//! - `x11vnc` attached to that display
//! - `noVNC` / websockify for a browser viewer
//!
//! L2 and L1 treat this as an optional capability advertised by `box-host`
//! (`capabilities.desktop`). The image does not start a display in Phase 1.
//!
//! # TODO
//! - [ ] Supervisor units / processes for Xvfb, x11vnc, websockify
//! - [ ] `GET /v1/desktop` on `box-host` with viewer URL + VNC port
//! - [ ] Volume for any desktop state if needed
//! - [ ] Health that fails ready when the display is required but down

/// Future capability flag name advertised by `box-host`.
pub const CAPABILITY: &str = "desktop";

/// Planned default X display.
pub const PLANNED_DISPLAY: &str = ":1";

/// Planned noVNC / viewer port (not bound in Phase 1).
pub const PLANNED_VIEWER_PORT: u16 = 6080;
