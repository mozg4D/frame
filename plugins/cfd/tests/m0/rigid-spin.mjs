import {captureFlowSurfaces} from './native-geometry.mjs';
import {gpuScope} from './gpu.mjs';
import {meshReader,meshResources} from './pressure-barrier.mjs';

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

export async function nativeAxialSpin(device,ctx,owner,{allowStationary=false}={}){
  const call=(name,args={})=>frameAI.call(name,args);
  const scene=await call('scene.inspect'),doc=new Map(scene.objects.map(n=>[n.hash,n]));
  const initial=captureFlowSurfaces(device,ctx,owner),ids=[...new Set(initial.meshes.map(m=>m.hash))];
  const affected=new Set([owner,...ids]);
  for(const id of affected){
    const n=doc.get(id);if(!n)continue;
    for(const dependency of [n.parent,...(n.sources??[]),...Object.values(n.params??{})])
      if(doc.has(dependency))affected.add(dependency);
  }
  const relevant=a=>a.channels.filter(c=>affected.has(c.id));
  const animation=await call('animation.inspect'),channels=relevant(animation),signature=JSON.stringify(channels);
  async function verifyAnimation(capture){
    const a=await call('animation.inspect');capture.assertCurrent();
    if(a.fps!==animation.fps||a.frame!==animation.frame||JSON.stringify(relevant(a))!==signature)
      throw Error('Native animation or sample time changed during the CFD solve');
  }
  if(!channels.length&&allowStationary)return {capture:initial,motion:null,assertCurrent:()=>verifyAnimation(initial)};
  if(!ids.length||ids.length!==initial.meshes.length||ids.some(id=>doc.get(id)?.type!=='mesh'))
    throw Error('Rigid rotation requires directly evaluated polygon components');
  const motions=ids.map(id=>{
    const owners=new Set();for(let p=id;doc.has(p)&&!owners.has(p);p=doc.get(p)?.parent)owners.add(p);
    const tracks=channels.filter(c=>owners.has(c.id));
    return tracks.length===1&&tracks[0].path==='rotation'?axialTrackRate(tracks[0].track,animation.fps):null;
  });
  if(channels.some(c=>c.id===owner)||motions.some(m=>!m))throw Error('Expected one constant native rotation per component or rigid parent');
  const omega=motions[0].omega;if(motions.some(m=>Math.abs(m.omega-omega)>1e-8*Math.abs(omega)))throw Error('Independent angular speeds in one rotating frame');
  const first=Math.max(...motions.map(m=>m.first)),last=Math.min(...motions.map(m=>m.last)),held=animation.frame;
  if(held<first||held>last||last-first<2)throw Error('The current frame must be inside a shared constant-speed interval');
  const read=()=>{
    const sample=captureFlowSurfaces(device,ctx,owner);
    if(sample.contentSignature!==initial.contentSignature)throw Error('Evaluated surface geometry changed between native shaft poses');
    return new Map(sample.meshes.map(m=>[m.hash,Array.from(m.matrix)]));
  };
  const base=read();
  // The native evaluator establishes the physical handedness, axis, pivot
  // and constant geometry at two distinct integer times. The authored slope
  // provides the complete turns between these poses.
  const samples=[first,first+1,first+2].filter(t=>t!==held).slice(0,2);
  const errors=[0,0],poses=[];let identifiable=false;
  try{
    for(const t of samples){
      await call('animation.seek',{frame:t});const pose=read(),angle=omega*(t-held)/animation.fps;
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
  }finally{await call('animation.seek',{frame:held});}
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
  await assertCurrent();
  const diameterM=await sweptDiameter(device,capture);
  return {capture,assertCurrent,motion:{omega:physical,rpm:physical*60/(2*Math.PI),diameterM,fps:animation.fps,heldFrame:held,
    firstFrame:first,lastFrame:last,axisOriginM:axisOrigin,verifiedFrames:samples,relativePoseError:Math.min(...errors),positionErrorM,signature}};
}

async function sweptDiameter(device,capture){
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
      gpu.dispatch(e,op,b,[Math.min(65535,groups),Math.ceil(groups/65535)]);device.queue.submit([e.finish()]);
    }
    const radius=(await gpu.read(peak,gpu.staging('CFD physical radius readback',4),1))[0];capture.assertCurrent();
    if(!(radius>0&&Number.isFinite(radius)))throw Error('The evaluated spinning surface has zero or invalid radius');
    return 2*Math.sqrt(radius);
  }finally{gpu.close();}
}
