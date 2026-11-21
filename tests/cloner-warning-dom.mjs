import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(process.argv[2]||'index.html','utf8');
function part(a,b){
 const start=html.indexOf(a),end=html.indexOf(b,start+a.length);
 assert.ok(start>=0&&end>start,a);return html.slice(start,end);
}
const snippets=part('function bindNumber(input,o){',"FrameViewWindows.onDocument('pointerdown',e=>{if(numericSession")+
 part('function openDialog(title,html,accept=',"$('dialogClose').onclick");
const setup=new Function('stat',`
 ${snippets}
 class Control extends EventTarget {
   constructor(){super();this.open=false;this.textContent='Cancel';this.dataset={};this.style={};this.value='';}
   close(){if(this.open){this.open=false;this.dispatchEvent(new Event('close'));}}
   showModal(){this.open=true;stat.dialogs++;}
   closest(){return null;}
   focus(){if(document.activeElement!==this){document.activeElement=this;this.fire('focus');}}
   blur(){if(document.activeElement===this){document.activeElement=null;this.fire('blur');}}
   fire(name,detail={}){const e=new Event(name,{cancelable:true});Object.assign(e,detail);this.dispatchEvent(e);}
   setPointerCapture(){}
   hasPointerCapture(){return false;}
 }
 const controls=new Map(['dialog','dialogTitle','dialogBody','dialogOK','dialogCancel'].map(id=>[id,new Control()]));
 const $=id=>controls.get(id),escapeHTML=x=>x,FrameViewWindows={placeUI(){}},
  document={activeElement:null,body:{classList:{add(){},remove(){}}}},framePointerLock=null,
  unitMillimeters=[1,10],displayUnitIndex=1;
 let numericSession=null;
 const selected=new Set(['local']),owner={id:'local',nativeHash:'owner',type:'cloner',
  params:{count:15,step:25}},node=id=>id===owner.id?owner:null;
 const engine={scene:{},clonerPlacementCount(hash,changes){
   stat.estimates.push({hash,changes});
   if(Object.hasOwn(changes,'step'))return changes.step===10?10000001n:10000000n;
   return BigInt(changes.count);
 }};
 const window={frameEngine:engine},frameValueKey=JSON.stringify;
 const snapshot=()=>({...owner.params}),checkpoint=s=>stat.history.push(s),
   restore=()=>stat.restored++,resumeAttributesAfterNumber=()=>{},fileOperationError=e=>stat.errors.push(e.message),
   compactNumberText=String,numericExpressionValue=x=>x.trim()!==''&&Number.isFinite(+x)?+x:null,
   frameEdgePointer=()=>{},getSelection=()=>null;
 const make=(key,opts={})=>{const input=new Control();
   bindNumber(input,{...opts,get:()=>owner.params[key],set:value=>{owner.params[key]=value;stat.attempts.push({key,value});},
    deferText:true,stage:(value,apply)=>frameClonerApproveDraft(owner,key,value,apply)});
   return input;
 };
 return {owner,selected,engine,controls,make,threshold:frameClonerWarningLimit};
`);
const fresh=()=>{const stat={estimates:[],history:[],attempts:[],dialogs:0,restored:0,errors:[]};return {stat,...setup(stat)};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const type=(input,value)=>{input.focus();input.value=String(value);input.fire('input');};
const key=(input,name)=>input.fire('keydown',{key:name});
const modal=m=>m.controls.get('dialog');

{
 const f=fresh(), input=f.make('count',{int:true,min:1});
 assert.equal(f.threshold,10000000n);
 type(input,9999999);type(input,10000000);
 assert.equal(f.owner.params.count,15);assert.equal(f.stat.estimates.length,0);assert.equal(f.stat.dialogs,0);
 key(input,'Enter');await turn();
 assert.deepEqual(f.stat.attempts,[{key:'count',value:10000000}]);
 assert.deepEqual(f.stat.history,[{count:15,step:25}]);assert.equal(f.stat.dialogs,0);
}
{
 const f=fresh(),input=f.make('count',{int:true});
 type(input,10000001);key(input,'Enter');
 assert.equal(modal(f).open,true);assert.match(f.controls.get('dialogBody').innerHTML,/10,000,001/);
 assert.equal(f.controls.get('dialogCancel').textContent,'No');assert.equal(f.controls.get('dialogOK').textContent,'Yes');
 assert.equal(f.owner.params.count,15);assert.deepEqual(f.stat.attempts,[]);assert.deepEqual(f.stat.history,[]);
 modal(f).close();await turn();
 assert.equal(f.owner.params.count,15);assert.equal(input.value,'15');assert.equal(f.stat.restored,0);
 assert.deepEqual(f.stat.attempts,[]);assert.deepEqual(f.stat.history,[]);assert.equal(f.controls.get('dialogCancel').textContent,'Cancel');
}
{
 const f=fresh(),input=f.make('count',{int:true});
 type(input,10000002);key(input,'Enter');
 assert.equal(modal(f).open,true);assert.deepEqual(f.stat.attempts,[]);
 f.controls.get('dialogOK').onclick();await turn();
 assert.equal(f.stat.dialogs,1);assert.deepEqual(f.stat.attempts,[{key:'count',value:10000002}]);
 assert.deepEqual(f.stat.history,[{count:15,step:25}]);assert.equal(input.value,'10000002');
}
{
 const f=fresh(),input=f.make('count',{int:true});
 type(input,10000001);key(input,'Escape');await turn();
 assert.equal(f.stat.dialogs,0);assert.deepEqual(f.stat.estimates,[]);assert.equal(input.value,'15');
 assert.deepEqual(f.stat.attempts,[]);assert.equal(f.stat.restored,0);
}
{
 const f=fresh(),input=f.make('count',{int:true,stepFixed:10000000});
 input._scrubStart({pointerId:1,clientX:0,clientY:0});
 input._scrubMove({pointerId:1,clientX:6,clientY:0,preventDefault(){}});
 assert.equal(input.value,'10000015');assert.equal(f.owner.params.count,15);assert.deepEqual(f.stat.attempts,[]);
 input._scrubEnd({pointerId:1});assert.equal(f.stat.dialogs,1);
 modal(f).close();await turn();assert.equal(input.value,'15');assert.deepEqual(f.stat.history,[]);
}
{
 const f=fresh(),input=f.make('step',{length:true});
 type(input,1);key(input,'Enter');assert.equal(modal(f).open,true);
 assert.deepEqual(f.stat.estimates,[{hash:'owner',changes:{step:10}}]);
 f.controls.get('dialogOK').onclick();await turn();
 assert.deepEqual(f.stat.attempts,[{key:'step',value:10}]);assert.equal(input.value,'1');
}
{
 const f=fresh(),input=f.make('count',{int:true});
 type(input,10000001);key(input,'Enter');
 f.engine.scene={};f.controls.get('dialogOK').onclick();await turn();
 assert.deepEqual(f.stat.attempts,[]);assert.deepEqual(f.stat.history,[]);
 assert.match(f.stat.errors[0],/changed before confirmation/);
}
assert.equal((html.match(/frameClonerApproveDraft\(/g)||[]).length,2,'Only numeric Attributes call the UI gate');
console.log('Cloner warning: real numeric/dialog functions exercised through a fake DOM. Exact boundary, No, Escape, scrub, Yes, native units and stale owner pass.');
