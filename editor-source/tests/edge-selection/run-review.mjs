import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// The runner catches child stderr and emits one structured stdout result, including
// failure details. It never creates reports or writes anything into the checkout.
const suites={source:'verify-source.mjs',math:'math/review-math.mjs',receipt:'receipt/receipt-adversarial.mjs',lifecycle:'lifecycle/lifecycle.mjs',postPublicationBoundary:'lifecycle/post-publication-boundary.mjs',postPublicationMutations:'lifecycle/post-publication-regressions.mjs',independentResume:'additional/independent-resume-controls.mjs'};
const results={};
for(const [key,path]of Object.entries(suites)){
  const r=spawnSync(process.execPath,[fileURLToPath(new URL(path,import.meta.url)),...process.argv.slice(2)],{encoding:'utf8',maxBuffer:20*1024*1024});
  if(r.status!==0){
    const detail=(r.stderr||r.stdout||r.error?.message||'Unknown child failure').replaceAll(fileURLToPath(new URL('./',import.meta.url)),'<tests>/').replace(/file:\/\/[^\s)]+/g,'<source>');
    console.log(JSON.stringify({checksCompleted:false,positiveControlsPass:false,failedSuite:path,exitStatus:r.status,detail},null,2));
    process.exitCode=1;break;
  }
  try{results[key]=JSON.parse(r.stdout)}catch{console.log(JSON.stringify({checksCompleted:false,positiveControlsPass:false,failedSuite:path,detail:'Child did not emit a JSON result'}));process.exitCode=1;break;}
}
if(!process.exitCode){
  const positiveControlsPass=results.source.pass&&results.math.pass&&results.receipt.failed.length===0&&results.lifecycle.pass&&results.postPublicationMutations.pass&&results.independentResume.pass;
  console.log(JSON.stringify({checksCompleted:true,positiveControlsPass,knownSourceGuardGaps:results.postPublicationBoundary.stalePreparedFrameUsed?['doPick resumes with stale prepared measurements after synthetic post-publication microtask context change']:[],scope:'Source/Node only. No real model, browser input, timing, heap or publication acceptance.',results},null,2));
  if(!positiveControlsPass)process.exitCode=1;
}
