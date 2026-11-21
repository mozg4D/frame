import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const html=readFileSync(resolve(process.argv[2]||'index.html'),'utf8');
function block(from,to){
 const begin=html.indexOf(from),end=html.indexOf(to,begin+from.length);
 assert.ok(begin>=0&&end>begin,`Absent exact source block: ${from}`);
 return html.slice(begin,end);
}
const kitchen=block('function framePredictBend(', '    const bendStates=');
const state=block('    const bendStates=', '    function beginBendPipelines');
const scheduler=block('    function buildBendColors', '    function setEdgeAngles');
const implementation=new Function('world',`
 let poseEpoch=0,frameCount=0;
 const {scene,rows,stats,FM}=world;
 let frameCurvatureOwners=world.frameCurvatureOwners;
 const frameCurvatureTriangleLimit=150000,frameCurvatureVertexLimit=450000,frameDefaultCreaseAngle=44,
   curvatureModes=['Angle','Surface Prediction'],frameCurvatureAttributeNotice=null,
   frameNodeByHash=key=>rows.get(key),draw=()=>{},
   GPUBufferUsage={STORAGE:1,COPY_DST:2};
 const renderer={device:{queue:{writeBuffer(){}},createBindGroup(){return {};}}};
 const makeGPUBuffer=(_,{size})=>{stats.live+=size;return {size};};
 const releaseGPU=buffer=>{assertLive(buffer);stats.live-=buffer.size;buffer.retired=true;};
 const assertLive=buffer=>{if(buffer.retired)throw Error('Double GPU release');};
 const beginBendPipelines=()=>({bind:{},p:new Map()});
 const readGeometry=async source=>{stats.reads++;if(world.failReads)throw Error('Controlled bad resource');
   return {vertices:world.vertices.slice(),indices:world.indices.slice()};};
 const bendFit=async(b,raw,input)=>{stats.fits++;const v=new Float32Array(4*(world.fakeFaces||raw.indices.length/3));return {values:v,maxDegrees:10};};
 ${kitchen}${state}${scheduler}
 return {bendAdmission,bendReadyFit,bendInput,bendGroupCurrent,bendMode,syncBendTags,edgeAngleStatus,
   requestBend,bendNoticeReason,framePredictBend,stateFor:id=>bendStates.get(id),retained:()=>bendColorBytes,
   bumpPose:()=>++poseEpoch,bumpFrame:()=>++frameCount,working:()=>!!bendJob,refreshOwners:()=>{frameCurvatureOwners=new Set(world.frameCurvatureOwners);syncBendTags();}};
`);
const I=()=>Array.from({length:16},(_,k)=>k%5===0?1:0);
const s=({x=1,y=1,z=1,dx=0}={})=>{const A=I();A[0]=x;A[5]=y;A[10]=z;A[12]=dx;return A;};
const rotate=(A,angle=Math.PI/7)=>{const B=A.slice(),c=Math.cos(angle),s=Math.sin(angle);
 for(const k of [0,4,8]){B[k]=c*A[k]-s*A[k+1];B[k+1]=s*A[k]+c*A[k+1];}return B;};
const radial=(n=96,r=100,rings=5)=>{
 const xyz=[],faces=[];
 for(let z=0;z<rings;z++)for(let i=0;i<n;i++){
  const a=2*Math.PI*i/n;xyz.push(r*Math.cos(a),r*Math.sin(a),(z-2)*20);
  const k=z*n+i,j=z*n+(i+1)%n;if(z+1<rings)faces.push(k,j,k+n,j,j+n,k+n);
 }
 return {vertices:Float32Array.from(xyz),indices:Uint32Array.from(faces)};
};
const raw=radial(),vertices=raw.vertices,indices=raw.indices;
const createWorld=()=>({scene:{meshes:[],topologyRevision:1},rows:new Map(),frameCurvatureOwners:new Set(),
 stats:{reads:0,fits:0,live:0},FM:{I},vertices,indices});
function source(world,hash,triangleCount=indices.length/3,vertexCount=vertices.length/3){
 const m={hashId:hash,positions:{},indices:{},triangleCount,vertexCount,creaseAngle:44,creasePolicy:1,frameWorld:I()};
 world.rows.set(hash,{nativeHash:hash,type:'mesh',engineIndex:world.scene.meshes.length,tags:[]});world.scene.meshes.push(m);return m;
}
function owner(world,hash,type,root,frames,tagged=true){
 const row={nativeHash:hash,type,tags:tagged?[{kind:'curvature',params:{mode:'Surface Prediction'}}]:[]};
 world.rows.set(hash,row);if(tagged)world.frameCurvatureOwners.add(hash);
 const copies=frames.map((frameWorld,i)=>({...root,hashId:hash,replicaMatrix:frameWorld,frameWorld,replicaSource:root,replicaKey:`${hash}:${i}`}));
 world.scene.meshes.push(...copies);return copies;
}
async function drain(api,loops=50){
 for(let i=0;i<loops;i++){
  api.requestBend();
  await new Promise(resolve=>setImmediate(resolve));
  if(!api.working()){api.requestBend();if(!api.working())return;}
 }
 assert.fail('Curvature scheduler did not settle');
}
const world=createWorld(),base=source(world,'native-cylinder'),api=implementation(world);
const A=s({x:2}),B=s({y:2}),C=s({x:2,y:2,z:2}),R=rotate(A),T=s({x:2,dx:500}),M=s({x:-2});
const group=owner(world,'cloner','cloner',base,[A,B,C,R,T,M]);
const sym=owner(world,'symmetry','symmetry',base,[I(),s({x:-1})]);
const sibling=owner(world,'sibling','instance',base,[A],false);
api.syncBendTags();
const plan=api.bendAdmission('cloner');
assert.equal(plan.count,6);assert.equal(plan.records.length,3);
assert.equal(plan.members.get(group[0]),plan.members.get(group[3]));
assert.equal(plan.members.get(group[0]),plan.members.get(group[4]));
assert.equal(plan.members.get(group[0]),plan.members.get(group[5]));
assert.notEqual(plan.members.get(group[0]),plan.members.get(group[1]));
assert.equal(api.bendAdmission('symmetry').records.length,1);
assert.equal(api.bendAdmission('symmetry').count,2);
assert.equal(api.bendReadyFit(group[0]),null,'No partial group fit during startup');
await drain(api);
assert.equal(world.stats.reads,2,'Exactly one raw geometry read per active tagged owner');
assert.equal(world.stats.fits,4,'Six cloner replicas share three solves; symmetry reflections share one');
assert.equal(api.edgeAngleStatus('cloner').readyFitCount,3);
assert.equal(api.edgeAngleStatus('symmetry').readyFitCount,1);
assert.ok(api.bendReadyFit(group[0])?.buffer);
assert.equal(api.bendReadyFit(group[0]),api.bendReadyFit(group[3]));
assert.notEqual(api.bendReadyFit(group[0]),api.bendReadyFit(group[1]));
assert.equal(api.bendReadyFit(base),null,'Canonical source is never tagged as a side effect');
assert.equal(api.bendReadyFit(sibling[0]),null,'Sibling sharing the resource must stay untagged');
assert.equal(api.retained(),world.stats.live);

// Actual worker's canonical logical corner, rather than a symmetry-insensitive peak.
const near=(value,expected,tolerance)=>assert.ok(Math.abs(value-expected)<tolerance,`${value} ≠ ${expected}`);
const principal=(copy,vertex)=>{
 const input=api.bendInput(copy,base),fit=api.framePredictBend(raw.vertices,raw.indices,input.a,input.angle,{raw:true});
 const corner=raw.indices.indexOf(vertex);assert.ok(corner>=0);
 return {k:Math.max(Math.abs(fit.principals[2*corner]),Math.abs(fit.principals[2*corner+1])),key:input.key,fit};
};
const axes=[192,216],axis=(copy,k)=>principal(copy,axes[k]);
near(axis(group[0],0).k,.01981115,3e-4);near(axis(group[0],1).k,.00250604,4e-5);
near(axis(group[1],0).k,axis(group[0],1).k,1e-8);near(axis(group[1],1).k,axis(group[0],0).k,1e-8);
near(axis(group[0],0).fit.maxCurvature,axis(group[1],0).fit.maxCurvature,1e-8);
near(axis(group[3],0).k,axis(group[0],0).k,1e-8);near(axis(group[5],0).k,axis(group[0],0).k,1e-8);
near(axis(group[2],0).k,axis(sym[0],0).k/2,1e-8);assert.notEqual(axis(group[2],0).key,axis(sym[0],0).key);

const readyBefore=api.bendReadyFit(group[0]).buffer;
group[0].frameWorld=s({x:2,dx:100});api.bumpPose();
await drain(api);assert.equal(api.bendReadyFit(group[0]).buffer,readyBefore);
assert.equal(world.stats.fits,4,'Unchanged physical metric reuses its retained color buffer');
group[0].frameWorld=s({x:3});api.bumpPose();api.bumpFrame();
assert.equal(api.bendReadyFit(group[0]),null,'A stale pose cannot render previous colors');
await drain(api);assert.equal(world.stats.fits,5);assert.equal(world.stats.reads,3);
assert.equal(api.edgeAngleStatus('cloner').fitCount,4);
base.geometryRevision=1;
assert.equal(api.bendReadyFit(group[0]),null,'In-place canonical edits invalidate the fit');
await drain(api);assert.equal(world.stats.fits,10);
world.frameCurvatureOwners.delete('cloner');world.rows.get('cloner').tags=[];
api.refreshOwners();assert.equal(api.bendReadyFit(group[0]),null);
assert.equal(api.retained(),indices.length/3*16,'Removing a tag frees all of that owner’s buffers');

const multi=createWorld(),first=source(multi,'first'),second=source(multi,'second'),whole=implementation(multi);
const pair=owner(multi,'two-sources','cloner',first,[I(),A]);
Object.assign(pair[1],{replicaSource:second,positions:second.positions,indices:second.indices});
whole.syncBendTags();await drain(whole);
assert.ok(whole.bendReadyFit(pair[0]));assert.ok(whole.bendReadyFit(pair[1]));
second.geometryRevision=1;
whole.bumpFrame();
assert.equal(whole.bendReadyFit(pair[0]),null,'One changed source suspends the entire group before the scheduler runs');
assert.equal(whole.bendReadyFit(pair[1]),null);
await drain(whole);
assert.ok(whole.bendReadyFit(pair[0]));assert.ok(whole.bendReadyFit(pair[1]));

const overflow=createWorld(),small=source(overflow,'base'),oversize=implementation(overflow);
owner(overflow,'many','cloner',small,Array.from({length:129},I));
owner(overflow,'unique','cloner',small,Array.from({length:17},(_,i)=>s({x:1+i/10})));
oversize.syncBendTags();const large=oversize.bendAdmission('many');assert.equal(large.reason,'occurrence-limit');
assert.equal(oversize.bendAdmission('many'),large,'Stable rejected plan must not rescan the scene');
assert.equal(oversize.bendAdmission('unique').reason,'fit-limit');await drain(oversize);
assert.equal(overflow.stats.reads,0);assert.equal(oversize.retained(),0);

const seams=createWorld(),patch=source(seams,'patch'),check=implementation(seams);
seams.rows.get('patch').type='spline_patch';patch.creasePolicy=2;
owner(seams,'reflected-patch','symmetry',patch,[I(),s({x:-1})]);check.syncBendTags();
const unavailable=check.bendAdmission('reflected-patch');assert.equal(unavailable.reason,'patch-seams-unavailable');
assert.equal(check.bendAdmission('reflected-patch'),unavailable);
patch.patchHardEdges=new Uint32Array();await drain(check);
assert.equal(check.edgeAngleStatus('reflected-patch').readyFitCount,1,'Analytic seam publication recovers even with unchanged topology and pose');
assert.equal(check.bendAdmission('reflected-patch').records[0].input.patch,true);

const budget=createWorld(),big=source(budget,'base',150000,450000),meter=implementation(budget);
budget.fakeFaces=150000;
for(let i=0;i<14;i++)owner(budget,'owner-'+i,'symmetry',big,[I(),s({x:-1})]);
meter.syncBendTags();await drain(meter);
assert.equal(meter.retained(),13*150000*16);
assert.equal(meter.edgeAngleStatus('owner-13').reason,'color-budget');
assert.equal(meter.bendNoticeReason('owner-13'),'color-budget','Attributes uses effective budget status');
budget.frameCurvatureOwners.delete('owner-2');budget.rows.get('owner-2').tags=[];
meter.refreshOwners();await drain(meter);assert.equal(meter.edgeAngleStatus('owner-13').readyFitCount,1);
assert.equal(meter.retained(),budget.stats.live);

const failed=createWorld(),failedBase=source(failed,'base'),bad=implementation(failed);
owner(failed,'unstable','cloner',failedBase,[I(),A]);failed.failReads=true;bad.syncBendTags();await drain(bad);
assert.equal(bad.edgeAngleStatus('unstable').reason,'fit-failed');
assert.equal(bad.bendNoticeReason('unstable'),'fit-failed','Attributes uses effective worker status');assert.equal(bad.retained(),0);
assert.equal(failed.stats.reads,1,'Stable failed input must not spin');
failed.failReads=false;failedBase.geometryRevision=1;await drain(bad);
assert.equal(bad.edgeAngleStatus('unstable').readyFitCount,2,'New geometry can recover');

console.log('Derived Curvature: canonical corner metrics, shared fits, ownership, revision/pose, bounded allocations and failure recovery pass.');
