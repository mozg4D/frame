import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {traceFixtureRay as trace} from './fixture-transport.mjs';
import {sampleRectangleSource} from './source-sampling.mjs';
import {evaluatePowerLedger} from '../../plugins/optics/validation/power-ledger.js';
import {GEOMETRY_EPSILON as EPS} from './triangle-geometry.mjs';

const ray = (originMm = [0.5, 0.25, 0], direction = [0, 0, 1], powerW = 8) => ({originMm, direction, powerW});
const limits = (maxInteractions = 8, maxPathMm = 100) => ({maxInteractions, maxPathMm});
const plane = (id, z, model = 'blocker', surfaceId = id) => ({id, surfaceId, model, verticesMm:[[-4, -4, z], [8, -4, z], [-4, 8, z]]});
const quad = (id, x0, x1, y0, y1, z, model = 'blocker') => [
  {id:id + 'a', surfaceId:'frame', model, verticesMm:[[x0, y0, z], [x1, y0, z], [x1, y1, z]]},
  {id:id + 'b', surfaceId:'frame', model, verticesMm:[[x0, y0, z], [x1, y1, z], [x0, y1, z]]}
];
const frame = () => [...quad('bottom', -2, 2, -2, -0.5, 5), ...quad('top', -2, 2, 0.5, 2, 5),
  ...quad('left', -2, -0.5, -0.5, 0.5, 5), ...quad('right', 0.5, 2, -0.5, 0.5, 5)];
const channels = ['usefulWatts', 'unwantedWatts', 'absorbedWatts', 'escapedWatts', 'unresolvedWatts'];
const conserved = (result, power = 8) => {
  assert.equal(result.emittedWatts, power);
  assert.equal(channels.reduce((sum, key) => sum + result[key], 0), power);
  assert.equal(result.escapedWatts, 0);
  assert.equal(result.solverCertified, false); assert.equal(result.physicalQualified, false);
  if (power > 0) assert.equal(channels.filter(key => result[key] > 0).length, 1);
};

test('direct useful and unwanted receivers terminate with all original watts and physical distance', () => {
  for (const model of ['receiver-useful', 'receiver-unwanted']) {
    const result = trace(ray(undefined, [0, 0, 7]), [plane('receiver', 5, model)], limits());
    conserved(result);
    assert.equal(result.reason, model); assert.equal(result.eventCount, 1); assert.equal(result.pathMm, 5);
    assert.equal(result[model === 'receiver-useful' ? 'usefulWatts' : 'unwantedWatts'], 8);
  }
});

test('opaque blocker absorbs front and back actual triangle hits', () => {
  for (const r of [ray(), ray([0.5, 0.25, 10], [0, 0, -1])]) {
    const result = trace(r, [plane('blocker', 5)], limits());
    conserved(result); assert.equal(result.absorbedWatts, 8); assert.equal(result.pathMm, 5);
    assert.equal(result.reason, 'blocker');
  }
});

test('real square hole remains unresolved while its opaque frame absorbs in either direction', () => {
  const fixtures = frame();
  for (const [z, dz] of [[0, 1], [10, -1]]) {
    const throughHole = trace(ray([0, 0, z], [0, 0, dz]), fixtures, limits(8, 20));
    conserved(throughHole); assert.equal(throughHole.unresolvedWatts, 8); assert.equal(throughHole.absorbedWatts, 0);
    assert.equal(throughHole.reason, 'no-hit-within-budget'); assert.equal(throughHole.pathMm, 20);
    const blocked = trace(ray([1, 0.1, z], [0, 0, dz]), fixtures, limits());
    conserved(blocked); assert.equal(blocked.absorbedWatts, 8); assert.equal(blocked.eventCount, 1);
  }
});

test('ideal mirror returns full watts to earlier receiver independently of fixture order', t => {
  const fixtures = [plane('earlier', 2, 'receiver-useful'), plane('mirror', 5, 'ideal-mirror')];
  const r = ray([0.5, 0.25, 3]);
  const expected = trace(r, fixtures, limits());
  conserved(expected); assert.equal(expected.usefulWatts, 8);
  assert.equal(expected.eventCount, 2); assert.equal(expected.pathMm, 5);
  assert.deepEqual(trace(r, [...fixtures].reverse(), limits()), expected);
  t.diagnostic(`analytic ideal-mirror return: ${expected.pathMm} mm, ${expected.eventCount} events, ${expected.usefulWatts} useful W`);
});

test('UNQUALIFIED oblique routing: initially parallel receiver makes whole query uncertain', t => {
  // Exact geometry would reflect +Z at (0,0,5) toward -X, then reach x=-3.
  // The inherited kernel conservatively marks the initially parallel receiver
  // uncertain even though it is not coplanar. This is a known qualification
  // blocker for generic oblique routing, not a successful optical path test.
  const fixtures = [
    {id:'oblique-mirror', surfaceId:'mirror', model:'ideal-mirror',
      verticesMm:[[-10, -10, 15], [10, -10, -5], [0, 10, 5]]},
    {id:'side-receiver', surfaceId:'receiver', model:'receiver-useful',
      verticesMm:[[-3, -10, 0], [-3, 10, 0], [-3, 0, 10]]}
  ];
  const result = trace(ray([0, 0, 0]), fixtures, limits());
  conserved(result);
  assert.equal(result.reason, 'geometry-uncertain');
  assert.equal(result.eventCount, 0); assert.equal(result.pathMm, 0);
  assert.equal(result.unresolvedWatts, 8); assert.equal(result.usefulWatts, 0);
  t.diagnostic('UNQUALIFIED 90-degree routing: initially parallel receiver blocks query; 0 events, 8 unresolved W, 0 useful W');
});

test('opposite mirror planes with SAME surface id recur at positive distance and stay bounded', t => {
  const fixtures = [plane('lower', 0, 'ideal-mirror', 'cavity'), plane('upper', 10, 'ideal-mirror', 'cavity')];
  const result = trace(ray([0.5, 0.25, 5]), fixtures, limits(64, 10000));
  conserved(result); assert.equal(result.unresolvedWatts, 8);
  assert.equal(result.eventCount, 64); assert.equal(result.pathMm, 635); assert.equal(result.reason, 'interaction-limit');
  const short = trace(ray([0.5, 0.25, 5]), fixtures, limits(64, 23));
  conserved(short); assert.equal(short.eventCount, 2); assert.equal(short.pathMm, 23);
  assert.equal(short.reason, 'no-hit-within-budget');
  t.diagnostic(`analytic same-surface mirror cavity: ${result.pathMm} mm, ${result.eventCount} events, ${result.unresolvedWatts} unresolved W`);
});

test('finite no-hit and exhausted path budgets remain unresolved, never escaped', () => {
  for (const fixtures of [[], [plane('outside-budget', 50)]]) {
    const result = trace(ray(), fixtures, limits(8, 10));
    conserved(result); assert.equal(result.reason, 'no-hit-within-budget');
    assert.equal(result.unresolvedWatts, 8); assert.equal(result.pathMm, 10); assert.equal(result.eventCount, 0);
  }
  const endpointMirror = trace(ray(), [plane('mirror', 5, 'ideal-mirror')], limits(8, 5));
  conserved(endpointMirror); assert.equal(endpointMirror.reason, 'path-limit'); assert.equal(endpointMirror.pathMm, 5);
  const endpointReceiver = trace(ray(), [plane('receiver', 5, 'receiver-useful')], limits(8, 5));
  assert.equal(endpointReceiver.usefulWatts, 8);
});

test('exact compatible current-plane seams suppress only self contact without an origin gap', () => {
  const mirror = quad('mirror', -2, 2, -2, 2, 5, 'ideal-mirror');
  const receiver = plane('return', 2, 'receiver-useful');
  const result = trace(ray([0, 0, 3]), [...mirror, receiver], limits());
  conserved(result); assert.equal(result.usefulWatts, 8); assert.equal(result.eventCount, 2); assert.equal(result.pathMm, 5);
  // A receiver one micrometre behind the bounce must not disappear into a tMin gap.
  const closeReceiver = plane('close', 4.999, 'receiver-useful');
  const closeResult = trace(ray([0.5, 0.25, 4.9995]), [plane('mirror', 5, 'ideal-mirror'), closeReceiver], limits());
  conserved(closeResult); assert.equal(closeResult.usefulWatts, 8); assert.equal(closeResult.eventCount, 2);
  const tinyGap = trace(ray(), [plane('nearby', 1e-10)], limits());
  conserved(tinyGap); assert.equal(tinyGap.absorbedWatts, 8); assert.equal(tinyGap.pathMm, 1e-10);
  // Start between an actual mirror and its nearby blocker: the second event
  // must survive exact self-contact suppression after the reflected return.
  const reflectedTinyGap = trace(ray([0.5, 0.25, 5 - 0.5e-10]),
    [plane('tiny-gap-mirror', 5, 'ideal-mirror'), plane('tiny-gap-blocker', 5 - 1e-10)], limits());
  conserved(reflectedTinyGap);
  assert.equal(reflectedTinyGap.absorbedWatts, 8);
  assert.equal(reflectedTinyGap.eventCount, 2);
  assert.equal(reflectedTinyGap.reason, 'blocker');
});

test('initial, different-surface, incompatible or uncertain contacts cannot become terminal power', () => {
  const contact = trace(ray([0.5, 0.25, 5]), [plane('at-origin', 5)], limits());
  conserved(contact); assert.equal(contact.reason, 'zero-distance-contact'); assert.equal(contact.eventCount, 0);
  const a = plane('a', 5, 'ideal-mirror'), b = plane('b', 5, 'blocker');
  const ambiguous = trace(ray(), [a, b], limits());
  conserved(ambiguous); assert.equal(ambiguous.reason, 'geometry-uncertain'); assert.equal(ambiguous.absorbedWatts, 0);
  const reversed = {...a, id:'reversed', verticesMm:[...a.verticesMm].reverse()};
  const incompatible = trace(ray(), [a, reversed], limits());
  assert.equal(incompatible.reason, 'geometry-uncertain'); assert.equal(incompatible.unresolvedWatts, 8);
  const nearZero = trace(ray([0.5, 0.25, 5 - EPS]), [plane('near-origin', 5)], limits());
  assert.equal(nearZero.reason, 'geometry-uncertain'); assert.equal(nearZero.absorbedWatts, 0);
  const coplanar = trace(ray([0.5, 0.25, 5], [1, 0, 0]), [a], limits());
  assert.equal(coplanar.reason, 'geometry-uncertain');
});

test('zero power and zero interactions validate first and preserve exact accounting', () => {
  const zero = trace(ray(undefined, undefined, -0), [plane('valid', 5)], limits());
  conserved(zero, 0); assert.equal(zero.reason, 'zero-power'); assert.equal(zero.eventCount, 0); assert.equal(zero.pathMm, 0);
  const limited = trace(ray(), [plane('valid', 5)], limits(0));
  conserved(limited); assert.equal(limited.unresolvedWatts, 8); assert.equal(limited.eventCount, 0);
  assert.equal(limited.pathMm, 0); assert.equal(limited.reason, 'interaction-limit');
});

test('every model and geometry validates before early terminal or empty-power result', () => {
  for (const r of [ray(), ray(undefined, undefined, 0)]) for (const maxInteractions of [0, 8]) {
    const valid = plane('first', 1), later = plane('later', 10);
    for (const invalid of [{...later, model:'dielectric'}, {...later, verticesMm:[[0, 0, 0], [1, 0, 0], [2, 0, 0]]},
      {...later, verticesMm:[[0, 0, 0], [1, 0, 0], [0, Infinity, 0]]}, {...later, id:'first'},
      {...later, surfaceId:'first', model:'receiver-useful'}])
      assert.throws(() => trace(r, [valid, invalid], limits(maxInteractions)));
  }
  for (const powerW of [-1, NaN, Infinity, '1', null]) assert.throws(() => trace(ray(undefined, undefined, powerW), [], limits()));
  for (const direction of [[0, 0, 0], new Array(3), [0, 0, NaN]])
    for (const power of [0, 8]) for (const events of [0, 8])
      assert.throws(() => trace(ray(undefined, direction, power), [], limits(events)));
  for (const options of [limits(-1), limits(65), limits(0.5), limits(1, 0), limits(1, Infinity), null])
    assert.throws(() => trace(ray(), [], options));
  assert.throws(() => trace(ray(), new Array(257), limits()));
});

test('streamed source sample-count refinement keeps fixed total power and matches separate ledger', t => {
  const source = {widthMm:2, heightMm:2, wavelengthNm:550, powerW:8, distribution:'collimated'};
  const receiver = [plane('receiver', 5, 'receiver-useful')];
  for (const count of [1, 16, 256]) {
    let usefulWatts = 0;
    for (let i = 0; i < count; i++) {
      const emission = sampleRectangleSource(source, count, {areaU:(i + 0.5) / count, areaV:0.37, directionU:0.23, directionV:0.81});
      const result = trace(emission, receiver, limits());
      conserved(result, source.powerW / count); usefulWatts += result.usefulWatts;
    }
    assert.equal(usefulWatts, 8);
    const hash = '1'.repeat(32);
    const ledger = evaluatePowerLedger({sources:[{hash, emittedWatts:8}], terminals:[{sourceHash:hash, usefulWatts,
      unwantedWatts:0, absorbedWatts:0, escapedWatts:0, unresolvedWatts:0}], tolerance:{absoluteWatts:0, relative:0}});
    assert.equal(ledger.balanced, true); assert.equal(ledger.physicalQualified, false); assert.equal(ledger.solverCertified, false);
    t.diagnostic(`source N=${count}: emitted=8 W, useful=${usefulWatts} W, ledger residual=${ledger.totals.residualWatts} W`);
  }
});

test('passive inputs are reproducible and outputs remain compact independent of interaction limit', () => {
  const r = ray(), fixtures = [plane('receiver', 5, 'receiver-useful')];
  Object.freeze(r.originMm); Object.freeze(r.direction); Object.freeze(r);
  fixtures[0].verticesMm.forEach(Object.freeze); Object.freeze(fixtures[0].verticesMm); Object.freeze(fixtures[0]); Object.freeze(fixtures);
  const result = trace(r, fixtures, limits(2));
  assert.deepEqual(trace(r, fixtures, limits(64)), result);
  assert.equal(Object.keys(result).length, 11);
  assert.ok(Object.values(result).every(value => !Array.isArray(value) && (typeof value !== 'object' || value === null)));
});

test('10000 completed eight-triangle traces preserve power inside CPU budget', t => {
  const fixtures = frame(), count = 10000;
  let absorbed = 0, unresolved = 0, path = 0;
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const result = trace(ray(i % 2 ? [1, 0.1, 0] : [0, 0, 0], [0, 0, 1], 3), fixtures, limits(8, 20));
    conserved(result, 3); absorbed += result.absorbedWatts; unresolved += result.unresolvedWatts; path += result.pathMm;
  }
  const elapsed = performance.now() - start;
  assert.equal(absorbed, 15000); assert.equal(unresolved, 15000); assert.equal(path, 125000);
  assert.ok(elapsed < 5000, `10000 completed traces exceed 5 seconds: ${elapsed} ms`);
  t.diagnostic(`10000 completed traces x 8 actual triangles incl validation/accounting: ${elapsed.toFixed(2)} ms`);
});
