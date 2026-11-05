/* Field Lite shell only: no receipts, API responses or live evidence are cached. */
const CACHE_NAME = 'gev-field-lite-shell-v1';
const CACHE_PREFIX = 'gev-field-lite-shell-';
const SHELL_URL = new URL('./', self.registration.scope).href;
const SHELL_PATH = new URL(SHELL_URL).pathname;
const ORIGIN = new URL(SHELL_URL).origin;
const STATIC_PREFIXES = ['/assets/', '/src/fieldLite/', '/src/data/', '/@vite/', '/node_modules/.vite/'];

function isStaticAsset(url) {
  return url.origin === ORIGIN && STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetch(SHELL_URL, { cache: 'reload' });
    if (!response.ok) throw new Error('Field Lite shell could not be cached');
    const cache = await caches.open(CACHE_NAME);
    await cache.put(SHELL_URL, response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) &&
      name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'gev-field-lite-prime') return;
  event.waitUntil((async () => {
    let ok = false;
    try {
      const urls = event.data.urls;
      if (!Array.isArray(urls) || urls.length > 64) throw new Error('Unbounded asset list');
      const cache = await caches.open(CACHE_NAME);
      let scriptCount = 0;
      let styleCount = 0;
      for (const href of new Set(urls)) {
        if (typeof href !== 'string' || href.length > 2048) throw new Error('Invalid asset URL');
        const url = new URL(href);
        if (!isStaticAsset(url)) continue;
        const response = await fetch(url.href, { cache: 'reload' });
        if (!response.ok || response.type === 'opaque') throw new Error('Asset unavailable');
        await cache.put(url.href, response);
        if (url.pathname.endsWith('.js')) scriptCount += 1;
        if (url.pathname.endsWith('.css')) styleCount += 1;
      }
      // Ready means both executable entry and stylesheet were actually cached.
      ok = scriptCount > 0 && styleCount > 0 &&
        (await cache.match(SHELL_URL)) !== undefined;
    } catch {
      // An incomplete cache must never be advertised as offline ready.
    }
    event.ports?.[0]?.postMessage({ ok });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ORIGIN) return;
  if (request.mode === 'navigate' && url.pathname === SHELL_PATH) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(SHELL_URL, response.clone());
        return response;
      } catch {
        return (await cache.match(SHELL_URL)) || Response.error();
      }
    })());
    return;
  }
  if (!['script', 'style', 'font'].includes(request.destination) || !isStaticAsset(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(request);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
    return response;
  })());
});
