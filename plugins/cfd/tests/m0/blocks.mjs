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

const storage = (binding, name, mode = 'read') =>
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
