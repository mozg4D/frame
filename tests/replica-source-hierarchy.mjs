import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function replicaSourceHierarchyChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const a=html.indexOf('    function syncReplicas(requested=null){'),b=html.indexOf('    function syncNativeObjects(',a);assert.ok(a>=0&&b>a);const helperAt=html.indexOf('    let replicaAuthoringIndexCache=null;'),source=(helperAt>=0&&helperAt<a?html.slice(helperAt,a):'')+html.slice(a,b),I=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  function fixture(count=10000){const rows=[{id:'root',nativeHash:'root',parent:null,type:'group',params:{},enabled:true,visible:true},...Array.from({length:count},(_,i)=>({id:'i'+i,nativeHash:'h'+i,parent:null,type:'instance',params:{object:'root'},enabled:true,visible:true}))],byId=new Map(rows.map(n=>[n.id,n])),byHash=new Map(rows.map(n=>[n.nativeHash,n]));let arrayReads=0;
   const nodes=new Proxy(rows,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))arrayReads++;return Reflect.get(target,key,receiver);}}),scene={meshes:[],curveReplicas:[]};
   const env={nodes,scene,renderer:{},FM:{I,inv:I,mul:I,fromEuler:I},node:id=>byId.get(id),objectReference:id=>byHash.get(id)||byId.get(id),objectWorld:I,objectPivot:I,frameSoloContains:()=>true,FramePlugins:{owner:()=>null},FrameSpline:{generators:new Set(),states:new Map(),generatorSources:()=>[]},splineDisplays:new Map(),replicaPlacements:new Map(),surfaceSamplers:new Map(),disposeSurfaceSampler:()=>{},selectionScope:'objects',objectSelection:[],objectDescendants:()=>[],syncPoseWorld:()=>false,unionSelectionBounds:()=>null,replicaBuilding:false,splineLoadBatch:false,appearanceSignature:'',deferHoverMaps:()=>{},children:()=>{throw Error('Global children scan during replica synchronization');},descendants:()=>{throw Error('Global descendant scan during replica synchronization');}};
   const names=Object.keys(env),sync=Function(...names,source+';return syncReplicas;')(...Object.values(env));return {rows,nodes,scene,sync,reads:()=>arrayReads};
  }
  const f=fixture(),at=performance.now();f.sync();timings.push({name:'10000 independent native Instance owners using one source hierarchy',ms:performance.now()-at,ownerArrayReads:f.reads()});
  check('Ten thousand leaf Instances synchronize without global child or descendant scans',()=>{assert.ok(f.rows.every(n=>!n.splineError));assert.equal(f.scene.meshes.length,0);assert.ok(f.reads()<150000);});
  check('A source inside an Instance subtree still rejects the dependency cycle',()=>{const c=fixture(1);c.rows[0].parent='i0';c.sync();assert.match(c.rows[1].splineError,/Instance requires an independent source/);});
  check('Hierarchy mutation between synchronizations is observed without a stale global index',()=>{const c=fixture(1);c.rows[0].parent='i0';c.sync();assert.ok(c.rows[1].splineError);c.rows[0].parent=null;c.sync();assert.equal(c.rows[1].splineError,undefined);});
  const helperStart=source.indexOf('      function sourceDescendant('),helperEnd=source.indexOf('      function consumedInput(',helperStart);assert.ok(helperStart>=0&&helperEnd>helperStart);
  const children=new Map([['a',[{id:'b'}]],['b',[{id:'c'}]],['c',[{id:'a'}]]]),member=Function('sourceChildren',source.slice(helperStart,helperEnd)+';return sourceDescendant;')(children);
  check('Nested membership checks terminate on malformed cyclic hierarchy',()=>{assert.equal(member('a','c'),true);assert.equal(member('a','missing'),false);assert.equal(member('leaf','a'),false);});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await replicaSourceHierarchyChecks();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/replica-source-hierarchy.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
