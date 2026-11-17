// Actual record-batch coordinator and surface publication; no native GPU executed.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('    let splineRecordBatch=null;'),b=html.indexOf('\n',html.indexOf('    function beginSplineRecordBatch(',a)),c=html.indexOf('    async function installSplineSurface('),d=html.indexOf('    async function ensureSplinePipelines(',c);assert(a>=0&&b>a&&c>=0&&d>c);const source=html.slice(a,b)+'\n'+html.slice(c,d),checks=[];
function fixture(){const counters={sync:0,pose:0,material:0,draw:0},node={nativeHash:'source'},space={meshes:[]},env={scene:space,nodes:[node],selectionQueue:Promise.resolve(),editSerial:Promise.resolve(),splineDisplays:new Map(),splineLoadBatch:false,FrameSpline:{surfaceCells:()=>[],isEditing:()=>false},getRenderer:async()=>({}),checkSession(){},freezeAncestorPivots(){},uploadAndCompute:async()=>({buffers:[]}),remapSplineMaterials:async()=>{},publishTopology(_gpu,rows){for(const {mesh,next}of rows)Object.assign(mesh,next);},syncMaterials(){counters.material++;},frameSyncEngineVisibility(){counters.sync++;},syncPoseWorld(){counters.pose++;},nativeSceneStats(){},canvas:{dataset:{}},deferHoverMaps(){},draw:async()=>{counters.draw++;},poseSplineLoadMesh(){},objectWorld(){return [];}};const api=Function('env',`with(env){${source};return {beginSplineRecordBatch,installSplineSurface,getBatch:()=>splineRecordBatch};}`)(env);return {env,api,counters,node,space,install:()=>api.installSplineSurface(node,{gpuInput:{},report:{}})};}
async function check(name,fn){await fn();checks.push({name,pass:true});}
await check('Generated siblings publish GPU surfaces, materials, poses and frames while deferring redundant whole-scene record synchronization',async()=>{const f=fixture(),finish=f.api.beginSplineRecordBatch();for(let i=0;i<10;i++)assert.equal(await f.install(),true);assert.deepEqual(f.counters,{sync:0,pose:10,material:10,draw:10});finish();assert.equal(f.api.getBatch(),null);await f.install();assert.equal(f.counters.sync,1);});
await check('Nested scopes close once and old-document completion cannot release a current-document scope',async()=>{const f=fixture(),outer=f.api.beginSplineRecordBatch(),inner=f.api.beginSplineRecordBatch();assert.equal(f.api.getBatch().depth,2);inner();inner();assert.equal(f.api.getBatch().depth,1);f.env.scene={meshes:[]};const current=f.api.beginSplineRecordBatch();outer();assert.equal(f.api.getBatch().space,f.env.scene);current();assert.equal(f.api.getBatch(),null);});
await check('Cold-load publication preserves its existing local-pose route',async()=>{const f=fixture();f.env.splineLoadBatch=true;const finish=f.api.beginSplineRecordBatch();await f.install();finish();assert.deepEqual(f.counters,{sync:0,pose:0,material:0,draw:0});});
await check('A retired or replaced scene never creates a new renderer after an awaited publication queue',async()=>{for(const change of ['null','replace','retire']){const f=fixture();let release,renderers=0;f.env.selectionQueue=new Promise(resolve=>release=resolve);f.env.getRenderer=async()=>{renderers++;throw Error('A retired document must not acquire another renderer');};const pending=f.install();if(change==='null')f.env.scene=null;else if(change==='replace')f.env.scene={meshes:[]};else f.space.gpu={dead:true};release();assert.equal(await pending,false);assert.equal(renderers,0);assert.equal(f.space.meshes.length,0);assert.deepEqual(f.counters,{sync:0,pose:0,material:0,draw:0});}const f=fixture();f.env.scene=null;assert.equal(await f.install(),false);});
const start=html.indexOf('const finishRecordBatch=engine.beginSplineRecordBatch();');
const end=html.indexOf('      requireEvaluationScene(engine,evaluationSpace);await engine.updateSplineVisibility();',start);
assert(start>=0&&end>start);const coordination=html.slice(start,end);
await check('Unchanged evaluation flushes replicas once; publication and failures resynchronize the native records',async()=>{
 for(const outcome of ['unchanged','changed','rejected']){
  let depth=0,finalSync=0,barriers=0,evaluations=0;
  const rows=[{id:'a',type:'spline_patch'},{id:'b',type:'spline_patch'}],env={
   checkedAll:false,syncedAtEntry:true,dirty:false,publicationChanged:outcome==='changed',
   engine:{beginSplineRecordBatch(){depth++;return()=>depth--;},flushReplicaPublication(){barriers++;}},
   nodes:rows,supported:new Set(['spline_patch']),node:()=>null,parallel:false,seen:new Set(),
   evaluate:async n=>{assert.equal(depth,1);evaluations++;if(outcome==='rejected')throw Error('rejected build');env.seen.add(n.id);},
   isEditing:()=>false,frameSyncEngineVisibility(){finalSync++;}
  };
  env.engine.scene=env.evaluationSpace={gpu:{dead:false}};
  const run=Function('env',`with(env){return(async()=>{${coordination}})();}`)(env);
  if(outcome==='rejected')await assert.rejects(run,/rejected build/);else await run;
  assert.equal(depth,0);assert.equal(finalSync,outcome==='unchanged'?0:1);assert.equal(barriers,outcome==='unchanged'?1:0);
  assert.equal(evaluations,outcome==='rejected'?1:2);
 }
});
const report={pass:true,native:false,sourceSHA256:createHash('sha256').update(html).digest('hex'),checks};await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/spline-record-batch.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
