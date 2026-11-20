//! HTTP API (`/api/...`) plus the static website.

use std::path::{Path as FsPath, PathBuf};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Request, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::json;
use tokio::io::AsyncWriteExt;
use tower::ServiceExt;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

use crate::{
    captions,
    db::{self, VideoRow},
    export::{self, MODE_SOFT},
    models::{AnalysisResult, ExportDto, VideoDto},
    pipeline, AppState,
};

const ALLOWED_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "m4v", "mkv", "webm", "avi", "wmv", "flv", "3gp", "mpeg", "mpg", "ts", "mp3",
    "wav", "m4a", "aac", "ogg", "flac",
];

pub fn router(state: AppState) -> Router {
    let upload_limit = (state.cfg.max_upload_mb as usize).saturating_mul(1024 * 1024) + 1024 * 1024;
    let static_dir = state.cfg.static_dir.clone();

    let api = Router::new()
        .route("/health", get(health))
        .route(
            "/videos",
            get(list_videos)
                .post(upload_video)
                .layer(DefaultBodyLimit::max(upload_limit)),
        )
        .route("/videos/{id}", get(get_video).delete(delete_video))
        .route("/videos/{id}/media", get(media))
        .route("/videos/{id}/captions/{format}", get(download_captions))
        .route("/videos/{id}/export", get(get_export).post(start_export))
        .route("/videos/{id}/export/file", get(download_export))
        .route("/videos/{id}/retry", axum::routing::post(retry_video));

    let mut app = Router::new().nest("/api", api);
    if let Some(dir) = static_dir {
        // Single-page app: unknown paths fall back to index.html.
        let index = dir.join("index.html");
        app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index)));
    }

    app.layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

// ---------- errors ----------

pub struct ApiError(StatusCode, String);

impl ApiError {
    fn new(status: StatusCode, msg: impl Into<String>) -> Self {
        Self(status, msg.into())
    }
    fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "video not found")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(err: E) -> Self {
        let err = err.into();
        tracing::error!("{err:#}");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, format!("{err:#}"))
    }
}

type ApiResult<T> = Result<T, ApiError>;

async fn find(state: &AppState, id: &str) -> ApiResult<VideoRow> {
    db::get(&state.db, id)
        .await?
        .ok_or_else(ApiError::not_found)
}

// ---------- handlers ----------

/// Reports whether the free local tools (ffmpeg, whisper) are installed.
async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = &state.cfg;
    let ffmpeg = pipeline::run(&cfg.ffmpeg, vec!["-version".into()])
        .await
        .is_ok();
    // whisper-cli's exit code for --help varies between versions; starting at all is enough.
    let whisper = tokio::process::Command::new(&cfg.whisper_bin)
        .arg("--help")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await
        .is_ok();
    let model = cfg.whisper_model.is_file();
    let model_name = cfg
        .whisper_model
        .file_name()
        .map(|n| n.to_string_lossy().to_string());

    let vision_model = crate::vision::find_model(cfg).await;

    Json(json!({
        "ok": ffmpeg && whisper && model,
        "vision": vision_model.is_some(),
        "vision_model": vision_model,
        "ffmpeg": ffmpeg,
        "whisper": whisper,
        "model": model,
        "model_name": model_name,
        "max_upload_mb": cfg.max_upload_mb,
    }))
}

async fn list_videos(State(state): State<AppState>) -> ApiResult<Json<Vec<VideoDto>>> {
    let rows = db::list(&state.db).await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| VideoDto::from_row(r, false))
            .collect(),
    ))
}

async fn get_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<VideoDto>> {
    Ok(Json(VideoDto::from_row(find(&state, &id).await?, true)))
}

fn valid_language(lang: &str) -> bool {
    lang == "auto"
        || ((2..=3).contains(&lang.len()) && lang.chars().all(|c| c.is_ascii_lowercase()))
}

/// `multipart/form-data` with fields `file` (the video) and optional `language` (`auto`, `en`, `km`...).
async fn upload_video(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> ApiResult<(StatusCode, Json<VideoDto>)> {
    let bad = |m: String| ApiError::new(StatusCode::BAD_REQUEST, m);
    let id = uuid::Uuid::new_v4().to_string();
    let max_bytes = state.cfg.max_upload_mb * 1024 * 1024;
    let mut language = "auto".to_string();
    let mut saved: Option<(String, PathBuf, u64)> = None;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| bad(e.body_text()))?
    {
        match field.name() {
            Some("language") => {
                language = field
                    .text()
                    .await
                    .map_err(|e| bad(e.body_text()))?
                    .trim()
                    .to_lowercase();
                if !valid_language(&language) {
                    return Err(bad(format!("unsupported language code '{language}'")));
                }
            }
            Some("file") if saved.is_none() => {
                let filename = field.file_name().unwrap_or("video.mp4").to_string();
                let ext = FsPath::new(&filename)
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
                    return Err(bad(format!(
                        "unsupported file type '.{ext}'. Allowed: {}",
                        ALLOWED_EXTENSIONS.join(", ")
                    )));
                }

                let path = state
                    .cfg
                    .data_dir
                    .join("uploads")
                    .join(format!("{id}.{ext}"));
                let mut file = tokio::fs::File::create(&path).await?;
                let mut size: u64 = 0;
                loop {
                    let chunk = match field.chunk().await {
                        Ok(Some(c)) => c,
                        Ok(None) => break,
                        Err(e) => {
                            drop(file);
                            let _ = tokio::fs::remove_file(&path).await;
                            return Err(bad(e.body_text()));
                        }
                    };
                    size += chunk.len() as u64;
                    if size > max_bytes {
                        drop(file);
                        let _ = tokio::fs::remove_file(&path).await;
                        return Err(ApiError::new(
                            StatusCode::PAYLOAD_TOO_LARGE,
                            format!("file is larger than {} MB", state.cfg.max_upload_mb),
                        ));
                    }
                    file.write_all(&chunk).await?;
                }
                file.flush().await?;
                saved = Some((filename, path, size));
            }
            _ => {}
        }
    }

    let (filename, path, size) = saved.ok_or_else(|| bad("no file was uploaded".into()))?;
    if size == 0 {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(bad("the uploaded file is empty".into()));
    }

    let now = db::now();
    let row = VideoRow {
        id: id.clone(),
        filename,
        stored_path: path.to_string_lossy().to_string(),
        size_bytes: size as i64,
        language,
        status: "queued".into(),
        error: None,
        result_json: None,
        created_at: now.clone(),
        updated_at: now,
        progress: None,
    };
    db::insert(&state.db, &row).await?;
    let _ = state.queue.send(id);
    Ok((StatusCode::CREATED, Json(VideoDto::from_row(row, false))))
}

async fn retry_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<VideoDto>> {
    let row = find(&state, &id).await?;
    if row.status != "failed" && row.status != "done" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "this video is already being analyzed",
        ));
    }
    db::set_status(&state.db, &id, "queued").await?;
    let _ = state.queue.send(id.clone());
    Ok(Json(VideoDto::from_row(find(&state, &id).await?, false)))
}

async fn delete_video(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let row = find(&state, &id).await?;
    db::delete(&state.db, &id).await?;
    let _ = db::delete_export(&state.db, &id).await;
    let _ = tokio::fs::remove_file(&row.stored_path).await;
    let _ = tokio::fs::remove_dir_all(state.cfg.data_dir.join("jobs").join(&id)).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Streams the original video (supports seeking via HTTP range requests).
async fn media(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req: Request,
) -> ApiResult<Response> {
    let row = find(&state, &id).await?;
    let res = ServeFile::new(&row.stored_path)
        .oneshot(req)
        .await
        .map_err(|e| match e {})?;
    Ok(res.map(Body::new))
}

/// `GET /api/videos/{id}/captions/{srt|vtt|txt}`
async fn download_captions(
    State(state): State<AppState>,
    Path((id, format)): Path<(String, String)>,
) -> ApiResult<Response> {
    let row = find(&state, &id).await?;
    let result: AnalysisResult = row
        .result_json
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "analysis is not finished yet"))?;

    let (body, content_type) = match format.as_str() {
        "srt" => (captions::to_srt(&result.segments), "application/x-subrip"),
        "vtt" => (captions::to_vtt(&result.segments), "text/vtt"),
        "txt" => (result.text.clone(), "text/plain"),
        _ => {
            return Err(ApiError::new(
                StatusCode::NOT_FOUND,
                "format must be srt, vtt or txt",
            ))
        }
    };

    let stem = download_stem(&row.filename);
    let disposition = format!("attachment; filename=\"{stem}.{format}\"");

    let mut res = body.into_response();
    let headers = res.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&format!("{content_type}; charset=utf-8")).unwrap(),
    );
    if let Ok(v) = HeaderValue::from_str(&disposition) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    Ok(res)
}

#[derive(serde::Deserialize)]
struct ExportRequest {
    mode: String,
}

/// `POST /api/videos/{id}/export` with `{ "mode": "burned" | "soft" }`.
async fn start_export(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<ExportRequest>,
) -> ApiResult<(StatusCode, Json<ExportDto>)> {
    let mode = body.mode.trim().to_ascii_lowercase();
    if !export::valid_mode(&mode) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "mode must be \"burned\" or \"soft\"",
        ));
    }
    let row = find(&state, &id).await?;
    if row.status != "done" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "analysis is not finished yet",
        ));
    }
    let result: AnalysisResult = row
        .result_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "analysis is not finished yet"))?;
    if result
        .segments
        .iter()
        .all(|segment| segment.text.trim().is_empty())
    {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "this video has no captions to export",
        ));
    }
    if let Some(current) = db::get_export(&state.db, &id).await? {
        let running = current.status == "queued" || current.status == "rendering";
        if running && current.mode == mode {
            return Ok((StatusCode::OK, Json(ExportDto::from_row(current))));
        }
        if running {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "an export is already running — wait for it to finish",
            ));
        }
    }

    let export = db::upsert_export(&state.db, &id, &mode).await?;
    let _ = state.export_queue.send(id);
    Ok((StatusCode::ACCEPTED, Json(ExportDto::from_row(export))))
}

/// `GET /api/videos/{id}/export`
async fn get_export(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<ExportDto>> {
    let _ = find(&state, &id).await?;
    let export = db::get_export(&state.db, &id).await?.ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "no captioned video has been exported yet",
        )
    })?;
    Ok(Json(ExportDto::from_row(export)))
}

/// `GET /api/videos/{id}/export/file`
async fn download_export(
    State(state): State<AppState>,
    Path(id): Path<String>,
    req: Request,
) -> ApiResult<Response> {
    let row = find(&state, &id).await?;
    let export = db::get_export(&state.db, &id).await?.ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "no captioned video has been exported yet",
        )
    })?;
    if export.status != "done" {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "the captioned video is not ready yet",
        ));
    }
    let path = export
        .output_path
        .filter(|path| FsPath::new(path).is_file())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "the exported file is missing — export it again",
            )
        })?;

    let mut res = ServeFile::new(&path)
        .oneshot(req)
        .await
        .map_err(|e| match e {})?;
    let label = if export.mode == MODE_SOFT {
        "soft-captions"
    } else {
        "burned-captions"
    };
    let disposition = format!(
        "attachment; filename=\"{}-{label}.mp4\"",
        download_stem(&row.filename)
    );
    if let Ok(value) = HeaderValue::from_str(&disposition) {
        res.headers_mut().insert(header::CONTENT_DISPOSITION, value);
    }
    Ok(res.map(Body::new))
}

fn download_stem(filename: &str) -> String {
    let stem: String = FsPath::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if stem.trim_matches('_').is_empty() {
        "captions".to_string()
    } else {
        stem
    }
}
