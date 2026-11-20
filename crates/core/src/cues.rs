//! Split transcript segments into short, readable caption cues for export.
//!
//! Playback captions can be a whole sentence. Burned-in and soft subtitles are
//! easier to read as at most two lines of about 42 characters (about 30–35 for
//! Khmer), on screen for roughly one to seven seconds. Timing is taken from
//! whisper word tokens when the JSON has them, and otherwise shared across the
//! words by their length. Khmer is split on clusters so a coeng and its
//! subscript stay on the same line.

use crate::{
    analysis::{self, WhisperJson},
    models::Segment,
};

/// One word (or one piece of an unspaced caption) with its own time span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TimedWord {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    /// When joining with the previous word, put a space in front of this one.
    pub gap_before: bool,
}

const MAX_LINE_CHARS: usize = 42;
/// Khmer OS faces are wide, so a full line stays inside about 30–35 characters.
const KHMER_LINE_CHARS: usize = 34;
const MAX_LINES: usize = 2;
const MIN_CUE_MS: i64 = 1_000;
const MAX_CUE_MS: i64 = 7_000;
/// U+17D2, the sign that pulls the next consonant down into a subscript.
const KHMER_COENG: char = '\u{17D2}';

/// How long a caption line may be. Latin and Khmer use different limits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CueLayout {
    pub max_line_chars: usize,
}

impl CueLayout {
    pub(crate) fn latin() -> Self {
        Self {
            max_line_chars: MAX_LINE_CHARS,
        }
    }

    pub(crate) fn khmer() -> Self {
        Self {
            max_line_chars: KHMER_LINE_CHARS,
        }
    }
}

/// Words reconstructed from whisper.cpp's full JSON (`-ojf`), in time order.
///
/// Subword tokens are merged: a token that does not start with whitespace
/// continues the current word. Special tokens such as `[_BEG_]` are dropped.
/// The result is empty when the file has no per-token offsets, so the caller
/// can fall back to distributing the segment's time.
pub(crate) fn words_from_whisper(whisper: &WhisperJson) -> Vec<TimedWord> {
    let mut words: Vec<TimedWord> = Vec::new();
    for segment in &whisper.transcription {
        for token in &segment.tokens {
            let Some(offsets) = &token.offsets else {
                continue;
            };
            let raw = token.text.as_str();
            if !is_spoken_token(raw) {
                continue;
            }
            let leading_space = raw.chars().next().is_some_and(char::is_whitespace);
            let text = raw.trim();
            if text.is_empty() {
                continue;
            }
            let start_ms = offsets.from.max(0);
            let end_ms = offsets.to.max(start_ms);
            if leading_space || words.is_empty() {
                words.push(TimedWord {
                    text: text.to_string(),
                    start_ms,
                    end_ms,
                    gap_before: leading_space,
                });
            } else if let Some(word) = words.last_mut() {
                word.text.push_str(text);
                word.end_ms = end_ms.max(word.end_ms);
            }
        }
    }
    words.sort_by_key(|word| (word.start_ms, word.end_ms));
    words
}

fn is_spoken_token(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty() && !trimmed.starts_with('[') && !trimmed.starts_with('<')
}

/// Cues ready to write as SRT, using the Latin line length. `words` may be empty.
pub(crate) fn readable_cues(segments: &[Segment], words: &[TimedWord]) -> Vec<Segment> {
    readable_cues_with(segments, words, CueLayout::latin())
}

/// Cues ready to write as SRT. `words` may be empty.
pub(crate) fn readable_cues_with(
    segments: &[Segment],
    words: &[TimedWord],
    layout: CueLayout,
) -> Vec<Segment> {
    let mut used = vec![false; words.len()];
    let mut cues = Vec::new();
    for segment in segments {
        let text = segment.text.trim();
        if text.is_empty() {
            continue;
        }
        let mut pieces = words_inside(segment, words, &mut used);
        if pieces.is_empty() {
            let end_ms = segment.end_ms.max(segment.start_ms);
            pieces = synthesize(text, segment.start_ms.max(0), end_ms, layout);
        }
        if pieces.is_empty() {
            continue;
        }
        for group in pack(pieces, layout) {
            if let Some(cue) = cue_from(&group, layout.max_line_chars) {
                cues.push(cue);
            }
        }
    }
    normalize(&mut cues);
    cues
}

fn words_inside(segment: &Segment, words: &[TimedWord], used: &mut [bool]) -> Vec<TimedWord> {
    let start = segment.start_ms;
    let end = segment.end_ms.max(start + 1);
    let mut matched = Vec::new();
    for (index, word) in words.iter().enumerate() {
        if used[index] {
            continue;
        }
        let mid = word.start_ms + (word.end_ms - word.start_ms) / 2;
        if mid >= start && mid < end {
            used[index] = true;
            matched.push(word.clone());
        }
    }
    matched
}

/// Share `start_ms..end_ms` across words in proportion to how long they are.
/// A caption with no spaces (Khmer, Thai, Chinese) is cut into character
/// groups that each fit on one line and last about seven seconds at most.
fn synthesize(text: &str, start_ms: i64, end_ms: i64, layout: CueLayout) -> Vec<TimedWord> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.is_empty() {
        return Vec::new();
    }
    let end_ms = end_ms.max(start_ms);
    if parts.len() == 1 {
        let only = parts[0];
        let chars = only.chars().count();
        let span = (end_ms - start_ms).max(1);
        let limit = chunk_limit(chars, span, layout.max_line_chars);
        if chars > limit {
            return char_chunks(only, start_ms, end_ms, limit, false);
        }
    }
    let weights: Vec<usize> = parts
        .iter()
        .map(|part| part.chars().count().max(1))
        .collect();
    let total = weights.iter().sum::<usize>().max(1);
    let span = (end_ms - start_ms).max(0);
    let mut consumed = 0usize;
    let mut words = Vec::new();
    for (index, (part, weight)) in parts.iter().zip(weights).enumerate() {
        let word_start = start_ms + scale(span, consumed, total);
        consumed += weight;
        let word_end = if index + 1 == parts.len() {
            end_ms.max(word_start)
        } else {
            (start_ms + scale(span, consumed, total)).max(word_start)
        };
        let word = TimedWord {
            text: (*part).to_string(),
            start_ms: word_start,
            end_ms: word_end,
            gap_before: index > 0,
        };
        words.extend(split_overlong(word, layout));
    }
    words
}

fn split_overlong(word: TimedWord, layout: CueLayout) -> Vec<TimedWord> {
    let count = word.text.chars().count();
    if count <= layout.max_line_chars {
        return vec![word];
    }
    let span = (word.end_ms - word.start_ms).max(1);
    let limit = chunk_limit(count, span, layout.max_line_chars);
    char_chunks(
        &word.text,
        word.start_ms,
        word.end_ms,
        limit,
        word.gap_before,
    )
}

/// Largest character group that fits on a line and, when the whole caption is
/// long, does not itself run past the maximum cue length.
fn chunk_limit(chars: usize, span_ms: i64, max_line_chars: usize) -> usize {
    if chars == 0 {
        return 1;
    }
    let cap = max_line_chars.max(1);
    if span_ms > MAX_CUE_MS {
        let by_time = (chars as i128) * (MAX_CUE_MS as i128) / (span_ms as i128);
        (by_time as usize).clamp(1, cap)
    } else {
        cap
    }
}

fn char_chunks(
    text: &str,
    start_ms: i64,
    end_ms: i64,
    limit: usize,
    first_gap: bool,
) -> Vec<TimedWord> {
    let groups = group_atoms(text, limit.max(1));
    if groups.is_empty() {
        return Vec::new();
    }
    let total = groups
        .iter()
        .map(|group| group.chars().count())
        .sum::<usize>()
        .max(1);
    let span = (end_ms - start_ms).max(0);
    let mut consumed = 0usize;
    let last = groups.len().saturating_sub(1);
    groups
        .into_iter()
        .enumerate()
        .map(|(index, piece)| {
            let weight = piece.chars().count().max(1);
            let word_start = start_ms + scale(span, consumed, total);
            consumed += weight;
            let word_end = if index == last {
                end_ms.max(word_start)
            } else {
                (start_ms + scale(span, consumed, total)).max(word_start)
            };
            TimedWord {
                text: piece,
                start_ms: word_start,
                end_ms: word_end,
                gap_before: first_gap && index == 0,
            }
        })
        .collect()
}

/// Pieces of `text` no longer than `limit` characters, without cutting a Khmer
/// coeng cluster. A cluster that is itself longer than `limit` stays whole.
fn group_atoms(text: &str, limit: usize) -> Vec<String> {
    let mut groups = Vec::new();
    let mut current = String::new();
    for atom in text_atoms(text) {
        let count = atom.chars().count();
        if !current.is_empty() && current.chars().count() + count > limit {
            groups.push(std::mem::take(&mut current));
        }
        current.push_str(&atom);
    }
    if !current.is_empty() {
        groups.push(current);
    }
    groups
}

/// Unbreakable pieces. Latin letters are one character each. A Khmer base keeps
/// its coeng subscripts and vowel signs.
fn text_atoms(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut atoms = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let start = index;
        index += 1;
        while index < chars.len() && cluster_continues(chars[index]) {
            if chars[index] == KHMER_COENG {
                index += 1;
                if index < chars.len() {
                    index += 1;
                }
            } else {
                index += 1;
            }
        }
        atoms.push(chars[start..index].iter().collect());
    }
    atoms
}

fn cluster_continues(c: char) -> bool {
    c == KHMER_COENG || is_khmer_mark(c) || c == '\u{200C}' || c == '\u{200D}'
}

/// Dependent vowels and signs. Coeng is handled on its own so the subscript
/// consonant after it stays in the same cluster.
fn is_khmer_mark(c: char) -> bool {
    matches!(c, '\u{17B6}'..='\u{17D1}' | '\u{17D3}' | '\u{17DD}')
}

fn scale(span: i64, consumed: usize, total: usize) -> i64 {
    if total == 0 {
        return 0;
    }
    ((span as i128) * (consumed as i128) / (total as i128)) as i64
}

fn pack(words: Vec<TimedWord>, layout: CueLayout) -> Vec<Vec<TimedWord>> {
    let mut cues: Vec<Vec<TimedWord>> = Vec::new();
    let mut index = 0;
    while index < words.len() {
        let mut end = index + 1;
        while end < words.len() {
            let candidate = &words[index..=end];
            if !fits(candidate, layout.max_line_chars) || span(candidate) > MAX_CUE_MS {
                break;
            }
            end += 1;
        }
        cues.push(words[index..end].to_vec());
        index = end;
    }
    balance_short_cues(&mut cues, layout.max_line_chars);
    cues
}

/// Move a word from a full cue onto a following cue that is shorter than a
/// second, when the result still fits on two lines and under seven seconds.
fn balance_short_cues(cues: &mut [Vec<TimedWord>], max_line_chars: usize) {
    let mut index = 1;
    while index < cues.len() {
        if span(&cues[index]) >= MIN_CUE_MS || cues[index - 1].len() < 2 {
            index += 1;
            continue;
        }
        let word = cues[index - 1].last().unwrap().clone();
        let mut trial = vec![word];
        trial.extend(cues[index].iter().cloned());
        let previous: Vec<TimedWord> = cues[index - 1][..cues[index - 1].len() - 1].to_vec();
        if fits(&trial, max_line_chars)
            && span(&trial) <= MAX_CUE_MS
            && span(&previous) >= MIN_CUE_MS
        {
            cues[index - 1].pop();
            cues[index] = trial;
            continue;
        }
        index += 1;
    }
}

fn span(words: &[TimedWord]) -> i64 {
    match (words.first(), words.last()) {
        (Some(first), Some(last)) => last.end_ms.saturating_sub(first.start_ms),
        _ => 0,
    }
}

fn fits(words: &[TimedWord], max_line_chars: usize) -> bool {
    wrap_lines(words, max_line_chars).len() <= MAX_LINES
}

fn wrap_lines(words: &[TimedWord], max_line_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in words {
        let separator = if current.is_empty() || !word.gap_before {
            ""
        } else {
            " "
        };
        let extra = separator.chars().count() + word.text.chars().count();
        if !current.is_empty() && current.chars().count() + extra > max_line_chars {
            lines.push(std::mem::take(&mut current));
            current = word.text.clone();
        } else {
            current.push_str(separator);
            current.push_str(&word.text);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn cue_from(words: &[TimedWord], max_line_chars: usize) -> Option<Segment> {
    let lines = wrap_lines(words, max_line_chars);
    if lines.is_empty() {
        return None;
    }
    let start_ms = words.first()?.start_ms;
    let end_ms = words.last()?.end_ms.max(start_ms);
    let text = lines.join("\n");
    Some(Segment {
        start_ms,
        end_ms,
        wpm: cue_wpm(&text, start_ms, end_ms),
        text,
    })
}

fn cue_wpm(text: &str, start_ms: i64, end_ms: i64) -> f64 {
    let words = analysis::count_words(text);
    let ms = end_ms - start_ms;
    if words == 0 || ms <= 0 {
        return 0.0;
    }
    let wpm = words as f64 / (ms as f64 / 60_000.0);
    (wpm * 10.0).round() / 10.0
}

fn normalize(cues: &mut [Segment]) {
    for index in 0..cues.len() {
        if cues[index].end_ms <= cues[index].start_ms {
            cues[index].end_ms = cues[index].start_ms + 1;
        }
        if index > 0 && cues[index].start_ms < cues[index - 1].end_ms {
            cues[index].start_ms = cues[index - 1].end_ms;
            if cues[index].end_ms <= cues[index].start_ms {
                cues[index].end_ms = cues[index].start_ms + 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: i64, end: i64, text: &str) -> Segment {
        Segment {
            start_ms: start,
            end_ms: end,
            text: text.into(),
            wpm: 0.0,
        }
    }

    fn word(text: &str, start: i64, end: i64, gap_before: bool) -> TimedWord {
        TimedWord {
            text: text.into(),
            start_ms: start,
            end_ms: end,
            gap_before,
        }
    }

    fn assert_readable(cues: &[Segment]) {
        assert!(!cues.is_empty());
        for cue in cues {
            assert!(cue.end_ms > cue.start_ms, "{cue:?}");
            let lines: Vec<&str> = cue.text.split('\n').collect();
            assert!(lines.len() <= MAX_LINES, "{}", cue.text);
            for line in lines {
                assert!(
                    line.chars().count() <= MAX_LINE_CHARS,
                    "{line} ({} chars)",
                    line.chars().count()
                );
            }
        }
        for pair in cues.windows(2) {
            assert!(pair[1].start_ms >= pair[0].end_ms);
        }
    }

    #[test]
    fn keeps_a_short_caption_intact() {
        let cues = readable_cues(&[seg(0, 2_000, "Hello there")], &[]);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text, "Hello there");
        assert_eq!(cues[0].start_ms, 0);
        assert_eq!(cues[0].end_ms, 2_000);
        assert_readable(&cues);
    }

    #[test]
    fn wraps_a_medium_caption_onto_two_lines() {
        // 10-character words: three fit on a line (32 chars), so six words are
        // exactly two lines and must stay one cue.
        let text = "abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij";
        let cues = readable_cues(&[seg(0, 3_000, text)], &[]);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].start_ms, 0);
        assert_eq!(cues[0].end_ms, 3_000);
        assert_eq!(
            cues[0].text,
            "abcdefghij abcdefghij abcdefghij\nabcdefghij abcdefghij abcdefghij"
        );
        assert_readable(&cues);
    }

    #[test]
    fn splits_text_that_needs_more_than_two_lines() {
        let text = ["abcdefghij"; 12].join(" ");
        let cues = readable_cues(&[seg(0, 4_000, &text)], &[]);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].end_ms, 2_000);
        assert_eq!(cues[1].start_ms, 2_000);
        assert_eq!(cues[1].end_ms, 4_000);
        assert_readable(&cues);
        assert_eq!(cues[0].text.lines().count(), 2);
        assert_eq!(cues[1].text.lines().count(), 2);
    }

    #[test]
    fn distributes_a_long_cue_across_words_by_length() {
        // "a" is one character and "bb" is two, so the first word gets a third
        // of the ten seconds. Together they run past seven seconds, so they
        // become two cues instead of one line.
        let cues = readable_cues(&[seg(0, 10_000, "a bb")], &[]);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "a");
        assert_eq!(cues[0].start_ms, 0);
        assert_eq!(cues[0].end_ms, 3_333);
        assert_eq!(cues[1].text, "bb");
        assert_eq!(cues[1].start_ms, 3_333);
        assert_eq!(cues[1].end_ms, 10_000);
        assert!(cues[1].end_ms - cues[1].start_ms <= MAX_CUE_MS);
        assert_readable(&cues);
    }

    #[test]
    fn uses_word_timestamps_instead_of_even_slices() {
        let words = vec![word("a", 0, 100, false), word("bb", 100, 9_000, true)];
        let cues = readable_cues(&[seg(0, 9_000, "a bb")], &words);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "a");
        assert_eq!(cues[0].end_ms, 100);
        assert_eq!(cues[1].text, "bb");
        assert_eq!(cues[1].start_ms, 100);
        assert_eq!(cues[1].end_ms, 9_000);
    }

    #[test]
    fn splits_unspaced_text_without_inventing_spaces() {
        let text = "ក".repeat(100);
        let cues = readable_cues(&[seg(0, 30_000, &text)], &[]);
        assert!(cues.len() >= 2);
        assert_readable(&cues);
        for cue in &cues {
            assert!(!cue.text.chars().any(|c| c == ' '));
            assert!(cue.end_ms - cue.start_ms <= MAX_CUE_MS);
        }
        let rebuilt: String = cues.iter().map(|cue| cue.text.replace('\n', "")).collect();
        assert_eq!(rebuilt, text);
        assert_eq!(cues[0].start_ms, 0);
        assert_eq!(cues.last().unwrap().end_ms, 30_000);
    }

    #[test]
    fn merges_whisper_subword_tokens_and_skips_tokens_without_times() {
        let json = r#"{
            "transcription": [{
                "offsets": {"from": 0, "to": 1100},
                "text": " Hello world!",
                "tokens": [
                    {"text": "[_BEG_]", "offsets": {"from": 0, "to": 0}},
                    {"text": " Hel", "offsets": {"from": 0, "to": 200}, "p": 0.5},
                    {"text": "lo", "offsets": {"from": 200, "to": 400}, "p": 0.5},
                    {"text": " world", "offsets": {"from": 500, "to": 1000}, "p": 0.9},
                    {"text": "!", "offsets": {"from": 1000, "to": 1100}, "p": 0.2}
                ]
            }]
        }"#;
        let whisper: WhisperJson = serde_json::from_str(json).unwrap();
        let words = words_from_whisper(&whisper);
        assert_eq!(
            words,
            vec![
                word("Hello", 0, 400, true),
                word("world!", 500, 1_100, true),
            ]
        );

        let bare = r#"{
            "transcription": [{
                "offsets": {"from": 0, "to": 1000},
                "text": " Hello",
                "tokens": [{"text": " Hello", "p": 0.9}]
            }]
        }"#;
        let whisper: WhisperJson = serde_json::from_str(bare).unwrap();
        assert!(words_from_whisper(&whisper).is_empty());
    }

    #[test]
    fn khmer_clusters_stay_together_and_lines_stay_short() {
        assert_eq!(text_atoms("ក្ខស"), vec!["ក្ខ".to_string(), "ស".to_string()]);
        // សួ is a base plus a vowel; ស្តី is a base, coeng, subscript, and vowel.
        assert_eq!(text_atoms("សួស្តី"), vec!["សួ".to_string(), "ស្តី".to_string()]);
        // Two subscripts on one base are still one cluster.
        assert_eq!(text_atoms("ក្ក្ខ"), vec!["ក្ក្ខ".to_string()]);

        let cluster = "ក្ខ";
        assert_eq!(cluster.chars().count(), 3);
        let text = cluster.repeat(24);
        let cues = readable_cues_with(&[seg(0, 4_000, &text)], &[], CueLayout::khmer());
        assert!(cues.len() >= 2, "{cues:?}");
        let rebuilt: String = cues
            .iter()
            .flat_map(|cue| cue.text.chars().filter(|c| *c != '\n'))
            .collect();
        assert_eq!(rebuilt, text);
        for cue in &cues {
            let lines: Vec<&str> = cue.text.split('\n').collect();
            assert!(lines.len() <= 2, "{}", cue.text);
            for line in lines {
                assert!(
                    line.chars().count() <= KHMER_LINE_CHARS || line == cluster,
                    "{line} ({} chars)",
                    line.chars().count()
                );
                assert!(!line.ends_with(KHMER_COENG), "{line}");
                assert!(!line.starts_with(KHMER_COENG), "{line}");
                let chars: Vec<char> = line.chars().collect();
                for (index, c) in chars.iter().enumerate() {
                    if *c == KHMER_COENG {
                        assert!(
                            index + 1 < chars.len(),
                            "coeng left without its subscript: {line}"
                        );
                    }
                }
            }
        }
    }
}
