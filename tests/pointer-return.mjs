import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export function pointerReturnChecks(source){
 const start=source.indexOf('let framePointerLock=null,framePointerLockBlocked=false'),end=source.indexOf('function bindNumber(input,o){',start);assert.ok(start>=0&&end>start);
 const block=source.slice(start,end),checks=[],timings=[],check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true});};
 function setup({id='frame-engine-canvas',left=0,top=0,width=1600,height=900,dpr=1,nativeX=1498,nativeY=300,screenX=left+1598,screenY=top+400}={}){
  const handlers=new Map(),windowHandlers=new Map(),events=[],screen={availLeft:left,availTop:top,availWidth:width,availHeight:height};let requests=0,exits=0,held=true;
  const document={defaultView:{screen,innerWidth:width,innerHeight:height,devicePixelRatio:dpr},pointerLockElement:null,hidden:false,exitPointerLock(){exits++;this.pointerLockElement=null;}};
  const element={id,ownerDocument:document,dispatchEvent(e){events.push(e);},setPointerCapture(){held=true;},hasPointerCapture(){return held;},releasePointerCapture(){held=false;},requestPointerLock(options){assert.equal(options,undefined,'Platform acceleration is retained');requests++;document.pointerLockElement=element;}};
  const scope={document,PointerEvent:class{constructor(type,init){Object.assign(this,{type,isTrusted:false},init);}},FrameViewWindows:{inputDocument:document,onDocument(type,fn){const h=handlers.get(type)||[];h.push(fn);handlers.set(type,h);},onWindow(type,fn){windowHandlers.set(type,fn);}}};vm.createContext(scope);vm.runInContext(block,scope);
  const base={isTrusted:true,pointerId:7,buttons:1,clientX:nativeX,clientY:nativeY,screenX,screenY};
  const fire=(type,extra={})=>{const e={type,currentTarget:document,timeStamp:1,movementX:0,movementY:0,stopImmediatePropagation(){this.stopped=true;},preventDefault(){},...base,...extra};for(const h of handlers.get(type)||[])h(e);return e;};
  const edge=extra=>{scope.e={...base,...extra};scope.el=element;vm.runInContext('frameEdgePointer(e,el)',scope);};
  const locked=()=>{edge();fire('pointerlockchange');};
  const move=(x,y)=>fire('mousemove',{movementX:x,movementY:y,isTrusted:false});
  const sample=(list,stamp=2)=>{fire('pointermove',{timeStamp:stamp,getCoalescedEvents:()=>list.map(([movementX,movementY])=>({movementX,movementY}))});fire('mousemove',{timeStamp:stamp,movementX:list.reduce((n,p)=>n+p[0],0),movementY:list.reduce((n,p)=>n+p[1],0)});};
  return {scope,element,document,events,fire,edge,locked,move,sample,get:()=>vm.runInContext('framePointerLock',scope),count:()=>({requests,exits}),windowHandlers};
 }
 for(const offset of [[0,0],[-1600,-200]]){
  const s=setup({left:offset[0],top:offset[1]});
  for(const p of [[offset[0]+10,offset[1]+10],[offset[0]+800,offset[1]+450],[offset[0]+1590,offset[1]+890]])s.edge({screenX:p[0],screenY:p[1]});
  check('No lock request before the screen edge '+offset,s.count().requests===0&&s.get()===null);
  s.edge({buttons:0});check('Hover cannot acquire lock '+offset,s.count().requests===0);
  s.edge({isTrusted:false});check('Synthetic movement cannot acquire lock '+offset,s.count().requests===0);
  s.locked();check('Edge acquires one native lock '+offset,s.count().requests===1&&s.document.pointerLockElement===s.element);
  for(let i=0;i<5;i++){s.move(40,-20);s.move(-65,20);s.move(25,0);}
  check('Repeated virtual screen re-entry retains lock '+offset,s.document.pointerLockElement===s.element&&s.count().exits===0&&s.count().requests===1);
  check('All relative movement remains continuous '+offset,s.get().x===1498&&s.get().y===300&&s.events.length===15);
  s.edge();check('A held lock never requests another lock '+offset,s.count().requests===1);
  s.fire('pointerup',{button:0,buttons:0});check('Release finishes once, with no displacement '+offset,s.get()===null&&!s.document.pointerLockElement&&s.count().exits===1&&s.events.at(-1).type==='pointerup'&&s.events.at(-1).clientX===1498);
  s.fire('mouseup',{buttons:0});s.fire('pointerlockchange');check('Late release/lock notifications do not duplicate the end '+offset,s.events.filter(e=>e.type==='pointerup').length===1&&!s.events.some(e=>e.type==='pointercancel'));
 }
 for(const type of ['pointerup','mouseup','pointercancel'])for(const pending of [false,true]){
  const s=setup();if(pending)s.element.requestPointerLock=()=>undefined;s.edge();if(!pending){s.fire('pointerlockchange');s.move(-80,10);}s.fire(type,{buttons:0});
  check('End is delivered once '+type+' pending='+pending,s.get()===null&&s.events.filter(e=>e.type===(type==='pointercancel'?'pointercancel':'pointerup')).length===1&&!s.document.pointerLockElement);
  if(pending){s.document.pointerLockElement=s.element;s.fire('pointerlockchange');check('Late acquisition after '+type+' is released',!s.document.pointerLockElement);}
 }
 for(const pending of [false,true])for(const cancel of ['Escape','blur','hidden']){
  const s=setup();if(pending)s.element.requestPointerLock=()=>undefined;s.edge();if(!pending)s.fire('pointerlockchange');
  if(cancel==='Escape')s.fire('keydown',{key:'Escape'});else if(cancel==='blur')s.windowHandlers.get('blur')();else{s.document.hidden=true;s.fire('visibilitychange');}
  check('Cancellation clears '+cancel+' pending='+pending,s.get()===null&&!s.document.pointerLockElement&&!s.element.hasPointerCapture()&&s.events.filter(e=>e.type==='pointercancel').length===1);
 }
 {
  const s=setup({id:'inpRough'});s.locked();s.move(40,0);s.move(-80,0);check('Numeric scrub retains unlimited native lock',s.document.pointerLockElement===s.element&&s.get().x===1458);s.fire('pointerup',{buttons:0});check('Numeric release clears lock',s.get()===null);
 }
 {
  const s=setup();s.locked();s.document.pointerLockElement=null;s.fire('pointerlockchange');s.fire('pointerlockchange');check('Unexpected native lock loss cancels once',s.get()===null&&s.events.filter(e=>e.type==='pointercancel').length===1);
 }
 {
  const s=setup();s.fire('pointerdown');s.edge({buttons:2});s.fire('pointerlockchange');s.move(-80,0);s.fire('pointerup',{buttons:0,button:2});check('Right-drag release suppresses context menu outside the canvas',s.fire('contextmenu').stopped);s.fire('pointerdown');check('Next independent context click remains available',!s.fire('contextmenu').stopped);
 }
 {
  const s=setup();s.locked();const other={defaultView:{screen:{}},hidden:false};check('Another document cannot supply movement',!s.fire('pointermove',{currentTarget:other,clientX:12}).stopped&&s.get().x===1498);s.fire('mousemove',{currentTarget:other,movementX:40});check('Another document mouse movement is ignored',s.get().x===1498);other.hidden=true;s.fire('visibilitychange',{currentTarget:other});s.fire('pointerlockchange',{currentTarget:other});check('Other document transitions cannot cancel the gesture',!!s.get());
 }
 {
  const s=setup();s.element.requestPointerLock=()=>{throw Error('Denied');};s.edge();check('Denied request leaves ordinary capture intact',s.get()===null&&s.element.hasPointerCapture());s.element.requestPointerLock=()=>{throw Error('Must not retry');};s.edge();check('Denied request stays blocked during this gesture',s.get()===null);s.fire('pointerdown');s.element.requestPointerLock=()=>{s.document.pointerLockElement=s.element;};s.locked();check('Next gesture can acquire after a denial',!!s.get());
 }
 {
  const s=setup();s.element.requestPointerLock=()=>undefined;s.edge();s.fire('pointermove',{clientX:1490,clientY:305});check('Pending acquisition preserves actual movement',s.get().x===1490&&s.get().y===305&&s.events.at(-1).clientX===1490);s.fire('pointerlockerror');check('Legacy rejection clears only the pending request',s.get()===null);
 }
 for(const dpr of [1,2]){
  const s=setup({dpr});s.locked();s.sample([[0,0]]);s.sample([[-698*dpr,150*dpr]],3);check('Zero sample does not consume the initial recenter guard DPR'+dpr,s.get().x===1498&&s.get().y===300);s.sample([[8,-4]],4);check('Following actual movement is preserved DPR'+dpr,s.get().x===1506&&s.get().y===296);
 }
 {
  const s=setup();s.locked();s.sample([[8,-4]]);check('First ordinary movement is not discarded',s.get().x===1506&&s.get().y===296);s.sample([[-698,150]],3);check('Later large motion is not filtered as an initial warp',s.get().x===808&&s.get().y===446);
 }
 for(const dpr of [1,2]){
  const s=setup({width:984,height:665,nativeX:435,nativeY:1572,screenX:1043,screenY:2159,dpr});s.locked();
  // Physical Windows trace: first DOM sample already combines center warp and motion.
  const warp=[57*dpr,-1240*dpr],real=[-17,69];s.sample([[warp[0]+real[0],warp[1]+real[1]],[-15,70],[0,0],[-17,70]]);
  check('Mixed initial warp retains residual and later coalesced motion DPR'+dpr,s.get().x===435-49&&s.get().y===1572+209&&s.document.pointerLockElement===s.element);
 }
 {
  const s=setup({width:984,height:665,nativeX:306,nativeY:1572,screenX:914,screenY:2159});s.locked();s.fire('mousemove',{movementX:175,movementY:-1207});check('Physical aggregate trace subtracts the center displacement without unlock',s.get().x===295&&s.get().y===1605&&s.count().exits===0);
 }
 {
  const s=setup({width:984,height:665,nativeX:135,nativeY:1572,screenX:743,screenY:2159});s.locked();s.sample([[354,-1206],[-3,26]]);check('Verified held-gesture physical trace preserves both real samples',s.get().x===129&&s.get().y===1632&&s.count().exits===0);s.sample([[-11,83]],3);check('Following physical trace motion is unchanged',s.get().x===118&&s.get().y===1715);
 }
 for(const dpr of [1,1.1,1.25,1.5,2])for(const [nativeX,nativeY] of [[-600,300],[1498,300],[700,-500],[700,1200]]){
  const s=setup({dpr,nativeX,nativeY});s.locked();const wx=(800-nativeX)*dpr,wy=(450-nativeY)*dpr;s.sample([[0,0],[wx,wy],[8,-4]]);
  check('Closest native scale removes only center warp '+dpr+' '+nativeX+','+nativeY,s.get().x===nativeX+8&&s.get().y===nativeY-4);
 }
 check('No fake DOM cursor or raw-input substitution',!block.includes('createElementNS')&&!block.includes('frame-navigation-cursor')&&!block.includes('unadjustedMovement'));
 const s=setup(),begin=performance.now();for(let i=0;i<10000;i++){s.fire('pointerdown');s.locked();s.move(40,0);s.move(-60,0);s.fire('pointerup',{buttons:0});}const ms=performance.now()-begin;check('10000 completed held-edge cycles stay below 2 seconds',ms<2000);timings.push({name:'10000 complete held-edge cycles',ms,limit:2000});
 return {pass:true,checks,timings};
}
export function pointerReturnNegatives(source){
 const mutations=[
  ['early acquisition',s=>s.replace('||framePointerInsideScreen(e.screenX,e.screenY,screen)','')],
  ['unlock on virtual screen return',s=>s.replace('if(dx||dy){lock.x+=dx;lock.y+=dy;frameLockedEvent(\'pointermove\',lock,e);}',"if(dx||dy){lock.x+=dx;lock.y+=dy;frameLockedEvent('pointermove',lock,e);document.exitPointerLock();}")],
  ['missing release',s=>s.replace('if(doc.pointerLockElement)doc.exitPointerLock();','')],
  ['lost pending movement',s=>s.replace('lock.x+=e.clientX-lock.nativeX;','')],
  ['discard first ordinary sample',s=>s.replace('if(sample){lock.recenter=false;','if(sample){lock.recenter=false;return;')],
  ['discard mixed residual',s=>s.replace('dx-=rx;dy-=ry;','if(best<Infinity){dx=0;dy=0;}')],
  ['unexpected loss ignored',s=>s.replace('else if(lock&&!lock.pending){','else if(false){')]
 ];
 for(const [name,mutate]of mutations){const changed=mutate(source);assert.notEqual(changed,source,name);assert.throws(()=>pointerReturnChecks(changed),undefined,name);}return mutations.map(x=>x[0]);
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const source=await readFile(new URL('../index.html',import.meta.url),'utf8');console.log(JSON.stringify({...pointerReturnChecks(source),negativeControls:pointerReturnNegatives(source),indexSHA256:createHash('sha256').update(source).digest('hex')},null,2));}
