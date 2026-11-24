import {gpuScope} from './gpu.mjs';
import {meshReader,meshResources,meshPressureBarriers} from './pressure-barrier.mjs';
import {extendNativeMetric} from './metric.mjs';
import {gridWGSL} from './fixtures.mjs';

const countOf=dims=>dims.reduce((a,b)=>a*b);
const workgroups=n=>{const g=Math.ceil(n/64);return [Math.min(65535,g),Math.ceil(g/65535)];};

function distanceBand(f,meshes){
  const h=f.h/2,lo=[Infinity,Infinity,Infinity],hi=lo.map(v=>-v);
  for(const m of meshes)for(let k=0;k<3;k++){
    lo[k]=Math.min(lo[k],m.bounds.min[k]);hi[k]=Math.max(hi[k],m.bounds.max[k]);
  }
  const first=lo.map((v,k)=>Math.max(0,Math.min(2*f.dims[k]-3,Math.floor((v-f.origin[k])/h)-12)));
  const last=hi.map((v,k)=>Math.min(2*f.dims[k],Math.max(first[k]+3,Math.ceil((v-f.origin[k])/h)+12)));
  return {h,dims:last.map((v,k)=>v-first[k]),origin:first.map((v,k)=>f.origin[k]+(v+.5)*h)};
}

// Gather one bounded chunk of native indexed triangles at a time on the GPU.
// All three directional projections, signed voting, union and distance extension
// use the editor's existing Unite kernels. No imported normals are consumed.
async function rasterize(gpu,band,capture){
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

export async function nativeFlowGeometry(gpu,f,capture){
  const scratch=gpuScope(gpu.device),start=performance.now(),band=distanceBand(f,capture.meshes),n=countOf(f.dims);
  try{
    const packed=await rasterize(scratch,band,capture),distance=await extendNativeMetric(scratch,band.dims,packed,12);
    const phase=scratch.buffer('CFD stationary surface frame',new Float32Array([1,0,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const crossed=await meshPressureBarriers(scratch,f,capture.meshes,phase,capture.assertCurrent);
    const wall=gpu.buffer('CFD evaluated wall distance and motion',16*n),response=gpu.buffer('CFD evaluated pressure mobility',16*n);
    const pipe=await scratch.kernel('CFD native distance and sealed face response',gridWGSL(f)+`
      @group(0) @binding(0) var<storage,read> metric:array<f32>;@group(0) @binding(1) var<storage,read> crossed:array<u32>;
      @group(0) @binding(2) var<storage,read_write> wall:array<vec4f>;@group(0) @binding(3) var<storage,read_write> response:array<vec4f>;
      const BAND=vec3i(${band.dims});
      fn sample(p:vec3f)->f32{
        if(any(p<vec3f(0))||any(p>vec3f(BAND-1))){return 6.;}let q=vec3i(floor(p));let t=fract(p);var d=0.;
        for(var i=0;i<8;i++){let off=vec3i(i&1,(i>>1)&1,i>>2);let b=min(BAND-1,q+off);let w=select(1.-t,t,off==vec3i(1));
          d+=w.x*w.y*w.z*metric[u32(b.x+BAND.x*(b.y+BAND.y*b.z))];}return -.5*d;}
      fn mobility(d:f32)->f32{let s=clamp(2.*d,-1.,1.);return clamp(.5*(1.+s+sin(3.14159265*s)/3.14159265),0.,1.);}
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){let i=gid.x;if(i>=CELLS){return;}
        let p=vec3f(point(i))*2.+vec3f(${f.origin.map((x,k)=>((x+.5*f.h-band.origin[k])/band.h).toFixed(8)).join(',')});let d=sample(p);
        let m=vec3f(mobility(sample(p+vec3f(1,0,0))),mobility(sample(p+vec3f(0,1,0))),mobility(sample(p+vec3f(0,0,1))));
        wall[i]=vec4f(d,0.,0.,1.-smoothstep(-.7,.7,d));let mask=vec3u(crossed[i])&vec3u(1u,2u,4u);
        response[i]=vec4f(select(m,vec3f(0),mask!=vec3u(0)),mobility(d));}`);
    const e=gpu.device.createCommandEncoder();crossed.encode(e);
    scratch.dispatch(e,pipe,scratch.bind(pipe,[distance,crossed.mask,wall,response]),[Math.ceil(n/128)]);
    gpu.device.queue.submit([e.finish()]);await gpu.device.queue.onSubmittedWorkDone();capture.assertCurrent();
    return {wall,response,update:capture.assertCurrent,assertCurrent:capture.assertCurrent,stats:{source:'Frame evaluated surfaces / Unite directional volume and metric',
      occurrences:capture.meshes.length,triangles:capture.meshes.reduce((s,m)=>s+m.triangleCount,0),bandDims:band.dims,bandPitchM:band.h,scratchBytes:scratch.allocatedBytes,geometryMs:performance.now()-start}};
  }finally{scratch.close();}
}
