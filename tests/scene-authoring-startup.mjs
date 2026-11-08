// Actual scene construction, root attachment and native records installation.
// GPU buffer calls are explicit CPU fixtures; this does not qualify GPU startup.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {html,fragment} from './scene-data-runtime.mjs';
const A='a'.repeat(32),R='c'.repeat(32),data={version:1,revision:0,records:[{id:R,revision:0,name:'Stored',kind:'source',refs:[],payload:{language:'text',text:'inert'}}]};
const codec=new Function(fragment('function createFrameHashCodec(){','const FrameHash=createFrameHashCodec();')+';return createFrameHashCodec();')();
function env(){const body=`
 const nodes=[],definitions={},FramePlugins={owner:()=>null,referenceField:()=>false},timelineFrame=0,timelineTotal=120,frameCurves={},FrameMorph={sceneChannels:()=>new Map()},FrameDocumentation={normalize:x=>x},FM={equal:()=>false,I:()=>[],unpack:x=>x};
 let scene=null,sceneFrameDirty=false,syncs=0;
 const fail=(code,message)=>{throw Object.assign(Error(message),{code});},commit=fn=>fn(),frameSyncEngineVisibility=()=>{},syncPoseWorld=()=>{syncs++;};
 const GPUBufferUsage={VERTEX:1,COPY_DST:2},frameViewportGuides=()=>new Float32Array(6),makeGPUBuffer=()=>({fixture:true}),gpu={device:{queue:{writeBuffer(){}}}};
 ${fragment('const FrameAuthorData=','const FrameDocumentation=')}
 ${fragment('function sceneFromMeshes(gpu,meshes){','    async function createPagedPicking(')}
 ${fragment('function nativeRecord(id,type,value){')}
 ${fragment('function nativePut(map,id,field,type,value){')}
 ${fragment('function installNativeRecords(objects,camera=null){','    function deformationRevision(')}
 ${fragment('      FrameAuthorData.attach(')}
 return {F:FrameAuthorData,create(meshes=[]){FrameAuthorData.invalidateDocument();scene=sceneFromMeshes(gpu,meshes);return scene;},install:objects=>installNativeRecords(objects),setRecords:records=>scene.records=records,get scene(){return scene;},get syncs(){return syncs;}};`;
 return new Function('FrameHash','crypto',body)(codec,webcrypto);
}
const checks=[];async function check(name,fn){const start=performance.now();try{await fn();const elapsedMs=performance.now()-start;assert.ok(elapsedMs<1000);checks.push({name,pass:true,elapsedMs,budgetMs:1000});}catch(e){checks.push({name,pass:false,error:e.stack});}}
await check('Actual empty scene constructor has no records; initial native install observes absent root without creating metadata',()=>{const e=env(),scene=e.create();assert.ok(!Object.hasOwn(scene,'records'));assert.equal(e.F.ready,false);e.install([]);assert.ok(scene.records instanceof Map);assert.equal(scene.records.has(codec.K.parameters),false);assert.equal(e.F.root(),null);assert.equal(e.F.ready,false);e.F.installed();assert.equal(e.F.ready,true);assert.equal(e.syncs,1);});
await check('Uninstalled root write rejects NOT_READY instead of creating a partial native map',()=>{const e=env(),scene=e.create();assert.throws(()=>e.F.setRoot(data),x=>x.code==='NOT_READY');assert.ok(!Object.hasOwn(scene,'records'));assert.equal(e.F.ready,false);e.install([]);assert.equal(e.F.root(),null);});
await check('Native New after existing authored root resets readiness and does not copy old root metadata',()=>{const e=env();e.create();e.install([]);e.F.installed();e.F.setRoot(data);assert.deepEqual(e.F.root(),data);const epoch=e.F.epoch,newScene=e.create();assert.notEqual(e.F.epoch,epoch);assert.equal(e.F.ready,false);assert.ok(!Object.hasOwn(newScene,'records'));e.install([]);assert.equal(e.F.root(),null);assert.equal(newScene.records.has(codec.K.parameters),false);assert.equal(e.F.ready,false);e.F.installed();assert.equal(e.F.ready,true);});
await check('Native import install with no initial records retains object author data and waits for installation acknowledgment',()=>{const e=env();e.create();e.install([{hash:A,type:0,name:'Imported',flags:3,authoring:{version:1,tags:[],animation:[],authorData:data}}]);assert.equal(e.F.root(),null);assert.deepEqual(JSON.parse(e.scene.records.get(codec.address(A,'parameters')).value).authorData,data);assert.equal(e.F.ready,false);e.F.installed();assert.equal(e.F.ready,true);});
await check('Already bound native records preserve root metadata, Docs and subsequent root writes',()=>{const e=env();e.create();e.setRecords(new Map([[codec.K.parameters,{id:codec.K.parameters,type:codec.T.text,value:JSON.stringify({version:1,frame:0,total:120,materials:[],documentation:'Doc text',authorData:data})}]]));assert.deepEqual(e.F.root(),data);e.install([]);assert.deepEqual(e.F.root(),data);assert.equal(JSON.parse(e.scene.records.get(codec.K.parameters).value).documentation,'Doc text');assert.equal(e.F.ready,false);e.F.installed();e.F.setRoot({...data,revision:1});const globals=JSON.parse(e.scene.records.get(codec.K.parameters).value);assert.equal(globals.authorData.revision,1);assert.equal(globals.documentation,'Doc text');});
const report={pass:checks.every(c=>c.pass),checks,indexSHA256:createHash('sha256').update(html).digest('hex'),browserVerified:false,gpuVerified:false};await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/scene-authoring-startup.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
