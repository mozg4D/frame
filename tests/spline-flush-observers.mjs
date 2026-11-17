import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function splineFlushObserverChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[];
 const a=html.indexOf('  async function flush(live=false){'),b=html.indexOf('if(timer){',a);assert.ok(a>=0&&b>a);
 const r=html.indexOf('  function request(){if(!states.size'),end=html.indexOf('\n',r);assert.ok(r>=0&&end>r);
 function fixture(){
  let resolve,reject,publications=0;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const api=Function('pending','window',`let dirty=false,timer=0,running=pending,boxTask=Promise.resolve(),editing=false;const states=new Map([['owner',{}]]),nodes=[],supported=new Set(),special=new Set(),isEditing=()=>editing;
   ${html.slice(a,b)}throw Error('Unexpected idle evaluator branch');}
   ${html.slice(r,end)}
   return {flush,request,get dirty(){return dirty;},set editing(value){editing=value;}};`)(pending,{frameEngine:{flushReplicaPublication(){publications++;}}});
  return {api,resolve,reject,publications:()=>publications};
 }
 const shared=fixture(),observers=Array.from({length:8},()=>shared.api.flush());await Promise.resolve();
 assert.equal(shared.api.dirty,false,'Concurrent flush observers must not request another evaluator pass');shared.resolve('done');assert.deepEqual(await Promise.all(observers),Array(8).fill('done'));
 checks.push({name:'Eight actual flush observers share pending completion without dirtying evaluation',pass:true});
 const changed=fixture(),wait=changed.api.flush();await Promise.resolve();changed.api.request();assert.equal(changed.api.dirty,true);changed.resolve();await wait;assert.equal(changed.api.dirty,true);
 checks.push({name:'A real authoring request during pending evaluation remains dirty',pass:true});
 const failed=fixture(),error=Error('Pending evaluator failed'),failures=Array.from({length:8},()=>failed.api.flush());await Promise.resolve();failed.reject(error);for(const result of await Promise.allSettled(failures)){assert.equal(result.status,'rejected');assert.equal(result.reason,error);}assert.equal(failed.api.dirty,false);
 checks.push({name:'Observers preserve the pending evaluation error without requesting retries',pass:true});
 const editing=fixture();editing.api.editing=true;await editing.api.flush();assert.equal(editing.api.dirty,true);assert.equal(editing.publications(),1);editing.resolve();
 checks.push({name:'Manual-edit deferral retains its existing dirty/publication behavior',pass:true});
 return {pass:true,checks,indexSHA256:createHash('sha256').update(html).digest('hex'),browserVerified:false,gpuVerified:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await splineFlushObserverChecks(),null,2));
