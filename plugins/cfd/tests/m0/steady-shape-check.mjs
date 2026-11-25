import {gpuScope,laminarMomentumAdjoint,steadyForceAdjoint,pressureMultigrid,cellWidth,cellCenter,nativeFlowGeometry} from '../../plugin.js';
import {captureFlowSurfaces,researchSceneContext} from './native-geometry.mjs';

// Differentiate an independent double-precision evaluation by perturbing
// velocities and shared face flows separately. Mixed flow signs exercise
// bounded inflow, outflow and the reflected moving-road ghost state.
export async function verifyMomentumTranspose(device){
  const gpu=gpuScope(device),dims=[8,8,8],h=.004,dt=.0002,n=512;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(1+.025*(a+1)*i)));
  const f={dims,axes,origin:[0,0,0],h,nu:.00015,U:.8,movingRoad:true};
  let seed=49;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32-.5;};
  const state=new Float32Array(8*n),lambda=new Float32Array(4*n),velocityChange=new Float64Array(3*n);
  const flow=new Float32Array(8*n),change=new Float64Array(8*n);
  const stride=[1,8,64],point=i=>[i%8,(i>>3)%8,i>>6];
  for(let i=0;i<n;i++)for(let a=0;a<3;a++){
    state[8*i+a]=.3*random();lambda[4*i+a]=random();velocityChange[3*i+a]=random();
    flow[8*i+a]=.02*random();change[8*i+a]=random();
    const j=i-stride[a];flow[8*i+4+a]=point(i)[a]?flow[8*j+a]:.02*random();
    change[8*i+4+a]=point(i)[a]?change[8*j+a]:random();
  }
  const width=(a,p)=>cellWidth(f,a,p),gap=(a,p,q)=>Math.abs(cellCenter(f,a,p)-cellCenter(f,a,q))/h;
  function objective(du,dq){
    const u=(i,a)=>state[8*i+a]+du*velocityChange[3*i+a];let J=0;
    for(let i=0;i<n;i++){
      const p=point(i),w=p.map((v,a)=>width(a,v)),volume=w.reduce((a,b)=>a*b);
      for(let k=0;k<3;k++){
        let v=volume*u(i,k);
        for(let a=0;a<3;a++)for(const s of [-1,1]){
          const off=8*i+(s>0?0:4)+a,q=s*(flow[off]+dq*change[off]),next=p[a]+s,j=i+s*stride[a];
          const inside=next>=0&&next<8;let other=u(i,k),distance=w[a];
          if(inside){other=u(j,k);distance=gap(a,p[a],next);}
          else if(a===1&&s<0)other=(k===0?2*f.U*dt/h:0)-u(i,k);
          else if(a===0&&s<0||q<0)other=k===0?f.U*dt/h:0;
          let up=q>=0?u(i,k):other;
          const dp=q>=0?p[a]:next,d=q>=0?i:j,hp=dp+(q>=0?-s:s);
          if(inside&&hp>=0&&hp<8){
            const back=(up-u(d+(hp-dp)*stride[a],k))/gap(a,dp,hp);
            const front=((q>=0?other:u(i,k))-up)/distance;
            if(back*front>0)up+=.5*width(a,dp)*Math.sign(back)*Math.min(Math.abs(back),Math.abs(front));
          }
          v-=q*up;v+=f.nu*dt/h**2*volume/w[a]/distance*(other-u(i,k));
        }
        J+=v*lambda[4*i+k];
      }
    }
    return J;
  }
  try{
    const solved={state:gpu.buffer('CFD test primal velocities',state),flux:gpu.buffer('CFD test face fluxes',flow),
      fluxTail:gpu.buffer('CFD test fine flux words',flow.byteLength)};
    const out=gpu.buffer('CFD momentum transpose result',48*n);
    const op=await laminarMomentumAdjoint(gpu,f,dt,solved,gpu.buffer('CFD test adjoint seed',lambda),out);
    const e=device.createCommandEncoder();op.freeze(e);op.encode(e);device.queue.submit([e.finish()]);
    const values=await gpu.read(out,gpu.staging('CFD dual identity samples',48*n),12*n);
    let du=0,dq=0;
    for(let i=0;i<n;i++){
      const p=point(i),volume=p.map((v,a)=>width(a,v)).reduce((a,b)=>a*b);
      for(let k=0;k<3;k++){
        du+=volume*values[12*i+k]*velocityChange[3*i+k];dq+=values[12*i+4+k]*change[8*i+k];
        if(!p[k])dq+=values[12*i+8+k]*change[8*i+4+k];
      }
    }
    const eps=1e-7,duFD=(objective(eps,0)-objective(-eps,0))/(2*eps),dqFD=(objective(0,eps)-objective(0,-eps))/(2*eps);
    const errors=[Math.abs(du-duFD)/Math.abs(duFD),Math.abs(dq-dqFD)/Math.abs(dqFD)];
    return {du,dq,duFD,dqFD,relativeErrors:errors,pass:errors.every(e=>e<1e-5)};
  }finally{gpu.close();}
}

// Small independent Float64 primal. Factor the full pressure operator with
// banded Cholesky and reconstruct the explicitly imposed wall impulse. Its
// objective includes both limited advection and molecular diffusion.
function referenceGrid(f,dt,mu,region,direction=[1,0,0]){
  const [nx,ny,nz]=f.dims,n=nx*ny*nz,stride=[1,nx,nx*ny],bw=stride[2],row=bw+1;
  const U=f.U*dt/f.h,nu=f.nu*dt/f.h**2,volume=new Float64Array(n),faces=[];
  const chol=new Float64Array(n*row),p=new Float64Array(n),u=new Float64Array(3*n),q=new Float64Array(8*n);
  const rawMean=new Float64Array(3*n),next=new Float64Array(3*n);
  const pos=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/bw)];
  for(let i=0;i<n;i++){
    const xyz=pos(i),width=xyz.map((p,a)=>cellWidth(f,a,p));volume[i]=width.reduce((a,b)=>a*b);
    for(let a=0;a<3;a++)for(const s of xyz[a]===0?[-1,1]:[1]){
      const inside=xyz[a]+s>=0&&xyz[a]+s<f.dims[a],j=inside?i+s*stride[a]:-1;
      const l=s>0?i:j,r=s>0?j:i,area=volume[i]/width[a],open=!inside&&(a!==0||s>0)&&!(f.movingRoad&&a===1&&s<0);
      const dist=inside?Math.abs(cellCenter(f,a,xyz[a]+s)-cellCenter(f,a,xyz[a]))/f.h:width[a];
      const invP=inside?1/dist:open?2/dist:0,muFace=inside?mu[4*l+a]:1;
      const c=area*invP*muFace;if(l>=0)chol[l*row]+=c;if(r>=0)chol[r*row]+=c;
      if(inside)chol[r*row+r-l]-=c;
      const wR=inside?.5*width[a]/dist:0;
      faces.push({a,s,i,l,r,area,open,dist,invP,m:muFace,inside,wR,raw:0,
        backL:inside&&xyz[a]>0?l-stride[a]:-1,backR:inside&&xyz[a]+2<f.dims[a]?r+stride[a]:-1,
        hl:width[a],hr:inside?cellWidth(f,a,xyz[a]+1):width[a],
        dbL:inside&&xyz[a]>0?(cellCenter(f,a,xyz[a])-cellCenter(f,a,xyz[a]-1))/f.h:1,
        dbR:inside&&xyz[a]+2<f.dims[a]?(cellCenter(f,a,xyz[a]+2)-cellCenter(f,a,xyz[a]+1))/f.h:1});
    }
  }
  for(let i=0;i<n;i++){
    if(chol[i*row]===0)chol[i*row]=1;
    const begin=Math.max(0,i-bw);
    for(let j=begin;j<i;j++){
      let value=chol[i*row+i-j];
      for(let k=begin;k<j;k++)value-=chol[i*row+i-k]*chol[j*row+j-k];
      value/=chol[j*row];chol[i*row+i-j]=value;chol[i*row]-=value*value;
    }
    chol[i*row]=Math.sqrt(chol[i*row]);if(!(chol[i*row]>0))throw Error('Indefinite reference pressure factor');
  }
  function forward(v){
    p.fill(0);u.fill(0);rawMean.fill(0);let objective=0;
    for(const e of faces){
      const {l,r,i,a,inside,open,wR,area,m}=e;
      e.raw=inside?(1-wR)*v[3*l+a]+wR*v[3*r+a]:open?v[3*i+a]:a===0?U:0;
      const q=area*m*e.raw;if(l>=0)p[l]-=q;if(r>=0)p[r]+=q;
    }
    for(let i=0;i<n;i++){
      let value=p[i];for(let k=Math.max(0,i-bw);k<i;k++)value-=chol[i*row+i-k]*p[k];p[i]=value/chol[i*row];
    }
    for(let i=n-1;i>=0;i--){
      let value=p[i];for(let k=i+1;k<=Math.min(n-1,i+bw);k++)value-=chol[k*row+k-i]*p[k];p[i]=value/chol[i*row];
    }
    for(const e of faces){
      const {l,r,a,raw,invP,area,m}=e,free=raw-invP*((r>=0?p[r]:0)-(l>=0?p[l]:0));
      const corrected=m*free,opposite=(1-m)*free;
      if(l>=0){q[8*l+a]=area*corrected;u[3*l+a]+=.5*corrected;rawMean[3*l+a]+=.5*raw;objective+=direction[a]*.5*(region?.[l]??1)*volume[l]*opposite;}
      if(r>=0){q[8*r+4+a]=area*corrected;u[3*r+a]+=.5*corrected;rawMean[3*r+a]+=.5*raw;objective+=direction[a]*.5*(region?.[r]??1)*volume[r]*opposite;}
    }
    for(let i=0;i<n;i++)for(let k=0;k<3;k++){
      const j=3*i+k,sub=v[j]-rawMean[j],c=mu[4*i+3];u[j]+=c*sub;next[j]=u[j];
      objective+=direction[k]*(region?.[i]??1)*volume[i]*(1-c)*sub;
    }
    for(const e of faces){
      const {l,r,i,a,s,area,dist,inside,open}=e,discharge=l>=0?q[8*l+a]:q[8*r+4+a];
      for(let k=0;k<3;k++){
        let uL=l>=0?u[3*l+k]:0,uR=r>=0?u[3*r+k]:0;
        if(!inside){
          let ghost=u[3*i+k];
          if(f.movingRoad&&a===1&&s<0)ghost=(k===0?2*U:0)-ghost;
          else if(!open||s*discharge<0)ghost=k===0?U:0;
          if(l<0)uL=ghost;else uR=ghost;
        }
        const left=discharge>=0,donor=left?uL:uR,back=left?e.backL:e.backR;let trace=donor;
        if(back>=0){
          const backward=(donor-u[3*back+k])/(left?e.dbL:e.dbR),front=((left?uR:uL)-donor)/dist;
          if(front*backward>0)trace+=.5*(left?e.hl:e.hr)*Math.sign(front)*Math.min(Math.abs(front),Math.abs(backward));
        }
        const flux=discharge*trace-nu*area/dist*(uR-uL);
        if(l>=0)next[3*l+k]-=flux/volume[l];if(r>=0)next[3*r+k]+=flux/volume[r];
      }
    }
    return objective;
  }
  function settle(v){
    let error=Infinity,steps=0,objective=0;
    while(steps<2500&&error>2e-11){
      objective=forward(v);error=0;for(let j=0;j<v.length;j++){error=Math.max(error,Math.abs(next[j]-v[j]));v[j]=next[j];}steps++;
    }
    if(error>2e-11)throw Error('Float64 steady primal failed to converge: '+error);
    return {objective:forward(v),steps};
  }
  return {forward,settle,u,p,q,next,volume};
}

function perturbedSphere(f,patch=-1,delta=0){
  const [nx,ny,nz]=f.dims,n=nx*ny*nz,mu=new Float64Array(4*n);
  const c=[3.78,4.13,3.86].map(x=>x*f.h),radius=1.74*f.h;
  const immersion=d=>d<=-.5?0:d>=.5?1:.5+d+Math.sin(2*Math.PI*d)/(2*Math.PI);
  function distance(x){
    const v=x.map((s,a)=>s-c[a]),r=Math.hypot(...v);
    const shape=patch<0?0:Math.max(0,(patch%2?1:-1)*v[patch>>1]/r)**4;
    return r-radius-delta*shape;
  }
  for(let i=0;i<n;i++){
    const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))],x=p.map((j,a)=>cellCenter(f,a,j)),d=distance(x);
    mu[4*i+3]=d>0?immersion(d/f.h):0;
    for(let a=0;a<3;a++){
      const face=x.slice(),next=x.slice();face[a]+=.5*f.h*cellWidth(f,a,p[a]);next[a]=cellCenter(f,a,Math.min(p[a]+1,f.dims[a]-1));
      mu[4*i+a]=d>0&&distance(next)>0?immersion(distance(face)/f.h):0;
    }
  }
  return mu;
}

async function reverseSteady(gpu,f,dt,mobility,primal,v,forceMask,direction){
  const device=gpu.device,n=v.length/3;
  const pack=(src,stride)=>Float32Array.from({length:n*stride},(_,j)=>j%stride<3?src[3*Math.floor(j/stride)+j%stride]:0);
  const mg=await pressureMultigrid(gpu,f,mobility);
  const solved={mobility,forceMask,pressureHierarchy:mg,state:gpu.buffer('CFD steady primal velocity',pack(primal.u,8)),
    predicted:gpu.buffer('CFD steady predicted momentum',pack(v,8)),flux:gpu.buffer('CFD steady face flow',Float32Array.from(primal.q)),
    fluxTail:gpu.buffer('CFD zero reference flow tail',32*n)};
  const adj=await steadyForceAdjoint(gpu,f,dt,solved,direction);
  const prepare=device.createCommandEncoder();mg.updateGeometry(prepare);device.queue.submit([prepare.finish()]);
  device.queue.writeBuffer(mg.p,0,Float32Array.from(primal.p));
  const start=device.createCommandEncoder();adj.start(start);device.queue.submit([start.finish()]);
  let defects=[],iterations=0;
  while(iterations<1800){
    const e=device.createCommandEncoder();for(let j=0;j<12;j++)adj.step(e,2);device.queue.submit([e.finish()]);iterations+=12;
    defects=[...await adj.defects()];if(Math.max(...defects)<9e-7)break;
  }
  return {adj,defects,iterations};
}

export async function verifySteadyForce(device,regional=false,direction=[1,0,0]){
  const gpu=gpuScope(device),n=512,h=.006,dt=.001,rho=1.2,U=.42;
  const axes=[0,1,2].map(a=>Float64Array.from({length:9},(_,i)=>h*i*(1+.006*(a+1)*i)));
  const f={dims:[8,8,8],axes,h,dt,rho,nu:.06*h*h/dt,U,origin:[0,0,0],laminar:true};
  const region=regional?Float32Array.from({length:n},(_,i)=>Math.max(0,Math.min(1,4.73-(i>>6)))):null;
  const scale=rho*h**4/dt**2,mu=perturbedSphere(f),primal=referenceGrid(f,dt,mu,region,direction);
  const v=new Float64Array(3*n);for(let i=0;i<n;i++)v[3*i]=U*dt/h;
  const converged=primal.settle(v);
  try{
    const mobility=gpu.buffer('CFD manufactured immersed sphere',Float32Array.from(mu));
    const {adj,defects,iterations}=await reverseSteady(gpu,f,dt,mobility,primal,v,region?gpu.buffer('CFD partial objective',region):null,direction);
    const gradient=await gpu.read(adj.gradient,gpu.staging('CFD shape coefficients for paired solutions',16*n),4*n);
    const patches=[],epsilon=1e-4*h;
    for(let patch=0;patch<6;patch++){
      const upper=perturbedSphere(f,patch,epsilon),lower=perturbedSphere(f,patch,-epsilon);
      const plus=referenceGrid(f,dt,upper,region,direction).settle(v.slice()),minus=referenceGrid(f,dt,lower,region,direction).settle(v.slice());
      let derivative=0;for(let i=0;i<mu.length;i++)derivative+=gradient[i]*(upper[i]-lower[i])/(2*epsilon);
      const fd=(plus.objective-minus.objective)*scale/(2*epsilon);
      patches.push({patch,adjointNPerM:derivative,finiteDifferenceNPerM:fd,relativeError:Math.abs(derivative-fd)/Math.max(1e-15,Math.abs(fd))});
    }
    const err=Math.hypot(...patches.map(s=>s.adjointNPerM-s.finiteDifferenceNPerM))/Math.hypot(...patches.map(s=>s.finiteDifferenceNPerM));
    return {converged,iterations,defects,objectiveDirection:direction,epsilonM:epsilon,patches,relativeL2:err,pass:Math.max(...defects)<4e-6&&err<.015&&patches.every(p=>p.relativeError<.04)};
  }finally{gpu.close();}
}

export const verifyRegionalSteadyForce=device=>verifySteadyForce(device,true);
export const verifyObliqueSteadyForce=device=>verifySteadyForce(device,true,[-.6,.48,.64]);

export async function verifyNativeSteadyForce(device){
  const h=.009,dt=.001,n=512,rho=1.21,U=.38,scale=rho*h**4/dt**2;
  const f={dims:[8,8,8],origin:[-.03528,-.03447,-.03751],h,rho,U,nu:.07*h*h/dt,laminar:true,immersedShape:true,omega:0};
  const vertices=[[.0179,.0021,.0007],[-.0168,.0008,-.0028],[.0018,.0171,.0017],[-.0027,-.0163,.0031],
    [.0017,-.0014,.0179],[-.0013,.0034,-.0163]];
  const indices=[];for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++)indices.push(x,...(y?[4+z,2+y]:[2+y,4+z]));
  const dirs=vertices.map(p=>p.map(x=>x/Math.hypot(...p))),call=(op,data={})=>frameAI.call(op,data);
  const ctx=researchSceneContext(frameEngine);let older,warm;
  async function solve(vertex,delta,storage,reverse){
    await call('scene.new');if(older){let stale=false;try{older.assertCurrent();}catch{stale=true;}if(!stale)throw Error('Paired geometry was reused');}
    const box=await call('scene.create',{type:'cfd'});
    const points=vertices.map((p,j)=>p.map((x,a)=>1000*(x+(j===vertex?delta*dirs[j][a]:0)+(a===1?.15:0))));
    await call('mesh.create',{name:'Native stationary force shape patch',storage,vertices:points.flat(),indices});
    await call('diagnostics.frame',{frames:2});
    const capture=captureFlowSurfaces(device,ctx,box.hash,[0,.15,0]),gpu=gpuScope(device);older=capture;
    try{
      const native=await nativeFlowGeometry(gpu,f,capture,dt),mu=await gpu.read(native.response,gpu.staging('CFD independent physical apertures',16*n),4*n);
      const primal=referenceGrid(f,dt,mu),v=warm?.slice()??Float64Array.from({length:3*n},(_,i)=>i%3?0:U*dt/h);
      const settled=primal.settle(v);warm??=v.slice();
      if(!reverse)return {force:settled.objective*scale};
      const {adj,defects,iterations}=await reverseSteady(gpu,f,dt,native.response,primal,v);
      const range=gpu.buffer('CFD logical vertex test range',new Uint32Array([0,vertices.length,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const out=gpu.buffer('CFD logical vertex derivatives',12*vertices.length),e=device.createCommandEncoder();
      native.shape.scatter(e,adj.gradient,out,range);device.queue.submit([e.finish()]);
      const vectors=await gpu.read(out,gpu.staging('CFD paired logical vertex test',out.size),3*vertices.length);
      return {force:settled.objective*scale,backend:capture.meshes[0].storage,vectors:[...vectors],defects,iterations};
    }finally{gpu.close();}
  }
  const base=await solve(-1,0,'auto',true),paged=await solve(-1,0,'texture',true),patches=[];
  for(let j=0;j<vertices.length;j++){
    const adjoint=dirs[j].reduce((s,x,a)=>s+x*base.vectors[3*j+a],0),fd=[];
    for(const eps of [.000004,.000002]){
      const kind=j%2?'texture':'auto',upper=await solve(j,eps,kind,false),lower=await solve(j,-eps,kind,false);
      fd.push((upper.force-lower.force)/(2*eps));
    }
    patches.push({vertex:j,adjointNPerMm:.001*adjoint,pairedNPerMm:fd.map(x=>x*.001)});
  }
  const actual=patches.map(p=>p.adjointNPerMm),measured=patches.map(p=>p.pairedNPerMm[1]);
  const err=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]))/Math.hypot(...b);
  const centered=a=>a.map(x=>x-a.reduce((sum,v)=>sum+v)/a.length),aa=centered(actual),bb=centered(measured);
  const correlation=aa.reduce((sum,v,i)=>sum+v*bb[i],0)/(Math.hypot(...aa)*Math.hypot(...bb));
  const relativeL2=err(actual,measured),backendDifference=err(base.vectors,paged.vectors);
  return {forceN:base.force,patches,correlation,relativeL2,backendDifference,iterations:base.iterations,defects:base.defects,
    pass:base.backend==='buffer'&&paged.backend==='texture'&&relativeL2<.04&&correlation>.98&&backendDifference<1e-5&&actual.every((v,i)=>v*measured[i]>0)};
}
