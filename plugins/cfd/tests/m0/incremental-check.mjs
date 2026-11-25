import {gpuScope} from './gpu.mjs';
import {cutBox} from './momentum-check.mjs';
import {cartesianSolver} from './fvm.mjs';
import {cutGroups} from './cut-groups.mjs';

// Start from the same non-solenoidal pulse beside a closed off-grid wall.
// Compare complete time histories including the physical pressure and its
// body reaction. Recompute Bq/V in double precision directly on stored faces.
export async function verifyIncrementalPressure(device,reconstruct=false){
  const dims=[24,8,8],n=dims.reduce((a,b)=>a*b),h=.005,dt=.00025,steps=7;
  const axes=dims.map(m=>Float64Array.from({length:m+1},(_,i)=>h*i*(.76+.24*i/m)));
  const centers=new Float32Array(6*n),mu=new Float32Array(4*n),wall=new Float32Array(4*n);
  const initial=new Float32Array(8*n),volume=new Float64Array(n);
  for(let i=0;i<n;i++){
    const p=[i%24,Math.floor(i/24)%8,Math.floor(i/192)],g=cutBox(p);
    mu.set([...g.open,g.theta],4*i);centers.set(g.centers,6*i);
    const q=p.map((x,k)=>Math.max([12.53,1.38,2.52][k]-x,x-[16.48,5.42,5.46][k]));
    const distance=Math.hypot(...q.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...q));
    wall.set([distance,0,0,1-g.theta],4*i);
    const pulse=Math.exp(-((p[0]-9.8)**2+(p[1]-3.2)**2+(p[2]-4.1)**2)/7);
    initial.set([.023+.026*pulse,-.015*pulse,.011*pulse,1e-5,.02,0,0,0],8*i);
    volume[i]=mu[4*i+3]*p.reduce((v,j,k)=>v*(axes[k][j+1]-axes[k][j])/h,1);
  }
  async function compute(incrementalPressure){
    const gpu=gpuScope(device);
    try{
      const f={dims,axes,h,origin:[0,0,0],U:.46,maxSpeed:1,nu:1.5e-5,period:.05,omega:0,name:'pulse',
        rotor:false,sphere:false,wallModeled:true,cutCells:true,linearWallPressure:true,faceHistory:true,globalPressure:true,
        incrementalPressure,fluxEquilibration:incrementalPressure&&reconstruct};
      const force=gpu.buffer('CFD pulse axial force',4*n),material=gpu.buffer('CFD pulse apertures',mu);
      const surface=gpu.buffer('CFD pulse wall',wall),groups=await cutGroups(gpu,f,material,surface);
      const solver=await cartesianSolver(gpu,f,dt,surface,force,material,groups,gpu.buffer('CFD pulse centroids',centers));
      device.queue.writeBuffer(solver.state,0,initial);
      const stage=gpu.staging('CFD bounded independent projection reference',32*n),wrenches=[];
      const scheduler={async perform(phases){const e=device.createCommandEncoder();for(const op of phases)op.encode(e);
        device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();}};
      let divergence=0,shared=0,field,flux,p;
      for(let step=0;step<steps;step++){
        const clear=device.createCommandEncoder();clear.clearBuffer(force);clear.clearBuffer(solver.loads);device.queue.submit([clear.finish()]);
        await solver.advance(step,false,scheduler);
        const hi=await gpu.read(solver.flux,stage,8*n),lo=await gpu.read(solver.fluxTail,stage,8*n);
        flux=Float64Array.from(hi,(v,k)=>v+lo[k]);
        const axial=await gpu.read(force,stage,n),load=await gpu.read(solver.loads,stage,4*n),wrench=[0,0,0,0];
        for(let i=0;i<n;i++){
          let defect=0;
          for(let a=0;a<3;a++){const slot=8*i+a;defect+=flux[slot]-flux[slot+4];
            const stride=[1,24,192][a];if(Math.floor(i/stride)%dims[a]+1<dims[a])shared=Math.max(shared,Math.abs(flux[slot]-flux[slot+8*stride+4]));}
          if(volume[i])divergence=Math.max(divergence,Math.abs(defect)/(volume[i]*dt));
          wrench[0]+=axial[i];wrench[1]+=load[4*i+2];wrench[2]+=load[4*i+3];wrench[3]+=load[4*i+1];
        }
        wrenches.push(...wrench);
      }
      p=await gpu.read(solver.pressure,stage,n);field=await gpu.read(solver.state,stage,8*n);
      return {p,flux,field,wrenches,divergence,shared,reconstruction:solver.fluxConvergence.flowReconstruction};
    }finally{gpu.close();}
  }
  const base=await compute(false),delta=await compute(true);
  const relative=(a,b)=>Math.sqrt(a.reduce((s,v,i)=>s+(v-b[i])**2,0)/Math.max(1e-30,a.reduce((s,v)=>s+v*v,0)));
  const pressureError=relative(base.p,delta.p),fluxError=relative(base.flux,delta.flux);
  const velocity=x=>x.field.filter((_,i)=>(i%8)<3);
  const velocityError=relative(velocity(base),velocity(delta));
  const loadError=[0,1,2,3].map(k=>relative(base.wrenches.filter((_,i)=>i%4===k),delta.wrenches.filter((_,i)=>i%4===k)));
  const divergence=Math.max(base.divergence,delta.divergence),shared=Math.max(base.shared,delta.shared);
  return {steps,pressureError,velocityError,fluxError,loadError,divergence,shared,reconstruction:delta.reconstruction,
    pass:(!reconstruct||delta.reconstruction?.accepted>0)&&shared===0&&divergence<1e-6&&
    Math.max(pressureError,velocityError,fluxError,...loadError)<5e-5};
}
export const verifyEquilibratedPressure=device=>verifyIncrementalPressure(device,true);
