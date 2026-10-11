'use strict';
// Telemetry plus explicit transport-fault settlement.
// No production timeout, geometry edits, extra worker pool, or editor edits.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),root=__dirname;
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Unique transport anchor required: '+a.slice(0,100));return s.replace(a,b);}
function build(worker,printer,{telemetry=true}={}){
 // This also enforces the exact baseline hashes for the independent transport candidate.
 const progress=require('./build-progress-only.cjs').build(worker,printer);let w=telemetry?progress.worker:worker,p=telemetry?progress.printer:printer;
 const start=p.indexOf('function frameSlicerTask('),end=p.indexOf('\nasync function framePrinterSlice(',start);if(start<0||end<0)throw Error('Task boundary missing');let task=p.slice(start,end);
 task=replace(task,'const workers=[],ports=[],leases=new Map(),readyWaiters=new Set();','const taskController=new AbortController(),taskSignal=taskController.signal;\n    const workers=[],ports=[],leases=new Map(),readyWaiters=new Set();');
 task=replace(task,"const finish=(error,stats)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);for(const w of workers)w.terminate();for(const port of ports)port.close();if(url)URL.revokeObjectURL(url);for(const fail of readyWaiters)fail(error||Object.assign(Error('Slicing cancelled.'),{code:'FRAME_SLICE_CANCELLED'}));readyWaiters.clear();for(const release of leases.values())release();leases.clear();ownerLease?.();onOwner(null);error?reject(error):resolve(stats);};",`const finish=(error,stats)=>{
      if(finished)return;finished=true;let outcome=error;
      const cleanup=fn=>{try{fn();}catch(e){outcome||=e;}};
      cleanup(()=>signal.removeEventListener('abort',abort));
      // Cancel this task's queued shared-budget requests on every terminal outcome.
      cleanup(()=>taskController.abort());
      for(const w of workers)cleanup(()=>w.terminate());
      for(const port of ports)cleanup(()=>port.close());
      if(url)cleanup(()=>URL.revokeObjectURL(url));
      for(const fail of readyWaiters)cleanup(()=>fail(outcome||Object.assign(Error('Slicing cancelled.'),{code:'FRAME_SLICE_CANCELLED'})));readyWaiters.clear();
      for(const release of leases.values())cleanup(release);leases.clear();
      if(ownerLease){cleanup(ownerLease);ownerLease=null;}
      cleanup(()=>onOwner(null));outcome?reject(outcome):resolve(stats);
    };`);
 const acquire="host.frameComputeBudget.acquire('slicer',signal)";if(task.split(acquire).length!==4)throw Error('Exactly three shared-budget acquire sites required');task=task.replaceAll(acquire,"host.frameComputeBudget.acquire('slicer',taskSignal)");
 task=replace(task,"const token='startup-'+i;","const token='startup-'+kind+'-'+i;");
 task=replace(task,"child.onerror=e=>{fail(Error(e.message||'Outline worker failed.'));finish(Error(e.message||'Outline worker failed.'));};child.onmessage=({data})=>{if(finished)return;", "child.onerror=e=>finish(Object.assign(Error(e.message||'Slicer helper failed.'),{code:'FRAME_SLICE_WORKER_ERROR'}));child.onmessageerror=()=>finish(Object.assign(Error('Slicer helper control message could not be decoded.'),{code:'FRAME_SLICE_MESSAGE_ERROR'}));child.onmessage=({data})=>{if(finished)return;if(data.type==='error'){finish(Object.assign(Error(data.message||'Slicer helper failed.'),{code:data.code||'FRAME_SLICE_FAILED'}));return;}");
 task=replace(task,"owner.onerror=e=>finish(Error(e.message||'Slicer worker failed.'));", "owner.onerror=e=>finish(Object.assign(Error(e.message||'Slicer worker failed.'),{code:'FRAME_SLICE_WORKER_ERROR'}));\n      owner.onmessageerror=()=>finish(Object.assign(Error('Slicer owner control message could not be decoded.'),{code:'FRAME_SLICE_MESSAGE_ERROR'}));");
 p=p.slice(0,start)+task+p.slice(end);
 w=replace(w,"for(const slot of slots){slot.port.onmessage=({data})=>{self.postMessage({type:'outlineRelease'", "for(const slot of slots){slot.port.onmessageerror=()=>fail(Object.assign(Error('Outline reply could not be decoded.'),{code:'FRAME_SLICE_MESSAGE_ERROR'}));slot.port.onmessage=({data})=>{self.postMessage({type:'outlineRelease'");
 w=replace(w,"for(const slot of slots){slot.port.onmessage=({data})=>{try{if(data.phase!=='prepared-part')", "for(const slot of slots){slot.port.onmessageerror=()=>fail(Object.assign(Error('Layer reply could not be decoded.'),{code:'FRAME_SLICE_MESSAGE_ERROR'}));slot.port.onmessage=({data})=>{try{if(data.phase!=='prepared-part')");
 w=replace(w,"if(!port||typeof port.postMessage!=='function')throw Error('Missing layer finalizer port.');", "if(!port||typeof port.postMessage!=='function')throw Error('Missing layer finalizer port.');\n    port.onmessageerror=()=>{if(closed)return;closed=true;try{port.close();}finally{self.postMessage({type:'error',runId,message:'Layer job could not be decoded.',code:'FRAME_SLICE_MESSAGE_ERROR'});}};");
 w=replace(w,"if(data.type==='outlineStart'){const port=data.port;let description=null,layer=null;port.onmessage=({data:job})=>{try{", "if(data.type==='outlineStart'){const port=data.port;let description=null,layer=null,closed=false;port.onmessageerror=()=>{if(closed)return;closed=true;try{port.close();}finally{self.postMessage({type:'error',runId:data.runId,message:'Outline job could not be decoded.',code:'FRAME_SLICE_MESSAGE_ERROR'});}};port.onmessage=({data:job})=>{if(closed)return;try{");
 return{worker:w,printer:p};
}
module.exports={build};
