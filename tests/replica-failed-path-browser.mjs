import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launch,ready} from '../tools/browser.mjs';

const base=new URL('../',import.meta.url),source=await readFile(new URL('index.html',base),'utf8'),expected=createHash('sha256').update(source).digest('hex'),label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'latest';
const checks=[],errors=[],session=await launch({headless:true}),page=session.page;
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('[failed replica path] '+name);};let report;
try{
 await page.route('**/index.html',r=>r.fulfill({contentType:'text/html',body:source}));await page.reload();await ready(page);page.on('pageerror',e=>errors.push(e.stack));
 await page.evaluate(()=>{window.__failureGPU=[];window.__failureDevice=frameEngine.renderer.device;__failureDevice.addEventListener('uncapturederror',e=>__failureGPU.push(e.error.message));__failureDevice.pushErrorScope('validation');});
 for(const type of ['circle','cube'])for(const target of ['nested','direct']){
  await call('scene.new');
  const sourceObject=await call('scene.create',{type,name:'Canonical '+type}),q=await call('scene.create',{type:'cloner',name:'Q',inputs:[sourceObject.hash],params:{'count x':2,'count y':1,'count z':1}}),n=await call('scene.create',{type:'instance',name:'N',params:{object:q.hash}});
  const result=await page.evaluate(({sourceHash,qHash,nHash,target})=>{
   const scene=frameEngine.scene,q=frameNodeByHash(qHash),n=frameNodeByHash(nHash),rows=()=>[...scene.meshes.filter(m=>m.replicaMatrix),...scene.curveReplicas],before=rows().filter(m=>m.hashId===qHash||m.hashId===nHash),owned=new Set(before.filter(m=>m.hashId===qHash||target==='nested'&&m.hashId===nHash).flatMap(m=>m.buffers)),destroyed=new Map(),canonical=scene.meshes.find(m=>m.hashId===sourceHash&&!m.replicaMatrix),display=frameEngine.splineDisplays.get(sourceHash),displayBuffers=display?.buffers.slice(),sourceBuffers=new Set(canonical?.buffers||displayBuffers||[]),sourceDestroyed=[],prototype=GPUBuffer.prototype,original=prototype.destroy;
   prototype.destroy=function(){if(owned.has(this))destroyed.set(this,(destroyed.get(this)||0)+1);if(sourceBuffers.has(this))sourceDestroyed.push(this.label);return original.apply(this,arguments);};
   let thrown;try{Object.assign(q.params,{'count x':1000,'count y':1000,'count z':1});frameEngine.syncReplicas(new Set([target==='nested'?n.id:q.id]));}catch(e){thrown=e.stack;}finally{prototype.destroy=original;}
   return {before:before.map(m=>({hash:m.hashId,curve:!!m.curve})),owned:owned.size,destroyed:destroyed.size,sourceDestroyed,releaseCounts:[...destroyed.values()],remaining:rows().filter(m=>m.hashId===qHash||target==='nested'&&m.hashId===nHash).length,errorQ:q.splineError,errorN:n.splineError,canonicalStable:canonical?scene.meshes.includes(canonical):frameEngine.splineDisplays.get(sourceHash)===display,sourceBuffersStable:canonical?canonical.positions.size>0&&canonical.indices.size>0:!!displayBuffers?.length&&displayBuffers.every(b=>b.size>0&&!owned.has(b)),thrown};
  },{sourceHash:sourceObject.hash,qHash:q.hash,nHash:n.hash,target});
  check(type+' '+target+' fixture has two Q occurrences',result.before.filter(m=>m.hash===q.hash).length===2,result);
  check(type+' '+target+' retires the failed owner rows',!result.thrown&&result.remaining===0&&result.errorQ==='Cloner exceeds 100000 instances'&&(target!=='nested'||result.errorN===result.errorQ),result);
  check(type+' '+target+' releases every private old resource exactly once',result.owned>0&&result.destroyed===result.owned&&result.releaseCounts.every(n=>n===1),result);
  check(type+' '+target+' preserves canonical source geometry',result.canonicalStable&&result.sourceBuffersStable&&!result.sourceDestroyed.length,result);
 }
 await call('scene.new');
 const sourceObject=await call('scene.create',{type:'circle'}),r=await call('scene.create',{type:'instance',name:'successful R',params:{object:sourceObject.hash}}),b=await call('scene.create',{type:'instance',name:'failing B',params:{object:sourceObject.hash}}),q=await call('scene.create',{type:'cloner',name:'Q',inputs:[r.hash,b.hash],params:{'count x':2,'count y':1,'count z':1}}),n=await call('scene.create',{type:'instance',name:'N',params:{object:q.hash}});
 const success=await page.evaluate(({r,b,q,n})=>{const scene=frameEngine.scene,old=scene.curveReplicas.find(m=>m.hashId===r),bad=frameNodeByHash(b);bad.params.object='ffffffffffffffffffffffffffffffff';frameEngine.syncReplicas(new Set([frameNodeByHash(n).id]));return {rRows:scene.curveReplicas.filter(m=>m.hashId===r).length,rStable:scene.curveReplicas.includes(old)&&old.uniform.size>0,rError:frameNodeByHash(r).splineError,failedRows:scene.curveReplicas.filter(m=>[b,q,n].includes(m.hashId)).length,errors:[b,q,n].map(h=>frameNodeByHash(h).splineError)};},{r:r.hash,b:b.hash,q:q.hash,n:n.hash});
 check('Successful nested dependency retains its original private resources',success.rRows===1&&success.rStable&&!success.rError,success);
 check('Only the failed active dependency path is retired',success.failedRows===0&&success.errors.every(e=>e==='Instance requires an independent source'),success);
 const gpu=await page.evaluate(async()=>{await __failureDevice.queue.onSubmittedWorkDone();return {validation:(await __failureDevice.popErrorScope())?.message||null,uncaptured:__failureGPU,deviceSame:frameEngine.renderer.device===__failureDevice};});
 check('No JavaScript or GPU errors during nested failure retirement',!errors.length&&!gpu.validation&&!gpu.uncaptured.length&&gpu.deviceSame,{errors,gpu});report={pass:true,checks,errors,gpu};
}catch(error){report={pass:false,checks,errors,error:error.stack};console.error(error.stack);process.exitCode=1;}finally{await session.close();}
report.sourceSHA256=expected;report.sourceSHA256After=createHash('sha256').update(await readFile(new URL('index.html',base))).digest('hex');if(report.sourceSHA256After!==expected){report.pass=false;report.error='Application source changed during native regression';process.exitCode=1;}await mkdir(new URL('tests/results/',base),{recursive:true});await writeFile(new URL('tests/results/replica-failed-path-'+label+'.json',base),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
