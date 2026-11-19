//! Background worker: video → audio (ffmpeg) → transcript (whisper.cpp) → analysis.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
};

use anyhow::{bail, Context};
use tokio::{process::Command, sync::mpsc};

use crate::{analysis, db, models::AnalysisResult, vision, AppState};

/// Build a `Vec<OsString>` from strings and paths.
macro_rules! args {
    ($($a:expr),* $(,)?) => {
        vec![$(OsString::from($a)),*]
    };
}

/// Processes one video at a time (transcription already uses every CPU core).
pub fn spawn_worker(state: AppState, mut rx: mpsc::UnboundedReceiver<String>) {
    tokio::spawn(async move {
        while let Some(id) = rx.recv().await {
            tracing::info!(%id, "processing video");
            let outcome = process(&state, &id).await;
            let saved = match outcome {
                Ok(result) => {
                    tracing::info!(%id, words = result.stats.word_count, "done");
                    let json = serde_json::to_string(&result).unwrap_or_default();
                    db::set_done(&state.db, &id, &json).await
                }
                Err(err) => {
                    let msg = format!("{err:#}");
                    tracing::warn!(%id, error = %msg, "failed");
                    db::set_failed(&state.db, &id, &msg).await
                }
            };
            if let Err(e) = saved {
                tracing::error!(%id, error = %e, "could not save job result");
            }
        }
    });
}

async fn process(state: &AppState, id: &str) -> anyhow::Result<AnalysisResult> {
    let cfg = &state.cfg;
    let row = db::get(&state.db, id)
        .await?
        .context("video was deleted before processing")?;
    let input = PathBuf::from(&row.stored_path);
    let work = cfg.data_dir.join("jobs").join(id);
    tokio::fs::create_dir_all(&work).await?;

    // 1. Extract 16 kHz mono audio — the format Whisper expects.
    db::set_status(&state.db, id, "extracting_audio").await?;
    let duration_ms = probe_duration_ms(&cfg.ffprobe, &input).await;
    if has_audio_stream(&cfg.ffprobe, &input).await == Some(false) {
        return read_screen_or(state, &row, &work, duration_ms, analysis::silent(duration_ms)).await;
    }
    let wav = work.join("audio.wav");
    run(
        &cfg.ffmpeg,
        args![
            "-y", "-hide_banner", "-loglevel", "error", "-i", &input, "-vn", "-ac", "1", "-ar",
            "16000", "-c:a", "pcm_s16le", &wav
        ],
    )
    .await
    .context("could not extract audio (does the file have a sound track?)")?;

    // Silent track (e.g. screen recording with the mic off): nothing to transcribe.
    if let Some(max_db) = max_volume_db(&cfg.ffmpeg, &wav).await {
        if max_db < SILENCE_BELOW_DB {
            tracing::info!(%id, max_db, "audio is silent, skipping transcription");
            let _ = tokio::fs::remove_file(&wav).await;
            return read_screen_or(state, &row, &work, duration_ms, analysis::silent(duration_ms)).await;
        }
    }

    // 2. Transcribe with timestamps.
    db::set_status(&state.db, id, "transcribing").await?;
    if !cfg.whisper_model.is_file() {
        bail!(
            "Whisper model not found at {} — run scripts/setup-tools.ps1",
            cfg.whisper_model.display()
        );
    }
    let out_base = work.join("transcript");
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
        .to_string();
    run(
        &cfg.whisper_bin,
        args![
            "-m", &cfg.whisper_model, "-f", &wav, "-l", &row.language, "-t", &threads, "-oj",
            "-of", &out_base, "-np"
        ],
    )
    .await
    .context("speech-to-text (whisper) failed")?;

    // 3. Build transcript, captions and speed stats.
    db::set_status(&state.db, id, "analyzing").await?;
    let raw = tokio::fs::read(work.join("transcript.json"))
        .await
        .context("whisper produced no transcript file")?;
    // whisper.cpp can split multi-byte characters (e.g. Khmer) across tokens.
    let text = String::from_utf8_lossy(&raw);
    let parsed: analysis::WhisperJson =
        serde_json::from_str(&text).context("could not read whisper output")?;
    let result = analysis::build(parsed, duration_ms);
    let _ = tokio::fs::remove_file(&wav).await;

    // Sound but no speech (e.g. music over a screen recording): read the screen instead.
    if result.segments.is_empty() {
        return read_screen_or(state, &row, &work, duration_ms, result).await;
    }
    Ok(result)
}

/// Writes step captions from what happens on screen, using a local vision model.
/// Returns `fallback` when no vision model is available or nothing could be read.
async fn read_screen_or(
    state: &AppState,
    row: &db::VideoRow,
    work: &Path,
    duration_ms: Option<i64>,
    mut fallback: AnalysisResult,
) -> anyhow::Result<AnalysisResult> {
    let cfg = &state.cfg;
    let Some(model) = vision::find_model(cfg).await else {
        let tip = " Tip: install Ollama and a vision model (see README → \"Silent videos\") \
                   and Automate will write step captions from what happens on screen.";
        fallback.notice = Some(format!("{}{tip}", fallback.notice.unwrap_or_default()));
        return Ok(fallback);
    };

    db::set_status(&state.db, &row.id, "reading_screen").await?;
    let frames = extract_keyframes(cfg, Path::new(&row.stored_path), work).await?;
    tracing::info!(id = %row.id, frames = frames.len(), %model, "reading screen");
    if frames.is_empty() {
        return Ok(fallback);
    }

    let (db, id) = (state.db.clone(), row.id.clone());
    let result = vision::describe_steps(cfg, &model, &frames, duration_ms, &row.language, |p| {
        let (db, id) = (db.clone(), id.clone());
        async move {
            let _ = db::set_progress(&db, &id, p).await;
        }
    })
    .await?;

    let _ = tokio::fs::remove_dir_all(work.join("frames")).await;
    Ok(if result.segments.is_empty() { fallback } else { result })
}

/// Saves a frame each time the screen changes and returns the frames worth describing.
async fn extract_keyframes(
    cfg: &crate::Config,
    input: &Path,
    work: &Path,
) -> anyhow::Result<Vec<vision::Keyframe>> {
    let dir = work.join("frames");
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(&dir).await?;

    let (_, stderr) = run_capture(
        &cfg.ffmpeg,
        args![
            "-hide_banner", "-nostats", "-i", input, "-an", "-vf", vision::CHANGE_FILTER,
            "-fps_mode", "vfr",
            "-q:v", "3", dir.join("%05d.jpg")
        ],
    )
    .await
    .context("could not extract frames from the video")?;

    let times = vision::parse_showinfo_times(&stderr);
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "jpg"))
        .collect();
    files.sort();

    let frames = files
        .into_iter()
        .zip(times)
        .map(|(path, time_ms)| vision::Keyframe { time_ms, path })
        .collect();
    Ok(vision::select_keyframes(frames))
}

/// Audio whose loudest moment is quieter than this is treated as silence.
const SILENCE_BELOW_DB: f64 = -60.0;

/// Peak loudness of an audio file in dB (0 = maximum), via ffmpeg's volumedetect.
async fn max_volume_db(ffmpeg: &Path, audio: &Path) -> Option<f64> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(args!["-hide_banner", "-nostats", "-i", audio, "-af", "volumedetect", "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = cmd.output().await.ok()?;
    analysis::parse_max_volume(&String::from_utf8_lossy(&out.stderr))
}

/// `Some(false)` if the file definitely has no audio track; `None` if unknown.
async fn has_audio_stream(ffprobe: &Path, input: &Path) -> Option<bool> {
    let out = run(
        ffprobe,
        args!["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", input],
    )
    .await
    .ok()?;
    Some(!String::from_utf8_lossy(&out).trim().is_empty())
}

/// Video length in milliseconds, if ffprobe is available.
async fn probe_duration_ms(ffprobe: &Path, input: &Path) -> Option<i64> {
    let out = run(
        ffprobe,
        args![
            "-v", "error", "-show_entries", "format=duration", "-of",
            "default=noprint_wrappers=1:nokey=1", input
        ],
    )
    .await
    .ok()?;
    let secs: f64 = String::from_utf8_lossy(&out).trim().parse().ok()?;
    Some((secs * 1000.0).round() as i64)
}

/// Like [`run`], but also returns stderr as text (ffmpeg writes its reports there).
async fn run_capture(program: &Path, args: Vec<OsString>) -> anyhow::Result<(Vec<u8>, String)> {
    let mut cmd = Command::new(program);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = cmd
        .output()
        .await
        .with_context(|| format!("could not start {}", program.display()))?;
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        let tail: String = {
            let chars: Vec<char> = stderr.trim().chars().collect();
            chars[chars.len().saturating_sub(600)..].iter().collect()
        };
        bail!("{} exited with {}: {}", program.display(), out.status, tail);
    }
    Ok((out.stdout, stderr))
}

/// Run an external tool without a console window, returning stdout or a readable error.
pub async fn run(program: &Path, args: Vec<OsString>) -> anyhow::Result<Vec<u8>> {
    let mut cmd = Command::new(program);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let out = cmd
        .output()
        .await
        .with_context(|| format!("could not start {}", program.display()))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: String = {
            let chars: Vec<char> = stderr.trim().chars().collect();
            chars[chars.len().saturating_sub(600)..].iter().collect()
        };
        bail!("{} exited with {}: {}", program.display(), out.status, tail);
    }
    Ok(out.stdout)
}
