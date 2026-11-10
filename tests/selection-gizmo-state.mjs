// Actual native update/cleanup functions with document-independent SVG stubs; no GPU.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const sourcePath=process.argv.includes('--source')?process.argv[process.argv.indexOf('--source')+1]:new URL('../index.html',import.meta.url);
const html=await readFile(sourcePath,'utf8'),checks=[];
const extract=(name,next)=>{const start=html.indexOf('    function '+name+'('),end=html.indexOf('\n    function '+next+'(',start);assert.ok(start>=0&&end>start,name);return html.slice(start,end);};
const update=extract('updateHandles','inverseView');
const start=html.indexOf('    function hideGizmo('),hide=start<0?'':html.slice(start,html.indexOf('\n    function drawGizmo(',start));
const check=(name,fn)=>{fn();checks.push(name);};
function fixture(options={}){
 const overlays=Array.from({length:6},(_,view)=>({view,parentNode:{nodeName:'BODY',document:view<4?'main':'popup-'+view},style:{display:'block'},children:['handle','flash'],replaceChildren(){this.children=[];}}));
 const state={preserveSelectionTags:false,selectionSignature:'',transformHudSignature:'',selectionGeneration:1,poseEpoch:1,coordinateMode:'world',pivotEditing:false,selectionScope:'objects',objectSelection:[],selectedMesh:null,selectionBox:null,button:{disabled:false},scene:{meshes:[]},handles:{hidden:false},gizmoSignature:'stale',lastGizmoState:{view:4},gizmoViews:new Map(overlays.map((s,i)=>[i,s])),gizmoViewStates:new Map(overlays.map((s,i)=>[i,{view:i,shapes:['stale']}]))};
 const counters={draw:0,notify:0,plugin:0};let aux=null,plugin=null;const sandbox={...state,window:{FrameSpline:{drawing:false},dispatchEvent(){}},CustomEvent:class {},currentSelectionMeshes:()=>[],auxiliaryState:()=>aux,splineComponentHash:()=>null,FramePlugins:{dispatch:()=>plugin},drawGizmo(){counters.draw++;},notifyTransformUI(){counters.notify++;}};Object.assign(sandbox,options);vm.createContext(sandbox);vm.runInContext(hide+'\n'+update+'\nthis.update=updateHandles;',sandbox);return {sandbox,overlays,counters,aux:value=>aux=value,plugin:value=>plugin=value};
}
check('Empty selection clears all body-owned main and popup SVGs and hit caches',()=>{const f=fixture();f.sandbox.update();assert.equal(f.sandbox.handles.hidden,true);assert.ok(f.overlays.every(s=>s.style.display==='none'&&!s.children.length));assert.equal(f.sandbox.gizmoSignature,'');assert.equal(f.sandbox.lastGizmoState,null);assert.equal(f.sandbox.gizmoViewStates.size,0);assert.equal(f.counters.draw,0);});
check('Repeated deselection remains clear',()=>{const f=fixture();for(let i=0;i<20;i++)f.sandbox.update();assert.ok(f.overlays.every(s=>!s.children.length));assert.equal(f.sandbox.gizmoViewStates.size,0);});
const box={min:[0,0,0],max:[1,1,1],center:[.5,.5,.5]};
check('Ordinary selected object still draws and updates its transform HUD',()=>{const f=fixture({objectSelection:['cube'],selectionBox:box});f.sandbox.update();assert.equal(f.sandbox.handles.hidden,false);assert.equal(f.counters.draw,1);assert.equal(f.counters.notify,1);});
for(const [name,options] of [['Empty components',{selectionScope:'components',selectedMesh:{hash:'mesh'},selectionBox:null}],['No scene',{scene:null}],['Disabled operation',{button:{disabled:true},objectSelection:['cube'],selectionBox:box}],['Spline drawing',{window:{FrameSpline:{drawing:true},dispatchEvent(){}},objectSelection:['cube'],selectionBox:box}]])check(name+' clears stale overlays',()=>{const f=fixture(options);f.sandbox.update();assert.ok(f.overlays.every(s=>s.style.display==='none'&&!s.children.length));assert.equal(f.sandbox.lastGizmoState,null);});
check('Selected light helper keeps its native auxiliary gizmo',()=>{const f=fixture();f.aux({kind:'light',box});f.sandbox.update();assert.equal(f.sandbox.handles.hidden,false);assert.equal(f.counters.draw,1);});
check('Plugin selection without ordinary object selection keeps its native gizmo',()=>{const f=fixture({selectionBox:box});f.plugin({hash:'plugin'});f.sandbox.update();assert.equal(f.sandbox.handles.hidden,false);assert.equal(f.counters.draw,1);});
check('Escape deselection synchronizes the normal native selection queue',()=>assert.match(html,/if\(e.key==='Escape'\)\{stop\(\);selected.clear\(\);selectedTag=null;focusId=null;render\(\);frameSelectEngineObjects\(false\);\}/));
check('Body-owned gizmos retain their original stacking above helper hits',()=>assert.match(html,/\.frame-gizmo\{position:fixed;z-index:35;/));
check('Open-view icon is darker without resizing geometry or changing hover',()=>{assert.match(html,/\.view \.frame-view-open\{[^}]*width:16px;height:16px[^}]*color:#777!important/);assert.match(html,/\.frame-view-open:hover\{color:#aaa!important/);assert.match(html,/\.frame-view-open svg\{display:block;width:16px;height:16px\}/);});
console.log(JSON.stringify({pass:true,checks:checks.length,names:checks,indexSHA256:createHash('sha256').update(html).digest('hex'),hardwareGPUValidated:false},null,2));
