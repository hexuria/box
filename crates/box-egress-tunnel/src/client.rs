//! Laptop-side client: attach to the guest WS and dial outbound TCP.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, Context};
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{header, HeaderValue};
use tokio_tungstenite::tungstenite::Message;

use crate::config::TunnelClientConfig;
use crate::protocol::{decode_data, encode_data, ControlMsg, PROTOCOL_NAME};

const CHUNK: usize = 32 * 1024;

enum WsOut {
    Control(ControlMsg),
    Data { id: u32, payload: Vec<u8> },
}

struct Streams {
    map: Mutex<HashMap<u32, mpsc::Sender<Vec<u8>>>>,
}

impl Streams {
    fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    fn insert(&self, id: u32, tx: mpsc::Sender<Vec<u8>>) {
        self.map
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
    }

    fn get(&self, id: u32) -> Option<mpsc::Sender<Vec<u8>>> {
        self.map
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
    }

    fn remove(&self, id: u32) {
        self.map
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }
}

pub async fn run(cfg: TunnelClientConfig) -> anyhow::Result<()> {
    if cfg.reconnect {
        loop {
            match run_once(&cfg).await {
                Ok(()) => {
                    tracing::warn!("tunnel disconnected; reconnecting in 2s");
                }
                Err(err) => {
                    if is_unauthorized(&err) {
                        return Err(err);
                    }
                    tracing::error!(error = %err, "tunnel client error; retrying in 2s");
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    } else {
        run_once(&cfg).await
    }
}

fn is_unauthorized(err: &anyhow::Error) -> bool {
    let text = format!("{err:#}").to_ascii_lowercase();
    text.contains("401") || text.contains("unauthorized")
}

pub async fn run_once(cfg: &TunnelClientConfig) -> anyhow::Result<()> {
    let mut request = cfg
        .url
        .as_str()
        .into_client_request()
        .with_context(|| format!("invalid websocket URL {}", cfg.url))?;
    let bearer = format!("Bearer {}", cfg.bearer);
    request.headers_mut().insert(
        header::AUTHORIZATION,
        HeaderValue::from_str(&bearer).map_err(|err| anyhow!("bearer header: {err}"))?,
    );
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static(PROTOCOL_NAME),
    );

    tracing::info!(url = %cfg.url, protocol = PROTOCOL_NAME, "connecting egress client");
    let (ws, _resp) = connect_async(request)
        .await
        .with_context(|| format!("connect {}", cfg.url))?;
    let (mut sink, mut stream) = ws.split();
    let (out_tx, mut out_rx) = mpsc::channel::<WsOut>(256);
    let streams = Arc::new(Streams::new());

    let _ = out_tx
        .send(WsOut::Control(ControlMsg::hello("client")))
        .await;

    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            let frame = match msg {
                WsOut::Control(ctrl) => match serde_json::to_string(&ctrl) {
                    Ok(text) => Message::Text(text.into()),
                    Err(_) => continue,
                },
                WsOut::Data { id, payload } => Message::Binary(encode_data(id, &payload).into()),
            };
            if sink.send(frame).await.is_err() {
                break;
            }
        }
        let _ = sink.send(Message::Close(None)).await;
    });

    while let Some(frame) = stream.next().await {
        let frame = frame.context("websocket read")?;
        match frame {
            Message::Text(text) => {
                let Ok(msg) = serde_json::from_str::<ControlMsg>(&text) else {
                    continue;
                };
                if !msg.wire_ok() {
                    continue;
                }
                match msg {
                    ControlMsg::Open { id, host, port, .. } => {
                        let allow = cfg.allowlist.clone();
                        let outgoing = out_tx.clone();
                        let streams = streams.clone();
                        tokio::spawn(async move {
                            handle_open(id, host, port, allow, outgoing, streams).await;
                        });
                    }
                    ControlMsg::Close { id, .. } | ControlMsg::Error { id, .. } => {
                        streams.remove(id);
                    }
                    ControlMsg::Hello { .. } | ControlMsg::Opened { .. } => {}
                }
            }
            Message::Binary(bin) => {
                if let Some((id, payload)) = decode_data(&bin) {
                    if let Some(tx) = streams.get(id) {
                        let _ = tx.send(payload.to_vec()).await;
                    }
                }
            }
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
            Message::Close(_) => break,
        }
    }

    writer.abort();
    Ok(())
}

async fn handle_open(
    id: u32,
    host: String,
    port: u16,
    allow: crate::Allowlist,
    outgoing: mpsc::Sender<WsOut>,
    streams: Arc<Streams>,
) {
    if !allow.allows(&host) {
        let _ = outgoing
            .send(WsOut::Control(ControlMsg::error(id, "host not allowed")))
            .await;
        return;
    }
    let dest = format!("{host}:{port}");
    match TcpStream::connect((host.as_str(), port)).await {
        Ok(stream) => {
            let _ = stream.set_nodelay(true);
            let (from_tx, from_rx) = mpsc::channel(32);
            streams.insert(id, from_tx);
            if outgoing
                .send(WsOut::Control(ControlMsg::opened(id)))
                .await
                .is_err()
            {
                streams.remove(id);
                return;
            }
            tracing::info!(%dest, id, "outbound TCP open");
            copy_outbound(stream, from_rx, outgoing, id).await;
            streams.remove(id);
        }
        Err(err) => {
            tracing::warn!(%dest, id, error = %err, "outbound TCP failed");
            let _ = outgoing
                .send(WsOut::Control(ControlMsg::error(id, err.to_string())))
                .await;
        }
    }
}

async fn copy_outbound(
    mut stream: TcpStream,
    mut from_server: mpsc::Receiver<Vec<u8>>,
    outgoing: mpsc::Sender<WsOut>,
    id: u32,
) {
    let mut buf = vec![0u8; CHUNK];
    loop {
        tokio::select! {
            n = stream.read(&mut buf) => {
                match n {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if outgoing
                            .send(WsOut::Data {
                                id,
                                payload: buf[..n].to_vec(),
                            })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            msg = from_server.recv() => {
                match msg {
                    Some(data) => {
                        if stream.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }
    let _ = outgoing
        .send(WsOut::Control(ControlMsg::close(id, Some("eof"))))
        .await;
}
