@echo off
REM Build and Run Script for CLONE_BROWSER (Windows)
REM This script rebuilds the entire project

setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo ================================================
echo   CLONE_BROWSER - Full Rebuild (Windows)
echo ================================================
echo.

REM Step 1: Install dependencies
echo [1/4] Installing dependencies...
call pnpm install
if errorlevel 1 goto error
echo Done.
echo.

REM Step 2: Build API
echo [2/4] Building API server...
cd apps\api
call pnpm build
if errorlevel 1 goto error
cd ..\..
echo Done.
echo.

REM Step 3: Build Web UI
echo [3/4] Building Web UI...
cd apps\web
call pnpm build
if errorlevel 1 goto error
cd ..\..
echo Done.
echo.

REM Step 4: Build Desktop
echo [4/4] Building Desktop app...
cd apps\desktop
if exist dist rmdir /s /q dist
node ./scripts/build-desktop.mjs
if errorlevel 1 goto error
cd ..\..
echo Done.
echo.

echo ================================================
echo Build complete!
echo ================================================
echo.
echo Available commands:
echo.
echo   API Server (development):
echo     cd apps\api ^& pnpm dev
echo.
echo   Web UI (development):
echo     cd apps\web ^& pnpm dev
echo.
echo   Desktop App:
echo     cd apps\desktop ^& npm start
echo.
echo ================================================
echo.
pause
goto end

:error
echo.
echo ERROR: Build failed!
echo.
pause
exit /b 1

:end
