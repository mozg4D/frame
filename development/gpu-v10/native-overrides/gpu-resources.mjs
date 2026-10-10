import {mutableGpuUsage} from './gpu-mutable-storage.mjs';
/** One device and immutable upload pool shared by native display, picking and compute. */
export class GpuBufferPool {
  constructor(device) { this.device=device;this.entries=new Map();this.bytes=0;this.disposed=false; }
  borrow(data,usage,label='Frame shared buffer',minBytes=4) {
    if(this.disposed)throw Error('GPU pool disposed');
    if(!ArrayBuffer.isView(data)||data instanceof DataView)throw Error('Typed source view required');
    usage=mutableGpuUsage(data,usage);
    const size=Math.max(minBytes,4,Math.ceil(data.byteLength/4)*4);
    if(size>this.device.limits.maxBufferSize || ((usage&GPUBufferUsage.STORAGE)&&size>this.device.limits.maxStorageBufferBindingSize))throw Error(`${label}: buffer limit; explicit batching required`);
    let variants=this.entries.get(data);if(!variants){variants=new Map();this.entries.set(data,variants);}
    const key=`${usage}:${size}`;let row=variants.get(key);
    if(row){row.refs++;return row;}
    let buffer;
    try {buffer=this.device.createBuffer({label,size,usage,mappedAtCreation:true});new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();}
    catch(e){buffer?.destroy();if(!variants.size)this.entries.delete(data);throw e;}
    row={pool:this,buffer,data,usage,size,key,refs:1,freed:false};variants.set(key,row);this.bytes+=size;return row;
  }
  release(row) {
    if(!row||row.pool!==this||row.freed)return;
    if(--row.refs>0)return;
    row.freed=true;row.buffer.destroy();this.bytes-=row.size;
    const variants=this.entries.get(row.data);variants?.delete(row.key);if(!variants?.size)this.entries.delete(row.data);
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const variants of this.entries.values())for(const row of variants.values()){row.freed=true;row.buffer.destroy();}this.entries.clear();this.bytes=0;}
}
export class FrameGpuDevice {
  static async request({gpu=globalThis.navigator?.gpu,powerPreference='high-performance',requiredFeatures=[],requiredLimits={}}={}) {
    if(!gpu)throw Error('WebGPU is required. No WebGL fallback.');
    const adapter=await gpu.requestAdapter({powerPreference});if(!adapter)throw Error('No WebGPU adapter available');
    for(const f of requiredFeatures)if(!adapter.features.has(f))throw Error('Missing WebGPU feature: '+f);
    const device=await adapter.requestDevice({requiredFeatures,requiredLimits});
    const owner=new FrameGpuDevice(device,{ownsDevice:true});owner.adapter=adapter;return owner;
  }
  constructor(device,{ownsDevice=false}={}){
    if(!device?.queue)throw Error('Shared GPUDevice required');
    this.device=device;this.ownsDevice=ownsDevice;this.pool=new GpuBufferPool(device);this.state='ready';this.listeners=new Set();
    device.lost.then(info=>{if(this.state==='disposed')return;this.state='lost';this.loss=info;try{for(const f of this.listeners){try{f(info);}catch(error){console.error('Frame GPU loss listener',error);}}}finally{this.pool.dispose();}});
  }
  onLoss(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  dispose(){if(this.state==='disposed')return;this.state='disposed';this.pool.dispose();this.listeners.clear();if(this.ownsDevice)this.device.destroy();}
}
/**
 * One encoded frame at a time. New requests replace the pending state; no backlog of
 * historical camera positions. Waiting on the GPU is asynchronous, never inside a menu.
 */
export class LatestFrameQueue {
  constructor(device,{encode,onError=()=>{},maxInFlight=1}){if(maxInFlight!==1&&maxInFlight!==2)throw Error('Explicit one/two-frame queue bound required');this.device=device;this.encode=encode;this.onError=onError;this.maxInFlight=maxInFlight;this.inFlight=new Set();this.idleWaiters=[];this.pending=null;this.running=false;this.disposed=false;this.serial=0;}
  request(state){
    if(this.disposed)return Promise.resolve({status:'disposed'});
    if(this.pending)this.pending.resolve({status:'superseded'});
    const promise=new Promise((resolve,reject)=>{this.pending={state,resolve,reject,id:++this.serial};});
    this._kick();return promise;
  }
  _kick(){if(!this.running&&this.pending&&!this.disposed&&this.inFlight.size<this.maxInFlight){this.draining=this._drain();this.draining.catch(()=>{});}}
  _settleIdle(){if(!this.running&&!this.pending&&!this.inFlight.size)for(const resolve of this.idleWaiters.splice(0))resolve();}
  _error(error,job){job.reject(error);try{this.onError(error);}catch(notificationError){console.error('Frame render error listener',notificationError);}}
  async _drain(){
    if(this.running)return;this.running=true;
    try{while(this.pending&&!this.disposed&&this.inFlight.size<this.maxInFlight){const job=this.pending;this.pending=null;
      try{const frame=await this.encode(job.state);if(this.disposed){await frame?.release?.({submitted:false});job.resolve({status:'disposed'});continue;}
        // encode returns complete command buffers; snapshots remain owned until queue completion.
        let submitted=false;
        try{frame.assertCurrent?.();this.device.queue.submit(frame.commands);submitted=true;}catch(error){await frame.release?.({submitted});throw error;}
        // Submission order remains serial. Only retirement is asynchronous, with
        // a strict bound and immutable snapshots/resources retained by each frame.
        let completion;completion=(async()=>{try{try{await this.device.queue.onSubmittedWorkDone();}finally{await frame.release?.({submitted:true});}job.resolve({status:this.disposed?'disposed':'presentable',id:job.id});}catch(error){this._error(error,job);}finally{this.inFlight.delete(completion);this._kick();this._settleIdle();}})();this.inFlight.add(completion);
      }catch(error){this._error(error,job);}
    }}finally{this.running=false;this._kick();this._settleIdle();}
  }
  idle(){if(!this.running&&!this.pending&&!this.inFlight.size)return Promise.resolve();return new Promise(resolve=>this.idleWaiters.push(resolve));}
  dispose(){this.disposed=true;if(this.pending)this.pending.resolve({status:'disposed'});this.pending=null;this._settleIdle();}
}
