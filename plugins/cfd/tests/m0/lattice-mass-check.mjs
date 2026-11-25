import {gpuScope} from './gpu.mjs';
import {momentSolver} from './mr-lbm.mjs';

// Advect an independently initialized density pulse through an open outlet
// with a density sponge. The two exchanges have different mechanisms. Their
// sum must equal the change measured directly from all conserved moments.
export async function verifyLatticeMass(device){
  const gpu=gpuScope(device),dims=[23,11,9],n=dims.reduce((a,b)=>a*b),h=.02,dt=.001,rho=1.2;
  try{
    const f={dims,h,rho,origin:[0,0,0],U:.5,maxSpeed:1,nu:.0008,rotor:false,sphere:true,omega:0,latticeMassAudit:true};
    const solver=await momentSolver(gpu,f,dt,gpu.buffer('CFD empty mass test domain',16*n),gpu.buffer('CFD axial impulse',4*n));
    const seed=new Float32Array(7*n),stage=gpu.staging('CFD independent bounded density',seed.byteLength);
    let initial=0;
    for(let i=0;i<n;i++){
      const x=i%dims[0],y=Math.floor(i/dims[0])%dims[1],z=Math.floor(i/(dims[0]*dims[1]));
      seed[7*i]=.006*Math.exp(-((x-21.4)**2+(y-5.2)**2+(z-4.1)**2)/3);
      seed[7*i+1]=(1+seed[7*i])*f.U*dt/h;initial+=seed[7*i];
    }
    device.queue.writeBuffer(solver.moments,0,seed);await solver.mass.measure(0);
    const cases=[];
    for(const steps of [7,16]){
      const e=device.createCommandEncoder();e.clearBuffer(solver.mass.exchanges);
      for(let i=0;i<steps;i++)solver.encode(e);device.queue.submit([e.finish()]);
      const balance=await solver.mass.measure(steps),state=await gpu.read(solver.moments,stage,7*n);let end=0;
      for(let i=0;i<n;i++)end+=state[7*i];
      const observed=(end-initial)*rho*h**3;
      cases.push({...balance,observed,relativeDensityMeasurementError:Math.abs(observed-balance.densityChangeKg)/Math.abs(observed)});
      initial=end;
    }
    const road=await momentSolver(gpu,{...f,movingRoad:true},dt,gpu.buffer('CFD unobstructed moving road',16*n),gpu.buffer('CFD road control',4*n));
    const e=device.createCommandEncoder();for(let i=0;i<4;i++)road.encode(e);device.queue.submit([e.finish()]);
    const roadState=await gpu.read(road.moments,stage,7*n);let roadVelocityError=0;
    for(let i=0;i<n;i++)roadVelocityError=Math.max(roadVelocityError,
      Math.hypot(roadState[7*i+1]/(1+roadState[7*i])-f.U*dt/h,roadState[7*i+2],roadState[7*i+3])/(f.U*dt/h));
    return {cases,roadVelocityError,pass:roadVelocityError<5e-6&&cases.every(s=>s.relativeDensityMeasurementError<2e-5&&s.relativeGlobalMassDefect<5e-8&&
      s.wallLeakageKg===0&&Math.abs(s.boundaryTransferKg)>1e-10&&Math.abs(s.spongeTransferKg)>1e-10)};
  }finally{gpu.close();}
}
