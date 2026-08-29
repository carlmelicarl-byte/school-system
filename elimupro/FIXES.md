# 🔧 ElimuPro — Error Report & Corrections

Audit of the uploaded project (frontend + configs + docs) and every correction applied.
The corrected project lives in this folder; your original files are untouched in `uploads/`.

```
elimupro/
├── FIXES.md                                  ← this report
├── README.md                                 ← corrected
├── DEPLOY.md                                 ← unchanged (see “missing files” below)
├── requirements.txt                          ← OK as-is
├── deploy/nginx.conf                         ← corrected
├── clients/                                  ← the two handover sheets (no errors found)
└── school_system/
    ├── templates/index.html                  ← corrected (SVG sprite, cache-bust v32)
    └── static/
        ├── css/style.css                     ← no errors found (braces/Selectors verified)
        ├── js/app.js                         ← 11 corrections (incl. 1 show-stopper)
        ├── sw.js                             ← corrected (pre-cache list, cache v17)
        └── uploads/                          ← sample profile pics
```

---

## 🔴 Show-stopper (app could not start)

### 1. `enterApp()` was called but never defined — `app.js`
`doLogin()` and `boot()` both call `enterApp()` after authentication, but the function had
been dropped from the file. Result: **every successful login threw
`ReferenceError: enterApp is not defined` and the app froze on the login screen** — for
every role, on every browser.
**Fixed:** re-implemented `enterApp()` (placed next to `showLogin()`). It hides the login
screen, shows the app shell, renders the role-aware nav, fills the user chip / sidebar
school name / term badge / version tag, applies the theme, restores the offline
sync-queue counter, clears cached per-user data and opens the correct landing view per
role (`guardian → gdash`, `librarian → library`, `superadmin → schools`, staff →
`dashboard`).

---

## 🟠 Functional bugs fixed

### 2. Parent portal crashed for fully-paid parents — `app.js` (`view_gfees`)
`$("#gp-pay").addEventListener(...)` ran unconditionally, but the **Pay via M-PESA**
button is only rendered when `balance > 0`. Any parent whose fees were cleared got
`TypeError: Cannot read properties of null` instead of the “All fees are cleared!” screen.
**Fixed:** null-guarded binding (`const gpayBtn = $("#gp-pay"); if (gpayBtn) …`).

### 3. Offline mode never worked — `sw.js`
The pre-cache list included `"/static/sw.js"`, but the worker is registered from `/sw.js`
(root scope). `caches.addAll()` fails **atomically** if any URL 404s, so the whole app
shell was never cached — offline mode silently did nothing.
**Fixed:** shell now lists `/sw.js`; cache bumped `elimupro-v16 → v17` and asset URLs to
`?v=32` so existing clients pick up the fixed build.

### 4. Five icons never rendered (incl. offline banner & Timetable) — `templates/index.html`
The SVG sprite was closed too early: `</svg>` appeared after `i-upload2`, leaving
`i-card`, `i-barcode`, `i-wifi`, `i-timetable` and `i-receipt` **outside** any `<svg>`
element with a stray `</svg>` at the end. Browsers dropped them, so the offline banner
icon, Timetable nav icon, ID-card/receipt buttons etc. rendered blank.
**Fixed:** all 36 symbols are now inside one sprite (verified: 32 balanced `<svg>` tags,
no duplicate ids).

### 5. Esc didn’t close the Ctrl+K palette — `app.js`
The palette’s own footer says “Esc close”, but the global Escape handler only closed
modals. **Fixed:** Escape now closes the palette first if it is open.

### 6. Conduct summary always rated everyone “Good” — `app.js` (`view_discipline`)
The “Conduct summary” table hardcoded `CONDUCT_STYLES["Good"]` / `"Good"` for every row.
**Fixed:** added `conductRating(merits, demerits)` (net ≥ 5 Excellent · ≥ 1 Good · ≥ −2
Satisfactory · else Needs Improvement) and the badge is now computed per student.

### 7. CBC grade colours inverted on the dashboard — `app.js` (`view_dashboard`)
Grade-distribution bars used the old A/B/C/D palette, so under CBC **E (Exceeding) drew
red and B (Below) drew green**. **Fixed:** shared `CBC_COLORS` map (E green · M blue ·
A amber · B red), also reused by the legend and Analytics chart.

### 8. One parent’s children could appear for the next user — `app.js`
`state.gchildren` / `state.guardianChild` (and cached students/classes) survived logout
and login, so a parent’s child list could surface for the next person on the same
browser. **Fixed:** caches cleared on `enterApp()` and on logout.

---

## 🟡 Code hygiene / dead code removed

9. **Duplicate `view_events`** — the file contained two definitions (list-only version +
   the newer List/Calendar version). The old one was dead but confusing; removed.
10. **Duplicate `saveRemember`** — declared twice; removed the second copy.
11. **Doubled `spawnParticles()` call** — the login particles were spawned twice
    back-to-back; one call removed.
12. **`gradeClass(mg, dScale)`** — called with an argument the function doesn’t take;
    cleaned to `gradeClass(mg)`.
13. **My Account role labels** — Librarian / Parent / Platform Admin showed as raw
    slugs; added friendly labels.

## 🟡 Deployment config

14. **`deploy/nginx.conf`: upload size limit missing** — photos/logos are POSTed as
    base64 JSON, and nginx’s default `client_max_body_size 1m` would return **413** for
    any image over ~750 KB even though the UI allows 4 MB. Added `client_max_body_size 10m;`.
15. **`deploy/nginx.conf`: deprecated `listen 443 ssl http2;`** — warns on nginx ≥ 1.25.1.
    Changed to `listen 443 ssl;` + `http2 on;` (with a note for older nginx).

## 🟡 Documentation (`README.md`)

16. “Run it” said `pip install flask  # only dependency` — wrong: Excel export needs
    `openpyxl` and production needs `waitress`/`gunicorn`. Now points at
    `requirements.txt`.
17. Architecture tree omitted `static/sw.js`; corrected (also noted it’s served at `/sw.js`).
18. The “Security notes” section contradicted the production pack above it (it described
    the legacy demo SHA-256 setup as current). Rewritten to match the scrypt/rate-limit/secret-key reality.

---

## ✅ Verified after fixing

- `node --check` passes for `app.js` and `sw.js`; CSS braces/selectors balanced; HTML SVG
  structure balanced, 36 unique icons.
- Zero remaining top-level duplicate functions; all 52 `onclick`-referenced handlers exist.
- Headless DOM test-suite run against the real `index.html` + `app.js`:
  login screen boots, `enterApp()` lands each role on the right view
  (admin/teacher/accounts → Dashboard, guardian → My Dashboard, librarian → Library,
  superadmin → Schools), nav renders 20 staff items / 8 portal items, Esc closes the
  palette, receipts group & split correctly, ID card/receipt/amount-in-words render,
  Dashboard renders with data, and the parent Fees page works with **and** without an
  outstanding balance (the old crash case).

## ⚠️ Not errors, but worth knowing

- **Missing files:** the upload did not include the backend the docs reference —
  `app.py`, `seed.py`, `wsgi.py`, `run_production.py`, `backup.py`, `start-prod.bat`,
  `deploy/elimupro.service`, `deploy/elimupro-backup.service` + `.timer`, and `school.db`.
  Nothing above could be checked against the server. If you have them, upload them and
  I’ll audit those too; if not, I can rebuild them from the 74 API endpoints the frontend
  calls.
- `feeStructureForm()` infers each class’s existing fee structure from the *first
  student’s* statement (N+1 requests, and empty classes show blank) — works, but fragile;
  a dedicated `GET /api/finance/structure` would be the clean fix (backend change).
- Attendance summary hardcodes the year start (`2026-01-01`) — fine for this year, will
  need updating in 2027 (backend or a small frontend tweak).
- Version bump `v31 → v32` is deliberate (the service worker caches old assets
  cache-first); users get the fixed build automatically after a refresh.
