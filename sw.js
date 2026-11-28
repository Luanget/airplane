const SW_VERSION = '98';
const scope = self.registration.scope;
const prefix = 'airplane-shell:' + new URL(scope).pathname + ':';
const CACHE = prefix + SW_VERSION;
const SHELL = [
  './index.html','./styles.css','./app.js','./shared.css','./updates.mjs',
  './calendar.mjs','./boot.mjs','./legacy-export.mjs','./shell.mjs','./choice-picker.mjs','./field-picker.mjs','./account.mjs','./vendor/nacl-fast.min.js','./manifest.webmanifest',
  './health/index.html','./health/app.css','./health/app.mjs','./health/core.mjs','./health/package-price.mjs','./health/agent-rules.mjs','./health/medical.mjs','./health/medical-ui.mjs','./health/container-ledger.mjs','./health/containers.mjs','./health/package-ui.mjs','./health/presentation.mjs','./health/weight-chart.mjs',
  './finance-note.mjs','./finance-storage.mjs','./finance-metrics.mjs','./health/backup.mjs','./health/sync-source.mjs','./health/sync.mjs','./health/sync-io.mjs','./health/sync-ui.mjs','./health/inventory.mjs','./health/purchases.mjs','./health/purchase-sync.mjs','./health/shopping.mjs','./health/purchase-ui.mjs','./health/storage.mjs','./health/assistant.mjs','./health/candidates.mjs',
  './health/meal-status.mjs','./health/food-groups.mjs','./health/food-categories.mjs',
  './vendor/markdown-it.min.mjs','./ai/markdown.mjs','./ai/owner.mjs','./ai/owner-store.mjs','./ai/owner-health.mjs','./ai/evidence.mjs','./ai/conversation-evidence.mjs','./ai/stock-receive.mjs','./ai/audit.mjs','./ai/archive.mjs',
  './assistant/index.html','./assistant/workspace.css','./ai/workspace.mjs','./ai/health-actions.mjs','./ai/health-profile.mjs','./ai/health-report.mjs','./ai/agent-settings.mjs','./ai/meal-photos.mjs','./ai/context.mjs','./ai/data.mjs','./ai/documents.mjs','./ai/memory.mjs','./ai/document-patch.mjs','./ai/data-guide.mjs','./ai/skills.mjs','./ai/operations.mjs','./ai/demo.mjs','./ai/threads.mjs','./ai/batch.mjs','./ai/deletion.mjs','./ai/usage.mjs',
  './health/contract.mjs','./health/food-history.mjs','./ai/client.mjs','./ai/chat.mjs','./ai/finance.mjs','./ai/agent-executor.mjs','./ai/agent-loop.mjs','./ai/agent-chat.mjs','./ai/agent-tools.mjs','./ai/meal-planning.mjs','./ai/task-log.mjs','./ai/task-settings.mjs','./ai/routing.mjs','./ai/receipts.mjs','./ai/medical-chat.mjs','./ai/medical-response.mjs','./ai/keys.mjs','./ai/models.mjs','./ai/responses.mjs','./ai/stream.mjs',
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
  url.hash = '';
  if (e.request.mode === 'navigate' && [scope, new URL('./health/',scope).href, new URL('./assistant/',scope).href].includes(url.href))
    url.pathname += 'index.html';
  if (!assets.has(url.href)) return;
  e.respondWith(caches.open(CACHE).then(async cache => await cache.match(url.href) || fetch(e.request)));
});
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') e.waitUntil(self.skipWaiting());
});
