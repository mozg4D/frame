function* frameNativeEdgeSelectionBasisWork(h,ownerRot,items,ready,meshes=pickMeshes) {
  if (polyElementMode !== "edge" || items.size !== 1) return null;
  let s = items.get(h), mesh = meshes.get(h), pos = mesh?.geometry?.attributes.position;
  if (!s?.edges.size || !pos) return null;
  mesh.updateMatrixWorld(!0);
  const chosen=yield* frameSelectedLogicalEdgeRepresentativesWork(mesh.geometry,ready.get(h).topology,s.edges);let work=0;
  if (!chosen.length) return null;
  let a = new THREE2.Vector3(), b = new THREE2.Vector3(), dir = new THREE2.Vector3(), points = [], refDir = null, refPoint = null;
  for (let edge of chosen){
    if((++work&1023)===0)yield;
    if (a.fromBufferAttribute(pos, edge.a).applyMatrix4(mesh.matrixWorld), b.fromBufferAttribute(pos, edge.b).applyMatrix4(mesh.matrixWorld), dir.subVectors(b, a), !(dir.lengthSq() < 1e-16)) {
      if (dir.normalize(), !refDir)
        refDir = dir.clone(), refPoint = a.clone();
      else if (dir.dot(refDir) < 0 && dir.negate(), dir.dot(refDir) < 0.9999) return null;
      points.push(a.clone(), b.clone());
    }
  }
  if (!refDir) return null;
  let oe = ownerRot.elements, ownerX = new THREE2.Vector3(oe[0], oe[1], oe[2]);
  refDir.dot(ownerX) < 0 && refDir.negate();
  let span = 0;
  for (let p of points){span = Math.max(span, p.distanceTo(refPoint));if((++work&1023)===0)yield;}
  let tol = Math.max(1e-5, span * 1e-5);
  for (let p of points) {
    let d = p.clone().sub(refPoint), along = refDir.clone().multiplyScalar(d.dot(refDir));
    if (d.sub(along).length() > tol) return null;
    if((++work&1023)===0)yield;
  }
  let ownerY = new THREE2.Vector3(oe[4], oe[5], oe[6]), ownerZ = new THREE2.Vector3(oe[8], oe[9], oe[10]), y = ownerY.addScaledVector(refDir, -ownerY.dot(refDir));
  y.lengthSq() < 1e-10 && (y = ownerZ.addScaledVector(refDir, -ownerZ.dot(refDir))), y.normalize();
  let z = refDir.clone().cross(y).normalize();
  return y = z.clone().cross(refDir).normalize(), new THREE2.Matrix4().makeBasis(refDir, y, z);
}
function* frameNativeEdgeClickMeasurementsWork(items,ready,exact=polyExactEdgeVertices,meshes=pickMeshes,pivot=null){
  if(polyElementMode!=='edge'||!polyFocusActive()||splineFocusActive()||uvEdit||vertexTools.soft.active||!items.size)return null;
  const selected=new Map(),mn=new THREE2.Vector3(Infinity,Infinity,Infinity),mx=new THREE2.Vector3(-Infinity,-Infinity,-Infinity),p=new THREE2.Vector3();let any=false,work=0;
  for(const [h] of items){
    const mesh=meshes.get(h),pos=mesh?.geometry?.attributes.position;if(!pos)continue;
    mesh.updateMatrixWorld(true);
    const ids=yield* frameNativeEdgeSelectedVertexIdsWork(h,items,ready,exact);selected.set(h,ids);
    for(const i of ids){p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);mn.min(p);mx.max(p);any=true;if((++work&1023)===0)yield;}
  }
  if(!any)return null;
  let h=null;for(const key of items.keys())if(meshes.has(key)){h=key;break;}h??=selNodes.values().next().value||null;
  let frame;
  if(pivot&&coordMode==='object'){frame=new THREE2.Matrix4().fromArray(pivot);rotMatOfLin(frame,frame);frame.setPosition(0,0,0);}
  else if(coordMode==='world')frame=new THREE2.Matrix4();
  else{const owner=pureWorldFrame(h);frame=(yield* frameFaceSelectionBasisWork(h,owner,items,meshes))||(yield* frameNativeEdgeSelectionBasisWork(h,owner,items,ready,meshes))||owner;}
  frame.setPosition(pivot?new THREE2.Vector3().setFromMatrixPosition(new THREE2.Matrix4().fromArray(pivot)):mn.clone().add(mx).multiplyScalar(.5));
  const inv=frame.clone().invert(),lo=new THREE2.Vector3(Infinity,Infinity,Infinity),hi=new THREE2.Vector3(-Infinity,-Infinity,-Infinity);
  for(const [h,ids] of selected){
    const mesh=meshes.get(h),pos=mesh.geometry.attributes.position;mesh.updateMatrixWorld(true);
    for(const i of ids){p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);lo.min(p);hi.max(p);if((++work&1023)===0)yield;}
  }
  return {bounds:{min:mn,max:mx},frame,extent:hi.sub(lo),selectedIDs:selected};
}
