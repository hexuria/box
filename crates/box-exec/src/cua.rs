//! Computer-use HTTP handlers on `box-exec`.
//!
//! Actuators talk to Xvfb (`DISPLAY=:1`, 1280×800) via xdotool / ImageMagick.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use box_common::ApiError;
use box_cua::{
    click, key, screenshot, scroll, type_text, ClickRequest, CuaError, KeyRequest, OkResponse,
    ScreenshotResponse, ScrollRequest, TypeRequest,
};

use crate::AppState;

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

pub async fn screenshot_handler(
    State(state): State<AppState>,
) -> Result<Json<ScreenshotResponse>, ApiError> {
    screenshot(&state.cua).await.map(Json).map_err(map_err)
}

pub async fn click_handler(
    State(state): State<AppState>,
    Json(req): Json<ClickRequest>,
) -> Result<Json<OkResponse>, ApiError> {
    click(&state.cua, &req).await.map(Json).map_err(map_err)
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
