use std::{
    net::SocketAddr,
    path::{Path, PathBuf},
};

/// Runtime configuration. Every value can be overridden with an environment variable.
#[derive(Clone, Debug)]
pub struct Config {
    /// `AUTOMATE_ADDR` — where the HTTP API listens.
    pub addr: SocketAddr,
    /// `AUTOMATE_DATA_DIR` — database, uploaded videos and job files.
    pub data_dir: PathBuf,
    /// `AUTOMATE_STATIC_DIR` — built frontend (`app/dist`) to serve as the website.
    pub static_dir: Option<PathBuf>,
    /// `FFMPEG_PATH`
    pub ffmpeg: PathBuf,
    /// `FFPROBE_PATH`
    pub ffprobe: PathBuf,
    /// `WHISPER_BIN` — whisper.cpp command line tool (`whisper-cli`).
    pub whisper_bin: PathBuf,
    /// `WHISPER_MODEL` — a ggml model file, e.g. `tools/models/ggml-base.bin`
    /// or `tools/models/ggml-base.en.bin`. When unset, the best `ggml-*.bin`
    /// found under `tools/models` is used.
    pub whisper_model: PathBuf,
    /// `AUTOMATE_MAX_UPLOAD_MB`
    pub max_upload_mb: u64,
    /// `OLLAMA_URL` — local Ollama server used to read silent videos' screens.
    pub ollama_url: String,
    /// `VISION_MODEL` — Ollama vision model; picked automatically when unset.
    pub vision_model: Option<String>,
    /// `CAPTION_FONT_KM` — Khmer burned-in font. A `.ttf` path, or a family
    /// name such as `Khmer OS Battambang`. When unset, Battambang, then
    /// Siemreap, then Noto Sans Khmer are tried.
    pub caption_font_km: Option<String>,
}

impl Config {
    pub fn from_env(default_addr: SocketAddr, default_data_dir: PathBuf) -> Self {
        let addr = env("AUTOMATE_ADDR")
            .and_then(|s| s.parse().ok())
            .unwrap_or(default_addr);
        let data_dir = env("AUTOMATE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or(default_data_dir);
        let static_dir = env("AUTOMATE_STATIC_DIR").map(PathBuf::from);

        let mut roots = search_roots();
        roots.push(data_dir.clone());

        let exe = std::env::consts::EXE_SUFFIX;
        let ffmpeg = locate(
            &roots,
            "FFMPEG_PATH",
            &[format!("tools/ffmpeg/ffmpeg{exe}")],
        )
        .unwrap_or_else(|| PathBuf::from(format!("ffmpeg{exe}")));
        let ffprobe = locate(
            &roots,
            "FFPROBE_PATH",
            &[format!("tools/ffmpeg/ffprobe{exe}")],
        )
        .unwrap_or_else(|| PathBuf::from(format!("ffprobe{exe}")));
        let whisper_bin = locate(
            &roots,
            "WHISPER_BIN",
            &[format!("tools/whisper/whisper-cli{exe}")],
        )
        .unwrap_or_else(|| PathBuf::from(format!("whisper-cli{exe}")));
        let whisper_model = if let Some(path) = env("WHISPER_MODEL") {
            PathBuf::from(path)
        } else {
            let model_dirs: Vec<PathBuf> = roots
                .iter()
                .map(|r| r.join("tools").join("models"))
                .collect();
            select_whisper_model(&model_dirs)
                .unwrap_or_else(|| PathBuf::from("tools/models/ggml-base.bin"))
        };

        let max_upload_mb = env("AUTOMATE_MAX_UPLOAD_MB")
            .and_then(|s| s.parse().ok())
            .unwrap_or(1024);

        Self {
            addr,
            data_dir,
            static_dir,
            ffmpeg,
            ffprobe,
            whisper_bin,
            whisper_model,
            max_upload_mb,
            ollama_url: env("OLLAMA_URL")
                .unwrap_or_else(|| "http://127.0.0.1:11434".into())
                .trim_end_matches('/')
                .to_string(),
            vision_model: env("VISION_MODEL"),
            caption_font_km: env("CAPTION_FONT_KM"),
        }
    }
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

/// Folders searched for `tools/...`: the current directory, and the
/// executable's folder plus a few parents (so `target/debug/x.exe` finds the repo root).
fn search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        roots.extend(exe.ancestors().skip(1).take(5).map(Path::to_path_buf));
    }
    roots
}

fn locate(roots: &[PathBuf], var: &str, candidates: &[String]) -> Option<PathBuf> {
    if let Some(v) = env(var) {
        return Some(PathBuf::from(v));
    }
    candidates
        .iter()
        .flat_map(|c| roots.iter().map(move |r| r.join(c)))
        .find(|p| p.is_file())
}

/// One discovered model. Lower `rank` is a better model; an earlier directory
/// wins when the rank is the same.
struct FoundModel {
    rank: (u8, u8, u8),
    dir_index: usize,
    name: String,
    path: PathBuf,
}

/// Pick a Whisper model from `model_dirs`.
///
/// Every `ggml-*.bin` file counts, including English-only names such as
/// `ggml-base.en.bin` and quantized names such as `ggml-base.en-q5_1.bin`.
/// Larger families win, then full precision over a quantized file of the same
/// family, then a multilingual model over the `.en` file of that size.
/// Earlier directories win ties. `None` means the directories had no model.
fn select_whisper_model(model_dirs: &[PathBuf]) -> Option<PathBuf> {
    let mut best: Option<FoundModel> = None;
    for (dir_index, dir) in model_dirs.iter().enumerate() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = ggml_model_name(&path) else {
                continue;
            };
            let rank = model_rank(name);
            let better = match &best {
                None => true,
                Some(current) => {
                    (rank, dir_index, name)
                        < (current.rank, current.dir_index, current.name.as_str())
                }
            };
            if better {
                best = Some(FoundModel {
                    rank,
                    dir_index,
                    name: name.to_string(),
                    path,
                });
            }
        }
    }
    best.map(|found| found.path)
}

fn ggml_model_name(path: &Path) -> Option<&str> {
    if !path.is_file() {
        return None;
    }
    let name = path.file_name()?.to_str()?;
    if name.starts_with("ggml-") && name.ends_with(".bin") {
        Some(name)
    } else {
        None
    }
}

/// Lower is better: `(family, quantization, language variant)`.
fn model_rank(file_name: &str) -> (u8, u8, u8) {
    let Some(rest) = file_name
        .strip_prefix("ggml-")
        .and_then(|name| name.strip_suffix(".bin"))
    else {
        return (u8::MAX, u8::MAX, u8::MAX);
    };
    let (rest, quant) = split_quant(rest);
    let (family, variant) = split_variant(rest);
    (family_rank(family), quant, variant)
}

/// Whisper.cpp quant suffixes look like `-q5_0`, `-q5_1`, or `-q8_0`.
fn split_quant(name: &str) -> (&str, u8) {
    let Some(idx) = name.rfind("-q") else {
        return (name, 0);
    };
    let suffix = &name[idx + 2..];
    let Some(first) = suffix.chars().next() else {
        return (name, 0);
    };
    if !first.is_ascii_digit()
        || !suffix
            .chars()
            .all(|c| c.is_ascii_digit() || c == '_' || c == 'k' || c == 'K')
    {
        return (name, 0);
    }
    let quant = match first {
        '8' => 1,
        '6' => 2,
        '5' => 3,
        '4' => 4,
        _ => 5,
    };
    (&name[..idx], quant)
}

/// `.en` is the English-only model. `.en-tdrz` is the same plus a time-delay token.
fn split_variant(name: &str) -> (&str, u8) {
    if let Some(family) = name.strip_suffix(".en-tdrz") {
        return (family, 2);
    }
    if let Some(family) = name.strip_suffix(".en") {
        return (family, 1);
    }
    (name, 0)
}

fn family_rank(family: &str) -> u8 {
    match family {
        "large-v3-turbo" => 0,
        "large-v3" => 1,
        "large-v2" => 2,
        "large-v1" => 3,
        "large" => 4,
        "distil-large-v3" => 5,
        "medium" | "distil-medium" => 6,
        "small" | "distil-small" => 7,
        "base" => 8,
        "tiny" => 9,
        _ => 100,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempModels(PathBuf);

    impl TempModels {
        fn new() -> Self {
            static N: AtomicU64 = AtomicU64::new(0);
            let n = N.fetch_add(1, Ordering::Relaxed);
            let path =
                std::env::temp_dir().join(format!("automate-models-{}-{n}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn write(&self, name: &str) {
            fs::write(self.0.join(name), b"ggml").unwrap();
        }
    }

    impl Drop for TempModels {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn chosen(dirs: &[PathBuf]) -> Option<String> {
        select_whisper_model(dirs)
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
    }

    #[test]
    fn discovers_english_only_model() {
        let dir = TempModels::new();
        dir.write("ggml-base.en.bin");
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-base.en.bin")
        );
    }

    #[test]
    fn prefers_larger_family_then_multilingual_over_english() {
        let dir = TempModels::new();
        for name in [
            "ggml-tiny.en.bin",
            "ggml-tiny.bin",
            "ggml-base.en.bin",
            "ggml-base.bin",
            "ggml-small.en.bin",
            "ggml-medium.en.bin",
            "ggml-large-v3-turbo.bin",
        ] {
            dir.write(name);
        }
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-large-v3-turbo.bin")
        );

        fs::remove_file(dir.path().join("ggml-large-v3-turbo.bin")).unwrap();
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-medium.en.bin")
        );

        dir.write("ggml-medium.bin");
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-medium.bin")
        );
    }

    #[test]
    fn english_base_beats_a_smaller_multilingual_model() {
        let dir = TempModels::new();
        dir.write("ggml-tiny.bin");
        dir.write("ggml-base.en.bin");
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-base.en.bin")
        );
    }

    #[test]
    fn uses_quantized_and_other_ggml_variants() {
        let dir = TempModels::new();
        dir.write("ggml-base.en-q5_1.bin");
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-base.en-q5_1.bin")
        );

        dir.write("ggml-base.en.bin");
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-base.en.bin")
        );

        dir.write("ggml-custom.bin");
        dir.write("notes.txt");
        dir.write("ggml-base.en.bin.part");
        fs::create_dir(dir.path().join("ggml-large.bin")).unwrap();
        // The full English base model still wins over a quant, an unknown name,
        // a partial download, and a directory that only looks like a model.
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-base.en.bin")
        );

        fs::remove_file(dir.path().join("ggml-base.en.bin")).unwrap();
        fs::remove_file(dir.path().join("ggml-base.en-q5_1.bin")).unwrap();
        assert_eq!(
            chosen(&[dir.path().to_path_buf()]).as_deref(),
            Some("ggml-custom.bin")
        );
    }

    #[test]
    fn ignores_unrelated_files() {
        let dir = TempModels::new();
        dir.write("readme.txt");
        dir.write("not-a-model.bin");
        dir.write("ggml-base.en.bin.part");
        assert_eq!(chosen(&[dir.path().to_path_buf()]), None);
        assert_eq!(chosen(&[dir.path().join("missing")]), None);
    }

    #[test]
    fn earlier_directory_wins_ties_but_better_model_wins_across_directories() {
        let first = TempModels::new();
        let second = TempModels::new();
        first.write("ggml-tiny.bin");
        second.write("ggml-tiny.bin");
        second.write("ggml-base.en.bin");

        let from_first =
            select_whisper_model(&[first.path().to_path_buf(), second.path().to_path_buf()]);
        assert_eq!(
            from_first.unwrap().file_name().unwrap(),
            "ggml-base.en.bin",
            "a larger model in a later directory beats a smaller one found first"
        );

        first.write("ggml-base.en.bin");
        let tied = select_whisper_model(&[first.path().to_path_buf(), second.path().to_path_buf()]);
        assert_eq!(tied.unwrap(), first.path().join("ggml-base.en.bin"));
    }

    #[test]
    fn preference_order_is_size_then_precision_then_language() {
        // Best first. Sorting by rank must not reorder this list.
        let names = [
            "ggml-large-v3-turbo.bin",
            "ggml-large-v3-turbo-q5_0.bin",
            "ggml-large-v3.bin",
            "ggml-large-v2.bin",
            "ggml-large-v1.bin",
            "ggml-large.bin",
            "ggml-distil-large-v3.bin",
            "ggml-medium.bin",
            "ggml-medium.en.bin",
            "ggml-small.bin",
            "ggml-small.en.bin",
            "ggml-small.en-tdrz.bin",
            "ggml-base.bin",
            "ggml-base.en.bin",
            "ggml-base-q8_0.bin",
            "ggml-base.en-q5_1.bin",
            "ggml-tiny.bin",
            "ggml-tiny.en.bin",
            "ggml-custom.bin",
        ];
        let mut ordered = names.to_vec();
        ordered.sort_by_key(|name| (model_rank(name), *name));
        assert_eq!(ordered, names);
    }
}
