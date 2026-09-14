//! Boolean and optional env helpers shared by guest crates.
//!
//! `BOX_DESKTOP`, `BOX_CHROME`, `BOX_CUA`, and friends used to each parse
//! truthy strings differently. One helper: unset → `default`; empty →
//! `default`; `0` / `false` / `off` / `no` → false; anything else → true.

use std::env;

/// Parse a boolean environment variable.
pub fn env_bool(var: &str, default: bool) -> bool {
    match env::var(var) {
        Ok(raw) => parse_bool(&raw, default),
        Err(_) => default,
    }
}

fn parse_bool(raw: &str, default: bool) -> bool {
    let v = raw.trim().to_ascii_lowercase();
    if v.is_empty() {
        default
    } else {
        !matches!(v.as_str(), "0" | "false" | "off" | "no")
    }
}

/// Non-empty env var, trimmed.
pub fn env_nonempty(var: &str) -> Option<String> {
    env::var(var)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static LOCK: Mutex<()> = Mutex::new(());

    fn with_var(key: &str, value: Option<&str>, f: impl FnOnce()) {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let prev = env::var(key).ok();
        match value {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
        f();
        match prev {
            Some(v) => env::set_var(key, v),
            None => env::remove_var(key),
        }
    }

    #[test]
    fn false_tokens() {
        for v in ["0", "false", "OFF", "no", " False "] {
            with_var("BOX_ENV_BOOL_TEST", Some(v), || {
                assert!(!env_bool("BOX_ENV_BOOL_TEST", true), "{v}");
            });
        }
    }

    #[test]
    fn true_tokens() {
        for v in ["1", "true", "yes", "on", "2"] {
            with_var("BOX_ENV_BOOL_TEST", Some(v), || {
                assert!(env_bool("BOX_ENV_BOOL_TEST", false), "{v}");
            });
        }
    }

    #[test]
    fn unset_and_empty_use_default() {
        with_var("BOX_ENV_BOOL_TEST", None, || {
            assert!(env_bool("BOX_ENV_BOOL_TEST", true));
            assert!(!env_bool("BOX_ENV_BOOL_TEST", false));
        });
        with_var("BOX_ENV_BOOL_TEST", Some("  "), || {
            assert!(env_bool("BOX_ENV_BOOL_TEST", true));
            assert!(!env_bool("BOX_ENV_BOOL_TEST", false));
        });
    }
}
