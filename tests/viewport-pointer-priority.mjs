import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function pointerPriorityChecks(source){
 const checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
 const css=selector=>{const text=source.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]+)\\}'))?.[1];assert.ok(text,selector);return Object.fromEntries(text.split(';').filter(Boolean).map(s=>s.split(':')));};
 const motion=css('.frame-motion'),keys=css('.frame-motion [data-motion-key]'),gizmo=css('.frame-gizmo');
 check('Only the editable motion children receive pointer events',motion['pointer-events']==='none'&&keys['pointer-events']==='all');
 check('Motion keys are above the transform gizmo',+motion['z-index']>+gizmo['z-index']);
 check('Ordinary gizmo keeps native priority above helper overlays',gizmo['z-index']==='35');
 const state='const polygonTools={mode:null,line:[],view:0,soft:false,radius:100,visibleOnly:true};';
 check('Single tool state initializes before gizmo consumers',source.split(state).length===2&&source.indexOf(state)<source.indexOf('function updateHandles()'));
 const drawStart=source.indexOf('function drawGizmo(){'),drawEnd=source.indexOf('      const active=viewIndex',drawStart);
 assert.ok(drawStart>0&&drawEnd>drawStart);
 const draw=source.slice(drawStart,drawEnd)+'paint++;}';
 for(const mode of [null,'loop','soft','bridge','closeHole','lineCut'])for(const hidden of [false,true])for(const frame of [null,{}]){
  const scope={polygonTools:{mode},handles:{hidden},selectionFrame:()=>frame,FramePlugins:{drawOverlays(){}},hideGizmo(){scope.hides++;},hides:0,paint:0};vm.runInNewContext(draw+';drawGizmo()',scope);
  const suppress=!frame||hidden||mode==='loop';check('Gizmo render admission '+JSON.stringify({mode,hidden,frame:!!frame}),scope.hides===(suppress?1:0)&&scope.paint===(suppress?0:1));
 }
 const end=source.match(/    function endPolygonTool\(\)\{[^\n]+/)[0].trim();
 for(const mode of [null,'loop','soft','bridge','closeHole','lineCut']){
  const scope={polygonTools:{mode,line:[1],pendingPoints:2},bridgeGesture:null,polygonToolGeneration:1,polygonClickGesture:{},loopPreview:{},loopRevision:1,loopCursor:[1,2],drawPolygonGuide(){scope.guides++;},drawGizmo(){scope.gizmos++;},guides:0,gizmos:0};vm.runInNewContext(end+';endPolygonTool()',scope);
  check('Tool exit clears native state '+mode,scope.polygonTools.mode===null&&scope.polygonTools.line.length===0&&scope.polygonTools.pendingPoints===0&&scope.polygonClickGesture===null&&scope.loopPreview===null&&scope.loopCursor===null&&scope.loopRevision===2&&scope.guides===1);
  check('Only leaving Loop immediately restores gizmo '+mode,scope.gizmos===(mode==='loop'?1:0));
 }
 const tool=source.match(/    function polygonTool\(mode\)\{[^\n]+/)[0].trim();
 for(const mode of ['loop','soft','bridge','closeHole','lineCut']){
  const scope={mode,polygonTools:{mode:null,view:0,soft:false},viewIndex:2,scene:{meshes:[]},endPolygonTool(){},FrameGeometry:{endBevel(){},endOutline(){}},activateTab(){},renderAttributes(){},notifyTransformUI(){},draw(){},hideGizmo(){scope.hides++;},hides:0};vm.runInNewContext(tool+';polygonTool(mode)',scope);
  check('Loop receives pointer priority synchronously '+mode,scope.hides===(mode==='loop'?1:0));
  check('Tool activation preserves mode, view and soft semantics '+mode,scope.polygonTools.mode===(mode==='soft'?null:mode)&&scope.polygonTools.view===2&&scope.polygonTools.soft===(mode==='soft'));
 }
 return checks;
}
export function pointerPriorityNegatives(source){const mutations=[
 ['lower motion priority',s=>s.replace('.frame-motion{position:fixed;z-index:36;','.frame-motion{position:fixed;z-index:8;')],
 ['whole motion overlay captures pointers',s=>s.replace('.frame-motion{position:fixed;z-index:36;pointer-events:none','.frame-motion{position:fixed;z-index:36;pointer-events:all')],
 ['motion keys disabled',s=>s.replace('.frame-motion [data-motion-key]{pointer-events:all','.frame-motion [data-motion-key]{pointer-events:none')],
 ['gizmo loses helper priority',s=>s.replace('.frame-gizmo{position:fixed;z-index:35;','.frame-gizmo{position:fixed;z-index:7;')],
 ['loop render suppression missing',s=>s.replace("||polygonTools.mode==='loop'){hideGizmo();return;}",'){hideGizmo();return;}')],
 ['all tools suppress gizmo',s=>s.replace("||polygonTools.mode==='loop'){hideGizmo();return;}","||polygonTools.mode){hideGizmo();return;}")],
 ['no immediate loop admission',s=>s.replace("if(mode==='loop')hideGizmo();",'')],
 ['no immediate gizmo restoration',s=>s.replace('if(wasLoop)drawGizmo();','')],
 ['other tool exit also redraws',s=>s.replace('if(wasLoop)drawGizmo();','drawGizmo();')],
 ['soft behavior changed',s=>s.replace("polygonTools.soft=!polygonTools.soft;polygonTools.mode=null;","polygonTools.soft=!polygonTools.soft;polygonTools.mode='soft';")]
 ];for(const [name,mutate]of mutations){const changed=mutate(source);assert.notEqual(changed,source,name);assert.throws(()=>pointerPriorityChecks(changed),undefined,name);}return mutations.map(x=>x[0]);}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=pointerPriorityChecks(source),negative=pointerPriorityNegatives(source);console.log(JSON.stringify({pass:true,checks:checks.length,negativeControls:negative.length,names:checks,negative}));}
