use crate::models::Segment;

fn timestamp(ms: i64, sep: char) -> String {
    let ms = ms.max(0);
    let h = ms / 3_600_000;
    let m = (ms / 60_000) % 60;
    let s = (ms / 1000) % 60;
    let frac = ms % 1000;
    format!("{h:02}:{m:02}:{s:02}{sep}{frac:03}")
}

/// SubRip subtitles (YouTube, Facebook, Premiere, CapCut...).
pub fn to_srt(segments: &[Segment]) -> String {
    let mut out = String::new();
    for (i, s) in segments.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            timestamp(s.start_ms, ','),
            timestamp(s.end_ms, ','),
            s.text
        ));
    }
    out
}

/// WebVTT subtitles (HTML5 `<track>`).
pub fn to_vtt(segments: &[Segment]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for s in segments {
        out.push_str(&format!(
            "{} --> {}\n{}\n\n",
            timestamp(s.start_ms, '.'),
            timestamp(s.end_ms, '.'),
            s.text
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(a: i64, b: i64, t: &str) -> Segment {
        Segment { start_ms: a, end_ms: b, text: t.into(), wpm: 0.0 }
    }

    #[test]
    fn formats_srt() {
        let srt = to_srt(&[seg(0, 1500, "Hello"), seg(3_723_004, 3_725_000, "World")]);
        assert_eq!(
            srt,
            "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n01:02:03,004 --> 01:02:05,000\nWorld\n\n"
        );
    }

    #[test]
    fn formats_vtt() {
        let vtt = to_vtt(&[seg(61_000, 62_250, "Hi")]);
        assert_eq!(vtt, "WEBVTT\n\n00:01:01.000 --> 00:01:02.250\nHi\n\n");
    }
}
