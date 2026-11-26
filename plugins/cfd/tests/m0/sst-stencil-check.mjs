import {cartesianSolver,cutGroups,gpuScope} from '../../plugin.js';

export const verifySstStencil=device=>study(device,false);
export const verifyModeledTurbulence=device=>study(device,true);
export const verifyRotatingTurbulence=device=>study(device,true,true);

async function study(device,withWall,rotating=false){
  const dims=[20,16,12],[nx,ny]=dims,n=dims.reduce((a,b)=>a*b),h=.004,dt=.0002;
  const axes=dims.map((d,a)=>Float64Array.from({length:d+1},(_,j)=>h*j*(1+.007*j+.018*a)));
  const point=i=>[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))],stride=[1,nx,nx*ny];
  const mu=new Float32Array(4*n),wall=mu.slice(),state=new Float32Array(8*n),baseFlow=state.slice(),vFlow=state.slice();
  for(let i=0;i<n;i++){
    const [x,y,z]=point(i),distance=Math.max(5.7-x,x-12.2,4.4-y,y-9.6,2.2-z,z-7.3);
    mu[4*i+3]=Math.max(0,Math.min(1,.5+distance));wall[4*i]=distance;
    state.set([.035*x-.017*y+.008*Math.sin(.78*z),.025*Math.cos(.37*x+.13*y),.04*Math.sin(.28*z-.5*x),
      .0023+.00018*x+.0006*Math.sin(.61*y+.31*z),.065+.002*y+.009*Math.cos(.51*x+.3*z),
      .0014+.001*(1+Math.sin(.39*x+.47*z)),0,0],8*i);
  }
  for(let i=0;i<n;i++){
    const p=point(i);
    for(let a=0;a<3;a++){
      const k=i+stride[a],interior=p[a]+1<dims[a],vol=mu[4*i+3];
      const smaller=interior?Math.min(vol,mu[4*k+3]):0;
      const open=smaller===1?1:smaller*(.81+.19*Math.sin(.39*i+.78*a)**2);
      mu[4*i+a]=open;
      const aperture=interior?open:a===0?1:0;
      const q=Math.fround((Math.sin(.19*i+.77*a)>.15?1:-1)*(.012+.019*Math.cos(.24*i+.2*a)**2)*aperture);
      const v=Math.fround(.011*Math.sin(.61*i+.7*a)*aperture);
      baseFlow[8*i+a]=q;vFlow[8*i+a]=v;
      if(interior){baseFlow[8*k+4+a]=q;vFlow[8*k+4+a]=v;}
      if(p[a]===0&&a===0){baseFlow[8*i+4]=.018;vFlow[8*i+4]=.004*Math.cos(.11*i);}
    }
  }
  const rows=[];
  for(const ddes of [false,true]){
    const gpu=gpuScope(device),f={dims,h,axes,U:1.2,maxSpeed:3,origin:[0,0,0],nu:1.53e-5,rho:1.2,period:.08,
      wallModeled:true,cutCells:true,sstWall:true,ddes,laminar:false,rotor:false,omega:0,mergeToFluid:false,
      domainWalls:[null,null,[.7,0,.12],null,null,null],tunnelSymmetry:true,pressureOpen:[false,true,false,false,false,false]};
    if(rotating)Object.assign(f,{rotor:true,rotatingFrame:true,groupTransport:true,omega:-19,sstWall:false,faceHistory:true,implicitRadiusM:.044});
    try{
      const m=gpu.buffer('Native experiment aperture field',mu),w=gpu.buffer('Physical wall and merged volume',wall);
      const groups=await cutGroups(gpu,f,m,w),solver=await cartesianSolver(gpu,f,dt,w,gpu.buffer('Wall force',4*n),m,groups);
      const seeds=new Float32Array(4*n),seed=gpu.buffer('Bulk objective seeds',seeds);
      const jac=await (withWall?solver.modeledTurbulenceAdjoint(seed):solver.bulkTurbulenceAdjoint(seed));
      const stage=gpu.staging('Measured turbulence derivatives',32*n);
      const read=b=>gpu.read(b,stage,b.size/4);
      const dispatch=fn=>{const e=device.createCommandEncoder();fn(e);device.queue.submit([e.finish()]);};
      for(const boundaryOnly of [false,true]){
        for(let i=0;i<n;i++){
          const [x,y,z]=point(i),active=!boundaryOnly||x<2||x>=nx-2||y<2||z<2||mu[4*i+3]>0&&mu[4*i+3]<1;
          for(let a=0;a<4;a++)seeds[4*i+a]=active&&(!withWall||rotating||a<3)?(.3+.2*a)*Math.cos(.27*x+.53*y-.39*z+.7*a):0;
        }
        device.queue.writeBuffer(seed,0,seeds);device.queue.writeBuffer(solver.state,0,state);device.queue.writeBuffer(solver.flux,0,baseFlow);
        dispatch(jac.encode);
        const old=await read(jac.old),faces=await read(jac.face);
        if(!old.every(Number.isFinite)||!faces.every(Number.isFinite))throw Error('Nonfinite spatial SST transpose.');
        for(const [mode,name] of ['velocity','k','omega','eddy viscosity','shared face discharge','one incidence'].entries()){
          const direction=state.map((_,k)=>{const a=k%8,i=Math.floor(k/8);
            if(!mu[4*i+3])return 0;
            const v=Math.sin(.73*i+.9*a+.4)*Math.cos(.021*i);
            return mode===0&&a<3?.03*v:mode===1&&a===3?.001*v:mode===2&&a===4?.02*v:mode===3&&a===5?.0017*v:0;
          });
          const faceDirection=vFlow.map((v,k)=>mode===4||mode===5&&k%8<3?v:0);
          let predicted=0,scale=0;
          for(let i=0;i<old.length;i++){const t=old[i]*direction[i],q=faces[i]*faceDirection[i];predicted+=t+q;scale+=Math.abs(t)+Math.abs(q);}
          const estimates=[];
          // Eddy viscosity influences the extensive bulk outputs through a
          // small dt-scaled transport increment. Resolve that increment above
          // the FP32 rounding of the complete predicted state.
          // In the shaft frame the implicit donor has been removed from this
          // predictor. Resolve the smaller limited flux correction in FP32
          // while keeping the signed discharge perturbation below 1.5%.
          for(const step of rotating&&mode>=4?[.016,.008]:mode===3?[.008,.004]:[.002,.0006]){
            const fields=[];
            for(const sign of [-1,1]){
              device.queue.writeBuffer(solver.state,0,state.map((v,i)=>v+sign*step*direction[i]));
              device.queue.writeBuffer(solver.flux,0,baseFlow.map((v,i)=>v+sign*step*faceDirection[i]));
              dispatch(jac.predict);fields.push(await read(solver.predicted));
            }
            let secant=0;
            for(let i=0;i<n;i++)for(const [a,slot] of [3,4,5,7].entries()){
              const k=8*i+slot;secant+=seeds[4*i+a]*(fields[1][k]-fields[0][k])/(2*step);
            }
            estimates.push({step,secant,normalizedError:Math.abs(secant-predicted)/Math.max(1e-20,scale)});
          }
          rows.push({closure:ddes?'DDES':'SST',seed:boundaryOnly?'boundaries':'full domain',input:name,adjoint:predicted,
            absoluteDirectionalContributions:scale,estimates,mergedCells:groups.stats.mergedCells});
        }
      }
    }finally{gpu.close();}
  }
  return {pass:rows.length===24&&rows.every(r=>r.mergedCells>0&&r.absoluteDirectionalContributions>1e-5&&
    r.estimates.every(s=>s.normalizedError<.004)),operator:withWall?'merged wall and spatial SST prediction':'spatial SST prediction',rotating,dims,rows};
}
