import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildZooScene,gridCage} from './scenes/generate-zoo-10k.mjs';

export async function splineWorkerFanoutChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
 try{
  const scalar=Function(html.split('\n').find(line=>line.startsWith('function frameCubicNumber('))+';return frameCubicNumber;')();
  const factory=Function('return('+html.match(/<script id="frame-spline-kernel"[^>]*>([\s\S]*?)<\/script>/)[1]+')')(),workerSource=html.match(/<script id="frame-spline-worker"[^>]*>([\s\S]*?)<\/script>/)[1],cellLoops=html.split('\n').find(line=>line.startsWith('function frameCellLoops('));
  function worker(legacy=false){const listeners=[],e={FrameSplineKernel:factory,frameCubicNumber:scalar,performance,structuredClone,TextEncoder,TextDecoder,console,onmessage:null,postMessage:value=>e.reply=value,addEventListener:(_type,callback)=>listeners.push(callback)};vm.createContext(e);vm.runInContext(cellLoops+'\n'+workerSource,e);if(legacy)e.splineWorkerBudget=(state,requested)=>({cpuCells:state.dirty.filter(i=>!state.quads[i]).length,estimatedWork:0,threads:Math.max(1,Math.min(state.dirty.filter(i=>!state.quads[i]).length,requested||1))});let sequence=0;return {environment:e,send(op,args={}){e.reply=null;const event={data:{id:++sequence,op,...args},stopped:false,stopImmediatePropagation(){this.stopped=true;}};for(const callback of listeners){callback(event);if(event.stopped)break;}if(!event.stopped)e.onmessage(event);if(!e.reply||e.reply.id!==sequence)throw Error('Native worker did not reply');if(e.reply.error)throw Error(e.reply.error);return e.reply.result;}};}
  function build(data,{threads=8,legacy=false,cacheLimit=16*1024*1024}={}){const coordinator=worker(legacy),plan=coordinator.send('prepare',{data:structuredClone(data),key:'worker-parity:spline_patch',threads,cacheLimit}),lanes=[coordinator,...plan.jobs.map(job=>{const lane=worker(legacy);lane.send('init',job);return lane;})],parts=plan.chunks.flatMap((indices,index)=>lanes[index].send('batch',{indices})),result=coordinator.send('assemble',{parts});for(const lane of lanes)lane.send('release');return {plan,result};}
  const zoo=buildZooScene(),K=factory(scalar),primitiveTypes=['cube','cylinder','tube','sphere','capsule','nut','washer','bolt'];
  for(const type of primitiveTypes){const object=zoo.objects.find(n=>n.type===type),data=K.primitive(type,object.params),at=performance.now(),adaptive=build(data),old=build(data,{legacy:true}),serial=build(data,{threads:1});timings.push({type,ms:performance.now()-at,oldThreads:old.plan.chunks.length,threads:adaptive.plan.chunks.length,estimatedWork:adaptive.plan.workerBudget.estimatedWork});
   check(type+' exact native worker cell geometry matches both single-lane and previous fanout routes',()=>{for(const field of ['vertices','indices','tasks','packets']){assert.deepEqual(Array.from(adaptive.result[field]),Array.from(old.result[field]),field);assert.deepEqual(Array.from(adaptive.result[field]),Array.from(serial.result[field]),field);}assert.deepEqual(JSON.parse(JSON.stringify(adaptive.result.faceRanges)),JSON.parse(JSON.stringify(old.result.faceRanges)));assert.deepEqual(JSON.parse(JSON.stringify(adaptive.result.sourceAccuracy)),JSON.parse(JSON.stringify(old.result.sourceAccuracy)));});
   check(type+' cheap CPU cells avoid auxiliary worker initialization and preserve GPU quad selection',()=>{assert.equal(adaptive.plan.chunks.length,1);assert.equal(adaptive.plan.jobs.length,0);assert.equal(adaptive.result.report.gpuCells,old.result.report.gpuCells);assert.equal(adaptive.result.report.cpuTriangleCacheBytes,0);assert.ok(adaptive.result.report.cacheBytes<=16*1024*1024);});
  }
  const dense=gridCage(4,4,10,3);dense.approximation.angle=1;for(const edge of Object.values(dense.segments))edge.approximation={angle:1};const lane=worker(),plan=lane.send('prepare',{data:dense,key:'dense:spline_patch',threads:8,cacheLimit:16*1024*1024});
  check('Fine-angle nonplanar interiors retain fanout even with straight lightly sampled boundaries',()=>{assert.equal(plan.chunks.length,8);assert.equal(plan.jobs.length,7);assert.ok(plan.workerBudget.estimatedWork>=4096);assert.ok(plan.workerBudget.cpuCells>=8);});
  const requested=lane.send('prepare',{data:dense,key:'dense:spline_patch',threads:2,cacheLimit:16*1024*1024});
  check('Estimated workload respects the requested lane count and existing plan cache budget',()=>{assert.equal(requested.chunks.length,2);assert.equal(requested.jobs.length,1);assert.equal(vm.runInContext('surfaceCacheBudget',lane.environment),16*1024*1024);});
  return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await splineWorkerFanoutChecks();report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');await mkdir(new URL('./results/',import.meta.url),{recursive:true});await writeFile(new URL('./results/spline-worker-fanout.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
}
