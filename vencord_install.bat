@echo off
title Vencord Custom Plugins Installer
echo ============================================
echo   Vencord Custom Plugins Installer
echo ============================================
echo.
echo This will download and patch Discord with the
echo custom plugins. No build tools needed.
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -Command "& { try { irm 'https://github.com/darkspector/Vencord_CustomPlugins/releases/latest/download/installer-core.ps1' | iex } catch { Write-Host $_.Exception.Message -ForegroundColor Red } }"

echo.
pause
