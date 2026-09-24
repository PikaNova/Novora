// 缓存策略有改动时必须递增版本号：activate 阶段会删掉不同版本的旧缓存。
// 2026-09-18 改过静态资源策略（缺失资源 404、SPA 回退只服务无扩展名路由），
// 这一次发布必须换缓存版本，否则老壳缓存会让用户继续吃到旧的兜底行为。
const CACHE_VERSION = '20260924-1';
const SHELL_CACHE = `novora-shell-v2.8.0-pwa-${CACHE_VERSION}`;
const RUNTIME_CACHE = `novora-runtime-v2.8.0-pwa-${CACHE_VERSION}`;
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest'];

/**
 * 只缓存真正拿到内容的响应。
 * 服务端在静态资源缺失时可能把 index.html 当成 200 的兜底响应返回；这种响应一旦
 * 按脚本/CSS 的 URL 写进缓存，该 URL 之后永远返回 HTML，动态 import 再也拿不到
 * 真正的模块（Failed to fetch dynamically imported module）。
 */
function canCache(request, response) {
  if (!response || response.status !== 200) return false;
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html') && request.mode !== 'navigate') return false;
  if (request.destination === 'script' && !contentType.includes('javascript')) return false;
  if (request.destination === 'style' && !contentType.includes('text/css')) return false;
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key !== SHELL_CACHE &&
                key !== RUNTIME_CACHE &&
                (key.startsWith('novora-shell-') || key.startsWith('novora-runtime-')),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API data must always come from the network. Cache Storage ignores HTTP
  // cache directives, so cache-first here could return stale grades/classes
  // even when the API responds with Cache-Control: private, no-cache.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (canCache(request, response)) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    }),
  );
});
