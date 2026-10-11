import {reviewURL} from '../source-paths.mjs';
import './independent-source-pins.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {T,makeHarness,baseline,native} from './connected-support-blob.mjs';
const drain=w=>{let step;do{step=w.next();}while(!step.done);return step.value;};
const base=baseline({positions:Float32Array.from([0,0,0,1,0,0,0,1,0,10,0,0,11,0,0,10,1,0]),indices:Uint32Array.from([0,1,2,3,4,5])});
const editor=fs.readFileSync(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url),'utf8'),start=editor.indexOf('function frameRigidBasic(){'),end=editor.indexOf('function frameRigidSource(',start);assert(start>=0&&end>start);
const rows=[];
for(const Ctor of [Uint32Array,Uint16Array]){
 const input={...base,indices:Ctor.from(base.indices)},g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(input.positions,3));g.setAttribute('normal',new T.BufferAttribute(input.normals,3));g.setIndex(new T.BufferAttribute(input.indices,1));
 const mesh=new T.Mesh(g),entry={faces:new Set([0]),vertices:new Set(),edges:new Set()},c=vm.createContext({Float32Array,Uint16Array,Uint32Array,polyFocusActive:()=>true,polyElementMode:'face',polySelection:{items:new Map([['h',entry]])},vertexTools:{soft:{active:false}},uvEdit:false,editPivot:false,frameChannels:new Set(),vpState:{renderer:{nativeEngine:{}}},pickMeshes:new Map([['h',mesh]]),OBJ:new Map([['h',{}]]),frameMorphTag:()=>false});vm.runInContext(editor.slice(start,end),c);const admitted=vm.runInContext('!!frameRigidBasic()',c);assert.equal(admitted,true);
 const topology=drain(native.buildTopologyWork(input)),gate=drain(native.rigidIslandEligibilityWork(topology,input.indices,entry.faces));assert.equal(gate.eligible,true);
 const t={p:g.attributes.position,pa:input.positions,ia:input.indices,ids:gate.ids,faceIDs:Uint32Array.of(0),slot:Int32Array.from([1,2,3,0,0,0])};c.t=t;const aliasStart=editor.indexOf('function* frameRigidBuildAliasGuard(t){'),aliasEnd=editor.indexOf('function frameRigidNativeWorkerClosureComplete(){}',aliasStart);vm.runInContext(editor.slice(aliasStart,aliasEnd),c);const guardBuilt=drain(vm.runInContext('frameRigidBuildAliasGuard(t)',c)),aliasSafe=vm.runInContext('frameRigidAliasSafe(t)',c);assert.equal(guardBuilt,true);assert.equal(aliasSafe,true);const registered=native.registerRigidGpuGeometry(g,{positions:input.positions.slice(),extras:new Float32Array(input.positions.length*3),vertexCount:input.positions.length/3});assert(registered.live);native.unregisterRigidGpuGeometry(g,registered);
 const h=makeHarness(input);try{const error=await h.s.workerReady.then(()=>null,e=>String(e));rows.push({indexType:Ctor.name,actualFrameRigidBasicAdmits:admitted,topologyEligibilityAdmits:gate.eligible,aliasGuardBuilt:guardBuilt,aliasSafe,rigidGPURegistrationAdmits:true,actualBlobCanonicalPrepareReady:error===null,error});assert.equal(error,null);}finally{h.close();}
}
console.log(JSON.stringify({reproduced:true,scope:'Actual production basic/topology/alias eligibility and GPU registration; actual helper CreateWorker/Pipe to generated Blob Worker; hardware GPU preparation not exercised',rows},null,2));
