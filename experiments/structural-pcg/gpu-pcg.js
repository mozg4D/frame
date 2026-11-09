import {createGrid} from './hex8-reference.js';
/** GPU-resident, full-integration matrix-free Hex8 PCG research checkpoint.
 * Authored resolved grids only; not scene FEM, contact, or a public Solve.
 * No global K and no CPU iteration vector. Only 48-byte scalar checkpoints.
 */
export function validateProblem(grid, {loads, constraints = [], tolerance = 1e-5, maxIterations = 2000, checkpointEvery = 16} = {}) {
  if (!grid || !Array.isArray(grid.cells) || grid.cells.length !== 3 || grid.cells.some(n => !Number.isSafeInteger(n) || n < 1) || grid.count !== grid.cells.reduce((a,b) => a*b,1) || grid.count > 32768) throw Error('Invalid bounded Hex8 grid');
  if (grid.dofs !== 3*(grid.cells[0]+1)*(grid.cells[1]+1)*(grid.cells[2]+1) || grid.diagonal?.length !== grid.dofs || grid.active?.length !== grid.dofs/3 || grid.elementNodes?.length !== grid.count*8 || grid.materialIds?.length !== grid.count || !Array.isArray(grid.matrices) || !grid.matrices.length) throw Error('Invalid Hex8 metadata');
  if (!grid.spacing || grid.spacing.length !== 3 || Array.from(grid.spacing).some(v => !Number.isFinite(v) || v <= 0)) throw Error('Invalid SI spacing');
  if (!loads || loads.length !== grid.dofs || Array.from(loads).some(v => !Number.isFinite(v))) throw Error('Invalid loads');
  if (!Array.isArray(constraints) || !constraints.length || constraints.length > grid.dofs*2) throw Error('Explicit constraints required');
  if (!Number.isFinite(tolerance) || tolerance < 1e-7 || tolerance > .01 || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10000 || !Number.isInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > 64) throw Error('Invalid PCG options');
  if(!Array.isArray(grid.materials))throw Error('Canonical Hex8 materials required');
  if(Array.from(grid.materialIds).some(v=>!Number.isInteger(v)||v < -1||v>=grid.materials.length))throw Error('Invalid material IDs');
  const canonical=createGrid({cells:[...grid.cells],spacing:[...grid.spacing],materials:grid.materials.map(({young,poisson,yieldStrength})=>({young,poisson,yieldStrength})),materialIds:Int32Array.from(grid.materialIds)});
  const equal=(a,b)=>a.length===b.length&&Array.from(a).every((v,i)=>v===b[i]);
  const close=(a,b)=>a.length===b.length&&Array.from(a).every((v,i)=>Number.isFinite(v)&&Math.abs(v-b[i])<=1e-12*Math.max(Math.abs(b[i]),1e-300));
  if(!equal(grid.active,canonical.active)||!equal(grid.elementNodes,canonical.elementNodes)||!close(grid.diagonal,canonical.diagonal)||grid.matrices.length!==canonical.matrices.length||grid.matrices.some((m,i)=>!close(m,canonical.matrices[i])))throw Error('Inconsistent canonical Hex8 metadata or local stiffness');
  grid=canonical;
  const fixed = new Uint8Array(grid.dofs), prescribed = new Float64Array(grid.dofs);
  for (let n=0;n<grid.active.length;n++) if (!grid.active[n]) fixed.fill(1,3*n,3*n+3);
  for (const c of constraints) {
    if (!c || !Number.isInteger(c.dof) || c.dof < 0 || c.dof >= grid.dofs || !Number.isFinite(c.value ?? 0)) throw Error('Invalid constraint');
    const value=c.value??0;
    if (!grid.active[Math.floor(c.dof/3)] && value !== 0) throw Error('Inactive prescribed motion');
    if (fixed[c.dof] && prescribed[c.dof] !== value) throw Error('Conflicting constraints');
    fixed[c.dof]=1; prescribed[c.dof]=value;
  }
  // A relative residual cannot certify removal of rigid modes. Prove rank six
  // for every face-connected component, and reject edge/point-only joins.
  const component=new Int32Array(grid.count).fill(-1), nodeOwner=new Int32Array(grid.active.length).fill(-1);
  let componentCount=0;
  for(let seed=0;seed<grid.count;seed++) if(grid.materialIds[seed]>=0 && component[seed]<0) {
    const stack=[seed], nodes=new Set(); component[seed]=componentCount;
    while(stack.length) {
      const e=stack.pop(), p=[e%grid.cells[0],Math.floor(e/grid.cells[0])%grid.cells[1],Math.floor(e/(grid.cells[0]*grid.cells[1]))];
      for(const n of grid.elementNodes.subarray(8*e,8*e+8)) {if(nodeOwner[n]>=0 && nodeOwner[n]!==componentCount) throw Error('Unresolved edge/point-only material connection');nodeOwner[n]=componentCount;nodes.add(n);}
      for(let k=0;k<3;k++)for(const s of [-1,1]){const q=[...p];q[k]+=s;if(q[k]<0||q[k]>=grid.cells[k])continue;const next=q[0]+grid.cells[0]*(q[1]+grid.cells[1]*q[2]);if(grid.materialIds[next]>=0&&component[next]<0){component[next]=componentCount;stack.push(next);}}
    }
    const origin=grid.position(nodes.values().next().value), length=Math.max(...grid.cells.map((n,k)=>n*grid.spacing[k])), basis=[];
    for(const n of nodes) {
      const [x,y,z]=grid.position(n).map((v,k)=>(v-origin[k])/length);
      const rows=[[1,0,0,0,z,-y],[0,1,0,-z,0,x],[0,0,1,y,-x,0]];
      for(let k=0;k<3;k++)if(fixed[3*n+k]) {let row=rows[k].slice();for(let pass=0;pass<2;pass++)for(const b of basis){const d=row.reduce((s,v,j)=>s+v*b[j],0);row=row.map((v,j)=>v-d*b[j]);}const norm=Math.hypot(...row);if(norm>1e-10){basis.push(row.map(v=>v/norm));if(basis.length===6)break;}}
      if(basis.length===6)break;
    }
    if(basis.length!==6)throw Error('Unconstrained rigid modes in material component');componentCount++;
  }
  if(!componentCount)throw Error('No resolved material');
  const inputs=new ArrayBuffer(grid.dofs*16), floats=new Float32Array(inputs), uints=new Uint32Array(inputs);
  for(let i=0;i<grid.dofs;i++) {
    if(!grid.active[Math.floor(i/3)] && loads[i]!==0)throw Error('Load on inactive node');
    if(grid.active[Math.floor(i/3)] && !(grid.diagonal[i]>0))throw Error('Invalid Jacobi diagonal');
    floats[4*i]=loads[i];floats[4*i+1]=prescribed[i];floats[4*i+2]=grid.active[Math.floor(i/3)]?grid.diagonal[i]:1;uints[4*i+3]=fixed[i];
    if(![floats[4*i],floats[4*i+1],floats[4*i+2]].every(Number.isFinite)||floats[4*i+2]<=0||(loads[i]!==0&&floats[4*i]===0)||(prescribed[i]!==0&&floats[4*i+1]===0))throw Error('Unrepresentable Float32 input');
  }
  const matrices=Float32Array.from(grid.matrices.flatMap(k=>{if(k.length!==576)throw Error('Invalid local stiffness');return Array.from(k);}));
  if(!matrices.every(Number.isFinite) || Array.from(grid.materialIds).some(v=>!Number.isInteger(v)||v < -1||v>=grid.matrices.length))throw Error('Invalid Float32 local stiffness');
  return {inputs,matrices,materialIds:Int32Array.from(grid.materialIds),fixed,prescribed,tolerance,maxIterations,checkpointEvery,componentCount,cells:[...grid.cells],dofs:grid.dofs};
}

export const PCG_WGSL=`
struct Params { cells:vec4u, options:vec4u, tolerances:vec4f };
struct Dof { load:f32, prescribed:f32, diagonal:f32, fixed:u32 };
struct Vector { u:f32, r:f32, p:f32, ap:f32 };
struct State { rho:f32, curvature:f32, initial2:f32, residual2:f32, alpha:f32, beta:f32, spare0:f32, spare1:f32, status:u32, iteration:u32, spare2:u32, spare3:u32 };
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> inputs:array<Dof>;
@group(0) @binding(2) var<storage,read> matrices:array<f32>;
@group(0) @binding(3) var<storage,read> materials:array<i32>;
@group(0) @binding(4) var<storage,read_write> vectors:array<Vector>;
@group(0) @binding(5) var<storage,read_write> state:State;
const corner=array<vec3u,8>(vec3u(0,0,0),vec3u(1,0,0),vec3u(1,1,0),vec3u(0,1,0),vec3u(0,0,1),vec3u(1,0,1),vec3u(1,1,1),vec3u(0,1,1));
fn finite(x:f32)->bool { return x==x && abs(x)<3e38; }
fn action(dof:u32,useP:bool)->f32 {
 let dims=params.cells.xyz;let nd=dims+vec3u(1);let node=dof/3u;let p=vec3u(node%nd.x,(node/nd.x)%nd.y,node/(nd.x*nd.y));var sum=0.0;
 for(var a=0u;a<8u;a++){if(any(p<corner[a])){continue;}let e=p-corner[a];if(any(e>=dims)){continue;}let id=materials[e.x+dims.x*(e.y+dims.y*e.z)];if(id<0){continue;}let row=u32(id)*576u+(a*3u+dof%3u)*24u;
  for(var b=0u;b<8u;b++){let q=e+corner[b];let n=3u*(q.x+nd.x*(q.y+nd.y*q.z));for(var k=0u;k<3u;k++){sum+=matrices[row+3u*b+k]*select(vectors[n+k].u,vectors[n+k].p,useP);}}}return sum;
}
@compute @workgroup_size(64) fn initialize(@builtin(global_invocation_id) tid:vec3u){let i=tid.x;if(i>=params.cells.w){return;}vectors[i]=Vector(select(0.0,inputs[i].prescribed,inputs[i].fixed!=0u),0.0,0.0,0.0);}
@compute @workgroup_size(64) fn applyU(@builtin(global_invocation_id) tid:vec3u){let i=tid.x;if(i>=params.cells.w){return;}vectors[i].ap=action(i,false);}
@compute @workgroup_size(64) fn applyP(@builtin(global_invocation_id) tid:vec3u){let i=tid.x;if(i>=params.cells.w||state.status!=0u){return;}vectors[i].ap=select(action(i,true),0.0,inputs[i].fixed!=0u);}
@compute @workgroup_size(64) fn residual(@builtin(global_invocation_id) tid:vec3u){let i=tid.x;if(i>=params.cells.w){return;}let r=select(inputs[i].load-vectors[i].ap,0.0,inputs[i].fixed!=0u);vectors[i].r=r;vectors[i].p=r/inputs[i].diagonal;}
var<workgroup> sums:array<vec2f,64>;
fn total(lane:u32,value:vec2f)->vec2f{sums[lane]=value;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sums[lane]+=sums[lane+stride];}workgroupBarrier();}return sums[0];}
@compute @workgroup_size(64) fn initialReduce(@builtin(local_invocation_index) lane:u32){var s=vec2f(0);for(var i=lane;i<params.cells.w;i+=64u){let r=vectors[i].r;s+=vec2f(r*r,r*r/inputs[i].diagonal);if(r!=0.0 && r*r==0.0){s.x=3.1e38;}}let t=total(lane,s);if(lane==0u){state.initial2=t.x;state.residual2=t.x;state.rho=t.y;state.iteration=0u;state.status=select(0u,2u,t.x==0.0);if(!finite(t.x)||!finite(t.y)||(t.x>0.0 && params.tolerances.x*t.x==0.0)){state.status=5u;}}}
@compute @workgroup_size(64) fn directionReduce(@builtin(local_invocation_index) lane:u32){var s=0.0;for(var i=lane;i<params.cells.w;i+=64u){s+=vectors[i].p*vectors[i].ap;}let t=total(lane,vec2f(s,0));if(lane==0u && state.status==0u){state.curvature=t.x;if(!finite(t.x)||!finite(state.rho)){state.status=5u;}else if(t.x<=0.0||state.rho<=0.0){state.status=3u;}else{state.alpha=state.rho/t.x;if(!finite(state.alpha)){state.status=5u;}}}}
@compute @workgroup_size(64) fn updateUR(@builtin(global_invocation_id) tid:vec3u){let i=tid.x;if(i>=params.cells.w||state.status!=0u||inputs[i].fixed!=0u){return;}vectors[i].u+=state.alpha*vectors[i].p;vectors[i].r-=state.alpha*vectors[i].ap;}
@compute @workgroup_size(64) fn nextReduce(@builtin(local_invocation_index) lane:u32){var s=vec2f(0);for(var i=lane;i<params.cells.w;i+=64u){let r=vectors[i].r;s+=vec2f(r*r,r*r/inputs[i].diagonal);if(r!=0.0 && r*r==0.0){s.x=3.1e38;}}let t=total(lane,s);if(lane==0u && state.status==0u){state.iteration++;state.residual2=t.x;state.beta=t.y/state.rho;state.rho=t.y;if(!finite(t.x)||!finite(t.y)||!finite(state.beta)){state.status=5u;}else if(t.x<=params.tolerances.x*state.initial2){state.status=2u;}else if(state.iteration>=params.options.x){state.status=4u;}}}
@compute @workgroup_size(64) fn updateP(@builtin(global_invocation_id) tid:vec3u){let i=tid.x;if(i>=params.cells.w||state.status!=0u){return;}vectors[i].p=vectors[i].r/inputs[i].diagonal+state.beta*vectors[i].p;}
@compute @workgroup_size(64) fn exactReduce(@builtin(local_invocation_index) lane:u32){var s=vec2f(0);for(var i=lane;i<params.cells.w;i+=64u){let r=vectors[i].r;s+=vec2f(r*r,r*r/inputs[i].diagonal);if(r!=0.0 && r*r==0.0){s.x=3.1e38;}}let t=total(lane,s);if(lane==0u){state.residual2=t.x;state.rho=t.y;if(!finite(t.x)||!finite(t.y)||(t.x>0.0 && params.tolerances.x*t.x==0.0)){state.status=5u;}else if(t.x<=params.tolerances.x*state.initial2){state.status=1u;}else if(state.iteration>=params.options.x){state.status=4u;}else{state.status=0u;}}}
`;

const ENTRY=['initialize','applyU','applyP','residual','initialReduce','directionReduce','updateUR','nextReduce','updateP','exactReduce'];
const REASONS=['active','converged','recursive-candidate','non-positive-curvature','iteration-limit','non-finite'];
export async function createGPUPCG(device,grid,options={}) {
  // Validate even malformed or unsupported input before device/allocator access.
  const problem=validateProblem(grid,options),{inputs,matrices,materialIds}=problem; grid={cells:[...problem.cells],dofs:problem.dofs};
  if(!device?.createComputePipelineAsync)throw Error('Shared Frame WebGPU device required');
  const vectorBytes=grid.dofs*16,workgroups=Math.ceil(grid.dofs/64),limits=device.limits;
  if([vectorBytes,inputs.byteLength,matrices.byteLength,materialIds.byteLength].some(n=>n>limits.maxStorageBufferBindingSize||n>limits.maxBufferSize)||workgroups>limits.maxComputeWorkgroupsPerDimension)throw Error('Structural GPU capacity exceeded');
  const signal=options.signal,isCurrent=options.isCurrent??(()=>true);if(typeof isCurrent!=='function'||!isCurrent()||signal?.aborted)throw Error('Stale or cancelled Structural problem');
  let lost=false,disposed=false,busy=null,disposal=null,runStarted=false;device.lost.then(()=>{lost=true;});
  const current=()=>{if(disposed||lost||signal?.aborted||!isCurrent())throw Error('Stale, cancelled, lost or disposed Structural problem');};
  const module=device.createShaderModule({label:'Structural PCG research',code:PCG_WGSL}),info=await module.getCompilationInfo();current();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
  const pipelines={};for(const entryPoint of ENTRY){pipelines[entryPoint]=await device.createComputePipelineAsync({label:'Structural PCG '+entryPoint,layout:'auto',compute:{module,entryPoint}});current();}
  let openScopes=0;
  function openScope(){device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');openScopes+=2;}
  async function closeScopes(){const pending=[];while(openScopes>0){openScopes--;pending.push(device.popErrorScope());}const failures=(await Promise.all(pending)).filter(Boolean);if(failures.length)throw Error('Structural WebGPU: '+failures.map(e=>e.message).join('; '));}
  const encoder=()=>{openScope();return device.createCommandEncoder();};
  const owned=[];const make=(size,usage,label,data)=>{const b=device.createBuffer({size:Math.max(4,size),usage,label});owned.push(b);if(data)device.queue.writeBuffer(b,0,data);return b;};
  try{
    openScope();
    const parameters=new ArrayBuffer(48),pu=new Uint32Array(parameters),pf=new Float32Array(parameters);pu.set([...grid.cells,grid.dofs,problem.maxIterations]);pf[8]=problem.tolerance**2;
    const buffers=[make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'Structural PCG parameters',parameters),make(inputs.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Structural authored RHS/constraints/Jacobi',inputs),make(matrices.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Structural local Hex8 stiffness',matrices),make(materialIds.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,'Structural resolved material IDs',materialIds),make(vectorBytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC,'Structural GPU PCG vectors'),make(48,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,'Structural scalar state',new Uint32Array(12))];
    const read=make(48,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST,'Structural scalar checkpoint');
    // Auto layouts omit bindings unused by each entry point.
    const bindingSets={initialize:[0,1,4],applyU:[0,2,3,4],applyP:[0,1,2,3,4,5],residual:[0,1,4],initialReduce:[0,1,4,5],directionReduce:[0,4,5],updateUR:[0,1,4,5],nextReduce:[0,1,4,5],updateP:[0,1,4,5],exactReduce:[0,1,4,5]};
    const bindings=Object.fromEntries(ENTRY.map(e=>[e,device.createBindGroup({layout:pipelines[e].getBindGroupLayout(0),entries:bindingSets[e].map(binding=>({binding,resource:{buffer:buffers[binding]}}))})]));
    await closeScopes();current();
    function dispatch(encoder,entry){const pass=encoder.beginComputePass({label:'Structural '+entry});pass.setPipeline(pipelines[entry]);pass.setBindGroup(0,bindings[entry]);pass.dispatchWorkgroups(entry.endsWith('Reduce')?1:workgroups);pass.end();}
    let scalarReadbackBytes=0,checkpoints=0,exactChecks=0,final=null;
    async function checkpoint(encoder){encoder.copyBufferToBuffer(buffers[5],0,read,0,48);device.queue.submit([encoder.finish()]);await closeScopes();current();await read.mapAsync(GPUMapMode.READ);const raw=read.getMappedRange().slice(0);read.unmap();scalarReadbackBytes+=48;checkpoints++;current();const f=new Float32Array(raw),u=new Uint32Array(raw);return {status:u[8],iteration:u[9],initialNorm:Math.sqrt(f[2]),residualNorm:Math.sqrt(f[3]),relativeResidual:f[2]>0?Math.sqrt(f[3]/f[2]):Math.sqrt(f[3]),rho:f[0],curvature:f[1]};}
    async function run(){current();if(runStarted)throw Error('PCG checkpoint is single-use');runStarted=true;const started=performance.now();
      const execute=async()=>{let command=encoder();for(const e of ['initialize','applyU','residual','initialReduce'])dispatch(command,e);let state=await checkpoint(command);let guard=0;
        while(true){current();if(++guard>2*problem.maxIterations+8)throw Error('PCG host progress bound exceeded');if(!Number.isInteger(state.status)||state.status<0||state.status>5||state.iteration>problem.maxIterations||(state.status<5&&(!Number.isFinite(state.initialNorm)||!Number.isFinite(state.relativeResidual)))||(state.status===0&&!(state.initialNorm>0)))throw Error('Invalid or nonadvancing GPU checkpoint');if(state.status===2||state.status===4){command=encoder();for(const e of ['applyU','residual','exactReduce'])dispatch(command,e);exactChecks++;state=await checkpoint(command);if(![0,1,4,5].includes(state.status))throw Error('Exact residual command did not advance');}
          if(state.status!==0)break;
          const before=state.iteration;command=encoder();for(let step=0;step<problem.checkpointEvery;step++)for(const e of ['applyP','directionReduce','updateUR','nextReduce','updateP'])dispatch(command,e);state=await checkpoint(command);if(state.iteration<=before && ![3,5].includes(state.status))throw Error('PCG command failed to advance iteration');
        }
        if(state.status===1&&(!exactChecks||state.relativeResidual>problem.tolerance))throw Error('Unverified GPU convergence');
        final={...state,converged:state.status===1,reason:REASONS[state.status]??'invalid-state',iterations:state.iteration,completedMs:performance.now()-started,scalarReadbackBytes,checkpoints,exactChecks,backend:'webgpu-matrix-free-pcg-research',sceneSolved:false,analysisReady:false,vectorReadbackBytes:0,ownedBytes:owned.reduce((s,b)=>s+b.size,0)};return {...final};};
      const pending=Promise.resolve().then(async()=>{
        current();
        try{return await execute();}
        finally{await closeScopes();}
      });
      busy=pending;
      try{return await pending;}catch(error){final=null;throw error;}finally{busy=null;}
    }
    async function inspectDisplacement({offset=0,count=256}={}){
      current();if(busy||!final?.converged)throw Error('Converged current idle PCG result required');
      if(!Number.isInteger(offset)||offset<0||offset>=grid.dofs||!Number.isInteger(count)||count<1||count>256)throw Error('Bounded displacement inspection required');
      count=Math.min(count,grid.dofs-offset);
      const pending=Promise.resolve().then(async()=>{
        current();let temp;
        try{
          openScope();
          temp=device.createBuffer({label:'Structural bounded displacement inspection',size:count*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
          const command=device.createCommandEncoder();command.copyBufferToBuffer(buffers[4],offset*16,temp,0,count*16);
          device.queue.submit([command.finish()]);await closeScopes();current();
          await temp.mapAsync(GPUMapMode.READ);current();
          const data=new Float32Array(temp.getMappedRange()),u=Float32Array.from({length:count},(_,i)=>data[4*i]);
          temp.unmap();current();final.vectorReadbackBytes+=count*16;return u;
        }finally{
          try{await closeScopes();}finally{if(temp?.mapState==='mapped')temp.unmap();temp?.destroy();}
        }
      });
      busy=pending;
      try{return await pending;}finally{busy=null;}
    }
    function dispose(){
      if(disposal)return disposal;
      disposed=true;
      disposal=(async()=>{
        try{await busy?.catch(()=>{});await device.queue.onSubmittedWorkDone();}
        finally{if(read.mapState==='mapped')read.unmap();owned.forEach(b=>b.destroy());}
      })();
      return disposal;
    }
    return {run,inspectDisplacement,summary:()=>{try{current();return final?{...final}:null;}catch{return null;}},dispose};
  }catch(error){await closeScopes().catch(()=>{});await device.queue.onSubmittedWorkDone().catch(()=>{});owned.forEach(b=>b.destroy());throw error;}
}
