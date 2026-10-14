import assert from 'node:assert/strict';
import * as Native from '../../../modules/native.4ec912c8a6f2b4d498f1.js';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {OrdinaryMoveDisplayRoot} from '../../../native-source/ordinary-move-display.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import {OrdinaryMoveActor} from '../../../native-source/ordinary-move-actor.mjs';
import {fixture as editorFixture} from './integration-fixture.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript');
globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,INDEX:16,UNIFORM:64};
function device(){const buffers=[];return{buffers,limits:{maxBufferSize:1<<24,maxStorageBufferBindingSize:1<<24},queue:{onSubmittedWorkDone:async()=>{}},createBuffer({size,usage,label,mappedAtCreation}){const bytes=new ArrayBuffer(size),b={size,usage,label,destroyed:false,getMappedRange:()=>bytes,unmap(){},destroy(){assert(!this.destroyed);this.destroyed=true;}};buffers.push(b);return b;},createBindGroup:q=>q};}
function material(){return{type:'basic',color:[1,1,1,1],emissive:[0,0,0],roughness:1,metalness:0,alphaTest:0,lineWidth:1,pointSize:4,mapInverse:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],mapNormal:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],uvTransform:[1,0,0,0,1,0,0,0,1],cullMode:'none',sizeAttenuation:false,transparent:false};}
function instances(){const data=new Float32Array(36);data.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);data.set(data.subarray(0,16),16);data.set([1,1,1,1],32);return{data,count:1,ranges:[{start:0,count:1,frontFace:'ccw'}],isCurrent:()=>true};}
function display(d,pool){const x=Object.create(Native.FrameGpuDisplay.prototype);Object.assign(x,{device:d,pool,state:'ready',objectLayout:{},handles:new Set(),renderDomain:'canonical',basicSpecialization:'disabled',standardSpecialization:'disabled',_texture:()=>({}),_releaseTexture(){},_pipeline:async()=>({})});return x;}
async function fixture(){
 const count=129,positions=new Float32Array(count*3),normals=new Float32Array(count*3),extras=new Float32Array(count*9),indices=Uint16Array.from({length:count},(_,i)=>i);
 for(let i=0;i<count;i++){positions[i*3]=i;normals[i*3+2]=extras[i*9+2]=1;extras[i*9+5]=extras[i*9+6]=extras[i*9+7]=extras[i*9+8]=1;}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setAttribute('normal',new THREE.BufferAttribute(normals,3));g.setIndex(new THREE.BufferAttribute(indices,1));
 const numeric={positions:positions.slice(),extras,indices:indices.slice(),vertexCount:count,hasNormals:true,hasUV:false,hasColors:false};
 const wire=new THREE.BufferGeometry();wire.setAttribute('position',g.attributes.position);wire.setIndex(new THREE.BufferAttribute(Uint16Array.from({length:258},(_,i)=>i%count),1));
 const elements=Uint32Array.from(wire.index.array),pointElements=Uint32Array.from(numeric.indices),d=device(),pool=new Native.GpuBufferPool(d),native={...Native};
 // Root initialization deliberately does not compile shaders until begin.
 const root=new OrdinaryMoveDisplayRoot({native,mesh:new THREE.Mesh(g),numeric,device:d,pool,isCurrent:()=>true,aliases:[{geometry:wire,extras,elements}],primaryElements:pointElements,yieldTask:async()=>{}});
 await root.initialize();return{g,wire,numeric,elements,pointElements,d,pool,root,display:display(d,pool)};
}
const rows=[];
async function test(name,run){await run();rows.push({name,pass:true});}
await test('actual FrameGpuDisplay.prepare reuses staged triangle INDEX buffer and rigid storage keys',async()=>{
 const q=await fixture(),before=q.d.buffers.length,geo=Native.captureRigidGpuGeometry(q.g);
 const h=await q.display.prepare({kind:'triangles',geometry:geo,instances:instances(),material:material(),start:0,count:q.numeric.indices.length});
 const added=q.d.buffers.slice(before);assert(!added.some(b=>['Frame positions','Frame normals UV colour','Frame indices'].includes(b.label)));
 assert.equal(h.index,q.root.uploadRows.find(r=>r.data===q.numeric.indices&&r.usage===16).buffer);q.display.release(h);await q.root.dispose();assert.equal(q.pool.bytes,0);
});
await test('actual post-swap wire alias capture avoids index scanning, extra allocation and cold renderer upload',async()=>{
 const q=await fixture();let scans=0;const iterator=q.wire.index.array[Symbol.iterator].bind(q.wire.index.array);q.wire.index.array[Symbol.iterator]=function*(){scans++;yield*iterator();};
 const geo=Native.captureRigidGpuGeometry(q.wire);assert.equal(scans,0);assert.equal(geo.extras,q.numeric.extras);
 const ids=Native.lineIndices(geo,'segments',0,q.elements.length);assert.equal(ids,q.elements);const before=q.d.buffers.length;
 const h=await q.display.prepare({kind:'segments',geometry:geo,instances:instances(),material:material(),indices:ids,start:0,count:ids.length});
 assert(!q.d.buffers.slice(before).some(b=>['Frame positions','Frame normals UV colour','Frame line point IDs'].includes(b.label)));
 q.display.release(h);await q.root.dispose();assert.equal(q.pool.bytes,0);
});
await test('composed initial editor ownership stages worker wireElements before the first frozen renderer prepare',async()=>{
 const d=device(),pool=new Native.GpuBufferPool(d);class Actor extends OrdinaryMoveActor{constructor(options){super({...options,WorkerType:Worker});}}
 const q=editorFixture({ActorType:Actor,device:d,pool}),g=q.mesh.geometry,wire=new THREE.BufferGeometry();wire.setAttribute('position',g.attributes.position);wire.setIndex([0,1,1,2,0,2]);q.ctx.wireOverlays.set('A',{geometry:wire});
 const r=q.ctx.frameOrdinaryOwner('A');try{await r.actor.ready;const elements=r.actor.initialDerived.wireElements;let scans=0;const iterator=wire.index.array[Symbol.iterator].bind(wire.index.array);wire.index.array[Symbol.iterator]=function*(){scans++;yield*iterator();};
  const geo=Native.captureRigidGpuGeometry(wire);assert.equal(scans,0);assert.equal(geo.extras,r.actor.root.numeric.extras);assert.equal(Native.lineIndices(geo,'segments',0,wire.index.count),elements);
  const displayObject=display(d,pool),before=d.buffers.length,h=await displayObject.prepare({kind:'segments',geometry:geo,instances:instances(),material:material(),indices:elements,start:0,count:elements.length});
  assert(!d.buffers.slice(before).some(b=>['Frame positions','Frame normals UV colour','Frame line point IDs'].includes(b.label)));assert.equal(h.elements,r.actor.root.uploadRows.find(row=>row.data===elements&&row.usage===136).buffer);displayObject.release(h);
 }finally{await r.actor.dispose();assert.equal(pool.bytes,0);}
});
await test('actual point packet reuses worker-produced point IDs with STORAGE|COPY_DST and minimum bytes',async()=>{
 const q=await fixture(),geo=Native.captureRigidGpuGeometry(q.g),ids=Native.lineIndices(geo,'points',0,q.pointElements.length);assert.equal(ids,q.pointElements);
 const before=q.d.buffers.length,h=await q.display.prepare({kind:'points',geometry:geo,instances:instances(),material:material(),indices:ids,start:0,count:ids.length});
 assert(!q.d.buffers.slice(before).some(b=>b.label==='Frame line point IDs'));assert.equal(h.elements,q.root.uploadRows.find(r=>r.data===ids&&r.usage===136).buffer);
 q.display.release(h);await q.root.dispose();assert.equal(q.pool.bytes,0);
});
await test('actual editor overlay staging/cache install matches real triangle, segment and point prepare keys',async()=>{
 const q=await fixture(),code=fs.readFileSync(new URL('../../ordinary-move-integration.mjs',import.meta.url),'utf8'),ast=ts.createSourceFile('integration',code,99,true,1);
 const objects=Array.from({length:3},()=>({geometry:new THREE.BufferGeometry(),matrix:new THREE.Matrix4()}));
 const selection={face:objects[0],edge:objects[1],vertex:objects[2],faceBack:{geometry:objects[0].geometry,matrix:new THREE.Matrix4()}};
 const cache=new Native.DisplayGeometryCache(),ctx=vm.createContext({THREE2:THREE,frameNative:Native,DOMException,polySelection:selection,polyMode:true,frameOrdinaryCM:null,frameOrdinaryStamp:()=>({}),frameOrdinaryMeasurements:()=>null,scheduleRender:()=>{}});
 for(const name of ['frameOrdinaryStageEntry','frameOrdinaryStageSelection','frameOrdinaryInstallSelection']){const f=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);vm.runInContext(f.getText(ast),ctx);}
 const r={actor:{pool:q.pool,tasks:{yield:async()=>{}}},engine:{geometryCache:cache}},data={selection:{vertices:[0],edges:[],faces:[]},measurements:null,overlayNumeric:{}};
 for(const[key,count]of [['fp',3],['ep',2],['vp',1]]){const extras=new Float32Array(count*9);for(let i=0;i<count;i++)extras[i*9+2]=extras[i*9+5]=extras[i*9+6]=extras[i*9+7]=extras[i*9+8]=1;data.overlayNumeric[key]={positions:new Float32Array(count*3),extras,indices:Uint32Array.from({length:count},(_,i)=>i),vertexCount:count,hasNormals:false,hasUV:false,hasColors:false};}
 await ctx.frameOrdinaryStageSelection(r,data,()=>true);ctx.frameOrdinaryInstallSelection(r,data,false);
 for(const[key,kind,o]of [['fp','triangles',selection.face],['ep','segments',selection.edge],['vp','points',selection.vertex]]){
  const geo=cache.capture(o.geometry),ids=kind==='triangles'?undefined:Native.lineIndices(geo,kind,0,geo.vertexCount),before=q.d.buffers.length;
  const h=await q.display.prepare({kind,geometry:geo,instances:instances(),material:material(),indices:ids,start:0,count:geo.vertexCount});
  assert(!q.d.buffers.slice(before).some(b=>['Frame positions','Frame normals UV colour','Frame indices'].includes(b.label)||b.label==='Frame line point IDs'&&b.size>8));
  if(kind!=='triangles')assert.equal(h.elements,q.pool.entries.get(ids).get(`136:${Math.max(8,ids.byteLength)}`).buffer);
  q.display.release(h);
 }
 for(const row of r.overlayUploads)q.pool.release(row);await q.root.dispose();assert.equal(q.pool.bytes,0);
});
console.log(JSON.stringify({pass:true,cases:rows.length,rows,scope:'Actual frozen r247 FrameGpuDisplay.prepare/captureRigidGpuGeometry/lineIndices and shared pool with a fake device; no hardware latency claim'}));
