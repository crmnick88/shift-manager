/* service-worker.js */
const CACHE_VERSION = "v4"; // <-- כל פעם שאתה משנה קוד, תעלה ל-v5, v6...
const CACHE_NAME = `shift-pwa-${CACHE_VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("shift-pwa-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Network-first ל-HTML כדי שלא "יתקע" על קוד ישן
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // רק על אותו origin
  if (url.origin !== location.origin) return;

  // HTML: תמיד לנסות רשת קודם
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // שאר הקבצים: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});
