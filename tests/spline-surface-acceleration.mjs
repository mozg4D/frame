import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready,root} from '../tools/browser.mjs';
import {constructionShapes} from './generator-construction.mjs';
import {gridCage} from './scenes/generate-zoo-10k.mjs';

const {ring,path}=constructionShapes();
const reference=process.argv.find(arg=>arg.startsWith('--baseline-ref='))?.slice(15);
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
const fingerprint=g=>[g.vertices,g.triangles,g.positionsSHA256,g.indicesSHA256];
const hash=data=>createHash('sha256').update(data).digest('hex');

async function measure(html,label){
  const session=await launch({headless:true}),{page}=session,errors=[],rows=[],primitives=[],digests={};
  try{
    await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.reload();await ready(page);
    page.on('pageerror',e=>errors.push(e.message));
    await page.evaluate(()=>{window.surfaceErrors=[];const device=frameEngine.renderer.device;
      device.addEventListener('uncapturederror',e=>surfaceErrors.push(e.error.message));device.pushErrorScope('validation');});
    const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
    const clear=async()=>{await call('scene.new');await call('view.set',{index:2,single:true,mode:'object',shading:'solid'});};
    const source=async data=>{const n=await call('scene.create',{type:'spline'});await call('spline.replace',{id:n.hash,data});return n.hash;};
    const mesh=async id=>{const g=await call('diagnostics.mesh',{id,geometry:true});assert(g.finite&&g.indicesValid&&g.triangles>0);return g;};
    const state=async id=>(await call('scene.inspect')).objects.find(o=>o.hash===id);
    const settled=()=>page.evaluate(()=>frameEngine.renderer.device.queue.onSubmittedWorkDone());

    for(const type of ['cube','cylinder','tube','sphere','capsule','nut','washer','bolt']){
      const times=[];let id;
      for(let i=0;i<3;i++){
        await clear();const start=performance.now(),n=await call('scene.create',{type});
        await settled();times.push(performance.now()-start);assert(!n.buildError,n.buildError);id=n.hash;
      }
      primitives.push({type,ms:median(times),times});digests[type]=fingerprint(await mesh(id));
    }
    // Include both a boundary-only grid and a spatial grid whose ribbon interiors really are sampled.
    for(const [name,cage] of [['planar patch',gridCage(24,24,5)],['spatial patch',gridCage(10,10,5,3)],['large spatial patch',gridCage(24,24,5,3)]]){
      await clear();const id=await source(cage),owner=await call('scene.create',{type:'spline_patch',inputs:[id]});
      const times=[];for(let i=0;i<5;i++){
        const start=performance.now();await call('spline.rebuild',{id:owner.hash});await settled();times.push(performance.now()-start);
      }
      const g=await mesh(owner.hash),report=(await state(owner.hash)).evaluation.report;
      if(name.includes('spatial'))assert(report.cpuCells>1);
      if(name==='planar patch')assert.equal(g.triangles,24*24*2);
      digests[name]=fingerprint(g);rows.push({name,ms:median(times),times,buildMs:report.buildMs,workers:report.workers});
    }
    for(const type of ['extrude','lathe','sweep']){
      await clear();const profile=ring(256,5,type==='lathe'?[30,0,0]:[0,0,0]),inputs=[await source(profile)],rail=path();
      if(type==='sweep')inputs.push(await source(rail));
      const owner=await call('scene.create',{type,inputs,params:type==='extrude'?{offset:30}:type==='lathe'?{angle:300}:{movement:'tangent'}});
      assert(!owner.buildError,owner.buildError);const times=[];
      for(let i=1;i<=5;i++){
        const start=performance.now();
        if(type==='sweep'){rail.vertices.b[2]=100+i;await call('spline.replace',{id:inputs[1],data:rail});}
        else await call('scene.update',{id:owner.hash,params:type==='extrude'?{offset:i===5?-35:30+i}:{angle:300+i}});
        await settled();times.push(performance.now()-start);
      }
      const generated=await mesh(owner.hash),report=(await state(owner.hash)).evaluation.report;
      rows.push({name:type,ms:median(times),times,buildMs:report.buildMs,workers:report.workers});
      digests[type]=fingerprint(generated);
      if(type==='extrude'){
        assert.equal(report.profileReused,true);
        // Mutate in place using the modeling API, then compare the hot update to a fresh generator.
        await call('scene.update',{id:owner.hash,params:{'end cap':false}});
        const open=await mesh(owner.hash);assert(open.triangles<generated.triangles);
        await call('scene.update',{id:owner.hash,params:{'end cap':true}});
        profile.vertices.v0[0]+=.5;await call('spline.replace',{id:inputs[0],data:profile});
        await call('scene.update',{id:owner.hash,params:{offset:17}});
        const after=fingerprint(await mesh(owner.hash));assert.notDeepEqual(after,digests.extrude);
        const p=await source(profile),fresh=await call('scene.create',{type,inputs:[p],params:{offset:17}});
        assert.deepEqual(after,fingerprint(await mesh(fresh.hash)));digests['updated profile']=after;
      }
      const before=await mesh(owner.hash);await call('scene.convert',{id:owner.hash});
      const patch=await state(owner.hash);assert.equal(patch.type,'spline_patch');assert(!patch.buildError,patch.buildError);
      const cage=(await call('spline.inspect',{id:patch.sources[0]})).data;
      assert(Object.keys(cage.segments).length>0);assert(!Object.hasOwn(cage,'sourceCells'));
      const editable=await mesh(owner.hash);assert(Math.abs(Math.abs(editable.signedVolume/before.signedVolume)-1)<.002);
      digests[type+' editable']=fingerprint(editable);
    }
    await clear();const profile=await source(ring(1001,5)),owner=await call('scene.create',{type:'extrude',inputs:[profile],params:{offset:30}});
    await call('scene.update',{id:owner.hash,params:{offset:-7}});
    const display=await page.evaluate(hash=>{
      const d=frameEngine.splineDisplays.get(hash),position=id=>Array.from(d.controlValues.subarray(d.vertexOffsets.get(id),d.vertexOffsets.get(id)+3));
      return {bottom:position('bottom:v0'),top:position('top:v0'),min:d.min[2],max:d.max[2]};
    },owner.hash);
    assert.deepEqual(display,{bottom:[5,0,0],top:[5,0,-7],min:-7,max:0});
    const gpu=await page.evaluate(async()=>({uncaptured:surfaceErrors,validation:(await frameEngine.renderer.device.popErrorScope())?.message}));
    assert.deepEqual(errors,[]);assert.deepEqual(gpu.uncaptured,[]);assert(!gpu.validation,gpu.validation);
    for(const row of rows){assert(row.times.every(ms=>ms<8000),row.name);console.log(label,row.name,Math.round(row.ms)+' ms');}
    return {sourceSHA256:hash(html),rows,primitives,digests};
  }finally{await session.close();}
}

const baseline=reference?await measure(execFileSync('git',['show',reference+':index.html'],{cwd:root,maxBuffer:32*1024*1024}),'baseline'):null;
const current=await measure(await readFile(new URL('../index.html',import.meta.url)),'current');
if(baseline)for(const [name,digest] of Object.entries(baseline.digests))assert.deepEqual(current.digests[name],digest,name+' native positions and indices');
await mkdir(new URL('results/',import.meta.url),{recursive:true});
await writeFile(new URL('results/spline-surface-acceleration.json',import.meta.url),JSON.stringify({baseline,current},null,2));
console.log('PASS',Object.keys(current.digests).length,'native mesh cases');
