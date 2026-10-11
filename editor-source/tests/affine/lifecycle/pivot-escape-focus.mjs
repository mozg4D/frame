// Exact product functions in a synthetic document/input event adapter. No product edits.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {makeFixture,geometrySnapshot,unchanged,T,assert,vm,extract,source,sourceHash} from './v4j-pivot-support.mjs';
assert(['5aadcdee1557675d4b6f2b42a8d4dcd2a283f0a60407bb57e6e2e8e2881676ff','c79b431a5885a0412d036d60b6253393297f33f085db1804a9167825646f0d71'].includes(sourceHash),'pinned source');
const report={sourceHash,scope:'Exact-source focused CM Escape then blur, synthetic input propagation only',passes:[],failures:[]};
export function setup({space='world',pivot=null,world=null,unit=1}={}){
 const f=makeFixture({space,pivot,world,shared:true}),{c}=f,dl=new Map(),wl=new Map();
 Object.assign(c,{_scrubActive:null,_scrubSession:null,R2D_UI:180/Math.PI,UMM:[unit],dispIdx:0,
 NUMERIC_LITERAL_RE:/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i,
 document:{activeElement:null,body:{style:{}},addEventListener(n,fn){if(!dl.has(n))dl.set(n,[]);dl.get(n).push(fn);}},
 frameNumericPointerInput(){},frameControlDescriptors(){return[];},frameBindControl(){},frameAttributePropagate(){},san:s=>s,
 numericTextValue:s=>Number.isFinite(Number(s))?Number(s):null,
 addEventListener(n,fn){if(!wl.has(n))wl.set(n,[]);wl.get(n).push(fn);}
 });
 for(const name of ['numericLiteralValue','rememberNumericInputText','clearNumericInputText','setNumericInputDisplay','makeScrubInput','dispValue','toMM','updateHUD','_endSessionOutside'])vm.runInContext(extract(name),c);
 const line=source.split('\n').find(s=>s.startsWith('document.addEventListener("keydown", (e) => ')&&s.includes('_endSessionOutside(e.target)'));
 assert(line);vm.runInContext(line,c);
 const fields=[];
 for(const [ch,names]of [['pos',['px','py','pz']],['rot',['rx','ry','rz']],['size',['sx','sy','sz']]])for(let axis=0;axis<3;axis++){
  const listeners=new Map();const inp={value:'',dataset:{},style:{},selectionStart:0,selectionEnd:0,
  addEventListener(n,fn){if(!listeners.has(n))listeners.set(n,[]);listeners.get(n).push(fn);},contains(t){return t===this;},
  dispatch(n,extra={}){let stopped=false;const e={target:inp,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){stopped=true;},...extra};for(const fn of dl.get(n)||[]) {fn(e);if(stopped)return;}for(const fn of listeners.get(n)||[]) {fn(e);if(stopped)return;}},
  focus(){c.document.activeElement=inp;inp.dispatch('focus');},blur(){if(c.document.activeElement!==inp)return;c.document.activeElement=null;inp.dispatch('blur');},select(){},setPointerCapture(){},setSelectionRange(){}};
  c[names[axis]]=inp;fields.push([inp,{ch,i:axis}]);
 }
 c.META=new Map(fields);
 for(const [inp,m]of fields)c.makeScrubInput(inp,{get:()=>c.dispValue(m,c.readTransform(c.coordMode)),set:v=>c.applyInput(m.ch,m.i,c.toMM(m,v)),snap:c.coordinateSnapshot,commit:c.commitCoordinateSnapshot,revert:c.revertCoordinateSnapshot,deferText:true});
 c.updateHUD();return f;
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
const custom=new T.Matrix4().makeRotationFromEuler(new T.Euler(.22,.16,-.35)).setPosition(9,4,-3);
const reflected=new T.Matrix4().compose(new T.Vector3(7,-5,11),new T.Quaternion().setFromEuler(new T.Euler(.31,-.42,.58)),new T.Vector3(-2,.5,3));
for(const space of ['world','object'])for(const pivot of [null,custom])for(const owner of [null,reflected])for(const via of ['text','arrow','scrub']){
 const name=`${space}/${pivot?'custom':'null'}/${owner?'reflected':'identity'}/${via}`;
 const f=setup({space,pivot,world:owner}),{c,mesh}=f,initial=c.polyPivotMatrix?.slice()??null,g=geometrySnapshot(mesh),inp=c.px;
 try{
  inp.focus();const oldValue=inp.value;
  if(via==='text'){inp.value=String(Number(oldValue)+3);inp.dispatch('input');}
  if(via==='arrow')inp.dispatch('keydown',{key:'ArrowUp'});
  if(via==='scrub'){inp.dispatch('pointerdown',{pointerId:7});inp.dispatch('pointermove',{pointerId:7,movementX:6,movementY:0});}
  inp.dispatch('keydown',{key:'Escape'});
  assert.deepEqual(c.polyPivotMatrix,initial,'Escape immediate exact pivot');assert.equal(c.undoStack.length,0);assert.equal(c.polyCoordinatePivotEdit,null);
  const afterEscape={inputText:inp.value,focused:c.document.activeElement===inp,pivot:c.polyPivotMatrix};
  inp.blur();inp.dispatch('pointerup',{pointerId:7});unchanged(mesh,g);
  const afterBlur={inputText:inp.value,pivot:c.polyPivotMatrix,undo:c.undoStack.length};
  try{assert.deepEqual(c.polyPivotMatrix,initial,'Canceled input must remain canceled after blur');assert.equal(c.undoStack.length,0);report.passes.push({name});}
  catch(e){report.failures.push({name,error:e.message,oldValue,afterEscape,afterBlur});}
 }catch(e){report.failures.push({name,error:e.message});}
}
report.pass=report.failures.length===0;

console.log(JSON.stringify({sourceHash,pass:report.pass,passes:report.passes.length,failures:report.failures.map(x=>({name:x.name,error:x.error.split('\n')[0],before:x.oldValue,afterEscape:x.afterEscape?.inputText,afterBlur:x.afterBlur?.inputText,history:x.afterBlur?.undo}))},null,2));
if(!report.pass)process.exitCode=1;

}
