const CACHE_NAME='frame-shell-launch-v4',ASSET_CACHE='frame-assets-v1',DOCUMENT_CACHE='frame-documents-v1';
const ROOT=self.registration.scope,PENDING=new URL('__frame_pending_html__',ROOT).href;
const CORE=['manifest.webmanifest','frame-icon-v4.svg','frame-icon-192-v4.png','frame-icon-512-v4.png','frame-hash-256-v4.png','frame-v4.ico','frame-icon-maskable-512.png'];
const DOWNLOAD_TIMEOUT=20000;
let queue=Promise.resolve(),checking=null,lastCheck=0;
function serial(task){const result=queue.then(task);queue=result.catch(()=>{});return result;}
function isLaunchURL(value){const url=new URL(value);return url.pathname===new URL(ROOT).pathname||url.pathname===new URL('index.html',ROOT).pathname;}
function assetHash(url){return url.pathname.match(/\.([a-f0-9]{20})\.(?:js|webp|json\.gz|hash(?:\.gz)?)$/)?.[1];}
function assetManifest(html){
  const match=html.match(/<script id="frame-assets" type="application\/json">([\s\S]*?)<\/script>/);
  if(!match)throw Error('Incomplete Frame manifest');
  const m=JSON.parse(match[1]);
  if(!m||typeof m.version!=='string'||!m.version||!m.assets||Array.isArray(m.assets)||typeof m.assets!=='object'||!Object.values(m.assets).some(a=>a?.critical===true))throw Error('Incomplete Frame manifest');
  const seen=new Map();
  for(const a of Object.values(m.assets)){
    if(!a||typeof a.path!=='string'||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<0)throw Error('Invalid Frame resource');
    const u=new URL(a.path,ROOT),hash=assetHash(u);
    if(!u.href.startsWith(ROOT)||u.origin!==self.location.origin||u.username||u.password||u.search||u.hash||!hash||!a.sha256.startsWith(hash))throw Error('Invalid Frame resource URL');
    const old=seen.get(u.href);if(old&&(old.sha256!==a.sha256||old.bytes!==a.bytes))throw Error('Conflicting Frame resource');
    seen.set(u.href,a);
  }
  return m;
}
function launchManifest(html){
  if(!/<\/html>\s*$/i.test(html))throw Error('Incomplete Frame HTML');
  return assetManifest(html);
}
async function verified(response,hash,size){
  if(!response?.ok)throw Error('Frame resource download failed');
  const b=await response.clone().arrayBuffer();
  if(size!==undefined&&b.byteLength!==size)throw Error('Incomplete Frame resource');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(!digest.startsWith(hash))throw Error('Frame resource version mismatch');
  return response;
}
async function download(url,options,inspect){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),DOWNLOAD_TIMEOUT);
  try{return await inspect(await fetch(url,{...options,signal:controller.signal}));}
  catch(error){controller.abort();throw error;}
  finally{clearTimeout(timer);}
}
async function prepareAssets(manifest){
  const cache=await caches.open(ASSET_CACHE),unique=new Map();
  for(const a of Object.values(manifest.assets))unique.set(new URL(a.path,ROOT).href,a);
  const entries=[...unique],failures=[];let next=0;
  await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
    while(!failures.length&&next<entries.length){
      const [url,a]=entries[next++];
      try{
        const hit=await cache.match(url);
        if(hit){try{await verified(hit,a.sha256,a.bytes);continue;}catch{await cache.delete(url);}}
        const response=await download(url,{cache:'reload'},r=>verified(r,a.sha256,a.bytes));
        await cache.put(url,response);
      }catch(error){failures.push(error);}
    }
  }));
  // Let all in-flight cache writes settle before rejecting installation or staging.
  if(failures.length)throw failures[0];
}
async function downloadHTML(){
  const result=await download(ROOT,{cache:'no-store'},async response=>{
    if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('Frame HTML download failed');
    const html=await response.clone().text();
    return {response,html,manifest:launchManifest(html)};
  });
  await prepareAssets(result.manifest);
  return result;
}
function checkUpdate(){
  if(checking)return checking;
  if(lastCheck&&Date.now()-lastCheck<60000)return Promise.resolve(false);
  checking=(async()=>{
    const downloaded=await downloadHTML();
    await serial(async()=>{
      const cache=await caches.open(CACHE_NAME),current=await cache.match(ROOT);
      if(current&&await current.text()===downloaded.html){await cache.delete(PENDING);return;}
      await cache.put(PENDING,downloaded.response);
    });
    lastCheck=Date.now();return true;
  })().catch(()=>false).finally(()=>{checking=null;});
  return checking;
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const downloaded=await downloadHTML(),cache=await caches.open(CACHE_NAME);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),DOWNLOAD_TIMEOUT);
    try{await cache.addAll(CORE.map(path=>new Request(new URL(path,ROOT),{cache:'reload',signal:controller.signal})));}
    finally{clearTimeout(timer);}
    // Publish the shell only after every local manifest resource and shell icon is stored.
    await cache.put(ROOT,downloaded.response);
    await cache.delete(PENDING);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('message',event=>{if(event.data?.type==='FRAME_CHECK_UPDATE')event.waitUntil(checkUpdate());});
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);if(url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
  if(request.mode==='navigate'&&!isLaunchURL(url.href)){
    event.respondWith((async()=>{
      if(url.pathname!==new URL('queue.html',ROOT).pathname)return fetch(request);
      const cache=await caches.open(DOCUMENT_CACHE),key=new URL('queue.html',ROOT).href;
      try{const response=await fetch(request,{cache:'no-cache'});if(response.ok&&response.headers.get('content-type')?.includes('text/html'))await cache.put(key,response.clone());return response;}
      catch{return await cache.match(key)||Response.error();}
    })());return;
  }
  if(request.mode==='navigate'){
    const result=serial(async()=>{
      const cache=await caches.open(CACHE_NAME),pending=await cache.match(PENDING);
      if(pending){
        try{
          await prepareAssets(launchManifest(await pending.clone().text()));
          await cache.put(ROOT,pending);await cache.delete(PENDING);
        }catch{}
      }
      const current=await cache.match(ROOT);if(current)return current;
      try{const downloaded=await downloadHTML();await cache.put(ROOT,downloaded.response.clone());return downloaded.response;}
      catch{return Response.error();}
    });
    event.respondWith(result);event.waitUntil(result.then(()=>checkUpdate()));return;
  }
  const hash=assetHash(url);
  if(hash){
    event.respondWith((async()=>{
      let cache=null,hit=null;
      try{cache=await caches.open(ASSET_CACHE);hit=await cache.match(url.href);}catch{}
      if(hit){try{return await verified(hit,hash);}catch{try{await cache.delete(url.href);}catch{}}}
      try{
        const response=await download(request,{cache:'reload'},r=>verified(r,hash));
        try{await cache?.put(url.href,response.clone());}catch{}
        return response;
      }catch{return Response.error();}
    })());return;
  }
  if(!CORE.some(path=>url.pathname===new URL(path,ROOT).pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME),hit=await cache.match(url.href);
    if(url.pathname===new URL('manifest.webmanifest',ROOT).pathname){
      try{const response=await fetch(request);if(response.ok){try{await cache?.put(url.href,response.clone());}catch{}
        return response;}}catch{}
    }
    return hit||fetch(request);
  })());
});
