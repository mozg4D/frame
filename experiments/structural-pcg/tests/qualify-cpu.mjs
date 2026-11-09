import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const base='experiments/structural-pcg/',output=new URL('./results/',import.meta.url);
await mkdir(output,{recursive:true});
const sources={};
for(const path of ['index.html',base+'gpu-pcg.js',base+'hex8-reference.js',base+'tests/validation.mjs',base+'tests/lifecycle.mjs',base+'tests/hardware.mjs',base+'tests/qualify-cpu.mjs'])sources[path]=createHash('sha256').update(await readFile(resolve(root,path))).digest('hex');
const report={scope:'Structural experimental PCG lifecycle continuation; CPU and command emulators only',node:process.version,started:new Date().toISOString(),main:'649c046723fc2d181e75d234c43ddf73f5165e75',sceneSolved:false,analysisReady:false,hardwareValidated:false,published:false,sources,stages:[],pending:['coordinated exact-source GPU component gate','full shared npm test -- --headless','integration/publication through main chat']};
const count=(text,key)=>Number(text.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??0);
async function run(name,args,{expected=0,env=process.env}={}){
 const start=performance.now(),r=spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:60000});
 const log=(r.stdout||'')+(r.stderr||'');await writeFile(new URL(name+'.log',output),log);
 const stage={name,args,exit:r.status,pass:r.status===expected&&!r.error,completedMs:performance.now()-start,tests:count(log,'tests'),passed:count(log,'pass'),failed:count(log,'fail'),skipped:count(log,'skipped'),log:base+'tests/results/'+name+'.log'};
 if(r.error)stage.error=r.error.message;report.stages.push(stage);return {stage,log};
}
await run('candidate-validation',['--test','--test-reporter=tap',base+'tests/validation.mjs',base+'tests/lifecycle.mjs']);
await run('candidate-authoring',['--test','--test-reporter=tap','plugins/structural/tests/authoring-preview.mjs']);
const bridge=await run('candidate-tag-bridge',['tests/plugin-tag-fields.mjs']);
if(bridge.stage.pass){const data=JSON.parse(bridge.log);bridge.stage.checks=data.checks.length;bridge.stage.timings=data.timings;}
await run('candidate-hardware-harness-syntax',['--check',base+'tests/hardware.mjs']);
await run('candidate-pcg-syntax',['--check',base+'gpu-pcg.js']);
const baseline=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11);
if(baseline){
 const bytes=await readFile(baseline);report.negativeControlSource={sha256:createHash('sha256').update(bytes).digest('hex')};
 const {stage}=await run('baseline-negative',['--test','--test-reporter=tap','--test-name-pattern=every dispose caller|bounded diagnostic reads exclude|copy validation error',base+'tests/lifecycle.mjs'],{expected:1,env:{...process.env,STRUCTURAL_PCG_MODULE:pathToFileURL(resolve(baseline)).href}});
 stage.pass&&=stage.failed===3&&stage.passed===0&&((stage.tests===3&&stage.skipped===0)||(stage.tests===9&&stage.skipped===6));
 stage.expectation='Exactly three old-source regressions fail; six unrelated tests intentionally excluded. These are negative controls, not passing baseline tests.';
}
report.pass=report.stages.every(s=>s.pass);report.finished=new Date().toISOString();
await writeFile(new URL('../LIFECYCLE-QUALIFICATION.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
