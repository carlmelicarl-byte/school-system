#!/usr/bin/env bash
# ==============================================
#   ElimuPro School Management System - Launcher
#   Works on macOS and Linux (double-click or run in terminal)
#   Usage:  ./start.sh          (normal start)
#           ./start.sh reset    (rebuild the database with fresh sample data)
# ==============================================
cd "$(dirname "$0")"

echo "=============================================="
echo "  ElimuPro School Management System - Launcher"
echo "=============================================="
echo

# ---------------- find Python ----------------
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "[ERROR] Python 3 was not found."
  echo
  echo "Install it from  https://python.org/downloads"
  echo "Then run this file again."
  echo
  read -r -p "Press Enter to close..."
  exit 1
fi
echo "[OK] Python found: $PY"

# ---------------- install Flask if needed ----------------
if ! "$PY" -c "import flask" >/dev/null 2>&1; then
  echo "[SETUP] Installing Flask library (first run, needs internet)..."
  "$PY" -m pip install flask || { echo "[ERROR] Could not install Flask. Check your internet connection."; read -r -p "Press Enter to close..."; exit 1; }
  echo "[OK] Flask installed."
fi

# ---------------- database ----------------
if [ ! -f school.db ] || [ "$1" = "reset" ]; then
  echo "[SETUP] Building the database with sample school data..."
  "$PY" seed.py || { echo "[ERROR] Could not create the database."; read -r -p "Press Enter to close..."; exit 1; }
  echo "[OK] Database ready."
else
  echo "[OK] Database found - skipping setup."
fi

echo
echo "=============================================="
echo "  ElimuPro is starting..."
echo
echo "  Open this address in your browser:"
echo "     http://localhost:8000"
echo
echo "  Sign in with:  admin / admin123"
echo
echo "  To stop the server, press  Ctrl+C  in this window."
echo "=============================================="
echo

# open the browser after a short delay so the server is ready
( sleep 2
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:8000 >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then
    open http://localhost:8000
  fi
) &

"$PY" app.py

echo
echo "Server stopped. You can close this window."
read -r -p "Press Enter to close..."
