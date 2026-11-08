import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {authorRuntime,fragment} from '../../../tests/scene-data-runtime.mjs';
import {fileURLToPath} from 'node:url';

// Execute the shipped helpers, whole native copy function, and HASH spec path.
// Scene bookkeeping is stubbed; no browser/GPU qualification is implied.
export async function pluginReferenceChecks(){
 const html=await readFile(new URL('../../../index.html',import.meta.url),'utf8'),checks=[],timings=[];
 const between=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,start);return html.slice(a,b);},line=start=>between(start,'\n');
 const check=(name,test)=>{test();checks.push(name);},hash=c=>c.repeat(32),A=hash('a'),B=hash('b'),C=hash('c'),E=hash('e'),R=hash('f');
 try{
 const declaration={type:'reference_fixture',fields:{Owner:'',External:'',Note:'',Path:'',Choice:[A,'other'],Number:1},textFields:['Note','Path'],parameterResets:{Owner:{Number:0}}};
 const entry={manifest:{id:A,objects:[declaration,{type:A,fields:{Owner:''}}]}},types=new Map([[declaration.type,entry],[A,entry]]);
 const helpers=[line('  function owner(n)'),line('  function referenceField('),line('  function remapAuthoring('),line('  function parameterPatch(')].join('\n');
 const nodes=[],FramePlugins={};const {FrameAuthorData}=authorRuntime({nodes,FramePlugins});let rootAuthorData=null;FrameAuthorData.attach(()=>rootAuthorData,value=>{rootAuthorData=value;});FrameAuthorData.installed();
 Object.assign(FramePlugins,new Function('types','FrameAuthorData',helpers+';return {owner,referenceField,remapAuthoring,parameterPatch};')(types,FrameAuthorData));
 check('Only declared strings excluding textFields are references',()=>{assert.equal(FramePlugins.referenceField(declaration.type,'Owner'),true);for(const key of ['Note','Path','Choice','Number','missing'])assert.equal(FramePlugins.referenceField(declaration.type,key),false);assert.equal(FramePlugins.referenceField('unknown','Owner'),false);});
 const metadata={version:1,plugin:{id:A,type:declaration.type,params:{Owner:A,External:E,Note:A,Path:'pose:'+A+':x',Choice:A,Number:1}},tags:[],animation:[]},mapping=new Map([[A,B],[C,R]]),input=structuredClone(metadata);
 const remapped=FramePlugins.remapAuthoring(input,mapping);
 check('Declared plugin reference remaps with no literal or external changes',()=>{assert.equal(remapped.plugin.params.Owner,B);for(const key of ['External','Note','Path','Choice','Number'])assert.deepEqual(remapped.plugin.params[key],input.plugin.params[key]);assert.equal(remapped.plugin.id,A);});
 check('Authoring remap preserves originals and independent copied parameters',()=>{remapped.plugin.params.Note='changed';assert.deepEqual(input,metadata);assert.notEqual(remapped.plugin,input.plugin);assert.notEqual(remapped.plugin.params,input.plugin.params);});
 check('Plugin type equal to a copied hash remains unchanged',()=>assert.equal(FramePlugins.remapAuthoring({...metadata,plugin:{id:A,type:A,params:{Owner:A}}},mapping).plugin.type,A));
 check('Null and non-plugin authoring preserve their shapes',()=>{assert.equal(FramePlugins.remapAuthoring(null,mapping),null);assert.deepEqual(FramePlugins.remapAuthoring({version:1,tags:[]},mapping),{version:1,tags:[]});});
 const owner={id:'n1',nativeHash:A,type:'group',parent:null,params:{}},other={id:'n2',nativeHash:B,type:'group',parent:null,params:{}},ref={id:'n3',nativeHash:C,type:declaration.type,parent:null,params:{...metadata.plugin.params,Number:7}},wrong={id:'n4',nativeHash:E,type:'mesh',parent:null,params:{}};nodes.push(owner,other,ref,wrong);
 const node=id=>nodes.find(n=>n.id===id),descendants=id=>nodes.filter(n=>n.parent===id).flatMap(n=>[n.id,...descendants(n.id)]);
 const objectReference=new Function('node','nodes',line('function objectReference(')+';return objectReference;')(node,nodes);
 const frameTargetValid=new Function('objectReference','descendants','nodes','node',line('function frameTargetValid(')+';return frameTargetValid;')(objectReference,descendants,nodes,node);
 let validates=0,history=[],errors=[];
 entry.editor={parameters(n,changes){validates++;for(const key of ['Owner','External'])if(Object.hasOwn(changes,key)&&changes[key]&&!nodes.some(q=>q.nativeHash===changes[key]&&q.type==='group'))throw Error('Expected canonical group reference');return {...changes};}};
 const definitions=Object.fromEntries(['instance','cloner','target'].map(type=>[type,[type,'icon',{object:''}]]));
 const setReference=new Function('node','FramePlugins','definitions','descendants','frameTargetValid','commit','fileOperationError',line('function frameSetObjectReference(')+';return frameSetObjectReference;')(node,FramePlugins,definitions,descendants,frameTargetValid,fn=>{history.push(structuredClone(nodes));fn();},e=>errors.push(e.message));
 const field={dataset:{owner:ref.id,field:'Owner'}};
 check('Native reference drop validates the canonical hash before committing',()=>{assert.equal(setReference(field,other.id),true);assert.equal(ref.params.Owner,B);assert.equal(ref.params.Number,0);assert.equal(validates,1);assert.equal(history.length,1);assert.equal(history[0][2].params.Owner,A);});
 check('Wrong-type drop reports normal UI error without mutation or history',()=>{const before=structuredClone(nodes),count=history.length;assert.doesNotThrow(()=>assert.equal(setReference(field,wrong.id),false));assert.deepEqual(nodes,before);assert.equal(history.length,count);assert.equal(errors.at(-1),'Expected canonical group reference');});
 check('Missing/self references reject before mutation',()=>{for(const id of ['gone',ref.id]){const before=structuredClone(nodes);assert.equal(setReference(field,id),false);assert.deepEqual(nodes,before);}});
 check('Text and enum fields cannot be used as object references',()=>{for(const key of ['Note','Choice']){const before=structuredClone(nodes);assert.equal(setReference({dataset:{owner:ref.id,field:key}},owner.id),false);assert.deepEqual(nodes,before);}});
 check('Keyboard clear uses the same parameter validator and native transaction',()=>{const before=validates;assert.equal(setReference(field),true);assert.equal(ref.params.Owner,'');assert.equal(validates,before+1);assert.equal(history.at(-1)[2].params.Owner,B);});
 entry.editor.parameters=()=>{throw Error('Clear forbidden');};
 check('Invalid clear cannot mutate or create Undo state',()=>{const before=structuredClone(nodes),count=history.length;assert.equal(setReference(field),false);assert.deepEqual(nodes,before);assert.equal(history.length,count);});
 entry.editor=null;
 owner.name=B;
 check('Native hash takes precedence over an earlier matching object name',()=>assert.equal(objectReference(B),other));
 owner.name=other.id;check('Session UI ID keeps precedence over a matching object name',()=>assert.equal(objectReference(other.id),other));
 owner.name='Legacy named reference';check('Named references retain their fallback',()=>assert.equal(objectReference(owner.name),owner));
 check('Missing references still resolve to null',()=>assert.equal(objectReference('missing reference'),null));owner.name=B;
 const collisionTarget={id:'collision-target',nativeHash:hash('5'),type:'target',parent:other.id,params:{object:''}};nodes.push(collisionTarget);const collisionField={dataset:{owner:collisionTarget.id,field:'object'}};
 check('Hash/name collision cannot hide a real Target hierarchy cycle',()=>{const count=history.length;assert.equal(setReference(collisionField,other.id),false);assert.equal(collisionTarget.params.object,'');assert.equal(history.length,count);});
 collisionTarget.parent=null;owner.type='target';
 check('A Target named like a real group hash cannot falsely reject a valid link',()=>{assert.equal(setReference(collisionField,other.id),true);assert.equal(collisionTarget.params.object,B);});collisionTarget.params.object='';owner.type='group';
 const shape=new Function('supported','special','objectReference',line('  function shape(n)')+';return shape;')(new Set(),new Set(['instance','cloner','target']),objectReference);
 check('Actual native shape serialization preserves the intended hash under a name collision',()=>{for(const type of ['instance','cloner','target'])assert.equal(shape({type,params:{object:B}}).params.object,B);});delete owner.name;
 owner.name='';other.name='Drop object';
 check('Empty and placeholder references never resolve through object names',()=>{assert.equal(objectReference(''),null);assert.equal(objectReference('Drop object'),null);assert.equal(objectReference(owner.nativeHash),owner);assert.equal(objectReference(other.id),other);});
 for(const type of ['instance','cloner','target']){
  const cleared={id:'sentinel-'+type,nativeHash:hash(type==='instance'?'6':type==='cloner'?'7':'8'),type,parent:null,params:{object:B}};nodes.push(cleared);
  check(type+' native clear stays empty through actual shape serialization with named shadows',()=>{assert.equal(setReference({dataset:{owner:cleared.id,field:'object'}}),true);assert.equal(cleared.params.object,'');assert.equal(shape(cleared).params.object,'');});
 }
 check('Cloner default placeholder stays unbound through actual shape serialization',()=>assert.equal(shape({type:'cloner',params:{object:'Drop object'}}).params.object,'Drop object'));delete owner.name;delete other.name;
 for(const type of ['instance','cloner','target']){
  const n={id:'builtin-'+type,nativeHash:hash(type==='instance'?'1':type==='cloner'?'2':'3'),type,parent:null,params:{object:''}};nodes.push(n);const f={dataset:{owner:n.id,field:'object'}};
  check(type+' drop stores a canonical native reference',()=>{assert.equal(setReference(f,owner.id),true);assert.equal(n.params.object,A);});
  check(type+' clear is a valid native edit',()=>{assert.equal(setReference(f),true);assert.equal(n.params.object,'');});
  if(type==='instance'){other.parent=n.id;check('Instance descendant source is rejected before mutation',()=>assert.equal(setReference(f,other.id),false));other.parent=null;}
  if(type==='target'){n.parent=owner.id;check('Target cycle is rejected using the native constraint validator',()=>assert.equal(setReference(f,owner.id),false));n.parent=null;const target={id:'target-other',nativeHash:hash('4'),type:'target',parent:null,params:{object:''}};nodes.push(target);check('Target-to-Target is rejected',()=>assert.equal(setReference(f,target.id),false));}
 }
 ref.tags=[];setReference(field,owner.id);
 const frameAuthoring=new Function('FrameAuthorData','frameCurves','FrameMorph','FramePlugins',line('function frameAuthoring(')+';return frameAuthoring;')(FrameAuthorData,{}, {sceneChannels:()=>new Map(),serializedTags:(_n,t)=>t}, FramePlugins),savedAuthoring=frameAuthoring(ref);
 check('Actual authoring serializer persists the dropped native hash',()=>assert.equal(savedAuthoring.plugin.params.Owner,A));
 const restoreAuthoring=new Function('FrameAuthorData','FramePlugins','defaults','definitions','tagDefinitions',line('function frameRestoreAuthoring(')+';return frameRestoreAuthoring;')(FrameAuthorData,FramePlugins,f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])),{[declaration.type]:['Fixture','icon',declaration.fields]},{}),restored={tags:[]};restoreAuthoring(restored,savedAuthoring);
 check('Actual authoring restore preserves native references and literal controls',()=>assert.deepEqual(restored.params,ref.params));
 check('Pointer drop and Delete/Backspace are wired to the shared validated path',()=>{assert.match(html,/if\(d.link\)\{frameSetObjectReference\(d.link,g.ids\[0\]\);\}/);assert.match(html,/for\(const field of all\('\.cloner-object-drop',content\)\).*frameSetObjectReference\(field\);/);});
 const recordValues={[R]:{type:4,value:[B,E]},[hash('0')]:{type:7,value:A}},objects=[
  {hash:A,type:0,name:'Parent A',parent:null,tags:[],authoring:{version:1,tags:[],animation:[]}},
  {hash:B,type:0,name:'Owner B',parent:null,tags:[],authoring:{version:1,plugin:{id:A,type:A,params:{Owner:A}},tags:[],animation:[]}},
  {hash:C,type:0,name:'Reference C',parent:A,tags:[],authoring:{...structuredClone(metadata),plugin:{...metadata.plugin,params:{...metadata.plugin.params,Owner:B}},recordValues,instanceCloud:[{source:B},{source:E}]},spline:{type:'instance',params:{object:B}}}
 ];
 objects[2].authoring.authorData={version:1,revision:0,records:[{id:R,revision:0,name:'Reference fixture',kind:'source',refs:[{kind:'object',owner:B},{kind:'object',owner:E}],payload:{language:'text',text:B}}]};
 const original=structuredClone(objects),scene={meshes:[]},renderer={};
 const FrameHash=new Function('crypto',fragment('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+';return createFrameHashCodec();')(webcrypto);
 Object.assign(FramePlugins,{flush:async()=>{},dispatch:async()=>null});
 const copySource=between('    async function duplicateGizmoObjects(g){','    let nativeClipboard=null'),mergeSource=between('const {K,T}=FrameHash,get=(h,f)=>plan.records','          for(let i=0;i<plan.objects.length;i++)');
 const createCopy=new Function('FrameAuthorData','FramePlugins','scene','renderer','poseObjects','selectedRoots','objectDescendants','FrameHash','snapshotFrames','copyAppearanceTags','objectSelection','restoreStructure','selectionFrame','let frameBatchDepth=0;'+copySource+';return duplicateGizmoObjects;');
 const children=(h,rows)=>rows.filter(o=>o.parent===h).flatMap(o=>[o.hash,...children(o.hash,rows)]),duplicate=createCopy(FrameAuthorData,FramePlugins,scene,renderer,()=>objects,()=>[A,B],(h,rows)=>[h,...children(h,rows)],FrameHash,()=>({}),t=>structuredClone(t),[],async()=>{},()=>({}));
 const verify=(specs,label)=>{const copiedA=specs.find(n=>n.name==='Parent A'),copiedB=specs.find(n=>n.name==='Owner B'),copiedC=specs.find(n=>n.name==='Reference C');check(label+': real author data remaps only typed owners, preserving local IDs, revisions and inert text',()=>{const data=copiedC.authoring.authorData;assert.equal(data.revision,0);assert.equal(data.records[0].id,R);assert.equal(data.records[0].revision,0);assert.deepEqual(data.records[0].refs,[{kind:'object',owner:copiedB.hash},{kind:'object',owner:E}]);assert.equal(data.records[0].payload.text,B);});check(label+': explicit owner (not parent) remaps',()=>{assert.equal(copiedC.parent,copiedA.hash);assert.equal(copiedC.authoring.plugin.params.Owner,copiedB.hash);assert.notEqual(copiedC.authoring.plugin.params.Owner,copiedA.hash);assert.equal(copiedB.authoring.plugin.params.Owner,copiedA.hash);});check(label+': plugin text, enum, IDs/types and external reference are unchanged',()=>{for(const key of ['External','Note','Path','Choice','Number'])assert.deepEqual(copiedC.authoring.plugin.params[key],original[2].authoring.plugin.params[key]);assert.equal(copiedB.authoring.plugin.id,A);assert.equal(copiedB.authoring.plugin.type,A);});check(label+': native type-4, instanceCloud and spline references still remap',()=>{assert.deepEqual(copiedC.authoring.recordValues[R].value,[copiedB.hash,E]);assert.deepEqual(copiedC.authoring.instanceCloud.map(r=>r.source),[copiedB.hash,E]);assert.equal(copiedC.spline.params.object,copiedB.hash);});};
 const direct={space:scene};await duplicate(direct);verify(direct.copySpecs,'Ordinary duplicate');
 const clipboard={space:scene,clipboard:{objects:structuredClone(objects),roots:[A,B]}};await duplicate(clipboard);verify(clipboard.copySpecs,'Same-tab clipboard');
 const lone={space:scene,clipboard:{objects:[structuredClone(objects[2])],roots:[C]}};await duplicate(lone);
 check('Copying a reference alone preserves its uncopied owner and original parent',()=>{assert.equal(lone.copySpecs[0].authoring.plugin.params.Owner,B);assert.equal(lone.copySpecs[0].parent,A);assert.deepEqual(lone.copySpecs[0].authoring.recordValues[R].value,[B,E]);});
 const partial={space:scene,clipboard:{objects:structuredClone(objects),roots:[A]}};await duplicate(partial);
 check('Parent plus child copy cannot infer owner from hierarchy',()=>{const child=partial.copySpecs.find(n=>n.name==='Reference C');assert.equal(child.authoring.plugin.params.Owner,B);assert.equal(child.parent,partial.copySpecs.find(n=>n.name==='Parent A').hash);});
 const merge=new Function('FrameAuthorData','FramePlugins','FrameHash','plan','let specs,importedDocumentation,documentationMapping,importedAuthorData,authorMapping,rootMapping;const options={clipboard:true};'+mergeSource+';return specs;'),merged=merge(FrameAuthorData,FramePlugins,FrameHash,{objects:structuredClone(objects),records:new Map()});verify(merged,'HASH clipboard spec construction (documentation lane excluded)');
 check('Every copy path leaves original native records and authoring intact',()=>assert.deepEqual(objects,original));
 check('Copied type-4 arrays are independently owned',()=>{const copied=direct.copySpecs.find(n=>n.name==='Reference C');assert.notEqual(copied.authoring.recordValues[R],objects[2].authoring.recordValues[R]);assert.notEqual(copied.authoring.recordValues[R].value,objects[2].authoring.recordValues[R].value);copied.authoring.recordValues[R].value[0]=E;assert.deepEqual(objects,original);});
 // Existing broad remap of non-plugin metadata is explicitly outside this fix.
 const knownNonPluginTextRemap=merged.find(n=>n.name==='Reference C').authoring.recordValues[hash('0')].value!==A;
 const timed=async(operation,budgetMs,fn)=>{const t=performance.now();await fn();const ms=performance.now()-t;timings.push({operation,ms,budgetMs});check(operation+' latency budget',()=>assert.ok(ms<budgetMs,ms+'ms'));};
 await timed('10000 completed plugin authoring remaps',500,()=>{for(let i=0;i<10000;i++)FramePlugins.remapAuthoring(metadata,mapping);});
 await timed('100 completed native metadata duplicates',500,async()=>{for(let i=0;i<100;i++)await duplicate({space:scene});});
 await timed('100 completed HASH copy spec constructions',500,()=>{for(let i=0;i<100;i++)merge(FrameAuthorData,FramePlugins,FrameHash,{objects,records:new Map()});});
 await timed('1000 completed validated reference field edits',500,()=>{for(let i=0;i<1000;i++)setReference(field,other.id);});
 return {pass:true,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),browserVerified:false,gpuVerified:false,knownLimitations:{nonPluginType7TextStillRemaps:knownNonPluginTextRemap}};
 }catch(error){return {pass:false,checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex'),error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await pluginReferenceChecks();await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/thermal-core-references.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;}
