import {cartesianSolver,cutGroups,gpuScope,wallResistanceWGSL} from '../../plugin.js';

// Driver & Seegmiller (1985), straight opposite wall. Dimensional inputs
// use the corrected NASA 2DBFS step Reynolds number. The inlet is the
// measured x/H=-4 profile. No downstream observations enter the solver.
// https://tmbwg.github.io/turbmodels/backstep_val.html
// https://tmbwg.github.io/turbmodels/Backstep_validation/profiles.exp.dat
const H=.0127,U=44.2,nu=U*H/36000;
// y/H, u/Uref, and 1000 times uu, vv, uv divided by Uref squared.
const incoming=[
  [1.10,.657,5.16,2.70,-1.02],[1.15,.696,5.26,2.19,-1.01],[1.20,.719,4.67,2.23,-1.07],
  [1.30,.760,3.86,2.32,-1.07],[1.40,.790,3.49,2.10,-.97],[1.50,.818,3.06,2.05,-.92],
  [1.70,.870,2.58,1.64,-.71],[2.00,.926,1.80,1.18,-.44],[2.40,.982,.86,.63,-.10],
  [2.80,1.003,.42,.32,.02],[3.20,1.003,.39,.30,.03],[3.60,1,.37,.28,.04],
  [4.00,1.001,.37,.28,.03],[5.00,1.001,.37,.27,.03],[6.00,1,.36,.26,.04],
  [7.50,1.001,.37,.28,.04],[8.20,.943,1.60,1.28,.46]
];
const profileReference=[[1,.30,-.035],[1,1,.519],[1,1.5,.851],[4,.30,-.057],[4,1,.656],[4,1.5,.856],
  [6,.30,.248],[6,1,.686],[6,1.5,.834],[10,.30,.471],[10,1,.712],[10,1.5,.839]];
function bisect(fn,lo,hi){
  for(let i=0;i<48;i++){const x=.5*(lo+hi);if(fn(x)>0)hi=x;else lo=x;}
  return .5*(lo+hi);
}
function wallYPlus(uPlus){
  const a=.41*uPlus;return uPlus+(Math.expm1(a)-a-.5*a*a-a*a*a/6)/9.8;
}
const friction=bisect(u=>.1*H*u/nu-wallYPlus(.657*U/u),.015*U,.10*U);
const upperScale=.8/(1+.4*(.943-.926)/(.982-.926));
function inlet(y){
  if(y<=1||y>=9)return [0,0,1,0];
  function data(y){
    if(y>8.2){
      const r=data(1+(9-y)/upperScale);
      const at=data(1+.8/upperScale),last=incoming.at(-1);
      return [r[0],r[1]*last[2]/at[1],r[2]*last[3]/at[2],-r[3]*last[4]/(-at[3])];
    }
    if(y<1.1){
      const yplus=(y-1)*H*friction/nu,uplus=bisect(u=>wallYPlus(u)-yplus,0,32),damping=Math.min(1,((y-1)/.1)**2);
      return [uplus*friction/U,...incoming[0].slice(2).map(v=>v*damping)];
    }
    const hi=Math.max(1,incoming.findIndex(r=>r[0]>=y)),a=incoming[hi-1],b=incoming[hi],t=(y-a[0])/(b[0]-a[0]);
    return a.slice(1).map((v,j)=>v+t*(b[j+1]-v));
  }
  const [u,uu,vv,uv]=data(y),d=Math.min(y-1,9-y),delta=Math.min(.001,.4*d);
  const gradient=(data(y+delta)[0]-data(y-delta)[0])*U/(2*delta*H);
  const k=.00075*(uu+vv)*U**2,stress=-.001*uv*U**2;
  const mixing=Math.pow(.09,.25)*Math.sqrt(k)*Math.min(.41*d,.07*8)*H;
  const eddy=stress*gradient>0&&Math.abs(uv)>.05?stress/gradient:mixing;
  return [u*U,k,k/Math.max(1e-12,eddy),eddy];
}
function meshAxis(sections){
  const values=[];
  for(const [start,end,count,stretch=0] of sections){
    for(let i=0;i<count;i++){const t=i/count;values.push(H*(start+(end-start)*(t-stretch*Math.sin(2*Math.PI*t)/(2*Math.PI))));}
  }
  values.push(H*sections.at(-1)[1]);return Float64Array.from(values);
}
function reattachment(x,cf){
  let start=null,width=0,attachment=null;
  for(let i=1;i<x.length;i++){
    if(x[i]<=0)continue;
    if(start===null&&cf[i]<0)start=x[i-1]<=0?0:x[i-1]+(x[i]-x[i-1])*cf[i-1]/(cf[i-1]-cf[i]);
    if(start!==null&&cf[i]>=0){
      const end=x[i-1]+(x[i]-x[i-1])*(-cf[i-1])/(cf[i]-cf[i-1]);
      if(end-start>width){attachment=end;width=end-start;}
      start=null;
    }
  }
  return start!==null&&x.at(-1)-start>width?null:attachment;
}

export async function verifyBackwardStep(device){
  const gpu=gpuScope(device),xs=meshAxis([[-4,-1,16],[-1,12,104],[12,20,24],[20,44,32]]);
  const ys=meshAxis([[0,1,16,.7],[1,9,56,.75]]),zs=meshAxis([[0,1,8]]);
  const axes=[xs,ys,zs],dims=axes.map(a=>a.length-1),[nx,ny,nz]=dims,n=nx*ny*nz;
  const centers=axes.map(a=>Array.from(a.subarray(1),(v,i)=>(v+a[i])*.5/H)),[x,y]=centers;
  const minPitch=axes.map(a=>a.subarray(1).reduce((m,v,i)=>Math.min(m,v-a[i]),Infinity)),h=Math.min(...minPitch);
  const rows=y.map(v=>inlet(v).slice(0,3));
  const f={dims,axes,origin:axes.map(a=>a[0]),h,minPitch,nu,U,rho:1.20,maxSpeed:U,period:H/U,omega:0,rotor:false,laminar:false,
    wallModeled:true,cutCells:true,sstWall:true,faceHistory:true,incrementalPressure:true,globalPressure:true,fluxEquilibration:true,
    domainWalls:[null,null,[0,0,0],[0,0,0],null,null],pressureOpen:[false,true,false,false,false,false],tunnelSymmetry:true,inletRows:rows};
  const scheduler={async perform(phases,check){check?.();const e=device.createCommandEncoder();for(const p of phases)p.encode(e);device.queue.submit([e.finish()]);}};
  // The published -4H table starts at 1.1H. Its measured part determines
  // the integral up to the unknown contribution 0 <= u(1-u) <= 1/4 there.
  const measured=incoming.filter(r=>r[0]<=5);
  let thetaMeasured=0;
  for(let i=1;i<measured.length;i++){
    const [yl,a]=measured[i-1],[yr,b]=measured[i];
    thetaMeasured+=(yr-yl)*((a+b)/2-(a*a+a*b+b*b)/3);
  }
  const thetaBounds=[thetaMeasured,thetaMeasured+.25*(measured[0][0]-1)].map(t=>36000*t);
  function fluid(i,j){return !(x[i]<0&&y[j]<1);}
  try{
    const blocks=new Float32Array(4*n),distance=new Float32Array(4*n);
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const m=4*(i+nx*(j+ny*k)),wet=fluid(i,j);
      blocks.set([Number(wet&&fluid(Math.min(i+1,nx-1),j)),Number(wet&&fluid(i,Math.min(j+1,ny-1))),Number(wet),Number(wet)],m);
      const dx=x[i],dy=y[j]-1;
      distance[m]=(Math.hypot(Math.max(0,dx),Math.max(0,dy))+Math.min(0,Math.max(dx,dy)))*H/h;
    }
    const wall=gpu.buffer('Step wall distance',distance),mu=gpu.buffer('Step fluid volumes and openings',blocks),force=gpu.buffer('Step reaction',4*n);
    const groups=await cutGroups(gpu,f,mu,wall),dt=groups.stableStep;
    const profile=gpu.buffer('Step window of physical floor shear and velocity profiles',4*(nx+12));
    const stage=gpu.staging('Step floor and laser traverse readback',profile.size);
    function interval(coordinates,at){
      const b=coordinates.findIndex(v=>v>=at),a=b-1;return [a,(at-coordinates[a])/(coordinates[b]-coordinates[a])];
    }
    const stations=profileReference.map(([xx,yy])=>[...interval(x,xx),...interval(y,yy)]);
    const gather=await gpu.kernel('Step spanwise and temporal shear integral',wallResistanceWGSL+`
      @group(0) @binding(0) var<storage,read> state:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> series:array<f32>;
      const station=array<vec4f,12>(${stations.map(v=>'vec4f('+v.join(',')+')').join(',')});
      fn velocity(i:u32,j:u32,k:u32)->vec3f{return state[2u*(i+${nx}u*(j+${ny}u*k))].xyz*${h/dt};}
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=arrayLength(&series)){return;}var sum=0.;
        for(var k=0u;k<${nz}u;k++){
          if(i<${nx}u){let u=velocity(i,0u,k);sum+=u.x*wallResistance(length(u.xz),${ys[1]*.5},${nu})*${2/U**2};}
          else{let s=station[i-${nx}u];let a=u32(s.x);let b=u32(s.z);
            let lo=mix(velocity(a,b,k).x,velocity(a+1u,b,k).x,s.y);let hi=mix(velocity(a,b+1u,k).x,velocity(a+1u,b+1u,k).x,s.y);
            sum+=mix(lo,hi,s.w)/${U};}
        }series[i]+=sum/${nz}.;
      }`);
    const grid=[Math.ceil((nx+12)/64)];
    const fields={async bind(p,state){const group=gpu.bind(gather,[state,profile]);return e=>gpu.dispatch(e,gather,group,grid);}};
    const solver=await cartesianSolver(gpu,f,dt,wall,force,mu,groups,null,null,fields);
    const windows=[],start=performance.now();let step=0,stable=false,last=null,attachment=null,prior=null;
    for(let age=5;age<=160;age+=5){
      const begin=step,end=Math.round(age*f.period/dt),e=device.createCommandEncoder();e.clearBuffer(profile);device.queue.submit([e.finish()]);
      for(;step<end;step++){
        await solver.advance(step,false,scheduler,()=>{});
        if(solver.fluxConvergence.missedSteps)throw Error('Step flux failed at '+step+': '+JSON.stringify(solver.fluxConvergence));
      }
      const total=await gpu.read(profile,stage,nx+12),weight=step-begin,mean=Array.from(total,v=>v/weight);
      const combined=prior?mean.map((_,i)=>(total[i]+prior.values[i])/(weight+prior.weight)):mean;
      last=combined;prior={values:total,weight};attachment=reattachment(x,combined);
      const current=reattachment(x,mean);
      windows.push({timeInStepHeights:age,reattachmentOverH:current});
      console.log('CFD live backward step xR/H='+current+' at tU/H='+age);
      const recent=windows.slice(-4).map(v=>v.reattachmentOverH);
      stable=age>=55&&recent.every(Number.isFinite)&&Math.max(...recent)-Math.min(...recent)<.035;
      if(stable)break;
    }
    const error=attachment===null?null:Math.abs(attachment/6.26-1);
    const actual=gpu.buffer('Step inlet normal discharges',4*ny),read=gpu.staging('Step inlet verification',actual.size);
    const inletFlux=await gpu.kernel('Step prescribed inlet velocity from stored face discharges',`
      struct Flux{hi:vec4f,lo:vec4f}
      @group(0) @binding(0) var<storage,read> q:array<Flux>;@group(0) @binding(1) var<storage,read> tail:array<Flux>;
      @group(0) @binding(2) var<storage,read_write> out:array<f32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
        let j=g.x;if(j>=${ny}u){return;}var sum=0.;for(var k=0u;k<${nz}u;k++){
          let i=${nx}u*(j+${ny}u*k);sum+=q[i].lo.x+tail[i].lo.x;
        }out[j]=sum;}`);
    gpu.run(inletFlux,[solver.flux,solver.fluxTail,actual],[Math.ceil(ny/64)]);
    const discharge=await gpu.read(actual,read,ny),span=zs.at(-1)-zs[0];
    const normal=Array.from(discharge,(v,j)=>v*h**3/(dt*U*(ys[j+1]-ys[j])*span));
    const theta=normal.reduce((s,u,j)=>s+(y[j]>1&&y[j]<5?u*(1-u)*(ys[j+1]-ys[j])/H:0),0)*36000;
    const inletPeakError=Math.max(...incoming.map(([coord,target])=>{
      const [j,a]=interval(y,coord);return Math.abs(normal[j]*(1-a)+normal[j+1]*a-target);
    }));
    const velocities=profileReference.map(([xOverH,yOverH,reference],i)=>({xOverH,yOverH,reference,uOverU:last[nx+i]}));
    return {pass:stable&&error!==null&&error<.1&&theta>=thetaBounds[0]&&theta<=thetaBounds[1]&&inletPeakError<.015&&solver.fluxConvergence.maxDivergencePerS<1e-6,
      reference:'Driver & Seegmiller, NASA TMR 2DBFS, straight upper wall',ReH:36000,heightM:H,inflowMps:U,nuM2PerS:nu,
      reynoldsMomentumThicknessAtInlet:theta,measuredInletThetaReBounds:thetaBounds,nominalPreStepThetaRe:5000,inletPeakErrorOverU:inletPeakError,
      missingSpanwiseVariance:'mean of measured streamwise and normal variances',
      dimensions:dims,firstFloorCenterOverH:y[0],dtS:dt,steps:step,stable,windows,elapsedMs:performance.now()-start,
      referenceReattachmentOverH:6.26,referenceUncertaintyOverH:.10,reattachmentOverH:attachment,relativeError:error,
      maxDivergencePerS:solver.fluxConvergence.maxDivergencePerS,velocities,
      floor:x.map((position,i)=>({xOverH:position,cf:position>0?last[i]:null}))};
  }finally{gpu.close();}
}
