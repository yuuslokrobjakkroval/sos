//! Export a finished video with its captions.
//!
//! Two outputs, both background jobs:
//! - `burned` draws the captions into the picture with ffmpeg's `subtitles` filter
//! - `soft` muxes the SRT as a `mov_text` track so a player can turn it on and off
//!
//! The SRT used here is reflowed into short cues. The downloadable SRT/VTT on the
//! video page stays the original transcript segmentation.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use anyhow::{bail, Context};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::mpsc,
};

use crate::{
    analysis::WhisperJson,
    captions, cues,
    db::{self, ExportRow},
    models::AnalysisResult,
    pipeline, AppState,
};

pub(crate) const MODE_BURNED: &str = "burned";
pub(crate) const MODE_SOFT: &str = "soft";

pub(crate) fn valid_mode(mode: &str) -> bool {
    mode == MODE_BURNED || mode == MODE_SOFT
}

macro_rules! args {
    ($($a:expr),* $(,)?) => {
        vec![$(OsString::from($a)),*]
    };
}

/// A font that covers the caption language, plus the directory ffmpeg should scan.
pub(crate) struct CaptionFont {
    pub family: &'static str,
    pub fonts_dir: Option<PathBuf>,
}

pub fn spawn_worker(state: AppState, mut rx: mpsc::UnboundedReceiver<String>) {
    tokio::spawn(async move {
        while let Some(id) = rx.recv().await {
            tracing::info!(%id, "exporting captioned video");
            if let Err(err) = run_export(&state, &id).await {
                tracing::error!(%id, error = %err, "could not record export result");
            }
        }
    });
}

async fn run_export(state: &AppState, video_id: &str) -> anyhow::Result<()> {
    let Some(job) = db::get_export(&state.db, video_id).await? else {
        return Ok(());
    };
    let attempt = job.attempt;
    let mode = job.mode.clone();
    if !db::mark_export_rendering(&state.db, video_id, attempt).await? {
        return Ok(());
    }

    let outcome = render(state, video_id, &job).await;
    match outcome {
        Ok(Rendered::File(path)) => {
            let saved =
                db::finish_export(&state.db, video_id, attempt, &path.to_string_lossy()).await?;
            if saved {
                tracing::info!(%video_id, %mode, "caption export done");
            }
        }
        Ok(Rendered::Superseded) => {
            tracing::info!(%video_id, attempt, "caption export superseded");
        }
        Err(err) => {
            let message = clip_error(&err);
            tracing::warn!(%video_id, error = %message, "caption export failed");
            db::fail_export(&state.db, video_id, attempt, &message).await?;
        }
    }
    Ok(())
}

enum Rendered {
    File(PathBuf),
    Superseded,
}

async fn render(state: &AppState, video_id: &str, job: &ExportRow) -> anyhow::Result<Rendered> {
    let Some(video) = db::get(&state.db, video_id).await? else {
        db::delete_export(&state.db, video_id).await?;
        return Ok(Rendered::Superseded);
    };
    let result: AnalysisResult = video
        .result_json
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .context("analysis is not finished yet")?;
    if result
        .segments
        .iter()
        .all(|segment| segment.text.trim().is_empty())
    {
        bail!("this video has no captions to export");
    }

    let work = state.cfg.data_dir.join("jobs").join(video_id);
    tokio::fs::create_dir_all(&work).await?;
    let words = load_word_timings(&work.join("transcript.json")).await;
    let cues = cues::readable_cues(&result.segments, &words);
    if cues.is_empty() {
        bail!("this video has no captions to export");
    }
    let srt_path = work.join("export.srt");
    tokio::fs::write(&srt_path, captions::to_srt(&cues)).await?;

    let input = PathBuf::from(&video.stored_path);
    let probe = probe_video(&state.cfg.ffprobe, &input).await?;
    let part = work.join(format!("captioned-{}.part-{}.mp4", job.mode, job.attempt));
    let output = work.join(format!("captioned-{}.mp4", job.mode));
    let _ = tokio::fs::remove_file(&part).await;

    let language = export_language(&video.language, result.language.as_deref());
    let render_result = match job.mode.as_str() {
        MODE_BURNED => {
            let font = font_for_language(&language);
            let filter = burned_subtitle_filter(
                &srt_path,
                font.as_ref(),
                Some(probe.width),
                Some(probe.height),
            );
            run_ffmpeg(
                &state.cfg.ffmpeg,
                args![
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-progress",
                    "pipe:1",
                    "-i",
                    &input,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-vf",
                    &filter,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "copy",
                    "-movflags",
                    "+faststart",
                    &part,
                ],
                probe.duration_sec,
                |fraction| report(state, video_id, job.attempt, fraction),
            )
            .await
        }
        MODE_SOFT => {
            let lang = iso639_2(&language);
            run_ffmpeg(
                &state.cfg.ffmpeg,
                args![
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-progress",
                    "pipe:1",
                    "-i",
                    &input,
                    "-i",
                    &srt_path,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-map",
                    "1:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "copy",
                    "-c:s",
                    "mov_text",
                    "-metadata:s:s:0",
                    format!("language={lang}"),
                    "-disposition:s:0",
                    "default",
                    "-movflags",
                    "+faststart",
                    &part,
                ],
                probe.duration_sec,
                |fraction| report(state, video_id, job.attempt, fraction),
            )
            .await
        }
        other => bail!("unknown export mode '{other}'"),
    };

    match render_result {
        Ok(true) => {}
        Ok(false) => {
            let _ = tokio::fs::remove_file(&part).await;
            return Ok(Rendered::Superseded);
        }
        Err(err) => {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(err);
        }
    }

    if tokio::fs::rename(&part, &output).await.is_err() {
        let _ = tokio::fs::remove_file(&output).await;
        tokio::fs::rename(&part, &output)
            .await
            .context("could not store the captioned video")?;
    }
    Ok(Rendered::File(output))
}

async fn report(state: &AppState, video_id: &str, attempt: i64, fraction: f64) -> bool {
    db::set_export_progress(&state.db, video_id, attempt, fraction)
        .await
        .unwrap_or(false)
}

async fn load_word_timings(path: &Path) -> Vec<cues::TimedWord> {
    let Ok(bytes) = tokio::fs::read(path).await else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&bytes);
    match serde_json::from_str::<WhisperJson>(&text) {
        Ok(json) => cues::words_from_whisper(&json),
        Err(err) => {
            tracing::warn!(error = %err, "could not read word timestamps; cue timing will be estimated");
            Vec::new()
        }
    }
}

fn export_language(video_language: &str, detected: Option<&str>) -> String {
    if let Some(lang) = detected.map(str::trim).filter(|lang| !lang.is_empty()) {
        return lang.to_string();
    }
    video_language.to_string()
}

fn iso639_2(code: &str) -> String {
    let base = code
        .trim()
        .to_ascii_lowercase()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_string();
    match base.as_str() {
        "en" => "eng",
        "km" => "khm",
        "zh" => "zho",
        "th" => "tha",
        "vi" => "vie",
        "ja" => "jpn",
        "ko" => "kor",
        "fr" => "fra",
        "es" => "spa",
        "de" => "deu",
        "id" => "ind",
        "pt" => "por",
        "ru" => "rus",
        "ar" => "ara",
        "hi" => "hin",
        "it" => "ita",
        other if other.len() == 3 && other.chars().all(|c| c.is_ascii_alphabetic()) => other,
        _ => "und",
    }
    .to_string()
}

struct Probe {
    width: u32,
    height: u32,
    duration_sec: Option<f64>,
}

async fn probe_video(ffprobe: &Path, input: &Path) -> anyhow::Result<Probe> {
    let size_out = pipeline::run(
        ffprobe,
        args![
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0:s=x",
            input,
        ],
    )
    .await
    .context("could not read the video")?;
    let size = String::from_utf8_lossy(&size_out);
    let line = size
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    let mut parts = line.trim().split('x');
    let width: u32 = parts.next().unwrap_or("").trim().parse().unwrap_or(0);
    let height: u32 = parts.next().unwrap_or("").trim().parse().unwrap_or(0);
    if width == 0 || height == 0 {
        bail!("this file has no video track, so it can't be exported with captions");
    }
    Ok(Probe {
        width,
        height,
        duration_sec: probe_duration_sec(ffprobe, input).await,
    })
}

async fn probe_duration_sec(ffprobe: &Path, input: &Path) -> Option<f64> {
    let out = pipeline::run(
        ffprobe,
        args![
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            input,
        ],
    )
    .await
    .ok()?;
    let secs: f64 = String::from_utf8_lossy(&out).trim().parse().ok()?;
    (secs.is_finite() && secs > 0.0).then_some(secs)
}

/// `true` when ffmpeg finished, `false` when a newer export replaced this one.
async fn run_ffmpeg<F, Fut>(
    ffmpeg: &Path,
    args: Vec<OsString>,
    duration_sec: Option<f64>,
    mut on_progress: F,
) -> anyhow::Result<bool>
where
    F: FnMut(f64) -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let mut cmd = Command::new(ffmpeg);
    cmd.args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let mut child = cmd
        .spawn()
        .with_context(|| format!("could not start {}", ffmpeg.display()))?;
    let stdout = child
        .stdout
        .take()
        .context("ffmpeg returned no progress output")?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .context("ffmpeg returned no error output")?;
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).to_string()
    });

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut last_report: Option<Instant> = None;
    let mut superseded = false;
    while reader.read_line(&mut line).await? > 0 {
        if let Some(secs) = parse_progress_time(line.trim()) {
            if let Some(duration) = duration_sec {
                let due = last_report.is_none_or(|at| at.elapsed() >= Duration::from_millis(400));
                if due {
                    let fraction = (secs / duration).clamp(0.0, 0.99);
                    if !on_progress(fraction).await {
                        superseded = true;
                        break;
                    }
                    last_report = Some(Instant::now());
                }
            }
        }
        line.clear();
    }

    if superseded {
        let _ = child.start_kill();
        let _ = child.wait().await;
        let _ = stderr_task.await;
        return Ok(false);
    }

    let status = child.wait().await?;
    let stderr = stderr_task.await.unwrap_or_default();
    if !status.success() {
        bail!(
            "could not render the captioned video ({status}): {}",
            tail(&stderr)
        );
    }
    Ok(true)
}

/// `out_time=HH:MM:SS.microseconds` from ffmpeg `-progress`.
fn parse_progress_time(line: &str) -> Option<f64> {
    let value = line.trim().strip_prefix("out_time=")?;
    let mut parts = value.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || !hours.is_finite() || !minutes.is_finite() || !seconds.is_finite()
    {
        return None;
    }
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn tail(text: &str) -> String {
    let trimmed = text.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    chars[chars.len().saturating_sub(500)..].iter().collect()
}

fn clip_error(err: &anyhow::Error) -> String {
    let message = format!("{err:#}");
    let chars: Vec<char> = message.chars().collect();
    if chars.len() <= 800 {
        message
    } else {
        chars[chars.len() - 800..].iter().collect()
    }
}

/// Escape a path for ffmpeg's `subtitles` / `fontsdir` filter options.
///
/// The filtergraph parser and the filter-option parser each consume one layer
/// of backslash escapes (ffmpeg 6, arguments passed with no shell). Backslash,
/// colon and single quote are special to both layers, so a backslash is written
/// four times and colon or quote three times. Comma, semicolon and square
/// brackets only separate filters, so they are escaped once.
pub(crate) fn escape_subtitles_filter_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        match c {
            '\\' => out.push_str("\\\\\\\\"),
            ':' | '\'' => {
                out.push_str("\\\\\\");
                out.push(c);
            }
            ',' | ';' | '[' | ']' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

struct CaptionMetrics {
    font_size: u32,
    margin_v: u32,
    outline: u32,
    frame: Option<(u32, u32)>,
}

/// Font size, outline and bottom margin.
///
/// With a known frame size, `original_size` makes these values pixels, scaled
/// to the video height (about 4.5% for the type). Without one, the numbers are
/// in the SRT default PlayRes of 288 and libass scales them with the frame.
fn caption_metrics(width: Option<u32>, height: Option<u32>) -> CaptionMetrics {
    match (width, height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => CaptionMetrics {
            font_size: scale_px(h, 0.045, 16, 160),
            margin_v: scale_px(h, 0.055, 8, 180),
            outline: scale_px(h, 1.0 / 280.0, 2, 8),
            frame: Some((w, h)),
        },
        _ => CaptionMetrics {
            font_size: 18,
            margin_v: 20,
            outline: 2,
            frame: None,
        },
    }
}

fn scale_px(height: u32, ratio: f64, min: u32, max: u32) -> u32 {
    ((height as f64) * ratio)
        .round()
        .clamp(min as f64, max as f64) as u32
}

fn force_style(font: Option<&CaptionFont>, metrics: &CaptionMetrics) -> String {
    let mut style = String::new();
    if let Some(font) = font {
        style.push_str(&format!("FontName={},", font.family));
    }
    style.push_str(&format!(
        "FontSize={},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline={},Shadow=0,Alignment=2,MarginV={}",
        metrics.font_size, metrics.outline, metrics.margin_v
    ));
    style
}

/// `subtitles=...` filter: white text, black outline, bottom center.
pub(crate) fn burned_subtitle_filter(
    srt: &Path,
    font: Option<&CaptionFont>,
    width: Option<u32>,
    height: Option<u32>,
) -> String {
    let metrics = caption_metrics(width, height);
    let mut filter = format!(
        "subtitles={}",
        escape_subtitles_filter_path(&srt.to_string_lossy())
    );
    if let Some((w, h)) = metrics.frame {
        filter.push_str(&format!(":original_size={w}x{h}"));
    }
    if let Some(dir) = font.and_then(|font| font.fonts_dir.as_deref()) {
        filter.push_str(":fontsdir=");
        filter.push_str(&escape_subtitles_filter_path(&dir.to_string_lossy()));
    }
    filter.push_str(":force_style='");
    filter.push_str(&force_style(font, &metrics));
    filter.push('\'');
    filter
}

pub(crate) fn font_for_language(language: &str) -> Option<CaptionFont> {
    if !is_khmer(language) {
        return None;
    }
    let fonts_dir = find_khmer_font(&default_font_roots())
        .and_then(|path| path.parent().map(Path::to_path_buf));
    Some(CaptionFont {
        family: "Noto Sans Khmer",
        fonts_dir,
    })
}

fn is_khmer(language: &str) -> bool {
    let code = language.trim().to_ascii_lowercase();
    let base = code.split(['-', '_']).next().unwrap_or("");
    base == "km" || base == "khm"
}

fn default_font_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/usr/share/fonts"),
        PathBuf::from("/usr/local/share/fonts"),
        PathBuf::from("/Library/Fonts"),
        PathBuf::from("/System/Library/Fonts"),
        PathBuf::from("/System/Library/Fonts/Supplemental"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join(".local/share/fonts"));
        roots.push(home.join(".fonts"));
        roots.push(home.join("Library/Fonts"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Microsoft/Windows/Fonts"));
    }
    if let Some(windir) = std::env::var_os("WINDIR").or_else(|| std::env::var_os("SystemRoot")) {
        roots.push(PathBuf::from(windir).join("Fonts"));
    } else if cfg!(windows) {
        roots.push(PathBuf::from(r"C:\Windows\Fonts"));
    }
    roots
}

fn find_khmer_font(roots: &[PathBuf]) -> Option<PathBuf> {
    const NAMES: &[&str] = &[
        "NotoSansKhmer-Regular.ttf",
        "NotoSansKhmer-Regular.otf",
        "NotoSansKhmer.ttf",
    ];
    const SUBS: &[&str] = &[
        "",
        "truetype/noto",
        "opentype/noto",
        "noto",
        "TTF",
        "truetype",
    ];
    for root in roots {
        for sub in SUBS {
            for name in NAMES {
                let path = root.join(sub).join(name);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    let mut found = Vec::new();
    for root in roots {
        collect_fonts(root, "notosanskhmer", &mut found, 0);
    }
    found.sort_by_key(|path| font_rank(path));
    found.into_iter().next()
}

fn collect_fonts(dir: &Path, stem: &str, found: &mut Vec<PathBuf>, depth: u32) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_fonts(&path, stem, found, depth + 1);
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let lower = name.to_ascii_lowercase();
        let font_file =
            lower.ends_with(".ttf") || lower.ends_with(".otf") || lower.ends_with(".ttc");
        if font_file && lower.contains(stem) {
            found.push(path);
        }
    }
}

fn font_rank(path: &Path) -> (u8, usize, String) {
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let kind = if name.contains("regular") {
        0
    } else if name.contains("bold")
        || name.contains("black")
        || name.contains("medium")
        || name.contains("light")
    {
        2
    } else {
        1
    };
    let len = name.len();
    (kind, len, name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn unescape_once(input: &str, terminators: &[char]) -> String {
        let mut out = String::new();
        let mut chars = input.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
                continue;
            }
            if terminators.contains(&c) {
                break;
            }
            out.push(c);
        }
        out
    }

    /// The same two passes ffmpeg applies: filtergraph, then the option parser.
    fn round_trip(path: &str) -> String {
        let escaped = escape_subtitles_filter_path(path);
        let after_graph = unescape_once(&escaped, &[',', ';', '[', ']']);
        unescape_once(&after_graph, &[':'])
    }

    #[test]
    fn escapes_filter_paths_with_special_characters() {
        let samples = [
            "/data/jobs/abc/export.srt",
            "/tmp/a:b's,dir[1]/cap.srt",
            r"C:\show's, [pilot]:ep.srt",
            "/tmp/a;b[c]d\\e.srt",
        ];
        for path in samples {
            assert_eq!(round_trip(path), path, "{path}");
        }

        assert_eq!(
            escape_subtitles_filter_path("/tmp/a:b's,dir[1]/cap.srt"),
            r"/tmp/a\\\:b\\\'s\,dir\[1\]/cap.srt"
        );
        assert_eq!(
            escape_subtitles_filter_path(r"C:\show's, [pilot]:ep.srt"),
            r"C\\\:\\\\show\\\'s\, \[pilot\]\\\:ep.srt"
        );
    }

    #[test]
    fn burned_filter_uses_a_readable_scaled_style() {
        let path = Path::new("/tmp/a:b's,dir[1]/cap.srt");
        let font = CaptionFont {
            family: "Noto Sans Khmer",
            fonts_dir: Some(PathBuf::from("/usr/share/fonts/truetype/noto")),
        };
        let filter = burned_subtitle_filter(path, Some(&font), Some(1920), Some(1080));
        let escaped = escape_subtitles_filter_path("/tmp/a:b's,dir[1]/cap.srt");
        assert!(
            filter.starts_with(&format!("subtitles={escaped}:")),
            "{filter}"
        );
        assert!(filter.contains(":original_size=1920x1080"));
        assert!(filter.contains(":fontsdir=/usr/share/fonts/truetype/noto:"));
        assert!(filter.contains("FontName=Noto Sans Khmer"));
        // 1080 * 0.045 = 48.6 → 49; margin 1080 * 0.055 = 59; outline 1080/280 ≈ 4.
        assert!(filter.contains("FontSize=49"));
        assert!(filter.contains("MarginV=59"));
        assert!(filter.contains("Outline=4"));
        assert!(filter.contains("PrimaryColour=&H00FFFFFF"));
        assert!(filter.contains("OutlineColour=&H00000000"));
        assert!(filter.contains("BackColour=&H80000000"));
        assert!(filter.contains("BorderStyle=1"));
        assert!(filter.contains("Alignment=2"));
        assert!(filter.contains("Shadow=0"));

        let plain = burned_subtitle_filter(Path::new("/tmp/cap.srt"), None, None, None);
        assert_eq!(
            plain,
            "subtitles=/tmp/cap.srt:force_style='FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=20'"
        );
    }

    #[test]
    fn parses_ffmpeg_progress_time() {
        assert_eq!(parse_progress_time("out_time=00:00:01.960000"), Some(1.96));
        assert_eq!(
            parse_progress_time("out_time=01:02:03.500000"),
            Some(3723.5)
        );
        assert_eq!(parse_progress_time("out_time=N/A"), None);
        assert_eq!(parse_progress_time("out_time_ms=1960000"), None);
        assert_eq!(parse_progress_time("progress=continue"), None);
    }

    #[test]
    fn khmer_requests_noto_and_other_languages_do_not() {
        let font = font_for_language("km").expect("khmer");
        assert_eq!(font.family, "Noto Sans Khmer");
        assert!(font_for_language("KM").is_some());
        assert!(font_for_language("km-KH").is_some());
        assert!(font_for_language("en").is_none());
        assert!(font_for_language("auto").is_none());
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static N: AtomicU64 = AtomicU64::new(0);
            let n = N.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("automate-fonts-{}-{n}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Runs ffmpeg when it is installed, so the escaped filter is checked against
    /// the real parser and not only the stand-in above.
    #[test]
    fn ffmpeg_accepts_escaped_subtitles_filter() {
        let ffmpeg = PathBuf::from("ffmpeg");
        let Ok(status) = std::process::Command::new(&ffmpeg)
            .arg("-hide_banner")
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
        else {
            return;
        };
        if !status.success() {
            return;
        }

        let root = TempDir::new();
        let dir = root.0.join("a:b's,dir[1]");
        fs::create_dir_all(&dir).unwrap();
        let srt = dir.join("cap.srt");
        fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n").unwrap();
        let input = root.0.join("in.mp4");
        let output = root.0.join("out.mp4");
        let made = std::process::Command::new(&ffmpeg)
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(made.success(), "could not make a sample video");

        let font = CaptionFont {
            family: "Noto Sans Khmer",
            fonts_dir: Path::new("/usr/share/fonts/truetype/noto")
                .is_dir()
                .then(|| PathBuf::from("/usr/share/fonts/truetype/noto")),
        };
        let filter = burned_subtitle_filter(&srt, Some(&font), Some(320), Some(180));
        let burned = std::process::Command::new(&ffmpeg)
            .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
            .arg(&input)
            .args(["-vf", &filter, "-an"])
            .arg(&output)
            .output()
            .unwrap();
        assert!(
            burned.status.success(),
            "ffmpeg rejected the subtitles filter:\n{filter}\n{}",
            String::from_utf8_lossy(&burned.stderr)
        );
        assert!(output.is_file());
    }

    #[test]
    fn font_search_prefers_regular_and_finds_nested_files() {
        let root = TempDir::new();
        fs::write(root.0.join("NotoSansKhmer-Regular.ttf"), b"r").unwrap();
        let nested = root.0.join("truetype").join("noto");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("NotoSansKhmer-Bold.ttf"), b"b").unwrap();
        let found = find_khmer_font(std::slice::from_ref(&root.0)).unwrap();
        assert_eq!(found.file_name().unwrap(), "NotoSansKhmer-Regular.ttf");

        fs::remove_file(root.0.join("NotoSansKhmer-Regular.ttf")).unwrap();
        let found = find_khmer_font(std::slice::from_ref(&root.0)).unwrap();
        assert_eq!(found.file_name().unwrap(), "NotoSansKhmer-Bold.ttf");
    }
}
