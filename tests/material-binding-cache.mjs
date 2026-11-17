// CPU regression over the owning runtime functions. GPU resources below only
// record writes/copies/bindings; this test makes no native GPU timing claim.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function fixture(html){
 const extract=(name,next)=>{const start=html.indexOf('    function '+name+'('),end=html.indexOf('    function '+next+'(',start);assert.ok(start>=0&&end>start,'owning '+name+' source exists');return html.slice(start,end);};
 const FM=Function('return '+html.slice(html.indexOf('const FM=')+9,html.indexOf('\n    })();',html.indexOf('const FM='))+11))();
 const counters={libraryScans:0,libraryReads:0,projectionBuilds:0,allocations:0,groups:0,writes:0,copies:0,releases:0};
 const allocations=[],projections=new Map(),sets=new Map(),state={meshLayout:{}},scene={records:new Map()},FrameHash={K:{materials:'library'}},GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4};
 const allocate=(label,size=64)=>{const b={label,size,bytes:new Uint8Array(size),destroyed:false};allocations.push(b);counters.allocations++;return b;};
 const sourceBytes=(data,offset=0,length)=>ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset+(offset||0)*data.BYTES_PER_ELEMENT,(length??data.length)*data.BYTES_PER_ELEMENT):new Uint8Array(data,offset,length);
 const r={dummyBuffer:allocate('dummy'),dummyReadBuffer:allocate('dummy read'),dummyTexture:{view:{}},meshModePaged:allocate('paged mode'),meshModeBuffer:allocate('buffer mode')};
 r.device={queue:{writeBuffer(buffer,offset,data,dataOffset,size){assert.ok(!buffer.destroyed);buffer.bytes.set(sourceBytes(data,dataOffset,size),offset);counters.writes++;},submit(commands){for(const command of commands)for(const copy of command){const [from,a,to,b,size]=copy;assert.ok(!from.destroyed&&!to.destroyed);to.bytes.set(from.bytes.subarray(a,a+size),b);counters.copies++;}}},createCommandEncoder(){const commands=[];return {copyBufferToBuffer(...args){commands.push(args);},finish(){return commands;}};},createBindGroup(descriptor){counters.groups++;return descriptor;}};
 const releaseGPU=b=>{if(b){assert.ok(!b.destroyed,'resource releases exactly once');b.destroyed=true;counters.releases++;}};
 const nativeValue=(hash,field)=>field==='projection'?projections.get(hash):undefined;
 const scopeAt=html.indexOf('    let renderMaterialCache='),scope=html.slice(scopeAt,html.indexOf('    function appearanceId(',scopeAt));assert.ok(scopeAt>0&&scope.includes('function currentRenderMaterialCache('));
 const source=scope+'\n'+extract('projectionMatrix','projectionOwner').replace('function projectionMatrix(','function nativeProjectionMatrix(')+'\nfunction projectionMatrix(mesh){counters.projectionBuilds++;return nativeProjectionMatrix(mesh);}\n'+extract('releaseMaterialTable','releaseMaterialState');
 const api=Function('scene','FrameHash','materialLibraryGPU','ensureImportedUV','localMeshBox','polygonSet','makeGPUBuffer','releaseGPU','GPUBufferUsage','nativeValue','FM','meshAllocator','counters','renderer',source+';return {materialMeshGPU,releaseMaterialTable,projectionMatrix,withRenderMaterials,invalidateRenderMaterials,currentRenderMaterialCache};')(scene,FrameHash,()=>{counters.materialCalls=(counters.materialCalls||0)+1;return state;},mesh=>mesh.uv,mesh=>mesh.box,id=>sets.get(id),(device,descriptor)=>allocate(descriptor.label,descriptor.size),releaseGPU,GPUBufferUsage,nativeValue,FM,()=>allocate,counters,r);
 const library=ids=>{const value=new Proxy([...ids],{get(target,key,receiver){if(key==='map'||key==='join')counters.libraryScans++;if(typeof key==='string'&&/^\d+$/.test(key))counters.libraryReads++;return Reflect.get(target,key,receiver);}});scene.records.set('library',{value});return value;};
 const mesh=(hash='source',source=null)=>({hashId:hash,materialTags:[{materialUID:'a'}],appearanceKey:'base:a',positions:source?.positions||allocate(hash+' positions'),indices:source?.indices||allocate(hash+' indices'),normals:allocate(hash+' normals'),connected:{flags:allocate(hash+' flags')},renderIndices:allocate(hash+' render indices'),shadingBindGroup:{},drawIds:new Map([[0,allocate(hash+' draw IDs')]]),objectFrame:allocate(hash+' frame'),box:{min:[-2,-3,-4],max:[8,17,26]},triangleCount:24,...source?{replicaSource:source}:{}});
 const mask=(token,words=[0x5,0xa],byteLength=words.length*4)=>{const resource=allocate(token,words.length*4);resource.bytes.set(new Uint8Array(Uint32Array.from(words).buffer));const set={token,resource,count:words.length,byteLength};sets.set(token,set);return set;};
 const words=mesh=>new Uint32Array(mesh.materialTable.bytes.buffer),floats=mesh=>new Float32Array(mesh.materialTable.bytes.buffer),binding=(mesh,index,part=mesh)=>mesh.materialBindings.groups.get(part).group.entries.find(e=>e.binding===index).resource;
 const invoke=mesh=>api.materialMeshGPU(r,mesh);
 return {api,r,state,scene,counters,allocations,projections,sets,allocate,library,mesh,mask,words,floats,binding,invoke,FM};
}
export {fixture as materialBindingFixture};

export async function materialBindingCacheChecks(root=new URL('../',import.meta.url)){
 const html=await readFile(new URL('index.html',root),'utf8'),checks=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 check('Material reorder, insertion, deletion and missing references use current library indices',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a','b']);f.invoke(m);assert.equal(f.words(m)[0],1);const first=m.materialTable;
  f.library(['b','a']);f.invoke(m);assert.equal(f.words(m)[0],2);assert.ok(first.destroyed);
  f.library(['new','b','a']);f.invoke(m);assert.equal(f.words(m)[0],3);
  f.library(['b']);f.invoke(m);assert.equal(f.words(m)[0],0,'deleted reference resolves Default');
  f.library(['b','a']);f.invoke(m);assert.equal(f.words(m)[0],2,'restored library reference resolves again');
 });
 check('Fresh native library records with unchanged ordering retain every compiled table and binding',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a','b']);f.invoke(m);const table=m.materialTable,bindings=m.materialBindings,before={...f.counters};for(let i=0;i<1000;i++){f.library(['a','b']);f.invoke(m);}assert.equal(m.materialTable,table);assert.equal(m.materialBindings,bindings);assert.equal(f.counters.allocations,before.allocations);assert.equal(f.counters.groups,before.groups);assert.equal(f.counters.writes,before.writes);assert.equal(f.counters.releases,before.releases);
 });
 check('Library parameter writes reuse GPU bindings while buffer, atlas, sampler and layout replacements rebind exactly',()=>{
  const start=html.indexOf('    function materialLibraryBindings('),end=html.indexOf('    function materialLibraryGPU(',start);assert(start>=0&&end>start);const bind=Function(html.slice(start,end)+';return materialLibraryBindings;')();let groups=0,views=0;const atlas=()=>({createView:options=>({id:++views,options})}),r={device:{createBindGroup:descriptor=>{groups++;return descriptor;}}},state={data:{},atlas:atlas(),sampler:{},libraryLayout:{}};const first=bind(r,state);for(let i=0;i<10000;i++)assert.equal(bind(r,state),first);assert.equal(groups,1);assert.equal(views,2);for(const field of ['data','atlas','sampler','libraryLayout']){state[field]=field==='atlas'?atlas():{};const next=bind(r,state);assert.notEqual(next,first);assert.equal(next.entries[0].resource.buffer,state.data);assert.equal(next.entries[2].resource,state.sampler);assert.equal(next.layout,state.libraryLayout);}assert.equal(groups,5);
 });
 check('Rightmost whole-material tag resets earlier masks and later masks retain exact copied bits',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a','b','c']);f.mask('earlier',[0xffffffff]);f.mask('later',[0x105,0x20]);
  m.materialTags=[{materialUID:'a'},{materialUID:'b',mask:'earlier'},{materialUID:'c'},{materialUID:'a',mask:'later'},{materialUID:'b',mask:'missing'}];m.appearanceKey='precedence';f.invoke(m);
  const w=f.words(m);assert.equal(w[0],3);assert.equal(w[1],1);assert.equal(w[16],1);assert.equal(w[17],20);assert.equal(w[18],24,'mask range is clipped to actual mesh triangles');assert.deepEqual([...w.slice(20,22)],[0x105,0x20]);assert.equal(m.materialBindings.grouped,true);
  m.materialTags=[{materialUID:'b'}];m.appearanceKey='whole:b';f.invoke(m);assert.equal(f.words(m)[0],2);assert.equal(f.words(m)[1],0);assert.equal(m.materialBindings.grouped,false);
 });
 check('New appearance/mask and native shading bind-group revisions refresh bindings',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a','b']);f.mask('mask-one',[1]);m.materialTags=[{materialUID:'a'},{materialUID:'b',mask:'mask-one'}];m.appearanceKey='masked:one';f.invoke(m);const before=m.materialTable,group=m.materialBindings.groups.get(m).group;
  f.mask('mask-two',[2]);m.materialTags=[{materialUID:'a'},{materialUID:'b',mask:'mask-two'}];m.appearanceKey='masked:two';f.invoke(m);assert.ok(before.destroyed);assert.equal(f.words(m).at(-1),2);assert.notEqual(m.materialBindings.groups.get(m).group,group);
  const table=m.materialTable,groups=f.counters.groups;m.shadingBindGroup={};f.invoke(m);assert.equal(m.materialTable,table);assert.equal(f.counters.groups,groups+1);
 });
 check('UV replacement, geometry replacement and paged parts bind current native resources',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a']);m.uv={resource:f.allocate('UV one')};f.invoke(m);assert.equal(f.binding(m,11).buffer,m.uv.resource);
  const old=m.materialBindings;m.uv={resource:f.allocate('UV two')};f.invoke(m);assert.notEqual(m.materialBindings,old);assert.equal(f.binding(m,11).buffer,m.uv.resource);
  m.positions=f.allocate('replacement positions');f.invoke(m);assert.equal(f.binding(m,0).buffer,m.positions);
  delete m.uv;f.invoke(m);assert.equal(f.binding(m,11).buffer,f.r.dummyReadBuffer);
  const p=f.mesh('paged');p.paged=true;p.positions={view:{identity:'paged geometry'}};p.parts=[{faceStart:0,normals:f.allocate('part normals'),renderIndices:f.allocate('part indices'),shadingBindGroup:{}}];f.invoke(p);assert.equal(f.binding(p,0,p.parts[0]).buffer,f.r.dummyBuffer);assert.equal(f.binding(p,6,p.parts[0]),p.positions.view);assert.equal(f.binding(p,3,p.parts[0]).buffer,p.parts[0].normals);
 });
 check('In-place bounds updates and replaced native projection records refresh exact mapping uniforms',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a']);f.invoke(m);const initialBuilds=f.counters.projectionBuilds,uniform=m.mappingUniform,original=new Float32Array(uniform.bytes.buffer).slice();
  m.box.min[0]=-12;m.box.max[1]=37;f.invoke(m);assert.deepEqual([...f.floats(m).slice(4,7)],[-12,-3,-4]);assert.equal(f.counters.projectionBuilds,initialBuilds+1);assert.notDeepEqual(new Float32Array(uniform.bytes.buffer),original);
  const custom=f.FM.I();custom[0]=4;custom[5]=5;custom[10]=6;custom[12]=12;f.projections.set(m.hashId,Array.from(f.FM.pack(custom)));f.invoke(m);assert.equal(m.mappingUniform,uniform);assert.deepEqual([...new Float32Array(uniform.bytes.buffer).slice(0,16)],[...Float32Array.from(f.FM.inv(custom))]);
  const writes=f.counters.writes;m.box.max[2]+=5;f.invoke(m);assert.equal(f.counters.writes,writes+1,'bounds update rebuilds tags but leaves explicitly authored projection unchanged');
  const changed=f.FM.I();changed[12]=7;f.projections.set(m.hashId,Array.from(f.FM.pack(changed)));f.invoke(m);assert.equal(new Float32Array(uniform.bytes.buffer)[12],-7);
  f.projections.delete(m.hashId);f.invoke(m);assert.notEqual(new Float32Array(uniform.bytes.buffer)[12],-7,'removing authored projection restores measured default');
 });
 check('Source and nested replicas share tables, release only at the last user and leave no unused pool entries',()=>{
  const f=fixture(html),source=f.mesh(),copy=f.mesh('copy',source),nested=f.mesh('nested',copy);f.library(['a','b']);f.invoke(source);f.invoke(copy);f.invoke(nested);const table=source.materialTable,entry=source.materialTableEntry;assert.equal(copy.materialTable,table);assert.equal(nested.materialTable,table);assert.equal(entry.users.size,3);assert.equal(source.materialTables.size,1);
  f.api.releaseMaterialTable(copy);assert.equal(entry.users.size,2);assert.equal(table.destroyed,false);assert.equal(copy.materialTable,null);
  nested.materialTags=[{materialUID:'b'}];nested.appearanceKey='base:b';f.invoke(nested);assert.equal(source.materialTables.size,2);assert.notEqual(nested.materialTable,table);
  f.api.releaseMaterialTable(source);assert.ok(table.destroyed);assert.equal(source.materialTables.size,1);const second=nested.materialTable;f.api.releaseMaterialTable(nested);assert.ok(second.destroyed);assert.equal(source.materialTables.size,0);
  f.api.releaseMaterialTable(nested);assert.equal(source.materialTables.size,0,'repeated release is harmless');
 });
 check('Removing material tags releases the compiled table and returns the ordinary material path',()=>{
  const f=fixture(html),m=f.mesh();f.library(['a']);f.invoke(m);const table=m.materialTable;m.materialTags=[];assert.equal(f.invoke(m),null);assert.ok(table.destroyed);assert.equal(m.materialTableEntry,null);assert.equal(m.materialTables.size,0);
 });
 check('10000 unchanged mesh lookups perform no library scans, projection serialization, GPU allocations or writes',()=>{
  const f=fixture(html);f.library(Array.from({length:128},(_,i)=>i?'material-'+i:'a'));const m=f.mesh();f.invoke(m);const before={...f.counters},entry=m.materialTableEntry,bindings=m.materialBindings;
  for(let i=0;i<10000;i++){const result=f.invoke(m);assert.equal(result.bindings,bindings);}
  assert.equal(m.materialTableEntry,entry);for(const key of ['libraryScans','libraryReads','projectionBuilds','allocations','groups','writes','copies','releases'])assert.equal(f.counters[key],before[key],key+' remains bounded after warmup');
 });
 check('128-material index table is compiled once across 100 distinct appearances and reused by later source lookups',()=>{
  const f=fixture(html);f.library(Array.from({length:128},(_,i)=>'material-'+i));const meshes=Array.from({length:100},(_,i)=>{const m=f.mesh('mesh-'+i);m.materialTags=[{materialUID:'material-'+i}];m.appearanceKey='material-'+i;return m;});
  meshes.forEach(f.invoke);assert.equal(f.counters.libraryScans,2,'one index map scan and one key serialization per library revision');assert.equal(f.counters.libraryReads,256);
  f.library(['material-99',...Array.from({length:99},(_,i)=>'material-'+i)]);const scans=f.counters.libraryScans;meshes.forEach(f.invoke);assert.equal(f.counters.libraryScans-scans,2,'library reorder rebuilds shared indices once');assert.equal(f.words(meshes[99])[0],1);assert.equal(f.words(meshes[0])[0],2);
 });
 return {pass:true,native:false,sourceSHA256:createHash('sha256').update(html).digest('hex'),checks};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const result=await materialBindingCacheChecks();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/material-binding-cache.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}catch(error){console.error(error.stack);process.exitCode=1;}
}
