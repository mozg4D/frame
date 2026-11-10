import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export function pointerReturnChecks(source){
 const start=source.indexOf('let framePointerLock=null,framePointerLockBlocked=false'),end=source.indexOf('function bindNumber(input,o){',start);assert.ok(start>=0&&end>start);
 const block=source.slice(start,end),checks=[],timings=[],check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true});};
 function setup({id='frame-engine-canvas',left=0,top=0}={}){
  const handlers=new Map(),windowHandlers=new Map(),events=[],screen={availLeft:left,availTop:top,availWidth:1600,availHeight:900};let requests=0,exits=0,captures=0,held=false;
  const document={defaultView:{screen,innerWidth:1600,innerHeight:900,devicePixelRatio:1},pointerLockElement:null,hidden:false,exitPointerLock(){exits++;this.pointerLockElement=null;}};
  const element={id,ownerDocument:document,dispatchEvent(e){events.push(e);},setPointerCapture(){captures++;held=true;},hasPointerCapture(){return held;},releasePointerCapture(){held=false;},requestPointerLock(){requests++;document.pointerLockElement=element;}};
  const scope={document,PointerEvent:class{constructor(type,init){Object.assign(this,{type,isTrusted:false},init);}},FrameViewWindows:{inputDocument:document,onDocument(type,fn){const h=handlers.get(type)||[];h.push(fn);handlers.set(type,h);},onWindow(type,fn){windowHandlers.set(type,fn);}}};vm.createContext(scope);vm.runInContext(block,scope);
  const fire=(type,extra={})=>{const e={type,isTrusted:true,currentTarget:document,pointerId:7,buttons:1,movementX:0,movementY:0,clientX:1498,clientY:300,screenX:left+1598,screenY:top+400,stopImmediatePropagation(){this.stopped=true;},preventDefault(){},...extra};for(const h of handlers.get(type)||[])h(e);return e;};
  const edge=extra=>{scope.e={isTrusted:true,pointerId:7,buttons:1,clientX:1498,clientY:300,screenX:left+1598,screenY:top+400,...extra};scope.el=element;vm.runInContext('frameEdgePointer(e,el)',scope);};
  const locked=()=>{edge();fire('pointerlockchange');fire('mousemove',{movementX:0,movementY:0});};
  const move=(x,y)=>fire('mousemove',{movementX:x,movementY:y,isTrusted:false});
  const get=()=>vm.runInContext('framePointerLock',scope),count=()=>({requests,exits,captures});
  return {scope,element,document,events,fire,edge,locked,move,get,count,windowHandlers};
 }
 for(const offset of [[0,0],[-1600,-200]]){
  const s=setup({left:offset[0],top:offset[1]});s.locked();s.move(40,-20);
  check('Outside movement keeps native lock '+offset,s.document.pointerLockElement===s.element&&s.get().x===1538&&s.get().y===280);
  s.move(-65,20);check('Screen re-entry immediately requests native unlock '+offset,s.document.pointerLockElement===null&&s.get().returning&&s.count().exits===1);
  const end=s.events.at(-1);check('Last relative movement applies before unlock '+offset,end.clientX===1473&&end.clientY===300);
  s.fire('pointerlockchange');check('Native pointer capture resumes the same held gesture '+offset,s.get().captured&&s.count().captures===1&&!s.events.some(e=>e.type==='pointercancel'));
  s.fire('pointermove');check('Restore-to-edge event does not relock or jump '+offset,s.count().requests===1&&s.get().x===1473&&s.get().y===300);
  s.fire('pointermove',{clientX:1468,clientY:312,screenX:offset[0]+1568,screenY:offset[1]+412});check('Resumed absolute movement retains prior relative displacement '+offset,s.get().x===1443&&s.get().y===312);
  s.fire('pointermove',{clientX:1498,clientY:312,screenX:offset[0]+1598,screenY:offset[1]+412});check('A later screen exit can lock again '+offset,s.count().requests===2&&s.document.pointerLockElement===s.element&&s.get().x===1473);
  s.fire('pointerlockchange');s.fire('mousemove',{movementX:0,movementY:0});s.move(25,0);s.move(-40,0);s.fire('pointerlockchange');check('Repeated exit/re-entry preserves gesture coordinates '+offset,s.get().captured&&s.get().x===1458);
  s.fire('pointerup',{button:0,buttons:0});check('Release dispatches one matching end and clears lock '+offset,s.get()===null&&s.events.filter(e=>e.type==='pointerup').length===1&&s.events.at(-1).clientX===1458);
  s.fire('pointerlockchange');check('Late native unlock notification cannot cancel completed drag '+offset,!s.events.some(e=>e.type==='pointercancel'));
 }
 for(const type of ['pointerup','mouseup','pointercancel']){
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);s.fire(type,{buttons:0});s.fire('pointerlockchange');check('Release during pending native restoration: '+type,s.get()===null&&s.events.filter(e=>e.type===(type==='pointercancel'?'pointercancel':'pointerup')).length===1);
 }
 for(const state of ['locked','returning','captured'])for(const cancel of ['Escape','blur','hidden']){
  const s=setup();s.locked();s.move(40,0);if(state!=='locked'){s.move(-60,0);if(state==='captured')s.fire('pointerlockchange');}
  if(cancel==='Escape')s.fire('keydown',{key:'Escape'});else if(cancel==='blur')s.windowHandlers.get('blur')();else{s.document.hidden=true;s.fire('visibilitychange');}
  check('Cancellation clears '+state+' on '+cancel,s.get()===null&&s.events.filter(e=>e.type==='pointercancel').length===1);
 }
 {
  const s=setup({id:'inpRough'});s.locked();s.move(40,0);s.move(-80,0);check('Numeric scrub remains unlimited when relative travel returns',s.document.pointerLockElement===s.element&&!s.get().returning);s.fire('pointerup',{buttons:0});check('Numeric release still clears lock',s.get()===null);
 }
 {
  const s=setup();s.locked();s.document.pointerLockElement=null;s.fire('pointerlockchange');check('Unexpected native lock loss cancels once',s.get()===null&&s.events.filter(e=>e.type==='pointercancel').length===1);
 }
 {
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);const capture=s.element.setPointerCapture;let attempts=0;s.element.setPointerCapture=()=>{if(!attempts++)throw Error('Inactive pointer');capture();};s.fire('pointerlockchange');check('Temporarily inactive native pointer does not cancel navigation',s.get()?.captured&&!s.events.some(e=>e.type==='pointercancel'));s.fire('pointermove');check('Next native event retries capture without ending navigation',attempts===2&&s.element.hasPointerCapture()&&!s.events.some(e=>e.type==='pointercancel'));s.fire('pointermove',{clientX:1488,screenX:1588});check('Navigation continues after delayed native recapture',s.get().x===1468);
 }
 {
  const s=setup();s.fire('pointerdown');s.edge({buttons:2});s.fire('pointerlockchange');s.fire('mousemove',{movementX:0,movementY:0});s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');s.fire('pointerup',{buttons:0,button:2});check('Right-drag release suppresses context menu outside the canvas',s.fire('contextmenu').stopped);s.fire('pointerdown');check('Next independent context click is not suppressed',!s.fire('contextmenu').stopped);
 }
 {
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');const before=[s.get().x,s.get().y];const other={defaultView:{screen:{availWidth:1000,availHeight:800}},hidden:false};check('Another document cannot change the active pointer coordinates',!s.fire('pointermove',{currentTarget:other,clientX:12,clientY:24}).stopped&&s.get().x===before[0]&&s.get().y===before[1]);s.fire('visibilitychange',{currentTarget:other});check('A visible secondary document does not cancel navigation',!!s.get());other.hidden=true;s.fire('visibilitychange',{currentTarget:other});check('A hidden secondary document cannot cancel active navigation',!!s.get());s.fire('pointerlockchange',{currentTarget:other});check('Another document lock transition does not clear active navigation',!!s.get());
 }
 {
  const s=setup();s.element.requestPointerLock=()=>{throw Error('Denied request');};s.edge();check('Failed initial request leaves ordinary capture untouched',s.get()===null);s.fire('pointerdown');s.element.requestPointerLock=()=>{s.document.pointerLockElement=s.element;};s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');s.fire('pointermove',{clientX:1468,screenX:1568});s.element.requestPointerLock=()=>{throw Error('Denied repeated request');};s.fire('pointermove');check('Failed repeated edge request keeps the resumed gesture',s.get()?.captured);s.fire('pointerup',{buttons:0});check('Release still ends gesture after repeated request failure',s.get()===null);
 }
 {
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');s.fire('pointermove',{clientX:1468,screenX:1568});s.element.requestPointerLock=()=>undefined;s.fire('pointermove');const x=s.get().x;check('Pending repeated lock release uses the existing virtual coordinates',s.fire('pointerup',{buttons:0}).stopped&&s.events.at(-1).type==='pointerup'&&s.events.at(-1).clientX===x&&x!==1498&&s.get()===null);s.document.pointerLockElement=s.element;s.fire('pointerlockchange');check('Late lock acquisition after release is immediately relinquished',!s.document.pointerLockElement);
 }
 {
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');check('Returned gesture owns native capture',s.element.hasPointerCapture());s.fire('keydown',{key:'Escape'});check('Escape releases returned native capture before mouseup',!s.element.hasPointerCapture());
 }

 {
  const s=setup();s.edge();s.fire('pointerlockchange');s.fire('mousemove',{movementX:8,movementY:-4});check('First real native locked movement is not discarded',s.get().x===1506&&s.get().y===296);
 }
 for(const dpr of [1,2]){
  const s=setup();s.document.defaultView.devicePixelRatio=dpr;s.edge();s.fire('pointerlockchange');s.fire('mousemove',{movementX:-698*dpr,movementY:150*dpr});check('Only exact initial viewport recenter is ignored at DPR '+dpr,s.get().x===1498&&s.get().y===300&&s.document.pointerLockElement===s.element);s.fire('mousemove',{movementX:8,movementY:-4});check('Movement immediately after recenter is applied at DPR '+dpr,s.get().x===1506&&s.get().y===296);
 }
 {
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');s.fire('pointermove',{clientX:700,clientY:450,screenX:800,screenY:550});check('Native restore coordinates are rebased without a camera jump',s.get().x===1478&&s.get().y===300);s.fire('pointermove',{clientX:690,clientY:455,screenX:790,screenY:555});check('Motion after a changed native restore position stays continuous',s.get().x===1468&&s.get().y===305);
 }
 {
  const s=setup();s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');s.fire('pointermove',{clientX:700,clientY:450,screenX:800,screenY:550,movementX:-7,movementY:3});check('First post-return nonzero native movement is preserved',s.get().x===1471&&s.get().y===303);
 }
 {
  const s=setup();s.element.requestPointerLock=()=>undefined;s.edge();s.fire('pointermove',{clientX:1490,screenX:1590});check('Pending lock request continues native navigation',s.get().x===1490&&s.events.at(-1).clientX===1490);s.fire('pointerlockerror');check('Legacy pointer-lock rejection clears the pending request',s.get()===null);
 }
 check('No fake DOM cursor remains in navigation implementation',!block.includes('createElementNS')&&!block.includes('frame-navigation-cursor'));
 const s=setup(),begin=performance.now();for(let i=0;i<10000;i++){s.fire('pointerdown');s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerlockchange');s.fire('pointermove');s.fire('pointerup',{buttons:0});}const ms=performance.now()-begin;check('10000 completed cursor-return cycles stay below 2 seconds',ms<2000);timings.push({name:'10000 complete cursor-return cycles',ms,limit:2000});
 return {pass:true,checks,timings};
}
export function pointerReturnNegatives(source){
 const mutations=[['missing early unlock',s=>s.replace('lock.returning=true;document.exitPointerLock();','lock.returning=true;')],['missing native recapture',s=>s.replace('lock.element.setPointerCapture(lock.id);','')],['absolute coordinates overwrite virtual coordinates',s=>s.replace('lock.x+=e.clientX-lock.nativeX;','lock.x=e.clientX;')],['native restoration rebasing removed',s=>s.replace('lock.rebase=true;','')],['first native movement discarded',s=>s.replace('lock.skipRecenter=false;const w=', 'lock.skipRecenter=false;return;const w=')],['unexpected loss ignored',s=>s.replace('else if(lock&&!lock.captured){','else if(false){')]];
 for(const [name,mutate]of mutations){const changed=mutate(source);assert.notEqual(changed,source,name);assert.throws(()=>pointerReturnChecks(changed),undefined,name);}return mutations.map(x=>x[0]);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const source=await readFile(new URL('../index.html',import.meta.url),'utf8');console.log(JSON.stringify({...pointerReturnChecks(source),negativeControls:pointerReturnNegatives(source),indexSHA256:createHash('sha256').update(source).digest('hex')},null,2));}
