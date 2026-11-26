import {cartesianSolver,cutGroups,gpuScope} from '../../plugin.js';
import {modeledStudyInputs} from './modeled-step-adjoint-check.mjs';

export const verifyRotatingGeometryAdjoint=device=>verifyModeledGeometryAdjoint(device,true);
export async function verifyModeledGeometryAdjoint(device,rotating=false){
  const {dims,n,dt,f,state,flow,tail,mu,wall,centers,point}=modeledStudyInputs(rotating),steps=4;
  const zu=state.slice(),zq=flow.slice(),zp=new Float32Array(n),zf=mu.slice(),zm=mu.slice();
  for(let i=0;i<n;i++){
    const live=mu[4*i+3]>0;
    for(let a=0;a<8;a++){
      zu[8*i+a]=live&&a<6?.44*Math.cos(.31*i+.62*a):0;
      zq[8*i+a]=live&&a%4!==3?.76*Math.sin(.37*i+.55*a):0;
    }
    zp[i]=live?.15*Math.cos(.27*i):0;
    for(let a=0;a<3;a++){zf[4*i+a]=.73*Math.cos(.38*i+.59*a);zm[4*i+a]=1.2*Math.sin(.47*i+.7*a);}
  }
  async function solve(geometry,reverse=false){
    const gpu=gpuScope(device);
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    const scheduler={async perform(phases,check){check();dispatch(e=>{for(const p of phases)p.encode(e);});}};
    try{
      const mob=gpu.buffer('Independent cut fractions',geometry[0]),walls=gpu.buffer('Independent signed distances',geometry[1]);
      const force=gpu.buffer('Integrated axial wall load',4*n),groups=await cutGroups(gpu,f,mob,walls);
      const s=await cartesianSolver(gpu,f,dt,walls,force,mob,groups,gpu.buffer('Independent aperture centroids',geometry[2]));
      const stage=gpu.staging('Time integrated objective and material derivatives',48*n),read=b=>gpu.read(b,stage,b.size/4);
      const roots=new Uint32Array((await read(groups.links)).buffer).filter((_,i)=>i%3===0);
      const seed=reverse?Object.fromEntries(['state','face','pressure','force','moment'].map((key,i)=>
        [key,gpu.buffer('Physical objective '+key,[zu,zq,zp,zf,zm][i])])):null;
      const op=reverse?await s.modeledStepAdjoint(seed):null;
      const history=op?Array.from({length:steps},()=>gpu.buffer('Native time checkpoint',op.checkpointSize)):[];
      device.queue.writeBuffer(s.state,0,state);device.queue.writeBuffer(s.flux,0,flow);device.queue.writeBuffer(s.fluxTail,0,tail);
      dispatch(e=>{s.pressureHierarchy.updateGeometry(e);e.clearBuffer(s.pressure);e.clearBuffer(force);e.clearBuffer(s.loads);});
      for(let t=0;t<steps;t++){
        if(op)dispatch(e=>op.capture(e,history[t]));
        await s.advance(t+1,false,scheduler,()=>{});
      }
      const fields=[await read(s.state),await read(s.flux),await read(s.fluxTail),await read(s.pressure),await read(force),await read(s.loads)];
      const gradient=new Float64Array(12*n),defects=[];
      if(op)for(let t=steps-1;t>=0;t--){
        if(rotating)await op.reverseStep(t+1,history[t],32,scheduler,()=>{});
        dispatch(e=>{if(!rotating)op.reverse(e,history[t]);e.copyBufferToBuffer(op.old,0,seed.state,0,seed.state.size);
          e.copyBufferToBuffer(op.face,0,seed.face,0,seed.face.size);e.clearBuffer(seed.pressure);});
        const material=await read(op.geometry);for(let k=0;k<material.length;k++)gradient[k]+=material[k];
        defects.push(Array.from(await op.projection.defects()));
      }
      return {fields,gradient,roots,defects,mass:s.fluxConvergence.maxDivergencePerS};
    }finally{gpu.close();}
  }
  const initial=[mu,wall,centers],base=await solve(initial,true),rows=[];
  let sameRoots=true,worstMass=base.mass;
  for(const [mode,input] of ['shared aperture','constituent fluid fraction','signed wall distance','cut face centroid'].entries()){
    const direction=initial.map(v=>new Float32Array(v.length));let derivative=0,scale=0;
    function put(id,k,amount,bar){direction[id][k]=amount;const v=direction[id][k]*bar;derivative+=v;scale+=Math.abs(v);}
    for(let i=0;i<n;i++){
      const p=point(i),theta=mu[4*i+3],t=Math.sin(.53*i+.17)*Math.cos(.083*i);
      if(mode===1&&theta>0&&theta<1)put(0,4*i+3,.26*t*Math.min(theta,1-theta),base.gradient[12*i+3]);
      if(mode===2)put(1,4*i,.17*t,base.gradient[12*i+7]);
      for(let a=0;a<3;a++){
        const m=mu[4*i+a],v=Math.sin(.31*i+.47*a)*Math.cos(.107*i+.23);
        if(m<=0||m>=1||p[a]+1===dims[a])continue;
        if(mode===0)put(0,4*i+a,.29*v*Math.min(m,1-m),base.gradient[12*i+4*a]);
        if(mode===3)for(let b=0;b<2;b++)put(2,6*i+2*a+b,(b?-.11:.16)*v,base.gradient[12*i+4*a+1+b]);
      }
    }
    const estimates=[];
    for(const step of [.009,.003]){
      const pair=[];
      for(const sign of [-1,1]){
        const g=initial.map((v,j)=>v.map((x,k)=>x+sign*step*direction[j][k]));
        const result=await solve(g);sameRoots&&=result.roots.every((r,i)=>r===base.roots[i]);
        worstMass=Math.max(worstMass,result.mass);pair.push(result.fields);
      }
      const diff=(j,k)=>pair[1][j][k]-pair[0][j][k];let total=0;
      for(let i=0;i<n;i++){
        for(let a=0;a<8;a++){const k=8*i+a;total+=zu[k]*diff(0,k)+zq[k]*(diff(1,k)+diff(2,k));}
        total+=zp[i]*diff(3,i);
        for(let a=0;a<3;a++){
          total+=zf[4*i+a]*(a?diff(5,4*i+1+a):diff(4,i));
          total+=zm[4*i+a]*(a?diff(5,4*(n+i)+1+a):diff(5,4*i+1));
        }
      }
      const secant=total/(2*step);estimates.push({step,secant,normalizedError:Math.abs(secant-derivative)/scale});
    }
    rows.push({input,derivative,scale,estimates});
  }
  return {pass:sameRoots&&worstMass<1e-6&&base.defects.every(d=>d[1]<3e-6)&&rows.every(r=>r.scale>0&&
    r.estimates.every(e=>e.normalizedError<.005)),dims,steps,sameRoots,worstMass,defects:base.defects,rows};
}
