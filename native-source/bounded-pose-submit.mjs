// One native pose/readback in flight, one latest pending request. No queued
// pose allocates native buffers. A cancelled owner cannot schedule a restore
// after a newer gesture has taken ownership.
export class BoundedPoseSubmit{
 constructor({submit,onSubmitted=()=>{},onResult=()=>{},onError=()=>{},isCurrent=()=>true}){if(typeof submit!=='function')throw new TypeError('Native pose submit required');Object.assign(this,{submit,onSubmitted,onResult,onError,isCurrent});this.inFlight=null;this.latest=null;this.serial=0;this.closed=false;this.stats={submitted:0,coalesced:0,maxOutstanding:0};}
 request(payload,current=()=>true){if(this.closed||!this.isCurrent()||!current())return false;const row={payload,current,serial:++this.serial};if(this.latest)this.stats.coalesced++;this.latest=row;this._pump();return true;}
 _pump(){if(this.closed||this.inFlight||!this.latest)return;const row=this.latest;this.latest=null;if(!this.isCurrent()||!row.current())return;
  this.inFlight=row;let promise;try{promise=this.submit(row.payload,()=>!this.closed&&this.isCurrent()&&row.current());this.stats.submitted++;this.stats.maxOutstanding=1;this.onSubmitted(row);}catch(error){this.inFlight=null;this.onError(error,row);this._pump();return;}
  row.promise=Promise.resolve(promise).then(result=>{if(!this.closed&&this.isCurrent()&&row.current()&&row.serial===this.serial)this.onResult(result,row);},error=>{if(!this.closed&&this.isCurrent()&&row.current())this.onError(error,row);}).finally(()=>{if(this.inFlight===row)this.inFlight=null;this._pump();});row.promise.catch(()=>{});
 }
 close(){this.closed=true;this.serial++;this.latest=null;}
 whenIdle(){const row=this.inFlight;return row?.promise?row.promise.then(()=>this.whenIdle()):Promise.resolve();}
}
