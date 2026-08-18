"""WSGI entry point for gunicorn (Linux cloud servers).

Run:  gunicorn -w 2 -b 127.0.0.1:8000 wsgi:application
"""
from app import app as application  # noqa: F401

if __name__ == "__main__":
    application.run(host="0.0.0.0", port=8000)
