const SW_VERSION = "22";
const CACHE = `airplane-shell-v${SW_VERSION}`;
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

function canonicalURL(path){
  return new URL(path, self.registration.scope).href;
}

async function precacheFreshShell(){
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map(async path => {
    const canonical = canonicalURL(path);
    const freshURL = new URL(canonical);
    // A versioned query bypasses stale browser/CDN copies while the response is
    // deliberately stored under the normal canonical URL used by the app.
    freshURL.searchParams.set("__airplane_sw", SW_VERSION);
    const response = await fetch(freshURL.href, {
      cache: "no-store",
      credentials: "same-origin"
    });
    if(!response || !response.ok){
      throw new Error(`Failed to precache ${path}: ${response?.status || "network"}`);
    }
    await cache.put(canonical, response.clone());
  }));
}

self.addEventListener("install", event => {
  // Do not skip waiting automatically. The new program is first fetched fresh
  // into its own cache, then waits for the user to tap “更新”.
  event.waitUntil(precacheFreshShell());
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
  const cached=(await cache.match(request)) || (fallback ? await cache.match(canonicalURL(fallback)) : undefined);
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

  // Launch remains cache-first and immediate. Because every new worker built
  // its cache from version-busted network requests, this cache is also the
  // program version that the user explicitly installed.
  const isNavigation=request.mode === "navigate";
  if(isNavigation) event.respondWith(cacheFirst(request,"./index.html"));
  else event.respondWith(cacheFirst(request));
});

self.addEventListener("message", event => {
  if(event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
