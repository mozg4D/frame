import {snapshotMaterialProperties, materialAtTemperature, materialEnergyChange} from './material-properties.js';

// Unregistered explicit-cell accounting; no scene capture, stepping or GPU work.
const plans = new WeakSet();
const need = (ok, message, code = 'INVALID_ARGUMENT') => {
  if (!ok) throw Object.assign(new Error(message), {code});
};
const finite = x => typeof x === 'number' && Number.isFinite(x);
const normal = x => finite(x) && (x === 0 || Math.abs(x) >= 2 ** -1022);
function record(value, keys) {
  need(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'Plain data record required.');
  const d = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(d);
  need(names.length === keys.length && names.every(k => typeof k === 'string' && keys.includes(k) &&
    d[k].enumerable && Object.hasOwn(d[k], 'value')), 'Exact own-data schema required.');
  return Object.fromEntries(keys.map(k => [k, d[k].value]));
}
function array(value, min, max) {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length >= min &&
    value.length <= max, 'Bounded ordinary array required.');
  const d = Object.getOwnPropertyDescriptors(value);
  need(Reflect.ownKeys(d).length === value.length + 1 && Array.from({length: value.length}, (_, i) => d[i])
    .every(x => x?.enumerable && Object.hasOwn(x, 'value')), 'Dense own-data array required.');
  return Array.from({length: value.length}, (_, i) => d[i].value);
}
function sum(values) {
  let s = 0, c = 0;
  for (const x of values) {
    const next = s + x;
    need(finite(next), 'Energy sum overflow.', 'NUMERICAL_RANGE');
    c += Math.abs(s) >= Math.abs(x) ? (s - next) + x : (x - next) + s;
    s = next;
  }
  const result = s + c;
  need(normal(result), 'Energy sum is unrepresentable.', 'NUMERICAL_RANGE');
  return result;
}

/** Explicit mapping only. Volumes and material assignments must be certified elsewhere. */
export function snapshotMaterialStorage(value) {
  const input = record(value, ['materials', 'cells']);
  const materials = Object.freeze(array(input.materials, 1, 64).map(snapshotMaterialProperties));
  const cells = Object.freeze(array(input.cells, 1, 4096).map(raw => {
    const cell = record(raw, ['materialIndex', 'volumeM3', 'temperatureCelsius']);
    need(Number.isInteger(cell.materialIndex) && cell.materialIndex >= 0 && cell.materialIndex < materials.length,
      'Cell must reference an explicit material index.');
    need(normal(cell.volumeM3) && cell.volumeM3 > 0, 'Cell volume must be positive normal m3.');
    const material = materials[cell.materialIndex];
    const initialProperties = materialAtTemperature(material, cell.temperatureCelsius);
    const massKg = material.densityKgPerM3 * cell.volumeM3;
    need(normal(massKg) && massKg > 0, 'Cell mass is unrepresentable.', 'NUMERICAL_RANGE');
    const initialHeatCapacityJPerK = massKg * initialProperties.specificHeatJPerKgK;
    need(normal(initialHeatCapacityJPerK) && initialHeatCapacityJPerK > 0,
      'Initial cell heat capacity is unrepresentable.', 'NUMERICAL_RANGE');
    return Object.freeze({...cell, massKg, initialHeatCapacityJPerK, initialProperties});
  }));
  const temperatureDependentSpecificHeat = materials.some(m => m.points.some(p =>
    p.specificHeatJPerKgK !== m.points[0].specificHeatJPerKgK));
  const plan = Object.freeze({materials, cells, temperatureDependentSpecificHeat,
    solverReady: false, currentnessCertified: false, completePhysicalScene: false});
  plans.add(plan);
  return plan;
}

/** Per-cell integrated joules, positive boundary energy OUT of the cell. No acceptance threshold. */
export function accountMaterialStorage(plan, value) {
  need(plans.has(plan), 'Validated material storage snapshot required.');
  const input = record(value, ['temperaturesCelsius', 'sourceEnergyJ', 'boundaryEnergyOutJ']);
  const n = plan.cells.length;
  const temperatures = array(input.temperaturesCelsius, n, n);
  const sources = array(input.sourceEnergyJ, n, n), boundaries = array(input.boundaryEnergyOutJ, n, n);
  need(sources.every(normal) && boundaries.every(normal), 'Integrated source and outward boundary energies must be normal signed joules.');
  const cells = Object.freeze(plan.cells.map((cell, i) => {
    const material = plan.materials[cell.materialIndex];
    const finalProperties = materialAtTemperature(material, temperatures[i]);
    const storageEnergyJ = materialEnergyChange(material, cell.massKg, cell.temperatureCelsius, temperatures[i]);
    const residualJ = sum([storageEnergyJ, -sources[i], boundaries[i]]);
    return Object.freeze({storageEnergyJ, sourceEnergyJ: sources[i], boundaryEnergyOutJ: boundaries[i],
      residualJ, finalProperties});
  }));
  const storageEnergyJ = sum(cells.map(c => c.storageEnergyJ));
  const sourceEnergyJ = sum(sources), boundaryEnergyOutJ = sum(boundaries);
  return Object.freeze({cells, storageEnergyJ, sourceEnergyJ, boundaryEnergyOutJ,
    residualJ: sum(cells.map(c => c.residualJ)),
    absoluteCellResidualJ: sum(cells.map(c => Math.abs(c.residualJ))),
    grossSourceEnergyJ: sum(sources.map(Math.abs)), grossBoundaryEnergyJ: sum(boundaries.map(Math.abs)),
    solverReady: false, currentnessCertified: false, completePhysicalScene: false});
}
