import {blockBasis,storage} from '../../plugin.js';
export {blockBasis,gpuBlocks} from '../../plugin.js';

function halves(values) {
  // Constants use the same IEEE binary16 conversion as the interop buffers.
  return new Uint16Array(Float16Array.from(values).buffer);
}

export async function neuralBlocks(gpu, n, dims, ml, deviceType,schur=null) {
  if (!ml || typeof MLGraphBuilder !== 'function') throw Error('WebNN is unavailable');
  if (typeof Float16Array !== 'function') throw Error('Float16Array is unavailable');
  const context = await ml.createContext({deviceType});
  const dispose = [];
  function close() {
    for (const item of dispose.splice(0).reverse()) item.destroy();
    context.destroy();
  }
  try {
    if (!context.opSupportLimits().matmul?.a?.dataTypes?.includes('float16')) throw Error('FP16 matmul is unavailable');
    const blocks=dims.reduce((a,b)=>a*b,1)/n**3,count=blocks*(schur?.m??n**3);
    const descriptor = {dataType:'float16',shape:schur?[blocks,schur.m]:[blocks,n,n,n]}, b = new MLGraphBuilder(context);
    let y = b.input('rhs',descriptor);
    if(schur){
      const constant=(shape,data)=>b.constant({dataType:'float16',shape},halves(data));
      y=b.matmul(y,constant([schur.m,schur.m],schur.green));
    }else{
      const {q,eigen}=blockBasis(n),basis=b.constant({dataType:'float16',shape:[n,n]},halves(q));
      const diagonal=Float32Array.from({length:n**3},(_,i)=>1/(eigen[i%n]+eigen[Math.floor(i/n)%n]+eigen[Math.floor(i/(n*n))]));
      const inv=b.constant({dataType:'float16',shape:[1,n,n,n]},halves(diagonal));
      for(let step=0;step<6;step++){
        y=b.matmul(y,basis);
        y=b.transpose(y,{permutation:[0,3,1,2]});
        if(step===2)y=b.mul(y,inv);
      }
    }
    const graph = await b.build({correction:y});
    dispose.push(graph);
    let input,output,transport='exportToGPU',interopReason=null;
    try{
      if(!context.createExportableTensor||!context.exportToGPU)throw new DOMException('No tensor export API','NotSupportedError');
      input=await context.createExportableTensor(descriptor,gpu.device);
      output=await context.createExportableTensor(descriptor,gpu.device);
    }catch(error){
      input?.destroy();input=null;
      if(error.name!=='NotSupportedError'&&!/interop.*not supported/i.test(error.message))throw error;
      transport='host-copy';interopReason=error.message;
      input=await context.createTensor({...descriptor,writable:true});dispose.push(input);
      output=await context.createTensor({...descriptor,readable:true});
    }
    if(transport==='exportToGPU')dispose.push(input);
    dispose.push(output);
    const address=schur?'fn address(i:u32)->u32{return i;}':`fn address(i:u32)->u32{
      let tile=i/${n**3}u;let j=i%${n**3}u;
      let brick=vec3u(tile%${dims[0]/n}u,(tile/${dims[0]/n}u)%${dims[1]/n}u,tile/${dims[0]*dims[1]/(n*n)}u);
      let p=brick*${n}u+vec3u(j%${n}u,(j/${n}u)%${n}u,j/${n*n}u);
      return p.x+${dims[0]}u*(p.y+${dims[1]}u*p.z);}`;
    const pack = await gpu.kernel('CFD WebNN pack',address+storage(0,'src')+`
      @group(0) @binding(1) var<storage,read_write> dst:array<u32>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x*2u;
        if(i<${count}u){dst[g.x]=pack2x16float(vec2f(src[address(i)],src[address(i+1u)]));}}`);
    const unpack = await gpu.kernel('CFD WebNN unpack',address+storage(1,'dst','read_write')+`
      @group(0) @binding(0) var<storage,read> src:array<u32>;
      @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){let i=g.x*2u;
        if(i<${count}u){let v=unpack2x16float(src[g.x]);dst[address(i)]=v.x;dst[address(i+1u)]=v.y;}}`);
    const groups=[Math.ceil(count/256)];
    const bytes=count*2,copyIn=transport==='host-copy'?gpu.buffer('CFD packed ML input',bytes):null;
    const copyOut=copyIn?gpu.buffer('CFD packed ML output',bytes):null,stage=copyIn?gpu.staging('CFD ML host transfer',bytes):null;
    return {kind:'webnn-'+deviceType+'-fp16',close,transport,interopReason,requestedDeviceType:deviceType,
      async apply(rhs, correction) {
        if(copyIn){
          gpu.run(pack,[rhs,copyIn],groups);
          const packed=await gpu.read(copyIn,stage,bytes/4);
          context.writeTensor(input,packed.buffer);
          context.dispatch(graph,{rhs:input},{correction:output});
          const result=await context.readTensor(output);
          gpu.device.queue.writeBuffer(copyOut,0,result);
          gpu.run(unpack,[copyOut,correction],groups);
          return;
        }
        const inputBuffer=context.exportToGPU(input);
        try { gpu.run(pack,[rhs,inputBuffer],groups); } finally { inputBuffer.destroy(); }
        context.dispatch(graph,{rhs:input},{correction:output});
        const outputBuffer=context.exportToGPU(output);
        try { gpu.run(unpack,[outputBuffer,correction],groups); } finally { outputBuffer.destroy(); }
      }};
  } catch(error) { close(); throw error; }
}
