import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {closedRevolve} from './engineering.mjs';

export async function booleanThreadingChecks(page){
  const mesh=closedRevolve(Array.from({length:81},(_,i)=>[40*Math.sin(i*Math.PI/80),40*Math.cos(i*Math.PI/80)]),512);
  const results=await page.evaluate(async mesh=>{
    const native=window.Worker,descriptor=Object.getOwnPropertyDescriptor(navigator,'hardwareConcurrency');
    const vertices=Float32Array.from(mesh.vertices),indices=Uint32Array.from(mesh.indices);
    const tetraPos=Float32Array.of(0,0,0,2,0,0,0,2,0,0,0,2),tetraIx=Uint32Array.of(0,2,1,0,1,3,1,2,3,2,0,3);
    const rows=[];let cores=3,fail='',active=0,peak=0,helpers=0,created=0,side=null,onSceneRun;
    Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,get:()=>cores});
    window.Worker=class extends native{
      constructor(url,options){
        const name=options?.name,helper=name==='Frame Boolean operand';
        if(helper&&fail==='launch')throw Error('Injected helper launch failure');
        super(url,options);
        this.tracked=helper||name==='Frame Boolean';this.helper=helper;
        if(this.tracked){created++;active++;peak=Math.max(peak,active);}
      }
      postMessage(data,...rest){
        if(data.parallelSide)side=data.parallelSide;
        if(data.cmd==='prepareOperand'){
          helpers++;
          if(fail==='error'){
            setTimeout(()=>this.dispatchEvent(new ErrorEvent('error',{cancelable:true,message:'Injected helper failure'})),0);
            return;
          }
        }
        if(onSceneRun&&this.tracked&&!this.helper&&data.cmd==='run'){
          onSceneRun(()=>super.postMessage(data,...rest));return;
        }
        super.postMessage(data,...rest);
      }
      terminate(){if(this.tracked){active--;this.tracked=false;}super.terminate();}
    };
    function matrix(x,mirror=false){return [mirror?-1:1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1];}
    async function run(smaller,small=false){
      // Both operands share input buffers. The helper also sees a reflected transform.
      const p=(small?tetraPos:vertices).slice(),ix=(small?tetraIx:indices).slice();
      const matA=new Uint32Array(ix.length/3).fill(1),matB=new Uint32Array(ix.length/3).fill(2);
      const a={positions:p,indices:ix,faceMaterials:matA,matrix:matrix(0)};
      const b={positions:p,indices:ix,faceMaterials:matB,matrix:matrix(small?8:30,true)};
      const partsA=[a],partsB=[b];
      if(!small)(smaller==='A'?partsB:partsA).push({positions:tetraPos,indices:tetraIx,matrix:matrix(90)});
      const r=await FrameGeometry.worker('boolean',{cmd:'run',op:1,partsA,partsB,cagePoints:p,cageLines:Uint32Array.of(0,2)},[p.buffer,ix.buffer,matA.buffer,matB.buffer]);
      const hashes={};
      for(const k of ['positions','indices','faceMaterials','seamPositions','seamIndices','displayEdges']){
        hashes[k]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',r[k]))).join(',');
      }
      return {workers:r.report.preparationWorkers,trusted:r.report.trusted,watertight:r.report.watertight,post:r.report.postTransfer,hashes};
    }
    try{
      for(const smaller of ['A','B'])for(const [count,failure] of [[2,''],[3,''],...(smaller==='A'?[[3,'launch'],[3,'error']]:[])]){
        FrameGeometry.worker.clearBooleanPool();
        cores=count;fail=failure;helpers=0;peak=0;created=0;side=null;
        const r=await run(smaller),pooled=active;
        FrameGeometry.worker.clearBooleanPool();
        rows.push({smaller,count,failure,helpers,peak,created,pooled,side,active,r});
      }
      const batches=[];
      FrameGeometry.worker.clearBooleanPool();
      cores=3;fail='';helpers=0;peak=0;created=0;
      const together=await Promise.all([run('A'),run('A',true),run('B',true)]),mixedPooled=active;
      FrameGeometry.worker.clearBooleanPool();
      const mixed={peak,created,pooled:mixedPooled,active,helpers,workers:together.map(r=>r.workers)};
      for(const count of [1,2,3,4]){
        FrameGeometry.worker.clearBooleanPool();
        cores=count;fail='';helpers=0;peak=0;created=0;side=null;
        const invalid=FrameGeometry.worker('boolean',{cmd:'run',op:1,positionsA:tetraPos,indicesA:Uint32Array.of(0,1,99),positionsB:tetraPos,indicesB:tetraIx});
        const settled=await Promise.allSettled([invalid,...Array.from({length:4},()=>run('A',true))]),pooled=active,firstCreated=created;
        created=0;
        const warm=await Promise.all(Array.from({length:Math.max(1,count-1)},()=>run('A',true))),reusedCreated=created;
        FrameGeometry.worker.clearBooleanPool();
        batches.push({count,peak,firstCreated,reusedCreated,pooled,active,helpers,status:settled.map(x=>x.status),valid:settled.slice(1).every(x=>x.value?.trusted&&x.value.workers===1)&&warm.every(x=>x.trusted&&x.workers===1)});
      }
      FrameGeometry.worker.clearBooleanPool();
      cores=3;fail='';helpers=0;peak=0;created=0;side=null;
      const coldDense=await run('A'),coldCreated=created,warmActive=active;
      created=0;helpers=0;
      const warmDense=await run('A'),warmCreated=created,warmHelpers=helpers;
      FrameGeometry.worker.clearBooleanPool();
      FrameGeometry.worker.booleanIdleMs=50;
      await Promise.all([run('A',true),run('B',true)]);
      const beforeIdleActive=active;
      await new Promise(resolve=>setTimeout(resolve,130));
      const idle={coldWorkers:coldDense.workers,warmWorkers:warmDense.workers,coldCreated,warmCreated,warmHelpers,warmActive,beforeIdleActive,afterIdleActive:active};
      delete FrameGeometry.worker.booleanIdleMs;
      FrameGeometry.worker.clearBooleanPool();
      cores=4;fail='';helpers=0;peak=0;created=0;
      await frameAI.call('scene.new');
      const owners=[];
      for(let i=0;i<3;i++){
        const a=await frameAI.call('scene.create',{type:'cube'}),b=await frameAI.call('scene.create',{type:'cube'});
        await frameAI.call('transform.apply',{ids:[a.hash],position:[i*300,0,0]});
        await frameAI.call('transform.apply',{ids:[b.hash],position:[i*300+40,30,20]});
        owners.push(await frameAI.call('scene.create',{type:'boolean',inputs:[a.hash,b.hash],params:{op:'subtract'}}));
      }
      FrameGeometry.worker.clearBooleanPool();
      peak=0;created=0;
      for(const s of FrameSpline.states.values())s.signature=null;
      // Hold each real job until all independent owners have submitted theirs.
      // A serial scheduler is released by the timeout and fails the overlap assertion.
      const pending=[];let overlap=0;
      const release=()=>{
        if(!onSceneRun)return;
        onSceneRun=null;overlap=pending.length;
        for(const post of pending.splice(0))post();
      };
      onSceneRun=post=>{pending.push(post);if(pending.length===owners.length)release();};
      const timeout=setTimeout(release,3000);
      try{FrameSpline.request();await FrameSpline.flush();}finally{clearTimeout(timeout);release();}
      const sceneBatch={overlap,peak,created,pooled:active,valid:owners.every(o=>frameEngine.scene.meshes.some(m=>m.hashId===o.hash&&m.triangleCount>0))};
      await frameAI.call('scene.new');
      return {rows,batches,mixed,idle,sceneBatch};
    }finally{
      delete FrameGeometry.worker.booleanIdleMs;
      FrameGeometry.worker.clearBooleanPool();
      window.Worker=native;
      if(descriptor)Object.defineProperty(navigator,'hardwareConcurrency',descriptor);
      else delete navigator.hardwareConcurrency;
    }
  },mesh);
  const checks=[],refs={};
  for(const {smaller,count,failure,helpers,peak,created,pooled,side,active,r} of results.rows){
    assert(r.trusted&&r.watertight);assert.equal(active,0);
    const successful=count>2&&!failure;
    assert.equal(r.workers,successful?2:1);assert.equal(helpers,successful||failure==='error'?1:0);
    assert.equal(peak,helpers?2:1);assert.equal(created,helpers?2:1);assert.equal(pooled,successful?2:1);assert.equal(side,helpers?smaller:null);
    const exact={hashes:r.hashes,post:r.post};
    if(refs[smaller])assert.deepEqual(exact,refs[smaller]);else refs[smaller]=exact;
    checks.push({name:'Operand '+smaller+', '+count+' logical CPUs'+(failure?', helper '+failure+' failure':''),pass:true});
  }
  for(const {count,peak,firstCreated,reusedCreated,pooled,active,helpers,status,valid} of results.batches){
    const limit=Math.max(1,count-1);
    assert.deepEqual(status,['rejected','fulfilled','fulfilled','fulfilled','fulfilled']);
    assert(valid);assert.equal(helpers,0);assert.equal(active,0);assert.equal(peak,limit);assert.equal(firstCreated,limit);assert.equal(pooled,limit);assert.equal(reusedCreated,0);
    checks.push({name:'Concurrent Booleans reuse up to '+limit+' pooled workers on '+count+' logical CPUs',pass:true});
  }
  assert.deepEqual(results.mixed,{peak:2,created:2,pooled:2,active:0,helpers:1,workers:[2,1,1]});
  checks.push({name:'Dense and small jobs share the same two pooled worker slots on three logical CPUs',pass:true});
  assert.deepEqual(results.idle,{coldWorkers:2,warmWorkers:2,coldCreated:2,warmCreated:0,warmHelpers:1,warmActive:2,beforeIdleActive:2,afterIdleActive:0});
  checks.push({name:'Warm Boolean worker pool reuses coordinator and helper workers and retires them after the idle timer',pass:true});
  assert.deepEqual(results.sceneBatch,{overlap:3,peak:3,created:3,pooled:3,valid:true});
  checks.push({name:'Multi-Boolean scene evaluates independent Boolean owners concurrently across available CPU cores',pass:true});
  return {pass:true,checks};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=await launch({headless:true}),errors=[];
  try{
    await ready(app.page);app.page.on('pageerror',e=>errors.push(e.message));
    const report=await booleanThreadingChecks(app.page);assert.deepEqual(errors,[]);
    await mkdir(new URL('results/',import.meta.url),{recursive:true});
    await writeFile(new URL('results/boolean-threading.json',import.meta.url),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  }finally{await app.close();}
}
