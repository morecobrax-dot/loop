/* LOOP service worker — offline support for gym use (basements, dead zones).
 *
 * IMPORTANT WHEN YOU UPDATE LOOP:
 * Bump CACHE_VERSION below every time you replace index.html. That's what
 * forces phones to pick up the new code instead of serving the cached copy.
 *
 * This only ever caches application CODE. User data lives in localStorage and
 * is never touched by this file — clearing caches here cannot affect a single
 * logged set.
 */
const CACHE_VERSION = 'loop-v91';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Network-first for the app shell so a freshly deployed update is picked up as
 * soon as there's a connection, with the cache as the offline fallback. */
self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  if(new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
