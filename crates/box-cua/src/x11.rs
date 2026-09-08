//! Persistent X11 connections: XTEST input and GetImage screenshots.
//!
//! Input and capture use **separate** connections so a PNG encode cannot
//! stall clicks. The async `ACTUATOR` mutex in `lib.rs` still serializes
//! pointer gestures (click gap, drag grab); it is never held across
//! screenshot work.

use std::sync::Mutex;
use std::time::Instant;

use arrayvec::ArrayVec;
use smallvec::SmallVec;
use x11rb::connection::{Connection, RequestConnection};
use x11rb::image::{BitsPerPixel, Image, ImageOrder};
use x11rb::protocol::xproto::{self, ConnectionExt as _, KeyButMask, Keycode, Keysym, Window};
use x11rb::protocol::xtest::{self, ConnectionExt as _};
use x11rb::rust_connection::RustConnection;
use x11rb::NONE;

use crate::encode;
use crate::keys::{char_to_keysym, parse_key_sequence, XK_ALT_L, XK_CONTROL_L, XK_SHIFT_L, XK_SUPER_L};
use crate::{CuaConfig, CuaError, CuaPoint, KeyAction, MAX_COLLECTED_POINTS};
#[path = "x11_key.rs"]
mod x11_key;

static INPUT: Mutex<Option<InputState>> = Mutex::new(None);
static SHOT: Mutex<Option<ShotConn>> = Mutex::new(None);

struct InputState { display: String, backend: Backend }
enum Backend { Native(InputConn), Cli }

pub(crate) struct InputConn {
    conn: RustConnection,
    keysyms: Vec<Keysym>,
    mod_keycodes: Vec<Keycode>,
    root: Window,
    min_keycode: Keycode,
    keysyms_per: u8,
    shift_l: Keycode,
    control_l: Keycode,
    alt_l: Keycode,
    super_l: Keycode,
    keycodes_per_mod: u8,
    scratch: Keycode,
}

struct ShotConn {
    conn: RustConnection,
    display: String,
    rgb: Vec<u8>,
    root: Window,
    red_mask: u32,
    green_mask: u32,
    blue_mask: u32,
}

fn lock_input() -> std::sync::MutexGuard<'static, Option<InputState>> {
    INPUT.lock().unwrap_or_else(|e| e.into_inner())
}
fn lock_shot() -> std::sync::MutexGuard<'static, Option<ShotConn>> {
    SHOT.lock().unwrap_or_else(|e| e.into_inner())
}
fn x_err(err: impl std::fmt::Display) -> CuaError { CuaError::Tool(format!("x11: {err}")) }
fn xy(x: i32, y: i32) -> Result<(i16, i16), CuaError> {
    Ok((i16::try_from(x).map_err(|_| CuaError::Invalid("x does not fit i16".into()))?,
        i16::try_from(y).map_err(|_| CuaError::Invalid("y does not fit i16".into()))?))
}

pub(crate) fn with_native<T>(dpy: &str, op: impl FnOnce(&mut InputConn) -> Result<T, CuaError>) -> Option<Result<T, CuaError>> {
    let mut guard = lock_input();
    let state = guard.get_or_insert_with(|| match InputConn::connect(dpy) {
        Ok(conn) => { tracing::info!(display = dpy, "cua xtest connected"); InputState { display: dpy.to_string(), backend: Backend::Native(conn) } }
        Err(err) => { tracing::warn!(display = dpy, error = %err, "cua xtest unavailable; xdotool fallback"); InputState { display: dpy.to_string(), backend: Backend::Cli } }
    });
    if state.display != dpy {
        *state = match InputConn::connect(dpy) {
            Ok(conn) => InputState { display: dpy.to_string(), backend: Backend::Native(conn) },
            Err(_) => InputState { display: dpy.to_string(), backend: Backend::Cli },
        };
    }
    match &mut state.backend {
        Backend::Cli => None,
        Backend::Native(conn) => {
            let result = op(conn);
            if result.is_err() { *guard = None; }
            Some(result)
        }
    }
}

pub(crate) fn capture_png(display: &str, width: u32, height: u32) -> Result<Vec<u8>, CuaError> {
    let mut guard = lock_shot();
    let need_new = match guard.as_ref() { Some(c) => c.display != display, None => true };
    if need_new { *guard = Some(ShotConn::connect(display)?); }
    let shot = unsafe { guard.as_mut().unwrap_unchecked() };
    match shot.capture(width, height) {
        Ok(png) => Ok(png),
        Err(err) => { *guard = None; Err(err) }
    }
}

impl ShotConn {
    fn connect(display: &str) -> Result<Self, CuaError> {
        let (conn, screen) = x11rb::connect(Some(display)).map_err(x_err)?;
        let setup = conn.setup();
        let screen = setup.roots.get(screen).ok_or_else(|| x_err("no screen"))?;
        let root = screen.root;
        let visual_id = screen.root_visual;
        let mut red_mask = 0x00ff_0000;
        let mut green_mask = 0x0000_ff00;
        let mut blue_mask = 0x0000_00ff;
        for depth in &screen.allowed_depths {
            for vis in &depth.visuals {
                if vis.visual_id == visual_id {
                    red_mask = vis.red_mask; green_mask = vis.green_mask; blue_mask = vis.blue_mask;
                }
            }
        }
        Ok(Self { conn, display: display.to_string(), rgb: Vec::new(), root, red_mask, green_mask, blue_mask })
    }
    fn capture(&mut self, width: u32, height: u32) -> Result<Vec<u8>, CuaError> {
        let w = u16::try_from(width).map_err(|_| x_err("width"))?;
        let h = u16::try_from(height).map_err(|_| x_err("height"))?;
        let started = Instant::now();
        let (image, _) = Image::get(&self.conn, self.root, 0, 0, w, h).map_err(x_err)?;
        let get_ms = started.elapsed().as_millis() as u64;
        let needed = width as usize * height as usize * 3;
        if self.rgb.len() != needed { self.rgb.clear(); self.rgb.resize(needed, 0); }
        let bpp = match image.bits_per_pixel() {
            BitsPerPixel::B32 => 32,
            BitsPerPixel::B24 => 24,
            other => return Err(CuaError::Tool(format!("unsupported screenshot bits_per_pixel {other:?}"))),
        };
        let stride = if h == 0 { 0 } else { image.data().len() / h as usize };
        let lsb = image.byte_order() == ImageOrder::LsbFirst;
        encode::zpixmap_to_rgb(image.data(), image.width() as u32, image.height() as u32, stride, lsb, bpp, self.red_mask, self.green_mask, self.blue_mask, &mut self.rgb)?;
        let png = encode::encode_png_rgb(width, height, &self.rgb)?;
        let ms = started.elapsed().as_millis() as u64;
        if ms >= 50 { tracing::warn!(ms, get_ms, bytes = png.len(), "screenshot slow"); } else { tracing::debug!(ms, get_ms, bytes = png.len(), "screenshot"); }
        Ok(png)
    }
}

impl InputConn {
    fn connect(display: &str) -> Result<Self, CuaError> {
        let (conn, screen) = x11rb::connect(Some(display)).map_err(x_err)?;
        conn.extension_information(xtest::X11_EXTENSION_NAME).map_err(x_err)?.ok_or_else(|| CuaError::Tool("XTEST extension missing on display".into()))?;
        conn.xtest_get_version(2, 1).map_err(x_err)?.reply().map_err(x_err)?;
        let setup = conn.setup();
        let root = setup.roots.get(screen).ok_or_else(|| x_err("no screen"))?.root;
        let min_keycode = setup.min_keycode;
        let max_keycode = setup.max_keycode;
        let count = max_keycode.saturating_sub(min_keycode).saturating_add(1);
        let map = conn.get_keyboard_mapping(min_keycode, count).map_err(x_err)?.reply().map_err(x_err)?;
        let mods = conn.get_modifier_mapping().map_err(x_err)?.reply().map_err(x_err)?;
        let keycodes_per_mod = mods.keycodes_per_modifier();
        let mut this = Self { conn, keysyms: map.keysyms, mod_keycodes: mods.keycodes, root, min_keycode, keysyms_per: map.keysyms_per_keycode, shift_l: 0, control_l: 0, alt_l: 0, super_l: 0, keycodes_per_mod, scratch: max_keycode };
        this.shift_l = this.lookup_keycode(XK_SHIFT_L).unwrap_or(0);
        this.control_l = this.lookup_keycode(XK_CONTROL_L).unwrap_or(0);
        this.alt_l = this.lookup_keycode(XK_ALT_L).unwrap_or(0);
        this.super_l = this.lookup_keycode(XK_SUPER_L).unwrap_or(0);
        Ok(this)
    }
    fn lookup_keycode(&self, keysym: Keysym) -> Option<Keycode> { self.lookup(keysym).map(|(kc, _)| kc) }
    fn lookup(&self, keysym: Keysym) -> Option<(Keycode, bool)> {
        let per = self.keysyms_per as usize;
        if per == 0 { return None; }
        for (i, chunk) in self.keysyms.chunks(per).enumerate() {
            if chunk.first().copied() == Some(keysym) { return Some((self.min_keycode.saturating_add(i as u8), false)); }
            if per > 1 && chunk.get(1).copied() == Some(keysym) { return Some((self.min_keycode.saturating_add(i as u8), true)); }
        }
        None
    }
    fn fake(&self, ty: u8, detail: u8, x: i16, y: i16) -> Result<(), CuaError> {
        self.conn.xtest_fake_input(ty, detail, 0, NONE, x, y, 0).map_err(x_err)?; Ok(())
    }
    fn flush(&self) -> Result<(), CuaError> { self.conn.flush().map_err(x_err) }
    fn key(&self, keycode: Keycode, press: bool) -> Result<(), CuaError> {
        if keycode == 0 { return Err(x_err("missing keycode")); }
        let ty = if press { xproto::KEY_PRESS_EVENT } else { xproto::KEY_RELEASE_EVENT };
        self.fake(ty, keycode, 0, 0)
    }
    pub(crate) fn motion(&self, x: i32, y: i32) -> Result<(), CuaError> {
        let (x, y) = xy(x, y)?; self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?; self.flush()
    }
    pub(crate) fn pointer_press(&self, x: i32, y: i32, button: u8) -> Result<(), CuaError> {
        let (x, y) = xy(x, y)?; self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?; self.fake(xproto::BUTTON_PRESS_EVENT, button, 0, 0)?; self.flush()
    }
    pub(crate) fn button_up(&self, button: u8) -> Result<(), CuaError> {
        self.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?; self.flush()
    }
    pub(crate) fn button_click(&self, button: u8) -> Result<(), CuaError> {
        self.fake(xproto::BUTTON_PRESS_EVENT, button, 0, 0)?; self.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?; self.flush()
    }
    pub(crate) fn motion_path_and_release(&self, points: &[(i32, i32)], button: u8) -> Result<(), CuaError> {
        for &(x, y) in points { let (x, y) = xy(x, y)?; self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?; }
        self.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?; self.flush()
    }
    pub(crate) fn scroll(&self, x: i32, y: i32, dx: i32, dy: i32) -> Result<(), CuaError> {
        let (x, y) = xy(x, y)?; self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?;
        let wheel = |conn: &InputConn, button: u8, ticks: u32| -> Result<(), CuaError> {
            for _ in 0..ticks { conn.fake(xproto::BUTTON_PRESS_EVENT, button, 0, 0)?; conn.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?; }
            Ok(())
        };
        if dy != 0 { wheel(self, if dy > 0 { 5 } else { 4 }, crate::wheel_ticks(dy))?; }
        if dx != 0 { wheel(self, if dx > 0 { 7 } else { 6 }, crate::wheel_ticks(dx))?; }
        self.flush()
    }
}

pub(crate) async fn move_pointer(config: &CuaConfig, x: i32, y: i32) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.motion(x, y)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => { tracing::warn!(error = %err, "xtest motion failed; xdotool"); crate::xdotool::xdotool(config, &["mousemove", &x.to_string(), &y.to_string()]).await }
        None => crate::xdotool::xdotool(config, &["mousemove", &x.to_string(), &y.to_string()]).await,
    }
}
pub(crate) async fn pointer_press(config: &CuaConfig, x: i32, y: i32, button: u8) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.pointer_press(x, y, button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => { tracing::warn!(error = %err, "xtest press failed; xdotool"); crate::xdotool::xdotool_owned(config, &crate::pointer_press_args(x, y, button)).await }
        None => crate::xdotool::xdotool_owned(config, &crate::pointer_press_args(x, y, button)).await,
    }
}
pub(crate) async fn button_up(config: &CuaConfig, button: u8) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.button_up(button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => { tracing::warn!(error = %err, "xtest button-up failed; xdotool"); crate::xdotool::xdotool(config, &["mouseup", &button.to_string()]).await }
        None => crate::xdotool::xdotool(config, &["mouseup", &button.to_string()]).await,
    }
}
pub(crate) async fn button_click(config: &CuaConfig, button: u8) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.button_click(button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => { tracing::warn!(error = %err, "xtest click failed; xdotool"); crate::xdotool::xdotool(config, &["mousedown", &button.to_string(), "mouseup", &button.to_string()]).await }
        None => crate::xdotool::xdotool(config, &["mousedown", &button.to_string(), "mouseup", &button.to_string()]).await,
    }
}
pub(crate) async fn motion_path_and_release(config: &CuaConfig, points: &[(i32, i32)], extra: Option<(i32, i32)>, path: Option<&[CuaPoint]>, button: u8) -> Result<(), CuaError> {
    let mut all = ArrayVec::<(i32, i32), MAX_COLLECTED_POINTS>::new();
    for &pt in points { all.try_push(pt).map_err(|_| CuaError::Invalid("too many motion points".into()))?; }
    if let Some(path) = path { for p in path { all.try_push((p.x, p.y)).map_err(|_| CuaError::Invalid("too many motion points".into()))?; } }
    if let Some(xy) = extra { all.try_push(xy).map_err(|_| CuaError::Invalid("too many motion points".into()))?; }
    match with_native(&config.display, |c| c.motion_path_and_release(&all, button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => { tracing::warn!(error = %err, "xtest release failed; xdotool"); Err(err) }
        None => Err(CuaError::Tool("xtest unavailable".into())),
    }
}
pub(crate) async fn scroll(config: &CuaConfig, x: i32, y: i32, dx: i32, dy: i32) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.scroll(x, y, dx, dy)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => { tracing::warn!(error = %err, "xtest scroll failed; xdotool"); crate::xdotool::xdotool_owned(config, &crate::scroll_args(x, y, dx, dy)).await }
        None => crate::xdotool::xdotool_owned(config, &crate::scroll_args(x, y, dx, dy)).await,
    }
}
pub(crate) async fn type_text(config: &CuaConfig, text: &str) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.type_text(text)) {
        Some(Ok(())) => Ok(()),
        _ => crate::xdotool::xdotool(config, &["type", "--clearmodifiers", "--delay", "1", "--", text]).await,
    }
}
pub(crate) async fn key(config: &CuaConfig, key: &str, action: KeyAction) -> Result<(), CuaError> {
    let clear = matches!(action, KeyAction::Tap);
    match with_native(&config.display, |c| c.key_seq(key, action, clear)) {
        Some(Ok(())) => Ok(()),
        _ => match action {
            KeyAction::Tap => crate::xdotool::xdotool(config, &["key", "--clearmodifiers", key]).await,
            KeyAction::Down => crate::xdotool::xdotool(config, &["keydown", key]).await,
            KeyAction::Up => crate::xdotool::xdotool(config, &["keyup", key]).await,
        },
    }
}
