#[derive(Debug, Deserialize, Serialize)]
pub struct ScreenshotResponse {
    pub encoding: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub png_base64: String,
    pub bytes: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
