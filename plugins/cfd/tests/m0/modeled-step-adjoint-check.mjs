import {cartesianSolver,cutGroups,gpuScope} from '../../plugin.js';
import {cutStudyInputs} from './cut-projection-adjoint-check.mjs';

export function modeledStudyInputs(){
  const inputs=cutStudyInputs(),{dims,n,dt,f,state,flow,tail,point}=inputs;
  Object.assign(f,{ddes:true,sstWall:true,faceReconstruction:true,incrementalPressure:true,
    fluxEquilibration:true,globalPressure:true,cutBlockSmoother:true});
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i);
    state.set([.055+.012*x-.007*y+.019*Math.sin(.41*z),.035*Math.cos(.35*x+.42*z),.041*Math.sin(.34*y-.27*x),
      .0018+.00011*x+.00013*Math.cos(.53*z+.29*y),.069+.002*y+.009*Math.cos(.42*x+.31*z),
      .0017*(1.54+Math.sin(.37*x-.46*y+.29*z)),0,0],8*i);
    for(let a=0;a<3;a++){
      if(point(i)[a]===0&&!f.pressureOpen[2*a]){flow[8*i+4+a]=a===0?f.U*dt/f.h:0;tail[8*i+4+a]=0;}
      if(point(i)[a]===dims[a]-1&&!f.pressureOpen[2*a+1]){flow[8*i+a]=0;tail[8*i+a]=0;}
    }
  }
  return inputs;
}

export async function verifyModeledStepAdjoint(device){
  const gpu=gpuScope(device);
  const {dims,n,dt,f,state,flow,tail,mu,wall,centers,point,strides}=modeledStudyInputs();
  try{
    const mob=gpu.buffer('Connected cut geometry',mu),walls=gpu.buffer('Wall distance and group scale',wall);
    const force=gpu.buffer('Accumulated wall force',4*n),groups=await cutGroups(gpu,f,mob,walls);
    const s=await cartesianSolver(gpu,f,dt,walls,force,mob,groups,gpu.buffer('Cut centroids',centers));
    const zu=state.slice(),zq=flow.slice(),zp=new Float32Array(n),zf=mu.slice(),zm=mu.slice();
    const zData=[zu,zq,zp,zf,zm];
    const seed=Object.fromEntries(['state','face','pressure','force','moment'].map((key,i)=>[key,gpu.buffer('Objective '+key,zData[i])]));
    const op=await s.modeledStepAdjoint(seed),checkpoints=Array.from({length:4},()=>gpu.buffer('Previous physical time level',op.checkpointSize));
    const stage=gpu.staging('Coupled time-step readback',32*n),read=b=>gpu.read(b,stage,b.size/4);
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    const scheduler={async perform(phases,check){check();dispatch(e=>{for(const phase of phases)phase.encode(e);});}};
    const rows=[],defects=[],values=[state,flow,tail],buffers=[s.state,s.flux,s.fluxTail];
    async function forward(steps,directions,amount,record){
      values.forEach((v,j)=>device.queue.writeBuffer(buffers[j],0,amount?v.map((b,k)=>b+amount*directions[j][k]):v));
      dispatch(e=>{s.pressureHierarchy.updateGeometry(e);e.clearBuffer(s.pressure);e.clearBuffer(force);e.clearBuffer(s.loads);});
      for(let t=0;t<steps;t++){
        if(record)dispatch(e=>op.capture(e,checkpoints[t]));
        await s.advance(t+1,false,scheduler,()=>{});
      }
      if(!record)return [await read(s.state),await read(s.flux),await read(s.fluxTail),await read(s.pressure),await read(force),await read(s.loads)];
    }
    for(const steps of [1,4]){
      for(const onlyBody of [false,true]){
        for(let i=0;i<n;i++){
          const fluid=mu[4*i+3]>0;
          for(let a=0;a<8;a++){
            zu[8*i+a]=onlyBody||!fluid||a>=6?0:(a===4?.23:.64)*Math.sin(.37*i+.58*a);
            zq[8*i+a]=onlyBody||!fluid||a%4===3?0:.7*Math.cos(.49*i-.31*a);
          }
          zp[i]=onlyBody||!fluid?0:.18*Math.sin(.33*i+.15);
          for(let a=0;a<3;a++){zf[4*i+a]=.61*Math.cos(.39*i-.56*a);zm[4*i+a]=1.3*Math.sin(.47*i+.65*a);}
        }
        Object.values(seed).forEach((b,j)=>device.queue.writeBuffer(b,0,zData[j]));
        await forward(steps,null,0,true);
        for(let t=steps-1;t>=0;t--){
          dispatch(e=>{op.reverse(e,checkpoints[t]);e.copyBufferToBuffer(op.old,0,seed.state,0,seed.state.size);
            e.copyBufferToBuffer(op.face,0,seed.face,0,seed.face.size);e.clearBuffer(seed.pressure);});
          defects.push(Array.from(await op.projection.defects()));
        }
        const oldu=await read(op.old),oldq=await read(op.face);
        for(const [mode,input] of ['velocity','k','omega','eddy viscosity','shared discharge','one incidence'].entries()){
          const dir=values.map(v=>new Float32Array(v.length));let derivative=0,scale=0;
          function put(field,k,amount){dir[field][k]=amount;const t=dir[field][k]*(field?oldq:oldu)[k];derivative+=t;scale+=Math.abs(t);}
          for(let i=0;i<n;i++){
            if(mu[4*i+3]===0)continue;
            const p=point(i);
            for(let a=0;a<3;a++){
              const v=Math.cos(.28*i+.64*a)*Math.sin(.073*i-.38*a+.24);
              if(mode===0)put(0,8*i+a,.034*v);
              if(mode>=1&&mode<=3&&a===0)put(0,8*i+mode+2,[0,.00083,.022,.0014][mode]*v);
              if(mode>=4&&p[a]+1<dims[a]&&mu[4*i+a]>0){
                const q=.028*v*mu[4*i+a];put(mode===4?1:2,8*i+a,q);
                if(mode===4)put(1,8*(i+strides[a])+4+a,q);
              }
            }
          }
          const estimates=[];
          for(const step of [.006,.002]){
            const l=await forward(steps,dir,-step,false),r=await forward(steps,dir,step,false);
            const difference=(j,k)=>r[j][k]-l[j][k];let total=0;
            for(let i=0;i<n;i++){
              for(let a=0;a<8;a++){const k=8*i+a;total+=zu[k]*difference(0,k)+zq[k]*(difference(1,k)+difference(2,k));}
              total+=zp[i]*difference(3,i);
              for(let a=0;a<3;a++){
                total+=zf[4*i+a]*(a?difference(5,4*i+1+a):difference(4,i));
                total+=zm[4*i+a]*(a?difference(5,4*(n+i)+1+a):difference(5,4*i+1));
              }
            }
            const secant=total/(2*step);estimates.push({step,secant,normalizedError:Math.abs(secant-derivative)/Math.max(scale,1e-12)});
          }
          rows.push({steps,objective:onlyBody?'integrated wall wrench':'terminal state and integrated wall wrench',input,derivative,scale,estimates});
        }
      }
    }
    return {pass:rows.length===24&&s.fluxConvergence.missedSteps===0&&defects.every(d=>d[1]<3e-6)&&
      rows.every(r=>r.estimates.every(e=>e.normalizedError<.008)),dims,mergedCells:groups.stats.mergedCells,
      maxDivergencePerS:s.fluxConvergence.maxDivergencePerS,defects,rows};
  }finally{gpu.close();}
}
