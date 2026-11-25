import {gpuScope} from './gpu.mjs';
import {outerTransport} from './outer-transport.mjs';

// Solve independent forward/backward constant-throughput rows in Float64.
// Compare all three momentum components, k, omega and the total budget.
export async function verifyOuterTransport(device){
  const gpu=gpuScope(device),dims=[32,8,8],n=dims.reduce((a,b)=>a*b);
  const f={dims,h:1,origin:[0,6,6],implicitRadiusM:1,U:.08,maxSpeed:.3,nu:.04};
  const dt=1,k=1.5*(.005*f.maxSpeed)**2,ambient=[f.U,0,0,k,k/(5*f.nu)];
  const initial=new Float32Array(n*8),fluxes=new Float32Array(n*8);
  for(let i=0;i<n;i++){
    const j=i%dims[0],wave=.5+.4*Math.sin(.67*j);
    initial.set([.1+.07*wave,.3*wave-.13,.02+.11*wave,k*(1.+wave),ambient[4]*(2.-wave),0,0,0],8*i);
  }
  try{
    const pred=gpu.buffer('CFD implicit row RHS',initial),high=gpu.buffer('CFD implicit row face flow',fluxes.byteLength);
    const low=gpu.buffer('CFD implicit row flow tail',fluxes.byteLength),stage=gpu.staging('CFD implicit row solution',pred.size);
    const solver=await outerTransport(gpu,f,dt,pred,high,low),cases=[];
    const scheduler={async perform(ops){const e=device.createCommandEncoder();for(const op of ops)op.encode(e);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();}};
    for(const courant of [3.25,-4.75]){
      const reverse=courant<0,rate=Math.abs(courant),exact=new Float64Array(5*dims[0]);let upstream=ambient;
      for(let j=0;j<dims[0];j++){
        const x=reverse?dims[0]-j-1:j;
        const next=upstream.map((v,a)=>(initial[8*x+a]+rate*v)/(1.+rate));
        exact.set(next,5*x);upstream=next;
      }
      for(let i=0;i<n;i++){fluxes[8*i]=courant;fluxes[8*i+4]=courant;}
      device.queue.writeBuffer(high,0,fluxes);device.queue.writeBuffer(pred,0,initial);
      await solver.solve(scheduler);
      const field=await gpu.read(pred,stage,initial.length),change=[0,0,0,0,0];
      let maxError=0;
      const scales=[f.maxSpeed,f.maxSpeed,f.maxSpeed,k,ambient[4]];
      for(let i=0;i<n;i++)for(let a=0;a<5;a++){
        maxError=Math.max(maxError,Math.abs(field[8*i+a]-exact[5*(i%dims[0])+a])/scales[a]);
        change[a]+=field[8*i+a]-initial[8*i+a];
      }
      const imbalance=Math.max(...change.map((x,a)=>Math.abs(x/(dims[1]*dims[2])+rate*(upstream[a]-ambient[a]))/scales[a]));
      cases.push({courant,maxError,imbalance});
    }
    return {cases,...solver.stats,pass:cases.every(c=>c.maxError<5e-5&&c.imbalance<5e-5)};
  }finally{gpu.close();}
}
