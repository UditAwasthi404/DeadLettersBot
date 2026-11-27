# Record the primary Windows display with ffmpeg.
# Usage:
#   .\scripts\record-screen.ps1
#   .\scripts\record-screen.ps1 -Seconds 45
#   .\scripts\record-screen.ps1 -WithAudio
#   .\scripts\record-screen.ps1 -OutDir "$env:USERPROFILE\Videos\AgentOS"
# Stop early with Ctrl+C.

param(
  [int]$Seconds = 0,
  [switch]$WithAudio,
  [string]$OutDir = (Join-Path $PSScriptRoot "..\recordings"),
  [string]$Name = ("agentos-{0:yyyyMMdd-HHmmss}" -f (Get-Date))
)

$ErrorActionPreference = "Stop"

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
  throw "ffmpeg not found on PATH. Install it (e.g. winget install Gyan.FFmpeg) and reopen the terminal."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outFile = Join-Path $OutDir "$Name.mp4"

$args = @(
  "-y",
  "-f", "gdigrab",
  "-framerate", "30",
  "-i", "desktop"
)

if ($WithAudio) {
  # Uses the default Windows audio capture device when available.
  $args += @("-f", "dshow", "-i", "audio=virtual-audio-capturer")
}

$args += @(
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "20",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart"
)

if ($WithAudio) {
  $args += @("-c:a", "aac", "-b:a", "160k")
}

if ($Seconds -gt 0) {
  $args += @("-t", "$Seconds")
}

$args += $outFile

Write-Host "Recording screen -> $outFile"
if ($Seconds -gt 0) {
  Write-Host "Duration: ${Seconds}s"
} else {
  Write-Host "Press Ctrl+C to stop."
}
Write-Host ""

& $ffmpeg.Source @args
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg exited with code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Saved: $outFile"
explorer.exe /select,$outFile
