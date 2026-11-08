import {RECORD,LIMITS,models,fail,uid,normalizeName,modelOf,initial,pinsFor,readData,saveData} from './data.js';
import {symbol,bounds} from './symbols.js';
import {installSymbols} from './viewport.js';

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
  {id:'create-component',description:'Create an ordinary native component and stable local pins. Authored mathematical parameters are not a qualified electrical model.',inputSchema:object({kind:{type:'string',enum:Object.keys(models)},name:{type:'string',minLength:1,maxLength:128},pins:{type:'array',minItems:1,maxItems:64,items:object({label:{type:'string',minLength:1,maxLength:64},position:{type:'array',minItems:3,maxItems:3,items:{type:'number'}}},['label','position'])}},['kind']),readOnly:false,run:create},
  ...Object.entries(models).filter(([kind])=>kind!=='custom').map(([kind,model])=>({id:'create-'+kind,description:'Create one native '+model.name+' with stable pins and an explicit Circuit reference. Authoring preview only.',inputSchema:empty,readOnly:false,run:hash=>create(hash,{kind})})),
  {id:'assign-net',description:'Assign one stable pin by normalized name, create a new network if needed, or disconnect with an empty name. One native Undo transaction.',inputSchema:object({pin:hash,name},['pin','name']),readOnly:false,run:assign},
  {id:'create-net',description:'Create or return one owner-local network with a stable ID. Names use NFC, trim, case-sensitive matching.',inputSchema:object({name},['name']),readOnly:false,run:(hash,args)=>{const n=owner(hash),data=readData(D,n),label=normalizeName(args.name);if(!label)throw fail('INVALID_ARGUMENT','Network name is required.');let net=data.nets.find(q=>q.name===label);if(!net){if(data.nets.length>=LIMITS.nets)throw fail('LIMIT_EXCEEDED','Network limit reached.');net={id:uid(),name:label};data.nets.push(net);update(()=>saveData(D,n,data));}return {...net,circuit:hash};}},
  {id:'rename-net',description:'Rename one stable network; an existing name merges all references and Ground in one native Undo transaction.',inputSchema:object({net:hash,name},['net','name']),readOnly:false,run:rename},
  {id:'set-ground',description:'Choose an explicit existing owner-local reference network, or null. This does not connect any pin or compute a value.',inputSchema:object({net:{anyOf:[hash,{type:'null'}]}},['net']),readOnly:false,run:(hash,args)=>{const n=owner(hash),data=readData(D,n);if(args.net!==null&&!data.nets.some(q=>q.id===args.net))throw fail('INVALID_ARGUMENT','Ground must be a network of this Circuit.');if(data.ground!==args.net){data.ground=args.net;update(()=>saveData(D,n,data));}return inspect(hash);}},
  {id:'move-component',description:'Explicitly move a component to another Circuit and disconnect its pins. Native grouping alone never changes electrical membership.',inputSchema:object({circuit:hash},['circuit']),readOnly:false,run:(hash,args)=>{const n=component(hash),target=owner(args.circuit);if(n.params.Circuit===target.nativeHash)return inspect(hash);if(members(target).length>=LIMITS.components)throw fail('LIMIT_EXCEEDED','Target Circuit component limit reached.');const data=readData(D,n);for(const p of data.pins)p.net=null;update(()=>{n.params.Circuit=target.nativeHash;saveData(D,n,data);});return inspect(hash);}},
  ...['solve','transient','ac','reset','scope','controller','results','export-netlist'].map(id=>({id,description:'Unavailable in this under-construction authoring preview. Always rejects before mutation or electrical work.',inputSchema:{type:'object',properties:{},additionalProperties:true},readOnly:true,run:unavailable}))
 ]);
 context.editor.register({
  created:n=>{if(n.type==='circuit'||models[modelOf(n)])saveData(D,n,initial(n));},
  parameters:(n,changes)=>{if(n.type!=='circuit'&&!models[modelOf(n)])return null;const params={...n.params,...changes};if(n.type!=='circuit'&&params.Circuit!==''&&!D.nodes.some(q=>q.type==='circuit'&&q.nativeHash===params.Circuit))throw fail('INVALID_ARGUMENT','Circuit reference must be an existing native Circuit hash.');if(n.type!=='circuit'&&changes.Circuit!==undefined&&changes.Circuit!==n.params.Circuit&&readData(D,n).pins.some(p=>p.net!==null))throw fail('CONNECTED_COMPONENT','Use move-component to change a connected component owner.');return {};},
  bounds:hash=>{const n=D.nodes.find(q=>q.nativeHash===hash);return n?.type==='circuit'?bounds('circuit'):models[modelOf(n)]?bounds(modelOf(n)):null;}
 });
 context.attributes.register(hash=>{const n=find(hash),notice={id:'status',label:'Under construction',disabled:true};return n.type==='circuit'?{actions:[notice],groups:[{label:'Components',actions:Object.entries(models).filter(([kind])=>kind!=='custom').map(([kind,m])=>({id:'create-'+kind,label:m.label}))}],units:{'Time scale':'s/s',History:'MB'}}:{actions:[notice],units:models[modelOf(n)].units};});
 // The owner itself has no decorative geometry. Symbols are ordinary local lines.
 await installSymbols(context,{find,members,read:n=>readData(D,n),modelOf,symbol,bounds});
}
