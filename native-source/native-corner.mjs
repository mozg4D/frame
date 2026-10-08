/** PRIVATE PROPOSAL: native clip/admission and BVH candidate stages, exact
 * worker refinement, then the existing native ALL-corner element stage.
 * No texture-depth comparison, arbitrary bias, or old-renderer fallback.
 * Browser shader compilation/raster acceptance are explicitly NOT RUN here.
 */
import {dispatchShape,rectangleParams,validatePacket} from './gpu-selection.mjs';
import {assertRenderDomain} from './render-domain.mjs';
export const CORNER_CLIP_WGSL=`
struct Params { counts:vec4u }
@group(0) @binding(0) var<storage,read> positions:array<f32>;
@group(0) @binding(1) var<storage,read> matrices:array<mat4x4<f32>>;
@group(0) @binding(2) var<storage,read_write> clips:array<vec4f>;
@group(0) @binding(3) var<uniform> params:Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) tid:vec3u){
 if(params.counts.z==0u||params.counts.w==0u){return;}if(tid.y>(params.counts.z-1u)/params.counts.w){return;}
 let base=tid.y*params.counts.w;if(tid.x>=params.counts.z-base){return;}let id=base+tid.x;
 let v=id%params.counts.x;let i=id/params.counts.x;let p=v*3u;
 clips[id]=matrices[i]*vec4f(positions[p],positions[p+1u],positions[p+2u],1.0);
}`;
export const CORNER_ADMISSION_WGSL=`
struct Params {viewport:vec4f,rectangle:vec4f,counts:vec4u,options:vec4u}
@group(0) @binding(0) var<storage,read> clips:array<vec4f>;
@group(0) @binding(1) var<storage,read> representatives:array<u32>;
@group(0) @binding(2) var<storage,read_write> mask:array<u32>;
@group(0) @binding(3) var<uniform> params:Params;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) tid:vec3u){
 if(params.counts.z==0u||params.counts.w==0u){return;}if(tid.y>(params.counts.z-1u)/params.counts.w){return;}
 let base=tid.y*params.counts.w;if(tid.x>=params.counts.z-base){return;}let id=base+tid.x;mask[id]=0u;
 let instance=id/params.counts.x;var v=id%params.counts.x;
 if(params.options.x!=0u){v=representatives[v];}let c=clips[instance*params.options.y+v];
 if(!(c.w>0.0)){return;}let n=c.xyz/c.w;
 if(!(all(n.xy>=vec2f(-1.0))&&all(n.xy<=vec2f(1.0))&&n.z>=0.0&&n.z<=1.0)){return;}
 let s=params.viewport.xy+vec2f(n.x*0.5+0.5,0.5-n.y*0.5)*params.viewport.zw;
 if(!(all(s>=params.rectangle.xy)&&all(s<=params.rectangle.zw))){return;}
 if(!(all(s>=params.viewport.xy)&&all(s<params.viewport.xy+params.viewport.zw))){return;}
 mask[id]=1u;
}`;
export const CORNER_CANDIDATES_WGSL=`
struct Params {counts:vec4u} // nodes, queries, dispatch row width, emit
@group(0) @binding(0) var<storage,read> nodeBounds:array<vec4f>;
@group(0) @binding(1) var<storage,read> nodeMeta:array<vec4u>;
@group(0) @binding(2) var<storage,read> order:array<u32>;
@group(0) @binding(3) var<storage,read> triangleBounds:array<vec4f>;
@group(0) @binding(4) var<storage,read> points:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> resultCounts:array<u32>;
@group(0) @binding(6) var<storage,read> offsets:array<u32>;
@group(0) @binding(7) var<storage,read_write> resultIds:array<u32>;
@group(0) @binding(8) var<uniform> params:Params;
fn overlaps(a:vec4f,b:vec4f)->bool{return a.x<=b.z&&a.z>=b.x&&a.y<=b.w&&a.w>=b.y;}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) tid:vec3u){
 if(params.counts.y==0u||params.counts.z==0u){return;}if(tid.y>(params.counts.y-1u)/params.counts.z){return;}
 let base=tid.y*params.counts.z;if(tid.x>=params.counts.y-base){return;}let id=base+tid.x;
 let q=points[id];var count=0u;var n=0u;
 if(q.x<=q.z&&q.y<=q.w){
  loop{if(n>=params.counts.x){break;}let m=nodeMeta[n];
   if(!overlaps(nodeBounds[n],q)){n=m.z;continue;}
   for(var j=m.x;j<m.x+m.y;j++){let t=order[j];if(overlaps(triangleBounds[t],q)){
    if(params.counts.w!=0u){resultIds[offsets[id]+count]=t;}count++;
   }}n++;
  }
 }resultCounts[id]=count;
}`;
const fail=m=>{throw Error(m);},abort=m=>new DOMException(m,'AbortError');
export const CORNER_SCENE_CACHE_LIMITS=Object.freeze({sourceBytes:16*1024*1024,vertices:150000,triangles:250000});
const copyCornerPacket=c=>({positions:c.positions.slice(),clipMatrices:c.clipMatrices.slice(),indices:c.indices?.slice()??null});
function cornerArrayEqual(a,b){
 if(a==null||b==null)return a==null&&b==null;
 if(a.constructor!==b.constructor||a.byteLength!==b.byteLength)return false;
 const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);
 for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;
}
const cornerPacketEqual=(a,b)=>cornerArrayEqual(a.positions,b.positions)&&cornerArrayEqual(a.clipMatrices,b.clipMatrices)&&cornerArrayEqual(a.indices,b.indices);
const cornerSceneMatches=(key,target,occluders,reps)=>key.occluders.length===occluders.length&&cornerPacketEqual(key.target,target)&&cornerArrayEqual(key.representatives,reps)&&key.occluders.every((p,i)=>cornerPacketEqual(p,occluders[i]));
function cornerCacheBudget(target,occluders,reps){
 let bytes=reps?.byteLength??0,vertices=0,triangles=0;
 for(const p of [target,...occluders])bytes+=p.positions.byteLength+p.clipMatrices.byteLength+(p.indices?.byteLength??0);
 // Count target projection as well as scene clips; worker retains both.
 for(const p of [target,...occluders]){const vc=p.positions.length/3,ic=p.clipMatrices.length/16;vertices+=vc*ic;triangles+=(p.indices?.length??vc)/3*ic;}
 return {bytes,vertices,triangles,cacheable:bytes<=CORNER_SCENE_CACHE_LIMITS.sourceBytes&&vertices<=CORNER_SCENE_CACHE_LIMITS.vertices&&triangles<=CORNER_SCENE_CACHE_LIMITS.triangles};
}
function cornerWorkerFactory(){
 if(typeof createCornerVisibilityWorker==='function')return createCornerVisibilityWorker();
 return new Worker(new URL('./corner-worker.mjs',import.meta.url),{type:'module'});
}
class ExactWorker {
 constructor(factory){this.worker=factory();this.serial=0;this.pending=new Map();
  this.worker.onmessage=({data:m})=>{const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);};
  this.worker.onerror=e=>this.dispose(Error(e.message??'Corner worker failed'));
 }
 call(kind,data={},transfer=[]){if(!this.worker)return Promise.reject(abort('Corner worker disposed'));const id=++this.serial;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage({id,kind,...data},transfer);}catch(e){this.pending.delete(id);reject(e);}});}
 dispose(error=abort('Corner worker disposed')){this.worker?.terminate();this.worker=null;for(const p of this.pending.values())p.reject(error);this.pending.clear();}
}
export class FrameGpuCornerVisibility {
 static async create(host,options={}){const p=new FrameGpuCornerVisibility(host,options);try{await p._init();return p;}catch(e){p.dispose();throw e;}}
 constructor(host,{workerFactory=cornerWorkerFactory}={}){assertRenderDomain(host.renderDomain);if(host.state!=='ready')fail('Ready shared native host required');this.host=host;this.device=host.device;this.renderDomain=host.renderDomain;this.workerFactory=workerFactory;this.worker=null;this.sceneCache=null;this.sceneCacheStats={hits:0,builds:0};this.disposed=false;this.jobs=new Set();this.compilation=[];}
 _worker(){if(this.disposed)throw abort('Native corner owner disposed');if(!this.worker?.worker)this.worker=new ExactWorker(this.workerFactory);return this.worker;}
 async _init(){const d=this.device;d.pushErrorScope('validation');let error;
  try{for(const [name,code]of [['clip',CORNER_CLIP_WGSL],['admission',CORNER_ADMISSION_WGSL],['candidates',CORNER_CANDIDATES_WGSL]]){
   const module=d.createShaderModule({label:'Frame corner '+name,code}),info=await module.getCompilationInfo();
   this.compilation.push({name,messages:Array.from(info.messages,m=>({type:m.type,message:m.message,line:m.lineNum,column:m.linePos}))});
   if(info.messages.some(m=>m.type==='error'))fail('Corner WGSL '+name+' compilation failed');
   this[name+'Pipeline']=await d.createComputePipelineAsync({label:'Frame corner '+name,layout:'auto',compute:{module,entryPoint:'main'}});
  }}catch(e){error=e;}const validation=await d.popErrorScope();if(error)throw error;if(validation)fail(validation.message);
  if(this.disposed||this.host.state!=='ready')throw abort('Native owner changed during corner initialization');
 }
 /** Same read()/dispose() contract as host.select. No query runs per frame.
  * Bounded correctness prototype: scene BVH is rebuilt per select; session-level
  * reuse/batching and measured large-scene costs remain integration work.
  */
 select(p,{packet,occluderPackets,representatives=null,rectangle,viewport,width,height,isCurrent=()=>true,signal=null}={}){
  const h=this.host;if(this.disposed||h.state!=='ready'||p?.owner!==h||p.released)fail('Ready native corner target required');
  if(h.jobs.size||this.jobs.size)fail('Coalesce native corner queries');
  const opts=rectangleParams(Array.from(rectangle),Array.from(viewport),width,height),epoch=h.epoch;
  if(packet.positions.length/3!==p.sourceVertexCount||packet.clipMatrices.length/16!==p.instanceCount)fail('Corner target packet mismatch');
  if(representatives&&(!(representatives instanceof Uint32Array)||representatives.length!==p.vertexCount||Array.from(representatives).some(i=>i>=p.sourceVertexCount)))fail('Invalid logical representatives');
  if(p.hasRepresentatives!==!!representatives)fail('Prepared logical representative policy mismatch');
  let cancelled=false,freed=false,promise=null;const owned=[],worker=this._worker();
  const valid=()=>!freed&&!cancelled&&!signal?.aborted&&!this.disposed&&h.state==='ready'&&h.epoch===epoch&&!p.released&&isCurrent();
  const check=()=>{if(!valid())throw abort('Native corner query became stale');};
  const add=b=>(owned.push(b),b),storage=(data,label,minBytes=4)=>add(h._storage(data,label,minBytes)),uniform=(data,label)=>add(h._buffer(data,GPUBufferUsage.UNIFORM,label));
  const output=(size,label,minBytes=4)=>{size=Math.max(minBytes,size);if(size>this.device.limits.maxStorageBufferBindingSize||size>this.device.limits.maxBufferSize)fail('Corner buffer exceeds native binding limit; explicit batching required');return add(this.device.createBuffer({label,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}));};
  const read=async(buffer,bytes)=>{check();if(!bytes)return new ArrayBuffer(0);const staging=add(this.device.createBuffer({label:'Frame corner readback',size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}));
   const enc=this.device.createCommandEncoder();enc.copyBufferToBuffer(buffer,0,staging,0,bytes);this.device.queue.submit([enc.finish()]);await staging.mapAsync(GPUMapMode.READ);
   try{check();return staging.getMappedRange().slice(0,bytes);}finally{staging.unmap();}
  };
  const dispatch=(pipeline,resources,count)=>{const shape=dispatchShape(count,this.device.limits.maxComputeWorkgroupsPerDimension),bind=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((buffer,binding)=>({binding,resource:{buffer}}))}),enc=this.device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);if(count)pass.dispatchWorkgroups(shape.x,shape.y);pass.end();this.device.queue.submit([enc.finish()]);};
  const cleanup=async()=>{if(freed)return;if(this.sceneCache?.worker!==worker)await worker.call('clear').catch(()=>{});await this.device.queue.onSubmittedWorkDone().catch(()=>{});if(freed)return;freed=true;signal?.removeEventListener('abort',onAbort);for(const b of owned)b.destroy();h.jobs.delete(job);this.jobs.delete(job);};
  const job={cancel:()=>{if(cancelled||freed)return;cancelled=true;this.sceneCache=null;worker.dispose(abort('Native corner query cancelled'));if(this.worker===worker)this.worker=null;},read:()=>promise??=(async()=>{let result;try{result=await run();}finally{await cleanup();}if(cancelled||signal?.aborted||this.disposed||h.state!=='ready'||h.epoch!==epoch||p.released||!isCurrent())throw abort('Native corner result became stale before delivery');return result;})(),dispose:async()=>{job.cancel();if(promise)await promise.catch(()=>{});else await cleanup();}};
  const onAbort=()=>job.cancel();signal?.addEventListener('abort',onAbort,{once:true});h.jobs.add(job);this.jobs.add(job);
  const capture=async(source,prepared=null)=>{const info=validatePacket(source),shape=dispatchShape(info.occurrenceCount,this.device.limits.maxComputeWorkgroupsPerDimension),buffer=output(info.occurrenceCount*16,'Frame native corner clips',16);
   const pos=prepared?.positions??storage(source.positions,'Frame corner source positions'),mat=prepared?.matrices??storage(source.clipMatrices,'Frame corner source clip matrices'),params=uniform(new Uint32Array([info.vertexCount,info.instanceCount,info.occurrenceCount,shape.rowWidth]),'Frame corner clip parameters');
   dispatch(this.clipPipeline,[pos,mat,buffer,params],info.occurrenceCount);check();return {buffer,packet:source};
  };
  const run=async()=>{
   check();for(const source of occluderPackets)validatePacket(source);
   const target=await capture(packet,p),count=p.occurrenceCount,shape=dispatchShape(count,this.device.limits.maxComputeWorkgroupsPerDimension),maskBuffer=output(count*4,'Frame admitted corner mask');
   const header=new ArrayBuffer(64);new Float32Array(header).set([...opts.viewport,...opts.rectangle]);new Uint32Array(header).set([p.vertexCount,p.instanceCount,count,shape.rowWidth,representatives?1:0,p.sourceVertexCount,0,0],8);
   const admissionParams=uniform(new Uint8Array(header),'Frame native corner rectangle'),reps=representatives?storage(representatives,'Frame logical corner representatives'):p.representatives;
   dispatch(this.admissionPipeline,[target.buffer,reps,maskBuffer,admissionParams],count);const admitted=new Uint32Array(await read(maskBuffer,count*4));check();
   // At most one bounded worker scene. Match private byte snapshots, including
   // in-place mutations, matrix bits, surface order, indices and representatives.
   const retained=this.sceneCache;let scene;
   if(retained?.worker===worker&&cornerSceneMatches(retained.key,packet,occluderPackets,representatives)){
    scene=retained.scene;this.sceneCacheStats.hits++;
   }else{
    this.sceneCache=null;
    if(retained?.worker===worker){await worker.call('clear');check();}
    const budget=cornerCacheBudget(packet,occluderPackets,representatives);
    const key=budget.cacheable?{target:copyCornerPacket(packet),occluders:occluderPackets.map(copyCornerPacket),representatives:representatives?.slice()??null}:null;
    // Transferred worker copies remain separate from the retained comparison key.
    const workCaptures=occluderPackets.map(c=>({packet:copyCornerPacket(c)})),targetPacket=copyCornerPacket(packet),workerReps=representatives?.slice()??null;
    const transferPacket=c=>[c.positions.buffer,c.clipMatrices.buffer,...(c.indices?[c.indices.buffer]:[])];
    const transfers=[...workCaptures.flatMap(c=>transferPacket(c.packet)),...transferPacket(targetPacket),...(workerReps?[workerReps.buffer]:[])];
    scene=await worker.call('build',{captures:workCaptures,targetPacket,representatives:workerReps},transfers);check();this.sceneCacheStats.builds++;
    if(key)this.sceneCache={worker,key,scene,budget};
   }
   // Rectangle admission is query-local. Never erase a retained full-scene point.
   const points=scene.points.slice();for(let i=0;i<count;i++)if(!admitted[i])points.set([1,1,-1,-1],i*4);
   const nb=storage(scene.nodeBounds,'Frame corner BVH bounds',16),nm=storage(scene.nodeMeta,'Frame corner BVH metadata',16),order=storage(scene.order,'Frame corner triangle order'),tb=storage(scene.triangleBounds,'Frame corner triangle bounds',16),qb=storage(points,'Frame exact corner bounds',16),countsBuffer=output(count*4,'Frame corner candidate counts'),dummy=storage(new Uint32Array(count+1),'Frame empty candidate offsets'),empty=output(4,'Frame empty candidate IDs');
   const cp=uniform(new Uint32Array([scene.nodeCount,count,shape.rowWidth,0]),'Frame corner count parameters');dispatch(this.candidatesPipeline,[nb,nm,order,tb,qb,countsBuffer,dummy,empty,cp],count);
   const counts=new Uint32Array(await read(countsBuffer,count*4)),offsets=new Uint32Array(count+1);let total=0;
   for(let i=0;i<count;i++){total+=counts[i];if(total>0xffffffff||total*4>this.device.limits.maxStorageBufferBindingSize)fail('Corner candidates exceed native buffer limit; explicit batching required');offsets[i+1]=total;}
   const offsetsBuffer=storage(offsets,'Frame candidate offsets'),idsBuffer=output(total*4,'Frame native corner candidate IDs'),wp=uniform(new Uint32Array([scene.nodeCount,count,shape.rowWidth,1]),'Frame corner emit parameters');
   dispatch(this.candidatesPipeline,[nb,nm,order,tb,qb,countsBuffer,offsetsBuffer,idsBuffer,wp],count);const candidateIds=new Uint32Array(await read(idsBuffer,total*4));check();
   const refined=await worker.call('refine',{admitted,vertexCount:p.vertexCount,instanceCount:p.instanceCount,offsets,candidates:candidateIds},[admitted.buffer,offsets.buffer,candidateIds.buffer]);check();
   this.device.queue.writeBuffer(maskBuffer,0,refined.vertices);
   const ecount=p.elementCount*p.instanceCount,elementBuffer=output(ecount*4,'Frame exact all-corner elements');
   if(ecount){const es=dispatchShape(ecount,this.device.limits.maxComputeWorkgroupsPerDimension),ep=uniform(new Uint32Array([p.vertexCount,p.elementCount,ecount,es.rowWidth]),'Frame existing all-corner parameters');dispatch(h.elementPipeline,[maskBuffer,p.offsets,p.elements,elementBuffer,ep],ecount);}
   const elements=new Uint32Array(await read(elementBuffer,ecount*4));check();
   check();return {vertices:refined.vertices,elements,epoch,instanceCount:p.instanceCount,vertexCount:p.vertexCount,elementCount:p.elementCount,cornerEvidence:{candidateCount:total,tests:refined.tests,contactVertices:refined.contactVertices}};
  };
  return job;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.sceneCache=null;for(const job of this.jobs){job.cancel();job.dispose();}this.worker?.dispose();this.worker=null;}
}
