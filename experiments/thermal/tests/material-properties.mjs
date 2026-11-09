import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {snapshotMaterialProperties, materialAtTemperature, specificEnthalpyChange, materialEnergyChange} from '../material-properties.js';

// Synthetic analytic data, not a qualified material preset database.
const point = (temperatureCelsius, specificHeatJPerKgK = 900, conductivityWPerMK = 200) =>
  ({temperatureCelsius, specificHeatJPerKgK, conductivityWPerMK});
const input = () => ({densityKgPerM3: 2700, points: [point(0), point(100)]});
const snapshot = () => snapshotMaterialProperties(input());
const code = expected => error => error.code === expected;
const near = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(Number.MIN_VALUE, Math.abs(expected)), `${actual} != ${expected}`);

test('constant mass-specific heat converts density once and matches independent energy', () => {
  const material = snapshot();
  const properties = materialAtTemperature(material, 20);
  assert.equal(properties.specificHeatJPerKgK, 900);
  assert.equal(properties.volumetricHeatCapacityJPerM3K, 2430000);
  assert.equal(specificEnthalpyChange(material, 20, 30), 9000);
  // Explicit 20 x 20 x 10 mm body's mass is 0.0108 kg; the module never reads geometry.
  near(materialEnergyChange(material, 0.0108, 20, 30), 97.2);
  near(materialEnergyChange(material, 0.0108, 20, 20 + 0.4 / 9.72), 0.4);
});

test('linear cp and k use an analytic integral, not endpoint cp times delta-T', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 1000,
    points: [point(0, 500, 100), point(100, 700, 300)]});
  assert.equal(materialAtTemperature(material, 25).specificHeatJPerKgK, 550);
  assert.equal(materialAtTemperature(material, 25).conductivityWPerMK, 150);
  assert.equal(specificEnthalpyChange(material, 20, 80), 500 * 60 + (80 ** 2 - 20 ** 2));
});

test('knot-crossing integral includes each segment and is antisymmetric', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 1,
    points: [point(-20, 100), point(0, 200), point(30, 50), point(80, 150)]});
  const expected = (150 + 200) / 2 * 10 + (200 + 50) / 2 * 30 + (50 + 90) / 2 * 20;
  assert.equal(specificEnthalpyChange(material, -10, 50), expected);
  assert.equal(specificEnthalpyChange(material, 50, -10), -expected);
  assert.equal(materialEnergyChange(material, 2, 50, -10), -2 * expected);
  assert.equal(specificEnthalpyChange(material, 0, 0), 0);
  assert.equal(materialEnergyChange(material, 2, 0, 0), 0);
});

test('all exact knots and both endpoints preserve supplied values', () => {
  const raw = {densityKgPerM3: 2, points: [point(-100, 100, 1), point(0, 200, 2), point(100, 50, 3)]};
  const material = snapshotMaterialProperties(raw);
  for (const p of raw.points) {
    const actual = materialAtTemperature(material, p.temperatureCelsius);
    assert.equal(actual.specificHeatJPerKgK, p.specificHeatJPerKgK);
    assert.equal(actual.conductivityWPerMK, p.conductivityWPerMK);
  }
});

test('integral agrees with constant analytic result across 128 knots and arbitrary subdivisions', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 3,
    points: Array.from({length: 128}, (_, i) => point(i, 1200, 20))});
  near(specificEnthalpyChange(material, 0.125, 126.75), 1200 * (126.75 - 0.125));
  const subdivisions = [0.125, 10.625, 48, 90.01, 126.75];
  const energy = subdivisions.slice(1).reduce((sum, end, i) =>
    sum + specificEnthalpyChange(material, subdivisions[i], end), 0);
  near(energy, specificEnthalpyChange(material, subdivisions[0], subdivisions.at(-1)));
});

test('integral differentiates back to cp inside segments', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 10,
    points: [point(0, 500), point(50, 1000), point(100, 600)]});
  for (const temperature of [5, 25, 49, 51, 75, 95]) {
    const derivative = specificEnthalpyChange(material, temperature - 0.01, temperature + 0.01) / 0.02;
    near(derivative, materialAtTemperature(material, temperature).specificHeatJPerKgK, 1e-10);
  }
});

test('small interval far from table origin does not subtract large cumulative enthalpies', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 1,
    points: [point(0, 1e12), point(1e12, 1e12)]});
  const from = 1e12 - 1, to = from + 0.001;
  assert.equal(specificEnthalpyChange(material, from, to), (to - from) * 1e12);
});

test('interior ratio underflow rejects rather than silently returning an endpoint property', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 1,
    points: [point(0, 1e-200), point(1e300, 1e300)]});
  for (const temperature of [1e-100, 1e-10]) {
    assert.throws(() => materialAtTemperature(material, temperature), code('NUMERICAL_RANGE'));
    assert.throws(() => specificEnthalpyChange(material, 0, temperature), code('NUMERICAL_RANGE'));
  }
});

test('near-endpoint interpolation retains the other endpoint contribution', () => {
  const material = snapshotMaterialProperties({densityKgPerM3: 1,
    points: [point(-200, 1e308), point(1e-200, 1)]});
  near(materialAtTemperature(material, 0).specificHeatJPerKgK, 5e105);
  near(specificEnthalpyChange(material, 0, 1e-200), 2.5e-95);
});

test('snapshots are detached, deeply frozen, and results are immutable', () => {
  const raw = input(), material = snapshotMaterialProperties(raw);
  raw.densityKgPerM3 = 1; raw.points[0].specificHeatJPerKgK = 1; raw.points.push(point(200));
  assert.equal(material.densityKgPerM3, 2700);
  assert.equal(material.points.length, 2);
  assert.equal(material.points[0].specificHeatJPerKgK, 900);
  for (const object of [material, material.points, ...material.points, materialAtTemperature(material, 20)])
    assert.equal(Object.isFrozen(object), true);
  assert.throws(() => { material.points[0].specificHeatJPerKgK = 1; }, TypeError);
  assert.throws(() => materialAtTemperature(JSON.parse(JSON.stringify(material)), 20), code('INVALID_ARGUMENT'));
  const restored = snapshotMaterialProperties(JSON.parse(JSON.stringify(material)));
  assert.deepEqual(materialAtTemperature(restored, 20), materialAtTemperature(material, 20));
});

test('plain null-prototype records are allowed', () => {
  const raw = Object.assign(Object.create(null), input());
  raw.points = raw.points.map(p => Object.assign(Object.create(null), p));
  assert.equal(materialAtTemperature(snapshotMaterialProperties(raw), 20).specificHeatJPerKgK, 900);
});

for (const value of [-1, 0, Number.MIN_VALUE, Infinity, NaN, '2700']) {
  test(`invalid density ${String(value)} is rejected`, () => {
    assert.throws(() => snapshotMaterialProperties({...input(), densityKgPerM3: value}), code('INVALID_ARGUMENT'));
  });
}
for (const key of ['specificHeatJPerKgK', 'conductivityWPerMK']) {
  test(`invalid ${key} is rejected`, () => {
    for (const value of [-1, 0, Number.MIN_VALUE, Infinity, NaN, '10']) {
      const raw = input(); raw.points[0][key] = value;
      assert.throws(() => snapshotMaterialProperties(raw), code('INVALID_ARGUMENT'));
    }
  });
}

test('table order, temperatures and bounds are explicit', () => {
  for (const table of [[], [point(0)], [point(0), point(0)], [point(1), point(0)],
    [point(-273.15), point(0)], [point(NaN), point(1)], [point(0), point(Infinity)],
    Array.from({length: 129}, (_, i) => point(i))]) {
    assert.throws(() => snapshotMaterialProperties({densityKgPerM3: 1, points: table}), code('INVALID_ARGUMENT'));
  }
  const material = snapshot();
  for (const temperature of [-0.001, 100.001, NaN, Infinity, '20']) {
    assert.throws(() => materialAtTemperature(material, temperature), code('MATERIAL_TEMPERATURE_RANGE'));
    assert.throws(() => specificEnthalpyChange(material, temperature, 20), code('MATERIAL_TEMPERATURE_RANGE'));
    assert.throws(() => specificEnthalpyChange(material, 20, temperature), code('MATERIAL_TEMPERATURE_RANGE'));
  }
});

test('unknown physics fields and malformed records cannot be silently ignored', () => {
  const cases = [null, [], {...input(), latentHeatJPerKg: 10}, {points: input().points}, Object.create(input())];
  const extraPoint = input(); extraPoint.points[0].emissivity = 0.5; cases.push(extraPoint);
  const hidden = input(); Object.defineProperty(hidden, 'hidden', {value: 1}); cases.push(hidden);
  const symbol = input(); symbol[Symbol('hidden')] = 1; cases.push(symbol);
  const sparse = input(); delete sparse.points[0]; cases.push(sparse);
  const extraArray = input(); extraArray.points.extra = 1; cases.push(extraArray);
  const inheritedArray = input(); Object.setPrototypeOf(inheritedArray.points, {}); cases.push(inheritedArray);
  for (const raw of cases) assert.throws(() => snapshotMaterialProperties(raw), code('INVALID_ARGUMENT'));
});

test('accessor properties are rejected without invoking author callbacks', () => {
  let invoked = 0;
  const getter = {get() { invoked++; throw new Error('must not execute'); }, enumerable: true};
  const cases = [input(), input(), input()];
  Object.defineProperty(cases[0], 'densityKgPerM3', getter);
  Object.defineProperty(cases[1].points[0], 'specificHeatJPerKgK', getter);
  Object.defineProperty(cases[2].points, '0', getter);
  for (const raw of cases) assert.throws(() => snapshotMaterialProperties(raw), code('INVALID_ARGUMENT'));
  assert.equal(invoked, 0);
});

test('unrepresentable volumetric capacity fails before use', () => {
  for (const [rho, cp] of [[1e300, 1e300], [1e-200, 1e-200]])
    assert.throws(() => snapshotMaterialProperties({densityKgPerM3: rho, points: [point(0, cp), point(1, cp)]}), code('NUMERICAL_RANGE'));
});

test('enthalpy and mass-energy overflow/underflow are explicit failures', () => {
  const huge = snapshotMaterialProperties({densityKgPerM3: 1, points: [point(0, 1e300), point(1e300, 1e300)]});
  assert.throws(() => specificEnthalpyChange(huge, 0, 1e300), code('NUMERICAL_RANGE'));
  const tiny = snapshotMaterialProperties({densityKgPerM3: 1, points: [point(0, 1e-300), point(1, 1e-300)]});
  assert.throws(() => specificEnthalpyChange(tiny, 0, 1e-100), code('NUMERICAL_RANGE'));
  const material = snapshot();
  for (const mass of [0, -1, Number.MIN_VALUE, NaN, Infinity])
    assert.throws(() => materialEnergyChange(material, mass, 20, 30), code('INVALID_ARGUMENT'));
  for (const mass of [1e308, 2 ** -1022])
    assert.throws(() => materialEnergyChange(material, mass, 0, mass > 1 ? 100 : 1e-10), code('NUMERICAL_RANGE'));
});

test('completed snapshot, sampling and enthalpy operations meet bounded CPU latency budget', t => {
  const raw = {densityKgPerM3: 2700, points: Array.from({length: 128}, (_, i) => point(i, 900 + i, 200 + i))};
  const start = performance.now();
  const material = snapshotMaterialProperties(raw);
  const snapshotMs = performance.now() - start;
  let checksum = 0;
  const queryStart = performance.now();
  for (let i = 0; i < 10000; i++) {
    checksum += materialAtTemperature(material, 63.25).volumetricHeatCapacityJPerM3K;
    checksum += specificEnthalpyChange(material, 0.25, 126.75);
    checksum += materialEnergyChange(material, 0.0108, 20, 30);
  }
  const queriesMs = performance.now() - queryStart;
  assert.ok(checksum > 0 && Number.isFinite(checksum));
  assert.ok(snapshotMs < 100, `128-point snapshot ${snapshotMs} ms exceeds 100 ms`);
  assert.ok(queriesMs < 1000, `30000 completed queries ${queriesMs} ms exceeds 1000 ms`);
  t.diagnostic(JSON.stringify({snapshotMs, queriesMs, queries: 30000, CPUOnly: true}));
});
