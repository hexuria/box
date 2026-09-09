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
use crate::keys::{
    char_to_keysym, parse_key_sequence, XK_ALT_L, XK_CONTROL_L, XK_SHIFT_L, XK_SUPER_L,
};
use crate::{CuaConfig, CuaError, CuaPoint, KeyAction, MAX_COLLECTED_POINTS};

static INPUT: Mutex<Option<InputState>> = Mutex::new(None);
static SHOT: Mutex<Option<ShotConn>> = Mutex::new(None);

struct InputState {
    display: String,
    backend: Backend,
}

enum Backend {
    Native(InputConn),
    /// XTEST unavailable; callers use xdotool.
    Cli,
}

/// Persistent XTEST connection. Vecs first, then packed keycodes — no
/// `repr(C)` / `packed` (this is not FFI).
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

struct MappingGuard<'a> {
    conn: &'a RustConnection,
    keycode: Keycode,
    per: u8,
    old: Vec<Keysym>,
}

impl Drop for MappingGuard<'_> {
    fn drop(&mut self) {
        let _ = self
            .conn
            .change_keyboard_mapping(1, self.keycode, self.per, &self.old);
        let _ = self.conn.flush();
    }
}

fn lock_input() -> std::sync::MutexGuard<'static, Option<InputState>> {
    INPUT.lock().unwrap_or_else(|e| e.into_inner())
}

fn lock_shot() -> std::sync::MutexGuard<'static, Option<ShotConn>> {
    SHOT.lock().unwrap_or_else(|e| e.into_inner())
}

fn x_err(err: impl std::fmt::Display) -> CuaError {
    CuaError::Tool(format!("x11: {err}"))
}

/// Run `op` on a live XTEST connection. `None` means use the CLI fallback.
pub(crate) fn with_native<T>(
    dpy: &str,
    op: impl FnOnce(&mut InputConn) -> Result<T, CuaError>,
) -> Option<Result<T, CuaError>> {
    let mut guard = lock_input();
    let state = guard.get_or_insert_with(|| match InputConn::connect(dpy) {
        Ok(conn) => {
            tracing::info!(display = dpy, "cua xtest connected");
            InputState {
                display: dpy.to_string(),
                backend: Backend::Native(conn),
            }
        }
        Err(err) => {
            tracing::warn!(display = dpy, error = %err, "cua xtest unavailable; xdotool fallback");
            InputState {
                display: dpy.to_string(),
                backend: Backend::Cli,
            }
        }
    });
    if state.display != dpy {
        *state = match InputConn::connect(dpy) {
            Ok(conn) => InputState {
                display: dpy.to_string(),
                backend: Backend::Native(conn),
            },
            Err(_) => InputState {
                display: dpy.to_string(),
                backend: Backend::Cli,
            },
        };
    }
    match &mut state.backend {
        Backend::Cli => None,
        Backend::Native(conn) => {
            let result = op(conn);
            if result.is_err() {
                // Drop a broken socket so the next call reconnects (or falls back).
                *guard = None;
            }
            Some(result)
        }
    }
}

pub(crate) fn capture_png(display: &str, width: u32, height: u32) -> Result<Vec<u8>, CuaError> {
    let mut guard = lock_shot();
    let need_new = match guard.as_ref() {
        Some(c) => c.display != display,
        None => true,
    };
    if need_new {
        *guard = Some(ShotConn::connect(display)?);
    }
    // SAFETY: `need_new` inserted `Some`, otherwise a previous `Some` was kept.
    let shot = unsafe { guard.as_mut().unwrap_unchecked() };
    match shot.capture(width, height) {
        Ok(png) => Ok(png),
        Err(err) => {
            *guard = None;
            Err(err)
        }
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
                    red_mask = vis.red_mask;
                    green_mask = vis.green_mask;
                    blue_mask = vis.blue_mask;
                }
            }
        }
        Ok(Self {
            conn,
            display: display.to_string(),
            rgb: Vec::new(),
            root,
            red_mask,
            green_mask,
            blue_mask,
        })
    }

    fn capture(&mut self, width: u32, height: u32) -> Result<Vec<u8>, CuaError> {
        let w = u16::try_from(width).map_err(|_| x_err("width"))?;
        let h = u16::try_from(height).map_err(|_| x_err("height"))?;
        let started = Instant::now();
        let (image, _) = Image::get(&self.conn, self.root, 0, 0, w, h).map_err(x_err)?;
        let get_ms = started.elapsed().as_millis() as u64;
        let needed = width as usize * height as usize * 3;
        if self.rgb.len() != needed {
            self.rgb.clear();
            self.rgb.resize(needed, 0);
        }
        let bpp = match image.bits_per_pixel() {
            BitsPerPixel::B32 => 32,
            BitsPerPixel::B24 => 24,
            other => {
                return Err(CuaError::Tool(format!(
                    "unsupported screenshot bits_per_pixel {other:?}"
                )))
            }
        };
        let stride = if h == 0 {
            0
        } else {
            image.data().len() / h as usize
        };
        let lsb = image.byte_order() == ImageOrder::LsbFirst;
        encode::zpixmap_to_rgb(
            image.data(),
            image.width() as u32,
            image.height() as u32,
            stride,
            lsb,
            bpp,
            self.red_mask,
            self.green_mask,
            self.blue_mask,
            &mut self.rgb,
        )?;
        let png = encode::encode_png_rgb(width, height, &self.rgb)?;
        let ms = started.elapsed().as_millis() as u64;
        if ms >= 50 {
            tracing::warn!(ms, get_ms, bytes = png.len(), "screenshot slow");
        } else {
            tracing::debug!(ms, get_ms, bytes = png.len(), "screenshot");
        }
        Ok(png)
    }
}

impl InputConn {
    fn connect(display: &str) -> Result<Self, CuaError> {
        let (conn, screen) = x11rb::connect(Some(display)).map_err(x_err)?;
        conn.extension_information(xtest::X11_EXTENSION_NAME)
            .map_err(x_err)?
            .ok_or_else(|| CuaError::Tool("XTEST extension missing on display".into()))?;
        conn.xtest_get_version(2, 1)
            .map_err(x_err)?
            .reply()
            .map_err(x_err)?;
        let setup = conn.setup();
        let root = setup
            .roots
            .get(screen)
            .ok_or_else(|| x_err("no screen"))?
            .root;
        let min_keycode = setup.min_keycode;
        let max_keycode = setup.max_keycode;
        let count = max_keycode.saturating_sub(min_keycode).saturating_add(1);
        let map = conn
            .get_keyboard_mapping(min_keycode, count)
            .map_err(x_err)?
            .reply()
            .map_err(x_err)?;
        let mods = conn
            .get_modifier_mapping()
            .map_err(x_err)?
            .reply()
            .map_err(x_err)?;
        let keycodes_per_mod = mods.keycodes_per_modifier();
        let mut this = Self {
            conn,
            keysyms: map.keysyms,
            mod_keycodes: mods.keycodes,
            root,
            min_keycode,
            keysyms_per: map.keysyms_per_keycode,
            shift_l: 0,
            control_l: 0,
            alt_l: 0,
            super_l: 0,
            keycodes_per_mod,
            scratch: max_keycode,
        };
        this.shift_l = this.lookup_keycode(XK_SHIFT_L).unwrap_or(0);
        this.control_l = this.lookup_keycode(XK_CONTROL_L).unwrap_or(0);
        this.alt_l = this.lookup_keycode(XK_ALT_L).unwrap_or(0);
        this.super_l = this.lookup_keycode(XK_SUPER_L).unwrap_or(0);
        Ok(this)
    }

    fn lookup_keycode(&self, keysym: Keysym) -> Option<Keycode> {
        self.lookup(keysym).map(|(kc, _)| kc)
    }

    /// `(keycode, need_shift)` for a keysym in the current map.
    fn lookup(&self, keysym: Keysym) -> Option<(Keycode, bool)> {
        let per = self.keysyms_per as usize;
        if per == 0 {
            return None;
        }
        for (i, chunk) in self.keysyms.chunks(per).enumerate() {
            if chunk.first().copied() == Some(keysym) {
                return Some((self.min_keycode.saturating_add(i as u8), false));
            }
            if per > 1 && chunk.get(1).copied() == Some(keysym) {
                return Some((self.min_keycode.saturating_add(i as u8), true));
            }
        }
        None
    }

    fn fake(&self, ty: u8, detail: u8, x: i16, y: i16) -> Result<(), CuaError> {
        self.conn
            .xtest_fake_input(ty, detail, 0, NONE, x, y, 0)
            .map_err(x_err)?;
        Ok(())
    }

    fn flush(&self) -> Result<(), CuaError> {
        self.conn.flush().map_err(x_err)
    }

    fn sync(&self) -> Result<(), CuaError> {
        self.flush()?;
        let _ = self
            .conn
            .get_input_focus()
            .map_err(x_err)?
            .reply()
            .map_err(x_err)?;
        Ok(())
    }

    fn key(&self, keycode: Keycode, press: bool) -> Result<(), CuaError> {
        if keycode == 0 {
            return Err(x_err("missing keycode"));
        }
        let ty = if press {
            xproto::KEY_PRESS_EVENT
        } else {
            xproto::KEY_RELEASE_EVENT
        };
        self.fake(ty, keycode, 0, 0)
    }

    pub(crate) fn motion(&self, x: i32, y: i32) -> Result<(), CuaError> {
        let (x, y) = xy(x, y)?;
        self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?;
        self.flush()
    }

    pub(crate) fn pointer_press(&self, x: i32, y: i32, button: u8) -> Result<(), CuaError> {
        let (x, y) = xy(x, y)?;
        self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?;
        self.fake(xproto::BUTTON_PRESS_EVENT, button, 0, 0)?;
        self.flush()
    }

    pub(crate) fn button_up(&self, button: u8) -> Result<(), CuaError> {
        self.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?;
        self.flush()
    }

    pub(crate) fn button_click(&self, button: u8) -> Result<(), CuaError> {
        self.fake(xproto::BUTTON_PRESS_EVENT, button, 0, 0)?;
        self.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?;
        self.flush()
    }

    pub(crate) fn motion_path_and_release(
        &self,
        points: &[(i32, i32)],
        button: u8,
    ) -> Result<(), CuaError> {
        for &(x, y) in points {
            let (x, y) = xy(x, y)?;
            self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?;
        }
        self.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?;
        self.flush()
    }

    pub(crate) fn scroll(&self, x: i32, y: i32, dx: i32, dy: i32) -> Result<(), CuaError> {
        let (x, y) = xy(x, y)?;
        self.fake(xproto::MOTION_NOTIFY_EVENT, 0, x, y)?;
        fn wheel(conn: &InputConn, button: u8, ticks: u32) -> Result<(), CuaError> {
            for _ in 0..ticks {
                conn.fake(xproto::BUTTON_PRESS_EVENT, button, 0, 0)?;
                conn.fake(xproto::BUTTON_RELEASE_EVENT, button, 0, 0)?;
            }
            Ok(())
        }
        if dy != 0 {
            let button = if dy > 0 { 5 } else { 4 };
            wheel(self, button, crate::wheel_ticks(dy))?;
        }
        if dx != 0 {
            let button = if dx > 0 { 7 } else { 6 };
            wheel(self, button, crate::wheel_ticks(dx))?;
        }
        self.flush()
    }

    fn release_mask(&self, mask: u16) -> Result<ArrayVec<Keycode, 8>, CuaError> {
        let mut released = ArrayVec::new();
        let per = self.keycodes_per_mod as usize;
        if per == 0 {
            return Ok(released);
        }
        // X modifier order: Shift, Lock, Control, Mod1..Mod5.
        for mod_index in 0..8 {
            if mask & (1 << mod_index) == 0 {
                continue;
            }
            let start = mod_index * per;
            let Some(&kc) = self
                .mod_keycodes
                .get(start..start + per)
                .and_then(|s| s.iter().find(|c| **c != 0))
            else {
                continue;
            };
            self.key(kc, false)?;
            // SAFETY: at most 8 modifiers, matching ArrayVec cap.
            unsafe { released.push_unchecked(kc) };
        }
        Ok(released)
    }

    fn query_mod_mask(&self) -> Result<u16, CuaError> {
        let reply = self
            .conn
            .query_pointer(self.root)
            .map_err(x_err)?
            .reply()
            .map_err(x_err)?;
        Ok(key_but_mask_bits(reply.mask))
    }

    fn send_keysym(&mut self, keysym: Keysym, action: KeyAction) -> Result<(), CuaError> {
        if let Some((kc, shift)) = self.lookup(keysym) {
            match action {
                KeyAction::Tap => {
                    if shift {
                        self.key(self.shift_l, true)?;
                    }
                    self.key(kc, true)?;
                    self.key(kc, false)?;
                    if shift {
                        self.key(self.shift_l, false)?;
                    }
                }
                KeyAction::Down => {
                    if shift {
                        self.key(self.shift_l, true)?;
                    }
                    self.key(kc, true)?;
                }
                KeyAction::Up => {
                    self.key(kc, false)?;
                    if shift {
                        self.key(self.shift_l, false)?;
                    }
                }
            }
            return Ok(());
        }
        self.send_via_scratch(keysym, action)
    }

    fn send_via_scratch(&mut self, keysym: Keysym, action: KeyAction) -> Result<(), CuaError> {
        let per = self.keysyms_per.max(1);
        let old = self
            .conn
            .get_keyboard_mapping(self.scratch, 1)
            .map_err(x_err)?
            .reply()
            .map_err(x_err)?;
        let new = SmallVec::<[Keysym; 8]>::from_elem(keysym, per as usize);
        self.conn
            .change_keyboard_mapping(1, self.scratch, per, &new)
            .map_err(x_err)?;
        self.sync()?;
        let _guard = MappingGuard {
            conn: &self.conn,
            keycode: self.scratch,
            per,
            old: old.keysyms,
        };
        match action {
            KeyAction::Tap => {
                self.key(self.scratch, true)?;
                self.key(self.scratch, false)?;
            }
            KeyAction::Down => self.key(self.scratch, true)?,
            KeyAction::Up => self.key(self.scratch, false)?,
        }
        self.flush()?;
        Ok(())
    }

    pub(crate) fn type_text(&mut self, text: &str) -> Result<(), CuaError> {
        let mask = self.query_mod_mask()?;
        let released = self.release_mask(mask)?;
        for ch in text.chars() {
            self.send_keysym(char_to_keysym(ch), KeyAction::Tap)?;
        }
        for kc in released {
            self.key(kc, true)?;
        }
        self.flush()
    }

    pub(crate) fn key_seq(
        &mut self,
        key: &str,
        action: KeyAction,
        clear: bool,
    ) -> Result<(), CuaError> {
        let seq = parse_key_sequence(key)?;
        let released = if clear {
            let mask = self.query_mod_mask()?;
            self.release_mask(mask)?
        } else {
            ArrayVec::new()
        };
        match action {
            KeyAction::Tap => {
                for ks in &seq {
                    self.send_keysym(*ks, KeyAction::Down)?;
                }
                for ks in seq.iter().rev() {
                    self.send_keysym(*ks, KeyAction::Up)?;
                }
            }
            KeyAction::Down => {
                for ks in &seq {
                    self.send_keysym(*ks, KeyAction::Down)?;
                }
            }
            KeyAction::Up => {
                for ks in seq.iter().rev() {
                    self.send_keysym(*ks, KeyAction::Up)?;
                }
            }
        }
        if clear {
            for kc in released {
                self.key(kc, true)?;
            }
        }
        self.flush()
    }
}

fn xy(x: i32, y: i32) -> Result<(i16, i16), CuaError> {
    Ok((
        i16::try_from(x).map_err(|_| CuaError::Invalid("x does not fit i16".into()))?,
        i16::try_from(y).map_err(|_| CuaError::Invalid("y does not fit i16".into()))?,
    ))
}

fn key_but_mask_bits(mask: KeyButMask) -> u16 {
    u16::from(mask)
}

pub(crate) async fn move_pointer(config: &CuaConfig, x: i32, y: i32) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.motion(x, y)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest motion failed; xdotool");
            crate::xdotool::xdotool(config, &["mousemove", &x.to_string(), &y.to_string()]).await
        }
        None => {
            crate::xdotool::xdotool(config, &["mousemove", &x.to_string(), &y.to_string()]).await
        }
    }
}

pub(crate) async fn pointer_press(
    config: &CuaConfig,
    x: i32,
    y: i32,
    button: u8,
) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.pointer_press(x, y, button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest press failed; xdotool");
            crate::xdotool::xdotool_owned(config, &crate::pointer_press_args(x, y, button)).await
        }
        None => {
            crate::xdotool::xdotool_owned(config, &crate::pointer_press_args(x, y, button)).await
        }
    }
}

pub(crate) async fn button_up(config: &CuaConfig, button: u8) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.button_up(button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest button-up failed; xdotool");
            crate::xdotool::xdotool(config, &["mouseup", &button.to_string()]).await
        }
        None => crate::xdotool::xdotool(config, &["mouseup", &button.to_string()]).await,
    }
}

pub(crate) async fn button_click(config: &CuaConfig, button: u8) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.button_click(button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest click failed; xdotool");
            crate::xdotool::xdotool(
                config,
                &[
                    "mousedown",
                    &button.to_string(),
                    "mouseup",
                    &button.to_string(),
                ],
            )
            .await
        }
        None => {
            crate::xdotool::xdotool(
                config,
                &[
                    "mousedown",
                    &button.to_string(),
                    "mouseup",
                    &button.to_string(),
                ],
            )
            .await
        }
    }
}

pub(crate) async fn motion_path_and_release(
    config: &CuaConfig,
    points: &[(i32, i32)],
    extra: Option<(i32, i32)>,
    path: Option<&[CuaPoint]>,
    button: u8,
) -> Result<(), CuaError> {
    let mut all = ArrayVec::<(i32, i32), MAX_COLLECTED_POINTS>::new();
    for &pt in points {
        all.try_push(pt)
            .map_err(|_| CuaError::Invalid("too many motion points".into()))?;
    }
    if let Some(path) = path {
        for p in path {
            all.try_push((p.x, p.y))
                .map_err(|_| CuaError::Invalid("too many motion points".into()))?;
        }
    }
    if let Some(xy) = extra {
        all.try_push(xy)
            .map_err(|_| CuaError::Invalid("too many motion points".into()))?;
    }
    match with_native(&config.display, |c| c.motion_path_and_release(&all, button)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest release failed; xdotool");
            Err(err)
        }
        None => Err(CuaError::Tool("xtest unavailable".into())),
    }
}

pub(crate) async fn scroll(
    config: &CuaConfig,
    x: i32,
    y: i32,
    dx: i32,
    dy: i32,
) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.scroll(x, y, dx, dy)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest scroll failed; xdotool");
            crate::xdotool::xdotool_owned(config, &crate::scroll_args(x, y, dx, dy)).await
        }
        None => crate::xdotool::xdotool_owned(config, &crate::scroll_args(x, y, dx, dy)).await,
    }
}

pub(crate) async fn type_text(config: &CuaConfig, text: &str) -> Result<(), CuaError> {
    match with_native(&config.display, |c| c.type_text(text)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest type failed; xdotool");
            crate::xdotool::xdotool(
                config,
                &["type", "--clearmodifiers", "--delay", "1", "--", text],
            )
            .await
        }
        None => {
            crate::xdotool::xdotool(
                config,
                &["type", "--clearmodifiers", "--delay", "1", "--", text],
            )
            .await
        }
    }
}

pub(crate) async fn key(config: &CuaConfig, key: &str, action: KeyAction) -> Result<(), CuaError> {
    let clear = matches!(action, KeyAction::Tap);
    match with_native(&config.display, |c| c.key_seq(key, action, clear)) {
        Some(Ok(())) => Ok(()),
        Some(Err(err)) => {
            tracing::warn!(error = %err, "xtest key failed; xdotool");
            xdotool_key(config, key, action).await
        }
        None => xdotool_key(config, key, action).await,
    }
}

async fn xdotool_key(config: &CuaConfig, key: &str, action: KeyAction) -> Result<(), CuaError> {
    match action {
        KeyAction::Tap => crate::xdotool::xdotool(config, &["key", "--clearmodifiers", key]).await,
        KeyAction::Down => crate::xdotool::xdotool(config, &["keydown", key]).await,
        KeyAction::Up => crate::xdotool::xdotool(config, &["keyup", key]).await,
    }
}

#[cfg(test)]
mod live {
    use super::*;

    fn live_display() -> Option<String> {
        let display = std::env::var("DISPLAY").ok().filter(|d| !d.is_empty())?;
        let num = display
            .trim()
            .trim_start_matches(':')
            .split('.')
            .next()
            .unwrap_or("1");
        if std::path::Path::new("/tmp/.X11-unix")
            .join(format!("X{num}"))
            .exists()
        {
            Some(display)
        } else {
            None
        }
    }

    #[test]
    fn getimage_png_when_display_is_up() {
        let Some(display) = live_display() else {
            return;
        };
        let png = capture_png(&display, 1280, 800).expect("GetImage PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(png.len() > 64, "png too small: {}", png.len());
    }

    #[test]
    fn xtest_motion_when_display_is_up() {
        let Some(display) = live_display() else {
            return;
        };
        with_native(&display, |c| c.motion(16, 16))
            .expect("XTEST should be present")
            .expect("motion");
    }
}
