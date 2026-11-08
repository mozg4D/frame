// One contiguous edit envelope. Conservative: overlapping envelopes conflict.
const splitPair=(s,i)=>i>0&&i<s.length&&/[\uD800-\uDBFF]/.test(s[i-1])&&/[\uDC00-\uDFFF]/.test(s[i]);
export function edit(base,text){let start=0,end=base.length,tail=text.length;while(start<end&&start<tail&&base[start]===text[start])start++;while(end>start&&tail>start&&base[end-1]===text[tail-1]){end--;tail--;}if(splitPair(base,start)||splitPair(text,start))start--;if(splitPair(base,end))end++;if(splitPair(text,tail))tail++;return {start,end,text:text.slice(start,tail)};}
// Insertions at a boundary have right affinity. Positions inside a replacement
// move to its end; the left edge of a nonempty replacement stays at its start.
export function selectionAfter(base,text,start,end,direction='none'){
 const e=edit(base,text),delta=e.text.length-(e.end-e.start),map=p=>p<e.start?p:p>=e.end?p+delta:p===e.start?e.start:e.start+e.text.length;
 let a=Math.max(0,Math.min(text.length,map(start))),b=Math.max(0,Math.min(text.length,map(end)));
 if(start===end){if(splitPair(text,a))a++;b=a;}else{if(splitPair(text,a))a--;if(splitPair(text,b))b++;}
 return {start:a,end:b,direction};
}
export function presentation(s){return {disabled:!s.editable&&!s.text&&!s.pending&&!s.dirty&&!s.fault,readOnly:!!s.fault,message:s.fault||''};}

export function rebase(base,local,remote){
 if(local===base)return remote;if(remote===base||local===remote)return local;
 const a=edit(base,local),b=edit(base,remote);
 // Same-position insertions and touching edit boundaries are intentionally ambiguous.
 if(a.end<b.start)return remote.slice(0,a.start)+a.text+remote.slice(a.end);
 if(b.end<a.start){const shift=b.text.length-(b.end-b.start),start=a.start+shift,end=a.end+shift;return remote.slice(0,start)+a.text+remote.slice(end);}
 throw Error('Concurrent changes overlap. Your draft is retained; copy it before reopening.');
}
const epoch=s=>s.version.slice(0,s.version.lastIndexOf(':'));
const newer=(a,b)=>epoch(a)!==epoch(b)||Number(a.version.split(':').at(-1))>Number(b.version.split(':').at(-1));
// A single bounded, plain-text sessionStorage record. The body is not JSON
// escaped, so every valid 1 Mi UTF-16 document has the same storage bound.
export const draftLimit=1048576;
export function rescueRecord({text,version},token,{start,end,direction}){
 if(typeof text!=='string'||text.length>draftLimit)throw Error('Draft exceeds recovery limit');
 const header=JSON.stringify({format:1,token,version,start,end,direction});
 if(header.length>2048)throw Error('Invalid recovery metadata');
 return header+'\n'+text;
}
export function readRescue(raw,token){
 if(raw===null)return null;
 if(typeof raw!=='string'||raw.length>draftLimit+2049)throw Error('Invalid recovery record');
 const split=raw.indexOf('\n');if(split<0||split>2048)throw Error('Invalid recovery header');
 const h=JSON.parse(raw.slice(0,split)),text=raw.slice(split+1);
 if(h.format!==1||typeof h.token!=='string'||typeof h.version!=='string'||h.version.length>256||!h.version.includes(':')||text.length>draftLimit||!Number.isSafeInteger(h.start)||!Number.isSafeInteger(h.end)||h.start<0||h.end<h.start||h.end>text.length||!['none','forward','backward'].includes(h.direction))throw Error('Invalid recovery draft');
 return h.token===token?{text,version:h.version,start:h.start,end:h.end,direction:h.direction}:null;
}
export function session({send,changed}){
 let base=null,draft='',pending=null,latest=null,heldReply=null,fault='',next=0,editable=false,held=false;
 const emit=()=>changed({text:draft,editable,version:base?.version,pending:!!pending,dirty:!!base&&draft!==base.text,fault});
 // Capture is deliberately separate from submission. Even the final IME input
 // after a terminal fault belongs to this local draft, never to a newer scene.
 const capture=text=>{if(!editable||!base||text===draft)return false;draft=text;return true;};
 const fail=message=>{fault||=message;pending=null;latest=null;heldReply=null;};
 function integrate(s){if(!base){base=s;draft=s.text;editable=true;return;}if(epoch(s)!==epoch(base)){if(pending||draft!==base.text)throw Error('Scene changed. Your previous-scene draft is retained; copy it before reopening.');base=s;draft=s.text;editable=true;return;}if(!newer(s,base))return;draft=rebase(base.text,draft,s.text);base=s;editable||=!!s.text;}
 function pump(){if(fault||held||pending||!base||draft===base.text)return;pending={id:++next,text:draft,base};try{send({kind:'write',id:pending.id,text:draft,version:base.version});}catch{fail('Main scene connection failed. Draft retained here; copy it before closing.');}}
 function applyLatest(){if(latest){const s=latest;latest=null;integrate(s);}}
 function reply(m){const p=pending;pending=null;heldReply=null;try{if(m.ok){const s=m.state;if(epoch(s)!==epoch(p.base))throw Error('Scene changed while saving; draft retained.');draft=draft===p.text?s.text:rebase(p.text,draft,s.text);base=s;}else if(m.code!=='CONFLICT')throw Error((m.error||'Save failed')+' Draft retained here; copy it before reopening.');applyLatest();if(!m.ok&&base.version===p.base.version)throw Error(m.error||'Save conflict; draft retained.');pump();}catch(e){fail(e.message);}}
 return {
  capture(text){if(capture(text))emit();},
  input(text){capture(text);pump();emit();},
  hold(){held=true;},
  resume(text){capture(text);held=false;if(!fault)try{if(heldReply)reply(heldReply);else if(!pending){applyLatest();pump();}}catch(e){fail(e.message);}emit();},
  snapshot(s){if(fault)return;if(held&&base&&epoch(s)!==epoch(base)){fail('Scene changed during composition. Your previous-scene draft is retained; copy it before reopening.');emit();return;}if(held||pending){if(!latest||newer(s,latest))latest=s;emit();return;}try{integrate(s);pump();}catch(e){fail(e.message);}emit();},
  reply(m){if(fault||!pending||m.id!==pending.id)return;if(held&&(m.ok||m.code==='CONFLICT'))heldReply=m;else reply(m);emit();},
  stop(message){if(fault)return;fail(message);emit();},
  disconnect(){if(fault)return;fail('Main scene connection closed. Draft retained here; copy it before closing.');emit();},
  restore(s){if(base)return;base={text:'',version:s.version};draft=s.text;editable=true;fail('Recovered draft after reload; recovery may be incomplete. Copy it before reopening Docs; it has not been sent to the scene.');emit();},
  get state(){return {base,draft,pending,fault};}
 };
}
