const CACHE_NAME = 'madrasati-cache-v6';
const urlsToCache = [
  '/',
  '/app',
  '/manifest.json',
  '/logo.png',
  '/icon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache).catch(err => {
        console.warn('Cache addAll warning:', err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // APIs do not cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Cache-First strategy with Network fallback for static and app resources
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const respClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
          }
          return networkResponse;
        })
        .catch(err => {
          // If offline, try serving fallback cached /app or /
          if (event.request.mode === 'navigate' || event.request.destination === 'document') {
            return caches.match('/app').then(appCached => appCached || caches.match('/'));
          }
          return null;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
