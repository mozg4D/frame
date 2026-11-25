import {gpuScope} from './gpu.mjs';
import {cellWidth,fluxEquilibration} from '../../plugin.js';

export async function verifyFluxEquilibration(device){
  const gpu=gpuScope(device),dims=[12,7,5],n=dims.reduce((a,b)=>a*b),h=.003,dt=.0002;
  const axes=dims.map(n=>Float64Array.from({length:n+1},(_,i)=>h*i*(.75+.25*i/n)));
  const f={dims,h,axes,origin:[0,0,0],maxSpeed:2.3,pressureOpen:[false,true,false,false,false,false]},step=[1,12,84];
  const mu=new Float32Array(4*n),high=new Float32Array(8*n),low=new Float32Array(8*n);
  const at=(x,y,z)=>x+12*y+84*z,point=i=>[i%12,Math.floor(i/12)%7,Math.floor(i/84)];
  const pocket=at(3,2,2),solid=at(5,4,2);
  for(let i=0;i<n;i++){const p=point(i);mu[4*i+3]=i===solid?0:i===pocket?.004:.68+.03*(i%10);
    for(let a=0;a<3;a++){const j=i+step[a];
      const shut=i===solid||i===pocket||p[a]+1<dims[a]&&(j===pocket||j===solid);
      mu[4*i+a]=shut||a===0&&p[0]===6&&(p[1]!==3||p[2]!==2)?0:.58+.02*((i+a)%19);
      if(p[a]+1<dims[a]&&mu[4*i+a]>0.){
        const tail=Math.fround(7e-10*Math.sin(i+3.7*a));low[8*i+a]=low[8*j+4+a]=tail;
      }
    }}
  // The stored pair must also retain a large, exactly solenoidal circulation.
  for(const [i,a,v] of [[at(8,2,2),0,.11],[at(9,2,2),1,.11],[at(8,3,2),0,-.11],[at(8,2,2),1,-.11]]){
    high[8*i+a]=high[8*(i+step[a])+4+a]=v;
  }
  try{
    const hi=gpu.buffer('CFD shared circulation',high),lo=gpu.buffer('CFD independent small defects',low);
    const tree=await fluxEquilibration(gpu,f,dt,gpu.buffer('CFD baffle and sealed pocket',mu),hi,lo);
    const scheduler={async perform(ops){const e=device.createCommandEncoder();for(const op of ops)op.encode(e);device.queue.submit([e.finish()]);}};
    const stage=gpu.staging('CFD independent discharge measurement',32*n);
    const refused=!(await tree.correct(scheduler,null,1e-15));
    const old=await gpu.read(lo,stage,8*n);const pristine=old.every((v,i)=>Object.is(v,low[i]));
    const accepted=await tree.correct(scheduler,null,1e-4);const a=await gpu.read(hi,stage,8*n),b=await gpu.read(lo,stage,8*n);
    const flow=k=>a[k]+b[k],initial=k=>high[k]+low[k];
    let initialDiv=0,divergence=0,unshared=0,leak=0,energy=0,peak=0,volume=0;
    for(let i=0;i<n;i++){
      const p=point(i),w=p.map((j,k)=>cellWidth(f,k,j)),V=w.reduce((a,b)=>a*b);
      volume+=V;let before=0,after=0;
      for(let d=0;d<3;d++){
        const k=8*i+d,j=i+step[d];before+=initial(k)-initial(k+4);after+=flow(k)-flow(k+4);
        if(p[d]+1<dims[d])unshared=Math.max(unshared,Math.abs(flow(k)-flow(8*j+4+d)));
        if(p[d]===0)leak=Math.max(leak,Math.abs(flow(k+4)));
        const boundary=p[d]+1===dims[d],open=boundary?Number(d===0):mu[4*i+d];
        const delta=flow(k)-initial(k);if(!open){leak=Math.max(leak,Math.abs(delta));continue;}
        const A=open*w[(d+1)%3]*w[(d+2)%3],dist=boundary?.5*w[d]:.5*(w[d]+cellWidth(f,d,p[d]+1));
        const du=delta/(f.maxSpeed*dt/h);energy+=du*du*dist/A;peak=Math.max(peak,Math.abs(du)/A);
      }
      if(mu[4*i+3]>0){const v=dt*V*mu[4*i+3];initialDiv=Math.max(initialDiv,Math.abs(before)/v);
        divergence=Math.max(divergence,Math.abs(after)/v);}
    }
    const relativeBoundError=Math.abs(tree.stats.maxAcceptedRelativeRmsPressureGradientBound/Math.sqrt(energy/volume)-1);
    const speedBoundError=Math.abs(tree.stats.maxAcceptedRelativeSpeed/peak-1);
    return {refused,pristine,applied:accepted,initialDiv,divergence,unshared,leak,relativeBoundError,speedBoundError,...tree.stats,
      pass:refused&&pristine&&accepted&&tree.stats.sealedUnreached===1&&initialDiv>1e-6&&divergence<1e-9&&
        unshared===0&&leak===0&&relativeBoundError<1e-4&&speedBoundError<1e-4};
  }finally{gpu.close();}
}
