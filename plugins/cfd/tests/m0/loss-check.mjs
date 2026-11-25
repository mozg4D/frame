import {gpuScope,closestWallBins,cellCenter,volumeDissipation,surfaceLoss} from '../../plugin.js';

export async function verifyClosestWallBins(device){
  const gpu=gpuScope(device),dims=[24,16,8],n=dims.reduce((a,b)=>a*b);
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>.002*i*(1+.019*(a+1)*i)));
  const f={dims,axes,h:.002,origin:[0,0,0]},seed=[3,22,59,108,194,298,403,714,893,1588,1745,2052,2777,3021];
  const grid=i=>[i%dims[0],Math.floor(i/dims[0])%dims[1],Math.floor(i/(dims[0]*dims[1]))];
  const point=i=>grid(i).map((v,a)=>cellCenter(f,a,v));
  const distance=(p,q)=>p.reduce((s,v,i)=>s+(v-q[i])**2,0);
  try{
    const input=new Uint32Array(n);for(const i of seed)input[i]=i+1;
    const op=await closestWallBins(gpu,f,gpu.buffer('CFD manufactured surface sites',input));
    const e=device.createCommandEncoder();op.encode(e);device.queue.submit([e.finish()]);
    const read=await gpu.read(op.nearest,gpu.staging('CFD checked nearest wall bins',4*n),n);
    const nearest=new Uint32Array(read.buffer),choices=seed.map(point);let maxErrorM2=0,missing=0;
    for(let i=0;i<n;i++){
      const p=point(i),j=seed.indexOf(nearest[i]-1);
      if(j<0){missing++;continue;}
      maxErrorM2=Math.max(maxErrorM2,distance(p,choices[j])-Math.min(...choices.map(q=>distance(p,q))));
    }
    return {cells:n,seeds:seed.length,maxErrorM2,missing,pass:missing===0&&maxErrorM2<1e-10};
  }finally{gpu.close();}
}

// Independent affine strain, solid-body rotation and closed surface allocation.
export async function verifyDissipation(device){
  const gpu=gpuScope(device),display={gpu,chunks:[{}]},dims=[8,8,8],n=512,h=.003,dt=.0008;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(1+.025*(a+1)*i)));
  const f={dims,h,axes,origin:[0,0,0],rho:998.2,nu:1.05e-6,U:2,maxSpeed:2};
  const point=i=>[i%8,Math.floor(i/8)%8,Math.floor(i/64)].map((v,a)=>cellCenter(f,a,v));
  const mobility=gpu.buffer('CFD manufactured fluid apertures',new Float32Array(4*n).fill(1));
  const shear=37,spin=16,nut=7e-6;
  const volume=axes.reduce((p,a)=>p*(a.at(-1)-a[0]),1);
  try{
    const samples=[];
    for(const [rate,eddy] of [[shear,0],[shear,nut],[0,nut]]){
      const cells=new Float32Array(n*8),total=gpu.buffer('CFD test loss sum',4*n);
      for(let i=0;i<n;i++){
        const [x,y,z]=point(i);
        cells.set([(rate*y-spin*y)*dt/h,spin*x*dt/h,0,0,0,eddy*dt/h**2,0,0],8*i);
      }
      const update=await volumeDissipation(gpu,{...f,laminar:eddy===0},dt,gpu.buffer('CFD affine velocity',cells),mobility,total);
      const e=device.createCommandEncoder();update(e);device.queue.submit([e.finish()]);
      const watts=(await gpu.read(total,gpu.staging('CFD independent cell wattage',4*n),n)).reduce((a,b)=>a+b,0);
      const exact=f.rho*(f.nu+eddy)*rate**2*volume;
      samples.push({rate,eddy,watts,exact,error:Math.abs(watts-exact)/Math.max(1e-12,exact)});
    }
    const anchors=[2,2,383],areas=[.003,.007,.008],site=new Float32Array(3*3*16);
    for(let i=0;i<3;i++)for(let q=0;q<3;q++){
      const offset=16*(3*i+q);site.set([...point(anchors[i]),areas[i]/3,1,0,0,0],offset);
    }
    const chunk={triangles:3,site:gpu.buffer('CFD uneven quadrature sites',site)};
    const losses=await surfaceLoss(gpu,display,f,dt,[chunk],mobility),sources=[1,4,447],watts=[2,3,12];
    // Two sources belong to the coincident seeds, the third is in the wake near the remote seed.
    const deposited=Float32Array.from({length:n},(_,i)=>watts[sources.indexOf(i)]??0);
    let expected=[0,0,0];
    for(let k=0;k<sources.length;k++){
      const ds=anchors.map(a=>Math.hypot(...point(a).map((x,j)=>x-point(sources[k])[j])));
      if(ds[0]<ds[2]){expected[0]+=watts[k]*.3;expected[1]+=watts[k]*.7;}else expected[2]+=watts[k];
    }
    const windows=[];
    for(const [steps,accumulatedSteps,multiplier,force] of [[3,3,1,8.5],[5,8,2,12.5],[2,7,3,-.2]]){
      device.queue.writeBuffer(losses.current,0,deposited.map(v=>v*steps*multiplier));
      const report=await losses.publish(accumulatedSteps,true,force,()=>{});
      const data=await gpu.read(display.chunks[0].loss,gpu.staging('CFD integrated independent surface observations',48),12);
      const multiplierMean=windows.length===0?1:windows.length===1?13/8:16/7;
      const power=[0,1,2].reduce((s,i)=>s+data[4*i+1],0);
      const integral=[0,1,2].reduce((s,i)=>s+areas[i]*data[4*i],0);
      const shareError=Math.max(...expected.map((w,i)=>Math.abs(data[4*i+1]-w*multiplierMean)));
      windows.push({report,power,integral,shareError,pass:Math.abs(power-report.attributedPowerW)<1e-5&&
        Math.abs(integral-(force>=0?force:power))<1e-5&&shareError<2e-5&&report.unit===(force>=0?'N/m2':'W/m2')});
    }
    return {samples,windows,pass:samples.every(s=>s.exact?s.error<5e-6:s.watts<1e-16)&&windows.every(w=>w.pass)};
  }finally{gpu.close();}
}
