import assert from 'node:assert/strict';
import {loadInputs} from '../inputs.mjs';
const {baseline,candidate,sourceHashes}=await loadInputs();
const hashes={baseline:sourceHashes.baseline,candidate:sourceHashes.candidate};
assert.equal(hashes.candidate,sourceHashes.manifestNative);
assert.equal(hashes.baseline,'4ab552e1b39abbd2b4bab7ebfdb8f6f9ae6245c862bcdd8e687a25e20e0b9463');
Object.assign(globalThis,{GPUTextureUsage:{RENDER_ATTACHMENT:16,COPY_SRC:1},GPUBufferUsage:{MAP_READ:1,COPY_DST:8,UNIFORM:64},GPUMapMode:{READ:1}});
const rows=[];
assert.equal(candidate.RIBBON_WGSL,baseline.RIBBON_WGSL);
for(const domain of ['canonical','gl-window'])assert.equal(candidate.ribbonShader(domain),baseline.ribbonShader(domain));
assert.equal(candidate.relativeClipMatrices.toString(),baseline.relativeClipMatrices.toString());
assert.equal(candidate.pickerGeometryPacket.toString(),baseline.pickerGeometryPacket.toString());
assert.equal(candidate.FrameRibbonPicker.toString(),baseline.FrameRibbonPicker.toString().replaceAll('t.tables.groups.length','(t.tables.pairs.length/2)'));
const oldRank='const occurrence=id-target.ribbonBase-1,edge=occurrence%target.tables.groups.length,instance=Math.floor(occurrence/target.tables.groups.length),raw=target.tables.groups[edge],packet=target.pickPacket;';
const nextRank='const occurrence=id-target.ribbonBase-1,edge=occurrence%(target.tables.pairs.length/2),instance=Math.floor(occurrence/(target.tables.pairs.length/2)),raw={a:target.tables.pairs[edge*2],b:target.tables.pairs[edge*2+1]},packet=target.pickPacket;';
assert.equal(candidate.rankRibbonIds.toString(),baseline.rankRibbonIds.toString().replace(oldRank,nextRank));
rows.push({name:'Source binding: both shaders, Float64 composition/Float32 packet construction unchanged; rank and full ribbon class differ only in representative-pair lookup and group-count spelling',pass:true});
const drain=g=>{let q;do{q=g.next();}while(!q.done);return q.value;};
const fixture=(n,edges,group=Array.from({length:n},(_,i)=>i))=>({vertexCount:n,faceCount:n/3,edges:new Uint32Array(edges),group:new Uint32Array(group),selection:{representatives:new Uint32Array(n),edges:null,faces:null}});
const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
let seed=0x337a19b;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);const int=n=>Math.floor(rand()*n);
const minimalHost=()=>({state:'ready',epoch:1,renderDomain:'canonical',jobs:new Set(),release(){},releaseDepth(){}});
const compactOwner=new candidate.FrameNativePickers(minimalHost());
const makePair=async topology=>({old:drain(baseline.edgePickerTablesWork(topology)),next:await compactOwner.edgeTableCache.get(topology)});
const clean=q=>q?{...q,target:q.target.label}:q;
function targetsFor(rows,which){let base=0;return rows.map(q=>{const tables=q.tables[which],t={...q,tables,ribbonBase:base,ribbonCount:(tables.pairs.length/2)*q.instances};base+=t.ribbonCount;return t;});}

// Real exported rank functions: exact output comparison, no JSON normalization or tolerance.
let randomCases=0,zeroTargetCases=0;
for(let round=0;round<180;round++){
 const data=[];
 for(let k=0;k<1+int(5);k++){
  const n=2+int(25),edges=Array.from({length:2*int(35)},()=>int(n)),group=Array.from({length:n},()=>int(7)===0?0xffffffff:int(n)),topology=fixture(n,edges,group),tables=await makePair(topology),Type=round%2?Float64Array:Float32Array,positions=Type.from({length:n*3},()=>rand()*4-2),instances=1+int(4),clipMatrices=new Type(instances*16);
  for(let j=0;j<instances;j++){let m=I.slice();m[0]=rand()*4-2;m[5]=rand()*4-2;m[12]=rand()*4-2;m[13]=rand()*4-2;m[14]=rand()*2-1;m[3]=rand()*2-1;m[7]=rand()*2-1;m[11]=rand()*2-1;m[15]=round%7===0?0:rand()*3-1;clipMatrices.set(m,j*16);}
  data.push({label:'target'+k,tables,instances,pickPacket:{positions,clipMatrices}});
 }
 const old=targetsFor(data,'old'),next=targetsFor(data,'next'),count=old.reduce((s,t)=>s+t.ribbonCount,0);
 for(let test=0;test<12;test++){
  const w=1+int(13),h=1+int(11),pixels=Uint32Array.from({length:w*h},()=>int(count+1)),region=[int(17),int(17),w,h],vp=[int(13),int(13),100+rand()*300,100+rand()*300],point=[rand()*350,rand()*350],radius=rand()*300;
  assert.deepEqual(clean(candidate.rankRibbonIds(pixels,region,next,vp,point,radius)),clean(baseline.rankRibbonIds(pixels,region,old,vp,point,radius)),`random rank round ${round} test ${test}`);randomCases++;if(!count)zeroTargetCases++;
 }
}
rows.push({name:'Exact differential rank output with mixed empty/multiple targets, 1–4 instances, Float32/Float64, perspective, reflected/zero-w matrices and random rasters',pass:true,cases:randomCases,zeroTargetCases});

// Analytic controls lock down first occurrence, bottom-to-top row scan, ties and inclusive radius.
const analytic=await makePair(fixture(4,[0,1,2,3])),packet={positions:new Float64Array([-1,-.04,0,1,-.04,0,-1,-.04,0,1,-.04,0]),clipMatrices:new Float64Array(I)};
for(const which of ['old','next']){
 const api=which==='old'?baseline:candidate,t=targetsFor([{label:'analytic',tables:analytic,instances:1,pickPacket:packet}],which)[0];
 const q=api.rankRibbonIds(new Uint32Array([1,2,2,1]),[0,0,2,2],[t],[0,0,100,100],[50,50],2);
 assert.equal(q.occurrence,0);assert.equal(q.scanOrder,1);assert.equal(q.distanceSquared,4);assert.deepEqual(q.screen,[50,52]);
 assert.equal(api.rankRibbonIds(new Uint32Array([1]),[0,0,1,1],[t],[0,0,100,100],[50,50],1.999),null);
 assert.throws(()=>api.rankRibbonIds(new Uint32Array([3]),[0,0,1,1],[t],[0,0,100,100],[50,50],3),/outside immutable occurrence/);
 const degenerate={...t,pickPacket:{...packet,positions:new Float64Array([0,0,0,0,0,0,0,0,0,0,0,0])}};
 const z=api.rankRibbonIds(new Uint32Array([1]),[0,0,1,1],[degenerate],[0,0,100,100],[50,50],0);assert.equal(z.distanceSquared,0);assert.equal(z.t,0);
}
rows.push({name:'Analytic bottom-row scan, first-only duplicate admission, last equal-distance winner, inclusive radius, invalid occurrence rejection and zero-length edge',pass:true});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function mockHost({pixels=[1],domain='canonical',deferMap=false}={}){
 const log=[],buffers=[],textures=[],entered=deferred(),gate=deferred();let currentBind=null;
 const buffer=(data,label)=>{const b={label,data,destroyed:false,destroy(){assert.equal(this.destroyed,false,'double buffer destruction');this.destroyed=true;log.push(['destroyBuffer',label]);}};buffers.push(b);return b;};
 const d={limits:{maxBufferSize:2**30},queue:{submit(){log.push(['submit']);},async onSubmittedWorkDone(){log.push(['queueDone']);}},
  createTexture(desc){log.push(['texture',desc.size,desc.format]);const t={destroyed:false,createView(){return {texture:t};},destroy(){assert.equal(this.destroyed,false);this.destroyed=true;log.push(['destroyTexture']);}};textures.push(t);return t;},
  createBuffer(desc){log.push(['readBuffer',desc.size,desc.usage]);const b=buffer(new ArrayBuffer(desc.size),desc.label);b.mapAsync=async()=>{log.push(['mapAsync']);entered.resolve();if(deferMap)await gate.promise;};b.getMappedRange=()=>b.data;b.unmap=()=>log.push(['unmap']);return b;},
  createBindGroup(desc){return desc;},
  createCommandEncoder(){return {beginRenderPass(){return {setViewport(...x){log.push(['viewport',...x]);},setScissorRect(...x){log.push(['scissor',...x]);},setBindGroup(index,b){currentBind=b;const u=b.entries.find(q=>q.binding===3).resource.buffer.data;log.push(['bind',index,Array.from(new Uint32Array(u.buffer,u.byteOffset+48,4))]);},setPipeline(p){log.push(['pipeline',p]);},draw(...args){log.push(['draw',...args]);},end(){log.push(['end']);}};},copyTextureToBuffer(from,to,size){log.push(['copy',to.bytesPerRow,to.rowsPerImage,size]);const out=new Uint32Array(to.buffer.data);for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++)out[y*to.bytesPerRow/4+x]=pixels[(y*size[0]+x)%pixels.length]??0;},finish(){return {};}};}}
 const h={state:'ready',epoch:1,renderDomain:domain,jobs:new Set(),device:d,
  _buffer(data,usage,label){const copy=data.slice();log.push(['uniform',Array.from(copy),usage]);return buffer(copy,label);},
  _storage(data,label){log.push(['storage',Array.from(data)]);return buffer(data.slice(),label);},
  prepare(packet){baseline.validatePacket(packet);const p={positions:{},matrices:{},instanceCount:packet.clipMatrices.length/16,instanceRanges:packet.instanceRanges};log.push(['prepare',p.instanceCount,Array.from(packet.clipMatrices)]);return p;},
  screen(dimensions){return {renderDomain:domain,epoch:this.epoch,viewport:dimensions.viewport,texture:{createView:()=>({})},disposed:false};},release(){log.push(['release']);},releaseDepth(depth){depth.disposed=true;log.push(['releaseDepth']);}};
 return {h,log,buffers,textures,entered:entered.promise,releaseMap:()=>gate.resolve()};
}
function ribbon(api,host){const r=new api.FrameRibbonPicker(host);r.layout={};r.pipelines=new Map([['cw','cw'],['ccw','ccw']]);return r;}
function mockTargets(data,which){return data.map(q=>({...q,tables:q.tables[which],p:{positions:{},matrices:{},instanceCount:q.instances,instanceRanges:q.ranges},edgeBuffer:{}}));}
const tablesA=await makePair(fixture(6,[0,1,2,3,4,5,1,0],[0,1,2,3,4,5])),tablesB=await makePair(fixture(6,[3,4,4,5,3,5])),tablesZero=await makePair(fixture(0,[]));
const matrices=Float32Array.from([...I,...I,...I]);
const data=[{label:'empty',tables:tablesZero,instances:2,ranges:[{start:0,count:2,frontFace:'ccw'}],ribbonOrder:0,pickPacket:{positions:new Float32Array(),clipMatrices:matrices}},
 {label:'late',tables:tablesA,instances:3,ranges:[{start:0,count:1,frontFace:'cw'},{start:1,count:0,frontFace:'ccw'},{start:1,count:2,frontFace:'ccw'}],ribbonOrder:9,pickPacket:{positions:Float32Array.from({length:18},(_,i)=>i%3===1?0:(i%3===2?0:(i%2?-.5:.5))),clipMatrices:matrices}},
 {label:'early',tables:tablesB,instances:2,ranges:[{start:0,count:2,frontFace:'cw'}],ribbonOrder:1,pickPacket:{positions:Float32Array.from({length:18},(_,i)=>i%3===0?.5:0),clipMatrices:matrices}}];
let gpuControls=0;
for(const domain of ['canonical','gl-window'])for(const width of [1,3,65]){
 const results=[];
 for(const [api,which] of [[baseline,'old'],[candidate,'next']]){
  const m=mockHost({pixels:[1,9,10,15,0,8],domain}),depth=m.h.screen({viewport:[7,11,150,150]}),targets=mockTargets(data,which),p=ribbon(api,m.h);
  const q=await p.pick(targets,depth,[50,50],{radius:(width-1)/2,width:3,through:true,tolerance:.02,isCurrent:()=>true,rankingViewport:[0,0,150.5,149.25]});
  assert.equal(m.h.jobs.size,0);assert.ok(m.buffers.every(q=>q.destroyed));assert.ok(m.textures.every(q=>q.destroyed));
  results.push({result:clean(q),log:m.log,bases:targets.map(t=>[t.ribbonBase,t.ribbonCount])});
 }
 assert.deepEqual(results[1],results[0]);assert.deepEqual(results[1].bases,[[0,0],[0,9],[9,6]]);
 const draws=results[1].log.filter(q=>q[0]==='draw');assert.deepEqual(draws,[['draw',6,6,0,0],['draw',6,3,0,0],['draw',6,6,0,3]]);gpuControls++;
}
rows.push({name:'Actual FrameRibbonPicker mock-device calls, uniforms, group/instance IDs, multi-target offsets, equal-z ribbon ordering, reflection ranges, ROI padding and cleanup',pass:true,cases:gpuControls,qualification:'Protocol only, no GPU shader execution or raster/physical UI claim'});

for(const [api,which] of [[baseline,'old'],[candidate,'next']]){
 const m=mockHost(),p=ribbon(api,m.h),empty=mockTargets([data[0]],which),depth=m.h.screen({viewport:[0,0,100,100]});
 assert.equal(await p.pick(empty,depth,[50,50],{radius:1,isCurrent:()=>true}),null);assert.equal(m.log.length,0);
 const overflow=[{tables:which==='old'?{groups:{length:0x80000000},pairs:{length:0x100000000}}:{pairs:{length:0x100000000}},p:{instanceCount:2}}];
 await assert.rejects(p.pick(overflow,depth,[50,50],{radius:1,isCurrent:()=>true}),/Uint32 occurrence IDs/);assert.equal(m.log.length,0);
}
rows.push({name:'Empty edge tables return null without GPU work and Uint32 occurrence overflow rejects before allocation',pass:true});

let staleCases=0;
for(const kind of ['externalSignal','callerFreshness','hostEpoch','hostLost','depthDisposed','jobCancel','invalidRaster']){
 for(const [api,which] of [[baseline,'old'],[candidate,'next']]){
  const m=mockHost({pixels:kind==='invalidRaster'?[0xffffffff]:[1],deferMap:true}),p=ribbon(api,m.h),depth=m.h.screen({viewport:[0,0,100,100]}),controller=new AbortController();let valid=true;
  const task=p.pick(mockTargets(data,which),depth,[50,50],{radius:1,signal:controller.signal,isCurrent:()=>valid});
  await m.entered;
  if(kind==='externalSignal')controller.abort();if(kind==='callerFreshness')valid=false;if(kind==='hostEpoch')m.h.epoch++;if(kind==='hostLost')m.h.state='lost';if(kind==='depthDisposed')depth.disposed=true;if(kind==='jobCancel')[...m.h.jobs][0].cancel();m.releaseMap();
  await assert.rejects(task,kind==='invalidRaster'?/outside immutable occurrence/:{name:'AbortError'});assert.equal(m.h.jobs.size,0);assert.ok(m.buffers.every(q=>q.destroyed));assert.ok(m.textures.every(q=>q.destroyed));staleCases++;
 }
}
rows.push({name:'Actual FrameRibbonPicker deferred map guard blocks abort/stale caller/epoch/device/depth/job and rejects unknown ID, always clears job/resources',pass:true,cases:staleCases});

// Full prepare -> actual ribbon class -> NativePickerSession public result, including identity maps and CSS grid.
const topo=fixture(6,[3,2,0,1,5,4,2,3,1,0,4,5,2,2],[0,1,0,1,0,1]);
async function sessionResult(api,{grid=false,pixels=[1],deferMap=false}={}){
 const m=mockHost({pixels,deferMap}),adapter=new api.FrameNativePickers(m.h);adapter.depthOwner={renderDomain:'canonical',releasePrepared(){},dispose(){}};adapter.ribbon=ribbon(api,m.h);
 const object={uuid:'object-live'},g={positions:new Float32Array([-.9,-.25,.2,.9,-.25,.2,-.9,.25,.3,.9,.25,.3,-.9,0,.4,.9,0,.4]),vertexCount:6,source:{drawRange:{start:0,count:6}}};
 const worldMatrices=new Float64Array([...I,...I,...I]);worldMatrices[16+12]=.1;worldMatrices[32+5]=-1;
 const instances={count:3,worldMatrices,ranges:[{start:0,count:2,frontFace:'ccw'},{start:2,count:1,frontFace:'cw'}]};let fresh=true;
 const snapshot={packets:[{kind:'triangles',geometry:g,instances,object,objectId:'object-live'}],isCurrent:()=>fresh};
 const camera={viewProjection:new Float32Array(I),viewProjection64:new Float64Array(I),viewport:[0,0,200,160],worldOrigin:[0,0,0]};
 const identity={objectId:'authored',batchId:'batch',vertexIds:new Uint32Array([0xffffffff,2,17,0,17,2]),instances:[{instanceId:11,sourceObjectId:'first'},{instanceId:90,sourceObjectId:'ghost'},{instanceId:0xffffffff,sourceObjectId:'mirrored'}]};
 const options={sources:[{snapshot,identity,ready:{topology:topo,isCurrent:()=>fresh}}],camera,width:200,height:160,viewport:camera.viewport,through:true,edgeQuery:true,selectionDomain:'edge',isCurrent:()=>fresh,...(grid?{pixelRatio:2,ribbonWidth:6,ribbonGrid:{viewport:[0,0,100,80],rankingViewport:[0,0,100.5,80.25],origin:[0,0],pixelRatio:2}}:{})};
 const s=await adapter.prepare(options);
 return {m,adapter,s,identity,camera,options,stale:()=>fresh=false};
}
let sessionCases=0;
for(const grid of [false,true])for(let occurrence=0;occurrence<6;occurrence++){
 const results=[];
 for(const api of [baseline,candidate]){
  const {m,adapter,s}=await sessionResult(api,{grid,pixels:[occurrence+1]});
  const q=await s.pickEdgeNear([100,80],{radius:100});assert.ok(q);assert.equal(q.isCurrent(),true);
  const result={...q};delete result.isCurrent;delete result.mesh;results.push({result,log:m.log});await s.dispose();await adapter.dispose();
 }
 assert.deepEqual(results[1],results[0]);assert.equal(results[1].result.localInstance,Math.floor(occurrence/2));assert.equal(results[1].result.edgeId,occurrence%2);
 if(occurrence%2===0){assert.deepEqual(results[1].result.rawEdge,[3,2]);assert.deepEqual(results[1].result.rawEdgeIds,[0,1,2,3,4,5]);assert.deepEqual(results[1].result.keys,['0:17','2:4294967295','2:17','0:17','2:4294967295','2:17']);assert.deepEqual(results[1].result.edge,[0,17,'0:17']);}
 sessionCases++;
}
rows.push({name:'Full adapter prepare -> actual ribbon -> session public selection parity, 3 instances, ghost/mirror identity, max-Uint32 and duplicate authored vertex IDs, alias order, representative orientation, CSS grid scaling',pass:true,cases:sessionCases});

let sessionStale=0;
for(const kind of ['source','identityMap','instanceIdentity','camera','signal','adapterDisposed'])for(const api of [baseline,candidate]){
 const {m,adapter,s,identity,camera,stale}=await sessionResult(api,{deferMap:true}),controller=new AbortController(),task=s.pickEdgeNear([100,80],{radius:100,signal:controller.signal});await m.entered;
 if(kind==='source')stale();if(kind==='identityMap')identity.vertexIds[0]=44;if(kind==='instanceIdentity')identity.instances[0].sourceObjectId='changed';if(kind==='camera')camera.viewProjection[12]=.2;if(kind==='signal')controller.abort();if(kind==='adapterDisposed')adapter.disposed=true;
 m.releaseMap();await assert.rejects(task,{name:'AbortError'});assert.equal(s.running,null);assert.equal(s.controller,null);assert.equal(m.h.jobs.size,0);await s.dispose();adapter.disposed=false;await adapter.dispose();sessionStale++;
}
rows.push({name:'Full prepared sessions reject deferred ribbon after source/identity-map/instance/camera/signal/owner changes and clear running/controller',pass:true,cases:sessionStale});
let warmCases=0;
for(const api of [baseline,candidate]){
 const {adapter,s,options}=await sessionResult(api,{pixels:[1]}),first=await s.pickEdgeNear([100,80],{radius:100}),table=s.targets[0].tables;
 await s.dispose();
 for(let k=0;k<4;k++){
  const next=await adapter.prepare(options),result=await next.pickEdgeNear([100,80],{radius:100});
  const normalize=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['mesh','isCurrent'].includes(k)));
  assert.deepEqual(normalize(result),normalize(first));
  if(api===candidate)assert.equal(next.targets[0].tables,table);
  await next.dispose();warmCases++;
 }
 if(api===candidate){assert.equal(adapter.edgeTableCache.stats.builds,1);assert.equal(adapter.edgeTableCache.stats.hits,4);}
 await adapter.dispose();
}
rows.push({name:'Four reopened sessions preserve public result on warm cache; candidate reuses exact table with one build and four hits',pass:true,cases:warmCases});
await compactOwner.dispose();
const report={pass:true,...hashes,execution:'Independent Node controls against actual baseline and candidate exports. Mock-device protocol checks use synthetic pixels; no real WebGPU execution, browser, physical UI, real-model acceptance or performance claim.',rows};
console.log(JSON.stringify(report,null,2));
