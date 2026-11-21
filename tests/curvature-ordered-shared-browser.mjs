import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const session=await launch({headless:process.argv.includes('--headless')});
const {page}=session,pageErrors=[];
page.on('pageerror',error=>pageErrors.push(error.message));
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const buildErrors=async()=>page.evaluate(()=>window.__curvatureOrderedGpu.errors);
const stats=index=>page.evaluate(i=>frameEngine.renderer.replicaDraws?.get(i)??null,index);
const none=()=>call('scene.select',{ids:[]});
const vertices=[0,0,0,12,0,0,0,12,0,0,0,5],indices=[0,2,1,0,1,3,0,3,2,1,2,3];
const geomProbes=Array.from({length:4},(_,t)=>[.25,.33,.42].reduce((a,w,k)=>a.map((v,i)=>v+vertices[indices[3*t+k]*3+i]*w),[0,0,0]));
const copies=(id,other)=>page.evaluate(([a,b])=>{
 const data={[a]:{count:0,frames:0,materials:0,samples:[]},[b]:{count:0,frames:0,materials:0,samples:[]}};
 for(const m of frameEngine.scene.meshes){
  const o=data[m.hashId];if(!o||!m.replicaMatrix)continue;
  o.count++;if(m.objectFrame)o.frames++;if(m.materialBindings)o.materials++;
  if(o.samples.length<10&&m.frameVisible&&Math.abs(m.frameWorld[12])<180&&Math.abs(m.frameWorld[13])<90)
   o.samples.push({key:m.replicaKey,matrix:Array.from(m.frameWorld),base:m.faceBase});
 }
 return data;
},[id,other]);
const pos=async(id,samples)=>{
 const r=await page.evaluate(async({samples,probes})=>{
  const rect=document.getElementById('frame-engine-canvas').getBoundingClientRect(),coords=[];
  for(const row of samples){
   const m=row.matrix;
   for(const p of probes){
    const v=[0,1,2].map(k=>m[12+k]+m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]);
    const {screen:q}=await frameAI.call('view.project',{point:v});
    if(q[0]>rect.left+2&&q[0]<rect.right-2&&q[1]>rect.top+2&&q[1]<rect.bottom-2)coords.push(q);
   }
  }
  return coords;
 },{samples,probes:geomProbes});
 assert.ok(r.length>=4,'Need projected interior probes for '+id);return r;
};
const pixels=async coords=>(await call('diagnostics.pixels',{points:coords})).colors;
const changed=(a,b)=>a.some((p,i)=>p.slice(0,3).reduce((d,v,k)=>d+Math.abs(v-b[i][k]),0)>12);
const waitPacked=async(id,mode,index,count,packed)=>{
 const end=performance.now()+30000;let state,draw;
 do{
  [state,draw]=await Promise.all([call('view.edgeAngles',{id}),stats(index)]);
  if(state.enabled&&!state.pending&&state.mode===mode&&state.fitCount===1&&state.readyFitCount===1&&state.occurrenceCount===count&&
    !state.displaySuspended&&draw?.curvaturePacked===count&&draw.packed===packed){
   assert.equal(state.fits[0].count,count);assert.ok(draw.curvatureInstances>0&&draw.curvatureCalls>0);return {state,draw};
  }
  await page.waitForTimeout(70);
 }while(performance.now()<end);
 assert.fail('Native shared Curvature failed to publish: '+JSON.stringify({id,index,count,packed,state,draw,errors:await buildErrors()}));
};
async function cachedStatus(hash,mode){
 const cache=await page.evaluate(async()=>{
  const renderer=frameEngine.renderer,canvas=document.getElementById('frame-engine-canvas'),end=performance.now()+7000;
  let sample;
  do{
   const before=renderer.geometryFrames,frame=+canvas.dataset.frameCount;
   await frameEngine.draw(false);await renderer.device.queue.onSubmittedWorkDone();
   sample={before,after:renderer.geometryFrames,frame,presented:+canvas.dataset.frameCount,passes:JSON.parse(canvas.dataset.gpuPasses)};
   if(sample.presented>frame&&!sample.passes.geometry&&sample.after===before)return {...sample,cached:true};
   await new Promise(resolve=>setTimeout(resolve,30));
  }while(performance.now()<end);
  return {...sample,cached:false,drawError:canvas.dataset.replicaDrawError};
 });
 assert.ok(cache.cached,JSON.stringify(cache));
 const current=await call('view.edgeAngles',{id:hash});
 assert.equal(current.mode,mode);
 assert.equal(current.displaySuspended,false,'Cached presentation must not erase shared Curvature readiness');
 assert.equal(current.displayReason,null);
}
async function denseFrame(before=false){
 await call('diagnostics.frame',{frames:1});
 return page.evaluate(async before=>{
  const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256;
  const b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);
   d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
   const raw=new Uint8Array(b.getMappedRange()),prior=window.__orderedCurvaturePixels;
   if(before)window.__orderedCurvaturePixels=raw.slice();
   else if(prior?.length!==raw.length)throw Error('Dense Curvature must compare identical viewport sizes');
   const colored=[0,0],changed=[0,0];
   for(let y=Math.floor(h*.12);y<Math.floor(h*.88);y++)for(let x=8;x<w-8;x++){
    const p=y*stride+x*4,k=x<w/2?0:1;
    if(Math.max(raw[p],raw[p+1],raw[p+2])>65)colored[k]++;
    if(!before&&Math.abs(raw[p]-prior[p])+Math.abs(raw[p+1]-prior[p+1])+Math.abs(raw[p+2]-prior[p+2])>12)changed[k]++;
   }
   return {width:w,height:h,colored,changed};
  }finally{if(b.mapState==='mapped')b.unmap();b.destroy();}
 },before);
}
async function clone(name,x,y,material=null){
 const source=await call('mesh.create',{name:name+' source',vertices,indices});
 if(material)await call('material.assign',{id:source.hash,material:material.uid});
 return call('scene.create',{type:'cloner',name,inputs:[source.hash],params:{type:'matrix','count x':x,'count y':y,'count z':1,'spacing x':16,'spacing y':16}});
}
async function mode(hash,value){
 const row=(await call('scene.inspect')).objects.find(o=>o.hash===hash);
 await page.locator('#row-'+row.id+' .ob-tag.curvature').click();
 const b=page.locator('#attrContent [data-field="mode"][data-value="'+value+'"]');
 await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true');
 await none();
}
async function focus(hashes,index,shading='solid',single=true){
 await call('scene.select',{ids:hashes});
 await call('view.set',{index,single,mode:'object',shading,focusSelection:true});
 await none();
}
async function pickExpected(coords,hash){
 const observed=[];
 for(const [x,y]of coords){
  const hit=await call('selection.pick',{x,y});
  if(hit.objects.includes(hash)){
   assert.deepEqual(hit.objects,[hash],'Cloner owns its surface pick');
   assert.equal(hit.occurrence,null,'Cloner pick must not expose a Symmetry source occurrence');
   const {point}=await call('view.pick',{x,y});
   assert.ok(point?.length===3&&point.every(Number.isFinite),'Native surface must return a finite navigation hit');
   return {x,y,point};
  }
  observed.push({x,y,objects:hit.objects,occurrence:hit.occurrence});
 }
 assert.fail('None of the actual clone probes picked its owner '+hash+': '+JSON.stringify(observed));
}
try{
 await ready(page);
 await page.evaluate(()=>{
  const device=frameEngine.renderer.device,errors=[];
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
  window.__curvatureOrderedGpu={device,errors};
 });
 await call('scene.new');
 const opaque=await call('material.create',{name:'Opaque pink clone material',params:{h:322,s:88,l:55}}),
  glass=await call('material.create',{name:'Translucent sibling',params:{h:7,s:85,l:55,opac:45}});
 const a=await clone('Native 128 shared fits',16,8,opaque),b=await clone('Independent translucent 256',16,16,glass);
 await call('transform.apply',{ids:[b.hash],position:[370,0,14]});
 await focus([a.hash,b.hash],2);
 const prior128=await copies(a.hash,b.hash),points=await pos(a.hash,prior128[a.hash].samples),ordinary=await pixels(points);
 const hitBefore=await pickExpected(points,a.hash);await none();
 await call('view.edgeAngles',{id:a.hash,enabled:true});
 const first=await waitPacked(a.hash,'Angle',2,128,384);
 assert.ok(changed(ordinary,await pixels(points)),'Angle must change actual ordered pixels');
 assert.ok(first.draw.instances>first.draw.curvatureInstances,'The unrelated material run is still batched');
 const hitAfter=await pickExpected([[hitBefore.x,hitBefore.y]],a.hash);
 assert.ok(hitAfter.point.every((v,i)=>Math.abs(v-hitBefore.point[i])<1e-4),'Overlay must retain the same picked world surface');
 await none();

 await call('scene.update',{id:a.hash,params:{'count x':129,'count y':1}});
 await focus([a.hash],2);
 const prior129=await copies(a.hash,b.hash);
 const expanded=await waitPacked(a.hash,'Angle',2,129,385);
 assert.equal(expanded.state.displayReason,null);
 assert.equal(expanded.state.triangleCount,4,'Fit cost follows source, not 129 replicas');
 const positions129=await pos(a.hash,prior129[a.hash].samples),overlay129=await pixels(positions129);
 const pick129=await pickExpected(positions129,a.hash);await none();
 await call('view.edgeAngles',{id:a.hash,enabled:false});
 assert.ok(changed(await pixels(positions129),overlay129),'The new 129-copy case must change real pixels too');
 const plain129=await pickExpected([[pick129.x,pick129.y]],a.hash);await none();
 assert.ok(plain129.point.every((v,i)=>Math.abs(v-pick129.point[i])<1e-4),'129 copies preserve the same selected world surface');
 await call('view.edgeAngles',{id:a.hash,enabled:true});
 await waitPacked(a.hash,'Angle',2,129,385);
 await cachedStatus(a.hash,'Angle');
 await mode(a.hash,'Surface Prediction');
 assert.equal((await waitPacked(a.hash,'Surface Prediction',2,129,385)).state.prediction.policy,'polygon-angle');
 assert.deepEqual((await copies(a.hash,b.hash))[b.hash],prior129[b.hash],'Translucent siblings must not acquire Curvature or more descriptors');
 await focus([a.hash],0,'solid-wire',false);
 await waitPacked(a.hash,'Surface Prediction',0,129,385);
 await page.waitForFunction(()=>frameEngine.renderer.replicaDraws?.get(2)?.curvaturePacked===129,{},{timeout:15000});
 assert.equal((await call('view.edgeAngles',{id:b.hash})).enabled,false);
 await call('view.set',{index:2,single:false,mode:'object',shading:'solid-wire'});
 await waitPacked(a.hash,'Surface Prediction',2,129,385);
 await cachedStatus(a.hash,'Surface Prediction');
 console.log('128/129 occupied pixels and pick, cached redraw, mixed material isolation, Prediction and native solid-wire quadrants passed.');

 await call('scene.new');
 const upstream=await clone('65 canonical child occurrences',13,5);
 await call('transform.apply',{ids:[upstream.hash],position:[205,0,0]});
 const symmetry=await call('scene.create',{type:'symmetry',name:'Reflected Cloner shared fit',inputs:[upstream.hash],
  params:{X:true,Y:false,Z:false,'Morph symmetry':false}});
 await focus([symmetry.hash],2);
 await call('view.edgeAngles',{id:symmetry.hash,enabled:true});
 const reflected=await waitPacked(symmetry.hash,'Angle',2,130,195);
 assert.equal(reflected.state.fitCount,1,'Nested replicas with one canonical source share one fit');
 assert.equal((await call('view.edgeAngles',{id:upstream.hash})).enabled,false);

 if(process.argv.includes('--dense')){
  for(const reverse of [false,true]){
   await call('scene.new');
   const heavyColor=await call('material.create',{name:'Opaque dense',params:{h:322,s:88,l:55}}),
    heavyGlass=await call('material.create',{name:'Dense translucent',params:{h:7,s:85,l:55,opac:45}});
   let first,second;
   if(reverse){second=await clone('50k untagged first',250,200,heavyGlass);first=await clone('100k tagged second',400,250,heavyColor);}
   else{first=await clone('100k tagged first',400,250,heavyColor);second=await clone('50k untagged second',250,200,heavyGlass);}
   await call('transform.apply',{ids:[second.hash],position:[7500,0,14]});
   await focus([first.hash,second.hash],2);
   const denseBefore=await denseFrame(true);
   assert.ok(denseBefore.colored.every(n=>n>100),JSON.stringify({denseBefore,reverse}));
   const baseline=await copies(first.hash,second.hash);
   assert.equal(baseline[first.hash].count,100000);assert.equal(baseline[second.hash].count,50000);
   await call('view.edgeAngles',{id:first.hash,enabled:true});
   const result=await waitPacked(first.hash,'Angle',2,100000,150000);
   assert.equal(result.state.fitCount,1);assert.equal(result.state.triangleCount,4);
   const current=await copies(first.hash,second.hash);
   assert.ok(current[first.hash].frames<=baseline[first.hash].frames+2,JSON.stringify({baseline,current}));
   assert.ok(current[second.hash].frames<=baseline[second.hash].frames+2,JSON.stringify({baseline,current}));
   assert.ok(current[first.hash].materials<=baseline[first.hash].materials+2,JSON.stringify({baseline,current}));
   assert.ok(current[second.hash].materials<=baseline[second.hash].materials+2,JSON.stringify({baseline,current}));
   const denseAfter=await denseFrame();
   assert.ok(denseAfter.colored.every(n=>n>100)&&Math.max(...denseAfter.changed)>100,JSON.stringify({reverse,denseBefore,denseAfter}));
   assert.ok(Math.min(...denseAfter.changed)<Math.max(...denseAfter.changed)*.1,JSON.stringify({reverse,denseBefore,denseAfter}));
   console.log('Dense shared-native Curvature',JSON.stringify({reverse,denseBefore,denseAfter,draw:result.draw,
    descriptors:[first.hash,second.hash].map(hash=>[current[hash].frames,current[hash].materials])}));
  }
 }
 const gpu=await page.evaluate(async()=>{
  const {device,errors}=window.__curvatureOrderedGpu;await device.queue.onSubmittedWorkDone();
  return {validation:(await device.popErrorScope())?.message??null,memory:(await device.popErrorScope())?.message??null,errors};
 });
 assert.deepEqual(gpu,{validation:null,memory:null,errors:[]});assert.deepEqual(pageErrors,[]);
 console.log('Native Curvature: shared fit, threshold crossing, real pixels and pick identity, mixed transparency, orthographic and wire/quad.');
}finally{await session.close();}
