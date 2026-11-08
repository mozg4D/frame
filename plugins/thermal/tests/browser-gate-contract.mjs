import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {activate} from '../plugin.js';
import {isHardwareAdapter,isDecodedNativeIcon,hasBoundedFrameTimings,restoresAuthoringRows,captureAuthoringRejection} from './browser-gates.mjs';

// These are CPU negative controls for real hardware-harness acceptance logic,
// not a substitute for decoding an image, running a browser or hardware WebGPU.
const harness=await readFile(new URL('./authoring-browser.mjs',import.meta.url),'utf8');
const probeHarness=await readFile(new URL('./native-probe-browser.mjs',import.meta.url),'utf8');
const hardware={vendor:'nvidia',architecture:'test identity',isFallbackAdapter:false};
const icon={decoded:true,complete:true,width:32,height:32,naturalWidth:32,naturalHeight:32,rect:{width:32,height:32}};
const sample=()=>({timestampQueries:true,frames:Array.from({length:12},()=>({cpuMs:1,gpuMs:2}))});
const owner='a'.repeat(32),fan='b'.repeat(32),probe='c'.repeat(32),hashes=[owner,fan,probe];
const rows=()=>[
 {hash:owner,type:'thermal',parent:null,matrix:[1,0,0,0,1,0,0,0,1,0,0,0],worldMatrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],params:{Ambient:20,Initial:20}},
 {hash:fan,type:'thermal_fan',parent:owner,matrix:[.25,0,0,0,.25,0,0,0,.25,-25,-12.5,-12.5],worldMatrix:[.25,0,0,0,0,.25,0,0,0,0,.25,0,-25,-12.5,-12.5,1],params:{Thermal:owner,Direction:'Forward','Shutoff pressure':0,'Free flow':.1}},
 {hash:probe,type:'thermal_probe',parent:owner,matrix:[.02,0,0,0,.02,0,0,0,.02,0,0,0],worldMatrix:[.02,0,0,0,0,.02,0,0,0,0,.02,0,0,0,0,1],params:{Thermal:owner}}
];

test('hardware gate requires explicit false fallback flag, identifiable device and no software identity',()=>{
 assert.equal(isHardwareAdapter(hardware),true);
 for(const isFallbackAdapter of [undefined,null,true,0,'false'])assert.equal(isHardwareAdapter({...hardware,isFallbackAdapter}),false);
 for(const bad of [null,{}, {isFallbackAdapter:false},{vendor:'SwiftShader',isFallbackAdapter:false},{architecture:'llvmpipe',isFallbackAdapter:false}])assert.equal(isHardwareAdapter(bad),false);
 const absent={...hardware};delete absent.isFallbackAdapter;assert.equal(isHardwareAdapter(absent),false);
});

test('icon gate rejects broken, undecoded, natural-size mismatched and layout-scaled images despite 32 px attributes',()=>{
 assert.equal(isDecodedNativeIcon(icon),true);
 for(const key of ['decoded','complete'])assert.equal(isDecodedNativeIcon({...icon,[key]:false}),false);
 for(const key of ['naturalWidth','naturalHeight','width','height'])for(const value of [undefined,0,16,64])assert.equal(isDecodedNativeIcon({...icon,[key]:value}),false);
 for(const key of ['width','height'])for(const value of [0,16,31.999,64])assert.equal(isDecodedNativeIcon({...icon,rect:{...icon.rect,[key]:value}}),false);
 assert.equal(isDecodedNativeIcon({...icon,rect:undefined}),false);assert.equal(isDecodedNativeIcon(null),false);
});

test('Fan frame gate requires exactly twelve timestamp-query samples before every()',()=>{
 assert.equal(hasBoundedFrameTimings(sample()),true);
 for(const count of [0,1,11,13])assert.equal(hasBoundedFrameTimings({...sample(),frames:Array.from({length:count},()=>({cpuMs:1,gpuMs:2}))}),false);
 for(const timestampQueries of [false,undefined,0])assert.equal(hasBoundedFrameTimings({...sample(),timestampQueries}),false);
 for(const key of ['cpuMs','gpuMs'])for(const value of [undefined,NaN,Infinity,50,51]){const bad=sample();bad.frames[11][key]=value;assert.equal(hasBoundedFrameTimings(bad),false);}
 assert.equal(hasBoundedFrameTimings({...sample(),frames:undefined}),false);
});

test('delete Undo cannot pass on empty, wrong-count, missing or duplicated expected hashes',()=>{
 const expected=rows();assert.equal(restoresAuthoringRows(rows(),expected,hashes),true);
 assert.equal(restoresAuthoringRows([],expected,hashes),false);assert.equal(restoresAuthoringRows([],[],hashes),false);
 for(let i=0;i<3;i++){
  const missing=rows();missing.splice(i,1);assert.equal(restoresAuthoringRows(missing,expected,hashes),false);
  const wrong=rows();wrong[i].hash='d'.repeat(32);assert.equal(restoresAuthoringRows(wrong,expected,hashes),false);
  const duplicate=rows();duplicate[i].hash=duplicate[(i+1)%3].hash;assert.equal(restoresAuthoringRows(duplicate,expected,hashes),false);
 }
 assert.equal(restoresAuthoringRows([...rows(),{...rows()[0],hash:'d'.repeat(32)}],expected,hashes),false);
 assert.equal(restoresAuthoringRows(rows(),expected,[owner,fan,fan]),false);
 assert.equal(restoresAuthoringRows(rows(),expected,[owner,fan]),false);
});

test('delete Undo requires every owner/Fan/Probe local/world frame, parent, reference and parameters',()=>{
 const expected=rows();for(let i=0;i<3;i++)for(const field of ['matrix','worldMatrix','parent','type','params']){
  const actual=rows();if(field==='matrix'||field==='worldMatrix')actual[i][field][0]+=1;else if(field==='params')actual[i].params={...actual[i].params,unexpected:true};else actual[i][field]='wrong';
  assert.equal(restoresAuthoringRows(actual,expected,hashes),false,`must reject ${i} ${field}`);
 }
 for(const i of [1,2]){const actual=rows();actual[i].params.Thermal='d'.repeat(32);assert.equal(restoresAuthoringRows(actual,expected,hashes),false);}
 assert.equal(restoresAuthoringRows([...rows()].reverse(),expected,hashes),true,'row order does not replace durable native identity');
});

function sourceBindings(main,probe){
 assert.match(main,/import \{isHardwareAdapter,isDecodedNativeIcon,hasBoundedFrameTimings,restoresAuthoringRows,captureAuthoringRejection\} from '\.\/browser-gates\.mjs';/);
 assert.match(probe,/import \{isHardwareAdapter\} from '\.\/browser-gates\.mjs';/);
 assert.match(main,/check\('preview uses identifiable hardware WebGPU',isHardwareAdapter\(hardware\),hardware\)/);
 assert.match(probe,/check\('Probe harness uses identifiable hardware WebGPU',isHardwareAdapter\(hardware\),hardware\)/);
 assert.match(main,/await page\.locator\('#tabPlugins'\)\.click\(\)/);
 assert.match(main,/evaluate\(async img=>\{await img\.decode\(\);const rect=img\.getBoundingClientRect\(\);return \{decoded:true,complete:img\.complete,width:img\.width,height:img\.height,naturalWidth:img\.naturalWidth,naturalHeight:img\.naturalHeight,rect:\{width:rect\.width,height:rect\.height\}\}/);
 assert.match(main,/check\('native Thermal icon decodes at its genuine displayed dimensions',isDecodedNativeIcon\(icon\),icon\)/);
 assert.match(main,/const afterFrames=await call\('diagnostics\.frame',\{frames:12\}\)/);
 assert.match(main,/check\('native authoring helper CPU\/GPU frame budget',hasBoundedFrameTimings\(afterFrames\),\{beforeFrames,afterFrames\}\)/);
 assert.match(main,/const restoredRows=await inspect\(\);check\('delete Undo restores native helper identities and references',restoresAuthoringRows\(restoredRows,savedRows,\[owner\.hash,fanHash,probe\.hash\]\)/);
 assert.match(main,/'plugins\/thermal\/tests\/browser-gates\.mjs'/);assert.match(probe,/'plugins\/thermal\/tests\/browser-gates\.mjs'/);
 assert.match(main,/const forbidden=\['solve-grid','solve-scene','measure','inspect','inspect-velocity'\]/);
 assert.match(main,/await timed\('all numerical calls reject without authoring mutation',1500,async\(\)=>\{/);
 assert.match(main,/for\(const operation of forbidden\)\{\s*const result=await page\.evaluate\(captureAuthoringRejection,\{id:operation==='measure'\?probe\.hash:owner\.hash,operation,args:\{deliberatelyUnsupported:true\}\}\);\s*check\(operation\+' explicitly rejects',result\.resolved===false&&result\.code==='THERMAL_AUTHORING_ONLY',result\);\s*\}/);
 assert.match(main,/check\('numerical rejections preserve native scene',equal\(await inspect\(\),before\)\)/);

}
test('actual browser harness observation and acceptance call sites are bound to the tested guard module',()=>sourceBindings(harness,probeHarness));

test('source-binding controls reject removed or misbound hardware, decode, frame and Undo guards',()=>{
 for(const [needle,replacement]of [
  ['isHardwareAdapter(hardware),hardware','true,hardware'],
  ['await img.decode();',''],
  ['const rect=img.getBoundingClientRect();','const rect={width:32,height:32};'],
  ['isDecodedNativeIcon(icon),icon','true,icon'],
  ['hasBoundedFrameTimings(afterFrames)','true'],
  ['restoresAuthoringRows(restoredRows,savedRows,[owner.hash,fanHash,probe.hash])','true'],
  ["await page.locator('#tabPlugins').click();",''],
  ['page.evaluate(captureAuthoringRejection,','page.evaluate(otherCallback,'],
  ["id:operation==='measure'?probe.hash:owner.hash",'id:owner.hash'],
  ['operation,args:{deliberatelyUnsupported:true}','operation:otherOperation,args:{}'],
  ['result.resolved===false&&',''],
  ["result.code==='THERMAL_AUTHORING_ONLY'","result.message.includes('THERMAL_AUTHORING_ONLY')"],
  ["result.code==='THERMAL_AUTHORING_ONLY'",'true'],
  ["all numerical calls reject without authoring mutation',1500","all numerical calls reject without authoring mutation',15000"],
  ["'numerical rejections preserve native scene',equal(await inspect(),before)","'numerical rejections preserve native scene',true"]
 ]){assert.ok(harness.includes(needle),needle);assert.throws(()=>sourceBindings(harness.replace(needle,replacement),probeHarness),needle);}
 assert.throws(()=>sourceBindings(harness,probeHarness.replace('isHardwareAdapter(hardware),hardware','true,hardware')));
});


// CPU realm/JSON/structured-clone controls are not Playwright or hardware runs.
// Execute the actual callback's serialized source with only the browser API.
const transported=value=>JSON.parse(JSON.stringify(value));
const inPage=(call,input)=>runInNewContext(`(${captureAuthoringRejection.toString()})(input)`,{frameAI:{call},input:transported(input)});
const rejectionExpression=harness.match(/check\(operation\+' explicitly rejects',([^,]+),result\)/)?.[1];
assert.ok(rejectionExpression,'extract the real harness rejection predicate');
const accepts=result=>runInNewContext(rejectionExpression,{result});
const numericalLoop=harness.slice(harness.indexOf("  await timed('all numerical calls reject without authoring mutation'"),harness.indexOf("  check('numerical rejections preserve native scene'"));
assert.ok(numericalLoop.length>0,'extract the real harness numerical loop');
const request={id:owner,operation:'solve-grid',args:{deliberatelyUnsupported:true}};
const rejection=()=>Object.assign(new Error('Native authoring rejection'),{code:'THERMAL_AUTHORING_ONLY'});

async function runNumericalLoop(evaluate){
 const checks=[],timings=[];
 await runInNewContext(`(async()=>{${numericalLoop}})()`,{
  page:{evaluate},captureAuthoringRejection,owner:{hash:owner},probe:{hash:probe},
  forbidden:runInNewContext(harness.match(/const forbidden=(\[[^;]+\]);/)[1]),
  check(name,pass,detail){checks.push({name,pass,detail});assert.equal(pass,true,name);},
  async timed(name,limit,fn){timings.push({name,limit});return await fn();}
 });
 return {checks,timings};
}

test('in-page callback preserves real plugin Error.code and message for every numerical endpoint',async()=>{
 let operations,deviceReads=0;
 await activate({version:1,document:{},operations:{register:value=>operations=value},editor:{register(){}},attributes:{register(){}},viewport:{async register(){}},get device(){deviceReads++;throw Error('Unexpected device access');}});
 const started=performance.now();
 for(const operation of ['solve-grid','solve-scene','measure','inspect','inspect-velocity']){
  const run=operations.find(o=>o.id===operation).run;let nativeError;
  try{run(request.id,request.args);}catch(error){nativeError=error;}
  assert.ok(nativeError instanceof Error);assert.equal(Object.hasOwn(nativeError,'code'),true);
  const result=transported(await inPage((name,input)=>{assert.equal(name,'plugins.command');assert.deepEqual(transported(input),{...request,operation});return run(input.id,input.args);},{...request,operation}));
  assert.deepEqual(result,{resolved:false,code:nativeError.code,message:nativeError.message});assert.equal(accepts(result),true);
 }
 const wallMs=performance.now()-started;assert.ok(wallMs<1000);assert.equal(deviceReads,0);
 console.log(JSON.stringify({operation:'five completed native rejection captures in isolated CPU realms',wallMs,budgetMs:1000,hardwareVerified:false}));
});

test('serialized page callback has no Node or module lexical dependency and awaits asynchronous rejection',async()=>{
 const source=captureAuthoringRejection.toString();
 const page=runInNewContext(`({capture:(${source}),nodeGlobals:[typeof process,typeof Buffer,typeof require,typeof module],moduleHelper:typeof equal})`);
 assert.deepEqual(transported(page.nodeGlobals),['undefined','undefined','undefined','undefined']);assert.equal(page.moduleHelper,'undefined');
 // A browser-local Error, including a non-enumerable code, must be read before
 // transport. Promise rejection is caught after settlement, not fire-and-forget.
 const result=await runInNewContext(`(${source})(${JSON.stringify(request)})`,{
  frameAI:{call:runInNewContext(`async()=>{await Promise.resolve();throw Object.defineProperty(new Error('page-owned'), 'code', {value:'THERMAL_AUTHORING_ONLY'});}`)}
 });
 assert.deepEqual(transported(result),{resolved:false,code:'THERMAL_AUTHORING_ONLY',message:'page-owned'});assert.equal(accepts(result),true);
});

test('real harness predicate rejects wrong, missing or non-string code despite matching message text',async()=>{
 for(const code of [undefined,null,'WRONG_CODE','thermal_authoring_only','THERMAL_AUTHORING_ONLY ',0,{toString:()=> 'THERMAL_AUTHORING_ONLY'}]){
  const result=transported(await inPage(()=>{throw Object.assign(new Error('THERMAL_AUTHORING_ONLY'),{code});},request));
  assert.equal(result.resolved,false);assert.equal(accepts(result),false);
 }
 for(const thrown of [new Error('THERMAL_AUTHORING_ONLY'),'THERMAL_AUTHORING_ONLY',null,undefined]){
  const result=transported(await inPage(()=>Promise.reject(thrown),request));assert.equal(result.resolved,false);assert.equal(result.code,null);assert.equal(accepts(result),false);
 }
});

test('resolved numerical calls cannot satisfy the real harness even when their value looks like a rejection',async()=>{
 for(const value of [undefined,null,42,'THERMAL_AUTHORING_ONLY',rejection(),{resolved:false,code:'THERMAL_AUTHORING_ONLY'}]){
  const result=transported(await inPage(async()=>value,request));assert.deepEqual(result,{resolved:true});assert.equal(accepts(result),false);
 }
 for(const resolved of [true,undefined,null,0,'false'])assert.equal(accepts({resolved,code:'THERMAL_AUTHORING_ONLY'}),false);
});

test('primitive rejection metadata survives serialization while raw Error custom code is not transport-safe',async()=>{
 const error=rejection(),raw=structuredClone(error);assert.equal(error.code,'THERMAL_AUTHORING_ONLY');assert.equal(raw.code,undefined);assert.equal(accepts({resolved:false,code:raw.code,message:raw.message}),false);
 const captured=await inPage(()=>{throw error;},request);
 assert.deepEqual(transported(structuredClone(captured)),{resolved:false,code:'THERMAL_AUTHORING_ONLY',message:error.message});assert.equal(accepts(transported(captured)),true);
});

test('actual harness loop serializes the callback with exact native operation, owner or Probe hash and arguments',async()=>{
 const calls=[];
 const {checks,timings}=await runNumericalLoop(async(callback,input)=>{
  assert.equal(callback,captureAuthoringRejection);
  return transported(await runInNewContext(`(${callback.toString()})(input)`,{input:transported(input),frameAI:{call(name,args){calls.push({name,args:transported(args)});throw rejection();}}}));
 });
 const operations=['solve-grid','solve-scene','measure','inspect','inspect-velocity'];
 assert.deepEqual(calls,operations.map(operation=>({name:'plugins.command',args:{id:operation==='measure'?probe:owner,operation,args:{deliberatelyUnsupported:true}}})));
 assert.deepEqual(checks.map(c=>c.name),operations.map(operation=>operation+' explicitly rejects'));assert.equal(checks.length,5);
 assert.deepEqual(timings,[{name:'all numerical calls reject without authoring mutation',limit:1500}]);
});

test('page evaluation transport failure remains fatal even if its outer Error has the expected code',async()=>{
 for(const error of [new Error('Page closed'),rejection()])await assert.rejects(runNumericalLoop(async()=>{throw error;}),value=>value===error);
});
