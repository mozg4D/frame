import {gpuScope} from './gpu.mjs';
import {cartesianSolver} from './fvm.mjs';

// The pressure reservoirs have equal pressure and the perturbation is supported
// away from the outer boundary. Total Cartesian fluid impulse lost in the first
// step must equal the reported body reaction, including tangential components.
export async function verifyMomentum(device){
  const gpu=gpuScope(device),dims=[32,8,8],count=dims.reduce((a,b)=>a*b);
  const h=.004,dt=.0004;
  const fixture={name:'momentum',dims,h,origin:[0,0,0],maxSpeed:1,U:0,omega:0,
    nu:1.5e-5,sphere:true,rotor:false,pressureOpen:[true,true,true,true,true,true]};
  try{
    const material=new Float32Array(4*count),wall=new Float32Array(4*count),initial=new Float32Array(8*count);
    const before=[0,0,0];
    const mobile=d=>Math.max(0,Math.min(1,d+.5));
    for(let i=0;i<count;i++){
      const x=i%32,y=(i>>5)%8,z=i>>8;
      const distance=(a,b,c)=>Math.hypot(a-14.2,b-3.2,c-4.1)-2.1;
      const d=distance(x,y,z);wall.set([d,0,0,1-mobile(d)],4*i);
      material.set([mobile(distance(x+.5,y,z)),mobile(distance(x,y+.5,z)),mobile(distance(x,y,z+.5)),mobile(d)],4*i);
      const bump=Math.max(0,1-Math.hypot(x-12.5,y-3.5,z-3.5)/2.4);
      initial.set([.067*bump,-.021*bump,.041*bump,.00001,.02,0,0,0],8*i);
      for(let axis=0;axis<3;axis++)before[axis]+=initial[8*i+axis];
    }
    const force=gpu.buffer('CFD independently balanced impulse',4*count);
    const solver=await cartesianSolver(gpu,fixture,dt,gpu.buffer('CFD test wall',wall),force,gpu.buffer('CFD test face mobility',material));
    device.queue.writeBuffer(solver.state,0,initial);solver.step(0,false);
    const stage=gpu.staging('CFD control volume readback',32*count);
    const after=await gpu.read(solver.state,stage,8*count),axial=await gpu.read(force,stage,count),other=await gpu.read(solver.loads,stage,4*count);
    const fluidChange=[0,0,0],reaction=[0,0,0];
    for(let i=0;i<count;i++){
      for(let k=0;k<3;k++)fluidChange[k]+=initial[8*i+k]-after[8*i+k];
      reaction[0]+=axial[i];reaction[1]+=other[4*i+2];reaction[2]+=other[4*i+3];
    }
    const relativeError=reaction.map((v,k)=>Math.abs((v-fluidChange[k])/before[k]));
    return {fixture:'localized velocity beside a stationary immersed body',initialMomentum:before,fluidMomentumLoss:fluidChange,bodyImpulse:reaction,relativeError,
      pass:relativeError.every(v=>v<2e-6)&&reaction.every(v=>Math.abs(v)>.001)};
  }finally{gpu.close();}
}
