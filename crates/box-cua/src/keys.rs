//! xdotool-compatible key names → X11 keysyms.
//!
//! Names are matched case-insensitively. Chords use `+` (`ctrl+c`).
//! Unicode codepoints that are not Latin-1 become `0x01000000 | cp`
//! (the X11 Unicode keysym plane).

use smallvec::SmallVec;

use crate::CuaError;

pub const XK_BACKSPACE: u32 = 0xff08;
pub const XK_TAB: u32 = 0xff09;
pub const XK_RETURN: u32 = 0xff0d;
pub const XK_ESCAPE: u32 = 0xff1b;
pub const XK_DELETE: u32 = 0xffff;
pub const XK_HOME: u32 = 0xff50;
pub const XK_LEFT: u32 = 0xff51;
pub const XK_UP: u32 = 0xff52;
pub const XK_RIGHT: u32 = 0xff53;
pub const XK_DOWN: u32 = 0xff54;
pub const XK_PAGE_UP: u32 = 0xff55;
pub const XK_PAGE_DOWN: u32 = 0xff56;
pub const XK_END: u32 = 0xff57;
pub const XK_INSERT: u32 = 0xff63;
pub const XK_SHIFT_L: u32 = 0xffe1;
pub const XK_SHIFT_R: u32 = 0xffe2;
pub const XK_CONTROL_L: u32 = 0xffe3;
pub const XK_CONTROL_R: u32 = 0xffe4;
pub const XK_META_L: u32 = 0xffe7;
pub const XK_ALT_L: u32 = 0xffe9;
pub const XK_SUPER_L: u32 = 0xffeb;
pub const XK_SUPER_R: u32 = 0xffec;
pub const XK_MENU: u32 = 0xff67;
pub const XK_SPACE: u32 = 0x0020;
pub const XK_ISO_LEVEL3_SHIFT: u32 = 0xfe03;
pub const UNICODE_PLANE: u32 = 0x0100_0000;

/// Typical chords fit in four keysyms (`ctrl+alt+shift+key`) without a heap.
pub type KeySeq = SmallVec<[u32; 4]>;

/// Split `ctrl+c` / `Return` into keysyms (modifiers first, then the key).
pub fn parse_key_sequence(key: &str) -> Result<KeySeq, CuaError> {
    if key.is_empty() {
        return Err(CuaError::Invalid("key must not be empty".into()));
    }
    if key.chars().any(|c| c.is_whitespace() || c == ';') {
        return Err(CuaError::Invalid("key contains invalid characters".into()));
    }
    let mut out = KeySeq::new();
    for token in key.split('+') {
        if token.is_empty() {
            return Err(CuaError::Invalid(
                "key contains an empty chord token".into(),
            ));
        }
        let Some(ks) = keysym_from_token(token) else {
            return Err(CuaError::Invalid(format!("unknown key '{token}'")));
        };
        out.push(ks);
    }
    if out.is_empty() {
        return Err(CuaError::Invalid("key must not be empty".into()));
    }
    Ok(out)
}

pub fn char_to_keysym(ch: char) -> u32 {
    match ch {
        '\n' | '\r' => XK_RETURN,
        '\t' => XK_TAB,
        '\u{0008}' => XK_BACKSPACE,
        '\u{001b}' => XK_ESCAPE,
        '\u{007f}' => XK_DELETE,
        other => {
            let cp = other as u32;
            if cp < 0x100 {
                cp
            } else {
                UNICODE_PLANE | cp
            }
        }
    }
}

pub fn keysym_from_token(token: &str) -> Option<u32> {
    let t = token.strip_prefix("XK_").unwrap_or(token);
    if t.len() == 1 {
        // SAFETY: a valid `&str` of `len() == 1` is a single ASCII byte.
        let b = unsafe { *t.as_bytes().get_unchecked(0) };
        return Some(char_to_keysym(b as char));
    }
    let mut buf = [0u8; 32];
    let lower = ascii_lower(t, &mut buf)?;
    Some(match lower {
        "return" | "enter" | "kp_enter" => XK_RETURN,
        "tab" => XK_TAB,
        "escape" | "esc" => XK_ESCAPE,
        "backspace" | "bs" => XK_BACKSPACE,
        "delete" | "del" => XK_DELETE,
        "space" | "spacebar" => XK_SPACE,
        "home" => XK_HOME,
        "end" => XK_END,
        "left" => XK_LEFT,
        "right" => XK_RIGHT,
        "up" => XK_UP,
        "down" => XK_DOWN,
        "page_up" | "pageup" | "prior" => XK_PAGE_UP,
        "page_down" | "pagedown" | "next" => XK_PAGE_DOWN,
        "insert" | "ins" => XK_INSERT,
        "menu" => XK_MENU,
        "shift" | "shift_l" => XK_SHIFT_L,
        "shift_r" => XK_SHIFT_R,
        "ctrl" | "control" | "control_l" => XK_CONTROL_L,
        "control_r" | "ctrl_r" => XK_CONTROL_R,
        "alt" | "alt_l" | "mod1" => XK_ALT_L,
        "meta" | "meta_l" => XK_META_L,
        "super" | "super_l" | "win" | "cmd" | "mod4" => XK_SUPER_L,
        "super_r" => XK_SUPER_R,
        "altgr" | "iso_level3_shift" | "mode_switch" => XK_ISO_LEVEL3_SHIFT,
        "plus" | "kp_add" => 0x002b,
        "minus" | "kp_subtract" => 0x002d,
        "equal" => 0x003d,
        "comma" => 0x002c,
        "period" | "kp_decimal" => 0x002e,
        "slash" => 0x002f,
        "backslash" => 0x005c,
        "apostrophe" | "quotedbl" => {
            if lower == "quotedbl" {
                0x0022
            } else {
                0x0027
            }
        }
        "grave" => 0x0060,
        "semicolon" => 0x003b,
        "bracketleft" => 0x005b,
        "bracketright" => 0x005d,
        "f1" => 0xffbe,
        "f2" => 0xffbf,
        "f3" => 0xffc0,
        "f4" => 0xffc1,
        "f5" => 0xffc2,
        "f6" => 0xffc3,
        "f7" => 0xffc4,
        "f8" => 0xffc5,
        "f9" => 0xffc6,
        "f10" => 0xffc7,
        "f11" => 0xffc8,
        "f12" => 0xffc9,
        "kp_0" => 0xffb0,
        "kp_1" => 0xffb1,
        "kp_2" => 0xffb2,
        "kp_3" => 0xffb3,
        "kp_4" => 0xffb4,
        "kp_5" => 0xffb5,
        "kp_6" => 0xffb6,
        "kp_7" => 0xffb7,
        "kp_8" => 0xffb8,
        "kp_9" => 0xffb9,
        "kp_multiply" => 0xffaa,
        "kp_divide" => 0xffaf,
        "caps_lock" | "capslock" => 0xffe5,
        "num_lock" | "numlock" => 0xff7f,
        "scroll_lock" | "scrolllock" => 0xff14,
        "print" | "printscreen" => 0xff61,
        other => {
            if other.len() == 1 {
                // SAFETY: `ascii_lower` produced this ASCII `&str`; `len()==1`
                // is one byte.
                let b = unsafe { *other.as_bytes().get_unchecked(0) };
                return Some(char_to_keysym(b as char));
            }
            return None;
        }
    })
}

fn ascii_lower<'a>(token: &str, buf: &'a mut [u8; 32]) -> Option<&'a str> {
    let n = token.len();
    if n > buf.len() || !token.is_ascii() {
        return None;
    }
    // SAFETY: `n <= buf.len()` so `get_unchecked_mut(..n)` is in-bounds.
    let dst = unsafe { buf.get_unchecked_mut(..n) };
    for (slot, b) in dst.iter_mut().zip(token.bytes()) {
        *slot = b.to_ascii_lowercase();
    }
    // SAFETY: `token` was ASCII and `to_ascii_lowercase` preserves ASCII, so
    // the copied prefix is valid UTF-8.
    Some(unsafe { std::str::from_utf8_unchecked(&buf[..n]) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chords_and_aliases() {
        assert_eq!(
            parse_key_sequence("Return").unwrap().as_slice(),
            [XK_RETURN]
        );
        assert_eq!(
            parse_key_sequence("ctrl+c").unwrap().as_slice(),
            [XK_CONTROL_L, b'c' as u32]
        );
        assert_eq!(parse_key_sequence("shift+Tab").unwrap()[0], XK_SHIFT_L);
        assert!(parse_key_sequence("not a key").is_err());
        assert!(parse_key_sequence("bad;key").is_err());
        assert_eq!(char_to_keysym('A'), b'A' as u32);
        assert_eq!(char_to_keysym('\n'), XK_RETURN);
        assert_eq!(char_to_keysym('€'), UNICODE_PLANE | '€' as u32);
        assert_eq!(keysym_from_token("F12"), Some(0xffc9));
    }
}
