#!/usr/bin/env bash
# One-time Linux/macOS setup: build whisper-cli and download a ggml model into ./tools.
#
# Usage:
#   bash scripts/setup-tools.sh              # ggml-base.bin
#   bash scripts/setup-tools.sh base.en      # English-only base model
#   bash scripts/setup-tools.sh large-v3-turbo
#
# Models (bigger = more accurate, slower):
#   tiny, tiny.en
#   base, base.en          (default: base, ~142 MB)
#   small, small.en
#   medium, medium.en
#   large-v1, large-v2, large-v3, large-v3-turbo
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-tools.sh [model]

Builds whisper.cpp's whisper-cli into tools/whisper/ and downloads a ggml
model into tools/models/.

Models (bigger = more accurate, slower):
  tiny, tiny.en
  base, base.en          (default: base)
  small, small.en
  medium, medium.en
  large-v1, large-v2, large-v3, large-v3-turbo

Examples:
  bash scripts/setup-tools.sh
  bash scripts/setup-tools.sh base.en
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

MODEL="${1:-base}"
case "$MODEL" in
  tiny|tiny.en|base|base.en|small|small.en|medium|medium.en|large-v1|large-v2|large-v3|large-v3-turbo) ;;
  *)
    echo "Unknown model '$MODEL'." >&2
    usage >&2
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHISPER_DIR="$ROOT/tools/whisper"
MODEL_DIR="$ROOT/tools/models"
mkdir -p "$WHISPER_DIR" "$MODEL_DIR"

if command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg: found on PATH ($(command -v ffmpeg))"
else
  echo "ffmpeg: NOT found."
  case "$(uname -s)" in
    Darwin) echo "  Install it with: brew install ffmpeg" ;;
    *) echo "  Install it with: sudo apt install ffmpeg" ;;
  esac
fi

job_count() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
  elif command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.ncpu
  else
    echo 2
  fi
}

need_tool() {
  local tool="$1"
  if command -v "$tool" >/dev/null 2>&1; then
    return 0
  fi
  echo "whisper-cli: '$tool' is required to build whisper.cpp." >&2
  case "$(uname -s)" in
    Darwin) echo "  Install it with: brew install $tool" >&2 ;;
    *) echo "  Install it with: sudo apt install $tool build-essential" >&2 ;;
  esac
  exit 1
}

CLI="$WHISPER_DIR/whisper-cli"
if [[ -x "$CLI" ]]; then
  echo "whisper-cli: already installed"
else
  echo "whisper-cli: building whisper.cpp (this can take a few minutes)..."
  need_tool git
  need_tool cmake
  if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
    echo "whisper-cli: a C compiler is required (build-essential, or Xcode command line tools)." >&2
    exit 1
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$tmp/whisper.cpp"
  cmake -S "$tmp/whisper.cpp" -B "$tmp/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF
  cmake --build "$tmp/build" -j "$(job_count)" --target whisper-cli

  built="$(find "$tmp/build" -type f -name 'whisper-cli' | head -n 1 || true)"
  if [[ -z "${built}" ]]; then
    echo "whisper-cli: the build finished, but whisper-cli was not found under $tmp/build." >&2
    exit 1
  fi
  cp "$built" "$CLI"
  chmod +x "$CLI"

  # A shared library left behind by the build still points at the cmake tree.
  # Copy it next to the binary so `tools/whisper/whisper-cli` runs on its own.
  if command -v ldd >/dev/null 2>&1; then
    missing="$(ldd "$CLI" 2>/dev/null | awk '/not found/ { print $1 }' || true)"
    if [[ -n "$missing" ]]; then
      while IFS= read -r libname; do
        [[ -z "$libname" ]] && continue
        found="$(find "$tmp/build" -type f -name "$libname" | head -n 1 || true)"
        if [[ -n "$found" ]]; then
          cp -a "$found" "$WHISPER_DIR/"
        else
          echo "whisper-cli: could not find $libname in the build tree." >&2
        fi
      done <<< "$missing"
      if command -v patchelf >/dev/null 2>&1; then
        patchelf --set-rpath '$ORIGIN' "$CLI" || true
      else
        echo "whisper-cli: install patchelf, or set LD_LIBRARY_PATH=$WHISPER_DIR, if the binary does not start." >&2
      fi
    fi
  fi
  echo "whisper-cli: installed to $WHISPER_DIR"
fi

MODEL_FILE="$MODEL_DIR/ggml-$MODEL.bin"
if [[ -f "$MODEL_FILE" ]]; then
  echo "model: ggml-$MODEL.bin already downloaded"
else
  url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  echo "model: downloading ggml-$MODEL.bin (this can take a few minutes)..."
  part="$MODEL_FILE.part"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 --retry-delay 2 -o "$part" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$part" "$url"
  else
    echo "model: curl or wget is required to download the model." >&2
    exit 1
  fi
  mv "$part" "$MODEL_FILE"
  echo "model: saved to $MODEL_FILE"
fi

echo
echo "Done. The app picks the best ggml-*.bin in tools/models automatically."
if [[ "$(uname -s)" == "Linux" ]]; then
  echo "Desktop app build deps: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev"
fi
