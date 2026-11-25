import {gpuScope} from './gpu.mjs';
import {momentSolver} from './mr-lbm.mjs';
import {latticeWallMotion} from './lattice-motion.mjs';

export async function verifyLatticeMotion(device){
  const gpu=gpuScope(device),dims=[16,16,16],h=.02,dt=.001,origin=[-.16,-.16,-.16];
  const count=dims.reduce((a,b)=>a*b),band={origin:[-.22,-.22,-.22],h:.01,dims:[45,45,45]};
  const position=(i,d,o,p)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))].map((x,k)=>o[k]+p*x);
  const centre=[.025,.075,-.035],radius=.042,sphere=x=>Math.hypot(...x.map((v,k)=>v-centre[k]))-radius;
  const points=Array.from({length:count},(_,i)=>position(i,dims,origin.map(x=>x+.5*h),h));
  try{
    const source=Float32Array.from({length:45**3},(_,i)=>-sphere(position(i,band.dims,band.origin,band.h))/band.h);
    const metric=gpu.buffer('CFD sampled material sphere',source),stage=gpu.staging('CFD bounded lattice motion reference',28*count);
    const controls=[];
    for(const sign of [1,-1]){
      // A deliberately large phase separates the original and the rotated
      // wall. Compare independently at both midpoints of successive steps.
      const angle=sign*Math.PI/2;
      const geometry=await latticeWallMotion(gpu,{dims,h,origin,rotor:true,omega:angle/dt},dt,band,metric);
      let maxDistanceErrorM=0,maxWallVelocityError=0,wrongSigns=0;
      for(let t=0;t<2;t++){
        const e=device.createCommandEncoder();geometry.encode(e);device.queue.submit([e.finish()]);
        const wall=await gpu.read(geometry.wall,stage,4*count),a=(t+.5)*angle,cs=Math.cos(a),sn=Math.sin(a);
        for(const [i,[x,y,z]] of points.entries()){
          const d=sphere([x,cs*y+sn*z,cs*z-sn*y]);if(Math.abs(d)>2*h)continue;
          maxDistanceErrorM=Math.max(maxDistanceErrorM,Math.abs(wall[i*4]*h-d));
          if(Math.abs(d)>.0015&&Math.sign(d)!==Math.sign(wall[4*i]))wrongSigns++;
          maxWallVelocityError=Math.max(maxWallVelocityError,Math.abs(wall[4*i+1]+z*angle/h),Math.abs(wall[4*i+2]-y*angle/h));
        }
      }
      // Difference of two actual packed fluid states after a common incoming
      // stream. The independent angular integral includes each physical arm.
      const omega=sign*8,U=.5,maxSpeed=1.2,walls=new Float32Array(count*4);
      for(const [i,[x,y,z]] of points.entries()){
        const d=sphere([x,y,z]);walls.set([d/h,-omega*z*dt/h,omega*y*dt/h,Math.min(1,Math.max(0,.5-d/h))],4*i);
      }
      const fixture={dims,h,origin,U,maxSpeed,nu:.02,rotor:true,sphere:true,omega};
      const force=gpu.buffer('CFD test axial body impulse',4*count),empty=gpu.buffer('CFD unforced lattice wall',16*count);
      const active=await momentSolver(gpu,fixture,dt,gpu.buffer('CFD moving wall',walls),force);
      const control=await momentSolver(gpu,fixture,dt,empty,gpu.buffer('CFD unforced impulse',4*count));
      const e=device.createCommandEncoder();active.encode(e);control.encode(e);device.queue.submit([e.finish()]);
      const actual=await gpu.read(active.moments,stage,7*count),free=await gpu.read(control.moments,stage,7*count);
      const axial=await gpu.read(force,stage,count),loads=await gpu.read(active.loads,stage,4*count);
      const fluid=[0,0,0,0],body=[0,0,0,0],analytic=[0,0,0,0];let massChange=0;
      for(const [i,[,y,z]] of points.entries()){
        const d=[1,2,3].map(k=>actual[7*i+k]-free[7*i+k]),damping=-Math.expm1(-10*maxSpeed*dt/h*walls[4*i+3]);
        const v=[U*dt/h,-walls[4*i+1],-walls[4*i+2]].map(v=>v*damping);
        massChange+=actual[7*i]-free[7*i];
        const change=[...d,y*d[2]-z*d[1]],record=[axial[i],loads[4*i+2],loads[4*i+3],loads[4*i+1]],known=[...v,y*v[2]-z*v[1]];
        for(let k=0;k<4;k++){fluid[k]+=change[k];body[k]+=record[k];analytic[k]+=known[k];}
      }
      const scale=analytic.map(Math.abs),reactionError=Math.max(...body.map((v,k)=>Math.abs(v-analytic[k])/scale[k]));
      const balanceError=Math.max(...body.map((v,k)=>Math.abs(v+fluid[k])/scale[k]));
      controls.push({sign,maxDistanceErrorM,maxWallVelocityError,wrongSigns,body,fluid,reactionError,balanceError,massChange});
    }
    return {controls,pass:controls.every(c=>c.maxDistanceErrorM<.0016&&c.maxWallVelocityError<3e-6&&!c.wrongSigns&&
      c.reactionError<5e-6&&c.balanceError<5e-6&&Math.abs(c.massChange)<1e-8)};
  }finally{gpu.close();}
}
