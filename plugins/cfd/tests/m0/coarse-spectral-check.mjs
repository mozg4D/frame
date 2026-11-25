import {gpuScope,median} from './gpu.mjs';
import {pressureMultigrid} from '../../plugin.js';

// The two variants see the same independently assembled cut pressure row and
// manufactured pressure. Include local blocks, true outer restarts and final
// readback in both measurements. No flow reference enters the preconditioner.
export async function verifyCoarseSpectral(device){
  const dims=[64,48,40],strides=[1,64,64*48],n=dims.reduce((a,b)=>a*b);
  const widths=dims.map((d,a)=>Array.from({length:d},(_,k)=>.45+.08*a+1.9*((k+.5)/d)**2));
  const axes=widths.map(w=>{let x=0;return Float64Array.from([0,...w.map(d=>(x+=d))]);});
  const open=[false,true,true,false,true,true],mu=new Float32Array(4*n),row=new Float64Array(4*n),p=new Float64Array(n);
  const location=i=>[i%dims[0],Math.floor(i/dims[0])%dims[1],Math.floor(i/strides[2])];
  const phi=([x,y,z])=>Math.hypot((x-28)/1.35,y-21,(z-18)*1.15)-7.4;
  const fraction=x=>Math.max(0,Math.min(1,x+.5));
  for(let i=0;i<n;i++){
    const q=location(i),m=fraction(phi(q));mu[4*i+3]=m;
    if(m)p[i]=.12*Math.cos(.03*q[0]+.08*q[1])+.31*Math.sin(.06*q[2]-.02*q[0])+.04*Math.sin(.67*q[0]-.52*q[1]+.77*q[2]);
  }
  for(let i=0;i<n;i++){
    const q=location(i),w=q.map((j,a)=>widths[a][j]);
    for(let a=0;a<3;a++){
      const j=q[a],area=w[(a+1)%3]*w[(a+2)%3];
      if((j===0&&open[2*a])||(j+1===dims[a]&&open[2*a+1]))row[4*i+3]+=2*area/w[a];
      if(j+1===dims[a])continue;
      const other=i+strides[a],mid=[...q];mid[a]+=.5;
      const aperture=mu[4*i+3]>0&&mu[4*other+3]>0?fraction(phi(mid)):0;
      mu[4*i+a]=aperture;row[4*i+a]=mu[4*i+a]*2*area/(w[a]+widths[a][j+1]);
    }
  }
  function apply(x){
    const b=Float64Array.from(x,(v,i)=>v*row[4*i+3]);
    for(let i=0;i<n;i++)for(let a=0;a<3;a++){const c=row[4*i+a];if(!c)continue;
      const j=i+strides[a],v=c*(x[i]-x[j]);b[i]+=v;b[j]-=v;
    }return b;
  }
  const b=apply(p),norm=v=>Math.sqrt(v.reduce((s,x)=>s+x*x,0)),bNorm=norm(b),pNorm=norm(p);
  const configs=[];
  for(const coarseSpectral of [false,true]){
    const gpu=gpuScope(device),init=performance.now();
    try{
      const f={dims,axes,h:1,origin:[0,0,0],name:'manufactured',globalPressure:true,coarseSpectral,cutCells:true,pressureOpen:open};
      const mg=await pressureMultigrid(gpu,f,gpu.buffer('CFD reference cut fractions',mu)),stage=gpu.staging('CFD certified pressure',4*n);
      const first=device.createCommandEncoder();mg.updateGeometry(first);device.queue.submit([first.finish()]);device.queue.writeBuffer(mg.rhs,0,Float32Array.from(b));
      await device.queue.onSubmittedWorkDone();const setupMs=performance.now()-init,times=[],gpuTimes=[];
      let relativeResidual,relativeError,iterations;
      for(let trial=0;trial<3;trial++){
        const start=performance.now();let queueMs=0;iterations=0;
        for(let k=0;k<12;k++){
          const begin=performance.now(),e=device.createCommandEncoder();
          if(!k){e.clearBuffer(mg.p);mg.solve(e);}mg.refine(e,6);device.queue.submit([e.finish()]);
          await device.queue.onSubmittedWorkDone();queueMs+=performance.now()-begin;iterations+=6;
          const measured=await gpu.read(mg.p,stage,n),rhs=apply(measured);
          relativeError=Math.sqrt(p.reduce((s,v,i)=>s+(measured[i]-v)**2,0))/pNorm;
          relativeResidual=Math.sqrt(b.reduce((s,v,i)=>s+(rhs[i]-v)**2,0))/bNorm;
          if(relativeResidual<2e-5&&relativeError<5e-5)break;
        }
        if(trial){times.push(performance.now()-start);gpuTimes.push(queueMs);}
      }
      configs.push({coarseSpectral,setupMs,iterations,relativeResidual,relativeError,medianSolveMs:median(times),medianQueueMs:median(gpuTimes),
        exactCutBlocks:mg.cutBlocks,allocatedBytes:gpu.allocatedBytes,pass:relativeResidual<2e-5&&relativeError<5e-5});
    }finally{gpu.close();}
  }
  return {dims,configs,speedup:configs[0].medianSolveMs/configs[1].medianSolveMs,pass:configs.every(c=>c.pass)};
}
