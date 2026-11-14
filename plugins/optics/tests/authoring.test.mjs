import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate} from '../plugin.js';
import {validateRelations,helper,bounds,roles} from '../plugin.js';
const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
const defaults=type=>Object.fromEntries(Object.entries(manifest.objects.find(o=>o.type===type).fields).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));
const node=(type,hash,patch={})=>({nativeHash:hash,type,params:{...defaults(type),...patch},enabled:true});
function host(){
 const nodes=[node('optics','a'),node('optics','b')],h={version:1,mutations:0,math:{I:()=>{const m=new Float64Array(16);m[0]=m[5]=m[10]=m[15]=1;return m;},pack:m=>Array.from(m)},document:{nodes,transaction(fn){h.mutations++;fn();},create(type,parent,name){const n=node(type,String(nodes.length));n.parent=parent;n.name=name;nodes.push(n);return n;},select(hash){h.selected=hash;}},operations:{register(ops){h.ops=new Map(ops.map(o=>[o.id,o]));}},editor:{register(hooks){h.hooks=hooks;},async selectOwner(hash){h.selected=hash;}},attributes:{register(fn){h.attributesFor=fn;}},viewport:{async register(v){h.viewportDescriptor=v;}}};return h;
}
test('native manifest declares five roles, stable references and native 32px artwork',async()=>{
 assert.equal(manifest.objects.length,5);assert.equal(manifest.name,'Optics (unfinished)');
 for(const role of roles)assert.equal(defaults('optics_'+role).Optics,'');
 assert.equal(defaults('optics_subject').Sensor,'');assert.equal(defaults('optics_source').Target,'');
 assert.deepEqual(manifest.tags.map(t=>t.kind),['optics_blocker','optics_optical']);
 assert.equal(manifest.tags[1].fields.Model[0],'Unassigned');
 const svg=await readFile(new URL('../icon.svg',import.meta.url),'utf8');assert.match(svg,/width="32" height="32" viewBox="0 0 32 32"/);
});
test('all four planes use one native transaction and explicit owner selection',async()=>{
 const h=host();await activate(h);const t=performance.now();
 for(const role of roles){const r=await h.ops.get('add-plane').run('a',{role});assert.equal(r.parameters.Optics,'a');assert.equal(h.selected,r.hash);assert.equal(h.document.nodes.at(-1).parent,'a');assert.equal(h.document.nodes.at(-1).creationFrame[14],['subject','source'].includes(role)?-75:75);}
 assert.equal(h.mutations,4);assert.equal(h.ops.get('status').run('a').planes.length,4);assert.equal(h.ops.get('status').run('b').planes.length,0);assert.ok(performance.now()-t<100,'bounded creation descriptor work');
 await assert.rejects(h.ops.get('add-plane').run('a',{role:'unknown'}),{code:'INVALID_ARGUMENT'});assert.equal(h.mutations,4);
});
test('typed same-task links reject cross-task assignments and dangling receiver moves',()=>{
 const a=node('optics','a'),b=node('optics','b'),s=node('optics_subject','s',{Optics:'a',Sensor:'r'}),r=node('optics_sensor','r',{Optics:'a'}),other=node('optics_sensor','o',{Optics:'b'}),nodes=[a,b,s,r,other];
 assert.deepEqual(validateRelations(nodes,s,s.params),{});
 assert.throws(()=>validateRelations(nodes,s,{...s.params,Sensor:'o'}),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>validateRelations(nodes,r,{...r.params,Optics:'b'}),{code:'OPTICS_LINKED_PLANE'});
 assert.throws(()=>validateRelations(nodes,s,{...s.params,Sensor:'absent'}),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>validateRelations(nodes,s,{...s.params,Optics:'b'}),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>validateRelations(nodes,s,{...s.params,Sensor:'a'}),{code:'INVALID_ARGUMENT'});
 assert.deepEqual(validateRelations(nodes,s,{...s.params,Sensor:''}),{});
});
test('Infinity disables finite depth constraints but cannot silently restore invalid finite range',async()=>{
 const h=host();await activate(h);const s=node('optics_subject','s',{Optics:'a','Depth min':10,'Depth max':-10});h.document.nodes.push(s);
 assert.throws(()=>h.hooks.parameters(s,{}),{code:'INVALID_ARGUMENT'});
 assert.deepEqual(h.hooks.parameters(s,{Distance:'Infinity'}),{});s.params.Distance='Infinity';
 assert.deepEqual(h.attributesFor('s').hiddenFields,['Depth min','Depth max']);
 assert.throws(()=>h.hooks.parameters(s,{Distance:'Finite'}),{code:'INVALID_ARGUMENT'});
 assert.deepEqual(h.hooks.parameters(s,{Distance:'Finite','Depth min':-10,'Depth max':10}),{});
});
test('no solver is implied; all unavailable operations reject without mutation',async()=>{
 const h=host();await activate(h);const before=JSON.stringify(h.document.nodes);
 for(const id of ['solve','optimize','stop','create-result','to-mesh','results'])assert.throws(()=>h.ops.get(id).run('a',{}),{code:'OPTICS_AUTHORING_ONLY'});
 const s=h.ops.get('status').run('a');assert.equal(s.state,'unfinished');assert.equal(s.measuredPower,null);assert.equal(s.calculatedImage,null);
 for(const k of ['sceneSolverAvailable','optimizerAvailable','materialPhysicsAvailable','resultAvailable','viewportEdgePickingAvailable'])assert.equal(s[k],false);
 assert.equal(JSON.stringify(h.document.nodes),before);assert.equal(h.mutations,0);
 assert.ok(h.attributesFor('a').actions.every(a=>a.disabled));assert.equal(h.attributesFor('a').groups[0].actions.length,4);
 for(const op of h.ops.values())assert.equal(op.inputSchema.additionalProperties,false);
});
test('orphan reference inspection diagnoses without silently rebinding',async()=>{
 const h=host();await activate(h);const n=node('optics_source','s',{Optics:'missing',Target:'old'});h.document.nodes.push(n);
 const before=JSON.stringify(n),r=h.ops.get('inspect').run('s');assert.ok(r.issues.length);assert.equal(r.parameters.Optics,'missing');assert.equal(JSON.stringify(n),before);
});
test('finite tiny shared line geometry has native bounds and no ray/scene arrays',async()=>{
 assert.equal(helper('optics').length,72);assert.equal(helper('plane').length,42);assert.ok([...helper('plane'),...helper('optics')].every(Number.isFinite));assert.equal(bounds('optics_sensor').min[2],0);
 const h=host();await activate(h);assert.equal(h.viewportDescriptor.lines.length,0);assert.equal(typeof h.viewportDescriptor.render,'function');assert.equal(h.viewportDescriptor.enabledAffectsVisibility,false);
 const source=await readFile(new URL('../plugin.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/requestDevice|setInterval|requestAnimationFrame|scene\.capture|experiments\/optics/);
});
