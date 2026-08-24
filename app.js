import * as THREE from 'three';
import * as SPLINE from './spline-core.js?v=surface-builder-8';
import {buildCompiledSplineSurfaceMesh} from './frame-surface-adapter.js?v=surface-builder-25';
import {buildExtrudeSplineCage} from './procedural-cage.js?v=surface-builder-2';
import {FrameBooleanRuntime} from './frame-boolean-runtime.js?v=production-6-js-r2';
import {clipBooleanCageToSurface} from './frame-boolean-cage-display.js?v=production-6-js-r2';
import {FORMAT_LIMITS,SUPPORTED_FORMATS,exportExternalScene,importExternalFile} from './frame-formats.js?v=formats-3';
function pointSegmentDistanceSq(px,py,ax,ay,bx,by){ const dx=bx-ax,dy=by-ay,dd=dx*dx+dy*dy,t=dd>1e-9?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/dd)):0,x=ax+t*dx,y=ay+t*dy; return (px-x)*(px-x)+(py-y)*(py-y); }
function segmentIntersectsRect(a,b,r){ const inside=(p)=>p[0]>=r.x0&&p[0]<=r.x1&&p[1]>=r.y0&&p[1]<=r.y1;if(inside(a)||inside(b))return true; const cross=(a,b,c,d)=>{const o=(p,q,s)=>(q[0]-p[0])*(s[1]-p[1])-(q[1]-p[1])*(s[0]-p[0]);return o(a,b,c)*o(a,b,d)<=0&&o(c,d,a)*o(c,d,b)<=0;},q=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]]; return q.some((p,i)=>cross(a,b,p,q[(i+1)%4])); }
function triangleIntersectsRect(a,b,c,r){ const inside=p=>p[0]>=r.x0&&p[0]<=r.x1&&p[1]>=r.y0&&p[1]<=r.y1; if(segmentIntersectsRect(a,b,r)||segmentIntersectsRect(b,c,r)||segmentIntersectsRect(c,a,r))return true; const orient=(p,q,s)=>(q[0]-p[0])*(s[1]-p[1])-(q[1]-p[1])*(s[0]-p[0]),has=p=>{const x=orient(p,a,b),y=orient(p,b,c),z=orient(p,c,a);return(x>=0&&y>=0&&z>=0)||(x<=0&&y<=0&&z<=0);}; return has([r.x0,r.y0])||has([r.x1,r.y0])||has([r.x1,r.y1])||has([r.x0,r.y1])||inside(a)||inside(b)||inside(c); }
function createVisibleFacePicker(){
  let target=null;
  return function pickVisibleFaces({renderer,pickMeshes,meshToHash,selectedHashes,rect,box,camera}){
    const scene=new THREE.Scene(),ids=new Map(); let nextId=1;
    for(const [h,mesh] of pickMeshes){
      if(!mesh.visible||!mesh.geometry?.attributes.position)continue;
      mesh.updateMatrixWorld(true); const clone=new THREE.Mesh(); clone.matrixAutoUpdate=false; clone.matrix.copy(mesh.matrixWorld);
      if(selectedHashes.has(h)){
        const src=mesh.geometry,pos=src.attributes.position,idx=src.index,tris=idx?idx.count/3:pos.count/3,np=new Float32Array(tris*9),nc=new Float32Array(tris*9);
        for(let fi=0;fi<tris;fi++){ const id=nextId++,rgb=[(id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255]; ids.set(id,{h,fi}); for(let j=0;j<3;j++){ const vi=idx?idx.getX(fi*3+j):fi*3+j,k=fi*9+j*3; np[k]=pos.getX(vi);np[k+1]=pos.getY(vi);np[k+2]=pos.getZ(vi);nc[k]=rgb[0];nc[k+1]=rgb[1];nc[k+2]=rgb[2]; } }
        const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(np,3)); g.setAttribute('color',new THREE.BufferAttribute(nc,3)); clone.geometry=g; clone.material=new THREE.ShaderMaterial({side:THREE.DoubleSide,depthTest:true,depthWrite:true,blending:THREE.NoBlending,vertexShader:'attribute vec3 color;varying vec3 idColor;void main(){idColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 idColor;void main(){gl_FragColor=vec4(idColor,1.);}'}); clone.userData.idGeometry=true;
      } else { clone.geometry=mesh.geometry; clone.material=new THREE.ShaderMaterial({side:THREE.DoubleSide,depthTest:true,depthWrite:true,blending:THREE.NoBlending,vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){gl_FragColor=vec4(0.,0.,0.,1.);}'}); }
      scene.add(clone);
    }
    const bx0=Math.max(0,Math.floor(box.x0-rect.x)),bx1=Math.min(rect.w,Math.ceil(box.x1-rect.x)),by0=Math.max(0,Math.floor(box.y0-rect.y)),by1=Math.min(rect.h,Math.ceil(box.y1-rect.y)),bw=Math.max(1,bx1-bx0),bh=Math.max(1,by1-by0),scale=Math.max(1,Math.min(4,Math.sqrt(4000000/(bw*bh)))),w=Math.max(1,Math.ceil(bw*scale)),h=Math.max(1,Math.ceil(bh*scale));
    if(!target||target.width!==w||target.height!==h){ target?.dispose(); target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true}); }
    const oldProjection=camera.projectionMatrix.clone(),oldProjectionInverse=camera.projectionMatrixInverse.clone(),oldView=camera.view?{...camera.view}:null;camera.setViewOffset(rect.w,rect.h,bx0,by0,bw,bh);
    const old=renderer.getRenderTarget(); renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setViewport(0,0,w,h); renderer.setClearColor(0,0); renderer.clear(true,true,true); renderer.render(scene,camera);
    const pixels=new Uint8Array(w*h*4);renderer.readRenderTargetPixels(target,0,0,w,h,pixels);renderer.setRenderTarget(old);camera.view=oldView;camera.projectionMatrix.copy(oldProjection);camera.projectionMatrixInverse.copy(oldProjectionInverse);
    scene.traverse(o=>{ if(o.geometry&&o.userData.idGeometry)o.geometry.dispose(); o.material?.dispose(); }); const out=new Map(); for(let i=0;i<pixels.length;i+=4){ const rec=ids.get(pixels[i]|(pixels[i+1]<<8)|(pixels[i+2]<<16)); if(rec){ let faces=out.get(rec.h); if(!faces)out.set(rec.h,faces=new Set()); faces.add(rec.fi); } } return out;
  };
}
/* ----------------------------- константы ----------------------------- */
const UNITS=['nm','µm','mm','cm','dm','m','km'];
const UMM  =[1e-6,1e-3,1,10,100,1000,1e6];
const TYPE_GROUP=0, TYPE_MESH=1, TYPE_GEN=2, TYPE_LIGHT=3, TYPE_ENV=4;
const BG=0x2a2a2a, GRID_COL=0x444444, QUAD_LINE=0x141414;
const ORTHO_LINE=0x7e858d, ORTHO_MINOR_OP=0.12, ORTHO_MAJOR_OP=0.30;
const PR=Math.min(devicePixelRatio,2);
const FOV=45, BASE=2000, TAP_PX=6, VIEW_SWITCH_PX=12, MAJOR_LO=50, MINOR_SHOW_PX=14, ORTHO_MAJOR_LO=140;
const SNAP_GRID_PX=10;
const DEPTH_RATIO=1e5;
const LMB=1, RMB=2, MMB=4, TAU=Math.PI*2, WUP=new THREE.Vector3(0,1,0);
const ROT=1.5, LOOK=0.6, PAN=1, DOLLY=3, WHEEL=1;
const MINR=1e-4, MAXR=1e9, MINZ=1e-4, MAXZ=1e9;
const EXT3D=10, EXTFLAT=3.1, RO=400, gizPx=60;
const LAYER_OBJ=1, LAYER_BRACKET=300, LAYER_SNAPVIS=350;
const IDENT=new THREE.Quaternion();
const BX=new THREE.Vector3(1,0,0), BY=new THREE.Vector3(0,1,0), BZ=new THREE.Vector3(0,0,1);
const D2R=Math.PI/180, R2D=180/Math.PI;
const BRACKET_FADE_MS=220;
const RING_PX=82, RING_HIT_PX=18;
const SMALLRING_PX=10, SMALLRING_OFF_PX=72;
const SNAP_PX=10, EDIT_HIT_PX=20, TICK_PX=8;
const VERTEX_CAP=4000;
const QUANT_BASE_STEP=1; // 1 mm in the editor's internal millimetre units
const SNAPVIS_CAP=4000;
const STEP_K=0.1;
const SCALE_ZERO_FRAC=0.5;
const SNAP_HALF=5;
const EPS_NEAR=0.001;
const ORIGIN0=new THREE.Vector3(0,0,0);
const PERSP_LINES=11;
const MIN_COL=1e-8;
const CREASE_ANGLE=Math.PI/4, CREASE_COS=Math.cos(CREASE_ANGLE);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const isFin=v=>Number.isFinite(v);
const vecFin=v=>isFin(v.x)&&isFin(v.y)&&isFin(v.z);
/* ----------------------- матричная алгебра 3x3 ----------------------- */
function m3fromM4(m4,a){ const e=m4.elements; a[0]=e[0];a[1]=e[1];a[2]=e[2];a[3]=e[4];a[4]=e[5];a[5]=e[6];a[6]=e[8];a[7]=e[9];a[8]=e[10]; }
function m3toM4(a,m4){ const e=m4.elements; e[0]=a[0];e[1]=a[1];e[2]=a[2];e[3]=0;e[4]=a[3];e[5]=a[4];e[6]=a[5];e[7]=0;e[8]=a[6];e[9]=a[7];e[10]=a[8];e[11]=0;e[12]=0;e[13]=0;e[14]=0;e[15]=1; }
function m3det(a){ return a[0]*(a[4]*a[8]-a[5]*a[7])-a[3]*(a[1]*a[8]-a[2]*a[7])+a[6]*(a[1]*a[5]-a[2]*a[4]); }
function m3inv(a,o){ const d=m3det(a); if(Math.abs(d)<1e-12) return false; const id=1/d;
o[0]=(a[4]*a[8]-a[5]*a[7])*id; o[1]=(a[2]*a[7]-a[1]*a[8])*id; o[2]=(a[1]*a[5]-a[2]*a[4])*id;
o[3]=(a[5]*a[6]-a[3]*a[8])*id; o[4]=(a[0]*a[8]-a[2]*a[6])*id; o[5]=(a[2]*a[3]-a[0]*a[5])*id;
o[6]=(a[3]*a[7]-a[4]*a[6])*id; o[7]=(a[1]*a[6]-a[0]*a[7])*id; o[8]=(a[0]*a[4]-a[1]*a[3])*id; return true; }
function m3mul(a,b,o){
o[0]=a[0]*b[0]+a[3]*b[1]+a[6]*b[2]; o[1]=a[1]*b[0]+a[4]*b[1]+a[7]*b[2]; o[2]=a[2]*b[0]+a[5]*b[1]+a[8]*b[2];
o[3]=a[0]*b[3]+a[3]*b[4]+a[6]*b[5]; o[4]=a[1]*b[3]+a[4]*b[4]+a[7]*b[5]; o[5]=a[2]*b[3]+a[5]*b[4]+a[8]*b[5];
o[6]=a[0]*b[6]+a[3]*b[7]+a[6]*b[8]; o[7]=a[1]*b[6]+a[4]*b[7]+a[7]*b[8]; o[8]=a[2]*b[6]+a[5]*b[7]+a[8]*b[8]; }
function m3colLen(a,i){ const x=a[i],y=a[i+3],z=a[i+6]; return Math.sqrt(x*x+y*y+z*z); }
function m3scaleCol(a,i,f){ a[i]*=f; a[i+3]*=f; a[i+6]*=f; }
const _pa=new Float64Array(9),_pb=new Float64Array(9),_pc=new Float64Array(9);
function m3polarR(a,out){
_pa[0]=a[0];_pa[1]=a[1];_pa[2]=a[2];_pa[3]=a[3];_pa[4]=a[4];_pa[5]=a[5];_pa[6]=a[6];_pa[7]=a[7];_pa[8]=a[8];
if(Math.abs(m3det(_pa))<1e-9){ m3gram(_pa,out); return; }
for(let it=0;it<8;it++){
if(!m3inv(_pa,_pb)) { m3gram(a,out); return; }
_pc[0]=_pb[0];_pc[1]=_pb[3];_pc[2]=_pb[6];_pc[3]=_pb[1];_pc[4]=_pb[4];_pc[5]=_pb[7];_pc[6]=_pb[2];_pc[7]=_pb[5];_pc[8]=_pb[8];
for(let i=0;i<9;i++) _pa[i]=0.5*(_pa[i]+_pc[i]);
}
if(m3det(_pa)<0){ _pa[0]*=-1;_pa[1]*=-1;_pa[2]*=-1; }
out[0]=_pa[0];out[1]=_pa[1];out[2]=_pa[2];out[3]=_pa[3];out[4]=_pa[4];out[5]=_pa[5];out[6]=_pa[6];out[7]=_pa[7];out[8]=_pa[8];
}
function m3gram(a,out){
let x0=a[0],y0=a[1],z0=a[2], n0=Math.sqrt(x0*x0+y0*y0+z0*z0);
if(n0<1e-12){ x0=1;y0=0;z0=0;n0=1; } x0/=n0;y0/=n0;z0/=n0;
let x1=a[3],y1=a[4],z1=a[5]; const d1=x1*x0+y1*y0+z1*z0; x1-=d1*x0;y1-=d1*y0;z1-=d1*z0;
let n1=Math.sqrt(x1*x1+y1*y1+z1*z1); if(n1<1e-12){ x1=0;y1=1;z1=0;n1=1; } x1/=n1;y1/=n1;z1/=n1;
let x2=y0*z1-z0*y1, y2=z0*x1-x0*z1, z2=x0*y1-y0*x1;
out[0]=x0;out[1]=y0;out[2]=z0;out[3]=x1;out[4]=y1;out[5]=z1;out[6]=x2;out[7]=y2;out[8]=z2;
}
const _r9=new Float64Array(9),_s9=new Float64Array(9),_t9=new Float64Array(9),_rot9=new Float64Array(9);
const _RM=new THREE.Matrix4(),_SM=new THREE.Matrix4(),_LM=new THREE.Matrix4(),_RMw=new THREE.Matrix4();
const _rotX=new THREE.Vector3(),_rotY=new THREE.Vector3(),_rotZ=new THREE.Vector3();
function polarRMat(linM4,outRM4){ m3fromM4(linM4,_r9); m3polarR(_r9,_r9); m3toM4(_r9,outRM4); return outRM4; }
function rotMatOfLin(linM4,outM4){
const e=linM4.elements;
_rotX.set(e[0],e[1],e[2]);
_rotY.set(e[4],e[5],e[6]);
_rotZ.set(e[8],e[9],e[10]);
if(_rotX.lengthSq()<1e-18) _rotX.set(1,0,0); else _rotX.normalize();
_rotY.addScaledVector(_rotX,-_rotY.dot(_rotX));
if(_rotY.lengthSq()<1e-18){
_rotY.set(0,1,0).addScaledVector(_rotX,-_rotX.y);
if(_rotY.lengthSq()<1e-18) _rotY.set(0,0,1).addScaledVector(_rotX,-_rotX.z);
}
_rotY.normalize();
const handedness=_rotX.clone().cross(_rotY).dot(_rotZ);
_rotZ.crossVectors(_rotX,_rotY);
if(handedness<0) _rotZ.negate();
outM4.makeBasis(_rotX,_rotY,_rotZ);
return outM4;
}
function rotQuatOfLin(linM4,outQ){ rotMatOfLin(linM4,_RMw); outQ.setFromRotationMatrix(_RMw); return outQ; }
function symPart(linM4,RM4,outSM4){
_t9[0]=RM4.elements[0];_t9[1]=RM4.elements[4];_t9[2]=RM4.elements[8];
_t9[3]=RM4.elements[1];_t9[4]=RM4.elements[5];_t9[5]=RM4.elements[9];
_t9[6]=RM4.elements[2];_t9[7]=RM4.elements[6];_t9[8]=RM4.elements[10];
m3fromM4(linM4,_s9); m3mul(_t9,_s9,_s9); m3toM4(_s9,outSM4); return outSM4; }
function floorWmCols(wM,srcM){ const e=wM.elements, s=srcM?srcM.elements:null;
for(let i=0;i<3;i++){ const j=i*4, a=e[j],b=e[j+1],c=e[j+2]; const len=Math.sqrt(a*a+b*b+c*c);
if(len>=MIN_COL) continue;
if(s){ const sa=s[j],sb=s[j+1],sc=s[j+2]; const sl=Math.sqrt(sa*sa+sb*sb+sc*sc);
if(sl>1e-12){ const f=MIN_COL/sl; e[j]=sa*f; e[j+1]=sb*f; e[j+2]=sc*f; continue; } }
if(len>0){ const f=MIN_COL/len; e[j]*=f; e[j+1]*=f; e[j+2]*=f; }
else { e[j]=MIN_COL; e[j+1]=0; e[j+2]=0; } } }
/* --------------------- привязки: quantize / snap --------------------- */
let quantOn=true, snapOn=false;
let gizmoVisible=true;
let lastOrthoView=-1;
function getQuantize(){ return quantOn; }
function getSnap(){ return snapOn; }
function setQuantize(on){ on=!!on; if(on && snapOn) snapOn=false; quantOn=on; }
function setSnap(on){ on=!!on; if(on && quantOn) quantOn=false; snapOn=on; }
function setGizmoVisible(b){ gizmoVisible=!!b; scheduleRender(); }
function quantStep(){
if(lastOrthoView>=0){ const view=vpState.views[lastOrthoView];
if(view&&view.type!=='persp'){ const cam=view.cam; const r=rectFor(lastOrthoView)||vpState.fullRect;
if(r){ const hH=BASE/view_ctrl_zoom(cam); const pw=2*hH/r.h; return orthoVisibleStep(pw); } } }
return QUANT_BASE_STEP; }
function angleStepPx(linePx){ const R=RING_PX;
if(linePx<R) return 10*D2R; if(linePx<2*R) return 5*D2R; if(linePx<4*R) return 1*D2R; return 0.5*D2R; }
function niceStepWorld(v){ const a=Math.abs(v); if(a<1e-9)return 1; return Math.pow(10,Math.floor(Math.log10(a))-1); }
function quantSize(ws){ const st=niceStepWorld(ws); const aw=Math.abs(ws); const q=aw<st*SCALE_ZERO_FRAC?0:Math.round(aw/st)*st; return ws<0?-q:q; }
function snapSizeGrid(ws,pw){ const ma=Math.pow(10,Math.ceil(Math.log10(MAJOR_LO*pw))); const mi=ma*0.1; const aw=Math.abs(ws); const r=Math.round(aw/mi)*mi; return ws<0?-r:r; }
function snapVisibleStep(pw){ const ma=Math.pow(10,Math.ceil(Math.log10(MAJOR_LO*pw))); const mi=ma*0.1; return (mi/pw)>=SNAP_GRID_PX?mi:ma; }
function orthoVisibleStep(pw){ const ma=Math.pow(10,Math.ceil(Math.log10(ORTHO_MAJOR_LO*pw))); return ma*0.1; }
let _gizInfo=null;
function onGizmoDragInfo(cb){ _gizInfo=cb; }
function emitInfo(o){ if(_gizInfo)_gizInfo(o); }
/* ------------------------------- модель ------------------------------ */
const OBJ=new Map();
const MATS=new Map();
let rootOrder=[];
let defaultMatHash=null;
let sceneObjects=new Map();
let contentThrees=[];
const threeOf=new Map();
const threeMats=new Map();
const selectMats=new Set();
const replicaStates=new Map();
const booleanRuntime=new FrameBooleanRuntime();
const splineData=new Map();
const splineVisuals=new Map();
const evaluatedSplineCache=new Map();
const splineSelection={vertices:new Set(),handles:new Set(),segments:new Set(),active:null,anchor:null,pivot:null};
const splineHover={kind:null,object:null,id:null,side:null,point:null,t:0,view:-1};
let splineMode=false,splineDrawing=false,splineDrawSequence=null,splineLastVertex=null,splineDrawHistory=[],splineCtrlSequence=null,splineCtrlLastVertex=null,splineWorkPlane=null,splinePointerGesture=null,splineWeldCandidate=null,splineDrawPreview=null,splineTangentPreview=null,splineBevelTool=null,splineOutlineTool=null;
let soloSet=null;
function setSoloHashes(s){ soloSet=(s&&s.size)?new Set(s):null; scheduleRender(); }
function getSoloHashes(){ return soloSet; }
function genHash(){ let h=''; for(let i=0;i<32;i++) h+=Math.floor(Math.random()*16).toString(16); return h; }
function getRootOrder(){ return rootOrder.slice(); }
function getObj(h){ return OBJ.get(h); }
function effectiveVisible(h){
let c=OBJ.get(h);
if(!c) return false;
if(soloSet){ let ok=false;
while(c){ if(soloSet.has(c.hash)){ ok=true; break; } c=c.parent?OBJ.get(c.parent):null; }
if(!ok) return false;
c=OBJ.get(h); }
while(c){ if(!c.visible) return false; if(c.hash!==h&&consumesGeneratorChildren(c.hash)&&!(selNodes.has(h)&&splineData.has(h)))return false; c=c.parent?OBJ.get(c.parent):null; }
return true; }
function visibleWithoutGeneratorConsumption(h){let c=OBJ.get(h);if(!c)return false;if(soloSet){let ok=false,q=c;while(q){if(soloSet.has(q.hash)){ok=true;break;}q=q.parent?OBJ.get(q.parent):null;}if(!ok)return false;}while(c){if(!c.visible)return false;c=c.parent?OBJ.get(c.parent):null;}return true;}
function splinePatchCageVisible(h,mode){if(![3,4].includes(mode)||!splineData.has(h)||!visibleWithoutGeneratorConsumption(h))return false;const parent=OBJ.get(OBJ.get(h)?.parent),state=parent&&replicaStates.get(parent.hash);return !!(parent?.enabled&&objParams.get(parent.hash)?.__type==='spline_patch'&&state?.ready);}
function getMat(h){ return MATS.get(h); }
function getAllMatHashes(){ return [...MATS.keys()]; }
function getDefaultMatHash(){ return defaultMatHash; }
function defaultMapFrame(){ return new THREE.Matrix4().makeScale(1000,1000,1000); }
function ownGeomExtent(h){ const mesh=pickMeshes.get(h),pos=mesh&&mesh.geometry&&mesh.geometry.attributes.position; if(!pos||!pos.count)return new THREE.Vector3(1,1,1); const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity),v=new THREE.Vector3(); for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i);mn.min(v);mx.max(v);} return mx.sub(mn); }
function defaultTagMapFrame(h){
const ext=ownGeomExtent(h),n=OBJ.get(h),wm=n?worldMatrix(n):new THREE.Matrix4(),e=wm.elements;
// Поэтому texture, назначенная после object scale, не растягивается по этой оси.
const sx=Math.hypot(e[0],e[1],e[2]),sy=Math.hypot(e[4],e[5],e[6]),sz=Math.hypot(e[8],e[9],e[10]);
const size=Math.max(1e-6,ext.x*sx,ext.y*sy,ext.z*sz); return new THREE.Matrix4().makeScale(size,size,size);
}
function blankMat(){ return {h:0,s:0,l:80,emm:0,rough:50,metal:0,opac:0,bump:0,mapFrame:defaultMapFrame(),mapPivot:new THREE.Matrix4()}; }
function installFrameProjection(t){ if(t.userData.frameProjection)return; t.userData.frameProjection=true;
 t.onBeforeCompile=function(shader){ const frame=this.userData.frameRef||defaultMapFrame(); shader.uniforms.frameMapInv={value:frame.clone().invert()}; shader.uniforms.frameBump={value:this.userData.frameBump||0}; this.userData.frameShader=shader;
  shader.vertexShader='varying vec3 vFrameLocalPos; varying vec3 vFrameLocalNormal;\n'+shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\n vFrameLocalNormal=objectNormal;').replace('#include <begin_vertex>','#include <begin_vertex>\n vFrameLocalPos=transformed;');
  shader.fragmentShader='varying vec3 vFrameLocalPos; varying vec3 vFrameLocalNormal; uniform mat4 frameMapInv; uniform float frameBump;\n'+shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
#ifdef USE_MAP
 vec3 bumpP=(frameMapInv*vec4(vFrameLocalPos,1.0)).xyz;
 vec3 bumpN=normalize(mat3(frameMapInv)*vFrameLocalNormal);
 vec3 bumpW=pow(abs(bumpN),vec3(4.0)); bumpW/=max(dot(bumpW,vec3(1.0)),0.0001);
 float bumpH=dot((texture2D(map,bumpP.zy).rgb*bumpW.x+texture2D(map,bumpP.xz).rgb*bumpW.y+texture2D(map,bumpP.xy).rgb*bumpW.z),vec3(0.299,0.587,0.114));
normal=normalize(normal-frameBump*vec3(dFdx(bumpH),dFdy(bumpH),0.0));
#endif`).replace('#include <map_fragment>',`#ifdef USE_MAP
 vec3 frameP=(frameMapInv*vec4(vFrameLocalPos,1.0)).xyz;
 vec3 frameN=normalize(mat3(frameMapInv)*vFrameLocalNormal);
 vec3 frameW=pow(abs(frameN),vec3(4.0)); frameW/=max(dot(frameW,vec3(1.0)),0.0001);
 vec4 frameX=texture2D(map,frameP.zy); vec4 frameY=texture2D(map,frameP.xz); vec4 frameZ=texture2D(map,frameP.xy);
 diffuseColor*=frameX*frameW.x+frameY*frameW.y+frameZ*frameW.z;
#endif`); };
 t.customProgramCacheKey=()=> 'frame-cubic-projection-v2'; t.needsUpdate=true; }
function makeMat(opts){ const hash=genHash();
const mat=Object.assign({name:'material'},blankMat(),{map:null,texBytes:null,texMime:null,isDefault:false},opts);
MATS.set(hash,mat); return hash; }
/* дефолтный материал с яркостью 50 */
function createDefaultMat(){ const h=makeMat({name:'default',isDefault:true,l:50}); defaultMatHash=h; return h; }
function deleteMat(h){ MATS.delete(h);
const t=threeMats.get(h); if(t){ threeMats.delete(h); if(t.map)t.map.dispose(); if(t.bumpMap&&t.bumpMap!==t.map)t.bumpMap.dispose(); t.dispose(); }
if(defaultMatHash===h) defaultMatHash=null; }
function restoreMat(hash, opts){
const mat=Object.assign({name:'material'},blankMat(),{map:null,texBytes:null,texMime:null,isDefault:false},opts);
MATS.set(hash,mat);
if(!mat.map && mat.texBytes && mat.texBytes.length)
texBytesToImage(mat.texBytes, mat.texMime, im=>{ mat.map=im; syncThreeMat(hash); scheduleRender(); if(_matReadyCb)_matReadyCb(hash); });
return hash;}
function makeNode(name,type,enableSlot){ const h=genHash();
OBJ.set(h,{hash:h,name,type,parent:null,children:[],visible:true,enabled:true,enableSlot:!!enableSlot,
tags:[],folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()});
return h; }
function setObjField(h,field,val){ const n=OBJ.get(h); if(n) n[field]=val; }
function setNodePivot(h,arr){ const n=OBJ.get(h); if(n&&arr) n.pivot.fromArray(arr); }
const _ltmp=new THREE.Matrix4(), _m=new THREE.Matrix4(), _pm=new THREE.Matrix4();
function localTmp(n){ _ltmp.copy(n.lin); _ltmp.elements[12]=n.pos.x; _ltmp.elements[13]=n.pos.y; _ltmp.elements[14]=n.pos.z; return _ltmp; }
function setNodeFromLocal(n,m4){ n.pos.set(m4.elements[12],m4.elements[13],m4.elements[14]);
n.lin.copy(m4); n.lin.elements[12]=0; n.lin.elements[13]=0; n.lin.elements[14]=0; }
function setNodeFromWorld(n,worldM4){ const pw=n.parent?worldMatrix(OBJ.get(n.parent)):new THREE.Matrix4();
_wm2.copy(pw).invert().multiply(worldM4); setNodeFromLocal(n,_wm2); }
const _wm=new THREE.Matrix4(), _wm2=new THREE.Matrix4(), _lm2=new THREE.Matrix4();
function worldMatrix(n){ const chain=[]; let c=n; while(c){ chain.push(c); c=c.parent?OBJ.get(c.parent):null; }
_wm.identity(); for(let i=chain.length-1;i>=0;i--){ const k=chain[i]; _wm.multiply(localTmp(k)); } return _wm.clone(); }
function gizmoWorldMatrix(h){ const n=OBJ.get(h); if(!n) return new THREE.Matrix4();
return worldMatrix(n).multiply(n.pivot); }
const UV_VIRTUAL='__uv_mapping_frame__', UV_PROXY_SIZE=1000;
function getWorldMatrix(h){ if(h===UV_VIRTUAL){ const m=uvVirtualWorld(); return m?m.elements.slice():new THREE.Matrix4().elements.slice(); } const n=OBJ.get(h); if(!n) return new THREE.Matrix4().elements.slice(); return worldMatrix(n).elements.slice(); }
function gizmoMatrixForNode(h){ const n=OBJ.get(h); if(!n) return new THREE.Matrix4().elements.slice();
return gizmoWorldMatrix(h).elements.slice(); }
function isAncestor(anc,desc){ let c=desc; while(c){ if(c===anc)return true; c=c.parent?OBJ.get(c.parent):null; } return false; }
function collectSubtree(h,out){ out.add(h); const n=OBJ.get(h); if(n) n.children.forEach(c=>collectSubtree(c,out)); }
/* ------------------- three-материалы (Standard) ---------------------- */
function syncThreeMat(hash){ const m=MATS.get(hash); if(!m) return;
let t=threeMats.get(hash);
if(!t){ t=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.5,metalness:0,side:THREE.DoubleSide}); threeMats.set(hash,t); }
t.userData.frameMatHash=hash;
t.side=THREE.DoubleSide;
t.color.setStyle('hsl('+m.h+','+m.s+'%,'+m.l+'%)');
t.emissive.setStyle('hsl('+m.h+','+m.s+'%,'+m.emm+'%)');
t.roughness=clamp(m.rough,0,100)/100;
t.metalness=clamp(m.metal,0,100)/100;
t.envMapIntensity=0.35;
const op=1-clamp(m.opac,0,100)/100;
const tr=op<1;
t.opacity=op; t.transparent=tr; t.depthWrite=!tr;
let tex=null;
if(m.map&&m.map.complete&&m.map.naturalWidth){
if(!m._tex||m._tex.image!==m.map){ m._tex=new THREE.Texture(m.map); m._tex.colorSpace=THREE.SRGBColorSpace; m._tex.wrapS=m._tex.wrapT=THREE.RepeatWrapping; }
m._tex.needsUpdate=true; tex=m._tex; }
const mapCh=(t.map!==tex);
t.map=tex;
t.bumpMap=(tex&&m.bump>0)?tex:null;
t.bumpMap=null; t.bumpScale=0; t.userData.frameBump=(clamp(m.bump,0,100)/100)*80;
installFrameProjection(t); t.userData.frameRef=m.mapFrame||defaultMapFrame();
if(t.userData.frameShader){ t.userData.frameShader.uniforms.frameMapInv.value.copy(t.userData.frameRef).invert(); t.userData.frameShader.uniforms.frameBump.value=t.userData.frameBump||0; }
if(mapCh) t.needsUpdate=true; }
function getThreeMat(hash){ if(!threeMats.has(hash)) syncThreeMat(hash); return threeMats.get(hash)||null; }
function mappingOwnerWorld(h){ const n=OBJ.get(h),source=n?worldMatrix(n):new THREE.Matrix4(),out=new THREE.Matrix4(); rotMatOfLin(source,out); out.setPosition(source.elements[12],source.elements[13],source.elements[14]); return out; }
function tagFrameForMesh(tag,tagOwner,meshOwner){
const owner=tagOwner||meshOwner,mesh=meshOwner||owner;
if(!OBJ.get(owner)||!OBJ.get(mesh))return tag.mapFrame.clone();
const localToMap=mappingOwnerWorld(owner).invert().multiply(worldMatrix(OBJ.get(mesh)));
return localToMap.invert().multiply(tag.mapFrame);
}
function getTagThreeMat(hash,tag,tagOwner,meshOwner){
if(!tag)return getThreeMat(hash); ensureTagFrame(tag); const base=getThreeMat(hash); if(!base)return null;
const key=meshOwner||tagOwner||'', cache=tag._threeMats||(tag._threeMats=new Map()); let t=cache.get(key);
if(!t){ t=base.clone(); t.userData={frameBump:base.userData.frameBump||0,frameMatHash:hash}; installFrameProjection(t); t.needsUpdate=true; cache.set(key,t); }
const frame=tagFrameForMesh(tag,tagOwner||meshOwner,meshOwner||tagOwner); t.userData.frameRef=frame;
if(t.userData.frameShader){ t.userData.frameShader.uniforms.frameMapInv.value.copy(frame).invert(); t.userData.frameShader.uniforms.frameBump.value=base.userData.frameBump||0; }
return t;
}
function invalidateTagThreeMats(hash){ eachNode(n=>n.tags.forEach(tag=>{ if(tag.type!==1||tag.ref!==hash||!tag._threeMats)return; for(const t of tag._threeMats.values())t.dispose(); tag._threeMats.clear(); })); }
let matRefreshPending=false;
function touchMat(hash){ if(MATS.has(hash)){ syncThreeMat(hash); invalidateTagThreeMats(hash); if(!matRefreshPending){ matRefreshPending=true; requestAnimationFrame(()=>{matRefreshPending=false;refreshMaterials();}); } scheduleRender(); } }
function disposeThreeMats(){ for(const t of threeMats.values()){ if(t.map)t.map.dispose(); if(t.bumpMap&&t.bumpMap!==t.map)t.bumpMap.dispose(); t.dispose(); } threeMats.clear(); }
function matIsShared(mm){ for(const v of threeMats.values()) if(v===mm) return true; return false; }
function disposeObjThrees(t){ t.traverse(o=>{ if(o.geometry)o.geometry.dispose();
if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(mm=>{ if(!matIsShared(mm))mm.dispose(); }); }); }
function resolveMatBinding(h){ let owner=h,c=OBJ.get(h);
while(c){ for(const t of c.tags){ if(t.type===1&&t.polys==null&&t.ref&&MATS.has(t.ref))return {hash:t.ref,tag:t,owner}; } owner=c.parent;c=c.parent?OBJ.get(c.parent):null; }
return {hash:defaultMatHash,tag:null,owner:null}; }
function resolveMatHash(h){ return resolveMatBinding(h).hash; }
function assignMeshMat(mesh,hash){ if(!mesh||!mesh.isMesh||mesh.userData._selectMat) return;
const g=mesh.geometry,idx=g&&g.index,triCount=idx?idx.count/3:((g&&g.attributes.position)?g.attributes.position.count/3:0),node=OBJ.get(hash),binding=resolveMatBinding(hash),base=binding.hash; if(!g||!node)return;
if(mesh.userData._generatorOutput&&!binding.owner){mesh.material=getThreeMat(defaultMatHash);g.clearGroups();const state=replicaStates.get(hash);if(state&&!PARAMETRIC_MESH_TYPES.has(objParams.get(hash)?.__type))state.signature=null;return;}
const faceTag=new Map(); for(const t of node.tags)if(t.type===1&&Array.isArray(t.polys)&&t.ref&&MATS.has(t.ref))for(const fi of t.polys)if(fi>=0&&fi<triCount)faceTag.set(fi,t);
if(!faceTag.size){ const tm=base?getTagThreeMat(base,binding.tag,binding.owner,hash):null; if(tm&&mesh.material!==tm)mesh.material=tm; g.clearGroups(); return; }
const baseKey=binding.tag||('base:'+base),keys=new Map([[baseKey,0]]),mats=[getTagThreeMat(base,binding.tag,binding.owner,hash)];const slot=fi=>{const tag=faceTag.get(fi),key=tag||baseKey;let mi=keys.get(key);if(mi===undefined){mi=mats.length;keys.set(key,mi);mats.push(getTagThreeMat(tag.ref,tag,hash,hash));}return mi;};g.clearGroups();let start=0,active=slot(0);
for(let fi=1;fi<=triCount;fi++){ const next=fi<triCount?slot(fi):-1; if(next!==active){ g.addGroup(start*3,(fi-start)*3,active);start=fi;active=next; } } mesh.material=mats.length===1?mats[0]:mats; }
function applyNodeMaterial(h){ const set=new Set(); collectSubtree(h,set);
for(const hh of set) assignMeshMat(pickMeshes.get(hh),hh); scheduleRender(); }
function refreshMaterials(){ for(const hh of pickMeshes.keys()) assignMeshMat(pickMeshes.get(hh),hh); scheduleRender(); }
/* ---- шейдинг: per-view ---- */
// При старте: перспектива — Solid, ортографические виды — Wireframe.
let viewShading=[4,4,4,4];
function getViewShading(vi){ return viewShading[vi]||0; }
function setViewShading(vi,mode){ if(vi>=0&&vi<4){ viewShading[vi]=mode; scheduleRender(); } }
function setAllShading(mode){ for(let i=0;i<4;i++)viewShading[i]=mode; scheduleRender(); }
function setShadingMode(mode){ setAllShading(mode); }
let wireOverlays=new Map(),polyPointOverlays=new Map(),creaseOverlays=new Map();
function liveWireGeometry(src){
const pos=src?.attributes?.position,idx=src?.index;if(!pos)return new THREE.BufferGeometry();
const edgeMap=new Map(),source=[];const add=(a,b)=>{if(a===b)return;const k=a<b?`${a}:${b}`:`${b}:${a}`;if(edgeMap.has(k))return;edgeMap.set(k,true);source.push(a,b);};
const count=idx?idx.count:pos.count;for(let i=0;i+2<count;i+=3){const a=idx?idx.getX(i):i,b=idx?idx.getX(i+1):i+1,c=idx?idx.getX(i+2):i+2;add(a,b);add(b,c);add(c,a);}
const out=new Float32Array(source.length*3);for(let i=0;i<source.length;i++){const v=source[i];out[i*3]=pos.getX(v);out[i*3+1]=pos.getY(v);out[i*3+2]=pos.getZ(v);}
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(out,3));g.userData.sourceGeometry=src;g.userData.sourceVertices=new Uint32Array(source);return g;
}
function updateLiveWireGeometry(wire,src){
const g=wire?.geometry,map=g?.userData?.sourceVertices,pos=src?.attributes?.position,out=g?.attributes?.position;
if(g?.userData?.sourceGeometry!==src||!map||!pos||out.count!==map.length)return false;
for(let i=0;i<map.length;i++){const v=map[i];out.setXYZ(i,pos.getX(v),pos.getY(v),pos.getZ(v));}out.needsUpdate=true;g.computeBoundingSphere();return true;
}
function ensureWireOverlays(){
for(const [h,mesh] of pickMeshes){ if(!mesh.isMesh||!mesh.geometry||mesh.userData._largeSharedGeometry||replicaStates.get(h)?.sharedGeometry)continue;
if(!wireOverlays.has(h)){
const wg=liveWireGeometry(mesh.geometry);
const wl=new THREE.LineSegments(wg,new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:0.4,depthTest:true,depthWrite:false}));
wl.userData._wireOverlay=true; wl.matrixAutoUpdate=false; wl.renderOrder=LAYER_OBJ+1; wl.visible=false;
mesh.add(wl); wireOverlays.set(h,wl); } } }
function ensurePolyPointOverlay(h,mesh){let points=polyPointOverlays.get(h);if(!points){points=new THREE.Points(mesh.geometry,new THREE.PointsMaterial({color:0x54c9ff,size:4,sizeAttenuation:false,depthTest:true,depthWrite:false}));points.matrixAutoUpdate=false;points.renderOrder=LAYER_OBJ+2;points.visible=false;polyPointOverlays.set(h,points);}else if(points.geometry!==mesh.geometry)points.geometry=mesh.geometry;const parent=mesh.parent||vpState.scene;if(points.parent!==parent){points.parent?.remove(points);parent.add(points);}points.matrix.copy(mesh.matrix);points.updateMatrixWorld(true);return points;}
function creaseGeometry(src){const pos=src.attributes.position,idx=src.index,faces=(idx?idx.count:pos.count)/3,edgeMap=new Map(),p=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],key=v=>`${v.x.toFixed(7)},${v.y.toFixed(7)},${v.z.toFixed(7)}`;for(let f=0;f<faces;f++){for(let k=0;k<3;k++)p[k].fromBufferAttribute(pos,idx?idx.getX(f*3+k):f*3+k);const n=p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();for(let k=0;k<3;k++){const a=p[k].clone(),b=p[(k+1)%3].clone(),ka=key(a),kb=key(b),ek=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`,e=edgeMap.get(ek)||{a,b,normals:[]};e.normals.push(n.clone());edgeMap.set(ek,e);}}const lines=[];for(const e of edgeMap.values())if(e.normals.length===1||e.normals.some((a,i)=>e.normals.some((b,j)=>j>i&&a.dot(b)<CREASE_COS))){lines.push(...e.a.toArray(),...e.b.toArray());}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));return g;}
function ensureCreaseOverlay(h,mesh){let line=creaseOverlays.get(h);if(!line){line=new THREE.LineSegments(creaseGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:0x54c9ff,depthTest:true,depthWrite:false}));line.matrixAutoUpdate=false;line.renderOrder=LAYER_OBJ+2;line.visible=false;creaseOverlays.set(h,line);}else if(line.userData.source!==mesh.geometry){line.geometry.dispose();line.geometry=creaseGeometry(mesh.geometry);}line.userData.source=mesh.geometry;const parent=mesh.parent||vpState.scene;if(line.parent!==parent){line.parent?.remove(line);parent.add(line);}line.matrix.copy(mesh.matrix);line.updateMatrixWorld(true);return line;}
function refreshWireOverlay(mesh){ const h=meshToHash.get(mesh),wl=h&&wireOverlays.get(h); if(!wl||!mesh.geometry)return;if(updateLiveWireGeometry(wl,mesh.geometry))return;const old=wl.geometry;wl.geometry=liveWireGeometry(mesh.geometry);old.dispose(); }
function applyShadingMode(mode){
const wire=(mode===1||mode===3);
const solidWire=(mode===2||mode===4);
for(const t of threeMats.values()){ t.wireframe=wire; t.depthTest=true; t.depthWrite=solidWire||!t.transparent; }
for(const m of selectMats){ m.wireframe=wire; m.depthTest=true; m.depthWrite=solidWire||!m.transparent; }
if(solidWire){ ensureWireOverlays(); for(const [,o] of wireOverlays) o.visible=true; }
else { for(const [,o] of wireOverlays) o.visible=false; }
for(const [h,mesh] of pickMeshes){const type=objParams.get(h)?.__type,isDerivedSurface=['boolean','instance','symmetry','cloner','spline_patch','extrude','lathe','sweep','cube','cylinder','tube','sphere'].includes(type),isPolygon=!splineData.has(h)&&!isDerivedSurface,selected=selNodes.has(h),large=!!mesh.userData._largeSharedGeometry||!!replicaStates.get(h)?.sharedGeometry;if(!isPolygon||large){if(large){const points=polyPointOverlays.get(h);if(points){points.parent?.remove(points);points.material?.dispose();polyPointOverlays.delete(h);}const crease=creaseOverlays.get(h);if(crease){crease.parent?.remove(crease);crease.geometry?.dispose();crease.material?.dispose();creaseOverlays.delete(h);}}continue;}const points=ensurePolyPointOverlay(h,mesh),creases=ensureCreaseOverlay(h,mesh),cageOnly=mode===3,cageOverlay=mode===4,editing=selected&&polyMode;if(cageOnly){mesh.visible=effectiveVisible(h)&&editing&&(polyElementMode==='edge'||polyElementMode==='face');const wl=wireOverlays.get(h);if(wl)wl.visible=mesh.visible;creases.visible=effectiveVisible(h)&&!editing;}else if(cageOverlay){mesh.visible=effectiveVisible(h);const wl=wireOverlays.get(h);if(wl)wl.visible=editing&&(polyElementMode==='edge'||polyElementMode==='face');creases.visible=effectiveVisible(h)&&!editing;}else creases.visible=false;points.material.depthTest=mode===0||mode===2||mode===4;points.visible=effectiveVisible(h)&&editing&&polyElementMode==='vertex';}
for(const [h,state] of replicaStates){const type=objParams.get(h)?.__type,derivedSurface=['boolean','spline_patch','extrude','lathe','sweep','cube','cylinder','tube','sphere'].includes(type),visible=!!OBJ.get(h)?.enabled&&state.ready&&effectiveVisible(h);if(state.cage)state.cage.visible=[3,4].includes(mode)&&visible;if(state.seam)state.seam.visible=[3,4].includes(mode)&&visible;if(state.mesh&&derivedSurface){state.mesh.visible=visible&&mode!==3;const wl=wireOverlays.get(h);if(wl)wl.visible=mode===2&&visible;}} }
function syncMeshParents(){
for(const [h,n] of OBJ){ if(!threeOf.has(h)){ const o=new THREE.Object3D(); o.matrixAutoUpdate=false; o.matrix.copy(localTmp(n)); threeOf.set(h,o); vpState.scene.add(o); } }
for(const [h,n] of OBJ){ const t=threeOf.get(h); if(!t)continue; const pm=n.parent?threeOf.get(n.parent):null; const desired=pm||vpState.scene;
if(t.parent!==desired){ if(t.parent)t.parent.remove(t); desired.add(t); } t.matrix.copy(localTmp(n)); t.updateMatrixWorld(true); }
for(const [h,t] of threeOf){ if(!OBJ.has(h) && !t.userData._hiddenForUndo){
if(t.parent)t.parent.remove(t); threeOf.delete(h);
if(t.geometry) disposeObjThrees(t); } } }
const PROCEDURAL_TYPES=new Set(['instance','symmetry','cloner','spline_patch','boolean','extrude','lathe','sweep','cube','cylinder','tube','sphere']);
let generatorPass=0,generatorTimer=null,generatorActivePasses=0,generatorRegistry=new Set(),generatorDependents=new Map(),generatorRegistryObjectCount=-1,generatorRegistryParamCount=-1,activeGeneratorProfile=null,generatorAllPending=false,pendingGeneratorTargets=new Set();
const generatorPerformance={scheduled:0,targetedScheduled:0,globalScheduled:0,coalesced:0,passes:0,totalMilliseconds:0,lastMilliseconds:0,lastVisited:0,lastTargets:0,lastRebuilt:0,maxMilliseconds:0,bufferUploads:0,positionUpdates:0,sharedBindings:0};
const phasePerformance={selectionCalls:0,selectionMilliseconds:0,wireOverlayCalls:0,wireOverlayMilliseconds:0,bvhBuilds:0,bvhMilliseconds:0,bvhBackend:'none'};
function refreshGeneratorRegistry(){if(generatorRegistryObjectCount!==OBJ.size||generatorRegistryParamCount!==objParams.size){generatorRegistry=new Set([...objParams].filter(([h,p])=>OBJ.has(h)&&PROCEDURAL_TYPES.has(p?.__type)).map(([h])=>h));generatorRegistryObjectCount=OBJ.size;generatorRegistryParamCount=objParams.size;}generatorDependents=new Map();for(const h of generatorRegistry){const n=OBJ.get(h),p=objParams.get(h),deps=[...(n?.children||[])];if(p?.__type==='instance'&&p.source)deps.push(p.source);for(const dep of deps){let set=generatorDependents.get(dep);if(!set)generatorDependents.set(dep,set=new Set());set.add(h);}}}
function generatorDirtyCone(hashes){refreshGeneratorRegistry();const out=new Set(),queue=[...hashes];while(queue.length){const h=queue.shift();if(out.has(h))continue;out.add(h);for(const dependent of generatorDependents.get(h)||[])queue.push(dependent);}return out;}
function derivedState(h){return replicaStates.get(h);}
function consumesGeneratorChildren(h){const type=objParams.get(h)?.__type,state=derivedState(h),n=OBJ.get(h);return !!(n?.enabled&&state?.ready&&(type==='boolean'||type==='symmetry'||type==='cloner'||type==='spline_patch'||type==='extrude'||type==='lathe'||type==='sweep'));}
function disposeGeneratorCage(state){if(!state)return;if(state.cage){state.cage.traverse(o=>{o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());});if(state.cage.parent)state.cage.parent.remove(state.cage);}state.cage=null;state.virtualCage=null;}
function disposeBooleanSeam(state){const seam=state?.seam;if(!seam)return;if(seam.parent)seam.parent.remove(seam);seam.geometry?.dispose();seam.material?.dispose();state.seam=null;}
function disposeReplicaState(h,state){disposeGeneratorCage(state);disposeBooleanSeam(state);const mesh=state?.mesh;if(mesh){if(pickMeshes.get(h)===mesh)pickMeshes.delete(h);meshToHash.delete(mesh);const wire=wireOverlays.get(h);if(wire){wire.parent?.remove(wire);wire.geometry.dispose();wire.material.dispose();wireOverlays.delete(h);}if(mesh.parent)mesh.parent.remove(mesh);if(!state.sharedGeometry)mesh.geometry.dispose();}replicaStates.delete(h);}
function clearReplicaOutputs(){for(const [h,state] of replicaStates)disposeReplicaState(h,state);}
function ensureReplicaState(h){let state=replicaStates.get(h);if(!state){state={mesh:null,ready:false,error:null,signature:null};replicaStates.set(h,state);}if(!state.mesh){syncMeshParents();const parent=threeOf.get(h);if(!parent)return state;const mesh=new THREE.Mesh(new THREE.BufferGeometry(),getThreeMat(resolveMatHash(h)));mesh.matrixAutoUpdate=false;mesh.matrix.identity();mesh.renderOrder=LAYER_OBJ;mesh.userData._generatorOutput=true;parent.add(mesh);state.mesh=mesh;registerPickMesh(h,mesh);}return state;}
function evaluatedInputHashes(root){const out=[];function visit(h){const n=OBJ.get(h);if(!n)return;const state=derivedState(h);if(state?.ready&&state.mesh){out.push(h);return;}if(n.type===TYPE_MESH&&pickMeshes.has(h)){out.push(h);return;}for(const child of n.children)visit(child);}visit(root);return out;}
function meshStamp(h,rootInv){const mesh=pickMeshes.get(h),g=mesh?.geometry;if(!g?.attributes.position)return null;mesh.updateMatrixWorld(true);const rel=rootInv.clone().multiply(mesh.matrixWorld),p=g.attributes.position,i=g.index;return [h,g.uuid,p.version,i?.version||0,...rel.elements.map(x=>Number(x.toPrecision(10)))].join(',');}
function replicaMeshStamp(h,anchor){const mesh=pickMeshes.get(h),g=mesh?.geometry,mats=Array.isArray(mesh?.material)?mesh.material:[mesh?.material];return meshStamp(h,anchor)+'|'+mats.map(m=>m?.uuid||'').join(',')+'|'+(g?.groups||[]).map(q=>q.start+','+q.count+','+q.materialIndex).join(';');}
function appendGeneratedMesh(mesh,matrix,positions,indices,materials,materialIds,groups,uvs){const g=mesh?.geometry,pos=g?.attributes.position,idx=g?.index,uv=g?.attributes.uv;if(!pos)return;const base=positions.length/3,p=new THREE.Vector3(),flip=matrix.determinant()<0,sourceMaterials=Array.isArray(mesh.material)?mesh.material:[mesh.material];let groupCursor=0;const faceMaterial=fi=>{const at=fi*3;while(groupCursor+1<g.groups.length&&at>=g.groups[groupCursor].start+g.groups[groupCursor].count)groupCursor++;const group=g.groups[groupCursor],material=sourceMaterials[(group&&at>=group.start&&at<group.start+group.count)?group.materialIndex:0]||sourceMaterials[0]||getThreeMat(defaultMatHash);let mi=materialIds.get(material);if(mi===undefined){mi=materials.length;materialIds.set(material,mi);materials.push(material);}return mi;};for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(matrix);positions.push(p.x,p.y,p.z);if(uvs)uvs.push(uv?uv.getX(i):0,uv?uv.getY(i):0);}const faces=(idx?idx.count:pos.count)/3;for(let fi=0;fi<faces;fi++){const a=base+(idx?idx.getX(fi*3):fi*3),b=base+(idx?idx.getX(fi*3+1):fi*3+1),c=base+(idx?idx.getX(fi*3+2):fi*3+2),mi=faceMaterial(fi),start=indices.length;indices.push(a,flip?c:b,flip?b:c);const last=groups[groups.length-1];if(last&&last.materialIndex===mi&&last.start+last.count===start)last.count+=3;else groups.push({start,count:3,materialIndex:mi});}}
function clearReplicaGeometry(state){disposeGeneratorCage(state);disposeBooleanSeam(state);if(!state.mesh)return;const old=state.mesh.geometry;state.mesh.geometry=new THREE.BufferGeometry();if(!state.sharedGeometry)old.dispose();state.sharedGeometry=false;state.sharedGeometrySource=null;refreshWireOverlay(state.mesh);}
function setReplicaError(h,state,message){state.ready=false;state.error=message;clearReplicaGeometry(state);renderRows();scheduleRender();}
function buildGeneratorRenderGeometry(positions,indices,groups,analyticNormals=null){
const vertexCount=positions.length/3,coord=new Array(vertexCount),coordFaces=new Map(),edgeFaces=new Map(),faceNormals=[],faceAreaNormals=[],valid=[];
const coordKey=v=>`${positions[v*3].toFixed(6)},${positions[v*3+1].toFixed(6)},${positions[v*3+2].toFixed(6)}`;
for(let v=0;v<vertexCount;v++)coord[v]=coordKey(v);
for(let f=0;f<indices.length/3;f++){const ia=indices[f*3],ib=indices[f*3+1],ic=indices[f*3+2],ax=positions[ia*3],ay=positions[ia*3+1],az=positions[ia*3+2],abx=positions[ib*3]-ax,aby=positions[ib*3+1]-ay,abz=positions[ib*3+2]-az,acx=positions[ic*3]-ax,acy=positions[ic*3+1]-ay,acz=positions[ic*3+2]-az,nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx,len=Math.hypot(nx,ny,nz);if(len<1e-10)continue;faceAreaNormals[f]=[nx,ny,nz];faceNormals[f]=[nx/len,ny/len,nz/len];valid.push(f);const faceCoords=[coord[ia],coord[ib],coord[ic]];for(const key of new Set(faceCoords)){let list=coordFaces.get(key);if(!list)coordFaces.set(key,list=[]);list.push(f);}for(let k=0;k<3;k++){const a=faceCoords[k],b=faceCoords[(k+1)%3];if(a===b)continue;const key=a<b?`${a}|${b}`:`${b}|${a}`;let list=edgeFaces.get(key);if(!list)edgeFaces.set(key,list=[]);if(!list.includes(f))list.push(f);}}
const smooth=new Map(valid.map(f=>[f,new Set()]));for(const list of edgeFaces.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j],na=faceNormals[a],nb=faceNormals[b];if(na[0]*nb[0]+na[1]*nb[1]+na[2]*nb[2]>=CREASE_COS){smooth.get(a)?.add(b);smooth.get(b)?.add(a);}}
const component=new Map(),componentNormal=new Map(),coordComponentCount=new Map();for(const [key,faces] of coordFaces){const allowed=new Set(faces),seen=new Set();for(const seed of faces){if(seen.has(seed))continue;coordComponentCount.set(key,(coordComponentCount.get(key)||0)+1);const id=`${key}#${seed}`,stack=[seed];let nx=0,ny=0,nz=0;seen.add(seed);while(stack.length){const f=stack.pop(),n=faceAreaNormals[f];component.set(`${key}|${f}`,id);nx+=n[0];ny+=n[1];nz+=n[2];for(const q of smooth.get(f)||[])if(allowed.has(q)&&!seen.has(q)){seen.add(q);stack.push(q);}}const len=Math.hypot(nx,ny,nz)||1;componentNormal.set(id,[nx/len,ny/len,nz/len]);}}
const outP=[],outN=[],outI=[],source=[],normalSource=[],vertices=new Map(),faceMaterials=[];let gi=0;const materialForFace=f=>{const at=f*3;while(gi+1<groups.length&&at>=groups[gi].start+groups[gi].count)gi++;const g=groups[gi];return g&&at>=g.start&&at<g.start+g.count?g.materialIndex:0;};
for(const f of valid){faceMaterials.push(materialForFace(f));for(let k=0;k<3;k++){const v=indices[f*3+k],id=component.get(`${coord[v]}|${f}`)||`${coord[v]}#${f}`;let oi=vertices.get(id);if(oi===undefined){oi=outP.length/3;vertices.set(id,oi);source.push(v);outP.push(positions[v*3],positions[v*3+1],positions[v*3+2]);const useAnalytic=analyticNormals?.length===positions.length&&coordComponentCount.get(coord[v])===1,n=useAnalytic?[analyticNormals[v*3],analyticNormals[v*3+1],analyticNormals[v*3+2]]:(componentNormal.get(id)||faceNormals[f]);normalSource.push(useAnalytic?v:-1);outN.push(n[0],n[1],n[2]);}outI.push(oi);}}
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(outP,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(outN,3));g.setIndex(outI);let last=null,start=0;for(let i=0;i<faceMaterials.length;i++){const mat=faceMaterials[i];if(last===null){last=mat;start=i*3;}else if(last!==mat){g.addGroup(start,i*3-start,last);last=mat;start=i*3;}}if(last!==null)g.addGroup(start,outI.length-start,last);g.computeBoundingBox();g.computeBoundingSphere();return {geometry:g,source:new Uint32Array(source),normalSource:Int32Array.from(normalSource)};
}
function updateGeneratorNormals(g,rawNormals,normalSource){const pos=g.attributes.position,normal=g.attributes.normal,idx=g.index;if(!pos||!normal||!idx||!normalSource||!rawNormals?.length||normalSource.length!==pos.count)return false;for(const source of normalSource)if(source>=rawNormals.length/3)return false;const sums=new Float64Array(pos.count*3);for(let i=0;i<pos.count;i++){const source=normalSource[i];if(source>=0){sums[i*3]=rawNormals[source*3];sums[i*3+1]=rawNormals[source*3+1];sums[i*3+2]=rawNormals[source*3+2];}}for(let at=0;at<idx.count;at+=3){const a=idx.getX(at),b=idx.getX(at+1),c=idx.getX(at+2);if(normalSource[a]>=0&&normalSource[b]>=0&&normalSource[c]>=0)continue;const ax=pos.getX(a),ay=pos.getY(a),az=pos.getZ(a),abx=pos.getX(b)-ax,aby=pos.getY(b)-ay,abz=pos.getZ(b)-az,acx=pos.getX(c)-ax,acy=pos.getY(c)-ay,acz=pos.getZ(c)-az,nx=aby*acz-abz*acy,ny=abz*acx-abx*acz,nz=abx*acy-aby*acx;for(const v of [a,b,c])if(normalSource[v]<0){sums[v*3]+=nx;sums[v*3+1]+=ny;sums[v*3+2]+=nz;}}for(let i=0;i<pos.count;i++){const at=i*3,l=Math.hypot(sums[at],sums[at+1],sums[at+2])||1;normal.setXYZ(i,sums[at]/l,sums[at+1]/l,sums[at+2]/l);}normal.needsUpdate=true;return true;}
function generatorFaceOrientation(positions,indices,closed){
const faces=indices.length/3,coord=new Array(positions.length/3);for(let i=0;i<coord.length;i++)coord[i]=`${positions[i*3].toFixed(6)},${positions[i*3+1].toFixed(6)},${positions[i*3+2].toFixed(6)}`;
const edges=new Map(),adj=Array.from({length:faces},()=>[]);for(let f=0;f<faces;f++)for(let k=0;k<3;k++){const a=coord[indices[f*3+k]],b=coord[indices[f*3+(k+1)%3]],key=a<b?`${a}|${b}`:`${b}|${a}`;let list=edges.get(key);if(!list)edges.set(key,list=[]);list.push({f,a,b});}
for(const list of edges.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j],same=a.a===b.a&&a.b===b.b;adj[a.f].push({f:b.f,same});adj[b.f].push({f:a.f,same});}
const flip=Array(faces).fill(null),components=[];for(let seed=0;seed<faces;seed++){if(flip[seed]!==null)continue;const component=[],queue=[seed];flip[seed]=false;while(queue.length){const f=queue.shift();component.push(f);for(const q of adj[f])if(flip[q.f]===null){flip[q.f]=flip[f]!==q.same;queue.push(q.f);}}components.push(component);}
if(closed)for(const component of components){let volume=0;for(const f of component){let a=indices[f*3],b=indices[f*3+1],c=indices[f*3+2];if(flip[f]){const q=b;b=c;c=q;}const ax=positions[a*3],ay=positions[a*3+1],az=positions[a*3+2],bx=positions[b*3],by=positions[b*3+1],bz=positions[b*3+2],cx=positions[c*3],cy=positions[c*3+1],cz=positions[c*3+2];volume+=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx);}if(volume<0)for(const f of component)flip[f]=!flip[f];}
return flip;
}
function applyGeneratorFaceOrientation(indices,flip){for(let f=0;f<flip.length;f++)if(flip[f]){const at=f*3,q=indices[at+1];indices[at+1]=indices[at+2];indices[at+2]=q;}}
function applyRadialSurfaceNormals(g){const pos=g.attributes.position;if(!pos?.count)return;g.computeBoundingBox();const center=g.boundingBox.getCenter(new THREE.Vector3()),normal=new Float32Array(pos.count*3);for(let i=0;i<pos.count;i++){let x=pos.getX(i)-center.x,y=pos.getY(i)-center.y,z=pos.getZ(i)-center.z,l=Math.hypot(x,y,z)||1;normal[i*3]=x/l;normal[i*3+1]=y/l;normal[i*3+2]=z/l;}g.setAttribute('normal',new THREE.BufferAttribute(normal,3));}
function applyRoundPrimitiveNormals(g,tube=false){const pos=g.attributes.position,old=g.attributes.normal;if(!pos?.count)return;g.computeBoundingBox();const center=g.boundingBox.getCenter(new THREE.Vector3()),height=g.boundingBox.max.y-g.boundingBox.min.y,eps=Math.max(1e-5,height*1e-5),normal=new Float32Array(pos.count*3),radii=[];for(let i=0;i<pos.count;i++)radii.push(Math.hypot(pos.getX(i)-center.x,pos.getZ(i)-center.z));const positive=radii.filter(r=>r>eps),rMin=Math.min(...positive),rMax=Math.max(...positive),split=(rMin+rMax)*.5;for(let i=0;i<pos.count;i++){const x=pos.getX(i)-center.x,y=pos.getY(i),z=pos.getZ(i)-center.z,r=Math.hypot(x,z)||1,isEnd=Math.abs(y-g.boundingBox.min.y)<=eps||Math.abs(y-g.boundingBox.max.y)<=eps;if(isEnd&&old&&Math.abs(old.getY(i))>.5){normal[i*3]=0;normal[i*3+1]=y<center.y?-1:1;normal[i*3+2]=0;}else{const sign=tube&&r<split?-1:1;normal[i*3]=sign*x/r;normal[i*3+1]=0;normal[i*3+2]=sign*z/r;}}g.setAttribute('normal',new THREE.BufferAttribute(normal,3));}
function installReplicaResult(h,state,positions,indices,materials,groups,normals=null){
if(positions.length%3||indices.length%3||positions.some(v=>!Number.isFinite(v))||indices.some(v=>!Number.isInteger(v)||v<0||v>=positions.length/3))throw new Error('Generator produced invalid geometry');
const uploadStarted=performance.now(),type=objParams.get(h)?.__type,liveSurface=['spline_patch','extrude','lathe','sweep'].includes(type)||PARAMETRIC_MESH_TYPES.has(type),creaseSurface=['boolean','spline_patch','extrude','lathe','sweep','cube','cylinder','tube'].includes(type),hasAnalytic=normals?.length===positions.length,rawIndexHash=indices.reduce((v,x,i)=>((v^((x+1)*(i+17)))>>>0)*16777619>>>0,2166136261);if(liveSurface){if(state.rawIndexHash!==rawIndexHash||state.faceOrientation?.length!==indices.length/3)state.faceOrientation=generatorFaceOrientation(positions,indices,!!state.report?.closed);applyGeneratorFaceOrientation(indices,state.faceOrientation);}const indexHash=indices.reduce((v,x,i)=>((v^((x+1)*(i+17)))>>>0)*16777619>>>0,2166136261),old=state.mesh.geometry,oldShared=!!state.sharedGeometry,oldPos=old.attributes.position,forceFinal=!gizDrag&&state.needsFinalBuild,same=!oldShared&&liveSurface&&!forceFinal&&state.rawVertexCount===positions.length/3&&state.indexHash===indexHash&&state.renderSourceMap&&oldPos?.count===state.renderSourceMap.length;let g,normalBackend='geometric-face-area';state.mesh.matrix.identity();
if(same){g=old;for(let i=0;i<state.renderSourceMap.length;i++){const v=state.renderSourceMap[i];oldPos.setXYZ(i,positions[v*3],positions[v*3+1],positions[v*3+2]);}oldPos.needsUpdate=true;if(hasAnalytic&&updateGeneratorNormals(g,normals,state.renderNormalSource))normalBackend='analytic-EvalBatch';else g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();generatorPerformance.positionUpdates++;}
else if(creaseSurface){const built=buildGeneratorRenderGeometry(positions,indices,groups,hasAnalytic?normals:null);g=built.geometry;state.renderSourceMap=built.source;state.renderNormalSource=built.normalSource;if(hasAnalytic&&built.normalSource.some(x=>x>=0))normalBackend='analytic-EvalBatch+crease-area';state.mesh.geometry=g;if(!oldShared)old.dispose();}
else if(liveSurface){g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);for(const group of groups)g.addGroup(group.start,group.count,group.materialIndex);if(hasAnalytic){g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));normalBackend='analytic-EvalBatch';}else g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();state.renderSourceMap=Uint32Array.from({length:positions.length/3},(_,i)=>i);state.renderNormalSource=hasAnalytic?Int32Array.from({length:positions.length/3},(_,i)=>i):null;state.mesh.geometry=g;if(!oldShared)old.dispose();}
else{g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);for(const group of groups)g.addGroup(group.start,group.count,group.materialIndex);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();state.mesh.geometry=g;if(!oldShared)old.dispose();rebuildCreaseRender(state.mesh);g=state.mesh.geometry;state.renderSourceMap=null;}if(!same)generatorPerformance.bufferUploads++;state.sharedGeometry=false;state.sharedGeometrySource=null;
const normalHint=objParams.get(h)?.normalHint;if(type==='sphere'||normalHint==='radial'){applyRadialSurfaceNormals(g);normalBackend='analytic-radial';}else if(type==='cylinder'||normalHint==='cylinder'){applyRoundPrimitiveNormals(g,false);normalBackend='analytic-cylinder';}else if(type==='tube'||normalHint==='tube'){applyRoundPrimitiveNormals(g,true);normalBackend='analytic-tube';}state.rawVertexCount=positions.length/3;state.rawIndexHash=rawIndexHash;state.indexHash=indexHash;state.needsFinalBuild=!!gizDrag;state.mesh.material=materials.length===1?materials[0]:materials;if(resolveMatBinding(h).owner)assignMeshMat(state.mesh,h);const wireStarted=performance.now();refreshWireOverlay(state.mesh);const wireMilliseconds=performance.now()-wireStarted;phasePerformance.wireOverlayCalls++;phasePerformance.wireOverlayMilliseconds+=wireMilliseconds;const uploadMilliseconds=performance.now()-uploadStarted;if(state.report)Object.assign(state.report,{normalBackend,uploadMilliseconds,wireOverlayMilliseconds:wireMilliseconds,bvhMilliseconds:0,selectionMilliseconds:phasePerformance.selectionMilliseconds});state.ready=true;state.error=null;renderRows();scheduleRender();
}
function installBooleanSeam(h,state,seamPositions,seamIndices){disposeBooleanSeam(state);if(!seamIndices?.length)return;const lines=new Float32Array(seamIndices.length*3);for(let i=0;i<seamIndices.length;i++){const source=seamIndices[i]*3,target=i*3;lines[target]=seamPositions[source];lines[target+1]=seamPositions[source+1];lines[target+2]=seamPositions[source+2];}const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(lines,3));const seam=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x31b8ff,depthTest:true,depthWrite:false}));seam.matrixAutoUpdate=false;seam.matrix.identity();seam.renderOrder=LAYER_OBJ+3;seam.visible=[3,4].includes(shadingMode);threeOf.get(h)?.add(seam);state.seam=seam;}
function cleanBooleanFloatMesh(positions,indices){
const count=positions.length/3;let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<count;i++)for(let k=0;k<3;k++){const value=positions[i*3+k];min[k]=Math.min(min[k],value);max[k]=Math.max(max[k],value);}const extent=Math.max(1,max[0]-min[0],max[1]-min[1],max[2]-min[2]),cellKey=(x,y,z)=>`${x}:${y}:${z}`;
const attempt=tolerance=>{const remap=new Uint32Array(count),cleanPositions=[],cells=new Map(),toleranceSq=tolerance*tolerance;for(let i=0;i<count;i++){const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2],cx=Math.floor(x/tolerance),cy=Math.floor(y/tolerance),cz=Math.floor(z/tolerance);let representative=-1,best=toleranceSq;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)for(const q of cells.get(cellKey(cx+dx,cy+dy,cz+dz))||[]){const at=q*3,d=(cleanPositions[at]-x)**2+(cleanPositions[at+1]-y)**2+(cleanPositions[at+2]-z)**2;if(d<=best){best=d;representative=q;}}if(representative<0){representative=cleanPositions.length/3;cleanPositions.push(x,y,z);const key=cellKey(cx,cy,cz),bucket=cells.get(key)||[];bucket.push(representative);cells.set(key,bucket);}remap[i]=representative;}const cleanIndices=[],triangles=new Set();let droppedDegenerate=0,droppedDuplicate=0;for(let i=0;i<indices.length;i+=3){const a=remap[indices[i]],b=remap[indices[i+1]],c=remap[indices[i+2]];if(a===b||b===c||c===a){droppedDegenerate++;continue;}const key=[a,b,c].sort((x,y)=>x-y).join(':');if(triangles.has(key)){droppedDuplicate++;continue;}triangles.add(key);cleanIndices.push(a,b,c);}const used=new Uint8Array(cleanPositions.length/3);for(const i of cleanIndices)used[i]=1;const compactMap=new Uint32Array(used.length),compactPositions=[];for(let i=0;i<used.length;i++)if(used[i]){compactMap[i]=compactPositions.length/3;compactPositions.push(cleanPositions[i*3],cleanPositions[i*3+1],cleanPositions[i*3+2]);}for(let i=0;i<cleanIndices.length;i++)cleanIndices[i]=compactMap[cleanIndices[i]];const edges=new Map();for(let i=0;i<cleanIndices.length;i+=3)for(let e=0;e<3;e++){const a=cleanIndices[i+e],b=cleanIndices[i+(e+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)||0)+1);}let boundaryEdges=0,nonManifoldEdges=0;for(const edgeCount of edges.values()){if(edgeCount===1)boundaryEdges++;else if(edgeCount>2)nonManifoldEdges++;}return {positions:new Float32Array(compactPositions),indices:new Uint32Array(cleanIndices),weldedVertices:count-compactPositions.length/3,droppedDegenerate,droppedDuplicate,boundaryEdges,nonManifoldEdges,tolerance,topologyValid:!boundaryEdges&&!nonManifoldEdges};};
let best=null;for(const factor of [5e-6,1e-5,2e-5,5e-5,1e-4]){const candidate=attempt(Math.max(1e-7,extent*factor));if(!best||candidate.nonManifoldEdges*1000000+candidate.boundaryEdges<best.nonManifoldEdges*1000000+best.boundaryEdges)best=candidate;if(candidate.topologyValid)return candidate;}return best;}
function booleanOperandHashes(root){const n=OBJ.get(root);if(!n)return[];const type=objParams.get(root)?.__type,state=derivedState(root),derived=['boolean','instance','symmetry','cloner','spline_patch','extrude','lathe','sweep'].includes(type);if(derived)return state?.ready&&state.mesh?[root]:[];if(n.type===TYPE_MESH&&pickMeshes.has(root))return[root];const out=[];for(const child of n.children)out.push(...booleanOperandHashes(child));return out;}
function booleanOperandData(root,rootInv){const hashes=booleanOperandHashes(root);if(!hashes.length)throw new Error(`Boolean operand ${OBJ.get(root)?.name||root} has no evaluated mesh`);const positions=[],indices=[],materials=[],materialIds=new Map(),groups=[];for(const hash of hashes){const mesh=pickMeshes.get(hash);mesh?.updateMatrixWorld(true);if(mesh)appendGeneratedMesh(mesh,rootInv.clone().multiply(mesh.matrixWorld),positions,indices,materials,materialIds,groups);}if(!indices.length)throw new Error(`Boolean operand ${OBJ.get(root)?.name||root} is empty`);return {hashes,positions:new Float32Array(positions),indices:new Uint32Array(indices)};}
function booleanCagePolylines(root,rootInv){const out=[];function visit(h){const n=OBJ.get(h);if(!n)return;const state=derivedState(h),source=state?.virtualCage?.polylines;if(source?.length){const owner=threeOf.get(h);owner?.updateMatrixWorld(true);const rel=rootInv.clone().multiply(owner?.matrixWorld||worldMatrix(n)),point=new THREE.Vector3();for(const line of source)out.push({kind:line.kind||'boundary',closed:!!line.closed,points:line.points.map(p=>point.fromArray(p).applyMatrix4(rel).toArray())});return;}for(const child of n.children)visit(child);}visit(root);return out;}
function booleanSeamPolylines(positions,indices){const out=[];for(let i=0;i<indices.length;i+=2){const a=indices[i]*3,b=indices[i+1]*3;out.push({kind:'seam',closed:false,points:[[positions[a],positions[a+1],positions[a+2]],[positions[b],positions[b+1],positions[b+2]]]});}return out;}
function installBooleanCage(h,state,inherited,seam){installGeneratorCage(h,state,inherited);const all=inherited.concat(seam);state.virtualCage={polylines:all.map((q,i)=>({id:`boolean-cage:${i}`,kind:q.kind||'boundary',closed:!!q.closed,points:q.points.map(p=>p.slice())})),segments:all.length};}
function booleanChildren(n,p){const order=p?.operandOrder;if(Array.isArray(order)&&order.length===2&&order.every(h=>n.children.includes(h)))return order;return n.children;}
async function evaluateBooleanNode(h,pass){
const n=OBJ.get(h),p=objParams.get(h),state=ensureReplicaState(h);if(!n||p?.__type!=='boolean'||!n.enabled)return;const operands=booleanChildren(n,p);if(operands.length!==2){state.report=null;setReplicaError(h,state,'Boolean requires exactly two operands');return;}
syncMeshParents();const root=threeOf.get(h);root?.updateMatrixWorld(true);const rootInv=(root?.matrixWorld||worldMatrix(n)).clone().invert();let a,b,aCage,bCage;try{a=booleanOperandData(operands[0],rootInv);b=booleanOperandData(operands[1],rootInv);aCage=booleanCagePolylines(operands[0],rootInv);bCage=booleanCagePolylines(operands[1],rootInv);}catch(error){setReplicaError(h,state,error.message||String(error));return;}
const signature=`${p.op}|A:${a.hashes.map(x=>meshStamp(x,rootInv)).join(';')}|B:${b.hashes.map(x=>meshStamp(x,rootInv)).join(';')}`;if(state.signature===signature&&(state.ready||state.error))return;state.signature=signature;const token=(state.booleanToken||0)+1;state.booleanToken=token;state.pending=true;
try{
const result=await booleanRuntime.evaluate(a,b,p.op);if(pass!==generatorPass||state.booleanToken!==token||!OBJ.has(h))return;
const cleaned=cleanBooleanFloatMesh(result.positions,result.indices),expectsClosed=!result.report.boundaryA&&!result.report.boundaryB,transferTrusted=!cleaned.nonManifoldEdges&&(!expectsClosed||cleaned.topologyValid),postTransfer={vertices:cleaned.positions.length/3,triangles:cleaned.indices.length/3,weldedVertices:cleaned.weldedVertices,tolerance:cleaned.tolerance,droppedDegenerate:cleaned.droppedDegenerate,droppedDuplicate:cleaned.droppedDuplicate,boundaryEdges:cleaned.boundaryEdges,nonManifoldEdges:cleaned.nonManifoldEdges,expectsClosed},report={backend:'frame-js-r2',operation:p.op,rc:result.rc,wallMilliseconds:result.wallMilliseconds,vertices:cleaned.positions.length/3,triangles:cleaned.indices.length/3,seamVertices:result.seamPositions.length/3,seamSegments:result.seamIndices.length/2,cageInputPrimitives:aCage.length+bCage.length,cageInputA:aCage.length,cageInputB:bCage.length,cageOutputPrimitives:0,cageOutputA:0,cageOutputB:0,cageClipMilliseconds:0,trusted:!!result.report.topologyValid&&!result.report.ambiguous&&transferTrusted,postTransfer,...result.report};
if(!report.trusted){state.report=report;setReplicaError(h,state,result.report.ambiguous?'Boolean result is ambiguous':!transferTrusted?'Boolean topology was lost in Float32 transfer':'Boolean topology is untrusted');return;}
const cageClip=aCage.length+bCage.length?await clipBooleanCageToSurface(booleanRuntime,aCage.concat(bCage),cleaned):{polylines:[],wallMilliseconds:0,grid:0,postings:0,tolerance:cleaned.tolerance,probes:0,transitions:0};if(pass!==generatorPass||state.booleanToken!==token||!OBJ.has(h))return;const aClipped=[],bClipped=[];for(const q of cageClip.polylines){const clean={kind:q.kind,closed:q.closed,points:q.points};(q.sourceLine<aCage.length?aClipped:bClipped).push(clean);}report.cageOutputPrimitives=aClipped.length+bClipped.length;report.cageOutputA=aClipped.length;report.cageOutputB=bClipped.length;report.cageClipMilliseconds=cageClip.wallMilliseconds;report.cageClipGrid=cageClip.grid;report.cageClipPostings=cageClip.postings;report.cageClipTolerance=cageClip.tolerance;report.cageClipProbes=cageClip.probes;report.cageClipTransitions=cageClip.transitions;state.report=report;
installReplicaResult(h,state,cleaned.positions,cleaned.indices,[getThreeMat(resolveMatHash(h))],[{start:0,count:cleaned.indices.length,materialIndex:0}]);const seam=booleanSeamPolylines(result.seamPositions,result.seamIndices);installBooleanCage(h,state,aClipped.concat(bClipped),seam);installBooleanSeam(h,state,result.seamPositions,result.seamIndices);
}catch(error){if(pass===generatorPass&&state.booleanToken===token)setReplicaError(h,state,error.message||String(error));}finally{if(state.booleanToken===token)state.pending=false;}}
function replicaCopies(type,p){const out=[];if(type==='symmetry'){const axes=[];if(p.x)axes.push(0);if(p.y)axes.push(1);if(p.z)axes.push(2);const count=1<<axes.length;for(let mask=0;mask<count;mask++){const s=[1,1,1];axes.forEach((axis,i)=>{if(mask&(1<<i))s[axis]=-1;});out.push(new THREE.Matrix4().makeScale(s[0],s[1],s[2]));}return out;}if(p.mode==='matrix'){const nx=Math.max(1,Math.round(p.mx)),ny=Math.max(1,Math.round(p.my)),nz=Math.max(1,Math.round(p.mz));if(nx*ny*nz>100000)throw new Error('Cloner copy limit exceeded');for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)out.push(new THREE.Matrix4().makeTranslation(x*p.dx,y*p.dy,z*p.dz));return out;}const count=Math.max(1,Math.round(p.count));if(count>100000)throw new Error('Cloner copy limit exceeded');const span=(+p.angle||0)*D2R,step=count>1?(Math.abs(span-TAU)<1e-8?span/count:span/(count-1)):0;for(let i=0;i<count;i++)out.push(new THREE.Matrix4().makeRotationY(step*i));return out;}
function evaluateReplicaNode(h){const n=OBJ.get(h),p=objParams.get(h),type=p?.__type;if(!n||!(type==='instance'||type==='symmetry'||type==='cloner'))return;const state=ensureReplicaState(h);if(!n.enabled)return;let roots,anchor;if(type==='instance'){if(!p.source||!OBJ.has(p.source)){setReplicaError(h,state,'Instance source is missing');return;}roots=[p.source];anchor=worldMatrix(OBJ.get(p.source)).invert();}else{if(!n.children.length){setReplicaError(h,state,type+' requires children');return;}roots=n.children.slice();anchor=worldMatrix(n).invert();}const inputGroups=roots.map(evaluatedInputHashes),hashes=inputGroups.flat();if(inputGroups.some(x=>!x.length)){setReplicaError(h,state,'Generator input has no evaluated mesh');return;}const stamps=hashes.map(x=>replicaMeshStamp(x,anchor)),signature=JSON.stringify(p)+'|'+stamps.join('|');if(state.signature===signature&&(state.ready||state.error)&&!(!gizDrag&&state.needsFinalBuild))return;state.signature=signature;try{if(type==='instance'&&hashes.length===1){const source=pickMeshes.get(hashes[0]),geometry=source?.geometry;if(!source||!geometry?.attributes.position||!geometry.index)throw new Error('Instance source geometry is empty');source.updateMatrixWorld(true);const rel=anchor.clone().multiply(source.matrixWorld),old=state.mesh.geometry;if(old!==geometry||!state.sharedGeometry)generatorPerformance.sharedBindings++;if(old!==geometry&&!state.sharedGeometry)old.dispose();state.mesh.geometry=geometry;state.mesh.matrix.copy(rel);state.mesh.material=source.material;state.sharedGeometry=true;state.sharedGeometrySource=hashes[0];state.renderSourceMap=null;state.renderNormalSource=null;state.ready=true;state.error=null;state.report={backend:'shared-buffer-instance',sharedGeometry:true,source:hashes[0],vertices:geometry.attributes.position.count,triangles:geometry.index.count/3};renderRows();scheduleRender();return;}const copies=type==='instance'?[new THREE.Matrix4()]:replicaCopies(type,p),positions=[],indices=[],materials=[],materialIds=new Map(),groups=[];state.mesh.matrix.identity();for(const copy of copies)for(const mh of hashes){const mesh=pickMeshes.get(mh);mesh?.updateMatrixWorld(true);const rel=anchor.clone().multiply(mesh.matrixWorld),matrix=copy.clone().multiply(rel);appendGeneratedMesh(mesh,matrix,positions,indices,materials,materialIds,groups);}if(!indices.length)throw new Error('Generator result is empty');installReplicaResult(h,state,positions,indices,materials,groups);}catch(error){setReplicaError(h,state,error.message||String(error));}}
function evaluateSplinePatchNode(h){const n=OBJ.get(h),state=ensureReplicaState(h);if(!n||objParams.get(h)?.__type!=='spline_patch'||!n.enabled)return;if(n.children.length!==1||!splineData.has(n.children[0])){state.report=null;setReplicaError(h,state,'Spline Patch requires exactly one spline child');return;}const child=n.children[0],data=evaluatedSplineData(child);syncMeshParents();const root=threeOf.get(h),source=threeOf.get(child);root?.updateMatrixWorld(true);source?.updateMatrixWorld(true);const rel=(root?.matrixWorld||worldMatrix(n)).clone().invert().multiply(source?.matrixWorld||worldMatrix(OBJ.get(child))),signature=JSON.stringify(data)+'|'+rel.elements.map(x=>Number(x.toPrecision(10))).join(',');if(state.signature===signature&&(state.ready||state.error)&&!(!gizDrag&&state.needsFinalBuild))return;state.signature=signature;const built=buildSplineSurfaceMeshData(data,{runtimeKey:child});state.report=built.report;state.topology=built.topology;if(!built.report.ok){setReplicaError(h,state,built.report.errors[0]||'Spline cage cannot form a manifold surface');updateSplineVisual(child);return;}if(!built.indices.length){setReplicaError(h,state,'Spline cage has no closed contours or patch cells');updateSplineVisual(child);return;}const positions=[],normals=[],p=new THREE.Vector3(),normalMatrix=new THREE.Matrix3().getNormalMatrix(rel);for(let i=0;i<built.positions.length;i+=3){p.set(built.positions[i],built.positions[i+1],built.positions[i+2]).applyMatrix4(rel);positions.push(p.x,p.y,p.z);if(built.normals?.length===built.positions.length){p.set(built.normals[i],built.normals[i+1],built.normals[i+2]).applyMatrix3(normalMatrix).normalize();normals.push(p.x,p.y,p.z);}}const indices=built.indices.slice();if(rel.determinant()<0)for(let i=0;i<indices.length;i+=3){const q=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=q;}installReplicaResult(h,state,positions,indices,[getThreeMat(resolveMatHash(h))],[{start:0,count:indices.length,materialIndex:0}],normals);const cage=SPLINE.approximateSpline(data).map(q=>({kind:'boundary',closed:q.closed,points:q.points.map(x=>p.fromArray(x.position).applyMatrix4(rel).toArray())}));installGeneratorCage(h,state,cage);const cageData=SPLINE.cloneSplineData(data);transformWholeSplineData(cageData,rel);state.virtualCage.data=cageData;updateSplineVisual(child);}
function evaluateSplineGeneratorNode(h){
const n=OBJ.get(h),p=objParams.get(h),type=p?.__type,state=ensureReplicaState(h);if(!n||!['extrude','lathe','sweep'].includes(type)||!n.enabled)return;
const expected=type==='sweep'?2:1;if(n.children.length!==expected||n.children.some(child=>!splineData.has(child))){state.report=null;setReplicaError(h,state,`${type==='sweep'?'Sweep':'Generator'} requires exactly ${expected} spline ${expected===1?'child':'children'}`);return;}
syncMeshParents();const root=threeOf.get(h),rootInv=(root?.matrixWorld||worldMatrix(n)).clone().invert(),sources=n.children.map(child=>{const source=threeOf.get(child),childNode=OBJ.get(child);source?.updateMatrixWorld(true);const rel=rootInv.clone().multiply(source?.matrixWorld||worldMatrix(childNode)),pivot=rel.clone().multiply(childNode?.pivot||new THREE.Matrix4()),data=SPLINE.cloneSplineData(evaluatedSplineData(child));transformWholeSplineData(data,rel);return {child,data,rel,pivot};}),signature=JSON.stringify(p)+'|'+sources.map(q=>JSON.stringify(q.data)+'@'+q.rel.elements.map(x=>Number(x.toPrecision(10))).join(',')+'#'+q.pivot.elements.map(x=>Number(x.toPrecision(10))).join(',')).join('|');
if(type==='sweep'&&!SPLINE.resolveSplineTopology(sources[0].data).planarContours.length&&SPLINE.resolveSplineTopology(sources[1].data).planarContours.length)sources.reverse();
if(state.signature===signature&&(state.ready||state.error)&&!(!gizDrag&&state.needsFinalBuild))return;state.signature=signature;
try{const buildStarted=performance.now();let generated;if(type==='extrude'){const sourceTopology=SPLINE.resolveSplineTopology(sources[0].data),first=sourceTopology.planarContours.find(c=>c.plane?.planar);if(!first)throw new Error('Extrude profile must contain a closed planar contour');if(p.startFillet||p.endFillet)generated=buildExtrudeFilletSplineCage(sources[0].data,p);else{const offset=new THREE.Vector3().fromArray(first.plane.normal).normalize().multiplyScalar(+p.offset||0).toArray();generated=buildExtrudeSplineCage(sources[0].data,offset);}}else if(type==='lathe')generated={data:buildLatheSplineCage(sources[0].data,p,sources[0].pivot),sourceTopology:SPLINE.resolveSplineTopology(sources[0].data)};else generated={data:buildSweepSplineCage(sources[0].data,sources[1].data),sourceTopology:SPLINE.resolveSplineTopology(sources[0].data)};state.generatedCageData=SPLINE.cloneSplineData(generated.data);const built=buildSplineSurfaceMeshData(generated.data,{runtimeKey:`generator:${h}`});built.report={...built.report,generator:type,generatedCage:true,triangleFallback:false,inputContours:generated.sourceTopology?.planarContours?.length??null,buildMilliseconds:performance.now()-buildStarted};built.cage=SPLINE.approximateSpline(generated.data).map(q=>({kind:'boundary',closed:q.closed,points:q.points.map(x=>x.position)}));built.cageData=generated.data;state.report=built.report;state.topology=built.topology||null;if(!built.report.ok||!built.indices.length)throw new Error(built.report?.errors?.[0]||`${type} result is empty`);installReplicaResult(h,state,built.positions,built.indices,[getThreeMat(resolveMatHash(h))],[{start:0,count:built.indices.length,materialIndex:0}],built.normals);installGeneratorCage(h,state,built.cage);state.virtualCage.data=built.cageData;}catch(error){state.report=error.report||state.report;setReplicaError(h,state,error.message||String(error));}}
async function evaluateProceduralTree(h,pass,done,stack){if(done.has(h)||pass!==generatorPass)return;if(activeGeneratorProfile)activeGeneratorProfile.visited++;if(stack.has(h)){const state=ensureReplicaState(h);setReplicaError(h,state,'Generator dependency cycle');done.add(h);return;}const n=OBJ.get(h);if(!n)return;stack.add(h);for(const child of n.children)await evaluateProceduralTree(child,pass,done,stack);const p=objParams.get(h);if(p?.__type==='instance'&&p.source)await evaluateProceduralTree(p.source,pass,done,stack);if(pass===generatorPass){const before=replicaStates.get(h)?.signature;if(p?.__type==='instance'||p?.__type==='symmetry'||p?.__type==='cloner')evaluateReplicaNode(h);else if(p?.__type==='spline_patch')evaluateSplinePatchNode(h);else if(p?.__type==='boolean')await evaluateBooleanNode(h,pass);else if(p&&['extrude','lathe','sweep'].includes(p.__type))evaluateSplineGeneratorNode(h);if(activeGeneratorProfile&&replicaStates.get(h)?.signature!==before)activeGeneratorProfile.rebuilt++;}stack.delete(h);done.add(h);}
async function updateGenerators(pass){const started=performance.now(),profile={visited:0,rebuilt:0};generatorActivePasses++;try{syncMeshParents();for(const [h,state] of [...replicaStates])if(!OBJ.has(h))disposeReplicaState(h,state);refreshGeneratorRegistry();const targets=generatorAllPending?new Set(generatorRegistry):generatorDirtyCone(pendingGeneratorTargets);generatorAllPending=false;pendingGeneratorTargets.clear();const done=new Set();activeGeneratorProfile=profile;for(const h of targets)if(OBJ.has(h))await evaluateProceduralTree(h,pass,done,new Set());const elapsed=performance.now()-started;generatorPerformance.passes++;generatorPerformance.totalMilliseconds+=elapsed;generatorPerformance.lastMilliseconds=elapsed;generatorPerformance.maxMilliseconds=Math.max(generatorPerformance.maxMilliseconds,elapsed);generatorPerformance.lastVisited=profile.visited;generatorPerformance.lastTargets=targets.size;generatorPerformance.lastRebuilt=profile.rebuilt;scheduleRender();}finally{activeGeneratorProfile=null;generatorActivePasses--;}}
function scheduleGeneratorEvaluation(delay=40,targets=null){generatorPerformance.scheduled++;if(targets==null){generatorPerformance.globalScheduled++;generatorAllPending=true;}else{generatorPerformance.targetedScheduled++;for(const h of targets)pendingGeneratorTargets.add(h);}const pass=++generatorPass;if(generatorTimer){clearTimeout(generatorTimer);generatorPerformance.coalesced++;}generatorTimer=setTimeout(()=>{generatorTimer=null;updateGenerators(pass);},delay);}
function treeOrderIndex(){ const idx=new Map(); let i=0;
const walk=h=>{ idx.set(h,i++); const n=OBJ.get(h); if(n) n.children.forEach(walk); };
rootOrder.forEach(walk); return idx; }
function sortByTreeOrder(arr){ const idx=treeOrderIndex(); return arr.slice().sort((a,b)=>(idx.get(a)??1e9)-(idx.get(b)??1e9)); }
/* --------------------------- трансформации --------------------------- */
let gizmoLocal=false;
function getGizmoLocal(){ return gizmoLocal; }
function setGizmoLocal(b){ gizmoLocal=!!b; render(); }
const cubeRef={mesh:null};
const gizmo={pos:new THREE.Vector3(), lin:new THREE.Matrix4()};
let gizmoHandleOrient=new THREE.Quaternion();
let hudNode=null;
function setHUDNode(h){ hudNode=h; }
const gizmoBoundsMin=new THREE.Vector3(), gizmoBoundsMax=new THREE.Vector3();
function setGizmoBounds(min,max){ if(min)(min.isVector3?gizmoBoundsMin.copy(min):gizmoBoundsMin.fromArray(min)); if(max)(max.isVector3?gizmoBoundsMax.copy(max):gizmoBoundsMax.fromArray(max)); }
function boundsExtentAlong(mn,mx,dir){ let lo=Infinity,hi=-Infinity;
for(let i=0;i<8;i++){ const x=(i&1)?mx.x:mn.x, y=(i&2)?mx.y:mn.y, z=(i&4)?mx.z:mn.z;
const t=x*dir.x+y*dir.y+z*dir.z; if(t<lo)lo=t; if(t>hi)hi=t; }
return Math.max(hi-lo,1e-9); }
let frozenSignsPerView=null;
const pickMeshes=new Map(), meshToHash=new Map();
let _vpPick=null, _gizStart=null, _gizEnd=null;
const pickRay=new THREE.Raycaster(), pickNdc=new THREE.Vector2();
const brackets={line:null,geo:null,pos:null,min:new THREE.Vector3(),max:new THREE.Vector3(),visible:false,has:false,opacity:1,fading:false,fadeStart:0};
const polyHover={face:null,faceBack:null,edge:null,vertex:null,facePos:null,edgePos:null,vertexPos:null,kind:null,view:-1};
const polySelection={items:new Map(),face:null,faceBack:null,edge:null,vertex:null};
const vertexTools={mode:null,menuPoint:null,visibleOnly:true,line:[],view:-1,snap:null,loop:null,hole:null,soft:{active:false,radius:100,weights:new Map(),hoverSig:null},snapVertex:null,snapEdge:null,linePreview:null,loopPreview:null,softPreview:null};
const pickVisiblePolyFaces=createVisibleFacePicker();
function registerPickMesh(h,mesh){ pickMeshes.set(h,mesh); meshToHash.set(mesh,h); pickMeshes.get(h).matrixAutoUpdate=false; }
function onViewportPick(cb){ _vpPick=cb; }
function onGizmoDragStart(cb){ _gizStart=cb; }
function onGizmoDragEnd(cb){ _gizEnd=cb; }
function getGizDragMode(){ return gizDrag?gizDrag.mode:null; }
function getWorldPos(h){ const n=OBJ.get(h); if(!n) return null; const m=worldMatrix(n); const e=m.elements; return [e[12],e[13],e[14]]; }
function getPolyWeight(h){ const m=pickMeshes.get(h); return (m&&m.geometry&&m.geometry.attributes&&m.geometry.attributes.position)? m.geometry.attributes.position.count : 1; }
function getWorldBBox(h){ if(splineData.has(h))return splineObjectBounds(h);const m=pickMeshes.get(h); if(!m||!m.geometry)return null; const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity); if(!expandMeshBounds(m,null,mn,mx))return null; return {min:mn.toArray(),max:mx.toArray()}; }
function pickHashAt(cx,cy){ const vi=viewAt(cx,cy); if(vi<0)return null; const r=rectFor(vi); if(!r)return null;
pickNdc.set(((cx-r.x)/r.w)*2-1,-((cy-r.y)/r.h)*2+1); pickRay.setFromCamera(pickNdc,vpState.views[vi].cam);
const hits=pickRay.intersectObjects([...pickMeshes.values()],false);
for(const hh of hits){ const h2=meshToHash.get(hh.object); if(h2) return h2; } return null; }
const _bbv=new THREE.Vector3(),_bbM=new THREE.Matrix4();
function expandMeshBounds(mesh,frame,mn,mx){ const pos=mesh.geometry&&mesh.geometry.attributes.position; if(!pos)return false;
mesh.updateMatrixWorld(true); const m=frame?_bbM.copy(frame).multiply(mesh.matrixWorld):mesh.matrixWorld;
for(let i=0;i<pos.count;i++){ _bbv.fromBufferAttribute(pos,i).applyMatrix4(m); mn.min(_bbv); mx.max(_bbv); }
return pos.count>0; }
function worldBBoxOfNode(h){ const set=new Set(); collectSubtree(h,set); const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity); let any=false;
for(const hh of set){ const m=pickMeshes.get(hh); if(m&&m.geometry)any=expandMeshBounds(m,null,mn,mx)||any; }
return any?{min:mn,max:mx}:null; }
function gizmoFrameBBox(h){ const n=OBJ.get(h); if(!n) return null;
const G=gizmoWorldMatrix(h); const Ginv=G.clone().invert();
const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity); let any=false;
const set=new Set(); collectSubtree(h,set);
for(const hh of set){ const m=pickMeshes.get(hh); if(m&&m.geometry)any=expandMeshBounds(m,Ginv,mn,mx)||any; }
return any?{min:mn,max:mx}:null; }
// Размер в Coordinate Manager измеряется в системе осей показанного pivot,
// а не в осях мирового AABB. Это важно для повернутого мультиселекта.
function selectionExtentInPivotAxes(hashes,lin){
const rot=new THREE.Matrix4(); rotMatOfLin(lin,rot);
const frame=rot.invert();
const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity),set=new Set();
for(const h of hashes)collectSubtree(h,set);
let any=false;
for(const h of set){ const mesh=pickMeshes.get(h); if(mesh&&mesh.geometry)any=expandMeshBounds(mesh,frame,mn,mx)||any; }
return any?new THREE.Vector3().subVectors(mx,mn):null;
}
function localGeomExtent(h){ const n=OBJ.get(h); if(!n) return new THREE.Vector3(1,1,1);
if(splineData.has(h)){const points=Object.values(splineData.get(h).vertices);if(!points.length)return new THREE.Vector3();const mn=new THREE.Vector3().fromArray(points[0]),mx=mn.clone();for(const p of points){const v=new THREE.Vector3().fromArray(p);mn.min(v);mx.max(v);}return mx.sub(mn);}
const wm=worldMatrix(n);
let winv=wm.clone();
{ const e=winv.elements; const det=e[0]*(e[5]*e[10]-e[6]*e[9])-e[4]*(e[1]*e[10]-e[2]*e[9])+e[8]*(e[1]*e[6]-e[2]*e[5]);
if(Math.abs(det)<1e-12){ const pn=n.parent?OBJ.get(n.parent):null; winv=pn?worldMatrix(pn).clone().invert():new THREE.Matrix4(); }
else winv=winv.invert(); }
const mn=new THREE.Vector3(Infinity,Infinity,Infinity), mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity); let any=false;
const set=new Set(); collectSubtree(h,set);
for(const hh of set){ const m=pickMeshes.get(hh); if(m&&m.geometry)any=expandMeshBounds(m,winv,mn,mx)||any; }
if(!any) return new THREE.Vector3(0,0,0); return new THREE.Vector3().subVectors(mx,mn); }
function applyNodeWorld(h,mw){ if(h===UV_VIRTUAL){ applyUvVirtualWorld(new THREE.Matrix4().fromArray(mw)); return; } const n=OBJ.get(h); if(!n) return;
const world=new THREE.Matrix4().fromArray(mw);
setNodeFromWorld(n,world);
const t=threeOf.get(h); if(t){ t.matrix.copy(localTmp(n)); t.updateMatrixWorld(true); } }
function setGizmoMatrix(arr){ const c=cubeRef.mesh; if(!c) return;
for(let i=0;i<16;i++){ if(!isFin(arr[i]))return; }
const m=new THREE.Matrix4().fromArray(arr);
gizmo.pos.set(m.elements[12],m.elements[13],m.elements[14]);
gizmo.lin.copy(m); gizmo.lin.elements[12]=0; gizmo.lin.elements[13]=0; gizmo.lin.elements[14]=0;
c.matrix.copy(m); c.matrixAutoUpdate=false; c.updateMatrixWorld(true);
rotQuatOfLin(gizmo.lin,gizmoHandleOrient);
scheduleRender(); emitTransform(); }
function getGizmoWorldArray(){ const c=cubeRef.mesh; if(!c) return new THREE.Matrix4().elements.slice(); c.updateMatrixWorld(true); return c.matrixWorld.elements.slice(); }
function setSelectionBrackets(min,max,vis){ if(!brackets.line) return; if(vis&&min&&max){ brackets.has=true; brackets.min.set(min[0],min[1],min[2]); brackets.max.set(max[0],max[1],max[2]); brackets.visible=true; brackets.opacity=1; brackets.fading=true; brackets.fadeStart=performance.now(); fadeTick(); } else if(brackets.visible&&brackets.has){ brackets.fading=true; brackets.fadeStart=performance.now(); fadeTick(); } }
function flashSelectionBrackets(){ if(!brackets.line||!brackets.has) return; brackets.visible=true; brackets.opacity=1; brackets.fading=true; brackets.fadeStart=performance.now(); fadeTick(); }
function createWeldedTorusGeometry(majorRadius,minorRadius,radialSegments=32,tubularSegments=64){
const vertices=radialSegments*tubularSegments,positions=new Float32Array(vertices*3),indices=new Uint32Array(vertices*6); let p=0,k=0;
for(let i=0;i<radialSegments;i++){ const u=i/radialSegments*Math.PI*2,cu=Math.cos(u),su=Math.sin(u);
for(let j=0;j<tubularSegments;j++){ const v=j/tubularSegments*Math.PI*2,r=majorRadius+minorRadius*Math.cos(v); positions[p++]=r*cu;positions[p++]=r*su;positions[p++]=minorRadius*Math.sin(v); } }
for(let i=0;i<radialSegments;i++)for(let j=0;j<tubularSegments;j++){ const ni=(i+1)%radialSegments,nj=(j+1)%tubularSegments,a=i*tubularSegments+j,b=ni*tubularSegments+j,c=ni*tubularSegments+nj,d=i*tubularSegments+nj; indices[k++]=a;indices[k++]=b;indices[k++]=d;indices[k++]=b;indices[k++]=c;indices[k++]=d; }
const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(positions,3)); g.setIndex(new THREE.BufferAttribute(indices,1)); g.computeVertexNormals(); return g; }
function createTestTorus(){ const h=makeNode('torus',TYPE_MESH,false); rootOrder.unshift(h);
const g=createWeldedTorusGeometry(400,150,96,216); g.rotateX(Math.PI/2); g.computeBoundingBox();
if(!defaultMatHash) createDefaultMat();
const mesh=new THREE.Mesh(g,getThreeMat(defaultMatHash));
mesh.position.set(2500,150,0); mesh.matrixAutoUpdate=false; mesh.renderOrder=LAYER_OBJ;
initCreaseRender(mesh); vpState.scene.add(mesh); contentThrees.push(mesh); registerPickMesh(h,mesh); threeOf.set(h,mesh);
OBJ.get(h).pos.copy(mesh.position);
mesh.matrix.copy(localTmp(OBJ.get(h))); mesh.updateMatrixWorld(true);
return h; }
function createWeldedBoxGeometry(sx,sy,sz){ const x=sx*.5,y=sy*.5,z=sz*.5;
const p=[-x,-y,-z,x,-y,-z,x,y,-z,-x,y,-z,-x,-y,z,x,-y,z,x,y,z,-x,y,z];
const i=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(i);g.computeVertexNormals();g.computeBoundingBox();return g; }
const PARAMETRIC_MESH_TYPES=new Set(['cube','cylinder','tube','sphere']);
const PARAMETRIC_SPLINE_TYPES=new Set(['square','circle','polyhedron','text']);
function approximationAngle(p){const a=Number.isFinite(+p?.approximation)?+p.approximation:(Number.isFinite(+p?.subdivs)?360/Math.max(3,+p.subdivs):5);return THREE.MathUtils.clamp(Math.round(a),1,180);}
function angularSegments(p,span=360,min=3){return Math.max(min,Math.ceil(Math.abs(span)/approximationAngle(p)-1e-9));}
function scaleSplineCage(data,sx,sy=sx,sz=sx){for(const point of Object.values(data.vertices)){point[0]*=sx;point[1]*=sy;point[2]*=sz;}for(const segment of Object.values(data.segments)){segment.ha[0]*=sx;segment.ha[1]*=sy;segment.ha[2]*=sz;segment.hb[0]*=sx;segment.hb[1]*=sy;segment.hb[2]*=sz;}return data;}
function createRoundPrimitiveCage(outerRadius,innerRadius,height,angle){const data=SPLINE.createSplineData({angle}),rings=[],rails=[],k=.5522847498307936,y=Math.max(0,+height||0)*.5,makeRing=(radius,top,reverse=false)=>{const points=[[radius,top?y:-y,0],[0,top?y:-y,radius],[-radius,top?y:-y,0],[0,top?y:-y,-radius]],t=[[0,0,radius*k],[-radius*k,0,0],[0,0,-radius*k],[radius*k,0,0]],q=SPLINE.addSplineSequence(data,true),vertices=points.map(point=>SPLINE.addSplineVertex(data,point)),edges=[];for(let i=0;i<4;i++){const j=(i+1)%4,sid=SPLINE.addSplineSegment(data,q,vertices[i],vertices[j],t[i],t[j].map(x=>-x));data.segments[sid].soft=true;edges.push(sid);}rings.push({radius,top,reverse,vertices,edges});return rings.at(-1);},outerBottom=makeRing(outerRadius,false),outerTop=makeRing(outerRadius,true),connect=(a,b)=>{const q=SPLINE.addSplineSequence(data,false),sid=SPLINE.addSplineSegment(data,q,a,b);rails.push(sid);return sid;},outerRails=outerBottom.vertices.map((v,i)=>connect(v,outerTop.vertices[i]));data.patchCells=[];data.planarFills=[{id:'outer:bottom',edges:outerBottom.edges.slice()},{id:'outer:top',edges:outerTop.edges.slice()}];for(let i=0;i<4;i++){const j=(i+1)%4;data.patchCells.push({vertices:[outerBottom.vertices[i],outerBottom.vertices[j],outerTop.vertices[j],outerTop.vertices[i]],edges:[outerBottom.edges[i],outerRails[j],outerTop.edges[i],outerRails[i]]});}if(innerRadius>1e-7){const innerBottom=makeRing(innerRadius,false,true),innerTop=makeRing(innerRadius,true,true),innerRails=innerBottom.vertices.map((v,i)=>connect(v,innerTop.vertices[i]));data.planarFills.push({id:'inner:bottom',edges:innerBottom.edges.slice()},{id:'inner:top',edges:innerTop.edges.slice()});for(let i=0;i<4;i++){const j=(i+1)%4;data.patchCells.push({vertices:[innerBottom.vertices[j],innerBottom.vertices[i],innerTop.vertices[i],innerTop.vertices[j]],edges:[innerBottom.edges[i],innerRails[i],innerTop.edges[i],innerRails[j]]});}}return data;}
function createParametricCageData(type,p){const angle=approximationAngle(p);let data;if(type==='cube'){data=SPLINE.createSplineQuadClosedData();scaleSplineCage(data,Math.max(0,+p.size||0)/1000);}else if(type==='sphere'){data=SPLINE.createSplineSphereCageData();scaleSplineCage(data,Math.max(0,+p.diameter||0)/1040);}else if(type==='cylinder')data=createRoundPrimitiveCage(Math.max(0,+p.diameter||0)*.5,0,p.height,angle);else if(type==='tube'){const outer=Math.max(0,+p.d1||0)*.5,inner=Math.min(outer,Math.max(0,+p.d2||0)*.5);data=createRoundPrimitiveCage(outer,inner,p.height,angle);}if(data)data.approximation={angle};return data;}
function addClosedSpline(data,points,handles=null){const q=SPLINE.addSplineSequence(data,true),vs=points.map(point=>SPLINE.addSplineVertex(data,point));for(let i=0;i<vs.length;i++){const hs=handles?.[i]||[[0,0,0],[0,0,0]],sid=SPLINE.addSplineSegment(data,q,vs[i],vs[(i+1)%vs.length],hs[0],hs[1]);if(handles)data.segments[sid].soft=true;}return q;}
function addStrokeRect(data,a,b,width){const ax=b[0]-a[0],ay=b[1]-a[1],l=Math.hypot(ax,ay)||1,nx=-ay/l*width*.5,ny=ax/l*width*.5;addClosedSpline(data,[[a[0]+nx,a[1]+ny,0],[b[0]+nx,b[1]+ny,0],[b[0]-nx,b[1]-ny,0],[a[0]-nx,a[1]-ny,0]]);}
let parametricTextFont=null,parametricTextFontLoading=false;
function requestParametricTextFont(){if(parametricTextFont||parametricTextFontLoading)return;parametricTextFontLoading=true;fetch('https://unpkg.com/three@0.162.0/examples/fonts/droid/droid_sans_regular.typeface.json').then(r=>{if(!r.ok)throw new Error('font '+r.status);return r.json();}).then(font=>{parametricTextFont=font;parametricTextFontLoading=false;for(const [h,p] of objParams)if(p?.__type==='text')syncParametricObject(h);scheduleRender();}).catch(error=>{parametricTextFontLoading=false;console.warn('Spline text font failed to load',error);});}
function addFontContour(data,start,commands){if(!start||!commands.length)return;const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7;if(!same(commands.at(-1).end,start))commands.push({kind:'l',end:start.slice()});const q=SPLINE.addSplineSequence(data,true),first=SPLINE.addSplineVertex(data,[start[0],start[1],0]);let a=first,current=start.slice();for(let i=0;i<commands.length;i++){const command=commands[i],closing=i===commands.length-1&&same(command.end,start),b=closing?first:SPLINE.addSplineVertex(data,[command.end[0],command.end[1],0]);if(a===b){current=command.end.slice();continue;}let ha=[0,0,0],hb=[0,0,0];if(command.kind==='q'){const c=command.c1,c1=[current[0]+(c[0]-current[0])*2/3,current[1]+(c[1]-current[1])*2/3],c2=[command.end[0]+(c[0]-command.end[0])*2/3,command.end[1]+(c[1]-command.end[1])*2/3];ha=[c1[0]-current[0],c1[1]-current[1],0];hb=[c2[0]-command.end[0],c2[1]-command.end[1],0];}else if(command.kind==='b'){ha=[command.c1[0]-current[0],command.c1[1]-current[1],0];hb=[command.c2[0]-command.end[0],command.c2[1]-command.end[1],0];}const sid=SPLINE.addSplineSegment(data,q,a,b,ha,hb);if(command.kind!=='l')data.segments[sid].soft=true;a=b;current=command.end.slice();}}
function createFontTextSpline(data,value){const font=parametricTextFont;if(!font){requestParametricTextFont();return data;}const size=100,scale=size/font.resolution,lines=String(value||'Text').split('\n'),fallback=font.glyphs['?'],lineHeight=(font.boundingBox.yMax-font.boundingBox.yMin+font.underlineThickness)*scale,width=line=>[...line].reduce((sum,ch)=>sum+(font.glyphs[ch]||fallback)?.ha*scale||sum,0),baseY=-(font.boundingBox.yMax+font.boundingBox.yMin)*scale*.5+(lines.length-1)*lineHeight*.5;for(let li=0;li<lines.length;li++){let x=-width(lines[li])*.5,y=baseY-li*lineHeight;for(const ch of lines[li]){const glyph=font.glyphs[ch]||fallback;if(!glyph){continue;}if(glyph.o){const tokens=glyph.o.split(' ');let start=null,current=null,commands=[];const finish=()=>{addFontContour(data,start,commands);start=null;current=null;commands=[];};for(let i=0;i<tokens.length;){const action=tokens[i++];if(action==='m'){if(start)finish();start=[+tokens[i++]*scale+x,+tokens[i++]*scale+y];current=start.slice();}else if(action==='l'){const end=[+tokens[i++]*scale+x,+tokens[i++]*scale+y];commands.push({kind:'l',end});current=end;}else if(action==='q'){const end=[+tokens[i++]*scale+x,+tokens[i++]*scale+y],c1=[+tokens[i++]*scale+x,+tokens[i++]*scale+y];commands.push({kind:'q',end,c1});current=end;}else if(action==='b'){const end=[+tokens[i++]*scale+x,+tokens[i++]*scale+y],c1=[+tokens[i++]*scale+x,+tokens[i++]*scale+y],c2=[+tokens[i++]*scale+x,+tokens[i++]*scale+y];commands.push({kind:'b',end,c1,c2});current=end;}}if(start)finish();}x+=glyph.ha*scale;}}return data;}
function createParametricSplineData(type,p){const angle=approximationAngle(p),data=SPLINE.createSplineData({angle});if(type==='square'){const x=Math.max(0,+p.w||0)*.5,y=Math.max(0,+p.h||0)*.5;addClosedSpline(data,[[-x,-y,0],[x,-y,0],[x,y,0],[-x,y,0]]);}else if(type==='circle'){const r=Math.max(0,+p.diameter||0)*.5,k=r*.5522847498307936,points=[[r,0,0],[0,r,0],[-r,0,0],[0,-r,0]],t=[[0,k,0],[-k,0,0],[0,-k,0],[k,0,0]],handles=t.map((v,i)=>[v,t[(i+1)%4].map(x=>-x)]);addClosedSpline(data,points,handles);}else if(type==='polyhedron'){const n=Math.max(3,Math.round(+p.faces||3)),r=Math.max(0,+p.diameter||0)*.5,points=[];for(let i=0;i<n;i++){const a=Math.PI*.5-i/n*TAU;points.push([Math.cos(a)*r,Math.sin(a)*r,0]);}addClosedSpline(data,points);}else if(type==='text')createFontTextSpline(data,p.text);return data;}
requestParametricTextFont();
function createTestCube(){ const h=makeNode('cube',TYPE_MESH,false); rootOrder.push(h);
if(!defaultMatHash) createDefaultMat();
const g=createWeldedBoxGeometry(200,200,200);
const mesh=new THREE.Mesh(g,getThreeMat(defaultMatHash));
mesh.position.set(600,100,600); mesh.matrixAutoUpdate=false; mesh.renderOrder=LAYER_OBJ;
initCreaseRender(mesh); vpState.scene.add(mesh); contentThrees.push(mesh); registerPickMesh(h,mesh); threeOf.set(h,mesh);
OBJ.get(h).pos.copy(mesh.position); mesh.matrix.copy(localTmp(OBJ.get(h))); mesh.updateMatrixWorld(true);
return h; }
function cloneTag(t){const c={...t};if(Array.isArray(t.polys))c.polys=t.polys.slice();if(Array.isArray(t.targets))c.targets=t.targets.slice();if(t.mapFrame?.clone)c.mapFrame=t.mapFrame.clone();if(t.mapPivot?.clone)c.mapPivot=t.mapPivot.clone();delete c._threeMats;return c;}
function disposeSplineVisual(h,removeData=false){const v=splineVisuals.get(h);if(v){v.group.traverse(o=>{if(o!==v.group){o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});if(v.group.parent)v.group.parent.remove(v.group);const at=contentThrees.indexOf(v.group);if(at>=0)contentThrees.splice(at,1);splineVisuals.delete(h);if(threeOf.get(h)===v.group)threeOf.delete(h);}evaluatedSplineCache.delete(h);if(removeData)splineData.delete(h);}
function installSplineObject(h,data=SPLINE.createSplineData()){const n=OBJ.get(h);if(!n)return null;disposeSplineVisual(h);splineData.set(h,data);invalidateEvaluatedSpline(h);const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.copy(localTmp(n));group.userData._splineObject=true;group.renderOrder=LAYER_OBJ;vpState.scene.add(group);contentThrees.push(group);threeOf.set(h,group);splineVisuals.set(h,{group});syncMeshParents();updateSplineVisual(h);return group;}
function disposeParametricMesh(h){const mesh=pickMeshes.get(h);if(!mesh)return;for(const map of [wireOverlays,polyPointOverlays,creaseOverlays]){const o=map.get(h);if(o){map.delete(h);o.parent?.remove(o);o.geometry?.dispose();o.material?.dispose();}}pickMeshes.delete(h);meshToHash.delete(mesh);if(threeOf.get(h)===mesh)threeOf.delete(h);const at=contentThrees.indexOf(mesh);if(at>=0)contentThrees.splice(at,1);mesh.parent?.remove(mesh);mesh.geometry?.dispose();}
function buildParametricCageObject(h,p){if(splineData.has(h))disposeSplineVisual(h,true);const direct=pickMeshes.get(h);if(direct&&threeOf.get(h)===direct)disposeParametricMesh(h);syncMeshParents();const state=ensureReplicaState(h),data=createParametricCageData(p.__type,p);try{if(!data)throw new Error('primitive spline cage is empty');const built=buildSplineSurfaceMeshData(data,{runtimeKey:`primitive:${h}`});state.report={...built.report,generator:p.__type,generatedCage:true};state.topology=built.topology;if(!built.report.ok||!built.indices.length)throw new Error(built.report.errors?.[0]||'primitive spline cage cannot form a surface');installReplicaResult(h,state,built.positions,built.indices,[getThreeMat(resolveMatHash(h))],[{start:0,count:built.indices.length,materialIndex:0}],built.normals);installGeneratorCage(h,state,SPLINE.approximateSpline(data).map(q=>({kind:'boundary',closed:q.closed,points:q.points.map(x=>x.position)})));if(state.virtualCage)state.virtualCage.data=data;}catch(error){state.report=state.report||{generator:p.__type,generatedCage:true};setReplicaError(h,state,error.message||String(error));}}
function syncParametricObject(h){const p=objParams.get(h),type=p?.__type;if(!p||!OBJ.has(h))return false;if(PARAMETRIC_MESH_TYPES.has(type)){p.approximation=approximationAngle(p);delete p.subdivs;buildParametricCageObject(h,p);return true;}if(PARAMETRIC_SPLINE_TYPES.has(type)){p.approximation=approximationAngle(p);delete p.subdivs;const state=replicaStates.get(h);if(state)disposeReplicaState(h,state);disposeParametricMesh(h);installSplineObject(h,createParametricSplineData(type,p));return true;}return false;}
function syncAllParametricObjects(){for(const h of OBJ.keys())syncParametricObject(h);}
function splineApproximation(h){const p=objParams.get(h)||{},d=splineData.get(h);if(!d)return null;p.angle=THREE.MathUtils.clamp(Math.round(+p.angle||+d.approximation?.angle||5),1,180);delete p.interp;delete p.points;d.approximation={angle:p.angle};return d.approximation;}
function splineBevelTags(h){return (OBJ.get(h)?.tags||[]).filter(t=>t.type===2);}
function evaluatedSplineData(h){const base=splineData.get(h);if(!base)return null;const tags=splineBevelTags(h),signature=JSON.stringify(base)+'|'+JSON.stringify(tags),cached=evaluatedSplineCache.get(h);if(cached?.signature===signature)return cached.data;let data=SPLINE.cloneSplineData(base);for(const tag of tags)data=SPLINE.applySplineBevelTag(data,tag);evaluatedSplineCache.set(h,{signature,data});return data;}
function invalidateEvaluatedSpline(h){evaluatedSplineCache.delete(h);}
function splineHandleKey(segment,side){return segment+':'+side;}
function parseSplineHandleKey(key){const at=key.lastIndexOf(':');return {segment:key.slice(0,at),side:key.slice(at+1)};}
function splineElementKey(h,id){return h+'|'+id;}
function parseSplineElementKey(key){const at=key.indexOf('|');return {object:key.slice(0,at),id:key.slice(at+1)};}
function splineIncidentHandles(data,vertex){const out=[];for(const s of Object.values(data.segments)){if(s.a===vertex)out.push({segment:s.id,side:'a',position:SPLINE.splineMath.add(data.vertices[s.a],s.ha)});if(s.b===vertex)out.push({segment:s.id,side:'b',position:SPLINE.splineMath.add(data.vertices[s.b],s.hb)});}return out;}
function splineHandleInfo(data,segment,side){if(segment.startsWith('free:')){const vertex=segment.slice(5),vector=data.freeHandles?.[vertex]?.[side];return data.vertices[vertex]&&vector?{free:true,vertex,segment,side,vector}:null;}const s=data.segments[segment];if(!s)return null;const vertex=side==='a'?s.a:s.b,key=side==='a'?'ha':'hb';return {free:false,vertex,segment,side,key,record:s,vector:s[key]};}
function splineSetHandleVector(data,info,vector){const value=SPLINE.splineMath.len(vector)<1e-6?[0,0,0]:vector.slice();if(info.free){data.freeHandles=data.freeHandles||{};data.freeHandles[info.vertex]=data.freeHandles[info.vertex]||{in:[0,0,0],out:[0,0,0]};data.freeHandles[info.vertex][info.side]=value;}else info.record[info.key]=value;info.vector=value;return value;}
function splineEditableHandles(data,vertex){const p=data.vertices[vertex],out=splineIncidentHandles(data,vertex);if(!p||out.length)return out;const free=data.freeHandles?.[vertex];if(free)for(const side of ['in','out']){const vector=free[side]||[0,0,0];if(SPLINE.splineMath.len(vector)>=1e-6)out.push({segment:'free:'+vertex,side,free:true,vertex,position:SPLINE.splineMath.add(p,vector)});}return out;}
function splineAllHandleInfos(data,vertex){const incident=splineIncidentHandles(data,vertex),out=[];for(const q of incident){const info=splineHandleInfo(data,q.segment,q.side);if(info)out.push(info);}if(incident.length)return out;for(const side of ['in','out']){const info=splineHandleInfo(data,'free:'+vertex,side);if(info)out.push(info);}return out;}
function splineHandleVertices(h,data){const out=new Set();for(const key of splineSelection.vertices){const r=parseSplineElementKey(key);if(r.object===h&&data.vertices[r.id])out.add(r.id);}for(const key of splineSelection.handles){const r=parseSplineElementKey(key);if(r.object!==h)continue;const q=parseSplineHandleKey(r.id),info=splineHandleInfo(data,q.segment,q.side);if(info)out.add(info.vertex);}return [...out];}
function splineHitSelected(hit){if(!hit)return false;if(hit.kind==='vertex')return splineSelection.vertices.has(splineElementKey(hit.object,hit.id));if(hit.kind==='segment')return splineSelection.segments.has(splineElementKey(hit.object,hit.id));return splineSelection.handles.has(splineElementKey(hit.object,splineHandleKey(hit.id,hit.side)));}
function lineObject(points,colors,closed,materialOpts={}){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors.flat(),3));const m=new THREE.LineBasicMaterial({color:colors?0xffffff:(materialOpts.color||0xffffff),vertexColors:!!colors,depthTest:materialOpts.depthTest!==false,depthWrite:false,transparent:materialOpts.opacity!=null,opacity:materialOpts.opacity??1});const o=materialOpts.segments?new THREE.LineSegments(g,m):closed?new THREE.LineLoop(g,m):new THREE.Line(g,m);o.frustumCulled=false;o.renderOrder=materialOpts.order||LAYER_OBJ;return o;}
function pointsObject(points,color,size,depthTest=false,order=LAYER_BRACKET+5){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));const o=new THREE.Points(g,new THREE.PointsMaterial({color,size,sizeAttenuation:false,depthTest,depthWrite:false}));o.frustumCulled=false;o.renderOrder=order;return o;}
function clearSplineGroup(group){for(const o of group.children.slice()){group.remove(o);o.geometry?.dispose();if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}}
function splineSurfaceSubdivisions(data){let n=1;for(const sid of Object.keys(data.segments))n=Math.max(n,SPLINE.sampleSplineSegment(data,sid).length-1);return Math.max(1,n);}
function splineEdgePoint(data,edge,t){const p=SPLINE.segmentPoints(data,edge.id);return SPLINE.cubicPoint(p,edge.reversed?1-t:t);}
function splineContourPoints(data,cycle,n){const out=[];for(const edge of cycle.edges)for(let i=0;i<n;i++)out.push(splineEdgePoint(data,edge,i/n));return out;}
function splinePointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.y>p.y)!==(b.y>p.y))&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
function splineSegmentsCross2D(a,b,c,d){const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x),ab1=cross(a,b,c),ab2=cross(a,b,d),cd1=cross(c,d,a),cd2=cross(c,d,b),eps=1e-7;return ((ab1>eps&&ab2<-eps)||(ab1<-eps&&ab2>eps))&&((cd1>eps&&cd2<-eps)||(cd1<-eps&&cd2>eps));}
function splinePolygonsCross(a,b){for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++)if(splineSegmentsCross2D(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length]))return true;return false;}
function splineSegmentTriangle(a,b,p0,p1,p2){const dir=b.clone().sub(a),e1=p1.clone().sub(p0),e2=p2.clone().sub(p0),h=dir.clone().cross(e2),det=e1.dot(h),eps=1e-7;if(Math.abs(det)<eps)return false;const inv=1/det,s=a.clone().sub(p0),u=inv*s.dot(h);if(u<-eps||u>1+eps)return false;const q=s.clone().cross(e1),v=inv*dir.dot(q);if(v<-eps||u+v>1+eps)return false;const t=inv*e2.dot(q);return t>eps&&t<1-eps;}
function splineTrianglesIntersect(a0,a1,a2,b0,b1,b2){return splineSegmentTriangle(a0,a1,b0,b1,b2)||splineSegmentTriangle(a1,a2,b0,b1,b2)||splineSegmentTriangle(a2,a0,b0,b1,b2)||splineSegmentTriangle(b0,b1,a0,a1,a2)||splineSegmentTriangle(b1,b2,a0,a1,a2)||splineSegmentTriangle(b2,b0,a0,a1,a2);}
const surfaceBuildVersions=new Map();
function preservePlanarTriangulationVertices(faces,points,rings){
  const membership=[];let offset=0;for(let loop=0;loop<rings.length;loop++){for(let i=0;i<rings[loop].flat.length;i++)membership[offset+i]={loop,index:i};offset+=rings[loop].flat.length;}const scale=Math.max(1,...points.flatMap(p=>[Math.abs(p.x),Math.abs(p.y)])),tolerance=scale*1e-9,tolerance2=tolerance*tolerance,queue=faces.map(f=>f.slice()),out=[],limit=Math.max(1000,faces.length*Math.max(4,points.length)*4);let guard=0;
  while(queue.length&&guard++<limit){const face=queue.pop(),P0=points[face[0]],P1=points[face[1]],P2=points[face[2]];if(Math.abs((P1.x-P0.x)*(P2.y-P0.y)-(P1.y-P0.y)*(P2.x-P0.x))<=scale*scale*1e-14)continue;let split=false;for(let edge=0;edge<3&&!split;edge++){const a=face[edge],b=face[(edge+1)%3],c=face[(edge+2)%3],ma=membership[a],mb=membership[b],A=points[a],B=points[b],dx=B.x-A.x,dy=B.y-A.y,den=dx*dx+dy*dy;if(!ma||!mb||ma.loop!==mb.loop||den<=tolerance2)continue;let best=-1,bestT=Infinity;for(let q=0;q<points.length;q++){if(q===a||q===b||q===c||membership[q]?.loop!==ma.loop)continue;const P=points[q],t=((P.x-A.x)*dx+(P.y-A.y)*dy)/den;if(t<=1e-8||t>=1-1e-8||t>=bestT)continue;const x=A.x+t*dx,y=A.y+t*dy;if((P.x-x)**2+(P.y-y)**2<=tolerance2){best=q;bestT=t;}}if(best>=0){queue.push([a,best,c],[best,b,c]);split=true;}}if(!split)out.push(face);}
  return queue.length?faces:out;
}
function appendPlanarSplineFills(data,built){
  const loops=[],loopKeys=new Set(),addLoop=loop=>{const key=loop.edges.map(e=>e.id).sort().join('|');if(key&&!loopKeys.has(key)){loopKeys.add(key);loops.push(loop);}};for(const loop of built.topology.planarContours)addLoop(loop);
  for(const spec of data.planarFills||[]){const refs=(spec.edges||[]).slice(),edges=[];if(!refs.length)continue;let ref=refs.shift(),id=typeof ref==='string'?ref:ref.id,s=data.segments[id];if(!s)continue;let reversed=typeof ref==='string'?false:!!ref.reversed,from=reversed?s.b:s.a,to=reversed?s.a:s.b;edges.push({id,from,to,reversed});let current=to;while(refs.length){const at=refs.findIndex(q=>{const x=data.segments[typeof q==='string'?q:q.id];return x&&(x.a===current||x.b===current);});if(at<0)break;ref=refs.splice(at,1)[0];id=typeof ref==='string'?ref:ref.id;s=data.segments[id];reversed=s.b===current;from=current;to=reversed?s.a:s.b;edges.push({id,from,to,reversed});current=to;}if(edges.length)addLoop({id:spec.id||`fill:${loops.length}`,edges,plane:null});}
  if(!loops.length){built.report.planarFillRegions=0;built.report.planarFillTriangles=0;return;}
  const V=x=>x?.isVector3?x.clone():new THREE.Vector3().fromArray(x),records=[];for(const loop of loops){const controls=loop.edges.flatMap(e=>SPLINE.segmentPoints(data,e.id)||[]),plane=loop.plane||deterministicSplineWorldPlane(controls.map(V));if(!plane?.planar)continue;const normal=V(plane.normal),axis=V(plane.u||plane.axis),v=plane.v?V(plane.v):new THREE.Vector3().crossVectors(normal,axis).normalize(),origin=V(plane.origin),points=[];for(const edge of loop.edges){const raw=SPLINE.sampleSplineSegment(data,edge.id),oriented=edge.reversed?raw.slice().reverse():raw;for(let i=0;i<oriented.length-1;i++)points.push(oriented[i].position.slice());}if(points.length>=3)records.push({loop,points,origin,u:axis,v,normal,flat:points.map(p=>{const x=V(p).sub(origin);return new THREE.Vector2(x.dot(axis),x.dot(v));}),parent:null,depth:0});}
  const coplanar=(a,b)=>Math.abs(Math.abs(a.normal.dot(b.normal))-1)<1e-6&&Math.abs(b.origin.clone().sub(a.origin).dot(a.normal))<1e-5,groups=[];for(const r of records){let group=groups.find(g=>coplanar(g[0],r));if(!group){group=[];groups.push(group);}group.push(r);}for(const group of groups){const basis=group[0];for(const r of group){r.projectOrigin=basis.origin;r.projectU=basis.u;r.projectV=basis.v;r.flat=r.points.map(p=>{const x=V(p).sub(basis.origin);return new THREE.Vector2(x.dot(basis.u),x.dot(basis.v));});}}
  const contains=(outer,inner)=>splinePointInPolygon(inner.flat[0],outer.flat);for(const r of records){let parent=null,area=Infinity,selfArea=Math.abs(THREE.ShapeUtils.area(r.flat));for(const q of records){if(q===r||!coplanar(q,r)||!contains(q,r))continue;const a=Math.abs(THREE.ShapeUtils.area(q.flat));if(a<=selfArea+1e-9)continue;if(a<area){area=a;parent=q;}}r.parent=parent;}const depth=r=>r.parent?1+depth(r.parent):0;for(const r of records)r.depth=depth(r);
  const vertexMap=new Map(),scale=Math.max(1,...built.positions.map(Math.abs)),joinTolerance=scale*1e-5;for(let i=0;i<built.positions.length;i+=3)vertexMap.set(built.positions.slice(i,i+3).map(x=>Math.round(x*1e7)).join(','),i/3);const vertex=p=>{const key=p.map(x=>Math.round(x*1e7)).join(',');let i=vertexMap.get(key);if(i==null){let best=-1,bd=joinTolerance*joinTolerance;for(let q=0;q<built.positions.length/3;q++){const d=(built.positions[q*3]-p[0])**2+(built.positions[q*3+1]-p[1])**2+(built.positions[q*3+2]-p[2])**2;if(d<=bd){best=q;bd=d;}}if(best>=0)i=best;else{i=built.positions.length/3;built.positions.push(...p);}vertexMap.set(key,i);}return i;},oriented=(r,clockwise)=>{const flat=r.flat.slice();if(THREE.ShapeUtils.isClockWise(flat)!==clockwise)flat.reverse();return {flat};},convex=flat=>{let sign=0;for(let i=0;i<flat.length;i++){const a=flat[i],b=flat[(i+1)%flat.length],c=flat[(i+2)%flat.length],z=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(z)<1e-10)continue;const s=Math.sign(z);if(sign&&s!==sign)return false;sign=s;}return !!sign;};let fills=0,fillTriangles=0;
  for(const outer of records.filter(r=>r.depth%2===0)){const shell=oriented(outer,true),holes=records.filter(r=>r.parent===outer&&r.depth%2===1).map(h=>oriented(h,false)),rings=[shell,...holes],flat=rings.flatMap(r=>r.flat),map=flat.map(q=>vertex(outer.projectOrigin.clone().addScaledVector(outer.projectU,q.x).addScaledVector(outer.projectV,q.y).toArray())),faces=preservePlanarTriangulationVertices(THREE.ShapeUtils.triangulateShape(shell.flat,holes.map(h=>h.flat)),flat,rings);for(const f of faces){built.indices.push(map[f[0]],map[f[1]],map[f[2]]);built.triangleSources.push(`planar:${outer.loop.id}`);}fillTriangles+=faces.length;fills++;}
  built.report.planarFillRegions=fills;built.report.planarFillTriangles=fillTriangles;
}
function weldCompiledMeshPositions(built){const scale=Math.max(1,...built.positions.map(Math.abs)),step=Math.max(1e-10,scale*1e-9),keyAt=i=>[0,1,2].map(k=>Math.round(built.positions[i*3+k]/step)).join(','),keys=new Map(),map=[],positions=[];for(let i=0;i<built.positions.length/3;i++){const key=keyAt(i);let q=keys.get(key);if(q==null){q=positions.length/3;keys.set(key,q);positions.push(built.positions[i*3],built.positions[i*3+1],built.positions[i*3+2]);}map[i]=q;}const indices=[],sources=[];for(let i=0;i<built.indices.length;i+=3){const a=map[built.indices[i]],b=map[built.indices[i+1]],c=map[built.indices[i+2]];if(a===b||b===c||c===a)continue;indices.push(a,b,c);sources.push(built.triangleSources[i/3]);}built.positions=positions;built.indices=indices;built.triangleSources=sources;}
function buildSplineSurfaceMeshData(data,options={}){
  options={...options,preview:options.preview??!!gizDrag};
  const topologyKey=JSON.stringify({vertices:Object.keys(data.vertices).sort(),segments:Object.values(data.segments).map(s=>[s.id,s.a,s.b]).sort(),sequences:data.sequences.map(q=>[q.id,!!q.closed,q.segments.slice()])});
  const geometryKey=JSON.stringify({vertices:data.vertices,segments:data.segments,sequences:data.sequences}),angle=THREE.MathUtils.clamp(Math.round(+data.approximation?.angle||5),1,180),runtimeKey=options.runtimeKey||topologyKey;
  let state=surfaceBuildVersions.get(runtimeKey);
  if(!state){state={topologyKey,geometryKey,angle,geometryVersion:1,chartVersion:1,tessellationVersion:1};surfaceBuildVersions.set(runtimeKey,state);if(surfaceBuildVersions.size>128)surfaceBuildVersions.delete(surfaceBuildVersions.keys().next().value);}
  else {if(state.topologyKey!==topologyKey){state.topologyKey=topologyKey;state.chartVersion++;}if(state.geometryKey!==geometryKey){state.geometryKey=geometryKey;state.geometryVersion++;}if(state.angle!==angle){state.angle=angle;state.tessellationVersion++;}}
  const surfaceStarted=performance.now(),built=buildCompiledSplineSurfaceMesh(data,{...options,geometryVersion:state.geometryVersion,tessellationVersion:state.tessellationVersion,renderCache:state.renderCache,freezeRenderTopology:!!options.preview&&state.topologyKey===topologyKey&&state.angle===angle});if(built.renderCache)state.renderCache=built.renderCache;built.report.surfaceBuilderMilliseconds=performance.now()-surfaceStarted;built.report.surfaceOnly={boundaryEdges:built.report.boundaryEdges,nonManifoldEdges:built.report.nonManifoldEdges,vertices:built.report.vertices,triangles:built.report.triangles};const planarStarted=performance.now();
  appendPlanarSplineFills(data,built);if(data.planarFills?.length){weldCompiledMeshPositions(built);const edgeUse=new Map(),edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;for(let i=0;i<built.indices.length;i+=3)for(let k=0;k<3;k++){const a=built.indices[i+k],b=built.indices[i+(k+1)%3],key=edgeKey(a,b);let owners=edgeUse.get(key);if(!owners)edgeUse.set(key,owners=[]);owners.push({triangle:i/3,source:built.triangleSources[i/3]});}built.report.boundaryEdges=[...edgeUse.values()].filter(n=>n.length===1).length;built.report.nonManifoldEdges=[...edgeUse.values()].filter(n=>n.length>2).length;built.report.finalTopologyDiagnostics=[...edgeUse].filter(([,owners])=>owners.length!==2).sort((a,b)=>b[1].length-a[1].length).slice(0,24).map(([edge,owners])=>({edge,use:owners.length,sources:[...new Set(owners.map(x=>x.source))],points:edge.split(':').map(Number).map(i=>built.positions.slice(i*3,i*3+3))}));built.report.closed=built.indices.length>0&&!built.report.boundaryEdges&&!built.report.nonManifoldEdges;built.report.vertices=built.positions.length/3;built.report.triangles=built.indices.length/3;built.report.ok=built.report.ok&&!built.report.nonManifoldEdges;}built.report.planarFillMilliseconds=performance.now()-planarStarted;
  Object.assign(built.report,{geometryVersion:state.geometryVersion,chartVersion:state.chartVersion,tessellationVersion:state.tessellationVersion});
  return built;
}
function generatorSequencePoints(data,sequence){
const out=[];for(let si=0;si<sequence.segments.length;si++){const sid=sequence.segments[si],s=data.segments[sid],samples=SPLINE.sampleSplineSegment(data,sid);if(!s)continue;for(let i=si?1:0;i<samples.length;i++)out.push(samples[i].position.slice());}
if(sequence.closed&&out.length>1&&SPLINE.splineMath.dist(out[0],out.at(-1))<1e-8)out.pop();return out;}
function generatorCyclePoints(data,cycle){const out=[];for(const edge of cycle.edges){const samples=SPLINE.sampleSplineSegment(data,edge.id),oriented=edge.reversed?samples.slice().reverse():samples;for(let i=0;i<oriented.length-1;i++)out.push(oriented[i].position.slice());}return out;}
function generatorCleanRing(points){const out=points.slice();let changed=true;while(changed&&out.length>3){changed=false;for(let i=0;i<out.length;i++){const a=new THREE.Vector3().fromArray(out[(i-1+out.length)%out.length]),b=new THREE.Vector3().fromArray(out[i]),c=new THREE.Vector3().fromArray(out[(i+1)%out.length]),ab=b.clone().sub(a),bc=c.clone().sub(b),scale=Math.max(ab.length(),bc.length(),1);if(ab.cross(bc).length()<=scale*scale*1e-9&&new THREE.Vector3().fromArray(out[i]).sub(a).dot(c.clone().sub(b))>=-1e-9){out.splice(i,1);changed=true;break;}}}return out;}
function generatorPlaneForData(data,ids){const points=[];for(const sid of ids){const p=SPLINE.segmentPoints(data,sid);if(p)for(const q of p)points.push(new THREE.Vector3().fromArray(q));}const plane=deterministicSplineWorldPlane(points);if(plane){plane.u=plane.axis.clone();plane.v=new THREE.Vector3().crossVectors(plane.normal,plane.u).normalize();}return plane;}
function generatorBuilder(){
const positions=[],indices=[],vertexMap=new Map(),vertex=p=>{const key=p.map(x=>Math.round(x*1e6)).join(','),old=vertexMap.get(key);if(old!==undefined)return old;const i=positions.length/3;positions.push(p[0],p[1],p[2]);vertexMap.set(key,i);return i;},triangle=(a,b,c)=>{a=typeof a==='number'?a:vertex(a);b=typeof b==='number'?b:vertex(b);c=typeof c==='number'?c:vertex(c);if(a===b||b===c||c===a)return;const A=new THREE.Vector3().fromArray(positions,a*3),B=new THREE.Vector3().fromArray(positions,b*3),C=new THREE.Vector3().fromArray(positions,c*3);if(B.sub(A).cross(C.sub(A)).lengthSq()<1e-18)return;indices.push(a,b,c);},strip=(a,b,wrap=true)=>{const n=Math.min(a.length,b.length),count=wrap?n:n-1;for(let i=0;i<count;i++){const j=(i+1)%n,A=vertex(a[i]),B=vertex(a[j]),C=vertex(b[i]),D=vertex(b[j]);triangle(A,B,D);triangle(A,D,C);}},finish=(extra={})=>{
const edgeKey=(a,b)=>a<b?a+':'+b:b+':'+a,owners=new Map(),faces=indices.length/3;for(let f=0;f<faces;f++)for(let k=0;k<3;k++){const a=indices[f*3+k],b=indices[f*3+(k+1)%3],key=edgeKey(a,b),list=owners.get(key)||[];list.push({f,a,b});owners.set(key,list);}const adjacency=Array.from({length:faces},()=>[]);for(const list of owners.values())if(list.length===2){const a=list[0],b=list[1],same=a.a===b.a&&a.b===b.b;adjacency[a.f].push({f:b.f,same});adjacency[b.f].push({f:a.f,same});}const flipped=Array(faces).fill(null);for(let seed=0;seed<faces;seed++){if(flipped[seed]!==null)continue;const queue=[seed];flipped[seed]=false;while(queue.length){const f=queue.shift();for(const q of adjacency[f])if(flipped[q.f]===null){flipped[q.f]=flipped[f]!==q.same;queue.push(q.f);}}}for(let f=0;f<faces;f++)if(flipped[f]){const at=f*3,t=indices[at+1];indices[at+1]=indices[at+2];indices[at+2]=t;}
let volume=0;for(let i=0;i<indices.length;i+=3){const a=positions.slice(indices[i]*3,indices[i]*3+3),b=positions.slice(indices[i+1]*3,indices[i+1]*3+3),c=positions.slice(indices[i+2]*3,indices[i+2]*3+3);volume+=SPLINE.splineMath.dot(a,SPLINE.splineMath.cross(b,c));}const boundaryEdges=[...owners.values()].filter(x=>x.length===1).length,nonManifoldEdges=[...owners.values()].filter(x=>x.length>2).length,closed=indices.length>0&&boundaryEdges===0&&!nonManifoldEdges;if(closed&&volume<0)for(let i=0;i<indices.length;i+=3){const t=indices[i+1];indices[i+1]=indices[i+2];indices[i+2]=t;}const errors=[];if(nonManifoldEdges)errors.push('generated surface is non-manifold');return {positions,indices,report:{ok:!errors.length,errors,boundaryEdges,nonManifoldEdges,closed,vertices:positions.length/3,triangles:indices.length/3,...extra}};};return {positions,indices,vertex,triangle,strip,finish};}
function generatorPlanarRecords(rings,plane){const records=rings.map((points,index)=>({points,index,flat:points.map(p=>new THREE.Vector2(new THREE.Vector3().fromArray(p).sub(plane.origin).dot(plane.u),new THREE.Vector3().fromArray(p).sub(plane.origin).dot(plane.v))),parent:null,depth:0}));for(const record of records){let parent=null,area=Infinity;for(const candidate of records){if(candidate===record||!splinePointInPolygon(record.flat[0],candidate.flat))continue;const a=Math.abs(THREE.ShapeUtils.area(candidate.flat));if(a<area){area=a;parent=candidate;}}record.parent=parent;}const depth=r=>r.parent?1+depth(r.parent):0;for(const r of records)r.depth=depth(r);return records;}
function generatorInsetRing(points,plane,distance,materialSide=1){const flat=points.map(p=>new THREE.Vector2(new THREE.Vector3().fromArray(p).sub(plane.origin).dot(plane.u),new THREE.Vector3().fromArray(p).sub(plane.origin).dot(plane.v))),ccw=THREE.ShapeUtils.area(flat)>0,out=[];for(let i=0;i<flat.length;i++){const prev=flat[(i-1+flat.length)%flat.length],at=flat[i],next=flat[(i+1)%flat.length],e0=at.clone().sub(prev).normalize(),e1=next.clone().sub(at).normalize(),side=ccw?1:-1,n0=new THREE.Vector2(-e0.y,e0.x).multiplyScalar(side*materialSide),n1=new THREE.Vector2(-e1.y,e1.x).multiplyScalar(side*materialSide),sum=n0.clone().add(n1),den=Math.max(1e-5,1+n0.dot(n1)),shift=sum.multiplyScalar(distance/den),q=at.clone().add(shift);out.push(plane.origin.clone().addScaledVector(plane.u,q.x).addScaledVector(plane.v,q.y).toArray());}return out;}
function generatorCap(builder,records,side=1){for(const outer of records.filter(r=>r.depth%2===0)){const holes=records.filter(r=>r.parent===outer&&r.depth%2===1),polys=[outer,...holes],faces=THREE.ShapeUtils.triangulateShape(outer.flat,holes.map(h=>h.flat)),map=polys.flatMap(r=>r.points.map(builder.vertex)),offsets=[];let at=0;for(const r of polys){offsets.push(at);at+=r.points.length;}const locate=i=>{let p=0;while(p+1<offsets.length&&i>=offsets[p+1])p++;return map[offsets[p]+i-offsets[p]];};for(const f of faces)side>0?builder.triangle(locate(f[0]),locate(f[1]),locate(f[2])):builder.triangle(locate(f[0]),locate(f[2]),locate(f[1]));}}
function installGeneratorCage(h,state,polylines){disposeGeneratorCage(state);const parent=threeOf.get(h);if(!parent||!polylines.length)return;const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.identity();group.renderOrder=LAYER_OBJ+2;group.userData._virtualSplineCage=true;for(const line of polylines){if(line.points.length<2)continue;const points=line.closed?line.points.concat([line.points[0]]):line.points,color=line.kind==='rail'?0xffb34d:(line.kind==='seam'?0x31b8ff:0x42bce8);group.add(lineObject(points,null,false,{color,opacity:.9,order:LAYER_OBJ+2}));}parent.add(group);state.cage=group;state.virtualCage={polylines:polylines.map((q,i)=>({id:`cage:${i}`,kind:q.kind||'boundary',closed:!!q.closed,points:q.points.map(p=>p.slice())})),segments:polylines.length};group.visible=false;}
function buildExtrudeFilletSplineCage(source,p){
const topology=SPLINE.resolveSplineTopology(source),contours=topology.planarContours.filter(c=>c.edges.length&&c.plane?.planar);if(!contours.length)throw new Error('Extrude profile must contain a closed planar contour');const data=SPLINE.createSplineData({angle:source.approximation?.angle||5}),height=Math.abs(+p.offset||0);if(height<=1e-9)throw new Error('Extrude offset must be non-zero');data.patchCells=[];data.planarFills=[];
for(const cycle of contours){const normal=new THREE.Vector3().fromArray(cycle.plane.normal).normalize().multiplyScalar((+p.offset||0)<0?-1:1),startSize=p.startFillet?Math.min(Math.max(0,+p.startSize||0),height*.5):0,endSize=p.endFillet?Math.min(Math.max(0,+p.endSize||0),height*.5):0,sourceIds=cycle.edges.map(e=>e.id),sourceIdKey=sourceIds.slice().sort().join('|'),sourceCurves=cycle.edges.map(edge=>{const points=SPLINE.segmentPoints(source,edge.id);return edge.reversed?points.slice().reverse():points.slice();}),offsetCurves=distance=>{if(distance<=1e-9)return sourceCurves;const outlined=SPLINE.applySplineOutline(source,sourceIds,{distance,normal:cycle.plane.normal}),component=outlined.generated.components.find(q=>q.closed&&q.sourceSegments.slice().sort().join('|')===sourceIdKey);if(!component)throw new Error('Extrude fillet outline could not be generated');const candidates=component.segments.map(id=>SPLINE.segmentPoints(outlined.data,id)),unused=new Set(candidates.map((_,i)=>i));return sourceCurves.map(sourceCurve=>{const midpoint=SPLINE.cubicPoint(sourceCurve,.5);let best=-1,bestDistance=Infinity;for(const i of unused){const d=SPLINE.splineMath.dist(midpoint,SPLINE.cubicPoint(candidates[i],.5));if(d<bestDistance){bestDistance=d;best=i;}}unused.delete(best);const curve=candidates[best].slice();return SPLINE.splineMath.dist(curve[0],sourceCurve[0])<=SPLINE.splineMath.dist(curve[3],sourceCurve[0])?curve:curve.reverse();});},levels=[];
const push=(inset,z,role)=>{const previous=levels.at(-1);if(previous&&Math.abs(previous.inset-inset)<1e-9&&Math.abs(previous.z-z)<1e-9)return;levels.push({inset,z,role,curves:offsetCurves(inset)});};push(startSize,0,'bottom');push(0,startSize,'start-wall');push(0,height-endSize,'end-wall');push(endSize,height,'top');
for(const level of levels){level.vertices=level.curves.map(curve=>SPLINE.addSplineVertex(data,new THREE.Vector3().fromArray(curve[0]).addScaledVector(normal,level.z).toArray()));level.edges=level.curves.map((curve,i)=>{const p0=new THREE.Vector3().fromArray(curve[0]).addScaledVector(normal,level.z),p1=new THREE.Vector3().fromArray(curve[1]).addScaledVector(normal,level.z),p2=new THREE.Vector3().fromArray(curve[2]).addScaledVector(normal,level.z),p3=new THREE.Vector3().fromArray(curve[3]).addScaledVector(normal,level.z);return splineCageEdge(data,level.vertices[i],level.vertices[(i+1)%level.vertices.length],p1.sub(p0).toArray(),p2.sub(p3).toArray(),false);});}
for(let levelIndex=0;levelIndex+1<levels.length;levelIndex++){const a=levels[levelIndex],b=levels[levelIndex+1],rails=[];for(let i=0;i<a.vertices.length;i++){const pa=data.vertices[a.vertices[i]],pb=data.vertices[b.vertices[i]],chord=SPLINE.splineMath.sub(pb,pa);let ha=SPLINE.splineMath.mul(chord,1/3),hb=SPLINE.splineMath.mul(chord,-1);const roundStart=p.startType==='round'&&a.inset>1e-9&&b.inset<1e-9,roundEnd=p.endType==='round'&&a.inset<1e-9&&b.inset>1e-9;if(roundStart||roundEnd){const size=roundStart?a.inset:b.inset,k=size*4/3*Math.tan(Math.PI/8),inward=new THREE.Vector3().fromArray(roundStart?pa:pb).addScaledVector(normal,roundStart?-a.z:-b.z).sub(new THREE.Vector3().fromArray(roundStart?pb:pa).addScaledVector(normal,roundStart?-b.z:-a.z)).normalize();if(roundStart){ha=normal.clone().multiplyScalar(k).toArray();hb=inward.multiplyScalar(k).toArray();}else{ha=inward.multiplyScalar(k).toArray();hb=normal.clone().multiplyScalar(-k).toArray();}}rails.push(splineCageEdge(data,a.vertices[i],b.vertices[i],ha,hb,false));}
for(let i=0;i<a.vertices.length;i++){const j=(i+1)%a.vertices.length;data.patchCells.push({vertices:[a.vertices[i],a.vertices[j],b.vertices[j],b.vertices[i]],edges:[a.edges[i],rails[j],b.edges[i],rails[i]]});}}
data.planarFills.push({id:`${cycle.id}:bottom`,edges:levels[0].edges.slice()},{id:`${cycle.id}:top`,edges:levels.at(-1).edges.slice()});}
const validation=SPLINE.validateSpline(data);if(!validation.ok)throw new Error(validation.errors.join('; '));return {data,sourceTopology:topology};
}
function buildExtrudeGenerator(data,p){
const topology=SPLINE.resolveSplineTopology(data),contours=topology.planarContours.filter(c=>c.edges.length),builder=generatorBuilder(),cage=[],groups=[];for(const cycle of contours){const plane=cycle.plane,points=generatorCleanRing(generatorCyclePoints(data,cycle));if(points.length<3||!plane?.planar)continue;let group=groups.find(g=>Math.abs(Math.abs(g.normal.dot(new THREE.Vector3().fromArray(plane.normal)))-1)<1e-5&&Math.abs(new THREE.Vector3().fromArray(plane.origin).sub(g.origin).dot(g.normal))<plane.tolerance*4);if(!group){const normal=new THREE.Vector3().fromArray(plane.normal).normalize();group={normal,origin:new THREE.Vector3().fromArray(plane.origin),u:new THREE.Vector3().fromArray(plane.u),v:new THREE.Vector3().fromArray(plane.v),rings:[]};groups.push(group);}group.rings.push(points);}
for(const group of groups){const rawOffset=+p.offset||0,height=Math.abs(rawOffset),direction=group.normal.clone().multiplyScalar(rawOffset<0?-1:1),plane={origin:group.origin,u:group.u,v:group.v},records=generatorPlanarRecords(group.rings,plane),startSize=p.startFillet?Math.min(Math.max(0,+p.startSize||0),height*.5):0,endSize=p.endFillet?Math.min(Math.max(0,+p.endSize||0),height*.5):0,startAngle=Math.max(.1,+p.startAngle||10),endAngle=Math.max(.1,+p.endAngle||10),bottom=[],top=[];
for(const record of records){const source=record.points,materialSide=record.depth%2===0?1:-1,at=(ring,z)=>ring.map(x=>new THREE.Vector3().fromArray(x).addScaledVector(direction,z).toArray()),levels=[];
if(startSize>1e-9){const count=p.startType==='round'?Math.max(1,Math.ceil(90/startAngle)):1;for(let j=0;j<=count;j++){const theta=j/count*Math.PI/2,inset=p.startType==='round'?startSize*(1-Math.sin(theta)):startSize*(1-j/count),z=p.startType==='round'?startSize*(1-Math.cos(theta)):startSize*j/count,ring=inset>1e-9?generatorInsetRing(source,plane,inset,materialSide):source;levels.push(at(ring,z));}}else levels.push(at(source,0));
const endWall=height-endSize;if(endWall>startSize+1e-9)levels.push(at(source,endWall));
if(endSize>1e-9){const count=p.endType==='round'?Math.max(1,Math.ceil(90/endAngle)):1;for(let j=1;j<=count;j++){const theta=j/count*Math.PI/2,inset=p.endType==='round'?endSize*(1-Math.cos(theta)):endSize*j/count,z=height-endSize+(p.endType==='round'?endSize*Math.sin(theta):endSize*j/count),ring=inset>1e-9?generatorInsetRing(source,plane,inset,materialSide):source;levels.push(at(ring,z));}}else if(height>0&&SPLINE.splineMath.dist(levels.at(-1)[0],at(source,height)[0])>1e-8)levels.push(at(source,height));
for(let j=0;j<levels.length-1;j++)builder.strip(levels[j],levels[j+1],true);bottom.push(levels[0]);top.push(levels.at(-1));cage.push({kind:'boundary',closed:true,points:levels[0]},{kind:'boundary',closed:true,points:levels.at(-1)});const n=source.length,a=0,b=Math.floor(n/2);cage.push({kind:'rail',closed:false,points:levels.map(r=>r[a])},{kind:'rail',closed:false,points:levels.map(r=>r[b])});}
const bottomPlane={origin:group.origin,u:group.u,v:group.v},topPlane={origin:group.origin.clone().addScaledVector(direction,height),u:group.u,v:group.v},br=generatorPlanarRecords(bottom,bottomPlane),tr=generatorPlanarRecords(top,topPlane);generatorCap(builder,br,-1);generatorCap(builder,tr,1);}
const built=builder.finish({generator:'extrude',backend:'spline_patch',inputContours:contours.length,usedContours:groups.reduce((n,g)=>n+g.rings.length,0),ignoredContours:topology.contours.length-contours.length});built.cage=cage;built.topology=topology;return built;}
function splineCageEdge(data,a,b,ha=[0,0,0],hb=[0,0,0],soft=false){const q=SPLINE.addSplineSequence(data,false),sid=SPLINE.addSplineSegment(data,q,a,b,ha,hb);if(soft)data.segments[sid].soft=true;return sid;}
function rotateLathePoint(point,theta){const c=Math.cos(theta),s=Math.sin(theta);return [c*point[0]+s*point[2],point[1],-s*point[0]+c*point[2]];}
function buildLatheSplineCage(source,p,axisMatrix=null){
let axis=null;if(axisMatrix){axis=axisMatrix.isMatrix4?axisMatrix.clone():new THREE.Matrix4().fromArray(axisMatrix);source=SPLINE.cloneSplineData(source);transformWholeSplineData(source,axis.clone().invert());}
const degrees=THREE.MathUtils.clamp(+p.angle||0,0,360),angle=degrees*D2R,full=Math.abs(degrees-360)<1e-7,intervals=Math.max(1,Math.ceil(Math.max(degrees,1)/90-1e-9)),columns=full?intervals:intervals+1,data=SPLINE.createSplineData({angle:approximationAngle(p)}),axisTolerance=Math.max(1e-7,Math.max(...Object.values(source.vertices).map(v=>Math.hypot(v[0],v[2])),1)*1e-8),onAxis=v=>Math.hypot(v[0],v[2])<=axisTolerance,columnVertices=new Map(),profileEdges=new Map(),railEdges=new Map(),sourceSegments=Object.values(source.segments);
data.patchCells=[];data.planarFills=[];
const cv=(vid,j)=>{const key=vid+'@'+(full?(j%columns+columns)%columns:j);if(columnVertices.has(key))return columnVertices.get(key);const point=source.vertices[vid];if(onAxis(point)){const pole='pole@'+vid;if(columnVertices.has(pole))return columnVertices.get(pole);const id=SPLINE.addSplineVertex(data,point.slice());columnVertices.set(pole,id);return id;}const id=SPLINE.addSplineVertex(data,rotateLathePoint(point,angle*j/intervals));columnVertices.set(key,id);return id;};
for(let j=0;j<columns;j++)for(const s of sourceSegments){const theta=angle*j/intervals,a=cv(s.a,j),b=cv(s.b,j),sid=splineCageEdge(data,a,b,rotateLathePoint(s.ha,theta),rotateLathePoint(s.hb,theta),false);profileEdges.set(s.id+'@'+j,sid);}
for(const vid of Object.keys(source.vertices)){const point=source.vertices[vid];if(onAxis(point))continue;for(let j=0;j<intervals;j++){const k=full?(j+1)%columns:j+1,theta0=angle*j/intervals,theta1=angle*(j+1)/intervals,delta=theta1-theta0,h=4/3*Math.tan(delta/4),a=cv(vid,j),b=cv(vid,k),pa=rotateLathePoint(point,theta0),pb=rotateLathePoint(point,theta1),ta=[pa[2]*h,0,-pa[0]*h],tb=[-pb[2]*h,0,pb[0]*h],sid=splineCageEdge(data,a,b,ta,tb,false);railEdges.set(vid+'@'+j,sid);}}
for(const s of sourceSegments)for(let j=0;j<intervals;j++){const k=full?(j+1)%columns:j+1,a0=cv(s.a,j),b0=cv(s.b,j),a1=cv(s.a,k),b1=cv(s.b,k),e0=profileEdges.get(s.id+'@'+j),e1=profileEdges.get(s.id+'@'+k);if(a0===a1&&b0===b1)continue;if(a0===a1)data.patchCells.push({vertices:[a0,b0,b1],edges:[e0,railEdges.get(s.b+'@'+j),e1]});else if(b0===b1)data.patchCells.push({vertices:[a0,b0,a1],edges:[e0,e1,railEdges.get(s.a+'@'+j)]});else data.patchCells.push({vertices:[a0,b0,b1,a1],edges:[e0,railEdges.get(s.b+'@'+j),e1,railEdges.get(s.a+'@'+j)]});}
if(!full)for(const sequence of source.sequences.filter(q=>!q.closed&&q.segments.length)){const first=source.segments[sequence.segments[0]],last=source.segments[sequence.segments.at(-1)];if(!first||!last||!onAxis(source.vertices[first.a])||!onAxis(source.vertices[last.b]))continue;const axis=splineCageEdge(data,cv(last.b,0),cv(first.a,0));data.planarFills.push({id:`${sequence.id}:lathe-start`,edges:sequence.segments.map(id=>profileEdges.get(id+'@0')).concat(axis)},{id:`${sequence.id}:lathe-end`,edges:sequence.segments.map(id=>profileEdges.get(id+'@'+intervals)).concat(axis)});}
const validation=SPLINE.validateSpline(data);if(!validation.ok)throw new Error(validation.errors.join('; '));if(axis)transformWholeSplineData(data,axis);return data;}
function buildLatheGenerator(data,p){
const angle=THREE.MathUtils.clamp(+p.angle||0,0,360)*D2R,full=Math.abs(angle-TAU)<1e-7,total=angularSegments(p,360),steps=full?total:Math.max(1,Math.ceil((+p.angle||0)/approximationAngle(p)-1e-9)),columns=full?steps:steps+1,builder=generatorBuilder(),cage=[],sequences=data.sequences.filter(q=>q.segments.length),used=[];for(const q of sequences){const points=generatorSequencePoints(data,q),sourceVertexCount=q.closed?q.segments.length:q.segments.length+1;if(points.length<2)continue;const axisTolerance=Math.max(1e-6,Math.max(...Object.values(data.vertices).map(v=>Math.hypot(v[0],v[2])),1)*1e-6),onAxis=x=>Math.hypot(x[0],x[2])<=axisTolerance;if(!q.closed&&onAxis(points[0])&&onAxis(points.at(-1))&&sourceVertexCount<3)continue;const rows=[];for(let j=0;j<columns;j++){const theta=angle*j/steps,c=Math.cos(theta),s=Math.sin(theta);rows.push(points.map(x=>[c*x[0]+s*x[2],x[1],-s*x[0]+c*x[2]]));}for(let j=0;j<(full?columns:columns-1);j++)builder.strip(rows[j],rows[(j+1)%columns],q.closed);const start=rows[0],end=rows.at(-1);cage.push({kind:'boundary',closed:q.closed,points:start});if(!full)cage.push({kind:'boundary',closed:q.closed,points:end});let railIndex=Math.floor(points.length/2),best=-1;for(let i=0;i<points.length;i++){const r=Math.hypot(points[i][0],points[i][2]);if(r>best){best=r;railIndex=i;}}const rail=[];for(let j=0;j<=steps;j++){const theta=angle*j/steps,c=Math.cos(theta),s=Math.sin(theta),x=points[railIndex];rail.push([c*x[0]+s*x[2],x[1],-s*x[0]+c*x[2]]);}cage.push({kind:'rail',closed:full,points:full?rail.slice(0,-1):rail});used.push(q.id);}
const built=builder.finish({generator:'lathe',backend:'spline_patch',angle:+p.angle||0,approximation:approximationAngle(p),circularIntervals:steps,pointsPerCubicSegment:Math.max(0,Math.round(steps/Math.max(1,Math.ceil((+p.angle||0)/90)))-1),inputSequences:sequences.length,usedSequences:used.length,ignoredSequences:sequences.length-used.length});built.cage=cage;try{built.cageData=buildLatheSplineCage(data,p);}catch(error){built.report.cageError=error.message||String(error);}return built;}
function buildSweepFrames(path,closed,initialNormal){const n=path.length,tangents=path.map((p,i)=>new THREE.Vector3().fromArray(path[(i+1)%n]).sub(new THREE.Vector3().fromArray(path[(i-1+n)%n])).normalize());if(!closed){tangents[0]=new THREE.Vector3().fromArray(path[1]).sub(new THREE.Vector3().fromArray(path[0])).normalize();tangents[n-1]=new THREE.Vector3().fromArray(path[n-1]).sub(new THREE.Vector3().fromArray(path[n-2])).normalize();}let normal=initialNormal.clone().addScaledVector(tangents[0],-initialNormal.dot(tangents[0]));if(normal.lengthSq()<1e-12)normal=new THREE.Vector3(Math.abs(tangents[0].x)<.8?1:0,Math.abs(tangents[0].x)<.8?0:1,0).addScaledVector(tangents[0],-(Math.abs(tangents[0].x)<.8?tangents[0].x:tangents[0].y));normal.normalize();const frames=[];for(let i=0;i<n;i++){if(i){normal.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(tangents[i-1],tangents[i])).addScaledVector(tangents[i],-normal.dot(tangents[i])).normalize();}const binormal=new THREE.Vector3().crossVectors(tangents[i],normal).normalize();frames.push({p:new THREE.Vector3().fromArray(path[i]),t:tangents[i],n:normal.clone(),b:binormal});}if(closed&&n>2){const end=normal.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(tangents.at(-1),tangents[0])).addScaledVector(tangents[0],-normal.dot(tangents[0])).normalize(),correction=Math.atan2(tangents[0].dot(new THREE.Vector3().crossVectors(end,frames[0].n)),end.dot(frames[0].n));for(let i=1;i<n;i++){frames[i].n.applyAxisAngle(frames[i].t,correction*i/n).normalize();frames[i].b.crossVectors(frames[i].t,frames[i].n).normalize();}}return frames;}
function buildSweepSplineCage(profileData,pathData){
const topology=SPLINE.resolveSplineTopology(profileData),contours=topology.planarContours,pathSequence=pathData.sequences.find(q=>q.segments.length);if(!contours.length||!pathSequence)throw new Error('Sweep cage needs a closed profile and a path');const pathPoints=generatorSequencePoints(pathData,pathSequence);if(pathPoints.length<2)throw new Error('Sweep path needs at least two evaluated points');const allProfileSegments=contours.flatMap(c=>c.edges.map(e=>e.id)),plane=generatorPlaneForData(profileData,allProfileSegments);if(!plane?.planar||plane.collinear)throw new Error('Sweep profile must be planar');const firstDirection=new THREE.Vector3().fromArray(pathPoints[1]).sub(new THREE.Vector3().fromArray(pathPoints[0])).normalize(),rotation=new THREE.Quaternion().setFromUnitVectors(plane.normal.clone().normalize(),firstDirection),frames=buildSweepFrames(pathPoints,pathSequence.closed,plane.u.clone().applyQuaternion(rotation)),data=SPLINE.createSplineData({angle:Math.min(profileData.approximation?.angle||5,pathData.approximation?.angle||5)}),rowVertices=new Map(),profileEdges=new Map(),railEdges=new Map(),rows=pathPoints.length,intervals=pathSequence.closed?rows:rows-1;
data.patchCells=[];data.planarFills=[];
const coords=new Map();for(const contour of contours)for(const vid of contour.vertices)if(!coords.has(vid)){const q=new THREE.Vector3().fromArray(profileData.vertices[vid]);coords.set(vid,[q.dot(plane.u),q.dot(plane.v),q.dot(plane.normal)]);}
const rv=(vid,row)=>{const key=vid+'@'+row;if(rowVertices.has(key))return rowVertices.get(key);const [x,y,z]=coords.get(vid),f=frames[row],point=f.p.clone().addScaledVector(f.n,x).addScaledVector(f.b,y).addScaledVector(f.t,z).toArray(),id=SPLINE.addSplineVertex(data,point);rowVertices.set(key,id);return id;};
const transformHandle=(handle,row)=>{const f=frames[row],v=new THREE.Vector3().fromArray(handle);return f.n.clone().multiplyScalar(v.dot(plane.u)).addScaledVector(f.b,v.dot(plane.v)).addScaledVector(f.t,v.dot(plane.normal)).toArray();};
for(let row=0;row<rows;row++)for(const sid of allProfileSegments){const s=profileData.segments[sid],edge=splineCageEdge(data,rv(s.a,row),rv(s.b,row),transformHandle(s.ha,row),transformHandle(s.hb,row),false);profileEdges.set(sid+'@'+row,edge);}
for(const vid of coords.keys())for(let i=0;i<intervals;i++){const j=(i+1)%rows,a=rv(vid,i),b=rv(vid,j),chord=SPLINE.splineMath.mul(SPLINE.splineMath.sub(data.vertices[b],data.vertices[a]),1/3),edge=splineCageEdge(data,a,b,chord,SPLINE.splineMath.mul(chord,-1),false);railEdges.set(vid+'@'+i,edge);}
for(const contour of contours)for(const edge of contour.edges){const s=profileData.segments[edge.id];for(let i=0;i<intervals;i++){const j=(i+1)%rows;data.patchCells.push({vertices:[rv(s.a,i),rv(s.b,i),rv(s.b,j),rv(s.a,j)],edges:[profileEdges.get(s.id+'@'+i),railEdges.get(s.b+'@'+i),profileEdges.get(s.id+'@'+j),railEdges.get(s.a+'@'+i)]});}}
if(!pathSequence.closed)for(const contour of contours){data.planarFills.push({id:contour.id+':start',edges:contour.edges.map(e=>({id:profileEdges.get(e.id+'@0'),reversed:!!e.reversed}))},{id:contour.id+':end',edges:contour.edges.map(e=>({id:profileEdges.get(e.id+'@'+(rows-1)),reversed:!!e.reversed}))});}
const validation=SPLINE.validateSpline(data);if(!validation.ok)throw new Error(validation.errors.join('; '));return data;}
function buildSweepGenerator(profileData,pathData){
const profileTopology=SPLINE.resolveSplineTopology(profileData),contours=profileTopology.planarContours,pathSequence=pathData.sequences.find(q=>q.segments.length),builder=generatorBuilder(),cage=[];if(!contours.length)throw new Error('Sweep profile needs at least one closed planar contour');if(!pathSequence)throw new Error('Sweep path is empty');const path=generatorSequencePoints(pathData,pathSequence);if(path.length<2)throw new Error('Sweep path needs at least two evaluated points');const allProfileSegments=contours.flatMap(c=>c.edges.map(e=>e.id)),plane=generatorPlaneForData(profileData,allProfileSegments);if(!plane?.planar||plane.collinear)throw new Error('Sweep profile must be planar');const rotation=new THREE.Quaternion().setFromUnitVectors(plane.normal.clone().normalize(),new THREE.Vector3().fromArray(path[Math.min(1,path.length-1)]).sub(new THREE.Vector3().fromArray(path[0])).normalize()),initialNormal=plane.u.clone().applyQuaternion(rotation),frames=buildSweepFrames(path,pathSequence.closed,initialNormal),rings=[];
for(const contour of contours){const source=generatorCyclePoints(profileData,contour),coords=source.map(p=>{const v=new THREE.Vector3().fromArray(p).sub(plane.origin);return [v.dot(plane.u),v.dot(plane.v)];}),along=frames.map(f=>coords.map(([x,y])=>f.p.clone().addScaledVector(f.n,x).addScaledVector(f.b,y).toArray()));for(let i=0;i<(pathSequence.closed?along.length:along.length-1);i++)builder.strip(along[i],along[(i+1)%along.length],true);rings.push({coords,along});cage.push({kind:'boundary',closed:true,points:along[0]});if(!pathSequence.closed)cage.push({kind:'boundary',closed:true,points:along.at(-1)});let a=0,b=Math.floor(coords.length/2),best=-1;for(let i=0;i<coords.length;i++)for(let j=i+1;j<coords.length;j++){const d=(coords[i][0]-coords[j][0])**2+(coords[i][1]-coords[j][1])**2;if(d>best){best=d;a=i;b=j;}}cage.push({kind:'rail',closed:pathSequence.closed,points:along.map(r=>r[a])},{kind:'rail',closed:pathSequence.closed,points:along.map(r=>r[b])});}
if(!pathSequence.closed){const records0=generatorPlanarRecords(rings.map(r=>r.along[0]),{origin:frames[0].p,u:frames[0].n,v:frames[0].b}),records1=generatorPlanarRecords(rings.map(r=>r.along.at(-1)),{origin:frames.at(-1).p,u:frames.at(-1).n,v:frames.at(-1).b});generatorCap(builder,records0,-1);generatorCap(builder,records1,1);}const built=builder.finish({generator:'sweep',backend:'spline_patch',profileContours:contours.length,pathPoints:path.length,pathClosed:pathSequence.closed,intermediateCageContours:0});built.cage=cage;built.topology=profileTopology;try{built.cageData=buildSweepSplineCage(profileData,pathData);}catch(error){built.report.cageError=error.message||String(error);}return built;}
function updateSplineVisual(h){const base=splineData.get(h),v=splineVisuals.get(h);if(!base||!v)return;splineApproximation(h);const data=evaluatedSplineData(h),signature=JSON.stringify(data),parent=OBJ.get(h)?.parent,parentType=parent&&objParams.get(parent)?.__type,parentIsPatch=parentType==='spline_patch';if(v.surfaceSignature!==signature){v.surfaceSignature=signature;v.surface=null;if(parentType&&['spline_patch','extrude','lathe','sweep'].includes(parentType))scheduleGeneratorEvaluation(16,[h]);}clearSplineGroup(v.group);const parentState=parent&&replicaStates.get(parent),warning=parentIsPatch&&parentState?.report&&!parentState.report.ok,approximated=SPLINE.approximateSpline(data),lineColor=warning?0xff4268:0x42bce8;for(const q of approximated){if(q.points.length<2)continue;const renderPoints=q.points.map(x=>x.position);if(q.closed)renderPoints.push(q.points[0].position);v.group.add(lineObject(renderPoints,null,false,{color:lineColor,order:LAYER_OBJ+1}));}
const editing=splineMode&&selNodes.has(h);if(editing){
const all=Object.entries(data.vertices).map(([id,p])=>({id,p})),selected=all.filter(x=>splineSelection.vertices.has(splineElementKey(h,x.id))).map(x=>x.p),plain=all.filter(x=>!splineSelection.vertices.has(splineElementKey(h,x.id))).map(x=>x.p);
if(plain.length)v.group.add(pointsObject(plain,0xa8c7dc,7,viewShading.some(x=>x!==1)));if(selected.length)v.group.add(pointsObject(selected,0xffc400,10,false));
const hp=[],hl=[];for(const vid of splineHandleVertices(h,data)){const p=data.vertices[vid];if(!p)continue;for(const q of splineEditableHandles(data,vid)){hl.push(p,q.position);hp.push(q.position);}}
if(hl.length)v.group.add(lineObject(hl,null,false,{segments:true,color:0x6f8290,depthTest:false,opacity:.9,order:LAYER_BRACKET+3}));if(hp.length)v.group.add(pointsObject(hp,0x59d8ff,8,false,LAYER_BRACKET+5));
const selectedHp=[];for(const key of splineSelection.handles){const r=parseSplineElementKey(key);if(r.object!==h)continue;const q=parseSplineHandleKey(r.id),info=splineHandleInfo(data,q.segment,q.side);if(info)selectedHp.push(SPLINE.splineMath.add(data.vertices[info.vertex],info.vector));}
if(selectedHp.length)v.group.add(pointsObject(selectedHp,0xffc400,10,false,LAYER_BRACKET+6));
for(const key of splineSelection.segments){const ref=parseSplineElementKey(key);if(ref.object!==h)continue;const samples=SPLINE.sampleSplineSegment(data,ref.id).map(x=>x.position);if(samples.length>1)v.group.add(lineObject(samples,null,false,{color:0xffc400,depthTest:false,order:LAYER_BRACKET+4}));}}
if(splineHover.object===h&&splineHover.point){if(splineHover.kind==='segment'){const samples=SPLINE.sampleSplineSegment(data,splineHover.id).map(x=>x.position);if(samples.length>1)v.group.add(lineObject(samples,null,false,{color:0x72ff85,depthTest:false,order:LAYER_BRACKET+7}));if(splineHover.pointVisible)v.group.add(pointsObject([splineHover.point],0x72ff85,9,false,LAYER_BRACKET+8));}else v.group.add(pointsObject([splineHover.point],splineHover.kind==='vertex'?0xff4cff:0x72ff85,12,false,LAYER_BRACKET+8));}scheduleRender();}
function updateAllSplineVisuals(){for(const h of splineData.keys())if(OBJ.has(h))updateSplineVisual(h);}
function splineWorldMatrix(h){const g=splineVisuals.get(h)?.group;g?.updateMatrixWorld(true);return g?.matrixWorld||new THREE.Matrix4();}
function splineWorldPoint(h,p){return new THREE.Vector3().fromArray(p).applyMatrix4(splineWorldMatrix(h));}
function splineObjectBounds(h){const d=evaluatedSplineData(h);if(!d)return null;const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity);let any=false;for(const p of Object.values(d.vertices)){const w=splineWorldPoint(h,p);mn.min(w);mx.max(w);any=true;}return any?{min:mn.toArray(),max:mx.toArray()}:null;}
function clearSplineHover(){const old=splineHover.object;splineHover.kind=null;splineHover.object=null;splineHover.id=null;splineHover.side=null;splineHover.point=null;splineHover.pointVisible=false;splineHover.t=0;splineHover.view=-1;if(old&&splineVisuals.has(old))updateSplineVisual(old);}
function splineScreenHit(cx,cy,{editing=splineMode,vertices=true,handles=true,segments=true,radiusSegment=SNAP_PX}={}){const vi=viewAt(cx,cy),r=rectFor(vi);if(vi<0||!r)return null;const cam=vpState.views[vi].cam;cam.updateMatrixWorld(true);cam.updateProjectionMatrix();let best=null;const consider=(q,d2,limit)=>{if(d2<=limit*limit&&(!best||q.priority<best.priority||(q.priority===best.priority&&d2<best.d2)))best={...q,d2,view:vi};};for(const h of splineData.keys()){const d=evaluatedSplineData(h);if(!OBJ.has(h)||!effectiveVisible(h)||(editing&&!selNodes.has(h)))continue;const wm=splineWorldMatrix(h),project=local=>{const w=new THREE.Vector3().fromArray(local).applyMatrix4(wm),s=projectPx(w,cam,r);return [s[0],s[1],w];};if(vertices)for(const [vid,p] of Object.entries(d.vertices)){const s=project(p),d2=(s[0]-cx)**2+(s[1]-cy)**2;if(viewShading[vi]!==1&&!exactVertexVisible(s[2],s[2].clone().project(cam),cam))continue;consider({kind:'vertex',object:h,id:vid,point:p.slice(),world:s[2],priority:0},d2,EDIT_HIT_PX);}if(handles&&editing)for(const vid of splineHandleVertices(h,d)){for(const q of splineEditableHandles(d,vid)){const s=project(q.position),d2=(s[0]-cx)**2+(s[1]-cy)**2;consider({kind:'handle',object:h,id:q.segment,side:q.side,free:!!q.free,point:q.position.slice(),world:s[2],priority:1},d2,EDIT_HIT_PX);}}if(segments)for(const sid of Object.keys(d.segments)){const q=SPLINE.closestSplinePoint(d,sid,p=>{const s=project(p);return [s[0],s[1]];},cx,cy);if(q){const w=new THREE.Vector3().fromArray(q.position).applyMatrix4(wm);consider({kind:'segment',object:h,id:sid,point:q.position.slice(),world:w,t:q.t,priority:2},q.d2,radiusSegment);}}}return best;}
function setSplineHover(hit,pointVisible=false){if(pointVisible&&hit?.kind==='handle')hit=null;pointVisible=!!pointVisible&&hit?.kind==='segment';const old=splineHover.object,changed=!hit||old!==hit.object||splineHover.kind!==hit.kind||splineHover.id!==hit.id||splineHover.side!==hit.side||splineHover.pointVisible!==pointVisible||Math.abs((splineHover.t||0)-(hit.t||0))>.001;if(!changed)return;if(old&&splineVisuals.has(old)){splineHover.kind=null;splineHover.object=null;splineHover.point=null;updateSplineVisual(old);}if(hit){Object.assign(splineHover,hit,{pointVisible});updateSplineVisual(hit.object);}else clearSplineHover();}
function createSplinePatchFixture(patchName,cageName,data,position){const patch=makeNode(patchName,TYPE_GEN,true),h=makeNode(cageName,TYPE_MESH,false),pn=OBJ.get(patch),sn=OBJ.get(h);pn.children.push(h);pn.pos.fromArray(position);sn.parent=patch;rootOrder.push(patch);objParams.set(patch,{__type:'spline_patch'});objParams.set(h,{__type:'spline',angle:data.approximation.angle});installSplineObject(h,data);return patch;}
function createTestSpline(){const stress=createSplinePatchFixture('spline patch stress test','spline cage stress test',SPLINE.createSplineCageStressData(),[-1800,0,-1000]);createSplinePatchFixture('quad patch closed test','quad cage closed test',SPLINE.createSplineQuadClosedData(),[500,700,1800]);createSplinePatchFixture('mixed patch closed test','mixed triangle quad cage test',SPLINE.createSplineMixedClosedData(),[-200,650,-2200]);createSplinePatchFixture('sphere triangle patch test','sphere cage 3 contours test',SPLINE.createSplineSphereCageData(),[1800,650,-1200]);return stress;}
const bboxHalf=new THREE.Vector3(), baseLocalSize=new THREE.Vector3();
let bboxHalfMax=1;
const _euler=new THREE.Euler();
function orthoNormalizeLin(){
const e=gizmo.lin.elements;
const s0=Math.hypot(e[0],e[1],e[2]), s1=Math.hypot(e[4],e[5],e[6]), s2=Math.hypot(e[8],e[9],e[10]);
rotMatOfLin(gizmo.lin,_RMw);
const re=_RMw.elements;
e[0]=re[0]*s0;e[1]=re[1]*s0;e[2]=re[2]*s0;e[3]=0;
e[4]=re[4]*s1;e[5]=re[5]*s1;e[6]=re[6]*s1;e[7]=0;
e[8]=re[8]*s2;e[9]=re[9]*s2;e[10]=re[10]*s2;e[11]=0;
e[12]=0;e[13]=0;e[14]=0;e[15]=1;
rotQuatOfLin(gizmo.lin,gizmoHandleOrient); }
// Синхронизация визуального куба не должна менять модельную матрицу.
// В частности, повторная полярная нормализация при неравном масштабе
// меняла ориентацию объекта уже на первом шаге масштабирования.
function syncCube(){ const c=cubeRef.mesh; if(c){ c.matrix.copy(localTmp(gizmo)); c.matrixAutoUpdate=false; c.updateMatrixWorld(true); } }
function readTransform(mode){
if(uvEdit){ const owner=getObj(uvEdit.owner),local=uvEdit.map.mapFrame.clone().multiply(uvEdit.map.mapPivot).multiply(new THREE.Matrix4().makeScale(1/UV_PROXY_SIZE,1/UV_PROXY_SIZE,1/UV_PROXY_SIZE)),m=mode==='world'&&owner?worldMatrix(owner).multiply(local):local;
const linM4=_LM.copy(m); linM4.elements[12]=0;linM4.elements[13]=0;linM4.elements[14]=0; const pos=new THREE.Vector3().setFromMatrixPosition(m);
rotMatOfLin(linM4,_RM); const e=new THREE.Euler().setFromRotationMatrix(_RM); m3fromM4(linM4,_r9); const s=new THREE.Vector3(m3colLen(_r9,0),m3colLen(_r9,1),m3colLen(_r9,2)).multiplyScalar(UV_PROXY_SIZE); return {p:pos,s,e}; }
if(splineFocusActive())return readSplineTransform(mode);
if(polyMode&&polySelection.items.size)return readPolyTransform(mode);
const c=cubeRef.mesh;
let linM4, pos;
if(c && (c.visible||uvEdit||selNodes.size>1)){
if(mode==='world'){ c.updateMatrixWorld(true);
linM4=_LM.copy(c.matrixWorld); linM4.elements[12]=0;linM4.elements[13]=0;linM4.elements[14]=0;
pos=new THREE.Vector3().setFromMatrixPosition(c.matrixWorld); }
else { linM4=_LM.copy(gizmo.lin); pos=gizmo.pos.clone(); } }
else { const n=hudNode?OBJ.get(hudNode):null;
if(n){ if(mode==='world'){ const wm=worldMatrix(n); linM4=_LM.copy(wm); linM4.elements[12]=0;linM4.elements[13]=0;linM4.elements[14]=0; pos=new THREE.Vector3(wm.elements[12],wm.elements[13],wm.elements[14]); }
else { linM4=_LM.copy(n.lin); pos=n.pos.clone(); } }
else { return {p:new THREE.Vector3(),s:new THREE.Vector3(1,1,1),e:new THREE.Euler()}; } }
const rotNode=hudNode?OBJ.get(hudNode):null,rotWorld=mode==='world'&&rotNode?worldMatrix(rotNode):linM4;
rotWorld.elements[12]=0; rotWorld.elements[13]=0; rotWorld.elements[14]=0;
rotMatOfLin(rotWorld,_RM); const e=new THREE.Euler().setFromRotationMatrix(_RM);
let s=new THREE.Vector3();
if(uvEdit){ m3fromM4(linM4,_r9); s.set(m3colLen(_r9,0),m3colLen(_r9,1),m3colLen(_r9,2)); }
else if(hudNode && OBJ.get(hudNode)){
if(mode==='world'){ const bb=worldBBoxOfNode(hudNode);
if(bb) s.subVectors(bb.max,bb.min);
else { m3fromM4(linM4,_r9); const ext=localGeomExtent(hudNode); s.set(m3colLen(_r9,0)*ext.x,m3colLen(_r9,1)*ext.y,m3colLen(_r9,2)*ext.z); } }
else { const ext=localGeomExtent(hudNode); m3fromM4(linM4,_r9);
s.set(m3colLen(_r9,0)*ext.x, m3colLen(_r9,1)*ext.y, m3colLen(_r9,2)*ext.z); } }
else { m3fromM4(linM4,_r9); s.set(m3colLen(_r9,0),m3colLen(_r9,1),m3colLen(_r9,2)).multiply(baseLocalSize); }
if(selNodes.size){
const sizeAxes=mode==='world'?new THREE.Matrix4():linM4;
const pivotExtent=selectionExtentInPivotAxes(selNodes,sizeAxes); if(pivotExtent)s.copy(pivotExtent);
}
return {p:pos,s,e}; }
function applyInput(ch,i,v){
if(splineFocusActive()&&!editPivot){applySplineCoordinateInput(ch,i,v,coordMode);return;}
if(polyMode&&polySelection.items.size){applyPolyCoordinateInput(ch,i,v,coordMode);return;}
if(ch==='pos'){ gizmo.pos.setComponent(i,v); }
else if(ch==='size'){ const extent=uvEdit?new THREE.Vector3(UV_PROXY_SIZE,UV_PROXY_SIZE,UV_PROXY_SIZE):(hudNode&&OBJ.get(hudNode)?localGeomExtent(hudNode):baseLocalSize);
const base=extent.getComponent(i); const target=base>1e-9?v/base:v;
m3fromM4(gizmo.lin,_r9); const cur=m3colLen(_r9,i);
if(cur>1e-9){ let f=target/cur; if(cur*Math.abs(f)<MIN_COL) f=MIN_COL/cur; m3scaleCol(_r9,i,f); }
else { rotMatOfLin(gizmo.lin,_RM); const re=_RM.elements, size=Math.max(MIN_COL,Math.abs(target)); _r9[i]=re[i*4]*size; _r9[i+3]=re[i*4+1]*size; _r9[i+6]=re[i*4+2]*size; }
m3toM4(_r9,gizmo.lin); }
else { const deg=v*D2R;
rotMatOfLin(gizmo.lin,_RM);
const le=gizmo.lin.elements;
const s0=Math.hypot(le[0],le[1],le[2]), s1=Math.hypot(le[4],le[5],le[6]), s2=Math.hypot(le[8],le[9],le[10]);
const e=new THREE.Euler().setFromRotationMatrix(_RM);
if(i===0)e.x=deg; else if(i===1)e.y=deg; else e.z=deg;
_RM.makeRotationFromEuler(e);
const re=_RM.elements;
const ge=gizmo.lin.elements;
ge[0]=re[0]*s0;ge[1]=re[1]*s0;ge[2]=re[2]*s0;ge[3]=0;
ge[4]=re[4]*s1;ge[5]=re[5]*s1;ge[6]=re[6]*s1;ge[7]=0;
ge[8]=re[8]*s2;ge[9]=re[9]*s2;ge[10]=re[10]*s2;ge[11]=0;
ge[12]=0;ge[13]=0;ge[14]=0;ge[15]=1;
rotQuatOfLin(gizmo.lin,gizmoHandleOrient); }
syncCube(); scheduleRender(); emitTransform(); }
function rescaleRoots(k){ for(const h of rootOrder){ const n=OBJ.get(h); if(!n)continue; n.pos.multiplyScalar(k);
const e=n.lin.elements; e[0]*=k;e[1]*=k;e[2]*=k;e[4]*=k;e[5]*=k;e[6]*=k;e[8]*=k;e[9]*=k;e[10]*=k;
const track=animationTracks.get(h);if(track)for(const key of track.values()){for(let i=0;i<3;i++){key.p[i]*=k;key.s[i]*=k;}}
const t=threeOf.get(h); if(t){ t.matrix.copy(localTmp(n)); t.updateMatrixWorld(true); } }
gizmo.pos.multiplyScalar(k); const ge=gizmo.lin.elements; ge[0]*=k;ge[1]*=k;ge[2]*=k;ge[4]*=k;ge[5]*=k;ge[6]*=k;ge[8]*=k;ge[9]*=k;ge[10]*=k;
syncCube(); scheduleRender(); emitTransform(); }
function doAutoPivot(){ const n=hudNode?OBJ.get(hudNode):null; if(!n)return;
if(uvEdit){ const owner=getObj(uvEdit.owner),map=uvEdit.map; if(!owner||!map)return; const frame=worldMatrix(owner).multiply(map.mapFrame); const inv=frame.clone().invert(); const cam=(vpState.mode==='single'?vpState.views[vpState.singleView].cam:vpState.perspCam); let best=null,bestD=-1; const p=new THREE.Vector3(); for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){ p.set(x,y,z).applyMatrix4(frame); const d=p.distanceToSquared(cam.position); if(d>bestD){bestD=d;best=p.clone();} } const lp=best.applyMatrix4(inv); map.mapPivot.makeTranslation(lp.x,lp.y,lp.z); placeGizmoForSelection(); return; }
const ownBB=getWorldBBox(hudNode); if(!ownBB)return;
const bb={min:new THREE.Vector3().fromArray(ownBB.min),max:new THREE.Vector3().fromArray(ownBB.max)};
const cam=(vpState.mode==='single'?vpState.views[vpState.singleView].cam:vpState.perspCam);
const mn=bb.min, mx=bb.max;
const corners=[[mn.x,mn.y,mn.z],[mx.x,mn.y,mn.z],[mn.x,mx.y,mn.z],[mx.x,mx.y,mn.z],[mn.x,mn.y,mx.z],[mx.x,mn.y,mx.z],[mn.x,mx.y,mx.z],[mx.x,mx.y,mx.z]];
const w=new THREE.Vector3(); let best=null,bestD=-1;
for(const cc of corners){ w.set(cc[0],cc[1],cc[2]); const d=w.distanceToSquared(cam.position); if(d>bestD){bestD=d;best=w.clone();} }
if(!best)return;
const wm=worldMatrix(n); const winv=wm.clone().invert();
const localPivot=best.clone().applyMatrix4(winv);
// Pivot хранит только локальное смещение. Добавлять сюда inverse rotation
// нельзя: при следующем выделении она сбрасывает ориентацию гизмо в world.
n.pivot.makeTranslation(localPivot.x,localPivot.y,localPivot.z);
gizmo.pos.copy(best);
syncCube();
scheduleRender(); }
/* ------------------------------ команды ------------------------------ */
function snapNode(h){ const n=OBJ.get(h); return {h,parent:n.parent,children:n.children.slice(),name:n.name,type:n.type,
visible:n.visible,enabled:n.enabled,enableSlot:n.enableSlot,folded:n.folded,tags:n.tags.map(cloneTag),
pos:n.pos.clone(),lin:n.lin.clone(),pivot:n.pivot.clone()}; }
function restoreNode(s){ const n=OBJ.get(s.h); if(!n)return; n.parent=s.parent; n.children=s.children.slice(); n.name=s.name; n.type=s.type;
n.visible=s.visible; n.enabled=s.enabled; n.enableSlot=s.enableSlot; n.folded=s.folded; n.tags=s.tags.map(cloneTag);
n.pos.copy(s.pos); n.lin.copy(s.lin); n.pivot.copy(s.pivot); }
function cmdAddObject(name,type,selectedHashes,opts){ opts=opts||{}; const wrapSel=!!opts.wrapSel, enableSlot=!!opts.enableSlot;
let newHash=null,savedNode=null,savedParams=null; const oldParents=new Map(),oldWorlds=new Map(selectedHashes.filter(h=>OBJ.has(h)).map(h=>[h,worldMatrix(OBJ.get(h))])); let created=false;
return { redo(){
let restoreChildren=null;if(savedNode){restoreChildren=savedNode.children.slice();OBJ.set(newHash,savedNode);savedNode.children=[];if(savedParams){objParams.set(newHash,{...savedParams});syncParametricObject(newHash);}}else newHash=makeNode(name,type,enableSlot); created=true; const n=OBJ.get(newHash);
if(wrapSel&&selectedHashes.length){
const roots=selectedHashes.filter(h=>OBJ.has(h)&&!selectedHashes.some(o=>o!==h&&isAncestor(OBJ.get(o),OBJ.get(h))));
roots.forEach(h=>{ const child=OBJ.get(h); if(!child)return; oldParents.set(h,child.parent);
if(child.parent){ const p=OBJ.get(child.parent); if(p)p.children=p.children.filter(c=>c!==h); } else rootOrder=rootOrder.filter(c=>c!==h);
child.parent=newHash; n.children.push(h); if(oldWorlds.has(h))setNodeFromWorld(child,oldWorlds.get(h)); }); }
if(restoreChildren?.length)n.children.sort((a,b)=>restoreChildren.indexOf(a)-restoreChildren.indexOf(b));
rootOrder=rootOrder.filter(c=>c!==newHash); rootOrder.unshift(newHash); },
undo(){ if(!created)return;
const kids=OBJ.get(newHash)?OBJ.get(newHash).children.slice():[];
kids.forEach(h=>{ const child=OBJ.get(h); if(!child)return;
if(child.parent===newHash) child.parent=oldParents.has(h)?oldParents.get(h):null;
const op=oldParents.get(h);
if(op){ const p=OBJ.get(op); if(p&&!p.children.includes(h))p.children.push(h); } else if(!rootOrder.includes(h))rootOrder.push(h); });
kids.forEach(h=>{const child=OBJ.get(h);if(child&&oldWorlds.has(h))setNodeFromWorld(child,oldWorlds.get(h));});
savedNode=OBJ.get(newHash)||savedNode;savedParams=objParams.get(newHash)?{...objParams.get(newHash)}:savedParams;if(splineData.has(newHash))disposeSplineVisual(newHash,true);const state=replicaStates.get(newHash);if(state)disposeReplicaState(newHash,state);disposeParametricMesh(newHash);const t=threeOf.get(newHash);if(t){t.parent?.remove(t);threeOf.delete(newHash);}objParams.delete(newHash);rootOrder=rootOrder.filter(c=>c!==newHash); OBJ.delete(newHash); } }; }
function cmdDelete(hashes){ const all=new Set(); hashes.forEach(h=>collectSubtree(h,all)); const list=[...all];
const snap=list.map(snapNode);
const parents=new Set(); list.forEach(h=>{ const n=OBJ.get(h); if(n&&n.parent)parents.add(n.parent); });
const parentSnap=[...parents].map(ph=>({ph,children:OBJ.get(ph).children.slice()})); const rootSnap=rootOrder.slice(),listSet=new Set(list);let deleted=false;
const disposeDeleted=()=>{if(!deleted)return;for(const h of list){const state=replicaStates.get(h);if(state)disposeReplicaState(h,state);if(splineData.has(h)||splineVisuals.has(h))disposeSplineVisual(h,true);const wire=wireOverlays.get(h);if(wire){wireOverlays.delete(h);wire.parent?.remove(wire);wire.geometry?.dispose();wire.material?.dispose();}const points=polyPointOverlays.get(h);if(points){polyPointOverlays.delete(h);points.parent?.remove(points);points.material?.dispose();}const crease=creaseOverlays.get(h);if(crease){creaseOverlays.delete(h);crease.parent?.remove(crease);crease.geometry?.dispose();crease.material?.dispose();}}
for(const s of snap)if(!listSet.has(s.parent)){const t=threeOf.get(s.h);if(t){t.parent?.remove(t);disposeObjThrees(t);}}
for(const h of list){const t=threeOf.get(h);if(t){const at=contentThrees.indexOf(t);if(at>=0)contentThrees.splice(at,1);const pm=t.userData?._pickObject;if(pm)meshToHash.delete(pm);delete t.userData?._pickObject;}pickMeshes.delete(h);threeOf.delete(h);objParams.delete(h);animationTracks.delete(h);evaluatedSplineCache.delete(h);sceneObjects.delete(h);}deleted=false;};
return { redo(){ deleted=true;list.forEach(h=>{ const n=OBJ.get(h); if(n&&n.parent){ const pn=OBJ.get(n.parent); if(pn)pn.children=pn.children.filter(c=>c!==h); }
const t=threeOf.get(h); if(t){ t.visible=false; t.userData._hiddenForUndo=true; const pm=pickMeshes.get(h);if(pm){t.userData._wasPick=true;t.userData._pickObject=pm;pickMeshes.delete(h);meshToHash.delete(pm);} }for(const map of [polyPointOverlays,creaseOverlays]){const overlay=map.get(h);if(overlay)overlay.visible=false;}
OBJ.delete(h); });
rootOrder=rootOrder.filter(h=>!list.includes(h)); },
undo(){ deleted=false;list.forEach(h=>OBJ.set(h,{hash:h,name:'',type:0,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,
pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()}));
snap.forEach(restoreNode);
list.forEach(h=>{ const t=threeOf.get(h); if(t){ t.visible=true; t.userData._hiddenForUndo=false; if(t.userData._wasPick){const pm=t.userData._pickObject||t;pickMeshes.set(h,pm);meshToHash.set(pm,h);t.userData._wasPick=false;delete t.userData._pickObject;} } });
parentSnap.forEach(e=>{ const pn=OBJ.get(e.ph); if(pn)pn.children=e.children.slice(); }); rootOrder=rootSnap.slice(); },dispose:disposeDeleted}; }
function materialHashForThree(material){ const h=material?.userData?.frameMatHash;if(h&&MATS.has(h))return h;for(const [hash,m] of threeMats)if(m===material)return hash;return defaultMatHash; }
function collectPolygonalMeshes(h,out,seen){ const n=OBJ.get(h);if(!n||!n.visible)return;const type=objParams.get(h)?.__type,state=derivedState(h);
  if(n.enabled&&(type==='boolean'||type==='instance'||type==='symmetry'||type==='cloner'||type==='spline_patch'||type==='extrude'||type==='lathe'||type==='sweep'||PARAMETRIC_MESH_TYPES.has(type))&&state?.ready&&state.mesh){if(!seen.has(state.mesh)){seen.add(state.mesh);out.push(state.mesh);}return;}
if(n.type===TYPE_MESH){const mesh=pickMeshes.get(h);if(mesh&&!seen.has(mesh)){seen.add(mesh);out.push(mesh);}}
for(const child of n.children)collectPolygonalMeshes(child,out,seen); }
function cmdMakePolygonal(hashes){ const selected=hashes.filter(h=>OBJ.has(h)),set=new Set(selected),roots=sortByTreeOrder(selected.filter(h=>{let p=OBJ.get(h)?.parent;while(p){if(set.has(p))return false;p=OBJ.get(p)?.parent;}return true;}));if(!roots.length)return null;
syncMeshParents();const sources=[],seen=new Set();for(const h of roots)collectPolygonalMeshes(h,sources,seen);if(!sources.length)return null;
const basis=roots.length===1?gizmoWorldMatrix(roots[0]):new THREE.Matrix4().fromArray(getGizmoWorldArray()),frame=new THREE.Matrix4();rotMatOfLin(basis,frame);frame.setPosition(basis.elements[12],basis.elements[13],basis.elements[14]);const invFrame=frame.clone().invert();
const positions=[],indices=[],uvs=[],materials=[],materialFrames=[],groups=[];for(const mesh of sources){mesh.updateMatrixWorld(true);const transform=invFrame.clone().multiply(mesh.matrixWorld),start=materials.length;appendGeneratedMesh(mesh,transform,positions,indices,materials,new Map(),groups,uvs);for(let mi=start;mi<materials.length;mi++){const mh=materialHashForThree(materials[mi]),sourceFrame=materials[mi]?.userData?.frameRef||MATS.get(mh)?.mapFrame||defaultMapFrame();materialFrames[mi]=transform.clone().multiply(sourceFrame);}}if(!indices.length)return null;
const tagMap=new Map();for(const group of groups){const mh=materialHashForThree(materials[group.materialIndex]);if(mh===defaultMatHash)continue;const mapFrame=materialFrames[group.materialIndex]||defaultMapFrame(),key=mh+'|'+mapFrame.elements.map(v=>Number(v.toPrecision(10))).join(','),spec=tagMap.get(key)||{ref:mh,polys:[],mapFrame:mapFrame.clone()};for(let at=group.start;at<group.start+group.count;at+=3)spec.polys.push(at/3);tagMap.set(key,spec);}const tagSpecs=[...tagMap.values()];if(tagSpecs.length===1&&tagSpecs[0].polys.length===indices.length/3)tagSpecs[0].polys=null;
const newHash=genHash(),name=roots.length===1?(OBJ.get(roots[0])?.name||'Polygon'):'Polygon',deleteCmd=cmdDelete(roots),oldSel=[...selNodes],oldTags=[...selTags];let mesh=null;
const create=()=>{const n={hash:newHash,name,type:TYPE_MESH,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};setNodeFromLocal(n,frame);OBJ.set(newHash,n);rootOrder=rootOrder.filter(h=>h!==newHash);rootOrder.unshift(newHash);
const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(uvs.length)g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(new THREE.Uint32BufferAttribute(indices,1));for(const group of groups)g.addGroup(group.start,group.count,group.materialIndex);g.computeVertexNormals();g.computeBoundingBox();mesh=new THREE.Mesh(g,materials.length===1?materials[0]:materials);mesh.matrixAutoUpdate=false;mesh.renderOrder=LAYER_OBJ;mesh.matrix.copy(localTmp(n));vpState.scene.add(mesh);contentThrees.push(mesh);registerPickMesh(newHash,mesh);threeOf.set(newHash,mesh);initCreaseRender(mesh);n.tags=tagSpecs.map(s=>({type:1,ref:s.ref,polys:s.polys&&s.polys.slice(),mapFrame:s.mapFrame.clone(),mapPivot:new THREE.Matrix4()}));assignMeshMat(mesh,newHash);};
const destroy=()=>{const wire=wireOverlays.get(newHash);if(wire){wireOverlays.delete(newHash);if(wire.parent)wire.parent.remove(wire);wire.geometry.dispose();wire.material.dispose();}if(mesh){const i=contentThrees.indexOf(mesh);if(i>=0)contentThrees.splice(i,1);if(mesh.parent)mesh.parent.remove(mesh);disposeObjThrees(mesh);meshToHash.delete(mesh);}pickMeshes.delete(newHash);threeOf.delete(newHash);OBJ.delete(newHash);objParams.delete(newHash);animationTracks.delete(newHash);rootOrder=rootOrder.filter(h=>h!==newHash);mesh=null;};
return {result:newHash,redo(){deleteCmd.redo();create();polySelection.items.clear();selTags.clear();selNodes.clear();selNodes.add(newHash);lastAttrKey=null;treeChanged();refreshSelClasses();},undo(){destroy();deleteCmd.undo();polySelection.items.clear();selNodes.clear();selTags.clear();for(const h of oldSel)if(OBJ.has(h))selNodes.add(h);for(const id of oldTags)selTags.add(id);lastAttrKey=null;treeChanged();refreshSelClasses();},dispose(){deleteCmd.dispose?.();}}; }
function mergedSplineData(hashes,frame){const first=hashes[0],base=objParams.get(first)||{},out=SPLINE.createSplineData({angle:base.angle||5}),inv=frame.clone().invert();
for(const h of hashes){const src=splineData.get(h),wm=splineWorldMatrix(h);if(!src)continue;const map=new Map(),point=p=>new THREE.Vector3().fromArray(p).applyMatrix4(wm).applyMatrix4(inv).toArray();for(const [vid,p] of Object.entries(src.vertices))map.set(vid,SPLINE.addSplineVertex(out,point(p)));for(const [vid,free] of Object.entries(src.freeHandles||{})){const nv=map.get(vid),np=out.vertices[nv],p=src.vertices[vid];if(!nv||!np||!p)continue;out.freeHandles[nv]={in:SPLINE.splineMath.sub(point(SPLINE.splineMath.add(p,free.in||[0,0,0])),np),out:SPLINE.splineMath.sub(point(SPLINE.splineMath.add(p,free.out||[0,0,0])),np)};}for(const q of src.sequences){const nq=SPLINE.addSplineSequence(out,q.closed);for(const sid of q.segments){const s=src.segments[sid];if(!s)continue;const a=src.vertices[s.a],b=src.vertices[s.b],na=out.vertices[map.get(s.a)],nb=out.vertices[map.get(s.b)],ca=point(SPLINE.splineMath.add(a,s.ha)),cb=point(SPLINE.splineMath.add(b,s.hb)),ns=SPLINE.addSplineSegment(out,nq,map.get(s.a),map.get(s.b),SPLINE.splineMath.sub(ca,na),SPLINE.splineMath.sub(cb,nb));if(s.soft)out.segments[ns].soft=true;}}}
let changed=true;while(changed){changed=false;const ids=Object.keys(out.vertices);outer:for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)if(SPLINE.splineMath.dist(out.vertices[ids[i]],out.vertices[ids[j]])<1e-4){SPLINE.weldSplineVertices(out,ids[i],ids[j]);changed=true;break outer;}}return out;}
function cmdConnectSplines(hashes){const roots=sortByTreeOrder(hashes.filter(h=>OBJ.has(h)&&splineData.has(h)));if(!roots.length)return null;const first=roots[0],frame=splineWorldMatrix(first).clone(),data=mergedSplineData(roots,frame),sourceParams=objParams.get(first)||{},params={__type:'spline',angle:Math.max(1,Math.round(+sourceParams.angle||5))},newHash=genHash(),name=roots.length===1?(OBJ.get(first)?.name||'Spline'):'Spline',deleteCmd=cmdDelete(roots),oldSel=[...selNodes],oldTags=[...selTags];
const create=()=>{const n={hash:newHash,name,type:TYPE_MESH,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};setNodeFromWorld(n,frame);OBJ.set(newHash,n);rootOrder=rootOrder.filter(h=>h!==newHash);rootOrder.unshift(newHash);objParams.set(newHash,{...params});installSplineObject(newHash,SPLINE.cloneSplineData(data));};
const destroy=()=>{disposeSplineVisual(newHash,true);OBJ.delete(newHash);objParams.delete(newHash);animationTracks.delete(newHash);rootOrder=rootOrder.filter(h=>h!==newHash);};
return {result:newHash,redo(){deleteCmd.redo();create();leaveSplineEdit();selNodes.clear();selTags.clear();selNodes.add(newHash);anchorNode=OBJ.get(newHash);lastAttrKey=null;treeChanged();refreshSelClasses();},undo(){destroy();deleteCmd.undo();selNodes.clear();selTags.clear();for(const h of oldSel)if(OBJ.has(h))selNodes.add(h);for(const id of oldTags)selTags.add(id);anchorNode=selNodes.size?OBJ.get([...selNodes][0]):null;lastAttrKey=null;treeChanged();refreshSelClasses();},dispose(){deleteCmd.dispose?.();}};}
function cmdConnectDelete(hashes){const selected=hashes.filter(h=>OBJ.has(h)),splines=selected.filter(h=>splineData.has(h));if(!selected.length)return null;const polygonSources=[];for(const h of selected)collectPolygonalMeshes(h,polygonSources,new Set());if(polygonSources.length)return cmdMakePolygonal(selected);if(splines.length)return cmdConnectSplines(splines);return cmdMakePolygonal(selected);}
function treeOrderFirst(set){ let best=null;
const walk=h=>{ if(best)return; if(set.has(h)){ best=h; return; }
const n=OBJ.get(h); if(n) for(const c of n.children) walk(c); };
for(const h of rootOrder){ if(best)break; walk(h); } return best; }
function cmdGroup(sel){ if(!sel.length)return null; const selSet=new Set(sel);
const roots=[...selSet].filter(h=>!selSet.has((OBJ.get(h).parent)||'__none__')); if(!roots.length)return null;
const rootsSet=new Set(roots);
const firstRoot=treeOrderFirst(selSet)||roots[0], anchorParent=OBJ.get(firstRoot).parent; let g=null;
const parentArrSnap=(anchorParent?OBJ.get(anchorParent).children:rootOrder).slice();
const atOrig=parentArrSnap.indexOf(firstRoot), at=atOrig<0?parentArrSnap.length:atOrig;
let nextSib=undefined; for(let i=at+1;i<parentArrSnap.length;i++){ if(!rootsSet.has(parentArrSnap[i])){ nextSib=parentArrSnap[i]; break; } }
const affectedParents=new Set(); roots.forEach(h=>{ const p=OBJ.get(h).parent; affectedParents.add(p===null?'__root':p); });
const parentSnap=[...affectedParents].map(k=>k==='__root'?{ph:'__root',children:rootOrder.slice()}:{ph:k,children:OBJ.get(k).children.slice()});
const childSnaps=sel.map(snapNode);
return { redo(){ g=makeNode('Group',TYPE_GROUP,false);
roots.forEach(h=>{ const n=OBJ.get(h); if(n.parent){ const pn=OBJ.get(n.parent); if(pn)pn.children=pn.children.filter(c=>c!==h);} else rootOrder=rootOrder.filter(c=>c!==h); });
const parentArr=anchorParent?OBJ.get(anchorParent).children:rootOrder;
if(nextSib!==undefined){ const ni=parentArr.indexOf(nextSib); parentArr.splice(ni<0?parentArr.length:ni,0,g); } else parentArr.push(g);
const gn=OBJ.get(g); gn.parent=anchorParent; gn.children=roots.slice(); roots.forEach(h=>{ OBJ.get(h).parent=g; }); },
undo(){ const gn=OBJ.get(g); if(gn&&gn.parent){ const pn=OBJ.get(gn.parent); if(pn)pn.children=pn.children.filter(c=>c!==g);} else rootOrder=rootOrder.filter(c=>c!==g);
parentSnap.forEach(e=>{ if(e.ph==='__root')rootOrder=e.children.slice(); else { const pn=OBJ.get(e.ph); if(pn)pn.children=e.children.slice(); } });
childSnaps.forEach(restoreNode); OBJ.delete(g); } }; }
function detachList(hashes){ hashes.forEach(h=>{ const n=OBJ.get(h); if(n.parent){ const pn=OBJ.get(n.parent); if(pn)pn.children=pn.children.filter(c=>c!==h); } else rootOrder=rootOrder.filter(c=>c!==h); }); }
function insertList(hashes,drop){ if(drop.mode==='child'){
drop.target.children=drop.target.children.filter(c=>!hashes.includes(c)); drop.target.children=[...hashes, ...drop.target.children];
hashes.forEach(h=>{ OBJ.get(h).parent=drop.target.hash; }); }
else if(drop.mode==='rootEnd'){ rootOrder=rootOrder.filter(c=>!hashes.includes(c)); rootOrder.push(...hashes); hashes.forEach(h=>{ OBJ.get(h).parent=null; }); }
else { const arr=drop.target.parent?OBJ.get(drop.target.parent).children:rootOrder;
const clean=arr.filter(c=>!hashes.includes(c)); let at=clean.indexOf(drop.target.hash); if(at<0)at=clean.length; if(drop.mode==='after')at+=1;
clean.splice(at,0,...hashes); hashes.forEach(h=>{ OBJ.get(h).parent=drop.target.parent; });
if(drop.target.parent) OBJ.get(drop.target.parent).children=clean; else rootOrder=clean; } }
function setCopiedSplineUndoState(h,hidden){const visual=splineVisuals.get(h);if(!visual)return;visual.group.userData._hiddenForUndo=!!hidden;visual.group.visible=!hidden;if(!hidden){threeOf.set(h,visual.group);const n=OBJ.get(h);if(n)visual.group.matrix.copy(localTmp(n));}}
function cmdReparent(hashes,drop){ const moving=hashes.filter(h=>h!==drop.target.hash&&!isAncestor(OBJ.get(h),drop.target));
if(!moving.length)return {redo(){},undo(){}};
const before=moving.map(snapNode); const affected=new Set();
moving.forEach(h=>{ const n=OBJ.get(h); if(n&&n.parent)affected.add(n.parent); else affected.add('__root'); });
if(drop.target&&drop.target.parent)affected.add(drop.target.parent); else affected.add('__root'); if(drop.target)affected.add(drop.target.hash);
const parentSnap=[...affected].map(k=>k==='__root'?{ph:'__root',children:rootOrder.slice()}:{ph:k,children:OBJ.get(k).children.slice()});
const worlds=new Map(); moving.forEach(h=>worlds.set(h,worldMatrix(OBJ.get(h))));
return { redo(){ detachList(moving); insertList(moving,drop);
moving.forEach(h=>{ const n=OBJ.get(h); setNodeFromWorld(n,worlds.get(h)); }); },
undo(){ parentSnap.forEach(e=>{ if(e.ph==='__root')rootOrder=e.children.slice(); else { const pn=OBJ.get(e.ph); if(pn)pn.children=e.children.slice(); } });
before.forEach(restoreNode); } }; }
function cmdCopyTo(hashes,drop){ if(!hashes.length)return {redo(){},undo(){}};
const roots=sortByTreeOrder(hashes.filter(h=>!hashes.some(o=>o!==h&&isAncestor(OBJ.get(o),OBJ.get(h)))));
const specs=[], newRoots=[], allNew=[], desiredWorlds=new Map(), cloneSrc=new Map();
const cmd={ map:new Map(), redo(){}, undo(){} };
roots.forEach(r=>{ const sub=new Set(); collectSubtree(r,sub); const map=new Map(); [...sub].forEach(h=>map.set(h,genHash()));
[...sub].forEach(h=>{ const nh=map.get(h); allNew.push(nh); const n=OBJ.get(h); desiredWorlds.set(nh,worldMatrix(n));
cloneSrc.set(nh,pickMeshes.get(h)||null); const isRoot=(h===r);
cmd.map.set(h,nh);
specs.push({nh,name:n.name,type:n.type,visible:n.visible,enabled:n.enabled,enableSlot:n.enableSlot,folded:n.folded,tags:n.tags.map(cloneTag),
childrenNew:n.children.map(c=>map.has(c)?map.get(c):c),parentNew:isRoot?null:(map.has(n.parent)?map.get(n.parent):n.parent),isRoot});
if(isRoot) newRoots.push(nh); }); });
const target=drop.target;
const snapChildren=drop.mode==='child'?target.children.slice():(target.parent?OBJ.get(target.parent).children.slice():rootOrder.slice());
cmd.redo=function(){
specs.forEach(s=>{ OBJ.set(s.nh,{hash:s.nh,name:s.name,type:s.type,parent:null,children:s.childrenNew.slice(),
visible:s.visible,enabled:s.enabled,enableSlot:s.enableSlot,folded:s.folded,tags:s.tags.map(cloneTag),
pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()}); allNew.push(s.nh); });
specs.forEach(s=>{ OBJ.get(s.nh).parent=s.isRoot?(drop.mode==='child'?target.hash:(target.parent||null)):s.parentNew; });
specs.forEach(s=>{ const nn=OBJ.get(s.nh); setNodeFromWorld(nn,desiredWorlds.get(s.nh)); });
specs.forEach(s=>setCopiedSplineUndoState(s.nh,false));
cloneSrc.forEach((src,nh)=>{ if(src&&src.isMesh){
const nm=src.clone(); nm.children.slice().forEach(child=>nm.remove(child)); nm.geometry=src.geometry?src.geometry.clone():nm.geometry;
if(src.userData._selectMat){ nm.material=Array.isArray(src.material)?src.material.map(mm=>mm.clone()):(src.material?src.material.clone():nm.material); nm.userData._selectMat=true; }
else nm.material=null;
nm.matrixAutoUpdate=false; nm.renderOrder=LAYER_OBJ; vpState.scene.add(nm); contentThrees.push(nm); registerPickMesh(nh,nm); threeOf.set(nh,nm);
const nn=OBJ.get(nh); nm.matrix.copy(localTmp(nn)); nm.updateMatrixWorld(true); } });
newRoots.forEach(rh=>applyNodeMaterial(rh));
if(drop.mode==='child'){ target.children=[...newRoots,...target.children]; }
else { const arr=target.parent?OBJ.get(target.parent).children:rootOrder; const clean=arr.filter(c=>!newRoots.includes(c));
let at=clean.indexOf(target.hash); if(at<0)at=clean.length; if(drop.mode==='after')at+=1; clean.splice(at,0,...newRoots);
if(target.parent) OBJ.get(drop.target.parent).children=clean; else rootOrder=clean; } };
cmd.undo=function(){
allNew.forEach(h=>{setCopiedSplineUndoState(h,true);const m=pickMeshes.get(h); if(m){ const idx=contentThrees.indexOf(m); if(idx>=0)contentThrees.splice(idx,1);
if(m.parent)m.parent.remove(m); else vpState.scene.remove(m);
disposeObjThrees(m);
pickMeshes.delete(h); meshToHash.delete(m); threeOf.delete(h); } OBJ.delete(h); });
if(drop.mode==='child'){ target.children=snapChildren.slice(); }
else { if(target.parent) OBJ.get(target.parent).children=snapChildren.slice(); else rootOrder=snapChildren.slice(); } };
return cmd; }
function cmdDuplicateToRoot(hashes){
const roots=sortByTreeOrder(hashes.filter(h=>OBJ.has(h)&&!hashes.some(o=>o!==h&&isAncestor(OBJ.get(o),OBJ.get(h)))));
const cmd={ newRoots:[], map:new Map(), redo(){}, undo(){} };
if(!roots.length) return cmd;
const specs=[], newRoots=[], allNew=[], desiredWorlds=new Map(), cloneSrc=new Map();
roots.forEach(r=>{ const sub=new Set(); collectSubtree(r,sub); const map=new Map(); [...sub].forEach(h=>map.set(h,genHash()));
[...sub].forEach(h=>{ const nh=map.get(h); allNew.push(nh); const n=OBJ.get(h);
desiredWorlds.set(nh,worldMatrix(n)); cloneSrc.set(nh,pickMeshes.get(h)||null); const isRoot=(h===r);
cmd.map.set(h,nh);
specs.push({nh,name:n.name,type:n.type,visible:n.visible,enabled:n.enabled,enableSlot:n.enableSlot,folded:n.folded,
tags:n.tags.map(cloneTag), childrenNew:n.children.map(c=>map.has(c)?map.get(c):c),
parentNew:isRoot?null:(map.has(n.parent)?map.get(n.parent):n.parent), isRoot});
if(isRoot) newRoots.push(nh); }); });
cmd.newRoots=newRoots.slice();
cmd.redo=function(){
specs.forEach(s=>{ OBJ.set(s.nh,{hash:s.nh,name:s.name,type:s.type,parent:null,children:s.childrenNew.slice(),
visible:s.visible,enabled:s.enabled,enableSlot:s.enableSlot,folded:s.folded,tags:s.tags.map(cloneTag),
pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()}); });
specs.forEach(s=>{ OBJ.get(s.nh).parent=s.isRoot?null:s.parentNew; });
specs.forEach(s=>{ const nn=OBJ.get(s.nh); setNodeFromWorld(nn,desiredWorlds.get(s.nh)); });
specs.forEach(s=>setCopiedSplineUndoState(s.nh,false));
specs.forEach(s=>{ const src=cloneSrc.get(s.nh); if(src&&src.isMesh){
const nm=src.clone(); nm.children.slice().forEach(child=>nm.remove(child)); nm.geometry=src.geometry?src.geometry.clone():nm.geometry;
if(src.userData._selectMat){ nm.material=Array.isArray(src.material)?src.material.map(mm=>mm.clone()):(src.material?src.material.clone():nm.material); nm.userData._selectMat=true; }
else nm.material=null;
nm.matrixAutoUpdate=false; nm.renderOrder=LAYER_OBJ; vpState.scene.add(nm); contentThrees.push(nm); registerPickMesh(s.nh,nm); threeOf.set(s.nh,nm);
const nn=OBJ.get(s.nh); nm.matrix.copy(localTmp(nn)); nm.updateMatrixWorld(true); } });
newRoots.forEach(rh=>applyNodeMaterial(rh));
rootOrder=rootOrder.filter(c=>!newRoots.includes(c)); rootOrder=[...newRoots, ...rootOrder]; };
cmd.undo=function(){
allNew.forEach(h=>{setCopiedSplineUndoState(h,true);const m=pickMeshes.get(h); if(m){ const idx=contentThrees.indexOf(m); if(idx>=0)contentThrees.splice(idx,1);
if(m.parent)m.parent.remove(m); else vpState.scene.remove(m);
disposeObjThrees(m);
pickMeshes.delete(h); meshToHash.delete(m); threeOf.delete(h); } OBJ.delete(h); });
rootOrder=rootOrder.filter(c=>!allNew.includes(c)); };
return cmd; }
function cmdMoveTags(ids,over){ const nodesAffected=new Set([...ids.map(x=>x.h),over.h]);
const snap=[...nodesAffected].map(h=>({h,tags:OBJ.get(h).tags.map(cloneTag)}));
return { redo(){ const byNode=new Map(); ids.forEach(x=>{ if(!byNode.has(x.h))byNode.set(x.h,[]); byNode.get(x.h).push(x.i); });
const taken=[]; byNode.forEach((arr,h)=>{ const tg=OBJ.get(h).tags; arr.slice().sort((a,b)=>a-b).forEach(i=>taken.push({h,t:tg[i]})); arr.sort((a,b)=>b-a).forEach(i=>tg.splice(i,1)); });
const dest=OBJ.get(over.h).tags; let at=Math.min(over.i,dest.length); dest.splice(at,0,...taken.map(x=>x.t)); },
undo(){ snap.forEach(s=>{ OBJ.get(s.h).tags=s.tags; }); } }; }
function cmdCopyTags(ids,over){ const taken=ids.map(x=>cloneTag(OBJ.get(x.h).tags[x.i]));
const snap={h:over.h,tags:OBJ.get(over.h).tags.map(cloneTag)};
return { redo(){ const dest=OBJ.get(over.h).tags; let at=Math.min(over.i,dest.length); dest.splice(at,0,...taken); },
undo(){ OBJ.get(over.h).tags=snap.tags; } }; }
function cmdDeleteTags(ids){ const parsed=ids.map(id=>{ const k=id.lastIndexOf(':'); return {h:id.slice(0,k),i:+id.slice(k+1)}; });
const nodesAffected=new Set(parsed.map(p=>p.h));
const snap=[...nodesAffected].map(h=>({h,tags:OBJ.get(h).tags.map(cloneTag)}));
return { redo(){ const byNode=new Map(); parsed.forEach(p=>{ if(!byNode.has(p.h))byNode.set(p.h,[]); byNode.get(p.h).push(p.i); });
byNode.forEach((arr,h)=>{ arr.sort((a,b)=>b-a); const tg=OBJ.get(h).tags; arr.forEach(i=>tg.splice(i,1)); }); },
undo(){ snap.forEach(s=>{ OBJ.get(s.h).tags=s.tags; }); } }; }
/* --------------------------- сериализация ---------------------------- */
const HSH={ all:'b8a4755d5309d591a5331571e7ec726f', name:'a1b2c3d4e5f60718293a4b5c6d7e8f90',
type:'1f2e3d4c5b6a79880716253443526170', tr:'9a8b7c6d5e4f30211223344556677889',
pv:'7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
par:'55aa55aa55aa55aa55aa55aa55aa55aa', ch:'aa55aa55aa55aa55aa55aa55aa55aa55',
geo:'1234567890abcdef1234567890abcdef', sel:'abcdef1234567890abcdef1234567890' };
const K_VIS='1111111111111111111111111111111a', K_ENA='1111111111111111111111111111111b',
K_FOLD='1111111111111111111111111111111c', K_TAGS='1111111111111111111111111111111d',
K_SLOT='1111111111111111111111111111111e';
const K_MATALL='22222222222222222222222222222222', K_MATNAME='2222222222222222222222222222222a',
K_MATPAR='2222222222222222222222222222222b', K_MATTEX='2222222222222222222222222222222c',
K_MATDEF='2222222222222222222222222222222d', K_MATMIME='2222222222222222222222222222222e',
K_MATFRAME='2222222222222222222222222222222f', K_MATPIVOT='22222222222222222222222222222230';
const K_ROOTS='33333333333333333333333333333333';
const ZERO='00000000000000000000000000000000';
const TYP={UINT8:0,INT8:1,FP32:2,UTF8:3,I64x2:4};
const hex16=h=>{const b=new Uint8Array(16);for(let i=0;i<16;i++)b[i]=parseInt(h.substr(i*2,2),16);return b;};
const xor16=(a,b)=>{const r=new Uint8Array(16);for(let i=0;i<16;i++)r[i]=a[i]^b[i];return r;};
const hx=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
const encUTF8=s=>new TextEncoder().encode(s);
const decUTF8=d=>new TextDecoder().decode(d);
const encI8=v=>new Uint8Array(new Int8Array([v]).buffer);
function encF32(a){const b=new ArrayBuffer(a.length*4),d=new DataView(b);for(let i=0;i<a.length;i++)d.setFloat32(i*4,a[i],true);return new Uint8Array(b);}
function decF32(data){const d=new DataView(data.buffer,data.byteOffset,data.byteLength);const n=data.length/4,o=new Array(n);for(let i=0;i<n;i++)o[i]=d.getFloat32(i*4,true);return o;}
const encHashes=arr=>{const o=new Uint8Array(arr.length*16);arr.forEach((h,i)=>o.set(hex16(h),i*16));return o;};
function packGeom(pos,idx){const vc=pos.length/3,ic=idx.length,b=new ArrayBuffer(8+vc*12+ic*4),d=new DataView(b);
d.setUint32(0,vc,true);d.setUint32(4,ic,true);
for(let i=0;i<vc*3;i++)d.setFloat32(8+i*4,pos[i],true);
for(let i=0;i<ic;i++)d.setUint32(8+vc*12+i*4,idx[i],true);return new Uint8Array(b);}
function parseGeom(data){const d=new DataView(data.buffer,data.byteOffset,data.byteLength);
const vc=d.getUint32(0,true),ic=d.getUint32(4,true),pos=new Float32Array(vc*3),idx=new Uint32Array(ic);
for(let i=0;i<vc*3;i++)pos[i]=d.getFloat32(8+i*4,true);
for(let i=0;i<ic;i++)idx[i]=d.getUint32(8+vc*12+i*4,true);return {positions:pos,indices:idx};}
function packSelects(sels){let n=4;for(const s of sels)n+=12+4+s.polys.length*4;
const b=new ArrayBuffer(n),d=new DataView(b);let o=0;d.setUint32(o,sels.length,true);o+=4;
for(const s of sels){d.setFloat32(o,s.color[0],true);d.setFloat32(o+4,s.color[1],true);d.setFloat32(o+8,s.color[2],true);o+=12;
d.setUint32(o,s.polys.length,true);o+=4;for(const p of s.polys){d.setUint32(o,p,true);o+=4;}}return new Uint8Array(b);}
function parseSelects(data){const d=new DataView(data.buffer,data.byteOffset,data.byteLength);let o=0;
const cnt=d.getUint32(o,true);o+=4;const out=[];
for(let i=0;i<cnt;i++){const c=[d.getFloat32(o,true),d.getFloat32(o+4,true),d.getFloat32(o+8,true)];o+=12;
const pc=d.getUint32(o,true);o+=4;const polys=[];for(let j=0;j<pc;j++){polys.push(d.getUint32(o,true));o+=4;}out.push({color:c,polys});}return out;}
function packTags(tags){const encoded=new Map(tags.filter(t=>t.type===2).map(t=>[t,encUTF8(JSON.stringify({id:t.id||'',domain:t.domain||'vertex',targets:t.targets||[],profile:t.profile||'round',radius:+t.radius||0,shelfA:+t.shelfA||0,shelfB:+t.shelfB||0}))])),n=4+tags.reduce((sum,t)=>sum+17+(Array.isArray(t.polys)?4+t.polys.length*4:0)+(t.type===1?128:0)+(t.type===2?4+encoded.get(t).length:0),0), b=new ArrayBuffer(n), d=new DataView(b);
d.setUint32(0,tags.length,true); let o=4;
for(const t of tags){ const hasPolys=Array.isArray(t.polys); d.setInt8(o,(t.type|0)|(hasPolys?0x40:0)); o+=1; const rb=hex16(t.ref||ZERO); for(let i=0;i<16;i++)d.setUint8(o+i,rb[i]); o+=16; if(hasPolys){ d.setUint32(o,t.polys.length,true);o+=4;for(const fi of t.polys){d.setUint32(o,fi,true);o+=4;} } if(t.type===1){ensureTagFrame(t); for(let i=0;i<16;i++)d.setFloat32(o+i*4,t.mapFrame.elements[i],true);o+=64;for(let i=0;i<16;i++)d.setFloat32(o+i*4,t.mapPivot.elements[i],true);o+=64;}else if(t.type===2){const bytes=encoded.get(t);d.setUint32(o,bytes.length,true);o+=4;new Uint8Array(b,o,bytes.length).set(bytes);o+=bytes.length;} }
return new Uint8Array(b); }
function parseTags(data){ const d=new DataView(data.buffer,data.byteOffset,data.byteLength);
const cnt=d.getUint32(0,true); const out=[]; let o=4;
for(let i=0;i<cnt;i++){ const raw=d.getInt8(o),hasPolys=(raw&0x40)!==0,type=raw&0x3f; o+=1; const ref=hx(new Uint8Array(data.buffer,data.byteOffset+o,16)); o+=16; let polys=null;if(hasPolys){const n=d.getUint32(o,true);o+=4;polys=[];for(let j=0;j<n;j++){polys.push(d.getUint32(o,true));o+=4;}}
const tag={type,ref:ref===ZERO?null:ref,polys}; if(type===1&&o+128<=data.length){tag.mapFrame=new THREE.Matrix4();tag.mapPivot=new THREE.Matrix4();for(let j=0;j<16;j++)tag.mapFrame.elements[j]=d.getFloat32(o+j*4,true);o+=64;for(let j=0;j<16;j++)tag.mapPivot.elements[j]=d.getFloat32(o+j*4,true);o+=64;}else if(type===2&&o+4<=data.length){const length=d.getUint32(o,true);o+=4;if(o+length<=data.length){try{Object.assign(tag,JSON.parse(decUTF8(new Uint8Array(data.buffer,data.byteOffset+o,length))));}catch{}o+=length;}} out.push(tag); }
return out; }
function rec(id,key,data){const hdr=new ArrayBuffer(26),d=new DataView(hdr);
d.setUint16(0,id,true);for(let i=0;i<16;i++)d.setUint8(2+i,key[i]);d.setBigUint64(18,BigInt(data.length),true);
const o=new Uint8Array(26+data.length);o.set(new Uint8Array(hdr),0);o.set(data,26);return o;}
function packTR(n){ const e=n.lin.elements; return [e[0],e[1],e[2],e[4],e[5],e[6],e[8],e[9],e[10],n.pos.x,n.pos.y,n.pos.z]; }
function packPivot(n){ const e=n.pivot.elements; return [e[0],e[1],e[2],e[4],e[5],e[6],e[8],e[9],e[10],e[12],e[13],e[14]]; }
function isIdentityPivot(n){ const e=n.pivot.elements;
return Math.abs(e[0]-1)<1e-6&&Math.abs(e[5]-1)<1e-6&&Math.abs(e[10]-1)<1e-6&&Math.abs(e[15]-1)<1e-6&&
Math.abs(e[1])<1e-6&&Math.abs(e[2])<1e-6&&Math.abs(e[4])<1e-6&&Math.abs(e[6])<1e-6&&Math.abs(e[8])<1e-6&&Math.abs(e[9])<1e-6&&
Math.abs(e[12])<1e-6&&Math.abs(e[13])<1e-6&&Math.abs(e[14])<1e-6; }
function buildRecords(){
const R=[];
R.push(rec(TYP.I64x2, hex16(HSH.all), encHashes([...OBJ.keys()])));
R.push(rec(TYP.I64x2, hex16(K_ROOTS), encHashes(rootOrder)));
R.push(rec(TYP.I64x2, hex16(K_MATALL), encHashes([...MATS.keys()])));
for(const [mh,mat] of MATS){ const ob=hex16(mh);
R.push(rec(TYP.UTF8, xor16(ob,hex16(K_MATNAME)), encUTF8(mat.name)));
R.push(rec(TYP.FP32, xor16(ob,hex16(K_MATPAR)), encF32([mat.h,mat.s,mat.l,mat.emm,mat.rough,mat.metal,mat.opac,mat.bump])));
R.push(rec(TYP.FP32, xor16(ob,hex16(K_MATFRAME)), encF32((mat.mapFrame||defaultMapFrame()).elements)));
if(mat.mapPivot) R.push(rec(TYP.FP32, xor16(ob,hex16(K_MATPIVOT)), encF32(mat.mapPivot.elements)));
R.push(rec(TYP.INT8, xor16(ob,hex16(K_MATDEF)), encI8(mat.isDefault?1:0)));
if(mat.texBytes&&mat.texBytes.length){
R.push(rec(TYP.UINT8, xor16(ob,hex16(K_MATTEX)), mat.texBytes));
R.push(rec(TYP.UTF8, xor16(ob,hex16(K_MATMIME)), encUTF8(mat.texMime||'image/jpeg'))); } }
for(const [hex,n] of OBJ){ const ob=hex16(hex);
R.push(rec(TYP.UTF8, xor16(ob,hex16(HSH.name)), encUTF8(n.name)));
R.push(rec(TYP.INT8, xor16(ob,hex16(HSH.type)), encI8(n.type)));
R.push(rec(TYP.FP32, xor16(ob,hex16(HSH.tr)), encF32(packTR(n))));
if(!isIdentityPivot(n)) R.push(rec(TYP.FP32, xor16(ob,hex16(HSH.pv)), encF32(packPivot(n))));
R.push(rec(TYP.I64x2, xor16(ob,hex16(HSH.par)), encHashes([n.parent||ZERO])));
R.push(rec(TYP.I64x2, xor16(ob,hex16(HSH.ch)), encHashes(n.children)));
R.push(rec(TYP.INT8, xor16(ob,hex16(K_VIS)), encI8(n.visible?1:0)));
R.push(rec(TYP.INT8, xor16(ob,hex16(K_ENA)), encI8(n.enabled?1:0)));
R.push(rec(TYP.INT8, xor16(ob,hex16(K_SLOT)), encI8(n.enableSlot?1:0)));
R.push(rec(TYP.INT8, xor16(ob,hex16(K_FOLD)), encI8(n.folded?1:0)));
if(n.tags.length) R.push(rec(TYP.UINT8, xor16(ob,hex16(K_TAGS)), packTags(n.tags)));
const so=sceneObjects.get(hex), mesh=pickMeshes.get(hex), geo=(mesh&&mesh.geometry)||(so&&so.geom);
if(geo&&geo.attributes&&geo.attributes.position&&geo.index) R.push(rec(TYP.UINT8, xor16(ob,hex16(HSH.geo)), packGeom(geo.attributes.position.array,geo.index.array)));
if(so&&so.selects&&so.selects.length) R.push(rec(TYP.UINT8, xor16(ob,hex16(HSH.sel)), packSelects(so.selects))); }
return R; }
function buildHashBlob(){ return new Blob(buildRecords(),{type:'application/octet-stream'}); }
function parseFile(bytes){ const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), map=new Map(); let off=0;
while(off+26<=bytes.length){ const id=dv.getUint16(off,true); const key=bytes.slice(off+2,off+18);
const len=Number(dv.getBigUint64(off+18,true)); const data=bytes.slice(off+26,off+26+len); map.set(hx(key),{id,data}); off+=26+len; }
return map; }
let _matReadyCb=null;
function onMatReady(cb){ _matReadyCb=cb; }
function texBytesToImage(bytes,mime,cb){ const blob=new Blob([bytes],{type:mime||'image/jpeg'});
const url=URL.createObjectURL(blob); const im=new Image();
im.onload=()=>{ URL.revokeObjectURL(url); cb(im); };
im.onerror=()=>URL.revokeObjectURL(url); im.src=url; }
function applyTR(n,tr){ const e=n.lin.elements; e[0]=tr[0];e[1]=tr[1];e[2]=tr[2];e[3]=0;e[4]=tr[3];e[5]=tr[4];e[6]=tr[5];e[7]=0;e[8]=tr[6];e[9]=tr[7];e[10]=tr[8];e[11]=0;e[12]=0;e[13]=0;e[14]=0;e[15]=1; n.pos.set(tr[9],tr[10],tr[11]); }
function applyPivot(n,tr){ const e=n.pivot.elements; e[0]=tr[0];e[1]=tr[1];e[2]=tr[2];e[3]=0;e[4]=tr[3];e[5]=tr[4];e[6]=tr[5];e[7]=0;e[8]=tr[6];e[9]=tr[7];e[10]=tr[8];e[11]=0;e[12]=tr[9];e[13]=tr[10];e[14]=tr[11];e[15]=1; }
function rebuildFromBytes(bytes){
clearHistory();clearContent(); disposeThreeMats(); OBJ.clear(); rootOrder=[]; MATS.clear(); defaultMatHash=null;
const map=parseFile(bytes);
const matAll=map.get(K_MATALL);
if(matAll){ const ad=matAll.data, n=ad.length/16;
for(let i=0;i<n;i++){ const mh=hx(ad.slice(i*16,i*16+16)); const ob=hex16(mh);
const g=k=>map.get(hx(xor16(ob,hex16(k))));
const nameR=g(K_MATNAME), parR=g(K_MATPAR), defR=g(K_MATDEF), texR=g(K_MATTEX), mimeR=g(K_MATMIME), frameR=g(K_MATFRAME), pivotR=g(K_MATPIVOT);
const name=nameR?decUTF8(nameR.data):'material';
const par=parR?new DataView(parR.data.buffer,parR.data.byteOffset,parR.data.byteLength):null;
const p=par?[par.getFloat32(0,true),par.getFloat32(4,true),par.getFloat32(8,true),par.getFloat32(12,true),par.getFloat32(16,true),par.getFloat32(20,true),par.getFloat32(24,true),par.getFloat32(28,true)]:[0,0,80,0,50,0,0,0];
const isDef=defR?new Int8Array(defR.data.buffer,defR.data.byteOffset,1)[0]===1:false;
const texBytes=texR?new Uint8Array(texR.data):null;
const texMime=mimeR?decUTF8(mimeR.data):null;
const mapFrame=frameR&&frameR.data.length>=64?new THREE.Matrix4().fromArray(decF32(frameR.data)):defaultMapFrame();
const mapPivot=pivotR&&pivotR.data.length>=64?new THREE.Matrix4().fromArray(decF32(pivotR.data)):new THREE.Matrix4();
const mat={name,h:p[0],s:p[1],l:p[2],emm:p[3],rough:p[4],metal:p[5],opac:p[6],bump:p[7],map:null,texBytes,texMime,isDefault:isDef,mapFrame,mapPivot};
MATS.set(mh,mat); if(isDef) defaultMatHash=mh;
if(texBytes){ const mm=mh; texBytesToImage(texBytes,texMime,im=>{ const m=MATS.get(mm); if(!m)return; m.map=im; syncThreeMat(mm); scheduleRender(); if(_matReadyCb)_matReadyCb(mm); }); } } }
if(!defaultMatHash) createDefaultMat();
const allRec=map.get(HSH.all);
if(allRec){ const ad=allRec.data, n=ad.length/16;
for(let i=0;i<n;i++){ const hex=hx(ad.slice(i*16,i*16+16)); const ob=hex16(hex);
const g=k=>map.get(hx(xor16(ob,hex16(k))));
const name=decUTF8(g(HSH.name).data);
const type=new Int8Array(g(HSH.type).data.buffer,g(HSH.type).data.byteOffset,1)[0];
const td=new DataView(g(HSH.tr).data.buffer,g(HSH.tr).data.byteOffset,g(HSH.tr).data.byteLength);
const tr=[]; for(let j=0;j<12;j++)tr.push(td.getFloat32(j*4,true));
const pd=g(HSH.par).data; const parHex=hx(pd.slice(0,16)); const parent=parHex===ZERO?null:parHex;
const cd=g(HSH.ch).data; const cn=cd.length/16, children=[]; for(let j=0;j<cn;j++)children.push(hx(cd.slice(j*16,j*16+16)));
const visR=g(K_VIS), enaR=g(K_ENA), slotR=g(K_SLOT), foldR=g(K_FOLD), tagsR=g(K_TAGS), pvR=g(HSH.pv);
const visible=visR?new Int8Array(visR.data.buffer,visR.data.byteOffset,1)[0]===1:true;
const enabled=enaR?new Int8Array(enaR.data.buffer,enaR.data.byteOffset,1)[0]===1:true;
const enableSlot=slotR?new Int8Array(slotR.data.buffer,slotR.data.byteOffset,1)[0]===1:false;
const folded=foldR?new Int8Array(foldR.data.buffer,foldR.data.byteOffset,1)[0]===1:false;
const tags=tagsR?parseTags(tagsR.data):[];
const node={hash:hex,name,type,parent,children:children.slice(),visible,enabled,enableSlot,tags,folded,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};
applyTR(node,tr); if(pvR){ const pv=new DataView(pvR.data.buffer,pvR.data.byteOffset,pvR.data.byteLength); const pa=[]; for(let j=0;j<12;j++)pa.push(pv.getFloat32(j*4,true)); applyPivot(node,pa); }
OBJ.set(hex,node);
const geoR=g(HSH.geo), selR=g(HSH.sel);
if(geoR){ const geom=parseGeom(geoR.data); const selects=selR?parseSelects(selR.data):null;
sceneObjects.set(hex,{hash:hex,name,type,parent,children,pos:node.pos,lin:node.lin,geom,selects,three:null}); } }
const rootsRec=map.get(K_ROOTS);
if(rootsRec){ const rd=rootsRec.data, rn=rd.length/16; rootOrder=[];
for(let i=0;i<rn;i++){ const hh=hx(rd.slice(i*16,i*16+16)); if(OBJ.has(hh)) rootOrder.push(hh); }
for(const hex of OBJ.keys()){ const nn=OBJ.get(hex); if((!nn.parent||!OBJ.has(nn.parent))&&!rootOrder.includes(hex)) rootOrder.push(hex); } }
else { for(const hex of OBJ.keys()){ const nn=OBJ.get(hex); if(!nn.parent||!OBJ.has(nn.parent)) rootOrder.push(hex); } } }
buildSceneFromObjects(); }
function clearScene(){ stopVertexModeTool();disableSoftSelection(false);clearHistory();clearContent(); disposeThreeMats(); OBJ.clear(); rootOrder=[]; MATS.clear(); defaultMatHash=null; }
function buildRenderMesh(obj){
const g=new THREE.BufferGeometry();
g.setAttribute('position',new THREE.BufferAttribute(obj.geom.positions.slice(),3));
g.setIndex(new THREE.BufferAttribute(obj.geom.indices.slice(),1));
g.computeVertexNormals();
g.computeBoundingBox(); { const p=g.attributes.position,bb=g.boundingBox,dx=Math.max(1e-9,bb.max.x-bb.min.x),dz=Math.max(1e-9,bb.max.z-bb.min.z),uv=new Float32Array(p.count*2); for(let i=0;i<p.count;i++){uv[i*2]=(p.getX(i)-bb.min.x)/dx;uv[i*2+1]=(p.getZ(i)-bb.min.z)/dz;} g.setAttribute('uv',new THREE.BufferAttribute(uv,2)); }
let mat,geo=g;
if(obj.selects&&obj.selects.length>1){
const pos=g.attributes.position.array, idx=g.index.array, triCount=idx.length/3;
const triColor=new Array(triCount); for(let t=0;t<triCount;t++)triColor[t]=[.5,.5,.5];
for(const s of obj.selects)for(const t of s.polys)if(t<triCount)triColor[t]=s.color;
const np=new Float32Array(triCount*9), nc=new Float32Array(triCount*9);
for(let t=0;t<triCount;t++){const c=triColor[t];for(let v=0;v<3;v++){const vi=idx[t*3+v];
np[t*9+v*3]=pos[vi*3];np[t*9+v*3+1]=pos[vi*3+1];np[t*9+v*3+2]=pos[vi*3+2];
nc[t*9+v*3]=c[0];nc[t*9+v*3+1]=c[1];nc[t*9+v*3+2]=c[2];}}
geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(np,3)); geo.setAttribute('color',new THREE.BufferAttribute(nc,3));
mat=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});
} else { const c=obj.selects&&obj.selects[0]?obj.selects[0].color:[.7,.7,.7];
mat=new THREE.MeshBasicMaterial({color:new THREE.Color(c[0],c[1],c[2]),side:THREE.DoubleSide}); }
const mesh=new THREE.Mesh(geo,mat); mesh.matrixAutoUpdate=false; mesh.renderOrder=LAYER_OBJ;
if(obj.selects&&obj.selects.length) mesh.userData._selectMat=true;
return mesh; }
function buildCreaseGeometry(src){
const pos=src.attributes.position,idx=src.index,faces=idx?idx.count/3:pos.count/3,fn=new Array(faces),byVertex=new Map();
const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
for(let f=0;f<faces;f++){ const ids=[idx?idx.getX(f*3):f*3,idx?idx.getX(f*3+1):f*3+1,idx?idx.getX(f*3+2):f*3+2]; a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]); fn[f]=ab.subVectors(b,a).cross(ac.subVectors(c,a)).normalize().clone(); ids.forEach(v=>{let q=byVertex.get(v);if(!q)byVertex.set(v,q=[]);q.push(f);}); }
const outP=[],outN=[],outUv=[],outI=[],uv=src.attributes.uv,keys=new Map();
for(let f=0;f<faces;f++)for(let k=0;k<3;k++){ const v=idx?idx.getX(f*3+k):f*3+k,adj=byVertex.get(v)||[f]; let nx=0,ny=0,nz=0; for(const q of adj)if(fn[f].dot(fn[q])>=CREASE_COS){nx+=fn[q].x;ny+=fn[q].y;nz+=fn[q].z;} const l=Math.hypot(nx,ny,nz)||1; nx/=l;ny/=l;nz/=l; const key=v+':'+nx.toFixed(5)+':'+ny.toFixed(5)+':'+nz.toFixed(5); let oi=keys.get(key); if(oi===undefined){oi=outP.length/3;keys.set(key,oi);outP.push(pos.getX(v),pos.getY(v),pos.getZ(v));outN.push(nx,ny,nz);if(uv)outUv.push(uv.getX(v),uv.getY(v));} outI.push(oi); }
const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(outP,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(outN,3));if(uv)g.setAttribute('uv',new THREE.Float32BufferAttribute(outUv,2));g.setIndex(outI);g.computeBoundingBox();return g;
}
function normalizeCreaseTopology(mesh){
if(!mesh||!mesh.geometry)return; const g=mesh.geometry,pos=g.attributes.position,idx=g.index,faces=idx?idx.count/3:pos.count/3;if(!pos||!faces)return;
const normals=[],valid=[],groups=new Map(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
for(let f=0;f<faces;f++){const ids=[idx?idx.getX(f*3):f*3,idx?idx.getX(f*3+1):f*3+1,idx?idx.getX(f*3+2):f*3+2];a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]);const n=ab.subVectors(b,a).cross(ac.subVectors(c,a));if(n.lengthSq()<1e-16)continue;normals[f]=n.normalize().clone();valid.push(f);for(const v of ids){const key=pos.getX(v).toFixed(5)+','+pos.getY(v).toFixed(5)+','+pos.getZ(v).toFixed(5);let q=groups.get(key);if(!q)groups.set(key,q=[]);if(!q.includes(f))q.push(f);}}
const outP=[],outI=[],outUv=[],map=new Map(),remap=new Map(),uv=g.attributes.uv;
const mats=[];for(const f of valid){mats.push(triangleMaterialIndex(g,f));for(let k=0;k<3;k++){const v=idx?idx.getX(f*3+k):f*3+k,key=pos.getX(v).toFixed(5)+','+pos.getY(v).toFixed(5)+','+pos.getZ(v).toFixed(5),adj=groups.get(key)||[f];let nx=0,ny=0,nz=0;for(const q of adj)if(normals[f].dot(normals[q])>=CREASE_COS){nx+=normals[q].x;ny+=normals[q].y;nz+=normals[q].z;}const l=Math.hypot(nx,ny,nz)||1,nk=key+'|'+(nx/l).toFixed(5)+','+(ny/l).toFixed(5)+','+(nz/l).toFixed(5);let oi=map.get(nk);if(oi===undefined){oi=outP.length/3;map.set(nk,oi);outP.push(pos.getX(v),pos.getY(v),pos.getZ(v));if(uv)outUv.push(uv.getX(v),uv.getY(v));}let rs=remap.get(v);if(!rs)remap.set(v,rs=new Set());rs.add(oi);outI.push(oi);}}
const ng=new THREE.BufferGeometry();ng.userData={...g.userData};ng.setAttribute('position',new THREE.Float32BufferAttribute(outP,3));ng.setIndex(outI);if(uv)ng.setAttribute('uv',new THREE.Float32BufferAttribute(outUv,2));ng.computeVertexNormals();let last=null,start=0;for(let i=0;i<mats.length;i++){if(last===null){last=mats[i];start=i*3;}else if(last!==mats[i]){ng.addGroup(start,i*3-start,last);last=mats[i];start=i*3;}}if(last!==null)ng.addGroup(start,outI.length-start,last);ng.computeBoundingBox();mesh.geometry=ng;g.dispose();return remap;
}
function initCreaseRender(mesh){ normalizeCreaseTopology(mesh); }
function rebuildCreaseRender(mesh){ return normalizeCreaseTopology(mesh); }
function setCreaseDisplay(){ }
function buildSceneFromObjects(){
for(const [hash,obj] of sceneObjects){
obj.three=obj.type===1&&obj.geom?buildRenderMesh(obj):new THREE.Object3D();
obj.three.matrixAutoUpdate=false;
_ltmp.copy(obj.lin); _ltmp.elements[12]=obj.pos.x;_ltmp.elements[13]=obj.pos.y;_ltmp.elements[14]=obj.pos.z;
obj.three.matrix.copy(_ltmp); contentThrees.push(obj.three); threeOf.set(hash,obj.three);
if(obj.type===1&&obj.three.isMesh){ initCreaseRender(obj.three); registerPickMesh(hash,obj.three); } }
for(const [,obj] of sceneObjects){ const p=obj.parent&&sceneObjects.get(obj.parent); if(p&&p.three) p.three.add(obj.three); else vpState.scene.add(obj.three); }
for(const h of rootOrder){ const o=sceneObjects.get(h); if(o&&o.three) o.three.updateMatrixWorld(true); }
for(const [hash,obj] of sceneObjects){ if(obj.three&&obj.three.isMesh&&!obj.three.userData._selectMat) assignMeshMat(obj.three,hash); } }
function clearContent(){ clearReplicaOutputs(); for(const t of contentThrees){ disposeObjThrees(t); if(t.parent)t.parent.remove(t); }
contentThrees=[]; sceneObjects.clear(); pickMeshes.clear(); meshToHash.clear(); threeOf.clear();splineVisuals.clear();splineData.clear();splineSelection.vertices.clear();splineSelection.handles.clear();splineSelection.segments.clear();splineSelection.active=null;splineSelection.anchor=null;splineSelection.pivot=null;splineMode=false;splineDrawing=false;splineDrawSequence=null;splineLastVertex=null;splineDrawHistory=[];splineCtrlSequence=null;splineCtrlLastVertex=null;splineWorkPlane=null;clearSplineHover();
clearPolyHover();for(const [,o] of wireOverlays){o.parent?.remove(o);if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();}wireOverlays.clear();
for(const [,o] of polyPointOverlays){o.parent?.remove(o);if(o.material)o.material.dispose();}polyPointOverlays.clear();
for(const [,o] of creaseOverlays){o.parent?.remove(o);if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();}creaseOverlays.clear();evaluatedSplineCache.clear();
brackets.visible=false; brackets.has=false; brackets.fading=false; }
/* ============================ вьюпорт / 3D =========================== */
const vpState={ renderer:null, scene:null, perspCam:null, views:null, singleView:0, mode:'single',
W:0,H:0,halfW:0,halfH:0,fullRect:null,quadRects:null, container:null, perspGrid:null,
hudScene:null,hudCam:null,overlayScene:null,overlayCam:null,overlayGeo:null,orthoGridObjs:null };
let _raf=0;const renderPerformance={frames:0,totalMilliseconds:0,lastMilliseconds:0,maxMilliseconds:0};
function scheduleRender(){ if(!_raf){ _raf=requestAnimationFrame(()=>{ _raf=0; render(); }); } }
function render(){ const {renderer,views,singleView,mode,fullRect,quadRects,W,H}=vpState; if(!renderer)return;const renderStarted=performance.now();
quantRotateHudRings.forEach(ring=>ring.visible=false);
for(const [h,t] of threeOf){ t.visible=effectiveVisible(h); }
for(const [h,state] of replicaStates)if(state.mesh)state.mesh.visible=!!(OBJ.get(h)?.enabled&&state.ready&&effectiveVisible(h));
if(brackets.fading){ const t=(performance.now()-brackets.fadeStart)/BRACKET_FADE_MS; brackets.opacity=1-t; if(brackets.opacity<=0){ brackets.opacity=0; brackets.visible=false; brackets.fading=false; } }
renderer.setScissorTest(false); renderer.setClearColor(BG,1); renderer.clear(true,true,true);
renderer.setScissorTest(true);
if(mode==='single') renderView(views[singleView],fullRect,singleView); else for(let i=0;i<4;i++) renderView(views[i],quadRects[i],i);
renderer.setScissorTest(false); renderer.setViewport(0,0,W,H);
renderer.render(vpState.hudScene,vpState.hudCam);
if(mode==='quad') renderer.render(vpState.overlayScene,vpState.overlayCam);const elapsed=performance.now()-renderStarted;renderPerformance.frames++;renderPerformance.totalMilliseconds+=elapsed;renderPerformance.lastMilliseconds=elapsed;renderPerformance.maxMilliseconds=Math.max(renderPerformance.maxMilliseconds,elapsed); }
const _cdV=new THREE.Vector3(), _cdD=new THREE.Vector3();
function computeSceneDepthRange(cam,view){
cam.getWorldDirection(_cdD);
let minD=Infinity, maxD=-Infinity, any=false;
const point=(p)=>{ _cdV.copy(p).sub(cam.position); const d=_cdV.dot(_cdD); if(d<minD)minD=d; if(d>maxD)maxD=d; any=true; };
const consider=(mw,bb)=>{ const xs=[bb.min.x,bb.max.x],ys=[bb.min.y,bb.max.y],zs=[bb.min.z,bb.max.z];
for(const x of xs)for(const y of ys)for(const z of zs){ _cdV.set(x,y,z).applyMatrix4(mw).sub(cam.position); const d=_cdV.dot(_cdD); if(d<minD)minD=d; if(d>maxD)maxD=d; any=true; } };
for(const [,mesh] of pickMeshes){ const g=mesh.geometry; if(!g.boundingBox)g.computeBoundingBox(); const bb=g.boundingBox; if(!bb||bb.isEmpty())continue; mesh.updateMatrixWorld(true); consider(mesh.matrixWorld,bb); }
point(gizmo.pos);
if(view && view.type!=='persp'){ const gd=-cam.position.dot(_cdD); if(gd<minD)minD=gd; if(gd>maxD)maxD=gd; any=true; point(ORIGIN0); }
else if(view && view.type==='persp' && vpState.perspGrid){ const cs=vpState.perspGrid._corners; for(let i=0;i<4;i++){ _cdV.copy(cs[i]).sub(cam.position); const d=_cdV.dot(_cdD); if(d<minD)minD=d; if(d>maxD)maxD=d; any=true; } }
if(!any) return null;
return {minD,maxD};
}
function renderView(view,r,vi){ if(!r)return; const {renderer}=vpState; const cam=view.cam;
for(const [h,t] of threeOf)t.visible=effectiveVisible(h)||splinePatchCageVisible(h,viewShading[vi]);
renderer.setViewport(r.x,vpState.H-r.y-r.h,r.w,r.h); renderer.setScissor(r.x,vpState.H-r.y-r.h,r.w,r.h);
vpState.orthoGridObjs.forEach(g=>g.visible(false));
const polyInThisView=polyHover.view===vi;
if(polyHover.face) polyHover.face.visible=polyInThisView&&polyHover.kind==='face';
if(polyHover.faceBack) polyHover.faceBack.visible=polyInThisView&&polyHover.kind==='face';
if(polyHover.edge) polyHover.edge.visible=polyInThisView&&polyHover.kind==='edge';
if(polyHover.vertex) polyHover.vertex.visible=polyInThisView&&polyHover.kind==='vertex';
const toolInThisView=vertexTools.view===vi;
for(const o of [vertexTools.snapVertex,vertexTools.snapEdge,vertexTools.linePreview,vertexTools.loopPreview])if(o)o.visible=toolInThisView&&!!o.userData.active;
if(vertexTools.softPreview){vertexTools.softPreview.visible=vertexTools.soft.active&&!!vertexTools.softPreview.userData.active;vertexTools.softPreview.material.depthTest=viewShading[vi]!==1;}
if(polySelection.face){const through=viewShading[vi]===1;polySelection.face.material.depthTest=!through;polySelection.faceBack.material.depthTest=!through;}
applyShadingMode(viewShading[vi]||0);
// camera light: активна только лампа камеры текущего вида; яркость общая (атрибут camera в environment)
{ const camInt=envState.cameraIntensity||0;
for(const l of camLamps){ l.intensity=(l.userData._cam===cam)?camInt:0; } }
cam.updateMatrixWorld();
if(view.type==='persp'){ vpState.perspGrid.visible(true); cam.aspect=r.w/r.h;
const range=computeSceneDepthRange(cam,view);
if(range){ const far=Math.max(range.maxD*1.2,1); const step=vpState.perspGrid.step;
cam.far=far; cam.near=Math.max(step*1e-3, far/DEPTH_RATIO, EPS_NEAR); }
cam.updateProjectionMatrix(); }
else { vpState.perspGrid.visible(false); const hH=BASE/view_ctrl_zoom(cam), hW=hH*r.w/r.h; cam.left=-hW;cam.right=hW;cam.top=hH;cam.bottom=-hH;
const range=computeSceneDepthRange(cam,view);
if(range){ const far=Math.max(range.maxD*1.2,1); cam.far=far; cam.near=Math.max(range.minD*0.5, far/DEPTH_RATIO, EPS_NEAR); }
cam.updateProjectionMatrix(); view.grid.update(cam,r); view.grid.visible(true); }
applyGizmo(view,r); drawBrackets(view,r);
if(snapVis) snapVis.visible=_snapVisActive && view.type==='persp';
cam.updateMatrixWorld(); renderer.render(vpState.scene,cam); }
function computeLayout(){ const c=vpState.container; vpState.W=c.clientWidth; vpState.H=c.clientHeight;
vpState.halfW=Math.floor(vpState.W/2); vpState.halfH=Math.floor(vpState.H/2);
vpState.fullRect={x:0,y:0,w:vpState.W,h:vpState.H};
vpState.quadRects=[{x:0,y:0,w:vpState.halfW,h:vpState.halfH},{x:vpState.halfW,y:0,w:vpState.W-vpState.halfW,h:vpState.halfH},
{x:0,y:vpState.halfH,w:vpState.halfW,h:vpState.H-vpState.halfH},{x:vpState.halfW,y:vpState.halfH,w:vpState.W-vpState.halfW,h:vpState.H-vpState.halfH}];
vpState.renderer.setSize(vpState.W,vpState.H); updateOverlay(); scheduleRender(); }
function rectFor(vi){ return vpState.mode==='single'?(vi===vpState.singleView?vpState.fullRect:null):vpState.quadRects[vi]; }
function viewAt(x,y){ if(x<0||y<0||x>vpState.W||y>vpState.H)return -1; if(vpState.mode==='single')return vpState.singleView;
let col,row; if(x<vpState.halfW)col=0; else if(x>vpState.halfW)col=1; else return -1; if(y<vpState.halfH)row=0; else if(y>vpState.halfH)row=1; else return -1; return row*2+col; }
const GCAP=3600;
const _zoomOf=new Map(); function view_ctrl_zoom(cam){ return _zoomOf.get(cam) ?? 1; }
function fill(arr,step,umin,umax,vmin,vmax,u,v){ let i=0;
for(let uu=Math.ceil(umin/step)*step; uu<=umax+1e-9; uu+=step){ if(i>GCAP-6)break; const px=u.x*uu,py=u.y*uu,pz=u.z*uu;
arr[i++]=px+v.x*vmin;arr[i++]=py+v.y*vmin;arr[i++]=pz+v.z*vmin; arr[i++]=px+v.x*vmax;arr[i++]=py+v.y*vmax;arr[i++]=pz+v.z*vmax; }
for(let vv=Math.ceil(vmin/step)*step; vv<=vmax+1e-9; vv+=step){ if(i>GCAP-6)break; const px=v.x*vv,py=v.y*vv,pz=v.z*vv;
arr[i++]=px+u.x*umin;arr[i++]=py+u.y*umin;arr[i++]=pz+u.z*umin; arr[i++]=px+u.x*umax;arr[i++]=py+u.y*umax;arr[i++]=pz+u.z*umax; }
return i/3; }
function makeOrthoGrid(u,v){
const mk=op=>{ const g=new THREE.BufferGeometry(); const pos=new Float32Array(GCAP);
g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
const m=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:ORTHO_LINE,transparent:true,opacity:op,depthWrite:false,depthTest:true}));
m.frustumCulled=false; m.renderOrder=3; vpState.scene.add(m); return {mesh:m,pos}; };
const minor=mk(ORTHO_MINOR_OP), major=mk(ORTHO_MAJOR_OP);
return { visible(s){ major.mesh.visible=s; minor.mesh.visible=s && minor.mesh.geometry.drawRange.count>0; },
update(cam,r){ const hH=BASE/view_ctrl_zoom(cam), hW=hH*r.w/r.h, uC=cam.position.dot(u), vC=cam.position.dot(v);
const umin=uC-hW,umax=uC+hW,vmin=vC-hH,vmax=vC+hH, pw=2*hH/r.h;
const ma=Math.pow(10, Math.ceil(Math.log10(ORTHO_MAJOR_LO*pw))), mi=ma*0.1;
let c=fill(major.pos,ma,umin,umax,vmin,vmax,u,v); major.mesh.geometry.setDrawRange(0,c); major.mesh.geometry.attributes.position.needsUpdate=true;
c=fill(minor.pos,mi,umin,umax,vmin,vmax,u,v); minor.mesh.geometry.setDrawRange(0,c);
minor.mesh.geometry.attributes.position.needsUpdate=true; } }; }
const X=new THREE.Vector3(1,0,0), Y=new THREE.Vector3(0,1,0), Z=new THREE.Vector3(0,0,1);
let perspGridStep=1000;
function setGridStep(step){ perspGridStep=step>0?step:1000; if(vpState.perspGrid){ vpState.perspGrid.rebuild(perspGridStep); scheduleRender(); } }
function makePerspGrid(){ const CAP=PERSP_LINES*2*2*3; const g=new THREE.BufferGeometry();
const pos=new Float32Array(CAP); g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
const m=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:GRID_COL,transparent:true,opacity:0.5,depthWrite:false}));
m.frustumCulled=false; m.renderOrder=0; vpState.scene.add(m);
const obj={mesh:m,step:perspGridStep,_corners:[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()],
visible(s){ this.mesh.visible=s; },
rebuild(step){ this.step=step; const half=5*step; const arr=this.mesh.geometry.attributes.position.array; let i=0;
for(let k=0;k<PERSP_LINES;k++){ const u=-half+k*step; arr[i++]=u;arr[i++]=0;arr[i++]=-half; arr[i++]=u;arr[i++]=0;arr[i++]=half; }
for(let k=0;k<PERSP_LINES;k++){ const v=-half+k*step; arr[i++]=-half;arr[i++]=0;arr[i++]=v; arr[i++]=half;arr[i++]=0;arr[i++]=v; }
this.mesh.geometry.setDrawRange(0,i/3); this.mesh.geometry.attributes.position.needsUpdate=true;
this._corners[0].set(-half,0,-half);this._corners[1].set(half,0,-half);this._corners[2].set(half,0,half);this._corners[3].set(-half,0,half); } };
obj.rebuild(perspGridStep);
return obj; }
/* ------------------------- свет: ENV-риг ----------------------------- */
const camLamps=[];
const envState={hemi:null, inf:null, infTarget:null, mapOn:false, cameraIntensity:1.0};
let envRT=null, envLoading=false;
function loadEnvMap(){ if(envRT||envLoading||!vpState.renderer) return; envLoading=true;
new THREE.TextureLoader().load('env.webp', tex=>{
tex.mapping=THREE.EquirectangularReflectionMapping; tex.colorSpace=THREE.SRGBColorSpace;
const pmrem=new THREE.PMREMGenerator(vpState.renderer);
envRT=pmrem.fromEquirectangular(tex); tex.dispose(); pmrem.dispose(); envLoading=false;
if(envState.mapOn) vpState.scene.environment=envRT.texture;
scheduleRender(); }, undefined, ()=>{ envLoading=false; }); }
function setEnvLighting(p){ const sc=vpState.scene; if(!sc) return;
const q=p?{hemi:+p.hemi||0, infinite:+p.infinite||0, camera:+p.camera||0, map:!!p.map, vAng:+p.vAng||0, hAng:+p.hAng||0}
:{hemi:100, infinite:0, camera:100, map:false, vAng:45, hAng:45};
const hi=q.hemi/100*1.0;
if(hi>0){ if(!envState.hemi) envState.hemi=new THREE.HemisphereLight(0xffffff,0x555555,hi);
envState.hemi.intensity=hi; if(envState.hemi.parent!==sc) sc.add(envState.hemi); }
else if(envState.hemi&&envState.hemi.parent) envState.hemi.parent.remove(envState.hemi);
// camera light: яркость храним глобально; применяем per-view в renderView
envState.cameraIntensity=q.camera/100*1.0;
const ii=q.infinite/100*2.0;
if(ii>0){ if(!envState.inf){ envState.inf=new THREE.DirectionalLight(0xffffff,1);
envState.infTarget=new THREE.Object3D(); sc.add(envState.infTarget); envState.inf.target=envState.infTarget; }
envState.inf.intensity=ii;
const v=q.vAng*D2R, h=q.hAng*D2R;
envState.inf.position.set(Math.cos(v)*Math.sin(h)*1e5, Math.sin(v)*1e5, Math.cos(v)*Math.cos(h)*1e5);
if(envState.inf.parent!==sc) sc.add(envState.inf); }
else if(envState.inf&&envState.inf.parent) envState.inf.parent.remove(envState.inf);
envState.mapOn=q.map;
if(q.map){ if(envRT) sc.environment=envRT.texture; loadEnvMap(); } else sc.environment=null;
scheduleRender(); }
/* контроллеры камер */
const pR=new THREE.Vector3(),pU=new THREE.Vector3(),pV=new THREE.Vector3(),pRayD=new THREE.Vector3(),pA=new THREE.Vector3(),pB=new THREE.Vector3();
const pqY=new THREE.Quaternion(),pqR=new THREE.Quaternion(),pdq=new THREE.Quaternion();
function navigationPick(ray){for(const hit of ray.intersectObjects([...pickMeshes.values()],false)){const h=meshToHash.get(hit.object);if(h&&effectiveVisible(h))return hit.point.clone();}return null;}
class NavPersp{
constructor(c){ this.cam=c; this.handle=new THREE.Vector3(0,0,0); this.zoomAnchor=null;
this.ray=new THREE.Raycaster(); this.ray.near=c.near; this.ray.far=c.far; this.ndc=new THREE.Vector2(); c.lookAt(this.handle); c.updateMatrixWorld(); }
_ndc(e,r){ this.pointerX=e.clientX;this.pointerY=e.clientY;this.ndc.set(((e.clientX-r.x)/r.w)*2-1,-((e.clientY-r.y)/r.h)*2+1); }
_axes(){ const q=this.cam.quaternion; pR.set(1,0,0).applyQuaternion(q); pU.set(0,1,0).applyQuaternion(q); pV.set(0,0,-1).applyQuaternion(q); }
_pick(){ const s=splineScreenHit(this.pointerX,this.pointerY,{editing:false,vertices:true,handles:false,segments:true});if(s)return s.world.clone();this.ray.setFromCamera(this.ndc,this.cam); return navigationPick(this.ray); }
_plane(){ this._axes(); pRayD.set(this.ndc.x,this.ndc.y,0.5).unproject(this.cam).sub(this.cam.position).normalize();
const d=pRayD.dot(pV); if(Math.abs(d)<1e-6)return null; const t=pA.copy(this.handle).sub(this.cam.position).dot(pV)/d; if(t<=0)return null; return this.cam.position.clone().addScaledVector(pRayD,t); }
_dq(dx,dy,sp,rh){ const k=TAU/rh*sp; pqY.setFromAxisAngle(WUP,-dx*k); pqR.setFromAxisAngle(pR,-dy*k); pdq.multiplyQuaternions(pqY,pqR); }
_zoom(rf,anchor){ const C=this.cam.position,H=this.handle,d=C.distanceTo(H); if(d>1e-9) rf=THREE.MathUtils.clamp(rf,MINR/d,MAXR/d); if(Math.abs(rf-1)<1e-6)return;
const Q=anchor?anchor:(this._pick()||this._plane()||H.clone()); const oC=C.clone(),oH=H.clone(); C.copy(Q).addScaledVector(pA.copy(oC).sub(Q),rf); H.copy(Q).addScaledVector(pB.copy(oH).sub(Q),rf); }
down(e,r){ this.zoomAnchor=null;this.cam.updateMatrixWorld(); this._ndc(e,r); const b=e.buttons;
if((b&RMB)&&!(b&LMB)){this.zoomAnchor=this._pick()||this._plane();if(this.zoomAnchor)this.handle.copy(this.zoomAnchor);}else if((b&LMB)&&!(b&RMB)){ const p=this._pick()||this._plane(); if(p) this.handle.copy(p); }else if(b&MMB){const p=this._pick();if(p)this.handle.copy(p);} }
move(e,r,canPan,dx,dy){ const b=e.buttons,C=this.cam.position,H=this.handle; this.cam.updateMatrixWorld(); this._ndc(e,r); this._axes(); const look=(b&LMB)&&(b&RMB);
if(look){ this._dq(dx,dy,LOOK,r.h); pA.copy(H).sub(C).applyQuaternion(pdq); H.copy(C).add(pA); this.cam.quaternion.premultiply(pdq); }
else if((b&LMB)&&!(b&RMB)){ this._dq(dx,dy,ROT,r.h); pA.copy(C).sub(H).applyQuaternion(pdq); C.copy(H).add(pA); this.cam.quaternion.premultiply(pdq); }
else if((b&RMB)&&!(b&LMB)){ const s=(dx-dy)/r.h*DOLLY; const k=THREE.MathUtils.clamp(1-Math.exp(-s),-0.9,0.9); this._zoom(1-k,this.zoomAnchor); }
else if((b&MMB)&&canPan){ const depth=C.distanceTo(H); const k=2*depth*Math.tan(this.cam.fov*Math.PI/360)/r.h*PAN; pA.copy(pR).multiplyScalar(-dx*k).addScaledVector(pU,dy*k); C.add(pA); H.add(pA); }
this.cam.updateMatrixWorld(); }
up(e){ if(!e.buttons) this.zoomAnchor=null; }
wheel(e,r){ e.preventDefault(); this.cam.updateMatrixWorld(); this._ndc(e,r); const k=THREE.MathUtils.clamp(1-Math.exp(e.deltaY*0.003*WHEEL),-0.9,0.9),p=this._pick();if(p)this.handle.copy(p);this._zoom(1-k,p); this.cam.updateMatrixWorld(); }
}
const oR=new THREE.Vector3(),oU=new THREE.Vector3(),oF=new THREE.Vector3(),oA=new THREE.Vector3();
class NavOrtho{
constructor(c){ this.cam=c; this.handle=new THREE.Vector3(0,0,0); this.zoom=1; this.anchor=null; _zoomOf.set(c,1);
this.ray=new THREE.Raycaster(); this.ray.near=c.near; this.ray.far=c.far; this.ndc=new THREE.Vector2(); c.updateMatrixWorld(); }
_ndc(e,r){ this.pointerX=e.clientX;this.pointerY=e.clientY;this.ndc.set(((e.clientX-r.x)/r.w)*2-1,-((e.clientY-r.y)/r.h)*2+1); }
_axes(){ const q=this.cam.quaternion; oR.set(1,0,0).applyQuaternion(q); oU.set(0,1,0).applyQuaternion(q); oF.set(0,0,-1).applyQuaternion(q); }
_half(r){ const hH=BASE/this.zoom; return {hH,hW:hH*r.w/r.h}; }
_pick(){ const s=splineScreenHit(this.pointerX,this.pointerY,{editing:false,vertices:true,handles:false,segments:true});if(s)return s.world.clone();this.ray.setFromCamera(this.ndc,this.cam); return navigationPick(this.ray); }
_plane(r){ this._axes(); const {hH,hW}=this._half(r); const t=oA.copy(this.handle).sub(this.cam.position).dot(oF);
return this.cam.position.clone().addScaledVector(oR,this.ndc.x*hW).addScaledVector(oU,this.ndc.y*hH).addScaledVector(oF,t); }
_zoomTo(nz,aL,bL){ const z0=this.zoom; nz=THREE.MathUtils.clamp(nz,MINZ,MAXZ); if(Math.abs(nz-z0)<1e-9)return; this._axes(); const r=z0/nz, sR=aL*(1-r), sU=bL*(1-r);
this.cam.position.addScaledVector(oR,sR).addScaledVector(oU,sU); this.handle.addScaledVector(oR,sR).addScaledVector(oU,sU); this.zoom=nz; _zoomOf.set(this.cam,nz); }
down(e,r){ this.anchor=null;this.cam.updateMatrixWorld(); this._ndc(e,r); const b=e.buttons; if(b&RMB){this.anchor=this._pick()||this._plane(r);if(this.anchor)this.handle.copy(this.anchor);}else if(b&LMB){ const p=this._pick(); if(p) this.handle.copy(p); }else if(b&MMB){const p=this._pick();if(p)this.handle.copy(p);} }
move(e,r,canPan,dx,dy){ if(!e.buttons)return; this.cam.updateMatrixWorld(); this._ndc(e,r); this._axes(); const b=e.buttons,{hH}=this._half(r);
if((b&RMB)&&!(b&LMB)){ const s=(dx-dy)/r.h*DOLLY, nz=this.zoom*Math.exp(s); const a=oA.copy(this.anchor||this.handle).sub(this.cam.position); this._zoomTo(nz,a.dot(oR),a.dot(oU)); }
else if((b&MMB)&&canPan){ const pw=2*hH/r.h*PAN; oA.copy(oR).multiplyScalar(-dx*pw).addScaledVector(oU,dy*pw); this.cam.position.add(oA); this.handle.add(oA); }
this.cam.updateMatrixWorld(); }
up(e){ if(!e.buttons) this.anchor=null; }
wheel(e,r){ e.preventDefault(); this.cam.updateMatrixWorld(); this._ndc(e,r); const {hH,hW}=this._half(r),p=this._pick();if(p)this.handle.copy(p);const k=THREE.MathUtils.clamp(1-Math.exp(e.deltaY*0.003*WHEEL),-0.9,0.9); this._zoomTo(this.zoom/(1-k),this.ndc.x*hW,this.ndc.y*hH);if(p)this.handle.copy(p);this.cam.updateMatrixWorld(); }
}
/* гизмо */
function GB(idx,pos){ const g=new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3)); g.computeVertexNormals(); return g; }
function Mm(geo,color,side){ const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side,depthTest:false,transparent:true,opacity:0.5})); m.frustumCulled=false; return m; }
const gX=GB([0,1,2,0,2,3,4,5,7,4,7,6],[2,0,0,2,2,0,7,2,0,7,0,0,2,0,0,7,0,0,2,0,2,7,0,2]);
const gY=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,2,0,2,2,0,2,7,0,0,7,0,0,2,0,0,7,0,0,2,2,0,7,2]);
const gZ=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,2,0,2,2,0,2,7,0,0,7,0,0,2,0,0,7,2,0,2,2,0,7]);
const gXY=GB([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6,0,6,7],[2,2,0,7,2,0,6.8,3.3,0,6.3,4.5,0,5.5,5.5,0,4.5,6.3,0,3.3,6.8,0,2,7,0]);
const gXZ=GB([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6,0,6,7],[2,0,2,2,0,7,3.3,0,6.8,4.5,0,6.3,5.5,0,5.5,6.3,0,4.5,6.8,0,3.3,7,0,2]);
const gYZ=GB([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6,0,6,7],[0,2,2,0,7,2,0,6.8,3.3,0,6.3,4.5,0,5.5,5.5,0,4.5,6.3,0,3.3,6.8,0,2,7]);
const gSX=GB([0,1,2,0,2,3,4,5,7,4,7,6],[7,0,0,7,2,0,10,2,0,10,0,0,7,0,0,10,0,0,7,0,2,10,0,2]);
const gSY=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,7,0,2,7,0,2,10,0,0,10,0,0,7,0,0,10,0,0,7,2,0,10,2]);
const gSZ=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,7,0,2,7,0,2,10,0,0,10,0,0,7,0,0,10,2,0,7,2,0,10]);
const gRX=GB([0,1,2,1,2,3,3,2,4,3,4,5,5,4,6,5,6,7,7,6,8,7,8,9,9,8,10,9,10,11,11,10,12,11,12,13],[0,2,7,0,2,10,0,3.3,6.8,0,4,9.7,0,4.5,6.3,0,5.9,8.8,0,5.5,5.5,0,7.5,7.5,0,6.3,4.5,0,8.8,5.9,0,6.8,3.3,0,9.7,4,0,7,2,0,10,2]);
const gRY=GB([0,1,2,1,2,3,3,2,4,3,4,5,5,4,6,5,6,7,7,6,8,7,8,9,9,8,10,9,10,11,11,10,12,11,12,13],[2,0,7,2,0,10,3.3,0,6.8,4,0,9.7,4.5,0,6.3,5.9,0,8.8,5.5,0,5.5,7.5,0,7.5,6.3,0,4.5,8.8,0,5.9,6.8,0,3.3,9.7,0,4,7,0,2,10,0,2]);
const gRZ=GB([0,1,2,1,2,3,3,2,4,3,4,5,5,4,6,5,6,7,7,6,8,7,8,9,9,8,10,9,10,11,11,10,12,11,12,13],[2,7,0,2,10,0,3.3,6.8,0,4,9.7,0,4.5,6.3,0,5.9,8.8,0,5.5,5.5,0,7.5,7.5,0,6.3,4.5,0,8.8,5.9,0,6.8,3.3,0,9.7,4,0,7,2,0,10,2,0]);
const gS=GB([0,1,4,0,1,5,0,2,5,0,2,6,0,3,4,0,3,6],[0,0,0,2,0,0,0,2,0,0,0,2,2,0,2,2,2,0,0,2,2]);
const gSR=GB([0,1,3,1,3,2],[.8,-.15,0, 1,-.2,0, 1,.2,0, .8,.15,0]);
const fXZ_S=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,0,0,0,-1,1,0,-1,1,0,0]);
const fXZ_X=GB([0,1,2,0,2,3,4,5,7,4,7,6],[1,0,0,1,0,-1,2.1,0,-1,2.1,0,0]);
const fXZ_Z=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,-1,0,0,-2.1,1,0,-2.1,1,0,-1]);
const fXZ_SX=GB([0,1,2,0,2,3,4,5,7,4,7,6],[2.1,0,0,2.1,0,-1,3.1,0,-1,3.1,0,0]);
const fXZ_SZ=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,-2.1,0,0,-3.1,1,0,-3.1,1,0,-2.1]);
const fXZ_XZ=GB([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6],[1,0,-1,1,0,-2.1,1.35,0,-2.05,1.65,0,-1.9,1.9,0,-1.65,2.05,0,-1.35,2.1,0,-1]);
const fXZ_RY=GB([0,6,1,6,7,1,1,7,2,2,7,8,2,8,9,2,9,3,3,9,10,3,10,4,4,10,11,4,11,12,4,12,5],[1,0,-2.1,1.35,0,-2.05,1.65,0,-1.9,1.9,0,-1.65,2.05,0,-1.35,2.1,0,-1,1,0,-3.1,1.5,0,-3.05,2,0,-2.85,2.5,0,-2.5,2.85,0,-2,3.05,0,-1.5,3.1,0,-1]);
const fXY_S=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,0,0,1,0,1,1,0,1,0,0]);
const fXY_X=GB([0,1,2,0,2,3,4,5,7,4,7,6],[1,0,0,1,1,0,2.1,1,0,2.1,0,0]);
const fXY_Y=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,1,0,0,2.1,0,1,2.1,0,1,1,0]);
const fXY_SX=GB([0,1,2,0,2,3,4,5,7,4,7,6],[2.1,0,0,2.1,1,0,3.1,1,0,3.1,0,0]);
const fXY_SY=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,2.1,0,0,3.1,0,1,3.1,0,1,2.1,0]);
const fXY_XY=GB([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6],[1,1,0,1,2.1,0,1.35,2.05,0,1.65,1.9,0,1.9,1.65,0,2.05,1.35,0,2.1,1,0]);
const fXY_RZ=GB([0,6,1,6,7,1,1,7,2,2,7,8,2,8,9,2,9,3,3,9,10,3,10,4,4,10,11,4,11,12,4,12,5],[1,2.1,0,1.35,2.05,0,1.65,1.9,0,1.9,1.65,0,2.05,1.35,0,2.1,1,0,1,3.1,0,1.5,3.05,0,2,2.85,0,2.5,2.5,0,2.85,2,0,3.05,1.5,0,3.1,1,0]);
const fYZ_S=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,0,0,1,0,0,1,-1,0,0,-1]);
const fYZ_Z=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,-1,0,1,-1,0,1,-2.1,0,0,-2.1]);
const fYZ_Y=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,1,0,0,2.1,0,0,2.1,-1,0,1,-1]);
const fYZ_SY=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,2.1,0,0,3.1,0,0,3.1,-1,0,2.1,-1]);
const fYZ_SZ=GB([0,1,2,0,2,3,4,5,7,4,7,6],[0,0,-2.1,0,1,-2.1,0,1,-3.1,0,0,-3.1]);
const fYZ_YZ=GB([0,1,2,0,2,3,0,3,4,0,4,5,0,5,6],[0,1,-1,0,2.1,-1,0,2.05,-1.35,0,1.9,-1.65,0,1.65,-1.9,0,1.35,-2.05,0,1,-2.1]);
const fYZ_RX=GB([0,6,1,6,7,1,1,7,2,2,7,8,2,8,9,2,9,3,3,9,10,3,10,4,4,10,11,4,11,12,4,12,5],[0,2.1,-1,0,2.05,-1.35,0,1.9,-1.65,0,1.65,-1.9,0,1.35,-2.05,0,1,-2.1,0,3.1,-1,0,3.05,-1.5,0,2.85,-2,0,2.5,-2.5,0,2,-2.85,0,1.5,-3.05,0,1,-3.1]);
const DS=THREE.DoubleSide, BS=THREE.BackSide;
function buildGroup(spec,side){ const grp=new THREE.Group(); grp.visible=false;
spec.forEach((s,i)=>{ const m=Mm(s[0],s[1],side); m.name=s[2]; m.userData.order=i; m.renderOrder=RO+i; grp.add(m); });
vpState.scene.add(grp); return grp; }
let gizmo3D,flatXZ,flatXY,flatYZ,smallRing=null,sector=null,hudLine=null,hudLineGeo=null,snapVis=null,uvFrameLines=null;
const quantRotateRings=[];
const quantRotateHudRings=[];
let _snapVisActive=false;
const _tc=new THREE.Vector3(),_tc2=new THREE.Vector3(),_lc=new THREE.Vector3(),_iq=new THREE.Quaternion(),_v=new THREE.Vector3(),_av=new THREE.Vector3(),_vp=new THREE.Vector3(),_m4=new THREE.Matrix4();
const _gq=new THREE.Quaternion();
function gizmoOrientQuat(){ rotQuatOfLin(gizmo.lin,_gq); return _gq; }
function computeSigns(view){ const cam=view.cam; const oq=gizmoLocal?gizmoHandleOrient:IDENT;
_tc2.copy(cam.position).sub(gizmo.pos); if(_tc2.lengthSq()<1e-9){ cam.getWorldDirection(_tc2); _tc2.negate(); } else _tc2.normalize();
_lc.copy(_tc2).applyQuaternion(_iq.copy(oq).invert());
return {sx:_lc.x>=0?1:-1, sy:_lc.y>=0?1:-1, sz:_lc.z>=0?1:-1}; }
function freezeSignsAll(){ frozenSignsPerView=new Map(); for(const vw of vpState.views){ if((vw.type==='persp')||gizmoLocal) frozenSignsPerView.set(vw, computeSigns(vw)); } }
function pwOf(view,r){ const cam=view.cam;
if(cam.isOrthographicCamera){ return 2*(BASE/view_ctrl_zoom(cam))/r.h; }
else { cam.getWorldDirection(_tc); const depth=_v.copy(gizmo.pos).sub(cam.position).dot(_tc); return depth>1e-6?2*depth*Math.tan(cam.fov*Math.PI/360)/r.h:1e-6; } }
function applyGizmo(view,r){
gizmo3D.visible=false; flatXZ.visible=false; flatXY.visible=false; flatYZ.visible=false;
if(smallRing) smallRing.visible=false;
if(sector) sector.visible=false;
quantRotateRings.forEach(ring=>ring.visible=false);
if(!gizmoVisible) return {mode3D:false,orientQuat:IDENT,sx:1,sy:1,sz:1,pw:1};
const cam=view.cam;
const mode3D=(view.type==='persp')||gizmoLocal;
const orientQuat=(mode3D&&gizmoLocal)?gizmoHandleOrient:IDENT;
const pw=pwOf(view,r);
let sx=1,sy=1,sz=1;
if(mode3D){ const fv=frozenSignsPerView?frozenSignsPerView.get(view):null;
if(fv){ sx=fv.sx; sy=fv.sy; sz=fv.sz; }
else { _tc2.copy(cam.position).sub(gizmo.pos); if(_tc2.lengthSq()<1e-9){ cam.getWorldDirection(_tc2); _tc2.negate(); } else _tc2.normalize();
_lc.copy(_tc2).applyQuaternion(_iq.copy(orientQuat).invert()); sx=_lc.x>=0?1:-1; sy=_lc.y>=0?1:-1; sz=_lc.z>=0?1:-1; } }
const grp=mode3D?gizmo3D:(view.flat==='XZ'?flatXZ:view.flat==='XY'?flatXY:flatYZ);
grp.visible=true; grp.position.copy(gizmo.pos);
const u=gizPx*pw/(mode3D?EXT3D:EXTFLAT);
if(mode3D){ grp.quaternion.copy(orientQuat); grp.scale.set(sx*u,sy*u,sz*u); } else { grp.quaternion.copy(IDENT); grp.scale.setScalar(u); }
grp.updateMatrixWorld(true);
const showScreen=gizmoVisible && (splineMode || view.type==='persp' || sectorPlaneDiffers(view));
if(showScreen){
if(smallRing){ const gNdc=_vp.copy(gizmo.pos).project(cam);
const ndcY=gNdc.y + SMALLRING_OFF_PX/(r.h/2);
_v.set(gNdc.x, ndcY, gNdc.z).unproject(cam);
smallRing.position.copy(_v);
smallRing.quaternion.copy(cam.quaternion);
smallRing.scale.setScalar(SMALLRING_PX*pw);
smallRing.visible=true; smallRing.updateMatrixWorld(true); }
if(sector){ sector.position.copy(gizmo.pos);
sector.quaternion.copy(cam.quaternion);
sector.scale.setScalar(RING_PX*pw);
sector.visible=true; sector.updateMatrixWorld(true); } }
if(quantOn&&gizDrag&&gizDrag.mode==='rotate'&&vpState.views[gizDrag.view]===view){
for(const ring of quantRotateRings){ ring.position.copy(gizmo.pos); ring.quaternion.copy(cam.quaternion); ring.scale.setScalar(ring.userData.radiusPx*pw); ring.visible=true; ring.updateMatrixWorld(true); }
const p=projectPx(gizmo.pos,cam,r),cx=p[0]/vpState.W*2-1,cy=1-p[1]/vpState.H*2;
for(const ring of quantRotateHudRings){ const rr=ring.userData.radiusPx,a=ring.geometry.attributes.position.array; for(let i=0;i<=64;i++){ const ang=i/64*TAU,k=i*3;a[k]=cx+Math.cos(ang)*rr/vpState.W*2;a[k+1]=cy+Math.sin(ang)*rr/vpState.H*2;a[k+2]=0; } ring.geometry.attributes.position.needsUpdate=true; ring.visible=true; }
}
return {mode3D,orientQuat,sx,sy,sz,pw}; }
function sectorPlaneDiffers(view){ const cam=view.cam;
cam.getWorldDirection(_tc); _tc.normalize();
if(gizmoLocal){ const q=gizmoHandleOrient;
const axes=[ new THREE.Vector3(1,0,0).applyQuaternion(q),
new THREE.Vector3(0,1,0).applyQuaternion(q),
new THREE.Vector3(0,0,1).applyQuaternion(q) ];
for(const a of axes){ if(Math.abs(a.normalize().dot(_tc))>0.98) return false; }
return true; }
return false; }
function axisFromFr(fr,w){ const s=w==='X'?fr.sx:w==='Y'?fr.sy:fr.sz; const b=w==='X'?BX:w==='Y'?BY:BZ; return _av.copy(b).applyQuaternion(fr.orientQuat).multiplyScalar(s).clone(); }
function drawBrackets(view,r){ const B=brackets; if(!B.line||!B.visible||!B.has){ if(B.line) B.line.visible=false; return; }
const mn=B.min, mx=B.max, a=B.pos;
const C=[[mn.x,mn.y,mn.z],[mx.x,mn.y,mn.z],[mx.x,mx.y,mn.z],[mn.x,mx.y,mn.z],
[mn.x,mn.y,mx.z],[mx.x,mn.y,mx.z],[mx.x,mx.y,mx.z],[mn.x,mx.y,mx.z]];
const E=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
let o=0; for(const e of E){ const u=C[e[0]],v=C[e[1]];
a[o++]=u[0];a[o++]=u[1];a[o++]=u[2]; a[o++]=v[0];a[o++]=v[1];a[o++]=v[2]; }
B.geo.attributes.position.needsUpdate=true; B.geo.setDrawRange(0,24);
B.line.material.opacity=B.opacity; B.line.visible=true; }
function fadeTick(){ if(!brackets.fading) return; render(); if(brackets.fading) requestAnimationFrame(fadeTick); }
/* hover + жесты гизмо */
let hovObj=null; const hRay=new THREE.Raycaster(), hNdc=new THREE.Vector2();
const vertexHoverPick={scene:new THREE.Scene(),records:new Map(),ids:new Map(),target:null,pixels:new Uint8Array(0)};
const vertexPickMat=new THREE.ShaderMaterial({depthTest:true,depthWrite:false,toneMapped:false,uniforms:{size:{value:64}},vertexShader:'attribute vec3 color; varying vec3 vColor; uniform float size; void main(){vColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=size;}',fragmentShader:'varying vec3 vColor; void main(){if(length(gl_PointCoord-vec2(.5))>.5)discard;gl_FragColor=vec4(vColor,1.);}' });
const vertexDepthMat=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,depthTest:true,side:THREE.FrontSide});
const centerDepthMat=new THREE.ShaderMaterial({depthTest:true,depthWrite:true,side:THREE.DoubleSide,vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'void main(){float z=gl_FragCoord.z;vec3 e=fract(vec3(1.,255.,65025.)*z);e-=e.yzz*vec3(1./255.,1./255.,0.);gl_FragColor=vec4(e,1.);}' });
const edgePickMat=new THREE.ShaderMaterial({depthTest:true,depthWrite:false,toneMapped:false,uniforms:{res:{value:new THREE.Vector2(1,1)},width:{value:64}},vertexShader:'attribute vec3 other; attribute float side; attribute vec3 color; varying vec3 vColor; uniform vec2 res;uniform float width;void main(){vec4 a=projectionMatrix*modelViewMatrix*vec4(position,1.);vec4 b=projectionMatrix*modelViewMatrix*vec4(other,1.);vec2 delta=(b.xy/b.w-a.xy/a.w)*res;vec2 d=length(delta)>1e-6?normalize(delta):vec2(1.,0.);vec2 n=vec2(-d.y,d.x);a.xy+=n*side*width/res*a.w;vColor=color;gl_Position=a;}',fragmentShader:'varying vec3 vColor;void main(){gl_FragColor=vec4(vColor,1.);}' });
const edgeHoverPick={scene:new THREE.Scene(),records:new Map(),ids:new Map(),target:null,pixels:new Uint8Array(0)};
function syncEdgeHoverPick(){let dirty=false;const live=new Set(pickMeshes.keys());for(const [h,rec] of edgeHoverPick.records)if(!live.has(h)){edgeHoverPick.scene.remove(rec.depth,rec.lines);rec.geo.dispose();edgeHoverPick.records.delete(h);dirty=true;}for(const [h,mesh] of pickMeshes){let rec=edgeHoverPick.records.get(h);if(rec&&rec.source===mesh.geometry)continue;if(rec){edgeHoverPick.scene.remove(rec.depth,rec.lines);rec.geo.dispose();}const p=mesh.geometry.attributes.position,pa=[],pb=[],side=[],cols=[],refs=logicalEdges(mesh.geometry);for(const edge of refs)for(const s of [-1,1])for(const v of [edge.a,edge.b]){pa.push(p.getX(v),p.getY(v),p.getZ(v));const o=v===edge.a?edge.b:edge.a;pb.push(p.getX(o),p.getY(o),p.getZ(o));side.push(s);cols.push(0,0,0);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pa,3));geo.setAttribute('other',new THREE.Float32BufferAttribute(pb,3));geo.setAttribute('side',new THREE.Float32BufferAttribute(side,1));geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));const ii=[];for(let e=0;e<refs.length;e++){const q=e*4;ii.push(q,q+1,q+3,q,q+3,q+2);}geo.setIndex(ii);const depth=new THREE.Mesh(mesh.geometry,vertexDepthMat),lines=new THREE.Mesh(geo,edgePickMat);depth.matrixAutoUpdate=lines.matrixAutoUpdate=false;depth.renderOrder=0;lines.renderOrder=1;edgeHoverPick.scene.add(depth,lines);edgeHoverPick.records.set(h,{h,mesh,source:mesh.geometry,geo,depth,lines,refs,cols:geo.attributes.color.array});dirty=true;}if(dirty){edgeHoverPick.ids.clear();let id=1;for(const rec of edgeHoverPick.records.values()){for(let e=0;e<rec.refs.length;e++,id++){const c=[(id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255];for(let k=0;k<4;k++)rec.cols.set(c,(e*4+k)*3);edgeHoverPick.ids.set(id,{h:rec.h,mesh:rec.mesh,edge:rec.refs[e]});}rec.geo.attributes.color.needsUpdate=true;}}}
function renderEdgeIds(cam,r,wire,width,box=null){const renderer=vpState.renderer;if(!renderer)return null;syncEdgeHoverPick();let bx0=0,by0=0,bw=Math.max(1,Math.round(r.w)),bh=Math.max(1,Math.round(r.h)),scale=1,oldProjection=null,oldProjectionInverse=null,oldView=null;if(box){bx0=Math.max(0,Math.floor(box.x0-r.x));by0=Math.max(0,Math.floor(box.y0-r.y));const bx1=Math.min(r.w,Math.ceil(box.x1-r.x)),by1=Math.min(r.h,Math.ceil(box.y1-r.y));bw=Math.max(1,bx1-bx0);bh=Math.max(1,by1-by0);scale=Math.max(1,Math.min(4,Math.sqrt(2500000/(bw*bh))));oldProjection=cam.projectionMatrix.clone();oldProjectionInverse=cam.projectionMatrixInverse.clone();oldView=cam.view?{...cam.view}:null;cam.setViewOffset(r.w,r.h,bx0,by0,bw,bh);}const w=Math.max(1,Math.ceil(bw*scale)),h=Math.max(1,Math.ceil(bh*scale));edgePickMat.depthTest=!wire;edgePickMat.uniforms.res.value.set(w,h);edgePickMat.uniforms.width.value=width;for(const [hsh,q] of edgeHoverPick.records){const mesh=pickMeshes.get(hsh);if(!mesh)continue;mesh.updateMatrixWorld(true);q.depth.matrix.copy(mesh.matrixWorld);q.lines.matrix.copy(mesh.matrixWorld);const vis=effectiveVisible(hsh);q.depth.visible=vis&&!wire;q.lines.visible=vis&&selNodes.has(hsh);}if(!edgeHoverPick.target||edgeHoverPick.target.width!==w||edgeHoverPick.target.height!==h){edgeHoverPick.target?.dispose();edgeHoverPick.target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});}const old=renderer.getRenderTarget();renderer.setRenderTarget(edgeHoverPick.target);renderer.setViewport(0,0,w,h);renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.clear(true,true,true);renderer.render(edgeHoverPick.scene,cam);if(box){cam.view=oldView;cam.projectionMatrix.copy(oldProjection);cam.projectionMatrixInverse.copy(oldProjectionInverse);}return {renderer,old,w,h,bx0,by0,bw,bh,scale,cropped:!!box};}
function gpuHoverEdge(cx,cy,cam,r,wire=false,R=EDIT_HIT_PX){const pass=renderEdgeIds(cam,r,wire,3);if(!pass)return null;const {renderer,old,w,h}=pass,x=Math.round(cx-r.x),y=Math.round(cy-r.y),x0=Math.max(0,x-R),y0=Math.max(0,y-R),rw=Math.min(w,x+R+1)-x0,rh=Math.min(h,y+R+1)-y0,n=rw*rh*4;if(edgeHoverPick.pixels.length!==n)edgeHoverPick.pixels=new Uint8Array(n);renderer.readRenderTargetPixels(edgeHoverPick.target,x0,h-y0-rh,rw,rh,edgeHoverPick.pixels);renderer.setRenderTarget(old);const seen=new Set(),a=new THREE.Vector3(),b=new THREE.Vector3();let best=null,bd=R*R;for(let i=0;i<n;i+=4){const z=edgeHoverPick.pixels,id=z[i]|(z[i+1]<<8)|(z[i+2]<<16);if(!id||seen.has(id))continue;seen.add(id);const q=edgeHoverPick.ids.get(id);if(!q)continue;a.fromBufferAttribute(q.mesh.geometry.attributes.position,q.edge.a).applyMatrix4(q.mesh.matrixWorld);b.fromBufferAttribute(q.mesh.geometry.attributes.position,q.edge.b).applyMatrix4(q.mesh.matrixWorld);const A=projectPx(a,cam,r),B=projectPx(b,cam,r),d=pointSegDistSq(cx,cy,A[0],A[1],B[0],B[1]);if(d<=bd){bd=d;best=q;}}return best?{h:best.h,mesh:best.mesh,edge:[best.edge.a,best.edge.b,best.edge.keys[0]],keys:best.edge.keys}:null;}
function syncVertexHoverPick(){
const live=new Set(pickMeshes.keys()); for(const [h,rec] of vertexHoverPick.records)if(!live.has(h)){vertexHoverPick.scene.remove(rec.depth,rec.points);rec.geo.dispose();vertexHoverPick.records.delete(h);}
for(const [h,mesh] of pickMeshes){let rec=vertexHoverPick.records.get(h);const p=mesh?.geometry?.attributes?.position;if(!p){if(rec){vertexHoverPick.scene.remove(rec.depth,rec.points);rec.geo.dispose();vertexHoverPick.records.delete(h);}continue;}if(rec&&rec.source===mesh.geometry&&rec.position===p)continue;if(rec){vertexHoverPick.scene.remove(rec.depth,rec.points);rec.geo.dispose();}
const cols=new Float32Array(p.count*3),geo=new THREE.BufferGeometry();geo.setAttribute('position',p);geo.setAttribute('color',new THREE.BufferAttribute(cols,3));const depth=new THREE.Mesh(mesh.geometry,vertexDepthMat),points=new THREE.Points(geo,vertexPickMat);depth.matrixAutoUpdate=points.matrixAutoUpdate=false;depth.renderOrder=0;points.renderOrder=1;vertexHoverPick.scene.add(depth,points);vertexHoverPick.records.set(h,{source:mesh.geometry,position:p,geo,depth,points,cols});}
}
function gpuHoverVertex(cx,cy,cam,r,wire=false){
const renderer=vpState.renderer;if(!renderer)return null;syncVertexHoverPick();vertexPickMat.uniforms.size.value=64;vertexHoverPick.ids.clear();let id=1;
vertexPickMat.depthTest=!wire;for(const [h,mesh] of pickMeshes){const rec=vertexHoverPick.records.get(h);if(!rec)continue;mesh.updateMatrixWorld(true);rec.depth.matrix.copy(mesh.matrixWorld);rec.points.matrix.copy(mesh.matrixWorld);const visible=effectiveVisible(h);rec.depth.visible=visible&&!wire;rec.points.visible=visible&&selNodes.has(h);if(!rec.points.visible)continue;const p=mesh.geometry.attributes.position,c=rec.cols;for(let i=0;i<p.count;i++,id++){if(id>=0xffffff)break;c[i*3]=(id&255)/255;c[i*3+1]=((id>>8)&255)/255;c[i*3+2]=((id>>16)&255)/255;vertexHoverPick.ids.set(id,{mesh,vi:i});}rec.geo.attributes.color.needsUpdate=true;}
const w=Math.max(1,Math.round(r.w)),h=Math.max(1,Math.round(r.h));if(!vertexHoverPick.target||vertexHoverPick.target.width!==w||vertexHoverPick.target.height!==h){if(vertexHoverPick.target)vertexHoverPick.target.dispose();vertexHoverPick.target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});}
const old=renderer.getRenderTarget();renderer.setRenderTarget(vertexHoverPick.target);renderer.setViewport(0,0,w,h);renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.clear(true,true,true);renderer.render(vertexHoverPick.scene,cam);const radius=EDIT_HIT_PX,x=Math.max(0,Math.min(w-1,Math.round(cx-r.x))),y=Math.max(0,Math.min(h-1,Math.round(cy-r.y))),x0=Math.max(0,x-radius),y0=Math.max(0,y-radius),rw=Math.min(w,x+radius+1)-x0,rh=Math.min(h,y+radius+1)-y0,need=rw*rh*4;if(vertexHoverPick.pixels.length!==need)vertexHoverPick.pixels=new Uint8Array(need);renderer.readRenderTargetPixels(vertexHoverPick.target,x0,h-y0-rh,rw,rh,vertexHoverPick.pixels);renderer.setRenderTarget(old);const seen=new Set(),v=new THREE.Vector3();let best=null,bestD=radius*radius;for(let i=0;i<vertexHoverPick.pixels.length;i+=4){const a=vertexHoverPick.pixels,id=a[i]|(a[i+1]<<8)|(a[i+2]<<16);if(!id||seen.has(id))continue;seen.add(id);const rec=vertexHoverPick.ids.get(id);if(!rec)continue;v.fromBufferAttribute(rec.mesh.geometry.attributes.position,rec.vi).applyMatrix4(rec.mesh.matrixWorld);const p=projectPx(v,cam,r),d=(p[0]-cx)**2+(p[1]-cy)**2;if(d<=bestD){bestD=d;best=rec;}}return best;
}
function gpuMarqueeVertices(box,cam,r,wire=false){const renderer=vpState.renderer;if(!renderer)return new Map();syncVertexHoverPick();vertexPickMat.uniforms.size.value=1;vertexPickMat.depthTest=!wire;vertexHoverPick.ids.clear();let id=1;for(const [h,mesh] of pickMeshes){const q=vertexHoverPick.records.get(h);if(!q)continue;mesh.updateMatrixWorld(true);q.depth.matrix.copy(mesh.matrixWorld);q.points.matrix.copy(mesh.matrixWorld);const vis=effectiveVisible(h);q.depth.visible=vis&&!wire;q.points.visible=vis&&selNodes.has(h);if(!q.points.visible)continue;for(let i=0;i<mesh.geometry.attributes.position.count;i++,id++){const o=i*3;q.cols[o]=(id&255)/255;q.cols[o+1]=((id>>8)&255)/255;q.cols[o+2]=((id>>16)&255)/255;vertexHoverPick.ids.set(id,{h,mesh,vi:i});}q.geo.attributes.color.needsUpdate=true;}const w=Math.round(r.w),h=Math.round(r.h);if(!vertexHoverPick.target||vertexHoverPick.target.width!==w||vertexHoverPick.target.height!==h){if(vertexHoverPick.target)vertexHoverPick.target.dispose();vertexHoverPick.target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});}const old=renderer.getRenderTarget();renderer.setRenderTarget(vertexHoverPick.target);renderer.setViewport(0,0,w,h);renderer.setClearColor(0,0);renderer.clear(true,true,true);renderer.render(vertexHoverPick.scene,cam);const x0=Math.max(0,Math.floor(box.x0-r.x)),y0=Math.max(0,Math.floor(box.y0-r.y)),rw=Math.max(0,Math.min(w,Math.ceil(box.x1-r.x))-x0),rh=Math.max(0,Math.min(h,Math.ceil(box.y1-r.y))-y0),px=new Uint8Array(rw*rh*4);if(rw&&rh)renderer.readRenderTargetPixels(vertexHoverPick.target,x0,h-y0-rh,rw,rh,px);renderer.setRenderTarget(old);const out=new Map();for(let i=0;i<px.length;i+=4){const n=px[i]|(px[i+1]<<8)|(px[i+2]<<16),q=vertexHoverPick.ids.get(n);if(!q)continue;let s=out.get(q.h);if(!s)out.set(q.h,s=new Set());coincidentVertexIds(q.mesh,q.vi).forEach(v=>s.add(v));}return out;}
function gpuMarqueeVerticesExact(box,cam,r,wire=false){if(wire){const out=new Map();for(const [h,m] of pickMeshes){if(!selNodes.has(h)||!effectiveVisible(h))continue;m.updateMatrixWorld(true);const p=m.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);const q=projectPx(v,cam,r);if(q[0]>=box.x0&&q[0]<=box.x1&&q[1]>=box.y0&&q[1]<=box.y1){let s=out.get(h);if(!s)out.set(h,s=new Set());coincidentVertexIds(m,i).forEach(x=>s.add(x));}}}return out;}const renderer=vpState.renderer;syncVertexHoverPick();for(const [h,q] of vertexHoverPick.records){const m=pickMeshes.get(h);if(!m)continue;m.updateMatrixWorld(true);q.depth.material=centerDepthMat;q.depth.matrix.copy(m.matrixWorld);q.depth.visible=effectiveVisible(h);q.points.visible=false;}const w=Math.round(r.w),h=Math.round(r.h);if(!vertexHoverPick.target||vertexHoverPick.target.width!==w||vertexHoverPick.target.height!==h){if(vertexHoverPick.target)vertexHoverPick.target.dispose();vertexHoverPick.target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});}const old=renderer.getRenderTarget();renderer.setRenderTarget(vertexHoverPick.target);renderer.setViewport(0,0,w,h);renderer.setClearColor(0xffffff,1);renderer.clear(true,true,true);renderer.render(vertexHoverPick.scene,cam);const x0=Math.max(0,Math.floor(box.x0-r.x)),y0=Math.max(0,Math.floor(box.y0-r.y)),rw=Math.max(0,Math.min(w,Math.ceil(box.x1-r.x))-x0),rh=Math.max(0,Math.min(h,Math.ceil(box.y1-r.y))-y0),px=new Uint8Array(rw*rh*4);if(rw&&rh)renderer.readRenderTargetPixels(vertexHoverPick.target,x0,h-y0-rh,rw,rh,px);renderer.setRenderTarget(old);const out=new Map(),v=new THREE.Vector3();for(const h0 of selNodes){const m=pickMeshes.get(h0);if(!m)continue;m.updateMatrixWorld(true);const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);const s=v.clone().project(cam),sx=(s.x*.5+.5)*r.w+r.x,sy=(-s.y*.5+.5)*r.h+r.y;if(sx<box.x0||sx>box.x1||sy<box.y0||sy>box.y1)continue;const ix=Math.floor(sx-r.x)-x0,iy=Math.floor(sy-r.y)-y0;if(ix<0||iy<0||ix>=rw||iy>=rh)continue;const o=((rh-1-iy)*rw+ix)*4,d=px[o]/255+px[o+1]/65025+px[o+2]/16581375,z=s.z*.5+.5;if(Math.abs(d-z)<.002){let set=out.get(h0);if(!set)out.set(h0,set=new Set());coincidentVertexIds(m,i).forEach(x=>set.add(x));}}}for(const q of vertexHoverPick.records.values())q.depth.material=vertexDepthMat;return out;}
function gpuMarqueeVerticesStable(box,cam,r,wire=false){
  const out=new Map(),world=new THREE.Vector3(),ndc=new THREE.Vector3();
  let pixels=null,x0=0,y0=0,rw=0,rh=0;
  if(!wire){
    const renderer=vpState.renderer;
    syncVertexHoverPick();
    for(const [h,q] of vertexHoverPick.records){
      const mesh=pickMeshes.get(h);
      if(!mesh)continue;
      mesh.updateMatrixWorld(true);
      q.depth.material=centerDepthMat;
      q.depth.matrix.copy(mesh.matrixWorld);
      q.depth.visible=effectiveVisible(h);
      q.points.visible=false;
    }
    const w=Math.max(1,Math.round(r.w)),h=Math.max(1,Math.round(r.h));
    if(!vertexHoverPick.target||vertexHoverPick.target.width!==w||vertexHoverPick.target.height!==h){
      if(vertexHoverPick.target)vertexHoverPick.target.dispose();
      vertexHoverPick.target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});
    }
    const oldTarget=renderer.getRenderTarget();
    renderer.setRenderTarget(vertexHoverPick.target);
    renderer.setViewport(0,0,w,h);
    renderer.setScissorTest(false);
    renderer.setClearColor(0xffffff,1);
    renderer.clear(true,true,true);
    renderer.render(vertexHoverPick.scene,cam);
    x0=Math.max(0,Math.floor(box.x0-r.x)-1);
    y0=Math.max(0,Math.floor(box.y0-r.y)-1);
    const x1=Math.min(w,Math.ceil(box.x1-r.x)+2),y1=Math.min(h,Math.ceil(box.y1-r.y)+2);
    rw=Math.max(0,x1-x0);rh=Math.max(0,y1-y0);
    pixels=new Uint8Array(rw*rh*4);
    if(rw&&rh)renderer.readRenderTargetPixels(vertexHoverPick.target,x0,h-y1,rw,rh,pixels);
    renderer.setRenderTarget(oldTarget);
    for(const q of vertexHoverPick.records.values())q.depth.material=vertexDepthMat;
  }
  const sampleDepth=(px,py,target)=>{
    let best=Infinity,bestDelta=Infinity;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const ix=Math.floor(px-r.x)+dx-x0,iy=Math.floor(py-r.y)+dy-y0;
      if(ix<0||iy<0||ix>=rw||iy>=rh)continue;
      const o=((rh-1-iy)*rw+ix)*4;
      const depth=pixels[o]/255+pixels[o+1]/65025+pixels[o+2]/16581375,delta=Math.abs(depth-target);
      if(delta<bestDelta){bestDelta=delta;best=depth;}
    }
    return best;
  };
  for(const h of selNodes){
    const mesh=pickMeshes.get(h);
    if(!mesh||!effectiveVisible(h))continue;
    mesh.updateMatrixWorld(true);
    const pos=mesh.geometry.attributes.position;
    const groups=new Map(),groupOf=new Array(pos.count);
    for(let i=0;i<pos.count;i++){
      const key=`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;
      let group=groups.get(key);if(!group)groups.set(key,group=[]);
      group.push(i);groupOf[i]=group;
    }
    const accepted=new Set();
    for(let i=0;i<pos.count;i++){
      const group=groupOf[i];if(accepted.has(group))continue;
      world.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
      ndc.copy(world).project(cam);
      if(ndc.z<-1||ndc.z>1)continue;
      const sx=(ndc.x*.5+.5)*r.w+r.x,sy=(-ndc.y*.5+.5)*r.h+r.y;
      if(sx<box.x0||sx>box.x1||sy<box.y0||sy>box.y1)continue;
      if(!wire){
        const vertexDepth=ndc.z*.5+.5,sceneDepth=sampleDepth(sx,sy,vertexDepth);
        if(!Number.isFinite(sceneDepth)||Math.abs(sceneDepth-vertexDepth)>2e-5)continue;
      }
      let set=out.get(h);
      if(!set)out.set(h,set=new Set());
      group.forEach(v=>set.add(v));accepted.add(group);
    }
  }
  return out;
}
function renderVisibleVertexCenters(cam,r,area,wire){
  const renderer=vpState.renderer,outIds=new Map();
  if(!renderer)return {ids:outIds,pixels:new Uint8Array(),x0:0,y0:0,w:0,h:0};
  syncVertexHoverPick();
  vertexPickMat.uniforms.size.value=1;
  vertexPickMat.depthTest=!wire;
  vertexPickMat.depthFunc=THREE.LessEqualDepth;
  let id=1;
  for(const [h,mesh] of pickMeshes){
    const rec=vertexHoverPick.records.get(h);
    if(!rec)continue;
    mesh.updateMatrixWorld(true);
    rec.depth.material=vertexDepthMat;
    rec.depth.matrix.copy(mesh.matrixWorld);
    rec.points.matrix.copy(mesh.matrixWorld);
    const visible=effectiveVisible(h);
    rec.depth.visible=visible&&!wire;
    rec.points.visible=visible&&selNodes.has(h);
    if(!rec.points.visible)continue;
    const groups=logicalVertexGroups(mesh.geometry);
    for(const group of groups){
      if(id>=0xffffff)break;
      const color=[(id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255];
      for(const vi of group)rec.cols.set(color,vi*3);
      outIds.set(id,{h,mesh,vi:group[0],vertices:group});id++;
    }
    rec.geo.attributes.color.needsUpdate=true;
  }
  const width=Math.max(1,Math.round(r.w)),height=Math.max(1,Math.round(r.h));
  if(!vertexHoverPick.target||vertexHoverPick.target.width!==width||vertexHoverPick.target.height!==height){
    vertexHoverPick.target?.dispose();vertexHoverPick.target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true});
  }
  const x0=Math.max(0,Math.floor(area.x0-r.x)),x1=Math.min(width,Math.ceil(area.x1-r.x)+1);
  const y0=Math.max(0,Math.floor(area.y0-r.y)),y1=Math.min(height,Math.ceil(area.y1-r.y)+1);
  const rw=Math.max(0,x1-x0),rh=Math.max(0,y1-y0),pixels=new Uint8Array(rw*rh*4),old=renderer.getRenderTarget();
  renderer.setRenderTarget(vertexHoverPick.target);renderer.setViewport(0,0,width,height);renderer.setScissorTest(false);
  renderer.setClearColor(0,0);renderer.clear(true,true,true);renderer.render(vertexHoverPick.scene,cam);
  if(rw&&rh)renderer.readRenderTargetPixels(vertexHoverPick.target,x0,height-y1,rw,rh,pixels);
  renderer.setRenderTarget(old);
  return {ids:outIds,pixels,x0,y0,w:rw,h:rh};
}
const vertexGroupCache=new WeakMap(),vertexGroupOfCache=new WeakMap(),visibilityBvhCache=new WeakMap();
function logicalVertexGroups(geometry){
  let groups=vertexGroupCache.get(geometry);if(groups)return groups;
  const pos=geometry.attributes.position,byPosition=new Map();groups=[];
  for(let i=0;i<pos.count;i++){
    const key=`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;
    let group=byPosition.get(key);if(!group){group=[];byPosition.set(key,group);groups.push(group);}group.push(i);
  }
  const groupOf=new Array(pos.count);for(const group of groups)for(const vi of group)groupOf[vi]=group;
  vertexGroupCache.set(geometry,groups);vertexGroupOfCache.set(geometry,groupOf);return groups;
}
function logicalVertexGroup(geometry,vi){logicalVertexGroups(geometry);return vertexGroupOfCache.get(geometry)?.[vi]||[vi];}
function visibilityBvh(geometry){
  let root=visibilityBvhCache.get(geometry);if(root)return root;
  const pos=geometry?.attributes?.position;if(!pos)return null;const index=geometry.index,count=index?index.count/3:pos.count/3;
  const triangles=Array.from({length:count},(_,i)=>i),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const ids=fi=>[index?index.getX(fi*3):fi*3,index?index.getX(fi*3+1):fi*3+1,index?index.getX(fi*3+2):fi*3+2];
  const build=list=>{
    const box=new THREE.Box3(),centers=new THREE.Box3();
    for(const fi of list){const q=ids(fi);a.fromBufferAttribute(pos,q[0]);b.fromBufferAttribute(pos,q[1]);c.fromBufferAttribute(pos,q[2]);box.expandByPoint(a);box.expandByPoint(b);box.expandByPoint(c);centers.expandByPoint(a.add(b).add(c).multiplyScalar(1/3));}
    if(list.length<=12)return {box,triangles:list};
    const size=centers.getSize(new THREE.Vector3()),axis=size.x>=size.y&&size.x>=size.z?'x':(size.y>=size.z?'y':'z');
    list.sort((u,v)=>{const x=ids(u),y=ids(v);return (attributeComponent(pos,x[0],axis)+attributeComponent(pos,x[1],axis)+attributeComponent(pos,x[2],axis))-(attributeComponent(pos,y[0],axis)+attributeComponent(pos,y[1],axis)+attributeComponent(pos,y[2],axis));});
    const middle=list.length>>1;return {box,left:build(list.slice(0,middle)),right:build(list.slice(middle))};
  };
  root={tree:build(triangles),ids};visibilityBvhCache.set(geometry,root);return root;
}
function attributeComponent(attribute,index,axis){return axis==='x'?attribute.getX(index):(axis==='y'?attribute.getY(index):attribute.getZ(index));}
const visibilityRaycaster=new THREE.Raycaster(),visibilityNdc=new THREE.Vector2(),visibilityLocalRay=new THREE.Ray(),visibilityInverse=new THREE.Matrix4();
const visibilityHit=new THREE.Vector3(),visibilityWorldHit=new THREE.Vector3(),visibilityA=new THREE.Vector3(),visibilityB=new THREE.Vector3(),visibilityC=new THREE.Vector3();
function meshOccludesVertex(mesh,ray,maxDistance,tolerance){
  mesh.updateMatrixWorld(true);visibilityInverse.copy(mesh.matrixWorld).invert();
  visibilityLocalRay.origin.copy(ray.origin).applyMatrix4(visibilityInverse);
  visibilityLocalRay.direction.copy(ray.direction).transformDirection(visibilityInverse);
  const geometry=mesh.geometry,pos=geometry?.attributes?.position,bvh=visibilityBvh(geometry);if(!pos||!bvh)return false;const {tree,ids}=bvh,stack=[tree];
  while(stack.length){
    const node=stack.pop();if(!visibilityLocalRay.intersectsBox(node.box))continue;
    if(node.triangles){
      for(const fi of node.triangles){
        const q=ids(fi);visibilityA.fromBufferAttribute(pos,q[0]);visibilityB.fromBufferAttribute(pos,q[1]);visibilityC.fromBufferAttribute(pos,q[2]);
        if(!visibilityLocalRay.intersectTriangle(visibilityA,visibilityB,visibilityC,false,visibilityHit))continue;
        visibilityWorldHit.copy(visibilityHit).applyMatrix4(mesh.matrixWorld);
        const distance=visibilityWorldHit.distanceTo(ray.origin);
        if(distance>tolerance&&distance<maxDistance-tolerance)return true;
      }
    }else{stack.push(node.left,node.right);}
  }
  return false;
}
function exactVertexVisible(world,ndc,cam){
  visibilityNdc.set(ndc.x,ndc.y);visibilityRaycaster.setFromCamera(visibilityNdc,cam);
  const ray=visibilityRaycaster.ray,maxDistance=world.distanceTo(ray.origin),tolerance=Math.max(1e-5,maxDistance*1e-7);
  for(const [h,mesh] of pickMeshes)if(effectiveVisible(h)&&meshOccludesVertex(mesh,ray,maxDistance,tolerance))return false;
  return true;
}
function nearestTriangleOnMesh(mesh,ray){
  mesh.updateMatrixWorld(true);visibilityInverse.copy(mesh.matrixWorld).invert();visibilityLocalRay.origin.copy(ray.origin).applyMatrix4(visibilityInverse);visibilityLocalRay.direction.copy(ray.direction).transformDirection(visibilityInverse);
  const geometry=mesh.geometry,pos=geometry.attributes.position,{tree,ids}=visibilityBvh(geometry),stack=[tree];let best=null,bestDistance=Infinity;
  while(stack.length){const node=stack.pop();if(!visibilityLocalRay.intersectsBox(node.box))continue;if(node.triangles){for(const fi of node.triangles){const q=ids(fi);visibilityA.fromBufferAttribute(pos,q[0]);visibilityB.fromBufferAttribute(pos,q[1]);visibilityC.fromBufferAttribute(pos,q[2]);if(!visibilityLocalRay.intersectTriangle(visibilityA,visibilityB,visibilityC,false,visibilityHit))continue;visibilityWorldHit.copy(visibilityHit).applyMatrix4(mesh.matrixWorld);const distance=visibilityWorldHit.distanceTo(ray.origin);if(distance<bestDistance){bestDistance=distance;best=fi;}}}else stack.push(node.left,node.right);}
  return best===null?null:{object:mesh,faceIndex:best,distance:bestDistance};
}
function reliableFaceHit(cx,cy,cam,r,wire){
  pickNdc.set(((cx-r.x)/r.w)*2-1,-((cy-r.y)/r.h)*2+1);pickRay.setFromCamera(pickNdc,cam);
  if(!wire)return pickRay.intersectObjects([...pickMeshes.values()],false)[0]||null;
  let best=null;for(const h of selNodes){const mesh=pickMeshes.get(h);if(!mesh||!effectiveVisible(h))continue;const hit=nearestTriangleOnMesh(mesh,pickRay.ray);if(hit&&(!best||hit.distance<best.distance))best=hit;}return best;
}
function reliableHoverVertex(cx,cy,cam,r,wire=false,radius=EDIT_HIT_PX){
  const pass=renderVisibleVertexCenters(cam,r,{x0:cx-radius,y0:cy-radius,x1:cx+radius,y1:cy+radius},wire);
  const candidates=[],world=new THREE.Vector3(),ndc=new THREE.Vector3();
  for(const rec of pass.ids.values()){
    world.fromBufferAttribute(rec.mesh.geometry.attributes.position,rec.vi).applyMatrix4(rec.mesh.matrixWorld);
    ndc.copy(world).project(cam);if(ndc.z<-1||ndc.z>1)continue;
    const sx=(ndc.x*.5+.5)*r.w+r.x,sy=(-ndc.y*.5+.5)*r.h+r.y,d=(sx-cx)**2+(sy-cy)**2;
    if(d<=radius*radius)candidates.push({rec,d,depth:ndc.z,world:world.clone(),ndc:ndc.clone()});
  }
  candidates.sort((a,b)=>a.d-b.d||a.depth-b.depth);
  if(wire)return candidates[0]?.rec||null;
  for(const candidate of candidates)if(exactVertexVisible(candidate.world,candidate.ndc,cam))return candidate.rec;
  return null;
}
function reliableMarqueeVertices(box,cam,r,wire=false){
  const pass=renderVisibleVertexCenters(cam,r,box,wire),out=new Map(),world=new THREE.Vector3(),ndc=new THREE.Vector3();
  for(const rec of pass.ids.values()){
    world.fromBufferAttribute(rec.mesh.geometry.attributes.position,rec.vi).applyMatrix4(rec.mesh.matrixWorld);ndc.copy(world).project(cam);
    if(ndc.z<-1||ndc.z>1)continue;
    const sx=(ndc.x*.5+.5)*r.w+r.x,sy=(-ndc.y*.5+.5)*r.h+r.y;
    if(sx<box.x0||sx>box.x1||sy<box.y0||sy>box.y1)continue;
    if(!wire&&!exactVertexVisible(world,ndc,cam))continue;
    let set=out.get(rec.h);if(!set)out.set(rec.h,set=new Set());rec.vertices.forEach(v=>set.add(v));
  }
  return out;
}
const logicalEdgeCache=new WeakMap(),faceAdjacencyCache=new WeakMap();
function logicalEdges(geometry){
  let edges=logicalEdgeCache.get(geometry);if(edges)return edges;
  const pos=geometry.attributes.position,index=geometry.index,triangles=index?index.count/3:pos.count/3,byPosition=new Map();edges=[];
  const positionKey=i=>`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;
  for(let fi=0;fi<triangles;fi++)for(let j=0;j<3;j++){
    const a=index?index.getX(fi*3+j):fi*3+j,b=index?index.getX(fi*3+(j+1)%3):fi*3+(j+1)%3,ka=positionKey(a),kb=positionKey(b),logicalKey=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;
    let edge=byPosition.get(logicalKey);if(!edge){edge={a,b,keys:[]};byPosition.set(logicalKey,edge);edges.push(edge);}
    const key=polyEdgeKey(a,b);if(!edge.keys.includes(key))edge.keys.push(key);
  }
  logicalEdgeCache.set(geometry,edges);return edges;
}
function faceAdjacency(geometry){let adjacency=faceAdjacencyCache.get(geometry);if(adjacency)return adjacency;const pos=geometry.attributes.position,index=geometry.index,faces=index?index.count/3:pos.count/3,byEdge=new Map(),key=i=>`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;adjacency=Array.from({length:faces},()=>[]);for(let fi=0;fi<faces;fi++){const ids=[index?index.getX(fi*3):fi*3,index?index.getX(fi*3+1):fi*3+1,index?index.getX(fi*3+2):fi*3+2];for(let j=0;j<3;j++){const a=key(ids[j]),b=key(ids[(j+1)%3]),edge=a<b?a+'|'+b:b+'|'+a;let list=byEdge.get(edge);if(!list)byEdge.set(edge,list=[]);for(const other of list){adjacency[fi].push(other);adjacency[other].push(fi);}list.push(fi);}}faceAdjacencyCache.set(geometry,adjacency);return adjacency;}
function expandVisibleFaceSeeds(mesh,seeds,cam,r,box){const g=mesh.geometry,pos=g.attributes.position,index=g.index,faces=index?index.count/3:pos.count/3,adjacency=faceAdjacency(g),candidate=new Uint8Array(faces),facing=new Int8Array(faces),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),center=new THREE.Vector3(),view=new THREE.Vector3();mesh.updateMatrixWorld(true);for(let fi=0;fi<faces;fi++){const ia=index?index.getX(fi*3):fi*3,ib=index?index.getX(fi*3+1):fi*3+1,ic=index?index.getX(fi*3+2):fi*3+2;a.fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld);if(!robustTriRect(projectPx(a,cam,r),projectPx(b,cam,r),projectPx(c,cam,r),box))continue;candidate[fi]=1;center.copy(a).add(b).add(c).multiplyScalar(1/3);view.copy(cam.position).sub(center);facing[fi]=ab.subVectors(b,a).cross(ac.subVectors(c,a)).dot(view)>=0?1:-1;}let positive=0,negative=0;for(const fi of seeds)if(candidate[fi]){if(facing[fi]>0)positive++;else negative++;}const side=positive>=negative?1:-1,out=new Set(),queue=[];for(const fi of seeds)if(candidate[fi]&&facing[fi]===side){out.add(fi);queue.push(fi);}for(let qi=0;qi<queue.length;qi++)for(const next of adjacency[queue[qi]])if(candidate[next]&&facing[next]===side&&!out.has(next)){out.add(next);queue.push(next);}return out;}
function screenSegmentBoxInterval(a,b,box){
  const dx=b[0]-a[0],dy=b[1]-a[1],p=[-dx,dx,-dy,dy],q=[a[0]-box.x0,box.x1-a[0],a[1]-box.y0,box.y1-a[1]];let lo=0,hi=1;
  for(let i=0;i<4;i++){if(Math.abs(p[i])<1e-12){if(q[i]<0)return null;continue;}const t=q[i]/p[i];if(p[i]<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}return [lo,hi];
}
function reliableHoverEdge(cx,cy,cam,r,wire=false,radius=EDIT_HIT_PX){
  const hit=gpuHoverEdge(cx,cy,cam,r,wire,radius);if(!hit||wire)return hit;const pos=hit.mesh.geometry.attributes.position,a=new THREE.Vector3().fromBufferAttribute(pos,hit.edge[0]).applyMatrix4(hit.mesh.matrixWorld),b=new THREE.Vector3().fromBufferAttribute(pos,hit.edge[1]).applyMatrix4(hit.mesh.matrixWorld),A=projectPx(a,cam,r),B=projectPx(b,cam,r),dx=B[0]-A[0],dy=B[1]-A[1],st=THREE.MathUtils.clamp(((cx-A[0])*dx+(cy-A[1])*dy)/(dx*dx+dy*dy||1),0,1),t=perspectiveEdgeT(st,a,b,{matrixWorld:new THREE.Matrix4()},cam),world=a.clone().lerp(b,t),ndc=world.clone().project(cam);return exactVertexVisible(world,ndc,cam)?hit:null;
}
function reliableMarqueeEdges(box,cam,r,wire=false){const vertices=reliableMarqueeVertices(box,cam,r,wire),out=new Map();for(const [h,selected] of vertices){const mesh=pickMeshes.get(h);if(!mesh)continue;const edges=[];for(const edge of logicalEdges(mesh.geometry))if(selected.has(edge.a)&&selected.has(edge.b))edges.push(edge);if(edges.length)out.set(h,edges);}return out;}
const vertexTopologyCache=new WeakMap();
function vertexTopology(geometry){let t=vertexTopologyCache.get(geometry);if(t)return t;const groups=logicalVertexGroups(geometry),groupOf=new Int32Array(geometry.attributes.position.count),adj=groups.map(()=>new Set());groups.forEach((g,i)=>g.forEach(v=>groupOf[v]=i));for(const e of logicalEdges(geometry)){const a=groupOf[e.a],b=groupOf[e.b];if(a!==b){adj[a].add(b);adj[b].add(a);}}t={groups,groupOf,adj};vertexTopologyCache.set(geometry,t);return t;}
function setToolGeometry(object,positions,colors=null){if(!object)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));object.geometry.dispose();object.geometry=g;object.userData.active=positions.length>0;scheduleRender();}
function hideVertexToolGuides(){for(const o of [vertexTools.snapVertex,vertexTools.snapEdge,vertexTools.linePreview,vertexTools.loopPreview])if(o)o.userData.active=false;vertexTools.snap=null;vertexTools.loop=null;vertexTools.hole=null;scheduleRender();}
function surfaceWeights(mesh,seeds,radius){const g=mesh.geometry,pos=g.attributes.position,t=vertexTopology(g),dist=new Float64Array(t.groups.length);dist.fill(Infinity);const heap=[];const push=(d,n)=>{let i=heap.length;heap.push([d,n]);while(i){const p=(i-1)>>1;if(heap[p][0]<=d)break;heap[i]=heap[p];i=p;}heap[i]=[d,n];};const pop=()=>{const root=heap[0],last=heap.pop();if(heap.length){let i=0;heap[0]=last;for(;;){let a=i*2+1;if(a>=heap.length)break;let b=a+1,j=b<heap.length&&heap[b][0]<heap[a][0]?b:a;if(heap[i][0]<=heap[j][0])break;const q=heap[i];heap[i]=heap[j];heap[j]=q;i=j;}}return root;};for(const s of seeds)if(s>=0&&s<dist.length&&dist[s]!==0){dist[s]=0;push(0,s);}const a=new THREE.Vector3(),b=new THREE.Vector3();while(heap.length){const [d,n]=pop();if(d!==dist[n]||d>radius)continue;a.fromBufferAttribute(pos,t.groups[n][0]);for(const q of t.adj[n]){b.fromBufferAttribute(pos,t.groups[q][0]);const nd=d+a.distanceTo(b);if(nd<dist[q]&&nd<=radius){dist[q]=nd;push(nd,q);}}}const weights=new Float32Array(pos.count);for(let i=0;i<t.groups.length;i++){if(dist[i]>radius)continue;const x=radius>1e-9?dist[i]/radius:0,w=.5+.5*Math.cos(Math.PI*Math.min(1,x));for(const v of t.groups[i])weights[v]=w;}return weights;}
function selectedSoftSeeds(h,extra=null){const mesh=pickMeshes.get(h),t=mesh&&vertexTopology(mesh.geometry),s=polySelection.items.get(h),out=new Set();if(t&&s)for(const v of s.vertices)out.add(t.groupOf[v]);if(t&&extra?.h===h)out.add(t.groupOf[extra.vi]);return out;}
function updateSoftPreview(extra=null){const soft=vertexTools.soft;if(!soft.active||!vertexTools.softPreview)return;const positions=[],colors=[],p=new THREE.Vector3(),cold=new THREE.Color(0x24405f),hot=new THREE.Color(0xffb000),c=new THREE.Color();for(const h of selNodes){const mesh=pickMeshes.get(h);if(!mesh)continue;let weights=soft.weights.get(h);if(extra?.h===h){const seeds=selectedSoftSeeds(h,extra);weights=surfaceWeights(mesh,seeds,soft.radius);}if(!weights||weights.length!==mesh.geometry.attributes.position.count)continue;mesh.updateMatrixWorld(true);const pos=mesh.geometry.attributes.position,t=vertexTopology(mesh.geometry);for(const group of t.groups){let w=0;for(const vi of group)w=Math.max(w,weights[vi]);if(w<=0)continue;p.fromBufferAttribute(pos,group[0]).applyMatrix4(mesh.matrixWorld);positions.push(p.x,p.y,p.z);c.copy(cold).lerp(hot,w);colors.push(c.r,c.g,c.b);}}setToolGeometry(vertexTools.softPreview,positions,colors);}
function recalculateSoftSelection(){const soft=vertexTools.soft;if(!soft.active)return;soft.weights.clear();for(const h of selNodes){const mesh=pickMeshes.get(h);if(!mesh)continue;const seeds=selectedSoftSeeds(h);if(seeds.size)soft.weights.set(h,surfaceWeights(mesh,seeds,soft.radius));}soft.hoverSig=null;updateSoftPreview();}
function enableSoftSelection(){if(!polyMode||polyElementMode!=='vertex')return;if(vertexTools.mode!=='soft')leaveVertexTool();vertexTools.mode='soft';vertexTools.soft.active=true;recalculateSoftSelection();lastAttrKey=null;activateTab('tabAttributes');refreshAttributesPanel();}
function disableSoftSelection(refresh=true){if(!vertexTools.soft.active)return;vertexTools.soft.active=false;vertexTools.soft.weights.clear();vertexTools.soft.hoverSig=null;if(vertexTools.mode==='soft')vertexTools.mode=null;if(vertexTools.softPreview)vertexTools.softPreview.userData.active=false;if(refresh){lastAttrKey=null;refreshAttributesPanel();}scheduleRender();}
function remapSoftAfterTopology(h,oldWeights,remap){if(!vertexTools.soft.active||!oldWeights||!remap)return;const mesh=pickMeshes.get(h),n=mesh?.geometry?.attributes.position.count||0,next=new Float32Array(n);for(let i=0;i<oldWeights.length;i++){const w=oldWeights[i];if(!w)continue;for(const ni of remap.get(i)||[])next[ni]=Math.max(next[ni],w);}vertexTools.soft.weights.set(h,next);}
const LOOP_COS=Math.cos(Math.PI/8);
function loopWalk(mesh,start,next,refLen){const t=vertexTopology(mesh.geometry),{groups,adj}=t,pos=mesh.geometry.attributes.position,out=[start],seen=new Set([start]),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let prev=start,cur=next,closed=false;while(cur!=null){if(cur===start){closed=true;break;}if(seen.has(cur))break;out.push(cur);seen.add(cur);const candidates=[...adj[cur]].filter(n=>n!==prev);if(!candidates.length)break;a.fromBufferAttribute(pos,groups[cur][0]);b.fromBufferAttribute(pos,groups[prev][0]).sub(a).normalize();const scored=candidates.map(n=>{c.fromBufferAttribute(pos,groups[n][0]).sub(a);const len=c.length(),d=b.dot(c.clone().normalize()),cost=d+1+.35*Math.abs(Math.log((len||1)/(refLen||1)));return {n,d,cost};}).sort((x,y)=>x.cost-y.cost),chosen=scored[0];if(chosen.d>-LOOP_COS)break;prev=cur;cur=chosen.n;}return {nodes:out,closed};}
function vertexLoopFromEdge(hit,cx,cy,cam,r){const mesh=hit.mesh,pos=mesh.geometry.attributes.position,t=vertexTopology(mesh.geometry),start=t.groupOf[hit.edge[0]],first=t.groupOf[hit.edge[1]];if(start===first)return [];const origin=new THREE.Vector3().fromBufferAttribute(pos,t.groups[start][0]),firstPoint=new THREE.Vector3().fromBufferAttribute(pos,t.groups[first][0]),firstVec=firstPoint.clone().sub(origin),refLen=firstVec.length(),vf=firstVec.clone().normalize(),forward=loopWalk(mesh,start,first,refLen);if(forward.closed)return forward.nodes;const reverse=[...t.adj[start]].filter(n=>n!==first).map(n=>{const v=new THREE.Vector3().fromBufferAttribute(pos,t.groups[n][0]).sub(origin),len=v.length(),d=vf.dot(v.clone().normalize()),cost=d+1+.35*Math.abs(Math.log((len||1)/(refLen||1)));return {n,d,cost};}).sort((x,y)=>x.cost-y.cost),candidate=reverse[0],back=candidate&&candidate.d<=-LOOP_COS?loopWalk(mesh,start,candidate.n,refLen):{nodes:[start]};if(forward.nodes.length===2&&back.nodes.length===1){const A=projectPx(origin.clone().applyMatrix4(mesh.matrixWorld),cam,r),B=projectPx(firstPoint.clone().applyMatrix4(mesh.matrixWorld),cam,r);return [(cx-A[0])**2+(cy-A[1])**2<=(cx-B[0])**2+(cy-B[1])**2?start:first];}return [...back.nodes.reverse().slice(0,-1),...forward.nodes];}
function updateLoopPreview(cx,cy,vi){const r=rectFor(vi),cam=vpState.views[vi].cam,hit=reliableHoverEdge(cx,cy,cam,r,viewShading[vi]===1,EDIT_HIT_PX);vertexTools.view=vi;if(!hit){vertexTools.loop=null;setToolGeometry(vertexTools.loopPreview,[]);setToolGeometry(vertexTools.linePreview,[]);setToolGeometry(vertexTools.snapEdge,[]);return;}let nodes=vertexLoopFromEdge(hit,cx,cy,cam,r),t=vertexTopology(hit.mesh.geometry),pos=hit.mesh.geometry.attributes.position,p=new THREE.Vector3(),arr=[],edge=[];if(polyElementMode==='edge'&&nodes.length<2)nodes=[t.groupOf[hit.edge[0]],t.groupOf[hit.edge[1]]];hit.mesh.updateMatrixWorld(true);for(const n of nodes){p.fromBufferAttribute(pos,t.groups[n][0]).applyMatrix4(hit.mesh.matrixWorld);arr.push(p.x,p.y,p.z);}for(const vi0 of [hit.edge[0],hit.edge[1]]){p.fromBufferAttribute(pos,vi0).applyMatrix4(hit.mesh.matrixWorld);edge.push(p.x,p.y,p.z);}const closed=nodes.length>2&&t.adj[nodes[0]].has(nodes[nodes.length-1]);vertexTools.loop={h:hit.h,mesh:hit.mesh,nodes,edge:hit.edge.slice(),closed};if(polyElementMode==='edge'){if(closed){p.fromBufferAttribute(pos,t.groups[nodes[0]][0]).applyMatrix4(hit.mesh.matrixWorld);arr.push(p.x,p.y,p.z);}setToolGeometry(vertexTools.loopPreview,[]);setToolGeometry(vertexTools.linePreview,arr);}else{setToolGeometry(vertexTools.linePreview,[]);setToolGeometry(vertexTools.loopPreview,arr);}setToolGeometry(vertexTools.snapEdge,edge);}
function applyLoopSelection(mode='replace'){const q=vertexTools.loop;if(!q)return;if(mode==='replace')polySelection.items.clear();const entry=polySelEntry(q.h),t=vertexTopology(q.mesh.geometry);if(polyElementMode==='edge'){const pairs=new Set();for(let i=1;i<q.nodes.length;i++)pairs.add(q.nodes[i-1]<q.nodes[i]?q.nodes[i-1]+':'+q.nodes[i]:q.nodes[i]+':'+q.nodes[i-1]);if(q.closed)pairs.add(q.nodes[0]<q.nodes[q.nodes.length-1]?q.nodes[0]+':'+q.nodes[q.nodes.length-1]:q.nodes[q.nodes.length-1]+':'+q.nodes[0]);const chosen=[];for(const e of logicalEdges(q.mesh.geometry)){const a=t.groupOf[e.a],b=t.groupOf[e.b],key=a<b?a+':'+b:b+':'+a;if(pairs.has(key))chosen.push(...e.keys);}const on=chosen.some(k=>entry.edges.has(k));for(const k of chosen)mode==='invert'&&on?entry.edges.delete(k):entry.edges.add(k);}else{const all=[];for(const n of q.nodes)all.push(...t.groups[n]);const on=all.some(v=>entry.vertices.has(v));all.forEach(v=>mode==='invert'&&on?entry.vertices.delete(v):entry.vertices.add(v));}rebuildPolySelection();}
function leaveVertexTool(commitLine=true){if(vpState.renderer?.domElement)vpState.renderer.domElement.style.cursor='';if(vertexTools.mode==='lineCut'){if(commitLine)finishLineCut();else{vertexTools.mode=null;vertexTools.line=[];hideVertexToolGuides();lastAttrKey=null;refreshAttributesPanel();}return;}if(vertexTools.soft.active)disableSoftSelection(false);vertexTools.mode=null;vertexTools.line=[];hideVertexToolGuides();lastAttrKey=null;refreshAttributesPanel();}
function activateAddPoint(){if(!polyMode||polyElementMode!=='vertex')return;leaveVertexTool();vertexTools.mode='addPoint';hideVertexToolGuides();}
function activateLoopSelection(){if(!polyMode||(polyElementMode!=='vertex'&&polyElementMode!=='edge'))return;leaveVertexTool();vertexTools.mode='loop';vertexTools.line=[];hideVertexToolGuides();}
function stopVertexModeTool(){leaveVertexTool();}
function resolveVertexToolSnap(cx,cy,vi,allowFace=true){
const r=rectFor(vi),cam=vpState.views[vi].cam,wire=viewShading[vi]===1;if(!r)return null;
const vh=reliableHoverVertex(cx,cy,cam,r,wire,10),p=new THREE.Vector3();if(vh){vh.mesh.updateMatrixWorld(true);p.fromBufferAttribute(vh.mesh.geometry.attributes.position,vh.vi).applyMatrix4(vh.mesh.matrixWorld);const s=projectPx(p,cam,r);return {type:'vertex',h:vh.h,mesh:vh.mesh,vi:vh.vi,world:p.clone(),screen:[s[0],s[1]]};}
const edgeResult=eh=>{const pos=eh.mesh.geometry.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3();eh.mesh.updateMatrixWorld(true);a.fromBufferAttribute(pos,eh.edge[0]).applyMatrix4(eh.mesh.matrixWorld);b.fromBufferAttribute(pos,eh.edge[1]).applyMatrix4(eh.mesh.matrixWorld);const A=projectPx(a,cam,r),B=projectPx(b,cam,r),dx=B[0]-A[0],dy=B[1]-A[1],screenT=THREE.MathUtils.clamp(((cx-A[0])*dx+(cy-A[1])*dy)/(dx*dx+dy*dy||1),0,1),ca=new THREE.Vector4(a.x,a.y,a.z,1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix),cb=new THREE.Vector4(b.x,b.y,b.z,1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix),den=(1-screenT)*cb.w+screenT*ca.w,t=Math.abs(den)>1e-12?screenT*ca.w/den:screenT;return {type:'edge',h:eh.h,mesh:eh.mesh,edge:eh.edge,keys:eh.keys,world:a.clone().lerp(b,t),screen:[A[0]+dx*screenT,A[1]+dy*screenT]};};
const eh=reliableHoverEdge(cx,cy,cam,r,wire,10);if(eh)return edgeResult(eh);if(!allowFace)return null;
const fh=reliableFaceHit(cx,cy,cam,r,wire),h=fh&&meshToHash.get(fh.object);if(!fh||!h||!selNodes.has(h))return null;const mesh=fh.object;mesh.updateMatrixWorld(true);const g=mesh.geometry,pos=g.attributes.position,idx=g.index,ids=[idx?idx.getX(fh.faceIndex*3):fh.faceIndex*3,idx?idx.getX(fh.faceIndex*3+1):fh.faceIndex*3+1,idx?idx.getX(fh.faceIndex*3+2):fh.faceIndex*3+2],worlds=ids.map(i=>new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld)),screens=worlds.map(v=>projectPx(v,cam,r));let best=-1,bd=100;for(let i=0;i<3;i++){const d=pointSegDistSq(cx,cy,screens[i][0],screens[i][1],screens[(i+1)%3][0],screens[(i+1)%3][1]);if(d<=bd){bd=d;best=i;}}if(best>=0)return edgeResult({h,mesh,edge:[ids[best],ids[(best+1)%3],polyEdgeKey(ids[best],ids[(best+1)%3])],keys:[polyEdgeKey(ids[best],ids[(best+1)%3])]});
const world=fh.point?fh.point.clone():pickRay.ray.at(fh.distance,new THREE.Vector3());return {type:'face',h,mesh,faceIndex:fh.faceIndex,world,screen:[cx,cy]};
}
function showVertexToolSnap(snap){vertexTools.snap=snap;if(!snap){setToolGeometry(vertexTools.snapVertex,[]);setToolGeometry(vertexTools.snapEdge,[]);return;}const p=snap.world;setToolGeometry(vertexTools.snapVertex,[p.x,p.y,p.z]);if(snap.type==='edge'){const pos=snap.mesh.geometry.attributes.position,a=new THREE.Vector3(),b=new THREE.Vector3();snap.mesh.updateMatrixWorld(true);a.fromBufferAttribute(pos,snap.edge[0]).applyMatrix4(snap.mesh.matrixWorld);b.fromBufferAttribute(pos,snap.edge[1]).applyMatrix4(snap.mesh.matrixWorld);setToolGeometry(vertexTools.snapEdge,[a.x,a.y,a.z,b.x,b.y,b.z]);}else setToolGeometry(vertexTools.snapEdge,[]);}
function screenPointOnWorkPlane(cx,cy,vi){const r=rectFor(vi),cam=vpState.views[vi]?.cam;if(!r||!cam)return null;cam.updateMatrixWorld();cam.updateProjectionMatrix();pickNdc.set(((cx-r.x)/r.w)*2-1,-((cy-r.y)/r.h)*2+1);pickRay.setFromCamera(pickNdc,cam);const center=gizmoVisible?gizmo.pos.clone():new THREE.Vector3(),normal=cam.getWorldDirection(new THREE.Vector3()),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,center),world=new THREE.Vector3();return pickRay.ray.intersectPlane(plane,world)||pickRay.ray.at(Math.max(1000,cam.position.distanceTo(center)),world);}
function lineCutPointAt(cx,cy,vi){const snap=resolveVertexToolSnap(cx,cy,vi,true);if(snap)return snap;const world=screenPointOnWorkPlane(cx,cy,vi);return world?{type:'air',h:null,mesh:null,world,screen:[cx,cy]}:null;}
function updateAddPointPreview(cx,cy,vi){vertexTools.view=vi;const snap=resolveVertexToolSnap(cx,cy,vi,true);showVertexToolSnap(snap);if(vpState.renderer?.domElement)vpState.renderer.domElement.style.cursor='';}
function updateLineCutPreview(cx,cy,vi){vertexTools.view=vi;const point=lineCutPointAt(cx,cy,vi);showVertexToolSnap(point&&point.type!=='air'?point:null);const pts=vertexTools.line.map(x=>x.world.clone());if(point)pts.push(point.world.clone());const arr=[];pts.forEach(p=>arr.push(p.x,p.y,p.z));setToolGeometry(vertexTools.linePreview,arr);}
function cloneTriVertex(v){return {p:v.p.clone(),uv:v.uv&&v.uv.clone()};}
function makeGeometryFromTriangles(tris,hasUv){const pp=[],uu=[],ii=[];let last=null,start=0;const g=new THREE.BufferGeometry();for(let f=0;f<tris.length;f++){const tri=tris[f];for(const v of tri.v){pp.push(v.p.x,v.p.y,v.p.z);if(hasUv)uu.push(v.uv?.x||0,v.uv?.y||0);ii.push(ii.length);}if(last===null){last=tri.mat;start=f*3;}else if(last!==tri.mat){g.addGroup(start,f*3-start,last);last=tri.mat;start=f*3;}}if(last!==null)g.addGroup(start,ii.length-start,last);g.setAttribute('position',new THREE.Float32BufferAttribute(pp,3));if(hasUv)g.setAttribute('uv',new THREE.Float32BufferAttribute(uu,2));g.setIndex(ii);g.computeVertexNormals();g.computeBoundingBox();return g;}
function meshTriangles(mesh){const g=mesh.geometry,pos=g.attributes.position,uv=g.attributes.uv,idx=g.index,n=idx?idx.count/3:pos.count/3,out=[];for(let fi=0;fi<n;fi++){const ids=[idx?idx.getX(fi*3):fi*3,idx?idx.getX(fi*3+1):fi*3+1,idx?idx.getX(fi*3+2):fi*3+2],v=ids.map(i=>({p:new THREE.Vector3().fromBufferAttribute(pos,i),uv:uv?new THREE.Vector2().fromBufferAttribute(uv,i):null}));out.push({v,mat:triangleMaterialIndex(g,fi),sourceFace:fi});}return out;}
function installEditedGeometry(mesh,g){const old=mesh.geometry;mesh.geometry=g;old.dispose();const remap=rebuildCreaseRender(mesh);refreshWireOverlay(mesh);return remap;}
function commitGeometryEdit(hashes,beforeGeom,beforeSel){const afterGeom=capturePolyGeometries(hashes),afterSel=capturePolySelectionState();pushCmd({redo(){restorePolyGeometries(afterGeom);restorePolySelectionState(afterSel);},undo(){restorePolyGeometries(beforeGeom);restorePolySelectionState(beforeSel);}});rebuildPolySelection(true);scheduleGeneratorEvaluation();}
function addPointAt(cx,cy,vi){const snap=resolveVertexToolSnap(cx,cy,vi,true);if(!snap||snap.type==='vertex')return;const mesh=snap.mesh,h=snap.h,beforeGeom=capturePolyGeometries([h]),beforeSel=capturePolySelectionState(),logicalSel=capturePolyLogicalSelection(),tris=meshTriangles(mesh),inv=mesh.matrixWorld.clone().invert(),local=snap.world.clone().applyMatrix4(inv),key=p=>`${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`,out=[];if(snap.type==='face'){for(const tri of tris){if(tri.sourceFace!==snap.faceIndex){out.push(tri);continue;}const p={p:local.clone(),uv:null};if(tri.v[0].uv){const w=barycentric2DFrom3D(local,tri.v[0].p,tri.v[1].p,tri.v[2].p);p.uv=tri.v[0].uv.clone().multiplyScalar(w[0]).addScaledVector(tri.v[1].uv,w[1]).addScaledVector(tri.v[2].uv,w[2]);}out.push({v:[cloneTriVertex(tri.v[0]),cloneTriVertex(tri.v[1]),cloneTriVertex(p)],mat:tri.mat},{v:[cloneTriVertex(tri.v[1]),cloneTriVertex(tri.v[2]),cloneTriVertex(p)],mat:tri.mat},{v:[cloneTriVertex(tri.v[2]),cloneTriVertex(tri.v[0]),cloneTriVertex(p)],mat:tri.mat});}}else{const pos=mesh.geometry.attributes.position,ka=key(new THREE.Vector3().fromBufferAttribute(pos,snap.edge[0])),kb=key(new THREE.Vector3().fromBufferAttribute(pos,snap.edge[1]));for(const tri of tris){let found=-1;for(let e=0;e<3;e++){const x=key(tri.v[e].p),y=key(tri.v[(e+1)%3].p);if((x===ka&&y===kb)||(x===kb&&y===ka)){found=e;break;}}if(found<0){out.push(tri);continue;}const a=tri.v[found],b=tri.v[(found+1)%3],c=tri.v[(found+2)%3],ab=b.p.clone().sub(a.p),t=THREE.MathUtils.clamp(local.clone().sub(a.p).dot(ab)/(ab.lengthSq()||1),0,1),p={p:a.p.clone().lerp(b.p,t),uv:a.uv&&b.uv?a.uv.clone().lerp(b.uv,t):null};out.push({v:[cloneTriVertex(a),cloneTriVertex(p),cloneTriVertex(c)],mat:tri.mat},{v:[cloneTriVertex(p),cloneTriVertex(b),cloneTriVertex(c)],mat:tri.mat});}}installEditedGeometry(mesh,makeGeometryFromTriangles(out,!!mesh.geometry.attributes.uv));restorePolyLogicalSelection(logicalSel);commitGeometryEdit([h],beforeGeom,beforeSel);}
function addPointToolClick(cx,cy,vi){const snap=resolveVertexToolSnap(cx,cy,vi,true);if(!snap)return false;if(snap.type!=='vertex')addPointAt(cx,cy,vi);return true;}
function barycentric2DFrom3D(p,a,b,c){const v0=b.clone().sub(a),v1=c.clone().sub(a),v2=p.clone().sub(a),d00=v0.dot(v0),d01=v0.dot(v1),d11=v1.dot(v1),d20=v2.dot(v0),d21=v2.dot(v1),den=d00*d11-d01*d01||1,v=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den;return [1-v-w,v,w];}
function cross2(ax,ay,bx,by){return ax*by-ay*bx;}
function segmentIntersection2(a,b,c,d){const rx=b[0]-a[0],ry=b[1]-a[1],sx=d[0]-c[0],sy=d[1]-c[1],den=cross2(rx,ry,sx,sy);if(Math.abs(den)<1e-8)return null;const qx=c[0]-a[0],qy=c[1]-a[1],t=cross2(qx,qy,sx,sy)/den,u=cross2(qx,qy,rx,ry)/den;if(t<-1e-6||t>1+1e-6||u<-1e-6||u>1+1e-6)return null;return {t:THREE.MathUtils.clamp(t,0,1),u:THREE.MathUtils.clamp(u,0,1),screen:[a[0]+rx*t,a[1]+ry*t]};}
function pointInScreenTri(p,a,b,c){const den=cross2(b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1]);if(Math.abs(den)<1e-8)return null;const v=cross2(p[0]-a[0],p[1]-a[1],c[0]-a[0],c[1]-a[1])/den,w=cross2(b[0]-a[0],b[1]-a[1],p[0]-a[0],p[1]-a[1])/den,u=1-v-w;return u>=-1e-5&&v>=-1e-5&&w>=-1e-5?[u,v,w]:null;}
function localClipW(p,mesh,cam){return new THREE.Vector4(p.x,p.y,p.z,1).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix).w;}
function perspectiveEdgeT(t,a,b,mesh,cam){const wa=localClipW(a,mesh,cam),wb=localClipW(b,mesh,cam),den=(1-t)*wb+t*wa;return Math.abs(den)>1e-12?t*wa/den:t;}
function screenTriVertex(tri,w,mesh,cam){const q=w.map((x,i)=>x/(localClipW(tri.v[i].p,mesh,cam)||1e-12)),sum=q[0]+q[1]+q[2]||1;q[0]/=sum;q[1]/=sum;q[2]/=sum;const p=tri.v[0].p.clone().multiplyScalar(q[0]).addScaledVector(tri.v[1].p,q[1]).addScaledVector(tri.v[2].p,q[2]),uv=tri.v[0].uv?tri.v[0].uv.clone().multiplyScalar(q[0]).addScaledVector(tri.v[1].uv,q[1]).addScaledVector(tri.v[2].uv,q[2]):null;return {p,uv};}
function localEdgeKey(a,b){const ka=`${a.x.toFixed(5)},${a.y.toFixed(5)},${a.z.toFixed(5)}`,kb=`${b.x.toFixed(5)},${b.y.toFixed(5)},${b.z.toFixed(5)}`;return ka<kb?ka+'|'+kb:kb+'|'+ka;}
function rememberEdgeCut(cuts,a,b,p){const key=localEdgeKey(a,b),list=cuts.get(key)||[];if(!list.some(q=>q.distanceToSquared(p)<1e-10)){list.push(p.clone());cuts.set(key,list);}}
function pointInTriangle3DInclusive(p,a,b,c){const v0=b.clone().sub(a),v1=c.clone().sub(a),v2=p.clone().sub(a),d00=v0.dot(v0),d01=v0.dot(v1),d11=v1.dot(v1),d20=v2.dot(v0),d21=v2.dot(v1),den=d00*d11-d01*d01;if(Math.abs(den)<1e-16)return false;const v=(d11*d20-d01*d21)/den,w=(d00*d21-d01*d20)/den;return v>=-1e-8&&w>=-1e-8&&v+w<=1+1e-8;}
function appendTriangulatedBoundary(boundary,tri,out){const poly=boundary.map(cloneTriVertex),ab=new THREE.Vector3(),ac=new THREE.Vector3();let guard=poly.length*poly.length;while(poly.length>3&&guard--){let ear=-1;for(let i=0;i<poly.length;i++){const pi=(i+poly.length-1)%poly.length,si=(i+1)%poly.length,p=poly[pi],q=poly[i],s=poly[si];if(ab.subVectors(q.p,p.p).cross(ac.subVectors(s.p,q.p)).lengthSq()<=1e-14)continue;let blocked=false;for(let j=0;j<poly.length;j++)if(j!==pi&&j!==i&&j!==si&&pointInTriangle3DInclusive(poly[j].p,p.p,q.p,s.p)){blocked=true;break;}if(blocked)continue;ear=i;out.push({v:[cloneTriVertex(p),cloneTriVertex(q),cloneTriVertex(s)],mat:tri.mat,sourceFace:tri.sourceFace,kind:tri.kind});break;}if(ear<0)break;poly.splice(ear,1);}if(poly.length===3&&ab.subVectors(poly[1].p,poly[0].p).cross(ac.subVectors(poly[2].p,poly[0].p)).lengthSq()>1e-14)out.push({v:poly.map(cloneTriVertex),mat:tri.mat,sourceFace:tri.sourceFace,kind:tri.kind});}
function conformTriangleEdgeSplits(tris,cuts){if(!cuts.size)return tris.slice();const out=[];for(const tri of tris){const boundary=[];let changed=false;for(let e=0;e<3;e++){const a=tri.v[e],b=tri.v[(e+1)%3],list=cuts.get(localEdgeKey(a.p,b.p));boundary.push(cloneTriVertex(a));if(!list)continue;const edge=b.p.clone().sub(a.p),den=edge.lengthSq()||1,parts=list.map(p=>({p,t:p.clone().sub(a.p).dot(edge)/den})).filter(q=>q.t>1e-6&&q.t<1-1e-6).sort((x,y)=>x.t-y.t);let last=-1;for(const q of parts){if(q.t-last<1e-6)continue;last=q.t;boundary.push({p:a.p.clone().lerp(b.p,q.t),uv:a.uv&&b.uv?a.uv.clone().lerp(b.uv,q.t):null});changed=true;}}if(!changed)out.push(tri);else{const before=out.length;appendTriangulatedBoundary(boundary,tri,out);if(out.length===before)out.push(tri);}}return out;}
function cutTriangleByScreenSegment(tri,s0,s1,mesh,cam,r,visibleOnly,edgeCuts){const screen=tri.v.map(v=>{const p=v.p.clone().applyMatrix4(mesh.matrixWorld),q=projectPx(p,cam,r);return [q[0],q[1]];}),hits=[];if(Math.abs(cross2(screen[1][0]-screen[0][0],screen[1][1]-screen[0][1],screen[2][0]-screen[0][0],screen[2][1]-screen[0][1]))<1e-4)return [tri];for(let e=0;e<3;e++){const q=segmentIntersection2(s0,s1,screen[e],screen[(e+1)%3]);if(!q)continue;const et=perspectiveEdgeT(q.u,tri.v[e].p,tri.v[(e+1)%3].p,mesh,cam),v={p:tri.v[e].p.clone().lerp(tri.v[(e+1)%3].p,et),uv:tri.v[e].uv?tri.v[e].uv.clone().lerp(tri.v[(e+1)%3].uv,et):null};if(!hits.some(x=>(x.screen[0]-q.screen[0])**2+(x.screen[1]-q.screen[1])**2<.01))hits.push({edge:e,u:q.u,t:q.t,screen:q.screen,v});}const inside=[];for(const p of [s0,s1]){const w=pointInScreenTri(p,screen[0],screen[1],screen[2]);if(w)inside.push({screen:p,v:screenTriVertex(tri,w,mesh,cam)});}if(hits.length<2&&!inside.length)return [tri];const trueInside=inside.filter(p=>!hits.some(h=>(h.screen[0]-p.screen[0])**2+(h.screen[1]-p.screen[1])**2<.01));if(hits.length===1&&!trueInside.length){const h=hits[0],world=h.v.p.clone().applyMatrix4(mesh.matrixWorld),ndc=world.clone().project(cam);if(visibleOnly&&!exactVertexVisible(world,ndc,cam))return [tri];if(h.u>1e-6&&h.u<1-1e-6)rememberEdgeCut(edgeCuts,tri.v[h.edge].p,tri.v[(h.edge+1)%3].p,h.v.p);return [tri];}let probe=null;if(hits.length>=2)probe=hits[0].v.p.clone().lerp(hits[1].v.p,.5);else if(inside.length)probe=inside[0].v.p.clone();if(visibleOnly&&probe){const world=probe.applyMatrix4(mesh.matrixWorld),ndc=world.clone().project(cam);if(!exactVertexVisible(world,ndc,cam))return [tri];}for(const h of hits)if(h.u>1e-6&&h.u<1-1e-6)rememberEdgeCut(edgeCuts,tri.v[h.edge].p,tri.v[(h.edge+1)%3].p,h.v.p);if(hits.length>=2){hits.sort((a,b)=>a.t-b.t);const chosen=[hits[0],hits[hits.length-1]],boundary=[],marks=[],vertexMarks=[],hitMarks=new Map();for(let e=0;e<3;e++){vertexMarks[e]=boundary.length;boundary.push(cloneTriVertex(tri.v[e]));for(const h of chosen.filter(x=>x.edge===e&&x.u>1e-6&&x.u<1-1e-6).sort((a,b)=>a.u-b.u)){hitMarks.set(h,boundary.length);boundary.push(cloneTriVertex(h.v));}}for(const h of chosen)marks.push(h.u<=1e-6?vertexMarks[h.edge]:h.u>=1-1e-6?vertexMarks[(h.edge+1)%3]:hitMarks.get(h));if(marks.length<2||marks[0]===marks[1])return [tri];let i=marks[0],j=marks[1];if(i>j)[i,j]=[j,i];const p1=boundary.slice(i,j+1),p2=boundary.slice(j).concat(boundary.slice(0,i+1)),out=[];for(const poly of [p1,p2])appendTriangulatedBoundary(poly,tri,out);return out.length?out:[tri];}const center=inside[0]?.v;if(!center)return [tri];const out=[];for(let e=0;e<3;e++)out.push({v:[cloneTriVertex(tri.v[e]),cloneTriVertex(tri.v[(e+1)%3]),cloneTriVertex(center)],mat:tri.mat,sourceFace:tri.sourceFace});if(inside[1]){for(let i=0;i<out.length;i++){const sc=out[i].v.map(v=>{const q=projectPx(v.p.clone().applyMatrix4(mesh.matrixWorld),cam,r);return [q[0],q[1]];}),w=pointInScreenTri(inside[1].screen,sc[0],sc[1],sc[2]);if(!w)continue;const q=inside[1].v,t=out.splice(i,1)[0];for(let e=0;e<3;e++)out.push({v:[cloneTriVertex(t.v[e]),cloneTriVertex(t.v[(e+1)%3]),cloneTriVertex(q)],mat:t.mat,sourceFace:t.sourceFace});break;}}return out;}
function applyLineCut(){if(vertexTools.line.length<2)return;const vi=vertexTools.view,r=rectFor(vi),cam=vpState.views[vi]?.cam;if(!r||!cam)return;const hashes=[...selNodes].filter(h=>pickMeshes.has(h)),beforeGeom=capturePolyGeometries(hashes),beforeSel=capturePolySelectionState(),logicalSel=capturePolyLogicalSelection(),segments=[];for(let i=1;i<vertexTools.line.length;i++)segments.push([vertexTools.line[i-1].screen,vertexTools.line[i].screen]);let changed=false;for(const h of hashes){const mesh=pickMeshes.get(h);if(!mesh)continue;mesh.updateMatrixWorld(true);let tris=meshTriangles(mesh);for(const seg of segments){const next=[],edgeCuts=new Map();for(const tri of tris)next.push(...cutTriangleByScreenSegment(tri,seg[0],seg[1],mesh,cam,r,vertexTools.visibleOnly,edgeCuts));tris=conformTriangleEdgeSplits(next,edgeCuts);}if(tris.length!==(mesh.geometry.index?mesh.geometry.index.count/3:mesh.geometry.attributes.position.count/3)){installEditedGeometry(mesh,makeGeometryFromTriangles(tris,!!mesh.geometry.attributes.uv));changed=true;}}if(!changed)return;restorePolyLogicalSelection(logicalSel);commitGeometryEdit(hashes,beforeGeom,beforeSel);}
function lineCutAddPoint(cx,cy,vi){const point=lineCutPointAt(cx,cy,vi);if(!point)return false;vertexTools.view=vi;vertexTools.line.push(point);updateLineCutPreview(point.screen[0],point.screen[1],vi);return true;}
function activateLineCut(){if(!polyMode)return;leaveVertexTool();vertexTools.mode='lineCut';vertexTools.line=[];hideVertexToolGuides();lastAttrKey=null;activateTab('tabAttributes');refreshAttributesPanel();}
function finishLineCut(){if(vertexTools.mode!=='lineCut')return;applyLineCut();vertexTools.mode=null;vertexTools.line=[];hideVertexToolGuides();lastAttrKey=null;refreshAttributesPanel();}
function meshBoundaryLoops(mesh){
const g=mesh.geometry,pos=g.attributes.position,idx=g.index,top=vertexTopology(g),groupOf=top.groupOf,P=top.groups.map(v=>new THREE.Vector3().fromBufferAttribute(pos,v[0])),faces=(idx?idx.count:pos.count)/3,edges=new Map(),key=(a,b)=>a<b?a+':'+b:b+':'+a;
for(let fi=0;fi<faces;fi++){const v=[0,1,2].map(j=>groupOf[idx?idx.getX(fi*3+j):fi*3+j]);for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3],k=key(a,b),r=edges.get(k);if(r)r.count++;else edges.set(k,{a,b,count:1,mat:triangleMaterialIndex(g,fi)});}}
const boundary=[...edges.values()].filter(e=>e.count===1),at=new Map();boundary.forEach((e,i)=>{for(const v of [e.a,e.b]){const a=at.get(v)||[];a.push(i);at.set(v,a);}});const unused=new Set(boundary.map((_,i)=>i)),loops=[];
while(unused.size){const first=unused.values().next().value,e0=boundary[first],ids=[e0.a,e0.b];unused.delete(first);let prev=e0.a,cur=e0.b,guard=boundary.length+1;while(guard--&&cur!==ids[0]){const ei=(at.get(cur)||[]).find(i=>unused.has(i));if(ei==null)break;unused.delete(ei);const e=boundary[ei],next=e.a===cur?e.b:e.a;if(next===prev)break;ids.push(next);prev=cur;cur=next;}if(cur===ids[0]){ids.pop();if(ids.length>=3)loops.push({ids,points:ids.map(i=>P[i].clone()),mat:e0.mat});}}
return {loops,P,top};
}
function updateCloseHolePreview(cx,cy,vi){const r=rectFor(vi),cam=vpState.views[vi]?.cam;if(!r||!cam)return;vertexTools.view=vi;let best=null,bd=EDIT_HIT_PX*EDIT_HIT_PX;for(const h of selNodes){const mesh=pickMeshes.get(h);if(!mesh)continue;mesh.updateMatrixWorld(true);for(const loop of meshBoundaryLoops(mesh).loops){const world=loop.points.map(p=>p.clone().applyMatrix4(mesh.matrixWorld)),screen=world.map(p=>projectPx(p,cam,r));let d=Infinity;for(let i=0;i<screen.length;i++)d=Math.min(d,pointSegDistSq(cx,cy,screen[i][0],screen[i][1],screen[(i+1)%screen.length][0],screen[(i+1)%screen.length][1]));if(d<bd){bd=d;best={h,mesh,loop,world};}}}vertexTools.hole=best;const arr=[];if(best)for(let i=0;i<=best.world.length;i++){const p=best.world[i%best.world.length];arr.push(p.x,p.y,p.z);}setToolGeometry(vertexTools.loopPreview,[]);setToolGeometry(vertexTools.linePreview,arr);}
function triangulateBoundaryLoop(points,mat){const p=points.slice().reverse(),normal=new THREE.Vector3();for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];normal.x+=(a.y-b.y)*(a.z+b.z);normal.y+=(a.z-b.z)*(a.x+b.x);normal.z+=(a.x-b.x)*(a.y+b.y);}const an=[Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z)],drop=an[0]>an[1]?(an[0]>an[2]?0:2):(an[1]>an[2]?1:2),xy=q=>drop===0?[q.y,q.z]:drop===1?[q.x,q.z]:[q.x,q.y],q=p.map(xy),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),inside=(x,a,b,c,s)=>cross(a,b,x)*s>=-1e-8&&cross(b,c,x)*s>=-1e-8&&cross(c,a,x)*s>=-1e-8;let area=0;for(let i=0;i<q.length;i++)area+=q[i][0]*q[(i+1)%q.length][1]-q[(i+1)%q.length][0]*q[i][1];const sign=area>=0?1:-1,ids=p.map((_,i)=>i),out=[];let guard=ids.length*ids.length;while(ids.length>3&&guard--){let ear=-1;for(let k=0;k<ids.length;k++){const a=ids[(k+ids.length-1)%ids.length],b=ids[k],c=ids[(k+1)%ids.length];if(cross(q[a],q[b],q[c])*sign<=1e-8)continue;if(ids.some(i=>i!==a&&i!==b&&i!==c&&inside(q[i],q[a],q[b],q[c],sign)))continue;out.push({v:[p[a],p[b],p[c]].map(x=>({p:x.clone(),uv:null})),mat});ear=k;break;}if(ear<0)break;ids.splice(ear,1);}if(ids.length===3)out.push({v:ids.map(i=>({p:p[i].clone(),uv:null})),mat});return out;}
function closeHoveredHole(){const hit=vertexTools.hole;if(!hit)return false;const h=hit.h,mesh=hit.mesh,beforeGeom=capturePolyGeometries([h]),beforeSel=capturePolySelectionState(),tris=meshTriangles(mesh),cap=triangulateBoundaryLoop(hit.loop.points,hit.loop.mat);if(!cap.length)return false;installEditedGeometry(mesh,makeGeometryFromTriangles(tris.concat(cap),!!mesh.geometry.attributes.uv));polySelection.items.clear();commitGeometryEdit([h],beforeGeom,beforeSel);vertexTools.hole=null;setToolGeometry(vertexTools.linePreview,[]);return true;}
function activateCloseHole(){if(!polyMode||polyElementMode!=='face')return;leaveVertexTool();vertexTools.mode='closeHole';vertexTools.hole=null;hideVertexToolGuides();lastAttrKey=null;refreshAttributesPanel();}
function bridgeSelectedEdges(){let done=false;for(const [h,s] of polySelection.items){if(done||!s.edges.size)continue;const mesh=pickMeshes.get(h),g=mesh?.geometry,pos=g?.attributes.position;if(!pos)continue;const top=vertexTopology(g),groupOf=top.groupOf,P=top.groups.map(v=>new THREE.Vector3().fromBufferAttribute(pos,v[0])),key=(a,b)=>a<b?a+':'+b:b+':'+a,inc=new Map(),idx=g.index,fc=(idx?idx.count:pos.count)/3;for(let fi=0;fi<fc;fi++){const v=[0,1,2].map(j=>groupOf[idx?idx.getX(fi*3+j):fi*3+j]);for(let j=0;j<3;j++){const k=key(v[j],v[(j+1)%3]);inc.set(k,(inc.get(k)||0)+1);}}const chosen=[];for(const e of logicalEdges(g))if(e.keys.some(k=>s.edges.has(k))){const a=groupOf[e.a],b=groupOf[e.b];if((inc.get(key(a,b))||0)!==1)return;chosen.push([a,b]);}const adj=new Map();chosen.forEach((e,i)=>e.forEach(v=>{const a=adj.get(v)||[];a.push(i);adj.set(v,a);}));if([...adj.values()].some(a=>a.length>2))return;const unused=new Set(chosen.map((_,i)=>i)),parts=[];while(unused.size){let ei=[...unused].find(i=>chosen[i].some(v=>(adj.get(v)||[]).length===1));if(ei==null)ei=unused.values().next().value;const e=chosen[ei],start=(adj.get(e[0])||[]).length===1?e[0]:e[1],ids=[start];let cur=start,guard=chosen.length+1;while(guard--){const ni=(adj.get(cur)||[]).find(i=>unused.has(i));if(ni==null)break;unused.delete(ni);const q=chosen[ni],next=q[0]===cur?q[1]:q[0];ids.push(next);cur=next;if(cur===start){ids.pop();break;}}parts.push({ids,closed:cur===start});}if(parts.length!==2||parts[0].closed!==parts[1].closed||parts[0].ids.length!==parts[1].ids.length)return;let A=parts[0].ids,B=parts[1].ids,n=A.length,best=B.slice(),score=Infinity,candidates=[];if(parts[0].closed)for(let rev=0;rev<2;rev++)for(let shift=0;shift<n;shift++)candidates.push(A.map((_,i)=>B[((rev?shift-i:shift+i)%n+n)%n]));else candidates=[B.slice(),B.slice().reverse()];for(const q of candidates){let d=0;for(let i=0;i<n;i++)d+=P[A[i]].distanceToSquared(P[q[i]]);if(d<score){score=d;best=q;}}B=best;const beforeGeom=capturePolyGeometries([h]),beforeSel=capturePolySelectionState(),tris=meshTriangles(mesh),count=parts[0].closed?n:n-1;for(let i=0;i<count;i++){const j=(i+1)%n,a=P[A[i]],b=P[A[j]],c=P[B[j]],d=P[B[i]];tris.push({v:[a,b,c].map(p=>({p:p.clone(),uv:null})),mat:0},{v:[a,c,d].map(p=>({p:p.clone(),uv:null})),mat:0});}installEditedGeometry(mesh,makeGeometryFromTriangles(tris,!!g.attributes.uv));polySelection.items.clear();commitGeometryEdit([h],beforeGeom,beforeSel);done=true;}return done;}
function applyLogicalEdgeSelection(set,edge,mode){const selected=edge.keys.some(key=>set.has(key));if(mode==='invert'){for(const key of edge.keys)selected?set.delete(key):set.add(key);}else for(const key of edge.keys)set.add(key);}
function clearHover(){ if(hovObj){ hovObj.material.opacity=0.5; hovObj=null; } }
function clearPolyHover(){ polyHover.kind=null; polyHover.view=-1; if(polyHover.face)polyHover.face.visible=false; if(polyHover.faceBack)polyHover.faceBack.visible=false; if(polyHover.edge)polyHover.edge.visible=false; if(polyHover.vertex)polyHover.vertex.visible=false; }
const pointSegDistSq=pointSegmentDistanceSq;
const _ph0=new THREE.Vector3(),_ph1=new THREE.Vector3(),_ph2=new THREE.Vector3();
function updatePolyHover(cx,cy){ if(!polyMode){ clearPolyHover(); return; }
const vi=viewAt(cx,cy); if(vi<0){ clearPolyHover(); return; } const r=rectFor(vi); if(!r){ clearPolyHover(); return; }
if(vertexTools.mode==='lineCut'){clearPolyHover();updateLineCutPreview(cx,cy,vi);return;}
if(polyElementMode==='face'&&vertexTools.mode==='closeHole'){clearPolyHover();updateCloseHolePreview(cx,cy,vi);return;}
if(polyElementMode==='vertex'&&vertexTools.mode==='addPoint'){clearPolyHover();updateAddPointPreview(cx,cy,vi);return;}
if((polyElementMode==='vertex'||polyElementMode==='edge')&&vertexTools.mode==='loop'){clearPolyHover();updateLoopPreview(cx,cy,vi);return;}
if(polyElementMode==='vertex'){const hit=reliableHoverVertex(cx,cy,vpState.views[vi].cam,r,viewShading[vi]===1);clearPolyHover();if(vertexTools.soft.active){const sig=hit?`${hit.h}:${hit.vi}`:'none';if(sig!==vertexTools.soft.hoverSig){vertexTools.soft.hoverSig=sig;updateSoftPreview(hit?{h:hit.h,vi:hit.vi}:null);}}if(!hit)return;const p=hit.mesh.geometry.attributes.position,q=polyHover.vertexPos;hit.mesh.updateMatrixWorld(true);_ph0.fromBufferAttribute(p,hit.vi).applyMatrix4(hit.mesh.matrixWorld);q[0]=_ph0.x;q[1]=_ph0.y;q[2]=_ph0.z;polyHover.vertex.geometry.attributes.position.needsUpdate=true;polyHover.view=vi;polyHover.kind='vertex';return;}
if(polyElementMode==='edge'){const hit=reliableHoverEdge(cx,cy,vpState.views[vi].cam,r,viewShading[vi]===1);clearPolyHover();if(!hit)return;const p=hit.mesh.geometry.attributes.position,q=polyHover.edgePos;hit.mesh.updateMatrixWorld(true);_ph0.fromBufferAttribute(p,hit.edge[0]).applyMatrix4(hit.mesh.matrixWorld);_ph1.fromBufferAttribute(p,hit.edge[1]).applyMatrix4(hit.mesh.matrixWorld);q.set([_ph0.x,_ph0.y,_ph0.z,_ph1.x,_ph1.y,_ph1.z]);polyHover.edge.geometry.attributes.position.needsUpdate=true;polyHover.view=vi;polyHover.kind='edge';return;}
const cam=vpState.views[vi].cam,hit=reliableFaceHit(cx,cy,cam,r,viewShading[vi]===1); if(!hit||hit.faceIndex==null){ clearPolyHover(); return; }
const mesh=hit.object; if(!selNodes.has(meshToHash.get(mesh))){ clearPolyHover(); return; } const geo=mesh.geometry, pos=geo.attributes.position, idx=geo.index; const fi=hit.faceIndex;
const ia=idx?idx.getX(fi*3):fi*3, ib=idx?idx.getX(fi*3+1):fi*3+1, ic=idx?idx.getX(fi*3+2):fi*3+2;
mesh.updateMatrixWorld(true); _ph0.fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld); _ph1.fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld); _ph2.fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld);
const a=projectPx(_ph0,cam,r),b=projectPx(_ph1,cam,r),c=projectPx(_ph2,cam,r); const V=[_ph0,_ph1,_ph2], P=[a,b,c];
let viMin=0,vd=Infinity; for(let i=0;i<3;i++){ const d=(cx-P[i][0])**2+(cy-P[i][1])**2; if(d<vd){vd=d;viMin=i;} }
let ei=0,ed=Infinity; for(let i=0;i<3;i++){ const d=pointSegDistSq(cx,cy,P[i][0],P[i][1],P[(i+1)%3][0],P[(i+1)%3][1]); if(d<ed){ed=d;ei=i;} }
clearPolyHover(); polyHover.view=vi;
if(polyElementMode==='vertex'){ if(vd>100)return; const v=V[viMin],q=polyHover.vertexPos; q[0]=v.x;q[1]=v.y;q[2]=v.z; polyHover.vertex.geometry.attributes.position.needsUpdate=true; polyHover.kind='vertex'; return; }
if(polyElementMode==='edge'){ if(ed>100)return; const u=V[ei],v=V[(ei+1)%3],q=polyHover.edgePos; q[0]=u.x;q[1]=u.y;q[2]=u.z;q[3]=v.x;q[4]=v.y;q[5]=v.z; polyHover.edge.geometry.attributes.position.needsUpdate=true; polyHover.kind='edge'; return; }
const q=polyHover.facePos; for(const [i,v] of V.entries()){ q[i*3]=v.x;q[i*3+1]=v.y;q[i*3+2]=v.z; } polyHover.face.geometry.attributes.position.needsUpdate=true; polyHover.kind='face';
}
function polyRectHas(x,y,r){ return x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1; }
function polyOrient(ax,ay,bx,by,cx,cy){ return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax); }
function polySegsCross(a,b,c,d){ const ab1=polyOrient(a[0],a[1],b[0],b[1],c[0],c[1]),ab2=polyOrient(a[0],a[1],b[0],b[1],d[0],d[1]); const cd1=polyOrient(c[0],c[1],d[0],d[1],a[0],a[1]),cd2=polyOrient(c[0],c[1],d[0],d[1],b[0],b[1]); return ab1*ab2<=0&&cd1*cd2<=0; }
const polySegRect=segmentIntersectsRect;
function polyInTriangle(p,a,b,c){ const d1=polyOrient(p[0],p[1],a[0],a[1],b[0],b[1]),d2=polyOrient(p[0],p[1],b[0],b[1],c[0],c[1]),d3=polyOrient(p[0],p[1],c[0],c[1],a[0],a[1]); return (d1>=0&&d2>=0&&d3>=0)||(d1<=0&&d2<=0&&d3<=0); }
const polyTriRect=triangleIntersectsRect;
function robustOnSegment(a,b,p){ return Math.min(a[0],b[0])<=p[0]+1e-6&&p[0]<=Math.max(a[0],b[0])+1e-6&&Math.min(a[1],b[1])<=p[1]+1e-6&&p[1]<=Math.max(a[1],b[1])+1e-6; }
function robustSegsCross(a,b,c,d){ const o=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]),o1=o(a,b,c),o2=o(a,b,d),o3=o(c,d,a),o4=o(c,d,b); if(((o1>0&&o2<0)||(o1<0&&o2>0))&&((o3>0&&o4<0)||(o3<0&&o4>0)))return true; return (Math.abs(o1)<1e-6&&robustOnSegment(a,b,c))||(Math.abs(o2)<1e-6&&robustOnSegment(a,b,d))||(Math.abs(o3)<1e-6&&robustOnSegment(c,d,a))||(Math.abs(o4)<1e-6&&robustOnSegment(c,d,b)); }
function robustSegRect(a,b,r){ if(polyRectHas(a[0],a[1],r)||polyRectHas(b[0],b[1],r))return true; const q=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]]; return q.some((p,i)=>robustSegsCross(a,b,p,q[(i+1)%4])); }
function robustPointInTri(p,a,b,c){ const o=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]),x=o(a,b,p),y=o(b,c,p),z=o(c,a,p); return (x>=0&&y>=0&&z>=0)||(x<=0&&y<=0&&z<=0); }
function robustTriRect(a,b,c,r){ if(polyRectHas(a[0],a[1],r)||polyRectHas(b[0],b[1],r)||polyRectHas(c[0],c[1],r))return true; const q=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]]; return q.some(p=>robustPointInTri(p,a,b,c))||robustSegRect(a,b,r)||robustSegRect(b,c,r)||robustSegRect(c,a,r); }
function polyVisibleFacesInRect(r,box,cam){ const renderer=vpState.renderer,scene=new THREE.Scene(),ids=new Map(); let nextId=1;
for(const [h,mesh] of pickMeshes){ if(!mesh.visible||!mesh.geometry||!mesh.geometry.attributes.position)continue; mesh.updateMatrixWorld(true); const clone=new THREE.Mesh(); clone.matrixAutoUpdate=false; clone.matrix.copy(mesh.matrixWorld); const selected=selNodes.has(h);
if(selected){ const src=mesh.geometry,pos=src.attributes.position,idx=src.index,tris=idx?idx.count/3:pos.count/3,np=new Float32Array(tris*9),nc=new Float32Array(tris*9); for(let fi=0;fi<tris;fi++){ const id=nextId++,rgb=[(id&255)/255,((id>>8)&255)/255,((id>>16)&255)/255]; ids.set(id,{h,fi}); for(let j=0;j<3;j++){ const vi=idx?idx.getX(fi*3+j):fi*3+j,k=fi*9+j*3; np[k]=pos.getX(vi);np[k+1]=pos.getY(vi);np[k+2]=pos.getZ(vi);nc[k]=rgb[0];nc[k+1]=rgb[1];nc[k+2]=rgb[2]; } } const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(np,3)); g.setAttribute('color',new THREE.BufferAttribute(nc,3)); clone.geometry=g; clone.material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false}); clone.userData._polyId=true; }
else { clone.geometry=mesh.geometry; clone.material=new THREE.MeshBasicMaterial({color:0x000000,side:THREE.DoubleSide,toneMapped:false}); }
scene.add(clone); }
const w=Math.max(1,Math.round(r.w)),h=Math.max(1,Math.round(r.h)); let target=polySelection.idTarget; if(!target||target.width!==w||target.height!==h){ if(target)target.dispose(); target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true}); polySelection.idTarget=target; }
const oldTarget=renderer.getRenderTarget(); renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setViewport(0,0,w,h); renderer.setClearColor(0x000000,0); renderer.clear(true,true,true); renderer.render(scene,cam);
const x0=Math.max(0,Math.floor(box.x0-r.x)),x1=Math.min(w,Math.ceil(box.x1-r.x)),y0=Math.max(0,Math.floor(box.y0-r.y)),y1=Math.min(h,Math.ceil(box.y1-r.y)),pw=Math.max(0,x1-x0),ph=Math.max(0,y1-y0),pixels=new Uint8Array(pw*ph*4); if(pw&&ph)renderer.readRenderTargetPixels(target,x0,h-y1,pw,ph,pixels); renderer.setRenderTarget(oldTarget);
scene.traverse(o=>{ if(o.geometry&&o.userData._polyId)o.geometry.dispose(); if(o.material)o.material.dispose(); }); const out=new Map(); for(let i=0;i<pixels.length;i+=4){ const id=pixels[i]|(pixels[i+1]<<8)|(pixels[i+2]<<16),rec=ids.get(id); if(rec){ let faces=out.get(rec.h); if(!faces)out.set(rec.h,faces=new Set()); faces.add(rec.fi); } } return out; }
function polySelEntry(h){ let s=polySelection.items.get(h); if(!s){ s={vertices:new Set(),edges:new Set(),faces:new Set()}; polySelection.items.set(h,s); } return s; }
function polyEdgeKey(a,b){ return a<b?a+':'+b:b+':'+a; }
function rebuildPolySelection(syncGizmo=true){ const fp=[],ep=[],vp=[]; const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
for(const [h,s] of polySelection.items){ if(!selNodes.has(h))continue; const mesh=pickMeshes.get(h),g=mesh&&mesh.geometry,pos=g&&g.attributes.position,idx=g&&g.index; if(!pos)continue; mesh.updateMatrixWorld(true);
for(const i of s.vertices){ a.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld); vp.push(a.x,a.y,a.z); }
for(const key of s.edges){ const [i,j]=key.split(':').map(Number); a.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(pos,j).applyMatrix4(mesh.matrixWorld); ep.push(a.x,a.y,a.z,b.x,b.y,b.z); }
for(const fi of s.faces){ const ia=idx?idx.getX(fi*3):fi*3,ib=idx?idx.getX(fi*3+1):fi*3+1,ic=idx?idx.getX(fi*3+2):fi*3+2; a.fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld); c.fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld); fp.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z); } }
polySelection.face.geometry.setAttribute('position',new THREE.Float32BufferAttribute(fp,3)); polySelection.edge.geometry.setAttribute('position',new THREE.Float32BufferAttribute(ep,3)); polySelection.vertex.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vp,3));
polySelection.face.visible=polyMode&&fp.length>0; polySelection.faceBack.visible=polyMode&&fp.length>0; polySelection.edge.visible=polyMode&&ep.length>0; polySelection.vertex.visible=polyMode&&vp.length>0;
if(vertexTools.soft.active)updateSoftPreview();
if(syncGizmo){ setGizmoVisible(polyMode?polySelection.items.size>0:selNodes.size>0); placeGizmoForSelection(); }
scheduleRender(); }
function clearPolySelection(){ polyPivotMatrix=null;polySelection.items.clear(); rebuildPolySelection(); }
function remapSelectedVertices(h,remap){ const s=polySelection.items.get(h); if(!s||!remap)return; const next=new Set(); for(const v of s.vertices){const to=remap.get(v);if(to)to.forEach(n=>next.add(n));} s.vertices=next; }
function coincidentVertexIds(mesh,vi){return logicalVertexGroup(mesh.geometry,vi);}
function vertexCenterVisible(mesh,vi,cam,r){const p=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,vi).applyMatrix4(mesh.matrixWorld),q=projectPx(p,cam,r),ndc=new THREE.Vector2(((q[0]-r.x)/r.w)*2-1,-((q[1]-r.y)/r.h)*2+1),ray=new THREE.Raycaster();ray.setFromCamera(ndc,cam);const hit=ray.intersectObjects([...pickMeshes.values()],false)[0];return !!hit&&hit.point.distanceTo(p)<1e-3;}
function prunePolySelection(){ let changed=false; for(const h of polySelection.items.keys())if(!selNodes.has(h)){ polySelection.items.delete(h); changed=true; } if(changed)rebuildPolySelection(false); }
function polyClickPick(cx,cy,mode='replace'){ const vi=viewAt(cx,cy); const r=rectFor(vi); if(vi<0||!r)return null; const cam=vpState.views[vi].cam; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
if(polyElementMode==='vertex'){const hit=reliableHoverVertex(cx,cy,cam,r,viewShading[vi]===1);if(!hit)return null;const h=meshToHash.get(hit.mesh);if(!h||!selNodes.has(h))return h;polyPivotMatrix=null;if(mode==='replace')polySelection.items.clear();const set=polySelEntry(h).vertices,all=hit.vertices,on=all.some(v=>set.has(v));if(mode==='invert')all.forEach(v=>on?set.delete(v):set.add(v));else all.forEach(v=>set.add(v));rebuildPolySelection();return h;}
if(polyElementMode==='edge'){const hit=reliableHoverEdge(cx,cy,cam,r,viewShading[vi]===1);if(!hit)return null;const h=hit.h;if(!h||!selNodes.has(h))return h;polyPivotMatrix=null;if(mode==='replace')polySelection.items.clear();const set=polySelEntry(h).edges;applyLogicalEdgeSelection(set,{keys:hit.keys},mode);if(!set.size)polySelection.items.delete(h);rebuildPolySelection();return h;}
const hit=reliableFaceHit(cx,cy,cam,r,viewShading[vi]===1); if(!hit||hit.faceIndex==null)return null; const mesh=hit.object, h=meshToHash.get(mesh); if(!h||!selNodes.has(h))return h;
polyPivotMatrix=null;
mesh.updateMatrixWorld(true); const geo=mesh.geometry,pos=geo.attributes.position,idx=geo.index,fi=hit.faceIndex,ia=idx?idx.getX(fi*3):fi*3,ib=idx?idx.getX(fi*3+1):fi*3+1,ic=idx?idx.getX(fi*3+2):fi*3+2; const a=new THREE.Vector3().fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld),b=new THREE.Vector3().fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld),c=new THREE.Vector3().fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld); const ps=[projectPx(a,cam,r),projectPx(b,cam,r),projectPx(c,cam,r)],ids=[ia,ib,ic];
let viMin=0,vd=Infinity,ei=0,ed=Infinity; for(let i=0;i<3;i++){ const d=(cx-ps[i][0])**2+(cy-ps[i][1])**2; if(d<vd){vd=d;viMin=i;} const e=pointSegDistSq(cx,cy,ps[i][0],ps[i][1],ps[(i+1)%3][0],ps[(i+1)%3][1]); if(e<ed){ed=e;ei=i;} }
if(mode==='replace')polySelection.items.clear(); const s=polySelEntry(h);
const set=polyElementMode==='vertex'?s.vertices:(polyElementMode==='edge'?s.edges:s.faces);
const value=polyElementMode==='vertex'?ids[viMin]:(polyElementMode==='edge'?polyEdgeKey(ids[ei],ids[(ei+1)%3]):fi);
if(polyElementMode==='vertex'){const all=coincidentVertexIds(mesh,ids[viMin]),on=all.some(v=>set.has(v));if(mode==='invert'){all.forEach(v=>on?set.delete(v):set.add(v));}else all.forEach(v=>set.add(v));}else if(mode==='invert'){if(set.has(value))set.delete(value);else set.add(value);}else set.add(value); if(!s.vertices.size&&!s.edges.size&&!s.faces.size)polySelection.items.delete(h); rebuildPolySelection(); return h; }
function polyBoxPick(x0,y0,x1,y1,mode='replace'){ const vi=viewAt((x0+x1)*0.5,(y0+y1)*0.5); const r=rectFor(vi); if(vi<0||!r)return; polyPivotMatrix=null;if(mode==='replace')polySelection.items.clear(); const view=vpState.views[vi],cam=view.cam; cam.updateMatrixWorld(); cam.updateProjectionMatrix(); const box={x0:Math.min(x0,x1),x1:Math.max(x0,x1),y0:Math.min(y0,y1),y1:Math.max(y0,y1)}; let visibleFaces=null; const w0=new THREE.Vector3(),w1=new THREE.Vector3(),w2=new THREE.Vector3();
if(polyElementMode==='vertex'){const hits=reliableMarqueeVertices(box,cam,r,viewShading[vi]===1);for(const [h,vs] of hits){const s=polySelEntry(h).vertices;for(const v of vs){if(mode==='invert'){if(s.has(v))s.delete(v);else s.add(v);}else s.add(v);}}rebuildPolySelection();return;}
if(polyElementMode==='edge'){const hits=reliableMarqueeEdges(box,cam,r,viewShading[vi]===1);for(const [h,edges] of hits){const s=polySelEntry(h).edges;for(const edge of edges)applyLogicalEdgeSelection(s,edge,mode);if(!s.size&&!polySelEntry(h).vertices.size&&!polySelEntry(h).faces.size)polySelection.items.delete(h);}rebuildPolySelection();return;}
visibleFaces=viewShading[vi]!==1?pickVisiblePolyFaces({renderer:vpState.renderer,pickMeshes,meshToHash,selectedHashes:selNodes,rect:r,box,camera:cam}):null;
if(visibleFaces)for(const h of selNodes){const mesh=pickMeshes.get(h),seeds=visibleFaces.get(h);if(mesh&&seeds?.size)visibleFaces.set(h,expandVisibleFaceSeeds(mesh,seeds,cam,r,box));}
for(const h of selNodes){ const mesh=pickMeshes.get(h),g=mesh&&mesh.geometry,pos=g&&g.attributes.position,idx=g&&g.index; if(!pos)continue; mesh.updateMatrixWorld(true); const tris=idx?idx.count/3:pos.count/3, hits={vertices:new Set(),edges:new Set(),faces:new Set()};
for(let fi=0;fi<tris;fi++){ if(visibleFaces&&!visibleFaces.get(h)?.has(fi))continue; const ia=idx?idx.getX(fi*3):fi*3,ib=idx?idx.getX(fi*3+1):fi*3+1,ic=idx?idx.getX(fi*3+2):fi*3+2; w0.fromBufferAttribute(pos,ia).applyMatrix4(mesh.matrixWorld); w1.fromBufferAttribute(pos,ib).applyMatrix4(mesh.matrixWorld); w2.fromBufferAttribute(pos,ic).applyMatrix4(mesh.matrixWorld); const p0=projectPx(w0,cam,r),p1=projectPx(w1,cam,r),p2=projectPx(w2,cam,r); const ids=[ia,ib,ic]; const hitVert=[polyRectHas(p0[0],p0[1],box),polyRectHas(p1[0],p1[1],box),polyRectHas(p2[0],p2[1],box)],hitEdge=[robustSegRect(p0,p1,box),robustSegRect(p1,p2,box),robustSegRect(p2,p0,box)],hitFace=robustTriRect(p0,p1,p2,box);
if(polyElementMode==='vertex'){ for(let i=0;i<3;i++)if(hitVert[i]&&(viewShading[vi]===1||vertexCenterVisible(mesh,ids[i],cam,r)))hits.vertices.add(ids[i]); }
else if(polyElementMode==='edge'){ for(let i=0;i<3;i++)if(hitEdge[i])hits.edges.add(polyEdgeKey(ids[i],ids[(i+1)%3])); }
else if(hitFace)hits.faces.add(fi); }
const s=polySelEntry(h),key=polyElementMode==='vertex'?'vertices':(polyElementMode==='edge'?'edges':'faces'); for(const value of hits[key]){ if(mode==='invert'){ if(s[key].has(value))s[key].delete(value); else s[key].add(value); } else s[key].add(value); }
if(!s.vertices.size&&!s.edges.size&&!s.faces.size)polySelection.items.delete(h); }
rebuildPolySelection(); }
function hitGizmo(cx,cy){ const vi=viewAt(cx,cy); if(vi<0)return null; const r=rectFor(vi); if(!r)return null;
const fr=applyGizmo(vpState.views[vi],r);
const grp=fr.mode3D?gizmo3D:(vpState.views[vi].flat==='XZ'?flatXZ:vpState.views[vi].flat==='XY'?flatXY:flatYZ);
hNdc.set(((cx-r.x)/r.w)*2-1,-((cy-r.y)/r.h)*2+1); hRay.setFromCamera(hNdc,vpState.views[vi].cam);
const cands=grp.children.slice(); if(smallRing&&smallRing.visible) cands.push(smallRing);
if(sector&&sector.visible) cands.push(sector);
const h=hRay.intersectObjects(cands,false); if(!h.length)return null;
let best=h[0]; for(let i=1;i<h.length;i++) if((h[i].object.userData.order??999)>(best.object.userData.order??999)) best=h[i];
if(splineFocusActive()){const uniform=h.find(x=>x.object.name==='S');if(uniform)best=uniform;}
return {view:vi,object:best.object,fr,r}; }
function updateHover(cx,cy,mods={}){const g=hitGizmo(cx,cy),splineHit=splineMode?splineScreenHit(cx,cy):null,obj=g?g.object:null;if(obj!==hovObj){clearHover();if(obj){hovObj=obj;hovObj.material.opacity=1.0;}}
if(!obj&&splineHit){clearPolyHover();setSplineHover(splineHit,!!(mods.ctrlKey||mods.metaKey));}else if(!obj){clearSplineHover();if(polyMode)updatePolyHover(cx,cy);else clearPolyHover();}else{clearPolyHover();clearSplineHover();}render(); }
let gizDrag=null;
const _o=new THREE.Vector3(),_d=new THREE.Vector3(),_P=new THREE.Vector3(),_t1=new THREE.Vector3(),_t2=new THREE.Vector3(),_cr=new THREE.Vector3(),_dq=new THREE.Quaternion(),_upW=new THREE.Vector3();
function planeHit(origin,dir,point,normal,out){ const den=dir.dot(normal); if(Math.abs(den)<1e-6)return false;
const t=_t1.copy(point).sub(origin).dot(normal)/den; out.copy(origin).addScaledVector(dir,t); return t>=0; }
function setRay(view,r){ hNdc.set(((r._cx-r.x)/r.w)*2-1,-((r._cy-r.y)/r.h)*2+1); hRay.setFromCamera(hNdc,view.cam); _o.copy(hRay.ray.origin); _d.copy(hRay.ray.direction); }
function setHudLine(px0,py0,px1,py1){ if(!hudLineGeo)return; const W=vpState.W,H=vpState.H;
const a=hudLineGeo.attributes.position.array;
a[0]=px0/W*2-1; a[1]=-(py0/H*2-1); a[2]=0;
a[3]=px1/W*2-1; a[4]=-(py1/H*2-1); a[5]=0;
hudLineGeo.attributes.position.needsUpdate=true; hudLine.visible=true; }
function hideHudLine(){ if(hudLine) hudLine.visible=false; }
function snapVisPw(vi){ const view=vpState.views[vi]; const r=(vpState.mode==='single'?vpState.fullRect:rectFor(vi))||vpState.fullRect; return pwOf(view,r); }
function showSnapVisAxis(vi,axisW,startPos,center){ const view=vpState.views[vi]; if(view.type!=='persp')return; const cam=view.cam;
const pw=snapVisPw(vi); const step=snapVisibleStep(pw);
cam.getWorldDirection(_v); let perp=_t2.copy(axisW).cross(_v); if(perp.lengthSq()<1e-9)perp.copy(WUP); perp.normalize();
const tick=TICK_PX*pw; const arr=snapVis.geometry.attributes.position.array;
const startCoord=startPos.dot(axisW); const cur=center.clone().sub(startPos).dot(axisW);
const snapped=Math.round((startCoord+cur)/step)*step-startCoord;
let i=0;
for(let k=-SNAP_HALF;k<=SNAP_HALF;k++){ if(i>SNAPVIS_CAP-2)break; const t=snapped+k*step;
const cx=startPos.x+axisW.x*t, cy=startPos.y+axisW.y*t, cz=startPos.z+axisW.z*t;
arr[i++]=cx-perp.x*tick;arr[i++]=cy-perp.y*tick;arr[i++]=cz-perp.z*tick;
arr[i++]=cx+perp.x*tick;arr[i++]=cy+perp.y*tick;arr[i++]=cz+perp.z*tick; }
snapVis.geometry.setDrawRange(0,i/3); snapVis.geometry.attributes.position.needsUpdate=true; _snapVisActive=true; }
function showSnapVisPlane(vi,u,v,planePoint,center){ const view=vpState.views[vi]; if(view.type!=='persp')return;
const pw=snapVisPw(vi); const step=snapVisibleStep(pw); const arr=snapVis.geometry.attributes.position.array;
const Pu=planePoint.dot(u), Pv=planePoint.dot(v);
const cu=center.clone().sub(planePoint).dot(u), cv=center.clone().sub(planePoint).dot(v);
const sU=Math.round((Pu+cu)/step)*step-Pu, sV=Math.round((Pv+cv)/step)*step-Pv;
let i=0;
const put=(a,b)=>{ if(i>SNAPVIS_CAP-3)return; arr[i++]=planePoint.x+u.x*a+v.x*b; arr[i++]=planePoint.y+u.y*a+v.y*b; arr[i++]=planePoint.z+u.z*a+v.z*b; };
for(let ka=-SNAP_HALF;ka<=SNAP_HALF;ka++){ const a=sU+ka*step; put(a,sV-SNAP_HALF*step); put(a,sV+SNAP_HALF*step); }
for(let kb=-SNAP_HALF;kb<=SNAP_HALF;kb++){ const b=sV+kb*step; put(sU-SNAP_HALF*step,b); put(sU+SNAP_HALF*step,b); }
snapVis.geometry.setDrawRange(0,i/3); snapVis.geometry.attributes.position.needsUpdate=true; _snapVisActive=true; }
function hideSnapVis(){ if(snapVis) snapVis.visible=false; _snapVisActive=false; }
function snapVertexOnly(pos,vi,proj){ const r=(vpState.mode==='single'?vpState.fullRect:rectFor(vi))||vpState.fullRect; const cam=vpState.views[vi].cam,wire=viewShading[vi]===1;
const gp=proj?proj:projectPx(pos,cam,r); let bestD=SNAP_PX,best=null;
for(const [h,mesh] of pickMeshes){if(!OBJ.has(h)||!effectiveVisible(h))continue;const g=mesh.geometry; const pa=g.attributes.position; if(!pa||pa.count>VERTEX_CAP)continue;
mesh.updateMatrixWorld(true); const mw=mesh.matrixWorld; const arr=pa.array;
for(let k=0;k<pa.count;k++){ _v.set(arr[k*3],arr[k*3+1],arr[k*3+2]).applyMatrix4(mw);
const ndc=_v.clone().project(cam);if(ndc.z<-1||ndc.z>1||(!wire&&!exactVertexVisible(_v,ndc,cam)))continue;const p=projectPx(_v,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=_v.clone();} } }
return best; }
function snapMoveAxis(pos,vi,axisW,startPos){ const view=vpState.views[vi]; const r=(vpState.mode==='single'?vpState.fullRect:rectFor(vi))||vpState.fullRect; const cam=view.cam;
const gp=projectPx(pos,cam,r); let best=null,bestD=SNAP_PX+1;
const vpos=snapVertexOnly(pos,vi,gp);
if(vpos){ const along=vpos.clone().sub(startPos).dot(axisW); const cand=startPos.clone().addScaledVector(axisW,along);
const p=projectPx(cand,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=cand;} }
if(view.type!=='persp'){
const pw=snapVisPw(vi); const step=orthoVisibleStep(pw); const u=view.axU, v=view.axV;
const family=(w)=>{ const aw=axisW.dot(w); if(Math.abs(aw)<1e-6)return;
const target=Math.round(pos.dot(w)/step)*step; const t=(target-startPos.dot(w))/aw;
const cand=startPos.clone().addScaledVector(axisW,t);
const p=projectPx(cand,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=cand;} };
family(u); family(v);
} else {
const pw=snapVisPw(vi); const step=snapVisibleStep(pw);
const startCoord=startPos.dot(axisW); const cur=pos.clone().sub(startPos).dot(axisW);
const snapped=Math.round((startCoord+cur)/step)*step-startCoord;
const cand=startPos.clone().addScaledVector(axisW,snapped);
const p=projectPx(cand,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=cand;}
}
return best?best:pos.clone(); }
function snapMovePlane(pos,vi,u,v,origin){ const view=vpState.views[vi]; const r=(vpState.mode==='single'?vpState.fullRect:rectFor(vi))||vpState.fullRect; const cam=view.cam;
const gp=projectPx(pos,cam,r); let best=null,bestD=SNAP_PX+1;
const vpos=snapVertexOnly(pos,vi,gp);
if(vpos){ const du=vpos.clone().sub(origin).dot(u), dv=vpos.clone().sub(origin).dot(v);
const cand=origin.clone().addScaledVector(u,du).addScaledVector(v,dv);
const p=projectPx(cand,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=cand;} }
if(view.type!=='persp'){
const pw=snapVisPw(vi); const step=orthoVisibleStep(pw);
const wu=view.axU, wv=view.axV; const wn=_t1.copy(wu).cross(wv);
const su=Math.round(pos.dot(wu)/step)*step, sv=Math.round(pos.dot(wv)/step)*step;
const cand=_t2.copy(wu).multiplyScalar(su).addScaledVector(wv,sv).addScaledVector(wn,pos.dot(wn));
const cc=cand.clone(); const p=projectPx(cc,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=cc;}
} else {
const pw=snapVisPw(vi); const step=snapVisibleStep(pw);
const au=pos.dot(u), av=pos.dot(v); const su=Math.round(au/step)*step-au, sv=Math.round(av/step)*step-av;
const cand=pos.clone().addScaledVector(u,su).addScaledVector(v,sv);
const p=projectPx(cand,cam,r); const d=Math.hypot(p[0]-gp[0],p[1]-gp[1]); if(d<bestD){bestD=d;best=cand;}
}
return best?best:pos.clone(); }
function snapMoveScreen(pos,vi,screenPoint=null,startPos=null){const view=vpState.views[vi],r=(vpState.mode==='single'?vpState.fullRect:rectFor(vi))||vpState.fullRect;if(!view||!r)return pos.clone();const vpos=snapOn?snapVertexOnly(pos,vi,screenPoint):null;if(vpos)return vpos.clone();if(view.type!=='ortho')return pos.clone();const u=view.axU.clone().normalize(),v=view.axV.clone().normalize(),n=u.clone().cross(v).normalize(),out=new THREE.Vector3();if(quantOn&&startPos){const d=pos.clone().sub(startPos),step=quantStep();return startPos.clone().addScaledVector(u,Math.round(d.dot(u)/step)*step).addScaledVector(v,Math.round(d.dot(v)/step)*step).addScaledVector(n,d.dot(n));}if(snapOn){const step=orthoVisibleStep(pwOf(view,r));return out.addScaledVector(u,Math.round(pos.dot(u)/step)*step).addScaledVector(v,Math.round(pos.dot(v)/step)*step).addScaledVector(n,pos.dot(n));}return pos.clone();}
function gizmoScaleWorld(src,comp,k){
const wM=new THREE.Matrix4().copy(src);
const i=comp==='x'?0:comp==='y'?1:2, se=Math.hypot(src.elements[i],src.elements[i+4],src.elements[i+8]);
if(se<1e-12){ wM.elements[i]=Math.max(MIN_COL,Math.abs(k)*MIN_COL); wM.elements[i+4]=0; wM.elements[i+8]=0; }
else { wM.elements[i]*=k; wM.elements[i+4]*=k; wM.elements[i+8]*=k; }
floorWmCols(wM,src);
return wM; }
function gizmoScaleObjectTo(src,comp,targetColLen,orientQ){
const wM=new THREE.Matrix4().copy(src);
const e=wM.elements;
const s0=Math.hypot(e[0],e[1],e[2]), s1=Math.hypot(e[4],e[5],e[6]), s2=Math.hypot(e[8],e[9],e[10]);
const ns=[s0,s1,s2];
const ci=comp==='x'?0:comp==='y'?1:2;
ns[ci]=Math.max(MIN_COL,targetColLen);
const R=_wm2.makeRotationFromQuaternion(orientQ); const re=R.elements;
e[0]=re[0]*ns[0]; e[1]=re[1]*ns[0]; e[2]=re[2]*ns[0];
e[4]=re[4]*ns[1]; e[5]=re[5]*ns[1]; e[6]=re[6]*ns[1];
e[8]=re[8]*ns[2]; e[9]=re[9]*ns[2]; e[10]=re[10]*ns[2];
floorWmCols(wM,src);
return wM; }
function gizmoScaleU(src,k){ const wM=new THREE.Matrix4().copy(src);
for(const i of [0,1,2,4,5,6,8,9,10]) wM.elements[i]*=k;
floorWmCols(wM,src);
return wM; }
function applyGizmoWorld(wM){ gizmo.pos.set(wM.elements[12],wM.elements[13],wM.elements[14]);
gizmo.lin.copy(wM); gizmo.lin.elements[12]=0;gizmo.lin.elements[13]=0;gizmo.lin.elements[14]=0;
const c=cubeRef.mesh; c.matrix.copy(wM); c.matrixAutoUpdate=false; c.updateMatrixWorld(true); }
function startGizDrag(g,e){ const view=vpState.views[g.view], fr=g.fr, r=g.r, name=g.object.name; r._cx=e.clientX; r._cy=e.clientY;
const cam=view.cam; cam.updateMatrixWorld(); const viewDir=cam.getWorldDirection(_t1).clone();
const camToGizmo=cam.position.clone().sub(gizmo.pos); if(camToGizmo.lengthSq()<1e-9)camToGizmo.copy(viewDir);
freezeSignsAll();
const planePoint=gizmo.pos.clone(); setRay(view,r);
const scaleSign=(view.type!=='persp' && !gizmoLocal && (name==='SZ'||name==='Z')) ? -1 : 1;
const nn0=hudNode?OBJ.get(hudNode):null;
if(name==='P'){ const normal=viewDir.clone();
if(!planeHit(_o,_d,planePoint,normal,_P))return; const gizHit=_P.clone();
gizDrag={mode:'move',kind:'screen',axisW:null,normal,gizHit,planePoint,startPos:gizmo.pos.clone(),view:g.view,r}; }
else if(name==='SR'){
const gp=projectPx(gizmo.pos,cam,r);
const startAng=Math.atan2(e.clientY-gp[1],e.clientX-gp[0]);
// Экранная ось фиксируется на старте жеста: это нормаль к плоскости камеры.
// Последующие движения не должны зависеть от обновлений камеры или гизмо.
gizDrag={mode:'screenRotate',view:g.view,r,sr:{lastAng:startAng,total:0,startLin:gizmo.lin.clone(),screenAxis:viewDir.clone()}};
}
else if(name[0]==='R'){ const letter=name[1]; const vR=axisFromFr(fr,letter); const normal=vR.clone();
if(!planeHit(_o,_d,planePoint,normal,_P))return; const gizHit=_P.clone();
const pX=axisFromFr(fr, letter==='X'?'Y':letter==='Y'?'Z':'X'); const pY=axisFromFr(fr, letter==='X'?'Z':letter==='Y'?'X':'Y');
const sgn=Math.sign(_cr.copy(pX).cross(pY).dot(vR))||1;
gizDrag={mode:'rotate',normal,gizHit,planePoint,startQuat:gizmoHandleOrient.clone(),startLin:gizmo.lin.clone(),
startNodeLocal: nn0?{pos:nn0.pos.clone(),lin:nn0.lin.clone()}:null,
pX,pY,vR:vR.clone(),sign:sgn,view:g.view,r}; }
else if(name[0]==='S'){ if(name==='S'){ const normal=viewDir.clone().negate();
if(!planeHit(_o,_d,planePoint,normal,_P))return; const gizHit=_P.clone();
const m=cam.matrixWorld.elements; const diag=new THREE.Vector3(m[0]+m[4],m[1]+m[5],m[2]+m[6]).multiplyScalar(0.5);
// После нулевого масштаба нужны актуальные (почти нулевые) bounds,
// иначе следующая попытка масштабирования продолжает опираться на старый размер.
lastBracketSig=null; updateBrackets(false);
const startExtentU=[gizmoBoundsMax.x-gizmoBoundsMin.x,gizmoBoundsMax.y-gizmoBoundsMin.y,gizmoBoundsMax.z-gizmoBoundsMin.z];
gizDrag={mode:'scaleU',normal,gizHit,planePoint,startWorld:new THREE.Matrix4().copy(localTmp(gizmo)),
startExtentU,scaleRef:Math.max(1e-9,...startExtentU)*0.5,
diag,view:g.view,r}; }
else { const comp=name[1]; const axisW=axisFromFr(fr,comp); const cpar=axisW.clone().multiplyScalar(camToGizmo.dot(axisW));
const normal=camToGizmo.clone().sub(cpar); if(normal.lengthSq()<1e-6)normal.copy(viewDir); normal.normalize();
if(!planeHit(_o,_d,planePoint,normal,_P))return; const gizHit=_P.clone();
lastBracketSig=null; updateBrackets(false);
const startWorld=new THREE.Matrix4().copy(localTmp(gizmo));
const ci=comp.toLowerCase()==='x'?0:comp.toLowerCase()==='y'?1:2;
const e=startWorld.elements;
const startExtent=Math.max(1e-9,boundsExtentAlong(gizmoBoundsMin,gizmoBoundsMax,axisW));
const axisScale=Math.hypot(e[ci*4], e[ci*4+1], e[ci*4+2]);
const startAxisScale=axisScale || 1;
const responseExtent=splineFocusActive()?startExtent*0.5:startExtent;
gizDrag={mode:'scale',comp,axisW,startExtent,responseExtent,startAxisScale,zeroAxis:!!uvEdit&&axisScale<=MIN_COL*2,scaleSign,
normal,gizHit,planePoint,startWorld,startOrient:gizmoHandleOrient.clone(),view:g.view,r}; } }
else { let normal, axisW=null, kind, planeU=null, planeV=null;
if(name.length===1){ axisW=axisFromFr(fr,name); const cpar=axisW.clone().multiplyScalar(camToGizmo.dot(axisW));
normal=camToGizmo.clone().sub(cpar); if(normal.lengthSq()<1e-6)normal.copy(viewDir); normal.normalize(); kind='axis'; }
else { const a=axisFromFr(fr,name[0]), b=axisFromFr(fr,name[1]); normal=a.clone().cross(b).normalize(); kind='plane'; planeU=a.clone(); planeV=b.clone(); }
if(!planeHit(_o,_d,planePoint,normal,_P))return; const gizHit=_P.clone();
gizDrag={mode:'move',kind,axisW,normal,gizHit,planePoint,startPos:gizmo.pos.clone(),planeU,planeV,view:g.view,r}; }
clearHover(); try{vpState.renderer.domElement.setPointerCapture(e.pointerId);}catch{}
if(pivotKeyDown)pivotKeyGesture=true;
if(_gizStart)_gizStart(e);
emitInfo(null); }
function doGizDrag(e){ const view=vpState.views[gizDrag.view], r=gizDrag.r; const cam=view.cam; r._cx=e.clientX; r._cy=e.clientY; view.cam.updateMatrixWorld();
if(splineFocusActive()&&splineGizModifiers)splineGizModifiers={ctrl:!!(e.ctrlKey||e.metaKey),shift:!!e.shiftKey};
setRay(view,r);
hideHudLine();
if(gizDrag.mode==='screenRotate'){
const gp=projectPx(gizmo.pos,cam,r); const ang=Math.atan2(e.clientY-gp[1], e.clientX-gp[0]);
let delta=ang-gizDrag.sr.lastAng; while(delta>Math.PI)delta-=TAU; while(delta<-Math.PI)delta+=TAU; gizDrag.sr.lastAng=ang;
gizDrag.sr.total+=delta;
const raw=gizDrag.sr.total;
_dq.setFromAxisAngle(gizDrag.sr.screenAxis, raw); gizmo.lin.copy(new THREE.Matrix4().makeRotationFromQuaternion(_dq).multiply(gizDrag.sr.startLin));
gizmoHandleOrient.copy(gizmoOrientQuat());
setHudLine(gp[0],gp[1],e.clientX,e.clientY);
syncCube(); emitInfo({kind:'rot',deg:raw*R2D}); emitTransform();
scheduleRender(); return; }
if(!planeHit(_o,_d,gizDrag.planePoint,gizDrag.normal,_P))return;
if(gizDrag.mode==='move'){
hideSnapVis();
if(gizDrag.kind==='axis'){
let s=_t1.copy(_P).sub(gizDrag.gizHit).dot(gizDrag.axisW);
if(quantOn){ const st=quantStep(); s=Math.round(s/st)*st; }
let target=gizDrag.startPos.clone().addScaledVector(gizDrag.axisW, s);
if(snapOn){ showSnapVisAxis(gizDrag.view,gizDrag.axisW,gizDrag.startPos,target);
target=snapMoveAxis(target,gizDrag.view,gizDrag.axisW,gizDrag.startPos); }
gizmo.pos.copy(target); syncCube();
emitInfo({kind:'moveAxis', mm:gizmo.pos.clone().sub(gizDrag.startPos).dot(gizDrag.axisW)});
} else if(gizDrag.kind==='screen'){
gizmo.pos.copy(gizDrag.startPos).add(_t1.copy(_P).sub(gizDrag.gizHit));
if(snapOn||quantOn) gizmo.pos.copy(snapMoveScreen(gizmo.pos,gizDrag.view,[e.clientX,e.clientY],gizDrag.startPos));
syncCube(); emitInfo(null);
} else {
gizmo.pos.copy(gizDrag.startPos).add(_t1.copy(_P).sub(gizDrag.gizHit));
if(quantOn){ const st=quantStep(); const u=gizDrag.planeU, v=gizDrag.planeV; const d=gizmo.pos.clone().sub(gizDrag.startPos);
gizmo.pos.copy(gizDrag.startPos).addScaledVector(u,Math.round(d.dot(u)/st)*st).addScaledVector(v,Math.round(d.dot(v)/st)*st); }
if(snapOn){ showSnapVisPlane(gizDrag.view,gizDrag.planeU,gizDrag.planeV,gizDrag.planePoint,gizmo.pos);
gizmo.pos.copy(snapMovePlane(gizmo.pos,gizDrag.view,gizDrag.planeU,gizDrag.planeV,gizDrag.planePoint)); }
syncCube(); emitInfo(null);
}
}
else if(gizDrag.mode==='rotate'){ const C=gizmo.pos;
const angP=Math.atan2(gizDrag.pY.dot(_t1.copy(C).sub(_P)), gizDrag.pX.dot(_t2.copy(C).sub(_P)));
const angH=Math.atan2(gizDrag.pY.dot(_t1.copy(C).sub(gizDrag.gizHit)), gizDrag.pX.dot(_t2.copy(C).sub(gizDrag.gizHit)));
let raw=(angP-angH)*gizDrag.sign;
if(quantOn){ const cp=projectPx(C,cam,r), pp=projectPx(_P,cam,r); const linePx=Math.hypot(pp[0]-cp[0],pp[1]-cp[1]); const step=angleStepPx(linePx); raw=Math.round(raw/step)*step; }
_dq.setFromAxisAngle(gizDrag.vR, raw); gizmo.lin.copy(new THREE.Matrix4().makeRotationFromQuaternion(_dq).multiply(gizDrag.startLin));
gizmoHandleOrient.copy(gizmoOrientQuat());
const cp=projectPx(C,cam,r); setHudLine(cp[0],cp[1],e.clientX,e.clientY); syncCube();
emitInfo({kind:'rot',deg:raw*R2D}); }
else if(gizDrag.mode==='scale'){ const c=gizDrag.comp.toLowerCase();
const d=_t1.copy(_P).sub(gizDrag.gizHit).dot(gizDrag.axisW)*gizDrag.scaleSign;
let factor=(gizDrag.zeroAxis?d:gizDrag.responseExtent+d)/Math.max(1e-9,gizDrag.responseExtent);
let rawSize=gizDrag.startExtent*factor;
if(quantOn){ const step=quantStep(); rawSize=Math.round(rawSize/step)*step; }
if(snapOn){ const pw=pwOf(view,r); rawSize=snapSizeGrid(rawSize,pw); }
rawSize=Math.max(MIN_COL,rawSize);
factor=rawSize/Math.max(1e-9,gizDrag.startExtent);
const targetColLen=gizDrag.zeroAxis?rawSize/UV_PROXY_SIZE:gizDrag.startAxisScale*factor;
const wM=gizmoLocal?gizmoScaleObjectTo(gizDrag.startWorld,c,targetColLen,gizDrag.startOrient):gizmoScaleWorld(gizDrag.startWorld,c,factor);
applyGizmoWorld(wM);
emitInfo({kind:'scaleAxis', mm:rawSize}); }
else if(gizDrag.mode==='scaleU'){ const d=_t1.copy(_P).sub(gizDrag.gizHit).dot(gizDrag.diag); const add=d/gizDrag.scaleRef;
let kraw=1+add;
if(quantOn){ const base=Math.max(1e-9,...gizDrag.startExtentU),step=quantStep(); kraw=Math.round((base*kraw)/step)*step/base; }
const pw=pwOf(view,r);
if(snapOn){ let kmin=Infinity;
for(let i=0;i<3;i++){ const base=gizDrag.startExtentU[i]; let ws=base*kraw; ws=snapSizeGrid(ws,pw); const kk=base>1e-9?ws/base:0; if(kk<kmin)kmin=kk; }
if(isFinite(kmin)) kraw=kmin; }
kraw=Math.max(MIN_COL,kraw);
applyGizmoWorld(gizmoScaleU(gizDrag.startWorld,kraw));
emitInfo({kind:'scaleU', k:kraw, approx:snapOn}); }
syncCube(); emitTransform(); scheduleRender(); }
function endGizDrag(e){
if(_gizEnd)_gizEnd(); hideHudLine(); hideSnapVis(); gizDrag=null;if([...replicaStates.values()].some(state=>state.needsFinalBuild))scheduleGeneratorEvaluation(0); frozenSignsPerView=null; try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{} emitInfo(null); if(pivotKeyRestorePending)finishMomentaryPivot(true); }
let _onTransform=null;
function onTransform(cb){ _onTransform=cb; }
function emitTransform(){ if(_onTransform)_onTransform(); }
function setShadingForContext(mode){
if(vpState.mode==='quad'){ for(let i=0;i<4;i++) viewShading[i]=mode; }
else { viewShading[vpState.singleView]=mode; }
scheduleRender();
}
function getViewMode(){ return vpState.mode; }
/* ============================ вьюпорт init =========================== */
function bboxHalfMax2(){ bboxHalfMax=Math.max(bboxHalf.x,bboxHalf.y,bboxHalf.z,1e-6); }
function buildSmallSquare(){ const pos=[-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]; const idx=[0,1,2,0,2,3];
const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3)); g.setIndex(idx);
const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0xffffff,side:DS,depthTest:false,transparent:true,opacity:0.6}));
m.frustumCulled=false; m.name='P'; m.renderOrder=RO+40; m.visible=false; vpState.scene.add(m); return m; }
function projectPx(world,cam,r){ _vp.copy(world).project(cam); return [r.x+(_vp.x*0.5+0.5)*r.w, r.y+(1-(_vp.y*0.5+0.5))*r.h]; }
function updateOverlay(){ const vx=2*(vpState.halfW/vpState.W)-1, hy=1-2*(vpState.halfH/vpState.H); const a=vpState.overlayGeo.attributes.position.array;
a[0]=vx;a[1]=-1;a[2]=0; a[3]=vx;a[4]=1;a[5]=0; a[6]=-1;a[7]=hy;a[8]=0; a[9]=1;a[10]=hy;a[11]=0; vpState.overlayGeo.attributes.position.needsUpdate=true; }
function initViewport(container){
vpState.container=container;
const renderer=new THREE.WebGLRenderer({antialias:false}); renderer.setPixelRatio(PR); renderer.autoClear=false;
container.appendChild(renderer.domElement); vpState.renderer=renderer;
const scene=new THREE.Scene(); scene.background=new THREE.Color(BG); vpState.scene=scene;
const L=1000, axGeo=new THREE.BufferGeometry();
axGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,L,0,0, 0,0,0,0,L,0, 0,0,0,0,0,L],3));
axGeo.setAttribute('color',new THREE.Float32BufferAttribute([1,0,0,1,0,0, 0,1,0,0,1,0, 0,0,1,0,0,1],3));
const axes=new THREE.LineSegments(axGeo,new THREE.LineBasicMaterial({vertexColors:true,depthWrite:false,depthTest:true,transparent:true,opacity:0.9,toneMapped:false}));
axes.renderOrder=4; scene.add(axes);
const CUBE=1000, boxGeo=new THREE.BoxGeometry(CUBE,CUBE,CUBE); boxGeo.computeBoundingBox();
boxGeo.boundingBox.getSize(bboxHalf).multiplyScalar(0.5); bboxHalfMax2(); boxGeo.boundingBox.getSize(baseLocalSize);
const cube=new THREE.Mesh(boxGeo,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.12,depthWrite:false,side:THREE.DoubleSide}));
cube.position.y=CUBE/2; cube.matrixAutoUpdate=false; cube.renderOrder=LAYER_OBJ; scene.add(cube); cubeRef.mesh=cube; cube.visible=false;
const edges=new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.95,depthWrite:false}));
edges.renderOrder=RO+2; cube.add(edges);
const uvEdges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineBasicMaterial({color:0x00ffd5,depthTest:false,depthWrite:false,toneMapped:false}));
uvEdges.frustumCulled=false; uvEdges.renderOrder=RO-1; uvEdges.visible=false; uvEdges.matrixAutoUpdate=false; scene.add(uvEdges); uvFrameLines=uvEdges;
cube.matrix.copy(localTmp(gizmo)); cube.updateMatrixWorld(true);
const perspCam=new THREE.PerspectiveCamera(FOV,1,1,1e9); perspCam.position.set(6000,4500,6000); vpState.perspCam=perspCam;
function makeOrtho(dir,up){ const c=new THREE.OrthographicCamera(-1,1,1,-1,1,1e9); c.position.copy(dir).multiplyScalar(1e6); c.up.copy(up); c.lookAt(0,0,0); c.updateMatrixWorld(); return c; }
const topCam=makeOrtho(Y,new THREE.Vector3(0,0,-1)), frontCam=makeOrtho(Z,Y), rightCam=makeOrtho(X,Y);
envState.hemi=new THREE.HemisphereLight(0xffffff,0x555555,1.0);
scene.add(envState.hemi);
for(const c of [perspCam,topCam,frontCam,rightCam]){
const pl=new THREE.PointLight(0xffffff,1.0,0,0); pl.userData._cam=c; c.add(pl); camLamps.push(pl);
scene.add(c); }
const topGrid=makeOrthoGrid(X,Z), frontGrid=makeOrthoGrid(X,Y), rightGrid=makeOrthoGrid(Z,Y);
vpState.orthoGridObjs=[topGrid,frontGrid,rightGrid];
vpState.perspGrid=makePerspGrid();
vpState.views=[
{type:'persp',cam:perspCam,ctrl:new NavPersp(perspCam),grid:null,flat:null,axU:null,axV:null},
{type:'ortho',cam:topCam,ctrl:new NavOrtho(topCam),grid:topGrid,flat:'XZ',axU:X,axV:Z},
{type:'ortho',cam:frontCam,ctrl:new NavOrtho(frontCam),grid:frontGrid,flat:'XY',axU:X,axV:Y},
{type:'ortho',cam:rightCam,ctrl:new NavOrtho(rightCam),grid:rightGrid,flat:'YZ',axU:Z,axV:Y} ];
gizmo3D=buildGroup([[gX,0xff1111,'X'],[gY,0x00aa00,'Y'],[gZ,0x0011ff,'Z'],[gXY,0xccaa00,'XY'],[gXZ,0x881188,'XZ'],[gYZ,0x00aa88,'YZ'],[gSX,0xffaaaa,'SX'],[gSY,0xaaffaa,'SY'],[gSZ,0xaaaaff,'SZ'],[gRX,0xff1111,'RX'],[gRY,0x11aa11,'RY'],[gRZ,0x1122ff,'RZ'],[gS,0xffffff,'S']],DS);
flatXZ=buildGroup([[fXZ_S,0xffffff,'S'],[fXZ_X,0xff1111,'X'],[fXZ_Z,0x0011ff,'Z'],[fXZ_SX,0xffaaaa,'SX'],[fXZ_SZ,0xaaaaff,'SZ'],[fXZ_XZ,0x881188,'XZ'],[fXZ_RY,0x11aa11,'RY']],BS);
flatXY=buildGroup([[fXY_S,0xffffff,'S'],[fXY_X,0xff1111,'X'],[fXY_Y,0x00aa00,'Y'],[fXY_SX,0xffaaaa,'SX'],[fXY_SY,0xaaffaa,'SY'],[fXY_XY,0xccaa00,'XY'],[fXY_RZ,0x1122ff,'RZ']],BS);
flatYZ=buildGroup([[fYZ_S,0xffffff,'S'],[fYZ_Y,0x00aa00,'Y'],[fYZ_Z,0x0011ff,'Z'],[fYZ_SY,0xaaffaa,'SY'],[fYZ_SZ,0xaaaaff,'SZ'],[fYZ_YZ,0x00aa88,'YZ'],[fYZ_RX,0xff1111,'RX']],BS);
smallRing=buildSmallSquare();
for(const radiusPx of [RING_PX,RING_PX*2,RING_PX*4]){ const pts=[]; for(let i=0;i<64;i++){ const a=i/64*TAU; pts.push(Math.cos(a),Math.sin(a),0); }
const ring=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(p[0],p[1],p[2]))),new THREE.LineBasicMaterial({color:0xffffff,depthTest:false,depthWrite:false,toneMapped:false})); ring.userData.radiusPx=radiusPx; ring.frustumCulled=false; ring.renderOrder=9999; ring.visible=false; vpState.scene.add(ring); quantRotateRings.push(ring); }
// сектор из константы gSR (1 полигон, 4 вершины)
sector=new THREE.Mesh(gSR,new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:0.55}));
sector.frustumCulled=false; sector.name='SR'; sector.renderOrder=RO+55; sector.visible=false; vpState.scene.add(sector);
const svGeo=new THREE.BufferGeometry(); svGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(SNAPVIS_CAP*3),3).setUsage(THREE.DynamicDrawUsage));
snapVis=new THREE.LineSegments(svGeo,new THREE.LineBasicMaterial({color:0x888888,transparent:true,opacity:0.3,depthWrite:false,depthTest:false}));
snapVis.frustumCulled=false; snapVis.renderOrder=LAYER_SNAPVIS; snapVis.visible=false; scene.add(snapVis);
const brGeo=new THREE.BufferGeometry(); brGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(48*3),3));
const brMat=new THREE.LineBasicMaterial({color:0xffd000,transparent:true,opacity:1,depthTest:false,depthWrite:false});
const brLine=new THREE.LineSegments(brGeo,brMat); brLine.frustumCulled=false; brLine.renderOrder=LAYER_BRACKET; brLine.visible=false; scene.add(brLine);
brackets.line=brLine; brackets.geo=brGeo; brackets.pos=brGeo.attributes.position.array;
const phFaceGeo=new THREE.BufferGeometry(); phFaceGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(9),3));
const phFace=new THREE.Mesh(phFaceGeo,new THREE.MeshBasicMaterial({color:0x6fe8ff,transparent:true,opacity:0.22,side:THREE.FrontSide,depthTest:false,depthWrite:false}));
phFace.frustumCulled=false; phFace.renderOrder=LAYER_BRACKET+1; phFace.visible=false; scene.add(phFace);
const phFaceBack=new THREE.Mesh(phFaceGeo,new THREE.MeshBasicMaterial({color:0xff9adf,transparent:true,opacity:0.22,side:THREE.BackSide,depthTest:false,depthWrite:false}));
phFaceBack.frustumCulled=false; phFaceBack.renderOrder=LAYER_BRACKET+1; phFaceBack.visible=false; scene.add(phFaceBack);
const phEdgeGeo=new THREE.BufferGeometry(); phEdgeGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
const phEdge=new THREE.LineSegments(phEdgeGeo,new THREE.LineBasicMaterial({color:0x8ae6ff,depthTest:false,depthWrite:false}));
phEdge.frustumCulled=false; phEdge.renderOrder=LAYER_BRACKET+2; phEdge.visible=false; scene.add(phEdge);
const phVertexGeo=new THREE.BufferGeometry(); phVertexGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3),3));
const phVertex=new THREE.Points(phVertexGeo,new THREE.PointsMaterial({color:0xe8fbff,size:9,sizeAttenuation:false,depthTest:false,depthWrite:false}));
phVertex.frustumCulled=false; phVertex.renderOrder=LAYER_BRACKET+3; phVertex.visible=false; scene.add(phVertex);
polyHover.face=phFace; polyHover.faceBack=phFaceBack; polyHover.edge=phEdge; polyHover.vertex=phVertex;
polyHover.facePos=phFaceGeo.attributes.position.array; polyHover.edgePos=phEdgeGeo.attributes.position.array; polyHover.vertexPos=phVertexGeo.attributes.position.array;
const psFaceGeo=new THREE.BufferGeometry();
const psFace=new THREE.Mesh(psFaceGeo,new THREE.MeshBasicMaterial({color:0x806000,transparent:false,opacity:1,side:THREE.FrontSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
const psFaceBack=new THREE.Mesh(psFaceGeo,new THREE.MeshBasicMaterial({color:0x55306d,transparent:false,opacity:1,side:THREE.BackSide,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
const psEdge=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x43d17a,depthTest:false,depthWrite:false}));
const psVertex=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0x5a8aff,size:7,sizeAttenuation:false,depthTest:false,depthWrite:false}));
for(const o of [psFace,psFaceBack,psEdge,psVertex]){ o.frustumCulled=false; o.renderOrder=LAYER_BRACKET+4; o.visible=false; scene.add(o); }
polySelection.face=psFace; polySelection.faceBack=psFaceBack; polySelection.edge=psEdge; polySelection.vertex=psVertex;
const vtPoint=()=>{const o=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({color:0x00f6ff,size:11,sizeAttenuation:false,depthTest:false,depthWrite:false}));o.frustumCulled=false;o.renderOrder=LAYER_BRACKET+8;o.visible=false;scene.add(o);return o;};
const vtLine=color=>{const o=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color,depthTest:false,depthWrite:false}));o.frustumCulled=false;o.renderOrder=LAYER_BRACKET+8;o.visible=false;scene.add(o);return o;};
vertexTools.snapVertex=vtPoint();vertexTools.snapEdge=vtLine(0x00f6ff);vertexTools.linePreview=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x00f6ff,depthTest:false,depthWrite:false}));vertexTools.linePreview.frustumCulled=false;vertexTools.linePreview.renderOrder=LAYER_BRACKET+7;vertexTools.linePreview.visible=false;scene.add(vertexTools.linePreview);
splineDrawPreview=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x72ff85,depthTest:false,depthWrite:false}));splineDrawPreview.frustumCulled=false;splineDrawPreview.renderOrder=LAYER_BRACKET+9;splineDrawPreview.visible=false;scene.add(splineDrawPreview);splineTangentPreview=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x59d8ff,depthTest:false,depthWrite:false}));splineTangentPreview.frustumCulled=false;splineTangentPreview.renderOrder=LAYER_BRACKET+10;splineTangentPreview.visible=false;scene.add(splineTangentPreview);
vertexTools.loopPreview=vtPoint();vertexTools.loopPreview.material.color.setHex(0xffa800);
vertexTools.softPreview=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial({size:8,sizeAttenuation:false,vertexColors:true,depthTest:true,depthWrite:false}));vertexTools.softPreview.frustumCulled=false;vertexTools.softPreview.renderOrder=LAYER_BRACKET+6;vertexTools.softPreview.visible=false;scene.add(vertexTools.softPreview);
const hudScene=new THREE.Scene(); const hudCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
hudLineGeo=new THREE.BufferGeometry(); hudLineGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
hudLine=new THREE.Line(hudLineGeo,new THREE.LineBasicMaterial({color:0xffffff,depthTest:false,depthWrite:false,transparent:true,opacity:0.9}));
hudLine.frustumCulled=false; hudLine.visible=false; hudScene.add(hudLine);
for(const radiusPx of [RING_PX,RING_PX*2,RING_PX*4]){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(65*3),3).setUsage(THREE.DynamicDrawUsage)); const ring=new THREE.LineLoop(g,new THREE.LineBasicMaterial({color:ORTHO_LINE,transparent:true,opacity:ORTHO_MINOR_OP,depthTest:false,depthWrite:false,toneMapped:false})); ring.userData.radiusPx=radiusPx; ring.frustumCulled=false; ring.renderOrder=9999; ring.visible=false; hudScene.add(ring); quantRotateHudRings.push(ring); }
vpState.hudScene=hudScene; vpState.hudCam=hudCam;
const overlayScene=new THREE.Scene(); const overlayCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const overlayGeo=new THREE.BufferGeometry(); overlayGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(12),3));
const overlayLines=new THREE.LineSegments(overlayGeo,new THREE.LineBasicMaterial({color:QUAD_LINE,depthTest:false,depthWrite:false,transparent:true,opacity:1}));
overlayLines.frustumCulled=false; overlayScene.add(overlayLines);
vpState.overlayScene=overlayScene; vpState.overlayCam=overlayCam; vpState.overlayGeo=overlayGeo;
const dom=renderer.domElement;
dom.addEventListener('pointerdown',onDown);
addEventListener('pointermove',onMove); addEventListener('pointerup',onUp);
const cancelNavigation=()=>{for(const view of vpState.views){if(view?.ctrl){view.ctrl.zoomAnchor=null;view.ctrl.anchor=null;}}activeView=-1;};
addEventListener('pointercancel',()=>{if(splineBevelTool?.dragging)finishSplineBevelTool();if(splineOutlineTool?.dragging)finishSplineOutlineTool();if(splinePointerGesture?.direct)finishSplineDirectDrag(splinePointerGesture);splinePointerGesture=null;hideSplineDrawPreview();cancelNavigation();});dom.addEventListener('lostpointercapture',cancelNavigation);
addEventListener('blur',()=>{ const had=gizDrag||hovObj||polyHover.kind; cancelNavigation(); if(splineBevelTool?.dragging)finishSplineBevelTool();if(splineOutlineTool?.dragging)finishSplineOutlineTool();if(splinePointerGesture?.direct){finishSplineDirectDrag(splinePointerGesture);splinePointerGesture=null;}else if(gizDrag)endGizDrag({}); if(pivotKeyDown)finishMomentaryPivot();hideSplineDrawPreview();clearHover(); clearPolyHover(); if(had) scheduleRender(); });
dom.addEventListener('wheel',onWheel,{passive:false});
dom.addEventListener('contextmenu',e=>e.preventDefault());
new ResizeObserver(computeLayout).observe(container);
computeLayout(); render();
}
/* ввод вьюпорта */
let activeView=-1, lastX=0,lastY=0, downX=0,downY=0;
function onDown(e){
blurActive();
if(splineBevelTool||splineOutlineTool){const tool=splineBevelTool||splineOutlineTool;if(e.button===0){tool.start={x:e.clientX,y:e.clientY};tool.dragging=true;try{vpState.renderer.domElement.setPointerCapture(e.pointerId);}catch{}e.preventDefault();}else if(splineBevelTool)cancelSplineBevelTool();else cancelSplineOutlineTool();return;}
const splineDirectTarget=splineMode&&e.button===0?splineScreenHit(e.clientX,e.clientY):null,g=e.button===0?hitGizmo(e.clientX,e.clientY):null;
if(g){if(vertexTools.mode==='loop')stopVertexModeTool();activeView=-1;e.preventDefault();startGizDrag(g,e);return;}
if(e.altKey) return;
if(polyMode&&((vertexTools.mode==='lineCut')||(vertexTools.mode==='closeHole'&&polyElementMode==='face')||(vertexTools.mode==='addPoint'&&polyElementMode==='vertex'))&&e.button===0){const vi=viewAt(e.clientX,e.clientY);if(vi<0)return;activeView=vi;lastX=downX=e.clientX;lastY=downY=e.clientY;clearHover();clearPolyHover();try{vpState.renderer.domElement.setPointerCapture(e.pointerId);}catch{}vpState.views[vi].ctrl.down(e,rectFor(vi));return;}
const vi=viewAt(e.clientX,e.clientY); if(vi<0)return;
if(splineMode&&e.button===0){const hit=splineDirectTarget||splineScreenHit(e.clientX,e.clientY),ctrl=e.ctrlKey||e.metaKey,direct2D=vpState.views[vi]?.type==='ortho'&&!!hit,addHere=ctrl&&!hit&&(componentFocus==='spline'||!polyMode);if(splineDrawing||direct2D||(ctrl&&hit?.kind==='segment')||addHere){splinePointerGesture={x:e.clientX,y:e.clientY,view:vi,hit,ctrl,shift:e.shiftKey,direct:false};activeView=-1;try{vpState.renderer.domElement.setPointerCapture(e.pointerId);}catch{}e.preventDefault();return;}}
if(vi>=0 && vpState.views[vi].type!=='persp') lastOrthoView=vi;
activeView=vi; lastX=downX=e.clientX; lastY=downY=e.clientY; clearHover(); clearPolyHover();
try{vpState.renderer.domElement.setPointerCapture(e.pointerId);}catch{} vpState.views[vi].ctrl.down(e,rectFor(vi)); }
function onMove(e){if(splineBevelTool?.dragging){updateSplineBevelTool(e);return;}if(splineOutlineTool?.dragging){updateSplineOutlineTool(e);return;} if(gizDrag&&!splinePointerGesture?.direct){ doGizDrag(e); return; }
if(splinePointerGesture){const g=splinePointerGesture,dragged=Math.hypot(e.clientX-g.x,e.clientY-g.y)>=TAP_PX;if(!g.direct&&dragged&&!splineDrawing&&g.hit&&!(g.ctrl&&g.hit.kind==='segment'))beginSplineDirectDrag(g,e);if(g.direct)moveSplineDirectDrag(g,e);else{if(dragged&&(splineDrawing||(g.ctrl&&!g.hit)))updateSplineDrawGesturePreview(g,e);else hideSplineDrawPreview();setSplineHover(splineScreenHit(e.clientX,e.clientY),!!(e.ctrlKey||e.metaKey));}return;}
if(polyMode&&(vertexTools.mode==='lineCut'||vertexTools.mode==='closeHole'||(vertexTools.mode==='addPoint'&&polyElementMode==='vertex'))&&activeView>=0){const r=rectFor(activeView);if(!r)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;const dragged=Math.hypot(e.clientX-downX,e.clientY-downY)>=TAP_PX;if(dragged){vpState.views[activeView].ctrl.move(e,r,true,dx,dy);scheduleRender();}else if(vertexTools.mode==='lineCut')updateLineCutPreview(e.clientX,e.clientY,activeView);else if(vertexTools.mode==='closeHole')updateCloseHolePreview(e.clientX,e.clientY,activeView);else updateAddPointPreview(e.clientX,e.clientY,activeView);return;}
if(activeView<0){if(polyMode&&polyElementMode==='vertex'&&!vertexTools.mode&&(e.ctrlKey||e.metaKey)){const vi=viewAt(e.clientX,e.clientY);clearPolyHover();if(vi>=0)updateAddPointPreview(e.clientX,e.clientY,vi);return;}if(!vertexTools.mode&&vertexTools.snap)hideVertexToolGuides();updateHover(e.clientX,e.clientY,e); return; }
const r=rectFor(activeView); if(!r)return;
const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
vpState.views[activeView].ctrl.move(e,r,Math.hypot(e.clientX-downX,e.clientY-downY)>=TAP_PX,dx,dy); scheduleRender(); }
function onUp(e){ let need=false;
if(splineBevelTool?.dragging&&e.button===0){splineBevelTool.dragging=false;finishSplineBevelTool();try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{}return;}
if(splineOutlineTool?.dragging&&e.button===0){splineOutlineTool.dragging=false;finishSplineOutlineTool();try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{}return;}
if(splinePointerGesture&&e.button===0){const g=splinePointerGesture;splinePointerGesture=null;hideSplineDrawPreview();const dragged=Math.hypot(e.clientX-g.x,e.clientY-g.y)>=TAP_PX;if(g.direct)finishSplineDirectDrag(g);else if(dragged&&g.ctrl&&g.hit?.kind==='segment')duplicateSplineSegmentDrag(g,e);else if(dragged&&(splineDrawing||(g.ctrl&&!g.hit))){const placement=g.previewPlacement||splinePlacement(g.x,g.y,g.view,activeSplineObject()),through=placement?.world,delta=splineScreenPlaneDelta(g.x,g.y,e.clientX,e.clientY,g.view,through),added=addSplineDrawPoint(g.x,g.y,g.view,{dragWorld:delta.lengthSq()>1e-8?delta:null,transientCtrl:g.ctrl&&!splineDrawing});if(added&&g.hit?.kind==='vertex'&&splineDrawHistory.length>1)finishSplineDrawing();}else splineClick(e.clientX,e.clientY,{shift:g.shift,ctrl:g.ctrl});try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{}updateHover(e.clientX,e.clientY,e);return;}
if(polyMode&&vertexTools.mode==='lineCut'&&e.button===0&&activeView>=0){const vi=activeView,tap=Math.hypot(e.clientX-downX,e.clientY-downY)<TAP_PX;if(!tap){const r=rectFor(vi);if(r)vpState.views[vi].ctrl.up(e,r);}const ok=!tap||lineCutAddPoint(e.clientX,e.clientY,vi);activeView=-1;try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{}if(!ok)finishLineCut();return;}
if(polyMode&&polyElementMode==='face'&&vertexTools.mode==='closeHole'&&e.button===0&&activeView>=0){const vi=activeView,tap=Math.hypot(e.clientX-downX,e.clientY-downY)<TAP_PX;if(!tap){const r=rectFor(vi);if(r)vpState.views[vi].ctrl.up(e,r);}else{updateCloseHolePreview(e.clientX,e.clientY,vi);if(!closeHoveredHole())leaveVertexTool(false);}activeView=-1;try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{}return;}
if(polyMode&&polyElementMode==='vertex'&&vertexTools.mode==='addPoint'&&e.button===0&&activeView>=0){const vi=activeView,tap=Math.hypot(e.clientX-downX,e.clientY-downY)<TAP_PX;if(!tap){const r=rectFor(vi);if(r)vpState.views[vi].ctrl.up(e,r);}const ok=!tap||addPointToolClick(e.clientX,e.clientY,vi);activeView=-1;try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{}if(!ok)leaveVertexTool(false);else updateAddPointPreview(e.clientX,e.clientY,vi);return;}
if(gizDrag){ endGizDrag(e); need=true; if(!e.buttons)activeView=-1; }
else { const vi=activeView; if(vi>=0){ const r=rectFor(vi); if(r) vpState.views[vi].ctrl.up(e,r); }
if(e.button===1 && Math.hypot(e.clientX-downX,e.clientY-downY)<VIEW_SWITCH_PX && e.buttons===0 && vi>=0){ if(vpState.mode==='single')vpState.mode='quad'; else { vpState.mode='single'; vpState.singleView=vi; } need=true; }
else if(e.button===0 && !e.altKey && Math.hypot(e.clientX-downX,e.clientY-downY)<TAP_PX && e.buttons===0){ doPick(e); }
else if(e.button===2&&Math.hypot(e.clientX-downX,e.clientY-downY)<TAP_PX&&e.buttons===0)openViewportContextMenu(e.clientX,e.clientY); }
if(!e.buttons){ activeView=-1; try{vpState.renderer.domElement.releasePointerCapture(e.pointerId);}catch{} }
if(need) scheduleRender(); }
function doPick(e){ const vi=viewAt(e.clientX,e.clientY); if(vi<0){ if(_vpPick)_vpPick(null,e.shiftKey,e.ctrlKey||e.metaKey); return; } const r=rectFor(vi); if(!r){ if(_vpPick)_vpPick(null,e.shiftKey,e.ctrlKey||e.metaKey); return; }
const ctrl=e.ctrlKey||e.metaKey,splineHit=splineMode?splineScreenHit(e.clientX,e.clientY):null;if(splineMode&&(splineDrawing||splineHit||!polyMode||(ctrl&&componentFocus==='spline'))){splineClick(e.clientX,e.clientY,{shift:e.shiftKey,ctrl});return;}
if(polyMode){ const mode=ctrl?'invert':(e.shiftKey?'add':'replace');if((polyElementMode==='vertex'||polyElementMode==='edge')&&vertexTools.mode==='loop'){updateLoopPreview(e.clientX,e.clientY,vi);if(vertexTools.loop)applyLoopSelection(mode);else leaveVertexTool(false);return;}if(polyElementMode==='vertex'&&ctrl&&!vertexTools.mode){const hit=reliableHoverVertex(e.clientX,e.clientY,vpState.views[vi].cam,r,viewShading[vi]===1);if(!hit){componentFocus='poly';addPointAt(e.clientX,e.clientY,vi);placeGizmoForSelection();return;}}const hash=polyClickPick(e.clientX,e.clientY,mode);if(hash){componentFocus='poly';placeGizmoForSelection();}if(vertexTools.soft.active){if(hash)recalculateSoftSelection();else leaveVertexTool(false);}if(_vpPick&&(hash||mode==='replace'))_vpPick(hash,e.shiftKey,ctrl); return; }
const objectSplineHit=splineScreenHit(e.clientX,e.clientY,{editing:false,vertices:true,handles:false,segments:true});if(objectSplineHit){if(_vpPick)_vpPick(objectSplineHit.object,e.shiftKey,e.ctrlKey||e.metaKey);return;}
pickNdc.set(((e.clientX-r.x)/r.w)*2-1,-((e.clientY-r.y)/r.h)*2+1); pickRay.setFromCamera(pickNdc,vpState.views[vi].cam);
const hits=pickRay.intersectObjects([...pickMeshes.values()],false); let hash=null; for(const hh of hits){ const h2=meshToHash.get(hh.object); if(h2){ hash=h2; break; } } if(_vpPick)_vpPick(hash,e.shiftKey,e.ctrlKey||e.metaKey); }
function boxPick(x0,y0,x1,y1){
const vi=viewAt((x0+x1)*0.5,(y0+y1)*0.5); if(vi<0) return [];
const r=rectFor(vi); if(!r) return [];
const cam=vpState.views[vi].cam; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
const rx0=Math.min(x0,x1),rx1=Math.max(x0,x1),ry0=Math.min(y0,y1),ry1=Math.max(y0,y1);
const out=[], v=new THREE.Vector3();
for(const [h,mesh] of pickMeshes){
const g=mesh.geometry; if(!g.boundingBox) g.computeBoundingBox();
const bb=g.boundingBox; if(!bb||bb.isEmpty()) continue;
mesh.updateMatrixWorld(true); const mw=mesh.matrixWorld;
const xs=[bb.min.x,bb.max.x], ys=[bb.min.y,bb.max.y], zs=[bb.min.z,bb.max.z];
let minpx=Infinity,minpy=Infinity,maxpx=-Infinity,maxpy=-Infinity,any=false;
for(const x of xs) for(const y of ys) for(const z of zs){
v.set(x,y,z).applyMatrix4(mw).project(cam);
if(v.z<-1||v.z>1) continue; any=true;
const px=r.x+(v.x*0.5+0.5)*r.w, py=r.y+(1-(v.y*0.5+0.5))*r.h;
if(px<minpx)minpx=px; if(px>maxpx)maxpx=px; if(py<minpy)minpy=py; if(py>maxpy)maxpy=py; }
if(any && maxpx>=rx0 && minpx<=rx1 && maxpy>=ry0 && minpy<=ry1) out.push(h);
}
return out;
}
function frameHashes(vi,hashes){
const view=vpState.views[vi]; if(!view)return;
const acc=[];
const union=h=>{ const bb=getWorldBBox(h); if(bb)acc.push(bb); const n=OBJ.get(h); if(n)n.children.forEach(union); };
if(hashes&&hashes.length) hashes.forEach(union);
else for(const h of pickMeshes.keys()){ const bb=getWorldBBox(h); if(bb)acc.push(bb); }
if(!acc.length)return;
const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
for(const b of acc)for(let i=0;i<3;i++){ if(b.min[i]<mn[i])mn[i]=b.min[i]; if(b.max[i]>mx[i])mx[i]=b.max[i]; }
const C=new THREE.Vector3((mn[0]+mx[0])/2,(mn[1]+mx[1])/2,(mn[2]+mx[2])/2);
const R=Math.max(new THREE.Vector3(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]).length()*0.5,1);
const cam=view.cam; cam.updateMatrixWorld();
const fwd=cam.getWorldDirection(new THREE.Vector3());
if(view.type==='persp'){
const dist=(R/Math.tan(cam.fov*Math.PI/360))*1.2;
view.ctrl.handle.copy(C);
cam.position.copy(C).addScaledVector(fwd,-dist);
} else {
const zoom=THREE.MathUtils.clamp(BASE/(R*1.2),MINZ,MAXZ);
view.ctrl.zoom=zoom; _zoomOf.set(cam,zoom);
const toC=C.clone().sub(cam.position);
const dAx=toC.dot(fwd);
cam.position.add(toC.addScaledVector(fwd,-dAx));
view.ctrl.handle.copy(C);
lastOrthoView=vi;
}
cam.updateMatrixWorld(); scheduleRender();
}
function frameSplineSelection(vi){const refs=splineSelectedRefs(),pts=[];if(refs.vertices.length){for(const q of refs.vertices){const p=splineData.get(q.object)?.vertices[q.id];if(p)pts.push(splineWorldPoint(q.object,p));}}else if(refs.segments.length){for(const q of refs.segments){const d=splineData.get(q.object);if(!d?.segments[q.id])continue;for(const p of SPLINE.sampleSplineSegment(d,q.id))pts.push(splineWorldPoint(q.object,p.position));}}else for(const q of refs.handles){const d=splineData.get(q.object),info=d&&splineHandleInfo(d,q.segment,q.side);if(info){pts.push(splineWorldPoint(q.object,d.vertices[info.vertex]));pts.push(splineWorldPoint(q.object,SPLINE.splineMath.add(d.vertices[info.vertex],info.vector)));}}if(!pts.length)return false;const mn=pts[0].clone(),mx=pts[0].clone();for(const p of pts){mn.min(p);mx.max(p);}const C=mn.clone().add(mx).multiplyScalar(.5),R=Math.max(mx.clone().sub(mn).length()*.5,1),view=vpState.views[vi];if(!view)return false;const cam=view.cam;cam.updateMatrixWorld();const fwd=cam.getWorldDirection(new THREE.Vector3());if(view.type==='persp'){const dist=(R/Math.tan(cam.fov*Math.PI/360))*1.2;view.ctrl.handle.copy(C);cam.position.copy(C).addScaledVector(fwd,-dist);}else{const zoom=THREE.MathUtils.clamp(BASE/(R*1.2),MINZ,MAXZ);view.ctrl.zoom=zoom;_zoomOf.set(cam,zoom);const toC=C.clone().sub(cam.position),dAx=toC.dot(fwd);cam.position.add(toC.addScaledVector(fwd,-dAx));view.ctrl.handle.copy(C);lastOrthoView=vi;}cam.updateMatrixWorld();scheduleRender();return true;}
function onWheel(e){ if(e.ctrlKey) return; const vi=viewAt(e.clientX,e.clientY); if(vi<0)return; const r=rectFor(vi);
if(vi>=0 && vpState.views[vi].type!=='persp') lastOrthoView=vi;
if(r){ vpState.views[vi].ctrl.wheel(e,r); scheduleRender(); } }
// UI
const ICONS=window.ICONS;
const R2D_UI=180/Math.PI;
const clamp_ui=(v,a,b)=>Math.max(a,Math.min(b,v));
/* ===================== иконки в DOM ===================== */
document.getElementById('btnQuant').innerHTML=ICONS.ICO_GRID;
document.getElementById('btnSnap').innerHTML=ICONS.ICO_MAGNET;
document.getElementById('btnPivot').innerHTML=ICONS.ICO_ARROW;
document.getElementById('btnLocal').innerHTML=ICONS.ICO_CUBE;
document.getElementById('btnUV').innerHTML=ICONS.ICO_SQUARE;
document.getElementById('btnSolo').innerHTML=ICONS.ICO_PERSON;
document.getElementById('btnHelp').innerHTML=ICONS.ICO_HELP;
document.getElementById('btnNew').innerHTML=ICONS.ICO_NEW;
document.getElementById('btnOpen').innerHTML=ICONS.ICO_OPEN;
document.getElementById('btnRecents').innerHTML=ICONS.ICO_RECENTS;
document.getElementById('btnSave').innerHTML=ICONS.ICO_SAVE;
document.getElementById('btnSaveAs').innerHTML=ICONS.ICO_SAVEAS;
document.getElementById('btnSaveInc').innerHTML=ICONS.ICO_SAVEINC;
document.getElementById('btnDownload').innerHTML=ICONS.ICO_DOWNLOAD;
document.getElementById('btnSymmetry').innerHTML=ICONS.ICO_SYMMETRY;
document.getElementById('btnCloner').innerHTML=ICONS.ICO_CLONER;
document.getElementById('btnEnv').innerHTML=ICONS.ICO_ENVIRONMENT;
document.getElementById('btnSpline').innerHTML=ICONS.ICO_SPLINE;
document.getElementById('btnInstance').innerHTML=ICONS.ICO_INSTANCE;
document.getElementById('btnExtrude').innerHTML=ICONS.ICO_EXTRUDE;
document.getElementById('btnLathe').innerHTML=ICONS.ICO_LATHE;
document.getElementById('btnSweep').innerHTML=ICONS.ICO_SWEEP;
document.getElementById('btnBoolean').innerHTML=ICONS.ICO_BOOLEAN;
document.getElementById('btnSplinePatch').innerHTML=ICONS.ICO_SPLINE_PATCH;
document.getElementById('tabAttributes').innerHTML =ICONS.ICO_TAB_ATTRIBUTES;
document.getElementById('tabObjects').innerHTML    =ICONS.ICO_TAB_OBJECTS;
document.getElementById('tabMaterialMgr').innerHTML=ICONS.ICO_TAB_MATERIAL_MGR;
document.getElementById('tabMaterials').innerHTML  =ICONS.ICO_TAB_MATERIALS;
document.getElementById('tabTextures').innerHTML   =ICONS.ICO_TAB_TEXTURES;
document.getElementById('tabDelUnused').innerHTML  =ICONS.ICO_TAB_DELETE_UNUSED;
document.getElementById('tabAddNew').innerHTML     =ICONS.ICO_TAB_ADD_NEW;
document.getElementById('btnLoadTex').innerHTML    =ICONS.ICO_TEX_LOAD;
document.getElementById('btnDelTex').innerHTML     =ICONS.ICO_TEX_DELETE;
document.getElementById('tlPlay').innerHTML        =ICONS.ICO_TL_PLAY;
document.getElementById('tlPrevKey').innerHTML     =ICONS.ICO_TL_PREV;
document.getElementById('tlNextKey').innerHTML     =ICONS.ICO_TL_NEXT;
document.getElementById('tlSetKey').innerHTML      =ICONS.ICO_TL_KEY;
document.getElementById('tlDelKey').innerHTML      =ICONS.ICO_TL_DELKEY;
/* ===================== undo / redo ===================== */
const HISTORY_LIMIT=64,undoStack=[],redoStack=[];
function discardHistoryEntry(c){try{c?.dispose?.();}catch(error){console.warn('History resource disposal failed',error);}}
function clearCommandStack(stack){for(const c of stack)discardHistoryEntry(c);stack.length=0;}
function trimCommandStack(stack){while(stack.length>HISTORY_LIMIT)discardHistoryEntry(stack.shift());}
function clearHistory(){clearCommandStack(undoStack);clearCommandStack(redoStack);}
function runCmd(c){ if(!c)return; c.redo(); undoStack.push(c);trimCommandStack(undoStack);clearCommandStack(redoStack);afterCmd(); }
function pushCmd(c){ if(!c)return;undoStack.push(c);trimCommandStack(undoStack);clearCommandStack(redoStack); }
function undo(){ const c=undoStack.pop(); if(!c)return; c.undo(); redoStack.push(c);trimCommandStack(redoStack);afterCmd(); if(vertexTools.soft.active)recalculateSoftSelection(); }
function redo(){ const c=redoStack.pop(); if(!c)return; c.redo(); undoStack.push(c);trimCommandStack(undoStack);afterCmd(); if(vertexTools.soft.active)recalculateSoftSelection(); }
function afterCmd(){ treeAllFolded=false; setBrowserIcon(); treeChanged(); syncMeshParents(); refreshMaterials(); if(uvMode)syncUvEditing(); }
/* ===================== тулбары ===================== */
let coordMode='object';
let editPivot=false;
let pivotKeyDown=false,pivotKeyGesture=false,pivotKeyOriginal=false,pivotKeyRestorePending=false;
const coordBtn=document.getElementById('coordBtn');
function setEditPivot(value){editPivot=!!value;document.getElementById('btnPivot').classList.toggle('on',editPivot);placeGizmoForSelection();updateHUD();scheduleRender();}
function finishMomentaryPivot(force=false){if(!pivotKeyDown&&!force)return;const restore=pivotKeyGesture||pivotKeyRestorePending;pivotKeyDown=false;pivotKeyGesture=false;pivotKeyRestorePending=false;if(restore)setEditPivot(pivotKeyOriginal);}
function syncCoordBtn(){ coordBtn.innerHTML=ICONS.ICO_GLOBE; coordBtn.classList.toggle('on',coordMode==='world'); }
function setCoordMode(mode){ coordMode=mode; setGizmoLocal(mode==='object'); syncCoordBtn(); placeGizmoForSelection(); updateHUD(); }
syncCoordBtn();
coordBtn.addEventListener('click',()=>{ blurActive(); setCoordMode(coordMode==='world'?'object':'world'); updateHUD(); });
document.getElementById('btnPivot').addEventListener('click',()=>setEditPivot(!editPivot));
document.getElementById('btnLocal').addEventListener('click',()=>{ doAutoPivot();
if(boundNode){ gizBeforeObj=getWorldMatrix(boundNode); gizBeforeGizmo=getGizmoWorldArray(); } });
document.getElementById('btnHelp').addEventListener('click',()=>{const dialog=document.getElementById('helpDialog');if(dialog&&!dialog.open)dialog.showModal();});
const btnQuant=document.getElementById('btnQuant'), btnSnap=document.getElementById('btnSnap');
function syncQuantSnap(){ btnQuant.classList.toggle('on',getQuantize()); btnSnap.classList.toggle('on',getSnap()); }
function toggleQuant(){ setQuantize(!getQuantize()); syncQuantSnap(); }
function toggleSnap(){ setSnap(!getSnap()); syncQuantSnap(); }
btnQuant.addEventListener('click',toggleQuant);
btnSnap.addEventListener('click',toggleSnap);
syncQuantSnap();
document.getElementById('btnUV').addEventListener('click',()=>setUvEdit(!uvMode));
const btnSolo=document.getElementById('btnSolo');
let soloOn=false;
btnSolo.addEventListener('click',()=>{
if(!soloOn){ if(!selNodes.size) return; setSoloHashes(selNodes); soloOn=true; }
else { setSoloHashes(null); soloOn=false; }
btnSolo.classList.toggle('on',soloOn); treeChanged(); });
const modeButtons={vertex:document.getElementById('btnVertexMode'),edge:document.getElementById('btnEdgeMode'),face:document.getElementById('btnPolygonMode')};
modeButtons.vertex.innerHTML=ICONS.ICO_MODE_VERTEX; modeButtons.edge.innerHTML=ICONS.ICO_MODE_EDGE; modeButtons.face.innerHTML=ICONS.ICO_MODE_FACE;
let polyMode=false,polyElementMode='face',vertexEditActive=false,componentFocus='spline';
const vpMenu=document.getElementById('vpMenu');
function hideVertexContextMenu(){vpMenu.classList.remove('show');}
function placePopupMenu(menu,x,y){menu.style.visibility='hidden';menu.style.left='0px';menu.style.top='0px';menu.classList.add('show');const r=menu.getBoundingClientRect(),left=x+r.width<=innerWidth?x:x-r.width,top=y+r.height<=innerHeight?y:y-r.height;menu.style.left=Math.max(0,Math.min(left,innerWidth-r.width))+'px';menu.style.top=Math.max(0,Math.min(top,innerHeight-r.height))+'px';menu.style.visibility='';}
function showVertexContextMenu(x,y){if(!selNodes.size)return;vertexTools.menuPoint={x,y,view:viewAt(x,y)};vpMenu.innerHTML='';const items=[['Add Point','addPoint',activateAddPoint],['Line Cut','lineCut',activateLineCut],['Loop Selection','loop',activateLoopSelection],['Soft Selection','soft',enableSoftSelection]];for(const [label,mode,action] of items){const el=document.createElement('div');el.className='obm-item'+(vertexTools.mode===mode?' on':'');el.textContent=label;el.addEventListener('click',()=>{hideVertexContextMenu();action();});vpMenu.appendChild(el);}placePopupMenu(vpMenu,x,y);}
function showEdgeContextMenu(x,y){if(!selNodes.size)return;vertexTools.menuPoint={x,y,view:viewAt(x,y)};vpMenu.innerHTML='';const items=[['Line Cut','lineCut',activateLineCut],['Bridge','bridge',bridgeSelectedEdges],['Loop Selection','loop',activateLoopSelection]];for(const [label,mode,action] of items){const el=document.createElement('div');el.className='obm-item'+(vertexTools.mode===mode?' on':'');el.textContent=label;el.addEventListener('click',()=>{hideVertexContextMenu();action();});vpMenu.appendChild(el);}placePopupMenu(vpMenu,x,y);}
function showFaceContextMenu(x,y){if(!selNodes.size)return;vertexTools.menuPoint={x,y,view:viewAt(x,y)};vpMenu.innerHTML='';const items=[['Line Cut','lineCut',activateLineCut],['Close Polygonal Hole','closeHole',activateCloseHole]];for(const [label,mode,action] of items){const el=document.createElement('div');el.className='obm-item'+(vertexTools.mode===mode?' on':'');el.textContent=label;el.addEventListener('click',()=>{hideVertexContextMenu();action();});vpMenu.appendChild(el);}placePopupMenu(vpMenu,x,y);}
function openViewportContextMenu(x,y){if(splineFocusActive()){if(splineDrawing)finishSplineDrawing();else showSplineContextMenu(x,y);return;}if(!polyMode||!selNodes.size)return;if(vertexTools.mode==='lineCut')finishLineCut();else if(vertexTools.mode)leaveVertexTool(false);if(polyElementMode==='vertex')showVertexContextMenu(x,y);else if(polyElementMode==='edge')showEdgeContextMenu(x,y);else showFaceContextMenu(x,y);}
function selectedSplineVerticesByObject(){const out=new Map(),add=(object,id)=>{let a=out.get(object);if(!a)out.set(object,a=[]);if(!a.includes(id))a.push(id);};for(const key of splineSelection.vertices){const q=parseSplineElementKey(key);add(q.object,q.id);}if(!splineSelection.vertices.size)for(const key of splineSelection.handles){const q=parseSplineElementKey(key),h=parseSplineHandleKey(q.id),info=splineHandleInfo(evaluatedSplineData(q.object),h.segment,h.side);if(info)add(q.object,info.vertex);}return out;}
function selectedSplineSequences(){const out=new Map();const add=(h,q)=>{let s=out.get(h);if(!s)out.set(h,s=new Set());s.add(q);};for(const key of splineSelection.vertices){const r=parseSplineElementKey(key),d=evaluatedSplineData(r.object);if(!d)continue;for(const s of Object.values(d.segments))if(s.a===r.id||s.b===r.id)add(r.object,s.sequence);}for(const key of splineSelection.segments){const r=parseSplineElementKey(key),s=evaluatedSplineData(r.object)?.segments[r.id];if(s)add(r.object,s.sequence);}return out;}
function syncSplineFreeTangents(d,vertices,kind){for(const vid of vertices){const free=d.freeHandles?.[vid];if(!free)continue;if(kind==='hard'){free.in=[0,0,0];free.out=[0,0,0];continue;}const actual=splineIncidentHandles(d,vid).map(x=>splineHandleInfo(d,x.segment,x.side)).filter(Boolean),all=actual.concat(['in','out'].map(side=>splineHandleInfo(d,'free:'+vid,side)).filter(Boolean));let axis=[0,0,0],best=0;for(const info of actual){const n=SPLINE.splineMath.len(info.vector);if(n>best){best=n;axis=SPLINE.splineMath.norm(info.side==='b'?SPLINE.splineMath.mul(info.vector,-1):info.vector);}}if(best<1e-6){for(const s of Object.values(d.segments)){let other=null,sign=1;if(s.a===vid)other=s.b;else if(s.b===vid){other=s.a;sign=-1;}if(!other)continue;const chord=SPLINE.splineMath.sub(d.vertices[other],d.vertices[vid]),n=SPLINE.splineMath.len(chord);if(n>1e-6){axis=SPLINE.splineMath.mul(SPLINE.splineMath.norm(chord),sign);break;}}}if(SPLINE.splineMath.len(axis)<1e-6)axis=[1,0,0];if(kind==='soft'){const lengths=[];for(const s of Object.values(d.segments)){const other=s.a===vid?s.b:s.b===vid?s.a:null;if(other)lengths.push(SPLINE.splineMath.dist(d.vertices[vid],d.vertices[other])/3);}const n=lengths.length?lengths.reduce((a,b)=>a+b,0)/lengths.length:0;free.out=SPLINE.splineMath.mul(axis,n);free.in=SPLINE.splineMath.mul(axis,-n);}else if(kind==='equalDirection'){free.out=SPLINE.splineMath.mul(axis,SPLINE.splineMath.len(free.out));free.in=SPLINE.splineMath.mul(axis,-SPLINE.splineMath.len(free.in));}else if(kind==='equalLength'){const target=all.length?all.reduce((sum,x)=>sum+SPLINE.splineMath.len(x.vector),0)/all.length:0;for(const side of ['in','out']){const old=free[side],dir=SPLINE.splineMath.len(old)>=1e-6?SPLINE.splineMath.norm(old):SPLINE.splineMath.mul(axis,side==='in'?-1:1);free[side]=SPLINE.splineMath.mul(dir,target);}}}}
function splineTangentCommand(kind){const grouped=selectedSplineVerticesByObject(),hs=[...grouped.keys()];if(!hs.length)return;mutateSplineObjects(hs,()=>{for(const [h,vertices] of grouped){const d=splineData.get(h),active=splineSelection.active?.kind==='handle'&&splineSelection.active.object===h?{segment:splineSelection.active.id,side:splineSelection.active.side}:null;if(kind==='hard')SPLINE.setSplineSoft(d,vertices,false,active);else if(kind==='soft')SPLINE.setSplineSoft(d,vertices,true,active);else if(kind==='equalLength')SPLINE.equalSplineTangentLength(d,vertices,active);else SPLINE.equalSplineTangentDirection(d,vertices,active);syncSplineFreeTangents(d,vertices,kind);}});}
function reverseSelectedSplineSequences(){const grouped=selectedSplineSequences(),hs=[...grouped.keys()];if(!hs.length)return;mutateSplineObjects(hs,()=>{for(const [h,ids] of grouped)for(const q of ids)SPLINE.reverseSplineSequence(splineData.get(h),q);});}
function setSelectedSplineFirst(){const a=splineSelection.active;if(a?.kind!=='vertex')return;const d=splineData.get(a.object);if(!d)return;const q=d.sequences.find(x=>x.segments.some(sid=>{const s=d.segments[sid];return s?.a===a.id||s?.b===a.id;}));if(q)mutateSplineObjects([a.object],()=>SPLINE.setSplineFirst(d,q.id,a.id));}
function setSelectedSplineSequence(){const grouped=new Map();for(const key of splineSelection.segments){const r=parseSplineElementKey(key);if(!splineData.get(r.object)?.segments[r.id])continue;let ids=grouped.get(r.object);if(!ids)grouped.set(r.object,ids=[]);ids.push(r.id);}if(!grouped.size)return false;for(const [h,ids] of grouped){const result=SPLINE.setSegmentsAsSequence(SPLINE.cloneSplineData(splineData.get(h)),ids);if(!result.ok)return false;}mutateSplineObjects([...grouped.keys()],()=>{for(const [h,ids] of grouped)SPLINE.setSegmentsAsSequence(splineData.get(h),ids);});return true;}
function selectConnectedSpline(){const seeds=new Map(),add=(h,id)=>{if(!evaluatedSplineData(h)?.vertices[id])return;let s=seeds.get(h);if(!s)seeds.set(h,s=new Set());s.add(id);};for(const key of splineSelection.vertices){const r=parseSplineElementKey(key);add(r.object,r.id);}for(const key of splineSelection.segments){const r=parseSplineElementKey(key),s=evaluatedSplineData(r.object)?.segments[r.id];if(s){add(r.object,s.a);add(r.object,s.b);}}for(const key of splineSelection.handles){const r=parseSplineElementKey(key),q=parseSplineHandleKey(r.id),info=splineHandleInfo(evaluatedSplineData(r.object),q.segment,q.side);if(info)add(r.object,info.vertex);}if(!seeds.size&&splineSelection.active){const a=splineSelection.active,d=evaluatedSplineData(a.object);if(a.kind==='vertex')add(a.object,a.id);else if(a.kind==='segment'){const s=d?.segments[a.id];if(s){add(a.object,s.a);add(a.object,s.b);}}else{const info=d&&splineHandleInfo(d,a.id,a.side);if(info)add(a.object,info.vertex);}}if(!seeds.size)return false;splineSelectionClearElements();let first=null;for(const [h,start] of seeds){const d=evaluatedSplineData(h),adj=new Map(Object.keys(d.vertices).map(id=>[id,new Set()]));for(const s of Object.values(d.segments)){adj.get(s.a)?.add(s.b);adj.get(s.b)?.add(s.a);}const seen=new Set(start),queue=[...start];while(queue.length){const id=queue.shift();for(const other of adj.get(id)||[])if(!seen.has(other)){seen.add(other);queue.push(other);}}for(const id of seen){splineSelection.vertices.add(splineElementKey(h,id));if(!first)first={object:h,id};}}if(first){splineSelection.active={kind:'vertex',...first};splineSelection.anchor={...first};}componentFocus='spline';updateAllSplineVisuals();placeGizmoForSelection();scheduleRender();return true;}
function splineBevelSelection(){const domain=splineSelection.vertices.size?'vertex':null,grouped=new Map();if(!domain)return {domain:null,grouped};for(const key of splineSelection.vertices){const r=parseSplineElementKey(key);let list=grouped.get(r.object);if(!list)grouped.set(r.object,list=[]);list.push(r.id);}for(const [h,ids] of grouped){const d=evaluatedSplineData(h);grouped.set(h,ids.filter(id=>d?.vertices[id]&&Object.values(d.segments).filter(s=>s.a===id||s.b===id).length===2));}return {domain,grouped};}
function canCreateSplineBevel(){const q=splineBevelSelection();return !!q.domain&&[...q.grouped.values()].some(ids=>ids.length);}
function createSplineBevelTag(options={}){const q=splineBevelSelection();if(!q.domain)return false;const snapshots=new Map(),created=[];for(const [h,ids] of q.grouped){if(!ids.length)continue;const n=OBJ.get(h),d=evaluatedSplineData(h);if(!n||!d)continue;snapshots.set(h,n.tags.map(cloneTag));let scale=Infinity;if(q.domain==='vertex'){for(const id of ids)for(const s of Object.values(d.segments))if(s.a===id||s.b===id)scale=Math.min(scale,SPLINE.splineMath.dist(d.vertices[s.a],d.vertices[s.b]));}else for(const id of ids){const s=d.segments[id];if(s)scale=Math.min(scale,SPLINE.splineMath.dist(d.vertices[s.a],d.vertices[s.b]));}const amount=options.interactive?0:Number.isFinite(options.radius)?Math.max(0,+options.radius):Number.isFinite(scale)?scale*.1:10,tag={type:2,id:genHash(),domain:q.domain,targets:[...new Set(ids)].sort(),profile:options.profile||(q.domain==='vertex'?'round':'flat'),radius:amount,shelfA:Number.isFinite(options.shelfA)?Math.max(0,+options.shelfA):amount,shelfB:Number.isFinite(options.shelfB)?Math.max(0,+options.shelfB):amount};n.tags.push(tag);created.push({h,tag,scale:Number.isFinite(scale)?scale:100});}
if(!created.length)return false;const after=new Map(created.map(({h})=>[h,OBJ.get(h).tags.map(cloneTag)])),apply=state=>{for(const [h,tags] of state){OBJ.get(h).tags=tags.map(cloneTag);invalidateEvaluatedSpline(h);updateSplineVisual(h);}treeChanged();lastAttrKey=null;};if(options.interactive)splineBevelTool={before:snapshots,created,start:null,dragging:false,moved:false};else pushCmd({redo(){apply(after);},undo(){apply(snapshots);}});selTags.clear();for(const {h,tag} of created){const i=OBJ.get(h).tags.findIndex(t=>t.id===tag.id);if(i>=0)selTags.add(tagId(h,i));selNodes.add(h);}anchorTag=parseTagId([...selTags][0]);activateTab('tabAttributes');refreshSelClasses();return true;}
function applySplineBevelTagState(state){for(const [h,tags] of state)if(OBJ.has(h)){OBJ.get(h).tags=tags.map(cloneTag);invalidateEvaluatedSpline(h);updateSplineVisual(h);}treeChanged();lastAttrKey=null;refreshAttributesPanel();placeGizmoForSelection();}
function cancelSplineBevelTool(){if(!splineBevelTool)return false;const before=splineBevelTool.before;splineBevelTool=null;applySplineBevelTagState(before);selTags.clear();refreshSelClasses();return true;}
function finishSplineBevelTool(){const tool=splineBevelTool;if(!tool)return false;splineBevelTool=null;if(!tool.moved){applySplineBevelTagState(tool.before);selTags.clear();refreshSelClasses();return true;}const after=new Map(tool.created.map(({h})=>[h,OBJ.get(h).tags.map(cloneTag)])),before=tool.before;pushCmd({redo(){applySplineBevelTagState(after);},undo(){applySplineBevelTagState(before);}});treeChanged();lastAttrKey=null;refreshAttributesPanel();return true;}
function updateSplineBevelTool(e){const tool=splineBevelTool;if(!tool?.dragging||!tool.start)return;const dx=e.clientX-tool.start.x,dy=e.clientY-tool.start.y,travel=Math.hypot(dx,dy),signed=(dx-dy)/Math.SQRT2;tool.moved=tool.moved||travel>=TAP_PX;for(const item of tool.created){const tag=OBJ.get(item.h)?.tags.find(t=>t.id===item.tag.id);if(!tag)continue;const amount=Math.max(0,signed*item.scale/360);tag.radius=amount;tag.shelfA=amount;tag.shelfB=amount;invalidateEvaluatedSpline(item.h);updateSplineVisual(item.h);}lastAttrKey=null;refreshAttributesPanel();placeGizmoForSelection();scheduleRender();}
function splineOutlineSelection(){const grouped=new Map();for(const key of splineSelection.segments){const r=parseSplineElementKey(key);let list=grouped.get(r.object);if(!list)grouped.set(r.object,list=[]);list.push(r.id);}for(const [h,ids] of grouped)grouped.set(h,[...new Set(ids)].filter(id=>evaluatedSplineData(h)?.segments[id]).sort());return grouped;}
function transformWholeSplineData(data,matrix){SPLINE.transformSplineSelection(data,{vertices:Object.keys(data.vertices)},matrix.elements);return data;}
function selectedSplineSegmentWorldPlane(grouped=splineOutlineSelection()){const points=[],owners=[];for(const [h,ids] of grouped){const d=evaluatedSplineData(h),wm=splineWorldMatrix(h);if(!d||!ids.length)continue;owners.push(h);for(const sid of ids){const p=SPLINE.segmentPoints(d,sid);if(p)for(const q of p)points.push(new THREE.Vector3().fromArray(q).applyMatrix4(wm));}}return deterministicSplineWorldPlane(points,owners[0]);}
function canCreateSplineOutline(){const grouped=splineOutlineSelection();if(![...grouped.values()].some(ids=>ids.length))return false;const plane=selectedSplineSegmentWorldPlane(grouped);if(!plane?.planar)return false;for(const [h,ids] of grouped){const d=SPLINE.cloneSplineData(evaluatedSplineData(h)),wm=splineWorldMatrix(h);transformWholeSplineData(d,wm);if(!SPLINE.analyzeSplineOutline(d,ids,{normal:plane.normal.toArray(),tolerance:plane.tolerance}).ok)return false;}return true;}
function applySplineOutlinePreview(tool,distance){const results=[];try{for(const item of tool.items){const world=transformWholeSplineData(SPLINE.cloneSplineData(item.base),item.world),result=SPLINE.applySplineOutline(world,item.segments,{distance,normal:tool.plane.normal.toArray(),tolerance:tool.plane.tolerance,weldTolerance:1e-6}),local=transformWholeSplineData(result.data,item.world.clone().invert());splineData.set(item.h,local);invalidateEvaluatedSpline(item.h);updateSplineVisual(item.h);results.push({h:item.h,generated:result.generated});}}catch(error){for(const item of tool.items){splineData.set(item.h,SPLINE.cloneSplineData(item.base));invalidateEvaluatedSpline(item.h);updateSplineVisual(item.h);}tool.error=error;return false;}tool.error=null;tool.distance=distance;tool.results=results;placeGizmoForSelection();scheduleRender();return true;}
function selectSplineOutlineResult(tool){const segments=[];for(const result of tool.results||[])for(const id of result.generated.segments)if(splineData.get(result.h)?.segments[id])segments.push(splineElementKey(result.h,id));splineSelection.vertices.clear();splineSelection.handles.clear();splineSelection.segments=new Set(segments);splineSelection.pivot=null;const last=segments.length&&parseSplineElementKey(segments.at(-1));splineSelection.active=last?{kind:'segment',object:last.object,id:last.id}:null;splineSelection.anchor=last&&{object:last.object,id:last.id};componentFocus='spline';}
function beginSplineOutline(options={}){const grouped=splineOutlineSelection(),plane=selectedSplineSegmentWorldPlane(grouped);if(!plane?.planar)return false;const owners=[...grouped].filter(([,ids])=>ids.length).map(([h])=>h),before=captureSplineFullState(owners),beforeSelection=splineSelectionState();autoBakeSplineTags(owners);const items=[];for(const h of owners){const segments=grouped.get(h),base=SPLINE.cloneSplineData(splineData.get(h)),world=splineWorldMatrix(h);const probe=transformWholeSplineData(SPLINE.cloneSplineData(base),world);if(!SPLINE.analyzeSplineOutline(probe,segments,{normal:plane.normal.toArray(),tolerance:plane.tolerance}).ok){restoreSplineFullState(before,beforeSelection);return false;}items.push({h,segments,base,world});}if(!items.length)return false;const scale=Math.max(10,plane.scale*.5),tool={before,beforeSelection,items,plane,scale,start:null,dragging:false,moved:false,distance:0,results:[]};if(options.interactive!==false){splineOutlineTool=tool;activateTab('tabAttributes');lastAttrKey=null;refreshAttributesPanel();return true;}const distance=Number(options.distance);if(!Number.isFinite(distance)||Math.abs(distance)<1e-9){restoreSplineFullState(before,beforeSelection);return false;}if(!applySplineOutlinePreview(tool,distance)){restoreSplineFullState(before,beforeSelection);throw tool.error;}selectSplineOutlineResult(tool);const after=captureSplineFullState(owners),afterSelection=splineSelectionState();pushCmd({redo(){restoreSplineFullState(after,afterSelection);},undo(){restoreSplineFullState(before,beforeSelection);}});updateAllSplineVisuals();placeGizmoForSelection();return tool;}
function cancelSplineOutlineTool(){const tool=splineOutlineTool;if(!tool)return false;splineOutlineTool=null;restoreSplineFullState(tool.before,tool.beforeSelection);lastAttrKey=null;refreshAttributesPanel();return true;}
function finishSplineOutlineTool(){const tool=splineOutlineTool;if(!tool)return false;splineOutlineTool=null;if(!tool.moved||tool.error||Math.abs(tool.distance)<1e-9){restoreSplineFullState(tool.before,tool.beforeSelection);lastAttrKey=null;refreshAttributesPanel();return true;}selectSplineOutlineResult(tool);const after=captureSplineFullState(tool.items.map(x=>x.h)),afterSelection=splineSelectionState(),before=tool.before,beforeSelection=tool.beforeSelection;pushCmd({redo(){restoreSplineFullState(after,afterSelection);},undo(){restoreSplineFullState(before,beforeSelection);}});updateAllSplineVisuals();placeGizmoForSelection();lastAttrKey=null;refreshAttributesPanel();return true;}
function updateSplineOutlineTool(e){const tool=splineOutlineTool;if(!tool?.dragging||!tool.start)return;const dx=e.clientX-tool.start.x,dy=e.clientY-tool.start.y,screenDistance=Math.hypot(dx,dy);tool.moved=tool.moved||screenDistance>=TAP_PX;if(!tool.moved)return;const distance=(dx-dy*.35)*tool.scale/180;if(applySplineOutlinePreview(tool,distance)){lastAttrKey=null;refreshAttributesPanel();}}
function showSplineContextMenu(x,y){vpMenu.innerHTML='';const items=[['Outline',()=>beginSplineOutline({interactive:true}),!canCreateSplineOutline()],['Select Connected (W)',selectConnectedSpline,false],['Hard',()=>splineTangentCommand('hard'),false],['Soft',()=>splineTangentCommand('soft'),false],['Equal Tangent Length',()=>splineTangentCommand('equalLength'),false],['Equal Tangent Direction',()=>splineTangentCommand('equalDirection'),false],['Vertex Bevel',()=>createSplineBevelTag({interactive:true}),!canCreateSplineBevel()]];for(const [label,action,disabled] of items){const el=document.createElement('div');el.className='obm-item'+(disabled?' disabled':'');el.textContent=label;if(!disabled)el.addEventListener('click',()=>{hideVertexContextMenu();action();});vpMenu.appendChild(el);}placePopupMenu(vpMenu,x,y);}
addEventListener('pointerdown',e=>{if(!vpMenu.contains(e.target))hideVertexContextMenu();},true);
addEventListener('pointerdown',e=>{const inViewport=!!e.target.closest?.('#vp'),inMenu=vpMenu.contains(e.target),inAttributes=!!e.target.closest?.('#attributesPanel');if(splineBevelTool&&!inViewport&&!inMenu&&!inAttributes)cancelSplineBevelTool();if(splineOutlineTool&&!inViewport&&!inMenu&&!inAttributes)cancelSplineOutlineTool();if(splineDrawing&&!inViewport&&!inMenu&&!inAttributes)finishSplineDrawing();if(vertexTools.mode==='lineCut'&&!inViewport&&!inMenu&&!inAttributes)finishLineCut();if((vertexTools.mode==='addPoint'||vertexTools.mode==='loop'||vertexTools.mode==='closeHole')&&!inViewport&&!inMenu)leaveVertexTool();},true);
function onlySplineNodes(){return selNodes.size>0&&[...selNodes].every(h=>isSpline(h)&&splineData.has(h));}
function selectedSplineNodes(){return [...selNodes].filter(h=>isSpline(h)&&splineData.has(h));}
function selectedPolygonNodes(){return [...selNodes].filter(h=>pickMeshes.has(h)&&!isSpline(h));}
function splineFocusActive(){return splineMode&&(componentFocus==='spline'||!polyMode||!polySelection.items.size);}
function pruneSplineSelection(){const validKey=key=>{const r=parseSplineElementKey(key);return selNodes.has(r.object)&&splineData.has(r.object);};for(const set of [splineSelection.vertices,splineSelection.handles,splineSelection.segments])for(const key of [...set])if(!validKey(key))set.delete(key);if(splineSelection.active&&!selNodes.has(splineSelection.active.object))splineSelection.active=null;if(splineSelection.anchor&&!selNodes.has(splineSelection.anchor.object))splineSelection.anchor=null;if(!splineSelection.vertices.size&&!splineSelection.handles.size&&!splineSelection.segments.size)splineSelection.pivot=null;}
function syncVertexEditTargets(preferred=null){if(!vertexEditActive)return;const splines=selectedSplineNodes(),polys=selectedPolygonNodes();splineMode=splines.length>0;polyMode=polys.length>0;polyElementMode='vertex';pruneSplineSelection();prunePolySelection();if(preferred&&selNodes.has(preferred)){if(splineData.has(preferred))componentFocus='spline';else if(pickMeshes.has(preferred))componentFocus='poly';}if(componentFocus==='spline'&&!splineMode)componentFocus=polyMode?'poly':'spline';if(componentFocus==='poly'&&!polyMode)componentFocus=splineMode?'spline':'poly';for(const [kind,button] of Object.entries(modeButtons))button.classList.toggle('on',kind==='vertex');setCreaseDisplay(!polyMode);updateAllSplineVisuals();}
function clearSplineSelection(){splineSelection.vertices.clear();splineSelection.handles.clear();splineSelection.segments.clear();splineSelection.active=null;splineSelection.anchor=null;splineSelection.pivot=null;clearSplineHover();updateAllSplineVisuals();}
function enterSplineEdit(drawing=false){if(!selectedSplineNodes().length)return false;stopVertexModeTool();disableSoftSelection(false);vertexEditActive=true;splineMode=true;polyMode=selectedPolygonNodes().length>0;polyElementMode='vertex';componentFocus='spline';splineDrawing=!!drawing;splineDrawSequence=null;splineLastVertex=null;splineDrawHistory=[];splineCtrlSequence=null;splineCtrlLastVertex=null;splineWorkPlane=null;for(const [kind,button] of Object.entries(modeButtons))button.classList.toggle('on',kind==='vertex');setCreaseDisplay(!polyMode);setGizmoVisible(false);clearPolyHover();updateAllSplineVisuals();placeGizmoForSelection();scheduleRender();return true;}
function beginSplineDrawOnActive(){let h=anchorNode?.hash&&selNodes.has(anchorNode.hash)&&splineData.has(anchorNode.hash)?anchorNode.hash:[...selNodes].find(x=>splineData.has(x));if(!h)return false;if(splineDrawing)finishSplineDrawing();if(selNodes.size!==1||!selNodes.has(h)){selNodes.clear();selTags.clear();selNodes.add(h);anchorNode=OBJ.get(h);refreshSelClasses();}if(!splineMode)enterSplineEdit(false);splineSelectionClearElements();splineSelection.anchor=null;splineDrawing=true;splineDrawSequence=null;splineLastVertex=null;splineDrawHistory=[];splineCtrlSequence=null;splineCtrlLastVertex=null;splineWorkPlane=null;updateAllSplineVisuals();placeGizmoForSelection();return true;}
function leaveSplineEdit(){hideSplineDrawPreview();splineMode=false;polyMode=false;vertexEditActive=false;splineDrawing=false;splineDrawSequence=null;splineLastVertex=null;splineDrawHistory=[];splineCtrlSequence=null;splineCtrlLastVertex=null;splineWorkPlane=null;clearSplineSelection();clearPolySelection();for(const button of Object.values(modeButtons))button.classList.remove('on');setGizmoVisible(selNodes.size>0);placeGizmoForSelection();}
function finishSplineDrawing(){if(!splineDrawing)return;hideSplineDrawPreview();const h=[...selNodes].find(x=>splineData.has(x)),d=h&&splineData.get(h);if(d&&splineLastVertex){const used=Object.values(d.segments).some(s=>s.a===splineLastVertex||s.b===splineLastVertex);if(!used&&splineDrawHistory.length===1&&undoStack.length){const c=undoStack.pop();c.undo();discardHistoryEntry(c);clearCommandStack(redoStack);afterCmd();}else{if(!used)delete d.vertices[splineLastVertex];SPLINE.cleanupSpline(d);updateSplineVisual(h);}}splineDrawing=false;splineDrawSequence=null;splineLastVertex=null;splineDrawHistory=[];splineWorkPlane=null;placeGizmoForSelection();}
function deleteLastSplineDrawPoint(){if(!splineDrawing||!splineDrawHistory.length)return false;undo();splineDrawHistory.pop();const h=activeSplineObject(),d=h&&splineData.get(h),q=d?.sequences.find(x=>x.id===splineDrawSequence);splineLastVertex=splineDrawHistory.at(-1)?.vertex||(q?.segments.length?d.segments[q.segments.at(-1)].b:(q?.first||null));if(!q)splineDrawSequence=null;if(splineLastVertex){splineSelectionClearElements();splineSelection.vertices.add(splineElementKey(h,splineLastVertex));splineSelection.active={kind:'vertex',object:h,id:splineLastVertex};splineSelection.anchor={object:h,id:splineLastVertex};updateAllSplineVisuals();placeGizmoForSelection();}return true;}
function splineSelectionState(){return {vertices:[...splineSelection.vertices],handles:[...splineSelection.handles],segments:[...splineSelection.segments],active:splineSelection.active&&{...splineSelection.active},anchor:splineSelection.anchor&&{...splineSelection.anchor},pivot:splineSelection.pivot&&splineSelection.pivot.slice()};}
function restoreSplineSelectionState(s){splineSelection.vertices=new Set(s?.vertices||[]);splineSelection.handles=new Set(s?.handles||[]);splineSelection.segments=new Set(s?.segments||[]);splineSelection.active=s?.active&&{...s.active};splineSelection.anchor=s?.anchor&&{...s.anchor};splineSelection.pivot=s?.pivot&&s.pivot.slice();}
function restoreSplineDataState(states,selection){for(const [h,d] of states)if(OBJ.has(h)){splineData.set(h,SPLINE.cloneSplineData(d));invalidateEvaluatedSpline(h);if(!splineVisuals.has(h))installSplineObject(h,splineData.get(h));else updateSplineVisual(h);}if(selection)restoreSplineSelectionState(selection);updateAllSplineVisuals();placeGizmoForSelection();scheduleRender();}
function captureSplineFullState(hashes){return new Map([...new Set(hashes)].filter(h=>splineData.has(h)&&OBJ.has(h)).map(h=>[h,{data:SPLINE.cloneSplineData(splineData.get(h)),tags:OBJ.get(h).tags.map(cloneTag)}]));}
function splineSelectionOwners(){const hs=new Set();for(const key of [...splineSelection.vertices,...splineSelection.handles,...splineSelection.segments])hs.add(parseSplineElementKey(key).object);return [...hs].filter(h=>splineData.has(h));}
function restoreSplineFullState(states,selection){for(const [h,state] of states)if(OBJ.has(h)){splineData.set(h,SPLINE.cloneSplineData(state.data));OBJ.get(h).tags=state.tags.map(cloneTag);invalidateEvaluatedSpline(h);updateSplineVisual(h);}if(selection)restoreSplineSelectionState(selection);treeChanged();updateAllSplineVisuals();placeGizmoForSelection();scheduleRender();}
function autoBakeSplineTags(hashes){let changed=false;for(const h of new Set(hashes)){const n=OBJ.get(h);if(!n||!splineData.has(h)||!n.tags.some(t=>t.type===2))continue;splineData.set(h,SPLINE.cloneSplineData(evaluatedSplineData(h)));n.tags=n.tags.filter(t=>t.type!==2);invalidateEvaluatedSpline(h);changed=true;}if(changed){treeChanged();updateAllSplineVisuals();}return changed;}
function mutateSplineObjects(hashes,fn){const hs=[...new Set(hashes)].filter(h=>splineData.has(h)),before=captureSplineFullState(hs),beforeSel=splineSelectionState();autoBakeSplineTags(hs);const result=fn();const after=captureSplineFullState(hs),afterSel=splineSelectionState();updateAllSplineVisuals();placeGizmoForSelection();pushCmd({redo(){restoreSplineFullState(after,afterSel);},undo(){restoreSplineFullState(before,beforeSel);}});return result;}
function splineSelectionClearElements(){splineSelection.vertices.clear();splineSelection.handles.clear();splineSelection.segments.clear();splineSelection.active=null;splineSelection.pivot=null;}
function splineSelectHit(hit,mode='replace'){if(!hit){if(mode==='replace'){splineSelectionClearElements();placeGizmoForSelection();updateAllSplineVisuals();}return null;}componentFocus='spline';const set=hit.kind==='vertex'?splineSelection.vertices:hit.kind==='handle'?splineSelection.handles:splineSelection.segments,id=hit.kind==='handle'?splineElementKey(hit.object,splineHandleKey(hit.id,hit.side)):splineElementKey(hit.object,hit.id);if(mode==='replace')splineSelectionClearElements();if(mode==='invert'&&set.has(id))set.delete(id);else set.add(id);splineSelection.active={kind:hit.kind,object:hit.object,id:hit.id,side:hit.side||null};if(hit.kind==='vertex'){splineSelection.anchor={object:hit.object,id:hit.id};const cam=vpState.views[hit.view]?.cam;if(cam&&hit.world)splineWorkPlane={point:hit.world.clone(),normal:cam.getWorldDirection(new THREE.Vector3())};}else if(hit.kind==='segment'){const s=evaluatedSplineData(hit.object)?.segments[hit.id];if(s)splineSelection.anchor={object:hit.object,id:(hit.t||0)<.5?s.a:s.b};}splineSelection.pivot=null;updateAllSplineVisuals();placeGizmoForSelection();return hit;}
function nearestPolygonVertex(cx,cy,vi,radius=SNAP_PX,referenceWorld=null){if(!snapOn)return null;const r=rectFor(vi),cam=vpState.views[vi]?.cam,wire=viewShading[vi]===1;if(!r||!cam)return null;let best=null,bd=radius*radius,bwd=Infinity,p=new THREE.Vector3();for(const [h,m] of pickMeshes){if(!OBJ.has(h)||!effectiveVisible(h)||isSpline(h))continue;m.updateMatrixWorld(true);const pos=m.geometry?.attributes.position;if(!pos)continue;for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld);const ndc=p.clone().project(cam);if(ndc.z<-1||ndc.z>1||(!wire&&!exactVertexVisible(p,ndc,cam)))continue;const s=projectPx(p,cam,r),d=(s[0]-cx)**2+(s[1]-cy)**2,wd=referenceWorld?p.distanceToSquared(referenceWorld):p.distanceToSquared(cam.position);if(d<bd-1e-6||(Math.abs(d-bd)<=1e-6&&wd<bwd)){bd=d;bwd=wd;best={world:p.clone(),object:h,vertex:i};}}}return best;}
function splinePointOnPlane(cx,cy,vi,object){const r=rectFor(vi),cam=vpState.views[vi]?.cam;if(!r||!cam)return null;cam.updateMatrixWorld(true);cam.updateProjectionMatrix();pickNdc.set(((cx-r.x)/r.w)*2-1,-((cy-r.y)/r.h)*2+1);pickRay.setFromCamera(pickNdc,cam);let point,normal;if(splineWorkPlane){point=splineWorkPlane.point;normal=splineWorkPlane.normal;}else if(cam.isPerspectiveCamera){point=new THREE.Vector3(0,0,0);normal=new THREE.Vector3(0,1,0);}else{normal=cam.getWorldDirection(new THREE.Vector3());point=splineSelection.anchor?splineWorldPoint(splineSelection.anchor.object,splineData.get(splineSelection.anchor.object)?.vertices[splineSelection.anchor.id]||[0,0,0]):new THREE.Vector3();}const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point),world=new THREE.Vector3();if(!pickRay.ray.intersectPlane(plane,world))return null;if(snapOn&&!splineWorkPlane){const step=quantStep();world.set(Math.round(world.x/step)*step,Math.round(world.y/step)*step,Math.round(world.z/step)*step);}else if(quantOn&&!splineWorkPlane){const step=quantStep();world.set(Math.round(world.x/step)*step,Math.round(world.y/step)*step,Math.round(world.z/step)*step);}return world.applyMatrix4(splineWorldMatrix(object).clone().invert()).toArray();}
function splinePlacement(cx,cy,vi,object){const vh=splineScreenHit(cx,cy,{editing:false,vertices:true,handles:false,segments:false});if(vh&&vh.d2<=SNAP_PX*SNAP_PX){const cam=vpState.views[vi].cam;splineWorkPlane={point:vh.world.clone(),normal:cam.getWorldDirection(new THREE.Vector3())};return {local:vh.world.clone().applyMatrix4(splineWorldMatrix(object).clone().invert()).toArray(),vertex:{object:vh.object,id:vh.id},world:vh.world.clone(),snapped:true};}const anchor=splineSelection.anchor,d=splineData.get(anchor?.object),reference=anchor&&d?.vertices[anchor.id]?splineWorldPoint(anchor.object,d.vertices[anchor.id]):null,ph=nearestPolygonVertex(cx,cy,vi,SNAP_PX,reference);if(ph){const cam=vpState.views[vi].cam;splineWorkPlane={point:ph.world.clone(),normal:cam.getWorldDirection(new THREE.Vector3())};return {local:ph.world.clone().applyMatrix4(splineWorldMatrix(object).clone().invert()).toArray(),world:ph.world.clone(),snapped:true,polygon:ph};}const local=splinePointOnPlane(cx,cy,vi,object);return local&&{local,world:splineWorldPoint(object,local),snapped:false};}
function activeSplineObject(){return splineSelection.anchor?.object&&splineData.has(splineSelection.anchor.object)?splineSelection.anchor.object:[...selNodes].find(h=>splineData.has(h))||null;}
function addSplineDrawPoint(cx,cy,vi,{dragWorld=null,forceNew=false,transientCtrl=false}={}){
const h=activeSplineObject();if(!h)return null;const d=splineData.get(h),placement=splinePlacement(cx,cy,vi,h);if(!placement)return null;
if(dragWorld&&(!Number.isFinite(dragWorld.x)||!Number.isFinite(dragWorld.y)||!Number.isFinite(dragWorld.z)||dragWorld.length()>1e9))dragWorld=null;
if(dragWorld){const origin=placement.world,end=origin.clone().add(dragWorld),snapped=snapMoveScreen(end,vi,null,origin);dragWorld=snapped.sub(origin);}
return mutateSplineObjects([h],()=>{
if(transientCtrl){splineDrawSequence=splineCtrlSequence;splineLastVertex=splineCtrlLastVertex||(splineSelection.active?.kind==='vertex'&&splineSelection.active.object===h?splineSelection.active.id:null);}
let vid=placement.vertex?.object===h?placement.vertex.id:null;if(!vid||forceNew)vid=SPLINE.addSplineVertex(d,placement.local);
if(!splineDrawSequence){splineDrawSequence=SPLINE.addSplineSequence(d,false);if(!splineLastVertex&&splineSelection.anchor?.object===h)splineLastVertex=splineSelection.anchor.id;}
if(splineLastVertex&&splineLastVertex!==vid){
const previous=splineLastVertex,previousOut=d.freeHandles?.[previous]?.out||[0,0,0],targetIn=placement.vertex?.object===h?(d.freeHandles?.[vid]?.in||[0,0,0]):[0,0,0],sid=SPLINE.addSplineSegment(d,splineDrawSequence,previous,vid,previousOut,targetIn);
if(dragWorld){const inv=splineWorldMatrix(h).clone().invert(),origin=splineWorldPoint(h,d.vertices[vid]),tip=origin.clone().add(dragWorld).applyMatrix4(inv),vec=SPLINE.splineMath.sub(tip.toArray(),d.vertices[vid]),s=d.segments[sid];s.hb=SPLINE.splineMath.mul(vec,-1);d.freeHandles=d.freeHandles||{};d.freeHandles[vid]={in:SPLINE.splineMath.mul(vec,-1),out:vec.slice()};}
const q=d.sequences.find(x=>x.id===splineDrawSequence);if(placement.vertex&&q?.segments.length>1&&vid===d.segments[q.segments[0]].a)q.closed=true;
}else if(dragWorld){const inv=splineWorldMatrix(h).clone().invert(),origin=splineWorldPoint(h,d.vertices[vid]),tip=origin.clone().add(dragWorld).applyMatrix4(inv),vec=SPLINE.splineMath.sub(tip.toArray(),d.vertices[vid]);d.freeHandles=d.freeHandles||{};d.freeHandles[vid]={in:SPLINE.splineMath.mul(vec,-1),out:vec.slice()};}
splineLastVertex=vid;if(transientCtrl){splineCtrlSequence=splineDrawSequence;splineCtrlLastVertex=vid;splineDrawing=false;splineDrawSequence=null;splineLastVertex=null;}else{splineDrawing=true;splineDrawHistory.push({object:h,vertex:vid});}splineSelectionClearElements();splineSelection.vertices.add(splineElementKey(h,vid));splineSelection.active={kind:'vertex',object:h,id:vid};splineSelection.anchor={object:h,id:vid};return {object:h,vertex:vid,sequence:transientCtrl?splineCtrlSequence:splineDrawSequence};});}
function splineScreenPlaneDelta(x0,y0,x1,y1,vi,through){const r=rectFor(vi),cam=vpState.views[vi]?.cam;if(!r||!cam||!through)return new THREE.Vector3();cam.updateMatrixWorld(true);const normal=cam.getWorldDirection(new THREE.Vector3()),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,through),at=(x,y)=>{const ndc=new THREE.Vector2(((x-r.x)/r.w)*2-1,-((y-r.y)/r.h)*2+1),ray=new THREE.Raycaster();ray.setFromCamera(ndc,cam);return ray.ray.intersectPlane(plane,new THREE.Vector3());},a=at(x0,y0),b=at(x1,y1),d=a&&b?b.sub(a):new THREE.Vector3();return Number.isFinite(d.x)&&Number.isFinite(d.y)&&Number.isFinite(d.z)&&d.length()<1e9?d:new THREE.Vector3();}
function hideSplineDrawPreview(){let changed=false;for(const preview of [splineDrawPreview,splineTangentPreview])if(preview?.visible){preview.visible=false;changed=true;}if(changed)scheduleRender();}
function setSplineDrawPreviewPoints(points){if(!splineDrawPreview)return;const old=splineDrawPreview.geometry,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));splineDrawPreview.geometry=g;old?.dispose();splineDrawPreview.visible=points.length>1;scheduleRender();}
function setSplineTangentPreviewPoints(points){if(!splineTangentPreview)return;const old=splineTangentPreview.geometry,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));splineTangentPreview.geometry=g;old?.dispose();splineTangentPreview.visible=points.length>1;scheduleRender();}
function updateSplineDrawGesturePreview(gesture,e){const h=activeSplineObject(),d=h&&splineData.get(h);if(!h||!d)return hideSplineDrawPreview();if(!gesture.previewPlacement){const p=splinePlacement(gesture.x,gesture.y,gesture.view,h);if(!p)return hideSplineDrawPreview();gesture.previewPlacement={local:p.local.slice(),world:p.world.clone(),vertex:p.vertex&&{...p.vertex}};}const placement=gesture.previewPlacement,raw=splineScreenPlaneDelta(gesture.x,gesture.y,e.clientX,e.clientY,gesture.view,placement.world),snappedTip=snapMoveScreen(placement.world.clone().add(raw),gesture.view,[e.clientX,e.clientY],placement.world),delta=snappedTip.sub(placement.world),inv=splineWorldMatrix(h).clone().invert(),tip=placement.world.clone().add(delta).applyMatrix4(inv),vec=SPLINE.splineMath.sub(tip.toArray(),placement.local),previous=splineLastVertex||splineCtrlLastVertex||(splineSelection.anchor?.object===h?splineSelection.anchor.id:null),wm=splineWorldMatrix(h),world=p=>new THREE.Vector3().fromArray(p).applyMatrix4(wm),tangentA=world(SPLINE.splineMath.sub(placement.local,vec)),tangentB=world(SPLINE.splineMath.add(placement.local,vec));setSplineTangentPreviewPoints([tangentA,placement.world,tangentB]);if(previous&&d.vertices[previous]&&previous!==(placement.vertex?.object===h?placement.vertex.id:null)){const p0=d.vertices[previous],p1=SPLINE.splineMath.add(p0,d.freeHandles?.[previous]?.out||[0,0,0]),p3=placement.local,p2=SPLINE.splineMath.sub(p3,vec),curve=[p0,p1,p2,p3],points=[];for(let i=0;i<=32;i++)points.push(world(SPLINE.cubicPoint(curve,i/32)));setSplineDrawPreviewPoints(points);}else setSplineDrawPreviewPoints([]);}
function beginSplineDirectDrag(gesture,e){
const hit=gesture.hit;if(!hit||!splineData.has(hit.object))return false;
const selected=splineHitSelected(hit),mode=selected?'add':((gesture.shift||gesture.ctrl)?'add':'replace');
splineSelectHit(hit,mode);
const frame=splineFrameMatrix();if(!frame)return false;
const owners=splineSelectionOwners();gesture.fullBefore=captureSplineFullState(owners);gesture.beforeSelection=splineSelectionState();autoBakeSplineTags(owners);
gesture.direct=true;gesture.before=splineDataSnapshot();gesture.through=hit.world.clone();gesture.startCenter=new THREE.Vector3().setFromMatrixPosition(frame);gesture.mods={ctrl:gesture.ctrl,shift:gesture.shift};
splineWeldCandidate=null;gizDrag={mode:'move',kind:'screen',view:gesture.view,r:rectFor(gesture.view),startPos:gesture.startCenter.clone()};
clearSplineHover();e.preventDefault();return true;
}
function constrainSplineDirectDelta(gesture,raw){
const view=vpState.views[gesture.view],cam=view?.cam;if(!view||!cam)return raw;
cam.updateMatrixWorld(true);
const axes=view.type==='ortho'?[view.axU.clone(),view.axV.clone()]:[new THREE.Vector3(1,0,0).applyQuaternion(cam.quaternion),new THREE.Vector3(0,1,0).applyQuaternion(cam.quaternion)];
const out=new THREE.Vector3();
if(quantOn){const step=quantStep();for(const axis of axes)out.addScaledVector(axis,Math.round(raw.dot(axis)/step)*step);return out;}
if(snapOn){const pw=snapVisPw(gesture.view),step=view.type==='ortho'?orthoVisibleStep(pw):snapVisibleStep(pw),target=gesture.startCenter.clone().add(raw);for(const axis of axes)out.addScaledVector(axis,Math.round(target.dot(axis)/step)*step-gesture.startCenter.dot(axis));return out;}
return raw;
}
function moveSplineDirectDrag(gesture,e){
if(!gesture.before||!gesture.through)return;
gesture.mods={ctrl:!!(e.ctrlKey||e.metaKey),shift:!!e.shiftKey};
const raw=splineScreenPlaneDelta(gesture.x,gesture.y,e.clientX,e.clientY,gesture.view,gesture.through),delta=constrainSplineDirectDelta(gesture,raw),matrix=new THREE.Matrix4().makeTranslation(delta.x,delta.y,delta.z);
applySplineTransformSnapshot(gesture.before,matrix,gesture.mods);scheduleRender();
}
function finishSplineDirectDrag(gesture){
if(!gesture.before)return;
trySplineWeldAfterDrag();
const owners=[...gesture.fullBefore.keys()],before=gesture.fullBefore,after=captureSplineFullState(owners),beforeSel=gesture.beforeSelection,afterSel=splineSelectionState(),changed=JSON.stringify([...before])!==JSON.stringify([...after])||JSON.stringify(beforeSel)!==JSON.stringify(afterSel);
if(changed)pushCmd({redo(){restoreSplineFullState(after,afterSel);},undo(){restoreSplineFullState(before,beforeSel);}});
gizDrag=null;splineWeldCandidate=null;updateAllSplineVisuals();placeGizmoForSelection();if([...replicaStates.values()].some(state=>state.needsFinalBuild))scheduleGeneratorEvaluation(0);scheduleRender();
}
function duplicateSplineSegmentDrag(gesture,e){const hit=gesture.hit;if(!evaluatedSplineData(hit.object))return;mutateSplineObjects([hit.object],()=>{const d=splineData.get(hit.object),chosen=splineSelection.segments.has(splineElementKey(hit.object,hit.id))?[...splineSelection.segments].map(parseSplineElementKey).filter(x=>x.object===hit.object).map(x=>x.id):[hit.id],copy=SPLINE.duplicateSplineSegments(d,chosen),delta=splineScreenPlaneDelta(gesture.x,gesture.y,e.clientX,e.clientY,gesture.view,hit.world),inv=splineWorldMatrix(hit.object).clone().invert(),localDelta=delta.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(inv));for(const vid of copy.vertices)d.vertices[vid]=SPLINE.splineMath.add(d.vertices[vid],localDelta.toArray());splineSelectionClearElements();for(const sid of copy.segments)splineSelection.segments.add(splineElementKey(hit.object,sid));splineSelection.active={kind:'segment',object:hit.object,id:copy.segments[0]};});}
function insertSplineAtHit(hit){if(!hit||hit.kind!=='segment')return null;return mutateSplineObjects([hit.object],()=>{const result=SPLINE.splitSplineSegment(splineData.get(hit.object),hit.id,hit.t);splineSelectionClearElements();splineSelection.vertices.add(splineElementKey(hit.object,result.vertex));splineSelection.active={kind:'vertex',object:hit.object,id:result.vertex};splineSelection.anchor={object:hit.object,id:result.vertex};return result;});}
function splineClick(cx,cy,mods={}){const vi=viewAt(cx,cy);if(vi<0)return null;const hit=splineScreenHit(cx,cy);if(splineDrawing){if(hit?.kind==='vertex'&&!splineLastVertex){splineLastVertex=hit.id;splineSelection.anchor={object:hit.object,id:hit.id};return splineSelectHit(hit,'replace');}const joinsExisting=hit?.kind==='vertex'&&!!splineLastVertex,result=addSplineDrawPoint(cx,cy,vi);if(joinsExisting&&result)finishSplineDrawing();return result;}if(mods.ctrl&&hit?.kind==='segment')return insertSplineAtHit(hit);if(mods.ctrl&&!hit)return addSplineDrawPoint(cx,cy,vi,{transientCtrl:true});if(!mods.ctrl){splineCtrlSequence=null;splineCtrlLastVertex=null;}const mode=mods.ctrl?'invert':mods.shift?'add':'replace';return splineSelectHit(hit,mode);}
function splineBoxPick(x0,y0,x1,y1,mode='replace'){const vi=viewAt((x0+x1)/2,(y0+y1)/2),r=rectFor(vi),cam=vpState.views[vi]?.cam;if(vi<0||!r||!cam)return;const box={x0:Math.min(x0,x1),x1:Math.max(x0,x1),y0:Math.min(y0,y1),y1:Math.max(y0,y1)},wire=viewShading[vi]===1;if(mode==='replace')splineSelectionClearElements();for(const h of selNodes){const d=evaluatedSplineData(h);if(!d||!effectiveVisible(h))continue;for(const [vid,p] of Object.entries(d.vertices)){const world=splineWorldPoint(h,p),ndc=world.clone().project(cam),s=projectPx(world,cam,r);if(ndc.z<-1||ndc.z>1||s[0]<box.x0||s[0]>box.x1||s[1]<box.y0||s[1]>box.y1)continue;if(!wire&&!exactVertexVisible(world,ndc,cam))continue;const key=splineElementKey(h,vid);if(mode==='invert'&&splineSelection.vertices.has(key))splineSelection.vertices.delete(key);else splineSelection.vertices.add(key);}}splineSelection.pivot=null;updateAllSplineVisuals();placeGizmoForSelection();}
function deleteSelectedSplineElements(){const grouped=new Map(),ignoreHandles=splineSelection.vertices.size>0,ensure=h=>{let q=grouped.get(h);if(!q)grouped.set(h,q={vertices:[],segments:[],handles:[]});return q;};for(const key of splineSelection.vertices){const r=parseSplineElementKey(key);ensure(r.object).vertices.push(r.id);}for(const key of splineSelection.segments){const r=parseSplineElementKey(key);ensure(r.object).segments.push(r.id);}if(!ignoreHandles)for(const key of splineSelection.handles){const r=parseSplineElementKey(key),h=parseSplineHandleKey(r.id);ensure(r.object).handles.push(h);}if(!grouped.size)return;mutateSplineObjects([...grouped.keys()],()=>{for(const [h,q] of grouped){const d=splineData.get(h);for(const x of q.handles){const info=splineHandleInfo(d,x.segment,x.side);if(info)splineSetHandleVector(d,info,[0,0,0]);}SPLINE.deleteSplineElements(d,q);}splineSelectionClearElements();});}
function setPolyElementMode(mode){if(mode==='vertex'){if(vertexEditActive){hideSplineDrawPreview();vertexEditActive=false;splineMode=false;polyMode=false;splineDrawing=false;clearSplineSelection();clearPolySelection();for(const button of Object.values(modeButtons))button.classList.remove('on');setCreaseDisplay(true);setGizmoVisible(selNodes.size>0);placeGizmoForSelection();scheduleRender();return;}stopVertexModeTool();disableSoftSelection(false);vertexEditActive=true;polyElementMode='vertex';splineMode=selectedSplineNodes().length>0;polyMode=selectedPolygonNodes().length>0;componentFocus=splineMode?'spline':'poly';clearSplineHover();clearPolyHover();clearSplineSelection();clearPolySelection();for(const [kind,button] of Object.entries(modeButtons))button.classList.toggle('on',kind==='vertex');setCreaseDisplay(!polyMode);setGizmoVisible(false);updateAllSplineVisuals();placeGizmoForSelection();scheduleRender();return;}if(splineMode||vertexEditActive)leaveSplineEdit();const wasActive=polyMode&&polyElementMode===mode;stopVertexModeTool();disableSoftSelection(false);polyMode=!wasActive;polyElementMode=mode;componentFocus='poly';setCreaseDisplay(!polyMode);for(const [kind,button] of Object.entries(modeButtons))button.classList.toggle('on',polyMode&&kind===mode);clearPolyHover();clearPolySelection();setGizmoVisible(polyMode?polySelection.items.size>0:selNodes.size>0);placeGizmoForSelection();scheduleRender();}
for(const [mode,button] of Object.entries(modeButtons))button.addEventListener('click',()=>setPolyElementMode(mode));
const btnShading=document.getElementById('btnShading');
const SHADING_ICONS=[ICONS.ICO_SHADING_SOLID,ICONS.ICO_SHADING_WIRE,ICONS.ICO_SHADING_SOLIDWIRE,ICONS.ICO_SHADING_CAGE,ICONS.ICO_SHADING_SOLIDCAGE];
const SHADING_CYCLE=[0,2,1,3,4]; // Solid → Solid+Wire → Wire → Cage → Solid+Cage
let shadingMode=4;
function syncShading(){ btnShading.innerHTML=SHADING_ICONS[shadingMode]; }
btnShading.addEventListener('click',()=>{ shadingMode=SHADING_CYCLE[(SHADING_CYCLE.indexOf(shadingMode)+1)%SHADING_CYCLE.length]; syncShading(); setShadingForContext(shadingMode); });
syncShading();
/* ===================== timeline ===================== */
const animationTracks=new Map();
let pendingAnimation=null,tlPlaying=false,tlPlayRaf=0,tlPlayLast=0,tlPlayAccum=0;
const TL_FPS=30;
const tlPlayBtn=document.getElementById('tlPlay');
function localPSRKey(n,interp=tlInterp){const e=n.lin.elements,sx=Math.hypot(e[0],e[1],e[2]),sy=Math.hypot(e[4],e[5],e[6]),sz=Math.hypot(e[8],e[9],e[10]),det=e[0]*(e[5]*e[10]-e[6]*e[9])-e[4]*(e[1]*e[10]-e[2]*e[9])+e[8]*(e[1]*e[6]-e[2]*e[5]),q=rotQuatOfLin(n.lin,new THREE.Quaternion());return {p:n.pos.toArray(),q:q.toArray(),s:[det<0?-sx:sx,sy,sz],interp};}
function cloneAnimKey(k){return k&&{p:k.p.slice(),q:k.q.slice(),s:k.s.slice(),interp:k.interp};}
function setTrackKey(h,frame,key){let track=animationTracks.get(h);if(!track)animationTracks.set(h,track=new Map());if(key)track.set(frame,cloneAnimKey(key));else{track.delete(frame);if(!track.size)animationTracks.delete(h);}}
function sampledTrackKey(track,frame){const frames=[...track.keys()].sort((a,b)=>a-b);if(!frames.length)return null;if(frame<=frames[0])return cloneAnimKey(track.get(frames[0]));if(frame>=frames[frames.length-1])return cloneAnimKey(track.get(frames[frames.length-1]));let i=1;while(frames[i]<frame)i++;const a=track.get(frames[i-1]),b=track.get(frames[i]),span=frames[i]-frames[i-1];let t=(frame-frames[i-1])/span;if(a.interp==='soft')t=t*t*(3-2*t);const pa=new THREE.Vector3().fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p),t),sa=new THREE.Vector3().fromArray(a.s).lerp(new THREE.Vector3().fromArray(b.s),t),qa=new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q),t);return {p:pa.toArray(),q:qa.toArray(),s:sa.toArray(),interp:a.interp};}
function applyAnimationFrame(frame){for(const [h,track] of animationTracks){const n=OBJ.get(h),key=n&&sampledTrackKey(track,frame);if(!n||!key)continue;const m=new THREE.Matrix4().compose(new THREE.Vector3().fromArray(key.p),new THREE.Quaternion().fromArray(key.q).normalize(),new THREE.Vector3().fromArray(key.s));setNodeFromLocal(n,m);const t=threeOf.get(h);if(t)t.matrix.copy(localTmp(n));}syncMeshParents();lastBracketSig=null;placeGizmoForSelection();updateBrackets(!tlPlaying);updateHUD();scheduleGeneratorEvaluation(0);scheduleRender();}
function syncTimelineInputs(){if(typeof tlCurInp!=='undefined')tlCurInp.value=String(tlCur);if(typeof tlTotalInp!=='undefined')tlTotalInp.value=String(tlTotal);}
function setTimelineFrame(frame){tlCur=clamp_ui(Math.round(frame),0,tlTotal);syncTimelineInputs();applyAnimationFrame(tlCur);}
function selectedTrackHashes(){const selected=[...selNodes].filter(h=>OBJ.has(h));return selected.length?selected:[...animationTracks.keys()].filter(h=>OBJ.has(h));}
function setTimelineKey(){const hashes=[...selNodes].filter(h=>OBJ.has(h));if(!hashes.length)return;const before=hashes.map(h=>[h,cloneAnimKey(animationTracks.get(h)?.get(tlCur))]),after=hashes.map(h=>[h,localPSRKey(OBJ.get(h))]);const apply=list=>{for(const [h,key] of list)setTrackKey(h,tlCur,key);applyAnimationFrame(tlCur);};apply(after);pushCmd({redo(){apply(after);},undo(){apply(before);}});}
function deleteTimelineKey(){const hashes=[...selNodes].filter(h=>animationTracks.get(h)?.has(tlCur));if(!hashes.length)return;const before=hashes.map(h=>[h,cloneAnimKey(animationTracks.get(h).get(tlCur))]),after=hashes.map(h=>[h,null]),apply=list=>{for(const [h,key] of list)setTrackKey(h,tlCur,key);applyAnimationFrame(tlCur);};apply(after);pushCmd({redo(){apply(after);},undo(){apply(before);}});}
function jumpTimelineKey(dir){const frames=new Set();for(const h of selectedTrackHashes())for(const f of animationTracks.get(h)?.keys()||[])frames.add(f);const sorted=[...frames].sort((a,b)=>a-b),next=dir<0?[...sorted].reverse().find(f=>f<tlCur):sorted.find(f=>f>tlCur);if(next!==undefined)setTimelineFrame(next);}
function stopTimeline(){tlPlaying=false;if(tlPlayRaf)cancelAnimationFrame(tlPlayRaf);tlPlayRaf=0;tlPlayBtn.innerHTML=ICONS.ICO_TL_PLAY;}
function timelineTick(now){if(!tlPlaying)return;if(!tlPlayLast)tlPlayLast=now;tlPlayAccum+=Math.min(.25,(now-tlPlayLast)/1000)*TL_FPS;tlPlayLast=now;const step=Math.floor(tlPlayAccum);if(step){tlPlayAccum-=step;setTimelineFrame((tlCur+step)%(tlTotal+1));}tlPlayRaf=requestAnimationFrame(timelineTick);}
function setTimelinePlaying(on){if(!on){stopTimeline();return;}if(tlPlaying)return;tlPlaying=true;tlPlayLast=0;tlPlayAccum=0;tlPlayBtn.innerHTML=ICONS.ICO_TL_PAUSE;tlPlayRaf=requestAnimationFrame(timelineTick);}
tlPlayBtn.addEventListener('click',()=>setTimelinePlaying(!tlPlaying));
document.getElementById('tlPrevKey').addEventListener('click',()=>jumpTimelineKey(-1));
document.getElementById('tlNextKey').addEventListener('click',()=>jumpTimelineKey(1));
document.getElementById('tlSetKey').addEventListener('click',setTimelineKey);
document.getElementById('tlDelKey').addEventListener('click',deleteTimelineKey);
const tlInterpBtn=document.getElementById('tlInterp'); let tlInterp='soft';
function syncInterp(){ tlInterpBtn.innerHTML=tlInterp==='soft'?ICONS.ICO_TL_SOFT:ICONS.ICO_TL_LINEAR; tlInterpBtn.title='Interpolation: '+tlInterp; }
tlInterpBtn.addEventListener('click',()=>{ tlInterp=tlInterp==='soft'?'linear':'soft';for(const h of selNodes){const key=animationTracks.get(h)?.get(tlCur);if(key)key.interp=tlInterp;}syncInterp(); });
syncInterp();
/* ===================== табы ===================== */
const panelEl=document.getElementById('panel');
const panelsEl=document.getElementById('panels');
const filebarEl=document.getElementById('filebar');
const modelbarEl=document.getElementById('modelbar');
const obWrapEl=document.getElementById('obWrap');
const tabBtns=[...document.querySelectorAll('#tabstrip .tabgrp .tabbtn')];
const tabDelUnused=document.getElementById('tabDelUnused');
const tabAddNew=document.getElementById('tabAddNew');
const ADD_NEW=new Set(['tabMaterials','tabObjects','tabMaterialMgr']);
const PANEL_MAP={tabAttributes:'attributesPanel',tabObjects:'objectsPanel',tabMaterialMgr:'matEditorPanel',tabMaterials:'materialsPanel',tabTextures:'texturesPanel'};
let texLoaded=false;
function activeTabId(){ const b=tabBtns.find(x=>x.classList.contains('on')); return b?b.id:null; }
function refreshTabActs(id){ tabDelUnused.style.display=(id==='tabMaterials')?'':'none'; tabAddNew.style.display=ADD_NEW.has(id)?'':'none'; }
function activateTab(id){ tabBtns.forEach(x=>x.classList.toggle('on',x.id===id)); refreshTabActs(id);
document.querySelectorAll('.panel-content').forEach(p=>p.style.display='none');
const pid=PANEL_MAP[id]; if(pid)document.getElementById(pid).style.display='block';
if(id==='tabTextures'&&!texLoaded){ texLoaded=true; buildTextures(); }
if(id==='tabAttributes') refreshAttributesPanel(); }
tabBtns.forEach(b=>b.addEventListener('click',()=>activateTab(b.id)));
/* ===================== выделение ===================== */
const selNodes=new Set(), selTags=new Set();
let anchorNode=null, anchorTag=null, treeActive=false;
let liveMat=null;
let boundNode=null;
let clipNodes=null;
function tagId(h,i){ return h+':'+i; }
function parseTagId(id){ const k=id.lastIndexOf(':'); return {h:id.slice(0,k),i:+id.slice(k+1)}; }
function recomputeLiveFromSelection(){
let nh=null;
if(selMats.size===1) nh=[...selMats][0];
else if(selTags.size===1){ const {h,i}=parseTagId([...selTags][0]); const n=getObj(h); const t=n&&n.tags[i]; nh=(t&&t.ref)||null; }
else if(selNodes.size===1){ const n=getObj([...selNodes][0]); const tags=n?n.tags.filter(t=>t.type===1&&t.ref&&getMat(t.ref)):[]; if(tags.length===1)nh=tags[0].ref; }
setLiveMat(nh); }
function setLiveMat(hash){ if(hash===liveMat) return; liveMat=hash; const m=activeMat();
document.body.style.setProperty('--h',m.h); document.body.style.setProperty('--s',m.s+'%'); document.body.style.setProperty('--l',m.l+'%');
const hasTex=!!m.map;
document.getElementById('btnDelTex').style.display=hasTex?'flex':'none';
document.getElementById('bumpLab').style.display=hasTex?'':'none';
document.getElementById('inpBump').style.display=hasTex?'':'none';
syncInputs(); updateMatPreview(); }
function refreshSelClasses(){const selectionStarted=performance.now();if(vertexEditActive)syncVertexEditTargets(anchorNode?.hash||null);else prunePolySelection();for(const el of rowPool){ if(el.style.display==='none')continue;
el.classList.toggle('sel', selNodes.has(el.dataset.h));
el.classList.toggle('ob-dim', !effectiveVisible(el.dataset.h)&&!selNodes.has(el.dataset.h));
const h=el.dataset.h; el.querySelectorAll('.ob-tag').forEach(tg=>tg.classList.toggle('sel', selTags.has(tagId(h,+tg.dataset.ti)))); }
if(uvMode) syncUvEditing();
recomputeLiveFromSelection(); updateBrackets(); setHUDNode(selNodes.size===1?[...selNodes][0]:null); placeGizmoForSelection(); refreshAttributesPanel(); syncEnv();
setGizmoVisible(!!uvEdit||(splineFocusActive()?(splineSelection.vertices.size+splineSelection.handles.size+splineSelection.segments.size>0):(polyMode?polySelection.items.size>0:selNodes.size>0)));
updateHUD();phasePerformance.selectionCalls++;phasePerformance.selectionMilliseconds+=performance.now()-selectionStarted; }
/* ===================== параметры объектов ===================== */
const objParams=new Map();
const DEFAULTS={
instance :()=>({source:''}),
spline   :()=>({angle:5}),
spline_patch:()=>({}),
 extrude  :()=>({offset:10,startFillet:false,startType:'flat',startSize:1,startAngle:10,endFillet:false,endType:'flat',endSize:1,endAngle:10}),
 lathe    :()=>({angle:360,approximation:5}),
 sweep    :()=>({}),
 boolean  :()=>({op:'subtract'}),
symmetry :()=>({x:true,y:false,z:false}),
cloner   :()=>({mode:'radial',count:5,angle:360,mx:3,my:3,mz:3,dx:100,dy:100,dz:100}),
environment:()=>({map:false,hemi:100,infinite:0,camera:100,vAng:45,hAng:45}),
cube     :()=>({size:100,approximation:5}),
 cylinder :()=>({diameter:100,height:100,approximation:5}),
 tube     :()=>({d1:100,d2:50,height:100,approximation:5}),
 sphere   :()=>({diameter:100,approximation:5}),
square   :()=>({w:100,h:100}),
 circle   :()=>({diameter:100,approximation:5}),
polyhedron:()=>({faces:6,diameter:100}),
 text     :()=>({text:'Text',_legacySize:0,approximation:5})
};
const SCHEMA={
instance :{f:[],                   i:[],             b:[],                    e:[], s:'source'},
spline   :{f:['angle'],            i:[],             b:[],                    e:[], s:null},
spline_patch:{f:[],                i:[],             b:[],                    e:[], s:null},
 extrude  :{f:['offset','startSize','startAngle','endSize','endAngle'], i:[], b:['startFillet','endFillet'],
 e:[['startType',['flat','round']],['endType',['flat','round']]], s:null},
 lathe    :{f:['angle','approximation'],i:[],          b:[],                    e:[], s:null},
 sweep    :{f:[],                   i:[],             b:[],                    e:[], s:null},
 boolean  :{f:[],                   i:[],             b:[],                    e:[['op',['subtract','intersect','union']]], s:null},
symmetry :{f:[],                   i:[],             b:['x','y','z'],         e:[], s:null},
cloner   :{f:['angle','dx','dy','dz'], i:['count','mx','my','mz'], b:[],      e:[['mode',['radial','matrix']]], s:null},
environment:{f:['hemi','infinite','camera','vAng','hAng'], i:[],   b:['map'], e:[], s:null},
cube     :{f:['size','approximation'], i:[],          b:[],                    e:[], s:null},
 cylinder :{f:['diameter','height','approximation'],i:[], b:[],                 e:[], s:null},
 tube     :{f:['d1','d2','height','approximation'], i:[], b:[],                 e:[], s:null},
 sphere   :{f:['diameter','approximation'],i:[],      b:[],                    e:[], s:null},
square   :{f:['w','h'],            i:[],             b:[],                    e:[], s:null},
 circle   :{f:['diameter','approximation'],i:[],       b:[],                    e:[], s:null},
polyhedron:{f:['diameter'],        i:['faces'],      b:[],                    e:[], s:null},
 text     :{f:['_legacySize','approximation'],i:[],    b:[],                    e:[], s:'text'}
};
const attrContent=document.getElementById('attrContent');
function cloneP(p){ return Object.assign({},p); }
function diffP2(a,b){ for(const k in a) if(a[k]!==b[k]) return true; for(const k in b) if(!(k in a)) return true; return false; }
function paramCommit(h,before,after){ if(!diffP2(before,after)) return;
pushCmd({ redo(){ objParams.set(h,Object.assign({},after)); syncParametricObject(h); refreshAttributesPanel(); scheduleGeneratorEvaluation(); },
undo(){ objParams.set(h,Object.assign({},before)); syncParametricObject(h); refreshAttributesPanel(); scheduleGeneratorEvaluation(); } }); }
function attrRow(lab,indent){ const r=document.createElement('div'); r.className='attr-row';
const l=document.createElement('span'); l.className='attr-lab'; l.textContent=lab; if(indent) l.style.paddingLeft='12px'; r.appendChild(l);
const c=document.createElement('span'); c.className='attr-ctrl'; r.appendChild(c);
attrContent.appendChild(r); return c; }
function attrBtns(ctrl,items,get,set,h,onChange){
items.forEach(it=>{ const b=document.createElement('button'); b.className='attr-btn'+(get()===it?' on':''); b.textContent=it;
b.addEventListener('click',()=>{ const before=cloneP(objParams.get(h)); set(it);
ctrl.querySelectorAll('.attr-btn').forEach(x=>x.classList.toggle('on',x.textContent===it)); if(onChange) onChange();
paramCommit(h,before,cloneP(objParams.get(h))); });
ctrl.appendChild(b); }); }
function attrToggles(ctrl,items,isOn,toggle,h,onChange){
items.forEach(it=>{ const b=document.createElement('button'); b.className='attr-btn'+(isOn(it)?' on':''); b.textContent=it;
b.addEventListener('click',()=>{ const before=cloneP(objParams.get(h)); toggle(it); b.classList.toggle('on');
if(onChange)onChange();
paramCommit(h,before,cloneP(objParams.get(h))); });
ctrl.appendChild(b); }); }
const O_SZ={sens:8,min:0,max:1e9};
const O_OFF={sens:8,min:-1e9,max:1e9};
const O_ANG={sens:4,min:0,max:360,prec:1};
const O_SPLINE_ANG={sens:4,min:1,max:180,prec:0};
const O_ANGS={sens:4,min:-360,max:360,prec:1};
const O_INTENSITY={sens:8,min:0,max:1e6};
const O_VANG={sens:4,min:-90,max:90,prec:1};
const O_HANG={sens:4,min:-180,max:180,prec:1};
const O_INT0={int:true,sens:16,min:0,max:64};
const O_INTBIG={int:true,sens:16,min:1,max:100000};
const O_FACES={int:true,sens:16,min:3,max:64};
const O_SUBD32={int:true,stepFixed:1,sens:8,min:3,max:256};
function san(s){ let out='',dot=false,mn=false; for(const c of s){ if(c==='-'&&!mn&&out.length===0){out+='-';mn=true;} else if(c==='.'&&!dot){out+='.';dot=true;} else if(c>='0'&&c<='9')out+=c; } return out; }
let _scrubActive=null;
let _scrubSession=null;
function _endSessionOutside(target){ if(_scrubSession && _scrubSession.inp!==target && !_scrubSession.inp.contains(target)) _scrubSession.end(true); }
document.addEventListener('pointerdown',e=>_endSessionOutside(e.target),true);
document.addEventListener('wheel',e=>_endSessionOutside(e.target),true);
document.addEventListener('keydown',e=>_endSessionOutside(e.target),true);
function makeScrubInput(inp,o){
const isInt=!!o.int, hasPrec=o.prec!=null, P10=hasPrec?Math.pow(10,o.prec):0;
const clampv=v=>Math.max(o.min,Math.min(o.max,v));
const roundPrec=v=>Math.round(v*P10)/P10;
const fullFmt=v=>{ if(isInt) return String(Math.round(v));
if(hasPrec){ const r=roundPrec(v); return String(parseFloat(r.toFixed(o.prec))); }
const r=parseFloat((+v).toPrecision(12)); return Object.is(r,-0)?'0':String(r); };
const scrubFmt=(v,step)=>{ if(isInt) return String(Math.round(v));
const dec=step<1?Math.min(6,Math.ceil(-Math.log10(step)+1e-9)):0; return (+v).toFixed(dec); };
function niceStep(v){ const a=Math.abs(v); if(a<1e-9) return 1; return Math.pow(10,Math.floor(Math.log10(a))-1); }
function stepFor(v){ if(o.stepFixed!=null) return o.stepFixed;
if(isInt) return Math.max(1,Math.round(niceStep(v)));
let s=niceStep(v); if(hasPrec){ const mn=1/P10; if(s<mn) s=mn; } return s; }
function getBefore(){ if(o.h) return cloneP(objParams.get(o.h)); if(o.snap) return o.snap(); return null; }
function doCommit(before){ if(before==null) return; if(o.h) paramCommit(o.h,before,cloneP(objParams.get(o.h))); else if(o.commit) o.commit(before); }
function doRevert(before){ if(before==null) return; if(o.h){ Object.assign(objParams.get(o.h),before); syncParametricObject(o.h); refreshAttributesPanel(); } else if(o.revert) o.revert(before); }
let before=null, scrubbing=false, moved=false, pid=null, accum=0, startVal=0;
const PX=6;
function localEnd(flag){ if(flag) doCommit(before); else doRevert(before);
before=null; _scrubActive=null; if(_scrubSession&&_scrubSession.inp===inp) _scrubSession=null; }
function beginSession(){ if(_scrubSession && _scrubSession.inp!==inp) _scrubSession.end(true);
if(before===null) before=getBefore(); _scrubActive=inp; _scrubSession={inp, end:localEnd}; }
inp.value=fullFmt(o.get());
inp.addEventListener('focus',()=>{ if(!scrubbing) beginSession(); });
inp.addEventListener('pointerdown',e=>{ beginSession(); moved=false; scrubbing=false; accum=0; startVal=o.get(); pid=e.pointerId; });
inp.addEventListener('pointermove',e=>{ if(pid!==e.pointerId) return;
if(!moved){ if(Math.abs(e.movementX)+Math.abs(e.movementY)<2) return;
moved=true; scrubbing=true; e.preventDefault();
try{inp.blur();}catch{} try{inp.setPointerCapture(e.pointerId);}catch{} document.body.style.cursor='nesw-resize'; }
accum+=(e.movementX-e.movementY);
const step=stepFor(startVal); const q=Math.trunc(accum/PX);
if(q!==0){ let v=clampv(startVal+q*step);
if(isInt) v=Math.round(v); else if(hasPrec) v=roundPrec(v); else v=Math.round(v/step)*step;
o.set(v); inp.value=scrubFmt(v,step); } });
const endScrub=()=>{ if(scrubbing){ localEnd(true); document.body.style.cursor=''; } scrubbing=false; moved=false; pid=null; };
inp.addEventListener('pointerup',endScrub);
inp.addEventListener('pointercancel',endScrub);
addEventListener('pointerup',endScrub);
addEventListener('pointercancel',endScrub);
inp.addEventListener('dblclick',e=>{ e.preventDefault(); inp.focus(); inp.select(); });
inp.addEventListener('input',()=>{ beginSession(); const cs=inp.selectionStart; const s=san(inp.value);
if(s!==inp.value){ inp.value=s; const p2=Math.min(cs==null?s.length:cs,s.length); inp.setSelectionRange(p2,p2); }
if(!scrubbing&&!o.deferText){ const v=parseFloat(s); if(!isNaN(v)) o.set(v); } });
inp.addEventListener('paste',e=>{ e.preventDefault(); beginSession(); const clip=(e.clipboardData||window.clipboardData).getData('text'); const s=san(clip);
const a=inp.selectionStart||0,b=inp.selectionEnd||0; const nv=san(inp.value.slice(0,a)+s+inp.value.slice(b)); inp.value=nv;
const p2=Math.min(a+s.length,nv.length); inp.setSelectionRange(p2,p2);
if(!scrubbing&&!o.deferText){ const v=parseFloat(nv); if(!isNaN(v)) o.set(v); } });
inp.addEventListener('keydown',e=>{ e.stopPropagation();
if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }
else if(e.key==='Escape'){ e.preventDefault(); localEnd(false); inp.value=fullFmt(o.get()); scrubbing=false; document.body.style.cursor=''; inp.blur(); } });
inp.addEventListener('blur',()=>{ if(scrubbing) return; const raw=inp.value.trim(); let v=parseFloat(raw);
if(raw===''||isNaN(v)) v=o.get(); v=clampv(v);
if(isInt) v=Math.round(v); else if(hasPrec) v=roundPrec(v);
o.set(v); inp.value=fullFmt(v); localEnd(true); });
inp.addEventListener('wheel',e=>{ if(e.ctrlKey) return;
e.preventDefault(); beginSession();
const dir=e.deltaY<0?1:-1; const step=stepFor(o.get()); let v=clampv(o.get()+dir*step);
if(isInt) v=Math.round(v); else if(hasPrec) v=roundPrec(v); else v=Math.round(v/step)*step;
o.set(v); inp.value=scrubFmt(v,step); }, {passive:false});
}
function attrInput(ctrl,o){ const inp=document.createElement('input'); inp.className='attr-inp'; inp.type='text'; inp.inputMode='decimal';
inp.spellcheck=false; inp.autocomplete='off'; ctrl.appendChild(inp); makeScrubInput(inp,o); return inp; }
function attrInputs3(ctrl,o){ for(let i=0;i<3;i++){ const inp=document.createElement('input'); inp.className='attr-inp3'; inp.type='text';
inp.inputMode='decimal'; inp.spellcheck=false; inp.autocomplete='off'; ctrl.appendChild(inp);
makeScrubInput(inp,{h:o.h,get:o.gets[i],set:o.sets[i],sens:o.sens,min:o.min,max:o.max,prec:o.prec,int:o.int,stepFixed:o.stepFixed}); } }
function attrTextarea(h,get,set){ const ta=document.createElement('textarea'); ta.className='attr-ta'; ta.value=get(); ta.spellcheck=false; ta.autocomplete='off';
let before=null;
ta.addEventListener('focus',()=>{ if(before===null) before=cloneP(objParams.get(h)); });
ta.addEventListener('input',()=>{ set(ta.value); });
ta.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape'){ e.preventDefault(); const p=objParams.get(h); if(before) Object.assign(p,before); syncParametricObject(h); ta.value=get(); before=null; ta.blur(); } });
ta.addEventListener('blur',()=>{ if(before){ paramCommit(h,before,cloneP(objParams.get(h))); before=null; } });
attrContent.appendChild(ta); }
function renderSpline(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:s},o));
const changed=()=>{splineApproximation(h);updateSplineVisual(h);};
R('angle approximation',()=>p.angle,v=>{p.angle=v;changed();},O_SPLINE_ANG); }
function renderSplinePatch(){attrContent.innerHTML='';}
function renderExtrude(h){ const p=objParams.get(h); attrContent.innerHTML='';
const S=s=>v=>{s(v);scheduleGeneratorEvaluation(0);},R=(l,g,s,o,ind)=>attrInput(attrRow(l,ind),Object.assign({h,get:g,set:S(s)},o));
R('offset',()=>p.offset,v=>{p.offset=v;},O_OFF);
const c3=attrRow('start fillet'); attrBtns(c3,['off','on'],()=>p.startFillet?'on':'off',v=>{p.startFillet=(v==='on');scheduleGeneratorEvaluation(0);},h,()=>renderExtrude(h));
if(p.startFillet){
const t=attrRow('type',true); attrBtns(t,['flat','round'],()=>p.startType,v=>{p.startType=v;scheduleGeneratorEvaluation(0);},h,()=>renderExtrude(h));
R('size',()=>p.startSize,v=>{p.startSize=v;},O_SZ,true);
if(p.startType==='round') R('angle',()=>p.startAngle,v=>{p.startAngle=v;},O_SPLINE_ANG,true); }
const c4=attrRow('end fillet'); attrBtns(c4,['off','on'],()=>p.endFillet?'on':'off',v=>{p.endFillet=(v==='on');scheduleGeneratorEvaluation(0);},h,()=>renderExtrude(h));
if(p.endFillet){
const t=attrRow('type',true); attrBtns(t,['flat','round'],()=>p.endType,v=>{p.endType=v;scheduleGeneratorEvaluation(0);},h,()=>renderExtrude(h));
R('size',()=>p.endSize,v=>{p.endSize=v;},O_SZ,true);
if(p.endType==='round') R('angle',()=>p.endAngle,v=>{p.endAngle=v;},O_SPLINE_ANG,true); } }
function renderLathe(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);scheduleGeneratorEvaluation(0);}},o));
R('angle',()=>p.angle,v=>{p.angle=v;},O_ANG);
R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
function renderSweep(){attrContent.innerHTML='';}
function renderBoolean(h){ const p=objParams.get(h),n=OBJ.get(h),operands=booleanChildren(n,p); attrContent.innerHTML='';
for(const [label,child] of [['A',operands[0]],['B',operands[1]]]){const row=attrRow(label),value=document.createElement('span');value.textContent=OBJ.get(child)?.name||'missing';row.appendChild(value);}
const c1=attrRow('op'); attrBtns(c1,['subtract','intersect','union'],()=>p.op,v=>{p.op=v;},h,()=>scheduleGeneratorEvaluation(0)); }
function renderInstance(h){const p=objParams.get(h),source=OBJ.get(p.source);attrContent.innerHTML='';const c=attrRow('object');const label=document.createElement('span');label.textContent=source?source.name:'none';c.appendChild(label);}
function renderSymmetry(h){ const p=objParams.get(h); attrContent.innerHTML='';
const c1=attrRow('axis'); attrToggles(c1,['X','Y','Z'],it=>p[it.toLowerCase()],it=>{ const k=it.toLowerCase(); p[k]=!p[k]; },h,()=>scheduleGeneratorEvaluation()); }
function renderCloner(h){ const p=objParams.get(h); attrContent.innerHTML='';
const S=s=>v=>{s(v);scheduleGeneratorEvaluation();},R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:S(s)},o));
const c1=attrRow('type'); attrBtns(c1,['radial','matrix'],()=>p.mode,v=>{p.mode=v;},h,()=>{renderCloner(h);scheduleGeneratorEvaluation();});
if(p.mode==='radial'){
R('count',()=>p.count,v=>{p.count=v;},O_INTBIG);
R('angle',()=>p.angle,v=>{p.angle=v;},O_ANGS); }
else {
attrContent.classList.add('cloner-matrix');
const c2=attrRow('count'); attrInputs3(c2,{h,gets:[()=>p.mx,()=>p.my,()=>p.mz],sets:[S(v=>{p.mx=v;}),S(v=>{p.my=v;}),S(v=>{p.mz=v;})],...O_INTBIG});
const c3=attrRow('spacing'); attrInputs3(c3,{h,gets:[()=>p.dx,()=>p.dy,()=>p.dz],sets:[S(v=>{p.dx=v;}),S(v=>{p.dy=v;}),S(v=>{p.dz=v;})],sens:8,min:0,max:1e9}); } }
function renderEnvironment(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o,ind)=>attrInput(attrRow(l,ind),Object.assign({h,get:g,set:s},o));
const c0=attrRow('environment map');
attrBtns(c0,['off','on'],()=>p.map?'on':'off',v=>{p.map=(v==='on');},h,()=>syncEnv());
R('hemisphere light',()=>p.hemi,v=>{p.hemi=v; syncEnv();},O_INTENSITY);
R('infinite light',()=>p.infinite,v=>{p.infinite=v; syncEnv();},O_INTENSITY);
if(p.infinite>0){
R('altitude',()=>p.vAng,v=>{p.vAng=v; syncEnv();},O_VANG,true);
R('azimuth',()=>p.hAng,v=>{p.hAng=v; syncEnv();},O_HANG,true); }
R('camera light',()=>p.camera,v=>{p.camera=v; syncEnv();},O_INTENSITY); }
function renderCube(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));R('size',()=>p.size,v=>{p.size=v;},O_SZ);R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
function renderCylinder(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
R('diameter',()=>p.diameter,v=>{p.diameter=v;},O_SZ);
R('height',()=>p.height,v=>{p.height=v;},O_SZ);
R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
function renderTube(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
R('outer diameter',()=>p.d1,v=>{p.d1=v;},O_SZ);
R('inner diameter',()=>p.d2,v=>{p.d2=v;},O_SZ);
R('height',()=>p.height,v=>{p.height=v;},O_SZ);
R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
function renderSphere(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
R('diameter',()=>p.diameter,v=>{p.diameter=v;},O_SZ);
R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
function renderSquare(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
R('side 1',()=>p.w,v=>{p.w=v;},O_SZ);
R('side 2',()=>p.h,v=>{p.h=v;},O_SZ); }
function renderCircle(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
R('diameter',()=>p.diameter,v=>{p.diameter=v;},O_SZ);
R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
function renderPolyhedron(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
R('faces',()=>p.faces,v=>{p.faces=v;},O_FACES);
R('diameter',()=>p.diameter,v=>{p.diameter=v;},O_SZ); }
function renderText(h){ const p=objParams.get(h); attrContent.innerHTML='';
const R=(l,g,s,o)=>attrInput(attrRow(l),Object.assign({h,get:g,set:v=>{s(v);syncParametricObject(h);}},o));
attrTextarea(h,()=>p.text,v=>{p.text=v;syncParametricObject(h);});
R('angle approximation',()=>p.approximation,v=>{p.approximation=v;},O_SPLINE_ANG); }
const RENDERERS={instance:renderInstance,spline:renderSpline,spline_patch:renderSplinePatch,extrude:renderExtrude,lathe:renderLathe,sweep:renderSweep,
boolean:renderBoolean,symmetry:renderSymmetry,cloner:renderCloner,environment:renderEnvironment,
cube:renderCube,cylinder:renderCylinder,tube:renderTube,sphere:renderSphere,square:renderSquare,
circle:renderCircle,polyhedron:renderPolyhedron,text:renderText};
let lastAttrKey=null;
function renderSoftAttributes(){attrContent.innerHTML='';attrInput(attrRow('radius'),{get:()=>vertexTools.soft.radius,set:v=>{vertexTools.soft.radius=Math.max(0,v);recalculateSoftSelection();},snap:()=>vertexTools.soft.radius,commit:before=>{const after=vertexTools.soft.radius;if(Math.abs(before-after)<1e-9)return;pushCmd({redo(){vertexTools.soft.radius=after;recalculateSoftSelection();},undo(){vertexTools.soft.radius=before;recalculateSoftSelection();}});},revert:before=>{vertexTools.soft.radius=before;recalculateSoftSelection();},sens:8,min:0,max:1e9});}
function renderLineCutAttributes(){attrContent.innerHTML='';const ctrl=attrRow('visible only');for(const [label,value] of [['on',true],['off',false]]){const b=document.createElement('button');b.className='attr-btn'+(vertexTools.visibleOnly===value?' on':'');b.textContent=label;b.addEventListener('click',()=>{vertexTools.visibleOnly=value;ctrl.querySelectorAll('.attr-btn').forEach(x=>x.classList.toggle('on',x===b));});ctrl.appendChild(b);}}
function renderSplineOutlineAttributes(){const tool=splineOutlineTool;attrContent.innerHTML='';if(!tool)return;attrInput(attrRow('distance'),{get:()=>tool.distance,set:v=>{tool.moved=Math.abs(v)>=1e-9;applySplineOutlinePreview(tool,v);},snap:()=>tool.distance,commit:()=>{if(splineOutlineTool?.moved)finishSplineOutlineTool();},revert:before=>{tool.moved=Math.abs(before)>=1e-9;applySplineOutlinePreview(tool,before);},sens:8,min:-1e9,max:1e9});}
function refreshBevelOwner(h){invalidateEvaluatedSpline(h);updateSplineVisual(h);scheduleGeneratorEvaluation(0);lastAttrKey=null;renderRows();}
function replaceBevelTag(h,i,value){const n=OBJ.get(h);if(!n||!n.tags[i])return;n.tags[i]=cloneTag(value);refreshBevelOwner(h);refreshAttributesPanel();}
function commitBevelTag(h,i,before){const n=OBJ.get(h),after=n?.tags[i]&&cloneTag(n.tags[i]);if(!after||JSON.stringify(before)===JSON.stringify(after))return;pushCmd({redo(){replaceBevelTag(h,i,after);},undo(){replaceBevelTag(h,i,before);}});}
function cmdBakeBevelThrough(h,through){const n=OBJ.get(h),base=splineData.get(h);if(!n||!base)return null;const beforeData=SPLINE.cloneSplineData(base),beforeTags=n.tags.map(cloneTag);let afterData=SPLINE.cloneSplineData(base);for(let i=0;i<=through&&i<n.tags.length;i++)if(n.tags[i].type===2)afterData=SPLINE.applySplineBevelTag(afterData,n.tags[i]);const afterTags=n.tags.filter((t,i)=>t.type!==2||i>through).map(cloneTag),apply=(data,tags)=>{splineData.set(h,SPLINE.cloneSplineData(data));n.tags=tags.map(cloneTag);invalidateEvaluatedSpline(h);updateSplineVisual(h);treeChanged();lastAttrKey=null;refreshAttributesPanel();placeGizmoForSelection();};return {redo(){apply(afterData,afterTags);},undo(){apply(beforeData,beforeTags);}};}
function bakeSelectedBevelTag(h,i){const cmd=cmdBakeBevelThrough(h,i);if(cmd)runCmd(cmd);selTags.clear();selNodes.add(h);refreshSelClasses();}
function renderBevelTag(h,i){const tag=OBJ.get(h)?.tags[i];if(!tag||tag.type!==2){attrContent.innerHTML='';return;}attrContent.innerHTML='';const profiles=tag.domain==='vertex'?['Flat','Round']:['Flat','Round','Quarter'],ctrl=attrRow('profile');for(const label of profiles){const value=label.toLowerCase(),b=document.createElement('button');b.className='attr-btn'+(tag.profile===value?' on':'');b.textContent=label;b.addEventListener('click',()=>{const before=cloneTag(tag);tag.profile=value;refreshBevelOwner(h);commitBevelTag(h,i,before);renderBevelTag(h,i);});ctrl.appendChild(b);}const R=(label,key)=>attrInput(attrRow(label),{get:()=>+tag[key]||0,set:v=>{tag[key]=Math.max(0,v);refreshBevelOwner(h);},snap:()=>cloneTag(tag),commit:before=>commitBevelTag(h,i,before),revert:before=>replaceBevelTag(h,i,before),...O_SZ});if(tag.profile==='quarter'){R('shelf A','shelfA');R('shelf B','shelfB');}else R('radius','radius');const row=attrRow('');const bake=document.createElement('button');bake.className='attr-btn';bake.textContent='Bake';bake.addEventListener('click',()=>bakeSelectedBevelTag(h,i));row.appendChild(bake);}
function refreshAttributesPanel(){
attrContent.classList.remove('cloner-matrix');
if(activeTabId()!=='tabAttributes') return;
if(splineOutlineTool){if(lastAttrKey!=='spline-outline-tool'){lastAttrKey='spline-outline-tool';renderSplineOutlineAttributes();}return;}
if(polyMode&&vertexTools.mode==='lineCut'){if(lastAttrKey!=='poly-line-cut'){lastAttrKey='poly-line-cut';renderLineCutAttributes();}return;}
if(polyMode&&polyElementMode==='vertex'&&vertexTools.soft.active){if(lastAttrKey!=='vertex-soft'){lastAttrKey='vertex-soft';renderSoftAttributes();}return;}
if(selTags.size===1){const {h,i}=parseTagId([...selTags][0]),tag=OBJ.get(h)?.tags[i];if(tag?.type===2){const key='bevel:'+h+':'+i;if(lastAttrKey!==key){lastAttrKey=key;renderBevelTag(h,i);}return;}}
let h=null, type=null;
if(selNodes.size===1){ h=[...selNodes][0]; const op=objParams.get(h); if(op&&RENDERERS[op.__type]) type=op.__type; }
const key=type?h:'empty';
if(key===lastAttrKey) return;
lastAttrKey=key;
if(key==='empty'){ attrContent.innerHTML=''; return; }
RENDERERS[type](h); }
/* ===================== environment / свет ===================== */
function envCandidates(){ const out=[]; eachNode(n=>{ if(n.type===TYPE_ENV && n.enabled && effectiveVisible(n.hash)) out.push(n.hash); }); return out; }
function activeEnvHash(){ const cands=envCandidates(); if(!cands.length) return null;
if(selNodes.size===1){ const h=[...selNodes][0]; if(cands.includes(h)) return h; }
return cands[0]; }
function syncEnv(){ const h=activeEnvHash(); setEnvLighting(h?objParams.get(h):null); }
/* ===================== wrap-правила ===================== */
function isSpline(h){ return splineData.has(h); }
function hasCh(h){ const n=getObj(h); return !!n && n.children.length>0; }
const WRAP_RULES={
extrude     :s=>s.length===1 && isSpline(s[0]) && !hasCh(s[0]),
lathe       :s=>s.length===1 && isSpline(s[0]) && !hasCh(s[0]),
 sweep       :s=>s.length===2 && s.every(h=>isSpline(h)&&!hasCh(h)),
spline_patch:s=>s.length===1 && isSpline(s[0]) && !hasCh(s[0]),
boolean     :s=>s.length===2,
symmetry    :s=>s.length>=1,
cloner      :s=>s.length>=1
};
function nodeError(h){ const op=objParams.get(h),n=getObj(h); if(!n) return false;
if(!op) return false;
if(op.__type==='instance')return !op.source||!OBJ.has(op.source)||!!replicaStates.get(h)?.error;
if((op.__type==='boolean'||op.__type==='symmetry'||op.__type==='cloner'||op.__type==='spline_patch'||op.__type==='extrude'||op.__type==='lathe'||op.__type==='sweep'||PARAMETRIC_MESH_TYPES.has(op.__type))&&replicaStates.get(h)?.error)return true;
const rule=WRAP_RULES[op.__type]; if(!rule) return false; return !rule(n.children); }
function orientCreatedSplinePrimitive(h){const p=objParams.get(h),n=OBJ.get(h);if(!n||!PARAMETRIC_SPLINE_TYPES.has(p?.__type))return;const vi=vpState.mode==='single'?vpState.singleView:lastOrthoView,view=vpState.views?.[vi];if(!view||view.type!=='ortho')return;view.cam.updateMatrixWorld(true);const q=view.cam.quaternion,u=new THREE.Vector3(1,0,0).applyQuaternion(q).normalize(),v=new THREE.Vector3(0,1,0).applyQuaternion(q).normalize(),normal=u.clone().cross(v).normalize();n.lin.makeBasis(u,v,normal);const t=threeOf.get(h);if(t){t.matrix.copy(localTmp(n));t.updateMatrixWorld(true);}}
function addObject(name,type,enableSlot,wrapHashes){ wrapHashes=wrapHashes||[];
runCmd(cmdAddObject(name,type,wrapHashes,{wrapSel:wrapHashes.length>0,enableSlot:!!enableSlot}));
const h=getRootOrder()[0]; if(!h) return;
const df=DEFAULTS[name]; if(df){ const p=df(); p.__type=name; objParams.set(h,p); syncParametricObject(h); orientCreatedSplinePrimitive(h); }
selNodes.clear(); selTags.clear(); selNodes.add(h); anchorNode=getObj(h);
refreshSelClasses();scheduleGeneratorEvaluation();
if(df) activateTab('tabAttributes'); return h; }
function addPlain(name,type,enableSlot){ return addObject(name,type,enableSlot,[]); }
function addWrap(name,type,enableSlot){ const sel=name==='sweep'?[...selNodes]:sortByTreeOrder([...selNodes]); const ok=WRAP_RULES[name]&&WRAP_RULES[name](sel);
return addObject(name,type,enableSlot, ok?sel:[]); }
function canBakeToSplinePatch(h){const type=objParams.get(h)?.__type;return (PARAMETRIC_MESH_TYPES.has(type)||['extrude','lathe','sweep'].includes(type))&&!!replicaStates.get(h)?.virtualCage?.data;}
function cmdParametricToSplinePatch(h){
const n=OBJ.get(h),p=objParams.get(h),state=replicaStates.get(h),source=state?.virtualCage?.data;if(!n||!p||!canBakeToSplinePatch(h)||!source)return null;
const beforeType=n.type,beforeParams={...p},records=n.children.map(ch=>{const q=OBJ.get(ch),sp=objParams.get(ch);return q&&{hash:ch,name:q.name,type:q.type,visible:q.visible,enabled:q.enabled,enableSlot:q.enableSlot,tags:q.tags.map(cloneTag),folded:q.folded,pos:q.pos.toArray(),lin:q.lin.elements.slice(),pivot:q.pivot.elements.slice(),params:sp&&{...sp},data:splineData.has(ch)?SPLINE.cloneSplineData(splineData.get(ch)):null};}).filter(Boolean),data=SPLINE.cloneSplineData(source),child=genHash(),childName=(n.name||p.__type)+' cage';
const removeRecord=record=>{disposeSplineVisual(record.hash,true);const st=replicaStates.get(record.hash);if(st)disposeReplicaState(record.hash,st);const t=threeOf.get(record.hash);if(t){t.parent?.remove(t);threeOf.delete(record.hash);}OBJ.delete(record.hash);objParams.delete(record.hash);};
const restoreRecords=()=>{n.children=[];for(const r of records){const q={hash:r.hash,name:r.name,type:r.type,parent:h,children:[],visible:r.visible,enabled:r.enabled,enableSlot:r.enableSlot,tags:r.tags.map(cloneTag),folded:r.folded,pos:new THREE.Vector3().fromArray(r.pos),lin:new THREE.Matrix4().fromArray(r.lin),pivot:new THREE.Matrix4().fromArray(r.pivot)};OBJ.set(r.hash,q);n.children.push(r.hash);if(r.params)objParams.set(r.hash,{...r.params});if(r.data)installSplineObject(r.hash,SPLINE.cloneSplineData(r.data));else syncParametricObject(r.hash);}};
const createChild=()=>{const c={hash:child,name:childName,type:TYPE_MESH,parent:h,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};OBJ.set(child,c);n.children=[child];objParams.set(child,{angle:Math.max(1,Math.round(+data.approximation?.angle||5)),__type:'spline'});installSplineObject(child,SPLINE.cloneSplineData(data));};
const destroyChild=()=>{if(OBJ.has(child))removeRecord({hash:child});n.children=[];};
return {redo(){const st=replicaStates.get(h);if(st)disposeReplicaState(h,st);disposeParametricMesh(h);for(const r of records)if(OBJ.has(r.hash))removeRecord(r);n.type=TYPE_GEN;const hint=beforeParams.__type==='sphere'?'radial':beforeParams.__type==='cylinder'?'cylinder':beforeParams.__type==='tube'?'tube':null;objParams.set(h,{__type:'spline_patch',...(hint?{normalHint:hint}:{})});createChild();syncMeshParents();scheduleGeneratorEvaluation(0);treeChanged();refreshSelClasses();},undo(){const st=replicaStates.get(h);if(st)disposeReplicaState(h,st);destroyChild();n.type=beforeType;objParams.set(h,{...beforeParams});restoreRecords();if(PARAMETRIC_MESH_TYPES.has(beforeParams.__type))syncParametricObject(h);syncMeshParents();scheduleGeneratorEvaluation(0);treeChanged();refreshSelClasses();}};
}
function cmdAddSplineObject(initialData=null,initialName='spline',options={}){const h=genHash(),oldSel=[...selNodes],oldTags=[...selTags],enterDrawing=options.enterDrawing!==false,data=initialData?SPLINE.cloneSplineData(initialData):SPLINE.createSplineData(DEFAULTS.spline()),params={angle:Math.max(1,Math.round(+data.approximation?.angle||5)),__type:'spline'};return {result:h,redo(){const n={hash:h,name:String(initialName||'spline'),type:TYPE_MESH,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};OBJ.set(h,n);rootOrder=rootOrder.filter(x=>x!==h);rootOrder.unshift(h);objParams.set(h,{...params});installSplineObject(h,SPLINE.cloneSplineData(data));selNodes.clear();selTags.clear();selNodes.add(h);anchorNode=n;treeChanged();refreshSelClasses();activateTab('tabAttributes');if(enterDrawing)enterSplineEdit(true);else if(splineMode)leaveSplineEdit();},undo(){if(splineMode)leaveSplineEdit();disposeSplineVisual(h,true);OBJ.delete(h);objParams.delete(h);rootOrder=rootOrder.filter(x=>x!==h);selNodes.clear();selTags.clear();for(const x of oldSel)if(OBJ.has(x))selNodes.add(x);for(const x of oldTags)selTags.add(x);anchorNode=selNodes.size?OBJ.get([...selNodes][0]):null;treeChanged();refreshSelClasses();}};}
const btnInstance=document.getElementById('btnInstance');let pendingInstanceSource='';btnInstance.addEventListener('pointerdown',()=>{pendingInstanceSource=sortByTreeOrder([...selNodes])[0]||(anchorNode?.hash&&OBJ.has(anchorNode.hash)?anchorNode.hash:'');});btnInstance.addEventListener('click',()=>{const source=pendingInstanceSource||sortByTreeOrder([...selNodes])[0]||(anchorNode?.hash&&OBJ.has(anchorNode.hash)?anchorNode.hash:'');pendingInstanceSource='';const sourceWorld=source&&OBJ.has(source)?worldMatrix(OBJ.get(source)):null,h=addPlain('instance',TYPE_GEN,false),p=objParams.get(h),n=OBJ.get(h);if(p)p.source=source;if(n&&sourceWorld)setNodeFromWorld(n,sourceWorld);syncMeshParents();lastAttrKey=null;refreshSelClasses();scheduleGeneratorEvaluation();});
document.getElementById('btnBoolean').addEventListener('click',()=>addWrap('boolean',TYPE_GEN,true));
document.getElementById('btnSymmetry').addEventListener('click',()=>addWrap('symmetry',TYPE_GEN,true));
document.getElementById('btnCloner').addEventListener('click',()=>addWrap('cloner',TYPE_GEN,true));
document.getElementById('btnEnv').addEventListener('click',()=>addPlain('environment',TYPE_ENV,true));
document.getElementById('btnSpline').addEventListener('click',()=>{if(!beginSplineDrawOnActive())runCmd(cmdAddSplineObject());});
document.getElementById('btnExtrude').addEventListener('click',()=>addWrap('extrude',TYPE_GEN,true));
document.getElementById('btnLathe').addEventListener('click',()=>addWrap('lathe',TYPE_GEN,true));
document.getElementById('btnSweep').addEventListener('click',()=>addWrap('sweep',TYPE_GEN,true));
document.getElementById('btnSplinePatch').addEventListener('click',()=>addWrap('spline_patch',TYPE_GEN,true));
/* ===================== layout ===================== */
const STRIP_H=36, MIN_OB=40, MIN_PANELS=60, STRIP_KEY='frame.obwrap.h';
const obScroll=document.getElementById('obScroll'), obInner=document.getElementById('obInner');
function outerHeight(el){const style=getComputedStyle(el);return el.offsetHeight+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);}
function bottomH(){ return outerHeight(modelbarEl)+outerHeight(document.getElementById('modelbar2'))+
outerHeight(document.getElementById('toolbar'))+outerHeight(document.getElementById('timeline'))+
outerHeight(document.getElementById('units'))+outerHeight(document.getElementById('hud')); }
function obBounds(){ const fH=filebarEl.offsetHeight, bH=bottomH();
const max=Math.max(MIN_OB, panelEl.clientHeight-fH-STRIP_H-bH-MIN_PANELS); return {min:MIN_OB,max}; }
let obWrapH;
{ const saved=parseFloat(localStorage.getItem(STRIP_KEY)); const b=obBounds();
obWrapH=Number.isFinite(saved)?clamp_ui(saved,b.min,b.max):Math.round((b.min+b.max)/2); }
function relayoutStrip(){ const b=obBounds(); obWrapH=clamp_ui(obWrapH,b.min,b.max); obWrapEl.style.height=obWrapH+'px';
const fH=filebarEl.offsetHeight, bH=bottomH();
panelsEl.style.height=Math.max(0, panelEl.clientHeight-fH-obWrapH-STRIP_H-bH)+'px';
obLayout(); renderRows(); }
let stripDrag=null;
document.getElementById('tabstrip').addEventListener('pointerdown',e=>{ if(e.target.closest('.tabbtn'))return;
stripDrag={y:e.clientY,h:obWrapH}; try{e.currentTarget.setPointerCapture(e.pointerId);}catch{} });
document.getElementById('tabstrip').addEventListener('pointermove',e=>{ if(!stripDrag)return; obWrapH=stripDrag.h+(e.clientY-stripDrag.y); relayoutStrip(); });
const endStripDrag=()=>{ if(!stripDrag)return; stripDrag=null; try{localStorage.setItem(STRIP_KEY,String(obWrapH));}catch{} relayoutStrip(); };
document.getElementById('tabstrip').addEventListener('pointerup',endStripDrag);
document.getElementById('tabstrip').addEventListener('pointercancel',endStripDrag);
new ResizeObserver(relayoutStrip).observe(panelEl);
window.addEventListener('resize',relayoutStrip);
if(window.visualViewport){ visualViewport.addEventListener('resize',relayoutStrip); visualViewport.addEventListener('scroll',relayoutStrip); }
const btnBrowser=document.getElementById('btnBrowser');
let treeAllFolded=false, treeFoldSnapshot=null;
function setBrowserIcon(){ btnBrowser.innerHTML=treeAllFolded?ICONS.ICO_BROWSER_FOLDED:ICONS.ICO_BROWSER_UNFOLDED; }
setBrowserIcon();
btnBrowser.addEventListener('click',()=>{
if(!treeAllFolded){ treeFoldSnapshot=new Map();
eachNode(n=>{ if(n.children.length) treeFoldSnapshot.set(n.hash,n.folded); });
eachNode(n=>{ if(n.children.length) n.folded=true; });
treeAllFolded=true; }
else { if(treeFoldSnapshot) for(const [h,f] of treeFoldSnapshot){ const n=getObj(h); if(n) n.folded=f; } treeAllFolded=false; }
setBrowserIcon(); treeChanged(); });
/* ===================== виртуальное дерево ===================== */
let flatRows=[], obClientW=0; const rowPool=[];
const measureCtx=document.createElement('canvas').getContext('2d');
measureCtx.font='14px ui-monospace, Menlo, Consolas, monospace';
function textW(s){ return measureCtx.measureText(s).width; }
function rebuildFlat(){ flatRows=[];
const walk=(h,depth)=>{ const n=getObj(h); if(!n)return; flatRows.push({node:n,depth}); if(!n.folded) n.children.forEach(c=>walk(c,depth+1)); };
getRootOrder().forEach(h=>walk(h,0)); }
function eachNode(fn){ getRootOrder().forEach(function w(h){ const n=getObj(h); if(!n)return; fn(n); n.children.forEach(w); }); }
function treeChanged(){ rebuildFlat(); obLayout(); renderRows(); syncEnv(); scheduleGeneratorEvaluation(); }
function obLayout(){ obClientW=obScroll.clientWidth; obInner.style.width=obClientW+'px'; obInner.style.height=(flatRows.length*17)+'px'; }
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
const panMap=new Map(); function panOf(h){ let p=panMap.get(h); if(!p){ p={nx:0,tx:null}; panMap.set(h,p); } return p; }
const CUR_CHILD='url("data:image/svg+xml,'+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M6 3L6 16M3 12L6 20L9 12' stroke='#000' stroke-width='5' fill='none' stroke-linejoin='round' stroke-linecap='round'/><path d='M6 3L6 16M3 12L6 20L9 12' stroke='#fff' stroke-width='2.4' fill='none' stroke-linejoin='round' stroke-linecap='round'/></svg>`)+'") 6 3, auto';
const CUR_LINE ='url("data:image/svg+xml,'+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M3 6L16 6M12 3L20 6L12 9' stroke='#000' stroke-width='5' fill='none' stroke-linejoin='round' stroke-linecap='round'/><path d='M3 6L16 6M12 3L20 6L12 9' stroke='#fff' stroke-width='2.4' fill='none' stroke-linejoin='round' stroke-linecap='round'/></svg>`)+'") 3 6, auto';
function nameColor(n){
if(n.type===TYPE_GROUP) return '#9aa0a6';
if(n.type===TYPE_ENV)   return '#8fc8a0';
if(n.type===TYPE_GEN)   return '#b08fc8';
if(n.type===TYPE_MESH){
const op=objParams.get(n.hash);
if(op&&op.__type==='spline') return '#6fa8d6';
if(op) return '#d0a86a';
return '#a8b0a0'; }
return '#cfcfcf'; }
function fillRow(el,r){ const n=r.node, d=r.depth;
const nameNeed=textW(n.name)+4, tagNeed=n.tags.length*17;
const fixed=d*14+16+32, W=Math.max(0, obClientW-fixed);
let nameW=Math.min(nameNeed, W-Math.min(tagNeed, W/2));
let tagW =Math.min(tagNeed,  W-Math.min(nameNeed, W/2));
if(nameW<0)nameW=0; if(tagW<0)tagW=0;
const p=panOf(n.hash);
const nxMax=Math.max(0,nameNeed-nameW), txMin=-(Math.max(0,tagNeed-tagW));
const effNx=clamp_ui(p.nx,-nxMax,0), effTx=p.tx===null?txMin:clamp_ui(p.tx,txMin,0);
el.className='ob-row'+(selNodes.has(n.hash)?' sel':'')+((effectiveVisible(n.hash)||selNodes.has(n.hash))?'':' ob-dim'); el.dataset.h=n.hash;
const col=nodeError(n.hash)?'#d05050':nameColor(n);
let html='<div class="ob-indent" style="width:'+(d*14)+'px"></div>';
html+='<div class="'+(n.children.length?'ob-foldcell':'ob-foldhole')+'"'+(n.children.length?' data-act="fold"':'')+'>'+(n.children.length?(n.folded?ICONS.ICO_TREE_PLUS:ICONS.ICO_TREE_MINUS):'')+'</div>';
html+='<div class="ob-namebox" style="width:'+nameW+'px"><div class="ob-name" style="transform:translateX('+effNx+'px);color:'+col+'">'+esc(n.name)+'</div></div>';
html+='<div class="ob-spacer"></div>';
html+='<div class="ob-tagbox" style="width:'+tagW+'px"><div class="ob-tags" style="transform:translateX('+effTx+'px)">';
for(let i=0;i<n.tags.length;i++){ const t=n.tags[i],bevel=t.type===2,url=t.ref?matUrl.get(t.ref):null;
const bg=url?('background-image:url('+url+')'):(bevel?'background:#7045a8':'background:#555');
html+='<div class="ob-tag'+(bevel?' bevel-tag':'')+(selTags.has(tagId(n.hash,i))?' sel':'')+'" data-act="tag" data-ti="'+i+'" data-type="'+t.type+'" data-mat="'+(t.ref||'')+'" title="'+(bevel?'Bevel':'Material')+'" style="'+bg+'">'+(bevel?'B':'')+'</div>'; }
html+='</div></div>';
html+='<div class="ob-rightgroup">';
html+='<div class="ob-cell ob-show" data-act="show" title="Show / hide" style="flex:0 0 16px">'+(n.visible?ICONS.ICO_TREE_SHOW:ICONS.ICO_TREE_HIDE)+'</div>';
if(n.enableSlot) html+='<div class="ob-cell ob-enable" data-act="enable" title="Generator — click or drag to enable/disable" style="flex:0 0 16px">'+(n.enabled?ICONS.ICO_TREE_ENABLE:'')+'</div>';
else html+='<div class="ob-hole"></div>';
html+='</div>';
el.innerHTML=html; }
function renderRows(){ if(activeGeneratorProfile){scheduleRows();return;}const ch=obScroll.clientHeight||1, st=obScroll.scrollTop;
const first=Math.max(0,Math.floor(st/17)-2), last=Math.min(flatRows.length-1,Math.ceil((st+ch)/17)+2);
const need=Math.max(0,last-first+1);
while(rowPool.length<need){ const e=document.createElement('div'); e.className='ob-row'; e.style.position='absolute'; e.style.left='0'; obInner.appendChild(e); rowPool.push(e); }
for(let i=0;i<rowPool.length;i++){ const e=rowPool[i];
if(i<need){ const idx=first+i; e.style.display='flex'; e.style.top=(idx*17)+'px'; e.style.width=obClientW+'px'; fillRow(e,flatRows[idx]); }
else e.style.display='none'; } }
let _obRaf=0; function scheduleRows(){ if(!_obRaf){ _obRaf=requestAnimationFrame(()=>{_obRaf=0; renderRows();}); } }
obScroll.addEventListener('scroll',()=>{ scheduleRows(); if(renameInput) commitRename(); },{passive:true});
new ResizeObserver(()=>{ obLayout(); renderRows(); }).observe(obScroll);
function rowRightEdge(node, d){ const nameNeed=textW(node.name)+4; const tagNeed=node.tags.length*17;
const fixed=d*14+16+32; const W=Math.max(0, obClientW-fixed);
let nameW=Math.min(nameNeed, W-Math.min(tagNeed, W/2)); if(nameW<0)nameW=0;
return d*14+16+nameW; }
obWrapEl.addEventListener('pointerdown',e=>{ treeActive=true;
const a=document.activeElement; if(a&&a!==e.target&&a!==renameInput&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA')) a.blur(); },true);
document.addEventListener('pointerdown',e=>{ if(!obWrapEl.contains(e.target)) treeActive=false; },true);
const isEditing=()=>{ const a=document.activeElement; return a&&a!==renameInput&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'); };
function blurActive(){ const a=document.activeElement;if(a?.blur&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'||a.isContentEditable))a.blur(); }
const obMenu=document.getElementById('obMenu');
function hideMenu(){ obMenu.classList.remove('show'); }
function showMenu(x,y,items){ obMenu.innerHTML='';
for(const it of items){ const d=document.createElement('div'); d.className='obm-item'+(it.disabled?' disabled':''); d.textContent=it.label; d.onclick=()=>{if(it.disabled)return;hideMenu();it.fn();};obMenu.appendChild(d); }
placePopupMenu(obMenu,x,y); }
addEventListener('pointerdown',e=>{ if(!obMenu.contains(e.target))hideMenu(); });
function openObjectsContextMenu(e){
const row=e.target.closest('.ob-row'); if(!row||e.target.closest('[data-act="tag"]'))return;
const h=row.dataset.h, n=getObj(h); if(!n)return;
if(!selNodes.has(h)){ selNodes.clear(); selTags.clear(); selNodes.add(h); anchorNode=n; renderRows(); }
showMenu(e.clientX,e.clientY,[
{label:'Group',fn:()=>runCmd(cmdGroup([...selNodes]))},
{label:'Select children',fn:()=>{ selNodes.clear(); selTags.clear(); n.children.forEach(c=>selNodes.add(c)); anchorNode=n; renderRows(); }},
{label:'To Spline Patch',disabled:selNodes.size!==1||(!canBakeToSplinePatch([...selNodes][0])&&!(splineData.has([...selNodes][0])&&!hasCh([...selNodes][0]))),fn:()=>{const h=[...selNodes][0];if(canBakeToSplinePatch(h)){const cmd=cmdParametricToSplinePatch(h);if(cmd)runCmd(cmd);}else addObject('spline_patch',TYPE_GEN,true,[h]);}},
{label:'Connect + Delete',disabled:!cmdConnectDelete([...selNodes]),fn:()=>runCmd(cmdConnectDelete([...selNodes]))} ]); }
let obContextDown=null;obScroll.addEventListener('pointerdown',e=>{if(e.button===2){obContextDown={x:e.clientX,y:e.clientY,target:e.target};e.preventDefault();}},true);obScroll.addEventListener('pointerup',e=>{if(e.button!==2||!obContextDown)return;const down=obContextDown;obContextDown=null;if(Math.hypot(e.clientX-down.x,e.clientY-down.y)<TAP_PX)openObjectsContextMenu({target:down.target,clientX:e.clientX,clientY:e.clientY});});obScroll.addEventListener('contextmenu',e=>e.preventDefault());
let renameInput=null, renameHash=null, renameOld=null;
obWrapEl.addEventListener('dblclick',e=>{const row=e.target.closest('.ob-row');if(!row)return;const nb=row.querySelector('.ob-namebox'),n=getObj(row.dataset.h);if(!nb||!n)return;openRename(nb,n);});
function openRename(nameBoxEl,n){ if(renameInput) commitRename(); renameHash=n.hash; renameOld=n.name;
const rr=nameBoxEl.getBoundingClientRect(), wr=obWrapEl.getBoundingClientRect();
const inp=document.createElement('input'); inp.className='ob-name-input'; inp.value=n.name;
inp.style.left=(rr.left-wr.left)+'px'; inp.style.top=(rr.top-wr.top)+'px'; inp.style.width=Math.max(rr.width,48)+'px';
obWrapEl.appendChild(inp); renameInput=inp; inp.focus(); inp.select();
inp.addEventListener('keydown',ev=>{ ev.stopPropagation(); if(ev.key==='Enter'){ ev.preventDefault(); commitRename(); } else if(ev.key==='Escape'){ cancelRename(); } });
inp.addEventListener('blur',commitRename); }
function commitRename(){ if(!renameInput)return; const inp=renameInput, h=renameHash, old=renameOld, v=inp.value;
renameInput=null; renameHash=null; renameOld=null; if(inp.parentNode)inp.parentNode.removeChild(inp);
if(v!==old) runCmd({redo(){ setObjField(h,'name',v); treeChanged(); }, undo(){ setObjField(h,'name',old); treeChanged(); }});
else treeChanged(); }
function cancelRename(){ if(!renameInput)return; const inp=renameInput; renameInput=null; renameHash=null; renameOld=null;
if(inp.parentNode)inp.parentNode.removeChild(inp); treeChanged(); }
/* ===================== pointer tree ===================== */
let obPtr=null;
obScroll.addEventListener('pointerdown',e=>{
if(e.button===1){ startObPan(e); return; }
if(e.button!==0)return; hideMenu();
if(e.altKey){beginMarquee(e);return;}
const tagEl=e.target.closest('[data-act="tag"]'), actEl=e.target.closest('[data-act]'), row=e.target.closest('.ob-row');
if(actEl){ const act=actEl.dataset.act, n=getObj(row.dataset.h);
if(act==='fold'){ toggleFold(n); e.preventDefault(); return; }
if(act==='show'||act==='enable'){ startPaint(e,row,n,act); return; } }
if(tagEl){ beginTagPtr(e,row.dataset.h,+tagEl.dataset.ti); return; }
if(row){ beginNodePtr(e,row.dataset.h); return; }
beginMarquee(e); });
function toggleFold(n){ if(!n.children.length)return; const was=n.folded; setObjField(n.hash,'folded',!was);
if(was&&treeAllFolded){ treeAllFolded=false; setBrowserIcon(); } treeChanged(); }
function startObPan(e){ const row=e.target.closest('.ob-row'); const h=row?row.dataset.h:null; const n=h?getObj(h):null;
const nameBox=row?row.querySelector('.ob-namebox'):null, tagBox=row?row.querySelector('.ob-tagbox'):null;
const nameW=nameBox?parseFloat(nameBox.style.width)||0:0, tagW=tagBox?parseFloat(tagBox.style.width)||0:0;
const nameNeed=n?textW(n.name)+4:0, tagNeed=n?n.tags.length*17:0;
let zoneH=null;
if(nameBox&&nameBox.contains(e.target)&&nameNeed>nameW) zoneH='name';
else if(tagBox&&tagBox.contains(e.target)&&tagNeed>tagW) zoneH='tag';
const p=h?panOf(h):null;
if(zoneH==='tag'&&p&&p.tx===null) p.tx=-(Math.max(0,tagNeed-tagW));
const st={sx:e.clientX,sy:e.clientY,ssy:obScroll.scrollTop,snx:p?p.nx:0,stx:p?p.tx:0,h,zoneH,nameW,tagW,nameNeed,tagNeed,txMin:-(Math.max(0,tagNeed-tagW)),nxMax:Math.max(0,nameNeed-nameW)};
obScroll.style.cursor='grabbing';
const move=ev=>{ if(zoneH==='name') p.nx=clamp_ui(st.snx+(ev.clientX-st.sx),-st.nxMax,0);
else if(zoneH==='tag') p.tx=clamp_ui(st.stx+(ev.clientX-st.sx),st.txMin,0);
else obScroll.scrollTop=st.ssy-(ev.clientY-st.sy)*4; scheduleRows(); };
const up=()=>{ obScroll.style.cursor=''; removeEventListener('pointermove',move); removeEventListener('pointerup',up); };
addEventListener('pointermove',move); addEventListener('pointerup',up); e.preventDefault(); }
function beginNodePtr(e,h){ const n=getObj(h), wasIn=selNodes.has(h); if(!e.ctrlKey&&!e.shiftKey)selMats.clear();
if(e.shiftKey&&anchorNode){ selNodes.clear(); selTags.clear(); selectNodeRange(anchorNode,n); refreshSelClasses(); }
else if(!e.ctrlKey&&!wasIn){ selNodes.clear(); selTags.clear(); selNodes.add(h); anchorNode=n; refreshSelClasses(); }
const sx=e.clientX, sy=e.clientY; let moved=false;
const move=ev=>{ if(!moved&&Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3){ moved=true;
const copy=e.ctrlKey, copySet=copy?(wasIn?[...selNodes]:[h]):null; startNodeDrag(ev,copy,copySet); }
if(moved&&obPtr) obMove(ev); };
const up=ev=>{ removeEventListener('pointermove',move); removeEventListener('pointerup',up);
if(moved){ if(obPtr) obUp(ev); }
else { if(e.ctrlKey){ if(wasIn) selNodes.delete(h); else { selNodes.add(h); anchorNode=n; } refreshSelClasses(); }
else if(!e.shiftKey){ selNodes.clear(); selTags.clear(); selNodes.add(h); anchorNode=n; refreshSelClasses(); activateTab('tabAttributes'); } }
obPtr=null; };
addEventListener('pointermove',move); addEventListener('pointerup',up); }
function selectNodeRange(a,b){ const vn=flatRows.map(r=>r.node); const ia=vn.indexOf(a), ib=vn.indexOf(b);
if(ia<0||ib<0)return; const lo=Math.min(ia,ib), hi=Math.max(ia,ib); for(let i=lo;i<=hi;i++) selNodes.add(vn[i].hash); }
function beginTagPtr(e,h,ti){ const id=tagId(h,ti), wasIn=selTags.has(id); if(!e.ctrlKey&&!e.shiftKey)selMats.clear();
if(e.shiftKey&&anchorTag){ selTags.clear(); selNodes.clear(); if(!selectTagRange(anchorTag,{h,i:ti})){ selTags.add(id); anchorTag={h,i:ti}; } refreshSelClasses(); }
else if(!e.ctrlKey&&!wasIn){ selTags.clear(); selNodes.clear(); selTags.add(id); anchorTag={h,i:ti}; refreshSelClasses(); }
const sx=e.clientX, sy=e.clientY; let moved=false;
const move=ev=>{ if(!moved&&Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3){ moved=true;
const copy=e.ctrlKey, copySet=copy?(wasIn?[...selTags]:[id]):null; startTagDrag(ev,copy,copySet); }
if(moved&&obPtr) obMove(ev); };
const up=ev=>{ removeEventListener('pointermove',move); removeEventListener('pointerup',up);
if(moved){ if(obPtr) obUp(ev); }
else { if(e.ctrlKey){ if(wasIn) selTags.delete(id); else { selTags.add(id); anchorTag={h,i:ti}; } refreshSelClasses(); }
else if(!e.shiftKey){ selTags.clear(); selNodes.clear(); selTags.add(id); anchorTag={h,i:ti}; const tag=OBJ.get(h)?.tags[ti];if(tag?.type===1){makeTagMaterialUnique(h,ti);activateTab('tabMaterialMgr');}else{selNodes.add(h);anchorNode=OBJ.get(h);activateTab('tabAttributes');}refreshSelClasses(); } }
obPtr=null; };
addEventListener('pointermove',move); addEventListener('pointerup',up); }
function tagRectPoint(h,i){
const ri=flatRows.findIndex(r=>r.node.hash===h); if(ri<0)return null;
const r=flatRows[ri],n=r.node,d=r.depth,nameNeed=textW(n.name)+4,tagNeed=n.tags.length*17;
const fixed=d*14+16+32,W=Math.max(0,obClientW-fixed),nameW=Math.max(0,Math.min(nameNeed,W-Math.min(tagNeed,W/2))),tagW=Math.max(0,Math.min(tagNeed,W-Math.min(nameNeed,W/2)));
const p=panOf(h),txMin=-Math.max(0,tagNeed-tagW),tx=p.tx===null?txMin:clamp_ui(p.tx,txMin,0);
return {x:obClientW-32-tagW+tx+i*17+8,y:ri*17+8};
}
function selectTagRange(a,b){
const pa=tagRectPoint(a.h,a.i),pb=tagRectPoint(b.h,b.i); if(!pa||!pb)return false;
const x0=Math.min(pa.x,pb.x),x1=Math.max(pa.x,pb.x),y0=Math.min(pa.y,pb.y),y1=Math.max(pa.y,pb.y);
flatRows.forEach(r=>r.node.tags.forEach((t,i)=>{ const p=tagRectPoint(r.node.hash,i); if(p&&p.x>=x0&&p.x<=x1&&p.y>=y0&&p.y<=y1)selTags.add(tagId(r.node.hash,i)); }));
return true;
}
function beginMarquee(e){ selNodes.clear(); selTags.clear(); anchorNode=anchorTag=null; refreshSelClasses();
const sx=e.clientX, sy=e.clientY; let moved=false;
const move=ev=>{ if(!moved&&Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3){ moved=true;
startMarquee(ev,sx,sy); } if(moved&&obPtr) obMove(ev); };
const up=ev=>{ removeEventListener('pointermove',move); removeEventListener('pointerup',up); if(moved&&obPtr) obUp(ev); obPtr=null; };
addEventListener('pointermove',move); addEventListener('pointerup',up); }
function startMarquee(e,sx,sy){ const box=document.createElement('div');
box.style.cssText='position:fixed;border:1px solid #5a8aff;background:rgba(90,138,255,.12);pointer-events:none;z-index:70';
document.body.appendChild(box);
obPtr={kind:'marquee',sx,sy,box,baseNodes:new Set(selNodes),baseTags:new Set(selTags),add:e.shiftKey||e.ctrlKey,rect:null}; }
function rectFromPtr(p,ev){ const x0=Math.min(p.sx,ev.clientX), y0=Math.min(p.sy,ev.clientY), x1=Math.max(p.sx,ev.clientX), y1=Math.max(p.sy,ev.clientY); p.rect={x0,y0,x1,y1};
p.box.style.left=x0+'px'; p.box.style.top=y0+'px'; p.box.style.width=(x1-x0)+'px'; p.box.style.height=(y1-y0)+'px'; }
function intersectRows(p){ for(const el of rowPool){ if(el.style.display==='none')continue; const r=el.getBoundingClientRect();
if(r.bottom>=p.rect.y0&&r.top<=p.rect.y1&&r.right>=p.rect.x0&&r.left<=p.rect.x1) selNodes.add(el.dataset.h); } }
function intersectTags(p){ for(const el of rowPool){ if(el.style.display==='none')continue;
el.querySelectorAll('.ob-tag').forEach(tg=>{ const r=tg.getBoundingClientRect();
if(r.bottom>=p.rect.y0&&r.top<=p.rect.y1&&r.right>=p.rect.x0&&r.left<=p.rect.x1) selTags.add(tagId(el.dataset.h,+tg.dataset.ti)); }); } }
function marqueeMove(ev){ const p=obPtr; rectFromPtr(p,ev);
selNodes.clear(); selTags.clear();
if(p.add) p.baseNodes.forEach(h=>selNodes.add(h));
intersectRows(p);
if(p.add) p.baseTags.forEach(id=>selTags.add(id));
intersectTags(p);
refreshSelClasses(); }
function marqueeUp(){ const p=obPtr; if(p.box)p.box.remove(); }
function startPaint(e,row,n,act){ const field=act==='show'?'visible':'enabled', val=!n[field];
const snap=new Map(); snap.set(n.hash,n[field]); setObjField(n.hash,field,val); scheduleRender();
obPtr={kind:'paint',field,val,snap}; renderRows(); e.preventDefault();
const mv=ev=>obMove(ev), up=ev=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',up); obUp(ev); };
addEventListener('pointermove',mv); addEventListener('pointerup',up); }
function paintMove(ev){ const el=document.elementFromPoint(ev.clientX,ev.clientY); const row=el&&el.closest&&el.closest('.ob-row'); if(!row)return; const h=row.dataset.h;
if(obPtr.snap.has(h))return; const n=getObj(h); if(!n)return; obPtr.snap.set(h,n[obPtr.field]); setObjField(h,obPtr.field,obPtr.val); scheduleRows(); scheduleRender(); }
function paintUp(){ const snap=obPtr.snap, field=obPtr.field, val=obPtr.val; obPtr=null;
runCmd({ redo(){ for(const [h] of snap) setObjField(h,field,val); treeChanged(); scheduleRender(); },
undo(){ for(const [h,old] of snap) setObjField(h,field,old); treeChanged(); scheduleRender(); } }); }
let dropLine=null;
function ensureDropLine(){ if(!dropLine){ dropLine=document.createElement('div'); dropLine.className='ob-dropline'; obInner.appendChild(dropLine); } return dropLine; }
function startNodeDrag(e,ctrl,copySet){ obPtr={kind:'dragN',hashes:copySet||[...selNodes],ctrl}; obWrapEl.classList.add('ob-dragging'); }
function dragNMove(ev){ const innerRect=obInner.getBoundingClientRect(); const y=ev.clientY-innerRect.top;
const innerH=flatRows.length*17; const ro=getRootOrder();
if(ro.length && y>=innerH-4){
const lastRoot=getObj(ro[ro.length-1]);
for(const el of rowPool) el.classList.remove('dropchild');
const dl=ensureDropLine(); dl.style.display='block'; dl.style.top=(innerH-1)+'px';
dl.style.left='16px'; dl.style.right='32px';
obWrapEl.style.setProperty('--ob-cur',CUR_LINE); obPtr.drop={target:lastRoot,mode:'rootEnd'};
const sr=obScroll.getBoundingClientRect();
if(ev.clientY-sr.top<24) obScroll.scrollTop-=16; else if(sr.bottom-ev.clientY<24) obScroll.scrollTop+=16; return; }
const idx=clamp_ui(Math.floor(y/17),0,flatRows.length-1);
const target=flatRows[idx]?flatRows[idx].node:null, rowTop=idx*17, posInRow=y-rowTop;
if(!target){ hideDrop(); obPtr.drop=null; return; }
const canBeChild=!obPtr.hashes.includes(target.hash)&&!obPtr.hashes.some(h=>isAnc(h,target.hash));
const hasKids=target.children.length>0;
let mode;
if(posInRow<4) mode='before';
else if(posInRow<12) mode=canBeChild?'child':'after';
else mode=(canBeChild&&hasKids)?'child':'after';
obWrapEl.style.setProperty('--ob-cur', mode==='child'?CUR_CHILD:CUR_LINE);
if(mode==='child'){ hideDrop(); for(const el of rowPool) if(el.style.display!=='none') el.classList.toggle('dropchild',el.dataset.h===target.hash); obPtr.drop={target,mode}; }
else { for(const el of rowPool) el.classList.remove('dropchild');
const lineY=(idx+(mode==='after'?1:0))*17, dl=ensureDropLine(); dl.style.display='block'; dl.style.top=(lineY-1)+'px';
const r=flatRows[idx]; dl.style.left=(r.depth*14+16)+'px'; dl.style.right='32px'; obPtr.drop={target,mode}; }
const sr=obScroll.getBoundingClientRect();
if(ev.clientY-sr.top<24) obScroll.scrollTop-=16; else if(sr.bottom-ev.clientY<24) obScroll.scrollTop+=16; }
function isAnc(a,b){ let c=getObj(b); while(c){ if(c.hash===a)return true; c=c.parent?getObj(c.parent):null; } return false; }
function hideDrop(){ if(dropLine)dropLine.style.display='none'; for(const el of rowPool) el.classList.remove('dropchild'); }
function dragNUp(ev){ obWrapEl.classList.remove('ob-dragging'); hideDrop();
const drop=obPtr.drop, hashes=obPtr.hashes, ctrl=obPtr.ctrl||ev.ctrlKey; obPtr.drop=null;
if(!drop){ renderRows(); return; }
const cmd=ctrl?cmdCopyTo(hashes,drop):cmdReparent(hashes,drop);
if(ctrl && cmd.map){ runCmd(cmd); copyObjParams(cmd.map); } else runCmd(cmd); }
let dropVert=null;
function ensureDropVert(){ if(!dropVert){ dropVert=document.createElement('div'); dropVert.className='ob-dropvert'; obInner.appendChild(dropVert); } return dropVert; }
function startTagDrag(e,ctrl,copySet){ obPtr={kind:'dragT',ids:(copySet||[...selTags]).map(parseTagId),ctrl};
obWrapEl.classList.add('ob-dragging'); obWrapEl.style.setProperty('--ob-cur','grabbing'); }
function dragTMove(ev){ const el=document.elementFromPoint(ev.clientX,ev.clientY); const row=el&&el.closest&&el.closest('.ob-row');
if(!row){ if(dropVert)dropVert.style.display='none'; obPtr.over=null; return; }
const h=row.dataset.h, tags=row.querySelectorAll('.ob-tag'), rr=row.getBoundingClientRect();
let idx; if(el.classList&&el.classList.contains('ob-tag')){ const tr=el.getBoundingClientRect(); idx=+el.dataset.ti+(ev.clientX>tr.left+tr.width/2?1:0); } else idx=tags.length;
idx=Math.max(0,Math.min(idx,tags.length));
const tagsArr=[...tags], tbr=row.querySelector('.ob-tagbox').getBoundingClientRect();
let leftX; if(idx<tagsArr.length) leftX=tagsArr[idx].getBoundingClientRect().left-rr.left;
else leftX=tagsArr.length?(tagsArr[tagsArr.length-1].getBoundingClientRect().right-rr.left):(tbr.left-rr.left);
const dv=ensureDropVert(); dv.style.display='block'; dv.style.left=leftX+'px';
dv.style.top=(rr.top-obInner.getBoundingClientRect().top+1)+'px'; dv.style.height='14px'; obPtr.over={h,i:idx}; }
function dragTUp(ev){ obWrapEl.classList.remove('ob-dragging'); if(dropVert)dropVert.style.display='none';
const ids=obPtr.ids, over=obPtr.over, ctrl=obPtr.ctrl||ev.ctrlKey;
if(over){
const moved=ctrl?null:ids.map(({h,i})=>getObj(h)?.tags[i]).filter(Boolean);
const copied=ctrl?ids.map(({h,i})=>getObj(h)?.tags[i]).filter(Boolean):null;
const copyAt=ctrl?Math.min(over.i,getObj(over.h).tags.length):0;
runCmd(ctrl?cmdCopyTags(ids,over):cmdMoveTags(ids,over));
if(moved){ selNodes.clear(); selTags.clear(); for(const tag of moved)eachNode(n=>{ const i=n.tags.indexOf(tag); if(i>=0)selTags.add(tagId(n.hash,i)); }); const first=[...selTags][0]; if(first)anchorTag=parseTagId(first); refreshSelClasses(); }
if(copied){ selNodes.clear(); selTags.clear(); for(let i=0;i<copied.length;i++)selTags.add(tagId(over.h,copyAt+i)); anchorTag={h:over.h,i:copyAt}; refreshSelClasses(); }
} }
function obMove(ev){ if(!obPtr)return;
if(obPtr.kind==='marquee')marqueeMove(ev); else if(obPtr.kind==='dragN')dragNMove(ev);
else if(obPtr.kind==='dragT')dragTMove(ev); else if(obPtr.kind==='paint')paintMove(ev); }
function obUp(ev){ if(!obPtr)return;
if(obPtr.kind==='marquee')marqueeUp(ev); else if(obPtr.kind==='dragN')dragNUp(ev);
else if(obPtr.kind==='dragT')dragTUp(ev); else if(obPtr.kind==='paint')paintUp(ev); }
/* ===================== превью материалов ===================== */
const matUrl=new Map();
function hsl2rgb(h,s,l){ const a=s*Math.min(l,1-l); const f=(n,k=(n+h/30)%12)=>l-a*Math.max(Math.min(k-3,9-k,1),-1); return [f(0),f(8),f(4)]; }
const envImg=document.createElement('canvas'); envImg.width=envImg.height=64;
{ const ec=envImg.getContext('2d'),eg=ec.createLinearGradient(0,64,0,0);
eg.addColorStop(0,'#0a0a0a');eg.addColorStop(0.35,'#2a2a2a');eg.addColorStop(0.65,'#666');eg.addColorStop(1,'#aaa');
ec.fillStyle=eg;ec.fillRect(0,0,64,64);
const sg=ec.createRadialGradient(18,12,0,18,12,22);
sg.addColorStop(0,'rgba(255,255,245,0.85)');sg.addColorStop(1,'rgba(255,255,245,0)');
ec.fillStyle=sg;ec.fillRect(0,0,64,64); }
const matPreview=document.getElementById('matPreview'),mpCtx=matPreview.getContext('2d',{willReadFrequently:true});
function renderMatToCanvas(ctx,w,h,m,showBump=true){
const hv=m.h, s=m.s/100, l=m.l/100, emm=m.emm/100, rough=m.rough/100, metal=m.metal/100, opac=m.opac/100;
const [r,g,b]=hsl2rgb(hv,s,l); const k=w/53;
ctx.save(); ctx.clearRect(0,0,w,h); if(ctx.canvas===matPreview){ctx.fillStyle='#262626';ctx.fillRect(0,0,w,h);} ctx.globalAlpha=Math.max(0,1-opac);
const att=1-metal*(1-rough*0.3);
ctx.fillStyle=`rgb(${Math.sqrt(r*0.5)*256*att},${Math.sqrt(g*0.5)*256*att},${Math.sqrt(b*0.5)*256*att})`; ctx.fillRect(0,0,w,h);
ctx.globalCompositeOperation='lighter';
ctx.filter=`brightness(0.1) blur(${Math.pow(rough,1.5)*20*k}px)`; ctx.drawImage(envImg,0,0,w,h);
ctx.filter=`brightness(${metal}) blur(${Math.pow(rough,1.5)*20*k}px)`; ctx.drawImage(envImg,0,0,w,h);
ctx.filter='none'; ctx.globalCompositeOperation='multiply';
ctx.fillStyle=`rgb(${256*(1+metal*(r-1))},${256*(1+metal*(g-1))},${256*(1+metal*(b-1))})`; ctx.fillRect(0,0,w,h);
if(m.map&&m.map.complete&&m.map.naturalWidth){ try{ ctx.drawImage(m.map,0,0,w,h); }catch{} }
if(showBump&&m.map&&m.bump>0){ const im=ctx.getImageData(0,0,w,h),a=im.data,bump=m.bump/100,str=(bump/(bump+0.7))*1.2,contrast=1+(bump/(bump+0.7))*0.42,cl=v=>Math.max(0,Math.min(255,v)); for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){ const i=(y*w+x)*4,lum=j=>(a[j]*0.299+a[j+1]*0.587+a[j+2]*0.114); const dx=lum(i+4)-lum(i-4),dy=lum(i+w*4)-lum(i-w*4),shade=1+str*(dx+dy)/255; a[i]=cl((a[i]*shade-128)*contrast+128);a[i+1]=cl((a[i+1]*shade-128)*contrast+128);a[i+2]=cl((a[i+2]*shade-128)*contrast+128); } ctx.putImageData(im,0,0); }
ctx.globalCompositeOperation='lighter';
const [er,eg2,eb]=hsl2rgb(hv,s,emm); ctx.fillStyle=`rgb(${er*256},${eg2*256},${eb*256})`; ctx.fillRect(0,0,w,h);
const rad=(2+1000*Math.pow(rough,5))*k, hl=(1-Math.pow(rough,0.2))*256;
const gr=ctx.createRadialGradient(w*0.396,h*0.377,0,w*0.396,h*0.377,rad);
gr.addColorStop(0,`rgb(${hl},${hl},${hl})`);gr.addColorStop(1,'rgb(0,0,0)'); ctx.fillStyle=gr;ctx.fillRect(0,0,w,h);
ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.filter='none'; ctx.restore(); }
function refreshMatVisuals(hash){ const m=getMat(hash); if(!m)return;
const c=document.createElement('canvas'); c.width=c.height=53; renderMatToCanvas(c.getContext('2d',{willReadFrequently:true}),53,53,m);
matUrl.set(hash,c.toDataURL());
const cardCvs=document.querySelector(`.mat-card[data-hash="${hash}"] canvas`);
if(cardCvs) renderMatToCanvas(cardCvs.getContext('2d'),53,53,m,false);
document.querySelectorAll(`.ob-tag[data-mat="${hash}"]`).forEach(el=>{ el.style.backgroundImage=`url(${matUrl.get(hash)})`; }); }
onMatReady(hash=>{ refreshMatVisuals(hash); if(uvMode)syncUvEditing(); });
function updateMatPreview(){ renderMatToCanvas(mpCtx,53,53,activeMat()); }
function activeMat(){ if(liveMat){ const m=getMat(liveMat); if(m) return m; liveMat=null; } return draft; }
let draft=Object.assign({h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0},{map:null,texBytes:null,texMime:null});
const PKEYS=['h','s','l','emm','rough','metal','opac','bump'];
function snapP(o){ const r={}; for(const k of PKEYS)r[k]=o[k]; return r; }
function applyP(o,p){ for(const k of PKEYS)o[k]=p[k]; }
function diffP(a,b){ for(const k of PKEYS)if(a[k]!==b[k])return true; return false; }
function syncInputs(force){ const a=document.activeElement, m=activeMat();
const setV=(id,v)=>{ const el=document.getElementById(id); if(el&&(force||el!==a)) el.value=(+v).toFixed(1); };
setV('inpH',m.h); setV('inpS',m.s); setV('inpL',m.l); setV('inpEmm',m.emm);
setV('inpRough',m.rough); setV('inpMetal',m.metal); setV('inpOpac',m.opac); setV('inpBump',m.bump); }
function setEditorCss(m){ document.body.style.setProperty('--h',m.h); document.body.style.setProperty('--s',m.s+'%'); document.body.style.setProperty('--l',m.l+'%'); }
function syncEditorView(obj,cmdHash,force){
if(activeMat()===obj){ setEditorCss(obj); updateMatPreview(); syncInputs(force); }
if(cmdHash){ const mm=getMat(cmdHash); if(mm) refreshMatVisuals(cmdHash); } }
function commitParams(before){ const m=activeMat(), after=snapP(m); if(!diffP(before,after))return;
const obj=m, cmdHash=liveMat;
pushCmd({ redo(){ applyP(obj,after); syncEditorView(obj,cmdHash,true); },
undo(){ applyP(obj,before); syncEditorView(obj,cmdHash,true); } });
syncEditorView(obj,cmdHash,false); }
function applyMat(){ updateMatPreview();
if(liveMat){ touchMat(liveMat);
const cardCvs=document.querySelector(`.mat-card[data-hash="${liveMat}"] canvas`);
if(cardCvs) cardCvs.getContext('2d').drawImage(mpCtx.canvas,0,0,53,53); }
if(uvMode)syncUvEditing();
scheduleRender(); }
function setField(field,val){ const m=activeMat(); m[field]=val;
if(field==='h')document.body.style.setProperty('--h',val);
if(field==='s')document.body.style.setProperty('--s',val+'%');
if(field==='l')document.body.style.setProperty('--l',val+'%'); }
function scrubGrad(el,field,sens,min,max){ let act=false,before=null;
el.addEventListener('pointerdown',e=>{ act=true; blurActive(); before=snapP(activeMat()); el.setPointerCapture(e.pointerId); e.preventDefault(); });
el.addEventListener('pointermove',e=>{ if(!act)return; let v=activeMat()[field]+(e.movementX-e.movementY)/sens; v=Math.max(min,Math.min(max,v)); setField(field,v); applyMat(); syncInputs(); });
el.addEventListener('pointerup',()=>{ if(act) commitParams(before); act=false; before=null; });
el.addEventListener('pointercancel',()=>{ act=false; before=null; }); }
function scrubInput(el,field,sens,min,max){ let act=false,moved=false,pid=null,before=null;
el.addEventListener('pointerdown',e=>{ act=true;moved=false;pid=e.pointerId; before=snapP(activeMat()); });
el.addEventListener('pointermove',e=>{ if(!act||e.pointerId!==pid)return;
if(!moved){ if(Math.abs(e.movementX)+Math.abs(e.movementY)<2)return; moved=true; el.blur(); try{el.setPointerCapture(e.pointerId);}catch{} }
let v=activeMat()[field]+(e.movementX-e.movementY)/sens; v=Math.max(min,Math.min(max,v)); setField(field,v); applyMat(); syncInputs(); });
const end=()=>{ if(act) commitParams(before); act=false;moved=false;pid=null;before=null; };
el.addEventListener('pointerup',end); el.addEventListener('pointercancel',end);
el.addEventListener('keydown',e=>{ if(e.key==='Enter')el.blur(); });
el.addEventListener('change',()=>{ const before=snapP(activeMat()); let v=parseFloat(el.value);
if(isNaN(v)){syncInputs();return;} v=Math.max(min,Math.min(max,v)); setField(field,v); applyMat(); syncInputs(); commitParams(before); }); }
scrubGrad(document.getElementById('gradH'),'h',4,0,360);
scrubGrad(document.getElementById('gradS'),'s',3,0,100);
scrubGrad(document.getElementById('gradL'),'l',8,0,100);
scrubInput(document.getElementById('inpH'),'h',4,0,360);
scrubInput(document.getElementById('inpS'),'s',3,0,100);
scrubInput(document.getElementById('inpL'),'l',8,0,100);
scrubInput(document.getElementById('inpEmm'),'emm',8,0,100);
scrubInput(document.getElementById('inpRough'),'rough',8,0,100);
scrubInput(document.getElementById('inpMetal'),'metal',8,0,100);
scrubInput(document.getElementById('inpOpac'),'opac',8,0,100);
scrubInput(document.getElementById('inpBump'),'bump',16,0,100);
const PAL=[
[0,0,0],[0,0,17],[0,0,33],[0,0,50],[0,0,67],[0,0,83],[0,0,100],
[7,50,68],[28,50,68],[55,46,68],[135,46,68],[196,46,68],[262,46,68],[320,46,68],
[5,70,50],[28,80,50],[55,78,44],[135,62,42],[196,70,40],[262,70,58],[328,66,56]
];
(function initMatPalette(){ const pal=document.getElementById('mePal');
PAL.forEach(([h,s,l])=>{ const sw=document.createElement('div'); sw.className='sw';
const css=`hsl(${h} ${s}% ${l}%)`; sw.style.background=css; sw.title=css;
sw.addEventListener('click',()=>{ const before=snapP(activeMat());
setField('h',h); setField('s',s); setField('l',l); applyMat(); syncInputs(); commitParams(before); });
pal.appendChild(sw); }); })();
function setDraftTexture(bytes,mime){ const m=activeMat(); m.texBytes=bytes; m.texMime=mime;
const blob=new Blob([bytes],{type:mime||'image/jpeg'}); const url=URL.createObjectURL(blob); const im=new Image();
im.onload=()=>{ URL.revokeObjectURL(url); m.map=im;
document.getElementById('btnDelTex').style.display='flex';
document.getElementById('bumpLab').style.display=''; document.getElementById('inpBump').style.display='';
applyMat(); if(liveMat) refreshMatVisuals(liveMat); };
im.onerror=()=>URL.revokeObjectURL(url); im.src=url; }
function clearDraftTexture(){ const m=activeMat(); m.map=null; m.texBytes=null; m.texMime=null; m.bump=0;
document.getElementById('btnDelTex').style.display='none';
document.getElementById('bumpLab').style.display='none'; document.getElementById('inpBump').style.display='none';
setField('bump',0); syncInputs(); applyMat(); if(liveMat) refreshMatVisuals(liveMat); }
function loadTextureFromFile(file){ if(!file||!file.type.startsWith('image/'))return;
const fr=new FileReader(); fr.onload=()=>setDraftTexture(new Uint8Array(fr.result),file.type); fr.readAsArrayBuffer(file); }
const texInput=document.getElementById('texInput');
const TEX_TYPES=[{description:'Images',accept:{'image/*':['.png','.jpg','.jpeg','.webp','.bmp']}}];
document.getElementById('btnLoadTex').addEventListener('click',async()=>{
if('showOpenFilePicker' in window){ try{ const [h]=await showOpenFilePicker({types:TEX_TYPES,multiple:false,excludeAcceptAllOption:true});
loadTextureFromFile(await h.getFile()); return; }catch(e){ if(e&&e.name==='AbortError')return; } }
texInput.click(); });
texInput.onchange=e=>{ if(e.target.files[0])loadTextureFromFile(e.target.files[0]); texInput.value=''; };
document.getElementById('btnDelTex').addEventListener('click',clearDraftTexture);
/* ===================== палитра материалов ===================== */
const selMats=new Set(); const matListEl=document.getElementById('matList'); let mlMarquee=null;
function refreshMatSel(){ document.querySelectorAll('.mat-card').forEach(c=>c.classList.toggle('sel',selMats.has(c.dataset.hash))); recomputeLiveFromSelection(); }
function addMatCard(hash){ const m=getMat(hash);
const card=document.createElement('div'); card.className='mat-card'; card.draggable=true; card.dataset.hash=hash;
const cvs=document.createElement('canvas'); cvs.width=cvs.height=53;
const inp=document.createElement('input'); inp.value=m.name; inp.spellcheck=false; inp.autocomplete='off'; inp.readOnly=true;
card.appendChild(cvs); card.appendChild(inp); matListEl.appendChild(card);
renderMatToCanvas(cvs.getContext('2d'),53,53,m); matUrl.set(hash,cvs.toDataURL());
inp.addEventListener('blur',()=>{ inp.readOnly=true; m.name=inp.value; inp.setSelectionRange(0,0); });
inp.addEventListener('keydown',ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); inp.blur(); } else if(ev.key==='Escape'){ inp.value=m.name; inp.blur(); } ev.stopPropagation(); });
return card; }
function rebuildMatCards(){ matListEl.innerHTML=''; selMats.clear(); getAllMatHashes().forEach(h=>{ addMatCard(h); refreshMatVisuals(h); }); }
matListEl.addEventListener('click',e=>{ if(mlMarquee&&mlMarquee.moved) return;
const card=e.target.closest('.mat-card'); if(!card) return; const hash=card.dataset.hash;
if(e.shiftKey&&selMats.size){ const cards=[...matListEl.querySelectorAll('.mat-card')];
const a=cards.findIndex(c=>selMats.has(c.dataset.hash)), b=cards.indexOf(card);
if(a>=0&&b>=0){ const lo=Math.min(a,b),hi=Math.max(a,b); for(let i=lo;i<=hi;i++) selMats.add(cards[i].dataset.hash); }
} else if(e.ctrlKey||e.metaKey){ if(selMats.has(hash)) selMats.delete(hash); else selMats.add(hash); }
else { selMats.clear(); selMats.add(hash); }
refreshMatSel(); });
matListEl.addEventListener('dblclick',e=>{
const inp=e.target.closest('input');
if(inp){ const card=inp.closest('.mat-card'); inp.readOnly=false; inp.focus(); inp.select();
selMats.clear(); if(card)selMats.add(card.dataset.hash); refreshMatSel(); return; }
const card=e.target.closest('.mat-card');
if(card){ const hash=card.dataset.hash; selMats.clear(); selMats.add(hash); refreshMatSel(); activateTab('tabMaterialMgr'); return; }
createMatFromDefault(); });
matListEl.addEventListener('pointerdown',e=>{
if(e.button===1){ startMatPan(e); return; }
if(e.button!==0) return;
if(e.target.closest('.mat-card')) return;
const sx=e.clientX, sy=e.clientY; let moved=false; const add=e.shiftKey||e.ctrlKey||e.metaKey; const base=new Set(selMats); let box=null;
const move=ev=>{ if(!moved&&Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>3){ moved=true;
box=document.createElement('div'); box.className='ml-marquee'; document.body.appendChild(box); if(!add) selMats.clear(); }
if(!moved) return;
const x0=Math.min(sx,ev.clientX),y0=Math.min(sy,ev.clientY),x1=Math.max(sx,ev.clientX),y1=Math.max(sy,ev.clientY);
box.style.left=x0+'px'; box.style.top=y0+'px'; box.style.width=(x1-x0)+'px'; box.style.height=(y1-y0)+'px';
if(!add) selMats.clear(); else base.forEach(h=>selMats.add(h));
matListEl.querySelectorAll('.mat-card').forEach(c=>{ const r=c.getBoundingClientRect();
if(r.bottom>=y0&&r.top<=y1&&r.right>=x0&&r.left<=x1) selMats.add(c.dataset.hash); });
refreshMatSel(); };
const up=()=>{ removeEventListener('pointermove',move); removeEventListener('pointerup',up); if(box) box.remove();
if(!moved){ selMats.clear(); refreshMatSel(); } mlMarquee={moved}; setTimeout(()=>{mlMarquee=null;},0); };
addEventListener('pointermove',move); addEventListener('pointerup',up); });
function startMatPan(e){ e.preventDefault(); const sy=e.clientY, sTop=matListEl.scrollTop; matListEl.classList.add('ml-panning');
const move=ev=>{ matListEl.scrollTop=sTop-(ev.clientY-sy)*2; };
const up=()=>{ matListEl.classList.remove('ml-panning'); removeEventListener('pointermove',move); removeEventListener('pointerup',up); };
addEventListener('pointermove',move); addEventListener('pointerup',up); }
matListEl.addEventListener('wheel',e=>{ if(e.ctrlKey) return; e.preventDefault(); matListEl.scrollTop+=e.deltaY; },{passive:false});
let _matN=0; function nextMatName(){ return 'mat'+(++_matN); }
function finalizeNewMat(hash, selectAndBind){ refreshMatVisuals(hash); addMatCard(hash);
if(selectAndBind){ selMats.clear(); selMats.add(hash); refreshMatSel(); }
else { const m=getMat(hash); draft.h=m.h; draft.s=m.s; draft.l=m.l; draft.emm=m.emm; draft.rough=m.rough; draft.metal=m.metal; draft.opac=m.opac; draft.bump=m.bump;
draft.map=m.map; draft.texBytes=m.texBytes; draft.texMime=m.texMime;
selMats.clear(); selTags.clear(); liveMat=null; refreshMatSel();
document.body.style.setProperty('--h',draft.h); document.body.style.setProperty('--s',draft.s+'%'); document.body.style.setProperty('--l',draft.l+'%');
updateMatPreview(); syncInputs(); } }
function createMatFromDefault(){ const d=getMat(getDefaultMatHash());
const base=d?{h:d.h,s:d.s,l:d.l,emm:d.emm,rough:d.rough,metal:d.metal,opac:d.opac,bump:d.bump,map:d.map,texBytes:d.texBytes,texMime:d.texMime}:{h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0};
finalizeNewMat(makeMat(Object.assign({name:nextMatName()},base)), true); }
function createMatFromCurrent(){ const s=activeMat();
finalizeNewMat(makeMat(Object.assign({name:nextMatName()},{h:s.h,s:s.s,l:s.l,emm:s.emm,rough:s.rough,metal:s.metal,opac:s.opac,bump:s.bump,map:s.map,texBytes:s.texBytes,texMime:s.texMime})), false); }
tabAddNew.addEventListener('click',()=>{ const id=activeTabId();
if(id==='tabMaterials') createMatFromDefault();
else if(id==='tabMaterialMgr') createMatFromCurrent();
else if(id==='tabObjects') addPlain('object',TYPE_MESH,false); });
function cmdDeleteMats(hashes){
hashes=hashes.filter(h=>{ const m=getMat(h); return m&&!m.isDefault; });
if(!hashes.length) return {redo(){},undo(){}};
const matSnap=hashes.map(h=>({h, mat:Object.assign({}, getMat(h))}));
const tagSnap=[]; eachNode(n=>{ if(n.tags.some(t=>hashes.includes(t.ref))) tagSnap.push({h:n.hash, tags:n.tags.map(cloneTag)}); });
return {
redo(){ eachNode(n=>{ n.tags=n.tags.filter(t=>!hashes.includes(t.ref)); });
hashes.forEach(h=>{ deleteMat(h); matUrl.delete(h); const c=document.querySelector(`.mat-card[data-hash="${h}"]`); if(c)c.remove(); selMats.delete(h); });
if(liveMat&&!getMat(liveMat)) liveMat=null; refreshMatSel(); treeChanged(); },
undo(){ matSnap.forEach(s=>{ restoreMat(s.h, s.mat); addMatCard(s.h); refreshMatVisuals(s.h); });
tagSnap.forEach(s=>{ const n=getObj(s.h); if(n) n.tags=s.tags.map(cloneTag); });
refreshMatSel(); treeChanged(); } }; }
function matSignature(m){ return [m.h,m.s,m.l,m.emm,m.rough,m.metal,m.opac,m.bump].map(x=>(+x).toFixed(2)).join(',')+'|'+(m.texBytes?m.texBytes.length+':'+(m.texMime||''):''); }
tabDelUnused.addEventListener('click',()=>{
const used=new Set(); eachNode(n=>n.tags.forEach(t=>{ if(t.ref) used.add(t.ref); }));
const groups=new Map(); for(const h of getAllMatHashes()){ const m=getMat(h); const sig=matSignature(m); if(!groups.has(sig))groups.set(sig,[]); groups.get(sig).push(h); }
const remap=new Map(); const toDelete=new Set();
groups.forEach(arr=>{ if(arr.length<2)return; const canon=arr.find(h=>used.has(h))||arr[0]; arr.forEach(h=>{ if(h!==canon){ remap.set(h,canon); toDelete.add(h); } }); });
for(const h of getAllMatHashes()){ const m=getMat(h); if(m.isDefault||toDelete.has(h))continue; if(!used.has(h)) toDelete.add(h); }
if(!toDelete.size)return;
const matSnap=[...toDelete].map(h=>({h, mat:Object.assign({}, getMat(h))}));
const affected=new Set(); eachNode(n=>{ if(n.tags.some(t=>toDelete.has(t.ref)||remap.has(t.ref))) affected.add(n.hash); });
const tagSnap=[...affected].map(h=>({h, tags:getObj(h).tags.map(cloneTag)}));
runCmd({
redo(){ affected.forEach(h=>{ const n=getObj(h); if(!n)return;
n.tags=n.tags.map(t=>remap.has(t.ref)?{...t,ref:remap.get(t.ref)}:t).filter((t,i,a)=>a.findIndex(x=>x.ref===t.ref)===i); });
[...toDelete].forEach(h=>{ deleteMat(h); matUrl.delete(h); const c=document.querySelector(`.mat-card[data-hash="${h}"]`); if(c)c.remove(); selMats.delete(h); });
if(liveMat&&!getMat(liveMat)) liveMat=null; refreshMatSel(); treeChanged(); },
undo(){ matSnap.forEach(s=>{ restoreMat(s.h, s.mat); addMatCard(s.h); refreshMatVisuals(s.h); });
tagSnap.forEach(s=>{ const n=getObj(s.h); if(n) n.tags=s.tags.map(cloneTag); });
refreshMatSel(); treeChanged(); } }); });
/* ===================== назначение материалов (drag&drop) ===================== */
function cmdAssignMat(h, matHash, replaceIdx){
const obj=getObj(h); if(!obj) return null;
const snapTags=obj.tags.map(cloneTag);
const isDef=(matHash===getDefaultMatHash());
return { redo(){ const n=getObj(h); if(!n)return;
if(isDef){ n.tags=n.tags.filter(t=>t.type!==1); }
else if(replaceIdx>=0&&n.tags[replaceIdx]&&n.tags[replaceIdx].type===1){ n.tags[replaceIdx]={type:1,ref:matHash,polys:null,mapFrame:defaultTagMapFrame(h),mapPivot:new THREE.Matrix4()}; }
else { const i=n.tags.findIndex(t=>t.type===1&&t.polys==null);
if(i>=0) n.tags[i]={type:1,ref:matHash,polys:null,mapFrame:defaultTagMapFrame(h),mapPivot:new THREE.Matrix4()}; else n.tags.push({type:1,ref:matHash,polys:null,mapFrame:defaultTagMapFrame(h),mapPivot:new THREE.Matrix4()}); }
applyNodeMaterial(h); treeChanged(); },
undo(){ const n=getObj(h); if(!n)return; n.tags=snapTags.map(t=>({...t})); applyNodeMaterial(h); treeChanged(); } }; }
function cloneTags(tags){ return tags.map(t=>Object.assign({},t,{polys:Array.isArray(t.polys)?t.polys.slice():null})); }
function polyFaceTargets(){ const out=new Map(); if(!polyMode||polyElementMode!=='face')return out; for(const [h,s] of polySelection.items)if(s.faces.size)out.set(h,[...s.faces]); return out; }
function cmdAssignMatToPolySelection(matHash){ const targets=polyFaceTargets(),before=new Map(); if(!targets.size)return null;
for(const [h] of targets){ const n=getObj(h);if(n)before.set(h,cloneTags(n.tags)); }
return {redo(){ for(const [h,faces] of targets){ const n=getObj(h);if(!n)continue; const picked=new Set(faces); n.tags=n.tags.map(t=>Array.isArray(t.polys)?Object.assign({},t,{polys:t.polys.filter(fi=>!picked.has(fi))}):t).filter(t=>!Array.isArray(t.polys)||t.polys.length);
if(matHash!==getDefaultMatHash()){ let tag=n.tags.find(t=>t.type===1&&t.ref===matHash&&Array.isArray(t.polys)); if(!tag){tag={type:1,ref:matHash,polys:[],mapFrame:defaultTagMapFrame(h),mapPivot:new THREE.Matrix4()};n.tags.push(tag);} for(const fi of faces)if(!tag.polys.includes(fi))tag.polys.push(fi); tag.polys.sort((a,b)=>a-b); } applyNodeMaterial(h); } treeChanged(); },
undo(){ for(const [h,tags] of before){ const n=getObj(h);if(n){n.tags=cloneTags(tags);applyNodeMaterial(h);} } treeChanged(); } }; }
function assignMaterialDrop(matHash){ const polyCmd=cmdAssignMatToPolySelection(matHash); if(!polyCmd)return false; runCmd(polyCmd); return true; }
async function fetchTex(url){ try{ const resp=await fetch(url); if(!resp.ok)return null; const mime=resp.headers.get('content-type')||'image/jpeg',buf=await resp.arrayBuffer(),bytes=new Uint8Array(buf),blob=new Blob([bytes],{type:mime});
return {bytes,mime,blob}; }catch(e){ return null; } }
function texImageFromBlob(blob){ return new Promise(res=>{ const u=URL.createObjectURL(blob); const im=new Image();
im.onload=()=>{ URL.revokeObjectURL(u); res(im); }; im.onerror=()=>{ URL.revokeObjectURL(u); res(null); }; im.src=u; }); }
async function applyTextureToMat(matHash,url){ const m=getMat(matHash); if(!m)return;
const ft=await fetchTex(url); if(!ft)return;
const im=await texImageFromBlob(ft.blob); if(!im)return;
const before={map:m.map,texBytes:m.texBytes,texMime:m.texMime};
m.texBytes=ft.bytes; m.texMime=ft.mime; m.map=im;
touchMat(matHash); refreshMatVisuals(matHash);
if(uvMode)syncUvEditing();
const after={map:im,texBytes:ft.bytes,texMime:ft.mime};
pushCmd({ redo(){ const mm=getMat(matHash); if(!mm)return;
mm.texBytes=after.texBytes; mm.texMime=after.texMime; mm.map=after.map;
touchMat(matHash); refreshMatVisuals(matHash); if(uvMode)syncUvEditing(); },
undo(){ const mm=getMat(matHash); if(!mm)return;
mm.texBytes=before.texBytes; mm.texMime=before.texMime; mm.map=before.map;
touchMat(matHash); refreshMatVisuals(matHash); if(uvMode)syncUvEditing(); } });
selMats.clear(); selMats.add(matHash); refreshMatSel(); }
async function createTexturedMatForTarget(h,url,usePolySelection=false){ const ft=await fetchTex(url); if(!ft)return;
const im=await texImageFromBlob(ft.blob); if(!im)return;
const d=getMat(getDefaultMatHash());
const base=d?{h:d.h,s:d.s,l:d.l,emm:d.emm,rough:d.rough,metal:d.metal,opac:d.opac,bump:d.bump}:{h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0};
const newHash=makeMat(Object.assign({name:nextMatName()},base,{map:im,texBytes:ft.bytes,texMime:ft.mime}));
refreshMatVisuals(newHash); addMatCard(newHash);
if(!usePolySelection||!assignMaterialDrop(newHash))runCmd(cmdAssignMat(h,newHash,-1));
if(uvMode)syncUvEditing();
selMats.clear(); selMats.add(newHash); refreshMatSel(); }
function matTagsOf(n){ return n.tags.filter(t=>t.type===1&&t.ref&&getMat(t.ref)); }
function makeTagMaterialUnique(h,i){ const n=getObj(h),tag=n&&n.tags[i]; if(!tag||tag.type!==1||!tag.ref)return; let uses=0; eachNode(x=>x.tags.forEach(t=>{if(t.type===1&&t.ref===tag.ref)uses++;})); if(uses<2)return; const m=getMat(tag.ref); if(!m)return; const copy=makeMat({name:nextMatName(),h:m.h,s:m.s,l:m.l,emm:m.emm,rough:m.rough,metal:m.metal,opac:m.opac,bump:m.bump,map:m.map,texBytes:m.texBytes,texMime:m.texMime}); tag.ref=copy; addMatCard(copy); applyNodeMaterial(h); }
function objectMatTagOf(n){ return n&&n.tags.find(t=>t.type===1&&t.polys==null&&t.ref&&getMat(t.ref)); }
function selectedFacesMatHash(){ const targets=polyFaceTargets(); if(!targets.size)return null; let common=null;
for(const [h,faces] of targets){ const n=getObj(h); if(!n)return null; for(const fi of faces){ const tag=n.tags.find(t=>t.type===1&&Array.isArray(t.polys)&&t.polys.includes(fi)&&t.ref&&getMat(t.ref)); if(!tag)return null; if(common===null)common=tag.ref; else if(common!==tag.ref)return null; } }
return common; }
function dropTextureOnRow(h,url){ const n=getObj(h); if(!n)return;
const tag=objectMatTagOf(n);
if(tag) applyTextureToMat(tag.ref,url);
else createTexturedMatForTarget(h,url,false); }
function nearestMatTags(h){ let c=getObj(h);
while(c){ const mt=matTagsOf(c); if(mt.length) return {node:c,tags:mt}; c=c.parent?getObj(c.parent):null; }
return null; }
function dropTextureOnViewportNode(h,url){ const targets=polyFaceTargets();
if(targets.size&&targets.has(h)){ const matHash=selectedFacesMatHash(); if(matHash)applyTextureToMat(matHash,url); else createTexturedMatForTarget(h,url,true); return; }
const n=getObj(h),local=objectMatTagOf(n); if(local)applyTextureToMat(local.ref,url); else createTexturedMatForTarget(h,url,false); }
(function initMaterialDragDrop(){
matPreview.addEventListener('dragstart',e=>{ e.dataTransfer.effectAllowed='copy'; if(liveMat){ e.dataTransfer.setData('application/x-frame-material',liveMat); e.dataTransfer.setData('text/plain',liveMat); } else { e.dataTransfer.setData('application/x-mat-draft','1'); e.dataTransfer.setData('text/plain',''); } });
matListEl.addEventListener('dragstart',e=>{ const card=e.target.closest('.mat-card'); if(!card)return; const hash=card.dataset.hash; if(!getMat(hash))return;
e.dataTransfer.effectAllowed='copy'; e.dataTransfer.setData('application/x-frame-material',hash); e.dataTransfer.setData('text/plain',hash); });
obInner.addEventListener('dragover',e=>{ const row=e.target.closest('.ob-row'); if(row){ e.preventDefault(); e.dataTransfer.dropEffect='copy'; row.classList.add('drop-target'); } });
obInner.addEventListener('dragleave',e=>{ const row=e.target.closest('.ob-row'); if(row) row.classList.remove('drop-target'); });
obInner.addEventListener('drop',e=>{ const row=e.target.closest('.ob-row'); if(!row)return; row.classList.remove('drop-target'); e.preventDefault();
const obj=getObj(row.dataset.h); if(!obj)return;
const texUrl=e.dataTransfer.getData('application/x-frame-tex');
if(texUrl){ const tagEl=e.target.closest('.ob-tag');
if(tagEl&&row.contains(tagEl)&&tagEl.dataset.mat&&getMat(tagEl.dataset.mat)) applyTextureToMat(tagEl.dataset.mat,texUrl);
else dropTextureOnRow(row.dataset.h,texUrl);
return; }
const isDraft=e.dataTransfer.getData('application/x-mat-draft')==='1';
const cardHash=e.dataTransfer.getData('application/x-frame-material')||e.dataTransfer.getData('text/plain');
const tagEl=e.target.closest('.ob-tag'); const replaceIdx=(tagEl&&row.contains(tagEl))?+tagEl.dataset.ti:-1;
if(isDraft){
const newHash=makeMat(Object.assign({name:nextMatName()},{h:draft.h,s:draft.s,l:draft.l,emm:draft.emm,rough:draft.rough,metal:draft.metal,opac:draft.opac,bump:draft.bump,map:draft.map,texBytes:draft.texBytes,texMime:draft.texMime}));
refreshMatVisuals(newHash); addMatCard(newHash);
if(!assignMaterialDrop(newHash,row.dataset.h))runCmd(cmdAssignMat(row.dataset.h,newHash,replaceIdx));
selMats.clear(); selMats.add(newHash); refreshMatSel();
} else { if(!cardHash||!getMat(cardHash))return;
if(!assignMaterialDrop(cardHash,row.dataset.h))runCmd(cmdAssignMat(row.dataset.h,cardHash,replaceIdx));
selMats.clear(); selMats.add(cardHash); refreshMatSel(); } });
})();
(function initViewportDrop(){
const vpEl=document.getElementById('vp');
let vpDropHash=null;
vpEl.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; const h=pickHashAt(e.clientX,e.clientY); if(h)vpDropHash=h; });
vpEl.addEventListener('dragleave',e=>{ if(!vpEl.contains(e.relatedTarget))vpDropHash=null; });
vpEl.addEventListener('drop',e=>{ e.preventDefault();
const h=pickHashAt(e.clientX,e.clientY)||vpDropHash; vpDropHash=null; if(!h)return;
const texUrl=e.dataTransfer.getData('application/x-frame-tex');
if(texUrl){ dropTextureOnViewportNode(h,texUrl); return; }
const isDraft=e.dataTransfer.getData('application/x-mat-draft')==='1';
const cardHash=e.dataTransfer.getData('application/x-frame-material')||e.dataTransfer.getData('text/plain');
if(isDraft){
const newHash=makeMat(Object.assign({name:nextMatName()},{h:draft.h,s:draft.s,l:draft.l,emm:draft.emm,rough:draft.rough,metal:draft.metal,opac:draft.opac,bump:draft.bump,map:draft.map,texBytes:draft.texBytes,texMime:draft.texMime}));
refreshMatVisuals(newHash); addMatCard(newHash);
if(!assignMaterialDrop(newHash,h))runCmd(cmdAssignMat(h,newHash,-1));
selMats.clear(); selMats.add(newHash); refreshMatSel();
} else if(cardHash&&getMat(cardHash)){ if(!assignMaterialDrop(cardHash,h))runCmd(cmdAssignMat(h,cardHash,-1)); selMats.clear(); selMats.add(cardHash); refreshMatSel(); } });
})();
/* ===================== библиотека объектов ===================== */
(function initObjectsLibrary(){ const panel=document.getElementById('objectsPanel'); const grid=document.createElement('div'); grid.className='obj-lib-grid';
const items=[
{name:'cube',icon:ICONS.ICO_OBJ_CUBE}, {name:'cylinder',icon:ICONS.ICO_OBJ_CYL},
{name:'tube',icon:ICONS.ICO_OBJ_TUBE}, {name:'sphere',icon:ICONS.ICO_OBJ_SPHERE},
{name:'square',icon:ICONS.ICO_OBJ_SQUARE}, {name:'circle',icon:ICONS.ICO_OBJ_CIRCLE},
{name:'polyhedron',icon:ICONS.ICO_OBJ_POLY}, {name:'text',icon:ICONS.ICO_OBJ_TEXT}
];
items.forEach(item=>{ const btn=document.createElement('div'); btn.className='obj-lib-item'; btn.innerHTML=item.icon; btn.title=item.name;
btn.addEventListener('click',()=>addPlain(item.name,TYPE_MESH,false)); grid.appendChild(btn); });
panel.appendChild(grid); })();
/* ===================== textures library ===================== */
const texScroll=document.getElementById('texScroll'), texGrid=document.getElementById('texGrid');
function buildTextures(){ let i=1;
(function go(){ const img=new Image();
img.onload=()=>{ const card=document.createElement('div'); card.className='tex-card'; card.draggable=true;
img.className='tex-img'; card.appendChild(img); texGrid.appendChild(card);
img.draggable=false; card.addEventListener('dragstart',e=>{ e.dataTransfer.effectAllowed='copy';
e.dataTransfer.setData('application/x-frame-tex',img.src); e.dataTransfer.setData('text/plain',''); });
i++; go(); };
img.onerror=()=>{}; img.src=i+'.jpg'; })(); }
{ let pan=null;
texScroll.addEventListener('pointerdown',e=>{ if(e.button!==1)return; e.preventDefault(); pan={y:e.clientY,sy:texScroll.scrollTop}; texScroll.style.cursor='grabbing'; });
addEventListener('pointermove',e=>{ if(!pan)return; texScroll.scrollTop=pan.sy-(e.clientY-pan.y)*4; });
addEventListener('pointerup',()=>{ if(pan){ pan=null; texScroll.style.cursor=''; } }); }
/* ===================== HUD / coordinate manager ===================== */
let dispIdx=2, rsclIdx=2;
const px=document.getElementById('px'),py=document.getElementById('py'),pz=document.getElementById('pz');
const sx=document.getElementById('sx'),sy=document.getElementById('sy'),sz=document.getElementById('sz');
const rx=document.getElementById('rx'),ry=document.getElementById('ry'),rz=document.getElementById('rz');
const META=new Map([[px,{ch:'pos',i:0}],[py,{ch:'pos',i:1}],[pz,{ch:'pos',i:2}],[sx,{ch:'size',i:0}],[sy,{ch:'size',i:1}],[sz,{ch:'size',i:2}],[rx,{ch:'rot',i:0}],[ry,{ch:'rot',i:1}],[rz,{ch:'rot',i:2}]]);
function fmt(ch,v){ const n=ch==='pos'?3:4; let s=parseFloat(v.toFixed(n)); if(Object.is(s,-0))s=0; return String(s); }
function dispValue(m,T){ if(m.ch==='rot') return [T.e.x,T.e.y,T.e.z][m.i]*R2D_UI;
const mm=m.ch==='pos'?T.p.getComponent(m.i):T.s.getComponent(m.i); return mm/UMM[dispIdx]; }
function toMM(m,v){ return m.ch==='rot'?v:v*UMM[dispIdx]; }
function updateHUD(){ const T=readTransform(coordMode); const a=document.activeElement;
const set=(el,m)=>{ if(el!==a && el!==_scrubActive) el.value=fmt(m.ch,dispValue(m,T)); };
set(px,META.get(px)); set(py,META.get(py)); set(pz,META.get(pz));
set(sx,META.get(sx)); set(sy,META.get(sy)); set(sz,META.get(sz));
set(rx,META.get(rx)); set(ry,META.get(ry)); set(rz,META.get(rz)); }
[px,py,pz,sx,sy,sz,rx,ry,rz].forEach(inp=>{ const m=META.get(inp);
makeScrubInput(inp,{
get:()=>dispValue(m,readTransform(coordMode)),
set:v=>{ applyInput(m.ch,m.i,toMM(m,v)); },
min:-1e9, max:1e9,
snap:coordinateSnapshot,
commit:commitCoordinateSnapshot,
revert:revertCoordinateSnapshot
,deferText:true
}); });
function applySnap(arr){ setGizmoFromMatrixLive(arr); }
const dragInfoEl=document.getElementById('dragInfo');
let vpLastX=0, vpLastY=0;
document.addEventListener('pointermove',e=>{ vpLastX=e.clientX; vpLastY=e.clientY; });
function dragFmt(v,dec){ if(!isFinite(v)) return '—'; const r=+Math.abs(v).toFixed(dec); return (Object.is(r,-0)?0:r).toString(); }
onGizmoDragInfo(o=>{
if(!o){ dragInfoEl.style.display='none'; return; }
let txt='';
if(o.kind==='rot') txt=dragFmt(o.deg,1)+'°';
else if(o.kind==='moveAxis'){ const val=o.mm/UMM[dispIdx]; txt=dragFmt(val,2)+' '+UNITS[dispIdx]; }
else if(o.kind==='scaleAxis'){ const val=o.mm/UMM[dispIdx]; txt=dragFmt(val,2)+' '+UNITS[dispIdx]; }
else if(o.kind==='scaleU'){ const pre=o.approx?'≈':''; txt=pre+'×'+dragFmt(o.k,2); }
if(!txt){ dragInfoEl.style.display='none'; return; }
dragInfoEl.textContent=txt; dragInfoEl.style.display='block';
dragInfoEl.style.left=(vpLastX+16)+'px'; dragInfoEl.style.top=(vpLastY+16)+'px'; });
const tlCurInp=document.getElementById('tlCur'), tlTotalInp=document.getElementById('tlTotal');
let tlCur=0, tlTotal=100;
const tlCurOpts={int:true,sens:8,stepFixed:1,min:0,max:tlTotal,get:()=>tlCur,set:v=>setTimelineFrame(clamp_ui(Math.round(v),0,tlCurOpts.max))};
const tlTotalOpts={int:true,sens:8,stepFixed:1,min:1,max:1000000,get:()=>tlTotal,set:v=>{ tlTotal=Math.max(1,Math.round(v)); tlCurOpts.max=tlTotal; if(tlCur>tlTotal)setTimelineFrame(tlTotal);else syncTimelineInputs(); }};
makeScrubInput(tlCurInp,tlCurOpts);
makeScrubInput(tlTotalInp,tlTotalOpts);
const dV=document.getElementById('dV'), rV=document.getElementById('rV');
function setDisp(i){ dispIdx=clamp_ui(i,0,UNITS.length-1); dV.textContent=UNITS[dispIdx]; setGridStep(1000*UMM[dispIdx]); updateHUD(); }
function setRscl(i){ const ni=clamp_ui(i,0,UNITS.length-1); if(ni===rsclIdx)return; const k=UMM[ni]/UMM[rsclIdx];
rescaleRoots(k); rsclIdx=ni; rV.textContent=UNITS[rsclIdx]; scheduleRender(); }
document.getElementById('dP').onclick=()=>setDisp(dispIdx+1);
document.getElementById('dM').onclick=()=>setDisp(dispIdx-1);
document.getElementById('rP').onclick=()=>setRscl(rsclIdx+1);
document.getElementById('rM').onclick=()=>setRscl(rsclIdx-1);
/* ===================== мост выделение ↔ гизмо ===================== */
let ignoreBridge=false, lastBracketSig=null, gizBeforeObj=null, gizBeforeObjPivot=null, gizBeforeGizmo=null, gizBeforePoly=null, gizBeforePolyGeom=null, gizBeforePolySel=null, gizBeforePolyPivot=null, polyPivotMatrix=null, gizBeforeMulti=null, polyExactEdgeVertices=null, polyExtrudedFaces=null,gizBeforeSpline=null,gizBeforeSplineSel=null,gizBeforeSplinePivot=null,gizBeforeSplineUndo=null,gizBeforeSplineFull=null,splineGizModifiers=null;
var uvMode=false, uvEdit=null, uvBeforeFrame=null;
function ensureTagFrame(tag){ if(!tag.mapFrame)tag.mapFrame=defaultMapFrame(); if(!tag.mapPivot)tag.mapPivot=new THREE.Matrix4(); return tag; }
function syncTagFrame(matHash,tag,tagOwner){
if(!tag)return; ensureTagFrame(tag); const owner=tagOwner||(uvEdit&&uvEdit.tagOwner)||uvEdit?.owner,cache=tag._threeMats;
if(!cache||!cache.size){ applyNodeMaterial(owner); return; }
for(const [meshOwner,t] of cache){ const frame=tagFrameForMesh(tag,owner,meshOwner); t.userData.frameRef=frame; if(t.userData.frameShader)t.userData.frameShader.uniforms.frameMapInv.value.copy(frame).invert(); }
scheduleRender();
}
function uvTarget(){ let owner=null,tag=null,tagOwner=null; if(selTags.size===1){ const id=[...selTags][0],k=id.lastIndexOf(':'); owner=id.slice(0,k); tagOwner=owner; tag=getObj(owner)?.tags[+id.slice(k+1)]||null; } if(!owner)owner=selNodes.size===1?[...selNodes][0]:null; if(!owner)return null;
if(!tag){ const binding=resolveMatBinding(owner); tag=binding.tag; tagOwner=binding.owner; }
if(!tag||!getMat(tag.ref)?.map)return null; return {owner:tagOwner,tagOwner,mat:tag.ref,tag,map:ensureTagFrame(tag)}; }
function uvOwnerWorld(){
if(!uvEdit)return null; const n=getObj(uvEdit.owner); if(!n)return null;
const source=worldMatrix(n),wm=new THREE.Matrix4(); rotMatOfLin(source,wm);
wm.setPosition(source.elements[12],source.elements[13],source.elements[14]);
uvEdit._ownerWorld=wm.clone(); return wm;
}
function uvWorldFrame(){ const wm=uvOwnerWorld(); return wm?wm.multiply(uvEdit.map.mapFrame):null; }
function uvVirtualWorld(){ const frame=uvWorldFrame(); return frame?frame.multiply(uvEdit.map.mapPivot).multiply(new THREE.Matrix4().makeScale(1/UV_PROXY_SIZE,1/UV_PROXY_SIZE,1/UV_PROXY_SIZE)):null; }
function applyUvVirtualWorld(world){ if(!uvEdit)return; const ownerWorld=uvOwnerWorld(); if(!ownerWorld)return; const local=ownerWorld.invert().multiply(world); uvEdit.map.mapFrame=local.multiply(new THREE.Matrix4().makeScale(UV_PROXY_SIZE,UV_PROXY_SIZE,UV_PROXY_SIZE)).multiply(uvEdit.map.mapPivot.clone().invert()); if(!uvFrameCollapsed(uvEdit.map.mapFrame)){uvEdit.map._uvLastFrame=uvEdit.map.mapFrame.clone();rememberUvScale(uvEdit.map);} syncTagFrame(uvEdit.mat,uvEdit.tag); syncUvFrame(); }
function syncUvFrame(){ const wm=uvWorldFrame(); if(!uvFrameLines)return; uvFrameLines.visible=!!wm; if(wm){ uvFrameLines.matrix.copy(wm); uvFrameLines.updateMatrixWorld(true); } }
function uvFrameCollapsed(m){ const e=m.elements; return [0,4,8].some(i=>Math.hypot(e[i],e[i+1],e[i+2])<=MIN_COL*2); }
function restoreUvFrameForScale(){ if(!uvEdit||!uvFrameCollapsed(uvEdit.map.mapFrame))return; const saved=uvEdit.map._uvLastFrame; uvEdit.map.mapFrame=(saved?saved.clone():defaultMapFrame()); syncTagFrame(uvEdit.mat); placeGizmoForSelection(); }
function rememberUvScale(map){ const e=map.mapFrame.elements; map._uvLastScale=[Math.hypot(e[0],e[1],e[2]),Math.hypot(e[4],e[5],e[6]),Math.hypot(e[8],e[9],e[10])]; }
function syncUvEditing(){ const target=uvTarget(); uvEdit=target; if(target){ uvOwnerWorld(); floorWmCols(target.map.mapFrame); if(!uvFrameCollapsed(target.map.mapFrame)){target.map._uvLastFrame=target.map.mapFrame.clone();rememberUvScale(target.map);} syncTagFrame(target.mat,target.tag); } if(!target&&uvFrameLines)uvFrameLines.visible=false; setGizmoVisible(!!target||(polyMode?polySelection.items.size>0:selNodes.size>0)); syncUvFrame(); placeGizmoForSelection(); scheduleRender(); }
function setUvEdit(on){ const b=document.getElementById('btnUV'); uvMode=on; b.classList.toggle('on',on); if(!on){ uvEdit=null; if(uvFrameLines)uvFrameLines.visible=false; setGizmoVisible(polyMode?polySelection.items.size>0:selNodes.size>0); placeGizmoForSelection(); scheduleRender(); return; } syncUvEditing(); }
function mat4Close(a,b){ for(let i=0;i<16;i++) if(Math.abs(a[i]-b[i])>1e-4) return false; return true; }
function setGizmoFromMatrix(arr){ ignoreBridge=true; setGizmoMatrix(arr); ignoreBridge=false; }
function setGizmoFromMatrixLive(arr){ setGizmoMatrix(arr); }
function polySelectedVertexIds(h){ const s=polySelection.items.get(h),mesh=pickMeshes.get(h),g=mesh&&mesh.geometry,idx=g&&g.index;
const out=new Set(); if(!s||!g)return out;
if(polyExactEdgeVertices?.has(h))return new Set(polyExactEdgeVertices.get(h));
for(const i of s.vertices)out.add(i);
for(const key of s.edges){ const [a,b]=key.split(':').map(Number); coincidentVertexIds(mesh,a).forEach(v=>out.add(v));coincidentVertexIds(mesh,b).forEach(v=>out.add(v)); }
for(const fi of s.faces)for(let j=0;j<3;j++)coincidentVertexIds(mesh,idx?idx.getX(fi*3+j):fi*3+j).forEach(v=>out.add(v));
return out; }
function extrudeSelectedEdgesForDrag(){
const exact=new Map(),oriented=new Map();let changed=false;
for(const [h,s] of polySelection.items){const mesh=pickMeshes.get(h),g=mesh?.geometry,pos=g?.attributes.position;if(!pos||!s.edges.size)continue;
const edges=logicalEdges(g).filter(edge=>edge.keys.some(k=>s.edges.has(k)));if(!edges.length)continue;
const tris=meshTriangles(mesh),sourceCount=tris.length,key=i=>`${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`,edgeInfo=(edge)=>{const ka=key(edge.a),kb=key(edge.b),desired=new THREE.Vector3();let mat=0,found=false;for(const tri of tris.slice(0,sourceCount)){const ks=tri.v.map(v=>`${v.p.x.toFixed(5)},${v.p.y.toFixed(5)},${v.p.z.toFixed(5)}`);if(!ks.includes(ka)||!ks.includes(kb))continue;if(!found)mat=tri.mat;found=true;desired.add(tri.v[1].p.clone().sub(tri.v[0].p).cross(tri.v[2].p.clone().sub(tri.v[0].p)).normalize());}if(desired.lengthSq()<1e-12)desired.set(0,1,0);else desired.normalize();return {mat,desired};},selected=new Set(),edgeKeys=[],faceRecords=[];
for(let n=0;n<edges.length;n++){const edge=edges[n],a={p:new THREE.Vector3().fromBufferAttribute(pos,edge.a),uv:g.attributes.uv?new THREE.Vector2().fromBufferAttribute(g.attributes.uv,edge.a):null},b={p:new THREE.Vector3().fromBufferAttribute(pos,edge.b),uv:g.attributes.uv?new THREE.Vector2().fromBufferAttribute(g.attributes.uv,edge.b):null},info=edgeInfo(edge),mat=info.mat,base=(sourceCount+n*2)*3;
tris.push({v:[cloneTriVertex(a),cloneTriVertex(b),cloneTriVertex(b)],mat},{v:[cloneTriVertex(a),cloneTriVertex(b),cloneTriVertex(a)],mat});
selected.add(base+2);selected.add(base+4);selected.add(base+5);edgeKeys.push(polyEdgeKey(base+4,base+5));faceRecords.push({faces:[sourceCount+n*2,sourceCount+n*2+1],desired:info.desired});}
const old=mesh.geometry;mesh.geometry=makeGeometryFromTriangles(tris,!!g.attributes.uv);old.dispose();refreshWireOverlay(mesh);s.vertices.clear();s.faces.clear();s.edges=new Set(edgeKeys);exact.set(h,selected);if(faceRecords.length)oriented.set(h,faceRecords);changed=true;}
if(changed){polyExactEdgeVertices=exact;polyExtrudedFaces=oriented;rebuildPolySelection(true);}return changed;
}
function extrudeSelectedFacesForDrag(){
const exact=new Map();let changed=false;
for(const [h,s] of polySelection.items){const mesh=pickMeshes.get(h),g=mesh?.geometry;if(!g||!s.faces.size)continue;const tris=meshTriangles(mesh),selected=tris.filter(t=>s.faces.has(t.sourceFace)),out=tris.filter(t=>!s.faces.has(t.sourceFace));if(!selected.length)continue;const edgeMap=new Map();for(const tri of selected)for(let i=0;i<3;i++){const a=tri.v[i],b=tri.v[(i+1)%3],k=localEdgeKey(a.p,b.p),r=edgeMap.get(k);if(r)r.count++;else edgeMap.set(k,{a:cloneTriVertex(a),b:cloneTriVertex(b),mat:tri.mat,count:1});}const ids=new Set(),topFaces=[];for(const tri of selected){const fi=out.length;out.push({v:tri.v.map(cloneTriVertex),mat:tri.mat});topFaces.push(fi);ids.add(fi*3);ids.add(fi*3+1);ids.add(fi*3+2);}for(const e of edgeMap.values())if(e.count===1){let fi=out.length;out.push({v:[cloneTriVertex(e.a),cloneTriVertex(e.b),cloneTriVertex(e.b)],mat:e.mat});ids.add(fi*3+2);fi=out.length;out.push({v:[cloneTriVertex(e.a),cloneTriVertex(e.b),cloneTriVertex(e.a)],mat:e.mat});ids.add(fi*3+1);ids.add(fi*3+2);}const old=mesh.geometry;mesh.geometry=makeGeometryFromTriangles(out,!!g.attributes.uv);old.dispose();refreshWireOverlay(mesh);s.vertices.clear();s.edges.clear();s.faces=new Set(topFaces);exact.set(h,ids);changed=true;}
if(changed){polyExactEdgeVertices=exact;polyExtrudedFaces=null;rebuildPolySelection(true);}return changed;
}
function extrudeSelectedForDrag(){return polyElementMode==='edge'?extrudeSelectedEdgesForDrag():polyElementMode==='face'?extrudeSelectedFacesForDrag():false;}
function orientExtrudedFaces(){if(!polyExtrudedFaces)return;for(const [h,records] of polyExtrudedFaces){const g=pickMeshes.get(h)?.geometry,pos=g?.attributes.position,idx=g?.index;if(!pos||!idx)continue;const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();for(const rec of records){const fi=rec.faces[0],ia=idx.getX(fi*3),ib=idx.getX(fi*3+1),ic=idx.getX(fi*3+2);a.fromBufferAttribute(pos,ia);b.fromBufferAttribute(pos,ib);c.fromBufferAttribute(pos,ic);const n=b.clone().sub(a).cross(c.clone().sub(a));if(n.lengthSq()<1e-14||n.dot(rec.desired)>=0)continue;for(const f of rec.faces){const j=f*3,x=idx.getX(j+1);idx.setX(j+1,idx.getX(j+2));idx.setX(j+2,x);}}idx.needsUpdate=true;g.computeVertexNormals();}polyExtrudedFaces=null;}
function polyOwnerHash(){for(const h of polySelection.items.keys())if(pickMeshes.has(h))return h;return selNodes.values().next().value||null;}
function pureWorldFrame(h){const n=h&&OBJ.get(h),w=n?worldMatrix(n):new THREE.Matrix4(),r=new THREE.Matrix4();rotMatOfLin(w,r);r.setPosition(w.elements[12],w.elements[13],w.elements[14]);return r;}
function polyWorldPoints(){const out=[],p=new THREE.Vector3();for(const [h] of polySelection.items){const mesh=pickMeshes.get(h),pos=mesh?.geometry?.attributes.position;if(!pos)continue;mesh.updateMatrixWorld(true);for(const i of polySelectedVertexIds(h))out.push(p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).clone());}return out;}
function polyExtentInFrame(frame){const inv=frame.clone().invert(),mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity);let any=false;for(const p of polyWorldPoints()){p.applyMatrix4(inv);mn.min(p);mx.max(p);any=true;}return any?mx.sub(mn):new THREE.Vector3();}
function basisFromNormal(normal,ownerRot){const z=normal.clone().normalize(),oe=ownerRot.elements,candidates=[new THREE.Vector3(oe[0],oe[1],oe[2]),new THREE.Vector3(oe[4],oe[5],oe[6]),new THREE.Vector3(oe[8],oe[9],oe[10])];let x=null,best=-1;for(const a of candidates){const q=a.clone().addScaledVector(z,-a.dot(z)),d=q.lengthSq();if(d>best){best=d;x=q;}}x.normalize();const y=z.clone().cross(x).normalize();x.copy(y).cross(z).normalize();return new THREE.Matrix4().makeBasis(x,y,z);}
function faceSelectionBasis(h,ownerRot){if(polyElementMode!=='face'||polySelection.items.size!==1)return null;const s=polySelection.items.get(h),mesh=pickMeshes.get(h),g=mesh?.geometry,pos=g?.attributes.position,idx=g?.index;if(!s?.faces.size||!pos)return null;mesh.updateMatrixWorld(true);const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3(),normal=new THREE.Vector3(),points=[];let refNormal=null,refPoint=null;for(const fi of s.faces){const ids=[idx?idx.getX(fi*3):fi*3,idx?idx.getX(fi*3+1):fi*3+1,idx?idx.getX(fi*3+2):fi*3+2];a.fromBufferAttribute(pos,ids[0]).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(pos,ids[1]).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(pos,ids[2]).applyMatrix4(mesh.matrixWorld);normal.copy(ab.subVectors(b,a)).cross(ac.subVectors(c,a));if(normal.lengthSq()<1e-16)return null;normal.normalize();if(!refNormal){refNormal=normal.clone();refPoint=a.clone();}else{if(normal.dot(refNormal)<0)normal.negate();if(normal.dot(refNormal)<.9999)return null;}points.push(a.clone(),b.clone(),c.clone());}let span=0;for(const p of points)span=Math.max(span,p.distanceTo(refPoint));const tol=Math.max(1e-5,span*1e-5);for(const p of points)if(Math.abs(p.clone().sub(refPoint).dot(refNormal))>tol)return null;return basisFromNormal(refNormal,ownerRot);}
function edgeSelectionBasis(h,ownerRot){if(polyElementMode!=='edge'||polySelection.items.size!==1)return null;const s=polySelection.items.get(h),mesh=pickMeshes.get(h),pos=mesh?.geometry?.attributes.position;if(!s?.edges.size||!pos)return null;mesh.updateMatrixWorld(true);const chosen=logicalEdges(mesh.geometry).filter(e=>e.keys.some(k=>s.edges.has(k)));if(!chosen.length)return null;const a=new THREE.Vector3(),b=new THREE.Vector3(),dir=new THREE.Vector3(),points=[];let refDir=null,refPoint=null;for(const edge of chosen){a.fromBufferAttribute(pos,edge.a).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(pos,edge.b).applyMatrix4(mesh.matrixWorld);dir.subVectors(b,a);if(dir.lengthSq()<1e-16)continue;dir.normalize();if(!refDir){refDir=dir.clone();refPoint=a.clone();}else{if(dir.dot(refDir)<0)dir.negate();if(dir.dot(refDir)<.9999)return null;}points.push(a.clone(),b.clone());}if(!refDir)return null;const oe=ownerRot.elements,ownerX=new THREE.Vector3(oe[0],oe[1],oe[2]);if(refDir.dot(ownerX)<0)refDir.negate();let span=0;for(const p of points)span=Math.max(span,p.distanceTo(refPoint));const tol=Math.max(1e-5,span*1e-5);for(const p of points){const d=p.clone().sub(refPoint),along=refDir.clone().multiplyScalar(d.dot(refDir));if(d.sub(along).length()>tol)return null;}const ownerY=new THREE.Vector3(oe[4],oe[5],oe[6]),ownerZ=new THREE.Vector3(oe[8],oe[9],oe[10]);let y=ownerY.addScaledVector(refDir,-ownerY.dot(refDir));if(y.lengthSq()<1e-10)y=ownerZ.addScaledVector(refDir,-ownerZ.dot(refDir));y.normalize();const z=refDir.clone().cross(y).normalize();y=z.clone().cross(refDir).normalize();return new THREE.Matrix4().makeBasis(refDir,y,z);}
function polyAutoBasis(){if(coordMode==='world')return new THREE.Matrix4();const h=polyOwnerHash(),owner=pureWorldFrame(h),special=faceSelectionBasis(h,owner)||edgeSelectionBasis(h,owner);return special||owner;}
function polyFrameMatrix(){const bb=polySelectionBounds();if(!bb)return new THREE.Matrix4();const p=polyPivotMatrix?new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(polyPivotMatrix)):bb.min.clone().add(bb.max).multiplyScalar(.5);let basis;if(polyPivotMatrix&&coordMode==='object'){basis=new THREE.Matrix4().fromArray(polyPivotMatrix);rotMatOfLin(basis,basis);basis.setPosition(0,0,0);}else basis=polyAutoBasis();basis.setPosition(p);return basis;}
function polyCoordReference(mode){return mode==='world'?new THREE.Matrix4():pureWorldFrame(polyOwnerHash());}
function readPolyTransform(mode){const world=polyFrameMatrix(),ref=polyCoordReference(mode),local=ref.clone().invert().multiply(world),lin=local.clone();lin.elements[12]=lin.elements[13]=lin.elements[14]=0;rotMatOfLin(lin,_RM);const e=new THREE.Euler().setFromRotationMatrix(_RM),p=new THREE.Vector3().setFromMatrixPosition(local),s=polyExtentInFrame(world);return {p,s,e};}
function setPureGizmoFrame(world){const p=new THREE.Vector3().setFromMatrixPosition(world),m=world.clone();rotMatOfLin(m,m);m.setPosition(p);setGizmoFromMatrix(m.elements);}
function applyPolyCoordinateInput(ch,i,v,mode){const old=polyFrameMatrix(),desired=old.clone();if(ch==='pos'){if(mode==='world')desired.elements[12+i]=v;else{const ref=polyCoordReference(mode),lp=new THREE.Vector3().setFromMatrixPosition(ref.clone().invert().multiply(old));lp.setComponent(i,v);desired.setPosition(lp.applyMatrix4(ref));}}else if(ch==='rot'){const ref=polyCoordReference(mode),local=ref.clone().invert().multiply(old),r=new THREE.Matrix4();rotMatOfLin(local,r);const e=new THREE.Euler().setFromRotationMatrix(r);if(i===0)e.x=v*D2R;else if(i===1)e.y=v*D2R;else e.z=v*D2R;r.makeRotationFromEuler(e);const wr=ref.clone();rotMatOfLin(wr,wr);desired.copy(wr.multiply(r));desired.setPosition(old.elements[12],old.elements[13],old.elements[14]);}else{const size=polyExtentInFrame(old),cur=Math.max(size.getComponent(i),MIN_COL),factor=Math.max(MIN_COL,Math.abs(v))/cur,scaled=old.clone(),e=scaled.elements,k=i*4;e[k]*=factor;e[k+1]*=factor;e[k+2]*=factor;desired.copy(scaled);}const delta=desired.clone().multiply(old.clone().invert()),snap=capturePolySelection();applyPolyDelta(delta,snap);const finalFrame=desired.clone();if(ch==='size'){rotMatOfLin(old,finalFrame);finalFrame.setPosition(old.elements[12],old.elements[13],old.elements[14]);}polyPivotMatrix=finalFrame.elements.slice();setPureGizmoFrame(finalFrame);updateHUD();}
function polySelectionBounds(){ const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity),p=new THREE.Vector3(); let any=false;
for(const [h] of polySelection.items){ const mesh=pickMeshes.get(h),pos=mesh&&mesh.geometry&&mesh.geometry.attributes.position;if(!pos)continue; mesh.updateMatrixWorld(true);
for(const i of polySelectedVertexIds(h)){ p.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld); mn.min(p);mx.max(p);any=true; } }
return any?{min:mn,max:mx}:null; }
function capturePolySelection(){ const out=new Map();
for(const [h] of polySelection.items){ const mesh=pickMeshes.get(h),pos=mesh&&mesh.geometry&&mesh.geometry.attributes.position,soft=vertexTools.soft.active&&polyElementMode==='vertex'?vertexTools.soft.weights.get(h):null,ids=soft&&soft.length===pos?.count?[...Array(pos.count).keys()].filter(i=>soft[i]>0):[...polySelectedVertexIds(h)]; if(!pos||!ids.length)continue;
const values=new Float32Array(ids.length*3),weights=soft?new Float32Array(ids.map(i=>soft[i])):null; ids.forEach((i,k)=>{ values[k*3]=pos.getX(i);values[k*3+1]=pos.getY(i);values[k*3+2]=pos.getZ(i); }); out.set(h,{ids,values,weights}); }
return out; }
function capturePolySelectionState(){const out=new Map();for(const [h,s] of polySelection.items)out.set(h,{vertices:new Set(s.vertices),edges:new Set(s.edges),faces:new Set(s.faces)});return out;}
function restorePolySelectionState(state){polySelection.items.clear();for(const [h,s] of state)polySelection.items.set(h,{vertices:new Set(s.vertices),edges:new Set(s.edges),faces:new Set(s.faces)});rebuildPolySelection(true);}
function capturePolyLogicalSelection(){const out=new Map();for(const [h,s] of polySelection.items){const mesh=pickMeshes.get(h),pos=mesh?.geometry?.attributes.position;if(!pos)continue;const key=i=>`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`,vertices=new Set([...s.vertices].map(key)),edges=new Set();for(const edgeKey of s.edges){const [a,b]=edgeKey.split(':').map(Number),ka=key(a),kb=key(b);edges.add(ka<kb?`${ka}|${kb}`:`${kb}|${ka}`);}out.set(h,{vertices,edges,faces:new Set(s.faces)});}return out;}
function restorePolyLogicalSelection(state){polySelection.items.clear();for(const [h,s] of state){const mesh=pickMeshes.get(h),geometry=mesh?.geometry,pos=geometry?.attributes.position;if(!pos)continue;const entry={vertices:new Set(),edges:new Set(),faces:new Set(s.faces)},key=i=>`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;for(const group of logicalVertexGroups(geometry))if(s.vertices.has(key(group[0])))group.forEach(i=>entry.vertices.add(i));for(const edge of logicalEdges(geometry)){const ka=key(edge.a),kb=key(edge.b),logicalKey=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;if(s.edges.has(logicalKey))edge.keys.forEach(k=>entry.edges.add(k));}if(entry.vertices.size||entry.edges.size||entry.faces.size)polySelection.items.set(h,entry);}}
function capturePolyGeometries(hashes=polySelection.items.keys()){
const out=new Map();for(const h of hashes){const m=pickMeshes.get(h),g=m&&m.geometry;if(!g)continue;
const attrs={};for(const name of ['position','normal','uv']){const a=g.attributes[name];if(a)attrs[name]={array:a.array.slice(),itemSize:a.itemSize,normalized:a.normalized};}
out.set(h,{attrs,index:g.index?g.index.array.slice():null,groups:g.groups.map(x=>({...x}))});}return out;}
function coordinateSnapshot(){
if(splineFocusActive()){const owners=splineSelectionOwners(),full=!editPivot?captureSplineFullState(owners):null,selection=splineSelectionState();if(!editPivot)autoBakeSplineTags(owners);const state={kind:'spline',full,data:splineDataSnapshot(),selection,pivot:splineSelection.pivot&&splineSelection.pivot.slice(),gizmo:getGizmoWorldArray(),editPivot:!!editPivot,owners};gizBeforeGizmo=state.gizmo.slice();gizBeforeSplineSel=state.selection;gizBeforeSplinePivot=state.pivot&&state.pivot.slice();gizBeforeSplineUndo=state.data;gizBeforeSplineFull=state.full;gizBeforeSpline=state.data;splineGizModifiers={ctrl:false,shift:false};return state;}
if(!polyMode||!polySelection.items.size)return getGizmoWorldArray();return {kind:'poly',geometry:capturePolyGeometries(),selection:capturePolySelectionState(),pivot:polyPivotMatrix&&polyPivotMatrix.slice()};}
function polyCoordStateChanged(a,b){if(a.geometry.size!==b.geometry.size)return true;for(const [h,x] of a.geometry){const y=b.geometry.get(h),xa=x.attrs.position?.array,ya=y?.attrs.position?.array;if(!ya||xa.length!==ya.length)return true;for(let i=0;i<xa.length;i++)if(Math.abs(xa[i]-ya[i])>1e-5)return true;}return false;}
function restorePolyCoordState(state){polyPivotMatrix=state.pivot&&state.pivot.slice();restorePolyGeometries(state.geometry);restorePolySelectionState(state.selection);}
function clearSplineCoordinateBridge(){gizBeforeSpline=null;gizBeforeSplineUndo=null;gizBeforeSplineFull=null;gizBeforeSplineSel=null;gizBeforeSplinePivot=null;gizBeforeGizmo=null;splineGizModifiers=null;splineWeldCandidate=null;}
function commitCoordinateSnapshot(before){if(before?.kind==='spline'){const afterGizmo=getGizmoWorldArray();if(before.editPivot){const afterPivot=afterGizmo.slice();splineSelection.pivot=afterPivot.slice();if(!mat4Close(before.pivot||before.gizmo,afterPivot))pushCmd({redo(){splineSelection.pivot=afterPivot.slice();placeGizmoForSelection();},undo(){splineSelection.pivot=before.pivot&&before.pivot.slice();placeGizmoForSelection();}});}else{const after={full:captureSplineFullState(before.owners),selection:splineSelectionState()};if(JSON.stringify([...before.full])!==JSON.stringify([...after.full])||JSON.stringify(before.selection)!==JSON.stringify(after.selection))pushCmd({redo(){restoreSplineFullState(after.full,after.selection);},undo(){restoreSplineFullState(before.full,before.selection);}});}clearSplineCoordinateBridge();updateAllSplineVisuals();placeGizmoForSelection();return;}if(before?.kind!=='poly'){const after=getGizmoWorldArray();if(mat4Close(before,after))return;pushCmd({redo(){applySnap(after);},undo(){applySnap(before);}});return;}const logical=capturePolyLogicalSelection();for(const h of polySelection.items.keys()){const oldSoft=vertexTools.soft.weights.get(h),remap=rebuildCreaseRender(pickMeshes.get(h));remapSoftAfterTopology(h,oldSoft,remap);}restorePolyLogicalSelection(logical);rebuildPolySelection(false);const after={kind:'poly',geometry:capturePolyGeometries(),selection:capturePolySelectionState(),pivot:polyPivotMatrix&&polyPivotMatrix.slice()};if(!polyCoordStateChanged(before,after)){placeGizmoForSelection();return;}pushCmd({redo(){restorePolyCoordState(after);},undo(){restorePolyCoordState(before);}});placeGizmoForSelection();}
function revertCoordinateSnapshot(before){if(before?.kind==='spline'){if(before.editPivot)splineSelection.pivot=before.pivot&&before.pivot.slice();else restoreSplineFullState(before.full,before.selection);clearSplineCoordinateBridge();setGizmoFromMatrix(before.gizmo);placeGizmoForSelection();}else if(before?.kind==='poly')restorePolyCoordState(before);else applySnap(before);}
function restorePolyGeometries(s){for(const [h,state] of s){const m=pickMeshes.get(h);if(!m)continue;const g=new THREE.BufferGeometry();
for(const [name,a] of Object.entries(state.attrs))g.setAttribute(name,new THREE.BufferAttribute(a.array.slice(),a.itemSize,a.normalized));
if(state.index)g.setIndex(new THREE.BufferAttribute(state.index.slice(),1));for(const x of state.groups)g.addGroup(x.start,x.count,x.materialIndex);g.computeBoundingBox();
const old=m.geometry;m.geometry=g;old.dispose();refreshWireOverlay(m);}rebuildPolySelection(false);scheduleRender();}
function selectAllPolyElements(){
  polyPivotMatrix=null;polySelection.items.clear();
  for(const h of selNodes){const mesh=pickMeshes.get(h),g=mesh?.geometry,pos=g?.attributes.position,idx=g?.index;if(!pos)continue;const s=polySelEntry(h);
    if(polyElementMode==='vertex')for(let i=0;i<pos.count;i++)s.vertices.add(i);
    else if(polyElementMode==='edge')for(const edge of logicalEdges(g))for(const key of edge.keys)s.edges.add(key);
    else {const faces=idx?idx.count/3:pos.count/3;for(let fi=0;fi<faces;fi++)s.faces.add(fi);}
  }
  rebuildPolySelection();
}
function triangleMaterialIndex(g,fi){const offset=fi*3;for(const group of g.groups)if(offset>=group.start&&offset<group.start+group.count)return group.materialIndex;return 0;}
function geometryWithoutSelected(mesh,s){
  const g=mesh.geometry,pos=g.attributes.position,idx=g.index,faces=idx?idx.count/3:pos.count/3,dropVertices=new Set(),dropEdges=new Set(),dropFaces=new Set();
  if(polyElementMode==='vertex')for(const vi of s.vertices)coincidentVertexIds(mesh,vi).forEach(v=>dropVertices.add(v));
  else if(polyElementMode==='edge')for(const key of s.edges)dropEdges.add(key);
  else for(const fi of s.faces)dropFaces.add(fi);
  const kept=[];for(let fi=0;fi<faces;fi++){const ids=[idx?idx.getX(fi*3):fi*3,idx?idx.getX(fi*3+1):fi*3+1,idx?idx.getX(fi*3+2):fi*3+2];let drop=dropFaces.has(fi)||ids.some(v=>dropVertices.has(v));if(!drop&&dropEdges.size)for(let j=0;j<3;j++)if(dropEdges.has(polyEdgeKey(ids[j],ids[(j+1)%3]))){drop=true;break;}if(!drop)kept.push({ids,materialIndex:triangleMaterialIndex(g,fi)});}
  if(kept.length===faces)return null;
  const used=new Map(),oldIds=[];for(const tri of kept)for(const vi of tri.ids)if(!used.has(vi)){used.set(vi,used.size);oldIds.push(vi);}
  const ng=new THREE.BufferGeometry();for(const [name,attr] of Object.entries(g.attributes)){const array=new attr.array.constructor(oldIds.length*attr.itemSize);for(let ni=0;ni<oldIds.length;ni++){const oi=oldIds[ni];for(let k=0;k<attr.itemSize;k++)array[ni*attr.itemSize+k]=attr.array[oi*attr.itemSize+k];}ng.setAttribute(name,new THREE.BufferAttribute(array,attr.itemSize,attr.normalized));}
  const outIndex=new Uint32Array(kept.length*3);let lastMat=null,groupStart=0;for(let fi=0;fi<kept.length;fi++){const tri=kept[fi];for(let j=0;j<3;j++)outIndex[fi*3+j]=used.get(tri.ids[j]);if(lastMat===null){lastMat=tri.materialIndex;groupStart=fi*3;}else if(tri.materialIndex!==lastMat){ng.addGroup(groupStart,fi*3-groupStart,lastMat);lastMat=tri.materialIndex;groupStart=fi*3;}}if(lastMat!==null)ng.addGroup(groupStart,outIndex.length-groupStart,lastMat);
  ng.setIndex(new THREE.BufferAttribute(outIndex,1));if(ng.attributes.position.count){ng.computeVertexNormals();ng.computeBoundingBox();}return ng;
}
function deleteSelectedPolyElements(){
  const hashes=[...polySelection.items.keys()],beforeGeom=capturePolyGeometries(hashes),beforeSel=capturePolySelectionState();let changed=false;
  for(const h of hashes){const mesh=pickMeshes.get(h),s=polySelection.items.get(h);if(!mesh||!s)continue;const ng=geometryWithoutSelected(mesh,s);if(!ng)continue;const old=mesh.geometry;mesh.geometry=ng;old.dispose();if(ng.index?.count)rebuildCreaseRender(mesh);refreshWireOverlay(mesh);changed=true;}
  if(!changed)return;const afterGeom=capturePolyGeometries(hashes),emptySel=new Map();polyPivotMatrix=null;polySelection.items.clear();clearPolyHover();rebuildPolySelection();
  pushCmd({redo(){polyPivotMatrix=null;restorePolyGeometries(afterGeom);restorePolySelectionState(emptySel);},undo(){polyPivotMatrix=null;restorePolyGeometries(beforeGeom);restorePolySelectionState(beforeSel);}});
}
function applyPolySnapshot(snap){ for(const [h,rec] of snap){ const mesh=pickMeshes.get(h),g=mesh&&mesh.geometry,pos=g&&g.attributes.position;if(!pos)continue;
rec.ids.forEach((i,k)=>pos.setXYZ(i,rec.values[k*3],rec.values[k*3+1],rec.values[k*3+2])); pos.needsUpdate=true; g.computeVertexNormals(); rebuildCreaseRender(mesh); refreshWireOverlay(mesh); }
rebuildPolySelection(false); }
function polySnapshotsClose(a,b){ if(!a||!b||a.size!==b.size)return false; for(const [h,ra] of a){ const rb=b.get(h);if(!rb||ra.ids.length!==rb.ids.length)return false; for(let i=0;i<ra.values.length;i++)if(Math.abs(ra.values[i]-rb.values[i])>1e-4)return false; } return true; }
function applyPolyDelta(delta,snap){ const p=new THREE.Vector3(); for(const [h,rec] of snap){ const mesh=pickMeshes.get(h),g=mesh&&mesh.geometry,pos=g&&g.attributes.position;if(!pos)continue;
mesh.updateMatrixWorld(true); const inv=mesh.matrixWorld.clone().invert(),base=new THREE.Vector3(),moved=new THREE.Vector3(); rec.ids.forEach((i,k)=>{base.set(rec.values[k*3],rec.values[k*3+1],rec.values[k*3+2]);moved.copy(base).applyMatrix4(mesh.matrixWorld).applyMatrix4(delta).applyMatrix4(inv);p.copy(base).lerp(moved,rec.weights?rec.weights[k]:1);pos.setXYZ(i,p.x,p.y,p.z); }); pos.needsUpdate=true; g.computeVertexNormals(); refreshWireOverlay(mesh); }
if(vertexTools.soft.active)updateSoftPreview();
rebuildPolySelection(false); }
function splineSelectedRefs(){const vertices=[],handles=[],segments=[];for(const key of splineSelection.vertices){const r=parseSplineElementKey(key);vertices.push(r);}for(const key of splineSelection.handles){const r=parseSplineElementKey(key),q=parseSplineHandleKey(r.id);handles.push({object:r.object,...q});}for(const key of splineSelection.segments){const r=parseSplineElementKey(key);segments.push(r);}return {vertices,handles,segments};}
function splineSelectionWorldPoints(){const refs=splineSelectedRefs(),out=[];if(refs.vertices.length||refs.segments.length){for(const r of refs.vertices){const p=evaluatedSplineData(r.object)?.vertices[r.id];if(p)out.push(splineWorldPoint(r.object,p));}for(const r of refs.segments){const d=evaluatedSplineData(r.object),p=d&&SPLINE.segmentPoints(d,r.id);if(p)out.push(splineWorldPoint(r.object,SPLINE.cubicPoint(p,.5)));}return out;}for(const r of refs.handles){const d=evaluatedSplineData(r.object),info=d&&splineHandleInfo(d,r.segment,r.side);if(!info)continue;out.push(splineWorldPoint(r.object,SPLINE.splineMath.add(d.vertices[info.vertex],info.vector)));}return out;}
function splineDirectionWorld(ref){const d=evaluatedSplineData(ref.object),wm=splineWorldMatrix(ref.object),dir=new THREE.Vector3(1,0,0);if(!d)return dir;if(ref.kind==='handle'){const info=splineHandleInfo(d,ref.id,ref.side);if(info)dir.fromArray(info.vector);}else if(ref.kind==='segment'){const p=SPLINE.segmentPoints(d,ref.id);if(p)dir.fromArray(SPLINE.cubicDerivative(p,.5));}else if(ref.kind==='vertex'){const incident=Object.values(d.segments).filter(s=>s.a===ref.id||s.b===ref.id);let best=null,bestLen=0;for(const s of incident){const v=s.a===ref.id?s.ha:SPLINE.splineMath.mul(s.hb,-1),n=SPLINE.splineMath.len(v);if(n>bestLen){bestLen=n;best=v;}}if(best)dir.fromArray(best);else if(incident.length){const s=incident[0],other=d.vertices[s.a===ref.id?s.b:s.a],here=d.vertices[ref.id];if(other&&here)dir.fromArray(SPLINE.splineMath.sub(other,here));}}if(dir.lengthSq()<1e-12)dir.set(1,0,0);return dir.transformDirection(wm).normalize();}
function splineObjectFrame(h){const w=splineWorldMatrix(h),m=new THREE.Matrix4();rotMatOfLin(w,m);return m;}
function deterministicSplineWorldPlane(sourcePoints,owner=null){const points=[];for(const p of sourcePoints||[])if(p?.isVector3&&!points.some(q=>q.distanceToSquared(p)<1e-14))points.push(p.clone());if(points.length<2)return null;let a=points[0],b=points[1],scale=0;for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const d=points[i].distanceTo(points[j]);if(d>scale){scale=d;a=points[i];b=points[j];}}if(scale<1e-8)return null;const axis=b.clone().sub(a).normalize(),origin=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/points.length);let normal=null,best=0;for(const p of points){const c=new THREE.Vector3().crossVectors(axis,p.clone().sub(a)),n=c.length();if(n>best){best=n;normal=c.multiplyScalar(1/n);}}if(!normal||best<Math.max(1e-8,scale*1e-8)){const frame=splineObjectFrame(owner),e=frame.elements,candidates=[new THREE.Vector3(e[8],e[9],e[10]),new THREE.Vector3(e[4],e[5],e[6]),new THREE.Vector3(e[0],e[1],e[2]),new THREE.Vector3(0,0,1),new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0)].map(v=>v.normalize()).sort((x,y)=>Math.abs(axis.dot(x))-Math.abs(axis.dot(y))),ref=candidates[0];normal=ref.clone().addScaledVector(axis,-ref.dot(axis)).normalize();}else {let dominant='x';if(Math.abs(normal.y)>Math.abs(normal[dominant]))dominant='y';if(Math.abs(normal.z)>Math.abs(normal[dominant]))dominant='z';if(normal[dominant]<0)normal.negate();}const tolerance=Math.max(1e-6,scale*1e-6),maxError=Math.max(...points.map(p=>Math.abs(p.clone().sub(origin).dot(normal))));return {origin,normal,axis,scale,tolerance,maxError,planar:maxError<=tolerance,collinear:best<Math.max(1e-8,scale*1e-8)};}
function splineSelectionPlane(){const refs=splineSelectedRefs(),points=[],owners=[];for(const r of refs.segments){const d=evaluatedSplineData(r.object),p=d&&SPLINE.segmentPoints(d,r.id),wm=splineWorldMatrix(r.object);if(!p)continue;owners.push(r.object);for(const q of p)points.push(new THREE.Vector3().fromArray(q).applyMatrix4(wm));}for(const r of refs.vertices){const d=evaluatedSplineData(r.object),p=d?.vertices[r.id];if(p){owners.push(r.object);points.push(splineWorldPoint(r.object,p));}}for(const r of refs.handles){const d=evaluatedSplineData(r.object),info=d&&splineHandleInfo(d,r.segment,r.side);if(info){owners.push(r.object);points.push(splineWorldPoint(r.object,d.vertices[info.vertex]),splineWorldPoint(r.object,SPLINE.splineMath.add(d.vertices[info.vertex],info.vector)));}}const plane=deterministicSplineWorldPlane(points,owners[0]);return plane?.planar&&!plane.collinear?plane:null;}
function splinePlaneBasis(plane,owner){const object=splineObjectFrame(owner),e=object.elements,z=plane.normal.clone(),candidates=[new THREE.Vector3(e[0],e[1],e[2]),new THREE.Vector3(e[4],e[5],e[6]),plane.axis.clone()];let x=null;for(const candidate of candidates){const p=candidate.clone().addScaledVector(z,-candidate.dot(z));if(p.lengthSq()>1e-10){x=p.normalize();break;}}if(!x)x=new THREE.Vector3(1,0,0);const y=new THREE.Vector3().crossVectors(z,x).normalize();x.crossVectors(y,z).normalize();return new THREE.Matrix4().makeBasis(x,y,z);}
function pureSplinePivotMatrix(matrixOrArray){const source=matrixOrArray?.isMatrix4?matrixOrArray:new THREE.Matrix4().fromArray(matrixOrArray),p=new THREE.Vector3().setFromMatrixPosition(source),r=new THREE.Matrix4();rotMatOfLin(source,r);r.setPosition(p);return r.elements.slice();}
function splineFrameMatrix(){const pts=splineSelectionWorldPoints();if(!pts.length)return null;if(splineSelection.pivot)return new THREE.Matrix4().fromArray(splineSelection.pivot);const center=pts.reduce((a,p)=>a.add(p),new THREE.Vector3()).multiplyScalar(1/pts.length),refs=splineSelectedRefs(),dominant=refs.vertices.length+refs.segments.length,count=dominant||refs.handles.length,first=refs.vertices[0]||refs.segments[0]||refs.handles[0],owner=first?.object||activeSplineObject(),orientRef=refs.vertices.length?{kind:'vertex',...refs.vertices[0]}:refs.segments.length?{kind:'segment',...refs.segments[0]}:splineSelection.active;let basis=coordMode==='world'?new THREE.Matrix4():splineObjectFrame(owner);if(coordMode!=='world'&&count===1&&orientRef){const x=splineDirectionWorld(orientRef),oe=basis.elements;let y=new THREE.Vector3(oe[4],oe[5],oe[6]).addScaledVector(x,-x.dot(new THREE.Vector3(oe[4],oe[5],oe[6])));if(y.lengthSq()<1e-10)y=new THREE.Vector3(oe[8],oe[9],oe[10]).addScaledVector(x,-x.dot(new THREE.Vector3(oe[8],oe[9],oe[10])));y.normalize();const z=x.clone().cross(y).normalize();y=z.clone().cross(x).normalize();basis.makeBasis(x,y,z);}else if(coordMode!=='world'&&count>1){const plane=splineSelectionPlane();if(plane)basis=splinePlaneBasis(plane,owner);}basis.setPosition(center);return basis;}
function splineOwnerForSelection(){const refs=splineSelectedRefs(),first=refs.vertices[0]||refs.segments[0]||refs.handles[0];return first?.object||activeSplineObject();}
function splineAffectedWorldPoints(){const refs=splineSelectedRefs(),pts=[];if(refs.vertices.length){for(const r of refs.vertices){const d=evaluatedSplineData(r.object),p=d?.vertices[r.id];if(!p)continue;pts.push(splineWorldPoint(r.object,p));for(const q of splineEditableHandles(d,r.id))pts.push(splineWorldPoint(r.object,q.position));}}else if(refs.segments.length){for(const r of refs.segments){const d=evaluatedSplineData(r.object),p=d&&SPLINE.segmentPoints(d,r.id);if(p)for(const q of p)pts.push(splineWorldPoint(r.object,q));}}else for(const r of refs.handles){const d=evaluatedSplineData(r.object),info=d&&splineHandleInfo(d,r.segment,r.side);if(info){pts.push(splineWorldPoint(r.object,d.vertices[info.vertex]));pts.push(splineWorldPoint(r.object,SPLINE.splineMath.add(d.vertices[info.vertex],info.vector)));}}return pts;}
function splineExtentInFrame(frame){const pts=splineAffectedWorldPoints(),inv=frame.clone().invert();if(!pts.length)return new THREE.Vector3();const first=pts[0].clone().applyMatrix4(inv),mn=first.clone(),mx=first.clone();for(let i=1;i<pts.length;i++){const p=pts[i].clone().applyMatrix4(inv);mn.min(p);mx.max(p);}return mx.sub(mn);}
function splineCoordReference(mode){return mode==='world'?new THREE.Matrix4():splineObjectFrame(splineOwnerForSelection());}
function readSplineTransform(mode){const world=splineFrameMatrix();if(!world)return {p:new THREE.Vector3(),s:new THREE.Vector3(),e:new THREE.Euler()};const ref=splineCoordReference(mode),local=ref.clone().invert().multiply(world),lin=local.clone();lin.elements[12]=lin.elements[13]=lin.elements[14]=0;rotMatOfLin(lin,_RM);return {p:new THREE.Vector3().setFromMatrixPosition(local),s:splineExtentInFrame(world),e:new THREE.Euler().setFromRotationMatrix(_RM)};}
function applySplineCoordinateInput(ch,i,v,mode){const old=splineFrameMatrix();if(!old)return;const desired=old.clone();let weldCoincident=false;if(ch==='pos'){if(mode==='world')desired.elements[12+i]=v;else{const ref=splineCoordReference(mode),lp=new THREE.Vector3().setFromMatrixPosition(ref.clone().invert().multiply(old));lp.setComponent(i,v);desired.setPosition(lp.applyMatrix4(ref));}}else if(ch==='rot'){const ref=splineCoordReference(mode),local=ref.clone().invert().multiply(old),r=new THREE.Matrix4();rotMatOfLin(local,r);const e=new THREE.Euler().setFromRotationMatrix(r);if(i===0)e.x=v*D2R;else if(i===1)e.y=v*D2R;else e.z=v*D2R;r.makeRotationFromEuler(e);const wr=ref.clone();rotMatOfLin(wr,wr);desired.copy(wr.multiply(r));desired.setPosition(old.elements[12],old.elements[13],old.elements[14]);}else{const size=splineExtentInFrame(old),cur=size.getComponent(i);if(cur<MIN_COL)return;const target=Math.abs(v)<MIN_COL?0:Math.abs(v),factor=target/cur,e=desired.elements,k=i*4;weldCoincident=target===0;e[k]*=factor;e[k+1]*=factor;e[k+2]*=factor;}const delta=desired.clone().multiply(old.clone().invert()),snap=splineDataSnapshot(),hadPivot=!!splineSelection.pivot;if(hadPivot)splineSelection.pivot=pureSplinePivotMatrix(desired);applySplineTransformSnapshot(snap,delta,{weldCoincident});setPureGizmoFrame(splineFrameMatrix()||desired);updateHUD();}
function splineSelectionBounds(){const pts=splineAffectedWorldPoints();if(!pts.length)return null;const mn=pts[0].clone(),mx=pts[0].clone();for(const p of pts){mn.min(p);mx.max(p);}return {min:mn,max:mx};}
function splineDataSnapshot(){const hs=new Set();for(const r of [...splineSelection.vertices,...splineSelection.handles,...splineSelection.segments])hs.add(parseSplineElementKey(r).object);return new Map([...hs].filter(h=>splineData.has(h)).map(h=>[h,SPLINE.cloneSplineData(splineData.get(h))]));}
function snapSplineVertexPreview(data,h,vid){splineWeldCandidate=null;if(gizDrag?.mode!=='move'||!data.vertices[vid])return;const vi=gizDrag.view,r=rectFor(vi),cam=vpState.views[vi]?.cam,wire=viewShading[vi]===1;if(!r||!cam)return;const world=splineWorldPoint(h,data.vertices[vid]),screen=projectPx(world,cam,r);let best=null,bd=SNAP_PX*SNAP_PX,bwd=Infinity;for(const [oh,source] of splineData){if(!OBJ.has(oh)||!effectiveVisible(oh))continue;const targetData=oh===h?data:source;for(const [oid,p] of Object.entries(targetData.vertices)){if(oh===h&&oid===vid)continue;const w=splineWorldPoint(oh,p),ndc=w.clone().project(cam);if(ndc.z<-1||ndc.z>1||(!wire&&!exactVertexVisible(w,ndc,cam)))continue;const s=projectPx(w,cam,r),d=(s[0]-screen[0])**2+(s[1]-screen[1])**2,wd=w.distanceToSquared(world);if(d<bd-1e-6||(Math.abs(d-bd)<=1e-6&&wd<bwd)){bd=d;bwd=wd;best={kind:'spline',object:oh,id:oid,p,w,rawWorldDistance:Math.sqrt(wd)};}}}if(snapOn){const poly=nearestPolygonVertex(screen[0],screen[1],vi,SNAP_PX,world);if(poly){const s=projectPx(poly.world,cam,r),d=(s[0]-screen[0])**2+(s[1]-screen[1])**2,wd=poly.world.distanceToSquared(world);if(d<bd-1e-6||(Math.abs(d-bd)<=1e-6&&wd<bwd)){bd=d;bwd=wd;best={kind:'polygon',object:poly.object,id:poly.vertex,p:null,w:poly.world.clone(),rawWorldDistance:Math.sqrt(wd)};}}}if(best){data.vertices[vid]=best.w.clone().applyMatrix4(splineWorldMatrix(h).clone().invert()).toArray();splineWeldCandidate={sourceObject:h,source:vid,targetObject:best.object,target:best.id,rawWorldDistance:best.rawWorldDistance,screenDistance:Math.sqrt(bd)};if(best.kind==='spline')Object.assign(splineHover,{kind:'vertex',object:best.object,id:best.id,side:null,point:best.p.slice(),world:best.w,t:0,view:vi,d2:bd});}}
function remapSplineSelectionAfterWeld(h,remap,d){const mapKey=key=>{const r=parseSplineElementKey(key);return r.object===h&&remap[r.id]?splineElementKey(h,remap[r.id]):key;};splineSelection.vertices=new Set([...splineSelection.vertices].map(mapKey).filter(key=>{const r=parseSplineElementKey(key);return r.object!==h||!!d.vertices[r.id];}));splineSelection.segments=new Set([...splineSelection.segments].filter(key=>{const r=parseSplineElementKey(key);return r.object!==h||!!d.segments[r.id];}));splineSelection.handles=new Set([...splineSelection.handles].filter(key=>{const r=parseSplineElementKey(key),q=parseSplineHandleKey(r.id);return r.object!==h||!!d.segments[q.segment];}));for(const ref of ['active','anchor']){const q=splineSelection[ref];if(q?.object===h&&remap[q.id])q.id=remap[q.id];}}
function applySplineTransformSnapshot(states,deltaWorld,mods={}){
for(const [h,state] of states){
const d=SPLINE.cloneSplineData(state),wm=splineWorldMatrix(h),local=wm.clone().invert().multiply(deltaWorld).multiply(wm),refs=splineSelectedRefs();
const vertices=refs.vertices.filter(x=>x.object===h).map(x=>x.id),segments=refs.segments.filter(x=>x.object===h).map(x=>x.id),handles=refs.handles.filter(x=>x.object===h).map(x=>({segment:x.segment,side:x.side}));
if(vertices.length||segments.length){const affected=[...new Set(vertices.concat(segments.flatMap(id=>{const s=d.segments[id];return s?[s.a,s.b]:[]})))];SPLINE.transformSplineSelection(d,{vertices,segments},local.elements);if(vertices.length===1&&!segments.length)snapSplineVertexPreview(d,h,vertices[0]);if(mods.weldCoincident||gizDrag?.mode==='scale'){const remap=SPLINE.weldCoincidentSplineVertices(d,affected,1e-6);if(Object.keys(remap).length)remapSplineSelectionAfterWeld(h,remap,d);}}
else if(handles.length){
const transformVector=info=>{const p=d.vertices[info.vertex],tip=SPLINE.splineMath.add(p,info.vector),moved=new THREE.Vector3().fromArray(tip).applyMatrix4(local).toArray();return SPLINE.splineMath.sub(moved,p);};
if(handles.length===1){const token=handles[0],info=splineHandleInfo(d,token.segment,token.side);if(info){const old=info.vector.slice(),oldLen=SPLINE.splineMath.len(old);let moved=transformVector(info),newLen=SPLINE.splineMath.len(moved);
if(oldLen<1e-6)moved=newLen<1e-6?[0,0,0]:moved;else if(mods.ctrl)moved=SPLINE.splineMath.mul(SPLINE.splineMath.norm(old),newLen);
if(!mods.ctrl&&!mods.shift){if(newLen<1e-6){for(const other of splineAllHandleInfos(d,info.vertex))splineSetHandleVector(d,other,[0,0,0]);}else if(oldLen>=1e-6){const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().fromArray(SPLINE.splineMath.norm(old)),new THREE.Vector3().fromArray(SPLINE.splineMath.norm(moved))),scale=newLen/oldLen;for(const other of splineAllHandleInfos(d,info.vertex)){if(other.segment===info.segment&&other.side===info.side)continue;const v=new THREE.Vector3().fromArray(other.vector).applyQuaternion(q).multiplyScalar(scale);splineSetHandleVector(d,other,v.toArray());}}}
splineSetHandleVector(d,info,moved);if(gizDrag?.view>=0){const r=rectFor(gizDrag.view),cam=vpState.views[gizDrag.view]?.cam;if(r&&cam){const hp=splineWorldPoint(h,SPLINE.splineMath.add(d.vertices[info.vertex],info.vector)),vp=splineWorldPoint(h,d.vertices[info.vertex]),a=projectPx(hp,cam,r),b=projectPx(vp,cam,r);if((a[0]-b[0])**2+(a[1]-b[1])**2<=SNAP_PX*SNAP_PX){if(!mods.shift&&!mods.ctrl)for(const other of splineAllHandleInfos(d,info.vertex))splineSetHandleVector(d,other,[0,0,0]);else splineSetHandleVector(d,info,[0,0,0]);}}}}}
else for(const token of handles){const info=splineHandleInfo(d,token.segment,token.side);if(!info)continue;const old=info.vector.slice(),moved=transformVector(info),n=SPLINE.splineMath.len(moved);splineSetHandleVector(d,info,mods.ctrl&&SPLINE.splineMath.len(old)>=1e-6?SPLINE.splineMath.mul(SPLINE.splineMath.norm(old),n):moved);}}
else SPLINE.transformSplineSelection(d,{segments},local.elements);
splineData.set(h,d);updateSplineVisual(h);}
placeGizmoForSelection();}
function coincidentSplineWeldTarget(ref,tolerance=1e-6){const d=splineData.get(ref.object),source=d?.vertices[ref.id];if(!source)return null;const sw=splineWorldPoint(ref.object,source),limit=tolerance*tolerance;let best=null,bestD=Infinity;for(const [id,p] of Object.entries(d.vertices)){if(id===ref.id)continue;const dist=splineWorldPoint(ref.object,p).distanceToSquared(sw);if(dist<=limit&&dist<bestD){best=id;bestD=dist;}}return best;}
function weldSelectedCoincidentSplineVertex(){if(splineSelection.vertices.size!==1)return false;const ref=parseSplineElementKey([...splineSelection.vertices][0]),target=coincidentSplineWeldTarget(ref);if(!target)return false;const d=splineData.get(ref.object);SPLINE.weldSplineVertices(d,target,ref.id);splineSelection.vertices.clear();splineSelection.vertices.add(splineElementKey(ref.object,target));splineSelection.active={kind:'vertex',object:ref.object,id:target};splineSelection.anchor={object:ref.object,id:target};return true;}
function trySplineWeldAfterDrag(){if(!gizDrag||gizDrag.mode!=='move'||splineSelection.vertices.size!==1)return false;if(weldSelectedCoincidentSplineVertex())return true;if(!splineWeldCandidate)return false;const ref=parseSplineElementKey([...splineSelection.vertices][0]),c=splineWeldCandidate;if(c.sourceObject!==ref.object||c.source!==ref.id||c.targetObject!==ref.object)return false;if(gizDrag.kind==='screen'?c.screenDistance>SNAP_PX:c.rawWorldDistance>=1e-5)return false;const d=splineData.get(ref.object);if(!d?.vertices[c.target]||!d.vertices[ref.id])return false;SPLINE.weldSplineVertices(d,c.target,ref.id);splineSelection.vertices.clear();splineSelection.vertices.add(splineElementKey(ref.object,c.target));splineSelection.active={kind:'vertex',object:ref.object,id:c.target};splineSelection.anchor={object:ref.object,id:c.target};return true;}
function snapSplinePivotPreview(){if(!gizDrag||gizDrag.mode!=='move')return;const vi=gizDrag.view,r=rectFor(vi),cam=vpState.views[vi]?.cam,wire=viewShading[vi]===1;if(!r||!cam)return;const raw=gizmo.pos.clone(),screen=projectPx(raw,cam,r);let best=null,bd=SNAP_PX*SNAP_PX,bwd=Infinity;for(const [h,d] of splineData){if(!OBJ.has(h)||!effectiveVisible(h))continue;for(const p of Object.values(d.vertices)){const world=splineWorldPoint(h,p),ndc=world.clone().project(cam);if(ndc.z<-1||ndc.z>1||(!wire&&!exactVertexVisible(world,ndc,cam)))continue;const s=projectPx(world,cam,r),dd=(s[0]-screen[0])**2+(s[1]-screen[1])**2,wd=world.distanceToSquared(raw);if(dd<bd-1e-6||(Math.abs(dd-bd)<=1e-6&&wd<bwd)){bd=dd;bwd=wd;best=world;}}}if(snapOn){const poly=nearestPolygonVertex(screen[0],screen[1],vi,SNAP_PX,raw);if(poly){const s=projectPx(poly.world,cam,r),dd=(s[0]-screen[0])**2+(s[1]-screen[1])**2,wd=poly.world.distanceToSquared(raw);if(dd<bd-1e-6||(Math.abs(dd-bd)<=1e-6&&wd<bwd))best=poly.world;}}if(best){gizmo.pos.copy(best);syncCube();}}
function placeGizmoForSelection(){ const hs=[...selNodes];
if(uvEdit){ const frame=uvWorldFrame(),gm=uvVirtualWorld(); if(!frame||!gm){uvEdit=null; if(uvFrameLines)uvFrameLines.visible=false; return;} boundNode=UV_VIRTUAL; setGizmoFromMatrix(gm.elements); const mn=new THREE.Vector3(Infinity,Infinity,Infinity),mx=new THREE.Vector3(-Infinity,-Infinity,-Infinity),p=new THREE.Vector3(); for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){p.set(x,y,z).applyMatrix4(frame);mn.min(p);mx.max(p);} setGizmoBounds(mn,mx); syncUvFrame(); return; }
if(splineFocusActive()){const m=splineFrameMatrix(),bb=splineSelectionBounds();boundNode=null;if(!m||!bb){setGizmoVisible(false);return;}setGizmoFromMatrix(m.elements);setGizmoBounds(bb.min,bb.max);setGizmoVisible(true);return;}
if(polyMode){ const bb=polySelectionBounds(); boundNode=null; if(!bb)return;const m=polyFrameMatrix();setGizmoFromMatrix(m.elements);setGizmoBounds(bb.min,bb.max);return; }
if(hs.length===0){ boundNode=null; return; }
if(hs.length===1){
boundNode=hs[0]; const gm=gizmoMatrixForNode(hs[0]); setGizmoFromMatrix(gm);
const bb=getWorldBBox(hs[0]); const p=new THREE.Vector3(gm[12],gm[13],gm[14]);
setGizmoBounds(bb?bb.min:p.toArray(),bb?bb.max:p.toArray());
return;
}
boundNode=null;
let tw=0,sxw=0,syw=0,szw=0,qx=0,qy=0,qz=0,qw=0,ref=null;
for(const h of hs){ const wp=getWorldPos(h); if(!wp) continue; const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(getWorldMatrix(h))); if(!ref)ref=q.clone(); const sign=ref.dot(q)<0?-1:1; qx+=q.x*sign;qy+=q.y*sign;qz+=q.z*sign;qw+=q.w*sign; tw++; sxw+=wp[0]; syw+=wp[1]; szw+=wp[2]; }
if(tw<=0) return;
const m=getWorldMatrix(hs[0]).slice();
m[12]=sxw/tw; m[13]=syw/tw; m[14]=szw/tw;
const q=new THREE.Quaternion(qx,qy,qz,qw).normalize(),s=new THREE.Vector3(Math.hypot(m[0],m[1],m[2]),Math.hypot(m[4],m[5],m[6]),Math.hypot(m[8],m[9],m[10])); new THREE.Matrix4().compose(new THREE.Vector3(m[12],m[13],m[14]),q,s).toArray(m);
ignoreBridge=true; setGizmoFromMatrix(m); ignoreBridge=false; }
function bridgeTransform(){ if(ignoreBridge) return;
if(splineFocusActive()){if(editPivot){snapSplinePivotPreview();return;}if(!gizBeforeSpline||!gizBeforeGizmo)return;const current=getGizmoWorldArray(),delta=new THREE.Matrix4().fromArray(current).multiply(new THREE.Matrix4().fromArray(gizBeforeGizmo).invert());if(gizBeforeSplinePivot)splineSelection.pivot=pureSplinePivotMatrix(current);applySplineTransformSnapshot(gizBeforeSpline,delta,splineGizModifiers||{});return;}
if(polyMode){ if(editPivot)return;if(!gizBeforePoly||!gizBeforeGizmo)return; const delta=new THREE.Matrix4().fromArray(getGizmoWorldArray()).multiply(new THREE.Matrix4().fromArray(gizBeforeGizmo).invert()); applyPolyDelta(delta,gizBeforePoly); return; }
if(!boundNode){ if(editPivot)return; if(!gizBeforeMulti||!gizBeforeGizmo)return; const delta=new THREE.Matrix4().fromArray(getGizmoWorldArray()).multiply(new THREE.Matrix4().fromArray(gizBeforeGizmo).invert()); for(const [h,before] of gizBeforeMulti)applyNodeWorld(h,delta.clone().multiply(new THREE.Matrix4().fromArray(before)).elements); return; }
if(editPivot&&boundNode===UV_VIRTUAL)return;
if(editPivot){
const world=new THREE.Matrix4().fromArray(getWorldMatrix(boundNode));
const gizmoWorld=new THREE.Matrix4().fromArray(getGizmoWorldArray());
setNodePivot(boundNode,world.invert().multiply(gizmoWorld).elements.slice()); return; }
const gmArr=getGizmoWorldArray();
if(!gizBeforeObj || !gizBeforeGizmo){ applyNodeWorld(boundNode, gmArr); return; }
const g0=new THREE.Matrix4().fromArray(gizBeforeGizmo); const gNow=new THREE.Matrix4().fromArray(gmArr);
const delta=gNow.multiply(g0.invert()); const o0=new THREE.Matrix4().fromArray(gizBeforeObj);
applyNodeWorld(boundNode, delta.multiply(o0).elements.slice()); }
function unionSubtree(h,acc){ const bb=getWorldBBox(h); if(bb) acc.push(bb); const n=getObj(h); if(n) n.children.forEach(c=>unionSubtree(c,acc)); }
function updateBrackets(show=true){ const hs=[...selNodes].slice().sort(); const sig=hs.join(','); if(sig===lastBracketSig) return; lastBracketSig=sig;
if(hs.length===0){ if(show)setSelectionBrackets(null,null,false); return; }
// У одиночного объекта gizmo и его bounding box относятся только к нему;
// дочерние остаются самостоятельными объектами сцены.
const acc=hs.length===1?[getWorldBBox(hs[0])].filter(Boolean):[]; if(hs.length>1)hs.forEach(h=>unionSubtree(h,acc));
if(!acc.length){ if(show)setSelectionBrackets(null,null,false); return; }
const mn=acc[0].min.slice(), mx=acc[0].max.slice();
for(let k=1;k<acc.length;k++){ for(let i=0;i<3;i++){ if(acc[k].min[i]<mn[i])mn[i]=acc[k].min[i]; if(acc[k].max[i]>mx[i])mx[i]=acc[k].max[i]; } }
setGizmoBounds(mn,mx);
if(show)setSelectionBrackets(mn,mx,true); }
function copyObjParams(map){ if(!map) return; for(const [old,nh] of map){ const op=objParams.get(old); if(op){const copy=Object.assign({},op);if(copy.__type==='instance'&&map.has(copy.source))copy.source=map.get(copy.source);objParams.set(nh,copy);if(copy.__type==='spline'&&splineData.has(old))installSplineObject(nh,SPLINE.cloneSplineData(splineData.get(old)));}const track=animationTracks.get(old);if(track)animationTracks.set(nh,new Map([...track].map(([f,key])=>[f,cloneAnimKey(key)])));} }
/* порядок: сначала bridgeTransform, потом updateHUD */
onTransform(()=>{ bridgeTransform(); updateHUD(); if(!splineFocusActive())scheduleGeneratorEvaluation(70); });
onViewportPick((hash,shift,mod)=>{
if(polyMode){ if(!hash) clearPolySelection(); return; }
if(!shift&&!mod)selMats.clear();
if(shift||mod){ if(hash){ if(selNodes.has(hash)) selNodes.delete(hash); else { selNodes.add(hash); anchorNode=getObj(hash); } } }
else { if(hash){ selNodes.clear(); selTags.clear(); selNodes.add(hash); anchorNode=getObj(hash); } else { selNodes.clear(); selTags.clear(); anchorNode=null; } }
lastBracketSig=null; refreshSelClasses(); });
onGizmoDragStart((e)=>{
if(uvEdit){ boundNode=UV_VIRTUAL; gizBeforeObj=getWorldMatrix(boundNode); gizBeforeGizmo=getGizmoWorldArray(); return; }
if(splineFocusActive()){splineWeldCandidate=null;gizBeforeGizmo=getGizmoWorldArray();gizBeforeSplineSel=splineSelectionState();gizBeforeSplinePivot=splineSelection.pivot&&splineSelection.pivot.slice();const owners=splineSelectionOwners();gizBeforeSplineFull=!editPivot?captureSplineFullState(owners):null;if(!editPivot)autoBakeSplineTags(owners);gizBeforeSplineUndo=splineDataSnapshot();splineGizModifiers={ctrl:!!(e?.ctrlKey||e?.metaKey),shift:!!e?.shiftKey};if(!editPivot&&splineGizModifiers.ctrl&&!splineSelection.vertices.size&&!splineSelection.handles.size&&splineSelection.segments.size){const grouped=new Map();for(const key of splineSelection.segments){const r=parseSplineElementKey(key);let a=grouped.get(r.object);if(!a)grouped.set(r.object,a=[]);a.push(r.id);}splineSelection.segments.clear();for(const [h,ids] of grouped){const q=SPLINE.duplicateSplineSegments(splineData.get(h),ids);for(const sid of q.segments)splineSelection.segments.add(splineElementKey(h,sid));}updateAllSplineVisuals();}gizBeforeSpline=splineDataSnapshot();return;}
if(polyMode){gizBeforeGizmo=getGizmoWorldArray();gizBeforePolyPivot=polyPivotMatrix&&polyPivotMatrix.slice();if(editPivot)return;gizBeforePolyGeom=capturePolyGeometries();gizBeforePolySel=capturePolySelectionState();if(e?.ctrlKey&&(polyElementMode==='edge'||polyElementMode==='face'))extrudeSelectedForDrag();gizBeforePoly=capturePolySelection();return;}
if(e && e.ctrlKey && boundNode){
const cmd=cmdDuplicateToRoot([boundNode]);
cmd.redo(); copyObjParams(cmd.map);
const nh=cmd.newRoots && cmd.newRoots[0];
if(nh){ pushCmd(cmd);
selNodes.clear(); selTags.clear(); selNodes.add(nh); anchorNode=getObj(nh); boundNode=nh;
lastBracketSig=null; treeChanged(); refreshSelClasses(); } }
if(boundNode){ gizBeforeObj=getWorldMatrix(boundNode); gizBeforeObjPivot=editPivot?(OBJ.get(boundNode)?.pivot.elements.slice()||null):null; gizBeforeGizmo=getGizmoWorldArray(); } else if(selNodes.size>1){ gizBeforeMulti=new Map([...selNodes].map(h=>[h,getWorldMatrix(h)])); gizBeforeGizmo=getGizmoWorldArray(); } });
onGizmoDragEnd(()=>{ if(uvEdit&&uvBeforeFrame){ const before=uvBeforeFrame.clone(),after=uvEdit.map.mapFrame.clone(),map=uvEdit.map,mh=uvEdit.mat; if(!mat4Close(before.elements,after.elements))pushCmd({redo(){map.mapFrame=after.clone();syncTagFrame(mh);syncUvFrame();},undo(){map.mapFrame=before.clone();syncTagFrame(mh);syncUvFrame();}}); uvBeforeFrame=null;gizBeforeGizmo=null;return; }
if(splineFocusActive()){if(editPivot){const before=gizBeforeSplinePivot&&gizBeforeSplinePivot.slice(),after=pureSplinePivotMatrix(getGizmoWorldArray());splineSelection.pivot=after.slice();pushCmd({redo(){splineSelection.pivot=after.slice();placeGizmoForSelection();},undo(){splineSelection.pivot=before&&before.slice();placeGizmoForSelection();}});}else{if(gizBeforeSplinePivot)splineSelection.pivot=pureSplinePivotMatrix(getGizmoWorldArray());trySplineWeldAfterDrag();const before=gizBeforeSplineFull,after=captureSplineFullState([...before.keys()]),beforeSel=gizBeforeSplineSel,afterSel=splineSelectionState();if(JSON.stringify([...before])!==JSON.stringify([...after])||JSON.stringify(beforeSel)!==JSON.stringify(afterSel))pushCmd({redo(){restoreSplineFullState(after,afterSel);},undo(){restoreSplineFullState(before,beforeSel);}});}gizBeforeSpline=null;gizBeforeSplineUndo=null;gizBeforeSplineFull=null;gizBeforeSplineSel=null;gizBeforeSplinePivot=null;gizBeforeGizmo=null;splineGizModifiers=null;splineWeldCandidate=null;updateAllSplineVisuals();placeGizmoForSelection();return;}
if(polyMode&&editPivot){polyPivotMatrix=getGizmoWorldArray().slice();gizBeforePolyPivot=null;gizBeforeGizmo=null;scheduleRender();return;}
if(polyMode){ const beforeGeom=gizBeforePolyGeom,beforeSel=gizBeforePolySel;orientExtrudedFaces();const logicalSel=capturePolyLogicalSelection(),hadCustomPivot=!!polyPivotMatrix,draggedPivot=getGizmoWorldArray().slice();polyExactEdgeVertices=null;for(const h of polySelection.items.keys()){const oldSoft=vertexTools.soft.weights.get(h),remap=rebuildCreaseRender(pickMeshes.get(h));remapSoftAfterTopology(h,oldSoft,remap);} restorePolyLogicalSelection(logicalSel); if(hadCustomPivot)polyPivotMatrix=draggedPivot; const afterGeom=capturePolyGeometries(),afterSel=capturePolySelectionState(),afterPivot=polyPivotMatrix&&polyPivotMatrix.slice(),beforePivot=gizBeforePolyPivot&&gizBeforePolyPivot.slice(); rebuildPolySelection(true); if(beforeGeom&&beforeSel)pushCmd({redo(){polyPivotMatrix=afterPivot&&afterPivot.slice();restorePolyGeometries(afterGeom);restorePolySelectionState(afterSel);},undo(){polyPivotMatrix=beforePivot&&beforePivot.slice();restorePolyGeometries(beforeGeom);restorePolySelectionState(beforeSel);}}); gizBeforePoly=null; gizBeforePolyGeom=null; gizBeforePolySel=null; gizBeforePolyPivot=null; gizBeforeGizmo=null; return; }
if(gizBeforeMulti){ const before=gizBeforeMulti,after=new Map([...before.keys()].map(h=>[h,getWorldMatrix(h)])); if(!editPivot)pushCmd({redo(){for(const [h,m]of after)applyNodeWorld(h,m);},undo(){for(const [h,m]of before)applyNodeWorld(h,m);}}); gizBeforeMulti=null;gizBeforeGizmo=null;return; }
if(boundNode&&editPivot&&gizBeforeObjPivot){const h=boundNode,b=gizBeforeObjPivot.slice(),a=OBJ.get(h)?.pivot.elements.slice();if(a&&!mat4Close(b,a))pushCmd({redo(){setNodePivot(h,a);placeGizmoForSelection();},undo(){setNodePivot(h,b);placeGizmoForSelection();}});gizBeforeObj=null;gizBeforeObjPivot=null;gizBeforeGizmo=null;return;}
if(boundNode&&gizBeforeObj){ const after=getWorldMatrix(boundNode);
if(!mat4Close(gizBeforeObj,after)){ const b=gizBeforeObj.slice(), a=after.slice(), h=boundNode;
pushCmd({ redo(){ applyNodeWorld(h,a); setGizmoFromMatrix(a); }, undo(){ applyNodeWorld(h,b); setGizmoFromMatrix(b); } }); }
gizBeforeObj=null; gizBeforeObjPivot=null; gizBeforeGizmo=null; } else { gizBeforeObj=null; gizBeforeObjPivot=null; gizBeforeGizmo=null; } });
/* ===================== marquee во вьюпорте (Alt+drag) ===================== */
const vpEl=document.getElementById('vp');
vpEl.addEventListener('pointerdown',e=>{ const vi=viewAt(e.clientX,e.clientY); if(vertexTools.mode==='lineCut'||vertexTools.mode==='closeHole'||splinePointerGesture||splineDrawing||getGizDragMode()||e.button!==0||(!e.altKey&&(!vpState.views[vi]||vpState.views[vi].type==='persp'))) return;
e.preventDefault();
const sx=e.clientX, sy=e.clientY;
const box=document.createElement('div'); box.className='ml-marquee'; document.body.appendChild(box);
const move=ev=>{ const x0=Math.min(sx,ev.clientX),y0=Math.min(sy,ev.clientY),x1=Math.max(sx,ev.clientX),y1=Math.max(sy,ev.clientY);
box.style.left=x0+'px'; box.style.top=y0+'px'; box.style.width=(x1-x0)+'px'; box.style.height=(y1-y0)+'px'; };
const up=ev=>{ removeEventListener('pointermove',move); removeEventListener('pointerup',up); box.remove();
const x0=Math.min(sx,ev.clientX),y0=Math.min(sy,ev.clientY),x1=Math.max(sx,ev.clientX),y1=Math.max(sy,ev.clientY);
if(Math.abs(x1-x0)+Math.abs(y1-y0)>3){
if(splineMode||polyMode){const mode=(ev.ctrlKey||ev.metaKey)?'invert':(ev.shiftKey?'add':'replace');if(splineMode)splineBoxPick(x0,y0,x1,y1,mode);if(polyMode){polyBoxPick(x0,y0,x1,y1,mode);if(vertexTools.soft.active)recalculateSoftSelection();}}
else { const hs=boxPick(x0,y0,x1,y1); selNodes.clear(); selTags.clear(); hs.forEach(h=>selNodes.add(h)); anchorNode=hs.length?getObj(hs[0]):null; lastBracketSig=null; refreshSelClasses(); }
} };
addEventListener('pointermove',move); addEventListener('pointerup',up); });
/* ===================== сериализация UI-параметров ===================== */
const UIALL   ='44444444444444444444444444444444';
const KEY_TYPE='444444444444444444444444444444a1';
const KEY_NUMS='444444444444444444444444444444a2';
const KEY_BOOLS='444444444444444444444444444444a3';
const KEY_ENUMS='444444444444444444444444444444a4';
const KEY_STR ='444444444444444444444444444444a5';
const ANIM_DATA='555555555555555555555555555555a1';
const SPLINE_DATA='666666666666666666666666666666a1';
function encHashesLocal(arr){ const o=new Uint8Array(arr.length*16); arr.forEach((h,i)=>o.set(hex16(h),i*16)); return o; }
function animationPayload(){return {current:tlCur,total:tlTotal,interp:tlInterp,tracks:[...animationTracks].filter(([h])=>OBJ.has(h)).map(([h,track])=>[h,[...track].sort((a,b)=>a[0]-b[0]).map(([frame,key])=>[frame,key.p,key.q,key.s,key.interp])])};}
function restoreAnimationPayload(data){stopTimeline();animationTracks.clear();tlCur=0;tlTotal=100;tlInterp='soft';if(data&&typeof data==='object'){tlTotal=clamp_ui(Math.round(+data.total||100),1,1000000);tlCur=clamp_ui(Math.round(+data.current||0),0,tlTotal);tlInterp=data.interp==='linear'?'linear':'soft';for(const item of data.tracks||[]){const h=item?.[0];if(!OBJ.has(h)||!Array.isArray(item[1]))continue;const track=new Map();for(const raw of item[1]){const frame=Math.round(+raw?.[0]);if(frame<0||!Array.isArray(raw?.[1])||!Array.isArray(raw?.[2])||!Array.isArray(raw?.[3]))continue;track.set(frame,{p:raw[1].slice(0,3),q:raw[2].slice(0,4),s:raw[3].slice(0,3),interp:raw[4]==='linear'?'linear':'soft'});}if(track.size)animationTracks.set(h,track);}}tlCurOpts.max=tlTotal;syncInterp();syncTimelineInputs();applyAnimationFrame(tlCur);}
function resetTimeline(){pendingAnimation=null;restoreAnimationPayload(null);}
function buildUIRecords(){
const R=[]; const hashes=[...objParams.keys()].filter(h=>getObj(h));
R.push(rec(TYP.I64x2, hex16(UIALL), encHashesLocal(hashes)));
for(const h of hashes){ const p=objParams.get(h); const sch=SCHEMA[p.__type]; if(!sch) continue; const ob=hex16(h);
R.push(rec(TYP.UTF8, xor16(ob,hex16(KEY_TYPE)), encUTF8(p.__type)));
const nums=[]; for(const f of sch.f) nums.push(+p[f]||0); for(const f of sch.i) nums.push(+p[f]||0);
if(nums.length) R.push(rec(TYP.FP32, xor16(ob,hex16(KEY_NUMS)), encF32(nums)));
if(sch.b.length){ const b=new Uint8Array(sch.b.length); sch.b.forEach((f,j)=>b[j]=p[f]?1:0);
R.push(rec(TYP.UINT8, xor16(ob,hex16(KEY_BOOLS)), b)); }
if(sch.e.length){ const e=new Uint8Array(sch.e.length); sch.e.forEach((en,j)=>{ const idx=en[1].indexOf(p[en[0]]); e[j]=idx<0?0:idx; });
R.push(rec(TYP.UINT8, xor16(ob,hex16(KEY_ENUMS)), e)); }
if(sch.s){ R.push(rec(TYP.UTF8, xor16(ob,hex16(KEY_STR)), encUTF8(p[sch.s]||''))); } }
R.push(rec(TYP.UTF8,hex16(ANIM_DATA),encUTF8(JSON.stringify(animationPayload()))));
R.push(rec(TYP.UTF8,hex16(SPLINE_DATA),encUTF8(JSON.stringify([...splineData].filter(([h])=>OBJ.has(h))))));
return R; }
function readRecords(buf){ const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength); const m=new Map(); let off=0;
while(off+26<=buf.length){ const key=hx(buf.subarray(off+2,off+18)); const len=Number(dv.getBigUint64(off+18,true));
m.set(key,{data:buf.subarray(off+26,off+26+len)}); off+=26+len; }
return m; }
function unpackUI(buf){ const m=readRecords(buf),animR=m.get(ANIM_DATA),splineR=m.get(SPLINE_DATA);pendingAnimation=null;pendingSplinePayload=null;if(animR)try{pendingAnimation=JSON.parse(decUTF8(animR.data));}catch{}if(splineR)try{pendingSplinePayload=JSON.parse(decUTF8(splineR.data));}catch{}const allR=m.get(UIALL); if(!allR) return new Map();
const ad=allR.data, n=ad.length/16, res=new Map();
for(let i=0;i<n;i++){ const h=hx(ad.subarray(i*16,i*16+16)); const ob=hex16(h);
const g=k=>m.get(hx(xor16(ob,hex16(k))));
const typeR=g(KEY_TYPE); if(!typeR) continue; const type=decUTF8(typeR.data); const sch=SCHEMA[type]; if(!sch) continue;
const p={__type:type};
const numsR=g(KEY_NUMS); const nums=numsR?decF32(numsR.data):[]; let ni=0;
for(const f of sch.f) p[f]=nums[ni++]??0;
for(const f of sch.i) p[f]=Math.round(nums[ni++]??0);
const boolsR=g(KEY_BOOLS); const bools=boolsR?boolsR.data:[]; sch.b.forEach((f,j)=>p[f]=!!bools[j]);
const enumsR=g(KEY_ENUMS); const enums=enumsR?enumsR.data:[]; sch.e.forEach((en,j)=>{ const idx=enums[j]||0; p[en[0]]=en[1][idx]||en[1][0]; });
if(sch.s){ const strR=g(KEY_STR); p[sch.s]=strR?decUTF8(strR.data):''; }
res.set(h,p); }
return res; }
async function fullBlob(){ const base=await buildHashBlob().arrayBuffer(); const recs=buildUIRecords();
let total=base.byteLength; recs.forEach(r=>total+=r.length);
const out=new Uint8Array(total); out.set(new Uint8Array(base),0); let o=base.byteLength;
recs.forEach(r=>{ out.set(r,o); o+=r.length; });
return new Blob([out],{type:'application/octet-stream'}); }
/* ===================== interchange formats ===================== */
const EXTERNAL_EXTENSIONS=new Set(SUPPORTED_FORMATS),extensionOf=name=>(String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||'');
let lastExternalExport=null;
function importedMaterialOptions(material,name){const color=material?.color||new THREE.Color(.72,.76,.8),hsl={h:0,s:0,l:0};color.getHSL(hsl);const emissive=material?.emissive||new THREE.Color(),ehsl={h:0,s:0,l:0};emissive.getHSL(ehsl);return {name:String(material?.name||name||'imported material'),h:hsl.h*360,s:hsl.s*100,l:hsl.l*100,emm:ehsl.l*100,rough:THREE.MathUtils.clamp((material?.roughness??.5)*100,0,100),metal:THREE.MathUtils.clamp((material?.metalness??0)*100,0,100),opac:THREE.MathUtils.clamp((1-(material?.opacity??1))*100,0,100),bump:0,map:material?.map?.image||null,texBytes:null,texMime:null,isDefault:false,mapFrame:defaultMapFrame(),mapPivot:new THREE.Matrix4()};}
function curveSplineData(curve){const data=SPLINE.createSplineData({angle:5}),sequence=SPLINE.addSplineSequence(data,!!curve.closed),points=curve.points.map(p=>p.map(Number)).filter(p=>p.length>=3&&p.every(Number.isFinite)),vertices=points.map(p=>SPLINE.addSplineVertex(data,p)),count=curve.closed?vertices.length:vertices.length-1;for(let i=0;i<count;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],chord=SPLINE.splineMath.mul(SPLINE.splineMath.sub(data.vertices[b],data.vertices[a]),1/3);SPLINE.addSplineSegment(data,sequence,a,b,chord,SPLINE.splineMath.mul(chord,-1));}return data;}
function prepareExternalImport(parsed,fileName){
  const records=[],materials=new Map(),materialRecords=[],topHash=genHash(),baseName=String(fileName||`import.${parsed.format}`).replace(/\.[^.]+$/,'')||'import';records.push({h:topHash,parent:null,name:baseName,type:TYPE_GROUP,matrix:new THREE.Matrix4(),geometry:null,tags:[],spline:null});
  const materialHash=material=>{if(materials.has(material))return materials.get(material);const h=genHash();materials.set(material,h);materialRecords.push({h,options:importedMaterialOptions(material,`imported ${materialRecords.length+1}`)});return h;};
  const visit=(object,parent)=>{
    if(!object||object.isCamera||object.isLight)return;object.updateMatrix?.();
    const h=genHash(),geometry=object.isMesh&&object.geometry?.attributes?.position?object.geometry.clone():null,tags=[];
    if(geometry){
      if(!geometry.index)geometry.setIndex(Array.from({length:geometry.attributes.position.count},(_,i)=>i));
      if(!geometry.attributes.normal)geometry.computeVertexNormals();
      const mats=(Array.isArray(object.material)?object.material:[object.material]).filter(Boolean);
      if(mats.length<=1&&mats[0])tags.push({type:1,ref:materialHash(mats[0]),polys:null,mapFrame:defaultMapFrame(),mapPivot:new THREE.Matrix4()});
      else if(mats.length)for(const group of geometry.groups){const mat=mats[group.materialIndex]||mats[0];if(!mat)continue;const polys=[];for(let at=group.start;at<group.start+group.count;at+=3)polys.push(at/3);tags.push({type:1,ref:materialHash(mat),polys,mapFrame:defaultMapFrame(),mapPivot:new THREE.Matrix4()});}
    }
    records.push({h,parent,name:String(object.userData?.frameName||object.name||`${parsed.format} object ${records.length}`),type:geometry?TYPE_MESH:TYPE_GROUP,matrix:object.matrix?.clone?.()||new THREE.Matrix4(),geometry,tags,spline:null});
    for(const child of object.children||[])visit(child,h);
  };
  if(parsed.root){const roots=parsed.root.isScene||parsed.root.type==='Group'?parsed.root.children:[parsed.root];for(const child of roots)visit(child,topHash);}
  for(const curve of parsed.curves||[]){if(!curve.points?.length)continue;records.push({h:genHash(),parent:topHash,name:String(curve.name||`${parsed.format} curve`),type:TYPE_MESH,matrix:new THREE.Matrix4(),geometry:null,tags:[],spline:curveSplineData(curve)});}
  if(records.length===1)throw new Error(`${parsed.format.toUpperCase()}: no compatible objects after conversion`);return {records,materialRecords,topHash,baseName};
}
function cmdImportExternal(prepared){const {records,materialRecords,topHash}=prepared;let applied=false;const install=()=>{for(const {h,options} of materialRecords)restoreMat(h,options);for(const record of records){const n={hash:record.h,name:record.name,type:record.type,parent:record.parent,children:records.filter(x=>x.parent===record.h).map(x=>x.h),visible:true,enabled:true,enableSlot:false,tags:record.tags.map(cloneTag),folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};setNodeFromLocal(n,record.matrix);OBJ.set(record.h,n);if(record.spline){objParams.set(record.h,{__type:'spline',angle:record.spline.approximation?.angle||5});installSplineObject(record.h,SPLINE.cloneSplineData(record.spline));}else if(record.geometry){const geometry=record.geometry.clone(),mesh=new THREE.Mesh(geometry,getThreeMat(record.tags[0]?.ref||defaultMatHash));mesh.matrixAutoUpdate=false;mesh.matrix.copy(localTmp(n));mesh.renderOrder=LAYER_OBJ;threeOf.set(record.h,mesh);registerPickMesh(record.h,mesh);assignMeshMat(mesh,record.h);}else{const object=new THREE.Object3D();object.matrixAutoUpdate=false;object.matrix.copy(localTmp(n));threeOf.set(record.h,object);}}
    rootOrder=[topHash,...rootOrder.filter(h=>!records.some(r=>r.h===h))];syncMeshParents();const root=threeOf.get(topHash);if(root&&!contentThrees.includes(root))contentThrees.push(root);selNodes.clear();selTags.clear();selNodes.add(topHash);anchorNode=OBJ.get(topHash);applied=true;};
  const remove=()=>{for(const record of records){if(record.spline)disposeSplineVisual(record.h,true);const wire=wireOverlays.get(record.h);if(wire){wireOverlays.delete(record.h);wire.parent?.remove(wire);wire.geometry?.dispose();wire.material?.dispose();}const points=polyPointOverlays.get(record.h);if(points){polyPointOverlays.delete(record.h);points.parent?.remove(points);points.material?.dispose();}const crease=creaseOverlays.get(record.h);if(crease){creaseOverlays.delete(record.h);crease.parent?.remove(crease);crease.geometry?.dispose();crease.material?.dispose();}}const root=threeOf.get(topHash);if(root){const at=contentThrees.indexOf(root);if(at>=0)contentThrees.splice(at,1);root.parent?.remove(root);disposeObjThrees(root);}for(const record of records){pickMeshes.delete(record.h);const t=threeOf.get(record.h);if(t?.isMesh)meshToHash.delete(t);threeOf.delete(record.h);objParams.delete(record.h);OBJ.delete(record.h);}rootOrder=rootOrder.filter(h=>h!==topHash);for(const {h} of materialRecords)deleteMat(h);selNodes.clear();selTags.clear();anchorNode=null;applied=false;};
  return {redo(){install();},undo(){remove();},dispose(){if(!applied)for(const record of records)record.geometry?.dispose();}};}
function buildExternalSnapshot(format){const root=new THREE.Group(),temporary=[],curves=[];root.name='FRAME scene';const build=h=>{const n=OBJ.get(h);if(!n)return null;const mesh=pickMeshes.get(h),node=mesh?.geometry?.attributes?.position?new THREE.Mesh(mesh.geometry,mesh.material):new THREE.Object3D();node.name=n.name;node.visible=n.visible;node.matrixAutoUpdate=false;node.matrix.copy(localTmp(n));node.userData.frameHash=h;node.userData.frameName=n.name;for(const child of n.children){const q=build(child);if(q)node.add(q);}if(splineData.has(h)){const data=evaluatedSplineData(h),wm=worldMatrix(n),lines=[];for(const sequence of SPLINE.approximateSpline(data)){const points=sequence.points.map(x=>x.position),worldPoints=points.map(p=>new THREE.Vector3().fromArray(p).applyMatrix4(wm).toArray());if(worldPoints.length>=2){const scale=Math.max(1,...worldPoints.flat().map(Math.abs)),planar=worldPoints.every(p=>Math.abs(p[2]-worldPoints[0][2])<=scale*1e-7);if(format!=='svg'||planar)curves.push({name:n.name,closed:sequence.closed,points:worldPoints});for(let i=1;i<points.length+(sequence.closed?1:0);i++)lines.push(...points[(i-1)%points.length],...points[i%points.length]);}}if(lines.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));const line=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xffffff,name:'Spline fallback'}));line.userData._frameFormatTemporary=true;node.add(line);temporary.push(line);}}return node;};for(const h of rootOrder){const node=build(h);if(node)root.add(node);}root.updateMatrixWorld(true);return {root,curves,dispose(){for(const line of temporary){line.geometry.dispose();line.material.dispose();}}};}
async function exportSceneFormat(format,options={}){const snapshot=buildExternalSnapshot(format);try{const result=await exportExternalScene(snapshot,format,options);lastExternalExport=result;if(options.download){downloadBlob(result.blob,options.name||result.name);for(const attachment of result.attachments||[])downloadBlob(attachment.blob,attachment.name);}return result;}finally{snapshot.dispose();}}
async function importParsedExternal(parsed,fileName){const prepared=prepareExternalImport(parsed,fileName);runCmd(cmdImportExternal(prepared));return {format:parsed.format,bytes:parsed.bytes,objects:prepared.records.length,materials:prepared.materialRecords.length,warnings:parsed.warnings,diagnostics:parsed.diagnostics,root:prepared.topHash};}
async function importExternalBlob(blob,name){const file=blob instanceof File?blob:new File([blob],name);return importParsedExternal(await importExternalFile(file),name);}
/* ===================== файлы ===================== */
const FSA=('showOpenFilePicker' in window)&&('showSaveFilePicker' in window);
const HASH_TYPES=[{description:'Hash scene',accept:{'application/x-frame-hash':['.hash']}}];
const EXTERNAL_TYPES=[{description:'glTF / GLB',accept:{'model/gltf+json':['.gltf'],'model/gltf-binary':['.glb']}},{description:'OBJ / STL / PLY',accept:{'text/plain':['.obj','.ply'],'model/stl':['.stl']}},{description:'SVG / DXF curves',accept:{'image/svg+xml':['.svg'],'application/dxf':['.dxf']}}];
let currentHandle=null, currentName=null;
let lastFileOperation={ok:true,operation:'idle'};
const fileInput=document.getElementById('fileInput');
const recentsBtn=document.getElementById('btnRecents'), recentsMenu=document.getElementById('recentsMenu');
function downloadBlob(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
let pendingParams=null,pendingSplinePayload=null;
function afterLoad(){ matUrl.clear(); rebuildMatCards(); liveMat=null;
draft=Object.assign({h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0},{map:null,texBytes:null,texMime:null});
document.body.style.setProperty('--h',draft.h); document.body.style.setProperty('--s',draft.s+'%'); document.body.style.setProperty('--l',draft.l+'%');
document.getElementById('btnDelTex').style.display='none'; document.getElementById('bumpLab').style.display='none'; document.getElementById('inpBump').style.display='none';
syncInputs(); updateMatPreview();
objParams.clear();
if(pendingParams){ for(const [h,p] of pendingParams){ if(getObj(h)) objParams.set(h,p); } pendingParams=null; }
eachNode(n=>{ if(n.type===TYPE_ENV&&!objParams.has(n.hash)){ const p=DEFAULTS.environment(); p.__type='environment'; objParams.set(n.hash,p); } });
const loadedSplines=new Map(Array.isArray(pendingSplinePayload)?pendingSplinePayload:[]);eachNode(n=>{if(objParams.get(n.hash)?.__type==='spline')installSplineObject(n.hash,loadedSplines.get(n.hash)||SPLINE.createSplineData(objParams.get(n.hash)));});pendingSplinePayload=null;syncAllParametricObjects();
selNodes.clear(); selTags.clear(); boundNode=null; lastBracketSig=null;
treeChanged(); updateHUD();
updateBrackets(); placeGizmoForSelection();
restoreAnimationPayload(pendingAnimation);pendingAnimation=null;
undoStack.length=0; redoStack.length=0; }
function reportFileError(error,operation='file'){lastFileOperation={ok:false,operation,error:error?.message||String(error)};const info=document.getElementById('dragInfo');if(info){info.textContent=lastFileOperation.error;info.style.left='8px';info.style.top='8px';info.classList.add('show');setTimeout(()=>info.classList.remove('show'),3500);}return lastFileOperation;}
async function loadFromHandle(handle,name){const file=await handle.getFile(),ext=extensionOf(name);if(ext==='hash'){const buf=await file.arrayBuffer();pendingParams=unpackUI(new Uint8Array(buf));rebuildFromBytes(new Uint8Array(buf));currentHandle=handle;currentName=name;addRecent(name,handle);afterLoad();lastFileOperation={ok:true,operation:'open-native',name,bytes:buf.byteLength};return lastFileOperation;}const result=await importExternalBlob(file,name);currentHandle=null;currentName=name;addRecent(name,handle);lastFileOperation={ok:true,operation:'import',name,...result};return lastFileOperation;}
async function loadFromFile(file){const ext=extensionOf(file.name);if(ext==='hash'){const buf=await file.arrayBuffer();pendingParams=unpackUI(new Uint8Array(buf));rebuildFromBytes(new Uint8Array(buf));currentHandle=null;currentName=file.name;addRecent(file.name,null);afterLoad();lastFileOperation={ok:true,operation:'open-native',name:file.name,bytes:buf.byteLength};return lastFileOperation;}const result=await importExternalBlob(file,file.name);currentHandle=null;currentName=file.name;addRecent(file.name,null);lastFileOperation={ok:true,operation:'import',name:file.name,...result};return lastFileOperation;}
async function doOpen(){if(FSA){try{const hs=await showOpenFilePicker({types:[...HASH_TYPES,...EXTERNAL_TYPES],multiple:false,excludeAcceptAllOption:false});const h=hs[0];await loadFromHandle(h,(await h.getFile()).name);}catch(error){if(error?.name!=='AbortError')reportFileError(error,'open');}}else fileInput.click();}
async function doSave(){ if(currentHandle){ try{ await writeHandle(currentHandle); return; }catch(e){ currentHandle=null; } }
if(FSA){ await doSaveAs(); } else downloadBlob(await fullBlob(), currentName||'scene.hash'); }
async function doSaveAs(){if(FSA){try{const h=await showSaveFilePicker({types:[...HASH_TYPES,...EXTERNAL_TYPES],suggestedName:extensionOf(currentName)==='hash'?currentName:'scene.hash',excludeAcceptAllOption:false});const result=await writeHandle(h);currentHandle=extensionOf(h.name)==='hash'?h:null;currentName=h.name;addRecent(h.name,currentHandle);lastFileOperation={ok:true,operation:'save-as',name:h.name,...result};}catch(error){if(error?.name!=='AbortError')reportFileError(error,'save-as');}}else downloadBlob(await fullBlob(),currentName||'scene.hash');}
async function writeHandle(handle){const ext=extensionOf(handle.name),w=await handle.createWritable();try{if(ext==='hash'){const blob=await fullBlob();await w.write(blob);return {format:'hash',bytes:blob.size};}if(!EXTERNAL_EXTENSIONS.has(ext))throw new Error(`Unsupported save extension .${ext||'?'}`);const result=await exportSceneFormat(ext);await w.write(result.blob);return {format:ext,bytes:result.bytes,warnings:result.warnings};}finally{await w.close();}}
function incName(name){ const dot=name.lastIndexOf('.'); const stem=dot>0?name.slice(0,dot):name; const ext=dot>0?name.slice(dot):'';
const m=stem.match(/^(.*?)([\s_]?)(\d+)$/); let ns; if(m){ ns=m[1]+m[2]+(parseInt(m[3],10)+1); } else ns=stem+' 1'; return ns+ext; }
async function doSaveInc(){ const name=incName(currentName||'scene.hash');
if(FSA){ try{ const h=await showSaveFilePicker({types:HASH_TYPES,suggestedName:name,excludeAcceptAllOption:true}); await writeHandle(h); currentHandle=h; currentName=h.name; addRecent(h.name,h); }catch(e){} }
else downloadBlob(await fullBlob(), name); }
async function doDownload(){ downloadBlob(await fullBlob(), currentName||'scene.hash'); }
function doNew(){ clearScene(); matUrl.clear(); currentHandle=null; currentName=null; objParams.clear();
resetTimeline();
createDefaultMat(); rebuildMatCards();
liveMat=null; draft=Object.assign({h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0},{map:null,texBytes:null,texMime:null});
document.body.style.setProperty('--h',draft.h); document.body.style.setProperty('--s',draft.s+'%'); document.body.style.setProperty('--l',draft.l+'%');
document.getElementById('btnDelTex').style.display='none'; document.getElementById('bumpLab').style.display='none'; document.getElementById('inpBump').style.display='none';
syncInputs(); updateMatPreview(); selNodes.clear(); selTags.clear(); boundNode=null; uvEdit=null; lastBracketSig=null;
setGizmoVisible(false); if(uvFrameLines)uvFrameLines.visible=false;
treeChanged(); updateHUD();
updateBrackets(); placeGizmoForSelection();
clearHistory();render(); }
fileInput.onchange=async e=>{const f=e.target.files[0];if(f)try{await loadFromFile(f);}catch(error){reportFileError(error,'import');}fileInput.value='';};
document.getElementById('btnNew').onclick=doNew;
document.getElementById('btnOpen').onclick=doOpen;
document.getElementById('btnSave').onclick=doSave;
document.getElementById('btnSaveAs').onclick=doSaveAs;
document.getElementById('btnSaveInc').onclick=doSaveInc;
document.getElementById('btnDownload').onclick=doDownload;
document.getElementById('btnDownload').oncontextmenu=async e=>{e.preventDefault();const format=String(prompt(`Export format: ${SUPPORTED_FORMATS.join(', ')}`,'glb')||'').trim().toLowerCase().replace(/^\./,'');if(!format)return;try{const result=await exportSceneFormat(format,{download:true});lastFileOperation={ok:true,operation:'export',format,bytes:result.bytes,warnings:result.warnings};}catch(error){reportFileError(error,'export');}};
const IDB_NAME='hashEditorRecents', IDB_STORE='handles';
function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(IDB_NAME,1);
r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE); };
r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function saveHandle(name,handle){ try{ const db=await idb(); db.transaction(IDB_STORE,'readwrite').objectStore(IDB_STORE).put(handle,name); }catch(e){} }
async function getHandle(name){ try{ const db=await idb(); return await new Promise(res=>{ const rq=db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(name); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>res(null); }); }catch(e){ return null; } }
function getNames(){ try{ return JSON.parse(localStorage.getItem('recents')||'[]'); }catch(e){ return []; } }
function setNames(a){ try{ localStorage.setItem('recents',JSON.stringify(a)); }catch(e){} }
function addRecent(name,handle){ let a=getNames().filter(x=>x!==name); a.unshift(name); if(a.length>12)a.length=12; setNames(a); if(handle&&FSA) saveHandle(name,handle); }
async function openRecent(name){ if(FSA){ const h=await getHandle(name);
if(h){ try{ let p=await h.queryPermission({mode:'read'}); if(p!=='granted') p=await h.requestPermission({mode:'read'});
if(p==='granted'){ await loadFromHandle(h,name); return; } }catch(e){} } } fileInput.click(); }
function renderRecents(){ const names=getNames(); recentsMenu.innerHTML='';
if(!names.length){ const d=document.createElement('div'); d.className='ritem empty'; d.textContent='(no recent files)'; recentsMenu.appendChild(d); return; }
for(const n of names){ const d=document.createElement('div'); d.className='ritem'; d.textContent=n; d.title=n; d.dataset.name=n; recentsMenu.appendChild(d); } }
function showRecents(){ renderRecents(); const r=recentsBtn.getBoundingClientRect(); recentsMenu.style.left=r.left+'px'; recentsMenu.style.top=r.bottom+'px'; recentsMenu.classList.add('show'); }
recentsBtn.addEventListener('pointerdown',e=>{ e.preventDefault(); showRecents(); });
addEventListener('pointerup',e=>{ if(!recentsMenu.classList.contains('show'))return;
const item=e.target.closest&&e.target.closest('.ritem'); if(item&&!item.classList.contains('empty')&&item.dataset.name) openRecent(item.dataset.name);
recentsMenu.classList.remove('show'); });
/* ===================== клавиатура ===================== */
addEventListener('keydown',e=>{
const mod=e.ctrlKey||e.metaKey;
if(splineBevelTool&&e.key==='Escape'){cancelSplineBevelTool();hideVertexContextMenu();e.preventDefault();return;}
if(splineOutlineTool&&e.key==='Escape'){cancelSplineOutlineTool();hideVertexContextMenu();e.preventDefault();return;}
if(splineMode&&e.key==='Escape'){if(splineDrawing)finishSplineDrawing();hideVertexContextMenu();e.preventDefault();return;}
if((e.key==='Control'||e.key==='Meta')){if(splineMode)updateHover(vpLastX,vpLastY,e);if(polyMode&&polyElementMode==='vertex'&&!vertexTools.mode){const vi=viewAt(vpLastX,vpLastY);if(vi>=0){clearPolyHover();updateAddPointPreview(vpLastX,vpLastY,vi);}}}
if(vertexTools.mode==='lineCut'){finishLineCut();if(e.key==='Escape'){e.preventDefault();return;}}
if(vertexTools.mode==='closeHole'&&e.key==='Escape'){leaveVertexTool(false);e.preventDefault();return;}
if(vertexTools.mode==='addPoint'&&e.key==='Escape'){leaveVertexTool(false);e.preventDefault();return;}
if(vertexTools.mode==='loop'&&e.key==='Escape'){leaveVertexTool(false);e.preventDefault();return;}
if(vertexTools.soft.active&&e.key==='Escape'){disableSoftSelection();e.preventDefault();return;}
if(mod&&e.code==='KeyZ'){ if(isEditing())return; e.preventDefault(); if(e.shiftKey)redo(); else undo(); return; }
if(mod&&e.code==='KeyY'){ if(isEditing())return; e.preventDefault(); redo(); return; }
if(mod&&e.code==='KeyC'){ if(isEditing())return; e.preventDefault();
if(selNodes.size) clipNodes=[...selNodes]; return; }
if(mod&&e.code==='KeyV'){ if(isEditing())return; e.preventDefault();
if(clipNodes&&clipNodes.length){ const cmd=cmdDuplicateToRoot(clipNodes); runCmd(cmd); copyObjParams(cmd.map);
selNodes.clear(); selTags.clear(); cmd.newRoots.forEach(h=>selNodes.add(h));
anchorNode=cmd.newRoots.length?getObj(cmd.newRoots[0]):null; lastBracketSig=null; refreshSelClasses(); } return; }
if(mod&&e.code==='KeyA'){ if(isEditing())return; e.preventDefault();
if(splineMode||polyMode){if(splineMode){splineSelectionClearElements();for(const h of selNodes)for(const vid of Object.keys(splineData.get(h)?.vertices||{}))splineSelection.vertices.add(splineElementKey(h,vid));updateAllSplineVisuals();}if(polyMode)selectAllPolyElements();placeGizmoForSelection();return;}
selNodes.clear();selTags.clear();for(const h of OBJ.keys())selNodes.add(h);anchorNode=selNodes.size?getObj(selNodes.values().next().value):null;refreshSelClasses();return; }
if(!mod&&!isEditing()){
if(e.code==='KeyC'){e.preventDefault();runCmd(cmdConnectDelete([...selNodes]));return;}
if(e.code==='KeyW'){blurActive();if(splineFocusActive()){selectConnectedSpline();hideVertexContextMenu();return;}setCoordMode(coordMode==='world'?'object':'world');updateHUD();return;}
if(e.code==='KeyS'){ toggleSnap(); return; }
if(e.code==='KeyQ'){ toggleQuant(); return; }
if(e.code==='KeyP'){if(e.repeat)return;pivotKeyDown=true;pivotKeyGesture=false;pivotKeyRestorePending=false;pivotKeyOriginal=editPivot;setEditPivot(!editPivot);return;}
if(e.code==='KeyZ'){ e.preventDefault(); const vi=viewAt(vpLastX,vpLastY); if(vi>=0&&selNodes.size){if(!splineMode||!frameSplineSelection(vi))frameHashes(vi,[...selNodes]);} return; }
}
if(activeTabId()==='tabMaterials' && !isEditing()){
if((e.key==='Delete'||e.key==='Backspace') && selMats.size){ e.preventDefault(); runCmd(cmdDeleteMats([...selMats])); }
return; }
if(!isEditing()&&treeActive&&(e.key==='Delete'||e.key==='Backspace')&&selNodes.size){e.preventDefault();runCmd(cmdDelete([...selNodes]));selNodes.clear();selTags.clear();anchorNode=null;renderRows();refreshSelClasses();return;}
if(!isEditing()&&vertexEditActive&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();if(splineDrawing){deleteLastSplineDrawPoint();return;}if(splineMode)deleteSelectedSplineElements();if(polyMode)deleteSelectedPolyElements();return;}
if(!isEditing()&&splineMode&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();if(splineDrawing){deleteLastSplineDrawPoint();return;}deleteSelectedSplineElements();return;}
if(!isEditing()&&polyMode&&(e.key==='Delete'||e.key==='Backspace')){e.preventDefault();deleteSelectedPolyElements();return;}
if(!isEditing() && (e.key==='Delete'||e.key==='Backspace') && (selNodes.size||selTags.size)){
e.preventDefault();
if(selNodes.size){ runCmd(cmdDelete([...selNodes])); selNodes.clear(); }
else { runCmd(cmdDeleteTags([...selTags])); selTags.clear(); }
renderRows(); refreshSelClasses(); return; }
if(!treeActive||isEditing())return;
const vn=flatRows.map(r=>r.node); if(!vn.length)return;
const cur=anchorNode&&vn.includes(anchorNode)?anchorNode:vn[0], ci=vn.indexOf(cur);
const sel1=n=>{ selNodes.clear(); selTags.clear(); selNodes.add(n.hash); anchorNode=n; scrollIntoRow(n); refreshSelClasses(); };
if(e.key==='ArrowDown'){ e.preventDefault(); sel1(vn[Math.min(ci+1,vn.length-1)]); }
else if(e.key==='ArrowUp'){ e.preventDefault(); sel1(vn[Math.max(ci-1,0)]); }
else if(e.key==='Home'){ e.preventDefault(); sel1(vn[0]); }
else if(e.key==='End'){ e.preventDefault(); sel1(vn[vn.length-1]); }
else if(e.key==='ArrowRight'){ e.preventDefault(); if(cur.children.length){ if(cur.folded){ setObjField(cur.hash,'folded',false); treeChanged(); }
else { const ch=getObj(cur.children[0]); if(ch) sel1(ch); } } }
else if(e.key==='ArrowLeft'){ e.preventDefault(); if(cur.children.length&&!cur.folded){ setObjField(cur.hash,'folded',true); treeChanged(); }
else if(cur.parent){ sel1(getObj(cur.parent)); } }
});
addEventListener('keyup',e=>{if(e.code==='KeyP'&&pivotKeyDown){if(pivotKeyGesture&&gizDrag)pivotKeyRestorePending=true;else finishMomentaryPivot();return;}if(e.key==='Control'||e.key==='Meta'){if(splineMode)updateHover(vpLastX,vpLastY,e);if(polyMode&&polyElementMode==='vertex'&&!vertexTools.mode){hideVertexToolGuides();updatePolyHover(vpLastX,vpLastY);}}});
function scrollIntoRow(n){ const i=flatRows.findIndex(r=>r.node===n); if(i<0)return;
const top=i*17, bot=top+17; if(top<obScroll.scrollTop)obScroll.scrollTop=top; else if(bot>obScroll.scrollTop+obScroll.clientHeight)obScroll.scrollTop=bot-obScroll.clientHeight; }
document.addEventListener('selectstart',e=>{ const t=e.target; if(t.tagName==='INPUT'||t.tagName==='TEXTAREA')return; e.preventDefault(); });
function installFrameAI(){
const resolveObjects=refs=>{const a=Array.isArray(refs)?refs:[refs],out=[];for(const ref of a){if(OBJ.has(ref)){out.push(ref);continue;}for(const [h,n] of OBJ)if(n.name===ref)out.push(h);}return [...new Set(out)];};
const coordinates=()=>{const t=readTransform(coordMode);return {position:t.p.toArray(),size:t.s.toArray(),rotation:[t.e.x*R2D,t.e.y*R2D,t.e.z*R2D],space:coordMode,unit:'mm'};};
const selection=()=>{const sub={};for(const [h,s] of polySelection.items)sub[h]={vertices:[...s.vertices],edges:[...s.edges],faces:[...s.faces]};const spline={vertices:[...splineSelection.vertices],handles:[...splineSelection.handles],segments:[...splineSelection.segments],anchor:splineSelection.anchor,drawing:splineDrawing,drawSequence:splineDrawSequence,lastVertex:splineLastVertex};return {objects:[...selNodes],tags:[...selTags],subobjects:sub,spline};};
const state=()=>({version:'0.4',mode:vertexEditActive?'vertex':polyMode?polyElementMode:'object',componentFocus,coordinates:coordinates(),selection:selection(),views:{layout:vpState.mode,singleView:vpState.singleView,shading:viewShading.slice()},objects:[...OBJ.values()].map(n=>{const p=objParams.get(n.hash),derived=derivedState(n.hash),sd=splineData.get(n.hash),mesh=pickMeshes.get(n.hash);return {hash:n.hash,name:n.name,type:n.type,generator:p?.__type||null,generatorError:derived?.error||null,generatorReport:derived?.report||null,virtualCage:derived?.virtualCage?{segments:derived.virtualCage.segments,polylines:derived.virtualCage.polylines.length}:null,source:p?.source||null,parent:n.parent,children:n.children.slice(),visible:n.visible,effectiveVisible:effectiveVisible(n.hash),meshVisible:mesh?.visible??null,nodeVisible:threeOf.get(n.hash)?.visible??null,enabled:n.enabled,vertices:sd?Object.keys(sd.vertices).length:mesh?.geometry?.attributes.position?.count||0,segments:sd?Object.keys(sd.segments).length:undefined,triangles:sd?0:(mesh?.geometry?.index?.count||mesh?.geometry?.attributes.position?.count||0)/3};})});
const setMode=mode=>{if(mode==='object'||mode==null){if(vertexEditActive||splineMode)leaveSplineEdit();else if(polyMode)setPolyElementMode(polyElementMode);return state();}if(mode==='spline'){if(!vertexEditActive&&!enterSplineEdit(false))throw new Error('select spline objects first');if(!selectedSplineNodes().length)throw new Error('select spline objects first');componentFocus='spline';placeGizmoForSelection();return state();}if(!['vertex','edge','face'].includes(mode))throw new Error('mode must be object, spline, vertex, edge or face');if(mode==='vertex'){if(!vertexEditActive)setPolyElementMode('vertex');}else if(!polyMode||polyElementMode!==mode||vertexEditActive)setPolyElementMode(mode);return state();};
const selectObjects=(refs,options={})=>{const hashes=resolveObjects(refs),mode=options.mode||'replace';if(mode==='replace'){selNodes.clear();selTags.clear();}for(const h of hashes){if(mode==='toggle'&&selNodes.has(h))selNodes.delete(h);else selNodes.add(h);}anchorNode=selNodes.size?OBJ.get([...selNodes][selNodes.size-1]):null;lastBracketSig=null;refreshSelClasses();placeGizmoForSelection();return selection();};
const selectSubobjects=(spec={})=>{const h=resolveObjects(spec.object)[0];if(!h||!pickMeshes.has(h))throw new Error('mesh object not found');let kind=spec.kind;if(!kind)kind=spec.vertices?'vertex':spec.edges?'edge':spec.faces?'face':null;if(!kind)throw new Error('subobject kind is required');setMode(kind);if(!selNodes.has(h)){selNodes.clear();selNodes.add(h);refreshSelClasses();}polyPivotMatrix=null;if((spec.mode||'replace')==='replace')polySelection.items.clear();const s=polySelEntry(h),mesh=pickMeshes.get(h),g=mesh.geometry;if(kind==='vertex'){for(const vi of spec.vertices||spec.ids||[])if(Number.isInteger(vi)&&vi>=0&&vi<g.attributes.position.count)coincidentVertexIds(mesh,vi).forEach(v=>s.vertices.add(v));}else if(kind==='edge'){const byKey=new Map();for(const edge of logicalEdges(g))for(const key of edge.keys)byKey.set(key,edge);for(const item of spec.edges||spec.ids||[]){const key=Array.isArray(item)?polyEdgeKey(+item[0],+item[1]):String(item),edge=byKey.get(key);if(edge)edge.keys.forEach(k=>s.edges.add(k));}}else{const count=(g.index?g.index.count:g.attributes.position.count)/3;for(const fi of spec.faces||spec.ids||[])if(Number.isInteger(fi)&&fi>=0&&fi<count)s.faces.add(fi);}rebuildPolySelection();return selection();};
const setCoordinates=values=>{
if(!gizmoVisible)throw new Error('nothing is selected');
const pivotObject=editPivot&&boundNode&&boundNode!==UV_VIRTUAL?boundNode:null,pivotBefore=pivotObject?(OBJ.get(pivotObject)?.pivot.elements.slice()||null):null,before=coordinateSnapshot(),apply=(ch,v)=>{if(!Array.isArray(v))return;for(let i=0;i<3;i++)if(Number.isFinite(v[i]))applyInput(ch,i,v[i]);};
apply('pos',values.position);apply('rot',values.rotation);apply('size',values.size);syncCube();
if(pivotObject){
bridgeTransform();const pivotAfter=OBJ.get(pivotObject)?.pivot.elements.slice()||null;
if(pivotBefore&&pivotAfter&&!mat4Close(pivotBefore,pivotAfter))pushCmd({redo(){setNodePivot(pivotObject,pivotAfter);placeGizmoForSelection();scheduleGeneratorEvaluation(0);},undo(){setNodePivot(pivotObject,pivotBefore);placeGizmoForSelection();scheduleGeneratorEvaluation(0);}});
}else if(polyMode&&editPivot){polyPivotMatrix=getGizmoWorldArray().slice();scheduleRender();}
else {bridgeTransform();commitCoordinateSnapshot(before);}
updateHUD();scheduleGeneratorEvaluation(0);scheduleRender();return coordinates();
};
const viewRect=view=>{const vi=view??(vpState.mode==='single'?vpState.singleView:0),r=rectFor(vi);if(!r)throw new Error('view not found');return {view:vi,x:r.x,y:r.y,width:r.w,height:r.h};};
const screenBounds=(ref,view)=>{const h=resolveObjects(ref)[0],mesh=pickMeshes.get(h),sd=splineData.get(h),vr=viewRect(view),cam=vpState.views[vr.view].cam;if(!mesh&&!sd)throw new Error('geometry object not found');const points=sd?Object.values(sd.vertices).map(p=>splineWorldPoint(h,p)):(()=>{mesh.updateMatrixWorld(true);const pos=mesh.geometry.attributes.position,out=[],p=new THREE.Vector3();for(let i=0;i<pos.count;i++)out.push(new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld));return out;})(),mn=new THREE.Vector2(Infinity,Infinity),mx=new THREE.Vector2(-Infinity,-Infinity);for(const p of points){const q=projectPx(p,cam,{x:vr.x,y:vr.y,w:vr.width,h:vr.height});mn.min(new THREE.Vector2(q[0],q[1]));mx.max(new THREE.Vector2(q[0],q[1]));}return {object:h,view:vr.view,x0:mn.x,y0:mn.y,x1:mx.x,y1:mx.y};};
const vertexScreens=(ref,view)=>{const h=resolveObjects(ref)[0],mesh=pickMeshes.get(h),vr=viewRect(view),cam=vpState.views[vr.view].cam;if(!mesh)throw new Error('mesh object not found');mesh.updateMatrixWorld(true);const pos=mesh.geometry.attributes.position,p=new THREE.Vector3();return vertexTopology(mesh.geometry).groups.map((group,id)=>{p.fromBufferAttribute(pos,group[0]).applyMatrix4(mesh.matrixWorld);const q=projectPx(p,cam,{x:vr.x,y:vr.y,w:vr.width,h:vr.height});return {id,vertices:group.slice(),screen:[q[0],q[1]],world:p.toArray()};});};
const meshEdges=ref=>{const h=resolveObjects(ref)[0],mesh=pickMeshes.get(h),pos=mesh?.geometry?.attributes.position;if(!mesh||!pos)throw new Error('mesh object not found');return logicalEdges(mesh.geometry).map((e,id)=>({id,keys:e.keys.slice(),vertices:[e.a,e.b],points:[new THREE.Vector3().fromBufferAttribute(pos,e.a).toArray(),new THREE.Vector3().fromBufferAttribute(pos,e.b).toArray()]}));};
const marquee=options=>{if(!polyMode&&!splineMode)throw new Error('enable a subobject mode first');const vr=viewRect(options.view),x0=Number.isFinite(options.x0)?options.x0:vr.x+(options.u0||0)*vr.width,y0=Number.isFinite(options.y0)?options.y0:vr.y+(options.v0||0)*vr.height,x1=Number.isFinite(options.x1)?options.x1:vr.x+(options.u1??1)*vr.width,y1=Number.isFinite(options.y1)?options.y1:vr.y+(options.v1??1)*vr.height,t=performance.now(),mode=options.mode||'replace';if(splineMode)splineBoxPick(x0,y0,x1,y1,mode);if(polyMode)polyBoxPick(x0,y0,x1,y1,mode);return {milliseconds:performance.now()-t,box:{x0,y0,x1,y1},selection:selection()};};
const vertexToolState=()=>({mode:vertexTools.mode,visibleOnly:vertexTools.visibleOnly,soft:vertexTools.soft.active,radius:vertexTools.soft.radius,view:vertexTools.view,linePoints:vertexTools.line.map(p=>({type:p.type,h:p.h,screen:p.screen.slice()})),loopVertices:vertexTools.loop?.nodes.length||0,hole:vertexTools.hole?{object:vertexTools.hole.h,edges:vertexTools.hole.loop.ids.length}:null,snap:vertexTools.snap?{type:vertexTools.snap.type,h:vertexTools.snap.h,screen:vertexTools.snap.screen.slice()}:null});
const runVertexTool=(name,options={})=>{if(!polyMode||polyElementMode!=='vertex')throw new Error('vertex mode is required');if(name==='addPoint')activateAddPoint();else if(name==='lineCut')activateLineCut();else if(name==='loop')activateLoopSelection();else if(name==='soft'){if(Number.isFinite(options.radius))vertexTools.soft.radius=Math.max(0,options.radius);enableSoftSelection();}else if(name==='finish')stopVertexModeTool();else if(name==='cancel')leaveVertexTool(false);else throw new Error('unknown vertex tool');if(typeof options.visibleOnly==='boolean')vertexTools.visibleOnly=options.visibleOnly;return vertexToolState();};
const vertexToolMove=options=>{const vi=options.view??0;if(vertexTools.mode==='addPoint')updateAddPointPreview(options.x,options.y,vi);else if(vertexTools.mode==='lineCut')updateLineCutPreview(options.x,options.y,vi);else if(vertexTools.mode==='loop')updateLoopPreview(options.x,options.y,vi);else throw new Error('no previewable vertex tool is active');return vertexToolState();};
const setAIView=(layout='single',view=0)=>{if(!['single','quad'].includes(layout))throw new Error('layout must be single or quad');if(!Number.isInteger(view)||view<0||view>3)throw new Error('view must be 0..3');vpState.mode=layout;vpState.singleView=view;scheduleRender();return state().views;};
const vertexToolClick=options=>{const vi=options.view??0;if(vertexTools.mode==='addPoint'){if(!addPointToolClick(options.x,options.y,vi))leaveVertexTool(false);}else if(vertexTools.mode==='lineCut'){if(!lineCutAddPoint(options.x,options.y,vi))finishLineCut();}else if(vertexTools.mode==='loop'){updateLoopPreview(options.x,options.y,vi);if(vertexTools.loop)applyLoopSelection(options.mode||'replace');else leaveVertexTool(false);}else if(vertexTools.mode==='soft'){const hit=polyClickPick(options.x,options.y,options.mode||'replace');if(hit)recalculateSoftSelection();else leaveVertexTool(false);}else throw new Error('no clickable vertex tool is active');return {tool:vertexToolState(),selection:selection()};};
const setVertexToolOptions=options=>{if(typeof options.visibleOnly==='boolean')vertexTools.visibleOnly=options.visibleOnly;if(Number.isFinite(options.radius)){vertexTools.soft.radius=Math.max(0,options.radius);if(vertexTools.soft.active)recalculateSoftSelection();}lastAttrKey=null;refreshAttributesPanel();return vertexToolState();};
const runFaceTool=(name,options={})=>{if(!polyMode||polyElementMode!=='face')throw new Error('face mode is required');if(typeof options.visibleOnly==='boolean')vertexTools.visibleOnly=options.visibleOnly;if(name==='lineCut')activateLineCut();else if(name==='closeHole')activateCloseHole();else if(name==='finish')leaveVertexTool();else if(name==='cancel')leaveVertexTool(false);else throw new Error('unknown face tool');return vertexToolState();};
const faceToolMove=options=>{const vi=options.view??0;if(vertexTools.mode==='lineCut')updateLineCutPreview(options.x,options.y,vi);else if(vertexTools.mode==='closeHole')updateCloseHolePreview(options.x,options.y,vi);else throw new Error('no previewable face tool is active');return vertexToolState();};
const faceToolClick=options=>{const vi=options.view??0;if(vertexTools.mode==='lineCut'){if(!lineCutAddPoint(options.x,options.y,vi))finishLineCut();}else if(vertexTools.mode==='closeHole'){updateCloseHolePreview(options.x,options.y,vi);if(!closeHoveredHole())leaveVertexTool(false);}else throw new Error('no clickable face tool is active');return {tool:vertexToolState(),selection:selection()};};
const runEdgeTool=(name,options={})=>{if(!polyMode||polyElementMode!=='edge')throw new Error('edge mode is required');if(typeof options.visibleOnly==='boolean')vertexTools.visibleOnly=options.visibleOnly;if(name==='lineCut')activateLineCut();else if(name==='bridge')bridgeSelectedEdges();else if(name==='loop')activateLoopSelection();else if(name==='finish')leaveVertexTool();else if(name==='cancel')leaveVertexTool(false);else throw new Error('unknown edge tool');return vertexToolState();};
const edgeToolMove=options=>{const vi=options.view??0;if(vertexTools.mode==='lineCut')updateLineCutPreview(options.x,options.y,vi);else if(vertexTools.mode==='loop')updateLoopPreview(options.x,options.y,vi);else throw new Error('no previewable edge tool is active');return vertexToolState();};
const edgeToolClick=options=>{const vi=options.view??0;if(vertexTools.mode==='lineCut'){if(!lineCutAddPoint(options.x,options.y,vi))finishLineCut();}else if(vertexTools.mode==='loop'){updateLoopPreview(options.x,options.y,vi);if(vertexTools.loop)applyLoopSelection(options.mode||'replace');else leaveVertexTool(false);}else throw new Error('no clickable edge tool is active');return {tool:vertexToolState(),selection:selection()};};
const setEdgeToolOptions=options=>{if(typeof options.visibleOnly==='boolean')vertexTools.visibleOnly=options.visibleOnly;lastAttrKey=null;refreshAttributesPanel();return vertexToolState();};
const transformSubobjects=(options={})=>{if(!polyMode||!polySelection.items.size)throw new Error('subobject selection is required');const hashes=[...polySelection.items.keys()],beforeGeom=capturePolyGeometries(hashes),beforeSel=capturePolySelectionState();if(options.extrude&&(polyElementMode==='edge'||polyElementMode==='face'))extrudeSelectedForDrag();const snap=capturePolySelection(),frame=polyFrameMatrix(),pivot=new THREE.Vector3().setFromMatrixPosition(frame),tr=Array.isArray(options.translate)?options.translate:[0,0,0],rr=Array.isArray(options.rotate)?options.rotate:[0,0,0],ss=Array.isArray(options.scale)?options.scale:[1,1,1],delta=new THREE.Matrix4().makeTranslation(pivot.x+(+tr[0]||0),pivot.y+(+tr[1]||0),pivot.z+(+tr[2]||0)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((+rr[0]||0)*D2R,(+rr[1]||0)*D2R,(+rr[2]||0)*D2R))).multiply(new THREE.Matrix4().makeScale(Number.isFinite(+ss[0])?+ss[0]:1,Number.isFinite(+ss[1])?+ss[1]:1,Number.isFinite(+ss[2])?+ss[2]:1)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));applyPolyDelta(delta,snap);orientExtrudedFaces();const logical=capturePolyLogicalSelection();polyExactEdgeVertices=null;for(const h of hashes)rebuildCreaseRender(pickMeshes.get(h));restorePolyLogicalSelection(logical);rebuildPolySelection(true);const afterGeom=capturePolyGeometries(hashes),afterSel=capturePolySelectionState();pushCmd({redo(){restorePolyGeometries(afterGeom);restorePolySelectionState(afterSel);},undo(){restorePolyGeometries(beforeGeom);restorePolySelectionState(beforeSel);}});return {selection:selection(),topology:hashes.map(h=>meshTopology(h))};};
const meshTopology=ref=>{const h=resolveObjects(ref)[0],mesh=pickMeshes.get(h);if(!mesh)throw new Error('mesh object not found');const g=mesh.geometry,pos=g.attributes.position,index=g.index,faces=(index?index.count:pos.count)/3,incidence=new Map(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let degenerateFaces=0;for(let fi=0;fi<faces;fi++){const ids=[index?index.getX(fi*3):fi*3,index?index.getX(fi*3+1):fi*3+1,index?index.getX(fi*3+2):fi*3+2];a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]);if(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()<1e-16)degenerateFaces++;for(let e=0;e<3;e++){const p=new THREE.Vector3().fromBufferAttribute(pos,ids[e]),q=new THREE.Vector3().fromBufferAttribute(pos,ids[(e+1)%3]),key=localEdgeKey(p,q);incidence.set(key,(incidence.get(key)||0)+1);}}let boundaryEdges=0,nonManifoldEdges=0;const issues=[];for(const [key,n] of incidence){if(n===1)boundaryEdges++;else if(n>2)nonManifoldEdges++;if(n!==2&&issues.length<24)issues.push({key,count:n});}return {object:h,vertices:pos.count,logicalVertices:vertexTopology(g).groups.length,edges:incidence.size,faces,boundaryEdges,nonManifoldEdges,degenerateFaces,issues};};
const meshDiagnostics=ref=>{const h=resolveObjects(ref)[0],mesh=pickMeshes.get(h);if(!mesh)throw new Error('mesh object not found');const g=mesh.geometry,pos=g.attributes.position,idx=g.index,count=(idx?idx.count:pos.count)/3,edges=new Map(),triangles=[];for(let fi=0;fi<count;fi++){const ids=[idx?idx.getX(fi*3):fi*3,idx?idx.getX(fi*3+1):fi*3+1,idx?idx.getX(fi*3+2):fi*3+2],points=ids.map(i=>new THREE.Vector3().fromBufferAttribute(pos,i)),normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();triangles.push({fi,ids,points:points.map(p=>p.toArray()),normal:normal.toArray()});for(let e=0;e<3;e++){const key=localEdgeKey(points[e],points[(e+1)%3]),a=edges.get(key)||[];a.push(fi);edges.set(key,a);}}return [...edges].filter(([,faces])=>faces.length!==2).map(([key,faces])=>({key,count:faces.length,faces:faces.map(fi=>triangles[fi])}));};
const deleteSubobjects=()=>{if(!polyMode)throw new Error('subobject mode is required');deleteSelectedPolyElements();return selection();};
const makePolygonal=refs=>{if(refs!=null)selectObjects(refs);const cmd=cmdMakePolygonal([...selNodes]);if(!cmd)throw new Error('selected objects contain no geometry');runCmd(cmd);return {object:cmd.result,state:state()};};
const splineTopology=ref=>{const h=resolveObjects(ref)[0],d=evaluatedSplineData(h);if(!d)throw new Error('spline object not found');const copy=SPLINE.cloneSplineData(d),derived=SPLINE.resolveSplineTopology(d);return {object:h,approximation:{...d.approximation},vertices:Object.fromEntries(Object.entries(d.vertices).map(([id,p])=>[id,{local:p.slice(),world:splineWorldPoint(h,p).toArray()}])),segments:Object.fromEntries(Object.entries(copy.segments).map(([id,s])=>[id,{id,a:s.a,b:s.b,ha:s.ha,hb:s.hb,soft:!!s.soft}])),freeHandles:copy.freeHandles||{},components:derived.components,closedContours:derived.contours.map(c=>({id:c.id,vertices:c.vertices,segments:c.edges.map(e=>e.id),planar:c.planar})),patchCells:derived.patchCells.map(c=>({id:c.id,vertices:c.vertices,segments:c.edges.map(e=>e.id)})),warnings:derived.warnings,validation:SPLINE.validateSpline(d),bevelTags:splineBevelTags(h).map(cloneTag)};};
const splineSurfaceAI=ref=>{const h=resolveObjects(ref)[0];if(!h)throw new Error('object not found');if(splineData.has(h)){const v=splineVisuals.get(h),built=v?.surface||buildSplineSurfaceMeshData(evaluatedSplineData(h));return {object:h,source:h,report:built.report,cells:built.topology.patchCells.map(c=>c.vertices),contours:built.topology.planarContours.map(c=>c.vertices)};}if(objParams.get(h)?.__type==='spline_patch'){const state=replicaStates.get(h),child=OBJ.get(h)?.children[0];return {object:h,source:child||null,ready:!!state?.ready,error:state?.error||null,report:state?.report||null,cells:state?.topology?.patchCells?.map(c=>c.vertices)||[],contours:state?.topology?.planarContours?.map(c=>c.vertices)||[]};}throw new Error('spline or Spline Patch object not found');};
const splineVertexScreens=(ref,view)=>{const h=resolveObjects(ref)[0],d=evaluatedSplineData(h),vr=viewRect(view),cam=vpState.views[vr.view].cam;if(!d)throw new Error('spline object not found');return Object.entries(d.vertices).map(([id,p])=>{const world=splineWorldPoint(h,p),q=projectPx(world,cam,{x:vr.x,y:vr.y,w:vr.width,h:vr.height});return {id,screen:[q[0],q[1]],world:world.toArray()};});};
const splineHandleScreens=(ref,vertex,view)=>{const h=resolveObjects(ref)[0],d=evaluatedSplineData(h),vr=viewRect(view),cam=vpState.views[vr.view].cam;if(!d?.vertices[vertex])throw new Error('spline vertex not found');return splineEditableHandles(d,vertex).map(q=>{const world=splineWorldPoint(h,q.position),p=projectPx(world,cam,{x:vr.x,y:vr.y,w:vr.width,h:vr.height});return {segment:q.segment,side:q.side,screen:[p[0],p[1]],world:world.toArray()};});};
const splineSegmentScreens=(ref,view)=>{const h=resolveObjects(ref)[0],d=evaluatedSplineData(h),vr=viewRect(view),cam=vpState.views[vr.view].cam;if(!d)throw new Error('spline object not found');return Object.keys(d.segments).map(id=>{const local=SPLINE.cubicPoint(SPLINE.segmentPoints(d,id),.5),world=splineWorldPoint(h,local),p=projectPx(world,cam,{x:vr.x,y:vr.y,w:vr.width,h:vr.height});return {id,t:.5,screen:[p[0],p[1]],world:world.toArray()};});};
const splineHitAI=(options={})=>{const vr=viewRect(options.view),x=Number.isFinite(options.x)?options.x:vr.x+(options.u??.5)*vr.width,y=Number.isFinite(options.y)?options.y:vr.y+(options.v??.5)*vr.height,hit=splineScreenHit(x,y,{editing:options.editing??splineMode,vertices:options.vertices!==false,handles:options.handles!==false,segments:options.segments!==false,radiusSegment:Number.isFinite(options.radiusSegment)?options.radiusSegment:SNAP_PX});return hit&&{kind:hit.kind,object:hit.object,id:hit.id,side:hit.side||null,t:hit.t||0,distancePx:Math.sqrt(hit.d2),world:hit.world.toArray()};};
const selectSplineElements=(spec={})=>{const h=resolveObjects(spec.object)[0],d=evaluatedSplineData(h);if(!d)throw new Error('spline object not found');selNodes.clear();selTags.clear();selNodes.add(h);anchorNode=OBJ.get(h);refreshSelClasses();enterSplineEdit(false);if((spec.mode||'replace')==='replace')splineSelectionClearElements();for(const id of spec.vertices||[])if(d.vertices[id])splineSelection.vertices.add(splineElementKey(h,id));for(const id of spec.segments||[])if(d.segments[id])splineSelection.segments.add(splineElementKey(h,id));for(const q of spec.handles||[]){const token=typeof q==='string'?parseSplineHandleKey(q):q,info=token&&splineHandleInfo(d,token.segment,token.side);if(info)splineSelection.handles.add(splineElementKey(h,splineHandleKey(token.segment,token.side)));}const first=(spec.vertices||[])[0],firstSegment=(spec.segments||[])[0];if(first&&d.vertices[first]){splineSelection.active={kind:'vertex',object:h,id:first};splineSelection.anchor={object:h,id:first};}else if(firstSegment&&d.segments[firstSegment]){const s=d.segments[firstSegment];splineSelection.active={kind:'segment',object:h,id:firstSegment};splineSelection.anchor={object:h,id:s.a};}else {const q=(spec.handles||[])[0],token=typeof q==='string'?parseSplineHandleKey(q):q,info=token&&splineHandleInfo(d,token.segment,token.side);if(info){splineSelection.active={kind:'handle',object:h,id:token.segment,side:token.side};splineSelection.anchor={object:h,id:info.vertex};}}updateAllSplineVisuals();placeGizmoForSelection();return selection();};
const runSplineCommand=name=>{if(name==='hard'||name==='soft'||name==='equalLength'||name==='equalDirection')splineTangentCommand(name);else if(name==='connected')selectConnectedSpline();else if(name==='delete')deleteSelectedSplineElements();else throw new Error('unknown spline command');return selection();};
const splitSpline=(ref,segment,t=.5)=>{const h=resolveObjects(ref)[0],d=splineData.get(h);if(!d?.segments[segment])throw new Error('spline segment not found');let result;mutateSplineObjects([h],()=>{result=SPLINE.splitSplineSegment(d,segment,t);});return {result,topology:splineTopology(h)};};
const connectDelete=refs=>{if(refs!=null)selectObjects(refs);const cmd=cmdConnectDelete([...selNodes]);if(!cmd)throw new Error('Connect + Delete has no applicable geometry');runCmd(cmd);return {object:cmd.result||null,state:state()};};
const beginSplineComponent=ref=>{if(ref!=null)selectObjects(ref);if(!beginSplineDrawOnActive())throw new Error('select a spline object first');return state();};
const splineDrawPointAI=(options={})=>{const vr=viewRect(options.view),x=Number.isFinite(options.x)?options.x:vr.x+(options.u??.5)*vr.width,y=Number.isFinite(options.y)?options.y:vr.y+(options.v??.5)*vr.height;if(Array.isArray(options.dragWorld)){const v=new THREE.Vector3(+options.dragWorld[0]||0,+options.dragWorld[1]||0,+options.dragWorld[2]||0);return {added:addSplineDrawPoint(x,y,vr.view,{dragWorld:v.lengthSq()>1e-12?v:null}),state:state()};}return {added:splineClick(x,y,{ctrl:!!options.ctrl,shift:!!options.shift}),state:state()};};
const finishSplineComponent=()=>{finishSplineDrawing();return state();};
const deleteLastSplinePointAI=()=>({deleted:deleteLastSplineDrawPoint(),state:state()});
const transformSplineElements=(options={})=>{const owners=splineSelectionOwners(),fullBefore=captureSplineFullState(owners),beforeSel=splineSelectionState(),frame=splineFrameMatrix();if(!owners.length||!frame)throw new Error('select spline elements first');autoBakeSplineTags(owners);const before=splineDataSnapshot(),pivot=new THREE.Vector3().setFromMatrixPosition(frame),tr=Array.isArray(options.translate)?options.translate:[0,0,0],rr=Array.isArray(options.rotate)?options.rotate:[0,0,0],ss=Array.isArray(options.scale)?options.scale:[1,1,1],scale=ss.map(x=>Number.isFinite(+x)?+x:1),delta=new THREE.Matrix4().makeTranslation(pivot.x+(+tr[0]||0),pivot.y+(+tr[1]||0),pivot.z+(+tr[2]||0)).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((+rr[0]||0)*D2R,(+rr[1]||0)*D2R,(+rr[2]||0)*D2R))).multiply(new THREE.Matrix4().makeScale(...scale)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));applySplineTransformSnapshot(before,delta,{ctrl:!!options.ctrl,shift:!!options.shift,weldCoincident:scale.some(x=>Math.abs(x)<1e-9)});const fullAfter=captureSplineFullState(owners),afterSel=splineSelectionState();pushCmd({redo(){restoreSplineFullState(fullAfter,afterSel);},undo(){restoreSplineFullState(fullBefore,beforeSel);}});return {selection:selection(),topology:owners.map(splineTopology)};};
const addSplineBevelAI=(options={})=>{const owners=splineSelectionOwners(),eligibility=splineBevelSelection();if(!createSplineBevelTag(options))throw new Error('Vertex Bevel requires valence-2 spline vertices: '+JSON.stringify({domain:eligibility.domain,eligible:Object.fromEntries(eligibility.grouped),active:splineSelection.active}));return {objects:owners,tags:owners.flatMap(h=>splineBevelTags(h).map(cloneTag)),topology:owners.map(splineTopology)};};
const bakeSplineBevelAI=(ref,index='last')=>{const h=resolveObjects(ref)[0],n=OBJ.get(h);if(!n||!splineData.has(h))throw new Error('spline object not found');let i=index==='last'?n.tags.map((t,j)=>t.type===2?j:-1).filter(j=>j>=0).at(-1):Number(index);if(!Number.isInteger(i)||n.tags[i]?.type!==2)throw new Error('Bevel tag not found');runCmd(cmdBakeBevelThrough(h,i));return splineTopology(h);};
const outlineSplineAI=(options={})=>{const distance=Number(options.distance);if(!Number.isFinite(distance)||Math.abs(distance)<1e-9)throw new Error('Outline distance must be a non-zero number');const tool=beginSplineOutline({interactive:false,distance});if(!tool)throw new Error('Outline requires non-branched spline segments in one plane');return {distance,objects:tool.items.map(x=>x.h),generated:tool.results,topology:tool.items.map(x=>splineTopology(x.h))};};
const gizmoStateAI=()=>{const m=getGizmoWorldArray(),basis=[0,1,2].map(i=>{const k=i*4,n=Math.hypot(m[k],m[k+1],m[k+2])||1;return [m[k]/n,m[k+1]/n,m[k+2]/n];});return {visible:gizmoVisible,matrix:m,position:[m[12],m[13],m[14]],basis,bounds:{min:gizmoBoundsMin.toArray(),max:gizmoBoundsMax.toArray()},coordinateSpace:coordMode,local:gizmoLocal,editPivot,selectionPivot:splineSelection.pivot&&splineSelection.pivot.slice(),quantize:quantOn,snapping:snapOn,quantum:quantStep(),whiteScreenHandle:splineMode&&gizmoVisible};};
const gizmoHandlesAI=(viewIndex=null)=>{
const vi=Number.isInteger(viewIndex)?viewIndex:(vpState.mode==='single'?vpState.singleView:0),view=vpState.views[vi],r=rectFor(vi);
if(!view||!r||!gizmoVisible)return {view:vi,visible:false,handles:[]};
const fr=applyGizmo(view,r),grp=fr.mode3D?gizmo3D:(view.flat==='XZ'?flatXZ:view.flat==='XY'?flatXY:flatYZ),objects=grp.children.slice();
if(smallRing?.visible)objects.push(smallRing);if(sector?.visible)objects.push(sector);
const handles=[];
for(const object of objects){
const geo=object.geometry,pos=geo?.attributes?.position;if(!pos)continue;object.updateMatrixWorld(true);
let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity,sumX=0,sumY=0,p=new THREE.Vector3();const screens=[];
for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(object.matrixWorld);const s=projectPx(p,view.cam,r);screens.push(s);sumX+=s[0];sumY+=s[1];x0=Math.min(x0,s[0]);y0=Math.min(y0,s[1]);x1=Math.max(x1,s[0]);y1=Math.max(y1,s[1]);}
if(!Number.isFinite(x0))continue;
const candidates=[[(x0+x1)/2,(y0+y1)/2],[sumX/pos.count,sumY/pos.count]],idx=geo.index,ic=idx?idx.count:pos.count;
for(let i=0;i+2<ic;i+=3){const ia=idx?idx.getX(i):i,ib=idx?idx.getX(i+1):i+1,icx=idx?idx.getX(i+2):i+2,a=screens[ia],b=screens[ib],c=screens[icx];candidates.push([(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3]);}
let suggested=null;for(const candidate of candidates){const hit=hitGizmo(candidate[0],candidate[1]);if(hit?.object===object){suggested=candidate;break;}}
if(suggested)handles.push({name:object.name,bounds:{x0,y0,x1,y1},suggested});
}
return {view:vi,visible:true,pivot:projectPx(gizmo.pos,view.cam,r),handles};};
const gizmoHitAI=(options={})=>{const vr=viewRect(options.view),x=Number.isFinite(options.x)?options.x:vr.x+(options.u??.5)*vr.width,y=Number.isFinite(options.y)?options.y:vr.y+(options.v??.5)*vr.height,hit=hitGizmo(x,y);return hit?{view:hit.view,name:hit.object.name,point:[x,y]}:null;};
const viewStateAI=()=>({layout:vpState.mode,singleView:vpState.singleView,solo:soloSet&&[...soloSet],views:vpState.views.map((v,i)=>{const r=rectFor(i);return {index:i,type:v.type,rect:r&&{x:r.x,y:r.y,width:r.w,height:r.h},camera:{position:v.cam.position.toArray(),quaternion:v.cam.quaternion.toArray(),zoom:v.cam.isOrthographicCamera?view_ctrl_zoom(v.cam):null},navigationTarget:v.ctrl.handle.toArray(),controllerZoom:v.ctrl.zoom??null,shading:viewShading[i]};}),visibility:[...OBJ.keys()].map(h=>({object:h,effective:effectiveVisible(h)}))});
const setSplineTestOptions=(options={})=>{if('quantize'in options)setQuantize(!!options.quantize);if('snapping'in options)setSnap(!!options.snapping);syncQuantSnap();if(options.coordinateSpace)setCoordMode(options.coordinateSpace);if('editPivot'in options)setEditPivot(!!options.editPivot);else placeGizmoForSelection();return gizmoStateAI();};
const setSoloAI=refs=>{const hashes=refs==null?null:new Set(resolveObjects(refs));setSoloHashes(hashes);soloOn=!!(hashes&&hashes.size);btnSolo.classList.toggle('on',soloOn);treeChanged();return viewStateAI();};
const findObjectsAI=(query={})=>{if(typeof query==='string')query={name:query};const name=String(query.name||'').toLowerCase(),generator=query.generator==null?null:String(query.generator);return state().objects.filter(o=>(!name||o.name.toLowerCase().includes(name))&&(generator===null||o.generator===generator)&&(query.visible==null||o.visible===!!query.visible)&&(query.enabled==null||o.enabled===!!query.enabled));};
const setObjectFieldAI=(refs,field,value,options={})=>{const hashes=resolveObjects(refs);if(!hashes.length)throw new Error('no matching objects');const before=new Map(hashes.map(h=>[h,!!OBJ.get(h)?.[field]])),next=!!value,apply=values=>{for(const [h,v] of values)setObjField(h,field,v);treeChanged();lastBracketSig=null;scheduleGeneratorEvaluation(0);scheduleRender();};const after=new Map(hashes.map(h=>[h,next]));if(options.undo===false)apply(after);else runCmd({redo(){apply(after);},undo(){apply(before);}});return {changed:hashes,field,value:next,objects:state().objects.filter(o=>hashes.includes(o.hash))};};
const showAllObjectsAI=(options={})=>setObjectFieldAI([...OBJ.keys()],'visible',true,options);
const renameObjectAI=(ref,name,options={})=>{const h=resolveObjects(ref)[0],n=OBJ.get(h);if(!n)throw new Error('object not found');name=String(name||'').trim();if(!name)throw new Error('name is required');const before=n.name,apply=v=>{const q=OBJ.get(h);if(q)q.name=v;treeChanged();};if(options.undo===false)apply(name);else runCmd({redo(){apply(name);},undo(){apply(before);}});return state().objects.find(o=>o.hash===h);};
const createMaterialAI=(name='material',values={})=>{const h=makeMat({...values,name:String(name||'material'),isDefault:false,mapFrame:defaultMapFrame(),mapPivot:new THREE.Matrix4()});syncThreeMat(h);rebuildMatCards();return {hash:h,name:MATS.get(h).name};};
const resolveMaterialRef=ref=>{if(MATS.has(ref))return ref;for(const [h,m] of MATS)if(m.name===ref)return h;throw new Error('material not found');};
const objectMaterialAI=ref=>{const h=resolveObjects(ref)[0],n=OBJ.get(h);if(!n)throw new Error('object not found');const binding=resolveMatBinding(h);return {object:h,resolved:binding.hash,default:defaultMatHash,isDefault:binding.hash===defaultMatHash,tags:n.tags.filter(t=>t.type===1).map(cloneTag)};};
const assignMaterialAI=(refs,material,options={})=>{const hashes=resolveObjects(refs),mh=resolveMaterialRef(material);if(!hashes.length)throw new Error('no matching objects');const before=new Map(hashes.map(h=>[h,OBJ.get(h).tags.map(cloneTag)])),after=new Map(before);for(const h of hashes){const tags=before.get(h).filter(t=>!(t.type===1&&t.polys==null));tags.push({type:1,ref:mh,polys:null,mapFrame:defaultTagMapFrame(h),mapPivot:new THREE.Matrix4()});after.set(h,tags);}const apply=snap=>{for(const [h,tags] of snap)OBJ.get(h).tags=tags.map(cloneTag);};if(options.undo===false){apply(after);refreshMaterials();treeChanged();}else runCmd({redo(){apply(after);},undo(){apply(before);}});return hashes.map(objectMaterialAI);};
const clearMaterialTagsAI=(refs,options={})=>{const hashes=resolveObjects(refs),ids=hashes.flatMap(h=>OBJ.get(h).tags.map((t,i)=>t.type===1?tagId(h,i):null).filter(Boolean));if(ids.length){if(options.undo===false){cmdDeleteTags(ids).redo();refreshMaterials();treeChanged();}else runCmd(cmdDeleteTags(ids));}return hashes.map(objectMaterialAI);};
const setViewCameraAI=(options={})=>{const vi=Number.isInteger(options.view)?options.view:(vpState.mode==='single'?vpState.singleView:0),view=vpState.views[vi];if(!view)throw new Error('view must be 0..3');const cam=view.cam;if(Array.isArray(options.position)&&options.position.length>=3)cam.position.fromArray(options.position);if(Array.isArray(options.target)&&options.target.length>=3){view.ctrl.handle.fromArray(options.target);if(view.type==='persp'&&!Array.isArray(options.quaternion))cam.lookAt(view.ctrl.handle);}if(Array.isArray(options.quaternion)&&options.quaternion.length>=4)cam.quaternion.fromArray(options.quaternion).normalize();if(Number.isFinite(options.zoom)&&cam.isOrthographicCamera){view.ctrl.zoom=THREE.MathUtils.clamp(+options.zoom,MINZ,MAXZ);_zoomOf.set(cam,view.ctrl.zoom);lastOrthoView=vi;}cam.updateMatrixWorld(true);scheduleRender();return viewStateAI();};
const splineApproximationAI=(ref,options={})=>{const h=resolveObjects(ref)[0],d=splineData.get(h);if(!d)throw new Error('spline object not found');const includePoints=options.points!==false;return {object:h,approximation:{...d.approximation},paths:SPLINE.approximateSpline(d).map(q=>({closed:q.closed,count:q.points.length,duplicateClosure:q.closed&&q.points.length>1&&SPLINE.splineMath.dist(q.points[0].position,q.points.at(-1).position)<1e-9,...(includePoints?{points:q.points.map(p=>({segment:p.segmentId,t:p.t,local:p.position.slice(),world:splineWorldPoint(h,p.position).toArray()}))}:{})}))};};
const setSplineApproximationAI=(ref,options={},commandOptions={})=>{const h=resolveObjects(ref)[0],p=objParams.get(h);if(!p||!splineData.has(h))throw new Error('spline object not found');const before={angle:THREE.MathUtils.clamp(Math.round(+p.angle||5),1,180)},after={angle:Number.isFinite(Number(options.angle))?THREE.MathUtils.clamp(Math.round(Number(options.angle)),1,180):before.angle},apply=value=>{p.angle=value.angle;delete p.interp;delete p.points;splineApproximation(h);updateSplineVisual(h);lastAttrKey=null;refreshAttributesPanel();scheduleRender();};if(commandOptions.undo===false)apply(after);else runCmd({redo(){apply(after);},undo(){apply(before);}});return splineApproximationAI(h,{points:false});};
const splineFixtureFactory=kind=>({cage:SPLINE.createSplineCageStressData,stress:SPLINE.createSplineStressData,'three-circles':SPLINE.createSplineThreeCircleConflictData,'quad-closed':SPLINE.createSplineQuadClosedData,'mixed-closed':SPLINE.createSplineMixedClosedData,sphere:SPLINE.createSplineSphereCageData,'ngon-5':()=>SPLINE.createSplineNgonClosedData(5),'ngon-12':()=>SPLINE.createSplineNgonClosedData(12,{irregular:true}),'ngon-warped':()=>SPLINE.createSplineNgonClosedData(9,{irregular:true,warped:true}),'two-vertex-closed':SPLINE.createClosedTwoVertexTestData,'extrude-profile':SPLINE.createExtrudeProfileTestData,'lathe-profile':SPLINE.createLatheProfileTestData,'sweep-profile':SPLINE.createSweepProfileTestData,'sweep-path':SPLINE.createSweepPathTestData,'compound-profile':SPLINE.createCompoundProfileTestData,'nested-profile':SPLINE.createNestedProfileTestData,'closed-sweep-path':SPLINE.createClosedSweepPathTestData}[kind]||null);
const setSplineFixtureAI=(ref,kind='cage',options={})=>{const h=resolveObjects(ref)[0],p=objParams.get(h);if(!h||!p||!splineData.has(h))throw new Error('spline object not found');const factory=splineFixtureFactory(kind);if(!factory)throw new Error('unknown spline fixture');const before=SPLINE.cloneSplineData(splineData.get(h)),after=factory(),apply=data=>{const copy=SPLINE.cloneSplineData(data);splineData.set(h,copy);p.angle=copy.approximation.angle;delete p.interp;delete p.points;updateSplineVisual(h);lastAttrKey=null;refreshAttributesPanel();placeGizmoForSelection();};if(options.undo===false)apply(after);else runCmd({redo(){apply(after);},undo(){apply(before);}});return splineSurfaceAI(h);};
const createSplineFixtureAI=(kind,name=kind)=>{const factory=splineFixtureFactory(kind);if(!factory)throw new Error('unknown spline fixture');const cmd=cmdAddSplineObject(factory(),name,{enterDrawing:false});runCmd(cmd);return {object:cmd.result,topology:splineTopology(cmd.result)};};
const createSplinePrimitiveAI=(type,params={})=>{if(!PARAMETRIC_SPLINE_TYPES.has(type))throw new Error('type must be square, circle, polyhedron or text');const h=addPlain(type,TYPE_MESH,false),p=objParams.get(h);Object.assign(p,params||{}, {__type:type});syncParametricObject(h);if(splineMode)leaveSplineEdit();return {object:h,type,params:{...p},topology:splineTopology(h)};};
const createSplineGeneratorAI=(type,refs,params={})=>{if(!['extrude','lathe','sweep','spline_patch'].includes(type))throw new Error('type must be extrude, lathe, sweep or spline_patch');const resolved=resolveObjects(refs),hashes=type==='sweep'?resolved:sortByTreeOrder(resolved);if(!WRAP_RULES[type]?.(hashes))throw new Error(`${type} input selection is invalid`);selNodes.clear();selTags.clear();for(const h of hashes)selNodes.add(h);const h=addWrap(type,TYPE_GEN,true),p=objParams.get(h);Object.assign(p,params||{});lastAttrKey=null;refreshAttributesPanel();scheduleGeneratorEvaluation(0);return {object:h,children:OBJ.get(h)?.children.slice(),params:{...p}};};
const setGeneratorParamsAI=(ref,values={},options={})=>{const h=resolveObjects(ref)[0],p=objParams.get(h);if(!h||!p||!['extrude','lathe','sweep','spline_patch'].includes(p.__type))throw new Error('spline generator not found');const before={...p},after={...p,...values,__type:p.__type},apply=value=>{objParams.set(h,{...value});lastAttrKey=null;refreshAttributesPanel();scheduleGeneratorEvaluation(0);};if(options.undo===false)apply(after);else runCmd({redo(){apply(after);},undo(){apply(before);}});return {object:h,params:{...objParams.get(h)}};};
const toSplinePatchAI=ref=>{const h=resolveObjects(ref)[0],cmd=h&&cmdParametricToSplinePatch(h);if(!cmd)throw new Error('object has no generated spline cage');runCmd(cmd);return {object:h,type:objParams.get(h)?.__type,child:OBJ.get(h)?.children[0]||null};};
const splineGeneratorAI=ref=>{const h=resolveObjects(ref)[0],p=objParams.get(h),state=replicaStates.get(h),mesh=pickMeshes.get(h);if(!h||!p||(!['extrude','lathe','sweep','spline_patch'].includes(p.__type)&&!PARAMETRIC_MESH_TYPES.has(p.__type)))throw new Error('spline generator not found');return {object:h,type:p.__type,params:{...p},children:OBJ.get(h)?.children.slice()||[],ready:!!state?.ready,error:state?.error||null,report:state?.report||null,cageVisible:!!state?.cage?.visible,cage:state?.virtualCage||(state?.generatedCageData?{data:state.generatedCageData}:null),mesh:state?.ready&&mesh?.geometry?.attributes?.position?meshTopology(h):null};};
const applyTransformSpec=(n,transform={})=>{const position=transform.position||[0,0,0],rotation=transform.rotation||[0,0,0],scale=transform.scale||[1,1,1];n.pos.fromArray(position);n.lin.makeRotationFromEuler(new THREE.Euler((+rotation[0]||0)*D2R,(+rotation[1]||0)*D2R,(+rotation[2]||0)*D2R)).scale(new THREE.Vector3(Number.isFinite(+scale[0])?+scale[0]:1,Number.isFinite(+scale[1])?+scale[1]:1,Number.isFinite(+scale[2])?+scale[2]:1));};
const createInstanceAI=(ref,name='instance',transform={})=>{const source=resolveObjects(ref)[0];if(!source)throw new Error('instance source not found');const h=addPlain('instance',TYPE_GEN,false),p=objParams.get(h),n=OBJ.get(h);p.source=source;n.name=String(name||'instance');applyTransformSpec(n,transform);syncMeshParents();scheduleGeneratorEvaluation(0,[h]);treeChanged();return {object:h,source};};
const createInstanceCloudAI=(ref,count=1000,options={})=>{const source=resolveObjects(ref)[0],total=Number(count);if(!source)throw new Error('instance source not found');if(!Number.isInteger(total)||total<1||total>10000)throw new Error('instance count must be an integer from 1 to 10000');const spacing=Number.isFinite(+options.spacing)?+options.spacing:150,columns=Math.max(1,Math.ceil(Math.sqrt(total))),hashes=Array.from({length:total},()=>genHash()),oldSel=[...selNodes],oldTags=[...selTags],create=()=>{for(let i=0;i<hashes.length;i++){const h=hashes[i],n={hash:h,name:`${options.name||'instance'} ${i+1}`,type:TYPE_GEN,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3(((i%columns)-(columns-1)*.5)*spacing,0,(Math.floor(i/columns)-(Math.ceil(total/columns)-1)*.5)*spacing),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};OBJ.set(h,n);objParams.set(h,{__type:'instance',source});}rootOrder=[...hashes,...rootOrder.filter(h=>!hashes.includes(h))];selNodes.clear();selTags.clear();if(hashes.length)selNodes.add(hashes[0]);anchorNode=OBJ.get(hashes[0])||null;},destroy=()=>{for(const h of hashes){const state=replicaStates.get(h);if(state)disposeReplicaState(h,state);const t=threeOf.get(h);if(t){t.parent?.remove(t);threeOf.delete(h);}OBJ.delete(h);objParams.delete(h);}rootOrder=rootOrder.filter(h=>!hashes.includes(h));selNodes.clear();selTags.clear();for(const h of oldSel)if(OBJ.has(h))selNodes.add(h);for(const id of oldTags)selTags.add(id);anchorNode=selNodes.size?OBJ.get([...selNodes][0]):null;};runCmd({redo(){create();},undo(){destroy();}});scheduleGeneratorEvaluation(0,hashes);return {source,objects:hashes,count:hashes.length};};
const createStressGridAI=(name='million-grid',triangles=1000000)=>{const triangleCount=Number(triangles);if(!Number.isInteger(triangleCount)||triangleCount<2||triangleCount>1000000||triangleCount%2)throw new Error('triangle count must be an even integer from 2 to 1000000');const started=performance.now(),cells=triangleCount/2,columns=Math.max(1,Math.floor(Math.sqrt(cells))),rows=Math.ceil(cells/columns),positions=new Float32Array((rows+1)*(columns+1)*3),normals=new Float32Array(positions.length),indices=new Uint32Array(triangleCount*3);for(let z=0;z<=rows;z++)for(let x=0;x<=columns;x++){const v=(z*(columns+1)+x)*3;positions[v]=x-columns*.5;positions[v+2]=z-rows*.5;normals[v+1]=1;}for(let cell=0;cell<cells;cell++){const z=Math.floor(cell/columns),x=cell%columns,a=z*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1,o=cell*6;indices[o]=a;indices[o+1]=c;indices[o+2]=b;indices[o+3]=b;indices[o+4]=c;indices[o+5]=d;}const assembled=performance.now(),h=genHash(),node={hash:h,name:String(name||'million-grid'),type:TYPE_MESH,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3(),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()};let mesh=null;const create=()=>{OBJ.set(h,node);rootOrder=[h,...rootOrder.filter(x=>x!==h)];const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh=new THREE.Mesh(geometry,getThreeMat(defaultMatHash));mesh.userData._largeSharedGeometry=true;mesh.matrixAutoUpdate=false;mesh.matrix.copy(localTmp(node));mesh.renderOrder=LAYER_OBJ;vpState.scene.add(mesh);contentThrees.push(mesh);threeOf.set(h,mesh);registerPickMesh(h,mesh);},destroy=()=>{if(mesh){const at=contentThrees.indexOf(mesh);if(at>=0)contentThrees.splice(at,1);mesh.parent?.remove(mesh);disposeObjThrees(mesh);meshToHash.delete(mesh);}pickMeshes.delete(h);threeOf.delete(h);OBJ.delete(h);rootOrder=rootOrder.filter(x=>x!==h);mesh=null;};runCmd({redo(){create();selNodes.clear();selTags.clear();selNodes.add(h);anchorNode=node;},undo(){destroy();}});return {object:h,vertices:positions.length/3,triangles:triangleCount,assemblyMilliseconds:assembled-started,totalMilliseconds:performance.now()-started,bytes:positions.byteLength+normals.byteLength+indices.byteLength};};
const performanceStatsAI=()=>{refreshGeneratorRegistry();const shared=[...replicaStates].filter(([,state])=>state.sharedGeometry),uniqueSharedGeometries=new Set(shared.map(([,state])=>state.mesh?.geometry).filter(Boolean));return {generator:{...generatorPerformance,averageMilliseconds:generatorPerformance.passes?generatorPerformance.totalMilliseconds/generatorPerformance.passes:0,registry:generatorRegistry.size,pendingTargets:pendingGeneratorTargets.size,allPending:generatorAllPending,activePasses:generatorActivePasses},render:{...renderPerformance,averageMilliseconds:renderPerformance.frames?renderPerformance.totalMilliseconds/renderPerformance.frames:0},phases:{...phasePerformance,averageSelectionMilliseconds:phasePerformance.selectionCalls?phasePerformance.selectionMilliseconds/phasePerformance.selectionCalls:0,averageWireOverlayMilliseconds:phasePerformance.wireOverlayCalls?phasePerformance.wireOverlayMilliseconds/phasePerformance.wireOverlayCalls:0},instances:{shared:shared.length,uniqueGeometries:uniqueSharedGeometries.size}};};
const resetPerformanceStatsAI=()=>{for(const key of Object.keys(generatorPerformance))generatorPerformance[key]=0;for(const key of Object.keys(renderPerformance))renderPerformance[key]=0;for(const key of ['selectionCalls','selectionMilliseconds','wireOverlayCalls','wireOverlayMilliseconds','bvhBuilds','bvhMilliseconds'])phasePerformance[key]=0;return performanceStatsAI();};
const createPrimitiveAI=(type='cube',name=type,params={},transform={})=>{if(!PARAMETRIC_MESH_TYPES.has(type))throw new Error('type must be cube, cylinder, tube or sphere');const h=addPlain(type,TYPE_MESH,false),p=objParams.get(h),n=OBJ.get(h);if(name)n.name=String(name);Object.assign(p,params||{}, {__type:type});const position=transform.position||[0,0,0],rotation=transform.rotation||[0,0,0],scale=transform.scale||[1,1,1];n.pos.fromArray(position);n.lin.makeRotationFromEuler(new THREE.Euler((+rotation[0]||0)*D2R,(+rotation[1]||0)*D2R,(+rotation[2]||0)*D2R)).scale(new THREE.Vector3(Number.isFinite(+scale[0])?+scale[0]:1,Number.isFinite(+scale[1])?+scale[1]:1,Number.isFinite(+scale[2])?+scale[2]:1));syncParametricObject(h);syncMeshParents();scheduleGeneratorEvaluation(0);treeChanged();return {object:h,params:{...p}};};
const createPolygonMeshAI=(name='Polygon',positions=[],indices=[],transform={})=>{if(!Array.isArray(positions)||positions.length%3||positions.some(x=>!Number.isFinite(+x)))throw new Error('positions must be a finite xyz array');if(!Array.isArray(indices)||indices.length%3||indices.some(x=>!Number.isInteger(x)||x<0||x>=positions.length/3))throw new Error('indices must be a valid triangle index array');const h=genHash(),oldSel=[...selNodes],node={hash:h,name:String(name||'Polygon'),type:TYPE_MESH,parent:null,children:[],visible:true,enabled:true,enableSlot:false,tags:[],folded:false,pos:new THREE.Vector3().fromArray(transform.position||[0,0,0]),lin:new THREE.Matrix4(),pivot:new THREE.Matrix4()},rotation=transform.rotation||[0,0,0],scale=transform.scale||[1,1,1];node.lin.makeRotationFromEuler(new THREE.Euler((+rotation[0]||0)*D2R,(+rotation[1]||0)*D2R,(+rotation[2]||0)*D2R)).scale(new THREE.Vector3(Number.isFinite(+scale[0])?+scale[0]:1,Number.isFinite(+scale[1])?+scale[1]:1,Number.isFinite(+scale[2])?+scale[2]:1));let mesh=null;const create=()=>{OBJ.set(h,node);rootOrder=rootOrder.filter(x=>x!==h);rootOrder.unshift(h);const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(new THREE.Uint32BufferAttribute(indices,1));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh=new THREE.Mesh(geometry,getThreeMat(defaultMatHash));mesh.matrixAutoUpdate=false;mesh.matrix.copy(localTmp(node));mesh.renderOrder=LAYER_OBJ;vpState.scene.add(mesh);contentThrees.push(mesh);threeOf.set(h,mesh);registerPickMesh(h,mesh);initCreaseRender(mesh);};const destroy=()=>{const wire=wireOverlays.get(h);if(wire){wire.parent?.remove(wire);wire.geometry.dispose();wire.material.dispose();wireOverlays.delete(h);}if(mesh){const i=contentThrees.indexOf(mesh);if(i>=0)contentThrees.splice(i,1);mesh.parent?.remove(mesh);disposeObjThrees(mesh);meshToHash.delete(mesh);}pickMeshes.delete(h);threeOf.delete(h);OBJ.delete(h);rootOrder=rootOrder.filter(x=>x!==h);mesh=null;};runCmd({redo(){create();selNodes.clear();selTags.clear();selNodes.add(h);anchorNode=node;},undo(){destroy();selNodes.clear();for(const x of oldSel)if(OBJ.has(x))selNodes.add(x);anchorNode=selNodes.size?OBJ.get([...selNodes][0]):null;}});return {object:h,vertices:positions.length/3,triangles:indices.length/3};};
const createBooleanAI=(refs,operation='subtract')=>{const hashes=resolveObjects(refs);if(hashes.length!==2)throw new Error('Boolean requires exactly two operands');if(!['subtract','intersect','union'].includes(operation))throw new Error('operation must be subtract, intersect or union');selNodes.clear();selTags.clear();for(const h of hashes)selNodes.add(h);const h=addWrap('boolean',TYPE_GEN,true),p=objParams.get(h),n=OBJ.get(h);p.op=operation;p.operandOrder=hashes.slice();n.children=hashes.slice();scheduleGeneratorEvaluation(0);return {object:h,operands:hashes.slice(),operation};};
const setBooleanOperationAI=(ref,operation,options={})=>{const h=resolveObjects(ref)[0],p=objParams.get(h);if(!h||p?.__type!=='boolean')throw new Error('Boolean node not found');if(!['subtract','intersect','union'].includes(operation))throw new Error('operation must be subtract, intersect or union');const before=p.op,apply=value=>{p.op=value;lastAttrKey=null;refreshAttributesPanel();scheduleGeneratorEvaluation(0);};if(options.undo===false)apply(operation);else runCmd({redo(){apply(operation);},undo(){apply(before);}});return getBooleanAI(h);};
const getBooleanAI=ref=>{const h=resolveObjects(ref)[0],p=objParams.get(h),state=replicaStates.get(h),mesh=pickMeshes.get(h);if(!h||p?.__type!=='boolean')throw new Error('Boolean node not found');return {object:h,operation:p.op,operands:booleanChildren(OBJ.get(h),p).slice(),ready:!!state?.ready,pending:!!state?.pending,error:state?.error||null,report:state?.report||null,seamVisible:!!state?.seam?.visible,cageVisible:!!state?.cage?.visible,cage:state?.virtualCage||null,mesh:state?.ready&&mesh?.geometry?.attributes?.position?meshTopology(h):null};};
const getReplicaAI=ref=>{const h=resolveObjects(ref)[0],p=objParams.get(h),state=replicaStates.get(h),mesh=pickMeshes.get(h),geometry=mesh?.geometry,large=!!state?.sharedGeometry&&(geometry?.index?.count||0)>=300000;let meshReport=null;if(state?.ready&&geometry?.attributes?.position)meshReport=large?{object:h,vertices:geometry.attributes.position.count,faces:(geometry.index?.count||geometry.attributes.position.count)/3,sharedGeometry:true,diagnosticsSkipped:'large shared geometry'}:meshTopology(h);if(!h||!['instance','symmetry','cloner'].includes(p?.__type))throw new Error('replica node not found');return {object:h,type:p.__type,source:p.source||null,children:OBJ.get(h)?.children.slice()||[],ready:!!state?.ready,pending:!!state?.pending,error:state?.error||null,report:state?.report||null,mesh:meshReport};};
const resourceStatsAI=()=>{const objects=new Set(),geometries=new Set(),materials=new Set(),textures=new Set(),visit=root=>root?.traverse?.(o=>{objects.add(o);if(o.geometry)geometries.add(o.geometry);for(const material of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});visit(vpState.scene);visit(vpState.hudScene);visit(vpState.overlayScene);const memory=vpState.renderer?.info?.memory||{},renderInfo=vpState.renderer?.info?.render||{},heap=performance.memory;return {objects:OBJ.size,roots:rootOrder.length,sceneObjects:objects.size,geometries:geometries.size,materials:materials.size,textures:textures.size,contentThrees:contentThrees.length,threeOf:threeOf.size,pickMeshes:pickMeshes.size,replicaStates:replicaStates.size,splineVisuals:splineVisuals.size,splineData:splineData.size,evaluatedSplineCache:evaluatedSplineCache.size,wireOverlays:wireOverlays.size,polyPointOverlays:polyPointOverlays.size,creaseOverlays:creaseOverlays.size,history:{undo:undoStack.length,redo:redoStack.length,limit:HISTORY_LIMIT},renderer:{geometries:memory.geometries||0,textures:memory.textures||0,programs:vpState.renderer?.info?.programs?.length||0,calls:renderInfo.calls||0,triangles:renderInfo.triangles||0},browserHeap:heap?{used:heap.usedJSHeapSize,total:heap.totalJSHeapSize,limit:heap.jsHeapSizeLimit}:null,boolean:booleanRuntime.stats()};};
const deleteObjectsAI=refs=>{const hashes=resolveObjects(refs);if(!hashes.length)throw new Error('no matching objects');runCmd(cmdDelete(hashes));for(const h of hashes){selNodes.delete(h);if(anchorNode?.hash===h)anchorNode=null;}selTags.clear();treeChanged();refreshSelClasses();return {deleted:hashes,resources:resourceStatsAI()};};
const reparentObjectsAI=(refs,targetRef,mode='child')=>{const hashes=resolveObjects(refs),target=resolveObjects(targetRef)[0]&&OBJ.get(resolveObjects(targetRef)[0]);if(!hashes.length||!target)throw new Error('moving objects and target are required');if(!['child','before','after'].includes(mode))throw new Error('mode must be child, before or after');const cmd=cmdReparent(hashes,{mode,target});runCmd(cmd);return {moved:hashes,target:target.hash,mode,state:state()};};
const objectTransformAI=ref=>{const h=resolveObjects(ref)[0],n=OBJ.get(h);if(!n)throw new Error('object not found');return {object:h,parent:n.parent,local:localTmp(n).elements.slice(),world:worldMatrix(n).elements.slice(),pivot:n.pivot.elements.slice()};};
const resetSceneAI=()=>{doNew();return {state:state(),resources:resourceStatsAI()};};
const setObjectTransformAI=(ref,values={},options={})=>{const h=resolveObjects(ref)[0],n=OBJ.get(h);if(!n)throw new Error('object not found');const before=localTmp(n).clone(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();before.decompose(position,quaternion,scale);if(Array.isArray(values.position))position.fromArray(values.position);if(Array.isArray(values.rotation))quaternion.setFromEuler(new THREE.Euler((+values.rotation[0]||0)*D2R,(+values.rotation[1]||0)*D2R,(+values.rotation[2]||0)*D2R));if(Array.isArray(values.scale))scale.fromArray(values.scale);const after=new THREE.Matrix4().compose(position,quaternion,scale),apply=matrix=>{setNodeFromLocal(n,matrix);syncMeshParents();scheduleGeneratorEvaluation(0);placeGizmoForSelection();};if(options.undo===false)apply(after);else runCmd({redo(){apply(after);},undo(){apply(before);}});return {object:h,local:localTmp(n).elements.slice()};};
const waitForGeneratorAI=(ref,timeoutMilliseconds=30000)=>{const h=resolveObjects(ref)[0];if(!h)throw new Error('object not found');const started=performance.now();return new Promise((resolve,reject)=>{const poll=()=>{const state=replicaStates.get(h),type=objParams.get(h)?.__type;if(!generatorTimer&&!generatorActivePasses&&state&&!state.pending&&(state.ready||state.error)){resolve(type==='boolean'?getBooleanAI(h):['instance','symmetry','cloner'].includes(type)?getReplicaAI(h):splineGeneratorAI(h));return;}if(performance.now()-started>timeoutMilliseconds){reject(new Error('generator evaluation timed out'));return;}setTimeout(poll,20);};poll();});};
const waitForIdleAI=(timeoutMilliseconds=30000)=>{const started=performance.now();return new Promise((resolve,reject)=>{const poll=()=>{if(!generatorTimer&&!generatorActivePasses&&![...replicaStates.values()].some(state=>state.pending)){requestAnimationFrame(()=>resolve(performanceStatsAI()));return;}if(performance.now()-started>timeoutMilliseconds){reject(new Error('application idle wait timed out'));return;}setTimeout(poll,20);};poll();});};
const splineRenderStateAI=ref=>{const h=resolveObjects(ref)[0],n=OBJ.get(h),parent=n?.parent&&OBJ.get(n.parent),view=vpState.mode==='single'?vpState.singleView:null;if(!h||!n||!splineData.has(h))throw new Error('spline object not found');return {object:h,threeVisible:!!threeOf.get(h)?.visible,effectiveVisible:effectiveVisible(h),visibleWithoutGeneratorConsumption:visibleWithoutGeneratorConsumption(h),parent:parent?.hash||null,parentGenerator:parent&&objParams.get(parent.hash)?.__type||null,parentReady:!!(parent&&derivedState(parent.hash)?.ready),view,shading:view==null?viewShading.slice():viewShading[view]};};
const sceneDiagnosticsAI=()=>({splines:validateSceneSplines(),generators:state().objects.filter(o=>o.generatorError).map(o=>({object:o.hash,name:o.name,error:o.generatorError})),selection:selection(),gizmo:gizmoStateAI(),view:viewStateAI()});
const simulateSplineGizmo=(options={})=>{if(!splineMode)throw new Error('spline edit mode is required');if(!gizmoVisible)throw new Error('select spline elements first');const start=new THREE.Matrix4().fromArray(getGizmoWorldArray()),pivot=new THREE.Vector3().setFromMatrixPosition(start),mode=options.mode||((options.rotate&&'rotate')||(options.scale&&'scale')||'move'),kind=options.kind||'screen',view=Number.isInteger(options.view)?options.view:0,evt={ctrlKey:!!options.ctrl,metaKey:false,shiftKey:!!options.shift};let tr=Array.isArray(options.translate)?options.translate.map(x=>+x||0):[0,0,0];if(options.constraints!==false&&(quantOn||snapOn)&&kind!=='screen'){const step=quantStep();tr=tr.map(x=>Math.round(x/step)*step);}const rr=Array.isArray(options.rotate)?options.rotate:[0,0,0],ss=Array.isArray(options.scale)?options.scale:[1,1,1],delta=new THREE.Matrix4().makeTranslation(pivot.x+tr[0],pivot.y+tr[1],pivot.z+tr[2]).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((+rr[0]||0)*D2R,(+rr[1]||0)*D2R,(+rr[2]||0)*D2R))).multiply(new THREE.Matrix4().makeScale(Number.isFinite(+ss[0])?+ss[0]:1,Number.isFinite(+ss[1])?+ss[1]:1,Number.isFinite(+ss[2])?+ss[2]:1)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z)),next=delta.multiply(start);if(mode==='move'&&kind==='screen'&&(snapOn||quantOn)){const p=new THREE.Vector3().setFromMatrixPosition(next),snapped=snapMoveScreen(p,view,Array.isArray(options.screenPoint)?options.screenPoint:null,pivot);next.setPosition(snapped);}const previous=gizDrag;gizDrag={mode,kind,view};try{_gizStart?.(evt);setGizmoMatrix(next.elements);_gizEnd?.();}finally{gizDrag=previous;}return {gizmo:gizmoStateAI(),selection:selection(),topology:[...splineDataSnapshot().keys()].map(splineTopology)};};
const validateSceneSplines=()=>{const payload=JSON.stringify([...splineData].filter(([h])=>OBJ.has(h))),decoded=new Map(JSON.parse(payload)),objects=[];for(const [h,d] of decoded){const report=SPLINE.validateSpline(d);objects.push({object:h,bytes:JSON.stringify(d).length,report});}return {bytes:payload.length,ok:objects.every(x=>x.report.ok),objects};};
const roundTripSceneAI=async()=>{const blob=await fullBlob(),bytes=new Uint8Array(await blob.arrayBuffer());pendingParams=unpackUI(bytes);rebuildFromBytes(bytes);afterLoad();return {bytes:bytes.length,state:state(),splines:validateSceneSplines()};};
const formatCapabilitiesAI=()=>({formats:{hash:{import:true,export:true,native:true},gltf:{import:true,export:true,selfContained:true},glb:{import:true,export:true,selfContained:true},obj:{import:true,export:true,mtl:'export companion; single-file import warns'},stl:{import:true,export:true,tessellated:true},ply:{import:true,export:true,tessellated:true},svg:{import:true,export:true,planarSplines:true},dxf:{import:true,export:true,subset:['LINE','LWPOLYLINE','3DFACE']}},limits:{...FORMAT_LIMITS},coordinates:{units:'millimetres',upAxis:'Y',handedness:'right-handed'},lastFileOperation});
const blobPayloadAI=async result=>{const bytes=new Uint8Array(await result.blob.arrayBuffer()),textual=['gltf','obj','svg','dxf'].includes(result.format),limit=8*1024*1024;let payload=null,encoding=null;if(bytes.length<=limit){if(textual){payload=new TextDecoder().decode(bytes);encoding='text';}else{let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));payload=btoa(binary);encoding='base64';}}return {format:result.format,name:result.name,bytes:result.bytes,triangles:result.triangles,curves:result.curves,warnings:result.warnings,attachments:(result.attachments||[]).map(x=>({name:x.name,bytes:x.blob.size})),encoding,payload,payloadOmitted:payload==null};};
const exportSceneAI=async(format='glb',options={})=>blobPayloadAI(await exportSceneFormat(format,{binary:options.binary!==false,download:!!options.download,name:options.name}));
const importSceneDataAI=async(format,data,options={})=>{format=String(format||'').toLowerCase().replace(/^\./,'');if(!EXTERNAL_EXTENSIONS.has(format))throw new Error(`Unsupported import format .${format||'?'}`);let blob;if(options.encoding==='base64'){if(typeof data!=='string')throw new Error('base64 import data must be a string');let raw;try{raw=atob(data);}catch{throw new Error('invalid base64 import data');}const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);blob=new Blob([bytes]);}else if(typeof data==='string')blob=new Blob([data],{type:'text/plain'});else if(Array.isArray(data))blob=new Blob([new Uint8Array(data)]);else throw new Error('import data must be text, base64, or a byte array');if(blob.size>FORMAT_LIMITS.maxImportBytes)throw new Error(`Import file exceeds ${FORMAT_LIMITS.maxImportBytes} byte limit`);const result=await importExternalBlob(blob,options.name||`import.${format}`);lastFileOperation={ok:true,operation:'import-data',...result};return result;};
const roundTripFormatAI=async(format='glb')=>{const exported=await exportSceneFormat(format),file=new File([exported.blob],`roundtrip.${format}`),imported=await importParsedExternal(await importExternalFile(file),file.name);lastFileOperation={ok:true,operation:'round-trip',format,exportBytes:exported.bytes,importedObjects:imported.objects,warnings:[...exported.warnings,...imported.warnings]};return {...lastFileOperation,root:imported.root};};
const timelineState=()=>({frame:tlCur,total:tlTotal,playing:tlPlaying,interpolation:tlInterp,tracks:[...animationTracks].filter(([h])=>OBJ.has(h)).map(([h,track])=>({object:h,keys:[...track].sort((a,b)=>a[0]-b[0]).map(([frame,key])=>({frame,position:key.p.slice(),rotationQuaternion:key.q.slice(),scale:key.s.slice(),interpolation:key.interp}))}))});
const setAITotal=total=>{tlTotalOpts.set(total);return timelineState();};
const api={version:'0.5',help:()=>({getState:'scene, modes, coordinates and selection',getTimeline:'timeline and PSR keys',setFrame:'(frame)',setTotalFrames:'(frames)',setKey:'selected objects',deleteKey:'selected objects at current frame',selectObjects:'(hashesOrNames, {mode})',makePolygonal:'(optional hashesOrNames)',setMode:'object | vertex | edge | face',selectSubobjects:'({object, kind, ids, mode})',deleteSubobjects:'()',setCoordinates:'({position, rotation, size}) in mm/degrees',transformSubobjects:'({translate,rotate,scale,extrude})',getCoordinates:'()',setView:'(single | quad, view 0..3)',getViewRect:'(view)',getScreenBounds:'(object, view)',getVertexScreens:'(object, view)',getMeshEdges:'(object)',getMeshTopology:'(object)',getMeshDiagnostics:'(object)',marquee:'({view, x0,y0,x1,y1 | u0,v0,u1,v1, mode})',runVertexTool:'(addPoint | lineCut | loop | soft | finish | cancel, options)',runFaceTool:'(lineCut | closeHole | finish | cancel, options)',runEdgeTool:'(lineCut | bridge | loop | finish | cancel, options)',setEdgeToolOptions:'({visibleOnly})',getVertexToolState:'()',setVertexToolOptions:'({visibleOnly,radius})',vertexToolMove:'({x,y,view})',vertexToolClick:'({x,y,view,mode})',faceToolMove:'({x,y,view})',faceToolClick:'({x,y,view})',edgeToolMove:'({x,y,view})',edgeToolClick:'({x,y,view,mode})',frame:'(objects, view)',undo:'()',redo:'()'}),getTimeline:timelineState,setFrame:frame=>{setTimelineFrame(frame);return timelineState();},setTotalFrames:setAITotal,setKey:()=>{setTimelineKey();return timelineState();},deleteKey:()=>{deleteTimelineKey();return timelineState();},getState:state,getCoordinates:coordinates,getSelection:selection,listObjects:()=>state().objects,selectObjects,makePolygonal,setMode,selectSubobjects,deleteSubobjects,setCoordinates,transformSubobjects,setView:setAIView,getViewRect:viewRect,getScreenBounds:screenBounds,getVertexScreens:vertexScreens,getMeshEdges:meshEdges,getMeshTopology:meshTopology,getMeshDiagnostics:meshDiagnostics,marquee,runVertexTool,runFaceTool,runEdgeTool,setEdgeToolOptions,getVertexToolState:vertexToolState,setVertexToolOptions,vertexToolMove,vertexToolClick,faceToolMove,faceToolClick,edgeToolMove,edgeToolClick,clearSelection:()=>{polyPivotMatrix=null;polySelection.items.clear();selNodes.clear();selTags.clear();refreshSelClasses();return selection();},frame:(refs,view)=>{const hashes=resolveObjects(refs);frameHashes(view??(vpState.mode==='single'?vpState.singleView:0),hashes);return hashes.length?screenBounds(hashes[0],view):null;},setCoordinateSpace:space=>{if(!['world','object'].includes(space))throw new Error('space must be world or object');setCoordMode(space);return coordinates();},setShading:(mode,view)=>{const n=typeof mode==='number'?mode:{solid:0,wire:1,'solid+wire':2,'spline-cage':3,'solid+spline-cage':4}[mode];if(![0,1,2,3,4].includes(n))throw new Error('invalid shading');if(view==null)setShadingForContext(n);else setViewShading(view,n);return state().views;},undo:()=>{undo();if(vertexTools.soft.active)recalculateSoftSelection();return state();},redo:()=>{redo();if(vertexTools.soft.active)recalculateSoftSelection();return state();}};
Object.assign(api,{getSplineTopology:splineTopology,getSplineSurface:splineSurfaceAI,getSplineApproximation:splineApproximationAI,setSplineApproximation:setSplineApproximationAI,setSplineFixture:setSplineFixtureAI,createSplineFixture:createSplineFixtureAI,createSplinePrimitive:createSplinePrimitiveAI,createSplineGenerator:createSplineGeneratorAI,setSplineGeneratorParams:setGeneratorParamsAI,toSplinePatch:toSplinePatchAI,getSplineGenerator:splineGeneratorAI,createPrimitive:createPrimitiveAI,createPolygonMesh:createPolygonMeshAI,createBoolean:createBooleanAI,setBooleanOperation:setBooleanOperationAI,getBoolean:getBooleanAI,setObjectTransform:setObjectTransformAI,getObjectTransform:objectTransformAI,reparentObjects:reparentObjectsAI,waitForGenerator:waitForGeneratorAI,getSplineVertexScreens:splineVertexScreens,getSplineHandleScreens:splineHandleScreens,getSplineSegmentScreens:splineSegmentScreens,getSplineHit:splineHitAI,getNavigationTarget:options=>splineHitAI({...options,editing:false,handles:false}),selectSplineElements,runSplineCommand,addSplineBevel:addSplineBevelAI,bakeSplineBevel:bakeSplineBevelAI,outlineSpline:outlineSplineAI,splitSplineSegment:splitSpline,connectDelete,beginSplineComponent,splineDrawPoint:splineDrawPointAI,finishSplineComponent,deleteLastSplinePoint:deleteLastSplinePointAI,transformSplineElements,frameSplineSelection:view=>({framed:frameSplineSelection(view??(vpState.mode==='single'?vpState.singleView:0)),view:viewStateAI()}),getGizmoState:gizmoStateAI,getGizmoHandles:gizmoHandlesAI,getGizmoHit:gizmoHitAI,getViewState:viewStateAI,setViewCamera:setViewCameraAI,setSplineTestOptions,setSolo:setSoloAI,findObjects:findObjectsAI,setObjectVisibility:(refs,value=true,options={})=>setObjectFieldAI(refs,'visible',value,options),setObjectEnabled:(refs,value=true,options={})=>setObjectFieldAI(refs,'enabled',value,options),showAllObjects:showAllObjectsAI,renameObject:renameObjectAI,createMaterial:createMaterialAI,getObjectMaterial:objectMaterialAI,assignMaterial:assignMaterialAI,clearMaterialTags:clearMaterialTagsAI,deleteObjects:deleteObjectsAI,resetScene:resetSceneAI,getResourceStats:resourceStatsAI,simulateSplineGizmo,getSceneDiagnostics:sceneDiagnosticsAI,validateSceneSplines,roundTripScene:roundTripSceneAI});
Object.assign(api,{createInstance:createInstanceAI,createInstanceCloud:createInstanceCloudAI,createStressGrid:createStressGridAI,getReplica:getReplicaAI,getPerformanceStats:performanceStatsAI,resetPerformanceStats:resetPerformanceStatsAI,waitForIdle:waitForIdleAI});
Object.assign(api,{getFormatCapabilities:formatCapabilitiesAI,exportScene:exportSceneAI,importSceneData:importSceneDataAI,roundTripFormat:roundTripFormatAI,getLastFileOperation:()=>({...lastFileOperation})});api.version='5.0';
api.getSplineBevels=ref=>{const h=resolveObjects(ref)[0];if(!h||!splineData.has(h))throw new Error('spline object not found');return splineBevelTags(h).map(cloneTag);};
api.getSplineRenderState=splineRenderStateAI;
const apiDocs={
getState:'() -> complete scene/mode/selection summary; objects include visible and effectiveVisible',findObjects:'(nameSubstring | {name,generator,visible,enabled})',selectObjects:'(hashesOrNames,{mode:replace|add|toggle})',setObjectVisibility:'(refs,boolean,{undo?:boolean})',setObjectEnabled:'(refs,boolean,{undo?:boolean})',showAllObjects:'({undo?:boolean})',setSolo:'(refs|null) transient viewport isolation',renameObject:'(ref,name,{undo?:boolean})',setMode:'(object|spline|vertex|edge|face)',getCoordinates:'()',setCoordinates:'({position?,rotation?,size?}) mm/degrees',setCoordinateSpace:'(world|object)',getViewState:'()',setView:'(single|quad,view0..3)',setViewCamera:'({view,position?,target?,quaternion?,zoom?})',setShading:'(solid|wire|solid+wire|spline-cage|solid+spline-cage,view?)',frame:'(refs,view?)',getGizmoState:'()',getGizmoHandles:'(view?) -> only addressable visible handles, with projected bounds and a verified drag point',marquee:'({view,x0,y0,x1,y1|u0,v0,u1,v1|,mode})',getSplineTopology:'(ref) -> evaluated direction-free components, contours, patch cells and Bevel tags',getSplineSurface:'(splineOrPatchRef) -> derived surface report and cells',getSplineApproximation:'(ref,{points?:boolean})',setSplineApproximation:'(ref,{angle},{undo?:boolean}) AngleMax display approximation',setSplineFixture:'(ref,cage|stress|three-circles|quad-closed|mixed-closed|sphere,{undo?:boolean}) AI-only deterministic QA fixture',createSplineFixture:'(extrude-profile|lathe-profile|sweep-profile|sweep-path|two-vertex-closed,name?)',createSplineGenerator:'(extrude|lathe|sweep|spline_patch, refs, params?)',setSplineGeneratorParams:'(ref,values,{undo?:boolean})',getSplineGenerator:'(ref) -> params, report, mesh topology and full virtual cage',getSplineVertexScreens:'(ref,view)',getSplineHandleScreens:'(ref,vertex,view)',getSplineSegmentScreens:'(ref,view)',getSplineHit:'({view,x,y|u,v,vertices?,handles?,segments?,radiusSegment?})',getNavigationTarget:'(same screen options as getSplineHit)',selectSplineElements:'({object,vertices?,handles?,segments?,mode?})',addSplineBevel:'({profile?,radius?,shelfA?,shelfB?}) on current spline selection',bakeSplineBevel:'(ref,index?|last)',outlineSpline:'({distance}) on selected coplanar non-branched spline segments; negative distance flips side',transformSplineElements:'({translate?,rotate?,scale?,ctrl?,shift?}); zero scale welds coincident selected elements',simulateSplineGizmo:'({translate?,rotate?,scale?,mode?,kind?,view?,screenPoint?,ctrl?,shift?,constraints?}) real gizmo callback path; screenPoint tests exact white-handle vertex/grid snap',runSplineCommand:'(hard|soft|equalLength|equalDirection|connected|delete)',splitSplineSegment:'(ref,segment,t)',connectDelete:'(refs?)',beginSplineComponent:'(ref?)',splineDrawPoint:'({view,x,y|u,v,ctrl?,shift?,dragWorld?})',finishSplineComponent:'()',deleteLastSplinePoint:'()',frameSplineSelection:'(view?)',setSplineTestOptions:'({quantize?,snapping?,coordinateSpace?,editPivot?})',validateSceneSplines:'()',getSceneDiagnostics:'()',roundTripScene:'() binary save/reload integrity check',batch:'([{method,args}],{continueOnError?})',undo:'()',redo:'()'};
apiDocs.marquee='({view,x0,y0,x1,y1|u0,v0,u1,v1,mode})';
apiDocs.getSplineRenderState='(ref) -> raw/effective spline visibility, parent generator state and active-view shading';
apiDocs.getSplineBevels='(ref) -> current Vertex Bevel tags for deterministic QA';
apiDocs.createSplineFixture+='; kinds also include two-vertex-closed';
Object.assign(apiDocs,{createMaterial:'(name,values?) -> ordinary scene material',getObjectMaterial:'(ref) -> resolved/default material and explicit tags',assignMaterial:'(refs,material,{undo?:boolean})',clearMaterialTags:'(refs,{undo?:boolean}) -> reset to inherited/default material'});
Object.assign(apiDocs,{deleteObjects:'(refs) -> undoable hierarchy deletion',resetScene:'() -> New Scene plus deterministic resource statistics',getResourceStats:'() -> history, Three/WebGL, overlay, browser heap and Worker/WASM counters'});
Object.assign(apiDocs,{reparentObjects:'(refs,target,child|before|after) -> undoable hierarchy move preserving world transform',getObjectTransform:'(ref) -> local, world and pivot matrices'});
Object.assign(apiDocs,{createInstance:'(source,name?,transform?) -> shared-buffer Instance',createInstanceCloud:'(source,count,{spacing?,name?}) -> one undoable shared-buffer large-scene fixture',createStressGrid:'(name,evenTriangleCount<=1000000) -> preallocated indexed large mesh',getPerformanceStats:'() -> generator, render, upload and shared-instance counters',resetPerformanceStats:'()'});
Object.assign(apiDocs,{createPrimitive:'(cube|cylinder|tube|sphere,name?,params?,transform?)',createPolygonMesh:'(name,positions,triangleIndices,transform?)',createBoolean:'([A,B],subtract|intersect|union) -> strict ordered binary node',setBooleanOperation:'(ref,operation,{undo?:boolean})',getBoolean:'(ref) -> readiness, ordered operands, manifold mesh, C++ seam and trust/timing diagnostics',setObjectTransform:'(ref,{position?,rotation?,scale?},{undo?:boolean}) local PSR',waitForGenerator:'(ref,timeoutMilliseconds?) -> resolves on ready or explicit error'});
Object.assign(apiDocs,{getFormatCapabilities:'() -> reliable-format matrix, coordinates and memory limits',exportScene:'(gltf|glb|obj|stl|ply|svg|dxf,{binary?,download?,name?})',importSceneData:'(format,text|base64|byteArray,{encoding?,name?}) -> one undoable import',roundTripFormat:'(format) -> export then production parser/import',getLastFileOperation:'()'});
apiDocs.createSplinePrimitive='(square|circle|polyhedron|text, params?) -> ordinary editable parametric spline object';
apiDocs.toSplinePatch='(ref) -> converts exact generated cage to editable Spline Patch; undoable';
api.help=name=>name?{version:api.version,method:name,signature:apiDocs[name]||null}:{version:api.version,transport:{direct:'window.frameAI.method(...args)',bridge:{command:'#frame-ai-command JSON {method,args}',result:'#frame-ai-result JSON {ok,result|error}',trigger:'input event or #frame-ai-run click'}},methods:apiDocs};
api.batch=async(requests,options={})=>{if(!Array.isArray(requests))throw new Error('batch expects an array');const out=[];for(const request of requests){const method=request?.method,args=Array.isArray(request?.args)?request.args:[];if(method==='batch'||typeof api[method]!=='function'){const error=`unknown or recursive frameAI method: ${method}`;if(!options.continueOnError)throw new Error(error);out.push({ok:false,error});continue;}try{out.push({ok:true,result:await api[method](...args)});}catch(error){if(!options.continueOnError)throw error;out.push({ok:false,error:error?.message||String(error)});}}return out;};
Object.defineProperty(window,'frameAI',{value:Object.freeze(api),configurable:true});
let bridge=document.getElementById('frame-ai-bridge');
if(!bridge){bridge=document.createElement('div');bridge.id='frame-ai-bridge';bridge.setAttribute('aria-hidden','true');bridge.style.cssText='position:fixed;left:-10000px;top:0;width:2px;height:2px;overflow:hidden;opacity:.001';bridge.innerHTML='<textarea id="frame-ai-command"></textarea><button id="frame-ai-run" type="button">run</button><textarea id="frame-ai-result" readonly></textarea><textarea id="frame-ai-help" readonly></textarea>';document.body.appendChild(bridge);}
bridge.dataset.version=api.version;
bridge.dataset.protocol='frameAI-json-v1';bridge.querySelector('#frame-ai-help').value=JSON.stringify(api.help());
const command=bridge.querySelector('#frame-ai-command'),result=bridge.querySelector('#frame-ai-result');
const execute=async()=>{let response;try{const request=JSON.parse(command.value||'{}'),method=request.method,args=Array.isArray(request.args)?request.args:[];if(typeof api[method]!=='function')throw new Error(`unknown frameAI method: ${method}`);const value=await api[method](...args);response=JSON.stringify({ok:true,result:value});}catch(error){response=JSON.stringify({ok:false,error:error?.message||String(error),stack:error?.stack||null});}result.value=response;result.dataset.value=response;result.dispatchEvent(new Event('change',{bubbles:true}));};
command.oninput=execute;bridge.querySelector('#frame-ai-run').onclick=execute;
window.dispatchEvent(new CustomEvent('frame-ai-ready',{detail:{version:api.version}}));
}
/* ===================== старт ===================== */
initViewport(document.getElementById('vp'));
createDefaultMat();
createTestCube();
rebuildMatCards();
draft=Object.assign({h:0,s:0,l:50,emm:0,rough:50,metal:0,opac:0,bump:0},{map:null,texBytes:null,texMime:null}); liveMat=null;
syncInputs(); updateMatPreview();
activateTab('tabObjects');
setCoordMode(coordMode);
setShadingForContext(shadingMode);
setGizmoMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
setGizmoVisible(false);
setGridStep(1000*UMM[dispIdx]);
treeChanged();
updateHUD();
obLayout(); renderRows(); updateHUD();
installFrameAI();
