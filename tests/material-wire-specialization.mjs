// Execute the owning pipeline factories with inert GPU objects. The legacy
// control changes only cache keys; all specialization constants stay native.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function sourceOf(html,name,next){
 const start=html.indexOf('    function '+name+'('),end=html.indexOf('    function '+next+'(',start);
 assert(start>=0&&end>start,'owning '+name+' exists');return html.slice(start,end);
}
function fixture(html,{legacy=false,filtered=false,mode='solid-wire',classified=true}={}){
 const cacheStart=html.indexOf('    let renderMaterialCache=null,'),cacheEnd=html.indexOf('    function appearanceId(',cacheStart);assert(cacheStart>=0&&cacheEnd>cacheStart,'native synchronous material-cache helpers exist');
 let source=html.slice(cacheStart,cacheEnd)+'\n'+sourceOf(html,'polygonWire','materialLibraryBindings')+'\n'+sourceOf(html,'materialTransparent','clearMaterialTransparency')+'\n'+sourceOf(html,'filteredSurfacePipeline','renderPluginSurfaceStyles');
 if(legacy){const occurrences=source.split(',materialWireOverlay].join').length-1;assert.equal(occurrences,2);source=source.replaceAll(',materialWireOverlay].join','].join');}
 const parameters=new Map(),maps=new Map(),masks=new Set(['mask']),descriptors=[],pending=[],errors=[];
 const state={source:'native shader',module:{},layout:{},meshLayout:{},libraryLayout:{},pipelines:new Map(),pending:new Map(),alphaAssets:new Map()};
 let serial=0;const resource=descriptor=>({id:++serial,descriptor}),r={materialState:state,format:'bgra8unorm',surfaceTargets:[{format:'bgra8unorm'}],wireTargets:[{format:'bgra8unorm'},{format:'r32uint'},{format:'rgba32float'}],shaderSource:'native shader',pipeline:{getBindGroupLayout:()=>({})},device:{
  createBindGroupLayout:resource,createBindGroup:resource,createShaderModule:resource,createPipelineLayout:resource,
  createRenderPipelineAsync(descriptor){descriptors.push(descriptor);const job=Promise.resolve(resource(descriptor));pending.push(job);return job;}
 }};
 const env={renderer:r,bendValid:()=>false,shadingMode:mode,viewIndex:0,GPUShaderStage:{FRAGMENT:2},FrameHash:{K:{zero:'zero'}}};
 const api=Function('env','ensureMaterialState','frameViewKind','importedUV','appearanceValue','polygonSet','draw','editError',`with(env){${source};return {materialPipeline,filteredSurfacePipeline,materialTransparent};}`)(env,()=>state,i=>i!==0,m=>m.uv,(uid,field)=>(field==='parameters'?parameters:maps).get(uid),id=>masks.has(id)?{}:null,()=>{},e=>errors.push(e));
 const values=(opacity=0)=>{const a=new Array(16).fill(0);a[6]=opacity;a[12]=1;return a;};
 parameters.set('opaque',values());parameters.set('mixed',values(40));maps.set('opaque',[]);maps.set('mixed',[]);
 const mesh=(mixed=false)=>({posed:true,materialBindings:{grouped:true},materialTags:[{materialUID:'opaque'},...mixed?[{materialUID:'mixed',mask:'mask'}]:[]],splineWireEdges:classified?{}:null});
 const opaque=mesh(),mixed=mesh(true),filter={shader:'fn pluginSurfaceKeep(p:vec3f)->bool{return true;}',buffers:[]},material={state};
 const invoke=(m,transparent=false,style=null)=>filtered?api.filteredSurfacePipeline(r,m,filter,material,style,transparent)?.pipeline:api.materialPipeline(r,m,transparent);
 const settle=async()=>{await Promise.all(pending);for(let i=0;i<5;i++)await Promise.resolve();assert.deepEqual(errors,[]);};
 const ready=async(m,transparent=false,style=null)=>{invoke(m,transparent,style);await settle();return invoke(m,transparent,style);};
 return {api,r,state,env,opaque,mixed,parameters,maps,masks,descriptors,invoke,settle,ready,values};
}

export async function materialWireSpecializationChecks(root=new URL('../',import.meta.url)){
 const html=await readFile(new URL('index.html',root),'utf8'),checks=[],negativeControls=[];
 const check=async(name,fn)=>{await fn();checks.push({name,pass:true});};
 for(const filtered of [false,true]){
  const family=filtered?'Filtered material':'Native material';
  await check(family+' legacy key demonstrably aliases distinct shader constants',async()=>{
   for(const firstMixed of [false,true]){
    const f=fixture(html,{filtered,legacy:true}),first=firstMixed?f.mixed:f.opaque,second=firstMixed?f.opaque:f.mixed;
    assert.equal(f.api.materialTransparent(f.opaque),false);assert.equal(f.api.materialTransparent(f.mixed),true);
    const a=await f.ready(first),b=await f.ready(second);assert.equal(a,b,'old cache returns the first specialization');assert.equal(f.descriptors.length,1);
    assert.notEqual(b.descriptor.fragment.constants.materialWireOverlay,!f.api.materialTransparent(second),'second mesh receives the wrong compile-time constant');
    negativeControls.push({filtered,firstMixed,compiled:f.descriptors.length,compiledOverlay:b.descriptor.fragment.constants.materialWireOverlay,requiredOverlay:!f.api.materialTransparent(second)});
   }
  });
  await check(family+' opaque and mixed transparent cages keep distinct pipelines in both line modes',async()=>{
   for(const mode of ['solid-wire','solid-isoparms'])for(const firstMixed of [false,true]){
    const f=fixture(html,{filtered,mode}),first=firstMixed?f.mixed:f.opaque,second=firstMixed?f.opaque:f.mixed;
    const a=await f.ready(first),b=await f.ready(second);assert.notEqual(a,b);assert.equal(f.descriptors.length,2);
    for(const m of [f.opaque,f.mixed]){const p=f.invoke(m);assert.equal(p.descriptor.fragment.constants.materialWireOverlay,!f.api.materialTransparent(m));assert.equal(p.descriptor.vertex.constants.materialWireOverlay,!f.api.materialTransparent(m));}
    for(let i=0;i<1000;i++){assert.equal(f.invoke(first),a);assert.equal(f.invoke(second),b);}assert.equal(f.descriptors.length,2);
   }
  });
  await check(family+' pending compilation does not collapse incompatible overlay choices',async()=>{
   const f=fixture(html,{filtered});assert.equal(f.invoke(f.opaque)??null,null);assert.equal(f.invoke(f.mixed)??null,null);
   assert.equal(f.descriptors.length,2);await f.settle();assert.notEqual(f.invoke(f.opaque),f.invoke(f.mixed));
  });
  await check(family+' material parameter and alpha-map transitions select the matching cached constant',async()=>{
   const f=fixture(html,{filtered}),a=await f.ready(f.opaque),b=await f.ready(f.mixed);
   f.parameters.get('mixed')[6]=0;assert.equal(f.invoke(f.mixed),a);f.parameters.get('mixed')[6]=75;assert.equal(f.invoke(f.mixed),b);
   f.parameters.get('mixed')[6]=0;f.maps.set('mixed',[null,'opacity']);assert.equal(f.invoke(f.mixed),b);
   f.maps.set('mixed',['color']);f.parameters.get('mixed')[12]=.5;assert.equal(f.invoke(f.mixed),b);f.state.alphaAssets.set('color',false);assert.equal(f.invoke(f.mixed),a);f.state.alphaAssets.set('color',true);assert.equal(f.invoke(f.mixed),b);
   f.maps.set('mixed',[]);assert.equal(f.invoke(f.mixed),a);assert.equal(f.descriptors.length,2,'transitions reuse compiled compatible pipelines');
  });
  await check(family+' plain surfaces, Solid and transparency passes do not multiply equivalent specializations',async()=>{
   for(const options of [{classified:false},{mode:'solid'}]){const f=fixture(html,{filtered,...options}),a=await f.ready(f.opaque),b=await f.ready(f.mixed);assert.equal(a,b);assert.equal(a.descriptor.fragment.constants.materialWireOverlay,false);assert.equal(f.descriptors.length,1);}
   const f=fixture(html,{filtered}),a=await f.ready(f.opaque,true),b=await f.ready(f.mixed,true);assert.equal(a,b);assert.equal(a.descriptor.fragment.constants.materialWireOverlay,false);assert.equal(a.descriptor.depthStencil.depthWriteEnabled,false);
  });
 }
 return {pass:true,native:false,sourceSHA256:createHash('sha256').update(html).digest('hex'),checks,negativeControls};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const report=await materialWireSpecializationChecks();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/material-wire-specialization-cpu.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}catch(error){console.error(error.stack);process.exitCode=1;}
}
