import {gridWGSL} from './fixtures.mjs';
import {metricWGSL,metricBuffer} from './rectilinear.mjs';

// A shared face is implicit only when both centres are beyond the measured
// swept cylinder. The inner blade, boundary layers and their neighbouring
// faces keep their existing time-accurate spatial reconstruction.
export function outerSpinWGSL(f){
  if(!f.implicitRadiusM)return 'fn outerFace(p:vec3i,q:vec3i)->bool{return false;}';
  return `fn outerCentre(p:vec3i)->bool{
    let r=vec2f(${f.origin[1]},${f.origin[2]})+cellCenters(clamp(p,vec3i(0),DIMS-1)).yz*${f.h};
    return dot(r,r)>${f.implicitRadiusM**2};
  }
  fn outerFace(p:vec3i,q:vec3i)->bool{return outerCentre(p)&&outerCentre(q);}`;
}

// Backward-Euler donor transport of absolute momentum, k and omega on the
// outer relative face flows. After solving, integrate the shared fluxes one
// last time so internal transfers cancel even at finite iteration tolerance.
export async function outerTransport(gpu,f,dt,predictor,flux,tail){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],metric=metricBuffer(gpu,f),uniform=f.maxSpeed*dt/f.h;
  const k0=1.5*(.005*uniform)**2,w0=k0/(5*f.nu*dt/f.h**2);
  const work=gpu.buffer('CFD outer implicit transport iterate',predictor.size);
  const peak=gpu.buffer('CFD outer transport residual',4),stage=gpu.staging('CFD outer transport residual readback',4);
  const common=gridWGSL(f)+metricWGSL(f)+outerSpinWGSL(f)+`
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f} struct Flux{hi:vec4f,lo:vec4f}
    @group(0) @binding(2) var<storage,read> high:array<Flux>;
    @group(0) @binding(3) var<storage,read> low:array<Flux>;
    const FREE=vec4f(${f.U*dt/f.h},0.,0.,${k0});const OMEGA=f32(${w0});
    struct Transfer{uk:vec4f,omega:f32,outgoing:f32}
  `;
  const transfer=`fn transport(i:u32,p:vec3i)->Transfer{
    let w=cellWidths(p);let inv=1./(w.x*w.y*w.z);var t=Transfer(vec4f(0),0.,0.);
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var q=p;q[a]+=side;if(!outerFace(p,q)){continue;}
      let h=select(high[i].lo[a],high[i].hi[a],side>0);
      let l=select(low[i].lo[a],low[i].hi[a],side>0);
      let rate=(h+l)*f32(side)*inv;if(rate>=0.){t.outgoing+=rate;}
      else{var v=FREE;var omega=OMEGA;if(inside(q)){let neighbour=guess[index(q)];v=neighbour.uk;omega=neighbour.wt.x;}
        t.uk-=rate*v;t.omega-=rate*omega;}
    }}return t;}`;
  const data=(dst,src)=>`@group(0) @binding(0) var<storage,${dst}> rhs:array<Cell>;
    @group(0) @binding(1) var<storage,${src}> guess:array<Cell>;`;
  const kernels=[],bindings=[];
  for(let colour=0;colour<2;colour++){
    const op=await gpu.kernel('CFD outer transport colour '+colour,common+data('read','read_write')+transfer+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=CELLS){return;}let p=point(i);
        if(((p.x+p.y+p.z)&1)!=${colour}||!outerCentre(p)){return;}
        let t=transport(i,p);let s=rhs[i];let inv=1./(1.+t.outgoing);
        guess[i].uk=(s.uk+t.uk)*inv;guess[i].wt.x=(s.wt.x+t.omega)*inv;
      }`);
    kernels.push(op);bindings.push(gpu.bind(op,[predictor,work,flux,tail],metric));
  }
  const check=await gpu.kernel('CFD true implicit transport defect',common+data('read','read')+transfer+`
    @group(0) @binding(4) var<storage,read_write> peak:atomic<u32>;var<workgroup> block:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) l:u32){
      let i=g.x;var error=0.;if(i<CELLS&&outerCentre(point(i))){
        let t=transport(i,point(i));let old=guess[i];let s=rhs[i];
        let defect=abs((s.uk-old.uk)+t.uk-t.outgoing*old.uk);
        let omega=abs((s.wt.x-old.wt.x)+t.omega-t.outgoing*old.wt.x);
        error=max(length(defect.xyz)/max(${uniform},length(old.uk.xyz)),
          max(defect.w/max(${k0},abs(old.uk.w)),omega/max(OMEGA,abs(old.wt.x))));
      }block[l]=bitcast<u32>(error);for(var h=64u;h>0u;h/=2u){
        workgroupBarrier();if(l<h){block[l]=max(block[l],block[l+h]);}}
      if(l==0u){atomicMax(&peak,block[0]);}}`);
  const checkGroup=gpu.bind(check,[predictor,work,flux,tail,peak],metric);
  const finish=await gpu.kernel('CFD conservative outer momentum flux integral',common+data('read_write','read')+transfer+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS||!outerCentre(point(i))){return;}let t=transport(i,point(i));let v=guess[i];
      let s=rhs[i];rhs[i].uk=s.uk+(t.uk-t.outgoing*v.uk);
      rhs[i].wt.x=s.wt.x+(t.omega-t.outgoing*v.wt.x);
    }`);
  const finishGroup=gpu.bind(finish,[predictor,work,flux,tail],metric);
  const sweep={kind:'implicit outer transport sweep',encode:e=>{
    for(let k=0;k<2;k++)gpu.dispatch(e,kernels[k],bindings[k],grid);
  }};
  const norm={kind:'outer transport defect',encode:e=>{e.clearBuffer(peak);gpu.dispatch(e,check,checkGroup,grid);e.copyBufferToBuffer(peak,0,stage,0,4);}};
  const begin={kind:'initialize implicit outer transport',encode:e=>e.copyBufferToBuffer(predictor,0,work,0,work.size)};
  const end={kind:'integrate outer face impulses',encode:e=>gpu.dispatch(e,finish,finishGroup,grid)};
  return residualControlledTransport(stage,begin,sweep,norm,end,64);
}

// Stop on the true equation defect, then integrate the shared final face
// fluxes. Subdomains can provide different sweeps on the same scheduler.
export function residualControlledTransport(stage,begin,sweep,norm,end,maxSweeps){
  const stats={steps:0,sweeps:0,maxRelativeDefect:0};
  return {stats,async solve(scheduler,assertCurrent){
    let count=0,defect=Infinity;
    while(defect>2e-5){
      if(count>=maxSweeps)throw Error('Implicit momentum transport did not converge: '+defect);
      const batch=count?4:2;
      await scheduler.perform([...(count?[]:[begin]),...Array(batch).fill(sweep),norm],assertCurrent);
      await stage.mapAsync(GPUMapMode.READ);
      try{defect=new Float32Array(stage.getMappedRange())[0];}finally{stage.unmap();}
      if(!Number.isFinite(defect))throw Error('Nonfinite implicit momentum residual');
      count+=batch;
    }
    await scheduler.perform([end],assertCurrent);
    stats.steps++;stats.sweeps+=count;stats.maxRelativeDefect=Math.max(stats.maxRelativeDefect,defect);
  }};
}
