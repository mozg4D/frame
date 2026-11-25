import {cutGroups,gpuScope,mergedSstWall,mergedSstWallAdjoint} from '../../plugin.js';
import {reference} from './wall-linearization-check.mjs';

export async function verifyGroupedSstPullback(device){
  const gpu=gpuScope(device),dims=[32,20,16],h=.004,dt=.00035,n=dims.reduce((v,x)=>v*x,1);
  const axes=dims.map(d=>Float64Array.from({length:d+1},(_,j)=>h*j*(1+.004*j)));
  const f={dims,h,nu:1.5e-5,origin:[0,0,0],axes,domainWalls:[null,null,[1.5,0,.35],null,[0,.8,0],null],
    maxSpeed:4,U:2,mergeToFluid:true};
  const lower=[.0271,.0114,.0087],upper=[.0887,.0495,.0382],mu=new Float32Array(4*n),sdf=mu.slice();
  const old=new Float32Array(8*n),initial=old.slice(),seed=new Float32Array(4*n);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const rotation=[.3,-.4,.2],dot=(a,b)=>a.reduce((v,x,k)=>v+x*b[k],0);
  for(let i=0;i<n;i++){
    const p=[i%dims[0],Math.floor(i/dims[0])%dims[1],Math.floor(i/(dims[0]*dims[1]))];
    const fraction=p.map((j,a)=>Math.min(1,Math.max(0,Math.min(upper[a],axes[a][j+1])-Math.max(lower[a],axes[a][j]))/(axes[a][j+1]-axes[a][j])));
    const d=p.map((j,a)=>{const x=.5*(axes[a][j+1]+axes[a][j]);return Math.max(lower[a]-x,x-upper[a]);});
    const open=p.map((j,a)=>axes[a][j+1]<=lower[a]||axes[a][j+1]>=upper[a]?1:1-fraction[(a+1)%3]*fraction[(a+2)%3]);
    mu.set([...open,1-fraction.reduce((v,b)=>v*b)],4*i);
    sdf[4*i]=(Math.hypot(...d.map(x=>Math.max(0,x)))+Math.min(0,Math.max(...d)))/h;
  }
  const read=async b=>gpu.read(b,gpu.staging('Independent derivative measurement',b.size),b.size/4);
  try{
    const m=gpu.buffer('Apertures in the physical obstacle',mu),w=gpu.buffer('Distance to the obstacle',sdf);
    const groups=await cutGroups(gpu,f,m,w),link=new Uint32Array((await read(groups.links)).buffer),volume=await read(groups.volumes);
    for(let i=0;i<n;i++){
      const root=link[3*i],t=Math.sin(.09*root);
      old.set([.15+.04*t,.06-.025*t,-.07+.02*t,root%3===0?.000003:.013,.035+.015*t,.003,0,0],8*i);
      initial.set([.05,.02,-.03,.005+.002*t,.032+.01*t,.0001,0,root%2===0?.3:.002],8*i);
      if(mu[4*i+3]>0)seed.set([.9+.1*Math.sin(.4*i),.03+.02*Math.cos(.8*i),.8+.3*Math.sin(.21*i),0],4*i);
    }
    const previous=gpu.buffer('Old cell state',old),pred=gpu.buffer('Grouped wall predictor',initial),base=gpu.buffer('Primal checkpoint',initial);
    const forward=await mergedSstWall(gpu,f,dt,groups,w,m,previous,pred),q=forward.quadrature;
    const backward=await mergedSstWallAdjoint(gpu,f,dt,groups,q,previous,base,gpu.buffer('Cell objectives',seed));
    const e=device.createCommandEncoder();backward.encode(e);device.queue.submit([e.finish()]);
    const [dual,sites,patches]=await Promise.all([read(backward.dual),read(backward.sites),read(q.samples)]);
    const span=new Uint32Array((await read(q.range)).buffer),roots=Array.from({length:n},(_,i)=>i).filter(i=>volume[i]>0);
    const weights=new Float64Array(3*n);
    for(let i=0;i<n;i++)for(let a=0;a<3;a++)weights[3*link[3*i]+a]+=seed[4*i+a];
    function turbulenceObjective(state,trial,vol,geometry,nu){
      const values=new Float64Array(n);
      for(const i of roots){
        const row=8*i,surface=[0,0,0,0];let k=trial[row+3],omega=Math.max(1e-8,trial[row+4]);
        for(let j=span[2*i];j<span[2*i]+span[2*i+1];j++){
          const p=8*j,normal=geometry.subarray(p,p+3),v=Array.from(state.subarray(row,row+3),(x,a)=>x-geometry[p+4+a]);
          const vn=dot(v,normal),speed=Math.hypot(...v.map((x,a)=>x-vn*normal[a]));
          const result=reference(speed,geometry[p+3],nu).sst,A=geometry[p+7];surface[0]+=A;
          for(let a=0;a<3;a++)surface[a+1]+=A*result[a];
        }
        if(surface[0]>0){omega=surface[1]/surface[0];const production=Math.min(surface[2]/surface[0],.9*Math.max(1e-12,state[row+3])*omega);
          k=(k-trial[row+5]+production/(1+.09*Math.max(1e-8,state[row+4])))/(1+surface[3]/vol[i]);}
        k=Math.max(k,1e-12);const eddy=.31*k/Math.max(.31*omega,trial[row+7]);
        values[i]=weights[3*i]*k+weights[3*i+1]*omega+weights[3*i+2]*eddy;
      }
      return values;
    }
    const directions=['old velocity','old turbulence','predicted turbulence','group volume','wall normal and velocity','wall height and area','molecular viscosity'];
    const results=[];
    for(const [mode,name] of directions.entries()){
      const tangent=new Float64Array(n),measurements=[];
      for(const hardware of [true,false]){
      const values=[],oracle=[],epsilon=hardware?([1,3].includes(mode)?.06:.003):.0001;
      for(const sign of [-1,1]){
        const eps=epsilon*sign,previousTrial=Float64Array.from(old),predTrial=Float64Array.from(initial),
          volumeTrial=Float64Array.from(volume),patchTrial=Float64Array.from(patches);
        for(const i of roots){
          const a=16*i,b=8*i,s=1+.25*Math.sin(.23*i);
          let expected=0;
          if(mode===0)for(const [k,v] of [.06*s,-.018*s,.030*s].entries()){previousTrial[b+k]+=eps*v;expected+=dual[a+k]*v;}
          if(mode===1){
            const dk=.6*old[b+3],dw=.6*old[b+4];previousTrial[b+3]+=eps*dk;previousTrial[b+4]+=eps*dw;
            expected=dual[a+3]*dk+dual[a+8]*dw;
          }
          if(mode===2)for(const [j,k] of [3,4,5,7].entries()){
            const v=.5*initial[b+k];predTrial[b+k]+=eps*v;expected+=dual[a+4+j]*v;
          }
          if(mode===3){volumeTrial[i]*=Math.exp(eps*s);expected=dual[a+9]*s;}
          if(mode===6)expected=dual[a+10];
          for(let k=span[2*i];k<span[2*i]+span[2*i+1];k++){
            const p=8*k;
            if(mode===4){
              const normal=Array.from(patches.subarray(p,p+3)),dn=cross(rotation,normal),dw=[.023*s,-.018*s,.03*s];
              const moved=normal.map((v,j)=>v+eps*dn[j]),size=Math.hypot(...moved);
              for(let j=0;j<3;j++){patchTrial[p+j]=moved[j]/size;patchTrial[p+4+j]+=eps*dw[j];}
              expected+=dot(dn,sites.subarray(p,p+3))+dot(dw,sites.subarray(p+4,p+7));
            }
            if(mode===5){const y=.7*s,area=-.3+.1*Math.cos(k);patchTrial[p+3]*=Math.exp(eps*y);patchTrial[p+7]*=Math.exp(eps*area);
              expected+=sites[p+3]*y+sites[p+7]*area;}
          }
          tangent[i]=expected;
        }
        const viscosity=f.nu*dt/h**2*(mode===6?Math.exp(eps):1);
        if(!hardware){values.push(turbulenceObjective(previousTrial,predTrial,volumeTrial,patchTrial,viscosity));continue;}
        oracle.push(turbulenceObjective(Float32Array.from(previousTrial),Float32Array.from(predTrial),Float32Array.from(volumeTrial),
          Float32Array.from(patchTrial),Math.fround(viscosity)));
        device.queue.writeBuffer(previous,0,Float32Array.from(previousTrial));device.queue.writeBuffer(pred,0,Float32Array.from(predTrial));
        device.queue.writeBuffer(q.samples,0,Float32Array.from(patchTrial));device.queue.writeBuffer(groups.volumes,0,Float32Array.from(volumeTrial));
        const op=mode===6?await mergedSstWall(gpu,{...f,nu:f.nu*Math.exp(eps)},dt,groups,w,m,previous,pred):forward;
        const enc=device.createCommandEncoder();op(enc);device.queue.submit([enc.finish()]);
        const next=await read(pred),grouped=new Float64Array(n);
        for(let i=0;i<n;i++)for(let k=0;k<3;k++)grouped[link[3*i]]+=seed[4*i+k]*next[8*i+3+k];
        values.push(grouped);
      }
      let err=0,scale=0,total=0,fdTotal=0,worstSecantUlps=0,worstValueRelative=0;
      for(const i of roots){
        const fd=(values[1][i]-values[0][i])/(2*epsilon);err+=(tangent[i]-fd)**2;scale+=fd**2;total+=tangent[i];fdTotal+=fd;
        if(hardware){
          const ref=(oracle[1][i]-oracle[0][i])/(2*epsilon);
          const scale=(Math.abs(oracle[1][i])+Math.abs(oracle[0][i]))/(2*epsilon);
          worstSecantUlps=Math.max(worstSecantUlps,Math.abs(ref-fd)/Math.max(1e-30,scale*2**-23));
          for(let j=0;j<2;j++)worstValueRelative=Math.max(worstValueRelative,Math.abs(values[j][i]-oracle[j][i])/Math.max(1e-30,Math.abs(oracle[j][i])));
        }
      }
      measurements.push({method:hardware?'production FP32':'independent Float64',epsilon,relativeL2:Math.sqrt(err/Math.max(scale,1e-35)),
        adjoint:total,finiteDifference:fdTotal,...hardware?{worstSecantUlps,worstValueRelative}:{}});
      }
      results.push({direction:name,measurements});
    }
    return {pass:groups.stats.mergedCells>0&&q.sampleCount>0&&results.every(r=>r.measurements[0].worstSecantUlps<24&&
      r.measurements[0].worstValueRelative<4e-6&&r.measurements[1].relativeL2<.0002),
      dims,mergedCells:groups.stats.mergedCells,fluidRoots:roots.length,wallPatches:q.sampleCount,results};
  }finally{gpu.close();}
}
