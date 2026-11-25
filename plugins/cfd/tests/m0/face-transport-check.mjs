import {gpuScope} from './gpu.mjs';
import {cellCenter,cellWidth} from './rectilinear.mjs';
import {cutFaceTransport} from './face-transport.mjs';

export async function verifyFaceTransport(device,graded){
  const gpu=gpuScope(device),dims=[8,8,8],n=512,h=.01,dt=.002,nu=.00013;
  const axes=graded?dims.map(d=>Float64Array.from({length:d+1},(_,i)=>h*i*(.6+.4*i/d))):undefined;
  const f={dims,h,nu,origin:[0,0,0],axes};
  const velocity=new Float32Array(8*n),mu=new Float32Array(4*n),centers=new Float32Array(6*n),q=new Float32Array(8*n);
  const pos=i=>[i%8,(i>>3)%8,i>>6];
  // Includes extension, shear and rigid rotation. The second field is pure
  // rigid rotation with spatially varying viscosity and zero viscous stress.
  const fields=[[[.026,-.005,.013],[.017,-.012,.004],[-.011,.008,.003]],[[0,-.02,.01],[.02,0,-.03],[-.01,.03,0]]];
  try{
    for(let i=0;i<n;i++){
      mu.set([.75,.66,.8,1],4*i);centers.set([.08,-.11,.06,.09,-.07,.1],6*i);
      for(let a=0;a<3;a++)q[8*i+a]=((i+a)%2?1:-1)*(.13+.02*a);
    }
    const old=gpu.buffer('CFD manufactured affine velocity',velocity),mobile=gpu.buffer('CFD manufactured apertures',mu);
    const flow=gpu.buffer('CFD signed manufactured transport',q),tail=gpu.buffer('CFD zero manufactured flux tail',32*n);
    const probe=await cutFaceTransport(gpu,f,dt,old,gpu.buffer('CFD manufactured predictor',32*n),mobile,
      gpu.buffer('CFD displaced aperture centroids',centers),gpu.buffer('CFD test group volumes',16*n),flow,tail);
    const stage=gpu.staging('CFD manufactured momentum fluxes',48*n);
    let error=0,scale=0,rigidStress=0,stressScale=0,faces=0;
    for(const [field,G] of fields.entries()){
      for(let i=0;i<n;i++){
        const x=pos(i).map((j,k)=>cellCenter(f,k,j)/h);
        for(let a=0;a<3;a++)velocity[8*i+a]=G.reduce((sum,col,k)=>sum+col[a]*x[k],.02*a);
        velocity[8*i+5]=.001*(1+i%13);
      }
      device.queue.writeBuffer(old,0,velocity);const e=device.createCommandEncoder();probe.reconstruct(e);probe.transfer(e);
      device.queue.submit([e.finish()]);const result=await gpu.read(probe.faces,stage,12*n);
      for(let i=0;i<n;i++){
        const p=pos(i);if(p.some(j=>j<2||j>4))continue;
        const w=p.map((j,k)=>cellWidth(f,k,j));
        for(let a=0;a<3;a++){
          const b=(a+1)%3,c=(a+2)%3,j=i+[1,8,64][a],Q=q[8*i+a],up=Q>0?i:j;
          const dx=[0,0,0];dx[a]=(Q>0?.5:-.5)*cellWidth(f,a,pos(up)[a]);
          dx[b]=w[b]*centers[6*i+2*a];dx[c]=w[c]*centers[6*i+2*a+1];
          const visc=mu[4*i+a]*w[b]*w[c]*(nu*dt/(h*h)+.5*(velocity[8*i+5]+velocity[8*j+5]));
          for(let k=0;k<3;k++){
            const adv=-Q*G.reduce((sum,col,d)=>sum+col[k]*dx[d],0);
            const transpose=G[k][a]-(a===k?2*(G[0][0]+G[1][1]+G[2][2])/3:0);
            const ref=adv+visc*transpose,actual=result[12*i+4*a+k];
            error=Math.max(error,Math.abs(actual-ref));scale=Math.max(scale,Math.abs(ref));
            if(field===1){rigidStress=Math.max(rigidStress,Math.abs(actual-adv+visc*G[a][k]));stressScale=Math.max(stressScale,Math.abs(visc*G[a][k]));}
          }faces++;
        }
      }
    }
    return {faces,relativeFluxError:error/scale,relativeRigidStress:rigidStress/stressScale,
      pass:error/scale<1e-5&&rigidStress/stressScale<2e-5};
  }finally{gpu.close();}
}
