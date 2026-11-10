import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {validateLinearRegions,REGION_LIMITS} from '../linear-regions.js';

let checks=0;
const check=(v,message)=>{checks++;assert.ok(v,message);};
const equal=(a,b)=>{checks++;assert.deepEqual(a,b);};
const near=(a,b)=>check(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const region=(kind='No-cut',outer=rect(0,0,10,10),holes=[])=>({id:'region',kind,outer,holes});
const motion=(from,to,tool='Cut',lineWidthMm=0,id='motion')=>({id,type:'line',from,to,tool,lineWidthMm});
const run=(regions,motions)=>validateLinearRegions({regions,motions});
const rejects=(input,code)=>{checks++;assert.throws(()=>validateLinearRegions(input),e=>e.code===code && Object.isFrozen(e.details));};
const blocked=(regions,m,code='CUT_REGION_NO_CUT')=>{
  const result=run(regions,[m]);check(!result.valid);equal(result.diagnostics[0].code,code);return result.diagnostics[0];
};
const safe=(regions,m)=>{const result=run(regions,[m]);check(result.valid);equal(result.diagnostics,[]);return result;};
const nc=region(),av=region('Avoid');
for(const tool of ['Cut','Mark']) {
  // Crossings, total enclosure and endpoint disks are distinct analytic cases.
  blocked([nc],motion([-5,5],[15,5],tool));
  blocked([nc],motion([3,3],[7,7],tool));
  blocked([nc],motion([-4,5],[-1,5],tool,2));
  safe([nc],motion([-4,5],[-1.000002,5],tool,2));
  blocked([nc],motion([-4,-1],[14,-1],tool,2));
  safe([nc],motion([-4,-1.000002],[14,-1.000002],tool,2));
}
safe([nc],motion([-5,5],[15,5],'off',100));
for(const tool of ['off','Cut','Mark']) {
  blocked([av],motion([-5,5],[15,5],tool,0),'CUT_REGION_AVOID');
  blocked([av],motion([2,2],[3,3],tool,0),'CUT_REGION_AVOID');
  blocked([av],motion([-2,0],[0,0],tool,0),'CUT_REGION_AVOID');
  safe([av],motion([-1,2],[-1,8],tool,100)); // head reference only
}
const overlap=run([{...nc,id:'first-no-cut'},{...av,id:'second-avoid'}],[motion([-5,5],[15,5])]);
equal(overlap.diagnostics[0].regionId,'second-avoid');

// A donut hole is empty; its edge remains protected. Both windings are equal.
for(const reversed of [false,true]) {
  const outer=rect(-10,-10,10,10),hole=rect(-3,-3,3,3);
  const donut=region('No-cut',reversed?outer.reverse():outer,[reversed?hole.reverse():hole]);
  safe([donut],motion([-1,0],[1,0],'Cut',3.999996));
  blocked([donut],motion([-1,0],[1,0],'Cut',4));
  blocked([donut],motion([-5,0],[5,0]));
  blocked([donut],motion([-20,0],[20,0]));
  blocked([donut],motion([0,3],[0,3]));
  safe([{...donut,kind:'Avoid'}],motion([-2,0],[2,0],'off',100));
}
const concave=region('No-cut',[[0,0],[10,0],[10,2],[2,2],[2,10],[0,10]]);
safe([concave],motion([3,3],[9,9],'Cut',1.5)); // inside bbox, outside L
blocked([concave],motion([1,5],[5,1])); // continuous middle enters concave corner
blocked([concave],motion([1,3],[1,9])); // filled enclosure without crossing
const notch=region('No-cut',[[0,0],[10,0],[10,10],[6,10],[6,2],[4,2],[4,10],[0,10]]);
safe([notch],motion([5,3],[5,9],'Cut',1.999996));
blocked([notch],motion([5,3],[5,9],'Mark',2)); // narrow corridor tangent

// Diagonal distance to the physical vertex is sqrt(2), with no centerline hit.
const diag=motion([-2,0],[0,-2],'Cut',2*Math.SQRT2);
near(blocked([nc],diag).centerlineDistanceMm,Math.SQRT2);
safe([nc],{...diag,lineWidthMm:2*Math.SQRT2-4e-6});
// Diagonal polygon edge: y=x-1; separation from line y=x-3 is sqrt(2).
const triangle=region('No-cut',[[0,-1],[5,4],[0,4]]);
near(blocked([triangle],motion([1,-2],[4,1],'Cut',2*Math.SQRT2)).centerlineDistanceMm,Math.SQRT2);
safe([triangle],motion([1,-2],[4,1],'Cut',2*Math.SQRT2-4e-6));

// Explicit zero length lines mean occupancy/dwell at a point, with active end disk.
for(const tool of ['Cut','Mark']) {
  blocked([nc],motion([-1,5],[-1,5],tool,2));
  safe([nc],motion([-1.000002,5],[-1.000002,5],tool,2));
  blocked([nc],motion([5,5],[5,5],tool));
}
safe([nc],motion([5,5],[5,5],'off',10));
blocked([av],motion([5,5],[5,5],'off'),'CUT_REGION_AVOID');
blocked([nc],motion([-2,-5e-7],[12,-5e-7])); // tiny unresolved contact
safe([nc],motion([-2,-2e-6],[12,-2e-6]));
safe([],motion([-100,-100],[-100,-100])); // no implied work-area gate

// No-cut bridge width must include the disk radius at both restart endpoints.
const bridge=region('No-cut',rect(4,-1,6,1));
blocked([bridge],motion([0,0],[10,0],'Cut',2));
blocked([bridge],motion([0,0],[3,0],'Cut',2));
const bridgePass=[motion([0,0],[2.999998,0],'Cut',2,'before'),motion([2.999998,0],[7.000002,0],'off',2,'bridge'),motion([7.000002,0],[10,0],'Cut',2,'after')];
const repeated=run([bridge],Array.from({length:3},(_,pass)=>bridgePass.map(m=>({...m,id:`${m.id}-${pass}`}))).flat());
check(repeated.valid);equal(repeated.motions.length,9);
const badRepeated=run([bridge],[...bridgePass,motion([0,0],[10,0],'Mark',2,'bad-second-pass')]);
check(!badRepeated.valid);equal(badRepeated.diagnostics.map(d=>d.motionId),['bad-second-pass']);

// Independent Liang-Barsky physical rectangle reference, not polygon predicates.
function rectangleDistance(a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1];let enter=0,leave=1,hit=true;
  for(const [p,q] of [[-dx,a[0]],[dx,10-a[0]],[-dy,a[1]],[dy,10-a[1]]]) {
    if(p===0) {if(q<0)hit=false;continue;}
    const t=q/p;if(p<0)enter=Math.max(enter,t);else leave=Math.min(leave,t);
  }
  if(hit && enter<=leave)return 0;
  const endpoint=p=>Math.sqrt(Math.max(0,-p[0],p[0]-10)**2+Math.max(0,-p[1],p[1]-10)**2);
  let best=Math.min(endpoint(a),endpoint(b));
  for(const corner of [[0,0],[10,0],[10,10],[0,10]]) {
    const t=dx*dx+dy*dy?Math.min(1,Math.max(0,((corner[0]-a[0])*dx+(corner[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
    best=Math.min(best,Math.sqrt((corner[0]-a[0]-t*dx)**2+(corner[1]-a[1]-t*dy)**2));
  }
  return best;
}
let seed=892531;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<400;i++) {
  const a=[random()*40-15,random()*40-15],b=[random()*40-15,random()*40-15],radius=random()*4;
  const distance=rectangleDistance(a,b);
  equal(run([nc],[motion(a,b,'Cut',radius*2)]).valid,distance>radius+1e-6);
  equal(run([av],[motion(a,b,'off',radius*2)]).valid,distance>1e-6);
}

const fixture=()=>({regions:[region()],motions:[motion([-5,5],[15,5])]});
for(const outer of [[[0,0],[5,5],[0,5],[5,0]],[[0,0],[10,0],[5,0],[5,10],[0,10]],[[0,0],[1,0],[2,0]],[[0,0],[0,0],[5,5]]])
  rejects({regions:[region('Avoid',outer)],motions:fixture().motions},'CUT_REGION_TOPOLOGY');
for(const holes of [[rect(-1,1,2,2)],[rect(0,1,2,2)],[rect(2,2,4,4),rect(3,3,5,5)],[rect(2,2,4,4),rect(4,2,6,4)],[rect(1,1,8,8),rect(2,2,3,3)]])
  rejects({regions:[region('Avoid',rect(0,0,10,10),holes)],motions:fixture().motions},'CUT_REGION_TOPOLOGY');
safe([region('No-cut',rect(0,0,10,10),[rect(1,1,3,3),rect(6,6,8,8)])],motion([2,2],[2,2]));
for(const input of [
  {...fixture(),arc:true}, {...fixture(),motions:[{...fixture().motions[0],type:'arc'}]},
  {...fixture(),regions:[{...region(),enabled:false}]}, {...fixture(),motions:[{...fixture().motions[0],speed:10}]}
]) rejects(input,'CUT_REGION_UNSUPPORTED');
for(const input of [
  {...fixture(),regions:undefined},{...fixture(),motions:[]},{...fixture(),motions:Array(1)},
  {...fixture(),regions:Array(1)}, {...fixture(),motions:[{...fixture().motions[0],from:[NaN,0]}]},
  {...fixture(),regions:[{...region(),holes:undefined}]}, {...fixture(),motions:[{...fixture().motions[0],lineWidthMm:-1}]},
  {...fixture(),motions:[fixture().motions[0],{...fixture().motions[0],id:'malformed-suffix',tool:'unknown'}]},
  {...fixture(),motions:[fixture().motions[0],fixture().motions[0]]}, {...fixture(),regions:[region(),region()]},
  {...fixture(),regions:[{...region(),outer:Array(3)}]}
]) rejects(input,'CUT_REGION_INVALID');
rejects({...fixture(),motions:[motion([1e8,0],[0,0])]},'CUT_REGION_PRECISION');
rejects({...fixture(),motions:Array.from({length:REGION_LIMITS.motions+1},(_,i)=>motion([0,0],[1,1],'Cut',0,String(i)))},'CUT_REGION_BUDGET');
rejects({...fixture(),regions:[region('Avoid',Array.from({length:257},(_,i)=>[i,0]))]},'CUT_REGION_BUDGET');
rejects({...fixture(),regions:Array.from({length:65},(_,i)=>({...region(),id:String(i)}))},'CUT_REGION_BUDGET');
const circle=n=>Array.from({length:n},(_,i)=>[20+10*Math.cos(i*2*Math.PI/n),20+10*Math.sin(i*2*Math.PI/n)]);
rejects({regions:[region('Avoid',circle(256))],motions:Array.from({length:3000},(_,i)=>motion([-5,0],[-4,0],'off',0,String(i)))},'CUT_REGION_BUDGET');

const input=fixture(),before=structuredClone(input),snapshot=validateLinearRegions(input);
equal(input,before);input.regions[0].outer[0][0]=500;input.motions[0].from[0]=500;
equal(snapshot.regions[0].outer[0],[0,0]);equal(snapshot.motions[0].from,[-5,5]);
check(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.regions[0].outer[0]) && Object.isFrozen(snapshot.diagnostics[0]) && Object.isFrozen(snapshot.motions[0].to));
equal(snapshot.machineReady,false);equal(snapshot.scope,'linear-region-validation');

const benchmark=(name,input,iterations,limitMs)=>{
  const start=performance.now();let result;
  for(let i=0;i<iterations;i++) result=validateLinearRegions(input);
  const ms=performance.now()-start;check(ms<limitMs,`${name}: ${ms}ms > ${limitMs}ms`);
  return {name,iterations,ms,limitMs,...result.counts};
};
const dense={regions:[region('No-cut',circle(256))],motions:Array.from({length:2000},(_,i)=>motion([-10,i/100],[-5,i/100],'Cut',1,String(i)))};
const timings=[benchmark('256-edge region + 2000 continuous lines',dense,3,3000),benchmark('small enclosing obstacle',fixture(),1000,1000)];
const sources=['linear-regions.js','linear-geometry.js','tests/linear-regions.mjs'].map(path=>({path:`plugins/cut/${path}`,sha256:createHash('sha256').update(readFileSync(new URL(`../${path}`,import.meta.url))).digest('hex')}));
console.log(JSON.stringify({pass:true,checks,node:process.version,scope:'standalone CPU region-only linear validation; no source capture, routing, work-area, machine or runtime qualification',sources,timings},null,2));
