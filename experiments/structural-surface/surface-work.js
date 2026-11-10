import {SAT_HELPERS} from './sat-reference.js';
/** GPU kernel source only. Compilation/execution awaits the coordinated gate.
 * Labels: 0 surface-free/unclassified volume, 2 surface candidate, 3 uncertain.
 * No inside/outside inference or physical material is assigned.
 */
export function nativeSurfaceWGSL(storage){
 if(!['buffer','texture'].includes(storage))throw Error('Unsupported native storage');
 const texture=storage==='texture';
 return `struct Config { matrix:mat4x4f, origin:vec4f, step:vec4f, dims:vec4u, range:vec4u };
@group(0) @binding(0) var<uniform> cfg:Config;
@group(0) @binding(1) var ${texture?'positions:texture_2d_array<u32>':'<storage,read> positions:array<f32>'};
@group(0) @binding(2) var ${texture?'indices:texture_2d_array<u32>':'<storage,read> indices:array<u32>'};
@group(0) @binding(3) var<storage,read_write> labels:array<u32>;
${texture?`fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
fn index(i:u32)->u32{return scalar(indices,i);}fn value(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`:`fn index(i:u32)->u32{return indices[i];}fn value(i:u32)->f32{return positions[i];}`}
fn maximum(v:vec3f)->f32{return max(v.x,max(v.y,v.z));}
fn point(i:u32)->vec3f{return (cfg.matrix*vec4f(value(3u*i),value(3u*i+1u),value(3u*i+2u),1)).xyz;}
${SAT_HELPERS}
@compute @workgroup_size(64) fn surface(@builtin(global_invocation_id) tid:vec3u){
 let id=tid.x;if(id>=cfg.dims.w||labels[id]==2u){return;}
 let xyz=vec3u(id%cfg.dims.x,(id/cfg.dims.x)%cfg.dims.y,id/(cfg.dims.x*cfg.dims.y));
 let centre=(vec3f(xyz)+vec3f(0.5))*cfg.step.xyz;let halfSize=cfg.step.xyz*0.5;
 for(var t=cfg.range.x;t<cfg.range.y;t++){
  let ia=index(3u*t);let ib=index(3u*t+1u);let ic=index(3u*t+2u);
  if(max(ia,max(ib,ic))>=cfg.range.z){labels[id]=3u;continue;}
  let pa=point(ia);let pb=point(ib);let pc=point(ic);
  let a=(pa-cfg.origin.xyz)/cfg.origin.w-centre;let b=(pb-cfg.origin.xyz)/cfg.origin.w-centre;let c=(pc-cfg.origin.xyz)/cfg.origin.w-centre;
  if(any(!(abs(a)<vec3f(1e6)))||any(!(abs(b)<vec3f(1e6)))||any(!(abs(c)<vec3f(1e6)))){labels[id]=3u;continue;}
  let coordinateMagnitude=max(maximum(abs(pa)),max(maximum(abs(pb)),maximum(abs(pc))));
  let guard=3.8146973e-6*max(1.0,max(maximum(abs(cfg.origin.xyz)),coordinateMagnitude))/cfg.origin.w;
  if(touches(a,b,c,halfSize,guard)){labels[id]=2u;return;}
 }
}`;
}
/** Bounded sequential dispatch recipe over native borrowed source geometry.
 * Does not compile, allocate, submit, map or serialize anything.
 */
export function prepareNativeSurfaceWork(capture){
 capture.assertCurrent();const {domain}=capture.descriptor,meshes=capture.borrowGeometry();
 if(!domain||domain.count<1||domain.count>4096||!Number.isSafeInteger(domain.count)||domain.cells.reduce((a,b)=>a*b,1)!==domain.count)throw Error('Unsupported captured grid');
 const scale=Math.max(...domain.max.map((v,k)=>v-domain.min[k])),batchSize=Math.min(256,Math.floor(262144/domain.count));
 let pairs=0,triangles=0;const batches=[];
 for(const mesh of meshes){
  if(!Number.isSafeInteger(mesh.triangleCount)||mesh.triangleCount<1||mesh.triangleCount>65536||!Number.isSafeInteger(mesh.vertexCount)||mesh.vertexCount<1||mesh.vertexCount>0xffffffff/3)throw Error('Native surface count capacity exceeded');
  if(!['buffer','texture'].includes(mesh.storage))throw Error('Unsupported native storage');
  if(mesh.storage==='buffer'&&(!Number.isSafeInteger(mesh.positions.size)||!Number.isSafeInteger(mesh.indices.size)||!(mesh.positions.size>=mesh.vertexCount*12)||!(mesh.indices.size>=mesh.triangleCount*12)))throw Error('Native packed XYZ/index buffer capacity mismatch');
  if(mesh.storage==='texture')for(const [resource,required]of [[mesh.positions,mesh.vertexCount*3],[mesh.indices,mesh.triangleCount*3]]){
   const {count,width,height,layers}=resource,capacity=width*height*layers;
   if(!resource.view||resource.kind!=='texture'||resource.format!=='r32uint'||resource.channels!==1||![count,width,height,layers,resource.size].every(Number.isSafeInteger)||count<required||width<1||width>4096||height<1||height>4096||layers<1||!Number.isSafeInteger(capacity)||count>capacity||resource.size!==capacity*4)throw Error('Native paged texture scalar capacity/layout unavailable');
  }
  // This first source adapter admits exactly representable coefficients only.
  // Arbitrary double-precision transform-error propagation remains separate.
  if(mesh.matrix.some(v=>!Number.isFinite(v)||Math.fround(v)!==v))throw Error('Surface transform requires exact Float32 coefficients');
  pairs+=domain.count*mesh.triangleCount;triangles+=mesh.triangleCount;
  if(pairs>8000000)throw Error('Native surface work exceeds 8000000 cell-triangle pairs');
  for(let start=0;start<mesh.triangleCount;start+=batchSize){
   if(batches.length>=1024)throw Error('Native surface dispatch count exceeds 1024');
   const end=Math.min(mesh.triangleCount,start+batchSize),data=new ArrayBuffer(128),f=new Float32Array(data),u=new Uint32Array(data);
   f.set(mesh.matrix);f.set([...domain.min,scale],16);f.set([...domain.spacingLocal.map(v=>v/scale),0],20);u.set([...domain.cells,domain.count],24);u.set([start,end,mesh.vertexCount,mesh.solid],28);
   if(!Array.from(f.slice(0,24)).every(Number.isFinite)||f[19]<=0||f.slice(20,23).some(v=>v<=0))throw Error('Unrepresentable native surface grid');
   batches.push({mesh,data,start,end});
  }
 }
 capture.assertCurrent();let retired=false;
 const check=()=>{if(retired)throw Error('Retired surface work');try{capture.assertCurrent();}catch(e){retired=true;batches.length=0;throw e;}};
 return Object.freeze({summary:Object.freeze({cells:domain.count,occurrences:meshes.length,triangles,pairs,batches:batches.length,maxPairsPerBatch:262144,labelBytes:domain.count*4,geometryReadbackBytes:0,geometryClassified:false,analysisReady:false,sceneSolved:false,hardwareValidated:false}),
  borrowBatch(index){check();if(!Number.isInteger(index)||index<0||index>=batches.length)throw Error('Invalid native surface batch');const b=batches[index];return Object.freeze({solid:b.mesh.solid,storage:b.mesh.storage,positions:b.mesh.positions,indices:b.mesh.indices,config:b.data.slice(0),workgroups:Math.ceil(domain.count/64),triangleStart:b.start,triangleEnd:b.end});},
  assertCurrent:check,retire(){retired=true;batches.length=0;}
 });
}
