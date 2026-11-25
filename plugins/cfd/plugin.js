// Native CFD authoring, surface kinematics and finite-volume flow on Frame's renderer.
const failure=(code,message)=>Object.assign(new Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
export const LOCAL_BOX=Object.freeze({min:Object.freeze([-500,0,-500]),max:Object.freeze([500,1000,500]),pivot:Object.freeze([-500,0,-500])});
export function validateParameters(params){
  if(!Number.isFinite(params.Speed)||params.Speed<0)throw failure('INVALID_ARGUMENT','Speed must be a finite nonnegative value in m/s.');
  if(!Number.isFinite(params.Altitude))throw failure('INVALID_ARGUMENT','Altitude must be finite, in metres.');
  if(!['Air','Water'].includes(params.Medium))throw failure('INVALID_ARGUMENT','Medium must be Air or Water.');
  if(!['None','Road'].includes(params.Ground))throw failure('INVALID_ARGUMENT','Ground must be None or Road.');
}
export function helperLines(){
  const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],lines=[];
  for(let i=0;i<4;i++)lines.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
  // Face-to-face local-X direction marker, never a streamline or a result.
  lines.push(-500,500,0,500,500,0,500,500,0,420,550,0,500,500,0,420,450,0);
  return new Float32Array(lines);
}
// Physical coordinates have an orthonormal basis. A sheared or scaled CFD
// owner still carries real millimetres along each of its authored directions.
const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
export function boxAxes(world){
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function unit(v){const length=Math.hypot(...v);if(!Number.isFinite(length)||length===0)throw Error('Degenerate CFD frame');return v.map(x=>x/length);}
  const columns=[0,4,8].map(i=>Array.from(world.slice(i,i+3)));
  const x=unit(columns[0]);let up=unit(cross(columns[2],x));const scale=dot(up,columns[1]);
  if(!Number.isFinite(scale)||scale===0)throw Error('Degenerate CFD frame');
  if(scale<0)up=up.map(v=>-v);
  return [x,up,cross(x,up)];
}
export function boxMetric(world){
  const columns=[0,4,8].map(i=>Array.from(world.slice(i,i+3))),axes=boxAxes(world);
  return [...columns.flatMap(col=>[...axes.map(axis=>.001*dot(axis,col)),0]),0,0,0,1];
}

// Shares the SDK's visibility, occurrence transforms, relative-revision checks
// and native buffer / paged-texture storage. No polygon readback or mesh copy.
export function captureFlowSurfaces(device,context,owner,origin=[0,0,0]){
  const options={bounds:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max]}},keys=['Speed','Medium','Altitude','Ground'];
  const snapshot=context.scene.capture(owner,keys,options),metric=boxMetric(context.document.world(owner));
  if(snapshot.device!==device)throw Error('CFD geometry belongs to a different device');
  function assertCurrent(){
    const current=boxMetric(context.document.world(owner));
    if(context.device!==device||context.scene.signature(owner,keys,options)!==snapshot.signature||
      current.some((v,i)=>Math.abs(v-metric[i])>64*Number.EPSILON*Math.max(.001,Math.abs(v),Math.abs(metric[i])))){
      throw Object.assign(Error('CFD source geometry or physical frame changed'),{code:'STALE_CFD_GEOMETRY'});
    }
  }
  const shift=metric.slice();for(let i=0;i<3;i++)shift[12+i]=-origin[i];
  const meshes=snapshot.meshes.map(mesh=>{
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let k=0;k<8;k++){
      const corner=mesh.bounds.min.map((v,axis)=>k&(1<<axis)?mesh.bounds.max[axis]:v);
      const p=context.math.point(shift,corner);for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],p[axis]);bounds.max[axis]=Math.max(bounds.max[axis],p[axis]);}
    }
    return {...mesh,bounds,ownerMatrix:mesh.matrix,matrix:context.math.mul(shift,mesh.matrix)};
  });
  return {meshes,assertCurrent,signature:snapshot.signature,contentSignature:snapshot.contentSignature,params:snapshot.params};
}

// Recover the unwrapped slope of a native piecewise-linear Euler curve.
// At 5011 rpm a 60 Hz pose stream has less than one sample per revolution.
export function axialTrackRate(track,fps){
  const keys=track?.keys;if(!Number.isFinite(fps)||fps<=0||!Array.isArray(keys)||keys.length<2)return null;
  let rate=null;
  for(let i=0;i<keys.length;i++){
    const [t,k]=keys[i];if(!Number.isFinite(t)||!Array.isArray(k.v)||k.v.length!==3||!k.v.every(Number.isFinite)||
      Math.abs(k.v[1])+Math.abs(k.v[2])>1e-8||(k.modes?.[0]??k.interp)!=='hard'||
      k.axes&&!k.axes.includes(0))return null;
    if(i){
      const span=t-keys[i-1][0];if(span<=0)return null;
      const w=(k.v[0]-keys[i-1][1].v[0])*Math.PI/180*fps/span;
      if(rate!==null&&Math.abs(w-rate)>1e-8*Math.max(1,Math.abs(rate)))return null;rate=w;
    }
  }
  return rate&&Number.isFinite(rate)?{omega:rate,first:keys[0][0],last:keys.at(-1)[0]}:null;
}

export function frozenWallMotion(device,ctx,owner,{allowStationary=false}={}){
  const initial=captureFlowSurfaces(device,ctx,owner),ids=[...new Set(initial.meshes.map(m=>m.hash))];
  const inputs=[owner,...ids],animation=ctx.animation.inspect(inputs);
  const flowParameters=new Set(['Speed','Altitude','Ground','Medium']);
  const channels=animation.channels.filter(c=>!c.path.startsWith('material:')&&
    !(c.id===owner&&flowParameters.has(c.path.replace(/^param:/,''))));
  const doc=new Map(animation.objects.map(o=>[o.id,o]));
  const signatureOf=a=>JSON.stringify([a.objects,a.channels]),signature=signatureOf(animation);
  function verifyAnimation(capture){
    const a=ctx.animation.inspect(inputs);capture.assertCurrent();
    if(a.fps!==animation.fps||a.frame!==animation.frame||signatureOf(a)!==signature)
      throw Error('Native animation or sample time changed during the CFD solve');
  }
  if(animation.objects.some(o=>o.plugin&&o.plugin!=='cfd'))throw Error('A physical plugin source requires evaluated surface velocities');
  if(!channels.length&&allowStationary)return {capture:initial,motion:null,frame:animation.frame,fps:animation.fps,assertCurrent:()=>verifyAnimation(initial)};
  if(!ids.length||ids.length!==initial.meshes.length||ids.some(id=>doc.get(id)?.type!=='mesh'))
    throw Error('Rigid rotation requires directly evaluated polygon components');
  const boxOwners=new Set();
  for(let p=owner;doc.has(p)&&!boxOwners.has(p);p=doc.get(p).parent)boxOwners.add(p);
  const spinOwners=new Set();
  const motions=ids.map(id=>{
    const owners=new Set();for(let p=id;doc.has(p)&&!owners.has(p);p=doc.get(p)?.parent)owners.add(p);
    const tracks=channels.filter(c=>owners.has(c.id));
    if(tracks.length===1)spinOwners.add(tracks[0].id);
    return tracks.length===1&&tracks[0].path==='rotation'?axialTrackRate(tracks[0].track,animation.fps):null;
  });
  if(channels.some(c=>boxOwners.has(c.id)||!spinOwners.has(c.id)||c.path!=='rotation')||animation.objects.some(o=>o.target)||motions.some(m=>!m))
    throw Error('Expected one unconstrained constant native rotation per component or rigid parent');
  const omega=motions[0].omega;if(motions.some(m=>Math.abs(m.omega-omega)>1e-8*Math.abs(omega)))throw Error('Independent angular speeds in one rotating frame');
  const first=Math.max(...motions.map(m=>m.first)),last=Math.min(...motions.map(m=>m.last)),held=animation.frame;
  if(held<first||held>last||last<=first)throw Error('The current frame must be inside a shared constant-speed interval');
  const {mul,inv}=ctx.math,base=new Map(initial.meshes.map(m=>[m.hash,m.matrix]));
  const worldToPhysical=box=>mul(boxMetric(box),inv(box)),physicalToWorld=inv(worldToPhysical(ctx.document.world(owner)));
  const offsets=new Map(ids.map(id=>[id,mul(inv(ctx.document.world(id)),mul(physicalToWorld,base.get(id)))]));
  const read=frame=>{
    const answer=ctx.animation.sampleTransforms([owner,...ids],frame/animation.fps),fromWorld=worldToPhysical(answer.objects[0].world);
    return new Map(answer.objects.slice(1).map(o=>[o.id,mul(fromWorld,mul(o.world,offsets.get(o.id)))]));
  };
  const heldPoses=read(held);
  for(const [id,m] of base)if(!ctx.math.equal(m,heldPoses.get(id),1e-8))throw Error('The sampled shaft pose disagrees with the evaluated surface');
  // Choose two distinct physical angles even when complete turns occur between
  // adjacent editor frames. Sampling never seeks or rewrites the document.
  const forward=last-held>=held-first,span=forward?last-held:held-first;
  const increment=Math.min(.5*span,Math.PI/3*animation.fps/Math.abs(omega))*(forward?1:-1);
  const samples=[held+increment,held+2*increment];
  const errors=[0,0],poses=[];let identifiable=false;
  for(const t of samples){
    const pose=read(t),angle=omega*(t-held)/animation.fps;
    poses.push({pose,angle});
    identifiable||=Math.abs(Math.sin(angle))>.01;
    for(const [i,sign] of [1,-1].entries()){
      const c=Math.cos(angle),s=sign*Math.sin(angle);
      for(const [id,m] of base){
        const b=pose.get(id);if(!b)throw Error('Participating geometry changed during the spin');
        for(const a of [0,4,8]){
          const y=m[a+1],z=m[a+2],dy=b[a+1],dz=b[a+2];
          const scale=Math.max(1e-12,Math.hypot(m[a],y,z));
          errors[i]=Math.max(errors[i],Math.hypot(b[a]-m[a],dy-(c*y-s*z),dz-(s*y+c*z))/scale);
        }
      }
    }
  }
  if(!identifiable||Math.min(...errors)>2e-5)throw Error('Evaluated Frame poses do not verify the authored axial angular velocity');
  const sign=errors[0]<=errors[1]?1:-1,physical=sign*omega,axisOrigin=[base.get(ids[0])[12],0,0];let norm=0;
  // The renderer may centre component vertices separately. Fit a common
  // shaft line from the translations of all evaluated occurrences.
  for(const {pose,angle} of poses){
    const c=Math.cos(angle),s=sign*Math.sin(angle),d=1-c;
    for(const [id,m] of base){
      const v=pose.get(id),y=v[13]-c*m[13]+s*m[14],z=v[14]-s*m[13]-c*m[14];
      axisOrigin[1]+=d*y-s*z;axisOrigin[2]+=s*y+d*z;norm+=d*d+s*s;
    }
  }axisOrigin[1]/=norm;axisOrigin[2]/=norm;
  let positionErrorM=0;
  for(const {pose,angle} of poses){
    const c=Math.cos(angle),s=sign*Math.sin(angle);
    for(const [id,m] of base){
      const v=pose.get(id),y=m[13]-axisOrigin[1],z=m[14]-axisOrigin[2];
      positionErrorM=Math.max(positionErrorM,Math.hypot(v[12]-m[12],v[13]-axisOrigin[1]-c*y+s*z,v[14]-axisOrigin[2]-s*y-c*z));
    }
  }
  if(positionErrorM>2e-5)throw Error('Participating components rotate about distinct physical shaft lines');
  const capture=captureFlowSurfaces(device,ctx,owner,axisOrigin);
  const assertCurrent=()=>verifyAnimation(capture);
  assertCurrent();
  return {capture,assertCurrent,frame:held,fps:animation.fps,motion:{omega:physical,rpm:physical*60/(2*Math.PI),fps:animation.fps,heldFrame:held,
    firstFrame:first,lastFrame:last,axisOriginM:axisOrigin,verifiedFrames:samples,relativePoseError:Math.min(...errors),positionErrorM,signature}};
}

function combinedBounds(bounds){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const box of bounds)for(let a=0;a<3;a++){
    min[a]=Math.min(min[a],box.min[a]);max[a]=Math.max(max[a],box.max[a]);
  }
  return {min,max};
}

export function capturedDomain(ctx,owner,capture,tier,axisOrigin=[0,0,0],cellBudget=tier===1?750000:3000000){
  const metric=boxMetric(ctx.document.world(owner));
  for(let a=0;a<3;a++)metric[12+a]=-axisOrigin[a];
  const corners=Array.from({length:8},(_,k)=>ctx.math.point(metric,LOCAL_BOX.min.map((v,a)=>k&(1<<a)?LOCAL_BOX.max[a]:v)));
  const box=combinedBounds(corners.map(p=>({min:p,max:p})));
  const bodies=capture.meshes.length?combinedBounds(capture.meshes.map(m=>m.bounds)):box;
  const scale=Math.max(...bodies.max.map((v,k)=>v-bodies.min[k]))||Math.max(...box.max.map((v,k)=>v-box.min[k]));
  if(!(scale>0&&Number.isFinite(scale)))throw failure('INVALID_GEOMETRY','The CFD region has no finite physical extent.');
  const bounds=combinedBounds([box,bodies]),road=capture.params.Medium==='Air'&&capture.params.Ground==='Road';
  const origin=bounds.min.map((v,k)=>k===1&&road?box.min[1]:v-3*scale);
  const extent=bounds.max.map((v,k)=>v+(k===0?8:3)*scale-origin[k]);
  const cap=Math.min(Math.floor(ctx.device.limits.maxStorageBufferBindingSize/32),cellBudget);
  if(cap<512)throw failure('DEVICE_LIMIT','The GPU cannot contain one CFD brick.');
  let h=Math.max(scale/(tier*14),Math.cbrt(extent.reduce((a,b)=>a*b)/cap)),dims;
  for(;;){
    dims=extent.map(v=>Math.max(8,8*Math.ceil(v/(8*h))));
    if(dims.reduce((a,b)=>a*b)<=cap)break;
    h*=1.025;
  }
  return {origin,dims,h,scale,road,bodies,box};
}

export function gradeCapturedDomain(f,bounds,tier,cap){
  const extent=bounds.max.map((v,i)=>v-bounds.min[i]),size=Math.max(...extent);
  if(!(size>0))return f;
  const spanPitch=Math.sqrt(size*Math.max(size/16,Math.min(...extent)))/22;
  const pitches=extent.map(d=>Math.max(size/128,Math.min(spanPitch,Math.max(d,size/16)/16))/tier);
  return rectilinearDomain(f,bounds,pitches,cap);
}

function wallMotionReport(context,owner,points){
  const result=frozenWallMotion(context.device,context,owner,{allowStationary:true});
  const {motion,capture}=result,world=context.document.world(owner),axes=boxAxes(world);
  const origin=world.slice(12,15).map((x,k)=>.001*x+(motion?motion.axisOriginM.reduce((s,v,a)=>s+v*axes[a][k],0):0));
  const angularVelocity=axes[0].map(v=>v*(motion?.omega??0));
  const velocities=points.map(p=>context.math.cross(angularVelocity,p.map((v,k)=>v-origin[k])));
  result.assertCurrent();
  return {kind:motion?'rigid-rotation':'stationary',frame:result.frame,timeSec:result.frame/result.fps,
    occurrences:capture.meshes.length,axisOriginWorldM:motion?origin:null,angularVelocityWorldRadPerS:angularVelocity,
    rpmInBox:motion?.rpm??0,velocityWorldMPerS:velocities,verifiedFrames:motion?.verifiedFrames??[]};
}

const flowBudgets={
  preview:{tier:.45,cells:32768,windows:12},
  standard:{tier:1,cells:750000,windows:32},
  fine:{tier:2,cells:3000000,windows:48}
};

// Estimate uncertainty from complete time blocks after startup. Short or
// constant histories have insufficient information to infer autocorrelation.
function forceUncertainty(windows,axes){
  const blocks=windows.slice(3),n=blocks.length;
  if(n<6)return {blocks:n,standardErrorForce:null,ci95Drag:null,autocorrelationSteps:null};
  const forces=blocks.map(w=>[0,1,2].map(k=>w.force.reduce((s,v,a)=>s+v*axes[a][k],0)));
  function estimate(values){
    const mean=values.reduce((s,x)=>s+x,0)/n,residual=values.map(x=>x-mean);
    const total=residual.reduce((s,x)=>s+x*x,0);let correlation=1;
    if(total>0){
      for(let lag=1;lag<=Math.floor(n/3);lag++){
        let covariance=0;for(let i=lag;i<n;i++)covariance+=residual[i]*residual[i-lag];
        if(covariance<=0)break;correlation+=2*covariance/total;
      }
    }
    return {mean,se:Math.sqrt(total/(n-1)*correlation/n),correlation};
  }
  const drag=estimate(blocks.map(w=>w.force[0])),effective=Math.max(1,Math.floor(n/drag.correlation)-1);
  const critical=[0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228];
  const t=effective<critical.length?critical[effective]:effective<20?2.201:effective<30?2.086:2.042;
  return {blocks:n,standardErrorForce:axes.map((_,k)=>estimate(forces.map(v=>v[k])).se),
    ci95Drag:[drag.mean-t*drag.se,drag.mean+t*drag.se],
    autocorrelationSteps:drag.correlation*blocks.reduce((s,w)=>s+w.steps,0)/n};
}

// A window stores the mean reaction in the fixed CFD basis. Integrate each
// rotating sample in that basis before shifting its moment to the user pivot.
function physicalLoads(ctx,source,fluid,diameter,windows){
  const {motion,axes,pivot,frame,fps}=source,window=windows.at(-1);
  const samples=windows.slice(-2),count=samples.reduce((n,s)=>n+s.steps,0);
  const mean=(key,a)=>samples.reduce((sum,w)=>sum+w[key][a]*w.steps,0)/count;
  const force=[0,1,2].map(a=>mean('force',a)),moment=[0,1,2].map(a=>mean('moment',a));
  const aboutPivot=ctx.math.cross(pivot,force).map((v,a)=>moment[a]-v);
  const world=local=>[0,1,2].map(k=>local.reduce((s,v,a)=>s+v*axes[a][k],0));
  const result={frame,timeSec:frame/fps,physicalTimeS:window.time,averagedSteps:count,
    forceWorld:world(force),forceLocal:{drag:force[0],lift:force[1],side:force[2],magnitude:Math.hypot(...force)},
    torque:world(aboutPivot),units:{force:'N',torque:'N m',power:'W'}};
  if(motion){
    const speed=source.capture.params.Speed,rps=Math.abs(motion.rpm)/60,power=-moment[0]*motion.omega;
    result.powerW=power;result.rotorMetrics={CT:force[0]/(fluid.rho*rps**2*diameter**4),
      CP:power/(fluid.rho*rps**3*diameter**5),J:speed/(rps*diameter),
      shaftTorqueNm:moment[0],efficiency:power>0?force[0]*speed/power:null};
    if(speed===0&&power>0&&force[0]>=0)result.rotorMetrics.figureOfMerit=force[0]**1.5/(power*Math.sqrt(2*fluid.rho*Math.PI*(diameter/2)**2));
  }
  return result;
}

async function solveNativeFrame(ctx,source,fidelity,check,publish,display){
  const {capture,motion,owner}=source,{Speed:U,Medium,Altitude}=capture.params;
  const fluid=mediumProperties(Medium,Altitude),device=ctx.device,budget=flowBudgets[fidelity];
  const simple=capture.meshes.length===0||(!motion&&U===0);
  if(simple){
    check();
    publish({...physicalLoads(ctx,source,fluid,0,[{steps:1,time:0,force:[0,0,0],moment:[0,0,0]}]),
      solver:'uniform-equilibrium',fidelity,occurrences:capture.meshes.length,medium:fluid,steps:0,completeWindows:0,
      uncertainty:{blocks:0,standardErrorForce:[0,0,0],ci95Drag:[0,0],autocorrelationSteps:null},
      validity:{stationary:true,maxDivergencePerS:0,relativeDivergenceMax:0,temporalConvergence:'exact'}});
    return true;
  }
  const diameter=motion?await sweptDiameter(device,capture):0;check();
  const domain=capturedDomain(ctx,owner,capture,budget.tier,motion?.axisOriginM,budget.cells);
  if(motion&&domain.road)throw failure('UNSUPPORTED_MOTION','A moving road and a rotating shaft require separate moving frames.');
  const omega=motion?.omega??0,maxSpeed=U+.5*diameter*Math.abs(omega),reynolds=maxSpeed*domain.scale/fluid.nu;
  if(!Number.isFinite(reynolds)||maxSpeed/fluid.soundSpeedMps>.25)throw failure('FLOW_REGIME','This solve requires an incompressible flow with reference Mach at most 0.25.');
  const wallModeled=!!motion||reynolds>=200,period=motion?2*Math.PI/Math.abs(omega):domain.scale/maxSpeed;
  const cap=Math.min(budget.cells,Math.floor(device.limits.maxStorageBufferBindingSize/48));
  const partiallyContained=capture.meshes.some(mesh=>mesh.bounds.min.some((x,a)=>x<domain.box.min[a]-1e-8||mesh.bounds.max[a]>domain.box.max[a]+1e-8));
  const f=gradeCapturedDomain({origin:domain.origin,h:domain.h,dims:domain.dims,U,nu:fluid.nu,rho:fluid.rho,maxSpeed,rotor:!!motion,
    rotatingFrame:!!motion,omega,period,movingRoad:domain.road,laminar:!wallModeled,immersedShape:!wallModeled,wallModeled,fullMoment:true,
    globalPressure:true,cutCells:wallModeled,sheetLinks:wallModeled,linearWallPressure:wallModeled,faceHistory:wallModeled,
    cutBlockSmoother:wallModeled,incrementalPressure:wallModeled,faceReconstruction:wallModeled,fluxEquilibration:true,
    sweptDiameterM:diameter,groupTransport:!!motion,implicitRadiusM:motion?.625*diameter:0,
    subcellSurface:!!motion,apertureFlow:!!motion,surfacePressure:true,pressureOpen:motion&&U>0?[false,true,true,true,true,true]:undefined},
  domain.bodies,budget.tier,cap);
  const count=countOf(f.dims),factor=f.groupTransport?3:1,inverseNorm=Math.hypot(...f.minPitch.map(w=>1/w));
  let dt=Math.min(f.implicitRadiusM?Infinity:.32*f.h/maxSpeed,.145*f.h**2/f.nu,
    factor*.78/(maxSpeed*inverseNorm+2*f.nu*inverseNorm**2),period/(f.groupTransport?180:4));
  const gpu=gpuScope(device),windows=[];
  let lastFrame=performance.now(),request=0;
  function tick(t){lastFrame=t;request=requestAnimationFrame(tick);}
  request=requestAnimationFrame(tick);
  try{
    const guarded={...capture,assertCurrent:check},geom=await nativeFlowGeometry(gpu,f,guarded,dt);check();
    const groups=f.cutCells?await cutGroups(gpu,f,geom.response,geom.wall):null;check();
    const stable=groups?factor*groups.stableStep:Infinity;
    if(dt>stable){
      if(motion){
        const rescale=await gpu.kernel('CFD wall speed at the cut-volume timestep',`
          @group(0) @binding(0) var<storage,read_write> wall:array<vec4f>;
          @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
            let i=g.x;if(i<arrayLength(&wall)){let w=wall[i];wall[i]=vec4f(w.x,w.yz*${stable/dt},w.w);}}`);
        check();gpu.run(rescale,[geom.wall],[Math.ceil(count/128)]);
      }
      dt=stable;
    }
    if(!(dt>0&&Number.isFinite(dt)))throw failure('INVALID_TIMESTEP','The evaluated fluid domain has no positive stable timestep.');
    const force=gpu.buffer('CFD integrated axial wall reaction',4*count);
    const fields=await nativeSurfaceFields(gpu,display,f,geom.skin.chunks,dt,geom.response);
    display.draw=await nativeFieldOverlay(ctx,display);check();
    const solver=await cartesianSolver(gpu,f,dt,geom.wall,force,geom.response,groups,geom.centers,null,fields);check();
    const reduceForce=await sumForce(gpu,force,count),reduceLoads=await sumForce(gpu,solver.loads,count,4);
    const fixed=solver.transverseImpulse??solver.loads,reduceMoment=await sumForce(gpu,fixed,count,4,count);
    const reduceTransverse=solver.transverseImpulse?await sumForce(gpu,fixed,count,4):null;
    const scheduler=viewportBudget(device,()=>lastFrame);
    let step=0;
    for(let window=0;window<budget.windows;window++){
      check();const e=device.createCommandEncoder();for(const b of [force,solver.loads,solver.transverseImpulse])if(b)e.clearBuffer(b);
      fields.begin(e);device.queue.submit([e.finish()]);
      const first=step,end=Math.max(first+1,Math.round((window+1)*period/dt));
      while(step<end){
        await solver.advance(step,false,scheduler,check);check();step++;
        const mass=solver.fluxConvergence;
        if(mass.missedSteps)throw failure('MASS_RESIDUAL','A stored volume flux exceeded the per-cell mass tolerance.');
        if(step!==end&&!(window===0&&[1,4,16].includes(step)))continue;
        const scale=fluid.rho*f.h**4/(dt**2*(step-first));
        const axial=await reduceForce(),loads=await reduceLoads(),moments=await reduceMoment();
        const lateral=reduceTransverse?await reduceTransverse():loads;
        const value={steps:step-first,time:step*dt,force:[axial,lateral[2],lateral[3]].map(v=>v*scale),
          moment:[loads[1],moments[2],moments[3]].map(v=>v*scale),coefficient:axial*scale,
          ...(motion?{powerCoefficient:-loads[1]*scale*omega}:{})};
        if([...value.force,...value.moment].some(v=>!Number.isFinite(v)))throw failure('NONFINITE_LOAD','The physical wall reaction is nonfinite.');
        if(step===end)windows.push(value);
        const stationary=step===end&&settledPeriods(windows);
        const baseDefect=stationary&&geom.shape?await solver.steadyDefect():null;
        const physical=physicalLoads(ctx,source,fluid,diameter,step===end?windows:[value]);
        check();await fields.publish(step-first,step===end,physical.forceLocal.drag,check);check();
        const result={...physical,
          solver:'cartesian-fvm',fidelity,occurrences:capture.meshes.length,medium:fluid,cells:count,dims:f.dims,minCellWidthM:f.minPitch,
          steps:step,dtS:dt,completeWindows:windows.length,reynolds,referenceMach:maxSpeed/fluid.soundSpeedMps,
          surfaceFields:display.description,
          uncertainty:forceUncertainty(windows,source.axes),
          validity:{stationary,maxDivergencePerS:mass.maxDivergencePerS,relativeDivergenceMax:mass.maxRelativeDivergence,
            temporalConvergence:stationary?'window-stationary':step===end&&window+1===budget.windows?'window-limit':'sampling',
            spatialConvergence:'single-grid',partiallyContained,loadScope:'complete-participating-occurrences',
            ...(baseDefect===null?{}:{stationaryMomentumDefect:baseDefect}),
            ...(motion?{rotorReferenceQualification:'pending'}:{})},method:wallModeled?'SST wall-modeled':'laminar'};
        publish(result);
        if(stationary){
          if(!geom.shape)return true;
          if(baseDefect>.025){
            if(window+1<budget.windows)continue;
            publish({...result,shape:{state:'unsteady-base',stationaryMomentumDefect:baseDefect}});return true;
          }
          publish({...result,shape:{state:'solving',objective:'drag'}});
          const adj=await steadyForceAdjoint(gpu,f,dt,solver);check();
          await scheduler.perform([{kind:'freeze primal momentum',encode:adj.start}],check);
          const phase={kind:'stationary force adjoint iteration',encode:e=>adj.step(e,2)};
          const limit=Math.min(12000,Math.max(1200,4*step));let iterations=0,defects;
          while(iterations<limit){
            const block=Math.min(24,limit-iterations);
            await scheduler.perform(Array(block).fill(phase),check);iterations+=block;
            defects=[...await adj.defects()];check();if(defects.some(v=>!Number.isFinite(v))||Math.max(...defects)<4e-6)break;
          }
          await scheduler.perform([{kind:'restore primal pressure',encode:adj.restore}],check);
          const resolved=defects.every(v=>Number.isFinite(v)&&v<4e-6);
          const sensitivity={state:resolved?'ready':'iteration-limit',objective:'drag',method:'steady-discrete-laminar',
            geometry:'native-fixed-topology',samples:geom.shape.samples,iterations,momentumDefect:defects[0],pressureDefect:defects[1],
            stationaryMomentumDefect:baseDefect,vertexGradientUnit:'N/mm',surfaceDensityUnit:'N/m3'};
          if(resolved){
            await publishNativeShape(gpu,display,geom.shape,geom.skin.chunks,adj.gradient,.5*f.rho*f.U**2/domain.scale,check);
            display.description={...display.description,shape:sensitivity,available:[...display.description.available,'Shape']};
          }
          check();publish({...result,shape:sensitivity,surfaceFields:display.description});return true;
        }
      }
    }
    return false;
  }finally{cancelAnimationFrame(request);gpu.close();}
}

export async function activate(context){
  if(context.version!==1)throw failure('API_VERSION','Unsupported Frame plugin API.');
  const find=hash=>{const n=context.document.nodes.find(n=>n.nativeHash===hash&&n.type==='cfd');if(!n)throw failure('INVALID_OWNER','Select an existing CFD object.');return n;};
  const jobs=new Map();let sequence=0,queue=Promise.resolve();
  const refresh=()=>{context.requestAttributes();context.requestDraw();};
  function release(job){
    if(job.running||!job.display)return;
    const display=job.display;job.display=null;
    setTimeout(()=>{display.gpu.close();},0);
  }
  function retire(hash){const job=jobs.get(hash);if(job){job.stopped=true;jobs.delete(hash);release(job);}}
  function verify(job){
    if(jobs.get(job.owner)!==job||job.stopped)throw failure('CANCELLED','The CFD job was stopped.');
    if(job.state==='stale')throw failure('STALE_CFD_GEOMETRY','The inputs changed during this CFD solve.');
    const node=find(job.owner);
    if(node.enabled===false||job.device!==context.device)throw failure('STALE_CFD_GEOMETRY','The CFD owner or GPU changed.');
    const world=context.document.world(job.owner),pivot=context.document.pivot(job.owner);
    if(job.world.some((v,k)=>v!==world[k])||job.pivot.some((v,k)=>v!==pivot[k]))
      throw failure('STALE_CFD_GEOMETRY','The CFD axes or torque pivot changed.');
    try{job.source.assertCurrent();}catch(e){throw failure('STALE_CFD_GEOMETRY',e.message);}
  }
  function current(hash){
    const job=jobs.get(hash);
    if(job&&!job.stopped&&job.state!=='stale'&&job.state!=='failed'){
      try{verify(job);}catch(e){job.state='stale';job.result=null;job.error={code:e.code,message:e.message};release(job);}
    }
    return job;
  }
  function status(hash){
    const n=find(hash),j=current(hash);
    return {stage:'native-flow',state:j?.state??'dirty',authoringOnly:false,solverAvailable:true,resultsAvailable:!!j?.result,
      geometryDiagnosticAvailable:true,registeredTags:[],owner:{hash:n.nativeHash,type:n.type},parameters:{...n.params},
      localBox:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max],pivot:[...LOCAL_BOX.pivot],unit:'mm'},
      flow:{directionLocal:[1,0,0],inletLocalX:-500,outletLocalX:500,speedUnit:'m/s',markerOnly:true},
      geometryParticipation:'automatic-evaluated-box-intersection',geometryEvaluated:!!j&&j.state!=='stale',
      job:j?{id:j.id,frame:j.source.frame,fidelityBudget:j.fidelity,steps:j.result?.steps??0,error:j.error??null}:null};
  }
  function start(hash,{fidelityBudget='standard'}={}){
    const node=find(hash);
    if(!Object.hasOwn(flowBudgets,fidelityBudget))throw failure('INVALID_ARGUMENT','Choose preview, standard or fine fidelity.');
    if(node.enabled===false)throw failure('DISABLED','Enable the CFD box before solving.');
    const old=current(hash);
    if(old&&old.fidelity===fidelityBudget&&['queued','solving','ready'].includes(old.state))return status(hash);
    const device=context.device,source=frozenWallMotion(device,context,hash,{allowStationary:true});
    const world=context.document.world(hash),pivot=context.document.pivot(hash);
    source.owner=hash;source.axes=boxAxes(world);
    source.pivot=context.math.point(boxMetric(world),pivot.slice(12,15)).map((v,k)=>v-(source.motion?.axisOriginM[k]??0));
    retire(hash);
    const job={owner:hash,id:++sequence,device,world,pivot,source,fidelity:fidelityBudget,state:'queued',result:null,stopped:false};
    jobs.set(hash,job);
    async function run(){
      try{
        verify(job);job.state='solving';job.running=true;
        job.display={gpu:gpuScope(device),chunks:[],mode:'Drag'};
        const done=await solveNativeFrame(context,source,fidelityBudget,()=>verify(job),result=>{
          verify(job);job.result=result;refresh();
        },job.display);
        verify(job);job.state=done?'ready':'unconverged';
      }catch(e){
        if(job.stopped||jobs.get(hash)!==job)return;
        job.result=null;job.state=e.code==='STALE_CFD_GEOMETRY'?'stale':'failed';job.error={code:e.code??'CFD_SOLVE_FAILED',message:e.message};
      }finally{job.running=false;if(!job.result||job.stopped)release(job);if(jobs.get(hash)===job)refresh();}
    }
    // One physical compute job at a time on the editor's shared queue.
    // Scheduling in a later task releases the native operation FIFO first.
    queue=queue.then(()=>new Promise(resolve=>setTimeout(resolve,0))).then(run);refresh();return status(hash);
  }
  function stop(hash){
    find(hash);const job=current(hash);
    if(job&&['solving','queued'].includes(job.state)){job.stopped=true;job.state='stopped';job.result=null;refresh();}
    return status(hash);
  }
  function results(hash){
    const s=status(hash),result=jobs.get(hash)?.result;
    return {state:s.state,job:s.job,result:result?structuredClone(result):null};
  }
  async function probe(hash,{occurrence,triangle}){
    find(hash);
    if(!Number.isSafeInteger(occurrence)||occurrence<0||!Number.isSafeInteger(triangle)||triangle<0)
      throw failure('INVALID_ARGUMENT','Specify a nonnegative occurrence and native triangle index.');
    const job=current(hash),result=job?.result;
    if(!result?.surfaceFields||!job.display)throw failure('CFD_FIELDS_UNAVAILABLE','This frame has no computed surface observations.');
    const value=await probeSurface(job.device,job.display,occurrence,triangle);
    verify(job);if(job.result!==result)throw failure('STALE_CFD_RESULT','The surface averaging window changed during the probe.');
    return {frame:result.frame,physicalTimeS:result.physicalTimeS,...value};
  }
  async function shapeGradient(hash,{occurrence,firstVertex,count}){
    find(hash);
    if(![occurrence,firstVertex,count].every(Number.isSafeInteger)||occurrence<0||firstVertex<0||count<1||count>128)
      throw failure('INVALID_ARGUMENT','Specify an occurrence and one to 128 consecutive logical vertices.');
    const job=current(hash),result=job?.result,parts=job?.display?.shapeVertices;
    if(!parts||result?.shape?.state!=='ready')throw failure('CFD_FIELDS_UNAVAILABLE','This frame has no stationary shape gradient.');
    const selected=parts.filter(p=>p.occurrence===occurrence&&p.firstVertex<firstVertex+count&&p.firstVertex+p.count>firstVertex);
    const end=firstVertex+count;
    if(!selected.length||end>selected.at(-1).firstVertex+selected.at(-1).count)
      throw failure('INVALID_ARGUMENT','The logical vertex range exceeds the solved occurrence.');
    const device=job.device,read=device.createBuffer({label:'CFD requested physical shape derivatives',size:28*count,
      usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const e=device.createCommandEncoder();
      for(const p of selected){
        const v=Math.max(firstVertex,p.firstVertex),n=Math.min(end,p.firstVertex+p.count)-v;
        e.copyBufferToBuffer(p.vector,12*(v-p.firstVertex),read,12*(v-firstVertex),12*n);
        e.copyBufferToBuffer(p.area,16*(v-p.firstVertex),read,12*count+16*(v-firstVertex),16*n);
      }
      device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);verify(job);
      const data=new Float32Array(read.getMappedRange()),axes=job.source.axes;
      const world=v=>[0,1,2].map(k=>v.reduce((s,x,a)=>s+x*axes[a][k],0));
      const vertices=Array.from({length:count},(_,i)=>{
        const d=Array.from(data.subarray(3*i,3*i+3),v=>v*.001),k=3*count+4*i,n=[data[k],data[k+1],data[k+2]];
        const length=Math.hypot(...n),normal=length?n.map(x=>x/length):null;
        return {vertex:firstVertex+i,areaM2:data[k+3],gradientWorldNPerMm:world(d),
          outwardNormalWorld:normal?world(normal):null,normalNPerMm:normal?normal.reduce((s,x,a)=>s+x*d[a],0):null};
      });
      return {frame:result.frame,objective:result.shape.objective,occurrence,vertices};
    }finally{read.destroy();}
  }
  context.operations.register([
    {id:'status',description:'Inspect CFD Box inputs and available capabilities.',inputSchema:emptySchema,readOnly:true,run:status},
    {id:'wall-motion',description:'Evaluate the frozen velocity field of the stationary or verified rotating surfaces intersecting this box. Optional probe points are in world metres.',
      inputSchema:{type:'object',properties:{pointsWorldM:{type:'array',maxItems:64,items:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}}},additionalProperties:false},
      readOnly:true,run:(hash,args={})=>{
        find(hash);const p=args.pointsWorldM??[];
        if(!Array.isArray(p)||p.length>64||p.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)))throw failure('INVALID_ARGUMENT','Expected up to 64 finite world points in metres.');
        return wallMotionReport(context,hash,p);
      }},
    {id:'solve-frame',description:'Start a Cartesian finite-volume solve on the visible evaluated scene at this frame. Returns a job handle.',
      inputSchema:{type:'object',properties:{fidelityBudget:{type:'string',enum:Object.keys(flowBudgets)}},additionalProperties:false},readOnly:false,run:start},
    {id:'stop',description:'Stop the calculation for this CFD box.',inputSchema:emptySchema,readOnly:false,run:stop},
    {id:'results',description:'Read source-current measured force, torque, units and numerical convergence.',inputSchema:emptySchema,readOnly:true,run:results},
    {id:'probe',description:'Read averaged pressure, reversal fraction, allocated loss density and any resolved signed shape sensitivity at a native triangle.',
      inputSchema:{type:'object',properties:{occurrence:{type:'integer',minimum:0},triangle:{type:'integer',minimum:0}},required:['occurrence','triangle'],additionalProperties:false},readOnly:true,run:probe},
    {id:'shape-gradient',description:'Read the signed world-space drag derivative for physical displacements of logical mesh vertices.',
      inputSchema:{type:'object',properties:{occurrence:{type:'integer',minimum:0},firstVertex:{type:'integer',minimum:0},count:{type:'integer',minimum:1,maximum:128}},
        required:['occurrence','firstVertex','count'],additionalProperties:false},readOnly:true,run:shapeGradient},
    ...['Drag','Pressure','Separation','Shape'].map(mode=>({id:mode.toLowerCase()+'-map',description:'Display the computed '+mode+' field of this CFD box.',
      inputSchema:emptySchema,readOnly:false,run:hash=>{
        const job=current(hash);if(!job?.result?.surfaceFields?.available.includes(mode))throw failure('CFD_FIELDS_UNAVAILABLE','This frame has no computed '+mode+' field.');
        job.display.mode=mode;refresh();return {mode,frame:job.source.frame};
      }}))
  ]);
  function sync(){
    let changed=false;
    for(const [hash,job] of jobs){
      const before=job.state;current(hash);changed||=before!==job.state;
    }
    if(changed)refresh();
  }
  context.editor.register({documentChanged:sync,frames:sync,parameters:(n,changes)=>{if(n.type!=='cfd')return null;validateParameters({...n.params,...changes});return {};}});
  context.attributes.register(hash=>{
    const n=find(hash),j=current(hash),result=j?.result;
    return {hiddenFields:n.params.Medium==='Water'?['Ground','Altitude']:[],actions:[
      {id:'solve-frame',row:'Solve',label:'Frame',cancel:'stop',busy:['queued','solving'].includes(j?.state)},
      ...['Drag','Pressure','Separation','Shape'].map(mode=>({id:mode.toLowerCase()+'-map',row:'Result',label:mode,hidden:!result?.surfaceFields?.available.includes(mode),
        disabled:!result?.surfaceFields?.available.includes(mode),active:!!result?.surfaceFields&&j.display.mode===mode}))],
      readouts:[{id:'force',label:result&&!result.validity.stationary?'Force (N) ≈':'Force (N)',columns:['X','Y','Z','|F|'],
        values:result?[...result.forceWorld,result.forceLocal.magnitude].map(v=>v!==0&&(Math.abs(v)<.001||Math.abs(v)>=10000)?v.toExponential(2):String(Number(v.toPrecision(4)))):null}]};
  });
  await context.viewport.register({retire,renderStage:'opaque',surfaceWarnings:false,
    render:state=>{const job=current(state.hash);if(job?.result?.surfaceFields)job.display.draw(state);},
    pivot:[...LOCAL_BOX.pivot],bounds:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max]},lines:helperLines(),color:[.45,.68,.78,.75],selectedColor:[.7,.86,1,.9],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}

export const immersedFaceWGSL=`
  fn projectFace(raw:f32,body:f32,mu:f32,pressureSlope:f32)->vec2f{
    let free=raw-pressureSlope;
    if(mu==1.){return vec2f(free,0.);}if(mu==0.){return vec2f(body,free-body);}
    // Solid receives the equal and opposite constraint impulse. Including
    // the pressure jump here is essential for a thin accelerating boundary.
    return vec2f(mix(body,free,mu),(1.-mu)*(free-body));
  }`;

// Accumulate the six signed face values before combining the correction.
// Differencing three component pairs first can lose their cancellation.
export const faceBalanceWGSL=`
  fn faceBalance(hi:vec3f,lo:vec3f)->f32{
    var sum=0.;var tail=0.;for(var k=0u;k<6u;k++){
      let a=k%3u;let x=select(hi[a],-lo[a],k>=3u);let t=sum+x;
      tail+=select((x-t)+sum,(sum-t)+x,abs(sum)>=abs(x));sum=t;}return sum+tail;}`;

// Renormalize after every correction. A large cold-start correction can
// otherwise occupy the second word and lose subsequent small increments.
export const addFlowWGSL=`
  fn twoSum(a:f32,b:f32)->vec2f{let s=a+b;
    return vec2f(s,select((b-s)+a,(a-s)+b,abs(a)>=abs(b)));}
  fn addFlow(high:f32,low:f32,delta:f32)->vec2f{
    let d=twoSum(low,delta);let s=twoSum(high,d.x);return twoSum(s.x,s.y+d.y);}`;

export async function cartesianSolver(gpu,f,dt,wall,force,mobility,groups=null,centers=null,skin=null,fields=null){
  const count=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(count/128)];
  const nu=f.nu*dt/f.h**2, cref=f.maxSpeed*dt/f.h, inlet=f.U*dt/f.h;
  const coords=metricBuffer(gpu,f);
  const base=gridWGSL(f)+openBoundaries(f)+metricWGSL(f)+outerSpinWGSL(f)+`
    const NU=${nu};const U=${inlet.toFixed(10)};const K0=${1.5*(.005*cref)**2};
    const O0=${1.5*(.005*cref)**2/(5*nu)};
    struct Cell {uk:vec4f,wt:vec2f,padding:vec2f}
    struct Flux {hi:vec4f,lo:vec4f}
    fn far()->Cell{return Cell(vec4f(U,0.,0.,K0),vec2f(O0,0.),vec2f(0));}
    fn floorFace(axis:u32,side:i32)->bool{return ${!!(f.fixedFloor||f.movingRoad)} && axis==1u && side<0;}
  `;
  const s0=gpu.buffer('CFD momentum and SST',count*32), pred=gpu.buffer('CFD predicted state',count*32);
  const flux=gpu.buffer('CFD conservative corrected face flux',count*32);
  const fluxTail=gpu.buffer('CFD conservative face flux correction',count*32);
  const loads=gpu.buffer('CFD wall pressure, reaction and first moments',count*(f.fullMoment?32:16));
  const mg=await pressureMultigrid(gpu,f,mobility);
  const decl=(b,name,type,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
  const main=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}let p=point(i);${body}}`;
  if(f.cutCells)groups??=await cutGroups(gpu,f,mobility,wall);
  const init=await gpu.kernel('CFD initial velocity and face flow',base+decl(0,'s','Cell',true)+decl(1,'flux','Flux',true)+
    (f.cutCells?decl(2,'mu','vec4f')+decl(3,'wall','vec4f'):'')+main(f.cutCells?`
    s[i]=far();let area=faceAreas(cellWidths(p));let relative=vec3f(U,0.,0.)-vec3f(0.,wall[i].yz);
    var hi=vec3f(0);var lo=vec3f(0);for(var a=0u;a<3u;a++){var l=p;l[a]--;var r=p;r[a]++;
      hi[a]=relative[a]*area[a]*select(1.,mu[i][a],inside(r));
      lo[a]=relative[a]*area[a]*select(1.,mu[bounded(l)][a],inside(l));}
    flux[i]=Flux(vec4f(hi,0),vec4f(lo,0));`:'s[i]=far();let q=vec4f(U*faceAreas(cellWidths(p)).x,0.,0.,0.);flux[i]=Flux(q,q);'));
  gpu.run(init,[s0,flux,...f.cutCells?[mobility,wall]:[]],grid,coords);
  const apertures=f.apertureFlow?await aperturePredictor(gpu,f,dt,s0,pred,mobility,centers,flux,fluxTail):null;
  if(apertures){const e=gpu.device.createCommandEncoder();apertures.initial(e);gpu.device.queue.submit([e.finish()]);}
  const wallBindings=f.wallModeled?[force,loads,mobility]:[];
  const wallFunctions=f.wallModeled?wallResistanceWGSL+
    decl(5,'force','f32',true)+decl(6,'load','vec4f',true)+decl(7,'permeability','vec4f')+`
    fn wallIncrement(relative:vec3f,n:vec3f,d:f32,areaOverVolume:f32)->vec3f{
      let slip=tangentialSlip(relative,n);let rate=areaOverVolume*wallResistance(length(slip),d,NU);
      return (rate/(1.+rate))*slip;}`:'';
  const momentum=await gpu.kernel('CFD finite-volume momentum and SST transport',base+wallFunctions+
    decl(0,'s','Cell')+decl(1,'flux','Flux')+decl(2,'wall','vec4f')+decl(3,'out','Cell',true)+decl(4,'tail','Flux')+main(`
      let a=s[i];let solid=wall[i];let u=a.uk.xyz;let k=max(a.uk.w,1e-12);let omega=max(a.wt.x,1e-8);
      ${f.wallModeled?`if(permeability[i].w==0.){out[i]=Cell(vec4f(0.,solid.yz,1e-12),vec2f(60.*NU/(.075*.25),0.),vec2f(0));return;}`:''}
      let widths=cellWidths(p);let area=faceAreas(widths);let volume=area.x*widths.x;
      let groupRatio=${f.cutCells?'solid.w':'1.'};let share=${f.cutCells?'permeability[i].w/groupRatio':'1.'};
      ${f.wallModeled?'var cutArea=vec3f(0);var normalHint=vec3f(0);var sdfGradient=vec3f(0);':''}
      var adv=vec4f(0);var diff=vec3f(0);var grad:mat3x3f;var gk=vec3f(0);var gw=vec3f(0);
      ${f.sstWall?'var gradientCoverage=vec3f(0);':''}
      var advW=0.;var dk=0.;var dw=0.;var edk=0.;var edw=0.;
      ${f.faceHistory?'var transportDiagonal=0.;':''}
      for(var axis=0u;axis<3u;axis++){var e=vec3i(0);e[axis]=1;
        for(var side=-1;side<=1;side+=2){
          let j=p+side*e;var b=s[bounded(j)];let dir=f32(side);
          let faceFlow=select(flux[i].lo[axis]+tail[i].lo[axis],flux[i].hi[axis]+tail[i].hi[axis],side>0);
          let meshSpeed=${f.rotatingFrame&&!f.cutCells?'vec3f(0.,solid.yz)[axis]':'0.'};
          let q=(faceFlow-area[axis]*meshSpeed)*dir/(volume*groupRatio);
          var invD=1./widths[axis];if(inside(j)){invD=spacingInv(axis,p[axis],side);}
          if(!inside(j)){
            if(floorFace(axis,side)){b.uk=vec4f(vec3f(${f.movingRoad?'2.*U':'0.'},0.,0.)-u,k);b.wt=a.wt;}
            ${f.tunnelSymmetry?'else if(axis!=0u){b=a;b.uk[axis]=-u[axis];}':''}
            else if(!openFace(axis,side)||q<0.){b=far();}
          }
          let donor=select(b.uk,a.uk,q>=0.);var up=donor;
          let behind=select(j+side*e,p-side*e,q>=0.);
          if(inside(j)&&inside(behind)${f.cutCells?'&&permeability[bounded(j)].w>0.&&permeability[bounded(behind)].w>0.&&permeability[bounded(min(behind,select(j,p,q>=0.)))][axis]>0.':''}){
            let upIndex=select(j[axis],p[axis],q>=0.);let backInv=axisMetric(axis,min(upIndex,behind[axis])).z;
            let back=(up-s[index(behind)].uk)*backInv;let forward=(select(a.uk,b.uk,q>=0.)-up)*invD;
            up+=.5*axisMetric(axis,upIndex).y*select(vec4f(0),sign(back)*min(abs(back),abs(forward)),back*forward>vec4f(0));}
          ${f.faceReconstruction?'if(inside(j)){up=vec4f(select(b.uk.xyz,a.uk.xyz,q>=0.),up.w);}':''}
          let explicitRate=${f.implicitRadiusM?'select(q,0.,outerFace(p,j))':'q'};
          ${f.groupTransport?'adv+=explicitRate*(up-donor);':
            'adv+=explicitRate*up;advW+=explicitRate*select(b.wt.x,omega,q>=0.);'}
          let change=b.uk-a.uk;let nut=0.5*(a.wt.y+b.wt.y);
          var lap=invD/(widths[axis]*groupRatio);var gradWeight=.5*dir*invD;${f.sstWall?'var coverage=.5;':''}
          ${f.wallModeled?`if(inside(j)){let k=index(j);let open=permeability[select(k,i,side>0)][axis];
            let blocked=(1.-open)*area[axis];cutArea[axis]+=blocked;normalHint[axis]-=dir*blocked;
            sdfGradient[axis]+=gradWeight*(wall[k].x-solid.x);lap*=open;
            ${f.sstWall?'coverage*=open;gradWeight*=open;':''}
          }else if(floorFace(axis,side)){lap=0.;${f.sstWall?'coverage=0.;gradWeight=0.;':''}}`:''}
          ${f.sstWall?'gradientCoverage[axis]+=coverage;':''}
          diff+=(NU+nut)*lap*change.xyz;grad[axis]+=gradWeight*change.xyz;
          ${f.faceHistory?'transportDiagonal+=max(q,0.)+(NU+nut)*lap;':''}
          gk[axis]+=gradWeight*change.w;gw[axis]+=gradWeight*(b.wt.x-omega);
          dk+=lap*change.w;dw+=lap*(b.wt.x-omega);edk+=nut*lap*change.w;edw+=nut*lap*(b.wt.x-omega);
        }
      }
      ${f.sstWall?`for(var a=0u;a<3u;a++){let d=max(gradientCoverage[a],1e-20);grad[a]/=d;gk[a]/=d;gw[a]/=d;}`:''}
      var kn=share*K0;var wn=share*O0;var nut=0.;var strainLimit=0.;
      if(${!f.laminar}){
      let sym=0.5*(grad+transpose(grad));let ss=2.*(dot(sym[0],sym[0])+dot(sym[1],sym[1])+dot(sym[2],sym[2]));
      let dist=max(0.5,select(solid.x,min(solid.x,axisMetric(1u,p.y).x),${!!(f.fixedFloor||f.movingRoad)}));
      let cd=max(2.*0.856*dot(gk,gw)/omega,1e-14);
      let a1=sqrt(k)/(0.09*omega*dist);let a2=500.*NU/(dist*dist*omega);
      let f1=tanh(pow(min(10.,min(max(a1,a2),4.*0.856*k/(cd*dist*dist))),4.));
      let f2=tanh(pow(min(10.,max(2.*a1,a2)),2.));
      let prod=min(a.wt.y*ss,10.*0.09*k*omega);
      var decay=.09*omega;
      ${f.ddes?`let rootK=sqrt(k);let rans=rootK/decay;
      let gradNorm=sqrt(dot(grad[0],grad[0])+dot(grad[1],grad[1])+dot(grad[2],grad[2]));
      let rd=(a.wt.y+NU)/max(1e-20,.41*.41*dist*dist*gradNorm);
      let shield=1.-tanh(pow(min(8.,20.*rd),3.));
      let les=mix(.61,.78,f1)*max(widths.x,max(widths.y,widths.z));
      decay=rootK/max(1e-20,mix(rans,min(rans,les),shield));`:''}
      let beta=mix(0.0828,0.075,f1);let gamma=mix(0.44,5./9.,f1);
      kn=(share*(k+prod)-adv.w+NU*dk+mix(1.,0.85,f1)*edk)/(1.+decay);
      wn=(share*omega-advW+NU*dw+mix(0.856,0.5,f1)*edw+share*(gamma*select(0.,prod/max(a.wt.y,1e-10),a.wt.y>0.)+
        (1.-f1)*2.*0.856*dot(gk,gw)/omega))/(1.+beta*omega);
      let damping=1.-exp(-${10*cref}*${f.cutCells?'(1.-smoothstep(-.7,.7,solid.x))':'solid.w'});
      ${f.cutCells?`nut=share*${f.sstWall?'(prod/(1.+decay))':'damping'};strainLimit=share*sqrt(ss)*f2;`:`
      kn=mix(max(1e-12,kn),1e-12,damping);wn=mix(max(1e-8,wn),60.*NU/(0.075*0.25),damping);
      nut=0.31*kn/max(0.31*wn,sqrt(ss)*f2);`}}
      var tentative=share*u-adv.xyz+diff;
      ${f.rotatingFrame?`let transverse=tentative.yz;
        tentative.y=${Math.cos(f.omega*dt)}*transverse.x+${Math.sin(f.omega*dt)}*transverse.y;
        tentative.z=${-Math.sin(f.omega*dt)}*transverse.x+${Math.cos(f.omega*dt)}*transverse.y;`:''}
      if(${f.rotor}){
        let domain=cellCenters(DIMS-1)+.5*cellWidths(DIMS-1);let x=cellCenters(p);
        let depth=min(x,domain-x)/domain;let edge=1.-smoothstep(0.,0.11,min(depth.x,min(depth.y,depth.z)));
        let reservoir=1.-exp(-${cref}*edge);tentative=mix(tentative,share*vec3f(U,0.,0.),reservoir);
        kn=mix(kn,share*K0,reservoir);wn=mix(wn,share*O0,reservoir);}
      ${f.wallModeled?`
      if(permeability[i].w>0.){
        if(any(cutArea>vec3f(0))){
          let gradient=select(normalHint,sdfGradient,length(sdfGradient)>1e-6);
          let n=gradient/max(length(gradient),1e-12);
          let height=max(0.,solid.x);let normalPitch=1./max(length(n/widths),1e-8);
          let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+(cellCenters(p)-height*n)*${f.h};
          let movingWall=${f.rotor?`vec3f(0.,-arm.z,arm.y)*${f.omega*dt/f.h}`:'vec3f(0)'};
          let reaction=wallIncrement(${f.cutCells?'u':'tentative'}-movingWall,n,max(height,.5*normalPitch),
            ${f.cutCells?'length(normalHint)':'dot(cutArea,abs(n))'}/(volume*groupRatio));
          tentative-=reaction;force[i]+=volume*groupRatio*reaction.x;load[i]+=volume*groupRatio*vec4f(0.,cross(arm,reaction).x,reaction.yz);
          ${f.fullMoment?'load[CELLS+i]+=vec4f(0.,0.,volume*groupRatio*cross(arm,reaction).yz);':''}
          ${f.profileViscousTorque?'force[CELLS+i]+=volume*groupRatio*cross(arm,reaction).x;':''}
        }
        if(p.y==0&&floorFace(1u,-1)){
          let road=vec3f(${f.movingRoad?'U':'0.'},0.,0.);
          tentative-=wallIncrement(${f.cutCells?'u':'tentative'}-road,vec3f(0,1,0),.5*widths.y,1./(widths.y*groupRatio));
        }
      }`:''}
      out[i]=Cell(vec4f(tentative,kn),vec2f(wn,nut),vec2f(${f.faceHistory?'transportDiagonal':'0.'},strainLimit));`));
  const pressureRhs=decl(0,'s','Cell')+decl(1,'wall','vec4f')+decl(2,'mu','vec4f')+immersedFaceWGSL+`
    fn body(i:u32)->vec3f{return vec3f(0.,wall[i].yz);}
    fn face(i:u32,p:vec3i,axis:u32,side:i32)->vec3f{var e=vec3i(0);e[axis]=side;let j=p+e;
      if(inside(j)){let other=index(j);let owner=select(other,i,side>0);let right=select(i,other,side>0);
        ${f.axes?`let m=axisMetric(axis,min(p[axis],j[axis]));let v=mix(s[owner].uk[axis],s[right].uk[axis],.5*m.y*m.z);`:'let v=.5*(s[owner].uk[axis]+s[right].uk[axis]);'}
        return ${f.cutCells?'vec3f(v-body(owner)[axis],0.,mu[owner][axis])':'vec3f(v,body(owner)[axis],mu[owner][axis])'};}
      var v=s[i].uk[axis];if(!openFace(axis,side)){v=select(0.,U,axis==0u);}return vec3f(v${f.cutCells?'-body(i)[axis]':''},0.,1.);}`;
  const rhs=await gpu.kernel('CFD immersed flux imbalance',base+pressureRhs+decl(3,'b','f32',true)+main(`
    let area=faceAreas(cellWidths(p));var div=0.;for(var a=0u;a<3u;a++){let hi=face(i,p,a,1);let lo=face(i,p,a,-1);
      div+=area[a]*(projectFace(hi.x,hi.y,hi.z,0.).x-projectFace(lo.x,lo.y,lo.z,0.).x);}b[i]=-div;`));
  const project=await gpu.kernel('CFD coupled wall and pressure projection',base+pressureRhs+decl(3,'pressure','f32')+
    decl(4,'out','Cell',true)+decl(5,'flux','Flux',true)+decl(6,'force','f32',true)+decl(7,'load','vec4f',true)+main(`
    let pi=pressure[i];var t=s[i];var hi=vec3f(0);var lo=vec3f(0);var rawAverage=vec3f(0);
    var impulse=vec3f(0.);var pressureDrag=0.;let widths=cellWidths(p);let area=faceAreas(widths);let volume=widths.x*area.x;
    ${f.wallModeled?'var velocityCorrection=vec3f(0);':''}
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var e=vec3i(0);e[a]=side;let j=p+e;var delta=0.;
      if(inside(j)){delta=(pressure[index(j)]-pi)*spacingInv(a,p[a],side);}else if(openFace(a,side)){delta=-2.*pi/widths[a];}
      let slope=f32(side)*delta;let data=face(i,p,a,side);let q=projectFace(data.x,data.y,data.z,slope);
      if(side>0){hi[a]=q.x;}else{lo[a]=q.x;}rawAverage[a]+=0.5*data.x;
      ${f.wallModeled?`velocityCorrection[a]-=.5*data.z*slope;
        if(inside(j)&&mu[i].w>0.){impulse[a]+=f32(side)*pi*(1.-data.z)/widths[a];}`:
        'impulse[a]+=0.5*q.y;if(a==0u){pressureDrag-=0.5*(1.-data.z)*slope;}'}
    }}
    ${f.wallModeled?`
    // On an impermeable physical face the Neumann pressure equals the fluid
    // cell pressure. Its traction acts on the body. Its prescribed mass flow
    // already enters the RHS, so it supplies no additional momentum penalty.
    ${f.cutCells?`if(mu[i].w>0.){let weight=mu[i].w/wall[i].w;t.uk=weight*t.uk+vec4f(velocityCorrection/wall[i].w,0.);t.wt*=weight;}`:
      't.uk=vec4f(t.uk.xyz+velocityCorrection,t.uk.w);'}pressureDrag=impulse.x;`:`
    // The cell-to-face average loses a subcell velocity component. Fluid keeps
    // that component. Any part removed inside the solid acts on the body.
    let subcell=t.uk.xyz-rawAverage;let fluidFraction=mu[i].w;
    impulse+=(1.-fluidFraction)*subcell;
    t.uk=vec4f(0.5*(hi+lo)+fluidFraction*subcell,t.uk.w);`}
    let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+cellCenters(p)*${f.h};
    out[i]=t;flux[i]=Flux(vec4f(hi*area,0),vec4f(lo*area,0));force[i]+=volume*impulse.x;
    load[i]+=volume*vec4f(pressureDrag,cross(arm,impulse).x,impulse.yz);
    ${f.fullMoment?'load[CELLS+i]+=vec4f(0.,0.,volume*cross(arm,impulse).yz);':''}`));
  const m=gpu.bind(momentum,[s0,flux,wall,pred,fluxTail,...wallBindings],coords),r=gpu.bind(rhs,[pred,wall,mobility,mg.rhs],coords),c=gpu.bind(project,[pred,wall,mobility,mg.p,s0,flux,force,loads],coords);
  // Refine against the fluxes actually stored in FP32. The smaller correction
  // retains its own word on each face and participates in the next advection.
  const basePressure=gpu.buffer('CFD pressure before flux refinement',4*count);
  const imbalance=await gpu.kernel('CFD stored flux defect',base+faceBalanceWGSL+decl(0,'flux','Flux')+decl(1,'b','f32',true)+decl(2,'tail','Flux')+
    main('b[i]=-(faceBalance(flux[i].hi.xyz,flux[i].lo.xyz)+faceBalance(tail[i].hi.xyz,tail[i].lo.xyz));'));
  const residualGroup=gpu.bind(imbalance,[flux,mg.rhs,fluxTail]);
  const refineFlux=await gpu.kernel('CFD apply low-amplitude flux and pressure reaction',base+addFlowWGSL+decl(0,'mu','vec4f')+decl(1,'pressure','f32')+
    decl(2,'tail','Flux',true)+decl(3,'s','Cell',true)+decl(4,'force','f32',true)+decl(5,'load','vec4f',true)+decl(6,'primary','Flux',true)+(f.cutCells?decl(7,'wall','vec4f'):'')+main(`
      let pi=pressure[i];var hi=vec3f(0);var lo=vec3f(0);var impulse=vec3f(0);let widths=cellWidths(p);let area=faceAreas(widths);
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){var e=vec3i(0);e[a]=side;let j=p+e;var slope=0.;var weight=1.;
        if(inside(j)){let k=index(j);weight=mu[select(k,i,side>0)][a];slope=f32(side)*(pressure[k]-pi)*spacingInv(a,p[a],side);}
        else if(openFace(a,side)){slope=-2.*f32(side)*pi/widths[a];}
        let extra=-weight*slope;if(side>0){hi[a]=extra;}else{lo[a]=extra;}
        ${f.wallModeled?'if(inside(j)&&mu[i].w>0.){impulse[a]+=f32(side)*pi*(1.-weight)/widths[a];}':'impulse[a]-=.5*(1.-weight)*slope;'}
      }}
      for(var a=0u;a<3u;a++){
        let plus=addFlow(primary[i].hi[a],tail[i].hi[a],hi[a]*area[a]);let minus=addFlow(primary[i].lo[a],tail[i].lo[a],lo[a]*area[a]);
        primary[i].hi[a]=plus.x;tail[i].hi[a]=plus.y;primary[i].lo[a]=minus.x;tail[i].lo[a]=minus.y;
      }s[i].uk=vec4f(s[i].uk.xyz+.5*(hi+lo)${f.cutCells?'/max(wall[i].w,1e-30)':''},s[i].uk.w);
      let arm=vec3f(${f.origin.map(v=>v.toFixed(8)).join(',')})+cellCenters(p)*${f.h};
      let volume=widths.x*area.x;force[i]+=volume*impulse.x;load[i]+=volume*vec4f(impulse.x,cross(arm,impulse).x,impulse.yz);
      ${f.fullMoment?'load[CELLS+i]+=vec4f(0.,0.,volume*cross(arm,impulse).yz);':''}`));
  const refineGroup=gpu.bind(refineFlux,[mobility,mg.p,fluxTail,s0,force,loads,flux,...f.cutCells?[wall]:[]],coords);
  const accumulate=await gpu.kernel('CFD accumulate physical pressure',decl(0,'first','f32')+decl(1,'p','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i<arrayLength(&p)){p[i]+=first[i];}}`);
  const pressureGroup=gpu.bind(accumulate,[basePressure,mg.p]);
  const [nx,ny,nz]=f.dims,plane=gpu.buffer('CFD time-mean symmetry plane',nx*ny*4);
  const sample=await gpu.kernel('CFD sample planar velocity',decl(0,'s','vec4f')+decl(1,'plane','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<arrayLength(&plane)){
      let a=(i+${nx*ny*(nz/2-1)}u)*2u;plane[i]+=0.5*(s[a].x+s[a+${nx*ny*2}u].x);}}`);
  const sb=gpu.bind(sample,[s0,plane]);
  const peak=gpu.buffer('CFD maximum stored mass defect',4),stage=gpu.staging('CFD single residual value',4);
  const norm=await gpu.kernel('CFD stored volume flux convergence',base+faceBalanceWGSL+decl(0,'flux','Flux')+decl(1,'tail','Flux')+(f.cutCells?decl(3,'mu','vec4f'):'')+`
    @group(0) @binding(2) var<storage,read_write> globalMax:atomic<u32>;
    var<workgroup> lanes:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) j:u32){
      let i=gid.x;var q=0.;if(i<CELLS){let w=cellWidths(point(i));
        q=abs(faceBalance(flux[i].hi.xyz,flux[i].lo.xyz)+faceBalance(tail[i].hi.xyz,tail[i].lo.xyz))/(w.x*w.y*w.z${f.cutCells?'*max(mu[i].w,1e-30)':''});}
      lanes[j]=bitcast<u32>(q);for(var stride=64u;stride>0u;stride/=2u){
        workgroupBarrier();if(j<stride){lanes[j]=max(lanes[j],lanes[j+stride]);}}
      if(j==0u){atomicMax(&globalMax,lanes[0]);}}`);
  const normGroup=gpu.bind(norm,[flux,fluxTail,peak,...f.cutCells?[mobility]:[]],coords);
  const phase=(kind,encode)=>({kind,encode});
  const mergePred=groups?[phase('combine predicted cut-cell momentum',groups.merge(pred))]:[];
  if(f.faceReconstruction){
    const transport=await cutFaceTransport(gpu,f,dt,s0,pred,mobility,centers,wall,flux,fluxTail);
    mergePred.unshift(phase('open velocity gradients',transport.reconstruct),phase('shared momentum transfer',transport.transfer),
      phase('accumulate shared momentum',transport.apply));
  }
  if(f.sstWall){
    mergePred.push(phase('merged SST wall function',await mergedSstWall(gpu,f,dt,groups,wall,mobility,s0,pred)));
  }else if(groups){
    // Internal transport cancels only after the extensive partial increments
    // have been added. Clipping each sliver separately would create turbulent
    // energy even for a uniform field passing through a merged volume.
    const turbulence=await gpu.kernel('CFD turbulence in merged fluid volumes',base+decl(0,'s','Cell',true)+decl(1,'mu','vec4f')+main(`
      if(mu[i].w==0.){return;}var t=s[i];let damping=clamp(t.wt.y,0.,1.);
      let k=mix(max(1e-12,t.uk.w),1e-12,damping);
      let omega=mix(max(1e-8,t.wt.x),60.*NU/(.075*.25),damping);
      t.uk.w=k;t.wt=vec2f(omega,.31*k/max(.31*omega,t.padding.y));s[i]=t;`));
    const group=gpu.bind(turbulence,[pred,mobility]);mergePred.push(phase('merged SST state',e=>gpu.dispatch(e,turbulence,group,grid)));
  }
  const mergeState=groups?[phase('combine projected cut-cell momentum',groups.merge(s0))]:[];
  if(skin)mergeState.push(phase('accumulate sampled surface pressure',skin.bind(mg.p)));
  if(fields)mergeState.push(phase('sample native boundary fields',await fields.bind(mg.p,s0)));
  if(f.linearWallPressure){
    if(!centers||!groups)throw Error('Linear pressure traction requires physical cut-face centroids');
    const linear=await linearCutPressure(gpu,f,mobility,centers,wall,mg.p,s0,force,loads);
    mergeState.unshift(phase('integrate linear wall pressure',linear));
  }
  const spin=f.rotatingFrame?await rotatingLoads(gpu,loads):null;
  if(spin)mergeState.push(phase('integrate fixed-frame transverse reaction',spin.encode));
  const grouped=f.groupTransport?await groupTransport(gpu,f,dt,pred,flux,fluxTail,groups):null;
  const outer=f.implicitRadiusM&&!grouped?await outerTransport(gpu,f,dt,pred,flux,fluxTail):null;
  const predictMomentum=phase('momentum',e=>gpu.dispatch(e,momentum,m,grid));
  let predictStored,prepareStored;
  if(f.faceHistory){
    // Interpolate momentum increments onto the previous corrected face. The
    // transport diagonal relaxes the old face/cell difference on a physical
    // advection/viscosity timescale. Re-interpolating the whole velocity at
    // each time step would make this dissipation proportional to 1/dt.
    const predict=await gpu.kernel('CFD transient face momentum interpolation',base+addFlowWGSL+
      decl(0,'old','Cell')+decl(1,'pred','Cell')+decl(2,'mu','vec4f')+decl(3,'wall','vec4f')+
      decl(4,'primary','Flux',true)+decl(5,'tail','Flux',true)+main(`
      let area=faceAreas(cellWidths(p));
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
        var q=p;q[a]+=side;let j=bounded(q);let l=select(j,i,side>0);let r=select(i,j,side>0);
        let insideFace=inside(q);let w=select(1.,mu[l][a],insideFace);
        let m=axisMetric(a,min(p[a],max(0,q[a])));let t=.5*m.y*m.z;
        let un=old[l].uk[a];let vn=old[r].uk[a];
        let moving=vec3f(0.,wall[l].yz)[a];let u=mix(un,vn,t);
        var reference=area[a]*${f.cutCells?'w*(u-moving)':'mix(moving,u,w)'};
        var change=w*area[a]*mix(pred[l].uk[a]-un,pred[r].uk[a]-vn,t);
        let diag=mix(pred[l].padding.x,pred[r].padding.x,t);let relax=diag/(1.+diag);
        if(!insideFace&&!openFace(a,side)){reference=area[a]*select(0.,U,a==0u);change=0.;}
        let high=select(primary[i].lo[a],primary[i].hi[a],side>0);
        let low=select(tail[i].lo[a],tail[i].hi[a],side>0);
        let v=addFlow(high,low,change-relax*((high-reference)+low));
        if(side>0){primary[i].hi[a]=v.x;tail[i].hi[a]=v.y;}
        else{primary[i].lo[a]=v.x;tail[i].lo[a]=v.y;}
      }}`));
    const bind=gpu.bind(predict,[s0,pred,mobility,wall,flux,fluxTail],coords);
    predictStored=e=>{gpu.dispatch(e,predict,bind,grid);gpu.dispatch(e,imbalance,residualGroup,grid);};
    if(f.cutCells){
      const weight=await gpu.kernel('CFD predicted momentum per merged volume',base+decl(0,'pred','Cell')+decl(1,'out','Cell',true)+
        decl(2,'mu','vec4f')+decl(3,'wall','vec4f')+main(`var t=pred[i];if(mu[i].w>0.){let s=mu[i].w/wall[i].w;t.uk*=s;t.wt*=s;}out[i]=t;`));
      const group=gpu.bind(weight,[pred,s0,mobility,wall]);
      prepareStored=e=>gpu.dispatch(e,weight,group,grid);
    }else prepareStored=e=>e.copyBufferToBuffer(pred,0,s0,0,pred.size);
  }
  function projection(n){
    if(mg.refine.prepareStages)return [phase('V-cycle',mg.solve),...mg.refine.prepareStages,
      ...Array.from({length:n-1},()=>mg.refine.innerStages).flat(),...mg.refine.lastStages];
    return [phase('V-cycle',mg.solve),phase('Krylov start',mg.refine.prepare),
      ...Array.from({length:n},(_,i)=>phase('Krylov iteration',e=>mg.refine.iterate(e,i+1===n)))];
  }
  const forecast=[false,true].map(cold=>[
    ...(cold||(f.rotor&&!f.rotatingFrame)?[phase('geometry coarsening',mg.updateGeometry)]:[]),
    ...(outer||grouped?[]:[predictMomentum]),...(grouped?[]:mergePred),
    phase('flux imbalance',apertures?e=>{apertures.predict(e,cold);gpu.dispatch(e,imbalance,residualGroup,grid);}:
      !cold&&predictStored?predictStored:e=>gpu.dispatch(e,rhs,r,grid)),
    // For fixed geometry the previous physical pressure can act on the new
    // face predictor first. The next solve sees the small imbalance of those
    // actual stored flows, preserving its low bits on the existing flux tail.
    ...(f.incrementalPressure&&!cold?[]:projection(f.globalPressure?(cold?16:f.rotor?5:3):(cold?24:f.rotor?10:6))),
    phase('pressure reaction',(!cold||apertures)&&prepareStored?e=>{prepareStored(e);gpu.dispatch(e,refineFlux,refineGroup,grid);}:
      e=>{gpu.dispatch(e,project,c,grid);e.clearBuffer(fluxTail);})
  ]);
  function refinement(n){
    return [phase('stored flux defect',e=>{e.copyBufferToBuffer(mg.p,0,basePressure,0,4*count);
      e.clearBuffer(mg.p);gpu.dispatch(e,imbalance,residualGroup,grid);}),
      ...(n?projection(n):[phase('local pressure relaxation',mg.polish)]),
      phase('flux correction',e=>{gpu.dispatch(e,refineFlux,refineGroup,grid);gpu.dispatch(e,accumulate,pressureGroup,grid);})];
  }
  const check=phase('verify volume flow',e=>{e.clearBuffer(peak);gpu.dispatch(e,norm,normGroup,grid);e.copyBufferToBuffer(peak,0,stage,0,4);});
  const samplePlane=phase('sample wake',e=>gpu.dispatch(e,sample,sb,[Math.ceil(nx*ny/128)]));
  const fixed=refinement(f.axes?18:24),first=refinement(f.globalPressure?8:12),extra=refinement(f.globalPressure?8:18);
  const krylovRestarts=[extra,refinement(24),refinement(48),refinement(96)];
  const local=refinement(0),target=7e-7*Math.min(1,f.period);
  const equilibrium=f.fluxEquilibration?await fluxEquilibration(gpu,f,dt,mobility,flux,fluxTail):null;
  const stats={steps:0,additionalPasses:0,localPasses:0,maximumPasses:0,maxRelativeDivergence:0,maxDivergencePerS:0,
    missedSteps:0,initialDefectHistory:[],primaryChecks:0,acceptedPrimary:0,longRestarts:0};
  let checkPrimaryAt=1;
  async function measure(){
    await stage.mapAsync(GPUMapMode.READ);
    try{return new Float32Array(stage.getMappedRange())[0]*f.period/dt;}finally{stage.unmap();}
  }
  stats.exactBoundaryBlocks=mg.cutBlocks;
  stats.colouredBoundaryRelaxation=!!mg.cutRelax;
  if(equilibrium)stats.flowReconstruction=equilibrium.stats;
  return {state:s0,predicted:pred,pressure:mg.p,pressureHierarchy:mg,flux,fluxTail,plane,loads,transverseImpulse:spin?.sums,outerTransport:outer?.stats,
    groupTransport:grouped?.stats,mobility,fluxConvergence:stats,
    async steadyDefect(){
      const next=gpu.buffer('CFD steady momentum residual trial',s0.size),peak=gpu.buffer('CFD steady momentum residual',4);
      const read=gpu.staging('CFD steady momentum residual scalar',4);
      try{
        const measure=await gpu.kernel('CFD physical steady-state momentum residual',decl(0,'old','vec4f')+decl(1,'next','vec4f')+`
          @group(0) @binding(2) var<storage,read_write> peak:atomic<u32>;
          @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
            let i=2u*g.x;if(i<arrayLength(&old)){let d=abs(next[i].xyz-old[i].xyz);
              atomicMax(&peak,bitcast<u32>(max(d.x,max(d.y,d.z))));}}`);
        const e=gpu.device.createCommandEncoder();
        gpu.dispatch(e,momentum,gpu.bind(momentum,[s0,flux,wall,next,fluxTail],coords),grid);
        gpu.dispatch(e,measure,gpu.bind(measure,[pred,next,peak]),grid);gpu.device.queue.submit([e.finish()]);
        return (await gpu.read(peak,read,1))[0]*f.period/(dt*cref);
      }finally{next.destroy();peak.destroy();read.destroy();}
    },
    async advance(i,sampling,scheduler,assertCurrent){
      spin?.angle(f.omega*(i+.5)*dt);
      if(outer){await scheduler.perform([predictMomentum],assertCurrent);await outer.solve(scheduler,assertCurrent);}
      if(grouped){await scheduler.perform([predictMomentum,...mergePred],assertCurrent);await grouped.solve(scheduler,assertCurrent);}
      const checkPrimary=f.faceHistory&&i>=checkPrimaryAt;
      await scheduler.perform([...forecast[Number(i===0)],...checkPrimary?[]:first,check],assertCurrent);
      let maximum=await measure(),passes=checkPrimary?0:1;
      if(checkPrimary){
        stats.primaryChecks++;
        if(maximum<=target)stats.acceptedPrimary++;
        else checkPrimaryAt=i+64;
      }
      if(i===0)stats.initialDefectHistory.push(maximum);
      let allowLocal=!!f.cutCells,restart=0,nextReconstruction=1;
      while(maximum>target&&passes<16){
        if(equilibrium&&passes>=nextReconstruction){
          if(await equilibrium.correct(scheduler,assertCurrent)){
            await scheduler.perform([check],assertCurrent);maximum=await measure();nextReconstruction=Infinity;
            if(maximum<=target)break;
          }else nextReconstruction=passes+2;
        }
        const useLocal=allowLocal&&passes>0&&(maximum<=256*target||passes===1);
        const before=maximum;
        const correction=useLocal?local:passes===0?first:krylovRestarts[restart];
        if(!useLocal&&restart>0)stats.longRestarts++;
        await scheduler.perform([...correction,check],assertCurrent);maximum=await measure();passes++;
        if(useLocal){stats.localPasses++;allowLocal=maximum<.35*before;}
        else{
          allowLocal=!!f.cutCells;
          if(maximum>.05*before)restart=Math.min(krylovRestarts.length-1,restart+1);
          else if(maximum<.001*before)restart=0;
        }
        if(i===0)stats.initialDefectHistory.push(maximum);
      }
      if(!Number.isFinite(maximum))throw Error('Nonfinite residual in the stored CFD volume flows');
      stats.steps++;stats.additionalPasses+=Math.max(0,passes-1);stats.maximumPasses=Math.max(stats.maximumPasses,passes);
      stats.maxRelativeDivergence=Math.max(stats.maxRelativeDivergence,maximum);
      stats.maxDivergencePerS=Math.max(stats.maxDivergencePerS,maximum/f.period);
      if(maximum>=1e-6||maximum/f.period>=1e-6)stats.missedSteps++;
      if(mergeState.length||sampling)await scheduler.perform([...mergeState,...sampling?[samplePlane]:[]],assertCurrent);
    },
    step(i,sampling){
      if(outer||grouped)throw Error('Implicit transport requires the residual-controlled advance');
      spin?.angle(f.omega*(i+.5)*dt);
      const e=gpu.device.createCommandEncoder();for(const op of forecast[Number(i===0)])op.encode(e);
      for(let k=0;k<(f.axes?2:1);k++)for(const op of fixed)op.encode(e);
      for(const op of mergeState)op.encode(e);if(sampling)samplePlane.encode(e);gpu.device.queue.submit([e.finish()]);
    }};
}

// Reverse the stationary laminar momentum predictor using the volume inner
// product. An interior face sends one limited donor trace to both cells.
// Keep the selected limiter branches fixed while differentiating that trace.
export async function laminarMomentumAdjoint(gpu,f,dt,solved,lambda,reverse){
  const count=countOf(f.dims),grid=[Math.ceil(count/128)],coords=metricBuffer(gpu,f);
  const base=gridWGSL(f)+metricWGSL(f)+openBoundaries(f)+`
    struct Flux{hi:vec4f,lo:vec4f}
    struct Face{value:vec3f,branch:u32}
    struct Reverse{velocity:vec4f,hi:vec4f,lo:vec4f}
    const NU=f32(${f.nu*dt/f.h**2});const U=f32(${(f.U*dt/f.h).toFixed(10)});
    fn unit(a:u32)->vec3i{var e=vec3i(0);e[a]=1;return e;}
    fn floorFace(a:u32,s:i32)->bool{return ${!!(f.fixedFloor||f.movingRoad)}&&a==1u&&s<0;}`;
  const faces=gpu.buffer('CFD linearized conservative donor traces',48*count);
  const storage=(b,name,type,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
  const main=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);${body}}`;
  const velocities=storage(0,'state','vec4f')+storage(1,'flux','Flux')+storage(2,'tail','Flux');
  const traces=await gpu.kernel('CFD linearize the bounded momentum flux',base+velocities+storage(3,'faces','Face',true)+main(`
    for(var a=0u;a<3u;a++){
      let e=unit(a);let r=p+e;if(!inside(r)){continue;}
      let q=flux[i].hi[a]+tail[i].hi[a];let d=select(r,p,q>=0.);let other=select(p,r,q>=0.);
      let behind=d+(d-other);let vel=state[2u*index(d)].xyz;var value=vel;var flags=0u;
      if(inside(behind)){
        let back=(vel-state[2u*index(behind)].xyz)*axisMetric(a,min(d[a],behind[a])).z;
        let front=(state[2u*index(other)].xyz-vel)*axisMetric(a,p[a]).z;
        for(var k=0u;k<3u;k++){if(back[k]*front[k]>0.){
          let mode=select(2u,1u,abs(back[k])<=abs(front[k]));flags|=mode<<(2u*k);
          value[k]+=.5*axisMetric(a,d[a]).y*select(front[k],back[k],mode==1u);}}
      }
      faces[3u*i+a]=Face(value,flags);
    }`));
  const adjoint=await gpu.kernel('CFD transpose of viscous and limited momentum transport',base+velocities+
    storage(3,'faces','Face')+storage(4,'lambda','vec4f')+storage(5,'out','Reverse',true)+main(`
    let widths=cellWidths(p);let area=faceAreas(widths);let volume=widths.x*area.x;
    let l=lambda[i].xyz;let u=state[2u*i].xyz;var adj=volume*l;var hi=vec3f(0);var lo=vec3f(0);
    for(var a=0u;a<3u;a++){
      let e=unit(a);
      for(var s=-1;s<=1;s+=2){
        let j=p+s*e;let sign=f32(s);let flow=select(flux[i].lo[a]+tail[i].lo[a],flux[i].hi[a]+tail[i].hi[a],s>0);
        var flowAdj=0.;
        if(inside(j)){
          let id=index(j);let owner=select(id,i,s>0);
          flowAdj=sign*dot(lambda[id].xyz-l,faces[3u*owner+a].value);
          adj+=NU*area[a]*spacingInv(a,p[a],s)*(lambda[id].xyz-l);
        }else{
          var b=u;var db=1.;
          if(floorFace(a,s)){b=vec3f(${f.movingRoad?'2.*U':'0.'},0.,0.)-u;db=-1.;}
          else if(!openFace(a,s)||sign*flow<0.){b=vec3f(U,0.,0.);db=0.;}
          let donor=select(b,u,sign*flow>=0.);let dd=select(db,1.,sign*flow>=0.);
          flowAdj=-sign*dot(l,donor);
          adj+=l*(NU*area[a]/widths[a]*(db-1.)-sign*flow*dd);
        }
        if(s>0){hi[a]=flowAdj;}else{lo[a]=flowAdj;}
      }
      for(var slot=-1;slot<=2;slot++){
        let left=p-slot*e;let right=left+e;if(!inside(left)||!inside(right)){continue;}
        let owner=index(left);let q=flux[owner].hi[a]+tail[owner].hi[a];
        let donor=select(1,0,q>=0.);let other=1-donor;let back=3*donor-1;
        let face=faces[3u*owner+a];var coef=vec3f(f32(slot==donor));
        if(face.branch!=0u){
          let modes=(vec3u(face.branch)>>vec3u(0,2,4))&vec3u(3);
          let half=.5*axisMetric(a,left[a]+donor).y;
          let db=half*axisMetric(a,left[a]+min(donor,back)).z*(f32(slot==donor)-f32(slot==back));
          let df=half*axisMetric(a,left[a]).z*(f32(slot==other)-f32(slot==donor));
          coef+=select(vec3f(0),vec3f(db),modes==vec3u(1))+select(vec3f(0),vec3f(df),modes==vec3u(2));
        }
        adj+=q*coef*(lambda[index(right)].xyz-lambda[owner].xyz);
      }
    }
    out[i]=Reverse(vec4f(adj/volume,0),vec4f(hi,0),vec4f(lo,0));`));
  const native=[solved.state,solved.flux,solved.fluxTail];
  const freeze=gpu.bind(traces,[...native,faces],coords),apply=gpu.bind(adjoint,[...native,faces,lambda,reverse],coords);
  return {freeze:e=>gpu.dispatch(e,traces,freeze,grid),encode:e=>gpu.dispatch(e,adjoint,apply,grid)};
}

// Reverse the complete stationary momentum/projection map about its solved
// fields. The cell wall impulse equals predicted minus projected momentum
// minus the centred pressure gradient. Include all three terms in the seed.
export async function steadyForceAdjoint(gpu,f,dt,solved,direction=[1,0,0]){
  if(!f.laminar||f.cutCells||f.rotor||f.faceHistory||f.tunnelSymmetry)
    throw Error('This discrete force adjoint requires the stationary laminar momentum operator');
  const n=countOf(f.dims),bytes=4*n,grid=[Math.ceil(n/128)],coords=metricBuffer(gpu,f),mg=solved.pressureHierarchy;
  const lambda=gpu.buffer('CFD stationary momentum adjoint',4*bytes),reverse=gpu.buffer('CFD reverse velocity and shared discharge',12*bytes);
  const p0=gpu.buffer('CFD saved primal pressure',bytes),gradient=gpu.buffer('CFD steady force derivative per immersed fraction',4*bytes);
  const peak=gpu.buffer('CFD momentum and pressure adjoint defects',8),stage=gpu.staging('CFD adjoint residual readback',8);
  const momentum=await laminarMomentumAdjoint(gpu,f,dt,solved,lambda,reverse);
  const base=gridWGSL(f)+metricWGSL(f)+openBoundaries(f)+`
    struct Reverse{velocity:vec4f,hi:vec4f,lo:vec4f}
    struct Face{rawAdj:f32,weight:f32,mu:f32,area:f32,invD:f32,share:f32,pressureAdj:f32}
    const OBJECTIVE=vec3f(${direction.join(',')});const U=f32(${(f.U*dt/f.h).toFixed(10)});
    @group(0) @binding(0) var<storage,read> m:array<vec4f>;
    @group(0) @binding(1) var<storage,read> rev:array<Reverse>;
    fn neighbour(p:vec3i,a:u32,s:i32)->vec3i{var q=p;q[a]+=s;return q;}
    fn face(i:u32,p:vec3i,a:u32,s:i32,width:vec3f,vol:f32)->Face{
      let q=neighbour(p,a,s);let area=vol/width[a];let ub=vol*(rev[i].velocity[a]-OBJECTIVE[a]);
      var r=-.5*m[i].w*ub;var w=.5*ub+area*select(rev[i].lo[a],rev[i].hi[a],s>0);
      var d=-.5*vol*OBJECTIVE[a];var mu=1.;var invD=0.;var share=0.;
      if(inside(q)){
        let j=index(q);let v=cellWidths(q);let vj=v.x*v.y*v.z;
        let jb=vj*(rev[j].velocity[a]-OBJECTIVE[a]);w+=.5*jb;r-=.5*m[j].w*jb;
        d-=.5*vj*OBJECTIVE[a];let owner=select(j,i,s>0);mu=m[owner][a];
        let ax=axisMetric(a,min(p[a],q[a]));invD=ax.z;
        share=select(.5*ax.y*invD,1.-.5*ax.y*invD,s>0);
      }else if(openFace(a,s)){invD=2./width[a];share=1.;}
      return Face(r,w,mu,area,invD,share,d-mu*w);
    }`;
  const source=await gpu.kernel('CFD transposed pressure response of the total force',base+`
    @group(0) @binding(2) var<storage,read_write> rhs:array<f32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=point(i);let w=cellWidths(p);let v=w.x*w.y*w.z;var b=0.;var diagonal=0.;
      for(var a=0u;a<3u;a++){for(var s=-1;s<=1;s+=2){
        let t=face(i,p,a,s,w,v);b-=f32(s)*t.invD*t.pressureAdj;diagonal+=t.mu*t.area*t.invD;
      }}rhs[i]=select(0.,b,diagonal>0.);
    }`);
  const apply=await gpu.kernel('CFD steady momentum and geometric force adjoint',base+`
    @group(0) @binding(2) var<storage,read> z:array<f32>;
    @group(0) @binding(3) var<storage,read> primalP:array<f32>;
    @group(0) @binding(4) var<storage,read> pred:array<vec4f>;
    @group(0) @binding(5) var<storage,read_write> lambda:array<vec4f>;
    @group(0) @binding(6) var<storage,read_write> gradient:array<vec4f>;
    @group(0) @binding(7) var<storage,read_write> peak:array<atomic<u32>,2>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=point(i);let widths=cellWidths(p);let vol=widths.x*widths.y*widths.z;
      let ub=rev[i].velocity.xyz-OBJECTIVE;let v=pred[2u*i].xyz;
      var next=m[i].w*ub+OBJECTIVE;var rawMean=vec3f(0);var deriv=vec3f(0);
      var residual=0.;var diagonal=0.;
      for(var a=0u;a<3u;a++){for(var s=-1;s<=1;s+=2){
        let t=face(i,p,a,s,widths,vol);let q=neighbour(p,a,s);let j=bounded(q);
        let jump=f32(s)*(z[i]-select(0.,z[j],inside(q)));
        let corr=t.weight-t.area*jump;
        next[a]+=t.share*(t.rawAdj+t.mu*corr)/vol;
        var raw=select(select(0.,U,a==0u),v[a],openFace(a,s));
        if(inside(q)){raw=t.share*v[a]+(1.-t.share)*pred[2u*j][a];}
        rawMean[a]+=.5*raw;
        if(s>0&&inside(q)){deriv[a]=corr*(raw-t.invD*(primalP[j]-primalP[i]));}
        let c=t.mu*t.area*t.invD;residual+=f32(s)*(c*jump+t.invD*t.pressureAdj);diagonal+=c;
      }}
      let old=lambda[i].xyz;lambda[i]=vec4f(next,0);
      let diff=abs(next-old);atomicMax(&peak[0],bitcast<u32>(max(diff.x,max(diff.y,diff.z))));
      if(diagonal>0.){atomicMax(&peak[1],bitcast<u32>(abs(residual)/(diagonal*(1.+abs(z[i])))));}
      gradient[i]=vec4f(deriv,vol*dot(ub,v-rawMean))*${f.rho*f.h**4/dt**2};
    }`);
  const rhs=gpu.bind(source,[solved.mobility,reverse,mg.rhs],coords);
  const bind=gpu.bind(apply,[solved.mobility,reverse,mg.p,p0,solved.predicted,lambda,gradient,peak],coords);
  // The primal and transpose use the identical conductance hierarchy.
  return {lambda,gradient,reverse,
    start(e){momentum.freeze(e);e.copyBufferToBuffer(mg.p,0,p0,0,bytes);e.clearBuffer(mg.p);e.clearBuffer(lambda);},
    step(e,iterations=3){
      e.clearBuffer(peak);momentum.encode(e);gpu.dispatch(e,source,rhs,grid);mg.solve(e);
      if(iterations)mg.refine(e,iterations);gpu.dispatch(e,apply,bind,grid);
    },
    defects:()=>gpu.read(peak,stage,2),
    restore(e){e.copyBufferToBuffer(p0,0,mg.p,0,bytes);}
  };
}

// Equidistribute the integral of 1 / local pitch. Outside the dense interval
// the pitch grows linearly with distance, giving gently graded physical cells.
export function gradedAxis(start,end,denseStart,denseEnd,pitch,growth=.16){
  if(![start,end,denseStart,denseEnd,pitch,growth].every(Number.isFinite)||end<=start||pitch<=0||growth<=0||denseEnd<denseStart)
    throw Error('Invalid rectilinear CFD spacing');
  const lo=Math.max(start,Math.min(end,denseStart)),hi=Math.max(start,Math.min(end,denseEnd));
  const left=Math.log1p(growth*(lo-start)/pitch)/growth,core=(hi-lo)/pitch;
  const total=left+core+Math.log1p(growth*(end-hi)/pitch)/growth;
  const n=8*Math.max(1,Math.ceil(total/8));
  return Float64Array.from({length:n+1},(_,i)=>{
    if(i===0)return start;if(i===n)return end;
    const t=i*total/n-left;
    if(t<0)return lo-pitch*Math.expm1(-growth*t)/growth;
    if(t<=core)return lo+pitch*t;
    return hi+pitch*Math.expm1(growth*(t-core))/growth;
  });
}

// Integrate the smaller of the background pitch and the pitch growing away
// from either geometric extremum. All three functions are piecewise linear.
// Their intersections keep the integral and its inversion exact.
export function surfaceGradedAxis(start,end,coreLo,coreHi,bodyLo,bodyHi,pitch,skin,growth=.16){
  const background=x=>pitch+growth*Math.max(0,coreLo-x,x-coreHi);
  const boundary=x=>skin+growth*Math.min(Math.abs(x-bodyLo),Math.abs(x-bodyHi));
  const knots=[...new Set([start,end,...[coreLo,coreHi,bodyLo,bodyHi,(bodyLo+bodyHi)/2].filter(x=>x>start&&x<end)])].sort((a,b)=>a-b);
  const corners=[start];
  for(let i=1;i<knots.length;i++){
    const l=knots[i-1],r=knots[i],a=background(l)-boundary(l),b=background(r)-boundary(r);
    if(a*b<0)corners.push(l+(r-l)*a/(a-b));corners.push(r);
  }
  const segments=[];let count=0;
  for(let i=1;i<corners.length;i++){
    const x=corners[i-1],y=corners[i],h=Math.min(background(x),boundary(x)),last=Math.min(background(y),boundary(y));
    const gradient=(last-h)/(y-x),span=Math.abs(last-h)<1e-12*h?(y-x)/h:Math.log1p((last-h)/h)/gradient;
    segments.push({x,h,gradient,first:count});count+=span;
  }
  const n=Math.max(8,8*Math.ceil(count/8));let j=0;
  return Float64Array.from({length:n+1},(_,i)=>{
    if(i===0)return start;if(i===n)return end;const d=count*i/n;
    while(j+1<segments.length&&segments[j+1].first<d)j++;
    const {x,h,gradient,first}=segments[j],local=d-first;return x+h*(Math.abs(gradient)<1e-12?local:Math.expm1(gradient*local)/gradient);
  });
}

export function rectilinearDomain(f,bounds,pitches,cap){
  const end=f.domainEnd??f.origin.map((x,k)=>x+f.dims[k]*f.h),length=bounds.max.map((v,k)=>v-bounds.min[k]);
  const scale=Math.max(...length);
  let factor=1;
  for(;;){
    const axes=f.origin.map((x,k)=>{
      const target=pitches[k]*factor,pad=Math.max(2*target,.15*length[k]);
      const downstream=k===0?Math.min(scale,Math.max(4*target,length[k])):pad;
      return f.wallSpacing?surfaceGradedAxis(x,end[k],bounds.min[k]-pad,bounds.max[k]+downstream,
        bounds.min[k],bounds.max[k],target,.25*target):gradedAxis(x,end[k],bounds.min[k]-pad,bounds.max[k]+downstream,target);
    });
    const dims=axes.map(a=>a.length-1),cells=dims.reduce((a,b)=>a*b);
    if(cells<=cap){
      const minPitch=axes.map(a=>a.subarray(1).reduce((s,v,i)=>Math.min(s,v-a[i]),Infinity));
      return {...f,axes,dims,h:Math.min(...minPitch),minPitch,domainEnd:end};
    }
    factor*=Math.max(1.05,Math.cbrt(cells/cap));
  }
}

export function cellCenter(f,a,i){
  const axis=f.axes?.[a];
  return axis?(axis[i]+axis[i+1])*.5:f.origin[a]+(i+.5)*f.h;
}

export function cellWidth(f,a,i){
  const axis=f.axes?.[a];return axis?(axis[i+1]-axis[i])/f.h:1;
}

// A uniform binding stores one record per coordinate, independent of the
// number of cells. It doesn't consume one of the eight portable storage slots.
const sets=new WeakMap();

export function metricBuffer(gpu,f){
  if(!f.axes)return null;
  let cache=sets.get(gpu);if(!cache){cache=new WeakMap();sets.set(gpu,cache);}
  if(cache.has(f.axes))return cache.get(f.axes);
  const values=[];
  for(const [k,axis] of f.axes.entries())for(let i=0;i+1<axis.length;i++){
    const width=cellWidth(f,k,i),next=i+2<axis.length?cellWidth(f,k,i+1):width;
    const child=f.childAxes?.[k],fineSpan=child&&i+2<axis.length?(child[2*i+3]-child[2*i+1])/(2*f.h):0;
    values.push((cellCenter(f,k,i)-f.origin[k])/f.h,width,2/(width+next),2*fineSpan/(width+next));
  }
  const data=Float32Array.from(values);
  if(data.byteLength>gpu.device.limits.maxUniformBufferBindingSize)throw Error('CFD coordinate table exceeds the device binding limit');
  const buf=gpu.buffer('CFD Cartesian axis metrics',data,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  cache.set(f.axes,buf);return buf;
}

export function metricWGSL(f){
  const [nx,ny,nz]=f.dims;
  return (f.axes?`@group(0) @binding(12) var<uniform> gridAxes:array<vec4f,${nx+ny+nz}>;
    fn axisMetric(a:u32,j:i32)->vec4f{
      let offset=select(select(0,${nx},a==1u),${nx+ny},a==2u);return gridAxes[u32(offset+j)];}`:
    'fn axisMetric(a:u32,j:i32)->vec4f{return vec4f(f32(j)+.5,1.,1.,0.);}')+`
    fn cellWidths(p:vec3i)->vec3f{return vec3f(axisMetric(0u,p.x).y,axisMetric(1u,p.y).y,axisMetric(2u,p.z).y);}
    fn cellCenters(p:vec3i)->vec3f{return vec3f(axisMetric(0u,p.x).x,axisMetric(1u,p.y).x,axisMetric(2u,p.z).x);}
    fn faceAreas(w:vec3f)->vec3f{return w.yzx*w.zxy;}
    fn spacingInv(a:u32,j:i32,side:i32)->f32{return axisMetric(a,j-select(1,0,side>0)).z;}
    `;
}

// The truncated sine integral has an exactly closed solid endpoint. Evaluating
// sin(-pi) in FP32 there would leave a small positive permeability in a solid.
export const immersedMobilityWGSL=`fn fluidMobility(d:f32)->f32{
  if(d<=-.5){return 0.;}if(d>=.5){return 1.;}let x=2.*d;
  let m=.5*(1.+x+sin(3.14159265*x)/3.14159265);
  return select(0.,min(1.,m),m>=.00001);}`;

export function gridWGSL(f){
  const [x,y,z]=f.dims;
  return `const NX=${x}u;const NY=${y}u;const NZ=${z}u;const CELLS=${x*y*z}u;
    const DIMS=vec3i(${x},${y},${z});
    fn point(i:u32)->vec3i{return vec3i(vec3u(i%NX,(i/NX)%NY,i/(NX*NY)));}
    fn index(p:vec3i)->u32{return u32(p.x)+NX*(u32(p.y)+NY*u32(p.z));}
    fn inside(p:vec3i)->bool{return all(p>=vec3i(0))&&all(p<DIMS);}
    fn bounded(p:vec3i)->u32{return index(clamp(p,vec3i(0),DIMS-1));}`;
}

function pressureBoundarySides(f){
  return f.pressureOpen??[!!f.rotor,true,!(f.fixedFloor||f.movingRoad),true,true,true];
}

export function openBoundaries(f){
  const mask=pressureBoundarySides(f).reduce((bits,open,i)=>bits|(Number(open)<<i),0);
  return `fn openFace(axis:u32,side:i32)->bool{return (${mask}u&(1u<<(axis*2u+select(0u,1u,side>0))))!=0u;}`;
}

const ro=(i,s)=>`@group(0) @binding(${i}) var<storage,read> ${s}:array<f32>;`;

const rw=(i,s)=>`@group(0) @binding(${i}) var<storage,read_write> ${s}:array<f32>;`;

// Reused by residual evaluation, multigrid and the Krylov operator.
const weightedRow=integrated=>`fn pressureRow(i:u32)->vec2f{
  let p=point(i);let pi=pressure[i];var diagonal=${integrated?'mobility[i].w':'0.'};var value=diagonal*pi;
  for(var axis=0u;axis<3u;axis++){var unit=vec3i(0);unit[axis]=1;
    for(var side=-1;side<=1;side+=2){let neighbour=p+side*unit;
      if(inside(neighbour)){let j=index(neighbour);let c=mobility[select(j,i,side>0)][axis];
        diagonal+=c;value+=c*(pi-pressure[j]);}
      ${integrated?'':'else if(openFace(axis,side)){diagonal+=2.;value+=2.*pi;}'}}}
  return vec2f(diagonal,value);}`;

const boundaryWeight=`fn boundaryWeight(p:vec3i,width:vec3f,area:vec3f)->f32{
  var diagonal=0.;for(var a=0u;a<3u;a++){
    if((p[a]==0&&openFace(a,-1))||(p[a]+1==DIMS[a]&&openFace(a,1))){diagonal+=2.*area[a]/width[a];}
  }return diagonal;}`;

export async function pressureMultigrid(gpu,f,faceMobility){
  const levels=[],row=weightedRow(!!f.axes);
  let dims=f.dims,axes=f.axes,childAxes=null;
  while(true){
    const count=dims.reduce((a,b)=>a*b),head=gridWGSL({dims})+openBoundaries(f);
    const body=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
    const rhs=gpu.buffer('CFD level RHS',count*4), p=gpu.buffer('CFD level pressure',count*4), scratch=gpu.buffer('CFD level residual',count*4);
    const metric={...f,dims,axes,childAxes};
    const weight=levels.length||axes?gpu.buffer('CFD level face conductance',count*16):faceMobility;
    const group=[Math.ceil(count/128)],stencil='let row=pressureRow(i);let d=row.x;let residual=b[i]-row.y;let pi=pressure[i];';
    const buffers=head+ro(0,'b')+ro(1,'pressure')+rw(2,'out')+'@group(0) @binding(3) var<storage,read> mobility:array<vec4f>;'+row;
    const op=await gpu.kernel('CFD immersed pressure residual',buffers+body(stencil+'out[i]=select(0.,residual,d>0.);'));
    const smooth=await gpu.kernel('CFD immersed Jacobi',buffers+body(stencil+'if(d>0.){out[i]=pi+0.72*residual/d;}else{out[i]=0.;}'));
    const residual=gpu.bind(op,[rhs,p,scratch,weight]),pair=[gpu.bind(smooth,[rhs,p,scratch,weight]),gpu.bind(smooth,[rhs,scratch,p,weight])];
    levels.push({dims,rhs,p,scratch,weight,group,metric,damp(encoder,times){
      for(let i=0;i<times;i++)for(const binding of pair)gpu.dispatch(encoder,smooth,binding,group);
    },residual(encoder){gpu.dispatch(encoder,op,residual,group);}});
    if(dims.some(n=>n%2)||Math.min(...dims)<=4)break;
    dims=dims.map(n=>n/2);childAxes=axes;axes=axes?.map(a=>a.filter((_,i)=>i%2===0));
  }
  let updateFine;
  if(f.axes){
    const code=gridWGSL(f)+openBoundaries(f)+metricWGSL(f)+boundaryWeight+`
      @group(0) @binding(0) var<storage,read> fraction:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> coeff:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=CELLS){return;}
        let p=point(i);let w=cellWidths(p);let area=faceAreas(w);
        let invD=vec3f(axisMetric(0u,p.x).z,axisMetric(1u,p.y).z,axisMetric(2u,p.z).z);
        coeff[i]=vec4f(fraction[i].xyz*area*invD,boundaryWeight(p,w,area));}`;
    const op=await gpu.kernel('CFD integrated face conductance',code),fine=levels[0];
    const bind=gpu.bind(op,[faceMobility,fine.weight],metricBuffer(gpu,f));
    updateFine=e=>gpu.dispatch(e,op,bind,fine.group);
  }
  for(let l=0;l<levels.length-1;l++){
    const fine=levels[l],coarse=levels[l+1],[nx,ny]=fine.dims,[cx,cy,cz]=coarse.dims;
    const geometry=await gpu.kernel('CFD coarsen face mobility',gridWGSL({dims:coarse.dims})+(f.axes?openBoundaries(f)+metricWGSL(coarse.metric)+boundaryWeight:'')+`
      @group(0) @binding(0) var<storage,read> fine:array<vec4f>;
      @group(0) @binding(1) var<storage,read_write> coarse:array<vec4f>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let start=2*point(i);var sum=vec3f(0);
        for(var k=0;k<8;k++){let off=vec3i(k&1,(k>>1)&1,k>>2);let p=start+off;
          sum+=vec3f(off)*fine[u32(p.x+${nx}*(p.y+${ny}*p.z))].xyz;}
        ${f.axes?`let p=point(i);let w=cellWidths(p);
          let ratio=vec3f(axisMetric(0u,p.x).w,axisMetric(1u,p.y).w,axisMetric(2u,p.z).w);
          coarse[i]=vec4f(ratio*sum,boundaryWeight(p,w,faceAreas(w)));`:'coarse[i]=vec4f(.25*sum,0.);'}}`);
    const geometryBind=gpu.bind(geometry,[fine.weight,coarse.weight],metricBuffer(gpu,coarse.metric));
    fine.updateGeometry=e=>gpu.dispatch(e,geometry,geometryBind,coarse.group);
    const restrict=await gpu.kernel('CFD pressure restriction',gridWGSL({dims:coarse.dims})+ro(0,'r')+rw(1,'b')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
      let p=2*point(i);var s=0.;for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
        let q=p+vec3i(x,y,z);s+=r[u32(q.x+${nx}*(q.y+${ny}*q.z))];}}}b[i]=${f.axes?'s':'0.5*s'};}`);
    const interpolation=f.axes?metricWGSL(fine.metric)+`
      fn parentCenter(a:u32,j:i32)->f32{let l=axisMetric(a,2*j);let r=axisMetric(a,2*j+1);
        return .5*(l.x-.5*l.y+r.x+.5*r.y);}
      fn coarsePos(p:vec3i)->vec3f{var pos=vec3f(p/2);for(var a=0u;a<3u;a++){let j=p[a]/2;
        let x=axisMetric(a,p[a]).x;let cp=parentCenter(a,j);let k=clamp(j+select(-1,1,x>=cp),0,DIMS[a]/2-1);
        if(k!=j){pos[a]+=f32(k-j)*(x-cp)/(parentCenter(a,k)-cp);}}return pos;}`:
      'fn coarsePos(p:vec3i)->vec3f{return (vec3f(p)+0.5)*0.5-0.5;}';
    const prolong=await gpu.kernel('CFD pressure prolongation',gridWGSL({dims:fine.dims})+interpolation+ro(0,'c')+rw(1,'p')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
      let pos=coarsePos(point(i));let base=vec3i(floor(pos));let t=fract(pos);var v=0.;
      for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
        let off=vec3i(x,y,z);let q=clamp(base+off,vec3i(0),vec3i(${cx-1},${cy-1},${cz-1}));
        let w=select(1.-t,t,off==vec3i(1));v+=w.x*w.y*w.z*c[u32(q.x+${cx}*(q.y+${cy}*q.z))];}}}p[i]+=v;}`);
    const down=gpu.bind(restrict,[fine.scratch,coarse.rhs]),up=gpu.bind(prolong,[coarse.p,fine.p],metricBuffer(gpu,fine.metric));
    fine.down=e=>{gpu.dispatch(e,restrict,down,coarse.group);e.clearBuffer(coarse.p);};
    fine.up=e=>gpu.dispatch(e,prolong,up,fine.group);
    if(f.axes&&!f.globalPressure&&l>0){
      const inject=await gpu.kernel('CFD constant coarse correction',gridWGSL({dims:fine.dims})+ro(0,'c')+rw(1,'p')+`
        @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
          let q=point(i)/2;p[i]+=c[u32(q.x+${cx}*(q.y+${cy}*q.z))];}`);
      const group=gpu.bind(inject,[coarse.p,fine.p]);fine.inject=e=>gpu.dispatch(e,inject,group,fine.group);
    }
  }
  const fine=levels[0],block=await gpuBlocks(gpu,8,f.dims,false);
  // One colour reads only itself and neighbours of the other colour.
  // Separate dispatches provide the global ordering between both half-sweeps.
  const colours=[];
  for(let colour=0;colour<2;colour++){
    const code=gridWGSL(f)+openBoundaries(f)+ro(0,'b')+rw(1,'pressure')+
      '@group(0) @binding(2) var<storage,read> mobility:array<vec4f>;'+row+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=CELLS){return;}let p=point(i);if(((p.x+p.y+p.z)&1)!=${colour}){return;}
        let row=pressureRow(i);if(row.x>0.){pressure[i]+=(b[i]-row.y)/row.x;}
      }`;
    const op=await gpu.kernel('CFD local pressure defect relaxation',code);
    colours.push([op,gpu.bind(op,[fine.rhs,fine.p,fine.weight])]);
  }
  let cutRelax=null;
  function polish(e){
    for(let pair=0;pair<3;pair++){
      if(pair===1&&cutRelax){cutRelax(e);continue;}
      for(const [op,bindings] of colours)gpu.dispatch(e,op,bindings,fine.group);
    }
  }
  let schwarz;
  if(!f.axes){
    const correction=gpu.buffer('CFD Schwarz correction',fine.p.size),bb=block.binding(fine.scratch,correction);
    const add=await gpu.kernel('CFD pressure Schwarz update',ro(0,'z')+rw(1,'p')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&p)){p[g.x]+=0.75*z[g.x];}}`);
    const addBind=gpu.bind(add,[correction,fine.p]);
    schwarz=e=>{fine.residual(e);block.encode(e,bb);gpu.dispatch(e,add,addBind,fine.group);};
  }
  function cycle(e,l,symmetric=false){
    const level=levels[l];
    if(l===levels.length-1){level.damp(e,5);return;}
    level.damp(e,1);level.residual(e);level.down(e);cycle(e,l+1,symmetric);
    if(symmetric)level.inject(e);else level.up(e);level.damp(e,1);
  }
  // PCG needs adjoint transfers. Sum the extensive residual and inject its
  // coarse correction, with identical symmetric pre- and post-smoothing.
  // The equilibrated block inverse supplies the complementary local solve.
  async function coarseCorrection(pair,z){
    const c=levels[1],[cx,cy]=c.dims,[nx,ny]=fine.dims;
    const restrict=await gpu.kernel('CFD coarse Krylov residual',gridWGSL({dims:c.dims})+
      '@group(0) @binding(0) var<storage,read> pair:array<vec2f>;'+rw(1,'b')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let start=2*point(i);var r=0.;for(var k=0;k<8;k++){let q=start+vec3i(k&1,(k>>1)&1,k>>2);
          r+=pair[u32(q.x+${nx}*(q.y+${ny}*q.z))].x;}b[i]=r;}`);
    const add=await gpu.kernel('CFD combined block and global pressure correction',gridWGSL(f)+ro(0,'c')+
      '@group(0) @binding(1) var<storage,read> pair:array<vec2f>;'+rw(2,'z')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=CELLS){return;}
        let q=point(i)/2;let s=pair[i].y;if(s>0.){z[i]+=c[u32(q.x+${cx}*(q.y+${cy}*q.z))]/s;}}`);
    const down=gpu.bind(restrict,[pair,c.rhs]),up=gpu.bind(add,[c.p,pair,z]);
    return e=>{gpu.dispatch(e,restrict,down,c.group);e.clearBuffer(c.p);cycle(e,1,true);gpu.dispatch(e,add,up,fine.group);};
  }
  async function globalCorrection(pair,z){
    const widths=f.dims.map((n,k)=>Array.from({length:n},(_,i)=>cellWidth(f,k,i)));
    if(f.coarseSpectral)return (await coarseSpectral(gpu,widths,pressureBoundarySides(f))).binding(pair,z);
    const inverse=await separablePressure(gpu,f.dims,widths,pressureBoundarySides(f));
    const field=gpu.buffer('CFD global Krylov correction',fine.p.size),apply=inverse.binding(fine.scratch,field);
    const pairField='@group(0) @binding(0) var<storage,read> pair:array<vec2f>;';
    const unpack=await gpu.kernel('CFD integrated global residual',pairField+rw(1,'r')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&r)){r[g.x]=pair[g.x].x;}}`);
    const combine=await gpu.kernel('CFD global plus local pressure correction',pairField+ro(1,'corr')+rw(2,'z')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<arrayLength(&z)){
        let s=pair[i].y;if(s>0.){z[i]+=corr[i]/s;}}}`);
    const before=gpu.bind(unpack,[pair,fine.scratch]),after=gpu.bind(combine,[pair,field,z]);
    const stages=[{kind:'global residual',encode:e=>gpu.dispatch(e,unpack,before,fine.group)},
      ...apply.stages,{kind:'combine pressure corrections',encode:e=>gpu.dispatch(e,combine,after,fine.group)}];
    return Object.assign(e=>{for(const op of stages)op.encode(e);},{stages});
  }
  const pre=f.globalPressure?globalCorrection:f.axes&&levels.length>1?coarseCorrection:null;
  let cut=null;
  if(f.cutCells&&updateFine){
    const e=gpu.device.createCommandEncoder();updateFine(e);gpu.device.queue.submit([e.finish()]);
    cut=await cutPressureBlocks(gpu,f,faceMobility,fine.weight);
    if(cut?.smoother)cutRelax=await cut.smoother(fine.rhs,fine.p);
  }
  const local=cut?{
    binding(r,z){return {regular:block.binding(r,z),cut:cut.binding(r,z)};},
    encode(e,b){block.encode(e,b.regular);b.cut(e);}
  }:block;
  const refine=await devicePressureCG(gpu,fine,local,gridWGSL(f)+openBoundaries(f)+row,pre);
  return {p:fine.p,rhs:fine.rhs,refine,polish,cutRelax,cutBlocks:cut?.count??0,updateGeometry(e){updateFine?.(e);for(const level of levels)level.updateGeometry?.(e);},solve(e){
    schwarz?.(e);cycle(e,0);
  }};
}

// A shared face is implicit only when both centres are beyond the measured
// swept cylinder. The inner blade, boundary layers and their neighbouring
// faces keep their existing time-accurate spatial reconstruction.
export function outerSpinWGSL(f){
  if(!f.implicitRadiusM)return 'fn outerFace(p:vec3i,q:vec3i)->bool{return false;}';
  return `fn outerCentre(p:vec3i)->bool{
    let r=vec2f(${f.origin[1]},${f.origin[2]})+cellCenters(clamp(p,vec3i(0),DIMS-1)).yz*${f.h};
    return dot(r,r)>${f.implicitRadiusM**2};
  }
  fn outerFace(p:vec3i,q:vec3i)->bool{return outerCentre(p)&&outerCentre(q);}`;
}

// Backward-Euler donor transport of absolute momentum, k and omega on the
// outer relative face flows. After solving, integrate the shared fluxes one
// last time so internal transfers cancel even at finite iteration tolerance.
export async function outerTransport(gpu,f,dt,predictor,flux,tail){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],metric=metricBuffer(gpu,f),uniform=f.maxSpeed*dt/f.h;
  const k0=1.5*(.005*uniform)**2,w0=k0/(5*f.nu*dt/f.h**2);
  const work=gpu.buffer('CFD outer implicit transport iterate',predictor.size);
  const peak=gpu.buffer('CFD outer transport residual',4),stage=gpu.staging('CFD outer transport residual readback',4);
  const common=gridWGSL(f)+metricWGSL(f)+outerSpinWGSL(f)+`
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f} struct Flux{hi:vec4f,lo:vec4f}
    @group(0) @binding(2) var<storage,read> high:array<Flux>;
    @group(0) @binding(3) var<storage,read> low:array<Flux>;
    const FREE=vec4f(${f.U*dt/f.h},0.,0.,${k0});const OMEGA=f32(${w0});
    struct Transfer{uk:vec4f,omega:f32,outgoing:f32}
  `;
  const transfer=`fn transport(i:u32,p:vec3i)->Transfer{
    let w=cellWidths(p);let inv=1./(w.x*w.y*w.z);var t=Transfer(vec4f(0),0.,0.);
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var q=p;q[a]+=side;if(!outerFace(p,q)){continue;}
      let h=select(high[i].lo[a],high[i].hi[a],side>0);
      let l=select(low[i].lo[a],low[i].hi[a],side>0);
      let rate=(h+l)*f32(side)*inv;if(rate>=0.){t.outgoing+=rate;}
      else{var v=FREE;var omega=OMEGA;if(inside(q)){let neighbour=guess[index(q)];v=neighbour.uk;omega=neighbour.wt.x;}
        t.uk-=rate*v;t.omega-=rate*omega;}
    }}return t;}`;
  const data=(dst,src)=>`@group(0) @binding(0) var<storage,${dst}> rhs:array<Cell>;
    @group(0) @binding(1) var<storage,${src}> guess:array<Cell>;`;
  const kernels=[],bindings=[];
  for(let colour=0;colour<2;colour++){
    const op=await gpu.kernel('CFD outer transport colour '+colour,common+data('read','read_write')+transfer+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=CELLS){return;}let p=point(i);
        if(((p.x+p.y+p.z)&1)!=${colour}||!outerCentre(p)){return;}
        let t=transport(i,p);let s=rhs[i];let inv=1./(1.+t.outgoing);
        guess[i].uk=(s.uk+t.uk)*inv;guess[i].wt.x=(s.wt.x+t.omega)*inv;
      }`);
    kernels.push(op);bindings.push(gpu.bind(op,[predictor,work,flux,tail],metric));
  }
  const check=await gpu.kernel('CFD true implicit transport defect',common+data('read','read')+transfer+`
    @group(0) @binding(4) var<storage,read_write> peak:atomic<u32>;var<workgroup> block:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) l:u32){
      let i=g.x;var error=0.;if(i<CELLS&&outerCentre(point(i))){
        let t=transport(i,point(i));let old=guess[i];let s=rhs[i];
        let defect=abs((s.uk-old.uk)+t.uk-t.outgoing*old.uk);
        let omega=abs((s.wt.x-old.wt.x)+t.omega-t.outgoing*old.wt.x);
        error=max(length(defect.xyz)/max(${uniform},length(old.uk.xyz)),
          max(defect.w/max(${k0},abs(old.uk.w)),omega/max(OMEGA,abs(old.wt.x))));
      }block[l]=bitcast<u32>(error);for(var h=64u;h>0u;h/=2u){
        workgroupBarrier();if(l<h){block[l]=max(block[l],block[l+h]);}}
      if(l==0u){atomicMax(&peak,block[0]);}}`);
  const checkGroup=gpu.bind(check,[predictor,work,flux,tail,peak],metric);
  const finish=await gpu.kernel('CFD conservative outer momentum flux integral',common+data('read_write','read')+transfer+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS||!outerCentre(point(i))){return;}let t=transport(i,point(i));let v=guess[i];
      let s=rhs[i];rhs[i].uk=s.uk+(t.uk-t.outgoing*v.uk);
      rhs[i].wt.x=s.wt.x+(t.omega-t.outgoing*v.wt.x);
    }`);
  const finishGroup=gpu.bind(finish,[predictor,work,flux,tail],metric);
  const sweep={kind:'implicit outer transport sweep',encode:e=>{
    for(let k=0;k<2;k++)gpu.dispatch(e,kernels[k],bindings[k],grid);
  }};
  const norm={kind:'outer transport defect',encode:e=>{e.clearBuffer(peak);gpu.dispatch(e,check,checkGroup,grid);e.copyBufferToBuffer(peak,0,stage,0,4);}};
  const begin={kind:'initialize implicit outer transport',encode:e=>e.copyBufferToBuffer(predictor,0,work,0,work.size)};
  const end={kind:'integrate outer face impulses',encode:e=>gpu.dispatch(e,finish,finishGroup,grid)};
  return residualControlledTransport(stage,begin,sweep,norm,end,64);
}

// Stop on the true equation defect, then integrate the shared final face
// fluxes. Subdomains can provide different sweeps on the same scheduler.
export function residualControlledTransport(stage,begin,sweep,norm,end,maxSweeps){
  const stats={steps:0,sweeps:0,maxRelativeDefect:0};
  return {stats,async solve(scheduler,assertCurrent){
    let count=0,defect=Infinity;
    while(defect>2e-5){
      if(count>=maxSweeps)throw Error('Implicit momentum transport did not converge: '+defect);
      const batch=count?4:2;
      await scheduler.perform([...(count?[]:[begin]),...Array(batch).fill(sweep),norm],assertCurrent);
      await stage.mapAsync(GPUMapMode.READ);
      try{defect=new Float32Array(stage.getMappedRange())[0];}finally{stage.unmap();}
      if(!Number.isFinite(defect))throw Error('Nonfinite implicit momentum residual');
      count+=batch;
    }
    await scheduler.perform([end],assertCurrent);
    stats.steps++;stats.sweeps+=count;stats.maxRelativeDefect=Math.max(stats.maxRelativeDefect,defect);
  }};
}

// Invert a separable Dirichlet block of the seven-point pressure operator.
// The orthonormal sine transform is symmetric and is its own inverse.
export function blockBasis(n) {
  const q = new Float32Array(n*n), eigen = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const angle = Math.PI * (i+1) / (n+1);
    eigen[i] = 4 * Math.sin(angle/2)**2;
    for (let j = 0; j < n; j++) q[i*n+j] = Math.sqrt(2/(n+1)) * Math.sin((j+1)*angle);
  }
  return {q, eigen};
}

export const storage = (binding, name, mode = 'read') =>
  `@group(0) @binding(${binding}) var<storage,${mode}> ${name}:array<f32>;`;

export async function gpuBlocks(gpu, n, dims, half) {
  const {q,eigen} = blockBasis(n);
  const table = gpu.buffer('CFD sine basis and eigenvalues', new Float32Array([...q,...eigen]));
  const t = half ? 'f16' : 'f32', lanes = 128, localCount = n**3 / lanes;
  const code = `${half ? 'enable f16;' : ''}
    ${storage(0,'rhs')} ${storage(1,'out','read_write')} ${storage(2,'basis')}
    const N=${n}u; const LANES=${lanes}u;
    var<workgroup> tile:array<${t},${n**3}>;
    fn xyz(i:u32)->vec3u {return vec3u(i%N,(i/N)%N,i/(N*N));}
    fn address(p:vec3u)->u32 {return p.x+${dims[0]}u*(p.y+${dims[1]}u*p.z);}
    @compute @workgroup_size(${lanes})
    fn main(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) brick:vec3u) {
      var values:array<${t},${localCount}>;
      for(var k=0u;k<${localCount}u;k++){let i=k*LANES+lane;tile[i]=${t}(rhs[address(brick*N+xyz(i))]);}
      workgroupBarrier();
      for(var step=0u;step<6u;step++){
        let axis=step%3u; var stride=1u;
        if(axis==1u){stride=N;} if(axis==2u){stride=N*N;}
        for(var k=0u;k<${localCount}u;k++){
          let i=k*LANES+lane;let p=xyz(i);let c=p[axis];let base=i-c*stride;
          var v=${t}(0);
          for(var j=0u;j<N;j++){v+=${t}(basis[c*N+j])*tile[base+j*stride];}
          if(step==2u){v=${t}(f32(v)/(basis[N*N+p.x]+basis[N*N+p.y]+basis[N*N+p.z]));}
          values[k]=v;
        }
        workgroupBarrier();
        for(var k=0u;k<${localCount}u;k++){tile[k*LANES+lane]=values[k];}
        workgroupBarrier();
      }
      for(var k=0u;k<${localCount}u;k++){let i=k*LANES+lane;out[address(brick*N+xyz(i))]=f32(tile[i]);}
    }`;
  const pipeline = await gpu.kernel('CFD Fast Diagonalization '+t+' '+n, code);
  return {kind:half?'webgpu-f16':'webgpu-fp32',
    binding:(input,output)=>gpu.bind(pipeline,[input,output,table]),
    encode:(encoder,binding)=>gpu.dispatch(encoder,pipeline,binding,dims.map(d=>d/n)),
    apply(input, output) { gpu.run(pipeline,[input,output,table],dims.map(d=>d/n)); }};
}

// Interpolate cell-centred pressure in physical coordinates, continuing a
// homogeneous Dirichlet or Neumann condition at each exterior face. Store
// the transpose of these very same weights for the integrated flux residual.
export function pressureTransfers(width,leftOpen,rightOpen){
  if(width.length<4||width.length%2)throw Error('The coarse pressure correction needs paired fine cells');
  const n=width.length,coarseWidth=[],fine=[],coarse=[];let x=0;
  for(let j=0;j<n;j+=2){
    const a=width[j],b=width[j+1];if(!(a>0&&b>0))throw Error('Invalid width in the coarse pressure correction');
    fine.push(x+.5*a,x+a+.5*b);coarse.push(x+.5*(a+b));coarseWidth.push(a+b);x+=a+b;
  }
  const forward=[],transpose=coarse.map(()=>[]);
  for(const [i,v] of fine.entries()){
    const parent=i>>1,side=v<coarse[parent]?-1:1,other=parent+side;
    const boundary=side<0?0:x,open=side<0?leftOpen:rightOpen;
    const outside=other<0||other>=coarse.length,neighbour=outside?boundary:coarse[other];
    const part=outside&&!open?0:(v-coarse[parent])/(neighbour-coarse[parent]);
    const row=[[parent,1-part]];if(!outside&&part)row.push([other,part]);
    forward.push(row);for(const [j,w] of row)transpose[j].push([i,w]);
  }
  return {forward,transpose,width:coarseWidth};
}

function packedRows(rows){
  const data=new ArrayBuffer(rows.length*32),index=new Uint32Array(data),weight=new Float32Array(data);
  for(const [i,row] of rows.entries()){
    if(row.length>4)throw Error('Paired pressure interpolation exceeds its one-dimensional support');
    for(const [j,[col,w]] of row.entries()){index[8*i+j]=col;weight[8*i+4+j]=w;}
  }
  return new Uint8Array(data);
}

const rowWGSL='struct Row{idx:vec4u,w:vec4f} @group(0) @binding(2) var<storage,read> rows:array<Row>;';

const groups=d=>[Math.ceil(d.reduce((a,b)=>a*b)/128)];

function transferKernel(dims,other,perAxis,expression){
  const [nx,ny]=dims,[ox,oy]=other;
  return gridWGSL({dims})+rowWGSL+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=vec3u(point(i));
      let x=rows[p.x];let y=rows[${nx}u+p.y];let z=rows[${nx+ny}u+p.z];var v=0.;
      for(var k=0u;k<${perAxis}u;k++){for(var b=0u;b<${perAxis}u;b++){for(var a=0u;a<${perAxis}u;a++){
        let w=x.w[a]*y.w[b]*z.w[k];let j=x.idx[a]+${ox}u*(y.idx[b]+${oy}u*z.idx[k]);
        v+=w*${perAxis===4?'pair[j].x':'pressure[j]'};
      }}}${expression}
    }`;
}

// Fine blocks and cut-wall solves cover the short modes. The global additive
// term P A_box^-1 P^T only transforms the coarser grid, including the actual
// paired widths and reservoirs. Equilibration belongs to the outer PCG.
export async function coarseSpectral(gpu,widths,boundary){
  const axes=widths.map((w,a)=>pressureTransfers(w,boundary[2*a],boundary[2*a+1]));
  const dims=widths.map(w=>w.length),coarse=axes.map(a=>a.width.length),bytes=4*coarse.reduce((a,b)=>a*b);
  const rhs=gpu.buffer('CFD coarse spectral flux residual',bytes),out=gpu.buffer('CFD coarse spectral pressure',bytes);
  const prolong=gpu.buffer('CFD physical pressure interpolation',packedRows(axes.flatMap(a=>a.forward)));
  const restrict=gpu.buffer('CFD transposed pressure interpolation',packedRows(axes.flatMap(a=>a.transpose)));
  const pairDecl='@group(0) @binding(0) var<storage,read> pair:array<vec2f>;';
  const down=await gpu.kernel('CFD adjoint coarse spectral restriction',pairDecl+
    '@group(0) @binding(1) var<storage,read_write> rhs:array<f32>;'+transferKernel(coarse,dims,4,'rhs[i]=v;'));
  const up=await gpu.kernel('CFD additive coarse spectral prolongation',pairDecl+
    '@group(0) @binding(1) var<storage,read> pressure:array<f32>; @group(0) @binding(3) var<storage,read_write> out:array<f32>;'+
    transferKernel(dims,coarse,2,'let scale=pair[i].y;if(scale>0.){out[i]+=v/scale;}'));
  const inverse=await separablePressure(gpu,coarse,axes.map(a=>a.width),boundary),apply=inverse.binding(rhs,out);
  return {dims:coarse,binding(pair,result){
    const r=gpu.bind(down,[pair,rhs,restrict]),p=gpu.bind(up,[pair,out,prolong,result]);
    const stages=[{kind:'restrict pressure residual to the spectral grid',encode:e=>gpu.dispatch(e,down,r,groups(coarse))},
      ...apply.stages,{kind:'prolong coarse spectral pressure',encode:e=>gpu.dispatch(e,up,p,groups(dims))}];
    return Object.assign(e=>{for(const s of stages)s.encode(e);},{stages});
  }};
}

// The Cartesian empty-box operator is separable also on nonuniform axes.
// Diagonalize M^(-1/2) K M^(-1/2) on each axis, including the physical
// reservoir conditions. Store both transforms for an integrated-volume RHS.
export function pressureAxis(width,leftOpen,rightOpen){
  const n=width.length,d=new Float64Array(n),off=new Float64Array(n),vectors=new Float64Array(n*n);
  for(let i=0;i<n;i++){
    const w=width[i];if(!(w>0&&Number.isFinite(w)))throw Error('Expected a positive CFD cell width');
    vectors[i*n+i]=1;
    if(i>0)d[i]+=2/(w*(width[i-1]+w));else if(leftOpen)d[i]+=2/(w*w);
    if(i+1<n){
      const c=2/(w+width[i+1]);d[i]+=c/w;off[i]=-c/Math.sqrt(w*width[i+1]);
    }else if(rightOpen)d[i]+=2/(w*w);
  }
  // Implicit shifted QL on the symmetric tridiagonal operator. Apply every
  // real Givens rotation to its eigenvectors in double precision.
  for(let l=0;l<n;l++){
    for(let iter=0;;iter++){
      let m=l;while(m+1<n&&Math.abs(off[m])>8*Number.EPSILON*(Math.abs(d[m])+Math.abs(d[m+1])))m++;
      if(m===l)break;if(iter>=64)throw Error('CFD pressure axis failed to diagonalize');
      let g=(d[l+1]-d[l])/(2*off[l]);
      g=d[m]-d[l]+off[l]/(g+(g<0?-1:1)*Math.hypot(g,1));
      let s=1,c=1,p=0,split=false;
      for(let i=m-1;i>=l;i--){
        const f=s*off[i],b=c*off[i],r=Math.hypot(f,g);off[i+1]=r;
        if(r===0){d[i+1]-=p;off[m]=0;split=true;break;}
        s=f/r;c=g/r;g=d[i+1]-p;
        const h=(d[i]-g)*s+2*c*b;p=s*h;d[i+1]=g+p;g=c*h-b;
        for(let k=0;k<n;k++){
          const j=k*n+i,v=vectors[j],next=vectors[j+1];vectors[j+1]=s*v+c*next;vectors[j]=c*v-s*next;
        }
      }
      if(!split){d[l]-=p;off[l]=g;off[m]=0;}
    }
  }
  const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>d[a]-d[b]);
  const eig=Float32Array.from(order,(j,i)=>i===0&&!leftOpen&&!rightOpen?0:Math.max(0,d[j]));
  const forward=new Float32Array(n*n),backward=new Float32Array(n*n);
  for(let k=0;k<n;k++)for(let j=0;j<n;j++){
    const value=vectors[j*n+order[k]]/Math.sqrt(width[j]);forward[k*n+j]=value;backward[j*n+k]=value;
  }
  return {eig,forward,backward};
}

export async function separablePressure(gpu,dims,widths,boundaries){
  const modes=widths.map((w,k)=>pressureAxis(w,boundaries[2*k],boundaries[2*k+1]));
  const [nx,ny,nz]=dims,cells=nx*ny*nz;
  const eigen=gpu.buffer('CFD whole-domain pressure eigenvalues',Float32Array.from(modes.flatMap(m=>[...m.eig])));
  const tmp=[0,1].map(()=>gpu.buffer('CFD global pressure transform',4*cells)),passes=[];
  for(let step=0;step<6;step++){
    const a=step<3?step:5-step,n=dims[a],lines=cells/n;
    const address=['k+'+nx+'u*line','line%'+nx+'u+'+nx+'u*(k+'+ny+'u*(line/'+nx+'u))','line+'+(nx*ny)+'u*k'][a];
    const matrix=gpu.buffer('CFD pressure axis basis',step<3?modes[a].forward:modes[a].backward);
    const pipe=await gpu.kernel('CFD tiled pressure axis '+step,`
      @group(0) @binding(0) var<storage,read> src:array<f32>;@group(0) @binding(1) var<storage,read_write> dst:array<f32>;
      @group(0) @binding(2) var<storage,read> basis:array<f32>;
      ${step===2?'@group(0) @binding(3) var<storage,read> eigen:array<f32>;':''}
      var<workgroup> values:array<f32,128>;var<workgroup> tile:array<f32,256>;
      fn index(line:u32,k:u32)->u32{return ${address};}
      @compute @workgroup_size(16,8) fn main(@builtin(workgroup_id) id:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) lane:u32){
        let start=id.x*16u;let row=start+l.x;let line=id.y*8u+l.y;var sum=0.;
        for(var block=0u;block<${n}u;block+=16u){
          var v=0.;if(line<${lines}u&&block+l.x<${n}u){v=src[index(line,block+l.x)];}values[lane]=v;
          for(var i=lane;i<256u;i+=128u){let col=block+i%16u;let r=start+i/16u;var x=0.;
            if(col<${n}u&&r<${n}u){x=basis[r*${n}u+col];}tile[i]=x;}
          workgroupBarrier();for(var j=0u;j<16u;j++){sum+=tile[l.x*16u+j]*values[l.y*16u+j];}workgroupBarrier();
        }
        if(row<${n}u&&line<${lines}u){let i=index(line,row);
          ${step===2?`let x=i%${nx}u;let y=i/${nx}u%${ny}u;let z=i/${nx*ny}u;
            let lambda=eigen[x]+eigen[${nx}u+y]+eigen[${nx+ny}u+z];if(lambda>0.){sum/=lambda;}else{sum=0.;}`:''}
          dst[i]=sum;}
      }`);
    passes.push({pipe,matrix,grid:[Math.ceil(n/16),Math.ceil(lines/8)],diagonal:step===2});
  }
  return {binding(input,out){
    const groups=passes.map(({pipe,matrix,diagonal},i)=>gpu.bind(pipe,[i===0?input:tmp[(i-1)%2],i===5?out:tmp[i%2],matrix,...diagonal?[eigen]:[]]));
    const stages=passes.map((p,i)=>({kind:'global pressure axis '+i,encode:e=>gpu.dispatch(e,p.pipe,groups[i],p.grid)}));
    return Object.assign(e=>{for(const op of stages)op.encode(e);},{stages});
  }};
}

// Add exact Dirichlet subdomain solves on the bricks touched by a cut.
// Numerical rows alone cross to the setup worker, in bounded batches.
export async function cutPressureBlocks(gpu,f,faces,coeff){
  const tiles=f.dims.map(n=>n/4),nTiles=tiles.reduce((a,b)=>a*b);
  const head=gridWGSL(f)+`
    fn brickBase(b:u32)->vec3i{return 4*vec3i(i32(b%${tiles[0]}u),i32((b/${tiles[0]}u)%${tiles[1]}u),i32(b/${tiles[0]*tiles[1]}u));}
    fn offset(k:u32)->vec3i{return vec3i(i32(k&3u),i32((k>>2u)&3u),i32(k>>4u));}`;
  const list=gpu.buffer('CFD active boundary brick indices',4*(nTiles+1));
  const find=await gpu.kernel('CFD collect pressure bricks at cut walls',head+`
    @group(0) @binding(0) var<storage,read> faces:array<vec4f>;
    @group(0) @binding(1) var<storage,read_write> list:array<atomic<u32>>;
    var<workgroup> cut:atomic<u32>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) k:u32){
      let b=group.x+${tiles[0]}u*(group.y+${tiles[1]}u*group.z);let p=brickBase(b)+offset(k);let m=faces[index(p)];
      if(m.w>0.){var near=m.w<1.||any(m.xyz<vec3f(1));
        for(var a=0u;a<3u;a++){var q=p;q[a]--;if(inside(q)){near=near||faces[index(q)][a]<1.;}}
        if(near){atomicStore(&cut,1u);}}
      workgroupBarrier();if(k==0u&&atomicLoad(&cut)!=0u){let j=atomicAdd(&list[0],1u);atomicStore(&list[1u+j],b);}
    }`);
  gpu.run(find,[faces,list],tiles);
  const stage=gpu.staging('CFD pressure brick indices readback',list.size);
  const count=new Uint32Array((await gpu.read(list,stage,1)).buffer)[0];
  if(!count)return null;
  // Keep this additive acceleration bounded for highly fragmented scenes.
  // The regular multigrid/Krylov operator still uses every cut face.
  const byteBudget=Math.min(gpu.device.limits.maxBufferSize,Math.max(16*1024**2,16*f.dims.reduce((a,b)=>a*b)));
  if(count*16384>byteBudget)return null;
  const selected=new Uint32Array((await gpu.read(list,stage,count+1)).buffer).subarray(1);
  const colour=id=>(id%tiles[0]+Math.floor(id/tiles[0])%tiles[1]+Math.floor(id/(tiles[0]*tiles[1])))%2;
  const sets=f.cutBlockSmoother?[selected.filter(b=>colour(b)===0),selected.filter(b=>colour(b)===1)]:[selected];
  const pack=await gpu.kernel('CFD boundary brick pressure matrices',head+`
    @group(0) @binding(0) var<storage,read> bricks:array<u32>;
    @group(0) @binding(1) var<storage,read> c:array<vec4f>;
    @group(0) @binding(2) var<storage,read_write> rows:array<vec4f>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) k:u32){
      let off=offset(k);let p=brickBase(bricks[g.x])+off;let i=index(p);var row=vec4f(0,0,0,c[i].w);
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;if(!inside(q)){continue;}
        let weight=c[select(index(q),i,side>0)][a];
        if(off[a]+side<0||off[a]+side>3){row.w+=weight;}else if(side>0){row[a]=weight;}
      }}rows[g.x*64u+k]=row;
    }`);
  const apply=await gpu.kernel('CFD exact cut-brick pressure correction',head+`
    @group(0) @binding(0) var<storage,read> bricks:array<u32>;
    @group(0) @binding(1) var<storage,read> inverse:array<f32>;
    @group(0) @binding(2) var<storage,read> r:array<f32>;
    @group(0) @binding(3) var<storage,read_write> z:array<f32>;
    var<workgroup> v:array<f32,64>;
    @compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) k:u32){
      let i=index(brickBase(bricks[g.x])+offset(k));v[k]=r[i];workgroupBarrier();var s=0.;
      for(var j=0u;j<64u;j++){s+=inverse[g.x*4096u+j*64u+k]*v[j];}z[i]+=s;
    }`);
  const batch=Math.min(count,128,Math.floor(gpu.device.limits.maxStorageBufferBindingSize/16384));
  const rows=gpu.buffer('CFD temporary cut-brick rows',batch*1024),read=gpu.staging('CFD boundary stencil readback',rows.size);
  const url=URL.createObjectURL(new Blob([cutBlockInverse.toString(),'\nself.onmessage=',factorCutRows.toString()],{type:'text/javascript'}));
  let worker;const parts=[];
  try{
    worker=new Worker(url);
    for(const set of sets)for(let j=0;j<set.length;j+=batch){
      const take=Math.min(set.length-j,batch),indices=gpu.buffer('CFD cut-brick origins',set.subarray(j,j+take));
      gpu.run(pack,[indices,coeff,rows],[take]);const data=await gpu.read(rows,read,take*256);
      const inverse=await new Promise((ok,no)=>{
        worker.onmessage=({data})=>data.error?no(Error(data.error)):ok(new Float32Array(data));
        worker.onerror=e=>no(Error(e.message));worker.postMessage(data.buffer,[data.buffer]);
      });
      parts.push({indices,weights:gpu.buffer('CFD factored cut-brick inverse',inverse),take});
    }
  }finally{worker?.terminate();URL.revokeObjectURL(url);}
  // Neighbouring bricks have opposite colours on the face stencil. In each
  // active brick all lanes gather the actual residual before pressure changes.
  // The next colour then sees the published Dirichlet boundary pressures.
  async function smoother(rhs,pressure){
    const relax=await gpu.kernel('CFD exact coloured cut-brick relaxation',head+`
      @group(0) @binding(0) var<storage,read> bricks:array<u32>;
      @group(0) @binding(1) var<storage,read> inverse:array<f32>;
      @group(0) @binding(2) var<storage,read> c:array<vec4f>;
      @group(0) @binding(3) var<storage,read> b:array<f32>;
      @group(0) @binding(4) var<storage,read_write> p:array<f32>;
      var<workgroup> residual:array<f32,64>;
      @compute @workgroup_size(64) fn main(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) k:u32){
        let x=brickBase(bricks[g.x])+offset(k);let i=index(x);let pi=p[i];var diagonal=c[i].w;var ap=diagonal*pi;
        for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){var y=x;y[a]+=side;if(!inside(y)){continue;}
          let j=index(y);let w=c[select(j,i,side>0)][a];diagonal+=w;ap+=w*(pi-p[j]);}}
        var scale=0.;if(diagonal>0.){scale=sqrt(6./diagonal);}residual[k]=scale*(b[i]-ap);
        workgroupBarrier();storageBarrier();var v=0.;
        for(var j=0u;j<64u;j++){v+=inverse[g.x*4096u+j*64u+k]*residual[j];}p[i]=pi+scale*v;
      }`);
    const bindings=parts.map(part=>[gpu.bind(relax,[part.indices,part.weights,coeff,rhs,pressure]),[part.take]]);
    return e=>{for(const [group,grid] of bindings)gpu.dispatch(e,relax,group,grid);};
  }
  return {count,smoother:f.cutBlockSmoother?smoother:null,binding(r,z){
    const groups=parts.map(part=>[gpu.bind(apply,[part.indices,part.weights,r,z]),[part.take]]);
    return e=>{for(const [bind,grid] of groups)gpu.dispatch(e,apply,bind,grid);};
  }};
}

// Resident PCG on the actual immersed operator. A diagonally equilibrated
// regular Dirichlet block inverse is SPD also on the active fluid subspace.
// Geometry and pressure stay on Frame's device, including all scalar reductions.
export async function devicePressureCG(gpu,level,block,operator,makeCoarseCorrection){
  const count=level.dims.reduce((a,b)=>a*b),groups=level.group;
  const buffer=(name,bytes)=>gpu.buffer('CFD pressure CG '+name,bytes);
  const pair=buffer('residual and equilibration',8*count),d=buffer('direction',4*count),ad=buffer('operator product',4*count);
  const scaled=buffer('scaled residual',4*count),z=buffer('block correction',4*count),partials=buffer('partial sums',4*groups[0]),control=buffer('coefficients',16);
  const storage=(i,name,t,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:array<${t}>;`;
  const run=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i<${count}u){${body}}}`;
  const geometry=level.rowBuffers??[level.weight],next=1+geometry.length;
  const row=operator+storage(0,'pressure','f32')+(level.rowBindings??storage(1,'mobility','vec4f'));
  const initial=await gpu.kernel('CFD true pressure residual',row+storage(next,'rhs','f32')+storage(next+1,'pair','vec2f',true)+storage(next+2,'scaled','f32',true)+run(`
    let a=pressureRow(i);var s=0.;var r=0.;if(a.x>0.){s=${level.equilibrate===false?'1.':'sqrt(6./a.x)'};r=rhs[i]-a.y;}
    pair[i]=vec2f(r,s);scaled[i]=r*s;`));
  const initialGroup=gpu.bind(initial,[level.p,...geometry,level.rhs,pair,scaled]);
  const partial=(single,finish='sums[group.x]=lanes[0];')=>`var<workgroup> lanes:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
      let i=g.x;var value=0.;${single}
      lanes[lane]=value;for(var stride=64u;stride>0u;stride/=2u){workgroupBarrier();if(lane<stride){lanes[lane]+=lanes[lane+stride];}}
      if(lane==0u){${finish}}}`;
  const rz=await gpu.kernel('CFD preconditioned residual norm',storage(0,'pair','vec2f')+storage(1,'z','f32')+storage(2,'sums','f32',true)+
    partial(`if(i<${count}u){let r=pair[i];value=r.x*(r.y*z[i]);}`));
  const rzGroup=gpu.bind(rz,[pair,z,partials]);
  const multiply=await gpu.kernel('CFD pressure direction product',row+storage(next,'ad','f32',true)+storage(next+1,'sums','f32',true)+
    partial(`if(i<${count}u){let a=pressureRow(i);ad[i]=a.y;value=pressure[i]*a.y;}`));
  const productGroup=gpu.bind(multiply,[d,...geometry,ad,partials]);
  const advance=await gpu.kernel('CFD immersed Krylov update',storage(0,'pressure','f32',true)+storage(1,'pair','vec2f',true)+storage(2,'d','f32')+
    storage(3,'ad','f32')+storage(4,'scaled','f32',true)+storage(5,'control','vec4f')+run(`
      let alpha=control[0].y;let old=pair[i];let r=old.x-alpha*ad[i];pair[i]=vec2f(r,old.y);
      pressure[i]+=alpha*d[i];scaled[i]=r*old.y;`));
  const advanceGroup=gpu.bind(advance,[level.p,pair,d,ad,scaled,control]);
  const direction=await gpu.kernel('CFD immersed Krylov direction',storage(0,'pair','vec2f')+storage(1,'z','f32')+storage(2,'d','f32',true)+storage(3,'control','vec4f')+
    run('d[i]=pair[i].y*z[i]+control[0].z*d[i];'));
  const directionGroup=gpu.bind(direction,[pair,z,d,control]);
  const reductions=[];
  for(const update of [
    'control[0]=vec4f(sum,0.,0.,sum);',
    'var alpha=0.;if(sum>0.&&old.x>old.w*1e-14){alpha=old.x/sum;}control[0].y=alpha;',
    'var beta=0.;if(old.x>old.w*1e-14){beta=sum/old.x;}control[0].x=sum;control[0].z=beta;'
  ]){
    const pipe=await gpu.kernel('CFD device dot reduction',storage(0,'sums','f32')+storage(1,'control','vec4f',true)+
      partial(`for(var j=lane;j<${groups[0]}u;j+=128u){value+=sums[j];}`,'let sum=lanes[0];let old=control[0];'+update));
    reductions.push([pipe,gpu.bind(pipe,[partials,control])]);
  }
  const pre=block.binding(scaled,z),coarse=await makeCoarseCorrection?.(pair,z);
  function applyPreconditioner(e){block.encode(e,pre);coarse?.(e);}
  const prepare=e=>{
    gpu.dispatch(e,initial,initialGroup,groups);e.clearBuffer(d);applyPreconditioner(e);
    gpu.dispatch(e,rz,rzGroup,groups);gpu.dispatch(e,...reductions[0],[1]);gpu.dispatch(e,direction,directionGroup,groups);
  };
  const iterate=(e,last)=>{
    gpu.dispatch(e,multiply,productGroup,groups);gpu.dispatch(e,...reductions[1],[1]);gpu.dispatch(e,advance,advanceGroup,groups);
    if(!last){applyPreconditioner(e);gpu.dispatch(e,rz,rzGroup,groups);gpu.dispatch(e,...reductions[2],[1]);gpu.dispatch(e,direction,directionGroup,groups);}
  };
  function refine(e,iterations){prepare(e);for(let i=0;i<iterations;i++)iterate(e,i+1===iterations);}
  if(!coarse?.stages)return Object.assign(refine,{prepare,iterate});
  const preStages=[{kind:'local pressure block',encode:e=>block.encode(e,pre)},...coarse.stages];
  const inner=(e,index)=>{gpu.dispatch(e,rz,rzGroup,groups);gpu.dispatch(e,...reductions[index],[1]);gpu.dispatch(e,direction,directionGroup,groups);};
  const prepareStages=[{kind:'true pressure residual',encode:e=>{gpu.dispatch(e,initial,initialGroup,groups);e.clearBuffer(d);}},
    ...preStages,{kind:'Krylov initial direction',encode:e=>inner(e,0)}];
  const product={kind:'Krylov product and update',encode:e=>{
    gpu.dispatch(e,multiply,productGroup,groups);gpu.dispatch(e,...reductions[1],[1]);gpu.dispatch(e,advance,advanceGroup,groups);
  }};
  const innerStages=[product,...preStages,{kind:'Krylov new direction',encode:e=>inner(e,2)}];
  return Object.assign(refine,{prepare,iterate,prepareStages,innerStages,lastStages:[product]});
}

// Every small fluid volume joins a more open neighbour through a nonzero
// aperture. Strict growth makes the parent forest acyclic. Momentum is
// advanced in the combined volume. Each cut cell keeps its own pressure and
// its six shared face flows, including those internal to a momentum group.
export async function cutGroups(gpu,f,mobility,wall){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],coords=metricBuffer(gpu,f);
  const head=gridWGSL(f),metric=metricWGSL(f);
  const main=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;if(i>=CELLS){return;}${code}}`;
  const parents=[0,1].map(()=>gpu.buffer('CFD small-cell parent',4*n));
  const links=gpu.buffer('CFD cut-cell group members',12*n);
  const material='@group(0) @binding(0) var<storage,read> mu:array<vec4f>;';
  const forest='struct Links{root:u32,head:atomic<u32>,next:u32};';
  const select=await gpu.kernel('CFD open neighbour for thin cut volumes',head+material+
    '@group(0) @binding(1) var<storage,read_write> dst:array<u32>;'+main(`
    let p=point(i);let fraction=mu[i].w;var best=fraction;var face=0.;var parent=i;
    if(fraction>0.&&fraction<.3){
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
        var q=p;q[a]+=side;if(!inside(q)){continue;}let j=index(q);let other=mu[j].w;
        let aperture=mu[select(j,i,side>0)][a];
        if(aperture>0.&&other>fraction&&(other>best||(other==best&&aperture>face))){
          best=other;face=aperture;parent=j;}
      }}
    }dst[i]=parent;`));
  const jump=await gpu.kernel('CFD resolve cut-cell representatives',head+
    '@group(0) @binding(0) var<storage,read> src:array<u32>;@group(0) @binding(1) var<storage,read_write> dst:array<u32>;'+main('dst[i]=src[src[i]];'));
  const setup=await gpu.kernel('CFD initialize physical cut groups',head+forest+
    '@group(0) @binding(0) var<storage,read> root:array<u32>;@group(0) @binding(1) var<storage,read_write> link:array<Links>;'+
    main('link[i].root=root[i];atomicStore(&link[i].head,0xffffffffu);link[i].next=0xffffffffu;'));
  const append=await gpu.kernel('CFD link cut cells to their common volume',head+forest+
    '@group(0) @binding(0) var<storage,read_write> link:array<Links>;'+
    main('let root=link[i].root;if(root!=i){link[i].next=atomicExchange(&link[root].head,i);}'));
  const fluid=f.mergeToFluid?await fluidCentreLinks(gpu,f,mobility,wall,parents[0]):null;
  const e=gpu.device.createCommandEncoder(),dispatch=(op,buf)=>gpu.dispatch(e,op,gpu.bind(op,buf),grid);
  dispatch(select,[mobility,parents[0]]);
  fluid?.encode(e);
  let slot=0;for(let i=1;i<n;i*=2){dispatch(jump,[parents[slot],parents[1-slot]]);slot=1-slot;}
  dispatch(setup,[parents[slot],links]);dispatch(append,[links]);
  const members='struct Members{root:u32,head:u32,next:u32};';
  const volumes=gpu.buffer('CFD agglomerated physical volumes',4*n);
  const stats=gpu.buffer('CFD cut-volume stability bounds',new Uint32Array([0,0,0x3f800000,0,0,0,0]));
  const size=await gpu.kernel('CFD effective cut volumes and explicit stability bound',head+metric+outerSpinWGSL(f)+members+material+`
    @group(0) @binding(1) var<storage,read> links:array<Members>;
    @group(0) @binding(2) var<storage,read_write> volume:array<f32>;
    @group(0) @binding(3) var<storage,read_write> stats:array<atomic<u32>>;
    `+main(`
    let fraction=mu[i].w;if(fraction<=0.){return;}
    if(fraction<1.){atomicAdd(&stats[0],1u);atomicMin(&stats[2],bitcast<u32>(fraction));}
    if(links[i].root!=i){atomicAdd(&stats[1],1u);return;}
    var j=i;var sum=0.;var surfaces=vec3f(0);var rotation=0.;var diffusion=0.;
    loop{
      let p=point(j);let w=cellWidths(p);let area=faceAreas(w);sum+=mu[j].w*w.x*area.x;
      let xyz=vec3f(${f.origin.join(',')})+cellCenters(p)*${f.h};
      let frame=abs(vec3f(0.,-xyz.z,xyz.y))*f32(${f.rotatingFrame?Math.abs(f.omega):0});
      for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
        var q=p;q[a]+=side;var aperture=1.;var invD=1./w[a];
        if(inside(q)){
          let other=index(q);if(links[other].root==i){continue;}
          aperture=mu[select(other,j,side>0)][a];invD=spacingInv(a,p[a],side);
        }
        let open=aperture*area[a];let explicitArea=select(open,0.,outerFace(p,q));
        surfaces[a]+=.5*explicitArea;rotation+=.5*explicitArea*frame[a];diffusion+=open*invD;
      }}
      j=select(links[j].next,links[i].head,j==i);if(j==0xffffffffu){break;}
    }
    volume[i]=sum;let rate=((${f.maxSpeed}*length(surfaces)+rotation)/${f.h}+${f.nu/f.h**2}*diffusion)/sum;
    atomicMax(&stats[3],bitcast<u32>(rate));
    if(fraction<.3){atomicAdd(&stats[4],1u);}if(links[i].head!=0xffffffffu){atomicAdd(&stats[5],1u);}
    if(fraction<1.){atomicAdd(&stats[6],1u);}
    `));
  gpu.dispatch(e,size,gpu.bind(size,[mobility,links,volumes,stats],coords),grid);
  const share=await gpu.kernel('CFD distribute group volume to cut cells',head+metric+members+`
    @group(0) @binding(0) var<storage,read> link:array<Members>;
    @group(0) @binding(1) var<storage,read> volume:array<f32>;
    @group(0) @binding(2) var<storage,read_write> wall:array<vec4f>;`+
    main('let w=cellWidths(point(i));wall[i].w=volume[link[i].root]/(w.x*w.y*w.z);'));
  gpu.dispatch(e,share,gpu.bind(share,[links,volumes,wall],coords),grid);
  gpu.device.queue.submit([e.finish()]);
  const buffer=await gpu.read(stats,gpu.staging('CFD cut geometry statistics',stats.size),7);
  const u=new Uint32Array(buffer.buffer),maximumRate=buffer[3];
  if(!Number.isFinite(maximumRate))throw Error('Nonfinite cut-volume stability bound');
  const stateDecl=head+members+`struct Cell{uk:vec4f,wt:vec2f,padding:vec2f};
    @group(0) @binding(0) var<storage,read> link:array<Members>;
    @group(0) @binding(1) var<storage,read_write> state:array<Cell>;`;
  const sum=await gpu.kernel('CFD sum conservative momentum increments',stateDecl+main(`
    var j=link[i].head;if(j==0xffffffffu){return;}
    var total=state[i];loop{total.uk+=state[j].uk;total.wt+=state[j].wt;total.padding+=state[j].padding;j=link[j].next;if(j==0xffffffffu){break;}}
    state[i]=total;`));
  const scatter=await gpu.kernel('CFD scatter stabilized cell state',stateDecl+main('let k=link[i].root;if(i!=k){state[i]=state[k];}'));
  return {links,volumes,stats:{cutCells:u[0],mergedCells:u[1],minFluidFraction:buffer[2],smallRoots:u[4],groupsWithChildren:u[5],remainingCutRoots:u[6],
    fluidRootSearchSweeps:fluid?.waves,maxTransportRatePerS:maximumRate},
    stableStep:maximumRate>0?.65/maximumRate:Infinity,
    async courant(flux,tail,explicitOnly=false){
      const peak=gpu.buffer('CFD maximum momentum-group Courant number',4);
      const op=await gpu.kernel('CFD transport through outer group faces',head+(explicitOnly?metric+outerSpinWGSL(f):'')+members+`
        struct Flux{hi:vec4f,lo:vec4f}
        @group(0) @binding(0) var<storage,read> links:array<Members>;
        @group(0) @binding(1) var<storage,read> volume:array<f32>;
        @group(0) @binding(2) var<storage,read> flux:array<Flux>;
        @group(0) @binding(3) var<storage,read> tail:array<Flux>;
        @group(0) @binding(4) var<storage,read_write> peak:atomic<u32>;`+main(`
        if(links[i].root!=i||volume[i]<=0.){return;}var j=i;var total=0.;
        loop{let p=point(j);for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;if(inside(q)&&links[index(q)].root==i){continue;}
          ${explicitOnly?'if(outerFace(p,q)){continue;}':''}
          let f=select(flux[j].lo[a],flux[j].hi[a],side>0);
          let t=select(tail[j].lo[a],tail[j].hi[a],side>0);total+=abs(f+t);
        }}j=select(links[j].next,links[i].head,j==i);if(j==0xffffffffu){break;}}
        atomicMax(&peak,bitcast<u32>(.5*total/volume[i]));`));
      gpu.run(op,[links,volumes,flux,tail,peak],grid,explicitOnly?coords:null);
      return (await gpu.read(peak,gpu.staging('CFD measured momentum-group Courant number',4),1))[0];
    },
    merge(state){
      const gather=gpu.bind(sum,[links,state]),fill=gpu.bind(scatter,[links,state]);
      return e=>{gpu.dispatch(e,sum,gather,grid);gpu.dispatch(e,scatter,fill,grid);};
    }};
}

// Find a completely fluid momentum volume through open apertures. Paths use
// decreasing graph distance, so a sliver cannot point back to its child.
// Components consisting entirely of cut cells retain their local grouping.
export async function fluidCentreLinks(gpu,f,mu,wall,parents){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],head=gridWGSL(f);
  const dist=[0,1].map(()=>gpu.buffer('CFD distance to a fluid momentum root',4*n));
  const changed=gpu.buffer('CFD newly reached cut cells',4),stage=gpu.staging('CFD group frontier',4);
  const decl=(b,k,t,w=false)=>`@group(0) @binding(${b}) var<storage,${w?'read_write':'read'}> ${k}:array<${t}>;`;
  const main=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);${s}}`;
  const seed=await gpu.kernel('CFD seed regular exterior volumes',head+decl(0,'mu','vec4f')+decl(1,'wall','vec4f')+
    decl(2,'dist','u32',true)+main('dist[i]=select(0x7fffffffu,0u,mu[i].w==1.&&wall[i].x>0.);'));
  gpu.run(seed,[mu,wall,dist[0]],grid);
  const neighbours=`for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
    var q=p;q[a]+=side;if(!inside(q)){continue;}let j=index(q);let opening=mu[select(j,i,side>0)][a];
    if(opening<=0.||mu[j].w<=0.){continue;}`;
  const flood=await gpu.kernel('CFD find open paths to fluid roots',head+decl(0,'mu','vec4f')+decl(1,'src','u32')+decl(2,'dst','u32',true)+
    '@group(0) @binding(3) var<storage,read_write> changed:atomic<u32>;'+main(`
      let old=src[i];var d=old;if(old==0x7fffffffu&&mu[i].w>0.){
        ${neighbours}d=min(d,src[j]+1u);}}
        if(d<old){atomicOr(&changed,1u);}
      }dst[i]=d;`));
  const binds=dist.map((v,i)=>gpu.bind(flood,[mu,v,dist[1-i],changed]));
  let waves=0;
  for(;;){
    const e=gpu.device.createCommandEncoder();e.clearBuffer(changed);
    for(let i=0;i<2;i++)gpu.dispatch(e,flood,binds[i],grid);
    e.copyBufferToBuffer(changed,0,stage,0,4);gpu.device.queue.submit([e.finish()]);await stage.mapAsync(GPUMapMode.READ);
    let more;try{more=new Uint32Array(stage.getMappedRange())[0];}finally{stage.unmap();}
    waves+=2;if(!more)break;
  }
  const link=await gpu.kernel('CFD join cut momentum through its widest shortest path',head+metricWGSL(f)+
    decl(0,'mu','vec4f')+decl(1,'dist','u32')+decl(2,'parent','u32',true)+main(`
      let d=dist[i];if(d==0u||d==0x7fffffffu){return;}var best=-1.;var parentId=i;let area=faceAreas(cellWidths(p));
      ${neighbours}let score=area[a]*opening;if(dist[j]+1u==d&&score>best){best=score;parentId=j;}
      }}parent[i]=parentId;`));
  const group=gpu.bind(link,[mu,dist[0],parents],metricBuffer(gpu,f));
  return {waves,encode:e=>gpu.dispatch(e,link,group,grid)};
}

// The rotating coordinate velocity and fluid velocity must be integrated
// on the same open polygon. Rotation is affine, so its face integral is
// exact at the aperture centroid. All velocity samples stay on the fluid side.
export async function aperturePredictor(gpu,f,dt,old,pred,mu,centers,primary,tail){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],axes=metricBuffer(gpu,f);
  const head=gridWGSL(f)+metricWGSL(f)+openBoundaries(f)+addFlowWGSL+`
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f} struct Flux{hi:vec4f,lo:vec4f}
    struct Centers{t:array<vec2f,3>}
    @group(0) @binding(0) var<storage,read> star:array<Cell>;
    @group(0) @binding(1) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(2) var<storage,read> center:array<Centers>;
    @group(0) @binding(3) var<storage,read_write> primary:array<Flux>;
    @group(0) @binding(4) var<storage,read_write> tail:array<Flux>;`;
  const derivative=name=>`
    fn slope_${name}(p:vec3i,axis:u32,component:u32)->f32{
      let i=index(p);let u=${name}[i].uk[component];var pm=p;pm[axis]--;var pp=p;pp[axis]++;
      var minus=false;var plus=false;var l=0.;var r=0.;
      if(inside(pm)){let j=index(pm);minus=mu[j][axis]>0.;if(minus){l=(u-${name}[j].uk[component])*spacingInv(axis,p[axis],-1);}}
      if(inside(pp)){let j=index(pp);plus=mu[i][axis]>0.;if(plus){r=(${name}[j].uk[component]-u)*spacingInv(axis,p[axis],1);}}
      if(minus&&plus){return select(0.,sign(l)*min(abs(l),abs(r)),l*r>0.);}return l+r;
    }
    fn value_${name}(l:vec3i,r:vec3i,a:u32,t:f32,offset:vec3f)->f32{
      let i=index(l);let j=index(r);var result=mix(${name}[i].uk[a],${name}[j].uk[a],t);
      if(any(offset!=vec3f(0))){
        for(var b=0u;b<3u;b++){if(offset[b]!=0.){
          result+=offset[b]*mix(slope_${name}(l,b,a),slope_${name}(r,b,a),t);
        }}
      }return result;
    }`;
  async function pipeline(increment){
    return gpu.kernel(increment?'CFD transport relative aperture flow':'CFD initialize relative aperture flow',head+
      (increment?'@group(0) @binding(5) var<storage,read> previous:array<Cell>;'+derivative('previous'):'')+derivative('star')+`
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=CELLS){return;}let p=point(i);let widths=cellWidths(p);let area=faceAreas(widths);
        for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;let internal=inside(q);let other=clamp(q,vec3i(0),DIMS-1);
          let l=select(other,p,side>0);let r=select(p,other,side>0);let li=index(l);let ri=index(r);
          let opening=select(1.,mu[li][a],internal);var v=vec2f(0);
          if(opening>0.){
            let m=axisMetric(a,l[a]);let t=.5*m.y*m.z;var offset=vec3f(0);
            if(internal&&opening<1.){let b=(a+1u)%3u;let c=(a+2u)%3u;let moment=center[li].t[a];
              offset[b]=moment.x*widths[b];offset[c]=moment.y*widths[c];}
            let position=vec3f(${f.origin.join(',')})+(cellCenters(l)+offset)*${f.h};
            let frame=vec3f(0.,-position.z,position.y)[a]*${f.omega*dt/f.h};let weight=opening*area[a];
            let speed=value_star(l,r,a,t,offset);
            ${increment?`let oldSpeed=value_previous(l,r,a,t,offset);let reference=weight*(oldSpeed-frame);
              let high=select(primary[i].lo[a],primary[i].hi[a],side>0);let low=select(tail[i].lo[a],tail[i].hi[a],side>0);
              let diag=mix(star[li].padding.x,star[ri].padding.x,t);
              v=addFlow(high,low,weight*(speed-oldSpeed)-(diag/(1.+diag))*((high-reference)+low));`:
              'v.x=weight*(speed-frame);'}
            if(!internal&&!openFace(a,side)){v=vec2f(area[a]*(select(0.,${f.U*dt/f.h},a==0u)-frame),0.);}
          }
          if(side>0){primary[i].hi[a]=v.x;tail[i].hi[a]=v.y;}else{primary[i].lo[a]=v.x;tail[i].lo[a]=v.y;}
        }}
      }`);
  }
  const [seed,update]=await Promise.all([pipeline(false),pipeline(true)]);
  const buffers=[mu,centers,primary,tail];
  const initial=gpu.bind(seed,[old,...buffers],axes),first=gpu.bind(seed,[pred,...buffers],axes);
  const later=gpu.bind(update,[pred,...buffers,old],axes);
  return {
    initial:e=>gpu.dispatch(e,seed,initial,grid),
    predict:(e,cold)=>gpu.dispatch(e,cold?seed:update,cold?first:later,grid)
  };
}

// Spalding's smooth-wall relation, y+ = F(u+). Solving u+ F(u+) =
// |Ut| y / nu returns tau / (rho |Ut|) in the caller's velocity units.
export const wallResistanceWGSL=`
  fn wallResistance(speed:f32,distance:f32,nu:f32)->f32{
    let d=max(distance,1e-12);let re=speed*d/nu;if(re<.001){return nu/d;}
    var lo=0.;var hi=min(sqrt(re),8.+log(1.+9.8*re)/.41);
    for(var it=0u;it<14u;it++){
      let up=.5*(lo+hi);let x=.41*up;
      let excess=max(0.,exp(min(x,80.))-1.-x-.5*x*x-x*x*x/6.);
      if(up*(up+excess/9.8)>re){hi=up;}else{lo=up;}
    }
    let up=.5*(lo+hi);return speed/(up*up);
  }
  fn tangentialSlip(relative:vec3f,normal:vec3f)->vec3f{return relative-dot(relative,normal)*normal;}`;

// Wall-adjacent SST condition with a continuous Spalding friction velocity.
// Both wall limits of omega and the k production use the same physical y.
export const sstWallWGSL=wallResistanceWGSL+`
  fn sstWall(speed:f32,y:f32,nu:f32)->vec3f{
    let resistance=wallResistance(speed,y,nu);let friction=sqrt(max(0.,speed*resistance));
    let visc=6.*nu/(.075*y*y);let logOmega=friction/(.41*.3*y);
    let viscousFraction=clamp(nu/(y*resistance),0.,1.);
    return vec3f(length(vec2f(visc,logOmega)),(1.-viscousFraction)*friction*friction*friction/(.41*y),viscousFraction*nu/y);
  }`;

// Transport the reconstructed upwind velocity at the actual aperture centroid.
// Store each interior correction once, together with the transpose-gradient
// part of the deviatoric stress. Its two cells receive opposite impulses.
export async function cutFaceTransport(gpu,f,dt,old,predictor,mu,centers,wall,flux,tail){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],axes=metricBuffer(gpu,f);
  const gradient=gpu.buffer('CFD open-fluid velocity reconstruction',48*n),faces=gpu.buffer('CFD shared face momentum correction',48*n);
  const common=gridWGSL(f)+metricWGSL(f)+outerSpinWGSL(f)+`
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f} struct Centers{t:array<vec2f,3>}
    struct Gradient{v:array<vec4f,3>} struct Flux{hi:vec4f,lo:vec4f}
    fn offset(a:u32,side:i32,w:vec3f,t:vec2f)->vec3f{
      let b=(a+1u)%3u;let c=(a+2u)%3u;var d=vec3f(0);d[a]=.5*f32(side)*w[a];d[b]=t.x*w[b];d[c]=t.y*w[c];return d;
    }
    fn matrix(g:Gradient)->mat3x3f{return mat3x3f(g.v[0].xyz,g.v[1].xyz,g.v[2].xyz);}`;
  const decl=(b,k,t,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${k}:array<${t}>;`;
  const main=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
  const reconstruct=await gpu.kernel('CFD bounded gradients on connected fluid faces',common+decl(0,'s','Cell')+
    decl(1,'mu','vec4f')+decl(2,'center','Centers')+decl(3,'grad','Gradient',true)+main(`
    if(mu[i].w<=0.){return;}let u=s[i].uk.xyz;let w=cellWidths(p);var low=u;var high=u;var g:mat3x3f;
    for(var a=0u;a<3u;a++){
      var lm=0.;var lp=0.;var left=vec3f(0);var right=vec3f(0);
      for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;if(!inside(q)){continue;}
        let j=index(q);let owner=select(j,i,side>0);if(mu[owner][a]<=0.){continue;}
        let v=s[j].uk.xyz;low=min(low,v);high=max(high,v);let inv=spacingInv(a,p[a],side);
        if(side<0){lm=1./inv;left=(u-v)*inv;}else{lp=1./inv;right=(v-u)*inv;}
      }
      if(lm*lp>0.){g[a]=(lp*left+lm*right)/(lm+lp);}else{g[a]=left+right;}
    }
    var phi=vec3f(1);
    for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
      var q=p;q[a]+=side;if(!inside(q)){continue;}let owner=select(index(q),i,side>0);if(mu[owner][a]<=0.){continue;}
      let du=g*offset(a,side,w,center[owner].t[a]);
      for(var k=0u;k<3u;k++){if(du[k]>0.){phi[k]=min(phi[k],(high[k]-u[k])/du[k]);}
        else if(du[k]<0.){phi[k]=min(phi[k],(low[k]-u[k])/du[k]);}}
    }}
    for(var a=0u;a<3u;a++){grad[i].v[a]=vec4f(g[a],phi[a]);}`));
  const reconGroup=gpu.bind(reconstruct,[old,mu,centers,gradient],axes);
  const shared=await gpu.kernel('CFD integrated higher-order face momentum',common+decl(0,'s','Cell')+
    decl(1,'mu','vec4f')+decl(2,'center','Centers')+decl(3,'grad','Gradient')+decl(4,'flow','Flux')+
    decl(5,'tail','Flux')+decl(6,'face','Gradient',true)+main(`
    let w=cellWidths(p);let area=faceAreas(w);
    for(var a=0u;a<3u;a++){var q=p;q[a]++;var impulse=vec3f(0);
      if(inside(q)&&mu[i][a]>0.){
        let j=index(q);let value=flow[i].hi[a]+tail[i].hi[a];let up=select(j,i,value>=0.);let attr=grad[up];
        let phi=vec3f(attr.v[0].w,attr.v[1].w,attr.v[2].w);let side=select(-1,1,value>=0.);
        let delta=phi*(matrix(attr)*offset(a,side,cellWidths(point(up)),center[i].t[a]));
        let l=matrix(grad[i]);let r=matrix(grad[j]);let t=.5*w[a]*spacingInv(a,p[a],1);
        let g=(1.-t)*l+t*r;
        var transposeFlux=vec3f(g[0][a],g[1][a],g[2][a]);transposeFlux[a]-=(2./3.)*(g[0].x+g[1].y+g[2].z);
        let viscosity=${f.nu*dt/f.h**2}+.5*(s[i].wt.y+s[j].wt.y);
        impulse=mu[i][a]*area[a]*viscosity*transposeFlux-select(value,0.,outerFace(p,q))*delta;
      }face[i].v[a]=vec4f(impulse,0);
    }`));
  const faceGroup=gpu.bind(shared,[old,mu,centers,gradient,flux,tail,faces],axes);
  const gather=await gpu.kernel('CFD conservative momentum from shared faces',common+decl(0,'face','Gradient')+
    decl(1,'wall','vec4f')+decl(2,'s','Cell',true)+main(`
    let ratio=wall[i].w;if(ratio<=0.){return;}let w=cellWidths(p);var change=vec3f(0);
    for(var a=0u;a<3u;a++){var q=p;q[a]--;change+=face[i].v[a].xyz;if(inside(q)){change-=face[index(q)].v[a].xyz;}}
    let v=s[i].uk;s[i].uk=vec4f(v.xyz+change/(w.x*w.y*w.z*ratio),v.w);`));
  const gatherGroup=gpu.bind(gather,[faces,wall,predictor],axes);
  return {faces,reconstruct:e=>gpu.dispatch(e,reconstruct,reconGroup,grid),transfer:e=>gpu.dispatch(e,shared,faceGroup,grid),
    apply:e=>gpu.dispatch(e,gather,gatherGroup,grid)};
}

// Set the wall-adjacent omega and production on the actual merged momentum
// volume. Weight corner and floor contributions by their exposed areas.
export async function mergedSstWall(gpu,f,dt,groups,wall,mu,previous,predictor){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)];
  const code=gridWGSL(f)+metricWGSL(f)+sstWallWGSL+`
    const NU=${f.nu*dt/f.h**2};
    struct Cell{uk:vec4f,wt:vec2f,padding:vec2f}
    struct Links{root:u32,head:u32,next:u32}
    @group(0) @binding(0) var<storage,read> links:array<Links>;
    @group(0) @binding(1) var<storage,read> wall:array<vec4f>;
    @group(0) @binding(2) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(3) var<storage,read> old:array<Cell>;
    @group(0) @binding(4) var<storage,read_write> pred:array<Cell>;
    fn contribution(velocity:vec3f,normal:vec3f,y:f32,area:f32)->vec4f{
      return area*vec4f(1.,sstWall(length(tangentialSlip(velocity,normal)),y,NU));
    }
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
      let i=gid.x;if(i>=CELLS||mu[i].w<=0.){return;}let root=links[i].root;
      let u=old[root].uk.xyz;let w=cellWidths(point(root));let volume=w.x*w.y*w.z*wall[root].w;
      var surface=vec4f(0);var j=root;
      loop{
        let p=point(j);let width=cellWidths(p);let area=faceAreas(width);
        var solidArea=vec3f(0);var gradient=vec3f(0);
        for(var a=0u;a<3u;a++){for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;if(!inside(q)){continue;}let k=index(q);
          solidArea[a]-=f32(side)*(1.-mu[select(k,j,side>0)][a])*area[a];
          gradient[a]+=.5*f32(side)*(wall[k].x-wall[j].x)*spacingInv(a,p[a],side);
        }}
        let exposed=length(solidArea);
        if(exposed>0.){
          let normal=normalize(select(solidArea,gradient,dot(gradient,gradient)>1e-12));
          let y=max(wall[j].x,.5/length(normal/width));
          let arm=vec3f(${f.origin.join(',')})+(cellCenters(p)-max(0.,wall[j].x)*normal)*${f.h};
          let uw=vec3f(0.,-arm.z,arm.y)*${f.rotatingFrame?f.omega*dt/f.h:0};
          surface+=contribution(u-uw,normal,y,exposed);
        }
        if(p.y==0&&${!!(f.fixedFloor||f.movingRoad)}){
          surface+=contribution(u-vec3f(${f.movingRoad?f.U*dt/f.h:0},0.,0.),vec3f(0,1,0),.5*width.y,area.y);
        }
        j=select(links[j].next,links[root].head,j==root);if(j==0xffffffffu){break;}
      }
      var s=pred[i];var k=s.uk.w;var omega=max(1e-8,s.wt.x);
      if(surface.x>0.){
        omega=surface.y/surface.x;
        let production=min(surface.z/surface.x,10.*.09*max(1e-12,old[root].uk.w)*omega);
        k=(k-s.wt.y+production/(1.+.09*max(1e-8,old[root].wt.x)))/(1.+surface.w/volume);
      }
      k=max(1e-12,k);s.uk.w=k;s.wt=vec2f(omega,.31*k/max(.31*omega,s.padding.y));pred[i]=s;
    }`;
  const op=await gpu.kernel('CFD wall-adjacent SST transport',code);
  const bind=gpu.bind(op,[groups.links,wall,mu,previous,predictor],metricBuffer(gpu,f));
  return e=>gpu.dispatch(e,op,bind,grid);
}

// For a cut fluid volume, the wall first moment follows directly from the
// divergence theorem: integral_wall n_a r_b = V delta_ab - sum_open n_a r_b A.
// The clipped face centroids supply r. This gives the pressure reaction on an
// oblique wall and the correction on its fluid with equal and opposite signs.
export async function linearCutPressure(gpu,f,mu,centers,wall,pressure,state,force,loads){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],coords=metricBuffer(gpu,f);
  const base=gridWGSL(f)+metricWGSL(f)+openBoundaries(f);
  const storage=(b,name,type,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<${type}>;`;
  const main=code=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
    let i=gid.x;if(i>=CELLS){return;}let p=point(i);${code}}`;
  const grad=gpu.buffer('CFD reconstructed pressure gradient',16*n);
  const derivative=await gpu.kernel('CFD open-sided pressure gradient',base+storage(0,'mu','vec4f')+storage(1,'pressure','f32')+storage(2,'grad','vec4f',true)+main(`
    let pi=pressure[i];let w=cellWidths(p);var d=vec3f(0);
    if(mu[i].w>0.){for(var a=0u;a<3u;a++){var sum=0.;var weight=0.;
      for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;
        if(inside(q)){let j=index(q);let open=mu[select(j,i,side>0)][a];
          sum+=open*f32(side)*(pressure[j]-pi)*spacingInv(a,p[a],side);weight+=open;}
        else if(openFace(a,side)){sum-=2.*f32(side)*pi/w[a];weight+=1.;}
      }if(weight>0.){d[a]=sum/weight;}
    }}grad[i]=vec4f(d,pi);`));
  const derivativeGroup=gpu.bind(derivative,[mu,pressure,grad],coords);
  const apply=await gpu.kernel('CFD linear pressure on clipped faces and wall',base+
    'struct Centers{t:array<vec2f,3>};'+storage(0,'mu','vec4f')+storage(1,'centers','Centers')+storage(2,'wall','vec4f')+
    storage(3,'grad','vec4f')+storage(4,'state','vec4f',true)+storage(5,'force','f32',true)+storage(6,'load','vec4f',true)+main(`
    let theta=mu[i].w;if(theta==0.){return;}let w=cellWidths(p);let area=faceAreas(w);let vol=w.x*area.x;
    var hasWall=theta<1.;var wallArea=vec3f(0);var moments:mat3x3f;var openCorrection=vec3f(0);
    for(var a=0u;a<3u;a++){let b=(a+1u)%3u;let c=(a+2u)%3u;moments[a][a]=theta*vol;
      for(var side=-1;side<=1;side+=2){var q=p;q[a]+=side;let sign=f32(side);var m=1.;var offset=vec3f(0);
        if(inside(q)){let j=index(q);let l=select(j,i,side>0);let r=select(i,j,side>0);m=mu[l][a];
          if(m<1.){hasWall=true;}
          if(m>0.&&m<1.){let t=centers[l].t[a];offset[b]=t.x*w[b];offset[c]=t.y*w[c];
            let cm=axisMetric(a,min(p[a],q[a]));let derivative=mix(grad[l].xyz,grad[r].xyz,.5*cm.y*cm.z);
            openCorrection[a]+=sign*area[a]*m*dot(derivative,offset);}
        }
        wallArea[a]+=sign*(1.-m)*area[a];offset[a]=sign*.5*w[a];
        moments[a]-=sign*area[a]*m*offset;
      }
    }
    if(!hasWall){return;}let g=grad[i];let extra=vec3f(dot(moments[0],g.xyz),dot(moments[1],g.xyz),dot(moments[2],g.xyz));
    let fluid=state[2u*i];state[2u*i]=vec4f(fluid.xyz-(extra+openCorrection)/(vol*wall[i].w),fluid.w);
    // Constant-pressure torque uses the exact first moment. The linear
    // force acts at the area centroid for the remaining second-order term.
    let center=moments*wallArea/max(dot(wallArea,wallArea),1e-30);
    let arm=vec3f(${f.origin.join(',')})+(cellCenters(p)+clamp(center,-.5*w,.5*w))*${f.h};
    let torque=g.w*(moments[2].y-moments[1].z)*${f.h}+cross(arm,extra).x;
    force[i]+=extra.x;load[i]+=vec4f(extra.x,torque,extra.yz);
    ${f.fullMoment?`let transverse=g.w*vec2f(moments[0].z-moments[2].x,moments[1].x-moments[0].y)*${f.h}+cross(arm,extra).yz;
      load[CELLS+i]+=vec4f(0.,0.,transverse);`:''}`));
  const applyGroup=gpu.bind(apply,[mu,centers,wall,grad,state,force,loads],coords);
  return e=>{gpu.dispatch(e,derivative,derivativeGroup,grid);gpu.dispatch(e,apply,applyGroup,grid);};
}

// Integrate each physical step in both the rotating basis and the fixed box
// axes. Rotating a mean transverse load after a revolution loses its phase.
export async function rotatingLoads(gpu,loads){
  const phase=gpu.buffer('CFD angle at the impulse midpoint',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const sums=gpu.buffer('CFD rotating and fixed transverse impulses',loads.size);
  const pipe=await gpu.kernel('CFD phase-resolved transverse reaction',`
    @group(0) @binding(0) var<storage,read_write> load:array<vec4f>;
    @group(0) @binding(1) var<storage,read_write> sum:array<vec4f>;
    @group(0) @binding(2) var<uniform> phase:vec4f;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=arrayLength(&load)){return;}let q=load[i];let f=q.zw;
      sum[i]+=vec4f(f,phase.x*f.x-phase.y*f.y,phase.y*f.x+phase.x*f.y);
      load[i]=vec4f(q.xy,0.,0.);
    }`);
  const group=gpu.bind(pipe,[loads,sums,phase]),grid=[Math.ceil(loads.size/(16*128))];
  return {sums,angle(value){gpu.device.queue.writeBuffer(phase,0,new Float32Array([Math.cos(value),Math.sin(value)]));},
    encode:e=>gpu.dispatch(e,pipe,group,grid)};
}

// Backward Euler on the actual merged control volumes. A root owns its
// external discharges, including boundary reservoirs. Red/black singletons
// only touch opposite-colour singletons or a frozen merged root. Update all
// merged roots in a separate Jacobi pass to avoid colour conflicts.
export async function groupTransport(gpu,f,dt,rhs,high,low,groups){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],count=groups.stats.groupsWithChildren;
  const mergedGrid=[Math.ceil(count/128)],{links,volumes}=groups;
  const work=gpu.buffer('CFD implicit merged-volume transport iterate',rhs.size);
  // WGSL includes the first element of the runtime array in the minimum binding size.
  const merged=gpu.buffer('CFD merged transport root indices',4*(1+Math.max(1,count)));
  const pending=gpu.buffer('CFD merged transport updates',Math.max(1,count)*32);
  const peak=gpu.buffer('CFD merged transport residual',4),stage=gpu.staging('CFD merged transport readback',4);
  const free=f.U*dt/f.h,reference=f.maxSpeed*dt/f.h,k0=1.5*(.005*reference)**2,omega0=k0/(5*f.nu*dt/f.h**2);
  const types=`struct Cell{uk:vec4f,wt:vec2f,pad:vec2f} struct Flux{hi:vec4f,lo:vec4f}
    struct Link{root:u32,head:u32,next:u32} struct Roster{count:u32,ids:array<u32>}
    struct Budget{incoming:vec4f,omega:f32,outgoing:f32} const END=0xffffffffu;`;
  const op=(body)=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;${body}}`;
  const storage=(i,name,type,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:${type};`;
  const roster=await gpu.kernel('CFD list merged transport roots',types+storage(0,'link','array<Link>')+
    'struct WritableRoster{count:atomic<u32>,ids:array<u32>}'+storage(1,'roster','WritableRoster',true)+
    op('if(i<arrayLength(&link)&&link[i].head!=END){let j=atomicAdd(&roster.count,1u);roster.ids[j]=i;}'));
  gpu.run(roster,[links,merged],grid);
  const base=(writeRhs,writeGuess)=>gridWGSL(f)+types+storage(0,'rhs','array<Cell>',writeRhs)+storage(1,'guess','array<Cell>',writeGuess)+
    storage(2,'link','array<Link>')+storage(3,'volume','array<f32>')+storage(4,'high','array<Flux>')+storage(5,'low','array<Flux>')+`
    fn transfers(root:u32)->Budget{
      var sums=Budget(vec4f(0),0.,0.);var i=root;let inv=1./volume[root];
      loop{let p=point(i);
        for(var axis=0u;axis<3u;axis++){for(var side=-1;side<=1;side+=2){
          var q=p;q[axis]+=side;let internal=inside(q);let neighbour=link[bounded(q)].root;
          if(internal&&neighbour==root){continue;}
          let h=select(high[i].lo[axis],high[i].hi[axis],side>0);
          let l=select(low[i].lo[axis],low[i].hi[axis],side>0);let rate=f32(side)*(h+l)*inv;
          if(rate>=0.){sums.outgoing+=rate;}else{
            var u=vec4f(${free},0.,0.,${k0});var omega=f32(${omega0});
            if(internal){u=guess[neighbour].uk;omega=guess[neighbour].wt.x;}
            sums.incoming-=rate*u;sums.omega-=rate*omega;
          }
        }}
        i=select(link[i].next,link[root].head,i==root);if(i==END){break;}
      }return sums;
    }
    fn updated(i:u32)->Cell{let t=transfers(i);var s=rhs[i];let scale=1./(1.+t.outgoing);
      s.uk=(s.uk+t.incoming)*scale;s.wt.x=(s.wt.x+t.omega)*scale;return s;}`;
  const bindings=[rhs,work,links,volumes,high,low];
  const regular=[];
  for(let colour=0;colour<2;colour++){
    const pipe=await gpu.kernel('CFD implicit singleton colour '+colour,base(false,true)+op(`
      if(i>=CELLS||link[i].root!=i||link[i].head!=END||volume[i]<=0.){return;}
      let p=point(i);if(((p.x+p.y+p.z)&1)==${colour}){guess[i]=updated(i);}`));
    regular.push([pipe,gpu.bind(pipe,bindings)]);
  }
  let updateMerged=null;
  if(count){
    const update=await gpu.kernel('CFD implicit irregular volumes',base(false,false)+storage(6,'roster','Roster')+
      storage(7,'next','array<Cell>',true)+op('if(i<roster.count){next[i]=updated(roster.ids[i]);}'));
    const apply=await gpu.kernel('CFD publish merged-volume iterate',types+storage(0,'roster','Roster')+
      storage(1,'next','array<Cell>')+storage(2,'guess','array<Cell>',true)+op('if(i<roster.count){guess[roster.ids[i]]=next[i];}'));
    const a=gpu.bind(update,[...bindings,merged,pending]),b=gpu.bind(apply,[merged,pending,work]);
    updateMerged=e=>{gpu.dispatch(e,update,a,mergedGrid);gpu.dispatch(e,apply,b,mergedGrid);};
  }
  const error=await gpu.kernel('CFD actual merged-volume transport defect',base(false,false)+storage(6,'peak','atomic<u32>',true)+`
    var<workgroup> block:array<u32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
      let i=id.x;var v=0.;if(i<CELLS&&volume[i]>0.){
        let t=transfers(i);let a=guess[i];let b=rhs[i];let r=abs((b.uk-a.uk)+t.incoming-t.outgoing*a.uk);
        let w=abs((b.wt.x-a.wt.x)+t.omega-t.outgoing*a.wt.x);
        v=max(length(r.xyz)/max(${reference},length(a.uk.xyz)),max(r.w/max(${k0},abs(a.uk.w)),w/max(${omega0},abs(a.wt.x))));
      }
      block[lane]=bitcast<u32>(v);for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(lane<d){block[lane]=max(block[lane],block[lane+d]);}}
      if(lane==0u){atomicMax(&peak,block[0]);}
    }`);
  const finish=await gpu.kernel('CFD integrate external group discharges',base(true,false)+op(`
    if(i<CELLS&&volume[i]>0.){let t=transfers(i);let v=guess[i];var s=rhs[i];
      s.uk+=t.incoming-t.outgoing*v.uk;s.wt.x+=t.omega-t.outgoing*v.wt.x;rhs[i]=s;}`));
  const scatter=await gpu.kernel('CFD scatter implicit merged momentum',types+storage(0,'link','array<Link>')+
    storage(1,'rhs','array<Cell>',true)+op('if(i<arrayLength(&link)&&link[i].root!=i){rhs[i]=rhs[link[i].root];}'));
  const check=gpu.bind(error,[...bindings,peak]),final=gpu.bind(finish,bindings),fill=gpu.bind(scatter,[links,rhs]);
  const begin={kind:'initialize implicit group transport',encode:e=>e.copyBufferToBuffer(rhs,0,work,0,rhs.size)};
  const sweep={kind:'implicit group transport sweep',encode:e=>{
    for(const [pipe,group] of regular)gpu.dispatch(e,pipe,group,grid);
    updateMerged?.(e);
  }};
  const norm={kind:'measure group transport residual',encode:e=>{
    e.clearBuffer(peak);gpu.dispatch(e,error,check,grid);e.copyBufferToBuffer(peak,0,stage,0,4);
  }};
  const end={kind:'conservative group transport integral',encode:e=>{
    gpu.dispatch(e,finish,final,grid);if(count)gpu.dispatch(e,scatter,fill,grid);
  }};
  return residualControlledTransport(stage,begin,sweep,norm,end,192);
}

// Route only the remaining projection defect. An edge never crosses a closed
// face. A root discharges through an actual pressure reservoir. Components
// disconnected from all reservoirs retain the ordinary pressure correction.
export async function fluxEquilibration(gpu,f,dt,mu,flux,tail){
  const device=gpu.device,n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],axes=metricBuffer(gpu,f);
  const common=gridWGSL(f)+openBoundaries(f)+`
    const NONE=0xffffffffu;
    fn neighbour(p:vec3i,code:u32)->vec3i{var q=p;q[code/2u]+=select(-1,1,(code&1u)!=0u);return q;}
    fn upper(code:u32)->bool{return (code&1u)!=0u;}`;
  const st=(i,name,type,write=false)=>`@group(0) @binding(${i}) var<storage,${write?'read_write':'read'}> ${name}:${type};`;
  const arr=(i,name,type,write=false)=>st(i,name,'array<'+type+'>',write);
  const each=body=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);${body}}`;
  const distances=[0,1].map(()=>gpu.buffer('CFD distance to an open pressure boundary',4*n));
  const changed=gpu.buffer('CFD pressure forest frontier flag',4),one=gpu.staging('CFD pressure forest convergence',4);
  const seed=await gpu.kernel('CFD pressure discharge reservoirs',common+arr(0,'mu','vec4f')+arr(1,'dist','u32',true)+each(`
    var depth=NONE;if(mu[i].w>0.){for(var code=0u;code<6u;code++){
      if(!inside(neighbour(p,code))&&openFace(code/2u,select(-1,1,upper(code)))){depth=0u;}
    }}dist[i]=depth;`));
  gpu.run(seed,[mu,distances[0]],grid);
  const flood=await gpu.kernel('CFD grow pressure paths through open fluid faces',common+arr(0,'mu','vec4f')+
    arr(1,'src','u32')+arr(2,'dst','u32',true)+st(3,'changed','atomic<u32>',true)+each(`
      var d=src[i];if(d==NONE&&mu[i].w>0.){for(var c=0u;c<6u;c++){
        let q=neighbour(p,c);if(!inside(q)){continue;}let j=index(q);
        if(mu[select(j,i,upper(c))][c/2u]<=0.||src[j]==NONE){continue;}d=min(d,src[j]+1u);
      }if(d!=NONE){atomicOr(&changed,1u);}}dst[i]=d;`));
  const floodBind=distances.map((d,k)=>gpu.bind(flood,[mu,d,distances[1-k],changed]));
  let waves=0,expanded;
  do{
    const e=device.createCommandEncoder();e.clearBuffer(changed);
    for(let k=0;k<8;k++)gpu.dispatch(e,flood,floodBind[k%2],grid);
    waves+=8;e.copyBufferToBuffer(changed,0,one,0,4);device.queue.submit([e.finish()]);await one.mapAsync(GPUMapMode.READ);
    try{expanded=new Uint32Array(one.getMappedRange())[0];}finally{one.unmap();}
  }while(expanded);
  const bucket=gpu.buffer('CFD pressure forest level counts',4*(waves+2)),parent=gpu.buffer('CFD pressure discharge direction',4*n);
  const choose=await gpu.kernel('CFD widest shortest pressure paths',common+metricWGSL(f)+arr(0,'mu','vec4f')+
    arr(1,'dist','u32')+arr(2,'direction','u32',true)+st(3,'bucket','array<atomic<u32>>',true)+each(`
      let d=dist[i];var best=-1.;var choice=NONE;
      if(d!=NONE){let w=cellWidths(p);let area=faceAreas(w);
        for(var c=0u;c<6u;c++){let a=c/2u;let q=neighbour(p,c);var strength=0.;
          if(inside(q)){let j=index(q);if(dist[j]>=d){continue;}
            strength=mu[select(j,i,upper(c))][a]*area[a]*spacingInv(a,p[a],select(-1,1,upper(c)));
          }else{if(d!=0u||!openFace(a,select(-1,1,upper(c)))){continue;}strength=2.*area[a]/w[a];}
          if(strength>0.&&strength>best){best=strength;choice=c;}
        }atomicAdd(&bucket[d],1u);
      }else if(mu[i].w>0.){atomicAdd(&bucket[${waves+1}u],1u);}
      direction[i]=choice;`));
  gpu.run(choose,[mu,distances[0],parent,bucket],grid,axes);
  const histogram=gpu.staging('CFD pressure forest level sizes',bucket.size);
  const levels=new Uint32Array((await gpu.read(bucket,histogram,waves+2)).buffer);
  const offsets=new Uint32Array(waves+1);let reached=0;
  for(let k=0;k<offsets.length;k++){offsets[k]=reached;reached+=levels[k];}
  const ordered=gpu.buffer('CFD pressure forest by depth',4*Math.max(1,reached));
  device.queue.writeBuffer(bucket,0,offsets);
  const pack=await gpu.kernel('CFD order pressure paths by depth',common+arr(0,'dist','u32')+
    st(1,'offset','array<atomic<u32>>',true)+arr(2,'ids','u32',true)+each('if(dist[i]!=NONE){ids[atomicAdd(&offset[dist[i]],1u)]=i;}'));
  gpu.run(pack,[distances[0],bucket,ordered],grid);
  // Geometry is static for this projection. These scratch buffers can be
  // retired once ordering has finished, even during a long physical study.
  await device.queue.onSubmittedWorkDone();for(const b of [...distances,bucket,histogram,one,changed])b.destroy();

  const sum=gpu.buffer('CFD compensated subtree discharges',8*n);
  const audit=gpu.buffer('CFD discharge reconstruction bounds',8),auditStage=gpu.staging('CFD conservative reconstruction limit',8);
  const energy=gpu.buffer('CFD face energy by workgroup',4*grid[0]);
  const stats={levels:levels.subarray(0,-1).filter(v=>v>0).length,reached,sealedUnreached:levels.at(-1),
    attempts:0,accepted:0,maxAcceptedRelativeSpeed:0,maxAcceptedRelativeRmsPressureGradientBound:0,maxTriedRelativeSpeed:0};
  const fields='struct Flux{hi:vec4f,lo:vec4f} ';
  const collect=await gpu.kernel('CFD conservative subtree sum',common+fields+addFlowWGSL+
    arr(0,'h','Flux')+arr(1,'l','Flux')+arr(2,'dir','u32')+arr(3,'ids','u32')+arr(4,'sum','vec2f',true)+
    '@group(0) @binding(5) var<uniform> block:vec2u;'+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
      if(id.x>=block.y){return;}let i=ids[block.x+id.x];let p=point(i);var s=vec2f(0);
      for(var c=0u;c<6u;c++){let a=c/2u;let sign=select(-1.,1.,upper(c));
        let v=select(h[i].lo[a],h[i].hi[a],upper(c));let w=select(l[i].lo[a],l[i].hi[a],upper(c));
        s=addFlow(s.x,s.y,sign*v);s=addFlow(s.x,s.y,sign*w);
        let q=neighbour(p,c);if(inside(q)){let j=index(q);if(dir[j]==(c^1u)){
          let child=sum[j];s=addFlow(s.x,s.y,child.x);s=addFlow(s.x,s.y,child.y);
        }}
      }sum[i]=s;
    }`);
  const sweeps=[];
  for(let depth=waves;depth>=0;depth--){if(!levels[depth])continue;
    const range=gpu.buffer('CFD pressure discharge level',new Uint32Array([offsets[depth],levels[depth],0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    sweeps.push([gpu.bind(collect,[flux,tail,parent,ordered,sum,range]),[Math.ceil(levels[depth]/128)]]);
  }
  const reference=f.maxSpeed*dt/f.h;
  const bound=await gpu.kernel('CFD bound the face velocity perturbation',common+metricWGSL(f)+arr(0,'mu','vec4f')+
    arr(1,'dir','u32')+arr(2,'sum','vec2f')+st(3,'peak','atomic<u32>',true)+arr(4,'energy','f32',true)+`
    var<workgroup> values:array<u32,128>;var<workgroup> energies:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) block:vec3u){
      let i=id.x;var v=0.;var e=0.;if(i<CELLS&&dir[i]!=NONE){let c=dir[i];let a=c/2u;let p=point(i);let q=neighbour(p,c);
        let width=cellWidths(p);var aperture=1.;var distance=.5*width[a];
        if(inside(q)){aperture=mu[select(index(q),i,upper(c))][a];distance=1./spacingInv(a,p[a],select(-1,1,upper(c)));}
        let area=aperture*faceAreas(width)[a];let flow=(sum[i].x+sum[i].y)/${reference};
        v=abs(flow)/area;e=flow*flow*distance/area;
      }values[lane]=bitcast<u32>(v);energies[lane]=e;
      for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(lane<d){values[lane]=max(values[lane],values[lane+d]);energies[lane]+=energies[lane+d];}}
      if(lane==0u){atomicMax(&peak,values[0]);energy[block.x]=energies[0];}
    }`);
  const boundGroup=gpu.bind(bound,[mu,parent,sum,audit,energy],axes);
  const volume=f.axes?f.axes.reduce((v,axis)=>v*(axis.at(-1)-axis[0])/f.h,1):n;
  // The missing elliptic correction minimizes sum(q^2/conductance) among
  // flows with this defect. A feasible discharge bounds its pressure energy.
  const reduce=await gpu.kernel('CFD upper bound on the remaining pressure gradient',arr(0,'terms','f32')+arr(1,'audit','f32',true)+`
    var<workgroup> sums:array<f32,128>;
    @compute @workgroup_size(128) fn main(@builtin(local_invocation_index) lane:u32){
      var s=0.;for(var i=lane;i<arrayLength(&terms);i+=128u){s+=terms[i];}sums[lane]=s;
      for(var d=64u;d>0u;d/=2u){workgroupBarrier();if(lane<d){sums[lane]+=sums[lane+d];}}
      if(lane==0u){audit[1]=sqrt(sums[0]/${volume});}
    }`);
  const reduceGroup=gpu.bind(reduce,[energy,audit]);
  const apply=await gpu.kernel('CFD share equilibrated discharges on both incidences',common+fields+addFlowWGSL+
    arr(0,'h','Flux',true)+arr(1,'l','Flux',true)+arr(2,'dir','u32')+arr(3,'sum','vec2f')+each(`
      let own=dir[i];if(own==NONE){return;}var hi=h[i];var lo=l[i];
      for(var c=0u;c<6u;c++){let a=c/2u;let sign=select(-1.,1.,upper(c));var d=vec2f(0);
        if(own==c){d=-sign*sum[i];}else{let q=neighbour(p,c);if(!inside(q)){continue;}
          let j=index(q);if(dir[j]!=(c^1u)){continue;}d=sign*sum[j];}
        var pair=addFlow(select(hi.lo[a],hi.hi[a],upper(c)),select(lo.lo[a],lo.hi[a],upper(c)),d.x);
        pair=addFlow(pair.x,pair.y,d.y);
        if(upper(c)){hi.hi[a]=pair.x;lo.hi[a]=pair.y;}else{hi.lo[a]=pair.x;lo.lo[a]=pair.y;}
      }h[i]=hi;l[i]=lo;`));
  const applyGroup=gpu.bind(apply,[flux,tail,parent,sum]);
  const proposals=sweeps.map(([group,size])=>({kind:'sum pressure discharge level',encode:e=>gpu.dispatch(e,collect,group,size)}));
  proposals.push({kind:'bound face perturbation',encode:e=>{
    e.clearBuffer(audit);gpu.dispatch(e,bound,boundGroup,grid);gpu.dispatch(e,reduce,reduceGroup,[1]);e.copyBufferToBuffer(audit,0,auditStage,0,8);
  }});
  const publish={kind:'equilibrate shared discharges',encode:e=>gpu.dispatch(e,apply,applyGroup,grid)};
  return {stats,async correct(scheduler,assertCurrent,limit=1e-5){
    await scheduler.perform(proposals,assertCurrent);await auditStage.mapAsync(GPUMapMode.READ);let peak,rms;
    try{[peak,rms]=new Float32Array(auditStage.getMappedRange());}finally{auditStage.unmap();}
    stats.attempts++;stats.maxTriedRelativeSpeed=Math.max(peak,stats.maxTriedRelativeSpeed);
    if(!Number.isFinite(peak)||!Number.isFinite(rms)||peak>limit||rms>limit)return false;
    await scheduler.perform([publish],assertCurrent);stats.accepted++;
    stats.maxAcceptedRelativeSpeed=Math.max(peak,stats.maxAcceptedRelativeSpeed);
    stats.maxAcceptedRelativeRmsPressureGradientBound=Math.max(rms,stats.maxAcceptedRelativeRmsPressureGradientBound);return true;
  }};
}

export const countOf=dims=>dims.reduce((a,b)=>a*b);

const workgroups=n=>{const g=Math.ceil(n/64);return [Math.min(65535,g),Math.ceil(g/65535)];};

export function distanceBand(f,meshes,limit,pitch=f.h/(f.subcellSurface?6:2)){
  const lo=[Infinity,Infinity,Infinity],hi=lo.map(v=>-v);
  for(const m of meshes)for(let k=0;k<3;k++){
    lo[k]=Math.min(lo[k],m.bounds.min[k]);hi[k]=Math.max(hi[k],m.bounds.max[k]);
  }
  const extent=f.dims.map((d,k)=>f.axes?f.axes[k].at(-1)-f.origin[k]:d*f.h);
  let h=pitch;
  for(;;){
    const limits=extent.map(v=>Math.max(3,Math.ceil(v/h)));
    const first=lo.map((v,k)=>Math.max(0,Math.min(limits[k]-3,Math.floor((v-f.origin[k])/h)-12)));
    const last=hi.map((v,k)=>Math.min(limits[k],Math.max(first[k]+3,Math.ceil((v-f.origin[k])/h)+12)));
    const dims=last.map((v,k)=>v-first[k]);
    if(countOf(dims)<=limit)return {h,dims,origin:first.map((v,k)=>f.origin[k]+(v+.5)*h)};
    h*=Math.max(1.05,Math.cbrt(countOf(dims)/limit));
  }
}

// Gather one bounded chunk of native indexed triangles at a time on the GPU.
// All three directional projections, signed voting, union and distance extension
// use the editor's existing Unite kernels. No imported normals are consumed.
export async function rasterize(gpu,band,capture){
  const {meshes,assertCurrent}=capture,{device}=gpu,n=countOf(band.dims),U=GPUBufferUsage;
  const packed=gpu.buffer('CFD native directional solid field',4*Math.ceil(n/2));
  if(!meshes.length)return packed; // A non-positive native sample is exterior.
  const source=document.getElementById('frame-unite-wgsl').textContent;
  const types=['read-only-storage','storage','storage','storage','storage','uniform','storage','storage'];
  const layout=device.createBindGroupLayout({entries:types.map((type,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}}))});
  const module=device.createShaderModule({label:'CFD native Unite volume',code:source}),pl=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const [small,large,scan,pack]=await Promise.all(['small','large','scan','pack'].map(entryPoint=>device.createComputePipelineAsync({layout:pl,compute:{module,entryPoint}})));
  const readers=new Map();
  for(const storage of new Set(meshes.map(m=>m.storage))){
    readers.set(storage,await gpu.kernel('CFD native triangle stream '+storage,meshReader(storage)+`
      struct Config{matrix:mat4x4f,first:u32,count:u32};@group(0) @binding(2) var<uniform> mesh:Config;
      @group(0) @binding(3) var<storage,read_write> triangles:array<f32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=3u*mesh.count){return;}let p=mesh.matrix*vec4f(sourcePoint(i+3u*mesh.first),1.);
        triangles[3u*i]=p.x;triangles[3u*i+1u]=p.y;triangles[3u*i+2u]=p.z;}`));
  }
  assertCurrent();
  const chunk=Math.min(32768,meshes.reduce((a,m)=>Math.max(a,m.triangleCount),1));
  const triangles=gpu.buffer('CFD bounded triangle stream',36*chunk),events=gpu.buffer('CFD directional crossings',12*n);
  const state=gpu.buffer('CFD native volume votes',4*n),tasks=gpu.buffer('CFD large projected faces',20+4*chunk,U.STORAGE|U.INDIRECT|U.COPY_DST);
  const header=gpu.buffer('CFD empty raster task header',new Uint32Array([0,1,1,0,0]),U.COPY_DST|U.COPY_SRC);
  const hermite=gpu.buffer('CFD unused reconstruction vertices',12),counter=gpu.buffer('CFD disabled reconstruction',8);
  const cfgUsage=U.UNIFORM|U.COPY_DST;
  for(const [m,mesh] of meshes.entries()){
    // Frame uses signed 32-bit edge products in its fixed-point rasterizer.
    const extent=Math.max(...mesh.bounds.max.map((v,k)=>(v-mesh.bounds.min[k])/band.h),...band.dims);
    const span=Math.max(extent,...mesh.bounds.min.map((v,k)=>Math.abs(v-band.origin[k])/band.h),...mesh.bounds.max.map((v,k)=>Math.abs(v-band.origin[k])/band.h));
    const scale=2**Math.min(8,Math.floor(Math.log2(16383/Math.max(1,span))));
    if(scale<1)throw Error('Native directional raster exceeds its integer coordinate range');
    const gather=readers.get(mesh.storage),chunks=[];
    for(let first=0;first<mesh.triangleCount;first+=chunk){
      const count=Math.min(chunk,mesh.triangleCount-first),data=new ArrayBuffer(80);
      new Float32Array(data,0,16).set(mesh.matrix);new Uint32Array(data,64,2).set([first,count]);
      const uniform=gpu.buffer('CFD triangle stream transform',new Uint8Array(data),cfgUsage);
      const resources=[...meshResources(mesh),{buffer:uniform},{buffer:triangles}];
      chunks.push({count,binding:device.createBindGroup({layout:gather.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))})});
    }
    const e=device.createCommandEncoder();e.clearBuffer(state);
    for(let axis=0;axis<3;axis++){
      e.clearBuffer(events);let group;
      for(const c of chunks){
        gpu.dispatch(e,gather,c.binding,workgroups(3*c.count));
        const settings=new ArrayBuffer(48);new Uint32Array(settings).set([...band.dims,c.count]);
        new Float32Array(settings,16,4).set([...band.origin,1/band.h]);new Uint32Array(settings,32,4).set([axis,scale,6,m===0?0:2]);
        const uniform=gpu.buffer('CFD native directional settings',new Uint8Array(settings),cfgUsage);
        group=device.createBindGroup({layout,entries:[triangles,events,state,tasks,packed,uniform,hermite,counter].map((buffer,binding)=>({binding,resource:{buffer}}))});
        e.copyBufferToBuffer(header,0,tasks,0,20);gpu.dispatch(e,small,group,workgroups(c.count));
        const pass=e.beginComputePass();pass.setPipeline(large);pass.setBindGroup(0,group);
        // The task queue is writable in this pass. Dispatching directly avoids
        // binding the same buffer simultaneously as writable storage and indirect.
        pass.dispatchWorkgroups(Math.min(256,Math.ceil(c.count/64)));pass.end();
      }
      gpu.dispatch(e,scan,group,workgroups(band.dims[(axis+1)%3]*band.dims[(axis+2)%3]));
      if(axis===2)gpu.dispatch(e,pack,group,workgroups(Math.ceil(n/2)));
    }
    assertCurrent();device.queue.submit([e.finish()]);
    await device.queue.onSubmittedWorkDone();assertCurrent();
  }
  return packed;
}

export async function nativeFlowGeometry(gpu,f,capture,dt){
  const scratch=gpuScope(gpu.device),start=performance.now(),limit=Math.min(8000000,Math.floor(gpu.device.limits.maxStorageBufferBindingSize/12));
  const band=distanceBand(f,capture.meshes,limit),n=countOf(f.dims);
  try{
    const packed=await rasterize(scratch,band,capture),distance=await extendNativeMetric(scratch,band.dims,packed,12);
    const phase=scratch.buffer('CFD stationary surface frame',new Float32Array([1,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const rep=f.cutCells&&f.sheetLinks?scratch.buffer('CFD native fluid representatives',16*n):null;
    const crossed=await meshPressureBarriers(scratch,f,capture.meshes,phase,capture.assertCurrent,rep);
    const wall=gpu.buffer('CFD evaluated wall distance and motion',16*n),response=gpu.buffer('CFD evaluated pressure mobility',16*n);
    const raw=f.cutCells?scratch.buffer('CFD native cut-cell metrics',16*n):null;
    const centers=raw?gpu.buffer('CFD native open face centroids',24*n):null;
    const pipe=await scratch.kernel('CFD native distance and sealed face response',gridWGSL(f)+metricWGSL(f)+immersedMobilityWGSL+`
      @group(0) @binding(0) var<storage,read> metric:array<f32>;@group(0) @binding(1) var<storage,read> crossed:array<u32>;
      @group(0) @binding(2) var<storage,read_write> wall:array<vec4f>;@group(0) @binding(3) var<storage,read_write> response:array<vec4f>;
      const BAND=vec3i(${band.dims});
      fn sample(p:vec3f)->f32{
        if(any(p<vec3f(0))||any(p>vec3f(BAND-1))){return ${12*band.h/f.h};}let q=vec3i(floor(p));let t=fract(p);var d=0.;
        for(var i=0;i<8;i++){let off=vec3i(i&1,(i>>1)&1,i>>2);let b=min(BAND-1,q+off);let w=select(1.-t,t,off==vec3i(1));
          d+=w.x*w.y*w.z*metric[u32(b.x+BAND.x*(b.y+BAND.y*b.z))];}return -${band.h/f.h}*d;}
      fn samplePoint(p:vec3i)->vec3f{return cellCenters(p)*${f.h/band.h}+vec3f(${f.origin.map((x,k)=>((x-band.origin[k])/band.h).toFixed(8)).join(',')});}
      ${f.cutCells?cutMetricWGSL+`@group(0) @binding(4) var<storage,read_write> faceCenters:array<FaceCenters>;
        ${rep?'@group(0) @binding(5) var<storage,read_write> rep:array<vec4f>;':''}
        fn surfaceDistance(v:vec3f)->f32{return sample(v*${f.h/band.h}+vec3f(${f.origin.map((x,k)=>((x-band.origin[k])/band.h).toFixed(8)).join(',')}));}`+cutGridWGSL+(f.subcellSurface?subcellMetricWGSL:''):''}
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=CELLS){return;}
        let cell=point(i);let p=samplePoint(cell);let d=sample(p);
        ${f.rotatingFrame?`let physical=vec3f(${f.origin.join(',')})+cellCenters(cell)*${f.h};
        wall[i]=vec4f(d,vec2f(-physical.z,physical.y)*${f.omega*dt/f.h},1.-smoothstep(-.7,.7,d));`:
          'wall[i]=vec4f(d,0.,0.,1.-smoothstep(-.7,.7,d));'}
        ${f.subcellSurface?`let halfWidth=.5*cellWidths(cell)*${f.h/band.h};
          if(any(p+halfWidth<vec3f(0))||any(p-halfWidth>vec3f(BAND-1))){
            response[i]=vec4f(1);${rep?'rep[i]=vec4f(cellCenters(cell),1.);':''}
          }else{let cut=subcellCut(cell);response[i]=cut.metric;faceCenters[i]=cut.centers;${rep?'rep[i]=cut.representative;':''}}`:
          f.cutCells?`let q=cellSamples(cell);let m=cutMetric(q);response[i]=m;faceCenters[i]=cutFaceCenters(q,m);
          ${rep?'rep[i]=fluidRepresentative(cell,q,m.w);':''}`:`let w=cellWidths(cell)*${.5*f.h/band.h};var m=vec3f(0);
        if(d>0.){for(var a=0u;a<3u;a++){
          var next=cell;next[a]=min(cell[a]+1,DIMS[a]-1);var face=p;face[a]+=w[a];
          if(sample(samplePoint(next))>0.){m[a]=${f.wallModeled?'1.':'fluidMobility(sample(face))'};}
        }}
        let mask=vec3u(crossed[i])&vec3u(1u,2u,4u);
        response[i]=vec4f(select(m,vec3f(0),mask!=vec3u(0)),select(0.,${f.wallModeled?'1.':'fluidMobility(d)'},d>0.));`}}`);
    const seal=raw?await cutFaceSeal(scratch,f,gridWGSL(f),raw,response,crossed.mask):null;
    const e=gpu.device.createCommandEncoder();if(!rep)crossed.encode(e);
    const entries=[{binding:0,resource:{buffer:distance}},{binding:2,resource:{buffer:wall}},{binding:3,resource:{buffer:raw??response}}];
    if(!raw)entries.push({binding:1,resource:{buffer:crossed.mask}});
    if(centers)entries.push({binding:4,resource:{buffer:centers}});
    if(rep)entries.push({binding:5,resource:{buffer:rep}});
    const axes=metricBuffer(scratch,f);if(axes)entries.push({binding:12,resource:{buffer:axes}});
    scratch.dispatch(e,pipe,gpu.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries}),[Math.ceil(n/128)]);
    if(rep)crossed.encode(e);seal?.(e);
    gpu.device.queue.submit([e.finish()]);await gpu.device.queue.onSubmittedWorkDone();capture.assertCurrent();
    const shape=f.immersedShape?await nativeImmersedShape(gpu,f,capture,wall,response):null;
    const wallDistance=f.wakeDistance&&capture.meshes.length?await extendWallDistance(scratch,f,wall,12*band.h/f.h):null;
    const skin=f.surfacePressure?await surfacePressure(gpu,f,capture,band,distance,response):null;
    capture.assertCurrent();
    return {wall,response,centers,skin,shape,update:capture.assertCurrent,assertCurrent:capture.assertCurrent,stats:{source:'Frame evaluated surfaces / Unite directional volume and metric',
      occurrences:capture.meshes.length,triangles:capture.meshes.reduce((s,m)=>s+m.triangleCount,0),bandDims:band.dims,bandPitchM:band.h,subdivisionsPerAxis:f.subcellSurface?4:1,wallDistance,scratchBytes:scratch.allocatedBytes,geometryMs:performance.now()-start}};
  }finally{scratch.close();}
}

// Each calculation owns these allocations on the renderer's device.
export function gpuScope(device) {
  const owned = [];
  let allocatedBytes=0;
  function buffer(label, dataOrBytes, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) {
    const bytes = typeof dataOrBytes === 'number' ? dataOrBytes : dataOrBytes.byteLength;
    const b = device.createBuffer({label, size: bytes, usage});
    owned.push(b);
    allocatedBytes+=b.size;
    if (typeof dataOrBytes !== 'number') device.queue.writeBuffer(b, 0, dataOrBytes);
    return b;
  }
  async function kernel(label, code, entryPoint = 'main') {
    const module = device.createShaderModule({label, code});
    try{return await device.createComputePipelineAsync({label, layout:'auto',compute:{module,entryPoint}});}
    catch(error){const diagnostics=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
      if(diagnostics.length)throw Error(label+'\n'+diagnostics.map(m=>m.lineNum+':'+m.linePos+' '+m.message).join('\n'));
      throw error;}
  }
  function bind(pipeline, buffers, gridMetrics) {
    const entries=buffers.map((buffer,binding)=>({binding,resource:{buffer}}));
    if(gridMetrics)entries.push({binding:12,resource:{buffer:gridMetrics}});
    return device.createBindGroup({layout: pipeline.getBindGroupLayout(0),
      entries});
  }
  function dispatch(encoder, pipeline, group, grid) {
    if(encoder.compute){encoder.compute(pipeline,group,grid);return;}
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(...grid);
    pass.end();
  }
  function run(pipeline, buffers, grid, gridMetrics) {
    const encoder = device.createCommandEncoder();
    dispatch(encoder, pipeline, bind(pipeline, buffers,gridMetrics), grid);
    device.queue.submit([encoder.finish()]);
  }
  async function read(source, staging, length) {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, length * 4);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ, 0, length * 4);
    try { return new Float32Array(staging.getMappedRange(0, length * 4)).slice(); }
    finally { staging.unmap(); }
  }
  return {device, buffer, kernel, bind, dispatch, run, read,get allocatedBytes(){return allocatedBytes;},
    staging: (label, bytes) => buffer(label, bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ),
    close() { for (const b of owned.splice(0)) b.destroy(); }};
}

// Matrices map source positions to metres in the physical solver frame. Native
// mesh resources are borrowed. Only fixture geometry uses the upload above.
export function meshReader(storage){
    const access=storage==='texture'?`
      @group(0) @binding(0) var vertices:texture_2d_array<u32>;
      @group(0) @binding(1) var indices:texture_2d_array<u32>;
      fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);
        return textureLoad(t,vec2i(vec2u(i%d.x,i/d.x%d.y)),i32(i/(d.x*d.y)),0).x;}
      fn coord(i:u32)->f32{return bitcast<f32>(scalar(vertices,i));}fn vertex(i:u32)->u32{return scalar(indices,i);}`:`
      @group(0) @binding(0) var<storage,read> vertices:array<f32>;
      @group(0) @binding(1) var<storage,read> indices:array<u32>;
      fn coord(i:u32)->f32{return vertices[i];}fn vertex(i:u32)->u32{return indices[i];}`;
    return access+`fn sourcePoint(i:u32)->vec3f{let k=3u*vertex(i);return vec3f(coord(k),coord(k+1u),coord(k+2u));}`;
}

export function meshResources(mesh){return mesh.storage==='texture'?[mesh.positions.view,mesh.indices.view]:[{buffer:mesh.positions},{buffer:mesh.indices}];}

export const triangleQueryWGSL=`
  fn edgeWeights(p:vec3f,a:vec3f,b:vec3f,ai:vec3f,bi:vec3f)->vec3f{
    let d=b-a;return mix(ai,bi,clamp(dot(p-a,d)/max(dot(d,d),1e-30),0.,1.));}
  fn closestWeights(p:vec3f,a:vec3f,b:vec3f,c:vec3f,n:vec3f,nn:f32)->vec3f{
    let e0=vec3f(1,0,0);let e1=vec3f(0,1,0);let e2=vec3f(0,0,1);
    let v=dot(cross(p-a,c-a),n)/nn;let w=dot(cross(b-a,p-a),n)/nn;
    if(v>=0.&&w>=0.&&v+w<=1.){return vec3f(1.-v-w,v,w);}
    let m=mat3x3f(a,b,c);var g=edgeWeights(p,a,b,e0,e1);let k=edgeWeights(p,b,c,e1,e2);
    if(dot(m*k-p,m*k-p)<dot(m*g-p,m*g-p)){g=k;}let l=edgeWeights(p,c,a,e2,e0);
    return select(g,l,dot(m*l-p,m*l-p)<dot(m*g-p,m*g-p));
  }
  fn wedge(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
  fn topLeft(d:vec2f)->bool{return d.y>0.||(d.y==0.&&d.x<0.);}
  // Half-open ownership on a shared projected edge. Reversing a triangle
  // first restores the same counter-clockwise edge convention.
  fn rayCrosses(p:vec3f,a:vec3f,b:vec3f,c:vec3f)->bool{
    var b0=b;var c0=c;let orient=wedge(b.yz-a.yz,c.yz-a.yz);if(orient==0.){return false;}
    if(orient<0.){b0=c;c0=b;}
    let e0=b0.yz-a.yz;let e1=c0.yz-b0.yz;let e2=a.yz-c0.yz;
    let u=wedge(e1,p.yz-b0.yz);let v=wedge(e2,p.yz-c0.yz);let w=wedge(e0,p.yz-a.yz);
    if(u<0.||v<0.||w<0.||(u==0.&&!topLeft(e1))||(v==0.&&!topLeft(e2))||(w==0.&&!topLeft(e0))){return false;}
    return u*(a.x-p.x)+v*(b0.x-p.x)+w*(c0.x-p.x)>0.;
  }`;


// Group consecutive native triangles into bounded ranges, preserving their
// logical indices. Queries borrow the source buffers or paged textures.
const meshTreePrograms=new WeakMap();
export async function nativeTriangleBounds(gpu,mesh,base){
  const device=gpu.device,limit=Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize);
  const types='struct Bounds{lo:vec4f,hi:vec4f} struct Pose{m:mat4x4f,triangles:u32,base:u32,leaves:u32}';
  const storage=(i,id,t,w=false)=>`@group(0) @binding(${i}) var<storage,${w?'read_write':'read'}> ${id}:array<${t}>;`;
  const leaves=2**Math.ceil(Math.log2(Math.ceil(mesh.triangleCount/8)));
  if(64*leaves>limit||Math.ceil(leaves/64)>device.limits.maxComputeWorkgroupsPerDimension)
    throw Error('Native shape search bounds exceed the device limit');
  const boxes=gpu.buffer('CFD native shape search bounds',64*leaves);
  const uniform=new ArrayBuffer(80);new Float32Array(uniform,0,16).set(mesh.matrix);
  new Uint32Array(uniform,64,3).set([mesh.triangleCount,base,leaves]);
  const pose=gpu.buffer('CFD native shape pose',new Uint8Array(uniform),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);

  let programs=meshTreePrograms.get(gpu);
  if(!programs){programs=new Map();meshTreePrograms.set(gpu,programs);}
  if(!programs.has(mesh.storage)){
    const source=meshReader(mesh.storage)+types+'fn physical(m:mat4x4f,k:u32)->vec3f{return (m*vec4f(sourcePoint(k),1)).xyz;}';
    const bounds=await gpu.kernel('CFD bound native triangles for shape derivatives',source+
      storage(2,'box','Bounds',true)+'@group(0) @binding(3) var<uniform> pose:Pose;'+`
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
        if(id.x>=pose.leaves){return;}var lo=vec3f(3.4e38);var hi=-lo;
        for(var k=8u*id.x;k<min(pose.triangles,8u*id.x+8u);k++){for(var j=0u;j<3u;j++){
          let v=physical(pose.m,3u*k+j);lo=min(lo,v);hi=max(hi,v);}}
        box[pose.leaves+id.x]=Bounds(vec4f(lo,0.),vec4f(hi,0.));
      }`);
    const join=await gpu.kernel('CFD join bounds of native triangle ranges',types+storage(0,'box','Bounds',true)+
      '@group(0) @binding(1) var<uniform> range:vec2u;'+`
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=range.y){return;}
        let i=range.x+id.x;let a=box[2u*i];let b=box[2u*i+1u];box[i]=Bounds(min(a.lo,b.lo),max(a.hi,b.hi));}`);

    programs.set(mesh.storage,{bounds,join});
  }
  const {bounds,join}=programs.get(mesh.storage),e=device.createCommandEncoder();
  const resources=[...meshResources(mesh),{buffer:boxes},{buffer:pose}];
  gpu.dispatch(e,bounds,device.createBindGroup({layout:bounds.getBindGroupLayout(0),
    entries:resources.map((resource,binding)=>({binding,resource}))}),[Math.ceil(leaves/64)]);
  const parameters=[];
  for(let width=leaves/2;width>=1;width/=2){const range=gpu.buffer('CFD native shape search level',new Uint32Array([width,width,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    parameters.push(range);gpu.dispatch(e,join,gpu.bind(join,[boxes,range]),[Math.ceil(width/64)]);}

  device.queue.submit([e.finish()]);
  return {boxes,pose,release(){for(const b of [boxes,pose,...parameters])b.destroy();}};
}

// Refine the smooth immersed fractions at exposed cell centres and faces
// using the closest point of a native triangle. The Frame SDF and geometric
// crossing certificate own the fluid side and sealed links. The same closest
// point and barycentric coordinates carry the reverse shape derivative.
export async function nativeImmersedShape(gpu,f,capture,wall,mobility){
  if(!capture.meshes.some(mesh=>mesh.triangleCount>0))return null;
  const {device}=gpu,n=countOf(f.dims),coords=metricBuffer(gpu,f),grid=[Math.ceil(n/128)];
  const storage=(b,id,type,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${id}:array<${type}>;`;
  const bounds=combinedBounds(capture.meshes.map(mesh=>mesh.bounds)),band=(x,k)=>(x-f.origin[k])/f.h;
  const lo=bounds.min.map((x,k)=>band(x,k)-.5001),hi=bounds.max.map((x,k)=>band(x,k)+.5001);
  const base=gridWGSL(f)+metricWGSL(f),criteria=base+storage(0,'wall','vec4f')+storage(1,'mu','vec4f')+
    '@group(0) @binding(2) var<storage,read_write> count:atomic<u32>;';
  const search=collect=>criteria+(collect?storage(3,'ids','u32',true):'')+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=point(i);let w=cellWidths(p);let m=mu[i];
      if(abs(wall[i].x)>1.5+max(w.x,max(w.y,w.z))&&all(m>=vec4f(1))){return;}
      let center=cellCenters(p);var mask=m>vec4f(0);
      for(var a=0u;a<4u;a++){var x=center;if(a<3u){x[a]+=.5*w[a];}
        let nearBounds=all(x>=vec3f(${lo.join(',')}))&&all(x<=vec3f(${hi.join(',')}));
        mask[a]=mask[a]&&(m[a]<1.||nearBounds);}
      let k=dot(vec4u(mask),vec4u(1));if(k==0u){return;}var next=atomicAdd(&count,k);
      ${collect?'for(var a=0u;a<4u;a++){if(mask[a]){ids[next]=4u*i+a;next++;}}':''}
    }`;
  const [countPipe,listPipe]=await Promise.all([gpu.kernel('CFD count differentiable wall samples',search(false)),
    gpu.kernel('CFD compact differentiable wall samples',search(true))]);
  const counter=gpu.buffer('CFD smooth wall sample count',4);
  gpu.run(countPipe,[wall,mobility,counter],grid,coords);
  const bits=await gpu.read(counter,gpu.staging('CFD compact wall sample count',4),1),samples=new Uint32Array(bits.buffer)[0];
  capture.assertCurrent();if(!samples)return null;
  const ids=gpu.buffer('CFD active immersed coordinates',4*samples),e=device.createCommandEncoder();
  e.clearBuffer(counter);gpu.dispatch(e,listPipe,gpu.bind(listPipe,[wall,mobility,counter,ids],coords),grid);device.queue.submit([e.finish()]);
  const types=`struct Bounds{lo:vec4f,hi:vec4f} struct Pose{m:mat4x4f,triangles:u32,base:u32,leaves:u32}
    struct Hit{bary:vec4f,vertices:vec4u} const NONE=0xffffffffu;`;
  const init=await gpu.kernel('CFD initialize native shape support',types+storage(0,'hit','Hit',true)+storage(1,'normal','vec4f',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x;if(i>=arrayLength(&hit)){return;}
      normal[i]=vec4f(0.,0.,0.,${.25*f.h**2});hit[i].vertices=vec4u(NONE);}`);
  const parts=[];const begin=device.createCommandEncoder();
  for(let first=0;first<samples;first+=262144){
    const count=Math.min(samples-first,262144),grid=[Math.ceil(count/128)];
    const hit=gpu.buffer('CFD closest logical wall vertices',32*count),normal=gpu.buffer('CFD native distance derivative',16*count);
    const offset=gpu.buffer('CFD compact shape range',new Uint32Array([first,count,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    gpu.dispatch(begin,init,gpu.bind(init,[hit,normal]),grid);parts.push({grid,hit,normal,offset});
  }
  device.queue.submit([begin.finish()]);const pipelines=new Map(),occurrences=[];let vertices=0;
  for(const mesh of capture.meshes){
    const first=vertices;vertices+=mesh.vertexCount;occurrences.push({mesh,first,vertices:mesh.vertexCount});
    if(!mesh.triangleCount)continue;
    if(!pipelines.has(mesh.storage))pipelines.set(mesh.storage,await gpu.kernel('CFD closest native wall in the immersed transition',
      meshReader(mesh.storage)+types+base+triangleQueryWGSL+storage(2,'box','Bounds')+storage(3,'ids','u32')+
      storage(4,'hit','Hit',true)+storage(5,'normal','vec4f',true)+`
      @group(0) @binding(6) var<uniform> pose:Pose;@group(0) @binding(7) var<uniform> span:vec4u;
      fn pos(k:u32)->vec3f{return (pose.m*vec4f(sourcePoint(k),1.)).xyz;}
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;if(i>=span.y){return;}let id=ids[span.x+i];let p=point(id/4u);let a=id%4u;
        var x=cellCenters(p);if(a<3u){x[a]+=.5*axisMetric(a,p[a]).y;}
        x=vec3f(${f.origin.join(',')})+x*${f.h};var best=normal[i].w;var node=1u;var triangle=NONE;
        var weight=vec3f(0);var separation=vec3f(0);
        loop{
          let bounds=box[node];let gap=max(max(bounds.lo.xyz-x,x-bounds.hi.xyz),vec3f(0));
          if(all(bounds.lo.xyz<=bounds.hi.xyz)&&dot(gap,gap)<=best){
            if(node<pose.leaves){node*=2u;continue;}
            let begin=8u*(node-pose.leaves);
            for(var t=begin;t<min(begin+8u,pose.triangles);t++){
              let a=pos(3u*t);let b=pos(3u*t+1u);let c=pos(3u*t+2u);
              let n=cross(b-a,c-a);let nn=dot(n,n);if(nn<=1e-36){continue;}
              let w=closestWeights(x,a,b,c,n,nn);let dx=(x-a)-w.y*(b-a)-w.z*(c-a);let d=dot(dx,dx);
              if(d<best){best=d;triangle=t;weight=w;separation=dx;}
            }
          }
          while((node&1u)!=0u){node>>=1u;}if(node==0u){break;}node++;
        }
        if(triangle!=NONE){
          let k=3u*triangle;hit[i]=Hit(vec4f(weight,0),vec4u(pose.base+vertex(k),pose.base+vertex(k+1u),pose.base+vertex(k+2u),triangle));
          normal[i]=vec4f(separation*inverseSqrt(max(1e-36,best)),best);
        }
      }`));
    const tree=await nativeTriangleBounds(gpu,mesh,first),pipe=pipelines.get(mesh.storage);
    try{
      for(const part of parts){
        capture.assertCurrent();const cmd=device.createCommandEncoder();
        const resources=[...meshResources(mesh),...[tree.boxes,ids,part.hit,part.normal,tree.pose,part.offset].map(buffer=>({buffer}))];
        const entries=resources.map((resource,binding)=>({binding,resource}));
        if(coords)entries.push({binding:12,resource:{buffer:coords}});
        gpu.dispatch(cmd,pipe,device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries}),part.grid);
        device.queue.submit([cmd.finish()]);await device.queue.onSubmittedWorkDone();
      }
    }finally{tree.release();}
  }
  capture.assertCurrent();const apply=await gpu.kernel('CFD matched primal and derivative of native wall fractions',
    immersedMobilityWGSL+storage(0,'ids','u32')+storage(1,'normal','vec4f',true)+storage(2,'mu','f32',true)+`
    @group(0) @binding(3) var<uniform> range:vec4u;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=range.y){return;}let id=ids[range.x+i];let old=normal[i];let side=select(-1.,1.,mu[id]>=.5);
      let d=side*sqrt(old.w)/${f.h};mu[id]=fluidMobility(d);
      let slope=select(0.,(1.+cos(6.283185307*d))/${f.h},abs(d)<.5&&mu[id]>0.);
      normal[i]=vec4f(-slope*side*old.xyz,d);
    }`);
  const updated=device.createCommandEncoder();for(const p of parts)gpu.dispatch(updated,apply,gpu.bind(apply,[ids,p.normal,mobility,p.offset]),p.grid);
  device.queue.submit([updated.finish()]);await device.queue.onSubmittedWorkDone();capture.assertCurrent();
  const scatter=await gpu.kernel('CFD backpropagate total force to logical native vertices',types+storage(0,'ids','u32')+
    storage(1,'hit','Hit')+storage(2,'normal','vec4f')+storage(3,'df','f32')+storage(4,'out','atomic<u32>',true)+`
    @group(0) @binding(5) var<uniform> range:vec4u;@group(0) @binding(6) var<uniform> vertices:vec4u;
    fn add(i:u32,v:f32){var b=atomicLoad(&out[i]);loop{let r=atomicCompareExchangeWeak(&out[i],b,bitcast<u32>(bitcast<f32>(b)+v));
      if(r.exchanged){break;}b=r.old_value;}}
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=range.y){return;}let h=hit[i];if(h.vertices.x==NONE){return;}
      let v=df[ids[range.x+i]]*normal[i].xyz;
      for(var k=0u;k<3u;k++){let id=h.vertices[k];if(id>=vertices.x&&id<vertices.x+vertices.y){
        let d=v*h.bary[k];for(var a=0u;a<3u;a++){if(d[a]!=0.){add(3u*(id-vertices.x)+a,d[a]);}}}}
    }`);
  return {samples,occurrences,vertices,
    scatter(e,gradient,out,range){
      e.clearBuffer(out);
      for(const p of parts)gpu.dispatch(e,scatter,gpu.bind(scatter,[ids,p.hit,p.normal,gradient,out,p.offset,range]),p.grid);
    }
  };
}

export async function meshPressureBarriers(gpu,f,meshes,phase,assertCurrent=()=>{},representatives=null){
  const mask=gpu.buffer('CFD crossed Cartesian face bits',4*f.dims.reduce((a,b)=>a*b));
  const pipelines=new Map();
  for(const storage of new Set(meshes.map(m=>m.storage))){
    const pipe=await gpu.kernel('CFD pressure crossings from '+storage,meshReader(storage)+metricWGSL(f)+`
    @group(0) @binding(2) var<storage,read_write> mask:array<atomic<u32>>;
    @group(0) @binding(3) var<uniform> phase:vec2f;
    struct Occurrence {matrix:mat4x4f,count:u32};
    @group(0) @binding(4) var<uniform> mesh:Occurrence;
    ${representatives?'@group(0) @binding(5) var<storage,read> rep:array<vec4f>;':''}
    const D=vec3i(${f.dims.join(',')});
    fn gridPoint(i:u32)->vec3f{
      let v=mesh.matrix*vec4f(sourcePoint(i),1.);
      let yz=vec2f(v.y*phase.x-v.z*phase.y,v.y*phase.y+v.z*phase.x);
      return (vec3f(v.x,yz)-vec3f(${f.origin.map(x=>x.toFixed(9)).join(',')}))/${f.h};
    }
    fn lower(a:u32,x:f32)->i32{${f.axes?`var lo=0;var hi=D[a];while(lo<hi){let mid=(lo+hi)/2;
      if(axisMetric(a,mid).x<x){lo=mid+1;}else{hi=mid;}}return lo;`:'return i32(ceil(x-.5));'}}
    fn cross2(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
    fn mark(p:vec3i,axis:u32){
      if(all(p>=vec3i(0))&&all(p<D)&&p[axis]+1<D[axis]){
        atomicOr(&mask[u32(p.x+D.x*(p.y+D.y*p.z))],1u<<axis);}
    }
    ${representatives?`
    fn address(p:vec3i)->u32{return u32(p.x+D.x*(p.y+D.y*p.z));}
    fn intersect(l:vec3f,r:vec3f,a:vec3f,ab:vec3f,ac:vec3f)->bool{
      let segment=r-l;let n=cross(ab,ac);let det=dot(n,segment);
      if(abs(det)<=1e-8*length(n)*length(segment)){return false;}
      let t=dot(n,a-l)/det;if(t<-.000002||t>1.000002){return false;}
      let v=l+t*segment-a;let norm2=dot(n,n);
      let s=dot(n,cross(v,ac))/norm2;let u=dot(n,cross(ab,v))/norm2;
      return s>=-.000002&&u>=-.000002&&s+u<=1.000002;
    }
    fn sealRepresentativeLinks(a:vec3f,ab:vec3f,ac:vec3f){
      let normal=cross(ab,ac);if(dot(normal,normal)<=1e-22){return;}
      var ax=0u;if(abs(normal.y)>abs(normal[ax])){ax=1u;}if(abs(normal.z)>abs(normal[ax])){ax=2u;}
      let u=(ax+1u)%3u;let v=(ax+2u)%3u;let b=a+ab;let c=a+ac;
      let mn=min(a,min(b,c));let mx=max(a,max(b,c));
      let lo=max(vec2i(0),vec2i(lower(u,mn[u]),lower(v,mn[v]))-2);
      let hi=min(vec2i(D[u]-1,D[v]-1),vec2i(lower(u,mx[u]),lower(v,mx[v]))+1);
      let slope=-vec2f(normal[u],normal[v])/normal[ax];
      for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
        let lm=axisMetric(u,x);let um=axisMetric(u,min(D[u]-1,x+1));
        let bm=axisMetric(v,y);let tm=axisMetric(v,min(D[v]-1,y+1));
        let start=vec2f(lm.x-.5*lm.y,bm.x-.5*bm.y);let end=vec2f(um.x+.5*um.y,tm.x+.5*tm.y);
        let mid=a[ax]+dot(slope,.5*(start+end)-vec2f(a[u],a[v]));let halfSpan=.5*dot(abs(slope),end-start);
        let first=max(0,lower(ax,mid-halfSpan)-2);let last=min(D[ax]-1,lower(ax,mid+halfSpan)+1);
        for(var z=first;z<=last;z++){var p=vec3i(0);p[u]=x;p[v]=y;p[ax]=z;
          let l=rep[address(p)];if(l.w==0.){continue;}
          for(var k=0u;k<3u;k++){var q=p;q[k]++;if(q[k]>=D[k]){continue;}let r=rep[address(q)];
            if(r.w>0.&&intersect(l.xyz,r.xyz,a,ab,ac)){mark(p,k);}}
        }
      }}
    }`:''}
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(num_workgroups) groups:vec3u){
      let t=g.x+g.y*groups.x*64u;if(t>=mesh.count){return;}let i=3u*t;
      let a=gridPoint(i);let ab=gridPoint(i+1u)-a;let ac=gridPoint(i+2u)-a;
      ${representatives?'sealRepresentativeLinks(a,ab,ac);':`for(var ax=0u;ax<3u;ax++){
        let u=(ax+1u)%3u;let v=(ax+2u)%3u;
        let e1=vec2f(ab[u],ab[v]);let e2=vec2f(ac[u],ac[v]);let det=cross2(e1,e2);
        if(abs(det)<1e-10){continue;}
        let origin=vec2f(a[u],a[v]);let dim=vec2i(D[u],D[v]);
        let bmin=origin+min(vec2f(0),min(e1,e2))-.00001;let bmax=origin+max(vec2f(0),max(e1,e2))+.00001;
        let low=max(vec2i(0),vec2i(lower(u,bmin.x),lower(v,bmin.y)));
        let high=min(dim-1,vec2i(lower(u,bmax.x),lower(v,bmax.y))-1);
        for(var y=low.y;y<=high.y;y++){for(var x=low.x;x<=high.x;x++){
          let diff=vec2f(axisMetric(u,x).x,axisMetric(v,y).x)-origin;let s=cross2(diff,e2)/det;let t=cross2(e1,diff)/det;
          if(s<-.00001||t<-.00001||s+t>1.00001){continue;}
          let h=a[ax]+s*ab[ax]+t*ac[ax];var p=vec3i(0);p[u]=x;p[v]=y;p[ax]=lower(ax,h-.00001)-1;
          mark(p,ax);let right=lower(ax,h+.00001)-1;if(p[ax]!=right){p[ax]=right;mark(p,ax);}
        }}
      }`}
    }`);
    pipelines.set(storage,pipe);
  }
  assertCurrent();
  const stride=Math.ceil(80/gpu.device.limits.minUniformBufferOffsetAlignment)*gpu.device.limits.minUniformBufferOffsetAlignment;
  const data=new ArrayBuffer(Math.max(1,meshes.length)*stride);
  meshes.forEach((mesh,i)=>{new Float32Array(data,i*stride,16).set(mesh.matrix);new Uint32Array(data,i*stride+64,1)[0]=mesh.triangleCount;});
  const settings=gpu.buffer('CFD captured surface transforms',new Uint8Array(data),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const draws=meshes.map((mesh,i)=>{
    const pipe=pipelines.get(mesh.storage);
    const resources=[...meshResources(mesh),{buffer:mask},{buffer:phase},{buffer:settings,offset:i*stride,size:80}];
    if(representatives)resources.push({buffer:representatives});
    const entries=resources.map((resource,binding)=>({binding,resource}));
    if(f.axes)entries.push({binding:12,resource:{buffer:metricBuffer(gpu,f)}});
    const group=gpu.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries});
    const count=Math.ceil(mesh.triangleCount/64),width=Math.min(count,gpu.device.limits.maxComputeWorkgroupsPerDimension);
    return {pipe,group,grid:[width,Math.ceil(count/width)]};
  });
  return {mask,assertCurrent,encode(e){assertCurrent();e.clearBuffer(mask);for(const d of draws)gpu.dispatch(e,d.pipe,d.group,d.grid);}};
}

// Frame's directional solid field is positive inside. It seeds the native
// distance extension in grid cells. Consumers choose their own sign and units.
export async function extendNativeMetric(gpu,dims,packed,bandCells){
  const n=dims.reduce((a,b)=>a*b),device=gpu.device;
  const source=document.getElementById('frame-unite-filter').textContent;
  const [seed,extend]=await Promise.all(['seed','extend'].map(entry=>gpu.kernel('CFD native Unite '+entry,source,entry)));
  const settings=new ArrayBuffer(128);new Uint32Array(settings).set([...dims,n]);
  new Float32Array(settings).set([0,bandCells,2,0],28);
  const u=gpu.buffer('CFD native band configuration',new Uint8Array(settings),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const a=gpu.buffer('CFD native distance A',n*4),b=gpu.buffer('CFD native distance B',n*4);
  const bind=(pipe,entries)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  const groups=Math.ceil(n/64),grid=[Math.min(65535,groups),Math.ceil(groups/65535)];
  const e=device.createCommandEncoder();gpu.dispatch(e,seed,bind(seed,[[0,packed],[1,a],[5,u]]),grid);
  const ping=bind(extend,[[1,a],[2,b],[5,u]]),pong=bind(extend,[[1,b],[2,a],[5,u]]);
  for(let i=0;i<bandCells;i++)gpu.dispatch(e,extend,i%2?pong:ping,grid);
  device.queue.submit([e.finish()]);return bandCells%2?b:a;
}

// Fluid is on the positive side of the metric. A common diagonal splits
// every Cartesian face. Six tetrahedra share the body diagonal, so adjacent
// cells integrate exactly the same open area on their common face.
export const cutMetricWGSL=`
  fn edgeFraction(pos:f32,neg:f32)->f32{return pos/(pos-neg);}
  fn triangleFluid(q:vec3f)->f32{
    var mask=0u;for(var i=0u;i<3u;i++){if(q[i]>0.){mask|=1u<<i;}}
    let count=countOneBits(mask);if(count==0u){return 0.;}if(count==3u){return 1.;}
    let one=select(7u^mask,mask,count==1u);let i=firstTrailingBit(one);
    let a=q[i];let fraction=edgeFraction(a,q[(i+1u)%3u])*edgeFraction(a,q[(i+2u)%3u]);
    return select(1.-fraction,fraction,count==1u);
  }
  fn tetraFluid(q:vec4f)->f32{
    var mask=0u;for(var i=0u;i<4u;i++){if(q[i]>0.){mask|=1u<<i;}}
    let count=countOneBits(mask);if(count==0u){return 0.;}if(count==4u){return 1.;}
    if(count!=2u){let one=select(15u^mask,mask,count==1u);let i=firstTrailingBit(one);let a=q[i];
      let v=edgeFraction(a,q[(i+1u)%4u])*edgeFraction(a,q[(i+2u)%4u])*edgeFraction(a,q[(i+3u)%4u]);
      return select(1.-v,v,count==1u);}
    let other=15u^mask;let a=q[firstTrailingBit(mask)];let b=q[firstLeadingBit(mask)];
    let c=q[firstTrailingBit(other)];let d=q[firstLeadingBit(other)];
    let ac=edgeFraction(a,c);let ad=edgeFraction(a,d);let bc=edgeFraction(b,c);let bd=edgeFraction(b,d);
    return ac*ad+(1.-ac)*ad*bc+(1.-ad)*bc*bd;
  }
  fn squareFluid(a:f32,b:f32,c:f32,d:f32)->f32{
    return .5*(triangleFluid(vec3f(a,b,d))+triangleFluid(vec3f(a,c,d)));
  }
  fn cutMetric(q:array<f32,8>)->vec4f{
    var positive=0u;for(var i=0u;i<8u;i++){positive+=u32(q[i]>0.);}
    if(positive==0u){return vec4f(0);}if(positive==8u){return vec4f(1);}
    let faces=vec3f(squareFluid(q[1],q[3],q[5],q[7]),squareFluid(q[2],q[3],q[6],q[7]),squareFluid(q[4],q[5],q[6],q[7]));
    var volume=0.;for(var a=0u;a<3u;a++){for(var b=0u;b<3u;b++){if(a!=b){
      volume+=tetraFluid(vec4f(q[0],q[1u<<a],q[(1u<<a)|(1u<<b)],q[7]));}}}
    return clamp(vec4f(faces,volume/6.),vec4f(0),vec4f(1));
  }
  struct FaceCenters{t:array<vec2f,3>};
  fn triangleMoment(q:vec3f,v:array<vec2f,3>)->vec3f{
    var mask=0u;for(var i=0u;i<3u;i++){if(q[i]>0.){mask|=1u<<i;}}
    let count=countOneBits(mask);let whole=.5*vec3f((v[0]+v[1]+v[2])/3.,1.);
    if(count==0u){return vec3f(0);}if(count==3u){return whole;}
    let i=firstTrailingBit(select(7u^mask,mask,count==1u));let j=(i+1u)%3u;let k=(i+2u)%3u;
    let a=edgeFraction(q[i],q[j]);let b=edgeFraction(q[i],q[k]);
    let part=.5*a*b*vec3f((v[i]+mix(v[i],v[j],a)+mix(v[i],v[k],b))/3.,1.);
    return select(whole-part,part,count==1u);
  }
  fn cutFaceCenters(q:array<f32,8>,m:vec4f)->FaceCenters{
    var out:FaceCenters;let a=vec2f(-.5);let b=vec2f(.5,-.5);let c=-b;let d=-a;
    for(var k=0u;k<3u;k++){if(m[k]>0.&&m[k]<1.){
      let i=1u<<k;let j=i|(1u<<((k+1u)%3u));let l=i|(1u<<((k+2u)%3u));
      let moment=triangleMoment(vec3f(q[i],q[j],q[7]),array<vec2f,3>(a,b,d))+
        triangleMoment(vec3f(q[i],q[l],q[7]),array<vec2f,3>(a,c,d));
      if(moment.z>0.){out.t[k]=clamp(moment.xy/moment.z,vec2f(-.5),vec2f(.5));}
    }}return out;
  }`;

// Both owners fetch a Cartesian vertex through the same integer address.
// Reconstructing it by offsetting each owner's centre would disagree by an
// ulp precisely where a plane touches a grid point.
export const cutGridWGSL=`
  fn vertexAxis(axis:u32,j:i32)->f32{
    if(j==DIMS[axis]){let m=axisMetric(axis,j-1);return m.x+.5*m.y;}
    let m=axisMetric(axis,j);return m.x-.5*m.y;
  }
  fn cutVertex(p:vec3i,i:u32)->vec3f{
    let v=p+vec3i(vec3u(i&1u,(i>>1u)&1u,i>>2u));
    return vec3f(vertexAxis(0u,v.x),vertexAxis(1u,v.y),vertexAxis(2u,v.z));
  }
  fn cellSamples(p:vec3i)->array<f32,8>{
    var q:array<f32,8>;for(var i=0u;i<8u;i++){
      q[i]=surfaceDistance(cutVertex(p,i));
    }
    return q;
  }
  fn fluidRepresentative(p:vec3i,q:array<f32,8>,fraction:f32)->vec4f{
    let center=cellCenters(p);if(fraction<=0.){return vec4f(center,0);}
    if(surfaceDistance(center)>0.){return vec4f(center,1);}
    var best=0u;for(var i=1u;i<8u;i++){if(q[i]>q[best]){best=i;}}
    var lo=center;let corner=cutVertex(p,best);var hi=corner;
    for(var j=0;j<7;j++){let mid=.5*(lo+hi);if(surfaceDistance(mid)>0.){hi=mid;}else{lo=mid;}}
    let insideFluid=.5*(hi+corner);
    return vec4f(select(corner,insideFluid,surfaceDistance(insideFluid)>0.),1.);
  }`;

export async function cutFaceSeal(gpu,f,head,raw,response,flags){
  const kernel=await gpu.kernel('CFD sealed shared cut-cell faces',head+`
    @group(0) @binding(0) var<storage,read> raw:array<vec4f>;
    @group(0) @binding(1) var<storage,read_write> sealed:array<vec4f>;
    ${flags?'@group(0) @binding(2) var<storage,read> crosses:array<u32>;':''}
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let p=point(i);let cell=raw[i];var open=cell.xyz;
      for(var a=0u;a<3u;a++){
        var j=p;j[a]++;if(!inside(j)){continue;}let other=raw[index(j)].w;
        if(min(cell.w,other)<=0.){open[a]=0.;}
        ${flags?`if(${f.sheetLinks?'true':'min(cell.w,other)==1.'}&&(crosses[i]&(1u<<a))!=0u){open[a]=0.;}`:''}
      }
      sealed[i]=vec4f(open,cell.w);
    }`);
  const group=gpu.bind(kernel,[raw,response,...flags?[flags]:[]]);
  return e=>gpu.dispatch(e,kernel,group,[Math.ceil(f.dims.reduce((a,b)=>a*b)/128)]);
}

// Integrate the existing tetrahedral cut and aperture moments on 4^3
// subcells. The pressure and velocity unknowns stay on the coarse grid.
// Integrals preserve faces that contain both sides of a thin solid.
export const subcellMetricWGSL=`
  struct IntegratedCut{metric:vec4f,centers:FaceCenters,representative:vec4f}
  fn subcellCut(p:vec3i)->IntegratedCut{
    var result:IntegratedCut;let base=cutVertex(p,0u);let w=cellWidths(p);
    var samples:array<f32,125>;var best=-3e38;var far=base;
    for(var z=0u;z<=4u;z++){for(var y=0u;y<=4u;y++){for(var x=0u;x<=4u;x++){
      let v=base+.25*w*vec3f(f32(x),f32(y),f32(z));let s=surfaceDistance(v);
      samples[x+5u*(y+5u*z)]=s;if(s>best){best=s;far=v;}
    }}}
    for(var z=0u;z<4u;z++){for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){
      let low=vec3u(x,y,z);var q:array<f32,8>;
      for(var k=0u;k<8u;k++){let j=low+vec3u(k&1u,(k>>1u)&1u,k>>2u);q[k]=samples[j.x+5u*(j.y+5u*j.z)];}
      let m=cutMetric(q);result.metric.w+=m.w/64.;
      if(any(low==vec3u(3))){let center=cutFaceCenters(q,m);
        for(var a=0u;a<3u;a++){if(low[a]!=3u){continue;}let b=(a+1u)%3u;let c=(a+2u)%3u;
          let area=m[a]/16.;let t=.25*(vec2f(f32(low[b]),f32(low[c]))+.5+center.t[a])-.5;
          result.metric[a]+=area;result.centers.t[a]+=area*t;
        }
      }
    }}}
    for(var a=0u;a<3u;a++){let area=result.metric[a];
      if(area>0.){result.centers.t[a]/=area;}
    }
    let mid=cellCenters(p);result.representative=vec4f(mid,select(0.,1.,best>0.));
    if(surfaceDistance(mid)<=0.&&best>0.){
      var lo=mid;var hi=far;
      for(var j=0u;j<8u;j++){let v=.5*(lo+hi);if(surfaceDistance(v)>0.){hi=v;}else{lo=v;}}
      let interior=.5*(hi+far);result.representative=vec4f(select(far,interior,surfaceDistance(interior)>0.),1.);
    }
    return result;
  }`;

// Unite's signed metric is accurate in its finite reconstruction band.
// Turbulence also needs a wall distance throughout the wake. Propagate
// physical surface points over the graded grid and retain the native near field.
export async function extendWallDistance(gpu,f,wall,bandWidth){
  const n=f.dims.reduce((a,b)=>a*b),grid=[Math.ceil(n/128)],metric=metricBuffer(gpu,f);
  const points=[0,1].map(i=>gpu.buffer('CFD physical nearest-wall points '+i,n*16));
  const base=gridWGSL(f)+metricWGSL(f);
  const stations=(b,name,write=false)=>`@group(0) @binding(${b}) var<storage,${write?'read_write':'read'}> ${name}:array<vec4f>;`;
  const main=s=>`@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
    let i=g.x;if(i>=CELLS){return;}let p=point(i);let x=cellCenters(p);${s}}`;
  const pin=.65*bandWidth;
  const seed=await gpu.kernel('CFD surface foot in the native distance band',base+stations(0,'wall')+stations(1,'near',true)+main(`
    let d=wall[i].x;var value=vec4f(0);
    if(abs(d)<${pin}){
      var grad=vec3f(0);
      for(var a=0u;a<3u;a++){var q=p;var r=p;q[a]=max(p[a]-1,0);r[a]=min(p[a]+1,DIMS[a]-1);
        let dx=axisMetric(a,r[a]).x-axisMetric(a,q[a]).x;
        grad[a]=(wall[index(r)].x-wall[index(q)].x)/max(dx,1e-20);}
      if(dot(grad,grad)>.04){value=vec4f(x-d*normalize(grad),1.);}
    }near[i]=value;`));
  const jump=await gpu.kernel('CFD propagate nearest surface coordinates',base+stations(0,'src')+stations(1,'dst',true)+
    '@group(0) @binding(2) var<uniform> stride:vec4i;'+main(`
    var best=src[i];var d=select(3e38,dot(best.xyz-x,best.xyz-x),best.w>0.);
    for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var a=-1;a<=1;a++){
      let q=p+stride.x*vec3i(a,y,z);if(!inside(q)){continue;}
      let s=src[index(q)];let a2=dot(x-s.xyz,x-s.xyz);
      if(s.w>0.&&a2<d){d=a2;best=s;}
    }}}dst[i]=best;`));
  const finish=await gpu.kernel('CFD exterior wall distance for turbulence',base+stations(0,'near')+stations(1,'wall',true)+main(`
    let w=wall[i];if(w.x<=${pin}||near[i].w==0.){return;}
    let d=distance(x,near[i].xyz);let a=smoothstep(${pin},${.9*bandWidth},w.x);
    wall[i]=vec4f(mix(w.x,d,a),w.yzw);`));
  const strides=[];for(let k=2**Math.floor(Math.log2(Math.max(...f.dims)-1));k>=1;k/=2)strides.push(k);
  strides.push(1,1);
  const e=gpu.device.createCommandEncoder();
  gpu.dispatch(e,seed,gpu.bind(seed,[wall,points[0]],metric),grid);
  for(const [i,k] of strides.entries()){
    const step=gpu.buffer('CFD wall propagation stride',new Int32Array([k,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    gpu.dispatch(e,jump,gpu.bind(jump,[points[i%2],points[1-i%2],step],metric),grid);
  }
  gpu.dispatch(e,finish,gpu.bind(finish,[points[strides.length%2],wall],metric),grid);
  gpu.device.queue.submit([e.finish()]);await gpu.device.queue.onSubmittedWorkDone();
  return {propagationPasses:strides.length,preservedBandM:pin*f.h};
}

// Independent surface integral of the solved pressure. The native signed
// union orients the geometric triangle normal and excludes buried area. Two
// trilinear samples on the exterior normal reproduce an affine pressure at
// the wall. Each sample requires eight fully liquid, outward-side centres.
export async function surfacePressure(gpu,f,capture,band,distance,mobility){
  const device=gpu.device,coords=metricBuffer(gpu,f),n=f.dims.reduce((a,b)=>a*b),mean=gpu.buffer('CFD accumulated fluid pressure',4*n);
  const geometry=gridWGSL(f)+metricWGSL(f),siteType='struct Site{point:vec4f,normal:vec4f,near:vec4f,far:vec4f}';
  const cache=new Map(),chunks=[];
  const sample=await gpu.kernel('CFD accumulate pressure on physical time steps',`
    @group(0) @binding(0) var<storage,read> p:array<f32>;@group(0) @binding(1) var<storage,read_write> sum:array<f32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&sum)){sum[g.x]+=p[g.x];}}`);
  const origin=f.origin.map(v=>Number(v).toPrecision(12)).join(','),h=f.h;
  const shader=siteType+geometry+`
    struct Pose{m:mat4x4f,first:u32,triangles:u32}
    @group(0) @binding(2) var<storage,read> sdf:array<f32>;
    @group(0) @binding(3) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(4) var<storage,read_write> site:array<Site>;
    @group(0) @binding(5) var<uniform> pose:Pose;
    const ORIGIN=vec3f(${origin});const H=f32(${h});
    const BAND=vec3i(${band.dims});const DX=f32(${band.h});
    fn signedDistance(x:vec3f)->f32{
      let p=(x-vec3f(${band.origin.join(',')}))/DX;if(any(p<vec3f(0))||any(p>=vec3f(BAND-1))){return 12.*DX;}
      let base=vec3i(floor(p));let frac=fract(p);var s=0.;for(var k=0;k<8;k++){
        let d=vec3i(k&1,(k>>1)&1,k>>2);let j=base+d;let w=select(1.-frac,frac,d==vec3i(1));
        s+=w.x*w.y*w.z*sdf[j.x+BAND.x*(j.y+BAND.y*j.z)];}return -DX*s;
    }
    fn left(a:u32,v:f32)->i32{var low=0;var high=DIMS[a]-1;
      while(low+1<high){let m=(low+high)/2;if(axisMetric(a,m).x<=v){low=m;}else{high=m;}}return low;}
    fn stencil(point:vec3f,n:vec3f,t:f32)->vec4f{
      let p=(point+t*n-ORIGIN)/H;let l=vec3i(left(0u,p.x),left(1u,p.y),left(2u,p.z));let center=cellCenters(l);
      let frac=(p-center)/(cellCenters(l+1)-center);if(any(frac<vec3f(0))||any(frac>vec3f(1))){return vec4f(-1);}
      for(var k=0;k<8;k++){let q=l+vec3i(k&1,(k>>1)&1,k>>2);let v=ORIGIN+H*cellCenters(q);
        if(mu[index(q)].w<.999999||dot(v-point,n)<-1e-5*H||signedDistance(v)<0.){return vec4f(-1);}
      }return vec4f(frac,bitcast<f32>(index(l)));
    }
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=3u*pose.triangles){return;}let tri=pose.first+i/3u;
      let a=(pose.m*vec4f(sourcePoint(3u*tri),1)).xyz;let b=(pose.m*vec4f(sourcePoint(3u*tri+1u),1)).xyz;
      let c=(pose.m*vec4f(sourcePoint(3u*tri+2u),1)).xyz;
      let ab=b-a;let ac=c-a;let crossArea=cross(ab,ac);let area=length(crossArea)/6.;if(area<=0.){return;}
      let q=i%3u;let x=a+ab*select(1./6.,2./3.,q==1u)+ac*select(1./6.,2./3.,q==2u);
      var n=crossArea/(6.*area);var s:Site;s.point=vec4f(x,area);
      let l=signedDistance(x-.8*DX*n);let r=signedDistance(x+.8*DX*n);
      if(max(l,r)<-.25*DX){s.normal.w=-1.;site[i]=s;return;}
      if(abs(l-r)<.08*DX){s.normal.w=-2.;site[i]=s;return;}
      if(r<l){n=-n;}s.normal=vec4f(n,-3.);
      let p=(x-ORIGIN)/H;let base=vec3i(left(0u,p.x),left(1u,p.y),left(2u,p.z));
      let normalPitch=H/max(length(n/cellWidths(base)),1e-12);var found=false;var first=0.;
      for(var k=1;k<=18;k++){
        let t=.4*f32(k)*normalPitch;if(signedDistance(x+t*n)<-.15*DX){break;}
        if(found&&t-first<.98*normalPitch){continue;}
        let v=stencil(x,n,t);if(v.x<0.){continue;}
        if(!found){s.near=v;first=t;found=true;}else{s.far=v;s.normal.w=first/(t-first);break;}
      }site[i]=s;
    }`;
  const integrate=await gpu.kernel('CFD integrate traction on native triangles',geometry+siteType+`
    struct Estimate{load:vec4f,areas:vec4f,closure:vec4f}
    @group(0) @binding(0) var<storage,read> site:array<Site>;
    @group(0) @binding(1) var<storage,read> p:array<f32>;
    @group(0) @binding(2) var<storage,read_write> out:array<Estimate>;
    var<workgroup> local:array<Estimate,64>;
    fn pressure(s:vec4f)->f32{let base=bitcast<u32>(s.w);var v=0.;
      for(var k=0u;k<8u;k++){let d=vec3u(k&1u,(k>>1u)&1u,k>>2u);
        let w=select(1.-s.xyz,s.xyz,d==vec3u(1));v+=w.x*w.y*w.z*p[base+d.x+NX*(d.y+NY*d.z)];}return v;}
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(local_invocation_index) k:u32,@builtin(workgroup_id) id:vec3u){
      var v:Estimate;if(g.x<arrayLength(&site)){let s=site[g.x];let area=s.point.w;let code=s.normal.w;
        if(code>=0.&&area>0.){let p1=pressure(s.near);let p2=pressure(s.far);let change=code*(p1-p2);
          let F=-area*(p1+change)*s.normal.xyz;v.load=vec4f(F,cross(s.point.xyz,F).x);
          v.closure=vec4f(area*s.normal.xyz,area*abs(change));v.areas.x=area;
        }else if(code==-1.){v.areas.y=area;}else if(code==-2.){v.areas.z=area;}else{v.areas.w=area;}
      }local[k]=v;for(var stride=32u;stride>0u;stride/=2u){workgroupBarrier();if(k<stride){
        let other=local[k+stride];local[k].load+=other.load;local[k].areas+=other.areas;local[k].closure+=other.closure;}}
      if(k==0u){out[id.x]=local[0];}
    }`);
  // Bound geometry submissions and per-binding storage independently of
  // source triangle count. The renderer owns buffer and paged mesh storage.
  for(const mesh of capture.meshes){
    if(!cache.has(mesh.storage))cache.set(mesh.storage,await gpu.kernel('CFD one-sided pressure stencils on native skin',meshReader(mesh.storage)+shader));
    const pipe=cache.get(mesh.storage);
    for(let first=0;first<mesh.triangleCount;first+=4096){
      const triangles=Math.min(4096,mesh.triangleCount-first),sites=3*triangles,groups=Math.ceil(sites/64),uniform=new ArrayBuffer(80);
      new Float32Array(uniform,0,16).set(mesh.matrix);new Uint32Array(uniform,64,2).set([first,triangles]);
      const pose=gpu.buffer('CFD pressure sampling pose',new Uint8Array(uniform),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const s=gpu.buffer('CFD one-sided pressure samples',64*sites),result=gpu.buffer('CFD native pressure integral',48*groups);
      const resources=[...meshResources(mesh),...[distance,mobility,s,pose].map(buffer=>({buffer}))];
      const entries=resources.map((resource,binding)=>({binding,resource}));if(coords)entries.push({binding:12,resource:{buffer:coords}});
      const bind=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries});
      capture.assertCurrent();const e=device.createCommandEncoder();gpu.dispatch(e,pipe,bind,[groups]);device.queue.submit([e.finish()]);
      chunks.push({mesh,first,triangles,site:s,result,groups,bind:gpu.bind(integrate,[s,mean,result])});
    }
  }
  const stage=gpu.staging('CFD native pressure integral reductions',Math.max(48,...chunks.map(c=>c.result.size)));
  return {mean,chunks,bind(p){const group=gpu.bind(sample,[p,mean]);return e=>gpu.dispatch(e,sample,group,[Math.ceil(n/128)]);},
    async measure(scale,omega){
      const sum=new Float64Array(12);capture.assertCurrent();
      const e=device.createCommandEncoder();for(const c of chunks)gpu.dispatch(e,integrate,c.bind,[c.groups]);device.queue.submit([e.finish()]);
      for(const c of chunks){const data=await gpu.read(c.result,stage,c.result.size/4);for(let k=0;k<data.length;k++)sum[k%12]+=data[k];}
      capture.assertCurrent();
      return {pressureForceN:[...sum.slice(0,3)].map(v=>v*scale),pressureTorqueXNm:sum[3]*scale,pressureShaftPowerW:-omega*sum[3]*scale,
        sampledAreaM2:sum[4],buriedAreaM2:sum[5],unorientedAreaM2:sum[6],missingStencilAreaM2:sum[7],areaVectorM2:[...sum.slice(8,11)],
        absoluteExtrapolationIntegralN:sum[11]*scale};
    }};
}

// Separable squared Euclidean distance transform on monotone physical axes.
// Each line keeps the lower envelope of equally curved parabolas. This assigns
// every wake volume to its nearest sampled wall bin, also on a graded grid.
export async function closestWallBins(gpu,f,seeds){
  const n=countOf(f.dims),other=gpu.buffer('CFD intermediate closest wall bins',4*n);
  const envelope=gpu.buffer('CFD parabolic distance envelopes',8*n),coords=metricBuffer(gpu,f);
  const passes=[];let input=seeds,output=other;
  for(let axis=0;axis<3;axis++){
    const length=f.dims[axis],lines=n/length,b=(axis+1)%3,c=(axis+2)%3;
    const pipeline=await gpu.kernel('CFD exact nearest surface bins along axis '+axis,gridWGSL(f)+metricWGSL(f)+`
      @group(0) @binding(0) var<storage,read> previous:array<u32>;
      @group(0) @binding(1) var<storage,read_write> next:array<u32>;
      @group(0) @binding(2) var<storage,read_write> hull:array<vec2u>;
      const AXIS=${axis}u;const B=${b}u;const C=${c}u;const LENGTH=${length}u;
      fn transverseCost(seed:u32,center:vec3f)->f32{
        let delta=cellCenters(point(seed))-center;return delta[B]*delta[B]+delta[C]*delta[C];
      }
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
        let line=g.x;if(line>=${lines}u){return;}
        var p=vec3i(0);p[B]=i32(line%u32(DIMS[B]));p[C]=i32(line/u32(DIMS[B]));
        let center=cellCenters(p);let start=line*LENGTH;var count=0u;
        for(var i=0u;i<LENGTH;i++){
          p[AXIS]=i32(i);let candidate=previous[index(p)];if(candidate==0u){continue;}
          let id=candidate-1u;let xi=axisMetric(AXIS,i32(i)).x;let ci=transverseCost(id,center);var left=-3.4e38;
          while(count>0u){
            let last=hull[start+count-1u];let old=last.x;let xj=cellCenters(point(old))[AXIS];
            left=.5*(xi+xj)+(ci-transverseCost(old,center))/(2.*(xi-xj));
            if(left>bitcast<f32>(last.y)){break;}count--;
          }
          if(count==0u){left=-3.4e38;}hull[start+count]=vec2u(id,bitcast<u32>(left));count++;
        }
        var k=0u;
        for(var i=0u;i<LENGTH;i++){
          p[AXIS]=i32(i);let x=axisMetric(AXIS,i32(i)).x;
          while(k+1u<count&&bitcast<f32>(hull[start+k+1u].y)<x){k++;}
          var seed=0u;if(count>0u){seed=hull[start+k].x+1u;}next[index(p)]=seed;
        }
      }`);
    const bind=gpu.bind(pipeline,[input,output,envelope],coords);
    passes.push(e=>gpu.dispatch(e,pipeline,bind,[Math.ceil(lines/64)]));[input,output]=[output,input];
  }
  return {nearest:input,encode(e){for(const pass of passes)pass(e);}};
}

// Physical dissipation in one control volume, in watts. A uniform velocity
// gradient is recovered on unequal pitches. A rigid rotation has zero strain.
export async function volumeDissipation(gpu,f,dt,state,mobility,total){
  const count=countOf(f.dims),pipe=await gpu.kernel('CFD molecular and turbulent dissipation',gridWGSL(f)+metricWGSL(f)+`
    @group(0) @binding(0) var<storage,read> state:array<vec4f>;
    @group(0) @binding(1) var<storage,read> mu:array<vec4f>;
    @group(0) @binding(2) var<storage,read_write> total:array<f32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS||mu[i].w<=0.){return;}let p=point(i);let u=state[2u*i].xyz;
      var derivative:mat3x3f;
      for(var a=0u;a<3u;a++){
        var sum=vec3f(0);var weights=0.;
        for(var side=-1;side<=1;side+=2){
          var q=p;q[a]+=side;if(!inside(q)){continue;}let j=index(q);let open=mu[select(j,i,side>0)][a];
          if(open<=0.||mu[j].w<=0.){continue;}
          let inv=spacingInv(a,p[a],side);sum+=open*f32(side)*inv*(state[2u*j].xyz-u);weights+=open;
        }
        if(weights>0.){derivative[a]=sum/weights;}
      }
      let strain=(derivative+transpose(derivative))*${.5/dt};
      let s2=dot(strain[0],strain[0])+dot(strain[1],strain[1])+dot(strain[2],strain[2]);
      let width=cellWidths(p);let volume=width.x*width.y*width.z*mu[i].w*${f.h**3};
      let viscosity=${f.nu}+${f.laminar?'0.':`max(0.,state[2u*i+1u].y)*${f.h**2/dt}`};
      total[i]+=${2*f.rho}*viscosity*s2*volume;
    }`);
  const group=gpu.bind(pipe,[state,mobility,total],metricBuffer(gpu,f));
  return e=>gpu.dispatch(e,pipe,group,[Math.ceil(count/128)]);
}

const positiveAtomicWGSL=`
  @group(0) @binding(3) var<storage,read_write> accumulated:array<atomic<u32>>;
  fn addPositive(i:u32,value:f32){
    if(value<=0.){return;}var prev=atomicLoad(&accumulated[i]);
    loop{let res=atomicCompareExchangeWeak(&accumulated[i],prev,bitcast<u32>(bitcast<f32>(prev)+value));
      if(res.exchanged){break;}prev=res.old_value;}
  }`;
export async function surfaceLoss(gpu,display,f,dt,chunks,mobility){
  const count=countOf(f.dims),bytes=4*count,grid=[Math.ceil(count/128)],coords=metricBuffer(gpu,f),base=gridWGSL(f)+metricWGSL(f);
  const bins=gpu.buffer('CFD exposed wall bins',bytes),area=gpu.buffer('CFD native quadrature area in each bin',bytes);
  const current=gpu.buffer('CFD accumulated volume dissipation',bytes),previous=gpu.buffer('CFD previous volume dissipation',bytes);
  const bucket=gpu.buffer('CFD surface-attributed dissipation',bytes);
  const stamp=await gpu.kernel('CFD exposed quadrature area in physical wall bins',base+positiveAtomicWGSL+`
    struct Site{point:vec4f,normal:vec4f,near:vec4f,far:vec4f}
    @group(0) @binding(0) var<storage,read> s:array<Site>;
    @group(0) @binding(1) var<storage,read_write> seeds:array<atomic<u32>>;
    @group(0) @binding(2) var<storage,read_write> siteBin:array<u32>;
    fn bin(a:u32,x:f32)->i32{var lo=0;var hi=DIMS[a];while(lo+1<hi){
      let mid=(lo+hi)/2;let m=axisMetric(a,mid);if(x<m.x-.5*m.y){hi=mid;}else{lo=mid;}}return lo;}
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=arrayLength(&s)){return;}let site=s[i];
      if(site.point.w<=0.||dot(site.normal.xyz,site.normal.xyz)<.5){return;}
      let x=(site.point.xyz-vec3f(${f.origin.join(',')}))/${f.h};let id=index(vec3i(bin(0u,x.x),bin(1u,x.y),bin(2u,x.z)));
      atomicStore(&seeds[id],id+1u);siteBin[i]=id+1u;addPositive(id,site.point.w);
    }`);
  const nearest=await closestWallBins(gpu,f,bins);
  const distribute=await gpu.kernel('CFD attribute viscous wake power to the nearest surface',base+positiveAtomicWGSL+`
    @group(0) @binding(0) var<storage,read> current:array<f32>;
    @group(0) @binding(1) var<storage,read> previous:array<f32>;
    @group(0) @binding(2) var<storage,read> closest:array<u32>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}let id=closest[i];if(id==0u){return;}
      ${f.movingRoad?`let x=cellCenters(point(i));let delta=x-cellCenters(point(id-1u));
        if(x.y*x.y<dot(delta,delta)){return;}`:''}
      addPositive(id-1u,current[i]+previous[i]);
    }`);
  const write=await gpu.kernel('CFD surface loss power and normalized drag density',`
    struct Site{point:vec4f,normal:vec4f,near:vec4f,far:vec4f}
    @group(0) @binding(0) var<storage,read> sites:array<Site>;
    @group(0) @binding(1) var<storage,read> bin:array<u32>;
    @group(0) @binding(2) var<storage,read> area:array<f32>;
    @group(0) @binding(3) var<storage,read> watts:array<f32>;
    @group(0) @binding(4) var<storage,read_write> loss:array<vec4f>;
    @group(0) @binding(5) var<uniform> scale:vec4f;
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=arrayLength(&loss)){return;}var power=0.;var exposed=0.;
      for(var j=0u;j<3u;j++){let s=3u*i+j;let id=bin[s];if(id>0u&&area[id-1u]>0.){
        let a=sites[s].point.w;power+=watts[id-1u]*a/area[id-1u];exposed+=a;}}
      let mean=power*scale.x;let density=mean*scale.y/max(1e-32,exposed);
      loss[i]=vec4f(density,mean,exposed,density*scale.z);
    }`);
  const uniform=gpu.buffer('CFD loss density units',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),parts=[];
  const e=gpu.device.createCommandEncoder();
  for(const [i,c] of chunks.entries()){
    const siteBin=gpu.buffer('CFD quadrature wall-bin index',12*c.triangles),out=display.gpu.buffer('CFD displayed wall loss',16*c.triangles);
    display.chunks[i].loss=out;
    const b=gpu.bind(stamp,[c.site,bins,siteBin,area],coords);
    gpu.dispatch(e,stamp,b,[Math.ceil(3*c.triangles/64)]);
    parts.push({group:gpu.bind(write,[c.site,siteBin,area,bucket,out,uniform]),grid:[Math.ceil(c.triangles/64)]});
  }
  nearest.encode(e);gpu.device.queue.submit([e.finish()]);
  const gather=gpu.bind(distribute,[current,previous,nearest.nearest,bucket],f.movingRoad?coords:null);
  const totalPower=await sumForce(gpu,bucket,count);
  return {current,bind:state=>volumeDissipation(gpu,f,dt,state,mobility,current),
    async publish(steps,complete,force,check,encodeFields){
      check();const b=gpu.device.createCommandEncoder();b.clearBuffer(bucket);gpu.dispatch(b,distribute,gather,grid);
      if(complete)b.copyBufferToBuffer(current,0,previous,0,bytes);gpu.device.queue.submit([b.finish()]);
      const watts=(await totalPower())/steps;check();
      if(!Number.isFinite(watts))throw failure('NONFINITE_LOSS','The integrated dissipation is nonfinite.');
      const normalized=f.U>0&&force>=0&&watts>0,scale=normalized?force/watts:1;
      const reference=.5*f.rho*f.maxSpeed**2*(normalized?1:f.maxSpeed);
      gpu.device.queue.writeBuffer(uniform,0,new Float32Array([1/steps,scale,1/reference,0]));
      const result=gpu.device.createCommandEncoder();for(const p of parts)gpu.dispatch(result,write,p.group,p.grid);
      encodeFields?.(result);
      gpu.device.queue.submit([result.finish()]);
      return {unit:normalized?'N/m2':'W/m2',attributedPowerW:watts,forceNormalizationN:normalized?force:null};
    }
  };
}

async function publishNativeShape(gpu,display,shape,chunks,gradient,referenceDensity,check){
  const device=gpu.device,limit=Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize);
  const blockSize=Math.min(1000000,Math.floor(limit/16)),pipelines=new Map();
  const args=(first,n,base,tri)=>gpu.buffer('CFD logical vertex interval',new Uint32Array([first,n,base,tri]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const parts=[];
  for(const o of shape.occurrences){
    const mesh=o.mesh,work=chunks.map((c,i)=>({c,i})).filter(p=>p.c.mesh===mesh);
    if(!work.length)continue;
    const occurrence=display.chunks[work[0].i].occurrence;
    if(!pipelines.has(mesh.storage)){
      const base=meshReader(mesh.storage)+`
        struct Site{point:vec4f,normal:vec4f,near:vec4f,far:vec4f}
        @group(0) @binding(2) var<storage,read> sites:array<Site>;
        @group(0) @binding(3) var<uniform> span:vec4u;
        fn skin(i:u32)->vec4f{var value=vec4f(0);for(var j=0u;j<3u;j++){
          let s=sites[3u*i+j];if(dot(s.normal.xyz,s.normal.xyz)>.5){value+=s.point.w*vec4f(s.normal.xyz,1.);}}
          return value;}
        fn logical(tri:u32,k:u32)->u32{return span.z+vertex(3u*(span.w+tri)+k);}`;
      const normal=await gpu.kernel('CFD outward normal and area of logical shape vertices',base+`
        @group(0) @binding(4) var<storage,read_write> sums:array<atomic<u32>>;
        fn add(i:u32,x:f32){var b=atomicLoad(&sums[i]);loop{let r=atomicCompareExchangeWeak(&sums[i],b,bitcast<u32>(bitcast<f32>(b)+x));
          if(r.exchanged){break;}b=r.old_value;}}
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
          let i=g.x;if(3u*i>=arrayLength(&sites)){return;}let value=skin(i)/3.;
          for(var j=0u;j<3u;j++){let v=logical(i,j);if(v>=span.x&&v<span.x+span.y){for(var k=0u;k<4u;k++){
            if(value[k]!=0.){add(4u*(v-span.x)+k,value[k]);}}}}
        }`);
      const resolve=await gpu.kernel('CFD signed normal force sensitivity on native triangles',base+`
        @group(0) @binding(4) var<storage,read> geometry:array<vec4f>;
        @group(0) @binding(5) var<storage,read> derivative:array<f32>;
        @group(0) @binding(6) var<storage,read_write> visible:array<vec4f>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
          let i=g.x;if(i>=arrayLength(&visible)){return;}let area=skin(i).w;var density=visible[i].x;
          for(var k=0u;k<3u;k++){
            let id=logical(i,k);if(id<span.x||id>=span.x+span.y){continue;}let v=id-span.x;let n=geometry[v];
            if(n.w<=0.||dot(n.xyz,n.xyz)<=0.){continue;}
            let vec=vec3f(derivative[3u*v],derivative[3u*v+1u],derivative[3u*v+2u]);
            density+=dot(vec,normalize(n.xyz))/(3.*n.w);
          }
          visible[i]=vec4f(density,.001*density*area,area,density/${referenceDensity});
        }`);
      pipelines.set(mesh.storage,{normal,resolve});
    }
    const {normal,resolve}=pipelines.get(mesh.storage);
    for(let local=0;local<o.vertices;local+=blockSize){
      check();const count=Math.min(blockSize,o.vertices-local),first=local+o.first;
      const vector=display.gpu.buffer('CFD physical force gradient per logical vertex',12*count);
      const area=display.gpu.buffer('CFD physical vertex area and normal',16*count),range=args(first,count,o.first,0);
      const e=device.createCommandEncoder();shape.scatter(e,gradient,vector,range);
      const jobs=work.map(({c,i})=>{
        const bounds=args(first,count,o.first,c.first);
        const group=(pipe,extra)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
          {binding:1,resource:meshResources(mesh)[1]},...[c.site,bounds,...extra].map((buffer,j)=>({binding:j+2,resource:{buffer}}))]});
        return {normal:group(normal,[area]),resolve:group(resolve,[area,vector,display.chunks[i].shape]),grid:[Math.ceil(c.triangles/64)]};
      });
      for(const job of jobs)gpu.dispatch(e,normal,job.normal,job.grid);
      for(const job of jobs)gpu.dispatch(e,resolve,job.resolve,job.grid);
      device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();check();
      parts.push({occurrence,firstVertex:local,count,vector,area});
    }
  }
  display.shapeVertices=parts;
}

// Three equal-area quadrature sites belong to each original native triangle.
// Pressure is extrapolated from two fluid-side stencils. Count shear reversals
// before averaging, relative to the tangential exterior flow in the wall frame.
async function nativeSurfaceFields(gpu,display,f,chunks,dt,mobility){
  const grid=gridWGSL(f),velScale=f.h/dt,pressureScale=f.rho*velScale**2;
  const sample=await gpu.kernel('CFD time-resolved native surface quadrature',grid+`
    struct Site{point:vec4f,normal:vec4f,near:vec4f,far:vec4f}
    @group(0) @binding(0) var<storage,read> sites:array<Site>;
    @group(0) @binding(1) var<storage,read> p:array<f32>;
    @group(0) @binding(2) var<storage,read> state:array<vec4f>;
    @group(0) @binding(3) var<storage,read_write> sum:array<vec4f>;
    fn field(s:vec4f)->vec4f{
      let base=bitcast<u32>(s.w);var value=vec4f(0);
      for(var k=0u;k<8u;k++){
        let d=vec3u(k&1u,(k>>1u)&1u,k>>2u);let j=base+d.x+NX*(d.y+NY*d.z);
        let w=select(1.-s.xyz,s.xyz,d!=vec3u(0));value+=w.x*w.y*w.z*vec4f(state[2u*j].xyz,p[j]);
      }return value;
    }
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
      let t=g.x;if(t>=arrayLength(&sum)){return;}var v=vec4f(0);
      for(var q=0u;q<3u;q++){
        let s=sites[3u*t+q];if(s.normal.w<0.||s.point.w<=0.){continue;}
        let first=field(s.near);let second=field(s.far);let normal=s.normal.xyz;
        v.x+=first.w+s.normal.w*(first.w-second.w);v.y+=1.;
        let wall=vec3f(0.,-s.point.z,s.point.y)*${f.omega};
        let drive=vec3f(${f.U},0.,0.)-wall;let tangent=drive-normal*dot(normal,drive);
        let fluid=first.xyz*${velScale}-wall;
        if(dot(tangent,tangent)>${(1e-5*f.maxSpeed)**2}){
          v.z+=select(0.,1.,dot(fluid-normal*dot(fluid,normal),tangent)<0.);v.w+=1.;
        }
      }sum[t]+=v;
    }`);
  const resolve=await gpu.kernel('CFD mean surface pressure and reversal fraction',`
    @group(0) @binding(0) var<storage,read> current:array<vec4f>;
    @group(0) @binding(1) var<storage,read> previous:array<vec4f>;
    @group(0) @binding(2) var<storage,read_write> visible:array<vec4f>;
    @group(0) @binding(3) var<uniform> scale:vec4f;
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
      let t=g.x;if(t>=arrayLength(&visible)){return;}let v=current[t]+previous[t];
      visible[t]=vec4f(scale.x*v.x/max(1.,v.y),v.z/max(1.,v.w),v.y*scale.y,v.w*scale.y);
    }`);
  const uniform=gpu.buffer('CFD physical surface units and sample denominator',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const occurrences=new Map(),work=[],emptyShape=f.immersedShape?null:display.gpu.buffer('CFD unavailable shape field',16);
  for(const chunk of chunks){
    const {mesh,first,triangles,site}=chunk;
    if(!occurrences.has(mesh))occurrences.set(mesh,occurrences.size);
    const occurrence=occurrences.get(mesh),bytes=16*triangles,grid=[Math.ceil(triangles/64)];
    const sum=gpu.buffer('CFD current surface observations',bytes),previous=gpu.buffer('CFD previous surface observations',bytes);
    const visible=display.gpu.buffer('CFD displayed native triangle fields',bytes);
    const shape=emptyShape??display.gpu.buffer('CFD signed triangle shape density',bytes);
    display.chunks.push({mesh,occurrence,first,triangles,visible,shape});
    work.push({site,grid,sum,previous,resolve:gpu.bind(resolve,[sum,previous,visible,uniform])});
  }
  display.dynamicPressure=.5*f.rho*f.maxSpeed**2;
  const losses=await surfaceLoss(gpu,display,f,dt,chunks,mobility);
  display.description={available:['Drag','Pressure','Separation'],pressureUnit:'Pa',separationUnit:'fraction',
    occurrences:[...occurrences].map(([m,occurrence])=>({occurrence,hash:m.hash,triangles:m.triangleCount,vertices:m.vertexCount}))};
  let previousSteps=0;
  return {
    async bind(p,state){
      const dissipate=await losses.bind(state);
      const bindings=work.map(c=>gpu.bind(sample,[c.site,p,state,c.sum]));
      return e=>{dissipate(e);for(const [i,c] of work.entries())gpu.dispatch(e,sample,bindings[i],c.grid);};
    },
    begin(e){e.clearBuffer(losses.current);for(const c of work)e.clearBuffer(c.sum);},
    async publish(steps,complete,force,check){
      check();gpu.device.queue.writeBuffer(uniform,0,new Float32Array([pressureScale,1/(3*(steps+previousSteps)),0,0]));
      const loss=await losses.publish(steps+previousSteps,complete,force,check,e=>{
        for(const c of work){
          gpu.dispatch(e,resolve,c.resolve,c.grid);
          if(complete)e.copyBufferToBuffer(c.sum,0,c.previous,0,c.sum.size);
        }
      });check();
      display.description={...display.description,loss};
      if(complete)previousSteps=steps;
    }
  };
}

async function probeSurface(device,display,occurrence,triangle){
  const part=display.chunks.find(c=>c.occurrence===occurrence&&triangle>=c.first&&triangle<c.first+c.triangles);
  if(!part)throw failure('INVALID_ARGUMENT','The occurrence or native triangle lies outside the current solution.');
  const hasShape=!!display.shapeVertices;
  const read=device.createBuffer({label:'CFD single triangle probe',size:hasShape?48:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
    const e=device.createCommandEncoder(),offset=16*(triangle-part.first);
    e.copyBufferToBuffer(part.visible,offset,read,0,16);e.copyBufferToBuffer(part.loss,offset,read,16,16);
    if(hasShape)e.copyBufferToBuffer(part.shape,offset,read,32,16);device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const [p,gamma,pressureCoverage,separationCoverage,density,watts,area,,shapeDensity,shapePatch,shapeArea]=new Float32Array(read.getMappedRange());
    const unit=display.description.loss.unit;
    return {occurrence,hash:part.mesh.hash,triangle,pressurePa:pressureCoverage>0?p:null,
      Cp:pressureCoverage>0&&display.dynamicPressure>0?p/display.dynamicPressure:null,
      gammaRev:separationCoverage>0?gamma:null,pressureCoverage,separationCoverage,areaM2:area,
      attributedPowerW:watts,lossDensity:area>0?density:null,lossDensityUnit:unit,
      dragDensityNPerM2:area>0&&unit==='N/m2'?density:null,
      ...(hasShape?{shapeDensityNPerM3:shapeArea>0?shapeDensity:null,shapePatchNPerMm:shapeArea>0?shapePatch:null}:{})};
  }finally{read.destroy();}
}

// Draw the renderer's original indexed triangles, including paged meshes.
// The surface values are derived data. Camera, depth and authoring stay native.
const overlayDevices=new WeakMap();
async function nativeFieldOverlay(ctx,display){
  const device=ctx.device,stage=GPUShaderStage,usage=GPUBufferUsage;
  let cache=overlayDevices.get(device);
  if(!cache){
    const camera=device.createBindGroupLayout({entries:[0,1].map(binding=>({binding,visibility:stage.VERTEX,buffer:{type:'uniform'}}))});
    cache={camera,types:new Map(),frames:new WeakMap()};overlayDevices.set(device,cache);
  }
  async function pipeline(storage){
    const native=[0,1].map(binding=>storage==='texture'?{binding,visibility:stage.VERTEX,texture:{sampleType:'uint',viewDimension:'2d-array'}}:
      {binding,visibility:stage.VERTEX,buffer:{type:'read-only-storage'}});
    const layout=device.createBindGroupLayout({entries:[...native,{binding:2,visibility:stage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:3,visibility:stage.VERTEX|stage.FRAGMENT,buffer:{type:'uniform'}},
      {binding:4,visibility:stage.VERTEX,buffer:{type:'read-only-storage'}},{binding:5,visibility:stage.VERTEX,buffer:{type:'read-only-storage'}}]});
    const module=device.createShaderModule({label:'CFD native surface map',code:ctx.viewport.cameraWGSL+meshReader(storage)+`
      struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f}
      struct Owner{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f}
      struct Config{relative:mat4x4f,first:u32,mode:u32,dynamicPressure:f32}
      @group(1) @binding(0) var<uniform> camera:Camera;
      @group(1) @binding(1) var<uniform> owner:Owner;
      @group(0) @binding(2) var<storage,read> field:array<vec4f>;
      @group(0) @binding(3) var<uniform> cfg:Config;
      @group(0) @binding(4) var<storage,read> loss:array<vec4f>;
      @group(0) @binding(5) var<storage,read> shape:array<vec4f>;
      override orthographic:bool=false;
      struct Out{@builtin(position) clip:vec4f,@location(0) value:vec4f,@location(1) local:vec3f,@location(2) loss:vec2f}
      @vertex fn vs(@builtin(vertex_index) v:u32)->Out{
        let local=cfg.relative*vec4f(sourcePoint(3u*cfg.first+v),1.);
        let world=(owner.matrix*local).xyz;
        let p=(frameCameraRelative(camera.rotation)*vec4f((world-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;
        let xy=p.xy+camera.viewport.zw;let depth=-p.z;let span=camera.clip.y-camera.clip.x;
        var out:Out;out.local=local.xyz;out.value=field[v/3u];out.loss=loss[v/3u].zw;
        if(cfg.mode==3u){out.loss=shape[v/3u].zw;}
        if(orthographic){out.clip=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/span,1.);}
        else{out.clip=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/span,depth);}
        return out;
      }
      @fragment fn fs(input:Out)->@location(0) vec4f{
        if(any(input.local<vec3f(-500.,0.,-500.))||any(input.local>vec3f(500.,1000.,500.))){discard;}
        let value=input.value;let neutral=vec3f(.78,.83,.85);var color=neutral;
        if(cfg.mode==0u){
          if(value.z<=0.){discard;}let cp=value.x/cfg.dynamicPressure;
          color=mix(neutral,select(vec3f(.12,.37,.76),vec3f(.84,.20,.10),cp>0.),clamp(abs(cp),0.,1.));
        }else if(cfg.mode==1u){
          if(value.w<=0.){discard;}color=mix(neutral,vec3f(.93,.62,.10),smoothstep(0.,.5,value.y));
          color=mix(color,vec3f(.74,.10,.12),smoothstep(.5,1.,value.y));
        }else if(cfg.mode==2u){
          if(input.loss.x<=0.){discard;}let intensity=sqrt(max(0.,input.loss.y));
          color=mix(vec3f(.12,.30,.41),vec3f(.96,.72,.20),smoothstep(0.,.65,intensity));
          color=mix(color,vec3f(.78,.14,.08),smoothstep(.65,1.5,intensity));
        }else{
          if(input.loss.x<=0.){discard;}let signed=input.loss.y;
          color=mix(neutral,select(vec3f(.13,.34,.85),vec3f(.86,.16,.10),signed>0.),sqrt(abs(signed)/(1.+abs(signed))));
        }return vec4f(color,.87);
      }`});
    const pl=device.createPipelineLayout({bindGroupLayouts:[layout,cache.camera]});
    const pipelines=await Promise.all([false,true].map(orthographic=>device.createRenderPipelineAsync({label:'CFD surface observations',
      layout:pl,vertex:{module,entryPoint:'vs',constants:{orthographic}},fragment:{module,entryPoint:'fs',targets:[{
        format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
      primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal',depthBias:-1}})));
    return {layout,pipelines};
  }
  const records=[];
  for(const c of display.chunks){
    const storage=c.mesh.storage;
    if(!cache.types.has(storage))cache.types.set(storage,pipeline(storage).catch(e=>{cache.types.delete(storage);throw e;}));
    const type=await cache.types.get(storage),data=new ArrayBuffer(80);
    new Float32Array(data,0,16).set(c.mesh.ownerMatrix);new Uint32Array(data,64,1)[0]=c.first;
    new Float32Array(data,72,1)[0]=display.dynamicPressure;
    const config=display.gpu.buffer('CFD surface display transform',new Uint8Array(data),usage.UNIFORM|usage.COPY_DST);
    const resources=[...meshResources(c.mesh),{buffer:c.visible},{buffer:config},{buffer:c.loss},{buffer:c.shape}];
    const group=device.createBindGroup({layout:type.layout,entries:resources.map((resource,binding)=>({binding,resource}))});
    records.push({config,group,type,vertices:3*c.triangles});
  }
  let previousMode=0;
  return ({pass,camera,frame,orthographic})=>{
    let byFrame=cache.frames.get(camera);
    if(!byFrame){byFrame=new WeakMap();cache.frames.set(camera,byFrame);}
    if(!byFrame.has(frame))byFrame.set(frame,device.createBindGroup({layout:cache.camera,entries:[camera,frame].map((buffer,binding)=>({binding,resource:{buffer}}))}));
    const mode=display.mode==='Shape'?3:display.mode==='Drag'?2:Number(display.mode==='Separation'),view=byFrame.get(frame);let bound=null;
    for(const r of records){
      if(mode!==previousMode)device.queue.writeBuffer(r.config,68,new Uint32Array([mode]));
      const p=r.type.pipelines[Number(orthographic)];
      if(bound!==p){pass.setPipeline(p);pass.setBindGroup(1,view);bound=p;}
      pass.setBindGroup(0,r.group);pass.draw(r.vertices);
    }
    previousMode=mode;
  };
}

// U.S. Standard Atmosphere 1976, lower-atmosphere layer bases, hydrostatic
// pressure and Sutherland viscosity. Input elevation is geometric metres.
// https://ntrs.nasa.gov/citations/19770009539
export function mediumProperties(medium,altitude){
  if(medium==='Water')return {rho:998.2,nu:.001002/998.2,temperatureK:293.15,pressurePa:101325,soundSpeedMps:1482,atmosphereInRange:true};
  const radius=6356766,limits=[0,11000,20000,32000,47000,51000,71000,84852],lapse=[-.0065,0,.001,.0028,0,-.0028,-.002];
  const z=Math.max(-5000,Math.min(86000,altitude)),height=z*radius/(radius+z),R=287.05287,g=9.80665;
  let t=288.15,p=101325;
  for(let i=0;i<lapse.length;i++){
    const dh=Math.min(height,limits[i+1])-limits[i],rate=lapse[i],next=t+dh*rate;
    p*=rate===0?Math.exp(-g*dh/(R*t)):(next/t)**(-g/(R*rate));t=next;
    if(height<=limits[i+1])break;
  }
  const rho=p/(R*t),mu=1.458e-6*t**1.5/(t+110.4);
  return {rho,nu:mu/rho,temperatureK:t,pressurePa:p,soundSpeedMps:Math.sqrt(1.4*R*t),atmosphereInRange:z===altitude};
}

// Queue time, including transfers, is learned on the actual shared device.
// Numerical passes stay ordered. No GPU work is outstanding when a slice ends.
export function viewportBudget(device,lastFrame){
  const costs=new Map(),frameMs=1000/60,drawReserve=4;
  let slices=0,maxSliceMs=0,frameYields=0,computePasses=0,dispatches=0;
  // Dispatches have independent WebGPU usage scopes inside a compute pass.
  // Buffer copies and clears end the current pass and stay in command order.
  function sliceEncoder(){
    const encoder=device.createCommandEncoder();let pass=null;
    function end(){if(pass){pass.end();pass=null;}}
    return {
      compute(pipeline,group,grid){
        if(!pass){pass=encoder.beginComputePass();computePasses++;}
        pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(...grid);dispatches++;
      },
      copyBufferToBuffer(...args){end();encoder.copyBufferToBuffer(...args);},
      clearBuffer(...args){end();encoder.clearBuffer(...args);},
      finish(){end();return encoder.finish();}
    };
  }
  async function perform(phases,assertCurrent){
    for(let i=0;i<phases.length;){
      const cost=costs.get(phases[i].kind)??1;
      let available=frameMs-(performance.now()-lastFrame())-drawReserve;
      if(available<Math.min(6,Math.max(1,cost))){await new Promise(requestAnimationFrame);frameYields++;
        available=frameMs-(performance.now()-lastFrame())-drawReserve;}
      const budget=Math.min(6,Math.max(1,available)),first=i;
      let estimate=0;
      do{const next=costs.get(phases[i].kind);
        if(i>first&&(next===undefined||estimate+next>budget))break;
        estimate+=next??1;i++;if(next===undefined)break;
      }while(i<phases.length);
      assertCurrent?.();const start=performance.now(),e=sliceEncoder();
      for(let j=first;j<i;j++)phases[j].encode(e);
      device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
      const ms=performance.now()-start;maxSliceMs=Math.max(maxSliceMs,ms);slices++;
      const ratio=Math.min(4,Math.max(.25,ms/estimate)),seen=new Set();
      for(let j=first;j<i;j++){
        const kind=phases[j].kind;if(seen.has(kind))continue;seen.add(kind);
        const prev=costs.get(kind);costs.set(kind,prev===undefined?Math.max(.05,ms):Math.max(.02,prev*(.75+.25*ratio)));
      }
    }
  }
  return {perform,measure:()=>({slices,frameYields,maxSliceMs,computePasses,dispatches})};
}

export function settledPeriods(windows,requireWake=false){
  if(windows.length<8)return false;
  const recent=windows.slice(-6);
  function stationary(key){
    const v=recent.map(w=>w[key]);if(!v.every(Number.isFinite))return false;
    const a=(v[0]+v[1]+v[2])/3,b=(v[3]+v[4]+v[5])/3,scale=Math.max(Math.abs(a),Math.abs(b));
    return scale===0||Math.abs(a-b)<.005*scale&&Math.max(...v.slice(3))-Math.min(...v.slice(3))<.02*scale;
  }
  return stationary('coefficient')&&(!requireWake||stationary('wakeLengthM'))&&
    (recent.at(-1).powerCoefficient===undefined||stationary('powerCoefficient'));
}

export async function sumForce(gpu,force,count,components=1,offset=0){
  const type=components===1?'f32':'vec4f';
  const n=Math.ceil(count/128),partials=gpu.buffer('CFD window force sums',n*4*components),stage=gpu.staging('CFD window sums readback',n*4*components);
  const pipeline=await gpu.kernel('CFD force reduction',`
    @group(0) @binding(0) var<storage,read> f:array<${type}>; @group(0) @binding(1) var<storage,read_write> sums:array<${type}>;
    var<workgroup> w:array<${type},128>;
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u,@builtin(workgroup_id) id:vec3u,@builtin(local_invocation_index) j:u32){
      var x:${type};if(g.x<${count}u){x=f[${offset}u+g.x];}w[j]=x;
      for(var k=64u;k>0u;k/=2u){workgroupBarrier();if(j<k){w[j]+=w[j+k];}}
      if(j==0u){sums[id.x]=w[0];}}`);
  return async()=>{
    gpu.run(pipeline,[force,partials],[n]);const data=await gpu.read(partials,stage,n*components);
    if(components===1)return data.reduce((a,b)=>a+b,0);
    const total=Array(components).fill(0);for(let i=0;i<data.length;i++)total[i%components]+=data[i];return total;
  };
}

export function rotorTransportStep(f){
  const [dx]=f.minPitch,[,ys,zs]=f.axes;
  let maxRate=0;
  for(let j=0;j<ys.length-1;j++)for(let k=0;k<zs.length-1;k++){
    const dy=ys[j+1]-ys[j],dz=zs[k+1]-zs[k];
    const frameRate=.5*Math.abs(f.omega)*(Math.abs(zs[k]+zs[k+1])/dy+Math.abs(ys[j]+ys[j+1])/dz);
    maxRate=Math.max(maxRate,frameRate+f.maxSpeed*Math.hypot(1/dx,1/dy,1/dz));
  }
  return .65/maxRate;
}

export async function sweptDiameter(device,capture){
  const gpu=gpuScope(device),peak=gpu.buffer('CFD maximum squared physical radius',4);
  try{
    const pipes=new Map();
    for(const mesh of capture.meshes){
      if(!pipes.has(mesh.storage))pipes.set(mesh.storage,await gpu.kernel('CFD swept radius of native surface',meshReader(mesh.storage)+`
        struct Config{m:mat4x4f,n:u32}
        @group(0) @binding(2) var<uniform> cfg:Config;@group(0) @binding(3) var<storage,read_write> peak:atomic<u32>;
        var<workgroup> radii:array<f32,128>;
        @compute @workgroup_size(128) fn main(@builtin(local_invocation_index) k:u32,@builtin(workgroup_id) g:vec3u){
          let i=(g.x+65535u*g.y)*128u+k;var radius=0.;if(i<cfg.n){let v=(cfg.m*vec4f(sourcePoint(i),1.)).yz;radius=dot(v,v);}
          radii[k]=radius;for(var h=64u;h>0u;h/=2u){workgroupBarrier();if(k<h){radii[k]=max(radii[k],radii[k+h]);}}
          if(k==0u){atomicMax(&peak,bitcast<u32>(radii[0]));}
        }`));
      const data=new ArrayBuffer(80);new Float32Array(data,0,16).set(mesh.matrix);new Uint32Array(data,64,1)[0]=mesh.triangleCount*3;
      const cfg=gpu.buffer('CFD physical spin axis transform',new Uint8Array(data),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const op=pipes.get(mesh.storage),entries=[...meshResources(mesh),{buffer:cfg},{buffer:peak}].map((resource,binding)=>({binding,resource}));
      const b=device.createBindGroup({layout:op.getBindGroupLayout(0),entries}),e=device.createCommandEncoder(),groups=Math.ceil(3*mesh.triangleCount/128);
      capture.assertCurrent();gpu.dispatch(e,op,b,[Math.min(65535,groups),Math.ceil(groups/65535)]);device.queue.submit([e.finish()]);
    }
    const radius=(await gpu.read(peak,gpu.staging('CFD physical radius readback',4),1))[0];capture.assertCurrent();
    if(!(radius>0&&Number.isFinite(radius)))throw Error('The evaluated spinning surface has zero or invalid radius');
    return 2*Math.sqrt(radius);
  }finally{gpu.close();}
}

// Each four-cell brick has 64 unknowns. The last coefficient is the
// conductance to its complement, including any pressure reservoir.
export function cutBlockInverse(rows){
  const n=64,A=new Float64Array(n*n),diagonal=new Float64Array(n),mark=new Uint8Array(n);
  for(let i=0;i<n;i++){
    diagonal[i]+=rows[4*i+3];
    for(const [a,stride] of [1,4,16].entries()){
      const c=rows[4*i+a];if(c===0)continue;const j=i+stride;
      A[i*n+j]=A[j*n+i]=-c;diagonal[i]+=c;diagonal[j]+=c;
    }
  }
  for(let seed=0;seed<n;seed++)if(!mark[seed]){
    const todo=[seed];mark[seed]=1;let anchored=false;
    for(let h=0;h<todo.length;h++){
      const i=todo[h];anchored||=rows[4*i+3]>0;
      for(let j=0;j<n;j++)if(!mark[j]&&A[i*n+j]<0){mark[j]=1;todo.push(j);}
    }
    // A sealed component has arbitrary pressure. Its compatible face flow
    // is invariant under this one reference in the local preconditioner.
    if(!anchored)A[seed*n+seed]=diagonal[seed]||1;
  }
  const scale=diagonal.map(v=>1/Math.sqrt(v||1));
  for(let i=0;i<n;i++){
    A[i*n+i]+=diagonal[i];
    for(let j=0;j<=i;j++){
      let a=A[i*n+j]*scale[i]*scale[j];
      for(let k=0;k<j;k++)a-=A[i*n+k]*A[j*n+k];
      if(i===j){if(!(a>0))throw Error('Nonpositive cut-block pressure pivot');A[i*n+i]=Math.sqrt(a);}
      else A[i*n+j]=a/A[j*n+j];
    }
  }
  const inverse=new Float32Array(n*n),v=new Float64Array(n);
  for(let col=0;col<n;col++){
    for(let i=0;i<n;i++){let s=Number(i===col);for(let j=0;j<i;j++)s-=A[i*n+j]*v[j];v[i]=s/A[i*n+i];}
    for(let i=n-1;i>=0;i--){let s=v[i];for(let j=i+1;j<n;j++)s-=A[j*n+i]*v[j];v[i]=s/A[i*n+i];inverse[i*n+col]=v[i]/6;}
  }
  return inverse;
}

function factorCutRows({data}){
  try{
    const rows=new Float32Array(data),out=new Float32Array(rows.length*16);
    for(let i=0;i<rows.length;i+=256)out.set(cutBlockInverse(rows.subarray(i,i+256)),16*i);
    self.postMessage(out.buffer,[out.buffer]);
  }catch(error){self.postMessage({error:error.message});}
}
