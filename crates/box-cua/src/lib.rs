//! Computer Use (CUA) actuators against the box X display.
//!
//! This crate talks to Xvfb via `import`/`scrot` and `xdotool`. It never
//! calls an inference gateway — models live in L4.

use std::env;
use std::process::Stdio;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use box_desktop::{parse_geometry, DISPLAY_HEIGHT, DISPLAY_WIDTH};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Capability flag name advertised by `box-host`.
pub const CAPABILITY: &str = "cua";

#[derive(Clone, Debug)]
pub struct CuaConfig {
    pub enabled: bool,
    pub display: String,
    pub width: u32,
    pub height: u32,
}

impl CuaConfig {
    pub fn from_env() -> Self {
        let geom = env::var("BOX_DISPLAY_GEOM").unwrap_or_else(|_| "1280x800x24".into());
        let (width, height) = parse_geometry(&geom).unwrap_or((DISPLAY_WIDTH, DISPLAY_HEIGHT));
        Self {
            enabled: env_bool("BOX_CUA", true),
            display: env::var("BOX_DISPLAY").unwrap_or_else(|_| ":1".into()),
            width,
            height,
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            display: ":1".into(),
            width: DISPLAY_WIDTH,
            height: DISPLAY_HEIGHT,
        }
    }

    /// True when CUA is enabled and the X display socket is present.
    pub fn capability_ready(&self) -> bool {
        self.enabled && display_up(&self.display)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CuaError {
    #[error("computer use is disabled")]
    Disabled,
    #[error("display {0} is not available")]
    DisplayDown(String),
    #[error("coordinates ({0},{1}) are outside {2}x{3}")]
    OutOfRange(i32, i32, u32, u32),
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("tool failed: {0}")]
    Tool(String),
}

#[derive(Debug, Deserialize)]
pub struct ClickRequest {
    pub x: i32,
    pub y: i32,
    pub button: Option<u8>,
}

#[derive(Debug, Deserialize)]
pub struct TypeRequest {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct KeyRequest {
    pub key: String,
}

#[derive(Debug, Deserialize)]
pub struct ScrollRequest {
    pub x: i32,
    pub y: i32,
    pub dx: i32,
    pub dy: i32,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotResponse {
    pub encoding: &'static str,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
    pub png_base64: String,
    pub bytes: usize,
}

#[derive(Debug, Serialize)]
pub struct DisplayInfo {
    pub display: String,
    pub width: u32,
    pub height: u32,
    pub available: bool,
}

#[derive(Debug, Serialize)]
pub struct OkResponse {
    pub ok: bool,
}

pub fn display_info(config: &CuaConfig) -> DisplayInfo {
    DisplayInfo {
        display: config.display.clone(),
        width: config.width,
        height: config.height,
        available: config.enabled && display_up(&config.display),
    }
}

pub fn validate_point(config: &CuaConfig, x: i32, y: i32) -> Result<(), CuaError> {
    if x < 0 || y < 0 || x >= config.width as i32 || y >= config.height as i32 {
        return Err(CuaError::OutOfRange(x, y, config.width, config.height));
    }
    Ok(())
}

pub async fn screenshot(config: &CuaConfig) -> Result<ScreenshotResponse, CuaError> {
    ensure_ready(config)?;
    let png = capture_png(&config.display).await?;
    if png.is_empty() {
        return Err(CuaError::Tool("screenshot was empty".into()));
    }
    if png.len() < 8 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(CuaError::Tool("screenshot was not a PNG".into()));
    }
    Ok(ScreenshotResponse {
        encoding: "base64",
        mime: "image/png",
        width: config.width,
        height: config.height,
        bytes: png.len(),
        png_base64: BASE64.encode(&png),
    })
}

pub async fn click(config: &CuaConfig, req: &ClickRequest) -> Result<OkResponse, CuaError> {
    ensure_ready(config)?;
    validate_point(config, req.x, req.y)?;
    let button = req.button.unwrap_or(1);
    if !(1..=7).contains(&button) {
        return Err(CuaError::Invalid("button must be 1-7".into()));
    }
    xdotool(
        config,
        &[
            "mousemove",
            "--sync",
            &req.x.to_string(),
            &req.y.to_string(),
            "click",
            &button.to_string(),
        ],
    )
    .await?;
    Ok(OkResponse { ok: true })
}

pub async fn type_text(config: &CuaConfig, req: &TypeRequest) -> Result<OkResponse, CuaError> {
    ensure_ready(config)?;
    if req.text.is_empty() {
        return Err(CuaError::Invalid("text must not be empty".into()));
    }
    if req.text.len() > 16 * 1024 {
        return Err(CuaError::Invalid("text is too long".into()));
    }
    xdotool(
        config,
        &["type", "--clearmodifiers", "--delay", "12", "--", &req.text],
    )
    .await?;
    Ok(OkResponse { ok: true })
}

pub async fn key(config: &CuaConfig, req: &KeyRequest) -> Result<OkResponse, CuaError> {
    ensure_ready(config)?;
    if req.key.is_empty() {
        return Err(CuaError::Invalid("key must not be empty".into()));
    }
    if req.key.chars().any(|c| c.is_whitespace() || c == ';') {
        return Err(CuaError::Invalid("key contains invalid characters".into()));
    }
    xdotool(config, &["key", "--clearmodifiers", &req.key]).await?;
    Ok(OkResponse { ok: true })
}

pub async fn scroll(config: &CuaConfig, req: &ScrollRequest) -> Result<OkResponse, CuaError> {
    ensure_ready(config)?;
    validate_point(config, req.x, req.y)?;
    xdotool(
        config,
        &[
            "mousemove",
            "--sync",
            &req.x.to_string(),
            &req.y.to_string(),
        ],
    )
    .await?;
    // X buttons: 4=up, 5=down, 6=left, 7=right
    let vertical = match req.dy.cmp(&0) {
        std::cmp::Ordering::Greater => 5,
        std::cmp::Ordering::Less => 4,
        std::cmp::Ordering::Equal => 0,
    };
    let horizontal = match req.dx.cmp(&0) {
        std::cmp::Ordering::Greater => 7,
        std::cmp::Ordering::Less => 6,
        std::cmp::Ordering::Equal => 0,
    };
    let v_clicks = req.dy.unsigned_abs().min(50);
    let h_clicks = req.dx.unsigned_abs().min(50);
    if vertical != 0 {
        for _ in 0..v_clicks.max(1) {
            xdotool(config, &["click", &vertical.to_string()]).await?;
        }
    }
    if horizontal != 0 {
        for _ in 0..h_clicks.max(1) {
            xdotool(config, &["click", &horizontal.to_string()]).await?;
        }
    }
    if vertical == 0 && horizontal == 0 {
        return Err(CuaError::Invalid("dx and dy must not both be 0".into()));
    }
    Ok(OkResponse { ok: true })
}

fn ensure_ready(config: &CuaConfig) -> Result<(), CuaError> {
    if !config.enabled {
        return Err(CuaError::Disabled);
    }
    if !display_up(&config.display) {
        return Err(CuaError::DisplayDown(config.display.clone()));
    }
    Ok(())
}

fn display_up(display: &str) -> bool {
    let num = display
        .trim()
        .trim_start_matches(':')
        .split('.')
        .next()
        .unwrap_or("1");
    std::path::Path::new("/tmp/.X11-unix")
        .join(format!("X{num}"))
        .exists()
}

async fn capture_png(display: &str) -> Result<Vec<u8>, CuaError> {
    if let Ok(png) = run_capture(
        Command::new("import")
            .arg("-display")
            .arg(display)
            .arg("-window")
            .arg("root")
            .arg("png:-"),
    )
    .await
    {
        return Ok(png);
    }
    let tmp = format!("/tmp/box-cua-{}.png", std::process::id());
    let status = Command::new("scrot")
        .env("DISPLAY", display)
        .arg("-o")
        .arg(&tmp)
        .status()
        .await
        .map_err(|err| CuaError::Tool(format!("scrot: {err}")))?;
    if !status.success() {
        return Err(CuaError::Tool("scrot failed".into()));
    }
    let png = tokio::fs::read(&tmp)
        .await
        .map_err(|err| CuaError::Tool(err.to_string()))?;
    let _ = tokio::fs::remove_file(&tmp).await;
    Ok(png)
}

async fn run_capture(cmd: &mut Command) -> Result<Vec<u8>, CuaError> {
    let out = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|err| CuaError::Tool(err.to_string()))?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err(CuaError::Tool(String::from_utf8_lossy(&out.stderr).into()));
    }
    Ok(out.stdout)
}

async fn xdotool(config: &CuaConfig, args: &[&str]) -> Result<(), CuaError> {
    let out = Command::new("xdotool")
        .env("DISPLAY", &config.display)
        .args(args)
        .output()
        .await
        .map_err(|err| CuaError::Tool(format!("xdotool: {err}")))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(CuaError::Tool(format!("xdotool failed: {err}")));
    }
    Ok(())
}

fn env_bool(var: &str, default: bool) -> bool {
    match env::var(var) {
        Ok(raw) => {
            let v = raw.trim().to_ascii_lowercase();
            !matches!(v.as_str(), "0" | "false" | "off" | "no")
        }
        Err(_) => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_out_of_range() {
        let cfg = CuaConfig::disabled();
        let mut cfg = cfg;
        cfg.enabled = true;
        assert!(validate_point(&cfg, 0, 0).is_ok());
        assert!(validate_point(&cfg, 1279, 799).is_ok());
        assert!(validate_point(&cfg, 1280, 0).is_err());
        assert!(validate_point(&cfg, -1, 10).is_err());
        assert!(validate_point(&cfg, 10, 800).is_err());
    }

    #[test]
    fn disabled_screenshot_errors() {
        let cfg = CuaConfig::disabled();
        let err = futures_error(&cfg);
        assert!(matches!(err, CuaError::Disabled));
        assert!(!cfg.capability_ready());
    }

    fn futures_error(cfg: &CuaConfig) -> CuaError {
        ensure_ready(cfg).unwrap_err()
    }
}
