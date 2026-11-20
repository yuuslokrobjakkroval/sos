//! "Visual mode" for silent videos (e.g. screen-recorded tutorials without a voice):
//! find the moments where the screen changes, ask a local vision model (Ollama)
//! what step each moment shows, and turn those steps into timed captions.

use std::{path::Path, time::Duration};

use anyhow::{bail, Context};
use base64::Engine;
use serde::Deserialize;
use serde_json::json;

use crate::{
    analysis::count_words,
    config::Config,
    models::{AnalysisResult, Segment, Stats},
};

/// Vision models in order of preference (first one installed in Ollama wins).
const MODEL_PREFERENCE: &[&str] = &[
    "qwen3-vl:8b",
    "qwen3-vl:4b",
    "qwen3-vl",
    "qwen2.5vl:7b",
    "qwen2.5vl:3b",
    "qwen2.5vl",
    "gemma3:4b",
    "gemma3",
    "llava",
];

/// ffmpeg filter that keeps a frame (sampled twice a second) only when the screen changed.
/// `mpdecimate` notices small changes such as text typed into a field, which the
/// `scene` score misses in screen recordings.
pub const CHANGE_FILTER: &str = "fps=2,mpdecimate,showinfo,scale='min(1280,iw)':-2";
/// Changes closer together than this are merged (e.g. typing one word).
const MERGE_WITHIN_MS: i64 = 2_000;
/// ...but one step never grows longer than this (e.g. constant mouse movement).
const MAX_STEP_MS: i64 = 6_000;
/// Upper bound on frames sent to the model, to keep long videos reasonable.
pub const MAX_FRAMES: usize = 60;

#[derive(Debug, Clone)]
pub struct Keyframe {
    pub time_ms: i64,
    pub path: std::path::PathBuf,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("http client")
}

#[derive(Deserialize)]
struct Tags {
    models: Vec<TagModel>,
}
#[derive(Deserialize)]
struct TagModel {
    name: String,
}

/// The vision model to use, if Ollama is running and has one installed.
pub async fn find_model(cfg: &Config) -> Option<String> {
    let tags: Tags = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?
        .get(format!("{}/api/tags", cfg.ollama_url))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let installed: Vec<&str> = tags.models.iter().map(|m| m.name.as_str()).collect();
    if let Some(wanted) = &cfg.vision_model {
        return installed
            .iter()
            .find(|n| *n == wanted || n.trim_end_matches(":latest") == wanted)
            .map(|n| n.to_string());
    }
    MODEL_PREFERENCE.iter().find_map(|pref| {
        installed
            .iter()
            .find(|n| *n == pref || n.trim_end_matches(":latest") == *pref)
            .map(|n| n.to_string())
    })
}

/// Parses `pts_time:12.345` values from ffmpeg `showinfo` output, in order.
pub fn parse_showinfo_times(stderr: &str) -> Vec<i64> {
    stderr
        .lines()
        .filter(|l| l.contains("Parsed_showinfo"))
        .filter_map(|l| l.split("pts_time:").nth(1))
        .filter_map(|v| v.split_whitespace().next())
        .filter_map(|v| v.parse::<f64>().ok())
        .map(|s| (s * 1000.0).round() as i64)
        .collect()
}

/// Groups frames into steps: a burst of changes (typing, scrolling) becomes one step that
/// starts at the first change and is described from the last, most complete, frame.
pub fn select_keyframes(frames: Vec<Keyframe>) -> Vec<Keyframe> {
    let mut steps: Vec<Keyframe> = Vec::new();
    let mut last_change_ms = i64::MIN;
    for f in frames {
        match steps.last_mut() {
            Some(prev)
                if f.time_ms - last_change_ms < MERGE_WITHIN_MS
                    && f.time_ms - prev.time_ms < MAX_STEP_MS =>
            {
                prev.path = f.path; // keep the start time, use the newer image
            }
            _ => steps.push(f.clone()),
        }
        last_change_ms = f.time_ms;
    }
    if steps.len() > MAX_FRAMES {
        let n = steps.len();
        steps = (0..MAX_FRAMES).map(|i| steps[i * n / MAX_FRAMES].clone()).collect();
    }
    steps
}

/// Name used in the prompt for the caption language.
pub fn language_name(code: &str) -> &'static str {
    match code {
        "km" => "Khmer",
        "zh" => "Chinese",
        "th" => "Thai",
        "vi" => "Vietnamese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "fr" => "French",
        "es" => "Spanish",
        "de" => "German",
        "id" => "Indonesian",
        _ => "English",
    }
}

const RULES: &str = "Use the exact names of buttons, fields, menus and pages visible on screen. \
    Never write passwords or other private values typed on screen.";

/// Prompt for the first frame (one image).
fn first_prompt(language: &str) -> String {
    format!(
        "This is the first screen of a silent screen-recording tutorial.\n\
         Write ONE short caption (at most 15 words) telling the viewer what this screen is or \
         what to do first, as an instruction, for example: \"Go to discord.com and click Register.\"\n\
         {RULES}\n\
         Write the caption in {language}. Reply with the caption only."
    )
}

/// Prompt for later frames (two images: before and after).
fn change_prompt(time_ms: i64, language: &str) -> String {
    format!(
        "These two screenshots come from a silent screen-recording tutorial.\n\
         Image 1 is the screen BEFORE. Image 2 is the screen AFTER, {:.0}s into the video.\n\
         Write ONE short caption (at most 15 words) telling the viewer which action takes them \
         from image 1 to image 2, as an instruction, for example: \
         \"Type your email address in the Email field.\", \"Choose your date of birth.\" or \
         \"Click Continue.\" Focus on what is different in image 2.\n\
         {RULES}\n\
         If nothing meaningful changed (for example only the mouse moved), reply with exactly: SAME\n\
         Write the caption in {language}. Reply with the caption only.",
        time_ms as f64 / 1000.0
    )
}

/// Cleans up a model reply into a single caption line (or None for "SAME"/empty).
pub fn clean_caption(reply: &str) -> Option<String> {
    // Reasoning models may wrap their thoughts in <think>...</think>.
    let reply = match reply.rfind("</think>") {
        Some(i) => &reply[i + "</think>".len()..],
        None => reply,
    };
    let line = reply
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())?
        .trim_start_matches(|c: char| c == '-' || c == '*' || c.is_ascii_digit() || c == '.' || c == ' ')
        .trim_start_matches("Caption:")
        .trim()
        .trim_matches(|c| c == '"' || c == '“' || c == '”' || c == '*')
        .trim()
        .to_string();
    let upper = line.to_uppercase();
    if line.is_empty() || upper == "SAME" || upper == "SAME." {
        return None;
    }
    Some(line)
}

/// Asks the vision model about one or more frames.
async fn describe(
    http: &reqwest::Client,
    cfg: &Config,
    model: &str,
    images: &[&Path],
    prompt: &str,
) -> anyhow::Result<String> {
    let mut b64 = Vec::with_capacity(images.len());
    for image in images {
        let bytes = tokio::fs::read(image).await?;
        b64.push(base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    let res = http
        .post(format!("{}/api/chat", cfg.ollama_url))
        .json(&json!({
            "model": model,
            "stream": false,
            "think": false,
            "keep_alive": "5m",
            // Some models (e.g. qwen3-vl) think before answering even with think=false,
            // so leave room for the thinking plus the short caption.
            "options": { "temperature": 0.1, "num_predict": 3000 },
            "messages": [{ "role": "user", "content": prompt, "images": b64 }],
        }))
        .send()
        .await
        .context("could not reach Ollama")?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.context("bad reply from Ollama")?;
    if !status.is_success() {
        bail!(
            "Ollama error: {}",
            body.get("error").and_then(|e| e.as_str()).unwrap_or("unknown")
        );
    }
    let content = body["message"]["content"].as_str().unwrap_or_default().trim();
    if !content.is_empty() {
        return Ok(content.to_string());
    }
    // Ran out of tokens while thinking: use the last quoted candidate from the thoughts.
    let thinking = body["message"]["thinking"].as_str().unwrap_or_default();
    Ok(last_quoted(thinking).unwrap_or_default())
}

/// True when a "caption" is really a piece of our own prompt repeated back.
fn echoes_instructions(caption: &str) -> bool {
    let c = caption.to_lowercase();
    let c = c.trim_end_matches(['.', ' ']);
    // Only the instruction sentences — the example captions in the prompts are valid answers.
    const INSTRUCTIONS: &[&str] = &[
        RULES,
        "reply with the caption only",
        "write one short caption (at most 15 words)",
        "silent screen-recording tutorial",
        "if nothing meaningful changed",
    ];
    c.len() >= 12 && INSTRUCTIONS.iter().any(|p| p.to_lowercase().contains(c))
}

/// True when `next` says nothing new compared to `previous`
/// (e.g. "Click Register." after "Click Register to begin.").
fn repeats(previous: &str, next: &str) -> bool {
    let norm = |s: &str| -> String {
        s.to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace())
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let (p, n) = (norm(previous), norm(next));
    !n.is_empty() && (p == n || p.starts_with(&format!("{n} ")) || n.starts_with(&format!("{p} ")))
}

/// The last "double-quoted" phrase in a text, e.g. a caption a model considered while thinking.
fn last_quoted(text: &str) -> Option<String> {
    let parts: Vec<&str> = text.split('"').collect();
    (1..parts.len())
        .step_by(2)
        .rev()
        .map(|i| parts[i].trim())
        // A full instruction, not a fragment like "Email field" (scripts such as Khmer
        // don't separate words with spaces, so any non-ASCII candidate is accepted).
        .find(|p| {
            (3..=160).contains(&p.len())
                && (p.split_whitespace().count() >= 3 || !p.is_ascii())
        })
        .map(str::to_string)
}

/// Describes each keyframe and builds the caption result.
/// `on_progress` is called with 0..1 after each frame.
pub async fn describe_steps<F, Fut>(
    cfg: &Config,
    model: &str,
    frames: &[Keyframe],
    duration_ms: Option<i64>,
    language_code: &str,
    mut on_progress: F,
) -> anyhow::Result<AnalysisResult>
where
    F: FnMut(f64) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let http = client();
    let language = language_name(language_code);
    let mut steps: Vec<(i64, String)> = Vec::new();

    for (i, frame) in frames.iter().enumerate() {
        let previous = steps.last().map(|(_, t)| t.as_str());
        let (images, prompt) = match i.checked_sub(1).map(|p| &frames[p]) {
            None => (vec![frame.path.as_path()], first_prompt(language)),
            Some(before) => (
                vec![before.path.as_path(), frame.path.as_path()],
                change_prompt(frame.time_ms, language),
            ),
        };
        let reply = describe(&http, cfg, model, &images, &prompt)
            .await
            .with_context(|| format!("describing the screen at {}s", frame.time_ms / 1000))?;
        tracing::debug!(t = frame.time_ms, reply = %reply.trim(), "vision reply");
        if let Some(caption) = clean_caption(&reply).filter(|c| !echoes_instructions(c)) {
            let duplicate = previous.is_some_and(|p| repeats(p, &caption));
            if !duplicate {
                steps.push((frame.time_ms, caption));
            }
        }
        on_progress((i + 1) as f64 / frames.len() as f64).await;
    }

    Ok(build_result(steps, duration_ms, language_code, model))
}

/// Turns (start time, caption) steps into a result; each step lasts until the next one.
pub fn build_result(
    steps: Vec<(i64, String)>,
    duration_ms: Option<i64>,
    language_code: &str,
    model: &str,
) -> AnalysisResult {
    let last_start = steps.last().map(|(t, _)| *t).unwrap_or(0);
    let end_ms = duration_ms.unwrap_or(last_start + 5_000).max(last_start + 1_000);

    let segments: Vec<Segment> = steps
        .iter()
        .enumerate()
        .map(|(i, (start, text))| Segment {
            start_ms: *start,
            end_ms: steps.get(i + 1).map(|(t, _)| *t).unwrap_or(end_ms),
            text: text.clone(),
            wpm: 0.0,
        })
        .collect();

    let text = segments
        .iter()
        .enumerate()
        .map(|(i, s)| format!("{}. {}", i + 1, s.text))
        .collect::<Vec<_>>()
        .join("\n");

    AnalysisResult {
        mode: "visual".into(),
        language: Some(if language_code == "auto" { "en".into() } else { language_code.into() }),
        stats: Stats {
            duration_sec: (end_ms as f64 / 100.0).round() / 10.0,
            speaking_sec: 0.0,
            word_count: count_words(&text),
            wpm: 0.0,
            wpm_overall: 0.0,
            pace: "no_audio".into(),
        },
        notice: Some(format!(
            "This video has no voice, so these {} step captions were written by AI ({model}) \
             from what appears on screen. Check them before publishing.",
            segments.len()
        )),
        text,
        segments,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kf(t: i64, name: &str) -> Keyframe {
        Keyframe { time_ms: t, path: name.into() }
    }

    #[test]
    fn parses_showinfo() {
        let s = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:      0 pts_time:0       duration:512\n\
                 [Parsed_showinfo_1 @ 0x1] n:   1 pts:  64000 pts_time:4.16667 duration:512\n\
                 [other] pts_time:9";
        assert_eq!(parse_showinfo_times(s), vec![0, 4167]);
    }

    #[test]
    fn merges_bursts_of_changes_into_one_step() {
        let frames = vec![
            kf(0, "a"),
            kf(5_000, "b1"),
            kf(5_800, "b2"),
            kf(6_900, "b3"), // typing: 3 changes within 2s of each other
            kf(12_000, "c"),
        ];
        let steps = select_keyframes(frames);
        let got: Vec<(i64, String)> = steps
            .iter()
            .map(|k| (k.time_ms, k.path.to_string_lossy().to_string()))
            .collect();
        assert_eq!(
            got,
            vec![(0, "a".into()), (5_000, "b3".into()), (12_000, "c".into())]
        );
    }

    #[test]
    fn splits_long_bursts() {
        // Mouse moving constantly for 13 seconds: changes every 0.5s.
        let frames = (0..=26).map(|i| kf(i * 500, "m")).collect();
        let starts: Vec<i64> = select_keyframes(frames).iter().map(|k| k.time_ms).collect();
        assert_eq!(starts, vec![0, 6_000, 12_000]);
    }

    #[test]
    fn caps_frame_count() {
        let frames = (0..200).map(|i| kf(i * 10_000, "x")).collect();
        assert_eq!(select_keyframes(frames).len(), MAX_FRAMES);
    }

    #[test]
    fn cleans_model_replies() {
        assert_eq!(clean_caption("\"Click **Continue**.\"\n").as_deref(), Some("Click **Continue**."));
        assert_eq!(clean_caption("<think>hmm</think>\n1. Open discord.com").as_deref(), Some("Open discord.com"));
        assert_eq!(clean_caption("Caption: Enter your email").as_deref(), Some("Enter your email"));
        assert_eq!(clean_caption("SAME"), None);
        assert_eq!(clean_caption("  \n"), None);
    }

    #[test]
    fn rejects_echoed_instructions() {
        assert!(echoes_instructions("Never write passwords or other private"));
        assert!(echoes_instructions("Reply with the caption only."));
        assert!(!echoes_instructions("Click Continue."), "real steps must be kept");
        assert!(!echoes_instructions("Enter a password in the Password field."));
        assert!(!echoes_instructions("ចុចលើ Register"));
    }

    #[test]
    fn detects_repeated_captions() {
        assert!(repeats("Click Register to begin using the chat app.", "Click Register."));
        assert!(repeats("Click Continue", "click continue."));
        assert!(!repeats("Click Register.", "Click Continue."));
        assert!(repeats("Type your email.", "Type your email address in the Email field."));
        assert!(!repeats("Type your email.", "Type your username."));
    }

    #[test]
    fn finds_last_quoted_candidate() {
        let t = r#"Maybe "Typed password". Better: "Enter a password in the Password field." Done"#;
        assert_eq!(last_quoted(t).as_deref(), Some("Enter a password in the Password field."));
        assert_eq!(last_quoted("no quotes"), None);
        assert_eq!(last_quoted(r#"the "Email field" changed"#), None);
        assert_eq!(last_quoted(r#"maybe "ចុចលើ Register""#).as_deref(), Some("ចុចលើ Register"));
    }

    #[test]
    fn builds_timed_steps() {
        let r = build_result(
            vec![(0, "Open the site".into()), (4_000, "Click Register".into())],
            Some(10_000),
            "auto",
            "qwen3-vl:4b",
        );
        assert_eq!(r.mode, "visual");
        assert_eq!(r.segments[0].end_ms, 4_000);
        assert_eq!(r.segments[1].end_ms, 10_000);
        assert_eq!(r.text, "1. Open the site\n2. Click Register");
        assert_eq!(r.language.as_deref(), Some("en"));
    }
}
