use box_common::BoxConfig;
use box_host::serve;

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .compact()
        .init();
}

#[tokio::main]
async fn main() {
    init_tracing();
    let config = BoxConfig::from_env();
    if let Err(err) = serve(config).await {
        tracing::error!(error = %err, "box-host exited");
        std::process::exit(1);
    }
}
