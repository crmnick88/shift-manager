const CACHE_NAME = "shift-manager-v2";

// שים לב: ב-GitHub Pages האתר יושב בתוך /shift-manager/
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // במקום addAll (שנופל אם קובץ אחד נכשל) – מוסיפים אחד אחד
      for (const url of ASSETS) {
        try {
          const res = await fetch(url, { cache: "no-cache" });
          if (res.ok) {
            await cache.put(url, res.clone());
          } else {
            // אם יש 404 וכו' – פשוט מדלגים
            console.warn("SW: skip caching (bad status)", url, res.status);
          }
        } catch (err) {
          console.warn("SW: skip caching (fetch failed)", url, err);
        }
      }

      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
