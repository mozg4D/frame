/** A single readback lane. Hover is replaceable; accepted clicks retain FIFO
 * order and are never canceled by pointer movement. Capture is synchronous. */
const abort=message=>new DOMException(message,'AbortError');
export class NativePickerLane {
 constructor({capture,run}){if(typeof capture!=='function'||typeof run!=='function')throw Error('Picker lane capture/run callbacks required');this.capture=capture;this.run=run;this.clicks=[];this.hover=null;this.active=null;this.closed=false;this.hoverGeneration=0;this.idle=Promise.resolve();}
 request(intent,{kind='hover'}={}){
  if(this.closed)return Promise.reject(abort('Picker lane disposed'));
  if(!['hover','click'].includes(kind))return Promise.reject(Error('Picker request kind required'));
  let captured;try{captured=this.capture(intent);}catch(error){return Promise.reject(error);}if(captured?.then)return Promise.reject(Error('Picker lane capture must be synchronous'));
  const request={intent,captured,kind,controller:new AbortController()};
  const promise=new Promise((resolve,reject)=>Object.assign(request,{resolve,reject}));
  if(kind==='hover'){
   request.generation=++this.hoverGeneration;this.hover?.reject(abort('Pointer intent superseded'));this.hover=request;
   if(this.active?.kind==='hover')this.active.controller.abort();
  }else{
   this.clicks.push(request);this.invalidateHover();
  }
  this._pump();return promise;
 }
 _pump(){
  if(this.active||this.closed)return;const q=this.clicks.shift()??this.hover;if(!q)return;if(q===this.hover)this.hover=null;this.active=q;
  const isCurrent=()=>!this.closed&&!q.controller.signal.aborted&&(q.kind==='click'||q.generation===this.hoverGeneration)&&q.captured.isCurrent();
  this.idle=(async()=>{
   try{if(!isCurrent())throw abort('Picker source changed before preparation');const result=await this.run(q.captured,q.intent,{signal:q.controller.signal,isCurrent});if(!isCurrent())throw abort('Picker source changed before result');q.resolve(result);}
   catch(error){q.reject(error);}
   finally{this.active=null;this._pump();}
  })();
 }
 invalidateHover(){++this.hoverGeneration;this.hover?.reject(abort('Pointer intent invalidated'));this.hover=null;if(this.active?.kind==='hover')this.active.controller.abort();}
 invalidate(){this.invalidateHover();this.active?.controller.abort();for(const q of this.clicks)q.reject(abort('Click intent invalidated'));this.clicks=[];}
 async dispose(){if(this.closed)return;this.closed=true;this.invalidate();await this.idle;}
}
