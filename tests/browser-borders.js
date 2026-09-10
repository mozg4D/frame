// Run in an isolated app tab; resets that tab's scene.
async function testSplineBorders(){
 const a=frameAI,idle=()=>a.waitForIdle(30000),assert=(ok,msg)=>{if(!ok)throw Error(msg)},object=h=>a.getState().objects.find(o=>o.hash===h);
 a.resetScene();a.createPrimitive('cube','Border QA');const cube=a.toSplinePatch('Border QA');await idle();a.selectObjects([cube.object]);a.frame();
 const data=a.getSplineGenerator(cube.object).cage.data,borders=data.patchCells[0].edges;a.selectSplineElements({object:cube.child,segments:borders});
 const hits=a.getSplineSegmentScreens(cube.child,0).map(e=>a.getSplineHit({object:cube.child,view:0,x:e.screen[0],y:e.screen[1],vertices:false,handles:false}));assert(hits.some(Boolean)&&hits.some(h=>!h),'hidden edge picking');
 a.toggleSplineBorder();await idle();assert(object(cube.object).generatorReport.patchCells===5,'smaller region not removed');assert(!object(cube.object).generatorError,'border should not produce object error');
 a.undo();await idle();assert(object(cube.object).generatorReport.patchCells===6,'border undo');a.redo();await idle();assert(object(cube.object).generatorReport.patchCells===5,'border redo');
 await a.roundTripScene();await idle();assert(Object.values(a.getSplineGenerator(cube.object).cage.data.segments).filter(e=>e.boundary).length===4,'saved border lost');assert(a.getSplineGenerator(cube.object).params.autoBorder!==false,'default auto border lost on save');
 a.resetScene();const source=a.createSplineFixture('extrude-profile','Restore QA');for(const sid of Object.keys(source.topology.segments))a.splitSplineSegment(source.object,sid,.5);const patch=a.createSplineGenerator('spline_patch',[source.object]);await idle();
 assert(object(patch.object).generatorReport.patchCells===4,'regular quad did not restore');assert(a.getSplineGenerator(patch.object).cage.polylines.filter(p=>p.kind==='restored').length===4,'restored cage not displayed');
 a.resetScene();const q=a.createSplineFixture('extrude-profile','Irregular QA'),p=a.createSplineGenerator('spline_patch',[q.object]);await idle();a.selectSplineElements({object:q.object,vertices:['v4']});a.setSplineTestOptions({quantize:false,snapping:false});a.transformSplineElements({translate:[-180,-100,0]});await idle();assert(object(p.object).triangles===0&&!object(p.object).generatorError,'irregular cell must be ignored');a.setSplineGeneratorParams(p.object,{autoBorder:false});await idle();assert(object(p.object).triangles===2&&!object(p.object).generatorError,'auto border off must restore irregular fill');
 return {border:true,undoRedo:true,persistence:true,hiddenPicking:true,regularQuad:true,autoBorder:true};
}
