// Node VM controls against the current worker; browser acceptance is separate.
import fs from'node:fs';import vm from'node:vm';import assert from'node:assert/strict';import{createHash,webcrypto}from'node:crypto';
const sw=fs.readFileSync(new URL('../../frame-sw.js',import.meta.url),'utf8'),root='https://frame-qa.invalid/frame/',hash=b=>createHash('sha256').update(b).digest('hex'),oldBytes=Buffer.from('old verified resource'),newBytes=Buffer.from('new verified resource');
const shell=(version,bytes)=>{const sha=hash(bytes),path='./modules/editor.'+sha.slice(0,21)+'.js';return{html:`<html><script id="frame-assets" type="application/json">${JSON.stringify({version,assets:{editor:{path,sha256:sha,bytes:bytes.length,critical:true}}})}</script></html>`,url:new URL(path,root).href,bytes};};const old=shell('old',oldBytes),fresh=shell('new',newBytes);let network=fresh,fail=false,delay=0,assetDelay=0,truncated=false,bad=false;const stores=new Map(),events=new Map();
class Cache{constructor(){this.entries=new Map()}key(k){return typeof k==='string'?new URL(k,root).href:k.url}async match(k){return this.entries.get(this.key(k))?.clone()}async put(k,r){this.entries.set(this.key(k),r.clone())}async delete(k){return this.entries.delete(this.key(k))}async addAll(){}}
const caches={async open(name){if(!stores.has(name))stores.set(name,new Cache());return stores.get(name)}};
const context=vm.createContext({self:{registration:{scope:root},location:{origin:new URL(root).origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(n,f)=>events.set(n,f)},caches,crypto:webcrypto,URL,Request,Response,AbortController,setTimeout,clearTimeout,Date,console,fetch:async(url)=>{if(fail)throw Error('QA offline');const u=typeof url==='string'?url:url.url;if(u===root){if(delay)await new Promise(r=>setTimeout(r,delay));return new Response(truncated?network.html.slice(0,-7):network.html,{headers:{'content-type':'text/html'}})}if(u===network.url){if(assetDelay)await new Promise(r=>setTimeout(r,assetDelay));return new Response(bad?'broken digest':network.bytes);}throw Error('QA unknown URL '+u)}});vm.runInContext(sw,context);
const shellCache=await caches.open('frame-shell-launch-v5'),assets=await caches.open('frame-assets-v1'),docs=await caches.open('frame-documents-v1'),scene=await caches.open('user-scenes');await docs.put(root+'doc',new Response('doc sentinel'));await scene.put(root+'scene',new Response('scene sentinel'));
const seed=async()=>{await shellCache.put(root,new Response(old.html));await shellCache.delete(root+'__frame_pending_html__');await assets.put(old.url,new Response(old.bytes));await assets.delete(fresh.url);vm.runInContext('lastCheck=0;checking=null;',context);};
const nav=async()=>{let response,wait;events.get('fetch')({request:{url:root,method:'GET',mode:'navigate'},respondWith:p=>response=p,waitUntil:p=>wait=p});const start=performance.now(),r=await response;return{html:await r.text(),elapsed:performance.now()-start,wait};};
const out={pass:false,actualCandidateSource:true,sourceSHA256:hash(sw),cases:[]};
try{
 await seed();let n=await nav();assert.equal(n.html,fresh.html);await n.wait;out.cases.push({name:'verified-current-navigation',pass:true,elapsedMs:n.elapsed});
 // A message stages safely while an open scene keeps its existing shell.
 await seed();await vm.runInContext('checkUpdate(true)',context);assert.equal(await(await shellCache.match(root)).text(),old.html);assert.equal(await(await shellCache.match(root+'__frame_pending_html__')).text(),fresh.html);out.cases.push({name:'message-stages-without-reload',pass:true});
 for(const name of ['bad-digest','truncated-html','offline']){await seed();bad=name==='bad-digest';truncated=name==='truncated-html';fail=name==='offline';n=await nav();assert.equal(n.html,old.html);await n.wait;assert.equal(await shellCache.match(root+'__frame_pending_html__'),undefined);out.cases.push({name,pass:true,elapsedMs:n.elapsed});bad=truncated=fail=false;}
 await seed();delay=2600;n=await nav();assert.equal(n.html,old.html);assert(n.elapsed>=1900&&n.elapsed<2400);assert.equal(await(await shellCache.match(root)).text(),old.html);await n.wait;assert.equal(await(await shellCache.match(root+'__frame_pending_html__')).text(),fresh.html);delay=0;out.cases.push({name:'bounded-fresh-wait-complete-old-fallback',pass:true,elapsedMs:n.elapsed});
 n=await nav();assert.equal(n.html,fresh.html);await n.wait;out.cases.push({name:'next-navigation-promotes-complete-background-stage',pass:true});
 await seed();const concurrent=await Promise.all([nav(),nav()]);for(const n of concurrent){assert.equal(n.html,fresh.html);await n.wait;}out.cases.push({name:'concurrent-navigation-no-serial-deadlock',pass:true});

 // Verified PENDING HTML with an evicted resource: no network in promotion.
 await seed();await shellCache.put(root+'__frame_pending_html__',new Response(fresh.html));assetDelay=2700;
 n=await nav();assert.equal(n.html,old.html);assert(n.elapsed>=1900&&n.elapsed<2400);await n.wait;assetDelay=0;
 assert.equal(await(await shellCache.match(root)).text(),old.html);
 out.cases.push({name:'evicted-pending-resource-slow-redownload-common-deadline',pass:true,elapsedMs:n.elapsed});
 n=await nav();assert.equal(n.html,fresh.html);await n.wait;
 // Late legacy-generation staging with shared asset/document caches.
 const old20={...old,html:old.html.replace(hash(oldBytes).slice(0,21),hash(oldBytes).slice(0,20)),url:old.url.replace(hash(oldBytes).slice(0,21),hash(oldBytes).slice(0,20))};
 const legacy=await caches.open('frame-shell-launch-v4');await legacy.put(root,new Response(old20.html));
 await shellCache.put(root,new Response(fresh.html));await shellCache.delete(root+'__frame_pending_html__');await assets.put(fresh.url,new Response(fresh.bytes));
 // Old current differs so the late older response really stages PENDING.
 await legacy.put(root,new Response(old20.html.replace('"version":"old"','"version":"older-current"')));
 // Simulate a late legacy worker write at the cache boundary; it cannot reach v5.
 await legacy.put(root+'__frame_pending_html__',new Response(old20.html));assert.equal(await(await legacy.match(root+'__frame_pending_html__')).text(),old20.html);
 fail=true;n=await nav();assert.equal(n.html,fresh.html);await n.wait;fail=false;
 out.cases.push({name:'late-older-generation-stage-cannot-roll-back-offline-shell',pass:true});
 out.preserved={document:await(await docs.match(root+'doc')).text(),scene:await(await scene.match(root+'scene')).text()};assert.deepEqual(out.preserved,{document:'doc sentinel',scene:'scene sentinel'});out.pass=true;
}catch(e){out.reason=String(e);out.stack=e.stack;process.exitCode=1;}finally{console.log(JSON.stringify(out));}
