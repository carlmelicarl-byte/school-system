# 🚀 Deploying ElimuPro — Cloud & On-Premises

This guide turns the demo into a **saleable, production deployment**. Choose the path
that fits the school:

| Model | Best for | Setup time |
|---|---|---|
| **Cloud (you host)** | You sell yearly subscriptions; schools just open a browser | ~30 min per server |
| **On-premises (school's PC/server)** | One-off licence; school wants data on their own machine | ~15 min per school |

Both share the same app — only the webserver differs.

---

## 0. Prepare once (do this before selling)

```bash
cd school_system
pip install -r requirements.txt     # flask + waitress + gunicorn
python3 seed.py                     # build the DB (or import the school's real data later)
python3 backup.py                   # make a first backup
```

**Set a real secret key** (login security) and **HTTPS** on any public deployment:

```bash
# Linux/macOS:
export ELIMUPRO_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
export ELIMUPRO_HTTPS=1             # only when behind HTTPS (see below)
# Windows (PowerShell):
$env:ELIMUPRO_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
```

> The app auto-creates a `.secret_key` file if none is set — fine for on-premises,
> but set the env var for cloud servers so you can rotate it easily.

---

## 1. Cloud deployment (Ubuntu server)

### 1.1 Server setup
```bash
sudo apt update && sudo apt install -y python3 python3-venv nginx
sudo useradd -m -s /bin/bash elimupro
sudo mkdir -p /opt/elimupro
```

### 1.2 Get the code
```bash
cd /opt/elimupro
# your repo:
sudo git clone https://github.com/YOUR_USERNAME/elimupro-school-system.git .
# or copy the folder up with scp/rsync if not using git
```

### 1.3 Python env + deps
```bash
sudo -u elimupro bash -c 'cd /opt/elimupro && python3 -m venv venv'
sudo -u elimupro /opt/elimupro/venv/bin/pip install -r requirements.txt
sudo -u elimupro /opt/elimupro/venv/bin/python seed.py
```

### 1.4 systemd service (auto-start + auto-restart)
```bash
sudo cp deploy/elimupro.service /etc/systemd/system/
sudo nano /etc/systemd/system/elimupro.service     # set User, paths, ELIMUPRO_SECRET
sudo systemctl daemon-reload
sudo systemctl enable --now elimupro
curl -s http://127.0.0.1:8000 -o /dev/null -w "%{http_code}\n"   # expect 200
```

### 1.5 nginx + HTTPS
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/elimupro
sudo nano /etc/nginx/sites-available/elimupro     # set your domain
sudo ln -s /etc/nginx/sites-available/elimupro /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# free HTTPS certificate:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-school-domain.com
```

### 1.6 Daily backups (automatic)
```bash
sudo cp deploy/elimupro-backup.service deploy/elimupro-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now elimupro-backup.timer
```
Backups land in `backups/school_YYYYMMDD_HHMMSS.db` (kept 30 days). Test a restore:
```bash
python3 - <<'EOF'
import sqlite3
src=sqlite3.connect("backups/<newest file>"); dst=sqlite3.connect("test_restore.db")
src.backup(dst); dst.close(); src.close(); print("restore OK")
EOF
```

---

## 2. On-premises deployment (school's own PC)

### Windows (most schools)
1. Install Python 3 from python.org (tick **Add to PATH**).
2. Copy the `school_system` folder to the PC (e.g. `C:\ElimuPro`).
3. Double-click **`start-prod.bat`** — it installs dependencies, seeds the DB on
   first run, starts the **Waitress** production server, and opens the browser.
4. The server stays on while the window is open. For always-on:
   - **Task Scheduler** → Create Task → run `python3 run_production.py` at logon
   - (optional) install **nssm** to run it as a Windows service

### Linux on-premises
Same as the cloud steps 1.1–1.6 but on the school's box (can skip nginx/certbot if
it's only on the local network — visit `http://<school-pc-ip>:8000`).

---

## ☁️ Render.com quickstart (hosted web service)

This project is **Render-ready**: a fresh deploy auto-initialises the platform
(creates the registry, the `superadmin` account and a demo school), and the app
reads the `PORT` env var Render provides.

### 1. Deploy settings (Render dashboard → New → Web Service → your repo)
| Setting | Value |
|---|---|
| **Build command** | `pip install -r requirements.txt` |
| **Start command** | `gunicorn -w 2 -b 0.0.0.0:$PORT wsgi:application` |
| **Health check path** | `/` |
| **Instance type** | Free or Starter is fine to begin |

### 2. Super admin login
Open your Render URL (e.g. `https://school-system-xxxx.onrender.com`) and log in with
**`superadmin` / `admin123`** → the **Schools** page lets you add client schools.
School admins log in at the same URL; when you add a custom domain later, each
school uses its own subdomain (see multi-school section).

### 3. ⚠️ Persistent data (REQUIRED before real use)
Render's filesystem is **ephemeral** — every redeploy erases `school.db`, `meta.db`,
uploads and backups, and the app would recreate an empty demo. Fix it with a
**Persistent Disk**:
1. Render → your service → **Disks** → **Add Disk**
2. Mount path: **`/opt/render/project/src`** (Render's working directory for web services)
3. Size: e.g. 1 GB (free tier supports 1 GB)
4. Redeploy once — from then on, databases, photos and backups survive deploys.

### 4. Better option: PostgreSQL (managed, free-tier)
For real production, move the databases to Render's managed **PostgreSQL** and point
the app at `DATABASE_URL`. (SQLite still works fine on a Persistent Disk for small
schools — Postgres is for scale/backups.)

### 5. Environment variables
| Variable | Value |
|---|---|
| `ELIMUPRO_SECRET` | a long random string — `python3 -c "import secrets;print(secrets.token_hex(32))"` |
| `ELIMUPRO_HTTPS` | `1` (Render serves HTTPS) |

### 6. Backups on Render
Add a **Cron Job** (Render) running `python3 backup.py --keep 30` daily, or rely on
the Persistent Disk. Either way, back `backups/` off-server regularly.

## 3. Security notes (what changed from the demo)

- **Password hashing**: scrypt (salted, memory-hard) — legacy SHA-256 hashes are
  auto-upgraded on next login. Stored as `scrypt$salt$hash`.
- **Login rate limiting**: 5 failed attempts per username/IP in 15 min → 429 block.
- **Secret key**: loaded from `ELIMUPRO_SECRET` env (or generated `.secret_key` file).
- **Session cookies**: HttpOnly + SameSite=Lax; Secure when `ELIMUPRO_HTTPS=1`.
- **Security headers**: `X-Content-Type-Options`, `Referrer-Policy`, HSTS (HTTPS only).
- **Production webservers**: Waitress (cross-platform) or gunicorn (Linux) instead of
  Flask's dev server.

### Still to do for a fully hardened public service (with a real client)
- Register with the **ODPC** as a data controller under the Kenya Data Protection
  Act 2019 (schools hold minors' data) and include a data-processing clause in your
  contract.
- **M-Pesa Daraja STK-push** + **Africa's Talking SMS** with real credentials.
- Put the app behind a firewall; keep `backups/` out of the web root (it already is).
- Add per-school isolation (`school_id`) when you host more than one school (multi-tenant).

---

## 4. Backups & restore cheat sheet

```bash
# manual backup
python3 backup.py

# restore (overwrite school.db from a backup)
python3 - <<'EOF'
import sqlite3
b=sqlite3.connect("backups/school_20260811_023000.db"); d=sqlite3.connect("school.db")
b.backup(d); d.close(); b.close(); print("restored")
EOF
```

---

## 5. Going live checklist for a paying school

- [ ] Server/PC secured, secret key set, HTTPS on public deployments
- [ ] School's real name, logo, motto set (Settings → School)
- [ ] `seed.py` data replaced by the school's own data (use the CSV/Excel import)
- [ ] M-Pesa Paybill/Till + SMS configured (integration stage)
- [ ] ODPC registration + contract signed
- [ ] Backups verified + support contact (WhatsApp) agreed
