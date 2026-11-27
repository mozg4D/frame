import {gpuScope,median} from './gpu.mjs';
import {gpuBlocks} from '../../plugin.js';
import {schurGeometry,schurSystem,schurPreconditioner} from './schur.mjs';

async function vectorOps(gpu,count) {
  const groups=Math.ceil(count/128),vector=name=>gpu.buffer(name,count*4);
  const scalar=gpu.buffer('CFD Krylov coefficient',4,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const reduction=gpu.buffer('CFD dot partials',groups*4), staging=gpu.staging('CFD scalar readback',groups*4);
  const source='@group(0) @binding(0) var<storage,read> x:array<f32>;';
  const dest='@group(0) @binding(1) var<storage,read_write> y:array<f32>;';
  const main=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u) {let i=id.x;if(i<${count}u){${body}}}`;
  const coeff='@group(0) @binding(2) var<uniform> alpha:f32;';
  const add=await gpu.kernel('CFD Krylov axpy',source+dest+coeff+main('y[i]+=alpha*x[i];'));
  const scaled=await gpu.kernel('CFD Krylov scaled copy',source+dest+coeff+main('y[i]=alpha*x[i];'));
  const reduce=await gpu.kernel('CFD Krylov dot',source+`
    @group(0) @binding(1) var<storage,read> y:array<f32>;
    @group(0) @binding(2) var<storage,read_write> result:array<f32>;
    var<workgroup> part:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
      var v=0.;if(id.x<${count}u){v=x[id.x]*y[id.x];}part[lane]=v;
      for(var offset=64u;offset>0u;offset/=2u){workgroupBarrier();if(lane<offset){part[lane]+=part[lane+offset];}}
      if(lane==0u){result[group.x]=part[0];}}`);
  function combine(pipeline, dst, src, alpha){
    gpu.device.queue.writeBuffer(scalar,0,new Float32Array([alpha]));
    gpu.run(pipeline,[src,dst,scalar],[groups]);
  }
  async function dot(a,b){
    gpu.run(reduce,[a,b,reduction],[groups]);
    return (await gpu.read(reduction,staging,groups)).reduce((v,p)=>v+p,0);
  }
  return {vector,dot,norm:async a=>Math.sqrt(await dot(a,a)),
    scaled:(out,src,a)=>combine(scaled,out,src,a),axpy:(out,src,a)=>combine(add,out,src,a),
    zero(out){const e=gpu.device.createCommandEncoder();e.clearBuffer(out);gpu.device.queue.submit([e.finish()]);}};
}

// All backends reconstruct and certify the solution of this connected volume
// operator, including fluxes across adjacent regular blocks.
async function pressureProblem(gpu,dims){
  const count=dims.reduce((a,b)=>a*b,1),ops=await vectorOps(gpu,count);
  const exact=new Float32Array(count);
  for(let i=0;i<count;i++){
    const x=(i%dims[0]+1)/(dims[0]+1),y=(Math.floor(i/dims[0])%dims[1]+1)/(dims[1]+1),z=(Math.floor(i/(dims[0]*dims[1]))+1)/(dims[2]+1);
    exact[i]=Math.sin(3*Math.PI*x)*Math.sin(2*Math.PI*y)*Math.sin(Math.PI*z)+.17*Math.sin(7*Math.PI*x)*Math.sin(4*Math.PI*z)*Math.sin(Math.PI*y);
  }
  const stencil=await gpu.kernel('CFD conservative volume stencil',`
    @group(0) @binding(0) var<storage,read> x:array<f32>;
    @group(0) @binding(1) var<storage,read_write> y:array<f32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&y)){return;}
      let X=${dims[0]}u;let Y=${dims[1]}u;let S=X*Y;
      let a=i%X;let b=(i/X)%Y;let c=i/S;var sum=6.*x[i];
      if(a>0u){sum-=x[i-1u];}if(a+1u<X){sum-=x[i+1u];}
      if(b>0u){sum-=x[i-X];}if(b+1u<Y){sum-=x[i+X];}
      if(c>0u){sum-=x[i-S];}if(c+1u<${dims[2]}u){sum-=x[i+S];}y[i]=sum;}`);
  const apply=(a,b)=>gpu.run(stencil,[a,b],[Math.ceil(count/128)]);
  const solution=gpu.buffer('CFD manufactured pressure',exact),rhs=ops.vector('CFD manufactured right hand side'),check=ops.vector('CFD reconstructed volume error');
  apply(solution,rhs);const rhsNorm=await ops.norm(rhs),solutionNorm=await ops.norm(solution);
  function residual(x,out){apply(x,check);ops.scaled(out,rhs,1);ops.axpy(out,check,-1);}
  return {...ops,rhs,apply,residual,rhsNorm,initialNorm:rhsNorm,async verify(x){
    apply(x,check);ops.axpy(check,rhs,-1);const relativeResidual=await ops.norm(check)/rhsNorm;
    ops.scaled(check,x,1);ops.axpy(check,solution,-1);
    return {relativeResidual,relativeError:await ops.norm(check)/solutionNorm};
  }};
}

// Right-preconditioned restarted flexible GMRES. Only scalar products leave the GPU.
// The stopping test always recomputes b-Ax using the original FP32 operator.
async function krylovSolver(p) {
  const restart=10, maxIterations=100, tolerance=2e-5;
  const x=p.vector('CFD pressure iterate'), r=p.vector('CFD true residual'), w=p.vector('CFD Arnoldi work');
  const v=Array.from({length:restart+1},()=>p.vector('CFD Arnoldi basis'));
  const z=Array.from({length:restart},()=>p.vector('CFD preconditioned basis'));
  // Leave room for the rounding of the eliminated interiors on reconstruction.
  const bNorm=p.rhsNorm,stop=tolerance*bNorm*(p.trueResidual ? 0.4 : 1);
  return async backend=>{
    const start=performance.now();
    p.prepare?.();
    p.zero(x);
    p.scaled(r,p.rhs,1);
    let beta=p.initialNorm, iterations=0;
    while(beta>stop && iterations<maxIterations){
      p.scaled(v[0],r,1/beta);
      const h=Array.from({length:restart+1},()=>new Float64Array(restart));
      const c=[], s=[], g=new Float64Array(restart+1); g[0]=beta;
      let used=0;
      for(let j=0;j<restart && iterations<maxIterations;j++){
        await backend.apply(v[j],z[j]);
        p.apply(z[j],w);
        for(let i=0;i<=j;i++){h[i][j]=await p.dot(w,v[i]);p.axpy(w,v[i],-h[i][j]);}
        const tail=await p.norm(w);h[j+1][j]=tail;
        for(let i=0;i<j;i++){
          const a=h[i][j], b=h[i+1][j];
          h[i][j]=c[i]*a+s[i]*b; h[i+1][j]=-s[i]*a+c[i]*b;
        }
        const pivot=Math.hypot(h[j][j],tail);
        if(!(pivot>0) || !Number.isFinite(pivot)) throw Error('FGMRES lost its Krylov basis');
        c[j]=h[j][j]/pivot;s[j]=tail/pivot;h[j][j]=pivot;
        g[j+1]=-s[j]*g[j];g[j]*=c[j];iterations++;used++;
        if(Math.abs(g[j+1])<=stop || tail===0) break;
        p.scaled(v[j+1],w,1/tail);
      }
      const y=new Float64Array(used);
      for(let i=used-1;i>=0;i--){
        let a=g[i];for(let j=i+1;j<used;j++)a-=h[i][j]*y[j];y[i]=a/h[i][i];
      }
      for(let i=0;i<used;i++) p.axpy(x,z[i],y[i]);
      if(p.trueResidual)p.trueResidual(x,r);
      else{p.apply(x,w);p.scaled(r,p.rhs,1);p.axpy(r,w,-1);}
      beta=await p.norm(r);
      if(!Number.isFinite(beta)) throw Error('Nonfinite true FP32 residual');
    }
    const {relativeResidual,relativeError}=await p.verify(x);
    return {ms:performance.now()-start,iterations,relativeResidual,relativeError,qualified:relativeResidual<=tolerance && relativeError<2e-4};
  };
}

export function winningBackend(candidates){
  const eligible=candidates.filter(c=>c.samples.length>=3 && c.samples.every(s=>s.qualified && Number.isFinite(s.ms) && s.ms>0));
  return eligible.sort((a,b)=>median(a.samples.map(s=>s.ms))-median(b.samples.map(s=>s.ms)))[0]??null;
}

export async function benchmarkPressure(device,progress,dims=[32,16,16]) {
  const gpu=gpuScope(device), backends=[], candidates=[];
  try {
    const volume=await pressureProblem(gpu,dims),volumeSolve=await krylovSolver(volume);
    for(const n of [8,16]){
      const since=performance.now(),schur=schurGeometry(n),blocks=dims.reduce((a,b)=>a*b)/n**3;
      const shell=await schurSystem(gpu,n,dims,schur,volume,await vectorOps(gpu,blocks*schur.m));
      const shellSolve=await krylovSolver(shell),sharedSetupMs=performance.now()-since;
      for(const method of ['fast-diagonalization','shared-schur']){
      for(const kind of ['webgpu-fp32','webgpu-f16']){
        const candidate={kind,block:n,method,samples:[]};candidates.push(candidate);
        const solve=method==='shared-schur'?shellSolve:volumeSolve;
        if(method==='shared-schur')Object.assign(candidate,{interfaceNodes:schur.m,outerUnknowns:blocks*schur.m,sharedSetupMs,responseAndInverseFp32Bytes:schur.s.byteLength+schur.green.byteLength});
        device.pushErrorScope('validation');
        let backend;
        try{
          if(kind==='webgpu-f16' && !device.features.has('shader-f16'))throw Error('shader-f16 is unavailable on this device');
          const since=performance.now();
          backend=method==='shared-schur'?await schurPreconditioner(gpu,n,dims,kind,schur):await gpuBlocks(gpu,n,dims,kind==='webgpu-f16');
          candidate.setupMs=performance.now()-since;
          const warm=await solve(backend);
          if(!warm.qualified)throw Error('Warmup failed true residual or manufactured-solution check: '+JSON.stringify(warm));
          candidate.warmup=warm;
        }catch(error){candidate.unavailable=error.message;}
        const validation=await device.popErrorScope();
        if(validation)candidate.unavailable=validation.message;
        if(candidate.unavailable){backend?.close?.();if(kind==='webgpu-fp32'&&method==='fast-diagonalization')throw Error(candidate.unavailable);}
        else backends.push({backend,candidate,solve});
        progress('pressure '+method+' '+kind+' '+n+'³ '+(candidate.unavailable??'qualified for timing'));
      }
      }
    }
    for(let trial=0;trial<3;trial++){
      for(let k=0;k<backends.length;k++){
        const {backend,candidate,solve}=backends[(trial+k)%backends.length];
        if(candidate.unavailable)continue;
        device.pushErrorScope('validation');
        try{candidate.samples.push(await solve(backend));}
        catch(error){candidate.unavailable=error.message;}
        const validation=await device.popErrorScope();
        if(validation)candidate.unavailable=validation.message;
        if(candidate.unavailable&&candidate.kind==='webgpu-fp32'&&candidate.method==='fast-diagonalization')throw Error(candidate.unavailable);
      }
    }
    for(const c of candidates) if(c.samples.length)c.medianMs=median(c.samples.map(s=>s.ms));
    const winner=winningBackend(candidates.filter(c=>!c.unavailable));
    if(!winner || !candidates.filter(c=>c.kind==='webgpu-fp32'&&c.method==='fast-diagonalization').every(c=>c.samples.length===3&&c.samples.every(s=>s.qualified)))throw Error('FP32 pressure fallback failed');
    return {dims,candidates,selected:{kind:winner.kind,method:winner.method,block:winner.block,medianMs:winner.medianMs}};
  } finally { for(const {backend} of backends)backend.close?.(); gpu.close(); }
}
