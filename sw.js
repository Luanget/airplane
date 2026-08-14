const CACHE = "airplane-shell-v14";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("airplane-") && key !== CACHE)
            .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, fallback){
  const cache=await caches.open(CACHE);
  const cached=(await cache.match(request)) || (fallback ? await cache.match(fallback) : undefined);
  if(cached)return cached;
  try{
    const response=await fetch(request,{cache:"no-store"});
    if(response&&response.ok)await cache.put(request,response.clone());
    return response;
  }catch(err){
    return Response.error();
  }
}

self.addEventListener("fetch", event => {
  const request=event.request;
  if(request.method !== "GET") return;
  const url=new URL(request.url);
  if(url.origin !== self.location.origin) return;

  // Installed Airplane always starts from the local shell. Program-version
  // discovery is handled separately by Service Worker update checks, so launch
  // never waits for the hosting server.
  const isNavigation=request.mode === "navigate";
  if(isNavigation) event.respondWith(cacheFirst(request,"./index.html"));
  else event.respondWith(cacheFirst(request));
});

self.addEventListener("message", event => {
  if(event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
