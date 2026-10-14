import fs from 'node:fs';import vm from 'node:vm';import {createRequire} from 'node:module';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';
import {scene,tick} from './composed-fixture.mjs';
export {THREE,tick};
const require=createRequire(import.meta.url),ts=require(process.env.FRAME_TYPESCRIPT||'typescript'),text=fs.readFileSync(new URL('../../../modules/editor.ordinary-move.qa.js',import.meta.url),'utf8'),ast=ts.createSourceFile('candidate',text,99,true,1);
const fn=name=>ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast);
export function gate(){let release;return{promise:new Promise(r=>release=r),release:()=>release()};}
export async function settle(test,predicate,label='settled'){for(let n=0;!predicate();n++){if(n>=2000)throw Error(label);await tick();}return test;}
export async function fixture(){
 const q=await scene(),c=q.ctx,cam=new THREE.OrthographicCamera(-2,2,2,-2,.1,100);cam.position.z=10;cam.updateMatrixWorld(true);cam.updateProjectionMatrix();const rect={x:0,y:0,w:400,h:400},listeners=new Map(),no=()=>{};let navigation=0;
 Object.assign(c,{performance,sceneStateToken:0,sceneMutationSequence:0,gizmoLocal:false,EDIT_HIT_PX:12,framePolySelectionJob:null,frameNativeClickCommit:false,frameNativeExternalSelection:0,gizDrag:null,splineMode:false,splinePointerGesture:null,frameNativeHoverIntent:0,frameNativePickerLane:null,frameAffineAuthoringPointer:null,polyMode:true,
  vpState:{views:[{cam,ctrl:{move(){navigation++;cam.position.x+=.1;cam.updateMatrixWorld(true);}}}],renderer:{isFrameNativeViewportRenderer:true}},viewAt:()=>0,rectFor:()=>rect,selectionThroughShading:()=>false,exactVertexVisible:()=>true,isVertexEditableMesh:()=>true,
  frameNativePickerError:e=>c.errors.push(e),frameNativeSelectionError:e=>c.errors.push(e),addEventListener(name,cb){let set=listeners.get(name);if(!set)listeners.set(name,set=new Set());set.add(cb);},removeEventListener(name,cb){listeners.get(name)?.delete(cb);},
  frameNativePickerGuard(){const h=[...c.selNodes][0],m=c.pickMeshes.get(h),g=m?.geometry,entry=c.polySelection.items.get(h),revision=c.framePolySelectionRevision,domain=c.polyElementMode,camera=[...cam.matrixWorld.elements];return()=>c.selNodes.size===1&&c.selNodes.has(h)&&c.pickMeshes.get(h)===m&&m?.geometry===g&&c.polySelection.items.get(h)===entry&&c.framePolySelectionRevision===revision&&c.polyElementMode===domain&&camera.every((v,i)=>v===cam.matrixWorld.elements[i]);},
  frameCancelViewportMarquee:null,activeView:-1,mobileTouchMove:()=>false,edgeBevelTool:null,splineBevelTool:null,splineOutlineTool:null,vertexTools:{soft:{active:false},mode:null,snap:false},lastX:200,lastY:200,downX:200,downY:200,TAP_PX:2,LMB:1,RMB:2,MMB:4,hovObj:null,hitGizmo:()=>null,clearHover:no,clearSplineHover:no,getGizmoWorldArray:()=>new THREE.Matrix4().toArray(),
  polyHover:{kind:null,view:-1,vertexPos:new Float32Array(3),facePos:new Float32Array(9),edgePos:new Float32Array(6),vertex:{visible:false,geometry:{attributes:{position:{needsUpdate:false}}}}},_ph0:new THREE.Vector3(),
  reliableHoverVertex(){throw Error('Whole-mesh CPU hover/grouping forbidden');},
 });
 for(const name of ['frameOrdinaryPrepare','frameCancelPolySelectionWork','frameNativeCommitClick','frameRememberConnectedSelection','frameNativeConnectedGuard','frameStartNativeConnected','frameAffinePendingPointerMove','onMove','updateHover','updatePolyHover','clearPolyHover','frameRigidStart','frameRigidFinish'])vm.runInContext(fn(name),c);
 const messages=[],post=q.a.worker.postMessage.bind(q.a.worker);q.a.worker.postMessage=(m,t)=>{messages.push({kind:m.kind,token:m.token});return post(m,t);};
 const hoverEvent=(x=200)=>({type:'pointermove',pointerId:1,pointerType:'mouse',clientX:x,clientY:200,button:0,buttons:0,ctrlKey:false,metaKey:false,shiftKey:false,altKey:false,preventDefault(){}});
 const escape=()=>{const e={key:'Escape',preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const cb of [...listeners.get('keydown')||[]]){cb(e);if(e.stopped)break;}return e;};
 return{...q,c,cam,rect,listeners,messages,hoverEvent,escape,navigation:()=>navigation};
}
