/** Native display snapshots of actual Frame/Three data. No second editable scene graph. */
import {IDENTITY,multiply4,webgpuProjection} from './gpu-selection.mjs';
import {assertCubicMapSubset} from './gpu-cubic-map.mjs';
import {textureState} from './texture-policy.mjs';
import {relativeViewMatrix} from './relative-frame.mjs';
const fail=m=>{throw Error(m);};
const defaultHook='onBeforeCompile( /* shaderobject, renderer */ ) {}';
export function stampAttribute(a){return a?[a,a.array??a.data?.array,a.version??a.data?.version,a.count,a.itemSize,a.normalized,a.offset,a.data?.stride]:null;}
export function attributeCurrent(a,s){return !s?!a:!!a&&stampAttribute(a).every((v,i)=>Object.is(v,s[i]));}
function det(m){return m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);}
export function normalMatrix4(m){
  const determinant=det(m);if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-30)fail('Singular display transform needs an explicit degenerate adapter');
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const a=[m[0],m[1],m[2]],b=[m[4],m[5],m[6]],c=[m[8],m[9],m[10]],r=new Float32Array(16);
  for(const [j,column]of [cross(b,c),cross(c,a),cross(a,b)].entries())for(let i=0;i<3;i++)r[j*4+i]=column[i]/determinant;r[15]=1;return r;
}
const matrix=m=>{const a=m?.elements??m;if(!a||a.length!==16||!Array.from(a).every(Number.isFinite))fail('Finite matrix4 required');return a;};
const color=(c,fallback=[1,1,1])=>c?[c.r,c.g,c.b]:fallback;
const read=(a,i,j)=>a?j===0?a.getX(i):j===1?a.getY(i):j===2?a.getZ(i):a.getW(i):0;
export class DisplayGeometryCache {
  constructor(){this.rows=new WeakMap();}
  capture(g){
    const p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv,c=g.attributes.color,ix=g.index;
    if(!p||p.itemSize!==3)fail('Display positions must be xyz');
    for(const a of [n,u,c])if(a&&a.count!==p.count)fail('Display attribute count mismatch');
    const attrs=[p,n,u,c,ix],old=this.rows.get(g);if(old&&attrs.every((a,i)=>attributeCurrent(a,old.stamps[i])))return old;
    const positions=new Float32Array(p.count*3),extras=new Float32Array(p.count*9);
    for(let i=0;i<p.count;i++){
      positions.set([p.getX(i),p.getY(i),p.getZ(i)],i*3);
      extras.set(n?[n.getX(i),n.getY(i),n.getZ(i)]:[0,0,1],i*9);
      extras.set(u?[u.getX(i),u.getY(i)]:[0,0],i*9+3);
      extras.set(c?[c.getX(i),c.getY(i),c.getZ(i),c.itemSize===4?c.getW(i):1]:[1,1,1,1],i*9+5);
    }
    let indices=null;
    if(ix){if(ix.itemSize!==1)fail('Scalar index required');let max=0;for(let i=0;i<ix.count;i++){const v=ix.getX(i);if(!Number.isSafeInteger(v)||v<0||v>=p.count)fail('Display index out of bounds');max=Math.max(max,v);}indices=max<=65535?new Uint16Array(ix.count):new Uint32Array(ix.count);for(let i=0;i<ix.count;i++)indices[i]=ix.getX(i);}
    if(!positions.every(Number.isFinite)||!extras.every(Number.isFinite))fail('Nonfinite/Float32-overflow display attribute');
    const row={source:g,positions,extras,indices,vertexCount:p.count,hasNormals:!!n,hasUV:!!u,hasColors:!!c,stamps:attrs.map(stampAttribute),lineIndices:new Map()};
    row.isCurrent=()=>[g.attributes.position,g.attributes.normal,g.attributes.uv,g.attributes.color,g.index].every((a,i)=>attributeCurrent(a,row.stamps[i]));
    this.rows.set(g,row);return row;
  }
}
/** InstancedMesh, Frame cloner replicaCol0..3 and fastener instanceMatrix use shared geometry. */
export function captureInstances(object){
  const g=object.geometry;let count=1,kind='single',attributes=[];
  if(object.isInstancedMesh){kind='mesh';count=object.count;attributes=[object.instanceMatrix,object.instanceColor];}
  else if(g.isInstancedBufferGeometry){
    if(g.attributes.replicaCol0){kind='replica-lines';attributes=[0,1,2,3].map(i=>g.attributes['replicaCol'+i]);}
    else if(g.attributes.instanceMatrix){kind='fastener-lines';attributes=[g.attributes.instanceMatrix];}
    else fail('Custom instanced geometry requires an explicit display adapter');
    count=g.instanceCount;if(!Number.isFinite(count))count=attributes[0]?.count;
  }
  if(!Number.isSafeInteger(count)||count<0||count>0xffffffff)fail('Invalid instance count');
  for(const a of attributes.filter(Boolean))if(a.count<count)fail('Instance attribute count too small');
  if(kind==='mesh'&&attributes[0]?.itemSize!==16||kind==='fastener-lines'&&attributes[0]?.itemSize!==16||kind==='replica-lines'&&attributes.some(a=>a?.itemSize!==4))fail('Instance transform layout mismatch');
  const world0=Array.from(matrix(object.matrixWorld)),data=new Float32Array(count*36),worldMatrices=new Float64Array(count*16),ranges=[];
  for(let i=0;i<count;i++){
    const local=new Float64Array(IDENTITY);
    if(kind==='mesh'||kind==='fastener-lines'){
      const a=attributes[0],array=a.array??a.data?.array,stride=a.data?.stride??16,offset=a.offset??0;
      for(let k=0;k<16;k++)local[k]=array[i*stride+offset+k];
    }else if(kind==='replica-lines')for(let column=0;column<4;column++)for(let j=0;j<4;j++)local[column*4+j]=read(attributes[column],i,j);
    const world=multiply4(world0,local),normal=normalMatrix4(world);worldMatrices.set(world,i*16);data.set(world,i*36);data.set(normal,i*36+16);
    const ic=object.isInstancedMesh?object.instanceColor:null;data.set(ic?[ic.getX(i),ic.getY(i),ic.getZ(i),1]:[1,1,1,1],i*36+32);
    const frontFace=det(world)<0?'cw':'ccw',last=ranges.at(-1);if(last?.frontFace===frontFace)last.count++;else ranges.push({start:i,count:1,frontFace});
  }
  if(!data.every(Number.isFinite))fail('Float32 overflow in display transforms');
  const stamps=attributes.map(stampAttribute);
  const currentAttributes=()=>kind==='mesh'?[object.instanceMatrix,object.instanceColor]:kind==='replica-lines'?[0,1,2,3].map(i=>object.geometry.attributes['replicaCol'+i]):kind==='fastener-lines'?[object.geometry.attributes.instanceMatrix]:[];
  return {data,worldMatrices,count,ranges,kind,isCurrent:()=>matrix(object.matrixWorld).every((v,i)=>Object.is(v,world0[i]))&&(kind==='mesh'?object.count===count:kind==='single'||(Number.isFinite(g.instanceCount)?g.instanceCount:attributes[0]?.count)===count)&&object.geometry===g&&currentAttributes().every((a,i)=>attributeCurrent(a,stamps[i]))};
}
export class DisplayInstanceCache {
 constructor(){this.rows=new WeakMap();}
 capture(object){const old=this.rows.get(object);if(old?.isCurrent())return old;const row=captureInstances(object);this.rows.set(object,row);return row;}
}
/** Bundled Three Sprite vertex semantics as an immutable per-camera matrix.
 * Keep shared source geometry/UVs. Only this tiny display instance is evaluated;
 * object matrices and authored geometry are never rewritten. Negative object
 * scale contributes its column length, so it does not mirror sprite UVs.
 */
export function captureSpriteInstances(object,camera){
  if(!camera)fail('Sprite capture requires its render camera');
  if((object.count??1)!==1)fail('Instanced Sprite requires an explicit native adapter');
  const world0=Array.from(matrix(object.matrixWorld)),view0=Array.from(matrix(camera.matrixWorldInverse)),camera0=Array.from(matrix(camera.matrixWorld)),projection0=Array.from(matrix(camera.projectionMatrix));
  // Three's Float64 inverse can retain a few ulps in the affine bottom-right
  // value. Keep those numbers; reject actual projective transforms separately.
  for(const m of [world0,camera0])if(m[3]!==0||m[7]!==0||m[11]!==0||m[15]!==1)fail('Nonaffine Sprite/camera transform requires an explicit native adapter');
  if(view0[3]!==0||view0[7]!==0||view0[11]!==0||Math.abs(view0[15]-1)>4*Number.EPSILON)fail('Nonaffine Sprite/camera transform requires an explicit native adapter');
  const identity=multiply4(view0,camera0);if(identity.some((x,i)=>Math.abs(x-IDENTITY[i])>1e-6))fail('Inconsistent Sprite camera matrices require an explicit native adapter');
  const center=[object.center?.x,object.center?.y],rotation=object.material.rotation??0,attenuation=object.material.sizeAttenuation!==false;
  if(![...center,rotation].every(Number.isFinite))fail('Finite Sprite center/rotation required');
  const modelView=multiply4(view0,world0),perspective=projection0[11]===-1;
  const depthFactor=perspective&&!attenuation?-modelView[14]:1;
  const sx=Math.hypot(world0[0],world0[1],world0[2])*depthFactor,sy=Math.hypot(world0[4],world0[5],world0[6])*depthFactor;
  const c=Math.cos(rotation),s=Math.sin(rotation),eye=new Float64Array(IDENTITY);
  eye[0]=c*sx;eye[1]=s*sx;eye[4]=-s*sy;eye[5]=c*sy;
  eye[12]=modelView[12]+eye[0]*(.5-center[0])+eye[4]*(.5-center[1]);
  eye[13]=modelView[13]+eye[1]*(.5-center[0])+eye[5]*(.5-center[1]);eye[14]=modelView[14];
  const billboard=multiply4(camera0,eye),data=new Float32Array(36);
  data.set(billboard);data.set(IDENTITY,16);data.set([1,1,1,1],32);
  if(!data.every(Number.isFinite))fail('Float32 overflow in Sprite billboard');
  return {data,worldMatrices:new Float64Array(billboard),count:1,ranges:[{start:0,count:1,frontFace:'ccw'}],kind:'sprite',
    isCurrent:()=>matrix(object.matrixWorld).every((x,i)=>Object.is(x,world0[i]))&&matrix(camera.matrixWorldInverse).every((x,i)=>Object.is(x,view0[i]))&&matrix(camera.matrixWorld).every((x,i)=>Object.is(x,camera0[i]))&&matrix(camera.projectionMatrix).every((x,i)=>Object.is(x,projection0[i]))&&object.center?.x===center[0]&&object.center?.y===center[1]&&(object.material.rotation??0)===rotation&&(object.material.sizeAttenuation!==false)===attenuation&&(object.count??1)===1};
}
function knownHook(material,object){
  if(!material.onBeforeCompile||String(material.onBeforeCompile)===defaultHook)return true;
  const key=material.customProgramCacheKey?.()??'';
  if(material._frameProjectionInstalled===true&&material.userData?.frameProjection===true&&key==='frame-cubic-projection-r14')return true;
  if(material.userData?.frameSourceUV&&key==='frame-native-uv-r62')return true;
  // Known instance line transforms are explicitly reproduced by captureInstances.
  if(object.isLine && (key.startsWith('frame-replica-lines-r67')||key.startsWith('frame-fastener-line-r61')))return true;
  if(object.isLine&&key===defaultHook+'|frame-line-depth-bias-v2')return true;
  return false;
}
export function captureMaterial(material,object,{strict=true,camera=null}={}){
  if(!material)fail('Display material missing');
  const unsupported=[];
  if(material.isShaderMaterial||material.isRawShaderMaterial||material.isNodeMaterial)unsupported.push('custom shader');
  if(!knownHook(material,object))unsupported.push('unreviewed onBeforeCompile');
  for(const key of ['normalMap','bumpMap','displacementMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','lightMap','aoMap','envMap'])if(material[key])unsupported.push(key);
  if(material.clippingPlanes?.length)unsupported.push('clipping planes');
  if(material.alphaHash)unsupported.push('alphaHash');
  if(material.alphaToCoverage)unsupported.push('alphaToCoverage');
  if(material.premultipliedAlpha)unsupported.push('premultipliedAlpha');
  if(material.blending!==undefined&&material.blending!==0&&material.blending!==1)unsupported.push('custom blending');
  if(material.blending===0&&material.transparent)unsupported.push('transparent NoBlending');
  if(material.isMeshPhysicalMaterial)unsupported.push('physical extensions');
  if(material.isMeshPhongMaterial||material.isMeshToonMaterial||material.isMeshMatcapMaterial||material.isShadowMaterial||material.isLineDashedMaterial)unsupported.push(material.type);
  if(strict&&unsupported.length)fail(`Material ${material.name||material.type}: explicit port required for ${unsupported.join(', ')}`);
  if(material.isMeshStandardMaterial&&(![material.roughness,material.metalness].every(x=>Number.isFinite(x)&&x>=0&&x<=1)))fail('Standard roughness/metalness must be finite in [0,1]');
  const type=material.isMeshNormalMaterial?'normal':material.isMeshStandardMaterial?'standard':material.isMeshLambertMaterial?'lambert':'basic';
  const projected=material._frameProjectionInstalled===true&&material.userData?.frameProjection===true;
  if(strict&&projected)assertCubicMapSubset(material,object,{camera});
  const f=material._frameUniforms;
  const m3to4=m=>{const a=m?.elements;if(!a)return Array.from(IDENTITY);return [a[0],a[1],a[2],0,a[3],a[4],a[5],0,a[6],a[7],a[8],0,0,0,0,1];};
  const tex=material.map;if(tex?.matrixAutoUpdate)tex.updateMatrix(); if(tex && (tex.isCubeTexture||tex.isCompressedTexture||tex.isData3DTexture||tex.isDataArrayTexture))fail('Non-2D texture requires an explicit adapter');
  const uv=tex?.matrix?.elements??[1,0,0,0,1,0,0,0,1];
  return {type,color:[...color(material.color),material.opacity??1],emissive:color(material.emissive,[0,0,0]).map(x=>x*(material.emissiveIntensity??1)),roughness:material.roughness??1,metalness:material.metalness??0,
    alphaTest:material.alphaTest??0,transparent:!!material.transparent,forceSinglePass:!!material.forceSinglePass,vertexColors:!!material.vertexColors,flatShading:!!material.flatShading,
    depthWrite:material.depthWrite!==false,depthTest:material.depthTest!==false,colorWrite:material.colorWrite!==false,
    cullMode:material.side===2?'none':material.side===1?'front':'back',lineWidth:material.linewidth??1,pointSize:material.size??1,pointCircle:true,
    fog:material.fog!==false,sizeAttenuation:!!material.sizeAttenuation,toneMapped:material.toneMapped!==false,depthBias:material.polygonOffset?material.polygonOffsetUnits??0:0,
    slopeBias:material.polygonOffset?material.polygonOffsetFactor??0:0,clipBias:(material.customProgramCacheKey?.()??'').endsWith('|frame-line-depth-bias-v2')?0.000001:0,
    projection:projected,mapInverse:projected?Array.from(matrix(f?.frameMapInv?.value??IDENTITY)):Array.from(IDENTITY),mapNormal:projected?m3to4(f?.frameMapNormal?.value):Array.from(IDENTITY),bump:projected?f?.frameBump?.value??0:0,
    texture:tex??null,uvTransform:Array.from(uv),unsupported,source:material};
}
export function lineIndices(geometry,kind,start,count){
  const key=`${kind}:${start}:${count}`;if(geometry.lineIndices.has(key))return geometry.lineIndices.get(key);
  const id=i=>geometry.indices?geometry.indices[i]:i;let out;
  if(kind==='wire'){out=new Uint32Array(Math.floor(count/3)*6);for(let t=0,j=0;t+2<count;t+=3){const a=id(start+t),b=id(start+t+1),c=id(start+t+2);out.set([a,b,b,c,c,a],j);j+=6;}}
  else if(kind==='segments'){out=new Uint32Array(Math.floor(count/2)*2);for(let i=0;i<out.length;i++)out[i]=id(start+i);}
  else if(kind==='points'){out=new Uint32Array(count);for(let i=0;i<count;i++)out[i]=id(start+i);}
  else {const edges=Math.max(0,count-1)+(kind==='loop'&&count>1?1:0);out=new Uint32Array(edges*2);for(let i=0;i<edges;i++)out.set([id(start+i),id(start+(i+1)%count)],i*2);}
  geometry.lineIndices.set(key,out);return out;
}
function materialStamp(m) {
  const texture=m?.map,u=m?._frameUniforms;
  return [m,m?.version,m?.visible,m?.side,m?.opacity,m?.transparent,m?.depthTest,m?.depthWrite,m?.colorWrite,m?.vertexColors,m?.wireframe,m?.flatShading,m?.toneMapped,m?.alphaTest,m?.roughness,m?.metalness,m?.linewidth,m?.size,m?.sizeAttenuation,m?.polygonOffset,m?.polygonOffsetUnits,m?.polygonOffsetFactor,m?.onBeforeCompile,
    m?.fog,m?.rotation,m?.onBeforeRender,m?.forceSinglePass,m?.alphaHash,m?.alphaToCoverage,m?.premultipliedAlpha,m?.blending,m?.color?.r,m?.color?.g,m?.color?.b,m?.emissive?.r,m?.emissive?.g,m?.emissive?.b,m?.emissiveIntensity,texture,texture?.version,texture?.source?.version,texture?.image,texture?.wrapS,texture?.wrapT,texture?.flipY,texture?.minFilter,texture?.magFilter,texture?.colorSpace,...textureState(texture),
    ...['normalMap','bumpMap','displacementMap','roughnessMap','metalnessMap','emissiveMap','alphaMap','lightMap','aoMap','envMap','transmission','clearcoat','sheen','iridescence','anisotropy'].map(k=>m?.[k]),
    ...(texture?.matrix?.elements??[]),...(u?.frameMapInv?.value?.elements??[]),...(u?.frameMapNormal?.value?.elements??[]),u?.frameBump?.value];
}
export function captureDisplayObject(object,{geometryCache=new DisplayGeometryCache(),instanceCache=new DisplayInstanceCache(),strict=true,camera=null}={}){
  // Deliberately reject non-renderable roots before touching their lazy geometry getter.
  if(!object || !(object.isMesh||object.isLine||object.isPoints||object.isSprite))fail('Only actual drawables can be captured');
  if(object.isSprite&&(!object.material?.isSpriteMaterial||Array.isArray(object.material)||object.material.wireframe))fail('Sprite requires a native SpriteMaterial adapter');
  if(object.isSprite){
    const hook=(o,key,args)=>!o[key]||String(o[key])===`${key}( /* ${args} */ ) {}`;
    if(!hook(object,'onBeforeRender','renderer, scene, camera, geometry, material, group')||!hook(object,'onAfterRender','renderer, scene, camera, geometry, material, group')||!hook(object.material,'onBeforeRender','renderer, scene, camera, geometry, object, group'))fail('Sprite render hook requires an explicit native adapter');
    if((object.material.map?.channel??0)!==0)fail('Sprite UV channel requires an explicit native adapter');
  }
  if(object.isSkinnedMesh||object.isBatchedMesh||object.morphTargetInfluences?.some(x=>x!==0))fail('Unbaked deformation requires evaluated display geometry');
  const geometry=geometryCache.capture(object.geometry),instances=object.isSprite?captureSpriteInstances(object,camera):instanceCache.capture(object),total=geometry.indices?.length??geometry.vertexCount;
  if(object.isSprite&&geometry.positions.some((x,i)=>i%3===2&&x!==0))fail('Nonplanar Sprite geometry requires an explicit native adapter');
  const draw=object.geometry.drawRange??{start:0,count:Infinity},start=Math.max(0,draw.start),end=Math.min(total,draw.count===Infinity?total:start+draw.count);
  if(!Number.isInteger(start)||!Number.isInteger(end)||end<start)fail('Invalid display draw range');
  const mats=Array.isArray(object.material)?object.material:[object.material],groups=Array.isArray(object.material)?object.geometry.groups:[{start:0,count:total,materialIndex:0}],packets=[];
  for(const group of groups){const mat=mats[group.materialIndex??0];if(!mat)fail('Invalid display material group');if(mat.visible===false)continue;
    const a=Math.max(start,group.start),b=Math.min(end,group.start+group.count);if(b<=a)continue;
    const material=captureMaterial(mat,object,{strict,camera});const kind=object.isPoints?'points':object.isLineSegments?'segments':object.isLineLoop?'loop':object.isLine?'line':mat.wireframe?'wire':'triangles';
    // Sprite shader uses unlit diffuse/texture alpha and ignores geometry colours.
    if(object.isSprite){material.type='basic';material.vertexColors=false;if(material.projection)fail('Custom Sprite projection requires an explicit native adapter');}
    if((kind==='triangles'||kind==='wire')&&(a%3||(b-a)%3))fail('Triangle-aligned draw ranges required');
    packets.push({object,geometry,instances,material,kind,start:a,count:b-a,indices:kind==='triangles'?null:lineIndices(geometry,kind,a,b-a),renderOrder:object.renderOrder??0,objectId:object.userData?.hash??object.uuid});
  }
  const sourceGeometry=object.geometry,sourceMaterial=object.material,groupsJSON=JSON.stringify(sourceGeometry.groups),rangeJSON=JSON.stringify(sourceGeometry.drawRange),materialStates=mats.map(materialStamp);
  const parents=[];for(let p=object;p;p=p.parent)parents.push([p,p.parent,p.visible]);const spriteHooks=object.isSprite?[object.onBeforeRender,object.onAfterRender]:null;
  return {packets,isCurrent:()=>object.geometry===sourceGeometry&&object.material===sourceMaterial&&(!spriteHooks||object.onBeforeRender===spriteHooks[0]&&object.onAfterRender===spriteHooks[1])&&JSON.stringify(sourceGeometry.groups)===groupsJSON&&JSON.stringify(sourceGeometry.drawRange)===rangeJSON&&mats.every((m,i)=>{const a=materialStamp(m),b=materialStates[i];return a.length===b.length&&a.every((v,j)=>Object.is(v,b[j]));})&&geometry.isCurrent()&&instances.isCurrent()&&parents.every(([p,par,v])=>p.parent===par&&p.visible===v)};
}
export function captureDisplayScene(scene,camera,{include=()=>true,geometryCache=new DisplayGeometryCache(),instanceCache=new DisplayInstanceCache(),strict=true,adapter=null}={}){
  const snapshots=[],drawables=[];const visit=o=>{if(o.visible===false)return;if(camera.layers&&!camera.layers.test(o.layers)){for(const c of o.children??[])visit(c);return;}
    if((o.isMesh||o.isLine||o.isPoints||o.isSprite)&&include(o)){drawables.push(o);const custom=adapter?.(o,camera);snapshots.push(custom??captureDisplayObject(o,{geometryCache,instanceCache,strict,camera}));}
    for(const c of o.children??[])visit(c);
  };visit(scene);
  return {snapshots,packets:snapshots.flatMap(s=>s.packets),isCurrent:()=>{const now=[];const scan=o=>{if(o.visible===false)return;if((!camera.layers||camera.layers.test(o.layers))&&(o.isMesh||o.isLine||o.isPoints||o.isSprite)&&include(o))now.push(o);for(const c of o.children??[])scan(c);};scan(scene);return now.length===drawables.length&&now.every((o,i)=>o===drawables[i])&&snapshots.every(s=>s.isCurrent());}};
}
/** Numeric light snapshot taken synchronously during render, with no synthetic lights.
 * Targets may live outside the scene. Refresh their ancestors before reading positions.
 * Visibility hides a subtree; layers filter each light independently of its parents.
 */
export function captureLighting(scene,camera){
  const ambient=[0,0,0],directionalLights=[];
  const visit=o=>{
    if(o.visible===false)return;
    if(o.isLight&&(!camera.layers||camera.layers.test(o.layers))){
      if(o.castShadow)fail('Shadow light requires an explicit native adapter');
      if(!o.isAmbientLight&&!o.isDirectionalLight)fail(`Light ${o.type}: explicit native adapter required`);
      const rgb=color(o.color).map(x=>x*o.intensity);
      if(!rgb.every(Number.isFinite))fail('Invalid light colour/intensity');
      if(o.isAmbientLight){for(let i=0;i<3;i++)ambient[i]+=rgb[i];}
      else{
        o.updateWorldMatrix?.(true,false);o.target?.updateWorldMatrix?.(true,false);
        const from=matrix(o.matrixWorld),to=matrix(o.target?.matrixWorld);
        const direction=[from[12]-to[12],from[13]-to[13],from[14]-to[14]],length=Math.hypot(...direction);
        if(!direction.every(Number.isFinite)||!Number.isFinite(length))fail('Invalid directional light transform');
        directionalLights.push({direction:direction.map(x=>length?x/length:0),color:rgb});
      }
    }
    for(const child of o.children??[])visit(child);
  };visit(scene);
  if(!ambient.every(Number.isFinite))fail('Ambient light sum overflow');
  return {ambient,directionalLights};
}
export function cameraPacket(camera,{width,height,viewport=[0,0,width,height],projectionConvention='webgl',ambient=[0,0,0],directionalLights=[],exposure=1,toneMapping='none',fog=null,relative=false}={}){
  const world=matrix(camera.matrixWorld),worldOrigin=relative?[world[12],world[13],world[14]]:[0,0,0];
  const view=relativeViewMatrix(matrix(camera.matrixWorldInverse),worldOrigin),vp=multiply4(webgpuProjection(matrix(camera.projectionMatrix),projectionConvention),view);
  return {projection:new Float32Array(webgpuProjection(matrix(camera.projectionMatrix),projectionConvention)),canvasHeight:height,worldOrigin:Object.freeze(worldOrigin),viewProjection64:vp,viewProjection:new Float32Array(vp),viewport:[...viewport],cameraPosition:[world[12]-worldOrigin[0],world[13]-worldOrigin[1],world[14]-worldOrigin[2]],cameraDirection:[world[8],world[9],world[10]],cameraRight:[world[0],world[1],world[2]],cameraUp:[world[4],world[5],world[6]],viewMatrix:Array.from(view),ambient:[...ambient],directionalLights:directionalLights.map(l=>({direction:[...l.direction],color:[...l.color]})),exposure,toneMapping,fog:captureFog(fog),perspective:!!camera.isPerspectiveCamera};
}

/** Match bundled Three fog depth/formulas and output-space colour (after tone mapping).
 * Snapshot numbers now; the live scene may be restored before native submission.
 */
export function captureFog(fog){
 if(!fog)return {type:0,color:[0,0,0],near:0,far:1,density:0};
 const rgb=[fog.color?.r,fog.color?.g,fog.color?.b];
 if(!rgb.every(Number.isFinite))throw Error('Invalid fog colour');
 const encode=x=>x<=.0031308?x*12.92:1.055*Math.pow(x,1/2.4)-.055;
 if(fog.isFog){if(!Number.isFinite(fog.near)||!Number.isFinite(fog.far)||fog.near<0||fog.far<=fog.near)throw Error('Invalid linear fog range');return {type:1,color:rgb.map(encode),near:fog.near,far:fog.far,density:0};}
 if(fog.isFogExp2){if(!Number.isFinite(fog.density)||fog.density<0)throw Error('Invalid exponential fog density');return {type:2,color:rgb.map(encode),near:0,far:1,density:fog.density};}
 throw Error('Unsupported fog type');
}
