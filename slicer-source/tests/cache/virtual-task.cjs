'use strict';
// Actual production frameSlicerTask + actual owner/helper handlers over virtual transports.
// Sequential tiny synthetic meshes, no real pool, private input, or browser task.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const root=__dirname,dir=path.join(root,'proposal/progress-hotspot'),checks=[],check=(name,f)=>{f();checks.push(name);};
const hash=q=>crypto.createHash('sha256').update(JSON.stringify(q)).digest('hex');
const workerOriginal=require('./build.cjs').base,printerOriginal=require('./build.cjs').printer;
function coupon(){const vertices=[[0,0,0],[10,0,0],[10,0,10],[0,0,10],[0,1.1,0],[11,1.1,0],[11,1.1,10],[0,1.1,10]],indices=[];for(let i=0;i<4;i++){const j=(i+1)%4;indices.push(i,j,j+4,i,j+4,i+4);}indices.push(0,2,1,0,3,2,4,5,6,4,6,7);for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];return{positions:new Float64Array(vertices.flat()),indices:new Uint32Array(indices),matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],group:'synthetic-source-angle-coupon'};}
const params={width:1000,height:1000,depth:1000,lineWidth:1,initialLayerHeight:.6,layerHeight:.3,perimeters:1,minPathLength:3,printClockwiseSign:1,angleWarnings:true};
async function run(workerSource,printerSource,mode='normal',retentionMB=0,config={}){
 const controller=new AbortController(),workers=[],ports=[],jobs=[],updates=[],requests=[],urls=new Map(),held=[],pendingAcquires=[];
 config.onControls?.({cancel:()=>controller.abort()});
 let active=0,peak=0,releaseCount=0,revoked=0,ownerDeliveriesAfterFinish=0,triggered=false,helperFaultDelivered=false,aborted=false,settled=false;
 const sectionEntries=[],emittedStatuses=[],testTimers=[],cleanupThrown=new Set();let faultInjected=false,queuedCancelled=0;
 const cleanupFault=kind=>{if(config.cleanupThrow===kind&&!cleanupThrown.has(kind)){cleanupThrown.add(kind);throw Error('synthetic-cleanup-'+kind);}};
 const faultAt=(surface,phase,layer)=>!faultInjected&&config.fault?.surface===surface&&(!config.fault.phase||config.fault.phase===phase)&&(!config.fault.layer||config.fault.layer===layer);
 const inject=(surface,target)=>{faultInjected=true;defer(()=>{if(surface.includes('worker-error'))target.onerror?.({message:'synthetic transport worker failure'});else if(target.dispatchEvent)target.dispatchEvent({type:'messageerror'});else target.onmessageerror?.({});});if(config.abortAfterFaultMS)testTimers.push(setTimeout(()=>{config.beforeForcedAbort?.({settled,updates:structuredClone(updates),pendingAcquires:pendingAcquires.length});controller.abort();},config.abortAfterFaultMS));};
 const defer=(fn,n=0)=>{if(n)queueMicrotask(()=>defer(fn,n-1));else queueMicrotask(fn);};
 class BlobMock{constructor(parts){this.source=parts.join('');}}
 class Port{constructor(){this.closed=false;ports.push(this);}start(){}close(){this.closed=true;cleanupFault('port');}postMessage(data){if(this.closed)return;const source=this.worker;
   if(source?.terminated)return;const bytes=source?.c.__qaPacketEstimate(data)||0;assert(bytes<=4194304,'actual protocol message exceeds 4MiB');jobs.push({phase:data.phase,layer:data.layer,bytes,hasSource:!!data.sourceSnapshot,side:source?.name});
   const reply=structuredClone(data),deliver=()=>{if(this.closed||this.peer.closed||source?.terminated)return;try{this.peer.onmessage?.({data:reply});}catch(e){this.peer.worker?.onerror?.({message:e.message});}};
   if(data.phase==='prepared'&&data.error){helperFaultDelivered=true;}
   for(const surface of ['owner-reply','helper-job','helper-worker-error','helper-control-active'])if(faultAt(surface,data.phase,data.layer)){
    const eligible=surface==='helper-job'?source?.name==='frame-slicer-owner':source?.name!=='frame-slicer-owner';
    if(eligible){inject(surface,surface==='owner-reply'||surface==='helper-job'?this.peer:source);return;}
   }
   if(config.holdReply&&data.phase==='prepared'&&data.layer===2&&!triggered){triggered=true;held.push(deliver);config.onHeld?.({updates:()=>structuredClone(updates),cancel:()=>controller.abort(),release:deliver,settled:()=>settled});if(config.replyDelayMS)testTimers.push(setTimeout(deliver,config.replyDelayMS));return;}
   if(data.phase==='prepared'&&mode==='cancel-reply'&&!triggered){triggered=true;held.push(deliver);aborted=true;controller.abort();return;}
   // Exercise out-of-order completion across admitted helpers.
   defer(deliver,data.layer===2&&data.phase==='prepared'?8:0);
 }}
 class Channel{constructor(){this.port1=new Port();this.port2=new Port();this.port1.peer=this.port2;this.port2.peer=this.port1;}}
 class WorkerMock{addEventListener(type,fn){this.listeners||=new Map();if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}dispatchEvent(event){for(const fn of this.listeners?.get(event.type)||[])fn(event);if(event.type==='messageerror'&&config.nativeWorkerMessageErrorIDL!==false)this.onmessageerror?.(event);return true;}constructor(url,{name}){this.name=name;this.terminated=false;this.intervals=new Set();workers.push(this);let offset=0;const isOwner=name==='frame-slicer-owner';
   const c={console:{log(){},debug(){},warn(){},error(){}},structuredClone,setTimeout,clearTimeout,navigator:{appName:'Netscape',userAgent:'Chrome',hardwareConcurrency:16},performance:{timeOrigin:performance.timeOrigin,now:()=>config.virtualTime?offset:performance.now()+offset},setInterval:(fn,ms)=>{const t=setInterval(fn,ms);this.intervals.add(t);return t;},clearInterval:t=>{clearInterval(t);this.intervals.delete(t);},postMessage:data=>{if(isOwner&&data.type==='sliceStatus'&&config.throwInitialStatus)throw Error('synthetic-initial-status-send-failure');if(isOwner&&data.type==='sliceStatus')emittedStatuses.push(structuredClone(data));defer(()=>{if(this.terminated)return;this.onmessage?.({data:structuredClone(data)});});}};c.self=c;vm.createContext(c);vm.runInContext(urls.get(url),c,{timeout:1500});this.c=c;
   vm.runInContext('globalThis.__qaPacketEstimate=(value)=>{if(typeof frameSlicerPerformanceActive==="undefined")return frameLayerPacketBytes(value);const prior=frameSlicerPerformanceActive;frameSlicerPerformanceActive=null;try{return frameLayerPacketBytes(value);}finally{frameSlicerPerformanceActive=prior;}};',c);
   const section=c.frameSectionLayer;c.frameSectionLayer=function(...a){if(isOwner)sectionEntries.push({layer:a[3],status:structuredClone(emittedStatuses.at(-1)||null)});const q=section(...a);if(isOwner)offset+=config.sectionDuration||0;if(a[3]>=2&&retentionMB)q.sourceSnapshot.qaSyntheticRetentionPadding=new Uint8Array(retentionMB*1024**2);return q;};
   if(isOwner){const prepare=c.FrameSingleSlicer.prepare;c.FrameSingleSlicer.prepare=function(...a){const q=prepare(...a);offset+=config.prepareOffset||0;if(config.forceSourceLimit&&q.angleWarnings?.limitSourceSnapshot){const limit=q.angleWarnings.limitSourceSnapshot;q.angleWarnings.limitSourceSnapshot=bytes=>limit(Math.min(bytes,config.forceSourceLimit));}if(retentionMB||config.forceSectionOwner)q.triangles.chunks[0].groups.length=5000000;return q;};const inset=c.FrameSingleSlicer.insetGroups;c.FrameSingleSlicer.insetGroups=function(...a){const q=inset(...a);offset+=config.insetOffset||5;return q;};}
   else if(mode==='helper-error')c.FrameSingleSlicer.calculateInsetMaterial=()=>{throw Object.assign(Error('synthetic-helper-inset-failure'),{code:'FRAME_SYNTHETIC_HELPER_ERROR'});};
   config.workerHook?.(c,isOwner);
 }
 terminate(){this.terminated=true;for(const t of this.intervals)clearInterval(t);this.intervals.clear();cleanupFault('worker');}
 postMessage(data){if(this.terminated)return;
   if(data.type==='layerStart'||data.type==='outlineStart'){data.port.worker=this;data.port.peer.worker=workers.find(q=>q.name==='frame-slicer-owner');}
   if(data.meshes&&config.outlines){delete data.pipeline.finalizers;data.pipeline.outlines=config.outlines;}
   if(faultAt('worker-global',data.type||'initial-input')&&(!config.fault.role||(config.fault.role==='owner')===(this.name==='frame-slicer-owner'))){inject('worker-global',this.c.self);return;}
   if(data.meshes&&faultAt('owner-control')){inject('owner-control',this);return;}
   if(data.meshes&&faultAt('owner-worker-error')){inject('owner-worker-error',this);return;}
   if((data.type==='layerStart'||data.type==='outlineStart')&&faultAt('helper-control-startup')){inject('helper-control-startup',this);return;}
   defer(()=>{if(this.terminated)return;Promise.resolve(this.c.self.onmessage({data})).catch(e=>this.onerror?.({message:e.message}));});
 }}
 const budget={count:config.finalizers===0?1:3,interactiveLimit:3,acquire:async(kind,signal)=>{
   if(signal.aborted)throw Object.assign(Error('synthetic acquire cancelled'),{code:'FRAME_SLICE_CANCELLED'});
   const pendingStartup=(mode==='cancel-pending-grant'||config.fault?.surface==='pending-grant')&&workers.filter(q=>q.name!=='frame-slicer-owner').length===2;
   const pendingActive=config.fault?.surface==='pending-active-grant'&&workers.length===3&&jobs.some(q=>q.phase==='geometry');
   if((pendingStartup||pendingActive)&&workers.some(q=>q.name==='frame-slicer-owner')&&!triggered){triggered=true;return new Promise((resolve,reject)=>{const row={resolve,reject};pendingAcquires.push(row);signal.addEventListener('abort',()=>{queuedCancelled++;pendingAcquires.splice(pendingAcquires.indexOf(row),1);reject(Object.assign(Error('synthetic grant cancelled'),{code:'FRAME_SLICE_CANCELLED'}));},{once:true});if(config.fault?.surface?.startsWith('pending-'))inject(config.fault.surface,workers[0]);});}
   active++;peak=Math.max(peak,active);let live=true;return()=>{if(live){live=false;active--;releaseCount++;cleanupFault('lease');}};
 }};
 const c={performance,console,AbortController,Blob:BlobMock,URL:{createObjectURL:b=>{urls.set('qa-worker',b.source);return'qa-worker';},revokeObjectURL:()=>{revoked++;urls.clear();cleanupFault('url');}},Worker:WorkerMock,MessageChannel:Channel,navigator:{deviceMemory:32},queueMicrotask};c.globalThis=c;vm.createContext(c);
 const moduleSource=printerSource.replace('import * as THREE2 from "three";','const THREE2={BufferAttribute:class{}};').replace('export function createFramePrinterModule','function createFramePrinterModule');vm.runInContext(moduleSource,c,{timeout:1000});
 const api=c.createFramePrinterModule({frameComputeBudget:budget});let result;
 const promise=api.frameSlicerTask(workerSource,config.meshes||[coupon()],config.params||params,controller.signal,data=>{updates.push(structuredClone(data));config.onUpdate?.(data);if(settled)ownerDeliveriesAfterFinish++;},owner=>{if(owner===null)cleanupFault('owner-callback');}).then(stats=>result={stats},e=>result={error:e.message,code:e.code}).finally(()=>settled=true);
 if(mode==='cancel-pending-grant'){for(let i=0;i<150&&!triggered;i++)await Promise.resolve();assert(triggered,'pending acquisition was not reached');aborted=true;controller.abort();}
 const hardCap=setTimeout(()=>controller.abort(),config.hardCapMS||1500);await promise;clearTimeout(hardCap);for(const timer of testTimers)clearTimeout(timer);
 for(const fn of held)fn();for(let i=0;i<30;i++)await Promise.resolve();
 if(config.lateCallbacks)for(const q of workers){q.onmessage?.({data:{type:'complete',stats:{late:true}}});q.dispatchEvent({type:'messageerror'});q.onerror?.({message:'late error'});}
 const geometry=updates.filter(q=>q.type!=='sliceStatus').map(q=>({layers:q.layers,referenceDefs:q.referenceDefs,angleValuesList:q.angleValuesList})),nonzeroAngles=geometry.flatMap(q=>q.angleValuesList||[]).reduce((n,q)=>n+Array.from(q.angleValues).filter(v=>v>0).length,0);
 const summary={mode,retentionMB,result,geometrySHA256:hash(geometry),nonzeroAngles,workers:workers.length,active,peak,releaseCount,revoked,ports:ports.length,closedPorts:ports.filter(q=>q.closed).length,terminatedWorkers:workers.filter(q=>q.terminated).length,liveIntervals:workers.reduce((n,q)=>n+q.intervals.size,0),pendingAcquires:pendingAcquires.length,helperFaultDelivered,aborted,ownerDeliveriesAfterFinish,prepareJobs:jobs.filter(q=>q.phase==='prepare').length,maxProtocolBytes:Math.max(0,...jobs.map(q=>q.bytes)),geometryReferencePackets:geometry.filter(q=>q.referenceDefs?.length).length,statusPackets:updates.filter(q=>q.type==='sliceStatus').length};
 return{...summary,updates,sectionEntries,faultInjected,queuedCancelled,externalSignalAborted:controller.signal.aborted};
}

module.exports={run,coupon,params,workerOriginal,printerOriginal};
