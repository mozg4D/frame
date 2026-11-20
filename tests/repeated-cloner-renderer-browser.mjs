import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const html=new URL('../index.html',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const sourceSHA256=sha(await readFile(html)),session=await launch({headless:true}),page=session.page;
const errors=[],rows=[],call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
const median=a=>[...a].sort((x,y)=>x-y)[a.length>>1];
let report={sourceSHA256,rows,errors,pass:false};

async function pixels(){
  return page.evaluate(async()=>{
    const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256;
    const buffer=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=d.createCommandEncoder();
      encoder.copyTextureToBuffer({texture:r.cachedColor},{buffer,bytesPerRow:stride},[w,h]);
      d.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const mapped=new Uint8Array(buffer.getMappedRange()),bytes=new Uint8Array(w*h*4);
      let green=0;
      for(let y=0;y<h;y++){
        const row=mapped.subarray(y*stride,y*stride+w*4);bytes.set(row,y*w*4);
        for(let i=0;i<row.length;i+=4)if(row[i+1]>Math.max(row[i],row[i+2])+12)green++;
      }
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      return {digest:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''),green};
    }finally{buffer.destroy();}
  });
}
async function frames(name,id){
  await call('diagnostics.frame',{frames:3});
  const {frames,timestampQueries}=await call('diagnostics.frame',{frames:8});
  assert.equal(timestampQueries,true);
  const sample={name,cpuMs:median(frames.map(f=>f.cpuMs)),gpuMs:median(frames.map(f=>f.gpuMs)),frames};
  if(id)sample.counts=(await call('diagnostics.replicas',{id,limit:0})).resources;
  rows.push(sample);
  console.log(JSON.stringify({name,cpuMs:sample.cpuMs,gpuMs:sample.gpuMs,draws:sample.counts?.batchedDraws}));
  return sample;
}
async function forestEdgePan(id){
  await call('scene.select',{ids:[]});
  await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:id});
  const vp=await page.locator('#frame-engine-canvas').boundingBox(),x=Math.round(vp.x+vp.width*.6),y=Math.round(vp.y+vp.height*.43);
  const screenEdge=page.evaluate(()=>new Promise(resolve=>document.addEventListener('pointermove',e=>{
    resolve((screen.availLeft||0)+screen.availWidth-2-(e.screenX-e.clientX));
  },{once:true,capture:true})));
  await page.mouse.move(x,y);
  const edge=await screenEdge;
  await page.mouse.down({button:'middle'});
  try{
    await page.mouse.move(edge,y);
    await page.waitForFunction(()=>document.pointerLockElement?.id==='frame-engine-canvas'&&framePointerLock&&!framePointerLock.pending);
    const atEdge=await page.evaluate(()=>[framePointerLock.x,framePointerLock.y]);
    assert.deepEqual(atEdge,[edge,y],'Acquiring pointer lock preserves the virtual cursor at the screen edge');
    const a=(await call('scene.inspect')).view.camera;
    await page.mouse.move(edge+16,y+8);
    const b=(await call('scene.inspect')).view.camera,unit=2*a[11]*Math.tan(Math.PI/8)/vp.height;
    const after=await page.evaluate(()=>[framePointerLock.x,framePointerLock.y]);
    assert.deepEqual(after,[edge+16,y+8],'Dense forest retains the first pointer delta after lock');
    const delta=[b[3]-a[3],b[4]-a[4]],expected=[16*unit,-8*unit];
    assert.ok(delta.every((v,i)=>Math.abs(v-expected[i])<1e-6),JSON.stringify({delta,expected,a,b,vp}));
  }finally{
    await page.mouse.up({button:'middle'});
  }
  await page.waitForFunction(()=>!document.pointerLockElement&&!framePointerLock);
}

async function forestPanWhileGPUIsBusy(){
  const rect=await page.locator('#frame-engine-canvas').boundingBox(),x=Math.round(rect.x+rect.width*.40),y=Math.round(rect.y+rect.height*.48);
  await page.mouse.move(x,y);await page.mouse.down({button:'middle'});
  const state=()=>page.evaluate(()=>({camera:Array.from(frameEngine.viewState).slice(0,12),frames:frameEngine.renderer.geometryFrames}));
  await page.evaluate(()=>{
    const queue=frameEngine.renderer.device.queue,native=queue.onSubmittedWorkDone.bind(queue);
    const slow=new Promise(resolve=>{window.__releaseNavFence=()=>{delete queue.onSubmittedWorkDone;resolve();};});
    queue.onSubmittedWorkDone=()=>Promise.all([native(),slow]);
  });
  try{
    await page.mouse.move(x+12,y);await page.waitForFunction(()=>!!frameEngine.renderer.navigationFrameFence);
    const initial=await state();
    for(const dx of [28,48,70,93,108]){
      await page.mouse.move(x+dx,y);await page.evaluate(()=>new Promise(requestAnimationFrame));
    }
    const latest=await state();
    assert.equal(latest.frames,initial.frames,'Busy GPU receives no intermediate pan frames');
    assert.notDeepEqual(latest.camera,initial.camera,'Camera input advances while the GPU is busy');
    await page.mouse.up({button:'middle'});
    await page.evaluate(()=>__releaseNavFence());
    await page.waitForFunction(n=>frameEngine.renderer.geometryFrames>n,latest.frames);
    assert.deepEqual((await state()).camera,latest.camera,'Only the released pose is presented');
  }finally{
    await page.evaluate(()=>{window.__releaseNavFence?.();delete window.__releaseNavFence;});
    await page.mouse.up({button:'middle'});
  }
}

async function forestNavigationWithDelayedPick(){
  const canvas=page.locator('#frame-engine-canvas'),rect=await canvas.boundingBox();
  const x=Math.round(rect.x+rect.width*.38),y=Math.round(rect.y+rect.height*.45);
  const camera=()=>page.evaluate(()=>Array.from(frameEngine.viewState).slice(0,12));
  for(const gesture of ['left','right','wheel']){
    await page.mouse.move(x,y);
    await page.evaluate(()=>{
      const original=GPUBuffer.prototype.mapAsync;
      let release;
      const held=new Promise(resolve=>{release=resolve;});
      window.__forestPick={reads:0,release:()=>{GPUBuffer.prototype.mapAsync=original;release();}};
      GPUBuffer.prototype.mapAsync=function(...args){
        const mapped=original.apply(this,args);
        if(this.label!=='pooled pick readback')return mapped;
        __forestPick.reads++;
        return Promise.all([mapped,held]).then(()=>{});
      };
    });
    try{
      const start=await camera();
      if(gesture==='wheel'){
        await page.evaluate(()=>window.addEventListener('wheel',()=>{frameEngine.renderer.lastFrameRaw.gpuMs=32;},{capture:true,once:true}));
        await page.mouse.wheel(0,-60);
      }else await page.mouse.down({button:gesture});
      await page.waitForFunction(()=>__forestPick.reads>0);
      if(gesture!=='wheel')await page.mouse.move(x+61,y+22,{steps:3});
      await page.waitForFunction(before=>before.some((v,i)=>v!==frameEngine.viewState[i]),start,{timeout:2000})
        .catch(e=>{throw Error(gesture+' navigation waited for the delayed surface pick',{cause:e});});
      if(gesture!=='wheel')await page.mouse.up({button:gesture});
      const last=await camera();
      await page.evaluate(()=>__forestPick.release());
      await page.waitForFunction(()=>frameEngine.renderer.pickPool.every(s=>!s.busy));
      assert.deepEqual(await camera(),last,'Delayed surface pick leaves completed '+gesture+' navigation in place');
    }finally{
      await page.evaluate(()=>{__forestPick.release();delete window.__forestPick;});
      if(gesture!=='wheel')await page.mouse.up({button:gesture});
    }
  }
}

try{
  page.on('pageerror',e=>errors.push(e.stack));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready(page);
  report.adapter=await page.evaluate(()=>{
    const d=window.__replicaDevice=frameEngine.renderer.device;window.__replicaErrors=[];window.__replicaLost=null;
    d.addEventListener('uncapturederror',e=>__replicaErrors.push(e.error.message));
    d.lost.then(x=>window.__replicaLost=x.message||x.reason);d.pushErrorScope('validation');
    const a=d.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,isFallbackAdapter:a.isFallbackAdapter};
  });
  assert.equal(report.adapter.isFallbackAdapter,false);

  const mesh=await call('mesh.create',{vertices:[0,0,0,40,0,0,0,40,0,0,0,40],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});
  const grid=await call('scene.create',{type:'cloner',inputs:[mesh.hash],params:{'count x':10,'count y':10,'count z':10}});
  await call('scene.select',{ids:[]});
  await call('view.set',{index:0,single:true,mode:'object',focus:grid.hash});
  await page.mouse.move(5,5);
  for(const shading of ['solid','solid-isoparms','wireframe']){
    await call('view.set',{shading});
    if(shading==='wireframe')await page.waitForFunction(()=>frameEngine.renderer.wireRaster);
    const batch=await frames(shading+' ordered',grid.hash);
    assert.equal(batch.counts.batchedDraws.instances,1000);
    assert.equal(batch.counts.batchedDraws.calls,1);
    const exact=await pixels();
    await page.evaluate(()=>{
      const r=frameEngine.renderer;window.__savedReplicaPlan=r.orderedReplicas;
      r.orderedReplicas={...r.orderedReplicas,buffer:null};
    });
    try{
      const ordinary=await frames(shading+' ordinary',grid.hash);
      assert.equal(ordinary.counts.batchedDraws.instances,0);
      assert.equal((await pixels()).digest,exact.digest,'Exact native pixels survive ordered instancing');
    }finally{await page.evaluate(()=>{frameEngine.renderer.orderedReplicas=__savedReplicaPlan;delete window.__savedReplicaPlan;});}
  }
  await call('scene.new');

  const tree=await call('scene.create',{type:'tree'});
  const circle=await call('scene.create',{type:'circle',params:{diameter:1800000}});
  const disk=await call('scene.create',{type:'spline_patch',inputs:[circle.hash]});
  const started=performance.now();
  const forest=await call('scene.create',{type:'cloner',inputs:[tree.hash],params:{
    type:'object',object:disk.hash,count:50000,'random angle y':180
  }});
  report.createMs=performance.now()-started;
  console.log('Create 50000 selected procedural trees: '+report.createMs+' ms');
  assert.ok(report.createMs<8000,'50k placements, exact bounds and first rendered frame complete within 8 seconds');
  assert.equal(forest.buildError,null);
  await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:forest.hash});
  const solid=await frames('50000 trees Solid',forest.hash);
  assert.equal(solid.counts.positions,1);assert.equal(solid.counts.normals,1);assert.equal(solid.counts.indices,1);
  assert.equal(solid.counts.batchedDraws.instances,50000);
  assert.ok(solid.counts.batchedDraws.calls<=128);
  assert.ok(solid.counts.batchedDraws.previewInstances>=45000,'Rotation alone does not inflate the projected tree diameter');
  assert.ok(solid.counts.ownedBuffers<128,'Viewport never requires separate GPU uniform objects for all copies');
  assert.ok(solid.cpuMs<12&&solid.gpuMs<55);
  assert.ok((await pixels()).green>2000,'The shared wood and cutout foliage are painted in the distant view');
  const placement=await call('diagnostics.replicas',{id:forest.hash,limit:0});
  report.treeTriangles=tree.mesh.triangles;report.forestTriangles=placement.triangles;report.diskTriangles=disk.mesh.triangles;
  assert.equal(placement.triangles,tree.mesh.triangles*50000);
  assert.equal(placement.distribution.preparations,1);
  await forestEdgePan(forest.hash);
  await forestPanWhileGPUIsBusy();
  await forestNavigationWithDelayedPick();
  await call('view.set',{focus:tree.hash});
  await call('diagnostics.frame',{frames:1});
  const close=(await call('diagnostics.replicas',{id:forest.hash,limit:0})).resources.batchedDraws;
  assert.ok(close.instances>0&&close.previewInstances<close.instances,'Visible nearby trees retain their full geometry');
  await call('view.set',{focus:forest.hash});

  await call('view.set',{shading:'solid-isoparms'});
  const lines=await frames('50000 trees exact Solid + Isoparms',forest.hash);
  assert.equal(lines.counts.batchedDraws.instances,50000);
  assert.equal(lines.counts.batchedDraws.previewInstances,0);
  assert.ok(lines.cpuMs<18&&lines.gpuMs<125);

  await call('view.set',{shading:'wireframe'});
  await page.waitForFunction(()=>frameEngine.renderer.wireRaster);
  const wire=await frames('50000 trees Wire',forest.hash);
  assert.equal(wire.counts.batchedDraws.instances,50000);
  assert.ok(wire.counts.batchedDraws.calls<=128);
  assert.ok(wire.counts.ownedBuffers<128,'Wire uses shared replica buffers from its first draw');

  await call('view.set',{index:1,shading:'solid',focus:forest.hash});
  const top=await frames('50000 trees Top Solid',forest.hash);
  assert.ok(top.counts.batchedDraws.previewInstances>=45000);
  await call('scene.create',{type:'render',params:{samples:1,realtime:'off',environment:'off'}});
  await call('scene.select',{ids:[]});
  await call('view.set',{index:0,shading:'solid',focus:forest.hash});
  const startedCamera=performance.now();
  await call('render.start');
  report.camera={wallMs:performance.now()-startedCamera,...await call('render.inspect')};
  assert.equal(report.camera.phase,'complete');
  assert.equal(report.camera.triangles,placement.triangles+disk.mesh.triangles);
  assert.equal(report.camera.storedTriangles,tree.mesh.triangles+disk.mesh.triangles);
  assert.equal(report.camera.uniqueGeometry,2);
  assert.ok(report.camera.snapshot.materials<=4);
  await call('scene.update',{id:forest.hash,visible:false});
  await call('diagnostics.frame',{frames:3});
  assert.equal((await call('diagnostics.replicas',{id:forest.hash,limit:0})).visible,0);
  await call('edit.history',{action:'undo'});
  assert.equal((await call('diagnostics.replicas',{id:forest.hash,limit:0})).visible,50000);
  await call('scene.new');
  report.gpu=await page.evaluate(async()=>{
    await __replicaDevice.queue.onSubmittedWorkDone();
    return {validation:(await __replicaDevice.popErrorScope())?.message||null,errors:__replicaErrors,
      lost:__replicaLost,replaced:__replicaDevice!==frameEngine.renderer.device};
  });
  assert.deepEqual(report.gpu,{validation:null,errors:[],lost:null,replaced:false});
  assert.deepEqual(errors,[]);
  assert.equal(sha(await readFile(html)),sourceSHA256);
  report.pass=true;
}catch(error){
  report.error=error.stack;process.exitCode=1;
}finally{
  await session.close();
  await mkdir(new URL('results/',import.meta.url),{recursive:true});
  await writeFile(new URL('results/repeated-cloner-renderer.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,error:report.error,errors,gpu:report.gpu}));
}
