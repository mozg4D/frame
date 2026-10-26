// Persistent orthogonal layered depth images. Geometry never leaves the GPU.
const KEYS=['Line width','Layer height','Initial layer height'];
const MAX_LAYERS=4096,MAX_RAYS=4194304,MAX_EVENTS=16777216,MAX_HITS=1024;
const failure=(code,message)=>Object.assign(Error(message),{code});
const emptySchema={type:'object',properties:{},additionalProperties:false};
const layerY=(i,o)=>i?o.initial+(i-.5)*o.height:o.initial*.5;
const checkedModule=async(d,label,code)=>{const module=d.createShaderModule({label,code}),info=await module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('; '));return module;};

const sourceShader=texture=>`
struct Config{matrix:mat4x4f,size:vec4u,domain:vec4f,heights:vec4f};
@group(0) @binding(0) var ${texture?'positions:texture_2d_array<u32>':'<storage,read> positions:array<f32>'};
@group(0) @binding(1) var ${texture?'indices:texture_2d_array<u32>':'<storage,read> indices:array<u32>'};
@group(0) @binding(2) var<uniform> cfg:Config;
@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read> offsets:array<u32>;
@group(0) @binding(5) var<storage,read_write> cursors:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> events:array<vec2u>;
@group(0) @binding(7) var<storage,read_write> metrics:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> planes:array<vec2u>;
${texture?`fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
fn index(i:u32)->u32{return scalar(indices,i);}fn value(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`:`fn index(i:u32)->u32{return indices[i];}fn value(i:u32)->f32{return positions[i];}`}
fn point(i:u32)->vec3f{let k=index(i)*3u;return (cfg.matrix*vec4f(value(k),value(k+1u),value(k+2u),1)).xyz;}
fn ordered(x:f32)->u32{let b=bitcast<u32>(x);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
fn invocation(id:vec3u,groups:vec3u)->u32{return id.x+id.y*groups.x*128u;}
@compute @workgroup_size(128) fn bounds(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let t=invocation(gid,groups);if(t>=cfg.size.x){return;}for(var k=0u;k<3u;k++){let p=point(t*3u+k);for(var a=0u;a<3u;a++){atomicMin(&metrics[a],ordered(p[a]));atomicMax(&metrics[3u+a],ordered(p[a]));}}}
fn cross(a:vec2f,b:vec2f)->f32{let x=a.x*b.y;let y=a.y*b.x;let d=x-y;if(abs(d)>(abs(x)+abs(y))*2.3841858e-7){return d;}return d+(fma(a.x,b.y,-x)-fma(a.y,b.x,-y));}
fn project(p:vec3f,axis:u32)->vec3f{return select(p.zyx,p.xyz,axis!=0u);}
fn yAt(i:u32)->f32{return select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);}
fn before(a:vec3f,b:vec3f)->bool{return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&a.z<b.z)));}
fn raster(A:vec3f,B:vec3f,C:vec3f,axis:u32,emit:bool){
 // Canonical ordering makes duplicate/reversed triangles bit-identical.
 var a=project(A,axis);var b=project(B,axis);var c=project(C,axis);
 if(before(b,a)){let v=a;a=b;b=v;}if(before(c,b)){let v=b;b=c;c=v;}if(before(b,a)){let v=a;a=b;b=v;}
 var area=cross(b.xy-a.xy,c.xy-a.xy);if(area==0.){return;}if(area<0.){let swap=b;b=c;c=swap;area=-area;}
 let columns=select(cfg.size.z,cfg.size.y,axis!=0u);let low=select(cfg.domain.y,cfg.domain.x,axis!=0u);let pitch=select(cfg.domain.w,cfg.domain.z,axis!=0u);
 let first=u32(clamp(floor((min(a.x,min(b.x,c.x))-low)/pitch-.5)-1.,0.,f32(columns)));
 let end=u32(clamp(ceil((max(a.x,max(b.x,c.x))-low)/pitch-.5)+2.,0.,f32(columns)));
 let minY=min(a.y,min(b.y,c.y));let maxY=max(a.y,max(b.y,c.y));
 var firstLayer=u32(clamp(ceil((minY-cfg.heights.x)/cfg.heights.y+.5),1.,f32(cfg.size.w)));
 while(firstLayer>1u&&yAt(firstLayer-1u)>=minY){firstLayer--;}
 while(firstLayer<cfg.size.w&&yAt(firstLayer)<minY){firstLayer++;}
 if(yAt(0u)>=minY&&yAt(0u)<=maxY){firstLayer=0u;}
 for(var layer=firstLayer;layer<cfg.size.w;layer++){let y=yAt(layer);if(y>maxY){break;}if(y<minY){continue;}
  // Interpolate shared edges in the same direction. Half-open section
  // endpoints prevent skinny triangles and shared vertices losing a crossing.
  let vertices=array<vec3f,3>(a,b,c);var cuts:array<vec3f,2>;var n=0u;
  for(var edge=0u;edge<3u;edge++){var v=vertices[edge];var w=vertices[(edge+1u)%3u];if(v.y>w.y){let swap=v;v=w;w=swap;}
   if(v.y<=y&&y<w.y){let f=(y-v.y)/(w.y-v.y);cuts[n]=vec3f(fma(f,w.x-v.x,v.x),y,fma(f,w.z-v.z,v.z));n++;}
  }
  if(n!=2u){continue;}var v=cuts[0];var w=cuts[1];if(v.x>w.x){let swap=v;v=w;w=swap;}if(v.x==w.x){continue;}
  for(var col=first;col<end;col++){let x=low+(f32(col)+.5)*pitch;if(x<v.x||x>=w.x){continue;}
   let depth=fma((x-v.x)/(w.x-v.x),w.z-v.z,v.z);let ray=select(layer*cfg.size.z+col,cfg.size.w*cfg.size.z+layer*cfg.size.y+col,axis!=0u);
   if(emit){let at=offsets[ray]+atomicAdd(&cursors[ray],1u);events[at]=vec2u(bitcast<u32>(depth),u32(cfg.heights.z));let ab=b-a;let ac=c-a;planes[at]=bitcast<vec2u>(vec2f(ab.z*ac.y-ab.y*ac.z,ab.x*ac.z-ab.z*ac.x)/area);}
   else{atomicAdd(&counts[ray],1u);atomicAdd(&metrics[0],1u);}
  }
 }
}
@compute @workgroup_size(128) fn count(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let t=invocation(gid,groups);if(t<cfg.size.x){let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);raster(a,b,c,0u,false);raster(a,b,c,1u,false);}}
@compute @workgroup_size(128) fn emit(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let t=invocation(gid,groups);if(t<cfg.size.x){let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);raster(a,b,c,0u,true);raster(a,b,c,1u,true);}}
`;

const scanShader=`
struct Config{size:vec4u};
@group(0) @binding(0) var<storage,read> input:array<u32>;
@group(0) @binding(1) var<storage,read_write> output:array<u32>;
@group(0) @binding(2) var<storage,read_write> sums:array<u32>;
@group(0) @binding(3) var<uniform> cfg:Config;
@group(0) @binding(4) var<storage,read_write> metrics:array<atomic<u32>>;
var<workgroup> values:array<u32,256>;
@compute @workgroup_size(256) fn scan(@builtin(workgroup_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let block=gid.x+gid.y*groups.x;let i=block*256u+lane;let v=select(0u,input[min(i,cfg.size.x-1u)],i<cfg.size.x);values[lane]=v;workgroupBarrier();
 for(var step=1u;step<256u;step*=2u){var add=0u;if(lane>=step){add=values[lane-step];}workgroupBarrier();values[lane]+=add;workgroupBarrier();}
 if(i<cfg.size.x){output[i]=values[lane]-v;if(cfg.size.y!=0u){atomicMax(&metrics[1],v);}}if(lane==255u){sums[block]=values[lane];}
}
@compute @workgroup_size(256) fn add(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let i=gid.x+gid.y*groups.x*256u;if(i<cfg.size.x){output[i]+=input[i/256u];}}
`;

const cleanShader=`
struct Config{size:vec4u};
@group(0) @binding(0) var<storage,read> counts:array<u32>;
@group(0) @binding(1) var<storage,read> offsets:array<u32>;
@group(0) @binding(2) var<storage,read> events:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> headers:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> intervals:array<vec2f>;
@group(0) @binding(5) var<storage,read_write> metrics:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> cfg:Config;
@group(0) @binding(7) var<storage,read> planes:array<vec2u>;
var<workgroup> hits:array<vec4u,1024>;

fn less(a:vec4u,b:vec4u)->bool{let x=bitcast<f32>(a.x);let y=bitcast<f32>(b.x);return x<y||(x==y&&(a.y<b.y||(a.y==b.y&&(a.z<b.z||(a.z==b.z&&a.w<b.w)))));}
@compute @workgroup_size(128) fn clean(@builtin(workgroup_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let ray=gid.x+gid.y*groups.x;if(ray>=cfg.size.x){return;}let count=counts[ray];let offset=offsets[ray];
 if(lane==0u){var length=1u;while(length<count){length*=2u;}hits[0].x=length;}workgroupBarrier();let n=workgroupUniformLoad(&hits[0]).x;
 for(var i=lane;i<n;i+=128u){var v=vec4u(0x7f7fffffu,0xffffffffu,0u,0u);if(i<count){v=vec4u(events[offset+i],planes[offset+i]);}hits[i]=v;}workgroupBarrier();
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&less(hits[j],hits[i])==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane!=0u){return;}var owners:array<u32,8>;var filled=0;var i=0u;var start=0.;var written=0u;let base=offset/2u;
 while(i<count){let depth=bitcast<f32>(hits[i].x);let before=filled;
  loop{let event=hits[i];let owner=event.y;let word=owner/32u;let mask=1u<<(owner%32u);
   // Only the same depth AND plane is a duplicate. Nearby real crossings
   // retain their parity, even when a thin overlap is below the map pitch.
   filled+=select(1,-1,(owners[word]&mask)!=0u);owners[word]^=mask;i++;
   while(i<count&&all(hits[i]==event)){atomicAdd(&metrics[3],1u);i++;}
   if(i>=count||bitcast<f32>(hits[i].x)!=depth){break;}
  }
  if(before==0&&filled>0){start=depth;}if(before>0&&filled==0){let a=max(start,-500.);let b=min(depth,500.);if(b>a){intervals[base+written]=vec2f(a,b);written++;}}
 }
 // An open shell has no uniquely defined inside. Never extend an unmatched
 // event to infinity: retain completed pairs and report the ambiguous ray.
 if(filled!=0){atomicAdd(&metrics[2],1u);}headers[ray]=vec2u(base,written|select(0u,0x80000000u,filled!=0));atomicAdd(&metrics[0],written);
}
`;

const coverageShader=`
struct Config{size:vec4u,domain:vec4f,heights:vec4f};
@group(0) @binding(0) var<storage,read> headers:array<vec2u>;
@group(0) @binding(1) var<storage,read> intervals:array<vec2f>;
@group(0) @binding(2) var image:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(3) var<uniform> cfg:Config;
fn contains(ray:u32,depth:f32)->f32{let r=headers[ray];if((r.y&0x80000000u)!=0u){return -1.;}var lo=0u;var hi=r.y;while(lo<hi){let mid=(lo+hi)/2u;if(intervals[r.x+mid].x<=depth){lo=mid+1u;}else{hi=mid;}}if(lo==0u){return 0.;}return select(0.,1.,depth<intervals[r.x+lo-1u].y);}
@compute @workgroup_size(8,8) fn reconstruct(@builtin(global_invocation_id) id:vec3u){if(id.x>=cfg.size.x||id.y>=cfg.size.y){return;}
 let x=cfg.domain.x+(f32(id.x)+.5)*cfg.domain.z;let z=cfg.domain.y+(f32(id.y)+.5)*cfg.domain.w;let layer=cfg.size.w;
 let a=contains(layer*cfg.size.y+id.y,x);let b=contains(cfg.size.z*cfg.size.y+layer*cfg.size.x+id.x,z);
 let valid=u32(a>=0.)+u32(b>=0.);let coverage=(max(a,0.)+max(b,0.))/f32(max(valid,1u));textureStore(image,vec2i(id.xy),vec4f(1,1,1,coverage));}
`;

const previewShader=`
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
struct Config{size:vec4u,domain:vec4f,heights:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
@group(2) @binding(0) var image:texture_2d<f32>;
@group(2) @binding(1) var<uniform> cfg:Config;
override orthographic:bool=false;
struct Output{@builtin(position) position:vec4f,@location(0) color:vec3f,@location(1) uv:vec2f};
fn project(local:vec3f,color:vec3f,uv:vec2f)->Output{
 let p=(camera.rotation*vec4f(((frame.matrix*vec4f(local,1)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;
 let xy=p.xy+camera.viewport.zw;let depth=3.2-p.z;var out:Output;out.color=color;out.uv=uv;
 if(orthographic){out.position=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 else{out.position=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);}return out;
}
@vertex fn axes(@builtin(vertex_index) vertex:u32)->Output{let ends=array<vec3f,3>(vec3f(500,0,500),vec3f(-500,1000,500),vec3f(-500,0,-500));let colors=array<vec3f,3>(vec3f(.82,.24,.22),vec3f(.28,.71,.34),vec3f(.28,.44,.85));return project(select(vec3f(-500,0,500),ends[vertex/2u],vertex%2u!=0u),colors[vertex/2u],vec2f(0));}
@vertex fn map(@builtin(vertex_index) vertex:u32)->Output{let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));let uv=corners[vertex];let xz=cfg.domain.xy+uv*cfg.domain.zw*vec2f(cfg.size.xy);let i=cfg.size.w;let y=select(cfg.heights.x+(f32(i)-.5)*cfg.heights.y,cfg.heights.x*.5,i==0u);return project(vec3f(xz.x,y,xz.y),vec3f(1),uv);}
@fragment fn fs(input:Output)->@location(0) vec4f{return vec4f(input.color,1);}
@fragment fn coverage(input:Output)->@location(0) vec4f{let size=textureDimensions(image);let p=clamp(vec2i(input.uv*vec2f(size)),vec2i(0),vec2i(size)-1);let color=textureLoad(image,p,0);if(color.a==0.){discard;}return color;}
`;

async function createPreview(context,slicer){
 const d=context.device,module=await checkedModule(d,'Printer LDI coverage and axes',previewShader);
 const uniformLayout=()=>d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]}),cameraLayout=uniformLayout(),frameLayout=uniformLayout();
 const imageLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]});
 const pipeline=(entryPoint,orthographic)=>d.createRenderPipelineAsync({label:'Printer '+entryPoint,layout:d.createPipelineLayout({bindGroupLayouts:entryPoint==='axes'?[cameraLayout,frameLayout]:[cameraLayout,frameLayout,imageLayout]}),vertex:{module,entryPoint,constants:{orthographic}},fragment:{module,entryPoint:entryPoint==='axes'?'fs':'coverage',targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:entryPoint==='axes'?'line-list':'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'}});
 const [axes,maps]=await Promise.all([Promise.all([false,true].map(o=>pipeline('axes',o))),Promise.all([false,true].map(o=>pipeline('map',o)))]);
 const groups=new WeakMap(),group=(buffer,layout)=>{let cache=groups.get(buffer);if(!cache)groups.set(buffer,cache=new Map());if(!cache.has(layout))cache.set(layout,d.createBindGroup({layout,entries:[{binding:0,resource:{buffer}}]}));return cache.get(layout);};
 return ({pass,camera,frame,orthographic,hash,params})=>{
  pass.setPipeline(axes[orthographic?1:0]);pass.setBindGroup(0,group(camera,cameraLayout));pass.setBindGroup(1,group(frame,frameLayout));pass.draw(6);
  const job=slicer.jobs.get(hash);if(!job)return;if(job.result&&slicer.signature(hash)!==job.signature)slicer.invalidate(job);if(!job.result)return;
  slicer.reconstruct(job,Math.round(params['Finish layer']));const r=job.result;
  if(!r.previewGroup)r.previewGroup=d.createBindGroup({layout:imageLayout,entries:[{binding:0,resource:r.image.createView()},{binding:1,resource:{buffer:r.config}}]});
  pass.setPipeline(maps[orthographic?1:0]);pass.setBindGroup(2,r.previewGroup);pass.draw(6);
 };
}

class LDISlicer{
 constructor(context){this.context=context;this.jobs=new Map();this.initialized=new Map();this.serial=0;this.pipelines=new WeakMap();}
 signature(hash){try{return this.context.scene.signature(hash,KEYS);}catch{return null;}}
 config(snapshot){const p=snapshot.params,width=p['Line width'],height=p['Layer height'],initial=p['Initial layer height'];if(!(width>=.1&&width<=100&&height>=.1&&height<=100&&initial>=.1&&initial<=100))throw failure('INVALID_ARGUMENT','Invalid printer width or layer heights.');return {width,height,initial};}
 disposeResult(result){for(const b of result?.resources||[])b.destroy();}
 retire(hash){const job=this.jobs.get(hash);if(job){clearTimeout(job.refreshTimer);job.cancelled=true;this.disposeResult(job.result);this.jobs.delete(hash);}this.initialized.delete(hash);}
 check(job){if(job.cancelled)throw failure('CANCELLED','Slicing cancelled.');if(this.signature(job.hash)!==job.signature)throw failure('STALE_JOB','Source geometry, visibility, printer or sampling settings changed.');}
 invalidate(job){this.disposeResult(job.result);job.result=null;job.state='stale';try{job.refresh=this.context.scene.capture(job.hash,KEYS).contentSignature===job.contentSignature;}catch{job.refresh=false;}if(job.refresh)this.refresh(job);this.context.requestAttributes();}
 refresh(job){if(job.refreshTimer)return;job.refreshTimer=setTimeout(()=>{job.refreshTimer=0;if(this.jobs.get(job.hash)!==job||!job.refresh)return;if(this.context.scene.transforming){this.refresh(job);return;}job.refresh=false;try{this.start(job.hash,{},true);}catch(e){job.state='failed';job.error={code:e.code||'SLICE_FAILED',message:e.message};this.context.requestAttributes();}},32);}
 start(hash,args={},automatic=false){
  const snapshot=this.context.scene.capture(hash,KEYS),options=this.config(snapshot),previous=this.jobs.get(hash);if(previous?.state==='running')throw failure('BUSY','This printer is already slicing.');clearTimeout(previous?.refreshTimer);this.disposeResult(previous?.result);
  const job={id:++this.serial,hash,scene:snapshot.scene,signature:snapshot.signature,contentSignature:snapshot.contentSignature,automatic,options,state:'running',stage:'bounds',completed:0,total:2,started:performance.now(),cancelled:false,result:null};this.jobs.set(hash,job);
  this.run(job,snapshot).catch(e=>{job.state=e.code==='CANCELLED'?'cancelled':e.code==='STALE_JOB'?'stale':'failed';job.error={code:e.code||'SLICE_FAILED',message:e.message};if(job.state==='stale'&&job.automatic)this.invalidate(job);}).finally(()=>{job.ms=performance.now()-job.started;this.context.requestAttributes();this.context.requestDraw();});this.context.requestAttributes();return this.status(hash);
 }
 summary(r){return {representation:'orthogonal-ldi',topology:'even-odd-per-occurrence-union',axes:['X','Z'],builds:1,lastLayer:r.lastLayer,grid:r.grid,rawEvents:r.rawEvents,intervals:r.intervals,ambiguousRays:r.ambiguousRays,duplicateEvents:r.duplicateEvents,peakGPUBytes:r.peakGPUBytes,retainedGPUBytes:r.retainedGPUBytes,metadataReadBytes:r.metadataReadBytes,triangleVisits:r.triangleVisits,timings:r.timings,preview:{primitive:'triangle-list',polygonVertices:6,format:'rgba8unorm',finishLayer:r.previewLayer,reconstructions:r.reconstructions,reconstructSubmitMs:r.reconstructSubmitMs||0}};}
 status(hash){const job=this.jobs.get(hash);if(!job)return {state:'idle',result:null};if(job.result&&this.signature(hash)!==job.signature)this.invalidate(job);return {id:job.id,state:job.state,stage:job.stage,completed:job.completed,total:job.total,ms:job.ms??performance.now()-job.started,error:job.error||null,result:job.result?this.summary(job.result):null};}
 cancel(hash){const job=this.jobs.get(hash);if(job){clearTimeout(job.refreshTimer);job.refresh=false;if(job.state==='running')job.cancelled=true;}return this.status(hash);}
 attributes(hash){const s=this.status(hash),last=s.result?.lastLayer||3332;return {actions:[{id:'slice',label:'Slice',cancel:'cancel',busy:s.state==='running',progress:s.state==='running'?(s.completed?'50%':'…'):''}],ranges:{'Start layer':{min:1,max:last,scrubRange:()=>[1,last]},'Finish layer':{min:1,max:last,scrubRange:()=>[1,last]},'Layer position':{min:0,max:s.result?last:0}}};}
 async kernels(d){let p=this.pipelines.get(d);if(!p){p=(async()=>{
  const compute=async(label,code,names,entries)=>{const module=await checkedModule(d,label,code),layout=d.createBindGroupLayout({entries}),plan=d.createPipelineLayout({bindGroupLayouts:[layout]}),result={layout};await Promise.all(names.map(async entryPoint=>result[entryPoint]=await d.createComputePipelineAsync({label:label+' '+entryPoint,layout:plan,compute:{module,entryPoint}})));return result;};
  const buffer=(binding,type='storage')=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}});
  const source=texture=>compute('LDI source',sourceShader(texture),['bounds','count','emit'],[0,1].map(binding=>texture?{binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'2d-array'}}:buffer(binding,'read-only-storage')).concat([buffer(2,'uniform'),buffer(3),buffer(4,'read-only-storage'),buffer(5),buffer(6),buffer(7),buffer(8)]));
  const [native,paged,scan,clean,coverage]=await Promise.all([source(false),source(true),compute('LDI prefix',scanShader,['scan','add'],[buffer(0,'read-only-storage'),buffer(1),buffer(2),buffer(3,'uniform'),buffer(4)]),compute('LDI sort and union',cleanShader,['clean'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2,'read-only-storage'),buffer(3),buffer(4),buffer(5),buffer(6,'uniform'),buffer(7,'read-only-storage')]),compute('LDI layer reconstruction',coverageShader,['reconstruct'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),{binding:2,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:'write-only',format:'rgba8unorm'}},buffer(3,'uniform')])]);return {native,paged,scan,clean,coverage};
 })();this.pipelines.set(d,p);}return p;}
 dispatch(d,pipeline,bind,n,workgroup=128){if(!n)return;const e=d.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);const blocks=Math.ceil(n/workgroup),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();d.queue.submit([e.finish()]);}
 reconstruct(job,layer){const r=job.result;if(!r)return;layer=Math.max(1,Math.min(r.lastLayer,layer));if(r.previewLayer===layer)return;const start=performance.now(),d=this.context.device,data=new ArrayBuffer(48);new Uint32Array(data).set([r.grid.width,r.grid.depth,r.lastLayer,layer-1]);new Float32Array(data).set([...r.grid.min,...r.grid.pitch,job.options.initial,job.options.height,0,0],4);d.queue.writeBuffer(r.config,0,data);
  const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(r.coveragePipeline);p.setBindGroup(0,r.coverageGroup);p.dispatchWorkgroups(Math.ceil(r.grid.width/8),Math.ceil(r.grid.depth/8));p.end();d.queue.submit([e.finish()]);r.previewLayer=layer;r.reconstructions++;r.reconstructSubmitMs=performance.now()-start;
 }
 async run(job,snapshot){
  if(snapshot.meshes.length>256)throw failure('OWNER_LIMIT','LDI supports at most 256 evaluated solid occurrences.');
  const d=snapshot.device,owned=new Set(),options=job.options;let live=0,peak=0,metadataReadBytes=0;
  const make=(size,usage,label)=>{if(size>d.limits.maxBufferSize||(usage&GPUBufferUsage.STORAGE)&&size>d.limits.maxStorageBufferBindingSize)throw failure('LDI_MEMORY_LIMIT','LDI exceeds the bounded GPU binding.');const b=d.createBuffer({size:Math.max(16,size),usage,label});owned.add(b);live+=b.size;peak=Math.max(peak,live);return b;};
  const free=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}};
  const storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  const group=(layout,items)=>d.createBindGroup({layout,entries:items.map((resource,binding)=>({binding,resource:resource instanceof GPUBuffer?{buffer:resource}:resource}))});
  const read=async(buffer,bytes)=>{const b=make(bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'LDI small metadata readback');try{const e=d.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,bytes);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange().slice(0,bytes);b.unmap();metadataReadBytes+=bytes;this.check(job);return data;}finally{free(b);}};
  try{
   const t=performance.now(),p=await this.kernels(d);this.check(job);const timings={compileMs:performance.now()-t};
   const metrics=make(32,storage,'LDI counters'),uniform=make(112,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI source transform'),placeholders=Array.from({length:5},(_,i)=>make(16,storage,'LDI placeholder '+i));
   let grid={width:1,depth:1,min:[0,0],pitch:[1,1]},last=1,counts=placeholders[0],offsets=placeholders[1],cursors=placeholders[2],events=placeholders[3],planes=placeholders[4];
   const sourcePass=entry=>{for(const mesh of snapshot.meshes){this.check(job);if(!mesh.triangleCount)continue;const data=new ArrayBuffer(112);new Float32Array(data).set(mesh.matrix);new Uint32Array(data).set([mesh.triangleCount,grid.width,grid.depth,last],16);new Float32Array(data).set([...grid.min,...grid.pitch,options.initial,options.height,mesh.solid,0],20);d.queue.writeBuffer(uniform,0,data);const k=mesh.storage==='texture'?p.paged:p.native;this.dispatch(d,k[entry],group(k.layout,[mesh.storage==='texture'?mesh.positions.view:mesh.positions,mesh.storage==='texture'?mesh.indices.view:mesh.indices,uniform,counts,offsets,cursors,events,metrics,planes]),mesh.triangleCount);}};
   d.queue.writeBuffer(metrics,0,new Uint32Array([0xffffffff,0xffffffff,0xffffffff,0,0,0,0,0]));let started=performance.now();sourcePass('bounds');const rawBounds=new Uint32Array(await read(metrics,24));
   const unordered=v=>{const a=new Uint32Array([v&0x80000000?v^0x80000000:~v]);return new Float32Array(a.buffer)[0];},lo=Array.from(rawBounds.slice(0,3),unordered),hi=Array.from(rawBounds.slice(3),unordered);timings.boundsMs=performance.now()-started;
   if(!snapshot.meshes.length||!lo.every(Number.isFinite)||!hi.every(Number.isFinite)||hi[0]<=-500||lo[0]>=500||hi[2]<=-500||lo[2]>=500||hi[1]<layerY(0,options)){job.state='empty';return;}
   last=0;while(last<MAX_LAYERS&&layerY(last,options)<Math.min(hi[1],1000))last++;if(last===MAX_LAYERS&&layerY(last,options)<Math.min(hi[1],1000))throw failure('LAYER_LIMIT','LDI exceeds 4096 layers.');if(!last){job.state='empty';return;}
   const min=[Math.max(-500,lo[0]),Math.max(-500,lo[2])],max=[Math.min(500,hi[0]),Math.min(500,hi[2])],span=max.map((v,i)=>v-min[i]);if(span.some(v=>!(v>0))){job.state='empty';return;}
   // Sampling is explicit and bounded; no full-resolution voxel volume exists.
   const target=options.width*.2;let nx=Math.min(2048,Math.max(1,Math.ceil(span[0]/target))),nz=Math.min(2048,Math.max(1,Math.ceil(span[1]/target)));const maxColumns=Math.floor(MAX_RAYS/last);if(nx+nz>maxColumns){const factor=maxColumns/(nx+nz);nx=Math.max(1,Math.floor(nx*factor));nz=Math.max(1,Math.floor(nz*factor));}
   grid={width:nx,depth:nz,min,pitch:[span[0]/nx,span[1]/nz],targetPitch:target,resolutionLimited:span[0]/nx>target*1.001||span[1]/nz>target*1.001};const rays=(nx+nz)*last;job.stage='ldi-count';
   counts=make(rays*4,storage,'LDI raw ray counts');offsets=make(rays*4,storage,'LDI raw ray offsets');d.queue.writeBuffer(metrics,0,new Uint32Array(8));started=performance.now();sourcePass('count');
   const scan=async(input,output,n,root=true)=>{const blocks=Math.ceil(n/256),sums=make(blocks*4,storage,'LDI scan block sums'),config=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI scan config');d.queue.writeBuffer(config,0,new Uint32Array([n,root?1:0,0,0]));this.dispatch(d,p.scan.scan,group(p.scan.layout,[input,output,sums,config,metrics]),n,256);if(blocks>1){const prefix=make(blocks*4,storage,'LDI scan block offsets');await scan(sums,prefix,blocks,false);this.dispatch(d,p.scan.add,group(p.scan.layout,[prefix,output,sums,config,metrics]),n,256);free(prefix);}free(sums);free(config);};
   await scan(counts,offsets,rays);const totals=new Uint32Array(await read(metrics,16)),rawEvents=totals[0];timings.countMs=performance.now()-started;
   if(!rawEvents){job.state='empty';return;}if(rawEvents>Math.min(MAX_EVENTS,Math.floor(d.limits.maxStorageBufferBindingSize/8)))throw failure('LDI_EVENT_LIMIT','LDI depth events exceed the bounded GPU allocation.');if(totals[1]>MAX_HITS)throw failure('LDI_RAY_LIMIT','A ray exceeds 1024 depth events; split the source geometry.');
   job.stage='ldi-emit';started=performance.now();cursors=make(rays*4,storage,'LDI emit cursors');events=make(rawEvents*8,storage,'LDI raw depth and occurrence events');planes=make(rawEvents*8,storage,'LDI crossing plane slopes');sourcePass('emit');await d.queue.onSubmittedWorkDone();this.check(job);timings.emitMs=performance.now()-started;free(cursors);for(const b of placeholders)free(b);
   const headers=make(rays*8,storage,'Clean X and Z LDI ray headers'),intervalBuffer=make(Math.floor(rawEvents/2)*8,storage,'Clean X and Z union depth intervals'),cleanConfig=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI clean config');d.queue.writeBuffer(cleanConfig,0,new Uint32Array([rays,0,0,0]));d.queue.writeBuffer(metrics,0,new Uint32Array(8));job.stage='ldi-clean';started=performance.now();this.dispatch(d,p.clean.clean,group(p.clean.layout,[counts,offsets,events,headers,intervalBuffer,metrics,cleanConfig,planes]),rays*128);const cleaned=new Uint32Array(await read(metrics,16));timings.cleanMs=performance.now()-started;free(counts);free(offsets);free(events);free(planes);free(cleanConfig);
   const image=d.createTexture({label:'Finish layer LDI coverage',size:[nx,nz],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});owned.add(image);live+=nx*nz*4;peak=Math.max(peak,live);const config=make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'LDI selected layer');
   await this.preparePreview();this.check(job);const resources=[headers,intervalBuffer,image,config],params=this.context.scene.capture(job.hash,KEYS).params,firstSuccess=this.initialized.get(job.hash)!==snapshot.scene;
   const r={resources,headers,intervalBuffer,image,config,grid,lastLayer:last,rawEvents,intervals:cleaned[0],ambiguousRays:cleaned[2],duplicateEvents:cleaned[3],triangleVisits:snapshot.meshes.reduce((n,m)=>n+m.triangleCount*3,0),metadataReadBytes,peakGPUBytes:peak,retainedGPUBytes:rays*8+intervalBuffer.size+nx*nz*4+config.size,timings,reconstructions:0,previewLayer:0,coveragePipeline:p.coverage.reconstruct};r.coverageGroup=group(p.coverage.layout,[headers,intervalBuffer,image.createView(),config]);job.result=r;
   const finish=firstSuccess?last:Math.max(1,Math.min(last,Math.round(params['Finish layer'])));this.reconstruct(job,finish);await d.queue.onSubmittedWorkDone();this.check(job);
   try{this.context.update(job.hash,{'Finish layer':finish,'Start layer':Math.max(1,Math.min(last,params['Start layer']))});}catch(error){job.result=null;throw error;}
   this.initialized.set(job.hash,snapshot.scene);for(const b of resources)owned.delete(b);job.completed=2;job.state='complete';job.stage='complete';
  }finally{if(job.state!=='complete')job.result=null;for(const b of owned)b.destroy();}
 }
 async inspectCoverage(job,args){const r=job.result,d=this.context.device,total=r.grid.width*r.grid.depth,offset=args.offset||0,count=Math.min(args.count||64,total-offset);if(offset>=total)throw failure('INVALID_ARGUMENT','Pixel offset is outside the coverage map.');if(args.layer!==undefined&&args.layer!==r.previewLayer)throw failure('INVALID_ARGUMENT','Coverage inspection reads the displayed Finish layer.');
  const read=d.createBuffer({size:count*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();for(let i=0;i<count;i++){const pixel=offset+i;e.copyTextureToBuffer({texture:r.image,origin:[pixel%r.grid.width,Math.floor(pixel/r.grid.width)]},{buffer:read,offset:i*256,bytesPerRow:256},[1,1]);}d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(read.getMappedRange()),coverage=Array.from({length:count},(_,i)=>bytes[i*256+3]/255);read.unmap();this.check(job);return {index:r.previewLayer,width:r.grid.width,height:r.grid.depth,offset,coverage};}finally{read.destroy();}
 }
 async inspect(hash,args){const status=this.status(hash),job=this.jobs.get(hash);if(!job?.result)return status;this.check(job);const r=job.result;if(args.coverage)return {...status,image:await this.inspectCoverage(job,args)};const layer=args.layer??r.previewLayer;if(layer>r.lastLayer)throw failure('INVALID_ARGUMENT','Layer is outside the LDI.');
  const d=this.context.device,axis=args.axis||'X',columns=axis==='X'?r.grid.depth:r.grid.width,offset=args.offset||0,count=Math.min(args.count||64,columns-offset);if(offset>=columns)throw failure('INVALID_ARGUMENT','Ray offset is outside the LDI.');
  const ray=(axis==='X'?0:r.lastLayer*r.grid.depth)+(layer-1)*columns+offset,read=d.createBuffer({size:count*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{let e=d.createCommandEncoder();e.copyBufferToBuffer(r.headers,ray*8,read,0,count*8);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const headers=new Uint32Array(read.getMappedRange().slice(0));read.unmap();const total=Array.from({length:count},(_,i)=>(headers[i*2+1]&0x7fffffff)).reduce((a,b)=>a+b,0);if(total>4096)throw failure('INSPECTION_LIMIT','Inspect at most 4096 intervals per request.');const data=d.createBuffer({size:Math.max(16,total*8),usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{e=d.createCommandEncoder();let at=0;for(let i=0;i<count;i++){const n=(headers[i*2+1]&0x7fffffff);if(n)e.copyBufferToBuffer(r.intervalBuffer,headers[i*2]*8,data,at*8,n*8);at+=n;}d.queue.submit([e.finish()]);await data.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(data.getMappedRange()).slice(0,total*2));data.unmap();this.check(job);at=0;const rays=Array.from({length:count},(_,i)=>{const n=(headers[i*2+1]&0x7fffffff),intervals=Array.from({length:n},()=>{const a=values.slice(at,at+2);at+=2;return a;});return {column:offset+i,ambiguous:(headers[i*2+1]&0x80000000)!==0,position:r.grid.min[axis==='X'?1:0]+(offset+i+.5)*r.grid.pitch[axis==='X'?1:0],intervals};});return {...status,layer:{index:layer,y:layerY(layer-1,job.options),axis,columns,offset,rays}};}finally{data.destroy();}
  }finally{read.destroy();}
 }
 operations(){return [{id:'slice',description:'Build and clean persistent X and Z GPU LDIs for all layers.',inputSchema:emptySchema,readOnly:false,run:hash=>this.start(hash)},{id:'status',description:'Read LDI build, sampling, ambiguity, memory and coverage diagnostics.',inputSchema:emptySchema,readOnly:true,run:hash=>this.status(hash)},{id:'cancel',description:'Cancel the LDI build without partial publication.',inputSchema:emptySchema,readOnly:false,run:hash=>this.cancel(hash)},{id:'inspect',description:'Read bounded cleaned depth intervals from one LDI axis and layer.',inputSchema:{type:'object',properties:{layer:{type:'integer',minimum:1,maximum:MAX_LAYERS},axis:{type:'string',enum:['X','Z']},coverage:{type:'boolean'},offset:{type:'integer',minimum:0,maximum:4194303},count:{type:'integer',minimum:1,maximum:256}},additionalProperties:false},readOnly:true,run:(hash,args)=>this.inspect(hash,args)}];}
}

export async function activate(context){
 if(context.version!==1)throw Error('Unsupported Frame plugin API');const slicer=new LDISlicer(context);let preview=null;
 let previewPending=null;slicer.preparePreview=()=>preview?.device===context.device?Promise.resolve():previewPending??=(async()=>{const device=context.device,draw=await createPreview(context,slicer);preview={device,draw};})().finally(()=>{previewPending=null;});
 context.operations.register(slicer.operations());context.attributes.register(hash=>slicer.attributes(hash));
 const corners=[[-500,0,-500],[500,0,-500],[500,0,500],[-500,0,500],[-500,1000,-500],[500,1000,-500],[500,1000,500],[-500,1000,500]],edges=[];
 for(let i=0;i<4;i++)edges.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
 slicer.preparePreview().then(()=>context.requestDraw());
 await context.viewport.register({pivot:[-500,0,500],bounds:{min:[-500,0,-500],max:[500,1000,500]},surfaceSelection:'last-active',lines:new Float32Array(edges),color:[.45,.62,.58,.65],selectedColor:[.75,.65,.43,.65],settings:params=>[Math.sin(Math.max(0,Math.min(90,params['Overhang angle']))*Math.PI/180),0,0,0],retire:hash=>slicer.retire(hash),render:state=>{if(preview?.device!==state.device){slicer.preparePreview().then(()=>context.requestDraw());return;}preview.draw(state);},shader:`fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{
  if(local.y<=0.001||local.y>1000.||abs(local.x)>500.||abs(local.z)>500.){discard;}
  if(-dot(normal,build)<=settings.x+0.000001){discard;}return vec4f(1.,.12,.12,1.);
 }`});
}
