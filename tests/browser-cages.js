// Run this async function through the app's development CDP Runtime.evaluate.
// Tests use a separate empty browser tab; no production scene is modified.
async function testSplineCages(){
  const api=window.frameAI,results=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const idle=()=>api.waitForIdle(30000);
  function report(h){const o=api.getState().objects.find(o=>o.hash===h);assert(o&&!o.generatorError,o?.generatorError||'missing generator');const r=o.generatorReport;assert(r.closed&&r.triangles>0,'surface disappeared');assert(o.vertices>=r.triangles/3,'render buffers did not update with mesh report');for(const key of ['boundaryEdges','nonManifoldEdges','windingErrors','degenerate'])assert(r.meshValidation[key]===0,key);return r;}
  async function move(x,v,delta){api.selectSplineElements({object:x.child,vertices:[v]});api.transformSplineElements({translate:delta});await idle();return report(x.object);}
  api.resetScene();api.setSplineTestOptions({quantize:false,snapping:false,coordinateSpace:'world'});
  for(const type of ['cylinder','tube']){
    api.createPrimitive(type,type);const x=api.toSplinePatch(type);api.setSplineGeneratorParams(x.object,{autoBorder:false});await idle();report(x.object);
    const data=api.getSplineGenerator(x.object).cage.data;
    for(const e of Object.values(data.segments))if(data.vertices[e.a][1]!==data.vertices[e.b][1])assert([...e.ha,...e.hb].every(v=>v===0),type+' straight tangent');
    const top=type==='tube'?'vj':'va';let r=await move(x,top,[0,30,0]);assert(r.reusedCells>0,'unchanged cells rebuilt');
    results.push({type,stage:'one cap',components:r.topologyDiagnostics.components,reused:r.reusedCells});
    if(type==='tube'){assert(r.topologyDiagnostics.components===1,'one cap must keep one shell');r=await move(x,'v2',[0,30,0]);assert(r.topologyDiagnostics.components===2,'both caps must allow two shells');assert(r.reusedCells>=6,'orientation change invalidated untouched cells');results.push({type,stage:'two caps',components:2,reused:r.reusedCells});}
    api.undo();await idle();report(x.object);api.redo();await idle();report(x.object);
  }
  api.createPrimitive('sphere','sphere');const sphere=api.toSplinePatch('sphere');api.setSplineGeneratorParams(sphere.object,{autoBorder:false});await idle();assert(report(sphere.object).patchCells===8,'generic resolver must find eight triangular cells');
  const initial=api.getSplineGenerator(sphere.object).cage.data;
  await move(sphere,'v2',[20,0,0]);let moved=api.getSplineGenerator(sphere.object).cage.data;
  for(const id of Object.keys(initial.segments))assert(JSON.stringify(initial.segments[id].ha)===JSON.stringify(moved.segments[id].ha)&&JSON.stringify(initial.segments[id].hb)===JSON.stringify(moved.segments[id].hb),'translation twisted tangent');
  for(const dy of [-90,-9,-.9,-5])await move(sphere,'v3',[0,dy,0]);
  results.push({type:'sphere',stage:'deep folds',report:report(sphere.object).meshValidation});
  api.createPrimitive('sphere','outer',{diameter:200});api.createPrimitive('sphere','inner',{diameter:60});
  const outer=api.toSplinePatch('outer'),inner=api.toSplinePatch('inner');await idle();
  const multi=api.createSplineGenerator('spline_patch',[outer.child,inner.child]);await idle();
  const multiHash=multi.object||multi.hash;let r=report(multiHash);assert(r.topologyDiagnostics.components===2,'multiple child cages rejected');assert(r.meshValidation.volume>3000000&&r.meshValidation.volume<4500000,'nested shell orientation wrong');
  results.push({type:'multiple children',components:2,volume:r.meshValidation.volume});
  api.setSplineApproximation(sphere.child,{angle:1});await idle();
  // Coalescing must leave the last edit and its mesh, even while workers run.
  api.selectSplineElements({object:sphere.child,vertices:['v2']});
  const before=api.getCoordinates().position[0];
  for(let i=0;i<12;i++){api.transformSplineElements({translate:[1,0,0]});await new Promise(resolve=>setTimeout(resolve,8));}
  await idle();r=report(sphere.object);assert(api.getCoordinates().position[0]===before+12,'stale worker result');assert(r.workers===Math.max(1,navigator.hardwareConcurrency-1),'worker count');
  results.push({type:'rapid edits at 1 degree',triangles:r.triangles,workers:r.workers,buildMilliseconds:r.buildMilliseconds});
  return results;
}
