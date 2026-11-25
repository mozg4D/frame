import {frozenWallMotion} from '../../plugin.js';
import {gpuScope} from './gpu.mjs';
import {meshReader,meshResources} from './pressure-barrier.mjs';

export async function nativeAxialSpin(device,ctx,owner,options){
  const result=frozenWallMotion(device,ctx,owner,options);
  if(result.motion)result.motion.diameterM=await sweptDiameter(device,result.capture);
  result.assertCurrent();return result;
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
      capture.assertCurrent();gpu.dispatch(e,op,b,[Math.min(65535,groups),Math.ceil(groups/65535)]);device.queue.submit([e.finish()]);
    }
    const radius=(await gpu.read(peak,gpu.staging('CFD physical radius readback',4),1))[0];capture.assertCurrent();
    if(!(radius>0&&Number.isFinite(radius)))throw Error('The evaluated spinning surface has zero or invalid radius');
    return 2*Math.sqrt(radius);
  }finally{gpu.close();}
}
