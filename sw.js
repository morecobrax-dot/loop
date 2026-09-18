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
const CACHE_VERSION = 'loop-v167';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

/* D88 — an install that could not fill its cache must FAIL. The catch here used
 * to swallow the error and call skipWaiting() anyway, so the install resolved
 * with an empty cache, activate ran, and activate unconditionally deletes every
 * other version. One dropped request during a deploy was enough to delete a
 * working offline copy and replace it with nothing — the app was offline-capable
 * yesterday and simply is not today. Letting the promise reject leaves the old
 * worker, and the old cache, in charge until an install genuinely succeeds. */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
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
      /* D88 — the app-shell fallback is for NAVIGATIONS only. It used to answer
       * any uncached request, so an <img> requested for the first time while
       * offline received a 200 whose body was the whole of index.html: an image
       * that cannot decode, and for anything parsed as JSON or JS, a syntax
       * error instead of an honest network failure. Static assets are cached by
       * this handler on first use by design, so being offline before that first
       * use is a real state, not an edge case. */
      .catch(() => caches.match(req).then(hit => {
        if(hit) return hit;
        if(req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
