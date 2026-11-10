// Portable shared-suite CPU checks; no top-level IO or test execution.
import assert from 'node:assert/strict';
const section=(html,start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return html.slice(a,b);};
const line=(html,start)=>html.split('\n').find(value=>value.includes(start));
const tag=(mode='Solve',poses=[{id:'pose'}],extra={})=>({kind:'morph',params:{mode},poses,...extra});
const owner=(morph=null)=>({id:'owner',tags:morph?[morph]:[]});
function fixture(html,{nodes=[],sourceMap=new Map(),solveHook=null}={}){
  const state={nodes,sourceMap,solveHook,solves:[],errors:[]};
  const factory=Function('state',`
    const nodes=state.nodes,FrameSpline={sourceNode:n=>state.sourceMap.get(n)||null};
    ${line(html,'const tagOf=n=>')}
    let queue=Promise.resolve(),ikTask=null;const pendingIK=new Map();
    const fileOperationError=e=>state.errors.push(e);
    async function solve(owner,options){state.solves.push({owner,options});if(state.solveHook)await state.solveHook(owner,options);}
    ${section(html,'  function previewEdit(','  function afterEdit(')}
    return {call:previewEdit,pending:()=>[...pendingIK],flush:async()=>{while(ikTask){await queue;await Promise.resolve();}},state};
  `);
  return factory(state);
}
function splinePreview(html,n,native,selectionKeys){
  const state={n,native,selectionKeys,pointsCalls:0,componentCalls:0,fallback:0,refresh:0,request:0};
  const run=Function('state',`
    const add=(a,b)=>a.map((v,i)=>v+b[i]);
    ${section(html,'  function points(data) {','  function put(data, p) {')}
    const cells=()=>[];
    ${section(html,'  function componentEdges(data,keys)','  function sourceNode(')}
    const FrameSpline={componentVertices:(...args)=>{state.componentCalls++;return componentVertices(...args);}},
      FrameMorph={previewEdit:(...args)=>state.native.call(...args)},
      FrameMorphMath={points:data=>{state.pointsCalls++;return points(data);}},
      selection=()=>state.selectionKeys,liveVersions=new WeakMap(),liveChanges=new WeakMap(),states=new Map(),node=()=>null,
      window={frameEngine:{previewSplineData:()=>state.fallback++}},refresh=()=>state.refresh++,request=()=>state.request++;
    ${section(html,'  function preview(n,segments,vertices=[])','  function tangentBase(')}
    preview(state.n,new Set(['edge']),new Set(['a']));return state;
  `);
  return run(state);
}
const cage=()=>({vertices:{a:[1,2,3],b:[4,5,6]},segments:{edge:{a:'a',b:'b',ha:[1,0,0],hb:[-1,0,0]}},freeHandles:{a:{in:[0,1,0],out:[0,-1,0]}}});
function polygonCaller(html,native,n,keys=['0','other']){
  const text=line(html,'FrameMorph.previewEdit(t.morph.n,');assert(text);
  const start=text.indexOf('if(t.morph){'),end=text.indexOf('new Float32Array(data)',start);assert(end>start);
  const branch=text.slice(start,end),state={native,n,keys,pointCalls:0};
  Function('state',`
    const FrameMorph={previewEdit:(...args)=>state.native.call(...args)},FM={point:(matrix,p)=>{state.pointCalls++;return p.map((v,i)=>v+matrix[i]);}};
    const localMatrix=[10,20,30];for(const t of [{morph:{n:state.n,keys:state.keys,points:new Map([['0',[1,2,3]],['other',[4,5,6]]])}}]){${branch}}
  `)(state);
  return state;
}

export async function morphPreviewWorkChecks(currentHTML,legacyHTML){
 const draft=currentHTML,original=legacyHTML,tests=[],workcounts={};
 async function test(name,fn){await fn();tests.push({name,pass:true});}
await test('No Morph owner rejects before reader execution, pending work or errors',async()=>{
  const n=owner(),f=fixture(draft,{nodes:[n]});let reads=0;assert.equal(f.call(n,()=>{reads++;throw Error('must not read');}),false);await f.flush();assert.equal(reads,0);assert.equal(f.pending().length,0);assert.equal(f.state.solves.length,0);assert.equal(f.state.errors.length,0);
});
await test('Modelling, Edit and Solve with empty poses reject without reader',()=>{
  for(const t of [tag('Modelling'),tag('Edit'),tag('Solve',[])]){const n=owner(t),f=fixture(draft,{nodes:[n]});assert.equal(f.call(n,()=>{throw Error('rejected reader executed');}),false);assert.equal(f.pending().length,0);}
});
await test('Parent patch Morph resolves through original ownerOf and source relationship',async()=>{
  const n={id:'source',tags:[]},parent=owner(tag()),f=fixture(draft,{nodes:[n,parent],sourceMap:new Map([[parent,n]])});let reads=0;
  assert(f.call(n,()=>{reads++;return {keys:['a'],observed:{a:[1,2,3]}};}));assert.equal(reads,1);assert.equal(f.pending()[0][0],parent);await f.flush();assert.equal(f.state.solves[0].owner,parent);
});
await test('Admitted reader runs synchronously once before queue, preserving call-time snapshot',async()=>{
  const n=owner(tag()),f=fixture(draft,{nodes:[n]}),position=[1,2,3];let reads=0;
  assert(f.call(n,()=>{reads++;assert.equal(f.state.solves.length,0);return {keys:['a'],observed:{a:position.slice()}};}));assert.equal(reads,1);position[0]=99;await f.flush();assert.deepEqual(f.state.solves[0].options.observed.a,[1,2,3]);assert.equal(reads,1);
});
await test('Polygon logical IDs map keys and observations; unknown keys remain unchanged',async()=>{
  const n=owner(tag('Solve',[{}],{domain:'polygon',vertexIds:['logical-a','logical-b']})),f=fixture(draft,{nodes:[n]}),raw={keys:['0','1','other'],observed:{0:[1,2,3],1:[4,5,6],other:[7,8,9]}};
  assert(f.call(n,()=>raw));await f.flush();assert.deepEqual(f.state.solves[0].options,{keys:['logical-a','logical-b','other'],observed:{'logical-a':[1,2,3],'logical-b':[4,5,6],other:[7,8,9]}});assert.deepEqual(raw.keys,['0','1','other']);assert.equal(raw.observed['logical-a'],undefined);
});
await test('Latest pending observation coalesces per owner while distinct owners remain independent',async()=>{
  const a=owner(tag()),b={...owner(tag()),id:'b'},f=fixture(draft,{nodes:[a,b]});let reads=0;
  for(const [n,v]of [[a,1],[b,2],[a,3]])assert(f.call(n,()=>{reads++;return {keys:['a'],observed:{a:[v,0,0]}};}));assert.equal(reads,3);assert.equal(f.pending().length,2);await f.flush();assert.deepEqual(f.state.solves.map(s=>[s.owner.id,s.options.observed.a[0]]),[['owner',3],['b',2]]);
});
await test('Moves accepted during an in-flight solve are drained with latest synchronous snapshot',async()=>{
  const n=owner(tag());let unblock,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>unblock=r);let solves=0;
  const f=fixture(draft,{nodes:[n],solveHook:async()=>{if(++solves===1){started();await gate;}}});f.call(n,()=>({keys:['a'],observed:{a:[1,0,0]}}));await ready;f.call(n,()=>({keys:['a'],observed:{a:[2,0,0]}}));f.call(n,()=>({keys:['a'],observed:{a:[3,0,0]}}));unblock();await f.flush();assert.deepEqual(f.state.solves.map(s=>s.options.observed.a[0]),[1,3]);
});
await test('Reader errors preserve identity, do not enqueue work and allow next valid preview',async()=>{
  const n=owner(tag()),f=fixture(draft,{nodes:[n]}),expected=Error('reader failed');assert.throws(()=>f.call(n,()=>{throw expected;}),e=>e===expected);assert.equal(f.pending().length,0);assert.equal(f.state.errors.length,0);assert(f.call(n,()=>({keys:['a'],observed:{a:[4,0,0]}})));await f.flush();assert.equal(f.state.solves.length,1);
});
await test('Solve failure retains existing error reporting and later previews can restart',async()=>{
  const n=owner(tag()),expected=Error('solve failed');let attempt=0;const f=fixture(draft,{nodes:[n],solveHook:()=>{if(++attempt===1)throw expected;}});f.call(n,()=>({keys:['a'],observed:{a:[1,0,0]}}));await f.flush();assert.equal(f.state.errors[0],expected);f.call(n,()=>({keys:['a'],observed:{a:[2,0,0]}}));await f.flush();assert.equal(f.state.solves.length,2);
});
await test('Actual spline caller avoids all rejected Morph map/key construction; old source negative control does not',async()=>{
  const n={...owner(),splineData:cage()},f=fixture(draft,{nodes:[n]}),before=fixture(original,{nodes:[n]}),keys=new Set(['a','h:edge:ha','free:a:in']);
  const next=splinePreview(draft,n,f,keys),old=splinePreview(original,n,before,keys);workcounts.rejectedSpline={current:{pointMaps:next.pointsCalls,componentPlans:next.componentCalls},legacy:{pointMaps:old.pointsCalls,componentPlans:old.componentCalls}};assert.equal(next.pointsCalls,0);assert.equal(next.componentCalls,0);assert.equal(old.pointsCalls,1);assert.equal(old.componentCalls,1);assert.equal(next.fallback,old.fallback);assert.equal(next.refresh,old.refresh);assert.equal(next.request,old.request);await f.flush();assert.equal(f.state.solves.length,0);
});
await test('Actual admitted spline reader keeps original selected vertex/handle/free-handle keys and full points',async()=>{
  const n={...owner(tag()),splineData:cage()},f=fixture(draft,{nodes:[n]}),before=fixture(original,{nodes:[n]}),keys=new Set(['edge','h:edge:ha','free:a:in']);
  const next=splinePreview(draft,n,f,keys),old=splinePreview(original,n,before,keys);assert.equal(next.pointsCalls,1);assert.equal(next.componentCalls,1);assert.equal(next.fallback,0);await f.flush();await before.flush();assert.deepEqual(f.state.solves[0].options,before.state.solves[0].options);assert.deepEqual(f.state.solves[0].options.keys,['a','b','h:edge:ha','f:a:in']);assert.equal(old.fallback,0);
});
await test('Actual polygon transform caller constructs no transformed map before rejection',async()=>{
  const n=owner(tag('Edit',[{}],{domain:'polygon',vertexIds:['logical-a']})),f=fixture(draft,{nodes:[n]});const next=polygonCaller(draft,f,n);workcounts.rejectedPolygon={transformedPoints:next.pointCalls};assert.equal(next.pointCalls,0);await f.flush();assert.equal(f.state.solves.length,0);
});
await test('Actual polygon transform reader remains synchronous and preserves native logical-ID output',async()=>{
  const n=owner(tag('Solve',[{}],{domain:'polygon',vertexIds:['logical-a']})),f=fixture(draft,{nodes:[n]}),before=fixture(original,{nodes:[n]});const next=polygonCaller(draft,f,n),old=polygonCaller(original,before,n);assert.equal(next.pointCalls,2);assert.equal(old.pointCalls,2);await f.flush();await before.flush();assert.deepEqual(f.state.solves[0].options,before.state.solves[0].options);assert.deepEqual(f.state.solves[0].options.observed,{'logical-a':[11,22,33],other:[14,25,36]});
});

 return {pass:true,checks:tests,workcounts};
}
