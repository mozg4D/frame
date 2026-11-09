import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Execute the actual native bridge functions with CPU doubles; no browser or GPU.
export async function nativeHelperChecks(){
  const html=await readFile(new URL('../../../index.html',import.meta.url),'utf8');
  const between=(name,next)=>{const start=html.indexOf('function '+name+'('),end=html.indexOf('function '+next+'(',start);assert(start>=0&&end>start);return html.slice(start,end);};
  const line=name=>{const start=html.indexOf('function '+name+'(');assert(start>=0);return html.slice(start,html.indexOf('\n',start));};
  const checks=[];const check=(name,test)=>{test();checks.push(name);};
  const descriptor=Function(between('pluginHelperDescriptor','use')+';return pluginViewportDescriptor;')();
  const vertices=Function(between('pluginHelperVertices','pluginShown')+';return pluginHelperVertices;')();
  const helper=(lines=[0,0,0,1,0,0],pivot)=>({lines:new Float32Array(lines),bounds:{min:[-1,-1,-1],max:[1,1,1]},...(pivot?{pivot}: {})});
  const make=()=>({...helper(),color:[1,1,1,1],selectedColor:[1,1,0,1],settings:()=>[0,0,0,0],shader:'unused',helpers:{rf_terminal:helper([0,0,0,0,1,0,0,0,0,0,0,1],[2,3,4])}});
  const types=[{type:'rf'},{type:'rf_terminal'}],raw=make(),viewport=descriptor(raw,types),entry={viewport,manifest:{id:'rf'}};
  const nodes=[{id:'r',nativeHash:'root',type:'rf',params:{}},{id:'t',nativeHash:'terminal',type:'rf_terminal',params:{}}];
  const FramePlugins={owner:n=>n?entry:null,dispatch:()=>null};
  const selectHelper=Function('FramePlugins',line('pluginViewport')+line('pluginHelper')+';return pluginHelper;')(FramePlugins);
  check('type variants and existing default fallback',()=>{assert.equal(selectHelper(nodes[0]),viewport);assert.equal(selectHelper(nodes[1]),viewport.helpers.rf_terminal);assert.equal(selectHelper(),undefined);assert.equal(descriptor({...make(),helpers:undefined},types).lines.length,6);});
  check('registration copies authored arrays',()=>{raw.lines[0]=9;raw.bounds.min[0]=-9;raw.helpers.rf_terminal.pivot[0]=9;raw.helpers.rf_terminal.lines[0]=9;assert.equal(viewport.lines[0],0);assert.equal(viewport.bounds.min[0],-1);assert.equal(viewport.helpers.rf_terminal.pivot[0],2);assert.equal(viewport.helpers.rf_terminal.lines[0],0);});
  for(const [name,mutate]of [
    ['unknown owner type',v=>v.helpers.other=helper()],['invalid surface-warning flag',v=>v.surfaceWarnings='false'],['null helpers',v=>v.helpers=null],['array helpers',v=>v.helpers=[]],['non-typed lines',v=>v.helpers.rf_terminal.lines=[]],['incomplete segment',v=>v.helpers.rf_terminal.lines=new Float32Array(5)],['nonfinite line',v=>v.helpers.rf_terminal.lines[0]=NaN],['reversed bounds',v=>v.helpers.rf_terminal.bounds.min[0]=2],['nonfinite bounds',v=>v.helpers.rf_terminal.bounds.max[0]=Infinity],['invalid pivot',v=>v.helpers.rf_terminal.pivot=[0,0]],['sparse bounds',v=>v.helpers.rf_terminal.bounds.min=Array(3)],['aggregate cap',v=>v.helpers.rf_terminal.lines=new Float32Array(60000)]
  ])check('reject '+name,()=>{const v=make();mutate(v);assert.throws(()=>descriptor(v,types));});
  check('typed bounds retain the existing contract',()=>{const v=make();v.bounds.min=new Float32Array([-1,-1,-1]);assert.deepEqual(descriptor(v,types).bounds.min,[-1,-1,-1]);});
  const packed=vertices(viewport);
  check('one combined vertex stream with vertex offsets',()=>{assert.equal(packed.values.length,18);assert.equal(packed.offsets.get(viewport),0);assert.equal(packed.offsets.get(viewport.helpers.rf_terminal),2);assert.deepEqual(Array.from(packed.values.slice(6)),Array.from(viewport.helpers.rf_terminal.lines));});
  const bound=Function('nodes','pluginHelper','FramePlugins','transformedBox','objectWorld',line('pluginBounds')+';return pluginBounds;')(nodes,selectHelper,FramePlugins,(box,world)=>({box,world}),hash=>hash);
  check('native bounds resolve variant',()=>{assert.equal(bound('terminal').box,viewport.helpers.rf_terminal.bounds);assert.equal(bound('root').box,viewport.bounds);});
  const pivot=Function('nodes','nativeValue','FM','FrameSpline','pluginHelper','objectWorld','nodeBounds',line('objectPivot')+';return objectPivot;')(nodes,h=>h==='saved'?[7,8,9]:null,{unpack:x=>x,translation:x=>x,point:(m,x)=>x,inv:x=>x},{K:()=>({primitivePivot:()=>null})},selectHelper,()=>null,()=>({center:[4,5,6]}));
  check('authored and per-type pivots with bounds fallback',()=>{assert.deepEqual(pivot('saved'),[7,8,9]);assert.deepEqual(pivot('terminal'),[2,3,4]);assert.deepEqual(pivot('root'),[4,5,6]);});
  const paths=[],svg={namespaceURI:'svg',append:p=>paths.push(p)},document={createElementNS:()=>({attrs:{},classList:{add(){}},dataset:{},style:{},setAttribute(k,v){this.attrs[k]=v;}})};
  const hits=Function('nodes','pluginHelper','pluginShown','document','objectWorld','FM','frameViewKind','viewIndex','worldScreen',between('drawPluginHits','pluginSurfaceStyle')+';return drawPluginHits;')(nodes,selectHelper,()=>true,document,()=>null,{point:(m,p)=>p},()=>1,1,p=>p.slice(0,2));
  check('native helper picking uses each type line geometry',()=>{hits(svg,{left:0,top:0});assert.equal((paths[0].attrs.d.match(/M/g)||[]).length,1);assert.equal((paths[1].attrs.d.match(/M/g)||[]).length,2);assert.equal(paths[1].dataset.hash,'terminal');});
  const draws=[],pass={setBindGroup(){},setPipeline(){},setVertexBuffer(){},draw(...args){draws.push(args);},end(){}},state={loaded:true,nodes:new Map(nodes.map(n=>[n.nativeHash,{uniform:{},group:{}}])),helperOffsets:packed.offsets,lines:[{},{}],camera:{},vertices:{}};
  const r={pluginViewports:new Map([[entry,state]]),device:{queue:{writeBuffer(){}}},uniform:{}},texture={createView:()=>({})};
  const renderFor=(mode='solid',geometry={meshes:[]})=>Function('nodes','pluginViewport','FramePlugins','preparePluginViewport','editError','pluginShown','focusId','releaseGPU','objectWorld','FM','selected','pluginHelper','shadingMode','scene','frameViewKind','viewIndex',between('renderPluginViewports','pickPluginHelper')+';return renderPluginViewports;')(nodes,()=>viewport,FramePlugins,()=>{throw Error('unexpected preparation');},()=>{},()=>true,'r',()=>{},()=>new Float32Array(16),{inv:m=>m},new Set(),selectHelper,mode,geometry,()=>0,0);
  const render=renderFor();
  check('native draw submits correct count instanceCount and firstVertex',()=>{render(r,{beginRenderPass:()=>pass},texture,texture);assert.deepEqual(draws,[[2,1,0],[4,1,2]]);});
  check('disabled surface warnings skip all native mesh traversal including wire depth',()=>{
    entry.viewport=descriptor({...make(),surfaceWarnings:false},types);state.helperOffsets=vertices(entry.viewport).offsets;draws.length=0;
    const noMeshAccess={get meshes(){throw Error('Unwanted native mesh traversal');}};
    for(const mode of ['solid','wireframe','isoparms'])renderFor(mode,noMeshAccess)(r,{beginRenderPass:()=>pass},texture,texture);
    assert.deepEqual(draws,[[2,1,0],[4,1,2],[2,1,0],[4,1,2],[2,1,0],[4,1,2]]);
    entry.viewport=viewport;
  });
  check('combined vertex buffer retains native retirement',()=>{assert(html.includes('releaseGPU(state.vertices);for(const [hash,row]of state.nodes)'));});
  const start=performance.now();for(let i=0;i<1000;i++){const v=descriptor(make(),types);vertices(v);}const ms=performance.now()-start;
  check('1000 completed descriptor and packing operations below 1000 ms',()=>assert(ms<1000,ms+' ms'));
  return {pass:true,checks,timings:{descriptorAndPacking1000Ms:ms}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await nativeHelperChecks(),null,2));
