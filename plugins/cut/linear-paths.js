import {qualifySimpleRing} from './linear-geometry.js';

// Standalone CPU foundation. Intentionally not imported by the Cut runtime.
// Input is explicit, already-linear geometry, not native scene capture.
export const LINEAR_LIMITS = Object.freeze({
  sources: 128, points: 16384, closedVertices: 512, operations: 131072,
  coordinateMm: 1e9, geometryToleranceMm: 1e-6, axisTolerance: 1e-12
});

const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const invalid = message => fail('CUT_LINEAR_INVALID', message);
const keys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be a record.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) {
    fail('CUT_LINEAR_UNSUPPORTED', `${label}.${key} is not supported; constraints cannot be ignored.`);
  }
};
const scalar = (v, label, positive = false) => {
  if (!Number.isFinite(v) || Math.abs(v) > LINEAR_LIMITS.coordinateMm || (positive && v <= 0)) invalid(`${label} is outside the finite supported millimetre range.`);
  return v;
};
const vector = (v, size, label) => {
  if (!Array.isArray(v) || v.length !== size) invalid(`${label} must have ${size} coordinates.`);
  return Array.from(v, (x, i) => scalar(x, `${label}[${i}]`));
};
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => { const n = Math.hypot(...a); return a.map(v => v/n); };
const distance = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const frozenPoint = p => Object.freeze(p);

function workFrame(frame) {
  keys(frame, ['origin', 'xAxis', 'zAxis'], 'frame');
  const origin = vector(frame.origin, 3, 'frame.origin');
  let x = vector(frame.xAxis, 3, 'frame.xAxis');
  let z = vector(frame.zAxis, 3, 'frame.zAxis');
  const tol = LINEAR_LIMITS.axisTolerance;
  if (Math.abs(Math.hypot(...x)-1) > tol || Math.abs(Math.hypot(...z)-1) > tol || Math.abs(dot(x, z)) > tol) {
    fail('CUT_LINEAR_FRAME', 'Supply unit orthogonal physical axes; scaled, singular and sheared frames are unsupported.');
  }
  // Define the physical basis by orthonormalizing only admitted roundoff.
  x = unit(x);
  const headNormal = unit(cross(x, z));
  z = unit(cross(headNormal, x));
  return {origin, x, z, headNormal};
}

function qualifyClosed(points, tol, id) {
  const signedArea=qualifySimpleRing(points,tol,message=>fail('CUT_LINEAR_TOPOLOGY',`${id}: ${message}`));
  // Retain the seam and normalize CW from the specified head side.
  if (signedArea>0) points.splice(1,points.length-1,...points.slice(1).reverse());
  return Math.abs(signedArea);
}

/**
 * Validate all supplied linear sources, then construct separate active intervals.
 * Nothing is published on failure. Caller data is never changed. The result is
 * incomplete CAM: travel, obstacles, compensation, leads and machine code are absent.
 */
export function prepareLinearPaths(input) {
  keys(input, ['frame','areaMm','sources','mode','passes','speedMmMin','lineWidthMm','planarityToleranceMm','regions'], 'input');
  if (input.regions !== undefined && (!Array.isArray(input.regions) || input.regions.length)) {
    fail('CUT_LINEAR_UNSUPPORTED', 'Avoid/No-cut regions are not supported by this work-interval stage.');
  }
  if (!['Cut','Mark'].includes(input.mode)) invalid('mode must be Cut or Mark.');
  if (!Number.isSafeInteger(input.passes) || input.passes<1) invalid('passes must be a positive safe integer.');
  const speed=scalar(input.speedMmMin,'speedMmMin',true);
  if (speed<.001) invalid('speedMmMin must be at least 0.001.');
  const width=scalar(input.lineWidthMm,'lineWidthMm');
  if (width<0) invalid('lineWidthMm must be nonnegative.');
  const area=vector(input.areaMm,2,'areaMm');
  if (area.some(x=>x<=0)) invalid('areaMm dimensions must be positive physical millimetres.');
  const planar=scalar(input.planarityToleranceMm ?? 1e-6,'planarityToleranceMm',true);
  const frame=workFrame(input.frame), tol=LINEAR_LIMITS.geometryToleranceMm;
  if (!Array.isArray(input.sources) || !input.sources.length) invalid('At least one explicit linear source is required.');
  if (input.sources.length>LINEAR_LIMITS.sources) fail('CUT_LINEAR_BUDGET','Source budget exceeded.');

  let totalPoints=0, expandedOperations=0, projectionErrorBoundMm=0;
  const ids=new Set(), paths=[];
  for (const source of input.sources) {
    keys(source,['id','closed','worldPoints','tags'],'source');
    if (typeof source.id!=='string' || !source.id.length || source.id.length>256 || ids.has(source.id)) invalid('Source IDs must be nonempty, unique strings of at most 256 code units.');
    ids.add(source.id);
    if (source.tags !== undefined && (!Array.isArray(source.tags) || source.tags.length)) fail('CUT_LINEAR_UNSUPPORTED',`${source.id}: tagged geometry requires source qualification outside this stage.`);
    if (typeof source.closed!=='boolean') invalid(`${source.id}: closed must be explicit.`);
    if (source.closed && input.mode==='Cut') fail('CUT_LINEAR_UNSUPPORTED','Closed Cut requires qualified shared compensation and lead-in support.');
    const raw=source.worldPoints;
    if (!Array.isArray(raw) || raw.length<(source.closed?3:2)) invalid(`${source.id}: insufficient explicit polyline vertices.`);
    totalPoints += raw.length;
    if (totalPoints>LINEAR_LIMITS.points || (source.closed && raw.length>LINEAR_LIMITS.closedVertices)) fail('CUT_LINEAR_BUDGET','Linear point/topology budget exceeded.');
    const segmentCount=raw.length-(source.closed?0:1);
    const addedOperations=(segmentCount+2)*input.passes;
    if (addedOperations>LINEAR_LIMITS.operations-expandedOperations) fail('CUT_LINEAR_BUDGET','Expanded operation budget exceeded.');
    expandedOperations += addedOperations;
    let maxDeviation=0;
    const points=Array.from(raw,(value,index)=>{
      const p=vector(value,3,`${source.id}.worldPoints[${index}]`);
      const d=p.map((v,i)=>v-frame.origin[i]);
      // Supported floating-point envelope, not a source/evaluator accuracy claim.
      const magnitude=Math.max(1,...p.map(Math.abs),...frame.origin.map(Math.abs),...d.map(Math.abs));
      const error=128*Number.EPSILON*magnitude;
      projectionErrorBoundMm=Math.max(projectionErrorBoundMm,error);
      if (error*16>Math.min(tol,planar)) fail('CUT_LINEAR_PRECISION',`${source.id}: coordinate magnitude cannot resolve the requested tolerance.`);
      const deviation=Math.abs(dot(d,frame.headNormal));
      maxDeviation=Math.max(maxDeviation,deviation);
      if (deviation+error>planar) fail('CUT_LINEAR_NONPLANAR',`${source.id}: source is not qualified within the local plane tolerance.`);
      const local=[dot(d,frame.x),dot(d,frame.z)];
      // No fuzzy outside allowance or boundary clipping. Exact boundary values
      // are admitted; arithmetic that lands outside rejects conservatively.
      if (local.some((v,i)=>v<0 || v>area[i])) fail('CUT_LINEAR_BOUNDS',`${source.id}: whole source must lie inside the physical work rectangle.`);
      return local;
    });
    for (let i=0;i<segmentCount;i++) if (distance(points[i],points[(i+1)%points.length])<=4*tol) {
      fail('CUT_LINEAR_DEGENERATE',`${source.id}: duplicate, zero or unresolved short edge; closed input omits the repeated endpoint.`);
    }
    const areaMm2=source.closed?qualifyClosed(points,tol,source.id):null;
    let lengthMm=0;
    for (let i=0;i<segmentCount;i++) lengthMm+=distance(points[i],points[(i+1)%points.length]);
    paths.push(Object.freeze({sourceId:source.id,closed:source.closed,points:Object.freeze(points.map(frozenPoint)),lengthMm,areaMm2,maxPlanarityDeviationMm:maxDeviation,winding:source.closed?'CW':null}));
  }

  // Construct only after every source has passed. No line connects sources or
  // separate passes; a consumer must plan and validate each tool-off transition.
  const intervals=[];
  let workLengthMm=0;
  for (const path of paths) for (let pass=1;pass<=input.passes;pass++) {
    const count=path.points.length-(path.closed?0:1), start=path.points[0];
    const end=path.closed?start:path.points.at(-1);
    const operations=[Object.freeze({type:'tool-on',at:start})];
    for (let i=0;i<count;i++) operations.push(Object.freeze({type:'work-line',from:path.points[i],to:path.points[(i+1)%path.points.length],speedMmMin:speed}));
    operations.push(Object.freeze({type:'tool-off',at:end}));
    intervals.push(Object.freeze({sourceId:path.sourceId,pass,start,end,operations:Object.freeze(operations)}));
    workLengthMm+=path.lengthMm;
  }
  return Object.freeze({scope:'work-intervals',machineReady:false,travelPlanned:false,
    mode:input.mode,passes:input.passes,lineWidthMm:width,speedMmMin:speed,
    areaMm:Object.freeze(area),frame:Object.freeze({origin:frozenPoint(frame.origin),xAxis:frozenPoint(frame.x),zAxis:frozenPoint(frame.z),headNormal:frozenPoint(frame.headNormal)}),
    geometryToleranceMm:tol,planarityToleranceMm:planar,projectionErrorBoundMm,
    paths:Object.freeze(paths),intervals:Object.freeze(intervals),workLengthMm,operationCount:expandedOperations});
}
