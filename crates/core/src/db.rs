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
    // Migration for databases created before the progress column existed.
    let has_progress: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pragma_table_info('videos') WHERE name = 'progress'")
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
    sqlx::query("UPDATE videos SET status = ?, error = NULL, progress = NULL, updated_at = ? WHERE id = ?")
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

/// Videos that were queued or mid-processing when the app last stopped.
pub async fn unfinished_ids(pool: &SqlitePool) -> sqlx::Result<Vec<String>> {
    sqlx::query_scalar(
        "SELECT id FROM videos WHERE status NOT IN ('done', 'failed') ORDER BY created_at",
    )
    .fetch_all(pool)
    .await
}
