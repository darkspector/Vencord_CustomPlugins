# Vencord Custom Plugins installer
# Downloads the pre-built Vencord (with these plugins) and patches Discord.
# No Node.js, pnpm, or building required.
#
# Usage: right-click this file -> Run with PowerShell
#        (or in a terminal:  powershell -ExecutionPolicy Bypass -File installer-core.ps1)

# ---- CONFIG: replace with your GitHub "user/repo" ----
$Repo = "darkspector/Vencord_CustomPlugins"
# ------------------------------------------------------

$ErrorActionPreference = "Stop"

# Folder name kept from when this repo only had ChannelConnectSound, so existing
# installs keep their patch and plugin settings.
$dataDir = Join-Path $env:LOCALAPPDATA "VencordConnectSound"
$distZip = Join-Path $dataDir "dist.zip"
$installer = Join-Path $dataDir "VencordInstallerCli.exe"
$discordDir = Join-Path $env:LOCALAPPDATA "Discord"
$update = Join-Path $discordDir "Update.exe"

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

function Stop-Discord {
    Get-Process Discord -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

function Start-Discord {
    Start-Process $update -ArgumentList "--processStart", "Discord.exe"
}

# Launch Discord and wait until the main window is up, i.e. the updater splash
# has finished and any pending update has been installed.
function Start-DiscordAndWait {
    Start-Discord
    $deadline = (Get-Date).AddSeconds(120)
    do {
        Start-Sleep -Seconds 3
        # Loaded window titles end in " - Discord" ("Friends - Discord", "#general | Server - Discord")
        $ready = Get-Process Discord -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowTitle -match ' - Discord$' }
    } until ($ready -or (Get-Date) -gt $deadline)
}

Write-Host "Vencord Custom Plugins installer" -ForegroundColor Cyan

if (-not (Test-Path $update)) {
    throw "Discord not found at $discordDir. Install Discord first."
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

# 1. Download the pre-built dist
Write-Host "[1/4] Downloading build..."
Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/dist.zip" -OutFile $distZip

# 2. Extract (produces $dataDir\dist\)
Write-Host "[2/4] Extracting..."
if (Test-Path (Join-Path $dataDir "dist")) { Remove-Item -Recurse -Force (Join-Path $dataDir "dist") }
Expand-Archive -Path $distZip -DestinationPath $dataDir -Force

# 3. Restart Discord so it installs any pending update before we check the patch.
#    Patching first would leave the update to land in a new, unpatched app-* folder.
#    This restart also loads the freshly extracted dist if Discord is already patched.
Write-Host "[3/4] Restarting Discord to apply updates..."
Stop-Discord
Start-DiscordAndWait

$newest = Get-ChildItem $discordDir -Directory -Filter "app-*" |
    Sort-Object { [version]($_.Name -replace '^app-') } | Select-Object -Last 1

# 4. Patch only if the up-to-date version isn't patched yet (Vencord renames the
#    original app.asar to _app.asar when it patches).
if (Test-Path (Join-Path $newest.FullName "resources\_app.asar")) {
    Write-Host "[4/4] $($newest.Name) already patched."
} else {
    Write-Host "[4/4] Patching Discord ($($newest.Name))..."
    # Always fetch the latest: a stale cached CLI can "succeed" against a newer
    # Discord layout without actually patching it correctly.
    Get-Installer
    Stop-Discord
    if (-not (Invoke-Patch)) {
        throw "Patch failed. See the errors above."
    }
    Write-Host "Restarting Discord..."
    Start-Discord
}

Write-Host ""
Write-Host "Done! Enable the plugins in Settings -> Vencord -> Plugins." -ForegroundColor Green
