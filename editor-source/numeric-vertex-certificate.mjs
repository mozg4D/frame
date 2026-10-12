// A numeric publication may renumber or split raw vertices. Certify the final
// arrays and selection anew; retain only the unchanged outside contact guard.
function* frameNumericVertexCertificateWork(s,b,t,snapshot,g,entry){
 if(s.closed||s.row?.cancelled)return null;
 if(b.domain!=='vertex'||!entry||entry.edges.size||entry.faces.size||!t?.eligible||t.status!=='ready'||!frameRigidSelection(t,true)||t.mesh!==b.mesh||t.g!==b.g||t.entry!==b.entry||t.stableFaceComponent!==true)return null;
 if(!snapshot.componentStable||!snapshot.selectedExclusive||!snapshot.outsideCanonical||!snapshot.outsidePositionsUnchanged||snapshot.cornerPositionsUnchanged!==true||snapshot.aliasGuard!==t.aliasGuard)return null;
 const scope=frameComponentScopeCertificate(t);if(!scope||scope.g!==b.g||scope.guard!==t.aliasGuard||!scope.faces?.length)return null;
 const p=g?.attributes?.position,n=g?.attributes?.normal,index=g?.index;
 if(!p||!n||!index||p.itemSize!==3||n.itemSize!==3||index.itemSize!==1||p.count!==n.count||index.count!==t.ia.length||!(p.array instanceof Float32Array)||!(n.array instanceof Float32Array)||!(index.array instanceof Uint32Array))return null;
 const sourceStamp=frameAffineSourceStamp(b.mesh),stamp=frameAffineSourceStamp({geometry:g}),sets=frameRigidSetSnapshots([entry.faces,entry.vertices,entry.edges]);
 const copies=[[p.array,snapshot.attrs.position.array],[n.array,snapshot.attrs.normal.array],[index.array,snapshot.index]];let work=0;
 for(const[a,z]of copies){if(a.length!==z.length)return null;const x=new Uint32Array(a.buffer,a.byteOffset,a.length),y=new Uint32Array(z.buffer,z.byteOffset,z.length);for(let k=0;k<x.length;k++){if(x[k]!==y[k])return null;if((++work&16383)===0)yield;}}
 const faces=scope.faces.slice(),mask=new Set();let previous=-1;
 for(const face of faces){if(!Number.isInteger(face)||face<=previous||face*3+2>=index.count)return null;previous=face;for(let c=0;c<3;c++){const id=index.array[face*3+c];if(id>=p.count)return null;mask.add(id);}if((++work&1023)===0)yield;}
 if(!mask.size||mask.size>262144||entry.vertices.size!==mask.size||!(snapshot.selectedIDs instanceof Uint32Array)||snapshot.selectedIDs.length!==mask.size)return null;
 const seen=new Set();for(const id of snapshot.selectedIDs){if(!mask.has(id)||seen.has(id))return null;seen.add(id);if((++work&1023)===0)yield;}
 const ids=Uint32Array.from(mask).sort(),slot=new Int32Array(p.count),groups=new Map();
 for(let k=0;k<ids.length;k++){const id=ids[k],at=id*3,x=p.array[at],y=p.array[at+1],z=p.array[at+2];if(!entry.vertices.has(id)||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||scope.guard.find(Math.round(x*1e5),Math.round(y*1e5),Math.round(z*1e5)))return null;slot[id]=k+1;const key=frameAffineNumericMoveKey(p.array,id);let group=groups.get(key);if(!group){group=[];groups.set(key,group);}group.push(id);if((++work&1023)===0)yield;}
 // Stock groups encounter raw IDs in ascending order. Verify the NEW ordered
 // selection, including newly split aliases; no pre-edit ID/order is reused.
 const ordered=entry.vertices.values();for(const group of groups.values())for(const id of group){if(ordered.next().value!==id)return null;if((++work&1023)===0)yield;}if(!ordered.next().done)return null;
 // Explicitly certify complete final faces and exclusive final raw membership.
 let selectedFace=0;for(let f=0;f<index.count/3;f++){const inside=faces[selectedFace]===f;if(inside)selectedFace++;for(let c=0;c<3;c++)if(!!slot[index.array[f*3+c]]!==inside)return null;if((++work&4095)===0)yield;}
 const proof={ids,slot,faceIDs:faces,pa:p.array,ia:index.array,aliasGuard:scope.guard};
 if(!(yield*frameRigidStableFaceComponentWork(proof)))return null;
 if(s.closed||s.row?.cancelled||!frameRigidSelection(t,true)||!frameAffineStampCurrent(sourceStamp)||!frameAffineStampCurrent(stamp)||!frameRigidSetSnapshotsCurrent(sets))return null;
 return{job:s,row:s.row,b,t,snapshot,g,entry,ids,faces,guard:scope.guard,sourceStamp,stamp,sets,revision:framePolySelectionRevision,lifecycle:frameAffineLifecycleGeneration,owner:frameRigidOwnerSnapshot(),used:false};
}
function frameNumericVertexCertificateBeforePublish(c,s,b,g,entry,snapshot){
 return !!c&&!c.used&&c.job===s&&c.row===s.row&&!s.closed&&!s.row?.cancelled&&c.b===b&&c.g===g&&c.entry===entry&&c.snapshot===snapshot&&c.lifecycle===frameAffineLifecycleGeneration&&c.revision===framePolySelectionRevision&&frameRigidOwnerCurrent(c.owner)&&frameRigidSelection(c.t,true)&&frameAffineStampCurrent(c.sourceStamp)&&frameAffineStampCurrent(c.stamp)&&frameRigidSetSnapshotsCurrent(c.sets);
}
function frameNumericVertexCertificatePublish(c,s,b,g,entry,snapshot){
 if(!c||c.used||c.job!==s||c.row!==s.row||s.closed||s.row?.cancelled||c.g!==g||c.entry!==entry||c.snapshot!==snapshot||c.lifecycle!==frameAffineLifecycleGeneration||framePolySelectionRevision!==c.revision+1||!frameRigidOwnerCurrent(c.owner)||OBJ.get(b.h)!==b.node||pickMeshes.get(b.h)!==b.mesh||b.mesh.geometry!==g||polySelection.items.get(b.h)!==entry||polyElementMode!=='vertex'||!polyFocusActive()||!frameAffineStampCurrent(c.stamp)||!frameRigidSetSnapshotsCurrent(c.sets))return false;
 c.used=true;
 const priorKnown=frameAffineKnownGeometry.get(g),priorOwned=frameComponentOwnedSelections.get(entry),priorPrepared=frameRigidPrepared;let known,owned;
 try{
  const context={...b,g,p:g.attributes.position,n:g.attributes.normal,index:g.index,entry,ids:c.ids,faceIDs:c.faces,aliasGuard:c.guard,stableFaceComponent:true,eligible:true};
  if(!frameComponentRebase(context,snapshot,g))return false;
  owned=frameComponentOwnedSelections.get(entry);frameAffineRememberGeometry({h:b.h,mesh:b.mesh,context},snapshot,g);known=frameAffineKnownGeometry.get(g);
  if(!known||!frameAffineKnownIDs(b.h))throw new DOMException('Numeric certificate publication changed','AbortError');
  // Publication has finished installing selection. Preparation reads the final
  // geometry, final IDs and final owner stamps through the existing mapped gate.
  frameRigidSchedulePrepare();return true;
 }catch{
  if(frameAffineKnownGeometry.get(g)===known){if(priorKnown)frameAffineKnownGeometry.set(g,priorKnown);else frameAffineKnownGeometry.delete(g);}
  if(frameComponentOwnedSelections.get(entry)===owned){if(priorOwned)frameComponentOwnedSelections.set(entry,priorOwned);else frameComponentOwnedSelections.delete(entry);}
  const prepared=frameRigidPrepared;if(prepared&&prepared!==priorPrepared&&prepared.g===g){frameRigidPrepared=null;frameRigidDispose(prepared);}return false;
 }
}
