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
BACKUP_DIR = os.path.join(BASE, "backups")
META_DB = os.path.join(BASE, "meta.db")


def backup_one(label, src, ts):
    dst = os.path.join(BACKUP_DIR, f"{label}_{ts}.db")
    src_con = sqlite3.connect(src)
    dst_con = sqlite3.connect(dst)
    src_con.backup(dst_con)
    dst_con.close()
    src_con.close()
    size = os.path.getsize(dst) / 1024
    print(f"[OK] {label}: {dst} ({size:,.0f} KB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=30, help="days of backups to keep")
    args = ap.parse_args()

    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    # every school database + the platform registry
    targets = []
    if os.path.exists(META_DB):
        m = sqlite3.connect(META_DB)
        m.row_factory = sqlite3.Row
        try:
            for r in m.execute("SELECT slug, db_path FROM schools"):
                if os.path.exists(r["db_path"]):
                    targets.append((f"school_{r['slug']}", r["db_path"]))
        except Exception:
            pass
        m.close()
        targets.insert(0, ("meta", META_DB))
    main_db = os.path.join(BASE, "school.db")
    if os.path.exists(main_db) and not any(t[1] == main_db for t in targets):
        targets.insert(0, ("school", main_db))

    if not targets:
        print("[ERROR] No databases found to back up.")
        sys.exit(1)

    for label, path in targets:
        try:
            backup_one(label, path, ts)
        except Exception as e:
            print(f"[ERROR] {label}: {e}")

    # prune old backups
    cutoff = datetime.datetime.now() - datetime.timedelta(days=args.keep)
    removed = 0
    for fn in os.listdir(BACKUP_DIR):
        if not fn.endswith(".db"):
            continue
        p = os.path.join(BACKUP_DIR, fn)
        try:
            if datetime.datetime.fromtimestamp(os.path.getmtime(p)) < cutoff:
                os.remove(p)
                removed += 1
        except Exception:
            continue
    if removed:
        print(f"[OK] Pruned {removed} old backup(s).")


if __name__ == "__main__":
    main()
