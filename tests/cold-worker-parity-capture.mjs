// Test-only route instrumentation for four named constructions. Capture exact
// native double values before worker transfers, including -0 and sample order.
import assert from 'node:assert/strict';

export function instrumentColdWorkerParity(source,{hashes}={}){
 assert.ok(Array.isArray(hashes)&&hashes.length>0&&hashes.length<=8);
 const prefix='window.__coldWorkerParity={hashes:new Set('+JSON.stringify(hashes)+'),records:[]};\n',run="    const run=(i,op,args={},transfers=[])=>call(group?'cold:'+group.id+':'+i:i,op,args,transfers);",prepare='function prepareSurfaceRequest(m){',prepared="  if(m.completeSingle&&budget.threads===1){",init='active={data:m.data,cells:m.cells,quads:m.quads,params,samples};result=true;',batch='function buildBatch(state,indices){',cell='const order=[...new Set(cell.boundary.map(b=>b[1]))]';
 const buildCells='result=buildBatch(batchInput(m),m.indices)',combined=source.includes(buildCells);
 for(const marker of [run,prepare,prepared,combined?buildCells:init,batch,cell])assert.equal(source.split(marker).length,2,marker);
 // Watch each lane at the page boundary so old and current workers produce comparable captures.
 const main=`    const capture=window.__coldWorkerParity,watched=capture?.hashes.has(key.slice(0,32));
    const run=(i,op,args={},transfers=[])=>{const id=group?'cold:'+group.id+':'+i:i,promise=call(id,op,watched?{...args,__coldWorkerParity:true,completeParallel:false}:args,transfers);if(!watched)return promise;return promise.then(result=>{if(result?.__coldWorkerParity){const record=(kind,state)=>capture.records.push({key,lane:id,op:kind,state});if(op==='buildCells'){record('init',result.__coldWorkerParity.init);record('batch',result.__coldWorkerParity.batch);}else record(op,result.__coldWorkerParity);delete result.__coldWorkerParity;}const surface=op==='assemble'?result:result?.completed;if(surface?.indices)capture.records.push({key,lane:id,op:'assembledSurface',state:{indices:Array.from(surface.indices),vertices:Array.from(surface.vertices),faceRanges:surface.faceRanges,cellRanges:surface.cellRanges,token:surface.token,sourceAccuracy:surface.sourceAccuracy,report:surface.report}});return result;});};`;
 const worker=`function __coldWorkerSnapshot(state,m){return structuredClone({data:state.data,cells:state.cells,params:[...state.params],samples:[...state.samples],quads:state.quads,vertexOrder:Object.keys(state.data.vertices),segmentOrder:Object.keys(state.data.segments),generation:m.generation,threads:m.threads,suppliedDisplaySamples:m.displaySamples||null});}
function prepareSurfaceRequest(m){const result=__coldPrepareSurfaceRequest(m);if(m.__coldWorkerParity&&m.__coldSnapshot)result.__coldWorkerParity=m.__coldSnapshot;return result;}
function __coldPrepareSurfaceRequest(m){`;
 const batchWrapper="function buildBatch(state,indices){const result=__coldBuildBatch(state,indices);if(state.__coldWatched)result.__coldWorkerParity={cells:state.__coldCells.splice(0)};return result;}\nfunction __coldBuildBatch(state,indices){",cellCapture="if(state.__coldWatched)state.__coldCells.push({i,positions:Array.from(cell.positions),indices:Array.from(cell.indices),boundary:structuredClone(cell.boundary),report:Object.fromEntries(['builder','algorithm','sides','loops','triangles','boundary','interior','parameterization','qualityStage','limited','underresolved','probeBudget','probes'].map(key=>[key,cell.report[key]]))});";
 source=source.replace(run,main).replace(prepare,worker).replace(prepared,'  if(m.__coldWorkerParity){state.__coldWatched=true;state.__coldCells=[];m.__coldSnapshot=__coldWorkerSnapshot(state,m);}\n'+prepared).replace(batch,batchWrapper).replace(cell,cellCapture+cell);
 if(combined){
  source=source.replace(buildCells,`result=(()=>{const state=batchInput(m);if(!m.__coldWorkerParity)return buildBatch(state,m.indices);
    state.__coldWatched=true;state.__coldCells=[];const init=__coldWorkerSnapshot(state,m),rows=buildBatch(state,m.indices);
    rows.__coldWorkerParity={init,batch:rows.__coldWorkerParity};return rows;})()`);
 }else source=source.replace(init,"active={data:m.data,cells:m.cells,quads:m.quads,params,samples};if(m.__coldWorkerParity){active.__coldWatched=true;active.__coldCells=[];}result=m.__coldWorkerParity?{__coldWorkerParity:__coldWorkerSnapshot(active,m)}:true;");
 const install='window.FrameSpline=(()=>{';assert.equal(source.split(install).length,2);return source.replace(install,prefix+install);
}

export async function collectColdWorkerParity(page){
 return page.evaluate(()=>{
  const capture=window.__coldWorkerParity;if(!capture)throw Error('Worker parity capture was not installed');const owners=[];
  for(const hash of capture.hashes){const n=frameNodeByHash(hash);if(!n)continue;const state=FrameSpline.states.get(n.id),sources=FrameSpline.generatorSources(n),inputs=sources.map(row=>frameEngine.splineOccurrenceInFrame(FrameSpline.states.get(row.node.id)?.data||row.node.splineData,row.node.nativeHash,n.nativeHash,row.instances)),inputPivots=sources.map(row=>frameEngine.splineOccurrencePivot(row.node.nativeHash,n.nativeHash,row.instances)),display=frameEngine.splineDisplays.get(hash);owners.push({hash,type:n.type,name:n.name,shape:FrameSpline.shape(n),data:state?.data,report:state?.report,inputs,inputPivots,display:display?{sameData:display.data===state?.data,samples:[...display.samples],edgeKeys:[...display.edgeKeys]}:null});}
  const bytes=FrameHash.values.encode({version:1,records:capture.records,owners});if(bytes.byteLength>64*1024*1024)throw Error('Focused worker parity capture exceeds 64 MiB');let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));return {base64:btoa(binary),bytes:bytes.byteLength,records:capture.records.length,owners:owners.map(n=>({hash:n.hash,name:n.name}))};
 });
}
