//! The page in front of Chromium, as the box's own extension reports it.
//!
//! Chromium in the box has no DevTools port, so that nothing in the box (the Bot's shell
//! included) can drive the browser or read its cookies. To still know which page is in
//! front, the image loads a small extension (`docker/active-tab`) with only the `tabs`
//! permission. It sends the front tab's URL over native messaging to `box-active-tab`, which
//! keeps the latest in [`ACTIVE_TAB_FILE`]; `GET /v1/chrome/active-tab` reads it back.
//!
//! The server asks before it types a saved login, and types nothing when the page in front is
//! not the login's own site. The file is written by the box user, so a process in the box
//! could write it too. It answers "which page is in front", not "prove no one lied", and
//! is no weaker than the box itself, whose user can already read the browser's profile.

use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Where `box-active-tab` keeps the latest report. Removed when Chromium closes the port.
pub const ACTIVE_TAB_FILE: &str = "/tmp/box-active-tab.json";

/// Native messaging caps a message to the host at 64 MiB; a URL is far smaller, and anything
/// past this is not the extension speaking.
const MAX_MESSAGE: u32 = 64 * 1024;

/// The page in front, or none known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveTab {
    /// The front tab's URL; `None` when nothing has reported (no Chromium, or one started
    /// without the extension).
    pub url: Option<String>,
    /// When the extension last reported, in ms since the epoch.
    #[serde(rename = "atMs", skip_serializing_if = "Option::is_none")]
    pub at_ms: Option<u64>,
}

/// One native-messaging message: a 4-byte length in native byte order, then that much JSON.
/// `None` at a clean end of input, which is Chromium closing the port.
pub fn read_message(input: &mut impl Read) -> io::Result<Option<serde_json::Value>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let len = u32::from_ne_bytes(len);
    if len > MAX_MESSAGE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "message too long",
        ));
    }
    let mut body = vec![0u8; len as usize];
    input.read_exact(&mut body)?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// Keep `url` as the page in front: a new file renamed over the old, so a reader never sees
/// half of one.
pub fn record(path: &Path, url: &str) -> io::Result<()> {
    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let tab = ActiveTab {
        url: Some(url.to_string()),
        at_ms: Some(at_ms),
    };
    let tmp = path.with_extension("json.tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec(&tab)?)?;
    file.sync_all()?;
    std::fs::rename(tmp, path)
}

/// What the file says, or nothing known when it is missing or unreadable.
pub fn read(path: &Path) -> ActiveTab {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(ActiveTab {
            url: None,
            at_ms: None,
        })
}

/// The host's whole life: record every report until Chromium closes the port, then forget,
/// so a browser that is gone is never taken for one showing its last page.
pub fn serve(input: &mut impl Read, path: &Path) -> io::Result<()> {
    let result = (|| {
        while let Some(message) = read_message(input)? {
            if let Some(url) = message.get("url").and_then(serde_json::Value::as_str) {
                record(path, url)?;
            }
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(path);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn framed(json: &str) -> Vec<u8> {
        let mut bytes = (json.len() as u32).to_ne_bytes().to_vec();
        bytes.extend_from_slice(json.as_bytes());
        bytes
    }

    #[test]
    fn the_last_report_is_what_is_in_front_until_the_port_closes() {
        let dir = std::env::temp_dir().join(format!("active-tab-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tab.json");
        let mut input = framed(r#"{"url":"https://www.youtube.com/"}"#);
        input.extend(framed(r#"{"url":"https://www.facebook.com/login"}"#));

        // Read as it arrives: after both reports, the second is in front.
        let mut reader = &input[..];
        while let Some(message) = read_message(&mut reader).unwrap() {
            record(&path, message["url"].as_str().unwrap()).unwrap();
        }
        assert_eq!(
            read(&path).url.as_deref(),
            Some("https://www.facebook.com/login")
        );

        // The whole life: once Chromium closes the port nothing is known.
        serve(&mut &input[..], &path).unwrap();
        assert_eq!(read(&path).url, None);
    }

    #[test]
    fn a_message_longer_than_any_url_is_refused() {
        let input = (MAX_MESSAGE + 1).to_ne_bytes();
        assert!(read_message(&mut &input[..]).is_err());
    }
}
