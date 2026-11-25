import {cellCenter,gpuScope,nativeFlowRegime} from '../../plugin.js';

// An exact wall-normal polynomial gives a known viscous shear at y=0.
// Evaluate the two samples at actual cell centres to keep the analytic
// polynomial independent of the trilinear interpolation error.
export async function verifyFlowRegime(device){
  const gpu=gpuScope(device),dims=[16,8,8],n=1024,h=.006,dt=.0005,nu=1e-5,sound=320,origin=[0,0,0];
  const axes=dims.map((size,a)=>Float64Array.from({length:size+1},(_,i)=>h*i*(1+.012*(a+1)*i)));
  const f={dims,axes,h,nu,origin,maxSpeed:1,omega:0},state=new Float32Array(8*n),mu=new Float32Array(4*n).fill(1);
  const rates=[0,20,80],rate=i=>rates[Math.min(2,Math.floor(i/5))],curvature=140;
  const y1=cellCenter(f,1,0),y2=cellCenter(f,1,2),velocity=(x,y)=>rate(x)*y+(rate(x)?curvature*y*y:0);
  let peak=0;const results=[];
  try{
    for(let i=0;i<n;i++){
      const x=i%16,y=cellCenter(f,1,Math.floor(i/16)%8),u=velocity(x,y);
      state[8*i]=u*dt/h;if(x===15){mu[4*i+3]=0;state[8*i]=20000;}else peak=Math.max(peak,u);
      state[8*i+5]=(x===15?1e5:2*x)*nu*dt/h**2;
    }
    const sites=new Float32Array(3*3*16),packed=new Uint32Array(sites.buffer),areas=[.25,1,2],cover=new Float32Array(9).fill(1);
    for(let t=0;t<3;t++)for(let j=0;j<3;j++){
      const i=3*t+j,k=16*i,ix=5*t+1,iz=1+j;
      sites.set([cellCenter(f,0,ix),0,cellCenter(f,2,iz),areas[t]/3,0,1,0,y1/(y2-y1)],k);
      packed[k+11]=ix+128*iz;packed[k+15]=ix+32+128*iz;
      if(t===2)cover[i]=.25;
    }
    const s=gpu.buffer('Analytic velocity and solid sentinel',state),m=gpu.buffer('Manufactured fluid region',mu);
    const chunk={triangles:3,site:gpu.buffer('Analytic wall sample sites',sites),cover:gpu.buffer('Partial surface quadrature coverage',cover)};
    function spalding(speed,distance){
      let lo=0,hi=100;
      for(let i=0;i<60;i++){
        const up=.5*(lo+hi),x=.41*up,y=up+(Math.expm1(x)-x-x*x/2-x*x*x/6)/9.8;
        if(y*up>speed*distance/nu)hi=up;else lo=up;
      }return distance*speed/(nu*.5*(lo+hi));
    }
    for(const modeled of [false,true]){
      const v=await nativeFlowRegime(device,{...f,wallModeled:modeled},dt,s,m,[chunk],sound,()=>{});
      const y=v.yPlusPercentiles,expected=rates.slice(1).map((G,i)=>modeled?spalding(velocity(5*i+6,y1),y1):y1*Math.sqrt(nu*G)/nu);
      const relative=Math.max(...[y.p50,y.p95].map((val,i)=>Math.abs(val/expected[i]-1)));
      const nearSpeed=velocity(11,y2),expectedMach=peak/sound;
      const pass=relative<.012&&Math.abs(v.maxEddyViscosityRatio-28)<1e-5&&Math.abs(y.sampledAreaM2-1.75)<1e-6&&Math.abs(y.meanFirstDistanceM-y1)<1e-8&&
        Math.abs(y.meanSecondDistanceM-y2)<1e-8&&Math.abs(v.maxFluidMach-expectedMach)<1e-8&&
        Math.abs(v.maxSampledWallRelativeMach-nearSpeed/sound)<1e-8&&Math.abs(v.compressibilityErrorEstimate-.5*expectedMach**2)<1e-9;
      results.push({modeled,expected,relativeError:relative,pass,regime:v});
    }
    const empty=await nativeFlowRegime(device,f,dt,s,m,[],sound,()=>{});
    return {pass:results.every(v=>v.pass)&&empty.yPlusPercentiles.p50===null&&empty.maxSampledWallRelativeMach===null&&empty.maxFluidMach>0,
      results,empty};
  }finally{gpu.close();}
}

export async function verifyModeledRegime(){
  const call=(name,args={})=>frameAI.call(name,args);await call('scene.new');
  const U=.065,box=await call('scene.create',{type:'cfd',params:{Speed:U}});
  const body=await call('scene.create',{type:'sphere',params:{diameter:80,'angle approximation':10}});
  await call('transform.apply',{ids:[body.hash],position:[0,500,0],coordinates:'world'});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args}),start=performance.now();
  await op('solve-frame',{fidelityBudget:'preview'});
  for(;;){
    await new Promise(resolve=>setTimeout(resolve,200));const s=await op('results');
    if(s.state==='ready'||s.state==='unconverged'){
      const r=s.result,v=r.validity,y=v.yPlusPercentiles;
      return {pass:r.method==='SST wall-modeled'&&v.turbulenceClosure==='SST delayed detached-eddy simulation'&&v.maxEddyViscosityRatio>0&&
        v.wallDistance.propagationPasses>0&&v.cutMomentum.cutCells>0&&v.cutMomentum.mergedCells>0&&
        /^[0-9a-f]{64}$/.test(v.momentumTopologyHash)&&v.sameMomentumGroupsAsPrev===false&&v.previousJob===null&&
        v.maxFluidMach>r.referenceMach&&y.p50>0&&y.p95>=y.p50&&
        y.method==='Spalding smooth-wall shear'&&Math.abs(y.sampledAreaM2/r.pressureStats.sampledAreaM2-1)<1e-5&&
        v.maxDivergencePerS<1e-6,elapsedMs:performance.now()-start,state:s.state,steps:r.steps,Re:r.reynolds,
        pressureSampledAreaM2:r.pressureStats.sampledAreaM2,dragN:r.forceLocal.drag,forceWorld:r.forceWorld,torqueNm:r.torque,
        ci95Drag:r.uncertainty.ci95Drag,windows:r.completeWindows,initialization:r.initialization,validity:v};
    }
    if(!['queued','solving'].includes(s.state)||performance.now()-start>15*60*1000)
      throw Error('Modeled flow regime '+JSON.stringify(s.job));
  }
}
