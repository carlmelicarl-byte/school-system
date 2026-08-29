@echo off
setlocal
title ElimuPro School System
cd /d "%~dp0"

echo ==============================================
echo   ElimuPro School Management System - Launcher
echo ==============================================
echo.

REM ---------------- find Python ----------------
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY (python --version >nul 2>&1 && set PY=python)
if not defined PY (
    echo [ERROR] Python 3 was not found.
    echo.
    echo Install it from  https://python.org/downloads
    echo and make sure you tick  "Add Python to PATH"  during setup.
    echo Then run this file again.
    echo.
    pause
    exit /b 1
)
echo [OK] Python found: %PY%

REM ---------------- install Flask if needed ----------------
%PY% -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing Flask library (first run, needs internet)...
    %PY% -m pip install flask
    if errorlevel 1 (
        echo [ERROR] Could not install Flask. Check your internet connection.
        pause
        exit /b 1
    )
    echo [OK] Flask installed.
)

REM ---------------- database ----------------
if "%~1"=="reset" goto seed
if not exist school.db goto seed
echo [OK] Database found - skipping setup.
goto run

:seed
echo [SETUP] Building the database with sample school data...
%PY% seed.py
if errorlevel 1 (
    echo [ERROR] Could not create the database.
    pause
    exit /b 1
)
echo [OK] Database ready.

:run
echo.
echo ==============================================
echo   ElimuPro is starting...
echo.
echo   Open this address in your browser:
echo      http://localhost:8000
echo.
echo   Sign in with:  admin / admin123
echo.
echo   To stop the server, press  Ctrl+C  in this window.
echo ==============================================
echo.

REM open the browser after a short delay so the server is ready
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

%PY% app.py

echo.
echo Server stopped. You can close this window.
pause
