import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkout,loadInputs} from './inputs.mjs';

// No writes, package installation, build, network or parser dependency.
const tests=['semantics/check-semantics.mjs','ribbon/review-ribbon.mjs','lifecycle/cache-lifecycle.mjs'];
const sanitize=s=>s.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<in-memory-native>').replaceAll(checkout,'<checkout>').replaceAll(fileURLToPath(new URL('./',import.meta.url)),'<edge-cache-tests>/');
try{
 const {sourceHashes}=await loadInputs(),results=[];
 for(const test of tests){
  const q=spawnSync(process.execPath,['--max-old-space-size=1024',fileURLToPath(new URL(test,import.meta.url)),checkout],{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
  let output;try{output=JSON.parse(q.stdout);}catch{output=sanitize(q.stdout??'');}
  results.push({test,pass:q.status===0&&output?.pass===true,exitCode:q.status,output,...(q.stderr?{diagnostic:sanitize(q.stderr)}:{}),...(q.error?{error:sanitize(q.error.message)}:{})});
 }
 if(results.every(result=>result.pass)){
  assert.equal(results[0].output.fixtures,46550,'Complete semantics fixture count');
  assert.equal(results[0].output.groupsChecked,816279,'Complete semantics group count');
  assert.equal(results[0].output.aliasesChecked,1544240,'Complete semantics alias count');
  assert.equal(results[0].output.sections.find(row=>row.name.includes('public owner/cache')).cases,16,'Complete malformed-input coverage');
  assert.equal(results[0].output.sections.find(row=>row.name.includes('stable repeated hit')).fixtures,100,'Complete public-cache integration coverage');
  assert.equal(results[1].output.rows.find(row=>row.name.startsWith('Exact differential rank output')).cases,2160,'Complete ribbon rank coverage');
  assert.equal(results[1].output.rows.length,9,'Complete ribbon control sections');
  assert.equal(results[2].output.passed.length,14,'Complete lifecycle control count');
 }
 const pass=results.every(result=>result.pass);
 console.log(JSON.stringify({pass,scope:'Production-bound CPU/source/mock-device compact edge-cache correctness controls',sourceHashes,browserAcceptance:false,performanceAcceptance:false,results},null,2));
 if(!pass)process.exitCode=1;
}catch(error){
 console.log(JSON.stringify({pass:false,error:sanitize(error.stack??String(error))},null,2));
 process.exitCode=1;
}
