import {authorRuntime} from './scene-data-runtime.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function hashBestEffortChecks(){
 const {FrameAuthorData}=authorRuntime();const runtimeFunction=(...args)=>new Function('FrameAuthorData',...args).bind(null,FrameAuthorData);
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[];
 const section=(a,b)=>{const start=html.indexOf(a),end=html.indexOf(b,start);assert.ok(start>=0&&end>start,a);return html.slice(start,end);},line=a=>section(a,'\n'),check=(name,fn)=>{fn();checks.push(name);};
 const A='a'.repeat(32),B='b'.repeat(32),C='c'.repeat(32),D='d'.repeat(32),F='f'.repeat(32),E='e'.repeat(32),H='1'.repeat(32),known={manifest:{id:'known',objects:[{type:'known_type',fields:{Owner:'',Text:'',Count:1},textFields:['Text']}]}};
 const types=new Map([['known_type',known]]),tagDefinitions={known_tag:{plugin:'known',fields:{Count:1}}},definitions={known_type:['Known','',known.manifest.objects[0].fields],extrude:['Extrude','',{}]};
 const FramePlugins=runtimeFunction('types','tagDefinitions',[line('  function owner(n)'),line('  function referenceField('),line('  function remapAuthoring(')].join('\n')+';return {owner,referenceField,remapAuthoring};')(types,tagDefinitions);
 const FramePluginTags={params:(s,p)=>{for(const [k,v]of Object.entries(p))if(!Object.hasOwn(s.fields,k)||typeof v!==typeof s.fields[k])throw Error('Invalid plugin tag parameter');return {...s.fields,...p};}},FramePluginRecords={restore:structuredClone,native:structuredClone};
 const validate=runtimeFunction('FramePlugins','definitions','tagDefinitions','FramePluginTags',line('function frameValidateAuthoring(')+';return frameValidateAuthoring;')(FramePlugins,definitions,tagDefinitions,FramePluginTags);
 const channels=new Map(),restore=runtimeFunction('FramePlugins','definitions','tagDefinitions','FramePluginTags','FramePluginRecords','defaults','frameRestoreChannels',line('function frameRestoreAuthoring(')+';return frameRestoreAuthoring;')(FramePlugins,definitions,tagDefinitions,FramePluginTags,FramePluginRecords,f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])),(rows,owners)=>{for(const owner of owners)channels.delete(owner);for(const [id,p,t]of rows){if(!channels.has(id))channels.set(id,new Map());channels.get(id).set(p,t);}});
 const author=runtimeFunction('FramePlugins','FramePluginRecords','FrameMorph','frameCurves','framePackTrack',line('function frameAuthoring(')+';return frameAuthoring;')(FramePlugins,FramePluginRecords,{sceneChannels:()=>channels,serializedTags:(_n,t)=>structuredClone(t)},{},t=>t);
 const numeric={kind:'number',dimensions:1,base:1,keys:[[0,{v:1}],[60,{v:2}]]},vector={kind:'number',dimensions:3,base:[0,0,0],keys:[[0,{v:[0,0,0]}],[60,{v:[1,2,3]}]]},metadata={version:1,plugin:{id:'absent',type:'missing_type',params:{Owner:A,Text:B,Nested:{value:[1,true,'safe']}}},tags:[{uid:D,kind:'missing_tag',params:{Text:A}}],animation:[['param:gain',numeric],['tag:'+D+':Gain',numeric],['position',vector]]};
 try{
 const browserSource=await readFile(new URL('./hash-best-effort-browser.mjs',import.meta.url),'utf8'),openStart=browserSource.indexOf('function nativeOpenComplete('),openEnd=browserSource.indexOf('\n}\n',openStart)+2;
 assert.ok(openStart>=0&&openEnd>openStart);
 const openPredicate=runtimeFunction('document','globalThis',browserSource.slice(openStart,openEnd)+';return nativeOpenComplete;'),completion={fileBytes:2636,previousHashLoad:null};
 const openState=()=>({app:{inert:false},canvas:{dataset:{ready:'true',hashLoad:JSON.stringify({objects:2,triangles:2,fileBytes:2636,elapsedMs:47.4}),scene:JSON.stringify({objects:2,triangles:2,vertices:6})}},frameEngine:{idle:true}});
 const complete=(s,args=completion)=>openPredicate({querySelector:selector=>selector==='#app'?s.app:s.canvas},{frameEngine:s.frameEngine})(args);
 check('Open completion accepts actual native count-only scene diagnostics without a name',()=>assert.equal(complete(openState()),true));
 check('Open completion does not require recent-file or filename metadata',()=>{const s=openState();delete s.canvas.dataset.scene;assert.equal(complete(s),true);});
 for(const [name,change]of [
  ['missing app',s=>s.app=null],['missing canvas',s=>s.canvas=null],['inert app',s=>s.app.inert=true],['busy engine',s=>s.frameEngine.idle=false],['missing engine',s=>s.frameEngine=null],
  ['not ready',s=>s.canvas.dataset.ready='false'],['loader error',s=>s.canvas.dataset.operationError='Plugin record overlaps a native property'],
  ['missing completion',s=>delete s.canvas.dataset.hashLoad],['malformed completion',s=>s.canvas.dataset.hashLoad='{'],['null completion',s=>s.canvas.dataset.hashLoad='null'],
  ['other file bytes',s=>s.canvas.dataset.hashLoad=JSON.stringify({fileBytes:2637,elapsedMs:47.4})],['string file bytes',s=>s.canvas.dataset.hashLoad=JSON.stringify({fileBytes:'2636',elapsedMs:47.4})],
  ['missing completion time',s=>s.canvas.dataset.hashLoad=JSON.stringify({fileBytes:2636})],['negative completion time',s=>s.canvas.dataset.hashLoad=JSON.stringify({fileBytes:2636,elapsedMs:-1})],['nonnumeric completion time',s=>s.canvas.dataset.hashLoad=JSON.stringify({fileBytes:2636,elapsedMs:'47.4'})]
 ])check('Open completion rejects '+name,()=>{const s=openState();change(s);assert.equal(complete(s),false);});
 check('Open completion rejects stale prior diagnostics even for the same file size',()=>{const s=openState();assert.equal(complete(s,{...completion,previousHashLoad:s.canvas.dataset.hashLoad}),false);});
 check('Open completion cannot succeed from an idle UI and matching scene name alone',()=>{const s=openState();delete s.canvas.dataset.hashLoad;s.canvas.dataset.scene=JSON.stringify({name:'best-effort.hash'});assert.equal(complete(s),false);});
 check('Browser Open retains the 6000 ms wait and strict post-load content assertions',()=>{assert.ok(browserSource.includes("page.waitForFunction(nativeOpenComplete, {fileBytes: fixture.bytes, previousHashLoad}, {timeout: 6000})"));for(const name of ['Open preserves every authored hash and owner count',' local affine transform',' native parent','Installed child retains type and canonical link to unavailable parent','Native Instance retains link to unavailable mesh shell','Installed child plugin is active and callable'])assert.ok(browserSource.includes(name),name);});
 check('Unknown well-formed plugin and tag validate without installed definitions',()=>assert.deepEqual(validate(JSON.stringify(metadata)),metadata));
 for(const plugin of [null,[],{id:'../bad',type:'missing_type',params:{}},{id:'absent',type:'../bad',params:{}},{id:'absent',type:'missing_type',params:[]},{id:'absent',type:'missing_type'}])check('Malformed unknown descriptor rejects '+JSON.stringify(plugin),()=>{if(plugin===null)return assert.doesNotThrow(()=>validate(JSON.stringify({...metadata,plugin})));assert.throws(()=>validate(JSON.stringify({...metadata,plugin})),/plugin/);});
 check('Malformed known plugin fields still reject',()=>assert.throws(()=>validate(JSON.stringify({...metadata,plugin:{id:'known',type:'known_type',params:{Count:'bad'}}})),/parameters/));
 check('Foreign manifest ID sharing known type does not use installed parameter schema',()=>assert.doesNotThrow(()=>validate(JSON.stringify({...metadata,plugin:{id:'foreign',type:'known_type',params:{Unknown:[1,2]}}}))));
 for(const tag of [null,{kind:'missing',params:[]},{kind:'missing',params:{},uid:'bad'},{kind:'../bad',params:{}}])check('Malformed tag rejects '+JSON.stringify(tag),()=>assert.throws(()=>validate(JSON.stringify({...metadata,tags:[tag]})),/tag/));
 for(const a of [null,[],{}, {...metadata,animation:null},{...metadata,pluginReferencesUnresolved:false}])check('Malformed authoring envelope rejects '+JSON.stringify(a),()=>assert.throws(()=>validate(JSON.stringify(a))));
 const n={id:'n',type:'group',tags:[],params:{}},input=validate(JSON.stringify(metadata));restore(n,input);
 check('Unavailable payload is outside active node type, params and tags',()=>{assert.equal(n.type,'group');assert.deepEqual(n.params,{});assert.deepEqual(n.tags,[]);assert.deepEqual(n.ignoredAuthoring.plugin,metadata.plugin);});
 check('Only native transform animation remains live',()=>{assert.deepEqual([...channels.get(n.id).keys()],['position']);assert.deepEqual(n.ignoredAuthoring.animation.map(r=>r[0]),['param:gain','tag:'+D+':Gain']);});
 check('Authoring save restores opaque metadata and supported animation',()=>{const saved=author(n);assert.deepEqual(saved.plugin,metadata.plugin);assert.deepEqual(saved.tags,metadata.tags);assert.deepEqual(new Map(saved.animation),new Map(metadata.animation));});
 check('Edited live transform takes precedence without duplicate path',()=>{channels.get(n.id).set('position',{...vector,base:[7,8,9]});const saved=author(n);assert.equal(saved.animation.filter(r=>r[0]==='position').length,1);assert.deepEqual(new Map(saved.animation).get('position').base,[7,8,9]);});
 check('Native metadata restore clears old unavailable payload',()=>{restore(n,null);assert.equal(n.ignoredAuthoring,undefined);});restore(n,input);
 const mapping=new Map([[A,B],[B,C],[D,E]]),broad=x=>typeof x==='string'?mapping.get(x)||x.replace(/^(pose|tag|mat):([^:]+)(.*)$/,(all,p,id,tail)=>mapping.has(id)?p+':'+mapping.get(id)+tail:all):Array.isArray(x)?x.map(broad):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,broad(v)])):x;
 const records={[A]:{type:0,value:new Uint8Array([1,2,255])},[B]:{type:3,value:new Uint32Array([1,4000000000])},[C]:{type:4,value:[A,H]},[D]:{type:5,value:new Float32Array([1.25,2.5])},[E]:{type:6,value:new Float64Array([Math.PI,2.5])},[F]:{type:7,value:A}},source={...metadata,pluginRecords:Object.entries(records).map(([key,r])=>({key,type:r.type})),recordValues:records,instanceCloud:[{field:A,source:B}]},remapped=FramePlugins.remapAuthoring(source,mapping,broad);
 check('Unknown plugin strings remain literal and activation is quarantined after remap',()=>{assert.deepEqual(remapped.plugin,metadata.plugin);assert.equal(remapped.pluginReferencesUnresolved,true);});
 check('Unknown tag UID remaps but its opaque text does not',()=>{assert.equal(remapped.tags[0].uid,E);assert.equal(remapped.tags[0].params.Text,A);assert.equal(remapped.tags[0].referencesUnresolved,true);});
 check('Unknown tag animation path follows native tag identity',()=>assert.ok(remapped.animation.some(r=>r[0]==='tag:'+E+':Gain')));
 check('Record field identifiers never remap despite matching object IDs',()=>assert.deepEqual(remapped.pluginRecords,source.pluginRecords));
 check('Compact instance source remaps but record field identifier does not',()=>assert.deepEqual(remapped.instanceCloud,[{field:A,source:C}]));
 check('Native type-4 references remap internal IDs only',()=>assert.deepEqual(remapped.recordValues[C].value,[B,H]));
 for(const key of [A,B,D,E,F])check('Typed payload preserved without string rewriting '+records[key].type,()=>{assert.deepEqual(remapped.recordValues[key],records[key]);if(records[key].type!==7)assert.notEqual(remapped.recordValues[key].value,records[key].value);});
 check('Remap cannot mutate source records or opaque authoring',()=>{assert.equal(source.plugin.params.Owner,A);assert.equal(source.tags[0].uid,D);assert.deepEqual(records[C].value,[A,H]);});
 const foreign={...source,plugin:{id:'foreign',type:'known_type',params:{Owner:A,Text:B,Count:4}}};
 check('Foreign ID cannot borrow known reference schema on copy',()=>{const r=FramePlugins.remapAuthoring(foreign,mapping,broad);assert.equal(r.plugin.params.Owner,A);assert.equal(r.pluginReferencesUnresolved,true);});
 check('Known reference schema still remaps only declared references',()=>{const r=FramePlugins.remapAuthoring({...source,plugin:{id:'known',type:'known_type',params:{Owner:A,Text:B,Count:4}}},mapping,broad);assert.equal(r.plugin.params.Owner,B);assert.equal(r.plugin.params.Text,B);assert.equal(r.pluginReferencesUnresolved,undefined);});
 types.set('missing_type',{manifest:{id:'absent'}});tagDefinitions.missing_tag={fields:{}};
 const late={id:'late',type:'group',params:{},tags:[]};restore(late,validate(JSON.stringify(remapped)));
 check('Unresolved copied plugin and tags never activate when implementation appears later',()=>{assert.equal(late.type,'group');assert.deepEqual(late.tags,[]);assert.equal(late.ignoredAuthoring.pluginReferencesUnresolved,true);assert.equal(channels.get('late').size,1);});types.delete('missing_type');delete tagDefinitions.missing_tag;
 const codec=runtimeFunction(section('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+';return createFrameHashCodec();')();
 const knownBlob=(await codec.pack({id:A,type:codec.T.text,value:'known'})).blob,raw=new Uint8Array(29),view=new DataView(raw.buffer);view.setUint16(0,222,true);raw.set(Uint8Array.from(B.match(/../g),x=>parseInt(x,16)),2);view.setBigUint64(18,3n,true);raw.set([9,8,7],26);
 const file=new Blob([knownBlob,raw]),indexed=await codec.index(file);
 check('Future extension type is structurally indexed without decoding',()=>{assert.equal(indexed.get(B).unsupported,true);assert.equal(indexed.size,2);});
 assert.equal(await codec.read(file,indexed.get(A)),'known');checks.push('Known record remains independently readable');
 await assert.rejects(()=>codec.read(file,indexed.get(B)),/Unsupported HASH record type/);checks.push('Required unknown encoding fails instead of reinterpretation');
 for(const damaged of [new Blob([raw.subarray(0,28)]),new Blob([raw,raw]),new Blob([raw.subarray(0,15)])]){await assert.rejects(()=>codec.index(damaged));checks.push('Corrupt bounds/duplicates still reject');}
 const planSource=section('    async function nativeDecodePlan(file){','    async function nativeDecodeMesh(file,o){');
 const decode=runtimeFunction('FrameHash','frameValidateAuthoring','FramePlugins','tagDefinitions','nativeRecord','FrameSpline','FM','decodeAppearancePlan',planSource+';return nativeDecodePlan;')(codec,validate,FramePlugins,tagDefinitions,(id,type,value)=>({id,type,value}),{decodeShape:()=>{throw Error('Unexpected spline fixture');}},{},async()=>({faces:[],uvs:[],ids:new Set()}));
 const nativeBlob=async({authoring=metadata,parent=null,otherParent=A,extra=[]}={})=>{const rows=[{id:codec.K.version,type:codec.T.uint32,value:new Uint32Array([1])},{id:codec.K.all,type:codec.T.ids,value:[A,B]},{id:codec.address(A,'type'),type:codec.T.bytes,value:new Uint8Array([0])},{id:codec.address(B,'type'),type:codec.T.bytes,value:new Uint8Array([0])},{id:codec.address(A,'parameters'),type:codec.T.text,value:JSON.stringify(authoring)}];if(parent)rows.push({id:codec.address(A,'parent'),type:codec.T.ids,value:[parent]});if(otherParent)rows.push({id:codec.address(B,'parent'),type:codec.T.ids,value:[otherParent]});return new Blob([...(await Promise.all(rows.map(r=>codec.pack(r)))).map(p=>p.blob),...extra]);};
 const plan=await decode(await nativeBlob({extra:[raw]}));
 check('Actual native preflight keeps unknown ancestor and known child hierarchy',()=>{assert.equal(plan.objects.length,2);assert.equal(plan.objects[1].parent,A);assert.deepEqual(plan.objects[0].authoring.plugin,metadata.plugin);});
 check('Actual native import report distinguishes unavailable semantics from omitted extension',()=>{assert.equal(plan.importReport.unavailablePlugins[0].hash,A);assert.equal(plan.importReport.unavailableTags[0].kind,'missing_tag');assert.deepEqual(plan.importReport.ignoredExtensionRecords,[B]);});
 await assert.rejects(()=>nativeBlob({parent:B}).then(decode),/hierarchy/);checks.push('Actual preflight still rejects cycles');
 await assert.rejects(()=>nativeBlob({parent:F}).then(decode),/metadata/);checks.push('Actual preflight still rejects missing parent');
 await assert.rejects(()=>nativeBlob({authoring:{...metadata,recordValues:{[F]:{type:6,value:[NaN]}}}}).then(decode),/Inline plugin record values/);checks.push('Inline runtime-only binary data cannot bypass typed native preflight');
 const aliasAuthoring={...metadata,pluginRecords:[{key:codec.address(A,'all'),type:4}]};
 await assert.rejects(()=>nativeBlob({authoring:aliasAuthoring}).then(decode),/overlaps a native property/);checks.push('XOR-address alias cannot overwrite global native roots');
 const aliasField={...metadata,pluginRecords:[{key:codec.K.parent,type:4}]};
 await assert.rejects(()=>nativeBlob({parent:B,otherParent:null,authoring:aliasField}).then(decode),/overlaps a native property/);checks.push('Declared extension cannot own a core parent field');
 // A bare owner ID is not a stored property. Nor is the null-reference sentinel a field.
 for(const address of [B,codec.K.zero,codec.K.type,codec.address(B,'maps')]){
  const key=codec.address(A,address),extension=(await codec.pack({id:address,type:codec.T.text,value:'opaque literal'})).blob;
  const accepted=await decode(await nativeBlob({authoring:{...metadata,pluginRecords:[{key,type:codec.T.text}]},extra:[extension]}));
  check('Actual namespace accepts non-native extension address '+address,()=>{assert.equal(accepted.objects[0].authoring.recordValues[key].value,'opaque literal');assert.equal(accepted.objects[1].parent,A);assert.deepEqual(accepted.records.get(codec.K.all).value,[A,B]);});
 }
 for(const name of ['camera','units','materials','assets']){
  const address=codec.K[name],key=codec.address(A,address),extension=(await codec.pack({id:address,type:codec.T.text,value:'not a native value'})).blob;
  await assert.rejects(()=>nativeBlob({authoring:{...metadata,pluginRecords:[{key,type:codec.T.text}]},extra:[extension]}).then(decode));checks.push('Required native global remains protected '+name);
 }
 const guarded=runtimeFunction('K','ids','materialIDs','records','objects','FrameHash','pluginAddresses',line('      const nativeGlobals=')+';return true;');
 const spaces=[[A,['type','name','parent','flags','matrix','pivot','projection','light','spline','parameters','tags','positions','indices']],[C,['name','parameters','maps']],[D,['image','path']],[E,['material','faces','uv']]],nativeRecords=new Map([[codec.K.assets,{value:[D]}],[codec.address(A,'tags'),{value:[E]}]]),guard=address=>guarded(codec.K,[A,B],[C],nativeRecords,[{hash:A},{hash:B}],codec,new Map([[address,A]]));
 for(const field of ['version','all','parameters','camera','units','materials','assets'])check('Actual guard protects global '+field,()=>assert.throws(()=>guard(codec.K[field]),/overlaps a native property/));
 for(const [owner,fields]of spaces)for(const field of fields)check('Actual guard protects '+owner[0]+' owner '+field,()=>assert.throws(()=>guard(codec.address(owner,field)),/overlaps a native property/));
 for(const address of [A,B,C,D,E,codec.K.zero,codec.K.type,codec.address(A,'maps'),codec.address(C,'parent'),codec.address(D,'uv'),codec.address(E,'image')])check('Actual guard accepts unused namespace '+address,()=>assert.equal(guard(address),true));
 const sharedAddress=F,keyA=codec.address(A,F),keyB=codec.address(B,F),sharedBlob=(await codec.pack({id:sharedAddress,type:7,value:'one physical record'})).blob,secondAuthor=(await codec.pack({id:codec.address(B,'parameters'),type:7,value:JSON.stringify({...metadata,pluginRecords:[{key:keyB,type:7}]})})).blob;
 await assert.rejects(()=>nativeBlob({authoring:{...metadata,pluginRecords:[{key:keyA,type:7}]},extra:[sharedBlob,secondAuthor]}).then(decode),/conflicting owners/);checks.push('Two extension owners cannot share one physical record address');
 const mergeSource=section('const {K,T}=FrameHash,get=(h,f)=>plan.records','          for(let i=0;i<plan.objects.length;i++)'),merge=runtimeFunction('FrameHash','FramePlugins','plan','const options={clipboard:true};let specs,importedAuthorData,authorMapping,rootMapping;'+mergeSource+';return specs;');
 for(const poses of ['future-shape',[null],{other:'uninterpreted'}]){const opaque=structuredClone(plan);opaque.objects[0].authoring.tags[0].poses=poses;const result=merge(FrameHashSafe(codec),FramePlugins,opaque);check('Opaque unknown tag poses never interpreted by Merge '+JSON.stringify(poses),()=>assert.deepEqual(result[0].authoring.tags[0].poses,poses));}
 function FrameHashSafe(c){let count=0;return {...c,newId:()=>String(++count).padStart(32,'0')};}
 const start=performance.now();for(let i=0;i<10000;i++)FramePlugins.remapAuthoring(source,mapping,broad);const ms=performance.now()-start;timings.push({operation:'10000 full unknown authoring remaps',ms,budgetMs:1500});check('Completed remap latency budget',()=>assert.ok(ms<1500));
 const validationStart=performance.now();for(let i=0;i<10000;i++)validate(JSON.stringify(metadata));const vms=performance.now()-validationStart;timings.push({operation:'10000 completed validation operations',ms:vms,budgetMs:1500});check('Completed decode validation latency budget',()=>assert.ok(vms<1500));
 return {pass:true,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),browserVerified:false,gpuVerified:false};
 }catch(error){return {pass:false,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await hashBestEffortChecks();await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/hash-best-effort.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
