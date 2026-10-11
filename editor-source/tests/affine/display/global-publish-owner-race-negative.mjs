import {reviewURL} from '../source-paths.mjs';
import {verifyCandidate} from './verify-candidate.mjs';verifyCandidate();
import * as THREE from '../fixtures/three-core.mjs';
const {captureDisplayObject,registerAffineDisplayOverride}=await import(reviewURL('../candidate/native-source/display-packets.mjs',import.meta.url));
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url),'utf8');
function extract(name){let at=source.indexOf('function '+name+'(');assert(at>=0,name);if(source.slice(at-6,at)==='async ')at-=6;const lines=source.slice(at).split('\n');for(let i=1;i<1000;i++){const f=lines.slice(0,i).join('\n');try{new vm.Script('('+f+')');return f;}catch{}}throw Error(name);}
const rows=[];
for(const mode of ['new-active-gesture','discarded','source-version','cancel']){
 const before=Float32Array.of(0,0,0,1,0,0,0,1,0),normal=Float32Array.of(0,0,1,0,0,1,0,0,1),index=Uint32Array.of(0,1,2),writes=[];
 let current=true,resolveYield,yields=0;
 const r={live:true,revision:1,numeric:{source:{},positions:before.slice(),extras:new Float32Array(27),vertexCount:3,indices:null,lineIndices:new Map(),hasNormals:true},gpu:{position:{},normal:{}}},t={numeric:{positions:before.slice()},ids:Uint32Array.of(0,1,2),adapter:{revision:1},gpu:{position:{}},device:{queue:{writeBuffer(...a){writes.push(a);}}}};
 const s={t,r,affineRevision:1,faceIDs:Uint32Array.of(0),beforeRaw:{index},cancel:false,discarded:false};r.active=s;
 const q={revision:1,timings:{}},snapshot={attrs:{position:{array:Float32Array.of(10,0,0,11,0,0,10,1,0)},normal:{array:normal}},index};
 const c=vm.createContext({frameRigidSource:()=>current,frameAffineYield(){yields++;return yields===1?new Promise(resolve=>resolveYield=resolve):Promise.resolve();},frameAffineNotes:{exactPoses:0,phases:[]},scheduleRender(){}});
 for(const n of ['frameAffineGlobalPublish','frameAffinePosePublish'])vm.runInContext(extract(n),c);
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(before.slice(),3)).setAttribute('normal',new THREE.BufferAttribute(normal.slice(),3)).setIndex(new THREE.BufferAttribute(index,1)),mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial());mesh.updateMatrixWorld(true);
 const display=registerAffineDisplayOverride(mesh,{faceSlots:Int32Array.of(1),fullGeometry:()=>r.fullNumeric,selectedGeometry:()=>{const revision=r.revision;return{...r.numeric,isCurrent:()=>r.live&&r.revision===revision&&current};},isCurrent:()=>r.live&&current});
 const pending=c.frameAffineGlobalPublish(s,q,snapshot);assert.equal(yields,1);
 const replacement={t,r,affineRevision:1};const baseline=mode==='new-active-gesture'?null:{source:{newGesture:true},positions:Float32Array.of(100,0,0,101,0,0,100,1,0),extras:new Float32Array(27),indices:index,vertexCount:3,hasNormals:true,lineIndices:new Map(),isCurrent:()=>true};r.fullNumeric=baseline;
 if(mode==='new-active-gesture')r.active=replacement;
 if(mode==='discarded')s.discarded=true;
 if(mode==='source-version')current=false;
 if(mode==='cancel')s.cancel=true;
 resolveYield();const result=await pending;
 assert.equal(result,false);assert.equal(writes.length,0);
 const corrupted=false;
 assert.equal(r.fullNumeric!==baseline,corrupted);if(corrupted){assert.equal(r.fullNumeric.source,snapshot);assert.equal(r.fullNumeric.isCurrent(),true);assert.deepEqual(Array.from(r.fullNumeric.positions),Array.from(snapshot.attrs.position.array));}
 const shown=captureDisplayObject(mesh);if(corrupted){assert(shown.isCurrent());assert.equal(shown.packets[0].geometry.positions,snapshot.attrs.position.array);}display.dispose();
 rows.push({mode,staleRealDisplayPacketCurrent:corrupted?shown.packets[0].geometry.positions===snapshot.attrs.position.array:false,oldPoseReportedPublished:result,gpuWrites:writes.length,newDisplayBaselineOverwritten:r.fullNumeric!==baseline,staleSnapshotMarkedCurrent:corrupted?r.fullNumeric.isCurrent():false});
}
console.log(JSON.stringify({reproduced:true,scope:'Exact GlobalPublish/PosePublish functions, deterministic first cooperative-yield interruption, real Three/display packets, mocked queue; zero means defect reproduced, not acceptance',rows},null,2));
