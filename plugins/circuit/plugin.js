// Native authoring data only. No electrical solver or calculated values.
export const RECORD='c17c0170000000000000000000000001';
export const LIMITS=Object.freeze({components:512,pins:64,nets:1024});
export const fail=(code,message)=>Object.assign(new Error(message),{code});
export const uid=()=>crypto.randomUUID().replaceAll('-','');
export const models=Object.freeze({
 resistor:{name:'Resistor',label:'R',pins:['A','B'],fields:{Resistance:1000},units:{Resistance:'ohm'}},
 capacitor:{name:'Capacitor',label:'C',pins:['A','B'],fields:{Capacitance:1e-6},units:{Capacitance:'F'}},
 inductor:{name:'Inductor',label:'L',pins:['A','B'],fields:{Inductance:1e-3},units:{Inductance:'H'}},
 diode:{name:'Diode',label:'D',pins:['A','K'],fields:{'Saturation current':1e-14,'Emission coefficient':1},units:{'Saturation current':'A'}},
 led:{name:'LED',label:'LED',pins:['A','K'],fields:{'Saturation current':1e-20,'Emission coefficient':2},units:{'Saturation current':'A'}},
 bjt:{name:'BJT',label:'Q',pins:['B','C','E'],fields:{Polarity:['NPN','PNP'],'Forward beta':100},units:{}},
 mosfet:{name:'MOSFET',label:'M',pins:['G','D','S','B'],fields:{Polarity:['N-channel','P-channel'],'Threshold voltage':2},units:{'Threshold voltage':'V'}},
 voltage:{name:'Voltage source',label:'V',pins:['+','-'],fields:{Voltage:5},units:{Voltage:'V'}},
 current:{name:'Current source',label:'I',pins:['+','-'],fields:{Current:.001},units:{Current:'A'}},
 controller:{name:'Controller',label:'U',pins:['VDD','GND','IN','OUT'],fields:{'High voltage':3.3,'Output resistance':50},units:{'High voltage':'V','Output resistance':'ohm'}},
 custom:{name:'Component',label:'X',pins:['1','2'],fields:{},units:{}}
});
export function normalizeName(value){
 if(typeof value!=='string')throw fail('INVALID_ARGUMENT','Net name must be text.');
 const name=value.normalize('NFC').trim();
 if(name.length>128||/[\u0000-\u001f\u007f]/u.test(name))throw fail('INVALID_ARGUMENT','Net name must contain at most 128 characters and no control characters.');
 return name;
}
export const modelOf=n=>n?.type?.startsWith('circuit_')?n.type.slice(8):null;
export function pinsFor(kind,definitions=null){
 const labels=models[kind]?.pins;if(!labels)throw fail('INVALID_ARGUMENT','Unknown component kind.');
 const pins=definitions||labels.map((label,i)=>({label,position:labels.length===2?[i?10:-10,0,0]:[-10+20*(i%2),0,8-16*Math.floor(i/2)]}));
 if(!Array.isArray(pins)||!pins.length||pins.length>LIMITS.pins)throw fail('INVALID_ARGUMENT','A component needs 1 to 64 pins.');
 const names=new Set();
 return pins.map(p=>{if(!p||typeof p.label!=='string'||!p.label.trim()||p.label.length>64||names.has(p.label)||!Array.isArray(p.position)||p.position.length!==3||!p.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6))throw fail('INVALID_ARGUMENT','Pins need unique labels and finite local positions.');names.add(p.label);return {id:uid(),label:p.label,position:[...p.position],net:null};});
}
export const initial=n=>n.type==='circuit'?{version:1,nets:[],ground:null}:{version:1,pins:pinsFor(modelOf(n))};
export function readData(D,n){
 const r=D.records(n.nativeHash)[RECORD];if(!r)throw fail('CIRCUIT_DATA_INVALID','Circuit authoring record is missing.');
 if(r.type!==7||typeof r.value!=='string'||r.value.length>262144)throw fail('CIRCUIT_DATA_INVALID','Circuit authoring data is unavailable.');
 let data;try{data=JSON.parse(r.value);}catch{throw fail('CIRCUIT_DATA_INVALID','Circuit authoring data is unavailable.');}
 const id=v=>typeof v==='string'&&/^[0-9a-f]{32}$/.test(v);
 if(data?.version!==1)throw fail('CIRCUIT_DATA_INVALID','Unsupported Circuit authoring data version.');
 if(n.type==='circuit'){
  if(!Array.isArray(data.nets)||data.nets.length>LIMITS.nets||data.ground!==null&&!id(data.ground))throw fail('CIRCUIT_DATA_INVALID','Invalid Circuit nets.');
  const ids=new Set(),names=new Set();for(const net of data.nets){if(!net||!id(net.id)||ids.has(net.id)||typeof net.name!=='string'||!net.name||normalizeName(net.name)!==net.name||names.has(net.name))throw fail('CIRCUIT_DATA_INVALID','Invalid Circuit network.');ids.add(net.id);names.add(net.name);}if(data.ground!==null&&!ids.has(data.ground))throw fail('CIRCUIT_DATA_INVALID','Missing ground network.');
 }else{
  if(!Array.isArray(data.pins)||!data.pins.length||data.pins.length>LIMITS.pins)throw fail('CIRCUIT_DATA_INVALID','Invalid Circuit pins.');
  const ids=new Set();for(const p of data.pins){if(!p||!id(p.id)||ids.has(p.id)||typeof p.label!=='string'||!p.label||p.label.length>64||!Array.isArray(p.position)||p.position.length!==3||!p.position.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6)||p.net!==null&&!id(p.net))throw fail('CIRCUIT_DATA_INVALID','Invalid Circuit pin.');ids.add(p.id);}
 }
 return data;
}
export const saveData=(D,n,data)=>D.setRecord(n.nativeHash,RECORD,7,JSON.stringify(data));
// Ephemeral authoring connectivity, not a netlist, model validator or solver result.
export function topology(D,owner){
 const data=readData(D,owner),nets=new Map(data.nets.map(net=>[net.id,net]));
 const members=D.nodes.filter(n=>models[modelOf(n)]&&n.params.Circuit===owner.nativeHash);
 if(members.length>LIMITS.components)throw fail('LIMIT_EXCEEDED','Circuit supports at most 512 preview components.');
 const nodeForNet=id=>id===data.ground?'0':'n_'+id;
 const components=members.map(n=>({hash:n.nativeHash,kind:modelOf(n),enabled:n.enabled!==false,pins:readData(D,n).pins.map(p=>{
  if(p.net!==null&&!nets.has(p.net))throw fail('CIRCUIT_DATA_INVALID','Pin refers to a missing network in its Circuit.');
  return {id:p.id,label:p.label,position:[...p.position],net:p.net,node:p.net===null?'p_'+n.nativeHash+'_'+p.id:nodeForNet(p.net)};
 })})).sort((a,b)=>a.hash.localeCompare(b.hash));
 return {circuit:owner.nativeHash,stage:'authoring-preview',authoringOnly:true,numericalAvailable:false,enabled:owner.enabled!==false,ground:data.ground,
  nets:data.nets.map(net=>({...net,node:nodeForNet(net.id)})).sort((a,b)=>a.id.localeCompare(b.id)),components};
}
export function tree(points){
 if(points.length<2)return [];
 // A deterministic star is a connected tree, never an all-pairs graph.
 return points.slice(1).flatMap(p=>[...points[0],...p]);
}

// Authoring line symbols in local X/Z. No card, texture, billboard or simulation.
export function symbol(kind){
 const out=[],line=(a,b)=>out.push(a[0],0,a[1],b[0],0,b[1]),path=p=>p.slice(1).forEach((v,i)=>line(p[i],v)),circle=(x,z,r)=>{for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;line([x+r*Math.cos(a),z+r*Math.sin(a)],[x+r*Math.cos(b),z+r*Math.sin(b)]);}};
 if(['resistor','capacitor','inductor','diode','led','voltage','current'].includes(kind)){line([-10,0],[-5,0]);line([5,0],[10,0]);}
 if(kind==='resistor')path([[-5,0],[-4,2],[-2,-2],[0,2],[2,-2],[4,2],[5,0]]);
 else if(kind==='capacitor'){line([-5,0],[-1,0]);line([1,0],[5,0]);line([-1,-4],[-1,4]);line([1,-4],[1,4]);}
 else if(kind==='inductor'){const p=[];for(let i=0;i<=64;i++)p.push([-5+10*i/64,2*Math.sin(i*Math.PI/16)]);path(p);}
 else if(kind==='diode'||kind==='led'){path([[-5,-4],[-5,4],[4,0],[-5,-4]]);line([4,-4],[4,4]);if(kind==='led'){path([[0,6],[4,10],[1,9]]);line([4,10],[3,7]);path([[4,5],[8,9],[5,8]]);line([8,9],[7,6]);}}
 else if(kind==='voltage'||kind==='current'){circle(0,0,5);if(kind==='voltage'){line([-3,0],[-1,0]);line([-2,-1],[-2,1]);line([1,0],[3,0]);}else{path([[-3,0],[3,0],[1,2]]);line([3,0],[1,-2]);}}
 else if(kind==='bjt'){circle(0,0,8);line([-10,8],[-3,8]);line([-3,8],[-3,-5]);line([-3,3],[6,8]);line([-3,-2],[-10,-8]);line([6,8],[10,8]);path([[-8,-4],[-6,-5],[-8,-7]]);}
 else if(kind==='mosfet'){line([-10,8],[-4,8]);line([-4,8],[-4,-5]);line([-2,-6],[-2,6]);path([[-2,4],[7,4],[7,8],[10,8]]);path([[-2,-4],[-10,-4],[-10,-8]]);line([0,-8],[10,-8]);line([0,-8],[0,0]);}
 else{path([[-7,-6],[-7,6],[7,6],[7,-6],[-7,-6]]);for(const x of [-10,10])for(const z of [-8,8])line([x,z],[x*.7,z*.75]);}
 return new Float32Array(out);
}
export const bounds=kind=>kind==='circuit'?{min:[0,0,0],max:[0,0,0]}:{min:[-11,-.1,-10],max:[11,.1,11]};

// Uses Frame's documented render callback and borrowed camera/object uniforms.
// It creates no device, scene, animation loop, mesh mirror or numerical state.
const shader=`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct ObjectFrame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<uniform> object:ObjectFrame;
override orthographic:bool=false;
@vertex fn vs(@location(0) point:vec3f)->@builtin(position) vec4f{
 let world=(object.matrix*vec4f(point,1)).xyz;
 let p=frameCameraRelative(camera.rotation)*vec4f((world-camera.centerScale.xyz)*camera.centerScale.w,1);
 let xy=p.xy+camera.viewport.zw;let depth=-p.z;
 if(orthographic){return vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 return vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);
}
@fragment fn fs()->@location(0) vec4f{return object.color;}`;

export async function installSymbols(context,{find,members,read,symbol,bounds}){
 const D=context.document,M=context.math,geometry=new Map(Object.keys(models).map(kind=>[kind,symbol(kind)]));let state=null;
 const release=()=>{if(!state)return;state.retired=true;for(const r of state.geometry.values())r.buffer.destroy();for(const r of state.nets.values())r.buffer?.destroy();state=null;};
 const build=(device,format)=>{
  if(state?.device===device&&state.format===format)return state;
  release();const s=state={device,format,geometry:new Map(),nets:new Map(),groups:new WeakMap(),pipelines:[],ready:false,retired:false,error:null};
  const stage=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;
  s.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:stage,buffer:{type:'uniform'}},{binding:1,visibility:stage,buffer:{type:'uniform'}}]});
  const module=device.createShaderModule({label:'Circuit authoring line symbols',code:context.viewport.cameraWGSL+shader}),layout=device.createPipelineLayout({bindGroupLayouts:[s.layout]});
  for(const [kind,vertices]of geometry){const buffer=device.createBuffer({label:'Circuit '+kind+' shared symbol',size:vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,vertices);s.geometry.set(kind,{buffer,count:vertices.length/3});}
  s.pending=(async()=>{const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));await Promise.all([false,true].map(async(orthographic,i)=>{s.pipelines[i]=await device.createRenderPipelineAsync({label:'Circuit symbol lines',layout,vertex:{module,entryPoint:'vs',constants:{orthographic},buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'}});}));if(!s.retired){s.ready=true;context.requestDraw();}})().catch(e=>{s.error=e;console.error('Circuit symbol rendering unavailable:',e);});
  device.lost.then(()=>{if(state===s)release();});return s;
 };
 const shown=n=>{for(let p=n;p;p=D.nodes.find(q=>q.id===p.parent))if(!p.visible)return false;return true;};
 const netGeometry=n=>{
  const data=read(n),children=members(n),inverse=M.inv(D.world(n.nativeHash)),points=new Map(data.nets.map(net=>[net.id,[]]));
  if(children.length>LIMITS.components)return null;
  const stamp=JSON.stringify([data,Array.from(inverse),children.map(c=>[c.nativeHash,shown(c),D.world(c.nativeHash),D.records(c.nativeHash)])]);
  let row=state.nets.get(n.nativeHash);if(row?.stamp===stamp)return row;
  row?.buffer?.destroy();row={stamp,count:0,buffer:null};state.nets.set(n.nativeHash,row);
  for(const c of children){if(!shown(c))continue;const matrix=M.mul(inverse,D.world(c.nativeHash));for(const pin of read(c).pins)if(points.has(pin.net))points.get(pin.net).push(M.point(matrix,pin.position));}
  const vertices=new Float32Array([...points.values()].flatMap(tree));if(vertices.length){row.buffer=state.device.createBuffer({label:'Circuit network authoring lines',size:vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});state.device.queue.writeBuffer(row.buffer,0,vertices);row.count=vertices.length/3;}return row;
 };
 const render=({pass,camera,frame,orthographic,hash,device,format})=>{
  let n;try{n=find(hash);}catch{return;}const s=build(device,format);if(!s.ready)return;
  let row;try{row=n.type==='circuit'?(n.params.Nets?netGeometry(n):null):s.geometry.get(modelOf(n));}catch{return;}
  if(!row?.count)return;
  let group=s.groups.get(frame);if(!group||group.camera!==camera){group={camera,value:device.createBindGroup({layout:s.layout,entries:[{binding:0,resource:{buffer:camera}},{binding:1,resource:{buffer:frame}}]})};s.groups.set(frame,group);}
  pass.setPipeline(s.pipelines[orthographic?1:0]);pass.setBindGroup(0,group.value);pass.setVertexBuffer(0,row.buffer);pass.draw(row.count);
 };
 await context.viewport.register({renderKind:'helper',bounds:bounds('circuit'),pivot:[0,0,0],lines:new Float32Array(),color:[.72,.82,.74,1],selectedColor:[.95,.85,.6,1],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{discard;return vec4f(0.0);}',render,retire:hash=>{state?.nets.get(hash)?.buffer?.destroy();state?.nets.delete(hash);if(!D.nodes.some(n=>n.type==='circuit'||models[modelOf(n)]))release();}});
}

const empty={type:'object',properties:{},additionalProperties:false};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const hash={type:'string',pattern:'^[0-9a-f]{32}$'},name={type:'string',maxLength:128};
const unavailable=()=>{throw fail('CIRCUIT_AUTHORING_ONLY','Circuit is under construction. Electrical solving, controller execution, measured values and Scope are unavailable.');};

export async function activate(context){
 if(context.version!==1)throw fail('API_VERSION','Unsupported Frame plugin API.');
 const D=context.document,M=context.math;
 const find=hash=>{const n=D.nodes.find(n=>n.nativeHash===hash);if(!n||n.type!=='circuit'&&!models[modelOf(n)])throw fail('INVALID_OWNER','Select a Circuit authoring object.');return n;};
 const owner=hash=>{const n=find(hash);if(n.type!=='circuit')throw fail('INVALID_OWNER','Select a Circuit object.');return n;};
 const component=hash=>{const n=find(hash);if(!models[modelOf(n)])throw fail('INVALID_OWNER','Select a Circuit component.');return n;};
 const members=n=>D.nodes.filter(q=>models[modelOf(q)]&&q.params.Circuit===n.nativeHash);
 const update=fn=>{D.transaction(fn);context.requestAttributes();context.requestDraw();};
 const circuitFor=n=>{if(n.type==='circuit')return n;return owner(n.params.Circuit);};
 const inspect=hash=>{
  const n=find(hash),data=readData(D,n);
  if(n.type==='circuit')return {hash:n.nativeHash,type:n.type,stage:'authoring-preview',state:'under-construction',authoringOnly:true,numericalAvailable:false,measurementAvailable:false,controllerAvailable:false,scopeAvailable:false,ground:data.ground,nets:data.nets,components:members(n).map(q=>q.nativeHash),settings:{timeScaleSecondsPerSecond:n.params['Time scale'],historyBytes:n.params.History*1000000,netsVisible:n.params.Nets}};
  const parent=D.nodes.find(q=>q.nativeHash===n.params.Circuit&&q.type==='circuit'),nets=parent?readData(D,parent).nets:[];
  return {hash:n.nativeHash,type:n.type,kind:modelOf(n),circuit:n.params.Circuit||null,ownerAvailable:!!parent,parameters:{...n.params},pins:data.pins.map(p=>({...p,netName:nets.find(net=>net.id===p.net)?.name??null,voltage:null,availability:'solver-unavailable'})),authoringOnly:true,numericalAvailable:false};
 };
 const create=async(hash,args)=>{
  const n=owner(hash),kind=args.kind||'resistor',model=models[kind];if(!model)throw fail('INVALID_ARGUMENT','Unknown component kind.');
  readData(D,n);
  const count=members(n).length;if(count>=LIMITS.components)throw fail('LIMIT_EXCEEDED','Circuit supports at most 512 preview components.');
  if(args.pins&&kind!=='custom')throw fail('INVALID_ARGUMENT','Custom pins require the custom component kind.');
  const pins=args.pins?pinsFor(kind,args.pins):null;let created;
  update(()=>{created=D.create('circuit_'+kind,hash,args.name||model.label+(members(n).filter(q=>q.type==='circuit_'+kind).length+1));created.params.Circuit=hash;if(pins)saveData(D,created,{version:1,pins});const frame=M.I();frame[12]=(count%8)*30;frame[14]=Math.floor(count/8)*-30;created.creationFrame=Array.from(M.pack(frame));D.select(created.nativeHash,'objects');});
  await context.editor.selectOwner(created.nativeHash);
  return inspect(created.nativeHash);
 };
 const assign=(hash,args)=>{
  const n=component(hash),circuit=circuitFor(n),data=readData(D,n),network=readData(D,circuit),pin=data.pins.find(p=>p.id===args.pin);
  if(!pin)throw fail('INVALID_ARGUMENT','Pin must be an existing stable pin ID.');
  const label=normalizeName(args.name),existing=network.nets.find(net=>net.name===label);let net=existing;
  if(label&&!net){if(network.nets.length>=LIMITS.nets)throw fail('LIMIT_EXCEEDED','Circuit supports at most 1024 preview networks.');net={id:uid(),name:label};network.nets.push(net);}
  if(pin.net===(net?.id??null))return inspect(hash);
  pin.net=net?.id??null;update(()=>{saveData(D,circuit,network);saveData(D,n,data);});return inspect(hash);
 };
 const rename=(hash,args)=>{
  const n=owner(hash),data=readData(D,n),net=data.nets.find(net=>net.id===args.net),label=normalizeName(args.name);
  if(!net||!label)throw fail('INVALID_ARGUMENT','Choose an existing network and a nonempty name.');
  if(net.name===label)return inspect(hash);
  const target=data.nets.find(other=>other.id!==net.id&&other.name===label),plans=[];
  if(target){for(const q of members(n)){const d=readData(D,q);if(d.pins.some(p=>p.net===net.id)){for(const p of d.pins)if(p.net===net.id)p.net=target.id;plans.push([q,d]);}}if(data.ground===net.id)data.ground=target.id;data.nets=data.nets.filter(p=>p.id!==net.id);}else net.name=label;
  update(()=>{for(const [q,d]of plans)saveData(D,q,d);saveData(D,n,data);});return {...inspect(hash),merged:!!target,canonicalNet:target?.id??net.id};
 };
 context.operations.register([
  {id:'status',description:'Inspect native Circuit authoring data. No electrical result, running controller or Scope exists in this preview.',inputSchema:empty,readOnly:true,run:inspect},
  {id:'inspect',description:'Read stable component pins, networks and explicit owner references. Voltage is null with solver-unavailable, never a fabricated zero.',inputSchema:empty,readOnly:true,run:inspect},
  {id:'topology',description:'Read bounded authoring connectivity with stable node identifiers and explicit enabled states. Disconnected pins stay separate. This does not validate electrical models or calculate results.',inputSchema:empty,readOnly:true,run:hash=>topology(D,owner(hash))},
  {id:'create-component',description:'Create an ordinary native component and stable local pins. Authored mathematical parameters are not a qualified electrical model.',inputSchema:object({kind:{type:'string',enum:Object.keys(models)},name:{type:'string',minLength:1,maxLength:128},pins:{type:'array',minItems:1,maxItems:64,items:object({label:{type:'string',minLength:1,maxLength:64},position:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}},['label','position'])}},['kind']),readOnly:false,run:create},
  ...Object.entries(models).filter(([kind])=>kind!=='custom').map(([kind,model])=>({id:'create-'+kind,description:'Create one native '+model.name+' with stable pins and an explicit Circuit reference. Authoring preview only.',inputSchema:empty,readOnly:false,run:hash=>create(hash,{kind})})),
  {id:'assign-net',description:'Assign one stable pin by normalized name, create a new network if needed, or disconnect with an empty name. One native Undo transaction.',inputSchema:object({pin:hash,name},['pin','name']),readOnly:false,run:assign},
  {id:'create-net',description:'Create or return one owner-local network with a stable ID. Names use NFC, trim, case-sensitive matching.',inputSchema:object({name},['name']),readOnly:false,run:(hash,args)=>{const n=owner(hash),data=readData(D,n),label=normalizeName(args.name);if(!label)throw fail('INVALID_ARGUMENT','Network name is required.');let net=data.nets.find(q=>q.name===label);if(!net){if(data.nets.length>=LIMITS.nets)throw fail('LIMIT_EXCEEDED','Network limit reached.');net={id:uid(),name:label};data.nets.push(net);update(()=>saveData(D,n,data));}return {...net,circuit:hash};}},
  {id:'rename-net',description:'Rename one stable network; an existing name merges all references and Ground in one native Undo transaction.',inputSchema:object({net:hash,name},['net','name']),readOnly:false,run:rename},
  {id:'set-ground',description:'Choose an explicit existing owner-local reference network, or null. This does not connect any pin or compute a value.',inputSchema:object({net:{anyOf:[hash,{type:'null'}]}},['net']),readOnly:false,run:(hash,args)=>{const n=owner(hash),data=readData(D,n);if(args.net!==null&&!data.nets.some(q=>q.id===args.net))throw fail('INVALID_ARGUMENT','Ground must be a network of this Circuit.');if(data.ground!==args.net){data.ground=args.net;update(()=>saveData(D,n,data));}return inspect(hash);}},
  {id:'move-component',description:'Explicitly move a component to another Circuit and disconnect its pins. Native grouping alone never changes electrical membership.',inputSchema:object({circuit:hash},['circuit']),readOnly:false,run:(hash,args)=>{const n=component(hash),target=owner(args.circuit);readData(D,target);if(n.params.Circuit===target.nativeHash)return inspect(hash);if(members(target).length>=LIMITS.components)throw fail('LIMIT_EXCEEDED','Target Circuit component limit reached.');const data=readData(D,n);for(const p of data.pins)p.net=null;update(()=>{n.params.Circuit=target.nativeHash;saveData(D,n,data);});return inspect(hash);}},
  ...['solve','transient','ac','reset','scope','controller','results','export-netlist'].map(id=>({id,description:'Unavailable in this under-construction authoring preview. Always rejects before mutation or electrical work.',inputSchema:{type:'object',properties:{},additionalProperties:true},readOnly:true,run:unavailable}))
 ]);
 context.editor.register({
  created:n=>{if(n.type==='circuit'||models[modelOf(n)])saveData(D,n,initial(n));},
  parameters:(n,changes)=>{if(n.type!=='circuit'&&!models[modelOf(n)])return null;const params={...n.params,...changes};if(n.type!=='circuit'&&params.Circuit!==''&&!D.nodes.some(q=>q.type==='circuit'&&q.nativeHash===params.Circuit))throw fail('INVALID_ARGUMENT','Circuit reference must be an existing native Circuit hash.');if(n.type!=='circuit'&&changes.Circuit!==undefined&&changes.Circuit!==n.params.Circuit&&readData(D,n).pins.some(p=>p.net!==null))throw fail('CONNECTED_COMPONENT','Use move-component to change a connected component owner.');if(n.type!=='circuit'&&changes.Circuit&&changes.Circuit!==n.params.Circuit){const target=owner(changes.Circuit);readData(D,target);if(members(target).length>=LIMITS.components)throw fail('LIMIT_EXCEEDED','Target Circuit component limit reached.');}return {};},
  bounds:hash=>{const n=D.nodes.find(q=>q.nativeHash===hash);return n?.type==='circuit'?bounds('circuit'):models[modelOf(n)]?bounds(modelOf(n)):null;}
 });
 context.attributes.register(hash=>{const n=find(hash),notice={id:'status',label:'Under construction',disabled:true};return n.type==='circuit'?{actions:[notice],groups:[{label:'Components',actions:Object.entries(models).filter(([kind])=>kind!=='custom').map(([kind,m])=>({id:'create-'+kind,label:m.label}))}],units:{'Time scale':'s/s',History:'MB'}}:{actions:[notice],units:models[modelOf(n)].units};});
 // The owner itself has no decorative geometry. Symbols are ordinary local lines.
 await installSymbols(context,{find,members,read:n=>readData(D,n),modelOf,symbol,bounds});
}
