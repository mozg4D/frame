import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {TopologyCache} from '../interaction-controller.mjs';
const NativeChannel=globalThis.MessageChannel,owned=[];
globalThis.MessageChannel=class extends NativeChannel {constructor(){super();const row={closed:[0,0]};owned.push(row);for(const [i,p]of [this.port1,this.port2].entries()){const close=p.close.bind(p);p.close=()=>{row.closed[i]++;return close();};}}};
const pending=[],stats={acquired:0,released:0,workers:0,terminated:0},out={pass:false,controlledLifecycle:true,notHardwareAcceptance:true,cases:[]};
const geometry=n=>{const a=new Float32Array(n*3),p={array:a,count:n,itemSize:3,version:0,getX:i=>a[i*3],getY:i=>a[i*3+1],getZ:i=>a[i*3+2]};for(let i=0;i<n;i++){a[i*3]=i%3;a[i*3+1]=Math.floor(i/3);}return{attributes:{position:p},index:null};};
const factory=()=>{stats.workers++;const worker=new Worker(new URL('./connected-node-worker.mjs',import.meta.url)),adapter={onmessage:null,onerror:null,postMessage:(data,transfer)=>worker.postMessage(data,transfer),terminate(){stats.terminated++;pending.push(worker.terminate());}};worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',e=>adapter.onerror?.(e));return adapter;};
const options={workerFactory:factory,acquireLease:async()=>{stats.acquired++;return{release(){stats.released++;}};}};
try{
 const g=geometry(16386),cache=new TopologyCache(options),first=await cache.get(g);assert(first.isCurrent());assert.equal((await cache.get(g)).topology,first.topology);cache.invalidate(g);const second=await cache.get(g);assert.notEqual(second.topology,first.topology);cache.dispose();assert.equal(cache.yieldQueue!==null,true);out.cases.push('Owned default MessageChannel: complete, reuse, invalidate, rebuild, dispose');
 const active=new TopologyCache(options),p=active.get(geometry(20000));await Promise.resolve();active.dispose();await assert.rejects(p,e=>e.name==='AbortError');await assert.rejects(active.get(g),e=>e.name==='AbortError');out.cases.push('Dispose during cooperative capture rejects current and later request');
 const channelsBefore=owned.length;let yields=0;const changed=geometry(20000),custom=new TopologyCache({...options,yieldTask:async()=>{yields++;changed.attributes.position.version++;}});await assert.rejects(custom.get(changed),e=>e.name==='AbortError');assert(yields>0);custom.dispose();assert.equal(custom.yieldQueue,null);assert.equal(owned.length,channelsBefore);out.cases.push('Caller scheduler retained; source version mutation rejects stale capture before worker');
 await Promise.all(pending);assert.equal(stats.acquired,stats.released);assert.equal(stats.workers,stats.terminated);assert(owned.every(row=>row.closed.every(n=>n===1)));out.stats=stats;out.ownedChannels=owned;out.pass=true;
}catch(e){out.reason=String(e);out.stack=e.stack;process.exitCode=1;}finally{globalThis.MessageChannel=NativeChannel;console.log(JSON.stringify(out));}
