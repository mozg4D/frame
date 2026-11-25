import {gpuScope} from './gpu.mjs';

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

export async function verifyRotatingLoads(device){
  const gpu=gpuScope(device);
  try{return await check(gpu);}finally{gpu.close();}
}

async function check(gpu){
  const load=gpu.buffer('CFD manufactured transverse forces',16),acc=await rotatingLoads(gpu,load);
  const expected=[4,1,2,-3],N=37;
  for(let i=0;i<N;i++){
    const theta=-2*Math.PI*(i+.5)/N,c=Math.cos(theta),s=Math.sin(theta);
    // Constant [2,-3] in the box and [4,1] in the rotating basis.
    const y=2*c-3*s+4,z=-2*s-3*c+1;
    gpu.device.queue.writeBuffer(load,0,new Float32Array([7,-9,y,z]));acc.angle(theta);
    const e=gpu.device.createCommandEncoder();acc.encode(e);gpu.device.queue.submit([e.finish()]);
  }
  const stage=gpu.staging('CFD manufactured frame impulse',16);
  const mean=Array.from(await gpu.read(acc.sums,stage,4),x=>x/N),unconsumed=await gpu.read(load,stage,4);
  const maxError=Math.max(...mean.map((x,i)=>Math.abs(x-expected[i])));
  return {mean,maxError,pass:maxError<2e-6&&unconsumed[0]===7&&unconsumed[1]===-9&&unconsumed[2]===0&&unconsumed[3]===0};
}
