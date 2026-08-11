#!/usr/bin/env python3
"""Seed the ElimuPro school database with schema + realistic sample data."""
import os
import random
import sqlite3
import hashlib
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
  role TEXT NOT NULL CHECK(role IN ('admin','teacher','accounts','guardian')),
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
"""

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

GRADES = [
    (80, 12, "A"),  (75, 11, "A-"), (70, 10, "B+"), (65, 9, "B"), (60, 8, "B-"),
    (55, 7, "C+"),  (50, 6, "C"),   (45, 5, "C-"),  (40, 4, "D+"), (35, 3, "D"),
    (30, 2, "D-"),  (0, 1, "E"),
]

def grade_for(score):
    for lo, pts, letter in GRADES:
        if score >= lo:
            return letter, pts
    return "E", 1

def seed():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.executescript(SCHEMA)

    rnd = random.Random(42)

    # subjects -------------------------------------------------------------
    subjects = [
        ("Mathematics", "MAT", "Core"), ("English", "ENG", "Languages"),
        ("Kiswahili", "KIS", "Languages"), ("Integrated Science", "SCI", "Sciences"),
        ("Social Studies", "SST", "Humanities"), ("CRE", "CRE", "Humanities"),
        ("Agriculture", "AGR", "Technical"), ("Business Studies", "BUS", "Technical"),
    ]
    cur.executemany("INSERT INTO subjects(name,code,category) VALUES(?,?,?)", subjects)
    subj_ids = [r["id"] for r in cur.execute("SELECT id FROM subjects ORDER BY id")]

    # teachers -------------------------------------------------------------
    teacher_first = ["Jane","Peter","Diana","Samuel","Grace","Kelvin","Esther","David","Mercy","Brian","Ruth","Vincent"]
    teacher_last = ["Atieno","Mwangi","Chebet","Omondi","Wanjiru","Kiptoo","Nyaboke","Kariuki","Achieng","Otieno","Kerubo","Kosgei"]
    teacher_titles = ["Madam","Mr","Madam","Mr","Madam","Mr","Madam","Mr","Madam","Mr","Madam","Mr"]
    teachers = []
    for i, (fn, ln, ttl) in enumerate(zip(teacher_first, teacher_last, teacher_titles)):
        gender = "Female" if ttl == "Madam" else "Male"
        teachers.append((f"TSC-{202001+i}", fn, ln, gender, rand_phone(),
                         f"{fn.lower()}.{ln.lower()}@greenfield.ac.ke", subj_ids[i % len(subj_ids)], "Permanent"))
    cur.executemany("""INSERT INTO teachers(tsc_no,first_name,last_name,gender,phone,email,subject_id,employment_type)
                       VALUES(?,?,?,?,?,?,?,?)""", teachers)
    teacher_ids = [r["id"] for r in cur.execute("SELECT id FROM teachers ORDER BY id")]
    for i, tid in enumerate(teacher_ids):
        cur.execute("UPDATE subjects SET teacher_id=? WHERE id=?", (tid, subj_ids[i % len(subj_ids)]))
    # keep teachers.subject_id consistent with the final subject assignment
    cur.execute("UPDATE teachers SET subject_id=NULL")
    for srow in cur.execute("SELECT id, teacher_id FROM subjects"):
        if srow["teacher_id"]:
            cur.execute("UPDATE teachers SET subject_id=? WHERE id=?", (srow["id"], srow["teacher_id"]))

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
    ]
    cur.executemany("""INSERT INTO classes(name,grade,stream,academic_year,capacity,class_teacher_id)
                       VALUES(?,?,?,?,?,?)""",
                    [(n, g, s, "2026", 45, t) for n, g, s, t, _ in class_defs])
    class_ids = [r["id"] for r in cur.execute("SELECT id FROM classes ORDER BY id")]
    grade_of_class = {cid: cd[1] for cd, cid in zip(class_defs, class_ids)}

    # students -------------------------------------------------------------
    students, enroll_rows = [], []
    ages = {1: 7, 2: 8, 3: 9, 4: 10, 5: 11, 6: 12, 7: 13, 8: 14, 9: 15}
    sid = 1
    used_names = set()
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
                             "Active"))
            for term in ("Term 1", "Term 2", "Term 3"):
                enroll_rows.append((sid, cid, term, "2026"))
            sid += 1
    cur.executemany("""INSERT INTO students(admission_no,first_name,middle_name,last_name,gender,dob,admission_date,
                                            parent_name,parent_phone,parent_email,address,status)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""", students)
    student_ids = [r["id"] for r in cur.execute("SELECT id FROM students ORDER BY id")]
    cur.executemany("INSERT INTO enrollments(student_id,class_id,term,academic_year) VALUES(?,?,?,?)", enroll_rows)

    # ability + exam scores -------------------------------------------------
    ability = {st: rnd.gauss(0, 1) for st in student_ids}
    exams = [("End of Term 1 Exam 2026", "Term 1", "Closed"),
             ("End of Term 2 Exam 2026", "Term 2", "Closed"),
             ("End of Term 3 Exam 2026", "Term 3", "Open")]
    cur.executemany("INSERT INTO exams(name,term,academic_year,status) VALUES(?,?,?,?)",
                    [(n, t, "2026", s) for n, t, s in exams])
    exam_ids = [r["id"] for r in cur.execute("SELECT id FROM exams ORDER BY id")]

    subject_base = {s[0]: (58.0 + rnd.gauss(0, 4), 9.0) for s in subjects}
    subject_base.update({"Mathematics": (55.0, 11.0), "English": (57.0, 8.5),
                         "Kiswahili": (60.0, 8.0), "Integrated Science": (56.0, 10.0)})
    exam_rows = []
    for ei, eid in enumerate(exam_ids):
        term_progress = [0.9, 1.0, 1.1][ei]
        for st in student_ids:
            for si, subj in enumerate(subjects):
                base, sd = subject_base[subj[0]]
                raw = base * term_progress + ability[st] * sd * 0.8 + rnd.gauss(0, sd * 0.5)
                score = max(8, min(99, round(raw)))
                letter, pts = grade_for(score)
                exam_rows.append((eid, st, subj_ids[si], score, letter, pts))
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
    fee_amt = {1: 8500, 2: 9000, 3: 9500, 4: 12000, 5: 13500, 6: 15000,
               7: 18500, 8: 17000, 9: 20000}
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
    assigned = {r[0]: r[1] for r in assign_rows}

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

    # timetable -------------------------------------------------------------
    subject_teacher = {r["id"]: r["teacher_id"] for r in cur.execute("SELECT id, teacher_id FROM subjects")}
    slot_teachers = {}      # (day, period) -> set of teacher_ids already placed
    tt_rows = []
    weekdays = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
    for cid in class_ids:
        day_used = {}
        for day in weekdays:
            day_used[day] = set()
            for p in range(1, 9):
                cand = [s for s in subj_ids
                        if subject_teacher.get(s) is None
                        or (subject_teacher[s] not in slot_teachers.get((day, p), set())
                            and s not in day_used[day])]
                if not cand:
                    cand = [s for s in subj_ids
                            if subject_teacher.get(s) is None
                            or subject_teacher[s] not in slot_teachers.get((day, p), set())]
                if not cand:
                    cand = subj_ids
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
        enroll = [r for r in enroll_rows if r[0] == st]
        class_id = enroll[0][1]
        fee = dict((r[0], r[1]) for r in cur.execute(
            "SELECT term,amount FROM fee_structures WHERE class_id=?", (class_id,)))
        route_fee = 0
        if st in assigned:
            rr = cur.execute("SELECT fee FROM transport_routes WHERE id=?", (assigned[st],)).fetchone()
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
        return hashlib.sha256(p.encode()).hexdigest()
    users = [
        ("admin", phash("admin123"), "School Administrator", "admin", None),
        ("teacher", phash("teacher123"), "Madam Jane Atieno", "teacher", teacher_ids[0]),
        ("jmwangi", phash("teacher123"), "Mr Peter Mwangi", "teacher", teacher_ids[1]),
        ("accounts", phash("accounts123"), "Finance Officer", "accounts", None),
        ("finance", phash("accounts123"), "Accounts Clerk", "accounts", None),
    ]
    for uname, ph, full, role, tid in users:
        cur.execute("INSERT INTO users(username,password_hash,full_name,role,teacher_id) VALUES(?,?,?,?,?)",
                    (uname, ph, full, role, tid))

    # guardian (parent) accounts — one per unique parent phone, linked to their children
    guardian_links = []
    parent_users = {}   # phone -> user id
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

    # seed a little activity history so the feed feels alive
    acts = [
        ("admin", "System", "Database initialised", "Sample school data loaded for 2026", "2026-05-02 08:00:00"),
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
          f"{len(class_ids)} classes, {len(subjects)} subjects, {len(exam_ids)} exams, "
          f"{len(pay_rows)} payments, {len(att_rows)} attendance, {len(route_ids)} routes, "
          f"{len(assign_rows)} transport assignments, {len(tlog_rows)} transport log entries, "
          f"{len(tt_rows)} timetable slots, {len(parent_users)} guardian accounts.")

if __name__ == "__main__":
    seed()
