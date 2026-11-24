import {rotorDistanceWGSL,rotorTable,rotorTriangles} from './rotor.mjs';
import {pressureBarriers} from './pressure-barrier.mjs';

// Reference values are consulted by the scorer only. Both candidates sample
// the same moving surface in metres and use the same fluid and physical time.
export const references = {
  sphere:{metric:'CD',value:1.087,wakeDiameters:0.88,source:'https://doi.org/10.1006/jcph.2001.6778',wakeSource:'https://doi.org/10.1017/S0022112098003206',
    condition:'Unconfined sphere, Re_D = 100; wake length from the rear pole'},
  ahmed:{metric:'CD',value:0.285,source:'https://doi.org/10.4271/840300',
    condition:'Ahmed 25 degrees, Re_L = 4.29e6, body-only axial force'},
  'ahmed-wake':{metric:'wake/H',wakeM:.6*.288,source:'https://math.univ-cotedazur.fr/u/rpas/publis/physfluids08.pdf',
    condition:'Ahmed 25 degrees, Re_H = 768000; time-mean symmetry-plane recirculation extent, Fig. 10'},
  propeller:{metric:'CT',value:0.1071,powerCoefficient:0.0529,source:'https://m-selig.ae.illinois.edu/props/volume-1/data/apce_10x7_static_pg0811.txt',geometrySource:'https://www.apcprop.com/propeller-technical-data-files/10x7E-PERF.PE0',measuredPlanform:'https://m-selig.ae.illinois.edu/props/volume-1/data/apce_10x7_geom.txt',
    condition:'APC Thin Electric 10x7, 5011 rpm, J = 0 (UIUC Volume 1)'}
};
export function flowFixture(name,tier){
  const id=name;if(name==='ahmed-wake')name='ahmed';
  const rotor=name==='propeller',sphere=name==='sphere',h=(rotor?0.008:sphere?0.01:0.032)/tier;
  const dims=(rotor?[80,72,72]:sphere?[88,56,56]:[144,40,64]).map(v=>Math.round(v*tier));
  const diameter=0.254, rps=5011/60, omega=rotor?2*Math.PI*rps:0;
  const rho=1.2,U=rotor?0:sphere?1:id==='ahmed-wake'?40:60,maxSpeed=rotor?omega*diameter/2:U;
  return {id,name,h,dims,rotor,sphere,rho,U,maxSpeed,omega,nu:rotor?1.5e-5:sphere?U*0.08/100:id==='ahmed-wake'?U*.288/768000:U*1.044/4.29e6,
    origin:rotor?[-0.32,-0.288,-0.288]:sphere?[-0.32,-0.28,-0.28]:[-0.96,0,-1.024],
    period:rotor?1/rps:(sphere?0.08:1.044)/U,
    normalization:rotor?rho*rps**2*diameter**4:0.5*rho*U**2*(sphere?Math.PI*0.04**2:0.389*0.288),
    powerNormalization:rotor?rho*rps**3*diameter**5:null,
    geometry:rotor?'APC 10x7E design stations, leading-edge sweep and rake, thickness-scaled E63/APC12 sections, hub and shaft dimensions':
      sphere?'Sphere of diameter 80 mm':'Full-scale rounded forebody, 222 mm slant, 50 mm clearance, fixed floor; support tare omitted'};
}

export function surfaceBand(f){
  const h=f.h/2,min=f.sphere?[-.04,-.04,-.04]:[0,.05,-.1945],max=f.sphere?[.04,.04,.04]:[1.044,.338,.1945];
  const lo=min.map((v,k)=>Math.max(0,Math.floor((v-f.origin[k])/h)-10));
  const hi=max.map((v,k)=>Math.min(2*f.dims[k],Math.ceil((v-f.origin[k])/h)+10));
  return {...f,h,origin:lo.map((v,k)=>f.origin[k]+v*h),dims:hi.map((v,k)=>v-lo[k]),domain:{origin:f.origin,dims:f.dims,h:f.h}};
}

const floats=a=>a.map(v=>Number(v).toFixed(8)).join(',');

export function gridWGSL(f){
  const [x,y,z]=f.dims;
  return `const NX=${x}u;const NY=${y}u;const NZ=${z}u;const CELLS=${x*y*z}u;
    const DIMS=vec3i(${x},${y},${z});
    fn point(i:u32)->vec3i{return vec3i(vec3u(i%NX,(i/NX)%NY,i/(NX*NY)));}
    fn index(p:vec3i)->u32{return u32(p.x)+NX*(u32(p.y)+NY*u32(p.z));}
    fn inside(p:vec3i)->bool{return all(p>=vec3i(0))&&all(p<DIMS);}
    fn bounded(p:vec3i)->u32{return index(clamp(p,vec3i(0),DIMS-1));}`;
}

export async function geometryKernel(gpu,f,dt,withPressure=false){
  const body=f.rotor?rotorDistanceWGSL:f.sphere?`fn distanceToBody(p:vec3f,phase:vec2f)->f32{return length(p)-0.04;}`:`
    fn nose(x:f32,v:f32,span:f32)->f32{
      let q=vec2f(0.1-x,abs(v)-span+0.1);
      return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.)-0.1;
    }
    fn distanceToBody(p:vec3f,phase:vec2f)->f32{
      let a=radians(25.);let roof=p.y-0.338;
      let slant=(p.x-(1.044-0.222*cos(a)))*sin(a)+roof*cos(a);
      return max(max(nose(p.x,p.y-0.194,0.144),nose(p.x,p.z,0.1945)),max(p.x-1.044,slant));
    }`;
  const code=gridWGSL(f)+body+`
    @group(0) @binding(0) var<uniform> phase:vec2f;
    @group(0) @binding(1) var<storage,read_write> wall:array<vec4f>;
    ${withPressure?`@group(0) @binding(2) var<storage,read_write> response:array<vec4f>;
      fn mobility(p:vec3f)->f32{
        let s=distanceToBody(p,phase);
        let x=clamp(s*${2/f.h},-1.,1.);
        let mu=0.5*(1.+x+sin(3.14159265*x)/3.14159265);
        if(mu<0.00001){return 0.;}return min(1.,mu);
      }`:''}
    ${withPressure&&f.rotor?'@group(0) @binding(4) var<storage,read> cuts:array<u32>;':''}
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}
      let p=vec3f(${floats(f.origin)})+(vec3f(point(i))+0.5)*${f.h};
      let sdf=distanceToBody(p,phase);let w=1.-smoothstep(-0.7*${f.h},0.7*${f.h},sdf);
      wall[i]=vec4f(sdf/${f.h},-p.z*${f.omega*dt/f.h},p.y*${f.omega*dt/f.h},w);
      ${withPressure?`let h=${f.h/2};var faces=vec3f(mobility(p+vec3f(h,0.,0.)),mobility(p+vec3f(0.,h,0.)),mobility(p+vec3f(0.,0.,h)));
        ${f.rotor?'let flags=cuts[i];faces=select(faces,vec3f(0),(vec3u(flags)&vec3u(1u,2u,4u))!=vec3u(0));':''}
        response[i]=vec4f(faces,mobility(p));`:''}
    }`;
  const pipe=await gpu.kernel('CFD benchmark immersed geometry',code);
  const phase=gpu.buffer('CFD rotor phase',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const wall=gpu.buffer('CFD distances and wall velocities',f.dims.reduce((a,b)=>a*b)*16);
  const groups=[Math.ceil(f.dims.reduce((a,b)=>a*b)/128)];
  const response=withPressure?gpu.buffer('CFD immersed face and cell pressure mobility',wall.size):null;
  const entries=[[0,phase],[1,wall]];
  if(response)entries.push([2,response]);
  if(f.rotor)entries.push([3,gpu.buffer('CFD APC section coordinates',rotorTable())]);
  const barriers=withPressure&&f.rotor?await pressureBarriers(gpu,f,rotorTriangles(),phase):null;
  if(barriers)entries.push([4,barriers.mask]);
  const binding=gpu.device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:entries.map(([binding,buffer])=>({binding,resource:{buffer}}))});
  return {wall,response,update(step){
    const a=f.rotatingFrame?0:f.omega*dt*(step+0.5);
    gpu.device.queue.writeBuffer(phase,0,new Float32Array([Math.cos(a),Math.sin(a)]));
    const e=gpu.device.createCommandEncoder();barriers?.encode(e);gpu.dispatch(e,pipe,binding,groups);gpu.device.queue.submit([e.finish()]);
  }};
}
