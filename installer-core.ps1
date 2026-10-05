# ChannelConnectSound installer
# Downloads the pre-built Vencord (with this plugin) and patches Discord.
# No Node.js, pnpm, or building required.
#
# Usage: right-click this file -> Run with PowerShell
#        (or in a terminal:  powershell -ExecutionPolicy Bypass -File install.ps1)

# ---- CONFIG: replace with your GitHub "user/repo" ----
$Repo = "darkspector/Vencord_ChannelConnectSound"
# ------------------------------------------------------

$ErrorActionPreference = "Stop"

$dataDir = Join-Path $env:LOCALAPPDATA "VencordConnectSound"
$distZip = Join-Path $dataDir "dist.zip"
$installer = Join-Path $dataDir "VencordInstallerCli.exe"

function Get-Installer {
    Write-Host "Downloading Vencord installer..."
    Invoke-WebRequest "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe" -OutFile $installer
}

function Invoke-Patch {
    $env:VENCORD_USER_DATA_DIR = $dataDir
    $env:VENCORD_DEV_INSTALL = "1"
    & $installer -install -branch stable
    return ($LASTEXITCODE -eq 0)
}

Write-Host "ChannelConnectSound installer" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# 1. Download the pre-built dist
Write-Host "[1/4] Downloading build..."
Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/dist.zip" -OutFile $distZip

# 2. Extract (produces $dataDir\dist\)
Write-Host "[2/4] Extracting..."
if (Test-Path (Join-Path $dataDir "dist")) { Remove-Item -Recurse -Force (Join-Path $dataDir "dist") }
Expand-Archive -Path $distZip -DestinationPath $dataDir -Force

# 3. Ensure Vencord's installer CLI is present (use cache if available)
# Always fetch the latest: a stale cached CLI can "succeed" against a newer
# Discord layout without actually patching it correctly.
Write-Host "[3/4] " -NoNewline
Get-Installer

# 4. Patch Discord, pointing it at our local dist.
Write-Host "[4/4] Patching Discord (stable)..."
if (-not (Invoke-Patch)) {
    throw "Patch failed. See the errors above."
}

# Restart Discord
Write-Host "Restarting Discord..."
$running = Get-Process Discord -ErrorAction SilentlyContinue
if ($running) {
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
}
$update = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
if (Test-Path $update) {
    Start-Process $update -ArgumentList "--processStart", "Discord.exe"
} else {
    Write-Host "Could not find Discord launcher — please start Discord manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! Discord is restarting. Enable ChannelConnectSound in Settings -> Vencord -> Plugins." -ForegroundColor Green
