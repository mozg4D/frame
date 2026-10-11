import {deferredEnv,session,THREE2,assert,tick} from '../display/support.mjs';
const rows=[];
for(const change of ['unchanged','cancel','empty-history-undo','geometry-replacement','position-version','selection-replacement','owner-replacement']){
 const {c,t}=deferredEnv(),count=8193,pa=new Float32Array(count*3),na=new Float32Array(count*3),ia=Uint32Array.from({length:count},(_,i)=>i);
 for(let k=0;k<count;k++){pa[k*3]=Math.floor(k/3)*3+(k%3===1?1:0);pa[k*3+1]=k%3===2?1:0;na[k*3+2]=1;}
 const g=new THREE2.BufferGeometry().setAttribute('position',new THREE2.BufferAttribute(pa,3)).setAttribute('normal',new THREE2.BufferAttribute(na,3)).setIndex(new THREE2.BufferAttribute(ia,1)),p=g.attributes.position,n=g.attributes.normal,index=g.index;
 const faces=new Set(Array.from({length:count/3},(_,i)=>i));t.entry.faces=faces;
 Object.assign(t,{g,p,n,index,pa,na,ia,pv:p.version,nv:n.version,iv:index.version,faces,faceIDs:Uint32Array.from(faces),ids:ia.slice(),idSet:new Set(ia),slot:Int32Array.from(ia,x=>x+1),ranges:[[0,count]],originalPositions:pa.slice(),originalNormals:na.slice(),indexSeed:ia.slice(),numeric:{positions:pa.slice(),extras:new Float32Array(count*9)},selectionSets:c.frameRigidSetSnapshots([faces,t.entry.vertices,t.entry.edges])});t.mesh.geometry=g;c.frameRigidExactBounds(t);c.gizDrag={mode:'rotate'};
 const s=session(c,t);s.affine=true;s.beforeValues=pa.slice();s.beforeNormals=na.slice();s.delta.makeRotationZ(.173);s.afterGizmo=s.delta.elements.slice();s.source=c.frameRigidTransactionSnapshot(t);c.frameRigidInput=null;c.frameRigidExecuting=s;c.frameRigidQueue=[s];
 let release,held=0;c.frameAffineYield=()=>{held++;return new Promise(r=>release=r);};const sentinel=Error('pre-authoring checkpoint'),before=pa.slice();let values;
 c.frameRigidAliasSafe=(target,v)=>{assert.equal(target,t);values=v.slice();throw sentinel;};
 const pending=c.frameAffineCommit(s);assert.equal(held,1);assert.deepEqual(pa,before);assert.equal(c.undoStack.length,0);assert.equal(c.redoStack.length,0);
 if(change==='cancel')c.frameRigidCancelSession(s);
 if(change==='empty-history-undo')c.undo();
 if(change==='geometry-replacement')t.mesh.geometry=g.clone();
 if(change==='position-version')p.needsUpdate=true;
 if(change==='selection-replacement')t.entry.faces=new Set(faces);
 if(change==='owner-replacement')c.vpState.renderer={...c.vpState.renderer};
 release();let caught;try{await pending;}catch(e){caught=e;}
 assert(caught);assert.deepEqual(pa,before);assert.equal(c.undoStack.length,0);assert.equal(c.redoStack.length,0);
 if(change==='unchanged'){assert.equal(caught,sentinel);assert(values);const expected=new Float32Array(pa.length),v=new THREE2.Vector3();for(let k=0;k<count;k++)v.fromArray(before,k*3).applyMatrix4(s.world).applyMatrix4(s.delta).applyMatrix4(s.inverse).toArray(expected,k*3);assert.deepEqual(values,expected);}
 else {assert.equal(caught.name,'AbortError');assert.equal(values,undefined);}
 rows.push({change,yields:held,preAuthoringPositionDifferences:0,historyCommands:0,guardRejected:change!=='unchanged',orderedTransformExact:change==='unchanged'});
}
console.log(JSON.stringify({passed:true,scope:'Exact V4f 8193-selected-vertex commit math yield and real ownership/Undo/cancel guards; alias gate replaced only by an assertion checkpoint before any authoring write; no GPU/browser claim',rows},null,2));
