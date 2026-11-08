// Actual host module + real MessageChannel, synthetic popup lifecycle only.
import assert from 'node:assert/strict';
import {installDocumentationWindow} from '../core/documentation-window.mjs';
globalThis.location={origin:'https://frame.example'};
class Target{listeners=new Map();addEventListener(n,f){const a=this.listeners.get(n)||[];a.push(f);this.listeners.set(n,a);}fire(n,e={}){for(const f of this.listeners.get(n)||[])f(e);}}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(write=async()=>{}){
 const host=new Target(),events=new Target(),button={},children=[],messages=[];let token,closeCount=0;
 host.open=url=>{token=url.hash.slice(1);const child={closed:false,focus(){},postMessage(m,origin,[port]){this.port=port;port.onmessage=e=>messages.push(e.data);}};children.push(child);return child;};host.alert=()=>{};
 const api=installDocumentationWindow({button,host,events,read:()=>({text:'safe text',version:'epoch:0'}),write,timeout:200});
 const connect=()=>{const child=children.at(-1);host.fire('message',{source:child,origin:location.origin,data:{kind:'frame-docs-ready',token}});return child;};
 button.onclick();const child=connect();
 return {api,host,button,child,children,messages,connect,close:()=>closeCount++,get closes(){return closeCount;},cleanup(){host.fire('pagehide');for(const child of children)child.port?.close();}};
}
const checks=[];async function check(name,run){const start=performance.now();await run();const ms=performance.now()-start;assert.ok(ms<1000);checks.push({name,pass:true,ms,budgetMs:1000});}
await check('Delayed closed flag completes pending seal without a dead port timeout',async()=>{const f=fixture();try{const p=f.api.seal({mode:'replace',epoch:'epoch',close:f.close});setTimeout(()=>f.child.closed=true,10);assert.equal(await p,null);assert.equal(f.closes,1);}finally{f.cleanup();}});
await check('Canceled close does not falsely release a live draft',async()=>{const f=fixture();try{await assert.rejects(f.api.seal({mode:'replace',epoch:'epoch',close:f.close}),/did not finish/);assert.equal(f.child.closed,false);assert.equal(f.closes,1);}finally{f.cleanup();}});
await check('Acknowledged seal retains verify and rejects later popup closure',async()=>{const f=fixture();try{const p=f.api.seal({mode:'save',epoch:'epoch',close:f.close});await pause(5);const m=f.messages.find(m=>m.kind==='seal');f.child.port.postMessage({kind:'sealed',id:m.id,ok:true,version:'epoch:0'});const lease=await p;lease.verify();f.child.closed=true;assert.throws(()=>lease.verify(),/Docs changed/);lease.release();assert.equal(f.closes,1);}finally{f.cleanup();}});
await check('Reopened child cannot be mistaken for the closed child of an old seal',async()=>{const f=fixture();try{const p=assert.rejects(f.api.seal({mode:'replace',epoch:'epoch',close:f.close}),/connection changed|reconnected/);f.child.closed=true;f.button.onclick();f.connect();await p;assert.equal(f.children.at(-1).closed,false);assert.equal(f.closes,1);}finally{f.cleanup();}});
await check('Parent closure aborts rather than authorizes the file operation',async()=>{const f=fixture();try{const p=assert.rejects(f.api.seal({mode:'save',epoch:'epoch',close:f.close}),/Main scene connection closed/);f.host.fire('pagehide');await p;assert.equal(f.closes,1);}finally{f.cleanup();}});
await check('Late write from a closed child cannot mutate documentation',async()=>{let release,entered,mutations=0;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);const f=fixture(async(args,guard)=>{entered();await wait;guard();mutations++;return {text:args.text,version:'epoch:1'};});try{f.child.port.postMessage({kind:'write',id:1,text:'late draft',version:'epoch:0'});await started;const seal=f.api.seal({mode:'save',epoch:'epoch',close:f.close});f.child.closed=true;assert.equal(await seal,null);release();await pause(10);assert.equal(mutations,0);assert.equal(f.closes,1);}finally{release();f.cleanup();}});
console.log(JSON.stringify({pass:true,assertions:checks.length,checks},null,2));
