/* ============================================================
   ElimuPro — frontend application
   Professional school management system (admin / teacher / accounts)
   ============================================================ */
"use strict";

/* ---------------- helpers ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtMoney = (n) => (state.settings && state.settings.currency ? state.settings.currency : "KSh") + " " + Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const fmtNum = (n, d = 1) => Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: d });
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const CBC_LEVELS = {
  E: { name: "Exceeding Expectations", band: "80% – 100%", cls: "gEx" },
  M: { name: "Meeting Expectations",   band: "65% – 79%",  cls: "gMe" },
  A: { name: "Approaching Expectations", band: "50% – 64%", cls: "gAp" },
  B: { name: "Below Expectations",     band: "0% – 49%",   cls: "gBe" },
};
const CBC_LABEL = "CBC Achievement Levels: E = Exceeding (80%+) · M = Meeting (65%+) · A = Approaching (50%+) · B = Below (under 50%)";
const scaleForGrade = () => "cbc";
const gradeClass = (g) => {
  if (!g || g === "-") return "gNone";
  return (CBC_LEVELS[g] || { cls: "gNone" }).cls;
};
const meanGradeFromPts = (p) => {
  if (p === null || p === undefined) return "—";
  return p >= 3.5 ? "E" : p >= 2.5 ? "M" : p >= 1.5 ? "A" : "B";
};
const scaleLegendHtml = () => `<div class="chart-legend" style="margin-top:10px">
    ${Object.keys(CBC_LEVELS).map(k => `<span><span class="dot" style="background:${({E:"#16a34a",M:"#0ea5e9",A:"#f59e0b",B:"#ef4444"})[k]}"></span><b>${k}</b> — ${CBC_LEVELS[k].name} (${CBC_LEVELS[k].band})</span>`).join("")}
  </div>`;
const initials = (name) => (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
const typeBadge = (cat) => ({ Fees: "b-blue", Transport: "b-green", Other: "b-amber" }[cat] || "b-slate");
const TYPE_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#ec4899", "#0ea5e9", "#ef4444", "#14b8a6"];
const avatarHtml = (pic, name, cls = "") =>
  pic ? `<span class="avatar ${cls}" style="flex:none"><img src="${esc(pic)}" alt=""></span>`
       : `<span class="avatar ${cls}">${esc(initials(name))}</span>`;

/* Auth token: works in sandboxed preview iframes where cookies are blocked. */
let authToken = null;
try { authToken = localStorage.getItem("ep_token") || null; } catch (e) {}

async function api(url, opts = {}) {
  const cfg = { method: opts.method || "GET", headers: { "Content-Type": "application/json" } };
  if (authToken) cfg.headers["Authorization"] = "Bearer " + authToken;
  if (opts.body !== undefined) cfg.body = JSON.stringify(opts.body);
  let res;
  try {
    res = await fetch(url, cfg);
  } catch (e) {
    // network is unreachable — we are offline
    if (opts.method && opts.method !== "GET") {
      // queue the change locally; it auto-syncs when back online
      enqueueOffline({ url, method: opts.method, body: opts.body });
      throw new Error("You are offline — your change is saved locally and will sync automatically when you're back online");
    }
    throw new Error("You are offline — showing saved data");
  }
  if (res.status === 401) { showLogin(); throw new Error("Session expired — please sign in again"); }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || ("Request failed (" + res.status + ")"));
  return data;
}

/* ============================================================
   OFFLINE / ONLINE — offline cache via service worker,
   local change queue, auto-sync & auto-refresh on reconnect
   ============================================================ */
const OFFLINE = { online: navigator.onLine !== false, pending: 0 };
function offlineLS() {
  try { localStorage.setItem("__ep_t", "1"); localStorage.removeItem("__ep_t"); return localStorage; }
  catch (e) { return null; }
}
function loadQueue() {
  const ls = offlineLS(); if (!ls) return [];
  try { return JSON.parse(ls.getItem("ep_queue") || "[]"); } catch (e) { return []; }
}
function saveQueue(q) {
  const ls = offlineLS(); if (!ls) return;
  try { ls.setItem("ep_queue", JSON.stringify(q)); } catch (e) {}
}
function enqueueOffline(op) {
  const q = loadQueue();
  q.push({ ...op, qid: Date.now() + "-" + Math.random().toString(36).slice(2, 8) });
  saveQueue(q);
  OFFLINE.pending = q.length;
  updateNetUI();
  toast("Saved offline — will sync automatically when back online");
}
function updateNetUI() {
  const pill = $("#net-pill");
  if (pill) {
    pill.className = "net-pill " + (OFFLINE.online ? "online" : "offline");
    pill.innerHTML = `<span class="net-dot"></span> ${OFFLINE.online ? "Online" : "Offline"}<span id="net-pending">${OFFLINE.pending ? " · " + OFFLINE.pending + " pending sync" : ""}</span>`;
  }
  const banner = $("#offline-banner");
  if (banner) banner.classList.toggle("hidden", OFFLINE.online);
}
async function flushQueue() {
  if (!OFFLINE.online) return 0;
  const q = loadQueue();
  if (!q.length) return 0;
  const failed = [];
  for (const op of q) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: "Bearer " + authToken } : {}) },
        body: JSON.stringify(op.body),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
    } catch (err) { failed.push(op); }
  }
  saveQueue(failed);
  OFFLINE.pending = failed.length;
  updateNetUI();
  if (failed.length === 0) toast("Back online — all " + q.length + " saved change" + (q.length > 1 ? "s" : "") + " synced ✓");
  else toast(failed.length + " change" + (failed.length > 1 ? "s" : "") + " still waiting to sync", "err");
  return q.length - failed.length;
}
async function refreshAfterReconnect() {
  try { state.settings = await api("/api/settings"); applyAppearance(); } catch (e) {}
  const v = VIEWS[state.view];
  if (v) v.fn($("#view"), state.params).catch(() => {});
  toast("You're back online — data refreshed");
}
window.addEventListener("offline", () => {
  OFFLINE.online = false;
  updateNetUI();
  toast("You are offline — using saved data", "err");
});
window.addEventListener("online", async () => {
  OFFLINE.online = true;
  updateNetUI();
  await flushQueue();          // push queued changes
  refreshAfterReconnect();     // auto-update the current view
});
// gentle connectivity check every 20s (catches flaky connections the events miss)
setInterval(async () => {
  const was = OFFLINE.online;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch("/api/settings", { headers: { Authorization: "Bearer " + (authToken || "") }, signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok && !OFFLINE.online) {
      OFFLINE.online = true; updateNetUI(); await flushQueue(); refreshAfterReconnect();
    } else if (!r.ok) {
      OFFLINE.online = false; updateNetUI();
    }
  } catch (e) {
    if (was) { OFFLINE.online = false; updateNetUI(); }
  }
}, 20000);
// register the service worker (works on localhost/HTTPS; the sandboxed chat preview may block it — handled)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* preview sandbox may disallow SW — offline queue still works */ });
  });
}
function toast(msg, type = "ok") {
  const w = $("#toast-wrap");
  const t = document.createElement("div");
  t.className = "toast " + (type === "err" ? "err" : "ok");
  t.innerHTML = `<svg style="width:16px;height:16px;flex:none"><use href="#${type === "err" ? "i-close" : "i-check"}"/></svg><span>${esc(msg)}</span>`;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 3200);
  setTimeout(() => t.remove(), 3600);
}
function emptyState(msg, hint = "", actionHtml = "") {
  return `<div class="empty"><svg><use href="#i-grid"/></svg><p><b>${esc(msg)}</b></p>
    ${hint ? `<p style="font-size:12.5px;color:var(--muted);margin-top:4px">${esc(hint)}</p>` : ""}
    ${actionHtml ? `<div style="margin-top:14px">${actionHtml}</div>` : ""}</div>`;
}
function timeAgo(iso) {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + "Z");
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (isNaN(sec) || sec < 0) return fmtDate(iso);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + " min ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + " hr ago";
  const day = Math.floor(hr / 24);
  if (day < 7) return day + " day" + (day > 1 ? "s" : "") + " ago";
  return fmtDate(iso);
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
function modal(html, wide = false) {
  $("#modal-box").innerHTML = html;
  $("#modal-box").classList.toggle("wide", wide);
  $("#modal-backdrop").classList.remove("hidden");
  return $("#modal-box");
}
function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  $("#modal-box").innerHTML = "";
  document.body.classList.remove("receipt-mode");
}
function exportCSV(filename, headers, rows) {
  const csv = [headers.join(","), ...rows.map(r => r.map(c =>
    '"' + String(c ?? "").replace(/"/g, '""') + '"').join(","))].join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

/* ---------------- appearance (theme / font / wallpaper) ---------------- */
const THEMES = {
  emerald:  { name: "Emerald",  primary: "#16a34a", primaryDark: "#15803d", primaryDeep: "#14532d", g50: "#f0fdf4", g100: "#dcfce7",
              bg: "#f1f5f9", sidebar: "linear-gradient(180deg,#0f172a,#0c1222)",
              login: "radial-gradient(1200px 600px at 20% -10%,#14532d 0%,transparent 55%),radial-gradient(900px 500px at 110% 110%,#052e16 0%,transparent 50%),linear-gradient(160deg,#0f172a,#052e16)" },
  ocean:    { name: "Ocean",    primary: "#2563eb", primaryDark: "#1d4ed8", primaryDeep: "#1e3a8a", g50: "#eff6ff", g100: "#dbeafe",
              bg: "#f1f5f9", sidebar: "linear-gradient(180deg,#0c1a35,#0b1d40)",
              login: "radial-gradient(1200px 600px at 20% -10%,#1e3a8a 0%,transparent 55%),linear-gradient(160deg,#0b1226,#123a75)" },
  royal:    { name: "Royal",    primary: "#7c3aed", primaryDark: "#6d28d9", primaryDeep: "#4c1d95", g50: "#f5f3ff", g100: "#ede9fe",
              bg: "#f5f3ff", sidebar: "linear-gradient(180deg,#1a1030,#241545)",
              login: "radial-gradient(1200px 600px at 20% -10%,#4c1d95 0%,transparent 55%),linear-gradient(160deg,#150a2e,#2a1460)" },
  forest:   { name: "Forest",   primary: "#0d9488", primaryDark: "#0f766e", primaryDeep: "#115e59", g50: "#f0fdfa", g100: "#ccfbf1",
              bg: "#f0fdfa", sidebar: "linear-gradient(180deg,#062420,#0a352e)",
              login: "radial-gradient(1200px 600px at 20% -10%,#115e59 0%,transparent 55%),linear-gradient(160deg,#04211c,#0f4a40)" },
  sunset:   { name: "Sunset",   primary: "#ea580c", primaryDark: "#c2410c", primaryDeep: "#7c2d12", g50: "#fff7ed", g100: "#ffedd5",
              bg: "#fff7ed", sidebar: "linear-gradient(180deg,#2b1508,#3a1c0a)",
              login: "radial-gradient(1200px 600px at 20% -10%,#9a3412 0%,transparent 55%),linear-gradient(160deg,#1c0f07,#4a1d0b)" },
  midnight: { name: "Midnight", primary: "#0ea5e9", primaryDark: "#0284c7", primaryDeep: "#0c4a6e", g50: "#f0f9ff", g100: "#e0f2fe",
              bg: "#f0f9ff", sidebar: "linear-gradient(180deg,#082032,#0b2e4a)",
              login: "radial-gradient(1200px 600px at 20% -10%,#0c4a6e 0%,transparent 55%),linear-gradient(160deg,#071521,#0b2e4a)" },
};
const FONTS = {
  modern:  { name: "Modern Sans",     stack: "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif" },
  humanist:{ name: "Humanist",        stack: "'Trebuchet MS', 'Segoe UI', Tahoma, sans-serif" },
  serif:   { name: "Classic Serif",   stack: "Georgia, 'Times New Roman', Cambria, serif" },
  mono:    { name: "Monospace",       stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
};
const FONT_SIZES = { small: "13px", medium: "14px", large: "15.5px" };

function applyAppearance() {
  const s = state.settings || {};
  const th = THEMES[s.theme] || THEMES.emerald;
  const root = document.documentElement;
  root.style.setProperty("--green", th.primary);
  root.style.setProperty("--green-dark", th.primaryDark);
  root.style.setProperty("--green-deep", th.primaryDeep);
  root.style.setProperty("--green-50", th.g50);
  root.style.setProperty("--green-100", th.g100);
  root.style.setProperty("--bg", th.bg);
  root.style.setProperty("--sidebar-bg", th.sidebar);
  root.style.setProperty("--login-bg", th.login);
  root.style.setProperty("--font-main", (FONTS[s.font_family] || FONTS.modern).stack);
  root.style.setProperty("--fs", FONT_SIZES[s.font_size] || FONT_SIZES.medium);
  const logo = $("#school-logo-img");
  if (logo) {
    if (s.school_logo) { logo.src = s.school_logo; logo.style.display = ""; }
    else { logo.style.display = "none"; }
  }
}

/* ---------------- state ---------------- */
const state = { user: null, settings: null, view: "dashboard", params: {}, financeTerm: "Term 3" };
const can = (...roles) => state.user && roles.includes(state.user.role);
const isAdmin = () => can("admin");
const adminBtn = (html) => (can("admin") ? html : "");
const acctBtn = (html) => (can("admin", "accounts") ? html : "");
const acadBtn = (html) => (can("admin", "teacher") ? html : "");

/* ============================================================
   NAVIGATION (role-aware)
   ============================================================ */
const NAV = [
  { group: "Overview", items: [{ v: "dashboard", label: "Dashboard", icon: "i-grid", roles: ["admin", "teacher", "accounts"] }] },
  { group: "Academics", items: [
    { v: "students", label: "Students", icon: "i-users", roles: ["admin", "teacher", "accounts"] },
    { v: "teachers", label: "Teachers", icon: "i-teacher", roles: ["admin", "teacher"] },
    { v: "classes", label: "Classes", icon: "i-class", roles: ["admin", "teacher", "accounts"] },
    { v: "subjects", label: "Subjects", icon: "i-book", roles: ["admin", "teacher"] },
    { v: "exams", label: "Exams & Marks", icon: "i-exam", roles: ["admin", "teacher"] },
    { v: "analytics", label: "Analytics", icon: "i-chart", roles: ["admin", "teacher"] },
    { v: "reportcard", label: "Report Cards", icon: "i-report", roles: ["admin", "teacher"] },
    { v: "timetable", label: "Timetable", icon: "i-timetable", roles: ["admin", "teacher"] },
  ]},
  { group: "Operations", items: [
    { v: "finance", label: "Finance & Fees", icon: "i-money", roles: ["admin", "accounts"] },
    { v: "transport", label: "Transport", icon: "i-bus", roles: ["admin", "teacher", "accounts"] },
    { v: "attendance", label: "Attendance", icon: "i-calendar", roles: ["admin", "teacher"] },
    { v: "communication", label: "Communication", icon: "i-message", roles: ["admin", "accounts"] },
  ]},
  { group: "Library", items: [
    { v: "library", label: "Library", icon: "i-book", roles: ["admin", "teacher", "librarian"] },
  ]},
  { group: "School Life", items: [
    { v: "events", label: "Events", icon: "i-calendar", roles: ["admin", "teacher", "accounts", "librarian"] },
    { v: "discipline", label: "Discipline & Conduct", icon: "i-shield", roles: ["admin", "teacher"] },
    { v: "idcards", label: "ID Cards", icon: "i-card", roles: ["admin", "teacher"] },
  ]},
  { group: "System", items: [{ v: "settings", label: "Settings", icon: "i-gear", roles: ["admin"] }] },
  { group: "Parent Portal", items: [
    { v: "gdash", label: "My Dashboard", icon: "i-grid", roles: ["guardian"] },
    { v: "gresults", label: "Results", icon: "i-chart", roles: ["guardian"] },
    { v: "gfees", label: "Fees & Payments", icon: "i-money", roles: ["guardian"] },
    { v: "gtransport", label: "Transport", icon: "i-bus", roles: ["guardian"] },
    { v: "gattendance", label: "Attendance", icon: "i-calendar", roles: ["guardian"] },
    { v: "gannounce", label: "Announcements", icon: "i-message", roles: ["guardian"] },
    { v: "gevents", label: "School Events", icon: "i-calendar", roles: ["guardian"] },
  ]},
];

function renderNav() {
  const role = state.user ? state.user.role : "admin";
  const nav = $("#nav");
  nav.innerHTML = NAV.map(group => {
    const items = group.items.filter(i => i.roles.includes(role));
    if (!items.length) return "";
    return `<div class="nav-group">${esc(group.group)}</div>` +
      items.map(i => `<button class="nav-item" data-view="${i.v}">
        <svg><use href="#${i.icon}"/></svg>${esc(i.label)}</button>`).join("");
  }).join("");
  $$("#nav .nav-item").forEach(b => b.addEventListener("click", () => openView(b.dataset.view)));
  $$("#nav .nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === state.view));
}

/* ============================================================
   LOGIN / BOOT
   ============================================================ */
function showLogin() {
  $("#app").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
}
function enterApp() {
  $("#login-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#user-name").textContent = state.user.name;
  $("#user-role").textContent = { admin: "Administrator", teacher: "Teacher", accounts: "Accounts", guardian: "Parent", librarian: "Librarian" }[state.user.role] || state.user.role;
  $("#user-avatar").innerHTML = state.user.profile_pic
    ? `<img src="${esc(state.user.profile_pic)}" alt="">`
    : esc(initials(state.user.name));
  $("#sidebar-school").textContent = state.settings.school_name;
  $("#term-badge").textContent = state.settings.current_term + " · " + state.settings.academic_year;
  $("#version-tag").textContent = "ElimuPro · v2.7 · " + new Date().getFullYear();
  updateNetUI();
  document.title = state.settings.school_name + " — ElimuPro";
  applyAppearance();
  renderNav();
  openView(state.user.role === "guardian" ? "gdash" : "dashboard");
}
async function doLogin(username, password) {
  $("#login-error").textContent = "";
  const card = $(".login-card");
  card.classList.remove("shake");
  const btn = $("#login-submit");
  if (btn) { btn.disabled = true; btn.textContent = "Signing in…"; }
  try {
    const u = await api("/api/login", { method: "POST", body: { username, password } });
    authToken = u.token || null;
    try { if (authToken) localStorage.setItem("ep_token", authToken); } catch (e) {}
    state.user = u;
    state.settings = await api("/api/settings");
    enterApp();
  } catch (err) {
    // wrong username / password — echo it clearly and shake the card
    $("#login-error").textContent = "❌ " + err.message;
    $("#login-password").value = "";
    $("#login-password").focus();
    void card.offsetWidth; // restart the animation
    card.classList.add("shake");
  }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Sign in"; } }
}
$("#login-form").addEventListener("submit", (e) => { e.preventDefault(); doLogin($("#login-username").value.trim(), $("#login-password").value); });
$("#logout-btn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch (e) {}
  authToken = null;
  try { localStorage.removeItem("ep_token"); } catch (e) {}
  state.user = null;
  showLogin();
});
$("#modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });
$("#hamburger").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#user-chip").addEventListener("click", myAccount);

async function boot() {
  try {
    state.user = await api("/api/me");
    state.settings = await api("/api/settings");
    enterApp();
  } catch (e) { showLogin(); }
}

/* ============================================================
   ROUTER
   ============================================================ */
const VIEWS = {
  dashboard:    { title: "Dashboard",        sub: "School overview at a glance",  fn: view_dashboard },
  students:     { title: "Students",         sub: "Admissions, profiles & records", fn: view_students },
  teachers:     { title: "Teachers",         sub: "Staff records & subject allocation", fn: view_teachers },
  classes:      { title: "Classes",          sub: "Streams, class teachers & capacity", fn: view_classes },
  subjects:     { title: "Subjects",         sub: "Subjects and subject teachers", fn: view_subjects },
  exams:        { title: "Exams & Marks",    sub: "Create exams and enter marks",  fn: view_exams },
  examDetail:   { title: "Marks Entry",      sub: "Enter scores per class",        fn: view_examDetail },
  analytics:    { title: "Analytics",        sub: "Performance analysis & reports", fn: view_analytics },
  reportcard:   { title: "Report Cards",     sub: "Generate & print report cards", fn: view_reportcard },
  timetable:    { title: "Timetable",        sub: "Weekly class & teacher schedules", fn: view_timetable },
  finance:      { title: "Finance & Fees",   sub: "Billing, payments & arrears",   fn: view_finance },
  transport:    { title: "Transport",        sub: "Routes, riders & daily registers", fn: view_transport },
  attendance:   { title: "Attendance",       sub: "Daily registers & summaries",   fn: view_attendance },
  communication:{ title: "Communication",    sub: "Announcements & message centre", fn: view_communication },
  library:      { title: "Library",           sub: "Books, issues & returns",       fn: view_library },
  events:       { title: "Events",            sub: "School calendar & activities",  fn: view_events },
  discipline:   { title: "Discipline & Conduct", sub: "Merits, demerits & behaviour", fn: view_discipline },
  gevents:      { title: "School Events",     sub: "What's happening at school",    fn: view_gevents },
  idcards:      { title: "ID Cards",          sub: "Student identification cards", fn: view_idcards },
  settings:     { title: "Settings",         sub: "School configuration & users",  fn: view_settings },
  gdash:        { title: "My Dashboard",     sub: "Your children at a glance",     fn: view_gdash },
  gresults:     { title: "Results",          sub: "Exam results & performance",    fn: view_gresults },
  gfees:        { title: "Fees & Payments",  sub: "Statements & M-PESA payments", fn: view_gfees },
  gtransport:   { title: "Transport",        sub: "Bus route & boarding record",   fn: view_gtransport },
  gattendance:  { title: "Attendance",       sub: "School attendance summary",     fn: view_gattendance },
  gannounce:    { title: "Announcements",    sub: "News from the school",          fn: view_gannounce },
};
function openView(name, params = {}) {
  const v = VIEWS[name];
  if (!v) return;
  state.view = name; state.params = params;
  renderNav();
  $("#page-title").textContent = v.title;
  $("#page-subtitle").textContent = v.sub;
  $("#sidebar").classList.remove("open");
  const el = $("#view");
  el.innerHTML = `<div class="skeleton-wrap">
    <div class="skeleton-row">${[0, 1, 2, 3].map(() => '<div class="skeleton-card"><div class="sk sk-h"></div><div class="sk sk-m"></div><div class="sk sk-s"></div></div>').join("")}</div>
    <div class="skeleton-row"><div class="skeleton-card wide"><div class="sk sk-h"></div><div class="sk sk-l"></div><div class="sk sk-l" style="width:80%"></div></div></div>
  </div>`;
  v.fn(el, params).catch(err => { el.innerHTML = `<div class="empty"><p style="color:var(--red)">${esc(err.message)}</p></div>`; });
}

/* ============================================================
   CHARTS (pure SVG / HTML)
   ============================================================ */
function vbarChart(el, items, { height = 190, color = "#16a34a", valueFmt = fmtNum } = {}) {
  if (!items.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }
  const W = 560, H = height, padB = 34, padT = 22, padL = 6, padR = 6;
  const max = Math.max(...items.map(i => i.value), 1);
  const iw = (W - padL - padR) / items.length;
  let bars = "", labels = "";
  items.forEach((it, i) => {
    const h = Math.max(2, (it.value / max) * (H - padB - padT));
    const x = padL + i * iw + iw * 0.16;
    const y = H - padB - h;
    const col = it.color || color;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(iw * 0.68).toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${col}"/>`;
    bars += `<text x="${(x + iw * 0.34).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#334155">${valueFmt(it.value)}</text>`;
    labels += `<text x="${(x + iw * 0.34).toFixed(1)}" y="${(H - 10).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#64748b">${esc(it.label)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${bars}${labels}</svg>`;
}
function hbarChart(el, items, { color = "#16a34a", unit = "", max } = {}) {
  if (!items.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }
  const m = max || Math.max(...items.map(i => i.value), 1);
  el.innerHTML = items.map(it => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
      <div style="width:140px;flex:none;font-size:12.5px;color:#475569;font-weight:600;text-align:right">${esc(it.label)}</div>
      <div class="progress" style="flex:1"><div style="width:${(it.value / m * 100).toFixed(1)}%;background:${it.color || color}"></div></div>
      <div style="width:70px;flex:none;text-align:right;font-weight:700;font-size:12.5px">${fmtNum(it.value)}${unit}</div>
    </div>`).join("");
}
function lineChart(el, points, { height = 200, color = "#16a34a" } = {}) {
  if (points.length < 2) { el.innerHTML = '<div class="empty">Need at least 2 points for a trend</div>'; return; }
  const W = 560, H = height, padT = 24, padB = 30, padL = 34, padR = 12;
  const max = Math.max(...points.map(p => p.value), 1) * 1.12;
  const x = (i) => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = (v) => H - padB - (v / max) * (H - padT - padB);
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${padL},${H - padB} ${pts} ${x(points.length - 1).toFixed(1)},${H - padB}`;
  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const gy = padT + (g / 4) * (H - padT - padB);
    grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="#eef2f7"/>`;
    grid += `<text x="${padL - 7}" y="${gy + 3.5}" text-anchor="end" font-size="10" fill="#94a3b8">${Math.round(max * (1 - g / 4))}</text>`;
  }
  let dots = "", labs = "";
  points.forEach((p, i) => {
    dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    dots += `<text x="${x(i).toFixed(1)}" y="${(y(p.value) - 9).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#334155">${fmtNum(p.value)}</text>`;
    labs += `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="#64748b">${esc(p.label)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${grid}
    <polygon points="${area}" fill="${color}" opacity="0.10"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labs}</svg>`;
}
function donut(el, segments, { size = 150 } = {}) {
  if (!segments.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 54, cx = 75, cy = 75, C = 2 * Math.PI * r;
  let off = 0, arcs = "";
  segments.forEach(s => {
    const frac = s.value / total;
    const dash = frac * C;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="26"
      stroke-dasharray="${dash.toFixed(1)} ${(C - dash).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}"
      transform="rotate(-90 ${cx} ${cy})"/>`;
    off += dash;
  });
  el.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
    <svg viewBox="0 0 150 150" style="width:${size}px;height:${size}px;flex:none">${arcs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="20" font-weight="800" fill="#0f172a">${fmtNum(total, 0)}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9" fill="#94a3b8">TOTAL</text>
    </svg>
    <div class="chart-legend" style="margin:0;flex-direction:column;gap:7px">
      ${segments.map(s => `<span><span class="dot" style="background:${s.color}"></span>${esc(s.label)} — <b>${fmtNum(s.value)}</b></span>`).join("")}
    </div></div>`;
}
function statCard(color, icon, num, label, sub) {
  return `<div class="stat-card">
    <div class="stat-ic ${color}"><svg><use href="#i-${icon}"/></svg></div>
    <div><div class="num">${esc(num)}</div><div class="lbl">${esc(label)}</div><div class="sub">${esc(sub)}</div></div>
  </div>`;
}

/* ============================================================
   PROFILE PICTURE UPLOAD
   ============================================================ */
let pendingPic = null; // data URI staged while creating a record
async function uploadPic(kind, id, dataUri) {
  const r = await api(`/api/upload/${kind}/${id}`, { method: "POST", body: { data: dataUri } });
  return r.path;
}
function bindPicInput(kind, idGetter, previewSel = "#pic-preview", afterUpload) {
  const file = $("#pic-file");
  if (!file) return;
  $("#pic-btn").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      pendingPic = reader.result;
      $(previewSel).innerHTML = `<img src="${pendingPic}" alt="">`;
      const id = idGetter();
      if (id) {
        try {
          const path = await uploadPic(kind, id, pendingPic);
          pendingPic = null;
          if (afterUpload) afterUpload(path);
          toast("Photo updated");
        } catch (err) { toast(err.message, "err"); }
      }
    };
    reader.readAsDataURL(f);
  });
}

/* ============================================================
   MY ACCOUNT
   ============================================================ */
async function myAccount() {
  const u = await api("/api/me");
  modal(`
  <div class="modal-head"><h3>My Account</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <div class="avatar-uploader" style="margin-bottom:16px">
      <div class="avatar-lg" id="pic-preview">${u.profile_pic ? `<img src="${esc(u.profile_pic)}" alt="">` : esc(initials(u.name))}</div>
      <div class="meta">
        <button class="btn btn-outline btn-sm" id="pic-btn" type="button"><svg><use href="#i-upload"/></svg> Upload photo</button>
        <small>Set your profile picture</small>
      </div>
    </div>
    <div class="form-grid">
      <div><label>Username</label><input class="input" value="${esc(u.username)}" disabled></div>
      <div><label>Role</label><input class="input" value="${esc({admin:"Administrator",teacher:"Teacher",accounts:"Accounts"}[u.role] || u.role)}" disabled></div>
      <div><label>Full name</label><input class="input" value="${esc(u.name)}" disabled></div>
    </div>
    <div class="section-title">Change password</div>
    <div class="form-grid">
      <div><label>Current password</label><input id="pw-old" type="password" class="input"></div>
      <div></div>
      <div><label>New password</label><input id="pw-new" type="password" class="input"></div>
      <div><label>Confirm new password</label><input id="pw-new2" type="password" class="input"></div>
    </div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Close</button>
    <button class="btn btn-primary" id="pw-save">Update password</button>
  </div>`);
  bindPicInput("user", () => u.id, "#pic-preview", async (path) => {
    state.user.profile_pic = path;
    $("#user-avatar").innerHTML = `<img src="${esc(path)}" alt="">`;
  });
  $("#pw-save").addEventListener("click", async () => {
    const old = $("#pw-old").value, n1 = $("#pw-new").value, n2 = $("#pw-new2").value;
    if (!old || !n1) { toast("Fill all password fields", "err"); return; }
    if (n1 !== n2) { toast("New passwords do not match", "err"); return; }
    try {
      await api("/api/me/password", { method: "PUT", body: { old, new: n1 } });
      toast("Password updated");
      closeModal();
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function view_dashboard(el) {
  const d = await api("/api/dashboard");
  state.settings = d.settings;
  const f = d.finance, p = d.performance, tr = d.transport;
  const rate = f.billed ? Math.round(f.paid / f.billed * 100) : 0;
  const trate = f.billed_term ? Math.round(f.paid_term / f.billed_term * 100) : 0;
  const dist = (p && p.grade_dist) || {};
  const gItems = Object.keys(dist).map(g => ({ label: g, value: dist[g], color: g[0] === "A" ? "#16a34a" : g[0] === "B" ? "#4ade80" : g[0] === "C" ? "#f59e0b" : g[0] === "D" ? "#f97316" : "#ef4444" }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (state.user.name || "there").split(" ")[0];
  const termDates = d.settings.term_start ? `${fmtDate(d.settings.term_start)} – ${fmtDate(d.settings.term_end)}` : "";
  const qa = [];
  if (can("admin")) qa.push(`<button class="qa-btn" onclick="openView('students')"><svg><use href="#i-users"/></svg> Add student</button>`);
  if (can("admin", "accounts")) qa.push(`<button class="qa-btn" onclick="openView('finance')"><svg><use href="#i-money"/></svg> Record payment</button>`);
  if (can("admin", "teacher")) qa.push(`<button class="qa-btn" onclick="openView('exams')"><svg><use href="#i-exam"/></svg> Enter marks</button>`);
  if (can("admin")) qa.push(`<button class="qa-btn" onclick="openView('communication')"><svg><use href="#i-message"/></svg> Announce</button>`);

  el.innerHTML = `
  <div class="welcome-banner">
    <div>
      <h2>${esc(greeting)}, ${esc(firstName)} 👋</h2>
      <p>${esc(d.settings.school_name)} · ${esc(d.term)} ${esc(d.year)}${termDates ? " · " + esc(termDates) : ""}</p>
    </div>
    <div class="quick-actions">${qa.join("")}</div>
  </div>

  <div class="stat-grid">
    ${statCard("green", "i-users", d.counts.students, "Students", d.counts.students + " active")}
    ${statCard("blue", "i-teacher", d.counts.teachers, "Teachers", d.counts.teachers + " on staff")}
    ${statCard("violet", "i-class", d.counts.classes, "Classes", d.counts.subjects + " subjects taught")}
    ${statCard("amber", "i-bus", tr.assigned, "On School Transport", tr.boarded_today + " boarded today")}
    ${d.library ? statCard("blue", "i-book", d.library.total_titles, "Library books", d.library.issued + " issued · " + d.library.overdue + " overdue") : ""}
  </div>

  <div class="grid-2-1">
    <div class="card">
      <div class="card-head"><h3>Fee Collection <span id="fee-year" style="color:var(--muted);font-size:12px;font-weight:500">${esc(d.year)}</span></h3>
        <span class="badge b-green">${rate}% collected</span></div>
      <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi"><div class="k">Billed (year)</div><div class="v">${fmtMoney(f.billed)}</div></div>
        <div class="kpi"><div class="k">Collected</div><div class="v" style="color:var(--green-dark)">${fmtMoney(f.paid)}</div></div>
        <div class="kpi"><div class="k">Arrears</div><div class="v" style="color:${f.arrears > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(f.arrears)}</div></div>
      </div>
      <div class="kgrid" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
        <div class="kpi"><div class="k">${esc(d.term)} billed</div><div class="v">${fmtMoney(f.billed_term)}</div></div>
        <div class="kpi"><div class="k">${esc(d.term)} paid</div><div class="v" style="color:var(--green-dark)">${fmtMoney(f.paid_term)}</div></div>
        <div class="kpi"><div class="k">${esc(d.term)} rate</div><div class="v">${trate}%</div></div>
      </div>
      <div class="section-title">Collections by class (year)</div>
      <div id="fee-bars"></div>
      <div style="margin-top:14px">${acctBtn(`<button class="btn btn-outline btn-sm" onclick="openView('finance')">Open Finance <svg><use href="#i-money"/></svg></button>`)}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Performance</h3>
        ${p ? `<span class="badge b-blue">${esc(p.exam_name)}</span>` : ""}</div>
      ${p ? `
        <div class="kgrid" style="grid-template-columns:1fr 1fr">
          <div class="kpi"><div class="k">Overall mean</div><div class="v">${fmtNum(p.mean)}</div></div>
          <div class="kpi"><div class="k">Subject top</div><div class="v" style="font-size:14px">${esc(p.subject_means[0] ? p.subject_means[0].name : "—")} (${fmtNum(p.subject_means[0] ? p.subject_means[0].mean : 0)})</div></div>
        </div>
        <div class="section-title">Grade distribution</div>
        <div id="d-grade-dist"></div>
        <div class="section-title">Subject means</div>
        <div id="d-subj-means"></div>`
      : '<div class="empty">No closed exam yet</div>'}
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h3>Performance trend</h3><p>Overall mean per exam</p></div>
      <div id="d-trend"></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Class performance <small style="color:var(--muted);font-weight:500">(${p ? esc(p.exam_name) : ""})</small></h3></div>
      <div id="d-class-means"></div>
      <div class="section-title">Attendance today</div>
      <div style="font-size:13px;color:var(--slate)"><b style="font-size:18px">${d.attendance_today}</b> records marked today</div>
    </div>
  </div>

  <div class="grid-2" style="margin-top:18px">
    <div class="card">
      <div class="card-head"><h3>Needs attention</h3><p>Actionable items across the school</p></div>
      <div>
        ${d.alerts.map(a => `
          <div class="alert-item">
            <div class="alert-ic ${a.tone}"><svg><use href="#${a.icon}"/></svg></div>
            <div><div class="a-val">${a.value}</div><div class="a-lbl">${esc(a.label)}</div></div>
            <div class="a-go" onclick="openView('${a.view}')">Open <svg style="width:13px;height:13px"><use href="#i-arrow"/></svg></div>
          </div>`).join("")}
      </div>
      <div class="section-title">Conduct this term</div>
      <div class="kgrid" style="grid-template-columns:1fr 1fr">
        <div class="kpi"><div class="k">Merits</div><div class="v" style="color:var(--green-dark)">${d.conduct ? d.conduct.merits : 0}</div></div>
        <div class="kpi"><div class="k">Demerits</div><div class="v" style="color:${d.conduct && d.conduct.demerits > 0 ? "var(--red)" : "var(--green-dark)"}">${d.conduct ? d.conduct.demerits : 0}</div></div>
      </div>
      <div class="section-title">Recent activity</div>
      <div>
        ${d.activity.map(act => `
          <div class="activity-item">
            <div class="activity-dot"></div>
            <div>
              <div class="a-act">${esc(act.action)}</div>
              <div class="a-det">${esc(act.detail || "")}</div>
              <div class="a-who">${esc(act.user_name || "System")} · ${timeAgo(act.created_at)}</div>
            </div>
          </div>`).join("") || '<p style="color:var(--muted);font-size:13px">No activity yet</p>'}
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>Recent payments</h3><p>Latest fee transactions</p></div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Student</th><th>Amount</th><th>Method</th><th>Date</th><th>Ref</th></tr></thead>
          <tbody>${d.recent_payments.map(p => `
            <tr><td><b>${esc(p.first_name + " " + p.last_name)}</b><br><small style="color:var(--muted)">${esc(p.admission_no)}</small></td>
            <td class="num"><b style="color:var(--green-dark)">${fmtMoney(p.amount)}</b></td>
            <td><span class="badge ${p.method === "M-PESA" ? "b-green" : p.method === "Cash" ? "b-amber" : "b-blue"}">${esc(p.method || "—")}</span></td>
            <td>${fmtDate(p.payment_date)}</td><td><small>${esc(p.reference || "—")}</small></td></tr>`).join("")}
          </tbody></table></div>
      </div>
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>Upcoming events</h3><p>School calendar</p></div>
        <div>
          ${(d.upcoming_events || []).map(ev => `
            <div style="display:flex;gap:11px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
              <div style="width:40px;flex:none;text-align:center;background:var(--green-100);color:var(--green-dark);border-radius:9px;padding:5px 2px">
                <b style="font-size:13px">${fmtDate(ev.event_date).split(" ")[0]}</b>
                <small style="display:block;font-size:9px">${fmtDate(ev.event_date).split(" ")[1]}</small>
              </div>
              <div><b style="font-size:13px">${esc(ev.title)}</b>
                <small style="display:block;color:var(--muted)">${esc(ev.category)} · ${esc(ev.audience)}</small></div>
            </div>`).join("") || '<p style="color:var(--muted)">No upcoming events</p>'}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Recent announcements</h3><p>Latest news</p></div>
        <div class="scroll-y">
          ${d.recent_announcements.map(a => `
            <div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <b style="font-size:13px">${esc(a.title)}</b>
              <p style="font-size:12px;color:var(--muted);margin-top:2px">${esc((a.message || "").slice(0, 90))}${(a.message || "").length > 90 ? "…" : ""}</p>
            </div>`).join("") || '<p style="color:var(--muted)">No announcements</p>'}
        </div>
      </div>
    </div>
  </div>`;

  hbarChart($("#fee-bars"), f.class_breakdown.map(c => ({ label: c.name, value: Math.round(c.paid), color: "#16a34a" })), { unit: "", max: Math.max(...f.class_breakdown.map(c => c.billed), 1) });
  if (p) {
    vbarChart($("#d-grade-dist"), gItems, { height: 160 });
    hbarChart($("#d-subj-means"), p.subject_means.map(s => ({ label: s.name, value: s.mean, color: "#7c3aed" })), { max: 100 });
    hbarChart($("#d-class-means"), p.class_means.map(c => ({ label: c.name, value: c.mean, color: "#2563eb" })), { max: 100 });
  }
  const ex = await api("/api/analytics");
  const trend = (ex.data && ex.data.trend || []).map(t => ({ label: t.term, value: t.mean }));
  lineChart($("#d-trend"), trend.length ? trend : [{ label: "—", value: 0 }]);
}

/* ============================================================
   STUDENTS
   ============================================================ */
async function view_students(el, p) {
  const [students, classes] = await Promise.all([api("/api/students"), api("/api/classes")]);
  state.students = students; state.classes = classes;
  const clsFilter = p && p.class_id ? String(p.class_id) : "";
  renderStudents(el, students, classes, clsFilter);
}
function stuRowHtml(s) {
  return `<tr>
    <td>${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}<b style="margin-left:8px">${esc(s.first_name + " " + (s.middle_name ? s.middle_name + " " : "") + s.last_name)}</b></td>
    <td><span class="badge b-slate">${esc(s.admission_no)}</span></td>
    <td>${esc(s.gender || "—")}</td>
    <td>${s.class_name ? esc(s.class_name) : '<span class="badge b-red">Unplaced</span>'}</td>
    <td>${esc(s.parent_name || "—")}</td>
    <td>${esc(s.parent_phone || "—")}</td>
    <td><span class="badge ${s.status === "Active" ? "b-green" : "b-slate"}">${esc(s.status)}</span></td>
    <td><div class="actions">
      <button class="ic-btn" title="View" onclick="studentDetail(${s.id})"><svg><use href="#i-eye"/></svg></button>
      ${adminBtn(`<button class="ic-btn" title="Edit" onclick="studentForm(${s.id})"><svg><use href="#i-edit"/></svg></button>`)}
    </div></td>
  </tr>`;
}
function filterStudents(students, clsFilter, q, status) {
  return students.filter(s =>
    (!clsFilter || String(s.class_id || "") === clsFilter) &&
    (!q || (s.first_name + " " + (s.middle_name || "") + " " + s.last_name + " " + (s.admission_no || "") + " " + (s.parent_name || "")).toLowerCase().includes(q.toLowerCase())) &&
    (!status || s.status === status));
}
function renderStudents(el, students, classes, clsFilter = "", q = "", status = "") {
  const rows = filterStudents(students, clsFilter, q, status);
  el.innerHTML = `
  <div class="toolbar">
    <div class="search-wrap"><svg><use href="#i-search"/></svg>
      <input class="input" id="stu-q" placeholder="Search name, admission no, parent…" value="${esc(q)}"></div>
    <select class="input" id="stu-class">
      <option value="">All classes</option>
      ${classes.map(c => `<option value="${c.id}" ${clsFilter === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
    </select>
    <select class="input" id="stu-status">
      <option value="">Any status</option><option value="Active" ${status === "Active" ? "selected" : ""}>Active</option>
      <option value="Transferred" ${status === "Transferred" ? "selected" : ""}>Transferred</option>
      <option value="Graduated" ${status === "Graduated" ? "selected" : ""}>Graduated</option>
    </select>
    <div class="grow"></div>
    ${adminBtn(`
    <button class="btn btn-outline" onclick="importStudents()"><svg><use href="#i-upload2"/></svg> Import CSV</button>
    <button class="btn btn-outline" onclick="promoteClass()"><svg><use href="#i-arrow"/></svg> Promote</button>
    <button class="btn btn-outline" onclick="studentForm()"><svg><use href="#i-plus"/></svg> Add Student</button>`)}
    <button class="btn btn-outline" onclick="exportCSV('students.csv',['Adm No','First Name','Middle','Last','Gender','Class','Parent','Phone','Status'],
      ${JSON.stringify(rows.map(r => [r.admission_no, r.first_name, r.middle_name || "", r.last_name, r.gender, r.class_name || "", r.parent_name || "", r.parent_phone || "", r.status])).replace(/"/g, '&quot;')})">CSV</button>
  </div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>Student</th><th>Admission No</th><th>Gender</th><th>Class</th><th>Parent</th><th>Parent Phone</th><th>Status</th><th class="num">Actions</th></tr></thead>
    <tbody id="stu-body">
      ${rows.map(stuRowHtml).join("")}
    </tbody></table></div>
  <p id="stu-count" style="font-size:12px;color:var(--muted);margin-top:10px">${rows.length} student${rows.length === 1 ? "" : "s"} shown</p>
  ${rows.length === 0 ? '<div class="empty">No students match the filters</div>' : ""}`;
  // keep the toolbar stable — only the tbody re-renders on filter changes, so typing/search focus is preserved
  $("#stu-q").addEventListener("input", e => {
    const rows2 = filterStudents(students, clsFilter, e.target.value, status);
    $("#stu-body").innerHTML = rows2.map(stuRowHtml).join("");
    $("#stu-count").textContent = rows2.length + " student" + (rows2.length === 1 ? "" : "s") + " shown";
    if (!rows2.length) $("#stu-count").insertAdjacentHTML("afterend", '<div class="empty">No students match the filters</div>');
    else { const em = $("#stu-count").nextElementSibling; if (em && em.classList.contains("empty")) em.remove(); }
  });
  $("#stu-class").addEventListener("change", e => {
    clsFilter = e.target.value;
    const rows2 = filterStudents(students, clsFilter, $("#stu-q").value, status);
    $("#stu-body").innerHTML = rows2.map(stuRowHtml).join("");
    $("#stu-count").textContent = rows2.length + " student" + (rows2.length === 1 ? "" : "s") + " shown";
  });
  $("#stu-status").addEventListener("change", e => {
    status = e.target.value;
    const rows2 = filterStudents(students, clsFilter, $("#stu-q").value, status);
    $("#stu-body").innerHTML = rows2.map(stuRowHtml).join("");
    $("#stu-count").textContent = rows2.length + " student" + (rows2.length === 1 ? "" : "s") + " shown";
  });
}
async function studentForm(id) {
  const classes = await api("/api/classes");
  let st = { gender: "Male", status: "Active", class_id: "" };
  if (id) {
    const d = await api("/api/students/" + id);
    st = { ...d, class_id: d.class ? d.class.id : "" };
  }
  const hasPic = id && st.profile_pic;
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Student" : "Add Student"}</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full">
      <label>Profile picture</label>
      <div class="avatar-uploader">
        <div class="avatar-lg" id="pic-preview">${hasPic ? `<img src="${esc(st.profile_pic)}" alt="">` : esc(initials((st.first_name || "?") + " " + (st.last_name || "")))}</div>
        <div class="meta">
          <input type="file" id="pic-file" accept="image/*" hidden>
          <button class="btn btn-outline btn-sm" id="pic-btn" type="button"><svg><use href="#i-upload"/></svg> Upload photo</button>
          <small>JPG or PNG, up to 4MB</small>
        </div>
      </div>
    </div>
    <div><label>Admission No</label><input id="f-adm" value="${esc(st.admission_no || "")}" placeholder="GF/2026/001"></div>
    <div><label>Class</label>
      <select id="f-class"><option value="">— unplaced —</option>
      ${classes.map(c => `<option value="${c.id}" ${String(st.class_id) === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select></div>
    <div><label>First Name *</label><input id="f-first" value="${esc(st.first_name || "")}"></div>
    <div><label>Middle Name</label><input id="f-mid" value="${esc(st.middle_name || "")}"></div>
    <div><label>Last Name *</label><input id="f-last" value="${esc(st.last_name || "")}"></div>
    <div><label>Gender</label><select id="f-gender">
      <option ${st.gender === "Male" ? "selected" : ""}>Male</option><option ${st.gender === "Female" ? "selected" : ""}>Female</option></select></div>
    <div><label>Date of Birth</label><input id="f-dob" type="date" value="${esc(st.dob || "")}"></div>
    <div><label>Admission Date</label><input id="f-admdate" type="date" value="${esc(st.admission_date || "")}"></div>
    <div class="full"><label>Parent / Guardian Name</label><input id="f-parent" value="${esc(st.parent_name || "")}"></div>
    <div><label>Parent Phone</label><input id="f-pphone" value="${esc(st.parent_phone || "")}" placeholder="07XX XXX XXX"></div>
    <div><label>Parent Email</label><input id="f-pemail" value="${esc(st.parent_email || "")}"></div>
    <div class="full"><label>Home Address</label><input id="f-addr" value="${esc(st.address || "")}"></div>
    <div><label>Blood Group</label><select id="f-blood">
      ${["", "O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"].map(b => `<option ${st.blood_group === b ? "selected" : ""}>${b}</option>`).join("")}
    </select></div>
    <div><label>House</label><select id="f-house">
      ${["", "Simba", "Chui", "Nyati", "Tembo"].map(h => `<option ${st.house === h ? "selected" : ""}>${h}</option>`).join("")}
    </select></div>
    <div><label>Status</label><select id="f-status">
      ${["Active", "Transferred", "Graduated"].map(x => `<option ${st.status === x ? "selected" : ""}>${x}</option>`).join("")}
    </select></div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="stu-save">Save Student</button>
  </div>`);
  bindPicInput("student", () => id || null, "#pic-preview");
  $("#stu-save").addEventListener("click", async () => {
    const body = {
      admission_no: $("#f-adm").value.trim(), class_id: $("#f-class").value,
      first_name: $("#f-first").value.trim(), middle_name: $("#f-mid").value.trim(),
      last_name: $("#f-last").value.trim(), gender: $("#f-gender").value,
      dob: $("#f-dob").value, admission_date: $("#f-admdate").value,
      parent_name: $("#f-parent").value.trim(), parent_phone: $("#f-pphone").value.trim(),
      parent_email: $("#f-pemail").value.trim(), address: $("#f-addr").value.trim(), status: $("#f-status").value,
      blood_group: $("#f-blood").value, house: $("#f-house").value,
    };
    if (!body.first_name || !body.last_name) { toast("First and last name are required", "err"); return; }
    try {
      let newId = id;
      if (id) { await api("/api/students/" + id, { method: "PUT", body }); toast("Student updated"); }
      else { const r = await api("/api/students", { method: "POST", body }); newId = r.id; toast("Student added"); }
      if (pendingPic && newId) {
        const path = await uploadPic("student", newId, pendingPic);
        pendingPic = null;
        toast("Profile photo saved");
      }
      closeModal();
      openView("students");
    } catch (err) { toast(err.message, "err"); }
  });
}
async function importStudents() {
  const classes = await api("/api/classes");
  modal(`
  <div class="modal-head"><h3>Import students from CSV</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <p style="font-size:13px;color:var(--slate);margin-bottom:10px">Paste rows with the header:</p>
    <pre style="background:#f8fafc;border:1px solid var(--line);border-radius:8px;padding:9px 12px;font-size:12px;color:var(--slate);white-space:pre-wrap">first_name,last_name,gender,class,parent_name,parent_phone
Jane,Wanjiru,Female,Grade 1 East,Mary Wanjiru,0712345678
Brian,Otieno,Male,Grade 7 West,John Otieno,0723456789</pre>
    <div class="section-title">Class name must match exactly</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
      ${classes.map(c => `<span class="badge b-slate">${esc(c.name)}</span>`).join("")}
    </div>
    <label style="font-size:12.5px;font-weight:600;color:var(--slate)">CSV data</label>
    <textarea id="imp-csv" class="input" rows="8" style="width:100%;margin-top:6px;font-family:ui-monospace,monospace;font-size:12.5px" placeholder="first_name,last_name,gender,class,parent_name,parent_phone"></textarea>
    <p class="full" style="font-size:12px;color:var(--muted);margin-top:8px">Blank class leaves the student unplaced. Admission numbers are generated automatically.</p>
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="imp-save"><svg><use href="#i-upload2"/></svg> Import</button>
  </div>`);
  $("#imp-save").addEventListener("click", async () => {
    const data = $("#imp-csv").value;
    if (!data.trim()) { toast("Paste some CSV data first", "err"); return; }
    try {
      const r = await api("/api/students/import", { method: "POST", body: { data } });
      let msg = `Imported ${r.created} student${r.created === 1 ? "" : "s"}`;
      if (r.skipped) msg += ` · ${r.skipped} skipped`;
      toast(msg);
      if (r.errors && r.errors.length) {
        modal(`<div class="modal-head"><h3>Import finished — issues</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
        <div class="modal-body"><div class="scroll-y" style="max-height:300px">
          ${r.errors.map(e => `<p style="font-size:13px;color:var(--red);padding:5px 0;border-bottom:1px solid #f1f5f9">${esc(e)}</p>`).join("")}
        </div></div>
        <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal();openView('students')">Done</button></div>`);
      } else { closeModal(); openView("students"); }
    } catch (err) { toast(err.message, "err"); }
  });
}
async function promoteClass() {
  const classes = await api("/api/classes");
  modal(`
  <div class="modal-head"><h3>Promote a class</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <p style="font-size:13px;color:var(--slate);margin-bottom:14px">Move <b>every student</b> from one class into another for the <b>whole academic year</b> — e.g. Grade 1 East → Grade 2 East at the start of a new year.</p>
    <div class="form-grid">
      <div><label>From class</label><select id="pm-from" class="input">
        ${classes.map(c => `<option value="${c.id}">${esc(c.name)} (${c.cnt} students)</option>`).join("")}
      </select></div>
      <div><label>To class</label><select id="pm-to" class="input">
        ${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
      </select></div>
    </div>
    <div class="full" style="background:var(--green-50);border:1px solid var(--green-100);border-radius:9px;padding:10px 12px;margin-top:8px">
      <b style="font-size:13px;color:var(--green-dark)">✓ The class being left becomes completely empty</b>
      <p style="font-size:12px;color:var(--slate);margin-top:3px">All three terms are reassigned to the target class, so no student stays behind and there are no mix-ups. The empty class is ready for a fresh intake. Timetables, fees and results are not affected.</p>
    </div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="pm-save"><svg><use href="#i-arrow"/></svg> Promote</button>
  </div>`);
  $("#pm-save").addEventListener("click", async () => {
    const from = $("#pm-from").value, to = $("#pm-to").value;
    if (!from || !to) { toast("Choose both classes", "err"); return; }
    try {
      const r = await api("/api/students/promote", { method: "POST", body: { from_class_id: Number(from), to_class_id: Number(to) } });
      toast(`Promoted ${r.moved} students → ${r.to}`);
      closeModal(); openView("students");
    } catch (err) { toast(err.message, "err"); }
  });
}

async function studentDetail(id) {
  const d = await api("/api/students/" + id);
  const perf = await api("/api/analytics/student/" + id).catch(() => null);
  const latest = perf && perf.agg ? perf.agg : null;
  const totalBilled = Object.values(d.billing || {}).reduce((a, b) => a + b, 0);
  const totalPaid = (d.payments || []).reduce((a, p) => a + p.amount, 0);
  const tr = d.transport && d.transport[0];
  const name = d.first_name + " " + (d.middle_name ? d.middle_name + " " : "") + d.last_name;
  const dScale = "cbc";
  const mg = latest ? meanGradeFromPts(latest.avg_pts) : null;
  modal(`
  <div class="modal-head"><h3 style="display:flex;align-items:center;gap:10px">${avatarHtml(d.profile_pic, name, "avatar-sm")} ${esc(name)}</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="k">Admission No</div><div class="v" style="font-size:15px">${esc(d.admission_no)}</div></div>
      <div class="kpi"><div class="k">Class</div><div class="v" style="font-size:15px">${d.class ? esc(d.class.name) : "—"}</div></div>
      <div class="kpi"><div class="k">Status</div><div class="v" style="font-size:15px">${esc(d.status)}</div></div>
    </div>
    <div class="section-title">Profile</div>
    <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="k">Gender</div><div class="v" style="font-size:15px">${esc(d.gender || "—")}</div></div>
      <div class="kpi"><div class="k">Date of birth</div><div class="v" style="font-size:15px">${fmtDate(d.dob)}</div></div>
      <div class="kpi"><div class="k">Admitted</div><div class="v" style="font-size:15px">${fmtDate(d.admission_date)}</div></div>
      <div class="kpi"><div class="k">Parent</div><div class="v" style="font-size:15px">${esc(d.parent_name || "—")}</div></div>
      <div class="kpi"><div class="k">Parent phone</div><div class="v" style="font-size:15px">${esc(d.parent_phone || "—")}</div></div>
      <div class="kpi"><div class="k">Address</div><div class="v" style="font-size:15px">${esc(d.address || "—")}</div></div>
      <div class="kpi"><div class="k">House</div><div class="v" style="font-size:15px">${esc(d.house || "—")}</div></div>
      <div class="kpi"><div class="k">Blood group</div><div class="v" style="font-size:15px">${esc(d.blood_group || "—")}</div></div>
      <div class="kpi"><div class="k">Actions</div><div class="v" style="font-size:13px"><span class="pill-link" onclick="closeModal();openView('idcards',{studentId:${d.id}})">🪪 ID Card</span></div></div>
    </div>
    <div class="section-title">Transport</div>
    ${tr ? `<div class="kpi" style="border-color:var(--green-100)"><div class="k">Assigned route</div>
        <div class="v" style="font-size:15px"><svg style="width:15px;height:15px;vertical-align:-2px"><use href="#i-bus"/></svg> ${esc(tr.name)} · ${esc(tr.morning_time || "")}–${esc(tr.evening_time || "")} · ${fmtMoney(tr.fee)}/term</div></div>`
      : '<p style="color:var(--muted);font-size:13px">Not on school transport</p>'}
    <div class="section-title">Latest performance</div>
    ${latest ? `
      <div class="kgrid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi"><div class="k">Mean</div><div class="v">${fmtNum(latest.mean)}</div></div>
        <div class="kpi"><div class="k">${dScale === "cbc" ? "Level" : "Mean grade"}</div><div class="v"><span class="grade-pill ${gradeClass(mg, dScale)}">${mg || "—"}</span></div></div>
        <div class="kpi"><div class="k">Class rank</div><div class="v" style="font-size:15px">${perf.class_rank || "—"} / ${perf.class_size || "—"}</div></div>
        <div class="kpi"><div class="k">Subjects</div><div class="v" style="font-size:15px">${latest.subjects}</div></div>
      </div>` : '<p style="color:var(--muted)">No exam results yet.</p>'}
    <div class="section-title">Fee summary (all terms)</div>
    <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="k">Billed</div><div class="v">${fmtMoney(totalBilled)}</div></div>
      <div class="kpi"><div class="k">Paid</div><div class="v" style="color:var(--green-dark)">${fmtMoney(totalPaid)}</div></div>
      <div class="kpi"><div class="k">Balance</div><div class="v" style="color:${totalBilled - totalPaid > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(totalBilled - totalPaid)}</div></div>
    </div>
    ${d.payments && d.payments.length ? `
      <div class="section-title">Payments</div>
      <div class="table-wrap"><table class="tbl" style="min-width:0">
        <thead><tr><th>Date</th><th class="num">Amount</th><th>Type</th><th>Method</th><th>Ref</th><th>Receipt</th></tr></thead>
        <tbody>${d.payments.map(p => `<tr><td>${fmtDate(p.payment_date)}</td>
          <td class="num"><b>${fmtMoney(p.amount)}</b></td>
          <td><span class="badge ${typeBadge(p.payment_type_category)}">${esc(p.payment_type_name || "General")}</span></td>
          <td>${esc(p.method || "—")}</td>
          <td><small>${esc(p.reference || "—")}</small></td><td><small>${esc(p.receipt_no || "—")}</small></td></tr>`).join("")}
        </tbody></table></div>` : ""}
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Close</button>
    <button class="btn btn-outline" onclick="closeModal();openView('reportcard',{studentId:${d.id}})"><svg><use href="#i-report"/></svg> Report Card</button>
    <button class="btn btn-outline" onclick="closeModal();openView('analytics',{studentId:${d.id}})"><svg><use href="#i-chart"/></svg> Performance</button>
    ${adminBtn(`<button class="btn btn-primary" onclick="closeModal();studentForm(${d.id})"><svg><use href="#i-edit"/></svg> Edit</button>`)}
  </div>`);
}

/* ============================================================
   TEACHERS
   ============================================================ */
async function view_teachers(el) {
  const teachers = await api("/api/teachers");
  el.innerHTML = `
  <div class="toolbar">
    <div class="search-wrap"><svg><use href="#i-search"/></svg><input class="input" id="t-q" placeholder="Search teachers…"></div>
    <div class="grow"></div>
    ${adminBtn(`<button class="btn btn-outline" onclick="teacherForm()"><svg><use href="#i-plus"/></svg> Add Teacher</button>`)}
  </div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>Teacher</th><th>TSC No</th><th>Gender</th><th>Subject</th><th>Phone</th><th>Email</th><th>Type</th>${adminBtn('<th class="num">Actions</th>')}</tr></thead>
    <tbody id="t-body">${teacherRows(teachers)}</tbody>
  </table></div>`;
  $("#t-q").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    $("#t-body").innerHTML = teacherRows(teachers.filter(t =>
      (t.first_name + " " + t.last_name + " " + (t.subject_name || "")).toLowerCase().includes(q)));
  });
}
function teacherRows(teachers) {
  return teachers.map(t => `
    <tr><td>${avatarHtml(t.profile_pic, t.first_name + " " + t.last_name, "avatar-sm")}<b style="margin-left:8px">${esc(t.first_name + " " + t.last_name)}</b></td>
      <td><span class="badge b-slate">${esc(t.tsc_no || "—")}</span></td>
      <td>${esc(t.gender || "—")}</td>
      <td>${t.subject_name ? `<span class="badge b-blue">${esc(t.subject_name)}</span>` : "—"}</td>
      <td>${esc(t.phone || "—")}</td><td><small>${esc(t.email || "—")}</small></td>
      <td><span class="badge ${t.employment_type === "Permanent" ? "b-green" : "b-amber"}">${esc(t.employment_type || "—")}</span></td>
      ${adminBtn(`<td><div class="actions"><button class="ic-btn" onclick="teacherForm(${t.id})"><svg><use href="#i-edit"/></svg></button></div></td>`)}
    </tr>`).join("");
}
async function teacherForm(id) {
  const subjects = await api("/api/subjects");
  const all = await api("/api/teachers");
  let t = { gender: "Female", employment_type: "Permanent", subject_id: "" };
  if (id) t = all.find(x => x.id === id) || t;
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Teacher" : "Add Teacher"}</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full">
      <label>Profile picture</label>
      <div class="avatar-uploader">
        <div class="avatar-lg" id="pic-preview">${t.profile_pic ? `<img src="${esc(t.profile_pic)}" alt="">` : esc(initials((t.first_name || "?") + " " + (t.last_name || "")))}</div>
        <div class="meta">
          <input type="file" id="pic-file" accept="image/*" hidden>
          <button class="btn btn-outline btn-sm" id="pic-btn" type="button"><svg><use href="#i-upload"/></svg> Upload photo</button>
        </div>
      </div>
    </div>
    <div><label>TSC Number</label><input id="f-tsc" value="${esc(t.tsc_no || "")}" placeholder="TSC-2026001"></div>
    <div><label>Subject</label><select id="f-subject"><option value="">— none —</option>
      ${subjects.map(s => `<option value="${s.id}" ${String(t.subject_id) === String(s.id) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
    </select></div>
    <div><label>First Name *</label><input id="f-first" value="${esc(t.first_name || "")}"></div>
    <div><label>Last Name *</label><input id="f-last" value="${esc(t.last_name || "")}"></div>
    <div><label>Gender</label><select id="f-gender">
      <option ${t.gender === "Female" ? "selected" : ""}>Female</option><option ${t.gender === "Male" ? "selected" : ""}>Male</option></select></div>
    <div><label>Employment</label><select id="f-type">
      <option ${t.employment_type === "Permanent" ? "selected" : ""}>Permanent</option>
      <option ${t.employment_type === "Contract" ? "selected" : ""}>Contract</option>
      <option ${t.employment_type === "Intern" ? "selected" : ""}>Intern</option></select></div>
    <div><label>Phone</label><input id="f-phone" value="${esc(t.phone || "")}"></div>
    <div><label>Email</label><input id="f-email" value="${esc(t.email || "")}"></div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="t-save">Save Teacher</button>
  </div>`);
  bindPicInput("teacher", () => id || null, "#pic-preview");
  $("#t-save").addEventListener("click", async () => {
    const body = { tsc_no: $("#f-tsc").value.trim(), subject_id: $("#f-subject").value,
      first_name: $("#f-first").value.trim(), last_name: $("#f-last").value.trim(),
      gender: $("#f-gender").value, employment_type: $("#f-type").value,
      phone: $("#f-phone").value.trim(), email: $("#f-email").value.trim() };
    if (!body.first_name || !body.last_name) { toast("Names required", "err"); return; }
    try {
      let newId = id;
      if (id) { await api("/api/teachers/" + id, { method: "PUT", body }); toast("Teacher updated"); }
      else { const r = await api("/api/teachers", { method: "POST", body }); newId = r.id; toast("Teacher added"); }
      if (pendingPic && newId) { await uploadPic("teacher", newId, pendingPic); pendingPic = null; }
      closeModal(); openView("teachers");
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   CLASSES
   ============================================================ */
async function view_classes(el) {
  const classes = await api("/api/classes");
  el.innerHTML = `
  <div class="toolbar">
    <p style="color:var(--muted)">${classes.length} streams for ${esc(state.settings.academic_year || "2026")}</p>
    <div class="grow"></div>
    ${adminBtn(`<button class="btn btn-outline" onclick="classForm()"><svg><use href="#i-plus"/></svg> Add Class</button>`)}
  </div>
  <div class="grid-3">
    ${classes.map(c => `
      <div class="card" style="cursor:pointer" onclick="classStudents(${c.id},'${esc(c.name)}')">
        <div class="card-head"><h3>${esc(c.name)}</h3><span class="badge b-blue">${esc(c.grade)}</span></div>
        <p style="font-size:12.5px;color:var(--muted);margin-bottom:12px">
          Class teacher: <b style="color:var(--ink)">${c.ct_first ? esc(c.ct_first + " " + c.ct_last) : "—"}</b></p>
        <div class="kgrid" style="grid-template-columns:1fr 1fr">
          <div class="kpi"><div class="k">Students</div><div class="v">${c.cnt} <small style="font-size:11px;color:var(--muted)">/ ${c.capacity}</small></div></div>
          <div class="kpi"><div class="k">Stream</div><div class="v" style="font-size:15px">${esc(c.stream || "—")}</div></div>
        </div>
        <div class="progress" style="margin-top:12px"><div style="width:${Math.min(100, c.cnt / c.capacity * 100)}%"></div></div>
        <p style="font-size:11.5px;color:var(--muted);margin-top:6px">${Math.round(c.cnt / c.capacity * 100)}% capacity</p>
        ${adminBtn(`<div class="no-print" style="display:flex;gap:8px;margin-top:12px;border-top:1px solid #f1f5f9;padding-top:12px" onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="classForm(${c.id})"><svg><use href="#i-edit"/></svg> Edit</button>
          <button class="btn btn-outline btn-sm" style="color:var(--red)" onclick="deleteClass(${c.id},'${esc(c.name)}')"><svg><use href="#i-close"/></svg> Remove</button>
        </div>`)}
      </div>`).join("")}
  </div>`;
}
async function classStudents(cid, name) {
  const rows = await api(`/api/classes/${cid}/students`);
  modal(`
  <div class="modal-head"><h3>${esc(name)} — Students (${rows.length})</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>Student</th><th>Adm No</th><th>Gender</th><th>Status</th></tr></thead>
      <tbody>${rows.map(s => `<tr>
        <td>${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}<b style="margin-left:8px">${esc(s.first_name + " " + (s.middle_name ? s.middle_name + " " : "") + s.last_name)}</b></td>
        <td><span class="badge b-slate">${esc(s.admission_no)}</span></td>
        <td>${esc(s.gender || "—")}</td>
        <td><span class="badge ${s.status === "Active" ? "b-green" : "b-slate"}">${esc(s.status)}</span></td>
      </tr>`).join("")}</tbody>
    </table></div>
  </div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Close</button>
    <button class="btn btn-primary" onclick="closeModal();openView('students',{class_id:${cid}})">View all students</button>
  </div>`);
}
async function classForm(id) {
  const teachers = await api("/api/teachers");
  const all = id ? await api("/api/classes") : null;
  let c = { grade: "Grade 1", stream: "", capacity: 45, class_teacher_id: "" };
  if (id) c = all.find(x => x.id === id) || c;
  const grades = Array.from({ length: 12 }, (_, i) => "Grade " + (i + 1));
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Class" : "Add Class"}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Class Name *</label><input id="f-name" value="${esc(c.name || "")}" placeholder="Grade 1 East"></div>
    <div><label>Grade * (1 – 12)</label>
      <input id="f-grade" list="grade-list" value="${esc(c.grade || "Grade 1")}">
      <datalist id="grade-list">${grades.map(g => `<option value="${g}">`).join("")}</datalist>
    </div>
    <div><label>Stream</label><input id="f-stream" value="${esc(c.stream || "")}" placeholder="East / West / Blue"></div>
    <div><label>Capacity</label><input id="f-cap" type="number" value="${c.capacity || 45}"></div>
    <div class="full"><label>Class Teacher</label><select id="f-ct"><option value="">— none —</option>
      ${teachers.map(t => `<option value="${t.id}" ${String(c.class_teacher_id) === String(t.id) ? "selected" : ""}>${esc(t.first_name + " " + t.last_name)}</option>`).join("")}
    </select></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="c-save">${id ? "Save Changes" : "Add Class"}</button></div>`);
  $("#c-save").addEventListener("click", async () => {
    const body = {
      name: $("#f-name").value.trim(), grade: $("#f-grade").value.trim() || "Grade 1",
      stream: $("#f-stream").value.trim(), capacity: $("#f-cap").value, class_teacher_id: $("#f-ct").value };
    if (!body.name) { toast("Class name required", "err"); return; }
    try {
      if (id) { await api("/api/classes/" + id, { method: "PUT", body }); toast("Class updated"); }
      else { await api("/api/classes", { method: "POST", body }); toast("Class added"); }
      closeModal(); openView("classes");
    } catch (err) { toast(err.message, "err"); }
  });
}
async function deleteClass(cid, name) {
  modal(`
  <div class="modal-head"><h3>Remove class</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <p style="font-size:13.5px">Remove <b>${esc(name)}</b>? This will also delete its <b>timetable, fee structures, enrollments and attendance records</b>. Students in the class become unplaced.</p>
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" id="del-save">Remove Class</button>
  </div>`);
  $("#del-save").addEventListener("click", async () => {
    try {
      const r = await api("/api/classes/" + cid, { method: "DELETE" });
      toast("Class removed: " + r.removed);
      closeModal(); openView("classes");
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   SUBJECTS
   ============================================================ */
async function view_subjects(el) {
  const subjects = await api("/api/subjects");
  el.innerHTML = `
  <div class="tab-row">
    <button class="tab-btn active" id="sub-tab-list">Subjects</button>
    <button class="tab-btn" id="sub-tab-cur">Curriculum guide (CBC)</button>
  </div>
  <div id="sub-body"></div>`;
  const renderList = () => {
    $("#sub-body").innerHTML = `
    <div class="toolbar">
      <p style="color:var(--muted)">${subjects.length} subjects across the CBC curriculum</p><div class="grow"></div>
      ${adminBtn(`<button class="btn btn-outline" onclick="subjectForm()"><svg><use href="#i-plus"/></svg> Add Subject</button>`)}
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Code</th><th>Subject</th><th>Category</th><th>Taught in</th><th>Subject Teacher</th>${adminBtn('<th class="num">Actions</th>')}</tr></thead>
      <tbody>${subjects.map(s => `
        <tr><td><span class="badge b-violet">${esc(s.code)}</span></td>
          <td><b>${esc(s.name)}</b></td>
          <td><span class="badge ${catBadge(s.category)}">${esc(s.category || "—")}</span></td>
          <td><span class="badge ${bandOf(s.grades).cls}">${esc(bandOf(s.grades).label)}</span></td>
          <td>${s.t_first ? esc(s.t_first + " " + s.t_last) : "—"}</td>
          ${adminBtn(`<td><div class="actions"><button class="ic-btn" onclick="subjectForm(${s.id})"><svg><use href="#i-edit"/></svg></button></div></td>`)}
        </tr>`).join("")}
      </tbody></table></div>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">The subject list follows the <b>Kenyan Competency-Based Curriculum (CBC)</b>. Each subject is taught only in the grades shown.</p>`;
  };
  const renderCur = async () => {
    $("#sub-body").innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading curriculum…</p></div>';
    const bands = await api("/api/curriculum");
    $("#sub-body").innerHTML = `
      <p style="font-size:13px;color:var(--slate);margin-bottom:14px">
        The current <b>Kenyan Competency-Based Curriculum (CBC)</b> structures learning into four bands.
        Every grade uses the <b>CBC achievement levels</b> (E = Exceeding, M = Meeting, A = Approaching, B = Below).</p>
      <div class="grid-2">
      ${bands.map(b => `
        <div class="card">
          <div class="card-head"><h3>${esc(b.label)}</h3><span class="badge b-blue">${esc(b.grades)}</span></div>
          <p style="font-size:12px;color:var(--muted);margin-bottom:10px">Grading: <b>${esc(b.scale)}</b></p>
          <div style="display:flex;flex-wrap:wrap;gap:7px">
            ${b.subjects.map(s => `<span class="badge ${catBadge(s.category)}">${esc(s.name)}</span>`).join("")}
          </div>
        </div>`).join("")}
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>How grades work (${esc(state.settings.current_term || "Term")})</h3></div>
        ${scaleLegendHtml()}
      </div>`;
  };
  $("#sub-tab-list").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#sub-tab-list").classList.add("active"); renderList(); });
  $("#sub-tab-cur").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#sub-tab-cur").classList.add("active"); renderCur(); });
  renderList();
}
async function subjectForm(id) {
  const teachers = await api("/api/teachers");
  const all = await api("/api/subjects");
  let s = { category: "Core", teacher_id: "" };
  if (id) s = all.find(x => x.id === id) || s;
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Subject" : "Add Subject"}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Subject Name *</label><input id="f-name" value="${esc(s.name || "")}" placeholder="Mathematics"></div>
    <div><label>Code *</label><input id="f-code" value="${esc(s.code || "")}" placeholder="MAT" maxlength="4"></div>
    <div><label>Category</label><select id="f-cat">
      ${["Core","Languages","Sciences","Humanities","Technical","Creative"].map(c => `<option ${s.category === c ? "selected" : ""}>${c}</option>`).join("")}
    </select></div>
    <div><label>Subject Teacher</label><select id="f-teacher"><option value="">— none —</option>
      ${teachers.map(t => `<option value="${t.id}" ${String(s.teacher_id) === String(t.id) ? "selected" : ""}>${esc(t.first_name + " " + t.last_name)}</option>`).join("")}
    </select></div>
    <div class="full"><label>Taught in grades (CBC)</label><input id="f-grades" value="${esc(s.grades || "1,2,3,4,5,6,7,8,9,10,11,12")}" placeholder="e.g. 7,8,9"></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="s-save">Save Subject</button></div>`);
  $("#s-save").addEventListener("click", async () => {
    const body = { name: $("#f-name").value.trim(), code: $("#f-code").value.trim(),
      category: $("#f-cat").value, teacher_id: $("#f-teacher").value,
      grades: $("#f-grades").value.trim() };
    if (!body.name || !body.code) { toast("Name and code required", "err"); return; }
    try {
      if (id) { await api("/api/subjects/" + id, { method: "PUT", body }); toast("Subject updated"); }
      else { await api("/api/subjects", { method: "POST", body }); toast("Subject added"); }
      closeModal(); openView("subjects");
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   EXAMS & MARKS ENTRY
   ============================================================ */
async function view_exams(el) {
  const exams = await api("/api/exams");
  el.innerHTML = `
  <div class="toolbar">
    <p style="color:var(--muted)">${exams.length} examinations</p><div class="grow"></div>
    ${adminBtn(`<button class="btn btn-outline" onclick="examForm()"><svg><use href="#i-plus"/></svg> Create Exam</button>`)}
  </div>
  <div class="grid-3">
    ${exams.map(ex => `
      <div class="card">
        <div class="card-head"><h3>${esc(ex.name)}</h3>
          <span class="badge ${ex.status === "Open" ? "b-green" : "b-slate"}">${esc(ex.status)}</span></div>
        <p style="color:var(--muted);font-size:12.5px;margin-bottom:10px">${esc(ex.term)} · ${esc(ex.academic_year)}</p>
        <div class="kpi" style="margin-bottom:14px"><div class="k">Students assessed</div>
          <div class="v">${ex.students}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${acadBtn(`<button class="btn btn-primary btn-sm" onclick="openView('examDetail',{examId:${ex.id}})"><svg><use href="#i-edit"/></svg> Enter Marks</button>`)}
          <button class="btn btn-outline btn-sm" onclick="openView('analytics',{examId:${ex.id}})"><svg><use href="#i-chart"/></svg> Results</button>
          ${adminBtn(ex.status === "Open" ? `<button class="btn btn-outline btn-sm" onclick="setExamStatus(${ex.id},'Closed')">Close</button>`
            : `<button class="btn btn-outline btn-sm" onclick="setExamStatus(${ex.id},'Open')">Reopen</button>`)}
        </div>
      </div>`).join("")}
  </div>`;
}
async function setExamStatus(id, status) {
  await api("/api/exams/" + id, { method: "PUT", body: { status } });
  toast("Exam " + status.toLowerCase()); openView("exams");
}
async function examForm() {
  modal(`
  <div class="modal-head"><h3>Create Exam</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full"><label>Exam Name *</label><input id="f-name" placeholder="End of Term 1 Exam 2026"></div>
    <div><label>Term</label><select id="f-term">
      ${["Term 1","Term 2","Term 3"].map(t => `<option ${t === (state.settings.current_term || "Term 3") ? "selected" : ""}>${t}</option>`).join("")}
    </select></div>
    <div><label>Status</label><select id="f-status"><option>Open</option><option>Closed</option></select></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="e-save">Create Exam</button></div>`);
  $("#e-save").addEventListener("click", async () => {
    const body = { name: $("#f-name").value.trim(), term: $("#f-term").value, status: $("#f-status").value };
    if (!body.name) { toast("Exam name required", "err"); return; }
    try { await api("/api/exams", { method: "POST", body }); toast("Exam created"); closeModal(); openView("exams"); }
    catch (err) { toast(err.message, "err"); }
  });
}

async function view_examDetail(el, params) {
  const { examId, classId } = params;
  const d = await api("/api/exams/" + examId);
  const exams = await api("/api/exams");
  el.innerHTML = `
  <div class="toolbar">
    <select class="input" id="md-exam">
      ${exams.map(e => `<option value="${e.id}" ${e.id === examId ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
    </select>
    <select class="input" id="md-class">
      <option value="">— select class —</option>
      ${d.classes.map(c => `<option value="${c.id}" ${classId && String(c.id) === String(classId) ? "selected" : ""}>${esc(c.name)} (${c.cnt} assessed)</option>`).join("")}
    </select>
    <span class="badge b-blue">${esc(d.exam.term)} · ${esc(d.exam.academic_year)}</span>
    <div class="grow"></div>
    ${acadBtn(`<button class="btn btn-primary" id="md-save"><svg><use href="#i-download"/></svg> Save Marks (<span id="md-dirty">0</span>)</button>`)}
  </div>
  <div id="md-body"><div class="loader"><div class="spinner"></div><p>Select a class to enter marks</p></div></div>`;
  $("#md-exam").addEventListener("change", e => openView("examDetail", { examId: Number(e.target.value) }));
  $("#md-class").addEventListener("change", e => {
    if (e.target.value) openView("examDetail", { examId, classId: Number(e.target.value) });
  });
  if (!classId) return;
  const m = await api(`/api/exams/${examId}/marks?class_id=${classId}`);
  const clsObj = d.classes.find(c => String(c.id) === String(classId));
  const scale = scaleForGrade(clsObj ? clsObj.name : "Grade 7");
  $("#md-body").innerHTML = `
    <div class="card" style="padding:0;overflow:auto">
      <table class="tbl marks-table" style="min-width:${420 + m.subjects.length * 92}px">
        <thead><tr><th style="position:sticky;left:0;background:#f8fafc;z-index:3">Student</th>
          ${m.subjects.map(s => `<th class="sticky-sub">${esc(s.name)}<br><small style="color:var(--muted);font-weight:500">${esc(s.code)}</small></th>`).join("")}
          <th class="num" style="background:#f8fafc">Mean</th><th style="background:#f8fafc">Grade</th></tr></thead>
        <tbody>
          ${m.students.map(st => {
            let total = 0, cnt = 0;
            const cells = m.subjects.map(su => {
              const v = st.scores[su.id];
              if (v !== null && v !== undefined && v !== "") { total += Number(v); cnt++; }
              return `<td><input data-st="${st.id}" data-sub="${su.id}" type="number" min="0" max="100" step="0.5"
                value="${v === null || v === undefined ? "" : v}" placeholder="—" data-orig="${v === null || v === undefined ? "" : v}"></td>`;
            }).join("");
            return `<tr data-row="${st.id}">
              <td style="position:sticky;left:0;background:#fff;z-index:2"><b>${esc(st.name)}</b><br><small style="color:var(--muted)">${esc(st.admission_no)}</small></td>
              ${cells}
              <td class="num marks-total" id="mean-${st.id}">${cnt ? fmtNum(total / cnt) : "—"}</td>
              <td><span class="grade-pill gNone" id="gp-${st.id}">—</span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">This class uses the <b>Kenyan CBC achievement levels</b> — E = Exceeding (80%+), M = Meeting (65%+), A = Approaching (50%+), B = Below (under 50%). Scores auto-grade; click <b>Save Marks</b> to persist changes.</p>`;
  const dirty = new Set();
  $$(".marks-table input").forEach(inp => {
    inp.addEventListener("input", () => {
      const st = inp.dataset.st, sub = inp.dataset.sub;
      if (String(inp.value) !== inp.dataset.orig) { dirty.add(st + ":" + sub); inp.classList.add("dirty"); }
      else { dirty.delete(st + ":" + sub); inp.classList.remove("dirty"); }
      if ($("#md-dirty")) $("#md-dirty").textContent = dirty.size;
      recomputeRow(st);
    });
  });
  function recomputeRow(st) {
    let total = 0, cnt = 0;
    $$(`.marks-table input[data-st="${st}"]`).forEach(i => {
      const v = parseFloat(i.value);
      if (!isNaN(v)) { total += v; cnt++; }
    });
    $("#mean-" + st).textContent = cnt ? fmtNum(total / cnt) : "—";
    const avg = cnt ? total / cnt : null;
    const g = avg === null ? "" : (avg >= 80 ? "E" : avg >= 65 ? "M" : avg >= 50 ? "A" : "B");
    const pill = $("#gp-" + st);
    if (g) { pill.textContent = g; pill.className = "grade-pill " + gradeClass(g); }
    else { pill.textContent = "—"; pill.className = "grade-pill gNone"; }
  }
  const saveBtn = $("#md-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const scores = [];
    dirty.forEach(key => {
      const [st, sub] = key.split(":");
      const inp = $(`.marks-table input[data-st="${st}"][data-sub="${sub}"]`);
      const v = inp.value.trim();
      scores.push({ student_id: Number(st), subject_id: Number(sub), score: v === "" ? null : Number(v) });
    });
    if (!scores.length) { toast("No changes to save"); return; }
    try {
      await api(`/api/exams/${examId}/marks`, { method: "POST", body: { scores } });
      toast("Saved " + scores.length + " mark" + (scores.length > 1 ? "s" : ""));
      dirty.clear(); if ($("#md-dirty")) $("#md-dirty").textContent = "0";
      $$(".marks-table input").forEach(i => i.classList.remove("dirty"));
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   ANALYTICS
   ============================================================ */
async function view_analytics(el, params) {
  const d = await api(params.examId ? `/api/analytics?exam_id=${params.examId}` : "/api/analytics");
  if (!d.data) { el.innerHTML = '<div class="empty">No exam results available yet</div>'; return; }
  const x = d.data;
  el.innerHTML = `
  <div class="toolbar">
    <select class="input" id="an-exam" style="min-width:260px">
      ${d.exams.map(e => `<option value="${e.id}" ${e.id === d.selected_exam.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
    </select>
    <span class="badge b-blue">${esc(d.selected_exam.term)} · ${esc(d.selected_exam.academic_year)}</span>
    <div class="grow"></div>
    <button class="btn btn-outline" onclick="exportCSV('results-${esc(d.selected_exam.id)}.csv',
      ['Rank','Adm No','Student','Class','Mean','Mean Grade','Class Pos'],
      ${JSON.stringify(x.ranked.map((r, i) => [i + 1, r.admission_no, r.name, r.class_name, r.mean, r.mean_grade, r.class_pos + "/" + r.class_size])).replace(/"/g, '&quot;')})">CSV</button>
  </div>

  <div class="stat-grid">
    ${statCard("green", "i-chart", x.overall_mean, "Overall Mean", d.selected_exam.name)}
    ${statCard("amber", "i-users", x.top10[0] ? x.top10[0].name.split(" ")[0] + " " + (x.top10[0].name.split(" ")[1] || "") : "—", "Top Student", x.top10[0] ? x.top10[0].mean_grade + " · " + fmtNum(x.top10[0].mean) : "—")}
    ${statCard("violet", "i-class", x.class_means[0] ? x.class_means[0].name : "—", "Best Class", x.class_means[0] ? "mean " + fmtNum(x.class_means[0].mean) : "—")}
    ${statCard("blue", "i-exam", x.ranked.length, "Students Assessed", x.ranked.length + " graded")}
  </div>

  <div class="grid-2">
    <div class="card"><div class="card-head"><h3>Grade distribution</h3><p>Mean grade spread</p></div>
      <div id="an-grade"></div><div id="an-grade-legend"></div></div>
    <div class="card"><div class="card-head"><h3>Gender performance</h3><p>Average mean score</p></div><div id="an-gender"></div></div>
  </div>

  <div class="grid-2" style="margin-top:18px">
    <div class="card"><div class="card-head"><h3>Subject means</h3><p>with highest &amp; lowest scores</p></div>
      <div class="scroll-y"><div id="an-subjects"></div></div></div>
    <div class="card"><div class="card-head"><h3>Class comparison</h3><p>Average mean per class</p></div><div id="an-classes"></div></div>
  </div>

  <div class="card" style="margin-top:18px"><div class="card-head"><h3>Performance trend</h3><p>Overall mean across exams</p></div>
    <div id="an-trend"></div></div>

  <div class="section-title">Top 10 Students</div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>#</th><th>Adm No</th><th>Student</th><th>Class</th><th class="num">Mean</th><th>Mean Grade</th><th class="num">Class Pos</th></tr></thead>
    <tbody>
      ${x.top10.map((r, i) => `
        <tr><td><span class="rank-${i + 1}">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</span></td>
          <td><span class="badge b-slate">${esc(r.admission_no)}</span></td>
          <td class="pill-link" onclick="studentDetail(${r.student_id})">${esc(r.name)}</td><td>${esc(r.class_name)}</td>
          <td class="num"><b>${fmtNum(r.mean)}</b></td>
          <td><span class="grade-pill ${gradeClass(r.mean_grade)}">${esc(r.mean_grade)}</span></td>
          <td class="num">${r.class_pos}/${r.class_size}</td></tr>`).join("")}
    </tbody></table></div>

  <div class="section-title">Full Results</div>
  <div class="toolbar">
    <div class="search-wrap"><svg><use href="#i-search"/></svg><input class="input" id="an-q" placeholder="Search student…"></div>
  </div>
  <div class="table-wrap scroll-y" style="max-height:460px"><table class="tbl">
    <thead><tr><th>#</th><th>Adm No</th><th>Student</th><th>Class</th><th class="num">Mean</th><th>Mean Grade</th><th class="num">Class Pos</th><th class="num">Points</th></tr></thead>
    <tbody id="an-body">${rankedRows(x.ranked)}</tbody></table></div>`;

  $("#an-grade-legend").innerHTML = scaleLegendHtml();
  vbarChart($("#an-grade"), x.grade_dist.filter(g => g.count > 0).map(g => ({
    label: g.grade, value: g.count,
    color: g.grade === "E" ? "#16a34a" : g.grade === "M" ? "#0ea5e9" : g.grade === "A" ? "#f59e0b" : g.grade === "B" ? "#ef4444"
      : g.grade[0] === "A" ? "#16a34a" : g.grade[0] === "B" ? "#4ade80" : g.grade[0] === "C" ? "#f59e0b" : g.grade[0] === "D" ? "#f97316" : "#ef4444" })), { height: 180, valueFmt: n => n });
  donut($("#an-gender"), x.gender_perf.map(g => ({
    label: g.gender, value: g.mean, color: g.gender === "Male" ? "#2563eb" : "#ec4899" })));
  $("#an-subjects").innerHTML = x.subject_means.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 2px;border-bottom:1px solid #f1f5f9">
      <div><b style="font-size:13px">${esc(s.name)}</b><br><small style="color:var(--muted)">${esc(s.teacher || "no teacher")}</small></div>
      <div style="text-align:right"><span class="badge b-green">${fmtNum(s.mean)}</span>
      <small style="color:var(--muted);display:block">high ${fmtNum(s.highest)} · low ${fmtNum(s.lowest)}</small></div></div>`).join("");
  hbarChart($("#an-classes"), x.class_means.map(c => ({ label: c.name, value: c.mean, color: "#2563eb" })), { max: 100 });
  lineChart($("#an-trend"), x.trend.map(t => ({ label: t.term, value: t.mean })));
  $("#an-exam").addEventListener("change", e => openView("analytics", { examId: Number(e.target.value) }));
  $("#an-q").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    $("#an-body").innerHTML = rankedRows(x.ranked.filter(r =>
      (r.name + " " + r.admission_no).toLowerCase().includes(q)));
  });
  if (params.studentId) studentDetail(params.studentId);
}
function rankedRows(rows) {
  return rows.map((r, i) => `
    <tr><td>${i + 1}</td>
      <td><span class="badge b-slate">${esc(r.admission_no)}</span></td>
      <td class="pill-link" onclick="studentDetail(${r.student_id})">${esc(r.name)}</td>
      <td>${esc(r.class_name)}</td>
      <td class="num"><b>${fmtNum(r.mean)}</b></td>
      <td><span class="grade-pill ${gradeClass(r.mean_grade)}" title="${esc((CBC_LEVELS[r.mean_grade] || {}).name || "")}">${esc(r.mean_grade)}</span></td>
      <td class="num">${r.class_pos}/${r.class_size}</td>
      <td class="num">${r.total_points}</td></tr>`).join("");
}

/* ============================================================
   REPORT CARDS
   ============================================================ */
async function view_reportcard(el, params) {
  const students = await api("/api/students");
  const exams = await api("/api/exams");
  const sid = params.studentId || "";
  const eid = params.examId || "";
  el.innerHTML = `
  <div class="toolbar no-print">
    <select class="input" id="rc-student" style="min-width:240px"><option value="">— select student —</option>
      ${students.map(s => `<option value="${s.id}" ${String(s.id) === String(sid) ? "selected" : ""}>${esc(s.first_name + " " + (s.middle_name ? s.middle_name + " " : "") + s.last_name)} (${esc(s.admission_no)})</option>`).join("")}
    </select>
    <select class="input" id="rc-exam" style="min-width:220px"><option value="">— select exam —</option>
      ${exams.map(e => `<option value="${e.id}" ${String(e.id) === String(eid) ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
    </select>
    <div class="grow"></div>
    <button class="btn btn-primary" id="rc-print"><svg><use href="#i-print"/></svg> Print Report Card</button>
  </div>
  <div class="print-area" id="rc-area">
    <div class="empty no-print">Select a student and an exam to generate the report card.</div>
  </div>`;
  async function load() {
    if (!sid || !eid) return;
    const d = await api(`/api/analytics/student/${sid}?exam_id=${eid}`);
    const s = d.student, agg = d.agg, ex = d.selected_exam;
    if (!agg) { $("#rc-area").innerHTML = '<div class="empty">No results for this student in the selected exam.</div>'; return; }
    const scale = "cbc";
    const meanGrade = meanGradeFromPts(agg.avg_pts);
    const set = state.settings || {};
    const comments = await api(`/api/exams/${eid}/comments`);
    const savedComment = comments[sid] || "";
    const conduct = await api("/api/discipline/student/" + sid).catch(() => null);
    $("#rc-area").innerHTML = `
    <div class="report-sheet" id="report-sheet">
      <div class="r-head">
        <div style="flex:1;text-align:center">
          ${set.school_logo ? `<img src="${esc(set.school_logo)}" style="height:52px;margin-bottom:4px" alt="">` : ""}
          <h1>${esc(set.school_name || "SCHOOL")}</h1>
          <p class="motto">${esc(set.school_motto || "")}</p>
          <p style="font-size:11.5px;color:var(--slate)">${esc(set.school_address || "")} · ${esc(set.school_phone || "")}</p>
        </div>
      </div>
      <div style="text-align:center;border:1px solid var(--ink);border-radius:6px;padding:6px;margin-bottom:14px;font-weight:800;letter-spacing:2px">
        REPORT CARD — ${esc(ex.name).toUpperCase()}
      </div>
      <div class="r-meta">
        <div><b>Name:</b> ${esc(s.first_name + " " + (s.middle_name ? s.middle_name + " " : "") + s.last_name)}</div>
        <div><b>Admission No:</b> ${esc(s.admission_no)}</div>
        <div><b>Class:</b> ${s.class ? esc(s.class.name) : "—"}</div>
        <div><b>Gender:</b> ${esc(s.gender || "—")}</div>
        <div><b>Term:</b> ${esc(ex.term)}</div>
        <div><b>Academic Year:</b> ${esc(ex.academic_year)}</div>
      </div>
      <table class="r-table">
        <thead><tr><th>#</th><th>Subject</th><th class="num">Score (%)</th><th style="text-align:center">Grade</th><th class="num">Points</th><th class="num">Class Mean</th></tr></thead>
        <tbody>
          ${d.per_subject.map((p, i) => `
            <tr><td>${i + 1}</td><td><b>${esc(p.name)}</b></td>
            <td class="num">${fmtNum(p.score)}</td>
            <td style="text-align:center"><span class="grade-pill ${gradeClass(p.grade)}" title="${esc((CBC_LEVELS[p.grade] || {}).name || "")}">${esc(p.grade)}</span></td>
            <td class="num">${p.points}</td>
            <td class="num">${fmtNum(p.subject_mean)}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="r-summary">
        <div class="box"><b>${fmtNum(agg.mean)}</b><span>Mean Score</span></div>
        <div class="box"><b>${meanGrade}</b><span>Achievement Level</span></div>
        <div class="box"><b>${agg.total_points}</b><span>Level Points</span></div>
        <div class="box"><b>${d.class_rank || "—"} / ${d.class_size || "—"}</b><span>Class Position</span></div>
      </div>
      ${conduct ? `
      <div style="border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <b style="font-size:12.5px">Conduct this term:</b>
        <span class="badge ${CONDUCT_STYLES[conduct.rating] || "b-slate"}">${esc(conduct.rating)}</span>
        <small style="color:var(--slate)">${conduct.merits} merits · ${conduct.demerits} demerits</small>
      </div>` : ""}
      <p style="font-size:10.5px;color:var(--slate);text-align:center;margin-top:4px">${CBC_LABEL}</p>
      <p style="font-size:12.5px"><b>Teacher's comment:</b></p>
      <div class="r-comment">${esc(savedComment || "A good performance. Keep working hard. — " + (set.school_name || "School"))}</div>
      <div class="r-sign">
        <div><div class="line">Class Teacher</div></div>
        <div><div class="line">Head of Academics</div></div>
        <div><div class="line">Principal</div></div>
      </div>
    </div>
    <div class="card no-print" style="margin-top:16px">
      <div class="card-head"><h3>Teacher's comment (saved per exam)</h3><p>Shown on the printed card</p></div>
      <textarea id="rc-comment" class="input" rows="3" style="width:100%" placeholder="Write a comment for this student's report card…">${esc(savedComment)}</textarea>
      <button class="btn btn-primary btn-sm" id="rc-save-comment" style="margin-top:10px"><svg><use href="#i-download"/></svg> Save comment</button>
    </div>`;
    $("#rc-save-comment").addEventListener("click", async () => {
      const c = $("#rc-comment").value.trim();
      if (!c) { toast("Write a comment first", "err"); return; }
      await api(`/api/exams/${eid}/comments`, { method: "POST", body: { comments: { [sid]: c } } });
      toast("Comment saved for this report card");
    });
  }
  $("#rc-student").addEventListener("change", e => openView("reportcard", { studentId: e.target.value, examId: $("#rc-exam").value }));
  $("#rc-exam").addEventListener("change", e => openView("reportcard", { studentId: $("#rc-student").value, examId: e.target.value }));
  $("#rc-print").addEventListener("click", () => window.print());
  if (sid && eid) await load();
}

/* ============================================================
   FINANCE
   ============================================================ */
async function view_finance(el) {
  const d = await api("/api/finance?term=" + state.financeTerm);
  const rate = d.billed ? Math.round(d.paid / d.billed * 100) : 0;
  el.innerHTML = `
  <div class="toolbar">
    <select class="input" id="fin-term">
      ${d.terms.map(t => `<option ${t === d.term ? "selected" : ""}>${t}</option>`).join("")}
    </select>
    <span class="badge b-blue">${esc(d.year)}</span>
    <div class="grow"></div>
    ${adminBtn(`<button class="btn btn-outline" onclick="paymentTypesModal()"><svg><use href="#i-receipt"/></svg> Payment Types</button>`)}
    ${acctBtn(`<button class="btn btn-outline" onclick="feeStructureForm()"><svg><use href="#i-gear"/></svg> Fee Structures</button>
    <button class="btn btn-primary" id="fin-remind"><svg><use href="#i-sms"/></svg> SMS Fee Reminders</button>`)}
  </div>

  <div class="stat-grid">
    ${statCard("blue", "i-money", fmtMoney(d.billed), "Billed (" + d.term + ")", d.year)}
    ${statCard("green", "i-money", fmtMoney(d.paid), "Collected", rate + "% of billed")}
    ${statCard("red", "i-money", fmtMoney(d.arrears), "Arrears", d.students.length + " students")}
    ${statCard("amber", "i-money", rate + "%", "Collection Rate", d.term + " " + d.year)}
  </div>

  <div class="card" style="margin-bottom:18px">
    <div class="card-head"><h3>Collections by class</h3><p>${esc(d.term)} ${esc(d.year)} — includes transport fees</p></div>
    <div id="fin-classes"></div>
  </div>

  <div class="grid-2" style="margin-bottom:18px">
    <div class="card">
      <div class="card-head"><h3>Collections by payment type</h3><p>${esc(d.term)} ${esc(d.year)}</p></div>
      <div id="fin-types"><div class="empty">No payments this term</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Payment type usage</h3><p>Number of payments per type</p></div>
      <div id="fin-type-usage"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h3>Student fee ledger</h3>
      <div class="search-wrap"><svg><use href="#i-search"/></svg><input class="input" id="fin-q" placeholder="Search student…"></div>
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Student</th><th>Class</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th><th style="min-width:150px">Payment progress</th><th>Status</th><th>Payments</th>${acctBtn('<th class="num">Actions</th>')}</tr></thead>
      <tbody id="fin-body">${finRows(d.students)}</tbody>
    </table></div>
  </div>

  <div class="card" style="margin-top:18px">
    <div class="card-head"><h3>Recent payments</h3><p>Latest transactions</p></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Receipt</th><th>Student</th><th>Applied to</th><th class="num">Amount</th><th>Method</th><th>Date</th><th>Ref</th><th>By</th><th class="num">Actions</th></tr></thead>
      <tbody>${groupReceipts(d.recent).map(g => `
        <tr>
          <td><span class="badge b-slate">${esc(g.receipt_no)}</span>${g.parts > 1 ? ' <span class="badge b-blue">split ×' + g.parts + '</span>' : ""}</td>
          <td><b>${esc(g.student_name)}</b></td>
          <td><small>${esc(g.summary)}</small></td>
          <td class="num"><b style="color:var(--green-dark)">${fmtMoney(g.amount)}</b></td>
          <td><span class="badge ${g.method === "M-PESA" ? "b-green" : g.method === "Cash" ? "b-amber" : "b-blue"}">${esc(g.method || "—")}</span></td>
          <td>${fmtDate(g.date)}</td><td><small>${esc(g.reference || "—")}</small></td>
          <td><small>${esc(g.recorded_by || "—")}</small></td>
          <td><div class="actions">
            ${acctBtn(`<button class="ic-btn" title="Edit payment" onclick="paymentForm(${g.student_id}, ${g.id})"><svg><use href="#i-edit"/></svg></button>`)}
            <button class="ic-btn" title="View &amp; print receipt" onclick="showReceipt(${g.id})"><svg><use href="#i-receipt"/></svg></button>
          </div></td>
        </tr>`).join("") || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">No payments yet</td></tr>'}
      </tbody></table></div>
  </div>`;

  $("#fin-classes").innerHTML = d.class_rows.map(c => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">
      <div style="width:130px;flex:none;font-size:12.5px;color:#475569;font-weight:600;text-align:right">${esc(c.name)}</div>
      <div class="progress ${c.rate >= 80 ? "" : c.rate >= 50 ? "amber" : "red"}" style="flex:1">
        <div style="width:${Math.min(100, c.rate)}%"></div></div>
      <div style="width:210px;flex:none;text-align:right;font-size:12px">
        <b>${fmtMoney(c.paid)}</b> / ${fmtMoney(c.billed)} <small style="color:var(--muted)">(${c.rate}%)</small></div>
    </div>`).join("");

  if (d.type_breakdown && d.type_breakdown.length) {
    donut($("#fin-types"), d.type_breakdown.map((t, i) => ({ label: t.name, value: t.amount, color: TYPE_COLORS[i % TYPE_COLORS.length] })));
    hbarChart($("#fin-type-usage"), d.type_breakdown.map((t, i) => ({ label: t.name, value: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length] })));
  }

  $("#fin-term").addEventListener("change", e => { state.financeTerm = e.target.value; openView("finance"); });
  $("#fin-q").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    $("#fin-body").innerHTML = finRows(d.students.filter(s =>
      (s.first_name + " " + s.last_name + " " + (s.admission_no || "")).toLowerCase().includes(q)));
  });
  const remindBtn = $("#fin-remind");
  if (remindBtn) remindBtn.addEventListener("click", async () => {
    const r = await api("/api/finance/reminders", { method: "POST" });
    toast("Fee reminders queued for " + r.sent + " parents");
    openView("finance");
  });
}
function groupReceipts(payments) {
  // group payment rows by receipt number; returns one entry per receipt with total + summary
  const map = {};
  (payments || []).forEach(p => {
    if (!map[p.receipt_no]) map[p.receipt_no] = { receipt_no: p.receipt_no, id: p.id, student_id: p.student_id,
      student_name: p.first_name + " " + p.last_name, amount: 0, parts: 0, method: p.method,
      date: p.payment_date, reference: p.reference, recorded_by: p.recorded_by, types: new Set() };
    const g = map[p.receipt_no];
    g.amount += p.amount; g.parts += 1;
    g.types.add(p.payment_type_name || "General");
    g.id = Math.min(g.id, p.id);
  });
  return Object.values(map).map(g => ({
    ...g,
    summary: g.parts > 1
      ? [...g.types].join(" + ") + " · " + g.parts + " parts"
      : [...g.types][0] || "General",
  })).sort((a, b) => (b.date + "").localeCompare(a.date + ""));
}

function finRows(students) {
  return students.map(s => {
    const bal = s.balance || 0;
    const pct = (s.billed || 0) > 0 ? Math.round(s.paid / s.billed * 100) : 0;
    const status = bal <= 0 ? '<span class="badge b-green">Cleared</span>'
      : pct >= 60 ? '<span class="badge b-amber">Partial</span>'
      : '<span class="badge b-red">Critical</span>';
    return `<tr>
      <td>${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}<b style="margin-left:8px">${esc(s.first_name + " " + s.last_name)}</b></td>
      <td>${esc(s.class_name || "—")}</td>
      <td class="num">${fmtMoney(s.billed)}</td>
      <td class="num" style="color:var(--green-dark)">${fmtMoney(s.paid)}</td>
      <td class="num"><b style="color:${bal > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(bal)}</b></td>
      <td style="min-width:150px">
        <div class="progress ${pct >= 100 ? "" : pct >= 60 ? "amber" : "red"}" style="margin-bottom:4px"><div style="width:${Math.min(100, pct)}%"></div></div>
        <small style="color:var(--muted)">${pct}% paid</small>
      </td>
      <td>${status}</td>
      <td>${s.payments}</td>
      ${acctBtn(`<td><div class="actions">
        <button class="ic-btn" title="Record payment" onclick="paymentForm(${s.id})"><svg><use href="#i-money"/></svg></button>
        <button class="ic-btn" title="Statement" onclick="statement(${s.id})"><svg><use href="#i-eye"/></svg></button>
      </div></td>`)}
    </tr>`;
  }).join("");
}
async function paymentTypesModal() {
  const pts = await api("/api/payment-types");
  modal(`
  <div class="modal-head"><h3>Payment Types</h3><p style="font-size:12px;color:var(--muted)">Categories for every payment</p>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <div class="form-grid" style="grid-template-columns:2fr 1fr 1fr auto;align-items:end">
      <div><label>New payment type</label><input id="pt-name" class="input" placeholder="e.g. Swimming Pool"></div>
      <div><label>Category</label><select id="pt-cat" class="input">
        <option>Fees</option><option>Transport</option><option>Other</option></select></div>
      <div><label>Default amount</label><input id="pt-amt" class="input" type="number" step="100" placeholder="optional"></div>
      <button class="btn btn-primary" id="pt-add"><svg><use href="#i-plus"/></svg> Add</button>
    </div>
    <div class="section-title">Existing payment types</div>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>Name</th><th>Category</th><th class="num">Default</th><th class="num">Payments</th><th>Status</th><th class="num">Actions</th></tr></thead>
      <tbody>${pts.map(t => `<tr>
        <td><b>${esc(t.name)}</b></td>
        <td><span class="badge ${typeBadge(t.category)}">${esc(t.category)}</span></td>
        <td class="num">${t.default_amount ? fmtMoney(t.default_amount) : "—"}</td>
        <td class="num">${t.payments}</td>
        <td><button class="switch ${t.active ? "on" : ""}" data-id="${t.id}" data-active="${t.active}" title="Activate / deactivate"></button></td>
        <td><div class="actions"><button class="ic-btn" title="Edit" onclick="editPaymentType(${t.id})"><svg><use href="#i-edit"/></svg></button></div></td>
      </tr>`).join("")}
      </tbody></table></div>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">Deactivated types are hidden from new payments but stay on historical receipts.</p>
  </div>`);
  $("#pt-add").addEventListener("click", async () => {
    const name = $("#pt-name").value.trim();
    if (!name) { toast("Enter a name", "err"); return; }
    try {
      await api("/api/payment-types", { method: "POST", body: {
        name, category: $("#pt-cat").value,
        default_amount: $("#pt-amt").value ? Number($("#pt-amt").value) : null } });
      toast("Payment type added"); paymentTypesModal();
    } catch (err) { toast(err.message, "err"); }
  });
  $$(".switch").forEach(b => b.addEventListener("click", async () => {
    await api("/api/payment-types/" + b.dataset.id, { method: "PUT", body: { active: b.dataset.active === "1" ? 0 : 1 } });
    paymentTypesModal();
  }));
}
async function editPaymentType(id) {
  const pts = await api("/api/payment-types");
  const t = pts.find(x => x.id === id);
  modal(`
  <div class="modal-head"><h3>Edit payment type</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Name</label><input id="et-name" class="input" value="${esc(t.name)}"></div>
    <div><label>Category</label><select id="et-cat" class="input">
      ${["Fees", "Transport", "Other"].map(c => `<option ${t.category === c ? "selected" : ""}>${c}</option>`).join("")}
    </select></div>
    <div><label>Default amount</label><input id="et-amt" class="input" type="number" step="100" value="${t.default_amount || ""}"></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="et-save">Save</button></div>`);
  $("#et-save").addEventListener("click", async () => {
    try {
      await api("/api/payment-types/" + id, { method: "PUT", body: {
        name: $("#et-name").value.trim(), category: $("#et-cat").value,
        default_amount: $("#et-amt").value ? Number($("#et-amt").value) : null } });
      toast("Payment type updated"); closeModal(); paymentTypesModal();
    } catch (err) { toast(err.message, "err"); }
  });
}

async function paymentForm(studentId, paymentId) {
  const students = await api("/api/students");
  const pts = await api("/api/payment-types");
  const activeTypes = pts.filter(t => t.active);
  let st = students.find(x => x.id === studentId);
  let p = null;
  let isSplit = false;
  if (paymentId) {
    const r = await api("/api/finance/receipt/" + paymentId);
    st = r.student; p = r.payment; isSplit = !!r.parts && r.parts.length > 1;
  }
  const typeOptions = activeTypes.map(t =>
    `<option value="${t.id}" ${p && p.payment_type_id === t.id ? "selected" : ""}>${esc(t.name)}${t.default_amount ? " — " + fmtMoney(t.default_amount) : ""}</option>`).join("");
  modal(`
  <div class="modal-head"><h3>${paymentId ? "Edit Payment — " + esc(p.receipt_no) : "Record Payment"}</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <div class="kpi" style="margin-bottom:16px"><div class="k">Student</div>
      <div class="v" style="font-size:16px">${esc(st.first_name + " " + st.last_name)} <small style="color:var(--muted)">${esc(st.admission_no)} · ${esc(st.class_name || "")}</small></div></div>
    <div class="form-grid">
      <div class="full">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="p-split" style="accent-color:var(--green);width:16px;height:16px" ${paymentId ? (isSplit ? "checked disabled" : "disabled") : "checked"}>
          <span><b>Split automatically across terms &amp; items</b><br>
          <small style="font-weight:400;color:var(--muted)">One payment is applied to the oldest outstanding fees first — transport, then tuition — with a receipt showing the breakdown.</small></span>
        </label>
      </div>
      <div id="p-type-wrap"><label>Payment type</label><select id="p-type" class="input" ${paymentId ? "disabled" : ""}>
        <option value="">— general / unclassified —</option>${typeOptions}</select></div>
      <div><label>Amount (${esc(state.settings.currency || "KSh")}) *</label><input id="p-amount" type="number" min="1" step="100" value="${p ? p.amount : ""}" placeholder="e.g. 10000"></div>
      <div><label>Payment Method</label><select id="p-method">
        ${["M-PESA", "Cash", "Bank Transfer", "Cheque"].map(m => `<option ${p && p.method === m ? "selected" : ""}>${m}</option>`).join("")}
      </select></div>
      <div><label>Payment Date</label><input id="p-date" type="date" value="${p ? p.payment_date : new Date().toISOString().slice(0, 10)}"></div>
      <div><label>Reference / M-PESA Code</label><input id="p-ref" value="${esc((p && p.reference) || "")}" placeholder="SGKXXXXXXXX"></div>
      <div><label>Applies to term</label><select id="p-term">${["Term 1", "Term 2", "Term 3"].map(t => `<option ${(p ? p.term : state.financeTerm) === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div><label>Notes</label><input id="p-notes" value="${esc((p && p.notes) || "")}" placeholder="Term 3 fees"></div>
    </div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="p-save">${paymentId ? "Save Changes" : "Record Payment"}</button>
  </div>`);
  // toggle: when splitting, the payment type is chosen automatically
  const splitChk = $("#p-split");
  const typeWrap = $("#p-type-wrap");
  function syncSplitUI() {
    typeWrap.style.opacity = splitChk.checked ? ".45" : "1";
    const t = $("#p-type");
    if (t) t.disabled = splitChk.checked;
  }
  if (splitChk && !paymentId) splitChk.addEventListener("change", syncSplitUI);
  syncSplitUI();
  $("#p-type").addEventListener("change", () => {
    const t = activeTypes.find(x => x.id == $("#p-type").value);
    if (t && t.default_amount) $("#p-amount").value = t.default_amount;
  });
  $("#p-save").addEventListener("click", async () => {
    const autoSplit = $("#p-split").checked;
    const body = { student_id: st.id, payment_type_id: autoSplit ? null : ($("#p-type").value || null),
      amount: $("#p-amount").value, method: $("#p-method").value, payment_date: $("#p-date").value,
      reference: $("#p-ref").value.trim(), notes: $("#p-notes").value.trim(),
      term: $("#p-term").value, auto_split: autoSplit };
    if (!body.amount || Number(body.amount) <= 0) { toast("Enter a valid amount", "err"); return; }
    try {
      if (paymentId) {
        await api("/api/finance/payments/" + paymentId, { method: "PUT", body });
        toast("Payment updated");
        closeModal(); openView("finance");
      } else {
        const r = await api("/api/finance/payments", { method: "POST", body });
        toast(r.split ? "Payment recorded & split across " + r.parts + " item" + (r.parts > 1 ? "s" : "") + " — Receipt " + r.receipt_no : "Payment recorded — Receipt " + r.receipt_no);
        closeModal();
        openView("finance");
        showReceipt(r.id);
      }
    } catch (err) { toast(err.message, "err"); }
  });
}
async function statement(studentId) {
  const d = await api("/api/finance/statement/" + studentId);
  const st = d.student;
  modal(`
  <div class="modal-head"><h3>Fee Statement — ${esc(st.first_name + " " + st.last_name)}</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="k">Total billed</div><div class="v">${fmtMoney(d.total_billed)}</div></div>
      <div class="kpi"><div class="k">Total paid</div><div class="v" style="color:var(--green-dark)">${fmtMoney(d.total_paid)}</div></div>
      <div class="kpi"><div class="k">Balance</div><div class="v" style="color:${d.balance > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(d.balance)}</div></div>
    </div>
    <div class="section-title">Balance tracker</div>
    ${(() => {
      const terms = ["Term 1", "Term 2", "Term 3"];
      const rows = terms.map(t => {
        const billed = d.billing.filter(b => b.term === t).reduce((a, b) => a + b.amount, 0);
        const paid = d.payments.filter(p => p.term === t).reduce((a, p) => a + p.amount, 0);
        const pct = billed ? Math.round(paid / billed * 100) : 0;
        return { t, billed, paid, bal: billed - paid, pct };
      }).filter(r => r.billed > 0);
      return `<table class="tbl" style="min-width:0;margin-bottom:6px">
        <thead><tr><th>Term</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th><th style="min-width:120px">Progress</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><b>${esc(r.t)}</b></td>
          <td class="num">${fmtMoney(r.billed)}</td>
          <td class="num" style="color:var(--green-dark)">${fmtMoney(r.paid)}</td>
          <td class="num"><b style="color:${r.bal > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(Math.max(0, r.bal))}</b></td>
          <td><div class="progress ${r.pct >= 100 ? "" : r.pct >= 60 ? "amber" : "red"}"><div style="width:${Math.min(100, r.pct)}%"></div></div>
              <small style="color:var(--muted)">${r.pct}% paid</small></td>
        </tr>`).join("") || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No billing set</td></tr>'}
        </tbody></table>`;
    })()}
    <div class="section-title">Billing (${esc(d.class ? d.class.name : "")})</div>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>Term</th><th>Item</th><th>Year</th><th class="num">Amount</th></tr></thead>
      <tbody>${d.billing.map(b => `<tr><td>${esc(b.term)}</td><td>${esc(b.label || "Fees")}</td><td>${esc(b.academic_year)}</td><td class="num">${fmtMoney(b.amount)}</td></tr>`).join("")}
      </tbody></table></div>
    <div class="section-title">Payments</div>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>Date</th><th class="num">Amount</th><th>Type</th><th>Method</th><th>Ref</th><th>Receipt</th></tr></thead>
      <tbody>${d.payments.map(p => `<tr><td>${fmtDate(p.payment_date)}</td>
        <td class="num"><b style="color:var(--green-dark)">${fmtMoney(p.amount)}</b></td>
        <td><span class="badge ${typeBadge(p.payment_type_category)}">${esc(p.payment_type_name || "General")}</span></td>
        <td>${esc(p.method || "—")}</td><td><small>${esc(p.reference || "—")}</small></td>
        <td><small>${esc(p.receipt_no || "—")}</small></td></tr>`).join("") || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No payments yet</td></tr>'}
      </tbody></table></div>
  </div>
  <div class="modal-foot">
    ${acctBtn(`<button class="btn btn-primary" onclick="closeModal();paymentForm(${studentId})"><svg><use href="#i-money"/></svg> Record Payment</button>`)}
    <button class="btn btn-outline" onclick="closeModal()">Close</button>
  </div>`);
}
async function feeStructureForm() {
  const classes = await api("/api/classes");
  modal(`
  <div class="modal-head"><h3>Fee Structures (${esc(state.settings.academic_year || "2026")})</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <p style="font-size:12.5px;color:var(--muted);margin-bottom:12px">Tuition per student per term. Transport fees are set per route in the Transport module and are added automatically to billed amounts.</p>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>Class</th><th class="num">Term 1</th><th class="num">Term 2</th><th class="num">Term 3</th></tr></thead>
      <tbody>
        ${classes.map(c => `
          <tr><td><b>${esc(c.name)}</b></td>
            ${["Term 1", "Term 2", "Term 3"].map(t => `<td class="num"><input type="number" step="100" min="0"
              class="input fee-in" style="width:110px;text-align:right" data-class="${c.id}" data-term="${t}"
              placeholder="0"></td>`).join("")}
          </tr>`).join("")}
      </tbody></table></div>
  </div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="fs-save">Save Structures</button></div>`);
  const amounts = {};
  for (const c of classes) {
    const st = (await api("/api/classes/" + c.id + "/students"))[0];
    if (!st) continue;
    const d2 = await api("/api/finance/statement/" + st.id);
    d2.billing.filter(b => b.label === "Tuition").forEach(b => { amounts[c.id + "|" + b.term] = b.amount; });
  }
  $$(".fee-in").forEach(inp => {
    const v = amounts[inp.dataset.class + "|" + inp.dataset.term];
    if (v !== undefined) inp.value = v;
  });
  $("#fs-save").addEventListener("click", async () => {
    let n = 0;
    for (const inp of $$(".fee-in")) {
      if (inp.value === "") continue;
      await api("/api/finance/structure", { method: "POST", body: {
        class_id: Number(inp.dataset.class), term: inp.dataset.term, amount: Number(inp.value) } });
      n++;
    }
    toast("Saved " + n + " fee structures"); closeModal(); openView("finance");
  });
}

/* ============================================================
   TRANSPORT
   ============================================================ */
async function view_transport(el, params) {
  const sum = await api("/api/transport/summary");
  const tabBtns = [
    '<button class="tab-btn active" id="tp-tab-routes">Routes</button>',
    can("admin") ? '<button class="tab-btn" id="tp-tab-assign">Assignments</button>' : "",
    can("admin", "teacher") ? '<button class="tab-btn" id="tp-tab-register">Daily Register</button>' : "",
  ].join("");
  el.innerHTML = `
  <div class="stat-grid">
    ${statCard("green", "i-bus", sum.total_assigned, "Students on Transport", sum.routes.length + " active routes")}
    ${statCard("blue", "i-bus", sum.routes.length, "Bus Routes", sum.boarded_today + " boarded today")}
    ${statCard("amber", "i-money", fmtMoney(sum.monthly_fees), "Monthly Transport Fees", "added to student billing")}
    ${statCard("violet", "i-calendar", sum.routes.reduce((a, r) => a + r.boarded, 0), "Today's Boardings", "morning + evening")}
  </div>
  <div class="tab-row">${tabBtns}</div>
  <div id="tp-body"></div>`;
  const tabs = { routes: viewRoutes, assign: viewAssignments, register: viewRegister };
  const setTab = (name, routeId) => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    const btn = $("#tp-tab-" + name);
    if (btn) btn.classList.add("active");
    if (name === "assign") viewAssignments(routeId);
    else if (name === "register") viewRegister(routeId);
    else viewRoutes();
  };
  const rBtn = $("#tp-tab-routes"); if (rBtn) rBtn.addEventListener("click", () => setTab("routes"));
  const aBtn = $("#tp-tab-assign"); if (aBtn) aBtn.addEventListener("click", () => setTab("assign"));
  const gBtn = $("#tp-tab-register"); if (gBtn) gBtn.addEventListener("click", () => setTab("register"));
  const startTab = params.tab === "assign" && can("admin") ? "assign" : params.tab === "register" && can("admin", "teacher") ? "register" : "routes";
  setTab(startTab, params.routeId);
}
async function viewRoutes() {
  const routes = await api("/api/transport/routes");
  $("#tp-body").innerHTML = `
  <div class="toolbar">
    <p style="color:var(--muted)">${routes.length} routes · ${routes.reduce((a, r) => a + r.assigned, 0)} riders assigned</p>
    <div class="grow"></div>
    ${adminBtn(`<button class="btn btn-outline" onclick="routeForm()"><svg><use href="#i-plus"/></svg> Add Route</button>`)}
  </div>
  <div class="grid-3">
    ${routes.map(r => `
      <div class="route-card">
        <div class="card-head" style="margin-bottom:6px"><h4><span class="route-badge"><svg style="width:16px;height:16px"><use href="#i-bus"/></svg></span> ${esc(r.name)}</h4>
          <span class="badge ${r.status === "Active" ? "b-green" : "b-slate"}">${esc(r.status)}</span></div>
        <div class="rsub">${esc(r.route_no || "")} · Driver: ${esc(r.driver_name || "—")} · ${esc(r.driver_phone || "")}</div>
        <div class="rrow"><span>Morning pickup</span><b>${esc(r.morning_time || "—")}</b></div>
        <div class="rrow"><span>Evening drop-off</span><b>${esc(r.evening_time || "—")}</b></div>
        <div class="rrow"><span>Fee (per term)</span><b style="color:var(--green-dark)">${fmtMoney(r.fee)}</b></div>
        <div class="rrow"><span>Capacity</span><b>${r.assigned} / ${r.capacity}</b></div>
        <div class="progress" style="margin-top:8px"><div style="width:${Math.min(100, r.assigned / r.capacity * 100)}%"></div></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          ${adminBtn(`<button class="btn btn-outline btn-sm" onclick="routeForm(${r.id})"><svg><use href="#i-edit"/></svg> Edit</button>`)}
          <button class="btn btn-outline btn-sm" onclick="openView('transport',{tab:'assign',routeId:${r.id}})">Assign riders</button>
        </div>
      </div>`).join("") || '<div class="empty">No routes yet</div>'}
  </div>`;
}
async function routeForm(id) {
  const all = await api("/api/transport/routes");
  let r = { capacity: 40, morning_time: "6:30 AM", evening_time: "4:30 PM", fee: 0, status: "Active" };
  if (id) r = all.find(x => x.id === id) || r;
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Route" : "Add Route"}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Route Name *</label><input id="f-name" value="${esc(r.name || "")}" placeholder="Route A — Kisii Town"></div>
    <div><label>Route No</label><input id="f-no" value="${esc(r.route_no || "")}" placeholder="RT-01"></div>
    <div><label>Driver Name</label><input id="f-driver" value="${esc(r.driver_name || "")}"></div>
    <div><label>Driver Phone</label><input id="f-dphone" value="${esc(r.driver_phone || "")}"></div>
    <div><label>Capacity</label><input id="f-cap" type="number" value="${r.capacity}"></div>
    <div><label>Fee per term (${esc(state.settings.currency || "KSh")})</label><input id="f-fee" type="number" step="100" value="${r.fee}"></div>
    <div><label>Morning pickup time</label><input id="f-morning" value="${esc(r.morning_time || "6:30 AM")}"></div>
    <div><label>Evening drop-off time</label><input id="f-evening" value="${esc(r.evening_time || "4:30 PM")}"></div>
    <div><label>Status</label><select id="f-status"><option ${r.status === "Active" ? "selected" : ""}>Active</option><option ${r.status === "Inactive" ? "selected" : ""}>Inactive</option></select></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="r-save">Save Route</button></div>`);
  $("#r-save").addEventListener("click", async () => {
    const body = { name: $("#f-name").value.trim(), route_no: $("#f-no").value.trim(),
      driver_name: $("#f-driver").value.trim(), driver_phone: $("#f-dphone").value.trim(),
      capacity: $("#f-cap").value, fee: $("#f-fee").value,
      morning_time: $("#f-morning").value.trim(), evening_time: $("#f-evening").value.trim(),
      status: $("#f-status").value };
    if (!body.name) { toast("Route name required", "err"); return; }
    try {
      if (id) { await api("/api/transport/routes/" + id, { method: "PUT", body }); toast("Route updated"); }
      else { await api("/api/transport/routes", { method: "POST", body }); toast("Route added"); }
      closeModal(); openView("transport");
    } catch (err) { toast(err.message, "err"); }
  });
}
async function viewAssignments(presetRouteId) {
  const routes = await api("/api/transport/routes");
  const active = routes.find(r => r.status === "Active");
  const prev = $("#tp-route") ? $("#tp-route").value : "";
  const sel = presetRouteId || prev || (active ? active.id : "");
  $("#tp-body").innerHTML = `
  <div class="toolbar">
    <select class="input" id="tp-route" style="min-width:230px">
      ${routes.map(r => `<option value="${r.id}" ${String(r.id) === String(sel) ? "selected" : ""}>${esc(r.name)} (${r.assigned} riders)</option>`).join("")}
    </select>
    <div class="search-wrap"><svg><use href="#i-search"/></svg>
      <input class="input" id="tp-search" placeholder="Search student name or admission no…" style="min-width:220px" autocomplete="off"></div>
    <span class="badge b-blue" id="tp-count">0 riders</span>
    <div class="grow"></div>
    ${adminBtn(`<button class="btn btn-primary" id="tp-save"><svg><use href="#i-download"/></svg> Save Assignments</button>`)}
  </div>
  <div id="tp-assign-body"><div class="loader"><div class="spinner"></div><p>Loading students…</p></div></div>`;
  $("#tp-route").addEventListener("change", e => viewAssignments(e.target.value));
  await loadAssignBody();
  async function loadAssignBody() {
    const rid = $("#tp-route").value;
    const rows = await api("/api/transport/assignments?route_id=" + rid);
    // keep the checked state in a Set so search re-renders never lose selections
    const checked = new Set(rows.filter(r => r.assigned).map(r => r.student_id));

    function renderList(q) {
      const ql = (q || "").trim().toLowerCase();
      const filtered = ql ? rows.filter(r =>
        (r.name + " " + r.admission_no + " " + (r.class_name || "")).toLowerCase().includes(ql)) : rows;
      const byClass = {};
      filtered.forEach(r => { (byClass[r.class_name] = byClass[r.class_name] || []).push(r); });
      $("#tp-assign-body").innerHTML = `
        <p style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Tick students who ride this route. Students belong to exactly one route at a time.${ql ? ` Showing <b>${filtered.length}</b> match${filtered.length === 1 ? "" : "es"}.` : ""}</p>
        ${Object.keys(byClass).sort().map(cls => `
          <div class="section-title">${esc(cls)}</div>
          <div class="grid-3" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
            ${byClass[cls].map(r => `
              <label class="stu-check-row ${checked.has(r.student_id) ? "on" : ""}">
                <input type="checkbox" class="assign-check" data-st="${r.student_id}" ${checked.has(r.student_id) ? "checked" : ""}>
                <div><b style="font-size:13px">${esc(r.name)}</b><br><small style="color:var(--muted)">${esc(r.admission_no)} · ${esc(r.class_name || "")}</small></div>
              </label>`).join("")}
          </div>`).join("")}
        ${filtered.length === 0 ? '<div class="empty">No students match your search</div>' : ""}`;
      updateCount();
      $$(".assign-check").forEach(c => c.addEventListener("change", () => {
        const sid = Number(c.dataset.st);
        if (c.checked) checked.add(sid); else checked.delete(sid);
        c.closest(".stu-check-row").classList.toggle("on", c.checked);
        updateCount();
      }));
    }
    function updateCount() {
      $("#tp-count").textContent = checked.size + " riders";
    }
    renderList("");
    const search = $("#tp-search");
    if (search) search.addEventListener("input", e => renderList(e.target.value));
  }
  const saveBtn = $("#tp-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const rid = $("#tp-route").value;
    const student_ids = $$(".assign-check:checked").map(c => Number(c.dataset.st));
    try {
      await api("/api/transport/assign", { method: "POST", body: { route_id: Number(rid), student_ids } });
      toast("Assignments saved — " + student_ids.length + " riders on this route");
      openView("transport");
    } catch (err) { toast(err.message, "err"); }
  });
}
async function viewRegister(presetRouteId) {
  const routes = await api("/api/transport/routes");
  const today = new Date().toISOString().slice(0, 10);
  if (presetRouteId) { state.trRoute = presetRouteId; }
  $("#tp-body").innerHTML = `
  <div class="toolbar">
    <select class="input" id="tr-route" style="min-width:220px">
      <option value="">— select route —</option>
      ${routes.filter(r => r.status === "Active").map(r => `<option value="${r.id}" ${String(state.trRoute) === String(r.id) ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
    </select>
    <input type="date" class="input" id="tr-date" value="${today}">
    <select class="input" id="tr-period">
      <option>Morning</option><option>Evening</option>
    </select>
    <div class="grow"></div>
    ${acadBtn(`<button class="btn btn-primary" id="tr-save"><svg><use href="#i-download"/></svg> Save Register</button>`)}
  </div>
  <div id="tr-body"><div class="empty">Select a route to mark boardings</div></div>`;
  async function load() {
    const rid = $("#tr-route").value, date = $("#tr-date").value, period = $("#tr-period").value;
    if (!rid) { $("#tr-body").innerHTML = '<div class="empty">Select a route to mark boardings</div>'; return; }
    const d = await api(`/api/transport/register?route_id=${rid}&date=${date}&period=${period}`);
    $("#tr-body").innerHTML = d.rows.length ? `
      <div class="reg-grid">
        ${d.rows.map(r => `
          <div class="reg-card">
            <div><span class="nm">${esc(r.first_name + " " + r.last_name)}</span>
              <span class="adm">${esc(r.admission_no)}</span></div>
            <div class="opts">
              ${["Boarded", "Not Boarded", "Excused"].map(s => `
                <button class="opt ${r.status === s ? "on-" + (s === "Boarded" ? "boarded" : s === "Not Boarded" ? "not" : "excused") : ""}"
                  data-st="${r.id}" data-status="${s}" style="opacity:${r.status === s ? "1" : ".45"}">${s === "Not Boarded" ? "Not" : s}</button>`).join("")}
            </div>
          </div>`).join("")}
      </div>` : '<div class="empty">No riders assigned to this route</div>';
    $$(".reg-card .opt").forEach(b => b.addEventListener("click", () => {
      const card = b.closest(".reg-card");
      $$(".opt", card).forEach(x => { x.style.opacity = ".45"; x.className = "opt"; });
      b.style.opacity = "1"; b.className = "opt on-" + (b.dataset.status === "Boarded" ? "boarded" : b.dataset.status === "Not Boarded" ? "not" : "excused");
    }));
  }
  $("#tr-route").addEventListener("change", load);
  $("#tr-date").addEventListener("change", load);
  $("#tr-period").addEventListener("change", load);
  const saveBtn = $("#tr-save");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const rid = $("#tr-route").value;
    if (!rid) { toast("Select a route first", "err"); return; }
    const records = $$(".reg-card").map(card => {
      const chosen = $$(".opt", card).find(b => b.style.opacity === "1") || $$(".opt", card)[0];
      return { student_id: Number(chosen.dataset.st), status: chosen.dataset.status };
    });
    await api("/api/transport/register", { method: "POST", body: {
      route_id: Number(rid), date: $("#tr-date").value, period: $("#tr-period").value, records } });
    toast("Register saved for " + records.length + " students");
  });
}

/* ============================================================
   TIMETABLE
   ============================================================ */
const catBadge = (c) => ({ Core: "b-green", Languages: "b-blue", Sciences: "b-violet",
  Humanities: "b-amber", Technical: "b-slate", Creative: "b-red" }[c] || "b-slate");
const bandOf = (grades) => {
  const gs = String(grades || "").split(",").map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
  if (gs.some(g => g >= 10)) return { label: "Senior (G10–12)", cls: "b-violet" };
  if (gs.some(g => g >= 7)) return { label: "Junior Sec (G7–9)", cls: "b-blue" };
  if (gs.some(g => g >= 4)) return { label: "Upper Primary (G4–6)", cls: "b-green" };
  if (gs.some(g => g >= 1)) return { label: "Lower Primary (G1–3)", cls: "b-amber" };
  return { label: "All grades", cls: "b-slate" };
};

async function view_timetable(el, params) {
  const classes = await api("/api/classes");
  const teachers = await api("/api/teachers");
  const selClass = params.classId || (classes[0] && classes[0].id) || "";
  const selTeacher = params.teacherId || "";
  el.innerHTML = `
  <div class="tab-row no-print">
    <button class="tab-btn active" id="tt-tab-class">Class timetable</button>
    <button class="tab-btn" id="tt-tab-teacher">Teacher timetable</button>
  </div>
  <div id="tt-body"></div>`;
  const loadClass = () => classTimetable(classes, selClass);
  const loadTeacher = () => teacherTimetable(teachers, selTeacher);
  $("#tt-tab-class").addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    $("#tt-tab-class").classList.add("active");
    loadClass();
  });
  $("#tt-tab-teacher").addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    $("#tt-tab-teacher").classList.add("active");
    loadTeacher();
  });
  loadClass();
}

function ttGridHtml(d, { teacherMode = false, classId = null } = {}) {
  const conflicts = new Set((d.conflict_slots || []).map(c => c.day + "-" + c.period));
  let html = `<div class="card" style="padding:0;overflow:auto"><table class="tbl tt-table" style="min-width:780px">
    <thead><tr><th style="min-width:100px">Time</th>${d.days.map(dd => `<th>${dd}</th>`).join("")}</tr></thead>
    <tbody>`;
  d.periods.forEach(p => {
    if (p.n === 4) html += `<tr class="tt-break"><td colspan="6">☕ Short break · 10:00 – 10:20</td></tr>`;
    if (p.n === 7) html += `<tr class="tt-break"><td colspan="6">🍽 Lunch break · 12:20 – 13:20</td></tr>`;
    html += `<tr>
      <td class="tt-time">P${p.n}<br><small>${p.start}–${p.end}</small></td>`;
    d.days.forEach(day => {
      const cell = d.grid[day] && d.grid[day][p.n];
      const conf = conflicts.has(day + "-" + p.n);
      const click = teacherMode ? "" : `onclick="assignPeriod(${classId},'${day}',${p.n})"`;
      if (teacherMode) {
        html += `<td class="tt-cell ${conf ? "tt-conflict" : ""}">
          ${cell ? `<div class="tt-subj"><span class="badge b-blue">${esc(cell.subject_code || cell.subject_name)}</span>
            <small>${esc(cell.class_name || "")}</small></div>` : '<div class="tt-empty">·</div>'}
        </td>`;
      } else {
        html += `<td class="tt-cell ${conf ? "tt-conflict" : ""}" ${click}>
          ${cell ? `<div class="tt-subj"><span class="badge ${catBadge(cell.category)}">${esc(cell.subject_code || cell.subject_name)}</span>
            <small>${esc(cell.teacher_name || "—")}</small></div>` : '<div class="tt-empty">+</div>'}
        </td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table></div>`;
  return html;
}

async function classTimetable(classes, selClass) {
  const cid = selClass || (classes[0] && classes[0].id) || "";
  $("#tt-body").innerHTML = `
  <div class="toolbar no-print">
    <select class="input" id="tt-class" style="min-width:230px">
      ${classes.map(c => `<option value="${c.id}" ${String(c.id) === String(cid) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
    </select>
    <span class="badge b-blue">${esc(classes.find(c => c.id == cid)?.grade || "")}</span>
    <div class="grow"></div>
    <button class="btn btn-outline" onclick="window.print()"><svg><use href="#i-print"/></svg> Print</button>
  </div>
  <div id="tt-grid-wrap"><div class="loader"><div class="spinner"></div><p>Loading timetable…</p></div></div>
  <p class="no-print" style="font-size:12px;color:var(--muted);margin-top:10px">Click any cell to assign a subject. Red cells show a teacher double-booked at that slot.</p>`;
  $("#tt-class").addEventListener("change", e => openView("timetable", { classId: e.target.value }));
  if (!cid) { $("#tt-grid-wrap").innerHTML = '<div class="empty">No classes yet</div>'; return; }
  const d = await api("/api/timetable?class_id=" + cid);
  $("#tt-grid-wrap").innerHTML = ttGridHtml(d, { classId: cid });
}

async function teacherTimetable(teachers, selTeacher) {
  const tid = selTeacher || (teachers[0] && teachers[0].id) || "";
  $("#tt-body").innerHTML = `
  <div class="toolbar no-print">
    <select class="input" id="tt-teacher" style="min-width:260px">
      ${teachers.map(t => `<option value="${t.id}" ${String(t.id) === String(tid) ? "selected" : ""}>${esc(t.first_name + " " + t.last_name)} — ${esc(t.subject_name || "")}</option>`).join("")}
    </select>
    <span class="tt-load-badge" id="tt-load">—</span>
    <div class="grow"></div>
    <button class="btn btn-outline" onclick="window.print()"><svg><use href="#i-print"/></svg> Print</button>
  </div>
  <div id="tt-grid-wrap"><div class="loader"><div class="spinner"></div><p>Loading timetable…</p></div></div>`;
  $("#tt-teacher").addEventListener("change", e => openView("timetable", { teacherId: e.target.value }));
  if (!tid) { $("#tt-grid-wrap").innerHTML = '<div class="empty">No teachers yet</div>'; return; }
  const d = await api("/api/timetable/teacher?teacher_id=" + tid);
  const load = Object.values(d.grid).reduce((a, day) => a + Object.keys(day).length, 0);
  $("#tt-load").textContent = "Teaching load: " + load + " periods / week";
  $("#tt-grid-wrap").innerHTML = ttGridHtml(d, { teacherMode: true });
}

async function assignPeriod(classId, day, period) {
  const subjects = await api("/api/subjects");
  const cur = await api("/api/timetable?class_id=" + classId);
  const cell = cur.grid[day] && cur.grid[day][period];
  modal(`
  <div class="modal-head"><h3>${day} — Period ${period}</h3>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full"><label>Subject</label>
      <select id="tt-subj" class="input">
        <option value="">— empty period —</option>
        ${subjects.map(s => `<option value="${s.id}" ${cell && cell.subject_id === s.id ? "selected" : ""}>
          ${esc(s.name)}${s.t_first ? " — " + esc(s.t_first + " " + (s.t_last || "")) : ""}</option>`).join("")}
      </select>
    </div>
    <p class="full" style="font-size:12px;color:var(--muted)">The subject's teacher is assigned automatically. The save is rejected if the teacher is already booked elsewhere at this time.</p>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-danger" id="tt-clear" ${cell ? "" : "disabled"}>Clear period</button>
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="tt-save">Save</button>
  </div>`);
  $("#tt-save").addEventListener("click", async () => {
    const subj = $("#tt-subj").value;
    try {
      await api("/api/timetable/set", { method: "POST", body: { class_id: classId, day, period, subject_id: subj ? Number(subj) : null } });
      toast(subj ? "Period assigned" : "Period cleared");
      closeModal(); openView("timetable", { classId });
    } catch (err) { toast(err.message, "err"); }
  });
  $("#tt-clear").addEventListener("click", async () => {
    try {
      await api("/api/timetable/set", { method: "POST", body: { class_id: classId, day, period, subject_id: null } });
      toast("Period cleared");
      closeModal(); openView("timetable", { classId });
    } catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   RECEIPTS (professional, printable, school badge)
   ============================================================ */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function numToWords(n) {
  if (n === 0) return "Zero";
  const two = (x) => x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? "-" + ONES[x % 10] : "");
  const three = (x) => (x >= 100 ? ONES[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " and " : "") : "") + (x % 100 ? two(x % 100) : "");
  let words = "", i = 0;
  const scale = ["", " Thousand", " Million", " Billion"];
  while (n > 0) {
    const part = n % 1000;
    if (part) words = three(part) + scale[i] + (words ? " " + words : "");
    n = Math.floor(n / 1000); i++;
  }
  return words;
}
function amountInWords(amount) {
  const shillings = Math.floor(Number(amount) || 0);
  const cents = Math.round(((Number(amount) || 0) - shillings) * 100);
  let w = "Kenya Shillings " + numToWords(shillings);
  if (cents > 0) w += " and " + numToWords(cents) + " Cents";
  return w + " Only";
}
async function showReceipt(pid) {
  document.body.classList.add("receipt-mode");
  const d = await api("/api/finance/receipt/" + pid);
  const p = d.payment, st = d.student, s = d.settings, cl = d.class;
  const schName = s.school_name || "School";
  const monogram = schName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  modal(`
  <div class="modal-head no-print"><h3>Receipt ${esc(p.receipt_no)}</h3>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="printReceipt()"><svg><use href="#i-print"/></svg> Print receipt</button>
      <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button>
    </div></div>
  <div class="modal-body" style="background:#e5e7eb">
    <div class="receipt-sheet" id="receipt-sheet">
      <div class="r-head2">
        <div class="r-logo">
          ${s.school_logo ? `<img src="${esc(s.school_logo)}" alt="">` : `<div class="r-crest">${esc(monogram)}</div>`}
        </div>
        <div class="r-org">
          <h2>${esc(schName.toUpperCase())}</h2>
          <p class="motto">${esc(s.school_motto || "")}</p>
          <p class="r-contact">${esc(s.school_address || "")} · ${esc(s.school_phone || "")} · ${esc(s.school_email || "")}</p>
        </div>
        <div class="r-rect">
          <div class="k">RECEIPT NO</div><div class="v">${esc(p.receipt_no)}</div>
          <div class="k" style="margin-top:6px">DATE</div><div class="v" style="font-size:13px">${fmtDate(p.payment_date)}</div>
        </div>
      </div>
      <div class="r-title">OFFICIAL RECEIPT</div>
      <table class="receipt-table">
        <tr>
          <td class="lbl">Received from</td><td class="val"><b>${esc(st.parent_name || st.first_name + " " + st.last_name)}</b></td>
          <td class="lbl">Student</td><td class="val">${esc(st.first_name + " " + st.last_name)} (${esc(st.admission_no)})</td>
        </tr>
        <tr>
          <td class="lbl">Class</td><td class="val">${cl ? esc(cl.name) : "—"}</td>
          <td class="lbl">Term</td><td class="val">${esc(p.term || "—")} ${esc(s.academic_year || "")}</td>
        </tr>
        <tr>
          <td class="lbl">Payment method</td><td class="val">${esc(p.method || "—")}</td>
          <td class="lbl">Reference</td><td class="val">${esc(p.reference || "—")}</td>
        </tr>
        <tr>
          <td class="lbl">Payment type</td><td class="val">${esc((d.payment_type && d.payment_type.name) || "General")}</td>
          <td class="lbl">Recorded by</td><td class="val">${esc(p.recorded_by || "—")}</td>
        </tr>
        <tr>
          <td class="lbl">Amount paid</td><td class="val amt">${fmtMoney(p.amount)}</td>
          <td class="lbl">Term</td><td class="val">${esc(p.term || "—")} ${esc(d.settings.academic_year || "")}${p.split ? ' <span class="badge b-blue">Auto-split</span>' : ""}</td>
        </tr>
      </table>
      ${d.parts && d.parts.length > 1 ? `
      <div class="r-words" style="text-align:left;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px">
        <b style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--slate)">Payment breakdown</b>
        <table style="width:100%;margin-top:5px;border-collapse:collapse">
          ${d.parts.map(pt => `<tr style="border-bottom:1px dashed #e2e8f0">
            <td style="padding:3px 0;font-size:11.5px">${esc(pt.payment_type_name)} — ${esc(pt.term)}</td>
            <td style="text-align:right;font-weight:700;font-size:11.5px">${fmtMoney(pt.amount)}</td></tr>`).join("")}
          <tr><td style="padding-top:5px;font-weight:700;font-size:11.5px">Total paid</td>
            <td style="text-align:right;font-weight:800;font-size:12px;color:var(--green-dark);padding-top:5px">${fmtMoney(p.amount)}</td></tr>
        </table>
      </div>` : ""}
      <div class="r-words">Amount in words: <b>${esc(amountInWords(p.amount))}</b></div>
      <div class="r-balance">
        <div><span>Total paid to date</span><b>${fmtMoney(d.paid_to_date)}</b></div>
        <div><span>Outstanding balance</span><b style="color:${d.balance > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(Math.max(0, d.balance))}</b></div>
      </div>
      <div class="r-thanks">Thank you for your payment. ${esc(schName)} appreciates your continued support.</div>
      <div class="r-sign3">
        <div><div class="line2">Recorded by</div><small>${esc(p.recorded_by || "—")}</small></div>
        <div><div class="line2">Cashier</div></div>
        <div><div class="line2">Authorised Signature</div></div>
      </div>
      <div class="r-footnote">This is a computer-generated receipt and does not require a physical signature. Please keep it for your records.</div>
    </div>
  </div>`);
}


function printReceipt() {
  const sheet = document.getElementById("receipt-sheet");
  if (!sheet) { toast("Receipt not ready", "err"); return; }
  // Hide the entire app (sidebar, topbar, finance tables...) so ONLY the
  // receipt prints. The @media print CSS for body.receipt-mode does the rest.
  document.body.classList.add("receipt-mode");
  // give the CSS a moment to apply, then print the main window (reliable in
  // every browser — unlike printing from a hidden iframe, which is blocked)
  setTimeout(() => {
    try {
      window.focus();
      window.print();
    } catch (e) {
      try { window.print(); } catch (e2) {
        toast("Your browser blocked printing — press Ctrl+P instead", "err");
      }
    }
  }, 120);
}

/* ============================================================
   ATTENDANCE
   ============================================================ */
async function view_attendance(el, params) {
  const d = await api("/api/attendance");
  const today = new Date().toISOString().slice(0, 10);
  const cls = d.classes;
  const selCls = params.classId || d.class_id || (cls[0] && cls[0].id) || "";
  const selDate = params.date || d.date || today;
  el.innerHTML = `
  <div class="tab-row">
    <button class="tab-btn active" id="tab-mark">Mark Register</button>
    <button class="tab-btn" id="tab-sum">Summary</button>
  </div>
  <div id="att-content"></div>`;
  async function markView() {
    const m = await api(`/api/attendance?date=${selDate}&class_id=${selCls}`);
    $("#att-content").innerHTML = `
      <div class="toolbar">
        <input type="date" class="input" id="att-date" value="${m.date}">
        <select class="input" id="att-class">
          ${m.classes.map(c => `<option value="${c.id}" ${String(c.id) === String(selCls) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select>
        <div class="grow"></div>
        ${acadBtn(`<button class="btn btn-outline btn-sm" id="att-all-present">All Present</button>
        <button class="btn btn-outline btn-sm" onclick="window.print()"><svg><use href="#i-print"/></svg> Print</button>
        <button class="btn btn-primary" id="att-save"><svg><use href="#i-download"/></svg> Save Register</button>`)}
      </div>
      ${m.rows.length ? `<div class="att-grid">
        ${m.rows.map(r => `
          <div class="att-student">
            <div><span class="nm">${esc(r.first_name + " " + r.last_name)}</span>
              <span class="adm">${esc(r.admission_no)}</span></div>
            <div class="att-opts">
              ${["Present", "Absent", "Late", "Permission"].map(s => `
                <button class="att-opt ${r.status === s ? "on-" + s.toLowerCase() : ""}"
                  data-st="${r.id}" data-status="${s}" style="opacity:${r.status === s ? "1" : ".45"}">${s === "Permission" ? "Perm." : s}</button>`).join("")}
            </div>
          </div>`).join("")}
      </div>` : '<div class="empty">No students in this class</div>'}
      <p style="font-size:12px;color:var(--muted);margin-top:14px">Click a status to mark a student. Present (green), Absent (red), Late (amber), Permission (blue).</p>`;
    $$(".att-opt").forEach(b => b.addEventListener("click", () => {
      const card = b.closest(".att-student");
      $$(".att-opt", card).forEach(x => { x.style.opacity = ".45"; x.classList.remove("on-" + x.dataset.status.toLowerCase()); });
      b.style.opacity = "1"; b.classList.add("on-" + b.dataset.status.toLowerCase());
    }));
    $("#att-date").addEventListener("change", e => openView("attendance", { date: e.target.value, classId: selCls }));
    $("#att-class").addEventListener("change", e => openView("attendance", { date: $("#att-date").value, classId: e.target.value }));
    const allBtn = $("#att-all-present");
    if (allBtn) allBtn.addEventListener("click", () => $$(".att-opt[data-status='Present']").forEach(b => b.click()));
    const saveBtn = $("#att-save");
    if (saveBtn) saveBtn.addEventListener("click", async () => {
      const recs = $$(".att-student").map(card => {
        const chosen = $$(".att-opt", card).find(b => b.style.opacity === "1") || $$(".att-opt", card)[0];
        return { student_id: Number(chosen.dataset.st), status: chosen.dataset.status };
      });
      await api("/api/attendance", { method: "POST", body: { date: $("#att-date").value, class_id: $("#att-class").value, records: recs } });
      toast("Attendance saved for " + recs.length + " students");
    });
  }
  async function sumView() {
    const from = "2026-01-01";
    const s = await api(`/api/attendance/summary?class_id=${selCls}&from=${from}&to=${today}`);
    $("#att-content").innerHTML = `
      <div class="toolbar">
        <p style="color:var(--muted)">Daily attendance for ${esc(cls.find(c => c.id == selCls)?.name || "")} — year to date</p>
      </div>
      <div class="card"><div id="att-chart"></div></div>
      <div class="table-wrap" style="margin-top:16px"><table class="tbl">
        <thead><tr><th>Date</th><th class="num">Present</th><th class="num">Late</th><th class="num">Permission</th><th class="num">Absent</th><th style="min-width:150px">Rate</th></tr></thead>
        <tbody>${s.days.map(dy => {
          const tot = dy.Present + dy.Absent + dy.Late + dy.Permission;
          const rate = tot ? Math.round((dy.Present + dy.Late + dy.Permission) / tot * 100) : 0;
          return `<tr><td>${fmtDate(dy.date)}</td>
            <td class="num" style="color:var(--green-dark)">${dy.Present}</td>
            <td class="num" style="color:var(--amber)">${dy.Late}</td>
            <td class="num" style="color:var(--blue)">${dy.Permission}</td>
            <td class="num" style="color:var(--red)">${dy.Absent}</td>
            <td><div class="progress ${rate >= 85 ? "" : rate >= 70 ? "amber" : "red"}"><div style="width:${rate}%"></div></div></td></tr>`;
        }).join("") || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No attendance records</td></tr>'}
        </tbody></table></div>`;
    vbarChart($("#att-chart"), s.days.map(dy => ({ label: fmtDate(dy.date).slice(0, 6), value: dy.Present })) || [{ label: "—", value: 0 }], { height: 200, color: "#16a34a" });
  }
  $("#tab-mark").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#tab-mark").classList.add("active"); markView(); });
  $("#tab-sum").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#tab-sum").classList.add("active"); sumView(); });
  markView();
}

/* ============================================================
   COMMUNICATION
   ============================================================ */
async function view_communication(el) {
  const [ann, logs] = await Promise.all([api("/api/announcements"), api("/api/smslog")]);
  el.innerHTML = `
  <div class="grid-2-1">
    <div>
      <div class="card">
        <div class="card-head"><h3>Announcements</h3><p>Sent to parents &amp; staff</p></div>
        <div class="ann-list">
          ${ann.map(a => `
            <div class="ann-item">
              <h4>${esc(a.title)}</h4>
              <div class="meta"><span class="badge ${a.audience === "Parents" ? "b-blue" : "b-violet"}">${esc(a.audience)}</span>
                <span>${esc(a.created_by || "Admin")}</span><span>${fmtDate(a.created_at)}</span></div>
              <p>${esc(a.message)}</p>
            </div>`).join("") || '<div class="empty">No announcements</div>'}
        </div>
      </div>
    </div>
    <div>
      ${adminBtn(`
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>Post announcement</h3></div>
        <div class="form-grid" style="grid-template-columns:1fr">
          <div><label>Title</label><input id="an-title" class="input" placeholder="Fee Reminder"></div>
          <div><label>Audience</label><select id="an-aud" class="input">
            <option>All</option><option>Parents</option><option>Teachers</option></select></div>
          <div><label>Message</label><textarea id="an-msg" class="input" rows="4" placeholder="Message text…"></textarea></div>
          <button class="btn btn-primary" id="an-send"><svg><use href="#i-sms"/></svg> Publish &amp; SMS parents</button>
        </div>
      </div>`)}
      <div class="card">
        <div class="card-head"><h3>Message centre</h3><p>${logs.length} messages queued</p></div>
        <div class="scroll-y" style="max-height:420px">
          ${logs.map(l => `
            <div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <div style="display:flex;justify-content:space-between;gap:8px">
                <b style="font-size:12.5px">→ ${esc(l.to_phone || "—")}</b>
                <span class="badge ${l.category === "Fee Reminder" ? "b-amber" : "b-blue"}">${esc(l.category || "SMS")}</span>
              </div>
              <p style="font-size:12px;color:var(--muted);margin-top:3px">${esc((l.message || "").slice(0, 110))}${(l.message || "").length > 110 ? "…" : ""}</p>
              <small style="color:#cbd5e1;font-size:10.5px">${fmtDate(l.sent_at)} · ${esc(l.status)}</small>
            </div>`).join("") || '<div class="empty">No messages yet</div>'}
        </div>
      </div>
    </div>
  </div>`;
  const sendBtn = $("#an-send");
  if (sendBtn) sendBtn.addEventListener("click", async () => {
    const title = $("#an-title").value.trim(), msg = $("#an-msg").value.trim();
    if (!title || !msg) { toast("Title and message required", "err"); return; }
    await api("/api/announcements", { method: "POST", body: { title, message: msg, audience: $("#an-aud").value } });
    toast("Announcement published & SMS queued to parents");
    openView("communication");
  });
}

/* ============================================================
   LIBRARY — books, issues & returns
   ============================================================ */
const canLib = () => can("admin", "librarian");

async function view_library(el, params) {
  el.innerHTML = `<div class="loader"><div class="spinner"></div><p>Loading library…</p></div>`;
  const sum = await api("/api/library/summary");
  el.innerHTML = `
  <div class="stat-grid">
    ${statCard("blue", "i-book", sum.total_titles, "Book titles", sum.total_copies + " copies total")}
    ${statCard("green", "i-book", sum.available, "Available copies", "ready to borrow")}
    ${statCard("amber", "i-book", sum.issued, "Currently issued", "with students")}
    ${statCard("red", "i-book", sum.overdue, "Overdue", "need follow-up")}
  </div>
  <div class="tab-row">
    <button class="tab-btn active" id="lib-tab-books">Books</button>
    <button class="tab-btn" id="lib-tab-issues">Issues & returns</button>
  </div>
  <div id="lib-body"></div>`;
  const showBooks = () => renderBooks();
  const showIssues = () => renderIssues();
  $("#lib-tab-books").addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#lib-tab-books").classList.add("active"); showBooks();
  });
  $("#lib-tab-issues").addEventListener("click", () => {
    $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#lib-tab-issues").classList.add("active"); showIssues();
  });
  (params.tab === "issues" ? showIssues : showBooks)();
}

async function renderBooks() {
  const books = await api("/api/library/books");
  const cats = [...new Set(books.map(b => b.category))].sort();
  const stBadge = (b) => b.status === "Out" ? '<span class="badge b-red">All out</span>'
    : b.status === "Low" ? '<span class="badge b-amber">Low (' + b.available_copies + ' left)</span>'
    : '<span class="badge b-green">Available</span>';
  $("#lib-body").innerHTML = `
  <div class="toolbar">
    <div class="search-wrap"><svg><use href="#i-search"/></svg><input class="input" id="lib-q" placeholder="Search title, author, ISBN…"></div>
    <select class="input" id="lib-cat"><option value="">All categories</option>
      ${cats.map(c => `<option>${esc(c)}</option>`).join("")}</select>
    <div class="grow"></div>
    ${canLib() ? `<button class="btn btn-outline" onclick="bookForm()"><svg><use href="#i-plus"/></svg> Add Book</button>` : ""}
  </div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>Title</th><th>Author</th><th>Category</th><th>ISBN</th><th>Shelf</th><th class="num">Copies</th><th class="num">Out</th><th>Status</th>${canLib() ? '<th class="num">Actions</th>' : ""}</tr></thead>
    <tbody id="lib-body2">
      ${books.map(b => `
        <tr>
          <td><b>${esc(b.title)}</b></td>
          <td>${esc(b.author || "—")}</td>
          <td><span class="badge ${catBadge(b.category)}">${esc(b.category)}</span></td>
          <td><small>${esc(b.isbn || "—")}</small></td>
          <td><span class="badge b-slate">${esc(b.shelf || "—")}</span></td>
          <td class="num">${b.available_copies} / ${b.total_copies}</td>
          <td class="num">${b.out_count}</td>
          <td>${stBadge(b)}</td>
          ${canLib() ? `<td><div class="actions">
            <button class="ic-btn" title="Issue to student" onclick="issueForm(${b.id})"><svg><use href="#i-book"/></svg></button>
            <button class="ic-btn" title="Edit" onclick="bookForm(${b.id})"><svg><use href="#i-edit"/></svg></button>
            <button class="ic-btn" title="Delete" onclick="deleteBook(${b.id},'${esc(b.title)}')"><svg><use href="#i-close"/></svg></button>
          </div></td>` : ""}
        </tr>`).join("")}
    </tbody></table></div>
  ${books.length === 0 ? '<div class="empty">No books in the catalogue yet</div>' : ""}`;
  const filter = () => {
    const q = $("#lib-q").value.toLowerCase();
    const cat = $("#lib-cat").value;
    const rows = books.filter(b =>
      (!q || (b.title + " " + (b.author || "") + " " + (b.isbn || "")).toLowerCase().includes(q)) &&
      (!cat || b.category === cat));
    $("#lib-body2").innerHTML = rows.map(b => `
      <tr>
        <td><b>${esc(b.title)}</b></td>
        <td>${esc(b.author || "—")}</td>
        <td><span class="badge ${catBadge(b.category)}">${esc(b.category)}</span></td>
        <td><small>${esc(b.isbn || "—")}</small></td>
        <td><span class="badge b-slate">${esc(b.shelf || "—")}</span></td>
        <td class="num">${b.available_copies} / ${b.total_copies}</td>
        <td class="num">${b.out_count}</td>
        <td>${stBadge(b)}</td>
        ${canLib() ? `<td><div class="actions">
          <button class="ic-btn" title="Issue to student" onclick="issueForm(${b.id})"><svg><use href="#i-book"/></svg></button>
          <button class="ic-btn" title="Edit" onclick="bookForm(${b.id})"><svg><use href="#i-edit"/></svg></button>
          <button class="ic-btn" title="Delete" onclick="deleteBook(${b.id},'${esc(b.title)}')"><svg><use href="#i-close"/></svg></button>
        </div></td>` : ""}
      </tr>`).join("");
  };
  $("#lib-q").addEventListener("input", filter);
  $("#lib-cat").addEventListener("change", filter);
}

async function renderIssues(statusFilter) {
  const issues = await api("/api/library/issues");
  const stBadge = (s) => s === "Returned" ? '<span class="badge b-slate">Returned</span>'
    : s === "Overdue" ? '<span class="badge b-red">Overdue</span>'
    : '<span class="badge b-green">Issued</span>';
  $("#lib-body").innerHTML = `
  <div class="toolbar">
    <select class="input" id="iss-status" style="min-width:160px">
      <option value="">All statuses</option>
      <option value="Issued" ${statusFilter === "Issued" ? "selected" : ""}>Currently issued</option>
      <option value="Overdue" ${statusFilter === "Overdue" ? "selected" : ""}>Overdue</option>
      <option value="Returned" ${statusFilter === "Returned" ? "selected" : ""}>Returned</option>
    </select>
    <span class="badge b-blue">${issues.length} records</span>
    <div class="grow"></div>
  </div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>Book</th><th>Student</th><th>Class</th><th>Issued</th><th>Due</th><th>Returned</th><th>Status</th><th>By</th>${canLib() ? '<th class="num">Action</th>' : ""}</tr></thead>
    <tbody>
      ${issues.filter(i => !statusFilter || i.status === statusFilter).map(i => `
        <tr>
          <td><b>${esc(i.book_title)}</b><br><small style="color:var(--muted)">${esc(i.book_author || "")}</small></td>
          <td>${esc(i.student_name)}<br><small style="color:var(--muted)">${esc(i.admission_no)}</small></td>
          <td>${esc(i.class_name || "—")}</td>
          <td>${fmtDate(i.issue_date)}</td>
          <td>${fmtDate(i.due_date)}${i.status === "Overdue" ? '<br><small style="color:var(--red)">' + timeAgo(i.due_date) + '</small>' : ""}</td>
          <td>${i.return_date ? fmtDate(i.return_date) : "—"}</td>
          <td>${stBadge(i.status)}</td>
          <td><small>${esc(i.issued_by || "—")}</small></td>
          ${canLib() ? `<td><div class="actions">
            ${i.status !== "Returned" ? `<button class="btn btn-primary btn-sm" onclick="returnBook(${i.id})">Return</button>` : ""}
          </div></td>` : ""}
        </tr>`).join("")}
    </tbody></table></div>
  ${issues.filter(i => !statusFilter || i.status === statusFilter).length === 0 ? '<div class="empty">No issue records</div>' : ""}`;
  $("#iss-status").addEventListener("change", e => renderIssues(e.target.value));
}

async function bookForm(id) {
  const all = id ? await api("/api/library/books") : null;
  let b = { category: "Textbook", year: 2026, total_copies: 1, shelf: "" };
  if (id) b = all.find(x => x.id === id) || b;
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Book" : "Add Book"}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full"><label>Title *</label><input id="f-title" class="input" value="${esc(b.title || "")}" placeholder="e.g. Blossoms of the Savannah"></div>
    <div><label>Author</label><input id="f-author" class="input" value="${esc(b.author || "")}"></div>
    <div><label>ISBN</label><input id="f-isbn" class="input" value="${esc(b.isbn || "")}"></div>
    <div><label>Publisher</label><input id="f-pub" class="input" value="${esc(b.publisher || "")}"></div>
    <div><label>Category</label><select id="f-cat" class="input">
      ${["Textbook", "Set Book", "Fiction", "Reference", "Biography", "Poetry", "Dictionary"].map(c => `<option ${b.category === c ? "selected" : ""}>${c}</option>`).join("")}
    </select></div>
    <div><label>Year</label><input id="f-year" class="input" type="number" value="${b.year || 2026}"></div>
    <div><label>Total copies</label><input id="f-copies" class="input" type="number" min="1" value="${b.total_copies || 1}"></div>
    <div><label>Shelf location</label><input id="f-shelf" class="input" value="${esc(b.shelf || "")}" placeholder="e.g. Shelf A1"></div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="b-save">${id ? "Save Changes" : "Add Book"}</button>
  </div>`);
  $("#b-save").addEventListener("click", async () => {
    const title = $("#f-title").value.trim();
    if (!title) { toast("Title is required", "err"); return; }
    const body = { title, author: $("#f-author").value.trim(), isbn: $("#f-isbn").value.trim(),
      publisher: $("#f-pub").value.trim(), category: $("#f-cat").value,
      year: Number($("#f-year").value) || 2026, total_copies: Number($("#f-copies").value) || 1,
      shelf: $("#f-shelf").value.trim() };
    try {
      if (id) { await api("/api/library/books/" + id, { method: "PUT", body }); toast("Book updated"); }
      else { await api("/api/library/books", { method: "POST", body }); toast("Book added"); }
      closeModal(); openView("library");
    } catch (err) { toast(err.message, "err"); }
  });
}

async function deleteBook(id, title) {
  modal(`
  <div class="modal-head"><h3>Remove book</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><p style="font-size:13.5px">Remove <b>${esc(title)}</b> from the catalogue? This also deletes its issue history.</p></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" id="del-b">Remove</button>
  </div>`);
  $("#del-b").addEventListener("click", async () => {
    try { await api("/api/library/books/" + id, { method: "DELETE" }); toast("Book removed"); closeModal(); openView("library"); }
    catch (err) { toast(err.message, "err"); }
  });
}

async function issueForm(bookId) {
  const [books, students] = await Promise.all([api("/api/library/books"), api("/api/students")]);
  const selBook = bookId || "";
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  modal(`
  <div class="modal-head"><h3>Issue book to student</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full"><label>Book</label><select id="iss-book" class="input">
      <option value="">— select book —</option>
      ${books.filter(b => b.available_copies > 0).map(b => `<option value="${b.id}" ${String(b.id) === String(selBook) ? "selected" : ""}>${esc(b.title)} — ${b.available_copies} available</option>`).join("")}
    </select></div>
    <div class="full">
      <label>Student * <small style="font-weight:500;color:var(--muted)">search by name or admission number</small></label>
      <div class="stu-picker">
        <div class="search-wrap"><svg><use href="#i-search"/></svg>
          <input id="iss-search" class="input" placeholder="Type a name or admission no… (e.g. Collins or GF/…) " autocomplete="off"></div>
        <input type="hidden" id="iss-student">
        <div class="stu-picker-results" id="iss-results"></div>
      </div>
      <div class="picked-chip" id="iss-picked" style="display:none"></div>
    </div>
    <div><label>Due date (14 days default)</label><input id="iss-due" class="input" type="date" value="${due}"></div>
    <div><label>Notes</label><input id="iss-notes" class="input" placeholder="optional"></div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="iss-save"><svg><use href="#i-book"/></svg> Issue Book</button>
  </div>`);
  // ---- searchable student picker (name or admission number) ----
  const active = students.filter(s => s.status === "Active");
  let selSid = null;
  function clearSel() {
    selSid = null;
    $("#iss-student").value = "";
    $("#iss-picked").style.display = "none";
    $("#iss-picked").innerHTML = "";
    $("#iss-search").value = "";
    $("#iss-search").focus();
  }
  function renderResults(q) {
    const box = $("#iss-results");
    const ql = (q || "").trim().toLowerCase();
    if (!ql) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const matches = active.filter(s =>
      (s.first_name + " " + (s.middle_name || "") + " " + s.last_name + " " + (s.admission_no || "")).toLowerCase().includes(ql)
    ).slice(0, 12);
    if (!matches.length) {
      box.innerHTML = '<div class="stu-picker-empty">No students found — check the name or admission number</div>';
      box.classList.add("open");
      return;
    }
    box.innerHTML = matches.map(s => `
      <div class="stu-picker-item" data-sid="${s.id}">
        ${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}
        <div><b>${esc(s.first_name + " " + s.last_name)}</b>
          <small>${esc(s.admission_no)} · ${esc(s.class_name || "unplaced")}</small></div>
        <svg style="width:14px;height:14px;margin-left:auto;color:var(--muted)"><use href="#i-arrow"/></svg>
      </div>`).join("");
    box.classList.add("open");
  }
  $("#iss-search").addEventListener("input", e => renderResults(e.target.value));
  $("#iss-search").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $("#iss-results .stu-picker-item");
      if (first) first.click();
    }
  });
  // blur hides the list after a short delay so a click on an item still registers
  $("#iss-search").addEventListener("blur", () => setTimeout(() => {
    const box = $("#iss-results"); if (box) box.classList.remove("open");
  }, 180));
  $("#iss-results").addEventListener("click", e => {
    const item = e.target.closest(".stu-picker-item");
    if (!item) return;
    selSid = Number(item.dataset.sid);
    const s = active.find(x => x.id === selSid);
    if (!s) return;
    $("#iss-student").value = selSid;
    const chip = $("#iss-picked");
    chip.style.display = "flex";
    chip.innerHTML = `${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}
      <div><b>${esc(s.first_name + " " + s.last_name)}</b>
      <small style="display:block;color:var(--muted)">${esc(s.admission_no)} · ${esc(s.class_name || "unplaced")}</small></div>
      <span class="clear" title="Clear selection">✕</span>`;
    chip.querySelector(".clear").addEventListener("click", clearSel);
    $("#iss-search").value = "";
    const box = $("#iss-results"); box.classList.remove("open"); box.innerHTML = "";
  });
  // ---- save ----
  $("#iss-save").addEventListener("click", async () => {
    const bid = $("#iss-book").value, sid = $("#iss-student").value;
    if (!bid || !sid) { toast("Select a book and search & select a student", "err"); return; }
    try {
      await api("/api/library/issue", { method: "POST", body: { book_id: Number(bid), student_id: Number(sid), due_date: $("#iss-due").value, notes: $("#iss-notes").value.trim() } });
      toast("Book issued to student");
      closeModal(); openView("library", { tab: "issues" });
    } catch (err) { toast(err.message, "err"); }
  });
}

async function returnBook(issueId) {
  try {
    await api("/api/library/return/" + issueId, { method: "POST" });
    toast("Book returned ✓");
    openView("library", { tab: "issues" });
  } catch (err) { toast(err.message, "err"); }
}

/* ============================================================
   EVENTS — school calendar
   ============================================================ */
const EV_CATS = ["Academic", "Sports", "Meeting", "Holiday", "Exam", "Creative", "General"];
const evCatBadge = (c) => ({ Academic: "b-blue", Sports: "b-green", Meeting: "b-violet",
  Holiday: "b-amber", Exam: "b-red", Creative: "b-violet", General: "b-slate" }[c] || "b-slate");

async function view_events(el, params) {
  el.innerHTML = `<div class="loader"><div class="spinner"></div><p>Loading events…</p></div>`;
  const events = await api("/api/events");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter(e => e.upcoming);
  const past = events.filter(e => !e.upcoming);
  el.innerHTML = `
  <div class="toolbar">
    <p style="color:var(--muted)">${upcoming.length} upcoming · ${past.length} past</p>
    <div class="grow"></div>
    ${adminBtn(`<button class="btn btn-outline" onclick="eventForm()"><svg><use href="#i-plus"/></svg> Add Event</button>`)}
  </div>
  <div class="tab-row">
    <button class="tab-btn active" id="ev-tab-up">Upcoming</button>
    <button class="tab-btn" id="ev-tab-past">Past</button>
  </div>
  <div id="ev-body"></div>`;
  const render = (list) => {
    const grouped = {};
    list.forEach(e => { const m = fmtDate(e.event_date).split(" ").slice(0, 2).join(" "); (grouped[m] = grouped[m] || []).push(e); });
    $("#ev-body").innerHTML = Object.keys(grouped).map(month => `
      <div class="section-title">${esc(month)}</div>
      ${grouped[month].map(e => `
        <div class="card" style="margin-bottom:10px;padding:14px 18px">
          <div style="display:flex;gap:14px;align-items:flex-start">
            <div style="width:46px;flex:none;text-align:center;background:var(--green-100);color:var(--green-dark);border-radius:10px;padding:6px 2px">
              <b style="font-size:15px">${fmtDate(e.event_date).split(" ")[0]}</b>
              <small style="display:block;font-size:9.5px">${fmtDate(e.event_date).split(" ")[1]}</small>
            </div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <b style="font-size:14px">${esc(e.title)}</b>
                <span class="badge ${evCatBadge(e.category)}">${esc(e.category)}</span>
                <span class="badge b-slate">${esc(e.audience)}</span>
              </div>
              ${e.description ? `<p style="font-size:12.5px;color:var(--slate);margin-top:4px">${esc(e.description)}</p>` : ""}
              <small style="color:var(--muted)">Added by ${esc(e.created_by || "Admin")}</small>
            </div>
            ${adminBtn(`<div style="display:flex;gap:6px">
              <button class="ic-btn" title="Edit" onclick="eventForm(${e.id})"><svg><use href="#i-edit"/></svg></button>
              <button class="ic-btn" title="Delete" onclick="deleteEvent(${e.id},'${esc(e.title)}')"><svg><use href="#i-close"/></svg></button>
            </div>`)}
          </div>
        </div>`).join("") || '<div class="empty">No events here yet</div>'}
    `).join("");
  };
  $("#ev-tab-up").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#ev-tab-up").classList.add("active"); render(upcoming); });
  $("#ev-tab-past").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#ev-tab-past").classList.add("active"); render(past); });
  render(params.tab === "past" ? past : upcoming);
}

async function eventForm(id) {
  const all = id ? await api("/api/events") : null;
  let e = { category: "General", audience: "All", event_date: new Date().toISOString().slice(0, 10) };
  if (id) e = all.find(x => x.id === id) || e;
  modal(`
  <div class="modal-head"><h3>${id ? "Edit Event" : "Add Event"}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div class="full"><label>Title *</label><input id="f-title" class="input" value="${esc(e.title || "")}" placeholder="e.g. Prize Giving Day"></div>
    <div><label>Date *</label><input id="f-date" class="input" type="date" value="${esc(e.event_date || "")}"></div>
    <div><label>Category</label><select id="f-cat" class="input">
      ${EV_CATS.map(c => `<option ${e.category === c ? "selected" : ""}>${c}</option>`).join("")}
    </select></div>
    <div><label>Audience</label><select id="f-aud" class="input">
      ${["All", "Parents", "Teachers", "Students"].map(a => `<option ${e.audience === a ? "selected" : ""}>${a}</option>`).join("")}
    </select></div>
    <div class="full"><label>Description</label><textarea id="f-desc" class="input" rows="3" placeholder="Details…">${esc(e.description || "")}</textarea></div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="ev-save">${id ? "Save Changes" : "Add Event"}</button>
  </div>`);
  $("#ev-save").addEventListener("click", async () => {
    const title = $("#f-title").value.trim(), date = $("#f-date").value;
    if (!title || !date) { toast("Title and date required", "err"); return; }
    const body = { title, description: $("#f-desc").value.trim(), event_date: date, category: $("#f-cat").value, audience: $("#f-aud").value };
    try {
      if (id) { await api("/api/events/" + id, { method: "PUT", body }); toast("Event updated"); }
      else { await api("/api/events", { method: "POST", body }); toast("Event added"); }
      closeModal(); openView("events");
    } catch (err) { toast(err.message, "err"); }
  });
}

async function deleteEvent(id, title) {
  modal(`
  <div class="modal-head"><h3>Remove event</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><p style="font-size:13.5px">Remove <b>${esc(title)}</b> from the school calendar?</p></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" id="del-ev">Remove</button>
  </div>`);
  $("#del-ev").addEventListener("click", async () => {
    try { await api("/api/events/" + id, { method: "DELETE" }); toast("Event removed"); closeModal(); openView("events"); }
    catch (err) { toast(err.message, "err"); }
  });
}

/* ============================================================
   DISCIPLINE & CONDUCT
   ============================================================ */
const MERIT_CATS = ["Academic Excellence", "Good Conduct", "Community Service", "Sports Achievement",
  "Cleanliness", "Punctuality", "Leadership", "Honesty"];
const DEMERIT_CATS = ["Late Coming", "Noise Making", "Truancy", "Fighting", "Dishonesty",
  "Vandalism", "Mobile Phone Use", "Incomplete Homework", "Uniform Violation"];
const CONDUCT_STYLES = { "Excellent": "b-green", "Good": "b-blue", "Satisfactory": "b-amber", "Needs Improvement": "b-red" };

async function view_discipline(el, params) {
  el.innerHTML = `<div class="loader"><div class="spinner"></div><p>Loading…</p></div>`;
  const sum = await api("/api/discipline/summary");
  el.innerHTML = `
  <div class="stat-grid">
    ${statCard("green", "i-shield", sum.merits, "Merits this term", "positive recognition")}
    ${statCard("red", "i-shield", sum.demerits, "Demerits this term", "areas to improve")}
    ${statCard("amber", "i-calendar", sum.today, "Recorded today", "latest entries")}
    ${statCard("blue", "i-users", sum.top[0] ? sum.top[0].first_name + " " + sum.top[0].last_name : "—", "Best conduct", sum.top[0] ? sum.top[0].class_name + " · net " + (sum.top[0].merits - sum.top[0].demerits) : "—")}
  </div>
  <div class="tab-row">
    <button class="tab-btn active" id="dc-tab-rec">Records</button>
    <button class="tab-btn" id="dc-tab-top">Conduct summary</button>
  </div>
  <div id="dc-body"></div>`;
  const showRecords = () => renderDisciplineRecords();
  const showTop = () => {
    $("#dc-body").innerHTML = `
    <div class="card"><div class="card-head"><h3>Students with the best conduct</h3><p>Net merits this term</p></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Student</th><th>Class</th><th class="num">Merits</th><th class="num">Demerits</th><th class="num">Net</th><th>Rating</th></tr></thead>
        <tbody>${sum.top.map((t, i) => `<tr>
          <td><b>${i + 1}. ${esc(t.first_name + " " + t.last_name)}</b><br><small style="color:var(--muted)">${esc(t.admission_no)}</small></td>
          <td>${esc(t.class_name || "—")}</td>
          <td class="num" style="color:var(--green-dark)">${t.merits}</td>
          <td class="num" style="color:var(--red)">${t.demerits}</td>
          <td class="num"><b>${t.merits - t.demerits}</b></td>
          <td><span class="badge ${CONDUCT_STYLES["Good"]}">${esc("Good")}</span></td>
        </tr>`).join("") || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No conduct records yet</td></tr>'}
        </tbody></table></div></div>`;
  };
  $("#dc-tab-rec").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#dc-tab-rec").classList.add("active"); showRecords(); });
  $("#dc-tab-top").addEventListener("click", () => { $$(".tab-btn").forEach(b => b.classList.remove("active")); $("#dc-tab-top").classList.add("active"); showTop(); });
  showRecords();
}

async function renderDisciplineRecords() {
  const records = await api("/api/discipline");
  const clsBadge = (t) => t === "Merit" ? '<span class="badge b-green">Merit</span>' : '<span class="badge b-red">Demerit</span>';
  $("#dc-body").innerHTML = `
  <div class="toolbar">
    <select class="input" id="dc-type" style="min-width:140px"><option value="">All types</option><option>Merit</option><option>Demerit</option></select>
    <div class="search-wrap"><svg><use href="#i-search"/></svg><input class="input" id="dc-q" placeholder="Search student or category…"></div>
    <div class="grow"></div>
    ${can("admin", "teacher") ? `<button class="btn btn-primary" onclick="conductForm()"><svg><use href="#i-plus"/></svg> Record Merit / Demerit</button>` : ""}
  </div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>Date</th><th>Student</th><th>Class</th><th>Type</th><th>Category</th><th>Description</th><th>By</th>${adminBtn('<th class="num">Action</th>')}</tr></thead>
    <tbody id="dc-body2">
      ${records.map(r => `
        <tr>
          <td>${fmtDate(r.record_date)}</td>
          <td><b>${esc(r.student_name)}</b><br><small style="color:var(--muted)">${esc(r.admission_no)}</small></td>
          <td>${esc(r.class_name || "—")}</td>
          <td>${clsBadge(r.record_type)}</td>
          <td>${esc(r.category || "—")}</td>
          <td><small>${esc(r.description || "—")}</small></td>
          <td><small>${esc(r.recorded_by || "—")}</small></td>
          ${adminBtn(`<td><div class="actions"><button class="ic-btn" title="Delete" onclick="deleteConduct(${r.id})"><svg><use href="#i-close"/></svg></button></div></td>`)}
        </tr>`).join("")}
    </tbody></table></div>
  ${records.length === 0 ? '<div class="empty">No conduct records yet</div>' : ""}`;
  const filter = () => {
    const t = $("#dc-type").value, q = $("#dc-q").value.toLowerCase();
    const rows = records.filter(r =>
      (!t || r.record_type === t) &&
      (!q || (r.student_name + " " + r.admission_no + " " + (r.category || "")).toLowerCase().includes(q)));
    $("#dc-body2").innerHTML = rows.map(r => `
      <tr>
        <td>${fmtDate(r.record_date)}</td>
        <td><b>${esc(r.student_name)}</b><br><small style="color:var(--muted)">${esc(r.admission_no)}</small></td>
        <td>${esc(r.class_name || "—")}</td>
        <td>${clsBadge(r.record_type)}</td>
        <td>${esc(r.category || "—")}</td>
        <td><small>${esc(r.description || "—")}</small></td>
        <td><small>${esc(r.recorded_by || "—")}</small></td>
        ${adminBtn(`<td><div class="actions"><button class="ic-btn" title="Delete" onclick="deleteConduct(${r.id})"><svg><use href="#i-close"/></svg></button></div></td>`)}
      </tr>`).join("");
  };
  $("#dc-type").addEventListener("change", filter);
  $("#dc-q").addEventListener("input", filter);
}

async function conductForm() {
  const students = await api("/api/students");
  const active = students.filter(s => s.status === "Active");
  modal(`
  <div class="modal-head"><h3>Record Merit / Demerit</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Type</label><select id="cd-type" class="input"><option>Merit</option><option>Demerit</option></select></div>
    <div><label>Date</label><input id="cd-date" class="input" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="full">
      <label>Student * <small style="font-weight:500;color:var(--muted)">search by name or admission number</small></label>
      <div class="stu-picker">
        <div class="search-wrap"><svg><use href="#i-search"/></svg>
          <input id="cd-search" class="input" placeholder="Type a name or admission no…" autocomplete="off"></div>
        <input type="hidden" id="cd-student">
        <div class="stu-picker-results" id="cd-results"></div>
      </div>
      <div class="picked-chip" id="cd-picked" style="display:none"></div>
    </div>
    <div class="full"><label>Category</label><select id="cd-cat" class="input">${MERIT_CATS.map(c => `<option>${c}</option>`).join("")}</select></div>
    <div class="full"><label>Description</label><textarea id="cd-desc" class="input" rows="2" placeholder="What happened?"></textarea></div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="cd-save"><svg><use href="#i-shield"/></svg> Save Record</button>
  </div>`);
  // searchable picker (same pattern as library issue)
  let selSid = null;
  function clearSel() {
    selSid = null;
    $("#cd-student").value = "";
    $("#cd-picked").style.display = "none";
    $("#cd-search").value = "";
    $("#cd-search").focus();
  }
  function renderResults(q) {
    const box = $("#cd-results");
    const ql = (q || "").trim().toLowerCase();
    if (!ql) { box.classList.remove("open"); box.innerHTML = ""; return; }
    const matches = active.filter(s =>
      (s.first_name + " " + (s.middle_name || "") + " " + s.last_name + " " + (s.admission_no || "")).toLowerCase().includes(ql)
    ).slice(0, 12);
    if (!matches.length) {
      box.innerHTML = '<div class="stu-picker-empty">No students found — check the name or admission number</div>';
      box.classList.add("open"); return;
    }
    box.innerHTML = matches.map(s => `
      <div class="stu-picker-item" data-sid="${s.id}">
        ${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}
        <div><b>${esc(s.first_name + " " + s.last_name)}</b>
          <small>${esc(s.admission_no)} · ${esc(s.class_name || "unplaced")}</small></div>
      </div>`).join("");
    box.classList.add("open");
  }
  $("#cd-search").addEventListener("input", e => renderResults(e.target.value));
  $("#cd-search").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); const f = $("#cd-results .stu-picker-item"); if (f) f.click(); }
  });
  $("#cd-search").addEventListener("blur", () => setTimeout(() => { const b = $("#cd-results"); if (b) b.classList.remove("open"); }, 180));
  $("#cd-results").addEventListener("click", e => {
    const item = e.target.closest(".stu-picker-item");
    if (!item) return;
    selSid = Number(item.dataset.sid);
    const s = active.find(x => x.id === selSid);
    if (!s) return;
    $("#cd-student").value = selSid;
    const chip = $("#cd-picked");
    chip.style.display = "flex";
    chip.innerHTML = `${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}
      <div><b>${esc(s.first_name + " " + s.last_name)}</b>
      <small style="display:block;color:var(--muted)">${esc(s.admission_no)} · ${esc(s.class_name || "unplaced")}</small></div>
      <span class="clear" title="Clear">✕</span>`;
    chip.querySelector(".clear").addEventListener("click", clearSel);
    $("#cd-search").value = "";
    const b = $("#cd-results"); b.classList.remove("open"); b.innerHTML = "";
  });
  // category list follows the type
  $("#cd-type").addEventListener("change", e => {
    const cats = e.target.value === "Merit" ? MERIT_CATS : DEMERIT_CATS;
    $("#cd-cat").innerHTML = cats.map(c => `<option>${c}</option>`).join("");
  });
  $("#cd-save").addEventListener("click", async () => {
    const sid = $("#cd-student").value;
    if (!sid) { toast("Search and select a student", "err"); return; }
    try {
      await api("/api/discipline", { method: "POST", body: {
        student_id: Number(sid), record_type: $("#cd-type").value,
        category: $("#cd-cat").value, description: $("#cd-desc").value.trim(), record_date: $("#cd-date").value } });
      toast($("#cd-type").value + " recorded");
      closeModal(); openView("discipline");
    } catch (err) { toast(err.message, "err"); }
  });
}

async function deleteConduct(id) {
  try { await api("/api/discipline/" + id, { method: "DELETE" }); toast("Record removed"); openView("discipline"); }
  catch (err) { toast(err.message, "err"); }
}

/* ============================================================
   GUARDIAN — school events (read-only)
   ============================================================ */
async function view_gevents(el) {
  el.innerHTML = `<div class="loader"><div class="spinner"></div><p>Loading…</p></div>`;
  const events = await api("/api/events");
  const upcoming = events.filter(e => e.upcoming);
  el.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>Upcoming school events</h3><p>From ${esc(state.settings.school_name || "the school")}</p></div>
    ${upcoming.map(e => `
      <div style="display:flex;gap:13px;align-items:flex-start;padding:11px 0;border-bottom:1px solid #f1f5f9">
        <div style="width:46px;flex:none;text-align:center;background:var(--green-100);color:var(--green-dark);border-radius:10px;padding:6px 2px">
          <b style="font-size:15px">${fmtDate(e.event_date).split(" ")[0]}</b>
          <small style="display:block;font-size:9.5px">${fmtDate(e.event_date).split(" ")[1]}</small>
        </div>
        <div>
          <b style="font-size:14px">${esc(e.title)}</b>
          <span class="badge ${evCatBadge(e.category)}" style="margin-left:6px">${esc(e.category)}</span>
          ${e.description ? `<p style="font-size:12.5px;color:var(--slate);margin-top:3px">${esc(e.description)}</p>` : ""}
        </div>
      </div>`).join("") || '<p style="color:var(--muted)">No upcoming events</p>'}
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h3>Past events</h3></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${events.filter(e => !e.upcoming).map(e => `<span class="badge b-slate">${esc(e.title)} · ${fmtDate(e.event_date)}</span>`).join("") || "—"}
    </div>
  </div>`;
}

/* ============================================================
   ID CARDS — professional student identification cards
   ============================================================ */
function barcodeSvg(text) {
  // deterministic, professional-looking Code-128-style bars from the card no.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  let seed = h >>> 0;
  let bars = "";
  let x = 0;
  const W = 210, H = 34;
  const n = 42;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const w = 1 + (seed % 3);
    if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${H}" fill="#0f172a"/>`;
    x += w + 1;
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="height:34px;width:210px">${bars}</svg>`;
}
function monogramOf(name) {
  return String(name || "S").split(" ").map(w => w[0]).join("").slice(0, 3).toUpperCase();
}
function idcardFrontHtml(d) {
  const s = d.settings || state.settings || {};
  const full = (d.first_name + " " + (d.middle_name || "") + " " + d.last_name).replace(/\s+/g, " ").trim().toUpperCase();
  const logo = s.school_logo
    ? `<img src="${esc(s.school_logo)}" alt="">`
    : `<div class="idc-crest">${esc(monogramOf(s.school_name || "School"))}</div>`;
  const photo = d.profile_pic
    ? `<img src="${esc(d.profile_pic)}" alt="">`
    : `<div class="idc-photo-ph">${esc(initials(d.first_name + " " + d.last_name))}</div>`;
  const row = (k, v) => `<tr><td class="k">${k}</td><td class="v">${esc(v || "—")}</td></tr>`;
  return `
  <div class="idcard idc-front">
    <div class="idc-head">
      <div class="idc-logo">${logo}</div>
      <div class="idc-org">
        <b>${esc((s.school_name || "SCHOOL").toUpperCase())}</b>
        <small>${esc(s.school_motto || "")}</small>
        <small>${esc(s.school_address || "")} · ${esc(s.school_phone || "")}</small>
      </div>
    </div>
    <div class="idc-body">
      <div class="idc-photo">${photo}</div>
      <div class="idc-details">
        <div class="idc-name">${esc(full)}</div>
        <table class="idc-table">
          ${row("ADM NO", d.admission_no)}
          ${row("CLASS", d.class_name)}
          ${row("HOUSE", d.house)}
          ${row("BLOOD GROUP", d.blood_group)}
          ${row("GENDER", d.gender)}
          ${row("D.O.B", fmtDate(d.dob))}
        </table>
      </div>
    </div>
    <div class="idc-foot">
      <div class="idc-bcode">
        <div class="idc-bars">${barcodeSvg(d.card_no)}</div>
        <div class="idc-cardno">${esc(d.card_no)}</div>
      </div>
      <div class="idc-sign">
        <div class="sig-line"></div>
        <small>Principal</small>
      </div>
      <div class="idc-valid">
        <small>VALID</small>
        <b>${esc((d.valid_until || "").split("-")[0])}</b>
      </div>
    </div>
    <div class="idc-strip">STUDENT IDENTIFICATION CARD</div>
  </div>`;
}
function idcardBackHtml(d) {
  const s = d.settings || state.settings || {};
  return `
  <div class="idcard idc-back">
    <div class="idc-head">
      <div class="idc-logo">
        ${s.school_logo ? `<img src="${esc(s.school_logo)}" alt="">` : `<div class="idc-crest">${esc(monogramOf(s.school_name || "School"))}</div>`}
      </div>
      <div class="idc-org"><b>${esc((s.school_name || "SCHOOL").toUpperCase())}</b></div>
    </div>
    <div class="idc-back-body">
      <div class="idc-bk-row"><span>GUARDIAN</span><b>${esc((d.parent_name || "—").toUpperCase())}</b></div>
      <div class="idc-bk-row"><span>CONTACT</span><b>${esc(d.parent_phone || "—")}</b></div>
      <div class="idc-bk-row"><span>ADDRESS</span><b>${esc(d.address || "—")}</b></div>
      <div class="idc-bk-row"><span>SCHOOL</span><b>${esc((s.school_phone || "") + " · " + (s.school_email || ""))}</b></div>
      <p class="idc-return">If found, kindly return this card to the school office or call the number above. <b>${esc((d.first_name + " " + d.last_name).toUpperCase())}</b> · ${esc(d.admission_no)}</p>
    </div>
    <div class="idc-foot">
      <div class="idc-bcode">
        <div class="idc-bars">${barcodeSvg(d.card_no)}</div>
        <div class="idc-cardno">${esc(d.card_no)}</div>
      </div>
      <div class="idc-valid"><small>ISSUED ${esc((s.academic_year || "").split("-")[0] || "")}</small></div>
    </div>
  </div>`;
}
function idcardPairHtml(d) {
  return `<div class="idc-pair"><div class="idc-label">FRONT</div>${idcardFrontHtml(d)}<div class="idc-label">BACK</div>${idcardBackHtml(d)}</div>`;
}

async function view_idcards(el, params) {
  el.innerHTML = `<div class="loader"><div class="spinner"></div><p>Loading…</p></div>`;
  const [classes, students] = await Promise.all([api("/api/classes"), api("/api/students")]);
  const active = students.filter(s => s.status === "Active");
  el.innerHTML = `
  <div class="toolbar no-print">
    <select class="input" id="idc-class" style="min-width:220px">
      <option value="">All classes (search below)</option>
      ${classes.map(c => `<option value="${c.id}" ${params.classId && String(c.id) === String(params.classId) ? "selected" : ""}>${esc(c.name)} (${c.cnt})</option>`).join("")}
    </select>
    <div class="search-wrap" style="min-width:240px"><svg><use href="#i-search"/></svg>
      <input class="input" id="idc-q" placeholder="Search student name / admission no…"></div>
    <div class="grow"></div>
    <button class="btn btn-outline" id="idc-print-class" disabled><svg><use href="#i-print"/></svg> Print class cards</button>
  </div>
  <div id="idc-pick" style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:12px;background:#fff;margin-bottom:16px">
    <p style="padding:14px;color:var(--muted);font-size:13px">Type a student's name or admission number above, or pick a class, then click a student to preview their ID card.</p>
  </div>
  <div id="idc-preview" class="idc-preview-wrap"></div>
  <!-- hidden print area for whole-class batch -->
  <div id="idc-print-area"></div>`;

  const pickBox = $("#idc-pick");
  function renderPick(list) {
    pickBox.innerHTML = list.length ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px;padding:10px">
        ${list.map(s => `
          <button class="stu-picker-item" style="border:1px solid var(--line);border-radius:9px;background:#fff;width:100%;text-align:left"
            onclick="loadIdCard(${s.id})">
            ${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}
            <div><b>${esc(s.first_name + " " + s.last_name)}</b>
              <small>${esc(s.admission_no)} · ${esc(s.class_name || "unplaced")}</small></div>
            <svg style="width:14px;height:14px;margin-left:auto;color:var(--muted)"><use href="#i-card"/></svg>
          </button>`).join("")}
      </div>` : '<p style="padding:14px;color:var(--muted);font-size:13px">No students match your search.</p>';
  }
  function filterPick() {
    const q = $("#idc-q").value.toLowerCase();
    const cid = $("#idc-class").value;
    let list = active;
    if (cid) list = list.filter(s => String(s.class_id || "") === cid);
    if (q) list = list.filter(s =>
      (s.first_name + " " + (s.middle_name || "") + " " + s.last_name + " " + (s.admission_no || "")).toLowerCase().includes(q));
    renderPick(list.slice(0, 60));
    $("#idc-print-class").disabled = !cid;
  }
  $("#idc-q").addEventListener("input", filterPick);
  $("#idc-class").addEventListener("change", e => {
    filterPick();
    if (e.target.value) openView("idcards", { classId: e.target.value });
  });
  filterPick();

  $("#idc-print-class").addEventListener("click", async () => {
    const cid = $("#idc-class").value;
    if (!cid) { toast("Select a class first", "err"); return; }
    const d = await api("/api/idcards/class/" + cid);
    const area = $("#idc-print-area");
    area.innerHTML = `<div class="idc-batch-title">${esc(d.class.name)} — Student ID Cards (${d.year})</div>` +
      d.students.map(st => idcardPairHtml({ ...st, settings: d.settings })).join("");
    printIdCards();
  });

  if (params.studentId) loadIdCard(params.studentId);
}

async function loadIdCard(sid) {
  const d = await api("/api/idcards/student/" + sid);
  const wrap = $("#idc-preview");
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="toolbar no-print" style="margin-bottom:12px">
      <b style="font-size:14px">${esc(d.first_name + " " + d.last_name)} — ${esc(d.admission_no)}</b>
      <div class="grow"></div>
      <button class="btn btn-primary" onclick="openIdCardModal(${sid})"><svg><use href="#i-card"/></svg> View &amp; Print Card</button>
    </div>
    ${idcardPairHtml(d)}`;
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function openIdCardModal(sid) {
  const d = await api("/api/idcards/student/" + sid);
  modal(`
  <div class="modal-head no-print"><h3>ID Card — ${esc(d.first_name + " " + d.last_name)}</h3>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary btn-sm" onclick="printIdCards()"><svg><use href="#i-print"/></svg> Print card</button>
      <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button>
    </div></div>
  <div class="modal-body" style="background:#e5e7eb">
    <div id="idcard-sheet">${idcardPairHtml(d)}</div>
  </div>`);
}

function printIdCards() {
  document.body.classList.add("print-mode");
  const clear = () => document.body.classList.remove("print-mode");
  setTimeout(() => { window.focus(); window.print(); }, 150);
  window.addEventListener("afterprint", clear, { once: true });
  setTimeout(clear, 30000);
}

/* ============================================================
   PARENT / GUARDIAN PORTAL
   ============================================================ */
async function gChildren() {
  if (!state.gchildren) state.gchildren = await api("/api/guardian/children");
  return state.gchildren;
}
async function gChildSwitcher(el) {
  const kids = await gChildren();
  if (!kids.length) return "";
  if (!state.guardianChild || !kids.find(k => k.student_id == state.guardianChild)) {
    state.guardianChild = kids[0].student_id;
  }
  return `
  <div class="toolbar">
    ${kids.length > 1 ? `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;font-weight:600;color:var(--slate)">Viewing:</span>
      <select class="input" id="g-child" style="min-width:230px">
        ${kids.map(k => `<option value="${k.student_id}" ${k.student_id == state.guardianChild ? "selected" : ""}>
          ${esc(k.name)} — ${esc(k.class_name)}</option>`).join("")}
      </select>
    </div>` : `<div style="display:flex;align-items:center;gap:10px">
      ${avatarHtml(kids[0].profile_pic, kids[0].name, "avatar-sm")}
      <div><b style="font-size:14px">${esc(kids[0].name)}</b>
      <small style="color:var(--muted);display:block">${esc(kids[0].admission_no)} · ${esc(kids[0].class_name)}</small></div>
    </div>`}
    <div class="grow"></div>
  </div>`;
}
function bindGChild(view) {
  const sel = $("#g-child");
  if (sel) sel.addEventListener("change", e => { state.guardianChild = Number(e.target.value); openView(view); });
}
const gChildId = () => Number(state.guardianChild) || 0;

async function view_gdash(el) {
  el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading…</p></div>';
  const kids = await gChildren();
  if (!kids.length) { el.innerHTML = emptyState("No children linked", "Contact the school office to link your account."); return; }
  const d = await api(`/api/guardian/dashboard?student_id=${gChildId()}`);
  const ex = d.exam, tr = d.transport;
  el.innerHTML = `
  ${await gChildSwitcher(el)}
  <div class="stat-grid">
    ${statCard("green", "i-chart", ex ? fmtNum(ex.mean) : "—", "Latest mean", ex ? esc(ex.exam_name) : "No results yet")}
    ${statCard("blue", "i-users", ex ? esc(meanGradeFromPts(ex.avg_pts)) : "—", "Achievement level", ex ? "Rank " + (ex.class_rank || "—") + " of " + (ex.class_size || "—") : "—")}
    ${statCard(ex && d.balance > 0 ? "red" : "green", "i-money", fmtMoney(d.balance), "Fee balance", ex ? esc(d.term) : "—")}
    ${statCard("amber", "i-bus", tr ? esc(tr.name) : "—", "Transport", tr ? tr.morning_time + " – " + tr.evening_time : "Not enrolled")}
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-head"><h3>Latest exam performance</h3>${ex ? `<span class="badge b-blue">${esc(ex.exam_name)}</span>` : ""}</div>
      ${ex ? `
        <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
          <div class="kpi"><div class="k">Mean score</div><div class="v">${fmtNum(ex.mean)}</div></div>
          <div class="kpi"><div class="k">Achievement level</div><div class="v"><span class="grade-pill ${gradeClass(meanGradeFromPts(ex.avg_pts))}">${esc(meanGradeFromPts(ex.avg_pts))}</span></div></div>
          <div class="kpi"><div class="k">Class position</div><div class="v" style="font-size:15px">${ex.class_rank || "—"} / ${ex.class_size || "—"}</div></div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:8px">${CBC_LABEL}</p>
        <div style="margin-top:14px"><button class="btn btn-outline btn-sm" onclick="openView('gresults')">Full results <svg style="width:13px;height:13px"><use href="#i-arrow"/></svg></button></div>`
      : '<p style="color:var(--muted)">No exam results published yet.</p>'}
    </div>
    <div class="card">
      <div class="card-head"><h3>Attendance (recent)</h3><p>Last ${d.attendance.recent_days} school days</p></div>
      <div class="kgrid" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi"><div class="k">Present</div><div class="v" style="color:var(--green-dark)">${d.attendance.Present}</div></div>
        <div class="kpi"><div class="k">Late</div><div class="v" style="color:var(--amber)">${d.attendance.Late}</div></div>
        <div class="kpi"><div class="k">Permission</div><div class="v" style="color:var(--blue)">${d.attendance.Permission}</div></div>
        <div class="kpi"><div class="k">Absent</div><div class="v" style="color:var(--red)">${d.attendance.Absent}</div></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-outline btn-sm" onclick="openView('gattendance')">Attendance details</button></div>
    </div>
  </div>
  <div class="card" style="margin-top:18px">
    <div class="card-head"><h3>Conduct this term</h3><p>CBC holistic development</p></div>
    <div id="g-conduct"><p style="color:var(--muted)">Loading…</p></div>
  </div>
  <div class="card" style="margin-top:18px">
    <div class="card-head"><h3>School announcements</h3></div>
    <div class="ann-list">
      ${d.announcements.map(a => `
        <div class="ann-item">
          <h4>${esc(a.title)}</h4>
          <div class="meta"><span class="badge b-violet">${esc(a.audience)}</span><span>${fmtDate(a.created_at)}</span></div>
          <p>${esc(a.message)}</p>
        </div>`).join("") || '<p style="color:var(--muted)">No announcements</p>'}
    </div>
  </div>`;
  // load conduct summary for the selected child
  api(`/api/discipline/student/${gChildId()}`).then(c => {
    const el2 = $("#g-conduct");
    if (!el2) return;
    el2.innerHTML = `
      <div class="kgrid" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi"><div class="k">Merits</div><div class="v" style="color:var(--green-dark)">${c.merits}</div></div>
        <div class="kpi"><div class="k">Demerits</div><div class="v" style="color:${c.demerits > 0 ? "var(--red)" : "var(--green-dark)"}">${c.demerits}</div></div>
        <div class="kpi"><div class="k">Rating</div><div class="v" style="font-size:15px"><span class="badge ${CONDUCT_STYLES[c.rating] || "b-slate"}">${esc(c.rating)}</span></div></div>
      </div>
      ${c.recent && c.recent.length ? `<div class="section-title">Recent records</div>
        ${c.recent.slice(0, 4).map(r => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12.5px">
          <span class="badge ${r.record_type === "Merit" ? "b-green" : "b-red"}" style="margin-right:6px">${esc(r.record_type)}</span>
          <b>${esc(r.category || "")}</b> — <small style="color:var(--muted)">${fmtDate(r.record_date)}</small>
        </div>`).join("")}` : ""}`;
  }).catch(() => { const el2 = $("#g-conduct"); if (el2) el2.innerHTML = '<p style="color:var(--muted)">No conduct records yet</p>'; });
  bindGChild("gdash");
}

async function view_gresults(el, params) {
  el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading…</p></div>';
  const kids = await gChildren();
  if (!kids.length) { el.innerHTML = emptyState("No children linked", "Contact the school office to link your account."); return; }
  await gChildSwitcher(el);
  const d = await api(`/api/guardian/results?student_id=${gChildId()}${params.examId ? "&exam_id=" + params.examId : ""}`);
  const exams = d.exams || [];
  const sel = d.selected_exam ? d.selected_exam.id : (exams.length ? exams[exams.length - 1].id : "");
  el.innerHTML = `
  ${await gChildSwitcher(el)}
  <div class="toolbar">
    <select class="input" id="g-exam" style="min-width:280px">
      ${exams.map(e => `<option value="${e.id}" ${String(e.id) === String(sel) ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
    </select>
    <div class="grow"></div>
    <button class="btn btn-outline" onclick="window.print()"><svg><use href="#i-print"/></svg> Print results</button>
  </div>
  <div id="g-res-body"></div>`;
  $("#g-exam").addEventListener("change", e => openView("gresults", { examId: e.target.value }));
  if (d.agg) {
    $("#g-res-body").innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
      ${statCard("green", "i-chart", fmtNum(d.agg.mean), "Mean score", esc(d.selected_exam.name))}
      ${statCard("blue", "i-users", esc(meanGradeFromPts(d.agg.avg_pts)), "Achievement level", d.agg.total_points + " points")}
      ${statCard("violet", "i-users", d.class_rank || "—", "Class position", "of " + (d.class_size || "—") + " students")}
      ${statCard("amber", "i-exam", d.agg.subjects, "Subjects", "graded")}
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>Subject</th><th class="num">Score (%)</th><th style="text-align:center">Grade</th><th class="num">Points</th><th class="num">Class mean</th></tr></thead>
      <tbody>
        ${d.per_subject.map((p, i) => `
          <tr><td>${i + 1}</td><td><b>${esc(p.name)}</b></td>
          <td class="num">${fmtNum(p.score)}</td>
          <td style="text-align:center"><span class="grade-pill ${gradeClass(p.grade)}" title="${esc((CBC_LEVELS[p.grade] || {}).name || "")}">${esc(p.grade)}</span></td>
          <td class="num">${p.points}</td>
          <td class="num">${fmtNum(p.subject_mean)}</td></tr>`).join("")}
      </tbody></table></div>
    <p style="font-size:12px;color:var(--muted);margin-top:10px">${CBC_LABEL}</p>`;
  } else {
    $("#g-res-body").innerHTML = emptyState("No results for this exam", "Results appear once the school publishes the exam.");
  }
  bindGChild("gresults");
}

async function view_gfees(el) {
  el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading…</p></div>';
  const kids = await gChildren();
  if (!kids.length) { el.innerHTML = emptyState("No children linked", "Contact the school office to link your account."); return; }
  await gChildSwitcher(el);
  const d = await api(`/api/guardian/statement?student_id=${gChildId()}`);
  const st = d.student;
  const pct = d.total_billed ? Math.round(d.total_paid / d.total_billed * 100) : 0;
  // per-term tracker
  const terms = ["Term 1", "Term 2", "Term 3"];
  const perTerm = terms.map(t => {
    const billed = d.billing.filter(b => b.term === t).reduce((a, b) => a + b.amount, 0);
    const paid = d.payments.filter(p => p.term === t).reduce((a, p) => a + p.amount, 0);
    return { term: t, billed, paid, balance: billed - paid, pct: billed ? Math.round(paid / billed * 100) : 0 };
  }).filter(t => t.billed > 0);
  // running balance in payment history (oldest -> newest)
  const sorted = [...d.payments].sort((a, b) => (a.payment_date + String(a.id)).localeCompare(b.payment_date + String(b.id)));
  let running = d.total_billed;
  const runningMap = {};
  sorted.forEach(p => { running -= p.amount; runningMap[p.id] = running; });
  el.innerHTML = `
  ${await gChildSwitcher(el)}
  <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
    ${statCard("blue", "i-money", fmtMoney(d.total_billed), "Total billed", "All terms")}
    ${statCard("green", "i-money", fmtMoney(d.total_paid), "Total paid", d.payments.length + " payment" + (d.payments.length === 1 ? "" : "s"))}
    ${statCard(d.balance > 0 ? "red" : "green", "i-money", fmtMoney(Math.max(0, d.balance)), "Outstanding balance", d.balance > 0 ? "Please clear" : "All cleared")}
  </div>

  <!-- Fee balance tracker -->
  <div class="card" style="margin-bottom:18px">
    <div class="card-head"><h3>Fee balance tracker</h3><p>${esc(st.first_name + " " + st.last_name)} · ${esc(d.class ? d.class.name : "")}</p></div>
    <div class="grid-2-1">
      <div>
        <div class="balance-hero" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <div>
            <small style="color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px">Balance outstanding</small>
            <div style="font-size:30px;font-weight:800;color:${d.balance > 0 ? "var(--red)" : "var(--green-dark)"};letter-spacing:-.5px">${fmtMoney(Math.max(0, d.balance))}</div>
            <span class="badge ${d.balance <= 0 ? "b-green" : pct >= 60 ? "b-amber" : "b-red"}" style="margin-top:4px">
              ${d.balance <= 0 ? "✓ All cleared" : pct >= 60 ? "Mostly paid" : "Balance due"}</span>
          </div>
          <div style="flex:1;min-width:200px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--slate);margin-bottom:6px">
              <span>Paid ${fmtMoney(d.total_paid)} of ${fmtMoney(d.total_billed)}</span><b>${pct}%</b>
            </div>
            <div class="progress ${pct >= 100 ? "" : pct >= 60 ? "amber" : "red"}" style="height:12px"><div style="width:${Math.min(100, pct)}%"></div></div>
          </div>
        </div>
        <div class="section-title">Per-term breakdown</div>
        <div class="table-wrap"><table class="tbl" style="min-width:0">
          <thead><tr><th>Term</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th><th style="min-width:130px">Payment progress</th></tr></thead>
          <tbody>
            ${perTerm.map(t => `
              <tr>
                <td><b>${esc(t.term)}</b></td>
                <td class="num">${fmtMoney(t.billed)}</td>
                <td class="num" style="color:var(--green-dark)">${fmtMoney(t.paid)}</td>
                <td class="num"><b style="color:${t.balance > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(Math.max(0, t.balance))}</b></td>
                <td><div class="progress ${t.pct >= 100 ? "" : t.pct >= 60 ? "amber" : "red"}"><div style="width:${Math.min(100, t.pct)}%"></div></div>
                  <small style="color:var(--muted)">${t.pct}% paid</small></td>
              </tr>`).join("") || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No billing set</td></tr>'}
          </tbody></table></div>
      </div>
      <div>
        <div class="card" style="border-color:var(--green-100);box-shadow:none;margin:0">
          <div class="card-head"><h3>Pay via M-PESA</h3><p>Simulated STK push</p></div>
          ${d.balance > 0 ? `
          <p style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Clear the balance of <b style="color:var(--red)">${fmtMoney(Math.max(0, d.balance))}</b> for ${esc(st.first_name)}.</p>
          <div class="form-grid" style="grid-template-columns:1fr">
            <div><label>Amount (${esc(state.settings.currency || "KSh")})</label><input id="gp-amount" class="input" type="number" min="100" step="100" value="${Math.max(100, Math.round(Math.max(0, d.balance)))}"></div>
            <div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:2px">
                <input type="checkbox" id="gp-split" style="accent-color:var(--green);width:16px;height:16px" checked>
                <span style="font-weight:600">Split across fees &amp; transport automatically</span>
              </label>
              <small style="color:var(--muted);display:block;margin-top:3px">Applied to the oldest outstanding term first.</small>
            </div>
            <div id="gp-type-wrap"><label>Payment type (if not splitting)</label>
              <select id="gp-type" class="input" disabled>
                ${(await api("/api/payment-types")).filter(t => t.active).map(t => `<option value="${t.id}">${esc(t.name)}${t.default_amount ? " — " + fmtMoney(t.default_amount) : ""}</option>`).join("")}
              </select></div>
            <button class="btn btn-primary" id="gp-pay"><svg><use href="#i-money"/></svg> Pay ${esc(state.settings.currency || "KSh")} via M-PESA</button>
          </div>` : `
          <div style="text-align:center;padding:18px 0">
            <svg style="width:44px;height:44px;color:var(--green)"><use href="#i-check"/></svg>
            <p style="font-size:14px;font-weight:700;color:var(--green-dark);margin-top:8px">All fees are cleared!</p>
            <p style="font-size:12.5px;color:var(--muted)">No outstanding balance for this term.</p>
          </div>`}
          <p style="font-size:11.5px;color:var(--muted);margin-top:8px">In production this connects to the Daraja STK-push API. For this demo the payment is recorded instantly.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h3>Payment history</h3><p>Track every payment and the balance after each one</p></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Date</th><th class="num">Amount</th><th>Applied to</th><th>Method</th><th>Ref</th><th class="num">Balance after</th><th class="num">Receipt</th></tr></thead>
      <tbody>${(() => {
        const grouped = groupReceipts(d.payments).sort((a, b) => (b.date + "").localeCompare(a.date + ""));
        let remain = d.total_billed;
        return grouped.map(g => {
          remain -= g.amount;
          return `<tr>
            <td>${fmtDate(g.date)}</td>
            <td class="num"><b style="color:var(--green-dark)">${fmtMoney(g.amount)}</b></td>
            <td><small>${esc(g.summary)}</small></td>
            <td>${esc(g.method || "—")}</td>
            <td><small>${esc(g.reference || "—")}</small></td>
            <td class="num"><b style="color:${remain > 0 ? "var(--red)" : "var(--green-dark)"}">${fmtMoney(Math.max(0, remain))}</b></td>
            <td><div class="actions"><button class="ic-btn" onclick="showReceipt(${g.id})"><svg><use href="#i-receipt"/></svg></button></div></td>
          </tr>`;
        }).join("") || '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No payments yet</td></tr>';
      })()}
      </tbody></table></div>
  </div>`;
  $("#gp-pay").addEventListener("click", async () => {
    const amount = $("#gp-amount").value;
    if (!amount || Number(amount) <= 0) { toast("Enter an amount", "err"); return; }
    try {
      const autoSplit = $("#gp-split").checked;
      const r = await api("/api/guardian/pay", { method: "POST", body: {
        student_id: gChildId(), amount: Number(amount),
        payment_type_id: autoSplit ? null : (Number($("#gp-type").value) || null),
        auto_split: autoSplit } });
      toast(r.split ? "Payment successful — split across " + r.parts + " item" + (r.parts > 1 ? "s" : "") + " · " + r.receipt_no : "Payment successful — " + r.receipt_no);
      showReceipt(r.id);
      openView("gfees");
    } catch (err) { toast(err.message, "err"); }
  });
  const gsplit = $("#gp-split");
  if (gsplit) {
    const gtw = $("#gp-type-wrap");
    const sync = () => { if (gtw) gtw.style.opacity = gsplit.checked ? ".45" : "1"; const gt = $("#gp-type"); if (gt) gt.disabled = gsplit.checked; };
    gsplit.addEventListener("change", sync); sync();
  }
  bindGChild("gfees");
}

async function view_gtransport(el) {
  el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading…</p></div>';
  const kids = await gChildren();
  if (!kids.length) { el.innerHTML = emptyState("No children linked", "Contact the school office to link your account."); return; }
  await gChildSwitcher(el);
  const d = await api(`/api/guardian/transport?student_id=${gChildId()}`);
  const r = d.route;
  el.innerHTML = `
  ${await gChildSwitcher(el)}
  ${r ? `
  <div class="grid-2">
    <div class="route-card">
      <div class="card-head" style="margin-bottom:6px"><h4><span class="route-badge"><svg style="width:16px;height:16px"><use href="#i-bus"/></svg></span> ${esc(r.name)}</h4>
        <span class="badge b-green">${esc(r.status)}</span></div>
      <div class="rsub">${esc(r.route_no || "")} · Driver: ${esc(r.driver_name || "—")} · ${esc(r.driver_phone || "")}</div>
      <div class="rrow"><span>Morning pickup</span><b>${esc(r.morning_time || "—")}</b></div>
      <div class="rrow"><span>Evening drop-off</span><b>${esc(r.evening_time || "—")}</b></div>
      <div class="rrow"><span>Transport fee (per term)</span><b style="color:var(--green-dark)">${fmtMoney(r.fee)}</b></div>
      <div class="rrow"><span>Route status</span><b>${esc(r.status || "Active")}</b></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Boarding record</h3><p>Last ${d.logs.length} entries</p></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Date</th><th>Period</th><th>Status</th></tr></thead>
        <tbody>${d.logs.map(l => `<tr>
          <td>${fmtDate(l.date)}</td><td>${esc(l.period)}</td>
          <td><span class="badge ${l.status === "Boarded" ? "b-green" : l.status === "Not Boarded" ? "b-red" : "b-amber"}">${esc(l.status)}</span></td>
        </tr>`).join("") || '<tr><td colspan="3" style="text-align:center;color:var(--muted)">No boarding records yet</td></tr>'}
        </tbody></table></div>
    </div>
  </div>`
  : `<div class="empty"><svg><use href="#i-bus"/></svg><p><b>Not on school transport</b></p><p style="font-size:12.5px;color:var(--muted);margin-top:4px">This child is not assigned to any bus route. Contact the transport office to enrol.</p></div>`}`;
  bindGChild("gtransport");
}

async function view_gattendance(el) {
  el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading…</p></div>';
  const kids = await gChildren();
  if (!kids.length) { el.innerHTML = emptyState("No children linked", "Contact the school office to link your account."); return; }
  await gChildSwitcher(el);
  const d = await api(`/api/guardian/attendance?student_id=${gChildId()}`);
  el.innerHTML = `
  ${await gChildSwitcher(el)}
  <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
    ${statCard("green", "i-calendar", d.rate + "%", "Attendance rate", "last " + d.total + " school days")}
    ${statCard("blue", "i-calendar", d.counts.Present + d.counts.Late + d.counts.Permission, "Days in school", d.counts.Present + " present · " + d.counts.Late + " late")}
    ${statCard("red", "i-calendar", d.counts.Absent, "Absences", d.counts.Permission + " excused")}
  </div>
  <div class="card"><div id="g-att-chart"></div></div>
  <div class="table-wrap" style="margin-top:16px"><table class="tbl">
    <thead><tr><th>Date</th><th>Status</th></tr></thead>
    <tbody>${d.days.map(x => `<tr>
      <td>${fmtDate(x.date)}</td>
      <td><span class="badge ${x.status === "Present" ? "b-green" : x.status === "Absent" ? "b-red" : x.status === "Late" ? "b-amber" : "b-blue"}">${esc(x.status)}</span></td>
    </tr>`).join("") || '<tr><td colspan="2" style="text-align:center;color:var(--muted)">No attendance records yet</td></tr>'}
    </tbody></table></div>`;
  vbarChart($("#g-att-chart"), d.days.map(x => ({ label: fmtDate(x.date).slice(0, 6), value: x.status === "Present" ? 1 : x.status === "Late" ? 1 : x.status === "Permission" ? 1 : 0, color: x.status === "Absent" ? "#ef4444" : "#16a34a" })), { height: 180, valueFmt: n => n });
  bindGChild("gattendance");
}

async function view_gannounce(el) {
  el.innerHTML = '<div class="loader"><div class="spinner"></div><p>Loading…</p></div>';
  const ann = await api("/api/announcements");
  el.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>Announcements</h3><p>From ${esc(state.settings.school_name || "the school")}</p></div>
    <div class="ann-list">
      ${ann.map(a => `
        <div class="ann-item">
          <h4>${esc(a.title)}</h4>
          <div class="meta"><span class="badge ${a.audience === "Parents" ? "b-blue" : "b-violet"}">${esc(a.audience)}</span>
            <span>${esc(a.created_by || "Admin")}</span><span>${fmtDate(a.created_at)}</span></div>
          <p>${esc(a.message)}</p>
        </div>`).join("") || '<div class="empty">No announcements</div>'}
    </div>
  </div>`;
}

/* ============================================================
   SETTINGS (School / Appearance / Users / Gateway)
   ============================================================ */
async function view_settings(el) {
  const s = state.settings || {};
  el.innerHTML = `
  <div class="tab-row">
    <button class="tab-btn active" id="st-tab-school">School</button>
    <button class="tab-btn" id="st-tab-app">Appearance</button>
    <button class="tab-btn" id="st-tab-users">Users</button>
    <button class="tab-btn" id="st-tab-gateway">SMS Gateway</button>
  </div>
  <div id="st-body"></div>`;
  const tabs = { school: settingsSchool, app: settingsAppearance, users: settingsUsers, gateway: settingsGateway };
  const setTab = (name) => {
    $$(".tab-btn").forEach(b => b.classList.remove("active"));
    $("#st-tab-" + name).classList.add("active");
    tabs[name]();
  };
  $("#st-tab-school").addEventListener("click", () => setTab("school"));
  $("#st-tab-app").addEventListener("click", () => setTab("app"));
  $("#st-tab-users").addEventListener("click", () => setTab("users"));
  $("#st-tab-gateway").addEventListener("click", () => setTab("gateway"));
  settingsSchool();
}
function settingsSchool() {
  const s = state.settings || {};
  $("#st-body").innerHTML = `
  <div class="card" style="max-width:760px">
    <div class="card-head"><h3>School information</h3><p>Shown on the dashboard, login screen and report cards</p></div>
    <div class="form-grid">
      <div class="full"><label>School logo</label>
        <div class="avatar-uploader">
          <div class="logo-preview"><img id="logo-img" src="${esc(s.school_logo || "")}" style="display:${s.school_logo ? "" : "none"}" alt=""></div>
          <div class="meta">
            <input type="file" id="logo-file" accept="image/*" hidden>
            <button class="btn btn-outline btn-sm" id="logo-btn" type="button"><svg><use href="#i-upload"/></svg> Upload logo</button>
            <small>Used on report cards and the login screen</small>
          </div>
        </div>
      </div>
      <div class="full"><label>School Name</label><input id="set-name" class="input" value="${esc(s.school_name || "")}"></div>
      <div class="full"><label>Motto</label><input id="set-motto" class="input" value="${esc(s.school_motto || "")}"></div>
      <div class="full"><label>Address</label><input id="set-addr" class="input" value="${esc(s.school_address || "")}"></div>
      <div><label>Phone</label><input id="set-phone" class="input" value="${esc(s.school_phone || "")}"></div>
      <div><label>Email</label><input id="set-email" class="input" value="${esc(s.school_email || "")}"></div>
      <div><label>Academic Year</label><input id="set-year" class="input" value="${esc(s.academic_year || "2026")}"></div>
      <div><label>Current Term</label><select id="set-term" class="input">
        ${["Term 1", "Term 2", "Term 3"].map(t => `<option ${s.current_term === t ? "selected" : ""}>${t}</option>`).join("")}
      </select></div>
      <div><label>Term start date</label><input id="set-tstart" class="input" type="date" value="${esc(s.term_start || "")}"></div>
      <div><label>Term end date</label><input id="set-tend" class="input" type="date" value="${esc(s.term_end || "")}"></div>
      <div><label>Currency</label><input id="set-cur" class="input" value="${esc(s.currency || "KSh")}"></div>
    </div>
    <div style="margin-top:16px"><button class="btn btn-primary" id="set-save">Save School Information</button></div>
  </div>`;
  $("#logo-btn").addEventListener("click", () => $("#logo-file").click());
  $("#logo-file").addEventListener("change", () => {
    const f = $("#logo-file").files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const path = await uploadPic("school", 0, reader.result);
        await api("/api/settings", { method: "PUT", body: { school_logo: path } });
        state.settings = await api("/api/settings");
        applyAppearance();
        $("#logo-img").src = path; $("#logo-img").style.display = "";
        toast("School logo updated");
      } catch (err) { toast(err.message, "err"); }
    };
    reader.readAsDataURL(f);
  });
  $("#set-save").addEventListener("click", async () => {
    await api("/api/settings", { method: "PUT", body: {
      school_name: $("#set-name").value, school_motto: $("#set-motto").value,
      school_address: $("#set-addr").value, school_phone: $("#set-phone").value,
      school_email: $("#set-email").value, academic_year: $("#set-year").value,
      current_term: $("#set-term").value, term_start: $("#set-tstart").value,
      term_end: $("#set-tend").value, currency: $("#set-cur").value } });
    state.settings = await api("/api/settings");
    $("#sidebar-school").textContent = state.settings.school_name;
    $("#term-badge").textContent = state.settings.current_term + " · " + state.settings.academic_year;
    toast("School information saved");
  });
}
function settingsAppearance() {
  const s = state.settings || {};
  const curTheme = THEMES[s.theme] ? s.theme : "emerald";
  const curFont = FONTS[s.font_family] ? s.font_family : "modern";
  const curSize = FONT_SIZES[s.font_size] ? s.font_size : "medium";
  $("#st-body").innerHTML = `
  <div class="card" style="max-width:860px">
    <div class="card-head"><h3><svg><use href="#i-palette"/></svg> Colour theme &amp; wallpaper</h3><p>Applied instantly for every user</p></div>
    <div class="theme-grid">
      ${Object.keys(THEMES).map(k => `
        <div class="theme-card ${curTheme === k ? "on" : ""}" data-theme="${k}" onclick="applyThemePick('${k}')">
          <div class="swatch" style="background:${THEMES[k].sidebar}"><span style="color:${THEMES[k].primary};background:#fff;border-radius:6px;padding:1px 7px">Aa</span></div>
          <div class="tname">${esc(THEMES[k].name)}</div>
        </div>`).join("")}
    </div>
  </div>
  <div class="card" style="max-width:860px;margin-top:18px">
    <div class="card-head"><h3><svg><use href="#i-book"/></svg> Typography</h3><p>Font family and base size</p></div>
    <div class="kgrid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      ${Object.keys(FONTS).map(k => `
        <div class="font-pill ${curFont === k ? "on" : ""}" onclick="applyFontPick('${k}')">
          <div class="preview" style="font-family:${FONTS[k].stack}">Aa Bb 123</div>
          <div class="fname">${esc(FONTS[k].name)}</div>
        </div>`).join("")}
    </div>
    <div class="section-title">Base font size</div>
    <div class="kgrid" style="grid-template-columns:repeat(3,1fr);max-width:420px">
      ${Object.keys(FONT_SIZES).map(k => `
        <div class="font-pill ${curSize === k ? "on" : ""}" onclick="applySizePick('${k}')">
          <div class="preview" style="font-size:${FONT_SIZES[k]}">${k === "small" ? "Small" : k === "medium" ? "Medium" : "Large"}</div>
          <div class="fname">${esc(k)}</div>
        </div>`).join("")}
    </div>
  </div>`;
}
async function applyThemePick(key) {
  await api("/api/settings", { method: "PUT", body: { theme: key } });
  state.settings = await api("/api/settings");
  applyAppearance();
  $$(".theme-card").forEach(c => c.classList.toggle("on", c.dataset.theme === key));
  toast("Theme applied");
}
async function applyFontPick(key) {
  await api("/api/settings", { method: "PUT", body: { font_family: key } });
  state.settings = await api("/api/settings");
  applyAppearance();
  $$(".font-pill").forEach(c => c.classList.remove("on"));
  toast("Font applied");
}
async function applySizePick(key) {
  await api("/api/settings", { method: "PUT", body: { font_size: key } });
  state.settings = await api("/api/settings");
  applyAppearance();
  toast("Font size applied");
}
/* ---- shared: searchable multi-student picker (returns container wiring) ---- */
function studentMultiPicker(containerId, selectedIds, label = "Link children") {
  const pick = $(containerId);
  pick.innerHTML = `
    <div class="stu-picker">
      <div class="search-wrap"><svg><use href="#i-search"/></svg>
        <input class="input" id="${containerId}-search" placeholder="Search name or admission no…" autocomplete="off"></div>
      <div id="${containerId}-list" class="gu-list"></div>
    </div>
    <p id="${containerId}-count" style="font-size:12px;color:var(--muted);margin-top:6px"></p>`;
  const sel = new Set(selectedIds || []);
  const listEl = $(containerId + "-list");
  const countEl = $(containerId + "-count");
  const updateCount = () => countEl.textContent = sel.size + " student" + (sel.size === 1 ? "" : "s") + " linked — they will share one portal";
  const paint = (rows) => {
    listEl.innerHTML = rows.map(s => `
      <label class="gu-row ${sel.has(s.id) ? "on" : ""}">
        <input type="checkbox" class="gu-check" data-sid="${s.id}" ${sel.has(s.id) ? "checked" : ""}>
        ${avatarHtml(s.profile_pic, s.first_name + " " + s.last_name, "avatar-sm")}
        <div><b>${esc(s.first_name + " " + s.last_name)}</b>
          <small>${esc(s.admission_no)} · ${esc(s.class_name || "unplaced")}</small></div>
      </label>`).join("") || '<p style="padding:10px;color:var(--muted);font-size:12.5px">No students match</p>';
    $$(".gu-check", listEl).forEach(cb => cb.addEventListener("change", () => {
      const sid = Number(cb.dataset.sid);
      if (cb.checked) sel.add(sid); else sel.delete(sid);
      cb.closest(".gu-row").classList.toggle("on", cb.checked);
      updateCount();
    }));
  };
  const filter = () => {
    const q = ($(containerId + "-search").value || "").toLowerCase();
    const rows = window.__guStudents.filter(s =>
      !q || (s.first_name + " " + s.last_name + " " + (s.admission_no || "") + " " + (s.class_name || "")).toLowerCase().includes(q));
    paint(rows);
  };
  $(containerId + "-search").addEventListener("input", filter);
  filter();
  updateCount();
  return sel;
}

async function parentForm() {
  const students = await api("/api/students");
  window.__guStudents = students.filter(s => s.status === "Active");
  modal(`
  <div class="modal-head"><h3>Add Parent</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Parent / Guardian Name *</label><input id="p-name" class="input" placeholder="e.g. Mary Moraa"></div>
    <div><label>Phone number (login username) *</label><input id="p-user" class="input" placeholder="0712 345 678"></div>
    <div><label>Password *</label><input id="p-pass" class="input" value="parent123" placeholder="temporary password"></div>
    <div></div>
    <div class="full"><label>Linked children — one portal, all their details</label>
      <div id="p-children"></div>
    </div>
  </div></div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="p-save"><svg><use href="#i-plus"/></svg> Create Parent</button>
  </div>`);
  const sel = studentMultiPicker("#p-children", [], "Link children");
  $("#p-save").addEventListener("click", async () => {
    const body = {
      full_name: $("#p-name").value.trim(),
      username: ($("#p-user").value || "").replace(/[^0-9]/g, ""),
      password: $("#p-pass").value || "parent123",
      role: "guardian",
      student_ids: [...sel],
    };
    if (!body.full_name) { toast("Parent name required", "err"); return; }
    if (!body.username) { toast("Phone number required (used to log in)", "err"); return; }
    if (sel.size === 0) { toast("Link at least one child", "err"); return; }
    try {
      await api("/api/users", { method: "POST", body });
      toast("Parent created — they can log in with " + body.username + " and view " + sel.size + " child" + (sel.size > 1 ? "ren" : ""));
      closeModal(); settingsUsers(true);
    } catch (err) { toast(err.message, "err"); }
  });
}

async function manageParentChildren(uid) {
  const [users, students] = await Promise.all([api("/api/users"), api("/api/students")]);
  const u = users.find(x => x.id === uid);
  if (!u) return;
  window.__guStudents = students.filter(s => s.status === "Active");
  modal(`
  <div class="modal-head"><h3>Manage children — ${esc(u.full_name)}</h3>
    <p style="font-size:12px;color:var(--muted)">${esc(u.username)}</p>
    <button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <p style="font-size:12.5px;color:var(--slate);margin-bottom:10px">Tick the students this parent should see in their portal. Two or more children share the same login, with a child switcher to view each one.</p>
    <div id="m-children"></div>
  </div>
  <div class="modal-foot">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="m-save"><svg><use href="#i-download"/></svg> Save Children</button>
  </div>`);
  const links = await api("/api/users/" + uid + "/children");
  const currentIds = links.map(l => l.id);
  const sel = studentMultiPicker("#m-children", currentIds, "Link children");
  $("#m-save").addEventListener("click", async () => {
    try {
      await api("/api/users/" + uid, { method: "PUT", body: { student_ids: [...sel] } });
      toast("Saved — " + sel.size + " child" + (sel.size === 1 ? "" : "ren") + " linked");
      closeModal(); settingsUsers(true);
    } catch (err) { toast(err.message, "err"); }
  });
}

async function settingsUsers(showParents) {
  const users = await api("/api/users");
  const staff = users.filter(u => u.role !== "guardian");
  const parents = users.filter(u => u.role === "guardian");
  const shown = showParents ? parents : staff;
  const roleBadge = (r) => r === "admin" ? '<span class="badge b-admin">Administrator</span>'
    : r === "teacher" ? '<span class="badge b-teacher">Teacher</span>'
    : r === "accounts" ? '<span class="badge b-accounts">Accounts</span>'
    : '<span class="badge b-slate">Parent</span>';
  $("#st-body").innerHTML = `
  <div class="toolbar">
    <p style="color:var(--muted)">${staff.length} staff accounts · ${parents.length} parent accounts</p>
    <select class="input" id="usr-filter" style="min-width:160px">
      <option value="staff" ${showParents ? "" : "selected"}>Staff accounts</option>
      <option value="parents" ${showParents ? "selected" : ""}>Parent accounts</option>
    </select>
    <div class="search-wrap"><svg><use href="#i-search"/></svg>
      <input class="input" id="usr-search" placeholder="Search by name, username…" style="min-width:200px"></div>
    <div class="grow"></div>
    ${showParents
      ? '<button class="btn btn-primary" onclick="parentForm()"><svg><use href="#i-plus"/></svg> Add Parent</button>'
      : '<button class="btn btn-primary" onclick="userForm()"><svg><use href="#i-plus"/></svg> Add User</button>'}
  </div>
  <div class="table-wrap"><table class="tbl">
    <thead><tr><th>User</th><th>Username</th><th>Role</th>${showParents ? '<th class="num">Children</th>' : ""}<th>Status</th><th class="num">Actions</th></tr></thead>
    <tbody id="usr-body">
      ${shown.map(u => usrRowHtml(u, showParents)).join("")}
    </tbody></table></div>
    <p id="usr-count" style="font-size:12px;color:var(--muted);margin-top:10px">${shown.length} account${shown.length === 1 ? "" : "s"}</p>
    <p style="font-size:12px;color:var(--muted);margin-top:6px">
      ${showParents
        ? "Parents are created automatically from student records (username = phone number) or added manually here. Link two or more children to one parent and they share the same portal, with a child switcher to view each child."
        : "<b>Administrator</b> — full access · <b>Teacher</b> — academics, marks, attendance · <b>Accounts</b> — finance &amp; fee management only."}</p>`;
  const flt = $("#usr-filter");
  if (flt) flt.addEventListener("change", e => settingsUsers(e.target.value === "parents"));
  // live search
  const search = $("#usr-search");
  if (search) search.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const rows = shown.filter(u =>
      (u.full_name + " " + u.username).toLowerCase().includes(q));
    $("#usr-body").innerHTML = rows.map(u => usrRowHtml(u, showParents)).join("");
    $("#usr-count").textContent = rows.length + " account" + (rows.length === 1 ? "" : "s");
  });
  $$(".switch").forEach(b => b.addEventListener("click", async () => {
    const active = b.dataset.active === "1" ? 0 : 1;
    await api("/api/users/" + b.dataset.id, { method: "PUT", body: { active } });
    toast(active ? "Account activated" : "Account deactivated");
    settingsUsers(showParents);
  }));
}
function usrRowHtml(u, showParents) {
  return `<tr>
    <td>${avatarHtml(u.profile_pic, u.full_name, "avatar-sm")}<b style="margin-left:8px">${esc(u.full_name)}</b></td>
    <td><code>${esc(u.username)}</code></td>
    <td>${u.role === "admin" ? '<span class="badge b-admin">Administrator</span>'
      : u.role === "teacher" ? '<span class="badge b-teacher">Teacher</span>'
      : u.role === "accounts" ? '<span class="badge b-accounts">Accounts</span>'
      : '<span class="badge b-slate">Parent</span>'}</td>
    ${showParents ? `<td class="num"><span class="badge ${u.child_count > 1 ? "b-blue" : "b-slate"}">${u.child_count || 0} child${u.child_count === 1 ? "" : "ren"}</span></td>` : ""}
    <td><button class="switch ${u.active ? "on" : ""}" data-id="${u.id}" data-active="${u.active}" title="Toggle active"></button></td>
    <td><div class="actions">
      <button class="ic-btn" title="Reset password" onclick="resetPwd(${u.id},'${esc(u.username)}')"><svg><use href="#i-key"/></svg></button>
      ${u.role === "guardian"
        ? `<button class="ic-btn" title="Manage children" onclick="manageParentChildren(${u.id})"><svg><use href="#i-users"/></svg></button>`
        : `<button class="ic-btn" title="Edit role" onclick="editUser(${u.id})"><svg><use href="#i-edit"/></svg></button>`}
    </div></td>
  </tr>`;
}
async function userForm() {
  modal(`
  <div class="modal-head"><h3>Add User</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Full Name *</label><input id="u-name" class="input" placeholder="e.g. Mary Moraa"></div>
    <div><label>Username *</label><input id="u-user" class="input" placeholder="mmoraa"></div>
    <div><label>Role</label><select id="u-role" class="input">
      <option value="teacher">Teacher</option><option value="accounts">Accounts</option><option value="admin">Administrator</option>
    </select></div>
    <div><label>Password *</label><input id="u-pass" class="input" type="text" placeholder="temporary password"></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="u-save">Create User</button></div>`);
  $("#u-save").addEventListener("click", async () => {
    const body = { full_name: $("#u-name").value.trim(), username: $("#u-user").value.trim(),
      role: $("#u-role").value, password: $("#u-pass").value };
    if (!body.full_name || !body.username || !body.password) { toast("All fields required", "err"); return; }
    try {
      await api("/api/users", { method: "POST", body });
      toast("User created"); closeModal(); settingsUsers();
    } catch (err) { toast(err.message, "err"); }
  });
}
async function resetPwd(id, username) {
  modal(`
  <div class="modal-head"><h3>Reset password — ${esc(username)}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body">
    <label style="font-size:12.5px;font-weight:600;color:var(--slate)">New password</label>
    <input id="np" class="input" type="text" style="margin-top:6px" placeholder="enter new password">
  </div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="np-save">Reset Password</button></div>`);
  $("#np-save").addEventListener("click", async () => {
    const p = $("#np").value.trim();
    if (!p) { toast("Enter a password", "err"); return; }
    await api("/api/users/" + id + "/password", { method: "PUT", body: { password: p } });
    toast("Password reset for " + username); closeModal();
  });
}
async function editUser(id) {
  const users = await api("/api/users");
  const u = users.find(x => x.id === id);
  modal(`
  <div class="modal-head"><h3>Edit user — ${esc(u.username)}</h3><button class="ic-btn" onclick="closeModal()"><svg><use href="#i-close"/></svg></button></div>
  <div class="modal-body"><div class="form-grid">
    <div><label>Full name</label><input id="e-name" class="input" value="${esc(u.full_name)}"></div>
    <div><label>Role</label><select id="e-role" class="input">
      ${["teacher", "accounts", "admin"].map(r => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r === "admin" ? "Administrator" : r === "teacher" ? "Teacher" : "Accounts"}</option>`).join("")}
    </select></div>
  </div></div>
  <div class="modal-foot"><button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="e-save">Save</button></div>`);
  $("#e-save").addEventListener("click", async () => {
    await api("/api/users/" + id, { method: "PUT", body: { full_name: $("#e-name").value.trim(), role: $("#e-role").value } });
    toast("User updated"); closeModal(); settingsUsers();
  });
}
function settingsGateway() {
  const s = state.settings || {};
  $("#st-body").innerHTML = `
  <div class="card" style="max-width:640px">
    <div class="card-head"><h3>SMS gateway</h3><p>Provider used for fee reminders and announcements</p></div>
    <div class="form-grid">
      <div><label>Provider</label><select id="g-provider" class="input">
        <option ${s.sms_provider === "Africa's Talking" ? "selected" : ""}>Africa's Talking</option>
        <option ${s.sms_provider === "Daraja (Safaricom)" ? "selected" : ""}>Daraja (Safaricom)</option>
        <option ${s.sms_provider === "Twilio" ? "selected" : ""}>Twilio</option>
        <option ${s.sms_provider === "Infobip" ? "selected" : ""}>Infobip</option>
      </select></div>
      <div><label>Status</label><input class="input" value="Connected (sandbox)" disabled></div>
      <div><label>API key</label><input id="g-key" class="input" type="password" placeholder="••••••••••••"></div>
      <div><label>Sender ID</label><input id="g-sender" class="input" value="ELIMUPRO"></div>
    </div>
    <p style="font-size:12px;color:var(--muted);margin-top:12px">Messages are queued through the configured gateway and logged in the Message centre. Connect a live API key in production.</p>
    <div style="margin-top:14px"><button class="btn btn-primary" id="g-save">Save Gateway Settings</button></div>
  </div>`;
  $("#g-save").addEventListener("click", async () => {
    await api("/api/settings", { method: "PUT", body: { sms_provider: $("#g-provider").value } });
    state.settings = await api("/api/settings");
    toast("Gateway settings saved");
  });
}

/* ============================================================
   BOOT
   ============================================================ */
boot();
