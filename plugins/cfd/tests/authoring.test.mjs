import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate,LOCAL_BOX,helperLines,validateParameters} from '../plugin.js';
const defaults={Speed:20,Medium:'Air',Altitude:0,Ground:'None'};
function fixture(){
 const nodes=[{nativeHash:'a',type:'cfd',params:{...defaults}},{nativeHash:'b',type:'cfd',params:{...defaults,Speed:35}},{nativeHash:'x',type:'cube',params:{}}],registrations={};
 const context={version:1,document:{nodes},operations:{register:x=>registrations.operations=x},editor:{register:x=>registrations.editor=x},attributes:{register:x=>registrations.attributes=x},viewport:{register:async x=>{registrations.viewport=x;}}};
 return {nodes,registrations,context};
}
test('manifest declares a lazy native CFD owner with canonical field options and no tags or numerical assets',async()=>{
 const m=JSON.parse(await readFile(new URL('../plugin.json',import.meta.url),'utf8'));assert.equal(m.id,'cfd');assert.equal(m.module,'plugin.js');assert.equal(m.objects.length,1);assert.deepEqual(m.objects[0].fields,{Speed:20,Medium:['Air','Water'],Altitude:0,Ground:['None','Road']});assert.equal(m.objects[0].fieldOptions.Speed.minimum,0);assert.equal(m.objects[0].fieldOptions.Speed.unit,'m/s');assert.equal(m.objects[0].fieldOptions.Altitude.unit,'m');assert.equal(m.tags,undefined);assert.equal(m.assets,undefined);
});
test('parameters validate before mutation; no arbitrary atmosphere limits',()=>{
 for(const p of [defaults,{...defaults,Speed:0},{...defaults,Speed:1e12,Altitude:-500},{...defaults,Medium:'Water',Ground:'Road'}])assert.doesNotThrow(()=>validateParameters(p));
 for(const p of [{Speed:-1},{Speed:NaN},{Speed:Infinity},{Altitude:Infinity},{Medium:'Oil'},{Ground:'Moving'}])assert.throws(()=>validateParameters({...defaults,...p}),e=>e.code==='INVALID_ARGUMENT');
});
test('box/pivot and arrow use twelve native edges and face-to-face direction',()=>{
 assert.deepEqual(LOCAL_BOX,{min:[-500,0,-500],max:[500,1000,500],pivot:[-500,0,-500]});const l=helperLines();assert.ok(l instanceof Float32Array);assert.equal(l.length,15*6);assert.ok([...l].every(Number.isFinite));assert.deepEqual([...l.slice(72,78)],[-500,500,0,500,500,0]);l[0]=42;assert.notEqual(helperLines()[0],42);
});
test('native activation registers box authoring, wall kinematics and explicit flow availability',async()=>{
 const {context,registrations,nodes}=fixture();await activate(context);const {operations,viewport,editor,attributes}=registrations;
 assert.deepEqual(operations.filter(o=>o.readOnly).map(o=>o.id),['status','wall-motion','results','probe','shape-gradient']);
 assert.deepEqual(operations.filter(o=>!o.readOnly).map(o=>o.id),['solve-frame','stop','drag-map','pressure-map','separation-map','shape-map']);
 assert.equal(viewport.lines.length,90);assert.deepEqual(viewport.pivot,[-500,0,-500]);assert.match(viewport.shader,/discard/);
 assert.equal(attributes('a').actions.find(a=>a.id==='solve-frame').cancel,'stop');
 nodes[1].params.Medium='Water';assert.deepEqual(attributes('b').hiddenFields,['Ground','Altitude']);
 assert.equal(editor.parameters(nodes[2],{}),null);assert.throws(()=>editor.parameters(nodes[0],{Speed:-1}),e=>e.code==='INVALID_ARGUMENT');assert.equal(nodes[0].params.Speed,20);
});
test('status is detached, independent and never a physical or geometry result',async()=>{
 const {context,registrations,nodes}=fixture();await activate(context);const status=registrations.operations[0].run,a=status('a'),b=status('b');assert.equal(a.parameters.Speed,20);assert.equal(b.parameters.Speed,35);assert.equal(a.authoringOnly,false);assert.equal(a.geometryDiagnosticAvailable,true);assert.equal(a.solverAvailable,true);for(const key of ['resultsAvailable','geometryEvaluated'])assert.equal(a[key],false);assert.deepEqual(a.registeredTags,[]);a.parameters.Speed=0;a.localBox.min[0]=9;assert.equal(nodes[0].params.Speed,20);assert.equal(status('a').localBox.min[0],-500);assert.throws(()=>status('missing'),e=>e.code==='INVALID_OWNER');assert.throws(()=>status('x'),e=>e.code==='INVALID_OWNER');
});
test('invalid fidelity and motion probes reject before geometry work; fresh boxes have no result',async()=>{
 const {context,registrations,nodes}=fixture();await activate(context);const before=JSON.stringify(nodes);
 const op=id=>registrations.operations.find(o=>o.id===id);
 assert.throws(()=>op('solve-frame').run('a',{fidelityBudget:'arbitrary'}),e=>e.code==='INVALID_ARGUMENT');
 assert.deepEqual(op('results').run('a'),{state:'dirty',job:null,result:null});assert.equal(op('stop').run('a').state,'dirty');
 for(const p of [[[1,2]],[[0,1,NaN]],Array(65).fill([0,0,0])])assert.throws(()=>op('wall-motion').run('a',{pointsWorldM:p}),e=>e.code==='INVALID_ARGUMENT');assert.equal(JSON.stringify(nodes),before);
});
test('activation fails explicitly on unsupported context without registering',async()=>{
 const {context,registrations}=fixture();context.version=2;await assert.rejects(activate(context),e=>e.code==='API_VERSION');assert.deepEqual(registrations,{});
});
test('status is bounded for 10000 completed calls, without GPU work',async()=>{
 const {context,registrations}=fixture();await activate(context);const started=performance.now();for(let i=0;i<10000;i++)registrations.operations[0].run(i%2?'a':'b');const ms=performance.now()-started;assert.ok(ms<1000,`10000 status calls: ${ms} ms`);
});
