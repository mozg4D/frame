import test from 'node:test';
import assert from 'node:assert/strict';
import { createConductorGraph as graph, solveConductorCurrent as solve, toReferenceCurrentBasis as quadrature, CONDUCTOR_CURRENT_CAPABILITIES } from '../conductor-current.js';
import { createReferenceProblem } from '../reference-solver.js';
import { createMaterial } from '../materials.js';
const close = (actual, expected, tol = 2e-11) => assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const edge = (id, from, to, resistance = 1) => ({id, from, to, length: resistance, area: 1, conductivity: 1});
function ring() { return {units: 'SI', nodes: ['a', 'b', 'c'], edges: [edge('ab', 'a', 'b', 2), edge('bc', 'b', 'c', 3), edge('ca', 'c', 'a', 5)], cut: {edges: [{edgeId: 'ab', sign: 1}]}}; }
function parallel() { return {units: 'SI', nodes: ['s', 'a', 'b', 't'], edges: [edge('sa', 's', 'a'), edge('at', 'a', 't'), edge('sb', 's', 'b', 3), edge('bt', 'b', 't', 3), edge('ts', 't', 's', 4)], cut: {edges: [{edgeId: 'sa', sign: 1}, {edgeId: 'sb', sign: 1}]}}; }
const result = (input, current = 1) => solve(graph(input), {current});
function checkConservation(input, currents) {
  for (const n of input.nodes) close(input.edges.reduce((s, e, i) => s + (e.from === n ? -currents[i] : e.to === n ? currents[i] : 0), 0), 0);
}
const power = (input, q) => input.edges.reduce((s, e, i) => s + e.length / (e.area * e.conductivity) * q[i] ** 2, 0);

test('single closed ring: independent series resistance, unit flux and Joule dissipation', () => {
  const r = result(ring()); r.flux.forEach(v => close(v, 1)); close(r.effectiveResistance, 10); close(r.dissipatedPower, 10);
  checkConservation(ring(), r.flux); assert.equal(r.metrics.cycleRank, 1); assert.equal(r.metrics.components, 1);
});
test('two parallel paths: inverse-resistance current split and common return', () => {
  const p = parallel(), r = result(p, 2);
  [1.5, 1.5, .5, .5, 2].forEach((v, i) => close(r.flux[i], v));
  close(r.effectiveResistance, 4 + 1 / (1 / 2 + 1 / 6)); close(r.dissipatedPower, 22);
  close(r.averageCurrentDensity, 1); checkConservation(p, r.flux);
});
test('signed current, zero current and quadratic dissipation scaling', () => {
  const a = result(parallel()), b = result(parallel(), -7), zero = result(parallel(), 0);
  a.flux.forEach((v, i) => close(b.flux[i], -7 * v)); close(b.dissipatedPower, 49 * a.dissipatedPower);
  assert.ok(zero.flux.every(v => v === 0)); assert.equal(zero.dissipatedPower, 0); close(zero.unitFlux[0], .75);
});
test('minimum dissipation: independent constrained parallel-path perturbations', () => {
  const p = parallel(), r = result(p);
  for (const delta of [-2, -.3, -.01, .01, .3, 2]) {
    const q = r.flux.map((v, i) => v + delta * [1, 1, -1, -1, 0][i]);
    checkConservation(p, q); close(q[0] + q[2], 1);
    close(power(p, q) - power(p, r.flux), 8 * delta ** 2);
  }
  close(r.flux[0] * 2, r.flux[2] * 6); // Equal branch voltage drop, derived independently.
});
test('edge orientation reversal preserves physical currents and power', () => {
  const p = parallel(), base = result(p);
  [0, 3, 4].forEach(i => { const e = p.edges[i]; [e.from, e.to] = [e.to, e.from]; for (const c of p.cut.edges) if (c.edgeId === e.id) c.sign *= -1; });
  const r = result(p); base.flux.forEach((v, i) => close(r.flux[i], [0, 3, 4].includes(i) ? -v : v)); close(r.dissipatedPower, base.dissipatedPower);
});
test('cut reversal flips normalized current and equivalent cuts preserve the result', () => {
  const a = result(parallel()), b = parallel(), c = parallel();
  b.cut.edges.forEach(e => e.sign *= -1); c.cut.edges = [{edgeId: 'ts', sign: 1}];
  result(b).flux.forEach((v, i) => close(v, -a.flux[i])); result(c).flux.forEach((v, i) => close(v, a.flux[i]));
  close(result(c).averageCurrentDensity, 1); // New transverse cut area is one, versus two.
});
test('graph node/edge permutations do not alter currents', () => {
  const p = parallel(), a = result(p); p.nodes.reverse(); p.edges.reverse(); const b = result(p);
  a.edgeIds.forEach((id, i) => close(a.flux[i], b.flux[b.edgeIds.indexOf(id)]));
});
test('conductivity and geometric scale obey independent resistance and density laws', () => {
  const p = parallel(), a = result(p), conductivity = structuredClone(p), size = structuredClone(p);
  conductivity.edges.forEach(e => e.conductivity *= 7); size.edges.forEach(e => { e.length *= 3; e.area *= 9; });
  const b = result(conductivity), c = result(size);
  a.flux.forEach((v, i) => { close(v, b.flux[i]); close(v, c.flux[i]); });
  close(b.effectiveResistance, a.effectiveResistance / 7); close(c.effectiveResistance, a.effectiveResistance / 3);
  close(c.averageCurrentDensity, a.averageCurrentDensity / 9);
});
test('nonuniform areas yield face-average J = I/A, not a pointwise uniform cut boundary', () => {
  const p = parallel(); p.edges[0].area = 2; p.edges[0].length = 2; const r = result(p);
  close(r.cutArea, 3); close(r.averageCurrentDensity, 1 / 3); close(r.currentDensity[0], .75 / 2); close(r.currentDensity[2], .25);
  close(r.currentDensity[0] * 2 + r.currentDensity[2], 1);
});
test('dead-end branches, attached cycles and disconnected unforced components carry no current', () => {
  const p = ring(); p.nodes.push('d', 'e', 'x', 'y', 'z', 'isolated');
  p.edges.push(edge('ad', 'a', 'd'), edge('de', 'd', 'e'), edge('ea', 'e', 'a'), edge('xy', 'x', 'y'), edge('yz', 'y', 'z'), edge('zx', 'z', 'x'), edge('tail', 'e', 'isolated'));
  const r = result(p); r.flux.slice(3).forEach(v => close(v, 0)); assert.equal(r.metrics.components, 2); assert.equal(r.metrics.cycleRank, 3);
});
test('multi-component cuts fail closed rather than allocate current between independent conductors', () => {
  const p = ring(); p.edges.forEach(e => e.length = 1); p.nodes.push('x', 'y', 'z');
  p.edges.push(edge('xy', 'x', 'y', 2), edge('yz', 'y', 'z', 2), edge('zx', 'z', 'x', 2)); p.cut.edges.push({edgeId: 'xy', sign: 1});
  assert.throws(() => result(p), /disconnected conductors/);
});
test('parallel edges form a valid two-edge cycle without self loops', () => {
  const p = {units: 'SI', nodes: ['a', 'b'], edges: [edge('p', 'a', 'b', 2), edge('q', 'a', 'b', 3)], cut: {edges: [{edgeId: 'p', sign: 1}]}};
  const r = result(p); close(r.flux[0], 1); close(r.flux[1], -1); close(r.effectiveResistance, 5);
});
test('tree cuts, separating cuts and canceling cuts fail even for zero requested current', () => {
  const tree = ring(); tree.edges.pop();
  const separating = ring(); separating.cut.edges = [{edgeId: 'ab', sign: 1}, {edgeId: 'ca', sign: -1}];
  for (const p of [tree, separating]) { assert.throws(() => result(p), /Impossible cut/); assert.throws(() => result(p, 0), /Impossible cut/); }
});
test('cut multiplicity is explicit: crossing a cycle twice halves each edge current', () => {
  const p = ring(); p.cut.edges.push({edgeId: 'bc', sign: 1}); const r = result(p);
  r.flux.forEach(v => close(v, .5)); close(r.effectiveResistance, 2.5); close(r.cutArea, 2);
});
test('malformed topology and cut specifications fail closed', () => {
  const mutations = [p => p.nodes.push('a'), p => p.edges[1].id = 'ab', p => p.edges[0].to = 'missing', p => p.edges[0].to = 'a',
    p => p.cut.edges.push({edgeId: 'ab', sign: 1}), p => p.cut.edges[0].edgeId = 'missing', p => p.cut.edges[0].sign = 0,
    p => p.cut.edges = [], p => p.cut.edges = new Array(1), p => p.nodes = new Array(2), p => p.edges = new Array(3),
    p => p.boundaryOutflow = 1, p => p.edges[0].boundary = true, p => p.units = 'mm', p => p.cut.area = 4];
  for (const change of mutations) { const p = ring(); change(p); assert.throws(() => graph(p)); }
});
test('invalid scalar scales, capacities and unknown solver options fail closed', () => {
  for (const name of ['area', 'length', 'conductivity']) for (const v of [0, -1, NaN, Infinity, '1', undefined]) { const p = ring(); p.edges[0][name] = v; assert.throws(() => graph(p)); }
  const p = ring(); p.nodes = Array.from({length: 33}, (_, i) => String(i)); assert.throws(() => graph(p), /32/);
  const q = ring(); q.edges = Array.from({length: 65}, (_, i) => edge(String(i), 'a', 'b')); assert.throws(() => graph(q), /64/);
  const g = graph(ring()); assert.throws(() => solve(g, {current: Infinity})); assert.throws(() => solve(g, {tolerance: 1}));
  assert.equal(CONDUCTOR_CURRENT_CAPABILITIES.nativeGeometry, false);
});
test('common resistance scaling avoids overflow-prone intermediates', () => {
  const p = ring(); p.edges.forEach(e => { e.length = 1e200; e.area = 1e200; e.conductivity = 1e200; });
  const r = result(p); close(r.effectiveResistance / 3e-200, 1); r.flux.forEach(v => close(v, 1));
  const q = ring(); q.edges.forEach(e => { e.length *= 1e150; }); const s = result(q, 1e-50);
  close(s.effectiveResistance / 1e151, 1); close(s.dissipatedPower / 1e51, 1);
});
test('unsafe resistance contrast, overflowing/underflowing outputs are rejected', () => {
  const contrast = ring(); contrast.edges[0].conductivity = 1e20; assert.throws(() => graph(contrast), /dynamic range/);
  const hugeR = ring(); hugeR.edges[0].length = 1e308; hugeR.edges[0].area = 1e-308; assert.throws(() => graph(hugeR), /scale/);
  const smallR = ring(); smallR.edges[0].length = 1e-308; smallR.edges[0].conductivity = 1e308; assert.throws(() => graph(smallR), /scale/);
  assert.throws(() => result(ring(), 1e200), /scale/); assert.throws(() => result(ring(), 1e-200), /scale/);
});
test('graph and result ownership and nested immutability are enforced', () => {
  const input = ring(), g = graph(input), r = solve(g); input.edges[0].area = 9;
  assert.equal(g.edges[0].area, 1); assert.throws(() => { g.edges[0].area = 9; }); assert.throws(() => { r.flux[0] = 9; });
  assert.throws(() => solve({...g}), /createConductorGraph/); assert.throws(() => quadrature(g, {...r}, {id: 'b', objectId: 'o'}), /exact graph/);
  assert.throws(() => quadrature(graph(ring()), r, {id: 'b', objectId: 'o'}), /exact graph/);
});
function geometricRing() {
  const p = ring();
  [[1, 0, 0], [0, 1, 0], [-Math.SQRT1_2, -Math.SQRT1_2, 0]].forEach((v, i) => {
    p.edges[i].direction = v; p.edges[i].localPosition = [[.5, 0, 0], [1, .5, 0], [.5, .5, 0]][i];
  });
  p.edges[0].length = 1; p.edges[1].length = 1; p.edges[2].length = Math.SQRT2;
  return p;
}
test('explicit quadrature maps signed average J to J vector and J-volume integral', () => {
  const p = geometricRing(); p.edges[1].area = 2; const g = graph(p), s = solve(g, {current: -3}), b = quadrature(g, s, {id: 'loop', objectId: 'wire'});
  close(b.density, -3);
  b.samples.forEach((v, i) => { close(v.volume, p.edges[i].area * p.edges[i].length);
    v.basisDensity.forEach((d, k) => { close(b.density * d, s.flux[i] / p.edges[i].area * p.edges[i].direction[k]); close(b.density * d * v.volume, s.flux[i] * p.edges[i].length * p.edges[i].direction[k]); }); });
  // A closed straight-tube polygon has zero integrated vector current.
  for (let k = 0; k < 3; k++) close(b.samples.reduce((v, q) => v + b.density * q.basisDensity[k] * q.volume, 0), 0);
  const problem = createReferenceProblem({units: 'SI', materials: {m: createMaterial({kind: 'soft', saturationMagnetization: 1, reversibleSusceptibility: 1})}, objects: [{id: 'wire'}, {id: 'm'}], samples: [{id: 'm', objectId: 'm', materialId: 'm', localPosition: [0, 0, 2], volume: 1e-6}], currentBases: [b]});
  assert.equal(problem.currentBases[0].density, b.density);
});
test('quadrature orientation reversal preserves vector current', () => {
  const p = geometricRing(), g = graph(p), a = quadrature(g, solve(g), {id: 'b', objectId: 'o'});
  const e = p.edges[0]; [e.from, e.to] = [e.to, e.from]; e.direction = e.direction.map(v => -v); p.cut.edges[0].sign *= -1;
  const h = graph(p), b = quadrature(h, solve(h), {id: 'b', objectId: 'o'});
  a.samples.forEach((s, i) => s.basisDensity.forEach((v, k) => close(v * a.density, b.samples[i].basisDensity[k] * b.density)));
});
test('quadrature fails without complete explicit geometry, on bad directions or unrepresentable volumes', () => {
  const g = graph(ring()); assert.throws(() => quadrature(g, solve(g), {id: 'b', objectId: 'o'}), /explicit/);
  for (const direction of [[2, 0, 0], [0, 0, 0], [NaN, 0, 0], new Array(3)]) { const p = geometricRing(); p.edges[0].direction = direction; assert.throws(() => graph(p)); }
  const p = geometricRing(); delete p.edges[0].localPosition; assert.throws(() => graph(p));
  const q = geometricRing(); q.edges.forEach(e => { e.length = 1e200; e.area = 1e200; }); const h = graph(q); assert.throws(() => quadrature(h, solve(h), {id: 'b', objectId: 'o'}), /scale/);
});
test('completed bounded graph operations report timings at maximum capacity', () => {
  const nodes = Array.from({length: 32}, (_, i) => String(i));
  const edges = nodes.flatMap((n, i) => [edge('r' + i, n, nodes[(i + 1) % 32], 1 + i / 32), edge('c' + i, n, nodes[(i + 9) % 32], 2)]);
  const input = {units: 'SI', nodes, edges, cut: {edges: [{edgeId: 'r0', sign: 1}]}};
  const start = performance.now(); const g = graph(input), runs = Array.from({length: 12}, () => solve(g)); const wallMs = performance.now() - start;
  for (const r of runs) { assert.equal(r.metrics.cycleRank, 33); checkConservation(input, r.flux); assert.ok(Number.isFinite(r.metrics.wallMs) && r.metrics.wallMs >= 0); }
  const budgetMs = 3000; assert.ok(wallMs < budgetMs, `Completed graph operations exceeded ${budgetMs} ms CPU smoke budget`);
  console.log(JSON.stringify({operation: 'explicit-conductor-graph-create-and-12-completed-solves', nodes: 32, edges: 64, cycles: 33, completed: runs.length, wallMs, budgetMs, solveWallMs: runs.map(r => r.metrics.wallMs), scope: 'CPU_GRAPH_REFERENCE_ONLY'}));
});
