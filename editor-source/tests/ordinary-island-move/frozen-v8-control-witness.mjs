// Exact AST slices of frozen V8 2a577c38cfee6ac641e6cc54f3bb5141295e9dba64083aea29830b13fb281c21. Public code; fixture only.
function logicalVertexGroups(geometry) {
  let groups = vertexGroupCache.get(geometry);
  if (groups) return groups;
  let pos = geometry.attributes.position, byPosition = /* @__PURE__ */ new Map();
  groups = [];
  for (let i = 0; i < pos.count; i++) {
    let key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`, group = byPosition.get(key);
    group || (group = [], byPosition.set(key, group), groups.push(group)), group.push(i);
  }
  let groupOf = new Array(pos.count);
  for (let group of groups) for (let vi of group) groupOf[vi] = group;
  return vertexGroupCache.set(geometry, groups), vertexGroupOfCache.set(geometry, groupOf), groups;
}

function reliableHoverVertex(cx, cy, cam, r, through = !1, radius = EDIT_HIT_PX) {
   
   
   
  const candidates=[],world=new THREE2.Vector3(),ndc=new THREE2.Vector3();
  for(const h of selNodes){
    const mesh=pickMeshes.get(h),pos=isVertexEditableMesh(h)?mesh?.geometry?.attributes?.position:null;
    if(!mesh||!pos||!isVertexEditableMesh(h)||!effectiveVisible(h))continue;
    mesh.updateMatrixWorld(true);
    for(const group of logicalVertexGroups(mesh.geometry)){
      world.fromBufferAttribute(pos,group[0]).applyMatrix4(mesh.matrixWorld);ndc.copy(world).project(cam);
      if(ndc.z < -1 || ndc.z > 1)continue;
      const sx=(ndc.x*.5+.5)*r.w+r.x,sy=(-ndc.y*.5+.5)*r.h+r.y,d=(sx-cx)*(sx-cx)+(sy-cy)*(sy-cy);
      if(d<=radius*radius&&(through||exactVertexVisible(world,ndc,cam)))candidates.push({mesh,h,vi:group[0],vertices:group,d,depth:ndc.z});
    }
  }
  candidates.sort((a,b)=>a.d-b.d||a.depth-b.depth);return candidates[0]||null;
}

function resolveVertexToolSnap(cx, cy, vi, allowFace = !0,preparedNative=null,kind="hover") {
  let r = rectFor(vi), cam = vpState.views[vi].cam, wire = viewShading[vi] === 1, vertexThrough = selectionThroughShading(vi);
  if (!r) return null;
  let vh = reliableHoverVertex(cx, cy, cam, r, vertexThrough, 10), p = new THREE2.Vector3();
  if (vh) {
    vh.mesh.updateMatrixWorld(!0), p.fromBufferAttribute(vh.mesh.geometry.attributes.position, vh.vi).applyMatrix4(vh.mesh.matrixWorld);
    let s = projectPx(p, cam, r);
    return { type: "vertex", h: vh.h, mesh: vh.mesh, vi: vh.vi, world: p.clone(), screen: [s[0], s[1]] };
  }
  let edgeResult = (eh2) => {
    let pos2 = eh2.mesh.geometry.attributes.position, a = new THREE2.Vector3(), b = new THREE2.Vector3();
    eh2.mesh.updateMatrixWorld(!0), a.fromBufferAttribute(pos2, eh2.edge[0]).applyMatrix4(eh2.mesh.matrixWorld), b.fromBufferAttribute(pos2, eh2.edge[1]).applyMatrix4(eh2.mesh.matrixWorld);
    let A = projectPx(a, cam, r), B = projectPx(b, cam, r), dx = B[0] - A[0], dy = B[1] - A[1], screenT = THREE2.MathUtils.clamp(((cx - A[0]) * dx + (cy - A[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1), ca = new THREE2.Vector4(a.x, a.y, a.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix), cb = new THREE2.Vector4(b.x, b.y, b.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix), den = (1 - screenT) * cb.w + screenT * ca.w, t = Math.abs(den) > 1e-12 ? screenT * ca.w / den : screenT;
    return { type: "edge", h: eh2.h, mesh: eh2.mesh, edge: eh2.edge, keys: eh2.keys, world: a.clone().lerp(b, t), screen: [A[0] + dx * screenT, A[1] + dy * screenT] };
  }, eh = preparedNative?preparedNative.hit:vpState.renderer?.isFrameNativeViewportRenderer?frameNativeEdgeRequest(cx,cy,cam,r,10,kind):reliableHoverEdge(cx, cy, cam, r, wire, 10);
  if(eh?.then)return eh.then(hit=>resolveVertexToolSnap(cx,cy,vi,allowFace,{hit},kind));
  if (eh) return edgeResult(eh);
  if (!allowFace) return null;
  let fh = reliableFaceHit(cx, cy, cam, r, wire), h = fh && meshToHash.get(fh.object);
  if (!fh || !h || !selNodes.has(h) || !isVertexEditableMesh(h)) return null;
  let mesh = fh.object;
  mesh.updateMatrixWorld(!0);
  let g = mesh.geometry, pos = g.attributes.position, idx = g.index, ids = [idx ? idx.getX(fh.faceIndex * 3) : fh.faceIndex * 3, idx ? idx.getX(fh.faceIndex * 3 + 1) : fh.faceIndex * 3 + 1, idx ? idx.getX(fh.faceIndex * 3 + 2) : fh.faceIndex * 3 + 2], worlds = ids.map((i) => new THREE2.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)), screens = worlds.map((v) => projectPx(v, cam, r)), best = -1, bd = 100;
  for (let i = 0; i < 3; i++) {
    let d = pointSegDistSq(cx, cy, screens[i][0], screens[i][1], screens[(i + 1) % 3][0], screens[(i + 1) % 3][1]);
    d <= bd && (bd = d, best = i);
  }
  if (best >= 0) return edgeResult({ h, mesh, edge: [ids[best], ids[(best + 1) % 3], polyEdgeKey(ids[best], ids[(best + 1) % 3])], keys: [polyEdgeKey(ids[best], ids[(best + 1) % 3])] });
  let world = fh.point ? fh.point.clone() : pickRay.ray.at(fh.distance, new THREE2.Vector3());
  return { type: "face", h, mesh, faceIndex: fh.faceIndex, world, screen: [cx, cy] };
}

function frameOrdinarySupported(){
 if(!polyFocusActive()||splineFocusActive()||uvMode||uvEdit||editPivot||vertexTools.soft.active||polyExactEdgeVertices||polySelection.items.size!==1||!['vertex','edge','face'].includes(polyElementMode))return false;
 const [h,s]=polySelection.items.entries().next().value,m=pickMeshes.get(h),g=m?.geometry;
 return !!m&&selNodes.has(h)&&!!(s.vertices.size+s.edges.size+s.faces.size)&&!frameMorphTag(h)&&polygonShadingAllowed(m)&&Object.keys(g.attributes).every(k=>k==='position'||k==='normal')&&g.attributes.position.array instanceof Float32Array&&g.attributes.normal?.array instanceof Float32Array&&(g.index?.array instanceof Uint16Array||g.index?.array instanceof Uint32Array)&&!!frameRigidOwnerSnapshot().pool;
}

function frameOrdinaryHover(cx,cy,preparedNative){
 if(preparedNative||!frameOrdinarySupported()||polyElementMode!=='vertex'||vertexTools.mode||!vpState.renderer?.isFrameNativeViewportRenderer)return false;
 const vi=viewAt(cx,cy),rect=rectFor(vi);if(vi<0||!rect)return false;
 const cam=vpState.views[vi].cam,intent=++frameNativeHoverIntent,current=frameNativePickerGuard(vi,'hover');
 clearPolyHover(true);frameOrdinaryHoverState.latest={cx,cy,vi,rect,cam,intent,current};frameOrdinaryDrainHover();return true;
}

function onMove(e) {
if(frameOrdinaryDrainPointer(e))return;

  if (mobileTouchMove(e)) return;if(frameAffinePendingPointerMove(e))return;
  if (edgeBevelTool?.dragging) {updateEdgeBevel(e);return;}
  if (splineBevelTool?.dragging) {
    updateSplineBevelTool(e);
    return;
  }
  if (splineOutlineTool?.dragging) {
    updateSplineOutlineTool(e);
    return;
  }
  if (gizDrag && !splinePointerGesture?.direct) {
    if(polyFocusActive()&&!editPivot&&!uvEdit)frameQueuePolygonGizmoMove(e);else doGizDrag(e);
    return;
  }
  if (splinePointerGesture) {
    let g = splinePointerGesture, dragged = Math.hypot(e.clientX - g.x, e.clientY - g.y) >= TAP_PX;
    !g.direct && dragged && !splineDrawing && g.hit && !(g.ctrl && g.hit.kind === "segment") && beginSplineDirectDrag(g, e), g.direct ? moveSplineDirectDrag(g, e) : (dragged && (splineDrawing || g.ctrl && !g.hit) ? updateSplineDrawGesturePreview(g, e) : hideSplineDrawPreview(), setSplineHover(splineScreenHit(e.clientX, e.clientY), !!(e.ctrlKey || e.metaKey)));
    return;
  }
  if (polyMode && (vertexTools.mode === "lineCut" || vertexTools.mode === "closeHole" || vertexTools.mode === "addPoint" && polyElementMode === "vertex") && activeView >= 0) {
    let r2 = rectFor(activeView);
    if (!r2) return;
    let dx2 = e.clientX - lastX, dy2 = e.clientY - lastY;
    lastX = e.clientX, lastY = e.clientY, Math.hypot(e.clientX - downX, e.clientY - downY) >= TAP_PX ? (vpState.views[activeView].ctrl.move(e, r2, !0, dx2, dy2), scheduleRender()) : vertexTools.mode === "lineCut" ? updateLineCutPreview(e.clientX, e.clientY, activeView) : vertexTools.mode === "closeHole" ? updateCloseHolePreview(e.clientX, e.clientY, activeView) : updateAddPointPreview(e.clientX, e.clientY, activeView);
    return;
  }
  // A DOM-only marquee does not move the camera. Do not queue identical 3D
  // frames for its pointer moves; they can delay both feedback and menus.
  if(frameCancelViewportMarquee&&e.buttons===LMB){lastX=e.clientX;lastY=e.clientY;return;}
  if(frameCancelViewportMarquee&&(e.buttons&(RMB|MMB)))frameCancelViewportMarquee();
  if (activeView < 0) {
    if (polyMode && polyElementMode === "vertex" && !vertexTools.mode && (e.ctrlKey || e.metaKey)) {
      let vi = viewAt(e.clientX, e.clientY);
      clearPolyHover(), vi >= 0 && updateAddPointPreview(e.clientX, e.clientY, vi);
      return;
    }
    !vertexTools.mode && vertexTools.snap && hideVertexToolGuides(), updateHover(e.clientX, e.clientY, e);
    return;
  }
  let r = rectFor(activeView);
  if (!r) return;
  let dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX, lastY = e.clientY, vpState.views[activeView].ctrl.move(e, r, Math.hypot(e.clientX - downX, e.clientY - downY) >= TAP_PX, dx, dy), scheduleRender();
}

function updateHover(cx, cy, mods = {}) {
  const signature=()=>[polyHover.kind,polyHover.view,...(polyHover.kind==='face'?polyHover.facePos:polyHover.kind==='edge'?polyHover.edgePos:polyHover.kind==='vertex'?polyHover.vertexPos:[])].join(',');
  const before=signature(),old=hovObj;
  let g=hitGizmo(cx,cy),splineHit=!g&&splineMode?splineScreenHit(cx,cy):null,obj=g?g.object:null;
  if(obj!==hovObj){clearHover();if(obj){hovObj=obj;hovObj.material.opacity=1;}}
  if(!obj&&splineHit){clearPolyHover();setSplineHover(splineHit,!!(mods.ctrlKey||mods.metaKey));}
  else if(obj){clearPolyHover();clearSplineHover();}
  else{clearSplineHover();if(polyMode)updatePolyHover(cx,cy);else clearPolyHover();}
  if(old!==hovObj||before!==signature())scheduleRender();
}

function updatePolyHover(cx, cy,preparedNative=null) {
if(frameOrdinaryHover(cx,cy,preparedNative))return;

  const nativeIntent=preparedNative?.intent??++frameNativeHoverIntent;
  if (!polyMode) {
    clearPolyHover();
    return;
  }
  let vi = viewAt(cx, cy);
  if (vi < 0) {
    clearPolyHover();
    return;
  }
  let r = rectFor(vi);
  if (!r) {
    clearPolyHover();
    return;
  }
  if (vertexTools.mode === "lineCut") {
    clearPolyHover(), updateLineCutPreview(cx, cy, vi);
    return;
  }
  if (polyElementMode === "face" && vertexTools.mode === "closeHole") {
    clearPolyHover(), updateCloseHolePreview(cx, cy, vi);
    return;
  }
  if (polyElementMode === "vertex" && vertexTools.mode === "addPoint") {
    clearPolyHover(), updateAddPointPreview(cx, cy, vi);
    return;
  }
  if ((polyElementMode === "vertex" || polyElementMode === "edge") && vertexTools.mode === "loop") {
    clearPolyHover(), updateLoopPreview(cx, cy, vi);
    return;
  }
  if (polyElementMode === "vertex") {
    let hit2 = preparedNative?.vertexPrepared?preparedNative.vertexHit:reliableHoverVertex(cx, cy, vpState.views[vi].cam, r, selectionThroughShading(vi));
    if (clearPolyHover(), vertexTools.soft.active) {
      let sig = hit2 ? `${hit2.h}:${hit2.vi}` : "none";
      sig !== vertexTools.soft.hoverSig && (vertexTools.soft.hoverSig = sig, updateSoftPreview(hit2 ? { h: hit2.h, vi: hit2.vi } : null));
    }
    if (!hit2) return;
    let p = hit2.mesh.geometry.attributes.position, q2 = polyHover.vertexPos;
    hit2.mesh.updateMatrixWorld(!0), _ph0.fromBufferAttribute(p, hit2.vi).applyMatrix4(hit2.mesh.matrixWorld), q2[0] = _ph0.x, q2[1] = _ph0.y, q2[2] = _ph0.z, polyHover.vertex.geometry.attributes.position.needsUpdate = !0, polyHover.view = vi, polyHover.kind = "vertex";
    return;
  }
  if (polyElementMode === "edge") {
    let hit2 = preparedNative?preparedNative.hit:reliableHoverEdge(cx, cy, vpState.views[vi].cam, r, viewShading[vi] === 1);
    if(hit2?.then)return hit2.then(hit=>{if(nativeIntent!==frameNativeHoverIntent||hit&&!hit.isCurrent())throw new DOMException('Pointer intent changed','AbortError');updatePolyHover(cx,cy,{hit,intent:nativeIntent});scheduleRender();}).catch(frameNativePickerError);
    if (clearPolyHover(true), !hit2) return;
    let p = hit2.mesh.geometry.attributes.position, q2 = polyHover.edgePos;
    hit2.mesh.updateMatrixWorld(!0), _ph0.fromBufferAttribute(p, hit2.edge[0]).applyMatrix4(hit2.mesh.matrixWorld), _ph1.fromBufferAttribute(p, hit2.edge[1]).applyMatrix4(hit2.mesh.matrixWorld), q2.set([_ph0.x, _ph0.y, _ph0.z, _ph1.x, _ph1.y, _ph1.z]), polyHover.edge.geometry.attributes.position.needsUpdate = !0, polyHover.view = vi, polyHover.kind = "edge";
    return;
  }
  let cam = vpState.views[vi].cam, hit = reliableFaceHit(cx, cy, cam, r, viewShading[vi] === 1);
  if (!hit || hit.faceIndex == null) {
    clearPolyHover();
    return;
  }
  let mesh = hit.object, meshHash = meshToHash.get(mesh);
  if (!meshHash || !selNodes.has(meshHash) || !isVertexEditableMesh(meshHash)) {
    clearPolyHover();
    return;
  }
  let geo = mesh.geometry, pos = geo.attributes.position, idx = geo.index, fi = hit.faceIndex, ia = idx ? idx.getX(fi * 3) : fi * 3, ib = idx ? idx.getX(fi * 3 + 1) : fi * 3 + 1, ic = idx ? idx.getX(fi * 3 + 2) : fi * 3 + 2;
  mesh.updateMatrixWorld(!0), _ph0.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld), _ph1.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld), _ph2.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
  let a = projectPx(_ph0, cam, r), b = projectPx(_ph1, cam, r), c = projectPx(_ph2, cam, r), V = [_ph0, _ph1, _ph2], P = [a, b, c], viMin = 0, vd = 1 / 0;
  for (let i = 0; i < 3; i++) {
    let d = (cx - P[i][0]) ** 2 + (cy - P[i][1]) ** 2;
    d < vd && (vd = d, viMin = i);
  }
  let ei = 0, ed = 1 / 0;
  for (let i = 0; i < 3; i++) {
    let d = pointSegDistSq(cx, cy, P[i][0], P[i][1], P[(i + 1) % 3][0], P[(i + 1) % 3][1]);
    d < ed && (ed = d, ei = i);
  }
  if (clearPolyHover(), polyHover.view = vi, polyElementMode === "vertex") {
    if (vd > 100) return;
    let v = V[viMin], q2 = polyHover.vertexPos;
    q2[0] = v.x, q2[1] = v.y, q2[2] = v.z, polyHover.vertex.geometry.attributes.position.needsUpdate = !0, polyHover.kind = "vertex";
    return;
  }
  if (polyElementMode === "edge") {
    if (ed > 100) return;
    let u = V[ei], v = V[(ei + 1) % 3], q2 = polyHover.edgePos;
    q2[0] = u.x, q2[1] = u.y, q2[2] = u.z, q2[3] = v.x, q2[4] = v.y, q2[5] = v.z, polyHover.edge.geometry.attributes.position.needsUpdate = !0, polyHover.kind = "edge";
    return;
  }
  let q = polyHover.facePos;
  for (let [i, v] of V.entries())
    q[i * 3] = v.x, q[i * 3 + 1] = v.y, q[i * 3 + 2] = v.z;
  polyHover.face.geometry.attributes.position.needsUpdate = !0, polyHover.kind = "face";
}

function clearPolyHover(keepNativeRequest=false) {
  if(!keepNativeRequest&&vpState.renderer?.isFrameNativeViewportRenderer){frameNativeHoverIntent++;frameNativePickerLane?.invalidateHover();}
  polyHover.kind = null, polyHover.view = -1, polyHover.face && (polyHover.face.visible = !1), polyHover.faceBack && (polyHover.faceBack.visible = !1), polyHover.edge && (polyHover.edge.visible = !1), polyHover.vertex && (polyHover.vertex.visible = !1);
}

addEventListener("keydown", (e) => {
if(frameOrdinaryEscape(e))return;

  let mod = e.ctrlKey || e.metaKey;
  if(uvEdit&&gizDrag&&e.key==="Escape"){e.preventDefault();endGizDrag({type:"pointercancel"});return;}
  if(edgeBevelTool&&(e.key==='Escape'||e.key==='Enter')){e.key==='Escape'?cancelEdgeBevel():finishEdgeBevel();hideVertexContextMenu();e.preventDefault();return;}
  if(edgeBevelTool&&!['INPUT','TEXTAREA'].includes(e.target?.tagName)&&!((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase()))){e.preventDefault();return;}
  if (splineBevelTool && e.key === "Escape") {
    cancelSplineBevelTool(), hideVertexContextMenu(), e.preventDefault();
    return;
  }
  if (splineOutlineTool && e.key === "Escape") {
    cancelSplineOutlineTool(), hideVertexContextMenu(), e.preventDefault();
    return;
  }
  if (splineMode && e.key === "Escape") {
    if(splinePointerGesture?.direct){finishSplineDirectDrag(splinePointerGesture,true);splinePointerGesture=null;}
    else if(gizDrag)endGizDrag({type:'pointercancel'});
    splineDrawing && finishSplineDrawing(), hideVertexContextMenu(), e.preventDefault();
    return;
  }
  if ((e.key === "Control" || e.key === "Meta") && (splineMode && updateHover(vpLastX, vpLastY, e), polyMode && polyElementMode === "vertex" && !vertexTools.mode)) {
    let vi = viewAt(vpLastX, vpLastY);
    vi >= 0 && (clearPolyHover(), updateAddPointPreview(vpLastX, vpLastY, vi));
  }
  if (vertexTools.mode === "lineCut" && (finishLineCut(), e.key === "Escape")) {
    e.preventDefault();
    return;
  }
  if (vertexTools.mode === "closeHole" && e.key === "Escape") {
    leaveVertexTool(!1), e.preventDefault();
    return;
  }
  if (vertexTools.mode === "addPoint" && e.key === "Escape") {
    leaveVertexTool(!1), e.preventDefault();
    return;
  }
  if (vertexTools.mode === "loop" && e.key === "Escape") {
    leaveVertexTool(!1), e.preventDefault();
    return;
  }
  if (vertexTools.soft.active && e.key === "Escape") {
    disableSoftSelection(), e.preventDefault();
    return;
  }
  if (mod && e.code === "KeyZ") {
    if (isEditing()) return;
    e.preventDefault(), e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.code === "KeyY") {
    if (isEditing()) return;
    e.preventDefault(), redo();
    return;
  }
  if (mod && e.code === "KeyC" && activeTabId()==="tabMaterials" && selMats.size===1) {
    if (isEditing()) return;const m=getMat([...selMats][0]);if(m)materialClipboard=materialCopyOptions(m,m.name);e.preventDefault();return;
  }
  if (mod && e.code === "KeyV" && activeTabId()==="tabMaterials" && materialClipboard) {
    if (isEditing()) return;e.preventDefault();
    const h=makeMat({...materialClipboard,name:nextMatName(),texBytes:materialClipboard.texBytes||null,mapFrame:materialClipboard.mapFrame?.clone?.()||defaultMapFrame(),mapPivot:materialClipboard.mapPivot?.clone?.()||new THREE2.Matrix4()});addMatCard(h);refreshMatVisuals(h);placeMaterialAfterDefault(h);selectMaterialCard(h);refreshTabActs(activeTabId());return;
  }
  if (mod && e.code === "KeyC") {
    if (isEditing()) return;
    e.preventDefault(), selNodes.size && (clipNodes = [...selNodes]);
    return;
  }
  if (mod && e.code === "KeyV") {
    if (isEditing()) return;
    if (e.preventDefault(), clipNodes && clipNodes.length) {
      frameAffinePasteNodes(clipNodes);
    }
    return;
  }
  if (mod && e.code === "KeyA") {
    if (isEditing()) return;
    if (e.preventDefault(), splineMode || polyMode) {
      if (splineMode) {
        clearSplineBevelResult();splineSelectionClearElements();
        for (let h of selNodes) {const d=evaluatedSplineData(h);if(!d)continue;if(polyElementMode==='vertex')for(let vid of Object.keys(d.vertices||{}))splineSelection.vertices.add(splineElementKey(h,vid));else if(polyElementMode==='edge')for(let sid of Object.keys(d.segments||{}))splineSelection.segments.add(splineElementKey(h,sid));else for(const face of splineSelectableFaces(d)){splineSelection.faces.add(splineElementKey(h,face.id));for(const sid of face.segments)splineSelection.segments.add(splineElementKey(h,sid));}}
        componentFocus='spline';updateAllSplineVisuals();
      }
      polyMode && selectAllPolyElements(), placeGizmoForSelection();
      return;
    }
    selNodes.clear(), selTags.clear();
    for (let h of OBJ.keys()) selNodes.add(h);
    anchorNode = selNodes.size ? getObj(selNodes.values().next().value) : null, refreshSelClasses();
    return;
  }
  if (!mod && !isEditing()) {
    if (e.code === "KeyC") {
      e.preventDefault(); if(!e.repeat)connectDeleteSelection();
      return;
    }
    if (e.code === "KeyU" && !e.altKey && !e.isComposing) {
      if (splineFocusActive()) {
        e.preventDefault();if(!e.repeat){blurActive();selectConnectedSpline();hideVertexContextMenu();}
        return;
      }
      if (polyFocusActive()) {
        e.preventDefault();if(!e.repeat){blurActive();selectConnectedPoly();hideVertexContextMenu();}
        return;
      }
    }
    if (e.code === "KeyW" && !e.altKey && !e.isComposing) {
      e.preventDefault();if(!e.repeat){blurActive();setCoordMode(coordMode === "world" ? "object" : "world");updateHUD();}
      return;
    }
    if (e.code === "KeyS") {
      toggleSnap();
      return;
    }
    if (e.code === "KeyQ") {
      toggleQuant();
      return;
    }
    if (e.code === "KeyP") {
      if (e.repeat) return;
      pivotKeyDown = !0, pivotKeyGesture = !1, pivotKeyRestorePending = !1, pivotKeyOriginal = editPivot, setEditPivot(!editPivot);
      return;
    }
    if (e.code === "KeyZ") {
      e.preventDefault();
      let vi = viewAt(vpLastX, vpLastY);
      vi >= 0 && selNodes.size && (!splineMode || !frameSplineSelection(vi)) && frameHashes(vi, [...selNodes]);
      return;
    }
  }
   
   
  if (activeTabId() === "tabMaterials" && !isEditing() && (e.key === "Delete" || e.key === "Backspace") && selMats.size) {
    e.preventDefault(); runCmd(cmdDeleteMats([...selMats])); return;
  }
  if (!isEditing() && (e.key === "Delete" || e.key === "Backspace") && selTags.size && (treeActive || (!vertexEditActive&&!splineMode&&!polyMode))) {
    e.preventDefault(); const ids = [...selTags]; selTags.clear(); anchorTag = null;
    runCmd(cmdDeleteTags(ids)); renderRows(); refreshSelClasses(); return;
  }
   
   
   
  if (!isEditing() && !treeActive && (e.key === "Delete" || e.key === "Backspace") && (vertexEditActive||splineMode||polyMode)) {
    if(splineDrawing){e.preventDefault();deleteLastSplineDrawPoint();return;}
    const hasSpline=splineMode&&hasSplineElementSelection(),hasPoly=polyMode&&hasPolyElementSelection();
    if(hasSpline||hasPoly){e.preventDefault();hasSpline&&deleteSelectedSplineElements();hasPoly&&deleteSelectedPolyElements();return;}
  }
  if (!isEditing() && (e.key === "Delete" || e.key === "Backspace") && selNodes.size && (treeActive || (!vertexEditActive&&!splineMode&&!polyMode) || (!hasSplineElementSelection()&&!hasPolyElementSelection()))) {
    e.preventDefault(), frameAffineDeleteNodes([...selNodes]);
    return;
  }
  if (!isEditing() && (e.key === "Delete" || e.key === "Backspace") && (selNodes.size || selTags.size)) {
    e.preventDefault();if(selNodes.size)frameAffineDeleteNodes([...selNodes]);else{runCmd(cmdDeleteTags([...selTags]));selTags.clear();renderRows();refreshSelClasses();}
    return;
  }
  if (!treeActive || isEditing()) return;
  let vn = flatRows.map((r) => r.node);
  if (!vn.length) return;
  let cur = anchorNode && vn.includes(anchorNode) ? anchorNode : vn[0], ci = vn.indexOf(cur), sel1 = (n) => {
    selNodes.clear(), selTags.clear(), selNodes.add(n.hash), anchorNode = n, scrollIntoRow(n), refreshSelClasses();
  };
  if (e.key === "ArrowDown")
    e.preventDefault(), sel1(vn[Math.min(ci + 1, vn.length - 1)]);
  else if (e.key === "ArrowUp")
    e.preventDefault(), sel1(vn[Math.max(ci - 1, 0)]);
  else if (e.key === "Home")
    e.preventDefault(), sel1(vn[0]);
  else if (e.key === "End")
    e.preventDefault(), sel1(vn[vn.length - 1]);
  else if (e.key === "ArrowRight") {
    if (e.preventDefault(), cur.children.length)
      if (cur.folded)
        setObjField(cur.hash, "folded", !1), treeChanged();
      else {
        let ch = getObj(cur.children[0]);
        ch && sel1(ch);
      }
  } else e.key === "ArrowLeft" && (e.preventDefault(), cur.children.length && !cur.folded ? (setObjField(cur.hash, "folded", !0), treeChanged()) : cur.parent && sel1(getObj(cur.parent)));
});
