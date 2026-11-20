// Execute the owning batch collector with inert GPU records. Native pixel/shader
// qualification is provided separately by material-replica-batches-browser.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),start=html.indexOf('    function issueReplicaSurface('),end=html.indexOf('    function retireOrderedReplicas(',start);assert.ok(start>0&&end>start);
const source=html.slice(start,end),identity=()=>Float64Array.from([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function fixture(){
 const scene={meshes:[]},record={writes:[],draws:[],bindings:[],released:[]},state={pipeline:{},instances:{}},materialState={...state,material:true},library={group:{}},r={device:{queue:{writeBuffer(buffer,offset,data){buffer.data=new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice();record.writes.push(buffer);}},createBindGroup:descriptor=>descriptor}},pass={setPipeline(){},setBindGroup(...args){record.bindings.push(args);},setIndexBuffer(){},draw(count,instances){record.draws.push({count,instances,indexed:false});},drawIndexed(count,instances){record.draws.push({count,instances,indexed:true});}},options={safe:true,pending:false};
 const collect=Function('scene','viewIndex','frameCount','pluginSurfaceStyle','pluginSurfaceFilter','meshVisible','materialTransparent','materialMeshGPU','materialReplicaPipeline','replicaPipeline','replicaBatchOrderSafe','releaseGPU','meshAllocator','GPUBufferUsage','FM','polygonWire',source+';return drawReplicaBatches;')(scene,0,5,m=>m.style,m=>m.filter,m=>m.visible!==false,m=>m.transparent,(r,m)=>m.material,(r,m,a)=>options.pending?null:materialState,()=>options.pending?null:state,()=>options.safe,buffer=>{assert.ok(!buffer.dead);buffer.dead=true;record.released.push(buffer);},(r,owner)=>(label,size)=>{const buffer={label,size};owner.buffers.push(buffer);return buffer;},{STORAGE:1,COPY_DST:2},{determinant:()=>1},()=>false);
 const canonical={positions:{},indices:{},normals:{},renderIndices:{},connected:{flags:{}},splineWireEdges:{},buffers:[],shadingBindGroup:{},count:36,faceBase:0,materialTags:[],frameWorld:identity(),frameInverse:identity(),hashId:'source'};scene.meshes.push(canonical);
 const mesh=(id,{material=false,table,projection='identity',uv,geometry}={})=>{const m={...canonical,hashId:id,replicaMatrix:identity(),replicaSource:canonical,frameWorld:identity(),frameInverse:identity(),faceBase:scene.meshes.length*12,materialTags:material?[{materialUID:'paint'}]:[],mappingSignature:projection,materialTable:table||canonical.materialTable||{},...geometry?{positions:geometry}:{}};if(material)m.material={state:library,bindings:{grouped:false,uv,groups:new Map([[m,{group:{label:id}}]])}};scene.meshes.push(m);return m;};
 const run=(slot='scene')=>collect(r,pass,()=>true,slot),issue=drawn=>{for(const m of scene.meshes)drawn.draw(m);};
 return {scene,record,options,canonical,mesh,run,issue};
}

{
 const f=fixture(),a=f.mesh('a'),b=f.mesh('b'),drawn=f.run();assert.equal(drawn.size,2);assert.equal(f.record.draws.length,0,'collector never advances draws ahead of scene order');assert.equal(drawn.draw(b),false);assert.equal(drawn.draw(a),true);assert.deepEqual(f.record.draws,[{count:36,instances:2,indexed:true}]);const buffer=f.record.writes[0],words=new Uint32Array(buffer.data.buffer);assert.equal(words[30],a.faceBase+1);assert.equal(words[62],b.faceBase+1);
 const writes=f.record.writes.length;f.run();assert.equal(f.record.writes.length,writes,'steady frames retain affine buffer');b.splineHighlightActive=true;f.run();assert.equal(f.record.writes.length,writes+1);assert.equal(new Uint32Array(buffer.data.buffer)[63],1,'highlight flag belongs to this occurrence');
 b.frameWorld=identity();b.frameWorld[12]=17;f.run();assert.equal(new Float32Array(buffer.data.buffer)[44],17,'updated affine translation reaches second occurrence');
}
{
 const f=fixture(),table={},a=f.mesh('red-a',{material:true,table}),b=f.mesh('red-b',{material:true,table}),c=f.mesh('other projection',{material:true,table,projection:'other'}),d=f.mesh('other table',{material:true,table:{}});a.material.bindings.grouped=b.material.bindings.grouped=true;const drawn=f.run();assert.equal(drawn.size,2);f.issue(drawn);assert.deepEqual(f.record.draws,[{count:36,instances:2,indexed:false}],'masked materials retain corner draw addressing');assert.ok(f.record.bindings.some(([slot])=>slot===3),'instanced material binds group3 frames');assert.ok(!drawn.has(c)&&!drawn.has(d),'projection and compiled material buffers partition batches');
}
{
 const f=fixture(),table={},uv={},a=f.mesh('a',{material:true,table,uv}),b=f.mesh('b',{material:true,table,uv}),c=f.mesh('c',{material:true,table,uv:{}});const drawn=f.run();assert.equal(drawn.size,2);f.issue(drawn);assert.equal(f.record.draws[0].indexed,false,'imported UV addresses retain corner draw');assert.ok(!drawn.has(c));
}
{
 const f=fixture(),a=f.mesh('a'),b=f.mesh('b'),c=f.mesh('transparent'),d=f.mesh('filtered'),e=f.mesh('paged');c.transparent=true;d.filter={};e.paged=true;assert.equal(f.run().size,2);f.options.safe=false;assert.equal(f.run().size,0,'failed order certificate keeps native single draws');assert.equal(f.canonical.replicaBatches.size,0,'rejected group retires old affine records');assert.equal(f.record.released.length,1);
 f.options.safe=true;f.options.pending=true;assert.equal(f.run().size,0,'pending pipeline retains ordinary rendering');
}
{
 const f=fixture();f.mesh('a');f.mesh('b');f.run('scene');f.run('background');assert.equal(f.canonical.replicaBatches.size,2);f.scene.meshes[1].visible=false;f.run('scene');assert.equal(f.canonical.replicaBatches.size,1,'current slot cleanup retains live transform background');f.run('background');assert.equal(f.canonical.replicaBatches.size,0);assert.equal(f.record.released.length,2);
}
{
 const f=fixture(),a=f.mesh('a'),b=f.mesh('b');b.connected={flags:{}};assert.equal(f.run().size,0,'different component selection buffers never share a draw');b.connected=a.connected;b.normals={};assert.equal(f.run().size,0,'stale shading publication does not enter source batch');
}
assert.ok(html.includes('[0,3,4,5,10,11,13].map(binding=>'),'material mesh reserves seven vertex storage bindings plus one instance array');
const shader=html.slice(html.indexOf('        const shaderSource = `'),html.indexOf('    function clearFeatureDraws('));assert.equal((shader.match(/logicalIndices/g)||[]).length,1,'removed material binding2 is only an unused shared shader declaration');
console.log('PASS: material replica grouping, first-occurrence draw order, affine/face/highlight flags, UV/mask addressing, exclusions, publication resources and bounded slot retirement (CPU only)');
