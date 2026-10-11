import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {declarations,extractTopology} from '../source-tools.mjs';
import {read,sources,topologyModule} from '../support/source-paths.mjs';
import {THREE} from '../support/three.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const bindings={editorBase:'df08be98af28f6898ae0bd76b1f99de09009b23ca0676c0afaadd25ca5afaf17',editorNext:'4a5ef2cdfe5c6b0bfe062d1a7cc5970a269e855f0a1cef9df2ab2ddad5ede74b',nativeBase:'2e10321a8de53806ff34fc7591ce38353cd17a2812cecc6c95f0eefc41741eef',nativeNext:'2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85'};
const texts={editorBase:read('editor-baseline-r239.mjs'),editorNext:read('editor-candidate.mjs'),nativeBase:read('native-on-cache-baseline.mjs'),nativeNext:read('native-candidate.mjs')};
for(const k of Object.keys(texts))assert.equal(sha(texts[k]),bindings[k]);
for(const suffix of ['Base','Next'])assert.equal((suffix==='Next'?topologyModule:fs.readFileSync(new URL(`topology${suffix}.mjs`,import.meta.url),'utf8')),extractTopology(texts[`native${suffix}`]));
const oldTopo=await import('./topologyBase.mjs'),newTopo=await import('./topologyNext.mjs');
assert.equal(sha(read('three-baseline.mjs')),'ed200c36396533a895a276bdf539ca86bd7ec8909d483de4f6eb5bda32cb24ec');
assert.equal(sha(read('three-core-baseline.mjs')),'9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6');
assert.equal(read('three-node-adapter.mjs'),read('three-baseline.mjs').replaceAll("'frame-three-core'",JSON.stringify(sources.core.href)));
const old=declarations(texts.editorBase),next=declarations(texts.editorNext),finish=g=>{for(;;){let v=g.next();if(v.done)return v.value;}};
const names=['polyFocusActive','splineFocusActive','polyEdgeKey','logicalEdges','logicalVertexGroups','frameLogicalEdgesWork','frameLogicalVertexGroupsWork','framePolySelectedVertexIdsWork','frameEdgeSelectionBasisWork','frameFaceSelectionBasisWork','framePolySelectionMeasurements','polySelectedVertexIds','polySelectionBounds','polyFrameMatrix','polyExtentInFrame','polyOwnerHash','pureWorldFrame','rotMatOfLin','polyAutoBasis','edgeSelectionBasis','faceSelectionBasis','polyCoordReference','readPolyTransform','basisFromNormal'];
const added=['frameCurrentNativeEdgeCM','frameRememberNativeEdgeCM','frameSelectedLogicalEdgeRepresentativesWork','frameNativeEdgeSelectedVertexIdsWork','frameNativeEdgeSelectionBasisWork','frameNativeEdgeClickMeasurementsWork'];
function context(isNext){const c={THREE2:THREE,Uint32Array,Float32Array,Float64Array,Map,Set,polyElementMode:'edge',polyMode:true,componentFocus:'poly',componentModeArmed:true,coordMode:'object',polyPivotMatrix:null,polyExactEdgeVertices:null,uvEdit:false,splineMode:false,vertexTools:{mode:null,soft:{active:false}},polySelection:{items:new Map()},selNodes:new Set(),pickMeshes:new Map(),OBJ:new Map(),logicalEdgeCache:new WeakMap(),vertexGroupCache:new WeakMap(),vertexGroupOfCache:new WeakMap(),framePolySelectionRevision:0,sceneStateToken:0,sceneMutationSequence:0,frameAnimationRevision:0,frameEvaluatedTime:0,_rotX:new THREE.Vector3(),_rotY:new THREE.Vector3(),_rotZ:new THREE.Vector3(),_RM:new THREE.Matrix4(),frameNativeEdgeCM:null,frameRigidSelectedIDs:()=>null,framePolygonDragSelectedIDs:()=>null,frameRigidBounds:()=>null,frameRigidExtent:()=>null,worldMatrix:n=>n.matrixWorld,frameNative:newTopo};vm.createContext(c);vm.runInContext(names.map(n=>(isNext?next:old).get(n)).join('\n')+(isNext?'\n'+added.map(n=>next.get(n)).join('\n'):''),c);return c;}
function geom(p,i=null){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));if(i)g.setIndex(new THREE.BufferAttribute(i,1));return g;}
const item=(vertices=[],edges=[],faces=[])=>({vertices:new Set(vertices),edges:new Set(edges),faces:new Set(faces)});
function scene(c,geometries,selections,transforms){c.frameNativeEdgeCM=null;c.polyPivotMatrix=null;c.polyExactEdgeVertices=null;c.polySelection.items=new Map();c.pickMeshes.clear();c.OBJ.clear();c.selNodes.clear();geometries.forEach((g,i)=>{const h=`owner-${i}`,m=new THREE.Mesh(g);m.matrixAutoUpdate=false;m.matrix.copy(transforms[i]);m.updateMatrixWorld(true);c.pickMeshes.set(h,m);c.OBJ.set(h,m);c.selNodes.add(h);c.polySelection.items.set(h,item([...selections[i].vertices],[...selections[i].edges],[...selections[i].faces]));});}
let seed=0x432fa891;const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),integer=n=>Math.floor(rng()*n),shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=integer(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;};
const stats={topologies:0,unchangedTopologyFields:0,packedScalar:0,corners:0,representatives:0,aliasOrders:0,bases:0,measurements:0,cmReads:0,workerTransfers:0,captureLayouts:0};
const fixtures=[];
function add(name,values,indices=null){for(const Ty of [Float32Array,Float64Array])fixtures.push({name:name+'/'+Ty.name,p:Ty.from(values),i:indices&&Uint32Array.from(indices)});}
add('nonmanifold-reversed-alias',[0,0,0,1,0,0,0,1,0,0,-1,0,0,0,1,0,0,0,1,0,0,0,1,0],[1,0,2,0,1,3,6,5,4,0,1,4,6,5,7]);
add('all-logically-collapsed',[-.0000049,0,0,.0000049,0,0,-0,0,0,0,.0000049,0,0,-.0000049,0,0,0,0],[2,1,0,4,3,5,1,1,1]);
add('quantization-half',[.000005,0,0,-.000005,0,0,.000004999999,0,0,-.000005000001,0,0,1,0,0,2,0,0],[4,0,5,1,4,2,3,5,4]);
add('isolated-unused-vertices',[4,1,2,0,0,0,1,0,0,2,0,0,9,8,7,0,0,0],[3,2,1,2,5,3]);
add('empty',[]);add('single-zero-triangle',[0,0,0,0,0,0,0,0,0]);
add('string-fallback-huge-quantization',[1e12,1e12,0,1e12+1,1e12,0,1e12,1e12+1,0,1e12,1e12,0,1e12+1,1e12,0,1e12,1e12+1,0],[2,1,0,3,4,5]);
for(let run=0;run<100;run++){const n=3+integer(55),vals=[],idx=[];for(let v=0;v<n;v++){if(v&&rng()<.42){const k=integer(v);vals.push(...vals.slice(k*3,k*3+3));}else vals.push(...Array.from({length:3},()=>integer(9)-4+(rng()<.2?(rng()<.5?4.9999e-6:5.0001e-6):0)));}if(run%3){for(let f=0;f<1+integer(30);f++){const a=integer(n),b=integer(n),c=integer(n);idx.push(a,b,c);if(rng()<.25)idx.push(c,b,a);}}else vals.splice(Math.floor(n/3)*9);fixtures.push({name:`random-${run}`,p:(run%2?Float32Array:Float64Array).from(vals),i:run%3?Uint32Array.from(idx):null});}
{const p=new Float64Array(66004*3);for(let i=0;i<p.length/3;i++)p[3*i]=i;fixtures.push({name:'pair-over-uint32',p,i:Uint32Array.from([66003,66002,66001,66001,66002,66000])});}
{const p=[];for(let i=0;i<2000;i++)p.push(i,0,0,i+1,0,0,i+.5,0,0);fixtures.push({name:'large-selected-merge',p:Float64Array.from(p),i:null});}
const ca=context(false),cb=context(true),eq=(a,b,label)=>assert.deepEqual(Array.from(a),Array.from(b),label),matrix=(a,b,label)=>{assert.equal(!!a,!!b,label);if(a)eq(a.elements,b.elements,label);};
const transforms=[new THREE.Matrix4(),new THREE.Matrix4().compose(new THREE.Vector3(3,-7,4),new THREE.Quaternion().setFromEuler(new THREE.Euler(.31,-1.7,.003)),new THREE.Vector3(-2,.0003,7)),new THREE.Matrix4().set(1,.31,0,100,.3,-.5,.71,-200,.13,0,2,.1,0,0,0,1),new THREE.Matrix4().makeScale(0,3,-1)];
const kept=[];
for(const fx of fixtures){let reference;const g=geom(fx.p,fx.i),legacy=ca.logicalEdges(g),keyToFirst=new Map(),count=fx.i?.length??fx.p.length/3;
 const kpos=i=>[0,1,2].map(j=>Math.round(fx.p[3*i+j]*1e5)).join(','),lk=(a,b)=>[kpos(a),kpos(b)].sort().join('|');
 for(let corner=0;corner<count;corner++){const base=corner-corner%3,a=fx.i?fx.i[corner]:corner,b=fx.i?fx.i[base+(corner%3+1)%3]:base+(corner%3+1)%3,k=lk(a,b);if(!keyToFirst.has(k))keyToFirst.set(k,corner);}
 for(const packedTables of [false,true]){const options={packedTables,batch:13},base=finish(oldTopo.buildTopologyWork({positions:fx.p,indices:fx.i},options)),actual=finish(newTopo.buildTopologyWork({positions:fx.p,indices:fx.i},options)),{edgeFirstCorners,...rest}=actual;
  assert.deepEqual(rest,base,fx.name);stats.topologies++;stats.unchangedTopologyFields+=Object.keys(base).length;if(reference){assert.deepEqual(actual,reference,fx.name);stats.packedScalar++;}else reference=actual;
  for(let e=0;e<actual.edgeCount;e++){assert.equal(edgeFirstCorners[e],keyToFirst.get(lk(actual.edges[2*e],actual.edges[2*e+1])),fx.name);stats.corners++;}
 }
 const all=legacy.flatMap(e=>e.keys),selections=[new Set(all),new Set(all.toReversed()),new Set(shuffle(all).slice(0,Math.ceil(all.length*.6))),new Set(legacy.flatMap(e=>e.keys.slice(-1))),new Set(['1:0','00:1','0:01','-0:1','0:1:2','0:1.0','NaN:1','1:999999999','','x:y'])];
 if(reference.vertexCount<=20)for(let a=0;a<reference.vertexCount;a++)for(let b=a;b<reference.vertexCount;b++)selections.push(new Set([`${a}:${b}`]));
 if(all.length<=12)for(let mask=0;mask<2**all.length;mask++)selections.push(new Set(all.filter((_,i)=>mask&(1<<i))));
 for(const selected of selections){const expected=Array.from(legacy.filter(e=>e.keys.some(k=>selected.has(k))),e=>[e.a,e.b]);const got=finish(cb.frameSelectedLogicalEdgeRepresentativesWork(g,reference,selected));assert.deepEqual(Array.from(got,e=>[e.a,e.b]),expected,fx.name);stats.representatives++;
  const s=item(fx.p.length?[integer(fx.p.length/3)]:[],selected,reference.faceCount?[integer(reference.faceCount)]:[]),ready=new Map([['owner-0',{topology:reference}]]);
  for(const c of [ca,cb])scene(c,[g],[s],[transforms[integer(transforms.length)]]);
  // Both contexts must share exactly the same transform for arithmetic comparison.
  cb.pickMeshes.get('owner-0').matrix.copy(ca.pickMeshes.get('owner-0').matrix);cb.pickMeshes.get('owner-0').updateMatrixWorld(true);
  eq(finish(cb.frameNativeEdgeSelectedVertexIdsWork('owner-0',cb.polySelection.items,ready)),ca.polySelectedVertexIds('owner-0'),fx.name);stats.aliasOrders++;
  matrix(finish(cb.frameNativeEdgeSelectionBasisWork('owner-0',cb.pureWorldFrame('owner-0'),cb.polySelection.items,ready)),ca.edgeSelectionBasis('owner-0',ca.pureWorldFrame('owner-0')),fx.name);stats.bases++;
 }
 kept.push({g,t:reference,name:fx.name});
}
// Compare the actual synchronous legacy public UI arithmetic, not only its generator.
for(let run=0;run<220;run++){
 const owners=1+run%3,indices=Array.from({length:owners},()=>integer(kept.length-2)),sources=indices.map(i=>kept[i]),geometries=sources.map(x=>x.g),trans=sources.map((_,i)=>transforms[(run+i)%transforms.length]);
 const selections=sources.map(({g,t},owner)=>{const edges=ca.logicalEdges(g),keys=shuffle(edges.flatMap(e=>e.keys)).slice(0,run%9===0?0:Math.max(1,Math.floor(edges.length*.3)));return item(t.vertexCount&&run%4===0?[t.vertexCount-1,0]:[],keys,t.faceCount&&run%3===0?[t.faceCount-1,0]:[]);});
 const ready=new Map(sources.map((x,i)=>[`owner-${i}`,{topology:x.t}]));
 for(const c of [ca,cb]){scene(c,geometries,selections,trans);c.coordMode=run%2?'world':'object';if(run%3===0)c.polyExactEdgeVertices=new Map(sources.filter(x=>x.t.vertexCount).map((x,i)=>[`owner-${i}`,new Set([x.t.vertexCount-1,0,Math.floor(x.t.vertexCount/2)])]));if(run%4===0)c.polyPivotMatrix=transforms[1].toArray();}
 const m=finish(cb.frameNativeEdgeClickMeasurementsWork(cb.polySelection.items,ready,cb.polyExactEdgeVertices,cb.pickMeshes,cb.polyPivotMatrix)),bounds=ca.polySelectionBounds();assert.equal(!!m,!!bounds,`run ${run}`);if(!m)continue;
 eq(m.bounds.min.toArray(),bounds.min.toArray(),`bounds min ${run}`);eq(m.bounds.max.toArray(),bounds.max.toArray(),`bounds max ${run}`);const frame=ca.polyFrameMatrix(bounds);matrix(m.frame,frame,`frame ${run}`);eq(m.extent.toArray(),ca.polyExtentInFrame(frame).toArray(),`extent ${run}`);stats.measurements++;
 cb.frameRememberNativeEdgeCM({nativeEdgeCM:true,measurements:m});assert(cb.frameCurrentNativeEdgeCM());
 for(const mode of ['object','world']){const actual=cb.readPolyTransform(mode),expected=ca.readPolyTransform(mode);for(const k of ['p','s','e'])eq(actual[k].toArray(),expected[k].toArray(),`cm ${run} ${k}`);stats.cmReads++;}
 for(let i=0;i<owners;i++){eq(cb.polySelectedVertexIds(`owner-${i}`),ca.polySelectedVertexIds(`owner-${i}`),`ids ${run}`);stats.aliasOrders++;}
}
// Capture semantics: topology groups must use decoded attribute values, including
// normalized and interleaved layouts, never underlying packed array slots.
for(const kind of ['interleaved-Float32','interleaved-Float64','normalized-Int16','normalized-Uint16']){
 const g=new THREE.BufferGeometry(),values=[0,0,0,1,0,0,2,0,0,0,0,0,1,0,0,2,0,0];
 if(kind.startsWith('interleaved')){const Ty=kind.endsWith('Float32')?Float32Array:Float64Array,raw=new Ty(6*5);for(let i=0;i<6;i++)raw.set([17,...values.slice(i*3,i*3+3),-9],i*5);g.setAttribute('position',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(raw,5),3,1));}
 else{const Ty=kind.endsWith('Uint16')?Uint16Array:Int16Array;g.setAttribute('position',new THREE.BufferAttribute(Ty.from(values,v=>v*10000),3,true));}
 g.setIndex(new THREE.BufferAttribute(Uint16Array.from([2,1,0,3,4,5]),1));
 const captured=await newTopo.captureTopology(g,{batch:2,yieldTask:()=>Promise.resolve()}),t=finish(newTopo.buildTopologyWork(captured.input,{packedTables:true,batch:3}));assert(captured.stamp.isCurrent());
 const s=item([5],['3:4','1:2'],[1]),ready=new Map([['owner-0',{topology:t}]]);for(const c of [ca,cb]){scene(c,[g],[s],[transforms[1]]);c.coordMode='object';}
 eq(finish(cb.frameNativeEdgeSelectedVertexIdsWork('owner-0',cb.polySelection.items,ready)),ca.polySelectedVertexIds('owner-0'),kind);stats.aliasOrders++;
 const m=finish(cb.frameNativeEdgeClickMeasurementsWork(cb.polySelection.items,ready)),bb=ca.polySelectionBounds(),fr=ca.polyFrameMatrix(bb);eq(m.bounds.min.toArray(),bb.min.toArray(),kind);eq(m.bounds.max.toArray(),bb.max.toArray(),kind);matrix(m.frame,fr,kind);eq(m.extent.toArray(),ca.polyExtentInFrame(fr).toArray(),kind);stats.measurements++;stats.captureLayouts++;
}
// Cross a real structured-clone/transfer boundary from a Node worker using the
// exact extracted candidate factory. This is not browser-worker acceptance.
for(const fx of [fixtures[0],fixtures.at(-1)]){
 const workerSource=`import {parentPort,workerData} from 'node:worker_threads';import * as t from ${JSON.stringify(new URL('./topologyNext.mjs',import.meta.url).href)};let r,w=t.buildTopologyWork(workerData,{packedTables:true,batch:13});do{r=w.next()}while(!r.done);const value=r.value,list=t.topologyTransfer(value);const info={unique:new Set(list).size,total:list.length,contains:list.includes(value.edgeFirstCorners.buffer),cornerBytes:value.edgeFirstCorners.byteLength};parentPort.postMessage({value,info},list);parentPort.postMessage({detached:value.edgeFirstCorners.byteLength===0,allDetached:list.every(b=>b.byteLength===0)});`;
 const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(workerSource)),{workerData:{positions:fx.p,indices:fx.i}});const events=await new Promise((resolve,reject)=>{const events=[];worker.on('message',v=>events.push(v));worker.once('error',reject);worker.once('exit',code=>code?reject(Error(`Worker exit ${code}`)):resolve(events));});
 assert.equal(events.length,2);assert(events[0].info.contains);assert.equal(events[0].info.unique,events[0].info.total);assert(events[1].detached&&events[1].allDetached);assert.deepEqual(events[0].value,finish(newTopo.buildTopologyWork({positions:fx.p,indices:fx.i},{packedTables:true,batch:13})));stats.workerTransfers++;
}
const report={pass:true,bindings,stats,scope:'Independent Node/source controls only. No browser, real model, peak memory, import-readiness or publication acceptance.'};console.log(JSON.stringify(report,null,2));
