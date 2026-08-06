// Minimal service worker — exists mainly to satisfy Chrome/Edge's
// installability requirement for "Install app" on desktop, not to cache
// aggressively. This is a live-data CRM (leads/stats change constantly), so
// caching API responses would show stale data — /api/* is always network-only.
// Static assets (JS/CSS/icons) get a network-first strategy with a cache
// fallback, so a brief connectivity drop doesn't break the installed app,
// but a rebuild/redeploy is always picked up on the next successful fetch
// rather than served stale indefinitely.
const CACHE_NAME = "broaddcast-leads-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
