import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {core,manifest} from './native-creation-fixture.mjs';

const line=start=>{const a=core.indexOf(start),b=core.indexOf('\n',a);assert.ok(a>=0&&b>a,start);return core.slice(a,b);};
const between=(a,b)=>core.slice(core.indexOf(a),core.indexOf(b,core.indexOf(a)));
const id=c=>c.repeat(32),owner=id('a'),fan=id('b'),record=id('c'),tag=id('d'),other=id('e');
function fixture(){
 const entry={manifest},types=new Map(manifest.objects.map(o=>[o.type,entry])),tagDefinitions={};
 const helpers=[line('  function owner(n)'),line('  function referenceField('),line('  function remapAuthoring(')].join('\n');
 const FramePlugins=new Function('types','tagDefinitions',helpers+';return {owner,referenceField,remapAuthoring};')(types,tagDefinitions);
 const definitions=Object.fromEntries(manifest.objects.map(o=>[o.type,[o.name,'plugin:thermal',o.fields]]));
 const FramePluginRecords=new Function('crypto',between('const FramePluginRecords=(()=>{','// Strict known plugin-tag')+';return FramePluginRecords;')(webcrypto);
 const validate=new Function('FramePlugins','definitions','tagDefinitions',line('function frameValidateAuthoring(')+';return frameValidateAuthoring;')(FramePlugins,definitions,tagDefinitions);
 const channels=[];
 const restore=new Function('FramePlugins','defaults','definitions','tagDefinitions','FramePluginRecords','frameRestoreChannels',line('function frameRestoreAuthoring(')+';return frameRestoreAuthoring;')(FramePlugins,f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])),definitions,tagDefinitions,FramePluginRecords,rows=>channels.push(rows));
 const serialize=new Function('frameCurves','FrameMorph','FramePlugins','FramePluginRecords',line('function frameAuthoring(')+';return frameAuthoring;')({}, {sceneChannels:()=>new Map(),serializedTags:(_n,t)=>t},FramePlugins,FramePluginRecords);
 return {FramePlugins,validate,restore,serialize,channels};
}
const metadata=()=>({version:1,plugin:{id:'thermal',type:'thermal_fan',params:{Thermal:owner,'Shutoff pressure':0,'Free flow':.1,Direction:'Forward'}},
 tags:[{uid:tag,kind:'thermal_material',params:{Conductivity:8,'Heat capacity':1000000,FutureOpaque:{ownerHint:owner,values:[1,2,3]}}},{uid:id('f'),kind:'thermal_heater',params:{Power:75}}],
 animation:[['tag:'+tag+':Conductivity',{kind:'number',dimensions:1,keys:[[0,{v:8}]]}]],
 recordValues:{[record]:{type:6,value:[1,2,3]}}});

test('current core preserves unsupported Thermal tags and declared binary records through native restore/save',()=>{
 const f=fixture(),a=f.validate(JSON.stringify(metadata())),node={id:'n',nativeHash:fan,type:'group',params:{},tags:[]};f.restore(node,a);
 assert.equal(node.type,'thermal_fan');assert.deepEqual(node.tags,[]);assert.deepEqual(node.ignoredAuthoring.tags,a.tags);assert.deepEqual(node.ignoredAuthoring.animation,a.animation);
 const out=f.serialize(node);assert.deepEqual(out.plugin,a.plugin);assert.deepEqual(out.tags,a.tags);assert.deepEqual(out.animation,a.animation);assert.deepEqual(Array.from(out.recordValues[record].value),[1,2,3]);
 assert.equal(out.recordValues[record].type,6);assert.deepEqual(metadata().tags,a.tags);
});

test('copy remaps declared Thermal references, preserves opaque tag payloads and marks them unresolved',()=>{
 const f=fixture(),a=metadata(),copy=f.FramePlugins.remapAuthoring(a,new Map([[owner,other],[fan,id('1')],[tag,id('2')]]));
 assert.equal(copy.plugin.params.Thermal,other);assert.equal(copy.tags[0].uid,id('2'));assert.equal(copy.tags[0].referencesUnresolved,true);
 assert.deepEqual(copy.tags[0].params,a.tags[0].params);assert.equal(copy.animation[0][0],'tag:'+id('2')+':Conductivity');
 assert.deepEqual(copy.recordValues,a.recordValues);assert.deepEqual(a,metadata());
 const node={id:'copy',type:'group',params:{},tags:[]};f.restore(node,f.validate(JSON.stringify(copy)));const saved=f.serialize(node);
 assert.deepEqual(saved.tags,copy.tags);assert.deepEqual(saved.animation,copy.animation);assert.equal(saved.plugin.params.Thermal,other);
});

test('unknown plugin payload survives inactive restore/save and remains unresolved after identity copy',()=>{
 const f=fixture(),a=metadata();a.plugin={id:'future-thermal-extension',type:'future_thermal',params:{unknownOwner:owner,opaque:[1,'two']}};
 const copy=f.FramePlugins.remapAuthoring(a,new Map([[owner,other]]));assert.equal(copy.pluginReferencesUnresolved,true);assert.deepEqual(copy.plugin,a.plugin);
 const node={id:'unknown',type:'group',params:{},tags:[]};f.restore(node,f.validate(JSON.stringify(copy)));const saved=f.serialize(node);
 assert.equal(node.type,'group');assert.deepEqual(saved.plugin,a.plugin);assert.equal(saved.pluginReferencesUnresolved,true);assert.deepEqual(saved.tags,copy.tags);
});

test('current native importer explicitly reports unavailable authoring and undeclared extension omission',()=>{
 assert.match(core,/ignoredExtensionRecords=\[\.\.\.map\.keys\(\)\]\.filter\(id=>!records\.has\(id\)\)/);
 assert.match(core,/importReport=\{format:'hash',unavailablePlugins,unavailableTags,ignoredExtensionRecords,opaqueData:/);
 assert.match(core,/Unknown extension records are omitted\./);
});
