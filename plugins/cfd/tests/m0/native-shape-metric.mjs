import {meshReader,meshResources} from './pressure-barrier.mjs';
import {gridWGSL} from './fixtures.mjs';
import {metricBuffer,metricWGSL,nativeTriangleBounds,triangleQueryWGSL as triangleMath} from '../../plugin.js';
import {cutMetricWGSL} from './cut-metric.mjs';

const storage=(i,id,t,w=false)=>`@group(0) @binding(${i}) var<storage,${w?'read_write':'read'}> ${id}:array<${t}>;`;
const types=`struct Bounds{lo:vec4f,hi:vec4f} struct Hit{weights:vec4f,vertices:vec4u}
  struct Pose{m:mat4x4f,triangles:u32,base:u32,leaves:u32}
  const NONE=0xffffffffu;`;
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
  const pipelines=new Map(),occurrences=[];let base=0;
  for(const mesh of capture.meshes){
    occurrences.push({hash:mesh.hash,offset:base,count:mesh.vertexCount});
    if(!Number.isInteger(mesh.vertexCount)||mesh.vertexCount<0)throw Error('Missing native shape vertex count');
    if(!mesh.triangleCount){base+=mesh.vertexCount;continue;}
    const tree=await nativeTriangleBounds(gpu,mesh,base),{boxes,pose}=tree;base+=mesh.vertexCount;
    if(!pipelines.has(mesh.storage)){
      const source=meshReader(mesh.storage)+types+'fn physical(m:mat4x4f,k:u32)->vec3f{return (m*vec4f(sourcePoint(k),1)).xyz;}';
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
      pipelines.set(mesh.storage,query);
    }
    const query=pipelines.get(mesh.storage);
    const bind=(pipe,extra,coord)=>device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[
      ...[...meshResources(mesh),...extra.map(buffer=>({buffer}))].map((resource,binding)=>({binding,resource})),
      ...coord?[{binding:12,resource:{buffer:coord}}]:[]]});
    capture.assertCurrent();const e=device.createCommandEncoder();
    gpu.dispatch(e,query,bind(query,[boxes,hits,normals,pose],axes),groups);device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
    capture.assertCurrent();tree.release();
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
