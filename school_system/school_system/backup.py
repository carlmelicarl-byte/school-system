#!/usr/bin/env python3
"""ElimuPro database backup.

Takes a consistent online backup of school.db using SQLite's backup API and
prunes backups older than --keep days (default 30).

Run manually:      python3 backup.py
Schedule on Linux: (see deploy/elimupro-backup.service + .timer)
Schedule on Windows: Task Scheduler -> python3 backup.py
"""
import argparse
import datetime
import os
import sqlite3
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "school.db")
BACKUP_DIR = os.path.join(BASE, "backups")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=30, help="days of backups to keep")
    args = ap.parse_args()

    if not os.path.exists(SRC):
        print("[ERROR] school.db not found — nothing to back up.")
        sys.exit(1)

    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(BACKUP_DIR, f"school_{ts}.db")

    # online-consistent backup (safe even while the app is running)
    src_con = sqlite3.connect(SRC)
    dst_con = sqlite3.connect(dst)
    src_con.backup(dst_con)
    dst_con.close()
    src_con.close()
    size = os.path.getsize(dst) / 1024
    print(f"[OK] Backup saved: {dst} ({size:,.0f} KB)")

    # prune old backups
    cutoff = datetime.datetime.now() - datetime.timedelta(days=args.keep)
    removed = 0
    for fn in os.listdir(BACKUP_DIR):
        if not fn.endswith(".db"):
            continue
        try:
            dt = datetime.datetime.strptime(fn, "school_%Y%m%d_%H%M%S.db")
        except ValueError:
            continue
        if dt < cutoff:
            os.remove(os.path.join(BACKUP_DIR, fn))
            removed += 1
    if removed:
        print(f"[OK] Pruned {removed} old backup(s).")


if __name__ == "__main__":
    main()
