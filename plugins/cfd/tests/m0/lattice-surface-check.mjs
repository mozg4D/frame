import {gpuScope} from './gpu.mjs';
import {latticeSurface} from './lattice-surface.mjs';
import {latticeWallMotion} from './lattice-motion.mjs';
import {momentSolver} from './mr-lbm.mjs';

// A zero-thickness plate deliberately has no negative fluid SDF samples.
// Reverse the second triangle. The material integral remains A n n^T. The
// rotating spatial samples must give the transformed area and centroid.
export async function verifyLatticeSurface(device){
  const gpu=gpuScope(device),h=.014,dt=.0007,dims=[24,24,24],origin=dims.map(x=>-x*h/2);
  const n=dims.reduce((x,y)=>x*y),centre=[.004,.032,-.015],normal=[.48,-.64,.6],u=[.8,.6,0],v=[-.36,.48,.8];
  const hw=.055,hh=.033,area=4*hw*hh,vertices=[];
  for(const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]])vertices.push(...centre.map((x,i)=>x+a*hw*u[i]+b*hh*v[i]));
  const point=(i,d,o,p)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))].map((j,k)=>o[k]+p*j);
  const rotate=(p,a)=>[p[0],Math.cos(a)*p[1]-Math.sin(a)*p[2],Math.sin(a)*p[1]+Math.cos(a)*p[2]];
  try{
    const coords=[0,1,2].map(a=>vertices.filter((_,j)=>j%3===a));
    const mesh={storage:'buffer',triangleCount:2,positions:gpu.buffer('CFD oblique sheet',Float32Array.from(vertices)),
      indices:gpu.buffer('CFD opposed winding',Uint32Array.from([0,1,2,0,3,2])),matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
      bounds:{min:coords.map(x=>Math.min(...x)),max:coords.map(x=>Math.max(...x))}};
    const band={dims:[16,16,16],h,origin},metric=gpu.buffer('CFD exterior samples',new Float32Array(4096).fill(-1));
    const surface=await latticeSurface(gpu,{h},{meshes:[mesh],assertCurrent(){}},band,metric);
    const stage=gpu.staging('CFD bounded surface control',Math.max(32*n,surface.table.size));
    function integrate(values,dims,origin,pitch,angle){
      const moment=Array(6).fill(0),first=[0,0,0],scale=pitch**3/h;
      for(let i=0;i<values.length/8;i++){
        const x=point(i,dims,origin,pitch),trace=values[8*i]+values[8*i+1]+values[8*i+2];
        for(let a=0;a<3;a++){moment[a]+=scale*values[8*i+a];moment[3+a]+=scale*values[8*i+4+a];first[a]+=scale*trace*x[a];}
      }
      const [a,b,c]=rotate(normal,angle),exact=[a*a,b*b,c*c,a*b,a*c,b*c],total=moment[0]+moment[1]+moment[2];
      return {areaError:Math.abs(total/area-1),tensorError:Math.hypot(...moment.map((v,i)=>v/area-exact[i])),
        centroidErrorCells:Math.hypot(...rotate(centre,angle).map((v,i)=>v-first[i]/total))/h};
    }
    const material=integrate(await gpu.read(surface.table,stage,surface.table.size/4),surface.dims,surface.origin,surface.spacing,0);
    const f={dims,h,origin,U:.54,maxSpeed:1,nu:1.7e-5,omega:7,rotor:true,sphere:true,latticeSurfaceWall:true};
    const latticeOrigin=origin.map(x=>x+.5*h),rotations=[];
    for(const angle of [.38,-.93]){
      const sample=await latticeWallMotion(gpu,{...f,omega:2*angle/dt},dt,band,metric,surface);
      const e=device.createCommandEncoder();sample.encode(e);device.queue.submit([e.finish()]);
      rotations.push(integrate(await gpu.read(sample.wall,stage,8*n),dims,latticeOrigin,h,angle));
    }
    const geom=await latticeWallMotion(gpu,f,dt,band,metric,surface),force=gpu.buffer('CFD plate axial impulse',4*n);
    const solver=await momentSolver(gpu,f,dt,geom.wall,force),zero=await momentSolver(gpu,f,dt,gpu.buffer('CFD absent plate',32*n),gpu.buffer('CFD control impulse',4*n));
    const e=device.createCommandEncoder();geom.encode(e);solver.encode(e);zero.encode(e);device.queue.submit([e.finish()]);
    const state=await gpu.read(solver.moments,stage,7*n),base=await gpu.read(zero.moments,stage,7*n);
    const ax=await gpu.read(force,stage,n),loads=await gpu.read(solver.loads,stage,4*n),wall=await gpu.read(geom.wall,stage,8*n);
    const fluid=[0,0,0,0],body=[0,0,0,0],expected=[0,0,0,0],unit=rotate(normal,f.omega*dt/2),nu=f.nu*dt/h**2;
    for(let i=0;i<n;i++){
      const [,y,z]=point(i,dims,latticeOrigin,h),sigma=wall[8*i]+wall[8*i+1]+wall[8*i+2];
      const change=[1,2,3].map(k=>state[7*i+k]-base[7*i+k]),reaction=[ax[i],loads[4*i+2],loads[4*i+3]];
      for(let k=0;k<3;k++){fluid[k]+=change[k];body[k]+=reaction[k];}
      fluid[3]+=y*change[2]-z*change[1];body[3]+=loads[4*i+1];
      if(sigma<=1e-8)continue;
      const slip=[f.U,z*f.omega,-y*f.omega].map(x=>x*dt/h),un=unit.reduce((a,x,k)=>a+x*slip[k],0);
      const tangent=slip.map((x,k)=>x-un*unit[k]),speed=Math.hypot(...tangent),height=Math.max(.5,Math.abs(wall[8*i+3]));
      let lo=0,hi=Math.sqrt(speed*height/nu)+1;
      for(let k=0;k<52;k++){const mid=(lo+hi)/2,x=.41*mid,yp=mid+(Math.expm1(Math.min(100,x))-x-x*x/2-x**3/6)/9.8;
        if(mid*yp>speed*height/nu)hi=mid;else lo=mid;}
      const rate=sigma*speed/((hi+lo)/2)**2;
      const applied=tangent.map((t,k)=>Math.min(1,sigma)*un*unit[k]+t*rate/(1+rate));
      for(let k=0;k<3;k++)expected[k]+=applied[k];expected[3]+=y*applied[2]-z*applied[1];
    }
    const error=(a,b)=>Math.max(...a.map((x,k)=>Math.abs(x-b[k])/Math.abs(expected[k])));
    const balanceError=error(body,fluid.map(x=>-x)),forcingError=error(body,expected);
    return {material,rotations,body,fluid,expected,balanceError,forcingError,pass:material.areaError<1e-5&&material.tensorError<2e-5&&
      material.centroidErrorCells<2e-5&&rotations.every(s=>s.tensorError<.025&&s.centroidErrorCells<.035)&&balanceError<4e-6&&forcingError<.002};
  }finally{gpu.close();}
}
