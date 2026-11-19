<#
.SYNOPSIS
  Downloads the free speech-to-text tools into ./tools (one-time setup).

.DESCRIPTION
  - whisper.cpp command line tool (whisper-cli.exe) from GitHub releases
  - a Whisper model from Hugging Face

  Models (bigger = more accurate, slower):
    tiny  (~75 MB)   base (~142 MB, default)   small (~466 MB)
    medium (~1.5 GB) large-v3-turbo (~1.6 GB, best for Khmer & other languages)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-tools.ps1
  powershell -ExecutionPolicy Bypass -File scripts\setup-tools.ps1 -Model small
#>
param(
  [ValidateSet('tiny', 'base', 'small', 'medium', 'large-v3-turbo')]
  [string]$Model = 'base'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools'
$whisperDir = Join-Path $tools 'whisper'
$modelDir = Join-Path $tools 'models'
New-Item -ItemType Directory -Force $whisperDir, $modelDir | Out-Null

# ffmpeg
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Write-Host "ffmpeg: found on PATH"
} else {
  Write-Host "ffmpeg: NOT found. Install it for free with:  winget install Gyan.FFmpeg" -ForegroundColor Yellow
}

# whisper.cpp
$cliPath = Join-Path $whisperDir 'whisper-cli.exe'
if (Test-Path $cliPath) {
  Write-Host "whisper-cli: already installed"
} else {
  Write-Host "whisper-cli: downloading whisper.cpp..."
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("whisper-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    # Some tagged releases ship without binaries, so pick the newest one that has the Windows build.
    $releases = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=20' -UseBasicParsing
    $asset = $releases |
      ForEach-Object { $_.assets } |
      Where-Object { $_.name -eq 'whisper-bin-x64.zip' } |
      Select-Object -First 1
    if (-not $asset) { throw 'No whisper.cpp release with whisper-bin-x64.zip was found.' }
    Write-Host "whisper-cli: using $($asset.browser_download_url)"
    $zip = Join-Path $tmp 'whisper-bin-x64.zip'
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath (Join-Path $tmp 'x') -Force
    $cli = Get-ChildItem (Join-Path $tmp 'x') -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
    if (-not $cli) { throw 'whisper-cli.exe was not found in the downloaded release.' }
    Copy-Item (Join-Path $cli.DirectoryName '*') $whisperDir -Recurse -Force
    Write-Host "whisper-cli: installed to $whisperDir"
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# model
$modelFile = Join-Path $modelDir "ggml-$Model.bin"
if (Test-Path $modelFile) {
  Write-Host "model: ggml-$Model.bin already downloaded"
} else {
  Write-Host "model: downloading ggml-$Model.bin (this can take a few minutes)..."
  $part = "$modelFile.part"
  Invoke-WebRequest "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin" -OutFile $part -UseBasicParsing
  Move-Item $part $modelFile -Force
  Write-Host "model: saved to $modelFile"
}

Write-Host ""
Write-Host "Done. The app picks the largest model found in tools\models automatically." -ForegroundColor Green
