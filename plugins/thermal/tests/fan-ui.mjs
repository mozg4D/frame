import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './authoring-preview.mjs';
import {math,core} from './native-creation-fixture.mjs';
import {historyFixture} from './native-history-fixture.mjs';

test('Fan and Probe hide owner controls; Pressure aliases only the stable native field label',async()=>{
 const f=await fixture(),fan=await f.command('create-fan'),probe=await f.command('create-probe');
 assert.deepEqual(f.attributes(fan.hash).hiddenFields,['Thermal','Direction']);assert.deepEqual(f.attributes(probe.hash).hiddenFields,['Thermal']);
 assert.deepEqual(f.attributes(fan.hash).labels,{'Shutoff pressure':'Pressure'});assert.equal(f.attributes(fan.hash).units['Shutoff pressure'],'Pa');
 assert.equal(f.native.nodes.find(n=>n.nativeHash===fan.hash).params.Thermal,f.owner.nativeHash);assert.equal(f.native.nodes.find(n=>n.nativeHash===probe.hash).params.Thermal,f.owner.nativeHash);assert.equal(f.deviceReads,0);
});
test('Existing Reverse, pressure, ownership and native 25 mm frame survive sync and authoring Undo without migration',async()=>{
 const f=await fixture(),fan=await f.command('create-fan'),n=f.native.nodes.find(n=>n.nativeHash===fan.hash),legacy=math.I();
 legacy[0]=legacy[5]=legacy[10]=.25;legacy.set([7,8,9],12);f.native.setLocal(fan.hash,legacy);n.params.Direction='Reverse';n.params['Shutoff pressure']=17;f.native.sync();
 assert.deepEqual(Array.from(f.native.local(fan.hash)),Array.from(legacy));assert.deepEqual(f.command('fan-inputs',{},fan.hash).fan.directionLocal,[-1,0,0]);assert.equal(n.params['Shutoff pressure'],17);
 const before=structuredClone(f.native.nodes),h=historyFixture(before);h.deleteOwner(f.owner.nativeHash);await h.undo();assert.deepEqual(h.nodes,before);
 assert.equal(h.nodes.find(n=>n.nativeHash===fan.hash).params.Direction,'Reverse');assert.equal(h.nodes.find(n=>n.nativeHash===fan.hash).params.Thermal,f.owner.nativeHash);
});
test('Actual scalar label code changes text only, keeps native input identity and applies units afterward',()=>{
 const a=core.indexOf('for(const [key,label]of Object.entries(state?.labels||{}))'),b=core.indexOf('for(const vector of state?.vectors||[])',a);assert.ok(a>0&&b>a);
 const field={key:'Shutoff pressure',value:12,closest:()=>({querySelector:()=>label})},label={textContent:'Shutoff pressure'},content={querySelector:selector=>selector==='[data-field="Shutoff pressure"]'?field:null};
 const run=new Function('state','content',core.slice(a,b));run({labels:{'Shutoff pressure':'Pressure',Absent:'Ignored'},units:{'Shutoff pressure':'Pa'}},content);
 assert.equal(label.textContent,'Pressure (Pa)');assert.equal(field.key,'Shutoff pressure');assert.equal(field.value,12);
 label.textContent='Shutoff pressure';run({labels:{'Shutoff pressure':5}},content);assert.equal(label.textContent,'Shutoff pressure');
});
test('Plugin helper hit geometry never captures native pointer, wheel or context events',async()=>{
 const a=core.indexOf('    function drawPluginHits('),b=core.indexOf('    function pluginSurfaceStyle(',a),body=core.slice(a,b);
 assert.match(body,/path\.style\.pointerEvents='none'/);assert.doesNotMatch(body,/onclick|addEventListener|stopPropagation|preventDefault/);
 const plugin=await readFile(new URL('../plugin.js',import.meta.url),'utf8');assert.doesNotMatch(plugin,/addEventListener|interceptsPointer|contextMenu|pointerdown|wheel/);
});
test('Actual helper picker respects active view, clipping, visibility, retirement and topmost helper order',()=>{
 const a=core.indexOf('    function pickPluginHelper('),b=core.indexOf('    function drawPluginHits(',a),paths=[{dataset:{hash:'first'},isPointInStroke:p=>p.x===12&&p.y===14},{dataset:{hash:'last'},isPointInStroke:p=>p.x===12&&p.y===14}],nodes=[{nativeHash:'first',visible:true},{nativeHash:'last',visible:true}];
 const doc={},canvas={ownerDocument:doc};let refresh=0;const svg={isConnected:true,ownerDocument:doc,dataset:{view:'2'},style:{display:'block'},getBoundingClientRect:()=>({left:100,top:200,right:200,bottom:300}),querySelectorAll:()=>paths},views=new Map([[2,svg]]),run=new Function('lightHelperViews','viewIndex','nodes','pluginShown','canvas','drawLightHelpers',core.slice(a,b)+'return pickPluginHelper;')(views,2,nodes,n=>n.visible,canvas,()=>refresh++);
 assert.equal(run(112,214),'last');nodes[1].visible=false;assert.equal(run(112,214),'first');nodes.splice(0,1);assert.equal(run(112,214),null);nodes[0].visible=true;
 assert.equal(run(99,214),null);assert.equal(run(112,300),null);assert.equal(run(115,214),null);svg.style.display='none';assert.equal(run(112,214),null);svg.style.display='block';svg.isConnected=false;assert.equal(run(112,214),null);svg.isConnected=true;svg.ownerDocument={};assert.equal(run(112,214),null);svg.ownerDocument=doc;svg.dataset.view='3';assert.equal(run(112,214),null);assert.ok(refresh>=10);
});
test('Native queued selection keeps replace/add/toggle semantics for helpers without direct selectRow',async()=>{
 const a=core.indexOf('    async function selectElementNow('),b=core.indexOf('    function topologyEditPipelines(',a);assert.ok(a>0&&b>a);const events=[];
 const select=new Function('FramePlugins','clearMotionSelection','pickPluginHelper','selectObjectHashes',core.slice(a,b)+'return selectElementNow;')({dispatch:()=>false},()=>{},()=> 'helper',(hashes,operation)=>events.push({hashes,operation}));
 for(const operation of ['replace','add','toggle'])await select(10,20,operation);
 assert.deepEqual(events,['replace','add','toggle'].map(operation=>({hashes:['helper'],operation})));
});

test('Real native context-menu handler is silent in object mode and opens ordinary helper menu in component mode',async()=>{
 const a=core.indexOf("    canvas.addEventListener('contextmenu',async event=>{event.preventDefault();if(navigationMenuSuppressed)return;"),b=core.indexOf("    canvas.addEventListener('wheel'",a);assert.ok(a>0&&b>a);
 for(const mode of ['object','vertex']){let handler,prevented=0,menus=0;new Function('canvas','navigationMenuSuppressed','elementMode','current','objectMenu',core.slice(a,b))({addEventListener:(type,fn)=>{assert.equal(type,'contextmenu');handler=fn;}},false,mode,()=>({type:'thermal_fan'}),()=>menus++);await handler({clientX:1,clientY:2,preventDefault:()=>prevented++});assert.equal(prevented,1);assert.equal(menus,mode==='object'?0:1);}
});

test('Helper misses do not search the native node array and a topmost hit resolves only once',()=>{
 const a=core.indexOf('    function pickPluginHelper('),b=core.indexOf('    function drawPluginHits(',a),count=10000,nodes=Array.from({length:count},(_,i)=>({nativeHash:String(i)})),doc={};let searches=0,hit=false;const original=nodes.find.bind(nodes);nodes.find=fn=>{searches++;return original(fn);};const paths=nodes.map(n=>({dataset:{hash:n.nativeHash},isPointInStroke:()=>hit})),svg={isConnected:true,ownerDocument:doc,dataset:{view:'0'},style:{},getBoundingClientRect:()=>({left:0,top:0,right:100,bottom:100}),querySelectorAll:()=>paths};const run=new Function('lightHelperViews','viewIndex','nodes','pluginShown','canvas','drawLightHelpers',core.slice(a,b)+'return pickPluginHelper;')(new Map([[0,svg]]),0,nodes,()=>true,{ownerDocument:doc},()=>{});const start=performance.now();assert.equal(run(50,50),null);assert.equal(searches,0);hit=true;assert.equal(run(50,50),String(count-1));assert.equal(searches,1);const ms=performance.now()-start;assert.ok(ms<100,'10k source-extracted helper miss/hit CPU budget');console.log(JSON.stringify({operation:'10k helper path miss and topmost hit; SVG/refresh adapters',wallMs:ms,budgetMs:100,nodeSearches:searches,hardwareVerified:false}));
});
