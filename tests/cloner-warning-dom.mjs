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
 const engine={scene:{},clonerDraftFits(hashes,changes){
   stat.estimates.push({hashes,changes});
   if(stat.stale)engine.scene={};
   if(stat.capacity)throw Object.assign(new RangeError('capacity'),{frameReplicaCapacity:true});
   if(stat.otherError)throw Error('unrelated failure');
   return !stat.reject;
 }};
 const window={frameEngine:engine},frameValueKey=JSON.stringify;
 const snapshot=()=>({...owner.params}),checkpoint=s=>stat.history.push(s),
   restore=()=>stat.restored++,resumeAttributesAfterNumber=()=>{},fileOperationError=e=>stat.errors.push(e.message),
   compactNumberText=String,numericExpressionValue=x=>x.trim()!==''&&Number.isFinite(+x)?+x:null,
   frameEdgePointer=()=>{},getSelection=()=>null;
 const make=(key,opts={})=>{const input=new Control();
   bindNumber(input,{...opts,get:()=>owner.params[key],set:value=>{owner.params[key]=value;stat.attempts.push({key,value});},
    deferText:true,stage:(value,apply)=>frameClonerApplyDraft(owner,key,value,apply)});
   return input;
 };
 return {owner,selected,engine,controls,make};
`);
const fresh=x=>{const stat={estimates:[],history:[],attempts:[],dialogs:0,restored:0,errors:[],...x};return {stat,...setup(stat)};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const type=(input,value)=>{input.focus();input.value=String(value);input.fire('input');};
const key=(input,name)=>input.fire('keydown',{key:name});
for(const value of [9999999,10000000,10000001]){
 const f=fresh(),input=f.make('count',{int:true,min:1});
 type(input,value);assert.equal(f.owner.params.count,15);assert.equal(f.stat.estimates.length,0);
 key(input,'Enter');await turn();
 assert.deepEqual(f.stat.attempts,[{key:'count',value}]);
 assert.deepEqual(f.stat.history,[{count:15,step:25}]);assert.equal(f.stat.dialogs,0);
}
for(const blocked of [{reject:true},{capacity:true},{stale:true},{otherError:true}]){
 const f=fresh(blocked),input=f.make('count',{int:true});
 type(input,10000001);key(input,'Enter');await turn();
 assert.deepEqual(f.stat.attempts,[]);assert.deepEqual(f.stat.history,[]);assert.equal(input.value,'15');
 assert.equal(f.stat.dialogs,0);assert.deepEqual(f.stat.errors,blocked.otherError?['unrelated failure']:[]);
}
{
 const f=fresh(),input=f.make('step',{length:true});
 type(input,1);key(input,'Enter');await turn();assert.equal(f.stat.dialogs,0);
 assert.deepEqual(f.stat.estimates,[{hashes:['owner'],changes:{step:10}}]);
 assert.deepEqual(f.stat.attempts,[{key:'step',value:10}]);
 type(input,7);key(input,'Escape');await turn();assert.equal(f.stat.attempts.length,1);
}
assert.equal((html.match(/frameClonerApplyDraft\(/g)||[]).length,2,'Only numeric Attributes call the UI gate');
const notices=new Function(part('function frameCurvatureLimitText(','let frameCurvatureAttributeNotice=')+
 '\nreturn frameCurvatureNoticeText;')();
for(const reason of ['triangle-limit','vertex-limit','occurrence-limit','fit-limit','color-budget','occurrence-unsupported','compact-material','compact-pipeline','mesh-unavailable'])assert.equal(notices(reason),'');
assert.equal(notices('fit-failed'),'Curvature could not fit this surface');
assert.equal(notices('patch-seams-unavailable'),'Spline Patch seam data is unavailable');
const renderer=new Function('notice',`
 const section={dataset:{},querySelector:()=>notice},frameViewElement=()=>section,canvas={dataset:{}},viewIndex=0;
 ${part('function frameReplicaViewportStale','function prepareOrderedReplicaFrame')}
 return {error:frameOrderedReplicaError,stale:frameReplicaViewportStale,canvas};
`);
const notice={hidden:false,textContent:'Unrelated detach notice',dataset:{}},r=renderer(notice);
r.error(Object.assign(new RangeError('GPU replica frame capacity'),{frameReplicaCapacity:true}));
assert.equal(notice.textContent,'Unrelated detach notice');assert.equal(notice.hidden,false);
assert.equal(r.canvas.dataset.replicaDrawError,'GPU replica frame capacity');assert.ok(r.stale());
r.error(null);assert.equal(notice.textContent,'Unrelated detach notice');assert.equal(r.stale(),null);
const blank={hidden:true,textContent:'',dataset:{}},q=renderer(blank);
q.error(Object.assign(new RangeError('GPU replica frame capacity'),{frameReplicaCapacity:true}));assert.equal(blank.hidden,true);
q.error(new RangeError('unexpected range'));assert.equal(blank.hidden,false);assert.match(blank.textContent,/unexpected range/);
q.error(null);assert.equal(blank.hidden,true);
const engineCase=new Function('p','budget','retained',`
 const frameCurvatureQuietReasons=new Set(['triangle-limit','vertex-limit','occurrence-limit','fit-limit','color-budget']),
  bendAdmission=(hash,mode)=>{if(hash!=='o'||mode!=='Surface Prediction')throw Error('Unexpected target');return p;},
  bendColorBytes=budget,bendColorBudget=100,bendStates=new Map([['o',retained]]);
 ${part('function bendModeFits(','function bendGroupSummary(')}
 return bendModeFits('o','Surface Prediction');
`);
assert.equal(engineCase({reason:'vertex-limit'},0,{}),false);
assert.equal(engineCase({reason:'patch-seams-unavailable'},0,{}),true);
assert.equal(engineCase({group:true,bytes:40},90,{groupPlan:{bytes:29}}),false);
assert.equal(engineCase({group:true,bytes:40},90,{groupPlan:{bytes:30}}),true);
console.log('Quiet capacity: staged numeric DOM model, no warning below/at/above 10M, no attempt/history on real refusal; quiet renderer leaves stale guard, and Curvature preserves noncapacity errors.');
