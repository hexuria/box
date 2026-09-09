//! ffmpeg x11grab of the guest framebuffer during a recipe cook.
//!
//! Runs beside x11vnc (read-only capture). Modest fps + ultrafast x264 so
//! VNC is not starved. The file is fragmented so a short cook is still
//! playable if ffmpeg is interrupted.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::{Child, Command};

use crate::CuaError;

pub struct CookRecorder {
    child: Child,
    pub path: PathBuf,
}

fn display_target(display: &str) -> String {
    if display.contains('.') {
        display.to_string()
    } else {
        format!("{display}.0")
    }
}

async fn try_wait_now(child: &mut Child) -> Option<std::process::ExitStatus> {
    child.try_wait().ok().flatten()
}

pub async fn start_cook_recorder(
    display: &str,
    width: u32,
    height: u32,
    dest: PathBuf,
) -> Result<CookRecorder, CuaError> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| CuaError::Tool(format!("cook record dir: {err}")))?;
    }
    if dest.exists() {
        let _ = tokio::fs::remove_file(&dest).await;
    }

    let size = format!("{width}x{height}");
    let target = display_target(display);
    let dest_str = dest
        .to_str()
        .ok_or_else(|| CuaError::Invalid("cook record path is not utf-8".into()))?
        .to_string();

    let mut child = Command::new("ffmpeg")
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "x11grab",
            "-draw_mouse",
            "1",
            "-video_size",
            &size,
            "-framerate",
            "8",
            "-i",
            &target,
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
            "-b:v",
            "700k",
            "-maxrate",
            "900k",
            "-bufsize",
            "1800k",
            "-movflags",
            "+frag_keyframe+empty_moov+faststart",
            &dest_str,
        ])
        .env("DISPLAY", display)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| {
            CuaError::Tool(format!(
                "ffmpeg could not start cook recording ({err}). Rebuild grok-box:local with ffmpeg.",
            ))
        })?;

    tokio::time::sleep(Duration::from_millis(280)).await;
    if let Some(status) = try_wait_now(&mut child).await {
        let mut detail = String::new();
        if let Some(mut pipe) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf).await;
            detail = String::from_utf8_lossy(&buf).trim().to_string();
        }
        return Err(CuaError::Tool(format!(
            "ffmpeg cook recording exited immediately ({status}): {detail}",
        )));
    }

    Ok(CookRecorder { child, path: dest })
}

pub async fn stop_cook_recorder(mut rec: CookRecorder) -> Result<PathBuf, CuaError> {
    let pid = rec.child.id();
    if let Some(pid) = pid {
        let _ = Command::new("kill")
            .args(["-INT", &pid.to_string()])
            .status()
            .await;
    }
    match tokio::time::timeout(Duration::from_secs(4), rec.child.wait()).await {
        Ok(Ok(_)) => {}
        Ok(Err(err)) => {
            tracing::warn!(error = %err, "ffmpeg wait failed after SIGINT");
        }
        Err(_) => {
            let _ = rec.child.start_kill();
            let _ = rec.child.wait().await;
        }
    }

    let meta = tokio::fs::metadata(&rec.path).await.map_err(|err| {
        CuaError::Tool(format!(
            "cook recording was not written to {}: {err}",
            rec.path.display()
        ))
    })?;
    if meta.len() == 0 {
        return Err(CuaError::Tool("cook recording file is empty".into()));
    }
    Ok(rec.path)
}

pub fn recording_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "webm" => "video/webm",
        _ => "video/mp4",
    }
}
