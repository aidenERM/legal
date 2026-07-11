// Minimal service worker for CHP Dashboard PWA support.
// Bump CACHE_NAME manually whenever the app shell changes.
const CACHE_NAME = "chp-dashboard-shell-v1";
const API_ORIGIN = "https://chp-dashboard-api.aidenspearb.workers.dev";

const SHELL_ASSETS = [
  "app.html",
  "app.css",
  "app.js",
  "manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API requests - those must always hit the network live.
  if (url.origin === API_ORIGIN) {
    return;
  }

  // Cache-first for the app shell, network-first fallback for everything else.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
