const CACHE = 'novora-shell-v2.6.2-ui4';
const RUNTIME = 'novora-runtime-v2.6.2-ui4';
// Keep installation light. Fonts are cached after a design actually requests them.
const CORE = ['/', '/index.html', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512-rounded.png', '/manifest.webmanifest', '/fonts/exam-numeric-subset.ttf', '/fonts/source-han-sc-standard-subset.woff2'];

async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch('/index.html', { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to fetch application shell');
  const html = await response.clone().text();
  await cache.put('/index.html', response);
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map(match => new URL(match[1], self.location.origin))
    .filter(url => url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
    .map(url => url.pathname + url.search);
  await Promise.all([...new Set([...CORE, ...assets])].map(async url => {
    try { const hit = await fetch(url, { cache: 'no-store' }); if (hit.ok) await cache.put(url, hit); } catch { /* previous verified shell remains available */ }
  }));
}

self.addEventListener('install', event => event.waitUntil(precacheShell().then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  const stale = keys.filter(key => (
    key.startsWith('exam-board-shell-')
    || key.startsWith('exam-board-runtime-')
    || (key.startsWith('novora-shell-') && key !== CACHE)
    || (key.startsWith('novora-runtime-') && key !== RUNTIME)
  ));
  await Promise.all(stale.map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const req = event.request; const url = new URL(req.url);
  if (url.origin !== self.location.origin || req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(async response => {
      if (response.ok) { const cache = await caches.open(CACHE); await cache.put('/index.html', response.clone()); }
      return response;
    }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/', { ignoreSearch: true })) || Response.error()));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(async response => {
    if (response.ok) { const cache = await caches.open(RUNTIME); await cache.put(req, response.clone()); }
    return response;
  })));
});
