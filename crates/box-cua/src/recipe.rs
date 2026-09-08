//! One-call CUA recipes.
//!
//! reverse-web-mcp compiles an app's wants into a DAG and runs it without
//! another model turn. grok-box is the *screen*, not that compiler: the caller
//! already planned the clicks. This module runs that plan in **one** HTTP
//! request so the agent does not pay a round trip per `click` / `scroll`.
//!
//! The pointer is shared, so steps are sequential. There is no parallel CUA.

use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::{
    click, double_click, drag, key_inner, move_pointer, press, release_step, screenshot, scroll,
    type_text_inner, ClickRequest, CuaConfig, CuaError, CuaPoint, DragRequest, KeyAction,
    MoveRequest, ScreenshotResponse, ScrollRequest,
};

pub const MAX_RECIPE_STEPS: usize = 64;
pub const MAX_WAIT_MS: u64 = 10_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecipeScreenshot {
    None,
    #[default]
    End,
    Each,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum RecipeStep {
    Click {
        x: i32,
        y: i32,
        #[serde(default)]
        button: Option<u8>,
    },
    #[serde(alias = "double-click")]
    DoubleClick {
        x: i32,
        y: i32,
        #[serde(default)]
        button: Option<u8>,
    },
    Move {
        x: i32,
        y: i32,
    },
    #[serde(alias = "mousedown")]
    Press {
        x: i32,
        y: i32,
        #[serde(default)]
        button: Option<u8>,
    },
    #[serde(alias = "mouseup")]
    Release {
        #[serde(default)]
        x: Option<i32>,
        #[serde(default)]
        y: Option<i32>,
        #[serde(default)]
        button: Option<u8>,
        #[serde(default)]
        path: Option<Vec<CuaPoint>>,
    },
    Drag {
        x1: i32,
        y1: i32,
        x2: i32,
        y2: i32,
        #[serde(default)]
        button: Option<u8>,
    },
    Type {
        text: String,
    },
    Key {
        key: String,
        #[serde(default)]
        action: Option<KeyAction>,
    },
    Scroll {
        x: i32,
        y: i32,
        dx: i32,
        dy: i32,
    },
    Wait {
        ms: u64,
    },
    Screenshot {},
}

impl RecipeStep {
    pub fn op_name(&self) -> &'static str {
        match self {
            Self::Click { .. } => "click",
            Self::DoubleClick { .. } => "double_click",
            Self::Move { .. } => "move",
            Self::Press { .. } => "press",
            Self::Release { .. } => "release",
            Self::Drag { .. } => "drag",
            Self::Type { .. } => "type",
            Self::Key { .. } => "key",
            Self::Scroll { .. } => "scroll",
            Self::Wait { .. } => "wait",
            Self::Screenshot {} => "screenshot",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RecipeRequest {
    #[serde(default)]
    pub name: Option<String>,
    /// Default true: stop after the first failing step. Already-run steps stay
    /// in the receipt.
    #[serde(default)]
    pub stop_on_error: Option<bool>,
    #[serde(default)]
    pub screenshot: Option<RecipeScreenshot>,
    pub steps: Vec<RecipeStep>,
}

impl RecipeRequest {
    pub fn stop_on_error(&self) -> bool {
        self.stop_on_error.unwrap_or(true)
    }

    pub fn screenshot_mode(&self) -> RecipeScreenshot {
        self.screenshot.unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipeStepResult {
    pub index: usize,
    pub op: &'static str,
    pub ok: bool,
    pub ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<ScreenshotResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecipeResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub ran: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped_at: Option<usize>,
    pub duration_ms: u64,
    pub steps: Vec<RecipeStepResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<ScreenshotResponse>,
}

pub fn validate_recipe(config: &CuaConfig, req: &RecipeRequest) -> Result<(), CuaError> {
    if req.steps.is_empty() {
        return Err(CuaError::Invalid("recipe steps must not be empty".into()));
    }
    if req.steps.len() > MAX_RECIPE_STEPS {
        return Err(CuaError::Invalid(format!(
            "recipe has {} steps; max is {MAX_RECIPE_STEPS}",
            req.steps.len()
        )));
    }
    for step in &req.steps {
        match step {
            RecipeStep::Click { x, y, button } | RecipeStep::DoubleClick { x, y, button } => {
                crate::validate_point(config, *x, *y)?;
                if let Some(button) = *button {
                    if !(1..=7).contains(&button) {
                        return Err(CuaError::Invalid("button must be 1-7".into()));
                    }
                }
            }
            RecipeStep::Move { x, y } => crate::validate_point(config, *x, *y)?,
            RecipeStep::Press { x, y, button } => {
                crate::validate_point(config, *x, *y)?;
                if let Some(button) = *button {
                    if !(1..=7).contains(&button) {
                        return Err(CuaError::Invalid("button must be 1-7".into()));
                    }
                }
            }
            RecipeStep::Release { x, y, button, path } => {
                match (x, y) {
                    (Some(x), Some(y)) => crate::validate_point(config, *x, *y)?,
                    (None, None) => {}
                    _ => {
                        return Err(CuaError::Invalid(
                            "x and y must both be set or both omitted".into(),
                        ));
                    }
                }
                if let Some(button) = *button {
                    if !(1..=7).contains(&button) {
                        return Err(CuaError::Invalid("button must be 1-7".into()));
                    }
                }
                if let Some(path) = path {
                    if path.len() > crate::MAX_MOTION_PATH {
                        return Err(CuaError::Invalid(format!(
                            "release path has {} points; max is {}",
                            path.len(),
                            crate::MAX_MOTION_PATH
                        )));
                    }
                    for point in path {
                        crate::validate_point(config, point.x, point.y)?;
                    }
                }
            }
            RecipeStep::Drag {
                x1,
                y1,
                x2,
                y2,
                button,
            } => {
                crate::validate_point(config, *x1, *y1)?;
                crate::validate_point(config, *x2, *y2)?;
                if let Some(button) = *button {
                    if !(1..=7).contains(&button) {
                        return Err(CuaError::Invalid("button must be 1-7".into()));
                    }
                }
            }
            RecipeStep::Type { text } => {
                if text.is_empty() {
                    return Err(CuaError::Invalid("text must not be empty".into()));
                }
                if text.len() > 16 * 1024 {
                    return Err(CuaError::Invalid("text is too long".into()));
                }
            }
            RecipeStep::Key { key, action: _ } => {
                if key.is_empty() {
                    return Err(CuaError::Invalid("key must not be empty".into()));
                }
                if key.chars().any(|c| c.is_whitespace() || c == ';') {
                    return Err(CuaError::Invalid("key contains invalid characters".into()));
                }
            }
            RecipeStep::Scroll { x, y, dx, dy } => {
                crate::validate_point(config, *x, *y)?;
                if *dx == 0 && *dy == 0 {
                    return Err(CuaError::Invalid("dx and dy must not both be 0".into()));
                }
            }
            RecipeStep::Wait { ms } => {
                if *ms > MAX_WAIT_MS {
                    return Err(CuaError::Invalid(format!(
                        "wait {ms}ms exceeds max {MAX_WAIT_MS}ms"
                    )));
                }
            }
            RecipeStep::Screenshot {} => {}
        }
    }
    Ok(())
}
