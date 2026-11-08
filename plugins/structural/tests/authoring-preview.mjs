import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate} from '../plugin.js';
import {isHardwareAdapter,isDecodedNativeIcon,hasBoundedFrameTimings} from './browser-gates.mjs';
const root=new URL('../../../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const core=await readFile(new URL('index.html',root),'utf8');
async function fixture(){
 const nodes=[{nativeHash:'a'.repeat(32),type:'structural',params:{'Voxel size':1,'Material (%)':30,Displacement:1}}];
 let operations,attributes,viewport,deviceReads=0;
 const context={version:1,document:{nodes},get device(){deviceReads++;throw Error('No numerical device');},scene:{capture(){throw Error('No geometry capture');}},operations:{register:v=>operations=v},attributes:{register:v=>attributes=v},viewport:{register:async v=>viewport=v}};
 await activate(context);return {nodes,operations,attributes,viewport,get deviceReads(){return deviceReads;},command:(id,args={},hash=nodes[0].nativeHash)=>operations.find(o=>o.id===id).run(hash,args)};
}
test('manifest only declares supported native authoring and two explicit fieldless markers',async()=>{
 assert.equal(manifest.id,'structural');assert.deepEqual(manifest.objects.map(o=>o.type),['structural']);
 assert.deepEqual(manifest.tags.map(t=>t.kind),['structural_fixture','structural_preserve']);
 for(const t of manifest.tags){assert.equal(t.fields,undefined);assert.equal(t.multiple,undefined);assert.equal(t.inherit,undefined);}
 assert.deepEqual(Object.keys(manifest.objects[0].fields),['Voxel size','Material (%)','Displacement']);
 assert.equal(manifest.assets,undefined);const catalogue=JSON.parse(await readFile(new URL('plugins/index.json',root),'utf8'));assert.equal(catalogue.filter(s=>s==='structural/plugin.json').length,1);
});
test('shared native field validators execute the declared Structural bounds before mutation',()=>{
 const source=core.slice(core.indexOf('const FrameParameters=(()=>{'),core.indexOf('const FrameFields=',core.indexOf('const FrameParameters=(()=>{')));
 const body=source.slice(0,source.indexOf('\n})();')+6);
 const definitions={structural:['Structural','plugin:structural',manifest.objects[0].fields]};
 const P=new Function('definitions','FramePlugins','FrameAuthorData',body+';return FrameParameters;')(definitions,{owner:()=>({manifest})},{error:m=>{throw Error(m);}});
 P.validateOptions(manifest.objects[0].fields,manifest.objects[0].fieldOptions);
 for(const [key,value]of [['Voxel size',0],['Material (%)',0],['Material (%)',101],['Displacement',-1],['Voxel size',NaN],['Displacement',Infinity]])assert.throws(()=>P.validate('structural',{[key]:value}));
 for(const patch of [{'Voxel size':.000001},{'Material (%)':100},{Displacement:0}])assert.deepEqual(P.validate('structural',patch),patch);
});
test('activation and status remain resource-free and explicit; no pretend result or Solve UI',async()=>{
 const f=await fixture();assert.equal(f.deviceReads,0);assert.equal(f.viewport.render,undefined);assert.equal(f.viewport.retire,undefined);
 assert.deepEqual(f.attributes(f.nodes[0].nativeHash).actions,[{id:'status',label:'Under construction',disabled:true}]);
 const start=performance.now();for(let i=0;i<256;i++)f.command('status');const ms=performance.now()-start;assert.ok(ms<1000);console.log(JSON.stringify({operation:'256 detached status reads',ms,budgetMs:1000,hardwareVerified:false}));const s=f.command('status');assert.equal(s.authoringOnly,true);assert.equal(s.parameterTagsAvailable,false);assert.equal(s.state,'under-construction');
 for(const k of ['numericalAvailable','sceneSolved','voxelizationAvailable','optimizationAvailable','resultAvailable'])assert.equal(s[k],false);
 for(const k of ['stress','safetyFactor','displacement','density','voxels'])assert.equal(k in s,false);
 assert.throws(()=>f.command('status',{},'missing'),e=>e.code==='INVALID_OWNER');
});
test('native helper is exactly twelve edges in a 100 mm box without duplicate dimension state',async()=>{
 const f=await fixture();assert.deepEqual(f.viewport.bounds,{min:[-50,-50,-50],max:[50,50,50]});assert.equal(f.viewport.lines.length,72);
 const edges=new Set();for(let i=0;i<72;i+=6){const a=Array.from(f.viewport.lines.slice(i,i+3)),b=Array.from(f.viewport.lines.slice(i+3,i+6));assert.equal(a.filter((x,k)=>x!==b[k]).length,1);assert.ok([...a,...b].every(v=>Math.abs(v)===50));edges.add(JSON.stringify([a,b].sort()));}assert.equal(edges.size,12);
 assert.deepEqual(f.viewport.settings({}),[0,0,0,0]);assert.match(f.viewport.shader,/discard/);
});
test('all numerical endpoint calls reject before device access or authoring mutation within a completed-call budget',async()=>{
 const f=await fixture(),before=JSON.stringify(f.nodes),start=performance.now();
 for(let i=0;i<32;i++)for(const id of ['show-voxels','solve-frame','solve-animation','optimize-frame','optimize-animation','result-object']){
  const op=f.operations.find(o=>o.id===id);assert.equal(op.readOnly,true);assert.throws(()=>f.command(id,{untrusted:true}),e=>e.code==='STRUCTURAL_AUTHORING_ONLY');
 }
 const ms=performance.now()-start;assert.ok(ms<1000);assert.equal(JSON.stringify(f.nodes),before);assert.equal(f.deviceReads,0);console.log(JSON.stringify({operation:'192 rejection-only calls',ms,budgetMs:1000,hardwareVerified:false}));
});
test('no unqualified prototype module, worker or numerical resource can enter the installed closure',async()=>{
 const source=await readFile(new URL('../plugin.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\bimport\b|createBuffer|createTexture|createComputePipeline|requestAdapter|navigator\.gpu|scene\.capture|new Worker|new Map/);
 const svg=await readFile(new URL('../icon.svg',import.meta.url),'utf8');assert.match(svg,/width="32" height="32" viewBox="0 0 32 32"/);assert.doesNotMatch(svg,/transform=/);
});
test('hardware, native icon and timing predicates reject missing data and software fallback',()=>{
 const hardware={vendor:'nvidia',description:'RTX',isFallbackAdapter:false};assert.equal(isHardwareAdapter(hardware),true);for(const h of [null,{}, {...hardware,isFallbackAdapter:true},{...hardware,description:'SwiftShader'}])assert.equal(isHardwareAdapter(h),false);
 const icon={decoded:true,complete:true,width:32,height:32,naturalWidth:32,naturalHeight:32,rect:{width:32,height:32}};assert.equal(isDecodedNativeIcon(icon),true);assert.equal(isDecodedNativeIcon({...icon,naturalWidth:16}),false);
 const timings={timestampQueries:true,frames:Array.from({length:12},()=>({cpuMs:1,gpuMs:2}))};assert.equal(hasBoundedFrameTimings(timings),true);assert.equal(hasBoundedFrameTimings({...timings,timestampQueries:false}),false);assert.equal(hasBoundedFrameTimings({...timings,frames:[{cpuMs:NaN,gpuMs:2}]}),false);
});

test('unsupported API versions fail before any registration or native work',async()=>{
 let registered=0;await assert.rejects(()=>activate({version:2,operations:{register(){registered++;}}}),e=>e.code==='API_VERSION');assert.equal(registered,0);
});
