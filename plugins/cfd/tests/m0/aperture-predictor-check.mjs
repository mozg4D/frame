import {gpuScope} from './gpu.mjs';
import {aperturePredictor} from './aperture-predictor.mjs';
import {cellCenter,cellWidth} from './rectilinear.mjs';

// Independently integrate sample affine velocity on offset rectangular
// apertures by averaging four polygon corners. Use unequal physical widths.
export async function verifyAperturePredictor(device){
  const gpu=gpuScope(device),dims=[8,8,8],n=512,h=.01,dt=.001,omega=21;
  const origin=[-.09,-.071,.019],axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>origin[a]+h*i*(.7+.3*i/d)));
  const f={name:'manufactured',dims,h,axes,origin,omega,U:0,rotor:true},strides=[1,8,64];
  const oldData=new Float32Array(n*8),starData=new Float32Array(n*8),mu=new Float32Array(n*4),offset=new Float32Array(n*6);
  const coord=i=>[i%8,(i>>3)%8,i>>6],point=i=>coord(i).map((j,k)=>cellCenter(f,k,j));
  const spin=x=>[0,-omega*x[2],omega*x[1]],delta=x=>[.6+2*x[1]-x[2],.7-.3*x[0]+.8*x[2],-.2+.8*x[1]+1.2*x[0]];
  try{
    for(let i=0;i<n;i++){
      const x=point(i),u=spin(x),du=delta(x);
      for(let a=0;a<3;a++){oldData[8*i+a]=u[a]*dt/h;starData[8*i+a]=(u[a]+du[a])*dt/h;}
      starData[8*i+6]=.4;
      for(let a=0;a<3;a++){mu[4*i+a]=.375;offset[6*i+2*a]=.125;offset[6*i+2*a+1]=-.125;}mu[4*i+3]=1;
    }
    const old=gpu.buffer('CFD rigid velocity',oldData),star=gpu.buffer('CFD affine change',starData);
    const high=gpu.buffer('CFD measured high word',n*32),low=gpu.buffer('CFD measured low word',n*32),stage=gpu.staging('CFD aperture integrals',n*32);
    const op=await aperturePredictor(gpu,f,dt,old,star,gpu.buffer('CFD clipped openings',mu),gpu.buffer('CFD clipped face centres',offset),high,low);
    let rigidError=0,relativeError=0,sharedError=0,faces=0;
    async function measure(mode){
      const e=device.createCommandEncoder();if(mode===0)op.initial(e);else op.predict(e,mode===1);device.queue.submit([e.finish()]);
      const q=await gpu.read(high,stage,n*8),tail=await gpu.read(low,stage,n*8);
      for(let i=0;i<n;i++){
        const p=coord(i);if(p.some(j=>j<1||j>5))continue;const x=point(i),w=p.map((j,k)=>cellWidth(f,k,j)*h);
        for(let a=0;a<3;a++){
          const b=(a+1)%3,c=(a+2)%3,j=i+strides[a];let integral=0;
          for(const db of [-.25,.25])for(const dc of [-.375,.375]){
            const v=[...x];v[a]+=.5*w[a];v[b]+=(.125+db)*w[b];v[c]+=(-.125+dc)*w[c];integral+=delta(v)[a]*.25;
          }
          const measure=.375*w[b]*w[c]/(h*h),v=q[8*i+a]+tail[8*i+a];
          if(mode===0)rigidError=Math.max(rigidError,Math.abs(v)/measure);
          else relativeError=Math.max(relativeError,Math.abs(v/(measure*dt/h)-integral)/Math.max(.1,Math.abs(integral)));
          sharedError=Math.max(sharedError,Math.abs(v-(q[8*j+4+a]+tail[8*j+4+a])));faces++;
        }
      }
    }
    await measure(0);await measure(2);await measure(1);
    return {faces,rigidError,relativeError,sharedError,pass:faces>0&&rigidError<2e-6&&relativeError<2e-5&&sharedError===0};
  }finally{gpu.close();}
}
