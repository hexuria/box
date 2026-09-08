use super::*;
use arrayvec::ArrayVec;
use smallvec::SmallVec;
use x11rb::connection::RequestConnection;
use x11rb::protocol::xproto::{self, ConnectionExt as _, KeyButMask, Keycode, Keysym};
use crate::keys::char_to_keysym;
use crate::KeyAction;

struct MappingGuard<'a> {
    conn: &'a x11rb::rust_connection::RustConnection,
    keycode: Keycode,
    per: u8,
    old: Vec<Keysym>,
}

impl Drop for MappingGuard<'_> {
    fn drop(&mut self) {
        let _ = self.conn.change_keyboard_mapping(1, self.keycode, self.per, &self.old);
        let _ = self.conn.flush();
    }
}

fn key_but_mask_bits(mask: KeyButMask) -> u16 { u16::from(mask) }

impl InputConn {
    fn sync(&self) -> Result<(), CuaError> {
        self.flush()?;
        let _ = self.conn.get_input_focus().map_err(x_err)?.reply().map_err(x_err)?;
        Ok(())
    }

    fn release_mask(&self, mask: u16) -> Result<ArrayVec<Keycode, 8>, CuaError> {
        let mut released = ArrayVec::new();
        let per = self.keycodes_per_mod as usize;
        if per == 0 { return Ok(released); }
        for mod_index in 0..8 {
            if mask & (1 << mod_index) == 0 { continue; }
            let start = mod_index * per;
            let Some(&kc) = self.mod_keycodes.get(start..start + per).and_then(|s| s.iter().find(|c| **c != 0)) else { continue; };
            self.key(kc, false)?;
            unsafe { released.push_unchecked(kc) };
        }
        Ok(released)
    }

    fn query_mod_mask(&self) -> Result<u16, CuaError> {
        let reply = self.conn.query_pointer(self.root).map_err(x_err)?.reply().map_err(x_err)?;
        Ok(key_but_mask_bits(reply.mask))
    }

    fn send_keysym(&mut self, keysym: Keysym, action: KeyAction) -> Result<(), CuaError> {
        if let Some((kc, shift)) = self.lookup(keysym) {
            match action {
                KeyAction::Tap => {
                    if shift { self.key(self.shift_l, true)?; }
                    self.key(kc, true)?;
                    self.key(kc, false)?;
                    if shift { self.key(self.shift_l, false)?; }
                }
                KeyAction::Down => {
                    if shift { self.key(self.shift_l, true)?; }
                    self.key(kc, true)?;
                }
                KeyAction::Up => {
                    self.key(kc, false)?;
                    if shift { self.key(self.shift_l, false)?; }
                }
            }
            return Ok(());
        }
        self.send_via_scratch(keysym, action)
    }

    fn send_via_scratch(&mut self, keysym: Keysym, action: KeyAction) -> Result<(), CuaError> {
        let per = self.keysyms_per.max(1);
        let old = self.conn.get_keyboard_mapping(self.scratch, 1).map_err(x_err)?.reply().map_err(x_err)?;
        let new = SmallVec::<[Keysym; 8]>::from_elem(keysym, per as usize);
        self.conn.change_keyboard_mapping(1, self.scratch, per, &new).map_err(x_err)?;
        self.sync()?;
        let _guard = MappingGuard { conn: &self.conn, keycode: self.scratch, per, old: old.keysyms };
        match action {
            KeyAction::Tap => { self.key(self.scratch, true)?; self.key(self.scratch, false)?; }
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
        for kc in released { self.key(kc, true)?; }
        self.flush()
    }

    pub(crate) fn key_seq(&mut self, key: &str, action: KeyAction, clear: bool) -> Result<(), CuaError> {
        let seq = crate::keys::parse_key_sequence(key)?;
        let released = if clear {
            let mask = self.query_mod_mask()?;
            self.release_mask(mask)?
        } else { ArrayVec::new() };
        match action {
            KeyAction::Tap => {
                for ks in &seq { self.send_keysym(*ks, KeyAction::Down)?; }
                for ks in seq.iter().rev() { self.send_keysym(*ks, KeyAction::Up)?; }
            }
            KeyAction::Down => { for ks in &seq { self.send_keysym(*ks, KeyAction::Down)?; } }
            KeyAction::Up => { for ks in seq.iter().rev() { self.send_keysym(*ks, KeyAction::Up)?; } }
        }
        if clear { for kc in released { self.key(kc, true)?; } }
        self.flush()
    }
}

#[cfg(test)]
mod live {
    use super::*;

    fn live_display() -> Option<String> {
        let display = std::env::var("DISPLAY").ok().filter(|d| !d.is_empty())?;
        let num = display.trim().trim_start_matches(':').split('.').next().unwrap_or("1");
        if std::path::Path::new("/tmp/.X11-unix").join(format!("X{num}")).exists() { Some(display) } else { None }
    }

    #[test]
    fn getimage_png_when_display_is_up() {
        let Some(display) = live_display() else { return; };
        let png = capture_png(&display, 1280, 800).expect("GetImage PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(png.len() > 64, "png too small: {}", png.len());
    }

    #[test]
    fn xtest_motion_when_display_is_up() {
        let Some(display) = live_display() else { return; };
        with_native(&display, |c| c.motion(16, 16)).expect("XTEST should be present").expect("motion");
    }
}
