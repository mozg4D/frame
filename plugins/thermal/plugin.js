// Thermal: GPU conjugate heat transfer (solid conduction, fluid buoyancy and fan airflow,
// surface radiation), smooth 3D-texture surface/slice rendering, probes, surfaceProbe and Curves.
const MM_TO_M = 0.001, M_TO_MM = 1000;
const STEFAN_BOLTZMANN = 5.670374419e-8;
const GRAVITY_WORLD = Object.freeze([0, -9.80665, 0]);
const MAX_CELLS = 262144;
const MAX_ARCHIVE_FIELD_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MATERIAL_NAME = 'Aluminium 6061';
export const FAN_CREATION_FRAME = Object.freeze([0.1, 0, 0, 0, 0.4, 0, 0, 0, 0.4, -30, 0, 0]);
export const PROBE_CREATION_FRAME = Object.freeze([0.02, 0, 0, 0, 0.02, 0, 0, 0, 0.02, 0, 0, 0]);

export const MATERIALS = Object.freeze({
  'Aluminium 6061':     Object.freeze({k: 167,   rho: 2700, cp: 896,  emissivity: 0.20, color: [0.74, 0.78, 0.84]}),
  'Anodized Aluminium': Object.freeze({k: 167,   rho: 2700, cp: 896,  emissivity: 0.85, color: [0.32, 0.36, 0.42]}),
  'Copper':             Object.freeze({k: 398,   rho: 8960, cp: 385,  emissivity: 0.15, color: [0.85, 0.49, 0.34]}),
  'Steel':              Object.freeze({k: 50,    rho: 7850, cp: 490,  emissivity: 0.30, color: [0.58, 0.64, 0.70]}),
  'Stainless Steel':    Object.freeze({k: 16,    rho: 8000, cp: 500,  emissivity: 0.25, color: [0.68, 0.72, 0.76]}),
  'Brass':              Object.freeze({k: 110,   rho: 8500, cp: 380,  emissivity: 0.20, color: [0.82, 0.70, 0.36]}),
  'Titanium Ti-6Al-4V': Object.freeze({k: 6.7,   rho: 4430, cp: 526,  emissivity: 0.35, color: [0.62, 0.61, 0.66]}),
  'Silicon':            Object.freeze({k: 148,   rho: 2330, cp: 700,  emissivity: 0.70, color: [0.36, 0.40, 0.48]}),
  'FR-4 (PCB)':         Object.freeze({k: 0.35,  rho: 1850, cp: 1100, emissivity: 0.88, color: [0.22, 0.56, 0.34]}),
  'Thermal Paste':      Object.freeze({k: 6.0,   rho: 2500, cp: 1000, emissivity: 0.85, color: [0.68, 0.70, 0.74]}),
  'Heat Pipe':          Object.freeze({k: 5000,  rho: 4500, cp: 500,  emissivity: 0.25, color: [0.90, 0.58, 0.36]}),
  'Glass':              Object.freeze({k: 1.05,  rho: 2500, cp: 840,  emissivity: 0.92, color: [0.64, 0.82, 0.88]}),
  'PLA':                Object.freeze({k: 0.13,  rho: 1240, cp: 1800, emissivity: 0.92, color: [0.52, 0.70, 0.60]}),
  'ABS':                Object.freeze({k: 0.17,  rho: 1040, cp: 1400, emissivity: 0.92, color: [0.72, 0.66, 0.56]}),
  'Nylon PA12':         Object.freeze({k: 0.25,  rho: 1010, cp: 1700, emissivity: 0.92, color: [0.76, 0.76, 0.74]}),
  'Wood':               Object.freeze({k: 0.12,  rho: 600,  cp: 1700, emissivity: 0.90, color: [0.66, 0.50, 0.34]}),
  'Foam Insulation':    Object.freeze({k: 0.035, rho: 35,   cp: 1400, emissivity: 0.90, color: [0.84, 0.82, 0.64]})
});

export const MEDIA = Object.freeze({
  Air:    Object.freeze({name: 'Air',    isVacuum: false, rho: 1.204, cp: 1006, k: 0.0257, mu: 1.825e-5, pr: 0.71, betaAt: tAmbC => 1 / Math.max(50, tAmbC + 273.15)}),
  Water:  Object.freeze({name: 'Water',  isVacuum: false, rho: 998.2, cp: 4182, k: 0.598,  mu: 1.002e-3, pr: 7.01, betaAt: () => 2.07e-4}),
  Vacuum: Object.freeze({name: 'Vacuum', isVacuum: true,  rho: 0,     cp: 0,    k: 0,      mu: 0,        pr: 1,    betaAt: () => 0})
});

export const CELL_TYPE = Object.freeze({FLUID: 0, SOLID: 1, FIXED_T: 2});

export const ROLE = Object.freeze({
  MATERIAL:  0,
  FALLBACK:  1,
  HEATER:    2,
  COOLER:    3,
  FIXED_T:   4,
  FAN:       5,
  FLUID:     6
});

const ROLE_LABELS = Object.freeze([
  'Material',
  'Default Material',
  'Heater',
  'Cooler',
  'Fixed Temperature',
  'Fan',
  'Fluid'
]);

const ROLE_COLORS = Object.freeze([
  [0.54, 0.64, 0.74], // Material (overridden by preset color)
  [0.72, 0.76, 0.80], // Fallback default
  [0.95, 0.36, 0.20], // Heater
  [0.24, 0.62, 0.96], // Cooler
  [0.94, 0.72, 0.18], // Fixed T
  [0.22, 0.84, 0.76], // Fan
  [0.25, 0.42, 0.58]  // Fluid
]);

const FACE_QUADS = Object.freeze([
  {axis: 0, sign: -1, corners: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], normal: [-1,0,0]},
  {axis: 0, sign:  1, corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], normal: [ 1,0,0]},
  {axis: 1, sign: -1, corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], normal: [0,-1,0]},
  {axis: 1, sign:  1, corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], normal: [0, 1,0]},
  {axis: 2, sign: -1, corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], normal: [0,0,-1]},
  {axis: 2, sign:  1, corners: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], normal: [0,0, 1]}
]);

const fail = (code, message) => Object.assign(new Error(message), {code});
const emptySchema = {type: 'object', properties: {}, additionalProperties: false};
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const sub3 = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add3 = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scale3 = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
const fmtNum = v => !Number.isFinite(v) ? '—' : (v !== 0 && (Math.abs(v) < 0.01 || Math.abs(v) >= 1e5)) ? v.toExponential(2) : String(Number(v.toPrecision(4)));

// Exact IEEE-754 float32 -> binary16 (uint16) encoder for RGBA16Float 3D texture uploads.
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
function f32ToF16(val) {
  _f32[0] = val;
  const x = _u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 112;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >>> (1 - exp);
    return sign | ((mant + 0x1000) >>> 13);
  }
  if (exp >= 31) return sign | 0x7bff; // clamp to finite max half
  return sign | (exp << 10) | ((mant + 0x1000) >>> 13);
}

// ---------- Material Resolution & Parameter Validation ----------

export function resolveMaterialProps(tagParams) {
  if (!tagParams) {
    return {name: DEFAULT_MATERIAL_NAME, ...MATERIALS[DEFAULT_MATERIAL_NAME], fallback: true, custom: false};
  }
  if (tagParams.Material === 'Custom') {
    const k = Number(tagParams.Conductivity);
    const rho = Number(tagParams.Density);
    const cp = Number(tagParams['Specific heat']);
    const emissivity = Number(tagParams.Emissivity);
    if (!Number.isFinite(k) || k <= 0) throw fail('INVALID_MATERIAL', 'Custom material Conductivity must be positive W/(m·K).');
    if (!Number.isFinite(rho) || rho <= 0) throw fail('INVALID_MATERIAL', 'Custom material Density must be positive kg/m³.');
    if (!Number.isFinite(cp) || cp <= 0) throw fail('INVALID_MATERIAL', 'Custom material Specific heat must be positive J/(kg·K).');
    if (!Number.isFinite(emissivity) || emissivity < 0 || emissivity > 1) throw fail('INVALID_MATERIAL', 'Custom material Emissivity must be in [0, 1].');
    return {name: 'Custom', k, rho, cp, emissivity, color: [0.60, 0.74, 0.84], fallback: false, custom: true};
  }
  const preset = MATERIALS[tagParams.Material];
  if (!preset) throw fail('INVALID_MATERIAL', `Unknown Thermal material preset: ${tagParams.Material}`);
  return {name: tagParams.Material, ...preset, fallback: false, custom: false};
}

export function copyPhysicalFrame(frame) {
  if (!frame || frame.kind !== 'physical-owner' || !Array.isArray(frame.ownerWorld) || frame.ownerWorld.length !== 16 || Array.from(frame.ownerWorld).some(x => !Number.isFinite(x)))
    throw fail('INVALID_ARGUMENT', 'Invalid physical field frame.');
  const m = frame.ownerWorld;
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) throw fail('INVALID_ARGUMENT', 'Physical field frame must be affine.');
  const axes = [0, 4, 8].map(i => m.slice(i, i + 3)), lengths = axes.map(a => Math.hypot(...a));
  if (lengths.some(x => !Number.isFinite(x) || x <= 0)) throw fail('INVALID_ARGUMENT', 'Physical field frame must be invertible.');
  const unit = axes.map((a, i) => a.map(x => x / lengths[i]));
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++)
    if (Math.abs(dot3(unit[a], unit[b])) > 1e-6) throw fail('SHEARED_DOMAIN', 'Sheared physical field frames are unsupported.');
  return Object.freeze({kind: 'physical-owner', ownerWorld: Object.freeze([...m])});
}

export function validateThermalParameters(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw fail('INVALID_ARGUMENT', 'Invalid Thermal parameters.');
  if (params['Auto size'] !== undefined && typeof params['Auto size'] !== 'boolean') throw fail('INVALID_ARGUMENT', 'Auto size must be boolean.');
  const voxel = params['Voxel size'] ?? 2;
  if (!Number.isFinite(voxel) || voxel < 1e-6) throw fail('INVALID_ARGUMENT', 'Voxel size must be a positive number in mm.');
  const medium = params.Medium ?? 'Air';
  if (!Object.hasOwn(MEDIA, medium)) throw fail('INVALID_ARGUMENT', 'Medium must be Air, Water or Vacuum.');
  if (!Number.isFinite(params.Ambient) || params.Ambient < -273.15) throw fail('INVALID_ARGUMENT', 'Ambient temperature must be at least absolute zero.');
  if (!Number.isFinite(params.Initial) || params.Initial < -273.15) throw fail('INVALID_ARGUMENT', 'Initial temperature must be at least absolute zero.');
  const ts = params['Time scale'] ?? 1;
  if (!Number.isFinite(ts) || ts < 1e-6) throw fail('INVALID_ARGUMENT', 'Time scale must be positive s/s.');
}

const FAN_FIELDS = ['Thermal', 'Shutoff pressure', 'Free flow', 'Direction'];
function validateFanProfile(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(k => !FAN_FIELDS.includes(k)))
    throw fail('INVALID_ARGUMENT', 'Unknown Fan parameter.');
  if (typeof params.Thermal !== 'string') throw fail('INVALID_ARGUMENT', 'Select a Thermal object or leave the Fan unassigned.');
  if (!Number.isFinite(params['Shutoff pressure']) || params['Shutoff pressure'] < 0) throw fail('INVALID_ARGUMENT', 'Pressure must be nonnegative Pa.');
  if (!Number.isFinite(params['Free flow']) || params['Free flow'] <= 0) throw fail('INVALID_ARGUMENT', 'Free flow must be positive m³/s.');
  if (!['Forward', 'Reverse'].includes(params.Direction)) throw fail('INVALID_ARGUMENT', 'Fan direction must be Forward or Reverse along its local X.');
}

export function validateFanParameters(document, params) {
  validateFanProfile(params);
  if (params.Thermal && !document.nodes.some(n => n.type === 'thermal' && n.nativeHash === params.Thermal))
    throw fail('INVALID_ARGUMENT', 'Select a Thermal object or leave the Fan unassigned.');
}

const isAffine = m => m?.length === 16 && Array.from(m).every(Number.isFinite) && m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;
const toIssue = e => ({code: e.code || 'UNSUPPORTED_FAN_FRAME', message: e.message});

// Orthogonal 3D Fan frame inspection supporting arbitrary rotation and position inside Thermal.
export function nativeFanMetadata(context, fan) {
  const D = context.document, params = {...fan.params};
  const direction = params.Direction === 'Forward' ? 1 : params.Direction === 'Reverse' ? -1 : null;
  const owner = D.nodes.find(n => n.type === 'thermal' && n.nativeHash === params.Thermal);
  const result = {
    hash: fan.nativeHash, ownerHash: params.Thermal,
    authored: {enabled: fan.enabled !== false, visible: fan.visible !== false, params},
    directionLocal: direction === null ? null : [direction, 0, 0],
    normalizedWorldAxis: null,
    ownerResolution: {status: owner ? 'resolved' : params.Thermal ? 'missing-owner' : 'unassigned', enabled: owner ? owner.enabled !== false : null},
    profile: {status: 'valid'},
    box: {localSizeMM: [100, 100, 100]},
    mapping: {status: 'unresolved-owner', solverEligible: false}
  };
  try { validateFanProfile(params); } catch (e) { result.profile = {status: 'invalid', error: toIssue(e)}; }
  let world;
  try {
    world = Array.from(D.world(fan.nativeHash));
    if (!isAffine(world)) throw fail('UNSUPPORTED_FAN_FRAME', 'Fan frame must be finite and affine.');
    const axes = [0, 4, 8].map(i => world.slice(i, i + 3));
    const scales = axes.map(len3);
    if (scales.some(s => !Number.isFinite(s) || s <= 0 || !Number.isFinite(s * 100)))
      throw fail('UNSUPPORTED_FAN_FRAME', 'Fan dimensions must be positive and finite.');
    const unit = axes.map((a, i) => scale3(a, 1 / scales[i]));
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++)
      if (Math.abs(dot3(unit[a], unit[b])) > 1e-6) throw fail('UNSUPPORTED_FAN_FRAME', 'Sheared Fan frames are unsupported.');
    const sizeMM = scales.map(s => 100 * s);
    result.box.worldCenterMM = world.slice(12, 15);
    result.box.worldEdgeLengthsMM = sizeMM;
    if (direction !== null) result.normalizedWorldAxis = unit[0].map(x => x === 0 ? 0 : direction * x);
    if (!owner) return result;
    const ownerWorld = Array.from(D.world(owner.nativeHash));
    copyPhysicalFrame({kind: 'physical-owner', ownerWorld});
    const invOwner = Array.from(context.math.inv(ownerWorld));
    const rel = Array.from(context.math.mul(invOwner, world));
    const centerMM = rel.slice(12, 15);
    const valid = result.profile.status === 'valid' && direction !== null;
    result.mapping = {
      status: 'supported-frame',
      solverEligible: valid,
      centerMM,
      sizeMM,
      areaM2: (sizeMM[1] * MM_TO_M) * (sizeMM[2] * MM_TO_M),
      thicknessM: sizeMM[0] * MM_TO_M,
      direction,
      worldAxis: result.normalizedWorldAxis,
      units: 'owner-local mm'
    };
  } catch (e) {
    result.mapping = {status: 'unsupported-frame', solverEligible: false, error: toIssue(e)};
  }
  return result;
}

export function inspectNativeFans(context, hash) {
  const started = performance.now(), D = context.document;
  const target = D.nodes.find(n => n.nativeHash === hash);
  if (!target || !['thermal', 'thermal_fan'].includes(target.type)) throw fail('INVALID_OWNER', 'Select a Thermal owner or Fan.');
  const ownerHash = target.type === 'thermal' ? hash : target.params.Thermal;
  const owner = D.nodes.find(n => n.type === 'thermal' && n.nativeHash === ownerHash);
  const matching = owner ? D.nodes.filter(n => n.type === 'thermal_fan' && n.params.Thermal === ownerHash) : [];
  const enabled = matching.filter(n => n.enabled !== false);
  const selection = {
    status: !owner ? 'unresolved-owner' : enabled.length === 1 ? 'unique' : enabled.length ? 'multiple' : 'missing',
    matchingFanCount: matching.length,
    directEnabledFanCount: enabled.length,
    disabledFanCount: matching.length - enabled.length
  };
  const metas = matching.map(f => nativeFanMetadata(context, f));
  const fanMeta = target.type === 'thermal_fan'
    ? nativeFanMetadata(context, target)
    : enabled.length === 1 ? metas.find(m => m.hash === enabled[0].nativeHash) : null;
  const solverEligible = fanMeta ? !!fanMeta.mapping.solverEligible : metas.some(m => m.mapping.solverEligible);
  return {
    stage: 'ready', authoringOnly: false, solverCoupled: true, solverEligible,
    ownerHash, selection, fan: fanMeta, fans: metas,
    metrics: {wallMs: performance.now() - started}
  };
}

// ---------- Domain & Coordinate Transforms ----------

export function computeManualDomain(worldMatrix, voxelSizeMm, maxCells = MAX_CELLS) {
  const pitchM = voxelSizeMm * MM_TO_M;
  if (!(pitchM > 0) || !Number.isFinite(pitchM)) throw fail('INVALID_ARGUMENT', 'Voxel size must be positive.');
  if (!isAffine(worldMatrix)) throw fail('INVALID_ARGUMENT', 'Thermal frame must be affine.');
  const cols = [0, 4, 8].map(i => [worldMatrix[i], worldMatrix[i+1], worldMatrix[i+2]]);
  const scales = cols.map(len3);
  if (scales.some(s => !(s > 0) || !Number.isFinite(s))) throw fail('DEGENERATE_DOMAIN', 'Thermal box has zero or non-finite extent.');
  const basis = cols.map((c, i) => scale3(c, 1 / scales[i]));
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++)
    if (Math.abs(dot3(basis[a], basis[b])) > 1e-6) throw fail('SHEARED_DOMAIN', 'Sheared Thermal frames are unsupported.');
  let reflected = false;
  if (dot3(basis[0], cross3(basis[1], basis[2])) < 0) {
    basis[2] = scale3(basis[2], -1);
    reflected = true;
  }
  const lengthsM = scales.map(s => 100 * s * MM_TO_M);
  const cells = lengthsM.map(L => Math.max(1, Math.ceil(L / pitchM - 1e-9)));
  const count = cells[0] * cells[1] * cells[2];
  if (!Number.isSafeInteger(count) || count > maxCells)
    throw fail('GRID_CAPACITY', `Grid ${cells.join('×')} (${count.toLocaleString()} cells) exceeds ${maxCells.toLocaleString()} cell budget. Increase Voxel size.`);
  const spacingM = lengthsM.map((L, k) => L / cells[k]);
  const centerWorldM = [worldMatrix[12]*MM_TO_M, worldMatrix[13]*MM_TO_M, worldMatrix[14]*MM_TO_M];
  const originWorldM = [0, 1, 2].map(k => centerWorldM[k] - 0.5*(lengthsM[0]*basis[0][k] + lengthsM[1]*basis[1][k] + lengthsM[2]*basis[2][k]));
  const gGrid = [dot3(GRAVITY_WORLD, basis[0]), dot3(GRAVITY_WORLD, basis[1]), dot3(GRAVITY_WORLD, basis[2])];
  return {
    autoSize: false, reflected, cells, count, spacingM, lengthsM, originWorldM, basis,
    gGrid, voxelSizeMm, pitchM
  };
}

export function computeAutoDomain(worldBoundsMm, voxelSizeMm, mediumName = 'Air', maxCells = MAX_CELLS) {
  const pitchM = voxelSizeMm * MM_TO_M;
  if (!(pitchM > 0) || !Number.isFinite(pitchM)) throw fail('INVALID_ARGUMENT', 'Voxel size must be positive.');
  if (!worldBoundsMm) throw fail('NO_THERMAL_GEOMETRY', 'No Thermal geometry, Fan or Probe found for Auto size.');
  const spanMm = [0, 1, 2].map(k => Math.max(voxelSizeMm, worldBoundsMm.max[k] - worldBoundsMm.min[k]));
  const maxSpan = Math.max(...spanMm);
  const isVac = mediumName === 'Vacuum';
  // Try progressive air padding factors so buoyant plumes have room without needlessly overflowing maxCells
  const padScales = isVac ? [0] : [1.0, 0.5, 0.25, 0];
  let chosen = null;
  for (const ps of padScales) {
    const padX = isVac ? voxelSizeMm : ps * Math.max(20, 0.25 * maxSpan, 3 * voxelSizeMm);
    const padZ = padX;
    const padBot = isVac ? voxelSizeMm : ps * Math.max(15, 0.20 * spanMm[1], 3 * voxelSizeMm);
    const padTop = isVac ? voxelSizeMm : ps * Math.max(30, 0.45 * spanMm[1], 4 * voxelSizeMm);
    const minMm = [worldBoundsMm.min[0] - padX, worldBoundsMm.min[1] - padBot, worldBoundsMm.min[2] - padZ];
    const maxMm = [worldBoundsMm.max[0] + padX, worldBoundsMm.max[1] + padTop, worldBoundsMm.max[2] + padZ];
    const extMm = [0, 1, 2].map(k => Math.max(voxelSizeMm, maxMm[k] - minMm[k]));
    const cells = extMm.map(L => Math.max(1, Math.ceil(L / voxelSizeMm - 1e-9)));
    const count = cells[0] * cells[1] * cells[2];
    if (Number.isSafeInteger(count) && count <= maxCells) {
      const spacingM = [pitchM, pitchM, pitchM];
      const lengthsM = cells.map(n => n * pitchM);
      const centerM = [0, 1, 2].map(k => 0.5 * (minMm[k] + maxMm[k]) * MM_TO_M);
      const originWorldM = [0, 1, 2].map(k => centerM[k] - 0.5 * lengthsM[k]);
      chosen = {
        autoSize: true, reflected: false, cells, count, spacingM, lengthsM, originWorldM,
        basis: [[1,0,0],[0,1,0],[0,0,1]], gGrid: [...GRAVITY_WORLD], voxelSizeMm, pitchM
      };
      break;
    }
  }
  if (!chosen) {
    const cells = spanMm.map(L => Math.max(1, Math.ceil(L / voxelSizeMm - 1e-9)));
    throw fail('GRID_CAPACITY', `Auto-size grid ${cells.join('×')} (${(cells[0]*cells[1]*cells[2]).toLocaleString()} cells) exceeds ${maxCells.toLocaleString()} cell budget. Increase Voxel size.`);
  }
  return chosen;
}

function meshToGridMatrix(meshWorldMm, domain) {
  const [bx, by, bz] = domain.basis, [dx, dy, dz] = domain.spacingM, o = domain.originWorldM;
  const inv = [1 / dx, 1 / dy, 1 / dz], out = new Float32Array(16);
  for (let col = 0; col < 3; col++) {
    const v = [meshWorldMm[col*4]*MM_TO_M, meshWorldMm[col*4+1]*MM_TO_M, meshWorldMm[col*4+2]*MM_TO_M];
    out[col*4]   = dot3(v, bx) * inv[0];
    out[col*4+1] = dot3(v, by) * inv[1];
    out[col*4+2] = dot3(v, bz) * inv[2];
    out[col*4+3] = 0;
  }
  const t = [meshWorldMm[12]*MM_TO_M - o[0], meshWorldMm[13]*MM_TO_M - o[1], meshWorldMm[14]*MM_TO_M - o[2]];
  out[12] = dot3(t, bx) * inv[0];
  out[13] = dot3(t, by) * inv[1];
  out[14] = dot3(t, bz) * inv[2];
  out[15] = 1;
  return out;
}

export function gridPointToWorldMm(domain, gx, gy, gz) {
  const [bx, by, bz] = domain.basis, [dx, dy, dz] = domain.spacingM, o = domain.originWorldM;
  const px = gx * dx, py = gy * dy, pz = gz * dz;
  return [
    (o[0] + bx[0]*px + by[0]*py + bz[0]*pz) * M_TO_MM,
    (o[1] + bx[1]*px + by[1]*py + bz[1]*pz) * M_TO_MM,
    (o[2] + bx[2]*px + by[2]*py + bz[2]*pz) * M_TO_MM
  ];
}

export function worldMmToGrid(domain, worldMm) {
  const [bx, by, bz] = domain.basis, [dx, dy, dz] = domain.spacingM, o = domain.originWorldM;
  const d = [worldMm[0]*MM_TO_M - o[0], worldMm[1]*MM_TO_M - o[1], worldMm[2]*MM_TO_M - o[2]];
  return [dot3(d, bx) / dx, dot3(d, by) / dy, dot3(d, bz) / dz];
}

// ---------- GPU Exact Triangle Voxelizer & Volume Integrator (Buffer + Paged Texture) ----------

function voxelizerWGSL(storage) {
  const tex = storage === 'texture';
  const readHelpers = tex
    ? `fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
       fn idx(i:u32)->u32{return scalar(indices,i);}
       fn val(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`
    : `fn idx(i:u32)->u32{return indices[i];}
       fn val(i:u32)->f32{return positions[i];}`;
  return `
struct VoxCfg {
  matrix: mat4x4f,
  dims: vec4u,
  range: vec4u,
  scale: vec4f
};
@group(0) @binding(0) var<uniform> cfg: VoxCfg;
@group(0) @binding(1) var ${tex ? 'positions: texture_2d_array<u32>' : '<storage,read> positions: array<f32>'};
@group(0) @binding(2) var ${tex ? 'indices: texture_2d_array<u32>' : '<storage,read> indices: array<u32>'};
@group(0) @binding(3) var<storage,read_write> parity: array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> volOut: array<f32>;
${readHelpers}
fn pt(i:u32)->vec3f { return (cfg.matrix * vec4f(val(3u*i), val(3u*i+1u), val(3u*i+2u), 1.0)).xyz; }

fn topLeft(a:vec2f, b:vec2f)->bool { return (b.y > a.y) || (b.y == a.y && b.x < a.x); }
fn edgeCross(a:vec2f, b:vec2f, p:vec2f)->f32 { return (b.x - a.x)*(p.y - a.y) - (b.y - a.y)*(p.x - a.x); }
fn hit2D(p0:vec2f, p1:vec2f, p2:vec2f, q:vec2f)->vec3f {
  var a = p0; var b = p1; var c = p2;
  var area = edgeCross(a, b, c);
  if (abs(area) < 1e-12) { return vec3f(-1.0); }
  var flipped = false;
  if (area < 0.0) { let tmp = b; b = c; c = tmp; area = -area; flipped = true; }
  let e0 = edgeCross(a, b, q);
  let e1 = edgeCross(b, c, q);
  let e2 = edgeCross(c, a, q);
  let ok0 = select(e0 > 0.0, e0 >= 0.0, topLeft(a, b));
  let ok1 = select(e1 > 0.0, e1 >= 0.0, topLeft(b, c));
  let ok2 = select(e2 > 0.0, e2 >= 0.0, topLeft(c, a));
  if (!(ok0 && ok1 && ok2)) { return vec3f(-1.0); }
  let invA = 1.0 / area;
  return select(vec3f(e1*invA, e2*invA, e0*invA), vec3f(e1*invA, e0*invA, e2*invA), flipped);
}

fn satSeparated(axis:vec3f, a:vec3f, b:vec3f, c:vec3f, h:vec3f)->bool {
  let m = max(abs(axis.x), max(abs(axis.y), abs(axis.z)));
  if (m < 1e-12) { return false; }
  let n = axis / m;
  let p = vec3f(dot(a,n), dot(b,n), dot(c,n));
  let r = dot(h, abs(n));
  return min(p.x, min(p.y, p.z)) > r || max(p.x, max(p.y, p.z)) < -r;
}
fn satTouches(a:vec3f, b:vec3f, c:vec3f, h:vec3f)->bool {
  let u = array<vec3f,3>(vec3f(1,0,0), vec3f(0,1,0), vec3f(0,0,1));
  let e = array<vec3f,3>(b-a, c-b, a-c);
  for (var k = 0u; k < 3u; k++) { if (satSeparated(u[k], a, b, c, h)) { return false; } }
  if (satSeparated(cross(e[0], e[1]), a, b, c, h)) { return false; }
  for (var i = 0u; i < 3u; i++) {
    for (var k = 0u; k < 3u; k++) { if (satSeparated(cross(e[i], u[k]), a, b, c, h)) { return false; } }
  }
  return true;
}

@compute @workgroup_size(64)
fn voxelize(@builtin(global_invocation_id) tid: vec3u) {
  let t = cfg.range.x + tid.x;
  if (t >= cfg.range.y) { return; }
  let ia = idx(3u*t); let ib = idx(3u*t+1u); let ic = idx(3u*t+2u);
  if (max(ia, max(ib, ic)) >= cfg.range.z) { return; }
  let a = pt(ia); let b = pt(ib); let c = pt(ic);
  let px = i32(cfg.dims.x); let py = i32(cfg.dims.y); let pz = i32(cfg.dims.z);
  let lo = min(a, min(b, c)); let hi = max(a, max(b, c));

  let x0 = max(0, i32(floor(lo.x - 0.5))); let x1 = min(px - 1, i32(ceil(hi.x - 0.5)));
  let y0 = max(0, i32(floor(lo.y - 0.5))); let y1 = min(py - 1, i32(ceil(hi.y - 0.5)));
  let z0 = max(0, i32(floor(lo.z - 0.5))); let z1 = min(pz - 1, i32(ceil(hi.z - 0.5)));

  if (x0 <= x1 && y0 <= y1) {
    for (var iy = y0; iy <= y1; iy++) {
      for (var ix = x0; ix <= x1; ix++) {
        let w = hit2D(a.xy, b.xy, c.xy, vec2f(f32(ix) + 0.5, f32(iy) + 0.5));
        if (w.x >= 0.0) {
          let zHit = w.x * a.z + w.y * b.z + w.z * c.z;
          let iz = max(0, i32(ceil(zHit - 0.5)));
          if (iz < pz) {
            let cell = u32(ix) + cfg.dims.x * (u32(iy) + cfg.dims.y * u32(iz));
            atomicXor(&parity[cell], 1u);
          }
        }
      }
    }
  }
  if (y0 <= y1 && z0 <= z1) {
    for (var iz = z0; iz <= z1; iz++) {
      for (var iy = y0; iy <= y1; iy++) {
        let w = hit2D(a.yz, b.yz, c.yz, vec2f(f32(iy) + 0.5, f32(iz) + 0.5));
        if (w.x >= 0.0) {
          let xHit = w.x * a.x + w.y * b.x + w.z * c.x;
          let ix = max(0, i32(ceil(xHit - 0.5)));
          if (ix < px) {
            let cell = u32(ix) + cfg.dims.x * (u32(iy) + cfg.dims.y * u32(iz));
            atomicXor(&parity[cell], 2u);
          }
        }
      }
    }
  }
  if (z0 <= z1 && x0 <= x1) {
    for (var ix = x0; ix <= x1; ix++) {
      for (var iz = z0; iz <= z1; iz++) {
        let w = hit2D(vec2f(a.z, a.x), vec2f(b.z, b.x), vec2f(c.z, c.x), vec2f(f32(iz) + 0.5, f32(ix) + 0.5));
        if (w.x >= 0.0) {
          let yHit = w.x * a.y + w.y * b.y + w.z * c.y;
          let iy = max(0, i32(ceil(yHit - 0.5)));
          if (iy < py) {
            let cell = u32(ix) + cfg.dims.x * (u32(iy) + cfg.dims.y * u32(iz));
            atomicXor(&parity[cell], 4u);
          }
        }
      }
    }
  }
  if ((cfg.range.w & 1u) != 0u) {
    let sx0 = max(0, i32(floor(lo.x))); let sx1 = min(px - 1, i32(floor(hi.x)));
    let sy0 = max(0, i32(floor(lo.y))); let sy1 = min(py - 1, i32(floor(hi.y)));
    let sz0 = max(0, i32(floor(lo.z))); let sz1 = min(pz - 1, i32(floor(hi.z)));
    let span = (sx1 - sx0 + 1) * (sy1 - sy0 + 1) * (sz1 - sz0 + 1);
    if (sx0 <= sx1 && sy0 <= sy1 && sz0 <= sz1 && span <= 4096) {
      let h = vec3f(0.495);
      for (var iz = sz0; iz <= sz1; iz++) {
        for (var iy = sy0; iy <= sy1; iy++) {
          for (var ix = sx0; ix <= sx1; ix++) {
            let ctr = vec3f(f32(ix) + 0.5, f32(iy) + 0.5, f32(iz) + 0.5);
            if (satTouches(a - ctr, b - ctr, c - ctr, h)) {
              let cell = u32(ix) + cfg.dims.x * (u32(iy) + cfg.dims.y * u32(iz));
              atomicOr(&parity[cell], 8u);
            }
          }
        }
      }
    }
  }
}

var<workgroup> vSum: array<f32, 64>;
@compute @workgroup_size(64)
fn signedVolume(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let t = cfg.range.x + gid.x;
  var vol = 0.0;
  if (t < cfg.range.y) {
    let ia = idx(3u*t); let ib = idx(3u*t+1u); let ic = idx(3u*t+2u);
    if (max(ia, max(ib, ic)) < cfg.range.z) {
      let a = pt(ia) * cfg.scale.xyz;
      let b = pt(ib) * cfg.scale.xyz;
      let c = pt(ic) * cfg.scale.xyz;
      vol = dot(a, cross(b, c)) / 6.0;
    }
  }
  vSum[lane] = vol;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s /= 2u) {
    if (lane < s) { vSum[lane] += vSum[lane + s]; }
    workgroupBarrier();
  }
  if (lane == 0u) { volOut[wid.x] = vSum[0]; }
}
`;
}

const SCAN_WGSL = `
struct ScanCfg { dims: vec4u };
@group(0) @binding(0) var<uniform> cfg: ScanCfg;
@group(0) @binding(1) var<storage,read_write> parity: array<u32>;
@group(0) @binding(2) var<storage,read_write> packed: array<atomic<u32>>;

@compute @workgroup_size(64)
fn scanZ(@builtin(global_invocation_id) tid: vec3u) {
  let col = tid.x; let xy = cfg.dims.x * cfg.dims.y;
  if (col >= xy) { return; }
  let ix = col % cfg.dims.x; let iy = col / cfg.dims.x;
  var p = 0u;
  for (var iz = 0u; iz < cfg.dims.z; iz++) {
    let cell = ix + cfg.dims.x * (iy + cfg.dims.y * iz);
    let v = parity[cell];
    p ^= (v & 1u);
    parity[cell] = (v & ~1u) | p;
  }
}

@compute @workgroup_size(64)
fn scanX(@builtin(global_invocation_id) tid: vec3u) {
  let col = tid.x; let yz = cfg.dims.y * cfg.dims.z;
  if (col >= yz) { return; }
  let iy = col % cfg.dims.y; let iz = col / cfg.dims.y;
  var p = 0u;
  for (var ix = 0u; ix < cfg.dims.x; ix++) {
    let cell = ix + cfg.dims.x * (iy + cfg.dims.y * iz);
    let v = parity[cell];
    p ^= ((v >> 1u) & 1u);
    parity[cell] = (v & ~2u) | (p << 1u);
  }
}

@compute @workgroup_size(64)
fn scanY(@builtin(global_invocation_id) tid: vec3u) {
  let col = tid.x; let xz = cfg.dims.x * cfg.dims.z;
  if (col >= xz) { return; }
  let ix = col % cfg.dims.x; let iz = col / cfg.dims.x;
  var p = 0u;
  for (var iy = 0u; iy < cfg.dims.y; iy++) {
    let cell = ix + cfg.dims.x * (iy + cfg.dims.y * iz);
    let v = parity[cell];
    p ^= ((v >> 2u) & 1u);
    parity[cell] = (v & ~4u) | (p << 2u);
  }
}

@compute @workgroup_size(64)
fn packBits(@builtin(global_invocation_id) tid: vec3u) {
  let cell = tid.x;
  if (cell >= cfg.dims.w) { return; }
  let v = parity[cell];
  let votes = (v & 1u) + ((v >> 1u) & 1u) + ((v >> 2u) & 1u);
  let solid = (votes >= 2u) || ((v & 8u) != 0u);
  if (solid) { atomicOr(&packed[cell >> 5u], 1u << (cell & 31u)); }
}
`;

async function getVoxelizerPipelines(device, cache) {
  if (cache.has(device)) return cache.get(device);
  const scanMod = device.createShaderModule({label: 'Thermal scan', code: SCAN_WGSL});
  const scanLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const scanPipeLayout = device.createPipelineLayout({bindGroupLayouts: [scanLayout]});
  const mk = async storage => {
    const tex = storage === 'texture';
    const mod = device.createShaderModule({label: 'Thermal vox ' + storage, code: voxelizerWGSL(storage)});
    const layout = device.createBindGroupLayout({
      entries: [
        {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
        tex ? {binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {sampleType: 'uint', viewDimension: '2d-array'}}
            : {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
        tex ? {binding: 2, visibility: GPUShaderStage.COMPUTE, texture: {sampleType: 'uint', viewDimension: '2d-array'}}
            : {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
        {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
        {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
      ]
    });
    const pl = device.createPipelineLayout({bindGroupLayouts: [layout]});
    const [vox, vol] = await Promise.all([
      device.createComputePipelineAsync({layout: pl, compute: {module: mod, entryPoint: 'voxelize'}}),
      device.createComputePipelineAsync({layout: pl, compute: {module: mod, entryPoint: 'signedVolume'}})
    ]);
    return {layout, vox, vol};
  };
  const [buf, tex, scanZ, scanX, scanY, packBits] = await Promise.all([
    mk('buffer'), mk('texture'),
    device.createComputePipelineAsync({layout: scanPipeLayout, compute: {module: scanMod, entryPoint: 'scanZ'}}),
    device.createComputePipelineAsync({layout: scanPipeLayout, compute: {module: scanMod, entryPoint: 'scanX'}}),
    device.createComputePipelineAsync({layout: scanPipeLayout, compute: {module: scanMod, entryPoint: 'scanY'}}),
    device.createComputePipelineAsync({layout: scanPipeLayout, compute: {module: scanMod, entryPoint: 'packBits'}})
  ]);
  const entry = {buffer: buf, texture: tex, scanLayout, scanZ, scanX, scanY, packBits};
  cache.set(device, entry);
  return entry;
}

async function voxelizeOccurrenceGPU(device, mesh, domain, pipes, checkCurrent) {
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const wordCount = Math.ceil(count / 32);
  const triCount = mesh.triangleCount | 0;
  const occ = new Uint32Array(wordCount);
  if (triCount <= 0) return {occupancy: occ, activeCount: 0, volumeM3: 0};

  const pSet = pipes[mesh.storage === 'texture' ? 'texture' : 'buffer'];
  const parityBuf = device.createBuffer({label: 'Thermal parity', size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
  const packedBuf = device.createBuffer({label: 'Thermal packed', size: wordCount * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST});
  const readPacked = device.createBuffer({label: 'Thermal packed read', size: wordCount * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  const maxWG = Math.min(65535, Math.max(1, Math.ceil(triCount / 64)));
  const volBuf = device.createBuffer({label: 'Thermal vol', size: maxWG * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
  const readVol = device.createBuffer({label: 'Thermal vol read', size: maxWG * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  const cfgBuf = device.createBuffer({label: 'Thermal vox cfg', size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const scanCfgBuf = device.createBuffer({label: 'Thermal scan cfg', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});

  try {
    const mat = meshToGridMatrix(mesh.worldMatrix, domain);
    const cfgData = new ArrayBuffer(112);
    new Float32Array(cfgData, 0, 16).set(mat);
    new Uint32Array(cfgData, 64, 4).set([nx, ny, nz, count]);
    new Uint32Array(cfgData, 80, 4).set([0, triCount, mesh.vertexCount | 0, 1]);
    new Float32Array(cfgData, 96, 4).set([domain.spacingM[0], domain.spacingM[1], domain.spacingM[2], 0]);
    device.queue.writeBuffer(cfgBuf, 0, cfgData);
    device.queue.writeBuffer(scanCfgBuf, 0, new Uint32Array([nx, ny, nz, count]));

    const posRes = mesh.storage === 'texture' ? mesh.positions.createView() : {buffer: mesh.positions};
    const idxRes = mesh.storage === 'texture' ? mesh.indices.createView() : {buffer: mesh.indices};
    const voxBG = device.createBindGroup({
      layout: pSet.layout,
      entries: [
        {binding: 0, resource: {buffer: cfgBuf}},
        {binding: 1, resource: posRes},
        {binding: 2, resource: idxRes},
        {binding: 3, resource: {buffer: parityBuf}},
        {binding: 4, resource: {buffer: volBuf}}
      ]
    });
    const scanBG = device.createBindGroup({
      layout: pipes.scanLayout,
      entries: [
        {binding: 0, resource: {buffer: scanCfgBuf}},
        {binding: 1, resource: {buffer: parityBuf}},
        {binding: 2, resource: {buffer: packedBuf}}
      ]
    });

    const chunkTris = 65535 * 64;
    let totalVolM3 = 0;
    const enc0 = device.createCommandEncoder();
    enc0.clearBuffer(parityBuf);
    enc0.clearBuffer(packedBuf);
    device.queue.submit([enc0.finish()]);

    for (let start = 0; start < triCount; start += chunkTris) {
      checkCurrent?.();
      const end = Math.min(triCount, start + chunkTris);
      const wg = Math.ceil((end - start) / 64);
      new Uint32Array(cfgData, 80, 4).set([start, end, mesh.vertexCount | 0, 1]);
      device.queue.writeBuffer(cfgBuf, 80, new Uint32Array(cfgData, 80, 4));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pSet.vox); pass.setBindGroup(0, voxBG); pass.dispatchWorkgroups(wg);
      pass.setPipeline(pSet.vol); pass.setBindGroup(0, voxBG); pass.dispatchWorkgroups(wg);
      pass.end();
      enc.copyBufferToBuffer(volBuf, 0, readVol, 0, wg * 4);
      device.queue.submit([enc.finish()]);
      await readVol.mapAsync(GPUMapMode.READ, 0, wg * 4);
      const sums = new Float32Array(readVol.getMappedRange(0, wg * 4));
      let partial = 0;
      for (let i = 0; i < wg; i++) partial += sums[i];
      readVol.unmap();
      totalVolM3 += partial;
    }

    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, scanBG);
    pass.setPipeline(pipes.scanZ); pass.dispatchWorkgroups(Math.ceil((nx * ny) / 64));
    pass.setPipeline(pipes.scanX); pass.dispatchWorkgroups(Math.ceil((ny * nz) / 64));
    pass.setPipeline(pipes.scanY); pass.dispatchWorkgroups(Math.ceil((nx * nz) / 64));
    pass.setPipeline(pipes.packBits); pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    enc.copyBufferToBuffer(packedBuf, 0, readPacked, 0, wordCount * 4);
    device.queue.submit([enc.finish()]);

    await readPacked.mapAsync(GPUMapMode.READ);
    occ.set(new Uint32Array(readPacked.getMappedRange()));
    readPacked.unmap();

    let activeCount = 0;
    for (let i = 0; i < count; i++) if ((occ[i >> 5] >>> (i & 31)) & 1) activeCount++;
    const cellVol = domain.spacingM[0] * domain.spacingM[1] * domain.spacingM[2];
    const volumeM3 = Math.abs(totalVolM3) > 1e-18 ? Math.abs(totalVolM3) : activeCount * cellVol;
    return {occupancy: occ, activeCount, volumeM3};
  } finally {
    parityBuf.destroy(); packedBuf.destroy(); readPacked.destroy();
    volBuf.destroy(); readVol.destroy(); cfgBuf.destroy(); scanCfgBuf.destroy();
  }
}

// ---------- Thermal Model Assembly ----------

export function buildThermalModel({domain, mediumName, ambientC, initialC, solidBodies, heaterSources, fans = []}) {
  const medium = MEDIA[mediumName] || MEDIA.Air;
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const cellVol = domain.spacingM[0] * domain.spacingM[1] * domain.spacingM[2];
  const cellType = new Uint8Array(count);      // 0=FLUID, 1=SOLID, 2=FIXED_T
  const cellK = new Float32Array(count);
  const cellRhoCp = new Float32Array(count);
  const cellEmissivity = new Float32Array(count);
  const cellPowerW = new Float32Array(count);
  const cellFixedTheta = new Float32Array(count);
  const cellRole = new Uint8Array(count);
  const cellMatIdx = new Int16Array(count).fill(-1);
  const cellFanIdx = new Int16Array(count).fill(-1);

  const fluidRhoCp = medium.rho * medium.cp;
  cellK.fill(medium.k);
  cellRhoCp.fill(fluidRhoCp);
  cellRole.fill(ROLE.FLUID);

  const materials = [];
  const matKeyMap = new Map();
  const internMat = props => {
    const key = props.custom
      ? `custom:${props.k}:${props.rho}:${props.cp}:${props.emissivity}`
      : `${props.name}:${props.fallback ? 1 : 0}`;
    if (matKeyMap.has(key)) return matKeyMap.get(key);
    const id = materials.length;
    materials.push(props);
    matKeyMap.set(key, id);
    return id;
  };

  for (const body of solidBodies) {
    const matIdx = internMat(body.material);
    const props = materials[matIdx];
    const occ = body.occupancy;
    const isFixed = body.fixedTempC !== null && body.fixedTempC !== undefined;
    const fixedTheta = isFixed ? (body.fixedTempC - ambientC) : 0;
    const rhoCp = props.rho * props.cp;
    for (let i = 0; i < count; i++) {
      if (!((occ[i >> 5] >>> (i & 31)) & 1)) continue;
      cellType[i] = isFixed ? CELL_TYPE.FIXED_T : CELL_TYPE.SOLID;
      cellK[i] = props.k;
      cellRhoCp[i] = rhoCp;
      cellEmissivity[i] = props.emissivity;
      cellMatIdx[i] = matIdx;
      if (isFixed) {
        cellFixedTheta[i] = fixedTheta;
        cellRole[i] = ROLE.FIXED_T;
      } else if (cellRole[i] !== ROLE.FIXED_T) {
        cellRole[i] = props.fallback ? ROLE.FALLBACK : ROLE.MATERIAL;
      }
    }
  }

  // Distribute additive heater sources uniformly over their active non-fixed solid cells.
  let totalHeaterPowerW = 0, positiveHeaterW = 0, negativeHeaterW = 0;
  const heaterStats = [];
  for (const h of heaterSources) {
    let activeCells = 0;
    const occ = h.occupancy;
    for (let i = 0; i < count; i++) {
      if (((occ[i >> 5] >>> (i & 31)) & 1) && cellType[i] === CELL_TYPE.SOLID) activeCells++;
    }
    if (activeCells === 0) continue;
    const insideVol = activeCells * cellVol;
    const frac = domain.autoSize ? 1 : clamp(insideVol / Math.max(insideVol, h.totalVolumeM3 || insideVol), 0, 1);
    const effPowerW = h.powerW * frac;
    const perCellW = effPowerW / activeCells;
    for (let i = 0; i < count; i++) {
      if (((occ[i >> 5] >>> (i & 31)) & 1) && cellType[i] === CELL_TYPE.SOLID) {
        cellPowerW[i] += perCellW;
        if (perCellW > 0 && cellRole[i] !== ROLE.FIXED_T) cellRole[i] = ROLE.HEATER;
        else if (perCellW < 0 && cellRole[i] !== ROLE.FIXED_T && cellRole[i] !== ROLE.HEATER) cellRole[i] = ROLE.COOLER;
      }
    }
    totalHeaterPowerW += effPowerW;
    if (effPowerW >= 0) positiveHeaterW += effPowerW; else negativeHeaterW += effPowerW;
    heaterStats.push({ownerHash: h.ownerHash, uid: h.uid, authoredW: h.powerW, appliedW: effPowerW, frac, cells: activeCells, occupancy: h.occupancy});
  }

  // Rasterize oriented 3D Fan actuator zones into FLUID cells only.
  const activeFans = [];
  if (!medium.isVacuum) {
    for (const f of fans) {
      if (!f.invWorld || !f.axisGrid) continue;
      const fanIdx = activeFans.length;
      let fanCells = 0;
      const halfPadX = Math.max(50, 0.65 * (domain.spacingM[0] * M_TO_MM / Math.max(1e-6, f.scales[0])));
      const halfPadY = Math.max(50, 0.55 * (domain.spacingM[1] * M_TO_MM / Math.max(1e-6, f.scales[1])));
      const halfPadZ = Math.max(50, 0.55 * (domain.spacingM[2] * M_TO_MM / Math.max(1e-6, f.scales[2])));
      const inv = f.invWorld;
      for (let iz = 0; iz < nz; iz++) {
        for (let iy = 0; iy < ny; iy++) {
          for (let ix = 0; ix < nx; ix++) {
            const c = ix + nx * (iy + ny * iz);
            if (cellType[c] !== CELL_TYPE.FLUID) continue;
            const w = gridPointToWorldMm(domain, ix + 0.5, iy + 0.5, iz + 0.5);
            const lx = inv[0]*w[0] + inv[4]*w[1] + inv[8]*w[2] + inv[12];
            const ly = inv[1]*w[0] + inv[5]*w[1] + inv[9]*w[2] + inv[13];
            const lz = inv[2]*w[0] + inv[6]*w[1] + inv[10]*w[2] + inv[14];
            if (Math.abs(lx) <= halfPadX && Math.abs(ly) <= halfPadY && Math.abs(lz) <= halfPadZ) {
              cellFanIdx[c] = fanIdx;
              cellRole[c] = ROLE.FAN;
              fanCells++;
            }
          }
        }
      }
      if (fanCells > 0) {
        activeFans.push({
          ...f,
          index: fanIdx,
          cellCount: fanCells,
          areaM2: Math.max(1e-6, f.areaM2),
          thicknessM: Math.max(domain.spacingM[0], f.thicknessM)
        });
      }
    }
  }

  let solidCount = 0, fixedCount = 0, fluidCount = 0, fallbackCount = 0;
  for (let i = 0; i < count; i++) {
    if (cellType[i] === CELL_TYPE.FLUID) fluidCount++;
    else {
      solidCount++;
      if (cellType[i] === CELL_TYPE.FIXED_T) fixedCount++;
      if (cellMatIdx[i] >= 0 && materials[cellMatIdx[i]]?.fallback) fallbackCount++;
    }
  }

  const charLenM = Math.max(0.005, Math.cbrt(Math.max(1, solidCount) * cellVol));
  return {
    domain, medium, mediumName: medium.name, ambientC, initialC,
    cellVol, charLenM,
    cellType, cellK, cellRhoCp, cellEmissivity, cellPowerW, cellFixedTheta, cellRole, cellMatIdx, cellFanIdx,
    materials, fans: activeFans, heaterStats,
    stats: {
      cells: count, solidCount, fixedCount, fluidCount, fallbackCount,
      fanCount: activeFans.length,
      totalHeaterPowerW, positiveHeaterW, negativeHeaterW
    }
  };
}

// ---------- GPU Fluid Flow + Buoyancy + Fan P-Q Actuator (WGSL, <= 7 Storage Buffers) ----------

const FLUID_WGSL = `
struct FluidCfg {
  dims: vec4u,     // nx, ny, nz, count
  spacing: vec4f,  // dx, dy, dz, dt
  phys: vec4f,     // rho, nu, beta, maxSpeed
  grav: vec4f,     // gx, gy, gz, omegaSOR
  rb: vec4u        // parity (0 or 1), numFans, unused, unused
};
@group(0) @binding(0) var<uniform> cfg: FluidCfg;
@group(0) @binding(1) var<storage,read> cellMeta: array<u32>;
@group(0) @binding(2) var<storage,read> velIn: array<vec4f>;
@group(0) @binding(3) var<storage,read_write> velOut: array<vec4f>;
@group(0) @binding(4) var<storage,read_write> pres: array<f32>;
@group(0) @binding(5) var<storage,read_write> divBuf: array<f32>;
@group(0) @binding(6) var<storage,read> thermalA: array<vec4f>;
@group(0) @binding(7) var<storage,read> fanForces: array<vec4f>; // (ax, ay, az, lateralDamp)

fn idx3(x: u32, y: u32, z: u32) -> u32 { return x + cfg.dims.x * (y + cfg.dims.y * z); }
fn isFluid(c: u32) -> bool { return (cellMeta[c] & 0xffu) == 0u; }

fn sampleVel(p: vec3f) -> vec3f {
  let fx = clamp(p.x, 0.0, f32(cfg.dims.x) - 1.0001);
  let fy = clamp(p.y, 0.0, f32(cfg.dims.y) - 1.0001);
  let fz = clamp(p.z, 0.0, f32(cfg.dims.z) - 1.0001);
  let x0 = u32(floor(fx)); let y0 = u32(floor(fy)); let z0 = u32(floor(fz));
  let x1 = min(x0 + 1u, cfg.dims.x - 1u);
  let y1 = min(y0 + 1u, cfg.dims.y - 1u);
  let z1 = min(z0 + 1u, cfg.dims.z - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0); let tz = fz - f32(z0);
  var sum = vec3f(0.0);
  var wsum = 0.0;
  for (var dz = 0u; dz < 2u; dz++) {
    let wz = select(1.0 - tz, tz, dz == 1u);
    let cz = select(z0, z1, dz == 1u);
    for (var dy = 0u; dy < 2u; dy++) {
      let wy = select(1.0 - ty, ty, dy == 1u);
      let cy = select(y0, y1, dy == 1u);
      for (var dx = 0u; dx < 2u; dx++) {
        let wx = select(1.0 - tx, tx, dx == 1u);
        let cx = select(x0, x1, dx == 1u);
        let w = wx * wy * wz;
        let ci = idx3(cx, cy, cz);
        if (isFluid(ci)) {
          sum += w * velIn[ci].xyz;
        }
        wsum += w;
      }
    }
  }
  return select(vec3f(0.0), sum / wsum, wsum > 1e-6);
}

@compute @workgroup_size(64)
fn advectAndForce(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  if (!isFluid(c)) { velOut[c] = vec4f(0.0); return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let dt = cfg.spacing.w;
  let u0 = velIn[c].xyz;
  // Semi-Lagrangian backtrace (unconditionally CFL stable)
  let back = vec3f(f32(x), f32(y), f32(z)) - dt * (u0 / cfg.spacing.xyz);
  var u = sampleVel(back);

  // Viscous + Smagorinsky subgrid eddy diffusion (clamped for explicit stability)
  let dx = cfg.spacing.x; let dy = cfg.spacing.y; let dz = cfg.spacing.z;
  let dMin = min(dx, min(dy, dz));
  let uxm = select(vec3f(0.0), velIn[idx3(x - 1u, y, z)].xyz, x > 0u && isFluid(idx3(x - 1u, y, z)));
  let uxp = select(vec3f(0.0), velIn[idx3(x + 1u, y, z)].xyz, x + 1u < nx && isFluid(idx3(x + 1u, y, z)));
  let uym = select(vec3f(0.0), velIn[idx3(x, y - 1u, z)].xyz, y > 0u && isFluid(idx3(x, y - 1u, z)));
  let uyp = select(vec3f(0.0), velIn[idx3(x, y + 1u, z)].xyz, y + 1u < ny && isFluid(idx3(x, y + 1u, z)));
  let uzm = select(vec3f(0.0), velIn[idx3(x, y, z - 1u)].xyz, z > 0u && isFluid(idx3(x, y, z - 1u)));
  let uzp = select(vec3f(0.0), velIn[idx3(x, y, z + 1u)].xyz, z + 1u < nz && isFluid(idx3(x, y, z + 1u)));

  let gradMag = length((uxp - uxm) / (2.0 * dx)) + length((uyp - uym) / (2.0 * dy)) + length((uzp - uzm) / (2.0 * dz));
  let nuTurb = (0.17 * dMin) * (0.17 * dMin) * gradMag;
  let nuEff = min(cfg.phys.y + nuTurb, 0.14 * dMin * dMin / max(dt, 1e-6));
  // For exterior boundary faces, use zero-gradient (copy u0) for diffusion; solid walls use no-slip (0)
  let vxm = select(select(u0, vec3f(0.0), x > 0u), uxm, x > 0u && isFluid(idx3(x - 1u, y, z)));
  let vxp = select(select(u0, vec3f(0.0), x + 1u < nx), uxp, x + 1u < nx && isFluid(idx3(x + 1u, y, z)));
  let vym = select(select(u0, vec3f(0.0), y > 0u), uym, y > 0u && isFluid(idx3(x, y - 1u, z)));
  let vyp = select(select(u0, vec3f(0.0), y + 1u < ny), uyp, y + 1u < ny && isFluid(idx3(x, y + 1u, z)));
  let vzm = select(select(u0, vec3f(0.0), z > 0u), uzm, z > 0u && isFluid(idx3(x, y, z - 1u)));
  let vzp = select(select(u0, vec3f(0.0), z + 1u < nz), uzp, z + 1u < nz && isFluid(idx3(x, y, z + 1u)));
  let lap = (vxm + vxp - 2.0 * u0) / (dx * dx) + (vym + vyp - 2.0 * u0) / (dy * dy) + (vzm + vzp - 2.0 * u0) / (dz * dz);
  u += dt * nuEff * lap;

  // Boussinesq buoyancy acceleration: a_b = -beta * theta * g  (points +Y upward for warm fluid!)
  let theta = clamp(thermalA[c].x, -250.0, 1500.0);
  u += dt * (-cfg.phys.z * theta) * cfg.grav.xyz;

  // Fan actuator momentum forcing (P-Q curve + lateral straightening)
  let fanTag = cellMeta[c] >> 8u;
  if (fanTag > 0u && fanTag <= cfg.rb.y) {
    let ff = fanForces[fanTag - 1u];
    let dir = fanForces[cfg.rb.y + fanTag - 1u].xyz;
    let vn = dot(u, dir);
    let uLat = u - vn * dir;
    u += dt * ff.xyz - clamp(dt * ff.w, 0.0, 0.45) * uLat;
  }

  let spd = length(u);
  if (spd > cfg.phys.w) { u = u * (cfg.phys.w / spd); }
  velOut[c] = vec4f(u, min(spd, cfg.phys.w));
}

@compute @workgroup_size(64)
fn computeDivergence(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  if (!isFluid(c)) { divBuf[c] = 0.0; pres[c] = 0.0; return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let uc = velIn[c].xyz;
  // Face normal velocities: 0 on solid walls, cell value on open exterior boundary
  let uxm = select(uc.x, select(0.0, 0.5 * (uc.x + velIn[idx3(x - 1u, y, z)].x), isFluid(idx3(x - 1u, y, z))), x > 0u);
  let uxp = select(uc.x, select(0.0, 0.5 * (uc.x + velIn[idx3(x + 1u, y, z)].x), isFluid(idx3(x + 1u, y, z))), x + 1u < nx);
  let uym = select(uc.y, select(0.0, 0.5 * (uc.y + velIn[idx3(x, y - 1u, z)].y), isFluid(idx3(x, y - 1u, z))), y > 0u);
  let uyp = select(uc.y, select(0.0, 0.5 * (uc.y + velIn[idx3(x, y + 1u, z)].y), isFluid(idx3(x, y + 1u, z))), y + 1u < ny);
  let uzm = select(uc.z, select(0.0, 0.5 * (uc.z + velIn[idx3(x, y, z - 1u)].z), isFluid(idx3(x, y, z - 1u))), z > 0u);
  let uzp = select(uc.z, select(0.0, 0.5 * (uc.z + velIn[idx3(x, y, z + 1u)].z), isFluid(idx3(x, y, z + 1u))), z + 1u < nz);
  let div = (uxp - uxm) / cfg.spacing.x + (uyp - uym) / cfg.spacing.y + (uzp - uzm) / cfg.spacing.z;
  divBuf[c] = (cfg.phys.x / max(cfg.spacing.w, 1e-6)) * div;
}

@compute @workgroup_size(64)
fn pressureRB(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  if (!isFluid(c)) { return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  if (((x + y + z) & 1u) != cfg.rb.x) { return; }
  let invDx2 = 1.0 / (cfg.spacing.x * cfg.spacing.x);
  let invDy2 = 1.0 / (cfg.spacing.y * cfg.spacing.y);
  let invDz2 = 1.0 / (cfg.spacing.z * cfg.spacing.z);
  var sum = -divBuf[c];
  var diag = 0.0;
  // Open domain exterior -> p = 0 (Dirichlet); Solid neighbor -> dp/dn = 0 (Neumann)
  if (x == 0u) { diag += 2.0 * invDx2; } else { let n = idx3(x - 1u, y, z); if (isFluid(n)) { sum += pres[n] * invDx2; diag += invDx2; } }
  if (x + 1u == nx) { diag += 2.0 * invDx2; } else { let n = idx3(x + 1u, y, z); if (isFluid(n)) { sum += pres[n] * invDx2; diag += invDx2; } }
  if (y == 0u) { diag += 2.0 * invDy2; } else { let n = idx3(x, y - 1u, z); if (isFluid(n)) { sum += pres[n] * invDy2; diag += invDy2; } }
  if (y + 1u == ny) { diag += 2.0 * invDy2; } else { let n = idx3(x, y + 1u, z); if (isFluid(n)) { sum += pres[n] * invDy2; diag += invDy2; } }
  if (z == 0u) { diag += 2.0 * invDz2; } else { let n = idx3(x, y, z - 1u); if (isFluid(n)) { sum += pres[n] * invDz2; diag += invDz2; } }
  if (z + 1u == nz) { diag += 2.0 * invDz2; } else { let n = idx3(x, y, z + 1u); if (isFluid(n)) { sum += pres[n] * invDz2; diag += invDz2; } }
  if (diag > 1e-12) {
    let pNew = sum / diag;
    pres[c] = pres[c] + cfg.grav.w * (pNew - pres[c]);
  }
}

@compute @workgroup_size(64)
fn projectVelocity(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  if (!isFluid(c)) { velOut[c] = vec4f(0.0); return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let pc = pres[c];
  let scale = cfg.spacing.w / cfg.phys.x;
  let pxm = select(0.0, select(pc, pres[idx3(x - 1u, y, z)], isFluid(idx3(x - 1u, y, z))), x > 0u);
  let pxp = select(0.0, select(pc, pres[idx3(x + 1u, y, z)], isFluid(idx3(x + 1u, y, z))), x + 1u < nx);
  let pym = select(0.0, select(pc, pres[idx3(x, y - 1u, z)], isFluid(idx3(x, y - 1u, z))), y > 0u);
  let pyp = select(0.0, select(pc, pres[idx3(x, y + 1u, z)], isFluid(idx3(x, y + 1u, z))), y + 1u < ny);
  let pzm = select(0.0, select(pc, pres[idx3(x, y, z - 1u)], isFluid(idx3(x, y, z - 1u))), z > 0u);
  let pzp = select(0.0, select(pc, pres[idx3(x, y, z + 1u)], isFluid(idx3(x, y, z + 1u))), z + 1u < nz);
  let gx = (pxp - pxm) / (select(2.0, 1.5, x == 0u || x + 1u == nx) * cfg.spacing.x);
  let gy = (pyp - pym) / (select(2.0, 1.5, y == 0u || y + 1u == ny) * cfg.spacing.y);
  let gz = (pzp - pzm) / (select(2.0, 1.5, z == 0u || z + 1u == nz) * cfg.spacing.z);
  var u = velIn[c].xyz - scale * vec3f(gx, gy, gz);
  let spd = length(u);
  if (spd > cfg.phys.w) { u = u * (cfg.phys.w / spd); }
  velOut[c] = vec4f(u, min(spd, cfg.phys.w));
}
`;

// Dedicated tiny pass to accumulate axial velocity inside each Fan zone without full-grid readback.
const FAN_FLOW_WGSL = `
struct FanStatCfg { dims: vec4u }; // count, numFans, unused, unused
@group(0) @binding(0) var<uniform> cfg: FanStatCfg;
@group(0) @binding(1) var<storage,read> cellMeta: array<u32>;
@group(0) @binding(2) var<storage,read> vel: array<vec4f>;
@group(0) @binding(3) var<storage,read> fanDirs: array<vec4f>;
@group(0) @binding(4) var<storage,read_write> accum: array<atomic<i32>>;

@compute @workgroup_size(64)
fn accumFans(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.x) { return; }
  let fanTag = cellMeta[c] >> 8u;
  if (fanTag == 0u || fanTag > cfg.dims.y) { return; }
  let fi = fanTag - 1u;
  let vn = dot(vel[c].xyz, fanDirs[fi].xyz);
  atomicAdd(&accum[fi], i32(round(clamp(vn, -200.0, 200.0) * 10000.0)));
}
`;

// ---------- GPU Implicit Energy Assembly + Row-Normalized BiCGSTAB + RB-SOR Polish (<= 7 Storage Buffers) ----------

const ASSEMBLE_WGSL = `
struct AsmCfg {
  dims: vec4u,      // nx, ny, nz, count
  spacing: vec4f,   // dx, dy, dz, invDt (0 for steady-state)
  fluidA: vec4f,    // rhoF, cpF, kF, muF
  fluidB: vec4f,    // prF, betaF, gMag, charLenM
  amb: vec4f        // tAmbK, isVacuum (0/1), radScale (1), unused
};
@group(0) @binding(0) var<uniform> cfg: AsmCfg;
@group(0) @binding(1) var<storage,read> cellProps: array<vec4f>; // (k, rhoCp, eps, powerW)
@group(0) @binding(2) var<storage,read> cellFlags: array<vec4f>; // (type, fixedTheta, 0, 0)
@group(0) @binding(3) var<storage,read> vel: array<vec4f>;
@group(0) @binding(4) var<storage,read> vecA: array<vec4f>;      // .x = current theta*
@group(0) @binding(5) var<storage,read> vecB: array<vec4f>;      // .w = thetaOld
@group(0) @binding(6) var<storage,read_write> matOffA: array<vec4f>; // normalized (axm, axp, aym, ayp)
@group(0) @binding(7) var<storage,read_write> matOffB: array<vec4f>; // (azm/d, azp/d, diag, rhs/d)

const SIGMA: f32 = 5.670374419e-8;

fn idx3(x: u32, y: u32, z: u32) -> u32 { return x + cfg.dims.x * (y + cfg.dims.y * z); }

fn radNewton(eps: f32, thetaS: f32) -> vec2f {
  // Returns (hTan [W/(m2 K)] for diagonal, qOffset [W/m2] for RHS)
  // Exact Newton linearization of eps*sigma*(T^4 - Tamb^4) around thetaS:
  //   hTan * theta - qOffset = eps*sigma*(Ts^4 - Tamb^4) + 4*eps*sigma*Ts^3*(theta - thetaS)
  if (eps <= 0.0 || cfg.amb.z <= 0.0) { return vec2f(0.0); }
  let tAmbK = cfg.amb.x;
  let tsK = clamp(thetaS + tAmbK, 1.0, 5000.0);
  let ts2 = tsK * tsK;
  let ta2 = tAmbK * tAmbK;
  let hTan = 4.0 * eps * SIGMA * ts2 * tsK;
  let qExact = eps * SIGMA * (ts2 * ts2 - ta2 * ta2);
  let qOffset = hTan * (tsK - tAmbK) - qExact;
  return vec2f(hTan, qOffset);
}

fn hConvection(dT: f32, vFluid: f32, dFace: f32) -> f32 {
  let rho = cfg.fluidA.x; let cp = cfg.fluidA.y; let kf = cfg.fluidA.z; let mu = cfg.fluidA.w;
  let pr = cfg.fluidB.x; let beta = cfg.fluidB.y; let g = cfg.fluidB.z; let Lc = cfg.fluidB.w;
  let dTabs = max(abs(dT), 0.05);
  // Churchill-Chu natural convection correlation
  let ra = g * beta * dTabs * Lc * Lc * Lc * rho * rho * cp / max(mu * kf, 1e-18);
  let nuLam = 0.68 + 0.67 * pow(ra, 0.25) / pow(1.0 + pow(0.492 / max(pr, 0.01), 0.5625), 0.4444444);
  let nuTurb = 0.10 * pow(ra, 0.3333333);
  let hNat = kf * select(nuLam, max(nuLam, nuTurb), ra > 1e8) / Lc;
  // Forced convection flat-plate / channel blend from local adjacent fluid speed
  let re = rho * max(vFluid, 0.0) * Lc / max(mu, 1e-12);
  let pr13 = pow(max(pr, 0.01), 0.3333333);
  let nuFor = select(0.664 * sqrt(re) * pr13, 0.037 * pow(re, 0.8) * pr13, re > 5e5);
  let hFor = kf * nuFor / Lc;
  // Churchill mixed convection + exact fine-grid molecular floor
  let hMix = pow(hNat * hNat * hNat + hFor * hFor * hFor, 0.3333333);
  let hFloor = 2.0 * kf / max(dFace, 1e-6);
  return max(hMix, hFloor);
}

@compute @workgroup_size(64)
fn assembleEnergy(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  let flags = cellFlags[c];
  let cType = u32(flags.x + 0.5);
  let isVac = cfg.amb.y > 0.5;

  if (cType == 2u) {
    matOffA[c] = vec4f(0.0);
    matOffB[c] = vec4f(0.0, 0.0, 1.0, flags.y);
    return;
  }
  if (cType == 0u && isVac) {
    matOffA[c] = vec4f(0.0);
    matOffB[c] = vec4f(0.0, 0.0, 1.0, 0.0);
    return;
  }

  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let dx = cfg.spacing.x; let dy = cfg.spacing.y; let dz = cfg.spacing.z;
  let vol = dx * dy * dz;
  let props = cellProps[c];
  let ki = props.x; let rhoCp = props.y; let eps = props.z; let powerW = props.w;
  let thetaI = vecA[c].x;
  let ui = vel[c].xyz;

  var diag = 0.0;
  var rhs = powerW;
  if (cfg.spacing.w > 0.0) {
    let capRate = rhoCp * vol * cfg.spacing.w;
    diag += capRate;
    rhs += capRate * vecB[c].w;
  }

  var coeffs = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  let areas = array<f32, 6>(dy * dz, dy * dz, dx * dz, dx * dz, dx * dy, dx * dy);
  let dists = array<f32, 6>(dx, dx, dy, dy, dz, dz);
  let rhoCpF = cfg.fluidA.x * cfg.fluidA.y;
  let kF = cfg.fluidA.z;

  for (var f = 0u; f < 6u; f++) {
    let Af = areas[f];
    let df = dists[f];
    var hasNbr = false;
    var j = 0u;
    var uAxisI = 0.0;
    var faceSign = 1.0;
    if (f == 0u) { hasNbr = x > 0u; if (hasNbr) { j = idx3(x - 1u, y, z); } uAxisI = ui.x; faceSign = -1.0; }
    else if (f == 1u) { hasNbr = x + 1u < nx; if (hasNbr) { j = idx3(x + 1u, y, z); } uAxisI = ui.x; faceSign = 1.0; }
    else if (f == 2u) { hasNbr = y > 0u; if (hasNbr) { j = idx3(x, y - 1u, z); } uAxisI = ui.y; faceSign = -1.0; }
    else if (f == 3u) { hasNbr = y + 1u < ny; if (hasNbr) { j = idx3(x, y + 1u, z); } uAxisI = ui.y; faceSign = 1.0; }
    else if (f == 4u) { hasNbr = z > 0u; if (hasNbr) { j = idx3(x, y, z - 1u); } uAxisI = ui.z; faceSign = -1.0; }
    else { hasNbr = z + 1u < nz; if (hasNbr) { j = idx3(x, y, z + 1u); } uAxisI = ui.z; faceSign = 1.0; }

    if (hasNbr) {
      let nFlags = cellFlags[j];
      let nType = u32(nFlags.x + 0.5);
      let nProps = cellProps[j];
      if (cType == 1u && nType >= 1u) {
        // Solid - Solid harmonic interface conductance
        let G = Af * (2.0 * ki * nProps.x) / max((ki + nProps.x) * df, 1e-18);
        if (nType == 2u) {
          diag += G;
          rhs += G * nFlags.y;
        } else {
          coeffs[f] = G;
          diag += G;
        }
      } else if (cType == 1u && nType == 0u) {
        // Solid i facing Fluid j
        let rn = radNewton(eps, thetaI);
        diag += Af * rn.x;
        rhs += Af * rn.y;
        if (!isVac) {
          let vf = vel[j].w;
          let hc = hConvection(thetaI - vecA[j].x, vf, df);
          let Gc = Af / (df / (2.0 * ki) + 1.0 / hc);
          coeffs[f] = Gc;
          diag += Gc;
        }
      } else if (cType == 0u && nType >= 1u) {
        // Fluid i facing Solid j (exact symmetric conductance Gc!)
        let ks = nProps.x;
        let vf = vel[c].w;
        let ts = select(vecA[j].x, nFlags.y, nType == 2u);
        let hc = hConvection(ts - thetaI, vf, df);
        let Gc = Af / (df / (2.0 * ks) + 1.0 / hc);
        if (nType == 2u) {
          diag += Gc;
          rhs += Gc * nFlags.y;
        } else {
          coeffs[f] = Gc;
          diag += Gc;
        }
      } else {
        // Fluid i - Fluid j: diffusion + conservative first-order upwind enthalpy advection
        let uj = vel[j].xyz;
        var uAxisJ = 0.0;
        if (f < 2u) { uAxisJ = uj.x; } else if (f < 4u) { uAxisJ = uj.y; } else { uAxisJ = uj.z; }
        let uFace = 0.5 * (uAxisI + uAxisJ) * faceSign;
        let F = rhoCpF * Af * uFace;
        let kEff = kF + 0.02 * rhoCpF * df * abs(uFace);
        let Gdiff = Af * kEff / df;
        coeffs[f] = Gdiff + max(-F, 0.0);
        diag += Gdiff + max(F, 0.0);
      }
    } else {
      // Exterior domain boundary face
      if (cType == 1u) {
        let rn = radNewton(eps, thetaI);
        var Gext = Af * rn.x;
        rhs += Af * rn.y;
        if (!isVac) {
          let hc = hConvection(thetaI, 0.0, df);
          Gext += Af / (df / (2.0 * ki) + 1.0 / hc);
        }
        diag += Gext;
      } else {
        // Open fluid boundary to Ambient (theta = 0)
        let uOut = uAxisI * faceSign;
        let F = rhoCpF * Af * uOut;
        let Gb = Af * kF / (0.5 * df);
        if (uOut < 0.0) {
          diag += Gb + (-F);
        } else {
          diag += F + 0.15 * Gb;
        }
      }
    }
  }

  let safeDiag = max(diag, 1e-18);
  let invD = 1.0 / safeDiag;
  matOffA[c] = vec4f(coeffs[0] * invD, coeffs[1] * invD, coeffs[2] * invD, coeffs[3] * invD);
  matOffB[c] = vec4f(coeffs[4] * invD, coeffs[5] * invD, safeDiag, rhs * invD);
}
`;

// Row-normalized GPU BiCGSTAB + Red-Black SOR polish (uses exactly 6 storage buffers!)
const BICG_WGSL = `
struct SolverCfg {
  dims: vec4u,    // nx, ny, nz, count
  counts: vec4u,  // wgCount, rbParity, unused, unused
  params: vec4f   // omegaSOR, unused, unused, unused
};
struct SolverScalars {
  rho: f32, alpha: f32, omega: f32, beta: f32,
  normR2: f32, normB2: f32, denom: f32, status: u32
};
@group(0) @binding(0) var<uniform> cfg: SolverCfg;
@group(0) @binding(1) var<storage,read> matOffA: array<vec4f>;
@group(0) @binding(2) var<storage,read> matOffB: array<vec4f>;
@group(0) @binding(3) var<storage,read_write> vecA: array<vec4f>; // x, r, r0, p
@group(0) @binding(4) var<storage,read_write> vecB: array<vec4f>; // v, s, t, thetaOld
@group(0) @binding(5) var<storage,read_write> partials: array<vec4f>;
@group(0) @binding(6) var<storage,read_write> scalars: SolverScalars;

fn idx3(x: u32, y: u32, z: u32) -> u32 { return x + cfg.dims.x * (y + cfg.dims.y * z); }

fn readField(c: u32, which: u32) -> f32 {
  if (which == 0u) { return vecA[c].x; } // x
  if (which == 1u) { return vecA[c].w; } // p
  return vecB[c].y;                       // s
}

fn matvec(c: u32, which: u32) -> f32 {
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let mA = matOffA[c]; let mB = matOffB[c];
  var acc = readField(c, which);
  if (x > 0u && mA.x > 0.0) { acc -= mA.x * readField(idx3(x - 1u, y, z), which); }
  if (x + 1u < nx && mA.y > 0.0) { acc -= mA.y * readField(idx3(x + 1u, y, z), which); }
  if (y > 0u && mA.z > 0.0) { acc -= mA.z * readField(idx3(x, y - 1u, z), which); }
  if (y + 1u < ny && mA.w > 0.0) { acc -= mA.w * readField(idx3(x, y + 1u, z), which); }
  if (z > 0u && mB.x > 0.0) { acc -= mB.x * readField(idx3(x, y, z - 1u), which); }
  if (z + 1u < nz && mB.y > 0.0) { acc -= mB.y * readField(idx3(x, y, z + 1u), which); }
  return acc;
}

var<workgroup> smem64: array<vec4f, 64>;
fn reduce64(lane: u32, wid: u32, val: vec4f) {
  smem64[lane] = val;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s /= 2u) {
    if (lane < s) { smem64[lane] += smem64[lane + s]; }
    workgroupBarrier();
  }
  if (lane == 0u) { partials[wid] = smem64[0]; }
}

var<workgroup> smem256: array<vec4f, 256>;
fn sumPartials(lane: u32) -> vec4f {
  var acc = vec4f(0.0);
  let rounds = (cfg.counts.x + 255u) / 256u;
  for (var r = 0u; r < rounds; r++) {
    let i = r * 256u + lane;
    if (i < cfg.counts.x) { acc += partials[i]; }
  }
  smem256[lane] = acc;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s /= 2u) {
    if (lane < s) { smem256[lane] += smem256[lane + s]; }
    workgroupBarrier();
  }
  return smem256[0];
}

@compute @workgroup_size(64)
fn bicgInit(@builtin(global_invocation_id) tid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = tid.x;
  var acc = vec4f(0.0);
  if (c < cfg.dims.w) {
    let b = matOffB[c].w;
    let r = b - matvec(c, 0u);
    vecA[c] = vec4f(vecA[c].x, r, r, r);
    vecB[c] = vec4f(0.0, 0.0, 0.0, vecB[c].w);
    acc = vec4f(r * r, b * b, 0.0, 0.0);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceInit(@builtin(local_invocation_index) lane: u32) {
  let total = sumPartials(lane);
  if (lane == 0u) {
    scalars.rho = total.x;
    scalars.alpha = 1.0;
    scalars.omega = 1.0;
    scalars.beta = 0.0;
    scalars.normR2 = total.x;
    scalars.normB2 = total.y;
    scalars.denom = 1.0;
    scalars.status = 0u;
  }
}

@compute @workgroup_size(64)
fn bicgStep1(@builtin(global_invocation_id) tid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = tid.x;
  var acc = vec4f(0.0);
  if (c < cfg.dims.w) {
    let v = matvec(c, 1u);
    vecB[c].x = v;
    acc.x = vecA[c].z * v;
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceStep1(@builtin(local_invocation_index) lane: u32) {
  let total = sumPartials(lane);
  if (lane == 0u) {
    let denom = total.x;
    scalars.denom = denom;
    if (abs(denom) > 1e-30 && abs(scalars.rho) > 1e-30 && denom == denom) {
      scalars.alpha = scalars.rho / denom;
    } else {
      scalars.alpha = 0.0;
      scalars.status = 1u;
    }
  }
}

@compute @workgroup_size(64)
fn bicgStep2(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  let alpha = scalars.alpha;
  vecB[c].y = vecA[c].y - alpha * vecB[c].x;
}

@compute @workgroup_size(64)
fn bicgStep3(@builtin(global_invocation_id) tid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = tid.x;
  var acc = vec4f(0.0);
  if (c < cfg.dims.w) {
    let t = matvec(c, 2u);
    vecB[c].z = t;
    let s = vecB[c].y;
    acc = vec4f(t * s, t * t, 0.0, 0.0);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceStep3(@builtin(local_invocation_index) lane: u32) {
  let total = sumPartials(lane);
  if (lane == 0u) {
    let ts = total.x; let tt = total.y;
    if (tt > 1e-30 && ts == ts && tt == tt) {
      scalars.omega = ts / tt;
    } else {
      scalars.omega = 0.0;
      scalars.status = 1u;
    }
  }
}

@compute @workgroup_size(64)
fn bicgStep4(@builtin(global_invocation_id) tid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = tid.x;
  var acc = vec4f(0.0);
  if (c < cfg.dims.w) {
    let alpha = scalars.alpha;
    let omega = scalars.omega;
    let a = vecA[c];
    let b = vecB[c];
    let xNew = a.x + alpha * a.w + omega * b.y;
    let rNew = b.y - omega * b.z;
    let ok = (xNew == xNew) && abs(xNew) < 1e12;
    vecA[c].x = select(a.x, xNew, ok);
    vecA[c].y = select(a.y, rNew, ok);
    acc = vec4f(a.z * vecA[c].y, vecA[c].y * vecA[c].y, 0.0, 0.0);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceStep4(@builtin(local_invocation_index) lane: u32) {
  let total = sumPartials(lane);
  if (lane == 0u) {
    let rhoNew = total.x; let rr = total.y;
    let rhoOld = scalars.rho; let omega = scalars.omega;
    if (abs(rhoOld) > 1e-30 && abs(omega) > 1e-30 && abs(rhoNew) > 1e-30 && rhoNew == rhoNew) {
      scalars.beta = (rhoNew / rhoOld) * (scalars.alpha / omega);
      scalars.rho = rhoNew;
    } else {
      scalars.beta = 0.0;
      scalars.rho = rhoNew;
      scalars.status = 1u;
    }
    scalars.normR2 = rr;
  }
}

@compute @workgroup_size(64)
fn bicgStep5(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  let a = vecA[c];
  vecA[c].w = a.y + scalars.beta * (a.w - scalars.omega * vecB[c].x);
}

@compute @workgroup_size(64)
fn sorRB(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  if (((x + y + z) & 1u) != cfg.counts.y) { return; }
  let mA = matOffA[c]; let mB = matOffB[c];
  var s = mB.w;
  if (x > 0u && mA.x > 0.0) { s += mA.x * vecA[idx3(x - 1u, y, z)].x; }
  if (x + 1u < nx && mA.y > 0.0) { s += mA.y * vecA[idx3(x + 1u, y, z)].x; }
  if (y > 0u && mA.z > 0.0) { s += mA.z * vecA[idx3(x, y - 1u, z)].x; }
  if (y + 1u < ny && mA.w > 0.0) { s += mA.w * vecA[idx3(x, y + 1u, z)].x; }
  if (z > 0u && mB.x > 0.0) { s += mB.x * vecA[idx3(x, y, z - 1u)].x; }
  if (z + 1u < nz && mB.y > 0.0) { s += mB.y * vecA[idx3(x, y, z + 1u)].x; }
  vecA[c].x = vecA[c].x + cfg.params.x * (s - vecA[c].x);
}

@compute @workgroup_size(64)
fn snapshotOld(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  vecB[c].w = vecA[c].x;
}
`;

// ---------- GPU Solver Session ----------

const solverPipeCache = new WeakMap();

async function getSolverPipelines(device) {
  if (solverPipeCache.has(device)) return solverPipeCache.get(device);
  const fluidMod = device.createShaderModule({label: 'Thermal fluid', code: FLUID_WGSL});
  const fanMod = device.createShaderModule({label: 'Thermal fan stats', code: FAN_FLOW_WGSL});
  const asmMod = device.createShaderModule({label: 'Thermal assemble', code: ASSEMBLE_WGSL});
  const bicgMod = device.createShaderModule({label: 'Thermal BiCGSTAB', code: BICG_WGSL});
  for (const [name, mod] of [['fluid', fluidMod], ['fan', fanMod], ['assemble', asmMod], ['bicg', bicgMod]]) {
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw fail('SHADER_COMPILE', `Thermal ${name} WGSL: ` + errs.map(m => `L${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
  }

  const fluidLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}}
    ]
  });
  const fanLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const asmLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const bicgLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });

  const fluidPL = device.createPipelineLayout({bindGroupLayouts: [fluidLayout]});
  const fanPL = device.createPipelineLayout({bindGroupLayouts: [fanLayout]});
  const asmPL = device.createPipelineLayout({bindGroupLayouts: [asmLayout]});
  const bicgPL = device.createPipelineLayout({bindGroupLayouts: [bicgLayout]});

  const [
    advectAndForce, computeDivergence, pressureRB, projectVelocity, accumFans, assembleEnergy,
    bicgInit, reduceInit, bicgStep1, reduceStep1, bicgStep2, bicgStep3, reduceStep3,
    bicgStep4, reduceStep4, bicgStep5, sorRB, snapshotOld
  ] = await Promise.all([
    device.createComputePipelineAsync({layout: fluidPL, compute: {module: fluidMod, entryPoint: 'advectAndForce'}}),
    device.createComputePipelineAsync({layout: fluidPL, compute: {module: fluidMod, entryPoint: 'computeDivergence'}}),
    device.createComputePipelineAsync({layout: fluidPL, compute: {module: fluidMod, entryPoint: 'pressureRB'}}),
    device.createComputePipelineAsync({layout: fluidPL, compute: {module: fluidMod, entryPoint: 'projectVelocity'}}),
    device.createComputePipelineAsync({layout: fanPL, compute: {module: fanMod, entryPoint: 'accumFans'}}),
    device.createComputePipelineAsync({layout: asmPL, compute: {module: asmMod, entryPoint: 'assembleEnergy'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'bicgInit'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'reduceInit'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'bicgStep1'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'reduceStep1'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'bicgStep2'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'bicgStep3'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'reduceStep3'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'bicgStep4'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'reduceStep4'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'bicgStep5'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'sorRB'}}),
    device.createComputePipelineAsync({layout: bicgPL, compute: {module: bicgMod, entryPoint: 'snapshotOld'}})
  ]);

  const entry = {
    fluidLayout, fanLayout, asmLayout, bicgLayout,
    advectAndForce, computeDivergence, pressureRB, projectVelocity, accumFans, assembleEnergy,
    bicgInit, reduceInit, bicgStep1, reduceStep1, bicgStep2, bicgStep3, reduceStep3,
    bicgStep4, reduceStep4, bicgStep5, sorRB, snapshotOld
  };
  solverPipeCache.set(device, entry);
  return entry;
}

export async function createGPUThermalSolver(device, model) {
  const pipes = await getSolverPipelines(device);
  const [nx, ny, nz] = model.domain.cells, count = model.domain.count;
  const wgCount = Math.ceil(count / 64);
  const numFans = model.fans.length;
  const maxFansSlots = Math.max(1, numFans);

  const mkBuf = (label, size, usage) => device.createBuffer({label, size: Math.max(16, size), usage});
  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const SR = S | GPUBufferUsage.COPY_SRC;

  const cellMetaBuf = mkBuf('Thermal cellMeta', count * 4, S);
  const cellPropsBuf = mkBuf('Thermal cellProps', count * 16, S);
  const cellFlagsBuf = mkBuf('Thermal cellFlags', count * 16, S);
  const velABuf = mkBuf('Thermal velA', count * 16, SR);
  const velBBuf = mkBuf('Thermal velB', count * 16, S);
  const presBuf = mkBuf('Thermal pres', count * 4, S);
  const divBuf = mkBuf('Thermal div', count * 4, S);
  const fanForceBuf = mkBuf('Thermal fanForce', maxFansSlots * 2 * 16, S);
  const fanDirBuf = mkBuf('Thermal fanDirs', maxFansSlots * 16, S);
  const fanStatsBuf = mkBuf('Thermal fanStats', maxFansSlots * 4, SR);
  const fanStatsRead = mkBuf('Thermal fanStatsRead', maxFansSlots * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

  const matOffABuf = mkBuf('Thermal matOffA', count * 16, S);
  const matOffBBuf = mkBuf('Thermal matOffB', count * 16, S);
  const vecABuf = mkBuf('Thermal vecA', count * 16, SR);
  const vecBBuf = mkBuf('Thermal vecB', count * 16, S);
  const partialsBuf = mkBuf('Thermal partials', wgCount * 16, S);
  const scalarsBuf = mkBuf('Thermal scalars', 32, SR);
  const scalarsRead = mkBuf('Thermal scalarsRead', 32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const vecARead = mkBuf('Thermal vecARead', count * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const velRead = mkBuf('Thermal velRead', count * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

  const fluidCfg0 = mkBuf('Thermal fluidCfg0', 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const fluidCfg1 = mkBuf('Thermal fluidCfg1', 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const fanStatCfg = mkBuf('Thermal fanStatCfg', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const asmCfgBuf = mkBuf('Thermal asmCfg', 80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const bicgCfg0 = mkBuf('Thermal bicgCfg0', 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const bicgCfg1 = mkBuf('Thermal bicgCfg1', 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

  const allBufs = [
    cellMetaBuf, cellPropsBuf, cellFlagsBuf, velABuf, velBBuf, presBuf, divBuf,
    fanForceBuf, fanDirBuf, fanStatsBuf, fanStatsRead,
    matOffABuf, matOffBBuf, vecABuf, vecBBuf, partialsBuf, scalarsBuf, scalarsRead, vecARead, velRead,
    fluidCfg0, fluidCfg1, fanStatCfg, asmCfgBuf, bicgCfg0, bicgCfg1
  ];

  // Upload static model arrays
  const cellMeta = new Uint32Array(count);
  const cellProps = new Float32Array(count * 4);
  const cellFlags = new Float32Array(count * 4);
  const vecAInit = new Float32Array(count * 4);
  const vecBInit = new Float32Array(count * 4);
  const initTheta = model.initialC - model.ambientC;
  for (let i = 0; i < count; i++) {
    const fTag = model.cellFanIdx[i] >= 0 ? (model.cellFanIdx[i] + 1) : 0;
    cellMeta[i] = (model.cellType[i] & 0xff) | (fTag << 8);
    cellProps[4*i]   = model.cellK[i];
    cellProps[4*i+1] = model.cellRhoCp[i];
    cellProps[4*i+2] = model.cellEmissivity[i];
    cellProps[4*i+3] = model.cellPowerW[i];
    cellFlags[4*i]   = model.cellType[i];
    cellFlags[4*i+1] = model.cellFixedTheta[i];
    const t0 = model.cellType[i] === CELL_TYPE.FIXED_T ? model.cellFixedTheta[i]
      : (model.cellType[i] === CELL_TYPE.FLUID && model.medium.isVacuum) ? 0 : initTheta;
    vecAInit[4*i] = t0;
    vecBInit[4*i+3] = t0;
  }
  device.queue.writeBuffer(cellMetaBuf, 0, cellMeta);
  device.queue.writeBuffer(cellPropsBuf, 0, cellProps);
  device.queue.writeBuffer(cellFlagsBuf, 0, cellFlags);
  device.queue.writeBuffer(vecABuf, 0, vecAInit);
  device.queue.writeBuffer(vecBBuf, 0, vecBInit);
  const encClr = device.createCommandEncoder();
  encClr.clearBuffer(velABuf); encClr.clearBuffer(velBBuf); encClr.clearBuffer(presBuf); encClr.clearBuffer(divBuf);
  device.queue.submit([encClr.finish()]);

  // Upload Fan directions
  const fanDirData = new Float32Array(maxFansSlots * 4);
  for (let i = 0; i < numFans; i++) {
    const d = model.fans[i].axisGrid;
    fanDirData.set([d[0], d[1], d[2], 0], 4 * i);
  }
  device.queue.writeBuffer(fanDirBuf, 0, fanDirData);
  device.queue.writeBuffer(fanStatCfg, 0, new Uint32Array([count, numFans, 0, 0]));

  // Write BiCGSTAB parity configs (0 and 1 for RB-SOR)
  const writeBicgCfg = (buf, parity) => {
    const ab = new ArrayBuffer(48);
    new Uint32Array(ab, 0, 4).set([nx, ny, nz, count]);
    new Uint32Array(ab, 16, 4).set([wgCount, parity, 0, 0]);
    new Float32Array(ab, 32, 4).set([1.35, 0, 0, 0]);
    device.queue.writeBuffer(buf, 0, ab);
  };
  writeBicgCfg(bicgCfg0, 0);
  writeBicgCfg(bicgCfg1, 1);

  const mkFluidBG = (cfg, vIn, vOut) => device.createBindGroup({
    layout: pipes.fluidLayout,
    entries: [
      {binding: 0, resource: {buffer: cfg}},
      {binding: 1, resource: {buffer: cellMetaBuf}},
      {binding: 2, resource: {buffer: vIn}},
      {binding: 3, resource: {buffer: vOut}},
      {binding: 4, resource: {buffer: presBuf}},
      {binding: 5, resource: {buffer: divBuf}},
      {binding: 6, resource: {buffer: vecABuf}},
      {binding: 7, resource: {buffer: fanForceBuf}}
    ]
  });
  const fluidBG_AB0 = mkFluidBG(fluidCfg0, velABuf, velBBuf);
  const fluidBG_BA0 = mkFluidBG(fluidCfg0, velBBuf, velABuf);
  const fluidBG_BA1 = mkFluidBG(fluidCfg1, velBBuf, velABuf);

  const fanStatBG = device.createBindGroup({
    layout: pipes.fanLayout,
    entries: [
      {binding: 0, resource: {buffer: fanStatCfg}},
      {binding: 1, resource: {buffer: cellMetaBuf}},
      {binding: 2, resource: {buffer: velABuf}},
      {binding: 3, resource: {buffer: fanDirBuf}},
      {binding: 4, resource: {buffer: fanStatsBuf}}
    ]
  });

  const asmBG = device.createBindGroup({
    layout: pipes.asmLayout,
    entries: [
      {binding: 0, resource: {buffer: asmCfgBuf}},
      {binding: 1, resource: {buffer: cellPropsBuf}},
      {binding: 2, resource: {buffer: cellFlagsBuf}},
      {binding: 3, resource: {buffer: velABuf}},
      {binding: 4, resource: {buffer: vecABuf}},
      {binding: 5, resource: {buffer: vecBBuf}},
      {binding: 6, resource: {buffer: matOffABuf}},
      {binding: 7, resource: {buffer: matOffBBuf}}
    ]
  });

  const mkBicgBG = cfg => device.createBindGroup({
    layout: pipes.bicgLayout,
    entries: [
      {binding: 0, resource: {buffer: cfg}},
      {binding: 1, resource: {buffer: matOffABuf}},
      {binding: 2, resource: {buffer: matOffBBuf}},
      {binding: 3, resource: {buffer: vecABuf}},
      {binding: 4, resource: {buffer: vecBBuf}},
      {binding: 5, resource: {buffer: partialsBuf}},
      {binding: 6, resource: {buffer: scalarsBuf}}
    ]
  });
  const bicgBG0 = mkBicgBG(bicgCfg0);
  const bicgBG1 = mkBicgBG(bicgCfg1);

  let currentAmbientC = model.ambientC;
  let disposed = false;

  function updateDynamicSources({ambientC, cellPowerW, cellFixedTheta, fans}) {
    const prevAmb = currentAmbientC;
    currentAmbientC = ambientC;
    if (cellPowerW || cellFixedTheta || ambientC !== prevAmb) {
      for (let i = 0; i < count; i++) {
        if (cellPowerW) cellProps[4*i+3] = cellPowerW[i];
        if (cellFixedTheta) cellFlags[4*i+1] = cellFixedTheta[i];
      }
      device.queue.writeBuffer(cellPropsBuf, 0, cellProps);
      device.queue.writeBuffer(cellFlagsBuf, 0, cellFlags);
    }
    if (fans) {
      for (let i = 0; i < Math.min(numFans, fans.length); i++) {
        model.fans[i].shutoffPressure = fans[i].shutoffPressure;
        model.fans[i].freeFlow = fans[i].freeFlow;
        model.fans[i].axisGrid = fans[i].axisGrid;
        fanDirData.set([fans[i].axisGrid[0], fans[i].axisGrid[1], fans[i].axisGrid[2], 0], 4 * i);
      }
      device.queue.writeBuffer(fanDirBuf, 0, fanDirData);
    }
  }

  function writeAssembleConfig(invDt) {
    const m = model.medium;
    const ab = new ArrayBuffer(80);
    new Uint32Array(ab, 0, 4).set([nx, ny, nz, count]);
    new Float32Array(ab, 16, 4).set([model.domain.spacingM[0], model.domain.spacingM[1], model.domain.spacingM[2], invDt]);
    new Float32Array(ab, 32, 4).set([m.rho, m.cp, m.k, m.mu]);
    new Float32Array(ab, 48, 4).set([m.pr, m.betaAt(currentAmbientC), len3(model.domain.gGrid), model.charLenM]);
    new Float32Array(ab, 64, 4).set([currentAmbientC + 273.15, m.isVacuum ? 1 : 0, 1.0, 0]);
    device.queue.writeBuffer(asmCfgBuf, 0, ab);
  }

  async function updateFanForces() {
    if (numFans === 0 || model.medium.isVacuum) return;
    const enc = device.createCommandEncoder();
    enc.clearBuffer(fanStatsBuf);
    const pass = enc.beginComputePass();
    pass.setPipeline(pipes.accumFans);
    pass.setBindGroup(0, fanStatBG);
    pass.dispatchWorkgroups(wgCount);
    pass.end();
    enc.copyBufferToBuffer(fanStatsBuf, 0, fanStatsRead, 0, numFans * 4);
    device.queue.submit([enc.finish()]);
    await fanStatsRead.mapAsync(GPUMapMode.READ, 0, numFans * 4);
    const sums = new Int32Array(fanStatsRead.getMappedRange(0, numFans * 4));
    const forceData = new Float32Array(maxFansSlots * 2 * 4);
    const rho = model.medium.rho;
    for (let i = 0; i < numFans; i++) {
      const f = model.fans[i];
      const meanVn = (sums[i] / 10000) / Math.max(1, f.cellCount);
      const qCurr = meanVn * f.areaM2;
      const ratio = qCurr / Math.max(1e-9, f.freeFlow);
      const dP = f.shutoffPressure * clamp(1 - ratio, -0.5, 1.5);
      const accel = dP / Math.max(1e-6, rho * f.thicknessM);
      const d = f.axisGrid;
      forceData.set([accel * d[0], accel * d[1], accel * d[2], 12.0], 4 * i);
      forceData.set([d[0], d[1], d[2], 0], 4 * (numFans + i));
    }
    fanStatsRead.unmap();
    device.queue.writeBuffer(fanForceBuf, 0, forceData);
  }

  async function stepFluid(dtFlow, steps = 4, pressureIters = 18) {
    if (model.medium.isVacuum || model.stats.fluidCount === 0) return;
    const m = model.medium;
    const nu = m.mu / Math.max(1e-9, m.rho);
    const beta = m.betaAt(currentAmbientC);
    let maxFanV = 2.0;
    for (const f of model.fans) maxFanV = Math.max(maxFanV, 3.0 * f.freeFlow / Math.max(1e-6, f.areaM2));
    const maxSpeed = clamp(maxFanV, 4.0, 40.0);
    const writeFCfg = (buf, parity) => {
      const ab = new ArrayBuffer(80);
      new Uint32Array(ab, 0, 4).set([nx, ny, nz, count]);
      new Float32Array(ab, 16, 4).set([model.domain.spacingM[0], model.domain.spacingM[1], model.domain.spacingM[2], dtFlow]);
      new Float32Array(ab, 32, 4).set([m.rho, nu, beta, maxSpeed]);
      new Float32Array(ab, 48, 4).set([model.domain.gGrid[0], model.domain.gGrid[1], model.domain.gGrid[2], 1.55]);
      new Uint32Array(ab, 64, 4).set([parity, numFans, 0, 0]);
      device.queue.writeBuffer(buf, 0, ab);
    };
    writeFCfg(fluidCfg0, 0);
    writeFCfg(fluidCfg1, 1);

    for (let s = 0; s < steps; s++) {
      await updateFanForces();
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      // Advect + buoyancy + Fan momentum: velA -> velB
      pass.setPipeline(pipes.advectAndForce); pass.setBindGroup(0, fluidBG_AB0); pass.dispatchWorkgroups(wgCount);
      // Divergence of velB
      pass.setPipeline(pipes.computeDivergence); pass.setBindGroup(0, fluidBG_BA0); pass.dispatchWorkgroups(wgCount);
      // Pressure Red-Black SOR
      pass.setPipeline(pipes.pressureRB);
      for (let it = 0; it < pressureIters; it++) {
        pass.setBindGroup(0, fluidBG_BA0); pass.dispatchWorkgroups(wgCount);
        pass.setBindGroup(0, fluidBG_BA1); pass.dispatchWorkgroups(wgCount);
      }
      // Project velB -> velA
      pass.setPipeline(pipes.projectVelocity); pass.setBindGroup(0, fluidBG_BA0); pass.dispatchWorkgroups(wgCount);
      pass.end();
      device.queue.submit([enc.finish()]);
    }
  }

  async function solveLinearEnergy({invDt = 0, tolerance = 1e-5, maxIterations = 800, checkCurrent}) {
    writeAssembleConfig(invDt);
    const enc0 = device.createCommandEncoder();
    const p0 = enc0.beginComputePass();
    p0.setPipeline(pipes.assembleEnergy); p0.setBindGroup(0, asmBG); p0.dispatchWorkgroups(wgCount);
    p0.setPipeline(pipes.bicgInit); p0.setBindGroup(0, bicgBG0); p0.dispatchWorkgroups(wgCount);
    p0.setPipeline(pipes.reduceInit); p0.setBindGroup(0, bicgBG0); p0.dispatchWorkgroups(1);
    p0.end();
    enc0.copyBufferToBuffer(scalarsBuf, 0, scalarsRead, 0, 32);
    device.queue.submit([enc0.finish()]);

    await scalarsRead.mapAsync(GPUMapMode.READ);
    let sc = new Float32Array(scalarsRead.getMappedRange()).slice();
    let stU32 = new Uint32Array(sc.buffer)[7];
    scalarsRead.unmap();
    const normB = Math.sqrt(Math.max(0, sc[5]));
    const targetR2 = Math.pow(tolerance * Math.max(1.0, normB), 2);
    if (sc[4] <= targetR2) return {iterations: 0, residualK: Math.sqrt(Math.max(0, sc[4])), converged: true};

    const chunk = 16;
    let totalIter = 0;
    let converged = false;
    while (totalIter < maxIterations) {
      checkCurrent?.();
      const steps = Math.min(chunk, maxIterations - totalIter);
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      if (stU32 !== 0) {
        // Breakdown recovery: 4 RB-SOR sweeps then clean BiCGSTAB restart
        pass.setPipeline(pipes.sorRB);
        for (let k = 0; k < 4; k++) {
          pass.setBindGroup(0, bicgBG0); pass.dispatchWorkgroups(wgCount);
          pass.setBindGroup(0, bicgBG1); pass.dispatchWorkgroups(wgCount);
        }
        pass.setPipeline(pipes.bicgInit); pass.setBindGroup(0, bicgBG0); pass.dispatchWorkgroups(wgCount);
        pass.setPipeline(pipes.reduceInit); pass.setBindGroup(0, bicgBG0); pass.dispatchWorkgroups(1);
      }
      for (let s = 0; s < steps; s++) {
        pass.setBindGroup(0, bicgBG0);
        pass.setPipeline(pipes.bicgStep1); pass.dispatchWorkgroups(wgCount);
        pass.setPipeline(pipes.reduceStep1); pass.dispatchWorkgroups(1);
        pass.setPipeline(pipes.bicgStep2); pass.dispatchWorkgroups(wgCount);
        pass.setPipeline(pipes.bicgStep3); pass.dispatchWorkgroups(wgCount);
        pass.setPipeline(pipes.reduceStep3); pass.dispatchWorkgroups(1);
        pass.setPipeline(pipes.bicgStep4); pass.dispatchWorkgroups(wgCount);
        pass.setPipeline(pipes.reduceStep4); pass.dispatchWorkgroups(1);
        pass.setPipeline(pipes.bicgStep5); pass.dispatchWorkgroups(wgCount);
      }
      pass.end();
      enc.copyBufferToBuffer(scalarsBuf, 0, scalarsRead, 0, 32);
      device.queue.submit([enc.finish()]);
      totalIter += steps;

      await scalarsRead.mapAsync(GPUMapMode.READ);
      sc = new Float32Array(scalarsRead.getMappedRange()).slice();
      stU32 = new Uint32Array(sc.buffer)[7];
      scalarsRead.unmap();
      if (sc[4] <= targetR2) { converged = true; break; }
    }
    return {iterations: totalIter, residualK: Math.sqrt(Math.max(0, sc[4])), converged};
  }

  function commitTransientStep() {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipes.snapshotOld);
    pass.setBindGroup(0, bicgBG0);
    pass.dispatchWorkgroups(wgCount);
    pass.end();
    device.queue.submit([enc.finish()]);
  }

  async function readFields(includeVel = true) {
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(vecABuf, 0, vecARead, 0, count * 16);
    if (includeVel && !model.medium.isVacuum) enc.copyBufferToBuffer(velABuf, 0, velRead, 0, count * 16);
    device.queue.submit([enc.finish()]);
    await vecARead.mapAsync(GPUMapMode.READ);
    const rawA = new Float32Array(vecARead.getMappedRange());
    const theta = new Float32Array(count);
    for (let i = 0; i < count; i++) theta[i] = rawA[4*i];
    vecARead.unmap();

    let vel = null;
    if (includeVel && !model.medium.isVacuum) {
      await velRead.mapAsync(GPUMapMode.READ);
      vel = new Float32Array(velRead.getMappedRange()).slice();
      velRead.unmap();
    }
    return {theta, vel};
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    try { await device.queue.onSubmittedWorkDone(); } catch {}
    for (const b of allBufs) { try { b.destroy(); } catch {} }
  }

  return {updateDynamicSources, stepFluid, solveLinearEnergy, commitTransientStep, readFields, dispose};
}

// ---------- Field Post-Processing, Flux, Energy Balance & Probes ----------

export function evaluateThermalFields(model, theta, vel, probes = [], ambientC = model.ambientC) {
  const [nx, ny, nz] = model.domain.cells, count = model.domain.count;
  const [dx, dy, dz] = model.domain.spacingM;
  const tempsC = new Float32Array(count);
  const fluxWPerM2 = new Float32Array(count);
  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  const isVac = model.medium.isVacuum;
  const tAmbK = ambientC + 273.15;
  const rhoCpF = model.medium.rho * model.medium.cp;
  const kF = model.medium.k;

  let minSolidTempC = Infinity, maxSolidTempC = -Infinity;
  let minAllTempC = Infinity, maxAllTempC = -Infinity;
  let maxFluxWPerM2 = 0, maxFlowMs = 0;

  for (let i = 0; i < count; i++) {
    const tC = ambientC + theta[i];
    tempsC[i] = tC;
    if (model.cellType[i] >= CELL_TYPE.SOLID) {
      if (tC < minSolidTempC) minSolidTempC = tC;
      if (tC > maxSolidTempC) maxSolidTempC = tC;
      if (tC < minAllTempC) minAllTempC = tC;
      if (tC > maxAllTempC) maxAllTempC = tC;
    } else if (!isVac) {
      if (tC < minAllTempC) minAllTempC = tC;
      if (tC > maxAllTempC) maxAllTempC = tC;
      if (vel) {
        const sp = vel[4*i+3];
        if (sp > maxFlowMs) maxFlowMs = sp;
      }
    }
  }
  if (!Number.isFinite(minSolidTempC)) { minSolidTempC = ambientC; maxSolidTempC = ambientC; }
  if (!Number.isFinite(minAllTempC)) { minAllTempC = ambientC; maxAllTempC = ambientC; }

  // Heat flux vector on solid cells + exact energy accounting across domain & fixed-T faces.
  let heatInW = model.stats.positiveHeaterW;
  let heatOutW = -model.stats.negativeHeaterW;
  let radiatedOutW = 0, convectedOutW = 0, fixedInW = 0, fixedOutW = 0;

  const hRad = (eps, th) => {
    if (eps <= 0) return 0;
    const tsK = clamp(th + tAmbK, 1, 5000);
    return eps * STEFAN_BOLTZMANN * (tsK + tAmbK) * (tsK*tsK + tAmbK*tAmbK);
  };
  const hConv = (dT, vFluid, df) => {
    const m = model.medium, Lc = model.charLenM, dTabs = Math.max(Math.abs(dT), 0.05);
    const beta = m.betaAt(ambientC), g = len3(model.domain.gGrid);
    const ra = g * beta * dTabs * Lc * Lc * Lc * m.rho * m.rho * m.cp / Math.max(m.mu * m.k, 1e-18);
    const nuLam = 0.68 + 0.67 * Math.pow(ra, 0.25) / Math.pow(1 + Math.pow(0.492 / Math.max(m.pr, 0.01), 0.5625), 4/9);
    const nuTurb = 0.10 * Math.pow(ra, 1/3);
    const hNat = m.k * (ra > 1e8 ? Math.max(nuLam, nuTurb) : nuLam) / Lc;
    const re = m.rho * Math.max(vFluid, 0) * Lc / Math.max(m.mu, 1e-12);
    const pr13 = Math.pow(Math.max(m.pr, 0.01), 1/3);
    const nuFor = re > 5e5 ? 0.037 * Math.pow(re, 0.8) * pr13 : 0.664 * Math.sqrt(re) * pr13;
    const hFor = m.k * nuFor / Lc;
    return Math.max(Math.cbrt(hNat*hNat*hNat + hFor*hFor*hFor), 2 * m.k / Math.max(df, 1e-6));
  };

  const areas = [dy*dz, dy*dz, dx*dz, dx*dz, dx*dy, dx*dy];
  const dists = [dx, dx, dy, dy, dz, dz];

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const c = cellIdx(ix, iy, iz);
        const ct = model.cellType[c];
        const th = theta[c];
        const ki = model.cellK[c];
        const eps = model.cellEmissivity[c];
        let qx = 0, qy = 0, qz = 0, cellFixedNet = 0;

        for (let f = 0; f < 6; f++) {
          const Af = areas[f], df = dists[f];
          let j = -1, sign = 1, axis = 0;
          if (f === 0) { if (ix > 0) j = cellIdx(ix-1, iy, iz); sign = -1; axis = 0; }
          else if (f === 1) { if (ix + 1 < nx) j = cellIdx(ix+1, iy, iz); sign = 1; axis = 0; }
          else if (f === 2) { if (iy > 0) j = cellIdx(ix, iy-1, iz); sign = -1; axis = 1; }
          else if (f === 3) { if (iy + 1 < ny) j = cellIdx(ix, iy+1, iz); sign = 1; axis = 1; }
          else if (f === 4) { if (iz > 0) j = cellIdx(ix, iy, iz-1); sign = -1; axis = 2; }
          else { if (iz + 1 < nz) j = cellIdx(ix, iy, iz+1); sign = 1; axis = 2; }

          if (j >= 0) {
            const nt = model.cellType[j];
            let qFace = 0; // outward W from c to j
            if (ct >= CELL_TYPE.SOLID && nt >= CELL_TYPE.SOLID) {
              const kj = model.cellK[j];
              const G = Af * (2 * ki * kj) / Math.max((ki + kj) * df, 1e-18);
              qFace = G * (th - theta[j]);
            } else if (ct >= CELL_TYPE.SOLID && nt === CELL_TYPE.FLUID) {
              const qRad = Af * hRad(eps, th) * th;
              radiatedOutW += qRad;
              qFace = qRad;
              if (!isVac) {
                const vf = vel ? vel[4*j+3] : 0;
                const hc = hConv(th - theta[j], vf, df);
                const Gc = Af / (df / (2 * ki) + 1 / hc);
                qFace += Gc * (th - theta[j]);
              }
            }
            if (ct === CELL_TYPE.FIXED_T && nt !== CELL_TYPE.FIXED_T) {
              cellFixedNet += qFace;
            }
            if (ct >= CELL_TYPE.SOLID) {
              const flux = (qFace / Af) * sign * 0.5;
              if (axis === 0) qx += flux; else if (axis === 1) qy += flux; else qz += flux;
            }
          } else {
            // Exterior domain boundary face
            if (ct >= CELL_TYPE.SOLID) {
              const qRad = Af * hRad(eps, th) * th;
              let qExt = qRad;
              radiatedOutW += qRad;
              if (!isVac) {
                const hc = hConv(th, 0, df);
                const qc = (Af / (df / (2 * ki) + 1 / hc)) * th;
                convectedOutW += qc;
                qExt += qc;
              }
              if (ct === CELL_TYPE.FIXED_T) cellFixedNet += qExt;
              const flux = (qExt / Af) * sign * 0.5;
              if (axis === 0) qx += flux; else if (axis === 1) qy += flux; else qz += flux;
            } else if (!isVac) {
              const uAxis = vel ? vel[4*c + axis] : 0;
              const uOut = uAxis * sign;
              const F = rhoCpF * Af * uOut;
              const Gb = Af * kF / (0.5 * df);
              const qB = (uOut < 0 ? (Gb - F) : (F + 0.15 * Gb)) * th;
              convectedOutW += qB;
            }
          }
        }
        if (ct === CELL_TYPE.FIXED_T) {
          if (cellFixedNet >= 0) fixedInW += cellFixedNet; else fixedOutW += -cellFixedNet;
        }
        if (ct >= CELL_TYPE.SOLID) {
          const mag = Math.hypot(qx, qy, qz);
          fluxWPerM2[c] = mag;
          if (mag > maxFluxWPerM2) maxFluxWPerM2 = mag;
        }
      }
    }
  }

  heatInW += fixedInW;
  heatOutW += fixedOutW;
  const fixedNetInW = fixedInW - fixedOutW;
  if (radiatedOutW + convectedOutW >= 0) heatOutW += radiatedOutW + convectedOutW;
  else heatInW += -(radiatedOutW + convectedOutW);

  // Evaluate Probe readings
  const probeReadings = probes.map(p => samplePointReading(model, tempsC, fluxWPerM2, vel, p.worldMm, p));

  return {
    ambientC, tempsC, theta: Float32Array.from(theta), fluxWPerM2, vel,
    minSolidTempC, maxSolidTempC, minAllTempC, maxAllTempC,
    maxFluxWPerM2, maxFlowMs,
    heatInW, heatOutW, radiatedOutW, convectedOutW, fixedNetInW,
    probes: probeReadings
  };
}

export function samplePointReading(model, tempsC, fluxWPerM2, vel, worldMm, meta = {}) {
  const [nx, ny, nz] = model.domain.cells;
  const g = worldMmToGrid(model.domain, worldMm);
  const ix = Math.floor(g[0]), iy = Math.floor(g[1]), iz = Math.floor(g[2]);
  if (ix < 0 || ix >= nx || iy < 0 || iy >= ny || iz < 0 || iz >= nz) {
    return {...meta, inside: false, tempC: null, fluxWPerM2: null, flowMs: null, region: 'Outside domain'};
  }
  const c = ix + nx * (iy + ny * iz);
  const ct = model.cellType[c];
  const isSolid = ct >= CELL_TYPE.SOLID;
  // Same-phase trilinear interpolation (never bleeds air into metal or metal into air)
  const fx = clamp(g[0] - 0.5, 0, nx - 1.0001);
  const fy = clamp(g[1] - 0.5, 0, ny - 1.0001);
  const fz = clamp(g[2] - 0.5, 0, nz - 1.0001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), z1 = Math.min(z0 + 1, nz - 1);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  let wSum = 0, tSum = 0, qSum = 0, vSum = 0;
  for (let dz = 0; dz < 2; dz++) {
    const wz = dz ? tz : 1 - tz, cz = dz ? z1 : z0;
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy ? ty : 1 - ty, cy = dy ? y1 : y0;
      for (let dx = 0; dx < 2; dx++) {
        const wx = dx ? tx : 1 - tx, cx = dx ? x1 : x0;
        const ci = cx + nx * (cy + ny * cz);
        if ((model.cellType[ci] >= CELL_TYPE.SOLID) !== isSolid) continue;
        const w = wx * wy * wz;
        wSum += w;
        tSum += w * tempsC[ci];
        if (fluxWPerM2) qSum += w * fluxWPerM2[ci];
        if (vel && !isSolid) vSum += w * vel[4*ci+3];
      }
    }
  }
  const tempC = wSum > 0 ? tSum / wSum : tempsC[c];
  const flux = isSolid ? (wSum > 0 ? qSum / wSum : fluxWPerM2?.[c] || 0) : null;
  const flowMs = !isSolid && vel ? (wSum > 0 ? vSum / wSum : vel[4*c+3]) : null;
  const mat = isSolid && model.cellMatIdx[c] >= 0 ? model.materials[model.cellMatIdx[c]] : null;
  const region = isSolid ? (mat?.name || DEFAULT_MATERIAL_NAME) : model.mediumName;
  return {...meta, inside: true, isSolid, tempC, fluxWPerM2: flux, flowMs, region, role: ROLE_LABELS[model.cellRole[c]] || region};
}

// ---------- GPU 3D Field Textures, Voxel Shell, Smooth Surface, Slice & Airflow Visualization ----------

function packFieldTextures(model, ev) {
  const [nx, ny, nz] = model.domain.cells, count = model.domain.count;
  const tLo = Math.min(ev.minSolidTempC, ev.minAllTempC);
  const tHi = Math.max(ev.maxSolidTempC, ev.maxAllTempC);
  const tSpan = Math.max(1e-3, tHi - tLo);
  const fSpan = Math.max(1e-3, ev.maxFluxWPerM2);
  const vSpan = Math.max(1e-3, ev.maxFlowMs);

  // 1) Solid field with 2-pass dilation into neighboring fluid cells so trilinear sampling on smooth meshes never bleeds cool air!
  const sT = new Float32Array(count);
  const sF = new Float32Array(count);
  const sValid = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (model.cellType[i] >= CELL_TYPE.SOLID) {
      sT[i] = clamp((ev.tempsC[i] - tLo) / tSpan, 0, 1);
      sF[i] = clamp(ev.fluxWPerM2[i] / fSpan, 0, 1);
      sValid[i] = 1;
    }
  }
  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  for (let pass = 0; pass < 2; pass++) {
    const nextT = Float32Array.from(sT), nextF = Float32Array.from(sF), nextV = Uint8Array.from(sValid);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = cellIdx(x, y, z);
      if (sValid[c]) continue;
      let sumT = 0, sumF = 0, n = 0;
      const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
      for (const [dx, dy, dz] of dirs) {
        const nx2 = x+dx, ny2 = y+dy, nz2 = z+dz;
        if (nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz) continue;
        const j = cellIdx(nx2, ny2, nz2);
        if (sValid[j]) { sumT += sT[j]; sumF += sF[j]; n++; }
      }
      if (n > 0) { nextT[c] = sumT / n; nextF[c] = sumF / n; nextV[c] = 1; }
    }
    sT.set(nextT); sF.set(nextF); sValid.set(nextV);
  }

  const solidTex = new Uint16Array(count * 4);
  const fluidTex = new Uint16Array(count * 4);
  const oneH = f32ToF16(1.0), zeroH = f32ToF16(0.0);
  for (let i = 0; i < count; i++) {
    const isSolid = model.cellType[i] >= CELL_TYPE.SOLID;
    solidTex[4*i]   = f32ToF16(sT[i]);
    solidTex[4*i+1] = f32ToF16(sF[i]);
    solidTex[4*i+2] = isSolid ? oneH : zeroH;
    solidTex[4*i+3] = oneH;

    const tn = clamp((ev.tempsC[i] - tLo) / tSpan, 0, 1);
    const vn = (!isSolid && ev.vel) ? clamp(ev.vel[4*i+3] / vSpan, 0, 1) : 0;
    fluidTex[4*i]   = f32ToF16(tn);
    fluidTex[4*i+1] = f32ToF16(vn);
    fluidTex[4*i+2] = isSolid ? oneH : zeroH;
    fluidTex[4*i+3] = oneH;
  }
  return {solidTex, fluidTex, tLo, tHi, fSpan, vSpan};
}

function thermalColorRGB(t) {
  const u = clamp(t, 0, 1);
  // Classic Ironbow / Inferno thermal camera palette
  const stops = [
    [0.00, 0.06, 0.07, 0.24],
    [0.22, 0.28, 0.09, 0.46],
    [0.45, 0.66, 0.14, 0.38],
    [0.68, 0.91, 0.37, 0.14],
    [0.88, 0.99, 0.76, 0.16],
    [1.00, 1.00, 0.97, 0.80]
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i+1];
    if (u <= b[0]) {
      const f = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1] + f*(b[1]-a[1]), a[2] + f*(b[2]-a[2]), a[3] + f*(b[3]-a[3])];
    }
  }
  return [1.0, 0.97, 0.80];
}

function buildVoxelShellVertices(model, ev = null, mode = 'Voxels') {
  const [nx, ny, nz] = model.domain.cells;
  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  const shown = i => model.cellType[i] >= CELL_TYPE.SOLID || (mode === 'Voxels' && model.cellFanIdx[i] >= 0);
  let quadCount = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = cellIdx(x, y, z);
    if (!shown(c)) continue;
    for (const fq of FACE_QUADS) {
      const nx2 = x + (fq.axis === 0 ? fq.sign : 0);
      const ny2 = y + (fq.axis === 1 ? fq.sign : 0);
      const nz2 = z + (fq.axis === 2 ? fq.sign : 0);
      const out = nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz;
      if (out || !shown(cellIdx(nx2, ny2, nz2))) quadCount++;
    }
  }
  const verts = new Float32Array(quadCount * 6 * 9);
  const tLo = ev ? Math.min(ev.minSolidTempC, ev.minAllTempC) : 0;
  const tSpan = ev ? Math.max(1e-3, Math.max(ev.maxSolidTempC, ev.maxAllTempC) - tLo) : 1;
  const fSpan = ev ? Math.max(1e-3, ev.maxFluxWPerM2) : 1;
  let o = 0;
  const pushV = (p, n, col) => {
    verts[o++] = p[0]; verts[o++] = p[1]; verts[o++] = p[2];
    verts[o++] = n[0]; verts[o++] = n[1]; verts[o++] = n[2];
    verts[o++] = col[0]; verts[o++] = col[1]; verts[o++] = col[2];
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = cellIdx(x, y, z);
    if (!shown(c)) continue;
    let col;
    if (mode === 'Voxels' || !ev) {
      const role = model.cellRole[c];
      if (role === ROLE.MATERIAL && model.cellMatIdx[c] >= 0) col = model.materials[model.cellMatIdx[c]].color;
      else col = ROLE_COLORS[role] || ROLE_COLORS[0];
    } else if (mode === 'Flux') {
      col = thermalColorRGB(ev.fluxWPerM2[c] / fSpan);
    } else {
      col = thermalColorRGB((ev.tempsC[c] - tLo) / tSpan);
    }
    for (const fq of FACE_QUADS) {
      const nx2 = x + (fq.axis === 0 ? fq.sign : 0);
      const ny2 = y + (fq.axis === 1 ? fq.sign : 0);
      const nz2 = z + (fq.axis === 2 ? fq.sign : 0);
      const out = nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz;
      if (!out && shown(cellIdx(nx2, ny2, nz2))) continue;
      const pts = fq.corners.map(co => gridPointToWorldMm(model.domain, x + co[0], y + co[1], z + co[2]));
      const e1 = sub3(pts[1], pts[0]), e2 = sub3(pts[2], pts[0]);
      const cr = cross3(e1, e2), cl = len3(cr) || 1, nrm = scale3(cr, 1 / cl);
      pushV(pts[0], nrm, col); pushV(pts[1], nrm, col); pushV(pts[2], nrm, col);
      pushV(pts[0], nrm, col); pushV(pts[2], nrm, col); pushV(pts[3], nrm, col);
    }
  }
  return {vertices: verts, vertexCount: quadCount * 6};
}

function buildFlowArrowsVertices(model, ev) {
  if (!ev?.vel || model.medium.isVacuum || ev.maxFlowMs < 1e-4) return {vertices: new Float32Array(0), vertexCount: 0};
  const [nx, ny, nz] = model.domain.cells;
  const [bx, by, bz] = model.domain.basis;
  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  const targetSeeds = 1200;
  const stride = Math.max(1, Math.round(Math.cbrt(model.domain.count / targetSeeds)));
  const pitchMm = Math.max(...model.domain.spacingM) * M_TO_MM;
  const maxLenMm = Math.max(pitchMm * stride * 1.15, pitchMm * 2.2);
  const minSpd = ev.maxFlowMs * 0.04;
  const tLo = Math.min(ev.minSolidTempC, ev.minAllTempC);
  const tSpan = Math.max(1e-3, Math.max(ev.maxSolidTempC, ev.maxAllTempC) - tLo);

  const out = [];
  const pushTri = (a, b, c, col) => {
    const cr = cross3(sub3(b, a), sub3(c, a)), cl = len3(cr) || 1, n = scale3(cr, 1 / cl);
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  };
  const addArrow = (origin, dir, length, col) => {
    const up = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u0 = cross3(up, dir), u = scale3(u0, 1 / (len3(u0) || 1));
    const v = cross3(dir, u);
    const rBase = length * 0.14;
    const tip = add3(origin, scale3(dir, length));
    const base = add3(origin, scale3(dir, -length * 0.25));
    const ring = [
      add3(base, scale3(u, rBase)),
      add3(base, scale3(v, rBase)),
      add3(base, scale3(u, -rBase)),
      add3(base, scale3(v, -rBase))
    ];
    for (let k = 0; k < 4; k++) pushTri(ring[k], ring[(k + 1) % 4], tip, col);
    pushTri(ring[0], ring[2], ring[1], col);
    pushTri(ring[0], ring[3], ring[2], col);
  };

  for (let z = Math.floor(stride / 2); z < nz; z += stride) {
    for (let y = Math.floor(stride / 2); y < ny; y += stride) {
      for (let x = Math.floor(stride / 2); x < nx; x += stride) {
        const c = cellIdx(x, y, z);
        if (model.cellType[c] !== CELL_TYPE.FLUID) continue;
        const ux = ev.vel[4*c], uy = ev.vel[4*c+1], uz = ev.vel[4*c+2], spd = ev.vel[4*c+3];
        if (spd < minSpd) continue;
        const wDir = [
          bx[0]*ux + by[0]*uy + bz[0]*uz,
          bx[1]*ux + by[1]*uy + bz[1]*uz,
          bx[2]*ux + by[2]*uy + bz[2]*uz
        ];
        const wl = len3(wDir);
        if (wl < 1e-9) continue;
        const dir = scale3(wDir, 1 / wl);
        const relSpd = clamp(spd / ev.maxFlowMs, 0.15, 1.0);
        const len = maxLenMm * (0.35 + 0.65 * Math.sqrt(relSpd));
        const origin = gridPointToWorldMm(model.domain, x + 0.5, y + 0.5, z + 0.5);
        // Color by fluid temperature blended slightly toward cyan for cool ambient intake
        const tn = clamp((ev.tempsC[c] - tLo) / tSpan, 0, 1);
        const col = tn < 0.08 ? [0.22, 0.72, 0.94] : thermalColorRGB(tn);
        addArrow(origin, dir, len, col);
      }
    }
  }
  const vertices = Float32Array.from(out);
  return {vertices, vertexCount: vertices.length / 9};
}

// ---------- Viewport Shaders (Voxel/Arrow + Smooth Mesh 3D-Texture + Interactive Air Slice) ----------

const COLORMAP_WGSL = `
fn thermalPalette(uIn: f32) -> vec3f {
  let u = clamp(uIn, 0.0, 1.0);
  if (u < 0.22) { return mix(vec3f(0.06, 0.07, 0.24), vec3f(0.28, 0.09, 0.46), u / 0.22); }
  if (u < 0.45) { return mix(vec3f(0.28, 0.09, 0.46), vec3f(0.66, 0.14, 0.38), (u - 0.22) / 0.23); }
  if (u < 0.68) { return mix(vec3f(0.66, 0.14, 0.38), vec3f(0.91, 0.37, 0.14), (u - 0.45) / 0.23); }
  if (u < 0.88) { return mix(vec3f(0.91, 0.37, 0.14), vec3f(0.99, 0.76, 0.16), (u - 0.68) / 0.20); }
  return mix(vec3f(0.99, 0.76, 0.16), vec3f(1.00, 0.97, 0.80), (u - 0.88) / 0.12);
}
fn fluxPalette(uIn: f32) -> vec3f {
  let u = clamp(uIn, 0.0, 1.0);
  if (u < 0.33) { return mix(vec3f(0.07, 0.14, 0.32), vec3f(0.12, 0.56, 0.64), u / 0.33); }
  if (u < 0.66) { return mix(vec3f(0.12, 0.56, 0.64), vec3f(0.62, 0.84, 0.26), (u - 0.33) / 0.33); }
  return mix(vec3f(0.62, 0.84, 0.26), vec3f(0.99, 0.94, 0.36), (u - 0.66) / 0.34);
}
`;

const DISPLAY_WGSL = `
struct Camera { rotation: mat4x4f, centerScale: vec4f, viewport: vec4f, clip: vec4f, frame: vec4f, modes: vec4f };
@group(0) @binding(0) var<uniform> camera: Camera;
override orthographic: bool = false;
struct VOut { @builtin(position) position: vec4f, @location(0) normal: vec3f, @location(1) color: vec3f };
@vertex fn vs(@location(0) world: vec3f, @location(1) normal: vec3f, @location(2) color: vec3f) -> VOut {
  let p = (frameCameraRelative(camera.rotation) * vec4f((world - camera.centerScale.xyz) * camera.centerScale.w, 1.0)).xyz;
  let xy = p.xy + camera.viewport.zw;
  let depth = -p.z;
  var out: VOut;
  if (orthographic) {
    out.position = vec4f(xy.x * camera.viewport.y / camera.viewport.x, xy.y * camera.viewport.y, (depth - camera.clip.x) / (camera.clip.y - camera.clip.x), 1.0);
  } else {
    out.position = vec4f(xy.x * camera.clip.w / camera.viewport.x, xy.y * camera.clip.w, (camera.clip.y * depth - camera.clip.x * camera.clip.y) / (camera.clip.y - camera.clip.x), depth);
  }
  out.normal = (camera.rotation * vec4f(normal, 0.0)).xyz;
  out.color = color;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let n = normalize(input.normal);
  let key = abs(dot(n, normalize(vec3f(0.35, 0.55, 0.76))));
  let shade = 0.42 + 0.58 * key;
  return vec4f(input.color * shade, 1.0);
}
`;

function smoothSurfaceWGSL(storage) {
  const tex = storage === 'texture';
  const readHelpers = tex
    ? `fn scalar(t:texture_2d_array<u32>,i:u32)->u32{let d=textureDimensions(t);return textureLoad(t,vec2i(vec2u(i%d.x,(i/d.x)%d.y)),i32(i/(d.x*d.y)),0).x;}
       fn idx(i:u32)->u32{return scalar(indices,i);}
       fn val(i:u32)->f32{return bitcast<f32>(scalar(positions,i));}`
    : `fn idx(i:u32)->u32{return indices[i];}
       fn val(i:u32)->f32{return positions[i];}`;
  return COLORMAP_WGSL + `
struct Camera { rotation: mat4x4f, centerScale: vec4f, viewport: vec4f, clip: vec4f, frame: vec4f, modes: vec4f };
struct DomCfg { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f, params: vec4f }; // params.x = mode (0=temp, 1=flux)
struct MeshCfg { world: mat4x4f };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var fieldTex: texture_3d<f32>;
@group(1) @binding(1) var fieldSamp: sampler;
@group(1) @binding(2) var<uniform> dom: DomCfg;
@group(2) @binding(0) var<uniform> meshCfg: MeshCfg;
@group(2) @binding(1) var ${tex ? 'positions: texture_2d_array<u32>' : '<storage,read> positions: array<f32>'};
@group(2) @binding(2) var ${tex ? 'indices: texture_2d_array<u32>' : '<storage,read> indices: array<u32>'};
override orthographic: bool = false;
${readHelpers}
fn ptW(i: u32) -> vec3f { return (meshCfg.world * vec4f(val(3u*i), val(3u*i+1u), val(3u*i+2u), 1.0)).xyz; }
struct VOut { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f };
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  let tri = vid / 3u; let corner = vid % 3u;
  let p0 = ptW(idx(3u*tri)); let p1 = ptW(idx(3u*tri + 1u)); let p2 = ptW(idx(3u*tri + 2u));
  let world = select(select(p0, p1, corner == 1u), p2, corner == 2u);
  let cr = cross(p1 - p0, p2 - p0);
  let cl = length(cr);
  let nrm = select(vec3f(0.0, 1.0, 0.0), cr / cl, cl > 1e-12);
  let p = (frameCameraRelative(camera.rotation) * vec4f((world - camera.centerScale.xyz) * camera.centerScale.w, 1.0)).xyz;
  let xy = p.xy + camera.viewport.zw;
  let depth = -p.z;
  var out: VOut;
  if (orthographic) {
    out.position = vec4f(xy.x * camera.viewport.y / camera.viewport.x, xy.y * camera.viewport.y, (depth - camera.clip.x) / (camera.clip.y - camera.clip.x), 1.0);
  } else {
    out.position = vec4f(xy.x * camera.clip.w / camera.viewport.x, xy.y * camera.clip.w, (camera.clip.y * depth - camera.clip.x * camera.clip.y) / (camera.clip.y - camera.clip.x), depth);
  }
  out.world = world;
  out.normal = (camera.rotation * vec4f(nrm, 0.0)).xyz;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let d = input.world - dom.origin.xyz;
  let u = dot(d, dom.bx.xyz) / dom.bx.w;
  let v = dot(d, dom.by.xyz) / dom.by.w;
  let w = dot(d, dom.bz.xyz) / dom.bz.w;
  if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001 || w < -0.001 || w > 1.001) { discard; }
  let s = textureSampleLevel(fieldTex, fieldSamp, clamp(vec3f(u, v, w), vec3f(0.0), vec3f(1.0)), 0.0);
  let col = select(thermalPalette(s.x), fluxPalette(s.y), dom.params.x > 0.5);
  let n = normalize(input.normal);
  let key = abs(dot(n, normalize(vec3f(0.35, 0.55, 0.76))));
  let shade = 0.42 + 0.58 * key;
  return vec4f(col * shade, 1.0);
}
`;
}

const SLICE_WGSL = COLORMAP_WGSL + `
struct Camera { rotation: mat4x4f, centerScale: vec4f, viewport: vec4f, clip: vec4f, frame: vec4f, modes: vec4f };
struct SliceCfg { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f, params: vec4f }; // params: (axis 1=X 2=Y 3=Z, pos01, mode 0=temp 1=flow, unused)
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var fluidTex: texture_3d<f32>;
@group(1) @binding(1) var fieldSamp: sampler;
@group(1) @binding(2) var<uniform> sc: SliceCfg;
override orthographic: bool = false;
struct VOut { @builtin(position) position: vec4f, @location(0) uvw: vec3f, @location(1) uv2: vec2f };
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  let quad = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(1,1), vec2f(0,0), vec2f(1,1), vec2f(0,1));
  let uv = quad[vid];
  let axis = i32(sc.params.x + 0.5);
  let t = clamp(sc.params.y, 0.0, 1.0);
  var uvw = vec3f(0.0);
  if (axis == 1) { uvw = vec3f(t, uv.x, uv.y); }
  else if (axis == 2) { uvw = vec3f(uv.x, t, uv.y); }
  else { uvw = vec3f(uv.x, uv.y, t); }
  let world = sc.origin.xyz + sc.bx.xyz * (uvw.x * sc.bx.w) + sc.by.xyz * (uvw.y * sc.by.w) + sc.bz.xyz * (uvw.z * sc.bz.w);
  let p = (frameCameraRelative(camera.rotation) * vec4f((world - camera.centerScale.xyz) * camera.centerScale.w, 1.0)).xyz;
  let xy = p.xy + camera.viewport.zw;
  let depth = -p.z;
  var out: VOut;
  if (orthographic) {
    out.position = vec4f(xy.x * camera.viewport.y / camera.viewport.x, xy.y * camera.viewport.y, (depth - camera.clip.x) / (camera.clip.y - camera.clip.x), 1.0);
  } else {
    out.position = vec4f(xy.x * camera.clip.w / camera.viewport.x, xy.y * camera.clip.w, (camera.clip.y * depth - camera.clip.x * camera.clip.y) / (camera.clip.y - camera.clip.x), depth);
  }
  out.uvw = uvw;
  out.uv2 = uv;
  return out;
}
@fragment fn fs(input: VOut) -> @location(0) vec4f {
  let border = min(min(input.uv2.x, 1.0 - input.uv2.x), min(input.uv2.y, 1.0 - input.uv2.y));
  if (border < 0.008) { return vec4f(0.95, 0.72, 0.48, 0.85); }
  let s = textureSampleLevel(fluidTex, fieldSamp, clamp(input.uvw, vec3f(0.0), vec3f(1.0)), 0.0);
  let val = select(s.x, s.y, sc.params.z > 0.5);
  var col = select(thermalPalette(val), fluxPalette(val), sc.params.z > 0.5);
  // Subtle isotherm / isovelocity contours
  let band = abs(fract(val * 10.0) - 0.5);
  let line = 1.0 - smoothstep(0.0, 0.06, band);
  col = mix(col, vec3f(1.0), 0.18 * line);
  let isSolid = s.z > 0.5;
  let alpha = select(0.28 + 0.52 * clamp(val, 0.0, 1.0), 0.90, isSolid);
  return vec4f(col, alpha);
}
`;

// ---------- Helper Geometry (Box, Fan with Shroud + Flow Arrow, Probe Crosshair) ----------

function makeBoxLines() {
  const lines = [];
  for (let axis = 0; axis < 3; axis++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    const p = [-50, -50, -50], q = [-50, -50, -50];
    p[(axis+1)%3] = q[(axis+1)%3] = a ? 50 : -50;
    p[(axis+2)%3] = q[(axis+2)%3] = b ? 50 : -50;
    q[axis] = 50;
    lines.push(...p, ...q);
  }
  return new Float32Array(lines);
}

function makeFanLines() {
  const lines = Array.from(makeBoxLines());
  // Octagonal fan shroud ring in YZ plane (x = 0, radius 42 mm)
  const segs = 12, r = 42;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    lines.push(0, Math.cos(a0)*r, Math.sin(a0)*r, 0, Math.cos(a1)*r, Math.sin(a1)*r);
  }
  // Bold airflow direction arrow pointing along +X (with shaft extending outside casing so direction is unmistakable)
  lines.push(-50, 0, 0, 110, 0, 0);
  lines.push(110, 0, 0, 72, 22, 0);
  lines.push(110, 0, 0, 72, -22, 0);
  lines.push(110, 0, 0, 72, 0, 22);
  lines.push(110, 0, 0, 72, 0, -22);
  return new Float32Array(lines);
}

function makeProbeLines() {
  const lines = Array.from(makeBoxLines());
  lines.push(-50, 0, 0, 50, 0, 0, 0, -50, 0, 0, 50, 0, 0, 0, -50, 0, 0, 50);
  return new Float32Array(lines);
}

// ---------- Plugin Activation ----------

export async function activate(context) {
  if (context.version !== 1) throw fail('API_VERSION', 'Unsupported Frame plugin API.');
  const D = context.document;
  const CAPTURE_KEYS = ['Auto size', 'Voxel size', 'Medium', 'Ambient', 'Initial', 'Time scale'];

  const findAny = hash => {
    const n = D.nodes.find(x => x.nativeHash === hash);
    if (!n || !['thermal', 'thermal_probe', 'thermal_fan'].includes(n.type))
      throw fail('INVALID_OWNER', 'Thermal object no longer exists.');
    return n;
  };
  const owner = hash => {
    const n = findAny(hash);
    if (n.type !== 'thermal') throw fail('INVALID_OWNER', 'Select a Thermal object.');
    return n;
  };

  const states = new Map();     // ownerHash -> live state
  const archives = new Map();   // ownerHash -> {version, frames: Map<frame, summary>, fields: Map<frame, {theta, vel, ambientC}>, fieldBytes, seriesCache}
  const slices = new Map();     // ownerHash -> {axis: 'Off'|'X'|'Y'|'Z', position: 50}
  const filterCache = new Map();
  const voxPipeCache = new WeakMap();
  let renderState = {device: null, pipes: null, pending: null, camGroups: new WeakMap(), camLayout: null, fieldLayout: null, meshLayoutBuf: null, meshLayoutTex: null, sampler: null};
  let jobSerial = 0;

  const getSlice = hash => {
    let s = slices.get(hash);
    if (!s) slices.set(hash, s = {axis: 'Off', position: 50});
    return s;
  };
  const getArchive = hash => {
    let a = archives.get(hash);
    if (!a) archives.set(hash, a = {version: 0, frames: new Map(), fields: new Map(), fieldBytes: 0, seriesCache: new Map()});
    return a;
  };
  const refresh = () => { context.requestAttributes?.(); context.requestDraw?.(); };

  function destroyStateGPU(st) {
    if (!st) return;
    st.voxelBuf?.destroy(); st.voxelBuf = null; st.voxelVerts = 0;
    st.flowBuf?.destroy(); st.flowBuf = null; st.flowVerts = 0;
    st.solidTex?.destroy(); st.solidTex = null;
    st.fluidTex?.destroy(); st.fluidTex = null;
    st.domUniformBuf?.destroy(); st.domUniformBuf = null;
    st.sliceUniformBuf?.destroy(); st.sliceUniformBuf = null;
    st.solidFieldBG = null; st.fluidFieldBG = null;
    if (st.meshEntries) {
      for (const me of st.meshEntries) { me.uniformBuf?.destroy(); }
      st.meshEntries = null;
    }
  }

  function retireOwner(hash) {
    const st = states.get(hash);
    if (st) {
      if (st.job) st.job.cancelled = true;
      destroyStateGPU(st);
      states.delete(hash);
    }
    const flt = filterCache.get(hash);
    if (flt) { flt.uniformBuf?.destroy(); filterCache.delete(hash); }
    archives.delete(hash);
    slices.delete(hash);
  }

  // ---------- Viewport Render Pipeline Preparation ----------

  function ensureRenderPipelines(device, format) {
    if (renderState.device !== device || renderState.format !== format) {
      renderState = {
        device, format, pipes: null, pending: null, camGroups: new WeakMap(),
        camLayout: null, fieldLayout: null, meshLayoutBuf: null, meshLayoutTex: null, sampler: null
      };
    }
    if (renderState.pipes) return renderState.pipes;
    if (renderState.pending) return null;

    const camWGSL = context.viewport?.cameraWGSL || '';
    const camLayout = device.createBindGroupLayout({
      entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}}]
    });
    const fieldLayout = device.createBindGroupLayout({
      entries: [
        {binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: 'float', viewDimension: '3d'}},
        {binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {type: 'filtering'}},
        {binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}}
      ]
    });
    const mkMeshLayout = tex => device.createBindGroupLayout({
      entries: [
        {binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}},
        tex ? {binding: 1, visibility: GPUShaderStage.VERTEX, texture: {sampleType: 'uint', viewDimension: '2d-array'}}
            : {binding: 1, visibility: GPUShaderStage.VERTEX, buffer: {type: 'read-only-storage'}},
        tex ? {binding: 2, visibility: GPUShaderStage.VERTEX, texture: {sampleType: 'uint', viewDimension: '2d-array'}}
            : {binding: 2, visibility: GPUShaderStage.VERTEX, buffer: {type: 'read-only-storage'}}
      ]
    });
    const meshLayoutBuf = mkMeshLayout(false);
    const meshLayoutTex = mkMeshLayout(true);
    const sampler = device.createSampler({magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge'});

    renderState.camLayout = camLayout;
    renderState.fieldLayout = fieldLayout;
    renderState.meshLayoutBuf = meshLayoutBuf;
    renderState.meshLayoutTex = meshLayoutTex;
    renderState.sampler = sampler;

    const dispMod = device.createShaderModule({label: 'Thermal display', code: camWGSL + '\n' + DISPLAY_WGSL});
    const surfBufMod = device.createShaderModule({label: 'Thermal surf buf', code: camWGSL + '\n' + smoothSurfaceWGSL('buffer')});
    const surfTexMod = device.createShaderModule({label: 'Thermal surf tex', code: camWGSL + '\n' + smoothSurfaceWGSL('texture')});
    const sliceMod = device.createShaderModule({label: 'Thermal slice', code: camWGSL + '\n' + SLICE_WGSL});

    const dispPL = device.createPipelineLayout({bindGroupLayouts: [camLayout]});
    const surfBufPL = device.createPipelineLayout({bindGroupLayouts: [camLayout, fieldLayout, meshLayoutBuf]});
    const surfTexPL = device.createPipelineLayout({bindGroupLayouts: [camLayout, fieldLayout, meshLayoutTex]});
    const slicePL = device.createPipelineLayout({bindGroupLayouts: [camLayout, fieldLayout]});

    const vbufLayout = [{
      arrayStride: 36,
      attributes: [
        {shaderLocation: 0, offset: 0, format: 'float32x3'},
        {shaderLocation: 1, offset: 12, format: 'float32x3'},
        {shaderLocation: 2, offset: 24, format: 'float32x3'}
      ]
    }];

    renderState.pending = Promise.all([
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Thermal voxel/arrow ' + (orthographic ? 'ortho' : 'persp'),
        layout: dispPL,
        vertex: {module: dispMod, entryPoint: 'vs', constants: {orthographic}, buffers: vbufLayout},
        fragment: {module: dispMod, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })),
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Thermal smooth buf ' + (orthographic ? 'ortho' : 'persp'),
        layout: surfBufPL,
        vertex: {module: surfBufMod, entryPoint: 'vs', constants: {orthographic}},
        fragment: {module: surfBufMod, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })),
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Thermal smooth tex ' + (orthographic ? 'ortho' : 'persp'),
        layout: surfTexPL,
        vertex: {module: surfTexMod, entryPoint: 'vs', constants: {orthographic}},
        fragment: {module: surfTexMod, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })),
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Thermal slice ' + (orthographic ? 'ortho' : 'persp'),
        layout: slicePL,
        vertex: {module: sliceMod, entryPoint: 'vs', constants: {orthographic}},
        fragment: {
          module: sliceMod, entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              color: {srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha'},
              alpha: {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'}
            }
          }]
        },
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal'}
      }))
    ]).then(([d0, d1, sb0, sb1, st0, st1, sl0, sl1]) => {
      if (renderState.device === device) {
        renderState.pipes = {display: [d0, d1], surfBuf: [sb0, sb1], surfTex: [st0, st1], slice: [sl0, sl1]};
        renderState.pending = null;
        context.requestDraw?.();
      }
    }).catch(() => { renderState.pending = null; });
    return null;
  }

  function updateDomainUniforms(hash) {
    const st = states.get(hash), device = st?.device;
    if (!st?.model || !device) return;
    const d = st.model.domain;
    const domData = new Float32Array(20);
    domData.set([d.originWorldM[0]*M_TO_MM, d.originWorldM[1]*M_TO_MM, d.originWorldM[2]*M_TO_MM, 0], 0);
    domData.set([d.basis[0][0], d.basis[0][1], d.basis[0][2], d.lengthsM[0]*M_TO_MM], 4);
    domData.set([d.basis[1][0], d.basis[1][1], d.basis[1][2], d.lengthsM[1]*M_TO_MM], 8);
    domData.set([d.basis[2][0], d.basis[2][1], d.basis[2][2], d.lengthsM[2]*M_TO_MM], 12);
    domData.set([st.mode === 'Flux' ? 1 : 0, 0, 0, 0], 16);
    if (!st.domUniformBuf) {
      st.domUniformBuf = device.createBuffer({label: 'Thermal dom uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    }
    device.queue.writeBuffer(st.domUniformBuf, 0, domData);

    const sl = getSlice(hash);
    const axisNum = sl.axis === 'X' ? 1 : sl.axis === 'Y' ? 2 : sl.axis === 'Z' ? 3 : 0;
    const slData = new Float32Array(domData);
    slData.set([axisNum, clamp(sl.position / 100, 0, 1), st.mode === 'Flow' ? 1 : 0, 0], 16);
    if (!st.sliceUniformBuf) {
      st.sliceUniformBuf = device.createBuffer({label: 'Thermal slice uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    }
    device.queue.writeBuffer(st.sliceUniformBuf, 0, slData);
  }

  function updateSurfaceFilter(hash) {
    const st = states.get(hash), device = st?.device;
    const hasVisual = !!(st?.model && (st.voxelVerts > 0 || (st.eval && st.meshEntries?.length > 0)) && st.mode !== 'Flow');
    if (!hasVisual || !device) {
      const old = filterCache.get(hash);
      if (old) { old.uniformBuf?.destroy(); filterCache.delete(hash); }
      return;
    }
    const d = st.model.domain;
    const data = new Float32Array(16);
    data.set([d.originWorldM[0]*M_TO_MM, d.originWorldM[1]*M_TO_MM, d.originWorldM[2]*M_TO_MM, 0], 0);
    data.set([d.basis[0][0], d.basis[0][1], d.basis[0][2], d.lengthsM[0]*M_TO_MM], 4);
    data.set([d.basis[1][0], d.basis[1][1], d.basis[1][2], d.lengthsM[1]*M_TO_MM], 8);
    data.set([d.basis[2][0], d.basis[2][1], d.basis[2][2], d.lengthsM[2]*M_TO_MM], 12);
    let entry = filterCache.get(hash);
    if (!entry || entry.device !== device) {
      entry?.uniformBuf?.destroy();
      const uniformBuf = device.createBuffer({label: 'Thermal surface filter', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      const shader = `
        struct ThermalClip { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f };
        @group(3) @binding(0) var<uniform> thermalClip: ThermalClip;
        fn pluginSurfaceKeep(world: vec3f) -> bool {
          let d = world - thermalClip.origin.xyz;
          let u = dot(d, thermalClip.bx.xyz);
          let v = dot(d, thermalClip.by.xyz);
          let w = dot(d, thermalClip.bz.xyz);
          let inside = u >= -0.05 && u <= thermalClip.bx.w + 0.05 &&
                       v >= -0.05 && v <= thermalClip.by.w + 0.05 &&
                       w >= -0.05 && w <= thermalClip.bz.w + 0.05;
          return !inside;
        }
      `;
      entry = {owner: hash, device, uniformBuf, shader, buffers: [{buffer: uniformBuf, type: 'uniform'}], hashes: new Set()};
      filterCache.set(hash, entry);
    }
    entry.hashes = new Set(st.participatingHashes || []);
    device.queue.writeBuffer(entry.uniformBuf, 0, data);
  }

  function rebuildVisualBuffers(hash) {
    const st = states.get(hash), device = st?.device;
    if (!st?.model || !device) { updateSurfaceFilter(hash); return; }

    // 1) Voxel shell (always built for Voxels mode & smooth fallback)
    st.voxelBuf?.destroy(); st.voxelBuf = null; st.voxelVerts = 0;
    const vox = buildVoxelShellVertices(st.model, st.eval, st.mode === 'Voxels' || !st.eval ? 'Voxels' : st.mode);
    if (vox.vertexCount > 0) {
      st.voxelBuf = device.createBuffer({label: 'Thermal voxels', size: Math.max(36, vox.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(st.voxelBuf, 0, vox.vertices);
      st.voxelVerts = vox.vertexCount;
    }

    // 2) Airflow arrows
    st.flowBuf?.destroy(); st.flowBuf = null; st.flowVerts = 0;
    if (st.eval && !st.model.medium.isVacuum) {
      const fl = buildFlowArrowsVertices(st.model, st.eval);
      if (fl.vertexCount > 0) {
        st.flowBuf = device.createBuffer({label: 'Thermal airflow', size: Math.max(36, fl.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
        device.queue.writeBuffer(st.flowBuf, 0, fl.vertices);
        st.flowVerts = fl.vertexCount;
      }
    }

    // 3) 3D RGBA16Float field textures for smooth surface rendering and interactive slice
    if (st.eval) {
      const [nx, ny, nz] = st.model.domain.cells;
      const packed = packFieldTextures(st.model, st.eval);
      const texDesc = label => ({
        label, size: [nx, ny, nz], dimension: '3d', format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      if (!st.solidTex || st.texDims?.[0] !== nx || st.texDims?.[1] !== ny || st.texDims?.[2] !== nz) {
        st.solidTex?.destroy(); st.fluidTex?.destroy();
        st.solidTex = device.createTexture(texDesc('Thermal solid 3D'));
        st.fluidTex = device.createTexture(texDesc('Thermal fluid 3D'));
        st.texDims = [nx, ny, nz];
        st.solidFieldBG = null; st.fluidFieldBG = null;
      }
      device.queue.writeTexture({texture: st.solidTex}, packed.solidTex, {bytesPerRow: nx * 8, rowsPerImage: ny}, [nx, ny, nz]);
      device.queue.writeTexture({texture: st.fluidTex}, packed.fluidTex, {bytesPerRow: nx * 8, rowsPerImage: ny}, [nx, ny, nz]);
    }

    // 4) Smooth mesh uniform entries (bind groups created lazily once renderState layouts exist)
    if (st.meshEntries) { for (const me of st.meshEntries) me.uniformBuf?.destroy(); st.meshEntries = null; }
    if (st.participatingMeshes?.length) {
      st.meshEntries = st.participatingMeshes.map(m => {
        const uniformBuf = device.createBuffer({label: 'Thermal mesh xf', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
        device.queue.writeBuffer(uniformBuf, 0, new Float32Array(m.worldMatrix));
        return {
          hash: m.hash, storage: m.storage, positions: m.positions, indices: m.indices,
          triangleCount: m.triangleCount, uniformBuf, bindGroup: null
        };
      });
    }

    updateDomainUniforms(hash);
    updateSurfaceFilter(hash);
  }

  // ---------- Scene Capture -> GPU Voxelization -> Thermal Model ----------

  function gatherFansForOwner(ownerHash, domain) {
    const fans = [];
    for (const n of D.nodes) {
      if (n.type !== 'thermal_fan' || n.enabled === false || n.params.Thermal !== ownerHash) continue;
      const meta = nativeFanMetadata(context, n);
      if (!meta.mapping.solverEligible) continue;
      const world = Array.from(D.world(n.nativeHash));
      const invWorld = Array.from(context.math.inv(world));
      const cols = [0, 4, 8].map(i => world.slice(i, i + 3));
      const scales = cols.map(len3);
      const axW = meta.normalizedWorldAxis;
      const axG = [dot3(axW, domain.basis[0]), dot3(axW, domain.basis[1]), dot3(axW, domain.basis[2])];
      const axLen = len3(axG) || 1;
      fans.push({
        hash: n.nativeHash,
        name: n.name,
        shutoffPressure: n.params['Shutoff pressure'],
        freeFlow: n.params['Free flow'],
        direction: meta.mapping.direction,
        areaM2: meta.mapping.areaM2,
        thicknessM: meta.mapping.thicknessM,
        scales,
        world,
        invWorld,
        axisWorld: axW,
        axisGrid: scale3(axG, 1 / axLen)
      });
    }
    return fans;
  }

  function gatherProbesForOwner(ownerHash) {
    const probes = [];
    for (const n of D.nodes) {
      if (n.type !== 'thermal_probe' || n.enabled === false || n.params.Thermal !== ownerHash) continue;
      try {
        const w = Array.from(D.world(n.nativeHash));
        probes.push({hash: n.nativeHash, name: n.name, worldMm: w.slice(12, 15)});
      } catch {}
    }
    return probes;
  }

  function computeAutoWorldBounds(ownerHash, meshes, ownerWorld) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], found = false;
    const expand = p => { found = true; for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; } };
    for (const m of meshes) {
      const t = m.tags;
      const tagged = t && (t.nearest?.thermal_material || t.nearest?.thermal_temperature || (t.additive?.thermal_heater?.length > 0));
      if (!tagged) continue;
      for (let k = 0; k < 8; k++) {
        const cornerLocal = [
          k & 1 ? m.bounds.max[0] : m.bounds.min[0],
          k & 2 ? m.bounds.max[1] : m.bounds.min[1],
          k & 4 ? m.bounds.max[2] : m.bounds.min[2]
        ];
        expand(context.math.point(ownerWorld, cornerLocal));
      }
    }
    for (const n of D.nodes) {
      if ((n.type === 'thermal_fan' || n.type === 'thermal_probe') && n.enabled !== false && n.params.Thermal === ownerHash) {
        try {
          const w = D.world(n.nativeHash);
          for (let k = 0; k < 8; k++) {
            const c = [k & 1 ? 50 : -50, k & 2 ? 50 : -50, k & 4 ? 50 : -50];
            expand(context.math.point(w, c));
          }
        } catch {}
      }
    }
    return found ? {min, max} : null;
  }

  function thermalSignature(hash) {
    const captureOpts = {includeTags: true};
    const base = context.scene.signature(hash, CAPTURE_KEYS, captureOpts);
    const wStr = Array.from(D.world(hash), v => Math.round(v * 1e6)).join(',');
    const helpers = D.nodes
      .filter(n => (n.type === 'thermal_fan' || n.type === 'thermal_probe') && n.params.Thermal === hash)
      .map(n => {
        const w = Array.from(D.world(n.nativeHash), v => Math.round(v * 1e6)).join(',');
        return `${n.nativeHash}:${n.enabled !== false}:${JSON.stringify(n.params)}:${w}`;
      }).sort().join('|');
    return `${base}|${wStr}|${helpers}`;
  }

  async function captureAndVoxelize(hash, checkCurrent) {
    const n = owner(hash), device = context.device;
    if (!device) throw fail('NO_DEVICE', 'Shared WebGPU device is unavailable.');
    validateThermalParameters(n.params);
    const autoSize = !!n.params['Auto size'];
    const voxelSizeMm = n.params['Voxel size'];
    const mediumName = n.params.Medium || 'Air';
    const ambientC = n.params.Ambient;
    const initialC = n.params.Initial;
    const ownerWorld = Array.from(D.world(hash));
    const captureOpts = {includeTags: true};
    const snapshot = context.scene.capture(hash, CAPTURE_KEYS, captureOpts);

    const domain = autoSize
      ? computeAutoDomain(computeAutoWorldBounds(hash, snapshot.meshes, ownerWorld), voxelSizeMm, mediumName)
      : computeManualDomain(ownerWorld, voxelSizeMm);

    const pipes = await getVoxelizerPipelines(device, voxPipeCache);
    checkCurrent?.();

    const domainWords = Math.ceil(domain.count / 32);
    const solidBodies = [];
    const heaterSourceMap = new Map();
    const participatingHashes = new Set();
    const participatingMeshes = [];
    const orBits = (dst, src) => { for (let i = 0; i < dst.length; i++) dst[i] |= src[i]; };
    const intersectsManual = m => autoSize || !m.bounds.min.some((v, i) => v > 50 + voxelSizeMm * 2 || m.bounds.max[i] < -50 - voxelSizeMm * 2);

    for (const m of snapshot.meshes) {
      const nearest = m.tags?.nearest || {};
      const additiveHeaters = m.tags?.additive?.thermal_heater || [];
      const matTag = nearest.thermal_material;
      const tempTag = nearest.thermal_temperature;
      if (!matTag && !tempTag && !additiveHeaters.length) continue;
      if (!intersectsManual(m) && !additiveHeaters.length) continue;

      checkCurrent?.();
      const vox = await voxelizeOccurrenceGPU(device, m, domain, pipes, checkCurrent);
      if (vox.activeCount > 0) {
        participatingHashes.add(m.hash);
        participatingMeshes.push(m);
        solidBodies.push({
          hash: m.hash, solid: m.solid,
          material: resolveMaterialProps(matTag?.params || null),
          fixedTempC: tempTag ? tempTag.params.Temperature : null,
          occupancy: vox.occupancy, activeCount: vox.activeCount, volumeM3: vox.volumeM3
        });
      }
      for (const hTag of additiveHeaters) {
        const key = hTag.ownerHash + ':' + hTag.uid;
        let rec = heaterSourceMap.get(key);
        if (!rec) {
          rec = {
            ownerHash: hTag.ownerHash, uid: hTag.uid,
            powerW: hTag.params.Power,
            occupancy: new Uint32Array(domainWords),
            totalVolumeM3: 0
          };
          heaterSourceMap.set(key, rec);
        }
        if (vox.activeCount > 0) orBits(rec.occupancy, vox.occupancy);
        rec.totalVolumeM3 += vox.volumeM3;
      }
    }

    const fans = gatherFansForOwner(hash, domain);
    const probes = gatherProbesForOwner(hash);
    if (!solidBodies.length && !fans.length)
      throw fail('NO_THERMAL_GEOMETRY', 'Tag geometry with Material, Heater or Temperature (or add a Fan) inside the Thermal domain.');

    const model = buildThermalModel({
      domain, mediumName, ambientC, initialC,
      solidBodies, heaterSources: [...heaterSourceMap.values()], fans
    });

    const sig = thermalSignature(hash);
    const assertFresh = () => {
      checkCurrent?.();
      if (context.device !== device) throw fail('STALE_DEVICE', 'WebGPU device changed.');
      if (thermalSignature(hash) !== sig) throw fail('STALE_SCENE', 'Thermal geometry, transforms, tags or fans changed.');
    };

    return {model, probes, signature: sig, assertFresh, participatingHashes, participatingMeshes, frame: D.frame, device};
  }

  // ---------- Archive & Curves Readout Series ----------

  function recordArchiveFrame(hash, frame, ev, storeField = false) {
    const a = getArchive(hash);
    const probeMap = new Map();
    for (const p of ev.probes || []) probeMap.set(p.hash, {tempC: p.tempC, flowMs: p.flowMs, inside: p.inside, region: p.region});
    a.frames.set(frame, {
      maxTempC: ev.maxSolidTempC,
      minTempC: ev.minSolidTempC,
      heatInW: ev.heatInW,
      heatOutW: ev.heatOutW,
      maxFlowMs: ev.maxFlowMs,
      probes: probeMap
    });
    if (storeField && ev.theta) {
      const bytes = ev.theta.byteLength + (ev.vel ? ev.vel.byteLength : 0);
      if (a.fieldBytes + bytes <= MAX_ARCHIVE_FIELD_BYTES) {
        a.fields.set(frame, {theta: Float32Array.from(ev.theta), vel: ev.vel ? Float32Array.from(ev.vel) : null, ambientC: ev.ambientC});
        a.fieldBytes += bytes;
      }
    }
    a.version++;
    a.seriesCache.clear();
  }

  function readoutSeries(hash, key, label, unit, probeHash = null) {
    const a = archives.get(hash);
    if (!a || !a.frames.size) return null;
    const ck = `${key}:${probeHash || ''}`;
    if (a.seriesCache.has(ck)) return a.seriesCache.get(ck);
    const samples = [];
    for (const frame of [...a.frames.keys()].sort((x, y) => x - y)) {
      const row = a.frames.get(frame);
      const val = probeHash ? row.probes?.get(probeHash)?.[key] : row[key];
      if (Number.isFinite(val)) samples.push({frame, values: [val]});
    }
    if (!samples.length) return null;
    const s = {labels: [label], unit, samples};
    a.seriesCache.set(ck, s);
    return s;
  }

  // ---------- Job Lifecycle ----------

  function cancelJob(hash) {
    const st = states.get(hash);
    if (st?.job && ['queued', 'solving'].includes(st.job.state)) {
      st.job.cancelled = true;
      st.job.state = 'stopped';
      refresh();
    }
  }

  function startJob(hash, kind, fn) {
    const n = owner(hash);
    if (n.enabled === false) throw fail('DISABLED', 'Enable the Thermal object first.');
    cancelJob(hash);
    let st = states.get(hash);
    if (!st) states.set(hash, st = {hash, device: context.device, mode: 'Temp'});
    const job = {id: ++jobSerial, kind, state: 'solving', progress: 'Preparing', cancelled: false, error: null, done: null};
    st.job = job; st.error = null;
    const checkCurrent = () => {
      if (job.cancelled || states.get(hash)?.job !== job) throw fail('CANCELLED', 'Thermal calculation stopped.');
      if (!D.nodes.some(x => x.nativeHash === hash && x.type === 'thermal')) throw fail('INVALID_OWNER', 'Thermal object was removed.');
    };
    refresh();
    job.done = (async () => {
      try {
        const res = await fn(job, checkCurrent);
        checkCurrent();
        job.state = 'ready'; job.progress = '';
        st.error = null;
        return res;
      } catch (err) {
        if (err?.code === 'CANCELLED') {
          job.state = 'stopped'; job.progress = '';
        } else {
          job.state = 'failed'; job.progress = '';
          job.error = {code: err?.code || 'THERMAL_ERROR', message: err?.message || String(err)};
          st.error = job.error;
        }
        throw err;
      } finally {
        refresh();
      }
    })();
    return job.done;
  }

  // ---------- Operations: Show Voxels, Solve Steady, Solve Animation ----------

  function runShowVoxels(hash) {
    return startJob(hash, 'show-voxels', async (job, checkCurrent) => {
      job.progress = 'Voxelizing'; refresh();
      const cap = await captureAndVoxelize(hash, checkCurrent);
      cap.assertFresh();
      const st = states.get(hash);
      destroyStateGPU(st);
      Object.assign(st, {
        device: cap.device, model: cap.model, probes: cap.probes,
        signature: cap.signature, frame: cap.frame,
        participatingHashes: cap.participatingHashes,
        participatingMeshes: cap.participatingMeshes,
        eval: null, mode: 'Voxels'
      });
      rebuildVisualBuffers(hash);
      return {state: 'voxels', grid: cap.model.domain.cells, stats: cap.model.stats};
    });
  }

  function runSolveSteady(hash, {tolerance = 1e-5, maxIterations = 800, maxOuterIterations} = {}) {
    return startJob(hash, 'solve-steady', async (job, checkCurrent) => {
      job.progress = 'Voxelizing'; refresh();
      const cap = await captureAndVoxelize(hash, checkCurrent);
      cap.assertFresh();
      const {model} = cap;
      if (model.medium.isVacuum && model.stats.fixedCount === 0) {
        let hasEmissive = false;
        for (let i = 0; i < model.domain.count; i++) {
          if (model.cellType[i] === CELL_TYPE.SOLID && model.cellEmissivity[i] > 0) { hasEmissive = true; break; }
        }
        if (!hasEmissive) throw fail('NO_HEAT_SINK', 'Steady state in Vacuum requires Emissivity > 0 or a Temperature boundary.');
      }
      const hasFluid = !model.medium.isVacuum && model.stats.fluidCount > 0;
      const outerLimit = maxOuterIterations ?? (hasFluid ? 14 : 10);
      const dMin = Math.min(...model.domain.spacingM);
      const dtFlow = clamp(dMin / 4.0, 0.002, 0.05);

      const solver = await createGPUThermalSolver(cap.device, model);
      try {
        // Warm up Fan airflow before initial temperature coupling if fans exist
        if (hasFluid && model.fans.length > 0) {
          job.progress = 'Airflow'; refresh();
          await solver.stepFluid(dtFlow, 8, 20);
        }
        let prevTheta = null, lastRes = null, outer = 0;
        for (outer = 1; outer <= outerLimit; outer++) {
          checkCurrent();
          job.progress = `Pass ${outer}/${outerLimit}`; refresh();
          lastRes = await solver.solveLinearEnergy({invDt: 0, tolerance, maxIterations, checkCurrent});
          if (hasFluid) {
            await solver.stepFluid(dtFlow, outer <= 3 ? 6 : 4, 16);
          }
          const fields = await solver.readFields(false);
          let maxDelta = Infinity;
          if (prevTheta) {
            maxDelta = 0;
            for (let i = 0; i < fields.theta.length; i++) {
              const d = Math.abs(fields.theta[i] - prevTheta[i]);
              if (d > maxDelta) maxDelta = d;
            }
          }
          prevTheta = fields.theta;
          if (outer >= (hasFluid ? 3 : 2) && maxDelta < 5e-3) break;
          await new Promise(r => setTimeout(r, 0));
        }

        // Final energy solve synced to settled flow & linearized radiation
        lastRes = await solver.solveLinearEnergy({invDt: 0, tolerance, maxIterations, checkCurrent});
        const fields = await solver.readFields(true);
        cap.assertFresh();

        const ev = evaluateThermalFields(model, fields.theta, fields.vel, cap.probes, model.ambientC);
        recordArchiveFrame(hash, cap.frame, ev, false);

        const st = states.get(hash);
        destroyStateGPU(st);
        Object.assign(st, {
          device: cap.device, model, probes: cap.probes,
          signature: cap.signature, frame: cap.frame,
          participatingHashes: cap.participatingHashes,
          participatingMeshes: cap.participatingMeshes,
          eval: ev, mode: st.mode === 'Voxels' || !st.mode ? 'Temp' : st.mode,
          iterations: lastRes.iterations, outerIterations: outer, residualK: lastRes.residualK
        });
        rebuildVisualBuffers(hash);
        return {
          state: 'solved', kind: 'steady', frame: cap.frame,
          grid: model.domain.cells,
          maxTempC: ev.maxSolidTempC, minTempC: ev.minSolidTempC,
          maxAllTempC: ev.maxAllTempC, minAllTempC: ev.minAllTempC,
          maxFluxWPerM2: ev.maxFluxWPerM2, maxFlowMs: ev.maxFlowMs,
          heatInW: ev.heatInW, heatOutW: ev.heatOutW,
          radiatedOutW: ev.radiatedOutW, convectedOutW: ev.convectedOutW,
          probes: ev.probes, iterations: lastRes.iterations, outerIterations: outer, residualK: lastRes.residualK
        };
      } finally {
        await solver.dispose();
      }
    });
  }

  function runSolveAnimation(hash, {firstFrame = 0, lastFrame, tolerance = 1e-5, maxIterations = 600} = {}) {
    const tl = context.animation.timeline();
    lastFrame ??= tl.total;
    if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame) || firstFrame < 0 || lastFrame < firstFrame || lastFrame > tl.total)
      throw fail('INVALID_ARGUMENT', 'Invalid animation frame interval.');
    D.pause();
    return startJob(hash, 'solve-animation', async (job, checkCurrent) => {
      const initialFrame = D.frame;
      const fps = Math.max(1, tl.fps || 60);
      const n = owner(hash);
      const timeScale = n.params['Time scale'] ?? 1;
      const frameDt = timeScale / fps;

      // Reset archive for fresh transient run
      const a = getArchive(hash);
      a.frames.clear(); a.fields.clear(); a.fieldBytes = 0; a.version++; a.seriesCache.clear();

      const seekTo = async targetFrame => {
        if (D.frame === targetFrame) return;
        await context.animation.seek(targetFrame, D.frame, () => { checkCurrent(); return true; });
      };

      // Inspect animated properties so we only seek when parameters/heaters/fans actually animate
      const relevantHashes = [hash, ...D.nodes.filter(x => x.nativeHash && (
        ['thermal_fan', 'thermal_probe'].includes(x.type) ||
        (x.tags || []).some(t => ['thermal_material', 'thermal_heater', 'thermal_temperature'].includes(t.kind))
      )).map(x => x.nativeHash)];
      const animInfo = context.animation.inspect(relevantHashes);
      const hasAnimatedChannels = !!(animInfo?.channels?.length);

      let cap = null, solver = null, lastEv = null;
      try {
        await seekTo(firstFrame);
        job.progress = 'Voxelizing'; refresh();
        cap = await captureAndVoxelize(hash, checkCurrent);
        const {model} = cap;
        const hasFluid = !model.medium.isVacuum && model.stats.fluidCount > 0;
        const dMin = Math.min(...model.domain.spacingM);

        solver = await createGPUThermalSolver(cap.device, model);
        // Frame 0 initial state
        const initFields = await solver.readFields(true);
        lastEv = evaluateThermalFields(model, initFields.theta, initFields.vel, cap.probes, model.ambientC);
        recordArchiveFrame(hash, firstFrame, lastEv, true);

        const totalFrames = Math.max(1, lastFrame - firstFrame);
        // Choose stride for stored 3D snapshots so RAM stays cleanly under 64 MiB
        const bytesPerFrame = model.domain.count * (model.medium.isVacuum ? 4 : 20);
        const maxStored = Math.max(2, Math.floor(MAX_ARCHIVE_FIELD_BYTES / Math.max(1, bytesPerFrame)));
        const snapStride = Math.max(1, Math.ceil((totalFrames + 1) / maxStored));

        for (let f = firstFrame + 1; f <= lastFrame; f++) {
          checkCurrent();
          const stepNum = f - firstFrame;
          const elapsedS = stepNum * frameDt;
          job.progress = `f${f}/${lastFrame} (${fmtNum(elapsedS)}s)`;
          if (stepNum === 1 || stepNum % 4 === 0 || f === lastFrame) refresh();

          if (hasAnimatedChannels) {
            await seekTo(f);
            // Update dynamic Ambient, Heater powers, Fixed-T temperatures, and Fan curves without re-voxelizing static geometry
            const curOwner = owner(hash);
            const curAmb = curOwner.params.Ambient;
            const curSnap = context.scene.capture(hash, CAPTURE_KEYS, {includeTags: true});
            const powerByKey = new Map();
            for (const m of curSnap.meshes) {
              for (const hTag of (m.tags?.additive?.thermal_heater || [])) {
                powerByKey.set(hTag.ownerHash + ':' + hTag.uid, hTag.params.Power);
              }
            }
            const updatedFans = gatherFansForOwner(hash, model.domain);
            // Recompute exact per-cell heater power when any heater wattage animates (handles 0W->NW and multi-heaters!)
            let anyPowerChange = false;
            for (const hs of model.heaterStats) {
              const newW = powerByKey.get(hs.ownerHash + ':' + hs.uid);
              if (newW !== undefined && newW !== hs.authoredW) anyPowerChange = true;
            }
            const newCellPower = anyPowerChange ? new Float32Array(model.domain.count) : null;
            if (anyPowerChange) {
              let sumP = 0, sumN = 0;
              for (const hs of model.heaterStats) {
                const newW = powerByKey.get(hs.ownerHash + ':' + hs.uid) ?? hs.authoredW;
                hs.authoredW = newW;
                hs.appliedW = newW * hs.frac;
                const perCell = hs.cells > 0 ? hs.appliedW / hs.cells : 0;
                const occ = hs.occupancy;
                for (let i = 0; i < model.domain.count; i++) {
                  if (((occ[i >> 5] >>> (i & 31)) & 1) && model.cellType[i] === CELL_TYPE.SOLID) {
                    newCellPower[i] += perCell;
                  }
                }
                if (hs.appliedW >= 0) sumP += hs.appliedW; else sumN += hs.appliedW;
              }
              model.cellPowerW.set(newCellPower);
              model.stats.positiveHeaterW = sumP;
              model.stats.negativeHeaterW = sumN;
              model.stats.totalHeaterPowerW = sumP + sumN;
            }
            solver.updateDynamicSources({
              ambientC: curAmb,
              cellPowerW: anyPowerChange ? newCellPower : null,
              fans: updatedFans.length === model.fans.length ? updatedFans : null
            });
            model.ambientC = curAmb;
          }

          // Advance fluid + implicit backward-Euler energy step
          if (hasFluid) {
            const dtF = clamp(Math.min(frameDt, dMin / 3.0), 0.002, 0.05);
            await solver.stepFluid(dtF, 2, 12);
          }
          await solver.solveLinearEnergy({invDt: 1 / frameDt, tolerance, maxIterations, checkCurrent});
          solver.commitTransientStep();

          const storeSnap = (stepNum % snapStride === 0) || (f === lastFrame);
          const fields = await solver.readFields(hasFluid && storeSnap);
          lastEv = evaluateThermalFields(model, fields.theta, fields.vel, cap.probes, model.ambientC);
          recordArchiveFrame(hash, f, lastEv, storeSnap);
          if (stepNum % 3 === 0) await new Promise(r => setTimeout(r, 0));
        }

        const st = states.get(hash);
        destroyStateGPU(st);
        Object.assign(st, {
          device: cap.device, model: cap.model, probes: cap.probes,
          signature: thermalSignature(hash), frame: lastFrame,
          participatingHashes: cap.participatingHashes,
          participatingMeshes: cap.participatingMeshes,
          eval: lastEv, mode: st.mode === 'Voxels' || !st.mode ? 'Temp' : st.mode
        });
        rebuildVisualBuffers(hash);
        return {
          state: 'solved', kind: 'transient',
          firstFrame, lastFrame, frames: a.frames.size,
          elapsedSeconds: (lastFrame - firstFrame) * frameDt,
          maxTempC: lastEv.maxSolidTempC, minTempC: lastEv.minSolidTempC,
          heatInW: lastEv.heatInW, heatOutW: lastEv.heatOutW,
          maxFlowMs: lastEv.maxFlowMs, probes: lastEv.probes
        };
      } finally {
        if (solver) await solver.dispose();
        if (D.frame !== initialFrame) {
          try { await context.animation.seek(initialFrame, D.frame); } catch {}
        }
      }
    });
  }

  // ---------- Playback / Timeline Scrubbing Restoration ----------

  function applyArchivedFrame(hash, frame) {
    const st = states.get(hash), a = archives.get(hash);
    if (!st?.model || !a?.fields.size) return;
    if (st.frame === frame) return;
    let snap = a.fields.get(frame);
    if (!snap) {
      // Pick nearest archived snapshot
      let bestF = null, bestD = Infinity;
      for (const f of a.fields.keys()) {
        const d = Math.abs(f - frame);
        if (d < bestD) { bestD = d; bestF = f; }
      }
      if (bestF === null) return;
      snap = a.fields.get(bestF);
    }
    st.frame = frame;
    st.eval = evaluateThermalFields(st.model, snap.theta, snap.vel, st.probes || [], snap.ambientC);
    rebuildVisualBuffers(hash);
    refresh();
  }

  // ---------- Status & Measurement ----------

  function statusOf(hash) {
    const n = findAny(hash);
    const ownerHash = n.type === 'thermal' ? hash : n.params.Thermal;
    const st = ownerHash ? states.get(ownerHash) : null;
    const a = ownerHash ? archives.get(ownerHash) : null;
    const sl = ownerHash ? getSlice(ownerHash) : {axis: 'Off', position: 50};
    if (n.type === 'thermal_probe') {
      const reading = st?.eval?.probes?.find(p => p.hash === hash) || null;
      return {
        stage: 'ready', state: st?.job?.state || 'idle', type: n.type, ownerHash,
        authoringOnly: false, numericalAvailable: true, measurementAvailable: !!reading,
        temperatureC: reading?.tempC ?? null,
        flowMs: reading?.flowMs ?? null,
        fluxWPerM2: reading?.fluxWPerM2 ?? null,
        region: reading?.region ?? null,
        inside: reading?.inside ?? null
      };
    }
    if (n.type === 'thermal_fan') {
      const meta = nativeFanMetadata(context, n);
      return {
        stage: 'ready', state: st?.job?.state || 'idle', type: n.type, ownerHash,
        authoringOnly: false, numericalAvailable: true,
        solverEligible: !!meta.mapping.solverEligible,
        fan: meta
      };
    }
    return {
      stage: 'ready',
      state: st?.job?.state || 'idle',
      type: n.type,
      authoringOnly: false,
      numericalAvailable: true,
      measurementAvailable: !!st?.eval,
      autoSize: !!n.params['Auto size'],
      voxelSizeMm: n.params['Voxel size'],
      medium: n.params.Medium,
      ambientC: n.params.Ambient,
      initialC: n.params.Initial,
      timeScale: n.params['Time scale'],
      displayMode: st?.mode || null,
      slice: {...sl},
      voxelsAvailable: !!st?.model,
      resultAvailable: !!st?.eval,
      job: st?.job ? {id: st.job.id, kind: st.job.kind, state: st.job.state, progress: st.job.progress, error: st.job.error} : null,
      error: st?.error || null,
      grid: st?.model?.domain.cells || null,
      stats: st?.model?.stats || null,
      result: st?.eval ? {
        frame: st.frame,
        maxTempC: st.eval.maxSolidTempC,
        minTempC: st.eval.minSolidTempC,
        maxAllTempC: st.eval.maxAllTempC,
        minAllTempC: st.eval.minAllTempC,
        maxFluxWPerM2: st.eval.maxFluxWPerM2,
        maxFlowMs: st.eval.maxFlowMs,
        heatInW: st.eval.heatInW,
        heatOutW: st.eval.heatOutW,
        radiatedOutW: st.eval.radiatedOutW,
        convectedOutW: st.eval.convectedOutW,
        probes: st.eval.probes,
        iterations: st.iterations ?? null,
        outerIterations: st.outerIterations ?? null,
        residualK: st.residualK ?? null
      } : null,
      archivedFrames: a ? a.frames.size : 0
    };
  }

  function measureOf(hash) {
    const n = findAny(hash);
    if (n.type === 'thermal_probe') {
      const ownerHash = n.params.Thermal;
      const st = ownerHash ? states.get(ownerHash) : null;
      if (!st?.eval) throw fail('NO_RESULT', 'Run Steady or Animation on the Thermal owner before measuring.');
      const w = Array.from(D.world(hash)).slice(12, 15);
      return samplePointReading(st.model, st.eval.tempsC, st.eval.fluxWPerM2, st.eval.vel, w, {hash, name: n.name});
    }
    owner(hash);
    const st = states.get(hash);
    if (!st?.eval) throw fail('NO_RESULT', 'Run Steady or Animation before measuring.');
    const probes = gatherProbesForOwner(hash).map(p => samplePointReading(st.model, st.eval.tempsC, st.eval.fluxWPerM2, st.eval.vel, p.worldMm, p));
    return {
      frame: st.frame,
      maxTempC: st.eval.maxSolidTempC, minTempC: st.eval.minSolidTempC,
      heatInW: st.eval.heatInW, heatOutW: st.eval.heatOutW,
      maxFlowMs: st.eval.maxFlowMs, probes
    };
  }

  // ---------- Cursor Surface Probe ----------

  function surfaceProbe(hash, hit) {
    const st = states.get(hash);
    if (!hit) return !!st?.model;
    if (!st?.model) return null;
    const d = st.model.domain, [nx, ny, nz] = d.cells;
    const g = worldMmToGrid(d, hit.point);
    const ix = Math.floor(g[0]), iy = Math.floor(g[1]), iz = Math.floor(g[2]);
    if (ix < -1 || ix > nx || iy < -1 || iy > ny || iz < -1 || iz > nz) return null;
    const cellIdx = (x, y, z) => x + nx * (y + ny * z);
    // Find nearest solid cell on surface hit (within 1-ring)
    let bestC = -1, bestDist = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      if (cx < 0 || cx >= nx || cy < 0 || cy >= ny || cz < 0 || cz >= nz) continue;
      const cand = cellIdx(cx, cy, cz);
      if (st.model.cellType[cand] < CELL_TYPE.SOLID) continue;
      const dist = Math.hypot(g[0] - (cx + 0.5), g[1] - (cy + 0.5), g[2] - (cz + 0.5));
      if (dist < bestDist) { bestDist = dist; bestC = cand; }
    }
    if (bestC < 0 || bestDist > 1.75) return null;
    const mat = st.model.cellMatIdx[bestC] >= 0 ? st.model.materials[st.model.cellMatIdx[bestC]] : null;
    const matName = mat?.name || DEFAULT_MATERIAL_NAME;
    if (st.mode === 'Voxels' || !st.eval) {
      const role = ROLE_LABELS[st.model.cellRole[bestC]] || matName;
      return {text: `${matName} · ${role}`};
    }
    const r = samplePointReading(st.model, st.eval.tempsC, st.eval.fluxWPerM2, st.eval.vel, hit.point);
    const tVal = r.inside && r.isSolid ? r.tempC : st.eval.tempsC[bestC];
    const qVal = (r.inside && r.isSolid ? r.fluxWPerM2 : st.eval.fluxWPerM2[bestC]) || 0;
    const qStr = qVal >= 1000 ? `${fmtNum(qVal * 1e-3)} kW/m²` : `${fmtNum(qVal)} W/m²`;
    return {text: `${fmtNum(tVal)} °C · ${matName} · ${qStr}`};
  }

  // ---------- Operations Registry ----------

  const createHelper = type => async hash => {
    owner(hash);
    let n;
    D.transaction(() => {
      n = D.create(type, hash, type === 'thermal_fan' ? 'Fan' : 'Probe');
      n.params.Thermal = hash;
      D.select(n.nativeHash, 'objects');
    });
    await context.editor.selectOwner(n.nativeHash);
    return {hash: n.nativeHash, type: n.type};
  };

  const setMapMode = mode => hash => {
    owner(hash);
    const st = states.get(hash);
    if (!st?.model) throw fail('NO_RESULT', 'Run Show Voxels, Steady or Animation first.');
    if (mode !== 'Voxels' && !st.eval) throw fail('NO_RESULT', 'Run Steady or Animation first.');
    if (mode === 'Flow' && st.model.medium.isVacuum) throw fail('VACUUM_NO_FLOW', 'Airflow is unavailable in Vacuum.');
    st.mode = mode;
    rebuildVisualBuffers(hash);
    refresh();
    return {mode};
  };

  const setSlice = (hash, {axis, position} = {}) => {
    owner(hash);
    const sl = getSlice(hash);
    if (axis !== undefined) {
      if (!['Off', 'X', 'Y', 'Z'].includes(axis)) throw fail('INVALID_ARGUMENT', 'Slice axis must be Off, X, Y or Z.');
      sl.axis = axis;
    }
    if (position !== undefined) {
      if (!Number.isFinite(position) || position < 0 || position > 100) throw fail('INVALID_ARGUMENT', 'Slice position must be in [0, 100].');
      sl.position = position;
    }
    updateDomainUniforms(hash);
    refresh();
    return {...sl};
  };

  context.operations.register([
    {id: 'status', description: 'Inspect Thermal domain, grid stats, temperatures, energy balance, fans and probes.', inputSchema: emptySchema, readOnly: true, run: statusOf},
    {id: 'show-voxels', description: 'Voxelize Thermal materials, heaters, fixed temperatures and fans and display voxel roles.', inputSchema: emptySchema, readOnly: false, run: runShowVoxels},
    {id: 'solve-steady', description: 'Run coupled GPU conjugate heat transfer steady-state solver (conduction, fluid buoyancy/fan flow and surface radiation).', inputSchema: {type: 'object', properties: {tolerance: {type: 'number', minimum: 1e-7, maximum: 1e-2}, maxIterations: {type: 'integer', minimum: 10, maximum: 5000}, maxOuterIterations: {type: 'integer', minimum: 1, maximum: 40}}, additionalProperties: false}, readOnly: false, run: runSolveSteady},
    {id: 'solve-animation', description: 'Run GPU transient thermal simulation across the timeline using Time scale and record Curves history.', inputSchema: {type: 'object', properties: {firstFrame: {type: 'integer', minimum: 0}, lastFrame: {type: 'integer', minimum: 0}, tolerance: {type: 'number', minimum: 1e-7, maximum: 1e-2}, maxIterations: {type: 'integer', minimum: 10, maximum: 5000}}, additionalProperties: false}, readOnly: false, run: runSolveAnimation},
    {id: 'stop', description: 'Cancel any active Thermal calculation.', inputSchema: emptySchema, readOnly: false, run: hash => { owner(hash); cancelJob(hash); return statusOf(hash); }},
    {id: 'create-fan', description: 'Create a 10×40×40 mm native Fan helper pointing +X linked to this Thermal owner.', inputSchema: emptySchema, readOnly: false, run: createHelper('thermal_fan')},
    {id: 'create-probe', description: 'Create a 2 mm native Probe helper at the owner origin linked to this Thermal owner.', inputSchema: emptySchema, readOnly: false, run: createHelper('thermal_probe')},
    {id: 'fan-inputs', description: 'Inspect native Fan parameters, arbitrary 3D world axis and solver eligibility.', inputSchema: emptySchema, readOnly: true, run: hash => inspectNativeFans(context, hash)},
    {id: 'measure', description: 'Read temperature, heat flux and airflow speed at a Probe or all Probes on a Thermal owner.', inputSchema: emptySchema, readOnly: true, run: measureOf},
    {id: 'slice', description: 'Configure interactive fluid/solid Slice plane axis (Off/X/Y/Z) and position (0..100%).', inputSchema: {type: 'object', properties: {axis: {type: 'string', enum: ['Off', 'X', 'Y', 'Z']}, position: {type: 'number', minimum: 0, maximum: 100}}, additionalProperties: false}, readOnly: false, run: setSlice},
    ...['Temp', 'Flux', 'Flow', 'Voxels'].map(mode => ({
      id: 'map-' + mode.toLowerCase(),
      description: 'Switch Thermal Attributes display map to ' + mode + '.',
      inputSchema: emptySchema, readOnly: false, run: setMapMode(mode)
    })),
    ...['Off', 'X', 'Y', 'Z'].map(axis => ({
      id: 'slice-' + axis.toLowerCase(),
      description: 'Set Thermal Slice plane to ' + axis + '.',
      inputSchema: emptySchema, readOnly: false, run: hash => setSlice(hash, {axis})
    }))
  ]);

  // ---------- Editor Hooks & Attributes ----------

  function syncLiveOwners() {
    const live = new Set(D.nodes.filter(n => n.type === 'thermal').map(n => n.nativeHash));
    for (const hash of [...states.keys()]) if (!live.has(hash)) retireOwner(hash);
    for (const hash of live) {
      const st = states.get(hash);
      const busy = st?.job && ['queued', 'solving'].includes(st.job.state);
      if (st?.model && !busy && st.signature) {
        try {
          if (thermalSignature(hash) !== st.signature) {
            destroyStateGPU(st);
            st.model = null; st.eval = null; st.participatingMeshes = null; st.participatingHashes = null;
            updateSurfaceFilter(hash);
          }
        } catch {}
      }
    }
  }

  context.editor.register({
    created: n => {
      if (n.type === 'thermal_probe') {
        n.creationFrame = Array.from(PROBE_CREATION_FRAME);
      } else if (n.type === 'thermal_fan') {
        n.creationFrame = Array.from(FAN_CREATION_FRAME);
      }
    },
    documentChanged: () => { syncLiveOwners(); refresh(); },
    frames: () => {
      for (const hash of states.keys()) {
        const st = states.get(hash);
        if (st?.model && archives.get(hash)?.fields.size && !(st.job && st.job.state === 'solving')) {
          applyArchivedFrame(hash, D.frame);
        }
      }
    },
    parameters: (n, changes) => {
      if (n.type === 'thermal_fan') { validateFanParameters(D, {...n.params, ...changes}); return {}; }
      if (n.type === 'thermal_probe') {
        const value = changes.Thermal ?? n.params.Thermal;
        if (typeof value !== 'string' || (value && !D.nodes.some(q => q.nativeHash === value && q.type === 'thermal')))
          throw fail('INVALID_ARGUMENT', 'Select a Thermal object.');
        return {};
      }
      if (n.type !== 'thermal') return null;
      validateThermalParameters({...n.params, ...changes});
      return {};
    },
    rowColor: n => {
      if (n.type === 'thermal' && (states.get(n.nativeHash)?.job?.state === 'failed' || states.get(n.nativeHash)?.error)) return '#ee554b';
      if (n.type === 'thermal_fan' && n.params.Thermal && !D.nodes.some(q => q.nativeHash === n.params.Thermal && q.type === 'thermal')) return '#ee554b';
      if (n.type === 'thermal_probe' && n.params.Thermal && !D.nodes.some(q => q.nativeHash === n.params.Thermal && q.type === 'thermal')) return '#ee554b';
      return null;
    },
    surfaceFilter: meshHash => {
      for (const entry of filterCache.values()) {
        if (entry.hashes?.has(meshHash)) return entry;
      }
      return null;
    },
    bounds: hash => {
      const n = D.nodes.find(x => x.nativeHash === hash && x.type === 'thermal');
      if (!n) return null;
      if (n.params['Auto size']) {
        const st = states.get(hash);
        if (!st?.model) return false;
        const d = st.model.domain, inv = context.math.inv(D.world(hash));
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < 8; k++) {
          const pW = gridPointToWorldMm(d, k & 1 ? d.cells[0] : 0, k & 2 ? d.cells[1] : 0, k & 4 ? d.cells[2] : 0);
          const pL = context.math.point(inv, pW);
          for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pL[a]); max[a] = Math.max(max[a], pL[a]); }
        }
        return {min, max};
      }
      return null;
    }
  });

  context.attributes.register(hash => {
    const n = findAny(hash);
    if (n.type === 'thermal_probe') {
      const ownerHash = n.params.Thermal;
      const st = ownerHash ? states.get(ownerHash) : null;
      const reading = st?.eval ? samplePointReading(st.model, st.eval.tempsC, st.eval.fluxWPerM2, st.eval.vel, Array.from(D.world(hash)).slice(12, 15)) : null;
      return {
        hiddenFields: ['Thermal'],
        readouts: [
          {id: 'probe-temp', label: 'Temperature (°C)', columns: [''], values: reading?.inside ? [fmtNum(reading.tempC)] : null, series: ownerHash ? () => readoutSeries(ownerHash, 'tempC', `${n.name} Temp`, '°C', hash) : null},
          {id: 'probe-flow', label: 'Flow (m/s)', columns: [''], values: reading?.inside && reading.flowMs !== null ? [fmtNum(reading.flowMs)] : null, series: ownerHash ? () => readoutSeries(ownerHash, 'flowMs', `${n.name} Flow`, 'm/s', hash) : null},
          {id: 'probe-region', label: 'Region', columns: [''], values: reading ? [reading.region] : null}
        ]
      };
    }
    if (n.type === 'thermal_fan') {
      return {
        hiddenFields: ['Thermal', 'Direction'],
        labels: {'Shutoff pressure': 'Pressure'},
        units: {'Shutoff pressure': 'Pa', 'Free flow': 'm³/s'},
        ranges: {'Shutoff pressure': {min: 0}, 'Free flow': {min: 1e-6}}
      };
    }

    const st = states.get(hash), job = st?.job;
    const busy = job && ['queued', 'solving'].includes(job.state);
    const errText = job?.state === 'failed'
      ? (job.error?.code === 'GRID_CAPACITY' ? 'Grid too dense' : job.error?.code === 'SHEARED_DOMAIN' ? 'Sheared box' : job.error?.code === 'NO_THERMAL_GEOMETRY' ? 'No geometry' : 'Failed')
      : '';
    const hasModel = !!st?.model, hasEval = !!st?.eval;
    const isVac = (n.params.Medium || 'Air') === 'Vacuum';
    const sl = getSlice(hash);

    return {
      units: {Ambient: '°C', Initial: '°C', 'Voxel size': 'mm', 'Time scale': 's/s'},
      actions: [
        {id: 'show-voxels',     row: 'Grid',    label: 'Show Voxels', cancel: 'stop', busy: busy && job.kind === 'show-voxels',     disabled: busy && job.kind !== 'show-voxels',     progress: job?.kind === 'show-voxels' ? (busy ? job.progress : errText) : ''},
        {id: 'solve-steady',    row: 'Solve',   label: 'Steady',      cancel: 'stop', busy: busy && job.kind === 'solve-steady',    disabled: busy && job.kind !== 'solve-steady',    progress: job?.kind === 'solve-steady' ? (busy ? job.progress : errText) : ''},
        {id: 'solve-animation', row: 'Solve',   label: 'Animation',   cancel: 'stop', busy: busy && job.kind === 'solve-animation', disabled: busy && job.kind !== 'solve-animation', progress: job?.kind === 'solve-animation' ? (busy ? job.progress : errText) : ''},
        {id: 'create-fan',      row: 'Add',     label: 'Fan',         disabled: busy},
        {id: 'create-probe',    row: 'Add',     label: 'Probe',       disabled: busy},
        {id: 'map-temp',        row: 'Display', label: 'Temp',        hidden: !hasEval,            active: hasEval && st.mode === 'Temp'},
        {id: 'map-flux',        row: 'Display', label: 'Flux',        hidden: !hasEval,            active: hasEval && st.mode === 'Flux'},
        {id: 'map-flow',        row: 'Display', label: 'Flow',        hidden: !hasEval || isVac,   active: hasEval && st.mode === 'Flow'},
        {id: 'map-voxels',      row: 'Display', label: 'Voxels',      hidden: !hasModel,           active: hasModel && st.mode === 'Voxels'},
        {id: 'slice-off',       row: 'Slice',   label: 'Off',         hidden: !hasEval,            active: hasEval && sl.axis === 'Off'},
        {id: 'slice-x',         row: 'Slice',   label: 'X',           hidden: !hasEval,            active: hasEval && sl.axis === 'X'},
        {id: 'slice-y',         row: 'Slice',   label: 'Y',           hidden: !hasEval,            active: hasEval && sl.axis === 'Y'},
        {id: 'slice-z',         row: 'Slice',   label: 'Z',           hidden: !hasEval,            active: hasEval && sl.axis === 'Z'}
      ],
      numbers: [
        {id: 'slice-pos', label: 'Slice (%)', visible: hasEval && sl.axis !== 'Off', value: sl.position, min: 0, max: 100, set: v => { sl.position = clamp(v, 0, 100); updateDomainUniforms(hash); context.requestDraw?.(); }}
      ],
      readouts: [
        {id: 'max-temp',  label: 'Max temp (°C)', columns: [''], values: hasEval ? [fmtNum(st.eval.maxSolidTempC)] : null, series: () => readoutSeries(hash, 'maxTempC', 'Max temp', '°C')},
        {id: 'min-temp',  label: 'Min temp (°C)', columns: [''], values: hasEval ? [fmtNum(st.eval.minSolidTempC)] : null, series: () => readoutSeries(hash, 'minTempC', 'Min temp', '°C')},
        {id: 'heat-in',   label: 'Heat in (W)',   columns: [''], values: hasEval ? [fmtNum(st.eval.heatInW)] : null,       series: () => readoutSeries(hash, 'heatInW', 'Heat in', 'W')},
        {id: 'heat-out',  label: 'Heat out (W)',  columns: [''], values: hasEval ? [fmtNum(st.eval.heatOutW)] : null,      series: () => readoutSeries(hash, 'heatOutW', 'Heat out', 'W')},
        {id: 'max-flow',  label: 'Max flow (m/s)',columns: [''], values: hasEval && !isVac ? [fmtNum(st.eval.maxFlowMs)] : null, series: () => readoutSeries(hash, 'maxFlowMs', 'Max flow', 'm/s')},
        {id: 'grid',      label: 'Grid',          columns: [''], values: hasModel ? [`${st.model.domain.cells.join('×')} (${st.model.stats.solidCount})`] : null}
      ]
    };
  });

  // ---------- Viewport Registration (Custom Per-Type Helpers + Smooth 3D Thermal Shader + Slice + Airflow) ----------

  const boxLines = makeBoxLines();
  const fanLines = makeFanLines();
  const probeLines = makeProbeLines();
  const unitBounds = {min: [-50, -50, -50], max: [50, 50, 50]};

  await context.viewport.register({
    retire: retireOwner,
    renderKind: 'overlay',
    renderStage: 'opaque',
    surfaceWarnings: false,
    surfaceOrder: 'selected-smallest',
    showHelper: (hash, params) => {
      const n = D.nodes.find(x => x.nativeHash === hash);
      if (n?.type === 'thermal') return !params['Auto size'];
      return true;
    },
    surfaceProbe,
    render: ({pass, camera, orthographic, hash, device, format}) => {
      const n = D.nodes.find(x => x.nativeHash === hash);
      if (n?.type !== 'thermal') return;
      const st = states.get(hash);
      if (!st?.model || st.device !== device) return;
      const pipes = ensureRenderPipelines(device, format);
      if (!pipes) return;
      const oIdx = orthographic ? 1 : 0;

      let camGroup = renderState.camGroups.get(camera);
      if (!camGroup) {
        camGroup = device.createBindGroup({layout: renderState.camLayout, entries: [{binding: 0, resource: {buffer: camera}}]});
        renderState.camGroups.set(camera, camGroup);
      }

      // 1) Solid display: Smooth mesh via 3D RGBA16Float texture (Temp / Flux) OR Voxel shell (Voxels)
      if ((st.mode === 'Temp' || st.mode === 'Flux') && st.eval && st.solidTex && st.domUniformBuf && st.meshEntries?.length) {
        if (!st.solidFieldBG) {
          st.solidFieldBG = device.createBindGroup({
            layout: renderState.fieldLayout,
            entries: [
              {binding: 0, resource: st.solidTex.createView()},
              {binding: 1, resource: renderState.sampler},
              {binding: 2, resource: {buffer: st.domUniformBuf}}
            ]
          });
        }
        const liveMeshes = context.core?.engine?.scene?.meshes || null;
        let drewSmooth = false;
        for (const me of st.meshEntries) {
          if (me.triangleCount <= 0) continue;
          if (liveMeshes && !liveMeshes.some(lm => lm.positions === me.positions && lm.indices === me.indices)) continue;
          const isTex = me.storage === 'texture';
          if (!me.bindGroup) {
            me.bindGroup = device.createBindGroup({
              layout: isTex ? renderState.meshLayoutTex : renderState.meshLayoutBuf,
              entries: [
                {binding: 0, resource: {buffer: me.uniformBuf}},
                {binding: 1, resource: isTex ? me.positions.createView() : {buffer: me.positions}},
                {binding: 2, resource: isTex ? me.indices.createView() : {buffer: me.indices}}
              ]
            });
          }
          pass.setPipeline(isTex ? pipes.surfTex[oIdx] : pipes.surfBuf[oIdx]);
          pass.setBindGroup(0, camGroup);
          pass.setBindGroup(1, st.solidFieldBG);
          pass.setBindGroup(2, me.bindGroup);
          pass.draw(me.triangleCount * 3);
          drewSmooth = true;
        }
        if (!drewSmooth && st.voxelBuf && st.voxelVerts > 0) {
          pass.setPipeline(pipes.display[oIdx]);
          pass.setBindGroup(0, camGroup);
          pass.setVertexBuffer(0, st.voxelBuf);
          pass.draw(st.voxelVerts);
        }
      } else if (st.mode === 'Voxels' && st.voxelBuf && st.voxelVerts > 0) {
        pass.setPipeline(pipes.display[oIdx]);
        pass.setBindGroup(0, camGroup);
        pass.setVertexBuffer(0, st.voxelBuf);
        pass.draw(st.voxelVerts);
      }

      // 2) 3D Airflow arrows (in Flow mode)
      if (st.mode === 'Flow' && st.flowBuf && st.flowVerts > 0) {
        pass.setPipeline(pipes.display[oIdx]);
        pass.setBindGroup(0, camGroup);
        pass.setVertexBuffer(0, st.flowBuf);
        pass.draw(st.flowVerts);
      }

      // 3) Interactive Air/Solid Slice plane (blended last so solids remain visible behind/through air plume)
      const sl = getSlice(hash);
      if (st.eval && sl.axis !== 'Off' && st.fluidTex && st.sliceUniformBuf) {
        if (!st.fluidFieldBG) {
          st.fluidFieldBG = device.createBindGroup({
            layout: renderState.fieldLayout,
            entries: [
              {binding: 0, resource: st.fluidTex.createView()},
              {binding: 1, resource: renderState.sampler},
              {binding: 2, resource: {buffer: st.sliceUniformBuf}}
            ]
          });
        }
        pass.setPipeline(pipes.slice[oIdx]);
        pass.setBindGroup(0, camGroup);
        pass.setBindGroup(1, st.fluidFieldBG);
        pass.draw(6);
      }
    },
    bounds: unitBounds,
    lines: boxLines,
    helpers: {
      thermal_fan: {bounds: {min: [-50, -50, -50], max: [110, 50, 50]}, lines: fanLines},
      thermal_probe: {bounds: unitBounds, lines: probeLines}
    },
    color: [0.86, 0.61, 0.46, 1],
    selectedColor: [1, 0.75, 0.5, 1],
    settings: () => [0, 0, 0, 0],
    shader: 'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'
  });
}
