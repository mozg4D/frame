// Reference values are consulted by the scorer only. Both candidates sample
// the same moving surface in metres and use the same fluid and physical time.
export const references = {
  sphere:{metric:'CD',value:1.087,wakeDiameters:0.88,source:'https://doi.org/10.1006/jcph.2001.6778',wakeSource:'https://doi.org/10.1017/S0022112098003206',
    condition:'Unconfined sphere, Re_D = 100; wake length from the rear pole'},
  ahmed:{metric:'CD',value:0.285,source:'https://doi.org/10.4271/840300',
    condition:'Ahmed 25 degrees, Re_L = 4.29e6, body-only axial force'},
  'ahmed-wake':{metric:'wake/H',wakeM:.6*.288,source:'https://math.univ-cotedazur.fr/u/rpas/publis/physfluids08.pdf',
    condition:'Ahmed 25 degrees, Re_H = 768000; time-mean symmetry-plane recirculation extent, Fig. 10'},
  propeller:{metric:'CT',value:0.1071,source:'https://m-selig.ae.illinois.edu/props/volume-1/data/apce_10x7_static_pg0811.txt',geometrySource:'https://m-selig.ae.illinois.edu/props/volume-1/data/apce_10x7_geom.txt',
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
    geometry:rotor?'UIUC measured radial chord/twist, interpolated sections with NACA four-digit camber and approximate hub':
      sphere?'Sphere of diameter 80 mm':'Full-scale rounded forebody, 222 mm slant, 50 mm clearance, fixed floor; support tare omitted'};
}

export function surfaceBand(f){
  const h=f.h/2,min=f.sphere?[-.04,-.04,-.04]:[0,.05,-.1945],max=f.sphere?[.04,.04,.04]:[1.044,.338,.1945];
  const lo=min.map((v,k)=>Math.max(0,Math.floor((v-f.origin[k])/h)-10));
  const hi=max.map((v,k)=>Math.min(2*f.dims[k],Math.ceil((v-f.origin[k])/h)+10));
  return {...f,h,origin:lo.map((v,k)=>f.origin[k]+v*h),dims:hi.map((v,k)=>v-lo[k]),domain:{origin:f.origin,dims:f.dims,h:f.h}};
}

// UIUC Volume 1, apce_10x7_geom.txt. The measured planform does not specify
// all section ordinates. The section reconstruction remains an approximation.
const chord=[.138,.154,.175,.190,.198,.202,.200,.195,.186,.174,.161,.145,.129,.112,.096,.081,.061,.040];
const twist=[37.86,45.82,44.19,38.35,33.64,29.90,27.02,24.67,22.62,20.88,19.36,17.98,16.74,15.79,14.64,13.86,12.72,11.53];
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

export async function geometryKernel(gpu,f,dt){
  const body=f.rotor?`
    const C=array<f32,18>(${floats(chord)});const B=array<f32,18>(${floats(twist)});
    fn distanceToBody(p:vec3f,phase:vec2f)->f32{
      let radial=dot(p.yz,phase);let side=select(-1.,1.,radial>=0.);
      let tangent=side*dot(p.yz,vec2f(-phase.y,phase.x));
      let radius=abs(radial);let s=clamp((radius/0.127-0.15)/0.05,0.,17.);
      let j=min(u32(s),16u);let a=s-f32(j);
      let chord=0.127*mix(C[j],C[j+1u],a);let beta=radians(mix(B[j],B[j+1u],a));
      let cs=cos(beta);let sn=sin(beta);let t=(0.5*chord-tangent*cs-p.x*sn)/chord;
      let v=clamp(t,0.,1.);let tt=clamp(0.22-0.13*radius/0.127,0.085,0.2);
      let half=5.*tt*chord*(0.2969*sqrt(v)-0.126*v-0.3516*v*v+0.2843*v*v*v-0.1036*v*v*v*v);
      let camber=select((0.2+0.8*v-v*v)/0.36,(0.8*v-v*v)/0.16,v<0.4)*0.04*chord;
      let blade=max(max(max(-t,t-1.)*chord,abs(p.x*cs-tangent*sn-camber)-half),radius-0.127);
      let hub=max(length(p.yz)-0.01016,abs(p.x)-0.005);
      return min(hub,blade);
    }`:f.sphere?`fn distanceToBody(p:vec3f,phase:vec2f)->f32{return length(p)-0.04;}`:`
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
    @compute @workgroup_size(128) fn main(@builtin(global_invocation_id) g:vec3u){
      let i=g.x;if(i>=CELLS){return;}
      let p=vec3f(${floats(f.origin)})+(vec3f(point(i))+0.5)*${f.h};
      let sdf=distanceToBody(p,phase);let w=1.-smoothstep(-0.7*${f.h},0.7*${f.h},sdf);
      wall[i]=vec4f(sdf/${f.h},-p.z*${f.omega*dt/f.h},p.y*${f.omega*dt/f.h},w);
    }`;
  const pipe=await gpu.kernel('CFD benchmark immersed geometry',code);
  const phase=gpu.buffer('CFD rotor phase',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const wall=gpu.buffer('CFD distances and wall velocities',f.dims.reduce((a,b)=>a*b)*16);
  return {wall,update(step){
    const a=f.omega*dt*(step+0.5);
    gpu.device.queue.writeBuffer(phase,0,new Float32Array([Math.cos(a),Math.sin(a)]));
    gpu.run(pipe,[phase,wall],[Math.ceil(f.dims.reduce((a,b)=>a*b)/128)]);
  }};
}
