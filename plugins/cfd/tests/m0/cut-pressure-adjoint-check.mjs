import {gpuScope,linearCutPressure} from '../../plugin.js';
import {verifyLinearWallPressure} from './momentum-check.mjs';

export async function verifyCutPressureAdjoint(device){
  const gpu=gpuScope(device),dims=[16,10,8],[nx,ny]=dims,n=dims.reduce((a,b)=>a*b),h=.009;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,j)=>h*j*(1+.018*j+.03*a)));
  const f={h,dims,axes,origin:[-.08,-.03,-.045],pressureOpen:[false,true,true,false,false,true],fullMoment:true};
  const pressure=new Float32Array(n),mu=new Float32Array(4*n),wall=mu.slice(),centers=new Float32Array(6*n),seed=new Float32Array(12*n);
  const point=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))],stride=[1,nx,nx*ny];
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i),d=Math.hypot((x-7.16)*.82,(y-4.6)*1.04,(z-3.52)*.98)-3.16;
    mu[4*i+3]=Math.max(0,Math.min(1,.47+d));
    wall[4*i+3]=mu[4*i+3]>0?.8+.38*Math.sin(.56*x+.21*z)**2:0;
    pressure[i]=.21*x-.046*y*y+.13*z+.173*Math.sin(.93*x+.54*y-.67*z);
  }
  for(let i=0;i<n;i++){
    const p=point(i);for(let a=0;a<3;a++){
      const m=p[a]+1<dims[a]?Math.min(mu[4*i+3],mu[4*(i+stride[a])+3]):1;
      mu[4*i+a]=m===1?1:m*(.79+.17*Math.sin(.27*i+.52*a)**2);
      centers[6*i+2*a]=.23*Math.sin(.48*i+.79*a);centers[6*i+2*a+1]=.26*Math.cos(.41*i-.32*a);
    }
  }
  try{
    const P=gpu.buffer('Discrete fluid pressure',pressure),M=gpu.buffer('Shared positive cutoff apertures',mu);
    const C=gpu.buffer('Clipped centroid ordinates',centers),W=gpu.buffer('Merged effective volumes',wall);
    const S=gpu.buffer('Fluid impulse',32*n),F=gpu.buffer('Axial force',4*n),L=gpu.buffer('Body wrench',32*n),Z=gpu.buffer('Physical objective',seed);
    const forward=await linearCutPressure(gpu,f,M,C,W,P,S,F,L),adj=await forward.adjoint(Z);
    const stage=gpu.staging('Measured true work of pressure',48*n),read=b=>gpu.read(b,stage,b.size/4);
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    const buffers=[P,M,C,W],values=[pressure,mu,centers,wall],rows=[];
    for(const torqueOnly of [false,true]){
      for(let i=0;i<n;i++)for(let a=0;a<3;a++){
        seed[12*i+a]=torqueOnly?0:Math.cos(.17*i+.63*a);
        seed[12*i+4+a]=torqueOnly?0:.61*Math.sin(.33*i-.75*a);
        seed[12*i+8+a]=3.2*Math.cos(.27*i+.37*a+.41);
      }
      device.queue.writeBuffer(Z,0,seed);values.forEach((v,i)=>device.queue.writeBuffer(buffers[i],0,v));
      dispatch(adj.encode);const bp=await read(adj.pressure),geo=await read(adj.geometry);
      if(!bp.every(Number.isFinite)||!geo.every(Number.isFinite))throw Error('Nonfinite pressure traction transpose.');
      for(const [mode,name] of ['pressure','aperture','centroids','fluid fraction','effective volume'].entries()){
        const dirs=values.map(s=>new Float32Array(s.length));let derivative=0,scale=0;
        function put(field,k,z,b){dirs[field][k]=z;const t=dirs[field][k]*b;derivative+=t;scale+=Math.abs(t);}
        for(let i=0;i<n;i++){
          const phase=Math.cos(.483*i+.31)*Math.sin(.105*i+.17);
          if(mode===0)put(0,i,.41*phase,bp[i]);
          if(mode===3&&mu[4*i+3]>0&&mu[4*i+3]<1)put(1,4*i+3,.19*phase*Math.min(mu[4*i+3],1-mu[4*i+3]),geo[12*i+3]);
          if(mode===4&&wall[4*i+3]>0)put(3,4*i+3,.21*phase*wall[4*i+3],geo[12*i+7]);
          for(let a=0;a<3;a++){
            const m=mu[4*i+a];if(!(m>0&&m<1))continue;
            if(mode===1)put(1,4*i+a,.17*Math.sin(.513*i+.71*a)*Math.min(m,1-m),geo[12*i+4*a]);
            if(mode===2)for(let k=0;k<2;k++)put(2,6*i+2*a+k,.105*Math.cos(.47*i+.67*a+.6*k),geo[12*i+4*a+1+k]);
          }
        }
        const estimates=[];
        for(const step of [.004,.001]){
          const results=[];
          for(const sign of [-1,1]){
            values.forEach((v,j)=>device.queue.writeBuffer(buffers[j],0,v.map((x,i)=>x+sign*step*dirs[j][i])));
            dispatch(e=>{e.clearBuffer(S);e.clearBuffer(F);e.clearBuffer(L);forward(e);});
            results.push([await read(S),await read(F),await read(L)]);
          }
          const diff=(b,i)=>results[1][b][i]-results[0][b][i];let response=0;
          for(let i=0;i<n;i++)for(let a=0;a<3;a++){
            response+=seed[12*i+a]*diff(0,8*i+a)+seed[12*i+4+a]*(a?diff(2,4*i+1+a):diff(1,i))+
              seed[12*i+8+a]*(a?diff(2,4*(n+i)+1+a):diff(2,4*i+1));
          }
          const secant=response/(2*step);estimates.push({step,secant,normalizedError:Math.abs(secant-derivative)/Math.max(1e-12,scale)});
        }
        rows.push({objective:torqueOnly?'wall torque':'velocity, wall force and torque',input:name,derivative,scale,estimates});
      }
    }
    const affine=await verifyLinearWallPressure(device,true);
    return {pass:affine.pass&&rows.every(r=>r.estimates.every(e=>e.normalizedError<.003)),dims,affine,rows};
  }finally{gpu.close();}
}
