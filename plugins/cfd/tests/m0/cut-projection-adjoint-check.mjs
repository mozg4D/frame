import {cartesianSolver,cutGroups,gpuScope} from '../../plugin.js';

export function cutStudyInputs(){
  const dims=[16,8,8],n=1024,h=.008,dt=.00045;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,i)=>h*i*(.88+.018*i+.04*a)));
  const f={dims,h,axes,nu:1.5e-5,U:.6,maxSpeed:1.1,origin:[-.07,-.027,-.039],rho:1.2,period:.11,
    wallModeled:true,cutCells:true,faceHistory:true,fullMoment:true,linearWallPressure:true,rotor:false,omega:0,
    mergeToFluid:false,tunnelSymmetry:true,pressureOpen:[false,true,false,true,false,false],
    domainWalls:[null,null,[.4,0,-.12],null,null,null]};
  const state=new Float32Array(8*n),flow=state.slice(),tail=state.slice(),mu=new Float32Array(4*n);
  const wall=mu.slice(),centers=new Float32Array(6*n),strides=[1,16,128],point=i=>[i%16,(i>>4)%8,i>>7];
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i),distance=Math.hypot(.91*(x-7.24),1.08*(y-3.62),1.2*(z-3.35))-2.42;
    wall[4*i]=distance;mu[4*i+3]=Math.min(1,Math.max(0,.48+distance));
    for(let a=0;a<8;a++)state[8*i+a]=(.033+.014*a)*Math.sin(.38*i+.53*a)+.04;
  }
  for(let i=0;i<n;i++){
    const p=point(i);
    for(let a=0;a<3;a++){
      const j=i+strides[a],interior=p[a]+1<dims[a],fraction=interior?Math.min(mu[4*i+3],mu[4*j+3]):1;
      const m=fraction===1?1:fraction*(.82+.15*Math.sin(.3*i+.51*a)**2);mu[4*i+a]=m;
      if(m>0&&m<1)for(let b=0;b<2;b++)centers[6*i+2*a+b]=.17*Math.sin(.39*i+.42*a+.63*b);
      const q=m*.047*Math.sin(.3*i+.41*a);flow[8*i+a]=q;tail[8*i+a]=.016*q;
      if(interior){flow[8*j+4+a]=q;tail[8*j+4+a]=.016*q;}
      if(!p[a]){flow[8*i+4+a]=.012*Math.cos(.43*i+.69*a);}
    }
  }
  return {dims,n,h,dt,axes,f,state,flow,tail,mu,wall,centers,strides,point};
}

export async function verifyCutProjectionAdjoint(device,rotating=false){
  const gpu=gpuScope(device);
  const {dims,n,dt,f,state,flow,tail,mu,wall,centers,strides,point}=cutStudyInputs();
  if(rotating)Object.assign(f,{rotor:true,rotatingFrame:true,omega:-36,apertureFlow:true});
  const zu=state.slice(),zq=flow.slice(),zp=new Float32Array(n),zf=mu.slice(),zm=mu.slice();
  try{
    const mob=gpu.buffer('Open physical faces and fluid volumes',mu),walls=gpu.buffer('Signed wall distance',wall);
    const cent=gpu.buffer('Face centroids',centers),force=gpu.buffer('Wall force',4*n);
    const groups=await cutGroups(gpu,f,mob,walls),s=await cartesianSolver(gpu,f,dt,walls,force,mob,groups,cent);
    const stage=gpu.staging('Pressure projection observations',64*n),read=b=>gpu.read(b,stage,b.size/4);
    const seed={state:gpu.buffer('Endpoint states',zu),face:gpu.buffer('Endpoint discharges',zq),
      pressure:gpu.buffer('Pressure objective',zp),force:gpu.buffer('Body forces',zf),moment:gpu.buffer('Body moments',zm)};
    const op=await s.cutProjectionAdjoint(seed),rows=[],residuals=[];
    const buffers=[s.predicted,s.flux,s.fluxTail,mob,walls,cent],values=[state,flow,tail,mu,wall,centers];
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    wall.set(await read(walls));
    for(const onlyBody of [false,true]){
      // A fixed-frame wrench contracts with the blade impulse at its actual
      // angle. Transfer the laboratory objective to body axes for the transpose.
      const angle=rotating?(onlyBody?-1.21:.73):0,c=Math.cos(angle),sn=Math.sin(angle);
      const bodySeed=values=>values.map((v,k)=>k%4===1?c*v+sn*values[k+1]:k%4===2?c*v-sn*values[k-1]:v);
      for(let i=0;i<n;i++){
        const live=mu[4*i+3]>0;
        for(let a=0;a<8;a++){
          zu[8*i+a]=onlyBody||!live?0:.44*Math.cos(.43*i+.61*a);
          zq[8*i+a]=onlyBody||!live||a%4===3?0:.73*Math.sin(.51*i-.34*a);
        }
        zp[i]=onlyBody||!live?0:.18*Math.cos(.49*i+.13);
        for(let a=0;a<3;a++){
          zf[4*i+a]=.63*Math.sin(.28*i+.52*a);
          zm[4*i+a]=1.8*Math.cos(.33*i+.37*a);
        }
      }
      Object.values(seed).forEach((b,j)=>device.queue.writeBuffer(b,0,[zu,zq,zp,bodySeed(zf),bodySeed(zm)][j]));
      values.forEach((v,j)=>device.queue.writeBuffer(buffers[j],0,v));
      dispatch(op.project);dispatch(op.encode);residuals.push(Array.from(await op.defects()));
      const ubar=await read(op.predicted),qbar=await read(op.faces),geom=await read(op.geometry);
      const names=['tentative velocity','predicted turbulence','shared discharge','one tail incidence','open boundary flow',
        'aperture','fluid volume fraction','effective group volume','face centroid'];
      for(const [mode,name] of names.entries()){
        const dirs=values.map(v=>new Float32Array(v.length));let derivative=0,scale=0;
        function put(id,k,amp,bar){dirs[id][k]=amp;const d=dirs[id][k]*bar;derivative+=d;scale+=Math.abs(d);}
        for(let i=0;i<n;i++){
          const p=point(i),theta=mu[4*i+3];
          for(let a=0;a<3;a++){
            const wave=Math.sin(.343*i+.72*a+.26)*Math.cos(.083*i+.27*a),m=mu[4*i+a],j=i+strides[a];
            const interior=p[a]+1<dims[a];
            if(mode<2){const k=8*i+3*mode+a;put(0,k,.087*wave,ubar[k]);}
            if(mode===2&&interior&&m>0){const dv=.063*wave*m;put(1,8*i+a,dv,qbar[8*i+a]);put(1,8*j+4+a,dv,qbar[8*j+4+a]);}
            if(mode===3&&interior&&m>0)put(2,8*i+a,.045*wave*m,qbar[8*i+a]);
            if(mode===4&&!interior&&f.pressureOpen[2*a+1])put(1,8*i+a,.052*wave,qbar[8*i+a]);
            if(mode===5&&interior&&m>0&&m<1)put(3,4*i+a,.27*wave*Math.min(m,1-m),geom[12*i+4*a]);
            if(mode===8&&interior&&m>0&&m<1)for(let b=0;b<2;b++)
              put(5,6*i+2*a+b,.15*wave*(b?-.71:1),geom[12*i+4*a+1+b]);
          }
          const v=Math.cos(.419*i+.38)*Math.sin(.078*i-.18);
          if(mode===6&&theta>0&&theta<1)put(3,4*i+3,.28*v*Math.min(theta,1-theta),geom[12*i+3]);
          if(mode===7&&theta>0)put(4,4*i+3,.13*v*wall[4*i+3],geom[12*i+7]);
        }
        const estimates=[];
        for(const step of [.012,.004]){
          const Y=[];
          for(const sign of [-1,1]){
            values.forEach((v,j)=>device.queue.writeBuffer(buffers[j],0,v.map((x,k)=>x+sign*step*dirs[j][k])));
            dispatch(op.project);
            Y.push([await read(s.state),await read(s.flux),await read(s.fluxTail),await read(s.pressure),await read(force),await read(s.loads)]);
          }
          const diff=(j,k)=>Y[1][j][k]-Y[0][j][k];let value=0;
          for(let i=0;i<n;i++){
            for(let a=0;a<8;a++){const k=8*i+a;value+=zu[k]*diff(0,k)+zq[k]*(diff(1,k)+diff(2,k));}
            value+=zp[i]*diff(3,i);
            const fy=diff(5,4*i+2),fz=diff(5,4*i+3),my=diff(5,4*(n+i)+2),mz=diff(5,4*(n+i)+3);
            value+=zf[4*i]*diff(4,i)+zf[4*i+1]*(c*fy-sn*fz)+zf[4*i+2]*(sn*fy+c*fz);
            value+=zm[4*i]*diff(5,4*i+1)+zm[4*i+1]*(c*my-sn*mz)+zm[4*i+2]*(sn*my+c*mz);
          }
          const secant=value/(2*step);estimates.push({step,secant,normalizedError:Math.abs(secant-derivative)/Math.max(1e-9,scale)});
        }
        rows.push({objective:onlyBody?'wall wrench':'state, pressure, flow and wall wrench',input:name,derivative,scale,estimates});
      }
    }
    return {pass:groups.stats.mergedCells>0&&residuals.every(r=>r[1]<3e-6)&&rows.every(r=>r.estimates.every(e=>e.normalizedError<.004)),
      dims,rotating,mergedCells:groups.stats.mergedCells,residuals,rows};
  }finally{gpu.close();}
}

export const verifyRotatingCutProjection=device=>verifyCutProjectionAdjoint(device,true);
