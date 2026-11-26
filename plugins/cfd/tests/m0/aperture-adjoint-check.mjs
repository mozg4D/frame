import {aperturePredictor,gpuScope} from '../../plugin.js';
import {cutStudyInputs} from './cut-projection-adjoint-check.mjs';
import {verifyAperturePredictor} from './aperture-predictor-check.mjs';

export async function verifyApertureFlowAdjoint(device){
  const gpu=gpuScope(device),input=cutStudyInputs(),{n,dt,flow,tail,mu,centers,dims,point,strides}=input;
  const previous=input.state.slice(),star=previous.slice(),seed=flow.slice();
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i);
    for(let a=0;a<3;a++){
      previous[8*i+a]=.14*Math.sin(.31*x+.37*y-.42*z+.71*a)+.002*x*y;
      star[8*i+a]=.17*Math.sin(.42*x-.29*y+.46*z+.23*a)+.003*z*y;
      seed[8*i+a]=.52*Math.sin(.62*i+.31*a);seed[8*i+4+a]=.57*Math.cos(.33*i-.49*a);
    }
    star[8*i+6]=.28+.1*Math.cos(.3*i);
  }
  const values=[previous,star,mu,centers,flow,tail];
  const buffers=values.map((v,j)=>gpu.buffer('CFD aperture test input '+j,v));
  const z=gpu.buffer('CFD aperture work on independent incidences',seed),stage=gpu.staging('CFD aperture sensitivities',80*n);
  const read=b=>gpu.read(b,stage,b.size/4),dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
  const estimates=[];
  try{
    for(const omega of [-37,49]){
      const op=await aperturePredictor(gpu,{...input.f,omega,rotor:true},dt,...buffers);
      const adj=await op.adjoint(z);
      for(const mode of ['initial','first predictor','transient']){
        const apply=t=>e=>mode==='initial'?t.initial(e):t.predict(e,mode==='first predictor');
        values.forEach((v,j)=>device.queue.writeBuffer(buffers[j],0,v));dispatch(apply(adj));
        const state=await read(adj.state),material=await read(adj.material);
        for(const [k,name] of ['previous velocity','predicted velocity','momentum diagonal','oriented previous discharge',
          'one independent discharge tail','aperture fraction','both centroid moments','closed-face discharges'].entries()){
          const j=[0,1,1,4,5,2,3,4][k],dir=new Float32Array(values[j].length);let prediction=0,scale=0;
          function put(i,x,bar){dir[i]=x;const term=dir[i]*bar;prediction+=term;scale+=Math.abs(term);}
          for(let i=0;i<n;i++){
            const p=point(i),s=Math.sin(.371*i+.13)*Math.cos(.056*i+.4);
            if(k===2)put(8*i+6,.09*s,state[8*i+7]);
            for(let a=0;a<3;a++){
              const wave=Math.sin(.83*p[0]+.27*p[1]-.18*p[2]+.61*a+.24);
              const m=mu[4*i+a],inside=p[a]+1<dims[a],cell=20*i,row=cell+8+4*a;
              if(k<2)put(8*i+a,.021*wave,state[8*i+4*k+a]);
              if(k===3){put(8*i+a,.047*wave,material[cell+a]);
                put(8*i+4+a,-.052*s,material[cell+4+a]);}
              if(k===4)put(8*i+4+a,.038*wave,material[cell+4+a]);
              if(k===5&&inside&&m>0&&m<1)put(4*i+a,.19*Math.min(m,1-m)*wave,material[row]);
              if(k===6&&inside&&m>0&&m<1){put(6*i+2*a,.11*wave,material[row+1]);put(6*i+2*a+1,-.08*s,material[row+2]);}
              if(k===7&&inside&&m===0){put(8*i+a,.06*wave,material[cell+a]);
                const next=i+strides[a];put(8*next+4+a,-.05*s,material[20*next+4+a]);}
            }
          }
          const samples=[];
          for(const eps of [.006,.002]){
            const runs=[];
            for(const sign of [-1,1]){
              values.forEach((v,id)=>device.queue.writeBuffer(buffers[id],0,id===j?v.map((x,i)=>x+sign*eps*dir[i]):v));
              dispatch(apply(op));runs.push([await read(buffers[4]),await read(buffers[5])]);
            }
            let difference=0;for(let i=0;i<seed.length;i++)difference+=seed[i]*
              ((runs[1][0][i]-runs[0][0][i])+(runs[1][1][i]-runs[0][1][i]));
            const finite=difference/(2*eps),error=Math.abs(finite-prediction);
            samples.push({eps,finite,signedError:error/Math.max(1e-12,Math.abs(prediction)),errorOverScale:error/Math.max(1e-12,scale)});
          }
          estimates.push({omega,mode,input:name,prediction,scale,samples});
        }
      }
    }
    const rigid=await verifyAperturePredictor(device);
    return {pass:rigid.pass&&estimates.every(r=>r.samples.every(s=>s.errorOverScale<.003&&
      (Math.abs(r.prediction)<=.05*r.scale||s.signedError<.025))),rigid,estimates};
  }finally{gpu.close();}
}
