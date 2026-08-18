#!/usr/bin/env python3
"""Seed the ElimuPro school database with schema + realistic sample data.

Uses the current Kenyan Competency-Based Curriculum (CBC):
  - Lower Primary (Grade 1-3), Upper Primary (Grade 4-6),
    Junior Secondary (Grade 7-9), Senior Secondary (Grade 10-12)
  - CBC 4-level achievement grading in ALL grades
    (Exceeding / Meeting / Approaching / Below Expectations — E, M, A, B)
"""
import os
import random
import sqlite3
import hashlib
import secrets
import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "school.db")

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','accounts','guardian','librarian')),
  teacher_id INTEGER REFERENCES teachers(id),
  profile_pic TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS guardian_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  UNIQUE(user_id, student_id)
);

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tsc_no TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT,
  phone TEXT,
  email TEXT,
  subject_id INTEGER REFERENCES subjects(id),
  employment_type TEXT DEFAULT 'Permanent',
  profile_pic TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  stream TEXT,
  academic_year TEXT DEFAULT '2026',
  capacity INTEGER DEFAULT 45,
  class_teacher_id INTEGER REFERENCES teachers(id)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  gender TEXT,
  dob TEXT,
  admission_date TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  parent_email TEXT,
  address TEXT,
  status TEXT DEFAULT 'Active',
  profile_pic TEXT,
  blood_group TEXT,
  house TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  term TEXT,
  academic_year TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  category TEXT,
  grades TEXT,
  teacher_id INTEGER REFERENCES teachers(id)
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  term TEXT NOT NULL,
  academic_year TEXT,
  max_score REAL DEFAULT 100,
  status TEXT DEFAULT 'Open'
);

CREATE TABLE IF NOT EXISTS exam_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  score REAL,
  grade TEXT,
  points INTEGER,
  UNIQUE(exam_id, student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER REFERENCES classes(id),
  term TEXT,
  academic_year TEXT,
  amount REAL,
  UNIQUE(class_id, term, academic_year)
);

CREATE TABLE IF NOT EXISTS payment_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'Fees',
  default_amount REAL,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fee_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  payment_type_id INTEGER REFERENCES payment_types(id),
  amount REAL NOT NULL,
  payment_date TEXT,
  term TEXT,
  method TEXT,
  reference TEXT,
  receipt_no TEXT,
  recorded_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  status TEXT NOT NULL,
  UNIQUE(date, class_id, student_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  message TEXT,
  audience TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_phone TEXT,
  parent_name TEXT,
  student_name TEXT,
  message TEXT,
  category TEXT,
  status TEXT DEFAULT 'Sent',
  sent_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transport_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  route_no TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  capacity INTEGER DEFAULT 40,
  morning_time TEXT DEFAULT '6:30 AM',
  evening_time TEXT DEFAULT '4:30 PM',
  fee REAL DEFAULT 0,
  status TEXT DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS transport_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  route_id INTEGER NOT NULL REFERENCES transport_routes(id),
  academic_year TEXT,
  status TEXT DEFAULT 'Active',
  UNIQUE(student_id, academic_year)
);

CREATE TABLE IF NOT EXISTS transport_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  route_id INTEGER NOT NULL REFERENCES transport_routes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  period TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(date, route_id, student_id, period)
);

CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  day TEXT NOT NULL,
  period INTEGER NOT NULL,
  subject_id INTEGER REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES teachers(id),
  UNIQUE(class_id, day, period)
);

CREATE TABLE IF NOT EXISTS exam_comments (
  exam_id INTEGER NOT NULL REFERENCES exams(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  comment TEXT,
  PRIMARY KEY(exam_id, student_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  isbn TEXT,
  publisher TEXT,
  category TEXT DEFAULT 'Textbook',
  year INTEGER,
  total_copies INTEGER DEFAULT 1,
  available_copies INTEGER DEFAULT 1,
  shelf TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS book_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  issue_date TEXT,
  due_date TEXT,
  return_date TEXT,
  status TEXT DEFAULT 'Issued',
  notes TEXT,
  issued_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conduct_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  record_type TEXT NOT NULL CHECK(record_type IN ('Merit','Demerit')),
  category TEXT,
  description TEXT,
  record_date TEXT,
  recorded_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS school_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  audience TEXT DEFAULT 'All',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
"""

# ------------------------------------------------------------------ CBC curriculum
# grades = comma-separated grade numbers the subject is taught in
SUBJECTS = [
    ("English", "ENG", "Languages", "1,2,3,4,5,6,7,8,9,10,11,12"),
    ("Kiswahili", "KIS", "Languages", "1,2,3,4,5,6,7,8,9,10,11,12"),
    ("Mathematics", "MAT", "Core", "1,2,3,4,5,6,7,8,9,10,11,12"),
    ("Environmental Activities", "ENV", "Core", "1,2,3"),
    ("Hygiene & Nutrition Activities", "HGN", "Core", "1,2,3"),
    ("Movement & Creative Activities", "MCA", "Creative", "1,2,3"),
    ("Religious Education (CRE)", "CRE", "Humanities", "1,2,3,4,5,6,7,8,9,10,11,12"),
    ("Integrated Science", "SCI", "Sciences", "4,5,6,7,8,9,10,11,12"),
    ("Social Studies", "SST", "Humanities", "4,5,6,7,8,9,10,11,12"),
    ("Creative Arts", "CRA", "Creative", "4,5,6"),
    ("Agriculture", "AGR", "Technical", "4,5,6,7,8,9,10,11,12"),
    ("Home Science", "HSC", "Technical", "4,5,6,10,11,12"),
    ("Physical Education & Sports", "PES", "Core", "4,5,6,7,8,9,10,11,12"),
    ("Business Studies", "BUS", "Technical", "7,8,9,10,11,12"),
    ("Pre-Technical & Pre-Career Studies", "PTP", "Technical", "7,8,9"),
    ("Health Education", "HED", "Sciences", "7,8,9"),
    ("Life Skills Education", "LSE", "Core", "7,8,9"),
    ("Biology", "BIO", "Sciences", "10,11,12"),
    ("Chemistry", "CHE", "Sciences", "10,11,12"),
    ("Physics", "PHY", "Sciences", "10,11,12"),
    ("Geography", "GEO", "Humanities", "10,11,12"),
    ("History & Government", "HGS", "Humanities", "10,11,12"),
    ("Computer Science", "COM", "Technical", "10,11,12"),
]

def grades_list(grades_str):
    return [int(x) for x in (grades_str or "").split(",") if x.strip().isdigit()]

def subject_for_grade(subj, gnum):
    return gnum in grades_list(subj["grades"])

# ------------------------------------------------------------------ grading scales
# CBC achievement levels (E, M, A, B) — used in ALL grades
CBC_BANDS = [
    (80, "E", "Exceeding Expectations", 4),
    (65, "M", "Meeting Expectations", 3),
    (50, "A", "Approaching Expectations", 2),
    (0,  "B", "Below Expectations", 1),
]

def grade_for(score, scale="cbc"):
    if score is None:
        return None, None
    for lo, letter, _name, pts in CBC_BANDS:
        if score >= lo:
            return letter, pts
    return "B", 1

# ------------------------------------------------------------------ name banks
MALE = ["Brian","Kevin","Dennis","Collins","Moses","David","Samuel","Peter","James","John","Daniel",
        "Kelvin","Victor","Emmanuel","Felix","Mark","Anthony","Eric","George","Vincent","Evans",
        "Nicholas","Stephen","Michael","Isaac","Amos","Kiprotich","Kiptoo","Kosgei","Mutua","Kamau",
        "Maina","Kariuki","Ochieng","Onsongo","Ongwae","Nyambane","Moturi","Mose","Momanyi","Letema",
        "Nyakundi","Kebaso","Machogu","Matoke","Baraka","Musa","Kipchoge","Rono","Korir","Cheruiyot",
        "Njuguna","Waweru","Githinji","Mwangi","Kibet","Rotich","Sang","Koech","Langat","Tanui",
        "Hassan","Ali","Omar","Abdi","Osman","Juma","Okoth","Oduor","Opiyo","Onyango"]

FEMALE = ["Faith","Mercy","Grace","Mary","Jane","Esther","Naomi","Ruth","Dorcas","Susan","Agnes",
          "Beatrice","Caroline","Cynthia","Diana","Emily","Florence","Gladys","Hellen","Irene","Janet",
          "Joyce","Judith","Lucy","Margaret","Nancy","Pamela","Peninah","Rose","Sarah","Sharon","Winnie",
          "Mwende","Wanjiku","Nyambura","Wangari","Chebet","Chepkoech","Jepkorir","Jerono","Kerubo",
          "Nyaboke","Moraa","Ogechi","Kwamboka","Bosibori","Nyakerario","Nyanchama","Akinyi","Achieng",
          "Adhiambo","Atieno","Anyango","Nasimiyu","Valary","Brenda","Sheila","Linet","Beryl","Vivian"]

SURNAMES = ["Otieno","Odhiambo","Ochieng","Omondi","Owino","Onyango","Ouma","Kamau","Kariuki","Mwangi",
            "Njeri","Wanjiku","Njoroge","Maina","Kiptoo","Kosgei","Rono","Cheruiyot","Kiprop","Mutua",
            "Musyoka","Muli","Ndambuki","Kioko","Wambua","Muthoka","Opiyo","Okoth","Oduor","Barasa",
            "Wekesa","Simiyu","Nandwa","Wafula","Masinde","Khaemba","Onsongo","Ongwae","Nyambane","Moturi",
            "Machogu","Momanyi","Moseti","Kerubo","Moraa","Ogechi","Nyaboke","Bosibori","Maroa","Amugune",
            "Ondieki","Mose","Nyakundi","Kebaso","Matoke","Sawe","Kipchumba","Letting","Koech","Tanui",
            "Kibet","Sang","Chepkwony","Kipkorir","Yego","Ngetich","Lagat","Achieng","Atieno","Adhiambo",
            "Okello","Aringo","Wanyama","Wechuli","Nakhumicha","Sitati"]

PHONE_PREFIX = ["0712","0722","0733","0740","0701","0757","0791","0110","0115","0735","0721","0745"]

def rand_phone():
    return random.choice(PHONE_PREFIX) + "".join(random.choice("0123456789") for _ in range(7))

def mpesa_ref():
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "SGK" + "".join(random.choice(chars) for _ in range(8))

def dob_for_age(age):
    y = 2026 - age
    m = random.randint(1, 12)
    d = random.randint(1, 28)
    return f"{y:04d}-{m:02d}-{d:02d}"

def school_days(count, start=datetime.date(2026, 8, 1)):
    days, d = [], start
    while len(days) < count:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += datetime.timedelta(days=1)
    return days

def seed():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.executescript(SCHEMA)

    rnd = random.Random(42)

    # subjects (CBC curriculum) -------------------------------------------
    cur.executemany("INSERT INTO subjects(name,code,category,grades) VALUES(?,?,?,?)",
                    [(s[0], s[1], s[2], s[3]) for s in SUBJECTS])
    subj_rows = cur.execute("SELECT * FROM subjects ORDER BY id").fetchall()

    # teachers -------------------------------------------------------------
    teacher_first = ["Jane","Peter","Diana","Samuel","Grace","Kelvin","Esther","David","Mercy","Brian","Ruth","Vincent"]
    teacher_last = ["Atieno","Mwangi","Chebet","Omondi","Wanjiru","Kiptoo","Nyaboke","Kariuki","Achieng","Otieno","Kerubo","Kosgei"]
    teacher_titles = ["Madam","Mr","Madam","Mr","Madam","Mr","Madam","Mr","Madam","Mr","Madam","Mr"]
    # map teachers to the main CBC subjects
    teach_subj_idx = [0, 1, 2, 7, 8, 10, 12, 14, 15, 16, 17, 18]  # English, Kis, Math, SCI, SST, AGR, PES, PTP, HED, LSE, BIO, CHE
    teachers = []
    for i, (fn, ln, ttl) in enumerate(zip(teacher_first, teacher_last, teacher_titles)):
        gender = "Female" if ttl == "Madam" else "Male"
        teachers.append((f"TSC-{202001+i}", fn, ln, gender, rand_phone(),
                         f"{fn.lower()}.{ln.lower()}@greenfield.ac.ke", subj_rows[teach_subj_idx[i]]["id"], "Permanent"))
    cur.executemany("""INSERT INTO teachers(tsc_no,first_name,last_name,gender,phone,email,subject_id,employment_type)
                       VALUES(?,?,?,?,?,?,?,?)""", teachers)
    teacher_ids = [r["id"] for r in cur.execute("SELECT id FROM teachers ORDER BY id")]
    for i, tid in enumerate(teacher_ids):
        cur.execute("UPDATE subjects SET teacher_id=? WHERE id=?", (tid, subj_rows[teach_subj_idx[i]]["id"]))

    # classes --------------------------------------------------------------
    class_defs = [
        ("Grade 1 East", "Grade 1", "East", teacher_ids[0], 8),
        ("Grade 1 West", "Grade 1", "West", teacher_ids[1], 8),
        ("Grade 7 East", "Grade 7", "East", teacher_ids[2], 12),
        ("Grade 7 West", "Grade 7", "West", teacher_ids[3], 11),
        ("Grade 8 East", "Grade 8", "East", teacher_ids[4], 12),
        ("Grade 8 West", "Grade 8", "West", teacher_ids[5], 11),
        ("Grade 9 East", "Grade 9", "East", teacher_ids[6], 12),
        ("Grade 9 West", "Grade 9", "West", teacher_ids[7], 11),
        ("Grade 10 East", "Grade 10", "East", teacher_ids[8], 10),
    ]
    cur.executemany("""INSERT INTO classes(name,grade,stream,academic_year,capacity,class_teacher_id)
                       VALUES(?,?,?,?,?,?)""",
                    [(n, g, s, "2026", 45, t) for n, g, s, t, _ in class_defs])
    class_ids = [r["id"] for r in cur.execute("SELECT id FROM classes ORDER BY id")]
    grade_of_class = {cid: cd[1] for cd, cid in zip(class_defs, class_ids)}

    # students -------------------------------------------------------------
    students, enroll_rows = [], []
    ages = {1: 7, 7: 13, 8: 14, 9: 15, 10: 16}
    sid = 1
    used_names = set()
    student_class_id = {}
    for ci, cid in enumerate(class_ids):
        grade = grade_of_class[cid]
        gnum = int(grade.split()[1])
        n = class_defs[ci][4]
        for _ in range(n):
            gender = rnd.choice(["Male", "Female"])
            fn = rnd.choice(MALE if gender == "Male" else FEMALE)
            ln = rnd.choice(SURNAMES)
            while (fn, ln) in used_names:
                fn = rnd.choice(MALE if gender == "Male" else FEMALE)
                ln = rnd.choice(SURNAMES)
            used_names.add((fn, ln))
            adm = f"GF/{2026 - (gnum - 1)}/{sid:03d}"
            pn = rnd.choice(MALE if rnd.random() < 0.5 else FEMALE) + " " + ln
            d = rnd.randint(1, 28); m = rnd.randint(1, 12)
            students.append((adm, fn, "", ln, gender, dob_for_age(ages[gnum]),
                             f"2026-01-{d:02d}" if m < 3 else f"2025-{m:02d}-{d:02d}",
                             pn, rand_phone(), f"{pn.replace(' ','.')}@gmail.com".lower(),
                             rnd.choice(["Kisii Town", "Nyanchwa", "Daraja Mbili", "Mwembe", "Getembe", "Kitutu", "Masongo", "Suneka", "Keroka"]),
                             "Active", rnd.choices(["O+","A+","B+","O-","A-","AB+","B-","AB-"], weights=[38,30,20,6,3,2,1,0])[0],
                             rnd.choice(["Simba","Chui","Nyati","Tembo"])))
            student_class_id[sid] = cid
            for term in ("Term 1", "Term 2", "Term 3"):
                enroll_rows.append((sid, cid, term, "2026"))
            sid += 1
    cur.executemany("""INSERT INTO students(admission_no,first_name,middle_name,last_name,gender,dob,admission_date,
                                            parent_name,parent_phone,parent_email,address,status,blood_group,house)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", students)
    student_ids = [r["id"] for r in cur.execute("SELECT id FROM students ORDER BY id")]
    cur.executemany("INSERT INTO enrollments(student_id,class_id,term,academic_year) VALUES(?,?,?,?)", enroll_rows)

    gnum_of_student = {st: int(grade_of_class[student_class_id[st]].split()[1]) for st in student_ids}

    # ability + exam scores (CBC subjects per grade) -----------------------
    ability = {st: rnd.gauss(0, 1) for st in student_ids}
    exams = [("End of Term 1 Exam 2026", "Term 1", "Closed"),
             ("End of Term 2 Exam 2026", "Term 2", "Closed"),
             ("End of Term 3 Exam 2026", "Term 3", "Open")]
    cur.executemany("INSERT INTO exams(name,term,academic_year,status) VALUES(?,?,?,?)",
                    [(n, t, "2026", s) for n, t, s in exams])
    exam_ids = [r["id"] for r in cur.execute("SELECT id FROM exams ORDER BY id")]

    subject_base = {
        "English": (57.0, 8.5), "Kiswahili": (60.0, 8.0), "Mathematics": (55.0, 11.0),
        "Integrated Science": (56.0, 10.0), "Social Studies": (58.0, 8.0),
        "Environmental Activities": (62.0, 7.0), "Hygiene & Nutrition Activities": (63.0, 7.0),
        "Movement & Creative Activities": (66.0, 7.0), "Religious Education (CRE)": (61.0, 8.0),
        "Creative Arts": (64.0, 8.0), "Agriculture": (57.0, 9.0), "Home Science": (59.0, 9.0),
        "Physical Education & Sports": (68.0, 7.0), "Business Studies": (56.0, 9.0),
        "Pre-Technical & Pre-Career Studies": (55.0, 9.0), "Health Education": (60.0, 8.0),
        "Life Skills Education": (62.0, 8.0), "Biology": (54.0, 10.0), "Chemistry": (52.0, 11.0),
        "Physics": (51.0, 11.0), "Geography": (55.0, 10.0), "History & Government": (57.0, 9.0),
        "Computer Science": (56.0, 10.0),
    }
    exam_rows = []
    for ei, eid in enumerate(exam_ids):
        term_progress = [0.9, 1.0, 1.1][ei]
        for st in student_ids:
            gnum = gnum_of_student[st]
            scale = "cbc"
            for subj in subj_rows:
                if not subject_for_grade(subj, gnum):
                    continue
                base, sd = subject_base.get(subj["name"], (56.0, 9.0))
                raw = base * term_progress + ability[st] * sd * 0.8 + rnd.gauss(0, sd * 0.5)
                score = max(8, min(99, round(raw)))
                letter, pts = grade_for(score, scale)
                exam_rows.append((eid, st, subj["id"], score, letter, pts))
    cur.executemany("""INSERT INTO exam_scores(exam_id,student_id,subject_id,score,grade,points)
                       VALUES(?,?,?,?,?,?)""", exam_rows)

    # payment types ---------------------------------------------------------
    ptypes = [
        ("Tuition Fees", "Fees", None),
        ("Transport", "Transport", None),
        ("Examination Fee", "Fees", 500),
        ("Uniform", "Other", None),
        ("Library", "Other", 200),
        ("Sports & Games", "Other", 300),
        ("Development Fund", "Fees", 1000),
    ]
    cur.executemany("INSERT INTO payment_types(name,category,default_amount) VALUES(?,?,?)", ptypes)
    ptype_ids = {r["name"]: r["id"] for r in cur.execute("SELECT id, name FROM payment_types")}

    def pick_type():
        r = rnd.random()
        if r < 0.70: return ptype_ids["Tuition Fees"]
        if r < 0.85: return ptype_ids["Transport"]
        if r < 0.90: return ptype_ids["Examination Fee"]
        if r < 0.93: return ptype_ids["Uniform"]
        if r < 0.96: return ptype_ids["Sports & Games"]
        if r < 0.98: return ptype_ids["Library"]
        return ptype_ids["Development Fund"]

    # fee structures --------------------------------------------------------
    fee_amt = {1: 8500, 7: 18500, 8: 17000, 9: 20000, 10: 22000}
    fee_rows = []
    for cid in class_ids:
        g = int(grade_of_class[cid].split()[1])
        for term in ("Term 1", "Term 2", "Term 3"):
            fee_rows.append((cid, term, "2026", fee_amt[g]))
    cur.executemany("INSERT INTO fee_structures(class_id,term,academic_year,amount) VALUES(?,?,?,?)", fee_rows)

    # transport -------------------------------------------------------------
    routes = [
        ("Route A — Kisii Town", "RT-01", "Mr. Joel Nyakundi", "0722 411 203", 40, "6:30 AM", "4:30 PM", 3000),
        ("Route B — Daraja Mbili", "RT-02", "Mr. Patrick Ogechi", "0723 552 118", 35, "6:15 AM", "4:45 PM", 3500),
        ("Route C — Mwembe", "RT-03", "Mr. Josphat Momanyi", "0715 733 402", 30, "6:45 AM", "4:15 PM", 2500),
        ("Route D — Kitutu", "RT-04", "Madam Teresia Bosibori", "0792 844 550", 40, "6:00 AM", "5:00 PM", 4000),
    ]
    cur.executemany("""INSERT INTO transport_routes(name,route_no,driver_name,driver_phone,capacity,morning_time,evening_time,fee)
                       VALUES(?,?,?,?,?,?,?,?)""", routes)
    route_ids = [r["id"] for r in cur.execute("SELECT id FROM transport_routes ORDER BY id")]

    assign_rows = []
    for st in student_ids:
        if rnd.random() < 0.58:
            assign_rows.append((st, rnd.choice(route_ids), "2026", "Active"))
    cur.executemany("""INSERT INTO transport_assignments(student_id,route_id,academic_year,status)
                       VALUES(?,?,?,?)""", assign_rows)

    tlog_rows = []
    for day in school_days(5):
        for rid in route_ids:
            riders = [row[0] for row in assign_rows if row[1] == rid]
            for period in ("Morning", "Evening"):
                for st in riders:
                    r = rnd.random()
                    status = "Boarded" if r < 0.92 else ("Excused" if r < 0.96 else "Not Boarded")
                    tlog_rows.append((day, rid, st, period, status))
    cur.executemany("""INSERT INTO transport_log(date,route_id,student_id,period,status)
                       VALUES(?,?,?,?,?)""", tlog_rows)

    # timetable (per class, CBC subjects, conflict-free) --------------------
    subject_teacher = {r["id"]: r["teacher_id"] for r in subj_rows}
    slot_teachers = {}
    tt_rows = []
    weekdays = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
    for cid in class_ids:
        gnum = int(grade_of_class[cid].split()[1])
        class_subjects = [r["id"] for r in subj_rows if subject_for_grade(r, gnum)]
        day_used = {}
        for day in weekdays:
            day_used[day] = set()
            for p in range(1, 9):
                cand = [s for s in class_subjects
                        if subject_teacher.get(s) is None
                        or (subject_teacher[s] not in slot_teachers.get((day, p), set())
                            and s not in day_used[day])]
                if not cand:
                    cand = [s for s in class_subjects
                            if subject_teacher.get(s) is None
                            or subject_teacher[s] not in slot_teachers.get((day, p), set())]
                if not cand:
                    cand = class_subjects
                chosen = rnd.choice(cand)
                day_used[day].add(chosen)
                tid = subject_teacher.get(chosen)
                slot_teachers.setdefault((day, p), set()).add(tid)
                tt_rows.append((cid, day, p, chosen, tid))
    cur.executemany("INSERT INTO timetable(class_id,day,period,subject_id,teacher_id) VALUES(?,?,?,?,?)", tt_rows)

    # payments --------------------------------------------------------------
    method_pool = ["M-PESA"] * 7 + ["Cash"] * 2 + ["Bank Transfer"] * 1
    pay_rows, receipt = [], 10000
    for st in student_ids:
        class_id = student_class_id[st]
        fee = dict((r[0], r[1]) for r in cur.execute(
            "SELECT term,amount FROM fee_structures WHERE class_id=?", (class_id,)))
        route_fee = 0
        ar = [row for row in assign_rows if row[0] == st]
        if ar:
            rr = cur.execute("SELECT fee FROM transport_routes WHERE id=?", (ar[0][1],)).fetchone()
            route_fee = rr[0] if rr else 0
        t1 = fee["Term 1"] + route_fee
        paid1 = t1 if rnd.random() < 0.85 else round(t1 * rnd.choice([0.3, 0.5, 0.7]))
        pay_rows.append((st, pick_type(), paid1, "2026-02-" + f"{rnd.randint(3,26):02d}", "Term 1", rnd.choice(method_pool), mpesa_ref(), f"RCP-{receipt}", "Admin", "Term 1 fees"))
        receipt += 1
        t2 = fee["Term 2"] + route_fee
        r2 = rnd.random()
        if r2 < 0.55:
            pay_rows.append((st, pick_type(), t2, "2026-05-" + f"{rnd.randint(3,26):02d}", "Term 2", rnd.choice(method_pool), mpesa_ref(), f"RCP-{receipt}", "Admin", "Term 2 fees"))
            receipt += 1
        elif r2 < 0.8:
            pay_rows.append((st, pick_type(), round(t2 * rnd.choice([0.25, 0.4, 0.6])), "2026-05-" + f"{rnd.randint(3,26):02d}", "Term 2", rnd.choice(method_pool), mpesa_ref(), f"RCP-{receipt}", "Admin", "Term 2 fees"))
            receipt += 1
        t3 = fee["Term 3"] + route_fee
        r3 = rnd.random()
        if r3 < 0.50:
            pay_rows.append((st, pick_type(), t3, "2026-08-" + f"{rnd.randint(1,7):02d}", "Term 3", rnd.choice(method_pool), mpesa_ref(), f"RCP-{receipt}", "Admin", "Term 3 fees"))
            receipt += 1
        elif r3 < 0.78:
            pay_rows.append((st, pick_type(), round(t3 * rnd.choice([0.3, 0.5, 0.7])), "2026-08-" + f"{rnd.randint(1,7):02d}", "Term 3", rnd.choice(method_pool), mpesa_ref(), f"RCP-{receipt}", "Admin", "Term 3 fees"))
            receipt += 1
    cur.executemany("""INSERT INTO fee_payments(student_id,payment_type_id,amount,payment_date,term,method,reference,receipt_no,recorded_by,notes)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""", pay_rows)

    # attendance ------------------------------------------------------------
    att_rows = []
    for cid in class_ids:
        cls_students = [r[0] for r in enroll_rows if r[1] == cid and r[2] == "Term 3"]
        for day in school_days(8):
            for st in cls_students:
                r = rnd.random()
                status = "Present" if r < 0.88 else ("Late" if r < 0.93 else ("Permission" if r < 0.96 else "Absent"))
                att_rows.append((day, cid, st, status))
    cur.executemany("INSERT INTO attendance(date,class_id,student_id,status) VALUES(?,?,?,?)", att_rows)

    # library ----------------------------------------------------------------
    books = [
        ("Blossoms of the Savannah", "Henry Ole Kulet", "9789966000654", "Oxford University Press", "Set Book", 2008, 12, "Shelf A1"),
        ("The River and the Source", "Margaret Ogola", "9780195731214", "Phoenix", "Set Book", 1994, 10, "Shelf A1"),
        ("A Doll's House", "Henrik Ibsen", "9789966081296", "East African Educational", "Set Book", 1879, 8, "Shelf A2"),
        ("Betrayal in the City", "Francis Imbuga", "9789966469682", "East African Educational", "Set Book", 1976, 9, "Shelf A2"),
        ("Fathers of Nations", "Paul B. Vitta", "9789966104834", "Oxford University Press", "Set Book", 2021, 11, "Shelf A1"),
        ("The Caucasian Chalk Circle", "Bertolt Brecht", "9789966469668", "East African Educational", "Set Book", 1944, 7, "Shelf A2"),
        ("An Enemy of the People", "Henrik Ibsen", "9789966469958", "East African Educational", "Set Book", 1882, 6, "Shelf A2"),
        ("A Silent Song and Other Stories", "Godwin Siundu", "9789966118794", "Oxford University Press", "Set Book", 2021, 9, "Shelf A3"),
        ("The Pearl", "John Steinbeck", "9780435272711", "Heinemann", "Set Book", 1947, 8, "Shelf A3"),
        ("KLB Mathematics Grade 7", "KLB", "9789966655917", "KLB", "Textbook", 2021, 15, "Shelf B1"),
        ("KLB Mathematics Grade 8", "KLB", "9789966656105", "KLB", "Textbook", 2022, 14, "Shelf B1"),
        ("KLB Mathematics Grade 9", "KLB", "9789966656280", "KLB", "Textbook", 2023, 12, "Shelf B1"),
        ("Longhorn Integrated Science G7", "Longhorn", "9789966668429", "Longhorn", "Textbook", 2021, 13, "Shelf B2"),
        ("Oxford English Learner's Book G7", "Oxford", "9780195748130", "Oxford University Press", "Textbook", 2021, 12, "Shelf B2"),
        ("Longhorn Kiswahili G7", "Longhorn", "9789966668160", "Longhorn", "Textbook", 2021, 12, "Shelf B3"),
        ("KLB Social Studies G7", "KLB", "9789966655948", "KLB", "Textbook", 2021, 11, "Shelf B3"),
        ("Moran Agriculture G7", "Moran", "9789966630716", "Moran Publishers", "Textbook", 2021, 10, "Shelf C1"),
        ("Business Studies G7", "KLB", "9789966655863", "KLB", "Textbook", 2021, 9, "Shelf C1"),
        ("Pre-Technical & Pre-Career G7", "Longhorn", "9789966668306", "Longhorn", "Textbook", 2021, 10, "Shelf C2"),
        ("Health Education G7", "KLB", "9789966655894", "KLB", "Textbook", 2021, 8, "Shelf C2"),
        ("Life Skills Education G7", "Moran", "9789966630846", "Moran Publishers", "Textbook", 2021, 8, "Shelf C3"),
        ("Oxford English Dictionary", "Oxford", "9780199576375", "Oxford University Press", "Reference", 2010, 4, "Shelf D1"),
        ("Cambridge Kiswahili Dictionary", "Longhorn", "9789966498293", "Longhorn", "Reference", 2015, 3, "Shelf D1"),
        ("Atlas for Kenya Schools", "KLB", "9789966655207", "KLB", "Reference", 2018, 5, "Shelf D2"),
        ("Encyclopaedia Britannica (Vol 1-4)", "Britannica", "9781593392932", "Encyclopaedia Britannica", "Reference", 2007, 4, "Shelf D3"),
        ("Things Fall Apart", "Chinua Achebe", "9780435905254", "Heinemann", "Fiction", 1958, 6, "Shelf E1"),
        ("Weep Not, Child", "Ngugi wa Thiong'o", "9780435908309", "Heinemann", "Fiction", 1964, 5, "Shelf E1"),
        ("The Old Man and the Sea", "Ernest Hemingway", "9780684801223", "Scribner", "Fiction", 1952, 5, "Shelf E2"),
        ("Animal Farm", "George Orwell", "9780452284241", "Penguin", "Fiction", 1945, 6, "Shelf E2"),
        ("Longhorn Business Studies G8", "Longhorn", "9789966668450", "Longhorn", "Textbook", 2022, 9, "Shelf C1"),
        ("The Hitchhiker's Guide to the Galaxy", "Douglas Adams", "9780345391803", "Del Rey", "Fiction", 1979, 3, "Shelf E3"),
        ("Mfalme Mfalume", "E. Kezilahabi", "9789976911009", "Tanzania Publishing", "Fiction", 1972, 2, "Shelf E3"),
    ]
    cur.executemany(
        "INSERT INTO books(title,author,isbn,publisher,category,year,total_copies,available_copies,shelf) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        [(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[6], b[7]) for b in books])
    book_ids = [r["id"] for r in cur.execute("SELECT id FROM books ORDER BY id")]

    # issue history: borrow/return records with realistic statuses
    import datetime as _dt2
    issue_rows = []
    today = _dt2.date(2026, 8, 11)
    for st in student_ids:
        if rnd.random() < 0.45:
            n = rnd.choice([1, 1, 1, 2, 2, 3])
            for _ in range(n):
                bid = rnd.choice(book_ids)
                issued = today - _dt2.timedelta(days=rnd.randint(3, 45))
                due = issued + _dt2.timedelta(days=14)
                roll = rnd.random()
                if roll < 0.45:
                    ret = issued + _dt2.timedelta(days=rnd.randint(3, 14))
                    issue_rows.append((bid, st, issued.isoformat(), due.isoformat(), ret.isoformat(), "Returned", "Librarian"))
                elif roll < 0.70:
                    ret = issued + _dt2.timedelta(days=rnd.randint(15, 22))
                    issue_rows.append((bid, st, issued.isoformat(), due.isoformat(), ret.isoformat(), "Returned", "Librarian"))
                elif roll < 0.90:
                    issue_rows.append((bid, st, issued.isoformat(), due.isoformat(), None, "Issued", "Librarian"))
                else:
                    overdue_due = today - _dt2.timedelta(days=rnd.randint(1, 9))
                    issued2 = overdue_due - _dt2.timedelta(days=14)
                    issue_rows.append((bid, st, issued2.isoformat(), overdue_due.isoformat(), None, "Overdue", "Librarian"))
    cur.executemany(
        "INSERT INTO book_issues(book_id,student_id,issue_date,due_date,return_date,status,issued_by) "
        "VALUES(?,?,?,?,?,?,?)", issue_rows)

    # sync available copies with active issues
    for bid in book_ids:
        active = cur.execute("SELECT COUNT(*) c FROM book_issues WHERE book_id=? AND status IN ('Issued','Overdue')", (bid,)).fetchone()["c"]
        total = cur.execute("SELECT total_copies t FROM books WHERE id=?", (bid,)).fetchone()["t"]
        cur.execute("UPDATE books SET available_copies=? WHERE id=?", (max(0, total - active), bid))

    # conduct / discipline records (CBC holistic development) -----------------
    merit_cats = ["Academic Excellence", "Good Conduct", "Community Service", "Sports Achievement",
                  "Cleanliness", "Punctuality", "Leadership", "Honesty"]
    demerit_cats = ["Late Coming", "Noise Making", "Truancy", "Fighting", "Dishonesty",
                    "Vandalism", "Mobile Phone Use", "Incomplete Homework", "Uniform Violation"]
    merit_txt = ["Helped classmates prepare for exams", "Won the class science quiz", "Reported a lost wallet to the office",
                 "Led the cleanliness drive", "Represented the school in games", "Consistently punctual all month",
                 "Organised the class reading club", "Returned a borrowed book promptly", "Assisted the librarian after school",
                 "Improved performance in mathematics", "Volunteered for community clean-up", "Demonstrated strong leadership in group work"]
    demerit_txt = ["Arrived 30 minutes late to class", "Disruptive during lessons", "Missed school without permission",
                   "Caught using a phone in class", "Involved in a physical alteration in the field", "Failed to submit homework twice",
                   "Left the compound during break", "Vandalised a classroom notice board", "Disrespectful language to a teacher",
                   "Cheating in a continuous assessment", "Noise-making during assembly", "Incomplete PE uniform"]
    conduct_rows = []
    teacher_names = [r["first_name"] + " " + r["last_name"] for r in cur.execute("SELECT first_name, last_name FROM teachers")]
    term3_start = _dt2.date(2026, 5, 4)
    for st in student_ids:
        if rnd.random() < 0.42:
            for _ in range(rnd.choice([1, 1, 2, 2, 3])):
                is_merit = rnd.random() < 0.58
                cats = merit_cats if is_merit else demerit_cats
                txts = merit_txt if is_merit else demerit_txt
                d = term3_start + _dt2.timedelta(days=rnd.randint(0, 96))
                conduct_rows.append((st, "Merit" if is_merit else "Demerit", rnd.choice(cats),
                                     rnd.choice(txts), d.isoformat(), rnd.choice(teacher_names)))
    cur.executemany("""INSERT INTO conduct_records(student_id,record_type,category,description,record_date,recorded_by)
                       VALUES(?,?,?,?,?,?)""", conduct_rows)

    # school events ---------------------------------------------------------
    events = [
        ("Parent-Teacher Conference", "Meet your child's class teacher to discuss progress in Term 2.", "2026-05-30", "Meeting", "Parents"),
        ("Term 3 Midterm Break", "School closed for midterm. Students resume Monday 22nd June.", "2026-06-12", "Holiday", "All"),
        ("Music & Drama Festival", "Inter-house music, drama and poetry festival in the school hall.", "2026-06-20", "Creative", "All"),
        ("Science & Innovation Fair", "Students showcase CBC innovation projects. Parents welcome.", "2026-07-02", "Academic", "All"),
        ("Academic Clinic - Term 3", "Review of Term 3 continuous assessments; targets for end-term exams.", "2026-07-18", "Meeting", "Parents"),
        ("Inter-house Games Day", "Athletics, football and netball finals. All students participate.", "2026-07-24", "Sports", "All"),
        ("End of Term 3 Examinations", "End of term examinations begin. Timetable issued in classes.", "2026-08-04", "Exam", "All"),
        ("Prize Giving & Closing Ceremony", "End of year prize giving, achievement certificates and closing of Term 3.", "2026-08-14", "Academic", "All"),
        ("End of Term 3 Holiday", "School closed for the December holiday. Report cards issued.", "2026-08-15", "Holiday", "All"),
    ]
    cur.executemany("""INSERT INTO school_events(title,description,event_date,category,audience)
                       VALUES(?,?,?,?,?)""", events)

    # announcements ---------------------------------------------------------
    ann = [
        ("Term 3 Opening", "School reopens for Term 3 on Monday 4th May 2026 at 7:30am. Parents are reminded to clear Term 2 balances.", "All", "Admin"),
        ("Fee Reminder", "All fee balances must be cleared by 15th June 2026. Students with outstanding balances may not sit for end-of-term exams.", "Parents", "Admin"),
        ("Academic Clinic", "Parents are invited for an academic clinic on Saturday 20th June 2026, 9:00am in the school hall to discuss Term 2 results.", "Parents", "Admin"),
        ("Games Day", "Inter-house games day will be held on Friday 26th June 2026. All students are expected to participate.", "All", "Admin"),
    ]
    cur.executemany("INSERT INTO announcements(title,message,audience,created_by) VALUES(?,?,?,?)", ann)

    # settings --------------------------------------------------------------
    settings = {
        "school_name": "Greenfield Academy",
        "school_motto": "Strive for Excellence",
        "school_address": "P.O. Box 1020, Kisii",
        "school_phone": "+254 712 345 678",
        "school_email": "info@greenfield.ac.ke",
        "currency": "KSh",
        "academic_year": "2026",
        "current_term": "Term 3",
        "sms_provider": "Africa's Talking",
        "theme": "emerald",
        "font_family": "modern",
        "font_size": "medium",
        "school_logo": "",
        "term_start": "2026-05-04",
        "term_end": "2026-08-14",
    }
    cur.executemany("INSERT INTO settings(key,value) VALUES(?,?)", list(settings.items()))

    # users -----------------------------------------------------------------
    def phash(p):
        salt = secrets.token_hex(16)
        h = hashlib.scrypt(p.encode(), salt=salt.encode(), n=2 ** 14, r=8, p=1, dklen=32)
        return f"scrypt${salt}${h.hex()}"
    users = [
        ("admin", phash("admin123"), "School Administrator", "admin", None),
        ("teacher", phash("teacher123"), "Madam Jane Atieno", "teacher", teacher_ids[0]),
        ("jmwangi", phash("teacher123"), "Mr Peter Mwangi", "teacher", teacher_ids[1]),
        ("accounts", phash("accounts123"), "Finance Officer", "accounts", None),
        ("finance", phash("accounts123"), "Accounts Clerk", "accounts", None),
        ("librarian", phash("librarian123"), "Mr. Daniel Omondi", "librarian", None),
    ]
    for uname, ph, full, role, tid in users:
        cur.execute("INSERT INTO users(username,password_hash,full_name,role,teacher_id) VALUES(?,?,?,?,?)",
                    (uname, ph, full, role, tid))

    # guardian (parent) accounts -------------------------------------------
    guardian_links = []
    parent_users = {}
    students_with_phone = cur.execute("""SELECT id, parent_name, parent_phone FROM students
                                         WHERE parent_phone IS NOT NULL AND parent_phone != ''""").fetchall()
    for row in students_with_phone:
        phone = row["parent_phone"]
        if phone not in parent_users:
            uname = phone.replace(" ", "").replace("-", "")
            cur.execute("""INSERT INTO users(username,password_hash,full_name,role)
                           VALUES(?,?,?,?)""",
                        (uname, phash("parent123"), row["parent_name"] or "Parent", "guardian"))
            parent_users[phone] = cur.execute("SELECT id FROM users WHERE username=?", (uname,)).fetchone()["id"]
        guardian_links.append((parent_users[phone], row["id"]))
    cur.executemany("INSERT INTO guardian_links(user_id,student_id) VALUES(?,?)", guardian_links)

    # activity history ------------------------------------------------------
    acts = [
        ("admin", "System", "Database initialised", "CBC curriculum loaded for 2026", "2026-05-02 08:00:00"),
        ("admin", "System", "Term 2 results published", "End of Term 2 Exam 2026 closed & results released", "2026-04-25 16:30:00"),
        ("admin", "School Administrator", "Fees loaded", "Term 1 & Term 2 fee structures set for all classes", "2026-05-03 09:15:00"),
        ("jmwangi", "Mr Peter Mwangi", "Marks entered", "End of Term 3 Exam 2026 — Grade 7 East mathematics", "2026-08-05 11:20:00"),
        ("accounts", "Finance Officer", "Payment recorded", "RCP-10032 · M-PESA · Tuition Fees", "2026-08-06 14:05:00"),
    ]
    for uname, _, action, detail, ts in acts:
        u = cur.execute("SELECT id FROM users WHERE username=?", (uname,)).fetchone()
        cur.execute("INSERT INTO activity_log(user_id,action,detail,created_at) VALUES(?,?,?,?)",
                    (u["id"] if u else None, action, detail, ts))

    conn.commit()
    conn.close()
    print(f"Seeded OK: {len(student_ids)} students, {len(teacher_ids)} teachers, "
          f"{len(class_ids)} classes, {len(subj_rows)} CBC subjects, {len(exam_ids)} exams, "
          f"{len(exam_rows)} exam scores, {len(pay_rows)} payments, {len(att_rows)} attendance, "
          f"{len(route_ids)} routes, {len(assign_rows)} transport assignments, "
          f"{len(tt_rows)} timetable slots, {len(parent_users)} guardian accounts, "
          f"{len(book_ids)} books, {len(issue_rows)} library records, "
          f"{len(conduct_rows)} conduct records, {len(events)} events.")

if __name__ == "__main__":
    seed()
