import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {html,fragment} from '../../../tests/scene-data-runtime.mjs';

// Reuse the existing current-core data fixture, including its ACTUAL checkpoint,
// Undo, author-data CAS, epoch, native registry validation and FIFO. Its DOM,
// storage/renderer and settlement adapters remain CPU-only test plumbing.
// No author-data lifecycle method is replaced with a no-op.
const fixture=readFileSync(new URL('../../../tests/scene-control-data.mjs',import.meta.url),'utf8');
const begin=fixture.indexOf('function environment(){'),end=fixture.indexOf('export async function sceneControlDataChecks()',begin);
assert.ok(begin>=0&&end>begin);
const codec=new Function(fragment('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+';return createFrameHashCodec();')();
export const OWNER='a'.repeat(32),SOURCE='b'.repeat(32);
const environment=new Function('fragment','webcrypto','codec','A','B','block',fixture.slice(begin,end)+';return environment;')(fragment,webcrypto,codec,OWNER,SOURCE,fragment('const FrameAuthorData=','const FrameDocumentation='));
const math=new Function(fragment('const FM=(()=>{','\n\n    const POSE_WGSL')+';return FM;')();
const line=fragment;
export function nativeInputFixture({installed=true,count=1}={}){
 const core=environment(),owner=core.nodes[0],source=core.nodes[1];
 owner.type='thermal';owner.params={Initial:20,Ambient:25};source.type='mesh';source.params={};
 const tagAPI=new Function(fragment('const FramePluginTags=','// Author data')+';return FramePluginTags;')();
 const definitions={thermal_material:{name:'Material',plugin:'thermal',fields:tagAPI.declaration({fields:{Density:2700,'Specific heat':900,Conductivity:205}})},thermal_heater:{name:'Heater',plugin:'thermal',fields:tagAPI.declaration({fields:{Power:40}})}};
 const tagOwners=new Map(installed?Object.keys(definitions).map(k=>[k,{manifest:{id:'thermal'},loaded:false}]):[]);
 const tags=new Function('FramePluginTags','tagDefinitions','tagOwners','commit','FrameHash',[line('  function tagPlan('),line('  function setTags('),line('  function readTags('),line('  function tagList(')].join('\n')+';return {setTags,readTags,tagList};')(tagAPI,definitions,tagOwners,core.commit,codec);
 const authoring=new Function('FrameAuthorData','FramePlugins','definitions','tagDefinitions','FramePluginTags','FrameHash',[line('function frameValidateAuthoring('),line('function frameRestoreAuthoring(')].join('\n')+';return {validate:frameValidateAuthoring,restore:frameRestoreAuthoring};')(core.FrameAuthorData,{owner:()=>null},{},definitions,tagAPI,codec);
 core.tools.set('tag.list',{run:async()=>tags.tagList(),inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}});
 const device=Object.freeze({label:'CPU resource-identity sentinel; no GPU methods'}),frames=new Map([[OWNER,Array.from(math.I())],[SOURCE,Array.from(math.I())]]);
 const descriptor=hash=>({hashId:hash,positions:{label:'borrowed-position-sentinel'},indices:{label:'borrowed-index-sentinel'},version:1,vertexCount:8,triangleCount:12,boundsMin:[-10,-10,-5],boundsMax:[10,10,5],frameVisible:true});
 core.scene.meshes.push(descriptor(SOURCE));
 for(let i=1;i<count;i++){const h=(i+100).toString(16).padStart(32,'0');core.nodes.push({...structuredClone(source),id:'native-'+i,nativeHash:h});frames.set(h,Array.from(math.I()));core.scene.meshes.push(descriptor(h));}
 if(installed)for(const n of core.nodes.filter(n=>n.type==='mesh')){tags.setTags([n],'thermal_material',true,{Density:2700,'Specific heat':900,Conductivity:205});tags.setTags([n],'thermal_heater',true,{Power:40});}
 const captureFactory=new Function('environment','FM','frames',`
  const pluginIdentities=new WeakMap();let pluginIdentitySerial=0;
  const FramePlugins={owner:n=>n.type==='thermal'},FrameSpline={states:new Map()},morphStates=new Map();
  const helperShown=()=>true,lightShown=()=>true,frameSoloContains=()=>true,appearanceTags=()=>[];
  const objectWorld=hash=>frames.get(hash),deformationRevision=()=>0;
  ${line('    const pluginPolygonAccuracy=')}
  ${line('    function pluginIdentity(')}
  ${line('    function pluginGeometryAccuracy(')}
  ${line('    function transformedBox(')}
  ${line('    function localMeshBox(')}
  return function capture(hash,keys){
   const nodes=environment.core.nodes,scene=environment.scene,renderer={device:environment.device};
   ${line('    function cloudRows(')}
   ${line('    function nativeSurfaceOccurrences(')}
   ${fragment('    function pluginSnapshot(', '    function pluginViewport(')}
   return pluginSnapshot(hash,keys,true);
  };
 `);
 const env={core,scene:core.scene,device},capture=captureFactory(env,math,frames);let calls=0,afterRead=null,playing=false,transforming=false,exporting=false;
 const context={get device(){return env.device;},api:{async call(name,args){calls++;const value=await core.call(name,args);await afterRead?.(name,args,calls);return value;}},document:{get nodes(){return core.nodes;},get playing(){return playing;},get exporting(){return exporting;},world:hash=>frames.get(hash)},scene:{capture,get transforming(){return transforming;}}};
 return {core,owner,source,definitions,tagOwners,tags,authoring,frames,context,math,env,get calls(){return calls;},set afterRead(fn){afterRead=fn;},set playing(x){playing=x;},set transforming(x){transforming=x;},set exporting(x){exporting=x;}};
}
export {html};
