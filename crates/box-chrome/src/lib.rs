//! Phase 2 stub — Chromium on the box with a persistent profile.
//!
//! Cookies, logins, and local storage should live **on the box** (typically
//! `/home/box/chrome-profile`) so hibernated volumes restore a warm browser.
//!
//! This is not a CDP-over-the-network product surface in Phase 1. The Docker
//! image already mounts the profile directory as a placeholder.
//!
//! # TODO
//! - [ ] Install Chromium (or google-chrome-stable) in the runtime image
//! - [ ] Launch flags: no-sandbox as needed, user-data-dir, display
//! - [ ] `box-host` capability `chrome: true` once a browser process exists
//! - [ ] Optional helper to open a URL on the box display

/// Future capability flag name advertised by `box-host`.
pub const CAPABILITY: &str = "chrome";

/// Default persistent profile path (already volume-mounted in Phase 1).
pub const PROFILE_DIR: &str = "/home/box/chrome-profile";
