// Focused source/CPU gate. Each owning standalone test keeps its own assertions
// and report; no browser, native GPU benchmark or saved-scene generator runs.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),results=new URL('results/',import.meta.url);
export const performanceCPUStages=[
 'hash-address-cache','hash-identifier-codec','spline-codec-text-cache','zoo-metadata-work','node-lookup','transform-metadata-work','transform-notification-work','scene-bounds-reduction',
 'material-binding-cache','mesh-render-group-cache','render-material-frame-cache','material-thumbnail-cache','instance-uv-bindings',
 'spline-display-lookup','spline-highlight-work','spline-navigation-bounds','replica-source-hierarchy','replica-visibility-work',
 'selected-roots','selection-hierarchy-work','ai-selection-work','baked-cloner-selection',
 'affine-source-invalidation','boolean-signature-work','boolean-material-signature','instance-spline-sources','spline-sample-cache-exact','spline-worker-fanout',
 'spline-worker-single-message','worker-batch-profiling','spline-evaluation-session','spline-live-admission','cold-construction-pipeline','cold-construction-groups','cold-construction-token-ownership','spline-record-batch',
 'replica-authoring-index','replica-failed-path','replica-publication','scoped-replica-sync','material-replica-batches','replica-batch-order',
 'native-line-batch-order','render-bundle-cache','transform-background-work','material-wire-specialization',
 'spline-wire-lifecycle'
];

// Locate complete JSON objects printed on their own lines. Do not inspect
// nested negative-control data as though it were another root test report.
function rootReports(stdout){
 const reports=[];let offset=0;
 while(offset<stdout.length){const match=/^[ \t]*\{/m.exec(stdout.slice(offset));if(!match)break;const start=offset+match.index+match[0].lastIndexOf('{');let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=start;i<stdout.length;i++){const char=stdout[i];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&!--depth){end=i+1;break;}}
  if(end<0)break;try{const value=JSON.parse(stdout.slice(start,end));if(typeof value.pass==='boolean')reports.push(value);}catch{}offset=end;
 }
 return reports;
}
export function inspectCPUResult({code,signal,stdout='',stderr='',error}){
 const reports=rootReports(stdout),failed=reports.filter(report=>!report.pass),native=reports.some(report=>report.native===true),assertionOnly=!reports.length&&/^PASS(?:[:\s]|$)/m.test(stdout),pass=code===0&&!signal&&!error&&!native&&!failed.length&&(reports.length>0||assertionOnly);
 return {pass,reportedChecks:reports.length?reports.reduce((n,report)=>n+(Array.isArray(report.checks)?report.checks.length:0),0):null,reports,assertionOnly,...!pass?{error:error||failed.map(report=>report.error||report.checks?.filter(c=>c.pass===false).map(c=>c.name).join('; ')||'Root report pass:false').join('; ')||(native?'CPU stage unexpectedly reported native GPU execution':stderr.trim()||'No successful root report or standalone PASS marker')}:{}};
}
export function runnerChecks(){
 const check=input=>inspectCPUResult({code:0,stdout:'',...input});
 assert.equal(check({stdout:'{"pass":false,"error":"actual assertion"}'}).pass,false,'zero exit cannot hide pass:false');
 assert.equal(check({stdout:'log\n{"pass":true,"negative":{"pass":false}}\n'}).pass,true,'nested negative-control data is not a failed root');
 assert.equal(check({stdout:'{"pass":false}\n{"pass":true}'}).pass,false,'later successful output cannot hide an earlier failed root');
 assert.equal(check({stdout:'PASS: standalone owning assertions'}).pass,true);
 assert.equal(check({code:1,stdout:'{"pass":true}'}).pass,false);
 assert.equal(check({stdout:''}).pass,false);
 assert.equal(check({stdout:'{"pass":true,"native":true}'}).pass,false);
 assert.equal(check({stdout:'{"pass":true,"checks":[{"pass":true},{"pass":true}]}'}).reportedChecks,2);
 return {pass:true,native:false,checks:8};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHash=async()=>digest(await readFile(resolve(root,'index.html')));
async function runStage(name){
 const started=performance.now(),before=await sourceHash(),file=resolve(root,'tests',name+'.mjs');let stdout='',stderr='',error,code=null,signal=null;
 try{await new Promise(resolveStage=>{
  const child=spawn(process.execPath,[file],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let bytes=0;
  const timeout=setTimeout(()=>{error='CPU test exceeded the 120-second process watchdog';child.kill();},120000);
  const append=(kind,data)=>{bytes+=data.length;if(bytes>8*1024*1024){error='CPU test exceeded the 8 MiB output bound';child.kill();return;}if(kind==='out')stdout+=data.toString();else stderr+=data.toString();};
  child.stdout.on('data',data=>append('out',data));child.stderr.on('data',data=>append('err',data));
  child.on('error',failure=>{error=failure.stack;});child.on('close',(status,reason)=>{clearTimeout(timeout);code=status;signal=reason;resolveStage();});
 });}catch(failure){error=failure.stack;}
 const after=await sourceHash(),observation=inspectCPUResult({code,signal,stdout,stderr,error}),reportedSources=observation.reports.map(r=>r.sourceSHA256||r.indexSHA256).filter(Boolean),stable=before===after&&reportedSources.every(hash=>hash===before),log='performance-cpu-'+name+'.log';
 await writeFile(new URL(log,results),stdout+(stderr?'\n--- stderr ---\n'+stderr:''));
 return {name,file:'tests/'+name+'.mjs',pass:observation.pass&&stable,ms:performance.now()-started,exitCode:code,signal,sourceSHA256:before,sourceStable:stable,reportedChecks:observation.reportedChecks,assertionOnly:observation.assertionOnly,log:'tests/results/'+log,...!stable?{error:'Application source changed while this CPU stage ran'}:observation.error?{error:observation.error}:{}};
}
export async function performanceRegressionChecks(){
 runnerChecks();await mkdir(results,{recursive:true});const started=performance.now(),before=await sourceHash(),report={pass:false,native:false,startedAt:new Date().toISOString(),sourceSHA256:before,runnerChecks:8,stages:[]};
 for(const [i,name]of performanceCPUStages.entries()){
  console.log('[performance:cpu] '+(i+1)+'/'+performanceCPUStages.length+' '+name);const row=await runStage(name);report.stages.push(row);console.log('[performance:cpu] '+(row.pass?'PASS':'FAIL')+' '+name+' '+row.ms.toFixed(1)+' ms'+(row.reportedChecks===null?' (standalone assertions)':' ('+row.reportedChecks+' checks)'));if(!row.pass)console.log('[performance:cpu] '+row.error);
  await writeFile(new URL('performance-regressions-cpu.json',results),JSON.stringify({...report,elapsedMs:performance.now()-started},null,2));
 }
 report.finalSourceSHA256=await sourceHash();report.sourceStable=before===report.finalSourceSHA256&&report.stages.every(s=>s.sourceStable&&s.sourceSHA256===before);report.elapsedMs=performance.now()-started;report.reportedChecks=report.stages.reduce((n,s)=>n+(s.reportedChecks||0),0);report.assertionOnlyStages=report.stages.filter(s=>s.assertionOnly).length;report.pass=report.sourceStable&&report.stages.every(s=>s.pass);await writeFile(new URL('performance-regressions-cpu.json',results),JSON.stringify(report,null,2));return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{if(process.argv.includes('--self-test'))console.log(JSON.stringify(runnerChecks(),null,2));else{const report=await performanceRegressionChecks();console.log(JSON.stringify({pass:report.pass,native:false,stages:report.stages.length,reportedChecks:report.reportedChecks,assertionOnlyStages:report.assertionOnlyStages,elapsedMs:report.elapsedMs,sourceSHA256:report.sourceSHA256,sourceStable:report.sourceStable,failures:report.stages.filter(s=>!s.pass).map(s=>({name:s.name,error:s.error})),report:'tests/results/performance-regressions-cpu.json'},null,2));process.exitCode=report.pass?0:1;}}catch(error){console.error(error.stack);process.exitCode=1;}
}
