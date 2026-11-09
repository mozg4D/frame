// Native authoring only. No solver, fake field, geometry copy or GPU allocation.
const fail=(code,message)=>Object.assign(new Error(message),{code});
const empty={type:'object',properties:{},additionalProperties:false};
const types=new Set(['rf','rf_terminal','rf_section']);
export const terminalDefaults=Object.freeze({TX:true,RX:false,Bands:'2.400–2.500',Power:1,Phase:0,Matching:true,'Load resistance':50,'Load reactance':0,'Reference impedance':50});

// Preserve the user's authored ranges, including overlap. GHz is UI/storage;
// downstream solvers must explicitly convert to Hz and choose spectral samples.
export function parseBands(text){
  if(typeof text!=='string'||!text.trim()||text.length>2048)throw fail('INVALID_BANDS','Enter one to 32 positive GHz bands.');
  const parts=text.split(',');
  if(parts.length>32)throw fail('INVALID_BANDS','At most 32 bands are supported.');
  const number='(?:\\d+(?:\\.\\d*)?|\\.\\d+)',pattern=new RegExp('^\\s*('+number+')(?:\\s*[-–—]\\s*('+number+'))?\\s*$');
  return parts.map(part=>{
    const match=pattern.exec(part);if(!match)throw fail('INVALID_BANDS','Use GHz frequencies or ascending ranges separated by commas.');
    const low=Number(match[1]),high=Number(match[2]??match[1]);
    if(!(low>0&&high>=low&&Number.isFinite(high*1e9)))throw fail('INVALID_BANDS','Bands must be positive, finite and ascending.');
    return {lowGHz:low,highGHz:high};
  });
}
export function validateTerminal(params){
  if(Object.keys(params).some(key=>!Object.hasOwn(terminalDefaults,key)))throw fail('INVALID_ARGUMENT','Unknown Terminal parameter.');
  for(const key of ['TX','RX','Matching'])if(typeof params[key]!=='boolean')throw fail('INVALID_ARGUMENT','Expected a boolean '+key+'.');
  for(const key of ['Power','Phase','Load resistance','Load reactance','Reference impedance'])if(!Number.isFinite(params[key]))throw fail('INVALID_ARGUMENT','Expected a finite '+key+'.');
  if(params.Power<0||params['Load resistance']<=0||params['Reference impedance']<=0)throw fail('INVALID_ARGUMENT','Power must be nonnegative and reference/load resistance positive.');
  parseBands(params.Bands);return params;
}
// The nearest RF ancestor owns a Terminal/Section. Ordinary intervening groups
// are supported; nested RF objects never claim each other's terminals.
export function rfOwner(node,byId){
  const seen=new Set();
  for(let n=node;n&&!seen.has(n.id);n=byId.get(n.parent)){
    if(n.type==='rf')return n;seen.add(n.id);
  }
  return null;
}
export function rfRoles(node,byId){
  const kinds=new Set(),seen=new Set();
  for(let n=node;n&&!seen.has(n.id);n=byId.get(n.parent)){
    seen.add(n.id);for(const tag of n.tags||[])if(tag.kind.startsWith('rf_'))kinds.add(tag.kind);
  }
  return {materialConflict:kinds.has('rf_metal')&&kinds.has('rf_dielectric'),kinds:[...kinds]};
}
export function helperGeometry(){
  const plane={bounds:{min:[-50,-50,0],max:[50,50,0]},lines:new Float32Array([-50,-50,0,50,-50,0,50,-50,0,50,50,0,50,50,0,-50,50,0,-50,50,0,-50,-50,0])};
  const lines=[];
  for(let axis=0;axis<3;axis++)for(const a of [-1,1])for(const b of [-1,1]){
    const p=[-1,-1,-1],q=[-1,-1,-1];p[(axis+1)%3]=q[(axis+1)%3]=a;p[(axis+2)%3]=q[(axis+2)%3]=b;q[axis]=1;lines.push(...p,...q);
  }
  return {plane,cube:{bounds:{min:[-1,-1,-1],max:[1,1,1]},lines:new Float32Array(lines)}};
}
export async function activate(context){
  if(context.version!==1)throw fail('API_VERSION','Unsupported Frame plugin API.');
  const D=context.document;
  let stamp=null,byHash=new Map(),byId=new Map();
  const invalidate=()=>{stamp=null;};
  const index=()=>{if(stamp!==D.nodes){stamp=D.nodes;byHash=new Map(stamp.map(n=>[n.nativeHash,n]));byId=new Map(stamp.map(n=>[n.id,n]));}};
  const find=hash=>{index();const n=byHash.get(hash);if(!types.has(n?.type))throw fail('INVALID_OWNER','Select an RF object, Terminal or Section.');return n;};
  const owner=n=>{index();return rfOwner(n,byId);};
  const diagnostic=n=>{
    if(n.type==='rf_terminal'){try{validateTerminal(n.params);}catch(e){return e.code;}if(!owner(n))return 'UNASSIGNED_TERMINAL';}
    if(n.type==='rf_section'&&!owner(n))return 'UNASSIGNED_SECTION';
    return null;
  };
  const status=hash=>{
    const n=find(hash),root=owner(n);
    // Metadata-only, explicitly requested diagnostics. Never scan geometry from
    // a per-frame hook, and keep the returned owner list bounded.
    let conflicts;
    if(n.type==='rf'){
      conflicts={total:0,hashes:[],truncated:false};
      for(const candidate of D.nodes)if(rfRoles(candidate,byId).materialConflict){conflicts.total++;if(conflicts.hashes.length<128)conflicts.hashes.push(candidate.nativeHash);}
      conflicts.truncated=conflicts.total>conflicts.hashes.length;
    }
    return {hash,type:n.type,owner:root?.nativeHash||null,stage:'authoring-preview',state:'unfinished',authoringOnly:true,
      solverAvailable:false,resultsAvailable:false,optimizationAvailable:false,materialPhysicsAvailable:false,
      diagnostic:diagnostic(n),params:{...n.params},...(n.type==='rf'?{materialConflicts:conflicts,terminals:D.nodes.filter(q=>q.type==='rf_terminal'&&owner(q)===n).map(q=>q.nativeHash),sections:D.nodes.filter(q=>q.type==='rf_section'&&owner(q)===n).map(q=>q.nativeHash)}:{})};
  };
  const create=type=>async hash=>{
    const n=find(hash);if(n.type!=='rf')throw fail('INVALID_OWNER','Add helpers from an RF object.');
    let child;D.transaction(()=>{child=D.create(type,hash);invalidate();D.select(child.nativeHash,'objects');});
    await context.editor.selectOwner(child.nativeHash);
    return {hash:child.nativeHash,type,owner:hash,authoringOnly:true};
  };
  const settings={TX:{type:'boolean'},RX:{type:'boolean'},Bands:{type:'string',maxLength:2048},Power:{type:'number',minimum:0},Phase:{type:'number'},Matching:{type:'boolean'},'Load resistance':{type:'number',exclusiveMinimum:0},'Load reactance':{type:'number'},'Reference impedance':{type:'number',exclusiveMinimum:0}};
  const edit=(hash,args)=>{const n=find(hash);if(n.type!=='rf_terminal')throw fail('INVALID_OWNER','Select a Terminal.');validateTerminal({...n.params,...args});context.update(hash,args);return status(hash);};
  context.editor.register({
    created:invalidate,documentChanged:invalidate,restored:invalidate,
    parameters:(n,changes)=>{if(!types.has(n.type))return null;if(n.type==='rf_terminal')validateTerminal({...n.params,...changes});return {};},
    rowColor:n=>types.has(n.type)?diagnostic(n)?'#ee554b':'#7ab7cf':null
  });
  const operation=(id,description,run,readOnly=true,inputSchema=empty)=>({id,description,inputSchema,readOnly,run});
  context.operations.register([
    operation('status','Read authored parameters and unavailable calculation capabilities.',status),
    operation('add-terminal','Create an independent native Terminal under this RF.',create('rf_terminal'),false),
    operation('add-section','Create another native Section under this RF; no numerical field exists.',create('rf_section'),false),
    operation('settings','Validate and store Terminal authoring without calculating.',edit,false,{type:'object',properties:settings,additionalProperties:false}),
    ...['TX','RX','Matching'].map(key=>operation('toggle-'+key.toLowerCase(),'Toggle Terminal '+key+' authoring.',hash=>{const n=find(hash);return edit(hash,{[key]:!n.params[key]});},false)),
    ...['solve','optimize','results'].map(id=>operation(id,'Unavailable until the numerical model passes physical validation.',hash=>{find(hash);throw fail('RF_AUTHORING_ONLY','RF solving, field results, impedance, received power and optimization are not implemented.');}))
  ]);
  context.attributes.register(hash=>{
    const n=find(hash),notice={id:'status',label:'Unfinished',disabled:true};
    if(n.type==='rf')return {actions:[{id:'add-terminal',label:'Add Terminal'},{id:'add-section',label:'Add Section'},notice]};
    if(n.type==='rf_section')return {actions:[notice]};
    const p=n.params;
    return {hiddenFields:['TX','RX','Matching',...p.TX?[]:['Power','Phase'],...p.RX&&!p.Matching?[]:['Load resistance','Load reactance'],...p.TX||p.RX?[]:['Reference impedance']],
      actions:[{id:'toggle-tx',label:'TX',row:'Mode',active:p.TX},{id:'toggle-rx',label:'RX',row:'Mode',active:p.RX},...p.RX?[{id:'toggle-matching',label:'Matching',active:p.Matching}]:[],notice],
      units:{Bands:'GHz',Power:'W',Phase:'deg','Load resistance':'ohm','Load reactance':'ohm','Reference impedance':'ohm'},
      ranges:{Power:{min:0},'Load resistance':{min:.000001},'Reference impedance':{min:.000001}}};
  });
  const {plane,cube}=helperGeometry();
  await context.viewport.register({...plane,helpers:{rf_terminal:cube,rf_section:plane},enabledAffectsVisibility:false,surfaceWarnings:false,
    color:[.48,.72,.81,1],selectedColor:[.75,.9,1,1],settings:()=>[0,0,0,0],
    colorFor:(hash,p,selected)=>diagnostic(find(hash))?[.93,.33,.29,1]:selected?[.75,.9,1,1]:[.48,.72,.81,1],
    shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{discard;return vec4f(0);}'
  });
}
