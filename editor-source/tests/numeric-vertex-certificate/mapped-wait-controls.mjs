import fs from'node:fs';import vm from'node:vm';import assert from'node:assert/strict';import{environment,publication,drain,T,functions}from'./harness.mjs';
const rows=[];
for(const scenario of['ready','prepare-declined','Escape','selection-change','geometry-change','stale-row']){
 const e=environment(),p=publication(e),c=e.c;c.frameAffineNumericMovePublish(p.job,e.b,p.g,p.entry,{}, {},new T.Matrix4().elements,p.snapshot,null,p.certificate);await c.frameRigidPrepared.promise;
 const t=c.frameRigidPrepared,b={h:'h',domain:'vertex',mesh:e.mesh,node:e.b.node,g:p.g,p:p.g.attributes.position,n:p.g.attributes.normal,index:p.g.index,entry:p.entry};let resolve;const pending=new Promise(r=>resolve=r);t.status='preparing';t.promise=pending;
 const marks={fast:0,fallback:0},job={closed:false,row:{cancelled:false},numericUnit:1};c.coordMode='object';c.UMM=[1];c.dispIdx=0;c.polyCoordReference=()=>new T.Matrix4();c.frameAffineNumericMoveCandidate=()=>b;c.frameAffineAuthoringIntent=()=>({stamp:c.frameAffineSourceStamp(b.mesh),sets:c.frameRigidSetSnapshots([b.entry.faces,b.entry.vertices,b.entry.edges])});c.frameAffineAuthoringIntentCurrent=i=>!!i&&c.frameAffineStampCurrent(i.stamp)&&c.frameRigidSetSnapshotsCurrent(i.sets);
 c.frameAffineNumericMoveCapture=async()=>({raw:{attrs:{position:{array:t.pa},normal:{array:t.na}},index:t.ia},before:{geometry:new Map([['h',{origin:null}]])}});c.framePolySelectionMeasurements=function*(){return{frame:new T.Matrix4()}};c.frameAffineNumericMoveLogicalWork=function*(){return{vertices:new Set(),edges:new Set(),faces:new Set()}};c.framePolySelectedVertexIdsWork=function*(){return new Set(t.ids)};
 c.frameAffineNumericPreparedSourceWork=function*(){marks.fast++;throw Error('controlled-fast-boundary')};c.frameAffineNumericMoveFallbackWork=function*(){marks.fallback++;throw Error('controlled-fallback-boundary')};c.frameNative.drainCooperatively=async(work,options)=>{if(!options.isCurrent())throw new DOMException('stale drain','AbortError');return drain(work)};
 vm.runInContext(functions.get('frameAffineNumericMoveRun')+'\n'+functions.get('frameAffineNumericMoveCheck'),c);
 job.numericOwned=c.frameAffineAuthoringIntent();const running=c.frameAffineNumericMoveRun(job,{axis:0},1);running.catch(()=>{});for(let k=0;k<20;k++)await Promise.resolve();assert.deepEqual(marks,{fast:0,fallback:0},'no fallback while certified mapped preparation is pending');
 if(scenario==='Escape')job.closed=true;if(scenario==='stale-row')job.row.cancelled=true;if(scenario==='selection-change')p.entry.vertices.delete(p.entry.vertices.values().next().value);if(scenario==='geometry-change')p.g.attributes.position.needsUpdate=true;
 t.status=scenario==='prepare-declined'?'failed':'ready';resolve(scenario!=='prepare-declined');
 if(scenario==='ready'){await assert.rejects(running,/controlled-fast-boundary/);assert.deepEqual(marks,{fast:1,fallback:0})}
 else if(scenario==='prepare-declined'){await assert.rejects(running,/controlled-fallback-boundary/);assert.deepEqual(marks,{fast:0,fallback:1})}
 else{await assert.rejects(running,{name:'AbortError'});assert.deepEqual(marks,{fast:0,fallback:0})}
 rows.push({scenario,pass:true});
}
const result={pass:true,controls:rows.length,rows,scope:'Exact candidate NumericMoveRun and NumericMoveCheck through certified pending-preparation boundary. Capture/measurement/intent predicates and GPU completion are controlled synthetic transports; no geometry publication executes beyond the asserted boundary.'};console.log(JSON.stringify(result));
