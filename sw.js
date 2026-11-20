const SW_VERSION = '41';
const scope = self.registration.scope;
const prefix = 'airplane-shell:' + new URL(scope).pathname + ':';
const CACHE = prefix + SW_VERSION;
const SHELL = [
  './index.html','./styles.css','./app.js','./shared.css','./updates.mjs',
  './boot.mjs','./shell.mjs','./account.mjs','./vendor/nacl-fast.min.js','./manifest.webmanifest',
  './health/index.html','./health/app.css','./health/app.mjs','./health/core.mjs',
  './finance-storage.mjs','./health/backup.mjs','./health/inventory.mjs','./health/purchases.mjs','./health/purchase-ui.mjs','./health/storage.mjs','./health/assistant.mjs','./health/candidates.mjs',
  './health/contract.mjs','./ai/client.mjs','./ai/finance.mjs','./ai/keys.mjs','./ai/responses.mjs',
  './icons/icon-192.png','./icons/icon-512.png','./icons/icon-512-maskable.png','./icons/apple-touch-icon.png'
];
const assets = new Set(SHELL.map(path => new URL(path, scope).href));
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // addAll commits atomically. The new worker waits for explicit activation.
  await cache.addAll([...assets].map(url => new Request(url, {cache:'reload'})));
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key === CACHE) continue;
    if (key.startsWith(prefix)) await caches.delete(key);
    else if (/^airplane-shell-v\d+$/.test(key)) {
      const old = await caches.open(key);
      if (await old.match(new URL('./index.html', scope).href)) await caches.delete(key);
    }
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  url.search = '';
  if (e.request.mode === 'navigate' && [scope, new URL('./health/',scope).href].includes(url.href))
    url.pathname += 'index.html';
  if (!assets.has(url.href)) return;
  e.respondWith(caches.open(CACHE).then(async cache => await cache.match(url.href) || fetch(e.request)));
});
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') e.waitUntil(self.skipWaiting());
});
