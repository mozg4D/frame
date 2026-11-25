import {gpuScope} from './gpu.mjs';
import {captureFlowSurfaces,researchSceneContext} from './native-geometry.mjs';
import {pressureForceAdjoint} from './projection-shape.mjs';
import {nativeShapeMetric} from './native-shape-metric.mjs';

// Re-author each displaced native polygon, capture its evaluated buffers or
// texture pages, rebuild the complete operator and solve the primal again.
export async function verifyNativeProjectionShape(device){
  const verts=[[.023,.003,.001],[-.019,.001,-.003],[.002,.018,.002],[-.003,-.021,.004],
    [.002,-.002,.022],[-.001,.004,-.017]],indices=[];
  for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){
    // Deliberately mix winding to exercise geometric inside/outside tests.
    indices.push(x,...(y===0?[2+y,4+z]:[4+z,2+y]));
  }
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const normals=verts.map(()=>[0,0,0]),areas=verts.map(()=>0);
  for(let k=0;k<indices.length;k+=3){const tri=indices.slice(k,k+3),[a,b,c]=tri.map(i=>verts[i]);
    const twice=cross(sub(b,a),sub(c,a)),sign=Math.sign(dot(twice,a));
    for(const j of tri){for(let axis=0;axis<3;axis++)normals[j][axis]+=sign*twice[axis];areas[j]+=Math.hypot(...twice)/6;}
  }
  for(let j=0;j<normals.length;j++){const length=Math.hypot(...normals[j]);normals[j]=normals[j].map(v=>v/length);}
  const f={dims:[16,16,16],origin:[-.04673,-.04917,-.04583],h:.006,rho:1.21,pressureOpen:Array(6).fill(true)};
  const dt=.00023,n=16**3,velocity=new Float32Array(8*n),direction=[1,0,0];
  for(let i=0;i<n;i++){const u=[1.2+.022*((i>>4)%16),.37,-.26];
    for(let a=0;a<3;a++)velocity[8*i+a]=velocity[8*i+4+a]=u[a]*dt/f.h;}
  const ctx=researchSceneContext(frameEngine),call=(op,data={})=>frameAI.call(op,data);let previous=null,staleChecks=0;
  async function solve(id,offset,storage,reverse){
    await call('scene.new');
    if(previous){let refused=false;try{previous.assertCurrent();}catch{refused=true;}if(!refused)throw Error('Replaced shape source remained current');staleChecks++;}
    const box=await call('scene.create',{type:'cfd'}),v=verts.map((p,j)=>p.map((x,a)=>
      1000*(x+(j===id?offset*normals[j][a]:0)+(a===1?.15:0))));
    const shape=await call('mesh.create',{name:'Displaced physical shape patch',storage,vertices:v.flat(),indices});
    await call('diagnostics.frame',{frames:2});
    const capture=captureFlowSurfaces(device,ctx,box.hash,[0,.15,0]);previous=capture;
    if(capture.meshes.length!==1||capture.meshes[0].hash!==shape.hash||capture.meshes[0].vertexCount!==verts.length)
      throw Error('Expected the evaluated native polyhedron with shared logical vertices');
    const gpu=gpuScope(device);
    try{
      const m=await nativeShapeMetric(gpu,f,capture),op=await pressureForceAdjoint(gpu,f,dt,m.mobility,gpu.buffer('CFD measured predictor',velocity),direction);
      const e=device.createCommandEncoder();if(reverse){op.encode(e,m.distances,54);m.project(e,op.gradient);}else op.encodePrimal(e,54);
      capture.assertCurrent();device.queue.submit([e.finish()]);
      const stage=gpu.staging('CFD native shape force check',4*n);
      const p=await gpu.read(op.primal,stage,n),g=await gpu.read(op.seed,stage,n);
      const force=dot(p,g)*f.rho*(f.h/dt)**2*f.h**2;
      const vectors=reverse?await gpu.read(m.vectors,stage,3*verts.length):null;
      capture.assertCurrent();return {force,vectors,storage:capture.meshes[0].storage};
    }finally{gpu.close();}
  }
  const base=await solve(-1,0,'auto',true),pages=await solve(-1,0,'texture',true),patches=[];
  if(base.storage!=='buffer'||pages.storage!=='texture')throw Error('Both native polygon backends must participate');
  for(let j=0;j<verts.length;j++){
    const derivative=.001*dot(normals[j],base.vectors.slice(3*j,3*j+3)),paired=[];
    for(const eps of [3e-5,1.5e-5]){
      const backend=j%2?'texture':'auto';
      paired.push(.001*((await solve(j,eps,backend,false)).force-(await solve(j,-eps,backend,false)).force)/(2*eps));
    }
    patches.push({vertex:j,areaM2:areas[j],outwardNormal:normals[j],sensitivityNPerMm:derivative,pairedNPerMm:paired});
  }
  const a=patches.map(p=>p.sensitivityNPerMm),b=patches.map(p=>p.pairedNPerMm[1]);
  const err=(a,b)=>Math.hypot(...sub(a,b))/Math.hypot(...b),center=a=>a.map(x=>x-a.reduce((s,v)=>s+v,0)/a.length);
  const aa=center(a),bb=center(b),correlation=dot(aa,bb)/(Math.hypot(...aa)*Math.hypot(...bb)),relativeL2=err(a,b);
  const backendDifference=err(Array.from(base.vectors),Array.from(pages.vectors));
  return {objective:'normal derivative of one projected pressure force on evaluated native vertices',forceN:base.force,
    backendDifference,relativeL2,correlation,staleChecks,patches,pass:backendDifference<2e-5&&staleChecks===25&&
      relativeL2<.015&&correlation>.99&&a.every((x,i)=>Math.sign(x)===Math.sign(b[i]))};
}
