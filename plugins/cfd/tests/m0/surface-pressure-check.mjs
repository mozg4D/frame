import {gpuScope} from './gpu.mjs';
import {surfacePressure} from './surface-pressure.mjs';

// The wrench of a linear pressure on a closed solid follows directly from
// its physical volume and centroid. Alternate triangle winding and poison
// non-fluid pressure values so a wrong side cannot pass by symmetry.
export async function verifySurfacePressure(device){
  const gpu=gpuScope(device);
  try{
    const f={dims:[24,24,24],h:.012,origin:[-.14,-.12,-.16]},centre=[.011,.034,-.024],half=[.029,.017,.021];
    const az=.35,ax=.22,cz=Math.cos(az),sz=Math.sin(az),cx=Math.cos(ax),sx=Math.sin(ax);
    const basis=[[cz,sz,0],[-sz*cx,cz*cx,sx],[sz*sx,-cz*sx,cx]],slope=[11,-23,44];
    const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
    function signed(x){const relative=x.map((v,i)=>v-centre[i]),q=basis.map((b,i)=>Math.abs(dot(b,relative))-half[i]);
      return Math.hypot(...q.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...q));}
    const position=i=>centre.map((v,k)=>v+basis.reduce((s,b,j)=>s+b[k]*half[j]*(i&(1<<j)?1:-1),0));
    const vertices=Float32Array.from(Array.from({length:8},(_,i)=>position(i)).flat()),indices=[];
    for(let j=0;j<3;j++)for(let side=0;side<2;side++){
      const a=side<<j,b=1<<((j+1)%3),c=1<<((j+2)%3);
      indices.push(a,a|b,a|b|c,a,a|c,a|b|c);
    }
    const mesh={storage:'buffer',triangleCount:12,positions:gpu.buffer('CFD oblique box vertices',vertices),
      indices:gpu.buffer('CFD inconsistent test triangle winding',Uint32Array.from(indices)),matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
    const count=d=>d.reduce((a,b)=>a*b),point=(d,i)=>[i%d[0],Math.floor(i/d[0])%d[1],Math.floor(i/(d[0]*d[1]))];
    const band={origin:[-.07,-.045,-.1],h:.0025,dims:[66,66,66]};
    const distances=Float32Array.from({length:count(band.dims)},(_,i)=>-signed(point(band.dims,i).map((v,k)=>band.origin[k]+v*band.h))/band.h);
    const mu=new Float32Array(count(f.dims)*4),values=new Float32Array(count(f.dims));
    for(let i=0;i<values.length;i++){
      const x=point(f.dims,i).map((v,k)=>f.origin[k]+(v+.5)*f.h),full=signed(x)>.5*Math.sqrt(3)*f.h;
      mu[4*i+3]=Number(full);values[i]=full?37+dot(slope,x):1e5;
    }
    const sampler=await surfacePressure(gpu,f,{meshes:[mesh],assertCurrent(){}},band,
      gpu.buffer('CFD analytic signed distance',distances),gpu.buffer('CFD independent liquid mask',mu));
    const source=gpu.buffer('CFD manufactured pressure',values),encode=sampler.bind(source);
    const command=device.createCommandEncoder();encode(command);device.queue.submit([command.finish()]);
    const estimate=await sampler.measure(1,3),V=8*count(half),A=8*(half[0]*half[1]+half[0]*half[2]+half[1]*half[2]);
    const force=slope.map(v=>-V*v),torque=centre[1]*force[2]-centre[2]*force[1];
    const forceRelativeError=Math.hypot(...estimate.pressureForceN.map((v,i)=>v-force[i]))/Math.hypot(...force);
    const torqueRelativeError=Math.abs(estimate.pressureTorqueXNm/torque-1),areaRelativeError=Math.abs(estimate.sampledAreaM2/A-1);
    return {estimate,expectedForceN:force,expectedTorqueXNm:torque,forceRelativeError,torqueRelativeError,areaRelativeError,
      pass:forceRelativeError<.001&&torqueRelativeError<.002&&areaRelativeError<2e-6&&Math.hypot(...estimate.areaVectorM2)<1e-7*A};
  }finally{gpu.close();}
}
