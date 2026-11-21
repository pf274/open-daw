/*
 * OpenDAW service worker: makes the app installable and lets it start offline.
 * Built by the `pwa` plugin in vite.config.js, which fills in VERSION and PRECACHE (every built file).
 *  - the app's own files: cached on install; served from the cache, fetched (and cached) if missing
 *  - the page itself: network first, so a new version shows up as soon as you're online
 *  - instrument samples (another site): cached the first time they're used, so they work offline afterwards
 */
const VERSION = self.__VERSION__;
const PRECACHE = self.__PRECACHE__;
const APP = `open-daw-${VERSION}`;
const SAMPLES = 'open-daw-samples';
const SAMPLE_HOSTS = ['gleitz.github.io'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('open-daw-') && k !== APP && k !== SAMPLES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fromCacheOrNetwork(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function page(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(APP)).put('./', res.clone());
    return res;
  } catch (err) {
    return (await caches.match('./', { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') e.respondWith(page(req));
    else e.respondWith(fromCacheOrNetwork(req, APP));
  } else if (SAMPLE_HOSTS.includes(url.hostname)) {
    e.respondWith(fromCacheOrNetwork(req, SAMPLES));
  }
});
