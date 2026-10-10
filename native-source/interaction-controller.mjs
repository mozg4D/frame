/** Frame GPU interaction contracts: latest-only marquee and topology-only double click. */
import {topologyStamp, captureTopology, connectedMaskWork, drainCooperatively} from './topology-islands.mjs';
import {createYieldQueue} from './connected-selection.mjs';
const abort = message => new DOMException(message, 'AbortError');
/** No worker/CPU packing is started until request() or an explicit background warm(). */
export class LatestSelection {
  constructor({run, prepareCommit = async x => x, commit, onError = () => {}}) {
    if (typeof run !== 'function' || typeof commit !== 'function') throw Error('Selection run/commit callbacks required');
    Object.assign(this, {run, prepareCommit, commit, onError}); this.serial = 0; this.active = null; this.pending = null; this.disposed = false;
  }
  request(intent) {
    if (this.disposed) return Promise.reject(abort('Selection controller disposed'));
    this.active?.controller.abort();
    if (this.pending) this.pending.reject(abort('Superseded selection intent'));
    const id = ++this.serial;
    const promise = new Promise((resolve, reject) => { this.pending = {id, intent, resolve, reject}; });
    if (!this.active) this._next();
    return promise;
  }
  async _next() {
    const item = this.pending; if (!item || this.disposed) return; this.pending = null;
    const controller = new AbortController(), job = {...item, controller}; this.active = job;
    const current = () => !this.disposed && this.serial === job.id && !controller.signal.aborted && (job.intent.isCurrent?.() ?? true);
    try {
      const value = await this.run(job.intent, {signal: controller.signal, isCurrent: current});
      if (!current()) throw abort('Selection changed during GPU work');
      const ready = await this.prepareCommit(value, {signal: controller.signal, isCurrent: current});
      if (!current()) throw abort('Selection changed before atomic commit');
      this.commit(ready, job.intent); job.resolve(ready);
    } catch (e) { job.reject(e); if (e.name !== 'AbortError') this.onError(e); }
    finally { if (this.active === job) this.active = null; if (!this.disposed) this._next(); }
  }
  cancel() { this.serial++; this.active?.controller.abort(); if (this.pending) this.pending.reject(abort('Selection cancelled')); this.pending = null; }
  dispose() { this.disposed = true; this.cancel(); }
}
/** CSS client coordinates -> physical view pixels; reject points outside the actual view. */
export function physicalRectangle(rectangle, canvasRect, physicalSize, viewport) {
  if (!rectangle || rectangle.length !== 4 || ![...rectangle, canvasRect.left, canvasRect.top, canvasRect.width, canvasRect.height, ...physicalSize, ...viewport].every(Number.isFinite)) throw Error('Finite rectangle/canvas/view required');
  if (canvasRect.width <= 0 || canvasRect.height <= 0 || physicalSize.some(n => !Number.isInteger(n) || n < 1)) throw Error('Invalid canvas size');
  const sx = physicalSize[0] / canvasRect.width, sy = physicalSize[1] / canvasRect.height;
  const xs = [(rectangle[0] - canvasRect.left) * sx, (rectangle[2] - canvasRect.left) * sx].sort((a,b) => a-b);
  const ys = [(rectangle[1] - canvasRect.top) * sy, (rectangle[3] - canvasRect.top) * sy].sort((a,b) => a-b);
  const clipped=[Math.max(xs[0], viewport[0]), Math.max(ys[0], viewport[1]), Math.min(xs[1], viewport[0]+viewport[2]), Math.min(ys[1], viewport[1]+viewport[3])];
  return clipped[0]>clipped[2]||clipped[1]>clipped[3]?null:clipped;
}
/**
 * Worker topology cache. At most one build/capture owns a shared compute lease.
 * acquireLease/release are supplied by Frame's existing shared heavy-work scheduler.
 */
export class TopologyCache {
  constructor({workerFactory, acquireLease = async () => ({release(){}}), yieldTask = null, scheduleIdle = fn => setTimeout(fn, 60), cancelIdle = clearTimeout} = {}) {
    if (typeof workerFactory !== 'function') throw Error('A real worker factory is required');
    this.yieldQueue = yieldTask === null ? createYieldQueue() : null;
    yieldTask ??= () => this.yieldQueue.yield();
    Object.assign(this, {workerFactory, acquireLease, yieldTask, scheduleIdle, cancelIdle});
    this.entries = new WeakMap(); this.queue = []; this.active = null; this.disposed = false; this.serial = 0; this.timer = null;
  }
  warm(geometry) { return this.get(geometry, {background: true}); }
  get(geometry, {background = false} = {}) {
    if (this.disposed) return Promise.reject(abort('Topology cache disposed'));
    const old = this.entries.get(geometry);
    if (old?.stamp.isCurrent()) {
      if (!background && old.state === 'queued') { this.queue = this.queue.filter(q => q !== old); this.queue.unshift(old); this._startNow(); }
      return old.promise;
    }
    if (old) { old.controller.abort(); if (old.state === 'queued') old.reject(abort('Topology source replaced')); }
    const stamp = topologyStamp(geometry), id = ++this.serial, entry = {id, geometry, stamp, state:'queued', controller:new AbortController()};
    entry.promise = new Promise((resolve,reject) => Object.assign(entry,{resolve,reject}));
    if(background)entry.promise.catch(e=>{entry.lastError=e;});
    this.entries.set(geometry, entry); background ? this.queue.push(entry) : this.queue.unshift(entry);
    if (background) { if (!this.active && this.timer === null) this.timer = this.scheduleIdle(() => { this.timer=null; this._pump(); }); }
    else this._startNow();
    return entry.promise;
  }
  _startNow() { if (this.timer !== null) this.cancelIdle(this.timer); this.timer = null; this._pump(); }
  async _pump() {
    if (this.active || this.disposed) return;
    let job; while ((job=this.queue.shift()) && (job.controller.signal.aborted || !job.stamp.isCurrent())) { job.state='cancelled';job.reject(abort('Stale queued topology')); }
    if (!job) return;
    this.active=job; job.state='building'; let lease,worker;
    const current=()=>!this.disposed&&!job.controller.signal.aborted&&job.stamp.isCurrent();
    try {
      lease=await this.acquireLease({kind:'topology',priority:'background',signal:job.controller.signal});
      if (!current()) throw abort('Topology stale before capture');
      const snapshot=await captureTopology(job.geometry,{signal:job.controller.signal,yieldTask:this.yieldTask});
      if (!current()) throw abort('Topology stale before worker');
      worker=this.workerFactory(); job.worker=worker;
      const result=await new Promise((resolve,reject)=>{
        let settled=false;
        const finish=(fn,value)=>{if(settled)return;settled=true;job.controller.signal.removeEventListener('abort',onAbort);fn(value);};
        const onAbort=()=>{try{worker.postMessage({type:'cancel',id:job.id});}catch{}finally{finish(reject,abort('Topology build cancelled'));}};
        worker.onmessage=({data:m})=>{if(m.id!==job.id)return;if(m.type==='built')finish(resolve,m.result);else if(['error','cancelled'].includes(m.type))finish(reject,Object.assign(Error(m.message),{name:m.name??(m.type==='cancelled'?'AbortError':'Error')}));};
        worker.onerror=e=>finish(reject,Error(e.message??'Topology worker failed'));
        job.controller.signal.addEventListener('abort',onAbort,{once:true});
        if(!current()){onAbort();return;} worker.postMessage({type:'build',id:job.id,key:job.id,input:snapshot.input},snapshot.transfer);
      });
      if (!current()) throw abort('Topology changed before cache install');
      job.state='ready';job.value=result;job.resolve({topology:result,isCurrent:job.stamp.isCurrent,geometry:job.geometry});
    } catch(e) { job.state='failed';job.reject(e);if(this.entries.get(job.geometry)===job)this.entries.delete(job.geometry); }
    finally { worker?.terminate();lease?.release();if(this.active===job)this.active=null; if(!this.disposed&&this.queue.length)this.timer=this.scheduleIdle(()=>{this.timer=null;this._pump();}); }
  }
  invalidate(geometry) { const e=this.entries.get(geometry);if(!e)return;e.controller.abort();if(e.state==='queued')e.reject(abort('Topology invalidated'));this.entries.delete(geometry); }
  dispose(){this.disposed=true;if(this.timer!==null)this.cancelIdle(this.timer);this.timer=null;this.active?.controller.abort();for(const e of this.queue){e.controller.abort();e.reject(abort('Topology cache disposed'));}this.queue=[];this.entries=new WeakMap();this.yieldQueue?.dispose();}
}
/** Double-click ONLY; no interception/delay of the editor's existing first click. */
export function bindConnectedDoubleClick(element, {hitTest, expand, onError = () => {}}) {
  if (!element?.addEventListener || typeof hitTest!=='function' || typeof expand!=='function') throw Error('Connected double-click callbacks required');
  let disposed=false,request=0;
  const handler=async e=>{
    if(e.button!==0||e.defaultPrevented)return;const id=++request;
    // Snapshot the clicked view intent before awaiting a hit; scene/source guards belong to the hit.
    const pointer={clientX:e.clientX,clientY:e.clientY,shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey};
    try {const hit=await hitTest(pointer);if(disposed||id!==request||!hit||!['vertex','edge','face'].includes(hit.domain))return;
      if(hit.isCurrent&&!hit.isCurrent())return;
      await expand(hit,{mode:pointer.ctrlKey||pointer.metaKey?'invert':pointer.shiftKey?'add':'replace',ignoreVisibility:true,activeId:hit.id});
    }catch(error){if(error.name!=='AbortError')onError(error);}
  };
  element.addEventListener('dblclick',handler);
  return ()=>{disposed=true;request++;element.removeEventListener('dblclick',handler);};
}
export async function connectedFromCache(cache, geometry, domain, seeds, {signal, yieldTask}={}) {
  const ready=await cache.get(geometry);
  return drainCooperatively(connectedMaskWork(ready.topology,domain,seeds),{signal,isCurrent:ready.isCurrent,yieldTask});
}
