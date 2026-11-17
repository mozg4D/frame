// Command-level regression over the actual runtime. Native pixel coverage is separate.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sourceOverride=process.argv.find(arg=>arg.startsWith('--source='))?.slice(9);
const html=await readFile(sourceOverride||new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function opaqueMeshDraw('),end=html.indexOf('    function renderGeometry(',start);
assert(start>=0&&end>start);
const renderEnd=html.indexOf('    function makeWireIDTarget(',end);assert(renderEnd>end);
const source=html.slice(start,renderEnd),checks=[];
function fixture(count=513){
 let serial=0;const resource=()=>({id:++serial}),pipeline=resource(),posed=resource(),wire=resource(),plain=resource(),ortho=resource(),library=resource(),materialPipeline={...resource(),material:true};
 const meshes=Array.from({length:count},(_,i)=>({id:i,triangleCount:2,count:6,renderIndices:resource(),shadingBindGroup:resource(),boundsMin:[i,0,0],boundsMax:[i+1,1,1]}));
 const env={elementMode:'object',shadingMode:'solid',viewIndex:0,scene:{meshes},builds:0,clip:Infinity,replicaCalls:0,drawCloudInstances:()=>0,deferPluginSceneLines:()=>false,drawViewGrid:()=>{},drawSplineDisplays:()=>{},splineDisplays:new Map()};
 env.drawReplicaBatches=()=>{env.replicaCalls++;return batches();};
 const record=()=>{const state={groups:[],pipeline:null,index:null},draws=[];return {draws,setPipeline(p){state.pipeline=p;},setBindGroup(n,g){state.groups[n]=g;},setIndexBuffer(b){state.index=b;},draw(n){draws.push({pipeline:state.pipeline,groups:[...state.groups],index:null,count:n});},drawIndexed(n){draws.push({pipeline:state.pipeline,groups:[...state.groups],index:state.index,count:n});},executeBundles(bundles){for(const bundle of bundles)draws.push(...bundle);state.groups=[];state.pipeline=null;state.index=null;},finish(){return draws;}};};
 const r={bindGroup:resource(),surfaceTargets:[{format:'bgra8unorm'}],wireTargets:[{format:'bgra8unorm'},{format:'r32uint'},{format:'rgba32float'}],device:{createRenderBundleEncoder(){env.builds++;return record();}}};
 const materialMeshGPU=(r,m)=>m.material?{state:{group:m.library||library},bindings:{groups:new Map((m.parts||[m]).map(p=>[p,{group:p.materialGroup}])),grouped:!!m.grouped}}:null;
 const meshVisible=m=>m.triangleCount>0&&m.frameVisible!==false&&m.boundsMin[0]<env.clip;
   const api2=Function('env','materialMeshGPU','meshPipelines','pluginSurfaceFilter','filteredSurfacePipeline','materialPipeline','polygonWire','classifiedSurfaceWire','plainWireSurfacePipeline','importedUV','pluginSurfaceStyle','frameViewKind','meshVisible',`with(env){${source};return {opaqueMeshDraw,issueOpaqueMesh,tryRenderGeometryBundles,renderGeometry};}`)(env,materialMeshGPU,(r,m)=>({pipeline:env.viewIndex?ortho:m.posed?posed:pipeline,wireSurfacePipeline:wire}),m=>m.filter,(r,m,f)=>f,(r,m)=>m.materialPipeline||materialPipeline,()=>env.shadingMode!=='solid',m=>!!m.classified,()=>plain,m=>m.uv,m=>m.style,i=>i!==0,meshVisible);
 const batches=()=>{const set=new Set(meshes.filter(m=>m.batched));set.draw=m=>{if(!m.batchFirst)return false;const d=api2.opaqueMeshDraw(r,m);api2.issueOpaqueMesh(pass,d);return true;};return set;};let pass;
 const run=(cached=true)=>{pass=record();pass.setBindGroup(0,r.bindGroup);const batch=batches();if(cached){const result=api2.tryRenderGeometryBundles(r,pass,batch);return {draws:pass.draws,result};}for(const m of meshes){if(batch.draw(m)||batch.has(m)||m.style||!meshVisible(m))continue;api2.issueOpaqueMesh(pass,api2.opaqueMeshDraw(r,m),m);}return {draws:pass.draws};};
 const normalize=draws=>draws.map(d=>({pipeline:d.pipeline,index:d.index,count:d.count,groups:[d.groups[0],d.groups[1],...(d.pipeline.material?[d.groups[2]]:[]),...(d.pipeline.filtered?[d.groups[3]]:[])]}));
 const parity=()=>assert.deepEqual(normalize(run(true).draws),normalize(run(false).draws));
 const geometry=(include)=>{pass=record();env.replicaCalls=0;const visible=api2.renderGeometry(r,pass,1024,900,include);return {visible,replicaCalls:env.replicaCalls,draws:pass.draws};};
 return {env,r,meshes,resource,run,parity,geometry,api:api2};
}
function check(name,fn){fn();checks.push({name,pass:true});}
check('Ordered opaque bundles retain mixed material, instanced, paged and plugin fallback command order',()=>{const f=fixture();f.meshes[10].batched=true;f.meshes[10].batchFirst=true;f.meshes[30].batched=true;f.meshes[100].paged=true;f.meshes[200].style={};f.meshes[300].material=true;f.meshes[300].materialGroup=f.resource();f.meshes[350].filter={pipeline:{...f.resource(),filtered:true},group:f.resource()};f.parity();});
check('Idle draws and camera uniform writes reuse bundles; camera binding replacement re-encodes',()=>{const f=fixture();f.parity();const n=f.env.builds;for(let i=0;i<100;i++){f.r.bindGroup.content=i;f.run();}assert.equal(f.env.builds,n);f.r.bindGroup=f.resource();f.parity();assert.equal(f.env.builds,n*2);});
check('Pipeline, shading binding, index resource, count and part replacements invalidate the owning block',()=>{const f=fixture();f.parity();for(const mutate of [m=>m.posed=true,m=>m.shadingBindGroup=f.resource(),m=>m.renderIndices=f.resource(),m=>m.count+=3,m=>m.parts=[{...m,shadingBindGroup:f.resource()}]]){const n=f.env.builds;mutate(f.meshes[10]);f.parity();assert.equal(f.env.builds,n+1);}});
check('Visibility, material resource and dynamically changed batch membership refresh exact commands',()=>{const f=fixture();f.meshes[5].material=true;f.meshes[5].materialGroup=f.resource();f.parity();for(const mutate of [()=>f.meshes[5].library=f.resource(),()=>f.meshes[10].frameVisible=false,()=>{f.meshes[11].batched=true;f.meshes[11].batchFirst=true;},()=>{f.meshes[11].batched=false;f.meshes[11].batchFirst=false;},()=>f.meshes[10].frameVisible=true]){mutate();f.parity();}});
check('Whole-object bounds update coarse culling without re-encoding affine resources',()=>{const f=fixture(256);f.run();const n=f.env.builds;f.env.clip=-1;assert.equal(f.run().draws.length,0);for(const m of f.meshes){m.boundsMin[0]-=300;m.boundsMax[0]-=300;}assert.equal(f.run().draws.length,256);assert.equal(f.env.builds,n);});
check('Replacing the mesh list and shrinking a live list cannot replay retired objects',()=>{const f=fixture();f.run();f.meshes.pop();f.parity();assert.equal(f.run().draws.length,512);f.env.scene.meshes=f.meshes.slice();const old=f.r.geometryBundles,n=f.env.builds;f.run();assert.equal(f.r.geometryBundles,old);assert.equal(f.env.builds,n,'unchanged published occurrence list preserves commands');f.env.scene.meshes=[...f.env.scene.meshes].reverse();f.run();assert(f.env.builds>n);});
check('Perspective and orthographic surface modes own bounded independent command variants',()=>{const f=fixture();for(const view of [0,1,2,3])for(const mode of ['solid','solid-wire','solid-isoparms']){f.env.viewIndex=view;f.env.shadingMode=mode;f.parity();}assert.equal(f.r.geometryBundles.variants.size,6);});
check('Component mode and small scenes keep the ordinary renderer',()=>{const f=fixture();f.env.elementMode='vertex';assert.equal(f.run().result,null);assert.equal(f.env.builds,0);assert.equal(fixture(255).run().result,null);});
check('Full-scene bundle admission avoids rebuilding instance groups while other renderer routes retain them',()=>{
 for(const shading of ['solid','solid-wire','solid-isoparms']){const f=fixture(256);f.env.shadingMode=shading;f.meshes[0].replicaMatrix={};const row=f.geometry();assert.equal(row.replicaCalls,0,shading);assert.equal(row.visible,256);assert.equal(row.draws.length,256);}
 for(const configure of [f=>f.env.elementMode='vertex',f=>{delete f.r.device.createRenderBundleEncoder;}]){const f=fixture(256);f.meshes[0].replicaMatrix={};configure(f);assert.equal(f.geometry().replicaCalls,1);}
 const partial=fixture(256);partial.meshes[0].replicaMatrix={};assert.equal(partial.geometry(()=>true).replicaCalls,1);
 const small=fixture(255);small.meshes[0].replicaMatrix={};assert.equal(small.geometry().replicaCalls,1);
 const off=fixture(256);off.meshes[0].replicaMatrix={};off.env.shadingMode='off';assert.equal(off.geometry().replicaCalls,0);
});
const report={pass:true,native:false,sourceSHA256:createHash('sha256').update(html).digest('hex'),checks};await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/render-bundle-cache-cpu.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
