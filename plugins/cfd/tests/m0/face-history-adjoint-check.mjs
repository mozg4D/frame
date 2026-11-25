import {cartesianSolver,gpuScope} from '../../plugin.js';

export async function verifyFaceHistoryAdjoint(device){
  const gpu=gpuScope(device),dims=[16,8,8],n=1024,h=.008,dt=.0004;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(.85+.018*i+.035*a)));
  const f={dims,h,axes,U:.6,maxSpeed:1.1,nu:1.5e-5,origin:[.02,-.05,0],omega:0,period:.08,rho:1.2,
    cutCells:true,wallModeled:true,rotor:false,faceHistory:true,fullMoment:true,tunnelSymmetry:true,pressureOpen:[false,true,false,true,false,false],
    domainWalls:[null,null,[.5,0,-.12],null,null,null]};
  const u=new Float32Array(8*n),v=u.slice(),mu=new Float32Array(4*n),flow=u.slice(),tail=u.slice(),seed=u.slice();
  for(let i=0;i<n;i++){
    const p=[i%16,(i>>4)%8,i>>7],fluid=Math.min(1,Math.max(0,.6+Math.hypot(p[0]-7.3,p[1]-3.4,p[2]-3.8)-2.3));
    mu[4*i+3]=fluid;
    for(let a=0;a<3;a++){
      mu[4*i+a]=fluid*(.77+.22*Math.sin(.38*i+.4*a)**2);
      u[8*i+a]=.13*Math.sin(.31*i+.53*a);v[8*i+a]=u[8*i+a]+.024*Math.cos(.437*i+.28*a);
      for(const k of [a,a+4]){
        flow[8*i+k]=.15*Math.sin(.47*i+.56*k);tail[8*i+k]=.0011*Math.cos(.26*i-.49*k);
        seed[8*i+k]=.82*Math.cos(.37*i+.42*k);
      }
    }
    v[8*i+6]=.19+.06*Math.cos(.315*i);
  }
  try{
    const mob=gpu.buffer('Cut faces',mu),walls=gpu.buffer('Static wall',16*n),fx=gpu.buffer('Body reaction',4*n);
    const s=await cartesianSolver(gpu,f,dt,walls,fx,mob),op=await s.cutFaceHistoryAdjoint(gpu.buffer('Face work objective',seed));
    const buffers=[s.state,s.predicted,s.flux,s.fluxTail,mob],values=[u,v,flow,tail,mu];
    const stage=gpu.staging('Measured incidence transpose',80*n),read=b=>gpu.read(b,stage,b.size/4);
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    values.forEach((d,i)=>device.queue.writeBuffer(buffers[i],0,d));dispatch(op.encode);const bar=await read(op.out);
    const rows=[];
    for(const [mode,name] of ['old velocity','predicted velocity','transport diagonal','previous discharge','tail only','aperture'].entries()){
      const dir=values.map(data=>new Float32Array(data.length));let derivative=0,scale=0;
      function put(field,k,d,b){dir[field][k]=d;const t=dir[field][k]*b;derivative+=t;scale+=Math.abs(t);}
      for(let i=0;i<n;i++)for(let a=0;a<3;a++){
        const t=Math.cos(.39*i+.83*a)*Math.sin(.053*i+.2*a);
        if(mode<2)put(mode,8*i+a,.067*t,bar[20*i+4*mode+a]);
        if(mode===2&&a===0)put(1,8*i+6,.076*t,bar[20*i+7]);
        if(mode===3||mode===4)for(const k of [a,a+4])put(mode-1,8*i+k,.044*t*(k<4?.9:-.7),bar[20*i+8+k]);
        if(mode===5)put(4,4*i+a,.14*t*mu[4*i+a],bar[20*i+16+a]);
      }
      const estimates=[];
      for(const step of [.005,.001]){
        const fields=[];
        for(const sign of [-1,1]){
          values.forEach((data,j)=>device.queue.writeBuffer(buffers[j],0,data.map((x,k)=>x+sign*step*dir[j][k])));
          dispatch(op.predict);fields.push([await read(s.flux),await read(s.fluxTail)]);
        }
        let secant=0;for(let i=0;i<seed.length;i++)secant+=seed[i]*((fields[1][0][i]-fields[0][0][i])+(fields[1][1][i]-fields[0][1][i]))/(2*step);
        estimates.push({step,secant,normalizedError:Math.abs(secant-derivative)/scale});
      }
      rows.push({input:name,derivative,scale,estimates});
    }
    return {pass:rows.every(r=>r.scale>0&&r.estimates.every(e=>e.normalizedError<.001)),dims,rows};
  }finally{gpu.close();}
}
