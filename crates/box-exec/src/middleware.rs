use axum::extract::Request;
use axum::extract::State;
use axum::middleware::Next;
use axum::response::Response;
use box_common::{bearer_token, tokens_equal, ApiError};

use crate::AppState;

pub async fn require_token(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let presented = bearer_token(request.headers()).ok_or_else(ApiError::unauthorized)?;
    if !tokens_equal(presented, &state.token) {
        return Err(ApiError::unauthorized());
    }
    Ok(next.run(request).await)
}
