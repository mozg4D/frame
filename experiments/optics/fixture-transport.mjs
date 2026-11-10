import {unit, interfaceResponse} from './reference.mjs';
import {intersectTriangle, closestTriangle, MAX_FIXTURE_TRIANGLES, GEOMETRY_EPSILON} from './triangle-geometry.mjs';

/**
 * Bounded SINGLE-ray brute-force CPU fixture oracle; not a scene solver.
 * traceFixtureRay({originMm,direction,powerW}, fixtures,
 *                 {maxInteractions,maxPathMm})
 * Fixtures are actual triangle records {id,surfaceId,verticesMm,model}, with
 * model blocker / ideal-mirror / receiver-useful / receiver-unwanted.
 * All fixtures/models validate first, including zero-power/zero-event calls.
 * Inputs/output are transient: no JSON, HASH, persistence, scene capture or
 * document records; no retained scene state, ray batch, path or event arrays.
 * Passive numeric records only; executable accessors/proxies are unsupported.
 *
 * Finite remaining-distance queries always start at tMinMm=0. ONLY exact zero
 * contacts on the previous surface with compatible winding normals are skipped
 * for this segment. A planar triangle cannot have another hit farther along
 * that same straight segment. Positive-distance same-surface hits remain eligible.
 * No epsilon origin displacement or global tMin gap is introduced. Initial or
 * different/incompatible zero contacts and all geometry uncertainty remain
 * unresolved. Exact-only suppression may stop ordinary floating-point bounces;
 * this inherits the geometry helper's heuristic, non-watertight limits.
 *
 * Ideal mirrors supply R=1 by definition. interfaceResponse(...,1,1).reflected
 * is reused ONLY for geometric specular direction, never its Fresnel power.
 * There are no dielectric branches, media, coatings or qualified materials.
 *
 * One terminal channel receives all original watts. escapedWatts is ALWAYS 0:
 * no hit in a finite interval cannot prove global escape. eventCount counts
 * positive-distance interactions including terminal hits. pathMm records known
 * traveled segments; a no-hit query advances it to the finite path budget.
 * Uncertainty stops at the last confirmed point. No partial-success certificate.
 * O(maxInteractions * fixture count), at most 64 events and 256 triangles;
 * only bounded per-segment candidates/current ray are retained, never a path.
 */
export function traceFixtureRay(ray, fixtures, options) {
  if (!ray || ![ray.originMm, ray.direction].every(v => Array.isArray(v) && v.length === 3 &&
      [0, 1, 2].every(i => Number.isFinite(v[i]))))
    throw new TypeError('Expected finite ray origin and direction');
  const initialDirection = unit(ray.direction);
  if (!Number.isFinite(ray.powerW) || ray.powerW < 0) throw new RangeError('Expected finite nonnegative ray watts');
  if (!options || !Number.isSafeInteger(options.maxInteractions) || options.maxInteractions < 0 || options.maxInteractions > 64 ||
      !Number.isFinite(options.maxPathMm) || options.maxPathMm <= 0)
    throw new RangeError('Expected 0..64 interactions and positive finite path budget in mm');
  if (!Array.isArray(fixtures)) throw new TypeError('Expected fixture array');
  const count = fixtures.length;
  if (count > MAX_FIXTURE_TRIANGLES) throw new RangeError('Too many fixture triangles');
  const models = new Map(), surfaces = new Map();
  const validationRay = {originMm:ray.originMm, direction:initialDirection, tMinMm:0, tMaxMm:options.maxPathMm};
  for (let i = 0; i < count; i++) {
    const fixture = fixtures[i];
    intersectTriangle(validationRay, fixture); // Reuse complete geometry validation, even if no transport will run.
    if (!['blocker', 'ideal-mirror', 'receiver-useful', 'receiver-unwanted'].includes(fixture.model))
      throw new RangeError('Unknown ideal fixture model');
    if (models.has(fixture.id)) throw new RangeError('Duplicate fixture triangle id');
    if (surfaces.has(fixture.surfaceId) && surfaces.get(fixture.surfaceId) !== fixture.model)
      throw new RangeError('Inconsistent model within surface');
    models.set(fixture.id, fixture.model); surfaces.set(fixture.surfaceId, fixture.model);
  }
  const power = ray.powerW === 0 ? 0 : ray.powerW;
  let eventCount = 0, pathMm = 0, originMm = [...ray.originMm], direction = initialDirection, previous = null;
  const finish = (reason, channel = 'unresolvedWatts') => ({emittedWatts:power,
    usefulWatts:channel === 'usefulWatts' ? power : 0, unwantedWatts:channel === 'unwantedWatts' ? power : 0,
    absorbedWatts:channel === 'absorbedWatts' ? power : 0, escapedWatts:0,
    unresolvedWatts:channel === 'unresolvedWatts' ? power : 0,
    eventCount, pathMm, reason, solverCertified:false, physicalQualified:false});
  if (power === 0) return finish('zero-power');
  while (eventCount < options.maxInteractions) {
    const remaining = options.maxPathMm - pathMm;
    if (!(remaining > 0)) return finish('path-limit');
    const segment = {originMm, direction, tMinMm:0, tMaxMm:remaining}, candidates = [];
    let uncertain = false, zeroContact = false;
    for (let i = 0; i < count; i++) {
      const fixture = fixtures[i], contact = intersectTriangle(segment, fixture);
      if (contact.status === 'uncertain') uncertain = true;
      if (contact.status === 'hit' && contact.distanceMm === 0) {
        const self = previous && contact.surfaceId === previous.surfaceId &&
          contact.geometricNormal.every((x, j) => Math.abs(x - previous.normal[j]) <= GEOMETRY_EPSILON);
        if (self) continue;
        zeroContact = true;
      }
      candidates.push(fixture);
    }
    if (uncertain) return finish('geometry-uncertain');
    if (zeroContact) return finish('zero-distance-contact');
    const hit = closestTriangle(segment, candidates);
    if (hit.status === 'uncertain') return finish('geometry-uncertain');
    if (hit.status === 'miss') {pathMm = options.maxPathMm; return finish('no-hit-within-budget');}
    const nextPath = pathMm + hit.distanceMm;
    if (!Number.isFinite(nextPath) || nextPath <= pathMm || nextPath > options.maxPathMm)
      return finish('path-arithmetic-uncertain');
    pathMm = nextPath; eventCount++;
    const model = models.get(hit.triangleId);
    if (model === 'blocker') return finish('blocker', 'absorbedWatts');
    if (model === 'receiver-useful') return finish(model, 'usefulWatts');
    if (model === 'receiver-unwanted') return finish(model, 'unwantedWatts');
    const normal = hit.frontFace ? hit.geometricNormal : hit.geometricNormal.map(x => -x);
    direction = interfaceResponse(direction, normal, 1, 1).reflected;
    originMm = hit.positionMm;
    previous = {surfaceId:hit.surfaceId, normal:hit.geometricNormal};
    if (pathMm === options.maxPathMm) return finish('path-limit');
  }
  return finish('interaction-limit');
}
