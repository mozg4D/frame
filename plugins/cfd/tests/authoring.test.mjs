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
test('native activation registers only authoring and explicit unavailable operations',async()=>{
 const {context,registrations,nodes}=fixture();await activate(context);const {operations,viewport,editor,attributes}=registrations;assert.deepEqual(operations.map(o=>o.id),['status','solve-frame','solve-animation','results']);assert.ok(operations.every(o=>o.readOnly));assert.equal(viewport.lines.length,90);assert.deepEqual(viewport.pivot,[-500,0,-500]);assert.match(viewport.shader,/discard/);assert.deepEqual(attributes('a'),{actions:[{id:'status',label:'Under construction',disabled:true}]});assert.equal(editor.parameters(nodes[2],{}),null);assert.throws(()=>editor.parameters(nodes[0],{Speed:-1}),e=>e.code==='INVALID_ARGUMENT');assert.equal(nodes[0].params.Speed,20);
});
test('status is detached, independent and never a physical or geometry result',async()=>{
 const {context,registrations,nodes}=fixture();await activate(context);const status=registrations.operations[0].run,a=status('a'),b=status('b');assert.equal(a.parameters.Speed,20);assert.equal(b.parameters.Speed,35);assert.equal(a.authoringOnly,true);for(const key of ['solverAvailable','resultsAvailable','geometryDiagnosticAvailable','geometryEvaluated'])assert.equal(a[key],false);assert.deepEqual(a.registeredTags,[]);a.parameters.Speed=0;a.localBox.min[0]=9;assert.equal(nodes[0].params.Speed,20);assert.equal(status('a').localBox.min[0],-500);assert.throws(()=>status('missing'),e=>e.code==='INVALID_OWNER');assert.throws(()=>status('x'),e=>e.code==='INVALID_OWNER');
});
test('all numerical contracts reject without authoring changes',async()=>{
 const {context,registrations,nodes}=fixture();await activate(context);const before=JSON.stringify(nodes);for(const operation of registrations.operations.slice(1))assert.throws(()=>operation.run('a',{anything:true}),e=>e.code==='CFD_AUTHORING_ONLY');assert.equal(JSON.stringify(nodes),before);
});
test('activation fails explicitly on unsupported context without registering',async()=>{
 const {context,registrations}=fixture();context.version=2;await assert.rejects(activate(context),e=>e.code==='API_VERSION');assert.deepEqual(registrations,{});
});
test('status is bounded for 10000 completed calls, without GPU work',async()=>{
 const {context,registrations}=fixture();await activate(context);const started=performance.now();for(let i=0;i<10000;i++)registrations.operations[0].run(i%2?'a':'b');const ms=performance.now()-started;assert.ok(ms<1000,`10000 status calls: ${ms} ms`);
});
