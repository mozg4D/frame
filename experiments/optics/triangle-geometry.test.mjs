import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {intersectTriangle as intersect, closestTriangle as closest, MAX_FIXTURE_TRIANGLES, GEOMETRY_EPSILON as EPS} from './triangle-geometry.mjs';
import {interfaceResponse} from './reference.mjs';

const close = (a, b, tolerance = 1e-11) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const ray = (originMm = [0.5, 0.5, 0], direction = [0, 0, 1], tMinMm = 0, tMaxMm = 100) => ({originMm, direction, tMinMm, tMaxMm});
const triangle = (id = 'triangle', z = 5, surfaceId = 'surface') => ({id, surfaceId, verticesMm:[[0, 0, z], [4, 0, z], [0, 4, z]]});
const quad = (id, x0, x1, y0, y1, z, surfaceId = 'frame') => [
  {id:id + 'a', surfaceId, verticesMm:[[x0, y0, z], [x1, y0, z], [x1, y1, z]]},
  {id:id + 'b', surfaceId, verticesMm:[[x0, y0, z], [x1, y1, z], [x0, y1, z]]}
];
const frame = () => [
  ...quad('bottom', -2, 2, -2, -0.5, 5), ...quad('top', -2, 2, 0.5, 2, 5),
  ...quad('left', -2, -0.5, -0.5, 0.5, 5), ...quad('right', 0.5, 2, -0.5, 0.5, 5)
];

test('analytic plane hit gives physical distance, position, barycentrics and winding normal', () => {
  const hit = intersect(ray(), triangle());
  assert.equal(hit.status, 'hit');
  assert.equal(hit.distanceMm, 5);
  assert.deepEqual(hit.positionMm, [0.5, 0.5, 5]);
  assert.deepEqual(hit.barycentric, [0.75, 0.125, 0.125]);
  assert.deepEqual(hit.geometricNormal, [0, 0, 1]);
  assert.equal(hit.frontFace, false);
  assert.equal(hit.triangleId, 'triangle'); assert.equal(hit.surfaceId, 'surface');
  assert.equal(intersect(ray([3, 3, 0]), triangle()).status, 'miss');
});

test('non-unit directions normalize to mm and explicit intervals have inclusive endpoints', () => {
  for (const direction of [[0, 0, 7], [0, 0, 1e308], [0, 0, Number.MIN_VALUE]])
    assert.equal(intersect(ray(undefined, direction), triangle()).distanceMm, 5);
  assert.equal(intersect(ray(undefined, undefined, 5, 5), triangle()).status, 'hit');
  assert.equal(intersect(ray(undefined, undefined, 5.1, 10), triangle()).status, 'miss');
  assert.equal(intersect(ray(undefined, undefined, 0, 4.9), triangle()).status, 'miss');
  assert.equal(intersect(ray(undefined, undefined, 0, 5 + EPS), triangle()).status, 'uncertain');
  assert.equal(intersect(ray([0.5, 0.5, 10], [0, 0, -2]), triangle()).distanceMm, 5);
  // A query interval miss says nothing about escape from a whole scene.
  assert.equal(intersect(ray(undefined, undefined, 0, 4), triangle()).status, 'miss');
  assert.equal(intersect(ray(undefined, undefined, 4, 6), triangle()).status, 'hit');
});

test('both sides hit and reversing winding changes normal/frontFace only', () => {
  const original = triangle(), reversed = {...original, verticesMm:[...original.verticesMm].reverse()};
  for (const r of [ray(), ray([0.5, 0.5, 10], [0, 0, -1])]) {
    const a = intersect(r, original), b = intersect(r, reversed);
    assert.equal(a.status, 'hit'); assert.equal(b.status, 'hit');
    assert.equal(a.distanceMm, b.distanceMm); assert.deepEqual(a.positionMm, b.positionMm);
    a.geometricNormal.forEach((x, i) => close(x, -b.geometricNormal[i]));
    assert.equal(a.frontFace, !b.frontFace);
  }
});

test('actual nearest triangle is independent of fixture order', () => {
  const fixtures = [triangle('far', 20, 'far'), triangle('near', 2, 'near'), triangle('middle', 9, 'middle')];
  for (const order of [fixtures, [...fixtures].reverse(), [fixtures[1], fixtures[0], fixtures[2]]]) {
    const hit = closest(ray(), order);
    assert.equal(hit.status, 'hit'); assert.equal(hit.triangleId, 'near'); assert.equal(hit.distanceMm, 2);
  }
  assert.deepEqual(closest(ray(), []), {status:'miss'});
});

test('equal and near-distance different surfaces remain ambiguous in either order', () => {
  for (const z of [5, 5 + EPS]) {
    const fixtures = [triangle('a', 5, 'first'), triangle('b', z, 'second')];
    for (const order of [fixtures, [...fixtures].reverse()])
      assert.deepEqual(closest(ray(), order), {status:'uncertain', reason:'ambiguous-nearest'});
  }
  // Same surface identity does not resolve distinct, nearly coincident planes.
  assert.equal(closest(ray(), [triangle('a'), triangle('b', 5 + EPS)]).status, 'uncertain');
});

test('exact compatible same-surface seams dedup deterministically; folded/reversed normals do not', () => {
  const seam = quad('square', -2, 2, -2, 2, 5);
  const r = ray([0, 0, 0]);
  for (const order of [seam, [...seam].reverse()]) {
    const hit = closest(r, order);
    assert.equal(hit.status, 'hit'); assert.equal(hit.triangleId, 'squarea');
  }
  const a = triangle('a'), reversed = {...triangle('b'), verticesMm:[...a.verticesMm].reverse()};
  const folded = {id:'folded', surfaceId:'surface', verticesMm:[[0, 0, 5], [0, 4, 5], [0, 0, 9]]};
  for (const order of [[a, reversed], [reversed, a]])
    assert.equal(closest(ray([0, 0, 0], [0.1, 0.1, 1]), order).status, 'uncertain');
  // A crease intersected on its common edge has incompatible normals.
  for (const order of [[a, folded], [folded, a]])
    assert.equal(closest(ray([-1, 0.5, 0], [1, 0, 5]), order).status, 'uncertain');
  // Approximate normal compatibility is non-transitive: the anchor must be fixed.
  const tilted = (id, slope) => ({id, surfaceId:'surface', verticesMm:[[0, 0, 5], [4, 0, 5 - 4 * slope], [0, 4, 5]]});
  const normals = [tilted('a', 0), tilted('b', 0.75 * EPS), tilted('c', 1.5 * EPS)];
  for (const order of [normals, [...normals].reverse(), [normals[1], normals[0], normals[2]]])
    assert.deepEqual(closest(ray([0, 0, 0]), order), {status:'uncertain', reason:'ambiguous-nearest'});
});

test('actual triangles preserve square hole in forward and reversed paths', () => {
  const fixtures = frame();
  for (const [originZ, dz] of [[0, 1], [10, -1]]) {
    assert.equal(closest(ray([0, 0, originZ], [0, 0, dz]), fixtures).status, 'miss');
    const hit = closest(ray([1, 0.1, originZ], [0, 0, dz]), fixtures);
    assert.equal(hit.status, 'hit'); assert.equal(hit.distanceMm, 5);
    assert.equal(hit.surfaceId, 'frame');
    close(hit.positionMm[0], 1); close(hit.positionMm[1], 0.1);
  }
});

test('exact edges and vertices are inclusive; numerically near edges never guarantee clear', () => {
  for (const p of [[0, 0, 0], [2, 2, 0], [0, 1, 0]])
    assert.equal(intersect(ray(p), triangle()).status, 'hit');
  for (const x of [-EPS, EPS]) assert.equal(intersect(ray([x, 1, 0]), triangle()).status, 'uncertain');
  assert.equal(intersect(ray([-0.001, 1, 0]), triangle()).status, 'miss');
});

test('coplanar/near-parallel/poorly-conditioned geometry and distant precision stay unresolved', () => {
  assert.equal(intersect(ray([1, 1, 5], [1, 0, 0]), triangle()).status, 'uncertain');
  assert.equal(intersect(ray([1, 1, 0], [1, 0, EPS / 2]), triangle()).status, 'uncertain');
  const skinny = {id:'skinny', surfaceId:'surface', verticesMm:[[0, 0, 5], [1, 0, 5], [1, 1e-16, 5]]};
  assert.equal(intersect(ray(), skinny).status, 'uncertain');
  const distant = {id:'distant', surfaceId:'surface', verticesMm:[[1e12, 0, 5], [1e12 + 4, 0, 5], [1e12, 4, 5]]};
  assert.equal(intersect(ray([1e12 + 0.5, 0.5, 0]), distant).status, 'uncertain');
  const parallel = {id:'parallel', surfaceId:'other', verticesMm:[[0, 0, 0], [0, 4, 0], [0, 0, 4]]};
  const fixtures = [triangle(), parallel];
  assert.deepEqual(closest(ray(), fixtures), closest(ray(), [...fixtures].reverse()));
  assert.equal(closest(ray(), fixtures).status, 'uncertain');
});

test('invalid, degenerate, overflow and excessive fixtures reject without partial success', () => {
  for (const bad of [[0, 0, 0], [NaN, 0, 1], [Infinity, 0, 1], [0, 1], new Array(3)])
    assert.throws(() => intersect(ray(undefined, bad), triangle()));
  for (const [min, max] of [[-1, 10], [2, 1], [0, Infinity], [NaN, 10], ['0', 10]])
    assert.throws(() => intersect(ray(undefined, undefined, min, max), triangle()));
  for (const verticesMm of [[[0, 0, 5], [1, 0, 5], [2, 0, 5]], [[0, 0, 5], [0, 0, 5], [0, 0, 5]],
    [[-1e308, 0, 0], [1e308, 0, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [0, NaN, 0]]])
    assert.throws(() => intersect(ray(), {...triangle(), verticesMm}));
  assert.throws(() => intersect(ray([0, 0, -Number.MAX_VALUE]), triangle('huge', Number.MAX_VALUE)));
  for (const key of ['id', 'surfaceId']) for (const value of ['', null, 'x'.repeat(129)])
    assert.throws(() => intersect(ray(), {...triangle(), [key]:value}));
  assert.throws(() => closest(ray(), [triangle(), triangle()]));
  assert.throws(() => closest(ray(), new Array(MAX_FIXTURE_TRIANGLES + 1)));
  assert.throws(() => closest(ray(), [triangle(), null]));
});

test('seeded constructed interior hits match independent position/barycentric/normal oracle', t => {
  let seed = 20261109, maxPositionError = 0;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let sample = 0; sample < 2000; sample++) {
    const theta = random() * 2 * Math.PI, phi = (random() - 0.5) * Math.PI;
    const e1 = [Math.cos(theta), Math.sin(theta), 0];
    const e2 = [-Math.sin(theta) * Math.cos(phi), Math.cos(theta) * Math.cos(phi), Math.sin(phi)];
    const n = [Math.sin(theta) * Math.sin(phi), -Math.cos(theta) * Math.sin(phi), Math.cos(phi)];
    const a = [random() * 20, random() * 20, random() * 20], u = 0.1 + 0.3 * random(), v = 0.1 + 0.3 * random();
    const expected = a.map((x, i) => x + 4 * u * e1[i] + 3 * v * e2[i]), distance = 1 + 10 * random();
    const origin = expected.map((x, i) => x - distance * n[i]);
    const fixture = {id:'constructed', surfaceId:'plane', verticesMm:[a, a.map((x, i) => x + 4 * e1[i]), a.map((x, i) => x + 3 * e2[i])]};
    const hit = intersect(ray(origin, n), fixture);
    assert.equal(hit.status, 'hit'); close(hit.distanceMm, distance);
    hit.barycentric.forEach((x, i) => close(x, [1 - u - v, u, v][i]));
    hit.geometricNormal.forEach((x, i) => close(x, n[i]));
    hit.positionMm.forEach((x, i) => {close(x, expected[i]); maxPositionError = Math.max(maxPositionError, Math.abs(x - expected[i]));});
  }
  t.diagnostic(`2000 seeded interior hits: maximum position error ${maxPositionError.toExponential(4)} mm`);
});

test('new nearest query after dielectric reflection can return to an earlier plane', () => {
  const earlier = triangle('earlier', 2, 'receiver'), mirror = triangle('mirror', 5, 'mirror');
  const initial = ray([0.5, 0.5, 3]);
  const first = closest(initial, [earlier, mirror]);
  assert.equal(first.status, 'hit'); assert.equal(first.triangleId, 'mirror');
  const oriented = first.geometricNormal.map(x => -x);
  const boundary = interfaceResponse(initial.direction, oriented, 1, 1.5);
  close(boundary.reflectance, 0.04); // Only this nonzero branch returns; not a 100% ideal mirror.
  const reflected = boundary.reflected;
  // Explicit tMin is caller policy, not an internal origin displacement.
  const second = closest(ray(first.positionMm, reflected, 0.001), [mirror, earlier]);
  assert.equal(second.status, 'hit'); assert.equal(second.triangleId, 'earlier'); assert.equal(second.distanceMm, 3);
});

test('synthetic Blocker accounting absorbs only an actual frame hit; hole power is unresolved', () => {
  const fixtures = frame(), watts = 3;
  const frameHit = closest(ray([1, 0.1, 0]), fixtures), hole = closest(ray([0, 0, 0]), fixtures);
  const absorbFixtureOnly = result => result.status === 'hit' ? {absorbed:watts, unresolved:0} : {absorbed:0, unresolved:watts};
  assert.deepEqual(absorbFixtureOnly(frameHit), {absorbed:3, unresolved:0});
  assert.deepEqual(absorbFixtureOnly(hole), {absorbed:0, unresolved:3});
});

test('100000 completed streaming small-fixture nearest queries fit CPU budget', t => {
  const fixtures = frame(), count = 100000;
  let hits = 0, misses = 0, checksum = 0;
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const result = closest(ray(i % 2 ? [1, 0.1, 0] : [0, 0, 0]), fixtures);
    if (result.status === 'hit') {hits++; checksum += result.distanceMm;}
    else if (result.status === 'miss') misses++;
    else assert.fail('Well-conditioned benchmark fixture became uncertain');
  }
  const elapsed = performance.now() - start;
  assert.equal(hits, count / 2); assert.equal(misses, count / 2); assert.equal(checksum, 250000);
  assert.ok(elapsed < 5000, `100000 completed queries exceed 5 seconds: ${elapsed} ms`);
  t.diagnostic(`100000 completed nearest queries x 8 actual triangles: ${elapsed.toFixed(2)} ms; hits=${hits}, misses=${misses}`);
});
