import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function meshRenderGroupCacheChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],details=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const start=html.indexOf('    function meshRenderGroups(gpu,mesh){'),end=html.indexOf('    function releaseBorrowed(',start),source=html.slice(start,end),poseAt=html.indexOf('    function poseUniform(gpu,mesh){'),poseEnd=html.indexOf('    function writePoseUniform(',poseAt),poseSource=html.slice(poseAt,poseEnd);assert.ok(start>0&&end>start&&poseAt>0&&poseEnd>poseAt);
  let sequence=0;const resource=()=>({id:++sequence}),pipeline=()=>({getBindGroupLayout:index=>({index,id:++sequence})});
  function fixture(){
   const calls={groups:0,poses:0,writes:[],allocations:0,throwAt:Infinity},device={queue:{writeBuffer:(buffer,offset,value)=>calls.writes.push({buffer,offset,data:[...new Uint32Array(value.buffer,value.byteOffset,value.byteLength/4)]})},createBindGroup:descriptor=>{calls.groups++;if(calls.groups===calls.throwAt)throw Error('injected bind group failure');return {...resource(),descriptor};}},gpu={device,pipeline:pipeline(),edgePipeline:pipeline(),dummyBuffer:resource(),dummyReadBuffer:resource(),dummyTexture:{view:resource()},meshModePaged:resource(),meshModeBuffer:resource()},allocate=(_gpu,mesh)=>(label,size,usage)=>{calls.allocations++;const buffer={...resource(),label,size,usage};mesh.buffers.push(buffer);return buffer;},env={GPUBufferUsage:{UNIFORM:1,COPY_DST:2},makeGPUBuffer:(_d,descriptor)=>{calls.allocations++;return {...resource(),...descriptor};},meshAllocator:allocate,FM:{I:()=>new Float64Array(16)},writePoseUniform:(mesh,frame)=>{calls.poses++;mesh.poseWritten=frame;}},run=Function(...Object.keys(env),poseSource+source+';return meshRenderGroups;')(...Object.values(env)),mesh=(paged=false)=>({gpu,paged,buffers:[],faceBase:0,positions:paged?{view:resource()}:resource(),indices:resource(),normals:resource(),renderIndices:resource(),connected:{flags:resource()}});
   return {calls,gpu,mesh,run};
  }
  check('Ten thousand initial owners create one shading/edge pair each and repeated publication creates none',()=>{
   const {calls,gpu,mesh,run}=fixture(),rows=Array.from({length:10000},()=>mesh()),before=performance.now();for(const row of rows)run(gpu,row);assert.equal(calls.groups,20000);const writes=calls.writes.length,allocations=calls.allocations;for(let repeat=0;repeat<4;repeat++)for(const row of rows)run(gpu,row);assert.equal(calls.groups,20000);assert.equal(calls.writes.length,writes);assert.equal(calls.allocations,allocations);details.push({owners:rows.length,initialGroups:20000,unchangedCalls:40000,newGroups:0,ms:performance.now()-before});
  });
  check('Face-ID content updates remain visible through stable uniform bindings without creating groups',()=>{
   const {calls,gpu,mesh,run}=fixture(),row=mesh();run(gpu,row);const shading=row.shadingBindGroup,edge=row.edgeBindGroup,id=row.drawIds.get(0);row.faceBase=123;for(const [start,b]of row.drawIds)gpu.device.queue.writeBuffer(b,0,new Uint32Array([row.faceBase+start+1,start,0,0]));run(gpu,row);assert.equal(calls.groups,2);assert.equal(row.shadingBindGroup,shading);assert.equal(row.edgeBindGroup,edge);assert.equal(shading.descriptor.entries.find(e=>e.binding===8).resource.buffer,id);assert.deepEqual(calls.writes.at(-1),{buffer:id,offset:0,data:[124,0,0,0]});
  });
  check('Every effective buffer, texture, mode, affine, wire, ID and pipeline replacement rebuilds both groups',()=>{
   const changes=[(g,m)=>m.positions=resource(),(g,m)=>m.indices=resource(),(g,m)=>m.normals=resource(),(g,m)=>m.connected.flags=resource(),(g,m)=>m.renderIndices=resource(),(g,m)=>g.dummyTexture.view=resource(),(g,m)=>g.meshModeBuffer=resource(),(g,m)=>m.objectFrame=resource(),(g,m)=>m.splineWireEdges=resource(),(g,m)=>m.drawIds.set(0,resource()),(g,m)=>g.pipeline=pipeline(),(g,m)=>g.edgePipeline=pipeline(),(g,m)=>g.device={...g.device}];
   for(const change of changes){const {calls,gpu,mesh,run}=fixture(),row=mesh();run(gpu,row);change(gpu,row);run(gpu,row);assert.equal(calls.groups,4);run(gpu,row);assert.equal(calls.groups,4);}
  });
  check('Default wire fallback and external shading/edge-group replacements invalidate cached bindings',()=>{
   const changes=[(g,m)=>g.dummyReadBuffer=resource(),(g,m)=>m.shadingBindGroup=resource(),(g,m)=>m.edgeBindGroup=resource(),(g,m)=>{m.splineWireEdges=resource();}];for(const change of changes){const {calls,gpu,mesh,run}=fixture(),row=mesh();run(gpu,row);change(gpu,row);run(gpu,row);assert.equal(calls.groups,4);}const f=fixture(),row=f.mesh();row.splineWireEdges=resource();f.run(f.gpu,row);row.splineWireEdges=null;f.run(f.gpu,row);assert.equal(f.calls.groups,4);
  });
  check('Paged parts bind effective texture resources and independently refresh changed parts',()=>{
   const {calls,gpu,mesh,run}=fixture(),row=mesh(true);row.parts=[{faceStart:0,normals:resource(),renderIndices:resource()},{faceStart:20,normals:resource(),renderIndices:resource()}];run(gpu,row);assert.equal(calls.groups,4);const other=row.parts[1].shadingBindGroup;row.parts[0].normals=resource();run(gpu,row);assert.equal(calls.groups,6);assert.equal(row.parts[1].shadingBindGroup,other);row.indices=resource();run(gpu,row);assert.equal(calls.groups,6,'paged index texture is not a shading binding');for(const change of [()=>row.positions.view=resource(),()=>gpu.dummyBuffer=resource(),()=>gpu.meshModePaged=resource()]){const n=calls.groups;change();run(gpu,row);assert.equal(calls.groups,n+4);}const entries=row.parts[0].shadingBindGroup.descriptor.entries;assert.equal(entries.find(e=>e.binding===0).resource.buffer,gpu.dummyBuffer);assert.equal(entries.find(e=>e.binding===2).resource.buffer,gpu.dummyBuffer);assert.equal(entries.find(e=>e.binding===6).resource,row.positions.view);
  });
  check('A new owner, COW mesh spread and copied parts never inherit an old owner binding certificate',()=>{
   const {calls,gpu,mesh,run}=fixture(),original=mesh();run(gpu,original);const clone={...original,buffers:[],objectFrame:null,drawIds:new Map(),connected:{flags:resource()}};run(gpu,clone);assert.equal(calls.groups,4);assert.notEqual(clone.shadingBindGroup,original.shadingBindGroup);assert.notEqual(clone.objectFrame,original.objectFrame);const part={faceStart:0,normals:resource(),renderIndices:resource()},a={...mesh(true),parts:[part]};run(gpu,a);const b={...a,buffers:[]};run(gpu,b);assert.equal(calls.groups,8,'the same part reused for another owner must rebind');const c={...b,parts:[{...part}]};run(gpu,c);assert.equal(calls.groups,10,'part spread must rebind');
  });
  check('Renderer identity is checked even if another renderer shares the same device and state map',()=>{
   const {calls,gpu,mesh,run}=fixture(),row=mesh();run(gpu,row);const other={...gpu};run(other,row);assert.equal(calls.groups,4);run(other,row);assert.equal(calls.groups,4);
  });
  check('A failed second construction publishes neither group nor certificate and retry rebuilds atomically',()=>{
   const {calls,gpu,mesh,run}=fixture(),row=mesh();run(gpu,row);const shading=row.shadingBindGroup,edge=row.edgeBindGroup;row.normals=resource();calls.throwAt=4;assert.throws(()=>run(gpu,row),/injected/);assert.equal(row.shadingBindGroup,shading);assert.equal(row.edgeBindGroup,edge);calls.throwAt=Infinity;run(gpu,row);assert.equal(calls.groups,6);assert.notEqual(row.shadingBindGroup,shading);assert.notEqual(row.edgeBindGroup,edge);run(gpu,row);assert.equal(calls.groups,6);const first=mesh();calls.throwAt=8;assert.throws(()=>run(gpu,first),/injected/);assert.equal(first.shadingBindGroup,undefined);assert.equal(first.edgeBindGroup,undefined);calls.throwAt=Infinity;run(gpu,first);assert.equal(calls.groups,10);
  });
  return {pass:true,native:false,checks,details};
 }catch(error){return {pass:false,native:false,checks,details,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const report=await meshRenderGroupCacheChecks();report.sourceSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/mesh-render-group-cache.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;}
