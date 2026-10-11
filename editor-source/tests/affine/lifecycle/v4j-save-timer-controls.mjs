import {reviewURL} from '../source-paths.mjs';
import{verifySource}from'../verify-source.mjs';verifySource();
import fs from'node:fs';import vm from'node:vm';import assert from'node:assert/strict';
const editor=fs.readFileSync(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url),'utf8');
function exact(name){const i=editor.indexOf(`function ${name}(`);assert(i>=0);const begin=editor.lastIndexOf('\n',i)+1,end=Math.min(...[editor.indexOf('\nfunction ',i),editor.indexOf('\nasync function ',i)].filter(x=>x>=0));return editor.slice(begin,end);}
function env(){const calls={scheduler:0,drain:0,timers:[],ticks:0};const c={Set,Map,Promise,DOMException,AbortController,clearTimeout,setTimeout(fn,ms){calls.timers.push(ms);return setTimeout(()=>{calls.ticks++;fn();},ms);},frameRigidInput:null,frameRigidExecuting:null,frameRigidQueue:[],frameRigidDraining:true,frameAffineLifecycleGeneration:1,frameRigidGestureGeneration:1,sceneMutationSequence:1,frameAffineStages:new Map(),frameAffineSaving:null,frameAffineSavingBoundary:null,frameAffineStageCurrent:()=>true,frameAffineSourceStamp:m=>m,frameAffineStampCurrent:()=>true,frameAffinePruneStages(){},frameAffineYield(){calls.scheduler++;throw Error('Prioritized yield path must not be used while Drain runs');},async frameRigidDrain(){calls.drain++;throw Error('Existing Drain must not be re-entered');}};vm.createContext(c);for(const n of ['frameAffineBoundary','frameAffineBoundaryCurrent','frameAffineWaitForSave','nativeSaveWait'])vm.runInContext(exact(n),c);return{c,calls};}
const rows=[];
for(const mode of ['queued-preparation-completes','abort-Save-only','cancel-released-gesture','two-released-commits']){
 const{c,calls}=env(),a={released:true},b={released:true};c.frameRigidQueue=mode==='two-released-commits'?[a,b]:[a];c.frameRigidExecuting=a;const abort=new AbortController();let saved=false;const waiting=c.frameAffineWaitForSave(abort.signal).then(()=>saved=true),callbacks=[];
 if(mode==='abort-Save-only')callbacks.push(setTimeout(()=>abort.abort(new DOMException('controlled Save cancel','AbortError')),11));
 else callbacks.push(setTimeout(()=>{if(mode==='cancel-released-gesture')a.cancel=true;else a.committed=true;c.frameRigidQueue.shift();c.frameRigidExecuting=mode==='two-released-commits'?b:null;if(mode!=='two-released-commits')c.frameRigidDraining=false;},17));
 if(mode==='two-released-commits')callbacks.push(setTimeout(()=>{assert.equal(saved,false);b.committed=true;c.frameRigidQueue=[];c.frameRigidExecuting=null;c.frameRigidDraining=false;},33));
 let deadline;try{await Promise.race([mode==='abort-Save-only'?assert.rejects(waiting,e=>e.name==='AbortError'):waiting,new Promise((_,reject)=>deadline=setTimeout(()=>reject(Error('Save timer path stalled')),1000))]);}finally{clearTimeout(deadline);for(const t of callbacks)clearTimeout(t);}
 assert.equal(calls.scheduler,0);assert.equal(calls.drain,0);assert(calls.ticks>=1);assert(calls.timers.length<100);assert(calls.timers.every(ms=>ms===4));
 if(mode==='abort-Save-only'){assert(!saved);assert(!a.cancel&&!a.discarded&&!a.committed);}else assert(saved);
 rows.push({mode,timerMilliseconds:[...new Set(calls.timers)],timerCallbacks:calls.ticks,prioritizedYieldCalls:0,reenteredDrain:0,saveCompleted:saved,abortDoesNotCancelCommit:mode==='abort-Save-only'?true:null});
}
console.log(JSON.stringify({passed:true,scope:'Exact V4j Save-boundary/wait functions with an existing-Drain fixture; real Node timers, prioritized yield disabled deliberately; no browser scheduling/performance claim',rows},null,2));
