#!/usr/bin/env python3
"""
ElimuPro — One-click school launch (client onboarding)

Creates a brand-new school for a paying client, sets its branding, secures the
admin account, and produces a ready-to-handover client sheet with their login
details and a go-live checklist.

Usage:
  python3 launch_school.py --name "Kisii Prep Academy" --slug kisii-prep
  python3 launch_school.py --name "Kisii Prep Academy" --slug kisii-prep \
      --motto "Excellence in Everything" --phone "+254 700 000 000" \
      --address "P.O. Box 100, Kisii" --email "info@kisiiprep.ac.ke" \
      --theme ocean --empty
  python3 launch_school.py --name "Kisii Prep" --slug kisii-prep --logo school-logo.png

Options:
  --name       School legal name (required)
  --slug       URL slug, lowercase letters/numbers/hyphens (required, unique)
  --admin-user Admin username (default: admin)
  --admin-pass Admin password (default: auto-generated strong password)
  --motto      School motto (optional)
  --address    School address (optional)
  --phone      School phone (optional)
  --email      School email (optional)
  --theme      Color theme: emerald|ocean|royal|forest|sunset|midnight (default emerald)
  --logo       Path to a logo image file to copy in (optional)
  --empty      Fresh empty school (no demo data). Default: sample demo data.
  --sample     Explicitly load sample demo data (default behaviour)
  --pass-print Print the admin password to the terminal (default: hidden)
"""
import argparse
import datetime
import os
import re
import secrets
import shutil
import sqlite3
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
META_DB = os.path.join(BASE, "meta.db")
UPLOAD_DIR = os.path.join(BASE, "static", "uploads")
SHEETS_DIR = os.path.join(BASE, "launch_sheets")
THEMES = ["emerald", "ocean", "royal", "forest", "sunset", "midnight"]

# What the CLIENT still needs to do after handover (printed on their sheet)
CLIENT_CHECKLIST = [
    "Log in with the admin credentials above",
    "Settings -> School: verify name, motto, address, phone, email (already pre-filled)",
    "Settings -> School: upload your school logo (a placeholder may be set)",
    "Settings -> Appearance: pick your colour theme and font",
    "Settings -> Users: create teacher, accounts, librarian and parent accounts",
    "Students: add your students (Add Student, or Import CSV in bulk)",
    "Classes: confirm Grade 1-12 classes match your school (add/rename/remove)",
    "Subjects: check the CBC subject list for your grades (add any extra subjects)",
    "Finance: set Fee Structures per class and term, and Transport route fees",
    "Exams: create your first exam and enter marks; print report cards",
    "Library: add your books (or use Import); issue books to students",
    "ID Cards: print ID cards for your students",
    "Tell parents to sign in with their phone number (password: parent123 - they must change it)",
    "Communicate your school's subdomain URL to staff and parents",
]

VENDOR_CHECKLIST = [
    "Contract signed + setup fee received",
    "ODPC data-controller registration confirmed (minors' data)",
    "M-Pesa Paybill/Till credentials configured (when integration enabled)",
    "SMS sender ID / Africa's Talking API key configured",
    "Wildcard DNS *.yourdomain.com pointing at the server",
    "Wildcard HTTPS certificate issued (certbot)",
    "Backups enabled (systemd timer / Task Scheduler)",
    "Client handover sheet given to the school (this file)",
    "Training session scheduled (1 hr, admin + accounts staff)",
    "Support contact (WhatsApp) agreed + response-time SLA",
]


def gen_password():
    return secrets.token_urlsafe(9)  # e.g. "x7kQ3vR9pL" — strong but typeable


def valid_slug(slug):
    return bool(re.match(r"^[a-z0-9][a-z0-9-]{2,30}$", slug))


def register_meta(slug, name, db_path):
    meta = sqlite3.connect(META_DB)
    meta.execute("""CREATE TABLE IF NOT EXISTS schools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        db_path TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1)""")
    meta.execute("INSERT INTO schools(slug,name,db_path) VALUES(?,?,?)", (slug, name, db_path))
    meta.commit()
    meta.close()


def set_settings(db_path, settings):
    c = sqlite3.connect(db_path)
    for k, v in settings.items():
        if v is None:
            continue
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (k, str(v)))
    c.commit()
    c.close()


def main():
    ap = argparse.ArgumentParser(description="Launch an ElimuPro school for a client")
    ap.add_argument("--name", required=True, help="School legal name")
    ap.add_argument("--slug", required=True, help="URL slug (lowercase letters/numbers/hyphens)")
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--admin-pass", default="")
    ap.add_argument("--motto")
    ap.add_argument("--address")
    ap.add_argument("--phone")
    ap.add_argument("--email")
    ap.add_argument("--theme", default="emerald")
    ap.add_argument("--logo", help="path to a logo image to copy in")
    ap.add_argument("--empty", action="store_true", help="fresh empty school (no demo data)")
    ap.add_argument("--sample", action="store_true", help="load sample demo data (default)")
    ap.add_argument("--pass-print", action="store_true", help="print the admin password")
    args = ap.parse_args()

    # ---- validation ----
    if not valid_slug(args.slug):
        sys.exit("[ERROR] Slug must be 3-31 chars: lowercase letters, numbers, hyphens.")
    if args.theme not in THEMES:
        sys.exit(f"[ERROR] Theme must be one of: {', '.join(THEMES)}")
    db_path = os.path.join(DATA_DIR, f"school_{args.slug}.db")
    if os.path.exists(db_path):
        sys.exit(f"[ERROR] A database already exists for slug '{args.slug}'. Choose another slug.")

    admin_pass = args.admin_pass or gen_password()
    sample = not args.empty  # default: sample demo data

    print("=" * 62)
    print("  ElimuPro — Launching school")
    print("=" * 62)
    print(f"  School : {args.name}")
    print(f"  Slug   : {args.slug}")
    print(f"  Data   : {'sample demo' if sample else 'fresh empty'}")

    # ---- 1. create the database ----
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        import seed as _seed
        _seed.seed_db(db_path, school_name=args.name, sample=sample,
                      admin_user=args.admin_user, admin_pass=admin_pass)
    except Exception as e:
        sys.exit(f"[ERROR] Could not create school database: {e}")

    # ---- 2. register in the platform ----
    register_meta(args.slug, args.name, db_path)

    # ---- 3. branding / settings ----
    logo_path = ""
    if args.logo:
        ext = os.path.splitext(args.logo)[1].lower()
        if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
            print(f"[WARN] Unsupported logo type '{ext}' — skipping logo.")
        else:
            sub = os.path.join(UPLOAD_DIR, args.slug)
            os.makedirs(sub, exist_ok=True)
            fname = f"logo{ext}"
            shutil.copyfile(args.logo, os.path.join(sub, fname))
            logo_path = f"/static/uploads/{args.slug}/{fname}"
    set_settings(db_path, {
        "school_name": args.name,
        "school_motto": args.motto,
        "school_address": args.address,
        "school_phone": args.phone,
        "school_email": args.email,
        "theme": args.theme,
        "school_logo": logo_path or None,
    })

    print(f"  Admin  : {args.admin_user}")
    print(f"  Theme  : {args.theme}")
    print(f"  Logo   : {logo_path or 'none'}")
    print("  [OK] School database created, registered and branded.")

    # ---- 4. client handover sheet ----
    os.makedirs(SHEETS_DIR, exist_ok=True)
    today = datetime.date.today().isoformat()
    sheet_path = os.path.join(SHEETS_DIR, f"{args.slug}_handover.txt")
    url = f"https://{args.slug}.yourdomain.com"  # vendor: replace yourdomain.com
    with open(sheet_path, "w") as f:
        f.write("=" * 62 + "\n")
        f.write(f"  ELIMUPRO — CLIENT LAUNCH SHEET\n")
        f.write(f"  {args.name}\n")
        f.write(f"  Generated {today}\n")
        f.write("=" * 62 + "\n\n")
        f.write(f"School        : {args.name}\n")
        f.write(f"Subdomain URL : {url}\n")
        f.write(f"Admin username: {args.admin_user}\n")
        f.write(f"Admin password: {admin_pass}\n")
        f.write(f"Default parent password: parent123  (parents MUST change on first login)\n\n")
        f.write("YOUR ADMIN CHECKLIST (tick these off):\n" + "-" * 40 + "\n")
        for i, item in enumerate(CLIENT_CHECKLIST, 1):
            f.write(f"  [ ] {item}\n")
        f.write("\nVENDOR CHECKLIST (before handover):\n" + "-" * 40 + "\n")
        for i, item in enumerate(VENDOR_CHECKLIST, 1):
            f.write(f"  [ ] {item}\n")
        f.write("\n" + "=" * 62 + "\n")
        f.write("  Keep this sheet safe. Password resets: Settings -> Users -> Reset.\n")
        f.write("=" * 62 + "\n")
    print(f"  [OK] Client sheet saved: {sheet_path}")

    # ---- 5. terminal summary ----
    print("\n" + "-" * 62)
    print("  SCHOOL READY — GIVE THE CLIENT:")
    print(f"    URL      : {url}")
    print(f"    Username : {args.admin_user}")
    if args.pass_print:
        print(f"    Password : {admin_pass}")
    else:
        print(f"    Password : (see {sheet_path} — kept secret)")
    print(f"  Parent default password: parent123")
    print("-" * 62)
    print("  Hand the client the launch sheet and walk them through the checklist.")
    print("  Remember: contract + ODPC registration + M-Pesa/SMS config first.")
    print("=" * 62)


if __name__ == "__main__":
    main()
