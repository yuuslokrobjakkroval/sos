# Automate — Video to Text

Upload a video and get:

- **Text**: a full transcript of what is said
- **Captions**: timed subtitles you can download as **SRT** (YouTube, Facebook, CapCut, Premiere) or **VTT** (web players), shown live on the video
- **Speed**: speaking speed in **words per minute**, overall and for every caption line, labeled *Slow* (under 110), *Normal* or *Fast* (over 160)

It runs as a **website** and as a **desktop app** (Windows, plus macOS and Linux). Both use the same Rust engine and the same UI.
It costs nothing to run. Speech recognition uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp) **on your own machine**, so you need no paid API and no cloud, and videos never leave the computer.

## How it works

```
 React UI (app/) ── website in any browser
       │          └─ desktop app via Tauri (app/src-tauri)
       │ HTTP /api
 Rust engine (crates/core)            ← one engine for both
   upload → SQLite job queue → worker:
     1. ffmpeg      extract 16 kHz mono audio
     2. whisper-cli transcribe with timestamps
     3. analysis    captions (SRT/VTT) + words-per-minute
```

| Folder | What it is |
| --- | --- |
| `crates/core` | Engine: HTTP API (Axum), SQLite storage, background worker, ffmpeg + whisper pipeline, caption and speed analysis |
| `crates/server` | Website server: runs the engine and serves the built UI from `app/dist` |
| `app/` | React + TypeScript UI, shared by the website and the desktop app |
| `app/src-tauri` | Desktop app: starts the engine inside the app on `127.0.0.1:17890` and opens the UI |
| `scripts/setup-tools.ps1` | Windows: downloads whisper.cpp and a speech model into `tools/` |
| `scripts/setup-tools.sh` | Linux and macOS: builds `whisper-cli` and downloads a speech model into `tools/` |
| `data/` | Created at runtime: `automate.db`, uploaded videos and job files |

## One-time setup

Building the engine requires **Rust 1.88 or newer**. This `Cargo.lock` needs that toolchain; Debian's packaged Rust 1.85 is too old. Install Rust with [rustup](https://rustup.rs).

### Windows

1. **Rust**: `winget install Rustlang.Rustup` (also install *Visual Studio Build Tools* with the "Desktop development with C++" workload)
2. **Node.js 20+**
3. **ffmpeg**: `winget install Gyan.FFmpeg`
4. **Whisper and a model**. Run this from the project folder:

   ```powershell
   npm run setup                       # base model (~142 MB), good for English
   # or, for better accuracy with Khmer and other languages:
   powershell -ExecutionPolicy Bypass -File scripts\setup-tools.ps1 -Model large-v3-turbo
   ```

   The engine uses the best `ggml-*.bin` it finds in `tools\models`, including English-only files such as `ggml-base.en.bin`. Larger models win. A multilingual model wins over the `.en` file of the same size.

5. **Frontend packages**: `npm --prefix app install`

### Linux and macOS

On Linux and macOS, build `whisper-cli` from source with cmake and download a model (for example the English-only `ggml-base.en.bin` from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp)).

1. **Rust 1.88+** with rustup:

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Node.js 20+**
3. **ffmpeg**, a C compiler, cmake, and git:

   ```bash
   # Debian/Ubuntu
   sudo apt install ffmpeg build-essential cmake git curl
   # macOS
   brew install ffmpeg cmake git
   ```

4. **Whisper and a model**, from the project folder:

   ```bash
   bash scripts/setup-tools.sh              # ggml-base.bin
   bash scripts/setup-tools.sh base.en      # ggml-base.en.bin (~142 MB, English)
   bash scripts/setup-tools.sh large-v3-turbo
   ```

   The script builds `whisper-cli` from [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and puts it in `tools/whisper/`, then downloads the model into `tools/models/`. To do that by hand:

   ```bash
   git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /tmp/whisper.cpp
   cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build \
     -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
   cmake --build /tmp/whisper.cpp/build -j --target whisper-cli
   mkdir -p tools/whisper tools/models
   cp /tmp/whisper.cpp/build/bin/whisper-cli tools/whisper/whisper-cli
   chmod +x tools/whisper/whisper-cli

   curl -fL -o tools/models/ggml-base.en.bin \
     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
   ```

   If `whisper-cli` still looks for shared libraries next to the build tree, copy those `libggml` / `libwhisper` files into `tools/whisper/` as well (the setup script does this). Any `ggml-*.bin` in `tools/models` is picked up automatically, including `.en` and quantized names. Set `WHISPER_MODEL` to force one file.

5. **Desktop app system packages (Linux).** Building with Tauri needs the webkit2gtk 4.1, GTK 3, and libsoup 3 development packages:

   ```bash
   sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
     libssl-dev patchelf librsvg2-dev
   ```

6. **Frontend packages**: `npm --prefix app install`

## Silent videos (screen recordings with no voice)

When a video has **no sound**, or sound but **no speech** (only music), Automate reads the
screen instead:

1. It finds the moments where the screen changes (2 checks per second with ffmpeg `mpdecimate`).
   Typing bursts are merged into one step, and no step is longer than 6 seconds.
2. A free local AI vision model, run through [Ollama](https://ollama.com), looks at each moment and
   writes one instruction, for example *"Type your email address in the Email field."*
3. The steps become timed captions (SRT/VTT) and a numbered guide (text download).

Setup (free, one time):

```powershell
winget install Ollama.Ollama
ollama pull qwen3-vl:4b        # ~3.3 GB; best with a GPU (works on CPU, slower)
```

The engine finds the model automatically. The header then shows **"screen reader on"**.
Choose a model with `VISION_MODEL` (e.g. `qwen3-vl:8b` for higher quality) and point to another
Ollama server with `OLLAMA_URL`.
The **Spoken language** you pick when uploading sets the caption language. Auto-detect gives English.
Captions written from the screen are generated by AI, so check them before publishing.

## Run the website

```powershell
npm run build:web      # build the UI into app/dist
npm run server         # start at http://127.0.0.1:8787
```

Open <http://127.0.0.1:8787>.

**Live development**: run `npm run server` in one terminal and `npm run dev:web` in another, then open <http://localhost:5173>. UI changes reload instantly.

## Run the desktop app

```powershell
npm run dev:desktop    # development window with hot reload
npm run build:desktop  # build the installers
```

The installers are written to `target\release\bundle\` (`nsis\*.exe` and `msi\*.msi`).
The desktop app keeps its data in `%APPDATA%\com.automate.videotext`.

> **Installed desktop app:** the installer does not include the large Whisper model. Copy the
> project's `tools` folder into the app data directory (`tools` inside
> `%APPDATA%\com.automate.videotext` on Windows,
> `~/Library/Application Support/com.automate.videotext` on macOS, or
> `~/.local/share/com.automate.videotext` on Linux), or set the
> `WHISPER_BIN` and `WHISPER_MODEL` environment variables. ffmpeg must also be installed.
> When something is missing, the app shows a "Setup needed" banner.

## Settings (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTOMATE_ADDR` | `127.0.0.1:8787` | Address the website server listens on. Use `0.0.0.0:8787` to allow other devices on your network |
| `AUTOMATE_DATA_DIR` | `data` | Where the database and uploaded files go |
| `AUTOMATE_STATIC_DIR` | `app/dist` | The built UI to serve |
| `AUTOMATE_MAX_UPLOAD_MB` | `1024` | Upload size limit |
| `FFMPEG_PATH`, `FFPROBE_PATH` | found on PATH | Where to find ffmpeg and ffprobe |
| `WHISPER_BIN` | `tools/whisper/whisper-cli` (`.exe` on Windows) | Where to find whisper.cpp |
| `WHISPER_MODEL` | best `ggml-*.bin` in `tools/models` | Speech model. English-only files such as `ggml-base.en.bin` are included |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Shows whether ffmpeg, whisper and the model were found |
| `POST` | `/api/videos` | Multipart upload: `file` plus an optional `language` (`auto`, `en`, `km`, …) |
| `GET` | `/api/videos` | List all videos |
| `GET` | `/api/videos/{id}` | Status and results (`text`, `segments`, `stats`) |
| `GET` | `/api/videos/{id}/media` | Stream the original video (supports seeking) |
| `GET` | `/api/videos/{id}/captions/{srt\|vtt\|txt}` | Download captions or plain text |
| `POST` | `/api/videos/{id}/retry` | Retry a failed analysis |
| `DELETE` | `/api/videos/{id}` | Delete a video and its results |

Example:

```powershell
curl.exe -F "language=auto" -F "file=@my-video.mp4" http://127.0.0.1:8787/api/videos
```

## Tests

```powershell
npm test     # Rust unit tests for captions and speed analysis
```

## Notes and limits

- **Speed**: transcription runs on the CPU. With the `base` model, a 10-minute video takes roughly 1–3 minutes on a modern PC. Larger models are more accurate but slower.
- **Khmer, Thai and Chinese**: these languages are written without spaces between words, so the word count, and therefore words per minute, comes out lower than the true value. Transcripts and captions are not affected. Use `large-v3-turbo` for the best Khmer accuracy.
- **Security**: the server has no login yet. It listens only on `127.0.0.1` by default. Add accounts before exposing it to the internet.

## Roadmap

- User accounts and login before going public
- Mobile apps (iOS and Android) built from the same Tauri project (`tauri android init`, `tauri ios init`; iOS needs a Mac). On phones the engine should run on a server, not on the device
- Translating captions into other languages
- Burning captions into the video (ffmpeg `subtitles` filter)
- An AI summary of each video
