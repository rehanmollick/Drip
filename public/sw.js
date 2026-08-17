/* drip service worker — hand-written, no workbox, no external requests.
 *
 * shell    (/, /offline.html, /manifest.webmanifest): precached, refreshed network-first
 * static   (/_next/static, /icons): cache-first, immutable by name
 * session  (GET /api/sessions…, /s/:id documents): network-first with cache fallback,
 *          so the shell + everything you've scrolled stays readable offline (spec §12.7)
 * everything else: network only. Non-GET is never cached.
 *
 * Client-side navigation into a session never fetches /s/:id as a document
 * (Next uses RSC fetches), so the page tells us which session is open
 * ({type:"CACHE_SESSION", id}) and we snapshot the server-rendered document +
 * session JSON ourselves; the document carries the cards up to position+runway
 * (app/s/[id]/page.tsx), so an offline reload/relaunch replays what you saw.
 *
 * Storage is bounded: session entries are kept for the SESSION_KEEP most
 * recently used sessions only, pruned on every touch and when a session is
 * deleted (DELETE /api/sessions/:id observed on the wire).
 */
const VERSION = "v2";
const SHELL_CACHE = "drip-shell-" + VERSION;
const STATIC_CACHE = "drip-static-" + VERSION;
const SESSION_CACHE = "drip-session-" + VERSION;
const CACHES = [SHELL_CACHE, STATIC_CACHE, SESSION_CACHE];
const OFFLINE_URL = "/offline.html";
const SHELL = ["/", OFFLINE_URL, "/manifest.webmanifest"];
const SESSION_KEEP = 6;
const LRU_KEY = "/__drip/session-lru";
const SESSION_API = /^\/api\/sessions(?:\/([^/]+)(?:\/cards)?)?$/;
const SESSION_PAGE = /^\/s\/([^/]+)\/?$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  else if (data.type === "CACHE_SESSION" && typeof data.id === "string") {
    const p = snapshotSession(data.id);
    if (event.waitUntil) event.waitUntil(p);
  } else if (data.type === "SESSION_DELETED" && typeof data.id === "string") {
    const p = forgetSession(data.id);
    if (event.waitUntil) event.waitUntil(p);
  }
});

/** "navigate" | "static" | "session" | "network" */
function classify(url, mode) {
  if (mode === "navigate") return "navigate";
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) return "static";
  if (SESSION_API.test(url.pathname)) return "session";
  return "network";
}

/** Session id a request belongs to (api or document), else null. */
function sessionIdOf(pathname) {
  const api = SESSION_API.exec(pathname);
  if (api && api[1]) return api[1];
  const page = SESSION_PAGE.exec(pathname);
  return page ? page[1] : null;
}

/** Cache key for a session document: pathname only (drop ?from=… etc). */
function docKey(url) {
  return url.origin + url.pathname;
}

async function networkFirst(request, cacheName, { key, fallback } = {}) {
  const cache = await caches.open(cacheName);
  const cacheKey = key || request;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(cacheKey, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    if (fallback) {
      const fb = await caches.match(fallback);
      if (fb) return fb;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

// ── session snapshots + bounded storage ─────────────────────────────────────

async function readLru(cache) {
  try {
    const res = await cache.match(LRU_KEY);
    if (!res) return [];
    const list = await res.json();
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writeLru(cache, list) {
  await cache.put(LRU_KEY, new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }));
}

/** Delete every cached entry (document + api pages) that belongs to a session id. */
async function deleteSessionEntries(cache, id) {
  const keys = await cache.keys();
  await Promise.all(
    keys.map((req) => {
      const u = new URL(req.url);
      return sessionIdOf(u.pathname) === id ? cache.delete(req) : Promise.resolve(false);
    }),
  );
}

/** Mark a session as recently used; evict the least-recent ones past SESSION_KEEP. Debounced per SW lifetime. */
const touched = new Map();
async function touchSession(id) {
  const now = Date.now();
  const last = touched.get(id) || 0;
  if (now - last < 30_000) return;
  touched.set(id, now);
  const cache = await caches.open(SESSION_CACHE);
  const lru = await readLru(cache);
  const next = [id].concat(lru.filter((x) => x !== id));
  const evict = next.slice(SESSION_KEEP);
  await writeLru(cache, next.slice(0, SESSION_KEEP));
  evict.forEach((old) => touched.delete(old));
  await Promise.all(evict.map((old) => deleteSessionEntries(cache, old)));
}

async function forgetSession(id) {
  touched.delete(id);
  const cache = await caches.open(SESSION_CACHE);
  const lru = await readLru(cache);
  await writeLru(cache, lru.filter((x) => x !== id));
  await deleteSessionEntries(cache, id);
}

/**
 * Snapshot what an offline reload/relaunch of /s/:id needs: the server-rendered
 * document (session + cards up to position+runway) and the session JSON the
 * page polls. Best-effort; failures are silent (we're just refreshing a copy).
 */
async function snapshotSession(id) {
  if (!/^[\w-]+$/.test(id)) return;
  const cache = await caches.open(SESSION_CACHE);
  const origin = self.location.origin;
  const doc = new Request(origin + "/s/" + id, { headers: { accept: "text/html" }, cache: "no-store", credentials: "same-origin" });
  const api = new Request(origin + "/api/sessions/" + id, { headers: { accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
  await Promise.allSettled([
    fetch(doc).then((res) => {
      if (res && res.ok && (res.headers.get("content-type") || "").includes("text/html")) return cache.put(origin + "/s/" + id, res);
    }),
    fetch(api).then((res) => {
      if (res && res.ok) return cache.put(origin + "/api/sessions/" + id, res);
    }),
  ]);
  await touchSession(id);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET") {
    // a deleted session should not linger offline
    if (request.method === "DELETE") {
      const m = SESSION_API.exec(url.pathname);
      if (m && m[1]) event.waitUntil(forgetSession(m[1]));
    }
    return;
  }
  const kind = classify(url, request.mode);
  if (kind === "navigate") {
    const sid = SESSION_PAGE.exec(url.pathname);
    if (sid) {
      event.respondWith(networkFirst(request, SESSION_CACHE, { key: docKey(url), fallback: OFFLINE_URL }));
      event.waitUntil(touchSession(sid[1]));
    } else {
      event.respondWith(networkFirst(request, SHELL_CACHE, { key: docKey(url), fallback: OFFLINE_URL }));
    }
  } else if (kind === "static") {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (kind === "session") {
    event.respondWith(networkFirst(request, SESSION_CACHE));
    const id = sessionIdOf(url.pathname);
    if (id) event.waitUntil(touchSession(id));
  }
  // "network": let the browser handle it untouched
});
