use std::io::Write;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use grok_box::{ExecRequest, FilePutRequest, GrokBox, MkdirRequest};
use serde_json::json;

#[derive(Parser)]
#[command(
    name = "grok-box",
    version,
    about = "Connect-only CLI for a running grok-box guest"
)]
struct Cli {
    /// Published box-exec base URL (not /v1/info).
    #[arg(long, env = "GROK_BOX_EXEC_URL")]
    exec_url: String,
    /// Published box-host base URL (not /v1/info).
    #[arg(long, env = "GROK_BOX_HOST_URL")]
    host_url: String,
    /// Guest bearer token (BOX_TOKEN).
    #[arg(long, env = "GROK_BOX_TOKEN")]
    token: String,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// GET exec and host /v1/health
    Health,
    /// GET host /v1/ready
    Ready,
    /// GET host /v1/info (URLs in the body are container-local)
    Info,
    /// POST /v1/exec
    Exec {
        #[arg(long)]
        cwd: Option<String>,
        #[arg(long)]
        timeout_ms: Option<u64>,
        #[arg(long)]
        stdin: Option<String>,
        #[arg(required = true, num_args = 1.., trailing_var_arg = true)]
        command: Vec<String>,
    },
    #[command(subcommand)]
    Files(FilesCmd),
    #[command(subcommand)]
    Cua(CuaCmd),
}

#[derive(Subcommand)]
enum FilesCmd {
    Get {
        path: String,
        #[arg(long)]
        encoding: Option<String>,
    },
    Put {
        path: String,
        #[arg(long, conflicts_with = "file")]
        content: Option<String>,
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long)]
        encoding: Option<String>,
    },
    Delete {
        path: String,
        #[arg(long)]
        recursive: bool,
    },
    Mkdir {
        path: String,
        #[arg(long)]
        no_parents: bool,
    },
}

#[derive(Subcommand)]
enum CuaCmd {
    Screenshot {
        /// Write raw image/png instead of JSON
        #[arg(long)]
        png: bool,
        #[arg(long, short)]
        output: Option<PathBuf>,
    },
    Click {
        #[arg(long)]
        x: i32,
        #[arg(long)]
        y: i32,
        #[arg(long)]
        button: Option<u8>,
    },
    DoubleClick {
        #[arg(long)]
        x: i32,
        #[arg(long)]
        y: i32,
        #[arg(long)]
        button: Option<u8>,
    },
    Move {
        #[arg(long)]
        x: i32,
        #[arg(long)]
        y: i32,
    },
    Drag {
        #[arg(long)]
        x1: i32,
        #[arg(long)]
        y1: i32,
        #[arg(long)]
        x2: i32,
        #[arg(long)]
        y2: i32,
        #[arg(long)]
        button: Option<u8>,
    },
    Type {
        #[arg(long)]
        text: String,
    },
    Key {
        #[arg(long)]
        key: String,
    },
    Scroll {
        #[arg(long)]
        x: i32,
        #[arg(long)]
        y: i32,
        #[arg(long)]
        dx: i32,
        #[arg(long)]
        dy: i32,
    },
    /// POST /v1/cua/recipe — many CUA steps, one request
    Recipe {
        #[arg(long)]
        file: PathBuf,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let box_client = GrokBox::connect(cli.exec_url, cli.host_url, cli.token)?;
    match cli.command {
        Commands::Health => {
            print_json(&json!({
                "exec": box_client.health_exec().await?,
                "host": box_client.health_host().await?,
            }))?;
        }
        Commands::Ready => print_json(&box_client.ready().await?)?,
        Commands::Info => print_json(&box_client.info().await?)?,
        Commands::Exec {
            cwd,
            timeout_ms,
            stdin,
            command,
        } => {
            let result = box_client
                .exec(&ExecRequest {
                    command: json!(command),
                    cwd,
                    timeout_ms,
                    env: None,
                    stdin,
                })
                .await?;
            print_json(&result)?;
        }
        Commands::Files(cmd) => match cmd {
            FilesCmd::Get { path, encoding } => {
                print_json(&box_client.files_get(&path, encoding.as_deref()).await?)?;
            }
            FilesCmd::Put {
                path,
                content,
                file,
                encoding,
            } => {
                let content = if let Some(file) = file {
                    std::fs::read_to_string(&file)
                        .with_context(|| format!("read {}", file.display()))?
                } else {
                    content.context("--content or --file is required")?
                };
                print_json(
                    &box_client
                        .files_put(&FilePutRequest {
                            path,
                            content,
                            encoding,
                            create_dirs: Some(true),
                        })
                        .await?,
                )?;
            }
            FilesCmd::Delete { path, recursive } => {
                print_json(&box_client.files_delete(&path, recursive).await?)?;
            }
            FilesCmd::Mkdir { path, no_parents } => {
                print_json(
                    &box_client
                        .files_mkdir(&MkdirRequest {
                            path,
                            parents: Some(!no_parents),
                        })
                        .await?,
                )?;
            }
        },
        Commands::Cua(cmd) => match cmd {
            CuaCmd::Screenshot { png, output } => {
                if png {
                    let bytes = box_client.screenshot_png().await?;
                    if let Some(path) = output {
                        std::fs::write(&path, &bytes)
                            .with_context(|| format!("write {}", path.display()))?;
                    } else {
                        std::io::stdout().write_all(&bytes)?;
                    }
                } else {
                    let shot = box_client.screenshot().await?;
                    if let Some(path) = output {
                        let raw = serde_json::to_vec_pretty(&shot)?;
                        std::fs::write(&path, raw)
                            .with_context(|| format!("write {}", path.display()))?;
                    } else {
                        print_json(&shot)?;
                    }
                }
            }
            CuaCmd::Click { x, y, button } => {
                print_json(&box_client.click(x, y, button).await?)?;
            }
            CuaCmd::DoubleClick { x, y, button } => {
                print_json(&box_client.double_click(x, y, button).await?)?;
            }
            CuaCmd::Move { x, y } => print_json(&box_client.move_pointer(x, y).await?)?,
            CuaCmd::Drag {
                x1,
                y1,
                x2,
                y2,
                button,
            } => print_json(&box_client.drag(x1, y1, x2, y2, button).await?)?,
            CuaCmd::Type { text } => print_json(&box_client.type_text(&text).await?)?,
            CuaCmd::Key { key } => print_json(&box_client.key(&key).await?)?,
            CuaCmd::Scroll { x, y, dx, dy } => {
                print_json(&box_client.scroll(x, y, dx, dy).await?)?;
            }
            CuaCmd::Recipe { file } => {
                let raw = std::fs::read_to_string(&file)
                    .with_context(|| format!("read {}", file.display()))?;
                let request: serde_json::Value = serde_json::from_str(&raw)
                    .with_context(|| format!("parse {}", file.display()))?;
                print_json(&box_client.recipe(&request).await?)?;
            }
        },
    }
    Ok(())
}

fn print_json(value: &impl serde::Serialize) -> Result<()> {
    serde_json::to_writer_pretty(std::io::stdout(), value)?;
    println!();
    Ok(())
}
