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
    click, double_click, drag, key, move_pointer, screenshot, scroll, type_text, ClickRequest,
    CuaConfig, CuaError, DragRequest, KeyRequest, MoveRequest, ScreenshotResponse, ScrollRequest,
    TypeRequest,
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
    pub op: String,
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
            RecipeStep::Key { key } => {
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

pub async fn run_recipe(
    config: &CuaConfig,
    req: &RecipeRequest,
) -> Result<RecipeResponse, CuaError> {
    validate_recipe(config, req)?;
    crate::ensure_ready(config)?;

    let started = Instant::now();
    let stop_on_error = req.stop_on_error();
    let shot_mode = req.screenshot_mode();
    let mut steps = Vec::with_capacity(req.steps.len());
    let mut ok = true;
    let mut stopped_at = None;

    for (index, step) in req.steps.iter().enumerate() {
        let step_started = Instant::now();
        let result = run_step(config, step).await;
        let ms = step_started.elapsed().as_millis() as u64;
        match result {
            Ok(maybe_shot) => {
                let screenshot = if maybe_shot.is_some() {
                    maybe_shot
                } else if shot_mode == RecipeScreenshot::Each
                    && !matches!(step, RecipeStep::Wait { .. })
                {
                    screenshot(config).await.ok()
                } else {
                    None
                };
                steps.push(RecipeStepResult {
                    index,
                    op: step.op_name().into(),
                    ok: true,
                    ms,
                    error: None,
                    screenshot,
                });
            }
            Err(err) => {
                ok = false;
                steps.push(RecipeStepResult {
                    index,
                    op: step.op_name().into(),
                    ok: false,
                    ms,
                    error: Some(err.to_string()),
                    screenshot: None,
                });
                if stop_on_error {
                    stopped_at = Some(index);
                    break;
                }
            }
        }
    }

    let mut final_shot = None;
    if ok && shot_mode == RecipeScreenshot::End {
        match screenshot(config).await {
            Ok(shot) => final_shot = Some(shot),
            Err(err) => {
                ok = false;
                steps.push(RecipeStepResult {
                    index: steps.len(),
                    op: "screenshot".into(),
                    ok: false,
                    ms: 0,
                    error: Some(err.to_string()),
                    screenshot: None,
                });
                stopped_at = Some(steps.len().saturating_sub(1));
            }
        }
    }

    Ok(RecipeResponse {
        ok,
        name: req.name.clone(),
        ran: steps.iter().filter(|s| s.ok).count(),
        stopped_at,
        duration_ms: started.elapsed().as_millis() as u64,
        steps,
        screenshot: final_shot,
    })
}

async fn run_step(
    config: &CuaConfig,
    step: &RecipeStep,
) -> Result<Option<ScreenshotResponse>, CuaError> {
    match step {
        RecipeStep::Click { x, y, button } => {
            click(
                config,
                &ClickRequest {
                    x: *x,
                    y: *y,
                    button: *button,
                },
            )
            .await?;
            Ok(None)
        }
        RecipeStep::DoubleClick { x, y, button } => {
            double_click(
                config,
                &ClickRequest {
                    x: *x,
                    y: *y,
                    button: *button,
                },
            )
            .await?;
            Ok(None)
        }
        RecipeStep::Move { x, y } => {
            move_pointer(config, &MoveRequest { x: *x, y: *y }).await?;
            Ok(None)
        }
        RecipeStep::Drag {
            x1,
            y1,
            x2,
            y2,
            button,
        } => {
            drag(
                config,
                &DragRequest {
                    x1: *x1,
                    y1: *y1,
                    x2: *x2,
                    y2: *y2,
                    button: *button,
                },
            )
            .await?;
            Ok(None)
        }
        RecipeStep::Type { text } => {
            type_text(config, &TypeRequest { text: text.clone() }).await?;
            Ok(None)
        }
        RecipeStep::Key { key: keysym } => {
            key(
                config,
                &KeyRequest {
                    key: keysym.clone(),
                },
            )
            .await?;
            Ok(None)
        }
        RecipeStep::Scroll { x, y, dx, dy } => {
            scroll(
                config,
                &ScrollRequest {
                    x: *x,
                    y: *y,
                    dx: *dx,
                    dy: *dy,
                },
            )
            .await?;
            Ok(None)
        }
        RecipeStep::Wait { ms } => {
            if *ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(*ms)).await;
            }
            Ok(None)
        }
        RecipeStep::Screenshot {} => Ok(Some(screenshot(config).await?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> CuaConfig {
        let mut cfg = CuaConfig::disabled();
        cfg.enabled = true;
        cfg
    }

    #[test]
    fn rejects_empty() {
        let req = RecipeRequest {
            name: None,
            stop_on_error: None,
            screenshot: None,
            steps: vec![],
        };
        assert!(matches!(
            validate_recipe(&cfg(), &req),
            Err(CuaError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_too_many_steps() {
        let step = RecipeStep::Wait { ms: 1 };
        let req = RecipeRequest {
            name: None,
            stop_on_error: None,
            screenshot: Some(RecipeScreenshot::None),
            steps: vec![step; MAX_RECIPE_STEPS + 1],
        };
        assert!(validate_recipe(&cfg(), &req).is_err());
    }

    #[test]
    fn rejects_out_of_range_before_run() {
        let req = RecipeRequest {
            name: None,
            stop_on_error: None,
            screenshot: Some(RecipeScreenshot::None),
            steps: vec![
                RecipeStep::Move { x: 0, y: 0 },
                RecipeStep::Click {
                    x: 1280,
                    y: 0,
                    button: None,
                },
            ],
        };
        assert!(matches!(
            validate_recipe(&cfg(), &req),
            Err(CuaError::OutOfRange(1280, 0, 1280, 800))
        ));
    }

    #[test]
    fn rejects_long_wait() {
        let req = RecipeRequest {
            name: None,
            stop_on_error: None,
            screenshot: Some(RecipeScreenshot::None),
            steps: vec![RecipeStep::Wait {
                ms: MAX_WAIT_MS + 1,
            }],
        };
        assert!(validate_recipe(&cfg(), &req).is_err());
    }

    #[test]
    fn parses_double_click_alias() {
        let step: RecipeStep =
            serde_json::from_str(r#"{"op":"double-click","x":1,"y":2}"#).unwrap();
        assert!(matches!(step, RecipeStep::DoubleClick { x: 1, y: 2, .. }));
        let step: RecipeStep =
            serde_json::from_str(r#"{"op":"double_click","x":1,"y":2}"#).unwrap();
        assert!(matches!(step, RecipeStep::DoubleClick { .. }));
    }

    #[test]
    fn accepts_known_path() {
        let req = RecipeRequest {
            name: Some("open-url".into()),
            stop_on_error: Some(true),
            screenshot: Some(RecipeScreenshot::End),
            steps: vec![
                RecipeStep::Click {
                    x: 640,
                    y: 400,
                    button: Some(1),
                },
                RecipeStep::Type {
                    text: "hello".into(),
                },
                RecipeStep::Key {
                    key: "Return".into(),
                },
                RecipeStep::Wait { ms: 50 },
            ],
        };
        assert!(validate_recipe(&cfg(), &req).is_ok());
    }
}
