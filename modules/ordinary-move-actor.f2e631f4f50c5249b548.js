import {OrdinaryMoveDisplayRoot} from "./ordinary-move-display.f8db0a092f53a52ae3d2.js";
import {createYieldQueue} from "./connected-selection.65bdcdb810ce4d9cf77f.js";
import {checkpointFields,checkpointShape} from "./ordinary-move-history.b78f5eaa319c090a5606.js";
import {selectionLengths,selectionChunks} from "./ordinary-move-selection.76a7c0c8f044c78d6ca6.js";
const abort=()=>new DOMException('Ordinary Move owner changed','AbortError');
let ownerSerial=0;
export class OrdinaryMoveActor {
 constructor({native,mesh,device,pool,hooks,WorkerType=Worker,DisplayRootType=OrdinaryMoveDisplayRoot}) {
  Object.assign(this,{native,mesh,device,pool,hooks,DisplayRootType});this.ownerVersion=++ownerSerial;this.version=0;this.renderVersion=0;this.sequence=0;this.closed=false;this.input=null;this.pending=new Map();this.requestSerial=0;this.operations=0;this.jobs=[];this.exact=Promise.resolve();this.displayTail=Promise.resolve();this.tasks=createYieldQueue();
  this.worker=new WorkerType(new URL("./ordinary-move-worker.2f91d2ffa83fd9aac044.js",import.meta.url),{type:'module'});
  const receive=q=>{const row=this.pending.get(q.id);if(!row)return;this.pending.delete(q.id);q.kind==='error'?row.reject(Object.assign(Error(q.error.message),{name:q.error.name})):row.resolve(q.result);};
  if(this.worker.on){this.worker.on('message',receive);this.worker.on('error',e=>this.fail(e));this.worker.on('exit',()=>{if(!this.closed)this.fail(Error('Ordinary Move worker exited'));});}else{this.worker.onmessage=e=>receive(e.data);this.worker.onerror=e=>this.fail(e);}
  this.ready=this.initialize();this.ready.catch(e=>this.fail(e));
 }
 current(){return !this.closed&&this.hooks.current();}
 check(){if(!this.current())throw abort();}
 error(e){if(e.name!=='AbortError')this.hooks.error(e);}
 fail(e){if(this.closed)return this.disposal;this.closed=true;const termination=this.worker?.terminate();for(const r of this.pending.values())r.reject(e);this.pending.clear();const unpublished=this.jobs.filter(j=>!j.published);for(const job of unpublished){job.cancelled=true;job.released=true;job.releaseDisplay?.();}this.input=null;this.displayTail.catch(()=>{});const root=this.root;this.disposal=Promise.allSettled([termination,root?.dispose(),this.ready,this.displayTail,this.exact,this.publicationDone?.promise]).then(()=>{for(const job of unpublished)this.retireJob(job);try{this.hooks.disposed?.();}catch(error){this.error(error);}this.root=this.initialDerived=null;});try{this.hooks.failed?.(unpublished);}catch(error){this.error(error);}for(const job of unpublished){job.reconciled=true;job.reconciliationPending=false;}this.authorCheckpoint=this.packet=null;this.tasks.dispose();this.error(e);this.hooks.render();return this.disposal;}
 request(kind,data={},transfer=[]){this.check();return new Promise((resolve,reject)=>{const id=++this.requestSerial;this.pending.set(id,{resolve,reject});this.worker.postMessage({id,kind,ownerVersion:this.ownerVersion,...data},transfer);});}
 async initialize(){
  await this.hooks.beforeInitialize?.();this.check();
  const g=this.mesh.geometry,p=g.attributes.position.array,n=g.attributes.normal.array,ix=g.index.array;
  await this.request('upload-start',{indexType:ix.constructor.name,lengths:{positions:p.length,normals:n.length,indices:ix.length},groups:g.groups,drawRange:g.drawRange,userData:this.hooks.metadata(g)});
  for(const [field,a]of [['positions',p],['normals',n],['indices',ix]])for(let start=0;start<a.length;start+=65536){
   this.check();const chunk=a.slice(start,start+65536);await this.request('upload-chunk',{field,start,chunk},[chunk.buffer]);await this.tasks.yield();
  }
  await this.request('upload-finish');this.check();const packet=await this.request('capture');this.check();
  this.authorCheckpoint=packet.checkpoint;
  this.initialDerived=packet.derived;
  this.hooks.seed(g,packet.derived);
  this.root=new this.DisplayRootType({native:this.native,mesh:this.mesh,numeric:packet.numeric,device:this.device,pool:this.pool,isCurrent:()=>this.current(),aliases:this.hooks.aliases(g,packet.numeric,packet.derived),primaryElements:packet.derived.pointElements,onRender:()=>this.hooks.render(),yieldTask:()=>this.tasks.yield()});
  await this.root.initialize();this.check();return this;
 }
 async read(selection,context,{connected=false,selectionRevision=0}={}){
  await this.ready;await this.publicationDone?.promise;this.check();const renderVersion=this.renderVersion;
  const selectionToken=await this.uploadSelection(selection,renderVersion);let q;
  try{q=await this.request('prepare-read',{selectionToken,context,connected,selectionRevision,renderVersion});}finally{await this.dropSelection(selectionToken);}
  if(q.renderVersion!==this.renderVersion||q.ownerVersion!==this.ownerVersion)throw abort();return q;
 }
 async dropSelection(selectionToken){if(selectionToken!==undefined&&this.current())await this.request('selection-cancel',{selectionToken}).catch(()=>{});}
 async uploadSelection(selection,renderVersion=this.renderVersion){
  const selectionToken=this.selectionSerial=(this.selectionSerial||0)+1;
  try{await this.request('selection-start',{selectionToken,renderVersion,lengths:selectionLengths(selection)});
   for(const chunk of selectionChunks(selection)){this.check();if(renderVersion!==this.renderVersion)throw abort();await this.request('selection-chunk',{selectionToken,renderVersion,...chunk},[chunk.chunk.buffer]);await this.tasks.yield();}
   await this.request('selection-finish',{selectionToken,renderVersion});return selectionToken;
  }catch(e){if(this.current())await this.request('selection-cancel',{selectionToken}).catch(()=>{});throw e;}
 }
 releaseRead(q){if(q.uiReleased)return Promise.resolve();q.uiReleased=true;return this.releaseClaim(q);}
 async releaseClaim(q){try{await this.request('descriptor-release',{token:q.token});}catch(e){if(e.name!=='AbortError')this.error(e);}}
 start(prepared,context){
  this.check();if(this.input||this.historyBusy)throw abort();this.sequence++;
  const job={actor:this,prepared:null,context,revision:0,delta:context.identity.slice(),local:context.identity.slice(),released:false,cancelled:false,accepted:false,displayDone:false,authoringDone:false,hasAuthoring:false};
  let release;job.releaseSignal=new Promise(r=>release=r);job.releaseDisplay=release;
  const previousDisplay=this.displayTail;
  this.jobs.push(job);
  job.claim=Promise.resolve(prepared).then(async descriptor=>{this.check();if(job.cancelled)throw abort();await this.request('descriptor-claim',{token:descriptor.token});job.descriptor=descriptor;});job.claim.catch(()=>{});
  this.input=job;job.display=(async()=>{
   await previousDisplay;
   await this.publicationDone?.promise;await this.ready;this.check();await job.claim;const descriptor=job.descriptor;if(job.cancelled)throw abort();
   const preview=await this.request('preview-begin',{token:descriptor.token,renderVersion:descriptor.renderVersion});job.preview=preview.preview;
   job.row=await this.root.begin({rawIDs:descriptor.rawIDs,rawMask:descriptor.rawMask,world:context.world,inverse:context.inverse});
   if(job.cancelled){await this.root.cancelFrom(job.row);throw abort();}
   this.poseDisplay(job);
  })();job.display.catch(e=>this.error(e));
  this.displayTail=job.display.then(async()=>{const row=job.row;await job.releaseSignal;if(job.cancelled)await this.cancelDisplay(job);else{this.root.release(row);await row.scheduler.whenIdle();}},async()=>{if(job.cancelled)await this.cancelDisplay(job);}).finally(async()=>{if(job.cancelled)await this.releaseJobClaim(job);job.displayDone=true;if(job.cancelled&&!job.reconciliationPending&&!job.reconciled)this.reconcileCancelled(job,[job]);this.retireJob(job);});return job;
 }
 pose(job,delta,local){if(this.input!==job||job.cancelled||!this.current())return false;job.delta=Array.from(delta);job.local=Array.from(local);job.revision++;if(job.row)this.poseDisplay(job);return true;}
 poseDisplay(job){
  if(job.cancelled||!job.row)return;
  this.root.pose(job.row,job.delta,job.local);
  this.request('preview-pose',{preview:job.preview,delta:job.delta}).catch(e=>this.error(e));
  this.hooks.pose(job);
 }
 finish(job,{cancel=false}={}){
  if(this.input!==job)return false;this.input=null;job.released=true;job.cancelled=cancel;job.hasAuthoring=!cancel;job.releaseDisplay();this.sequence++;
  job.presentationReady=this.displayTail;
  if(cancel){job.completion=this.displayTail;return true;}
  this.operations++;
  const execute=async()=>{
   await job.display;this.check();if(job.cancelled)return;
   this.root.release(job.row);
   const descriptor=job.descriptor;
   const begin=await this.request('begin-descriptor',{token:descriptor.token,preview:job.preview,renderVersion:descriptor.renderVersion,selectionRevision:descriptor.selectionRevision??0,baseVersion:this.version});job.begin=begin;
   if(job.cancelled){await this.request('cancel',begin);return;}
   const packet=await this.request('compute',{...begin,revision:job.revision,delta:job.delta});
   if(job.cancelled){await this.request('cancel',begin);return;}
   const {token,gesture,revision,baseVersion,ownerVersion}=packet;
   const before=this.authorCheckpoint,accepted=await this.request('accept',{token,gesture,revision,baseVersion,ownerVersion,...(packet.checkpoint?{retainHistory:false}:{})});this.version=accepted.version;this.packet=packet;job.accepted=true;job.token=token;job.operationID=`${this.ownerVersion}:${token}`;if(packet.checkpoint){job.checkpoints={before,after:packet.checkpoint};this.authorCheckpoint=packet.checkpoint;}this.hooks.command(job);
  };
  const displayTail=this.displayTail;
  job.completion=this.exact.then(()=>displayTail).then(execute).catch(async e=>{if(job.accepted){this.fail(e);return;}const chain=this.cancelDependents(job);try{if(job.begin&&this.current())await this.request('cancel',job.begin).catch(error=>this.fail(error));await this.cancelDisplay(job).catch(()=>{});this.reconcileCancelled(job,chain);}finally{for(const child of chain){child.reconciliationPending=false;this.retireJob(child);}}this.error(e);}).finally(async()=>{this.operations--;await this.releaseJobClaim(job);job.authoringDone=true;this.retireJob(job);this.tryPublish();});
  this.exact=job.completion;return true;
 }
 async cancelDisplay(job){
  if(job.cleanup)return job.cleanup;
  job.cleanup=(async()=>{
  if(job.row&&this.root.rows.includes(job.row))await this.root.cancelFrom(job.row);
  if(job.preview!==undefined)await this.request('preview-cancel',{preview:job.preview});
  })();return job.cleanup;
 }
 cancelDependents(job){const index=this.jobs.indexOf(job),chain=(index<0?[job]:this.jobs.slice(index)).filter(child=>!child.accepted);for(const child of chain){child.reconciliationPending=true;child.cancelled=true;child.released=true;child.releaseDisplay?.();if(this.input===child)this.input=null;}return chain;}
 reconcileCancelled(job,chain){try{this.hooks.cancelled?.(job,chain);}finally{for(const child of chain){child.reconciled=true;child.reconciliationPending=false;this.retireJob(child);}}}
 releaseJobClaim(job){if(job.claimReleased)return Promise.resolve();if(job.claimRelease)return job.claimRelease;job.claimRelease=Promise.resolve(job.claim).catch(()=>{}).then(async()=>{if(job.descriptor)await this.releaseClaim(job.descriptor);job.claimReleased=true;});return job.claimRelease;}
 retireJob(job){
  if(job.displayDone&&(!job.hasAuthoring||job.authoringDone)&&job.claimReleased)job.prepared=job.claim=job.descriptor=null;
  if(job.retired||!job.displayDone||job.hasAuthoring&&!job.authoringDone||job.reconciliationPending||!job.published&&!job.cancelled)return false;
  job.retired=true;this.hooks.retired?.(job);for(const key of ['actor','prepared','claim','descriptor','row','display','uiSession','releaseSignal','releaseDisplay','cleanup','claimRelease'])job[key]=null;
  if(job.context)delete job.context.selection;if(job.cancelled){job.context=job.delta=job.local=null;job.checkpoints=null;}const index=this.jobs.indexOf(job);if(index>=0)this.jobs.splice(index,1);return true;
 }
 async checkpointHistory(job,direction){
  const expected=direction==='undo'?job.checkpoints.after:job.checkpoints.before,target=direction==='undo'?job.checkpoints.before:job.checkpoints.after,operationID=job.operationID;
  try{
   await this.request('checkpoint-start',{baseVersion:this.version,operationID,direction,expected:checkpointShape(expected),target:checkpointShape(target)});
   for(const [role,q]of [['expected',expected],['target',target]])for(const field of checkpointFields)for(let start=0;start<q[field].length;start+=65536){this.check();const chunk=q[field].slice(start,start+65536);await this.request('checkpoint-chunk',{baseVersion:this.version,operationID,role,field,start,chunk},[chunk.buffer]);await this.tasks.yield();}
   return await this.request('checkpoint-finish',{baseVersion:this.version,operationID});
  }catch(e){if(this.current())await this.request('checkpoint-cancel',{operationID}).catch(()=>{});throw e;}
 }
 async history(job,direction,{isCurrent=()=>true}={}){
  this.check();this.sequence++;if(this.input||this.historyBusy)throw abort();this.historyBusy=true;
  try {
  await this.exact;this.check();
  if(!job.accepted)throw Error('Move computation failed before history was accepted');
  await this.publicationDone?.promise;
  if(this.packet&&!await this.tryPublish({force:true}))throw Error('Move exact revision could not publish before history');
  const selection=await this.hooks.copySelection(this.hooks.selection());
  if(!isCurrent())throw abort();
  const result=job.checkpoints?await this.checkpointHistory(job,direction):await this.request('history-prepare',{direction,baseVersion:this.version,selection,renderSelection:true,operationToken:job.token});
  if(!result)throw Error('Owned Move history entry missing');
  const previousPacket=this.packet;this.packet=result;
  if(!await this.tryPublish({history:{job,direction,token:result.token,baseVersion:this.version,isCurrent},force:true})){
   this.packet=previousPacket;await this.request('history-cancel',{token:result.token});throw Error('Move history publication was superseded');
  }
  if(job.checkpoints)this.authorCheckpoint=direction==='undo'?job.checkpoints.before:job.checkpoints.after;
  await this.hooks.refresh();
  } finally {this.historyBusy=false;}
 }
 async tryPublish({history=null,force=false}={}){
  if(!this.packet||this.input||this.operations||this.selectionOperations||(this.historyBusy&&!history&&!force)||this.publishing||!this.current())return false;
  const sequence=this.sequence,packet=this.packet,oldRoot=this.root,stamp=this.hooks.selectionStamp();
  const valid=()=>this.current()&&this.sequence===sequence&&this.packet===packet&&!this.input&&!this.operations&&!this.selectionOperations&&(!history||history.isCurrent());
  this.publishing=true;let staged,installed=false,resolvePublication,transaction,read,selectionToken,acknowledged=false;
  this.publicationDone={promise:new Promise(r=>resolvePublication=r)};
  try{
   const selection=await this.hooks.copySelection(this.hooks.selection());this.check();
   selectionToken=await this.uploadSelection(selection);if(!valid())throw abort();
   read=await this.request('publish-read',{baseVersion:this.version,historyToken:history?.token,selectionToken,renderVersion:this.renderVersion,context:this.hooks.context(history)});if(!valid())throw abort();
   await this.hooks.stageEntry?.(read,valid);if(!valid())throw abort();
   if(this.hooks.selectionCurrent(stamp))try{await this.hooks.stageSelection(read,()=>valid()&&this.hooks.selectionCurrent(stamp));}catch(e){if(e.name!=='AbortError')throw e;}
   const geometry=this.hooks.geometry(packet.geometry,packet.derived),proxy={geometry};
   const links=this.hooks.links?.(geometry,packet.numeric,packet.derived);
   staged=new this.DisplayRootType({native:this.native,mesh:proxy,numeric:packet.numeric,device:this.device,pool:this.pool,isCurrent:()=>installed?this.current():valid(),aliases:links?.aliases??this.hooks.aliases(geometry,packet.numeric,packet.derived),primaryElements:packet.derived.pointElements,onRender:()=>this.hooks.render(),yieldTask:()=>this.tasks.yield()});
   await staged.initialize();if(!valid())throw abort();
   transaction=this.hooks.prepareInstall(geometry,read,{stamp,links,history,present:()=>this.hooks.selectionCurrent(stamp)});
   transaction.commit();staged.mesh=this.mesh;installed=true;
   const accepted=history?await this.request('history-accept',{token:history.token,baseVersion:history.baseVersion}):await this.request('ack-render',{baseVersion:this.version});
   acknowledged=true;
   this.version=accepted.version;this.root=staged;staged=null;this.initialDerived=packet.derived;this.renderVersion=this.version;this.packet=null;
   try{transaction.finish();}catch(e){this.error(e);}for(const job of this.jobs.slice())if(job.accepted&&!job.cancelled){job.published=true;this.retireJob(job);}
   await oldRoot.dispose().catch(e=>this.error(e));try{this.hooks.published?.();}catch(e){this.error(e);}this.hooks.render();return true;
  }catch(e){if(acknowledged){this.error(e);return true;}transaction?.rollback();if(this.closed)this.hooks.rollbackClosed?.(this.jobs);await staged?.dispose();this.hooks.releaseSelection?.(read);this.error(e);return false;}
  finally{await this.dropSelection(selectionToken);this.publishing=false;resolvePublication();this.publicationDone=null;}
 }
 async dispose(){return this.fail(abort());}
}
