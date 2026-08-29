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

## 🏫 Multi-school (sell to several schools from one server)

The platform supports **multiple schools on one installation**, each fully isolated:

- **Platform admin** — log in at the root domain with `superadmin` / `admin123` →
  **Schools** page lists every school and lets you **add a school** (sample data or a
  fresh empty school, with a custom admin username/password).
- **Each school = its own database** (`data/school_<slug>.db` + a `meta.db` registry),
  so schools can never see each other's data.
- **Subdomain routing** — each school logs in through its own address:
  `greenfield.yourdomain.com`, `kisii-high.yourdomain.com`… every school can use
  `admin`/`admin123` without clashes.
- **Per-school branding** is automatic (name, logo, theme live in each school's DB).
- **Disable a school** (unpaid subscription?) → all its logins are blocked instantly.
- **Backups cover every school** — `backup.py` backs up `meta.db` + each school DB.
- **One-click launch** — `python3 launch_school.py --name "..." --slug ... [--empty --motto ... --logo ...]`
  creates + brands a school, generates a strong admin password, and writes a client
  handover sheet (`launch_sheets/<slug>_handover.txt`).

### Subdomain setup (cloud)
1. DNS: add a **wildcard record** `*.yourdomain.com` → your server IP.
2. nginx: `server_name *.yourdomain.com;` with a wildcard Let's Encrypt cert
   (`certbot --nginx -d yourdomain.com -d *.yourdomain.com`).
3. New schools created in the **Schools** page immediately work at `<slug>.yourdomain.com`.

### Local testing without a domain
Use the `Host` header or `/etc/hosts`:
```
127.0.0.1  greenfield.localhost kisii-high.localhost
```
then visit `http://kisii-high.localhost:8000`.

## ☁️ Render.com quickstart (hosted web service)

Render-ready: a fresh deploy auto-initialises the platform (`superadmin`, demo school).

| Setting | Value |
|---|---|
| **Build command** | `pip install -r requirements.txt` |
| **Start command** | `gunicorn -w 2 -b 0.0.0.0:$PORT wsgi:application` |
| **Health check** | `/` |

1. **Super admin**: open your Render URL and log in with `superadmin` / `admin123`.
2. **⚠️ Persistent Disk (REQUIRED)**: Render's filesystem is ephemeral — add a
   **Disk** mounted at **`/opt/render/project/src`** (1 GB on free tier) or every
   redeploy wipes databases/uploads.
3. **Env vars**: `ELIMUPRO_SECRET` (long random string) and `ELIMUPRO_HTTPS=1`.
4. **Backups**: add a Render **Cron Job** running `python3 backup.py --keep 30` daily.

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
