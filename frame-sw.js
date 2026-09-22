const CACHE_NAME='frame-shell-v15';
const CORE=['./','./manifest.webmanifest','./frame-icon-v3.svg','./frame-icon-192-v3.png','./frame-icon-512-v3.png'];
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
      if(response&&response.ok)caches.open(CACHE_NAME).then(cache=>cache.put('./',response.clone()));
      return response;
    }).catch(()=>caches.match(request).then(hit=>hit||caches.match('./'))));
    return;
  }
  const relative='./'+url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if(!CORE.includes(relative))return;
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>{
    if(response&&response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
    return response;
  })));
});
