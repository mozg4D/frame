import {edit} from './documentation-sync.mjs';
const selection=(s,text)=>({start:Math.max(0,Math.min(text.length,s.start)),end:Math.max(0,Math.min(text.length,s.end)),direction:s.direction||'none'});
const same=(a,b)=>a.start===b.start&&a.end===b.end&&a.direction===b.direction;
// Detach patch payloads: a small slice must not retain an old megabyte document.
const detach=text=>JSON.parse(JSON.stringify(text));
const delta=(before,after)=>{const e=edit(before,after);return {start:e.start,before:detach(before.slice(e.start,e.end)),after:detach(e.text)};};
const replace=(text,e,undo)=>{const from=undo?e.after:e.before,to=undo?e.before:e.after;if(text.slice(e.start,e.start+from.length)!==from)throw Error('History no longer matches');return text.slice(0,e.start)+to+text.slice(e.start+from.length);};
// Map two disjoint edits without walking/copying every historical document.
// Each entry is transformed in O(1); the remote text is diffed just once.
function commute(a,b){
 const ae=a.start+a.before.length,be=b.start+b.before.length,ad=a.after.length-a.before.length,bd=b.after.length-b.before.length;
 if(a.start===ae&&b.start===be&&a.start===b.start)throw Error('Ambiguous history insertion');
 if(ae<=b.start)return {local:a,remote:{...b,start:b.start+ad}};
 if(be<=a.start)return {local:{...a,start:a.start+bd},remote:b};
 throw Error('Remote change overlaps history');
}
function moveSelection(s,e,length){
 const end=e.start+e.before.length,d=e.after.length-e.before.length,map=p=>p<e.start?p:p>=end?p+d:p===e.start?e.start:e.start+e.after.length;
 return selection({start:map(s.start),end:map(s.end),direction:s.direction},{length});
}
// Local-only patch history. External changes transform disjoint entries; an
// overlapping historical entry and its older dependencies are dropped rather
// than reverting someone else's text. No scene history or storage is involved.
export function history({limit=128,maxCharacters=4*1048576}={}){
 let current='',undo=[],redo=[],group=null;
 const trim=()=>{while(undo.length+redo.length>limit||[...undo,...redo].reduce((n,e)=>n+e.before.length+e.after.length,0)>maxCharacters){if(undo.length)undo.shift();else redo.shift();}if(group&&!undo.includes(group))group=null;};
 const entry=(before,after,a,b)=>({...delta(before,after),selectionBefore:selection(a,before),selectionAfter:selection(b,after)});
 function transform(stack,from,to,backwards){
  const out=[];let remote=delta(from,to),length=from.length;
  for(let i=stack.length-1;i>=0;i--){const e=stack[i];try{
   const local={start:e.start,before:backwards?e.after:e.before,after:backwards?e.before:e.after};
   const mapped=commute(local,remote),newLength=length+remote.after.length-remote.before.length,nextLength=length+local.after.length-local.before.length;
   const a=moveSelection(e.selectionBefore,backwards?mapped.remote:remote,backwards?nextLength+mapped.remote.after.length-mapped.remote.before.length:newLength);
   const b=moveSelection(e.selectionAfter,backwards?remote:mapped.remote,backwards?newLength:nextLength+mapped.remote.after.length-mapped.remote.before.length);
   out.push({...e,start:mapped.local.start,selectionBefore:a,selectionAfter:b});length=nextLength;remote=mapped.remote;
  }catch{break;}}
  return out.reverse();
 }
 return {
  reset(text){current=text;undo=[];redo=[];group=null;},
  remote(text){if(text===current)return;undo=transform(undo,current,text,true);redo=transform(redo,current,text,false);current=text;group=null;trim();},
  breakGroup(){group=null;},
  record(before,after,a,b,type='',time=performance.now()){
   if(before!==current)this.remote(before);
   if(before===after)return;
   const e=entry(before,after,a,b);let merge=false;
   if(group&&group.type===type&&time-group.time<=1000&&same(group.selectionAfter,e.selectionBefore)){
    if(type==='insertText'&&!group.before&&!e.before&&group.start+group.after.length===e.start&&!/\s/u.test(group.after+e.after)){group.after+=e.after;merge=true;}
    else if(type==='deleteContentBackward'&&!group.after&&!e.after&&e.start+e.before.length===group.start){group.before=e.before+group.before;group.start=e.start;merge=true;}
    else if(type==='deleteContentForward'&&!group.after&&!e.after&&e.start===group.start){group.before+=e.before;merge=true;}
   }
   if(merge){group.selectionAfter=e.selectionAfter;group.time=time;}else{group={...e,type,time};undo.push(group);}
   redo=[];current=after;trim();
  },
  step(backwards=true){
   group=null;const from=backwards?undo:redo,to=backwards?redo:undo,e=from.pop();if(!e)return null;
   try{current=replace(current,e,backwards);to.push(e);return {text:current,selection:backwards?e.selectionBefore:e.selectionAfter};}
   catch{from.length=0;return null;}
  },
  get state(){return {text:current,undo:undo.length,redo:redo.length,characters:[...undo,...redo].reduce((n,e)=>n+e.before.length+e.after.length,0)};}
 };
}
