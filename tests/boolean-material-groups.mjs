import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function installBooleanMaterials('),end=html.indexOf('    async function evaluateBoolean(',start);
assert(start>=0&&end>start);
const mesh={hashId:'result'},copy={replicaSource:mesh},other={},sets=new Map(),released=[];
const env={scene:{meshes:[mesh,copy,other]},polygonResources:sets,renderer:{device:{queue:{
 writeBuffer(buffer,offset,words){assert.equal(offset,0);buffer.words=words.slice();}
}}},GPUBufferUsage:{STORAGE:1,COPY_SRC:2,COPY_DST:4},FrameHash:{newId:()=>String(++serial)},
 makeGPUBuffer:(_device,descriptor)=>({size:descriptor.size}),setPolygonRecord(mask,buffer,byteLength){sets.set(mask,{resource:buffer,byteLength});},
 releaseGPU:buffer=>released.push(buffer),appearanceRevision:0,refreshMaterialOwners:rows=>assert.deepEqual(rows,[mesh,copy]),draw(){}};
let serial=0;
const install=Function('env',`with(env){${html.slice(start,end)};return installBooleanMaterials;}`)(env);
const registry=[null,...Array.from({length:173},(_,i)=>'material-'+i)];
for(const count of [0,1,31,32,33,11349,0]){
 const prior=[...sets.values()].map(s=>s.resource),before=released.length;
 const faces=Uint16Array.from({length:count},(_,i)=>i%9?(35+i*73)%182:0),result={faceMaterials:faces,report:{}};
 install({nativeHash:'result'},result,registry);
 assert.deepEqual(released.slice(before),prior);
 const tags=mesh.booleanMaterialTags,ids=[...new Set(faces)].filter(id=>registry[id]);
 assert.deepEqual(tags.map(t=>t.materialUID),ids.map(id=>registry[id]));
 for(const [i,id] of ids.entries()){
  const record=sets.get(tags[i].mask),expected=new Uint32Array(Math.ceil(count/32));
  for(const [f,value] of faces.entries())if(value===id)expected[f>>>5]|=1<<(f&31);
  assert.equal(record.generatedOwner,mesh);assert.equal(record.byteLength,Math.ceil(count/8));
  assert.deepEqual(record.resource.words,expected);
 }
 const histogram=registry.slice(1).map((uid,i)=>({uid,triangles:faces.reduce((n,x)=>n+(x===i+1),0)})).filter(m=>m.triangles);
 assert.deepEqual(result.report.materials,histogram);
}
console.log('Boolean material coverage, mask order, histogram and retirement match exhaustive face scans.');
