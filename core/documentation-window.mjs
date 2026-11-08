export function installDocumentationWindow({button,write,read,events=window,host=window,timeout=5000}){
 let child=null,port=null,token=null,seal=null,next=0;
 const error=message=>Object.assign(Error(message),{code:'DOCS_PENDING'});
 const send=(active,m)=>active.postMessage(m);
 const abort=message=>{if(!seal)return;const current=seal;seal=null;clearTimeout(current.timer);current.close();try{send(current.port,{kind:'release',id:current.id,error:message});}catch{}current.reject(error(message));};
 const refresh=()=>{const state=read();button.hidden=!state.text;port?.postMessage({kind:'snapshot',state});};
 const ready=event=>{if(!child||event.source!==child||event.origin!==location.origin||event.data?.kind!=='frame-docs-ready'||event.data.token!==token)return;abort('Docs reconnected. Retry the file operation after checking the draft.');port?.close();const channel=new MessageChannel();port=channel.port1;const active=port;let busy=false;
 active.onmessage=async event=>{if(active!==port)return;const m=event.data;
  if(m?.kind==='sealed'&&seal&&seal.port===active&&m.id===seal.id){const current=seal;
   if(!m.ok){abort(m.error||'Finish the Docs edit before this file operation.');return;}
   const state=read();if(typeof m.version!=='string'||m.version!==state.version||m.version.split(':').slice(0,-1).join(':')!==current.epoch){abort('Docs changed while preparing the file operation. Retry after checking the draft.');return;}
   // Close admission in this message turn, before resolving/awaiting anything.
   current.close();clearTimeout(current.timer);current.version=m.version;current.acknowledged=true;
   current.resolve({verify(){if(current.invalid||seal!==current||port!==active||child.closed||read().version!==current.version)throw error(current.invalid||'Docs changed before the file operation. Retry after checking the draft.');},release(reason){if(seal===current)seal=null;try{send(active,{kind:'release',id:current.id,...reason?{error:'File operation failed: '+reason+'. Retry after checking the draft.'}:{}});}catch{}}});return;
  }
  if(m?.kind==='seal-invalid'&&seal&&seal.port===active&&m.id===seal.id){seal.invalid=m.error||'Docs input changed while the file operation was sealed.';if(!seal.acknowledged)abort(seal.invalid);return;}
  if(m?.kind!=='write'||!Number.isSafeInteger(m.id)||typeof m.text!=='string'||typeof m.version!=='string')return;
  if(busy){send(active,{kind:'reply',id:m.id,ok:false,error:'A documentation write is already pending'});return;}busy=true;
  try{const state=await write({text:m.text,version:m.version},()=>{if(port!==active||child.closed)throw error('Docs connection changed. Draft retained.');});send(active,{kind:'reply',id:m.id,ok:true,state});}
  catch(e){send(active,{kind:'snapshot',state:read()});send(active,{kind:'reply',id:m.id,ok:false,code:e.code,error:e.message});}finally{busy=false;}
 };
 active.onmessageerror=()=>{if(active===port)abort('Docs connection failed. Keep the draft open and retry.');};
 child.postMessage({kind:'frame-docs-connect',token},location.origin,[channel.port2]);refresh();};
 button.onclick=()=>{if(child&&!child.closed){child.focus();return;}token=crypto.randomUUID();child=host.open(new URL('../documentation.html#'+token,import.meta.url),'frame-docs-'+token,'popup,width=760,height=700');if(!child)host.alert('Allow this documentation window to open, then click Docs again.');};
 events.addEventListener('frame-documentation-change',refresh);host.addEventListener('message',ready);host.addEventListener('pagehide',()=>{abort('Main scene connection closed.');port?.postMessage({kind:'closed'});port?.close();});refresh();
 return {seal({mode,epoch,close}){
  if(!child||child.closed){close();return Promise.resolve(null);}
  if(!port)return Promise.reject(error('Docs is still connecting. Retry the file operation when the editor is ready.'));
  if(seal)return Promise.reject(error('Another Docs file operation is still pending.'));
  return new Promise((resolve,reject)=>{const current=seal={id:++next,port,epoch,close,resolve,reject};current.timer=setTimeout(()=>abort('Docs did not finish in time. Keep the draft open and retry the file operation.'),timeout);try{send(port,{kind:'seal',id:current.id,mode});}catch{abort('Docs connection failed. Keep the draft open and retry.');}});
 }};
}
