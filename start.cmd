@echo off
pushd "%~dp0"

REM Self-elevate if not admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process 'cmd.exe' -ArgumentList '/c pushd \"%~dp0\" && \"%~f0\"' -Verb RunAs"
    exit /b
)

echo ============================================
echo   QQ Chat Bot v2
echo ============================================
echo.

REM Check node
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found in PATH
    echo Please install Node.js or add it to system PATH
    pause
    exit /b 1
)

echo [1/2] Starting NapCatQQ...
set "NAPCDIR=%~dp0napcat"
set "QQPATH=C:\Program Files\Tencent\QQNT\QQ.exe"

curl -s http://localhost:6099 >nul 2>&1
if %errorlevel% equ 0 (
    echo NapCatQQ already running
) else (
    echo Launching NapCatQQ...

    REM Set NapCat environment variables and generate loadNapCat.js with correct path
    set "NAPCAT_PATCH_PACKAGE=%NAPCDIR%\qqnt.json"
    set "NAPCAT_LOAD_PATH=%NAPCDIR%\loadNapCat.js"
    set "NAPCAT_INJECT_PATH=%NAPCDIR%\NapCatWinBootHook.dll"
    set "NAPCAT_LAUNCHER_PATH=%NAPCDIR%\NapCatWinBootMain.exe"
    powershell -ExecutionPolicy Bypass -File "%~dp0gen-loadnapcat.ps1" "%NAPCDIR%"

    start "" /min "%NAPCDIR%\NapCatWinBootMain.exe" "%QQPATH%" "%NAPCDIR%\NapCatWinBootHook.dll"
    echo Waiting for NapCatQQ startup...
    timeout /t 5 /nobreak >nul
)

echo.
echo [2/2] Starting bot server on port 3456...
echo.
start http://localhost:3456
node server.js

pause
