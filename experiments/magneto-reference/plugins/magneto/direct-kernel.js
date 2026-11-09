/** CPU-only SI reference. See direct-kernel.md before using as a physical oracle. */
export const MU0 = 4 * Math.PI * 1e-7;
export const MAX_DIRECT_SAMPLES = 2048;
const C = MU0 / (4 * Math.PI);
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a,b) => a.map((v,k)=>v-b[k]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add = (a,b,scale=1) => { for(let k=0;k<3;k++) a[k]+=scale*b[k]; };
const zeros = n => Array.from({length:n},()=>[0,0,0]);
function finite(x,label) { if(typeof x!=='number'||!Number.isFinite(x)) throw new TypeError(`${label} must be finite`); return x; }
function vec(x,label) { if(!Array.isArray(x)||x.length!==3) throw new TypeError(`${label} must be a vec3`); return Array.from(x,v=>finite(v,label)); }
function positive(x,label) { finite(x,label); if(x<=0) throw new RangeError(`${label} must be positive`); return x; }
function checked(samples,key) {
  if(!Array.isArray(samples)||samples.length>MAX_DIRECT_SAMPLES) throw new RangeError('sample capacity exceeded or invalid array');
  return Array.from(samples,s=>{
    if(!s||typeof s!=='object') throw new TypeError('invalid sample');
    const position=vec(s.position,'position'), value=vec(s[key],key), volume=positive(s.volume,'volume');
    if(typeof s.objectId!=='string'||!s.objectId.length) throw new TypeError('objectId required');
    const radius=Math.cbrt(volume)*Math.cbrt(3/(4*Math.PI));
    return {position,value,volume,radius,objectId:s.objectId};
  });
}
function audit(value) {
  if(typeof value==='number'&&!Number.isFinite(value)) throw new RangeError('nonfinite numerical result; no result published');
  if(value&&typeof value==='object') for(const v of Object.values(value)) audit(v);
  return value;
}
/** No i=i self field or self energy. Fields include all distinct same-owner samples. */
export function evaluateDirect(samples,{supportScale=1,selectedOwners=null,pivot=[0,0,0]}={}) {
  const a=checked(samples,'moment'); positive(supportScale,'supportScale'); pivot=vec(pivot,'pivot');
  if(selectedOwners!==null&&(!Array.isArray(selectedOwners)||selectedOwners.some(x=>typeof x!=='string'||!x.length))) throw new TypeError('selectedOwners must be null or owner string array');
  const selected=selectedOwners===null?null:new Set(selectedOwners);
  if(selected&&[...selected].some(id=>!a.some(s=>s.objectId===id))) throw new RangeError('unknown selected owner');
  const n=a.length,B=zeros(n),forces=zeros(n),torques=zeros(n);
  const selection=selected?{force:[0,0,0],torque:[0,0,0]}:null;
  let energy=0,pairCount=0;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
    const r=sub(a[i].position,a[j].position), mi=a[i].value,mj=a[j].value;
    const eps2=(supportScale*a[i].radius)**2+(supportScale*a[j].radius)**2;
    const s=dot(r,r)+eps2;
    if(!Number.isFinite(s)||s<=0||!Number.isFinite(eps2)||eps2<=0) throw new RangeError('unrepresentable support/distance');
    const q=1/Math.sqrt(s),q3=q*q*q,q5=q3/s,q7=q5/s;
    const u=dot(mi,r),v=dot(mj,r),d=dot(mi,mj);
    const bi=r.map((x,k)=>C*(3*x*v*q5-mj[k]*q3));
    const bj=r.map((x,k)=>C*(3*x*u*q5-mi[k]*q3));
    const f=r.map((x,k)=>C*(3*(d*x+v*mi[k]+u*mj[k])*q5-15*u*v*x*q7));
    const ti=cross(mi,bi),tj=cross(mj,bj);
    energy+=C*(d*q3-3*u*v*q5); pairCount++;
    add(B[i],bi); add(B[j],bj); add(forces[i],f); add(forces[j],f,-1); add(torques[i],ti); add(torques[j],tj);
    if(selected) {
      const si=selected.has(a[i].objectId),sj=selected.has(a[j].objectId);
      if(si!==sj) {
        const index=si?i:j,sign=si?1:-1;
        add(selection.force,f,sign);
        add(selection.torque,cross(sub(a[index].position,pivot),f),sign);
        add(selection.torque,si?ti:tj);
      }
    }
  }
  return audit({H:B.map(b=>b.map(x=>x/MU0)),B,forces,torques,energy,selection,pairCount});
}
/** Prescribed signed current quadrature only, not a divergence-free current solver. */
export function evaluateCurrentField(sources,targets,{supportScale=1}={}) {
  const a=checked(sources,'currentDensity'); positive(supportScale,'supportScale');
  if(!Array.isArray(targets)||targets.length>MAX_DIRECT_SAMPLES||targets.length*a.length>MAX_DIRECT_SAMPLES**2) throw new RangeError('target capacity exceeded');
  const points=Array.from(targets,p=>vec(p,'target')),B=zeros(points.length);
  for(let i=0;i<points.length;i++) for(const source of a) {
    const r=sub(points[i],source.position),eps2=(supportScale*source.radius)**2,s=dot(r,r)+eps2;
    if(!Number.isFinite(s)||s<=0||!Number.isFinite(eps2)||eps2<=0) throw new RangeError('unrepresentable support/distance');
    const q=1/Math.sqrt(s);
    add(B[i],cross(source.value,r),C*source.volume*q*q*q);
  }
  return audit({B,H:B.map(b=>b.map(x=>x/MU0))});
}


/** Fixed prescribed-current sources: dipole loads only; no source reaction claim. */
export function evaluatePrescribedCurrentLoads(sources,dipoles,{supportScale=1,selectedOwners=null,pivot=[0,0,0]}={}) {
  const a=checked(sources,'currentDensity'),targets=checked(dipoles,'moment');
  positive(supportScale,'supportScale');pivot=vec(pivot,'pivot');
  if(selectedOwners!==null&&(!Array.isArray(selectedOwners)||Array.from(selectedOwners).some(x=>typeof x!=='string'||!x.length))) throw new TypeError('selectedOwners must be null or owner string array');
  const selected=selectedOwners===null?null:new Set(selectedOwners);
  if(selected&&[...selected].some(id=>!targets.some(s=>s.objectId===id))) throw new RangeError('unknown selected dipole owner');
  const B=zeros(targets.length),forces=zeros(targets.length),torques=zeros(targets.length);
  const selection=selected?{force:[0,0,0],torque:[0,0,0]}:null;
  const axes=[[1,0,0],[0,1,0],[0,0,1]];
  let fixedMomentEnergy=0,pairCount=0;
  for(let i=0;i<targets.length;i++) {
    const target=targets[i];
    for(const source of a) {
      const r=sub(target.position,source.position),eps2=(supportScale*source.radius)**2,s=dot(r,r)+eps2;
      if(!Number.isFinite(s)||s<=0||!Number.isFinite(eps2)||eps2<=0) throw new RangeError('unrepresentable support/distance');
      const q=1/Math.sqrt(s),q3=q*q*q,q5=q3/s,prefactor=C*source.volume;
      const jxr=cross(source.value,r);
      add(B[i],jxr,prefactor*q3);
      for(let k=0;k<3;k++) {
        const jxe=cross(source.value,axes[k]);
        forces[i][k]+=prefactor*(dot(target.value,jxe)*q3-3*dot(target.value,jxr)*r[k]*q5);
      }
      pairCount++;
    }
    torques[i]=cross(target.value,B[i]);
    fixedMomentEnergy-=dot(target.value,B[i]);
    if(selected?.has(target.objectId)) {
      add(selection.force,forces[i]);
      add(selection.torque,torques[i]);
      add(selection.torque,cross(sub(target.position,pivot),forces[i]));
    }
  }
  return audit({B,H:B.map(b=>b.map(x=>x/MU0)),forces,torques,fixedMomentEnergy,selection,pairCount});
}
