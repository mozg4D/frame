import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareResolvedCase,createResolvedBodyPCG} from '../resolved-case.js';
import {solve} from '../../structural-pcg/hex8-reference.js';
import {wrenchInGrid} from '../load-case-reference.js';
const material={young:210e9,poisson:0,yieldStrength:250e6,density:7800};
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t*Math.max(1,Math.abs(b)),`${a} vs ${b}`);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function fixture(n=4){
 const occupancy=Array(n).fill(1),support=Array(n).fill(0),region=Array(n).fill(0);support[0]=1;region[n-1]=1;
 return {owner:{source:'Structural A',uid:'owner'},frame:0,cells:[n,1,1],spacingMetres:[.2/n,.04,.04],bodies:[{source:'part',uid:'material',occupancy,material:{...material}}],fixtures:[{source:'support',uid:'fixture',occupancy:support}],forces:[{source:'load',uid:'force',occupancy:region,wrench:{force:[1000,0,0],torque:[0,0,0],pivot:[.2-.1/n,.02,.02]}}]};
}
function resultant(p,pivot=[0,0,0]){
 const force=[0,0,0],torque=[0,0,0];
 for(let n=0;n<p.grid.nodeCount;n++){const f=Array.from(p.loads.slice(n*3,n*3+3)),r=p.grid.position(n).map((v,k)=>v-pivot[k]),m=cross(r,f);for(let k=0;k<3;k++){force[k]+=f[k];torque[k]+=m[k];}}
 return {force,torque};
}
test('force and pivot moment are conserved across grid resolutions',()=>{
 for(const n of [4,8,16]){
  const input=fixture(n),w=input.forces[0].wrench;w.force=[120,-40,85];w.torque=[1,2,-3];w.pivot=[.13,-.08,.15];
  const p=prepareResolvedCase(input).problems[0],r=resultant(p,w.pivot);
  for(let k=0;k<3;k++){near(r.force[k],w.force[k]);near(r.torque[k],w.torque[k]);}
 }
});
test('mapped volume loads match independent piecewise axial bar displacement and support reaction',()=>{
 for(const n of [4,8]){
  const input=fixture(n),{grid,loads,constraints}=prepareResolvedCase(input).problems[0],result=solve(grid,{loads,constraints,tolerance:1e-10,maxIterations:2000});
  assert.ok(result.converged);const h=.2/n,coefficient=1000/(material.young*.04*.04);
  for(let node=0;node<grid.nodeCount;node++){
   const x=grid.position(node)[0],expected=coefficient*(x<=h?0:x<.2-h/2?x-h:.2-1.5*h);
   assert.ok(Math.abs(result.displacement[3*node]-expected)<coefficient*.2*1e-7);
  }
  near(Array.from(result.reactions).filter((_,i)=>i%3===0).reduce((a,b)=>a+b,0),-1000);
 }
});
test('multiple Force instances add and a parent region remains one total across bodies',()=>{
 const input=fixture(5);input.bodies=[{source:'left',uid:'sharedUID',material:{...material},occupancy:[1,1,0,0,0]},{source:'right',uid:'sharedUID',material:{...material,young:70e9},occupancy:[0,0,0,1,1]}];
 input.fixtures[0].occupancy=[1,0,0,1,0];input.forces[0].occupancy=[1,1,1,1,1];input.forces.push({...input.forces[0],uid:'second',wrench:{force:[0,200,0],torque:[0,0,1],pivot:[0,0,0]}});
 const p=prepareResolvedCase(input);assert.equal(p.problems.length,2);assert.equal(p.forceRecords.length,2);
 const total=[0,0,0];for(const body of p.problems){const r=resultant(body);for(let k=0;k<3;k++)total[k]+=r.force[k];assert.equal(body.grid.materials.length,1);}
 near(total[0],1000);near(total[1],200);near(total[2],0);assert.equal(p.problems[1].material.young,70e9);
 const moment=p.problems.reduce((sum,body)=>sum+resultant(body).torque[2],0);near(moment,1-20);
});
test('prescribed fixture translation is passed to canonical PCG and Float64 equation',()=>{
 const input=fixture();input.forces=[];input.fixtures[0].displacementMetres=[2e-6,-3e-6,1e-6];
 const p=prepareResolvedCase(input).problems[0],r=solve(p.grid,{loads:p.loads,constraints:p.constraints,tolerance:1e-9,maxIterations:3000});assert.ok(r.converged);
 for(let i=0;i<r.displacement.length;i++)assert.ok(Math.abs(r.displacement[i]-input.fixtures[0].displacementMetres[i%3])<1e-12);
});
test('provenance duplicates, unresolved occupancy, overlap and unsupported supports reject',()=>{
 let i=fixture();i.forces.push({...i.forces[0]});assert.throws(()=>prepareResolvedCase(i),/Duplicate provenance/);
 i=fixture();i.bodies[0].occupancy[1]=2;assert.throws(()=>prepareResolvedCase(i),/resolved occupancy/);
 i=fixture();i.bodies.push({...i.bodies[0],source:'second'});assert.throws(()=>prepareResolvedCase(i),/Overlapping/);
 i=fixture();i.fixtures=[];assert.throws(()=>prepareResolvedCase(i),/constraints/i);
 i=fixture();i.fixtures.push({...i.fixtures[0],uid:'other',displacementMetres:[1,0,0]});assert.throws(()=>prepareResolvedCase(i),/Conflicting/);
 i=fixture();i.bodies[0].material.density=0;assert.throws(()=>prepareResolvedCase(i),/density/);
});
test('equal Force UIDs on different sources add; empty intersections apply no load',()=>{
 const input=fixture();input.forces.push({...input.forces[0],source:'second physical source'});
 input.forces.push({...input.forces[0],source:'outside',occupancy:[0,0,0,0]});
 const p=prepareResolvedCase(input);near(resultant(p.problems[0]).force[0],2000);
 assert.equal(p.forceRecords[2].applied,false);assert.equal(p.forceRecords[2].recipients.length,0);
});
test('separate frame/owner preparations keep independent arrays and no caller aliases',()=>{
 const input=fixture(),a=prepareResolvedCase(input);input.frame=1;input.owner.source='Structural B';input.forces[0].wrench.force[0]=2000;input.bodies[0].material.young=70e9;
 const b=prepareResolvedCase(input);near(resultant(a.problems[0]).force[0],1000);near(resultant(b.problems[0]).force[0],2000);assert.notEqual(a.owner,b.owner);assert.notEqual(a.frame,b.frame);assert.equal(a.problems[0].material.young,210e9);
 const point=a.problems[0].grid.position(1);input.spacingMetres[0]=7;input.cells[0]=12;assert.deepEqual(a.problems[0].grid.position(1),point);assert.deepEqual(b.problems[0].grid.position(1),point);
 b.problems[0].constraints[0].value=5;assert.equal(a.problems[0].constraints[0].value,0);assert.equal(a.sceneSolved,false);
});
test('right-handed wrench basis conversion preserves physical pivot and excludes shear/reflection',()=>{
 const domain={basis:[[0,1,0],[-1,0,0],[0,0,1]],originWorldMetres:[1,2,3]},source={force:[100,0,0],torque:[0,0,5],pivotWorldMetres:[1,2.2,3],basisWorld:[[1,0,0],[0,1,0],[0,0,1]]};
 const w=wrenchInGrid(source,domain);near(w.force[0],0);near(w.force[1],-100);near(w.pivot[0],.2);near(w.pivot[1],0);
 const input=fixture();input.forces[0].wrench=w;const actual=resultant(prepareResolvedCase(input).problems[0],w.pivot);for(let k=0;k<3;k++){near(actual.force[k],w.force[k]);near(actual.torque[k],w.torque[k]);}
 assert.throws(()=>wrenchInGrid({...source,basisWorld:[[1,0,0],[1,1,0],[0,0,1]]},domain),/orthonormal/);
 assert.throws(()=>wrenchInGrid({...source,basisWorld:[[1,0,0],[0,-1,0],[0,0,1]]},domain),/Reflected/);
});
test('invalid assembly, body selection, stale ownership and option injection fail before device access',async()=>{
 const device=new Proxy({},{get(){throw Error('DEVICE TOUCHED');}}),options={isCurrent:()=>true},ref={source:'part',uid:'material'};
 const bad=fixture();bad.fixtures=[];await assert.rejects(createResolvedBodyPCG(device,bad,ref,options),/constraints/i);
 await assert.rejects(createResolvedBodyPCG(device,fixture(),{source:'missing',uid:'material'},options),/absent/);
 await assert.rejects(createResolvedBodyPCG(device,fixture(),ref,{...options,loads:[]}),/options/);
 await assert.rejects(createResolvedBodyPCG(device,fixture(),ref,{}),/callback/);
 const d={createComputePipelineAsync(){},limits:{maxBufferSize:1e9,maxStorageBufferBindingSize:1e9,maxComputeWorkgroupsPerDimension:65535}};
 await assert.rejects(createResolvedBodyPCG(d,fixture(),ref,{isCurrent:()=>false}),/Stale/);
});
test('valid resolved body reaches the existing shared-device PCG constructor',async()=>{
 let reached=false;const device={createComputePipelineAsync(){},limits:{maxBufferSize:1e9,maxStorageBufferBindingSize:1e9,maxComputeWorkgroupsPerDimension:65535},lost:new Promise(()=>{}),createShaderModule(){reached=true;throw Error('CONSTRUCTOR REACHED; no GPU');}};
 await assert.rejects(createResolvedBodyPCG(device,fixture(),{source:'part',uid:'material'},{isCurrent:()=>true}),/CONSTRUCTOR REACHED/);assert.ok(reached);
});
test('20 completed 128-cell preparations fit 2 second CPU budget',()=>{
 const input=fixture(128),start=performance.now();for(let i=0;i<20;i++)prepareResolvedCase(input);const ms=performance.now()-start;assert.ok(ms<2000,`${ms} ms`);console.log(JSON.stringify({operation:'20 resolved-cell preparations',cells:128,ms,limitMs:2000,hardwareValidated:false}));
});

test('resolved body constructor uploads the prepared nodal loads/constraints and retires allocations',async()=>{
 const previous=[globalThis.GPUBufferUsage,globalThis.GPUMapMode];
 globalThis.GPUBufferUsage={UNIFORM:1,STORAGE:2,COPY_SRC:4,COPY_DST:8,MAP_READ:16};globalThis.GPUMapMode={READ:1};
 const buffers=[];let solver;
 const device={limits:{maxBufferSize:1e9,maxStorageBufferBindingSize:1e9,maxComputeWorkgroupsPerDimension:65535},lost:new Promise(()=>{}),
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
  pushErrorScope(){},popErrorScope:async()=>null,createBindGroup:()=>({}),
  createBuffer({size,label}){const b={size,label,destroyed:false,destroy(){this.destroyed=true;}};buffers.push(b);return b;},
  queue:{writeBuffer(b,offset,data){b.upload=data instanceof ArrayBuffer?data.slice(0):data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);},onSubmittedWorkDone:async()=>{}}};
 try{
  const input=fixture(),expected=prepareResolvedCase(input).problems[0],job=await createResolvedBodyPCG(device,input,{source:'part',uid:'material'},{isCurrent:()=>true});solver=job.solver;
  assert.equal(job.sceneSolved,false);assert.equal(job.frame,0);assert.equal(job.uid,'material');
  const packed=buffers.find(b=>b.label==='Structural authored RHS/constraints/Jacobi').upload,f=new Float32Array(packed),u=new Uint32Array(packed),fixed=new Map(expected.constraints.map(c=>[c.dof,c.value]));
  for(let i=0;i<expected.grid.dofs;i++){near(f[4*i],expected.loads[i],1e-6);assert.equal(u[4*i+3],fixed.has(i)?1:0);if(fixed.has(i))near(f[4*i+1],fixed.get(i));}
  await solver.dispose();assert.ok(buffers.every(b=>b.destroyed));
 }finally{await solver?.dispose();[globalThis.GPUBufferUsage,globalThis.GPUMapMode]=previous;}
});
