const CACHE_NAME = 'safetylink-v2';
const ASSETS = [
  '/Safety-Link-/',
  '/Safety-Link-/index.html',
  '/Safety-Link-/style.css',
  '/Safety-Link-/app.js',
  '/Safety-Link-/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/Safety-Link-/index.html');
        }
      });
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-emergency-telemetry') {
    console.log('[SW] Flushing emergency telemetry packets upstream.');
  }
});
