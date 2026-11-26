import {cartesianSolver,cutGroups,gpuScope} from '../../plugin.js';

export const verifyRawCutAdjoint=device=>study(device,false);
export const verifyModeledPredictor=device=>study(device,true);
export const verifyRotatingMomentumAdjoint=device=>study(device,false,true);
export const verifyRotatingPredictor=device=>study(device,true,true);
async function study(device,composed,rotating=false){
  const gpu=gpuScope(device),dims=[16,12,10],[nx,ny]=dims,n=dims.reduce((a,b)=>a*b),h=.007,dt=.0005;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,j)=>h*j*(1+.012*j+.025*a)));
  const f={dims,h,axes,nu:1.5e-5,U:1.3,maxSpeed:2,origin:[-.06,-.035,-.025],rho:1.17,period:.08,
    wallModeled:true,cutCells:true,sstWall:true,ddes:true,rotor:false,omega:0,faceReconstruction:true,faceHistory:true,
    fullMoment:true,mergeToFluid:false,tunnelSymmetry:true,domainWalls:[null,null,[.5,0,-.12],null,null,null],
    pressureOpen:[false,true,false,false,false,false]};
  if(rotating)Object.assign(f,{rotor:true,rotatingFrame:true,omega:-73,apertureFlow:true,groupTransport:true,
    implicitRadiusM:.04,sstWall:false,ddes:false,modeledShape:composed});
  const state=new Float32Array(8*n),mu=new Float32Array(4*n),wall=new Float32Array(4*n);
  const q=new Float32Array(8*n),tail=q.slice(),seeds=mu.slice(),forceSeed=mu.slice(),momentSeed=mu.slice(),turbulence=mu.slice();
  const point=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))],strides=[1,nx,nx*ny];
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i),dist=Math.hypot((x-7.39)*.85,(y-5.26)*1.14,(z-4.61)*1.12)-3.47;
    wall[4*i]=dist;mu[4*i+3]=Math.max(0,Math.min(1,.53+dist));
    state.set([.08+.014*x-.011*y+.035*Math.sin(.39*z+.28*x),.095*Math.cos(.43*x+.54*z),
      .088*Math.sin(.52*y-.31*x),.0021+.00013*x,.06+.002*y,.0028*(1.55+Math.sin(.39*x-.28*y+.4*z)),0,0],8*i);
  }
  for(let i=0;i<n;i++){
    const p=point(i);
    for(let a=0;a<3;a++){
      const j=i+strides[a],inside=p[a]+1<dims[a],vol=inside?Math.min(mu[4*i+3],mu[4*j+3]):0;
      const aperture=vol===1?1:vol*(.78+.19*Math.sin(.16*i+.57*a)**2);
      mu[4*i+a]=aperture;
      const open=inside?aperture:1;
      const flow=open*Math.sign(Math.sin(.59*i+.55*a+.31))*(.021+.023*Math.cos(.27*i+.4*a)**2);
      q[8*i+a]=flow;tail[8*i+a]=.043*flow;
      if(inside){q[8*j+4+a]=flow;tail[8*j+4+a]=.043*flow;}
      if(!p[a]){q[8*i+4+a]=.018+.014*Math.sin(.49*i+.2*a);}
    }
  }
  try{
    const mob=gpu.buffer('Physical face fractions',mu),walls=gpu.buffer('Signed wall distances',wall),F=gpu.buffer('Axial reaction',4*n);
    const groups=await cutGroups(gpu,f,mob,walls);
    const solved=await cartesianSolver(gpu,f,dt,walls,F,mob,groups,gpu.buffer('Aperture centroids',24*n));
    const stage=gpu.staging('Physical predictor and cotangents',80*n),read=b=>gpu.read(b,stage,b.size/4);
    wall.set(await read(walls));
    const sz=gpu.buffer('Momentum and face relaxation seed',seeds),sf=gpu.buffer('Body force seed',forceSeed),sm=gpu.buffer('Body moment seed',momentSeed);
    const st=gpu.buffer('Turbulence objective',turbulence);
    const adj=await (composed?solved.modeledPredictorAdjoint(sz,st,sf,sm):solved.rawCutMomentumAdjoint(sz,sf,sm));
    const buffers=[solved.state,solved.flux,solved.fluxTail,mob,walls],values=[state,q,tail,mu,wall];
    const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
    const rows=[];
    for(const onlyBody of [false,true]){
      for(let i=0;i<n;i++)for(let a=0;a<4;a++){
        seeds[4*i+a]=onlyBody?0:(a===3?.18:.8)*Math.cos(.32*i+.48*a+.23);
        forceSeed[4*i+a]=a<3?.82*Math.sin(.28*i-.7*a+.49):0;
        momentSeed[4*i+a]=a<3?2.5*Math.cos(.43*i+.52*a-.12):0;
        turbulence[4*i+a]=onlyBody||a===3?0:(.09+.01*a)*Math.sin(.37*i+.71*a+.31);
      }
      [sz,sf,sm].forEach((b,i)=>device.queue.writeBuffer(b,0,[seeds,forceSeed,momentSeed][i]));
      device.queue.writeBuffer(st,0,turbulence);
      buffers.forEach((b,i)=>device.queue.writeBuffer(b,0,values[i]));
      dispatch(adj.encode);
      const gradient=composed?new Float32Array(20*n):await read(adj.out);
      let previous;
      if(composed){
        previous=await read(adj.old);const flow=await read(adj.face);
        for(let i=0;i<n;i++){
          gradient.set(previous.subarray(8*i,8*i+3),20*i);gradient[20*i+3]=previous[8*i+5];
          gradient.set(flow.subarray(8*i,8*i+8),20*i+4);
        }
      }
      if(!gradient.every(Number.isFinite))throw Error('Nonfinite cut momentum derivative.');
      const inputs=['old velocity','eddy viscosity','shared discharge','one incidence','aperture','fluid fraction','wall distance','effective volume','k','omega'];
      for(const [mode,name] of inputs.entries()){
        if(composed?mode>=4&&mode<8:mode>=8)continue;
        const directions=values.map(v=>new Float32Array(v.length));let derivative=0,scale=0;
        function put(id,k,amplitude,bar){directions[id][k]=amplitude;const v=directions[id][k]*bar;derivative+=v;scale+=Math.abs(v);}
        for(let i=0;i<n;i++){
          const p=point(i),o=20*i,v=Math.sin(.37*i+.48)*Math.cos(.059*i);
          if(mode===1)put(0,8*i+5,.002*v,gradient[o+3]);
          if(mode===8)put(0,8*i+3,.0011*v,previous[8*i+3]);
          if(mode===9)put(0,8*i+4,.017*v,previous[8*i+4]);
          if(mode===5&&mu[4*i+3]>0&&mu[4*i+3]<1)put(3,4*i+3,.15*v*Math.min(mu[4*i+3],1-mu[4*i+3]),gradient[o+15]);
          if(mode===6)put(4,4*i,.18*v,gradient[o+16]);
          if(mode===7&&wall[4*i+3]>0)put(4,4*i+3,.17*v*wall[4*i+3],gradient[o+17]);
          for(let a=0;a<3;a++){
            const t=Math.sin(.53*i+.81*a+.27)*Math.cos(.07*i-.4*a);
            if(mode===0)put(0,8*i+a,.055*t,gradient[o+a]);
            const open=mu[4*i+a];
            if(mode===4&&open>0&&open<1)put(3,4*i+a,.19*t*Math.min(open,1-open),gradient[o+12+a]);
            if(mode===2||mode===3){
              const amount=.012*t*open;put(mode===2?1:2,8*i+a,amount,gradient[o+4+a]);
              if(mode===2&&p[a]+1<dims[a]){const j=i+strides[a];put(1,8*j+4+a,amount,gradient[20*j+8+a]);}
            }
          }
        }
        const estimates=[];
        // For a fixed wetted area the integrated shear depends only weakly
        // on effective group volume. Resolve it with a 1–2.4% volume change.
        for(const step of onlyBody&&mode===7?[.14,.07]:[.006,.002]){
          const Y=[];
          for(const sign of [-1,1]){
            values.forEach((v,j)=>device.queue.writeBuffer(buffers[j],0,v.map((x,i)=>x+sign*step*directions[j][i])));
            dispatch(adj.predict);
            Y.push([await read(solved.predicted),await read(F),await read(solved.loads)]);
          }
          const diff=(array,k)=>Y[1][array][k]-Y[0][array][k];let total=0,wallResolved=0;
          for(let i=0;i<n;i++){
            const p=point(i),volume=p.reduce((prod,j,a)=>prod*(axes[a][j+1]-axes[a][j])/h,1)*wall[4*i+3];
            for(let a=0;a<3;a++){
              total+=seeds[4*i+a]*diff(0,8*i+a);
              const bodyImpulse=a?diff(2,4*i+1+a):diff(1,i);
              const wrench=forceSeed[4*i+a]*bodyImpulse+momentSeed[4*i+a]*(a?diff(2,4*(n+i)+1+a):diff(2,4*i+1));
              total+=wrench;
              if(composed)total+=turbulence[4*i+a]*diff(0,8*i+3+a);
              // A distance perturbation here changes only solid-wall shear
              // in the momentum and wrench. Its equal opposite impulse is
              // stored separately at full relative precision.
              wallResolved+=wrench-(volume>0?seeds[4*i+a]*bodyImpulse/volume:0);
            }total+=seeds[4*i+3]*diff(0,8*i+6);
          }
          const rawSecant=total/(2*step),secant=mode===6?wallResolved/(2*step):rawSecant;
          estimates.push({step,secant,rawSecant,normalizedError:Math.abs(secant-derivative)/Math.max(1e-14,scale)});
        }
        rows.push({objective:onlyBody?'wall force and moment':'momentum, diagonal and wall wrench',input:name,derivative,scale,estimates});
      }
    }
    return {pass:rows.length===(composed?12:16)&&rows.every(r=>r.estimates.every(e=>e.normalizedError<.004)),
      operator:composed?'full stationary cut-volume momentum and SST prediction':'extensive raw momentum prediction and wall wrench',
      dims,rotating,mergedCells:groups.stats.mergedCells,rows};
  }finally{gpu.close();}
}
