// Bump with the visible application version for each published runtime release.
const VERSION='2026.10.23.1',CACHE='frame-native-'+VERSION,ROOT=self.registration.scope;
const SHELL=new URL('index.html',ROOT).href;
const CORE=['index.html','manifest.webmanifest','frame-icon-v4.svg','frame-icon-192-v4.png','frame-icon-512-v4.png','frame-icon-maskable-512.png','frame-hash-256-v4.png','frame-v4.ico','modules/index.json'];
const local=path=>{const url=new URL(path,ROOT);if(url.origin!==self.location.origin||!url.href.startsWith(ROOT))throw Error('Invalid offline resource');return url.href;};
async function download(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Offline resource HTTP '+response.status);return response;}
async function cacheShell(cache){
  const response=await download(SHELL),html=await response.clone().text();
  if(!html.includes('<meta name="frame-version"')||!/<\/html>\s*$/i.test(html))throw Error('Incomplete Frame shell');
  await cache.put(SHELL,response);return cache.match(SHELL);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Installation is atomic: an offline client retains its previous complete shell.
  const response=await download(SHELL),html=await response.clone().text();
  if(!html.includes('name="frame-version" content="'+VERSION+'"')||!/<\/html>\s*$/i.test(html))throw Error('Frame release mismatch');
  for(const path of CORE.filter(p=>p!=='index.html'))await cache.put(local(path),await download(local(path)));
  const catalogue=await (await cache.match(local('modules/index.json'))).json();
  for(const path of catalogue){const url=local('modules/'+path),manifest=await download(url),data=await manifest.clone().json();await cache.put(url,manifest);for(const field of ['module','icon']){const asset=local(new URL(data[field],url).href);await cache.put(asset,await download(asset));}}
  await cache.put(SHELL,response);await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  // Only Frame shell caches are retired; document/clipboard/user storage is untouched.
  for(const key of await caches.keys())if(key!==CACHE&&(key.startsWith('frame-native-')||key.startsWith('frame-shell-')||key==='frame-assets-v1'))await caches.delete(key);
  for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'FRAME_UPDATE_READY',version:VERSION});
})()));
let checking=null;
self.addEventListener('message',event=>{if(event.data?.type!=='FRAME_CHECK_UPDATE')return;checking??=(async()=>{try{await cacheShell(await caches.open(CACHE));}catch{}finally{checking=null;}})();event.waitUntil(checking);});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
  const launch=url.pathname===new URL(ROOT).pathname||url.pathname===new URL(SHELL).pathname;
  if(request.mode==='navigate'&&launch){event.respondWith((async()=>{const cache=await caches.open(CACHE);try{return await cacheShell(cache);}catch{return await cache.match(SHELL)||Response.error();}})());return;}
  // Models and scenes remain ordinary files; only application resources and visited textures cache.
  const resource=CORE.some(p=>url.href===local(p))||['modules/','models/','textures/'].some(p=>url.href.startsWith(local(p)));
  if(!resource)return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await download(request);try{await cache.put(request,response.clone());}catch{}return response;}catch{return await cache.match(request)||Response.error();}})());
});
