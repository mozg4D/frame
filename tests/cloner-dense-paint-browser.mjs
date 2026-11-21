import {readFile} from 'node:fs/promises';
import {launch,ready} from '../tools/browser.mjs';
import assert from 'node:assert/strict';
const session=await launch({headless:true}),page=session.page;
const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
async function add(label,h,x,depth,alpha){
 const m=await call('mesh.create',{name:label+' source',vertices:[-3,-3,0,3,-3,0,0,3,0,-2,-2,2],indices:[0,2,1,0,1,3,1,2,3,2,0,3]});
 const mat=await call('material.create',{name:label+' paint',params:{h,s:100,l:52,opac:alpha}});
 await call('material.assign',{id:m.hash,material:mat.uid});
 const obj=await call('scene.create',{type:'cloner',name:label,inputs:[m.hash],params:{type:'matrix','count x':1,'count y':1,'count z':depth,'spacing x':8,'spacing y':8,'spacing z':8}});
 await call('transform.apply',{ids:[obj.hash],position:[x,0,0]});
 return obj;
}
const stat=async id=>{
 const r=await call('diagnostics.replicas',{id,limit:0});
 const native=await page.evaluate(id=>{const n=frameNodeByHash(id);return {error:n?.splineError??null,authored:[n?.params['count x'],n?.params['count y'],n?.params['count z']]};},id);
 return {count:r.count,visible:r.visible,batch:r.resources?.batchedDraws,...native};
};
async function pixels(ids){
 await call('diagnostics.frame',{frames:1});
 return page.evaluate(async()=>{
  const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256,b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
   const a=new Uint8Array(b.getMappedRange()),v=[0,0];
   for(let y=Math.round(h*.12);y<Math.round(h*.88);y++)for(let x=8;x<w-8;x++){
    const i=y*stride+x*4,rr=a[i],g=a[i+1],bb=a[i+2];
    if(Math.max(rr,g,bb)>45)v[x<w/2?0:1]++;
   }
   return {width:w,height:h,coloredHalves:v};
  }finally {if(b.mapState==='mapped')b.unmap();b.destroy();}
 });
}
const gpu=()=>page.evaluate(()=>{
 const r=frameEngine.renderer,ms=frameEngine.scene.meshes.filter(m=>m.replicaMatrix);
 return {n:ms.length,frameObjects:ms.filter(m=>m.objectFrame).length,materialBindings:ms.filter(m=>m.materialBindings).length,pipelinePending:r.materialState?.replicaPending?.size??null,pipelines:r.materialState?.replicaPipelines?.size??null,ordered:r.orderedReplicas?.instances??null,allocationBytes:document.querySelector('#frame-engine-memory').dataset.bufferBytes,opacity:materials.map(m=>[m.name,m.opac])};
});
const cachedSHA=(phase='')=>page.evaluate(async phase=>{
 const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256;
 const b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=new Uint8Array(b.getMappedRange());
 if(phase==='batched')window.qaOITPixels=Uint8Array.from(data);
 if(phase==='ordinary'){const prior=window.qaOITPixels;let changed=0,max=0,first=[],sky=[0,0];const hist={};for(let i=0;i<data.length;i+=4){const d=Math.max(...[0,1,2,3].map(k=>Math.abs(data[i+k]-prior[i+k])));if(Math.max(...data.slice(i,i+3))-Math.min(...data.slice(i,i+3))>12)sky[0]++;if(Math.max(...prior.slice(i,i+3))-Math.min(...prior.slice(i,i+3))>12)sky[1]++;if(d){changed++;max=Math.max(max,d);hist[d]=(hist[d]||0)+1;if(first.length<12)first.push([i/4,Array.from(data.slice(i,i+4)),Array.from(prior.slice(i,i+4))]);}}return {changed,max,first,sky,hist};}
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).join(',');}
 finally{if(b.mapState==='mapped')b.unmap();b.destroy();}
},phase);
const start=performance.now();
try{
 const raw=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const anchor='    function prepareOrderedReplicaDraw(r){';
 assert.equal(raw.split(anchor).length,2);
 await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:raw.replace(anchor,anchor+'if(globalThis.qaForceOrderedFallback)return null;')}));
 await page.goto(session.url+'/index.html');
 await ready(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>{const d=frameEngine.renderer.device;window.qaOITValidation={d,errors:[]};d.pushErrorScope('validation');d.addEventListener('uncapturederror',e=>qaOITValidation.errors.push(e.error.message));});
 const runs=[];
 for(const reversed of [false]){
   await call('scene.new');
   const order=reversed?[['Second',110,1300,1,40],['First',0,-1300,1,40]]:[['First',0,-1300,1,process.argv.includes('--opaque')?0:40],['Second',110,1300,1,process.argv.includes('--mixed')||process.argv.includes('--opaque')?0:40]];
   const map={};for(const q of order)map[q[0]]=await add(...q);
   const a=map.First.hash,b=map.Second.hash;
   await call('scene.select',{ids:[a,b]});
   await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focusSelection:true});
   await call('scene.select',{ids:[]});
   for(const id of [a,b])await call('scene.update',{id,params:{'count x':20,'count y':20}});
   await call('diagnostics.frame',{frames:4});
   await page.waitForFunction(()=>{const r=frameEngine.renderer;return r.materialState?.replicaPipelines?.size>=1&&!r.materialState?.replicaPending?.size;},{},{timeout:12000}).catch(e=>console.log('material warm wait: '+e.message));
   console.log('material warm evidence',JSON.stringify(await gpu()));
   await call('diagnostics.frame',{frames:3});
   const batchedSHA=await cachedSHA('batched');
   await page.evaluate(()=>{window.qaForceOrderedFallback=true;});await call('diagnostics.frame',{frames:3});
   await page.waitForFunction(()=>!frameEngine.renderer.materialState?.pending?.size,{},{timeout:12000});
   await call('diagnostics.frame',{frames:3});
   const ordinarySHA=await cachedSHA(),delta=await cachedSHA('ordinary');
   console.log('OIT settled pixel delta',JSON.stringify(delta));
   assert.equal(delta.changed,0,'All RGBA pixels match the ordinary path');
   assert.equal(ordinarySHA,batchedSHA,'Same settled geometry and camera: OIT instanced framebuffer exactly equals ordinary per-copy rendering');
   console.log('OIT framebuffer parity at 800 occurrences',batchedSHA);
   await page.evaluate(()=>{window.qaForceOrderedFallback=false;});
   for(const id of [a,b])await call('scene.update',{id,params:{'count x':250,'count y':200}});
   const before={reversed,phase:'below-native',a:await stat(a),b:await stat(b)};
   console.log(JSON.stringify({...before,gpu:await gpu()}));
   const below={reversed,phase:'50000+50000',a:await stat(a),b:await stat(b),pixels:await pixels([a,b]),ms:Math.round(performance.now()-start)};
   runs.push(below);console.log(JSON.stringify(below));
   console.log('warm paint steady state',JSON.stringify(await gpu()));
   await call('scene.select',{ids:[a,b]}); console.log('large select complete',JSON.stringify(await gpu()));
   await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focusSelection:true}); console.log('same warmed view focus complete',JSON.stringify(await gpu()));
   await call('scene.select',{ids:[]}); console.log('deselect complete',JSON.stringify(await gpu()));
   await call('view.set',{index:3,single:true,shading:'solid',mode:'object'}); console.log('switch compatible view',JSON.stringify(await gpu()));
   const beforeSwitch=await gpu(),stablePixels=await cachedSHA();
   await page.evaluate(()=>{
     const proto=GPUDevice.prototype,original=proto.createRenderPipelineAsync;
     let release;const hold=new Promise(fn=>release=fn);
     window.qaDensePipelineHold={release,hit:0};
     proto.createRenderPipelineAsync=function(options){
       if(!options.label?.startsWith('native instanced material false:'))return original.call(this,options);
       window.qaDensePipelineHold.hit++;
       return hold.then(()=>original.call(this,options));
     };
   });
   await call('view.set',{index:0,single:true,shading:'solid',mode:'object'}); console.log('switch cold perspective',JSON.stringify(await gpu()));
   assert.ok(await page.evaluate(()=>qaDensePipelineHold.hit)>0,'A real cold perspective pipeline request was held');
   assert.equal(await cachedSHA(),stablePixels,'Pending dense pipeline preserves the exact last complete GPU color target');
   await page.evaluate(()=>qaDensePipelineHold.release());
   await page.waitForFunction(pipelines=>{const g=frameEngine.renderer.materialState;return g?.replicaPipelines?.size>pipelines&&!g.replicaPending?.size;},beforeSwitch.pipelines,{timeout:12000});
   await call('diagnostics.frame',{frames:2});const afterSwitch=await gpu();console.log('after cold shader settle',JSON.stringify(afterSwitch));
   assert.ok(afterSwitch.frameObjects<=beforeSwitch.frameObjects+16,'Dense cold view must not materialize all occurrence frames');
   assert.ok(afterSwitch.materialBindings<=beforeSwitch.materialBindings+16,'Dense cold view must retain compact material bindings');
   assert.notEqual(await cachedSHA(),stablePixels,'Ready perspective frame replaces prior orthographic pixels');
   assert.ok(afterSwitch.frameObjects<1000,JSON.stringify(afterSwitch));
   await call('scene.update',{id:a,params:{'count z':2}});
   await call('scene.select',{ids:[a,b]});
   await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focusSelection:true});
   await call('scene.select',{ids:[]});
   const expanded=await gpu();assert.equal(expanded.ordered,150000);assert.ok(expanded.frameObjects<1024&&expanded.materialBindings<1024,JSON.stringify(expanded));
   console.log('150k expanded GPU capacity and material proof',JSON.stringify(expanded));
   const diagnostic={reversed,phase:'over-native',a:await stat(a),b:await stat(b)};
   console.log(JSON.stringify(diagnostic));
   const gpuErrors=await page.evaluate(async()=>({scope:(await qaOITValidation.d.popErrorScope())?.message??null,uncaptured:qaOITValidation.errors}));
   assert.deepEqual(gpuErrors,{scope:null,uncaptured:[]});assert.deepEqual(errors,[]);
   const above={reversed,phase:'100000+50000',a:await stat(a),b:await stat(b),pixels:await pixels([a,b]),ms:Math.round(performance.now()-start)};
   runs.push(above);console.log(JSON.stringify(above));
 }
 for(const r of runs.filter(x=>x.phase==='50000+50000'))assert.deepEqual([r.a.count,r.b.count],[50000,50000]);
 const desired=true;
 for(const r of runs.filter(x=>x.phase==='100000+50000')){
  const result=desired?[100000,50000]:r.reversed?[100000,0]:[0,50000];
  assert.deepEqual([r.a.count,r.b.count],result);
  if(desired)assert.ok(r.pixels.coloredHalves.every(n=>n>8000),JSON.stringify(r.pixels));
 }
 console.log('Dual large Cloner native test completed.');
}finally{await session.close();}
