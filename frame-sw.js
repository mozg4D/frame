// Bump with the visible application version for each published runtime release.
const VERSION='2026 21 nov 01:09',CACHE='frame-native-'+VERSION,ROOT=self.registration.scope;
const SHELL=new URL('index.html',ROOT).href;
const CORE=["index.html","manifest.webmanifest","frame-icon.svg","frame-icon-192.png","frame-icon-512.png","frame-icon-maskable-512.png","frame-hash-256.png","frame.ico"];
const local=path=>{const url=new URL(path,ROOT);if(url.origin!==self.location.origin||!url.href.startsWith(ROOT))throw Error('Invalid offline resource');return url.href;};
async function download(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('Offline resource HTTP '+response.status);return response;}
async function cacheShell(cache){
  const response=await download(SHELL),html=await response.clone().text();
  if(!html.includes('name="frame-version" content="'+VERSION+'"')||!/<\/html>\s*$/i.test(html))throw Error('Frame release mismatch');
  await cache.put(SHELL,response);return cache.match(SHELL);
}
const popupShells=new Map();
async function popupDocument(kind){
  if(!popupShells.has(kind)){
    const cache=await caches.open(CACHE),response=await cache.match(SHELL)||await cacheShell(cache),html=await response.text();
    const block=id=>{const source=html.match(new RegExp('<script id="'+id+'" type="text/plain">([\\s\\S]*?)<\\/script>'))?.[1];if(!source)throw Error('Missing embedded popup '+id);return source;};
    let source=block('frame-'+kind+'-shell').replace('<head>','<head><base href="'+ROOT+'">'),script='';
    if(kind==='documentation'){
      const extract=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);if(a<0||b<a)throw Error('Missing embedded popup helper');return html.slice(a,b).trim();};
      const codec=extract('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();'),geometry=extract('function createFrameDocumentationGeometry(','// Documentation popup host.');
      script='const FrameValue=('+codec+')().values;const {installDocumentationGeometry}=('+geometry+')();\n'+block('frame-documentation-editor');
    }else if(kind==='control')script="window.opener?.postMessage({type:'frame-control-ready'},location.origin);window.addEventListener('pagehide',()=>window.opener?.postMessage({type:'frame-control-leaving'},location.origin));";
    if(script)source=source.replace('</body>','<script type="module">'+script.replace(/<\/script/gi,'<\\/script')+'<'+'/script></body>');
    popupShells.set(kind,source);
  }
  return new Response(popupShells.get(kind),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Installation is atomic: an offline client retains its previous complete shell.
  const response=await download(SHELL),html=await response.clone().text();
  if(!html.includes('name="frame-version" content="'+VERSION+'"')||!/<\/html>\s*$/i.test(html))throw Error('Frame release mismatch');
  for(const path of CORE.filter(p=>p!=='index.html'))await cache.put(local(path),await download(local(path)));
  await cache.put(SHELL,response);await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await self.clients.claim();
  // Only Frame shell caches are retired; document/clipboard/user storage is untouched.
  for(const key of await caches.keys())if(key!==CACHE&&(key.startsWith('frame-native-')||key.startsWith('frame-shell-')||key==='frame-assets-v1'))await caches.delete(key);
  for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'FRAME_UPDATE_READY',version:VERSION});
})()));
self.addEventListener('message',event=>{if(event.data?.type==='FRAME_GET_VERSION')event.source?.postMessage({type:'FRAME_UPDATE_READY',version:VERSION});});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);url.hash='';if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
  if(request.headers.get('X-Frame-Source')==='1'){event.respondWith(fetch(request));return;}
  const launch=url.pathname===new URL(ROOT).pathname||url.pathname===new URL(SHELL).pathname;
  const popup=url.searchParams.get('frame-window');
  if(request.mode==='navigate'&&launch&&['viewport','documentation','control'].includes(popup)){event.respondWith(popupDocument(popup));return;}
  if(request.mode==='navigate'&&launch){event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(SHELL)||await cacheShell(cache);})());return;}
  // Models and scenes remain ordinary files; only application resources and visited textures cache.
  const resource=CORE.some(p=>url.href===local(p))||['plugins/','models/','textures/'].some(p=>url.href.startsWith(local(p)));
  if(!resource)return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE),cached=await cache.match(request);if(cached)return cached;const response=await download(request);try{await cache.put(request,response.clone());}catch{}return response;})());
});
