
const frameAffineNumericTasks=new WeakMap();
function frameAffineKnownGate(t){
 const k=frameAffineKnownGeometry.get(t.g),ids=frameAffineKnownIDs(t.h);
 if(!k||!ids||!k.aliasStable||typeof k.aliasGuard?.find!=='function')return null;
 const values=Uint32Array.from(ids).sort(),ranges=[];
 for(let k=0;k<values.length;){const first=k,start=values[k];while(k+1<values.length&&values[k+1]===values[k]+1)k++;ranges.push([start,k-first+1]);k++;}
 if(!values.length||ranges.length>4096)return null;
 return{eligible:true,ids:values,ranges,label:null,faceCount:t.faceIDs.length,vertexCount:values.length,gate:'mapped-exclusive-affine-face-selection',aliasGuard:k.aliasGuard,stableFaceComponent:true};
}
async function frameAffineKnownNumeric(t){
 const g=t.g,old=t.engine.geometryCache.rows.get(g);if(old?.isCurrent())return old;
 const prior=frameAffineNumericTasks.get(g);if(prior&&frameAffineStampCurrent(prior.stamp))return prior.promise;
 const stamp=frameAffineSourceStamp(t.mesh),task={stamp,promise:null};frameAffineNumericTasks.set(g,task);
 task.promise=(async()=>{
  const positions=stamp.pa.slice(),extras=new Float32Array(stamp.pcount*9),indices=stamp.ia;
  const work=(function*(){for(let k=0;k<stamp.pcount;k++){const at=k*9,o=k*3;extras[at]=stamp.na[o];extras[at+1]=stamp.na[o+1];extras[at+2]=stamp.na[o+2];extras[at+5]=extras[at+6]=extras[at+7]=extras[at+8]=1;if((k&8191)===0)yield;}return true;})();
  await frameNative.drainCooperatively(work,{isCurrent:()=>frameAffineStampCurrent(stamp),yieldTask:frameAffineYield});
  if(!frameAffineStampCurrent(stamp))throw new DOMException('Mapped affine numeric source changed','AbortError');
  const attrs=[stamp.p,stamp.n,g.attributes.uv,g.attributes.color,stamp.i],row={source:g,positions,extras,indices,vertexCount:stamp.pcount,hasNormals:true,hasUV:false,hasColors:false,stamps:attrs.map(frameNative.stampAttribute),lineIndices:new Map(),isCurrent:()=>frameAffineStampCurrent(stamp)};
  t.engine.geometryCache.rows.set(g,row);return row;
 })().finally(()=>{if(frameAffineNumericTasks.get(g)===task)frameAffineNumericTasks.delete(g);});return task.promise;
}

