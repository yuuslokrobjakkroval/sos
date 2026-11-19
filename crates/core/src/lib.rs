//! Automate core engine.
//!
//! Shared by the web server (`automate-server`) and the desktop app (Tauri),
//! so both run exactly the same upload API and analysis pipeline.

pub mod analysis;
pub mod api;
pub mod captions;
pub mod config;
pub mod db;
pub mod models;
pub mod pipeline;
pub mod vision;

use std::sync::Arc;

use anyhow::Context;
use sqlx::SqlitePool;
use tokio::{net::TcpListener, sync::mpsc};

pub use config::Config;

/// State shared by every request handler and the background worker.
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub cfg: Arc<Config>,
    /// Sends video ids to the background worker.
    pub queue: mpsc::UnboundedSender<String>,
}

/// Start the HTTP API (and the static frontend, if configured) and block forever.
pub async fn serve(config: Config) -> anyhow::Result<()> {
    let listener = TcpListener::bind(config.addr)
        .await
        .with_context(|| format!("could not listen on {}", config.addr))?;
    let addr = listener.local_addr()?;

    tracing::info!("ffmpeg:        {}", config.ffmpeg.display());
    tracing::info!("whisper-cli:   {}", config.whisper_bin.display());
    tracing::info!("whisper model: {}", config.whisper_model.display());
    tracing::info!("data dir:      {}", config.data_dir.display());

    let state = init_state(config).await?;
    let app = api::router(state);

    tracing::info!("Automate is running at http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn init_state(cfg: Config) -> anyhow::Result<AppState> {
    for dir in ["uploads", "jobs"] {
        tokio::fs::create_dir_all(cfg.data_dir.join(dir))
            .await
            .with_context(|| format!("could not create {}", cfg.data_dir.join(dir).display()))?;
    }
    let db = db::connect(&cfg.data_dir.join("automate.db")).await?;

    let (tx, rx) = mpsc::unbounded_channel();
    let state = AppState { db, cfg: Arc::new(cfg), queue: tx };
    pipeline::spawn_worker(state.clone(), rx);

    // Resume jobs that were interrupted by a restart.
    for id in db::unfinished_ids(&state.db).await? {
        db::set_status(&state.db, &id, "queued").await?;
        let _ = state.queue.send(id);
    }
    Ok(state)
}
