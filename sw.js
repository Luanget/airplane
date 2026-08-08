const CACHE = "airplane-shell-v9";
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
      .then(() => self.skipWaiting())
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

async function networkFirst(request, fallback){
  const cache=await caches.open(CACHE);
  const cachedFallback = async () =>
    (await caches.match(request)) ||
    (fallback ? await caches.match(fallback) : undefined) ||
    Response.error();

  try{
    const response=await fetch(request,{cache:"no-store"});
    // A suspended/expired host may still answer with 401/403/404 instead of
    // behaving like an offline network. Never replace a working installed app
    // with such an error page: keep using the last known-good local shell.
    if(!response || !response.ok) return await cachedFallback();
    await cache.put(request,response.clone());
    return response;
  }catch(err){
    return await cachedFallback();
  }
}

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached) return cached;
  try{
    const response=await fetch(request);
    if(response && response.ok){
      const cache=await caches.open(CACHE);
      cache.put(request,response.clone());
    }
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

  // Navigations and executable app files prefer the network while online, so a
  // Home Screen installation receives new program versions without touching its
  // own local ledger. Offline, the last known-good shell is used.
  const isNavigation=request.mode === "navigate";
  const isLiveAsset=/\/(?:index\.html|app\.js|styles\.css|manifest\.webmanifest)$/.test(url.pathname);

  if(isNavigation){
    event.respondWith(networkFirst(request,"./index.html"));
  }else if(isLiveAsset){
    event.respondWith(networkFirst(request));
  }else{
    event.respondWith(cacheFirst(request));
  }
});
