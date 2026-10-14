import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require(process.env.FRAME_TYPESCRIPT || 'typescript');
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/,'$1')),'..');
const source=fs.readFileSync(path.join(root,'modules/editor.b46b7edb7b8fab6c0f1e.js'),'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),'b46b7edb7b8fab6c0f1e17e4c9d82608c7dc0c9ad7a63fc9ae495e2868ee9f28');
const ast=ts.createSourceFile('r247',source,99,true,1);
const frozen=name=>{const n=ast.statements.findLast(q=>ts.isFunctionDeclaration(q)&&q.name?.text===name);assert(n,name);return n.getText(ast);};
const names=['polyEdgeKey','rotMatOfLin','basisFromNormal','frameFaceSelectionBasisWork','frameEdgeSelectionBasisWork','frameLogicalEdgesWork','frameLogicalVertexGroupsWork','framePolySelectionBuffers','framePolySelectionMeasurements','framePolySelectedVertexIdsWork','frameDrainSelectionWork','prepareSplineBVH','frameWireIndices'];
const prelude=`import * as THREE2 from '../modules/frame-three-core.9edde002b066a9a05676.js';
import {ordinarySelectedIDs} from './ordinary-move-core.mjs';
export function moveReadPacket(snapshot,input,context={}) {
 const h='owned',g=new THREE2.BufferGeometry();
 g.setAttribute('position',new THREE2.BufferAttribute(snapshot.positions,3));
 g.setAttribute('normal',new THREE2.BufferAttribute(snapshot.normals,3));
 g.setIndex(new THREE2.BufferAttribute(snapshot.indices,1));
 const mesh=new THREE2.Mesh(g); mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(context.world);mesh.updateMatrixWorld(true);
 const items=new Map([[h,{vertices:new Set(input.vertices||[]),edges:new Set(input.edges||[]),faces:new Set(input.faces||[])}]]);
 const pickMeshes=new Map([[h,mesh]]),selNodes=new Set([h]),polySelection={items},polyElementMode=context.domain||'vertex',coordMode=context.space||'world';
 const polyExactEdgeVertices=null,uvEdit=false,vertexTools={soft:{active:false}},polyFocusActive=()=>true,splineFocusActive=()=>false;
 const vertexGroupCache=new WeakMap(),vertexGroupOfCache=new WeakMap(),logicalEdgeCache=new WeakMap();
 const _rotX=new THREE2.Vector3(),_rotY=new THREE2.Vector3(),_rotZ=new THREE2.Vector3();
 const frameRigidSelectedIDs=()=>null,pureWorldFrame=()=>new THREE2.Matrix4().fromArray(context.ownerFrame||context.world);
 ${names.map(frozen).join('\n')}
 const ids=Uint32Array.from(ordinarySelectedIDs(snapshot,input)).sort(),mask=new Uint8Array(snapshot.positions.length/3);for(const id of ids)mask[id]=1;
 const buffers=frameDrainSelectionWork(framePolySelectionBuffers(items)),m=frameDrainSelectionWork(framePolySelectionMeasurements(items,null,pickMeshes,context.pivot||null));
 const measurements=m?{bounds:{min:m.bounds.min.toArray(),max:m.bounds.max.toArray()},frame:m.frame.toArray(),extent:m.extent.toArray()}:null;
 const overlayNumeric={};for(const [key,positions]of Object.entries(buffers)){const count=positions.length/3,extras=new Float32Array(count*9),indices=new Uint32Array(count);for(let i=0;i<count;i++){indices[i]=i;extras[i*9+2]=extras[i*9+5]=extras[i*9+6]=extras[i*9+7]=extras[i*9+8]=1;}overlayNumeric[key]={positions,extras,indices,vertexCount:count,hasNormals:false,hasUV:false,hasColors:false};}
 return {rawIDs:ids,rawMask:mask,buffers,measurements,overlayNumeric};
}
export function moveDerivedPacket(snapshot) {
 ${frozen('prepareSplineBVH')}
 ${frozen('frameWireIndices')}
 const p=snapshot.positions,ix=snapshot.indices;
 const pos={count:p.length/3},idx={count:ix.length,getX:i=>ix[i]};
 const bounds=new THREE2.Box3(),v=new THREE2.Vector3();for(let i=0;i<p.length;i+=3)bounds.expandByPoint(v.fromArray(p,i));
 const center=bounds.getCenter(new THREE2.Vector3());let radiusSq=0;for(let i=0;i<p.length;i+=3)radiusSq=Math.max(radiusSq,center.distanceToSquared(v.fromArray(p,i)));
 const wire=frameWireIndices(pos,idx),start=snapshot.drawRange?.start||0,end=Math.min(ix.length,start+(snapshot.drawRange?.count??Infinity));
 return {wire,wireElements:Uint32Array.from(wire),pointElements:Uint32Array.from(ix.subarray(start,end)),bvh:prepareSplineBVH(p,ix),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},sphere:{center:center.toArray(),radius:Math.sqrt(radiusSq)}};
}
`;
fs.writeFileSync(path.join(root,'native-source/ordinary-move-kernels.mjs'),prelude);
console.log(JSON.stringify({pass:true,frozenFunctions:names.length,kernelSHA256:createHash('sha256').update(prelude).digest('hex')}));
if(process.argv.includes('--candidate')) {
 const prefixes={
  frameAffineGizmoVersionedAdmission:'if(frameOrdinaryGizmoAdmission(g,e))return true;',
  onDown:'frameOrdinaryModifierPointer(e);frameOrdinaryNewPointer(e);',onMove:'frameOrdinaryModifierPointer(e);if(frameOrdinaryDrainPointer(e))return;',onUp:'if(frameOrdinaryDrainPointer(e,true))return;',
  placeGizmoForSelection:'if(frameOrdinaryAwaitMeasurements(measurements)){if(!frameOrdinaryInput)setGizmoVisible(false);return;}',updateHUD:'if(frameOrdinaryAwaitMeasurements(transform))return;',
  updatePolyHover:'if(frameOrdinaryHover(cx,cy,preparedNative))return;',
  frameCommitPolySelectionPresentation:'if(frameOrdinaryPresentation(result,syncGizmo))return;',
  frameRigidSchedulePrepare:'if(frameOrdinarySupported()){frameOrdinaryPrepare();return null;}',
  frameRigidCaptureDragContext:"if(frameOrdinarySupported()&&gizDrag?.mode==='move'&&!event?.ctrlKey&&!event?.metaKey&&!event?.shiftKey)return;",
  frameRigidStart:'if(frameOrdinaryStart(e))return true;',frameRigidApplyDelta:'if(frameOrdinaryApply(delta))return true;',
  frameRigidFinish:'if(frameOrdinaryFinish(e))return true;',readPolyTransform:'measurements??=frameOrdinaryCurrentMeasurements();',
  undo:"if(frameOrdinaryHistoryCommand('undo'))return;",redo:"if(frameOrdinaryHistoryCommand('redo'))return;",
  runCmd:'frameOrdinaryHistoryGuard();if(c&&!c.renderOnly)frameOrdinaryAssertExact(frameOrdinaryCommandTargets(c));',pushCmd:'frameOrdinaryAfterExternalCommand(c);',
  applyPolyDelta:'if(!frameOrdinaryInput)frameOrdinaryBeforeExternalEdit(snap?[...snap.keys()]:null);',
  replaceEditedGeometry:'frameOrdinaryBeforeExternalEdit([meshToHash.get(mesh)]);',normalizeCreaseTopology:'frameOrdinaryBeforeExternalEdit([meshToHash.get(mesh)]);',restorePolyGeometries:'frameOrdinaryBeforeExternalEdit([...s.keys()]);',
  frameAffineEnsureAuthoring:'frameOrdinaryAssertExact(hashes);',frameAffineAuthoringPending:'if(frameOrdinaryExactPending(hashes))return true;',
  frameAffineContinueExact:'if(frameOrdinaryExactPending(hashes))return frameOrdinaryContinueExact(()=>frameAffineContinueExact(continuation,hashes,{rollback,rollbackCurrent,onError}),hashes);',
  frameAffineWaitForSave:'await frameOrdinaryWaitForSave(signal);',nativeGeometrySnapshot:'frameOrdinaryAssertGeometryExact(g);const ordinary=frameOrdinaryCanonicalSaveSnapshot(g);if(ordinary)return ordinary;',
  buildHashSceneSnapshot:'frameOrdinarySaveCheck();',nativeSaveCheck:'if(nativeSceneSave?.capturing)frameOrdinarySaveCheck();',fullBlob:'if(!nativeSceneSave)frameOrdinarySavingBoundary=null;',
  clearContent:'frameOrdinaryClearOwners();',cmdDelete:'const frameOrdinaryDeleteEpoch=frameOrdinarySceneEpoch;'
 };
 const edits=[];
 const hoverFunction=ast.statements.findLast(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='updatePolyHover'),hoverSource=hoverFunction.getText(ast),hoverPick='let hit2 = reliableHoverVertex(cx, cy, vpState.views[vi].cam, r, selectionThroughShading(vi));';assert.equal(hoverSource.split(hoverPick).length-1,1);const hoverAt=hoverFunction.getStart(ast)+hoverSource.indexOf(hoverPick);edits.push({start:hoverAt,end:hoverAt+hoverPick.length,code:'let hit2 = preparedNative?.vertexPrepared?preparedNative.vertexHit:reliableHoverVertex(cx, cy, vpState.views[vi].cam, r, selectionThroughShading(vi));'});
 for(const [name,replace]of Object.entries({
  frameApplyPreparedPolySelection:text=>{const n=ast.statements.findLast(q=>ts.isFunctionDeclaration(q)&&q.name?.text==='frameApplyPreparedPolySelection'),body=n.body.getStart(ast)-n.getStart(ast)+1,end=text.indexOf('frameCommitPolySelectionPresentation(result);');assert(end>body);const expected=text.slice(body,end).trim(),integration=fs.readFileSync(path.join(root,'editor-source/ordinary-move-integration.mjs'),'utf8'),tree=ts.createSourceFile('integration',integration,99,true,1),helper=tree.statements.find(q=>ts.isFunctionDeclaration(q)&&q.name?.text==='frameCommitPreparedPolySelectionState');assert(helper);assert.equal(helper.body.getText(tree).slice(1,-1).trim(),expected,'Shared lightweight selection bookkeeping equals frozen commit');return text.slice(0,body)+'\n frameCommitPreparedPolySelectionState(result);\n '+text.slice(end);},
  frameStartNativeConnected:text=>{const start='job.promise=framePrepareNativeConnected(options,',end='return true;\n  }).catch';assert.equal(text.split(start).length-1,1);assert.equal(text.split(end).length-1,1);return text.replace(start,"const ordinary=frameOrdinaryConnected(options,{signal:controller.signal,isCurrent:()=>!controller.signal.aborted&&valid()});job.ordinary=ordinary;\n  job.promise=(ordinary?ordinary.promise.then(()=>true):framePrepareNativeConnected(options,").replace(end,'return true;\n  })).catch').replace('tasks.dispose();removeEventListener','job.ordinary=null;tasks.dispose();removeEventListener');},
  resolveVertexToolSnap:text=>{const start='  let r = rectFor(vi)',prefix="  if(!preparedNative?.snapVertexPrepared){const query=frameOrdinaryToolSnap(cx,cy,vi,allowFace,kind);if(query)return query;}\n  if(preparedNative?.snapCurrent&&!preparedNative.snapCurrent())throw new DOMException('Snap context changed','AbortError');\n";assert.equal(text.split(start).length-1,1);text=text.replace(start,prefix+"  if(preparedNative?.edgePrepared&&preparedNative.hit?.isCurrent&&!preparedNative.hit.isCurrent())throw new DOMException('Native edge snap changed','AbortError');\n"+start);text=text.replace('let vh = reliableHoverVertex(cx, cy, cam, r, vertexThrough, 10)','let vh = preparedNative?.snapVertexPrepared?preparedNative.snapVertexHit:reliableHoverVertex(cx, cy, cam, r, vertexThrough, 10)');text=text.replace('p.fromBufferAttribute(vh.mesh.geometry.attributes.position, vh.vi).applyMatrix4(vh.mesh.matrixWorld)','vh.world?p.copy(vh.world):p.fromBufferAttribute(vh.mesh.geometry.attributes.position, vh.vi).applyMatrix4(vh.mesh.matrixWorld)');text=text.replace('eh = preparedNative?preparedNative.hit:','eh = preparedNative?.edgePrepared?preparedNative.hit:');const edge='if(eh?.then)return eh.then(hit=>resolveVertexToolSnap(cx,cy,vi,allowFace,{hit},kind));';assert.equal(text.split(edge).length-1,1);return text.replace(edge,"if(eh?.then){const reuse={...preparedNative,snapVertexPrepared:true,snapVertexHit:vh,snapCurrent:preparedNative?.snapCurrent??frameOrdinarySnapGuard(vi,kind)};return eh.then(hit=>resolveVertexToolSnap(cx,cy,vi,allowFace,{...reuse,edgePrepared:true,hit},kind));}");},
  doPick:text=>{const before="return frameNativeCommitClick(()=>doPick(event,{hit}));",after="const vertex=polyMode&&polyElementMode==='vertex'&&!vertexTools.mode?await frameOrdinaryVertexPick(event.clientX,event.clientY,vi,r,vpState.views[vi].cam,current,{radius:event.ctrlKey||event.metaKey?Math.max(EDIT_HIT_PX,10):EDIT_HIT_PX}):{handled:false,release(){}};\ntry{if(!current()||vertex.handled&&!vertex.isCurrent())throw new DOMException('Vertex click context changed before commit','AbortError');const vertexHit=vertex.hit&&vertex.hit.d<=EDIT_HIT_PX*EDIT_HIT_PX?vertex.hit:null;let addPointSnap=null,addPointSnapPrepared=false;if((event.ctrlKey||event.metaKey)&&vertex.handled&&!vertexHit){addPointSnap=await resolveVertexToolSnap(event.clientX,event.clientY,vi,true,{snapVertexPrepared:true,snapVertexHit:vertex.hit&&vertex.hit.d<=100?vertex.hit:null,snapCurrent:current},'click');addPointSnapPrepared=true;if(!current()||!vertex.isCurrent())throw new DOMException('Ctrl click context changed before commit','AbortError');}return frameNativeCommitClick(()=>doPick(event,{hit,vertexPrepared:vertex.handled,vertexHit,addPointSnapPrepared,addPointSnap}));}finally{vertex.release();}";assert.equal(text.split(before).length-1,1);text=text.replace(before,after);const pre='!reliableHoverVertex(e.clientX, e.clientY, vpState.views[vi].cam, r, selectionThroughShading(vi))';assert.equal(text.split(pre).length-1,1);text=text.replace(pre,'!(preparedNative?.vertexPrepared?preparedNative.vertexHit:reliableHoverVertex(e.clientX, e.clientY, vpState.views[vi].cam, r, selectionThroughShading(vi)))');const add='addPointAt(e.clientX,e.clientY,vi)';assert.equal(text.split(add).length-1,1);return text.replace(add,'addPointAt(e.clientX,e.clientY,vi,preparedNative?.addPointSnapPrepared?{snap:preparedNative.addPointSnap}:null)');},
  polyClickPick:text=>{const before='let hit2 = reliableHoverVertex(cx, cy, cam, r, selectionThroughShading(vi));';assert.equal(text.split(before).length-1,1);return text.replace(before,'let hit2 = preparedNative?.vertexPrepared?preparedNative.vertexHit:reliableHoverVertex(cx, cy, cam, r, selectionThroughShading(vi));');},
  frameBindNativeDoubleClick:text=>{const before='return framePolySelectionJob?.promise;';assert.equal(text.split(before).length-1,1);return text.replace(before,'return framePolySelectionJob?.promise||frameOrdinaryPrepared?.promise;');}
 })){const n=ast.statements.findLast(q=>ts.isFunctionDeclaration(q)&&q.name?.text===name);assert(n,name);edits.push({start:n.getStart(ast),end:n.end,code:replace(n.getText(ast))});}
 const keyCallbacks=[];for(const statement of ast.statements){if(!ts.isExpressionStatement(statement))continue;const call=statement.expression;if(!ts.isCallExpression(call)||!ts.isIdentifier(call.expression)||call.expression.text!=='addEventListener'||call.arguments[0]?.text!=='keydown')continue;const callback=call.arguments[1];if(callback?.body&&callback.getText(ast).includes('if(uvEdit&&gizDrag&&e.key==='))keyCallbacks.push(callback);}
 assert.equal(keyCallbacks.length,1,'Real viewport keydown entry');const keyBody=keyCallbacks[0].body;edits.push({start:keyBody.getStart(ast)+1,end:keyBody.getStart(ast)+1,code:'\nframeOrdinaryModifierKey(e,true);if(frameOrdinaryEscape(e))return;\n'});
 const upCallbacks=[];for(const statement of ast.statements){if(!ts.isExpressionStatement(statement))continue;const call=statement.expression;if(!ts.isCallExpression(call)||!ts.isIdentifier(call.expression)||call.expression.text!=='addEventListener'||call.arguments[0]?.text!=='keyup')continue;const cb=call.arguments[1];if(cb?.body&&cb.getText(ast).includes('pivotKeyDown'))upCallbacks.push(cb);}assert.equal(upCallbacks.length,1,'Real viewport keyup entry');edits.push({start:upCallbacks[0].body.getStart(ast)+1,end:upCallbacks[0].body.getStart(ast)+1,code:'\nframeOrdinaryModifierKey(e,false);\n'});
 for(const[name,code]of Object.entries(prefixes)){const n=ast.statements.findLast(q=>ts.isFunctionDeclaration(q)&&q.name?.text===name);assert(n?.body,name);edits.push({start:n.body.getStart(ast)+1,end:n.body.getStart(ast)+1,code:'\n'+code+'\n'});}
 const deletion=ast.statements.findLast(q=>ts.isFunctionDeclaration(q)&&q.name?.text==='cmdDelete'),returned=deletion.body.statements.find(q=>ts.isReturnStatement(q)&&ts.isObjectLiteralExpression(q.expression)),undo=returned.expression.properties.find(q=>ts.isMethodDeclaration(q)&&q.name?.getText(ast)==='undo');assert(undo?.body);
 edits.push({start:undo.body.end-1,end:undo.body.end-1,code:'\nframeOrdinaryRestoreHistoryOwners(list,frameOrdinaryDeleteEpoch);\n'});
 let mapHooks=0;const walkMaps=n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&ts.isIdentifier(n.expression.expression)&&['OBJ','pickMeshes'].includes(n.expression.expression.text)){const name=n.expression.name.text,helper={set:'frameOrdinarySetMap',delete:'frameOrdinaryDeleteMap',clear:'frameOrdinaryClearMap'}[name];if(helper){edits.push({start:n.getStart(ast),end:n.end,code:`${helper}(${n.expression.expression.text}${n.arguments.length?',':''}${n.arguments.map(q=>q.getText(ast)).join(',')})`});mapHooks++;}}ts.forEachChild(n,walkMaps);};walkMaps(ast);assert(mapHooks>0);
 const ray=ast.statements.findLast(q=>ts.isFunctionDeclaration(q)&&q.name?.text==='acceleratedObjectRaycast');
 let raySource=ray.getText(ast);const old=raySource;
 raySource=raySource.replace('const entry=node=>','const envelope=frameOrdinaryBvhEnvelope(g);const lower=(i)=>bounds[i]+(envelope?.min[i%6]??0),upper=(i)=>bounds[i]+(envelope?.max[i%6-3]??0);\n const entry=node=>');
 raySource=raySource.replaceAll('bounds[at+k+3]','upper(at+k+3)').replaceAll('bounds[at+k]','lower(at+k)');assert.notEqual(raySource,old);
 edits.push({start:ray.getStart(ast),end:ray.end,code:raySource});
 const first=ast.statements.find(q=>!ts.isImportDeclaration(q));
 const integration=fs.readFileSync(path.join(root,'editor-source/ordinary-move-integration.mjs'),'utf8');
 edits.push({start:first.getStart(ast),end:first.getStart(ast),code:"import {OrdinaryMoveActor} from '../native-source/ordinary-move-actor.mjs';\n"+integration+'\n'});
 let candidate=source;for(const e of edits.sort((a,b)=>b.start-a.start))candidate=candidate.slice(0,e.start)+e.code+candidate.slice(e.end);
 const parsed=ts.createSourceFile('ordinary-move-candidate',candidate,99,true,1);assert.equal(parsed.parseDiagnostics.length,0);
 fs.writeFileSync(path.join(root,'modules/editor.ordinary-move.qa.js'),candidate);
 const html=fs.readFileSync(path.join(root,'editor-source/ordinary-move-base-index.html'),'utf8');assert(html.includes('modules/editor.b46b7edb7b8fab6c0f1e.js'));
 let candidateHtml=html.replaceAll('modules/editor.b46b7edb7b8fab6c0f1e.js','modules/editor.ordinary-move.qa.js');
 candidateHtml=candidateHtml.replace(/(<script id="frame-assets" type="application\/json">)([\s\S]*?)(<\/script>)/,(all,before,json,after)=>{const assets=JSON.parse(json);const editor=Object.values(assets.assets).find(q=>q.path.includes('editor.ordinary-move.qa.js'));assert(editor);editor.sha256=createHash('sha256').update(candidate).digest('hex');editor.bytes=Buffer.byteLength(candidate);return before+JSON.stringify(assets)+after;});
 candidateHtml=candidateHtml.replace(/(<script type="importmap">)([\s\S]*?)(<\/script>)/,(all,before,json,after)=>{const map=JSON.parse(json);assert.equal(map.imports.editor,'./modules/editor.ordinary-move.qa.js');map.integrity[map.imports.editor]='sha256-'+createHash('sha256').update(candidate).digest('base64');return before+JSON.stringify(map)+after;});
 const inputPrefix='<input type="file" id="fileInput" multiple style="display:none"';
 assert.equal(candidateHtml.split(inputPrefix).length-1,1);
 candidateHtml=candidateHtml.replace(inputPrefix,'<input type="file" id="fileInput" multiple aria-label="Open file (QA)" style="display:block;position:fixed;right:16px;bottom:16px;z-index:100002;background:#303236;color:#eee;padding:8px;width:280px"');
 fs.writeFileSync(path.join(root,'ordinary-move-qa.html'),candidateHtml);
 console.log(JSON.stringify({candidate:true,editedFunctions:Object.keys(prefixes),mapMutationHooks:mapHooks,bytes:Buffer.byteLength(candidate),sha256:createHash('sha256').update(candidate).digest('hex'),baselineChanged:false}));
}
