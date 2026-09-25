// Frame r84. The application remains a self-contained HTML; these are shell assets only.
const CACHE_NAME='frame-shell-v26-r84';
const CORE=['./','./manifest.webmanifest','./frame-icon-v4.svg','./frame-icon-192-v4.png','./frame-icon-512-v4.png','./frame-hash-256-v4.png','./frame-v4.ico','./frame-icon-maskable-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('frame-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response?.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put('./',copy)));}
      return response;
    }).catch(async()=>{const cache=await caches.open(CACHE_NAME);return await cache.match(request)||await cache.match('./')||Response.error();}));
    return;
  }
  const relative='./'+url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if(!CORE.includes(relative))return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
    // Refresh the manifest so installed-file handlers can receive updates.
    if(relative==='./manifest.webmanifest'){
      try{const response=await fetch(request);if(response.ok){event.waitUntil(cache.put(request,response.clone()));return response;}}catch{}
    }
    const hit=await cache.match(request);if(hit)return hit;
    const response=await fetch(request);if(response?.ok)event.waitUntil(cache.put(request,response.clone()));return response;
  }));
});
