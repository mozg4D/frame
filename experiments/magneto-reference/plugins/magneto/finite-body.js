/** Independent prescribed-uniform-M cuboid oracle; SI, CPU only. See finite-body.md. */
export const MU0 = 4 * Math.PI * 1e-7; // Conventional reference value, consistent with direct-kernel.js.
export const FINITE_BODY_CAPABILITIES = Object.freeze({maxBodies:32,maxTargets:512,maxAspectRatio:16,maxTargetMinHalfSizes:64,surfaceCollar:1e-10,maxCoordinateMinHalfSizes:1e6,rigidRotations:true,exactFaceIntegrals:true,nativeIntegration:false});
const C = 1 / (4 * Math.PI);
const fail = message => { throw new RangeError(message); };
function record(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label} must be a plain record`);
  if (Reflect.ownKeys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value,k))) throw new TypeError(`${label}: unknown or missing field`);
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !Object.hasOwn(d,'value'))) throw new TypeError(`${label}: accessors unsupported`);
}
function array(value, max, label) {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length+1 || Array.from({length:value.length},(_,i)=>i).some(i=>!Object.hasOwn(value,i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value,i),'value'))) throw new TypeError(`${label}: dense array required, capacity ${max}`);
  return value;
}
function vector(value, size, label) {
  array(value,size,label);
  if (value.length !== size || value.some(v=>typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v)>1e100)) throw new TypeError(`${label}: ${size} finite numeric components, magnitude <=1e100 required`);
  return value.slice();
}
function rotation(q) {
  const [x,y,z,w] = vector(q,4,'rotation');
  if (Math.abs(Math.hypot(x,y,z,w)-1)>1e-12) fail('rotation must be unit XYZW quaternion');
  // Normalize once within the accepted rounding tolerance; matrix columns are local axes.
  const n=Math.hypot(x,y,z,w), a=x/n,b=y/n,c=z/n,d=w/n;
  return [[1-2*(b*b+c*c),2*(a*b-c*d),2*(a*c+b*d)],[2*(a*b+c*d),1-2*(a*a+c*c),2*(b*c-a*d)],[2*(a*c-b*d),2*(b*c+a*d),1-2*(a*a+b*b)]];
}
const rotate = (r,v) => r.map(row=>row.reduce((s,x,k)=>s+x*v[k],0));
const unrotate = (r,v) => [0,1,2].map(k=>r.reduce((s,row,j)=>s+row[k]*v[j],0));
function body(value) {
  record(value,['center','halfSize','magnetization','rotation'],['center','halfSize','magnetization'],'body');
  const center=vector(value.center,3,'center'), half=vector(value.halfSize,3,'halfSize'), M=vector(value.magnetization,3,'magnetization');
  if(M.some(v=>v!==0 && Math.abs(v)<1e-100)) fail('nonzero magnetization magnitude must be >=1e-100');
  const min=Math.min(...half), scale=Math.max(...half);
  if(min<1e-100 || scale/min>16) fail('halfSize must be positive >=1e-100; aspect ratio <=16');
  if(center.some(v=>Math.abs(v)/min>1e6)) fail('center exceeds coordinate resolution domain');
  const R=rotation(value.rotation ?? [0,0,0,1]);
  return {center,half:half.map(v=>v/scale),min,scale,M,R,worldM:rotate(R,M)};
}
// Integral from lo to hi of 1/sqrt(rho^2+t^2). asinh avoids log(R+t) cancellation.
function line(lo,hi,rho) {
  if(rho===0) {
    if(lo*hi<=0) fail('undefined edge integral');
    return Math.sign(lo)*Math.log(Math.abs(hi/lo));
  }
  return Math.asinh(hi/rho)-Math.asinh(lo/rho);
}
// Integral of (observation-source)/|observation-source|^3 over one rectangle.
function face(u0,u1,v0,v1,d) {
  const x=line(v0,v1,Math.hypot(u1,d))-line(v0,v1,Math.hypot(u0,d));
  const y=line(u0,u1,Math.hypot(v1,d))-line(u0,u1,Math.hypot(v0,d));
  let z=0;
  if(d!==0) {
    const primitive=(u,v)=>Math.sign(d)*Math.atan2(u*v,Math.abs(d)*Math.hypot(u,v,d));
    z=primitive(u1,v1)-primitive(u0,v1)-primitive(u1,v0)+primitive(u0,v0);
  }
  return [x,y,z];
}
function freeze(value) {
  if(value && typeof value==='object') { for(const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
function audit(value) {
  if(typeof value==='number' && !Number.isFinite(value)) fail('nonfinite field result; no result published');
  if(value && typeof value==='object') for(const v of Object.values(value)) audit(v);
}
/** All-or-nothing evaluation. Unknown fields, surfaces/collar and out-of-domain pairs fail closed. */
export function evaluateCuboidField(request) {
  record(request,['units','bodies','targets'],['units','bodies','targets'],'request');
  if(request.units!=='SI') throw new TypeError('units must be SI');
  const bodies=array(request.bodies,32,'bodies').map(body), targets=array(request.targets,512,'targets').map(v=>vector(v,3,'target'));
  const H=[],B=[],materialM=[],region=[];
  for(const target of targets) {
    const h=[0,0,0], m=[0,0,0]; let inside=0;
    for(const b of bodies) {
      if(target.some(v=>Math.abs(v)/b.min>1e6)) fail('target exceeds coordinate resolution domain');
      const q=unrotate(b.R,target.map((v,k)=>(v-b.center[k])/b.scale));
      if(q.some(v=>Math.abs(v)>64*b.min/b.scale)) fail('target/body distance exceeds bounded cancellation domain');
      const delta=q.map((v,k)=>Math.abs(v)-b.half[k]);
      if(delta.some((v,k)=>Math.abs(v)<=1e-10 && delta.every((w,j)=>j===k || w<=1e-10))) fail('target on cuboid surface or excluded surface collar');
      if(delta.every(v=>v<0)) { inside++; for(let k=0;k<3;k++) m[k]+=b.worldM[k]; }
      const localH=[0,0,0];
      for(let n=0;n<3;n++) {
        const u=(n+1)%3,v=(n+2)%3;
        for(const sign of [-1,1]) {
          const f=face(-b.half[u]-q[u],b.half[u]-q[u],-b.half[v]-q[v],b.half[v]-q[v],q[n]-sign*b.half[n]);
          const density=sign*b.M[n]*C;
          localH[u]+=density*f[0]; localH[v]+=density*f[1]; localH[n]+=density*f[2];
        }
      }
      const world=rotate(b.R,localH); for(let k=0;k<3;k++) h[k]+=world[k];
    }
    H.push(h); materialM.push(m); B.push(h.map((v,k)=>MU0*(v+m[k]))); region.push(inside===0?'exterior':inside===1?'interior':'overlap');
  }
  const result={H,B,materialM,region,metrics:{bodies:bodies.length,targets:targets.length,faceEvaluations:6*bodies.length*targets.length}};
  audit(result); return freeze(result);
}
