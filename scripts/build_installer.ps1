# Builds dist\CapriSetup.exe: Capri's release build, her backend's code (with its uv.lock), uv and her voice files,
# packed into the installer (installer\src-tauri\payload.zip, which it carries inside). Capri must be closed (its
# exe is rebuilt). Run from the project's root:
#   powershell -File scripts/build_installer.ps1 [-SkipAvatar] [-VoiceDir D:\capri-models\tts]
param(
    [switch]$SkipAvatar,                       # reuse the avatar.exe already built
    [string]$VoiceDir = "D:\capri-models\tts"  # where capri.npy and qwen\capri.wav + capri.txt are
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root "installer\payload"
$tauri = Join-Path $root "avatar\node_modules\.bin\tauri.cmd"

if (-not $SkipAvatar) {
    Write-Host "== Capri (release)"
    Push-Location (Join-Path $root "avatar")
    npm run tauri build -- --no-bundle
    if ($LASTEXITCODE) { throw "the avatar didn't build (is Capri open? close it first)" }
    Pop-Location
}

Write-Host "== payload"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage\backend", "$stage\voz" | Out-Null
Copy-Item (Join-Path $root "avatar\src-tauri\target\release\avatar.exe") $stage
Copy-Item (Get-Command uv).Source $stage
foreach ($f in "pyproject.toml", "uv.lock", ".python-version") { Copy-Item (Join-Path $root "backend\$f") "$stage\backend" }
robocopy (Join-Path $root "backend\app") "$stage\backend\app" /E /XD __pycache__ /NFL /NDL /NJH /NJS | Out-Null
foreach ($f in "capri.npy", "qwen\capri.wav", "qwen\capri.txt") {
    $src = Join-Path $VoiceDir $f
    if (-not (Test-Path $src)) { throw "missing $src (her voice files: -VoiceDir)" }
    Copy-Item $src "$stage\voz"
}
$zip = Join-Path $root "installer\src-tauri\payload.zip"
if (Test-Path $zip) { Remove-Item $zip }
& "$env:SystemRoot\System32\tar.exe" -a -cf $zip -C $stage .  # Windows' own (bsdtar): a zip
if ($LASTEXITCODE) { throw "tar failed" }
"{0:N1} MB packed" -f ((Get-Item $zip).Length / 1MB) | Write-Host

Write-Host "== installer"
Push-Location (Join-Path $root "installer")
& $tauri build --no-bundle
if ($LASTEXITCODE) { throw "the installer didn't build" }
Pop-Location
New-Item -ItemType Directory -Force (Join-Path $root "dist") | Out-Null
$out = Join-Path $root "dist\CapriSetup.exe"
Copy-Item (Join-Path $root "installer\src-tauri\target\release\capri-setup.exe") $out -Force
"{0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB) | Write-Host
