use std::path::PathBuf;

use automate_core::Config;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let mut cfg = Config::from_env("127.0.0.1:8787".parse()?, PathBuf::from("data"));
    if cfg.static_dir.is_none() {
        let dist = PathBuf::from("app/dist");
        if dist.join("index.html").is_file() {
            cfg.static_dir = Some(dist);
        } else {
            tracing::warn!("app/dist not found — run `npm run build` to serve the website (API still works)");
        }
    }

    automate_core::serve(cfg).await
}
