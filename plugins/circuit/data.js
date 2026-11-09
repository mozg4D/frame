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
