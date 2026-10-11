import {makeFixture,geometrySnapshot,unchanged,near,desiredFrame,sourceHash,T,assert} from './v4j-pivot-support.mjs';
const report={scope:'Exact extracted CM/API source; independent reviewed reference formulas; synthetic geometry only. No browser acceptance.',sourceHash,passed:[],errors:[],matrixCases:0,geometryWordDifferences:0};
function check(name,fn){try{fn();report.passed.push(name);}catch(e){report.errors.push({name,error:e.stack});}}
const custom=new T.Matrix4().makeRotationFromEuler(new T.Euler(.22,.16,-.35)).setPosition(9,4,-3);
const worlds=[['identity',new T.Matrix4()],...[[2,2,2],[2,.5,3],[-2,2,2],[-2,.5,3]].map(s=>[s.join(','),new T.Matrix4().compose(new T.Vector3(7,-5,11),new T.Quaternion().setFromEuler(new T.Euler(.31,-.42,.58)),new T.Vector3(...s))])];
for(const space of ['world','object','local'])for(const [owner,world]of worlds)for(const pivot of [null,custom])for(const ch of ['pos','rot','size'])for(let axis=0;axis<3;axis++)for(const path of ['CM','API'])check(`${path}/${space}/${owner}/${pivot?'custom':'auto'}/${ch}/${axis}`,()=>{
 const {c,mesh,log}=makeFixture({space,world,pivot,shared:true}),geometry=geometrySnapshot(mesh),selection=c.polySelection.items,entry=selection.get('h'),initial=c.polyPivotMatrix?.slice()??null,gizmo=c.getGizmoWorldArray();
 let captures=0,geometryCaptures=0;const capture=c.capturePolySelection,geo=c.capturePolyGeometries;c.capturePolySelection=(...a)=>{captures++;return capture(...a);};c.capturePolyGeometries=(...a)=>{geometryCaptures++;return geo(...a);};
 const value=ch==='pos'?40+axis:ch==='rot'?37+axis*4:800,expected=ch==='size'?initial:desiredFrame(c,ch,axis,value).final.elements.slice();
 if(path==='CM'){const snap=c.coordinateSnapshot();assert.equal(snap.kind,'poly-pivot');assert.equal(snap.editPivot,true);assert.equal(snap.coordinateSpace,space);assert.deepEqual(snap.gizmo,gizmo);c.applyInput(ch,axis,value);c.commitCoordinateSnapshot(snap);}
 else {const a=[null,null,null];a[axis]=value;c.setCoordinates({[{pos:'position',rot:'rotation',size:'size'}[ch]]:a});}
 unchanged(mesh,geometry);assert.equal(c.polySelection.items,selection);assert.equal(selection.get('h'),entry);assert.equal(log.prepare,0);assert.equal(log.delta,0);assert.equal(log.crease,0);assert.equal(captures,0);assert.equal(geometryCaptures,0);assert.equal(c.undoStack.length,ch==='size'?0:1);
 if(ch==='size')assert.deepEqual(c.polyPivotMatrix,initial);else{near(c.polyPivotMatrix,expected,'result');const exactAfter=c.polyPivotMatrix.slice(),cmd=c.undoStack[0];cmd.undo();assert.deepEqual(c.polyPivotMatrix,initial,'Undo pivot exact');unchanged(mesh,geometry);cmd.redo();assert.deepEqual(c.polyPivotMatrix,exactAfter,'Redo pivot exact');unchanged(mesh,geometry);}
 // Displayed World basis remains world-aligned, independent of stored rotation.
 if(space==='world'){const frame=c.polyFrameMatrix();near(frame.elements.slice(0,12),new T.Matrix4().elements.slice(0,12),'world display');}
 assert.equal(log.crease,0);assert.equal(geometryCaptures,0);report.matrixCases++;
});
for(const space of ['world','object','local'])for(const pivot of [null,custom])check(`revert-and-noop/${space}/${pivot?'custom':'auto'}`,()=>{
 const {c,mesh,log}=makeFixture({space,pivot,shared:true}),geometry=geometrySnapshot(mesh),initial=c.polyPivotMatrix?.slice()??null,before=c.coordinateSnapshot();c.applyInput('rot',2,43);c.revertCoordinateSnapshot(before);assert.deepEqual(c.polyPivotMatrix,initial);unchanged(mesh,geometry);assert.equal(c.undoStack.length,0);assert.equal(log.crease,0);c.commitCoordinateSnapshot(c.coordinateSnapshot());assert.deepEqual(c.polyPivotMatrix,initial);assert.equal(c.undoStack.length,0);unchanged(mesh,geometry);
});
for(const space of ['world','object','local'])check(`API-batch-and-successive-history/${space}`,()=>{
 const {c,mesh}=makeFixture({space,shared:true}),geometry=geometrySnapshot(mesh);c.setCoordinates({position:[9,8,7],size:[100,200,300]});assert.equal(c.undoStack.length,1);const first=c.polyPivotMatrix.slice();near(first.slice(12,15),[9,8,7]);c.setCoordinates({position:[12,11,10]});assert.equal(c.undoStack.length,2);const second=c.polyPivotMatrix.slice();c.undoStack[1].undo();assert.deepEqual(c.polyPivotMatrix,first);c.undoStack[0].undo();assert.equal(c.polyPivotMatrix,null);c.undoStack[0].redo();assert.deepEqual(c.polyPivotMatrix,first);c.undoStack[1].redo();assert.deepEqual(c.polyPivotMatrix,second);unchanged(mesh,geometry);
});
console.log(JSON.stringify({...report,pass:report.errors.length===0,localScope:'Non-world source alias uses the existing owner reference; UI has World/Object modes.'},null,2));if(report.errors.length)process.exitCode=1;
