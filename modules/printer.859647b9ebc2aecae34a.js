import * as THREE2 from "three";
import {frameAssets} from "frame-assets";
export function createFramePrinterModule(host){
const TYPE_PRINTER=8,framePrinters=new Map();
const FRAME_PRINTER_DEFAULTS={startLayer:1,endLayer:3332,layerPosition:0,lineWidth:1,layerHeight:.3,initialLayerHeight:.6,perimeters:1,overhangAngle:45,minPathLength:3,finishLayerInitialized:false};
const framePrinterLayerY=(p,layer)=>layer===1?p.initialLayerHeight/2:p.initialLayerHeight+(layer-1.5)*p.layerHeight;
function frameIsPrinter(h){return host.objParams?.get(h)?.__type==='printer';}
function framePrinterEnabled(h){for(let n=host.OBJ.get(h);n;n=n.parent?host.OBJ.get(n.parent):null)if(n.enabled===false)return false;return !!host.OBJ.get(h);}
function framePrinterFrame(h){
  const world=host.worldMatrix(host.OBJ.get(h)),e=world.elements,scale=[0,4,8].map(i=>Math.hypot(e[i],e[i+1],e[i+2])),frame=world.clone();
  if(scale.some(v=>v<1e-9))throw Error('The print volume must have a non-zero size.');
  const f=frame.elements;for(let k=0;k<3;k++)for(let j=0;j<3;j++)f[k*4+j]/=scale[k];
  const dot=(a,b)=>f[a]*f[b]+f[a+1]*f[b+1]+f[a+2]*f[b+2];
  if(Math.max(Math.abs(dot(0,4)),Math.abs(dot(0,8)),Math.abs(dot(4,8)))>1e-6)throw Error('3D Printer does not support skew, including skew inherited from a parent.');
  return {frame,width:1000*scale[0],height:1000*scale[1],depth:1000*scale[2]};
}
function framePrinterNoSkew(matrix){
  const e=matrix.elements,s=[0,4,8].map(i=>Math.hypot(e[i],e[i+1],e[i+2])),r=host.rigidFrame(matrix),q=r.elements;
  for(let k=0;k<3;k++)for(let j=0;j<3;j++)q[k*4+j]*=s[k];return r;
}
function framePrinterSourceEnabled(h,ignoreVisibility=false){
  const n=host.OBJ.get(h);if(!n||n.enabled===false)return false;for(let c=n;c;c=c.parent?host.OBJ.get(c.parent):null)if(!ignoreVisibility&&!c.visible||c!==n&&host.consumesGeneratorChildren(c.hash))return false;return true;
}
function framePrinterSources(ignoreVisibility=false){
  const out=[];let group=0;
  const enabled=h=>framePrinterSourceEnabled(h,ignoreVisibility);
  for(const [h,mesh] of host.pickMeshes){if(frameIsPrinter(h)||!enabled(h))continue;const state=host.derivedState(h);if(state&&(!state.ready||state.error))continue;const instanceGroups=new Map();
    const add=(m,matrix,id)=>{if(!m.geometry?.attributes.position)return;out.push({h,mesh:m,geometry:m.geometry,matrix:matrix.clone(),group:id});};
    mesh.updateWorldMatrix(true,true);
    const visit=m=>{if(m.userData.splineChunks){for(const c of m.userData.splineChunks.values())visit(c);}else if(m.isInstancedMesh){for(let i=0;i<m.count;i++){const x=new THREE2.Matrix4();m.getMatrixAt(i,x);const matrix=m.matrixWorld.clone().multiply(x),key=matrix.elements.join(',');if(!instanceGroups.has(key))instanceGroups.set(key,group++);add(m,matrix,instanceGroups.get(key));}}else if(m.geometry)add(m,m.matrixWorld,group);else for(const c of m.children||[])visit(c);};
    visit(mesh);group++;
  }
  return out;
}
// Support-area analysis is independent of the trajectory generator. It consumes
// evaluated source meshes, owns one cancellable worker, and never enters picking.
const frameSupportIds=new WeakMap();let frameSupportSerial=0;
const frameSupportId=q=>{if(!q||typeof q!=='object')return 0;if(!frameSupportIds.has(q))frameSupportIds.set(q,++frameSupportSerial);return frameSupportIds.get(q);};
function framePrinterSupportEnsure(s){return s.supportAnalysis||(s.supportAnalysis={enabled:true,whole:true,layer:true,busy:false,generation:0,status:'Not analyzed',result:null,meshes:[],job:null,lastPoll:0});}
function framePrinterSupportClear(s){const a=framePrinterSupportEnsure(s);for(const mesh of a.meshes){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}a.meshes=[];}
function framePrinterSupportInvalidate(s,dispose=false){const a=framePrinterSupportEnsure(s);a.generation++;clearTimeout(a.timer);a.timer=null;a.pollKey=null;a.attemptedKey=null;a.riskComplete=false;a.riskBusy=false;a.riskySegments=0;a.unknownSegments=0;s.supportRiskSerial=(s.supportRiskSerial||0)+1;s.supportRiskAngles=new Map();for(const q of s.chunks){q.mesh.geometry.attributes.segmentRisk?.array.fill(0);if(q.mesh.geometry.attributes.segmentRisk)q.mesh.geometry.attributes.segmentRisk.needsUpdate=true;}a.job?.finish(Object.assign(Error('Analysis cancelled or geometry changed'),{code:'FRAME_SUPPORT_CHANGED'}));a.job=null;a.busy=false;a.result=null;a.key=null;a.snapshotStats=null;a.renderStats=null;framePrinterSupportClear(s);a.status='Geometry changed - analyze again';if(dispose)a.enabled=false;}
function framePrinterSupportInputs(h){
  const p=host.objParams.get(h),f=framePrinterFrame(h),sources=framePrinterSources();let pending=null;const sourceErrors=[];
  for(const [hash] of host.OBJ){if(frameIsPrinter(hash)||!framePrinterSourceEnabled(hash))continue;const d=host.derivedState(hash);if(d?.error)sourceErrors.push(host.OBJ.get(hash)?.name||hash);else if(d&&!d.ready)pending='Waiting for evaluated source geometry';}
  const params={layerHeight:p.layerHeight,initialLayerHeight:p.initialLayerHeight,overhangAngle:p.overhangAngle},key=JSON.stringify([f.frame.elements,f.width,f.height,f.depth,params,pending,sourceErrors,sources.map(q=>[q.h,q.group,q.matrix.elements,frameSupportId(q.geometry),frameSupportId(q.geometry.attributes.position),frameSupportId(q.geometry.attributes.position.array??q.geometry.attributes.position.data?.array),q.geometry.attributes.position.version,q.geometry.index?.version,q.geometry.attributes.position.count,q.geometry.index?.count])]);
  return {key,pending,sources,fixture:{name:'Frame support-area analysis',printerFrame:Array.from(f.frame.elements),volume:{widthMM:f.width,heightMM:f.height,depthMM:f.depth},params,sourceErrors}};
}
// Snapshot bounds estimate coordinate maps, triangle arrays and transfer copies.
// The worker separately keeps its 256 MiB prepared geometry/working limits. Geometric
// query-work guards remain in the worker; raising input bounds alone cannot make
// an unsupported request complete. Exact getters and exact coordinate keys are
// used throughout; this does not weld nearby positions or replace source meshes.
const frameSupportInputLimits={memoryBytes:128*1024*1024,fixedBytes:32*1024*1024,positionBytes:384,faceBytes:128,solidBytes:8192};
async function framePrinterSupportSnapshot(input,options={}){
  const started=performance.now();
  if(input.pending)throw Error(input.pending);if(!input.sources.length)throw Error('No visible evaluated mesh geometry');
  const groups=new Map(),chunks=[];let faces=0,positions=0,processed=0,estimatedJobBytes=0,lastYield=performance.now();
  const check=()=>{if(options.signal?.aborted||options.checkCurrent&&!options.checkCurrent())throw Object.assign(Error('Analysis cancelled or geometry changed'),{code:'FRAME_SUPPORT_CHANGED'});};
  // Validate all input counts and group transforms before allocating geometry.
  for(const q of input.sources){
    const a=q.geometry.attributes.position,index=q.geometry.index;
    if(!a||a.itemSize!==3||!Number.isSafeInteger(a.count)||a.count<0)throw Error('Unsupported source position attribute');
    const count=index?.count??a.count;
    if(!Number.isSafeInteger(count)||count<0||count%3)throw Error('Source geometry is not triangular');
    faces+=count/3;positions+=a.count;
    const key=JSON.stringify([q.h,q.group]),matrix=Array.from(q.matrix.elements);
    if(matrix.length!==16||matrix.some(v=>!Number.isFinite(v)))throw Error('Invalid source transform');
    let g=groups.get(key);
    if(g&&JSON.stringify(g.matrix)!==JSON.stringify(matrix))throw Error('One evaluated source group has different transforms');
    if(!g){g={name:key,matrix,vertices:[],triangles:[],ids:new Map(),faceCount:0};groups.set(key,g);}
    g.faceCount+=count/3;
    estimatedJobBytes=frameSupportInputLimits.fixedBytes+positions*frameSupportInputLimits.positionBytes+faces*frameSupportInputLimits.faceBytes+groups.size*frameSupportInputLimits.solidBytes;
    if(estimatedJobBytes>frameSupportInputLimits.memoryBytes)throw Error('Source snapshot memory estimate exceeds 128 MiB; analysis has no all-clear result');
    chunks.push({a,index,count,g});
  }
  const total=positions+faces,progress=()=>options.onProgress?.({completed:processed,total});
  const yieldToUI=async()=>{check();progress();await new Promise(resolve=>setTimeout(resolve,0));check();lastYield=performance.now();};
  check();progress();await yieldToUI();
  for(const {a,index,count,g} of chunks){
    const remap=new Uint32Array(a.count);
    for(let i=0;i<a.count;i++){
      const point=[a.getX(i),a.getY(i),a.getZ(i)];
      if(point.some(v=>!Number.isFinite(v)))throw Error('Nonfinite source position');
      const key=point.map(v=>Object.is(v,-0)?'0':String(v)).join(',');let id=g.ids.get(key);
      if(id===undefined){id=g.vertices.length;g.ids.set(key,id);g.vertices.push(point);}remap[i]=id;processed++;
      if((i&511)===511&&performance.now()-lastYield>=4)await yieldToUI();
    }
    for(let i=0;i<count;i+=3){
      const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);
      if(ids.some(k=>!Number.isInteger(k)||k<0||k>=a.count))throw Error('Invalid source geometry index');
      g.triangles.push(ids.map(k=>remap[k]));processed++;
      if((i/3&511)===511&&performance.now()-lastYield>=4)await yieldToUI();
    }
  }
  check();progress();
  const meshes=[...groups.values()].map(({ids,faceCount,...g})=>g);
  options.onStats?.({snapshotMS:performance.now()-started,rawPositions:positions,faces,solids:meshes.length,uniqueVertices:meshes.reduce((n,g)=>n+g.vertices.length,0),estimatedJobBytes,memoryEstimateLimitBytes:frameSupportInputLimits.memoryBytes,memoryEstimateMeasured:false});
  return {...input.fixture,meshes};
}
function frameSupportInside(q,p){let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a[1]>q[1])!==(b[1]>q[1])&&q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
// A nominal-layer risk association for the existing straight, flat-ended strip.
// A whole segment is marked if ANY part of its XZ footprint meets a risky source
// fragment. This is conservative visualization, not printed-support certification.
function frameSupportRiskIndex(result){
 const layers=new Map();for(const band of result.layers||[]){if(band.kind!=='actual-layer'||!band.complete&&!band.knownFragments)continue;const entries=[];
  for(const f of band.fragments||[]){const paths=(f.riskMM||[]).filter(p=>p.length>=3);if(!paths.length)continue;let x=Infinity,y=Infinity,X=-Infinity,Y=-Infinity;for(const p of paths)for(const q of p){x=Math.min(x,q[0]);y=Math.min(y,q[1]);X=Math.max(X,q[0]);Y=Math.max(Y,q[1]);}entries.push({paths,angle:f.angleDegrees,bounds:[x,y,X,Y]});}
  const build=items=>{if(!items.length)return null;const bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const e of items){bounds[0]=Math.min(bounds[0],e.bounds[0]);bounds[1]=Math.min(bounds[1],e.bounds[1]);bounds[2]=Math.max(bounds[2],e.bounds[2]);bounds[3]=Math.max(bounds[3],e.bounds[3]);}if(items.length<=8)return{bounds,items};const axis=bounds[2]-bounds[0]>=bounds[3]-bounds[1]?0:1;items.sort((a,b)=>a.bounds[axis]+a.bounds[axis+2]-b.bounds[axis]-b.bounds[axis+2]);const n=items.length>>1;return{bounds,left:build(items.slice(0,n)),right:build(items.slice(n))};};layers.set(band.layer,build(entries));
 }return layers;
}
function frameSupportFlatStripRisk(a,b,width,root,budget){
 if(!root)return 0;const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy);if(!L)return 0;const ux=dx/L,uy=dy/L,nx=-uy,ny=ux,R=width/2,tol=Math.max(2e-6,width*1e-9),corners=[[a[0]+nx*R,a[1]+ny*R],[b[0]+nx*R,b[1]+ny*R],[b[0]-nx*R,b[1]-ny*R],[a[0]-nx*R,a[1]-ny*R]],box=[Math.min(...corners.map(q=>q[0]))-tol,Math.min(...corners.map(q=>q[1]))-tol,Math.max(...corners.map(q=>q[0]))+tol,Math.max(...corners.map(q=>q[1]))+tol];let angle=0;
 const spend=()=>{if(budget&&++budget.work>budget.limit)throw Error('Trajectory-risk association work limit exceeded');};
 const overlaps=q=>q[0]<=box[2]&&q[2]>=box[0]&&q[1]<=box[3]&&q[3]>=box[1],local=q=>[(q[0]-a[0])*ux+(q[1]-a[1])*uy,(q[0]-a[0])*nx+(q[1]-a[1])*ny];
 const edgeHit=(p,q)=>{let lo=0,hi=1;for(const [i,min,max]of[[0,-tol,L+tol],[1,-R-tol,R+tol]]){const d=q[i]-p[i];if(Math.abs(d)<1e-20){if(p[i]<min||p[i]>max)return false;}else{const t=(min-p[i])/d,u=(max-p[i])/d;lo=Math.max(lo,Math.min(t,u));hi=Math.min(hi,Math.max(t,u));if(lo>hi)return false;}}return true;};
 const inside=q=>{let answer=false;for(const p of q.paths){let local=false;for(let i=0,j=p.length-1;i<p.length;j=i++){spend();const u=p[i],v=p[j];if((u[1]>q.probe[1])!==(v[1]>q.probe[1])&&q.probe[0]<(v[0]-u[0])*(q.probe[1]-u[1])/(v[1]-u[1])+u[0])local=!local;}if(local)answer=!answer;}return answer;};
 function hits(entry){for(const p of entry.paths)for(let i=0;i<p.length;i++){spend();if(edgeHit(local(p[i]),local(p[(i+1)%p.length])))return true;}return corners.some(probe=>inside({paths:entry.paths,probe}));}
 function visit(node){if(!node||!overlaps(node.bounds))return;spend();if(node.items){for(const e of node.items)if(e.angle>angle&&overlaps(e.bounds)&&hits(e))angle=e.angle;}else{visit(node.left);visit(node.right);}}visit(root);return angle;
}
async function framePrinterSupportUpdateTrajectoryRisk(h){
 const s=framePrinters.get(h);if(!s)return;const a=framePrinterSupportEnsure(s),result=a.result,serial=s.supportRiskSerial=(s.supportRiskSerial||0)+1,chunks=s.chunks,generation=a.generation;
 if(!result||!chunks.length){a.riskComplete=false;a.riskySegments=0;return;}a.riskBusy=true;a.riskComplete=false;a.riskError=null;const indices=frameSupportRiskIndex(result),budget={work:0,limit:2000000},angles=new Map(),current=()=>framePrinters.get(h)===s&&a.generation===generation&&s.supportRiskSerial===serial&&s.chunks===chunks;let risky=0,unknown=0,processed=0;
 for(const [layer,paths]of s.layers)angles.set(layer,new Float32Array(paths.reduce((n,p)=>n+p.length,0)));
 try{for(const [layer,paths]of s.layers){let ordinal=0;const root=indices.get(layer),values=angles.get(layer);for(const path of paths)for(let i=0;i<path.length;i++){if(!current())return;let value;
   try{if(budget.work>budget.limit)throw Error('Trajectory-risk association work limit exceeded');value=frameSupportFlatStripRisk(path[i],path[(i+1)%path.length],s.sliceParams.lineWidth,root,budget);if(!value&&(result.analysisPartial||!result.nominalLayerEstimateComplete&&!indices.has(layer)))value=-1;}catch(error){value=-1;a.riskError=error.message;}
   values[ordinal++]=value;if(value>0)risky++;else if(value<0)unknown++;if(++processed%4096===0){await new Promise(resolve=>setTimeout(resolve,0));if(!current())return;}
  }}
  for(const q of chunks){const g=q.mesh.geometry,meta=g.attributes.segmentMeta.array,attribute=g.attributes.segmentRisk;for(let i=0;i<q.count;i++)attribute.array[i]=angles.get(meta[i*3])[meta[i*3+1]];attribute.needsUpdate=true;}
  if(!current())return;s.supportRiskAngles=angles;a.riskySegments=risky;a.unknownSegments=unknown;a.riskComplete=unknown===0;a.riskWork=budget.work;a.riskError=unknown?a.riskError:null;
 }finally{if(current()){a.riskBusy=false;framePrinterSupportRange(h);framePrinterStatus(h);host.scheduleRender();}}
}

function frameSupportTriangles(paths){
  const rings=paths.filter(p=>p.length>=3).map(p=>({p,xy:p.map(q=>[q[0],q[2]]),size:Math.abs(p.reduce((n,q,i)=>{const b=p[(i+1)%p.length];return n+q[0]*b[2]-b[0]*q[2];},0)),parent:null,depth:0})).sort((a,b)=>b.size-a.size);
  for(let i=0;i<rings.length;i++){const r=rings[i];for(let j=i-1;j>=0;j--)if(frameSupportInside(r.xy[0],rings[j].xy)){r.parent=rings[j];r.depth=r.parent.depth+1;break;}}
  const positions=[];for(const r of rings){if(r.depth%2)continue;const holes=rings.filter(q=>q.parent===r&&q.depth%2),flat=[r,...holes].flatMap(q=>q.p),vectors=q=>q.xy.map(p=>new THREE2.Vector2(...p)),faces=THREE2.ShapeUtils.triangulateShape(vectors(r),holes.map(vectors));for(const face of faces)for(const i of face)positions.push(...flat[i]);}return positions;
}
function framePrinterSupportBuild(h,result){const started=performance.now(),s=framePrinters.get(h),a=framePrinterSupportEnsure(s);framePrinterSupportClear(s);const add=(positions,color,kind,layer=null)=>{if(!positions.length)return;const geometry=new THREE2.BufferGeometry();geometry.setAttribute('position',new THREE2.Float32BufferAttribute(positions,3));const material=new THREE2.MeshBasicMaterial({color,side:THREE2.DoubleSide,transparent:true,opacity:.78,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),mesh=new THREE2.Mesh(geometry,material);mesh.raycast=()=>{};mesh.userData.frameSupport={kind,layer};mesh.frustumCulled=false;mesh.renderOrder=5;s.paths.add(mesh);a.meshes.push(mesh);};
  // Triangulate each face and its own holes on its original plane, then batch
  // only completed triangles. This bounds draw calls by layers, not mesh faces.
  const append=(positions,paths)=>{for(const v of frameSupportTriangles(paths))positions.push(v);},whole=[];
  for(const f of result.wholeBoundaryFragments||[])append(whole,f.exposed3D||[]);
  add(whole,0xff3333,'whole');
  for(const band of result.layers||[])if(band.kind==='actual-layer'&&(band.complete||band.knownFragments)){const positions=[];for(const f of band.fragments||[])append(positions,f.risk3D||[]);add(positions,0xff5d54,'layer',band.layer);}
  framePrinterSupportRange(h);a.renderStats={buildMS:performance.now()-started,meshes:a.meshes.length,triangles:a.meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0)};
}
function framePrinterSupportRange(h){const s=framePrinters.get(h),p=host.objParams.get(h);if(!s||!p)return;const a=framePrinterSupportEnsure(s),partial=!!s.stats&&p.layerPosition<framePrinterCount(s,p.endLayer),preview=framePrinterPreviewVisible();for(const mesh of a.meshes){const q=mesh.userData.frameSupport;mesh.visible=a.enabled&&!preview&&(q.kind==='whole'?a.whole:a.layer&&q.layer>=p.startLayer&&q.layer<=p.endLayer&&!(partial&&q.layer===p.endLayer));}for(const q of s.chunks)q.mesh.material.uniforms.supportEnabled.value=a.enabled&&a.layer?1:0;a.partialFinish=partial;for(const q of s.chunks){q.mesh.material.uniforms.warningAngle.value=p.overhangAngle;}framePrinterAngleUpdate(h);}
// Immediate orientation warnings share evaluated GPU geometry. No CPU surface
// union, support worker, copied position buffers or async analysis gate is used.
function framePrinterAngleDispose(s){const a=s.angleWarnings;if(!a)return;a.root.removeFromParent();a.material.dispose();a.depthMaterial.dispose();a.entries.clear();s.angleWarnings=null;}
function framePrinterAngleEnsure(s){
 if(s.angleWarnings)return s.angleWarnings;
 const root=new THREE2.Group();root.name='Printer angle warnings';host.vpState.scene.add(root);
 const uniforms={printerInverse:{value:new THREE2.Matrix4()},volume:{value:new THREE2.Vector3()},buildView:{value:new THREE2.Vector3(0,1,0)},angleSin:{value:Math.SQRT1_2}};
 const material=new THREE2.ShaderMaterial({side:THREE2.DoubleSide,depthWrite:false,uniforms,
  vertexShader:`varying vec3 warningWorld;varying vec3 warningView;varying vec3 warningNormal;
   void main(){
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    warningView=mvPosition.xyz;warningNormal=transformedNormal;
    vec4 world=vec4(transformed,1.);
    #ifdef USE_INSTANCING
     world=instanceMatrix*world;
    #endif
    warningWorld=(modelMatrix*world).xyz;
   }`,
  fragmentShader:`uniform mat4 printerInverse;uniform vec3 volume;uniform vec3 buildView;uniform float angleSin;
   varying vec3 warningWorld;varying vec3 warningView;varying vec3 warningNormal;
   void main(){
    vec3 local=(printerInverse*vec4(warningWorld,1.)).xyz;
    if(local.y<=0.000001||local.y>volume.y||abs(local.x)>volume.x*.5||abs(local.z)>volume.z*.5)discard;
    vec3 n=cross(dFdx(warningView),dFdy(warningView));float size=length(n);if(size<=1.e-20)discard;n/=size;
    if(dot(n,warningNormal)<0.)n=-n;
    if(-dot(n,normalize(buildView))<=angleSin+0.000001)discard;
    gl_FragColor=vec4(1.,.12,.12,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const depthMaterial=new THREE2.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE2.DoubleSide});
 return s.angleWarnings={root,material,depthMaterial,uniforms,entries:new Map(),updates:0,geometryCopies:0};
}
function framePrinterAngleUpdate(h,cam=null){
 const s=framePrinters.get(h),p=host.objParams.get(h);if(!s||!p)return;const a=framePrinterAngleEnsure(s),state=framePrinterSupportEnsure(s),preview=framePrinterPreviewVisible(),enabled=state.enabled&&state.whole&&s.root.visible&&!preview;
 a.root.visible=enabled;if(!enabled)return;
 const f=framePrinterFrame(h);a.uniforms.printerInverse.value.copy(f.frame).invert();a.uniforms.volume.value.set(f.width,f.height,f.depth);a.uniforms.angleSin.value=Math.sin(p.overhangAngle*Math.PI/180);
 if(cam){const up=new THREE2.Vector3().setFromMatrixColumn(f.frame,1);a.uniforms.buildView.value.copy(up).transformDirection(cam.matrixWorldInverse);}
 const view=cam?host.vpState.views.findIndex(q=>q.cam===cam):-1,wire=view>=0&&host.viewShading?.[view]===1,seen=new Set();
 const visit=mesh=>{
  if(mesh.userData?.splineChunks){for(const q of mesh.userData.splineChunks.values())visit(q);return;}
  if(mesh.isMesh&&mesh.geometry?.attributes.position){
   seen.add(mesh);let q=a.entries.get(mesh);
   if(q&&(q.geometry!==mesh.geometry||q.instanced!==!!mesh.isInstancedMesh)){q.red.removeFromParent();q.depth.removeFromParent();a.entries.delete(mesh);q=null;}
   if(!q){const make=material=>{let m;if(mesh.isInstancedMesh){m=new THREE2.InstancedMesh(mesh.geometry,material,0);m.count=mesh.count;m.instanceMatrix=mesh.instanceMatrix;}else m=new THREE2.Mesh(mesh.geometry,material);m.matrixAutoUpdate=false;m.frustumCulled=false;m.raycast=()=>{};m.userData.frameAngleWarning=true;a.root.add(m);return m;};q={geometry:mesh.geometry,instanced:!!mesh.isInstancedMesh,red:make(a.material),depth:make(a.depthMaterial)};q.depth.renderOrder=10000;q.red.renderOrder=10001;a.entries.set(mesh,q);}
   mesh.updateWorldMatrix(true,false);for(const m of[q.red,q.depth]){m.matrix.copy(mesh.matrixWorld);if(mesh.isInstancedMesh){m.count=mesh.count;m.instanceMatrix=mesh.instanceMatrix;}}q.red.visible=true;q.depth.visible=wire;
   return;
  }
  for(const q of mesh.children||[])visit(q);
 };
 for(const[h,mesh]of host.pickMeshes){if(frameIsPrinter(h)||!framePrinterSourceEnabled(h))continue;const d=host.derivedState(h);if(d&&(!d.ready||d.error))continue;visit(mesh);}
 for(const[mesh,q]of a.entries)if(!seen.has(mesh)){q.red.removeFromParent();q.depth.removeFromParent();a.entries.delete(mesh);}
 a.updates++;state.status='Immediate surface angle warnings; support is not evaluated';state.busy=false;
}
function framePrinterAngleState(h){
 const s=framePrinters.get(h),a=framePrinterSupportEnsure(s),g=s.angleWarnings;
 const p=host.objParams.get(h);if(a.countAngles!==s.supportRiskAngles||a.countThreshold!==p.overhangAngle){a.countAngles=s.supportRiskAngles;a.countThreshold=p.overhangAngle;a.riskySegments=0;a.unknownSegments=0;for(const values of s.supportRiskAngles?.values()||[])for(const value of values){if(value>p.overhangAngle&&value>0)a.riskySegments++;if(value<0)a.unknownSegments++;}}
 return{enabled:a.enabled,busy:false,status:'Immediate angle warnings; support is not evaluated',mode:'surface-angle-warning',complete:false,allClear:null,wholeExposedBoundaryComplete:false,nominalLayerEstimateComplete:false,wholeModelView:a.whole,layerRiskView:a.layer,overlayMeshes:g?.entries.size||0,visibleWholeMeshes:g?.root.visible?g.entries.size:0,visibleLayerMeshes:0,printedSupportCertified:false,bridgeExemptions:0,sourceGeneration:a.generation,trajectoryRiskComplete:false,trajectoryRiskBusy:false,riskySegments:a.riskySegments||0,unknownSegments:a.unknownSegments||0,riskAssociationError:null,angleWarningGeometryCopies:0,automaticSupportAnalysis:false,trajectoryWarningComplete:s.angleWarningComplete??false};
}

function framePrinterSupportPoll(h){framePrinterAngleUpdate(h);}
async function framePrinterAnalyzeSupport(h){
  const s=framePrinterEnsure(h),a=framePrinterSupportEnsure(s);framePrinterSupportInvalidate(s);a.enabled=true;a.busy=true;a.status='Preparing support-area analysis';const generation=a.generation,controller=new AbortController();let done=false;
  const promise=new Promise((resolve,reject)=>{const job={controller,worker:null,url:null,release:null,finish(error,result){if(done)return;done=true;controller.abort();job.worker?.terminate();if(job.url)URL.revokeObjectURL(job.url);job.release?.();if(a.job===job){a.job=null;a.busy=false;if(error){a.status=error.code==='FRAME_SUPPORT_CHANGED'?'Geometry changed — analyze again':'Analysis incomplete: '+error.message;a.result=null;framePrinterSupportClear(s);}else{a.result=result;a.riskUpdate=framePrinterSupportUpdateTrajectoryRisk(h);a.status=result.complete?'Support-area analysis complete':'Analysis incomplete: '+result.reason;}}framePrinterStatus(h);host.scheduleRender();error?reject(error):resolve(framePrinterSupportState(h));}};a.job=job;
    (async()=>{await window.frameAI.waitForIdle();if(done||generation!==a.generation||!host.OBJ.has(h))throw Object.assign(Error('Geometry changed'),{code:'FRAME_SUPPORT_CHANGED'});const input=framePrinterSupportInputs(h);a.key=input.key;a.attemptedKey=input.key;const current=()=>!done&&generation===a.generation&&host.OBJ.has(h)&&framePrinterSupportInputs(h).key===input.key,fixture=await framePrinterSupportSnapshot(input,{signal:controller.signal,checkCurrent:current,onProgress:q=>{a.status='Preparing support geometry '+Math.round(q.completed/Math.max(1,q.total)*100)+'%';framePrinterStatus(h);},onStats:q=>{a.snapshotStats=q;}});if(!current())throw Object.assign(Error('Geometry changed'),{code:'FRAME_SUPPORT_CHANGED'});const source=await frameAssets.text('overhang-worker');job.release=await host.frameComputeBudget.acquire('slicer',controller.signal);if(done){job.release();job.release=null;return;}job.url=URL.createObjectURL(new Blob([source],{type:'application/javascript'}));const worker=job.worker=new Worker(job.url,{name:'frame-support-analysis'});worker.onerror=e=>job.finish(Error(e.message||'Support analysis worker failed'));worker.onmessage=({data})=>{if(done||data.token!==generation)return;if(!host.OBJ.has(h)||generation!==a.generation||framePrinterSupportInputs(h).key!==input.key)return job.finish(Object.assign(Error('Geometry changed'),{code:'FRAME_SUPPORT_CHANGED'}));if(data.type==='progress'){a.status='Analyzing support areas '+Math.round(data.completed/data.total*100)+'%';framePrinterStatus(h);return;}if(data.type==='error')return job.finish(Error(data.message));if(data.type==='result'){try{framePrinterSupportBuild(h,data.result);job.finish(null,data.result);}catch(error){job.finish(error);}}};worker.postMessage({type:'analyze',token:generation,fixture});})().catch(error=>job.finish(error));
  });a.promise=promise;framePrinterStatus(h);return promise;
}
function framePrinterSupportState(h){return framePrinterAngleState(h);}
function framePrinterSupportStatus(h){const s=framePrinters.get(h);if(!s)return;const a=framePrinterSupportEnsure(s),button=document.querySelector('[data-printer-support="'+h+'"]');if(button){button.textContent=a.enabled?'Hide angle warnings':'Show angle warnings';button.setAttribute('aria-pressed',String(a.enabled));}const el=document.querySelector('[data-printer-support-status="'+h+'"]');if(el){el.textContent='Red: visible downward-facing surfaces beyond the selected angle. Support and bridges are not evaluated.'+(s.stats&&!s.angleWarningComplete?' Source-angle correspondence is unavailable for exceptional print segments.':'');el.hidden=!a.enabled;}}
function framePrinterSupportAttributes(h){const s=framePrinters.get(h),a=framePrinterSupportEnsure(s),row=host.attrRow(''),button=document.createElement('button');row.style.flexWrap='wrap';row.parentElement.style.height='auto';row.parentElement.style.minHeight='20px';button.className='attr-btn';button.dataset.printerSupport=h;button.style.whiteSpace='normal';button.onclick=()=>{if(a.busy){framePrinterSupportInvalidate(s,true);a.status='Overhang highlighting hidden';}else{a.enabled=!a.enabled;if(a.enabled){if(!a.result)a.attemptedKey=null;framePrinterSupportPoll(h);}}framePrinterSupportRange(h);framePrinterStatus(h);host.scheduleRender();};row.append(button);for(const [field,label]of [['whole','Whole model'],['layer','Print angle warnings']]){const b=document.createElement('button');b.className='attr-btn';b.dataset.printerSupportView=field;b.dataset.printerSupportOwner=h;b.textContent=label;b.setAttribute('aria-pressed',String(a[field]));b.onclick=()=>{a[field]=!a[field];b.setAttribute('aria-pressed',String(a[field]));framePrinterSupportRange(h);framePrinterStatus(h);host.scheduleRender();};b.title=field==='whole'?'Immediate visible surface-angle warnings, independent of the layer range.':'Source-angle warnings on print segments follow Start, Finish and layer progress.';row.append(b);}const status=document.createElement('div');status.dataset.printerSupportStatus=h;status.setAttribute('role','status');status.style.cssText='font-size:14px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;padding:4px 0';host.attrContent.append(status);}

function framePrinterClear(s){
  for(const q of s.chunks||[]){q.mesh.geometry.dispose();q.mesh.material.dispose();q.mesh.removeFromParent();if(q.debug){q.debug.geometry.dispose();q.debug.material.dispose();q.debug.removeFromParent();}}
  framePrinterClearOriginal(s);s.referenceDefs=new Map();s.layerReferenceIds=new Map();
  s.supportRiskSerial=(s.supportRiskSerial||0)+1;s.supportRiskAngles=new Map();s.chunks=[];s.layers=new Map();s.stats=null;s.lastLayer=null;s.sliceParams=null;
}
function framePrinterDispose(h){const s=framePrinters.get(h);if(!s)return;s.cancel?.();framePrinterSupportInvalidate(s,true);framePrinterAngleDispose(s);s.root.removeFromParent();s.root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose();});framePrinters.delete(h);}
function framePrinterEnsure(h){
  const p=host.objParams.get(h);if(p){delete p.overlap;p.perimeters=1;}
  let s=framePrinters.get(h);if(s)return s;
  const root=new THREE2.Group();root.matrixAutoUpdate=false;root.userData.framePrinter=h;host.vpState.scene.add(root);
  const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],edges=[];
  for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
  const line=new THREE2.LineSegments(new THREE2.BufferGeometry().setAttribute('position',new THREE2.Float32BufferAttribute(edges,3)),new THREE2.LineBasicMaterial({color:0x72b9b1,transparent:true,opacity:.65,depthWrite:false}));root.add(line);
  const plate=new THREE2.LineSegments(new THREE2.BufferGeometry(),new THREE2.LineBasicMaterial({color:0x72b9b1,transparent:true,opacity:.16,depthWrite:false}));root.add(plate);
  const paths=new THREE2.Group();paths.matrixAutoUpdate=false;root.add(paths);
  s={root,line,plate,paths,gridKey:null,busy:false,status:'Ready · one inward perimeter',chunks:[],layers:new Map(),stats:null,originalEnabled:false,originalChunks:[],referenceDefs:new Map(),layerReferenceIds:new Map(),originalGeneration:0};framePrinters.set(h,s);return s;
}
function framePrinterUpdate(){
  for(const [h] of framePrinters)if(!host.OBJ.has(h)||!frameIsPrinter(h))framePrinterDispose(h);
  for(const [h,p] of host.objParams){if(!host.OBJ.has(h)||p.__type!=='printer')continue;const s=framePrinterEnsure(h);s.root.matrix.copy(host.worldMatrix(host.OBJ.get(h)));s.root.updateMatrixWorld(true);s.root.visible=host.effectiveVisible(h)&&framePrinterEnabled(h);s.paths.visible=s.root.visible;s.line.visible=s.root.visible;s.line.material.color.setHex(host.selNodes.has(h)?0xffcf70:0x72b9b1);
    try{const f=framePrinterFrame(h);framePrinterGrid(s,f);s.paths.matrix.makeScale(1000/f.width,1000/f.height,1000/f.depth);s.paths.updateMatrixWorld(true);}catch(error){s.status=error.message;}
    framePrinterRange(h);framePrinterSupportPoll(h);framePrinterStatus(h);
  }
}
function framePrinterGrid(s,f){
  const key=f.width.toPrecision(12)+':'+f.depth.toPrecision(12);if(s.gridKey===key)return;
  const sx=f.width/1000,sz=f.depth/1000,nx=Math.max(0,Math.ceil(f.width/100-1e-9)-1),nz=Math.max(0,Math.ceil(f.depth/100-1e-9)-1),lines=new Float32Array((nx+nz)*6);let at=0;
  for(let i=1;i<=nx;i++){const x=-500+i*100/sx;lines.set([x,0,-500,x,0,500],at);at+=6;}
  for(let i=1;i<=nz;i++){const z=-500+i*100/sz;lines.set([-500,0,z,500,0,z],at);at+=6;}
  s.plate.geometry.dispose();s.plate.geometry=new THREE2.BufferGeometry().setAttribute('position',new THREE2.BufferAttribute(lines,3));s.gridKey=key;s.grid={step:100,width:f.width,depth:f.depth,lines:nx+nz};
}
function framePrinterDepthRange(cam){
  const direction=cam.getWorldDirection(new THREE2.Vector3()),eye=cam.getWorldPosition(new THREE2.Vector3()),point=new THREE2.Vector3();let minD=Infinity,maxD=-Infinity,count=0;
  for(const h of host.selNodes){const s=framePrinters.get(h);if(!s?.root.visible||!host.OBJ.get(h)?.enabled)continue;const matrix=host.worldMatrix(host.OBJ.get(h));let lo=Infinity,hi=-Infinity;
    for(let i=0;i<8;i++){point.set(i&1?500:-500,i&2?1000:0,i&4?500:-500).applyMatrix4(matrix);const d=point.sub(eye).dot(direction);lo=Math.min(lo,d);hi=Math.max(hi,d);}
    if(cam.isPerspectiveCamera&&hi<=0)continue;minD=Math.min(minD,lo);maxD=Math.max(maxD,hi);count++;
  }
  return count?{minD,maxD,nearD:Math.max(0,minD),geometryCount:count,printer:true}:null;
}
function framePrinterStatus(h){
  const s=framePrinters.get(h);if(!s)return;
  const b=document.querySelector('[data-printer-slice="'+h+'"]');if(b){b.textContent=s.busy?'Cancel':'Slice';b.disabled=false;b.title=s.busy?'Cancel slicing':'Generate one inward perimeter';}
  const mode=document.querySelector('[data-printer-display="'+h+'"]');if(mode){mode.textContent=s.displayMode==='lines-dots'?'Solid strips':'Lines–Dots';mode.setAttribute('aria-pressed',String(s.displayMode==='lines-dots'));}
  const original=document.querySelector('[data-printer-original="'+h+'"]');if(original){original.disabled=!s.referenceDefs.size;original.classList.toggle('on',!!s.originalEnabled);original.setAttribute('aria-pressed',String(!!s.originalEnabled));original.title='Show the original unsimplified inset lines and their true endpoint dots';}
  framePrinterSupportStatus(h);
  const el=document.querySelector('[data-printer-status="'+h+'"]');if(el){el.hidden=false;el.textContent=s.status;el.title=el.textContent;}
}
function framePrinterLayerLimit(h,p=host.objParams.get(h)){
  const s=framePrinters.get(h);
  if(s?.stats&&s.sliceParams&&['lineWidth','layerHeight','initialLayerHeight','minPathLength'].every(k=>s.sliceParams[k]===p[k]))return Math.max(1,s.lastLayer||0);
  let f;try{f=framePrinterFrame(h);}catch{return 1;}
  const volume=Math.max(1,1+Math.floor((f.height-p.initialLayerHeight)/p.layerHeight+1e-9)),inverse=f.frame.clone().invert();let top=0;
  // Before Slice, bound the sampling planes by source geometry in the rigid printer frame.
  // After Slice, use the actual last nonempty layer, including a partial final layer.
  for(const q of framePrinterSources()){
    if(!q.geometry.boundingBox)q.geometry.computeBoundingBox();
    const b=q.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(q.matrix));
    if(b.max.x<=-f.width/2||b.min.x>=f.width/2||b.max.z<=-f.depth/2||b.min.z>=f.depth/2||b.max.y<=0)continue;
    top=Math.max(top,Math.min(f.height,b.max.y));
  }
  const last=top<=p.initialLayerHeight/2?0:Math.max(1,Math.ceil((top-p.initialLayerHeight)/p.layerHeight+1.5-1e-9)-1);
  return Math.max(1,Math.min(volume,last));
}
function framePrinterValidateSettings(h,p){
  for(const key of ['lineWidth','layerHeight','initialLayerHeight'])if(!Number.isFinite(p[key])||p[key]<=0)throw Error(key+' must be positive.');
  if(p.perimeters!==1)throw Error('This slicer generates exactly one inward perimeter.');
  if(!Number.isFinite(p.minPathLength)||p.minPathLength<0)throw Error('Min path length must be non-negative.');
  if(!Number.isFinite(p.overhangAngle)||p.overhangAngle<0||p.overhangAngle>90)throw Error('Overhang angle must be from 0 to 90 degrees.');
  const height=framePrinterFrame(h).height;if(p.initialLayerHeight>height)throw Error('Layer height exceeds the print volume.');
  if(1+Math.floor((height-p.initialLayerHeight)/p.layerHeight+1e-9)>1000000)throw Error('More than 1,000,000 layers. Increase layer height or reduce the print volume.');
}
function framePrinterSetField(h,key,value){
  const p=host.objParams.get(h),next={...p};if(['startLayer','endLayer','layerPosition','perimeters'].includes(key))value=Math.round(value);
  if(key==='startLayer'||key==='endLayer')value=Math.max(1,Math.min(value,framePrinterLayerLimit(h)));
  if(key==='layerPosition')value=Math.max(0,value);if(key==='overhangAngle')value=Math.max(0,Math.min(90,value));if(key==='minPathLength')value=Math.max(0,value);
  next[key]=value;framePrinterValidateSettings(h,next);p[key]=value;const limit=framePrinterLayerLimit(h);
  p.startLayer=Math.max(1,Math.min(p.startLayer,limit));p.endLayer=Math.max(1,Math.min(p.endLayer,limit));
  if(key==='startLayer'&&p.endLayer<p.startLayer)p.endLayer=p.startLayer;if(p.startLayer>p.endLayer)p.startLayer=p.endLayer;
  const s=framePrinters.get(h);
  if(s&&['layerHeight','initialLayerHeight'].includes(key))framePrinterSupportInvalidate(s);
  if(s&&!['startLayer','endLayer','layerPosition','overhangAngle'].includes(key)){s.cancel?.();framePrinterClear(s);s.status='Settings changed · slice again';}
  if(s&&key==='endLayer')p.layerPosition=framePrinterCount(s,p.endLayer);
  for(const k of ['startLayer','endLayer','layerPosition']){const input=host.attrContent.querySelector('[data-printer-field="'+k+'"]');if(input)host.setNumericInputDisplay(input,p[k],0);}
  framePrinterRange(h);framePrinterStatus(h);host.scheduleRender();
}
function framePrinterSetDisplayMode(h,mode){
  const s=framePrinterEnsure(h);s.displayMode=mode==='lines-dots'?'lines-dots':'solid';
  if(s.displayMode==='lines-dots')for(const q of s.chunks)if(!q.debug)framePrinterDebugMesh(h,s,q);
  framePrinterRange(h);framePrinterStatus(h);host.scheduleRender();return framePrinterState(h);
}
function framePrinterDebugMesh(h,s,q){
  const source=q.mesh.geometry,g=new THREE2.InstancedBufferGeometry();g.setAttribute('position',source.attributes.position);g.setIndex(source.index);
  for(const key of ['segmentStart','segmentEnd','segmentMeta','segmentRisk'])g.setAttribute(key,source.attributes[key]);g.instanceCount=q.count;
  const shared=q.mesh.material.uniforms,m=new THREE2.ShaderMaterial({transparent:true,depthWrite:true,side:THREE2.DoubleSide,uniforms:{firstLayer:shared.firstLayer,lastLayer:shared.lastLayer,layerPosition:shared.layerPosition,viewport:{value:new THREE2.Vector4()},pixelRatio:{value:host.PR},supportEnabled:shared.supportEnabled,warningAngle:shared.warningAngle},vertexShader:`
    attribute vec3 segmentStart;attribute vec3 segmentEnd;attribute vec3 segmentMeta;attribute float segmentRisk;uniform float supportEnabled;uniform float warningAngle;varying float risk;
    uniform float firstLayer;uniform float lastLayer;uniform float layerPosition;uniform vec4 viewport;uniform float pixelRatio;
    varying vec4 endpointPixels;varying float pointRadius;varying float strokeRadius;
    void main(){
      if(segmentMeta.x<firstLayer||segmentMeta.x>lastLayer||(segmentMeta.x==lastLayer&&segmentMeta.y>=layerPosition)){gl_Position=vec4(2.,2.,2.,1.);return;}
      vec4 a=projectionMatrix*modelViewMatrix*vec4(segmentStart,1.),b=projectionMatrix*modelViewMatrix*vec4(segmentEnd,1.);
      vec2 x=viewport.xy+(a.xy/a.w*.5+.5)*viewport.zw,y=viewport.xy+(b.xy/b.w*.5+.5)*viewport.zw,d=y-x;
      d=length(d)>1e-6?normalize(d):vec2(1.,0.);vec2 normal=vec2(-d.y,d.x);
      risk=segmentRisk*supportEnabled;pointRadius=2.7*pixelRatio;strokeRadius=.65*pixelRatio;endpointPixels=vec4(x,y);
      gl_Position=mix(a,b,position.x);gl_Position.xy+=(d*(position.x*2.-1.)+normal*position.y)*(pointRadius+pixelRatio)/viewport.zw*2.*gl_Position.w;
    }`,fragmentShader:`
    varying vec4 endpointPixels;varying float pointRadius;varying float strokeRadius;varying float risk;uniform float warningAngle;
    void main(){vec2 a=endpointPixels.xy,b=endpointPixels.zw,p=gl_FragCoord.xy,d=b-a;float t=clamp(dot(p-a,d)/max(dot(d,d),1e-8),0.,1.);
      float stroke=length(p-a-t*d),dotDistance=min(length(p-a),length(p-b));float alpha=max(1.-smoothstep(strokeRadius-.5,strokeRadius+.5,stroke),1.-smoothstep(pointRadius-.5,pointRadius+.5,dotDistance));
      if(alpha<=0.)discard;vec3 color=dotDistance<=pointRadius?vec3(1.,.76,.36):vec3(.55,.85,.9);if(risk>warningAngle&&risk>0.)color=vec3(1.,.12,.12);gl_FragColor=vec4(color,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  q.debug=new THREE2.Mesh(g,m);q.debug.frustumCulled=false;q.debug.userData.framePrinter=h;q.debug.onBeforeRender=renderer=>{renderer.getCurrentViewport(m.uniforms.viewport.value);m.uniforms.pixelRatio.value=renderer.getPixelRatio();};s.paths.add(q.debug);
}
function framePrinterAttributes(h){
  const p=host.objParams.get(h),s=framePrinterEnsure(h);host.attrContent.innerHTML='';
  const b=document.createElement('button');b.className='attr-btn';b.dataset.printerSlice=h;b.textContent='Slice';b.onclick=()=>{if(s.busy)s.cancel?.();else framePrinterSlice(h).catch(error=>{s.status=error.message;framePrinterStatus(h);});};const action=host.attrRow('');action.appendChild(b);
  const display=document.createElement('button');display.className='attr-btn';display.dataset.printerDisplay=h;display.textContent='Lines–Dots';display.title='Show thin centerlines and true segment endpoints';display.onclick=()=>framePrinterSetDisplayMode(h,s.displayMode==='lines-dots'?'solid':'lines-dots');
  const status=action.previousElementSibling;status.classList.add('printer-status');status.dataset.printerStatus=h;status.setAttribute('role','status');
  const R=(label,key,options={})=>{const input=host.attrInput(host.attrRow(label),{h,get:()=>p[key],set:v=>framePrinterSetField(h,key,v),...options});input.setAttribute('aria-label',label);input.dataset.printerField=key;input.dataset.printerObject=h;return input;};
  const layerRange=()=>[1,framePrinterLayerLimit(h)];
  R('Start layer','startLayer',{int:true,min:1,stepFixed:1,scrubRange:layerRange});R('Finish layer','endLayer',{int:true,min:1,stepFixed:1,scrubRange:layerRange});
  R('Layer position','layerPosition',{int:true,min:0,stepFixed:1,scrubRange:()=>[0,framePrinterCount(s,p.endLayer)]}).title='Number of visible segments in the finish layer';
  const divider=document.createElement('div');divider.className='attr-group-header';divider.textContent='Basic';divider.style.cssText='margin:0;padding:0 0 4px;font-size:14px';host.attrContent.appendChild(divider);
  R('Line width','lineWidth',{min:.0001,stepFixed:.1});R('Layer height','layerHeight',{min:.0001,stepFixed:.1});R('Initial layer height','initialLayerHeight',{min:.0001,stepFixed:.1});
  const perimeter=R('Perimeters','perimeters',{int:true,min:1,max:1,stepFixed:1});perimeter.readOnly=true;perimeter.title='Exactly one inward perimeter';
  R('Overhang angle','overhangAngle',{min:0,max:90,stepFixed:1}).title='Immediately color visible downward-facing surfaces beyond this angle; no support calculation.';
  R('Min path length','minPathLength',{min:0,stepFixed:.1}).title='Minimum total length of a closed perimeter, in millimetres';
  const original=document.createElement('button');original.className='attr-btn';original.dataset.printerOriginal=h;original.textContent='Original Lines–Dots';original.onclick=()=>framePrinterSetOriginal(h,!s.originalEnabled).catch(error=>{s.status=error.message;framePrinterStatus(h);});
  const controls=host.attrRow('');controls.style.gap='3px';controls.parentElement.style.height='auto';controls.parentElement.style.minHeight='20px';for(const button of [display,original]){button.style.whiteSpace='normal';button.style.flex='0 1 auto';button.style.lineHeight='16px';}controls.append(display,original);
  framePrinterSupportAttributes(h);
  framePrinterStatus(h);if(host.panelsEl.clientHeight<340&&typeof host.obWrapH==='number'){host.obWrapH-=340-host.panelsEl.clientHeight;host.relayoutStrip();}
}
const framePrinterCount=(s,layer)=>(s.layers.get(layer)||[]).reduce((n,p)=>n+p.length,0);
function framePrinterRange(h){
  const s=framePrinters.get(h),p=host.objParams.get(h);if(!s||!p)return;
  if(s.stats&&s.sliceParams&&['lineWidth','layerHeight','initialLayerHeight','minPathLength'].some(k=>s.sliceParams[k]!==p[k])){framePrinterClear(s);s.status='Settings changed · slice again';}
  const limit=framePrinterLayerLimit(h,p);
  // A restored or invalidated preview has no actual layer count yet. Keep its chosen
  // finish until the next successful Slice, rather than clamping during asynchronous load.
  p.startLayer=Math.max(1,Math.round(p.startLayer));p.endLayer=Math.max(p.startLayer,Math.round(p.endLayer));
  if(s.stats||!p.finishLayerInitialized){p.startLayer=Math.min(p.startLayer,limit);p.endLayer=Math.max(p.startLayer,Math.min(p.endLayer,limit));}
  p.layerPosition=Math.max(0,Math.min(Math.round(p.layerPosition),framePrinterCount(s,p.endLayer)));
  for(const key of ['startLayer','endLayer','layerPosition']){const input=host.attrContent.querySelector('[data-printer-field="'+key+'"][data-printer-object="'+h+'"]');if(input){input.max=key==='layerPosition'?framePrinterCount(s,p.endLayer):limit;if(document.activeElement!==input)host.setNumericInputDisplay(input,p[key],0);}}
  let visible=0;for(const [layer,paths] of s.layers){const count=paths.reduce((n,path)=>n+path.length,0);if(layer>=p.startLayer&&layer<=p.endLayer)visible+=layer===p.endLayer?Math.min(count,p.layerPosition):count;}
  s.visibleSegments=s.root.visible?visible:0;
  for(const q of s.chunks){const u=q.mesh.material.uniforms;u.firstLayer.value=p.startLayer;u.lastLayer.value=p.endLayer;u.layerPosition.value=p.layerPosition;const inRange=q.maxLayer>=p.startLayer&&q.minLayer<=p.endLayer;q.mesh.visible=inRange&&s.displayMode!=='lines-dots';if(q.debug)q.debug.visible=inRange&&s.displayMode==='lines-dots';}
  let originalVisible=0;for(const q of s.originalChunks||[]){const u=q.mesh.material.uniforms;u.firstLayer.value=p.startLayer;u.lastLayer.value=p.endLayer;u.layerPosition.value=p.layerPosition;q.mesh.visible=!!s.originalEnabled&&q.maxLayer>=p.startLayer&&q.minLayer<=p.endLayer;if(q.mesh.visible&&s.root.visible)for(const [layer,ordinals] of q.progress){if(layer<p.startLayer||layer>p.endLayer)continue;if(layer!==p.endLayer)originalVisible+=ordinals.length;else{let a=0,b=ordinals.length;while(a<b){const m=(a+b)>>>1;if(ordinals[m]<p.layerPosition)a=m+1;else b=m;}originalVisible+=a;}}}
  s.visibleOriginalSegments=originalVisible;framePrinterSupportRange(h);
}
async function framePrinterBuildDisplay(h,staging,check){
  const s=staging||framePrinters.get(h),p=staging?.params||host.objParams.get(h);const chunkSize=16384;let count=0,startBuffer=null,endBuffer=null,metaBuffer=null,minChunkLayer=Infinity,maxChunkLayer=-Infinity;
  const flush=()=>{if(!count)return;const n=count,starts=n===chunkSize?startBuffer:startBuffer.slice(0,n*3),ends=n===chunkSize?endBuffer:endBuffer.slice(0,n*3),meta=n===chunkSize?metaBuffer:metaBuffer.slice(0,n*3),minLayer=minChunkLayer,maxLayer=maxChunkLayer;
    const g=new THREE2.InstancedBufferGeometry();g.setAttribute('position',new THREE2.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));g.setIndex([0,1,2,2,1,3]);g.setAttribute('segmentStart',new THREE2.InstancedBufferAttribute(starts,3));g.setAttribute('segmentEnd',new THREE2.InstancedBufferAttribute(ends,3));g.setAttribute('segmentMeta',new THREE2.InstancedBufferAttribute(meta,3));g.setAttribute('segmentRisk',new THREE2.InstancedBufferAttribute(new Float32Array(n),1));g.instanceCount=n;
    const m=new THREE2.ShaderMaterial({side:THREE2.DoubleSide,transparent:true,depthWrite:true,alphaToCoverage:true,uniforms:{lineWidth:{value:p.lineWidth},firstLayer:{value:p.startLayer},lastLayer:{value:p.endLayer},layerPosition:{value:p.layerPosition},pixelHeight:{value:720},supportEnabled:{value:1},warningAngle:{value:p.overhangAngle}},vertexShader:`
      attribute vec3 segmentStart; attribute vec3 segmentEnd; attribute vec3 segmentMeta;attribute float segmentRisk;uniform float supportEnabled;uniform float warningAngle;varying float risk;
      uniform float lineWidth; uniform float firstLayer; uniform float lastLayer; uniform float layerPosition; uniform float pixelHeight;
      varying float ribbonSide;
      void main(){
        if(segmentMeta.x<firstLayer||segmentMeta.x>lastLayer||(segmentMeta.x==lastLayer&&segmentMeta.y>=layerPosition)){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec3 endpoint=mix(segmentStart,segmentEnd,position.x);vec2 d=normalize(segmentEnd.xz-segmentStart.xz),normal=vec2(-d.y,d.x);
        vec3 eye=(modelViewMatrix*vec4(endpoint,1.)).xyz,horizontal=normalize(mat3(modelViewMatrix)*vec3(normal.x,0.,normal.y)),vertical=normalize(mat3(modelViewMatrix)*vec3(0.,1.,0.));
        vec3 axis=cross(vertical,horizontal);bool ortho=projectionMatrix[3][3]>.5;vec3 sight=ortho?vec3(0.,0.,1.):normalize(-eye),side=cross(axis,sight);side=length(side)>1e-5?normalize(side):horizontal;
        float nh=dot(side,horizontal),nv=dot(side,vertical),height=segmentMeta.z,radius=max(1e-8,length(vec2(nh*lineWidth,nv*height))*.5);
        vec2 section=vec2(nh*lineWidth*lineWidth,nv*height*height)/(4.*radius);
        float pixel=2.*(ortho?1.:max(.001,-eye.z))/(projectionMatrix[1][1]*pixelHeight),expand=max(1.,pixel*.55/radius);
        // Straight segments terminate at their exact cap planes. No miter extension or rounded caps.
        vec3 point=endpoint+position.y*vec3(normal.x*section.x,section.y,normal.y*section.x)*expand;
        risk=segmentRisk*supportEnabled;ribbonSide=position.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);
      }`,fragmentShader:`
      varying float ribbonSide;varying float risk;uniform float warningAngle;
      void main(){float rim=abs(ribbonSide),crown=max(0.,1.-rim*rim),light=.035+.965*crown*crown*crown;
        float edge=1.-smoothstep(1.-min(.75,fwidth(rim)),1.,rim);vec3 color=risk>warningAngle&&risk>0.?vec3(1.,.12,.12):vec3(.43,.255,.115);gl_FragColor=vec4(color*light,edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    const mesh=new THREE2.Mesh(g,m);mesh.frustumCulled=false;mesh.userData.framePrinter=h;mesh.onBeforeRender=renderer=>{m.uniforms.pixelHeight.value=renderer.getDrawingBufferSize(new THREE2.Vector2()).y;};s.paths.add(mesh);s.chunks.push({mesh,minLayer,maxLayer,count:n,pick:framePrinterPickIndex(starts,ends,meta)});count=0;startBuffer=endBuffer=metaBuffer=null;minChunkLayer=Infinity;maxChunkLayer=-Infinity;
  };
  for(const [layer,paths] of s.layers){let index=0;const y=framePrinterLayerY(p,layer);for(const path of paths)for(let i=0;i<path.length;i++){const a=path[i],b=path[(i+1)%path.length];if(!count){startBuffer=new Float32Array(chunkSize*3);endBuffer=new Float32Array(chunkSize*3);metaBuffer=new Float32Array(chunkSize*3);}const at=count*3;
    startBuffer[at]=a[0];startBuffer[at+1]=y;startBuffer[at+2]=a[1];endBuffer[at]=b[0];endBuffer[at+1]=y;endBuffer[at+2]=b[1];metaBuffer[at]=layer;metaBuffer[at+1]=index++;metaBuffer[at+2]=layer===1?p.initialLayerHeight:p.layerHeight;minChunkLayer=Math.min(minChunkLayer,layer);maxChunkLayer=Math.max(maxChunkLayer,layer);if(++count===chunkSize){flush();if(check){check();await (globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0)));check();}}}}
  flush();if(staging)s.displayMode=framePrinters.get(h)?.displayMode;if(s.displayMode==='lines-dots')for(const q of s.chunks)framePrinterDebugMesh(h,s,q);if(!staging){framePrinterRange(h);host.scheduleRender();}
}

// Immutable section and inset references stay packed on the CPU until comparison is requested.
function framePrinterReferencePaths(s,layer,kind){
  const paths=[];for(const id of s?.layerReferenceIds.get(layer)||[]){const q=s.referenceDefs.get(id)?.[kind];if(!q)continue;let start=0;for(const end of q.ends){const p=[];for(let i=start;i<end;i++)p.push([q.coords[i*2],q.coords[i*2+1]]);paths.push(p);start=end;}}return paths;
}
function framePrinterClearOriginal(s){
  s.originalGeneration=(s.originalGeneration||0)+1;s.originalBuild=null;s.visibleOriginalSegments=0;
  for(const q of s.originalChunks||[]){q.mesh.geometry.dispose();q.mesh.material.dispose();q.mesh.removeFromParent();}s.originalChunks=[];
}
// A balanced segment bounds tree maps a reference segment to preview progress without a
// quadratic scan over every optimized segment. Equal bounds prune after the first exact hit.
function framePrinterOriginalIndex(paths){
  const edges=[];for(const p of paths)for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];edges.push({a,b,id:edges.length,minX:Math.min(a[0],b[0]),maxX:Math.max(a[0],b[0]),minY:Math.min(a[1],b[1]),maxY:Math.max(a[1],b[1])});}
  const nodes=[],order=edges.map((_,i)=>i);
  function build(first,last){const n={first,last,left:-1,right:-1,minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};for(let i=first;i<last;i++){const e=edges[order[i]];n.minX=Math.min(n.minX,e.minX);n.maxX=Math.max(n.maxX,e.maxX);n.minY=Math.min(n.minY,e.minY);n.maxY=Math.max(n.maxY,e.maxY);}const id=nodes.length;nodes.push(n);if(last-first>16){const axis=n.maxX-n.minX>=n.maxY-n.minY?0:1,part=order.slice(first,last);part.sort((i,j)=>(edges[i].a[axis]+edges[i].b[axis])-(edges[j].a[axis]+edges[j].b[axis])||i-j);for(let i=0;i<part.length;i++)order[first+i]=part[i];const mid=(first+last)>>>1;n.left=build(first,mid);n.right=build(mid,last);}return id;}
  if(edges.length)build(0,edges.length);
  const bound=(n,x,y)=>Math.max(n.minX-x,0,x-n.maxX)**2+Math.max(n.minY-y,0,y-n.maxY)**2;
  return {nearest(x,y){if(!edges.length)return 0;let best=Infinity,id=0;const stack=[0];while(stack.length){const n=nodes[stack.pop()];if(bound(n,x,y)>=best)continue;if(n.left>=0){const a=bound(nodes[n.left],x,y),b=bound(nodes[n.right],x,y);if(a<b)stack.push(n.right,n.left);else stack.push(n.left,n.right);continue;}for(let i=n.first;i<n.last;i++){const e=edges[order[i]],dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],t=Math.max(0,Math.min(1,((x-e.a[0])*dx+(y-e.a[1])*dy)/(dx*dx+dy*dy||1))),d=(x-e.a[0]-t*dx)**2+(y-e.a[1]-t*dy)**2;if(d<best){best=d;id=e.id;}}}return id;}};
}
async function framePrinterBuildOriginal(h,staging,check){
  const s=staging||framePrinters.get(h),p=staging?.params||s.sliceParams||host.objParams.get(h),chunkSize=16384;let count=0,starts=null,ends=null,meta=null,lo=Infinity,hi=-Infinity;
  const flush=()=>{if(!count)return;const g=new THREE2.InstancedBufferGeometry();g.setAttribute('position',new THREE2.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));g.setIndex([0,1,2,2,1,3]);g.setAttribute('segmentStart',new THREE2.InstancedBufferAttribute(count===chunkSize?starts:starts.slice(0,count*3),3));g.setAttribute('segmentEnd',new THREE2.InstancedBufferAttribute(count===chunkSize?ends:ends.slice(0,count*3),3));g.setAttribute('segmentMeta',new THREE2.InstancedBufferAttribute(count===chunkSize?meta:meta.slice(0,count*2),2));g.instanceCount=count;
    const m=new THREE2.ShaderMaterial({transparent:true,depthWrite:false,depthTest:false,side:THREE2.DoubleSide,uniforms:{firstLayer:{value:p.startLayer},lastLayer:{value:p.endLayer},layerPosition:{value:p.layerPosition},viewport:{value:new THREE2.Vector4()},pixelRatio:{value:host.PR}},vertexShader:`
      attribute vec3 segmentStart;attribute vec3 segmentEnd;attribute vec2 segmentMeta;
      uniform float firstLayer;uniform float lastLayer;uniform float layerPosition;uniform vec4 viewport;uniform float pixelRatio;
      varying vec4 endpointPixels;varying float pointRadius;varying float strokeRadius;
      void main(){
        if(segmentMeta.x<firstLayer||segmentMeta.x>lastLayer||(segmentMeta.x==lastLayer&&segmentMeta.y>=layerPosition)){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec4 a=projectionMatrix*modelViewMatrix*vec4(segmentStart,1.),b=projectionMatrix*modelViewMatrix*vec4(segmentEnd,1.);
        vec2 x=viewport.xy+(a.xy/a.w*.5+.5)*viewport.zw,y=viewport.xy+(b.xy/b.w*.5+.5)*viewport.zw,d=y-x;d=length(d)>1e-6?normalize(d):vec2(1.,0.);vec2 normal=vec2(-d.y,d.x);
        pointRadius=2.7*pixelRatio;strokeRadius=.65*pixelRatio;endpointPixels=vec4(x,y);gl_Position=mix(a,b,position.x);gl_Position.xy+=(d*(position.x*2.-1.)+normal*position.y)*(pointRadius+pixelRatio)/viewport.zw*2.*gl_Position.w;
      }`,fragmentShader:`
      varying vec4 endpointPixels;varying float pointRadius;varying float strokeRadius;
      void main(){vec2 a=endpointPixels.xy,b=endpointPixels.zw,p=gl_FragCoord.xy,d=b-a;float t=clamp(dot(p-a,d)/max(dot(d,d),1e-8),0.,1.),stroke=length(p-a-t*d),dotDistance=min(length(p-a),length(p-b));float alpha=max(1.-smoothstep(strokeRadius-.5,strokeRadius+.5,stroke),1.-smoothstep(pointRadius-.5,pointRadius+.5,dotDistance));if(alpha<=0.)discard;vec3 color=dotDistance<=pointRadius?vec3(.2,1.,.62):vec3(.14,.95,.69);gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    const progress=new Map();for(let i=0;i<count;i++){const layer=meta[i*2];if(!progress.has(layer))progress.set(layer,[]);progress.get(layer).push(meta[i*2+1]);}for(const [layer,values] of progress)progress.set(layer,Uint32Array.from(values.sort((a,b)=>a-b)));
    const mesh=new THREE2.Mesh(g,m);mesh.frustumCulled=false;mesh.renderOrder=10;mesh.userData.framePrinterOriginal=h;mesh.raycast=()=>{};mesh.onBeforeRender=renderer=>{renderer.getCurrentViewport(m.uniforms.viewport.value);m.uniforms.pixelRatio.value=renderer.getPixelRatio();};s.paths.add(mesh);s.originalChunks.push({mesh,minLayer:lo,maxLayer:hi,count,progress});count=0;starts=ends=meta=null;lo=Infinity;hi=-Infinity;
  };
  for(const [layer,paths] of s.layers){const ids=s.layerReferenceIds.get(layer)||[];if(!ids.length)continue;const index=framePrinterOriginalIndex(paths),y=framePrinterLayerY(p,layer);for(const id of ids){const q=s.referenceDefs.get(id)?.inset;if(!q)throw Error('Missing original polyline reference');let first=0;for(const end of q.ends){for(let i=first;i<end;i++){const j=i+1===end?first:i+1,ax=q.coords[i*2],ay=q.coords[i*2+1],bx=q.coords[j*2],by=q.coords[j*2+1];if(!count){starts=new Float32Array(chunkSize*3);ends=new Float32Array(chunkSize*3);meta=new Float32Array(chunkSize*2);}starts.set([ax,y,ay],count*3);ends.set([bx,y,by],count*3);meta.set([layer,index.nearest((ax+bx)*.5,(ay+by)*.5)],count*2);lo=Math.min(lo,layer);hi=Math.max(hi,layer);if(++count===chunkSize){flush();check?.();await (globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0)));check?.();}}first=end;}}
  }flush();
}
async function framePrinterSetOriginal(h,enabled){
  const s=framePrinterEnsure(h);s.originalEnabled=!!enabled;framePrinterStatus(h);
  if(s.originalEnabled&&s.referenceDefs.size&&!s.originalChunks.length){if(!s.originalBuild){const generation=s.originalGeneration,stage={layers:s.layers,params:s.sliceParams,referenceDefs:s.referenceDefs,layerReferenceIds:s.layerReferenceIds,originalChunks:[],paths:new THREE2.Group()},check=()=>{if(framePrinters.get(h)!==s||generation!==s.originalGeneration)throw Object.assign(Error('Original polyline preview changed'),{code:'FRAME_ORIGINAL_CHANGED'});};
      const promise=(async()=>{try{await framePrinterBuildOriginal(h,stage,check);check();s.originalChunks=stage.originalChunks;stage.originalChunks=[];while(stage.paths.children.length)s.paths.add(stage.paths.children[0]);}catch(error){if(error.code!=='FRAME_ORIGINAL_CHANGED')throw error;}finally{stage.paths.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});stage.paths.clear();if(s.originalBuild===promise)s.originalBuild=null;framePrinterRange(h);framePrinterStatus(h);host.scheduleRender();}})();s.originalBuild=promise;}
    await s.originalBuild;
  }framePrinterRange(h);framePrinterStatus(h);host.scheduleRender();return framePrinterState(h);
}

// Bounds index over segment endpoints; camera-dependent ribbon extents are applied at query time.
function framePrinterPickIndex(starts,ends,meta){
  const order=new Uint32Array(starts.length/3);let minHeight=Infinity,maxHeight=0;for(let i=0;i<order.length;i++){order[i]=i;minHeight=Math.min(minHeight,meta[i*3+2]);maxHeight=Math.max(maxHeight,meta[i*3+2]);}
  const nodes=[];
  const build=(first,last,depth)=>{
    const node={first,last,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],lo:Infinity,hi:-Infinity,left:-1,right:-1,axis:0};
    const id=nodes.length;nodes.push(node);
    for(let j=first;j<last;j++){const i=order[j]*3,ax=starts[i],ay=starts[i+1],az=starts[i+2],bx=ends[i],by=ends[i+1],bz=ends[i+2],layer=meta[i];
      node.min[0]=Math.min(node.min[0],ax,bx);node.max[0]=Math.max(node.max[0],ax,bx);
      node.min[1]=Math.min(node.min[1],ay,by);node.max[1]=Math.max(node.max[1],ay,by);
      node.min[2]=Math.min(node.min[2],az,bz);node.max[2]=Math.max(node.max[2],az,bz);
      node.lo=Math.min(node.lo,layer);node.hi=Math.max(node.hi,layer);}
    if(last-first<=32||depth>=32)return id;
    const extent=node.max.map((v,k)=>v-node.min[k]);node.axis=extent.indexOf(Math.max(...extent));const axis=node.axis,split=(node.min[axis]+node.max[axis])*.5;let middle=first;
    for(let j=first;j<last;j++){const i=order[j]*3;if((starts[i+axis]+ends[i+axis])*.5<split){const swap=order[middle];order[middle++]=order[j];order[j]=swap;}}
    if(middle===first||middle===last)middle=(first+last)>>>1;
    node.left=build(first,middle,depth+1);node.right=build(middle,last,depth+1);return id;
  };
  if(order.length)build(0,order.length,0);return {order,nodes,minHeight,maxHeight};
}
function framePrinterNavigationHit(ray,cam,maxDistance=Infinity){
  let best=null;
  const inverse=new THREE2.Matrix4(),mv=new THREE2.Matrix4(),localRay=new THREE2.Ray(),box=new THREE2.Box3(),probe=new THREE2.Vector3(),point=new THREE2.Vector3(),world=new THREE2.Vector3();
  const a=new THREE2.Vector3(),b=new THREE2.Vector3(),c=new THREE2.Vector3(),d=new THREE2.Vector3(),eye=new THREE2.Vector3(),horizontal=new THREE2.Vector3(),vertical=new THREE2.Vector3(),axis=new THREE2.Vector3(),side=new THREE2.Vector3(),sight=new THREE2.Vector3();
  const xColumn=new THREE2.Vector3(),zColumn=new THREE2.Vector3(),planeNormal=new THREE2.Vector3();
  for(const [h,s] of framePrinters){
    if(!s.root.visible||!s.paths.visible||!host.effectiveVisible(h)||!framePrinterEnabled(h))continue;
    for(const q of s.chunks){
      const mesh=q.mesh,u=mesh.material.uniforms,index=q.pick;
      if((!mesh.visible&&!q.debug?.visible)||!mesh.material.visible||!cam.layers.test(mesh.layers)||!index?.nodes.length)continue;
      mesh.updateWorldMatrix(true,false);if(Math.abs(mesh.matrixWorld.determinant())<1e-20)continue;
      inverse.copy(mesh.matrixWorld).invert();localRay.copy(ray.ray).applyMatrix4(inverse);mv.multiplyMatrices(cam.matrixWorldInverse,mesh.matrixWorld);
      const g=mesh.geometry,starts=g.attributes.segmentStart.array,ends=g.attributes.segmentEnd.array,meta=g.attributes.segmentMeta.array,width=u.lineWidth.value;
      const {minHeight,maxHeight}=index;
      const bounds=index.nodes[0];let depth=.001;
      for(let i=0;i<8;i++){eye.set(i&1?bounds.max[0]:bounds.min[0],i&2?bounds.max[1]:bounds.min[1],i&4?bounds.max[2]:bounds.min[2]).applyMatrix4(mv);depth=Math.max(depth,-eye.z);}
      vertical.setFromMatrixColumn(mv,1).normalize();xColumn.setFromMatrixColumn(mv,0);zColumn.setFromMatrixColumn(mv,2);planeNormal.crossVectors(xColumn,zColumn).normalize();
      const cosine=Math.abs(vertical.dot(planeNormal)),correlation=Math.sqrt(Math.max(0,1-cosine*cosine));
      const minRadius=Math.max(1e-8,Math.min(width,minHeight)*.5*Math.sqrt(Math.max(0,1-correlation)));
      const pixel=2*(cam.isOrthographicCamera?1:depth)/(cam.projectionMatrix.elements[5]*u.pixelHeight.value),expand=Math.max(1,pixel*.55/minRadius);
      const margin=[width*.5*expand,maxHeight*.5*expand,width*.5*expand],stack=[0];
      const vertex=(offset,end,i)=>{
        eye.copy(end).applyMatrix4(mv);
        horizontal.set(mv.elements[0]*offset.x+mv.elements[8]*offset.z,mv.elements[1]*offset.x+mv.elements[9]*offset.z,mv.elements[2]*offset.x+mv.elements[10]*offset.z).normalize();
        axis.crossVectors(vertical,horizontal);if(cam.isOrthographicCamera)sight.set(0,0,1);else sight.copy(eye).negate().normalize();
        side.crossVectors(axis,sight);if(side.length()>1e-5)side.normalize();else side.copy(horizontal);
        const nh=side.dot(horizontal),nv=side.dot(vertical),height=meta[i+2],radius=Math.max(1e-8,Math.hypot(nh*width,nv*height)*.5);
        const localPixel=2*(cam.isOrthographicCamera?1:Math.max(.001,-eye.z))/(cam.projectionMatrix.elements[5]*u.pixelHeight.value),scale=Math.max(1,localPixel*.55/radius);
        return offset.clone().multiplyScalar(nh*width*width/(4*radius)*scale).addScaledVector(new THREE2.Vector3(0,1,0),nv*height*height/(4*radius)*scale);
      };
      while(stack.length){
        const node=index.nodes[stack.pop()];if(node.hi<u.firstLayer.value||node.lo>u.lastLayer.value)continue;
        box.min.set(node.min[0]-margin[0],node.min[1]-margin[1],node.min[2]-margin[2]);box.max.set(node.max[0]+margin[0],node.max[1]+margin[1],node.max[2]+margin[2]);
        if(!localRay.intersectBox(box,probe))continue;
        if(!box.containsPoint(localRay.origin)&&probe.clone().applyMatrix4(mesh.matrixWorld).distanceTo(ray.ray.origin)>maxDistance)continue;
        if(node.left>=0){const forward=localRay.direction.getComponent(node.axis)>=0;stack.push(forward?node.right:node.left,forward?node.left:node.right);continue;}
        for(let j=node.first;j<node.last;j++){
          const segment=index.order[j],i=segment*3,layer=meta[i];if(layer<u.firstLayer.value||layer>u.lastLayer.value||layer===u.lastLayer.value&&meta[i+1]>=u.layerPosition.value)continue;
          a.fromArray(starts,i);b.fromArray(ends,i);const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<1e-15)continue;
          if(s.displayMode==='lines-dots'){
            a.applyMatrix4(mesh.matrixWorld);b.applyMatrix4(mesh.matrixWorld);ray.ray.distanceSqToSegment(a,b,probe,world);
            const viewport=q.debug.material.uniforms.viewport.value,ratio=q.debug.material.uniforms.pixelRatio.value,mouse=probe.clone().project(cam),screenDistance=v=>{const p=v.clone().project(cam);return Math.hypot((p.x-mouse.x)*viewport.z*.5,(p.y-mouse.y)*viewport.w*.5);};
            let target=null;if(screenDistance(world)<=.8*ratio)target=world.clone();for(const endpoint of [a,b])if(screenDistance(endpoint)<=2.9*ratio&&(!target||endpoint.distanceTo(ray.ray.origin)<target.distanceTo(ray.ray.origin)))target=endpoint.clone();
            if(target){const distance=target.distanceTo(ray.ray.origin);probe.copy(target).project(cam);if(distance>=ray.near&&distance<=ray.far&&distance<=maxDistance&&probe.z>=-1&&probe.z<=1){maxDistance=distance;best={point:target,distance,object:h,segment};}}continue;
          }
          const normal=new THREE2.Vector3(-dz/length,0,dx/length),offsetA=vertex(normal,a,i),offsetB=vertex(normal,b,i);
          c.copy(a).add(offsetA);d.copy(b).add(offsetB);a.sub(offsetA);b.sub(offsetB);
          for(const triangle of [[a,b,c],[c,b,d]]){
            if(!localRay.intersectTriangle(...triangle,false,point))continue;
            world.copy(point).applyMatrix4(mesh.matrixWorld);const distance=world.distanceTo(ray.ray.origin);
            if(distance<ray.near||distance>ray.far||distance>maxDistance)continue;
            probe.copy(world).project(cam);if(probe.z< -1||probe.z>1)continue;
            maxDistance=distance;best={point:world.clone(),distance,object:h,segment};
          }
        }
      }
    }
  }
  return best;
}
function framePrinterPreviewVisible(){return [...framePrinters].some(([h,s])=>host.selNodes.has(h)&&s.paths.visible&&s.chunks.length&&s.root.visible);}

const framePrinterPositionAccessors=['getX','getY','getZ'].map(key=>({key,value:THREE2.BufferAttribute.prototype[key]}));
function framePrinterSnapshotPositions(a){
  // Only plain storage/metadata and original accessor methods can bypass getters.
  const raw=Object.getOwnPropertyDescriptor(a,'array')?.value,count=Object.getOwnPropertyDescriptor(a,'count')?.value;
  if(Object.getOwnPropertyDescriptor(a,'itemSize')?.value===3&&Object.getOwnPropertyDescriptor(a,'normalized')?.value===false&&ArrayBuffer.isView(raw)&&
    !Object.hasOwn(raw,'length')&&!Object.hasOwn(raw,'buffer')&&!Object.hasOwn(raw,'byteLength')&&count*3===raw.length&&raw.buffer instanceof ArrayBuffer){
    const proto=Object.getPrototypeOf(raw),Type=proto===Float32Array.prototype?Float32Array:proto===Float64Array.prototype?Float64Array:null;
    if(Type&&raw.byteLength===count*3*Type.BYTES_PER_ELEMENT&&framePrinterPositionAccessors.every(({key,value})=>{let owner=a,descriptor;while(owner&&!(descriptor=Object.getOwnPropertyDescriptor(owner,key)))owner=Object.getPrototypeOf(owner);return descriptor?.value===value;}))return new Type(raw);
  }
  const positions=new Float64Array(a.count*3);for(let i=0;i<a.count;i++){positions[i*3]=a.getX(i);positions[i*3+1]=a.getY(i);positions[i*3+2]=a.getZ(i);}return positions;
}

function frameSlicerTask(source,meshes,params,signal,onProgress,onOwner){
  return new Promise((resolve,reject)=>{
    const workers=[],ports=[],leases=new Map(),readyWaiters=new Set();let url=null,owner=null,ownerLease=null,finished=false;
    const finish=(error,stats)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);for(const w of workers)w.terminate();for(const port of ports)port.close();if(url)URL.revokeObjectURL(url);for(const fail of readyWaiters)fail(error||Object.assign(Error('Slicing cancelled.'),{code:'FRAME_SLICE_CANCELLED'}));readyWaiters.clear();for(const release of leases.values())release();leases.clear();ownerLease?.();onOwner(null);error?reject(error):resolve(stats);};
    const abort=()=>finish(Object.assign(Error('Slicing cancelled.'),{code:'FRAME_SLICE_CANCELLED'}));signal.addEventListener('abort',abort,{once:true});
    async function startPool(count){const ownerPorts=[];await Promise.all(Array.from({length:count},async(_,i)=>{
      const release=await host.frameComputeBudget.acquire('slicer',signal);if(finished){release();return;}const token='startup-'+i;leases.set(token,release);
      await new Promise((ready,fail)=>{readyWaiters.add(fail);const channel=new MessageChannel();ports.push(channel.port1,channel.port2);ownerPorts[i]=channel.port1;let child;
        try{child=new Worker(url,{name:'frame-slicer-outline-'+i});workers.push(child);child.onerror=e=>{fail(Error(e.message||'Outline worker failed.'));finish(Error(e.message||'Outline worker failed.'));};child.onmessage=({data})=>{if(finished)return;if(data.type==='outlineReady'){readyWaiters.delete(fail);leases.get(token)?.();leases.delete(token);ready();}};child.postMessage({type:'outlineStart',port:channel.port2},[channel.port2]);}catch(error){readyWaiters.delete(fail);fail(error);}
      });
    }));if(!finished)owner.postMessage({type:'outlinePool',ports:ownerPorts},ownerPorts);}
    (async()=>{ownerLease=await host.frameComputeBudget.acquire('slicer',signal);if(finished){ownerLease();return;}
      url=URL.createObjectURL(new Blob([source],{type:'application/javascript'}));owner=new Worker(url,{name:'frame-slicer-owner'});workers.push(owner);onOwner(owner);
      owner.onerror=e=>finish(Error(e.message||'Slicer worker failed.'));
      owner.onmessage=({data})=>{if(finished)return;
        if(data.type==='outlinePool'){startPool(data.count).catch(error=>finish(error));return;}
        if(data.type==='outlineAcquire'){host.frameComputeBudget.acquire('slicer',signal).then(release=>{if(finished){release();return;}leases.set(data.token,release);try{owner.postMessage({type:'outlineGrant',token:data.token});}catch(error){finish(error);}}).catch(error=>finish(error));return;}
        if(data.type==='outlineRelease'){leases.get(data.token)?.();leases.delete(data.token);return;}
        if(data.type==='error')return finish(Object.assign(Error(data.message),{code:data.code}));if(data.type==='complete')return finish(null,data.stats);try{onProgress(data);}catch(error){finish(error);}
      };
      const triangles=meshes.reduce((n,q)=>n+(q.indices?.length||q.positions.length/3)/3,0),estimate=meshes.reduce((n,q)=>n+q.positions.byteLength*2+(q.indices?.byteLength||0),0)+triangles*80,memory=(navigator.deviceMemory||4)*1024**3;
      const memorySlots=Math.max(0,Math.floor((memory*.4-estimate)/(128*1024*1024))),outlines=triangles>=50000?Math.max(0,Math.min(7,host.frameComputeBudget.interactiveLimit-1,memorySlots)):0;
      owner.postMessage({meshes,params,pipeline:{outlines}},meshes.flatMap(q=>[q.positions.buffer,...(q.indices?[q.indices.buffer]:[])]));
    })().catch(error=>finish(error));if(signal.aborted)abort();
  });
}

async function framePrinterSlice(h){
  if(!frameIsPrinter(h))throw Error('Select a 3D Printer.');const s=framePrinterEnsure(h);if(s.busy)throw Error('Slicing is already running.');
  const p={...host.objParams.get(h),perimeters:1};framePrinterValidateSettings(h,p);s.busy=true;s.status='Preparing geometry.';
  const controller=new AbortController(),endScope=host.frameComputeBudget.enterSlice();let turn=null,cancelled=false,displayed=false,displayStage=null;s.cancel=()=>{cancelled=true;controller.abort();s.status='Cancelling.';framePrinterStatus(h);};framePrinterStatus(h);
  const check=()=>{if(cancelled||!host.OBJ.has(h))throw Object.assign(Error('Slicing cancelled.'),{code:'FRAME_SLICE_CANCELLED'});if(['lineWidth','layerHeight','initialLayerHeight','minPathLength'].some(k=>host.objParams.get(h)?.[k]!==p[k]))throw Error('Settings changed · slice again');};
  try{await window.frameAI.waitForIdle();check();s.status='Waiting for slicer.';framePrinterStatus(h);turn=await host.frameComputeBudget.acquireSliceTurn(controller.signal);check();s.status='Preparing geometry.';framePrinterStatus(h);
    const f=framePrinterFrame(h),inverse=f.frame.clone().invert(),sources=framePrinterSources(),meshes=sources.map(q=>{const a=q.geometry.attributes.position,positions=framePrinterSnapshotPositions(a);return {positions,indices:q.geometry.index?new Uint32Array(q.geometry.index.array):null,matrix:inverse.clone().multiply(q.matrix).elements,group:q.group};});
    if(!meshes.length)throw Error('No visible mesh geometry to slice.');
    const layers=new Map(),angleValues=new Map(),referenceDefs=new Map(),layerReferenceIds=new Map(),started=performance.now();
    const source=await frameAssets.text('slicer-worker');document.getElementById('frame-single-slicer-worker-source').textContent=source;const stats=await frameSlicerTask(source,meshes,{...p,width:f.width,height:f.height,depth:f.depth,printClockwiseSign:f.frame.determinant()<0?-1:1,angleWarnings:true},controller.signal,data=>{for(const q of data.angleValuesList||[])angleValues.set(q.layer,q.angleValues);for(const q of data.referenceDefs||[])referenceDefs.set(q.id,q.value);for(const q of data.layers||[]){layers.set(q.layer,q.paths);if(q.angleValues)angleValues.set(q.layer,q.angleValues);layerReferenceIds.set(q.layer,q.referenceIds||[]);}s.status='Slicing '+Math.round(data.progress*100)+'%';framePrinterStatus(h);},worker=>{s.worker=worker;});check();
    const outlineFinished=performance.now();displayStage={layers:new Map([...layers].sort((a,b)=>a[0]-b[0])),params:p,chunks:[],paths:new THREE2.Group(),displayMode:s.displayMode,referenceDefs,layerReferenceIds,originalChunks:[]};
    s.status='Preparing preview.';framePrinterStatus(h);await framePrinterBuildDisplay(h,displayStage,check);check();if(s.originalEnabled){await framePrinterBuildOriginal(h,displayStage,check);check();}
    s.busy=false;s.cancel=null;framePrinterClear(s);s.layers=displayStage.layers;s.referenceDefs=displayStage.referenceDefs;s.layerReferenceIds=displayStage.layerReferenceIds;s.originalChunks=displayStage.originalChunks;displayStage.originalChunks=[];s.chunks=displayStage.chunks;displayStage.chunks=[];while(displayStage.paths.children.length)s.paths.add(displayStage.paths.children[0]);s.lastLayer=0;for(const layer of layers.keys())s.lastLayer=Math.max(s.lastLayer,layer);s.sliceParams={...p};s.supportRiskAngles=angleValues;s.angleWarningComplete=!!stats.angleWarningComplete&&!!stats.angleWarningAssociationComplete;for(const q of s.chunks){const meta=q.mesh.geometry.attributes.segmentMeta.array,risk=q.mesh.geometry.attributes.segmentRisk;for(let i=0;i<q.count;i++)risk.array[i]=angleValues.get(meta[i*3])?.[meta[i*3+1]]||0;risk.needsUpdate=true;}
    s.stats={...stats,volumeLayers:stats.layers,layers:s.lastLayer,milliseconds:outlineFinished-started,kernel:'single-inset-9',flatCaps:true,computeBudgetLimit:host.frameComputeBudget.interactiveLimit};
    const settings=host.objParams.get(h);if(!s.printableSliceInitialized&&stats.segments>0&&s.lastLayer>0){settings.endLayer=s.lastLayer;settings.finishLayerInitialized=true;s.printableSliceInitialized=true;}framePrinterRange(h);settings.layerPosition=framePrinterCount(s,settings.endLayer);s.status=stats.segments?stats.nonemptyLayers+' layers · '+stats.segments+' segments':'No printable perimeter at this line width';
    framePrinterUpdate();if(s.originalEnabled&&s.referenceDefs.size&&!s.originalChunks.length)framePrinterSetOriginal(h,true).catch(error=>{s.originalEnabled=false;s.status=error.message;framePrinterRange(h);framePrinterStatus(h);host.scheduleRender();});host.scheduleRender();if(host.selNodes.has(h))framePrinterAttributes(h);framePrinterSupportPoll(h);if(framePrinterSupportEnsure(s).result)framePrinterSupportEnsure(s).riskUpdate=framePrinterSupportUpdateTrajectoryRisk(h);displayed=true;return framePrinterState(h);
  }catch(error){s.busy=false;s.cancel=null;s.status=error.message;framePrinterStatus(h);throw error;}finally{if(displayStage){displayStage.paths.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose();});displayStage.paths.clear();}controller.abort();turn?.();if(displayed){
    // Keep the shared CPU reservation through the first display frames without delaying the API result.
    let first=null,second=null;const finish=()=>{clearTimeout(timer);if(first!=null)cancelAnimationFrame(first);if(second!=null)cancelAnimationFrame(second);endScope();};
    const timer=setTimeout(finish,50);first=requestAnimationFrame(()=>{first=null;second=requestAnimationFrame(()=>{second=null;finish();});});
  }else endScope();}
}
function framePrinterState(h){const s=framePrinters.get(h),p=host.objParams.get(h);return {object:h,displayMode:s?.displayMode||'solid',busy:!!s?.busy,status:s?.status||'Ready',slicingAvailable:true,support:framePrinterSupportState(h),params:{...p},maximumDisplayLayer:framePrinterLayerLimit(h),stats:s?.stats||null,test:null,testing:false,visibleSegments:s?.visibleSegments||0,originalPolyline:!!s?.originalEnabled,originalReferenceCount:s?.referenceDefs.size||0,originalReferenceBytes:[...(s?.referenceDefs.values()||[])].reduce((n,q)=>n+q.inset.coords.byteLength+q.inset.ends.byteLength+q.section.coords.byteLength+q.section.ends.byteLength,0),originalGpuSegments:(s?.originalChunks||[]).reduce((n,q)=>n+q.count,0),originalGpuPoints:(s?.originalChunks||[]).reduce((n,q)=>n+q.count,0),visibleOriginalSegments:s?.visibleOriginalSegments||0,originalBuilding:!!s?.originalBuild,grid:s?.grid||null};}
function framePrinterGetLayer(h,layer,details=false){
  if(!frameIsPrinter(h)||!Number.isInteger(layer)||layer<1)throw Error('Invalid layer');const p=host.objParams.get(h),paths=framePrinters.get(h)?.layers.get(layer)||[],y=framePrinterLayerY(p,layer),height=layer===1?p.initialLayerHeight:p.layerHeight,segments=[],links=[];
  for(const path of paths)for(let i=0;i<path.length;i++){const a=path[i],b=path[(i+1)%path.length],prev=path[(i+path.length-1)%path.length],after=path[(i+2)%path.length];segments.push([a[0],a[1],b[0],b[1],y,p.lineWidth,height,layer,p.lineWidth]);links.push([prev[0],prev[1],after[0],after[1],0]);}
  return {layer,segments,supportAngles:segments.map((_,i)=>{const s=framePrinters.get(h),a=framePrinterSupportEnsure(s),q=a.enabled&&a.layer?s.supportRiskAngles?.get(layer)?.[i]:0;return q>p.overhangAngle&&q>0?[q,q]:[0,0];}),overlapSegments:segments.map(()=>false),...(details?{paths:paths.map(path=>path.map(q=>q.slice())),originalPaths:framePrinterReferencePaths(framePrinters.get(h),layer,'inset'),sectionPaths:framePrinterReferencePaths(framePrinters.get(h),layer,'section'),links,overlapGroups:segments.map(()=>0),overlapMarks:segments.map(()=>0),overlapAtEnds:segments.map(()=>false)}:{})};
}
let framePrinterPreviewActive=false;
function framePrinterRender(draw,cam){
  const preview=framePrinterPreviewVisible(),saved=new Map();
  const before=framePrinterPreviewActive;for(const [h]of framePrinters)framePrinterAngleUpdate(h,cam);
  // Hide source roots for this draw so child geometry, wires and shared surface batches
  // all follow preview visibility, including a pending asynchronous surface rebuild.
  // Restore authored visibility even if rendering fails.
  try{if(preview){for(const [h,mesh] of host.pickMeshes){if(frameIsPrinter(h)||!framePrinterSourceEnabled(h)||saved.has(mesh))continue;saved.set(mesh,mesh.visible);mesh.visible=false;}framePrinterPreviewActive=true;}draw();}
  finally{for(const [mesh,visible] of saved)mesh.visible=visible;framePrinterPreviewActive=before;}
}

function framePrinterInitialize(){
  const icon='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M5 27V5h22v22M5 9h22M16 9v7m-3 0h6l-2 4h-2zM8 25h16M10 25v-4h4m4 0h4v4M5 28h22"/><path d="M16 20v3" stroke="#e9a45e"/></svg>';
  document.getElementById('tabModules').innerHTML='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M7 7h7v7H7zM18 7h7v7h-7zM7 18h7v7H7zM18 21.5h7m-3.5-3.5v7"/></svg>';
  document.getElementById('tabModules').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();host.activateTab('tabModules');}};
  const b=document.getElementById('btn3DPrinting');b.innerHTML=icon;b.onclick=()=>{const h=host.addPlain('printer',TYPE_PRINTER,true,1);host.setObjField(h,'name','3D Printer');framePrinterUpdate();host.treeChanged();return h;};
}
return {TYPE_PRINTER,framePrinters,FRAME_PRINTER_DEFAULTS,framePrinterLayerY,frameIsPrinter,framePrinterEnabled,framePrinterFrame,framePrinterNoSkew,framePrinterSources,framePrinterClear,framePrinterDispose,framePrinterEnsure,framePrinterUpdate,framePrinterGrid,framePrinterDepthRange,framePrinterStatus,framePrinterLayerLimit,framePrinterValidateSettings,framePrinterSetField,framePrinterSetDisplayMode,framePrinterSetOriginal,framePrinterReferencePaths,framePrinterOriginalIndex,framePrinterBuildOriginal,framePrinterDebugMesh,framePrinterAttributes,framePrinterCount,framePrinterRange,framePrinterBuildDisplay,framePrinterPickIndex,framePrinterNavigationHit,framePrinterPreviewVisible,framePrinterPositionAccessors,framePrinterSnapshotPositions,frameSlicerTask,framePrinterSlice,framePrinterState,framePrinterGetLayer,framePrinterPreviewActive,framePrinterRender,framePrinterInitialize};
}
