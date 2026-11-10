// Unloaded, explicit physical-mm geometry only. No scene capture or route planning.
import {pointSegmentDistance, segmentsContact, qualifySimpleRing} from './linear-geometry.js';

export const REGION_LIMITS=Object.freeze({regions:64,rings:128,ringVertices:256,
  vertices:4096,motions:4096,pairWork:2000000,coordinateMm:1e9,geometryToleranceMm:1e-6});
const tol=REGION_LIMITS.geometryToleranceMm;
const fail=(code,path,message)=>{throw Object.assign(new Error(`${path}: ${message}`),
  {code,details:Object.freeze({path,message})});};
const invalid=(path,message)=>fail('CUT_REGION_INVALID',path,message);
const budget=message=>fail('CUT_REGION_BUDGET','input',message);
const keys=(v,allowed,path)=>{
  if(!v || typeof v!=='object' || Array.isArray(v)) invalid(path,'must be a record.');
  for(const key of Object.keys(v)) if(!allowed.includes(key)) fail('CUT_REGION_UNSUPPORTED',`${path}.${key}`,'unsupported constraint cannot be ignored.');
};
const scalar=(v,path)=>{
  if(!Number.isFinite(v) || Math.abs(v)>REGION_LIMITS.coordinateMm) invalid(path,'must be finite within the supported millimetre range.');
  // Keep local subtraction, products and distances comfortably within the fixed
  // working tolerance. This does not bound unknown source/evaluator error.
  if(128*Number.EPSILON*Math.max(1,Math.abs(v))*16>tol) fail('CUT_REGION_PRECISION',path,'coordinate magnitude cannot resolve the working tolerance.');
  return v;
};
const point=(v,path)=>{
  if(!Array.isArray(v) || v.length!==2) invalid(path,'must be a physical [x,z] point.');
  return Array.from(v,(x,i)=>scalar(x,`${path}[${i}]`));
};
const id=(v,seen,path)=>{
  if(typeof v!=='string' || !v.length || v.length>256 || seen.has(v)) invalid(path,'must be a unique nonempty string of at most 256 code units.');
  seen.add(v);return v;
};
const freezePoint=p=>Object.freeze(p);
const freezeRing=r=>Object.freeze(r.map(freezePoint));

// Boundary is classified separately before the ordinary parity test. Winding
// does not affect either polygon membership or hole semantics.
function ringLocation(p,ring) {
  let inside=false;
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length];
    if(pointSegmentDistance(p,a,b)<=tol) return 0;
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<a[0]+(p[1]-a[1])*(b[0]-a[0])/(b[1]-a[1])) inside=!inside;
  }
  return inside?1:-1;
}
function filledLocation(p,region) {
  const outer=ringLocation(p,region.outer);
  if(outer!==1) return outer;
  for(const hole of region.holes) {
    const location=ringLocation(p,hole);
    if(location===0) return 0;
    if(location===1) return -1;
  }
  return 1;
}
function ringsContact(a,b) {
  for(let i=0;i<a.length;i++) for(let j=0;j<b.length;j++)
    if(segmentsContact(a[i],a[(i+1)%a.length],b[j],b[(j+1)%b.length],tol)) return true;
  return false;
}
function segmentDistance(a,b,c,d) {
  if(segmentsContact(a,b,c,d,0)) return 0;
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
}
function filledDistance(a,b,region) {
  // A fully enclosed segment can have no boundary crossing. Membership checks
  // are essential alongside continuous segment/edge distance, including dwell.
  if(filledLocation(a,region)>=0 || filledLocation(b,region)>=0) return 0;
  let distance=Infinity;
  for(const ring of [region.outer,...region.holes]) for(let i=0;i<ring.length;i++)
    distance=Math.min(distance,segmentDistance(a,b,ring[i],ring[(i+1)%ring.length]));
  return distance;
}

/** Region-only validation; never a work-area, complete route or machine certificate.
 * Malformed/unsupported inputs throw before any collision result is constructed.
 * Geometric violations return valid:false with one prioritized diagnostic/motion.
 */
export function validateLinearRegions(input) {
  keys(input,['regions','motions'],'input');
  if(!Array.isArray(input.regions)) invalid('regions','must be an explicit array.');
  if(!Array.isArray(input.motions) || !input.motions.length) invalid('motions','must contain at least one explicit line.');
  if(input.regions.length>REGION_LIMITS.regions || input.motions.length>REGION_LIMITS.motions) budget('Region or motion count exceeded.');
  let vertices=0,ringCount=0,pairWork=0;
  const spend=n=>{pairWork+=n;if(pairWork>REGION_LIMITS.pairWork) budget('Topology and continuous collision pair-work exceeded.');};
  const regionIds=new Set(),motionIds=new Set();
  const regions=Array.from(input.regions,(raw,index)=>{
    const path=`regions[${index}]`;
    keys(raw,['id','kind','outer','holes'],path);
    const regionId=id(raw.id,regionIds,`${path}.id`);
    if(!['Avoid','No-cut'].includes(raw.kind)) invalid(`${path}.kind`,'must be Avoid or No-cut.');
    if(!Array.isArray(raw.holes)) invalid(`${path}.holes`,'must be an explicit array.');
    if(raw.holes.length>=REGION_LIMITS.rings) budget('Ring count exceeded.');
    const ring=(values,label)=>{
      if(!Array.isArray(values) || values.length<3) invalid(label,'must contain at least three vertices, without a repeated closing vertex.');
      vertices+=values.length;ringCount++;
      if(vertices>REGION_LIMITS.vertices || ringCount>REGION_LIMITS.rings || values.length>REGION_LIMITS.ringVertices) budget('Vertex or ring count exceeded.');
      spend(values.length*values.length);
      const points=Array.from(values,(v,i)=>point(v,`${label}[${i}]`));
      for(let i=0;i<points.length;i++) if(Math.hypot(points[i][0]-points[(i+1)%points.length][0],points[i][1]-points[(i+1)%points.length][1])<=4*tol)
        fail('CUT_REGION_TOPOLOGY',label,'zero or unresolved short boundary edge.');
      qualifySimpleRing(points,tol,message=>fail('CUT_REGION_TOPOLOGY',label,message));
      return points;
    };
    const outer=ring(raw.outer,`${path}.outer`),holes=Array.from(raw.holes,(v,i)=>ring(v,`${path}.holes[${i}]`));
    for(let h=0;h<holes.length;h++) {
      spend(outer.length*holes[h].length);
      if(ringsContact(outer,holes[h]) || ringLocation(holes[h][0],outer)!==1)
        fail('CUT_REGION_TOPOLOGY',`${path}.holes[${h}]`,'hole must lie strictly inside outer without boundary contact.');
      for(let j=0;j<h;j++) {
        spend(holes[j].length*holes[h].length);
        if(ringsContact(holes[j],holes[h]) || ringLocation(holes[h][0],holes[j])!==-1 || ringLocation(holes[j][0],holes[h])!==-1)
          fail('CUT_REGION_TOPOLOGY',`${path}.holes[${h}]`,'holes must be disjoint, nonnested and without contact.');
      }
    }
    return Object.freeze({id:regionId,kind:raw.kind,outer:freezeRing(outer),holes:Object.freeze(holes.map(freezeRing))});
  });
  // Preflight every motion and a conservative complete work bound before any
  // geometric success/failure result. No malformed suffix can be ignored.
  spend(input.motions.length*vertices*3);
  const motions=Array.from(input.motions,(raw,index)=>{
    const path=`motions[${index}]`;keys(raw,['id','type','from','to','tool','lineWidthMm'],path);
    const motionId=id(raw.id,motionIds,`${path}.id`);
    if(raw.type!=='line') fail('CUT_REGION_UNSUPPORTED',`${path}.type`,'only explicit lines (including zero-length dwell) are supported.');
    if(!['off','Cut','Mark'].includes(raw.tool)) invalid(`${path}.tool`,'must explicitly be off, Cut or Mark.');
    const width=scalar(raw.lineWidthMm,`${path}.lineWidthMm`);
    if(width<0) invalid(`${path}.lineWidthMm`,'must be nonnegative.');
    return Object.freeze({id:motionId,type:'line',from:freezePoint(point(raw.from,`${path}.from`)),to:freezePoint(point(raw.to,`${path}.to`)),tool:raw.tool,lineWidthMm:width});
  });
  const diagnostics=[];
  const ordered=[...regions.filter(r=>r.kind==='Avoid'),...regions.filter(r=>r.kind==='No-cut')];
  for(const motion of motions) for(const region of ordered) {
    if(region.kind==='No-cut' && motion.tool==='off') continue;
    const radius=region.kind==='Avoid'?0:motion.lineWidthMm/2;
    const distance=filledDistance(motion.from,motion.to,region);
    if(distance<=radius+tol) {
      diagnostics.push(Object.freeze({code:region.kind==='Avoid'?'CUT_REGION_AVOID':'CUT_REGION_NO_CUT',motionId:motion.id,regionId:region.id,
        centerlineDistanceMm:distance,sweptRadiusMm:radius,message:region.kind==='Avoid'?'Head reference enters, touches or is unresolved near Avoid.':'Active swept disk damages, touches or is unresolved near No-cut.'}));
      break;
    }
  }
  return Object.freeze({scope:'linear-region-validation',valid:diagnostics.length===0,machineReady:false,
    geometryToleranceMm:tol,regions:Object.freeze(regions),motions:Object.freeze(motions),diagnostics:Object.freeze(diagnostics),
    counts:Object.freeze({regions:regions.length,rings:ringCount,vertices,motions:motions.length,pairWorkUpperBound:pairWork})});
}
