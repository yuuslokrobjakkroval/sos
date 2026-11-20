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
    /// Present when whisper-cli was built with segment no-speech scores.
    /// Missing on the stock `-oj` / `-ojf` JSON, so it stays optional.
    #[serde(default)]
    pub no_speech_prob: Option<f64>,
    /// Per-token probabilities from `-ojf`. Empty for plain `-oj` output.
    #[serde(default)]
    pub tokens: Vec<WhisperToken>,
}

#[derive(Debug, Deserialize)]
pub struct WhisperToken {
    #[serde(default)]
    pub text: String,
    /// Token probability, when whisper-cli included it.
    #[serde(default)]
    pub p: Option<f64>,
}

/// A stretch of audio ffmpeg `silencedetect` called silent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SilenceSpan {
    pub start_ms: i64,
    pub end_ms: i64,
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
        || count_words(t) == 0
        || (t.starts_with('[') && t.ends_with(']'))
        || (t.starts_with('(') && t.ends_with(')'))
}

/// Phrases Whisper commonly invents in silence (YouTube outros, credits, filler).
/// Matched only when the whole caption is the phrase, and only if that caption
/// sits in detected silence — the same words spoken aloud are kept.
const KNOWN_HALLUCINATIONS: &[&str] = &[
    "thanks for watching",
    "thank you for watching",
    "thanks for watching this video",
    "thank you for watching this video",
    "thanks for listening",
    "thank you for listening",
    "please subscribe",
    "please like and subscribe",
    "like and subscribe",
    "dont forget to subscribe",
    "subtitles by the amara.org community",
    "subtitles by",
    "transcribed by",
    "captions by",
    "translated by",
    "all rights reserved",
    "see you next time",
    "see you in the next video",
    "see you in the next one",
    "the end",
    "end of recording",
    "silence",
    "blank audio",
    "thanks for watching and please subscribe",
];

/// A caption this far inside a silence span (and with almost no audible leftover)
/// is treated as silence rather than speech that merely touches the boundary.
const SILENCE_COVERAGE: f64 = 0.8;
const MAX_AUDIBLE_EDGE_MS: i64 = 400;
/// `no_speech_prob` at or above Whisper's own default threshold.
const NO_SPEECH_PROB: f64 = 0.6;
/// Mean token probability below this, inside silence, is not trusted as speech.
const LOW_TOKEN_PROB: f64 = 0.35;

pub fn build(
    whisper: WhisperJson,
    duration_ms: Option<i64>,
    silences: &[SilenceSpan],
) -> AnalysisResult {
    let last_end = whisper
        .transcription
        .iter()
        .map(|s| s.offsets.to)
        .chain(silences.iter().map(|s| s.end_ms))
        .max()
        .unwrap_or(0);
    let duration_ms = duration_ms.unwrap_or(last_end).max(last_end);
    let usable = silence_filter_usable(silences, duration_ms);
    let (leading, trailing) = edge_silences(silences, duration_ms);

    let mut dropped = 0usize;
    let mut segments = Vec::new();
    for segment in &whisper.transcription {
        if should_drop_segment(segment, usable, leading, trailing, silences) {
            dropped += 1;
            continue;
        }
        let text = segment.text.trim().to_string();
        let words = count_words(&text);
        segments.push(Segment {
            start_ms: segment.offsets.from,
            end_ms: segment.offsets.to,
            wpm: per_minute(words, segment.offsets.to - segment.offsets.from),
            text,
        });
    }
    if dropped > 0 {
        tracing::info!(
            dropped,
            kept = segments.len(),
            "dropped captions from silence"
        );
    }

    let text = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let word_count = count_words(&text);
    let speaking_ms: i64 = segments
        .iter()
        .map(|s| (s.end_ms - s.start_ms).max(0))
        .sum();

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

/// Reads `silence_start` / `silence_end` lines from ffmpeg's `silencedetect` filter.
/// A start with no matching end runs to `duration_ms` (silence through the end of the file).
pub fn parse_silencedetect(stderr: &str, duration_ms: i64) -> Vec<SilenceSpan> {
    let mut spans = Vec::new();
    let mut open: Option<i64> = None;
    for line in stderr.lines() {
        if let Some(start) = silence_time(line, "silence_start:") {
            open = Some(start);
        } else if let Some(end) = silence_time(line, "silence_end:") {
            push_span(&mut spans, open.take().unwrap_or(0), end);
        }
    }
    if let Some(start) = open {
        push_span(&mut spans, start, duration_ms.max(start));
    }
    spans
}

fn silence_time(line: &str, key: &str) -> Option<i64> {
    let rest = line.split(key).nth(1)?.trim();
    let token = rest.split(['|', ' ', '\t']).next()?;
    let secs: f64 = token.parse().ok()?;
    Some((secs * 1000.0).round() as i64)
}

fn push_span(spans: &mut Vec<SilenceSpan>, start_ms: i64, end_ms: i64) {
    if end_ms > start_ms {
        spans.push(SilenceSpan { start_ms, end_ms });
    }
}

/// Silence that covers almost the whole file is a bad threshold, not a cue to
/// delete the transcript.
fn silence_filter_usable(spans: &[SilenceSpan], duration_ms: i64) -> bool {
    if spans.is_empty() {
        return false;
    }
    if duration_ms <= 0 {
        return true;
    }
    let covered: i64 = spans
        .iter()
        .map(|span| (span.end_ms - span.start_ms).max(0))
        .sum();
    covered * 10 < duration_ms * 9
}

fn edge_silences(
    spans: &[SilenceSpan],
    duration_ms: i64,
) -> (Option<SilenceSpan>, Option<SilenceSpan>) {
    // A short noise burst at the very end should not hide the quiet after speech.
    const LEAD_MS: i64 = 500;
    const TAIL_MS: i64 = 2_000;
    let leading = spans.iter().copied().find(|span| span.start_ms <= LEAD_MS);
    let trailing = spans
        .iter()
        .copied()
        .rev()
        .find(|span| duration_ms <= 0 || span.end_ms >= duration_ms.saturating_sub(TAIL_MS));
    (leading, trailing)
}

fn should_drop_segment(
    segment: &WhisperSegment,
    usable: bool,
    leading: Option<SilenceSpan>,
    trailing: Option<SilenceSpan>,
    silences: &[SilenceSpan],
) -> bool {
    if is_non_speech(&segment.text) {
        return true;
    }
    if !usable {
        return false;
    }
    let start = segment.offsets.from;
    let end = segment.offsets.to;
    // Anything sitting in the quiet before speech starts, or after it ends, is
    // the usual place Whisper invents a caption. A line that only clips that
    // boundary (real speech running into the quiet) stays.
    if leading.is_some_and(|span| mostly_inside(start, end, span))
        || trailing.is_some_and(|span| mostly_inside(start, end, span))
    {
        return true;
    }
    let in_silence = silences
        .iter()
        .copied()
        .any(|span| mostly_inside(start, end, span));
    if !in_silence {
        return false;
    }
    is_known_hallucination(&segment.text)
        || segment.no_speech_prob.is_some_and(|p| p >= NO_SPEECH_PROB)
        || mean_token_p(&segment.tokens).is_some_and(|p| p < LOW_TOKEN_PROB)
}

fn mostly_inside(start: i64, end: i64, span: SilenceSpan) -> bool {
    let len = (end - start).max(1);
    let overlap = overlap_ms(start, end, span.start_ms, span.end_ms);
    let audible = len - overlap;
    overlap as f64 >= len as f64 * SILENCE_COVERAGE && audible < MAX_AUDIBLE_EDGE_MS
}

fn overlap_ms(start: i64, end: i64, span_start: i64, span_end: i64) -> i64 {
    (end.min(span_end) - start.max(span_start)).max(0)
}

fn mean_token_p(tokens: &[WhisperToken]) -> Option<f64> {
    let mut sum = 0.0;
    let mut count = 0usize;
    for token in tokens {
        let text = token.text.trim();
        if text.is_empty() || text.starts_with('[') || text.starts_with('<') {
            continue;
        }
        if let Some(p) = token.p {
            sum += p;
            count += 1;
        }
    }
    (count > 0).then_some(sum / count as f64)
}

fn is_known_hallucination(text: &str) -> bool {
    let norm = normalize_phrase(text);
    if norm.is_empty() {
        return false;
    }
    KNOWN_HALLUCINATIONS.iter().any(|phrase| norm == *phrase) || is_looped_hallucination(&norm)
}

fn normalize_phrase(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '.' {
            for lower in ch.to_lowercase() {
                out.push(lower);
            }
        } else if ch.is_whitespace() && !out.ends_with(' ') && !out.is_empty() {
            out.push(' ');
        }
    }
    out.trim().trim_matches('.').trim().to_string()
}

/// "you you you", or the same short outro repeated, which Whisper loops in silence.
fn is_looped_hallucination(norm: &str) -> bool {
    let words: Vec<&str> = norm.split_whitespace().collect();
    if words.len() < 3 {
        return false;
    }
    for period in 1..=2 {
        if words.len().is_multiple_of(period)
            && words.len() >= period * 3
            && words.chunks(period).all(|chunk| chunk == &words[..period])
        {
            return true;
        }
    }
    false
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
        let r = build(w, Some(60_000), &[]);

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
        let r = build(w, Some(5_000), &[]);
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
        let r = build(serde_json::from_str(json).unwrap(), Some(78_000), &[]);
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

    fn whisper(json: &str) -> WhisperJson {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn parses_silencedetect_including_silence_that_runs_to_the_end() {
        let stderr = "\
[silencedetect @ 0x1] silence_start: 0\n\
[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5\n\
[silencedetect @ 0x1] silence_start: 96.5\n";
        let spans = parse_silencedetect(stderr, 100_000);
        assert_eq!(
            spans,
            vec![
                SilenceSpan {
                    start_ms: 0,
                    end_ms: 1_500
                },
                SilenceSpan {
                    start_ms: 96_500,
                    end_ms: 100_000
                },
            ]
        );
    }

    #[test]
    fn drops_trailing_hallucination_and_recomputes_speed() {
        // A 100s reading, like the LibriVox Gettysburg test: real speech, then
        // a caption Whisper invented in the quiet after the voice stopped.
        let json = r#"{
            "result": {"language": "en"},
            "transcription": [
                {"offsets": {"from": 0, "to": 10000}, "text": " one two three four five six"},
                {"offsets": {"from": 96000, "to": 98000}, "text": " End of the case, progress, rest."}
            ]
        }"#;
        let silences = [SilenceSpan {
            start_ms: 94_000,
            end_ms: 100_000,
        }];
        let r = build(whisper(json), Some(100_000), &silences);

        assert_eq!(r.segments.len(), 1);
        assert_eq!(r.segments[0].text, "one two three four five six");
        assert!(!r.text.contains("progress"));
        // 6 words in 10 seconds of speech, not 12 words in 12 seconds.
        assert_eq!(r.stats.word_count, 6);
        assert_eq!(r.stats.speaking_sec, 10.0);
        assert_eq!(r.stats.wpm, 36.0);
        assert_eq!(r.stats.wpm_overall, 3.6);
        assert_eq!(r.stats.pace, "slow");
        assert_eq!(r.language.as_deref(), Some("en"));
    }

    #[test]
    fn drops_a_caption_in_leading_silence_and_keeps_speech_that_follows() {
        let json = r#"{
            "transcription": [
                {"offsets": {"from": 0, "to": 1500}, "text": " Thanks for watching!"},
                {"offsets": {"from": 3000, "to": 8000}, "text": " hello there"}
            ]
        }"#;
        let silences = [SilenceSpan {
            start_ms: 0,
            end_ms: 2_000,
        }];
        let r = build(whisper(json), Some(20_000), &silences);
        assert_eq!(r.segments.len(), 1);
        assert_eq!(r.segments[0].text, "hello there");
        assert_eq!(r.stats.word_count, 2);
    }

    #[test]
    fn keeps_real_speech_that_only_touches_the_trailing_quiet() {
        let json = r#"{
            "transcription": [
                {"offsets": {"from": 90000, "to": 96000}, "text": " shall not perish from the earth"}
            ]
        }"#;
        // Silence starts in the last half-second of a 6-second sentence.
        let silences = [SilenceSpan {
            start_ms: 95_500,
            end_ms: 100_000,
        }];
        let r = build(whisper(json), Some(100_000), &silences);
        assert_eq!(r.segments.len(), 1);
        assert_eq!(r.stats.word_count, 6);
    }

    #[test]
    fn drops_known_phrases_only_when_they_fall_in_silence() {
        let json = r#"{
            "transcription": [
                {"offsets": {"from": 10000, "to": 14000}, "text": " Thanks for watching!"},
                {"offsets": {"from": 20500, "to": 23000}, "text": " Thanks for watching!"},
                {"offsets": {"from": 30000, "to": 36000}, "text": " you you you you"},
                {"offsets": {"from": 40000, "to": 48000}, "text": " thanks for watching the parade go by"}
            ]
        }"#;
        // An internal pause, not the start or the end of the file.
        let silences = [SilenceSpan {
            start_ms: 20_000,
            end_ms: 37_000,
        }];
        let r = build(whisper(json), Some(100_000), &silences);
        let texts: Vec<_> = r.segments.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "Thanks for watching!",
                "thanks for watching the parade go by",
            ]
        );
        assert_eq!(r.stats.word_count, count_words(&r.text));
    }

    #[test]
    fn drops_low_confidence_segments_in_silence_and_keeps_them_in_speech() {
        let json = r#"{
            "transcription": [
                {
                    "offsets": {"from": 41000, "to": 43000},
                    "text": " mumbled aside",
                    "no_speech_prob": 0.91,
                    "tokens": [{"text": " mumbled", "p": 0.99}]
                },
                {
                    "offsets": {"from": 43000, "to": 44800},
                    "text": " another aside",
                    "tokens": [{"text": " another", "p": 0.1}, {"text": " aside", "p": 0.1}]
                },
                {
                    "offsets": {"from": 50000, "to": 55000},
                    "text": " a quiet but real line",
                    "no_speech_prob": 0.91,
                    "tokens": [{"text": " a", "p": 0.1}, {"text": " quiet", "p": 0.1}]
                }
            ]
        }"#;
        let silences = [SilenceSpan {
            start_ms: 40_000,
            end_ms: 45_000,
        }];
        let r = build(whisper(json), Some(100_000), &silences);
        assert_eq!(r.segments.len(), 1);
        assert_eq!(r.segments[0].text, "a quiet but real line");
        assert_eq!(r.stats.word_count, 5);
    }

    #[test]
    fn ignores_silence_that_covers_the_whole_file() {
        let json = r#"{
            "transcription": [
                {"offsets": {"from": 1000, "to": 5000}, "text": " real words stay"}
            ]
        }"#;
        let silences = [SilenceSpan {
            start_ms: 0,
            end_ms: 100_000,
        }];
        let r = build(whisper(json), Some(100_000), &silences);
        assert_eq!(r.segments.len(), 1);
        assert_eq!(r.stats.word_count, 3);
    }
}
