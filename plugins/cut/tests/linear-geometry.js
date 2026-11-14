// Shared unloaded CPU predicates for bounded, already-linear physical geometry.
// Contacts within the caller tolerance reject; no snapping or topology repair.
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

export function pointSegmentDistance(p, a, b) {
  const dx=b[0]-a[0], dy=b[1]-a[1];
  if (dx===0 && dy===0) return Math.hypot(p[0]-a[0],p[1]-a[1]);
  const t=Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy);
}
export const orient = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function segmentsContact(a,b,c,d,tol) {
  if (Math.max(a[0],b[0])+tol < Math.min(c[0],d[0]) || Math.max(c[0],d[0])+tol < Math.min(a[0],b[0]) ||
      Math.max(a[1],b[1])+tol < Math.min(c[1],d[1]) || Math.max(c[1],d[1])+tol < Math.min(a[1],b[1])) return false;
  const abC=orient(a,b,c), abD=orient(a,b,d), cdA=orient(c,d,a), cdB=orient(c,d,b);
  if (((abC<0 && abD>0)||(abC>0 && abD<0)) && ((cdA<0 && cdB>0)||(cdA>0 && cdB<0))) return true;
  return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b)) <= tol;
}

export function qualifySimpleRing(points, tol, reject) {
  let twiceArea=0, perimeter=0;
  // Origin-relative fan avoids subtracting huge absolute shoelace terms.
  for (let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length];
    perimeter += distance(a,b);
    twiceArea += orient(points[0],a,b);
    const prev=points[(i+points.length-1)%points.length];
    // Adjacent straight continuations are allowed, overlapping reversals are not.
    const va=[prev[0]-a[0],prev[1]-a[1]], vb=[b[0]-a[0],b[1]-a[1]];
    if (va[0]*vb[0]+va[1]*vb[1] > 0 && Math.min(pointSegmentDistance(b,prev,a),pointSegmentDistance(prev,a,b)) <= tol) {
      reject('adjacent edges overlap or nearly reverse.');
    }
    for (let j=i+1;j<points.length;j++) {
      if (j===i+1 || (i===0 && j===points.length-1)) continue;
      if (segmentsContact(a,b,points[j],points[(j+1)%points.length],tol)) {
        reject('closed boundary intersects, touches or has an unresolved near contact.');
      }
    }
  }
  if (Math.abs(twiceArea) <= 2*tol*perimeter) reject('closed area is degenerate or unresolved.');
  return twiceArea/2;
}
