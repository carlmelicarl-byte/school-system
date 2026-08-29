#!/usr/bin/env python3
"""Production server for ElimuPro using Waitress.

Works on Windows AND Linux — ideal for on-premises installs (a school's own
computer/server) as well as small cloud VMs. No admin rights required.

Run:  python3 run_production.py          (port 8000)
      PORT=9000 python3 run_production.py
"""
import os
import sys

from waitress import serve

from app import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "0.0.0.0")
    print("=" * 58)
    print("  ElimuPro — Production server (Waitress)")
    print(f"  Listening on {host}:{port}   http://localhost:{port}")
    print("  Press Ctrl+C to stop.")
    print("=" * 58)
    serve(app, host=host, port=port, threads=8, channel_timeout=120)
