import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate,parseBands,validateTerminal,terminalDefaults,rfOwner,rfRoles,helperGeometry} from '../plugin.js';
const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
function fixture(){
  let hooks,attributes,viewport,serial=0,transactions=0,selections=0;const nodes=[],ops=new Map();
  const D={nodes,transaction:fn=>{transactions++;fn();},create:(type,parent)=>{const p=nodes.find(n=>n.nativeHash===parent),n={id:'n'+(++serial),nativeHash:serial.toString(16).padStart(32,'0'),type,parent:p?.id||null,params:type==='rf_terminal'?{...terminalDefaults}:{},tags:[]};nodes.push(n);hooks?.created(n);return n;},select:()=>{selections++;}};
  const forbidden=()=>{throw Error('Forbidden numerical/API access');};
  const context={version:1,document:D,editor:{register:h=>{hooks=h;},selectOwner:async()=>{}},attributes:{register:h=>{attributes=h;}},operations:{register:items=>items.forEach(o=>ops.set(o.id,o))},viewport:{register:async v=>{viewport=v;}},update:(hash,patch)=>{const n=nodes.find(n=>n.nativeHash===hash);hooks.parameters(n,patch);transactions++;Object.assign(n.params,patch);hooks.documentChanged();},get device(){return forbidden();},scene:{capture:forbidden},api:{call:forbidden}};
  return {context,D,nodes,ops,get hooks(){return hooks;},get attributes(){return attributes;},get viewport(){return viewport;},get transactions(){return transactions;},get selections(){return selections;}};
}
test('GHz bands preserve independent ranges and singleton frequencies',()=>{
  assert.deepEqual(parseBands('2.4–2.5, 5.15-5.85, .9'),[{lowGHz:2.4,highGHz:2.5},{lowGHz:5.15,highGHz:5.85},{lowGHz:.9,highGHz:.9}]);
  for(const text of ['', '0', '-1', '3–2', 'NaN', 'Infinity', '2e9', '2,,3', '2 GHz', '1-2-3',Array(33).fill('1').join(',')])assert.throws(()=>parseBands(text),{code:'INVALID_BANDS'});
});
test('Terminal validation is physical-input metadata validation, not a solver',()=>{
  for(const patch of [{Power:-1},{Phase:Infinity},{'Load resistance':0},{'Reference impedance':-1},{RX:1},{Bands:'5-2'},{Surprise:1}])assert.throws(()=>validateTerminal({...terminalDefaults,...patch}));
  assert.equal(validateTerminal({...terminalDefaults,TX:true,RX:true,'Load reactance':-30}).RX,true);
  assert.equal(validateTerminal({...terminalDefaults,TX:false,RX:false}).TX,false);
});
test('nearest native RF ownership works through groups, nested owners and cycles',()=>{
  const a={id:'a',type:'rf'},b={id:'b',type:'rf',parent:'a'},g={id:'g',type:'group',parent:'b'},t={id:'t',type:'rf_terminal',parent:'g'},map=new Map([a,b,g,t].map(n=>[n.id,n]));
  assert.equal(rfOwner(t,map),b);g.parent='a';assert.equal(rfOwner(t,map),a);g.parent='t';assert.equal(rfOwner(t,map),null);
});
test('conflicting inherited material markers are detected without conflating goals',()=>{
  const a={id:'a',tags:[{kind:'rf_metal'}]},b={id:'b',parent:'a',tags:[{kind:'rf_dielectric'},{kind:'rf_target'}]},map=new Map([a,b].map(n=>[n.id,n]));
  assert.equal(rfRoles(b,map).materialConflict,true);b.tags=[{kind:'rf_target'},{kind:'rf_avoid'}];assert.equal(rfRoles(b,map).materialConflict,false);
});
test('native-sized icon and distinct finite helper geometry',async()=>{
  const {plane,cube}=helperGeometry();assert.equal(plane.lines.length,24);assert.equal(cube.lines.length,72);assert.equal(plane.bounds.min[2],plane.bounds.max[2]);assert.equal(cube.bounds.max[0]-cube.bounds.min[0],2);
  const icon=await readFile(new URL('../icon.svg',import.meta.url),'utf8');assert.match(icon,/width="32" height="32" viewBox="0 0 32 32"/);assert.doesNotMatch(icon,/transform=/);
  assert.equal(manifest.tags.length,5);assert.ok(manifest.tags.every(t=>t.kind.startsWith('rf_')));
});
test('native authoring operations stay independent and reject numerics before resource access',async()=>{
  const f=fixture();await activate(f.context);const call=(id,hash,args={})=>f.ops.get(id).run(hash,args),a=f.D.create('rf'),b=f.D.create('rf');
  const t=await call('add-terminal',a.nativeHash),s=await call('add-section',a.nativeHash),other=await call('add-terminal',b.nativeHash);
  assert.equal(f.transactions,3);assert.equal(f.selections,3);assert.deepEqual(call('status',a.nativeHash).terminals,[t.hash]);assert.deepEqual(call('status',a.nativeHash).sections,[s.hash]);assert.deepEqual(call('status',b.nativeHash).terminals,[other.hash]);
  const begin=performance.now();for(let i=0;i<1000;i++)call('status',a.nativeHash);assert.ok(performance.now()-begin<500,'1000 authoring observations under 500ms');
  call('toggle-rx',t.hash);assert.equal(call('status',t.hash).params.RX,true);assert.equal(call('status',other.hash).params.RX,false);
  const before=JSON.stringify(f.nodes),count=f.transactions;
  for(const op of ['solve','optimize','results'])assert.throws(()=>call(op,a.nativeHash),{code:'RF_AUTHORING_ONLY'});
  assert.throws(()=>call('settings',t.hash,{Bands:'3-1',Power:42}),{code:'INVALID_BANDS'});
  assert.equal(JSON.stringify(f.nodes),before);assert.equal(f.transactions,count);
  const node=f.nodes.find(n=>n.nativeHash===t.hash);node.parent=null;f.hooks.documentChanged();assert.equal(call('status',t.hash).diagnostic,'UNASSIGNED_TERMINAL');assert.equal(f.hooks.rowColor(node),'#ee554b');
  assert.equal(f.hooks.parameters({type:'cube'},{}),null);assert.equal(f.hooks.rowColor({id:'plain',type:'cube',tags:[]}),null);
  assert.equal(f.viewport.helpers.rf_terminal.lines.length,72);assert.ok([...f.ops.values()].every(op=>op.inputSchema.additionalProperties===false));
});
test('minimal controls follow TX/RX and Matching, with no fabricated result',async()=>{
  const f=fixture();await activate(f.context);const rf=f.D.create('rf'),t=f.D.create('rf_terminal',rf.nativeHash),attrs=()=>f.attributes(t.nativeHash);
  assert.ok(attrs().hiddenFields.includes('Load resistance'));assert.ok(!attrs().actions.some(a=>a.label==='Matching'));
  Object.assign(t.params,{TX:false,RX:true,Matching:false});assert.ok(attrs().hiddenFields.includes('Power'));assert.ok(!attrs().hiddenFields.includes('Load resistance'));assert.ok(attrs().actions.some(a=>a.label==='Matching'));
  assert.ok(f.attributes(rf.nativeHash).actions.some(a=>a.label==='Unfinished'&&a.disabled));
  const status=f.ops.get('status').run(rf.nativeHash);assert.equal(status.resultsAvailable,false);assert.ok(!Object.hasOwn(status,'field'));assert.ok(!Object.hasOwn(status,'impedance'));
});
test('material conflict diagnostics are explicit and bounded metadata',async()=>{
  const f=fixture();await activate(f.context);const rf=f.D.create('rf');
  for(let i=0;i<130;i++){const n=f.D.create('cube');n.tags=[{kind:'rf_metal'},{kind:'rf_dielectric'}];}
  const conflicts=f.ops.get('status').run(rf.nativeHash).materialConflicts;
  assert.equal(conflicts.total,130);assert.equal(conflicts.hashes.length,128);assert.equal(conflicts.truncated,true);
  assert.equal(f.hooks.rowColor(f.nodes.at(-1)),null);assert.equal(f.viewport.surfaceWarnings,false);
});
