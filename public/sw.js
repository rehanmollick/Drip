/* drip service worker — hand-written, no workbox, no external requests.
 * shell: network-first with cache + /offline.html fallback
 * static assets (/_next/static, /icons): cache-first
 * session reads (GET /api/sessions…): network-first, cache fallback → viewed cards stay readable offline (spec §12.7)
 * everything else: network only. Non-GET is never cached.
 */
const CACHE = "drip-shell-v1";
const OFFLINE_URL = "/offline.html";
const SHELL = ["/", OFFLINE_URL, "/manifest.webmanifest"];
const SESSION_API = /^\/api\/sessions(?:\/[^/]+(?:\/cards)?)?$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/** "navigate" | "static" | "session" | "network" */
function classify(url, mode) {
  if (mode === "navigate") return "navigate";
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) return "static";
  if (SESSION_API.test(url.pathname)) return "session";
  return "network";
}

async function networkFirst(request, { fallback } = {}) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    if (fallback) {
      const fb = await cache.match(fallback);
      if (fb) return fb;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const kind = classify(url, request.mode);
  if (kind === "navigate") {
    event.respondWith(networkFirst(request, { fallback: OFFLINE_URL }));
  } else if (kind === "static") {
    event.respondWith(cacheFirst(request));
  } else if (kind === "session") {
    event.respondWith(networkFirst(request));
  }
  // "network": let the browser handle it untouched
});
