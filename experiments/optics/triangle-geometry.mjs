import {unit} from './reference.mjs';

/**
 * Brute-force, two-sided CPU triangle fixture oracle only. No scene capture,
 * bounding-box substitution, native geometry mirror, origin nudge or transport.
 * Rays: {originMm, direction, tMinMm, tMaxMm}; finite inclusive distance bounds,
 * 0 <= tMinMm <= tMaxMm. Direction is normalized; distances/positions use mm.
 * Triangles: {id, surfaceId, verticesMm:[a,b,c]}; 1..128 character identities.
 * Hit normals follow vertex winding; frontFace means direction opposes normal.
 * Barycentric coordinates correspond to [a,b,c]. Exact edges are inclusive.
 *
 * Uncertainty policy (heuristic, not formal error bounds/watertight arithmetic):
 * EPS=128 machine eps. Near parallel and poorly conditioned configurations,
 * normalized roundoff estimate >1e-7, nonexact edge/interval values within the
 * estimated tolerance, and nearest-distance ties remain explicit 'uncertain'.
 * Exact inclusive endpoints/edges may hit. closestTriangle propagates ANY
 * uncertain candidate, even one potentially beyond a clear hit. Only exact
 * equal-distance seams with same surface AND compatible winding normals dedup
 * deterministically by id. Other equal/near ties have no selected hit.
 * Invalid/degenerate geometry or nonfinite intermediate arithmetic throws.
 * No arbitrary coordinate scale, exact visibility, or production strategy claim.
 * Robust production triangle methods discussed in PBRT 4e, Shapes/Triangle_Meshes:
 * https://pbr-book.org/4ed/Shapes/Triangle_Meshes (no implementation copied).
 */
export const MAX_FIXTURE_TRIANGLES = 256;
export const GEOMETRY_EPSILON = 128 * Number.EPSILON;
const EPS = GEOMETRY_EPSILON;
const finite = x => {
  if (!Number.isFinite(x)) throw new RangeError('Nonfinite triangle arithmetic');
  return x;
};
const vector = v => {
  if (!Array.isArray(v) || v.length !== 3 || ![0, 1, 2].every(i => Number.isFinite(v[i])))
    throw new TypeError('Expected finite three-vector');
  return v;
};
const sub = (a, b) => a.map((v, i) => finite(v - b[i]));
const dot = (a, b) => finite(finite(a[0] * b[0]) + finite(a[1] * b[1]) + finite(a[2] * b[2]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(finite);
const magnitude = v => Math.max(...v.map(Math.abs));
const uncertain = reason => ({status:'uncertain', reason});
const miss = () => ({status:'miss'});

function rayData(ray) {
  if (!ray || typeof ray !== 'object') throw new TypeError('Expected ray record');
  vector(ray.originMm); vector(ray.direction);
  if (!Number.isFinite(ray.tMinMm) || !Number.isFinite(ray.tMaxMm) || ray.tMinMm < 0 || ray.tMaxMm < ray.tMinMm)
    throw new RangeError('Expected finite inclusive nonnegative distance interval');
  return {...ray, direction:unit(ray.direction)};
}
function triangleData(triangle) {
  if (!triangle || typeof triangle !== 'object' || typeof triangle.id !== 'string' || !triangle.id.length || triangle.id.length > 128 ||
      typeof triangle.surfaceId !== 'string' || !triangle.surfaceId.length || triangle.surfaceId.length > 128)
    throw new TypeError('Expected triangle and surface identities');
  const v = triangle.verticesMm;
  if (!Array.isArray(v) || v.length !== 3) throw new TypeError('Expected three actual vertices');
  for (let i = 0; i < 3; i++) vector(v[i]);
  const e1 = sub(v[1], v[0]), e2 = sub(v[2], v[0]);
  const scale = Math.max(magnitude(e1), magnitude(e2));
  if (!scale) throw new RangeError('Degenerate triangle');
  const a = e1.map(x => x / scale), b = e2.map(x => x / scale), c = cross(a, b);
  const length = Math.hypot(...c), quality = length / (Math.hypot(...a) * Math.hypot(...b));
  if (!length || !Number.isFinite(quality)) throw new RangeError('Degenerate or unrepresentable triangle');
  return {triangle, v0:v[0], a, b, scale, quality, normal:c.map(x => x / length)};
}
function query(ray, data) {
  const {triangle, v0, a, b, scale, quality, normal} = data;
  if (quality <= EPS) return uncertain('poorly-conditioned-triangle');
  const denominator = dot(normal, ray.direction);
  if (Math.abs(denominator) <= EPS) return uncertain('coplanar-or-near-parallel');
  const distanceMm = finite(dot(sub(v0, ray.originMm), normal) / denominator);
  for (const [bound, lower] of [[ray.tMinMm, true], [ray.tMaxMm, false]]) {
    const delta = finite(distanceMm - bound), tolerance = EPS * Math.max(1, Math.abs(distanceMm), Math.abs(bound));
    if ((lower && delta < -tolerance) || (!lower && delta > tolerance)) return miss();
    if (delta !== 0 && Math.abs(delta) <= tolerance) return uncertain('near-interval-boundary');
  }
  const normalizedScale = finite(Math.max(1, magnitude(v0), magnitude(ray.originMm), Math.abs(distanceMm)) / scale);
  const tolerance = finite(EPS * Math.max(1, normalizedScale) / quality);
  if (tolerance > 1e-7) return uncertain('position-resolution');
  const positionMm = ray.originMm.map((x, i) => finite(x + finite(distanceMm * ray.direction[i])));
  const q = sub(positionMm, v0).map(x => finite(x / scale));
  let k = 0;
  if (Math.abs(normal[1]) > Math.abs(normal[k])) k = 1;
  if (Math.abs(normal[2]) > Math.abs(normal[k])) k = 2;
  const i = (k + 1) % 3, j = (k + 2) % 3;
  const determinant = finite(a[i] * b[j] - a[j] * b[i]);
  const beta = finite(finite(q[i] * b[j] - q[j] * b[i]) / determinant);
  const gamma = finite(finite(a[i] * q[j] - a[j] * q[i]) / determinant);
  const barycentric = [finite(1 - beta - gamma), beta, gamma];
  if (barycentric.some(x => x < -tolerance || x > 1 + tolerance)) return miss();
  if (barycentric.some(x => (x !== 0 && Math.abs(x) <= tolerance) || (x !== 1 && Math.abs(x - 1) <= tolerance)))
    return uncertain('near-triangle-edge');
  return {status:'hit', triangleId:triangle.id, surfaceId:triangle.surfaceId, distanceMm,
    positionMm, barycentric, geometricNormal:normal, frontFace:denominator < 0};
}

export function intersectTriangle(ray, triangle) {
  return query(rayData(ray), triangleData(triangle));
}

export function closestTriangle(ray, triangles) {
  const r = rayData(ray);
  if (!Array.isArray(triangles)) throw new TypeError('Expected fixture triangle array');
  const count = triangles.length;
  if (count > MAX_FIXTURE_TRIANGLES)
    throw new RangeError('Expected at most 256 fixture triangles');
  const ids = new Set(), hits = [];
  let candidateUncertainty = null;
  // Never early-return: malformed later fixtures must still reject.
  for (let i = 0; i < count; i++) {
    const data = triangleData(triangles[i]);
    if (ids.has(data.triangle.id)) throw new RangeError('Duplicate triangle id');
    ids.add(data.triangle.id);
    const result = query(r, data);
    if (result.status === 'hit') hits.push(result);
    if (result.status === 'uncertain' && (!candidateUncertainty || data.triangle.id < candidateUncertainty.triangleId))
      candidateUncertainty = {status:'uncertain', reason:'candidate-uncertain', triangleId:data.triangle.id, detail:result.reason};
  }
  if (candidateUncertainty) return candidateUncertainty;
  if (!hits.length) return miss();
  let nearest = hits[0];
  for (const hit of hits) if (hit.distanceMm < nearest.distanceMm ||
    (hit.distanceMm === nearest.distanceMm && hit.triangleId < nearest.triangleId)) nearest = hit;
  const exactNearest = nearest;
  for (const hit of hits) {
    const tolerance = EPS * Math.max(1, Math.abs(hit.distanceMm), Math.abs(exactNearest.distanceMm));
    if (Math.abs(hit.distanceMm - exactNearest.distanceMm) > tolerance) continue;
    const sameSeam = hit.distanceMm === exactNearest.distanceMm && hit.surfaceId === exactNearest.surfaceId &&
      hit.geometricNormal.every((x, i) => Math.abs(x - exactNearest.geometricNormal[i]) <= EPS);
    if (!sameSeam) return uncertain('ambiguous-nearest');
    if (hit.triangleId < nearest.triangleId) nearest = hit;
  }
  return nearest;
}
