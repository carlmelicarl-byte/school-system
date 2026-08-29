"""WSGI entry point for gunicorn (Linux cloud servers).

Run:  gunicorn -w 2 -b 127.0.0.1:8000 wsgi:application
"""
from app import app, boot as _boot  # noqa: F401

_boot()  # ensure platform registry + demo school exist (fresh deploy safe)

if __name__ == "__main__":
    application.run(host="0.0.0.0", port=8000)
