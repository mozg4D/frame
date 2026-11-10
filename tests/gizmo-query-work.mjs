// Portable CPU regression: execute actual extracted legacy/current functions.
// Source strings come from the shared suite; this module performs no I/O.
import assert from 'node:assert/strict';

function extractFunction(source,name){
  const start=source.indexOf('function '+name+'(');assert.ok(start>=0,'Missing actual '+name);
  const open=source.indexOf('{',start);let depth=0,quote=null,line=false,block=false;
  for(let i=open;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(line){if(ch==='\n')line=false;continue;}if(block){if(ch==='*'&&next==='/'){block=false;i++;}continue;}
    if(quote){if(ch==='\\'){i++;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='/'&&next==='/'){line=true;i++;continue;}if(ch==='/'&&next==='*'){block=true;i++;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;if(ch==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw Error('Unterminated actual '+name);
}
const compile=(source,environment)=>new Function('environment','with(environment){return ('+source+');}')(environment);
const plain=value=>JSON.parse(JSON.stringify(value));
const sorted=object=>Object.fromEntries(Object.entries(object).sort(([a],[b])=>a.localeCompare(b)));
class Style{
  set cssText(value){for(const key of Object.keys(this))delete this[key];this._cssText=value;for(const item of value.split(';')){const [key,...rest]=item.split(':');if(key)this[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=rest.join(':');}}
  get cssText(){return this._cssText||'';}
}
class Element{
  constructor(tag,stats){this.tagName=tag;this.stats=stats;stats.elements++;this.attrs={};this.dataset={};this.style=new Style();this.children=[];this.parent=null;this.textContent='';this.id='';this.classes=new Set();this.classList={add:name=>this.classes.add(name)};}
  setAttribute(name,value){this.attrs[name]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  append(...children){for(const child of children){if(child.parent){const at=child.parent.children.indexOf(child);if(at>=0)child.parent.children.splice(at,1);}child.parent=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(selector[0]==='.'?child.classes.has(selector.slice(1)):child.tagName===selector)result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
}
function normalizedElement(element){return {tag:element.tagName,id:element.id,attrs:sorted(element.attrs),dataset:sorted(element.dataset),style:sorted(element.style),classes:[...element.classes].sort(),text:element.textContent,children:element.children.map(normalizedElement)};}

// Homogeneous flash projection is geometrically equivalent for this fully visible
// box but may reorder floating-point arithmetic. Only that SVG path gets 1e-10px
// tolerance; command topology and every other gizmo field remain exact.
function assertSnapshot(actual,expected,name,flashRoundoff=false){
  const walk=(a,b)=>{if(!a||!b||typeof a!=='object'||typeof b!=='object')return;
    if(a.classes?.includes('frame-bounds-flash')&&b.classes?.includes('frame-bounds-flash')){const re=/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/ig,A=a.attrs.d||'',B=b.attrs.d||'',av=(A.match(re)||[]).map(Number),bv=(B.match(re)||[]).map(Number);assert.equal(A.replace(re,'#'),B.replace(re,'#'),name+' flash command topology');assert.equal(av.length,bv.length);assert.ok(av.every((v,i)=>Number.isFinite(v)&&Number.isFinite(bv[i])&&Math.abs(v-bv[i])<=1e-10),name+' flash geometric equality');a.attrs.d=B;}
    for(const key of Object.keys(a))walk(a[key],b[key]);
  };if(flashRoundoff)walk(actual,expected);assert.deepEqual(actual,expected,name+' normalized DOM/geometry/state/signature');
}

function makeFixture(source,{views=[0,1,2],active=1,kinds={},states={},pivotEditing=false,largeSegments=0,flash=false,rotateFeedback=false}={}){
  const stats={elements:0,queryCalls:0,segmentEnumerations:0,segmentKeys:0,queryEvents:[],overlays:0},configuration={frame:true,hidden:false,mode:'move',invisible:new Set(),detached:new Set(),invalidUnit:new Set(),states:{...states}},env={};
  let cameraId=active;
  const selection=(id)=>configuration.states[id]||{kind:'plugin',single:false};
  const canvases=new Map(views.map(i=>[i,{fixtureName:'canvas-'+i,getClientRects:()=>configuration.detached.has(i)?[]:[{}],getBoundingClientRect:()=>({left:i*410+5,top:11,width:400,height:300,right:i*410+405,bottom:311})}]));
  const controls=new Map();
  for(const i of views){
    const segments=Object.fromEntries(Array.from({length:Math.max(1,largeSegments)},(_,n)=>['s'+n,{a:'other',b:'another',ha:[0,0,0],hb:[0,0,0]}]));
    const proxy=new Proxy(segments,{ownKeys(target){stats.segmentEnumerations++;const keys=Reflect.ownKeys(target);stats.segmentKeys+=keys.length;return keys;}});
    controls.set(i,{selection:new Set(['v']),data:{vertices:{v:[0,0,0]},segments:proxy,freeHandles:{v:{}}}});
  }
  const handles=new Element('div',stats);handles.append(new Element('button',stats),new Element('button',stats));
  Object.defineProperty(handles,'hidden',{get:()=>configuration.hidden});
  const FM={add:(a,b)=>a.map((v,i)=>v+b[i]),sub:(a,b)=>a.map((v,i)=>v-b[i]),scale:(a,k)=>a.map(v=>v*k),dot:(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0),unit:a=>{const length=Math.hypot(...a);return a.map(v=>v/length);}};
  Object.assign(env,{FramePlugins:{drawOverlays(){stats.overlays++;},dispatch(name){assert.equal(name,'selection');const state=selection(cameraId);return state.kind==='plugin'?{singleControl:state.single,count:state.single?1:2}:null;}},selectionFrame:()=>configuration.frame?new Float64Array([1,0,0,0,0,1,0,0,0,0,1,0,1,2,0,1]):null,handles,polygonTools:{get mode(){return configuration.mode;}},viewIndex:active,canvas:canvases.get(active),gizmoBasis:()=>[[1,0,0],[0,1,0],[0,0,1]],gizmoViews:new Map(),gizmoViewStates:new Map(),lastGizmoState:null,gizmoSignature:'',gizmoSvg:null,frameViewSections:new Map(views.map(i=>[i,{}])),frameViewCanvases:canvases,framePlaceOverlay:svg=>svg,createViewGizmo(i){if(env.gizmoViews.has(i))return null;const svg=new Element('svg',stats);env.gizmoViews.set(i,svg);return svg;},frameViewVisible:i=>!configuration.invisible.has(i),viewStates:Object.fromEntries(views.map(i=>[i,[i,0,0]])),defaultCamera:i=>[i,0,0],captureCamera:()=>[cameraId,0,0],restoreCamera:camera=>{cameraId=camera[0];},rotatePoint:p=>[p[0]+cameraId*.15*p[2],p[1]+cameraId*.07*p[0],p[2]],scene:{scale:1,center:[0,0,0]},orbitOffset:[0,0,0],panX:0,panY:0,frameViewKind:i=>kinds[i]||0,zoom:1,cameraFocal:()=>1,worldPerPixel:()=>configuration.invalidUnit.has(env.viewIndex)?0:.02,cameraRay:()=>({origin:[10+cameraId,9,8]}),FM,objectSelection:['mesh-fixture'],perspectiveFov:45,cameraRoll:0,pivotEditing,coordinateMode:'world',boundsFlash:flash?3:0,boundsFlashUntil:flash?100:0,uvEditing:false,quantize:false,snapping:false,gizmoSession:rotateFeedback?{kind:'rotate',event:{clientX:77,clientY:88}}:null,auxiliaryState:()=>selection(cameraId).kind==='motion'?{frame:[cameraId,1,2]}:null,selectionScope:flash?'objects':'components',elementMode:'vertex',splineComponentHash:()=>cameraId,splineDisplays:{get(id){const control=controls.get(id),state=selection(id);control.data.segments.s0.a=state.kind==='tangent'?'v':'other';control.data.segments.s0.ha=state.kind==='tangent'?[1,0,0]:[0,0,0];control.data.freeHandles.v=state.kind==='free-handle'?{left:[1,0,0]}:{};return control;}},motionState:()=>selection(cameraId).kind==='motion'?{items:Array(selection(cameraId).count).fill({})}:null,svgNS:'fixture-svg',document:{createElementNS:(namespace,tag)=>{assert.equal(namespace,'fixture-svg');return new Element(tag,stats);}},performance:{now:()=>10},drawAuxiliaryShape(svg){const group=new Element('g',stats);group.dataset.auxiliaryView=String(env.viewIndex);svg.append(group);},drawGizmoFeedback(svg){const group=new Element('g',stats);group.dataset.feedbackView=String(env.viewIndex);svg.append(group);},nodeBounds:()=>({min:[-1,-1,-1],max:[1,1,1]})});
  Object.defineProperty(env,'selectionBox',{get(){const wide=selection(cameraId).kind==='wide-box';return {min:[0,0,0],max:wide?[1,0,0]:[0,0,0]};}});
  env.inverseView=()=>[1,1,1];
  env.clippingPlanes=()=>[.001,1000];
  if(source.includes('function projectedBoundsFlash('))env.projectedBoundsFlash=compile(extractFunction(source,'projectedBoundsFlash'),env);
  const specsStart=source.indexOf('const frameGizmoSpecs='),specsEnd=source.indexOf('function singleSelectedControl(',specsStart);assert.ok(specsStart>=0&&specsEnd>specsStart);
  env.frameGizmoSpecs=new Function(source.slice(specsStart,specsEnd)+';return frameGizmoSpecs;')();
  const geometryNames=[...new Set(Object.values(env.frameGizmoSpecs).flat().map(item=>item[0]).concat('gSR'))];
  env.frameGizmoGeometry=Object.fromEntries(geometryNames.map((name,i)=>{const x=(i%5)*1.8,y=Math.floor(i/5)*1.8;return [name,{positions:new Float32Array([x,y,0,x+1.2,y,0,x,y+1.2,0]),indices:[0,1,2]}];}));
  for(const name of ['gizmoPart','framePointInTriangle','gizmoHit','hideGizmo'])env[name]=compile(extractFunction(source,name),env);
  const resolver=compile(extractFunction(source,'singleSelectedControl'),env);
  env.singleSelectedControl=()=>{stats.queryCalls++;const value=resolver();stats.queryEvents.push({view:env.viewIndex,camera:cameraId,value});return value;};
  function snapshot(){return plain({states:[...env.gizmoViewStates].sort(([a],[b])=>a-b).map(([i,state])=>[i,state]),svgs:[...env.gizmoViews].sort(([a],[b])=>a-b).map(([i,svg])=>[i,normalizedElement(svg)]),handles:normalizedElement(handles),restored:{viewIndex:env.viewIndex,camera:env.captureCamera(),canvas:env.canvas.fixtureName,lastView:env.lastGizmoState?.view??null,gizmoSvg:env.gizmoSvg?.id??null,gizmoSignature:env.gizmoSignature}});}
  return {env,stats,configuration,draw:compile(extractFunction(source,'drawGizmo'),env),snapshot,resetQueries(){stats.queryCalls=0;stats.segmentEnumerations=0;stats.segmentKeys=0;stats.queryEvents=[];},setStates(next){configuration.states={...next};}};
}

export function gizmoRegressionChecks(originalSource,currentSource){
  const results=[],pairs=[];
  function pair(name,options){const original=makeFixture(originalSource,options),proposal=makeFixture(currentSource,options);pairs.push({name,original,proposal});return {original,proposal};}
  function compare(name,original,proposal,{maxQueries,flashRoundoff=false}={}){
    original.draw();proposal.draw();assertSnapshot(proposal.snapshot(),original.snapshot(),name,flashRoundoff);
    assert.ok(proposal.stats.queryEvents.every(e=>e.view===e.camera),name+' queried after per-view camera restoration');
    const byView=Object.fromEntries([...new Set(proposal.stats.queryEvents.map(e=>e.view))].map(view=>[view,proposal.stats.queryEvents.filter(e=>e.view===view).length]));
    assert.ok(Object.values(byView).every(count=>count<=1),name+' bounded one query per eligible view');if(maxQueries!==undefined)assert.equal(proposal.stats.queryCalls,maxQueries,name+' query count');
    results.push({name,pass:true,originalQueries:original.stats.queryCalls,proposalQueries:proposal.stats.queryCalls,queriesByView:byView,originalSegmentKeys:original.stats.segmentKeys,proposalSegmentKeys:proposal.stats.segmentKeys,shapeCounts:[...proposal.env.gizmoViewStates].map(([view,state])=>[view,state.shapes.length])});
  }
  const mixed={views:[0,1,2],active:1,states:{0:{kind:'plugin',single:true},1:{kind:'plugin',single:false},2:{kind:'motion',count:1}}};
  const main=pair('per-view plugin/motion differs after camera restoration',mixed);compare('per-view plugin/motion differs after camera restoration',main.original,main.proposal,{maxQueries:3});
  assert.equal(main.original.stats.queryCalls,48,'Original actual function repeatedly queries16times per3Dview');assert.equal(main.proposal.stats.queryCalls,3);
  const shapeParts=i=>main.proposal.env.gizmoViewStates.get(i).shapes.map(shape=>shape.part);
  assert.ok(shapeParts(0).every(part=>!part.startsWith('scale')&&!part.startsWith('rotate')&&part!=='screenRotate'));assert.ok(shapeParts(1).some(part=>part.startsWith('scale')));assert.ok(shapeParts(1).some(part=>part.startsWith('rotate')));

  // Cache branch executes actual signature equality path without rebuilding.
  const before=main.proposal.stats.elements;main.original.resetQueries();main.proposal.resetQueries();compare('unchanged signature uses existing DOM/state cache',main.original,main.proposal,{maxQueries:3});assert.equal(main.proposal.stats.elements,before);
  const oldSignature=main.proposal.env.gizmoViewStates.get(0).signature;
  const changed={...mixed.states,0:{kind:'plugin',single:false}};main.original.setStates(changed);main.proposal.setStates(changed);main.original.resetQueries();main.proposal.resetQueries();compare('next draw observes changed control; no persistent classification cache',main.original,main.proposal,{maxQueries:3});assert.notEqual(main.proposal.env.gizmoViewStates.get(0).signature,oldSignature);assert.ok(shapeParts(0).some(part=>part.startsWith('scale')));

  const large=pair('large actual spline resolver scan bounded once per visible view',{views:[0,1,2],active:1,largeSegments:8192,states:{0:{kind:'spline'},1:{kind:'spline'},2:{kind:'spline'}}});compare('large actual spline resolver scan bounded once per visible view',large.original,large.proposal,{maxQueries:3});assert.equal(large.original.stats.segmentKeys,48*8192);assert.equal(large.proposal.stats.segmentKeys,3*8192);
  const quad=pair('quad views retain tangent/free-handle/wide-box semantics',{views:[0,1,2,3],active:2,kinds:{1:1,2:2,3:3},states:{0:{kind:'spline'},1:{kind:'tangent'},2:{kind:'free-handle'},3:{kind:'wide-box'}}});compare('quad views retain tangent/free-handle/wide-box semantics',quad.original,quad.proposal,{maxQueries:4});assert.ok(quad.proposal.env.gizmoViewStates.get(1).shapes.some(shape=>shape.part.startsWith('rotate')));assert.ok(quad.proposal.env.gizmoViewStates.get(2).shapes.some(shape=>shape.part.startsWith('scale')));
  const pivot=pair('pivot editing retains rotation and hides scale',{views:[0,1],active:0,pivotEditing:true,rotateFeedback:true,states:{0:{kind:'plugin',single:true},1:{kind:'motion',count:1}}});compare('pivot editing retains rotation and hides scale',pivot.original,pivot.proposal,{maxQueries:2});for(const state of pivot.proposal.env.gizmoViewStates.values()){assert.ok(state.shapes.every(shape=>!shape.part.startsWith('scale')));assert.ok(state.shapes.some(shape=>shape.part.startsWith('rotate')));}
  const flash=pair('object bounds flash SVG survives unchanged rendering',{views:[0],active:0,flash:true,states:{0:{kind:'plugin',single:false}}});compare('object bounds flash SVG survives unchanged rendering',flash.original,flash.proposal,{maxQueries:1,flashRoundoff:true});assert.ok(flash.proposal.env.gizmoViews.get(0).querySelector('.frame-bounds-flash'));
  const displaced=flash.proposal.snapshot(),findFlash=v=>v&&typeof v==='object'?(v.classes?.includes('frame-bounds-flash')?v:Object.values(v).map(findFlash).find(Boolean)):null,shifted=findFlash(displaced);shifted.attrs.d=shifted.attrs.d.replace(/-?\d+(?:\.\d+)?/,v=>String(Number(v)+1e-6));assert.throws(()=>assertSnapshot(displaced,flash.original.snapshot(),'displaced flash',true),/flash geometric equality/);results.push({name:'negative control rejects genuine flash displacement despite roundoff tolerance',pass:true});
  const hidden=pair('invisible detached and invalid-unit views skip classification',{views:[0,1,2,3],active:0});for(const item of [hidden.original,hidden.proposal]){item.configuration.invisible.add(1);item.configuration.detached.add(2);item.configuration.invalidUnit.add(3);}compare('invisible detached and invalid-unit views skip classification',hidden.original,hidden.proposal,{maxQueries:1});assert.deepEqual(hidden.proposal.stats.queryEvents.map(e=>e.view),[0]);
  for(const [name,mutate]of [['no frame',fixture=>{fixture.configuration.frame=false;}],['handles hidden',fixture=>{fixture.configuration.hidden=true;}],['polygon loop mode',fixture=>{fixture.configuration.mode='loop';}]]){
    const fixture=pair(name,{views:[0,1],active:0});fixture.original.draw();fixture.proposal.draw();for(const item of [fixture.original,fixture.proposal]){item.resetQueries();mutate(item);}compare(name,fixture.original,fixture.proposal,{maxQueries:0});assert.equal(fixture.proposal.env.gizmoViewStates.size,0);assert.equal(fixture.proposal.env.lastGizmoState,null);assert.ok([...fixture.proposal.env.gizmoViews.values()].every(svg=>svg.children.length===0&&svg.style.display==='none'));
  }
  // Execute two intentionally wrong placement variants in memory. Semantic
  // output comparisons must catch them even when whole-frame query count is low.
  const actualDraft=extractFunction(currentSource,'drawGizmo'),declaration='const singleControl=singleSelectedControl();';assert.equal(actualDraft.split(declaration).length,2);
  const without=actualDraft.replace(declaration,'');
  const wrongWhole=without.replace('try{for(const i of frameViewSections.keys())','const singleControl=singleSelectedControl();try{for(const i of frameViewSections.keys())');
  const wrongCamera=without.replace('viewIndex=i;restoreCamera','viewIndex=i;const singleControl=singleSelectedControl();restoreCamera');
  const reference=makeFixture(originalSource,mixed);reference.draw();
  for(const [name,mutant]of [['outside visible-view loop',wrongWhole],['before per-view restoreCamera',wrongCamera]]){assert.notEqual(mutant,without);const bad=makeFixture(currentSource,mixed);bad.draw=compile(mutant,bad.env);bad.draw();assert.notDeepEqual(bad.snapshot(),reference.snapshot(),name+' must change semantic output');results.push({name:'negative control catches hoist '+name,pass:true,queries:bad.stats.queryCalls});}
  return {pass:true,diagnosticOnly:true,sourceFunctionsExecuted:['drawGizmo','singleSelectedControl','gizmoPart','gizmoHit','framePointInTriangle','hideGizmo','frameGizmoSpecs'],comparisons:'Exact normalized SVG DOM, parts/handles/points/triangles/signatures, cache state and restored camera/view/canvas; fully visible flash path permits only 1e-10px arithmetic roundoff',checks:results,largeWork:{segmentCountPerQuery:8192,originalKeysVisited:large.original.stats.segmentKeys,proposalKeysVisited:large.proposal.stats.segmentKeys,queryReduction:16},browserLaunches:0,GPUlaunches:0,networkRequests:0,OSProcessAPIs:0,repositoryEdits:0};
}

