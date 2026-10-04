 
const CACHE_NAME='frame-shell-launch-v3',ASSET_CACHE='frame-assets-v1',DOCUMENT_CACHE='frame-documents-v1';
const ROOT=self.registration.scope,PENDING=new URL('__frame_pending_html__',ROOT).href;
function isLaunchURL(value){const url=new URL(value);return url.pathname===new URL(ROOT).pathname||url.pathname===new URL('index.html',ROOT).pathname;}
const CORE=['manifest.webmanifest','frame-icon-v4.svg','frame-icon-192-v4.png','frame-icon-512-v4.png','frame-hash-256-v4.png','frame-v4.ico','frame-icon-maskable-512.png'];
let queue=Promise.resolve(),checking=null,lastCheck=0;
function serial(task){const result=queue.then(task);queue=result.catch(()=>{});return result;}
function assetManifest(html){const match=html.match(/<script id="frame-assets" type="application\/json">([\s\S]*?)<\/script>/);if(!match){if(!html.includes('frameInstallServiceUI();'))throw Error('Incomplete Frame shell');return null;}const m=JSON.parse(match[1]);if(!m.version||!m.assets||!Object.values(m.assets).some(a=>a.critical))throw Error('Incomplete Frame manifest');for(const a of Object.values(m.assets)){const u=new URL(a.path,ROOT);if(!u.href.startsWith(ROOT)||u.origin!==self.location.origin||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<0)throw Error('Invalid Frame resource');}return m;}
async function verified(response,hash,size){if(!response.ok)throw Error('Frame resource download failed');const b=await response.clone().arrayBuffer();if(size!==undefined&&b.byteLength!==size)throw Error('Incomplete Frame resource');const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(!digest.startsWith(hash))throw Error('Frame resource version mismatch');return response;}
async function prepareCritical(manifest){if(!manifest)return;const cache=await caches.open(ASSET_CACHE),entries=Object.values(manifest.assets).filter(a=>a.critical);let next=0;await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{while(next<entries.length){const a=entries[next++],url=new URL(a.path,ROOT).href,hit=await cache.match(url);if(hit){try{await verified(hit,a.sha256,a.bytes);continue;}catch{await cache.delete(url);}}const response=await verified(await fetch(url,{cache:'reload'}),a.sha256,a.bytes);await cache.put(url,response);}}));}
async function downloadHTML(){const response=await fetch(ROOT,{cache:'no-store'});if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('Frame HTML download failed');const html=await response.clone().text();if(!/<\/html>\s*$/i.test(html))throw Error('Incomplete Frame HTML');const manifest=assetManifest(html);await prepareCritical(manifest);return {response,html};}
function checkUpdate(){if(checking)return checking;if(Date.now()-lastCheck<60000)return Promise.resolve();lastCheck=Date.now();checking=(async()=>{const downloaded=await downloadHTML();await serial(async()=>{const cache=await caches.open(CACHE_NAME),current=await cache.match(ROOT);if(current&&await current.text()===downloaded.html){await cache.delete(PENDING);return;}await cache.put(PENDING,downloaded.response);});})().catch(()=>{}).finally(()=>{checking=null;});return checking;}
self.addEventListener('install',event=>{event.waitUntil((async()=>{const downloaded=await downloadHTML(),cache=await caches.open(CACHE_NAME);await cache.addAll(CORE.map(path=>new Request(new URL(path,ROOT),{cache:'reload'})));await cache.put(ROOT,downloaded.response); 
await self.skipWaiting();})());});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim()); });
self.addEventListener('message',event=>{if(event.data?.type==='FRAME_CHECK_UPDATE')event.waitUntil(checkUpdate());});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
 if(request.mode==='navigate'&&!isLaunchURL(url.href)){
   
  event.respondWith((async()=>{if(url.pathname!==new URL('queue.html',ROOT).pathname)return fetch(request);
   const cache=await caches.open(DOCUMENT_CACHE),key=new URL('queue.html',ROOT).href;
   try{const response=await fetch(request,{cache:'no-cache'});if(response.ok&&response.headers.get('content-type')?.includes('text/html'))await cache.put(key,response.clone());return response;}
   catch{return await cache.match(key)||Response.error();}
  })());return;
 }
 if(request.mode==='navigate'){
  event.respondWith(serial(async()=>{const cache=await caches.open(CACHE_NAME),pending=await cache.match(PENDING);
   if(pending){try{await prepareCritical(assetManifest(await pending.clone().text()));await cache.put(ROOT,pending);await cache.delete(PENDING);}catch{}}
   const current=await cache.match(ROOT);if(current)return current;try{const downloaded=await downloadHTML();await cache.put(ROOT,downloaded.response.clone());return downloaded.response;}catch{return Response.error();}
  }));event.waitUntil(queue.then(()=>checkUpdate()));return;
 }
 const hash=url.pathname.match(/\.(?<hash>[a-f0-9]{20})\.(?:js|webp|json\.gz|hash\.gz)$/)?.groups.hash;
 if(hash){event.respondWith((async()=>{const cache=await caches.open(ASSET_CACHE),hit=await cache.match(url.href);if(hit)return hit;try{const response=await fetch(request);if(!response.ok)return response;await verified(response,hash);await cache.put(url.href,response.clone());return response;}catch{return Response.error();}})());return;}
 if(!CORE.some(path=>url.pathname===new URL(path,ROOT).pathname))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME),hit=await cache.match(url.href);if(url.pathname===new URL('manifest.webmanifest',ROOT).pathname){try{const response=await fetch(request);if(response.ok){await cache.put(url.href,response.clone());return response;}}catch{}}return hit||fetch(request);})());
});
