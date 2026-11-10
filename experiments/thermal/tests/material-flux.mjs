import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {snapshotMaterialStorage} from '../material-storage.js';
import {accountMaterialFluxes} from '../material-flux.js';
const mat = {densityKgPerM3: 1, points: [0, 100].map(temperatureCelsius =>
  ({temperatureCelsius, specificHeatJPerKgK: 1, conductivityWPerMK: 1}))};
const plan = (count = 2) => snapshotMaterialStorage({materials: [mat], cells: Array.from({length: count}, () =>
  ({materialIndex: 0, volumeM3: 1, temperatureCelsius: 20}))});
const face = (faceId = 0, cellA = 0, cellB = 1, energyJ = 10) => ({faceId, cellA, cellB, energyJ});
const input = () => ({temperaturesCelsius: [10, 30], sourceEnergyJ: [0, 0], internalFaces: [face()], boundaryFaces: []});
const code = c => e => e.code === c;

test('one internal transfer is counted once and conserves cell/global energy', () => {
  const report = accountMaterialFluxes(plan(), input());
  assert.deepEqual(report.internalNetOutJ, [10, -10]);
  assert.equal(report.grossInternalTransferJ, 10);
  assert.equal(report.storage.absoluteCellResidualJ, 0);
  assert.equal(report.globalResidualJ, 0);
  assert.equal(report.internalAssemblyResidualJ, 0);
  assert.equal(report.cellToGlobalResidualDifferenceJ, 0);
  assert.equal(report.exteriorEnergyOutJ, 0);
  for (const key of ['solverReady', 'currentnessCertified', 'completePhysicalScene']) assert.equal(report[key], false);
});

test('orientation reversal with signed energy preserves identical accounting', () => {
  const value = input(); value.internalFaces = [face(0, 1, 0, -10)];
  const reversed = accountMaterialFluxes(plan(), value), forward = accountMaterialFluxes(plan(), input());
  assert.deepEqual(reversed.storage, forward.storage);
  assert.deepEqual(reversed.internalNetOutJ, forward.internalNetOutJ);
});

test('external heating and cooling plus internal transfers have correct signs', () => {
  const report = accountMaterialFluxes(plan(), {temperaturesCelsius: [25, 30], sourceEnergyJ: [20, 0],
    internalFaces: [face(0, 0, 1, 10)], boundaryFaces: [{faceId: 1, cell: 0, energyOutJ: 5}]});
  assert.equal(report.storage.storageEnergyJ, 15);
  assert.equal(report.exteriorEnergyOutJ, 5);
  assert.deepEqual(report.totalNetOutJ, [15, -10]);
  assert.equal(report.storage.absoluteCellResidualJ, 0);
  assert.equal(report.globalResidualJ, 0);
  const incoming = accountMaterialFluxes(plan(1), {temperaturesCelsius: [30], sourceEnergyJ: [0], internalFaces: [],
    boundaryFaces: [{faceId: 0, cell: 0, energyOutJ: -10}]});
  assert.equal(incoming.globalResidualJ, 0);
});

test('local equations expose wrong or absent face energies even when totals cancel', () => {
  for (const faces of [[], [face(0, 0, 1, -10)]]) {
    const value = input(); value.internalFaces = faces;
    const report = accountMaterialFluxes(plan(), value);
    assert.equal(report.globalResidualJ, 0);
    assert.ok(report.storage.absoluteCellResidualJ >= 20);
  }
});

test('different faces between the same cells remain distinct while duplicate identities reject', () => {
  const value = input(); value.internalFaces = [face(0, 0, 1, 4), face(1, 0, 1, 6)];
  assert.equal(accountMaterialFluxes(plan(), value).storage.absoluteCellResidualJ, 0);
  for (const faces of [[face(), face()], [face(), face(0, 1, 0, -10)]]) {
    value.internalFaces = faces;
    assert.throws(() => accountMaterialFluxes(plan(), value), code('INVALID_ARGUMENT'));
  }
  value.internalFaces = [face()]; value.boundaryFaces = [{faceId: 0, cell: 0, energyOutJ: 0}];
  assert.throws(() => accountMaterialFluxes(plan(), value), code('INVALID_ARGUMENT'));
});

test('wrong references, self faces and nonnormal energies reject', () => {
  for (const invalid of [face(-1), face(.5), face(Number.MAX_SAFE_INTEGER + 1), face(0, 0, 0),
    face(0, -1, 1), face(0, 0, 2), face(0, 0, .5), face(0, 0, 1, Infinity), face(0, 0, 1, Number.MIN_VALUE)]) {
    const value = input(); value.internalFaces = [invalid];
    assert.throws(() => accountMaterialFluxes(plan(), value), code('INVALID_ARGUMENT'));
  }
  for (const invalid of [{faceId: 1, cell: 2, energyOutJ: 0}, {faceId: 1, cell: 0, energyOutJ: NaN}]) {
    const value = input(); value.boundaryFaces = [invalid];
    assert.throws(() => accountMaterialFluxes(plan(), value), code('INVALID_ARGUMENT'));
  }
});

test('strict data arrays, accessor rejection and snapshot branding are preserved', () => {
  let calls = 0; const getter = {enumerable: true, get() { calls++; throw Error('callback'); }};
  const a = input(); Object.defineProperty(a.internalFaces[0], 'energyJ', getter);
  const b = input(); Object.defineProperty(b.internalFaces, '0', getter);
  const c = input(); c.internalFaces[0].powerW = 10;
  const d = input(); delete d.internalFaces[0];
  for (const value of [a, b, c, d, Object.create(input())])
    assert.throws(() => accountMaterialFluxes(plan(), value), code('INVALID_ARGUMENT'));
  const badPlan = {}; Object.defineProperty(badPlan, 'cells', getter);
  assert.throws(() => accountMaterialFluxes(badPlan, input()), code('INVALID_ARGUMENT'));
  assert.throws(() => accountMaterialFluxes({...plan()}, input()), code('INVALID_ARGUMENT'));
  assert.equal(calls, 0);
});

test('returned ledger is frozen and detached from authored input', () => {
  const value = input(), report = accountMaterialFluxes(plan(), value);
  value.internalFaces[0].energyJ = 1;
  assert.equal(report.internalFaces[0].energyJ, 10);
  for (const x of [report, report.internalFaces, report.internalFaces[0], report.boundaryFaces,
    report.internalNetOutJ, report.exteriorNetOutJ, report.totalNetOutJ]) assert.ok(Object.isFrozen(x));
});

test('per-cell assembly loss is reported independently from global physical balance', () => {
  const report = accountMaterialFluxes(plan(4), {temperaturesCelsius: [20, 20, 20, 20], sourceEnergyJ: [0, 0, 0, 0],
    internalFaces: [face(0, 0, 1, 1e20), face(1, 0, 2, 1), face(2, 0, 3, -1e20)], boundaryFaces: []});
  assert.equal(report.internalNetOutJ[0], 1);
  // Compensated summation retains the unit transfer despite much larger peers.
  assert.equal(report.internalAssemblyResidualJ, 0);
  assert.equal(report.globalResidualJ, 0);
  assert.ok(report.storage.absoluteCellResidualJ >= 2e20);
});

test('overflow of gross transfer or assembled cell outflow is rejected', () => {
  for (const energies of [[1e308, 1e308], [1e308, -1e308]]) {
    const value = input(); value.internalFaces = energies.map((e, i) => face(i, 0, 1, e));
    assert.throws(() => accountMaterialFluxes(plan(), value), code('NUMERICAL_RANGE'));
  }
});

test('rounded per-cell assembly discrepancy remains visible beside a zero local residual', () => {
  const report = accountMaterialFluxes(plan(3), {temperaturesCelsius: [20, 20, 20],
    sourceEnergyJ: [1e16, -1e16, -1], internalFaces: [face(0, 0, 1, 1e16), face(1, 0, 2, 1)], boundaryFaces: []});
  assert.deepEqual(report.internalNetOutJ, [1e16, -1e16, -1]);
  assert.equal(report.storage.absoluteCellResidualJ, 0);
  assert.equal(report.internalAssemblyResidualJ, -1);
  assert.equal(report.globalResidualJ, 1);
  assert.equal(report.cellToGlobalResidualDifferenceJ, -1);
});

test('variable-cp enthalpy is reused instead of a parallel storage formula', () => {
  const materials = [{densityKgPerM3: 1, points: [0, 100].map(temperatureCelsius =>
    ({temperatureCelsius, specificHeatJPerKgK: 1 + temperatureCelsius, conductivityWPerMK: 1}))}];
  const p = snapshotMaterialStorage({materials, cells: [{materialIndex: 0, volumeM3: 1, temperatureCelsius: 0}]});
  const report = accountMaterialFluxes(p, {temperaturesCelsius: [10], sourceEnergyJ: [60], internalFaces: [], boundaryFaces: []});
  assert.ok(Math.abs(report.storage.storageEnergyJ - 60) <= 16 * Number.EPSILON * 60);
  assert.ok(Math.abs(report.globalResidualJ) <= 16 * Number.EPSILON * 60);
});

test('4096 cells and 8190 explicit faces finish within a bounded CPU budget', t => {
  const p = plan(4096), value = {temperaturesCelsius: Array(4096).fill(20), sourceEnergyJ: Array(4096).fill(0),
    internalFaces: [], boundaryFaces: []};
  for (let i = 0; i < 4095; i++) value.internalFaces.push(face(i, i, i + 1, 1));
  for (let i = 0; i < 4095; i++) value.internalFaces.push(face(4095 + i, i, i + 1, -1));
  const start = performance.now(), report = accountMaterialFluxes(p, value), elapsedMs = performance.now() - start;
  assert.equal(report.storage.absoluteCellResidualJ, 0); assert.equal(report.grossInternalTransferJ, 8190);
  assert.ok(elapsedMs < 1000, `${elapsedMs} ms exceeds 1000 ms`);
  t.diagnostic(JSON.stringify({cells: 4096, faces: 8190, elapsedMs, CPUOnly: true}));
});
