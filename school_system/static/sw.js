/* ============================================================
   ElimuPro — Service Worker (offline support)
   - Pre-caches the app shell so the UI loads with no network
   - API GET responses are cached (network-first, cache fallback),
     keyed per user so one account's data never leaks to another
   - When back online the app auto-syncs queued changes
   ============================================================ */
"use strict";
const CACHE = "elimupro-v11";
const SHELL = [
  "/",
  "/static/css/style.css",
  "/static/js/app.js",
  "/static/sw.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => { /* some items may be unavailable offline — fine */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* tiny stable hash for scoping cache keys by Authorization header */
function hash(str) {
  let x = 0;
  for (let i = 0; i < str.length; i++) { x = (x << 5) - x + str.charCodeAt(i); x |= 0; }
  return (x >>> 0).toString(36);
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // external — leave alone
  if (e.request.method !== "GET") return;              // writes handled by the sync queue

  // ---- API GETs: network-first, fall back to the last-good cached copy ----
  if (url.pathname.startsWith("/api/")) {
    const auth = e.request.headers.get("Authorization") || "";
    const key = url.pathname + url.search + "::" + hash(auth);
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(key, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(key).then((cached) =>
            cached ||
            new Response(JSON.stringify({ error: "offline" }), {
              status: 503, headers: { "Content-Type": "application/json" },
            })
          )
        )
    );
    return;
  }

  // ---- static assets: cache-first, then network ----
  if (url.pathname.startsWith("/static/")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
          return res;
        });
      })
    );
    return;
  }
});
