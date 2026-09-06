use std::path::Path;

use axum::extract::{Query, State};
use axum::Json;
use box_common::{resolve_in_jail, ApiError};
use serde::{Deserialize, Serialize};

use crate::AppState;

mod b64 {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn encode(input: &[u8]) -> String {
        let mut out = String::new();
        let mut i = 0;
        while i < input.len() {
            let b0 = input[i];
            let b1 = if i + 1 < input.len() { input[i + 1] } else { 0 };
            let b2 = if i + 2 < input.len() { input[i + 2] } else { 0 };
            out.push(TABLE[(b0 >> 2) as usize] as char);
            out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
            if i + 1 < input.len() {
                out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
            } else {
                out.push('=');
            }
            if i + 2 < input.len() {
                out.push(TABLE[(b2 & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
            i += 3;
        }
        out
    }

    pub fn decode(input: &str) -> Result<Vec<u8>, &'static str> {
        fn val(c: u8) -> Result<u8, &'static str> {
            match c {
                b'A'..=b'Z' => Ok(c - b'A'),
                b'a'..=b'z' => Ok(c - b'a' + 26),
                b'0'..=b'9' => Ok(c - b'0' + 52),
                b'+' => Ok(62),
                b'/' => Ok(63),
                _ => Err("invalid base64"),
            }
        }
        let filtered: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
        if filtered.len() % 4 != 0 {
            return Err("invalid base64 length");
        }
        let mut out = Vec::new();
        for chunk in filtered.chunks(4) {
            let pad = chunk.iter().filter(|b| **b == b'=').count();
            let c0 = val(chunk[0])?;
            let c1 = val(chunk[1])?;
            let c2 = if chunk[2] == b'=' { 0 } else { val(chunk[2])? };
            let c3 = if chunk[3] == b'=' { 0 } else { val(chunk[3])? };
            out.push((c0 << 2) | (c1 >> 4));
            if pad < 2 {
                out.push((c1 << 4) | (c2 >> 2));
            }
            if pad < 1 {
                out.push((c2 << 6) | c3);
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Deserialize)]
pub struct FileQuery {
    pub path: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FileGetResponse {
    File {
        path: String,
        size: u64,
        encoding: String,
        content: String,
    },
    Directory {
        path: String,
        entries: Vec<DirEntry>,
    },
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub kind: String,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct FilePutRequest {
    pub path: String,
    pub content: String,
    pub encoding: Option<String>,
    pub create_dirs: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct FilePutResponse {
    pub path: String,
    pub bytes_written: u64,
}

pub async fn get(
    State(state): State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<Json<FileGetResponse>, ApiError> {
    let user_path = query.path.as_deref().unwrap_or("");
    let resolved = resolve_in_jail(&state.workspace, user_path)?;
    let meta = tokio::fs::metadata(&resolved).await.map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            ApiError::not_found(format!("not found: {}", resolved.display()))
        } else {
            ApiError::io(err.to_string())
        }
    })?;

    if meta.is_dir() {
        let mut entries = Vec::new();
        let mut read = tokio::fs::read_dir(&resolved)
            .await
            .map_err(|err| ApiError::io(err.to_string()))?;
        while let Some(entry) = read
            .next_entry()
            .await
            .map_err(|err| ApiError::io(err.to_string()))?
        {
            let file_type = entry
                .file_type()
                .await
                .map_err(|err| ApiError::io(err.to_string()))?;
            let kind = if file_type.is_dir() {
                "directory"
            } else if file_type.is_symlink() {
                "symlink"
            } else {
                "file"
            };
            let size = if file_type.is_file() {
                entry.metadata().await.ok().map(|m| m.len())
            } else {
                None
            };
            entries.push(DirEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                kind: kind.to_string(),
                size,
            });
        }
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        return Ok(Json(FileGetResponse::Directory {
            path: display_under_workspace(&state.workspace, &resolved),
            entries,
        }));
    }

    if meta.len() > state.max_file_bytes {
        return Err(ApiError::payload_too_large(format!(
            "file is {} bytes; max is {}",
            meta.len(),
            state.max_file_bytes
        )));
    }

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|err| ApiError::io(err.to_string()))?;
    let want = query
        .encoding
        .as_deref()
        .unwrap_or("utf8")
        .to_ascii_lowercase();

    let (encoding, content) = match want.as_str() {
        "base64" => ("base64".to_string(), b64::encode(&bytes)),
        "utf8" | "text" => match String::from_utf8(bytes.clone()) {
            Ok(text) => ("utf8".to_string(), text),
            Err(_) => ("base64".to_string(), b64::encode(&bytes)),
        },
        other => {
            return Err(ApiError::invalid_request(format!(
                "unsupported encoding '{other}'"
            )))
        }
    };

    Ok(Json(FileGetResponse::File {
        path: display_under_workspace(&state.workspace, &resolved),
        size: meta.len(),
        encoding,
        content,
    }))
}

pub async fn put(
    State(state): State<AppState>,
    Json(req): Json<FilePutRequest>,
) -> Result<Json<FilePutResponse>, ApiError> {
    if req.path.is_empty() {
        return Err(ApiError::invalid_request("path is required"));
    }
    let resolved = resolve_in_jail(&state.workspace, &req.path)?;
    let root = resolve_in_jail(&state.workspace, "")?;
    if resolved == root {
        return Err(ApiError::invalid_request(
            "refusing to overwrite the workspace root",
        ));
    }

    let bytes = match req
        .encoding
        .as_deref()
        .unwrap_or("utf8")
        .to_ascii_lowercase()
        .as_str()
    {
        "utf8" | "text" => req.content.into_bytes(),
        "base64" => b64::decode(&req.content).map_err(|err| ApiError::invalid_request(err))?,
        other => {
            return Err(ApiError::invalid_request(format!(
                "unsupported encoding '{other}'"
            )))
        }
    };

    if bytes.len() as u64 > state.max_file_bytes {
        return Err(ApiError::payload_too_large(format!(
            "payload is {} bytes; max is {}",
            bytes.len(),
            state.max_file_bytes
        )));
    }

    if resolved.exists() && resolved.is_dir() {
        return Err(ApiError::invalid_request(
            "path is a directory; write a file path",
        ));
    }

    if req.create_dirs.unwrap_or(true) {
        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|err| ApiError::io(err.to_string()))?;
        }
    }

    tokio::fs::write(&resolved, &bytes)
        .await
        .map_err(|err| ApiError::io(err.to_string()))?;

    Ok(Json(FilePutResponse {
        path: display_under_workspace(&state.workspace, &resolved),
        bytes_written: bytes.len() as u64,
    }))
}

fn display_under_workspace(workspace: &Path, resolved: &Path) -> String {
    let root = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    match resolved.strip_prefix(&root) {
        Ok(rel) if rel.as_os_str().is_empty() => root.display().to_string(),
        Ok(rel) => format!("{}/{}", root.display(), rel.display()),
        Err(_) => resolved.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::b64;

    #[test]
    fn base64_roundtrip() {
        let data = b"hello world!";
        let encoded = b64::encode(data);
        assert_eq!(b64::decode(&encoded).unwrap(), data);
        assert_eq!(b64::decode("aGVsbG8=").unwrap(), b"hello");
    }
}
