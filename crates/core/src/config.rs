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
    /// `WHISPER_MODEL` — a ggml model file, e.g. `tools/models/ggml-base.bin`.
    pub whisper_model: PathBuf,
    /// `AUTOMATE_MAX_UPLOAD_MB`
    pub max_upload_mb: u64,
    /// `OLLAMA_URL` — local Ollama server used to read silent videos' screens.
    pub ollama_url: String,
    /// `VISION_MODEL` — Ollama vision model; picked automatically when unset.
    pub vision_model: Option<String>,
}

/// Models in order of preference: the first one found on disk is used.
const MODEL_PREFERENCE: &[&str] = &[
    "ggml-large-v3-turbo.bin",
    "ggml-medium.bin",
    "ggml-small.bin",
    "ggml-base.bin",
    "ggml-tiny.bin",
];

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
        let ffmpeg = locate(&roots, "FFMPEG_PATH", &[format!("tools/ffmpeg/ffmpeg{exe}")])
            .unwrap_or_else(|| PathBuf::from(format!("ffmpeg{exe}")));
        let ffprobe = locate(&roots, "FFPROBE_PATH", &[format!("tools/ffmpeg/ffprobe{exe}")])
            .unwrap_or_else(|| PathBuf::from(format!("ffprobe{exe}")));
        let whisper_bin = locate(&roots, "WHISPER_BIN", &[format!("tools/whisper/whisper-cli{exe}")])
            .unwrap_or_else(|| PathBuf::from(format!("whisper-cli{exe}")));
        let models: Vec<String> = MODEL_PREFERENCE
            .iter()
            .map(|m| format!("tools/models/{m}"))
            .collect();
        let whisper_model = locate(&roots, "WHISPER_MODEL", &models)
            .unwrap_or_else(|| PathBuf::from("tools/models/ggml-base.bin"));

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
