// Authoring only. This module neither interprets nor emits machine commands.
export const STORAGE_KEY='frame.cut.settings';
export const BLOCKS=Object.freeze(['Start G-code','Finish G-code','Tool on G-code','Tool off G-code']);
export const DEFAULTS=Object.freeze({Mode:'Cut',Speed:1000,Passes:1,'Line width':.2,'Lead-in':1,...Object.fromEntries(BLOCKS.map(k=>[k,'']))});
export const failure=(code,message)=>Object.assign(new Error(message),{code});
export function validate(params){
  if(!['Cut','Mark'].includes(params.Mode))throw failure('INVALID_ARGUMENT','Invalid Cut mode.');
  if(!Number.isFinite(params.Speed)||params.Speed<.001)throw failure('INVALID_ARGUMENT','Speed must be at least 0.001 mm/min.');
  if(!Number.isSafeInteger(params.Passes)||params.Passes<1)throw failure('INVALID_ARGUMENT','Passes must be a positive safe integer.');
  for(const k of ['Line width','Lead-in'])if(!Number.isFinite(params[k])||params[k]<0)throw failure('INVALID_ARGUMENT',k+' must be nonnegative.');
  for(const k of BLOCKS)if(typeof params[k]!=='string'||params[k].length>16384||!params[k].isWellFormed())throw failure('INVALID_ARGUMENT',k+' must be valid Unicode text of at most 16384 code units.');
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,params[k]]));
}
export function loadSettings(storage){
  try{const record=JSON.parse(storage.getItem(STORAGE_KEY));if(record?.version===1)return {params:validate({...DEFAULTS,...record.params}),source:'local',storageAvailable:true};}catch{}
  return {params:{...DEFAULTS},source:'factory',storageAvailable:!!storage};
}
// Coalesced native observations, not a parallel scene. New owners alone receive
// defaults; native duplication/HASH overwrite params with their authored values.
export function settingsObserver(context,storage){
  let last=loadSettings(storage),seen=new Map(),references=new Map(),queued=false;
  function observe(exclude=null){
    const owners=context.document.nodes.filter(n=>n.type==='cut'&&n!==exclude),next=new Map(),changed=[];
    const restored=owners.some(n=>references.has(n.nativeHash)&&references.get(n.nativeHash)!==n);
    for(const n of owners){try{const p=validate(n.params),key=JSON.stringify(p);next.set(n.nativeHash,key);if(restored||seen.get(n.nativeHash)!==key)changed.push({n,p});}catch{}}
    seen=next;references=new Map(owners.map(n=>[n.nativeHash,n]));if(!changed.length)return;
    const selected=context.document.selected.filter(n=>n.type==='cut');
    const chosen=(changed.length>1&&selected.length===1?changed.find(x=>x.n===selected[0]):null)||changed.at(-1);
    last={params:chosen.p,source:'native',owner:chosen.n.nativeHash,storageAvailable:!!storage};
    try{storage?.setItem(STORAGE_KEY,JSON.stringify({version:1,params:last.params}));}catch{last.storageAvailable=false;}
  }
  return {observe,schedule(){if(!queued){queued=true;queueMicrotask(()=>{queued=false;observe();});}},created(n){if(n.type==='cut'){observe(n);Object.assign(n.params,last.params);}},status(){return {...last,params:{...last.params}};}};
}
