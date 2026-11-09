import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {snapshotMaterialStorage, accountMaterialStorage} from '../material-storage.js';
const material = (rho = 2700, cp0 = 900, cp1 = cp0) => ({densityKgPerM3: rho,
  points: [{temperatureCelsius: 0, specificHeatJPerKgK: cp0, conductivityWPerMK: 200},
    {temperatureCelsius: 100, specificHeatJPerKgK: cp1, conductivityWPerMK: 300}]});
const cell = (volumeM3 = 4e-6, materialIndex = 0, temperatureCelsius = 20) =>
  ({volumeM3, materialIndex, temperatureCelsius});
const input = () => ({materials: [material()], cells: [cell()]});
const state = (temperaturesCelsius = [30], sourceEnergyJ = [97.2], boundaryEnergyOutJ = [0]) =>
  ({temperaturesCelsius, sourceEnergyJ, boundaryEnergyOutJ});
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const code = c => e => e.code === c;

test('explicit mm-to-SI analytic body accounts mass, capacity and source only once', () => {
  const plan = snapshotMaterialStorage(input());
  near(plan.cells[0].massKg, .0108);
  near(plan.cells[0].initialHeatCapacityJPerK, 9.72);
  const result = accountMaterialStorage(plan, state());
  near(result.storageEnergyJ, 97.2); near(result.residualJ, 0);
  assert.equal(plan.temperatureDependentSpecificHeat, false);
  for (const x of [plan, result]) {
    assert.equal(x.solverReady, false); assert.equal(x.currentnessCertified, false);
    assert.equal(x.completePhysicalScene, false);
  }
});

test('variable cp integrates true enthalpy instead of freezing endpoint capacity', () => {
  const plan = snapshotMaterialStorage({materials: [material(1, 500, 700)], cells: [cell(2, 0, 20)]});
  const result = accountMaterialStorage(plan, state([80], [72000]));
  assert.equal(plan.temperatureDependentSpecificHeat, true);
  assert.equal(result.storageEnergyJ, 72000);
  assert.equal(result.residualJ, 0);
  assert.notEqual(result.storageEnergyJ, plan.cells[0].initialHeatCapacityJPerK * 60);
});

test('signed sources and outward boundary energy handle cooling and incoming heat', () => {
  const plan = snapshotMaterialStorage(input());
  near(accountMaterialStorage(plan, state([10], [-97.2])).residualJ, 0);
  near(accountMaterialStorage(plan, state([10], [0], [97.2])).residualJ, 0);
  near(accountMaterialStorage(plan, state([30], [0], [-97.2])).residualJ, 0);
  near(accountMaterialStorage(plan, state([30], [110], [12.8])).residualJ, 0);
});

test('equal opposing cell errors remain visible despite a zero global residual', () => {
  const plan = snapshotMaterialStorage({materials: [material(1, 1)], cells: [cell(1), cell(1)]});
  const result = accountMaterialStorage(plan, state([20, 20], [10, -10], [0, 0]));
  assert.equal(result.residualJ, 0); assert.equal(result.absoluteCellResidualJ, 20);
  assert.equal(result.grossSourceEnergyJ, 20);
  assert.deepEqual(result.cells.map(c => c.residualJ), [-10, 10]);
});

test('heterogeneous materials and refinement conserve independently supplied joules', () => {
  for (const count of [1, 8, 64, 512]) {
    const plan = snapshotMaterialStorage({materials: [material(2, 100, 300), material(3, 400)],
      cells: [0, 1].flatMap(index => Array.from({length: count}, () => cell(1 / count, index, 0)))});
    const result = accountMaterialStorage(plan, state(Array(2 * count).fill(100),
      [...Array(count).fill(40000 / count), ...Array(count).fill(120000 / count)], Array(2 * count).fill(0)));
    near(result.storageEnergyJ, 160000); near(result.residualJ, 0);
  }
});

test('snapshot and report are detached and frozen; repeat evaluation does not advance state', () => {
  const raw = input(), plan = snapshotMaterialStorage(raw), values = state();
  raw.cells[0].volumeM3 = 1; raw.materials[0].densityKgPerM3 = 1;
  const result = accountMaterialStorage(plan, values); values.sourceEnergyJ[0] = 1;
  near(result.sourceEnergyJ, 97.2);
  for (const x of [plan, plan.cells, ...plan.cells, ...plan.materials, result, result.cells, ...result.cells])
    assert.equal(Object.isFrozen(x), true);
  assert.deepEqual(accountMaterialStorage(plan, state()), result);
  assert.throws(() => accountMaterialStorage({...plan}, state()), code('INVALID_ARGUMENT'));
});

test('missing references, bad SI volumes and unrepresentable masses/capacities reject', () => {
  for (const invalid of [-1, .5, 1, NaN]) {
    const raw = input(); raw.cells[0].materialIndex = invalid;
    assert.throws(() => snapshotMaterialStorage(raw), code('INVALID_ARGUMENT'));
  }
  for (const v of [0, -1, Number.MIN_VALUE, Infinity, NaN, '1']) {
    const raw = input(); raw.cells[0].volumeM3 = v;
    assert.throws(() => snapshotMaterialStorage(raw), code('INVALID_ARGUMENT'));
  }
  for (const [rho, cp, volume] of [[1e200, 1, 1e200], [1e-200, 1e200, 1e-200], [1, 1e200, 1e200]])
    assert.throws(() => snapshotMaterialStorage({materials: [material(rho, cp)], cells: [cell(volume)]}), code('NUMERICAL_RANGE'));
});

test('temperature limits, missing cell values and invalid integrated joules reject', () => {
  const plan = snapshotMaterialStorage(input());
  for (const x of [-1, 101, Infinity, NaN])
    assert.throws(() => accountMaterialStorage(plan, state([x])), code('MATERIAL_TEMPERATURE_RANGE'));
  for (const key of ['temperaturesCelsius', 'sourceEnergyJ', 'boundaryEnergyOutJ']) {
    for (const invalid of [[], [1, 2], new Float64Array([1])]) {
      const value = state(); value[key] = invalid;
      assert.throws(() => accountMaterialStorage(plan, value), code('INVALID_ARGUMENT'));
    }
  }
  for (const energy of [Infinity, NaN, Number.MIN_VALUE, '97.2'])
    assert.throws(() => accountMaterialStorage(plan, state([30], [energy])), code('INVALID_ARGUMENT'));
});

test('accessors, sparse arrays, extra fields and inherited state reject without callbacks', () => {
  let calls = 0;
  const getter = {enumerable: true, get() { calls++; throw Error('unexpected'); }};
  const a = input(); Object.defineProperty(a.cells[0], 'volumeM3', getter);
  const b = input(); Object.defineProperty(b.cells, '0', getter);
  const c = input(); c.cells[0].ownerHash = 'not a geometry certificate';
  const d = input(); delete d.cells[0];
  const e = input(); e.materials.extra = true;
  for (const raw of [a, b, c, d, e, Object.create(input())])
    assert.throws(() => snapshotMaterialStorage(raw), code('INVALID_ARGUMENT'));
  const plan = snapshotMaterialStorage(input()), value = state();
  Object.defineProperty(value, 'sourceEnergyJ', getter);
  assert.throws(() => accountMaterialStorage(plan, value), code('INVALID_ARGUMENT'));
  assert.equal(calls, 0);
});

test('representability failures cannot silently accept an energy result', () => {
  const plan = snapshotMaterialStorage({materials: [material(1, 1e200)], cells: [cell(1e107)]});
  assert.throws(() => accountMaterialStorage(plan, state([100], [0])), code('NUMERICAL_RANGE'));
});

test('bounded 4096-cell preparation and complete accounting meet CPU budgets', t => {
  const start = performance.now();
  const plan = snapshotMaterialStorage({materials: [material()], cells: Array.from({length: 4096}, () => cell(4e-6 / 4096))});
  const snapshotMs = performance.now() - start, accountStart = performance.now();
  const result = accountMaterialStorage(plan, state(Array(4096).fill(30), Array(4096).fill(97.2 / 4096), Array(4096).fill(0)));
  const accountingMs = performance.now() - accountStart;
  near(result.storageEnergyJ, 97.2); near(result.residualJ, 0);
  assert.ok(snapshotMs < 500); assert.ok(accountingMs < 500);
  t.diagnostic(JSON.stringify({cells: 4096, snapshotMs, accountingMs, CPUOnly: true}));
});
