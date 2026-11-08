import {session,edit,selectionAfter,presentation,rescueRecord,readRescue} from './documentation-sync.mjs';
import {installDocumentationGeometry} from './documentation-geometry.mjs';
const area=document.querySelector('textarea'),status=document.querySelector('output'),token=location.hash.slice(1),rescueKey='frame-docs-draft-v1';
let port=null,composing=false,finishing=false,finishTimer=null,lastState=null,recoveryWarning='',operationWarning='',seal=null;
const selection=()=>({start:area.selectionStart,end:area.selectionEnd,direction:area.selectionDirection});
function persist(s){
 if(!s)return;
 if(s.version){const unsafe=s.pending||s.dirty||s.fault||composing||finishing;try{if(unsafe)window.sessionStorage.setItem(rescueKey,rescueRecord(s,token,selection()));else window.sessionStorage.removeItem(rescueKey);recoveryWarning='';}catch{recoveryWarning=unsafe?'Reload recovery unavailable. Keep this window open and copy the draft before closing.':'';}}
 status.dataset.error=String(!!(s.fault||recoveryWarning));status.textContent=[s.fault,recoveryWarning].filter(Boolean).join(' ')||operationWarning||(seal?'File operation in progress. Editing is temporarily paused.':'');status.hidden=!status.textContent;
}
function paint(s){
 lastState=s;
 // Do not change the DOM or selection under an active native composition.
 // Terminal faults are visible immediately, but readOnly waits for its end.
 if(!composing&&!finishing&&!seal?.acknowledged){if(area.value!==s.text){const change=edit(area.value,s.text),nextSelection=selectionAfter(area.value,s.text,area.selectionStart,area.selectionEnd,area.selectionDirection);area.setRangeText(change.text,change.start,change.end,'preserve');area.setSelectionRange(nextSelection.start,nextSelection.end,nextSelection.direction);}const ui=presentation(s);area.disabled=ui.disabled;area.readOnly=ui.readOnly||!!seal;}
 persist(s);
 if(seal&&!seal.acknowledged){if(s.fault){port.postMessage({kind:'sealed',id:seal.id,ok:false,error:s.fault});seal=null;}else if(!composing&&!finishing&&!s.pending&&!s.dirty){seal.acknowledged=true;seal.text=area.value;port.postMessage({kind:'sealed',id:seal.id,ok:true,version:s.version});}}
}
const sync=session({send:m=>port.postMessage(m),changed:paint});
function capture(){sync.capture(area.value);}
function disconnect(){capture();sync.disconnect();}
function invalidateSeal(){if(!seal?.acknowledged||area.value===seal.text)return;capture();sync.stop('These later edits have not been sent to the scene. Your draft is retained; copy it before reopening.');port.postMessage({kind:'seal-invalid',id:seal.id,error:lastState.fault});}
function receive(m){
 invalidateSeal();capture();
 if(m?.kind==='seal'&&Number.isSafeInteger(m.id)){
  const blocked=seal||composing||finishing||lastState?.fault||!lastState?.version||m.mode==='replace'&&(lastState.pending||lastState.dirty);
  if(blocked){operationWarning='Finish the Docs edit, then retry this file operation. Your draft is retained.';persist(lastState);port.postMessage({kind:'sealed',id:m.id,ok:false,error:lastState?.fault||operationWarning});return;}
  operationWarning='';seal={id:m.id,acknowledged:false,snapshot:null};area.readOnly=true;sync.input(area.value);return;
 }
 if(m?.kind==='release'&&seal?.id===m.id){const snapshot=seal.snapshot;seal=null;operationWarning=typeof m.error==='string'?m.error:'';if(snapshot)sync.snapshot(snapshot);paint(lastState);return;}
 if(m?.kind==='snapshot'){if(seal?.acknowledged)seal.snapshot=m.state;else sync.snapshot(m.state);}
 else if(m?.kind==='reply')sync.reply(m);else if(m?.kind==='closed')disconnect();
}
window.addEventListener('message',event=>{if(port||event.source!==opener||event.origin!==location.origin||event.data?.kind!=='frame-docs-connect'||event.data.token!==token||event.ports.length!==1)return;port=event.ports[0];port.onmessage=event=>receive(event.data);port.onmessageerror=disconnect;});
function finishComposition(){finishTimer=null;if(!finishing)return;capture();finishing=false;sync.resume(area.value);}
function scheduleFinish(){if(finishTimer!==null)clearTimeout(finishTimer);finishTimer=setTimeout(finishComposition,0);}
area.addEventListener('input',()=>{if(seal?.acknowledged){invalidateSeal();return;}if(composing||finishing){capture();if(finishing)scheduleFinish();}else sync.input(area.value);});
area.addEventListener('compositionstart',()=>{if(finishTimer!==null)clearTimeout(finishTimer);finishTimer=null;finishing=false;composing=true;sync.hold();capture();if(seal){port.postMessage({kind:'seal-invalid',id:seal.id,error:'Composition started during a file operation; draft retained.'});sync.stop('Composition started during a file operation. These later edits have not been sent to the scene. Draft retained; copy it before reopening.');}});
// Native engines differ in whether the final input precedes compositionend.
// Hold remote integration through this event turn, including its final input.
area.addEventListener('compositionend',()=>{capture();composing=false;finishing=true;scheduleFinish();});
area.addEventListener('blur',()=>{capture();if(lastState)paint(lastState);});
area.addEventListener('select',()=>persist(lastState));
window.addEventListener('beforeunload',e=>{capture();persist(lastState);if(lastState?.pending||lastState?.dirty||lastState?.fault||composing||finishing){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{capture();persist(lastState);if(finishTimer!==null)clearTimeout(finishTimer);finishTimer=null;port?.close();});
try{const recovered=readRescue(window.sessionStorage.getItem(rescueKey),token);if(recovered){sync.restore(recovered);area.setSelectionRange(recovered.start,recovered.end,recovered.direction);persist(lastState);}}catch{recoveryWarning='Reload recovery unavailable. Keep this window open and copy any unsaved draft before closing.';status.hidden=false;status.textContent=recoveryWarning;}
if(opener&&token){installDocumentationGeometry();opener.postMessage({kind:'frame-docs-ready',token},location.origin);}else if(!lastState){status.hidden=false;status.textContent='Open documentation from the scene’s Docs button.';}
setInterval(()=>{if(port&&(!opener||opener.closed))disconnect();},1000);
