import assert from 'node:assert/strict';
export function device() {
  const buffers = [];
  const d = {buffers, limits: {maxBufferSize: 1<<24, maxStorageBufferBindingSize: 1<<24, maxComputeWorkgroupsPerDimension: 65535},
    createBuffer({size, usage, mappedAtCreation = false}) {
      const storage = new ArrayBuffer(size), row = {size, usage, storage, destroyed: false, mapped: mappedAtCreation,
        getMappedRange(){assert(this.mapped); return storage;}, unmap(){this.mapped = false;},
        destroy(){assert(!this.destroyed); this.destroyed = true;}};
      buffers.push(row); return row;
    },
    createShaderModule(){return {getCompilationInfo: async () => ({messages: []})};},
    createBindGroupLayout: q => q, createPipelineLayout: q => q,
    createComputePipelineAsync: async q => q.compute, createBindGroup: q => q,
    createCommandEncoder() {const operations = []; return {
      beginComputePass(){let bind, pipeline; return {setBindGroup(i,b){bind=b;},setPipeline(p){pipeline=p;},
        dispatchWorkgroups(){operations.push({bind,pipeline});},end(){}};}, finish(){return operations;}};
    }
  };
  d.queue = {onSubmittedWorkDone: () => d.completion || Promise.resolve(), submit(commands) {
    for (const ops of commands) for (const {bind, pipeline} of ops) {
      const [ib,pb,bb,nb,ub] = bind.entries.map(e => e.resource.buffer);
      for (const b of [ib,pb,bb,nb,ub]) assert(!b.destroyed);
      const ids = new Uint32Array(ib.storage), p = new Float32Array(pb.storage), base = new Float32Array(bb.storage), n = new Float32Array(nb.storage), m = new Float32Array(ub.storage);
      for (let k = 0; k < ids.length; k++) {const at=ids[k]*3, normal=ids[k]*9, source=k*6;
        if(pipeline.entryPoint==='gather') for(let c=0;c<3;c++){base[source+c]=p[at+c];base[source+3+c]=n[normal+c];}
        if(pipeline.entryPoint==='pose') for(let c=0;c<3;c++) p[at+c]=m[c]*base[source]+m[c+4]*base[source+1]+m[c+8]*base[source+2]+m[c+12];
        if(pipeline.entryPoint==='restore') for(let c=0;c<3;c++){p[at+c]=base[source+c];n[normal+c]=base[source+3+c];}
      }
    }
  }};
  return d;
}
