use std::path::Path;

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    FromRow, SqlitePool,
};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS videos (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    language    TEXT NOT NULL DEFAULT 'auto',
    status      TEXT NOT NULL,
    error       TEXT,
    result_json TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    progress    REAL
);
"#;

/// One captioned-video export per video. `attempt` goes up each time a new
/// export starts, so a worker that is still finishing an older run cannot
/// overwrite the newer one.
const EXPORTS_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS exports (
    video_id    TEXT PRIMARY KEY,
    mode        TEXT NOT NULL,
    status      TEXT NOT NULL,
    progress    REAL,
    error       TEXT,
    output_path TEXT,
    attempt     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
"#;

#[derive(Debug, Clone, FromRow)]
pub struct VideoRow {
    pub id: String,
    pub filename: String,
    pub stored_path: String,
    pub size_bytes: i64,
    pub language: String,
    pub status: String,
    pub error: Option<String>,
    pub result_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub progress: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ExportRow {
    pub video_id: String,
    pub mode: String,
    pub status: String,
    pub progress: Option<f64>,
    pub error: Option<String>,
    pub output_path: Option<String>,
    pub attempt: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub async fn connect(path: &Path) -> anyhow::Result<SqlitePool> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await?;
    sqlx::query(SCHEMA).execute(&pool).await?;
    sqlx::query(EXPORTS_SCHEMA).execute(&pool).await?;
    // Migration for databases created before the progress column existed.
    let has_progress: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'progress'",
    )
    .fetch_one(&pool)
    .await?;
    if has_progress == 0 {
        sqlx::query("ALTER TABLE videos ADD COLUMN progress REAL")
            .execute(&pool)
            .await?;
    }
    Ok(pool)
}

pub async fn insert(pool: &SqlitePool, v: &VideoRow) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO videos (id, filename, stored_path, size_bytes, language, status, error, result_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&v.id)
    .bind(&v.filename)
    .bind(&v.stored_path)
    .bind(v.size_bytes)
    .bind(&v.language)
    .bind(&v.status)
    .bind(&v.error)
    .bind(&v.result_json)
    .bind(&v.created_at)
    .bind(&v.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<VideoRow>> {
    sqlx::query_as("SELECT * FROM videos WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

pub async fn list(pool: &SqlitePool) -> sqlx::Result<Vec<VideoRow>> {
    sqlx::query_as("SELECT * FROM videos ORDER BY created_at DESC")
        .fetch_all(pool)
        .await
}

pub async fn set_status(pool: &SqlitePool, id: &str, status: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE videos SET status = ?, error = NULL, progress = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(status)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_progress(pool: &SqlitePool, id: &str, progress: f64) -> sqlx::Result<()> {
    sqlx::query("UPDATE videos SET progress = ?, updated_at = ? WHERE id = ?")
        .bind(progress.clamp(0.0, 1.0))
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_done(pool: &SqlitePool, id: &str, result_json: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE videos SET status = 'done', error = NULL, result_json = ?, updated_at = ? WHERE id = ?")
        .bind(result_json)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_failed(pool: &SqlitePool, id: &str, error: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE videos SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
        .bind(error)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete(pool: &SqlitePool, id: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

const EXPORT_COLUMNS: &str =
    "video_id, mode, status, progress, error, output_path, attempt, created_at, updated_at";

pub async fn get_export(pool: &SqlitePool, video_id: &str) -> sqlx::Result<Option<ExportRow>> {
    sqlx::query_as(&format!(
        "SELECT {EXPORT_COLUMNS} FROM exports WHERE video_id = ?"
    ))
    .bind(video_id)
    .fetch_optional(pool)
    .await
}

/// Start a new export, replacing any previous one for this video.
pub async fn upsert_export(
    pool: &SqlitePool,
    video_id: &str,
    mode: &str,
) -> sqlx::Result<ExportRow> {
    let now = now();
    sqlx::query_as(&format!(
        "INSERT INTO exports (video_id, mode, status, progress, error, output_path, attempt, created_at, updated_at)
         VALUES (?, ?, 'queued', NULL, NULL, NULL, 1, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
            mode = excluded.mode,
            status = 'queued',
            progress = NULL,
            error = NULL,
            output_path = NULL,
            attempt = exports.attempt + 1,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
         RETURNING {EXPORT_COLUMNS}"
    ))
    .bind(video_id)
    .bind(mode)
    .bind(&now)
    .bind(&now)
    .fetch_one(pool)
    .await
}

pub async fn mark_export_rendering(
    pool: &SqlitePool,
    video_id: &str,
    attempt: i64,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE exports SET status = 'rendering', progress = 0, error = NULL, updated_at = ?
         WHERE video_id = ? AND attempt = ? AND status IN ('queued', 'rendering')",
    )
    .bind(now())
    .bind(video_id)
    .bind(attempt)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn set_export_progress(
    pool: &SqlitePool,
    video_id: &str,
    attempt: i64,
    progress: f64,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE exports SET progress = ?, updated_at = ?
         WHERE video_id = ? AND attempt = ? AND status = 'rendering'",
    )
    .bind(progress.clamp(0.0, 0.99))
    .bind(now())
    .bind(video_id)
    .bind(attempt)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn finish_export(
    pool: &SqlitePool,
    video_id: &str,
    attempt: i64,
    output_path: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE exports SET status = 'done', progress = 1, error = NULL, output_path = ?, updated_at = ?
         WHERE video_id = ? AND attempt = ?",
    )
    .bind(output_path)
    .bind(now())
    .bind(video_id)
    .bind(attempt)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn fail_export(
    pool: &SqlitePool,
    video_id: &str,
    attempt: i64,
    error: &str,
) -> sqlx::Result<bool> {
    let result = sqlx::query(
        "UPDATE exports SET status = 'failed', progress = NULL, error = ?, updated_at = ?
         WHERE video_id = ? AND attempt = ? AND status IN ('queued', 'rendering')",
    )
    .bind(error)
    .bind(now())
    .bind(video_id)
    .bind(attempt)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn delete_export(pool: &SqlitePool, video_id: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM exports WHERE video_id = ?")
        .bind(video_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Exports that were queued or rendering when the app last stopped.
/// They are put back to `queued` so the worker runs them again.
pub async fn requeue_pending_exports(pool: &SqlitePool) -> sqlx::Result<Vec<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT video_id FROM exports WHERE status NOT IN ('done', 'failed') ORDER BY created_at",
    )
    .fetch_all(pool)
    .await?;
    if !ids.is_empty() {
        sqlx::query(
            "UPDATE exports SET status = 'queued', progress = NULL, error = NULL, updated_at = ?
             WHERE status NOT IN ('done', 'failed')",
        )
        .bind(now())
        .execute(pool)
        .await?;
    }
    Ok(ids)
}

/// Videos that were queued or mid-processing when the app last stopped.
pub async fn unfinished_ids(pool: &SqlitePool) -> sqlx::Result<Vec<String>> {
    sqlx::query_scalar(
        "SELECT id FROM videos WHERE status NOT IN ('done', 'failed') ORDER BY created_at",
    )
    .fetch_all(pool)
    .await
}
