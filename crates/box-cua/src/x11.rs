//! Direct X11 / XTEST / GetImage backend. No xdotool, scrot, or import.
//!
//! One persistent display connection + XTEST + DAMAGE for the process lifetime.
//! Every CUA primitive is an in-process X protocol round-trip.
//!
//! Keyboard encoding is inlined here (not a separate module) so the crate
//! stays a flat set of focused files.

use anyhow::{anyhow, bail, Context, Result};
use smallvec::SmallVec;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use x11rb::connection::Connection;
use x11rb::protocol::damage::{self, ConnectionExt as DamageExt};
use x11rb::protocol::xtest::ConnectionExt as XtestExt;
use x11rb::protocol::xproto::{self, ConnectionExt as XprotoExt, ImageFormat};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as WrapperExt;

use crate::encode::{encode_png, encode_png_from_bgra};
use crate::keys::{
    decode_key, decode_key_combo, KeyKind, MouseButton, MouseWheel, KEY_CHORD_GAP, KEY_HOLD_MS,
    KEY_TYPE_GAP, POINTER_HOLD_MS, WHEEL_STEP_GAP, XTEST_SETTLE_MS,
};

const DISPLAY: &str = ":99";
const DAMAGE_REPORT_LEVEL: u8 = damage::ReportLevel::RAW_RECTANGLES.into();

struct DisplayState {
    conn: RustConnection,
    root: u32,
    width: u16,
    height: u16,
    damage: u32,
}

static DISPLAY: OnceLock<Mutex<DisplayState>> = OnceLock::new();

fn display() -> Result<std::sync::MutexGuard<'static, DisplayState>> {
    let lock = DISPLAY.get_or_init(|| {
        Mutex::new(connect_display().expect("connect X display :99"))
    });
    lock.lock().map_err(|_| anyhow!("X display lock poisoned"))
}

fn connect_display() -> Result<DisplayState> {
    let (conn, screen_num) = RustConnection::connect(Some(DISPLAY))
        .with_context(|| format!("connect X display {DISPLAY}"))?;
    let setup = conn.setup();
    let screen = &setup.roots[screen_num];
    let root = screen.root;
    let width = screen.width_in_pixels;
    let height = screen.height_in_pixels;

    conn.xtest_get_version(2, 2)?.reply().context("XTEST version")?;
    let damage_ver = conn.damage_query_version(1, 1)?.reply().context("DAMAGE version")?;
    if damage_ver.major_version < 1 {
        bail!("DAMAGE extension too old");
    }

    let damage = conn.generate_id()?;
    conn.damage_create(damage, root, DAMAGE_REPORT_LEVEL)?.check()?;
    conn.flush()?;

    Ok(DisplayState {
        conn,
        root,
        width,
        height,
        damage,
    })
}

fn xtest_fake(
    conn: &RustConnection,
    type_: u8,
    detail: u8,
    delay: u32,
    root: u32,
) -> Result<()> {
    conn.xtest_fake_input(type_, detail, delay, root, 0, 0, 0)?
        .check()
        .context("XTEST FakeInput")
}

fn xtest_motion(conn: &RustConnection, root: u32, x: i16, y: i16) -> Result<()> {
    conn.xtest_fake_input(xproto::MOTION_NOTIFY_EVENT, 0, 0, root, x, y, 0)?
        .check()
        .context("XTEST motion")
}

fn flush_damage(state: &mut DisplayState) {
    while let Ok(Some(_)) = state.conn.poll_for_event() {}
    let _ = state.conn.damage_subtract(state.damage, 0, 0);
    let _ = state.conn.flush();
}

pub fn screen_size() -> Result<(u32, u32)> {
    let state = display()?;
    Ok((u32::from(state.width), u32::from(state.height)))
}

pub fn screenshot_png() -> Result<Vec<u8>> {
    let mut state = display()?;
    let geom = state
        .conn
        .get_geometry(state.root)?
        .reply()
        .context("GetGeometry")?;
    state.width = geom.width;
    state.height = geom.height;
    let image = state
        .conn
        .get_image(
            ImageFormat::Z_PIXMAP,
            state.root,
            0,
            0,
            geom.width,
            geom.height,
            !0,
        )?
        .reply()
        .context("GetImage")?;
    flush_damage(&mut state);
    encode_png_from_bgra(&image.data, geom.width, geom.height)
}

pub fn screenshot_region_png(x: i32, y: i32, w: u32, h: u32) -> Result<Vec<u8>> {
    let mut state = display()?;
    let gx = x.max(0) as i16;
    let gy = y.max(0) as i16;
    let gw = (w as u16).min(state.width.saturating_sub(gx as u16));
    let gh = (h as u16).min(state.height.saturating_sub(gy as u16));
    if gw == 0 || gh == 0 {
        bail!("empty screenshot region");
    }
    let image = state
        .conn
        .get_image(
            ImageFormat::Z_PIXMAP,
            state.root,
            gx,
            gy,
            gw,
            gh,
            !0,
        )?
        .reply()
        .context("GetImage region")?;
    flush_damage(&mut state);
    encode_png_from_bgra(&image.data, gw, gh)
}

/// Wait until DAMAGE reports dirty rects or `timeout` elapses.
pub fn wait_damage(timeout: Duration) -> Result<bool> {
    let mut state = display()?;
    let deadline = Instant::now() + timeout;
    loop {
        while let Ok(Some(ev)) = state.conn.poll_for_event() {
            if matches!(ev, Event::DamageNotify(_)) {
                flush_damage(&mut state);
                return Ok(true);
            }
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(2));
    }
}

pub fn move_mouse(x: i32, y: i32) -> Result<()> {
    let state = display()?;
    xtest_motion(&state.conn, state.root, x as i16, y as i16)?;
    state.conn.flush()?;
    thread::sleep(XTEST_SETTLE_MS);
    Ok(())
}

pub fn click(x: i32, y: i32, button: MouseButton) -> Result<()> {
    let state = display()?;
    xtest_motion(&state.conn, state.root, x as i16, y as i16)?;
    let detail = button.xtest_code();
    xtest_fake(&state.conn, xproto::BUTTON_PRESS_EVENT, detail, 0, state.root)?;
    thread::sleep(POINTER_HOLD_MS);
    xtest_fake(
        &state.conn,
        xproto::BUTTON_RELEASE_EVENT,
        detail,
        0,
        state.root,
    )?;
    state.conn.flush()?;
    thread::sleep(XTEST_SETTLE_MS);
    Ok(())
}

pub fn drag(from: (i32, i32), to: (i32, i32), button: MouseButton) -> Result<()> {
    let state = display()?;
    xtest_motion(&state.conn, state.root, from.0 as i16, from.1 as i16)?;
    let detail = button.xtest_code();
    xtest_fake(&state.conn, xproto::BUTTON_PRESS_EVENT, detail, 0, state.root)?;
    thread::sleep(POINTER_HOLD_MS);
    xtest_motion(&state.conn, state.root, to.0 as i16, to.1 as i16)?;
    thread::sleep(POINTER_HOLD_MS);
    xtest_fake(
        &state.conn,
        xproto::BUTTON_RELEASE_EVENT,
        detail,
        0,
        state.root,
    )?;
    state.conn.flush()?;
    thread::sleep(XTEST_SETTLE_MS);
    Ok(())
}

pub fn scroll(x: i32, y: i32, wheel: MouseWheel, steps: u32) -> Result<()> {
    let state = display()?;
    xtest_motion(&state.conn, state.root, x as i16, y as i16)?;
    let detail = wheel.xtest_code();
    for _ in 0..steps.max(1) {
        xtest_fake(&state.conn, xproto::BUTTON_PRESS_EVENT, detail, 0, state.root)?;
        thread::sleep(WHEEL_STEP_GAP);
        xtest_fake(
            &state.conn,
            xproto::BUTTON_RELEASE_EVENT,
            detail,
            0,
            state.root,
        )?;
        thread::sleep(WHEEL_STEP_GAP);
    }
    state.conn.flush()?;
    thread::sleep(XTEST_SETTLE_MS);
    Ok(())
}

pub fn type_text(text: &str) -> Result<()> {
    let keys = decode_text(text)?;
    let state = display()?;
    for key in keys {
        press_keykind(&state.conn, state.root, &key)?;
        thread::sleep(KEY_TYPE_GAP);
    }
    state.conn.flush()?;
    thread::sleep(XTEST_SETTLE_MS);
    Ok(())
}

pub fn key(combo: &str) -> Result<()> {
    let keys = decode_key_combo(combo)?;
    let state = display()?;
    // Hold modifiers, tap the final key, release modifiers in reverse.
    let (mods, tap) = keys.split_at(keys.len().saturating_sub(1));
    for m in mods {
        press_only(&state.conn, state.root, m)?;
        thread::sleep(KEY_CHORD_GAP);
    }
    if let Some(k) = tap.first() {
        press_keykind(&state.conn, state.root, k)?;
    }
    for m in mods.iter().rev() {
        release_only(&state.conn, state.root, m)?;
        thread::sleep(KEY_CHORD_GAP);
    }
    state.conn.flush()?;
    thread::sleep(XTEST_SETTLE_MS);
    Ok(())
}

pub fn key_down(name: &str) -> Result<()> {
    let k = decode_key(name)?;
    let state = display()?;
    press_only(&state.conn, state.root, &k)?;
    state.conn.flush()?;
    Ok(())
}

pub fn key_up(name: &str) -> Result<()> {
    let k = decode_key(name)?;
    let state = display()?;
    release_only(&state.conn, state.root, &k)?;
    state.conn.flush()?;
    Ok(())
}

fn press_keykind(conn: &RustConnection, root: u32, key: &KeyKind) -> Result<()> {
    match key {
        KeyKind::Plain(code) => {
            xtest_fake(conn, xproto::KEY_PRESS_EVENT, *code, 0, root)?;
            thread::sleep(KEY_HOLD_MS);
            xtest_fake(conn, xproto::KEY_RELEASE_EVENT, *code, 0, root)?;
        }
        KeyKind::Shifted(code) => {
            xtest_fake(conn, xproto::KEY_PRESS_EVENT, 50, 0, root)?; // Shift_L
            thread::sleep(KEY_CHORD_GAP);
            xtest_fake(conn, xproto::KEY_PRESS_EVENT, *code, 0, root)?;
            thread::sleep(KEY_HOLD_MS);
            xtest_fake(conn, xproto::KEY_RELEASE_EVENT, *code, 0, root)?;
            thread::sleep(KEY_CHORD_GAP);
            xtest_fake(conn, xproto::KEY_RELEASE_EVENT, 50, 0, root)?;
        }
    }
    Ok(())
}

fn press_only(conn: &RustConnection, root: u32, key: &KeyKind) -> Result<()> {
    match key {
        KeyKind::Plain(code) | KeyKind::Shifted(code) => {
            if matches!(key, KeyKind::Shifted(_)) {
                xtest_fake(conn, xproto::KEY_PRESS_EVENT, 50, 0, root)?;
            }
            xtest_fake(conn, xproto::KEY_PRESS_EVENT, *code, 0, root)?;
        }
    }
    Ok(())
}

fn release_only(conn: &RustConnection, root: u32, key: &KeyKind) -> Result<()> {
    match key {
        KeyKind::Plain(code) | KeyKind::Shifted(code) => {
            xtest_fake(conn, xproto::KEY_RELEASE_EVENT, *code, 0, root)?;
            if matches!(key, KeyKind::Shifted(_)) {
                xtest_fake(conn, xproto::KEY_RELEASE_EVENT, 50, 0, root)?;
            }
        }
    }
    Ok(())
}

fn decode_text(text: &str) -> Result<SmallVec<[KeyKind; 32]>> {
    let mut out = SmallVec::new();
    for ch in text.chars() {
        out.push(decode_char(ch)?);
    }
    Ok(out)
}

fn decode_char(ch: char) -> Result<KeyKind> {
    // US QWERTY keycodes (evdev + 8).
    let code = match ch {
        'a'..='z' => 24 + (ch as u8 - b'a'),
        'A'..='Z' => return Ok(KeyKind::Shifted(24 + (ch as u8 - b'A'))),
        '0' => 19,
        '1'..='9' => 10 + (ch as u8 - b'1'),
        ' ' => 65,
        '\n' | '\r' => 36,
        '\t' => 23,
        '-' => 20,
        '=' => 21,
        '[' => 34,
        ']' => 35,
        '\\' => 51,
        ';' => 47,
        '\'' => 48,
        '`' => 49,
        ',' => 59,
        '.' => 60,
        '/' => 61,
        '!' => return Ok(KeyKind::Shifted(10)),
        '@' => return Ok(KeyKind::Shifted(11)),
        '#' => return Ok(KeyKind::Shifted(12)),
        '$' => return Ok(KeyKind::Shifted(13)),
        '%' => return Ok(KeyKind::Shifted(14)),
        '^' => return Ok(KeyKind::Shifted(15)),
        '&' => return Ok(KeyKind::Shifted(16)),
        '*' => return Ok(KeyKind::Shifted(17)),
        '(' => return Ok(KeyKind::Shifted(18)),
        ')' => return Ok(KeyKind::Shifted(19)),
        '_' => return Ok(KeyKind::Shifted(20)),
        '+' => return Ok(KeyKind::Shifted(21)),
        '{' => return Ok(KeyKind::Shifted(34)),
        '}' => return Ok(KeyKind::Shifted(35)),
        '|' => return Ok(KeyKind::Shifted(51)),
        ':' => return Ok(KeyKind::Shifted(47)),
        '"' => return Ok(KeyKind::Shifted(48)),
        '~' => return Ok(KeyKind::Shifted(49)),
        '<' => return Ok(KeyKind::Shifted(59)),
        '>' => return Ok(KeyKind::Shifted(60)),
        '?' => return Ok(KeyKind::Shifted(61)),
        _ => bail!("unmapped character {ch:?}"),
    };
    Ok(KeyKind::Plain(code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ascii() {
        assert!(matches!(decode_char('a').unwrap(), KeyKind::Plain(_)));
        assert!(matches!(decode_char('A').unwrap(), KeyKind::Shifted(_)));
        assert!(matches!(decode_char('!').unwrap(), KeyKind::Shifted(_)));
    }
}
