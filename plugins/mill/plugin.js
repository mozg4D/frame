// Mill owns authoring semantics and derived GPU solids; no Printer runtime dependency.
const BOX={min:[-50,-50,-100],max:[50,50,0]},KEYS=['Tolerance'];
const LIMITS={layers:4096,rays:4194304,events:16777216,hits:1024,occurrences:256},LAYER_BATCH=64;
const defaults={Tool:'Flat',Diameter:6,Angle:90,'Step Down':3,'Step Over':2,'Ramp Angle':3,Feed:1000,Plunge:250,Spindle:12000,'Safe Dist':2,Tolerance:.25,'Start G-code':'G21\nG90\nG17\nG94','Tool Change G-code':'M5\nM0',Progress:0};
const emptySchema={type:'object',properties:{},additionalProperties:false};
const error=(code,message)=>Object.assign(Error(message),{code});
const sourceLanes=count=>Math.min(256,2**Math.ceil(Math.log2(Math.max(1,4096/Math.max(1,count)))));
const checkedModule=async(d,label,code)=>{const module=d.createShaderModule({label,code}),info=await module.getCompilationInfo(),errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw error('GPU_SHADER',errors.map(m=>m.lineNum+': '+m.message).join('; '));return module;};

const sourceShader=texture=>`
struct Config{matrix:mat4x4f,size:vec4u,domain:vec4f,heights:vec4f,shell:vec4u,extra:vec4u};
@group(0) @binding(0) var ${texture?'positions:texture_2d_array<u32>':'<storage,read> positions:array<f32>'};
@group(0) @binding(1) var ${texture?'indices:texture_2d_array<u32>':'<storage,read> indices:array<u32>'};
@group(0) @binding(2) var<uniform> cfg:Config;
@group(0) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read> offsets:array<u32>;
@group(0) @binding(5) var<storage,read_write> cursors:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> events:array<vec2u>;
@group(0) @binding(7) var<storage,read_write> metrics:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> planes:array<atomic<u32>>;
${texture?`fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
fn index(i:u32)->u32{return scalar(indices,i);}fn value(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`:`fn index(i:u32)->u32{return indices[i];}fn value(i:u32)->f32{return positions[i];}`}
fn point(i:u32)->vec3f{let k=index(i)*3u;return (cfg.matrix*vec4f(value(k),value(k+1u),value(k+2u),1)).xyz;}
fn ordered(x:f32)->u32{let b=bitcast<u32>(x);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
fn invocation(id:vec3u,groups:vec3u)->u32{return id.x+id.y*groups.x*128u;}
@compute @workgroup_size(128) fn bounds(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let t=invocation(gid,groups);if(t>=cfg.size.x){return;}for(var k=0u;k<3u;k++){let p=point(t*3u+k);for(var a=0u;a<3u;a++){atomicMin(&metrics[a],ordered(p[a]));atomicMax(&metrics[3u+a],ordered(p[a]));}}}
fn cross(a:vec2f,b:vec2f)->f32{let x=a.x*b.y;let y=a.y*b.x;let d=x-y;if(abs(d)>(abs(x)+abs(y))*2.3841858e-7){return d;}return d+(fma(a.x,b.y,-x)-fma(a.y,b.x,-y));}
fn project(p:vec3f,axis:u32)->vec3f{return select(p.zyx,p.xyz,axis!=0u);}
fn yAt(i:u32)->f32{return cfg.heights.x+(f32(i)+.5)*cfg.heights.y;}
fn before(a:vec3f,b:vec3f)->bool{return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&a.z<b.z)));}
fn root(vertex:u32)->u32{var v=vertex;loop{let p=atomicLoad(&planes[v]);if(p==v){return v;}let q=atomicLoad(&planes[p]);atomicMin(&planes[v],q);v=q;}}
@compute @workgroup_size(128) fn shellInit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i<cfg.shell.x){atomicStore(&planes[cfg.shell.y+i],cfg.shell.y+i);}}
@compute @workgroup_size(128) fn shellJoin(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i>=cfg.size.x){return;}let a=index(i*3u)+cfg.shell.y;for(var k=1u;k<3u;k++){let b=index(i*3u+k)+cfg.shell.y;loop{let x=root(a);let y=root(b);if(x==y){break;}let hi=max(x,y);let lo=min(x,y);if(atomicMin(&planes[hi],lo)==hi){break;}}}}
@compute @workgroup_size(128) fn shellCompress(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){let i=invocation(id,groups);if(i<cfg.shell.x){let v=cfg.shell.y+i;atomicStore(&planes[v],root(v));}}
fn raster(A:vec3f,B:vec3f,C:vec3f,axis:u32,emit:bool,vertex:u32,lane:u32,lanes:u32){
 let originalA=project(A,axis);let originalB=project(B,axis);let originalC=project(C,axis);let direction=u32(cross(originalB.xy-originalA.xy,originalC.xy-originalA.xy)>0.);
 // Canonical ordering makes duplicate/reversed triangles bit-identical.
 var a=project(A,axis);var b=project(B,axis);var c=project(C,axis);
 if(before(b,a)){let v=a;a=b;b=v;}if(before(c,b)){let v=b;b=c;c=v;}if(before(b,a)){let v=a;a=b;b=v;}
 var area=cross(b.xy-a.xy,c.xy-a.xy);if(area==0.){return;}if(area<0.){let swap=b;b=c;c=swap;area=-area;}
 let columns=select(cfg.size.z,cfg.size.y,axis!=0u);let low=select(cfg.domain.y,cfg.domain.x,axis!=0u);let pitch=select(cfg.domain.w,cfg.domain.z,axis!=0u);
 let first=u32(clamp(floor((min(a.x,min(b.x,c.x))-low)/pitch-.5)-1.,0.,f32(columns)));
 let end=u32(clamp(ceil((max(a.x,max(b.x,c.x))-low)/pitch-.5)+2.,0.,f32(columns)));
 let minY=min(a.y,min(b.y,c.y));let maxY=max(a.y,max(b.y,c.y));
 var firstLayer=u32(clamp(floor((minY-cfg.heights.x)/cfg.heights.y-.5)-1.,0.,f32(cfg.size.w)));
 // Bound serial work per lane even for a full-height coarse triangle.
 firstLayer=max(firstLayer,cfg.shell.w);let layerEnd=min(cfg.size.w,cfg.shell.w+${LAYER_BATCH}u);if(firstLayer>=layerEnd||first+lane>=end){return;}
 let ab=b-a;let ac=c-a;let slopes=bitcast<vec2u>(vec2f(ab.z*ac.y-ab.y*ac.z,ab.x*ac.z-ab.z*ac.x)/area);var component=0u;if(emit){component=atomicLoad(&planes[cfg.shell.y+vertex]);}
 for(var layer=firstLayer;layer<layerEnd;layer++){let y=yAt(layer);if(y>maxY){break;}if(y<minY){continue;}
  // Interpolate shared edges in the same direction. Half-open section
  // endpoints prevent skinny triangles and shared vertices losing a crossing.
  let vertices=array<vec3f,3>(a,b,c);var cuts:array<vec3f,2>;var n=0u;
  for(var edge=0u;edge<3u;edge++){var v=vertices[edge];var w=vertices[(edge+1u)%3u];if(v.y>w.y){let swap=v;v=w;w=swap;}
   if(v.y<=y&&y<w.y){let f=(y-v.y)/(w.y-v.y);cuts[n]=vec3f(fma(f,w.x-v.x,v.x),y,fma(f,w.z-v.z,v.z));n++;}
  }
  if(n!=2u){continue;}var v=cuts[0];var w=cuts[1];if(v.x>w.x){let swap=v;v=w;w=swap;}if(v.x==w.x){continue;}
  for(var col=first+lane;col<end;col+=lanes){let x=low+(f32(col)+.5)*pitch;if(x<v.x||x>=w.x){continue;}
   let depth=fma((x-v.x)/(w.x-v.x),w.z-v.z,v.z);let ray=cfg.extra.y+select(layer*cfg.size.z+col,select(cfg.size.w*cfg.size.z,0u,cfg.extra.x==2u)+layer*cfg.size.y+col,axis!=0u);
   if(emit){let at=offsets[ray]+atomicAdd(&cursors[ray],1u);events[at]=vec2u(bitcast<u32>(depth),u32(cfg.heights.z));let base=cfg.shell.z+at*4u;atomicStore(&planes[base],slopes.x);atomicStore(&planes[base+1u],slopes.y);atomicStore(&planes[base+2u],component);atomicStore(&planes[base+3u],direction);}
   else{atomicAdd(&counts[ray],1u);atomicAdd(&metrics[0],1u);}
  }
 }
}
@compute @workgroup_size(128) fn count(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let slot=invocation(gid,groups);let lanes=u32(cfg.heights.w);let t=slot/lanes;let lane=slot%lanes;if(t<cfg.size.x){let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);if((cfg.extra.x&1u)!=0u){raster(a,b,c,0u,false,0u,lane,lanes);}if((cfg.extra.x&2u)!=0u){raster(a,b,c,1u,false,0u,lane,lanes);}}}
@compute @workgroup_size(128) fn emit(@builtin(global_invocation_id) gid:vec3u,@builtin(num_workgroups) groups:vec3u){let slot=invocation(gid,groups);let lanes=u32(cfg.heights.w);let t=slot/lanes;let lane=slot%lanes;if(t<cfg.size.x){let a=point(t*3u);let b=point(t*3u+1u);let c=point(t*3u+2u);if((cfg.extra.x&1u)!=0u){raster(a,b,c,0u,true,index(t*3u),lane,lanes);}if((cfg.extra.x&2u)!=0u){raster(a,b,c,1u,true,index(t*3u),lane,lanes);}}}
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
struct Config{size:vec4u,low:vec4f,high:vec4f};
@group(0) @binding(0) var<storage,read> counts:array<u32>;
@group(0) @binding(1) var<storage,read> offsets:array<u32>;
@group(0) @binding(2) var<storage,read> events:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> headers:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> intervals:array<vec2f>;
@group(0) @binding(5) var<storage,read_write> metrics:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> cfg:Config;
@group(0) @binding(7) var<storage,read_write> planes:array<atomic<u32>>;
var<workgroup> hits:array<vec4u,1024>;
fn slope(e:vec4u)->vec2u{let at=cfg.size.y+e.w*4u;return vec2u(atomicLoad(&planes[at]),atomicLoad(&planes[at+1u]));}
fn direction(e:vec4u)->i32{return select(-1,1,atomicLoad(&planes[cfg.size.y+e.w*4u+3u])!=0u);}
fn less(a:vec4u,b:vec4u,shells:bool)->bool{
 if(shells){if(a.y!=b.y){return a.y<b.y;}if(a.z!=b.z){return a.z<b.z;}}
 let x=bitcast<f32>(a.x);let y=bitcast<f32>(b.x);if(x!=y){return x<y;}if(a.y!=b.y){return a.y<b.y;}
 if(!shells){return false;}let pa=slope(a);let pb=slope(b);if(pa.x!=pb.x){return pa.x<pb.x;}return pa.y<pb.y;
}
fn cluster(shell:u32)->u32{var v=shell;loop{let p=atomicLoad(&planes[v]);if(p==v){return v;}v=p;}}
fn join(a:u32,b:u32){loop{let x=cluster(a);let y=cluster(b);if(x==y){return;}let hi=max(x,y);if(atomicMin(&planes[hi],min(x,y))==hi){return;}}}
fn groupLess(a:vec4u,b:vec4u)->bool{if(a.y!=b.y){return a.y<b.y;}if(a.z!=b.z){return a.z<b.z;}return bitcast<f32>(a.x)<bitcast<f32>(b.x);}
fn duplicate(a:vec4u,b:vec4u)->bool{return all(a.xyz==b.xyz)&&all(slope(a)==slope(b));}
@compute @workgroup_size(128) fn clean(@builtin(workgroup_id) gid:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(num_workgroups) groups:vec3u){
 let ray=gid.x+gid.y*groups.x;if(ray>=cfg.size.x){return;}let count=counts[ray];let offset=offsets[ray];
 if(lane==0u){var length=1u;while(length<count){length*=2u;}hits[0].x=length;}workgroupBarrier();let n=workgroupUniformLoad(&hits[0]).x;
 let sentinel=vec4u(0x7f7fffffu,0xffffffffu,0xffffffffu,0u);
 for(var i=lane;i<n;i+=128u){var v=sentinel;if(i<count){let at=cfg.size.y+(offset+i)*4u;v=vec4u(events[offset+i],atomicLoad(&planes[at+2u]),offset+i);}hits[i]=v;}workgroupBarrier();
 // Resolve nonzero winding inside each connected shell, independent of its
 // global orientation. Unbalanced authored winding falls back to parity.
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&less(hits[j],hits[i],true)==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane==0u){var i=0u;var output=0u;var ambiguous=false;
  while(i<count){let begin=i;let owner=hits[i].y;let shell=hits[i].z;var balance=0;var unique=0u;
   while(i<count&&hits[i].y==owner&&hits[i].z==shell){let e=hits[i];balance+=direction(e);unique++;i++;while(i<count&&duplicate(hits[i],e)){atomicAdd(&metrics[3],1u);i++;}}
   let end=i;ambiguous=ambiguous||(unique%2u!=0u);var winding=0;var parity=false;var j=begin;
   while(j<end){let e=hits[j];let before=select(parity,winding!=0,balance==0);winding+=direction(e);parity=!parity;j++;while(j<end&&duplicate(hits[j],e)){j++;}let after=select(parity,winding!=0,balance==0);if(before!=after){hits[output]=vec4u(e.xyz,u32(after));output++;}}
  }
  for(var j=output;j<n;j++){hits[j]=sentinel;}hits[0].w=output|(u32(ambiguous)<<11u);
 }workgroupBarrier();let info=workgroupUniformLoad(&hits[0]).w;let kept=info&2047u;let ambiguous=info>>11u;if(lane==0u){hits[0].w=1u;}workgroupBarrier();
 // A separate all-ray pass joins only interpenetrating connected shells.
 // Strict nesting retains parity; an overlap found on either axis/layer is
 // shared by every ray through the same canonical GPU union/find labels.
 if(cfg.size.z!=0u){for(var i=lane*2u;i+1u<kept;i+=256u){let a=hits[i];let ae=hits[i+1u];if(a.y!=ae.y||a.z!=ae.z||a.w==0u||ae.w!=0u){continue;}let lo=bitcast<f32>(a.x);let hi=bitcast<f32>(ae.x);for(var j=i+2u;j+1u<kept;j+=2u){let b=hits[j];let be=hits[j+1u];if(a.y!=b.y||a.z==b.z||b.y!=be.y||b.z!=be.z||b.w==0u||be.w!=0u){continue;}let low=bitcast<f32>(b.x);let high=bitcast<f32>(be.x);if((lo<low&&low<hi&&hi<high)||(low<lo&&lo<high&&high<hi)){join(a.z,b.z);}}}return;}
 for(var i=lane;i<kept;i+=128u){hits[i].z=cluster(hits[i].z);}workgroupBarrier();
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&groupLess(hits[j],hits[i])==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane==0u){var i=0u;var output=0u;while(i<kept){let owner=hits[i].y;let shell=hits[i].z;var occupancy=0;while(i<kept&&hits[i].y==owner&&hits[i].z==shell){let e=hits[i];let before=occupancy;occupancy+=select(-1,1,e.w!=0u);i++;if((before==0)!=(occupancy==0)){hits[output]=e;output++;}}}for(var j=output;j<n;j++){hits[j]=sentinel;}hits[0].z=output;}
 workgroupBarrier();let grouped=workgroupUniformLoad(&hits[0]).z;
 // Distinct nested clusters alternate cavities/islands within one occurrence.
 for(var size=2u;size<=n;size*=2u){var step=size/2u;while(step>0u){for(var i=lane;i<n;i+=128u){let j=i^step;if(j>i&&less(hits[j],hits[i],false)==((i&size)==0u)){let v=hits[i];hits[i]=hits[j];hits[j]=v;}}workgroupBarrier();step/=2u;}}
 if(lane!=0u){return;}var owners:array<u32,8>;var filled=0;var i=0u;var start=0.;var written=0u;let base=offset/2u;
 while(i<grouped){let depth=bitcast<f32>(hits[i].x);let before=filled;
  loop{let owner=hits[i].y;let word=owner/32u;let mask=1u<<(owner%32u);filled+=select(1,-1,(owners[word]&mask)!=0u);owners[word]^=mask;i++;if(i>=grouped||bitcast<f32>(hits[i].x)!=depth){break;}}
  if(before==0&&filled>0){start=depth;}if(before>0&&filled==0){let axis=select(select(2u,1u,ray<u32(cfg.low.w)),0u,ray<cfg.size.w);let a=max(start,cfg.low[axis]);let b=min(depth,cfg.high[axis]);if(b>a){intervals[base+written]=vec2f(a,b);written++;}}
 }
 if(filled!=0||ambiguous!=0u){atomicAdd(&metrics[2],1u);}headers[ray]=vec2u(base,written|select(0u,0x80000000u,filled!=0||ambiguous!=0u));atomicAdd(&metrics[0],written);
}
`;



class SolidBuilder{
 constructor(context,check){this.context=context;this.check=check;this.cache=new WeakMap();}
 async kernels(d){let pending=this.cache.get(d);if(!pending){pending=(async()=>{const compute=async(label,code,names,entries)=>{const module=await checkedModule(d,label,code),layout=d.createBindGroupLayout({entries}),plan=d.createPipelineLayout({bindGroupLayouts:[layout]}),out={layout};await Promise.all(names.map(async entryPoint=>out[entryPoint]=await d.createComputePipelineAsync({label:label+' '+entryPoint,layout:plan,compute:{module,entryPoint}})));return out;},buffer=(binding,type='storage')=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}}),sourceEntries=texture=>[texture?{binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'2d-array'}}:buffer(0,'read-only-storage'),texture?{binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'uint',viewDimension:'2d-array'}}:buffer(1,'read-only-storage'),buffer(2,'uniform'),buffer(3),buffer(4,'read-only-storage'),buffer(5),buffer(6),buffer(7),buffer(8)];
   const [native,paged,scan,clean]=await Promise.all([false,true].map(texture=>compute('Mill triangle depth '+texture,sourceShader(texture),['bounds','count','emit','shellInit','shellJoin','shellCompress'],sourceEntries(texture))).concat([compute('Mill interval allocation',scanShader,['scan','add'],[buffer(0,'read-only-storage'),buffer(1),buffer(2),buffer(3,'uniform'),buffer(4)]),compute('Mill solid cleanup',cleanShader,['clean'],[buffer(0,'read-only-storage'),buffer(1,'read-only-storage'),buffer(2,'read-only-storage'),buffer(3),buffer(4),buffer(5),buffer(6,'uniform'),buffer(7)])]));return {native,paged,scan,clean};})();this.cache.set(d,pending);pending.catch(()=>this.cache.delete(d));}return pending;}
 dispatch(d,pipeline,bind,n,lanes=128){if(!n)return;const blocks=Math.ceil(n/lanes),x=Math.min(blocks,d.limits.maxComputeWorkgroupsPerDimension),e=d.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(x,Math.ceil(blocks/x));pass.end();d.queue.submit([e.finish()]);}
 async build(job,snapshot,meshes,frame,role){
  const d=snapshot.device,owned=new Set(),storage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;let live=0,peak=0,readBytes=0;
  const make=(bytes,usage,label)=>{const size=Math.max(16,Math.ceil(bytes/4)*4);if(size>d.limits.maxBufferSize||(usage&GPUBufferUsage.STORAGE)&&size>d.limits.maxStorageBufferBindingSize)throw error('GPU_CAPACITY','Requested Mill solid exceeds a GPU binding limit.');const b=d.createBuffer({size,usage,label:'Mill '+label});owned.add(b);live+=size;peak=Math.max(peak,live);return b;},free=b=>{if(owned.delete(b)){live-=b.size;b.destroy();}},group=(layout,items)=>d.createBindGroup({layout,entries:items.map((resource,binding)=>({binding,resource:resource instanceof GPUBuffer?{buffer:resource}:resource}))});
  const read=async(buffer,bytes)=>{const b=make(bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'metadata');try{const e=d.createCommandEncoder();e.copyBufferToBuffer(buffer,0,b,0,bytes);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);const data=b.getMappedRange().slice(0,bytes);b.unmap();readBytes+=bytes;this.check(job);return data;}finally{free(b);}};
  try{
   if(meshes.length>LIMITS.occurrences)throw error('OCCURRENCE_LIMIT','Mill supports at most 256 solid occurrences per role and operation.');
   const started=performance.now(),p=await this.kernels(d);this.check(job);const metrics=make(32,storage,'counters'),uniform=make(144,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'source transform'),placeholders=Array.from({length:5},(_,i)=>make(16,storage,'placeholder '+i)),shellOffsets=new Map();let shellWords=0;for(const mesh of meshes){shellOffsets.set(mesh,shellWords);shellWords+=mesh.vertexCount;}
   let counts=placeholders[0],offsets=placeholders[1],cursors=placeholders[2],events=placeholders[3],planes=placeholders[4];
   let grid={width:1,depth:1,layers:1,min:[0,0],pitch:[1,1],base:0,step:1,mask:3,clip:[-1e30,1e30,-1e30,1e30]},vertical=false;
   const sourcePass=entry=>{for(let owner=0;owner<meshes.length;owner++){const mesh=meshes[owner];this.check(job);if(!mesh.triangleCount)continue;const tiled=entry==='count'||entry==='emit',lanes=tiled?sourceLanes(mesh.triangleCount):1,matrix=mesh.matrix.slice();for(let col=0;col<4;col++)for(let row=0;row<3;row++)matrix[col*4+row]*=frame.scale[row];if(!vertical)for(let col=0;col<4;col++)[matrix[col*4+1],matrix[col*4+2]]=[matrix[col*4+2],matrix[col*4+1]];
    for(let layer=0;layer<(tiled?grid.layers:1);layer+=LAYER_BATCH){const data=new ArrayBuffer(144);new Float32Array(data).set(matrix);new Uint32Array(data).set([mesh.triangleCount,grid.width,grid.depth,grid.layers],16);new Float32Array(data).set([...grid.min,...grid.pitch,grid.base,grid.step,owner,lanes],20);new Uint32Array(data).set([mesh.vertexCount,shellOffsets.get(mesh),shellWords,layer,grid.mask,grid.axisBase||0,0,0],28);d.queue.writeBuffer(uniform,0,data);const k=mesh.storage==='texture'?p.paged:p.native;this.dispatch(d,k[entry],group(k.layout,[mesh.storage==='texture'?mesh.positions.view:mesh.positions,mesh.storage==='texture'?mesh.indices.view:mesh.indices,uniform,counts,offsets,cursors,events,metrics,planes]),entry==='shellInit'||entry==='shellCompress'?mesh.vertexCount:mesh.triangleCount*lanes);}}};
   d.queue.writeBuffer(metrics,0,new Uint32Array([0xffffffff,0xffffffff,0xffffffff,0,0,0,0,0]));sourcePass('bounds');const bits=new Uint32Array(await read(metrics,24)),unordered=v=>new Float32Array(new Uint32Array([v&0x80000000?v^0x80000000:~v]).buffer)[0],rawLo=Array.from(bits.slice(0,3),unordered),rawHi=Array.from(bits.slice(3,6),unordered),lo=[rawLo[0],rawLo[2],rawLo[1]],hi=[rawHi[0],rawHi[2],rawHi[1]],clipMin=BOX.min.map((v,i)=>v*frame.scale[i]),clipMax=BOX.max.map((v,i)=>v*frame.scale[i]);
   if(!meshes.length||!lo.every(Number.isFinite)||lo.some((v,i)=>hi[i]<=v||v>=clipMax[i]||hi[i]<=clipMin[i]))return {role,empty:true,axes:['X','Y','Z'],grid:null,resources:[],metadataReadBytes:readBytes,peakGPUBytes:peak,ms:performance.now()-started};
   const min=lo.map((v,i)=>Math.max(clipMin[i],v)),max=hi.map((v,i)=>Math.min(clipMax[i],v)),pitch=snapshot.params.Tolerance,dimensions=max.map((v,i)=>Math.max(1,Math.ceil((v-min[i])/pitch))),step=max.map((v,i)=>(v-min[i])/dimensions[i]),[nx,ny,nz]=dimensions,rays=ny*nz+nx*nz+nx*ny;
   if(dimensions.some(v=>v>2048)||rays>LIMITS.rays)throw error('RESOLUTION_LIMIT','Requested Tolerance exceeds the supported dexel grid; accuracy was not reduced.');
   const xEnd=ny*nz,yEnd=xEnd+nx*nz;
   const sourceAll=entry=>{for(let direction=0;direction<2;direction++){vertical=direction===1;grid=vertical?{width:nx,depth:1,layers:ny,min:[min[0],min[2]],pitch:[step[0],step[2]],base:min[1],step:step[1],mask:2,axisBase:yEnd}:{width:nx,depth:ny,layers:nz,min:[min[0],min[1]],pitch:[step[0],step[1]],base:min[2],step:step[2],mask:3,axisBase:0};sourcePass(entry);}};
   counts=make(rays*4,storage,'ray counts');offsets=make(rays*4,storage,'ray offsets');d.queue.writeBuffer(metrics,0,new Uint32Array(8));job.stage=role+'-count';sourceAll('count');
   const scan=async(input,output,n,root=true)=>{const blocks=Math.ceil(n/256),sums=make(blocks*4,storage,'scan sums'),config=make(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'scan config');d.queue.writeBuffer(config,0,new Uint32Array([n,root?1:0,0,0]));this.dispatch(d,p.scan.scan,group(p.scan.layout,[input,output,sums,config,metrics]),n,256);if(blocks>1){const prefix=make(blocks*4,storage,'scan prefixes');await scan(sums,prefix,blocks,false);this.dispatch(d,p.scan.add,group(p.scan.layout,[prefix,output,sums,config,metrics]),n,256);free(prefix);}free(config);free(sums);};
   await scan(counts,offsets,rays);const totals=new Uint32Array(await read(metrics,16)),rawEvents=totals[0];if(rawEvents>LIMITS.events||totals[1]>LIMITS.hits)throw error('EVENT_LIMIT','Mill depth events exceed the supported ray/event capacity.');
   cursors=make(rays*4,storage,'write cursors');events=make(rawEvents*8,storage,'depth events');planes=make((shellWords+rawEvents*4)*4,storage,'shared XYZ shell and crossing labels');sourcePass('shellInit');sourcePass('shellJoin');sourcePass('shellCompress');job.stage=role+'-emit';sourceAll('emit');await d.queue.onSubmittedWorkDone();this.check(job);
   const headers=make(rays*8,storage,'clean XYZ interval headers'),intervals=make(Math.floor(rawEvents/2)*8,storage,'clean XYZ intervals'),config=make(48,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST,'cleanup config'),data=new ArrayBuffer(48);new Uint32Array(data).set([rays,shellWords,1,xEnd]);new Float32Array(data).set([...clipMin,yEnd,...clipMax,0],4);d.queue.writeBuffer(config,0,data);const bind=group(p.clean.layout,[counts,offsets,events,headers,intervals,metrics,config,planes]);job.stage=role+'-clean';this.dispatch(d,p.clean.clean,bind,rays*128);d.queue.writeBuffer(config,8,new Uint32Array([0]));d.queue.writeBuffer(metrics,0,new Uint32Array(8));this.dispatch(d,p.clean.clean,bind,rays*128);const cleaned=new Uint32Array(await read(metrics,16));
   const axisResults=[{headers,intervals,axisOffset:xEnd},{headers,intervals,axisOffset:yEnd}],resources=[headers,intervals];for(const b of resources)owned.delete(b);return {role,empty:false,axes:['X','Y','Z'],grid:{min,max,dimensions,pitch:step,requestedPitch:pitch,resolutionLimited:false},axisResults,resources,rawEvents,intervals:cleaned[0],ambiguousRays:cleaned[2],duplicateEvents:cleaned[3],metadataReadBytes:readBytes,peakGPUBytes:peak,retainedGPUBytes:resources.reduce((n,b)=>n+b.size,0),ms:performance.now()-started};
  }finally{for(const b of owned)b.destroy();}
 }
 async inspect(job,result,args){
  if(result.empty)return {role:result.role,axis:args.axis||'Z',rays:[]};this.check(job);const d=this.context.device,axis=args.axis||'Z',axisIndex=['X','Y','Z'].indexOf(axis),g=result.grid,[nx,ny,nz]=g.dimensions,entry=result.axisResults[axis==='Z'?1:0],total=axis==='X'?ny*nz:axis==='Y'?nx*nz:nx*ny,offset=args.offset||0,count=Math.min(args.count||32,total-offset);if(offset>=total)throw error('INVALID_ARGUMENT','Ray offset is outside the solid.');const base=axis==='X'?0:entry.axisOffset,read=d.createBuffer({size:count*8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
  try{let e=d.createCommandEncoder();e.copyBufferToBuffer(entry.headers,(base+offset)*8,read,0,count*8);d.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const headers=new Uint32Array(read.getMappedRange().slice(0));read.unmap();const words=Array.from({length:count},(_,i)=>headers[i*2+1]&0x7fffffff),n=words.reduce((a,b)=>a+b,0);if(n>4096)throw error('INSPECTION_LIMIT','Inspect at most 4096 intervals per call.');const values=d.createBuffer({size:Math.max(16,n*8),usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{e=d.createCommandEncoder();let cursor=0;for(let i=0;i<count;i++){if(words[i])e.copyBufferToBuffer(entry.intervals,headers[i*2]*8,values,cursor*8,words[i]*8);cursor+=words[i];}d.queue.submit([e.finish()]);await values.mapAsync(GPUMapMode.READ);const raw=Array.from(new Float32Array(values.getMappedRange()).slice(0,n*2));values.unmap();this.check(job);cursor=0;const columns=axis==='X'?ny:nx,plane=axis==='X'?[1,2]:axis==='Y'?[0,2]:[0,1];return {role:result.role,axis,offset,total,rays:words.map((length,i)=>({id:offset+i,position:plane.map((a,k)=>g.min[a]+(((k?Math.floor((offset+i)/columns):(offset+i)%columns))+.5)*g.pitch[a]),ambiguous:!!(headers[i*2+1]&0x80000000),intervals:Array.from({length},()=>{const pair=raw.slice(cursor,cursor+2);cursor+=2;return pair;})}))};}finally{values.destroy();}}finally{read.destroy();}
 }
}

export async function activate(context){
 if(context.version!==1)throw Error('Unsupported Frame plugin API');
 const D=context.document,M=context.math,jobs=new Map(),failures=new Map(),defaultsKey='frame.mill.defaults.v1';let serial=0;
 const byId=id=>D.nodes.find(n=>n.id===id),find=hash=>D.nodes.find(n=>n.nativeHash===hash),cncs=()=>D.nodes.filter(n=>n.type==='cnc'),parentCNC=n=>{for(let p=byId(n.parent);p;p=byId(p.parent))if(p.type==='cnc')return p;return null;},rootOf=n=>{let p;while(p=parentCNC(n))n=p;return n;};
 const hierarchy=root=>{const out=[],visit=n=>{if(n.type==='cnc')out.push(n);for(const child of D.nodes.filter(q=>q.parent===n.id))visit(child);};visit(root);return out;};
 let roleCache=null,roleStamp=null;
 const roles=hash=>{if(!roleCache){const byHash=new Map(D.nodes.map(n=>[n.nativeHash,n])),byNode=new Map(D.nodes.map(n=>[n.id,n])),resolved=new Map(),resolve=n=>{if(!n)return {stock:false,protected:false};if(resolved.has(n.id))return resolved.get(n.id);const parent=resolve(byNode.get(n.parent)),value={stock:parent.stock||n.tags.some(t=>t.kind==='stock'),protected:parent.protected||n.tags.some(t=>t.kind==='protected')};resolved.set(n.id,value);return value;};roleCache=new Map([...byHash].map(([h,n])=>[h,resolve(n)]));}return roleCache.get(hash)||{stock:false,protected:false};};
 const frame=hash=>{const world=D.world(hash),axes=[0,4,8].map(i=>world.slice(i,i+3)),scale=axes.map(v=>Math.hypot(...v)),basis=axes.map((v,i)=>v.map(x=>x/scale[i])),valid=scale.every(v=>Number.isFinite(v)&&v>1e-8)&&[0,1,2].every(i=>[0,1,2].every(j=>i===j||Math.abs(M.dot(basis[i],basis[j]))<1e-6))&&M.determinant(world)>0;return {world,scale,basis,valid,code:valid?null:'INVALID_FRAME'};};
 const settingsSchema={Tool:{type:'string',enum:['Flat','Ball','V']},Diameter:{type:'number',exclusiveMinimum:0},Angle:{type:'number',exclusiveMinimum:0,exclusiveMaximum:180},'Step Down':{type:'number',exclusiveMinimum:0},'Step Over':{type:'number',exclusiveMinimum:0},'Ramp Angle':{type:'number',minimum:0,maximum:90},Feed:{type:'number',exclusiveMinimum:0},Plunge:{type:'number',exclusiveMinimum:0},Spindle:{type:'number'},'Safe Dist':{type:'number',minimum:0},Tolerance:{type:'number',minimum:.0001,maximum:100},'Start G-code':{type:'string',maxLength:65536},'Tool Change G-code':{type:'string',maxLength:65536}};
 const validate=(n,changes)=>{const p={...n.params,...changes};for(const [key,schema]of Object.entries(settingsSchema)){const v=p[key];if(schema.enum?!schema.enum.includes(v):schema.type==='string'?typeof v!=='string'||v.length>schema.maxLength:typeof v!=='number'||!Number.isFinite(v)||schema.exclusiveMinimum!==undefined&&v<=schema.exclusiveMinimum||schema.exclusiveMaximum!==undefined&&v>=schema.exclusiveMaximum||schema.minimum!==undefined&&v<schema.minimum||schema.maximum!==undefined&&v>schema.maximum)throw error('INVALID_ARGUMENT','Invalid CNC attribute: '+key);}if(p.Progress!==0)throw error('NOT_IMPLEMENTED','Virtual milling Progress is not implemented yet.');return {};};
 let localDefaults={};try{const saved=JSON.parse(localStorage.getItem(defaultsKey)||'{}'),candidate={...defaults,...Object.fromEntries(Object.entries(saved).filter(([k])=>Object.hasOwn(settingsSchema,k)))};validate({params:candidate},{});localDefaults=candidate;}catch{}
 const persist=n=>{localDefaults=Object.fromEntries(Object.keys(settingsSchema).map(k=>[k,n.params[k]]));try{localStorage.setItem(defaultsKey,JSON.stringify(localDefaults));}catch{}};
 const signature=hash=>{const root=find(hash);if(root?.type!=='cnc')return null;return JSON.stringify([context.scene.signature(hash,KEYS),D.nodes.map(n=>[n.nativeHash,n.parent,n.type==='cnc'?n.params:null,n.enabled,n.tags.filter(t=>t.kind==='stock'||t.kind==='protected').map(t=>t.kind)]),hierarchy(root).map(n=>[n.nativeHash,frame(n.nativeHash).scale.map(v=>Math.round(v*1e9)/1e9),Array.from(M.mul(M.inv(D.world(hash)),D.world(n.nativeHash)),v=>Math.round(v*1e9)/1e9)])]);};
 const release=job=>{for(const op of job?.operations||[])for(const solid of op.solids||[])for(const b of solid.resources)b.destroy();if(job)job.operations=[];};
 const check=job=>{if(job.cancelled)throw error('CANCELLED','Mill job cancelled.');if(job.device!==context.device||job.signature!==signature(job.hash))throw error('STALE_JOB','CNC geometry, roles, hierarchy or attributes changed.');};
 const builder=new SolidBuilder(context,check);
 const publicFrame=n=>{const f=frame(n.nativeHash),root=rootOf(n),rf=frame(root.nativeHash),parallel=f.valid&&rf.valid&&M.dot(f.basis[2],rf.basis[2])>1-1e-6;let invalid=null;try{validate(n,{})}catch(e){invalid=e.code||'INVALID_ARGUMENT';}return {valid:f.valid&&parallel&&!invalid,code:!f.valid?'INVALID_FRAME':!parallel?'INCOMPATIBLE_AXIS':invalid,scale:f.scale,axis:f.basis[2],root:root.nativeHash};};
 const describe=n=>{const f=publicFrame(n);return {hash:n.nativeHash,enabled:n.enabled!==false,valid:f.valid,ignored:n.enabled===false||!f.valid,reason:f.code,frame:f,protectedScope:'scene-tags',params:{...n.params}};};
 const summary=solid=>{const {resources,axisResults,...rest}=solid;return rest;};
 const status=hash=>{const n=find(hash);if(n?.type!=='cnc')throw error('INVALID_ARGUMENT','Unknown CNC object.');const root=rootOf(n),job=jobs.get(root.nativeHash);if(job&&job.state==='geometry-ready'&&job.signature!==signature(job.hash)){release(job);job.state='stale';}return {stage:'geometry-foundation',machiningReady:false,cnc:describe(n),root:root.nativeHash,order:hierarchy(root).map(describe),id:job?.id||null,state:job?.state||'idle',step:0,maxStep:0,estimatedSeconds:null,error:job?.error||null,operations:job?.operations?.map(op=>({hash:op.hash,solids:op.solids.map(summary)}))||[],ms:job?job.ms??performance.now()-job.started:0};};
 const run=async(job,root)=>{for(const n of hierarchy(root)){check(job);const description=describe(n);if(description.ignored)continue;validate(n,{});const snapshot=context.scene.capture(n.nativeHash,KEYS),op={hash:n.nativeHash,solids:[]};job.operations.push(op);const lists={stock:[],target:[],protected:[]};for(const mesh of snapshot.meshes){const r=roles(mesh.hash);if(r.stock)lists.stock.push(mesh);if(r.protected)lists.protected.push(mesh);if(!r.stock&&!r.protected)lists.target.push(mesh);}for(const role of ['stock','target','protected']){check(job);job.stage=role;op.solids.push(await builder.build(job,snapshot,lists[role],frame(n.nativeHash),role));}}check(job);job.state='geometry-ready';};
 const start=hash=>{const n=find(hash),root=rootOf(n);if(root!==n)throw error('ROOT_ONLY','Slice belongs to the root CNC.');if(!publicFrame(root).valid)return status(hash);const previous=jobs.get(hash);if(previous?.state==='running')throw error('BUSY','This CNC job is already running.');release(previous);const job={id:++serial,hash,signature:signature(hash),device:context.device,state:'running',stage:'capture',started:performance.now(),operations:[],cancelled:false};jobs.set(hash,job);failures.delete(hash);run(job,root).catch(e=>{release(job);job.state=e.code==='CANCELLED'?'cancelled':e.code==='STALE_JOB'?'stale':'failed';job.error={code:e.code||'MILL_FAILED',message:e.message};if(job.state==='failed')failures.set(hash,job.error);}).finally(()=>{job.ms=performance.now()-job.started;context.requestAttributes();context.requestDraw();});context.requestAttributes();return status(hash);};
 context.editor.register({documentChanged:()=>{const stamp=JSON.stringify(D.nodes.map(n=>[n.nativeHash,n.parent,n.tags.filter(t=>t.kind==='stock'||t.kind==='protected').map(t=>t.kind)]));if(stamp!==roleStamp){roleStamp=stamp;roleCache=null;context.requestDraw();}},created:n=>{roleCache=null;if(n.type==='cnc')Object.assign(n.params,localDefaults);},parameters:(n,changes)=>{if(n.type!=='cnc')return null;validate(n,changes);if(n.nativeHash&&Object.keys(changes).some(k=>Object.hasOwn(settingsSchema,k)))persist({params:{...n.params,...changes}});return {};},forbidAnimation:(n,path)=>n.type==='cnc'&&path==='param:Progress',rowColor:n=>n.type==='cnc'?publicFrame(n).valid&&!failures.has(rootOf(n).nativeHash)?'#92aaa4':'#ee554b':null,surfaceStyle:hash=>{const r=roles(hash);return r.protected?{color:[1,.12,.08,.35],topmost:true}:r.stock?{color:[.68,.72,.64,.3],topmost:false}:null;}});
 context.attributes.register(hash=>{const n=find(hash),root=rootOf(n),s=status(hash),hidden=['Angle',...n!==root?['Start G-code','Tool Change G-code','Progress']:[]].filter(k=>k!=='Angle'||n.params.Tool!=='V');return {hiddenFields:hidden,actions:n===root?[{id:'slice',label:'Slice',cancel:'cancel',busy:s.state==='running',disabled:!s.cnc.valid,progress:'--:--:--'}]:[],units:{Diameter:'mm','Step Down':'mm','Step Over':'mm','Ramp Angle':'°',Feed:'mm/min',Plunge:'mm/min',Spindle:'RPM','Safe Dist':'mm',Tolerance:'mm',Angle:'°'},ranges:{Diameter:{min:.0001},Angle:{min:.01,max:179.99},'Step Down':{min:.0001},'Step Over':{min:.0001},'Ramp Angle':{min:0,max:90},Feed:{min:.0001},Plunge:{min:.0001},Spindle:{min:-1000000,max:1000000},'Safe Dist':{min:0},Tolerance:{min:.0001,max:100},Progress:{min:0,max:0,step:1}}};});
 const op=(id,description,properties,readOnly,run,required=[])=>({id,description,inputSchema:{type:'object',properties,additionalProperties:false,...required.length?{required}:{}},readOnly,run});
 context.operations.register([
  op('settings','Set validated physical CNC attributes through native Undo.',settingsSchema,false,(hash,args)=>{validate(find(hash),args);context.update(hash,args);persist(find(hash));failures.delete(rootOf(find(hash)).nativeHash);return status(hash);}),
  op('status','Read CNC eligibility, preorder and bounded GPU geometry job diagnostics.',{},true,hash=>status(hash)),
  op('slice','Build three-axis GPU solid snapshots. Toolpath planning and G-code are not implemented in this stage.',{},false,hash=>start(hash)),
  op('cancel','Cancel the owned GPU build without partial publication.',{},false,hash=>{const job=jobs.get(rootOf(find(hash)).nativeHash);if(job?.state==='running')job.cancelled=true;return status(hash);}),
  op('inspect','Read bounded GPU dexel intervals for one operation and role.',{operation:{type:'string'},role:{type:'string',enum:['stock','target','protected']},axis:{type:'string',enum:['X','Y','Z']},offset:{type:'integer',minimum:0,maximum:LIMITS.rays-1},count:{type:'integer',minimum:1,maximum:256}},true,async(hash,args)=>{const s=status(hash),job=jobs.get(s.root);if(job?.state!=='geometry-ready')return s;check(job);const selected=job.operations.find(op=>op.hash===(args.operation||hash));if(!selected)throw error('INVALID_ARGUMENT','Choose an enabled valid operation in this job.');return {state:job.state,operation:selected.hash,...await builder.inspect(job,selected.solids.find(s=>s.role===(args.role||'stock')),args)};})
 ]);
 const corners=[[-50,-50,-100],[50,-50,-100],[50,50,-100],[-50,50,-100],[-50,-50,0],[50,-50,0],[50,50,0],[-50,50,0]],lines=[];for(let i=0;i<4;i++)lines.push(...corners[i],...corners[(i+1)%4],...corners[i+4],...corners[(i+1)%4+4],...corners[i],...corners[i+4]);
 await context.viewport.register({pivot:[-50,-50,0],bounds:BOX,lines:new Float32Array(lines),enabledAffectsVisibility:false,color:[.45,.62,.58,.65],selectedColor:[.75,.65,.43,.8],colorFor:(hash,params,selected)=>publicFrame(find(hash)).valid&&!failures.has(rootOf(find(hash)).nativeHash)?selected?[.75,.65,.43,.8]:[.45,.62,.58,.65]:[1,.12,.08,1],settings:()=>[0,0,0,0],shader:'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f{discard;return vec4f(0);}',retire:hash=>{const job=jobs.get(hash);if(job){job.cancelled=true;release(job);jobs.delete(hash);}failures.delete(hash);}});
 window.addEventListener('frame-engine-scene',()=>{for(const job of jobs.values()){job.cancelled=true;release(job);}jobs.clear();failures.clear();});
}
