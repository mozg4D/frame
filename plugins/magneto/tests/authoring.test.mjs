import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate} from '../plugin.js';
const manifest=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));
function host(){
  const fields=manifest.objects[0].fields;
  const nodes=['first','second'].map(nativeHash=>({nativeHash,type:'magneto',params:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]))}));
  const h={version:1,document:{nodes},operations:{register(v){h.ops=new Map(v.map(o=>[o.id,o]));}},attributes:{register(v){h.attributesFor=v;}},viewport:{async register(v){h.viewportDescriptor=v;}},update(hash,patch){Object.assign(nodes.find(n=>n.nativeHash===hash).params,patch);h.mutations++;},mutations:0};
  h.editor={register(hooks){h.hooks=hooks;}};return h;
}
test('native manifest has only intended plane fields and Material tag',()=>{
  assert.deepEqual(Object.keys(manifest.objects[0].fields),['Mode','Quantity','Presentation','Current Density']);
  assert.deepEqual(Object.keys(manifest.tags[0].fields),['Material']);
  assert.equal(manifest.tags[0].kind,'magneto');
  assert.deepEqual(manifest.objects[0].fieldOptions,{'Current Density':{unit:'A/mm²',access:'read-write'}});
  assert.match(manifest.description,/Unfinished/);
});
test('exact mode and visualization rows, one combination active, no fake solve',async()=>{
  const h=host();await activate(h);const a=h.attributesFor('first');
  assert.deepEqual(a.actions.slice(0,2).map(x=>[x.row,x.label]),[['Mode','Solve'],['Mode','Current Density']]);
  assert.deepEqual(a.actions.slice(2,10).map(x=>[x.row,x.label]),['B','H','Magnetization','Saturation'].flatMap(q=>['Strokes','Section'].map(p=>[q,p])));
  assert.equal(a.actions.slice(2,10).filter(x=>x.active).length,1);
  assert.ok(a.actions.filter(x=>x.row==='Solve').every(x=>x.disabled));
  for(const op of h.ops.values()){assert.ok(op.inputSchema);assert.equal(op.inputSchema.additionalProperties,false);}
  for(const id of ['solve-frame','solve-animation','force','torque','reset-magnetization']){
    assert.throws(()=>h.ops.get(id).run('first',{}),{code:'MAGNETO_AUTHORING_ONLY'});
  }
  assert.equal(h.mutations,0);
  assert.ok(!a.actions.some(x=>/Force|Torque|Reset/.test(x.label)));
});
test('native updates isolate owner, mode hides view fields and keeps signed animatable scalar',async()=>{
  const h=host();await activate(h);const start=performance.now();
  h.ops.get('mode-current-density').run('first');
  h.document.nodes[0].params['Current Density']=-12;
  const a=h.attributesFor('first');
  assert.deepEqual(a.hiddenFields,['Mode','Quantity','Presentation']);
  assert.deepEqual(a.actions.map(x=>x.label),['Solve','Current Density','Unfinished']);
  assert.equal(h.document.nodes[1].params.Mode,'Solve');
  for(const id of [...h.ops.keys()].filter(k=>k.startsWith('view-')))h.ops.get(id).run('first');
  assert.equal(h.document.nodes[0].params.Quantity,'Saturation');
  assert.equal(h.document.nodes[0].params.Presentation,'Section');
  assert.equal(h.document.nodes[0].params['Current Density'],-12);
  assert.ok(performance.now()-start<100,'bounded native descriptor/update CPU work');
  assert.throws(()=>h.ops.get('mode-solve').run('missing'),{code:'INVALID_OWNER'});
});
test('finite XY plane uses core helper and has no synthetic field renderer',async()=>{
  const h=host();await activate(h);const v=h.viewportDescriptor;
  assert.deepEqual(v.bounds,{min:[-50,-50,0],max:[50,50,0]});
  assert.equal(v.lines.length,24);assert.ok([...v.lines].every(Number.isFinite));
  assert.equal(v.render,undefined);assert.match(v.shader,/discard/);
  const s=h.ops.get('status').run('first');assert.equal(s.state,'unfinished');
  for(const k of ['solverAvailable','materialPhysicsAvailable','currentConductorAvailable','fieldAvailable','resultAvailable','persistentMagnetizationAvailable','curvesAvailable'])assert.equal(s[k],false);
});
test('runtime has no secondary scene, GPU device, timers or reference imports',async()=>{
  const source=await readFile(new URL('../plugin.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/requestAnimationFrame|setInterval|createElement|requestDevice|scene\.capture|from ['"]/);
  const svg=await readFile(new URL('../icon.svg',import.meta.url),'utf8');assert.match(svg,/width="32" height="32" viewBox="0 0 32 32"/);
});
test('native fallback is non-destructive and explicit Frame Material wins',async()=>{
  const h=host();await activate(h);
  const n={nativeHash:'mesh',type:'mesh',tags:[{kind:'magneto',params:{Material:'NdFeB N52'}}]};h.document.nodes.push(n);
  const before=JSON.stringify(n);assert.deepEqual(h.hooks.surfaceStyle('mesh'),{color:[.62,.64,.67,1],topmost:false});
  assert.equal(JSON.stringify(n),before);assert.equal(h.mutations,0);
  n.tags.push({kind:'material',params:{}});assert.equal(h.hooks.surfaceStyle('mesh'),null);
  assert.equal(h.hooks.surfaceStyle('first'),null);
  const source=await readFile(new URL('../../../index.html',import.meta.url),'utf8');
  assert.match(source,/function pluginSurfaceStyle\(mesh\)\{return mesh\.materialTags\?\.length\?null:FramePlugins\.dispatch\('surfaceStyle',mesh\.hashId\);\}/);
});
test('borrowed native identity index invalidates for create/delete/history/open and reads current tags',async()=>{
  const h=host();await activate(h);const n={nativeHash:'mesh',type:'mesh',tags:[{kind:'magneto',params:{Material:'Pure Iron'}}]};
  h.document.nodes.push(n);assert.deepEqual(h.hooks.surfaceStyle('mesh').color,[.48,.49,.5,1]);
  n.tags[0].params.Material='NdFeB N52';assert.deepEqual(h.hooks.surfaceStyle('mesh').color,[.62,.64,.67,1]);
  n.tags=[];assert.equal(h.hooks.surfaceStyle('mesh'),null);
  const replacement={...n,tags:[{kind:'magneto',params:{Material:'Electrical Steel M19'}}]};h.document.nodes[h.document.nodes.length-1]=replacement;h.hooks.documentChanged();
  assert.deepEqual(h.hooks.surfaceStyle('mesh').color,[.39,.43,.47,1]);
  h.document.nodes.pop();assert.equal(h.hooks.surfaceStyle('mesh'),null);
  h.document.nodes.push(replacement);h.hooks.created(replacement);assert.ok(h.hooks.surfaceStyle('mesh'));
  h.document.nodes=[...h.document.nodes.slice(0,-1),{...replacement,tags:[]}];assert.equal(h.hooks.surfaceStyle('mesh'),null);
  h.document.nodes[h.document.nodes.length-1]=replacement;h.hooks.documentChanged();assert.ok(h.hooks.surfaceStyle('mesh'));
});
test('20k untagged native surface lookups have linear traversal and bounded completed CPU latency',async t=>{
  const h=host();await activate(h);const measured=[];
  for(const size of [1000,10000,20000]){
    let visits=0;const nodes=Array.from({length:size},(_,i)=>({nativeHash:'mesh'+i,type:'mesh',tags:[]}));
    const originalMap=nodes.map;nodes.map=function(fn){return originalMap.call(this,(n,...args)=>{visits++;return fn(n,...args);});};
    h.document.nodes=nodes;h.hooks.documentChanged();const start=performance.now();
    for(const n of nodes)assert.equal(h.hooks.surfaceStyle(n.nativeHash),null);
    const ms=performance.now()-start;measured.push({size,ms,visits});
    assert.equal(visits,size,'one metadata index construction, not one linear scene scan per mesh');
    assert.ok(ms<100,`${size} completed lookup pass ${ms} ms exceeds 100 ms CPU budget`);
  }
  t.diagnostic(JSON.stringify(measured));
});
