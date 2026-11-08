import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../../../tools/browser.mjs';
import {isHardwareAdapter} from './browser-gates.mjs';

const packed=[.02,0,0,0,.02,0,0,0,.02,0,0,0];
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const near=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((v,k)=>Number.isFinite(v)&&Math.abs(v-b[k])<1e-10);
// Read actual native records/world frames/helper bounds through frameAI. Never
// accept obsolete node.transform values or a test-supplied pose as evidence.
export function checkDefaultProbeFrame(check,objects,hash,ownerHash=null,label='Probe'){
 const probe=objects.find(n=>n.hash===hash),owner=ownerHash?objects.find(n=>n.hash===ownerHash):null;
 check(label+' has exact 2 mm native local frame and explicit ownership',probe?.type==='thermal_probe'&&equal(probe.matrix,packed)&&probe.parent===ownerHash&&probe.params.Thermal===(ownerHash||'')&&(!ownerHash||owner?.type==='thermal'),{probe,owner});
 const parent=owner?.worldMatrix||identity,world=parent.map((v,k)=>k<12?v*.02:v);
 check(label+' origin and helper frame compose with actual native parent',near(probe.worldMatrix,world),{actual:probe.worldMatrix,expected:world});
 const radius=[0,1,2].map(k=>50*(Math.abs(world[k])+Math.abs(world[4+k])+Math.abs(world[8+k]))),min=radius.map((r,k)=>world[12+k]-r),max=radius.map((r,k)=>world[12+k]+r);
 check(label+' actual native helper bounds have the 2 mm local extent',near(probe.bounds?.min,min)&&near(probe.bounds?.max,max),{actual:probe.bounds,expected:{min,max}});
 return probe;
}

// Focused native authoring/render gate only. Full Thermal retains its independent
// measured-temperature, stale-read, cancellation and physics assertions.
// Always use a new context, the supported runner, and real hardware WebGPU.
export async function nativeProbeBrowserChecks(parent,check,timed){
 const context=await parent.context().browser().newContext({viewport:{width:1280,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.stack));
 try{
  const catalogue=JSON.parse(await readFile(new URL('../../index.json',import.meta.url),'utf8'));if(!catalogue.includes('thermal/plugin.json'))catalogue.push('thermal/plugin.json');
  await page.route('**/plugins/index.json',route=>route.fulfill({json:catalogue}));await page.goto(parent.url());await ready(page);
  const hardware=await page.evaluate(()=>{const d=frameEngine.renderer.device;window.__probeGPU=[];window.__probeLost=null;d.addEventListener('uncapturederror',e=>__probeGPU.push(e.error.message));d.lost.then(e=>__probeLost={reason:e.reason,message:e.message});d.pushErrorScope('validation');return d.adapterInfo?Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,d.adapterInfo[k]])):null;});
  check('Probe harness uses identifiable hardware WebGPU',isHardwareAdapter(hardware),hardware);
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),inspect=async()=> (await call('scene.inspect')).objects;
  const old=await inspect();if(old.length)await call('scene.delete',{ids:old.filter(n=>!n.parent).map(n=>n.hash)});
  const owner=await timed('Probe native owner creation',10000,()=>call('plugins.create',{plugin:'thermal'})),cmd=(operation,args={},id=owner.hash)=>call('plugins.command',{id,operation,args});
  const ownerBefore=(await inspect()).find(n=>n.hash===owner.hash),beforeFrames=await call('diagnostics.frame',{frames:6});await page.locator('#tabAttributes').click();
  await timed('native Probe Attributes creation',2000,async()=>{await page.locator('#attrContent [data-plugin-action-button="create-probe"]').click();await call('scene.inspect');});
  const created=(await inspect()).find(n=>n.type==='thermal_probe'),hash=created?.hash;
  check('native Probe action selects its ordinary child',created?.selected&&created.parent===owner.hash,created);
  checkDefaultProbeFrame(check,await inspect(),hash,owner.hash,'New Probe');
  await call('view.set',{coordinates:'object',focus:hash});
  check('2 mm Probe helper has selectable native box edges',await page.locator(`.frame-plugin-hit[data-hash="${hash}"]`).count()>0&&!!await page.locator(`.frame-plugin-hit[data-hash="${hash}"]`).first().getAttribute('d'));
  await timed('native Probe translation',1500,()=>call('transform.set',{channel:'position',axis:0,value:3,coordinates:'world'}));
  const moved=(await inspect()).find(n=>n.hash===hash),movedPacked=[...packed];movedPacked[9]=3;
  check('Probe native transform edits the installed frame',equal(moved.matrix,movedPacked),moved);
  const ownerAfterMove=(await inspect()).find(n=>n.hash===owner.hash);
  check('immediate Probe Attributes transform moves only child world frame and bounds',near(moved.worldMatrix.slice(12,15),[3,0,0])&&near(moved.bounds.min,[2,-1,-1])&&near(moved.bounds.max,[4,1,1])&&equal(ownerAfterMove.matrix,ownerBefore.matrix)&&equal(ownerAfterMove.worldMatrix,ownerBefore.worldMatrix),{probe:moved,ownerBefore,ownerAfter:ownerAfterMove});
  // Each API command settles native synchronization. Selection/display changes
  // must never reinstall the one-shot default over an authored transform.
  for(let i=0;i<3;i++){await call('scene.select',{ids:[owner.hash]});await call('scene.select',{ids:[hash]});}
  check('repeated native synchronization preserves edited Probe frame',equal((await inspect()).find(n=>n.hash===hash).matrix,moved.matrix));
  await timed('native Probe transform Undo',1500,()=>call('edit.history',{action:'undo'}));checkDefaultProbeFrame(check,await inspect(),hash,owner.hash,'Undo Probe');
  await call('edit.history',{action:'redo'});check('native Probe transform Redo restores edited frame',equal((await inspect()).find(n=>n.hash===hash).matrix,moved.matrix));
  const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'thermal-probe-native-frame.hash',base64:saved.base64});
  const reopened=(await inspect()).find(n=>n.hash===hash);check('HASH preserves edited Probe frame and reference without rerunning initializer',equal(reopened.matrix,moved.matrix)&&reopened.parent===owner.hash&&reopened.params.Thermal===owner.hash,reopened);
  // No scene.select/manual selection repair between each create and transform.
  // Include commands queued together to exercise frameAI's actual serialized
  // operation boundary, not only callers that wait before sending the next edit.
  const repeated=[];
  for(let i=0;i<3;i++){
   const before=(await inspect()).map(n=>({hash:n.hash,matrix:n.matrix,worldMatrix:n.worldMatrix})),x=6+i;
   const next=await timed('queued Probe API create and immediate transform '+i,3500,()=>page.evaluate(async({owner,x})=>{
    const start=performance.now();let selectedAt;
    const created=frameAI.call('plugins.command',{id:owner,operation:'create-probe',args:{}}).then(probe=>{selectedAt=performance.now();return probe;}),moved=frameAI.call('transform.set',{channel:'position',axis:0,value:x,coordinates:'world'}).then(()=>performance.now());
    const [probe,finished]=await Promise.all([created,moved]);return {...probe,creationMs:selectedAt-start,transformMs:finished-selectedAt};
   },{owner:owner.hash,x}));
   check('queued Probe creation and transform retain individual latency budgets '+i,next.creationMs<2000&&next.transformMs>=0&&next.transformMs<1500,next);
   const records=await inspect(),child=records.find(n=>n.hash===next.hash),expected=[...packed];expected[9]=x;repeated.push(next.hash);
   check('queued Probe API create selects and transforms only its new child '+i,child?.selected&&child.parent===owner.hash&&child.params.Thermal===owner.hash&&equal(child.matrix,expected)&&near(child.worldMatrix.slice(12,15),[x,0,0])&&near(child.bounds.min,[x-1,-1,-1])&&near(child.bounds.max,[x+1,1,1])&&before.every(old=>{const now=records.find(n=>n.hash===old.hash);return equal(now?.matrix,old.matrix)&&equal(now?.worldMatrix,old.worldMatrix);}),{child,before,after:records.map(n=>({hash:n.hash,matrix:n.matrix,worldMatrix:n.worldMatrix}))});
   if(i===0){
    await call('edit.history',{action:'undo'});checkDefaultProbeFrame(check,await inspect(),next.hash,owner.hash,'API translation Undo Probe');
    await call('edit.history',{action:'undo'});check('Probe creation has one Undo checkpoint and selection adds none',!(await inspect()).some(n=>n.hash===next.hash));
    await call('edit.history',{action:'redo'});checkDefaultProbeFrame(check,await inspect(),next.hash,owner.hash,'Creation Redo Probe');
    await call('edit.history',{action:'redo'});check('Probe transform Redo follows creation Redo exactly',equal((await inspect()).find(n=>n.hash===next.hash).matrix,expected));
   }
  }
  await call('scene.delete',{ids:repeated});
  const standalone=await call('plugins.create',{plugin:'thermal',type:'thermal_probe'});checkDefaultProbeFrame(check,await inspect(),standalone.hash,null,'Standalone Probe');
  const transformedOwner=await call('plugins.create',{plugin:'thermal'});
  await call('transform.set',{channel:'size',axis:0,value:200,coordinates:'object'});
  await call('transform.set',{channel:'rotation',axis:2,value:31,coordinates:'object'});
  for(const [axis,value]of [100,-200,300].entries())await call('transform.set',{channel:'position',axis,value,coordinates:'world'});
  const transformedProbe=await cmd('create-probe',{},transformedOwner.hash);checkDefaultProbeFrame(check,await inspect(),transformedProbe.hash,transformedOwner.hash,'Transformed-parent Probe');
  const extra=[];await timed('32 native Probe creation operations',10000,async()=>{for(let i=0;i<32;i++)extra.push((await cmd('create-probe')).hash);});
  const records=await inspect();check('all 32 new Probes retain exact installed native frame',extra.every(hash=>equal(records.find(n=>n.hash===hash)?.matrix,packed)));
  await call('view.set',{index:0,single:true,focus:owner.hash});await call('diagnostics.frame',{frames:6});const afterFrames=await call('diagnostics.frame',{frames:12});
  check('Probe helpers have bounded measured CPU/GPU frames',afterFrames.timestampQueries&&afterFrames.frames.length===12&&afterFrames.frames.every(f=>Number.isFinite(f.cpuMs)&&Number.isFinite(f.gpuMs)&&f.cpuMs<50&&f.gpuMs<50),{beforeFrames,afterFrames});
  await call('scene.delete',{ids:extra});
  const gpu=await page.evaluate(async()=>{await frameEngine.renderer.device.queue.onSubmittedWorkDone();return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,errors:__probeGPU,lost:__probeLost};});
  check('Probe native workflow has no page/GPU errors',!errors.length&&!gpu.validation&&!gpu.errors.length&&!gpu.lost,{errors,gpu});
  return {hardware,beforeFrames,afterFrames,gpu,scope:'Probe native helper authoring only; full Thermal physics/lifecycle and application/stress are separate gates.'};
 }finally{await context.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const checks=[],timings=[];let session,result;
 const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const timed=async(name,limit,fn)=>{const start=performance.now(),value=await fn(),ms=performance.now()-start;timings.push({name,ms,limit});check(name+' latency',ms<limit,{ms,limit});return value;};
 try{session=await launch({headless:process.argv.includes('--headless')});const evidence=await nativeProbeBrowserChecks(session.page,check,timed);result={pass:true,hardwareVerified:true,checks,timings,evidence};}
 catch(error){result={pass:false,hardwareVerified:false,checks,timings,error:error.stack};}
 finally{await session?.close();}
 result.sources={};for(const path of ['index.html','plugins/thermal/tests/native-selection.mjs','plugins/thermal/plugin.js','plugins/thermal/plugin.json','plugins/thermal/tests/native-probe.mjs','plugins/thermal/tests/native-creation-fixture.mjs','plugins/thermal/tests/native-probe-browser.mjs','plugins/thermal/tests/browser-gates.mjs','tools/browser.mjs'])result.sources[path]=createHash('sha256').update(await readFile(new URL('../../../'+path,import.meta.url))).digest('hex');
 await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/thermal-native-probe.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
}
