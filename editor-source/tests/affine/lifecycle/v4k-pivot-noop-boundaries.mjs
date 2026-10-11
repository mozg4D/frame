import {reviewURL} from '../source-paths.mjs';
// Independent focused review. Product source is extracted unchanged; only VM/UI test scaffolding is supplied.
import {fileURLToPath} from 'node:url';
process.env.FRAME_PIVOT_EDITOR ||= fileURLToPath(reviewURL('../candidate/editor-affine-ui-v2c.mjs',import.meta.url));
const {makeFixture,geometrySnapshot,unchanged,near,T,assert,vm,extract,sourceHash}=await import('./v4j-pivot-support.mjs');
const report={scope:'Exact-source pivot/CM/API no-op boundaries, synthetic VM and input events. No browser, GPU or full application acceptance.',sourceHash,passes:[],contractFailures:[],observations:[]};
const custom=new T.Matrix4().makeRotationFromEuler(new T.Euler(.22,.16,-.35)).setPosition(9,4,-3);
const worlds={identity:new T.Matrix4(),reflectedParent:new T.Matrix4().compose(new T.Vector3(7,-5,11),new T.Quaternion().setFromEuler(new T.Euler(.31,-.42,.58)),new T.Vector3(-2,.5,3))};
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function record(name,fn){try{const detail=fn();report.passes.push({name,...detail});}catch(e){report.contractFailures.push({name,error:e.message});}}
function fixture(options={}){
 const out=makeFixture({shared:true,pivot:custom,...options}),{c,mesh,log}=out;
 // Use the real history insertion and stack-disposal code. Unrelated scene hooks are explicit stubs.
 Object.assign(c,{HISTORY_LIMIT:100,edgeBevelResult:null,frameAutoKeyCommand(){},frameValidateTopologyCommand(){},registerSceneCommandState(){}});
 for(const name of ['discardHistoryEntry','clearCommandStack','trimCommandStack','pushCmd'])vm.runInContext(extract(name),c);
 const geometry=geometrySnapshot(mesh),initial=c.polyPivotMatrix?.slice()??null,selection=c.polySelection.items,entry=selection.get('h'),sets=[entry.faces,entry.vertices,entry.edges],setValues=sets.map(s=>[...s]);
 let captures=0;for(const name of ['capturePolySelection','capturePolyGeometries']){const original=c[name];c[name]=(...args)=>{captures++;return original(...args);};}
 function verifyGeometry(){unchanged(mesh,geometry);assert.equal(c.polySelection.items,selection);assert.equal(selection.get('h'),entry);sets.forEach((s,i)=>{assert.equal([entry.faces,entry.vertices,entry.edges][i],s);assert.deepEqual([...s],setValues[i]);});assert.equal(captures,0,'geometry captures');for(const key of ['prepare','replace','delta','crease','normal'])assert.equal(log[key],0,key);}
 return{...out,initial,verifyGeometry};
}
function inputFor(c,ch='pos',axis=0){
 const listeners=new Map(),windowListeners=new Map();const inp={value:'',dataset:{},selectionStart:0,selectionEnd:0,
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
  dispatch(name,event={}){for(const fn of listeners.get(name)||[])fn({preventDefault(){},stopPropagation(){},...event});},
  blur(){c.document.activeElement=null;inp.dispatch('blur');},focus(){c.document.activeElement=inp;inp.dispatch('focus');},select(){},setPointerCapture(){},setSelectionRange(){}};
 Object.assign(c,{_scrubActive:null,_scrubSession:null,document:{activeElement:null,body:{style:{}}},frameNumericPointerInput(){},frameControlDescriptors(){return[];},frameBindControl(){},frameAttributePropagate(){},
  numericTextValue:s=>Number.isFinite(Number(s))?Number(s):null,san:s=>s,clearNumericInputText(){},rememberNumericInputText(){},
  setNumericInputDisplay(el,v){el.value=String(v);},addEventListener(name,fn){if(!windowListeners.has(name))windowListeners.set(name,[]);windowListeners.get(name).push(fn);}});
 vm.runInContext(extract('makeScrubInput'),c);
 const key={pos:'position',rot:'rotation',size:'size'}[ch];c.makeScrubInput(inp,{get:()=>c.coordinates()[key][axis],set:v=>c.applyInput(ch,axis,v),snap:c.coordinateSnapshot,commit:c.commitCoordinateSnapshot,revert:c.revertCoordinateSnapshot,deferText:true});return inp;
}
function assertNoop(f){f.verifyGeometry();assert.deepEqual(f.c.polyPivotMatrix,f.initial,'unchanged input must preserve custom pivot exactly');assert.equal(f.c.undoStack.length,0,'unchanged input must not add history');}
function detail(f){return {historyCount:f.c.undoStack.length,pivotChanged:!same(f.initial,f.c.polyPivotMatrix),geometryUnchanged:true};}
for(const space of ['world','object'])for(const [owner,world]of Object.entries(worlds))for(const ch of ['pos','rot']){
 const name=`API unchanged displayed ${ch}: ${space}/${owner}`;
 record(name,()=>{const f=fixture({space,world}),{c}=f,key=ch==='pos'?'position':'rotation',v=c.coordinates()[key][0];c.setCoordinates({[key]:[v,null,null]});assertNoop(f);return detail(f);});
}
for(const space of ['world','object'])record(`API unchanged complete coordinate object: ${space}`,()=>{const f=fixture({space});f.c.setCoordinates(f.c.coordinates());assertNoop(f);return detail(f);});
for(const space of ['world','object'])record(`CM exact-source unchanged text blur: ${space}`,()=>{const f=fixture({space}),inp=inputFor(f.c);inp.focus();inp.blur();assertNoop(f);return detail(f);});
for(const space of ['world','object'])record(`CM exact-source scrub away and back: ${space}`,()=>{const f=fixture({space}),inp=inputFor(f.c);inp.dispatch('pointerdown',{pointerId:7});inp.dispatch('pointermove',{pointerId:7,movementX:6,movementY:0});inp.dispatch('pointermove',{pointerId:7,movementX:-6,movementY:0});inp.dispatch('pointerup',{pointerId:7});assertNoop(f);return detail(f);});
record('CM exact-source Escape restores custom pivot and geometry',()=>{const f=fixture(),inp=inputFor(f.c);inp.dispatch('pointerdown',{pointerId:7});inp.dispatch('pointermove',{pointerId:7,movementX:6,movementY:0});inp.dispatch('keydown',{key:'Escape'});assertNoop(f);return detail(f);});
for(const path of ['API','CM scrub'])record(`${path} stored command Undo/Redo is real and deterministic`,()=>{const f=fixture(),{c}=f;if(path==='API')c.setCoordinates({position:[10,null,null]});else{const inp=inputFor(c);inp.dispatch('pointerdown',{pointerId:7});inp.dispatch('pointermove',{pointerId:7,movementX:6,movementY:0});inp.dispatch('pointerup',{pointerId:7});}assert.equal(c.undoStack.length,1);const after=c.polyPivotMatrix.slice(),cmd=c.undoStack[0];cmd.undo();assert.deepEqual(c.polyPivotMatrix,f.initial);f.verifyGeometry();cmd.redo();assert.deepEqual(c.polyPivotMatrix,after);f.verifyGeometry();return{historyCount:1,undoRestoresCustom:true,redoRestoresIdentityBasis:true,geometryUnchanged:true};});
for(const space of ['world','object'])for(const pivot of [null,custom])record(`Size API preserves redo and pivot: ${space}/${pivot?'custom':'auto'}`,()=>{const f=fixture({space,pivot}),sentinel={redo(){},undo(){}};f.c.redoStack.push(sentinel);f.c.setCoordinates({size:[-1,0,800]});assertNoop(f);assert.equal(f.c.redoStack[0],sentinel);return detail(f);});
record('Changed World position follows inherited G0 formula',()=>{const f=fixture(),{c}=f;c.setCoordinates({position:[10,null,null]});near(c.polyPivotMatrix,new T.Matrix4().setPosition(10,4,-3).elements);f.verifyGeometry();return{historyCount:c.undoStack.length,customBasisPreserved:false,classification:'Existing G0 is world-aligned; the source formula does not promise to preserve hidden custom rotation on a changed World position.'};});

report.observations.push({name:'Scope of failing no-op contract',text:'Same-value API calls and CM scrub-out-and-back change the stored custom pivot basis. Plain unchanged text blur skips its setter and passes. This formula was inherited from v4j; v4k fixes geometry isolation/history but does not fix input idempotence.'});
report.pass=report.contractFailures.length===0;console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
