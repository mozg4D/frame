import {gpuScope} from './gpu.mjs';
import {pressureMultigrid} from './multigrid.mjs';
import {immersedFaceWGSL} from './fvm.mjs';
import {capturedPressureBarriers,researchSceneContext} from './native-geometry.mjs';

// A zero-thickness impermeable piston accelerates initially resting fluid
// between two equal-pressure reservoirs. The independent one-dimensional
// solution is uniform final velocity and opposing linear pressure ramps.
export async function verifyPiston(device){
  const gpu=gpuScope(device),dims=[32,8,8],[nx,ny,nz]=dims,n=nx*ny*nz;
  // This harness owns an isolated Frame document. These methods are the
  // native host methods behind the plugin geometry SDK.
  const context=researchSceneContext(frameEngine);
  const call=(name,args={})=>frameAI.call(name,args);
  await call('scene.new');const owner=await call('scene.create',{type:'cfd',name:'Reservoir control volume'});
  try{
    const weights=gpu.buffer('CFD piston mobility',n*16),stage=gpu.staging('CFD piston readback',n*16);
    const mg=await pressureMultigrid(gpu,{dims,pressureOpen:[true,true,false,false,false,false]},weights);
    const diagnostic=await gpu.kernel('CFD piston face velocity and reaction',immersedFaceWGSL+`
      @group(0) @binding(0) var<storage,read> pressure:array<f32>;
      @group(0) @binding(1) var<storage,read> mobility:array<vec4f>;
      @group(0) @binding(2) var<storage,read_write> result:array<vec4f>;
      @group(0) @binding(3) var<uniform> wallSpeed:f32;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;let x=i%${nx}u;let pi=pressure[i];var slope=-2.*pi;
        if(x+1u<${nx}u){slope=pressure[i+1u]-pi;}
        let face=projectFace(0.,wallSpeed,mobility[i].x,slope);result[i]=vec4f(face,pi,0.);}`);
    const result=gpu.buffer('CFD piston fluxes',n*16),speed=gpu.buffer('CFD piston speed',16,GPUBufferUsage.COPY_DST|GPUBufferUsage.UNIFORM);
    const enforce=await gpu.kernel('CFD native piston boundary conditions',`
      @group(0) @binding(0) var<storage,read> cuts:array<u32>;
      @group(0) @binding(1) var<storage,read_write> mobility:array<vec4f>;
      @group(0) @binding(2) var<storage,read_write> rhs:array<f32>;
      @group(0) @binding(3) var<uniform> bodySpeed:f32;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
        let i=g.x;let bits=cuts[i];let open=(vec3u(bits)&vec3u(1u,2u,4u))==vec3u(0);
        mobility[i]=vec4f(select(vec3f(0),vec3f(1),open),1.);var incoming=0u;
        if(i%${nx}u!=0u){incoming=cuts[i-1u]&1u;}rhs[i]=bodySpeed*(f32(incoming)-f32(bits&1u));}`);
    const checks=[];
    for(const [location,offset,wallSpeed] of [[9,.25,.037],[21,.75,-.061]]){
      const x=location+offset,paged=wallSpeed<0;
      const vertices=[0,-90,-90,0,90,-90,0,90,90,0,-90,90];
      const source=await call('mesh.create',{name:'Physical piston sheet',vertices,indices:paged?[2,1,0,3,2,0]:[0,1,2,0,2,3],storage:paged?'texture':'auto'});
      let sheet=source;
      if(paged){sheet=await call('scene.create',{type:'instance',params:{object:source.hash}});await call('scene.update',{id:source.hash,visible:false});}
      await call('transform.set',{ids:[sheet.hash],channel:'position',axis:0,value:x,coordinates:'world'});
      const grid={dims,h:.001,origin:[-.0005,.0195,-.0005]};
      const barrier=await capturedPressureBarriers(gpu,grid,context,owner.hash);
      device.queue.writeBuffer(speed,0,new Float32Array([wallSpeed]));
      const raster=device.createCommandEncoder();barrier.encode(raster);
      gpu.dispatch(raster,enforce,gpu.bind(enforce,[barrier.mask,weights,mg.rhs,speed]),[n/128]);device.queue.submit([raster.finish()]);
      const bits=new Uint32Array((await gpu.read(barrier.mask,stage,n)).buffer);
      const correctCrossings=barrier.occurrences===1&&barrier.triangles===2&&barrier.storage[0]===(paged?'texture':'buffer')&&bits.every((flag,i)=>flag===Number(i%nx===location));
      if(!correctCrossings)throw Error('Native sheet crossings disagree: '+JSON.stringify({location,occurrences:barrier.occurrences,storage:barrier.storage,cutColumns:[...new Set(Array.from(bits,(v,i)=>v?i%nx:-1))],owner:context.document.world(owner.hash),sheet:context.document.world(sheet.hash)}));
      const e=device.createCommandEncoder();e.clearBuffer(mg.p);mg.updateGeometry(e);
      mg.solve(e);mg.refine(e,48);
      device.queue.submit([e.finish()]);gpu.run(diagnostic,[mg.p,weights,result,speed],[n/128]);
      const data=await gpu.read(result,stage,4*n);
      let maxRelativeFluxError=0,maxRelativePressureError=0,maxWallSlip=0,reaction=0,maxDivergence=0;
      for(let i=0;i<n;i++){
        const x=i%nx,q=data[4*i],p=data[4*i+2],analytic=x<=location?-wallSpeed*(x+.5):wallSpeed*(nx-x-.5);
        const previous=x?data[4*(i-1)]:-2*p;
        maxDivergence=Math.max(maxDivergence,Math.abs(q-previous)/Math.abs(wallSpeed));
        maxRelativeFluxError=Math.max(maxRelativeFluxError,Math.abs(q/wallSpeed-1));
        maxRelativePressureError=Math.max(maxRelativePressureError,Math.abs(p-analytic)/(nx*Math.abs(wallSpeed)));
        if(x===location)maxWallSlip=Math.max(maxWallSlip,Math.abs(q-wallSpeed));
        reaction+=data[4*i+1];
      }
      const relativeForceError=Math.abs(reaction/(-n*wallSpeed)-1);
      barrier.assertCurrent();await call('scene.update',{id:sheet.hash,visible:false});
      let rejectedStale=false;try{barrier.assertCurrent();}catch(e){if(e.code!=='STALE_CFD_GEOMETRY')throw e;rejectedStale=true;}
      const hidden=await capturedPressureBarriers(gpu,grid,context,owner.hash);
      const clear=device.createCommandEncoder();hidden.encode(clear);device.queue.submit([clear.finish()]);
      const hiddenMask=new Uint32Array((await gpu.read(hidden.mask,stage,n)).buffer);
      const hiddenExcluded=hidden.occurrences===0&&hiddenMask.every(v=>v===0);
      checks.push({location,offset,wallSpeed,correctCrossings,storage:barrier.storage[0],nativeInstance:paged,rejectedStale,hiddenExcluded,
        maxRelativeFluxError,maxRelativePressureError,maxWallSlip,maxDivergence,relativeForceError,
        pass:correctCrossings&&rejectedStale&&hiddenExcluded&&maxRelativeFluxError<2e-5&&maxRelativePressureError<2e-5&&maxWallSlip<1e-8&&maxDivergence<2e-5&&relativeForceError<2e-5});
      await call('scene.delete',{ids:paged?[sheet.hash,source.hash]:[sheet.hash]});
    }
    return {fixture:'impermeable planar piston between equal pressure reservoirs',checks,pass:checks.every(c=>c.pass)};
  }finally{gpu.close();await call('scene.new');}
}
