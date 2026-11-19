//! Turns raw Whisper output into transcript, captions and speaking-speed stats.

use serde::Deserialize;

use crate::models::{AnalysisResult, Segment, Stats};

/// The parts of whisper.cpp's `-oj` JSON output we use.
#[derive(Debug, Deserialize)]
pub struct WhisperJson {
    #[serde(default)]
    pub result: Option<WhisperResult>,
    #[serde(default)]
    pub transcription: Vec<WhisperSegment>,
}

#[derive(Debug, Deserialize)]
pub struct WhisperResult {
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WhisperSegment {
    pub offsets: WhisperOffsets,
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct WhisperOffsets {
    pub from: i64,
    pub to: i64,
}

/// Speaking-speed thresholds (words per minute) for the pace label.
const SLOW_BELOW_WPM: f64 = 110.0;
const FAST_ABOVE_WPM: f64 = 160.0;

/// Result for a video whose sound track is silent (or missing).
pub fn silent(duration_ms: Option<i64>) -> AnalysisResult {
    AnalysisResult {
        mode: "silent".into(),
        language: None,
        text: String::new(),
        segments: Vec::new(),
        stats: Stats {
            duration_sec: round1(duration_ms.unwrap_or(0) as f64 / 1000.0),
            speaking_sec: 0.0,
            word_count: 0,
            wpm: 0.0,
            wpm_overall: 0.0,
            pace: "no_audio".into(),
        },
        notice: Some(
            "This video has no sound — its audio track is completely silent, so there is no \
             speech to transcribe. Screen recordings often have the microphone turned off. \
             Re-record with the microphone on, or upload a video where someone speaks."
                .into(),
        ),
    }
}

pub fn count_words(text: &str) -> usize {
    text.split_whitespace()
        .filter(|w| w.chars().any(char::is_alphanumeric))
        .count()
}

/// Reads `max_volume: -91.0 dB` from ffmpeg's `volumedetect` output.
pub fn parse_max_volume(ffmpeg_stderr: &str) -> Option<f64> {
    ffmpeg_stderr
        .lines()
        .find_map(|l| l.split("max_volume:").nth(1))
        .and_then(|v| v.trim().trim_end_matches("dB").trim().parse().ok())
}

fn per_minute(words: usize, ms: i64) -> f64 {
    if ms <= 0 {
        return 0.0;
    }
    round1(words as f64 / (ms as f64 / 60_000.0))
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Whisper marks non-speech as e.g. `[BLANK_AUDIO]`, `[Music]`, `(applause)`.
fn is_non_speech(text: &str) -> bool {
    let t = text.trim();
    t.is_empty()
        || (t.starts_with('[') && t.ends_with(']'))
        || (t.starts_with('(') && t.ends_with(')'))
}

pub fn build(whisper: WhisperJson, duration_ms: Option<i64>) -> AnalysisResult {
    let segments: Vec<Segment> = whisper
        .transcription
        .into_iter()
        .filter(|s| !is_non_speech(&s.text))
        .map(|s| {
            let text = s.text.trim().to_string();
            let words = count_words(&text);
            Segment {
                start_ms: s.offsets.from,
                end_ms: s.offsets.to,
                wpm: per_minute(words, s.offsets.to - s.offsets.from),
                text,
            }
        })
        .collect();

    let text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let word_count = count_words(&text);
    let speaking_ms: i64 = segments.iter().map(|s| (s.end_ms - s.start_ms).max(0)).sum();
    let last_end = segments.last().map(|s| s.end_ms).unwrap_or(0);
    let duration_ms = duration_ms.unwrap_or(last_end).max(last_end);

    let wpm = per_minute(word_count, speaking_ms);
    let pace = if word_count == 0 {
        "no_speech"
    } else if wpm < SLOW_BELOW_WPM {
        "slow"
    } else if wpm > FAST_ABOVE_WPM {
        "fast"
    } else {
        "normal"
    };

    // Language detection on silence or music is a guess, so don't report it.
    let language = if segments.is_empty() {
        None
    } else {
        whisper.result.and_then(|r| r.language)
    };
    let notice = segments.is_empty().then(|| {
        "No speech was found. The video may contain only music or background sound. \
         If people do speak, try choosing the spoken language instead of Auto-detect."
            .to_string()
    });

    AnalysisResult {
        mode: "speech".into(),
        language,
        notice,
        text,
        stats: Stats {
            duration_sec: round1(duration_ms as f64 / 1000.0),
            speaking_sec: round1(speaking_ms as f64 / 1000.0),
            word_count,
            wpm,
            wpm_overall: per_minute(word_count, duration_ms),
            pace: pace.to_string(),
        },
        segments,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_speaking_speed_and_drops_non_speech() {
        let json = r#"{
            "result": {"language": "en"},
            "transcription": [
                {"offsets": {"from": 0, "to": 6000}, "text": " one two three four five six seven eight nine ten eleven twelve thirteen fourteen"},
                {"offsets": {"from": 6000, "to": 9000}, "text": " [BLANK_AUDIO]"},
                {"offsets": {"from": 9000, "to": 12000}, "text": " fifteen sixteen"}
            ]
        }"#;
        let w: WhisperJson = serde_json::from_str(json).unwrap();
        let r = build(w, Some(60_000));

        assert_eq!(r.language.as_deref(), Some("en"));
        assert_eq!(r.segments.len(), 2);
        assert_eq!(r.stats.word_count, 16);
        assert_eq!(r.stats.speaking_sec, 9.0);
        // 16 words in 9 seconds of speech ≈ 106.7 wpm
        assert_eq!(r.stats.wpm, 106.7);
        assert_eq!(r.stats.wpm_overall, 16.0);
        assert_eq!(r.stats.pace, "slow");
        assert_eq!(r.segments[0].wpm, 140.0);
    }

    #[test]
    fn handles_silent_video() {
        let w: WhisperJson = serde_json::from_str(r#"{"transcription": []}"#).unwrap();
        let r = build(w, Some(5_000));
        assert_eq!(r.stats.pace, "no_speech");
        assert_eq!(r.stats.duration_sec, 5.0);
        assert_eq!(r.text, "");
        assert!(r.notice.is_some());
    }

    #[test]
    fn hides_guessed_language_when_only_non_speech() {
        let json = r#"{
            "result": {"language": "en"},
            "transcription": [{"offsets": {"from": 0, "to": 10000}, "text": " [BLANK_AUDIO]"}]
        }"#;
        let r = build(serde_json::from_str(json).unwrap(), Some(78_000));
        assert_eq!(r.language, None);
        assert_eq!(r.stats.pace, "no_speech");
    }

    #[test]
    fn parses_max_volume() {
        let stderr = "[Parsed_volumedetect_0 @ 0000] mean_volume: -91.0 dB\n\
                      [Parsed_volumedetect_0 @ 0000] max_volume: -91.0 dB\n";
        assert_eq!(parse_max_volume(stderr), Some(-91.0));
        assert_eq!(parse_max_volume("nothing"), None);
    }
}
