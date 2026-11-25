import {gpuScope} from './gpu.mjs';
import {momentSolver} from './mr-lbm.mjs';

// Couette flow between two off-lattice planes. The two wall distances use
// the two different interpolated-reflection stencils in the same experiment.
export async function verifyLatticeWall(device){
  const gpu=gpuScope(device),dims=[16,12,16],[nx,ny,nz]=dims,count=nx*ny*nz;
  const lower=1.2,upper=10.19,speed=.025,nu=.07,dt=1,measuredSteps=256;
  try{
    const walls=new Float32Array(4*count);
    for(let i=0;i<count;i++){
      const y=Math.floor(i/nx)%ny+.5,b=y-lower,t=upper-y;
      walls[4*i]=Math.min(b,t);walls[4*i+2]=b<t?0:speed;
    }
    const wall=gpu.buffer('CFD Couette wall distances',walls),force=gpu.buffer('CFD Couette axial impulse',4*count);
    const solver=await momentSolver(gpu,{dims,origin:[0,0,0],h:1,U:0,maxSpeed:speed,nu,sphere:true,
      interpolatedWall:true,periodicTangents:true},dt,wall,force);
    async function steps(n){
      for(let i=0;i<n;i+=24){
        const e=device.createCommandEncoder();for(let j=i;j<Math.min(n,i+24);j++)solver.encode(e);
        device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
      }
    }
    await steps(1400);
    const reset=device.createCommandEncoder();reset.clearBuffer(solver.loads);device.queue.submit([reset.finish()]);
    await steps(measuredSteps);
    const stage=gpu.staging('CFD measured lattice channel field',solver.moments.size);
    const field=await gpu.read(solver.moments,stage,7*count),loads=await gpu.read(solver.loads,stage,4*count);
    let maxVelocityError=0,mass=0,fluidCells=0,lowerShear=0,upperShear=0;
    for(let i=0;i<count;i++){
      const y=Math.floor(i/nx)%ny+.5;if(y<=lower||y>=upper)continue;
      const drho=field[7*i],velocity=field[7*i+3]/(1+drho),exact=speed*(y-lower)/(upper-lower);
      maxVelocityError=Math.max(maxVelocityError,Math.abs(velocity-exact)/speed);
      mass+=drho;fluidCells++;
      if(y<(lower+upper)/2)lowerShear+=loads[4*i+3];else upperShear+=loads[4*i+3];
    }
    const normalization=nx*nz*measuredSteps*nu*speed/(upper-lower);
    lowerShear/=normalization;upperShear/=normalization;
    const relativeMassDrift=mass/fluidCells;
    return {lowerFraction:.3,upperFraction:.69,maxVelocityError,lowerShear,upperShear,relativeMassDrift,
      pass:maxVelocityError<.01&&Math.abs(lowerShear-1)<.02&&Math.abs(upperShear+1)<.02&&Math.abs(relativeMassDrift)<.001};
  }finally{gpu.close();}
}
