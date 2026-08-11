# 🏫 ElimuPro — School Management System

A complete, professional school management platform modelled on **Zeraki** (Analytics, Finance) and **SmartShule** — built for the Kenyan school system (CBC Junior Secondary + KCSE-style grading). Runs locally with **Flask + SQLite** and a modern web dashboard. No external services required.

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
- **Class promotion** — move an entire class to the next grade in one click
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
- KCSE 12-point grading: A (80+) → A- → B+ → … → E

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
- **Collections by payment type** charts (amount + count per type)
- **Professional printable receipts** with school badge/logo, receipt number, payment type, amount in words, balance, signature lines — auto-opens after every payment, re-printable and editable from the payments list
- Itemised statements (Tuition + Transport per term), SMS fee reminders to parents in arrears

### 🚌 Transport
- Routes with drivers, capacity, pickup/drop-off times and **per-term fees**
- Rider assignments (bulk tick from any class; one route per student)
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

### 👤 My Account (all roles)
- Upload your own profile picture (shown in the top bar)
- Change your password

### 👨‍👩‍👧 Parent Portal
- **Sign in with your phone number** — one account per parent, linked to all their children
- **My Dashboard** — latest exam mean & grade, class position, fee balance, transport route, attendance snapshot, announcements
- **Results** — full subject-by-subject results with grades, points, class mean and rank; printable
- **Fees & Payments** — itemised statement (tuition + transport per term), payment history with receipts, and **pay via M-PESA** (simulated STK push, receipt generated instantly)
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

## 🔐 Security notes
Demo secret key and SHA-256 password hashes suit a local deployment. For production: rotate the secret key via environment variable, use HTTPS, and consider bcrypt/argon2 hashing.
