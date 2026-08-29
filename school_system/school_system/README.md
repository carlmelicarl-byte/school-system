# 🏫 ElimuPro — School Management System

A complete, professional school management platform modelled on **Zeraki** (Analytics, Finance) and **SmartShule** — built for the Kenyan school system using the **current Competency-Based Curriculum (CBC)**. Runs locally with **Flask + SQLite** and a modern web dashboard. No external services required.

### 📚 The Kenyan CBC curriculum, built in
- **Subject sets per grade band**: Lower Primary (Grade 1–3), Upper Primary (Grade 4–6), Junior Secondary (Grade 7–9) and Senior Secondary (Grade 10–12) — e.g. Grade 1 takes English, Kiswahili, Mathematics, Environmental Activities, Hygiene & Nutrition, Movement & Creative Activities and CRE; Grade 7–9 adds Integrated Science, Social Studies, Business Studies, Pre-Technical & Pre-Career Studies, Health Education, Life Skills and PE & Sports; Grade 10–12 adds Biology, Chemistry, Physics, Geography, History & Government and Computer Science
- **CBC achievement-level grading in every grade** (primary, junior secondary and senior secondary): **E** = Exceeding Expectations (80%+), **M** = Meeting Expectations (65%+), **A** = Approaching Expectations (50%+), **B** = Below Expectations (<50%)
- Marks entry, analytics, report cards and the parent portal all grade automatically with the E/M/A/B levels

---

## ▶️ Run it

```bash
cd school_system
pip install flask          # only dependency
python3 seed.py            # initialise the database with sample school data
python3 app.py             # start server → http://localhost:8000
```

### Default accounts (create your own in Settings → Users)

| Role          | Username        | Password      | Access |
|---------------|-----------------|---------------|--------|
| Administrator | `admin`         | `admin123`    | Full system |
| Teacher       | `teacher`       | `teacher123`  | Academics, marks, attendance, transport register |
| Accounts      | `accounts`      | `accounts123` | Finance & fee management only (students read-only) |
| Librarian     | `librarian`     | `librarian123`| Library — books, issues & returns |
| Parent        | **phone number**| `parent123`   | Parent portal — own children only |

Parent accounts are created automatically from student records: username = the parent's phone number (no spaces), initial password `parent123`. Change passwords after first login via **My Account** (click your name in the top-right).

> One guardian account per unique phone number — if a parent has several children at the school, they share one login and switch between children in the portal.

---

## ✨ Modules

### 📊 Dashboard
- Personalised **welcome banner** with quick actions (add student, record payment, enter marks, announce)
- **Needs attention** list — unplaced students, open exams, critical fee balances — role-aware
- Live **activity feed** (audit trail of everything that happens in the school)
- Fee collection: year & term billed / collected / arrears, per-class bars
- Latest exam performance, grade distribution, subject & class means, trend across terms
- Transport summary, recent payments, announcements

### 👨‍🎓 Students
- Full admission records with **profile pictures**
- Add / edit / view profile, class placement, parent contacts, fee summary, payment history, transport route
- **Bulk CSV import** (paste rows: name, gender, class, parent) with a per-line error report
- **Class promotion** — move an entire class to the next grade; the source class is left **completely empty** (all three terms reassigned) so it is ready for a fresh intake with no mix-ups
- Per-student performance snapshot → **Report Card** / **Analytics** shortcuts
- Search, filters, CSV export

### 👩‍🏫 Teachers · 🏛 Classes · 📚 Subjects
- Teacher registry (TSC no, subject, phone, email, employment type, **photo**)
- **Classes from Grade 1 to Grade 12** — add, **edit** (name, grade, stream, capacity, class teacher) or **remove** a class (removal cleans up its timetable, fee structures, enrollments & attendance)
- Class streams with class teacher and capacity usage
- Subjects with categories and subject teachers

### 📝 Exams & Marks Entry
- Create exams by term; open/close status
- Spreadsheet-style marks entry per class — live mean & grade, dirty-change tracking, bulk save
- **Automatic CBC grading**: subjects adapt to the class; every grade uses the CBC achievement levels (E / M / A / B)

### 📈 Analytics
- Overall mean, top student, best class, grade distribution, gender performance
- Subject means (high/low), class comparison, performance trend
- Top-10 leaderboard + searchable full results, CSV export
- Per-student: subject breakdown vs class mean, class rank, trend

### 🖨 Report Cards
- Printable A4 report card with school logo, grades, points, mean grade, class position, signatures → **Print / save as PDF**
- **Per-student teacher comments** — saved per exam and shown on the printed card

### 🕐 Timetable *(Zeraki Timetable–style)*
- Weekly **class timetable**: 8 periods × 5 days with break rows, subject badges & teacher names
- **Teacher timetable** view with weekly teaching load per teacher
- Click-any-cell assignment with automatic subject-teacher allocation
- **Conflict detection** — a teacher can never be double-booked in two classes at the same slot (server-enforced); conflicting cells highlighted red
- Printable grids

### 💰 Finance & Fees *(Administrator + Accounts)*
- **Payment types** — every payment is categorised (Tuition Fees, Transport, Examination Fee, Uniform, Library, Sports…); administrators can **add any payable item** with a category and default amount, and activate/deactivate them
- Per-class fee structures per term; **transport fees auto-added** for route riders
- Student fee ledger: billed / paid / balance, Cleared / Partial / Critical status
- Record **or edit** payments — choose payment type, M-PESA / Cash / Bank / Cheque, auto receipt numbers
- **Auto-split payments**: one payment is automatically applied across terms & items (oldest term first, transport then tuition) with a receipt showing the full breakdown; excess goes to a Prepayment bucket — works in the staff form and the parent portal
- **Balance tracker everywhere**: the staff fee ledger shows a per-student payment-progress bar, and the staff statement has a per-term tracker; the parent portal tracks the balance after every receipt
- **Collections by payment type** charts (amount + count per type)
- **Professional printable receipts** with school badge/logo, receipt number, payment type, amount in words, balance, signature lines — auto-opens after every payment, re-printable and editable from the payments list
- Itemised statements (Tuition + Transport per term), SMS fee reminders to parents in arrears

### 🚌 Transport
- Routes with drivers, capacity, pickup/drop-off times and **per-term fees**
- Rider assignments with a **live search bar** (search any student by name or admission number; selections survive while typing)
- Daily boarding register (morning / evening, Boarded / Not Boarded / Excused)
- Route summaries + monthly transport fee totals

### 📅 Attendance
- Daily class register (Present / Absent / Late / Permission), one-click marking
- Year-to-date summary with daily rates

### 📣 Communication
- Announcements published to parents & staff with SMS queue
- Message centre: fee reminders + announcement SMS log with delivery status

### ⚙️ Settings
- **School** — name, motto, address, contacts, academic year, term, **term dates**, currency, **logo upload**
- **Appearance** — 6 colour themes / wallpapers, font family (Modern / Humanist / Serif / Mono), base font size — applied instantly
- **Users** — create accounts (Administrator / Teacher / Accounts), reset passwords, activate/deactivate
- **SMS Gateway** — provider configuration (Africa's Talking, Daraja, Twilio, Infobip)

### ✨ Craft & polish
- **Activity feed / audit trail** on the dashboard records every key action (admissions, payments, imports, promotions, announcements…)
- Skeleton loading screens, friendly empty states, toast notifications with icons
- **Esc** closes modals; role-aware menus and alerts; version footer

### 🛡️ Discipline & Conduct *(CBC holistic development)*
- Track **merits & demerits** per student with categories (Academic Excellence, Punctuality, Community Service… / Late Coming, Truancy, Noise Making…) and descriptions
- **Searchable student picker** by name or admission number when recording
- Per-term **conduct rating** — Excellent / Good / Satisfactory / Needs Improvement — from net merits
- Conduct summary shows on the **dashboard**, on **report cards** (conduct line + rating) and in the **parent portal** so parents see behavioural progress — exactly what CBC holistic education expects
- Teachers and admins record; admin can delete; other roles read-only (server-enforced)

### 🪪 Student ID Cards
- **Professional ID card generator** with all the credentials a school card needs:
  - **Front**: school crest/logo + name + motto, student photo, full name, admission number, class, house (Simba/Chui/Nyati/Tembo), blood group, gender, DOB — plus a printed **card number**, a **barcode**, the **Principal's signature** line and a **validity year**
  - **Back**: guardian name, contact phone, home address, school contacts and a "if found, return to school office" note with barcode
- Search any student by **name or admission number** (or pick a class) and preview both sides live
- **Print one card** or **print a whole class** — printing outputs only the cards (app hidden), two cards per sheet
- New student fields: **house** and **blood group** (shown on the card, the profile and the edit form)

### 📅 School Events & Calendar
- Full **school calendar**: games days, parent meetings, midterm breaks, exam dates, prize giving — with category, audience and description
- Upcoming events shown on the **dashboard** and in the **parent portal** (read-only)
- Admins create / edit / remove events; other staff view

### 📚 Library (Librarian role)
- **Book catalogue** — 30+ real books (set books, CBC textbooks, fiction, reference) with title, author, ISBN, publisher, category, shelf location and copy counts; add / edit / remove with a live **Available / Low / All out** status
- **Issue & return** — the librarian issues a book to any student (due date defaults to 14 days), which decrements the available copies; returning restores them automatically
- **Overdue tracking** — issue records flag **Overdue** automatically and show how long they're overdue
- **Issue history** — every borrow/return with dates, status and the librarian who processed it; filter by status
- **Librarian account** — `librarian` / `librarian123` — manages the library; teachers can view the catalogue; other roles are blocked (server-enforced)
- Dashboard shows total books, issued and overdue counts

### 📝 Homework & Assignments *(new)*
- Teachers assign homework per class & subject with descriptions and due dates; overdue assignments are flagged automatically
- Staff Homework page with class/subject/status filters; parents see their child's assignments (upcoming + overdue) in the portal
- Dashboard shows upcoming homework due across the school

### ✨ Polish pack *(new)*
- **Ctrl+K global search** — search students, teachers and books from anywhere, or jump straight to any page (works with ⌘K on Mac)
- **Excel export** — one-click .xlsx downloads for Students, exam Results, the fee ledger, Library books (CSV still available)
- **Events calendar month view** — switch between the list and a month grid on the Events page
- **SMS message templates** — fee reminder, results-out, attendance alert, meeting notice, holiday notice — prefill the announcement box instantly

### 📶 Offline & online mode (auto-sync)
- A **service worker** caches the app shell and your data, so the system keeps working **offline** — you can view everything you've already loaded (students, results, fees, timetables…)
- A live **Online / Offline pill** in the top bar and an offline banner tell you the connection state
- Any change you make while offline (payments, marks, attendance, announcements…) is **saved locally in a sync queue**
- When you're back online the system **auto-updates itself**: it flushes the queued changes to the server, then refreshes the current view automatically
- Works on your own machine (localhost or any HTTPS deployment); the sandboxed chat preview may block the service worker, in which case the UI still works and the queue still applies

### 👤 My Account (all roles)
- Upload your own profile picture (shown in the top bar)
- Change your password

### 👨‍👩‍👧 Parent Portal
- **Sign in with your phone number** — one account per parent, linked to all their children
- **Admins create parents in Settings → Users** (search bar included): add a parent manually, then **link two or more children** — those children share the same login and portal, with a child switcher to view each child's results, fees, transport, attendance and conduct. Manage a parent's children any time with the 👥 button
- **My Dashboard** — latest exam mean & grade, class position, fee balance, transport route, attendance snapshot, announcements
- **Results** — full subject-by-subject results with grades, points, class mean and rank; printable
- **Fees & Payments** — a **fee balance tracker**: big outstanding-balance display with an overall payment progress bar, a **per-term breakdown** (billed / paid / balance with progress bars), itemised billing, and a payment history that shows the **balance remaining after each payment** — plus **pay via M-PESA** (simulated STK push, receipt generated instantly)
- **Transport** — assigned route, driver, pickup times, fee and boarding record
- **Attendance** — recent school days with status and attendance rate
- **Announcements** — school news, read-only
- Data is **strictly scoped**: a parent can only ever see their own children (enforced server-side); staff data is off-limits

---

## 🗂 Tech & architecture

```
school_system/
├── app.py            # Flask backend — REST API, role-based auth, analytics & billing engine
├── seed.py           # schema + realistic sample data generator
├── school.db         # SQLite database (auto-created by seed.py)
├── templates/index.html
└── static/
    ├── css/style.css # design system, themes, print styles
    ├── js/app.js     # SPA: routing, 15 views, SVG charts (no CDN)
    └── uploads/      # profile pictures & logos (auto-created)
```

- **No internet/CDN needed** — charts are hand-drawn SVG, fonts are system stacks
- **Role-based access enforced server-side** (Administrator / Teacher / Accounts)
- Token + cookie authentication — works in normal browsers and embedded previews
- REST API is ready to plug into real integrations (M-Pesa Daraja STK push, Africa's Talking SMS)

## 🔌 Real-world upgrades (next steps)
- **M-Pesa Daraja API** — live STK-push payments instead of manual recording
- **Africa's Talking SMS** — connect the gateway for real message delivery
- Multi-school tenancy (`school_id`) for a Zeraki-style SaaS deployment
- Parent mobile portal

## 🚀 Selling & deploying it (production pack)

The project now ships with a full **production & security pack** so you can take it to a real school:

- **Two deployment paths** — see **[DEPLOY.md](DEPLOY.md)**: cloud (gunicorn + nginx + HTTPS + certbot + systemd) or **on-premises** (school's own PC via `start-prod.bat` / `run_production.py` with Waitress)
- **Production webservers** — `run_production.py` (Waitress, cross-platform) and `wsgi.py` (gunicorn on Linux) replace the dev server
- **Security hardened** — salted **scrypt** password hashing (legacy SHA-256 auto-upgraded on login), **login rate-limiting** (5 fails / 15 min → 429), secret key from `ELIMUPRO_SECRET` env or generated file, HttpOnly/SameSite cookies, HTTPS cookie + HSTS flags, security headers
- **Automated backups** — `backup.py` (online-consistent SQLite backup, keeps 30 days) + systemd timer for cloud, Task Scheduler steps for on-premises

- **Windows on-prem launcher** — `start-prod.bat` installs deps, seeds, and serves in production mode

Typical Kenyan market pricing for context: cloud subscriptions ~KES 50k–120k/yr (small schools) to 250k–400k+ (large), or term-based ~KES 30k–50k, plus a one-time setup fee.

## 🔐 Security notes

Demo secret key and SHA-256 password hashes suit a local deployment. For production: rotate the secret key via environment variable, use HTTPS, and consider bcrypt/argon2 hashing.
