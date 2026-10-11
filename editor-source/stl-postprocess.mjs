// Additional transferred index copies are bounded across concurrent imports.
let frameSTLPostprocessCopyBytes=0;
const FRAME_STL_POSTPROCESS_COPY_LIMIT=64*1024*1024;
function frameSTLPostprocessWorkerMain() {
  self.onmessage=({data:m})=>{
    try{
      const index=m.indices;
      if(!(index instanceof Uint32Array)||index.length%3||m.id!==1)throw Error('Invalid STL postprocess request');
      const hasPositions=m.kind==='BVH'||m.kind==='combined';
      const count=hasPositions?m.positions?.length/3:m.pointCount;
      if(!Number.isSafeInteger(count)||count<0||count>0xffffffff)throw Error('Invalid STL postprocess point count');
      if(hasPositions&&!(m.positions instanceof Float32Array))throw Error('Invalid STL postprocess positions');
      for(const v of index)if(v>=count)throw Error('Invalid STL postprocess index');
      if(hasPositions){
        const tree=prepareSplineBVH(m.positions,index);
        const result={positions:m.positions,indices:index,tree},transfer=[m.positions.buffer,index.buffer,tree.bvhBounds.buffer,tree.bvhChildren.buffer,tree.bvhOrder.buffer];
        if(m.kind==='combined'){result.wire=frameWireIndices({count},{count:index.length,getX:i=>index[i]});transfer.push(result.wire.buffer);}
        self.postMessage({id:m.id,kind:m.kind,result},transfer);
      }else if(m.kind==='wire'){
        const wire=frameWireIndices({count},{count:index.length,getX:i=>index[i]});
        self.postMessage({id:m.id,kind:m.kind,result:{wire}},[wire.buffer]);
      }else throw Error('Unknown STL postprocess request');
    }catch(error){self.postMessage({id:m.id,kind:m.kind,error:error?.message||String(error)});}
  };
}
async function frameSTLPostprocessTask(kind,packet,transfer,signal) {
  const release=await frameComputeBudget.acquire('native',signal);let worker,url;
  try{
    if(signal?.aborted)throw signal.reason||frameImportAbortError();
    const source=[prepareSplineBVH,frameWireIndices].map(fn=>fn.toString()).join('\n')+'\n('+frameSTLPostprocessWorkerMain.toString()+')();';
    url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      const abort=()=>{worker?.terminate();finish(signal.reason||frameImportAbortError());};
      signal?.addEventListener('abort',abort,{once:true});
      try{
        if(signal?.aborted){abort();return;}
        worker=new Worker(url,{name:'stl-'+kind});
        worker.onerror=e=>finish(Error(e.message||'STL postprocess worker failed'));
        worker.onmessageerror=()=>finish(Error('STL postprocess worker returned unreadable data'));
        worker.onmessage=event=>{
          if(settled)return;
          try{
            const data=event?.data;
            if(!data||typeof data!=='object'||Array.isArray(data))throw Error('STL postprocess worker returned invalid message');
            if(data.id!==1||data.kind!==kind){finish(Error('STL postprocess worker returned unexpected request'));return;}
            if(data.error)finish(Error('STL: '+data.error));else if(data.result)finish(null,data.result);else finish(Error('STL postprocess worker returned no result'));
          }catch(error){finish(error);}
        };
        worker.postMessage({id:1,kind,...packet},transfer);
      }catch(error){finish(error);}
    });
  }finally{worker?.terminate();if(url)URL.revokeObjectURL(url);release();}
}
async function framePrepareSTLWorker(buffer,activity) {
  const parallel=frameComputeBudget.count>=2,prepared=await framePrepareSTLCoordinator(buffer,activity,parallel);
  activity?.check();
  if(!parallel||prepared.indices.length<30000)return prepared;
  const external=activity?.signal,controller=new AbortController(),signal=controller.signal;
  const abort=()=>controller.abort(external.reason||frameImportAbortError());external?.addEventListener('abort',abort,{once:true});
  if(external?.aborted)abort();
  const jobs=[];let copyBytes=0;
  try{
    if(signal.aborted)throw signal.reason||frameImportAbortError();
    const positionWords=prepared.positions.length,indexWords=prepared.indices.length,pointCount=positionWords/3;
    activity?.update('Preparing object picking');
    let bvh,wire;
    const bytes=prepared.indices.byteLength;
    if(bytes>FRAME_STL_POSTPROCESS_COPY_LIMIT-frameSTLPostprocessCopyBytes){
      // Oversized or concurrent-copy pressure retains serial BVH then wire in
      // one leased helper and transfers the originals without any index copy.
      jobs.push(frameSTLPostprocessTask('combined',{positions:prepared.positions,indices:prepared.indices},[prepared.positions.buffer,prepared.indices.buffer],signal));
      bvh=await jobs[0];wire=bvh;
    }else{
      copyBytes=bytes;frameSTLPostprocessCopyBytes+=bytes;
      const wireInput=new Uint32Array(indexWords);wireInput.set(prepared.indices);
      jobs.push(frameSTLPostprocessTask('BVH',{positions:prepared.positions,indices:prepared.indices},[prepared.positions.buffer,prepared.indices.buffer],signal));
      activity?.update('Preparing wireframe');
      jobs.push(frameSTLPostprocessTask('wire',{pointCount,indices:wireInput},[wireInput.buffer],signal));
      [bvh,wire]=await Promise.all(jobs);
    }
    if(signal.aborted)throw signal.reason||frameImportAbortError();activity?.check();
    const t=bvh.tree,Wire=pointCount<65536?Uint16Array:Uint32Array;
    if(!(bvh.positions instanceof Float32Array)||bvh.positions.length!==positionWords||!(bvh.indices instanceof Uint32Array)||bvh.indices.length!==indexWords||!(t?.bvhBounds instanceof Float64Array)||!(t?.bvhChildren instanceof Int32Array)||!(t?.bvhOrder instanceof Uint32Array)||t.bvhBounds.length/6!==t.bvhChildren.length/4||t.bvhOrder.length!==indexWords/3||!(wire.wire instanceof Wire)||wire.wire.length%2)throw Error('Invalid STL postprocess result');
    prepared.positions=bvh.positions;prepared.indices=bvh.indices;prepared.pickTree=t;prepared.wireIndices=wire.wire;return prepared;
  }catch(error){controller.abort(error);await Promise.allSettled(jobs);throw error;}
  finally{frameSTLPostprocessCopyBytes-=copyBytes;external?.removeEventListener('abort',abort);}
}
