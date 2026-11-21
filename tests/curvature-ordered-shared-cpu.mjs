import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const text=readFileSync(process.argv[2]||'index.html','utf8');
function span(a,b){const start=text.indexOf(a),end=text.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a);return text.slice(start,end);}
const groupBlock=span('    const bendStates=', '    const bendColorWGSL=');
const approval=new Function('env',`
 const {scene,rows,renderer}=env,curvatureModes=['Angle','Surface Prediction'],FM={I:env.identity},
  frameCurvatureTriangleLimit=150000,frameCurvatureVertexLimit=450000,frameDefaultCreaseAngle=44,
  frameNodeByHash=id=>rows.get(id),classifiedSurfaceWire=m=>!!m.splineWireEdges;
 let poseEpoch=0,frameCount=0;
 ${groupBlock}
 return {bendAdmission,bendOrderedFit,bendReadyFit,bendNeedsSharedViewport,bendOrderedLayouts,
   states:bendStates,invalidate:()=>++poseEpoch};
`);
const identity=()=>Array.from({length:16},(_,i)=>i%5===0?1:0);
function world(count,paged=false){
 const source={hashId:'source',triangleCount:4,vertexCount:4,positions:{},indices:{},normals:{},renderIndices:{},creasePolicy:1,creaseAngle:44},
  owner={type:'cloner',nativeHash:'owner',tags:[{kind:'curvature',params:{mode:'Surface Prediction'}}]},
  child={type:'mesh',nativeHash:'source',tags:[]};
 const copies=Array.from({length:count},(_,i)=>{const M=identity();M[12]=i*5;return {...source,hashId:'owner',replicaSource:source,replicaMatrix:M,frameWorld:M,frameVisible:true,paged};});
 const scene={meshes:[source,...copies],topologyRevision:1},rows=new Map([['source',child],['owner',owner]]),renderer={};
 return {identity,scene,rows,renderer,copies,source,owner};
}
for(const count of [127,128,129,100000]){
 const env=world(count),a=approval(env),b={hash:'owner',scene:env.scene,renderer:env.renderer};
 a.states.set('owner',b);const p=a.bendAdmission('owner');
 assert.equal(p.reason,null);assert.equal(p.count,count);assert.equal(p.records.length,1);
 assert.equal(p.records[0].count,count);assert.equal(p.triangles,4);assert.equal(p.vertices,4);assert.equal(p.bytes,64);
 assert.equal(p.members.size,count<=128?count:0);assert.equal(p.compactOnly,count>128);
 assert.equal(a.bendNeedsSharedViewport(),count>128);
 b.groupPlan=p;p.ready=true;p.records[0].buffer={};
 assert.equal(a.bendOrderedFit(env.copies[0]),p.records[0]);
 if(count>128)assert.equal(a.bendReadyFit(env.copies[0]),null,'Expanded objects cannot fall through to per-copy Bend');
 env.source.geometryRevision=1;
 assert.equal(a.bendOrderedFit(env.copies[0]),null,'The instanced path must not publish stale fit data');
}
{
 const env=world(129),a=approval(env);
 env.copies.at(-1).frameWorld[10]=2;
 assert.equal(a.bendAdmission('owner').reason,'occurrence-limit','One incompatible metric may not be incorrectly colored like the first fit');
 assert.equal(approval(world(129,true)).bendAdmission('owner').reason,'occurrence-limit','Paged geometry keeps previous coverage');
}

{
 const env=world(130),a=approval(env);
 env.owner.type='symmetry';
 for(const m of env.copies){
  m.replicaSource={...env.source,replicaSource:env.source,replicaMatrix:identity()};
  m.frameWords=new Uint32Array(32);m.boundsMin=[0,0,0];m.boundsMax=[1,1,1];
 }
 a.states.set('owner',{hash:'owner',scene:env.scene,renderer:env.renderer});
 const p=a.bendAdmission('owner');assert.equal(p.count,130);assert.equal(p.compactOnly,true);
 assert.equal(a.bendOrderedLayouts().get('owner'),env.source);
 const planner=span('    function orderedReplicaPlan(', '    function smallPlantBlock(');
 const makePlan=new Function('scene','shared','renderer',`
  const appearanceRevision=0,poseEpoch=0,bendMaxOccurrences=128,bendStates=new Set(['owner']),
   bendNeedsSharedViewport=()=>true,bendOrderedLayouts=()=>shared,classifiedSurfaceWire=()=>false,
   orderedReplicaFrameBytes=n=>n*128,replicaFrameLayout=()=>({}),releaseGPU=()=>{},retireOrderedReplicas=()=>{},plantWorldDiameter=()=>0,
   GPUBufferUsage={STORAGE:1,COPY_DST:2},makeGPUBuffer=(d,{size})=>({size});
  ${planner}
  return orderedReplicaPlan(renderer);
 `);
 const r={device:{limits:{},createBindGroup:()=>({}),queue:{writeBuffer(){}}}};
 const ordered=makePlan(env.scene,a.bendOrderedLayouts(),r);
 assert.equal(ordered.instances,130);assert.equal(ordered.buffer.size,130*128);
 assert.ok(ordered.runs.some(k=>k.source===env.source&&k.to-k.from===130));
}

const drawBlock=span('    function prepareOrderedReplicaDraw(', '// Shared viewport bridge');
const raster=new Function('env',`
 const {scene,plan,fit,source,group,sibling,flags,stats}=env,
  bendMaxOccurrences=128,bendStates=new Set(['owner']),frameNavigation=null,
  frameViewKind=()=>0,viewIndex=0,elementMode='object',polygonWire=()=>false,
  bendNeedsSharedViewport=()=>flags.protect,bendOrderedFit=m=>m===source&&flags.fit?fit:null,
  bendOrderedGroup=m=>m===source?group:null,bendValid=()=>false,
  frameReplicaCapacityError=s=>new RangeError(s),orderedReplicasPending=Symbol(),
  orderedReplicaPlan=()=>plan,pluginSurfaceFilter=m=>m===source&&flags.filter,pluginSurfaceStyle=()=>null,
  FramePlugins={dispatch:()=>null},materialTransparent=m=>m===sibling||m===source&&flags.transparent,
  materialMeshGPU=(r,m)=>({state:{group:{},compose:true},bindings:{uv:{}}}),
  materialReplicaPipeline=(r,m,mat,preview,oit)=>oit?'oit':'material',replicaPipeline=()=>'normal',
  ensureMaterialTransparencyCompose=()=>{},replicaPlantPreview=()=>null,meshVisible=()=>true,smallPlantBlock=()=>false,
  issueOpaqueMesh=()=>{throw Error('Unexpected per-copy draw');},
  issueReplicaSurface=(pass,m,mat,state,frames,count,start)=>stats.push({m,state,count,start}),
  issueBendReplicaSurface=(pass,m,fit,pipeline,frames,count,start)=>stats.push({m,state:'bend',count,start}),
  beginBendReplicaPipelines=()=>flags.shaders?{pipelines:new Map([['false:false','pipeline']])}:{};
 ${drawBlock}
 return {prepareOrderedReplicaDraw,drawOrderedReplicas};
`);
const source={hashId:'owner',materialTags:[{}]},sibling={hashId:'unrelated',materialTags:[{}]},fit={count:129},
 group={compactOnly:true,sharedViews:new Map()},scene={meshes:[...Array(129).fill(source),...Array(256).fill(sibling)]},
 plan={instances:385,buffer:{},group:{},meshes:scene.meshes,runs:[{first:source,source:{},from:0,to:129,blocks:[{start:0,count:129}]},
 {first:sibling,source:{},from:129,to:385,blocks:[{start:129,count:256}]}]},
 flags={fit:true,shaders:false,protect:true},stats=[],r={},a=raster({scene,plan,fit,source,group,sibling,flags,stats});
let p=a.prepareOrderedReplicaDraw(r);
assert.equal(p.prepared[0].state,'material','Cold shared shader keeps native material path batched');
assert.equal(p.prepared[1].oitState,'oit');
assert.equal(a.drawOrderedReplicas(r,{},500,p),385);
assert.deepEqual(stats.map(v=>[v.state,v.count,v.start]),[['material',129,0],['material',256,129]]);
assert.equal(r.replicaDraws.get(0).curvaturePacked,0);
flags.shaders=true;stats.length=0;
p=a.prepareOrderedReplicaDraw(r);
assert.equal(p.prepared[0].fit,fit);assert.equal(p.prepared[1].oitState,'oit');
assert.equal(a.drawOrderedReplicas(r,{},500,p),385);
assert.deepEqual(stats.map(v=>[v.state,v.count,v.start]),[['bend',129,0],['material',256,129]]);
assert.equal(group.sharedViews.get(0),'ready');
assert.equal(r.replicaDraws.get(0).curvaturePacked,129);
assert.equal(r.replicaDraws.get(0).curvatureCalls,1);
a.prepareOrderedReplicaDraw(r); // Active viewport can prepare and reuse the last cached pixels.
assert.equal(group.sharedViews.get(0),'ready','A preparation-only cache hit must not clear actual publication');
flags.transparent=true;
p=a.prepareOrderedReplicaDraw(r);assert.equal(p.prepared[0].oitState,'oit');
assert.equal(group.sharedViews.get(0),'ready','A prepared fallback is not yet the displayed viewport');
a.drawOrderedReplicas(r,{},500,p,false);
assert.equal(group.sharedViews.get(0),'ready','Offscreen capture must not replace the live status');
a.drawOrderedReplicas(r,{},500,p);
assert.equal(group.sharedViews.get(0),'compact-material','Only actual view fallback may update the previous status');
flags.filter=true;
assert.throws(()=>a.prepareOrderedReplicaDraw(r),/cannot batch the expanded Curvature group/,'Unsafe pipeline must not return a per-copy fallback');

const shaderCode=span('    const bendColorWGSL=', '    function bendFit(');
const only=shaderCode.slice(0,shaderCode.indexOf('    function beginBendPipelines'))+
 shaderCode.slice(shaderCode.indexOf('    function beginBendReplicaPipelines'));
const shaders=new Function('renderer','device','draw',`
 const beginBendPipelines=async()=>({bind:{fit:true}}),replicaFrameLayout=()=>({ordered:true}),meshRenderGroups=()=>{};
 ${only}
 return beginBendReplicaPipelines;
`);
const created=[],captured=[],d={createPipelineLayout:d=>d,createShaderModule:o=>{captured.push(o.code);return{getCompilationInfo:async()=>({messages:[]})};},
 createRenderPipelineAsync:async d=>{created.push(d);return d;}},render={device:d,pipeline:{getBindGroupLayout:i=>({index:i})},shaderSource:'',
  surfaceTargets:[{}],wireTargets:[{},{},{}]};
const build=shaders(render,d,()=>{})(render);
await new Promise(resolve=>setImmediate(resolve));
assert.equal(build.error,null);assert.equal(created.length,4);assert.equal(build.pipelines.size,4);
assert.ok(created.every(x=>x.layout.bindGroupLayouts.length===4));
assert.match(captured[0],/out\.triangleID=frame\.flags\.z\+corner\/3u/);
assert.match(captured[0],/bendFaces\[input\.triangleID-bendFrames\[input\.instance\]\.flags\.z\]/);
assert.match(captured[0],/surfaceVertexFrame\(renderAliases\[corner\],frame\)/);
console.log('Ordered Curvature: shared fits at 127/128/129/100k, mixed OIT/pending routing, no oversized fallback and GPU pipeline contract pass.');
