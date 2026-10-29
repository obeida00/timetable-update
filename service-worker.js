const CACHE_NAME = 'madrasati-cache-v12';
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

  // APIs and auth do not cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Network First with Fallback to Cache for Navigation/Documents
  if (event.request.mode === 'navigate' || event.request.destination === 'document' || url.pathname === '/app' || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const respClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              // Always keep clean '/app' cached as master fallback
              cache.put('/app', respClone);
              try { cache.put(event.request, networkResponse.clone()); } catch(e){}
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // OFFLINE: Match exact or fallback to clean /app or /
          const cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          const appCached = await caches.match('/app');
          if (appCached) return appCached;
          const rootCached = await caches.match('/');
          if (rootCached) return rootCached;
          return null;
        })
    );
    return;
  }

  // Cache First with Network Fallback for assets (icons, images, manifest, css, js)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const respClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, respClone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || null);

      return cachedResponse || fetchPromise;
    })
  );
});
