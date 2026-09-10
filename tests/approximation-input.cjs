// Run the actual attribute callbacks and async publication function in isolation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const params=new Map([['s',{__type:'spline',angle:10}]]),data=new Map([['s',{approximation:{angle:10},segments:{e:{approximation:{angle:10}}}}]]),commands=[],fields=[];
let notifications=0;
class Input{constructor(){this.events={};this.value='';}addEventListener(k,f){this.events[k]=f;}fire(k,extra={}){this.events[k]?.({preventDefault(){},stopPropagation(){},...extra});}blur(){this.fire('blur');}contains(x){return x===this;}setSelectionRange(){} }
const c=vm.createContext({objParams:params,splineData:data,PARAMETRIC_SPLINE_TYPES:new Set(),THREE2:{MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}},pushCmd:c=>commands.push(c),syncParametricObject:()=>false,refreshAttributesPanel(){},scheduleGeneratorEvaluation(){notifications++;},attrContent:{},attrRow:()=>({}),O_SPLINE_ANG:{sens:4,min:1,max:180,prec:0},addEventListener(){},document:{body:{style:{}}},_scrubActive:null,_scrubSession:null});
c.updateSplineVisual=h=>{c.splineApproximation(h);notifications++;};
c.attrInput=(ctrl,o)=>{const inp=new Input();fields.push(inp);c.makeScrubInput(inp,o);return inp;};
vm.runInContext(section('function cloneP(','function attrRow(')+section('function san(','var _scrubActive')+section('function makeScrubInput(','function attrInput(')+section('function splineApproximation(','function splineBevelTags(')+section('function renderSpline(h)','function renderSplinePatch('),c);
c.renderSpline('s');const input=fields[0],original=params.get('s');
function type(angle){input.fire('focus');input.value=String(angle);input.fire('input');input.blur();assert.equal(params.get('s').angle,angle);assert.equal(data.get('s').approximation.angle,angle);assert.equal(data.get('s').segments.e.approximation.angle,angle);}
type(2);commands.at(-1).undo();assert.equal(data.get('s').approximation.angle,10,'undo must update spline sampling');assert.equal(params.get('s'),original,'undo detached the live field');commands.at(-1).redo();assert.equal(data.get('s').approximation.angle,2);
// Other commands may replace the parameter record; an already mounted field must follow it.
params.set('s',{__type:'spline',angle:2});for(const angle of [1,2,1,3,2,1])type(angle);
input.fire('focus');input.value='8';input.fire('input');input.fire('keydown',{key:'Escape'});assert.equal(data.get('s').approximation.angle,1,'Escape must restore sampling, not only field text');assert.equal(fields.length,1,'test must never reselect/remount');assert(notifications>10);
console.log('PASS mounted angle field: repeated 1/2 edits, replaced params, undo/redo and Escape update spline + segment sampling without reselection.');
(async()=>{
 const state={},nodes=new Map([['g',{enabled:true,children:['s']}],['s',{enabled:true}]]),source={approximation:{angle:1},segments:{}},pending=[],installed=[];
 const identity={clone(){return this;},invert(){return this;},multiply(){return this;}};
 const x=vm.createContext({OBJ:nodes,ensureReplicaState:()=>state,splineData:new Map([['s',source]]),syncMeshParents(){},cloneSplineData:structuredClone,evaluatedSplineData:()=>source,worldMatrix:()=>identity,transformWholeSplineData(){},objParams:new Map([['g',{autoBorder:true}]]),gizDrag:null,clearTimeout,setTimeout,scheduleGeneratorEvaluation(){},buildSplineSurfaceAsync:d=>new Promise(resolve=>pending.push({angle:d.approximation.angle,resolve})),installGeneratedSplineCage(){},installSplineChunks:(h,s,surface)=>installed.push(surface.report.angle),scheduleSplineRefinement(){},setReplicaError:(h,s,message)=>{throw Error(message);}});
 vm.runInContext(section('async function evaluateSplinePatchNode(','function cmdAddSplineObject('),x);
 const flush=()=>new Promise(resolve=>setImmediate(resolve)),finish=job=>job.resolve({cellCache:new Map(),report:{angle:job.angle},cells:[],uv:[],refinement:{builtCells:[]}});
 const first=x.evaluateSplinePatchNode('g');await flush();assert.equal(pending.length,1);
 source.approximation.angle=2;const second=x.evaluateSplinePatchNode('g');finish(pending[0]);await first;await flush();assert.deepEqual(installed,[],'obsolete angle was published');assert.equal(pending.length,2);assert(state.pending);
 finish(pending[1]);await second;assert.deepEqual(installed,[2]);assert.equal(state.report.displayAngle,2);assert.equal(state.pending,false);
 console.log('PASS delayed worker result: obsolete 1-degree snapshot is not published over a newer 2-degree request.');
})().catch(e=>{console.error(e);process.exitCode=1;});
