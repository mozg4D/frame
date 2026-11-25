// Native CFD authoring and frozen surface kinematics on the shared renderer.
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
    return {...mesh,bounds,matrix:context.math.mul(shift,mesh.matrix)};
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

export async function activate(context){
  if(context.version!==1)throw failure('API_VERSION','Unsupported Frame plugin API.');
  const find=hash=>{const n=context.document.nodes.find(n=>n.nativeHash===hash&&n.type==='cfd');if(!n)throw failure('INVALID_OWNER','Select an existing CFD object.');return n;};
  const status=hash=>{const n=find(hash);return {stage:'wall-kinematics',state:'under-construction',authoringOnly:false,solverAvailable:false,resultsAvailable:false,geometryDiagnosticAvailable:true,registeredTags:[],owner:{hash:n.nativeHash,type:n.type},parameters:{...n.params},localBox:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max],pivot:[...LOCAL_BOX.pivot],unit:'mm'},flow:{directionLocal:[1,0,0],inletLocalX:-500,outletLocalX:500,speedUnit:'m/s',markerOnly:true},geometryParticipation:'automatic-evaluated-box-intersection',geometryEvaluated:false};};
  const unavailable=()=>{throw failure('CFD_AUTHORING_ONLY','The CFD flow solver is undergoing physical qualification.');};
  context.operations.register([
    {id:'status',description:'Inspect CFD Box inputs and available capabilities.',inputSchema:emptySchema,readOnly:true,run:status},
    {id:'wall-motion',description:'Evaluate the frozen velocity field of the stationary or verified rotating surfaces intersecting this box. Optional probe points are in world metres.',
      inputSchema:{type:'object',properties:{pointsWorldM:{type:'array',maxItems:64,items:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}}},additionalProperties:false},
      readOnly:true,run:(hash,args={})=>{
        find(hash);const p=args.pointsWorldM??[];
        if(!Array.isArray(p)||p.length>64||p.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite)))throw failure('INVALID_ARGUMENT','Expected up to 64 finite world points in metres.');
        return wallMotionReport(context,hash,p);
      }},
    ...['solve-frame','solve-animation','results'].map(id=>({id,description:'Unavailable in the authoring preview. Always rejects with CFD_AUTHORING_ONLY before numerical work or mutation.',inputSchema:{type:'object',properties:{},additionalProperties:true},readOnly:true,run:unavailable}))
  ]);
  context.editor.register({parameters:(n,changes)=>{if(n.type!=='cfd')return null;validateParameters({...n.params,...changes});return {};}});
  context.attributes.register(hash=>{find(hash);return {actions:[{id:'status',label:'Under construction',disabled:true}]};});
  await context.viewport.register({pivot:[...LOCAL_BOX.pivot],bounds:{min:[...LOCAL_BOX.min],max:[...LOCAL_BOX.max]},lines:helperLines(),color:[.45,.68,.78,.75],selectedColor:[.7,.86,1,.9],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}
