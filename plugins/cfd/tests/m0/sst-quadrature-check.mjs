import {cutGroups,gpuScope,mergedSstWall} from '../../plugin.js';

export async function verifySstQuadrature(device){
  const gpu=gpuScope(device),dims=[96,48,40],h=.005,dt=.0005,nu=1.5e-5,count=dims.reduce((s,n)=>s*n);
  const axes=dims.map(n=>Float64Array.from({length:n+1},(_,i)=>h*(i+.0017*i*i)));
  const walls=[null,null,[2,0,0],null,[0,-.6,0],null];
  const f={dims,h,dt,nu,origin:[0,0,0],axes,domainWalls:walls,U:2,maxSpeed:4,mergeToFluid:true};
  const low=[.1112,.029,.0633],high=[.20235,.1268,.1041],scale=dt/h,viscosity=nu*dt/h**2;
  const mu=new Float32Array(4*count),sdf=new Float32Array(4*count),old=new Float32Array(8*count),initial=old.slice();
  const strides=[1,dims[0],dims[0]*dims[1]],cell=i=>strides.map((s,a)=>Math.floor(i/s)%dims[a]);
  const width=p=>p.map((j,a)=>(axes[a][j+1]-axes[a][j])/h);
  const length=v=>Math.hypot(...v),minus=(a,b)=>a.map((v,k)=>v-b[k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
  for(let i=0;i<count;i++){
    const p=cell(i),overlap=p.map((j,a)=>Math.max(0,Math.min(high[a],axes[a][j+1])-Math.max(low[a],axes[a][j]))/(axes[a][j+1]-axes[a][j]));
    const d=p.map((j,a)=>{const x=.5*(axes[a][j]+axes[a][j+1]);return Math.max(low[a]-x,x-high[a]);});
    const open=p.map((j,a)=>axes[a][j+1]>=high[a]||axes[a][j+1]<=low[a]?1:1-overlap[(a+1)%3]*overlap[(a+2)%3]);
    mu.set([...open,1-overlap.reduce((a,b)=>a*b)],4*i);sdf[4*i]=(length(d.map(v=>Math.max(0,v)))+Math.min(0,Math.max(...d)))/h;
  }
  try{
    const mb=gpu.buffer('Measured cut geometry',mu),wb=gpu.buffer('Measured signed distances',sdf);
    const groups=await cutGroups(gpu,f,mb,wb);
    const linkWords=await gpu.read(groups.links,gpu.staging('Reference group topology',12*count),3*count);
    const root=new Uint32Array(linkWords.buffer);
    const volumes=await gpu.read(groups.volumes,gpu.staging('Reference group volumes',4*count),count);
    for(let i=0;i<count;i++){
      const j=root[3*i],p=cell(j);old.set([.11+.023*Math.cos(.2*p[1]),.04*Math.sin(.41*p[0]),-.06+.02*Math.cos(.09*p[2]),.0007,.017,.00025,0,0],8*i);
      initial.set([.13,0,0,.0008,.018,.000015,0,.004],8*i);
    }
    const previous=gpu.buffer('Reference old velocity and turbulence',old),seed=gpu.buffer('Reference initial predictor',initial);
    const pred=[0,1].map(()=>gpu.buffer('Merged predictor',initial));
    const cached=await mergedSstWall(gpu,f,dt,groups,wb,mb,previous,pred[0]);
    const direct=await mergedSstWall(gpu,{...f,rotor:true,rotatingFrame:false,omega:0},dt,groups,wb,mb,previous,pred[1]);
    const e=device.createCommandEncoder();cached(e);direct(e);device.queue.submit([e.finish()]);
    const state=[];for(const b of pred)state.push(await gpu.read(b,gpu.staging('Physical SST state',b.size),8*count));
    // Double-precision Spalding inversion and independent patch quadrature.
    function reference(speed,y){
      const re=speed*y/viscosity;let friction;
      if(re<.001)friction=Math.sqrt(speed*viscosity/y);
      else{
        let lo=0,hi=Math.sqrt(re);
        for(let k=0;k<60;k++){const u=(lo+hi)/2,x=.41*u,F=u+(Math.expm1(x)-x-x*x/2-x**3/6)/9.8;
          if(u*F>re)hi=u;else lo=u;}
        friction=speed/((lo+hi)/2);
      }
      const blend=friction?Math.min(1,viscosity*speed/(y*friction**2)):1;
      return [1,Math.hypot(6*viscosity/(.075*y*y),friction/(.41*.3*y)),(1-blend)*friction**3/(.41*y),blend*viscosity/y];
    }
    const sums=new Map();let patches=0;
    for(let i=0;i<count;i++)if(mu[4*i+3]>0){
      const j=root[3*i],p=cell(i),w=width(p),normalArea=[0,0,0],gradient=[0,0,0],area=w.map((_,a)=>w[(a+1)%3]*w[(a+2)%3]);
      function add(normal,y,weight,velocity){
        const u=minus(old.subarray(8*j,8*j+3),velocity),vn=dot(u,normal);
        const v=reference(length(u.map((s,a)=>s-vn*normal[a])),y);
        if(!sums.has(j))sums.set(j,[0,0,0,0]);const s=sums.get(j);for(let k=0;k<4;k++)s[k]+=weight*v[k];patches++;
      }
      for(let a=0;a<3;a++)for(const sign of [-1,1]){
        const q=p[a]+sign;
        if(q>=0&&q<dims[a]){
          const k=i+sign*strides[a];normalArea[a]-=sign*(1-mu[4*(sign>0?i:k)+a])*area[a];
          const spacing=.5*(w[a]+(axes[a][q+1]-axes[a][q])/h);
          gradient[a]+=.5*sign*(sdf[4*k]-sdf[4*i])/spacing;
        }else if(walls[2*a+Number(sign>0)]){
          const n=[0,0,0];n[a]=-sign;add(n,.5*w[a],area[a],walls[2*a+Number(sign>0)].map(x=>x*scale));
        }
      }
      if(length(normalArea)>1e-12){
        const v=dot(gradient,gradient)>1e-12?gradient:normalArea,n=v.map(x=>x/length(v));
        add(n,Math.max(sdf[4*i],.5/length(n.map((x,a)=>x/w[a]))),length(normalArea),[0,0,0]);
      }
    }
    let cachedError=0,physicalError=0;
    for(let i=0;i<count;i++){
      const j=root[3*i],sum=sums.get(j),idx=8*i;
      let k=initial[idx+3],omega=initial[idx+4];
      if(mu[4*i+3]>0&&sum){
        omega=sum[1]/sum[0];
        const prod=Math.min(sum[2]/sum[0],.9*old[8*j+3]*omega);
        k=(k-initial[idx+5]+prod/(1+.09*old[8*j+4]))/(1+sum[3]/volumes[j]);
      }
      const expected=mu[4*i+3]>0?[k,omega,.31*k/Math.max(.31*omega,initial[idx+7])]:Array.from(initial.subarray(idx+3,idx+6));
      for(let a=0;a<3;a++){
        const left=state[0][idx+3+a],right=state[1][idx+3+a];
        physicalError=Math.max(physicalError,Math.abs(left-expected[a])/Math.max(1e-10,Math.abs(expected[a])));
        cachedError=Math.max(cachedError,Math.abs(left-right));
      }
    }
    const times=[[],[]],passes=[cached,direct],batch=8;
    for(const k of [0,1,1,0,1,0,0,1,0,1,1,0]){
      const e=device.createCommandEncoder();e.copyBufferToBuffer(seed,0,pred[k],0,seed.size);
      for(let j=0;j<batch;j++)passes[k](e);const cmd=e.finish(),t=performance.now();
      device.queue.submit([cmd]);await device.queue.onSubmittedWorkDone();times[k].push((performance.now()-t)/batch);
    }
    const median=values=>{const a=values.slice(1).sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
    const medians=times.map(median);
    return {pass:groups.stats.mergedCells>0&&cached.sampleCount===patches&&direct.sampleCount===null&&cachedError<1e-6&&physicalError<.002,
      cells:count,cutCells:groups.stats.cutCells,mergedCells:groups.stats.mergedCells,samples:patches,wallRoots:sums.size,
      cachedGeometryBytes:cached.geometryBytes,cachedError,physicalError,msPerDispatch:{cached:times[0],recomputed:times[1]},
      medianMs:{cached:medians[0],recomputed:medians[1]},wallPassSpeedup:medians[1]/medians[0]};
  }finally{gpu.close();}
}
