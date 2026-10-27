// Service worker: the app opens with no signal, and map tiles you have
// already viewed stay available offline. API calls are never cached here;
// the app keeps its own offline copy of the data.
const VERSION = 'lw-2.0.0';
const SHELL = [
  '/', '/index.html', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png',
  '/js/app.js', '/js/store.js', '/js/gps.js', '/js/camera.js', '/js/map.js', '/js/ui.js', '/js/geo.js', '/js/compass.js', '/js/grades.js',
  '/js/views/inspect.js', '/js/views/review.js', '/js/views/pole.js', '/js/views/learning.js', '/js/views/work.js', '/js/views/admin.js',
  '/vendor/leaflet/leaflet-src.esm.js', '/vendor/leaflet/leaflet.css',
];
const TILE_CACHE = 'lw-tiles';
const MAX_TILES = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    // App files: network first so updates arrive, cache when offline.
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
    return;
  }
  if (/tile\.openstreetmap\.org|arcgisonline\.com/.test(url.hostname)) {
    // Map tiles: cache first, so a line you have looked at works with no signal.
    e.respondWith(caches.open(TILE_CACHE).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') {
        cache.put(e.request, res.clone());
        trim(cache);
      }
      return res;
    }));
  }
});

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  trimming = false;
}
