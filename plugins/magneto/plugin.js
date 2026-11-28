// Magneto: GPU 3D nonlinear magnetostatics (ferromagnetic saturation, persistent vector
// hysteresis and remagnetizable permanent magnets, 3D conductor current continuity and
// Biot-Savart excitation, Maxwell stress and Lorentz forces/torques, probes, slices and Curves).

export const MU0 = 4 * Math.PI * 1e-7; // H/m
const INV_MU0 = 1 / MU0;
const INV_4PI = 1 / (4 * Math.PI);
const MM_TO_M = 0.001, M_TO_MM = 1000;
const MAX_CELLS = 262144;
const MAX_ARCHIVE_FIELD_BYTES = 64 * 1024 * 1024;
export const PROBE_CREATION_FRAME = Object.freeze([0.02, 0, 0, 0, 0.02, 0, 0, 0, 0.02, 0, 0, 0]);

export const MATERIALS = Object.freeze({
  // Soft nonlinear ferromagnets (Frohlich-Kennelly saturation curves)
  'Electrical Steel M19': Object.freeze({kind: 'soft', muR0: 4000, Bs: 2.05, Br: 0, Hcj: 0, sigma: 0, color: [0.39, 0.43, 0.47]}),
  'Electrical Steel M27': Object.freeze({kind: 'soft', muR0: 3000, Bs: 2.00, Br: 0, Hcj: 0, sigma: 0, color: [0.42, 0.46, 0.50]}),
  'Pure Iron':            Object.freeze({kind: 'soft', muR0: 5000, Bs: 2.15, Br: 0, Hcj: 0, sigma: 0, color: [0.48, 0.49, 0.50]}),
  // Hard permanent magnets (recoil permeability + real vector hysteresis at Hcj)
  'NdFeB N35':            Object.freeze({kind: 'hard', muR0: 1.05, Bs: 1.19, Br: 1.19, Hcj: 955000, sigma: 0, color: [0.62, 0.64, 0.67]}),
  'NdFeB N42':            Object.freeze({kind: 'hard', muR0: 1.05, Bs: 1.30, Br: 1.30, Hcj: 955000, sigma: 0, color: [0.64, 0.66, 0.70]}),
  'NdFeB N52':            Object.freeze({kind: 'hard', muR0: 1.05, Bs: 1.44, Br: 1.44, Hcj: 875000, sigma: 0, color: [0.66, 0.68, 0.73]}),
  'Ferrite Y30':          Object.freeze({kind: 'hard', muR0: 1.08, Bs: 0.39, Br: 0.39, Hcj: 240000, sigma: 0, color: [0.27, 0.28, 0.31]}),
  'Alnico 5':             Object.freeze({kind: 'hard', muR0: 3.50, Bs: 1.25, Br: 1.25, Hcj:  51000, sigma: 0, color: [0.54, 0.53, 0.50]}),
  // Non-magnetic conductors
  'Copper':               Object.freeze({kind: 'conductor', muR0: 1.0, Bs: 0, Br: 0, Hcj: 0, sigma: 5.8e7, color: [0.85, 0.49, 0.34]}),
  'Aluminium':            Object.freeze({kind: 'conductor', muR0: 1.0, Bs: 0, Br: 0, Hcj: 0, sigma: 3.5e7, color: [0.74, 0.78, 0.84]})
});

export const MAGNETIZATION_AXES = Object.freeze({
  '+Z': [0, 0, 1],
  '-Z': [0, 0, -1],
  '+X': [1, 0, 0],
  '-X': [-1, 0, 0],
  '+Y': [0, 1, 0],
  '-Y': [0, -1, 0],
  'Unmagnetized': [0, 0, 0]
});

export const CELL_KIND = Object.freeze({
  AIR: 0,
  SOFT: 1,
  HARD: 2,
  CONDUCTOR: 3
});

const ROLE_LABELS = Object.freeze([
  'Air',
  'Soft Ferromagnet',
  'Permanent Magnet',
  'Conductor'
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

// Exact IEEE-754 float32 -> binary16 (uint16) encoder for RGBA16Float 3D textures.
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
  if (exp >= 31) return sign | 0x7bff;
  return sign | (exp << 10) | ((mant + 0x1000) >>> 13);
}

// ---------- Material Resolution, Constitutive Laws & Vector Hysteresis ----------

export function resolveMaterialProps(tagParams) {
  if (!tagParams) return null;
  const name = tagParams.Material;
  const magAxisName = tagParams.Magnetization || '+Z';
  const axisLocal = MAGNETIZATION_AXES[magAxisName] || [0, 0, 1];
  if (name === 'Custom') {
    const muR0 = Number(tagParams.Permeability);
    const Bs = Number(tagParams.Saturation);
    const Br = Number(tagParams.Remanence);
    const HcjKa = Number(tagParams.Coercivity);
    const sigmaMS = Number(tagParams.Conductivity);
    if (!Number.isFinite(muR0) || muR0 < 1) throw fail('INVALID_MATERIAL', 'Custom Permeability must be >= 1.');
    if (!Number.isFinite(Bs) || Bs < 0) throw fail('INVALID_MATERIAL', 'Custom Saturation must be >= 0 T.');
    if (!Number.isFinite(Br) || Br < 0) throw fail('INVALID_MATERIAL', 'Custom Remanence must be >= 0 T.');
    if (!Number.isFinite(HcjKa) || HcjKa < 0) throw fail('INVALID_MATERIAL', 'Custom Coercivity must be >= 0 kA/m.');
    if (!Number.isFinite(sigmaMS) || sigmaMS < 0) throw fail('INVALID_MATERIAL', 'Custom Conductivity must be >= 0 MS/m.');
    const Hcj = HcjKa * 1000;
    const sigma = sigmaMS * 1e6;
    let kind = 'conductor';
    if (Br > 0 && Hcj > 0) kind = 'hard';
    else if (muR0 > 1.0001 && (Bs > 0 || Br === 0)) kind = 'soft';
    else if (Br > 0) kind = 'hard';
    const satBs = kind === 'hard' ? Math.max(Bs, Br) : Bs;
    const Ms = (kind === 'hard' ? Br : satBs) * INV_MU0;
    const color = kind === 'hard' ? [0.64, 0.58, 0.72] : kind === 'soft' ? [0.46, 0.50, 0.56] : [0.76, 0.62, 0.44];
    return {
      name: 'Custom', custom: true, kind,
      muR0: kind === 'hard' ? Math.max(1, Math.min(muR0, 50)) : muR0,
      Bs: satBs, Br, Hcj, Ms, sigma,
      magnetization: magAxisName, axisLocal, color
    };
  }
  const base = MATERIALS[name];
  if (!base) throw fail('INVALID_MATERIAL', `Unknown Magneto material: ${name}`);
  const Ms = (base.kind === 'hard' ? base.Br : base.Bs) * INV_MU0;
  return {
    name, custom: false, ...base, Ms,
    magnetization: base.kind === 'hard' ? magAxisName : 'Unmagnetized',
    axisLocal: base.kind === 'hard' ? axisLocal : [0, 0, 0]
  };
}

// Soft ferromagnet Frohlich-Kennelly permeability: exact muR0 at H=0, exact saturation Ms as H->inf.
export function softMuR(Hmag, muR0, Ms) {
  const chi0 = Math.max(0, muR0 - 1);
  if (chi0 <= 1e-9) return 1.0;
  if (!(Ms > 1e-6)) return muR0;
  return 1.0 + chi0 / (1.0 + (chi0 * Math.max(0, Hmag)) / Ms);
}

// Smooth vector hysteresis switching fraction s(u) on u = |H| / Hcj.
// Exact deadband below 0.65*Hcj (zero drift on standalone magnets including corners),
// exact 0.5 at u = 1.0 (intrinsic coercivity H = -Hcj crosses Mr = 0!),
// full switching s = 1.0 at u >= 1.35 (complete remagnetization / pulse saturation).
export function hysteresisSwitch(Hmag, Hcj) {
  if (!(Hcj > 1e-6) || !(Hmag > 0)) return 0;
  const u = Hmag / Hcj;
  if (u <= 0.65) return 0;
  if (u >= 1.35) return 1;
  const t = (u - 0.65) / 0.70;
  return t * t * (3 - 2 * t);
}

// Vector hysteresis operator anchored to frame-start committed remanence MrBase.
// Zero iteration drift during nonlinear fixed-point loop; commits MrNew at frame end.
export function evaluateHysteresisMr(MrBase, Hvec, Ms, Hcj) {
  if (!(Ms > 1e-6) || !(Hcj > 1e-6)) return [MrBase[0], MrBase[1], MrBase[2]];
  const Hmag = Math.hypot(Hvec[0], Hvec[1], Hvec[2]);
  const s = hysteresisSwitch(Hmag, Hcj);
  if (s <= 0 || Hmag <= 1e-12) return [MrBase[0], MrBase[1], MrBase[2]];
  const invH = 1 / Hmag;
  const tx = Ms * Hvec[0] * invH;
  const ty = Ms * Hvec[1] * invH;
  const tz = Ms * Hvec[2] * invH;
  const mx = (1 - s) * MrBase[0] + s * tx;
  const my = (1 - s) * MrBase[1] + s * ty;
  const mz = (1 - s) * MrBase[2] + s * tz;
  const mm = Math.hypot(mx, my, mz);
  if (mm > Ms) {
    const k = Ms / mm;
    return [mx * k, my * k, mz * k];
  }
  return [mx, my, mz];
}

export function validateMagnetoParameters(params) {
  if (typeof params['Auto size'] !== 'boolean') throw fail('INVALID_ARGUMENT', 'Auto size must be boolean.');
  const vs = params['Voxel size'];
  if (!Number.isFinite(vs) || vs <= 0) throw fail('INVALID_ARGUMENT', 'Voxel size must be positive.');
  return params;
}

export function validateCurrentParameters(D, params) {
  if (typeof params.Magneto !== 'string' || (params.Magneto && !D.nodes.some(q => q.nativeHash === params.Magneto && q.type === 'magneto')))
    throw fail('INVALID_ARGUMENT', 'Select a Magneto object.');
  const J = params['Current Density'];
  if (!Number.isFinite(J)) throw fail('INVALID_ARGUMENT', 'Current Density must be finite.');
  return params;
}

// ---------- Domain & Coordinate Transforms ----------

function isAffine(m) {
  return m && m.length === 16 && m.every(Number.isFinite) &&
    Math.abs(m[3]) < 1e-6 && Math.abs(m[7]) < 1e-6 && Math.abs(m[11]) < 1e-6 && Math.abs(m[15] - 1) < 1e-6;
}

// Extract orthonormal rotation matrix (3x3 column-major) from world affine matrix via polar/QR.
export function extractRotationBasis(worldMat) {
  const c0 = [worldMat[0], worldMat[1], worldMat[2]];
  const c1 = [worldMat[4], worldMat[5], worldMat[6]];
  const c2 = [worldMat[8], worldMat[9], worldMat[10]];
  const l0 = len3(c0) || 1;
  const e0 = scale3(c0, 1 / l0);
  const p1 = sub3(c1, scale3(e0, dot3(c1, e0)));
  const l1 = len3(p1) || 1;
  const e1 = scale3(p1, 1 / l1);
  let e2 = cross3(e0, e1);
  const detSign = dot3(c2, e2) < 0 ? -1 : 1;
  e2 = scale3(e2, detSign);
  return [e0, e1, e2];
}

export function computeManualDomain(worldMatrix, voxelSizeMm, maxCells = MAX_CELLS) {
  const pitchM = voxelSizeMm * MM_TO_M;
  if (!(pitchM > 0) || !Number.isFinite(pitchM)) throw fail('INVALID_ARGUMENT', 'Voxel size must be positive.');
  if (!isAffine(worldMatrix)) throw fail('INVALID_ARGUMENT', 'Magneto frame must be affine.');
  const cols = [0, 4, 8].map(i => [worldMatrix[i], worldMatrix[i+1], worldMatrix[i+2]]);
  const scales = cols.map(len3);
  if (scales.some(s => !(s > 0) || !Number.isFinite(s))) throw fail('DEGENERATE_DOMAIN', 'Magneto box has zero or non-finite extent.');
  const basis = cols.map((c, i) => scale3(c, 1 / scales[i]));
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++)
    if (Math.abs(dot3(basis[a], basis[b])) > 1e-6) throw fail('SHEARED_DOMAIN', 'Sheared Magneto frames are unsupported.');
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
  return {
    autoSize: false, reflected, cells, count, spacingM, lengthsM, originWorldM, basis,
    voxelSizeMm, pitchM
  };
}

export function computeAutoDomain(worldBoundsMm, voxelSizeMm, maxCells = MAX_CELLS) {
  const pitchM = voxelSizeMm * MM_TO_M;
  if (!(pitchM > 0) || !Number.isFinite(pitchM)) throw fail('INVALID_ARGUMENT', 'Voxel size must be positive.');
  if (!worldBoundsMm) throw fail('NO_MAGNETO_GEOMETRY', 'Tag geometry with Magneto inside the scene for Auto size.');
  const spanMm = [0, 1, 2].map(k => Math.max(voxelSizeMm, worldBoundsMm.max[k] - worldBoundsMm.min[k]));
  const maxSpan = Math.max(...spanMm);
  // Magnetic fields extend into surrounding air; try generous symmetric air padding first, then step down to fit budget.
  const padScales = [1.0, 0.65, 0.40, 0.20, 0.08];
  let chosen = null;
  for (const ps of padScales) {
    const pad = ps * Math.max(16, 0.55 * maxSpan, 4 * voxelSizeMm);
    const minMm = [worldBoundsMm.min[0] - pad, worldBoundsMm.min[1] - pad, worldBoundsMm.min[2] - pad];
    const maxMm = [worldBoundsMm.max[0] + pad, worldBoundsMm.max[1] + pad, worldBoundsMm.max[2] + pad];
    const extMm = [0, 1, 2].map(k => Math.max(voxelSizeMm, maxMm[k] - minMm[k]));
    const cells = extMm.map(L => Math.max(3, Math.ceil(L / voxelSizeMm - 1e-9)));
    const count = cells[0] * cells[1] * cells[2];
    if (Number.isSafeInteger(count) && count <= maxCells) {
      const spacingM = [pitchM, pitchM, pitchM];
      const lengthsM = cells.map(n => n * pitchM);
      const centerM = [0, 1, 2].map(k => 0.5 * (minMm[k] + maxMm[k]) * MM_TO_M);
      const originWorldM = [0, 1, 2].map(k => centerM[k] - 0.5 * lengthsM[k]);
      chosen = {
        autoSize: true, reflected: false, cells, count, spacingM, lengthsM, originWorldM,
        basis: [[1,0,0],[0,1,0],[0,0,1]], voxelSizeMm, pitchM
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

function worldVecToGrid(domain, v) {
  const [bx, by, bz] = domain.basis;
  return [dot3(v, bx), dot3(v, by), dot3(v, bz)];
}

function gridVecToWorld(domain, v) {
  const [bx, by, bz] = domain.basis;
  return [
    bx[0]*v[0] + by[0]*v[1] + bz[0]*v[2],
    bx[1]*v[0] + by[1]*v[1] + bz[1]*v[2],
    bx[2]*v[0] + by[2]*v[1] + bz[2]*v[2]
  ];
}

// ---------- GPU Exact Triangle Voxelizer & Signed Volume Integrator (Buffer + Paged Texture) ----------

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
  const scanMod = device.createShaderModule({label: 'Magneto scan', code: SCAN_WGSL});
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
    const mod = device.createShaderModule({label: 'Magneto vox ' + storage, code: voxelizerWGSL(storage)});
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
  const parityBuf = device.createBuffer({label: 'Magneto parity', size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
  const packedBuf = device.createBuffer({label: 'Magneto packed', size: wordCount * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST});
  const readPacked = device.createBuffer({label: 'Magneto packed read', size: wordCount * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  const maxWG = Math.min(65535, Math.max(1, Math.ceil(triCount / 64)));
  const volBuf = device.createBuffer({label: 'Magneto vol', size: maxWG * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC});
  const readVol = device.createBuffer({label: 'Magneto vol read', size: maxWG * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
  const cfgBuf = device.createBuffer({label: 'Magneto vox cfg', size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  const scanCfgBuf = device.createBuffer({label: 'Magneto scan cfg', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});

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

// ---------- Persistent Body-Local Magnetization Store ----------
// Stores Mr in each hard-magnet object's local coordinate frame so rigid rotation/translation
// transports magnetization faithfully, and remagnetization/pulse magnetization persists cleanly.

export function createBodyMagnetizationStore(body, domain, invWorldMm, rotWorldToLocal) {
  const [nx, ny, nz] = domain.cells;
  const occ = body.occupancy;
  const mat = body.material;
  // Measure body-local bounding box from its occupied voxel centers
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = x + nx * (y + ny * z);
    if (!((occ[c >> 5] >>> (c & 31)) & 1)) continue;
    const w = gridPointToWorldMm(domain, x + 0.5, y + 0.5, z + 0.5);
    const lx = invWorldMm[0]*w[0] + invWorldMm[4]*w[1] + invWorldMm[8]*w[2] + invWorldMm[12];
    const ly = invWorldMm[1]*w[0] + invWorldMm[5]*w[1] + invWorldMm[9]*w[2] + invWorldMm[13];
    const lz = invWorldMm[2]*w[0] + invWorldMm[6]*w[1] + invWorldMm[10]*w[2] + invWorldMm[14];
    if (lx < lo[0]) lo[0] = lx; if (lx > hi[0]) hi[0] = lx;
    if (ly < lo[1]) lo[1] = ly; if (ly > hi[1]) hi[1] = ly;
    if (lz < lo[2]) lo[2] = lz; if (lz > hi[2]) hi[2] = lz;
  }
  const pitchLocal = Math.max(0.25, domain.voxelSizeMm / Math.max(1e-4, Math.min(...body.scales || [1, 1, 1])));
  const pad = pitchLocal * 1.5;
  for (let a = 0; a < 3; a++) {
    if (!Number.isFinite(lo[a])) { lo[a] = -1; hi[a] = 1; }
    lo[a] -= pad; hi[a] += pad;
  }
  let dims = [0, 1, 2].map(a => Math.max(2, Math.min(64, Math.ceil((hi[a] - lo[a]) / pitchLocal))));
  const total = dims[0] * dims[1] * dims[2];
  const step = [0, 1, 2].map(a => (hi[a] - lo[a]) / dims[a]);
  const initLocal = [mat.axisLocal[0] * mat.Ms, mat.axisLocal[1] * mat.Ms, mat.axisLocal[2] * mat.Ms];
  const data = new Float32Array(total * 3);
  const valid = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    data[3*i] = initLocal[0];
    data[3*i+1] = initLocal[1];
    data[3*i+2] = initLocal[2];
    valid[i] = 1;
  }
  return {
    hash: body.hash,
    materialSig: `${mat.name}:${mat.Ms.toFixed(1)}:${mat.Hcj.toFixed(1)}:${mat.magnetization}`,
    lo, hi, dims, step, initLocal, data, valid, modified: false
  };
}

export function sampleBodyLocalMr(store, localPt) {
  const [lx, ly, lz] = localPt;
  const [nx, ny, nz] = store.dims;
  const ix = clamp(Math.floor((lx - store.lo[0]) / store.step[0]), 0, nx - 1);
  const iy = clamp(Math.floor((ly - store.lo[1]) / store.step[1]), 0, ny - 1);
  const iz = clamp(Math.floor((lz - store.lo[2]) / store.step[2]), 0, nz - 1);
  const idx = ix + nx * (iy + ny * iz);
  return [store.data[3*idx], store.data[3*idx+1], store.data[3*idx+2]];
}

export function writeBodyLocalMrFromGrid(store, body, domain, MrGrid) {
  const [nx, ny, nz] = domain.cells;
  const [snx, sny, snz] = store.dims;
  const occ = body.occupancy;
  const invW = body.invWorldMm;
  const [e0, e1, e2] = body.rotBasis; // columns of R_obj (local -> world)
  const accum = new Float64Array(snx * sny * snz * 3);
  const wts = new Uint32Array(snx * sny * snz);
  const Ms = body.material.Ms || 1;
  let maxDiff = 0;

  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = x + nx * (y + ny * z);
    if (!((occ[c >> 5] >>> (c & 31)) & 1)) continue;
    const w = gridPointToWorldMm(domain, x + 0.5, y + 0.5, z + 0.5);
    const lx = invW[0]*w[0] + invW[4]*w[1] + invW[8]*w[2] + invW[12];
    const ly = invW[1]*w[0] + invW[5]*w[1] + invW[9]*w[2] + invW[13];
    const lz = invW[2]*w[0] + invW[6]*w[1] + invW[10]*w[2] + invW[14];
    const ix = clamp(Math.floor((lx - store.lo[0]) / store.step[0]), 0, snx - 1);
    const iy = clamp(Math.floor((ly - store.lo[1]) / store.step[1]), 0, sny - 1);
    const iz = clamp(Math.floor((lz - store.lo[2]) / store.step[2]), 0, snz - 1);
    const si = ix + snx * (iy + sny * iz);
    // Transform MrGrid (grid axes) -> world -> body local (R_obj^T * MrWorld)
    const mrW = gridVecToWorld(domain, [MrGrid[4*c], MrGrid[4*c+1], MrGrid[4*c+2]]);
    const ml0 = dot3(mrW, e0), ml1 = dot3(mrW, e1), ml2 = dot3(mrW, e2);
    accum[3*si] += ml0; accum[3*si+1] += ml1; accum[3*si+2] += ml2;
    wts[si]++;
  }
  for (let si = 0; si < wts.length; si++) {
    if (!wts[si]) continue;
    const inv = 1 / wts[si];
    const v0 = accum[3*si]*inv, v1 = accum[3*si+1]*inv, v2 = accum[3*si+2]*inv;
    store.data[3*si] = v0; store.data[3*si+1] = v1; store.data[3*si+2] = v2;
    const d = Math.hypot(v0 - store.initLocal[0], v1 - store.initLocal[1], v2 - store.initLocal[2]);
    if (d > maxDiff) maxDiff = d;
  }
  // Fill untouched boundary cells of store from nearest written cell (1-pass) to avoid stale corners on rotation
  if (maxDiff > 0.015 * Ms) store.modified = true;
  return maxDiff / Ms;
}

// ---------- Model Assembly ----------

export function buildMagnetoModel({domain, bodies, currentPlanes = [], probes = [], persistentStores = null}) {
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const cellVol = domain.spacingM[0] * domain.spacingM[1] * domain.spacingM[2];
  const cellKind = new Uint8Array(count);       // 0=AIR, 1=SOFT, 2=HARD, 3=CONDUCTOR
  const cellBodyIdx = new Int16Array(count).fill(-1);
  const cellMuR0 = new Float32Array(count).fill(1.0);
  const cellMs = new Float32Array(count);
  const cellHcj = new Float32Array(count);
  const cellSigma = new Float32Array(count);
  const cellMrInit = new Float32Array(count * 4); // (Mrx, Mry, Mrz, 0) in grid frame

  let softCount = 0, hardCount = 0, condCount = 0;
  const bodyRecords = [];

  for (let bIdx = 0; bIdx < bodies.length; bIdx++) {
    const b = bodies[bIdx];
    const mat = b.material;
    const kindCode = mat.kind === 'soft' ? CELL_KIND.SOFT : mat.kind === 'hard' ? CELL_KIND.HARD : CELL_KIND.CONDUCTOR;
    const rotBasis = b.rotBasis || extractRotationBasis(b.worldMatrix);
    const invWorldMm = b.invWorldMm || null;
    const bodyRec = {
      index: bIdx, hash: b.hash, name: b.name || mat.name,
      material: mat, kindCode,
      worldMatrix: b.worldMatrix, invWorldMm, rotBasis,
      pivotWorldMm: b.pivotWorldMm || [b.worldMatrix[12], b.worldMatrix[13], b.worldMatrix[14]],
      scales: b.scales || [0, 4, 8].map(i => Math.hypot(b.worldMatrix[i], b.worldMatrix[i+1], b.worldMatrix[i+2]) || 1),
      occupancy: b.occupancy, activeCount: b.activeCount, volumeM3: b.volumeM3
    };
    bodyRecords.push(bodyRec);

    let store = null;
    if (kindCode === CELL_KIND.HARD && persistentStores && invWorldMm) {
      const existing = persistentStores.get(b.hash);
      const expectedSig = `${mat.name}:${mat.Ms.toFixed(1)}:${mat.Hcj.toFixed(1)}:${mat.magnetization}`;
      if (existing && existing.materialSig === expectedSig) {
        store = existing;
      } else {
        store = createBodyMagnetizationStore(bodyRec, domain, invWorldMm, rotBasis);
        persistentStores.set(b.hash, store);
      }
    }

    // Default initial Mr in grid frame when no persistent store is present
    const initLocal = [mat.axisLocal[0] * mat.Ms, mat.axisLocal[1] * mat.Ms, mat.axisLocal[2] * mat.Ms];
    const initWorld = [
      rotBasis[0][0]*initLocal[0] + rotBasis[1][0]*initLocal[1] + rotBasis[2][0]*initLocal[2],
      rotBasis[0][1]*initLocal[0] + rotBasis[1][1]*initLocal[1] + rotBasis[2][1]*initLocal[2],
      rotBasis[0][2]*initLocal[0] + rotBasis[1][2]*initLocal[1] + rotBasis[2][2]*initLocal[2]
    ];
    const initGrid = worldVecToGrid(domain, initWorld);

    const occ = b.occupancy;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = x + nx * (y + ny * z);
      if (!((occ[c >> 5] >>> (c & 31)) & 1)) continue;
      cellKind[c] = kindCode;
      cellBodyIdx[c] = bIdx;
      cellMuR0[c] = mat.muR0;
      cellMs[c] = mat.Ms;
      cellHcj[c] = mat.Hcj;
      cellSigma[c] = mat.sigma;
      if (kindCode === CELL_KIND.HARD) {
        if (store && invWorldMm) {
          const w = gridPointToWorldMm(domain, x + 0.5, y + 0.5, z + 0.5);
          const lx = invWorldMm[0]*w[0] + invWorldMm[4]*w[1] + invWorldMm[8]*w[2] + invWorldMm[12];
          const ly = invWorldMm[1]*w[0] + invWorldMm[5]*w[1] + invWorldMm[9]*w[2] + invWorldMm[13];
          const lz = invWorldMm[2]*w[0] + invWorldMm[6]*w[1] + invWorldMm[10]*w[2] + invWorldMm[14];
          const ml = sampleBodyLocalMr(store, [lx, ly, lz]);
          const mw = [
            rotBasis[0][0]*ml[0] + rotBasis[1][0]*ml[1] + rotBasis[2][0]*ml[2],
            rotBasis[0][1]*ml[0] + rotBasis[1][1]*ml[1] + rotBasis[2][1]*ml[2],
            rotBasis[0][2]*ml[0] + rotBasis[1][2]*ml[1] + rotBasis[2][2]*ml[2]
          ];
          const mg = worldVecToGrid(domain, mw);
          cellMrInit[4*c] = mg[0]; cellMrInit[4*c+1] = mg[1]; cellMrInit[4*c+2] = mg[2];
        } else {
          cellMrInit[4*c] = initGrid[0]; cellMrInit[4*c+1] = initGrid[1]; cellMrInit[4*c+2] = initGrid[2];
        }
      } else {
        cellMrInit[4*c] = 0; cellMrInit[4*c+1] = 0; cellMrInit[4*c+2] = 0;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (cellKind[i] === CELL_KIND.SOFT) softCount++;
    else if (cellKind[i] === CELL_KIND.HARD) hardCount++;
    else if (cellKind[i] === CELL_KIND.CONDUCTOR) condCount++;
  }

  return {
    domain, cellVol,
    cellKind, cellBodyIdx, cellMuR0, cellMs, cellHcj, cellSigma, cellMrInit,
    bodies: bodyRecords, currentPlanes, probes,
    stats: {
      cells: count,
      solidCount: softCount + hardCount + condCount,
      softCount, hardCount, condCount,
      airCount: count - softCount - hardCount - condCount,
      currentPlaneCount: currentPlanes.length,
      probeCount: probes.length
    }
  };
}

// ---------- 3D Conductor Current Continuity Solver (div(sigma grad phi) = 0 with Branch Cut) ----------
// Solves exact divergence-free 3D current density J in closed conductor loops (via potential jump
// across each Current plane) AND in domain-spanning open busbars (via wall Dirichlet fallback).

export function solveConductorCurrents(model) {
  const {domain, cellKind, cellSigma, currentPlanes} = model;
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const [dx, dy, dz] = domain.spacingM;
  const cellJ = new Float32Array(count * 4); // (Jx, Jy, Jz, |J|) in grid coordinates, A/m^2
  const cutCellMask = new Uint8Array(count); // 1 for conductor voxels touching a Current plane (for Voxels highlight)
  const planeResults = [];

  if (!currentPlanes.length || model.stats.condCount === 0) {
    for (const p of currentPlanes) {
      planeResults.push({
        hash: p.hash, name: p.name, currentDensityAmm2: p.currentDensityAmm2,
        totalCurrentA: 0, cutAreaMm2: 0, mode: 'no-conductor', openCircuit: false
      });
    }
    return {cellJ, cutCellMask, planeResults, sourceCount: 0, maxJAmm2: 0};
  }

  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  const dirs = [
    {axis: 0, d: -1, ox: -1, oy: 0, oz: 0, area: dy * dz, dist: dx},
    {axis: 0, d:  1, ox:  1, oy: 0, oz: 0, area: dy * dz, dist: dx},
    {axis: 1, d: -1, ox:  0, oy: -1, oz: 0, area: dx * dz, dist: dy},
    {axis: 1, d:  1, ox:  0, oy:  1, oz: 0, area: dx * dz, dist: dy},
    {axis: 2, d: -1, ox:  0, oy: 0, oz: -1, area: dx * dy, dist: dz},
    {axis: 2, d:  1, ox:  0, oy: 0, oz:  1, area: dx * dy, dist: dz}
  ];

  // Compact active conductor voxels once
  const cellToActive = new Int32Array(count).fill(-1);
  const activeCells = [];
  for (let i = 0; i < count; i++) {
    if (cellKind[i] === CELL_KIND.CONDUCTOR && cellSigma[i] > 0) {
      cellToActive[i] = activeCells.length;
      activeCells.push(i);
    }
  }
  const N = activeCells.length;
  if (N === 0) {
    for (const p of currentPlanes) {
      planeResults.push({
        hash: p.hash, name: p.name, currentDensityAmm2: p.currentDensityAmm2,
        totalCurrentA: 0, cutAreaMm2: 0, mode: 'no-conductor', openCircuit: false
      });
    }
    return {cellJ, cutCellMask, planeResults, sourceCount: 0, maxJAmm2: 0};
  }

  // Precompute static neighbor links for conductor voxels (6 slots per active voxel)
  const nbr = new Int32Array(N * 6).fill(-1);
  const condG = new Float64Array(N * 6);
  const diagBase = new Float64Array(N);
  const isBoundary = new Uint8Array(N);

  for (let a = 0; a < N; a++) {
    const c = activeCells[a];
    const x = c % nx, rem = (c / nx) | 0, y = rem % ny, z = (rem / ny) | 0;
    if (x === 0 || x === nx - 1 || y === 0 || y === ny - 1 || z === 0 || z === nz - 1) isBoundary[a] = 1;
    const s0 = cellSigma[c];
    let dSum = 0;
    for (let k = 0; k < 6; k++) {
      const df = dirs[k];
      const xx = x + df.ox, yy = y + df.oy, zz = z + df.oz;
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz) continue;
      const nc = cellIdx(xx, yy, zz);
      const na = cellToActive[nc];
      if (na < 0) continue;
      const s1 = cellSigma[nc];
      const sh = (2 * s0 * s1) / (s0 + s1);
      const g = sh * (df.area / df.dist);
      nbr[6*a + k] = na;
      condG[6*a + k] = g;
      dSum += g;
    }
    diagBase[a] = dSum;
  }

  // Connected components among conductor voxels
  const compId = new Int32Array(N).fill(-1);
  const compPin = [];
  const queue = new Int32Array(N);
  for (let a = 0; a < N; a++) {
    if (compId[a] >= 0) continue;
    const cid = compPin.length;
    compPin.push(a);
    let qh = 0, qt = 0;
    compId[a] = cid; queue[qt++] = a;
    while (qh < qt) {
      const u = queue[qh++];
      for (let k = 0; k < 6; k++) {
        const v = nbr[6*u + k];
        if (v >= 0 && compId[v] < 0) { compId[v] = cid; queue[qt++] = v; }
      }
    }
  }

  // Compact Float64 Jacobi-PCG solver on conductor subgraph
  function solveLinearConductor(rhs, fixedMask, fixedVal, maxIter = 1200) {
    const phi = new Float64Array(N);
    const diag = new Float64Array(N);
    for (let a = 0; a < N; a++) {
      if (fixedMask[a]) { phi[a] = fixedVal[a]; diag[a] = 1; }
      else diag[a] = Math.max(1e-30, diagBase[a]);
    }
    const r = new Float64Array(N);
    const z = new Float64Array(N);
    const p = new Float64Array(N);
    const Ap = new Float64Array(N);

    let bNorm2 = 0, rNorm2 = 0;
    for (let a = 0; a < N; a++) {
      if (fixedMask[a]) { r[a] = 0; continue; }
      let Ax = diagBase[a] * phi[a];
      for (let k = 0; k < 6; k++) {
        const v = nbr[6*a + k];
        if (v >= 0) Ax -= condG[6*a + k] * phi[v];
      }
      r[a] = rhs[a] - Ax;
      bNorm2 += rhs[a] * rhs[a];
      rNorm2 += r[a] * r[a];
    }
    if (bNorm2 < 1e-30 && rNorm2 < 1e-30) return phi;
    const tol2 = Math.max(1e-26, 1e-14 * Math.max(bNorm2, rNorm2));

    let rz = 0;
    for (let a = 0; a < N; a++) {
      if (fixedMask[a]) continue;
      z[a] = r[a] / diag[a];
      p[a] = z[a];
      rz += r[a] * z[a];
    }
    for (let it = 0; it < maxIter && rNorm2 > tol2; it++) {
      let pAp = 0;
      for (let a = 0; a < N; a++) {
        if (fixedMask[a]) { Ap[a] = 0; continue; }
        let val = diagBase[a] * p[a];
        for (let k = 0; k < 6; k++) {
          const v = nbr[6*a + k];
          if (v >= 0 && !fixedMask[v]) val -= condG[6*a + k] * p[v];
        }
        Ap[a] = val;
        pAp += p[a] * val;
      }
      if (pAp <= 1e-30) break;
      const alpha = rz / pAp;
      rNorm2 = 0;
      let rzNew = 0;
      for (let a = 0; a < N; a++) {
        if (fixedMask[a]) continue;
        phi[a] += alpha * p[a];
        r[a] -= alpha * Ap[a];
        rNorm2 += r[a] * r[a];
        z[a] = r[a] / diag[a];
        rzNew += r[a] * z[a];
      }
      if (rNorm2 <= tol2) break;
      const beta = rzNew / Math.max(1e-30, rz);
      for (let a = 0; a < N; a++) {
        if (!fixedMask[a]) p[a] = z[a] + beta * p[a];
      }
      rz = rzNew;
    }
    return phi;
  }

  const pitchMm = Math.max(...domain.spacingM) * M_TO_MM;

  for (const plane of currentPlanes) {
    const J0SI = plane.currentDensityAmm2 * 1e6; // A/mm^2 -> A/m^2
    const invP = plane.invWorldMm;
    const normalGrid = plane.normalGrid;
    const padX = 0.55 * pitchMm / Math.max(1e-5, plane.scales[0]);
    const padY = 0.55 * pitchMm / Math.max(1e-5, plane.scales[1]);

    // Compute local plane coordinates for every active conductor cell
    const locX = new Float64Array(N);
    const locY = new Float64Array(N);
    const locZ = new Float64Array(N);
    for (let a = 0; a < N; a++) {
      const c = activeCells[a];
      const x = c % nx, rem = (c / nx) | 0, y = rem % ny, z = (rem / ny) | 0;
      const w = gridPointToWorldMm(domain, x + 0.5, y + 0.5, z + 0.5);
      locX[a] = invP[0]*w[0] + invP[4]*w[1] + invP[8]*w[2] + invP[12];
      locY[a] = invP[1]*w[0] + invP[5]*w[1] + invP[9]*w[2] + invP[13];
      locZ[a] = invP[2]*w[0] + invP[6]*w[1] + invP[10]*w[2] + invP[14];
    }

    // Identify cut faces crossing the finite Current plane rectangle
    const cutSign = new Int8Array(N * 6);
    const rhs = new Float64Array(N);
    let cutFaceCount = 0;
    let cutAreaM2 = 0;
    const touchedComps = new Set();

    for (let a = 0; a < N; a++) {
      const za = locZ[a];
      for (let k = 0; k < 6; k++) {
        const b = nbr[6*a + k];
        if (b < 0) continue;
        const zb = locZ[b];
        if (!((za < 0 && zb >= 0) || (zb < 0 && za >= 0))) continue;
        const t = -za / (zb - za);
        const ix = locX[a] + t * (locX[b] - locX[a]);
        const iy = locY[a] + t * (locY[b] - locY[a]);
        if (Math.abs(ix) > 50 + padX || Math.abs(iy) > 50 + padY) continue;
        const s = za < 0 ? 1 : -1;
        cutSign[6*a + k] = s;
        rhs[a] -= condG[6*a + k] * s;
        cutCellMask[activeCells[a]] = 1;
        touchedComps.add(compId[a]);
        if (s > 0) {
          cutFaceCount++;
          const df = dirs[k];
          const nDot = Math.abs(normalGrid[df.axis]);
          cutAreaM2 += df.area * Math.max(0.25, nDot);
        }
      }
    }

    if (cutFaceCount === 0) {
      planeResults.push({
        hash: plane.hash, name: plane.name, currentDensityAmm2: plane.currentDensityAmm2,
        totalCurrentA: 0, cutAreaMm2: 0, mode: 'no-intersection', openCircuit: false
      });
      continue;
    }

    const cutAreaMm2 = cutAreaM2 * 1e6;
    const targetCurrentA = J0SI * cutAreaM2;
    if (Math.abs(J0SI) < 1e-12) {
      planeResults.push({
        hash: plane.hash, name: plane.name, currentDensityAmm2: 0,
        totalCurrentA: 0, cutAreaMm2, mode: 'zero', openCircuit: false
      });
      continue;
    }

    // 1) Try closed-loop branch-cut solve
    const fixedMask = new Uint8Array(N);
    const fixedVal = new Float64Array(N);
    for (const cid of touchedComps) fixedMask[compPin[cid]] = 1;
    // Pin untouched components too so they don't float
    for (let a = 0; a < N; a++) if (!touchedComps.has(compId[a])) fixedMask[a] = 1;

    let phi = solveLinearConductor(rhs, fixedMask, fixedVal);
    let unitI = 0;
    for (let a = 0; a < N; a++) {
      for (let k = 0; k < 6; k++) {
        if (cutSign[6*a + k] !== 1) continue;
        const b = nbr[6*a + k];
        unitI += condG[6*a + k] * (phi[a] - phi[b] + 1);
      }
    }

    let mode = 'closed-loop';
    let useCutJump = true;

    // 2) If closed loop current vanishes (open straight busbar spanning domain walls), flood-fill sides without crossing cut
    if (Math.abs(unitI) < 1e-9 * Math.max(1, cutAreaM2 * 1e6)) {
      const side = new Int8Array(N); // -1 or +1
      let qh = 0, qt = 0;
      for (let a = 0; a < N; a++) {
        for (let k = 0; k < 6; k++) {
          if (cutSign[6*a + k] === 1 && side[a] === 0) { side[a] = -1; queue[qt++] = a; }
          else if (cutSign[6*a + k] === -1 && side[a] === 0) { side[a] = 1; queue[qt++] = a; }
        }
      }
      while (qh < qt) {
        const u = queue[qh++];
        const su = side[u];
        for (let k = 0; k < 6; k++) {
          if (cutSign[6*u + k] !== 0) continue;
          const v = nbr[6*u + k];
          if (v >= 0 && side[v] === 0) { side[v] = su; queue[qt++] = v; }
        }
      }
      let negWall = 0, posWall = 0;
      const wallMask = new Uint8Array(N);
      const wallVal = new Float64Array(N);
      for (let a = 0; a < N; a++) {
        if (!touchedComps.has(compId[a])) { wallMask[a] = 1; continue; }
        if (isBoundary[a] && side[a] === -1) { wallMask[a] = 1; wallVal[a] = 0.5; negWall++; }
        else if (isBoundary[a] && side[a] === 1) { wallMask[a] = 1; wallVal[a] = -0.5; posWall++; }
      }
      if (negWall > 0 && posWall > 0) {
        phi = solveLinearConductor(new Float64Array(N), wallMask, wallVal);
        unitI = 0;
        for (let a = 0; a < N; a++) {
          for (let k = 0; k < 6; k++) {
            if (cutSign[6*a + k] !== 1) continue;
            const b = nbr[6*a + k];
            unitI += condG[6*a + k] * (phi[a] - phi[b]);
          }
        }
        mode = 'open-busbar';
        useCutJump = false;
      } else {
        planeResults.push({
          hash: plane.hash, name: plane.name, currentDensityAmm2: plane.currentDensityAmm2,
          totalCurrentA: 0, cutAreaMm2, mode: 'open-circuit', openCircuit: true
        });
        continue;
      }
    }

    if (Math.abs(unitI) < 1e-18) {
      planeResults.push({
        hash: plane.hash, name: plane.name, currentDensityAmm2: plane.currentDensityAmm2,
        totalCurrentA: 0, cutAreaMm2, mode: 'open-circuit', openCircuit: true
      });
      continue;
    }

    const scale = targetCurrentA / unitI;
    // Reconstruct exact volume-averaged cell-centered J = 0.5*(J_minus + J_plus) (air faces carry 0 -> exact dipole moment!)
    for (let a = 0; a < N; a++) {
      if (!touchedComps.has(compId[a])) continue;
      const c = activeCells[a];
      const jAxis = [0, 0, 0];
      for (let ax = 0; ax < 3; ax++) {
        const km = 2 * ax, kp = 2 * ax + 1;
        let jSum = 0;
        const vm = nbr[6*a + km];
        if (vm >= 0) {
          // Face from vm -> a (+axis direction)
          const jump = useCutJump ? -cutSign[6*a + km] : 0; // cutSign on a->vm is opposite to vm->a
          const iFace = condG[6*a + km] * ((phi[vm] - phi[a]) + jump) * scale;
          jSum += iFace / dirs[km].area;
        }
        const vp = nbr[6*a + kp];
        if (vp >= 0) {
          // Face from a -> vp (+axis direction)
          const jump = useCutJump ? cutSign[6*a + kp] : 0;
          const iFace = condG[6*a + kp] * ((phi[a] - phi[vp]) + jump) * scale;
          jSum += iFace / dirs[kp].area;
        }
        jAxis[ax] = 0.5 * jSum;
      }
      cellJ[4*c]   += jAxis[0];
      cellJ[4*c+1] += jAxis[1];
      cellJ[4*c+2] += jAxis[2];
    }

    planeResults.push({
      hash: plane.hash, name: plane.name, currentDensityAmm2: plane.currentDensityAmm2,
      totalCurrentA: targetCurrentA, cutAreaMm2, mode, openCircuit: false
    });
  }

  let sourceCount = 0, maxJ = 0;
  for (let i = 0; i < count; i++) {
    const jx = cellJ[4*i], jy = cellJ[4*i+1], jz = cellJ[4*i+2];
    const jm = Math.hypot(jx, jy, jz);
    cellJ[4*i+3] = jm;
    if (jm > 1e-6) { sourceCount++; if (jm > maxJ) maxJ = jm; }
  }
  return {cellJ, cutCellMask, planeResults, sourceCount, maxJAmm2: maxJ * 1e-6};
}

// ---------- GPU Biot-Savart + Nonlinear Magnetostatics Shaders (<= 6 Storage Buffers / Pipeline) ----------

const BIOTSAVART_WGSL = `
struct BSCfg {
  dims: vec4u,      // nx, ny, nz, count
  spacing: vec4f,   // dx, dy, dz, r0sq
  chunk: vec4u      // startSrc, endSrc, clearFirst (0 or 1), unused
};
@group(0) @binding(0) var<uniform> cfg: BSCfg;
@group(0) @binding(1) var<storage,read> srcData: array<vec4f>; // 2 vec4 per src: [posM.xyz, volM3], [Jx, Jy, Jz, 0]
@group(0) @binding(2) var<storage,read_write> HsBuf: array<vec4f>;

var<workgroup> shPos: array<vec4f, 64>;
var<workgroup> shJ: array<vec4f, 64>;

@compute @workgroup_size(64)
fn biotSavart(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32) {
  let c = gid.x;
  let valid = c < cfg.dims.w;
  var pos = vec3f(0.0);
  if (valid) {
    let nx = cfg.dims.x; let ny = cfg.dims.y;
    let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
    pos = vec3f((f32(x) + 0.5) * cfg.spacing.x, (f32(y) + 0.5) * cfg.spacing.y, (f32(z) + 0.5) * cfg.spacing.z);
  }
  var acc = vec3f(0.0);
  if (valid && cfg.chunk.z == 0u) { acc = HsBuf[c].xyz; }
  let r0sq = cfg.spacing.w;
  let start = cfg.chunk.x;
  let end = cfg.chunk.y;

  var base = start;
  while (base < end) {
    let sIdx = base + lane;
    if (sIdx < end) {
      shPos[lane] = srcData[2u * sIdx];
      shJ[lane] = srcData[2u * sIdx + 1u];
    } else {
      shPos[lane] = vec4f(0.0);
      shJ[lane] = vec4f(0.0);
    }
    workgroupBarrier();
    if (valid) {
      let nTile = min(64u, end - base);
      for (var k = 0u; k < nTile; k++) {
        let sp = shPos[k];
        let sj = shJ[k];
        let r = pos - sp.xyz;
        let r2 = dot(r, r) + r0sq;
        let invR = inverseSqrt(r2);
        let invR3 = invR * invR * invR;
        acc += cross(sj.xyz, r) * (sp.w * invR3 * 0.07957747154594767);
      }
    }
    workgroupBarrier();
    base += 64u;
  }
  if (valid) {
    HsBuf[c] = vec4f(acc, length(acc));
  }
}
`;

const MAGNETO_ASSEMBLE_WGSL = `
struct MagCfg {
  dims: vec4u,      // nx, ny, nz, count
  spacing: vec4f,   // dx, dy, dz, scaleNorm
  center: vec4f,    // cx, cy, cz, minR
  ctrl: vec4f       // relax, unused, unused, unused
};
@group(0) @binding(0) var<uniform> cfg: MagCfg;
@group(0) @binding(1) var<storage,read> muR: array<f32>;
@group(0) @binding(2) var<storage,read> MrCur: array<vec4f>;
@group(0) @binding(3) var<storage,read> HsBuf: array<vec4f>;
@group(0) @binding(4) var<storage,read_write> coeffA: array<vec4f>; // (cxp, cyp, czp, diag)
@group(0) @binding(5) var<storage,read_write> rhsBuf: array<f32>;

fn idx3(x: u32, y: u32, z: u32) -> u32 { return x + cfg.dims.x * (y + cfg.dims.y * z); }
fn harm(a: f32, b: f32) -> f32 { return (2.0 * a * b) / max(1e-12, a + b); }
fn faceMr(muA: f32, muB: f32, mA: f32, mB: f32) -> f32 { return (muB * mA + muA * mB) / max(1e-12, muA + muB); }

fn robinCoeff(facePos: vec3f, normal: vec3f, muC: f32, dAxis: f32, area: f32) -> f32 {
  let rv = facePos - cfg.center.xyz;
  let R = max(cfg.center.w, length(rv));
  let cosT = max(0.15, dot(rv, normal) / R);
  let kRob = (2.0 * cosT) / R;
  return (muC * area / (0.5 * dAxis + 1.0 / kRob)) * cfg.spacing.w;
}

@compute @workgroup_size(64)
fn assemble(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let dx = cfg.spacing.x; let dy = cfg.spacing.y; let dz = cfg.spacing.z;
  let sN = cfg.spacing.w;
  let Ax = dy * dz; let Ay = dx * dz; let Az = dx * dy;

  let muC = max(1.0, muR[c]);
  let mrC = MrCur[c].xyz;
  let hsC = HsBuf[c].xyz;
  let posC = vec3f((f32(x) + 0.5) * dx, (f32(y) + 0.5) * dy, (f32(z) + 0.5) * dz);

  var diag = 0.0;
  var outSrc = 0.0;
  var cxp = 0.0; var cyp = 0.0; var czp = 0.0;

  // -X face
  if (x > 0u) {
    let nb = idx3(x - 1u, y, z);
    let muN = max(1.0, muR[nb]);
    let mf = harm(muC, muN);
    let g = (mf * Ax / dx) * sN;
    diag += g;
    let src = mf * 0.5 * (hsC.x + HsBuf[nb].x) + faceMr(muN, muC, MrCur[nb].x, mrC.x);
    outSrc -= src * Ax * sN;
  } else {
    diag += robinCoeff(posC - vec3f(0.5 * dx, 0.0, 0.0), vec3f(-1.0, 0.0, 0.0), muC, dx, Ax);
    outSrc -= (muC * hsC.x + mrC.x) * Ax * sN;
  }
  // +X face
  if (x + 1u < nx) {
    let nb = idx3(x + 1u, y, z);
    let muN = max(1.0, muR[nb]);
    let mf = harm(muC, muN);
    cxp = (mf * Ax / dx) * sN;
    diag += cxp;
    let src = mf * 0.5 * (hsC.x + HsBuf[nb].x) + faceMr(muC, muN, mrC.x, MrCur[nb].x);
    outSrc += src * Ax * sN;
  } else {
    diag += robinCoeff(posC + vec3f(0.5 * dx, 0.0, 0.0), vec3f(1.0, 0.0, 0.0), muC, dx, Ax);
    outSrc += (muC * hsC.x + mrC.x) * Ax * sN;
  }

  // -Y face
  if (y > 0u) {
    let nb = idx3(x, y - 1u, z);
    let muN = max(1.0, muR[nb]);
    let mf = harm(muC, muN);
    let g = (mf * Ay / dy) * sN;
    diag += g;
    let src = mf * 0.5 * (hsC.y + HsBuf[nb].y) + faceMr(muN, muC, MrCur[nb].y, mrC.y);
    outSrc -= src * Ay * sN;
  } else {
    diag += robinCoeff(posC - vec3f(0.0, 0.5 * dy, 0.0), vec3f(0.0, -1.0, 0.0), muC, dy, Ay);
    outSrc -= (muC * hsC.y + mrC.y) * Ay * sN;
  }
  // +Y face
  if (y + 1u < ny) {
    let nb = idx3(x, y + 1u, z);
    let muN = max(1.0, muR[nb]);
    let mf = harm(muC, muN);
    cyp = (mf * Ay / dy) * sN;
    diag += cyp;
    let src = mf * 0.5 * (hsC.y + HsBuf[nb].y) + faceMr(muC, muN, mrC.y, MrCur[nb].y);
    outSrc += src * Ay * sN;
  } else {
    diag += robinCoeff(posC + vec3f(0.0, 0.5 * dy, 0.0), vec3f(0.0, 1.0, 0.0), muC, dy, Ay);
    outSrc += (muC * hsC.y + mrC.y) * Ay * sN;
  }

  // -Z face
  if (z > 0u) {
    let nb = idx3(x, y, z - 1u);
    let muN = max(1.0, muR[nb]);
    let mf = harm(muC, muN);
    let g = (mf * Az / dz) * sN;
    diag += g;
    let src = mf * 0.5 * (hsC.z + HsBuf[nb].z) + faceMr(muN, muC, MrCur[nb].z, mrC.z);
    outSrc -= src * Az * sN;
  } else {
    diag += robinCoeff(posC - vec3f(0.0, 0.0, 0.5 * dz), vec3f(0.0, 0.0, -1.0), muC, dz, Az);
    outSrc -= (muC * hsC.z + mrC.z) * Az * sN;
  }
  // +Z face
  if (z + 1u < nz) {
    let nb = idx3(x, y, z + 1u);
    let muN = max(1.0, muR[nb]);
    let mf = harm(muC, muN);
    czp = (mf * Az / dz) * sN;
    diag += czp;
    let src = mf * 0.5 * (hsC.z + HsBuf[nb].z) + faceMr(muC, muN, mrC.z, MrCur[nb].z);
    outSrc += src * Az * sN;
  } else {
    diag += robinCoeff(posC + vec3f(0.0, 0.0, 0.5 * dz), vec3f(0.0, 0.0, 1.0), muC, dz, Az);
    outSrc += (muC * hsC.z + mrC.z) * Az * sN;
  }

  coeffA[c] = vec4f(cxp, cyp, czp, max(1e-12, diag));
  rhsBuf[c] = -outSrc;
}
`;

const MAGNETO_PCG_WGSL = `
struct PCGCfg {
  dims: vec4u,     // nx, ny, nz, count
  counts: vec4u    // wgCount, stepIdx (0|1|2), unused, unused
};
struct Scalars {
  bNorm2: f32,
  rNorm2: f32,
  rz: f32,
  alpha: f32,
  beta: f32,
  pAp: f32,
  converged: u32,
  pad: u32
};
@group(0) @binding(0) var<uniform> cfg: PCGCfg;
@group(0) @binding(1) var<storage,read> coeffA: array<vec4f>;
@group(0) @binding(2) var<storage,read> rhsBuf: array<f32>;
@group(0) @binding(3) var<storage,read_write> vecXR: array<vec4f>; // x=phi, y=r, z=z, w=p
@group(0) @binding(4) var<storage,read_write> apBuf: array<f32>;
@group(0) @binding(5) var<storage,read_write> partials: array<vec2f>;
@group(0) @binding(6) var<storage,read_write> scalars: Scalars;

fn idx3(x: u32, y: u32, z: u32) -> u32 { return x + cfg.dims.x * (y + cfg.dims.y * z); }

fn matvecPhi(c: u32) -> f32 {
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let a = coeffA[c];
  var v = a.w * vecXR[c].x;
  if (x > 0u) { let nb = idx3(x - 1u, y, z); v -= coeffA[nb].x * vecXR[nb].x; }
  if (x + 1u < nx) { let nb = idx3(x + 1u, y, z); v -= a.x * vecXR[nb].x; }
  if (y > 0u) { let nb = idx3(x, y - 1u, z); v -= coeffA[nb].y * vecXR[nb].x; }
  if (y + 1u < ny) { let nb = idx3(x, y + 1u, z); v -= a.y * vecXR[nb].x; }
  if (z > 0u) { let nb = idx3(x, y, z - 1u); v -= coeffA[nb].z * vecXR[nb].x; }
  if (z + 1u < nz) { let nb = idx3(x, y, z + 1u); v -= a.z * vecXR[nb].x; }
  return v;
}

fn matvecP(c: u32) -> f32 {
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let a = coeffA[c];
  var v = a.w * vecXR[c].w;
  if (x > 0u) { let nb = idx3(x - 1u, y, z); v -= coeffA[nb].x * vecXR[nb].w; }
  if (x + 1u < nx) { let nb = idx3(x + 1u, y, z); v -= a.x * vecXR[nb].w; }
  if (y > 0u) { let nb = idx3(x, y - 1u, z); v -= coeffA[nb].y * vecXR[nb].w; }
  if (y + 1u < ny) { let nb = idx3(x, y + 1u, z); v -= a.y * vecXR[nb].w; }
  if (z > 0u) { let nb = idx3(x, y, z - 1u); v -= coeffA[nb].z * vecXR[nb].w; }
  if (z + 1u < nz) { let nb = idx3(x, y, z + 1u); v -= a.z * vecXR[nb].w; }
  return v;
}

var<workgroup> sh64: array<vec2f, 64>;
fn reduce64(lane: u32, wid: u32, val: vec2f) {
  sh64[lane] = val;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s /= 2u) {
    if (lane < s) { sh64[lane] += sh64[lane + s]; }
    workgroupBarrier();
  }
  if (lane == 0u) { partials[wid] = sh64[0]; }
}

var<workgroup> sh256: array<vec2f, 256>;
fn sumPartials(lane: u32) -> vec2f {
  var acc = vec2f(0.0);
  var i = lane;
  let n = cfg.counts.x;
  while (i < n) {
    acc += partials[i];
    i += 256u;
  }
  sh256[lane] = acc;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s /= 2u) {
    if (lane < s) { sh256[lane] += sh256[lane + s]; }
    workgroupBarrier();
  }
  return sh256[0];
}

@compute @workgroup_size(64)
fn pcgInit(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = gid.x;
  var acc = vec2f(0.0);
  if (c < cfg.dims.w) {
    let b = rhsBuf[c];
    let r = b - matvecPhi(c);
    vecXR[c].y = r;
    acc = vec2f(b * b, r * r);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceInit(@builtin(local_invocation_index) lane: u32) {
  let tot = sumPartials(lane);
  if (lane == 0u) {
    scalars.bNorm2 = tot.x;
    scalars.rNorm2 = tot.y;
    scalars.rz = 0.0;
    scalars.alpha = 0.0;
    scalars.beta = 0.0;
    scalars.pAp = 0.0;
    scalars.converged = select(0u, 1u, tot.x <= 1e-30 || tot.y <= 1e-30);
  }
}

// Symmetric Red-Black Gauss-Seidel preconditioner M^-1 = L^T D^-1 L (exact SPD for PCG!)
@compute @workgroup_size(64)
fn rbPrecond(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w || scalars.converged != 0u) { return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let step = cfg.counts.y;
  let parity = (x + y + z) & 1u;
  if (step == 0u) {
    if (parity != 0u) { return; }
    vecXR[c].z = vecXR[c].y / coeffA[c].w;
    return;
  }
  let wantParity = select(0u, 1u, step == 1u);
  if (parity != wantParity) { return; }
  let a = coeffA[c];
  var s = vecXR[c].y;
  if (x > 0u) { let nb = idx3(x - 1u, y, z); s += coeffA[nb].x * vecXR[nb].z; }
  if (x + 1u < nx) { let nb = idx3(x + 1u, y, z); s += a.x * vecXR[nb].z; }
  if (y > 0u) { let nb = idx3(x, y - 1u, z); s += coeffA[nb].y * vecXR[nb].z; }
  if (y + 1u < ny) { let nb = idx3(x, y + 1u, z); s += a.y * vecXR[nb].z; }
  if (z > 0u) { let nb = idx3(x, y, z - 1u); s += coeffA[nb].z * vecXR[nb].z; }
  if (z + 1u < nz) { let nb = idx3(x, y, z + 1u); s += a.z * vecXR[nb].z; }
  vecXR[c].z = s / a.w;
}

@compute @workgroup_size(64)
fn pcgInitP(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = gid.x;
  var acc = vec2f(0.0);
  if (c < cfg.dims.w && scalars.converged == 0u) {
    let z = vecXR[c].z;
    vecXR[c].w = z;
    acc = vec2f(vecXR[c].y * z, 0.0);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceInitP(@builtin(local_invocation_index) lane: u32) {
  let tot = sumPartials(lane);
  if (lane == 0u) {
    scalars.rz = tot.x;
    if (!(tot.x > 1e-30) || tot.x != tot.x) { scalars.converged = 1u; }
  }
}

@compute @workgroup_size(64)
fn pcgStepAp(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = gid.x;
  var acc = vec2f(0.0);
  if (c < cfg.dims.w && scalars.converged == 0u) {
    let ap = matvecP(c);
    apBuf[c] = ap;
    acc = vec2f(vecXR[c].w * ap, 0.0);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceAp(@builtin(local_invocation_index) lane: u32) {
  let tot = sumPartials(lane);
  if (lane == 0u) {
    let pAp = tot.x;
    scalars.pAp = pAp;
    if (scalars.converged == 0u && pAp > 1e-30 && pAp == pAp) {
      scalars.alpha = scalars.rz / pAp;
    } else {
      scalars.alpha = 0.0;
      scalars.converged = 1u;
    }
  }
}

@compute @workgroup_size(64)
fn pcgUpdateXR(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = gid.x;
  var acc = vec2f(0.0);
  if (c < cfg.dims.w) {
    if (scalars.converged == 0u) {
      let a = scalars.alpha;
      let cur = vecXR[c];
      let xNew = cur.x + a * cur.w;
      let rNew = cur.y - a * apBuf[c];
      vecXR[c].x = xNew;
      vecXR[c].y = rNew;
      acc = vec2f(rNew * rNew, 0.0);
    } else {
      let r = vecXR[c].y;
      acc = vec2f(r * r, 0.0);
    }
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceR2(@builtin(local_invocation_index) lane: u32) {
  let tot = sumPartials(lane);
  if (lane == 0u) {
    scalars.rNorm2 = tot.x;
    if (tot.x != tot.x || tot.x <= 1e-30) { scalars.converged = 1u; }
  }
}

@compute @workgroup_size(64)
fn pcgDotRZ(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = gid.x;
  var acc = vec2f(0.0);
  if (c < cfg.dims.w && scalars.converged == 0u) {
    acc = vec2f(vecXR[c].y * vecXR[c].z, 0.0);
  }
  reduce64(lane, wid.x, acc);
}

@compute @workgroup_size(256)
fn reduceRZ(@builtin(local_invocation_index) lane: u32) {
  let tot = sumPartials(lane);
  if (lane == 0u) {
    let rzNew = tot.x;
    if (scalars.converged == 0u && scalars.rz > 1e-30 && rzNew > 1e-30 && rzNew == rzNew) {
      scalars.beta = rzNew / scalars.rz;
      scalars.rz = rzNew;
    } else {
      scalars.beta = 0.0;
      scalars.converged = 1u;
    }
  }
}

@compute @workgroup_size(64)
fn pcgUpdateP(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w || scalars.converged != 0u) { return; }
  let cur = vecXR[c];
  vecXR[c].w = cur.z + scalars.beta * cur.w;
}
`;

const MAGNETO_EVAL_WGSL = `
struct EvalCfg {
  dims: vec4u,     // nx, ny, nz, count
  spacing: vec4f,  // dx, dy, dz, unused
  center: vec4f,   // cx, cy, cz, minR
  ctrl: vec4f      // relax, unused, unused, unused
};
@group(0) @binding(0) var<uniform> cfg: EvalCfg;
@group(0) @binding(1) var<storage,read> vecXR: array<vec4f>; // .x = phi
@group(0) @binding(2) var<storage,read> muR: array<f32>;
@group(0) @binding(3) var<storage,read> MrCur: array<vec4f>;
@group(0) @binding(4) var<storage,read> HsBuf: array<vec4f>;
@group(0) @binding(5) var<storage,read_write> HBuf: array<vec4f>;
@group(0) @binding(6) var<storage,read_write> BBuf: array<vec4f>;

fn idx3(x: u32, y: u32, z: u32) -> u32 { return x + cfg.dims.x * (y + cfg.dims.y * z); }
fn harm(a: f32, b: f32) -> f32 { return (2.0 * a * b) / max(1e-12, a + b); }
fn faceMr(muA: f32, muB: f32, mA: f32, mB: f32) -> f32 { return (muB * mA + muA * mB) / max(1e-12, muA + muB); }
fn robinGrad(facePos: vec3f, normal: vec3f, phiC: f32, dAxis: f32) -> f32 {
  let rv = facePos - cfg.center.xyz;
  let R = max(cfg.center.w, length(rv));
  let cosT = max(0.15, dot(rv, normal) / R);
  let kRob = (2.0 * cosT) / R;
  return phiC / (0.5 * dAxis + 1.0 / kRob);
}

@compute @workgroup_size(64)
fn evalHB(@builtin(global_invocation_id) tid: vec3u) {
  let c = tid.x;
  if (c >= cfg.dims.w) { return; }
  let nx = cfg.dims.x; let ny = cfg.dims.y; let nz = cfg.dims.z;
  let x = c % nx; let rem = c / nx; let y = rem % ny; let z = rem / ny;
  let dx = cfg.spacing.x; let dy = cfg.spacing.y; let dz = cfg.spacing.z;
  let muC = max(1.0, muR[c]);
  let mrC = MrCur[c].xyz;
  let hsC = HsBuf[c].xyz;
  let pC = vecXR[c].x;
  let posC = vec3f((f32(x) + 0.5) * dx, (f32(y) + 0.5) * dy, (f32(z) + 0.5) * dz);

  // X faces
  var bxm = 0.0;
  if (x > 0u) {
    let nb = idx3(x - 1u, y, z); let muN = max(1.0, muR[nb]); let mf = harm(muN, muC);
    bxm = mf * (0.5 * (HsBuf[nb].x + hsC.x) - (pC - vecXR[nb].x) / dx) + faceMr(muN, muC, MrCur[nb].x, mrC.x);
  } else {
    bxm = muC * (hsC.x - robinGrad(posC - vec3f(0.5 * dx, 0.0, 0.0), vec3f(-1.0, 0.0, 0.0), pC, dx)) + mrC.x;
  }
  var bxp = 0.0;
  if (x + 1u < nx) {
    let nb = idx3(x + 1u, y, z); let muN = max(1.0, muR[nb]); let mf = harm(muC, muN);
    bxp = mf * (0.5 * (hsC.x + HsBuf[nb].x) - (vecXR[nb].x - pC) / dx) + faceMr(muC, muN, mrC.x, MrCur[nb].x);
  } else {
    bxp = muC * (hsC.x + robinGrad(posC + vec3f(0.5 * dx, 0.0, 0.0), vec3f(1.0, 0.0, 0.0), pC, dx)) + mrC.x;
  }

  // Y faces
  var bym = 0.0;
  if (y > 0u) {
    let nb = idx3(x, y - 1u, z); let muN = max(1.0, muR[nb]); let mf = harm(muN, muC);
    bym = mf * (0.5 * (HsBuf[nb].y + hsC.y) - (pC - vecXR[nb].x) / dy) + faceMr(muN, muC, MrCur[nb].y, mrC.y);
  } else {
    bym = muC * (hsC.y - robinGrad(posC - vec3f(0.0, 0.5 * dy, 0.0), vec3f(0.0, -1.0, 0.0), pC, dy)) + mrC.y;
  }
  var byp = 0.0;
  if (y + 1u < ny) {
    let nb = idx3(x, y + 1u, z); let muN = max(1.0, muR[nb]); let mf = harm(muC, muN);
    byp = mf * (0.5 * (hsC.y + HsBuf[nb].y) - (vecXR[nb].x - pC) / dy) + faceMr(muC, muN, mrC.y, MrCur[nb].y);
  } else {
    byp = muC * (hsC.y + robinGrad(posC + vec3f(0.0, 0.5 * dy, 0.0), vec3f(0.0, 1.0, 0.0), pC, dy)) + mrC.y;
  }

  // Z faces
  var bzm = 0.0;
  if (z > 0u) {
    let nb = idx3(x, y, z - 1u); let muN = max(1.0, muR[nb]); let mf = harm(muN, muC);
    bzm = mf * (0.5 * (HsBuf[nb].z + hsC.z) - (pC - vecXR[nb].x) / dz) + faceMr(muN, muC, MrCur[nb].z, mrC.z);
  } else {
    bzm = muC * (hsC.z - robinGrad(posC - vec3f(0.0, 0.0, 0.5 * dz), vec3f(0.0, 0.0, -1.0), pC, dz)) + mrC.z;
  }
  var bzp = 0.0;
  if (z + 1u < nz) {
    let nb = idx3(x, y, z + 1u); let muN = max(1.0, muR[nb]); let mf = harm(muC, muN);
    bzp = mf * (0.5 * (hsC.z + HsBuf[nb].z) - (vecXR[nb].x - pC) / dz) + faceMr(muC, muN, mrC.z, MrCur[nb].z);
  } else {
    bzp = muC * (hsC.z + robinGrad(posC + vec3f(0.0, 0.0, 0.5 * dz), vec3f(0.0, 0.0, 1.0), pC, dz)) + mrC.z;
  }

  let Bnorm = vec3f(0.5 * (bxm + bxp), 0.5 * (bym + byp), 0.5 * (bzm + bzp));
  let H = (Bnorm - mrC) / muC;
  let B = Bnorm * 1.25663706212e-6;
  HBuf[c] = vec4f(H, length(H));
  BBuf[c] = vec4f(B, length(B));
}
`;

const MAGNETO_NONLIN_WGSL = `
struct NLCfg {
  count: u32,
  relax: f32,
  p0: f32,
  p1: f32
};
@group(0) @binding(0) var<uniform> cfg: NLCfg;
@group(0) @binding(1) var<storage,read> matParams: array<vec4f>; // (muR0, Ms, Hcj, kindFlag)
@group(0) @binding(2) var<storage,read> HBuf: array<vec4f>;
@group(0) @binding(3) var<storage,read> MrBase: array<vec4f>;
@group(0) @binding(4) var<storage,read_write> muR: array<f32>;
@group(0) @binding(5) var<storage,read_write> MrCur: array<vec4f>;
@group(0) @binding(6) var<storage,read_write> deltaOut: array<f32>;

var<workgroup> shMax: array<f32, 64>;

@compute @workgroup_size(64)
fn updateNonlinear(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lane: u32, @builtin(workgroup_id) wid: vec3u) {
  let c = gid.x;
  var delta = 0.0;
  if (c < cfg.count) {
    let mp = matParams[c];
    let kind = u32(mp.w + 0.5);
    let H = HBuf[c].xyz;
    let Hmag = HBuf[c].w;
    if (kind == 1u) {
      // Soft nonlinear ferromagnet (Frohlich-Kennelly)
      let chi0 = max(0.0, mp.x - 1.0);
      let Ms = mp.y;
      let targetMu = select(mp.x, 1.0 + chi0 / (1.0 + (chi0 * Hmag) / Ms), Ms > 1e-6);
      let oldMu = muR[c];
      let nextMu = oldMu + cfg.relax * (targetMu - oldMu);
      muR[c] = nextMu;
      delta = abs(nextMu - oldMu) / max(1.0, oldMu);
    } else if (kind == 2u) {
      // Hard permanent magnet with real vector hysteresis anchored to MrBase
      let Ms = mp.y;
      let Hcj = mp.z;
      let baseM = MrBase[c].xyz;
      var targetM = baseM;
      if (Ms > 1e-6 && Hcj > 1e-6 && Hmag > 1e-6) {
        let u = Hmag / Hcj;
        if (u > 0.65) {
          let t = clamp((u - 0.65) / 0.70, 0.0, 1.0);
          let s = t * t * (3.0 - 2.0 * t);
          let hHat = H / Hmag;
          let cand = (1.0 - s) * baseM + (s * Ms) * hHat;
          let cm = length(cand);
          targetM = select(cand, cand * (Ms / cm), cm > Ms);
        }
      }
      let effRelax = min(cfg.relax, 1.0 / (1.0 + 0.40 * select(0.0, Ms / Hcj, Hcj > 1e-6)));
      let oldM = MrCur[c].xyz;
      let nextM = oldM + effRelax * (targetM - oldM);
      let nm = length(nextM);
      let clampedM = select(nextM, nextM * (Ms / nm), Ms > 1e-6 && nm > Ms);
      MrCur[c] = vec4f(clampedM, select(0.0, length(clampedM) / Ms, Ms > 1e-6));
      delta = length(clampedM - oldM) / max(1.0, Ms);
    }
  }
  shMax[lane] = delta;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s /= 2u) {
    if (lane < s) { shMax[lane] = max(shMax[lane], shMax[lane + s]); }
    workgroupBarrier();
  }
  if (lane == 0u) { deltaOut[wid.x] = shMax[0]; }
}
`;

const solverPipeCache = new WeakMap();

async function getSolverPipelines(device) {
  if (solverPipeCache.has(device)) return solverPipeCache.get(device);
  const mkMod = (label, code) => device.createShaderModule({label, code});
  const bsMod = mkMod('Magneto Biot-Savart', BIOTSAVART_WGSL);
  const asMod = mkMod('Magneto assemble', MAGNETO_ASSEMBLE_WGSL);
  const pcgMod = mkMod('Magneto PCG', MAGNETO_PCG_WGSL);
  const evMod = mkMod('Magneto evalHB', MAGNETO_EVAL_WGSL);
  const nlMod = mkMod('Magneto nonlinear', MAGNETO_NONLIN_WGSL);
  for (const [name, mod] of [['biotSavart', bsMod], ['assemble', asMod], ['pcg', pcgMod], ['evalHB', evMod], ['nonlinear', nlMod]]) {
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter(m => m.type === 'error');
    if (errs.length) throw fail('SHADER_COMPILE', `Magneto ${name} WGSL: ` + errs.map(m => `L${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
  }

  const bsLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const asLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const pcgLayout = device.createBindGroupLayout({
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
  const evLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const nlLayout = device.createBindGroupLayout({
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'read-only-storage'}},
      {binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}},
      {binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });

  const pcgPL = device.createPipelineLayout({bindGroupLayouts: [pcgLayout]});
  const [
    biotSavart, assemble, evalHB, updateNonlinear,
    pcgInit, reduceInit, rbPrecond, pcgInitP, reduceInitP,
    pcgStepAp, reduceAp, pcgUpdateXR, reduceR2, pcgDotRZ, reduceRZ, pcgUpdateP
  ] = await Promise.all([
    device.createComputePipelineAsync({layout: device.createPipelineLayout({bindGroupLayouts: [bsLayout]}), compute: {module: bsMod, entryPoint: 'biotSavart'}}),
    device.createComputePipelineAsync({layout: device.createPipelineLayout({bindGroupLayouts: [asLayout]}), compute: {module: asMod, entryPoint: 'assemble'}}),
    device.createComputePipelineAsync({layout: device.createPipelineLayout({bindGroupLayouts: [evLayout]}), compute: {module: evMod, entryPoint: 'evalHB'}}),
    device.createComputePipelineAsync({layout: device.createPipelineLayout({bindGroupLayouts: [nlLayout]}), compute: {module: nlMod, entryPoint: 'updateNonlinear'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'pcgInit'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'reduceInit'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'rbPrecond'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'pcgInitP'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'reduceInitP'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'pcgStepAp'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'reduceAp'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'pcgUpdateXR'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'reduceR2'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'pcgDotRZ'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'reduceRZ'}}),
    device.createComputePipelineAsync({layout: pcgPL, compute: {module: pcgMod, entryPoint: 'pcgUpdateP'}})
  ]);

  const entry = {
    bsLayout, asLayout, pcgLayout, evLayout, nlLayout,
    biotSavart, assemble, evalHB, updateNonlinear,
    pcgInit, reduceInit, rbPrecond, pcgInitP, reduceInitP,
    pcgStepAp, reduceAp, pcgUpdateXR, reduceR2, pcgDotRZ, reduceRZ, pcgUpdateP
  };
  solverPipeCache.set(device, entry);
  return entry;
}

export async function solveMagnetoGPU(device, model, currentData, {tolerance = 1e-6, maxIterations = 600, maxOuterIterations = 16, checkCurrent, onProgress} = {}) {
  const pipes = await getSolverPipelines(device);
  const [nx, ny, nz] = model.domain.cells, count = model.domain.count;
  const [dx, dy, dz] = model.domain.spacingM;
  const wg = Math.ceil(count / 64);
  const scaleNorm = 1 / Math.cbrt(dx * dy * dz);
  const cx = 0.5 * nx * dx, cy = 0.5 * ny * dy, cz = 0.5 * nz * dz;
  const minR = 0.5 * Math.min(nx * dx, ny * dy, nz * dz);

  // Pack static material parameters
  const matArr = new Float32Array(count * 4);
  const muArr = new Float32Array(count);
  const hasSoft = model.stats.softCount > 0;
  const hasHard = model.stats.hardCount > 0;
  for (let i = 0; i < count; i++) {
    const k = model.cellKind[i];
    const kindFlag = k === CELL_KIND.SOFT ? 1 : k === CELL_KIND.HARD ? 2 : 0;
    matArr[4*i]   = model.cellMuR0[i];
    matArr[4*i+1] = model.cellMs[i];
    matArr[4*i+2] = model.cellHcj[i];
    matArr[4*i+3] = kindFlag;
    muArr[i] = Math.max(1.0, model.cellMuR0[i]);
  }

  const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const U = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  const bufs = [];
  const mkBuf = (label, size, usage) => { const b = device.createBuffer({label, size: Math.max(16, size), usage}); bufs.push(b); return b; };

  const matBuf = mkBuf('Mag mat', count * 16, S);
  const muBuf = mkBuf('Mag muR', count * 4, S);
  const mrBaseBuf = mkBuf('Mag MrBase', count * 16, S);
  const mrCurBuf = mkBuf('Mag MrCur', count * 16, S);
  const hsBuf = mkBuf('Mag Hs', count * 16, S);
  const coeffBuf = mkBuf('Mag coeffA', count * 16, S);
  const rhsBuf = mkBuf('Mag rhs', count * 4, S);
  const vecXRBuf = mkBuf('Mag vecXR', count * 16, S);
  const apBuf = mkBuf('Mag Ap', count * 4, S);
  const partialsBuf = mkBuf('Mag partials', wg * 8, S);
  const scalarsBuf = mkBuf('Mag scalars', 32, S);
  const readScalars = mkBuf('Mag readScalars', 32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const hBuf = mkBuf('Mag H', count * 16, S);
  const bBuf = mkBuf('Mag B', count * 16, S);
  const redBuf = mkBuf('Mag red', wg * 4, S);
  const readRed = mkBuf('Mag readRed', wg * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const readH = mkBuf('Mag readH', count * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const readB = mkBuf('Mag readB', count * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const readMr = mkBuf('Mag readMr', count * 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
  const readMu = mkBuf('Mag readMu', count * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

  const magCfgBuf = mkBuf('Mag cfg', 64, U);
  const pcgCfg0 = mkBuf('Mag pcg0', 32, U);
  const pcgCfg1 = mkBuf('Mag pcg1', 32, U);
  const pcgCfg2 = mkBuf('Mag pcg2', 32, U);
  const nlCfgBuf = mkBuf('Mag nlCfg', 16, U);

  try {
    device.queue.writeBuffer(matBuf, 0, matArr);
    device.queue.writeBuffer(muBuf, 0, muArr);
    device.queue.writeBuffer(mrBaseBuf, 0, model.cellMrInit);
    device.queue.writeBuffer(mrCurBuf, 0, model.cellMrInit);

    const encClear = device.createCommandEncoder();
    encClear.clearBuffer(hsBuf);
    encClear.clearBuffer(vecXRBuf);
    device.queue.submit([encClear.finish()]);

    // 1) GPU Biot-Savart for conductor currents
    if (currentData && currentData.sourceCount > 0) {
      onProgress?.('Biot-Savart');
      const cellJ = currentData.cellJ;
      const cellVol = model.cellVol;
      const srcArr = new Float32Array(currentData.sourceCount * 8);
      let s = 0;
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const c = x + nx * (y + ny * z);
        if (cellJ[4*c+3] <= 1e-6) continue;
        srcArr[8*s]   = (x + 0.5) * dx;
        srcArr[8*s+1] = (y + 0.5) * dy;
        srcArr[8*s+2] = (z + 0.5) * dz;
        srcArr[8*s+3] = cellVol;
        srcArr[8*s+4] = cellJ[4*c];
        srcArr[8*s+5] = cellJ[4*c+1];
        srcArr[8*s+6] = cellJ[4*c+2];
        srcArr[8*s+7] = 0;
        s++;
      }
      const srcBuf = mkBuf('Mag Jsrc', srcArr.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const bsCfgBuf = mkBuf('Mag bsCfg', 48, U);
      device.queue.writeBuffer(srcBuf, 0, srcArr);
      const bsBG = device.createBindGroup({
        layout: pipes.bsLayout,
        entries: [
          {binding: 0, resource: {buffer: bsCfgBuf}},
          {binding: 1, resource: {buffer: srcBuf}},
          {binding: 2, resource: {buffer: hsBuf}}
        ]
      });
      const hMean = Math.cbrt(cellVol);
      const r0sq = 0.25 * hMean * hMean;
      const chunkSize = 2048;
      for (let start = 0; start < s; start += chunkSize) {
        checkCurrent?.();
        const end = Math.min(s, start + chunkSize);
        const ab = new ArrayBuffer(48);
        new Uint32Array(ab, 0, 4).set([nx, ny, nz, count]);
        new Float32Array(ab, 16, 4).set([dx, dy, dz, r0sq]);
        new Uint32Array(ab, 32, 4).set([start, end, start === 0 ? 1 : 0, 0]);
        device.queue.writeBuffer(bsCfgBuf, 0, ab);
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipes.biotSavart);
        pass.setBindGroup(0, bsBG);
        pass.dispatchWorkgroups(wg);
        pass.end();
        device.queue.submit([enc.finish()]);
      }
      await device.queue.onSubmittedWorkDone();
    }

    // Write domain & PCG config uniforms
    const magCfg = new ArrayBuffer(64);
    new Uint32Array(magCfg, 0, 4).set([nx, ny, nz, count]);
    new Float32Array(magCfg, 16, 4).set([dx, dy, dz, scaleNorm]);
    new Float32Array(magCfg, 32, 4).set([cx, cy, cz, minR]);
    new Float32Array(magCfg, 48, 4).set([0.55, 0, 0, 0]);
    device.queue.writeBuffer(magCfgBuf, 0, magCfg);

    for (const [step, buf] of [[0, pcgCfg0], [1, pcgCfg1], [2, pcgCfg2]]) {
      const ab = new ArrayBuffer(32);
      new Uint32Array(ab, 0, 4).set([nx, ny, nz, count]);
      new Uint32Array(ab, 16, 4).set([wg, step, 0, 0]);
      device.queue.writeBuffer(buf, 0, ab);
    }

    // Bind groups
    const asBG = device.createBindGroup({
      layout: pipes.asLayout,
      entries: [
        {binding: 0, resource: {buffer: magCfgBuf}},
        {binding: 1, resource: {buffer: muBuf}},
        {binding: 2, resource: {buffer: mrCurBuf}},
        {binding: 3, resource: {buffer: hsBuf}},
        {binding: 4, resource: {buffer: coeffBuf}},
        {binding: 5, resource: {buffer: rhsBuf}}
      ]
    });
    const pcgBGs = [pcgCfg0, pcgCfg1, pcgCfg2].map(cfgB => device.createBindGroup({
      layout: pipes.pcgLayout,
      entries: [
        {binding: 0, resource: {buffer: cfgB}},
        {binding: 1, resource: {buffer: coeffBuf}},
        {binding: 2, resource: {buffer: rhsBuf}},
        {binding: 3, resource: {buffer: vecXRBuf}},
        {binding: 4, resource: {buffer: apBuf}},
        {binding: 5, resource: {buffer: partialsBuf}},
        {binding: 6, resource: {buffer: scalarsBuf}}
      ]
    }));
    const evalBG = device.createBindGroup({
      layout: pipes.evLayout,
      entries: [
        {binding: 0, resource: {buffer: magCfgBuf}},
        {binding: 1, resource: {buffer: vecXRBuf}},
        {binding: 2, resource: {buffer: muBuf}},
        {binding: 3, resource: {buffer: mrCurBuf}},
        {binding: 4, resource: {buffer: hsBuf}},
        {binding: 5, resource: {buffer: hBuf}},
        {binding: 6, resource: {buffer: bBuf}}
      ]
    });
    const nlBG = device.createBindGroup({
      layout: pipes.nlLayout,
      entries: [
        {binding: 0, resource: {buffer: nlCfgBuf}},
        {binding: 1, resource: {buffer: matBuf}},
        {binding: 2, resource: {buffer: hBuf}},
        {binding: 3, resource: {buffer: mrBaseBuf}},
        {binding: 4, resource: {buffer: muBuf}},
        {binding: 5, resource: {buffer: mrCurBuf}},
        {binding: 6, resource: {buffer: redBuf}}
      ]
    });

    async function readScalarsGPU() {
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(scalarsBuf, 0, readScalars, 0, 32);
      device.queue.submit([enc.finish()]);
      await readScalars.mapAsync(GPUMapMode.READ, 0, 32);
      const ab = readScalars.getMappedRange(0, 32);
      const f = new Float32Array(ab);
      const u = new Uint32Array(ab);
      const res = {bNorm2: f[0], rNorm2: f[1], rz: f[2], alpha: f[3], beta: f[4], pAp: f[5], converged: u[6]};
      readScalars.unmap();
      return res;
    }

    async function readReductionMax() {
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(redBuf, 0, readRed, 0, wg * 4);
      device.queue.submit([enc.finish()]);
      await readRed.mapAsync(GPUMapMode.READ, 0, wg * 4);
      const arr = new Float32Array(readRed.getMappedRange(0, wg * 4));
      let m = 0;
      for (let i = 0; i < wg; i++) if (arr[i] > m) m = arr[i];
      readRed.unmap();
      return m;
    }

    // Fully GPU-resident batched Symmetric RB-SSOR PCG (16 iterations per command submission!)
    async function solveLinearPCG(iterCap, relTol) {
      // Init pass: r = b - A*phi, bNorm2, rNorm2, z = M^-1 r, p = z, rz = r*z
      {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, pcgBGs[0]);
        pass.setPipeline(pipes.pcgInit);    pass.dispatchWorkgroups(wg);
        pass.setPipeline(pipes.reduceInit); pass.dispatchWorkgroups(1);
        pass.setPipeline(pipes.rbPrecond);
        for (let s = 0; s < 3; s++) { pass.setBindGroup(0, pcgBGs[s]); pass.dispatchWorkgroups(wg); }
        pass.setBindGroup(0, pcgBGs[0]);
        pass.setPipeline(pipes.pcgInitP);    pass.dispatchWorkgroups(wg);
        pass.setPipeline(pipes.reduceInitP); pass.dispatchWorkgroups(1);
        pass.end();
        device.queue.submit([enc.finish()]);
      }
      let sc = await readScalarsGPU();
      if (!(sc.bNorm2 > 1e-30) || sc.converged) {
        return {iterations: 0, relResidual: sc.bNorm2 > 1e-30 ? Math.sqrt(Math.max(0, sc.rNorm2) / sc.bNorm2) : 0};
      }
      const targetR2 = sc.bNorm2 * relTol * relTol;
      if (sc.rNorm2 <= targetR2) {
        return {iterations: 0, relResidual: Math.sqrt(sc.rNorm2 / sc.bNorm2)};
      }

      const batchSize = 16;
      let doneIters = 0;
      while (doneIters < iterCap) {
        checkCurrent?.();
        const steps = Math.min(batchSize, iterCap - doneIters);
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        for (let k = 0; k < steps; k++) {
          pass.setBindGroup(0, pcgBGs[0]);
          pass.setPipeline(pipes.pcgStepAp);   pass.dispatchWorkgroups(wg);
          pass.setPipeline(pipes.reduceAp);    pass.dispatchWorkgroups(1);
          pass.setPipeline(pipes.pcgUpdateXR); pass.dispatchWorkgroups(wg);
          pass.setPipeline(pipes.reduceR2);    pass.dispatchWorkgroups(1);
          pass.setPipeline(pipes.rbPrecond);
          for (let s = 0; s < 3; s++) { pass.setBindGroup(0, pcgBGs[s]); pass.dispatchWorkgroups(wg); }
          pass.setBindGroup(0, pcgBGs[0]);
          pass.setPipeline(pipes.pcgDotRZ);    pass.dispatchWorkgroups(wg);
          pass.setPipeline(pipes.reduceRZ);    pass.dispatchWorkgroups(1);
          pass.setPipeline(pipes.pcgUpdateP);  pass.dispatchWorkgroups(wg);
        }
        pass.end();
        enc.copyBufferToBuffer(scalarsBuf, 0, readScalars, 0, 32);
        device.queue.submit([enc.finish()]);

        await readScalars.mapAsync(GPUMapMode.READ, 0, 32);
        const ab = readScalars.getMappedRange(0, 32);
        const f = new Float32Array(ab), u = new Uint32Array(ab);
        sc = {bNorm2: f[0], rNorm2: f[1], rz: f[2], alpha: f[3], beta: f[4], pAp: f[5], converged: u[6]};
        readScalars.unmap();
        doneIters += steps;
        if (sc.converged || !Number.isFinite(sc.rNorm2) || sc.rNorm2 <= targetR2) break;
      }
      return {iterations: doneIters, relResidual: sc.bNorm2 > 1e-30 ? Math.sqrt(Math.max(0, sc.rNorm2) / sc.bNorm2) : 0};
    }

    // 2) Outer nonlinear loop (Frohlich-Kennelly saturation + vector hysteresis)
    const isNonlinear = hasSoft || hasHard;
    const outerLimit = isNonlinear ? maxOuterIterations : 1;
    let totalIters = 0, lastRelRes = 0, outer = 0, lastDelta = 0;

    for (outer = 1; outer <= outerLimit; outer++) {
      checkCurrent?.();
      onProgress?.(isNonlinear ? `Pass ${outer}/${outerLimit}` : 'Solving');

      {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipes.assemble); pass.setBindGroup(0, asBG); pass.dispatchWorkgroups(wg);
        pass.end();
        device.queue.submit([enc.finish()]);
      }

      const linTol = outer === outerLimit ? tolerance : Math.max(tolerance, outer <= 2 ? 1e-4 : 1e-5);
      const linRes = await solveLinearPCG(outer === 1 ? maxIterations : Math.min(maxIterations, 256), linTol);
      totalIters += linRes.iterations;
      lastRelRes = linRes.relResidual;

      {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipes.evalHB); pass.setBindGroup(0, evalBG); pass.dispatchWorkgroups(wg);
        pass.end();
        device.queue.submit([enc.finish()]);
      }

      if (!isNonlinear) break;

      const relax = outer <= 3 ? 0.50 : 0.65;
      const nlAb = new ArrayBuffer(16);
      new Uint32Array(nlAb, 0, 1).set([count]);
      new Float32Array(nlAb, 4, 3).set([relax, 0, 0]);
      device.queue.writeBuffer(nlCfgBuf, 0, nlAb);
      {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipes.updateNonlinear); pass.setBindGroup(0, nlBG); pass.dispatchWorkgroups(wg);
        pass.end();
        device.queue.submit([enc.finish()]);
      }
      lastDelta = await readReductionMax();
      if (outer >= 2 && lastDelta < 2e-3) {
        const encA = device.createCommandEncoder();
        const passA = encA.beginComputePass();
        passA.setPipeline(pipes.assemble); passA.setBindGroup(0, asBG); passA.dispatchWorkgroups(wg);
        passA.end();
        device.queue.submit([encA.finish()]);
        const finalRes = await solveLinearPCG(Math.min(maxIterations, 256), tolerance);
        totalIters += finalRes.iterations;
        lastRelRes = finalRes.relResidual;
        const encE = device.createCommandEncoder();
        const passE = encE.beginComputePass();
        passE.setPipeline(pipes.evalHB); passE.setBindGroup(0, evalBG); passE.dispatchWorkgroups(wg);
        passE.end();
        device.queue.submit([encE.finish()]);
        break;
      }
      if ((outer & 1) === 0) await new Promise(r => setTimeout(r, 0));
    }

    // 3) Read back final H, B, MrCur, muR
    const encRead = device.createCommandEncoder();
    encRead.copyBufferToBuffer(hBuf, 0, readH, 0, count * 16);
    encRead.copyBufferToBuffer(bBuf, 0, readB, 0, count * 16);
    encRead.copyBufferToBuffer(mrCurBuf, 0, readMr, 0, count * 16);
    encRead.copyBufferToBuffer(muBuf, 0, readMu, 0, count * 4);
    device.queue.submit([encRead.finish()]);

    await Promise.all([
      readH.mapAsync(GPUMapMode.READ),
      readB.mapAsync(GPUMapMode.READ),
      readMr.mapAsync(GPUMapMode.READ),
      readMu.mapAsync(GPUMapMode.READ)
    ]);
    const H = Float32Array.from(new Float32Array(readH.getMappedRange()));
    const B = Float32Array.from(new Float32Array(readB.getMappedRange()));
    const Mr = Float32Array.from(new Float32Array(readMr.getMappedRange()));
    const muR = Float32Array.from(new Float32Array(readMu.getMappedRange()));
    readH.unmap(); readB.unmap(); readMr.unmap(); readMu.unmap();

    return {H, B, Mr, muR, iterations: totalIters, outerIterations: outer, relResidual: lastRelRes, nonlinearDelta: lastDelta};
  } finally {
    for (const b of bufs) b.destroy();
  }
}

// ---------- CPU Reference Nonlinear Magnetostatic Solver (Exact Same Discretization for Node Unit Tests) ----------

export function solveMagnetoCPU(model, currentData = null, {tolerance = 1e-6, maxIterations = 500, maxOuterIterations = 16} = {}) {
  const [nx, ny, nz] = model.domain.cells, count = model.domain.count;
  const [dx, dy, dz] = model.domain.spacingM;
  const cellVol = model.cellVol;
  const scaleNorm = 1 / Math.cbrt(cellVol);
  const Ax = dy * dz, Ay = dx * dz, Az = dx * dy;
  const cx = 0.5 * nx * dx, cy = 0.5 * ny * dy, cz = 0.5 * nz * dz;
  const minR = 0.5 * Math.min(nx * dx, ny * dy, nz * dz);
  const idx3 = (x, y, z) => x + nx * (y + ny * z);
  const harm = (a, b) => (2 * a * b) / Math.max(1e-12, a + b);
  const fMr = (mA, mB, rA, rB) => (mB * rA + mA * rB) / Math.max(1e-12, mA + mB);

  // 1) Biot-Savart Hs
  const Hs = new Float32Array(count * 4);
  if (currentData && currentData.sourceCount > 0) {
    const cellJ = currentData.cellJ;
    const srcs = [];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      if (cellJ[4*c+3] > 1e-6) srcs.push([(x + 0.5)*dx, (y + 0.5)*dy, (z + 0.5)*dz, cellJ[4*c], cellJ[4*c+1], cellJ[4*c+2]]);
    }
    const hMean = Math.cbrt(cellVol), r0sq = 0.25 * hMean * hMean;
    const kBS = cellVol * INV_4PI;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      const px = (x + 0.5)*dx, py = (y + 0.5)*dy, pz = (z + 0.5)*dz;
      let hx = 0, hy = 0, hz = 0;
      for (let s = 0; s < srcs.length; s++) {
        const sp = srcs[s];
        const rx = px - sp[0], ry = py - sp[1], rz = pz - sp[2];
        const r2 = rx*rx + ry*ry + rz*rz + r0sq;
        const invR3 = kBS / (r2 * Math.sqrt(r2));
        hx += (sp[4]*rz - sp[5]*ry) * invR3;
        hy += (sp[5]*rx - sp[3]*rz) * invR3;
        hz += (sp[3]*ry - sp[4]*rx) * invR3;
      }
      Hs[4*c] = hx; Hs[4*c+1] = hy; Hs[4*c+2] = hz; Hs[4*c+3] = Math.hypot(hx, hy, hz);
    }
  }

  const muR = Float32Array.from(model.cellMuR0, v => Math.max(1.0, v));
  const MrBase = Float32Array.from(model.cellMrInit);
  const MrCur = Float32Array.from(model.cellMrInit);
  const phi = new Float64Array(count);
  const cxp = new Float64Array(count), cyp = new Float64Array(count), czp = new Float64Array(count), diag = new Float64Array(count);
  const rhs = new Float64Array(count);
  const H = new Float32Array(count * 4), B = new Float32Array(count * 4);

  const robinCoeff = (fx, fy, fz, nxn, nyn, nzn, muC, dAxis, area) => {
    const rx = fx - cx, ry = fy - cy, rz = fz - cz;
    const R = Math.max(minR, Math.hypot(rx, ry, rz));
    const cosT = Math.max(0.15, (rx*nxn + ry*nyn + rz*nzn) / R);
    const kRob = (2 * cosT) / R;
    return (muC * area / (0.5 * dAxis + 1 / kRob)) * scaleNorm;
  };
  const robinGrad = (fx, fy, fz, nxn, nyn, nzn, pC, dAxis) => {
    const rx = fx - cx, ry = fy - cy, rz = fz - cz;
    const R = Math.max(minR, Math.hypot(rx, ry, rz));
    const cosT = Math.max(0.15, (rx*nxn + ry*nyn + rz*nzn) / R);
    return pC / (0.5 * dAxis + R / (2 * cosT));
  };

  function assemble() {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      const muC = muR[c], px = (x + 0.5)*dx, py = (y + 0.5)*dy, pz = (z + 0.5)*dz;
      const mrx = MrCur[4*c], mry = MrCur[4*c+1], mrz = MrCur[4*c+2];
      const hsx = Hs[4*c], hsy = Hs[4*c+1], hsz = Hs[4*c+2];
      let d = 0, out = 0;
      cxp[c] = 0; cyp[c] = 0; czp[c] = 0;

      if (x > 0) { const nb = idx3(x-1,y,z), mf = harm(muC, muR[nb]); d += (mf*Ax/dx)*scaleNorm; out -= (mf*0.5*(hsx+Hs[4*nb]) + fMr(muR[nb],muC,MrCur[4*nb],mrx))*Ax*scaleNorm; }
      else { d += robinCoeff(px-0.5*dx,py,pz,-1,0,0,muC,dx,Ax); out -= (muC*hsx + mrx)*Ax*scaleNorm; }
      if (x+1 < nx) { const nb = idx3(x+1,y,z), mf = harm(muC, muR[nb]); cxp[c] = (mf*Ax/dx)*scaleNorm; d += cxp[c]; out += (mf*0.5*(hsx+Hs[4*nb]) + fMr(muC,muR[nb],mrx,MrCur[4*nb]))*Ax*scaleNorm; }
      else { d += robinCoeff(px+0.5*dx,py,pz,1,0,0,muC,dx,Ax); out += (muC*hsx + mrx)*Ax*scaleNorm; }

      if (y > 0) { const nb = idx3(x,y-1,z), mf = harm(muC, muR[nb]); d += (mf*Ay/dy)*scaleNorm; out -= (mf*0.5*(hsy+Hs[4*nb+1]) + fMr(muR[nb],muC,MrCur[4*nb+1],mry))*Ay*scaleNorm; }
      else { d += robinCoeff(px,py-0.5*dy,pz,0,-1,0,muC,dy,Ay); out -= (muC*hsy + mry)*Ay*scaleNorm; }
      if (y+1 < ny) { const nb = idx3(x,y+1,z), mf = harm(muC, muR[nb]); cyp[c] = (mf*Ay/dy)*scaleNorm; d += cyp[c]; out += (mf*0.5*(hsy+Hs[4*nb+1]) + fMr(muC,muR[nb],mry,MrCur[4*nb+1]))*Ay*scaleNorm; }
      else { d += robinCoeff(px,py+0.5*dy,pz,0,1,0,muC,dy,Ay); out += (muC*hsy + mry)*Ay*scaleNorm; }

      if (z > 0) { const nb = idx3(x,y,z-1), mf = harm(muC, muR[nb]); d += (mf*Az/dz)*scaleNorm; out -= (mf*0.5*(hsz+Hs[4*nb+2]) + fMr(muR[nb],muC,MrCur[4*nb+2],mrz))*Az*scaleNorm; }
      else { d += robinCoeff(px,py,pz-0.5*dz,0,0,-1,muC,dz,Az); out -= (muC*hsz + mrz)*Az*scaleNorm; }
      if (z+1 < nz) { const nb = idx3(x,y,z+1), mf = harm(muC, muR[nb]); czp[c] = (mf*Az/dz)*scaleNorm; d += czp[c]; out += (mf*0.5*(hsz+Hs[4*nb+2]) + fMr(muC,muR[nb],mrz,MrCur[4*nb+2]))*Az*scaleNorm; }
      else { d += robinCoeff(px,py,pz+0.5*dz,0,0,1,muC,dz,Az); out += (muC*hsz + mrz)*Az*scaleNorm; }

      diag[c] = Math.max(1e-12, d);
      rhs[c] = -out;
    }
  }

  function applyA(inp, out) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      let v = diag[c] * inp[c];
      if (x > 0) { const nb = idx3(x-1,y,z); v -= cxp[nb] * inp[nb]; }
      if (x+1 < nx) { const nb = idx3(x+1,y,z); v -= cxp[c] * inp[nb]; }
      if (y > 0) { const nb = idx3(x,y-1,z); v -= cyp[nb] * inp[nb]; }
      if (y+1 < ny) { const nb = idx3(x,y+1,z); v -= cyp[c] * inp[nb]; }
      if (z > 0) { const nb = idx3(x,y,z-1); v -= czp[nb] * inp[nb]; }
      if (z+1 < nz) { const nb = idx3(x,y,z+1); v -= czp[c] * inp[nb]; }
      out[c] = v;
    }
  }

  function rbPrecond(rVec, zVec) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (((x + y + z) & 1) !== 0) continue;
      const c = idx3(x, y, z); zVec[c] = rVec[c] / diag[c];
    }
    for (let parity of [1, 0]) {
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        if (((x + y + z) & 1) !== parity) continue;
        const c = idx3(x, y, z);
        let s = rVec[c];
        if (x > 0) { const nb = idx3(x-1,y,z); s += cxp[nb] * zVec[nb]; }
        if (x+1 < nx) { const nb = idx3(x+1,y,z); s += cxp[c] * zVec[nb]; }
        if (y > 0) { const nb = idx3(x,y-1,z); s += cyp[nb] * zVec[nb]; }
        if (y+1 < ny) { const nb = idx3(x,y+1,z); s += cyp[c] * zVec[nb]; }
        if (z > 0) { const nb = idx3(x,y,z-1); s += czp[nb] * zVec[nb]; }
        if (z+1 < nz) { const nb = idx3(x,y,z+1); s += czp[c] * zVec[nb]; }
        zVec[c] = s / diag[c];
      }
    }
  }

  const r = new Float64Array(count), zv = new Float64Array(count), p = new Float64Array(count), Ap = new Float64Array(count);
  function solvePCG(iterCap, relTol) {
    let b2 = 0;
    for (let i = 0; i < count; i++) b2 += rhs[i] * rhs[i];
    if (b2 < 1e-30) return {iterations: 0, relResidual: 0};
    applyA(phi, Ap);
    let r2 = 0;
    for (let i = 0; i < count; i++) { r[i] = rhs[i] - Ap[i]; r2 += r[i] * r[i]; }
    const tol2 = b2 * relTol * relTol;
    if (r2 <= tol2) return {iterations: 0, relResidual: Math.sqrt(r2 / b2)};
    rbPrecond(r, zv);
    let rz = 0;
    for (let i = 0; i < count; i++) { p[i] = zv[i]; rz += r[i] * zv[i]; }
    let it = 0;
    for (it = 1; it <= iterCap; it++) {
      applyA(p, Ap);
      let pAp = 0;
      for (let i = 0; i < count; i++) pAp += p[i] * Ap[i];
      if (pAp <= 1e-30) break;
      const alpha = rz / pAp;
      r2 = 0;
      for (let i = 0; i < count; i++) { phi[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; r2 += r[i] * r[i]; }
      if (r2 <= tol2) break;
      rbPrecond(r, zv);
      let rzNew = 0;
      for (let i = 0; i < count; i++) rzNew += r[i] * zv[i];
      const beta = rzNew / Math.max(1e-30, rz);
      rz = rzNew;
      for (let i = 0; i < count; i++) p[i] = zv[i] + beta * p[i];
    }
    return {iterations: it, relResidual: Math.sqrt(Math.max(0, r2) / b2)};
  }

  function evalHB() {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      const muC = muR[c], pC = phi[c], px = (x + 0.5)*dx, py = (y + 0.5)*dy, pz = (z + 0.5)*dz;
      const mrx = MrCur[4*c], mry = MrCur[4*c+1], mrz = MrCur[4*c+2];
      const hsx = Hs[4*c], hsy = Hs[4*c+1], hsz = Hs[4*c+2];

      const bxm = x > 0 ? (harm(muR[idx3(x-1,y,z)], muC)*(0.5*(Hs[4*idx3(x-1,y,z)]+hsx)-(pC-phi[idx3(x-1,y,z)])/dx) + fMr(muR[idx3(x-1,y,z)],muC,MrCur[4*idx3(x-1,y,z)],mrx))
                        : (muC*(hsx - robinGrad(px-0.5*dx,py,pz,-1,0,0,pC,dx)) + mrx);
      const bxp = x+1 < nx ? (harm(muC, muR[idx3(x+1,y,z)])*(0.5*(hsx+Hs[4*idx3(x+1,y,z)])-(phi[idx3(x+1,y,z)]-pC)/dx) + fMr(muC,muR[idx3(x+1,y,z)],mrx,MrCur[4*idx3(x+1,y,z)]))
                           : (muC*(hsx + robinGrad(px+0.5*dx,py,pz,1,0,0,pC,dx)) + mrx);
      const bym = y > 0 ? (harm(muR[idx3(x,y-1,z)], muC)*(0.5*(Hs[4*idx3(x,y-1,z)+1]+hsy)-(pC-phi[idx3(x,y-1,z)])/dy) + fMr(muR[idx3(x,y-1,z)],muC,MrCur[4*idx3(x,y-1,z)+1],mry))
                        : (muC*(hsy - robinGrad(px,py-0.5*dy,pz,0,-1,0,pC,dy)) + mry);
      const byp = y+1 < ny ? (harm(muC, muR[idx3(x,y+1,z)])*(0.5*(hsy+Hs[4*idx3(x,y+1,z)+1])-(phi[idx3(x,y+1,z)]-pC)/dy) + fMr(muC,muR[idx3(x,y+1,z)],mry,MrCur[4*idx3(x,y+1,z)+1]))
                           : (muC*(hsy + robinGrad(px,py+0.5*dy,pz,0,1,0,pC,dy)) + mry);
      const bzm = z > 0 ? (harm(muR[idx3(x,y,z-1)], muC)*(0.5*(Hs[4*idx3(x,y,z-1)+2]+hsz)-(pC-phi[idx3(x,y,z-1)])/dz) + fMr(muR[idx3(x,y,z-1)],muC,MrCur[4*idx3(x,y,z-1)+2],mrz))
                        : (muC*(hsz - robinGrad(px,py,pz-0.5*dz,0,0,-1,pC,dz)) + mrz);
      const bzp = z+1 < nz ? (harm(muC, muR[idx3(x,y,z+1)])*(0.5*(hsz+Hs[4*idx3(x,y,z+1)+2])-(phi[idx3(x,y,z+1)]-pC)/dz) + fMr(muC,muR[idx3(x,y,z+1)],mrz,MrCur[4*idx3(x,y,z+1)+2]))
                           : (muC*(hsz + robinGrad(px,py,pz+0.5*dz,0,0,1,pC,dz)) + mrz);

      const bx = 0.5*(bxm+bxp), by = 0.5*(bym+byp), bz = 0.5*(bzm+bzp);
      const hx = (bx - mrx) / muC, hy = (by - mry) / muC, hz = (bz - mrz) / muC;
      H[4*c] = hx; H[4*c+1] = hy; H[4*c+2] = hz; H[4*c+3] = Math.hypot(hx, hy, hz);
      B[4*c] = bx*MU0; B[4*c+1] = by*MU0; B[4*c+2] = bz*MU0; B[4*c+3] = Math.hypot(bx, by, bz)*MU0;
    }
  }

  const isNonlin = model.stats.softCount > 0 || model.stats.hardCount > 0;
  const outerLimit = isNonlin ? maxOuterIterations : 1;
  let totalIters = 0, lastRelRes = 0, outer = 0, lastDelta = 0;

  for (outer = 1; outer <= outerLimit; outer++) {
    assemble();
    const res = solvePCG(outer === 1 ? maxIterations : Math.min(maxIterations, 250), outer === outerLimit ? tolerance : Math.max(tolerance, 1e-5));
    totalIters += res.iterations; lastRelRes = res.relResidual;
    evalHB();
    if (!isNonlin) break;
    const relax = outer <= 3 ? 0.50 : 0.65;
    let maxD = 0;
    for (let c = 0; c < count; c++) {
      const k = model.cellKind[c];
      if (k === CELL_KIND.SOFT) {
        const target = softMuR(H[4*c+3], model.cellMuR0[c], model.cellMs[c]);
        const next = muR[c] + relax * (target - muR[c]);
        const d = Math.abs(next - muR[c]) / Math.max(1, muR[c]);
        if (d > maxD) maxD = d;
        muR[c] = next;
      } else if (k === CELL_KIND.HARD) {
        const Ms = model.cellMs[c], Hcj = model.cellHcj[c];
        const target = evaluateHysteresisMr([MrBase[4*c], MrBase[4*c+1], MrBase[4*c+2]], [H[4*c], H[4*c+1], H[4*c+2]], Ms, Hcj);
        const effRelax = Math.min(relax, 1 / (1 + 0.40 * (Hcj > 1e-6 ? Ms / Hcj : 0)));
        let nx0 = MrCur[4*c]   + effRelax * (target[0] - MrCur[4*c]);
        let ny0 = MrCur[4*c+1] + effRelax * (target[1] - MrCur[4*c+1]);
        let nz0 = MrCur[4*c+2] + effRelax * (target[2] - MrCur[4*c+2]);
        const nm = Math.hypot(nx0, ny0, nz0);
        if (Ms > 1e-6 && nm > Ms) { const s = Ms / nm; nx0 *= s; ny0 *= s; nz0 *= s; }
        const d = Math.hypot(nx0 - MrCur[4*c], ny0 - MrCur[4*c+1], nz0 - MrCur[4*c+2]) / Math.max(1, Ms);
        if (d > maxD) maxD = d;
        MrCur[4*c] = nx0; MrCur[4*c+1] = ny0; MrCur[4*c+2] = nz0; MrCur[4*c+3] = Ms > 1e-6 ? Math.hypot(nx0, ny0, nz0) / Ms : 0;
      }
    }
    lastDelta = maxD;
    if (outer >= 2 && maxD < 2e-3) {
      assemble();
      const fr = solvePCG(Math.min(maxIterations, 250), tolerance);
      totalIters += fr.iterations; lastRelRes = fr.relResidual;
      evalHB();
      break;
    }
  }
  return {H, B, Mr: MrCur, muR, iterations: totalIters, outerIterations: outer, relResidual: lastRelRes, nonlinearDelta: lastDelta};
}

// ---------- Post-Processing: M, Saturation, Energy, Maxwell Stress & Lorentz Force/Torque, Probes ----------

export function evaluateMagnetoFields(model, sol, currentData = null, probes = model.probes || []) {
  const {domain, cellKind, cellBodyIdx, cellMs, cellVol, bodies} = model;
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const [dx, dy, dz] = domain.spacingM;
  const {H, B, Mr, muR} = sol;
  const cellJ = currentData?.cellJ || null;

  const M = new Float32Array(count * 4);
  const sat = new Float32Array(count);

  let maxBT = 0, maxSolidBT = 0, maxHAm = 0, maxMAm = 0, peakSatPct = 0, energyJ = 0;

  for (let i = 0; i < count; i++) {
    const bx = B[4*i], by = B[4*i+1], bz = B[4*i+2], bm = B[4*i+3];
    const hx = H[4*i], hy = H[4*i+1], hz = H[4*i+2], hm = H[4*i+3];
    const k = cellKind[i];
    let mx = 0, my = 0, mz = 0, mm = 0, sVal = 0;
    if (k === CELL_KIND.SOFT || k === CELL_KIND.HARD) {
      mx = bx * INV_MU0 - hx;
      my = by * INV_MU0 - hy;
      mz = bz * INV_MU0 - hz;
      mm = Math.hypot(mx, my, mz);
      const Ms = cellMs[i];
      if (Ms > 1e-6) {
        if (k === CELL_KIND.HARD) {
          const mrMag = Math.hypot(Mr[4*i], Mr[4*i+1], Mr[4*i+2]);
          sVal = clamp(mrMag / Ms, 0, 1);
        } else {
          sVal = clamp(mm / Ms, 0, 1);
        }
      }
    }
    M[4*i] = mx; M[4*i+1] = my; M[4*i+2] = mz; M[4*i+3] = mm;
    sat[i] = sVal;

    if (bm > maxBT) maxBT = bm;
    if (k !== CELL_KIND.AIR && bm > maxSolidBT) maxSolidBT = bm;
    if (hm > maxHAm) maxHAm = hm;
    if (mm > maxMAm) maxMAm = mm;
    if (k === CELL_KIND.SOFT && sVal * 100 > peakSatPct) peakSatPct = sVal * 100;
    energyJ += 0.5 * MU0 * Math.max(1.0, muR[i]) * (hx*hx + hy*hy + hz*hz) * cellVol;
  }

  // Per-body Force (N) and Torque (N*m) about each body's native pivot
  const idx3 = (x, y, z) => x + nx * (y + ny * z);
  const faceDirs = [
    {axis: 0, sign: -1, ox: -1, oy: 0, oz: 0, area: dy * dz},
    {axis: 0, sign:  1, ox:  1, oy: 0, oz: 0, area: dy * dz},
    {axis: 1, sign: -1, ox:  0, oy: -1, oz: 0, area: dx * dz},
    {axis: 1, sign:  1, ox:  0, oy:  1, oz: 0, area: dx * dz},
    {axis: 2, sign: -1, ox:  0, oy: 0, oz: -1, area: dx * dy},
    {axis: 2, sign:  1, ox:  0, oy: 0, oz:  1, area: dx * dy}
  ];

  // Precompute which AIR cells are strictly free (no face-neighbor belonging to two distinct bodies)
  const airSingleBody = new Int16Array(count).fill(-2); // -2=none, >=0=sole adjacent body, -1=shared/contested
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = idx3(x, y, z);
    if (cellKind[c] !== CELL_KIND.AIR) continue;
    let sole = -2;
    for (const fd of faceDirs) {
      const xx = x + fd.ox, yy = y + fd.oy, zz = z + fd.oz;
      if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz) continue;
      const nb = idx3(xx, yy, zz);
      const bi = cellBodyIdx[nb];
      if (bi >= 0) {
        if (sole === -2) sole = bi;
        else if (sole !== bi) { sole = -1; break; }
      }
    }
    airSingleBody[c] = sole;
  }

  const bodyResults = [];
  const totalForceN = [0, 0, 0];
  const totalTorqueNm = [0, 0, 0];

  for (const b of bodies) {
    const bIdx = b.index;
    const pivotM = scale3(b.pivotWorldMm, MM_TO_M);
    let fW = [0, 0, 0], tW = [0, 0, 0];
    let bMaxBT = 0, bMaxSat = 0, mrSum = 0, mrCells = 0;
    const mrMeanGrid = [0, 0, 0];

    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      if (cellBodyIdx[c] !== bIdx) continue;
      if (B[4*c+3] > bMaxBT) bMaxBT = B[4*c+3];
      if (sat[c] * 100 > bMaxSat) bMaxSat = sat[c] * 100;
      if (b.kindCode === CELL_KIND.HARD) {
        mrMeanGrid[0] += Mr[4*c]; mrMeanGrid[1] += Mr[4*c+1]; mrMeanGrid[2] += Mr[4*c+2];
        mrSum += Math.hypot(Mr[4*c], Mr[4*c+1], Mr[4*c+2]);
        mrCells++;
      }
      if (b.kindCode === CELL_KIND.CONDUCTOR && cellJ) {
        const jx = cellJ[4*c], jy = cellJ[4*c+1], jz = cellJ[4*c+2];
        if (Math.abs(jx) + Math.abs(jy) + Math.abs(jz) > 1e-9) {
          const bx = B[4*c], by = B[4*c+1], bz = B[4*c+2];
          const dfG = [(jy*bz - jz*by)*cellVol, (jz*bx - jx*bz)*cellVol, (jx*by - jy*bx)*cellVol];
          const dfW = gridVecToWorld(domain, dfG);
          fW[0] += dfW[0]; fW[1] += dfW[1]; fW[2] += dfW[2];
          const rM = sub3(scale3(gridPointToWorldMm(domain, x + 0.5, y + 0.5, z + 0.5), MM_TO_M), pivotM);
          const dtW = cross3(rM, dfW);
          tW[0] += dtW[0]; tW[1] += dtW[1]; tW[2] += dtW[2];
        }
      }
    }

    if (b.kindCode !== CELL_KIND.CONDUCTOR) {
      // Maxwell Stress Tensor on air-dilated integration shell around body b
      const inShell = c => cellBodyIdx[c] === bIdx || airSingleBody[c] === bIdx;
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const c = idx3(x, y, z);
        if (!inShell(c)) continue;
        for (const fd of faceDirs) {
          const xx = x + fd.ox, yy = y + fd.oy, zz = z + fd.oz;
          const insideDom = xx >= 0 && xx < nx && yy >= 0 && yy < ny && zz >= 0 && zz < nz;
          if (insideDom && inShell(idx3(xx, yy, zz))) continue;

          // Evaluate air-side face B vector
          let bfx, bfy, bfz;
          if (insideDom) {
            const nb = idx3(xx, yy, zz);
            if (cellKind[c] === CELL_KIND.AIR && cellKind[nb] === CELL_KIND.AIR) {
              bfx = 0.5 * (B[4*c] + B[4*nb]);
              bfy = 0.5 * (B[4*c+1] + B[4*nb+1]);
              bfz = 0.5 * (B[4*c+2] + B[4*nb+2]);
            } else if (cellKind[nb] === CELL_KIND.AIR || cellKind[nb] === CELL_KIND.CONDUCTOR) {
              // Continuous normal B from face average, smooth tangential B on air side
              bfx = B[4*nb]; bfy = B[4*nb+1]; bfz = B[4*nb+2];
              if (fd.axis === 0) bfx = 0.5 * (B[4*c] + B[4*nb]);
              else if (fd.axis === 1) bfy = 0.5 * (B[4*c+1] + B[4*nb+1]);
              else bfz = 0.5 * (B[4*c+2] + B[4*nb+2]);
            } else {
              bfx = 0.5 * (B[4*c] + B[4*nb]);
              bfy = 0.5 * (B[4*c+1] + B[4*nb+1]);
              bfz = 0.5 * (B[4*c+2] + B[4*nb+2]);
            }
          } else {
            bfx = B[4*c]; bfy = B[4*c+1]; bfz = B[4*c+2];
          }

          const bn = (fd.axis === 0 ? bfx : fd.axis === 1 ? bfy : bfz) * fd.sign;
          const b2half = 0.5 * (bfx*bfx + bfy*bfy + bfz*bfz);
          const kA = fd.area * INV_MU0;
          const tx = (bn * bfx - (fd.axis === 0 ? b2half * fd.sign : 0)) * kA;
          const ty = (bn * bfy - (fd.axis === 1 ? b2half * fd.sign : 0)) * kA;
          const tz = (bn * bfz - (fd.axis === 2 ? b2half * fd.sign : 0)) * kA;
          const dfW = gridVecToWorld(domain, [tx, ty, tz]);
          fW[0] += dfW[0]; fW[1] += dfW[1]; fW[2] += dfW[2];
          const rM = sub3(scale3(gridPointToWorldMm(domain, x + 0.5 + 0.5*fd.ox, y + 0.5 + 0.5*fd.oy, z + 0.5 + 0.5*fd.oz), MM_TO_M), pivotM);
          const dtW = cross3(rM, dfW);
          tW[0] += dtW[0]; tW[1] += dtW[1]; tW[2] += dtW[2];
        }
      }
    }

    totalForceN[0] += fW[0]; totalForceN[1] += fW[1]; totalForceN[2] += fW[2];
    totalTorqueNm[0] += tW[0]; totalTorqueNm[1] += tW[1]; totalTorqueNm[2] += tW[2];
    const meanMrW = mrCells > 0 ? gridVecToWorld(domain, scale3(mrMeanGrid, 1 / mrCells)) : [0, 0, 0];
    bodyResults.push({
      hash: b.hash, name: b.name, material: b.material.name, kind: b.material.kind,
      forceN: fW, forceMagN: len3(fW),
      torqueNm: tW, torqueMagNm: len3(tW),
      maxBT: bMaxBT, maxSatPct: bMaxSat,
      meanMrWorld: meanMrW,
      meanMrFraction: mrCells > 0 && b.material.Ms > 1e-6 ? (mrSum / mrCells) / b.material.Ms : null
    });
  }

  const probeReadings = probes.map(p => samplePointReading(model, B, H, M, sat, p.worldMm, p));

  return {
    H, B, Mr, muR, M, sat,
    cellJ,
    maxBT, maxSolidBT, maxHAm, maxMAm, peakSatPct, energyJ,
    bodies: bodyResults,
    totalForceN, totalForceMagN: len3(totalForceN),
    totalTorqueNm, totalTorqueMagNm: len3(totalTorqueNm),
    probes: probeReadings,
    currentPlanes: currentData?.planeResults || []
  };
}

export function samplePointReading(model, B, H, M, sat, worldMm, meta = {}) {
  const d = model.domain, [nx, ny, nz] = d.cells;
  const g = worldMmToGrid(d, worldMm);
  if (g[0] < 0 || g[0] > nx || g[1] < 0 || g[1] > ny || g[2] < 0 || g[2] > nz) {
    return {...meta, inside: false, BT: null, BmT: null, BVecmT: null, HAm: null, HkAm: null, MAm: null, satPct: null, region: 'Outside'};
  }
  const ix = clamp(Math.floor(g[0]), 0, nx - 1);
  const iy = clamp(Math.floor(g[1]), 0, ny - 1);
  const iz = clamp(Math.floor(g[2]), 0, nz - 1);
  const c = ix + nx * (iy + ny * iz);
  const kind = model.cellKind[c];

  // Trilinear interpolation within same medium class (air vs solid) for smooth Probe readings
  const fx = clamp(g[0] - 0.5, 0, nx - 1.0001);
  const fy = clamp(g[1] - 0.5, 0, ny - 1.0001);
  const fz = clamp(g[2] - 0.5, 0, nz - 1.0001);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), z1 = Math.min(z0 + 1, nz - 1);
  const tx = fx - x0, ty = fy - y0, tz = fz - z0;
  let wSum = 0;
  const bG = [0, 0, 0], hG = [0, 0, 0], mG = [0, 0, 0];
  let sSum = 0;
  for (let dz = 0; dz < 2; dz++) {
    const wz = dz ? tz : 1 - tz, cz = dz ? z1 : z0;
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy ? ty : 1 - ty, cy = dy ? y1 : y0;
      for (let dx = 0; dx < 2; dx++) {
        const wx = dx ? tx : 1 - tx, cx = dx ? x1 : x0;
        const ci = cx + nx * (cy + ny * cz);
        if (model.cellKind[ci] !== kind) continue;
        const w = wx * wy * wz;
        wSum += w;
        bG[0] += w * B[4*ci]; bG[1] += w * B[4*ci+1]; bG[2] += w * B[4*ci+2];
        hG[0] += w * H[4*ci]; hG[1] += w * H[4*ci+1]; hG[2] += w * H[4*ci+2];
        if (M) { mG[0] += w * M[4*ci]; mG[1] += w * M[4*ci+1]; mG[2] += w * M[4*ci+2]; }
        if (sat) sSum += w * sat[ci];
      }
    }
  }
  const inv = wSum > 0 ? 1 / wSum : 1;
  const bvG = wSum > 0 ? scale3(bG, inv) : [B[4*c], B[4*c+1], B[4*c+2]];
  const hvG = wSum > 0 ? scale3(hG, inv) : [H[4*c], H[4*c+1], H[4*c+2]];
  const mvG = wSum > 0 && M ? scale3(mG, inv) : (M ? [M[4*c], M[4*c+1], M[4*c+2]] : [0, 0, 0]);
  const bW = gridVecToWorld(d, bvG);
  const hW = gridVecToWorld(d, hvG);
  const BT = len3(bW);
  const HAm = len3(hW);
  const MAm = len3(mvG);
  const satPct = (wSum > 0 && sat ? sSum * inv : (sat ? sat[c] : 0)) * 100;
  const bi = model.cellBodyIdx[c];
  const body = bi >= 0 ? model.bodies[bi] : null;
  const region = body ? body.material.name : 'Air';
  return {
    ...meta, inside: true, kind, region, role: ROLE_LABELS[kind] || region,
    BT, BVecT: bW, BmT: BT * 1000, BVecmT: scale3(bW, 1000),
    HAm, HkAm: HAm * 1e-3, MAm, satPct
  };
}

// ---------- GPU 3D Field Textures, Voxel Shell (with N/S Poles), Field Strokes & Interactive Slice ----------

function packFieldTextures(model, ev) {
  const [nx, ny, nz] = model.domain.cells, count = model.domain.count;
  const bScale = Math.max(1e-6, ev.maxBT);
  const hScale = Math.max(1e-3, ev.maxHAm);
  const mScale = Math.max(1e-3, ev.maxMAm);

  // 2-pass solid dilation so smooth mesh trilinear lookup never bleeds air values across curved faces
  const sB = new Float32Array(count), sH = new Float32Array(count), sM = new Float32Array(count), sS = new Float32Array(count);
  const sValid = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (model.cellKind[i] !== CELL_KIND.AIR) {
      sB[i] = clamp(ev.B[4*i+3] / bScale, 0, 1);
      sH[i] = clamp(ev.H[4*i+3] / hScale, 0, 1);
      sM[i] = clamp(ev.M[4*i+3] / mScale, 0, 1);
      sS[i] = clamp(ev.sat[i], 0, 1);
      sValid[i] = 1;
    }
  }
  const idx3 = (x, y, z) => x + nx * (y + ny * z);
  const dirs6 = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
  for (let pass = 0; pass < 2; pass++) {
    const nB = Float32Array.from(sB), nH = Float32Array.from(sH), nM = Float32Array.from(sM), nS = Float32Array.from(sS), nV = Uint8Array.from(sValid);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const c = idx3(x, y, z);
      if (sValid[c]) continue;
      let aB = 0, aH = 0, aM = 0, aS = 0, n = 0;
      for (const [ox, oy, oz] of dirs6) {
        const xx = x+ox, yy = y+oy, zz = z+oz;
        if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz) continue;
        const j = idx3(xx, yy, zz);
        if (sValid[j]) { aB += sB[j]; aH += sH[j]; aM += sM[j]; aS += sS[j]; n++; }
      }
      if (n > 0) { nB[c] = aB/n; nH[c] = aH/n; nM[c] = aM/n; nS[c] = aS/n; nV[c] = 1; }
    }
    sB.set(nB); sH.set(nH); sM.set(nM); sS.set(nS); sValid.set(nV);
  }

  const solidTex = new Uint16Array(count * 4);
  const fieldTex = new Uint16Array(count * 4);
  const oneH = f32ToF16(1.0), zeroH = f32ToF16(0.0);
  for (let i = 0; i < count; i++) {
    const isSolid = model.cellKind[i] !== CELL_KIND.AIR;
    solidTex[4*i]   = f32ToF16(sB[i]);
    solidTex[4*i+1] = f32ToF16(sH[i]);
    solidTex[4*i+2] = f32ToF16(sM[i]);
    solidTex[4*i+3] = f32ToF16(sS[i]);

    // Log-compressed sqrt scaling for air slice so dipole falloff remains clearly visible across decades
    const bn = clamp(Math.pow(ev.B[4*i+3] / bScale, 0.55), 0, 1);
    const hn = clamp(Math.pow(ev.H[4*i+3] / hScale, 0.55), 0, 1);
    fieldTex[4*i]   = f32ToF16(bn);
    fieldTex[4*i+1] = f32ToF16(hn);
    fieldTex[4*i+2] = isSolid ? oneH : zeroH;
    fieldTex[4*i+3] = f32ToF16(ev.sat[i]);
  }
  return {solidTex, fieldTex, bScale, hScale, mScale};
}

function magColorRGB(t, palette = 0) {
  const u = clamp(t, 0, 1);
  // 0: Magnetic B/H spectrum (deep indigo -> cyan -> emerald -> amber -> cream)
  // 1: Magnetization M spectrum (dark plum -> violet -> magenta -> cyan-white)
  // 2: Saturation spectrum (steel blue -> teal -> amber -> crimson red)
  const palettes = [
    [[0.00, 0.09, 0.08, 0.24], [0.25, 0.14, 0.34, 0.64], [0.50, 0.14, 0.68, 0.66], [0.76, 0.90, 0.74, 0.18], [1.00, 1.00, 0.96, 0.78]],
    [[0.00, 0.10, 0.06, 0.18], [0.30, 0.42, 0.18, 0.62], [0.65, 0.80, 0.32, 0.68], [1.00, 0.96, 0.86, 1.00]],
    [[0.00, 0.24, 0.34, 0.48], [0.40, 0.18, 0.62, 0.62], [0.75, 0.94, 0.68, 0.16], [0.95, 0.92, 0.22, 0.18], [1.00, 1.00, 0.18, 0.24]]
  ];
  const stops = palettes[palette] || palettes[0];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i+1];
    if (u <= b[0]) {
      const f = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return [a[1] + f*(b[1]-a[1]), a[2] + f*(b[2]-a[2]), a[3] + f*(b[3]-a[3])];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

function buildVoxelShellVertices(model, ev = null, mode = 'Voxels', cutMask = null) {
  const [nx, ny, nz] = model.domain.cells;
  const idx3 = (x, y, z) => x + nx * (y + ny * z);
  const shown = i => model.cellKind[i] !== CELL_KIND.AIR;
  let quadCount = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = idx3(x, y, z);
    if (!shown(c)) continue;
    for (const fq of FACE_QUADS) {
      const nx2 = x + (fq.axis === 0 ? fq.sign : 0);
      const ny2 = y + (fq.axis === 1 ? fq.sign : 0);
      const nz2 = z + (fq.axis === 2 ? fq.sign : 0);
      const out = nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz;
      if (out || !shown(idx3(nx2, ny2, nz2))) quadCount++;
    }
  }
  const verts = new Float32Array(quadCount * 6 * 9);
  const bScale = ev ? Math.max(1e-6, ev.maxBT) : 1;
  const hScale = ev ? Math.max(1e-3, ev.maxHAm) : 1;
  const mScale = ev ? Math.max(1e-3, ev.maxMAm) : 1;
  const MrArr = ev?.Mr || model.cellMrInit;
  let o = 0;
  const pushV = (p, n, col) => {
    verts[o++] = p[0]; verts[o++] = p[1]; verts[o++] = p[2];
    verts[o++] = n[0]; verts[o++] = n[1]; verts[o++] = n[2];
    verts[o++] = col[0]; verts[o++] = col[1]; verts[o++] = col[2];
  };
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const c = idx3(x, y, z);
    if (!shown(c)) continue;
    const kind = model.cellKind[c];
    const body = model.cellBodyIdx[c] >= 0 ? model.bodies[model.cellBodyIdx[c]] : null;
    for (const fq of FACE_QUADS) {
      const nx2 = x + (fq.axis === 0 ? fq.sign : 0);
      const ny2 = y + (fq.axis === 1 ? fq.sign : 0);
      const nz2 = z + (fq.axis === 2 ? fq.sign : 0);
      const out = nx2 < 0 || nx2 >= nx || ny2 < 0 || ny2 >= ny || nz2 < 0 || nz2 >= nz;
      if (!out && shown(idx3(nx2, ny2, nz2))) continue;

      let col;
      if (mode === 'Voxels' || !ev) {
        if (kind === CELL_KIND.HARD) {
          const Ms = model.cellMs[c] || 1;
          const mDot = (MrArr[4*c]*fq.normal[0] + MrArr[4*c+1]*fq.normal[1] + MrArr[4*c+2]*fq.normal[2]) / Ms;
          const mMag = Math.hypot(MrArr[4*c], MrArr[4*c+1], MrArr[4*c+2]) / Ms;
          if (mMag < 0.08) col = [0.56, 0.56, 0.60];          // Unmagnetized
          else if (mDot > 0.25) col = [0.90, 0.30, 0.26];     // North pole (+M)
          else if (mDot < -0.25) col = [0.24, 0.50, 0.92];    // South pole (-M)
          else col = [0.64, 0.56, 0.72];                      // Side wall of magnet
        } else if (kind === CELL_KIND.CONDUCTOR) {
          col = cutMask && cutMask[c] ? [0.98, 0.80, 0.22] : (body?.material.color || [0.85, 0.49, 0.34]);
        } else {
          col = body?.material.color || [0.42, 0.48, 0.54];
        }
      } else if (mode === 'H') {
        col = magColorRGB(ev.H[4*c+3] / hScale, 0);
      } else if (mode === 'M') {
        col = magColorRGB(ev.M[4*c+3] / mScale, 1);
      } else if (mode === 'Sat') {
        col = magColorRGB(ev.sat[c], 2);
      } else {
        col = magColorRGB(ev.B[4*c+3] / bScale, 0);
      }

      const pts = fq.corners.map(co => gridPointToWorldMm(model.domain, x + co[0], y + co[1], z + co[2]));
      const e1 = sub3(pts[1], pts[0]), e2 = sub3(pts[2], pts[0]);
      const cr = cross3(e1, e2), cl = len3(cr) || 1, nrm = scale3(cr, 1 / cl);
      pushV(pts[0], nrm, col); pushV(pts[1], nrm, col); pushV(pts[2], nrm, col);
      pushV(pts[0], nrm, col); pushV(pts[2], nrm, col); pushV(pts[3], nrm, col);
    }
  }
  return {vertices: verts, vertexCount: quadCount * 6};
}

function buildFieldStrokesVertices(model, ev, mode = 'B', slice = {axis: 'Off', position: 50}) {
  if (!ev) return {vertices: new Float32Array(0), vertexCount: 0};
  const [nx, ny, nz] = model.domain.cells;
  const idx3 = (x, y, z) => x + nx * (y + ny * z);
  const vecArr = mode === 'H' ? ev.H : mode === 'M' ? ev.M : ev.B;
  const maxVal = mode === 'H' ? ev.maxHAm : mode === 'M' ? ev.maxMAm : ev.maxBT;
  if (!(maxVal > 1e-12)) return {vertices: new Float32Array(0), vertexCount: 0};
  const pal = mode === 'M' ? 1 : 0;
  const pitchMm = Math.max(...model.domain.spacingM) * M_TO_MM;

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
    const tip = add3(origin, scale3(dir, length * 0.65));
    const base = add3(origin, scale3(dir, -length * 0.35));
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

  const emitCell = (x, y, z, maxLen, minFrac, allowSolid) => {
    const c = idx3(x, y, z);
    if (!allowSolid && model.cellKind[c] !== CELL_KIND.AIR) return;
    if (mode === 'M' && model.cellKind[c] === CELL_KIND.AIR) return;
    const mag = vecArr[4*c+3];
    if (mag < maxVal * minFrac) return;
    const wDir = gridVecToWorld(model.domain, [vecArr[4*c], vecArr[4*c+1], vecArr[4*c+2]]);
    const wl = len3(wDir);
    if (wl < 1e-12) return;
    const dir = scale3(wDir, 1 / wl);
    const rel = clamp(Math.pow(mag / maxVal, 0.45), 0.18, 1.0);
    const len = maxLen * (0.45 + 0.55 * rel);
    const origin = gridPointToWorldMm(model.domain, x + 0.5, y + 0.5, z + 0.5);
    addArrow(origin, dir, len, magColorRGB(rel, pal));
  };

  // If a Slice plane is active, draw a clean dense vector field right on the slice; otherwise 3D volumetric strokes.
  if (slice && slice.axis !== 'Off') {
    const t = clamp(slice.position / 100, 0, 1);
    const stride = Math.max(1, Math.round(Math.sqrt(Math.max(nx*ny, ny*nz, nx*nz) / 500)));
    const maxLen = Math.max(pitchMm * stride * 0.92, pitchMm * 1.4);
    if (slice.axis === 'X') {
      const ix = clamp(Math.round(t * (nx - 1)), 0, nx - 1);
      for (let z = 0; z < nz; z += stride) for (let y = 0; y < ny; y += stride) emitCell(ix, y, z, maxLen, 0.008, true);
    } else if (slice.axis === 'Y') {
      const iy = clamp(Math.round(t * (ny - 1)), 0, ny - 1);
      for (let z = 0; z < nz; z += stride) for (let x = 0; x < nx; x += stride) emitCell(x, iy, z, maxLen, 0.008, true);
    } else {
      const iz = clamp(Math.round(t * (nz - 1)), 0, nz - 1);
      for (let y = 0; y < ny; y += stride) for (let x = 0; x < nx; x += stride) emitCell(x, y, iz, maxLen, 0.008, true);
    }
  } else {
    const stride = Math.max(1, Math.round(Math.cbrt(model.domain.count / 1100)));
    const maxLen = Math.max(pitchMm * stride * 1.05, pitchMm * 1.8);
    const off = Math.floor(stride / 2);
    for (let z = off; z < nz; z += stride) {
      for (let y = off; y < ny; y += stride) {
        for (let x = off; x < nx; x += stride) {
          emitCell(x, y, z, maxLen, 0.015, mode === 'M');
        }
      }
    }
  }

  const vertices = Float32Array.from(out);
  return {vertices, vertexCount: vertices.length / 9};
}

// ---------- Viewport Render Shaders ----------

const COLORMAP_WGSL = `
fn magPalette(uIn: f32) -> vec3f {
  let u = clamp(uIn, 0.0, 1.0);
  if (u < 0.25) { return mix(vec3f(0.09, 0.08, 0.24), vec3f(0.14, 0.34, 0.64), u / 0.25); }
  if (u < 0.50) { return mix(vec3f(0.14, 0.34, 0.64), vec3f(0.14, 0.68, 0.66), (u - 0.25) / 0.25); }
  if (u < 0.76) { return mix(vec3f(0.14, 0.68, 0.66), vec3f(0.90, 0.74, 0.18), (u - 0.50) / 0.26); }
  return mix(vec3f(0.90, 0.74, 0.18), vec3f(1.00, 0.96, 0.78), (u - 0.76) / 0.24);
}
fn mPalette(uIn: f32) -> vec3f {
  let u = clamp(uIn, 0.0, 1.0);
  if (u < 0.30) { return mix(vec3f(0.10, 0.06, 0.18), vec3f(0.42, 0.18, 0.62), u / 0.30); }
  if (u < 0.65) { return mix(vec3f(0.42, 0.18, 0.62), vec3f(0.80, 0.32, 0.68), (u - 0.30) / 0.35); }
  return mix(vec3f(0.80, 0.32, 0.68), vec3f(0.96, 0.86, 1.00), (u - 0.65) / 0.35);
}
fn satPalette(uIn: f32) -> vec3f {
  let u = clamp(uIn, 0.0, 1.0);
  if (u < 0.40) { return mix(vec3f(0.24, 0.34, 0.48), vec3f(0.18, 0.62, 0.62), u / 0.40); }
  if (u < 0.75) { return mix(vec3f(0.18, 0.62, 0.62), vec3f(0.94, 0.68, 0.16), (u - 0.40) / 0.35); }
  if (u < 0.95) { return mix(vec3f(0.94, 0.68, 0.16), vec3f(0.92, 0.22, 0.18), (u - 0.75) / 0.20); }
  return mix(vec3f(0.92, 0.22, 0.18), vec3f(1.00, 0.18, 0.24), (u - 0.95) / 0.05);
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
struct DomCfg { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f, params: vec4f }; // params.x: 0=B, 1=H, 2=M, 3=Sat
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
  let mode = i32(dom.params.x + 0.5);
  var col = magPalette(s.x);
  if (mode == 1) { col = magPalette(s.y); }
  else if (mode == 2) { col = mPalette(s.z); }
  else if (mode == 3) { col = satPalette(s.w); }
  let n = normalize(input.normal);
  let key = abs(dot(n, normalize(vec3f(0.35, 0.55, 0.76))));
  let shade = 0.42 + 0.58 * key;
  return vec4f(col * shade, 1.0);
}
`;
}

const SLICE_WGSL = COLORMAP_WGSL + `
struct Camera { rotation: mat4x4f, centerScale: vec4f, viewport: vec4f, clip: vec4f, frame: vec4f, modes: vec4f };
struct SliceCfg { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f, params: vec4f }; // params: (axis 1=X 2=Y 3=Z, pos01, mode 0=B 1=H 2=Sat, unused)
@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var fieldTex: texture_3d<f32>;
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
  if (border < 0.008) { return vec4f(0.82, 0.66, 0.94, 0.85); }
  let s = textureSampleLevel(fieldTex, fieldSamp, clamp(input.uvw, vec3f(0.0), vec3f(1.0)), 0.0);
  let mode = i32(sc.params.z + 0.5);
  var val = s.x;
  var col = magPalette(val);
  if (mode == 1) { val = s.y; col = magPalette(val); }
  else if (mode == 2) { val = s.w; col = satPalette(val); }
  let band = abs(fract(val * 10.0) - 0.5);
  let line = 1.0 - smoothstep(0.0, 0.06, band);
  col = mix(col, vec3f(1.0), 0.16 * line);
  let isSolid = s.z > 0.5;
  let alpha = select(0.24 + 0.54 * clamp(val, 0.0, 1.0), 0.88, isSolid);
  return vec4f(col, alpha);
}
`;

// ---------- Helper Geometry (3D Box, Current Plane with +Z Normal Arrow, Probe Crosshair) ----------

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

function makeCurrentPlaneLines() {
  const lines = [
    // Outer 100x100 mm XY cut frame at Z=0
    -50, -50, 0,  50, -50, 0,
     50, -50, 0,  50,  50, 0,
     50,  50, 0, -50,  50, 0,
    -50,  50, 0, -50, -50, 0,
    // Subtle inner crosshairs on plane
    -14, 0, 0, 14, 0, 0,
     0, -14, 0, 0, 14, 0,
    // Unmistakable +Z current direction arrow
    0, 0, 0, 0, 0, 32,
    0, 0, 32, 7, 0, 22,
    0, 0, 32, -7, 0, 22,
    0, 0, 32, 0, 7, 22,
    0, 0, 32, 0, -7, 22
  ];
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
  const CAPTURE_KEYS = ['Auto size', 'Voxel size'];

  // Cached O(1) node lookup for surfaceStyle fallback (preserves <100ms 20k-mesh budget)
  let nodeSrc = null, nodeCount = -1, nodeMap = null;
  const invalidateNodeIndex = () => { nodeSrc = null; nodeMap = null; nodeCount = -1; };
  const findNode = hash => {
    const nodes = D.nodes;
    if (!nodeMap || nodeSrc !== nodes || nodeCount !== nodes.length) {
      nodeSrc = nodes; nodeCount = nodes.length;
      nodeMap = new Map(nodes.map(n => [n.nativeHash, n]));
    }
    return nodeMap.get(hash);
  };
  const findAny = hash => {
    const n = findNode(hash);
    if (!n || !['magneto', 'magneto_current', 'magneto_probe'].includes(n.type))
      throw fail('INVALID_OWNER', 'Select a Magneto object, Current plane or Probe.');
    return n;
  };
  const owner = hash => {
    const n = findAny(hash);
    if (n.type !== 'magneto') throw fail('INVALID_OWNER', 'Select a Magneto object.');
    return n;
  };

  const states = new Map();       // ownerHash -> live state
  const persistentM = new Map();  // ownerHash -> Map<bodyHash, bodyLocalMrStore>
  const archives = new Map();     // ownerHash -> {version, frames, fields, fieldBytes, seriesCache}
  const slices = new Map();       // ownerHash -> {axis: 'Off'|'X'|'Y'|'Z', position: 50}
  const filterCache = new Map();
  const voxPipeCache = new WeakMap();
  let renderState = {device: null, format: null, pipes: null, pending: null, camGroups: new WeakMap(), camLayout: null, fieldLayout: null, meshLayoutBuf: null, meshLayoutTex: null, sampler: null};
  let jobSerial = 0;

  const getSlice = hash => {
    let s = slices.get(hash);
    if (!s) slices.set(hash, s = {axis: 'Off', position: 50});
    return s;
  };
  const getPersistentMap = hash => {
    let m = persistentM.get(hash);
    if (!m) persistentM.set(hash, m = new Map());
    return m;
  };
  const hasRemagnetizedState = hash => {
    const m = persistentM.get(hash);
    if (!m) return false;
    for (const store of m.values()) if (store.modified) return true;
    return false;
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
    st.strokeBuf?.destroy(); st.strokeBuf = null; st.strokeVerts = 0;
    st.solidTex?.destroy(); st.solidTex = null;
    st.fieldTex?.destroy(); st.fieldTex = null;
    st.domUniformBuf?.destroy(); st.domUniformBuf = null;
    st.sliceUniformBuf?.destroy(); st.sliceUniformBuf = null;
    st.solidFieldBG = null; st.fieldSliceBG = null;
    if (st.meshEntries) {
      for (const me of st.meshEntries) me.uniformBuf?.destroy();
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
    persistentM.delete(hash);
    archives.delete(hash);
    slices.delete(hash);
  }

  // ---------- Render Pipeline Preparation ----------

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

    const dispMod = device.createShaderModule({label: 'Magneto display', code: camWGSL + '\n' + DISPLAY_WGSL});
    const surfBufMod = device.createShaderModule({label: 'Magneto surf buf', code: camWGSL + '\n' + smoothSurfaceWGSL('buffer')});
    const surfTexMod = device.createShaderModule({label: 'Magneto surf tex', code: camWGSL + '\n' + smoothSurfaceWGSL('texture')});
    const sliceMod = device.createShaderModule({label: 'Magneto slice', code: camWGSL + '\n' + SLICE_WGSL});

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
        label: 'Magneto voxel/stroke ' + (orthographic ? 'ortho' : 'persp'),
        layout: dispPL,
        vertex: {module: dispMod, entryPoint: 'vs', constants: {orthographic}, buffers: vbufLayout},
        fragment: {module: dispMod, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })),
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Magneto smooth buf ' + (orthographic ? 'ortho' : 'persp'),
        layout: surfBufPL,
        vertex: {module: surfBufMod, entryPoint: 'vs', constants: {orthographic}},
        fragment: {module: surfBufMod, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })),
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Magneto smooth tex ' + (orthographic ? 'ortho' : 'persp'),
        layout: surfTexPL,
        vertex: {module: surfTexMod, entryPoint: 'vs', constants: {orthographic}},
        fragment: {module: surfTexMod, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })),
      ...[false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Magneto slice ' + (orthographic ? 'ortho' : 'persp'),
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
    const modeIdx = st.mode === 'H' ? 1 : st.mode === 'M' ? 2 : st.mode === 'Sat' ? 3 : 0;
    const domData = new Float32Array(20);
    domData.set([d.originWorldM[0]*M_TO_MM, d.originWorldM[1]*M_TO_MM, d.originWorldM[2]*M_TO_MM, 0], 0);
    domData.set([d.basis[0][0], d.basis[0][1], d.basis[0][2], d.lengthsM[0]*M_TO_MM], 4);
    domData.set([d.basis[1][0], d.basis[1][1], d.basis[1][2], d.lengthsM[1]*M_TO_MM], 8);
    domData.set([d.basis[2][0], d.basis[2][1], d.basis[2][2], d.lengthsM[2]*M_TO_MM], 12);
    domData.set([modeIdx, 0, 0, 0], 16);
    if (!st.domUniformBuf) {
      st.domUniformBuf = device.createBuffer({label: 'Magneto dom uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    }
    device.queue.writeBuffer(st.domUniformBuf, 0, domData);

    const sl = getSlice(hash);
    const axisNum = sl.axis === 'X' ? 1 : sl.axis === 'Y' ? 2 : sl.axis === 'Z' ? 3 : 0;
    const sliceMode = st.mode === 'H' ? 1 : st.mode === 'Sat' ? 2 : 0;
    const slData = new Float32Array(domData);
    slData.set([axisNum, clamp(sl.position / 100, 0, 1), sliceMode, 0], 16);
    if (!st.sliceUniformBuf) {
      st.sliceUniformBuf = device.createBuffer({label: 'Magneto slice uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
    }
    device.queue.writeBuffer(st.sliceUniformBuf, 0, slData);
  }

  function updateSurfaceFilter(hash) {
    const st = states.get(hash), device = st?.device;
    const hasVisual = !!(st?.model && (st.voxelVerts > 0 || (st.eval && st.meshEntries?.length > 0)));
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
      const uniformBuf = device.createBuffer({label: 'Magneto surface filter', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      const shader = `
        struct MagClip { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f };
        @group(3) @binding(0) var<uniform> magClip: MagClip;
        fn pluginSurfaceKeep(world: vec3f) -> bool {
          let d = world - magClip.origin.xyz;
          let u = dot(d, magClip.bx.xyz);
          let v = dot(d, magClip.by.xyz);
          let w = dot(d, magClip.bz.xyz);
          let inside = u >= -0.05 && u <= magClip.bx.w + 0.05 &&
                       v >= -0.05 && v <= magClip.by.w + 0.05 &&
                       w >= -0.05 && w <= magClip.bz.w + 0.05;
          return !inside;
        }
      `;
      entry = {owner: hash, device, uniformBuf, shader, buffers: [{buffer: uniformBuf, type: 'uniform'}], hashes: new Set()};
      filterCache.set(hash, entry);
    }
    entry.hashes = new Set(st.participatingHashes || []);
    device.queue.writeBuffer(entry.uniformBuf, 0, data);
  }

  function rebuildStrokesBuffer(hash) {
    const st = states.get(hash), device = st?.device;
    if (!st || !device) return;
    st.strokeBuf?.destroy(); st.strokeBuf = null; st.strokeVerts = 0;
    if (!st.eval || !st.strokesEnabled) return;
    const strokes = buildFieldStrokesVertices(st.model, st.eval, st.mode, getSlice(hash));
    if (strokes.vertexCount > 0) {
      st.strokeBuf = device.createBuffer({label: 'Magneto strokes', size: Math.max(36, strokes.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(st.strokeBuf, 0, strokes.vertices);
      st.strokeVerts = strokes.vertexCount;
    }
  }

  function rebuildVisualBuffers(hash) {
    const st = states.get(hash), device = st?.device;
    if (!st?.model || !device) { updateSurfaceFilter(hash); return; }

    st.voxelBuf?.destroy(); st.voxelBuf = null; st.voxelVerts = 0;
    const vox = buildVoxelShellVertices(st.model, st.eval, st.mode === 'Voxels' || !st.eval ? 'Voxels' : st.mode, st.cutCellMask);
    if (vox.vertexCount > 0) {
      st.voxelBuf = device.createBuffer({label: 'Magneto voxels', size: Math.max(36, vox.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(st.voxelBuf, 0, vox.vertices);
      st.voxelVerts = vox.vertexCount;
    }

    rebuildStrokesBuffer(hash);

    if (st.eval) {
      const [nx, ny, nz] = st.model.domain.cells;
      const packed = packFieldTextures(st.model, st.eval);
      const texDesc = label => ({
        label, size: [nx, ny, nz], dimension: '3d', format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
      if (!st.solidTex || st.texDims?.[0] !== nx || st.texDims?.[1] !== ny || st.texDims?.[2] !== nz) {
        st.solidTex?.destroy(); st.fieldTex?.destroy();
        st.solidTex = device.createTexture(texDesc('Magneto solid 3D'));
        st.fieldTex = device.createTexture(texDesc('Magneto field 3D'));
        st.texDims = [nx, ny, nz];
        st.solidFieldBG = null; st.fieldSliceBG = null;
      }
      device.queue.writeTexture({texture: st.solidTex}, packed.solidTex, {bytesPerRow: nx * 8, rowsPerImage: ny}, [nx, ny, nz]);
      device.queue.writeTexture({texture: st.fieldTex}, packed.fieldTex, {bytesPerRow: nx * 8, rowsPerImage: ny}, [nx, ny, nz]);
    }

    if (st.meshEntries) { for (const me of st.meshEntries) me.uniformBuf?.destroy(); st.meshEntries = null; }
    if (st.participatingMeshes?.length) {
      st.meshEntries = st.participatingMeshes.map(m => {
        const uniformBuf = device.createBuffer({label: 'Magneto mesh xf', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
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

  // ---------- Scene Capture -> GPU Voxelization -> Magneto Model ----------

  function gatherCurrentPlanesForOwner(ownerHash, domain) {
    const planes = [];
    for (const n of D.nodes) {
      if (n.type !== 'magneto_current' || n.enabled === false || n.params.Magneto !== ownerHash) continue;
      try {
        const world = Array.from(D.world(n.nativeHash));
        const invWorldMm = Array.from(context.math.inv(world));
        const cols = [0, 4, 8].map(i => world.slice(i, i + 3));
        const scales = cols.map(len3);
        if (!(scales[0] > 0) || !(scales[1] > 0)) continue;
        const nW = len3(cols[2]) > 1e-9 ? scale3(cols[2], 1 / len3(cols[2])) : scale3(cross3(cols[0], cols[1]), 1 / (len3(cross3(cols[0], cols[1])) || 1));
        const nG = worldVecToGrid(domain, nW);
        const nl = len3(nG) || 1;
        planes.push({
          hash: n.nativeHash, name: n.name,
          currentDensityAmm2: Number(n.params['Current Density']) || 0,
          world, invWorldMm, scales,
          normalWorld: nW, normalGrid: scale3(nG, 1 / nl)
        });
      } catch {}
    }
    return planes;
  }

  function gatherProbesForOwner(ownerHash) {
    const probes = [];
    for (const n of D.nodes) {
      if (n.type !== 'magneto_probe' || n.enabled === false || n.params.Magneto !== ownerHash) continue;
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
      if (!m.tags?.nearest?.magneto) continue;
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
      if (n.type === 'magneto_probe' && n.enabled !== false && n.params.Magneto === ownerHash) {
        try { expand(Array.from(D.world(n.nativeHash)).slice(12, 15)); } catch {}
      }
    }
    return found ? {min, max} : null;
  }

  function magnetoSignature(hash) {
    const captureOpts = {includeTags: true};
    const base = context.scene.signature(hash, CAPTURE_KEYS, captureOpts);
    const wStr = Array.from(D.world(hash), v => Math.round(v * 1e6)).join(',');
    const helpers = D.nodes
      .filter(n => (n.type === 'magneto_current' || n.type === 'magneto_probe') && n.params.Magneto === hash)
      .map(n => {
        const w = Array.from(D.world(n.nativeHash), v => Math.round(v * 1e6)).join(',');
        return `${n.nativeHash}:${n.enabled !== false}:${JSON.stringify(n.params)}:${w}`;
      }).sort().join('|');
    return `${base}|${wStr}|${helpers}`;
  }

  async function captureAndVoxelize(hash, checkCurrent, usePersistent = true) {
    const n = owner(hash), device = context.device;
    if (!device) throw fail('NO_DEVICE', 'Shared WebGPU device is unavailable.');
    validateMagnetoParameters(n.params);
    const autoSize = !!n.params['Auto size'];
    const voxelSizeMm = n.params['Voxel size'];
    const ownerWorld = Array.from(D.world(hash));
    const snapshot = context.scene.capture(hash, CAPTURE_KEYS, {includeTags: true});

    const domain = autoSize
      ? computeAutoDomain(computeAutoWorldBounds(hash, snapshot.meshes, ownerWorld), voxelSizeMm)
      : computeManualDomain(ownerWorld, voxelSizeMm);

    const pipes = await getVoxelizerPipelines(device, voxPipeCache);
    checkCurrent?.();

    const bodies = [];
    const participatingHashes = new Set();
    const participatingMeshes = [];
    const intersectsManual = m => autoSize || !m.bounds.min.some((v, i) => v > 50 + voxelSizeMm * 2 || m.bounds.max[i] < -50 - voxelSizeMm * 2);

    for (const m of snapshot.meshes) {
      const matTag = m.tags?.nearest?.magneto;
      if (!matTag) continue;
      if (!intersectsManual(m)) continue;
      checkCurrent?.();
      const vox = await voxelizeOccurrenceGPU(device, m, domain, pipes, checkCurrent);
      if (vox.activeCount > 0) {
        participatingHashes.add(m.hash);
        participatingMeshes.push(m);
        const mat = resolveMaterialProps(matTag.params);
        const nodeObj = findNode(m.hash);
        const worldMat = Array.from(m.worldMatrix);
        let invWorldMm = null;
        try { invWorldMm = Array.from(context.math.inv(worldMat)); } catch {}
        let pivotWorldMm = worldMat.slice(12, 15);
        try {
          if (m.pivotFrame) pivotWorldMm = Array.from(m.pivotFrame).slice(12, 15);
        } catch {}
        bodies.push({
          hash: m.hash,
          name: nodeObj?.name || mat.name,
          material: mat,
          worldMatrix: worldMat,
          invWorldMm,
          rotBasis: extractRotationBasis(worldMat),
          pivotWorldMm,
          occupancy: vox.occupancy,
          activeCount: vox.activeCount,
          volumeM3: vox.volumeM3
        });
      }
    }

    if (!bodies.length) {
      throw fail('NO_MAGNETO_GEOMETRY', 'Tag geometry with Magneto inside the Magneto domain.');
    }

    const currentPlanes = gatherCurrentPlanesForOwner(hash, domain);
    const probes = gatherProbesForOwner(hash);
    const pStores = usePersistent ? getPersistentMap(hash) : null;
    const model = buildMagnetoModel({domain, bodies, currentPlanes, probes, persistentStores: pStores});
    const sig = magnetoSignature(hash);
    const assertFresh = () => {
      checkCurrent?.();
      if (context.device !== device) throw fail('STALE_DEVICE', 'WebGPU device changed.');
      if (magnetoSignature(hash) !== sig) throw fail('STALE_SCENE', 'Magneto geometry, transforms, tags or currents changed.');
    };
    return {model, probes, signature: sig, assertFresh, participatingHashes, participatingMeshes, frame: D.frame, device};
  }

  // ---------- Archive & Curves Readout Series ----------

  function recordArchiveFrame(hash, frame, ev, storeField = false) {
    const a = getArchive(hash);
    const probeMap = new Map();
    for (const p of ev.probes || []) probeMap.set(p.hash, {BmT: p.BmT, BVecmT: p.BVecmT, HkAm: p.HkAm, inside: p.inside});
    const bodyMap = new Map();
    for (const b of ev.bodies || []) bodyMap.set(b.hash, {forceN: b.forceN, forceMagN: b.forceMagN, torqueNm: b.torqueNm, torqueMagNm: b.torqueMagNm});
    a.frames.set(frame, {
      maxBT: ev.maxBT,
      maxHkAm: ev.maxHAm * 1e-3,
      peakSatPct: ev.peakSatPct,
      energyJ: ev.energyJ,
      totalForceMagN: ev.totalForceMagN,
      probes: probeMap,
      bodies: bodyMap
    });
    if (storeField && ev.B && ev.H) {
      const bytes = ev.B.byteLength + ev.H.byteLength + ev.Mr.byteLength + ev.muR.byteLength;
      if (a.fieldBytes + bytes <= MAX_ARCHIVE_FIELD_BYTES) {
        a.fields.set(frame, {
          B: Float32Array.from(ev.B), H: Float32Array.from(ev.H),
          Mr: Float32Array.from(ev.Mr), muR: Float32Array.from(ev.muR)
        });
        a.fieldBytes += bytes;
      }
    }
    a.version++;
    a.seriesCache.clear();
  }

  function readoutSeries(hash, key, label, unit, subHash = null, vecMode = false) {
    const a = archives.get(hash);
    if (!a || !a.frames.size) return null;
    const ck = `${key}:${subHash || ''}:${vecMode ? 1 : 0}`;
    if (a.seriesCache.has(ck)) return a.seriesCache.get(ck);
    const samples = [];
    const labels = vecMode ? [`${label} X`, `${label} Y`, `${label} Z`, `${label} |·|`] : [label];
    for (const frame of [...a.frames.keys()].sort((x, y) => x - y)) {
      const row = a.frames.get(frame);
      if (key === 'probe-b' || key === 'probe-h') {
        const pr = row.probes?.get(subHash);
        if (!pr?.inside) continue;
        if (key === 'probe-b') {
          samples.push({frame, values: vecMode ? [...pr.BVecmT, pr.BmT] : [pr.BmT]});
        } else {
          samples.push({frame, values: [pr.HkAm]});
        }
      } else if (key === 'body-force' || key === 'body-torque') {
        const br = row.bodies?.get(subHash);
        if (!br) continue;
        const v = key === 'body-force' ? br.forceN : br.torqueNm;
        const m = key === 'body-force' ? br.forceMagN : br.torqueMagNm;
        samples.push({frame, values: vecMode ? [v[0], v[1], v[2], m] : [m]});
      } else {
        const val = row[key];
        if (Number.isFinite(val)) samples.push({frame, values: [val]});
      }
    }
    if (!samples.length) return null;
    const s = {labels, unit, samples};
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
    if (n.enabled === false) throw fail('DISABLED', 'Enable the Magneto object first.');
    cancelJob(hash);
    let st = states.get(hash);
    if (!st) states.set(hash, st = {hash, device: context.device, mode: 'B', strokesEnabled: true});
    const job = {id: ++jobSerial, kind, state: 'solving', progress: 'Preparing', cancelled: false, error: null, done: null};
    st.job = job; st.error = null;
    const checkCurrent = () => {
      if (job.cancelled || states.get(hash)?.job !== job) throw fail('CANCELLED', 'Magneto calculation stopped.');
      if (!findNode(hash) || findNode(hash).type !== 'magneto') throw fail('INVALID_OWNER', 'Magneto object was removed.');
    };
    refresh();
    job.done = (async () => {
      try {
        await Promise.resolve();
        const res = await fn(job, checkCurrent);
        checkCurrent();
        job.state = 'ready'; job.progress = '';
        st.error = null;
        return res;
      } catch (err) {
        if (err?.code === 'CANCELLED' || job.cancelled) {
          job.state = 'stopped'; job.progress = '';
        } else {
          job.state = 'failed'; job.progress = '';
          job.error = {code: err?.code || 'MAGNETO_ERROR', message: err?.message || String(err)};
          st.error = job.error;
        }
        throw err;
      } finally {
        refresh();
      }
    })();
    job.done.catch(() => {});
    return {jobId: job.id, kind, state: job.state};
  }

  // ---------- Operations: Show Voxels, Solve Frame, Solve Animation, Reset Magnetization ----------

  function commitPersistentMagnetization(hash, model, MrGrid) {
    const pStores = getPersistentMap(hash);
    for (const b of model.bodies) {
      if (b.kindCode !== CELL_KIND.HARD || !b.invWorldMm) continue;
      let store = pStores.get(b.hash);
      if (!store) {
        store = createBodyMagnetizationStore(b, model.domain, b.invWorldMm, b.rotBasis);
        pStores.set(b.hash, store);
      }
      writeBodyLocalMrFromGrid(store, b, model.domain, MrGrid);
    }
  }

  function runShowVoxels(hash) {
    return startJob(hash, 'show-voxels', async (job, checkCurrent) => {
      job.progress = 'Voxelizing'; refresh();
      const cap = await captureAndVoxelize(hash, checkCurrent, true);
      const curData = solveConductorCurrents(cap.model);
      cap.assertFresh();
      const st = states.get(hash);
      destroyStateGPU(st);
      Object.assign(st, {
        device: cap.device, model: cap.model, probes: cap.probes,
        signature: cap.signature, frame: cap.frame,
        participatingHashes: cap.participatingHashes,
        participatingMeshes: cap.participatingMeshes,
        cutCellMask: curData.cutCellMask,
        currentPlanes: curData.planeResults,
        eval: null, mode: 'Voxels'
      });
      rebuildVisualBuffers(hash);
      return {state: 'voxels', grid: cap.model.domain.cells, stats: cap.model.stats, currentPlanes: curData.planeResults};
    });
  }

  function runSolveFrame(hash, {tolerance = 1e-6, maxIterations = 600, maxOuterIterations = 16} = {}) {
    return startJob(hash, 'solve-frame', async (job, checkCurrent) => {
      job.progress = 'Voxelizing'; refresh();
      const cap = await captureAndVoxelize(hash, checkCurrent, true);
      cap.assertFresh();

      job.progress = 'Currents'; refresh();
      const curData = solveConductorCurrents(cap.model);
      const sol = await solveMagnetoGPU(cap.device, cap.model, curData, {
        tolerance, maxIterations, maxOuterIterations, checkCurrent,
        onProgress: msg => { job.progress = msg; refresh(); }
      });
      cap.assertFresh();

      commitPersistentMagnetization(hash, cap.model, sol.Mr);
      const ev = evaluateMagnetoFields(cap.model, sol, curData, cap.probes);
      recordArchiveFrame(hash, cap.frame, ev, false);

      const st = states.get(hash);
      destroyStateGPU(st);
      Object.assign(st, {
        device: cap.device, model: cap.model, probes: cap.probes,
        signature: cap.signature, frame: cap.frame,
        participatingHashes: cap.participatingHashes,
        participatingMeshes: cap.participatingMeshes,
        cutCellMask: curData.cutCellMask,
        currentPlanes: curData.planeResults,
        eval: ev, mode: st.mode === 'Voxels' || !st.mode ? 'B' : st.mode,
        iterations: sol.iterations, outerIterations: sol.outerIterations, relResidual: sol.relResidual
      });
      rebuildVisualBuffers(hash);

      return {
        state: 'solved', kind: 'frame', frame: cap.frame,
        grid: cap.model.domain.cells,
        maxBT: ev.maxBT, maxHAm: ev.maxHAm, maxMAm: ev.maxMAm,
        peakSatPct: ev.peakSatPct, energyJ: ev.energyJ,
        remagnetized: hasRemagnetizedState(hash),
        bodies: ev.bodies, probes: ev.probes, currentPlanes: ev.currentPlanes,
        iterations: sol.iterations, outerIterations: sol.outerIterations, relResidual: sol.relResidual
      };
    });
  }

  function runSolveAnimation(hash, {firstFrame = 0, lastFrame, tolerance = 1e-5, maxIterations = 450, maxOuterIterations = 14} = {}) {
    const tl = context.animation.timeline();
    lastFrame ??= tl.total;
    if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame) || firstFrame < 0 || lastFrame < firstFrame || lastFrame > tl.total)
      throw fail('INVALID_ARGUMENT', 'Invalid animation frame interval.');
    D.pause();
    return startJob(hash, 'solve-animation', async (job, checkCurrent) => {
      const initialFrame = D.frame;
      // Start animation chronologically from clean authored initial magnetization
      persistentM.delete(hash);
      const a = getArchive(hash);
      a.frames.clear(); a.fields.clear(); a.fieldBytes = 0; a.version++; a.seriesCache.clear();

      const seekTo = async targetFrame => {
        if (D.frame === targetFrame) return;
        for (;;) {
          checkCurrent();
          try {
            await context.animation.seek(targetFrame, D.frame, () => { checkCurrent(); return true; });
            return;
          } catch (err) {
            if (err?.code !== 'BUSY') throw err;
            await new Promise(r => setTimeout(r, 30));
          }
        }
      };

      const totalFrames = Math.max(1, lastFrame - firstFrame + 1);
      let lastCap = null, lastEv = null, lastCur = null, lastSol = null;
      let snapStride = 1;

      try {
        for (let f = firstFrame; f <= lastFrame; f++) {
          checkCurrent();
          const stepNum = f - firstFrame;
          job.progress = `f${f}/${lastFrame}`;
          if (stepNum === 0 || stepNum % 2 === 0 || f === lastFrame) refresh();
          await seekTo(f);

          const cap = await captureAndVoxelize(hash, checkCurrent, true);
          const curData = solveConductorCurrents(cap.model);
          const sol = await solveMagnetoGPU(cap.device, cap.model, curData, {
            tolerance, maxIterations, maxOuterIterations, checkCurrent
          });
          commitPersistentMagnetization(hash, cap.model, sol.Mr);
          const ev = evaluateMagnetoFields(cap.model, sol, curData, cap.probes);

          if (stepNum === 0) {
            const bytesPerFrame = cap.model.domain.count * 52;
            const maxStored = Math.max(2, Math.floor(MAX_ARCHIVE_FIELD_BYTES / Math.max(1, bytesPerFrame)));
            snapStride = Math.max(1, Math.ceil(totalFrames / maxStored));
          }
          const storeSnap = (stepNum % snapStride === 0) || (f === lastFrame);
          recordArchiveFrame(hash, f, ev, storeSnap);
          lastCap = cap; lastEv = ev; lastCur = curData; lastSol = sol;
          if (stepNum % 2 === 0) await new Promise(r => setTimeout(r, 0));
        }

        const st = states.get(hash);
        destroyStateGPU(st);
        Object.assign(st, {
          device: lastCap.device, model: lastCap.model, probes: lastCap.probes,
          signature: magnetoSignature(hash), frame: lastFrame,
          participatingHashes: lastCap.participatingHashes,
          participatingMeshes: lastCap.participatingMeshes,
          cutCellMask: lastCur.cutCellMask,
          currentPlanes: lastCur.planeResults,
          eval: lastEv, mode: st.mode === 'Voxels' || !st.mode ? 'B' : st.mode,
          iterations: lastSol.iterations, outerIterations: lastSol.outerIterations, relResidual: lastSol.relResidual
        });
        rebuildVisualBuffers(hash);

        return {
          state: 'solved', kind: 'animation',
          firstFrame, lastFrame, frames: a.frames.size,
          maxBT: lastEv.maxBT, maxHAm: lastEv.maxHAm, peakSatPct: lastEv.peakSatPct, energyJ: lastEv.energyJ,
          remagnetized: hasRemagnetizedState(hash),
          bodies: lastEv.bodies, probes: lastEv.probes
        };
      } finally {
        if (D.frame !== initialFrame) {
          try { await context.animation.seek(initialFrame, D.frame); } catch {}
        }
      }
    });
  }

  function runResetMagnetization(hash) {
    owner(hash);
    const had = hasRemagnetizedState(hash);
    persistentM.delete(hash);
    const st = states.get(hash);
    if (st) {
      // Mark visual/eval stale so next Solve starts cleanly from authored magnetization
      destroyStateGPU(st);
      st.model = null; st.eval = null; st.participatingHashes = null; st.participatingMeshes = null;
      updateSurfaceFilter(hash);
    }
    refresh();
    return {reset: true, hadRemagnetizedState: had, remagnetized: false};
  }

  // ---------- Playback / Timeline Scrubbing Restoration ----------

  function applyArchivedFrame(hash, frame) {
    const st = states.get(hash), a = archives.get(hash);
    if (!st?.model || !a?.fields.size) return;
    if (st.frame === frame) return;
    let snap = a.fields.get(frame);
    if (!snap) {
      let bestF = null, bestD = Infinity;
      for (const f of a.fields.keys()) {
        const d = Math.abs(f - frame);
        if (d < bestD) { bestD = d; bestF = f; }
      }
      if (bestF === null) return;
      snap = a.fields.get(bestF);
    }
    if (snap.B.length !== st.model.domain.count * 4) return;
    st.frame = frame;
    st.eval = evaluateMagnetoFields(st.model, snap, null, st.probes || []);
    rebuildVisualBuffers(hash);
    refresh();
  }

  // ---------- Status, Force, Torque, Measure ----------

  function statusOf(hash) {
    const n = findAny(hash);
    const ownerHash = n.type === 'magneto' ? hash : n.params.Magneto;
    const st = ownerHash ? states.get(ownerHash) : null;
    const a = ownerHash ? archives.get(ownerHash) : null;
    const sl = ownerHash ? getSlice(ownerHash) : {axis: 'Off', position: 50};

    if (n.type === 'magneto_probe') {
      const reading = st?.eval ? samplePointReading(st.model, st.eval.B, st.eval.H, st.eval.M, st.eval.sat, Array.from(D.world(hash)).slice(12, 15), {hash, name: n.name}) : null;
      return {
        stage: 'ready', state: st?.job?.state || 'idle', type: n.type, ownerHash,
        authoringOnly: false, physicsAvailable: true, solverAvailable: true, resultAvailable: !!reading,
        inside: reading?.inside ?? null,
        BT: reading?.BT ?? null, BmT: reading?.BmT ?? null, BVecmT: reading?.BVecmT ?? null,
        HAm: reading?.HAm ?? null, HkAm: reading?.HkAm ?? null, region: reading?.region ?? null
      };
    }
    if (n.type === 'magneto_current') {
      const pr = st?.currentPlanes?.find(p => p.hash === hash) || null;
      return {
        stage: 'ready', state: st?.job?.state || 'idle', type: n.type, ownerHash,
        authoringOnly: false, physicsAvailable: true, solverAvailable: true,
        currentDensityAmm2: n.params['Current Density'],
        totalCurrentA: pr?.totalCurrentA ?? null,
        cutAreaMm2: pr?.cutAreaMm2 ?? null,
        mode: pr?.mode ?? null,
        openCircuit: pr?.openCircuit ?? false
      };
    }

    return {
      stage: 'ready',
      state: st?.job?.state || 'idle',
      type: n.type,
      authoringOnly: false,
      physicsAvailable: true,
      solverAvailable: true,
      materialPhysicsAvailable: true,
      currentConductorAvailable: true,
      fieldAvailable: !!st?.eval,
      resultAvailable: !!st?.eval,
      persistentMagnetizationAvailable: true,
      remagnetized: hasRemagnetizedState(hash),
      curvesAvailable: !!(a && a.frames.size),
      autoSize: !!n.params['Auto size'],
      voxelSizeMm: n.params['Voxel size'],
      displayMode: st?.mode || null,
      strokesEnabled: st ? !!st.strokesEnabled : true,
      slice: {...sl},
      voxelsAvailable: !!st?.model,
      job: st?.job ? {id: st.job.id, kind: st.job.kind, state: st.job.state, progress: st.job.progress, error: st.job.error} : null,
      error: st?.error || null,
      grid: st?.model?.domain.cells || null,
      stats: st?.model?.stats || null,
      result: st?.eval ? {
        frame: st.frame,
        maxBT: st.eval.maxBT,
        maxSolidBT: st.eval.maxSolidBT,
        maxHAm: st.eval.maxHAm,
        maxMAm: st.eval.maxMAm,
        peakSatPct: st.eval.peakSatPct,
        energyJ: st.eval.energyJ,
        totalForceN: st.eval.totalForceN,
        totalTorqueNm: st.eval.totalTorqueNm,
        bodies: st.eval.bodies,
        probes: st.eval.probes,
        currentPlanes: st.eval.currentPlanes,
        iterations: st.iterations ?? null,
        outerIterations: st.outerIterations ?? null,
        relResidual: st.relResidual ?? null
      } : null,
      archivedFrames: a ? a.frames.size : 0
    };
  }

  function forceOf(hash) {
    owner(hash);
    const st = states.get(hash);
    if (!st?.eval) throw fail('NO_RESULT', 'Run Solve Frame or Solve Animation before reading Force.');
    return {
      frame: st.frame,
      totalForceN: st.eval.totalForceN,
      totalForceMagN: st.eval.totalForceMagN,
      bodies: st.eval.bodies.map(b => ({hash: b.hash, name: b.name, material: b.material, forceN: b.forceN, forceMagN: b.forceMagN}))
    };
  }

  function torqueOf(hash) {
    owner(hash);
    const st = states.get(hash);
    if (!st?.eval) throw fail('NO_RESULT', 'Run Solve Frame or Solve Animation before reading Torque.');
    return {
      frame: st.frame,
      totalTorqueNm: st.eval.totalTorqueNm,
      totalTorqueMagNm: st.eval.totalTorqueMagNm,
      bodies: st.eval.bodies.map(b => ({hash: b.hash, name: b.name, material: b.material, torqueNm: b.torqueNm, torqueMagNm: b.torqueMagNm}))
    };
  }

  function measureOf(hash) {
    const n = findAny(hash);
    if (n.type === 'magneto_probe') {
      const ownerHash = n.params.Magneto;
      const st = ownerHash ? states.get(ownerHash) : null;
      if (!st?.eval) throw fail('NO_RESULT', 'Run Solve Frame or Solve Animation on the Magneto owner before measuring.');
      return samplePointReading(st.model, st.eval.B, st.eval.H, st.eval.M, st.eval.sat, Array.from(D.world(hash)).slice(12, 15), {hash, name: n.name});
    }
    owner(hash);
    const st = states.get(hash);
    if (!st?.eval) throw fail('NO_RESULT', 'Run Solve Frame or Solve Animation before measuring.');
    return {
      frame: st.frame,
      maxBT: st.eval.maxBT, maxHAm: st.eval.maxHAm, peakSatPct: st.eval.peakSatPct, energyJ: st.eval.energyJ,
      bodies: st.eval.bodies,
      probes: gatherProbesForOwner(hash).map(p => samplePointReading(st.model, st.eval.B, st.eval.H, st.eval.M, st.eval.sat, p.worldMm, p))
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
    const idx3 = (x, y, z) => x + nx * (y + ny * z);
    let bestC = -1, bestDist = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      if (cx < 0 || cx >= nx || cy < 0 || cy >= ny || cz < 0 || cz >= nz) continue;
      const cand = idx3(cx, cy, cz);
      if (st.model.cellKind[cand] === CELL_KIND.AIR) continue;
      const dist = Math.hypot(g[0] - (cx + 0.5), g[1] - (cy + 0.5), g[2] - (cz + 0.5));
      if (dist < bestDist) { bestDist = dist; bestC = cand; }
    }
    if (bestC < 0 || bestDist > 1.75) return null;
    const bi = st.model.cellBodyIdx[bestC];
    const body = bi >= 0 ? st.model.bodies[bi] : null;
    const matName = body?.material.name || ROLE_LABELS[st.model.cellKind[bestC]];
    const kind = st.model.cellKind[bestC];
    if (st.mode === 'Voxels' || !st.eval) {
      const extra = kind === CELL_KIND.HARD ? ` (${body?.material.magnetization || '+Z'})` : '';
      return {text: `${matName}${extra} · ${ROLE_LABELS[kind]}`};
    }
    const bT = st.eval.B[4*bestC+3];
    const bStr = bT >= 0.05 ? `${fmtNum(bT)} T` : `${fmtNum(bT * 1000)} mT`;
    if (kind === CELL_KIND.CONDUCTOR) {
      const jAmm2 = st.eval.cellJ ? st.eval.cellJ[4*bestC+3] * 1e-6 : 0;
      return {text: `${bStr} · J ${fmtNum(jAmm2)} A/mm² · ${matName}`};
    }
    const satPct = st.eval.sat[bestC] * 100;
    const hStr = `${fmtNum(st.eval.H[4*bestC+3] * 1e-3)} kA/m`;
    if (kind === CELL_KIND.HARD) {
      const rem = persistentM.get(hash)?.get(body?.hash)?.modified ? ' · Remag' : '';
      return {text: `${bStr} · M ${fmtNum(satPct)}% · ${hStr} · ${matName}${rem}`};
    }
    return {text: `${bStr} · Sat ${fmtNum(satPct)}% · ${hStr} · ${matName}`};
  }

  // ---------- Operations Registry ----------

  const createHelper = type => async hash => {
    owner(hash);
    let n;
    D.transaction(() => {
      n = D.create(type, hash, type === 'magneto_current' ? 'Current' : 'Probe');
      n.params.Magneto = hash;
      D.select(n.nativeHash, 'objects');
    });
    await context.editor.selectOwner(n.nativeHash);
    return {hash: n.nativeHash, type: n.type};
  };

  const setMapMode = mode => hash => {
    owner(hash);
    const st = states.get(hash);
    if (!st?.model) throw fail('NO_RESULT', 'Run Show Voxels, Solve Frame or Solve Animation first.');
    if (mode !== 'Voxels' && !st.eval) throw fail('NO_RESULT', 'Run Solve Frame or Solve Animation first.');
    st.mode = mode;
    rebuildVisualBuffers(hash);
    refresh();
    return {mode};
  };

  const toggleStrokes = hash => {
    owner(hash);
    const st = states.get(hash);
    if (!st?.eval) throw fail('NO_RESULT', 'Run Solve Frame or Solve Animation first.');
    st.strokesEnabled = !st.strokesEnabled;
    rebuildStrokesBuffer(hash);
    refresh();
    return {strokesEnabled: st.strokesEnabled};
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
    rebuildStrokesBuffer(hash);
    refresh();
    return {...sl};
  };

  context.operations.register([
    {id: 'status', description: 'Inspect Magneto domain, grid stats, fields, forces, torques, persistent magnetization, currents and probes.', inputSchema: emptySchema, readOnly: true, run: statusOf},
    {id: 'show-voxels', description: 'Voxelize Magneto soft/hard/conductor geometry and display pole/material voxel roles.', inputSchema: emptySchema, readOnly: false, run: runShowVoxels},
    {id: 'solve-frame', description: 'Run GPU 3D nonlinear magnetostatic solve (saturation, vector hysteresis remagnetization, 3D conductor currents and forces/torques).', inputSchema: {type: 'object', properties: {tolerance: {type: 'number', minimum: 1e-7, maximum: 1e-2}, maxIterations: {type: 'integer', minimum: 10, maximum: 3000}, maxOuterIterations: {type: 'integer', minimum: 1, maximum: 40}}, additionalProperties: false}, readOnly: false, run: runSolveFrame},
    {id: 'solve-animation', description: 'Run chronological GPU nonlinear magnetostatic animation across the timeline carrying persistent magnetization and recording Curves.', inputSchema: {type: 'object', properties: {firstFrame: {type: 'integer', minimum: 0}, lastFrame: {type: 'integer', minimum: 0}, tolerance: {type: 'number', minimum: 1e-7, maximum: 1e-2}, maxIterations: {type: 'integer', minimum: 10, maximum: 2000}}, additionalProperties: false}, readOnly: false, run: runSolveAnimation},
    {id: 'stop', description: 'Cancel any active Magneto calculation.', inputSchema: emptySchema, readOnly: false, run: hash => { owner(hash); cancelJob(hash); return statusOf(hash); }},
    {id: 'reset-magnetization', description: 'Reset persistent remagnetized state of all hard magnets back to their authored initial Magnetization.', inputSchema: emptySchema, readOnly: false, run: runResetMagnetization},
    {id: 'create-current', description: 'Create a 100×100 mm native Current cut plane (+Z normal) linked to this Magneto owner.', inputSchema: emptySchema, readOnly: false, run: createHelper('magneto_current')},
    {id: 'create-probe', description: 'Create a 2 mm native Gaussmeter Probe helper linked to this Magneto owner.', inputSchema: emptySchema, readOnly: false, run: createHelper('magneto_probe')},
    {id: 'force', description: 'Read Maxwell Stress Tensor and Lorentz Force (N) for every tagged body.', inputSchema: emptySchema, readOnly: true, run: forceOf},
    {id: 'torque', description: 'Read Maxwell Stress Tensor and Lorentz Torque (N·m) about each tagged body pivot.', inputSchema: emptySchema, readOnly: true, run: torqueOf},
    {id: 'measure', description: 'Read magnetic field B, H and region at a Probe or all Probes on a Magneto owner.', inputSchema: emptySchema, readOnly: true, run: measureOf},
    {id: 'slice', description: 'Configure interactive magnetic Slice plane axis (Off/X/Y/Z) and position (0..100%).', inputSchema: {type: 'object', properties: {axis: {type: 'string', enum: ['Off', 'X', 'Y', 'Z']}, position: {type: 'number', minimum: 0, maximum: 100}}, additionalProperties: false}, readOnly: false, run: setSlice},
    {id: 'toggle-strokes', description: 'Toggle 3D magnetic field arrow strokes.', inputSchema: emptySchema, readOnly: false, run: toggleStrokes},
    ...['B', 'H', 'M', 'Sat', 'Voxels'].map(mode => ({
      id: 'map-' + mode.toLowerCase(),
      description: 'Switch Magneto Attributes display map to ' + mode + '.',
      inputSchema: emptySchema, readOnly: false, run: setMapMode(mode)
    })),
    ...['Off', 'X', 'Y', 'Z'].map(axis => ({
      id: 'slice-' + axis.toLowerCase(),
      description: 'Set Magneto Slice plane to ' + axis + '.',
      inputSchema: emptySchema, readOnly: false, run: hash => setSlice(hash, {axis})
    }))
  ]);

  // ---------- Editor Hooks & Attributes ----------

  function syncLiveOwners() {
    invalidateNodeIndex();
    const live = new Set(D.nodes.filter(n => n.type === 'magneto').map(n => n.nativeHash));
    for (const hash of [...states.keys()]) if (!live.has(hash)) retireOwner(hash);
    for (const hash of live) {
      const st = states.get(hash);
      const busy = st?.job && ['queued', 'solving'].includes(st.job.state);
      if (st?.model && !busy && st.signature) {
        try {
          if (magnetoSignature(hash) !== st.signature) {
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
      invalidateNodeIndex();
      if (n.type === 'magneto_probe') {
        n.creationFrame = Array.from(PROBE_CREATION_FRAME);
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
      if (n.type === 'magneto_current') { validateCurrentParameters(D, {...n.params, ...changes}); return {}; }
      if (n.type === 'magneto_probe') {
        const value = changes.Magneto ?? n.params.Magneto;
        if (typeof value !== 'string' || (value && !D.nodes.some(q => q.nativeHash === value && q.type === 'magneto')))
          throw fail('INVALID_ARGUMENT', 'Select a Magneto object.');
        return {};
      }
      if (n.type !== 'magneto') return null;
      validateMagnetoParameters({...n.params, ...changes});
      return {};
    },
    // Core suppresses this fallback for effective (including inherited) Frame materials.
    surfaceStyle: hash => {
      const node = findNode(hash);
      if (!node || node.tags?.some(t => t.kind === 'material')) return null;
      const matTag = node.tags?.find(t => t.kind === 'magneto');
      const name = matTag?.params?.Material;
      if (!name) return null;
      if (name === 'Custom') return {color: [0.56, 0.52, 0.64, 1], topmost: false};
      const base = MATERIALS[name];
      if (!base) return null;
      return {color: [...base.color, 1], topmost: false};
    },
    rowColor: n => {
      if (n.type === 'magneto' && (states.get(n.nativeHash)?.job?.state === 'failed' || states.get(n.nativeHash)?.error)) return '#ee554b';
      if ((n.type === 'magneto_current' || n.type === 'magneto_probe') && n.params.Magneto && !D.nodes.some(q => q.nativeHash === n.params.Magneto && q.type === 'magneto')) return '#ee554b';
      return null;
    },
    surfaceFilter: meshHash => {
      for (const entry of filterCache.values()) {
        if (entry.hashes?.has(meshHash)) return entry;
      }
      return null;
    },
    bounds: hash => {
      const n = findNode(hash);
      if (n?.type !== 'magneto') return null;
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
    if (n.type === 'magneto_probe') {
      const ownerHash = n.params.Magneto;
      const st = ownerHash ? states.get(ownerHash) : null;
      const reading = st?.eval ? samplePointReading(st.model, st.eval.B, st.eval.H, st.eval.M, st.eval.sat, Array.from(D.world(hash)).slice(12, 15)) : null;
      return {
        hiddenFields: ['Magneto'],
        readouts: [
          {id: 'probe-b', label: '|B| (mT)', columns: [''], values: reading?.inside ? [fmtNum(reading.BmT)] : null, series: ownerHash ? () => readoutSeries(ownerHash, 'probe-b', `${n.name} B`, 'mT', hash, true) : null},
          {id: 'probe-bxyz', label: 'B (mT)', columns: ['X', 'Y', 'Z'], values: reading?.inside ? reading.BVecmT.map(fmtNum) : null, series: ownerHash ? () => readoutSeries(ownerHash, 'probe-b', `${n.name} B`, 'mT', hash, true) : null},
          {id: 'probe-h', label: '|H| (kA/m)', columns: [''], values: reading?.inside ? [fmtNum(reading.HkAm)] : null, series: ownerHash ? () => readoutSeries(ownerHash, 'probe-h', `${n.name} H`, 'kA/m', hash, false) : null},
          {id: 'probe-region', label: 'Region', columns: [''], values: reading ? [reading.region] : null}
        ]
      };
    }
    if (n.type === 'magneto_current') {
      const ownerHash = n.params.Magneto;
      const st = ownerHash ? states.get(ownerHash) : null;
      const pr = st?.currentPlanes?.find(p => p.hash === hash) || null;
      return {
        hiddenFields: ['Magneto'],
        units: {'Current Density': 'A/mm²'},
        readouts: [
          {id: 'cur-amps', label: 'Current (A)', columns: [''], values: pr ? [pr.openCircuit ? 'Open circuit' : fmtNum(pr.totalCurrentA)] : null},
          {id: 'cur-area', label: 'Cut area (mm²)', columns: [''], values: pr && pr.cutAreaMm2 > 0 ? [fmtNum(pr.cutAreaMm2)] : null}
        ]
      };
    }

    const st = states.get(hash), job = st?.job;
    const busy = job && ['queued', 'solving'].includes(job.state);
    const errText = job?.state === 'failed'
      ? (job.error?.code === 'GRID_CAPACITY' ? 'Grid too dense' : job.error?.code === 'SHEARED_DOMAIN' ? 'Sheared box' : job.error?.code === 'NO_MAGNETO_GEOMETRY' ? 'No geometry' : 'Failed')
      : '';
    const hasModel = !!st?.model, hasEval = !!st?.eval;
    const remag = hasRemagnetizedState(hash);
    const sl = getSlice(hash);

    const bodyReadouts = [];
    if (hasEval && st.eval.bodies?.length) {
      for (const b of st.eval.bodies.slice(0, 6)) {
        const shortName = b.name.length > 14 ? b.name.slice(0, 13) + '…' : b.name;
        bodyReadouts.push({
          id: 'force-' + b.hash,
          label: `${shortName} F (N)`,
          columns: ['X', 'Y', 'Z'],
          values: b.forceN.map(fmtNum),
          series: () => readoutSeries(hash, 'body-force', `${b.name} Force`, 'N', b.hash, true)
        });
        bodyReadouts.push({
          id: 'torque-' + b.hash,
          label: `${shortName} τ (N·m)`,
          columns: ['X', 'Y', 'Z'],
          values: b.torqueNm.map(fmtNum),
          series: () => readoutSeries(hash, 'body-torque', `${b.name} Torque`, 'N·m', b.hash, true)
        });
      }
    }

    return {
      units: {'Voxel size': 'mm'},
      actions: [
        {id: 'show-voxels',         row: 'Grid',    label: 'Show Voxels', cancel: 'stop', busy: busy && job.kind === 'show-voxels',     disabled: busy && job.kind !== 'show-voxels',     progress: job?.kind === 'show-voxels' ? (busy ? job.progress : errText) : ''},
        {id: 'solve-frame',         row: 'Solve',   label: 'Frame',       cancel: 'stop', busy: busy && job.kind === 'solve-frame',     disabled: busy && job.kind !== 'solve-frame',     progress: job?.kind === 'solve-frame' ? (busy ? job.progress : errText) : ''},
        {id: 'solve-animation',     row: 'Solve',   label: 'Animation',   cancel: 'stop', busy: busy && job.kind === 'solve-animation', disabled: busy && job.kind !== 'solve-animation', progress: job?.kind === 'solve-animation' ? (busy ? job.progress : errText) : ''},
        {id: 'reset-magnetization', row: 'Solve',   label: 'Reset M',     hidden: !remag, disabled: busy},
        {id: 'create-current',      row: 'Add',     label: 'Current',     disabled: busy},
        {id: 'create-probe',        row: 'Add',     label: 'Probe',       disabled: busy},
        {id: 'map-b',               row: 'Display', label: 'B',           hidden: !hasEval,  active: hasEval && st.mode === 'B'},
        {id: 'map-h',               row: 'Display', label: 'H',           hidden: !hasEval,  active: hasEval && st.mode === 'H'},
        {id: 'map-m',               row: 'Display', label: 'M',           hidden: !hasEval,  active: hasEval && st.mode === 'M'},
        {id: 'map-sat',             row: 'Display', label: 'Sat',         hidden: !hasEval,  active: hasEval && st.mode === 'Sat'},
        {id: 'map-voxels',          row: 'Display', label: 'Voxels',      hidden: !hasModel, active: hasModel && st.mode === 'Voxels'},
        {id: 'toggle-strokes',      row: 'Display', label: 'Strokes',     hidden: !hasEval,  active: hasEval && !!st.strokesEnabled},
        {id: 'slice-off',           row: 'Slice',   label: 'Off',         hidden: !hasEval,  active: hasEval && sl.axis === 'Off'},
        {id: 'slice-x',             row: 'Slice',   label: 'X',           hidden: !hasEval,  active: hasEval && sl.axis === 'X'},
        {id: 'slice-y',             row: 'Slice',   label: 'Y',           hidden: !hasEval,  active: hasEval && sl.axis === 'Y'},
        {id: 'slice-z',             row: 'Slice',   label: 'Z',           hidden: !hasEval,  active: hasEval && sl.axis === 'Z'}
      ],
      numbers: [
        {id: 'slice-pos', label: 'Slice (%)', visible: hasEval && sl.axis !== 'Off', value: sl.position, min: 0, max: 100, set: v => { sl.position = clamp(v, 0, 100); updateDomainUniforms(hash); rebuildStrokesBuffer(hash); context.requestDraw?.(); }}
      ],
      readouts: [
        {id: 'max-b',    label: 'Max |B| (T)',    columns: [''], values: hasEval ? [fmtNum(st.eval.maxBT)] : null,       series: () => readoutSeries(hash, 'maxBT', 'Max |B|', 'T')},
        {id: 'max-h',    label: 'Max |H| (kA/m)', columns: [''], values: hasEval ? [fmtNum(st.eval.maxHAm * 1e-3)] : null, series: () => readoutSeries(hash, 'maxHkAm', 'Max |H|', 'kA/m')},
        {id: 'peak-sat', label: 'Peak Sat (%)',   columns: [''], values: hasEval && st.model.stats.softCount > 0 ? [fmtNum(st.eval.peakSatPct)] : null, series: () => readoutSeries(hash, 'peakSatPct', 'Peak Sat', '%')},
        {id: 'energy',   label: 'Energy (J)',     columns: [''], values: hasEval ? [fmtNum(st.eval.energyJ)] : null,     series: () => readoutSeries(hash, 'energyJ', 'Energy', 'J')},
        ...bodyReadouts,
        {id: 'grid',     label: 'Grid',           columns: [''], values: hasModel ? [`${st.model.domain.cells.join('×')} (${st.model.stats.solidCount})`] : null}
      ]
    };
  });

  // ---------- Viewport Registration ----------

  const boxLines = makeBoxLines();
  const currentLines = makeCurrentPlaneLines();
  const probeLines = makeProbeLines();
  const unitBounds = {min: [-50, -50, -50], max: [50, 50, 50]};

  await context.viewport.register({
    retire: retireOwner,
    renderKind: 'overlay',
    renderStage: 'opaque',
    surfaceWarnings: false,
    surfaceOrder: 'selected-smallest',
    showHelper: (hash, params) => {
      const n = findNode(hash);
      if (n?.type === 'magneto') return !params['Auto size'];
      return true;
    },
    surfaceProbe,
    render: ({pass, camera, orthographic, hash, device, format}) => {
      const n = findNode(hash);
      if (n?.type !== 'magneto') return;
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

      // 1) Solid display: Smooth mesh via 3D RGBA16Float texture (B/H/M/Sat) OR Voxel shell (Voxels)
      if (st.mode !== 'Voxels' && st.eval && st.solidTex && st.domUniformBuf && st.meshEntries?.length) {
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
      } else if (st.voxelBuf && st.voxelVerts > 0) {
        pass.setPipeline(pipes.display[oIdx]);
        pass.setBindGroup(0, camGroup);
        pass.setVertexBuffer(0, st.voxelBuf);
        pass.draw(st.voxelVerts);
      }

      // 2) 3D Magnetic field strokes / arrows
      if (st.eval && st.strokesEnabled && st.strokeBuf && st.strokeVerts > 0) {
        pass.setPipeline(pipes.display[oIdx]);
        pass.setBindGroup(0, camGroup);
        pass.setVertexBuffer(0, st.strokeBuf);
        pass.draw(st.strokeVerts);
      }

      // 3) Interactive magnetic field Slice plane
      const sl = getSlice(hash);
      if (st.eval && sl.axis !== 'Off' && st.fieldTex && st.sliceUniformBuf) {
        if (!st.fieldSliceBG) {
          st.fieldSliceBG = device.createBindGroup({
            layout: renderState.fieldLayout,
            entries: [
              {binding: 0, resource: st.fieldTex.createView()},
              {binding: 1, resource: renderState.sampler},
              {binding: 2, resource: {buffer: st.sliceUniformBuf}}
            ]
          });
        }
        pass.setPipeline(pipes.slice[oIdx]);
        pass.setBindGroup(0, camGroup);
        pass.setBindGroup(1, st.fieldSliceBG);
        pass.draw(6);
      }
    },
    bounds: unitBounds,
    lines: boxLines,
    helpers: {
      magneto_current: {bounds: {min: [-50, -50, 0], max: [50, 50, 32]}, lines: currentLines},
      magneto_probe: {bounds: unitBounds, lines: probeLines}
    },
    color: [0.741, 0.584, 0.839, 1],
    selectedColor: [0.87, 0.73, 1, 1],
    settings: () => [0, 0, 0, 0],
    shader: 'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'
  });
}
