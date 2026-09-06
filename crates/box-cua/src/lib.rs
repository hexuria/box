//! Phase 2 stub — Computer Use (CUA) actions against the box X display.
//!
//! Endpoints belong on `box-exec` (same bearer token, same box) once a
//! desktop exists. Implementation sketch: screenshot via `scrot`/`import`,
//! input via `xdotool` or a small Rust X11 helper.
//!
//! This crate must never talk to an inference gateway. Models live in L4
//! (open-ai-gateway). CUA here is only *actuators and sensors* on the box.
//!
//! # Planned endpoints (box-exec, not implemented)
//! - `POST /v1/cua/screenshot` → PNG (or base64) of `DISPLAY`
//! - `POST /v1/cua/click` `{ x, y, button }`
//! - `POST /v1/cua/type` `{ text }` / `POST /v1/cua/key` `{ key }`
//! - `GET /v1/cua/display` geometry + display name
//!
//! # TODO
//! - [ ] Depend on a running `box-desktop` display
//! - [ ] Jail screenshots to the box (no host grab)
//! - [ ] Advertise `capabilities.cua` from `box-host` when ready

/// Future capability flag name advertised by `box-host`.
pub const CAPABILITY: &str = "cua";

/// Planned default display CUA attaches to.
pub const PLANNED_DISPLAY: &str = ":1";
