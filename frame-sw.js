// Complete HTML updates are staged in the background and used on the next launch.
// Bump this shell name when changing the worker; HTML-only releases need no bump.
const CACHE_NAME='frame-shell-launch-v1';
const ROOT=self.registration.scope;
const PENDING=new URL('__frame_pending_html__',ROOT).href;
const CORE=['manifest.webmanifest','frame-icon-v4.svg','frame-icon-192-v4.png','frame-icon-512-v4.png','frame-hash-256-v4.png','frame-v4.ico','frame-icon-maskable-512.png'];
let queue=Promise.resolve(),checking=null,lastCheck=0;
function serial(task){const result=queue.then(task);queue=result.catch(()=>{});return result;}
async function downloadHTML(){
  const response=await fetch(ROOT,{cache:'no-store'});
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('Frame HTML download failed');
  const html=await response.clone().text();
  // Reject error pages and incomplete downloads without replacing the offline copy.
  if(!html.includes('frameInstallServiceUI();')||!/<\/html>\s*$/i.test(html))throw Error('Incomplete Frame HTML');
  return {response,html};
}
function checkUpdate(){
  if(checking)return checking;
  if(Date.now()-lastCheck<60000)return Promise.resolve();
  lastCheck=Date.now();
  checking=(async()=>{
    const downloaded=await downloadHTML();
    await serial(async()=>{
      const cache=await caches.open(CACHE_NAME),current=await cache.match(ROOT);
      if(current&&await current.text()===downloaded.html){await cache.delete(PENDING);return;}
      await cache.put(PENDING,downloaded.response);
    });
  })().catch(()=>{}).finally(()=>{checking=null;});
  return checking;
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const downloaded=await downloadHTML(),cache=await caches.open(CACHE_NAME);
    await cache.addAll(CORE.map(path=>new Request(new URL(path,ROOT),{cache:'reload'})));
    await cache.put(ROOT,downloaded.response);
    // No skipWaiting: old windows keep their worker until they close.
  })());
});
self.addEventListener('activate',event=>{
  // Leave legacy caches and all user storage intact.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='FRAME_CHECK_UPDATE')event.waitUntil(checkUpdate());
});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
  if(request.mode==='navigate'){
    event.respondWith(serial(async()=>{
      const cache=await caches.open(CACHE_NAME);
      const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      const others=windows.filter(client=>client.url.startsWith(ROOT)&&client.id!==event.clientId&&client.id!==event.resultingClientId);
      const pending=await cache.match(PENDING);
      if(pending&&!others.length){await cache.put(ROOT,pending);await cache.delete(PENDING);}
      const current=await cache.match(ROOT);
      if(current)return current;
      try{const downloaded=await downloadHTML();await cache.put(ROOT,downloaded.response.clone());return downloaded.response;}catch{return Response.error();}
    }));
    event.waitUntil(queue.then(()=>checkUpdate()));
    return;
  }
  if(!CORE.some(path=>url.pathname===new URL(path,ROOT).pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME),hit=await cache.match(url.href);
    if(url.pathname===new URL('manifest.webmanifest',ROOT).pathname){
      try{const response=await fetch(request);if(response.ok){await cache.put(url.href,response.clone());return response;}}catch{}
    }
    if(hit)return hit;
    return fetch(request);
  })());
});
