import {makeFixture,geometrySnapshot,unchanged,near,desiredFrame,orderedPositions,sourceHash,exactV4jHash,T,assert} from './v4j-pivot-support.mjs';

const report={scope:'Exact-source CPU/VM CM pivot bug reproduction and repair contracts. Not browser, GPU, or acceptance evidence.',sourceHash,knownV4j:sourceHash===exactV4jHash,passed:[],reproduced:[],unexpected:[]};
function check(name,fn,{knownGap=false}={}){try{const detail=fn();report.passed.push({name,...detail});if(knownGap&&report.knownV4j)report.unexpected.push({name,error:'Expected exact-v4j defect was not reproduced'});}catch(e){(knownGap?report.reproduced:report.unexpected).push({name,error:e.message});}}
const world=new T.Matrix4().compose(new T.Vector3(7,-5,11),new T.Quaternion().setFromEuler(new T.Euler(.31,-.42,.58)),new T.Vector3(2,.5,3));
const custom=new T.Matrix4().makeRotationFromEuler(new T.Euler(.22,.16,-.35)).setPosition(9,4,-3);

for(const space of ['world','object'])for(const [ch,i,value]of [['pos',0,17],['rot',1,37],['size',0,8]]){
  check(`pivot-${space}-${ch}: preserve geometry bytes, identities, versions`,()=>{
    const {c,mesh}=makeFixture({space,editPivot:true,world,pivot:custom}),before=geometrySnapshot(mesh);
    c.applyInput(ch,i,value);unchanged(mesh,before);
  },{knownGap:true});
  check(`pivot-${space}-${ch}: stored frame formula`,()=>{
    const {c}=makeFixture({space,editPivot:true,world,pivot:custom}),initial=c.polyPivotMatrix.slice(),initialGizmo=c.getGizmoWorldArray(),expected=desiredFrame(c,ch,i,value);
    c.applyInput(ch,i,value);near(c.polyPivotMatrix,ch==='size'?initial:expected.final.elements,'stored pivot');near(c.getGizmoWorldArray(),ch==='size'?initialGizmo:expected.final.elements,'gizmo');
  });
  check(`normal-CM-${space}-${ch}: ordered geometry transform remains enabled`,()=>{
    const {c,mesh,log}=makeFixture({space,editPivot:false,world,pivot:custom}),ids=[...c.polySelectedVertexIds('h')],before=geometrySnapshot(mesh),expected=desiredFrame(c,ch,i,value);
    c.applyInput(ch,i,value);assert.equal(log.delta,1);near(mesh.geometry.attributes.position.array,orderedPositions(before.positions,ids,world,expected.delta),'ordered positions',1e-6);assert.deepEqual(mesh.geometry.index.array,before.indices);near(c.polyPivotMatrix,expected.final.elements,'stored pivot');
  });
}
check('pivot shared-index CM: topology preparation must not run',()=>{
  const {c,mesh,log}=makeFixture({shared:true}),before=geometrySnapshot(mesh);c.applyInput('pos',0,6);
  assert.equal(log.prepare,0,'capturePolySelection must not call preparePolygonDragTopology');unchanged(mesh,before);
},{knownGap:true});
if(report.knownV4j)check('exact-v4j shared-index mutation reproduction: 4 vertices become 6 corners',()=>{
  const {c,mesh,log}=makeFixture({shared:true});c.applyInput('pos',0,6);assert.equal(log.prepare,1);assert.equal(log.replace,1);assert.equal(mesh.geometry.attributes.position.count,6);
  return {positionCountAfter:6,indexAfter:Array.from(mesh.geometry.index.array)};
});
check('pivot-only commit: no crease rebuild and exactly one Undo command',()=>{
  const {c,log}=makeFixture(),before=c.coordinateSnapshot();const after=c.polyFrameMatrix().setPosition(4,5,6);c.polyPivotMatrix=after.elements.slice();c.setGizmoFromMatrix(after.elements);c.commitCoordinateSnapshot(before);
  assert.equal(log.crease,0,'pivot commit must not rebuild crease geometry');assert.equal(c.undoStack.length,1,'pivot-only commit must be recorded');
},{knownGap:true});
check('pivot-only change detection: geometry-only comparison drops Undo',()=>{
  const {c}=makeFixture(),before=c.coordinateSnapshot();c.polyPivotMatrix=c.polyFrameMatrix().setPosition(4,5,6).elements.slice();c.commitCoordinateSnapshot(before);assert.equal(c.undoStack.length,1,'pivot-only change was not recorded');
},{knownGap:true});
check('pivot CM commit, Undo and Redo: pivot roundtrip, geometry untouched',()=>{
  const {c,mesh}=makeFixture({space:'object',pivot:custom}),geometry=geometrySnapshot(mesh),before=c.coordinateSnapshot(),initial=c.polyPivotMatrix.slice();
  const after=c.polyFrameMatrix().setPosition(4,5,6);c.polyPivotMatrix=after.elements.slice();c.setGizmoFromMatrix(after.elements);c.commitCoordinateSnapshot(before);
  assert.equal(c.undoStack.length,1,'pivot Undo command missing');const cmd=c.undoStack[0];unchanged(mesh,geometry);cmd.undo();near(c.polyPivotMatrix,initial,'Undo pivot');unchanged(mesh,geometry);cmd.redo();near(c.polyPivotMatrix,after.elements,'Redo pivot');unchanged(mesh,geometry);
},{knownGap:true});
check('pivot-only revert: restore frame without replacing geometry',()=>{
  const {c,mesh}=makeFixture(),geometry=geometrySnapshot(mesh),before=c.coordinateSnapshot();c.polyPivotMatrix=c.polyFrameMatrix().setPosition(4,5,6).elements.slice();c.revertCoordinateSnapshot(before);unchanged(mesh,geometry);assert.equal(c.polyPivotMatrix,null);
},{knownGap:true});
check('API setCoordinates pivot: same history path as CM',()=>{
  const {c,mesh}=makeFixture(),geometry=geometrySnapshot(mesh);c.setCoordinates({position:[9,8,7]});assert.equal(c.undoStack.length,1,'API bypassed coordinate commit');const after=c.polyPivotMatrix.slice(),cmd=c.undoStack[0];unchanged(mesh,geometry);cmd.undo();assert.equal(c.polyPivotMatrix,null,'Undo must recover automatic pivot');unchanged(mesh,geometry);cmd.redo();near(c.polyPivotMatrix,after,'API Redo pivot');unchanged(mesh,geometry);
},{knownGap:true});
check('world/object frame display contract remains distinct from stored pivot',()=>{
  const {c}=makeFixture({space:'world',pivot:custom});near(c.polyFrameMatrix().elements,new T.Matrix4().setPosition(9,4,-3).elements,'world axes');c.coordMode='object';near(c.polyFrameMatrix().elements,custom.elements,'custom object axes');
});
check('object/local component reference strips owner scale',()=>{
  const {c}=makeFixture({space:'object',world});const ref=c.polyCoordReference('object');near(new T.Vector3().setFromMatrixPosition(ref).toArray(),[7,-5,11]);for(let k=0;k<3;k++)assert(Math.abs(new T.Vector3().fromArray(ref.elements,k*4).length()-1)<1e-12);assert.equal(ref.determinant()>0,true);
});
for(const editPivot of [false,true])for(const ch of ['pos','rot'])check(`ordinary-object-${ch}, editPivot=${editPivot}: polygon branch not entered`,()=>{
  const {c,log}=makeFixture({space:'world',editPivot});c.polyMode=false;const original=c.getGizmoWorldArray();let emissions=0;c.emitTransform=()=>{emissions++;assert.equal(c.coordinateBridgeOperation,ch);};c.applyPolyCoordinateInput=()=>assert.fail('ordinary object entered polygon branch');c.applyInput(ch,0,ch==='pos'?13:25);assert.equal(emissions,1);assert.equal(log.delta,0);assert.equal(c.coordinateBridgeOperation,null);if(ch==='pos')assert.equal(c.getGizmoWorldArray()[12],13);else assert.notDeepEqual(c.getGizmoWorldArray(),original);
});

// --acceptance treats any reproduced gap as a failed repair contract. The default
// run is explicitly a negative reproduction and succeeds only on expected results.
console.log(JSON.stringify(report,null,2));
if(report.unexpected.length||(process.argv.includes('--acceptance')&&report.reproduced.length))process.exitCode=1;
