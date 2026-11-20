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
  for(const shading of ['solid','solid-isoparms']){
    await call('view.set',{shading});
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
  const started=performance.now();
  const forest=await call('scene.create',{type:'cloner',inputs:[tree.hash],params:{
    'count x':250,'count y':1,'count z':200,'spacing x':10000,'spacing z':10000,'random angle y':180
  }});
  report.createMs=performance.now()-started;
  console.log('Create 50000 selected procedural trees: '+report.createMs+' ms');
  assert.ok(report.createMs<8000,'50k placements, exact bounds and first rendered frame complete within 8 seconds');
  assert.equal(forest.buildError,null);
  await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:forest.hash});
  const solid=await frames('50000 trees Solid',forest.hash);
  assert.equal(solid.counts.positions,1);assert.equal(solid.counts.normals,1);assert.equal(solid.counts.indices,1);
  assert.equal(solid.counts.batchedDraws.instances,50000);
  assert.ok(solid.counts.batchedDraws.previewInstances>=45000);
  assert.ok(solid.counts.batchedDraws.calls<=128);
  assert.ok(solid.counts.ownedBuffers<128,'Viewport never requires separate GPU uniform objects for all copies');
  assert.ok(solid.cpuMs<12&&solid.gpuMs<25);
  assert.ok((await pixels()).green>2000,'The shared wood and cutout foliage are painted in the distant view');

  await call('view.set',{shading:'solid-isoparms'});
  const lines=await frames('50000 trees exact Solid + Isoparms',forest.hash);
  assert.equal(lines.counts.batchedDraws.instances,50000);
  assert.equal(lines.counts.batchedDraws.previewInstances,0);
  assert.ok(lines.cpuMs<18&&lines.gpuMs<125);

  await call('view.set',{index:1,shading:'solid',focus:tree.hash});
  const near=await frames('Zoomed tree group, exact geometry',forest.hash);
  assert.ok(near.counts.batchedDraws.instances>0&&near.counts.batchedDraws.instances<50000,JSON.stringify(near.counts));
  assert.equal(near.counts.batchedDraws.previewInstances,0);
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
