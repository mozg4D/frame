// Unfinished native authoring only. No reference solver or invented field values.
const empty = {type:'object',properties:{},additionalProperties:false};
const quantities = ['B','H','Magnetization','Saturation'];
const presentations = ['Strokes','Section'];
const error = (code,message) => Object.assign(new Error(message),{code});
const unavailable = () => {throw error('MAGNETO_AUTHORING_ONLY','Magneto is unfinished. Native geometry, material physics, current-conductor and GPU solving are unavailable; no physical result or curve exists.');};

export async function activate(context) {
  if(context.version!==1) throw error('API_VERSION','Unsupported Frame plugin API.');
  // Borrowed native identities only, never geometry or a parallel scene model.
  // Native render/documentChanged covers transactions, history and HASH open;
  // array identity/length also guards replacement and creation before render.
  let source=null,count=-1,byHash=null;
  const invalidate=()=>{source=null;byHash=null;count=-1;};
  const find=hash=>{
    const nodes=context.document.nodes;
    if(!byHash||source!==nodes||count!==nodes.length){
      source=nodes;count=nodes.length;byHash=new Map(nodes.map(n=>[n.nativeHash,n]));
    }
    return byHash.get(hash);
  };
  const owner = hash => {
    const node=find(hash);
    if(node?.type!=='magneto') throw error('INVALID_OWNER','Select a Magneto plane.');
    return node;
  };
  const status = hash => {
    owner(hash);
    return {stage:'native-authoring-preview',state:'unfinished',authoringOnly:true,physicsAvailable:false,solverAvailable:false,
      materialPhysicsAvailable:false,currentConductorAvailable:false,
      fieldAvailable:false,resultAvailable:false,persistentMagnetizationAvailable:false,curvesAvailable:false};
  };
  const edit = patch => hash => {owner(hash);context.update(hash,patch);return {authoringOnly:true,params:{...owner(hash).params}};};
  const modes=[['mode-solve','Solve'],['mode-current-density','Current Density']];
  const views=quantities.flatMap(quantity=>presentations.map(presentation=>({
    id:'view-'+quantity.toLowerCase()+'-'+presentation.toLowerCase(),quantity,presentation
  })));
  // Core suppresses this fallback for effective (including inherited) Frame
  // materials. No visual material/tag is created or overwritten by this hook.
  context.editor.register({created:invalidate,documentChanged:invalidate,surfaceStyle:hash=>{
    const node=find(hash);
    if(!node||node.tags?.some(t=>t.kind==='material'))return null;
    const name=node.tags?.find(t=>t.kind==='magneto')?.params?.Material;
    if(!name)return null;
    const color=name.startsWith('NdFeB ')?[.62,.64,.67,1]:
      name.startsWith('Electrical Steel ')?[.39,.43,.47,1]:name==='Pure Iron'?[.48,.49,.5,1]:null;
    return color?{color,topmost:false}:null;
  }});
  context.operations.register([
    {id:'status',description:'Read unfinished authoring availability; no physical result exists.',inputSchema:empty,readOnly:true,run:status},
    ...modes.map(([id,mode])=>({id,description:'Store native plane mode; does not solve.',inputSchema:empty,readOnly:false,run:edit({Mode:mode})})),
    ...views.map(({id,quantity,presentation})=>({id,description:'Store one intended visualization choice; no field is rendered.',inputSchema:empty,readOnly:false,run:edit({Quantity:quantity,Presentation:presentation})})),
    ...['solve-frame','solve-animation','force','torque','reset-magnetization'].map(id=>({id,description:'Unavailable. Rejects before mutation, geometry capture or numerical work.',inputSchema:empty,readOnly:true,run:unavailable}))
  ]);
  context.attributes.register(hash=>{
    const n=owner(hash),solve=n.params.Mode==='Solve';
    return {
      hiddenFields:['Mode','Quantity','Presentation',...solve?['Current Density']:[]],
      actions:[
        ...modes.map(([id,label])=>({id,label,row:'Mode',active:n.params.Mode===label})),
        ...solve?[
          ...views.map(({id,quantity,presentation})=>({id,label:presentation,row:quantity,active:n.params.Quantity===quantity&&n.params.Presentation===presentation})),
          {id:'solve-frame',label:'Frame',row:'Solve',disabled:true},
          {id:'solve-animation',label:'Animation',row:'Solve',disabled:true}
        ]:[],
        {id:'status',label:'Unfinished',disabled:true}
      ]
    };
  });
  // The same finite local XY rectangle is owned and transformed by Frame.
  // +Z is its normal. Size uses ordinary native scale, never a Range parameter.
  await context.viewport.register({
    bounds:{min:[-50,-50,0],max:[50,50,0]},
    lines:new Float32Array([-50,-50,0,50,-50,0,50,-50,0,50,50,0,50,50,0,-50,50,0,-50,50,0,-50,-50,0]),
    color:[.741,.584,.839,1],selectedColor:[.87,.73,1,1],settings:()=>[0,0,0,0],
    shader:'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'
  });
}
