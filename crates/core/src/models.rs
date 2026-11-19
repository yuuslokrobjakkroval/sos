use serde::{Deserialize, Serialize};

use crate::db::VideoRow;

/// One timed piece of the transcript (becomes one caption cue).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    /// Speaking speed inside this segment.
    pub wpm: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub duration_sec: f64,
    /// Total time covered by speech segments.
    pub speaking_sec: f64,
    pub word_count: usize,
    /// Words per minute of speech (the "speaking speed").
    pub wpm: f64,
    /// Words per minute across the whole video, including silence.
    pub wpm_overall: f64,
    /// "slow" | "normal" | "fast" | "no_speech" | "no_audio"
    pub pace: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    /// "speech" (transcribed from audio) or "visual" (described from the screen).
    #[serde(default = "speech_mode")]
    pub mode: String,
    /// Language detected (or forced) by Whisper, e.g. "en", "km".
    pub language: Option<String>,
    pub text: String,
    pub segments: Vec<Segment>,
    pub stats: Stats,
    /// Explanation shown to the user when the result is empty or unusual.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

fn speech_mode() -> String {
    "speech".into()
}

/// What the API returns for a video.
#[derive(Debug, Serialize)]
pub struct VideoDto {
    pub id: String,
    pub filename: String,
    pub size_bytes: i64,
    pub language: String,
    pub status: String,
    /// 0..1 progress within the current step, when known.
    pub progress: Option<f64>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<AnalysisResult>,
}

impl VideoDto {
    pub fn from_row(row: VideoRow, with_result: bool) -> Self {
        let result = if with_result {
            row.result_json
                .as_deref()
                .and_then(|j| serde_json::from_str(j).ok())
        } else {
            None
        };
        Self {
            id: row.id,
            filename: row.filename,
            size_bytes: row.size_bytes,
            language: row.language,
            status: row.status,
            progress: row.progress,
            error: row.error,
            created_at: row.created_at,
            updated_at: row.updated_at,
            result,
        }
    }
}
