//! Computer-use HTTP handlers on `box-exec`.
//!
//! Actuators talk to Xvfb (`DISPLAY=:1`, 1280×800) via in-process XTEST /
//! GetImage (xdotool / ImageMagick fallback).

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use box_common::ApiError;
use box_cua::{
    click, double_click, drag, key, move_pointer, press, release, run_recipe, screenshot,
    screenshot_png, scroll, type_text, ClickRequest, CuaError, DragRequest, KeyRequest,
    MoveRequest, OkResponse, RecipeRequest, RecipeResponse, ReleaseRequest, ScrollRequest,
    TypeRequest,
};
use serde::Deserialize;

use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct ScreenshotQuery {
    pub format: Option<String>,
}

pub fn map_err(err: CuaError) -> ApiError {
    match err {
        CuaError::Disabled => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "cua_disabled",
            err.to_string(),
        ),
        CuaError::DisplayDown(_) => ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "display_unavailable",
            err.to_string(),
        ),
        CuaError::OutOfRange(_, _, _, _) => {
            ApiError::new(StatusCode::BAD_REQUEST, "out_of_range", err.to_string())
        }
        CuaError::Invalid(_) => ApiError::invalid_request(err.to_string()),
        CuaError::Tool(_) => ApiError::new(StatusCode::BAD_GATEWAY, "cua_backend", err.to_string()),
    }
}

fn want_png(headers: &HeaderMap, query: &ScreenshotQuery) -> bool {
    if let Some(format) = query.format.as_deref() {
        if format.trim().eq_ignore_ascii_case("png") {
            return true;
        }
        if format.trim().eq_ignore_ascii_case("json") {
            return false;
        }
    }
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    accept
        .split(',')
        .map(|part| part.trim())
        .any(|part| part.eq_ignore_ascii_case("image/png") || part.starts_with("image/png;"))
}

pub async fn screenshot_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ScreenshotQuery>,
) -> Result<Response, ApiError> {
    if want_png(&headers, &query) {
        let png = screenshot_png(&state.cua).await.map_err(map_err)?;
        return Ok(([(header::CONTENT_TYPE, "image/png")], png).into_response());
    }
    screenshot(&state.cua)
        .await
        .map(|body| Json(body).into_response())
        .map_err(map_err)
}

pub async fn click_handler(
    State(state): State<AppState>,
    Json(req): Json<ClickRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    click(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn double_click_handler(
    State(state): State<AppState>,
    Json(req): Json<ClickRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    double_click(&state.cua, &req)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn move_handler(
    State(state): State<AppState>,
    Json(req): Json<MoveRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    move_pointer(&state.cua, &req)
        .await
        .map(Json)
        .map_err(map_err)
}

pub async fn drag_handler(
    State(state): State<AppState>,
    Json(req): Json<DragRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    drag(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn press_handler(
    State(state): State<AppState>,
    Json(req): Json<ClickRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    press(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn release_handler(
    State(state): State<AppState>,
    Json(req): Json<ReleaseRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    release(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn type_handler(
    State(state): State<AppState>,
    Json(req): Json<TypeRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    type_text(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn key_handler(
    State(state): State<AppState>,
    Json(req): Json<KeyRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    key(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn scroll_handler(
    State(state): State<AppState>,
    Json(req): Json<ScrollRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    scroll(&state.cua, &req).await.map(Json).map_err(map_err)
}

pub async fn recipe_handler(
    State(state): State<AppState>,
    Json(req): Json<RecipeRequest>,
) -> Result<Json<RecipeResponse>, ApiError> {
    run_recipe(&state.cua, &req)
        .await
        .map(Json)
        .map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_from_query() {
        let headers = HeaderMap::new();
        assert!(want_png(
            &headers,
            &ScreenshotQuery {
                format: Some("png".into())
            }
        ));
        assert!(!want_png(
            &headers,
            &ScreenshotQuery {
                format: Some("json".into())
            }
        ));
    }

    #[test]
    fn png_from_accept() {
        let mut headers = HeaderMap::new();
        headers.insert(header::ACCEPT, "image/png".parse().unwrap());
        assert!(want_png(&headers, &ScreenshotQuery { format: None }));
        headers.insert(header::ACCEPT, "*/*".parse().unwrap());
        assert!(!want_png(&headers, &ScreenshotQuery { format: None }));
    }
}
