import {meshReader,meshResources} from './pressure-barrier.mjs';
import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL} from './rectilinear.mjs';
import {cutMetricWGSL} from './cut-metric.mjs';

const storage=(i,id,t,w=false)=>`@group(0) @binding(${i}) var<storage,${w?'read_write':'read'}> ${id}:array<${t}>;`;
const types=`struct Bounds{lo:vec4f,hi:vec4f} struct Hit{weights:vec4f,vertices:vec4u}
  struct Pose{m:mat4x4f,triangles:u32,base:u32,leaves:u32}
  const NONE=0xffffffffu;`;
const triangleMath=`
  fn edgeWeights(p:vec3f,a:vec3f,b:vec3f,ai:vec3f,bi:vec3f)->vec3f{
    let d=b-a;return mix(ai,bi,clamp(dot(p-a,d)/max(dot(d,d),1e-30),0.,1.));}
  fn closestWeights(p:vec3f,a:vec3f,b:vec3f,c:vec3f,n:vec3f,nn:f32)->vec3f{
    let e0=vec3f(1,0,0);let e1=vec3f(0,1,0);let e2=vec3f(0,0,1);
    let v=dot(cross(p-a,c-a),n)/nn;let w=dot(cross(b-a,p-a),n)/nn;
    if(v>=0.&&w>=0.&&v+w<=1.){return vec3f(1.-v-w,v,w);}
    let m=mat3x3f(a,b,c);var g=edgeWeights(p,a,b,e0,e1);let k=edgeWeights(p,b,c,e1,e2);
    if(dot(m*k-p,m*k-p)<dot(m*g-p,m*g-p)){g=k;}let l=edgeWeights(p,c,a,e2,e0);
    return select(g,l,dot(m*l-p,m*l-p)<dot(m*g-p,m*g-p));
  }
  fn wedge(a:vec2f,b:vec2f)->f32{return a.x*b.y-a.y*b.x;}
  fn topLeft(d:vec2f)->bool{return d.y>0.||(d.y==0.&&d.x<0.);}
  // Half-open ownership on a shared projected edge. Reversing a triangle
  // first restores the same counter-clockwise edge convention.
  fn rayCrosses(p:vec3f,a:vec3f,b:vec3f,c:vec3f)->bool{
    var b0=b;var c0=c;let orient=wedge(b.yz-a.yz,c.yz-a.yz);if(orient==0.){return false;}
    if(orient<0.){b0=c;c0=b;}
    let e0=b0.yz-a.yz;let e1=c0.yz-b0.yz;let e2=a.yz-c0.yz;
    let u=wedge(e1,p.yz-b0.yz);let v=wedge(e2,p.yz-c0.yz);let w=wedge(e0,p.yz-a.yz);
    if(u<0.||v<0.||w<0.||(u==0.&&!topLeft(e1))||(v==0.&&!topLeft(e2))||(w==0.&&!topLeft(e0))){return false;}
    return u*(a.x-p.x)+v*(b0.x-p.x)+w*(c0.x-p.x)>0.;
  }`;

// An exact, winding-independent narrow-band metric for differentiable resolved
// cuts. The three vertices of its nearest physical point carry its derivative.
// Bounds retain indices into Frame's own mesh, including paged occurrences.
export async function nativeShapeMetric(gpu,f,capture){
  const device=gpu.device,count=f.dims.reduce((a,b)=>a*b),dims=f.dims.map(n=>n+1),n=dims.reduce((a,b)=>a*b);
  const limit=Math.min(device.limits.maxStorageBufferBindingSize,device.limits.maxBufferSize);
  if(32*n>limit||Math.ceil(n/128)>device.limits.maxComputeWorkgroupsPerDimension)
    throw Error('Resolved shape grid exceeds the device binding or dispatch limit');
  const hits=gpu.buffer('CFD nearest exposed shape coordinates',32*n),normals=gpu.buffer('CFD physical signed-metric gradients',16*n);
  const distances=gpu.buffer('CFD signed corner distances in metres',4*n);
  const mobility=gpu.buffer('CFD resolved native shape apertures',16*count),axes=metricBuffer(gpu,f);
  const layout=gridWGSL(f)+metricWGSL(f)+`const VD=vec3i(${dims.join(',')});
    fn vertexIndex(p:vec3i)->u32{return u32(p.x+VD.x*(p.y+VD.y*p.z));}`;
  const init=await gpu.kernel('CFD initialise closest shape locations',types+storage(0,'normal','vec4f',true)+storage(1,'hit','Hit',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      if(g.x<arrayLength(&normal)){normal[g.x].w=3.4e38;hit[g.x].vertices=vec4u(NONE);}}`);
  const groups=[Math.ceil(n/128)];capture.assertCurrent();gpu.run(init,[normals,hits],groups);
  const join=await gpu.kernel('CFD join bounds of native triangle ranges',types+storage(0,'box','Bounds',true)+
    '@group(0) @binding(1) var<uniform> range:vec2u;'+`
    @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){if(id.x>=range.y){return;}
      let i=range.x+id.x;let a=box[2u*i];let b=box[2u*i+1u];box[i]=Bounds(min(a.lo,b.lo),max(a.hi,b.hi));}`);
  const pipelines=new Map(),occurrences=[];let base=0;
  for(const mesh of capture.meshes){
    occurrences.push({hash:mesh.hash,offset:base,count:mesh.vertexCount});
    if(!Number.isInteger(mesh.vertexCount)||mesh.vertexCount<0)throw Error('Missing native shape vertex count');
    if(!mesh.triangleCount){base+=mesh.vertexCount;continue;}
    const leaves=2**Math.ceil(Math.log2(Math.ceil(mesh.triangleCount/8)));
    if(64*leaves>limit||Math.ceil(leaves/64)>device.limits.maxComputeWorkgroupsPerDimension)
      throw Error('Native shape search bounds exceed the device limit');
    const boxes=gpu.buffer('CFD native shape search bounds',64*leaves);
    const uniform=new ArrayBuffer(80);new Float32Array(uniform,0,16).set(mesh.matrix);
    new Uint32Array(uniform,64,3).set([mesh.triangleCount,base,leaves]);base+=mesh.vertexCount;
    const pose=gpu.buffer('CFD native shape pose',new Uint8Array(uniform),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    if(!pipelines.has(mesh.storage)){
      const source=meshReader(mesh.storage)+types+'fn physical(m:mat4x4f,k:u32)->vec3f{return (m*vec4f(sourcePoint(k),1)).xyz;}';
      const bounds=await gpu.kernel('CFD bound native triangles for shape derivatives',source+
        storage(2,'box','Bounds',true)+'@group(0) @binding(3) var<uniform> pose:Pose;'+`
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
          if(id.x>=pose.leaves){return;}var lo=vec3f(3.4e38);var hi=-lo;
          for(var k=8u*id.x;k<min(pose.triangles,8u*id.x+8u);k++){for(var j=0u;j<3u;j++){
            let v=physical(pose.m,3u*k+j);lo=min(lo,v);hi=max(hi,v);}}
          box[pose.leaves+id.x]=Bounds(vec4f(lo,0.),vec4f(hi,0.));
        }`);
      const query=await gpu.kernel('CFD exact signed distance and barycentric shape derivative',source+layout+
        triangleMath+storage(2,'box','Bounds')+storage(3,'hit','Hit',true)+storage(4,'normal','vec4f',true)+'@group(0) @binding(5) var<uniform> pose:Pose;'+`
        @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
          let i=id.x;if(i>=arrayLength(&hit)){return;}let k=i32(i);
          let v=vec3i(k%VD.x,(k/VD.x)%VD.y,k/(VD.x*VD.y));let cell=min(v,DIMS-1);
          let w=cellWidths(cell);let x=vec3f(${f.origin.join(',')})+${f.h}*(cellCenters(cell)+select(-.5*w,.5*w,v==DIMS));
          let band=2.*${f.h}*length(max(w,cellWidths(max(v-1,vec3i(0)))));
          var best=band*band;var triangle=NONE;var bary=vec3f(0);var delta=vec3f(0);var parity=0u;var node=1u;
          loop{let bounds=box[node];let lo=bounds.lo.xyz;let hi=bounds.hi.xyz;let gap=max(max(lo-x,x-hi),vec3f(0));
            let near=dot(gap,gap)<=best;let ray=hi.x>x.x&&all(x.yz>=lo.yz)&&all(x.yz<=hi.yz);
            if(all(lo<=hi)&&(near||ray)){
              if(node<pose.leaves){node*=2u;continue;}
              let first=8u*(node-pose.leaves);for(var t=first;t<min(pose.triangles,first+8u);t++){
                let a=physical(pose.m,3u*t);let b=physical(pose.m,3u*t+1u);let c=physical(pose.m,3u*t+2u);
                if(ray&&rayCrosses(x,a,b,c)){parity^=1u;}
                if(near){let normal=cross(b-a,c-a);let nn=dot(normal,normal);if(nn<=1e-36){continue;}
                  let weights=closestWeights(x,a,b,c,normal,nn);let r=(x-a)-weights.y*(b-a)-weights.z*(c-a);let d=dot(r,r);
                  if(d<best||(d==best&&t<triangle)){best=d;triangle=t;bary=weights;delta=r;}
                }
              }
            }while((node&1u)!=0u){node>>=1u;}if(node==0u){break;}node++;
          }
          let sign=select(1.,-1.,parity!=0u);let s=sign*sqrt(best);
          if(s<normal[i].w){var result:Hit;var gradient=vec3f(0);result.vertices=vec4u(NONE);
            if(triangle!=NONE&&best>0.){gradient=sign*delta*inverseSqrt(best);result.weights=vec4f(bary,0.);
              result.vertices=vec4u(pose.base+vertex(3u*triangle),pose.base+vertex(3u*triangle+1u),pose.base+vertex(3u*triangle+2u),triangle);}
            hit[i]=result;normal[i]=vec4f(gradient,s);}
        }`);
      pipelines.set(mesh.storage,{bounds,query});
    }
    const {bounds,query}=pipelines.get(mesh.storage);
    const bind=(pipe,extra,coord)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
      ...[...meshResources(mesh),...extra.map(buffer=>({buffer}))].map((resource,binding)=>({binding,resource})),
      ...coord?[{binding:12,resource:{buffer:coord}}]:[]]});
    capture.assertCurrent();const e=device.createCommandEncoder();
    gpu.dispatch(e,bounds,bind(bounds,[boxes,pose]),[Math.ceil(leaves/64)]);
    const parameters=[];
    for(let width=leaves/2;width>=1;width/=2){const range=gpu.buffer('CFD native shape search level',new Uint32Array([width,width,0,0]),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      parameters.push(range);gpu.dispatch(e,join,gpu.bind(join,[boxes,range]),[Math.ceil(width/64)]);}
    gpu.dispatch(e,query,bind(query,[boxes,hits,normals,pose],axes),groups);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
    capture.assertCurrent();for(const b of [boxes,pose,...parameters])b.destroy();
  }
  const extract=await gpu.kernel('CFD differentiable signed metric',storage(0,'normal','vec4f')+storage(1,'s','f32',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){if(g.x<arrayLength(&s)){s[g.x]=normal[g.x].w;}}`);
  const cut=await gpu.kernel('CFD cut apertures from resolved shape distances',gridWGSL(f)+`const VD=vec3i(${dims.join(',')});`+
    cutMetricWGSL+storage(0,'s','f32')+storage(1,'mu','vec4f',true)+`
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=CELLS){return;}
      let p=point(i);var q:array<f32,8>;for(var k=0u;k<8u;k++){
        let t=p+vec3i(vec3u(k&1u,(k>>1u)&1u,k>>2u));q[k]=s[t.x+VD.x*(t.y+VD.y*t.z)];}mu[i]=cutMetric(q);}`);
  capture.assertCurrent();gpu.run(extract,[normals,distances],groups);gpu.run(cut,[distances,mobility],[Math.ceil(count/128)]);
  if(12*base>limit)throw Error('Native shape vertex derivatives exceed the device binding limit');
  const vectors=gpu.buffer('CFD force shape derivatives on native logical vertices',12*Math.max(1,base));
  const scatter=await gpu.kernel('CFD distribute signed-distance adjoint onto native vertices',types+
    storage(0,'hit','Hit')+storage(1,'gradient','f32')+storage(2,'out','atomic<u32>',true)+storage(3,'normal','vec4f')+`
    fn add(i:u32,x:f32){var bits=atomicLoad(&out[i]);loop{let next=bitcast<u32>(bitcast<f32>(bits)+x);
      let result=atomicCompareExchangeWeak(&out[i],bits,next);if(result.exchanged){break;}bits=result.old_value;}}
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u){
      let i=id.x;if(i>=arrayLength(&hit)||gradient[i]==0.){return;}let h=hit[i];if(h.vertices.x==NONE){return;}
      let delta=-gradient[i]*normal[i].xyz;for(var j=0u;j<3u;j++){for(var a=0u;a<3u;a++){add(3u*h.vertices[j]+a,h.weights[j]*delta[a]);}}
    }`);
  return {distances,mobility,vectors,occurrences,project(e,cornerGradient){capture.assertCurrent();
    e.clearBuffer(vectors);gpu.dispatch(e,scatter,gpu.bind(scatter,[hits,cornerGradient,vectors,normals]),groups);}};
}
