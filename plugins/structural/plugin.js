// Native authoring only. No numerical modules, scene capture, fields or job state.
const error=(code,message)=>Object.assign(new Error(message),{code});
const empty={type:'object',properties:{},additionalProperties:false};
const unavailable=()=>{throw error('STRUCTURAL_AUTHORING_ONLY','Structural is under construction. This preview stores authoring only; voxelization, structural solving and topology optimization are unavailable.');};

export async function activate(context){
  if(context.version!==1)throw error('API_VERSION','Unsupported Frame plugin API.');
  const owner=hash=>{const n=context.document.nodes.find(n=>n.nativeHash===hash);if(n?.type!=='structural')throw error('INVALID_OWNER','Select a Structural object.');return n;};
  context.operations.register([
    {id:'status',description:'Read explicit authoring-preview availability. Marker tags and stored settings do not imply physical interpretation or a calculation.',inputSchema:empty,readOnly:true,run(hash){owner(hash);return {stage:'authoring-preview',state:'under-construction',authoringOnly:true,numericalAvailable:false,sceneSolved:false,voxelizationAvailable:false,optimizationAvailable:false,resultAvailable:false,markerTags:['structural_fixture','structural_preserve'],parameterTagsAvailable:false};}},
    ...['show-voxels','solve-frame','solve-animation','optimize-frame','optimize-animation','result-object'].map(id=>({id,description:'Unavailable in the authoring preview. Rejects before mutation, geometry capture or numerical work.',inputSchema:{type:'object',properties:{},additionalProperties:true},readOnly:true,run:unavailable}))
  ]);
  context.attributes.register(hash=>{owner(hash);return {actions:[{id:'status',label:'Under construction',disabled:true}]};});
  // The core owns these native helper lines, bounds, hit testing and frames.
  // Size is the ordinary object transform, not a second dimensions model.
  const lines=[];
  for(let axis=0;axis<3;axis++)for(let a=0;a<2;a++)for(let b=0;b<2;b++){
    const p=[-50,-50,-50],q=[-50,-50,-50];
    p[(axis+1)%3]=q[(axis+1)%3]=a?50:-50;
    p[(axis+2)%3]=q[(axis+2)%3]=b?50:-50;q[axis]=50;lines.push(...p,...q);
  }
  await context.viewport.register({bounds:{min:[-50,-50,-50],max:[50,50,50]},lines:new Float32Array(lines),color:[.875,.667,.408,1],selectedColor:[1,.8,.55,1],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'});
}
