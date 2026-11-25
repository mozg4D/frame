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
    let batches=0;
    const scheduler={async perform(ops){
      const e=device.createCommandEncoder();for(const op of ops)op.encode(e);
      device.queue.submit([e.finish()]);batches++;
    }};
    const stage=gpu.staging('CFD independent discharge measurement',32*n);
    const refused=!(await tree.correct(scheduler,null,1e-15));
    const rejectedBatches=batches;
    const unchanged=async(x,y)=>(await gpu.read(hi,stage,8*n)).every((v,i)=>Object.is(v,x[i]))&&
      (await gpu.read(lo,stage,8*n)).every((v,i)=>Object.is(v,y[i]));
    const reset=()=>{device.queue.writeBuffer(hi,0,high);device.queue.writeBuffer(lo,0,low);};
    const pristine=await unchanged(high,low);
    const accepted=await tree.correct(scheduler,null,1e-4);const a=await gpu.read(hi,stage,8*n),b=await gpu.read(lo,stage,8*n);
    const acceptedBatches=batches-rejectedBatches;
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
    // Both thresholds round to the same FP32 number. The smaller FP64 limit
    // must still reject, even after a successful earlier reconstruction.
    const bound=Math.max(tree.stats.maxAcceptedRelativeSpeed,tree.stats.maxAcceptedRelativeRmsPressureGradientBound);
    const below=bound*(1-1e-9);reset();
    const nearRefused=Math.fround(below)===bound&&!await tree.correct(scheduler,null,below)&&await unchanged(high,low);
    const onBound=await tree.correct(scheduler,null,bound)&&await unchanged(a,b);
    reset();const zeroRefused=!await tree.correct(scheduler,null,-0)&&await unchanged(high,low);
    await scheduler.perform(tree.replay);const replayExact=await unchanged(a,b);
    // Read a changed low word from inside the same batch. An early measurement
    // would observe its original value even when the final field was correct.
    reset();const sampleIndex=b.findIndex((v,i)=>v!==low[i]);
    const beforeMeasured=batches;
    const measured=sampleIndex<0?null:await tree.correctMeasured(scheduler,null,(e,destination,offset)=>{
      e.copyBufferToBuffer(lo,4*sampleIndex,destination,offset,4);
    });
    const measuredBatches=batches-beforeMeasured;
    const capturedAfterWrite=measured?.accepted&&Object.is(measured.mass,b[sampleIndex])&&await unchanged(a,b);
    return {refused,pristine,applied:accepted,initialDiv,divergence,unshared,leak,relativeBoundError,speedBoundError,
      rejectedBatches,acceptedBatches,measuredBatches,nearRefused,onBound,zeroRefused,replayExact,capturedAfterWrite,...tree.stats,
      pass:refused&&pristine&&accepted&&nearRefused&&onBound&&zeroRefused&&replayExact&&capturedAfterWrite&&
        [rejectedBatches,acceptedBatches,measuredBatches].every(v=>v===1)&&
        tree.stats.subtreeMethod==='depth ordering'&&tree.stats.sealedUnreached===1&&initialDiv>1e-6&&divergence<1e-9&&
        unshared===0&&leak===0&&relativeBoundError<1e-4&&speedBoundError<1e-4};
  }finally{gpu.close();}
}

// Two large pressure components have separate one-cell openings. A sealed
// pocket has no path to either outlet. The larger tree crosses three levels
// of block prefixes. A large circulation coexists with small face defects.
export async function verifyPrefixForest(device){
  const gpu=gpuScope(device),dims=[64,32,16],[nx,ny,nz]=dims,n=nx*ny*nz,pitch=.004,dt=.0005;
  const strides=[1,nx,nx*ny],point=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];
  const at=(x,y,z)=>x+nx*(y+ny*z),pocket=at(5,2,4),solid=at(22,8,7);
  const wet=(x,y,z)=>x<nx-2||z===1&&(y===1||y===ny-2);
  const mu=new Float32Array(4*n),high=new Float32Array(8*n),low=new Float32Array(8*n);
  for(let i=0;i<n;i++){
    const p=point(i);if(!wet(...p)||i===solid)continue;mu[4*i+3]=i===pocket?.006:.8+.015*(i%11);
    for(let a=0;a<3;a++){
      const q=p.slice();q[a]++;
      if(q[a]===dims[a])continue;
      const other=i+strides[a];if(!wet(...q)||[pocket,solid].includes(i)||[pocket,solid].includes(other)||a===1&&p[1]===24)continue;
      mu[4*i+a]=.70+.02*((i+a)%13);
      const fluct=Math.fround(2e-8*Math.sin(.17*i+1.7*a));
      low[8*i+a]=low[8*other+4+a]=fluct;
    }
  }
  for(let z=1;z<nz-1;z+=3)for(let x=2;x<nx-5;x+=4){
    for(const [i,a,d] of [[at(x,12,z),0,.3125],[at(x+1,12,z),1,.3125],[at(x,13,z),0,-.3125],[at(x,12,z),1,-.3125]]){
      high[8*i+a]=high[8*(i+strides[a])+4+a]=d;
    }
  }
  const f={dims,h:pitch,origin:[0,0,0],maxSpeed:2,pressureOpen:[false,true,false,false,false,false]};
  const scheduler={async perform(ops){const e=device.createCommandEncoder();for(const op of ops)op.encode(e);device.queue.submit([e.finish()]);}};
  try{
    const m=gpu.buffer('Two open chambers and a closed pocket',mu),stage=gpu.staging('Independent stored face check',32*n),runs=[];
    let reference=null;
    for(const prefixForest of [false,true,undefined]){
      const hi=gpu.buffer('Solenoidal face circulation',high),lo=gpu.buffer('Shared cancellation residual',low);
      const started=performance.now();const tree=await fluxEquilibration(gpu,{...f,prefixForest},dt,m,hi,lo);
      const setupMs=performance.now()-started;const refused=!await tree.correct(scheduler,null,1e-14);
      const unchanged=(await gpu.read(lo,stage,low.length)).every((v,i)=>v===low[i]);
      if(!await tree.correct(scheduler,null,1e-3))throw Error('Small physically bounded flux correction was refused');
      const h=await gpu.read(hi,stage,high.length),l=await gpu.read(lo,stage,low.length),flow=Float64Array.from(h,(x,i)=>x+l[i]);
      let divergence=0,unshared=0,closedFlow=0,referenceDifference=0;
      for(let i=0;i<n;i++){
        const p=point(i);let balance=0;
        for(let a=0;a<3;a++){
          const k=8*i+a,v=flow[k],w=flow[k+4];balance+=v-w;
          if(p[a]+1<dims[a]){unshared=Math.max(unshared,Math.abs(v-flow[8*(i+strides[a])+4+a]));
            if(mu[4*i+a]===0)closedFlow=Math.max(closedFlow,Math.abs(v));}
          else if(a!==0||mu[4*i+3]===0)closedFlow=Math.max(closedFlow,Math.abs(v));
          if(p[a]===0)closedFlow=Math.max(closedFlow,Math.abs(w));
          if(reference)referenceDifference=Math.max(referenceDifference,Math.abs(v-reference[k]),Math.abs(w-reference[k+4]));
        }
        if(mu[4*i+3]>0)divergence=Math.max(divergence,Math.abs(balance)/(dt*mu[4*i+3]));
      }
      reference??=flow;
      runs.push({selection:prefixForest===undefined?'automatic':prefixForest?'prefix':'depth',setupMs,divergence,unshared,closedFlow,referenceDifference,refused,unchanged,...tree.stats});
    }
    const [depth,prefix,automatic]=runs,ok=r=>r.refused&&r.unchanged&&r.accepted===1&&r.sealedUnreached===1&&r.divergence<1e-8&&r.unshared===0&&r.closedFlow===0;
    return {pass:runs.every(ok)&&prefix.largestRootCells>128**2&&depth.levels===prefix.levels&&depth.reached===prefix.reached&&
      [prefix,automatic].every(r=>r.subtreeMethod==='contiguous subtree intervals'&&r.referenceDifference<2e-11&&r.subtreeDispatches===5)&&
      depth.subtreeMethod==='depth ordering'&&depth.subtreeDispatches>80,dims,runs};
  }finally{gpu.close();}
}

// Three chambers share the same mesh. Each wall is impermeable; only the
// rightmost chamber can reach an outlet. A sealed chamber can carry both
// circulation and a pressure defect, but cannot sustain a net mass source.
export async function verifySealedPressure(device){
  const dims=[24,12,8],[nx,ny,nz]=dims,n=nx*ny*nz,h=.003,dt=.00021;
  const stride=[1,nx,nx*ny],at=(x,y,z)=>x+nx*(y+ny*z);
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(.73+.23*i/d+.04*a)));
  const f={dims,h,axes,origin:[0,0,0],maxSpeed:3,period:.12};
  const mu=new Float32Array(4*n),high=new Float32Array(8*n),low=new Float32Array(8*n);
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const p=[x,y,z],i=at(x,y,z);
    mu[4*i+3]=x%5===0?.0008:.74+.01*(i%23);
    for(let a=0;a<3;a++){
      if(p[a]+1===dims[a]||a===0&&(x===7||x===15))continue;
      mu[4*i+a]=.55+.01*((i+a)%41);
      low[8*i+a]=low[8*(i+stride[a])+4+a]=1.2e-8*Math.sin(i*1.9+a);
    }
  }
  for(const x of [2,11,18]){
    for(const [i,a,v] of [[at(x,4,3),0,.1875],[at(x+1,4,3),1,.1875],[at(x,5,3),0,-.1875],[at(x,4,3),1,-.1875]])
      high[8*i+a]=high[8*(i+stride[a])+4+a]=v;
  }
  const scheduler={async perform(ops){const e=device.createCommandEncoder();for(const op of ops)op.encode(e);device.queue.submit([e.finish()]);}};
  const runs=[];
  for(const closed of [false,true])for(const prefixForest of [false,true]){
    const gpu=gpuScope(device);
    try{
      const hi=gpu.buffer('Sealed loop momentum',high),lo=gpu.buffer('Small chamber discharges',low);
      const tree=await fluxEquilibration(gpu,{...f,prefixForest,pressureOpen:[false,!closed,false,false,false,false]},dt,
        gpu.buffer('Three fluid chambers',mu),hi,lo);
      const stage=gpu.staging('Independent chamber fluxes',32*n);
      const accepted=await tree.correct(scheduler,null,1e-4);
      const H=await gpu.read(hi,stage,8*n),L=await gpu.read(lo,stage,8*n);
      let maxDivergence=0,initialDivergence=0,wallFlow=0,sharedError=0,circulationChange=0;
      for(let i=0;i<n;i++){
        const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];let defect=0,initial=0;
        for(let a=0;a<3;a++){
          const k=8*i+a,v=H[k]+L[k],u=H[k+4]+L[k+4];defect+=v-u;
          initial+=(high[k]-high[k+4])+(low[k]-low[k+4]);
          if(high[k])circulationChange=Math.max(circulationChange,Math.abs(v-high[k]));
          if(p[a]+1<dims[a]){
            const other=8*(i+stride[a])+4+a;sharedError=Math.max(sharedError,Math.abs(v-(H[other]+L[other])));
            if(mu[4*i+a]===0)wallFlow=Math.max(wallFlow,Math.abs(v));
          }else if(closed||a!==0)wallFlow=Math.max(wallFlow,Math.abs(v));
          if(p[a]===0)wallFlow=Math.max(wallFlow,Math.abs(u));
        }
        const volume=p.reduce((v,j,a)=>v*cellWidth(f,a,j),dt*mu[4*i+3]);
        initialDivergence=Math.max(initialDivergence,Math.abs(initial)/volume);
        maxDivergence=Math.max(maxDivergence,Math.abs(defect)/volume);
      }
      // Impose a unilateral inlet flux in a sealed chamber. It must survive
      // the failed attempt unchanged and must not leak through either baffle.
      const injected=L.slice();injected[8*at(0,4,3)+4]=.0002;
      device.queue.writeBuffer(lo,0,injected);
      const incompatibleRefused=!await tree.correct(scheduler,null,1);
      const rejectedHi=await gpu.read(hi,stage,8*n),rejectedLo=await gpu.read(lo,stage,8*n);
      const rejectedUnchanged=H.every((v,i)=>v===rejectedHi[i])&&injected.every((v,i)=>v===rejectedLo[i]);
      runs.push({closed,prefixForest,applied:accepted,initialDivergence,maxDivergence,wallFlow,sharedError,circulationChange,
        incompatibleRefused,rejectedUnchanged,...tree.stats});
    }finally{gpu.close();}
  }
  return {pass:runs.every(r=>r.applied&&r.accepted===1&&r.initialDivergence>.001&&r.maxDivergence<1e-8&&r.sharedError===0&&
    r.wallFlow===0&&r.circulationChange<1e-5&&r.incompatibleRefused&&r.rejectedUnchanged&&r.maxSealedCompatibilityPerS>.01&&
    r.sealedComponents===(r.closed?3:2)&&r.sealedUnreached===(r.closed?n:2*n/3)),dims,runs};
}
