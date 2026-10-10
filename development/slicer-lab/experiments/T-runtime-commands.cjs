'use strict';
// Independent lab consumer. It constructs fill primitives from executable
// strokes and join styles; proposal polygons/certification flags are ignored.
// The production Frame consumer and its worker service are not modified here.
const R=require('../core/rational.cjs'),{load}=require('../core/adapter.cjs');
const {hull}=require('../core/trajectory-union-accuracy.cjs'),{hash}=require('../core/mesh-section.cjs');
const {auditPhysicalPrintLoop}=require('../core/physical-path-direction.cjs');
const {dense}=require('./T-dense-input.cjs'),compiledBuffers=new WeakMap();
const same=(a,b)=>a.every((v,k)=>v===b[k]),add=(a,b)=>a.map((v,k)=>R.add(v,b[k])),scale=(a,t)=>a.map(v=>R.mul(v,t));
const frozen=q=>{if(q&&typeof q==='object'&&!Object.isFrozen(q)){Object.values(q).forEach(frozen);Object.freeze(q);}return q;},runtimeHash=q=>{const{bufferSignature,...data}=q;return hash(data);};
const point=p=>{dense(p,{min:2,max:2,name:'runtime point'});if(p.some(v=>!Number.isFinite(v)))throw Error('finite 2D runtime point required');return p.slice();};
function exact(x){if(typeof x!=='string'||x.length>625||! /^-?\d+\/\d+$/.test(x))throw Error('bounded runtime rational required');const[n,d]=x.split('/').map(BigInt);if(d<=0n||n.toString(2).replace('-','').length>1024||d.toString(2).length>1024)throw Error('runtime raw rational representation budget');const q=R.rat(n,d);
 if(q.n.toString(2).replace('-','').length>1024||q.d.toString(2).length>1024)throw Error('runtime rational representation budget');return q;}
function sourceIntervals(q){dense(q,{min:1,max:4096,name:'runtime source intervals'});q.forEach(s=>{if(!s||!Number.isSafeInteger(s.ring)||s.ring<0||!Number.isSafeInteger(s.edge)||s.edge<0||s.edge>4095)throw Error('finite runtime source interval required');point(s.sourceStart);point(s.sourceEnd);for(const value of [s.exactU0,s.exactU1]){const t=exact(value);if(t.n<0n||R.cmp(t,R.one)>0)throw Error('bounded runtime source parameter required');}});}
function compileTExecution(allocation,{signal,allowBoundedHalfWClosureConversion=false}={}){
 if(typeof allowBoundedHalfWClosureConversion!=='boolean')throw Error('bounded closure conversion policy required');
 if(signal?.aborted)throw Error('T runtime cancelled');
 const W=allocation?.W,raw=allocation?.commands,courses=allocation?.plan?.courses,styles=allocation?.cornerJoins;
 if(!(W>0)||!Number.isFinite(W)||!Array.isArray(raw)||raw.length<1||raw.length>2048||!Array.isArray(courses)||courses.length>64||
  !Array.isArray(styles)||styles.length>256)throw Error('bounded T runtime input required');
 dense(raw,{min:1,max:2048,name:'runtime commands'});dense(courses,{min:1,max:64,name:'runtime courses'});dense(styles,{max:256,name:'runtime turn styles'});
 const w=R.exact(W),commands=raw.map(q=>{if(q.kind!=='print'||!Number.isSafeInteger(q.component)||q.component<0||!Number.isSafeInteger(q.depth)||q.depth<0||
   ![q.widthStart,q.widthEnd].every(v=>Number.isFinite(v)&&R.cmp(R.exact(v),R.mul(w,R.rat(3n,5n)))>=0&&R.cmp(R.exact(v),R.mul(w,R.rat(8n,5n)))<=0))throw Error('invalid T runtime stroke');
  const from=point(q.from),to=point(q.to);if(same(from,to))throw Error('zero T runtime stroke');
  sourceIntervals(q.sourceIntervals);
  return{kind:'print',from,to,widthStart:q.widthStart,widthEnd:q.widthEnd,component:q.component,depth:q.depth,role:q.role,
   flatFrontBlend:q.flatFrontBlend===true,sourceIntervals:structuredClone(q.sourceIntervals)};});
 const c=load('optimized-worker.js').context,quads=commands.map(q=>c.frameThroughNeckRibbon(q.from,q.to,q.widthStart,q.widthEnd)),rounds=[],bevels=[],joinIds=new Set(),states=[],loops=[];
 let cursor=0,previous=null;
 for(let index=0;index<courses.length;index++){
  const course=courses[index],a=course.startCommand,b=course.endCommand;
  const depthTo=course.depthTo??course.depth;
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a!==cursor||b<=a||b>commands.length||course.component!==index||!Number.isSafeInteger(course.depth)||!Number.isSafeInteger(depthTo)||depthTo<course.depth||depthTo>64||commands[a].depth!==course.depth||commands[b-1].depth!==depthTo||
   commands.slice(a,b).some(q=>q.component!==index||q.depth<course.depth||q.depth>depthTo))throw Error('runtime course partition mismatch');
  if(previous){if(course.depth<previous.depth)throw Error('runtime outside-in order');states.push({kind:'travel',from:previous.to,to:commands[a].from,beforeDepth:course.depth,extruding:false});}
  states.push({kind:'start-course',component:index,depth:course.depth,at:commands[a].from,width:W,nozzleWidth:W,
   capStyle:'flat',stationaryFeed:false,sourceIntervals:commands[a].sourceIntervals});
  if(commands[a].widthStart!==W||commands[a].widthEnd!==W)throw Error('runtime independent start must use W');
  for(let i=a;i<b;i++){
   const q=commands[i];if(signal?.aborted)throw Error('T runtime cancelled');
   if(i>a&&(!same(q.from,commands[i-1].to)||q.widthStart!==commands[i-1].widthEnd))throw Error('runtime disconnected stroke or width step');
   if(i&&q.depth<commands[i-1].depth)throw Error('runtime outside-in order');
   states.push({kind:'stroke',command:i,extruding:true});
  }
  if(course.closed){const q=commands[b-1],d=R.vec(q.to.map(R.exact),q.from.map(R.exact));
   const h=R.div(w,R.rat(2n)),short=R.sub(h,R.div(w,R.rat(1n<<28n))),length2=R.dot(d,d),closureLength=allowBoundedHalfWClosureConversion?R.cmp(length2,R.mul(short,short))>=0&&R.cmp(length2,R.mul(h,h))<=0:R.cmp(length2,R.mul(h,h))===0;
   if(b-a<4||q.role!=='source-owned-half-W-closure'||!same(q.from,commands[a].from)||
    !closureLength||q.widthStart!==W||q.widthEnd!==W)throw Error('runtime unbound half-W closure');
   const direction=auditPhysicalPrintLoop(commands.slice(a,b-1));if(!direction.clockwise)throw Error('runtime nonclockwise closed T lap');loops.push({component:index,...direction});
  }
  states.push({kind:'stop-course',component:index,at:commands[b-1].to,width:commands[b-1].widthEnd,capStyle:'flat',stationaryFeed:false});
  cursor=b;previous=commands[b-1];
 }
 if(cursor!==commands.length)throw Error('runtime unowned remaining commands');
 for(const q of styles){
  const i=q.afterCommand;if(!Number.isSafeInteger(i)||i<0||i+1>=commands.length||joinIds.has(i))throw Error('runtime turn ownership');
  dense(q.exactCentre,{min:2,max:2,name:'runtime exact centre'});dense(q.exactBasis,{min:2,max:2,name:'runtime exact basis'});q.exactBasis.forEach(p=>dense(p,{min:2,max:2,name:'runtime basis point'}));sourceIntervals(q.sourceIntervals);
  const a=commands[i],b=commands[i+1],centre=q.exactCentre.map(exact),basis=q.exactBasis.map(p=>p.map(exact)),r=exact(q.exactRadius);
  if(centre?.length!==2||basis?.length!==2||basis.some(p=>p.length!==2||R.cmp(R.dot(p,p),R.one)!==0)||R.dot(...basis).n!==0n||
   a.component!==b.component||!same(a.to,b.from)||centre.some((v,k)=>R.cmp(v,R.exact(a.to[k]))!==0)||r.n<=0n||
   R.cmp(R.mul(r,R.rat(2n)),R.mul(w,R.rat(8n,5n)))>0)throw Error('runtime source turn geometry');
  // Tiny finite working-width corrections are included in the source
  // construction budget. A caller cannot attach an unrelated large disk.
  const width=R.mul(r,R.rat(2n)),error=R.sub(width,R.exact(a.widthEnd));
  if(R.cmp(error,R.div(w,R.rat(1n<<29n)))>0||R.cmp(error,R.div(R.sub(R.zero,w),R.rat(1n<<29n)))<0)throw Error('runtime turn radius inconsistent with stroke width');
  const radius=R.sub(r,R.div(r,R.rat(1n<<32n))),polygon=[centre.map(R.number)];
  for(let j=0;j<=8;j++){const t=R.rat(BigInt(j),8n),den=R.add(R.one,R.mul(t,t)),x=R.div(R.sub(R.one,R.mul(t,t)),den),y=R.div(R.mul(R.rat(2n),t),den);
   polygon.push(add(centre,scale(add(scale(basis[0],x),scale(basis[1],y)),radius)).map(R.number));}
  rounds.push({kind:'round',afterCommand:i,component:a.component,polygon,sourceIntervals:structuredClone(q.sourceIntervals),extraPrintCommands:0});joinIds.add(i);
 }
 for(let i=0;i+1<commands.length;i++){
  const a=commands[i],b=commands[i+1];if(a.component!==b.component||joinIds.has(i)||!(a.flatFrontBlend||b.flatFrontBlend))continue;
  const turn=R.cross(R.vec(a.to.map(R.exact),a.from.map(R.exact)),R.vec(b.to.map(R.exact),b.from.map(R.exact)));if(!turn.n)continue;
  const side=turn.n>0n?-1:1,polygon=hull([a.to,quads[i][side>0?1:2],quads[i+1][side>0?0:3]].map(p=>p.map(R.exact))).map(p=>p.map(R.number));
  if(polygon.length>2)bevels.push({kind:'bevel',afterCommand:i,component:a.component,polygon,sourceIntervals:structuredClone(a.sourceIntervals.concat(b.sourceIntervals)),extraPrintCommands:0});
 }
 const cells=quads.map((polygon,command)=>({kind:'ribbon',command,polygon,component:commands[command].component,depth:commands[command].depth,sourceIntervals:commands[command].sourceIntervals}))
  .concat(rounds.concat(bevels).map(q=>({...q,command:q.afterCommand,depth:commands[q.afterCommand].depth})));
 const triangles=cells.flatMap((q,cell)=>Array.from({length:q.polygon.length-2},(_,i)=>({cell,points:[q.polygon[0],q.polygon[i+1],q.polygon[i+2]]})));
 const joins=new Map();for(const q of rounds.concat(bevels)){if(!joins.has(q.afterCommand))joins.set(q.afterCommand,[]);joins.get(q.afterCommand).push(q.kind);}
 const execution=states.flatMap(q=>q.kind==='stroke'?[q,...(joins.get(q.command)??[]).map(kind=>({kind:'continuous-turn',afterCommand:q.command,style:kind,extruding:false,extraPrintCommands:0}))]:[q]);
 execution.push({kind:'finish-layer',printCommands:commands.length,stationaryFeed:false});
 const runtime={kind:'compiled-independent-T-runtime',W,commands,cells,triangles,rounds:rounds.length,bevels:bevels.length,execution,physicalLoops:loops,
  bufferSignature:hash({commands,cells,triangles,execution}),fixedNominalNozzleWidth:W,productionConsumerModified:false,
  startEndSemantics:'flat feed cross-sections; no independent stationary disk dose, no additional turn move; physical flow/volume deferred'};
 runtime.bufferSignature=runtimeHash(runtime);compiledBuffers.set(runtime,{signature:runtime.bufferSignature,allocationSignature:hash(allocation)});return frozen(runtime);
}
function assertOwnedTExecution(runtime,allocation){const owned=compiledBuffers.get(runtime);
 if(runtime?.kind!=='compiled-independent-T-runtime'||owned?.signature!==runtime.bufferSignature||runtimeHash(runtime)!==runtime.bufferSignature)throw Error('changed T runtime buffer or unowned compilation');
 if(allocation&&owned.allocationSignature!==hash(allocation))throw Error('changed allocation of owned T runtime');
}
function replayTExecution(runtime,{generation,expectedGeneration=generation,readGeneration,signal,onEvent}={}){
 assertOwnedTExecution(runtime);
 const current=()=>readGeneration?readGeneration():generation;
 if(current()!==expectedGeneration||signal?.aborted)throw Error('T runtime cancelled or invalidated');
 let active=null,prints=0,turns=0,travels=0,finished=false;
 for(const event of runtime.execution){if(signal?.aborted||current()!==expectedGeneration)throw Error('T runtime cancelled or invalidated');
  if(event.kind==='start-course'){if(active!==null||finished)throw Error('runtime duplicate start');active=event.component;}
  else if(event.kind==='stroke'){if(active!==runtime.commands[event.command]?.component||event.extruding!==true)throw Error('runtime stroke outside active course');prints++;}
  else if(event.kind==='continuous-turn'){if(active!==runtime.commands[event.afterCommand]?.component||event.extraPrintCommands!==0)throw Error('runtime turn outside active course');turns++;}
  else if(event.kind==='stop-course'){if(active!==event.component)throw Error('runtime stop without start');active=null;}
  else if(event.kind==='travel'){if(active!==null||event.extruding!==false)throw Error('runtime extruding travel');travels++;}
  else if(event.kind==='finish-layer'){if(active!==null||prints!==runtime.commands.length)throw Error('runtime incomplete layer');finished=true;}
  else throw Error('unknown T runtime event');
  onEvent?.(structuredClone(event));
 }
 if(current()!==expectedGeneration||signal?.aborted)throw Error('T runtime cancelled or invalidated');if(!finished)throw Error('runtime missing finish-layer');
 return{finished,prints,turns,travels,sourceGeneration:generation,physicalPrintValidated:false};
}
module.exports={compileTExecution,replayTExecution,assertOwnedTExecution};
