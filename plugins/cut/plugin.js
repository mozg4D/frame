import {validate,failure,settingsObserver} from './model.js';
import {createAxes} from './viewport.js';
const empty={type:'object',properties:{},additionalProperties:false};
export async function activate(context){
  if(context.version!==1)throw failure('API_VERSION','Unsupported Frame plugin API.');
  let storage;try{storage=globalThis.localStorage;}catch{}
  const defaults=settingsObserver(context,storage);
  const owner=hash=>{const n=context.document.nodes.find(n=>n.nativeHash===hash&&n.type==='cut');if(!n)throw failure('INVALID_OWNER','Select a Cut object.');return n;};
  const axes=createAxes(context);
  const status=hash=>{const n=owner(hash);defaults.observe();return {stage:'authoring-preview',authoringOnly:true,state:'unavailable',generationAvailable:false,geometryEvaluated:false,resultAvailable:false,job:null,viewport:axes.status(),parameters:{...n.params},defaults:defaults.status(),plane:{axes:['X','Z'],normal:[0,-1,0],origin:[0,0,0],min:[0,0,0],max:[1000,0,1000],units:'mm',dimensions:'native transform scale',gcodeAxes:['local X','local Z']},tags:{cut_avoid:'No head entry, including travel; not evaluated yet',cut_no_cut:'Tool-off region on every pass; not evaluated yet'},reason:'CUT_AUTHORING_ONLY'};};
  const unavailable=hash=>{owner(hash);throw failure('CUT_AUTHORING_ONLY','Cut currently supports native authoring only. Evaluated source extraction, shared Outline integration, routes, jobs, preview and G-code output are not implemented.');};
  context.editor.register({created:n=>defaults.created(n),documentChanged:()=>defaults.schedule(),restored:()=>defaults.schedule(),parameters:(n,changes)=>{if(n.type!=='cut')return null;validate({...n.params,...changes});defaults.schedule();return {};}});
  context.operations.register([
    {id:'status',description:'Inspect authoring and explicit missing generation capabilities, without geometry capture.',inputSchema:empty,readOnly:true,run:status},
    ...['generate','sources','result','save'].map(id=>({id,description:'Unavailable in this authoring milestone; rejects CUT_AUTHORING_ONLY without creating work or output.',inputSchema:empty,readOnly:true,run:unavailable})),
    {id:'cancel',description:'No generation job exists in the authoring milestone.',inputSchema:empty,readOnly:true,run:hash=>{owner(hash);return {cancelled:false,job:null,reason:'CUT_AUTHORING_ONLY'};}}
  ]);
  context.attributes.register(hash=>{owner(hash);return {actions:[{id:'generate',label:'Generate',disabled:true}]};});
  await context.viewport.register({pivot:[0,0,0],bounds:{min:[0,0,0],max:[1000,0,1000]},
    lines:new Float32Array([0,0,0,1000,0,0,1000,0,0,1000,0,1000,1000,0,1000,0,0,1000,0,0,1000,0,0,0]),color:[.65,.58,.46,1],selectedColor:[.85,.74,.53,1],settings:()=>[0,0,0,0],render:axes,
    shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}
