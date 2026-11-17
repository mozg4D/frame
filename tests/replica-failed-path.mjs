import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const owner=(id,type='instance',parent=null)=>({id,nativeHash:id,type,parent,enabled:true,visible:true,params:type==='cloner'?{type:'matrix','count x':2,'count y':1,'count z':1,'spacing x':5,'spacing y':0,'spacing z':0}:{object:'source'}});
function actualSyncSource(html){
 const start=html.indexOf('    function syncReplicas(requested=null){'),end=html.indexOf('    function syncNativeObjects(',start),helper=html.indexOf('    let replicaAuthoringIndexCache=null;');
 assert.ok(start>=0&&end>start,'Actual native replica sync is required');
 return (helper>=0?html.slice(helper,start):'')+html.slice(start,end);
}
function legacyFailureSource(source){
 const call='catch(e){failReplicaOwners(n,e);}';
 if(!source.includes(call))return source;
 assert.equal(source.split(call).length,2);
 // Negative control: the exact former directly-requested-owner catch. The rest
 // of the tested runtime, including current index/count helpers, is unchanged.
 return source.replace(call,"catch(e){n.splineError=e.message;for(let i=built.length-1;i>=0;i--)if(built[i].hashId===n.nativeHash){const m=built.splice(i,1)[0];if(!existing.includes(m))disposeMesh(m);}for(let i=builtCurves.length-1;i>=0;i--)if(builtCurves[i].hashId===n.nativeHash){const m=builtCurves.splice(i,1)[0];if(!oldCurves.includes(m))for(const b of m.buffers)releaseGPU(b);}wanted.set(n.nativeHash,[]);}");
}
function fixture(source,{polygon=false}={}){
 const rows=[{id:'source',nativeHash:'source',type:polygon?'mesh':'spline',parent:null,params:{},enabled:true,visible:true}],scene={meshes:[],curveReplicas:[]},splineDisplays=new Map(),released=[],disposed=[],counts={pose:[]};let serial=0;
 const node=id=>id==null?undefined:rows.find(n=>n.id===id),byHash=id=>rows.find(n=>n.nativeHash===id),renderer={device:{queue:{writeBuffer(){}}}},make=(_r,mesh)=>(label,size)=>{const b={id:++serial,label,size};mesh.buffers.push(b);return b;};
 if(polygon)scene.meshes.push({hashId:'source',vertexCount:3,count:3,triangleCount:1,positions:{},indices:{},normals:{},renderIndices:{},version:1,geometryRevision:1,localBoundsMin:[0,0,0],localBoundsMax:[1,1,1],boundsMin:[0,0,0],boundsMax:[1,1,1],connected:{flags:{},range:{}},normalCount:1,buffers:[],replicaFlags:{}});else splineDisplays.set('source',{hash:'source'});
 const K={generators:new Set(),states:new Map(),generatorSources:()=>[]},env={nodes:rows,scene,renderer,node,FM:{I:identity,inv:identity,mul:a=>a.slice(),fromEuler:identity,translation:p=>{const m=identity();m.splice(12,3,...p);return m;}},objectReference:id=>byHash(id)||node(id),objectRelativeFrame:identity,objectWorld:identity,objectPivot:identity,frameSoloContains:()=>true,FramePlugins:{owner:()=>null},FrameSpline:K,window:{FrameSpline:K},splineDisplays,replicaPlacements:new Map(),surfaceSamplers:new Map(),disposeSurfaceSampler(){},selectionScope:'components',objectSelection:[],objectDescendants:()=>[],syncPoseWorld:meshes=>{counts.pose.push((meshes||scene.meshes).map(m=>m.hashId));return false;},objectBoundsUnion:()=>null,replicaBuilding:false,splineLoadBatch:false,appearanceSignature:'',deferHoverMaps(){},replicaResources:()=>[],gpuLeases:new Map(),meshAllocator:make,GPUBufferUsage:{UNIFORM:1,COPY_DST:2,STORAGE:4,COPY_SRC:8},meshRenderGroups(){},disposeMesh:mesh=>{disposed.push(mesh);for(const b of mesh.buffers)released.push(b);},releaseGPU:b=>released.push(b),publishTopology:()=>{for(const [i,m]of scene.meshes.entries())m.faceBase=i;},clearFeatureDraws(){},clearPickGroups(){},refreshMaterialOwners(){},poseSplineLoadMesh(){}};
 const sync=Function(...Object.keys(env),source+';return syncReplicas;')(...Object.values(env));return {rows,node,scene,splineDisplays,released,disposed,counts,sync};
}
function oldCurves(hash,count){const display={hash:'uSource'};return Array.from({length:count},(_,i)=>({curve:true,hashId:hash,replicaKey:hash+':old:'+i,display,buffers:[]}));}
function addUnrelated(f,count){const u=owner('U','cloner');u.params['count x']=count;f.rows.push(u,{id:'uSource',nativeHash:'uSource',type:'spline',parent:'U',params:{},enabled:true,visible:true});f.splineDisplays.set('uSource',{hash:'uSource'});for(const curve of oldCurves('U',count))f.scene.curveReplicas.push(curve);}
function duplicateCase(source,{target='N',polygon=false,newRows=false}={}){
 const f=fixture(source,{polygon}),q=owner('Q','cloner');f.rows[0].parent='Q';f.rows.push(q);
 if(!newRows)f.sync();const n=owner('N');n.params.object='Q';f.rows.push(n);addUnrelated(f,99998);q.params['count x']=3;
 const oldQ=(polygon?f.scene.meshes:f.scene.curveReplicas).filter(m=>m.hashId==='Q'),before=f.scene.meshes.length+f.scene.curveReplicas.length;f.sync(new Set([target]));const result=(polygon?f.scene.meshes:f.scene.curveReplicas).filter(m=>m.hashId==='Q');
 return {f,q,n,oldQ,before,qRows:result.length,qUnique:new Set(result).size,occurrences:f.scene.meshes.filter(m=>m.replicaMatrix).length+f.scene.curveReplicas.length};
}
function matrixFailureCase(source){
 const f=fixture(source),q=owner('Q','cloner'),n=owner('N'),p=owner('P','cloner');f.rows[0].parent='P';n.params.object='Q';Object.assign(q.params,{'count x':100000,'count y':2});f.rows.push(q,n,p,{id:'qSource',nativeHash:'qSource',type:'spline',parent:'Q',params:{},enabled:true,visible:true});f.splineDisplays.set('qSource',{hash:'qSource'});f.scene.curveReplicas=oldCurves('Q',99999);f.sync(new Set(['N','P']));return {f,q,n,p};
}
export async function replicaFailedPathChecks({html:providedHTML}={}){
 const html=providedHTML??await readFile(new URL('../index.html',import.meta.url),'utf8'),source=actualSyncSource(html),legacy=legacyFailureSource(source),checks=[],details=[];
 const test=(name,fn)=>{try{fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:error.stack});}};
 test('Legacy nested matrix failure permits 100001 copies after subtracting retained failed-owner rows',()=>{const {f,p}=matrixFailureCase(legacy);assert.equal(f.scene.curveReplicas.length,100001);assert.equal(p.splineError,undefined);details.push({legacyMatrixFailureCopies:f.scene.curveReplicas.length});});
 test('Legacy nested partial failure duplicates retained objects into 100002 occurrences',()=>{const f=duplicateCase(legacy);assert.equal(f.occurrences,100002);assert.equal(f.qRows,4);assert.equal(f.qUnique,2);assert.equal(f.q.splineError,undefined);details.push({legacyPartialCopies:f.occurrences,duplicatedRows:f.qRows,uniqueRows:f.qUnique});});
 test('Failed nested matrix owner is removed and the next requested owner obeys the global budget',()=>{const {f,q,n,p}=matrixFailureCase(source);assert.match(q.splineError,/Cloner exceeds 100000/);assert.equal(n.splineError,q.splineError);assert.equal(p.splineError,undefined);assert.deepEqual(f.scene.curveReplicas.map(m=>m.hashId),['P','P']);});
 for(const polygon of [false,true])test((polygon?'Polygon':'Curve')+' nested partial failure matches direct-owner retirement and releases prior resources once',()=>{const nested=duplicateCase(source,{polygon}),direct=duplicateCase(source,{polygon,target:'Q'});assert.equal(nested.occurrences,99998);assert.equal(nested.qRows,0);assert.equal(nested.q.splineError,direct.q.splineError);assert.match(nested.q.splineError,/Scene replica limit/);assert.deepEqual(nested.f.released.map(b=>b.id),direct.f.released.map(b=>b.id));assert.equal(new Set(nested.f.released).size,nested.f.released.length);assert.equal(nested.f.released.length,2);assert.equal(nested.f.disposed.length,polygon?2:0);});
 for(const polygon of [false,true])test((polygon?'Polygon':'Curve')+' newly allocated partial resources are discarded once and never published',()=>{const result=duplicateCase(source,{polygon,newRows:true});assert.equal(result.qRows,0);assert.equal(result.occurrences,99998);assert.equal(result.f.released.length,2);assert.equal(new Set(result.f.released).size,2);assert.equal(result.f.disposed.length,polygon?2:0);});
 test('Successful nested dependency remains published while only the failed active path gets the original cause',()=>{const f=fixture(source),q=owner('Q','cloner'),n=owner('N'),r=owner('R'),b=owner('B');n.params.object='Q';r.parent=b.parent='Q';b.params.object='missing';f.rows.push(n,q,r,b);f.sync(new Set(['N','Q']));assert.deepEqual(f.scene.curveReplicas.map(m=>m.hashId),['R']);assert.equal(r.splineError,undefined);for(const node of [n,q,b])assert.equal(node.splineError,'Instance requires an independent source');});
 test('A failed dependency cycle does not leak partial rows or prevent a later independent owner from settling',()=>{const f=fixture(source),a=owner('A'),b=owner('B'),valid=owner('valid');a.params.object='B';b.params.object='A';f.rows.push(a,b,valid);f.sync(new Set(['A','B','valid']));assert.equal(a.splineError,'Instance dependency cycle');assert.equal(b.splineError,a.splineError);assert.equal(valid.splineError,undefined);assert.deepEqual(f.scene.curveReplicas.map(m=>m.hashId),['valid']);});
 return {pass:checks.every(c=>c.pass),native:false,sourceSHA256:createHash('sha256').update(html).digest('hex'),checks,details};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await replicaFailedPathChecks();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/replica-failed-path.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}
