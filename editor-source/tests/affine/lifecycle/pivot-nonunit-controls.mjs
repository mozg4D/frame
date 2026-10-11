// Source-only VM controls using exact production numeric/HUD/CM handlers. No product edits.
import fs from 'node:fs';
import {setup} from './pivot-escape-focus.mjs';
import {geometrySnapshot,unchanged,desiredFrame,near,T,assert,sourceHash} from './v4j-pivot-support.mjs';
assert.equal(sourceHash,'df08be98af28f6898ae0bd76b1f99de09009b23ca0676c0afaadd25ca5afaf17');
const report={sourceHash,scope:'Exact-source non-unit CM same-display, changed-value, scrub return, and API complete same-value controls; no application or GPU claims',passes:[],failures:[]};
const custom=new T.Matrix4().makeRotationFromEuler(new T.Euler(.22,.16,-.35)).setPosition(9.123456789012345,4.876543219876543,-3.234567890123456);
// Opposite mouse deltas are a numeric return only for the position fixtures here.
// World rotation reads a world-aligned 0; near-zero Object rotation changes step size, so those are not no-op inputs.
const reflected=new T.Matrix4().compose(new T.Vector3(7,-5,11),new T.Quaternion().setFromEuler(new T.Euler(.31,-.42,.58)),new T.Vector3(-2,.5,3));
for(const space of ['world','object'])for(const pivot of [null,custom])for(const owner of [null,reflected])for(const unit of [.1,1000])for(const ch of ['pos','rot'])for(let axis=0;axis<3;axis++)for(const flow of (ch==='pos'?['same display blur','changed full precision text','scrub away back']:['same display blur','changed full precision text'])){
 const name=`${space}/${pivot?'custom':'null'}/${owner?'reflected':'identity'}/unit=${unit}/${ch}${axis}/${flow}`;
 try{
  const f=setup({space,pivot,world:owner,unit}),{c,mesh,log}=f,g=geometrySnapshot(mesh),initial=c.polyPivotMatrix?.slice()??null,entry=c.polySelection.items.get('h'),items=c.polySelection.items;
  const inp=c[{pos:['px','py','pz'],rot:['rx','ry','rz']}[ch][axis]],sentinel={redo(){},undo(){}};c.redoStack.push(sentinel);
  let expected=null;
  inp.focus();
  if(flow==='same display blur')inp.blur();
  else if(flow==='changed full precision text'){
   const m=c.META.get(inp),next=c.dispValue(m,c.readTransform(c.coordMode))+.125678912345;
   expected=desiredFrame(c,ch,axis,c.toMM(m,next)).final.elements;
   inp.value=String(next);inp.dispatch('input');inp.dispatch('keydown',{key:'Enter'});
  }else{
   inp.dispatch('pointerdown',{pointerId:7});inp.dispatch('pointermove',{pointerId:7,movementX:6,movementY:0});inp.dispatch('pointermove',{pointerId:7,movementX:-6,movementY:0});inp.dispatch('pointerup',{pointerId:7});
  }
  unchanged(mesh,g);assert.equal(c.polySelection.items,items);assert.equal(items.get('h'),entry);for(const key of ['prepare','replace','delta','crease','normal'])assert.equal(log[key],0,key);assert.equal(c.polyCoordinatePivotEdit,null);
  if(expected){near(c.polyPivotMatrix,expected,'changed full precision',1e-10);assert.equal(c.undoStack.length,1);assert.equal(c.redoStack.length,0);const after=c.polyPivotMatrix.slice();c.undoStack[0].undo();assert.deepEqual(c.polyPivotMatrix,initial);c.undoStack[0].redo();assert.deepEqual(c.polyPivotMatrix,after);unchanged(mesh,g);}
  else {assert.deepEqual(c.polyPivotMatrix,initial);assert.equal(c.undoStack.length,0);assert.equal(c.redoStack[0],sentinel);}
  report.passes.push({name});
 }catch(e){report.failures.push({name,error:e.message});}
}
for(const space of ['world','object'])for(const pivot of [null,custom])for(const owner of [null,reflected])for(const unit of [.1,1000]){
 const name=`API complete same-value ${space}/${pivot?'custom':'null'}/${owner?'reflected':'identity'}/unit=${unit}`;
 try{const {c,mesh}=setup({space,pivot,world:owner,unit}),initial=c.polyPivotMatrix?.slice()??null,g=geometrySnapshot(mesh);c.setCoordinates(c.coordinates());assert.deepEqual(c.polyPivotMatrix,initial);assert.equal(c.undoStack.length,0);assert.equal(c.polyCoordinatePivotEdit,null);unchanged(mesh,g);report.passes.push({name});}catch(e){report.failures.push({name,error:e.message});}
}
report.pass=report.failures.length===0;console.log(JSON.stringify({sourceHash,pass:report.pass,passes:report.passes.length,failures:report.failures},null,2));if(!report.pass)process.exitCode=1;
