import {cutFaceTransport,gpuScope} from '../../plugin.js';

export const verifyRotatingFaceAdjoint=device=>verifyCutFaceAdjoint(device,true);
export async function verifyCutFaceAdjoint(device,rotating=false){
  const gpu=gpuScope(device),dims=[18,13,10],[nx,ny]=dims,n=dims.reduce((a,b)=>a*b),h=.009,dt=.0008;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(1+.013*i+.04*a)));
  const f={dims,h,axes,nu:.000019,origin:[-.04,0,-.08]};
  if(rotating)Object.assign(f,{rotor:true,rotatingFrame:true,modeledShape:true,implicitRadiusM:.084});
  const state=new Float32Array(8*n),mu=new Float32Array(4*n),walls=new Float32Array(4*n),centers=new Float32Array(6*n);
  const flow=new Float32Array(8*n),tail=flow.slice(),seed=mu.slice();
  const point=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))],s=[1,nx,nx*ny];
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i),dist=Math.max(4.7-x,x-12.2,4.3-y,y-9.6,2.24-z,z-6.7);
    const fraction=Math.max(0,Math.min(1,.55+dist));
    mu[4*i+3]=fraction;walls[4*i+3]=fraction>0?.62+.82*Math.cos(.27*x+.28*z)**2:0;
    state.set([.031*x-.019*y+.106*Math.cos(.45*z+.61*y),-.17*Math.sin(.65*x-.23*y+.45*z),
      .14*Math.sin(.57*y-.43*z+.49*x),0,0,.003*(1.4+Math.sin(.38*x-.27*y+.41*z)),0,0],8*i);
    seed.set([Math.cos(.33*x+.57*z),.6*Math.sin(.61*y-.31*x),.8*Math.cos(.37*z-.42*y+.34*x),0],4*i);
  }
  for(let i=0;i<n;i++){
    const p=point(i);
    for(let a=0;a<3;a++){
      const j=i+s[a],frac=p[a]+1<dims[a]?Math.min(mu[4*i+3],mu[4*j+3]):0;
      mu[4*i+a]=frac*(.66+.33*Math.sin(.27*i+.82*a)**2);
      centers[6*i+2*a]=.28*Math.sin(.41*i+.77*a);centers[6*i+2*a+1]=.26*Math.cos(.58*i-.39*a);
      flow[8*i+a]=Math.sign(Math.sin(.81*i+.55*a+.33))*(.018+.031*Math.cos(.22*i+.71*a)**2);
      tail[8*i+a]=.003*Math.sin(.25*i+.37*a);
    }
  }
  try{
    const old=gpu.buffer('Velocity and viscosity',state),m=gpu.buffer('Positive fluid apertures',mu),w=gpu.buffer('Group volumes',walls);
    const c=gpu.buffer('Relative aperture centroids',centers),q=gpu.buffer('Primary face discharge',flow),low=gpu.buffer('Discharge tail',tail);
    const predicted=gpu.buffer('Extensive momentum increment',32*n),z=gpu.buffer('Momentum work objective',seed);
    const solve=await cutFaceTransport(gpu,f,dt,old,predicted,m,c,w,q,low),adj=await solve.adjoint(z);
    const stage=gpu.staging('Finite differences and native momentum cotangent',64*n);
    const read=b=>gpu.read(b,stage,b.size/4);
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    const datasets=[state,mu,walls,centers,flow,tail],buffers=[old,m,w,c,q,low];
    dispatch(adj.encode);const bar=await read(adj.state),geometry=await read(adj.direct);
    const rows=[];
    for(const [mode,name] of ['velocity','eddy viscosity','aperture','effective volume','face centroids','primary discharge','discharge tail'].entries()){
      const dirs=datasets.map(arr=>new Float32Array(arr.length));let directional=0,scale=0;
      for(let i=0;i<n;i++){
        function put(field,k,d,derivative){dirs[field][k]=d;const v=dirs[field][k]*derivative;directional+=v;scale+=Math.abs(v);}
        for(let a=0;a<3;a++){
          const v=Math.sin(.374*i+.712*a+.29)*Math.cos(.061*i-.43*a);
          if(mode===0)put(0,8*i+a,.052*v,bar[4*i+a]);
          if(mode===2&&mu[4*i+a]>0)put(1,4*i+a,.12*v*mu[4*i+a],geometry[16*i+4+4*a]);
          if(mode===4)for(let k=0;k<2;k++)put(3,6*i+2*a+k,.14*(k?Math.cos(.61*i-.2*a):v),geometry[16*i+5+4*a+k]);
          if(mode===5||mode===6)put(mode-1,8*i+a,.014*v,geometry[16*i+a]);
        }
        if(mode===1)put(0,8*i+5,.0021*Math.sin(.43*i+.27),bar[4*i+3]);
        if(mode===3&&walls[4*i+3]>0)put(2,4*i+3,.25*Math.sin(.68*i+.17),geometry[16*i+7]);
      }
      const estimates=[];
      for(const step of [.004,.001]){
        const fields=[];
        for(const sign of [-1,1]){
          datasets.forEach((data,j)=>device.queue.writeBuffer(buffers[j],0,data.map((v,i)=>v+sign*step*dirs[j][i])));
          dispatch(e=>{e.clearBuffer(predicted);solve.reconstruct(e);solve.transfer(e);solve.apply(e);});
          fields.push(await read(predicted));
        }
        let measured=0;for(let i=0;i<n;i++)for(let a=0;a<3;a++)
          measured+=seed[4*i+a]*(fields[1][8*i+a]-fields[0][8*i+a])/(2*step);
        estimates.push({step,measured,normalizedError:Math.abs(measured-directional)/scale});
      }
      rows.push({input:name,directional,scale,estimates});
    }
    const drift=[0,1,2].map(a=>{
      let total=0,scale=0;for(let i=0;i<n;i++){total+=bar[4*i+a];scale+=Math.abs(bar[4*i+a]);}
      return Math.abs(total)/scale;
    });
    return {pass:rows.every(r=>r.scale>1e-4&&r.estimates.every(e=>e.normalizedError<.0025))&&drift.every(v=>v<1e-5),
      dims,uniformTranslationDefect:drift,rows};
  }finally{gpu.close();}
}
