import {nativeSurfaceWGSL,prepareNativeSurfaceWork} from '../surface-work.js';
import {surfaceFixtures,expectedLabels,identity} from './hardware-fixtures.mjs';

// Browser test only. Every geometry resource below is owned by this fixture,
// packed like the native resource, and used on Frame's existing device.
export async function structuralSurfaceHardwareProbe(device){
 const checks=[],errors=[],timings=[],compilation=[],owned=new Set();let created=0,released=0,submitted=0,lost=null;
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const errorListener=e=>errors.push(e.error.message);device.addEventListener('uncapturederror',errorListener);device.lost.then(x=>lost=x.reason);
 const own=(resource,bytes)=>{owned.add(resource);created++;return resource;};
 const free=resource=>{if(owned.delete(resource)){resource.destroy();released++;}};
 // Close a validation scope before awaiting anything: no scope leaks across jobs.
 const scoped=async operation=>{device.pushErrorScope('validation');let value,thrown;try{value=operation();}catch(e){thrown=e;}const pending=device.popErrorScope();const validation=(await pending)?.message??null;if(thrown)throw thrown;return {value,validation};};
 const checked=async operation=>{const r=await scoped(operation);if(r.validation)throw Error(r.validation);return r.value;};
 const buffer=(data,usage)=>{const b=own(device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST}),data.byteLength);device.queue.writeBuffer(b,0,data);return b;};
 function texture(data){
  const width=64,height=4,layers=Math.ceil(data.length/(width*height)),capacity=width*height*layers,packed=new Uint32Array(capacity);packed.set(data);
  const t=own(device.createTexture({size:{width,height,depthOrArrayLayers:layers},format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),capacity*4);
  device.queue.writeTexture({texture:t},packed,{bytesPerRow:width*4,rowsPerImage:height},{width,height,depthOrArrayLayers:layers});
  return {kind:'texture',format:'r32uint',channels:1,count:data.length,width,height,layers,size:capacity*4,view:t.createView({dimension:'2d-array'})};
 }
 const domain={min:[-1,-1,-1],max:[1,1,1],cells:[4,4,4],count:64,spacingLocal:[.5,.5,.5]};
 let probe={checks,errors,timings,compilation,pass:false};
 try{
  check('one live existing Frame device',device===frameEngine.renderer.device&&!lost,{lost});
  const pipelines={};
  for(const storage of ['buffer','texture']){
   const code=nativeSurfaceWGSL(storage),literal=await(await fetch('./experiments/structural-surface/kernels/'+storage+'.wgsl')).text();
   check(storage+': generated source matches retained literal',code.trimEnd()===literal.replace(/\r\n/g,'\n').trimEnd());
   const start=performance.now(),module=await checked(()=>device.createShaderModule({label:'Structural surface '+storage,code})),info=await module.getCompilationInfo();
   compilation.push({storage,messages:info.messages.map(m=>({type:m.type,message:m.message,lineNum:m.lineNum,linePos:m.linePos}))});
   check(storage+': native WGSL compilation',!info.messages.some(m=>m.type==='error'),compilation.at(-1));
   pipelines[storage]=await checked(()=>device.createComputePipeline({label:'Structural test-only '+storage,layout:'auto',compute:{module,entryPoint:'surface'}}));
   const broken=code.replace('coordinateMagnitude))/cfg.origin.w','coordinateMagnitude)/cfg.origin.w');
   check(storage+': compiler negative control actually changes source',broken!==code);
   const bad=await scoped(()=>device.createShaderModule({label:'Expected malformed-parenthesis negative control',code:broken})),badInfo=await bad.value.getCompilationInfo();
   check(storage+': compiler rejects reviewed missing-parenthesis regression',badInfo.messages.some(m=>m.type==='error'),{expected:true,validation:bad.validation,messages:badInfo.messages.filter(m=>m.type==='error').map(m=>m.message)});
   timings.push({operation:storage+' good pipeline and compiler negative control',ms:performance.now()-start,budgetMs:15000});
   check(storage+': completed compilation budget',performance.now()-start<15000,timings.at(-1));
  }
  for(const storage of ['buffer','texture'])for(const fixture of surfaceFixtures()){
   const start=performance.now(),baselineOwned=new Set(owned),meshes=[];let plan;
   try{
    await checked(()=>{
     for(const [solid,mesh]of fixture.meshes.entries()){
      const xyz=new Float32Array(mesh.vertices),ids=new Uint32Array(mesh.indices),positions=storage==='buffer'?buffer(xyz,GPUBufferUsage.STORAGE):texture(new Uint32Array(xyz.buffer)),indices=storage==='buffer'?buffer(ids,GPUBufferUsage.STORAGE):texture(ids);
      meshes.push({solid,matrix:mesh.matrix,storage,vertexCount:xyz.length/3,triangleCount:ids.length/3,positions,indices});
     }
    });
    let current=true;const capture={descriptor:{domain},assertCurrent(){if(!current)throw Error('Fixture capture invalidated');},borrowGeometry(){this.assertCurrent();return meshes;}};
    plan=prepareNativeSurfaceWork(capture);
    check(storage+'/'+fixture.name+': explicitly unclassified surface-only recipe',!plan.summary.geometryClassified&&!plan.summary.analysisReady&&!plan.summary.sceneSolved&&!plan.summary.hardwareValidated&&plan.summary.geometryReadbackBytes===0,plan.summary);
    if(fixture.minBatches)check(storage+'/'+fixture.name+': all bounded batches retained',plan.summary.batches>=fixture.minBatches,plan.summary);
    let labels,uniform,readback;
    await checked(()=>{
     labels=buffer(new Uint32Array(64),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);uniform=own(device.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),128);readback=own(device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),256);
    });
    for(let batchIndex=0;batchIndex<plan.summary.batches;batchIndex++){
     plan.assertCurrent();const batch=plan.borrowBatch(batchIndex);
     check(storage+'/'+fixture.name+': borrowed batch resource identity '+batchIndex,meshes.some(m=>m.positions===batch.positions&&m.indices===batch.indices));
     await checked(()=>{
      plan.assertCurrent();device.queue.writeBuffer(uniform,0,batch.config);
      const group=device.createBindGroup({layout:pipelines[storage].getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:storage==='buffer'?{buffer:batch.positions}:batch.positions.view},{binding:2,resource:storage==='buffer'?{buffer:batch.indices}:batch.indices.view},{binding:3,resource:{buffer:labels}}]});
      const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipelines[storage]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(batch.workgroups);pass.end();device.queue.submit([encoder.finish()]);submitted++;
     });
     plan.assertCurrent();
    }
    await checked(()=>{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(labels,0,readback,0,256);device.queue.submit([encoder.finish()]);submitted++;});
    await readback.mapAsync(GPUMapMode.READ);plan.assertCurrent();const actual=Array.from(new Uint32Array(readback.getMappedRange()).slice());readback.unmap();
    const expected=expectedLabels(fixture),mismatches=actual.flatMap((value,index)=>value===expected[index]?[]:[{index,actual:value,expected:expected[index]}]);
    check(storage+'/'+fixture.name+': GPU labels equal independent clipping/uncertainty oracle',mismatches.length===0,{mismatches,labels:actual,expected,surfaceCells:actual.filter(x=>x===2).length,uncertainCells:actual.filter(x=>x===3).length});
    const submissionsBefore=submitted;current=false;let stale=false,revival=false;
    try{plan.assertCurrent();}catch{stale=true;}current=true;try{plan.borrowBatch(0);}catch{revival=true;}
    check(storage+'/'+fixture.name+': stale work permanently revoked before further submission',stale&&revival&&submitted===submissionsBefore,{stale,revival,submissionsBefore,submissionsAfter:submitted});
    // Retire explicitly, then use a fresh CURRENT handle for the resource-liveness
    // submission. No revoked batch is submitted and no native geometry is freed.
    plan.retire();const again=prepareNativeSurfaceWork(capture),live=again.borrowBatch(0);
    await checked(()=>{again.assertCurrent();device.queue.writeBuffer(uniform,0,live.config);const entries=[{binding:0,resource:{buffer:uniform}},{binding:1,resource:storage==='buffer'?{buffer:live.positions}:live.positions.view},{binding:2,resource:storage==='buffer'?{buffer:live.indices}:live.indices.view},{binding:3,resource:{buffer:labels}}],group=device.createBindGroup({layout:pipelines[storage].getBindGroupLayout(0),entries});const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipelines[storage]);pass.setBindGroup(0,group);pass.dispatchWorkgroups(live.workgroups);pass.end();device.queue.submit([encoder.finish()]);submitted++;});
    await device.queue.onSubmittedWorkDone();again.assertCurrent();again.retire();again.retire();let retired=false;try{again.borrowBatch(0);}catch{retired=true;}
    check(storage+'/'+fixture.name+': retired recipe rejects borrowing, keeps external resources live',retired);
    const ms=performance.now()-start;timings.push({operation:storage+'/'+fixture.name+' completed recipe/dispatch/readback/lifetime',ms,budgetMs:10000,cells:64,triangles:plan.summary.triangles,batches:plan.summary.batches});
    check(storage+'/'+fixture.name+': completed-operation budget',ms<10000,timings.at(-1));
   }finally{plan?.retire();await device.queue.onSubmittedWorkDone();for(const r of [...owned])if(!baselineOwned.has(r))free(r);}
  }
  check('test-owned resources released, shared device still live',owned.size===0&&created===released&&device===frameEngine.renderer.device&&!lost,{created,released,lost});
  check('no uncaptured WebGPU errors',errors.length===0,errors);
  probe.pass=true;
 }catch(error){probe.error=error.stack||String(error);}finally{await device.queue.onSubmittedWorkDone();for(const r of [...owned])free(r);device.removeEventListener('uncapturederror',errorListener);probe.resources={created,released,remaining:owned.size};probe.submissions=submitted;probe.deviceLost=lost;}
 return probe;
}
