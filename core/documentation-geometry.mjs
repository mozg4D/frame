// Window preferences only. No document text, scene state or display permission.
const key='frame-docs-window-v1';
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const clamp=(n,min,max)=>Math.max(min,Math.min(n,max));
function workArea(screen){
 if(!screen||!finite(screen.availWidth,100,32768)||!finite(screen.availHeight,100,32768))return null;
 return {left:finite(screen.availLeft,-1000000,1000000)?Math.round(screen.availLeft):0,top:finite(screen.availTop,-1000000,1000000)?Math.round(screen.availTop):0,width:Math.round(screen.availWidth),height:Math.round(screen.availHeight)};
}
function valid(g){return g&&finite(g.left,-1000000,1000000)&&finite(g.top,-1000000,1000000)&&finite(g.width,100,32768)&&finite(g.height,100,32768)&&finite(g.outerWidth,100,32768)&&finite(g.outerHeight,100,32768);}
function restoredBounds(host){
 let saved;try{saved=JSON.parse(host.localStorage.getItem(key));}catch{}
 if(!valid(saved))return null;
 const current=workArea(host.screen);
 // Keep known extended-display coordinates, but restore an unavailable display
 // onto the current one. Native window.open also clamps impossible placement.
 const previous=workArea(saved.screen&&{availLeft:saved.screen.left,availTop:saved.screen.top,availWidth:saved.screen.width,availHeight:saved.screen.height});
 const area=current&&(!previous||host.screen?.isExtended!==true||current.left===previous.left&&current.top===previous.top)?current:previous;
 const outerWidth=Math.round(Math.min(saved.outerWidth,area?.width||32768)),outerHeight=Math.round(Math.min(saved.outerHeight,area?.height||32768));
 const width=Math.max(100,outerWidth-Math.max(0,saved.outerWidth-saved.width)),height=Math.max(100,outerHeight-Math.max(0,saved.outerHeight-saved.height));
 const left=Math.round(area?clamp(saved.left,area.left,area.left+Math.max(0,area.width-outerWidth)):saved.left),top=Math.round(area?clamp(saved.top,area.top,area.top+Math.max(0,area.height-outerHeight)):saved.top);
 return {width,height,left,top,outerWidth,outerHeight};
}
export function documentationWindowFeatures(host=window){
 const g=restoredBounds(host);if(g)return `popup,width=${g.width},height=${g.height},left=${g.left},top=${g.top}`;
 const area=workArea(host.screen),width=Math.min(760,area?.width||760),height=Math.min(700,Math.max(100,(area?.height||780)-80));
 return `popup,width=${width},height=${height}`;
}
export function installDocumentationGeometry(host=window){
 let last='';
 // Correct feature-size rounding once using saved outer bounds. Outer size
 // also remains meaningful when browser zoom makes innerWidth > outerWidth.
 // Window features may ignore coordinates even with permission; move once too.
 // Never move/resize the opener or keep forcing bounds after the user moves it.
 try{const g=restoredBounds(host);if(g){host.resizeTo(g.outerWidth,g.outerHeight);host.moveTo?.(g.left,g.top);}}catch{}
 const save=()=>{
  try{
   const g={left:host.screenX,top:host.screenY,width:host.innerWidth,height:host.innerHeight,outerWidth:host.outerWidth,outerHeight:host.outerHeight,screen:workArea(host.screen)};
   if(!valid(g))return;
   for(const k of ['left','top','width','height','outerWidth','outerHeight'])g[k]=Math.round(g[k]);
   const value=JSON.stringify(g);if(value===last)return;
   host.localStorage.setItem(key,value);last=value;
  }catch{} // Blocked/quota-limited preferences must not affect draft safety.
 };
 // Browsers expose resize, but no cross-browser window-move event.
 const timer=host.setInterval(save,1000);
 for(const name of ['resize','blur','beforeunload'])host.addEventListener(name,save);
 host.addEventListener('pagehide',()=>{save();host.clearInterval(timer);});
 save();
}
