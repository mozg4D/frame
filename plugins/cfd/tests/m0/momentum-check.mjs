import {gpuScope} from './gpu.mjs';
import {cartesianSolver} from './fvm.mjs';
import {cellWidth} from './rectilinear.mjs';

// The pressure reservoirs have equal pressure and the perturbation is supported
// away from the outer boundary. Total Cartesian fluid impulse lost in the first
// step must equal the reported body reaction, including tangential components.
export async function verifyMomentum(device,graded=false){
  const gpu=gpuScope(device),dims=[32,8,8],count=dims.reduce((a,b)=>a*b);
  const h=.004,dt=.0004;
  const axes=graded?dims.map(d=>Float64Array.from({length:d+1},(_,i)=>h*i*(.7+.3*i/d))):undefined;
  const fixture={name:'momentum',dims,axes,h,origin:[0,0,0],maxSpeed:1,U:0,omega:0,
    nu:1.5e-5,sphere:true,rotor:false,pressureOpen:[true,true,true,true,true,true]};
  try{
    const material=new Float32Array(4*count),wall=new Float32Array(4*count),initial=new Float32Array(8*count);
    const before=[0,0,0],volumes=new Float64Array(count);
    const mobile=d=>Math.max(0,Math.min(1,d+.5));
    for(let i=0;i<count;i++){
      const x=i%32,y=(i>>5)%8,z=i>>8;
      volumes[i]=cellWidth(fixture,0,x)*cellWidth(fixture,1,y)*cellWidth(fixture,2,z);
      const distance=(a,b,c)=>Math.hypot(a-14.2,b-3.2,c-4.1)-2.1;
      const d=distance(x,y,z);wall.set([d,0,0,1-mobile(d)],4*i);
      material.set([mobile(distance(x+.5,y,z)),mobile(distance(x,y+.5,z)),mobile(distance(x,y,z+.5)),mobile(d)],4*i);
      const bump=Math.max(0,1-Math.hypot(x-12.5,y-3.5,z-3.5)/2.4);
      initial.set([.067*bump,-.021*bump,.041*bump,.00001,.02,0,0,0],8*i);
      for(let axis=0;axis<3;axis++)before[axis]+=volumes[i]*initial[8*i+axis];
    }
    const force=gpu.buffer('CFD independently balanced impulse',4*count);
    const solver=await cartesianSolver(gpu,fixture,dt,gpu.buffer('CFD test wall',wall),force,gpu.buffer('CFD test face mobility',material));
    device.queue.writeBuffer(solver.state,0,initial);solver.step(0,false);
    const stage=gpu.staging('CFD control volume readback',32*count);
    const after=await gpu.read(solver.state,stage,8*count),axial=await gpu.read(force,stage,count),other=await gpu.read(solver.loads,stage,4*count);
    const fluidChange=[0,0,0],reaction=[0,0,0];
    for(let i=0;i<count;i++){
      for(let k=0;k<3;k++)fluidChange[k]+=volumes[i]*(initial[8*i+k]-after[8*i+k]);
      reaction[0]+=axial[i];reaction[1]+=other[4*i+2];reaction[2]+=other[4*i+3];
    }
    const relativeError=reaction.map((v,k)=>Math.abs((v-fluidChange[k])/before[k]));
    const faces=await gpu.read(solver.flux,stage,8*count),tail=await gpu.read(solver.fluxTail,stage,8*count);
    let maxRawImbalance=0,maxCorrectedImbalance=0,maxPairMismatch=0;
    for(let i=0;i<count;i++){
      let raw=0,balance=0;const point=[i%32,(i>>5)%8,i>>8];
      for(let k=0;k<3;k++){
        const a=8*i+k,b=a+4;raw+=faces[a]-faces[b];balance+=(faces[a]+tail[a])-(faces[b]+tail[b]);
        if(point[k]+1<dims[k]){const other=b+8*[1,32,256][k];maxPairMismatch=Math.max(maxPairMismatch,Math.abs((faces[a]+tail[a])-(faces[other]+tail[other])));}
      }
      maxRawImbalance=Math.max(maxRawImbalance,Math.abs(raw)/volumes[i]);maxCorrectedImbalance=Math.max(maxCorrectedImbalance,Math.abs(balance)/volumes[i]);
    }
    return {fixture:'localized velocity beside a stationary immersed body',initialMomentum:before,fluidMomentumLoss:fluidChange,bodyImpulse:reaction,relativeError,
      maxRawImbalance,maxCorrectedImbalance,maxPairMismatch,
      pass:relativeError.every(v=>v<2e-6)&&reaction.every(v=>Math.abs(v)>.001)&&maxPairMismatch===0&&maxCorrectedImbalance<1e-9};
  }finally{gpu.close();}
}
