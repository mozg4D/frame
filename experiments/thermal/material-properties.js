// Unregistered SI material preparation. No native tags, solver or GPU access.
const snapshots = new WeakSet();
const minimumNormal = 2 ** -1022;
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
const need = (ok, message, code = 'INVALID_ARGUMENT') => { if (!ok) fail(code, message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const positive = x => finite(x) && x >= minimumNormal;

function data(value, keys) {
  need(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'Plain own-data object required.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  need(names.length === keys.length && names.every(key => typeof key === 'string' &&
    keys.includes(key) && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')),
  'Unknown, missing or non-data material property.');
  return Object.fromEntries(names.map(key => [key, descriptors[key].value]));
}

function points(value) {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
    value.length >= 2 && value.length <= 128, 'Material table requires 2..128 ordinary points.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  need(names.length === value.length + 1 && names.every(key => key === 'length' ||
    typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length &&
    descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value')),
  'Material table must contain only dense own data elements.');
  return Array.from({length: value.length}, (_, i) => data(descriptors[i].value,
    ['temperatureCelsius', 'specificHeatJPerKgK', 'conductivityWPerMK']));
}

/** Snapshot explicit, single-phase, piecewise-linear mass-specific properties. */
export function snapshotMaterialProperties(value) {
  const input = data(value, ['densityKgPerM3', 'points']);
  need(positive(input.densityKgPerM3), 'Density must be positive normal kg/m3.');
  const table = points(input.points);
  for (let i = 0; i < table.length; i++) {
    const point = table[i];
    need(finite(point.temperatureCelsius) && point.temperatureCelsius > -273.15 &&
      (i === 0 || point.temperatureCelsius > table[i - 1].temperatureCelsius),
    'Temperatures must strictly increase above absolute zero.');
    need(positive(point.specificHeatJPerKgK) && positive(point.conductivityWPerMK),
      'Specific heat and conductivity must be positive normal SI values.');
    need(positive(input.densityKgPerM3 * point.specificHeatJPerKgK),
      'Volumetric heat capacity is unrepresentable.', 'NUMERICAL_RANGE');
    Object.freeze(point);
  }
  const material = Object.freeze({densityKgPerM3: input.densityKgPerM3, points: Object.freeze(table)});
  snapshots.add(material);
  return material;
}

function checked(material, temperatureCelsius) {
  need(snapshots.has(material), 'Use a material snapshot created by snapshotMaterialProperties.');
  need(finite(temperatureCelsius) && temperatureCelsius >= material.points[0].temperatureCelsius &&
    temperatureCelsius <= material.points.at(-1).temperatureCelsius,
  'Temperature lies outside the explicit material table.', 'MATERIAL_TEMPERATURE_RANGE');
}

function interpolate(a, b, temperature, key) {
  if (temperature === a.temperatureCelsius) return a[key];
  if (temperature === b.temperatureCelsius) return b[key];
  const span = b.temperatureCelsius - a.temperatureCelsius;
  // Compute both distances: 1 - fraction can erase a small but significant
  // endpoint contribution. Reject underresolved ratios rather than accept an
  // endpoint value whose weighted correction may still be representable.
  const leftWeight = (b.temperatureCelsius - temperature) / span;
  const rightWeight = (temperature - a.temperatureCelsius) / span;
  need(positive(leftWeight) && positive(rightWeight),
    'Material interpolation ratio is unrepresentable.', 'NUMERICAL_RANGE');
  const result = leftWeight * a[key] + rightWeight * b[key];
  need(positive(result), 'Interpolated material property is unrepresentable.', 'NUMERICAL_RANGE');
  return result;
}

/** Explicit SI values; density converts mass-specific heat exactly once. */
export function materialAtTemperature(material, temperatureCelsius) {
  checked(material, temperatureCelsius);
  const table = material.points;
  let i = 1;
  while (i < table.length - 1 && temperatureCelsius > table[i].temperatureCelsius) i++;
  const specificHeatJPerKgK = interpolate(table[i - 1], table[i], temperatureCelsius, 'specificHeatJPerKgK');
  const conductivityWPerMK = interpolate(table[i - 1], table[i], temperatureCelsius, 'conductivityWPerMK');
  const volumetricHeatCapacityJPerM3K = material.densityKgPerM3 * specificHeatJPerKgK;
  need(positive(volumetricHeatCapacityJPerM3K), 'Volumetric heat capacity is unrepresentable.', 'NUMERICAL_RANGE');
  return Object.freeze({temperatureCelsius, densityKgPerM3: material.densityKgPerM3,
    specificHeatJPerKgK, conductivityWPerMK, volumetricHeatCapacityJPerM3K});
}

/** Signed integral of cp(T) dT in J/kg, integrated directly over the requested interval. */
export function specificEnthalpyChange(material, fromTemperatureCelsius, toTemperatureCelsius) {
  checked(material, fromTemperatureCelsius);
  checked(material, toTemperatureCelsius);
  if (fromTemperatureCelsius === toTemperatureCelsius) return 0;
  const low = Math.min(fromTemperatureCelsius, toTemperatureCelsius);
  const high = Math.max(fromTemperatureCelsius, toTemperatureCelsius);
  let sum = 0, compensation = 0;
  for (let i = 1; i < material.points.length; i++) {
    const a = material.points[i - 1], b = material.points[i];
    const left = Math.max(low, a.temperatureCelsius), right = Math.min(high, b.temperatureCelsius);
    if (right <= left) continue;
    const cpLeft = interpolate(a, b, left, 'specificHeatJPerKgK');
    const cpRight = interpolate(a, b, right, 'specificHeatJPerKgK');
    const term = (cpLeft / 2 + cpRight / 2) * (right - left);
    need(positive(term), 'Material enthalpy interval is unrepresentable.', 'NUMERICAL_RANGE');
    const next = sum + term;
    need(finite(next), 'Material enthalpy sum overflow.', 'NUMERICAL_RANGE');
    compensation += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum;
    sum = next;
  }
  const result = sum + compensation;
  need(positive(result), 'Material enthalpy change is unrepresentable.', 'NUMERICAL_RANGE');
  return toTemperatureCelsius > fromTemperatureCelsius ? result : -result;
}

/** Signed m * delta-h in joules for explicitly supplied mass; no geometry inference. */
export function materialEnergyChange(material, massKg, fromTemperatureCelsius, toTemperatureCelsius) {
  need(positive(massKg), 'Mass must be positive normal kg.');
  const change = specificEnthalpyChange(material, fromTemperatureCelsius, toTemperatureCelsius);
  if (change === 0) return 0;
  const result = massKg * change;
  need(positive(Math.abs(result)), 'Material energy change is unrepresentable.', 'NUMERICAL_RANGE');
  return result;
}
