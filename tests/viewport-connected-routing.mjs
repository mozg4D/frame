import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function viewportConnectedRoutingChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[],timings=[];
 const take=(a,b)=>{const i=html.indexOf(a);assert.ok(i>=0,a);return html.slice(i,html.indexOf(b,i));};
 const source=take('    function viewportConnectedDoubleClick(','    new ResizeObserver('),place=html.split('\n').find(l=>l.startsWith('function framePlaceOverlay(')),old="$('frame-engine-host').addEventListener('dblclick',event=>{event.preventDefault();event.stopImmediatePropagation();const view=frameViewportAt(event.clientX,event.clientY);if(view!==null&&activateFrameView(view)&&!event.altKey&&!FrameSpline.drawing){if(drag?.vertexPending){drag.cancelled=true;drag=null;orbitGeneration++;}selectConnected(event.clientX,event.clientY,frameSelectionOperation(event));}},true);";
 function setup(code=source){
  const calls=[],docs=[],views=new Map();let stopped=false;
  function element(kind,parent=null,doc=null){return {kind,parentNode:parent,ownerDocument:doc||parent?.ownerDocument,listeners:[],append(el){el.parentNode=this;el.ownerDocument=this.ownerDocument;},addEventListener(type,fn,capture){this.listeners.push({type,fn,capture});},matches(selectors){return selectors.split(',').some(s=>({'.frame-viewport-canvas':'canvas','.view[data-view]':'view'})[s]===this.kind);},closest(selectors){const kinds={'#frame-engine-host':'host','.frame-gizmo':'gizmo','.view[data-view]':'view','input':'input','textarea':'textarea','select':'select','button':'button','[contenteditable]':'editable','#menu':'menu','.frame-plugin-overlay':'plugin','.frame-view-open':'open'};for(let n=this;n;n=n.parentNode)if(selectors.split(',').some(s=>kinds[s]===n.kind))return n;return null;}};}
  function document(id){const doc=element('document');doc.ownerDocument=doc;doc.id=id;doc.body=element('body',doc,doc);docs.push(doc);const view=element('view',doc.body,doc);view.index=id;views.set(id,view);return doc;}
  const main=document(0),detached=document(4),host=element('host',views.get(0)),canvas=element('canvas',host),gizmo=element('gizmo',host),path=element('path',gizmo),other=element('panel',main.body),row=element('row',other),menu=element('menu',main.body);
  const env={$:()=>host,frameViewElement:i=>views.get(i),frameViewportAt:(x,y,doc=main)=>x>=10&&x<110&&y>=10&&y<110?doc.id:null,activateFrameView:i=>{env.active=i;return !env.rejectActivation;},FrameSpline:{drawing:false},drag:null,orbitGeneration:0,frameSelectionOperation:e=>e.ctrlKey||e.metaKey?'toggle':e.shiftKey?'add':'replace',selectConnected:(...a)=>calls.push(a),FrameViewWindows:{onDocument(type,fn,capture){for(const doc of docs)doc.addEventListener(type,fn,capture);}}};
  vm.createContext(env);vm.runInContext(place+'\n'+code,env);
  function dispatch(target,extra={}){stopped=false;const e={target,button:0,clientX:50,clientY:50,preventDefault(){this.prevented=true;},stopImmediatePropagation(){stopped=true;},...extra},chain=[];for(let n=target;n;n=n.parentNode)chain.push(n);for(const n of [...chain].reverse())for(const l of n.listeners)if(l.capture&&!stopped)l.fn(e);for(const n of chain)for(const l of n.listeners)if(!l.capture&&!stopped)l.fn(e);return e;}
  return {env,calls,main,detached,host,canvas,gizmo,path,row,menu,other,views,element,dispatch};
 }
 const test=(name,fn)=>{try{fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.stack});}};
 const specs=vm.runInNewContext(take('    const frameGizmoSpecs={','    function singleSelectedControl()')+';frameGizmoSpecs'),part=vm.runInNewContext('('+take('    function gizmoPart(','    function gizmoHit(').trim()+')');
 for(const storage of ['auto','texture'])for(const mode of ['polygon','vertex','edge'])test(storage+' '+mode+' XY/world has filled move01 and no plain move',()=>{
  const parts=Array.from(specs.XY,row=>part(row[2]));assert.ok(parts.includes('move01'));assert.ok(!parts.includes('move'));
  assert.match(html,/if\(differs&&\(!frameViewKind\(i\)\|\|coordinateMode==='object'\)\)/);
  assert.equal(vm.runInNewContext("differs&&(!frameViewKind(i)||coordinateMode==='object')",{differs:true,frameViewKind:()=>2,i:2,coordinateMode:'world'}),false);
  assert.match(html,/path.setAttribute\('fill','#'\+color.toString/);
 });
 const harness=await readFile(new URL('./viewport-connected-browser.mjs',import.meta.url),'utf8');
 test('Harness uses actual filled triangle and DOM hit over connected quad, not bbox centre',()=>{
  assert.ok(harness.includes('[data-part="move01"]'));assert.ok(!harness.includes('[data-part="move"]'));
  for(const guard of ['path.isPointInFill(local)','top===path','inside(point,quad)','svg.parentNode!==doc.body'])assert.ok(harness.includes(guard));
 });
 test('Standalone launcher explicitly removes software default',()=>assert.ok(harness.includes("ignoreDefaultArgs:['--enable-unsafe-swiftshader']")));
 test('Adapter guard rejects missing, accessor-less, fallback and software metadata',()=>{
  const expression=harness.match(/if\((!report.adapter[^\n]+?)\)throw Error\('Hardware WebGPU required'\)/)[1];
  const reject=adapter=>vm.runInNewContext(expression,{report:{adapter}});
  for(const a of [null,{}, {isFallbackAdapter:false},{isFallbackAdapter:true,vendor:'GPU'},{isFallbackAdapter:false,description:'SwiftShader'}])assert.equal(reject(a),true);
  assert.equal(reject({isFallbackAdapter:false,vendor:'real vendor',architecture:'hardware'}),false);
  assert.ok(!harness.includes('...frameEngine.renderer.device.adapterInfo'));
 });
 test('Old shipped host route demonstrably loses relocated gizmo events',()=>{const s=setup(old);s.dispatch(s.canvas);assert.equal(s.calls.length,1);s.env.framePlaceOverlay(s.gizmo,0);s.dispatch(s.path);assert.equal(s.calls.length,1);assert.equal(s.gizmo.parentNode,s.main.body);});
 test('Shipped overlay relocation is still body-level, not a test-only topology',()=>assert.match(html,/framePlaceOverlay\(createViewGizmo\(i\)\|\|gizmoViews.get\(i\),i\)/));
 for(const target of ['canvas','gizmo','path'])test('Exactly one dispatch for '+target,()=>{const s=setup();s.env.framePlaceOverlay(s.gizmo,0);const e=s.dispatch(s[target]);assert.equal(s.calls.length,1);assert.equal(e.prevented,true);});
 test('Canvas to body overlay common target is admitted inside viewport',()=>{const s=setup();s.env.framePlaceOverlay(s.gizmo,0);s.dispatch(s.main.body);assert.equal(s.calls.length,1);});
 test('Body and viewport events outside view bounds are ignored',()=>{const s=setup();for(const t of [s.main.body,s.canvas,s.path])s.dispatch(t,{clientX:500});assert.equal(s.calls.length,0);});
 for(const target of ['row','menu','other'])test('Unrelated '+target+' over viewport is untouched',()=>{const s=setup();const e=s.dispatch(s[target]);assert.equal(s.calls.length,0);assert.equal(e.prevented,undefined);});
 for(const extra of [{altKey:true},{button:1},{button:2}])test('Excluded gesture '+JSON.stringify(extra),()=>{const s=setup();s.dispatch(s.canvas,extra);assert.equal(s.calls.length,0);});
 for(const kind of ['input','textarea','select','button','editable','menu','plugin','open'])test('Nested UI '+kind+' inside viewport is untouched',()=>{const s=setup();s.dispatch(s.element(kind,s.host));assert.equal(s.calls.length,0);});
 test('Unrelated panel nested in view is not a surface',()=>{const s=setup();s.dispatch(s.element('panel',s.views.get(0)));assert.equal(s.calls.length,0);});
 test('Drawing and rejected activation cannot select',()=>{const s=setup();s.env.FrameSpline.drawing=true;s.dispatch(s.canvas);s.env.FrameSpline.drawing=false;s.env.rejectActivation=true;s.dispatch(s.canvas);assert.equal(s.calls.length,0);});
 for(const [extra,op]of [[{},'replace'],[{shiftKey:true},'add'],[{ctrlKey:true},'toggle'],[{metaKey:true},'toggle'],[{ctrlKey:true,shiftKey:true},'toggle']])test('Modifier operation '+JSON.stringify(extra),()=>{const s=setup();s.dispatch(s.canvas,extra);assert.equal(s.calls[0][2],op);});
 test('Detached gizmo uses owning document, not stale active document',()=>{const s=setup();s.env.framePlaceOverlay(s.gizmo,4);s.path.ownerDocument=s.detached;s.dispatch(s.path);assert.equal(s.env.active,4);assert.equal(s.calls.length,1);});
 test('Passive view uses the common document route',()=>{const s=setup();const passive=s.element('canvas',s.views.get(4));s.dispatch(passive);assert.equal(s.env.active,4);assert.equal(s.calls.length,1);});
 test('Pending vertex click is cancelled once before connected selection',()=>{const s=setup(),pending={vertexPending:true};s.env.drag=pending;s.dispatch(s.canvas);assert.equal(pending.cancelled,true);assert.equal(s.env.drag,null);assert.equal(s.env.orbitGeneration,1);assert.equal(s.calls.length,1);});
 test('Accepted events preserve existing selection area and traversal API',()=>{assert.doesNotMatch(source,/selectionArea\s*=|selectAll|selectionScope\s*=|readGeometry|createBuffer/);assert.equal((html.match(/onDocument\('dblclick',viewportConnectedDoubleClick,true\)/g)||[]).length,1);assert.doesNotMatch(html,/frame-engine-host'\)\.addEventListener\('dblclick',event=>/);});
 test('10000 completed route dispatches stay under 150ms',()=>{const s=setup();const t=performance.now();for(let i=0;i<10000;i++)s.dispatch(s.path);const ms=performance.now()-t;timings.push({name:'10000 CPU routing operations',ms,budgetMs:150});assert.equal(s.calls.length,10000);assert.ok(ms<150);});
 return {pass:checks.every(c=>c.pass),scope:'CPU source-extracted DOM ancestor/event model, not native browser or GPU',checks,timings,indexSHA256:createHash('sha256').update(html).digest('hex')};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const r=await viewportConnectedRoutingChecks();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/viewport-connected-routing.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
