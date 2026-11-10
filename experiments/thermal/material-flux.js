import {accountMaterialStorage} from './material-storage.js';

// Unregistered ledger of explicit integrated face energies, not a flux solver.
const need = (ok, message, code = 'INVALID_ARGUMENT') => {
  if (!ok) throw Object.assign(new Error(message), {code});
};
const normal = x => typeof x === 'number' && Number.isFinite(x) && (x === 0 || Math.abs(x) >= 2 ** -1022);
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
    need(Number.isFinite(next), 'Flux accounting sum overflow.', 'NUMERICAL_RANGE');
    c += Math.abs(s) >= Math.abs(x) ? (s - next) + x : (x - next) + s;
    s = next;
  }
  const result = s + c;
  need(normal(result), 'Flux accounting sum is unrepresentable.', 'NUMERICAL_RANGE');
  return result;
}

/** Each face has one explicit identity and one signed time-integrated energy. */
export function accountMaterialFluxes(plan, value) {
  // Never invoke a plan getter. The imported storage accountant validates the
  // original snapshot brand before any report is returned.
  const planCells = plan && typeof plan === 'object' ? Object.getOwnPropertyDescriptor(plan, 'cells')?.value : null;
  need(Array.isArray(planCells) && planCells.length >= 1 && planCells.length <= 4096,
    'Material storage snapshot required.');
  const n = planCells.length;
  const input = record(value, ['temperaturesCelsius', 'sourceEnergyJ', 'internalFaces', 'boundaryFaces']);
  const temperaturesCelsius = array(input.temperaturesCelsius, n, n);
  const sourceEnergyJ = array(input.sourceEnergyJ, n, n);
  const seen = new Set(), internal = Array.from({length: n}, () => []), exterior = Array.from({length: n}, () => []);
  const validCell = i => Number.isInteger(i) && i >= 0 && i < n;
  const identity = id => {
    need(Number.isSafeInteger(id) && id >= 0 && !seen.has(id), 'Faces require unique nonnegative integer identities.');
    seen.add(id);
  };
  const internalFaces = array(input.internalFaces, 0, 32768).map(raw => {
    const f = record(raw, ['faceId', 'cellA', 'cellB', 'energyJ']);
    identity(f.faceId);
    need(validCell(f.cellA) && validCell(f.cellB) && f.cellA !== f.cellB, 'Internal face requires two distinct cells.');
    need(normal(f.energyJ), 'Internal face energy must be normal signed joules.');
    internal[f.cellA].push(f.energyJ); internal[f.cellB].push(-f.energyJ);
    return Object.freeze(f);
  });
  const boundaryFaces = array(input.boundaryFaces, 0, 32768).map(raw => {
    const f = record(raw, ['faceId', 'cell', 'energyOutJ']);
    identity(f.faceId);
    need(validCell(f.cell) && normal(f.energyOutJ), 'Boundary face requires a cell and normal outward signed joules.');
    exterior[f.cell].push(f.energyOutJ);
    return Object.freeze(f);
  });
  const internalNetOutJ = Object.freeze(internal.map(sum)), exteriorNetOutJ = Object.freeze(exterior.map(sum));
  const totalNetOutJ = Object.freeze(internalNetOutJ.map((x, i) => sum([x, exteriorNetOutJ[i]])));
  const storage = accountMaterialStorage(plan, {temperaturesCelsius, sourceEnergyJ, boundaryEnergyOutJ: totalNetOutJ});
  const exteriorEnergyOutJ = sum(boundaryFaces.map(f => f.energyOutJ));
  const globalResidualJ = sum([storage.storageEnergyJ, -storage.sourceEnergyJ, exteriorEnergyOutJ]);
  return Object.freeze({storage, internalFaces: Object.freeze(internalFaces), boundaryFaces: Object.freeze(boundaryFaces),
    internalNetOutJ, exteriorNetOutJ, totalNetOutJ, exteriorEnergyOutJ, globalResidualJ,
    internalAssemblyResidualJ: sum(internalNetOutJ),
    cellToGlobalResidualDifferenceJ: sum([storage.residualJ, -globalResidualJ]),
    grossInternalTransferJ: sum(internalFaces.map(f => Math.abs(f.energyJ))),
    solverReady: false, currentnessCertified: false, completePhysicalScene: false});
}
