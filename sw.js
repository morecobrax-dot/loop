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
const CACHE_VERSION = 'loop-v200';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

/* D92 — how long a launch waits for the network before opening the copy of LOOP
 * already on the phone. Measured, not picked: the whole shell is about 735 KB
 * gzipped, and on the real worker path it arrived in 1.5 s at 4 Mbps and 2.0 s
 * at 3 Mbps — so a connection an athlete would call working beats this, and a
 * stalled one, which used to hold the app for as long as the browser cared to
 * wait, costs 2.5 seconds instead. */
const SHELL_DEADLINE_MS = 2500;

/* D88 — an install that could not fill its cache must FAIL. The catch here used
 * to swallow the error and call skipWaiting() anyway, so the install resolved
 * with an empty cache, activate ran, and activate unconditionally deletes every
 * other version. One dropped request during a deploy was enough to delete a
 * working offline copy and replace it with nothing — the app was offline-capable
 * yesterday and simply is not today. Letting the promise reject leaves the old
 * worker, and the old cache, in charge until an install genuinely succeeds.
 *
 * D92 — and a new version no longer takes over by itself. It used to call
 * skipWaiting() the moment its cache was full, so it seized pages still running
 * the old code, deleted their cache under them, and nothing ever told the
 * athlete a new LOOP existed. Now it waits: the page offers "LOOP update ready"
 * and the athlete chooses when (LOOP_ACTIVATE, below). A first install has no
 * old version to wait for and activates at once, as before.
 *
 * Each file is fetched past the HTTP cache. Pages sends max-age=600, so a
 * version installed within ten minutes of the last launch could otherwise keep
 * the OLD index.html as its own offline copy. */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
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

/* D92 — the page asks which LOOP a worker is, and tells a WAITING worker to take
 * over only when the athlete taps Update, or when the page asking already IS
 * that build. Nothing else makes a new version activate early. */
self.addEventListener('message', event => {
  const msg = event.data || {};
  if(msg.type === 'LOOP_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: CACHE_VERSION });
  else if(msg.type === 'LOOP_ACTIVATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  if(new URL(req.url).origin !== location.origin) return;
  event.respondWith(isAppShell(req) ? appShell(event) : fromCacheOrNetwork(event));
});

/* The app itself: a navigation to the scope, or to index.html in it, with any
 * query (?invite=…). Only this may ever be answered with the cached shell. */
function isAppShell(req){
  const scope = new URL(self.registration.scope).pathname;
  const path = new URL(req.url).pathname;
  return req.mode === 'navigate' && (path === scope || path === scope + 'index.html');
}

/* `promise`, or `fallback` once `ms` have passed — whichever comes first. The
 * timer is cleared either way. */
function within(promise, ms, fallback){
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/* The whole shell from the network. fetch() resolves when HEADERS arrive, and on
 * a trickling connection they can come in time while the 2.7 MB document takes
 * a minute — so the deadline has to cover the body. Only a complete 2xx is
 * usable: an error page must never become the offline copy. It did — one 503
 * from Pages replaced it, and LOOP then opened offline as "failure 503". Same
 * origin, so `ok` also rules out an opaque redirect. */
function shellFromNetwork(req){
  return fetch(req).then(res => {
    if(!res.ok) return { res, usable: false };
    return res.clone().arrayBuffer().then(() => ({ res, copy: res.clone(), usable: true }));
  });
}

/* D92 — network first, but never past the deadline when a copy is on the phone.
 * A good connection still delivers a freshly deployed LOOP; a stalled one opens
 * the copy this version keeps. With nothing cached — a first visit whose install
 * never completed — the network is the only honest answer, and a failure is the
 * browser's own.
 *
 * A network copy that arrives whole and 2xx becomes the offline copy, even one
 * that missed the deadline, if this worker is still running when it lands. But
 * the worker is held open for it only as long as the launch itself waits: Chrome
 * will not let a new version take over from a worker with an event still open,
 * so a refresh held for a minute held the athlete's tap on Update for a minute
 * (measured: after a lie-fi launch, no swap within 45 s). */
function appShell(event){
  const req = event.request;
  const network = shellFromNetwork(req);
  const keep = network.then(n => n.usable ? caches.open(CACHE_VERSION).then(c => c.put('./index.html', n.copy)) : null).catch(() => {});
  event.waitUntil(within(keep, SHELL_DEADLINE_MS, null));
  return caches.match('./index.html').then(hit => hit || caches.match(req)).then(hit => {
    const fresh = network.then(n => (n.usable || !hit) ? n.res : hit, () => hit || Response.error());
    if(!hit) return fresh;
    return within(fresh, SHELL_DEADLINE_MS, hit);
  });
}

/* D92 — every other same-origin file: the copy this version keeps, else the
 * network. The cache belongs to one version and is replaced whole on every
 * release, so a stored icon or atlas IS this version's file — asking the network
 * first only made each image wait on lie-fi for a file already on the phone. A
 * file seen for the first time is kept once it arrives whole and 2xx. */
function fromCacheOrNetwork(event){
  const req = event.request;
  return caches.match(req).then(hit => {
    if(hit) return hit;
    return fetch(req).then(res => {
      if(res.ok){
        const copy = res.clone();
        event.waitUntil(caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {}));
      }
      return res;
    }).catch(() => {
      /* D88 — not cached and not reachable: an honest network error, never the
       * shell. The shell used to answer any uncached request, so an <img>
       * requested for the first time offline received the whole of index.html:
       * an image that cannot decode, and for anything parsed as JSON or JS, a
       * syntax error. */
      return Response.error();
    });
  });
}
