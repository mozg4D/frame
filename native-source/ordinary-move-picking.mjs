import * as THREE from '../modules/frame-three-core.9edde002b066a9a05676.js';
// The frozen vertex click policy: first raw representative of each rounded
// logical group; distance, then depth, with stable raw order for exact ties.
// Work is drained on the owning worker and yields between bounded batches.
export function* vertexPickWork(snapshot,context){
 for(const key of ['world','view','projection'])if(context[key]?.length!==16||!context[key].every(Number.isFinite))throw Error('Finite vertex picker frame required');
 const {rect,cx,cy,radius}=context;if(!rect||![rect.x,rect.y,rect.w,rect.h,cx,cy,radius].every(Number.isFinite)||rect.w<=0||rect.h<=0||radius<0)throw Error('Finite vertex picker rectangle required');
 const groups=new Map(),byRepresentative=new Map(),candidates=[],world=new THREE.Vector3(),ndc=new THREE.Vector3(),matrix=new THREE.Matrix4().fromArray(context.world),view=new THREE.Matrix4().fromArray(context.view),projection=new THREE.Matrix4().fromArray(context.projection),p=snapshot.positions;
 for(let id=0;id<p.length/3;id++){
  const at=id*3,key=`${Math.round(p[at]*1e5)},${Math.round(p[at+1]*1e5)},${Math.round(p[at+2]*1e5)}`;let group=groups.get(key);
  if(!group){group=[];groups.set(key,group);byRepresentative.set(id,group);}group.push(id);
  if((id&1023)===1023)yield;
 }
 let count=0;for(const [id]of byRepresentative){
  world.fromArray(p,id*3).applyMatrix4(matrix);ndc.copy(world).applyMatrix4(view).applyMatrix4(projection);
  if(ndc.z>=-1&&ndc.z<=1){const sx=(ndc.x*.5+.5)*rect.w+rect.x,sy=(-ndc.y*.5+.5)*rect.h+rect.y,d=(sx-cx)*(sx-cx)+(sy-cy)*(sy-cy);if(d<=radius*radius)candidates.push({id,d,depth:ndc.z,x:world.x,y:world.y,z:world.z,nx:ndc.x,ny:ndc.y});}
  if((++count&1023)===0)yield;
 }
 candidates.sort((a,b)=>a.d-b.d||a.depth-b.depth);
 return{candidates,groups:byRepresentative};
}
export function vertexPickPage(query,start){
 if(!Number.isSafeInteger(start)||start<0||start>query.candidates.length)throw Error('Ordered vertex picker page required');
 const values=query.candidates.slice(start,start+64),packed=new Float64Array(values.length*8);for(let i=0;i<values.length;i++){const q=values[i];packed.set([q.id,q.d,q.depth,q.x,q.y,q.z,q.nx,q.ny],i*8);}return{start,total:query.candidates.length,candidates:packed};
}
export function vertexPickGroup(query,id,start){
 const group=query.groups.get(id);if(!group||!Number.isSafeInteger(start)||start<0||start>group.length)throw Error('Owned vertex picker group required');
 return{start,total:group.length,vertices:Uint32Array.from(group.slice(start,start+8192))};
}
