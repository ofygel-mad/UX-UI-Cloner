@echo off
REM Quick start script - runs all services in sequence
REM Make sure BUILD_AND_RUN.bat was executed first

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo ================================================
echo   CLONE_BROWSER - Quick Start (Windows)
echo ================================================
echo.
echo This script will start:
echo   1. API Server (http://localhost:4000)
echo   2. Web UI (http://localhost:5173)
echo   3. Desktop App (Electron)
echo.

REM Start API Server
echo [1/3] Starting API Server...
cd apps\api
start "API Server - localhost:4000" pnpm dev
timeout /t 2 /nobreak

REM Start Web UI
echo [2/3] Starting Web UI...
cd ..\web
start "Web UI - localhost:5173" pnpm dev
timeout /t 2 /nobreak

REM Start Desktop App
echo [3/3] Starting Desktop App...
cd ..\desktop
start "Desktop App" npm start
timeout /t 2 /nobreak

cd ..\..

echo.
echo ================================================
echo All services started!
echo ================================================
echo.
echo API:     http://localhost:4000
echo Web UI:  http://localhost:5173
echo Desktop: Electron window
echo.
echo Close any window to stop that service.
echo.
pause
