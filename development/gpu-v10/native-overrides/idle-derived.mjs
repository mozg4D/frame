/** One worker, latest job per owner, bounded idle capture and atomic publication.
 * Injected scheduleIdle must never use a timeout to bypass the foreground guard.
 */
import {authoringJobTag,authoringTagEqual} from './authoring-mesh.mjs';
export class IdleDerivedCoordinator{
  constructor({workerFactory,scheduleIdle,cancelIdle,isIdle=()=>true,onError=()=>{},onEvent=()=>{},chunkElements=8192}={}){
    if(typeof workerFactory!=='function'||typeof scheduleIdle!=='function'||typeof cancelIdle!=='function'||!Number.isInteger(chunkElements)||chunkElements<1||chunkElements>16384)throw Error('Explicit worker and bounded idle scheduler required');
    Object.assign(this,{workerFactory,scheduleIdle,cancelIdle,isIdle,onError,onEvent,chunkElements});
    this.pending=new Map();this.active=null;this.serial=0;this.timer=null;this.foreground=0;this.disposed=false;
  }
  request(mesh){
    if(this.disposed||!mesh.current())return false;
    const current=this.active?.mesh===mesh?this.active:this.pending.get(mesh);
    if(current&&mesh.matches(current.tag))return true;
    if(this.active?.mesh===mesh)this._cancelActive('source revision changed');
    const row={mesh,tag:authoringJobTag(mesh,++this.serial),phase:'queued',positionOffset:0,indexOffset:0,awaiting:false,result:null};
    this.pending.set(mesh,row);this._schedule();return true;
  }
  enterForeground(){
    this.foreground++;if(this.timer!==null){this.cancelIdle(this.timer);this.timer=null;}
    let live=true;return()=>{if(!live)return;live=false;this.foreground--;this._schedule();};
  }
  notifyIdle(){this._schedule();}
  invalidate(mesh,{requeue=true}={}){
    this.pending.delete(mesh);if(this.active?.mesh===mesh)this._cancelActive('invalidated');
    if(requeue&&mesh.current())this.request(mesh);else this._schedule();
  }
  dispose(){if(this.disposed)return;this.disposed=true;if(this.timer!==null)this.cancelIdle(this.timer);this.timer=null;this.pending.clear();this._cancelActive('disposed');}
  _allowed(mesh=null){return !this.disposed&&!this.foreground&&this.isIdle()&&(!mesh||mesh.current()&&!mesh.operations.size);}
  _schedule(){if(this.disposed||this.timer!==null||!this._allowed()||this.active?.awaiting||!this.active&&!this.pending.size)return;
    this.timer=this.scheduleIdle(deadline=>{this.timer=null;this._turn(deadline);});}
  _cancelActive(reason){const row=this.active;if(!row)return;this.active=null;try{row.worker?.terminate();}finally{this.onEvent({type:'cancelled',tag:row.tag,reason});}}
  _turn(deadline){
    if(!this._allowed())return;
    if(deadline?.timeRemaining&&deadline.timeRemaining()<1){this._schedule();return;}
    if(!this.active){
      for(const [mesh,row]of this.pending){this.pending.delete(mesh);if(!mesh.matches(row.tag))continue;this.active=row;break;}
    }
    const row=this.active;if(!row)return;
    if(!row.mesh.matches(row.tag)){const mesh=row.mesh;this._cancelActive('stale before idle turn');this.request(mesh);return;}
    if(!this._allowed(row.mesh)){this._schedule();return;}
    try{
      if(row.result){
        const installed=row.mesh.installGraph(row.tag,row.result);
        if(!installed){this._schedule();return;}
        this.active=null;row.worker.terminate();this.onEvent({type:'published',tag:row.tag});this._schedule();return;
      }
      if(!row.worker){
        row.worker=this.workerFactory();row.worker.onmessage=({data:m})=>this._message(row,m);
        row.worker.onerror=e=>this._failure(row,Error(e.message??'Idle derived worker failed'));
        row.awaiting=true;row.phase='snapshot';row.worker.postMessage({type:'init',tag:row.tag,precision:row.mesh.positions instanceof Float64Array?'f64':'f32',positionLength:row.mesh.positions.length,indexLength:row.mesh.indices?.length??0});return;
      }
      const mesh=row.mesh;
      if(row.positionOffset<mesh.positions.length||row.indexOffset<(mesh.indices?.length??0)){
        const field=row.positionOffset<mesh.positions.length?'positions':'indices',start=field==='positions'?row.positionOffset:row.indexOffset,total=field==='positions'?mesh.positions.length:mesh.indices.length,chunks=[],began=performance.now();let offset=start;
        do{const end=Math.min(total,offset+this.chunkElements),values=field==='positions'?mesh.captureRange(offset,end-offset):new Uint32Array(mesh.indices.subarray(offset,end));chunks.push(values);offset=end;}while(offset<total&&chunks.length<16&&performance.now()-began<2&&(deadline?.timeRemaining?.()??2)>=1);
        const bytes=chunks.reduce((n,v)=>n+v.byteLength,0);row.expectedCapture={field,offset};row.awaiting=true;row.worker.postMessage({type:'snapshot',tag:row.tag,field,offset:start,chunks},chunks.map(v=>v.buffer));this.onEvent({type:'capture-turn',tag:row.tag,workMs:performance.now()-began,chunks:chunks.length,bytes});return;
      }
      row.phase='build';row.awaiting=true;row.worker.postMessage({type:'step',tag:row.tag,budgetMs:Math.min(2,deadline?.timeRemaining?.()??2)});
    }catch(e){this._failure(row,e);}
  }
  _message(row,m){
    if(this.disposed||this.active!==row||!authoringTagEqual(row.tag,m.tag))return;
    row.awaiting=false;
    if(!row.mesh.matches(row.tag)){const mesh=row.mesh;this._cancelActive('stale worker result');this.request(mesh);return;}
    if(m.type==='error'){this._failure(row,Object.assign(Error(m.message),{name:m.name??'Error'}));return;}
    if(m.type==='captured'){
      const key=m.field==='positions'?'positionOffset':m.field==='indices'?'indexOffset':null;
      const total=m.field==='positions'?row.mesh.positions.length:row.mesh.indices?.length??0;
      if(!key||!row.expectedCapture||row.expectedCapture.field!==m.field||m.offset!==row.expectedCapture.offset||!Number.isInteger(m.offset)||m.offset<=row[key]||m.offset>Math.min(total,row[key]+this.chunkElements*16)){this._failure(row,Error('Invalid worker capture acknowledgment'));return;}
      row[key]=m.offset;row.expectedCapture=null;
    }else if(m.type==='ready')row.result=m.graph;
    else if(!['initialized','progress'].includes(m.type)){this._failure(row,Error('Invalid idle worker response'));return;}
    this.onEvent({type:m.type,tag:row.tag,workMs:m.workMs});this._schedule();
  }
  _failure(row,error){if(this.active!==row)return;this._cancelActive('worker error');this.onError(error,row.tag);this._schedule();}
}
