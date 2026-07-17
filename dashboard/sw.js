// Minimal service worker for CHP Dashboard PWA support.
// Bump CACHE_NAME manually whenever the app shell changes.
const CACHE_NAME = "chp-dashboard-shell-v27";
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
  // Bug fix: without this, an updated service worker sits "waiting" until
  // every open tab of the dashboard is closed - since this is the kind of
  // page people leave open for a whole shift, a real deploy could sit
  // uninstalled for hours/days on a desktop browser while a phone (opening
  // fresh) got the new version immediately. Forces the new worker to take
  // over right away instead of waiting.
  self.skipWaiting();
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

  // Bug fix: this used to be cache-first, which meant app.html/app.css/
  // app.js - once cached on a given browser - stayed served from that
  // cache FOREVER, since caches.match() on an unversioned URL like
  // "app.html" doesn't know or care that a new deploy exists. A desktop
  // browser that had visited the dashboard before a change shipped would
  // keep showing the old version indefinitely (this is exactly what
  // happened with the banner feature: it worked on a phone that had never
  // cached the old shell, but not on a desktop that had). Network-first
  // means every load tries the live version first, and only falls back to
  // the cached copy if the network request actually fails (offline) - the
  // whole reason a service worker exists here is offline resilience, not
  // to freeze the app at whatever it looked like on first visit.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
