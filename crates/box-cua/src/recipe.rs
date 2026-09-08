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
    Ok(())
}
