#!/usr/bin/env python3
"""
ElimuPro School Management System — backend
A professional Zeraki / SmartShule-style school platform:
academics, analytics, finance, transport, attendance and communication.

Flask + SQLite, zero external services. Role-based access:
  admin    -> everything
  teacher  -> academics, marks, attendance, transport register
  accounts -> finance & fee management only (students read-only)
"""
import os
import re
import base64
import sqlite3
import datetime
import hashlib
import functools
import secrets
from flask import (Flask, g, jsonify, request, session, send_from_directory,
                   render_template)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "school.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")

app = Flask(__name__)
app.secret_key = "elimupro-secret-key-change-in-production"
app.config["JSON_SORT_KEYS"] = False

# In-memory bearer tokens: login returns a token that works even in sandboxed
# preview iframes where cookies are blocked. Token -> user id.
AUTH_TOKENS = {}

# ------------------------------------------------------------------ helpers
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db

@app.teardown_appcontext
def close_db(exc):
    d = g.pop("db", None)
    if d is not None:
        d.close()

def q(sql, args=()):
    return db().execute(sql, args).fetchall()

def q1(sql, args=()):
    return db().execute(sql, args).fetchone()

def exe(sql, args=()):
    cur = db().execute(sql, args)
    db().commit()
    return cur.lastrowid

def rows_to_dicts(rows):
    return [dict(r) for r in rows]

def phash(p):
    return hashlib.sha256(p.encode()).hexdigest()

def fmt_amount(n):
    s = settings_map()
    cur = s.get("currency", "KSh")
    return f"{cur} {float(n or 0):,.0f}"

def auth_user():
    """Current user row from cookie session or Bearer token."""
    if session.get("user_id"):
        return q1("SELECT * FROM users WHERE id=?", (session["user_id"],))
    hdr = request.headers.get("Authorization", "")
    if hdr.startswith("Bearer "):
        uid = AUTH_TOKENS.get(hdr[7:].strip())
        if uid:
            return q1("SELECT * FROM users WHERE id=?", (uid,))
    return None

def acting_name():
    u = auth_user()
    return u["full_name"] if u else "Admin"

def log_activity(action, detail=""):
    """Record an audit entry for the current user."""
    u = auth_user()
    try:
        exe("INSERT INTO activity_log(user_id,action,detail) VALUES(?,?,?)",
            (u["id"] if u else None, action, (detail or "")[:250]))
    except Exception:
        pass

def role_required(*roles):
    def deco(fn):
        @functools.wraps(fn)
        def wrap(*a, **kw):
            u = auth_user()
            if not u:
                return jsonify({"error": "Unauthorized"}), 401
            if u["role"] not in roles:
                return jsonify({"error": "Forbidden"}), 403
            return fn(*a, **kw)
        return wrap
    return deco

login_required = role_required("admin", "teacher", "accounts", "librarian")
any_required = role_required("admin", "teacher", "accounts", "guardian", "librarian")
admin_required = role_required("admin")
finance_required = role_required("admin", "accounts")
academic_required = role_required("admin", "teacher")
guardian_required = role_required("guardian")
library_required = role_required("admin", "librarian")

# ------------------------------------------------------------------ grading
# Kenyan CBC (Competency-Based Curriculum) grading — current system
#   Grades 1-9 (primary & junior secondary): CBC achievement levels
#   Grades 10-12 (senior secondary): KCSE 12-point scale (A-E)
CBC_BANDS = [
    (80, "E", "Exceeding Expectations", 4),
    (65, "M", "Meeting Expectations", 3),
    (50, "A", "Approaching Expectations", 2),
    (0,  "B", "Below Expectations", 1),
]
KCSE_BANDS = [
    (80, 12, "A"),  (75, 11, "A-"), (70, 10, "B+"), (65, 9, "B"), (60, 8, "B-"),
    (55, 7, "C+"),  (50, 6, "C"),   (45, 5, "C-"),  (40, 4, "D+"), (35, 3, "D"),
    (30, 2, "D-"),  (0, 1, "E"),
]

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
PERIODS = [
    {"n": 1, "start": "8:00", "end": "8:40"},
    {"n": 2, "start": "8:40", "end": "9:20"},
    {"n": 3, "start": "9:20", "end": "10:00"},
    {"n": 4, "start": "10:20", "end": "11:00"},
    {"n": 5, "start": "11:00", "end": "11:40"},
    {"n": 6, "start": "11:40", "end": "12:20"},
    {"n": 7, "start": "13:20", "end": "14:00"},
    {"n": 8, "start": "14:00", "end": "14:40"},
]

def scale_for_grade(grade_str):
    """cbc for Grade 1-9 (primary & JSS), kcse for Grade 10-12 (senior)."""
    try:
        g = int(str(grade_str).split()[-1])
    except Exception:
        return "kcse"
    return "cbc" if g <= 9 else "kcse"

def grade_for(score, scale="kcse"):
    if score is None:
        return None, None
    if scale == "cbc":
        for lo, letter, _name, pts in CBC_BANDS:
            if score >= lo:
                return letter, pts
        return "B", 1
    for lo, pts, letter in KCSE_BANDS:
        if score >= lo:
            return letter, pts
    return "E", 1

def level_name(letter, scale="kcse"):
    if scale == "cbc":
        for _lo, l, name, _pts in CBC_BANDS:
            if l == letter:
                return name
    return letter

def mean_grade_from_points(avg_pts, scale="kcse"):
    if avg_pts is None:
        return "-"
    if scale == "cbc":
        if avg_pts >= 3.5: return "E"
        if avg_pts >= 2.5: return "M"
        if avg_pts >= 1.5: return "A"
        return "B"
    for lo, pts, letter in KCSE_BANDS:
        if avg_pts >= pts - 0.49:
            return letter
    return "E"

def subjects_for_grade(gnum):
    """Subjects taught in a given grade (CBC curriculum)."""
    rows = q("SELECT * FROM subjects")
    out = []
    for r in rows:
        try:
            gs = [int(x) for x in (r["grades"] or "").split(",") if x.strip().isdigit()]
        except Exception:
            gs = []
        if gnum in gs or not r["grades"]:
            out.append(r)
    return out

def settings_map():
    return dict((r["key"], r["value"]) for r in q("SELECT key,value FROM settings"))

def student_class(student_id, term=None):
    s = settings_map()
    term = term or s.get("current_term", "Term 3")
    r = q1("""SELECT c.* FROM enrollments e JOIN classes c ON c.id=e.class_id
              WHERE e.student_id=? AND e.term=? AND e.academic_year=? ORDER BY e.id DESC LIMIT 1""",
           (student_id, term, s.get("academic_year", "2026")))
    return dict(r) if r else None

def students_with_class(term=None):
    s = settings_map()
    term = term or s.get("current_term", "Term 3")
    year = s.get("academic_year", "2026")
    rows = q("""SELECT st.*, c.id AS class_id, c.name AS class_name, c.grade AS grade
                FROM students st
                LEFT JOIN enrollments e ON e.student_id=st.id AND e.term=? AND e.academic_year=?
                LEFT JOIN classes c ON c.id=e.class_id
                ORDER BY st.first_name""", (term, year))
    return rows_to_dicts(rows)

def exam_results(exam_id):
    rows = q("""SELECT student_id, COUNT(es.id) AS subjects,
                       SUM(es.points) AS total_points,
                       ROUND(AVG(es.score),1) AS mean,
                       ROUND(AVG(es.points),2) AS avg_pts
                FROM exam_scores es WHERE es.exam_id=?
                GROUP BY es.student_id""", (exam_id,))
    return {r["student_id"]: dict(r) for r in rows}

# ---------------------------------------------------------------- billing
def billing_rows(term=None, year=None, student_id=None, class_id=None):
    """Tuition + transport billed per student. Returns [(student_id, billed)]."""
    s = settings_map()
    term = term or s.get("current_term", "Term 3")
    year = year or s.get("academic_year", "2026")
    sql = """SELECT e.student_id,
                    fs.amount + COALESCE(tr.fee, 0) AS billed
             FROM enrollments e
             JOIN fee_structures fs
               ON fs.class_id=e.class_id AND fs.term=e.term AND fs.academic_year=e.academic_year
             LEFT JOIN transport_assignments ta
               ON ta.student_id=e.student_id AND ta.academic_year=e.academic_year AND ta.status='Active'
             LEFT JOIN transport_routes tr ON tr.id=ta.route_id
             WHERE e.term=? AND e.academic_year=?"""
    args = [term, year]
    if student_id:
        sql += " AND e.student_id=?"
        args.append(student_id)
    if class_id:
        sql += " AND e.class_id=?"
        args.append(class_id)
    rows = q(sql, args)
    return [(r["student_id"], r["billed"]) for r in rows]

def billed_for(student_id, term=None, year=None):
    rows = billing_rows(term=term, year=year, student_id=student_id)
    return rows[0][1] if rows else 0

def paid_for(student_id, term, year):
    return q1("""SELECT COALESCE(SUM(fp.amount),0) a FROM fee_payments fp
                 WHERE fp.student_id=? AND fp.term=? AND fp.payment_date LIKE ?""",
              (student_id, term, f"{year}-%"))["a"]

def finance_snapshot(term, year):
    classes = q("SELECT c.id, c.name FROM classes c WHERE c.academic_year=? ORDER BY c.name", (year,))
    class_rows, total_billed, total_paid = [], 0, 0
    for c in classes:
        billed = sum(b for sid, b in billing_rows(term=term, year=year, class_id=c["id"]))
        paid = q1("""SELECT COALESCE(SUM(fp.amount),0) a FROM fee_payments fp
                     WHERE fp.term=? AND fp.payment_date LIKE ?
                     AND fp.student_id IN (SELECT student_id FROM enrollments WHERE class_id=?)""",
                  (term, f"{year}-%", c["id"]))["a"]
        total_billed += billed
        total_paid += paid
        class_rows.append({"id": c["id"], "name": c["name"], "billed": billed, "paid": paid,
                           "arrears": billed - paid,
                           "rate": round(paid / billed * 100, 1) if billed else 0})
    return total_billed, total_paid, class_rows

# ------------------------------------------------------------------ pages
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory(os.path.join(BASE_DIR, "static"), path)

@app.route("/sw.js")
def service_worker():
    resp = send_from_directory(os.path.join(BASE_DIR, "static"), "sw.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return render_template("index.html"), 404

# ------------------------------------------------------------------ auth
@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(force=True) or {}
    u = q1("SELECT * FROM users WHERE username=? AND active=1", (data.get("username", "").strip(),))
    if not u or u["password_hash"] != phash(data.get("password", "")):
        return jsonify({"error": "Wrong password or username. Please check your details and try again."}), 401
    session["user_id"] = u["id"]
    session["role"] = u["role"]
    session["name"] = u["full_name"]
    token = secrets.token_hex(16)
    AUTH_TOKENS[token] = u["id"]
    return jsonify({"id": u["id"], "username": u["username"], "full_name": u["full_name"],
                    "role": u["role"], "teacher_id": u["teacher_id"],
                    "profile_pic": u["profile_pic"], "token": token})

@app.route("/api/logout", methods=["POST"])
def logout():
    hdr = request.headers.get("Authorization", "")
    if hdr.startswith("Bearer "):
        AUTH_TOKENS.pop(hdr[7:].strip(), None)
    session.clear()
    return jsonify({"ok": True})

@app.route("/api/me")
@any_required
def me():
    u = auth_user()
    return jsonify({"id": u["id"], "name": u["full_name"], "role": u["role"],
                    "username": u["username"], "profile_pic": u["profile_pic"],
                    "teacher_id": u["teacher_id"]})

# ------------------------------------------------------------------ users
@app.route("/api/users")
@admin_required
def list_users():
    rows = q("""SELECT u.id, u.username, u.full_name, u.role, u.active, u.profile_pic,
                       t.first_name, t.last_name
                FROM users u LEFT JOIN teachers t ON t.id=u.teacher_id
                ORDER BY u.role, u.username""")
    return jsonify(rows_to_dicts(rows))

@app.route("/api/users", methods=["POST"])
@admin_required
def add_user():
    d = request.get_json(force=True) or {}
    if not d.get("username") or not d.get("password") or not d.get("full_name"):
        return jsonify({"error": "username, password and full_name required"}), 400
    if d.get("role") not in ("admin", "teacher", "accounts"):
        return jsonify({"error": "Invalid role"}), 400
    try:
        uid = exe("INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)",
                  (d["username"].strip(), phash(d["password"]), d["full_name"].strip(), d["role"]))
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username already exists"}), 400
    log_activity("User created", f"{d['username']} ({d['role']})")
    return jsonify({"id": uid})

@app.route("/api/users/<int:uid>", methods=["PUT"])
@admin_required
def update_user(uid):
    d = request.get_json(force=True) or {}
    fields = ["full_name", "role", "active"]
    sets = [f for f in fields if f in d]
    if "role" in d and d["role"] not in ("admin", "teacher", "accounts"):
        return jsonify({"error": "Invalid role"}), 400
    if sets:
        exe("UPDATE users SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?",
            tuple(d[f] for f in sets) + (uid,))
    return jsonify({"ok": True})

@app.route("/api/users/<int:uid>/password", methods=["PUT"])
@admin_required
def reset_user_password(uid):
    d = request.get_json(force=True) or {}
    if not d.get("password"):
        return jsonify({"error": "password required"}), 400
    exe("UPDATE users SET password_hash=? WHERE id=?", (phash(d["password"]), uid))
    return jsonify({"ok": True})

@app.route("/api/me/password", methods=["PUT"])
@any_required
def change_my_password():
    d = request.get_json(force=True) or {}
    u = auth_user()
    if u["password_hash"] != phash(d.get("old", "")):
        return jsonify({"error": "Current password is incorrect"}), 400
    if not d.get("new"):
        return jsonify({"error": "New password required"}), 400
    exe("UPDATE users SET password_hash=? WHERE id=?", (phash(d["new"]), u["id"]))
    return jsonify({"ok": True})

# ------------------------------------------------------------------ uploads
@app.route("/api/upload/<kind>/<int:rid>", methods=["POST"])
@any_required
def upload_pic(kind, rid):
    u = auth_user()
    if kind == "user":
        if u["id"] != rid and u["role"] != "admin":
            return jsonify({"error": "Forbidden"}), 403
    elif kind in ("student", "teacher", "school"):
        if u["role"] != "admin":
            return jsonify({"error": "Forbidden"}), 403
    else:
        return jsonify({"error": "Invalid kind"}), 400

    data = (request.get_json(force=True) or {}).get("data", "")
    m = re.match(r"data:image/(png|jpe?g|gif|webp);base64,(.+)", data)
    if not m:
        return jsonify({"error": "Invalid image data"}), 400
    ext = {"png": "png", "jpg": "jpg", "jpeg": "jpg", "gif": "gif", "webp": "webp"}[m.group(1)]
    try:
        raw = base64.b64decode(m.group(2))
    except Exception:
        return jsonify({"error": "Invalid image data"}), 400
    if len(raw) > 4 * 1024 * 1024:
        return jsonify({"error": "Image too large (max 4MB)"}), 400
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    fname = f"{kind}_{rid}_{secrets.token_hex(4)}.{ext}"
    with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
        f.write(raw)
    path = f"/static/uploads/{fname}"
    if kind == "user":
        exe("UPDATE users SET profile_pic=? WHERE id=?", (path, rid))
    elif kind == "student":
        exe("UPDATE students SET profile_pic=? WHERE id=?", (path, rid))
    elif kind == "teacher":
        exe("UPDATE teachers SET profile_pic=? WHERE id=?", (path, rid))
    else:
        exe("INSERT INTO settings(key,value) VALUES('school_logo',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (path,))
    return jsonify({"path": path})

# ------------------------------------------------------------------ dashboard
@app.route("/api/dashboard")
@login_required
def dashboard():
    s = settings_map()
    term = s.get("current_term", "Term 3")
    year = s.get("academic_year", "2026")

    total_students = q1("SELECT COUNT(*) c FROM students WHERE status='Active'")["c"]
    total_teachers = q1("SELECT COUNT(*) c FROM teachers WHERE active=1")["c"]
    total_classes = q1("SELECT COUNT(*) c FROM classes WHERE academic_year=?", (year,))["c"]
    total_subjects = q1("SELECT COUNT(*) c FROM subjects")["c"]

    billed = sum(b for _, b in billing_rows(year=year)) * 3  # 3 terms per year
    billed = sum(b for _, b in [x for t in ("Term 1", "Term 2", "Term 3") for x in billing_rows(term=t, year=year)])
    paid = q1("""SELECT COALESCE(SUM(fp.amount),0) a FROM fee_payments fp
                 JOIN students st ON st.id=fp.student_id WHERE st.status='Active'
                 AND fp.payment_date LIKE ?""", (f"{year}-%",))["a"]

    paid_term = q1("""SELECT COALESCE(SUM(amount),0) a FROM fee_payments
                      WHERE term=? AND payment_date LIKE ?""", (term, f"{year}-%"))["a"]
    billed_term = sum(b for _, b in billing_rows(term=term, year=year))

    fee_breakdown = []
    for c in q("SELECT c.id, c.name FROM classes c WHERE c.academic_year=? ORDER BY c.name", (year,)):
        b = sum(x for _, x in billing_rows(year=year, class_id=c["id"])) * 3
        p = q1("""SELECT COALESCE(SUM(fp.amount),0) a FROM fee_payments fp
                  JOIN students st ON st.id=fp.student_id
                  JOIN enrollments e ON e.student_id=st.id AND e.academic_year=?
                  WHERE e.class_id=? AND fp.payment_date LIKE ?""", (year, c["id"], f"{year}-%"))["a"]
        fee_breakdown.append({"id": c["id"], "name": c["name"], "billed": b, "paid": p})

    att_today = q1("SELECT COUNT(*) c FROM attendance WHERE date=?", (datetime.date.today().isoformat(),))["c"]

    closed = q1("SELECT * FROM exams WHERE status='Closed' ORDER BY id DESC LIMIT 1")
    perf = None
    if closed:
        res = q("SELECT ROUND(AVG(score),1) mean FROM exam_scores WHERE exam_id=?", (closed["id"],))
        grade_dist = q("SELECT grade, COUNT(*) c FROM exam_scores WHERE exam_id=? GROUP BY grade", (closed["id"],))
        perf = {
            "exam_id": closed["id"], "exam_name": closed["name"], "term": closed["term"],
            "mean": res[0]["mean"] if res else 0,
            "grade_dist": {r["grade"]: r["c"] for r in grade_dist},
            "subject_means": rows_to_dicts(q("""SELECT su.id, su.name, ROUND(AVG(es.score),1) mean,
                                                       MAX(es.score) highest, MIN(es.score) lowest
                                                FROM exam_scores es JOIN subjects su ON su.id=es.subject_id
                                                WHERE es.exam_id=? GROUP BY su.id ORDER BY mean DESC""", (closed["id"],))),
            "class_means": rows_to_dicts(q("""SELECT c.id, c.name, ROUND(AVG(es.score),1) mean, COUNT(DISTINCT es.student_id) students
                                               FROM exam_scores es
                                               JOIN enrollments e ON e.student_id=es.student_id AND e.term=? AND e.academic_year=?
                                               JOIN classes c ON c.id=e.class_id
                                               WHERE es.exam_id=? GROUP BY c.id ORDER BY mean DESC""", (term, year, closed["id"]))),
        }

    recent_payments = rows_to_dicts(q("""SELECT fp.*, st.first_name, st.last_name, st.admission_no
                                         FROM fee_payments fp JOIN students st ON st.id=fp.student_id
                                         ORDER BY fp.payment_date DESC, fp.id DESC LIMIT 6"""))
    recent_ann = rows_to_dicts(q("SELECT * FROM announcements ORDER BY id DESC LIMIT 4"))
    active_exam = q1("SELECT * FROM exams WHERE status='Open' ORDER BY id DESC LIMIT 1")

    # transport summary for dashboard
    tr_summary = {
        "routes": q1("SELECT COUNT(*) c FROM transport_routes WHERE status='Active'")["c"],
        "assigned": q1("SELECT COUNT(*) c FROM transport_assignments WHERE status='Active' AND academic_year=?", (year,))["c"],
        "boarded_today": q1("SELECT COUNT(*) c FROM transport_log WHERE date=? AND status='Boarded'",
                            (datetime.date.today().isoformat(),))["c"],
        "monthly_fees": q1("""SELECT COALESCE(SUM(tr.fee),0) a FROM transport_assignments ta
                              JOIN transport_routes tr ON tr.id=ta.route_id
                              WHERE ta.status='Active' AND ta.academic_year=?""", (year,))["a"],
    }

    # attention list — things that need action
    unplaced = q1("""SELECT COUNT(*) c FROM students st
                     WHERE st.status='Active' AND NOT EXISTS (
                       SELECT 1 FROM enrollments e
                       WHERE e.student_id=st.id AND e.term=? AND e.academic_year=?)""",
                  (term, year))["c"]
    open_exams = q1("SELECT COUNT(*) c FROM exams WHERE status='Open'")["c"]
    critical = 0
    for st in students_with_class(term):
        b = billed_for(st["id"], term, year)
        p = paid_for(st["id"], term, year)
        if b and (b - p) >= b * 0.5:
            critical += 1
    role = auth_user()["role"]
    alerts = []
    if role != "accounts":
        alerts.append({"icon": "i-users", "label": "Unplaced students", "value": unplaced, "view": "students",
                       "tone": "amber" if unplaced else "green"})
        alerts.append({"icon": "i-exam", "label": "Open exam in progress", "value": open_exams, "view": "exams",
                       "tone": "blue" if open_exams else "green"})
    alerts.append({"icon": "i-money", "label": "Critical fee balances", "value": critical, "view": "finance",
                   "tone": "red" if critical else "green"})
    feed = rows_to_dicts(q("""SELECT a.*, u.full_name user_name, u.role user_role
                              FROM activity_log a LEFT JOIN users u ON u.id=a.user_id
                              ORDER BY a.id DESC LIMIT 8"""))

    lib = {
        "total_titles": q1("SELECT COUNT(*) c FROM books")["c"],
        "issued": q1("SELECT COUNT(*) c FROM book_issues WHERE status IN ('Issued','Overdue')")["c"],
        "overdue": q1("SELECT COUNT(*) c FROM book_issues WHERE status='Overdue'")["c"],
    }
    return jsonify({
        "settings": s,
        "library": lib,
        "alerts": alerts,
        "activity": feed,
        "counts": {"students": total_students, "teachers": total_teachers,
                   "classes": total_classes, "subjects": total_subjects},
        "finance": {"billed": billed, "paid": paid, "arrears": billed - paid,
                    "billed_term": billed_term, "paid_term": paid_term,
                    "arrears_term": billed_term - paid_term, "class_breakdown": fee_breakdown},
        "attendance_today": att_today,
        "performance": perf,
        "transport": tr_summary,
        "active_exam": dict(active_exam) if active_exam else None,
        "recent_payments": recent_payments,
        "recent_announcements": recent_ann,
        "term": term, "year": year,
    })

# ------------------------------------------------------------------ students
@app.route("/api/students")
@login_required
def list_students():
    q_ = request.args.get("q", "").strip().lower()
    class_id = request.args.get("class_id")
    status = request.args.get("status", "")
    rows = students_with_class()
    if q_:
        rows = [r for r in rows if q_ in (r["first_name"] + " " + r.get("middle_name", "") + " " + r["last_name"]).lower()
                or q_ in r["admission_no"].lower() or q_ in (r.get("parent_name") or "").lower()]
    if class_id:
        rows = [r for r in rows if str(r.get("class_id")) == class_id]
    if status:
        rows = [r for r in rows if r["status"] == status]
    return jsonify(rows)

@app.route("/api/students", methods=["POST"])
@admin_required
def add_student():
    d = request.get_json(force=True) or {}
    need = ["first_name", "last_name", "gender"]
    if any(not d.get(k) for k in need):
        return jsonify({"error": "first_name, last_name and gender are required"}), 400
    year = settings_map().get("academic_year", "2026")
    adm = (d.get("admission_no") or "").strip() or f"GF/{year}/{datetime.date.today().year%100}{random_seq()}"
    try:
        st_id = exe("""INSERT INTO students(admission_no,first_name,middle_name,last_name,gender,dob,admission_date,
                                            parent_name,parent_phone,parent_email,address,status)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (adm, d.get("first_name"), d.get("middle_name", ""), d.get("last_name"),
                     d.get("gender"), d.get("dob"), d.get("admission_date") or datetime.date.today().isoformat(),
                     d.get("parent_name"), d.get("parent_phone"), d.get("parent_email"),
                     d.get("address"), "Active"))
    except sqlite3.IntegrityError:
        return jsonify({"error": "Admission number already exists"}), 400
    if d.get("class_id"):
        exe("INSERT INTO enrollments(student_id,class_id,term,academic_year) VALUES(?,?,?,?)",
            (st_id, d["class_id"], settings_map().get("current_term", "Term 3"), year))
    log_activity("Student admitted", f"{d['first_name']} {d['last_name']} ({adm})")
    return jsonify({"id": st_id})

def random_seq():
    import random
    return random.randint(1000, 9999)

@app.route("/api/students/<int:sid>", methods=["PUT"])
@admin_required
def update_student(sid):
    d = request.get_json(force=True) or {}
    fields = ["first_name", "middle_name", "last_name", "gender", "dob", "admission_date",
              "parent_name", "parent_phone", "parent_email", "address", "status", "admission_no"]
    sets = [f for f in fields if f in d]
    if not sets:
        return jsonify({"error": "No fields"}), 400
    sql = "UPDATE students SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?"
    exe(sql, tuple(d[f] for f in sets) + (sid,))
    if d.get("class_id"):
        term = settings_map().get("current_term", "Term 3")
        year = settings_map().get("academic_year", "2026")
        cur = db()
        cur.execute("DELETE FROM enrollments WHERE student_id=? AND term=?", (sid, term))
        cur.execute("INSERT INTO enrollments(student_id,class_id,term,academic_year) VALUES(?,?,?,?)",
                    (sid, d["class_id"], term, year))
        cur.commit()
    log_activity("Student updated", f"#{sid} record edited")
    return jsonify({"ok": True})

@app.route("/api/students/<int:sid>")
@login_required
def student_detail(sid):
    st = q1("SELECT * FROM students WHERE id=?", (sid,))
    if not st:
        return jsonify({"error": "Not found"}), 404
    out = dict(st)
    out["class"] = student_class(sid)
    out["history"] = rows_to_dicts(q("""SELECT e.term, e.academic_year, c.name class_name
                                        FROM enrollments e JOIN classes c ON c.id=e.class_id
                                        WHERE e.student_id=? ORDER BY e.academic_year DESC, e.term""", (sid,)))
    out["payments"] = rows_to_dicts(q("""SELECT fp.*, pt.name payment_type_name, pt.category payment_type_category
                                         FROM fee_payments fp
                                         LEFT JOIN payment_types pt ON pt.id=fp.payment_type_id
                                         WHERE fp.student_id=? ORDER BY fp.payment_date DESC""", (sid,)))
    out["transport"] = rows_to_dicts(q("""SELECT tr.* FROM transport_assignments ta
                                          JOIN transport_routes tr ON tr.id=ta.route_id
                                          WHERE ta.student_id=? AND ta.status='Active'""", (sid,)))
    billing = {}
    for term in ("Term 1", "Term 2", "Term 3"):
        b = billed_for(sid, term, settings_map().get("academic_year", "2026"))
        if b:
            billing[term] = b
    out["billing"] = billing
    return jsonify(out)

@app.route("/api/students/promote", methods=["POST"])
@admin_required
def promote_class():
    """Move EVERY student of one class to another class for the WHOLE academic year.

    The source class is left completely empty (all three terms' enrollments are
    reassigned) so it is ready for a fresh intake — no mix-ups between classes.
    """
    d = request.get_json(force=True) or {}
    from_id, to_id = d.get("from_class_id"), d.get("to_class_id")
    if not from_id or not to_id:
        return jsonify({"error": "from_class_id and to_class_id required"}), 400
    if from_id == to_id:
        return jsonify({"error": "Source and target class are the same"}), 400
    s = settings_map()
    year = s.get("academic_year", "2026")
    from_c = q1("SELECT * FROM classes WHERE id=?", (from_id,))
    to_c = q1("SELECT * FROM classes WHERE id=?", (to_id,))
    if not from_c or not to_c:
        return jsonify({"error": "Class not found"}), 404
    rows = q("""SELECT DISTINCT student_id FROM enrollments
                WHERE class_id=? AND academic_year=?""", (from_id, year))
    if not rows:
        return jsonify({"error": "No students in the source class"}), 400
    cur = db()
    moved = 0
    for r in rows:
        sid = r["student_id"]
        # remove every enrollment this student has this year (all terms)
        cur.execute("DELETE FROM enrollments WHERE student_id=? AND academic_year=?", (sid, year))
        # re-enrol in the target class for the whole year (no duplicates)
        for term in ("Term 1", "Term 2", "Term 3"):
            cur.execute("INSERT INTO enrollments(student_id,class_id,term,academic_year) VALUES(?,?,?,?)",
                        (sid, to_id, term, year))
        moved += 1
    cur.commit()
    log_activity("Class promoted", f"{moved} students moved from {from_c['name']} to {to_c['name']} — {from_c['name']} is now empty")
    return jsonify({"moved": moved, "from": from_c["name"], "to": to_c["name"]})

@app.route("/api/students/import", methods=["POST"])
@admin_required
def import_students():
    """Bulk-import students from pasted CSV text (header: first_name,last_name,gender,class,parent_name,parent_phone)."""
    data = request.get_json(force=True) or {}
    text = (data.get("data") or "").strip()
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < 2:
        return jsonify({"error": "Paste the CSV including the header row"}), 400
    s = settings_map()
    term, year = s.get("current_term", "Term 3"), s.get("academic_year", "2026")
    class_cache = {r["name"]: r["id"] for r in q("SELECT id, name FROM classes")}
    created, skipped, errors = 0, 0, []
    for i, line in enumerate(lines[1:], start=2):
        cols = [c.strip().strip('"') for c in line.split(",")]
        if len(cols) < 3:
            errors.append(f"Line {i}: too few columns"); skipped += 1; continue
        fn, ln, gender = cols[0], cols[1], cols[2]
        if not fn or not ln:
            skipped += 1; continue
        gender = gender if gender in ("Male", "Female") else ("Male" if gender.lower().startswith("m") else "Female")
        class_name = cols[3] if len(cols) > 3 else ""
        cid = class_cache.get(class_name)
        if class_name and not cid:
            errors.append(f"Line {i}: class '{class_name}' not found"); skipped += 1; continue
        parent = cols[4] if len(cols) > 4 else ""
        phone = cols[5] if len(cols) > 5 else ""
        adm = f"GF/{year}/{datetime.date.today().year % 100}{random_seq()}"
        try:
            st_id = exe("""INSERT INTO students(admission_no,first_name,last_name,gender,parent_name,parent_phone,status)
                           VALUES(?,?,?,?,?,?,'Active')""",
                        (adm, fn, ln, gender, parent, phone))
        except sqlite3.IntegrityError:
            adm = f"GF/{year}/{datetime.date.today().year % 100}{random_seq()}{random_seq()}"
            st_id = exe("""INSERT INTO students(admission_no,first_name,last_name,gender,parent_name,parent_phone,status)
                           VALUES(?,?,?,?,?,?,'Active')""",
                        (adm, fn, ln, gender, parent, phone))
        if cid:
            exe("INSERT INTO enrollments(student_id,class_id,term,academic_year) VALUES(?,?,?,?)",
                (st_id, cid, term, year))
        created += 1
    log_activity("Bulk import", f"{created} students imported ({skipped} skipped)")
    return jsonify({"created": created, "skipped": skipped, "errors": errors[:20]})

# ------------------------------------------------------------------ teachers
@app.route("/api/teachers")
@login_required
def list_teachers():
    return jsonify(rows_to_dicts(q("""SELECT t.*, s.name subject_name, s.code subject_code
                                      FROM teachers t LEFT JOIN subjects s ON s.id=t.subject_id
                                      WHERE t.active=1 ORDER BY t.first_name""")))

@app.route("/api/teachers", methods=["POST"])
@admin_required
def add_teacher():
    d = request.get_json(force=True) or {}
    if not d.get("first_name") or not d.get("last_name"):
        return jsonify({"error": "Names required"}), 400
    tid = exe("""INSERT INTO teachers(tsc_no,first_name,last_name,gender,phone,email,subject_id,employment_type)
                 VALUES(?,?,?,?,?,?,?,?)""",
              (d.get("tsc_no"), d.get("first_name"), d.get("last_name"), d.get("gender"),
               d.get("phone"), d.get("email"), d.get("subject_id") or None, d.get("employment_type") or "Permanent"))
    return jsonify({"id": tid})

@app.route("/api/teachers/<int:tid>", methods=["PUT"])
@admin_required
def update_teacher(tid):
    d = request.get_json(force=True) or {}
    fields = ["tsc_no", "first_name", "last_name", "gender", "phone", "email", "subject_id", "employment_type"]
    sets = [f for f in fields if f in d]
    if sets:
        exe("UPDATE teachers SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?",
            tuple(d[f] for f in sets) + (tid,))
    return jsonify({"ok": True})

# ------------------------------------------------------------------ classes
@app.route("/api/classes")
@login_required
def list_classes():
    year = settings_map().get("academic_year", "2026")
    rows = q("""SELECT c.*, t.first_name ct_first, t.last_name ct_last,
                (SELECT COUNT(DISTINCT e.student_id) FROM enrollments e WHERE e.class_id=c.id AND e.academic_year=?) cnt
                FROM classes c LEFT JOIN teachers t ON t.id=c.class_teacher_id
                WHERE c.academic_year=? ORDER BY c.grade, c.stream""", (year, year))
    return jsonify(rows_to_dicts(rows))

@app.route("/api/classes", methods=["POST"])
@admin_required
def add_class():
    d = request.get_json(force=True) or {}
    if not d.get("name") or not d.get("grade"):
        return jsonify({"error": "name and grade required"}), 400
    cid = exe("INSERT INTO classes(name,grade,stream,academic_year,capacity,class_teacher_id) VALUES(?,?,?,?,?,?)",
              (d["name"], d["grade"], d.get("stream"), d.get("academic_year") or settings_map().get("academic_year", "2026"),
               d.get("capacity") or 45, d.get("class_teacher_id")))
    log_activity("Class created", d["name"])
    return jsonify({"id": cid})

@app.route("/api/classes/<int:cid>", methods=["PUT"])
@admin_required
def update_class(cid):
    d = request.get_json(force=True) or {}
    fields = ["name", "grade", "stream", "capacity", "class_teacher_id"]
    sets = [f for f in fields if f in d]
    if sets:
        exe("UPDATE classes SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?", tuple(d[f] for f in sets) + (cid,))
    return jsonify({"ok": True})

@app.route("/api/classes/<int:cid>", methods=["DELETE"])
@admin_required
def delete_class(cid):
    c = q1("SELECT * FROM classes WHERE id=?", (cid,))
    if not c:
        return jsonify({"error": "Class not found"}), 404
    cur = db()
    cur.execute("DELETE FROM timetable WHERE class_id=?", (cid,))
    cur.execute("DELETE FROM fee_structures WHERE class_id=?", (cid,))
    cur.execute("DELETE FROM enrollments WHERE class_id=?", (cid,))
    cur.execute("DELETE FROM attendance WHERE class_id=?", (cid,))
    cur.execute("DELETE FROM classes WHERE id=?", (cid,))
    cur.commit()
    log_activity("Class removed", c["name"])
    return jsonify({"ok": True, "removed": c["name"]})

@app.route("/api/classes/<int:cid>/students")
@login_required
def class_students(cid):
    rows = q("""SELECT DISTINCT st.* FROM enrollments e JOIN students st ON st.id=e.student_id
                WHERE e.class_id=? ORDER BY st.first_name""", (cid,))
    return jsonify(rows_to_dicts(rows))

# ------------------------------------------------------------------ subjects
@app.route("/api/subjects")
@login_required
def list_subjects():
    return jsonify(rows_to_dicts(q("""SELECT s.*, t.first_name t_first, t.last_name t_last
                                      FROM subjects s LEFT JOIN teachers t ON t.id=s.teacher_id
                                      ORDER BY s.category, s.name""")))

@app.route("/api/subjects", methods=["POST"])
@admin_required
def add_subject():
    d = request.get_json(force=True) or {}
    if not d.get("name") or not d.get("code"):
        return jsonify({"error": "name and code required"}), 400
    try:
        sid = exe("INSERT INTO subjects(name,code,category,grades,teacher_id) VALUES(?,?,?,?,?)",
                  (d["name"], d["code"].upper(), d.get("category"),
                   d.get("grades") or "1,2,3,4,5,6,7,8,9,10,11,12", d.get("teacher_id")))
    except sqlite3.IntegrityError:
        return jsonify({"error": "Code already exists"}), 400
    return jsonify({"id": sid})

@app.route("/api/subjects/<int:sid>", methods=["PUT"])
@admin_required
def update_subject(sid):
    d = request.get_json(force=True) or {}
    fields = ["name", "code", "category", "grades", "teacher_id"]
    sets = [f for f in fields if f in d]
    if sets:
        exe("UPDATE subjects SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?", tuple(d[f] for f in sets) + (sid,))
    return jsonify({"ok": True})

# ------------------------------------------------------------------ exams & marks
@app.route("/api/exams")
@login_required
def list_exams():
    rows = q("""SELECT e.*, (SELECT COUNT(DISTINCT es.student_id) FROM exam_scores es WHERE es.exam_id=e.id) students
                FROM exams e ORDER BY e.id DESC""")
    return jsonify(rows_to_dicts(rows))

@app.route("/api/exams", methods=["POST"])
@admin_required
def add_exam():
    d = request.get_json(force=True) or {}
    if not d.get("name") or not d.get("term"):
        return jsonify({"error": "name and term required"}), 400
    eid = exe("INSERT INTO exams(name,term,academic_year,status) VALUES(?,?,?,?)",
              (d["name"], d["term"], d.get("academic_year") or settings_map().get("academic_year", "2026"),
               d.get("status") or "Open"))
    return jsonify({"id": eid})

@app.route("/api/exams/<int:eid>", methods=["PUT"])
@admin_required
def update_exam(eid):
    d = request.get_json(force=True) or {}
    fields = ["name", "term", "status"]
    sets = [f for f in fields if f in d]
    if sets:
        exe("UPDATE exams SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?", tuple(d[f] for f in sets) + (eid,))
    return jsonify({"ok": True})

@app.route("/api/exams/<int:eid>")
@login_required
def exam_detail(eid):
    ex = q1("SELECT * FROM exams WHERE id=?", (eid,))
    if not ex:
        return jsonify({"error": "Not found"}), 404
    s = settings_map()
    term = ex["term"]
    year = ex["academic_year"]
    class_rows = q("""SELECT c.id, c.name,
                      (SELECT COUNT(DISTINCT es.student_id) FROM exam_scores es
                       JOIN enrollments e ON e.student_id=es.student_id AND e.term=? AND e.academic_year=?
                       WHERE es.exam_id=? AND e.class_id=c.id) cnt
                      FROM classes c WHERE c.academic_year=? ORDER BY c.grade, c.stream""", (term, year, eid, year))
    return jsonify({"exam": dict(ex),
                    "subjects": rows_to_dicts(q("SELECT * FROM subjects ORDER BY name")),
                    "classes": rows_to_dicts(class_rows)})

@app.route("/api/exams/<int:eid>/marks")
@login_required
def exam_marks(eid):
    class_id = request.args.get("class_id")
    if not class_id:
        return jsonify({"error": "class_id required"}), 400
    students = q("""SELECT st.id, st.admission_no, st.first_name, st.last_name
                    FROM enrollments e JOIN students st ON st.id=e.student_id
                    WHERE e.class_id=? AND e.term=(SELECT term FROM exams WHERE id=?)
                    ORDER BY st.first_name""", (class_id, eid))
    clr = q1("SELECT grade FROM classes WHERE id=?", (class_id,))
    gnum = int(clr["grade"].split()[-1]) if clr else 7
    subjects = subjects_for_grade(gnum)
    scores = q("SELECT student_id, subject_id, score FROM exam_scores WHERE exam_id=?", (eid,))
    score_map = {(r["student_id"], r["subject_id"]): r["score"] for r in scores}
    matrix = []
    for st in students:
        row = {"id": st["id"], "admission_no": st["admission_no"],
               "name": f"{st['first_name']} {st['last_name']}", "scores": {}}
        for su in subjects:
            row["scores"][su["id"]] = score_map.get((st["id"], su["id"]))
        matrix.append(row)
    return jsonify({"students": matrix, "subjects": rows_to_dicts(subjects)})

@app.route("/api/exams/<int:eid>/marks", methods=["POST"])
@academic_required
def save_marks(eid):
    data = request.get_json(force=True) or {}
    updates = data.get("scores") or []
    cur = db()
    n = 0
    for u in updates:
        sid_, subj_, sc = u["student_id"], u["subject_id"], u.get("score")
        if sc is None or sc == "":
            cur.execute("DELETE FROM exam_scores WHERE exam_id=? AND student_id=? AND subject_id=?",
                        (eid, sid_, subj_))
            continue
        sc = float(sc)
        sc = max(0, min(100, sc))
        # determine scale from the student's class grade (CBC vs KCSE)
        clr = q1("""SELECT c.grade FROM enrollments e JOIN classes c ON c.id=e.class_id
                    WHERE e.student_id=? AND e.term=(SELECT term FROM exams WHERE id=?)
                    AND e.academic_year=(SELECT academic_year FROM exams WHERE id=?) LIMIT 1""",
                 (sid_, eid, eid))
        scale = scale_for_grade(clr["grade"] if clr else "Grade 7")
        letter, pts = grade_for(sc, scale)
        cur.execute("""INSERT INTO exam_scores(exam_id,student_id,subject_id,score,grade,points)
                       VALUES(?,?,?,?,?,?)
                       ON CONFLICT(exam_id,student_id,subject_id)
                       DO UPDATE SET score=excluded.score, grade=excluded.grade, points=excluded.points""",
                    (eid, sid_, subj_, sc, letter, pts))
        n += 1
    cur.commit()
    return jsonify({"saved": n})

@app.route("/api/exams/<int:eid>/comments")
@academic_required
def exam_comments_get(eid):
    rows = q("SELECT student_id, comment FROM exam_comments WHERE exam_id=?", (eid,))
    return jsonify({r["student_id"]: r["comment"] for r in rows})

@app.route("/api/exams/<int:eid>/comments", methods=["POST"])
@academic_required
def exam_comments_save(eid):
    d = request.get_json(force=True) or {}
    comments = d.get("comments") or {}   # {student_id: text}
    cur = db()
    n = 0
    for sid, text in comments.items():
        text = (text or "").strip()
        if text:
            cur.execute("""INSERT INTO exam_comments(exam_id,student_id,comment) VALUES(?,?,?)
                           ON CONFLICT(exam_id,student_id) DO UPDATE SET comment=excluded.comment""",
                        (eid, sid, text[:400]))
            n += 1
    cur.commit()
    return jsonify({"saved": n})

# ------------------------------------------------------------------ analytics
@app.route("/api/analytics")
@login_required
def analytics():
    exam_id = request.args.get("exam_id", type=int)
    exams = q("SELECT * FROM exams ORDER BY id")
    if not exam_id and exams:
        exam_id = exams[-1]["id"]
    if not exam_id:
        return jsonify({"exams": [], "data": None})
    ex = q1("SELECT * FROM exams WHERE id=?", (exam_id,))
    s = settings_map()
    term = ex["term"]
    year = ex["academic_year"]

    results = exam_results(exam_id)
    student_list = students_with_class(term)
    student_map = {st["id"]: st for st in student_list}

    rows = []
    for sid, res in results.items():
        st = student_map.get(sid)
        if not st:
            continue
        scale = scale_for_grade(st.get("grade") or st.get("class_name") or "Grade 7")
        rows.append({
            "student_id": sid, "admission_no": st["admission_no"],
            "name": f"{st['first_name']} {st['last_name']}",
            "gender": st["gender"], "class_name": st.get("class_name") or "—",
            "subjects": res["subjects"], "total_points": res["total_points"],
            "mean": res["mean"], "avg_pts": res["avg_pts"],
            "scale": scale,
            "mean_grade": mean_grade_from_points(res["avg_pts"], scale),
        })
    for r in rows:
        class_peers = sorted([x for x in rows if x["class_name"] == r["class_name"]],
                             key=lambda x: (-x["avg_pts"], x["name"]))
        r["class_pos"] = next(i + 1 for i, x in enumerate(class_peers) if x["student_id"] == r["student_id"])
        r["class_size"] = len(class_peers)
    ranked = sorted(rows, key=lambda x: (-x["avg_pts"], x["name"]))
    for i, r in enumerate(ranked):
        r["overall_pos"] = i + 1

    grade_dist = {}
    for r in rows:
        grade_dist[r["mean_grade"]] = grade_dist.get(r["mean_grade"], 0) + 1
    # order: CBC levels (E,M,A,B) then KCSE letters
    order = ["E", "M", "A", "B", "A-", "B+", "B-", "C+", "C", "C-", "D+", "D", "D-"]
    seen = set()
    ordered = []
    for g in order + ["A", "B"]:
        if g not in seen:
            seen.add(g); ordered.append(g)
    grade_dist = [{"grade": g, "count": grade_dist.get(g, 0)} for g in ordered]

    subject_means = rows_to_dicts(q("""SELECT su.name, su.code, ROUND(AVG(es.score),1) mean,
                                       MAX(es.score) highest, MIN(es.score) lowest,
                                       (SELECT t.first_name FROM teachers t WHERE t.subject_id=su.id) teacher
                                       FROM exam_scores es JOIN subjects su ON su.id=es.subject_id
                                       WHERE es.exam_id=? GROUP BY su.id ORDER BY mean DESC""", (exam_id,)))

    class_means = rows_to_dicts(q("""SELECT c.name, ROUND(AVG(es.score),1) mean, COUNT(DISTINCT es.student_id) students
                                     FROM exam_scores es
                                     JOIN enrollments e ON e.student_id=es.student_id AND e.term=? AND e.academic_year=?
                                     JOIN classes c ON c.id=e.class_id
                                     WHERE es.exam_id=? GROUP BY c.id ORDER BY mean DESC""", (term, year, exam_id)))

    gender_perf = rows_to_dicts(q("""SELECT st.gender, ROUND(AVG(es.score),1) mean, COUNT(DISTINCT es.student_id) students
                                     FROM exam_scores es JOIN students st ON st.id=es.student_id
                                     WHERE es.exam_id=? GROUP BY st.gender""", (exam_id,)))

    trend = rows_to_dicts(q("""SELECT e.id, e.name, e.term, ROUND(AVG(es.score),1) mean, COUNT(DISTINCT es.student_id) students
                               FROM exams e JOIN exam_scores es ON es.exam_id=e.id
                               GROUP BY e.id ORDER BY e.id"""))

    top10 = ranked[:10]
    return jsonify({
        "exams": rows_to_dicts(exams),
        "selected_exam": dict(ex),
        "data": {
            "rows": rows, "ranked": ranked,
            "grade_dist": grade_dist,
            "subject_means": subject_means,
            "class_means": class_means,
            "gender_perf": gender_perf,
            "trend": trend,
            "top10": top10,
            "overall_mean": round(sum(r["mean"] for r in rows) / len(rows), 1) if rows else 0,
        }
    })

@app.route("/api/analytics/student/<int:sid>")
@login_required
def student_analytics(sid):
    exam_id = request.args.get("exam_id", type=int)
    st = q1("SELECT * FROM students WHERE id=?", (sid,))
    if not st:
        return jsonify({"error": "Not found"}), 404
    cl = student_class(sid)
    out = dict(st)
    out["class"] = cl
    exams = q("SELECT * FROM exams ORDER BY id")
    selected = q1("SELECT * FROM exams WHERE id=?", (exam_id,)) if exam_id else exams[-1]
    if not selected:
        return jsonify({"error": "No exams"}), 400

    per_subject = rows_to_dicts(q("""SELECT su.name, es.score, es.grade, es.points,
                                     (SELECT ROUND(AVG(score),1) FROM exam_scores x
                                      WHERE x.exam_id=? AND x.subject_id=su.id) subject_mean
                                     FROM exam_scores es JOIN subjects su ON su.id=es.subject_id
                                     WHERE es.exam_id=? AND es.student_id=?
                                     ORDER BY es.points DESC""", (selected["id"], selected["id"], sid)))
    agg = q1("""SELECT COUNT(*) subjects, SUM(points) total_points, ROUND(AVG(score),1) mean,
                ROUND(AVG(points),2) avg_pts FROM exam_scores WHERE exam_id=? AND student_id=?""",
             (selected["id"], sid))
    term = selected["term"]
    peers = q("""SELECT es.student_id, ROUND(AVG(es.points),2) avg_pts
                 FROM exam_scores es
                 JOIN enrollments e ON e.student_id=es.student_id AND e.term=? AND e.academic_year=?
                 JOIN classes c ON c.id=e.class_id
                 WHERE es.exam_id=? AND c.id=?
                 GROUP BY es.student_id""", (term, selected["academic_year"], selected["id"], cl["id"] if cl else -1))
    peers = sorted(peers, key=lambda r: -r["avg_pts"])
    rank = next((i + 1 for i, p in enumerate(peers) if p["student_id"] == sid), None)

    trend = rows_to_dicts(q("""SELECT e.id, e.term, e.name, ROUND(AVG(es.score),1) mean, ROUND(AVG(es.points),2) avg_pts
                               FROM exams e JOIN exam_scores es ON es.exam_id=e.id AND es.student_id=?
                               GROUP BY e.id ORDER BY e.id""", (sid,)))

    scale = scale_for_grade(cl["grade"] if cl else "Grade 7")
    return jsonify({
        "exams": rows_to_dicts(exams),
        "selected_exam": dict(selected),
        "student": out,
        "scale": scale,
        "per_subject": per_subject,
        "agg": dict(agg) if agg else None,
        "class_rank": rank, "class_size": len(peers),
        "trend": trend,
    })

# ------------------------------------------------------------------ finance
@app.route("/api/payment-types")
@login_required
def payment_types_list():
    rows = q("""SELECT pt.*, (SELECT COUNT(*) FROM fee_payments fp WHERE fp.payment_type_id=pt.id) payments
                FROM payment_types pt ORDER BY pt.active DESC, pt.category, pt.name""")
    return jsonify(rows_to_dicts(rows))

@app.route("/api/payment-types", methods=["POST"])
@admin_required
def add_payment_type():
    d = request.get_json(force=True) or {}
    if not d.get("name"):
        return jsonify({"error": "name required"}), 400
    try:
        pid = exe("INSERT INTO payment_types(name,category,default_amount) VALUES(?,?,?)",
                  (d["name"].strip(), d.get("category") or "Fees", d.get("default_amount")))
    except sqlite3.IntegrityError:
        return jsonify({"error": "A payment type with this name already exists"}), 400
    log_activity("Payment type created", d["name"].strip())
    return jsonify({"id": pid})

@app.route("/api/payment-types/<int:pid>", methods=["PUT"])
@admin_required
def update_payment_type(pid):
    d = request.get_json(force=True) or {}
    fields = ["name", "category", "default_amount", "active"]
    sets = [f for f in fields if f in d]
    if sets:
        exe("UPDATE payment_types SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?",
            tuple(d[f] for f in sets) + (pid,))
    return jsonify({"ok": True})

@app.route("/api/finance")
@login_required
def finance():
    s = settings_map()
    term = request.args.get("term") or s.get("current_term", "Term 3")
    year = request.args.get("year") or s.get("academic_year", "2026")
    billed, paid, class_rows = finance_snapshot(term, year)
    students = []
    for st in students_with_class(term):
        b = billed_for(st["id"], term, year)
        p = paid_for(st["id"], term, year)
        students.append({**st, "billed": b, "paid": p, "balance": b - p,
                         "payments": q1("""SELECT COUNT(*) c FROM fee_payments
                                           WHERE student_id=? AND term=?""", (st["id"], term))["c"]})
    students.sort(key=lambda x: (-x["balance"], x["first_name"]))
    recent = rows_to_dicts(q("""SELECT fp.*, st.first_name, st.last_name, st.admission_no,
                                       pt.name payment_type_name, pt.category payment_type_category
                                FROM fee_payments fp
                                JOIN students st ON st.id=fp.student_id
                                LEFT JOIN payment_types pt ON pt.id=fp.payment_type_id
                                ORDER BY fp.payment_date DESC, fp.id DESC LIMIT 12"""))
    terms = ["Term 1", "Term 2", "Term 3"]
    type_rows = q("""SELECT COALESCE(pt.name,'Other') name, COALESCE(pt.category,'Fees') category,
                            SUM(fp.amount) amount, COUNT(*) count
                     FROM fee_payments fp
                     LEFT JOIN payment_types pt ON pt.id=fp.payment_type_id
                     WHERE fp.term=? AND fp.payment_date LIKE ?
                     GROUP BY pt.id ORDER BY amount DESC""", (term, f"{year}-%"))
    type_breakdown = rows_to_dicts(type_rows)
    return jsonify({"term": term, "year": year, "terms": terms,
                    "billed": billed, "paid": paid, "arrears": billed - paid,
                    "rate": round(paid / billed * 100, 1) if billed else 0,
                    "class_rows": class_rows, "students": students, "recent": recent,
                    "type_breakdown": type_breakdown})

@app.route("/api/finance/payments", methods=["POST"])
@finance_required
def record_payment():
    d = request.get_json(force=True) or {}
    if not d.get("student_id") or not d.get("amount"):
        return jsonify({"error": "student_id and amount required"}), 400
    amount = float(d["amount"])
    if amount <= 0:
        return jsonify({"error": "Amount must be positive"}), 400
    ptid = d.get("payment_type_id")
    if ptid:
        pt = q1("SELECT * FROM payment_types WHERE id=? AND active=1", (ptid,))
        if not pt:
            return jsonify({"error": "Invalid payment type"}), 400
    receipt = "RCP-" + str(q1("SELECT COALESCE(MAX(CAST(SUBSTR(receipt_no,5) AS INTEGER)),9999)+1 m FROM fee_payments")["m"])
    pid = exe("""INSERT INTO fee_payments(student_id,payment_type_id,amount,payment_date,term,method,reference,receipt_no,recorded_by,notes)
                 VALUES(?,?,?,?,?,?,?,?,?,?)""",
              (d["student_id"], ptid, amount, d.get("payment_date") or datetime.date.today().isoformat(),
               d.get("term") or settings_map().get("current_term", "Term 3"),
               d.get("method") or "M-PESA", d.get("reference") or "", receipt,
               acting_name(), d.get("notes") or ""))
    log_activity("Payment recorded", f"{receipt} · {d.get('method') or 'M-PESA'} · {fmt_amount(amount)}")
    return jsonify({"id": pid, "receipt_no": receipt})

@app.route("/api/finance/payments/<int:pid>", methods=["PUT"])
@finance_required
def update_payment(pid):
    d = request.get_json(force=True) or {}
    fields = ["amount", "payment_date", "term", "method", "reference", "notes", "payment_type_id"]
    sets = [f for f in fields if f in d]
    if "amount" in d and d["amount"] is not None and float(d["amount"]) <= 0:
        return jsonify({"error": "Amount must be positive"}), 400
    if sets:
        exe("UPDATE fee_payments SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?",
            tuple(d[f] for f in sets) + (pid,))
    return jsonify({"ok": True})

def statement_data(sid):
    """Itemised billing + payments for a student (shared by staff & portal)."""
    st = q1("SELECT * FROM students WHERE id=?", (sid,))
    if not st:
        return None
    cl = student_class(sid)
    year = settings_map().get("academic_year", "2026")
    billing = []
    for term in ("Term 1", "Term 2", "Term 3"):
        fee = q1("""SELECT amount FROM fee_structures WHERE class_id=? AND term=? AND academic_year=?""",
                 (cl["id"] if cl else -1, term, year))
        route_fee = q1("""SELECT COALESCE(tr.fee,0) f FROM transport_assignments ta
                          JOIN transport_routes tr ON tr.id=ta.route_id
                          WHERE ta.student_id=? AND ta.academic_year=? AND ta.status='Active'""", (sid, year))
        if fee:
            billing.append({"term": term, "academic_year": year, "label": "Tuition", "amount": fee["amount"]})
        if route_fee and route_fee["f"]:
            billing.append({"term": term, "academic_year": year, "label": "Transport", "amount": route_fee["f"]})
    payments = rows_to_dicts(q("""SELECT fp.*, pt.name payment_type_name, pt.category payment_type_category
                                  FROM fee_payments fp
                                  LEFT JOIN payment_types pt ON pt.id=fp.payment_type_id
                                  WHERE fp.student_id=? ORDER BY fp.payment_date DESC, fp.id DESC""", (sid,)))
    total_billed = sum(b["amount"] for b in billing)
    total_paid = sum(p["amount"] for p in payments)
    return {"student": dict(st), "class": cl, "billing": billing, "payments": payments,
            "total_billed": total_billed, "total_paid": total_paid,
            "balance": total_billed - total_paid}

@app.route("/api/finance/statement/<int:sid>")
@login_required
def finance_statement(sid):
    data = statement_data(sid)
    if not data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(data)

@app.route("/api/finance/structure", methods=["POST"])
@finance_required
def set_fee_structure():
    d = request.get_json(force=True) or {}
    if not d.get("class_id") or not d.get("term") or d.get("amount") is None:
        return jsonify({"error": "class_id, term, amount required"}), 400
    year = d.get("academic_year") or settings_map().get("academic_year", "2026")
    exe("""INSERT INTO fee_structures(class_id,term,academic_year,amount) VALUES(?,?,?,?)
           ON CONFLICT(class_id,term,academic_year) DO UPDATE SET amount=excluded.amount""",
        (d["class_id"], d["term"], year, float(d["amount"])))
    return jsonify({"ok": True})

@app.route("/api/finance/reminders", methods=["POST"])
@finance_required
def send_fee_reminders():
    s = settings_map()
    term = s.get("current_term", "Term 3")
    year = s.get("academic_year", "2026")
    sent = 0
    for st in students_with_class(term):
        b = billed_for(st["id"], term, year)
        p = paid_for(st["id"], term, year)
        bal = b - p
        if bal > 0:
            msg = (f"Dear {st.get('parent_name') or 'Parent'}, kindly note that {st['first_name']} {st['last_name']} "
                   f"({st.get('admission_no')}) has a fee balance of {s.get('currency','KSh')} {bal:,.0f} for {term} {year}. "
                   f"Please clear before the exams. - {s.get('school_name')}")
            exe("""INSERT INTO sms_log(to_phone,parent_name,student_name,message,category,status)
                   VALUES(?,?,?,?,?,?)""",
                (st.get("parent_phone"), st.get("parent_name"), f"{st['first_name']} {st['last_name']}", msg,
                 "Fee Reminder", "Queued"))
            sent += 1
    return jsonify({"sent": sent})

# ------------------------------------------------------------------ transport
@app.route("/api/transport/routes")
@login_required
def transport_routes():
    rows = q("""SELECT tr.*,
                (SELECT COUNT(*) FROM transport_assignments ta
                 WHERE ta.route_id=tr.id AND ta.status='Active') assigned
                FROM transport_routes tr ORDER BY tr.name""")
    return jsonify(rows_to_dicts(rows))

@app.route("/api/transport/routes", methods=["POST"])
@admin_required
def add_route():
    d = request.get_json(force=True) or {}
    if not d.get("name"):
        return jsonify({"error": "name required"}), 400
    rid = exe("""INSERT INTO transport_routes(name,route_no,driver_name,driver_phone,capacity,morning_time,evening_time,fee)
                 VALUES(?,?,?,?,?,?,?,?)""",
              (d["name"], d.get("route_no"), d.get("driver_name"), d.get("driver_phone"),
               d.get("capacity") or 40, d.get("morning_time") or "6:30 AM",
               d.get("evening_time") or "4:30 PM", float(d.get("fee") or 0)))
    return jsonify({"id": rid})

@app.route("/api/transport/routes/<int:rid>", methods=["PUT"])
@admin_required
def update_route(rid):
    d = request.get_json(force=True) or {}
    fields = ["name", "route_no", "driver_name", "driver_phone", "capacity", "morning_time", "evening_time", "fee", "status"]
    sets = [f for f in fields if f in d]
    if sets:
        exe("UPDATE transport_routes SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?",
            tuple(d[f] for f in sets) + (rid,))
    return jsonify({"ok": True})

@app.route("/api/transport/assignments")
@login_required
def transport_assignments():
    year = settings_map().get("academic_year", "2026")
    route_id = request.args.get("route_id", type=int)
    assigned = set(r["student_id"] for r in q(
        """SELECT student_id FROM transport_assignments WHERE status='Active' AND academic_year=?""", (year,)))
    rows = []
    for st in students_with_class():
        arows = q("""SELECT ta.route_id r FROM transport_assignments ta
                     WHERE ta.student_id=? AND ta.status='Active' AND ta.academic_year=?""",
                  (st["id"], year))
        assigned_route = arows[0]["r"] if arows else None
        rows.append({"student_id": st["id"], "name": f"{st['first_name']} {st['last_name']}",
                     "admission_no": st["admission_no"], "class_name": st.get("class_name") or "—",
                     "assigned": assigned_route == route_id if route_id else assigned_route is not None})
    return jsonify(rows)

@app.route("/api/transport/assign", methods=["POST"])
@admin_required
def transport_assign():
    d = request.get_json(force=True) or {}
    route_id = d.get("route_id")
    student_ids = d.get("student_ids") or []
    year = settings_map().get("academic_year", "2026")
    cur = db()
    for sid in student_ids:
        cur.execute("""INSERT INTO transport_assignments(student_id,route_id,academic_year,status) VALUES(?,?,?,?)
                       ON CONFLICT(student_id,academic_year) DO UPDATE SET route_id=excluded.route_id, status='Active'""",
                    (sid, route_id, year, "Active"))
    # unassign students no longer in the list for this route
    if student_ids:
        placeholders = ",".join("?" * len(student_ids))
        cur.execute(f"""UPDATE transport_assignments SET status='Inactive'
                        WHERE route_id=? AND academic_year=? AND status='Active'
                        AND student_id NOT IN ({placeholders})""", (route_id, year, *student_ids))
    cur.commit()
    log_activity("Transport updated", f"{len(student_ids)} riders assigned to route {route_id}")
    return jsonify({"assigned": len(student_ids)})

@app.route("/api/transport/register")
@login_required
def transport_register():
    date_ = request.args.get("date") or datetime.date.today().isoformat()
    route_id = request.args.get("route_id", type=int)
    period = request.args.get("period") or "Morning"
    year = settings_map().get("academic_year", "2026")
    if not route_id:
        return jsonify({"error": "route_id required"}), 400
    students = q("""SELECT st.id, st.admission_no, st.first_name, st.last_name
                    FROM transport_assignments ta JOIN students st ON st.id=ta.student_id
                    WHERE ta.route_id=? AND ta.status='Active' AND ta.academic_year=?
                    ORDER BY st.first_name""", (route_id, year))
    existing = {r["student_id"]: r["status"] for r in q(
        "SELECT student_id, status FROM transport_log WHERE date=? AND route_id=? AND period=?",
        (date_, route_id, period))}
    rows = [{**dict(st), "status": existing.get(st["id"], "Boarded")} for st in students]
    return jsonify({"date": date_, "route_id": route_id, "period": period, "rows": rows})

@app.route("/api/transport/register", methods=["POST"])
@academic_required
def save_transport_register():
    d = request.get_json(force=True) or {}
    date_ = d.get("date") or datetime.date.today().isoformat()
    route_id = d.get("route_id")
    period = d.get("period") or "Morning"
    if not route_id:
        return jsonify({"error": "route_id required"}), 400
    cur = db()
    n = 0
    for rec in d.get("records", []):
        cur.execute("""INSERT INTO transport_log(date,route_id,student_id,period,status) VALUES(?,?,?,?,?)
                       ON CONFLICT(date,route_id,student_id,period) DO UPDATE SET status=excluded.status""",
                    (date_, route_id, rec["student_id"], period, rec["status"]))
        n += 1
    cur.commit()
    return jsonify({"saved": n})

@app.route("/api/transport/summary")
@login_required
def transport_summary():
    year = settings_map().get("academic_year", "2026")
    today = datetime.date.today().isoformat()
    routes = q("""SELECT tr.id, tr.name, tr.capacity, tr.fee, tr.driver_name, tr.morning_time, tr.evening_time,
                  (SELECT COUNT(*) FROM transport_assignments ta WHERE ta.route_id=tr.id AND ta.status='Active') assigned,
                  (SELECT COUNT(*) FROM transport_log l WHERE l.route_id=tr.id AND l.date=? AND l.status='Boarded') boarded
                  FROM transport_routes tr WHERE tr.status='Active' ORDER BY tr.name""", (today,))
    return jsonify({
        "routes": rows_to_dicts(routes),
        "total_assigned": q1("SELECT COUNT(*) c FROM transport_assignments WHERE status='Active' AND academic_year=?", (year,))["c"],
        "boarded_today": q1("SELECT COUNT(*) c FROM transport_log WHERE date=? AND status='Boarded'", (today,))["c"],
        "monthly_fees": q1("""SELECT COALESCE(SUM(tr.fee),0) a FROM transport_assignments ta
                              JOIN transport_routes tr ON tr.id=ta.route_id
                              WHERE ta.status='Active' AND ta.academic_year=?""", (year,))["a"],
    })

# ------------------------------------------------------------------ timetable
@app.route("/api/timetable/meta")
@login_required
def timetable_meta():
    return jsonify({"days": DAYS, "periods": PERIODS})

@app.route("/api/timetable")
@login_required
def timetable_grid():
    class_id = request.args.get("class_id", type=int)
    if not class_id:
        return jsonify({"error": "class_id required"}), 400
    entries = q("""SELECT tt.*, s.name subject_name, s.code subject_code, s.category,
                          t.first_name t_first, t.last_name t_last
                   FROM timetable tt
                   LEFT JOIN subjects s ON s.id=tt.subject_id
                   LEFT JOIN teachers t ON t.id=tt.teacher_id
                   WHERE tt.class_id=?
                   ORDER BY tt.day, tt.period""", (class_id,))
    grid = {}
    for e in entries:
        grid.setdefault(e["day"], {})[str(e["period"])] = {
            "subject_id": e["subject_id"], "subject_name": e["subject_name"],
            "subject_code": e["subject_code"], "category": e["category"],
            "teacher_id": e["teacher_id"],
            "teacher_name": ((e["t_first"] or "") + " " + (e["t_last"] or "")).strip(),
        }
    # teacher double-bookings: same teacher in >1 class at same day+period
    conflicts = q("""SELECT day, period, teacher_id FROM timetable
                     WHERE teacher_id IS NOT NULL
                     GROUP BY day, period, teacher_id HAVING COUNT(DISTINCT class_id) > 1""")
    return jsonify({"days": DAYS, "periods": PERIODS, "grid": grid,
                    "conflict_slots": [{"day": r["day"], "period": r["period"]} for r in conflicts]})

@app.route("/api/timetable/teacher")
@login_required
def timetable_teacher():
    u = auth_user()
    tid = request.args.get("teacher_id", type=int)
    if not tid:
        if u["role"] == "teacher" and u.get("teacher_id"):
            tid = u["teacher_id"]
        else:
            return jsonify({"error": "teacher_id required"}), 400
    entries = q("""SELECT tt.*, s.name subject_name, s.code subject_code,
                          c.name class_name
                   FROM timetable tt
                   LEFT JOIN subjects s ON s.id=tt.subject_id
                   LEFT JOIN classes c ON c.id=tt.class_id
                   WHERE tt.teacher_id=?
                   ORDER BY tt.day, tt.period""", (tid,))
    grid = {}
    for e in entries:
        grid.setdefault(e["day"], {})[str(e["period"])] = {
            "class_name": e["class_name"], "subject_name": e["subject_name"],
            "subject_code": e["subject_code"]}
    return jsonify({"days": DAYS, "periods": PERIODS, "grid": grid,
                    "teacher": dict(q1("SELECT * FROM teachers WHERE id=?", (tid,)))})

@app.route("/api/timetable/set", methods=["POST"])
@academic_required
def timetable_set():
    d = request.get_json(force=True) or {}
    class_id = d.get("class_id")
    day = d.get("day")
    period = d.get("period")
    subject_id = d.get("subject_id")
    if not class_id or not day or not period:
        return jsonify({"error": "class_id, day and period required"}), 400
    if day not in DAYS or int(period) not in [p["n"] for p in PERIODS]:
        return jsonify({"error": "Invalid day or period"}), 400
    if not subject_id:
        exe("DELETE FROM timetable WHERE class_id=? AND day=? AND period=?",
            (class_id, day, period))
        return jsonify({"ok": True, "cleared": True})
    subj = q1("SELECT * FROM subjects WHERE id=?", (subject_id,))
    if not subj:
        return jsonify({"error": "Unknown subject"}), 400
    teacher_id = d.get("teacher_id") or subj["teacher_id"]
    if teacher_id:
        other = q1("""SELECT tt.id, c.name FROM timetable tt
                      JOIN classes c ON c.id=tt.class_id
                      WHERE tt.day=? AND tt.period=? AND tt.teacher_id=? AND tt.class_id<>?""",
                   (day, period, teacher_id, class_id))
        if other:
            return jsonify({"error": f"Conflict: this teacher is already booked in {other['name']} "
                                    f"on {day} period {period}"}), 409
    exe("""INSERT INTO timetable(class_id,day,period,subject_id,teacher_id) VALUES(?,?,?,?,?)
           ON CONFLICT(class_id,day,period)
           DO UPDATE SET subject_id=excluded.subject_id, teacher_id=excluded.teacher_id""",
        (class_id, day, period, subject_id, teacher_id))
    return jsonify({"ok": True})

# ------------------------------------------------------------------ receipts
@app.route("/api/finance/receipt/<int:pid>")
@any_required
def receipt_detail(pid):
    p = q1("SELECT * FROM fee_payments WHERE id=?", (pid,))
    if not p:
        return jsonify({"error": "Payment not found"}), 404
    u = auth_user()
    if u["role"] == "guardian" and p["student_id"] not in guardian_student_ids():
        return jsonify({"error": "Forbidden"}), 403
    st = q1("SELECT * FROM students WHERE id=?", (p["student_id"],))
    if not st:
        return jsonify({"error": "Student not found"}), 404
    cl = student_class(st["id"], p["term"])
    s = settings_map()
    paid = q1("SELECT COALESCE(SUM(amount),0) a FROM fee_payments WHERE student_id=?", (st["id"],))["a"]
    billed = 0
    for term in ("Term 1", "Term 2", "Term 3"):
        billed += billed_for(st["id"], term, s.get("academic_year", "2026"))
    pt = q1("SELECT * FROM payment_types WHERE id=?", (p["payment_type_id"],)) if p["payment_type_id"] else None
    return jsonify({"payment": dict(p), "student": dict(st), "class": cl,
                    "settings": s, "paid_to_date": paid,
                    "total_billed": billed, "balance": billed - paid,
                    "payment_type": dict(pt) if pt else None})

# ------------------------------------------------------------------ attendance
@app.route("/api/attendance")
@login_required
def attendance():
    date_ = request.args.get("date") or datetime.date.today().isoformat()
    class_id = request.args.get("class_id")
    s = settings_map()
    term = s.get("current_term", "Term 3")
    rows = []
    if class_id:
        students = q("""SELECT st.id, st.admission_no, st.first_name, st.last_name, st.gender
                        FROM enrollments e JOIN students st ON st.id=e.student_id
                        WHERE e.class_id=? AND e.term=? ORDER BY st.first_name""", (class_id, term))
        existing = q("SELECT student_id, status FROM attendance WHERE date=? AND class_id=?", (date_, class_id))
        emap = {r["student_id"]: r["status"] for r in existing}
        rows = [{**dict(st), "status": emap.get(st["id"], "Present")} for st in students]
    classes = rows_to_dicts(q("SELECT c.id, c.name FROM classes c WHERE c.academic_year=? ORDER BY c.name",
                              (s.get("academic_year", "2026"),)))
    return jsonify({"date": date_, "class_id": class_id, "classes": classes, "rows": rows})

@app.route("/api/attendance", methods=["POST"])
@academic_required
def save_attendance():
    d = request.get_json(force=True) or {}
    date_ = d.get("date") or datetime.date.today().isoformat()
    class_id = d.get("class_id")
    if not class_id:
        return jsonify({"error": "class_id required"}), 400
    cur = db()
    n = 0
    for rec in d.get("records", []):
        cur.execute("""INSERT INTO attendance(date,class_id,student_id,status) VALUES(?,?,?,?)
                       ON CONFLICT(date,class_id,student_id) DO UPDATE SET status=excluded.status""",
                    (date_, class_id, rec["student_id"], rec["status"]))
        n += 1
    cur.commit()
    return jsonify({"saved": n})

@app.route("/api/attendance/summary")
@login_required
def attendance_summary():
    class_id = request.args.get("class_id")
    from_ = request.args.get("from")
    to_ = request.args.get("to") or datetime.date.today().isoformat()
    if not class_id:
        return jsonify({"error": "class_id required"}), 400
    rows = q("""SELECT date, status, COUNT(*) c FROM attendance
                WHERE class_id=? AND (date BETWEEN ? AND ?)
                GROUP BY date, status ORDER BY date""", (class_id, from_ or "2026-01-01", to_))
    days = {}
    for r in rows:
        days.setdefault(r["date"], {"Present": 0, "Absent": 0, "Late": 0, "Permission": 0})
        days[r["date"]][r["status"]] = r["c"]
    return jsonify({"days": [{"date": d, **v} for d, v in sorted(days.items())]})

# ------------------------------------------------------------------ communication
@app.route("/api/announcements")
@any_required
def announcements():
    return jsonify(rows_to_dicts(q("SELECT * FROM announcements ORDER BY id DESC")))

@app.route("/api/announcements", methods=["POST"])
@admin_required
def add_announcement():
    d = request.get_json(force=True) or {}
    if not d.get("title") or not d.get("message"):
        return jsonify({"error": "title and message required"}), 400
    aid = exe("INSERT INTO announcements(title,message,audience,created_by) VALUES(?,?,?,?)",
              (d["title"], d["message"], d.get("audience") or "All", acting_name()))
    log_activity("Announcement posted", d["title"])
    s = settings_map()
    for st in students_with_class():
        if st.get("parent_phone"):
            exe("""INSERT INTO sms_log(to_phone,parent_name,student_name,message,category,status)
                   VALUES(?,?,?,?,?,?)""",
                (st["parent_phone"], st.get("parent_name"), f"{st['first_name']} {st['last_name']}",
                 f"{d['title']}: {d['message'][:140]}", "Announcement", "Queued"))
    return jsonify({"id": aid})

@app.route("/api/smslog")
@login_required
def smslog():
    return jsonify(rows_to_dicts(q("""SELECT * FROM sms_log ORDER BY id DESC LIMIT 100""")))

@app.route("/api/activity")
@login_required
def activity_feed():
    rows = q("""SELECT a.*, u.full_name user_name, u.role user_role
                FROM activity_log a LEFT JOIN users u ON u.id=a.user_id
                ORDER BY a.id DESC LIMIT 12""")
    return jsonify(rows_to_dicts(rows))

# ------------------------------------------------------------------ guardian portal
def guardian_student_ids():
    u = auth_user()
    if not u:
        return []
    rows = q("SELECT student_id FROM guardian_links WHERE user_id=?", (u["id"],))
    return [r["student_id"] for r in rows]

def ensure_guardian(sid):
    return sid in guardian_student_ids()

@app.route("/api/guardian/children")
@guardian_required
def guardian_children():
    ids = guardian_student_ids()
    out = []
    for st in students_with_class():
        if st["id"] in ids:
            out.append({"student_id": st["id"],
                        "name": f"{st['first_name']} {st['last_name']}",
                        "admission_no": st["admission_no"],
                        "class_name": st.get("class_name") or "—",
                        "gender": st["gender"], "profile_pic": st.get("profile_pic")})
    return jsonify(out)

@app.route("/api/guardian/dashboard")
@guardian_required
def guardian_dashboard():
    sid = request.args.get("student_id", type=int)
    if not ensure_guardian(sid):
        return jsonify({"error": "Forbidden"}), 403
    st = q1("SELECT * FROM students WHERE id=?", (sid,))
    s = settings_map()
    term, year = s.get("current_term", "Term 3"), s.get("academic_year", "2026")
    cl = student_class(sid)
    # latest exam with results for this student
    ex = q1("""SELECT e.* FROM exams e WHERE EXISTS (
                 SELECT 1 FROM exam_scores es WHERE es.exam_id=e.id AND es.student_id=?)
               ORDER BY e.id DESC LIMIT 1""", (sid,))
    summary = None
    if ex:
        agg = q1("""SELECT COUNT(*) subjects, SUM(points) total_points, ROUND(AVG(score),1) mean,
                            ROUND(AVG(points),2) avg_pts
                    FROM exam_scores WHERE exam_id=? AND student_id=?""", (ex["id"], sid))
        if agg and agg["subjects"]:
            peers = q("""SELECT es.student_id, ROUND(AVG(es.points),2) avg_pts
                         FROM exam_scores es
                         JOIN enrollments e ON e.student_id=es.student_id AND e.term=? AND e.academic_year=?
                         JOIN classes c ON c.id=e.class_id
                         WHERE es.exam_id=? AND c.id=?
                         GROUP BY es.student_id""", (term, year, ex["id"], cl["id"] if cl else -1))
            peers = sorted(peers, key=lambda r: -r["avg_pts"])
            rank = next((i + 1 for i, p in enumerate(peers) if p["student_id"] == sid), None)
            summary = {"exam_id": ex["id"], "exam_name": ex["name"], "term": ex["term"],
                       "mean": agg["mean"], "total_points": agg["total_points"],
                       "avg_pts": agg["avg_pts"], "subjects": agg["subjects"],
                       "class_rank": rank, "class_size": len(peers)}
    billed = billed_for(sid, term, year)
    paid = paid_for(sid, term, year)
    route = q1("""SELECT tr.* FROM transport_assignments ta
                  JOIN transport_routes tr ON tr.id=ta.route_id
                  WHERE ta.student_id=? AND ta.academic_year=? AND ta.status='Active'""", (sid, year))
    att_days = q("""SELECT date, status FROM attendance
                    WHERE student_id=? ORDER BY date DESC LIMIT 10""", (sid,))
    att_counts = {"Present": 0, "Absent": 0, "Late": 0, "Permission": 0}
    for r in att_days:
        att_counts[r["status"]] = att_counts.get(r["status"], 0) + 1
    ann = rows_to_dicts(q("SELECT * FROM announcements ORDER BY id DESC LIMIT 3"))
    return jsonify({"student": dict(st), "class": cl,
                    "scale": scale_for_grade(cl["grade"] if cl else "Grade 7"),
                    "exam": summary, "billed": billed, "paid": paid, "balance": billed - paid,
                    "transport": dict(route) if route else None,
                    "attendance": {"recent_days": len(att_days), **att_counts},
                    "announcements": ann, "term": term, "year": year})

@app.route("/api/guardian/results")
@guardian_required
def guardian_results():
    sid = request.args.get("student_id", type=int)
    if not ensure_guardian(sid):
        return jsonify({"error": "Forbidden"}), 403
    st = q1("SELECT * FROM students WHERE id=?", (sid,))
    cl = student_class(sid)
    exam_id = request.args.get("exam_id", type=int)
    exams = q("SELECT * FROM exams ORDER BY id")
    selected = q1("SELECT * FROM exams WHERE id=?", (exam_id,)) if exam_id else exams[-1] if exams else None
    if not selected:
        return jsonify({"exams": rows_to_dicts(exams), "selected_exam": None, "per_subject": [], "agg": None}), 200
    per_subject = rows_to_dicts(q("""SELECT su.name, es.score, es.grade, es.points,
                                     (SELECT ROUND(AVG(score),1) FROM exam_scores x
                                      WHERE x.exam_id=? AND x.subject_id=su.id) subject_mean
                                     FROM exam_scores es JOIN subjects su ON su.id=es.subject_id
                                     WHERE es.exam_id=? AND es.student_id=?
                                     ORDER BY es.points DESC""", (selected["id"], selected["id"], sid)))
    agg = q1("""SELECT COUNT(*) subjects, SUM(points) total_points, ROUND(AVG(score),1) mean,
                ROUND(AVG(points),2) avg_pts FROM exam_scores WHERE exam_id=? AND student_id=?""",
             (selected["id"], sid))
    term, year = selected["term"], selected["academic_year"]
    peers = q("""SELECT es.student_id, ROUND(AVG(es.points),2) avg_pts
                 FROM exam_scores es
                 JOIN enrollments e ON e.student_id=es.student_id AND e.term=? AND e.academic_year=?
                 JOIN classes c ON c.id=e.class_id
                 WHERE es.exam_id=? AND c.id=?
                 GROUP BY es.student_id""", (term, year, selected["id"], cl["id"] if cl else -1))
    peers = sorted(peers, key=lambda r: -r["avg_pts"])
    rank = next((i + 1 for i, p in enumerate(peers) if p["student_id"] == sid), None)
    return jsonify({"exams": rows_to_dicts(exams), "selected_exam": dict(selected),
                    "student": dict(st), "scale": scale_for_grade(cl["grade"] if cl else "Grade 7"),
                    "per_subject": per_subject,
                    "agg": dict(agg) if agg and agg["subjects"] else None,
                    "class_rank": rank, "class_size": len(peers)})

@app.route("/api/guardian/statement")
@guardian_required
def guardian_statement():
    sid = request.args.get("student_id", type=int)
    if not ensure_guardian(sid):
        return jsonify({"error": "Forbidden"}), 403
    data = statement_data(sid)
    if not data:
        return jsonify({"error": "Not found"}), 404
    return jsonify(data)

@app.route("/api/guardian/pay", methods=["POST"])
@guardian_required
def guardian_pay():
    d = request.get_json(force=True) or {}
    sid = d.get("student_id")
    if not ensure_guardian(sid):
        return jsonify({"error": "Forbidden"}), 403
    amount = float(d.get("amount") or 0)
    if amount <= 0:
        return jsonify({"error": "Enter a valid amount"}), 400
    ptid = d.get("payment_type_id")
    if ptid:
        pt = q1("SELECT * FROM payment_types WHERE id=? AND active=1", (ptid,))
        if not pt:
            return jsonify({"error": "Invalid payment type"}), 400
    receipt = "RCP-" + str(q1("SELECT COALESCE(MAX(CAST(SUBSTR(receipt_no,5) AS INTEGER)),9999)+1 m FROM fee_payments")["m"])
    import secrets as _s
    ref = d.get("reference") or "MP" + _s.token_hex(4).upper()
    pid = exe("""INSERT INTO fee_payments(student_id,payment_type_id,amount,payment_date,term,method,reference,receipt_no,recorded_by,notes)
                 VALUES(?,?,?,?,?,?,?,?,?,?)""",
              (sid, d.get("payment_type_id"), amount, datetime.date.today().isoformat(),
               settings_map().get("current_term", "Term 3"), "M-PESA", ref, receipt,
               acting_name(), "Paid via Parent Portal (M-PESA)"))
    log_activity("Portal payment", f"{receipt} · {fmt_amount(amount)} · {acting_name()}")
    return jsonify({"id": pid, "receipt_no": receipt})

@app.route("/api/guardian/transport")
@guardian_required
def guardian_transport():
    sid = request.args.get("student_id", type=int)
    if not ensure_guardian(sid):
        return jsonify({"error": "Forbidden"}), 403
    year = settings_map().get("academic_year", "2026")
    route = q1("""SELECT tr.* FROM transport_assignments ta
                  JOIN transport_routes tr ON tr.id=ta.route_id
                  WHERE ta.student_id=? AND ta.academic_year=? AND ta.status='Active'""", (sid, year))
    logs = rows_to_dicts(q("""SELECT date, period, status FROM transport_log
                              WHERE student_id=? ORDER BY date DESC, period DESC LIMIT 12""", (sid,)))
    return jsonify({"route": dict(route) if route else None, "logs": logs})

@app.route("/api/guardian/attendance")
@guardian_required
def guardian_attendance():
    sid = request.args.get("student_id", type=int)
    if not ensure_guardian(sid):
        return jsonify({"error": "Forbidden"}), 403
    cl = student_class(sid)
    rows = q("""SELECT date, status FROM attendance
                WHERE student_id=? AND class_id=?
                ORDER BY date DESC LIMIT 15""", (sid, cl["id"] if cl else -1))
    counts = {"Present": 0, "Absent": 0, "Late": 0, "Permission": 0}
    days = []
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        days.append({"date": r["date"], "status": r["status"]})
    days.reverse()
    total = sum(counts.values())
    rate = round((counts["Present"] + counts["Late"] + counts["Permission"]) / total * 100) if total else 0
    return jsonify({"days": days, "counts": counts, "rate": rate, "total": total})

# ------------------------------------------------------------------ curriculum guide
@app.route("/api/curriculum")
@any_required
def curriculum():
    bands = [
        {"key": "lower", "label": "Lower Primary", "grades": "Grade 1 – 3",
         "scale": "CBC Achievement Levels", "gmin": 1, "gmax": 3},
        {"key": "upper", "label": "Upper Primary", "grades": "Grade 4 – 6",
         "scale": "CBC Achievement Levels", "gmin": 4, "gmax": 6},
        {"key": "jss", "label": "Junior Secondary", "grades": "Grade 7 – 9",
         "scale": "CBC Achievement Levels", "gmin": 7, "gmax": 9},
        {"key": "senior", "label": "Senior Secondary", "grades": "Grade 10 – 12",
         "scale": "KCSE 12-point (A–E)", "gmin": 10, "gmax": 12},
    ]
    all_subj = q("SELECT * FROM subjects ORDER BY name")
    for b in bands:
        subj = []
        for s in all_subj:
            try:
                gs = [int(x) for x in (s["grades"] or "").split(",") if x.strip().isdigit()]
            except Exception:
                gs = []
            if any(b["gmin"] <= g <= b["gmax"] for g in gs):
                subj.append({"id": s["id"], "name": s["name"], "code": s["code"], "category": s["category"]})
        b["subjects"] = subj
    return jsonify(bands)

# ------------------------------------------------------------------ library
@app.route("/api/library/books")
@any_required
def library_books():
    q_ = request.args.get("q", "").strip().lower()
    cat = request.args.get("category", "")
    rows = q("""SELECT b.*,
                       (SELECT COUNT(*) FROM book_issues i WHERE i.book_id=b.id AND i.status IN ('Issued','Overdue')) out_count
                FROM books b ORDER BY b.title""")
    out = []
    for r in rows:
        b = dict(r)
        if q_ and q_ not in (b["title"] + " " + (b["author"] or "") + " " + (b["isbn"] or "")).lower():
            continue
        if cat and b["category"] != cat:
            continue
        b["status"] = "Out" if b["available_copies"] <= 0 else ("Low" if b["available_copies"] <= 2 else "Available")
        out.append(b)
    return jsonify(out)

@app.route("/api/library/books", methods=["POST"])
@library_required
def library_add_book():
    d = request.get_json(force=True) or {}
    if not d.get("title"):
        return jsonify({"error": "Book title required"}), 400
    copies = max(1, int(d.get("total_copies") or 1))
    bid = exe("""INSERT INTO books(title,author,isbn,publisher,category,year,total_copies,available_copies,shelf)
                 VALUES(?,?,?,?,?,?,?,?,?)""",
              (d["title"].strip(), d.get("author"), d.get("isbn"), d.get("publisher"),
               d.get("category") or "Textbook", d.get("year"), copies, copies, d.get("shelf")))
    log_activity("Book added", f"{d['title'].strip()} ({copies} copies)")
    return jsonify({"id": bid})

@app.route("/api/library/books/<int:bid>", methods=["PUT"])
@library_required
def library_update_book(bid):
    d = request.get_json(force=True) or {}
    fields = ["title", "author", "isbn", "publisher", "category", "year", "shelf"]
    sets = [f for f in fields if f in d]
    if "total_copies" in d:
        cur = db()
        out = q1("SELECT COUNT(*) c FROM book_issues WHERE book_id=? AND status IN ('Issued','Overdue')", (bid,))["c"]
        new_total = max(int(d["total_copies"]), out)
        cur.execute("UPDATE books SET total_copies=?, available_copies=? WHERE id=?", (new_total, new_total - out, bid))
        cur.commit()
    if sets:
        exe("UPDATE books SET " + ", ".join(f"{f}=?" for f in sets) + " WHERE id=?", tuple(d[f] for f in sets) + (bid,))
    log_activity("Book updated", f"#{bid}")
    return jsonify({"ok": True})

@app.route("/api/library/books/<int:bid>", methods=["DELETE"])
@library_required
def library_delete_book(bid):
    out = q1("SELECT COUNT(*) c FROM book_issues WHERE book_id=? AND status IN ('Issued','Overdue')", (bid,))["c"]
    if out:
        return jsonify({"error": "Cannot delete — copies are currently issued out"}), 400
    exe("DELETE FROM book_issues WHERE book_id=?", (bid,))
    b = q1("SELECT * FROM books WHERE id=?", (bid,))
    exe("DELETE FROM books WHERE id=?", (bid,))
    log_activity("Book removed", b["title"] if b else f"#{bid}")
    return jsonify({"ok": True})

@app.route("/api/library/issues")
@any_required
def library_issues():
    status = request.args.get("status", "")
    rows = q("""SELECT i.*, b.title book_title, b.author book_author, b.category book_category,
                       st.first_name, st.last_name, st.admission_no, c.name class_name
                FROM book_issues i
                JOIN books b ON b.id=i.book_id
                JOIN students st ON st.id=i.student_id
                LEFT JOIN enrollments e ON e.student_id=st.id AND e.term=(SELECT value FROM settings WHERE key='current_term')
                LEFT JOIN classes c ON c.id=e.class_id
                ORDER BY i.id DESC LIMIT 200""")
    out = []
    for r in rows:
        d = dict(r)
        d["student_name"] = f"{d['first_name']} {d['last_name']}"
        if status and d["status"] != status:
            continue
        out.append(d)
    return jsonify(out)

@app.route("/api/library/issue", methods=["POST"])
@library_required
def library_issue():
    d = request.get_json(force=True) or {}
    bid, sid = d.get("book_id"), d.get("student_id")
    if not bid or not sid:
        return jsonify({"error": "book_id and student_id required"}), 400
    book = q1("SELECT * FROM books WHERE id=?", (bid,))
    st = q1("SELECT * FROM students WHERE id=?", (sid,))
    if not book or not st:
        return jsonify({"error": "Book or student not found"}), 404
    if book["available_copies"] <= 0:
        return jsonify({"error": "No copies of this book are currently available"}), 400
    due = d.get("due_date") or (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
    iid = exe("""INSERT INTO book_issues(book_id,student_id,issue_date,due_date,status,issued_by,notes)
                 VALUES(?,?,?,?,?,?,?)""",
              (bid, sid, datetime.date.today().isoformat(), due, "Issued", acting_name(), d.get("notes")))
    exe("UPDATE books SET available_copies=available_copies-1 WHERE id=?", (bid,))
    log_activity("Book issued", f"{book['title']} -> {st['first_name']} {st['last_name']} (due {due})")
    return jsonify({"id": iid})

@app.route("/api/library/return/<int:iid>", methods=["POST"])
@library_required
def library_return(iid):
    rec = q1("SELECT * FROM book_issues WHERE id=?", (iid,))
    if not rec:
        return jsonify({"error": "Issue record not found"}), 404
    if rec["status"] in ("Returned",):
        return jsonify({"error": "This book was already returned"}), 400
    exe("UPDATE book_issues SET return_date=?, status='Returned' WHERE id=?",
        (datetime.date.today().isoformat(), iid))
    exe("UPDATE books SET available_copies=available_copies+1 WHERE id=?", (rec["book_id"],))
    log_activity("Book returned", f"issue #{iid}")
    return jsonify({"ok": True})

@app.route("/api/library/summary")
@any_required
def library_summary():
    total = q1("SELECT COUNT(*) c FROM books")["c"]
    copies = q1("SELECT COALESCE(SUM(total_copies),0) c FROM books")["c"]
    available = q1("SELECT COALESCE(SUM(available_copies),0) c FROM books")["c"]
    issued = q1("SELECT COUNT(*) c FROM book_issues WHERE status IN ('Issued','Overdue')")["c"]
    overdue = q1("SELECT COUNT(*) c FROM book_issues WHERE status='Overdue'")["c"]
    return jsonify({"total_titles": total, "total_copies": copies, "available": available,
                    "issued": issued, "overdue": overdue})

# ------------------------------------------------------------------ settings
@app.route("/api/settings", methods=["GET", "PUT"])
@any_required
def settings_endpoint():
    if request.method == "GET":
        return jsonify(settings_map())
    if auth_user()["role"] != "admin":
        return jsonify({"error": "Forbidden"}), 403
    d = request.get_json(force=True) or {}
    cur = db()
    for k, v in d.items():
        cur.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v)))
    cur.commit()
    return jsonify({"ok": True})

if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        print("Database not found — run seed.py first")
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
