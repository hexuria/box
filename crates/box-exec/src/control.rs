use std::sync::atomic::Ordering;
use std::time::Duration;

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use crate::AppState;

#[derive(Serialize)]
pub struct BusyResponse {
    pub busy: bool,
    pub execs: ExecBusy,
    pub shutting_down: bool,
}

#[derive(Serialize)]
pub struct ExecBusy {
    pub current: usize,
    pub max: usize,
}

#[derive(Serialize)]
pub struct ShutdownResponse {
    pub ok: bool,
    pub service: &'static str,
}

#[derive(Serialize)]
pub struct MetricsResponse {
    pub service: &'static str,
    pub uptime_ms: u64,
    pub execs: ExecMetrics,
}

#[derive(Serialize)]
pub struct ExecMetrics {
    pub current: usize,
    pub max: usize,
    pub started: u64,
}

pub async fn busy(State(state): State<AppState>) -> Json<BusyResponse> {
    let current = state.execs_in_flight.load(Ordering::Relaxed);
    Json(BusyResponse {
        busy: current >= state.max_concurrent_execs,
        execs: ExecBusy {
            current,
            max: state.max_concurrent_execs,
        },
        shutting_down: state.shutting_down.load(Ordering::Relaxed),
    })
}

pub async fn shutdown(State(state): State<AppState>) -> Json<ShutdownResponse> {
    state.shutting_down.store(true, Ordering::Relaxed);
    let notify = state.shutdown.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        notify.notify_waiters();
    });
    Json(ShutdownResponse {
        ok: true,
        service: "box-exec",
    })
}

pub async fn metrics(State(state): State<AppState>) -> Json<MetricsResponse> {
    Json(MetricsResponse {
        service: "box-exec",
        uptime_ms: state.started_at.elapsed().as_millis() as u64,
        execs: ExecMetrics {
            current: state.execs_in_flight.load(Ordering::Relaxed),
            max: state.max_concurrent_execs,
            started: state.execs_started.load(Ordering::Relaxed),
        },
    })
}
