@echo off
setlocal
title ElimuPro School System (Production)
cd /d "%~dp0"

echo ==============================================
echo   ElimuPro - Production Server (Waitress)
echo   Ideal for on-premises installs on this PC
echo ==============================================
echo.

REM ---------------- find Python ----------------
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY (python --version >nul 2>&1 && set PY=python)
if not defined PY (
    echo [ERROR] Python 3 not found. Install from https://python.org/downloads
    pause & exit /b 1
)

REM ---------------- install production deps if missing ----------------
%PY% -c "import waitress, flask" >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing production dependencies (first run)...
    %PY% -m pip install -r requirements.txt
)

REM ---------------- database ----------------
if not exist school.db (
    echo [SETUP] Creating the database...
    %PY% seed.py
)

REM ---------------- daily backup via Task Scheduler ----------------
echo [INFO] To auto-backup daily: open Task Scheduler and create a task that runs:
echo        %PY% "%cd%\backup.py"

echo.
echo ==============================================
echo   ElimuPro is starting on  http://localhost:8000
echo   Keep this window open. Ctrl+C to stop.
echo ==============================================
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"
%PY% run_production.py
pause
