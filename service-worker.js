// Service worker: network-first so new deploys reach players automatically,
// with a cache fallback so the game still works fully offline.
//
// Why network-first? A cache-first worker (the previous version) would keep
// serving the snapshot it captured on the first visit, so pushes never showed
// up. Now we always try the network first, refresh the cache with what we get,
// and only fall back to the cache when offline.
const CACHE = 'connect-four-neon-v29';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/engine.js',
  './js/bot.js',
  './js/solver.js',
  './js/stats.js',
  './js/review.js',
  './js/puzzles.js',
  './js/tactics.js',
  './js/patterns.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Stash a fresh same-origin copy for offline use. The write is fire-and-
        // forget AND must swallow its own failure: `cache.put` rejects when the
        // origin's storage quota is full, and an unhandled rejection there would
        // log an error on every single request from then on. Serving the response
        // matters; refreshing the cache is a bonus.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE)
            .then((cache) => cache.put(req, copy))
            .catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return undefined;
        })
      )
  );
});
