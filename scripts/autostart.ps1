# Starts Capri when you sign in to Windows: a shortcut to the release build in your Startup folder.
# Build first (inside avatar/):  npm run tauri build -- --no-bundle
# Usage: powershell -File scripts/autostart.ps1 [-Remove]
param([switch]$Remove)
$ErrorActionPreference = "Stop"

$exe = Join-Path $PSScriptRoot "..\avatar\src-tauri\target\release\avatar.exe" | Resolve-Path -ErrorAction SilentlyContinue
$link = Join-Path ([Environment]::GetFolderPath("Startup")) "Capri.lnk"

if ($Remove) {
    if (Test-Path $link) { Remove-Item $link; "Quitado: Capri ya no arranca con Windows." } else { "No estaba configurado." }
    return
}
if (-not $exe) { throw "No encuentro avatar.exe. Compílalo antes: en avatar/, npm run tauri build -- --no-bundle" }

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = "$exe"
$s.WorkingDirectory = Split-Path "$exe"
$s.Description = "Capri"
$s.Save()
"Listo: Capri arrancará al iniciar sesión ($link -> $exe)."
