import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareLinearPaths, LINEAR_LIMITS} from '../linear-paths.js';

let checks=0;
const check=(condition,message)=>{checks++;assert.ok(condition,message);};
const near=(a,b,tol=1e-9)=>check(Math.abs(a-b)<=tol,`${a} differs from ${b} (limit ${tol})`);
const pointNear=(a,b,tol=1e-9)=>{check(a.length===b.length);a.forEach((v,i)=>near(v,b[i],tol));};
const equal=(a,b)=>{checks++;assert.deepEqual(a,b);};
const rejects=(patch,code)=>{checks++;assert.throws(()=>prepareLinearPaths({...fixture(),...patch}),e=>e.code===code);};
const identity={origin:[0,0,0],xAxis:[1,0,0],zAxis:[0,0,1]};
const line={id:'line',closed:false,worldPoints:[[10,0,20],[40,0,60]]};
function fixture(){return {frame:structuredClone(identity),areaMm:[100,100],sources:[structuredClone(line)],mode:'Cut',passes:1,speedMmMin:600,lineWidthMm:.2};}
function localSource(id,closed,points){return {id,closed,worldPoints:points.map(([x,z])=>[x,0,z])};}
function evaluate(patch={}){return prepareLinearPaths({...fixture(),...patch});}
function geometricLength(operations){
  // Independent operation integration, not the module's path length helper.
  let sum=0;
  for(const op of operations) if(op.type==='work-line') {
    const dx=op.to[0]-op.from[0],dy=op.to[1]-op.from[1];
    sum+=Math.sqrt(dx*dx+dy*dy);
  }
  return sum;
}
function signedAreaFromOperations(ops){
  return ops.filter(o=>o.type==='work-line').reduce((a,o)=>a+o.from[0]*o.to[1]-o.to[0]*o.from[1],0)/2;
}

// A physical 3-4-5 segment: open Cut has precisely the authored centerline,
// independent of width, with no compensation, closure or lead arc.
const open=evaluate();
near(open.workLengthMm,50);
pointNear(open.paths[0].points[0],[10,20]);
pointNear(open.paths[0].points[1],[40,60]);
equal(open.intervals[0].operations.map(o=>o.type),['tool-on','work-line','tool-off']);
near(geometricLength(open.intervals[0].operations),50);
equal([open.scope,open.machineReady,open.travelPlanned],['work-intervals',false,false]);
equal(open.frame.headNormal,[0,-1,0]);
equal(evaluate({lineWidthMm:19}).paths,open.paths);

// Explicit repeat intervals preserve source direction. Each is off at its end;
// the required tool-off return travel is absent, never replaced with work.
const repeated=evaluate({passes:3});
equal(repeated.intervals.map(x=>x.pass),[1,2,3]);
near(repeated.workLengthMm,150);
equal(repeated.operationCount,9);
for(const interval of repeated.intervals){
  equal(interval.operations.map(o=>o.type),['tool-on','work-line','tool-off']);
  pointNear(interval.start,[10,20]);pointNear(interval.end,[40,60]);
  near(geometricLength(interval.operations),50);
}
const separated=evaluate({sources:[line,localSource('second',false,[[70,10],[80,10]])],passes:2});
equal(separated.intervals.map(x=>[x.sourceId,x.pass]),[['line',1],['line',2],['second',1],['second',2]]);
near(separated.workLengthMm,120);
check(separated.intervals.every(x=>x.operations.filter(o=>o.type==='work-line').length===1));

// General rigid transform. X=(.36,.48,-.8), Z=(-.8,.6,0), both
// unit/orthogonal; fixture world coordinates are direct analytic values.
const rotated=evaluate({frame:{origin:[200,-70,900],xAxis:[.36,.48,-.8],zAxis:[-.8,.6,0]},
  sources:[{id:'rotated',closed:false,worldPoints:[[187.6,-53.2,892],[166.4,-14.8,868]]}]});
pointNear(rotated.paths[0].points[0],[10,20]);
pointNear(rotated.paths[0].points[1],[40,60]);
near(rotated.workLengthMm,50);
near(geometricLength(rotated.intervals[0].operations),50);
pointNear(rotated.frame.headNormal,[.48,.64,.6]);
// A physically scaled native owner must pass physical dimensions and a rigid
// basis, not its scaled inverse. 2x X and 3x Z makes this 600/1200 mm segment.
const scaledPhysical=evaluate({frame:{origin:[100,200,300],xAxis:[0,0,-1],zAxis:[1,0,0]},areaMm:[2000,3000],
  sources:[{id:'physical-scale',closed:false,worldPoints:[[900,200,100],[2100,200,-500]]}]});
pointNear(scaledPhysical.paths[0].points[0],[200,800]);
pointNear(scaledPhysical.paths[0].points[1],[800,2000]);
near(scaledPhysical.workLengthMm,Math.sqrt(600**2+1200**2));
rejects({frame:{...identity,xAxis:[2,0,0]}},'CUT_LINEAR_FRAME');
rejects({frame:{...identity,zAxis:[.2,0,1]}},'CUT_LINEAR_FRAME');
rejects({frame:{...identity,xAxis:[0,0,0]}},'CUT_LINEAR_FRAME');

// Closed Mark preserves the seam, turns CW from the head side, and has the
// exact original rectangle perimeter/area. Both authored windings agree.
const ccw=[[10,10],[40,10],[40,30],[10,30]], cw=[ccw[0],...ccw.slice(1).reverse()];
for(const vertices of [ccw,cw]){
  const result=evaluate({mode:'Mark',passes:2,sources:[localSource('rect',true,vertices)],lineWidthMm:7});
  equal(result.lineWidthMm,7);equal(result.paths[0].winding,'CW');
  pointNear(result.paths[0].points[0],[10,10]);
  near(result.paths[0].lengthMm,100);near(result.paths[0].areaMm2,600);
  near(result.workLengthMm,200);
  for(const interval of result.intervals){
    near(geometricLength(interval.operations),100);
    near(signedAreaFromOperations(interval.operations),-600);
    equal(interval.operations.map(x=>x.type),['tool-on','work-line','work-line','work-line','work-line','tool-off']);
    pointNear(interval.start,interval.end);
  }
}
// Concave simple Mark, 3/4/5 triangle, and an extra straight vertex are legal.
const concave=evaluate({mode:'Mark',sources:[localSource('concave',true,[[10,10],[40,10],[40,20],[20,20],[20,40],[10,40]])]});
near(concave.paths[0].areaMm2,500);near(concave.workLengthMm,120);
const triangle=evaluate({mode:'Mark',sources:[localSource('triangle',true,[[10,10],[13,10],[13,14]])]});
near(triangle.paths[0].areaMm2,6);near(triangle.workLengthMm,12);
evaluate({mode:'Mark',sources:[localSource('straight',true,[[10,10],[20,10],[30,10],[30,20],[10,20]])]});checks++;
const markNarrow=evaluate({mode:'Mark',sources:[localSource('rect',true,ccw)],lineWidthMm:0});
const markWide=evaluate({mode:'Mark',sources:[localSource('rect',true,ccw)],lineWidthMm:20});
equal(markNarrow.paths,markWide.paths);equal(markNarrow.intervals,markWide.intervals);

// Bounds are a whole-source test: never clip closed geometry into a new cut.
evaluate({sources:[localSource('edge',false,[[0,0],[100,100]])]});checks++;
for(const vertices of [[[-1,10],[20,10],[20,20]],[[90,10],[110,10],[90,30]],[[110,110],[120,110],[120,120]]]){
  rejects({mode:'Mark',sources:[localSource('outside',true,vertices)]},'CUT_LINEAR_BOUNDS');
}
rejects({sources:[line,localSource('outside',false,[[1,1],[101,1]])]},'CUT_LINEAR_BOUNDS');
const slight=evaluate({planarityToleranceMm:1e-4,sources:[{...line,worldPoints:[[10,5e-5,20],[40,-5e-5,60]]}]});
near(slight.paths[0].maxPlanarityDeviationMm,5e-5);
rejects({sources:[{...line,worldPoints:[[10,0,20],[40,.001,60]]}]},'CUT_LINEAR_NONPLANAR');
rejects({planarityToleranceMm:1e-15},'CUT_LINEAR_PRECISION');
rejects({frame:{...identity,origin:[1e9,0,0]},sources:[{...line,worldPoints:[[1e9+10,0,20],[1e9+40,0,60]]}]},'CUT_LINEAR_INVALID');
rejects({frame:{...identity,origin:[1e8,0,0]},sources:[{...line,worldPoints:[[1e8+10,0,20],[1e8+40,0,60]]}]},'CUT_LINEAR_PRECISION');

for(const vertices of [
  [[10,10],[30,30],[10,30],[30,10]], // bow tie
  [[10,10],[30,10],[20,20],[20,10],[10,20]], // nonadjacent touch
  [[10,10],[30,10],[20,10],[20,30],[10,30]], // overlapping reversal
  [[10,10],[30,10],[5,10],[5,30],[10,30]], // reversal extends beyond previous vertex
  [[10,10],[20,10],[30,10]], // zero area
  [[10,10],[40,10],[40,30],[20,30],[20,10+5e-7],[10,30]] // unresolved near contact
]) rejects({mode:'Mark',sources:[localSource('invalid-topology',true,vertices)]},'CUT_LINEAR_TOPOLOGY');
for(const source of [localSource('zero',false,[[10,10],[10,10]]),localSource('tiny',false,[[10,10],[10.000001,10]]),localSource('repeat-end',true,[...ccw,ccw[0]])]){
  rejects({mode:'Mark',sources:[source]},'CUT_LINEAR_DEGENERATE');
}
for(const patch of [{avoid:[]},{noCut:[]},{regions:[{kind:'avoid'}]},{sources:[{...line,tags:['cut_no_cut']}]},{sources:[{...line,cubic:true}]},{leadInMm:1}]) rejects(patch,'CUT_LINEAR_UNSUPPORTED');
rejects({mode:'Cut',sources:[localSource('closed',true,ccw)]},'CUT_LINEAR_UNSUPPORTED');
for(const patch of [{sources:[]},{sources:[line,line]},{passes:0},{passes:1.5},{speedMmMin:0},{lineWidthMm:-1},{areaMm:[0,100]},{mode:'Laser'},
  {sources:[{...line,worldPoints:[[10,NaN,20],[40,0,60]]}]},{sources:[{...line,closed:undefined}]},
  {areaMm:Array(2)},{frame:{...identity,xAxis:Array(3)}},{sources:[{...line,worldPoints:[Array(3),[40,0,60]]}]},
  {sources:[{...line,worldPoints:Array(2)}]}]) rejects(patch,'CUT_LINEAR_INVALID');
rejects({passes:Number.MAX_SAFE_INTEGER},'CUT_LINEAR_BUDGET');
rejects({sources:Array.from({length:LINEAR_LIMITS.sources+1},(_,i)=>({...line,id:String(i)}))},'CUT_LINEAR_BUDGET');
rejects({mode:'Mark',sources:[localSource('big',true,Array.from({length:LINEAR_LIMITS.closedVertices+1},(_,i)=>[i,1]))]},'CUT_LINEAR_BUDGET');

const input=fixture(), before=structuredClone(input), snapshot=prepareLinearPaths(input);
equal(input,before);
input.sources[0].worldPoints[0][0]=99;input.frame.origin[0]=99;input.areaMm[0]=99;
pointNear(snapshot.paths[0].points[0],[10,20]);equal(snapshot.areaMm,[100,100]);
check(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.paths[0].points[0]) && Object.isFrozen(snapshot.intervals[0].operations[1]));

// Completed-operation latency, including validation, topology and immutable
// interval allocation. No browser, GPU, shared suite or scene-model extraction.
const benchmark=(name,input,iterations,limitMs)=>{
  const start=performance.now();let result;
  for(let i=0;i<iterations;i++) result=prepareLinearPaths(input);
  const ms=performance.now()-start;check(ms<limitMs,`${name}: ${ms}ms exceeds ${limitMs}ms`);
  return {name,iterations,ms,limitMs,points:result.paths.reduce((s,p)=>s+p.points.length,0),operations:result.operationCount,workLengthMm:result.workLengthMm};
};
const denseOpen=fixture();denseOpen.areaMm=[20000,100];denseOpen.passes=4;
denseOpen.sources=[localSource('16000-line',false,Array.from({length:16000},(_,i)=>[i+1,10]))];
const closed512=fixture();closed512.mode='Mark';closed512.passes=8;
closed512.sources=[localSource('512-circle-polygon',true,Array.from({length:512},(_,i)=>[50+40*Math.cos(i*2*Math.PI/512),50+40*Math.sin(i*2*Math.PI/512)]))];
const timings=[benchmark('16000-point open x4',denseOpen,3,2000),benchmark('512-vertex simple closed Mark x8',closed512,5,1500),benchmark('3-4-5 open segment',fixture(),1000,1000)];
const sources=['linear-paths.js','linear-geometry.js','tests/linear-paths.mjs'].map(path=>({path:`plugins/cut/${path}`,sha256:createHash('sha256').update(readFileSync(new URL(`../${path}`,import.meta.url))).digest('hex')}));
console.log(JSON.stringify({pass:true,checks,node:process.version,scope:'standalone CPU work intervals; no native capture, travel, swept-width safety, G-code or machine acceptance',sources,timings},null,2));
