// Test resources on the renderer's device. Nothing here is imported by plugin.js.
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

export const median = a => {
  const s = [...a].sort((x,y) => x-y), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i-1] + s[i]) / 2;
};
