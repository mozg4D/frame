/**
 * Geometry bridge for Frame's existing Three r186 scene objects, not a second scene graph.
 * Produces immutable Float32 GPU snapshots; authored Float32/64 arrays are left untouched.
 * InstancedMesh keeps one geometry + per-occurrence matrices and stable local instance IDs.
 * Unsupported deformation/transparency paths FAIL EXPLICITLY instead of hiding geometry.
 */
import {multiply4,webgpuProjection,IDENTITY,validatePacket} from './gpu-selection.mjs';
import {relativeWorldMatrix,relativeViewMatrix} from './relative-frame.mjs';
const fail=m=>{throw new Error(m);};
function matrix(a){if(a?.elements)a=a.elements;if(!a||a.length!==16||!Array.from(a).every(Number.isFinite))fail('Invalid 4x4 source matrix');return a;}
function determinant3(m){return m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);}
function attrStamp(a){return a?{a,array:a.array??a.data?.array,version:a.version??a.data?.version,count:a.count,itemSize:a.itemSize,normalized:a.normalized,data:a.data,stride:a.data?.stride,offset:a.offset}:null;}
function attrSame(a,s){return !s?!a:!!a&&a===s.a&&(a.array??a.data?.array)===s.array&&(a.version??a.data?.version)===s.version&&a.count===s.count&&a.itemSize===s.itemSize&&a.normalized===s.normalized&&a.data===s.data&&a.data?.stride===s.stride&&a.offset===s.offset;}
function matrixSame(a,b){const e=matrix(a);return e.every((v,i)=>Object.is(v,b[i]));}
const materialKey=m=>m?[m.uuid,m.visible,m.side,m.transparent,m.opacity,m.alphaTest,!!m.alphaMap,!!m.map,m.displacementScale,!!m.displacementMap,!!m.clippingPlanes?.length,!!m.isShaderMaterial,!!m.positionNode,!!m.vertexNode,!!m.isNodeMaterial,m.depthWrite,m.depthTest].join('|'):'missing';
function cull(m){return m.side===2?'none':m.side===1?'front':'back';}
// Exact no-op from the pinned r186 Material prototype. Other hooks need explicit review.
const DEFAULT_HOOK_SOURCE='onBeforeCompile( /* shaderobject, renderer */ ) {}';
function assertMaterial(m,allowMaterialHook){
  if(!m)fail('A surface material is missing');
  if(m.onBeforeCompile&&String(m.onBeforeCompile)!==DEFAULT_HOOK_SOURCE&&!(allowMaterialHook?.(m)))fail('Custom onBeforeCompile needs an explicitly reviewed depth-neutral adapter');
  if(m.isNodeMaterial||m.depthWrite===false||m.depthTest===false)fail('Node/custom depth material requires its depth adapter');
  if(m.transparent||m.opacity<1||m.alphaTest>0||m.alphaMap||m.displacementMap||m.clippingPlanes?.length||m.isShaderMaterial||m.positionNode||m.vertexNode)fail('Material needs a migrated depth adapter (transparency/alpha/displacement/custom/clipping)');
}
/** Camera inverse/world matrices must already be current; this function does not mutate them. */
export function captureMesh(mesh,camera,{projectionConvention,selectionIdentity=null,geometryCache=null,allowMaterialHook=null}={}){
  if(!mesh?.isMesh||!mesh.geometry)fail('Expected a mesh');
  if(mesh.isBatchedMesh||mesh.isSkinnedMesh)fail('Batched/skinned meshes require their evaluated-geometry adapter');
  if(mesh.morphTargetInfluences?.some(v=>v!==0))fail('Unbaked morph deformation requires evaluated positions');
  if(camera.reversedDepth)fail('Reverse-Z is not supported by this first depth contract');
  const g=mesh.geometry,p=g.attributes.position,ix=g.index;
  if(!p||p.itemSize!==3||!Number.isInteger(p.count))fail('Expected xyz positions');
  if(g.isInstancedBufferGeometry&&!mesh.isInstancedMesh)fail('Custom instanced geometry requires an explicit transform adapter');
  const parentStates=[];for(let o=mesh;o;o=o.parent)parentStates.push({object:o,parent:o.parent,visible:o.visible});
  const visible=parentStates.every(s=>s.visible!==false)&&(!camera.layers||camera.layers.test(mesh.layers));
  const cacheKey=p, entries=geometryCache?.get(cacheKey)??[];
  const cached=entries.find(v=>v.indexAttribute===ix&&attrSame(p,v.positionStamp)&&attrSame(ix,v.indexStamp));
  let positions,indices;
  if(cached){positions=cached.positions;indices=cached.indices;}else{
    positions=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){positions[i*3]=p.getX(i);positions[i*3+1]=p.getY(i);positions[i*3+2]=p.getZ(i);}
    indices=null;
  if(ix){if(ix.itemSize!==1)fail('Scalar index attribute required');let max=0;for(let i=0;i<ix.count;i++){const v=ix.getX(i);if(!Number.isInteger(v)||v<0||v>=p.count)fail('Invalid geometry index');max=Math.max(max,v);}indices=max>65535?new Uint32Array(ix.count):new Uint16Array(ix.count);for(let i=0;i<ix.count;i++)indices[i]=ix.getX(i);}
    if(geometryCache){entries.push({positions,indices,indexAttribute:ix,positionStamp:attrStamp(p),indexStamp:attrStamp(ix)});geometryCache.set(cacheKey,entries);}
  }
  const projection=webgpuProjection(matrix(camera.projectionMatrix),projectionConvention);
  const view=matrix(camera.matrixWorldInverse),world=matrix(mesh.matrixWorld),cameraWorld=matrix(camera.matrixWorld),origin=[cameraWorld[12],cameraWorld[13],cameraWorld[14]],vp=multiply4(projection,relativeViewMatrix(view,origin));
  const count=mesh.isInstancedMesh?mesh.count:1;
  if(!Number.isInteger(count)||count<0||count>0xffffffff)fail('Invalid instance count');
  if(mesh.isInstancedMesh&&(!mesh.instanceMatrix||mesh.instanceMatrix.itemSize!==16||mesh.instanceMatrix.count<count))fail('Instance matrix count mismatch');
  const clipMatrices=new Float32Array(count*16),instanceRanges=[];
  for(let i=0;i<count;i++){
    const local=mesh.isInstancedMesh?mesh.instanceMatrix.array.subarray(i*16,i*16+16):IDENTITY;
    const composed=multiply4(world,local),clip=multiply4(vp,relativeWorldMatrix(composed,origin));clipMatrices.set(clip,i*16);
    const frontFace=determinant3(composed)<0?'cw':'ccw',last=instanceRanges.at(-1);
    if(last?.frontFace===frontFace)last.count++;else instanceRanges.push({start:i,count:1,frontFace});
  }
  const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material],total=indices?.length??p.count;
  const dr=g.drawRange??{start:0,count:Infinity},start=Math.max(0,dr.start),end=Math.min(total,dr.count===Infinity?total:start+dr.count);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start%3||end%3)fail('Triangle-aligned draw range required');
  // Ordinary single materials ignore geometry.groups, as the display renderer does.
  const groups=Array.isArray(mesh.material)?g.groups:[{start:0,count:total,materialIndex:0}],ranges=[];
  for(const group of groups){const m=mats[group.materialIndex??0];if(!m)fail('Invalid material group');if(m.visible===false||!visible)continue;assertMaterial(m,allowMaterialHook);const a=Math.max(start,group.start),b=Math.min(end,group.start+group.count);if(b>a)ranges.push({start:a,count:b-a,cullMode:cull(m)});}
  const packet={positions,indices,clipMatrices,ranges,instanceRanges,objectId:selectionIdentity??mesh.userData?.hash??mesh.uuid,sourceVertexCount:p.count,instanceCount:count};
  validatePacket(packet);
  const ps=attrStamp(p),xs=attrStamp(ix),ms=attrStamp(mesh.instanceMatrix),world0=Array.from(world),view0=Array.from(view),proj0=Array.from(matrix(camera.projectionMatrix)),materials=mesh.material,mkeys=mats.map(materialKey),hooks=mats.map(m=>m?.onBeforeCompile),groupJSON=JSON.stringify(g.groups),rangeJSON=JSON.stringify(g.drawRange),layerMask=mesh.layers?.mask,cameraMask=camera.layers?.mask,oldConvention=projectionConvention;
  const isCurrent=()=>mesh.geometry===g&&attrSame(g.attributes.position,ps)&&attrSame(g.index,xs)&&attrSame(mesh.instanceMatrix,ms)&&(!mesh.isInstancedMesh||mesh.count===count)&&mesh.material===materials&&mats.length===mkeys.length&&mats.every((m,i)=>materialKey(m)===mkeys[i]&&m?.onBeforeCompile===hooks[i])&&JSON.stringify(g.groups)===groupJSON&&JSON.stringify(g.drawRange)===rangeJSON&&matrixSame(mesh.matrixWorld,world0)&&matrixSame(camera.matrixWorldInverse,view0)&&matrixSame(camera.projectionMatrix,proj0)&&mesh.layers?.mask===layerMask&&camera.layers?.mask===cameraMask&&parentStates.every(s=>s.object.parent===s.parent&&s.object.visible===s.visible)&&!mesh.morphTargetInfluences?.some(v=>v!==0)&&!camera.reversedDepth;
  return {packet,isCurrent,projectionConvention:oldConvention,notes:{visible,geometryUploadBytes:positions.byteLength+(indices?.byteLength??0),transformBytes:clipMatrices.byteLength,sharedGeometryAcrossInstances:true,authoredArraysMutated:false}};
}
/** Explicit inclusion avoids rendering helpers/selection overlays as occluders. */
export function captureScene(scene,camera,{includeSurface,projectionConvention,allowMaterialHook=null}={}){
  if(typeof includeSurface!=='function')fail('includeSurface is mandatory: helpers must not occlude model selection');
  const meshes=[];scene.traverse(o=>{if(o.isMesh&&includeSurface(o))meshes.push(o);});
  const geometryCache=new Map();
  const snapshots=meshes.map(m=>captureMesh(m,camera,{projectionConvention,geometryCache,allowMaterialHook}));
  return {snapshots,isCurrent:()=>{
    const current=[];scene.traverse(o=>{if(o.isMesh&&includeSurface(o))current.push(o);});
    return current.length===meshes.length&&current.every((m,i)=>m===meshes[i])&&snapshots.every(s=>s.isCurrent());
  }};
}
