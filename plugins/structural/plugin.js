// Structural: GPU matrix-free Hex8 FEM, unilateral frictionless contact,
// SIMP topology optimization, Force visualization, surfaceProbe and Curves readouts.
const MM_TO_M = 0.001, M_TO_MM = 1000;
const GRAVITY_WORLD = Object.freeze([0, -9.80665, 0]);
const MAX_CELLS = 262144;
const CORNERS = Object.freeze([
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1]
].map(Object.freeze));
const FACE_DIRS = Object.freeze([
  {axis:0, sign:-1, corners:[0,3,7,4]},
  {axis:0, sign: 1, corners:[1,2,6,5]},
  {axis:1, sign:-1, corners:[0,1,5,4]},
  {axis:1, sign: 1, corners:[3,2,6,7]},
  {axis:2, sign:-1, corners:[0,1,2,3]},
  {axis:2, sign: 1, corners:[4,5,6,7]}
]);
const FACE_QUADS = Object.freeze([
  {axis:0, sign:-1, corners:[0,4,7,3], normal:[-1,0,0]},
  {axis:0, sign: 1, corners:[1,2,6,5], normal:[ 1,0,0]},
  {axis:1, sign:-1, corners:[0,1,5,4], normal:[0,-1,0]},
  {axis:1, sign: 1, corners:[3,7,6,2], normal:[0, 1,0]},
  {axis:2, sign:-1, corners:[0,3,2,1], normal:[0,0,-1]},
  {axis:2, sign: 1, corners:[4,5,6,7], normal:[0,0, 1]}
]);

export const MATERIALS = Object.freeze({
  'Steel':               Object.freeze({young:200e9,  poisson:0.30,  yieldStrength:250e6, density:7850, color:[0.58,0.65,0.72]}),
  'Stainless Steel':     Object.freeze({young:193e9,  poisson:0.29,  yieldStrength:215e6, density:8000, color:[0.68,0.72,0.76]}),
  'Aluminium 6061':      Object.freeze({young:68.9e9, poisson:0.33,  yieldStrength:276e6, density:2700, color:[0.74,0.78,0.82]}),
  'Titanium Ti-6Al-4V':  Object.freeze({young:113.8e9,poisson:0.342, yieldStrength:880e6, density:4430, color:[0.64,0.63,0.68]}),
  'Brass':               Object.freeze({young:97e9,   poisson:0.31,  yieldStrength:200e6, density:8500, color:[0.80,0.68,0.38]}),
  'Copper':              Object.freeze({young:117e9,  poisson:0.34,  yieldStrength:70e6,  density:8960, color:[0.82,0.48,0.36]}),
  'PLA':                 Object.freeze({young:3.5e9,  poisson:0.36,  yieldStrength:50e6,  density:1240, color:[0.52,0.70,0.60]}),
  'PETG':                Object.freeze({young:2.1e9,  poisson:0.38,  yieldStrength:48e6,  density:1270, color:[0.46,0.66,0.76]}),
  'ABS':                 Object.freeze({young:2.3e9,  poisson:0.35,  yieldStrength:40e6,  density:1040, color:[0.72,0.66,0.56]}),
  'Nylon PA12':          Object.freeze({young:1.7e9,  poisson:0.40,  yieldStrength:45e6,  density:1010, color:[0.76,0.76,0.74]}),
  'Carbon Fiber':        Object.freeze({young:70e9,   poisson:0.30,  yieldStrength:600e6, density:1600, color:[0.32,0.34,0.38]}),
  'Concrete':            Object.freeze({young:30e9,   poisson:0.20,  yieldStrength:30e6,  density:2400, color:[0.60,0.59,0.57]})
});

// Voxel role flags for Show Voxels contact/weld/cut visualization
export const ROLE = Object.freeze({
  MATERIAL:        0,
  WELD_FIXTURE:    1,
  CONTACT_FIXTURE: 2,
  WELD_BODY:       3,
  CONTACT_BODY:    4,
  CUT_FIXED:       5,
  PRESERVE:        6,
  OPTIMIZE_SPACE:  7
});
const ROLE_LABELS = Object.freeze([
  'Material',
  'Welded to Fixture',
  'Frictionless Fixture Contact',
  'Welded Overlap',
  'Frictionless Body Contact',
  'Box Cut Fixed',
  'Preserve',
  'Optimize Space'
]);
const ROLE_COLORS = Object.freeze([
  [0.54, 0.62, 0.70], // Material
  [0.18, 0.82, 0.68], // Welded to Fixture
  [0.95, 0.78, 0.22], // Frictionless Fixture Contact
  [0.24, 0.74, 0.84], // Welded body overlap
  [0.95, 0.52, 0.18], // Frictionless body contact
  [0.78, 0.34, 0.82], // Box cut fixed
  [0.28, 0.56, 0.96], // Preserve
  [0.64, 0.72, 0.34]  // Optimize Space
]);

const failure = (code, message) => Object.assign(new Error(message), {code});
const emptySchema = {type:'object', properties:{}, additionalProperties:false};
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const sub3 = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add3 = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scale3 = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const fmtNum = v => !Number.isFinite(v) ? '∞' : (v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) >= 1e5)) ? v.toExponential(2) : String(Number(v.toPrecision(4)));

export function validateParameters(params) {
  if (typeof params['Auto size'] !== 'boolean') throw failure('INVALID_ARGUMENT', 'Auto size must be boolean.');
  if (!Number.isFinite(params['Voxel size']) || params['Voxel size'] < 1e-6) throw failure('INVALID_ARGUMENT', 'Voxel size must be a positive number in mm.');
  if (!Number.isFinite(params['Material (%)']) || params['Material (%)'] < 1e-6 || params['Material (%)'] > 100) throw failure('INVALID_ARGUMENT', 'Material (%) must be between 0 and 100.');
}

// ---------- Hex8 elasticity & stiffness (Float64, SI) ----------

export function materialElasticity({young, poisson, yieldStrength, density = 1}) {
  if (!Number.isFinite(young) || young <= 0) throw failure('INVALID_MATERIAL', 'Young modulus must be positive.');
  if (!Number.isFinite(yieldStrength) || yieldStrength <= 0) throw failure('INVALID_MATERIAL', 'Yield strength must be positive.');
  if (!Number.isFinite(poisson) || poisson <= -1 || poisson >= 0.5) throw failure('INVALID_MATERIAL', 'Poisson ratio must be in (-1, 0.5).');
  if (!Number.isFinite(density) || density <= 0) throw failure('INVALID_MATERIAL', 'Density must be positive.');
  const mu = young / (2 * (1 + poisson));
  const lambda = young * poisson / ((1 + poisson) * (1 - 2 * poisson));
  const D = new Float64Array(36);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) D[a * 6 + b] = lambda + (a === b ? 2 * mu : 0);
  D[21] = D[28] = D[35] = mu;
  return {young, poisson, yieldStrength, density, D};
}

export function strainMatrix(spacing, local = [0, 0, 0]) {
  const B = new Float64Array(6 * 24);
  for (let a = 0; a < 8; a++) {
    const s = CORNERS[a].map(v => 2 * v - 1);
    const d = s.map((v, k) => v / (4 * spacing[k]) * (1 + s[(k+1)%3] * local[(k+1)%3]) * (1 + s[(k+2)%3] * local[(k+2)%3]));
    const c = 3 * a;
    B[c] = d[0]; B[24 + c + 1] = d[1]; B[48 + c + 2] = d[2];
    B[72 + c] = d[1]; B[72 + c + 1] = d[0];
    B[96 + c + 1] = d[2]; B[96 + c + 2] = d[1];
    B[120 + c] = d[2]; B[120 + c + 2] = d[0];
  }
  return B;
}

export function hex8Stiffness(spacing, mat) {
  const {D} = mat.D ? mat : materialElasticity(mat);
  const K = new Float64Array(576), g = 1 / Math.sqrt(3);
  const det = spacing[0] * spacing[1] * spacing[2] / 8;
  for (const x of [-g, g]) for (const y of [-g, g]) for (const z of [-g, g]) {
    const B = strainMatrix(spacing, [x, y, z]), DB = new Float64Array(144);
    for (let a = 0; a < 6; a++) for (let j = 0; j < 24; j++) {
      let s = 0; for (let b = 0; b < 6; b++) s += D[a * 6 + b] * B[b * 24 + j]; DB[a * 24 + j] = s;
    }
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
      let s = 0; for (let a = 0; a < 6; a++) s += B[a * 24 + i] * DB[a * 24 + j]; K[i * 24 + j] += s * det;
    }
  }
  return K;
}

// ---------- Physical Domain & SI Coordinate Contract ----------

export function computeManualDomain(worldMatrix, voxelSizeMm, maxCells = MAX_CELLS) {
  if (!worldMatrix || worldMatrix.length !== 16 || !Array.from(worldMatrix).every(Number.isFinite))
    throw failure('INVALID_DOMAIN', 'Structural box has an invalid world frame.');
  const pitchM = voxelSizeMm * MM_TO_M;
  if (!(pitchM > 0) || !Number.isFinite(pitchM)) throw failure('INVALID_ARGUMENT', 'Voxel size must be positive.');
  const cols = [0, 4, 8].map(o => [worldMatrix[o], worldMatrix[o+1], worldMatrix[o+2]]);
  const scales = cols.map(len3);
  if (scales.some(s => !(s > 1e-12) || !Number.isFinite(s))) throw failure('INVALID_DOMAIN', 'Structural box has zero size.');
  const basis = cols.map((c, k) => scale3(c, 1 / scales[k]));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
    if (Math.abs(dot3(basis[i], basis[j])) > 1e-4)
      throw failure('SHEARED_DOMAIN', 'Structural box frame must be orthogonal (un-sheared).');
  }
  let reflected = false;
  if (dot3(basis[0], cross3(basis[1], basis[2])) < 0) {
    basis[2] = scale3(basis[2], -1);
    reflected = true;
  }
  const lengthsM = scales.map(s => 100 * s * MM_TO_M);
  const cells = lengthsM.map(L => Math.max(1, Math.ceil(L / pitchM - 1e-9)));
  const count = cells[0] * cells[1] * cells[2];
  if (!Number.isSafeInteger(count) || count > maxCells)
    throw failure('GRID_CAPACITY', `Grid ${cells.join('×')} (${count.toLocaleString()} cells) exceeds ${maxCells.toLocaleString()} cell budget. Increase Voxel size.`);
  const spacingM = lengthsM.map((L, k) => L / cells[k]);
  // Local [-50, -50, -50] -> world origin of cell (0,0,0)
  const centerWorldM = [worldMatrix[12]*MM_TO_M, worldMatrix[13]*MM_TO_M, worldMatrix[14]*MM_TO_M];
  const originWorldM = [0, 1, 2].map(k => centerWorldM[k] - 0.5*(lengthsM[0]*basis[0][k] + lengthsM[1]*basis[1][k] + lengthsM[2]*basis[2][k]));
  return {
    autoSize: false, cutBoundaryEnabled: true, reflected,
    cells, count, spacingM, lengthsM, originWorldM, basis,
    voxelSizeMm, pitchM
  };
}

export function computeAutoDomain(worldBoundsMm, voxelSizeMm, maxCells = MAX_CELLS) {
  const pitchM = voxelSizeMm * MM_TO_M;
  if (!(pitchM > 0) || !Number.isFinite(pitchM)) throw failure('INVALID_ARGUMENT', 'Voxel size must be positive.');
  if (!worldBoundsMm) throw failure('NO_STRUCTURAL_GEOMETRY', 'No tagged geometry found for Structural Auto size.');
  const extMm = [0, 1, 2].map(k => Math.max(voxelSizeMm, worldBoundsMm.max[k] - worldBoundsMm.min[k]));
  const cells = extMm.map(L => Math.max(1, Math.ceil(L / voxelSizeMm - 1e-9)));
  const count = cells[0] * cells[1] * cells[2];
  if (!Number.isSafeInteger(count) || count > maxCells)
    throw failure('GRID_CAPACITY', `Auto-size grid ${cells.join('×')} (${count.toLocaleString()} cells) exceeds ${maxCells.toLocaleString()} cell budget. Increase Voxel size.`);
  const spacingM = [pitchM, pitchM, pitchM];
  const lengthsM = cells.map(n => n * pitchM);
  const centerM = [0, 1, 2].map(k => 0.5 * (worldBoundsMm.min[k] + worldBoundsMm.max[k]) * MM_TO_M);
  const originWorldM = [0, 1, 2].map(k => centerM[k] - 0.5 * lengthsM[k]);
  return {
    autoSize: true, cutBoundaryEnabled: false, reflected: false,
    cells, count, spacingM, lengthsM, originWorldM,
    basis: [[1,0,0],[0,1,0],[0,0,1]],
    voxelSizeMm, pitchM
  };
}

// Convert a 4x4 Float64 world matrix (mm) into a column-major Float32 matrix mapping local mesh coords (mm)
// directly to padded grid coordinates (cells + pad).
function meshToGridMatrix(meshWorldMm, domain, pad) {
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
  out[12] = dot3(t, bx) * inv[0] + pad;
  out[13] = dot3(t, by) * inv[1] + pad;
  out[14] = dot3(t, bz) * inv[2] + pad;
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

// ---------- Conserved Total Force + Torque Mapping (Float64, SI) ----------

export function regionWrench(nodePositionsM, elementNodes, selectedElems, {force, torque, pivot}) {
  const weights = new Map();
  if (!selectedElems.length) return {loads: new Map(), applied: false};
  const invW = 1 / (8 * selectedElems.length);
  for (const e of selectedElems) {
    const base = 8 * e;
    for (let a = 0; a < 8; a++) {
      const n = elementNodes[base + a];
      weights.set(n, (weights.get(n) || 0) + invW);
    }
  }
  const center = [0, 0, 0];
  for (const [n, w] of weights) {
    center[0] += w * nodePositionsM[3*n];
    center[1] += w * nodePositionsM[3*n+1];
    center[2] += w * nodePositionsM[3*n+2];
  }
  const arm = sub3(center, pivot);
  const offset = cross3(arm, force);
  const moment = sub3(torque, offset);
  const momentNorm = len3(moment);
  const loads = new Map();
  if (momentNorm <= 1e-15 * Math.max(1, len3(force) * len3(arm), len3(torque))) {
    for (const [n, w] of weights) loads.set(n, scale3(force, w));
    return {loads, applied: true, center, pivot, force, torque};
  }
  const J = new Float64Array(9);
  for (const [n, w] of weights) {
    const r = [nodePositionsM[3*n]-center[0], nodePositionsM[3*n+1]-center[1], nodePositionsM[3*n+2]-center[2]];
    const rr = dot3(r, r);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) J[3*i+j] += w * ((i === j ? rr : 0) - r[i]*r[j]);
  }
  const scale = Math.max(J[0], J[4], J[8]);
  if (!(scale > 0) || !Number.isFinite(scale))
    throw failure('UNREPRESENTABLE_MOMENT', 'Force region cannot represent the requested torque/moment.');
  const L = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) {
    let s = J[3*i+j] / scale;
    for (let k = 0; k < j; k++) s -= L[3*i+k] * L[3*j+k];
    if (i === j) {
      if (!(s > 1e-12)) throw failure('UNREPRESENTABLE_MOMENT', 'Force region is too degenerate to represent the requested moment.');
      L[3*i+j] = Math.sqrt(s);
    } else L[3*i+j] = s / L[3*j+j];
  }
  const y = [0, 0, 0], q = [0, 0, 0];
  for (let i = 0; i < 3; i++) { let s = moment[i] / scale; for (let k = 0; k < i; k++) s -= L[3*i+k]*y[k]; y[i] = s / L[3*i+i]; }
  for (let i = 2; i >= 0; i--) { let s = y[i]; for (let k = i+1; k < 3; k++) s -= L[3*k+i]*q[k]; q[i] = s / L[3*i+i]; }
  for (const [n, w] of weights) {
    const r = [nodePositionsM[3*n]-center[0], nodePositionsM[3*n+1]-center[1], nodePositionsM[3*n+2]-center[2]];
    const rot = cross3(q, r);
    loads.set(n, [w*(force[0]+rot[0]), w*(force[1]+rot[1]), w*(force[2]+rot[2])]);
  }
  return {loads, applied: true, center, pivot, force, torque};
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
  dims: vec4u,   // px, py, pz, pCount
  range: vec4u,  // triStart, triEnd, vertexCount, flags (bit0=satFallback)
  scale: vec4f   // sx, sy, sz (world m scale), unused
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
  let w0 = e1 * invA; let w1 = e2 * invA; let w2 = e0 * invA;
  return select(vec3f(w0, w1, w2), vec3f(w0, w2, w1), flipped);
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

  // Z-ray parity (XY projection)
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
  // X-ray parity (YZ projection)
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
  // Y-ray parity (ZX projection)
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
  // Shrunk-box SAT (0.495 half-size): captures thin walls/sheets without falsely overlapping touching faces
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
struct ScanCfg { dims: vec4u }; // px, py, pz, pCount
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
  if (solid) {
    atomicOr(&packed[cell >> 5u], 1u << (cell & 31u));
  }
}
`;

// ---------- GPU Matrix-Free Hex8 PCG Solver (Compact Active Nodes + SIMP + Contact) ----------

const PCG_WGSL = `
struct Params {
  counts: vec4u,      // dofs, nodes, maxIter, contactEntries
  offsets: vec4u,     // nodeIncOff, contactRangeOff, unused, unused
  tolerances: vec4f   // tol2, warmStart, unused, unused
};
struct DofIn { load: f32, prescribed: f32, diagonal: f32, fixed: u32 };
struct ElemProp { mat: u32, scale: f32 };
struct Vec4State { u: f32, r: f32, p: f32, ap: f32 };
struct ContactEntry { otherDof: u32, stiffness: f32, enabled: u32, pad: u32 };
struct SolverState {
  rho: f32, curvature: f32, initial2: f32, residual2: f32,
  alpha: f32, beta: f32, spare0: f32, spare1: f32,
  status: u32, iteration: u32, spare2: u32, spare3: u32
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read> inputs: array<DofIn>;
@group(0) @binding(2) var<storage,read> matrices: array<f32>;
@group(0) @binding(3) var<storage,read> topo: array<u32>;
@group(0) @binding(4) var<storage,read> elemProps: array<ElemProp>;
@group(0) @binding(5) var<storage,read> contactEntries: array<ContactEntry>;
@group(0) @binding(6) var<storage,read_write> vectors: array<Vec4State>;
@group(0) @binding(7) var<storage,read_write> state: SolverState;

fn finite(x: f32) -> bool { return x == x && abs(x) < 3e38; }

fn action(dof: u32, useP: bool) -> f32 {
  let node = dof / 3u;
  let comp = dof % 3u;
  let baseInc = params.offsets.x + node * 8u;
  var sum = 0.0;
  for (var s = 0u; s < 8u; s++) {
    let packed = topo[baseInc + s];
    if (packed == 0xffffffffu) { break; }
    let e = packed >> 3u;
    let a = packed & 7u;
    let ep = elemProps[e];
    if (ep.scale <= 0.0) { continue; }
    let row = ep.mat * 576u + (a * 3u + comp) * 24u;
    let eBase = e * 8u;
    let na = 3u * topo[eBase + a];
    let va0 = select(vectors[na].u, vectors[na].p, useP);
    let va1 = select(vectors[na + 1u].u, vectors[na + 1u].p, useP);
    let va2 = select(vectors[na + 2u].u, vectors[na + 2u].p, useP);
    var local = 0.0;
    for (var b = 0u; b < 8u; b++) {
      let nb = 3u * topo[eBase + b];
      let v0 = select(vectors[nb].u, vectors[nb].p, useP) - va0;
      let v1 = select(vectors[nb + 1u].u, vectors[nb + 1u].p, useP) - va1;
      let v2 = select(vectors[nb + 2u].u, vectors[nb + 2u].p, useP) - va2;
      local += matrices[row + 3u*b] * v0 + matrices[row + 3u*b + 1u] * v1 + matrices[row + 3u*b + 2u] * v2;
    }
    sum += ep.scale * local;
  }
  if (params.counts.w > 0u) {
    let crOff = params.offsets.y + dof * 2u;
    let rng0 = topo[crOff];
    let rng1 = topo[crOff + 1u];
    let selfV = select(vectors[dof].u, vectors[dof].p, useP);
    for (var k = rng0; k < rng1; k++) {
      let ce = contactEntries[k];
      if (ce.enabled != 0u) {
        let otherV = select(vectors[ce.otherDof].u, vectors[ce.otherDof].p, useP);
        sum += ce.stiffness * (selfV - otherV);
      }
    }
  }
  return sum;
}

@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) tid: vec3u) {
  let i = tid.x; if (i >= params.counts.x) { return; }
  let uInit = select(vectors[i].u, inputs[i].prescribed, inputs[i].fixed != 0u);
  vectors[i] = Vec4State(select(0.0, uInit, params.tolerances.y > 0.5 || inputs[i].fixed != 0u), 0.0, 0.0, 0.0);
}

@compute @workgroup_size(64)
fn applyU(@builtin(global_invocation_id) tid: vec3u) {
  let i = tid.x; if (i >= params.counts.x) { return; }
  vectors[i].ap = action(i, false);
}

@compute @workgroup_size(64)
fn applyP(@builtin(global_invocation_id) tid: vec3u) {
  let i = tid.x; if (i >= params.counts.x || state.status != 0u) { return; }
  vectors[i].ap = select(action(i, true), 0.0, inputs[i].fixed != 0u);
}

@compute @workgroup_size(64)
fn residual(@builtin(global_invocation_id) tid: vec3u) {
  let i = tid.x; if (i >= params.counts.x) { return; }
  let r = select(inputs[i].load - vectors[i].ap, 0.0, inputs[i].fixed != 0u);
  vectors[i].r = r;
  vectors[i].p = r / inputs[i].diagonal;
}

var<workgroup> sums: array<vec2f, 64>;
fn total(lane: u32, value: vec2f) -> vec2f {
  sums[lane] = value;
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride /= 2u) {
    if (lane < stride) { sums[lane] += sums[lane + stride]; }
    workgroupBarrier();
  }
  return sums[0];
}

@compute @workgroup_size(64)
fn initialReduce(@builtin(local_invocation_index) lane: u32) {
  var s = vec2f(0.0);
  var f2 = 0.0;
  for (var i = lane; i < params.counts.x; i += 64u) {
    let r = vectors[i].r;
    let fl = select(inputs[i].load, 0.0, inputs[i].fixed != 0u);
    s += vec2f(r * r, r * r / inputs[i].diagonal);
    f2 += fl * fl;
  }
  let t = total(lane, s);
  let tf = total(lane, vec2f(f2, 0.0));
  if (lane == 0u) {
    let ref2 = max(t.x, tf.x);
    state.initial2 = ref2;
    state.residual2 = t.x;
    state.rho = t.y;
    state.iteration = 0u;
    state.status = select(0u, 2u, t.x <= params.tolerances.x * ref2);
    if (!finite(t.x) || !finite(t.y) || !finite(tf.x)) { state.status = 5u; }
  }
}

@compute @workgroup_size(64)
fn directionReduce(@builtin(local_invocation_index) lane: u32) {
  var s = 0.0;
  for (var i = lane; i < params.counts.x; i += 64u) { s += vectors[i].p * vectors[i].ap; }
  let t = total(lane, vec2f(s, 0.0));
  if (lane == 0u && state.status == 0u) {
    state.curvature = t.x;
    if (!finite(t.x) || !finite(state.rho)) { state.status = 5u; }
    else if (t.x <= 0.0 || state.rho <= 0.0) { state.status = 3u; }
    else { state.alpha = state.rho / t.x; if (!finite(state.alpha)) { state.status = 5u; } }
  }
}

@compute @workgroup_size(64)
fn updateUR(@builtin(global_invocation_id) tid: vec3u) {
  let i = tid.x; if (i >= params.counts.x || state.status != 0u || inputs[i].fixed != 0u) { return; }
  vectors[i].u += state.alpha * vectors[i].p;
  vectors[i].r -= state.alpha * vectors[i].ap;
}

@compute @workgroup_size(64)
fn nextReduce(@builtin(local_invocation_index) lane: u32) {
  var s = vec2f(0.0);
  for (var i = lane; i < params.counts.x; i += 64u) {
    let r = vectors[i].r;
    s += vec2f(r * r, r * r / inputs[i].diagonal);
  }
  let t = total(lane, s);
  if (lane == 0u && state.status == 0u) {
    state.iteration++;
    state.residual2 = t.x;
    state.beta = t.y / state.rho;
    state.rho = t.y;
    if (!finite(t.x) || !finite(t.y) || !finite(state.beta)) { state.status = 5u; }
    else if (t.x <= params.tolerances.x * state.initial2) { state.status = 2u; }
    else if (state.iteration >= params.counts.z) { state.status = 4u; }
  }
}

@compute @workgroup_size(64)
fn updateP(@builtin(global_invocation_id) tid: vec3u) {
  let i = tid.x; if (i >= params.counts.x || state.status != 0u) { return; }
  vectors[i].p = vectors[i].r / inputs[i].diagonal + state.beta * vectors[i].p;
}

@compute @workgroup_size(64)
fn exactReduce(@builtin(local_invocation_index) lane: u32) {
  var s = vec2f(0.0);
  for (var i = lane; i < params.counts.x; i += 64u) {
    let r = vectors[i].r;
    s += vec2f(r * r, r * r / inputs[i].diagonal);
  }
  let t = total(lane, s);
  if (lane == 0u) {
    state.residual2 = t.x;
    state.rho = t.y;
    if (!finite(t.x) || !finite(t.y)) { state.status = 5u; }
    else if (t.x <= params.tolerances.x * state.initial2) { state.status = 1u; }
    else if (state.iteration >= params.counts.z) { state.status = 4u; }
    else { state.status = 0u; }
  }
}
`;

// ---------- Mechanical Model Assembly (Overlap=Weld, Touch=Frictionless Contact, Cut=Fixed) ----------

const bitGet = (packed, i) => ((packed[i >> 5] >>> (i & 31)) & 1) !== 0;

export function buildMechanicalModel({domain, materialBodies, fixtureMask, preserveMask, optSpaceMask, forceSources, includeGravity = true}) {
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const [dx, dy, dz] = domain.spacingM, cellVol = dx * dy * dz;
  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  const cornerIdx = (x, y, z) => x + (nx + 1) * (y + (ny + 1) * z);

  if (!materialBodies.length) throw failure('NO_STRUCTURAL_MATERIAL', 'Assign a Structural Material tag to at least one solid object inside the domain.');

  // 1. Overlap graph among material bodies: overlap => weld into one mechanical component
  const parent = materialBodies.map((_, i) => i);
  const findRoot = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unionRoot = (a, b) => { const ra = findRoot(a), rb = findRoot(b); if (ra !== rb) parent[rb] = ra; };

  const cellFirstBody = new Int32Array(count).fill(-1);
  const cellWeldOverlap = new Uint8Array(count);
  for (let b = 0; b < materialBodies.length; b++) {
    const occ = materialBodies[b].occupancy;
    for (let c = 0; c < count; c++) {
      if (!bitGet(occ, c)) continue;
      if (cellFirstBody[c] >= 0) {
        unionRoot(cellFirstBody[c], b);
        cellWeldOverlap[c] = 1;
      } else {
        cellFirstBody[c] = b;
      }
    }
  }

  // Group bodies into welded components
  const compMap = new Map();
  const bodyComp = materialBodies.map((_, b) => {
    const r = findRoot(b);
    if (!compMap.has(r)) compMap.set(r, compMap.size);
    return compMap.get(r);
  });
  const compCount = compMap.size;

  // Unique material list & stiffness matrices
  const matNameToId = new Map(), materials = [], matrices = [];
  const getMatId = name => {
    if (matNameToId.has(name)) return matNameToId.get(name);
    const spec = MATERIALS[name];
    if (!spec) throw failure('INVALID_MATERIAL', 'Unknown Structural material preset: ' + name);
    const id = materials.length;
    const el = materialElasticity(spec);
    materials.push({...el, name, color: spec.color});
    matrices.push(hex8Stiffness(domain.spacingM, el));
    matNameToId.set(name, id);
    return id;
  };

  // Assign each occupied cell to its winning welded component & material
  const cellComp = new Int32Array(count).fill(-1);
  const cellElem = new Int32Array(count).fill(-1);
  const cellMat = new Int32Array(count).fill(-1);
  const cellBody = new Int32Array(count).fill(-1);
  const elemCell = [], elemMatList = [], elemCompList = [], elemBodyList = [];
  for (let c = 0; c < count; c++) {
    const b = cellFirstBody[c];
    if (b < 0) continue;
    const e = elemCell.length;
    const mId = getMatId(materialBodies[b].material);
    cellComp[c] = bodyComp[b];
    cellElem[c] = e;
    cellMat[c] = mId;
    cellBody[c] = b;
    elemCell.push(c);
    elemMatList.push(mId);
    elemCompList.push(bodyComp[b]);
    elemBodyList.push(b);
  }
  const elemCount = elemCell.length;
  if (!elemCount) throw failure('EMPTY_MATERIAL_DOMAIN', 'No solid material voxels found inside the Structural domain.');

  // 2. Allocate compact nodes per welded component so non-overlapping touching bodies stay mechanically separate
  const compNodeMaps = Array.from({length: compCount}, () => new Map());
  const nodePositionsM = [];
  const nodeGridCoords = [];
  const nodeCompList = [];
  const elemNodes = new Uint32Array(elemCount * 8);
  const nodeInc = [];

  for (let e = 0; e < elemCount; e++) {
    const c = elemCell[e], comp = elemCompList[e], nMap = compNodeMaps[comp];
    const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (let a = 0; a < 8; a++) {
      const gx = x + CORNERS[a][0], gy = y + CORNERS[a][1], gz = z + CORNERS[a][2];
      const gk = cornerIdx(gx, gy, gz);
      let nid = nMap.get(gk);
      if (nid === undefined) {
        nid = nodeCompList.length;
        nMap.set(gk, nid);
        nodeCompList.push(comp);
        nodePositionsM.push(gx * dx, gy * dy, gz * dz);
        nodeGridCoords.push(gx, gy, gz);
        for (let s = 0; s < 8; s++) nodeInc.push(0xffffffff);
      }
      elemNodes[8 * e + a] = nid;
      const base = 8 * nid;
      for (let s = 0; s < 8; s++) if (nodeInc[base + s] === 0xffffffff) { nodeInc[base + s] = (e << 3) | a; break; }
    }
  }
  const nodeCount = nodeCompList.length, dofs = 3 * nodeCount;
  const nodePosArr = Float64Array.from(nodePositionsM);
  const elemMatArr = Uint32Array.from(elemMatList);
  const nodeIncArr = Uint32Array.from(nodeInc);

  // 3. Classify roles, fixed DOFs (Fixture weld + Box Cut), unilateral Fixture contacts & Body-Body contacts
  const cellRole = new Uint8Array(elemCount).fill(ROLE.MATERIAL);
  const fixedPermanent = new Uint8Array(dofs);
  const fixtureContactsMap = new Map(); // dof -> {dof, node, axis, sign}
  const bodyContactsMap = new Map();    // key -> {dofA, dofB, nodeA, nodeB, axis, sign}
  const elemPreserve = new Uint8Array(elemCount);
  const elemOptSpace = new Uint8Array(elemCount);
  const elemLocked = new Uint8Array(elemCount);
  let hasOptSpace = false;
  let weldedFixtureCells = 0, contactFixtureCells = 0, weldedBodyCells = 0, contactBodyCells = 0, cutFixedCells = 0;

  for (let e = 0; e < elemCount; e++) {
    const c = elemCell[e], comp = elemCompList[e], b = elemBodyList[e];
    const x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    const isPreserve = preserveMask && bitGet(preserveMask, c);
    const isOptSpace = optSpaceMask && bitGet(optSpaceMask, c);
    if (isPreserve) { elemPreserve[e] = 1; elemLocked[e] = 1; cellRole[e] = ROLE.PRESERVE; }
    else if (isOptSpace) { elemOptSpace[e] = 1; hasOptSpace = true; cellRole[e] = ROLE.OPTIMIZE_SPACE; }
    if (cellWeldOverlap[c]) { weldedBodyCells++; cellRole[e] = ROLE.WELD_BODY; }

    // Fixture overlap => weld all 8 corners
    if (fixtureMask && bitGet(fixtureMask, c)) {
      weldedFixtureCells++;
      cellRole[e] = ROLE.WELD_FIXTURE;
      elemLocked[e] = 1;
      for (let a = 0; a < 8; a++) {
        const n = elemNodes[8 * e + a];
        fixedPermanent[3*n] = fixedPermanent[3*n+1] = fixedPermanent[3*n+2] = 1;
      }
    }

    // Box boundary cut ("Срез фиксируется"): if this body continues across the manual box wall into the ghost cell
    const ghostFlags = materialBodies[b].cutFaces;
    if (domain.cutBoundaryEnabled && ghostFlags) {
      const fMask = ghostFlags[c];
      if (fMask) {
        cutFixedCells++;
        elemLocked[e] = 1;
        if (cellRole[e] !== ROLE.WELD_FIXTURE) cellRole[e] = ROLE.CUT_FIXED;
        for (let fi = 0; fi < 6; fi++) {
          if ((fMask & (1 << fi)) === 0) continue;
          for (const corner of FACE_DIRS[fi].corners) {
            const n = elemNodes[8 * e + corner];
            fixedPermanent[3*n] = fixedPermanent[3*n+1] = fixedPermanent[3*n+2] = 1;
          }
        }
      }
    }

    // Face-adjacent checks: Fixture non-overlap contact + Body-Body non-overlap contact
    for (let fi = 0; fi < 6; fi++) {
      const fd = FACE_DIRS[fi];
      const nx1 = x + (fd.axis === 0 ? fd.sign : 0);
      const ny1 = y + (fd.axis === 1 ? fd.sign : 0);
      const nz1 = z + (fd.axis === 2 ? fd.sign : 0);
      if (nx1 < 0 || nx1 >= nx || ny1 < 0 || ny1 >= ny || nz1 < 0 || nz1 >= nz) continue;
      const nc = cellIdx(nx1, ny1, nz1);
      // Touching Fixture without overlap => frictionless unilateral contact
      if (fixtureMask && bitGet(fixtureMask, nc) && !bitGet(fixtureMask, c)) {
        contactFixtureCells++;
        if (cellRole[e] !== ROLE.WELD_FIXTURE && cellRole[e] !== ROLE.CUT_FIXED) cellRole[e] = ROLE.CONTACT_FIXTURE;
        for (const corner of fd.corners) {
          const n = elemNodes[8 * e + corner], dof = 3 * n + fd.axis;
          if (!fixedPermanent[dof] && !fixtureContactsMap.has(dof)) {
            fixtureContactsMap.set(dof, {dof, node: n, axis: fd.axis, sign: fd.sign});
          }
        }
      }
      // Touching distinct non-overlapping material component => frictionless unilateral body-body contact
      const nComp = cellComp[nc];
      if (nComp >= 0 && nComp !== comp) {
        contactBodyCells++;
        if (cellRole[e] === ROLE.MATERIAL || cellRole[e] === ROLE.OPTIMIZE_SPACE) cellRole[e] = ROLE.CONTACT_BODY;
        if (fd.sign > 0) { // emit each shared face once from the lower-coordinate side
          const ne = cellElem[nc];
          const oppDir = FACE_DIRS[fi - 1]; // matching opposite face on neighbor cell
          for (let k = 0; k < 4; k++) {
            const nA = elemNodes[8 * e + fd.corners[k]];
            const nB = elemNodes[8 * ne + oppDir.corners[k]];
            const dofA = 3 * nA + fd.axis, dofB = 3 * nB + fd.axis;
            const key = dofA < dofB ? dofA + ':' + dofB : dofB + ':' + dofA;
            if (!bodyContactsMap.has(key)) {
              bodyContactsMap.set(key, {dofA, dofB, nodeA: nA, nodeB: nB, axis: fd.axis, sign: 1});
            }
          }
        }
      }
    }
  }

  const fixtureContacts = [...fixtureContactsMap.values()];
  const bodyContacts = [...bodyContactsMap.values()];

  // 4. Assemble Loads: Gravity (own mass, always -Y world) + World Force/Torque sources
  const loadsExternal = new Float64Array(dofs);
  const loadsGravityUnit = new Float64Array(dofs); // gravity at density=1 per element for SIMP
  const gGrid = [
    dot3(GRAVITY_WORLD, domain.basis[0]),
    dot3(GRAVITY_WORLD, domain.basis[1]),
    dot3(GRAVITY_WORLD, domain.basis[2])
  ];
  let totalMassKg = 0;
  for (let e = 0; e < elemCount; e++) {
    const m = materials[elemMatArr[e]], elemMass = m.density * cellVol;
    totalMassKg += elemMass;
    if (includeGravity) {
      const fNode = [elemMass * gGrid[0] / 8, elemMass * gGrid[1] / 8, elemMass * gGrid[2] / 8];
      const base = 8 * e;
      for (let a = 0; a < 8; a++) {
        const n = elemNodes[base + a];
        loadsGravityUnit[3*n]   += fNode[0];
        loadsGravityUnit[3*n+1] += fNode[1];
        loadsGravityUnit[3*n+2] += fNode[2];
      }
    }
  }

  // Conserved Force/Torque mapping per unique (ownerHash, tagUID)
  const resolvedForces = [];
  for (const src of forceSources) {
    const selectedElems = [];
    for (let e = 0; e < elemCount; e++) {
      if (bitGet(src.occupancy, elemCell[e])) selectedElems.push(e);
    }
    const volInM3 = selectedElems.length * cellVol;
    const fraction = src.totalVolumeM3 > 1e-18 ? Math.max(0, Math.min(1, volInM3 / src.totalVolumeM3)) : (selectedElems.length > 0 ? 1 : 0);
    const fEffWorld = scale3(src.forceWorldN, fraction);
    const tEffWorld = scale3(src.torqueWorldNm, fraction);
    const magF = len3(fEffWorld), magT = len3(tEffWorld);
    if (!selectedElems.length || (magF === 0 && magT === 0)) {
      resolvedForces.push({...src, fraction, applied: false, forceEffWorldN: fEffWorld, torqueEffWorldNm: tEffWorld, elemIndices: selectedElems});
      continue;
    }
    // Lock directly loaded voxels during topology optimization so load paths never vanish
    for (const e of selectedElems) elemLocked[e] = 1;
    const fGrid = [dot3(fEffWorld, domain.basis[0]), dot3(fEffWorld, domain.basis[1]), dot3(fEffWorld, domain.basis[2])];
    const tGrid = [dot3(tEffWorld, domain.basis[0]), dot3(tEffWorld, domain.basis[1]), dot3(tEffWorld, domain.basis[2])];
    const pRel = sub3(src.pivotWorldM, domain.originWorldM);
    const pivotGridM = [dot3(pRel, domain.basis[0]), dot3(pRel, domain.basis[1]), dot3(pRel, domain.basis[2])];
    const w = regionWrench(nodePosArr, elemNodes, selectedElems, {force: fGrid, torque: tGrid, pivot: pivotGridM});
    for (const [n, f] of w.loads) {
      loadsExternal[3*n]   += f[0];
      loadsExternal[3*n+1] += f[1];
      loadsExternal[3*n+2] += f[2];
    }
    const centroidWorldMm = gridPointToWorldMm(domain, w.center[0]/dx, w.center[1]/dy, w.center[2]/dz);
    resolvedForces.push({
      ...src, fraction, applied: true,
      forceEffWorldN: fEffWorld, torqueEffWorldNm: tEffWorld,
      centroidWorldMm, elemIndices: selectedElems
    });
  }

  const loadsTotal = new Float64Array(dofs);
  for (let i = 0; i < dofs; i++) loadsTotal[i] = loadsExternal[i] + loadsGravityUnit[i];

  // 5. Verify kinematic constraint rank (6 rigid modes per connected component)
  // Include fixedPermanent + all unilateral contacts as potential support; if even that is rank < 6, fail immediately!
  checkSupportRank(nodePosArr, elemNodes, elemCount, nodeCount, fixedPermanent, fixtureContacts, bodyContacts, domain.lengthsM);

  // Diagonal of K at unit density
  const diagonal = new Float64Array(dofs);
  for (let e = 0; e < elemCount; e++) {
    const K = matrices[elemMatArr[e]], base = 8 * e;
    for (let a = 0; a < 8; a++) {
      const n = elemNodes[base + a];
      for (let k = 0; k < 3; k++) diagonal[3*n + k] += K[(3*a+k)*24 + (3*a+k)];
    }
  }

  return {
    domain, materials, matrices,
    elemCount, nodeCount, dofs,
    elemCell: Uint32Array.from(elemCell),
    cellElem, cellRole,
    elemNodes, elemMat: elemMatArr,
    elemPreserve, elemOptSpace, elemLocked, hasOptSpace,
    nodePositionsM: nodePosArr,
    nodeGridCoords: Uint32Array.from(nodeGridCoords),
    nodeInc: nodeIncArr,
    fixedPermanent, fixtureContacts, bodyContacts,
    loadsExternal, loadsGravityUnit, loadsTotal,
    diagonal, totalMassKg, gGrid, resolvedForces,
    stats: {
      cells: domain.count, activeVoxels: elemCount, nodes: nodeCount, dofs,
      components: compCount, weldedFixtureCells, contactFixtureCells,
      weldedBodyCells, contactBodyCells, cutFixedCells
    }
  };
}

function checkSupportRank(nodePosM, elemNodes, elemCount, nodeCount, fixedPermanent, fixtureContacts, bodyContacts, lengthsM) {
  // Build node connectivity across elements + active body-body contacts
  const parent = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let e = 0; e < elemCount; e++) {
    const n0 = elemNodes[8 * e];
    for (let a = 1; a < 8; a++) unite(n0, elemNodes[8 * e + a]);
  }
  for (const cp of bodyContacts) unite(cp.nodeA, cp.nodeB);

  const potentialFixed = fixedPermanent.slice();
  for (const fc of fixtureContacts) potentialFixed[fc.dof] = 1;

  const groups = new Map();
  for (let n = 0; n < nodeCount; n++) {
    const r = find(n);
    let g = groups.get(r);
    if (!g) groups.set(r, g = []);
    g.push(n);
  }
  const L = Math.max(lengthsM[0], lengthsM[1], lengthsM[2], 1e-6);
  for (const nodes of groups.values()) {
    const n0 = nodes[0], o = [nodePosM[3*n0], nodePosM[3*n0+1], nodePosM[3*n0+2]];
    const basis = [];
    for (const n of nodes) {
      const x = (nodePosM[3*n]-o[0])/L, y = (nodePosM[3*n+1]-o[1])/L, z = (nodePosM[3*n+2]-o[2])/L;
      const rows = [[1,0,0,0,z,-y],[0,1,0,-z,0,x],[0,0,1,y,-x,0]];
      for (let k = 0; k < 3; k++) {
        if (!potentialFixed[3*n + k]) continue;
        let row = rows[k].slice();
        for (let pass = 0; pass < 2; pass++) for (const b of basis) {
          let d = 0; for (let j = 0; j < 6; j++) d += row[j] * b[j];
          for (let j = 0; j < 6; j++) row[j] -= d * b[j];
        }
        const norm = Math.hypot(...row);
        if (norm > 1e-8) {
          basis.push(row.map(v => v / norm));
          if (basis.length === 6) break;
        }
      }
      if (basis.length === 6) break;
    }
    if (basis.length < 6) {
      throw failure('UNCONSTRAINED_RIGID_BODY', 'Unconstrained part detected (rigid-body motion). Add a Fixture overlap/contact or cut boundary.');
    }
  }
}

// ---------- GPU Matrix-Free PCG Session + Active-Set Frictionless Contact ----------

async function createGPUSolverSession(device, model, checkCurrent) {
  const {dofs, nodeCount, elemCount, matrices, elemNodes, elemMat, nodeInc, bodyContacts} = model;
  const limits = device.limits;
  const vectorBytes = dofs * 16, inputsBytes = dofs * 16;
  const matFlat = new Float32Array(matrices.length * 576);
  matrices.forEach((K, i) => matFlat.set(K, i * 576));
  const elemScaleInit = new Float32Array(elemCount).fill(1);
  // Build race-free symmetric CSR contact adjacency per DOF
  const dofLists = Array.from({length: dofs}, () => []);
  bodyContacts.forEach((cp, pairIdx) => {
    dofLists[cp.dofA].push({otherDof: cp.dofB, pairIdx});
    dofLists[cp.dofB].push({otherDof: cp.dofA, pairIdx});
  });
  const contactRangeArr = new Uint32Array(dofs * 2);
  const contactEntryMeta = [];
  let cursor = 0;
  for (let d = 0; d < dofs; d++) {
    contactRangeArr[2*d] = cursor;
    for (const item of dofLists[d]) { contactEntryMeta.push(item); cursor++; }
    contactRangeArr[2*d + 1] = cursor;
  }
  const contactEntryCount = Math.max(1, contactEntryMeta.length);
  const contactEntriesBytes = contactEntryCount * 16;
  const nodeIncOff = elemNodes.length;
  const contactRangeOff = nodeIncOff + nodeInc.length;
  const topoArr = new Uint32Array(contactRangeOff + contactRangeArr.length);
  topoArr.set(elemNodes, 0);
  topoArr.set(nodeInc, nodeIncOff);
  topoArr.set(contactRangeArr, contactRangeOff);
  const elemPropsBytes = elemCount * 8;
  const makeElemPropsBuf = scaleArr => {
    const ab = new ArrayBuffer(elemPropsBytes), u32 = new Uint32Array(ab), f32 = new Float32Array(ab);
    for (let e = 0; e < elemCount; e++) { u32[2*e] = elemMat[e]; f32[2*e+1] = scaleArr ? scaleArr[e] : 1; }
    return ab;
  };
  if ([vectorBytes, inputsBytes, matFlat.byteLength, topoArr.byteLength, elemPropsBytes].some(b => b > limits.maxStorageBufferBindingSize || b > limits.maxBufferSize))
    throw failure('GPU_CAPACITY', 'Structural problem exceeds WebGPU storage buffer limits. Increase Voxel size.');

  const module = device.createShaderModule({label: 'Structural Hex8 PCG', code: PCG_WGSL});
  const info = await module.getCompilationInfo(); checkCurrent();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length) throw failure('SHADER_ERROR', errs.map(m => m.message).join('\n'));

  const bgl = device.createBindGroupLayout({
    label: 'Structural PCG BGL',
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
  const pipelineLayout = device.createPipelineLayout({label: 'Structural PCG PL', bindGroupLayouts: [bgl]});

  const entries = ['initialize','applyU','applyP','residual','initialReduce','directionReduce','updateUR','nextReduce','updateP','exactReduce'];
  const pipelines = {};
  for (const entryPoint of entries) {
    pipelines[entryPoint] = await device.createComputePipelineAsync({label: 'Structural PCG ' + entryPoint, layout: pipelineLayout, compute: {module, entryPoint}});
    checkCurrent();
  }

  const owned = [];
  const makeBuf = (size, usage, label, data = null) => {
    const b = device.createBuffer({size: Math.max(16, size), usage, label});
    owned.push(b);
    if (data) device.queue.writeBuffer(b, 0, data);
    return b;
  };

  const bParams         = makeBuf(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'Structural PCG params');
  const bInputs         = makeBuf(inputsBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Structural DOF inputs');
  const bMatrices       = makeBuf(matFlat.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Structural Hex8 K', matFlat);
  const bTopo           = makeBuf(topoArr.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Structural topology', topoArr);
  const bElemProps      = makeBuf(elemPropsBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Structural elemProps', makeElemPropsBuf(null));
  const bContactEntries = makeBuf(contactEntriesBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Structural contactEntries', new Uint32Array(contactEntryCount * 4));
  const bVectors        = makeBuf(vectorBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'Structural PCG vectors');
  const bState          = makeBuf(48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'Structural PCG state', new Uint32Array(12));
  const bReadState      = makeBuf(48, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'Structural PCG checkpoint');
  const bReadVec        = makeBuf(vectorBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'Structural displacement readback');

  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [bParams, bInputs, bMatrices, bTopo, bElemProps, bContactEntries, bVectors, bState].map((buffer, binding) => ({binding, resource: {buffer}}))
  });

  const wgDofs = Math.ceil(dofs / 64);
  let disposed = false, pendingMap = null;

  function dispatch(enc, name) {
    const pass = enc.beginComputePass();
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(name.endsWith('Reduce') ? 1 : wgDofs);
    pass.end();
  }

  async function readCheckpoint(enc) {
    enc.copyBufferToBuffer(bState, 0, bReadState, 0, 48);
    device.queue.submit([enc.finish()]);
    const p = bReadState.mapAsync(GPUMapMode.READ);
    pendingMap = p;
    try { await p; } finally { if (pendingMap === p) pendingMap = null; }
    if (disposed) { if (bReadState.mapState === 'mapped') bReadState.unmap(); throw failure('CANCELLED', 'Structural solver disposed.'); }
    const raw = bReadState.getMappedRange().slice(0);
    bReadState.unmap();
    checkCurrent();
    const f = new Float32Array(raw), u = new Uint32Array(raw);
    return {
      status: u[8], iteration: u[9],
      initialNorm: Math.sqrt(Math.max(0, f[2])),
      residualNorm: Math.sqrt(Math.max(0, f[3])),
      relativeResidual: f[2] > 0 ? Math.sqrt(Math.max(0, f[3]) / f[2]) : Math.sqrt(Math.max(0, f[3])),
      rho: f[0], curvature: f[1]
    };
  }

  async function solveLinear({loads, fixed, diagonal, elemScale = null, contactEntriesBuf = null, warmStart = false, tolerance = 1e-4, maxIterations = 2500, checkpointEvery = 16}) {
    checkCurrent();
    if (elemScale) device.queue.writeBuffer(bElemProps, 0, makeElemPropsBuf(elemScale));
    if (contactEntriesBuf) device.queue.writeBuffer(bContactEntries, 0, contactEntriesBuf);
    const inputBuf = new ArrayBuffer(inputsBytes), fi = new Float32Array(inputBuf), ui = new Uint32Array(inputBuf);
    for (let i = 0; i < dofs; i++) {
      fi[4*i] = loads[i];
      fi[4*i+1] = 0;
      fi[4*i+2] = diagonal[i] > 0 ? diagonal[i] : 1;
      ui[4*i+3] = fixed[i] ? 1 : 0;
    }
    device.queue.writeBuffer(bInputs, 0, inputBuf);
    const pBuf = new ArrayBuffer(48), pu = new Uint32Array(pBuf), pf = new Float32Array(pBuf);
    pu.set([dofs, nodeCount, maxIterations, contactEntryMeta.length, nodeIncOff, contactRangeOff, 0, 0]);
    pf[8] = tolerance * tolerance;
    pf[9] = warmStart ? 1 : 0;
    device.queue.writeBuffer(bParams, 0, pBuf);
    device.queue.writeBuffer(bState, 0, new Uint32Array(12));

    let enc = device.createCommandEncoder();
    dispatch(enc, 'initialize');
    dispatch(enc, 'applyU');
    dispatch(enc, 'residual');
    dispatch(enc, 'initialReduce');
    let st = await readCheckpoint(enc);

    let guard = 0;
    while (true) {
      checkCurrent();
      if (++guard > 2 * maxIterations + 16) throw failure('SOLVE_NOT_CONVERGED', 'PCG host iteration guard exceeded.');
      if (st.status === 2 || st.status === 4) {
        enc = device.createCommandEncoder();
        dispatch(enc, 'applyU');
        dispatch(enc, 'residual');
        dispatch(enc, 'exactReduce');
        st = await readCheckpoint(enc);
      }
      if (st.status !== 0) break;
      enc = device.createCommandEncoder();
      for (let s = 0; s < checkpointEvery; s++) {
        dispatch(enc, 'applyP');
        dispatch(enc, 'directionReduce');
        dispatch(enc, 'updateUR');
        dispatch(enc, 'nextReduce');
        dispatch(enc, 'updateP');
      }
      st = await readCheckpoint(enc);
    }

    if (st.status === 3) throw failure('UNCONSTRAINED_RIGID_BODY', 'Non-positive stiffness curvature (unconstrained or singular system).');
    if (st.status === 5) throw failure('NONFINITE_SOLVE', 'Non-finite numerical state encountered during solve.');
    if (st.status !== 1 || st.relativeResidual > Math.max(tolerance * 2, 1e-3))
      throw failure('SOLVE_NOT_CONVERGED', `Solver did not converge within ${maxIterations} iterations (rel residual ${st.relativeResidual.toExponential(2)}).`);

    enc = device.createCommandEncoder();
    dispatch(enc, 'applyU');
    enc.copyBufferToBuffer(bVectors, 0, bReadVec, 0, vectorBytes);
    device.queue.submit([enc.finish()]);
    const p = bReadVec.mapAsync(GPUMapMode.READ);
    pendingMap = p;
    try { await p; } finally { if (pendingMap === p) pendingMap = null; }
    if (disposed) { if (bReadVec.mapState === 'mapped') bReadVec.unmap(); throw failure('CANCELLED', 'Structural solver disposed.'); }
    const mapped = new Float32Array(bReadVec.getMappedRange());
    const u = new Float64Array(dofs), ku = new Float64Array(dofs);
    for (let i = 0; i < dofs; i++) { u[i] = mapped[4*i]; ku[i] = mapped[4*i+3]; }
    bReadVec.unmap();
    checkCurrent();
    return {u, ku, iterations: st.iteration, relativeResidual: st.relativeResidual};
  }

  async function solveWithContact({loads, elemScale = null, extraFixed = null, warmStart = false, tolerance = 1e-4, maxIterations = 2500}) {
    const hasContacts = model.fixtureContacts.length > 0 || model.bodyContacts.length > 0;
    const activeFix = new Uint8Array(model.fixtureContacts.length).fill(1);
    const activeBody = new Uint8Array(model.bodyContacts.length).fill(1);
    const diagBase = new Float64Array(dofs);
    if (elemScale) {
      for (let e = 0; e < elemCount; e++) {
        const sc = elemScale[e];
        if (!(sc > 0)) continue;
        const K = matrices[elemMat[e]], base = 8 * e;
        for (let a = 0; a < 8; a++) {
          const n = elemNodes[base + a];
          for (let k = 0; k < 3; k++) diagBase[3*n+k] += sc * K[(3*a+k)*24 + (3*a+k)];
        }
      }
    } else diagBase.set(model.diagonal);

    const maxOuter = hasContacts ? 14 : 1;
    let lastSol = null, totalIters = 0;
    for (let outer = 0; outer < maxOuter; outer++) {
      checkCurrent();
      const fixed = model.fixedPermanent.slice();
      if (extraFixed) for (let i = 0; i < dofs; i++) if (extraFixed[i]) fixed[i] = 1;
      for (let i = 0; i < model.fixtureContacts.length; i++) if (activeFix[i] && !(extraFixed && extraFixed[model.fixtureContacts[i].dof])) fixed[model.fixtureContacts[i].dof] = 1;
      const diag = diagBase.slice();
      let contactEntriesBuf = null;
      if (contactEntryMeta.length) {
        const pairStiff = model.bodyContacts.map(cp => 50 * Math.max(diagBase[cp.dofA], diagBase[cp.dofB], 1));
        for (let i = 0; i < model.bodyContacts.length; i++) {
          if (activeBody[i]) { diag[model.bodyContacts[i].dofA] += pairStiff[i]; diag[model.bodyContacts[i].dofB] += pairStiff[i]; }
        }
        contactEntriesBuf = new ArrayBuffer(contactEntriesBytes);
        const cf = new Float32Array(contactEntriesBuf), cu = new Uint32Array(contactEntriesBuf);
        for (let k = 0; k < contactEntryMeta.length; k++) {
          const item = contactEntryMeta[k];
          cu[4*k] = item.otherDof;
          cf[4*k+1] = pairStiff[item.pairIdx];
          cu[4*k+2] = activeBody[item.pairIdx];
          cu[4*k+3] = 0;
        }
      }
      lastSol = await solveLinear({loads, fixed, diagonal: diag, elemScale, contactEntriesBuf, warmStart: warmStart || outer > 0, tolerance, maxIterations});
      totalIters += lastSol.iterations;
      if (!hasContacts) break;

      let maxU = 0, maxF = 0;
      for (let i = 0; i < dofs; i++) { maxU = Math.max(maxU, Math.abs(lastSol.u[i])); maxF = Math.max(maxF, Math.abs(loads[i])); }
      const gapTol = 1e-7 * Math.max(maxU, 1e-6), forceTol = 1e-6 * Math.max(maxF, 1e-6);
      let changed = false;
      for (let i = 0; i < model.fixtureContacts.length; i++) {
        const fc = model.fixtureContacts[i];
        if (activeFix[i]) {
          const reactOnBody = lastSol.ku[fc.dof] - loads[fc.dof];
          if (reactOnBody * fc.sign > forceTol) { activeFix[i] = 0; changed = true; }
        } else {
          if (lastSol.u[fc.dof] * fc.sign > gapTol) { activeFix[i] = 1; changed = true; }
        }
      }
      for (let i = 0; i < model.bodyContacts.length; i++) {
        const cp = model.bodyContacts[i];
        const rel = (lastSol.u[cp.dofA] - lastSol.u[cp.dofB]) * cp.sign;
        if (activeBody[i]) {
          if (rel < -gapTol) { activeBody[i] = 0; changed = true; }
        } else {
          if (rel > gapTol) { activeBody[i] = 1; changed = true; }
        }
      }
      if (!changed) break;
    }
    return {...lastSol, totalIterations: totalIters, activeFix, activeBody};
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    try { await pendingMap?.catch(() => {}); await device.queue.onSubmittedWorkDone(); } catch {}
    if (bReadState.mapState === 'mapped') bReadState.unmap();
    if (bReadVec.mapState === 'mapped') bReadVec.unmap();
    for (const b of owned) b.destroy();
  }

  return {solveLinear, solveWithContact, dispose};
}

// ---------- CPU Float64 Reference PCG Oracle (for CPU unit tests & cross-verification) ----------

export function solveHex8CPU(model, {loads = model.loadsTotal, tolerance = 1e-9, maxIterations = 4000} = {}) {
  const {dofs, elemCount, elemNodes, elemMat, matrices, fixedPermanent, diagonal} = model;
  const fixed = fixedPermanent.slice();
  const applyK = v => {
    const out = new Float64Array(dofs);
    for (let e = 0; e < elemCount; e++) {
      const K = matrices[elemMat[e]], base = 8 * e;
      for (let a = 0; a < 24; a++) {
        let s = 0;
        for (let b = 0; b < 24; b++) s += K[a*24+b] * v[3*elemNodes[base + (b/3|0)] + (b%3)];
        out[3*elemNodes[base + (a/3|0)] + (a%3)] += s;
      }
    }
    return out;
  };
  const u = new Float64Array(dofs), r = new Float64Array(dofs), z = new Float64Array(dofs), p = new Float64Array(dofs);
  let r2 = 0, rz = 0;
  for (let i = 0; i < dofs; i++) if (!fixed[i]) {
    r[i] = loads[i]; z[i] = r[i] / diagonal[i]; p[i] = z[i]; r2 += r[i]*r[i]; rz += r[i]*z[i];
  }
  const norm0 = Math.sqrt(r2), thresh = tolerance * Math.max(norm0, 1e-30);
  let it = 0;
  if (norm0 > 0) for (; it < maxIterations; it++) {
    const ap = applyK(p);
    let pap = 0;
    for (let i = 0; i < dofs; i++) { if (fixed[i]) ap[i] = 0; pap += p[i] * ap[i]; }
    if (!(pap > 0)) throw failure('UNCONSTRAINED_RIGID_BODY', 'Non-positive curvature in CPU oracle.');
    const alpha = rz / pap;
    let nr2 = 0, nrz = 0;
    for (let i = 0; i < dofs; i++) if (!fixed[i]) {
      u[i] += alpha * p[i]; r[i] -= alpha * ap[i];
      z[i] = r[i] / diagonal[i]; nr2 += r[i]*r[i]; nrz += r[i]*z[i];
    }
    if (Math.sqrt(nr2) <= thresh) { it++; break; }
    const beta = nrz / rz;
    for (let i = 0; i < dofs; i++) p[i] = z[i] + beta * p[i];
    rz = nrz;
  }
  const ku = applyK(u);
  let err2 = 0;
  for (let i = 0; i < dofs; i++) if (!fixed[i]) err2 += (ku[i] - loads[i]) ** 2;
  const relativeResidual = norm0 > 0 ? Math.sqrt(err2) / norm0 : 0;
  if (relativeResidual > Math.max(tolerance * 10, 1e-6)) throw failure('SOLVE_NOT_CONVERGED', 'CPU oracle did not converge.');
  return {u, ku, iterations: it, relativeResidual};
}

// ---------- Stress, Safety Factor, & Post-Processing ----------

export function evaluateElements(model, u, activeMask = null) {
  const {elemCount, elemNodes, elemMat, materials, domain} = model;
  const g = 1 / Math.sqrt(3), gaussB = [];
  for (const x of [-g, g]) for (const y of [-g, g]) for (const z of [-g, g]) gaussB.push(strainMatrix(domain.spacingM, [x, y, z]));

  const elemStressPa = new Float32Array(elemCount);
  const elemSF = new Float32Array(elemCount).fill(Infinity);
  const elemDispM = new Float32Array(elemCount);
  const ue = new Float64Array(24), eps = new Float64Array(6), sig = new Float64Array(6);

  let maxStressPa = 0, minSF = Infinity, maxDispM = 0, solidMassKg = 0;
  const cellVol = domain.spacingM[0] * domain.spacingM[1] * domain.spacingM[2];

  for (let e = 0; e < elemCount; e++) {
    if (activeMask && !activeMask[e]) continue;
    const mat = materials[elemMat[e]], D = mat.D, base = 8 * e;
    solidMassKg += mat.density * cellVol;
    let dispSum = 0;
    for (let a = 0; a < 8; a++) {
      const n = elemNodes[base + a];
      const ux = u[3*n], uy = u[3*n+1], uz = u[3*n+2];
      ue[3*a] = ux; ue[3*a+1] = uy; ue[3*a+2] = uz;
      const d = Math.hypot(ux, uy, uz);
      if (d > maxDispM) maxDispM = d;
      dispSum += d;
    }
    elemDispM[e] = dispSum / 8;

    let vmMax = 0;
    for (let gp = 0; gp < 8; gp++) {
      const B = gaussB[gp];
      for (let a = 0; a < 6; a++) {
        let s = 0; for (let b = 0; b < 24; b++) s += B[a*24+b] * ue[b]; eps[a] = s;
      }
      for (let a = 0; a < 6; a++) {
        let s = 0; for (let b = 0; b < 6; b++) s += D[a*6+b] * eps[b]; sig[a] = s;
      }
      const [sx, sy, sz, txy, tyz, txz] = sig;
      const vm = Math.sqrt(Math.max(0, 0.5*((sx-sy)**2 + (sy-sz)**2 + (sz-sx)**2) + 3*(txy*txy + tyz*tyz + txz*txz)));
      if (vm > vmMax) vmMax = vm;
    }
    elemStressPa[e] = vmMax;
    const sf = vmMax > 1e-12 ? mat.yieldStrength / vmMax : Infinity;
    elemSF[e] = sf;
    if (vmMax > maxStressPa) maxStressPa = vmMax;
    if (sf < minSF) minSF = sf;
  }

  return {
    elemStressPa, elemSF, elemDispM,
    maxStressMPa: maxStressPa * 1e-6,
    safetyFactor: minSF,
    maxDispMm: maxDispM * M_TO_MM,
    massG: solidMassKg * 1000,
    massKg: solidMassKg
  };
}

// ---------- GPU Voxelization Runner (Borrows Core Geometry, Zero CPU Triangle Mirror) ----------

async function voxelizeOccurrenceGPU(device, mesh, domain, pad, pipes, satFallback, checkCurrent) {
  const [nx, ny, nz] = domain.cells;
  const px = nx + 2 * pad, py = ny + 2 * pad, pz = nz + 2 * pad, pCount = px * py * pz;
  const packedWords = Math.ceil(pCount / 32);
  const owned = [];
  const make = (size, usage, label, data = null) => {
    const b = device.createBuffer({size: Math.max(16, size), usage, label});
    owned.push(b);
    if (data) device.queue.writeBuffer(b, 0, data);
    return b;
  };
  try {
    const matGrid = meshToGridMatrix(mesh.worldMatrix, domain, pad);
    const triCount = mesh.triangleCount;
    const wgTri = Math.ceil(triCount / 64);
    const bParity = make(pCount * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'Structural vox parity');
    const bPacked = make(packedWords * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'Structural vox packed');
    const bVol    = make(Math.max(1, wgTri) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, 'Structural vol partials');
    const bReadP  = make(packedWords * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'Structural vox read');
    const bReadV  = make(Math.max(1, wgTri) * 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, 'Structural vol read');
    const cfgData = new ArrayBuffer(112), cf = new Float32Array(cfgData), cu = new Uint32Array(cfgData);
    cf.set(matGrid, 0);
    cu.set([px, py, pz, pCount, 0, triCount, mesh.vertexCount, satFallback ? 1 : 0], 16);
    cf.set([domain.spacingM[0], domain.spacingM[1], domain.spacingM[2], 0], 24);
    const bVoxCfg = make(112, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'Structural vox cfg', cfgData);
    const bScanCfg = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'Structural scan cfg', new Uint32Array([px, py, pz, pCount]));

    const posRes = mesh.storage === 'texture' ? mesh.positions.view : {buffer: mesh.positions};
    const idxRes = mesh.storage === 'texture' ? mesh.indices.view : {buffer: mesh.indices};
    const voxPipe = pipes.vox[mesh.storage];
    const volPipe = pipes.vol[mesh.storage];
    const voxBG = device.createBindGroup({layout: voxPipe.getBindGroupLayout(0), entries: [
      {binding:0, resource:{buffer:bVoxCfg}}, {binding:1, resource:posRes}, {binding:2, resource:idxRes}, {binding:3, resource:{buffer:bParity}}
    ]});
    const volBG = device.createBindGroup({layout: volPipe.getBindGroupLayout(0), entries: [
      {binding:0, resource:{buffer:bVoxCfg}}, {binding:1, resource:posRes}, {binding:2, resource:idxRes}, {binding:4, resource:{buffer:bVol}}
    ]});
    const scanBG = device.createBindGroup({layout: pipes.scanBGL, entries: [
      {binding:0, resource:{buffer:bScanCfg}}, {binding:1, resource:{buffer:bParity}}
    ]});
    const packBG = device.createBindGroup({layout: pipes.pack.getBindGroupLayout(0), entries: [
      {binding:0, resource:{buffer:bScanCfg}}, {binding:1, resource:{buffer:bParity}}, {binding:2, resource:{buffer:bPacked}}
    ]});

    const enc = device.createCommandEncoder();
    enc.clearBuffer(bParity);
    enc.clearBuffer(bPacked);
    const run = (pipe, bg, wg) => { const p = enc.beginComputePass(); p.setPipeline(pipe); p.setBindGroup(0, bg); p.dispatchWorkgroups(wg); p.end(); };
    if (wgTri > 0) {
      run(voxPipe, voxBG, wgTri);
      run(volPipe, volBG, wgTri);
    }
    run(pipes.scanZ, scanBG, Math.ceil((px * py) / 64));
    run(pipes.scanX, scanBG, Math.ceil((py * pz) / 64));
    run(pipes.scanY, scanBG, Math.ceil((px * pz) / 64));
    run(pipes.pack, packBG, Math.ceil(pCount / 64));
    enc.copyBufferToBuffer(bPacked, 0, bReadP, 0, packedWords * 4);
    if (wgTri > 0) enc.copyBufferToBuffer(bVol, 0, bReadV, 0, wgTri * 4);
    device.queue.submit([enc.finish()]);

    await Promise.all([bReadP.mapAsync(GPUMapMode.READ), wgTri > 0 ? bReadV.mapAsync(GPUMapMode.READ) : Promise.resolve()]);
    checkCurrent();
    const paddedBits = new Uint32Array(bReadP.getMappedRange().slice(0));
    bReadP.unmap();
    let volumeM3 = 0;
    if (wgTri > 0) {
      const vPart = new Float32Array(bReadV.getMappedRange());
      for (let i = 0; i < vPart.length; i++) volumeM3 += vPart[i];
      bReadV.unmap();
      volumeM3 = Math.abs(volumeM3);
    }

    // Extract inner domain bitset & 6-face ghost cut flags
    const domainWords = Math.ceil(domain.count / 32);
    const occupancy = new Uint32Array(domainWords);
    const cutFaces = pad ? new Uint8Array(domain.count) : null;
    const pBit = (x, y, z) => bitGet(paddedBits, x + px * (y + py * z));
    let activeCount = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (!pBit(x + pad, y + pad, z + pad)) continue;
      const c = x + nx * (y + ny * z);
      occupancy[c >> 5] |= (1 << (c & 31));
      activeCount++;
      if (cutFaces) {
        let mask = 0;
        if (x === 0      && pBit(0, y+1, z+1))     mask |= 1;
        if (x === nx - 1 && pBit(nx+1, y+1, z+1))  mask |= 2;
        if (y === 0      && pBit(x+1, 0, z+1))     mask |= 4;
        if (y === ny - 1 && pBit(x+1, ny+1, z+1))  mask |= 8;
        if (z === 0      && pBit(x+1, y+1, 0))     mask |= 16;
        if (z === nz - 1 && pBit(x+1, y+1, nz+1))  mask |= 32;
        cutFaces[c] = mask;
      }
    }
    return {occupancy, cutFaces, activeCount, volumeM3};
  } finally {
    for (const b of owned) { if (b.mapState === 'mapped') b.unmap(); b.destroy(); }
  }
}

async function getVoxelizerPipelines(device, cache) {
  let entry = cache.get(device);
  if (entry) return entry;
  const modBuf = device.createShaderModule({label: 'Structural vox buffer', code: voxelizerWGSL('buffer')});
  const modTex = device.createShaderModule({label: 'Structural vox texture', code: voxelizerWGSL('texture')});
  const modScan = device.createShaderModule({label: 'Structural vox scan', code: SCAN_WGSL});
  for (const m of [modBuf, modTex, modScan]) {
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter(x => x.type === 'error');
    if (errs.length) throw failure('SHADER_ERROR', errs.map(x => x.message).join('\n'));
  }
  const scanBGL = device.createBindGroupLayout({
    label: 'Structural vox scan BGL',
    entries: [
      {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'uniform'}},
      {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: 'storage'}}
    ]
  });
  const scanPL = device.createPipelineLayout({label: 'Structural vox scan PL', bindGroupLayouts: [scanBGL]});
  const [vb, vt, volb, volt, scanZ, scanX, scanY, pack] = await Promise.all([
    device.createComputePipelineAsync({layout:'auto', compute:{module:modBuf, entryPoint:'voxelize'}}),
    device.createComputePipelineAsync({layout:'auto', compute:{module:modTex, entryPoint:'voxelize'}}),
    device.createComputePipelineAsync({layout:'auto', compute:{module:modBuf, entryPoint:'signedVolume'}}),
    device.createComputePipelineAsync({layout:'auto', compute:{module:modTex, entryPoint:'signedVolume'}}),
    device.createComputePipelineAsync({layout:scanPL, compute:{module:modScan, entryPoint:'scanZ'}}),
    device.createComputePipelineAsync({layout:scanPL, compute:{module:modScan, entryPoint:'scanX'}}),
    device.createComputePipelineAsync({layout:scanPL, compute:{module:modScan, entryPoint:'scanY'}}),
    device.createComputePipelineAsync({layout:'auto', compute:{module:modScan, entryPoint:'packBits'}})
  ]);
  entry = {vox: {buffer: vb, texture: vt}, vol: {buffer: volb, texture: volt}, scanBGL, scanZ, scanX, scanY, pack};
  cache.set(device, entry);
  return entry;
}

// ---------- Smooth Watertight Surface Nets Mesh Extraction (for Result to Object) ----------

export function extractOptimizedMesh(model, solidMask) {
  const {domain, elemCount, elemCell, elemLocked} = model;
  const [nx, ny, nz] = domain.cells;
  const gx = nx + 2, gy = ny + 2, gz = nz + 2; // 1-cell zero padding -> guaranteed closed watertight manifold!
  const solid = new Uint8Array(gx * gy * gz);
  const locked = new Uint8Array(gx * gy * gz);
  const gIdx = (x, y, z) => x + gx * (y + gy * z);
  for (let e = 0; e < elemCount; e++) {
    if (!solidMask[e]) continue;
    const c = elemCell[e];
    const x = (c % nx) + 1, y = (Math.floor(c / nx) % ny) + 1, z = Math.floor(c / (nx * ny)) + 1;
    solid[gIdx(x, y, z)] = 1;
    if (elemLocked[e]) locked[gIdx(x, y, z)] = 1;
  }

  // Dual vertices sit at grid corners (ix, iy, iz) in [0..gx-2] that separate solid and empty cells
  const vMap = new Int32Array((gx - 1) * (gy - 1) * (gz - 1)).fill(-1);
  const vIdx = (x, y, z) => x + (gx - 1) * (y + (gy - 1) * z);
  const verts = [], pinned = [];
  for (let z = 0; z < gz - 1; z++) for (let y = 0; y < gy - 1; y++) for (let x = 0; x < gx - 1; x++) {
    let sCount = 0, isPin = false;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const id = gIdx(x + dx, y + dy, z + dz);
      if (solid[id]) { sCount++; if (locked[id]) isPin = true; }
    }
    if (sCount === 0 || sCount === 8) continue;
    const vi = verts.length / 3;
    vMap[vIdx(x, y, z)] = vi;
    // Grid-corner position in domain cell coordinates (shift back by -0.5 for dual cell center -> domain [0..nx])
    verts.push(x, y, z);
    pinned.push(isPin ? 1 : 0);
  }

  const quads = [];
  const addQuad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) quads.push([a, d, c, b]); else quads.push([a, b, c, d]);
  };
  for (let z = 0; z < gz - 1; z++) for (let y = 0; y < gy - 1; y++) for (let x = 0; x < gx - 1; x++) {
    const s0 = solid[gIdx(x, y, z)];
    // Face along +X between (x,y,z) and (x+1,y,z)
    if (y >= 1 && z >= 1) {
      const s1 = solid[gIdx(x + 1, y, z)];
      if (s0 !== s1) addQuad(vMap[vIdx(x, y-1, z-1)], vMap[vIdx(x, y, z-1)], vMap[vIdx(x, y, z)], vMap[vIdx(x, y-1, z)], s0 === 0);
    }
    // Face along +Y between (x,y,z) and (x,y+1,z)
    if (x >= 1 && z >= 1) {
      const s1 = solid[gIdx(x, y + 1, z)];
      if (s0 !== s1) addQuad(vMap[vIdx(x-1, y, z-1)], vMap[vIdx(x-1, y, z)], vMap[vIdx(x, y, z)], vMap[vIdx(x, y, z-1)], s0 === 0);
    }
    // Face along +Z between (x,y,z) and (x,y,z+1)
    if (x >= 1 && y >= 1) {
      const s1 = solid[gIdx(x, y, z + 1)];
      if (s0 !== s1) addQuad(vMap[vIdx(x-1, y-1, z)], vMap[vIdx(x, y-1, z)], vMap[vIdx(x, y, z)], vMap[vIdx(x-1, y, z)], s0 === 0);
    }
  }
  if (!quads.length) throw failure('EMPTY_RESULT_MESH', 'Optimized topology produced no solid surface.');

  // Taubin volume-preserving smoothing on free (non-preserved/non-fixture) vertices
  const vCount = verts.length / 3;
  const pos = Float64Array.from(verts);
  const adj = Array.from({length: vCount}, () => new Set());
  for (const [a, b, c, d] of quads) {
    adj[a].add(b); adj[a].add(d); adj[b].add(a); adj[b].add(c);
    adj[c].add(b); adj[c].add(d); adj[d].add(c); adj[d].add(a);
  }
  const tmp = new Float64Array(pos.length);
  for (let pass = 0; pass < 3; pass++) {
    for (const w of [0.33, -0.34]) {
      tmp.set(pos);
      for (let i = 0; i < vCount; i++) {
        if (pinned[i] || !adj[i].size) continue;
        let ax = 0, ay = 0, az = 0;
        for (const j of adj[i]) { ax += pos[3*j]; ay += pos[3*j+1]; az += pos[3*j+2]; }
        const inv = 1 / adj[i].size;
        tmp[3*i]   = pos[3*i]   + w * (ax*inv - pos[3*i]);
        tmp[3*i+1] = pos[3*i+1] + w * (ay*inv - pos[3*i+1]);
        tmp[3*i+2] = pos[3*i+2] + w * (az*inv - pos[3*i+2]);
      }
      pos.set(tmp);
    }
  }

  // Convert from padded grid coords to world millimetres
  const outVerts = new Float32Array(vCount * 3);
  for (let i = 0; i < vCount; i++) {
    const p = gridPointToWorldMm(domain, pos[3*i], pos[3*i+1], pos[3*i+2]);
    outVerts[3*i] = p[0]; outVerts[3*i+1] = p[1]; outVerts[3*i+2] = p[2];
  }
  const outIndices = new Uint32Array(quads.length * 6);
  for (let i = 0; i < quads.length; i++) {
    const [a, b, c, d] = quads[i];
    outIndices[6*i] = a; outIndices[6*i+1] = b; outIndices[6*i+2] = c;
    outIndices[6*i+3] = a; outIndices[6*i+4] = c; outIndices[6*i+5] = d;
  }
  // Ensure positive outward winding via signed volume
  let vol = 0;
  for (let i = 0; i < outIndices.length; i += 3) {
    const ia = 3*outIndices[i], ib = 3*outIndices[i+1], ic = 3*outIndices[i+2];
    const ax = outVerts[ia], ay = outVerts[ia+1], az = outVerts[ia+2];
    const bx = outVerts[ib], by = outVerts[ib+1], bz = outVerts[ib+2];
    const cx = outVerts[ic], cy = outVerts[ic+1], cz = outVerts[ic+2];
    vol += ax*(by*cz - bz*cy) + ay*(bz*cx - bx*cz) + az*(bx*cy - by*cx);
  }
  if (vol < 0) {
    for (let i = 0; i < outIndices.length; i += 3) {
      const t = outIndices[i+1]; outIndices[i+1] = outIndices[i+2]; outIndices[i+2] = t;
    }
  }
  return {vertices: outVerts, indices: outIndices, vertexCount: vCount, triangleCount: outIndices.length / 3};
}

// ---------- Animation Load-Case Frame Discovery (Keyframes + Changed Range Frames) ----------

export function collectAnimationFrames(animInfo, firstFrame, lastFrame) {
  const frames = new Set([firstFrame]);
  const tracks = animInfo?.channels || [];
  for (const ch of tracks) {
    const keys = ch.track?.keys || [];
    if (!keys.length) continue;
    for (const [f] of keys) {
      const rf = Math.round(f);
      if (rf >= firstFrame && rf <= lastFrame) frames.add(rf);
    }
    for (let i = 0; i + 1 < keys.length; i++) {
      const [f0, k0] = keys[i], [f1, k1] = keys[i + 1];
      const lo = Math.max(firstFrame, Math.ceil(f0)), hi = Math.min(lastFrame, Math.floor(f1));
      if (lo > hi) continue;
      const v0 = Array.isArray(k0.v) ? k0.v : [k0.v];
      const v1 = Array.isArray(k1.v) ? k1.v : [k1.v];
      const differs = v0.some((x, idx) => Math.abs(x - v1[idx]) > 1e-12);
      const soft = k0.mode === 'soft' || k1.mode === 'soft' || (Array.isArray(k0.modes) && k0.modes.includes('soft')) || (Array.isArray(k1.modes) && k1.modes.includes('soft'));
      if (ch.track.kind === 'discrete') {
        // Discrete tracks only jump at keyframes (already added above)
        continue;
      }
      if (differs || soft) {
        for (let f = lo; f <= hi; f++) frames.add(f);
      }
    }
  }
  return [...frames].sort((a, b) => a - b);
}

// ---------- Color Ramps & Viewport Geometry Builders ----------

function rampColor(t, stops) {
  const u = Math.max(0, Math.min(1, t));
  const s = u * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(s)), f = s - i;
  return [
    stops[i][0] + (stops[i+1][0] - stops[i][0]) * f,
    stops[i][1] + (stops[i+1][1] - stops[i][1]) * f,
    stops[i][2] + (stops[i+1][2] - stops[i][2]) * f
  ];
}
const STRESS_STOPS = [[0.14,0.28,0.68],[0.12,0.66,0.72],[0.36,0.82,0.42],[0.96,0.78,0.18],[0.90,0.22,0.18]];
const DISP_STOPS   = [[0.14,0.24,0.60],[0.18,0.68,0.82],[0.92,0.84,0.26],[0.92,0.28,0.22]];
const SF_STOPS     = [[0.88,0.16,0.16],[0.95,0.52,0.14],[0.94,0.84,0.22],[0.26,0.78,0.42],[0.20,0.52,0.88]];

function sfToColor(sf) {
  if (!Number.isFinite(sf) || sf >= 5) return SF_STOPS[4];
  if (sf <= 1) return SF_STOPS[0];
  // Smooth log-like mapping across [1..5]
  const t = Math.log(sf) / Math.log(5);
  return rampColor(t, SF_STOPS);
}

function buildDisplayTriangles(model, state, mode, deformationScale) {
  const {domain, elemCount, elemCell, elemNodes, cellElem, cellRole, nodePositionsM} = model;
  const [nx, ny, nz] = domain.cells, [dx, dy, dz] = domain.spacingM;
  const solidMask = state.solidMask || null;
  const u = state.u || null;
  const evalData = state.eval || null;
  const density = state.density || null;
  const showDisp = u && mode !== 'Voxels' ? deformationScale : 0;

  // Build world mm node positions (with optional deformation)
  const nodeWorldMm = new Float32Array(model.nodeCount * 3);
  const [bx, by, bz] = domain.basis, o = domain.originWorldM;
  for (let n = 0; n < model.nodeCount; n++) {
    const px = nodePositionsM[3*n]   + (showDisp ? u[3*n]   * showDisp : 0);
    const py = nodePositionsM[3*n+1] + (showDisp ? u[3*n+1] * showDisp : 0);
    const pz = nodePositionsM[3*n+2] + (showDisp ? u[3*n+2] * showDisp : 0);
    nodeWorldMm[3*n]   = (o[0] + bx[0]*px + by[0]*py + bz[0]*pz) * M_TO_MM;
    nodeWorldMm[3*n+1] = (o[1] + bx[1]*px + by[1]*py + bz[1]*pz) * M_TO_MM;
    nodeWorldMm[3*n+2] = (o[2] + bx[2]*px + by[2]*py + bz[2]*pz) * M_TO_MM;
  }

  const isVisible = e => {
    if (e < 0) return false;
    if (mode === 'Density' && density) return density[e] >= 0.15;
    if (solidMask) return solidMask[e] !== 0;
    return true;
  };
  const cellIdx = (x, y, z) => x + nx * (y + ny * z);
  const maxStressPa = Math.max(1e-6, (evalData?.maxStressMPa || 0) * 1e6);
  const maxDispM = Math.max(1e-12, (evalData?.maxDispMm || 0) * MM_TO_M);

  // Count exposed quads first to allocate exact Float32Array (9 floats/vertex: pos3, norm3, col3)
  let quadCount = 0;
  for (let e = 0; e < elemCount; e++) {
    if (!isVisible(e)) continue;
    const c = elemCell[e], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (let f = 0; f < 6; f++) {
      const fq = FACE_QUADS[f];
      const nx1 = x + (fq.axis===0?fq.sign:0), ny1 = y + (fq.axis===1?fq.sign:0), nz1 = z + (fq.axis===2?fq.sign:0);
      const nElem = (nx1<0||nx1>=nx||ny1<0||ny1>=ny||nz1<0||nz1>=nz) ? -1 : cellElem[cellIdx(nx1, ny1, nz1)];
      if (!isVisible(nElem)) quadCount++;
    }
  }
  const verts = new Float32Array(quadCount * 6 * 9);
  let ptr = 0;
  const pushV = (p, n, col) => {
    verts[ptr++]=p[0]; verts[ptr++]=p[1]; verts[ptr++]=p[2];
    verts[ptr++]=n[0]; verts[ptr++]=n[1]; verts[ptr++]=n[2];
    verts[ptr++]=col[0]; verts[ptr++]=col[1]; verts[ptr++]=col[2];
  };
  const pt = nid => [nodeWorldMm[3*nid], nodeWorldMm[3*nid+1], nodeWorldMm[3*nid+2]];

  for (let e = 0; e < elemCount; e++) {
    if (!isVisible(e)) continue;
    const c = elemCell[e], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    let col;
    if (mode === 'Voxels') {
      const role = cellRole[e];
      col = role === ROLE.MATERIAL ? model.materials[model.elemMat[e]].color : ROLE_COLORS[role];
    } else if (mode === 'Safety factor' && evalData) {
      col = sfToColor(evalData.elemSF[e]);
    } else if (mode === 'Stress' && evalData) {
      col = rampColor(evalData.elemStressPa[e] / maxStressPa, STRESS_STOPS);
    } else if (mode === 'Displacement' && evalData) {
      col = rampColor(evalData.elemDispM[e] / maxDispM, DISP_STOPS);
    } else if (mode === 'Density' && density) {
      const d = Math.max(0, Math.min(1, density[e]));
      col = [0.22 + 0.68*d, 0.24 + 0.56*d, 0.28 + 0.34*d];
    } else {
      col = model.materials[model.elemMat[e]].color;
    }

    for (let f = 0; f < 6; f++) {
      const fq = FACE_QUADS[f];
      const nx1 = x + (fq.axis===0?fq.sign:0), ny1 = y + (fq.axis===1?fq.sign:0), nz1 = z + (fq.axis===2?fq.sign:0);
      const nElem = (nx1<0||nx1>=nx||ny1<0||ny1>=ny||nz1<0||nz1>=nz) ? -1 : cellElem[cellIdx(nx1, ny1, nz1)];
      if (isVisible(nElem)) continue;
      const p0 = pt(elemNodes[8*e + fq.corners[0]]);
      const p1 = pt(elemNodes[8*e + fq.corners[1]]);
      const p2 = pt(elemNodes[8*e + fq.corners[2]]);
      const p3 = pt(elemNodes[8*e + fq.corners[3]]);
      // Compute face normal in world coordinates
      const e1 = sub3(p1, p0), e2 = sub3(p2, p0), cr = cross3(e1, e2), cl = len3(cr) || 1;
      const nrm = scale3(cr, 1 / cl);
      pushV(p0, nrm, col); pushV(p1, nrm, col); pushV(p2, nrm, col);
      pushV(p0, nrm, col); pushV(p2, nrm, col); pushV(p3, nrm, col);
    }
  }
  return {vertices: verts, vertexCount: quadCount * 6};
}

// 3D Force (arrow) & Torque (curved arc + cone) viewport geometry in world mm
function buildForceArrowTriangles(forces, refLengthMm) {
  if (!forces.length) return {vertices: new Float32Array(0), vertexCount: 0};
  const scaleLen = Math.max(12, Math.min(120, refLengthMm * 0.35));
  const out = [];
  const pushTri = (a, b, c, col) => {
    const cr = cross3(sub3(b, a), sub3(c, a)), cl = len3(cr) || 1, n = scale3(cr, 1 / cl);
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]);
  };
  const orthoBasis = dir => {
    const d = scale3(dir, 1 / (len3(dir) || 1));
    const up = Math.abs(d[1]) < 0.9 ? [0,1,0] : [1,0,0];
    const u = cross3(up, d), ul = len3(u) || 1, uu = scale3(u, 1/ul);
    const v = cross3(d, uu);
    return [uu, v, d];
  };
  const addTube = (p0, p1, r0, r1, col, segs = 8) => {
    const d = sub3(p1, p0); if (len3(d) < 1e-6) return;
    const [u, v] = orthoBasis(d);
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      const ca0 = Math.cos(a0), sa0 = Math.sin(a0), ca1 = Math.cos(a1), sa1 = Math.sin(a1);
      const b0 = add3(p0, add3(scale3(u, ca0*r0), scale3(v, sa0*r0)));
      const b1 = add3(p0, add3(scale3(u, ca1*r0), scale3(v, sa1*r0)));
      const t0 = add3(p1, add3(scale3(u, ca0*r1), scale3(v, sa0*r1)));
      const t1 = add3(p1, add3(scale3(u, ca1*r1), scale3(v, sa1*r1)));
      if (r0 > 0) pushTri(b0, b1, t1, col);
      if (r1 > 0) pushTri(b0, t1, t0, col);
      else pushTri(b0, b1, p1, col);
    }
  };

  for (const f of forces) {
    const origin = f.originWorldMm;
    const fMag = len3(f.forceWorldN);
    if (fMag > 1e-12) {
      const dir = scale3(f.forceWorldN, 1 / fMag);
      const L = scaleLen, rShaft = L * 0.045, rHead = L * 0.13, headL = L * 0.28;
      const mid = add3(origin, scale3(dir, L - headL));
      const tip = add3(origin, scale3(dir, L));
      const col = [0.95, 0.28, 0.24];
      addTube(origin, mid, rShaft, rShaft, col, 8);
      addTube(mid, tip, rHead, 0, col, 10);
    }
    const tMag = len3(f.torqueWorldNm);
    if (tMag > 1e-12) {
      const [u, v] = orthoBasis(f.torqueWorldNm);
      const R = scaleLen * 0.42, rTube = scaleLen * 0.036, col = [0.96, 0.72, 0.18];
      const arcSegs = 14, sweep = Math.PI * 1.5;
      let prev = null;
      for (let i = 0; i <= arcSegs; i++) {
        const ang = (i / arcSegs) * sweep;
        const p = add3(origin, add3(scale3(u, Math.cos(ang)*R), scale3(v, Math.sin(ang)*R)));
        if (prev) addTube(prev, p, rTube, rTube, col, 6);
        prev = p;
      }
      const tang = add3(scale3(u, -Math.sin(sweep)), scale3(v, Math.cos(sweep)));
      addTube(prev, add3(prev, scale3(tang, scaleLen * 0.22)), rTube * 2.8, 0, col, 8);
    }
  }
  const vertices = Float32Array.from(out);
  return {vertices, vertexCount: vertices.length / 9};
}

// ---------- Viewport Shaded Mesh Renderer ----------

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

// ---------- Plugin Activation ----------

export async function activate(context) {
  if (context.version !== 1) throw failure('API_VERSION', 'Unsupported Frame plugin API.');

  const owner = hash => {
    const n = context.document.nodes.find(n => n.nativeHash === hash);
    if (n?.type !== 'structural') throw failure('INVALID_OWNER', 'Select a Structural object.');
    return n;
  };

  const states = new Map();       // ownerHash -> live state {job, model, result, mode, displayBuf, ...}
  const archives = new Map();     // ownerHash -> {version, frames: Map<frame, summary>, seriesCache}
  const deformations = new Map(); // ownerHash -> number (transient Deformation scale, default 1)
  const filterCache = new Map();  // ownerHash -> {shader, buffers:[{buffer,type}], uniformBuf, boundsKey}
  const voxPipeCache = new WeakMap();
  let renderState = {device: null, pipelines: null, pending: null, camGroups: new WeakMap(), camLayout: null};
  let jobSerial = 0;

  const getDeformation = hash => deformations.get(hash) ?? 1;
  const getArchive = hash => { let a = archives.get(hash); if (!a) archives.set(hash, a = {version: 0, frames: new Map(), series: new Map()}); return a; };
  const refresh = () => { context.requestAttributes(); context.requestDraw(); };

  function ensureRenderPipelines(device, format) {
    if (renderState.device === device && renderState.pipelines) return renderState.pipelines;
    if (renderState.device !== device) {
      renderState = {device, pipelines: null, pending: null, camGroups: new WeakMap(), camLayout: null};
    }
    if (renderState.pending) return null;
    renderState.pending = (async () => {
      const module = device.createShaderModule({label: 'Structural viewport surface', code: context.viewport.cameraWGSL + DISPLAY_WGSL});
      const camLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform'}}]});
      const layout = device.createPipelineLayout({bindGroupLayouts: [camLayout]});
      const vertexLayout = [{
        arrayStride: 36,
        attributes: [
          {shaderLocation: 0, offset: 0,  format: 'float32x3'},
          {shaderLocation: 1, offset: 12, format: 'float32x3'},
          {shaderLocation: 2, offset: 24, format: 'float32x3'}
        ]
      }];
      const built = await Promise.all([false, true].map(orthographic => device.createRenderPipelineAsync({
        label: 'Structural surface ' + (orthographic ? 'ortho' : 'persp'),
        layout,
        vertex: {module, entryPoint: 'vs', constants: {orthographic}, buffers: vertexLayout},
        fragment: {module, entryPoint: 'fs', targets: [{format}]},
        primitive: {topology: 'triangle-list', cullMode: 'none'},
        depthStencil: {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal'}
      })));
      if (renderState.device === device) {
        renderState.camLayout = camLayout;
        renderState.pipelines = built;
        context.requestDraw();
      }
    })().catch(() => {}).finally(() => { renderState.pending = null; });
    return null;
  }

  function retireOwner(hash) {
    const st = states.get(hash);
    if (st) {
      if (st.job) st.job.cancelled = true;
      st.displayBuf?.destroy();
      st.arrowBuf?.destroy();
      states.delete(hash);
    }
    const fc = filterCache.get(hash);
    if (fc) { fc.uniformBuf?.destroy(); filterCache.delete(hash); }
    archives.delete(hash);
    deformations.delete(hash);
  }

  function rebuildDisplayBuffer(hash) {
    const st = states.get(hash);
    if (!st?.model || !st.device) return;
    st.displayBuf?.destroy(); st.displayBuf = null; st.displayVerts = 0;
    const built = buildDisplayTriangles(st.model, st, st.mode, getDeformation(hash));
    if (built.vertexCount > 0) {
      st.displayBuf = st.device.createBuffer({
        label: 'Structural result triangles',
        size: Math.max(36, built.vertices.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      st.device.queue.writeBuffer(st.displayBuf, 0, built.vertices);
      st.displayVerts = built.vertexCount;
    }
    rebuildForceArrowBuffer(hash);
    updateSurfaceFilter(hash);
  }

  function collectLiveForcesForOwner(hash, st) {
    const n = context.document.nodes.find(x => x.nativeHash === hash && x.type === 'structural');
    if (!n) return {forces: [], refLen: 100};
    const domain = st?.model?.domain || null;
    const refLen = domain ? Math.max(...domain.lengthsM) * M_TO_MM : 100;
    if (st?.model?.resolvedForces) {
      const defScale = st.u && st.mode !== 'Voxels' ? getDeformation(hash) : 0;
      const [bx, by, bz] = st.model.domain.basis;
      return {
        refLen,
        forces: st.model.resolvedForces.filter(f => f.applied).map(f => {
          let origin = f.centroidWorldMm || scale3(f.pivotWorldM, M_TO_MM);
          if (defScale > 0 && f.elemIndices?.length) {
            let ux = 0, uy = 0, uz = 0, cnt = 0;
            for (const e of f.elemIndices) for (let a = 0; a < 8; a++) {
              const nid = st.model.elemNodes[8*e + a];
              ux += st.u[3*nid]; uy += st.u[3*nid+1]; uz += st.u[3*nid+2]; cnt++;
            }
            if (cnt) {
              ux /= cnt; uy /= cnt; uz /= cnt;
              const duWorldMm = [
                (bx[0]*ux + by[0]*uy + bz[0]*uz) * M_TO_MM * defScale,
                (bx[1]*ux + by[1]*uy + bz[1]*uz) * M_TO_MM * defScale,
                (bx[2]*ux + by[2]*uy + bz[2]*uz) * M_TO_MM * defScale
              ];
              origin = add3(origin, duWorldMm);
            }
          }
          return {originWorldMm: origin, forceWorldN: f.forceEffWorldN, torqueWorldNm: f.torqueEffWorldNm};
        })
      };
    }
    // Pre-solve live Force tags visualization in world coordinates at owner native pivots
    const forces = [];
    for (const node of context.document.nodes) {
      if (!node.nativeHash || !node.visible) continue;
      for (const t of node.tags || []) {
        if (t.kind !== 'structural_force') continue;
        const F = [t.params['Force X']||0, t.params['Force Y']||0, t.params['Force Z']||0];
        const T = [t.params['Torque X']||0, t.params['Torque Y']||0, t.params['Torque Z']||0];
        if (len3(F) === 0 && len3(T) === 0) continue;
        try {
          const w = context.document.world(node.nativeHash), p = context.document.pivot(node.nativeHash);
          const pivotW = context.math.point(w, [p[12], p[13], p[14]]);
          forces.push({originWorldMm: pivotW, forceWorldN: F, torqueWorldNm: T});
        } catch {}
      }
    }
    return {forces, refLen};
  }

  function rebuildForceArrowBuffer(hash) {
    const device = context.device; if (!device) return;
    let st = states.get(hash);
    if (!st) states.set(hash, st = {hash, device, state: 'idle'});
    st.arrowBuf?.destroy(); st.arrowBuf = null; st.arrowVerts = 0;
    const {forces, refLen} = collectLiveForcesForOwner(hash, st);
    const built = buildForceArrowTriangles(forces, refLen);
    if (built.vertexCount > 0) {
      st.arrowBuf = device.createBuffer({
        label: 'Structural force arrows',
        size: Math.max(36, built.vertices.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      device.queue.writeBuffer(st.arrowBuf, 0, built.vertices);
      st.arrowVerts = built.vertexCount;
    }
  }

  function updateSurfaceFilter(hash) {
    const st = states.get(hash), device = st?.device;
    if (!st?.model || !st.displayVerts || !device) {
      const old = filterCache.get(hash);
      if (old) { old.uniformBuf?.destroy(); filterCache.delete(hash); }
      return;
    }
    const d = st.model.domain;
    // Uniform: originMm (vec4f), bx/Lx (vec4f), by/Ly (vec4f), bz/Lz (vec4f)
    const data = new Float32Array(16);
    data.set([d.originWorldM[0]*M_TO_MM, d.originWorldM[1]*M_TO_MM, d.originWorldM[2]*M_TO_MM, 0], 0);
    data.set([d.basis[0][0], d.basis[0][1], d.basis[0][2], d.lengthsM[0]*M_TO_MM], 4);
    data.set([d.basis[1][0], d.basis[1][1], d.basis[1][2], d.lengthsM[1]*M_TO_MM], 8);
    data.set([d.basis[2][0], d.basis[2][1], d.basis[2][2], d.lengthsM[2]*M_TO_MM], 12);
    let entry = filterCache.get(hash);
    if (!entry || entry.device !== device) {
      entry?.uniformBuf?.destroy();
      const uniformBuf = device.createBuffer({label: 'Structural surface filter', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
      const shader = `
        struct StructuralClip { origin: vec4f, bx: vec4f, by: vec4f, bz: vec4f };
        @group(3) @binding(0) var<uniform> structuralClip: StructuralClip;
        fn pluginSurfaceKeep(world: vec3f) -> bool {
          let d = world - structuralClip.origin.xyz;
          let u = dot(d, structuralClip.bx.xyz);
          let v = dot(d, structuralClip.by.xyz);
          let w = dot(d, structuralClip.bz.xyz);
          let inside = u >= -0.05 && u <= structuralClip.bx.w + 0.05 &&
                       v >= -0.05 && v <= structuralClip.by.w + 0.05 &&
                       w >= -0.05 && w <= structuralClip.bz.w + 0.05;
          return !inside;
        }
      `;
      entry = {owner: hash, device, uniformBuf, shader, buffers: [{buffer: uniformBuf, type: 'uniform'}], hashes: new Set()};
      filterCache.set(hash, entry);
    }
    entry.hashes = new Set(st.participatingHashes || []);
    device.queue.writeBuffer(entry.uniformBuf, 0, data);
  }

  // ---------- Scene Capture -> GPU Voxelization -> Mechanical Model ----------

  const CAPTURE_KEYS = ['Auto size', 'Voxel size'];

  function computeAutoWorldBounds(meshes) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], found = false;
    for (const m of meshes) {
      const t = m.tags;
      const tagged = t && (t.nearest?.structural_material || t.nearest?.structural_fixture || t.nearest?.structural_preserve || t.nearest?.structural_optimize_space || (t.additive?.structural_force?.length > 0));
      if (!tagged) continue;
      found = true;
      // Compute world AABB from local mesh bounds or capture bounds? Capture bounds are in owner-local;
      // transform owner-local bounds corners back to world!
      // Actually we can use m.worldMatrix directly if we have local bounds, OR transform m.bounds by ownerWorld!
      for (let k = 0; k < 8; k++) {
        const cornerLocal = [
          k & 1 ? m.bounds.max[0] : m.bounds.min[0],
          k & 2 ? m.bounds.max[1] : m.bounds.min[1],
          k & 4 ? m.bounds.max[2] : m.bounds.min[2]
        ];
        // Note: m.bounds is in owner-local frame -> convert via ownerWorld
        const p = context.math.point(m._ownerWorld, cornerLocal);
        for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
      }
    }
    return found ? {min, max} : null;
  }

  async function captureAndVoxelize(hash, checkCurrent, {requireMaterial = true} = {}) {
    const n = owner(hash), device = context.device;
    if (!device) throw failure('NO_DEVICE', 'Shared WebGPU device is unavailable.');
    validateParameters(n.params);
    const autoSize = !!n.params['Auto size'];
    const voxelSizeMm = n.params['Voxel size'];
    const ownerWorld = context.document.world(hash);
    const captureOpts = {includeTags: true};
    const snapshot = context.scene.capture(hash, CAPTURE_KEYS, captureOpts);
    const meshesWithWorld = snapshot.meshes.map(m => ({...m, _ownerWorld: ownerWorld}));

    const domain = autoSize
      ? computeAutoDomain(computeAutoWorldBounds(meshesWithWorld), voxelSizeMm)
      : computeManualDomain(ownerWorld, voxelSizeMm);

    const pipes = await getVoxelizerPipelines(device, voxPipeCache);
    checkCurrent();

    const pad = domain.cutBoundaryEnabled ? 1 : 0;
    const domainWords = Math.ceil(domain.count / 32);
    const fixtureMask = new Uint32Array(domainWords);
    const preserveMask = new Uint32Array(domainWords);
    const optSpaceMask = new Uint32Array(domainWords);
    const materialBodies = [];
    const forceSourceMap = new Map();
    const participatingHashes = new Set();
    let hasFixture = false, hasPreserve = false, hasOptSpace = false;

    const orBits = (dst, src) => { for (let i = 0; i < dst.length; i++) dst[i] |= src[i]; };
    const intersectsManual = m => autoSize || !m.bounds.min.some((v, i) => v > 50 + voxelSizeMm * 2 || m.bounds.max[i] < -50 - voxelSizeMm * 2);

    for (const m of meshesWithWorld) {
      const nearest = m.tags?.nearest || {};
      const additiveForces = m.tags?.additive?.structural_force || [];
      const isFixture = !!nearest.structural_fixture;
      const matTag = nearest.structural_material;
      const isPreserve = !!nearest.structural_preserve;
      const isOptSpace = !!nearest.structural_optimize_space;
      if (!isFixture && !matTag && !isPreserve && !isOptSpace && !additiveForces.length) continue;
      const inBox = intersectsManual(m);
      if (!inBox && !additiveForces.length) continue;

      checkCurrent();
      const vox = await voxelizeOccurrenceGPU(device, m, domain, pad, pipes, true, checkCurrent);
      if (vox.activeCount > 0) participatingHashes.add(m.hash);

      if (isFixture && vox.activeCount > 0) { orBits(fixtureMask, vox.occupancy); hasFixture = true; }
      if (isPreserve && vox.activeCount > 0) { orBits(preserveMask, vox.occupancy); hasPreserve = true; }
      if (isOptSpace && vox.activeCount > 0) { orBits(optSpaceMask, vox.occupancy); hasOptSpace = true; }
      if (matTag && !isFixture && vox.activeCount > 0) {
        materialBodies.push({
          hash: m.hash, solid: m.solid,
          material: matTag.params.Material,
          ownerHash: matTag.ownerHash, uid: matTag.uid,
          occupancy: vox.occupancy, cutFaces: vox.cutFaces,
          activeCount: vox.activeCount, volumeM3: vox.volumeM3
        });
      }
      for (const fTag of additiveForces) {
        const key = fTag.ownerHash + ':' + fTag.uid;
        let rec = forceSourceMap.get(key);
        if (!rec) {
          const pivW = context.math.point(fTag.world, [fTag.pivot[12], fTag.pivot[13], fTag.pivot[14]]);
          rec = {
            ownerHash: fTag.ownerHash, uid: fTag.uid,
            forceWorldN: [fTag.params['Force X']||0, fTag.params['Force Y']||0, fTag.params['Force Z']||0],
            torqueWorldNm: [fTag.params['Torque X']||0, fTag.params['Torque Y']||0, fTag.params['Torque Z']||0],
            pivotWorldM: scale3(pivW, MM_TO_M),
            occupancy: new Uint32Array(domainWords),
            totalVolumeM3: 0
          };
          forceSourceMap.set(key, rec);
        }
        if (vox.activeCount > 0) orBits(rec.occupancy, vox.occupancy);
        rec.totalVolumeM3 += vox.volumeM3;
      }
    }

    if (requireMaterial && !materialBodies.length)
      throw failure('NO_STRUCTURAL_MATERIAL', 'No solid geometry with a Structural Material tag was found inside the domain.');

    const signature = snapshot.signature + '|' + context.document.world(hash).map(v => Math.round(v*1e6)).join(',');
    const assertFresh = () => {
      checkCurrent();
      if (context.device !== device) throw failure('STALE_DEVICE', 'WebGPU device changed.');
      const curSig = context.scene.signature(hash, CAPTURE_KEYS, captureOpts) + '|' + context.document.world(hash).map(v => Math.round(v*1e6)).join(',');
      if (curSig !== signature) throw failure('STALE_SCENE', 'Scene geometry, transforms or Structural tags changed.');
    };

    const model = buildMechanicalModel({
      domain, materialBodies,
      fixtureMask: hasFixture ? fixtureMask : null,
      preserveMask: hasPreserve ? preserveMask : null,
      optSpaceMask: hasOptSpace ? optSpaceMask : null,
      forceSources: [...forceSourceMap.values()],
      includeGravity: true
    });

    return {model, signature, assertFresh, participatingHashes, frame: context.document.frame, device};
  }

  // ---------- Solve Frame / Show Voxels / Optimize Frame / Animation ----------

  function cancelJob(hash) {
    const st = states.get(hash);
    if (st?.job && ['queued','solving','optimizing'].includes(st.job.state)) {
      st.job.cancelled = true;
      st.job.state = 'stopped';
      refresh();
    }
  }

  function startJob(hash, kind, fn) {
    const n = owner(hash);
    if (n.enabled === false) throw failure('DISABLED', 'Enable the Structural object first.');
    cancelJob(hash);
    let st = states.get(hash);
    if (!st) states.set(hash, st = {hash, device: context.device, mode: 'Safety factor'});
    const job = {id: ++jobSerial, kind, state: 'solving', progress: 'Preparing', cancelled: false, error: null, done: null};
    st.job = job; st.error = null;
    const checkCurrent = () => {
      if (job.cancelled || states.get(hash)?.job !== job) throw failure('CANCELLED', 'Structural calculation stopped.');
      if (!context.document.nodes.some(x => x.nativeHash === hash && x.type === 'structural')) throw failure('INVALID_OWNER', 'Structural object was removed.');
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
        if (err?.code === 'CANCELLED' || job.cancelled) {
          job.state = 'stopped'; job.progress = '';
        } else {
          job.state = 'failed';
          job.error = {code: err?.code || 'STRUCTURAL_FAILED', message: err?.message || String(err)};
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

  function recordFrameArchive(hash, frame, evalData) {
    const a = getArchive(hash);
    a.frames.set(frame, {
      frame,
      safetyFactor: evalData.safetyFactor,
      maxStressMPa: evalData.maxStressMPa,
      maxDispMm: evalData.maxDispMm,
      massG: evalData.massG
    });
    a.version++;
    a.series.clear();
  }

  function readoutSeries(hash, metricKey, label, unit) {
    const a = getArchive(hash);
    const st = states.get(hash);
    const cacheKey = metricKey + ':' + a.version + ':' + (st?.eval ? st.frame : 'none');
    if (a.series.has(cacheKey)) return a.series.get(cacheKey);
    const map = new Map(a.frames);
    if (st?.eval) {
      map.set(st.frame, {
        frame: st.frame,
        safetyFactor: st.eval.safetyFactor,
        maxStressMPa: st.eval.maxStressMPa,
        maxDispMm: st.eval.maxDispMm,
        massG: st.eval.massG
      });
    }
    const samples = [...map.values()].sort((x, y) => x.frame - y.frame)
      .filter(s => Number.isFinite(s[metricKey]))
      .map(s => ({frame: s.frame, values: [s[metricKey]]}));
    const out = {labels: [label], unit, samples};
    a.series.set(cacheKey, out);
    return out;
  }

  function runShowVoxels(hash) {
    return startJob(hash, 'show-voxels', async (job, checkCurrent) => {
      job.progress = 'Voxelizing'; refresh();
      const cap = await captureAndVoxelize(hash, checkCurrent, {requireMaterial: true});
      cap.assertFresh();
      const st = states.get(hash);
      Object.assign(st, {
        device: cap.device, model: cap.model, signature: cap.signature,
        frame: cap.frame, participatingHashes: cap.participatingHashes,
        u: null, eval: null, density: null, solidMask: null, optimized: false,
        mode: 'Voxels'
      });
      rebuildDisplayBuffer(hash);
      return {
        state: 'voxels', frame: cap.frame,
        grid: cap.model.domain.cells, stats: cap.model.stats,
        massG: cap.model.totalMassKg * 1000
      };
    });
  }

  function runSolveFrame(hash, {tolerance = 1e-4, maxIterations = 2500} = {}) {
    return startJob(hash, 'solve-frame', async (job, checkCurrent) => {
      job.progress = 'Voxelizing'; refresh();
      const cap = await captureAndVoxelize(hash, checkCurrent);
      cap.assertFresh();
      job.progress = 'Solving'; refresh();
      const solver = await createGPUSolverSession(cap.device, cap.model, checkCurrent);
      let sol;
      try {
        sol = await solver.solveWithContact({loads: cap.model.loadsTotal, tolerance, maxIterations});
      } finally {
        await solver.dispose();
      }
      cap.assertFresh();
      job.progress = 'Post-processing'; refresh();
      const evalData = evaluateElements(cap.model, sol.u);
      const st = states.get(hash);
      Object.assign(st, {
        device: cap.device, model: cap.model, signature: cap.signature,
        frame: cap.frame, participatingHashes: cap.participatingHashes,
        u: sol.u, eval: evalData, density: null, solidMask: null, optimized: false,
        iterations: sol.totalIterations, relativeResidual: sol.relativeResidual,
        mode: st.mode && ['Safety factor','Stress','Displacement'].includes(st.mode) ? st.mode : 'Safety factor'
      });
      recordFrameArchive(hash, cap.frame, evalData);
      rebuildDisplayBuffer(hash);
      return {
        state: 'solved', frame: cap.frame,
        safetyFactor: evalData.safetyFactor,
        maxStressMPa: evalData.maxStressMPa,
        maxDispMm: evalData.maxDispMm,
        massG: evalData.massG,
        iterations: sol.totalIterations,
        relativeResidual: sol.relativeResidual,
        grid: cap.model.domain.cells,
        stats: cap.model.stats
      };
    });
  }

  async function seekForSweep(frame, fromFrame, checkCurrent) {
    if (context.document.frame === frame) return;
    for (;;) {
      checkCurrent();
      try {
        const res = await context.animation.seek(frame, fromFrame, checkCurrent);
        if (res.frame !== frame) throw failure('STALE_FRAME', 'Timeline frame changed during sweep.');
        return;
      } catch (err) {
        if (err?.code !== 'BUSY') throw err;
        await new Promise(r => setTimeout(r, 40));
      }
    }
  }

  function gatherRelevantHashes(hash) {
    const out = [hash];
    for (const n of context.document.nodes) {
      if (!n.nativeHash) continue;
      if ((n.tags || []).some(t => t.kind?.startsWith('structural_'))) out.push(n.nativeHash);
    }
    return [...new Set(out)];
  }

  function runSolveAnimation(hash, {firstFrame = 0, lastFrame, tolerance = 1e-4, maxIterations = 2500} = {}) {
    const tl = context.animation.timeline();
    lastFrame ??= tl.total;
    if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame) || firstFrame < 0 || lastFrame < firstFrame || lastFrame > tl.total)
      throw failure('INVALID_ARGUMENT', 'Invalid animation frame interval.');
    context.document.pause();
    return startJob(hash, 'solve-animation', async (job, checkCurrent) => {
      const initialFrame = context.document.frame;
      const animInfo = context.animation.inspect(gatherRelevantHashes(hash));
      const frameList = collectAnimationFrames(animInfo, firstFrame, lastFrame);
      const a = getArchive(hash);
      a.frames.clear(); a.version++; a.series.clear();
      const cacheBySig = new Map();
      let worstSF = Infinity, peakStress = 0, peakDisp = 0, initialRec = null, lastRec = null;
      try {
        for (let idx = 0; idx < frameList.length; idx++) {
          const f = frameList[idx];
          checkCurrent();
          job.progress = `${idx + 1}/${frameList.length} (f${f})`; refresh();
          await seekForSweep(f, context.document.frame, checkCurrent);
          const cap = await captureAndVoxelize(hash, checkCurrent);
          cap.assertFresh();
          let evalData, sol;
          if (cacheBySig.has(cap.signature)) {
            ({evalData, sol} = cacheBySig.get(cap.signature));
          } else {
            const solver = await createGPUSolverSession(cap.device, cap.model, checkCurrent);
            try { sol = await solver.solveWithContact({loads: cap.model.loadsTotal, tolerance, maxIterations}); }
            finally { await solver.dispose(); }
            cap.assertFresh();
            evalData = evaluateElements(cap.model, sol.u);
            cacheBySig.set(cap.signature, {evalData, sol});
          }
          recordFrameArchive(hash, f, evalData);
          if (evalData.safetyFactor < worstSF) worstSF = evalData.safetyFactor;
          if (evalData.maxStressMPa > peakStress) peakStress = evalData.maxStressMPa;
          if (evalData.maxDispMm > peakDisp) peakDisp = evalData.maxDispMm;
          lastRec = {cap, sol, evalData};
          if (f === initialFrame) initialRec = lastRec;
        }
      } finally {
        if (context.document.frame !== initialFrame) {
          try { await context.animation.seek(initialFrame, context.document.frame); } catch {}
        }
      }
      const showRec = initialRec || lastRec;
      if (showRec) {
        const st = states.get(hash);
        Object.assign(st, {
          device: showRec.cap.device, model: showRec.cap.model, signature: showRec.cap.signature,
          frame: showRec.cap.frame, participatingHashes: showRec.cap.participatingHashes,
          u: showRec.sol.u, eval: showRec.evalData, density: null, solidMask: null, optimized: false,
          mode: st.mode && ['Safety factor','Stress','Displacement'].includes(st.mode) ? st.mode : 'Safety factor'
        });
        rebuildDisplayBuffer(hash);
      }
      return {
        state: 'solved-animation', frames: frameList,
        envelope: {safetyFactor: worstSF, maxStressMPa: peakStress, maxDispMm: peakDisp}
      };
    });
  }

  // ---------- SIMP Topology Optimization (Single or Multi-Load-Case Shared Topology) ----------

  function buildConeFilter(model, radiusCells = 1.5) {
    const {domain, elemCount, elemCell, cellElem} = model;
    const [nx, ny, nz] = domain.cells, r = Math.ceil(radiusCells);
    const cellIdx = (x, y, z) => x + nx * (y + ny * z);
    const nbrs = Array.from({length: elemCount}, () => []);
    for (let e = 0; e < elemCount; e++) {
      const c = elemCell[e], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
      for (let dz = -r; dz <= r; dz++) {
        const zz = z + dz; if (zz < 0 || zz >= nz) continue;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= ny) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= nx) continue;
            const d = Math.hypot(dx, dy, dz);
            if (d > radiusCells) continue;
            const ne = cellElem[cellIdx(xx, yy, zz)];
            if (ne >= 0) nbrs[e].push(ne, radiusCells - d);
          }
        }
      }
    }
    return nbrs;
  }

  function keepConnectedToSupports(model, solidMask) {
    const {domain, elemCount, elemCell, elemNodes, cellElem, fixedPermanent, fixtureContacts} = model;
    const [nx, ny, nz] = domain.cells;
    const cellIdx = (x, y, z) => x + nx * (y + ny * z);
    const supportedNode = new Uint8Array(model.nodeCount);
    for (let n = 0; n < model.nodeCount; n++) {
      if (fixedPermanent[3*n] || fixedPermanent[3*n+1] || fixedPermanent[3*n+2]) supportedNode[n] = 1;
    }
    for (const fc of fixtureContacts) supportedNode[fc.node] = 1;
    const visited = new Uint8Array(elemCount), queue = [];
    for (let e = 0; e < elemCount; e++) {
      if (!solidMask[e]) continue;
      let sup = false;
      for (let a = 0; a < 8; a++) if (supportedNode[elemNodes[8*e + a]]) { sup = true; break; }
      if (sup) { visited[e] = 1; queue.push(e); }
    }
    if (!queue.length) return solidMask;
    for (let h = 0; h < queue.length; h++) {
      const e = queue[h], c = elemCell[e], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
      for (let fi = 0; fi < 6; fi++) {
        const fd = FACE_DIRS[fi];
        const xx = x + (fd.axis===0?fd.sign:0), yy = y + (fd.axis===1?fd.sign:0), zz = z + (fd.axis===2?fd.sign:0);
        if (xx<0||xx>=nx||yy<0||yy>=ny||zz<0||zz>=nz) continue;
        const ne = cellElem[cellIdx(xx, yy, zz)];
        if (ne >= 0 && solidMask[ne] && !visited[ne]) { visited[ne] = 1; queue.push(ne); }
      }
    }
    return visited;
  }

  async function runSIMP(hash, job, checkCurrent, {maxOptIterations = 18, loadCases = null, tolerance = 2e-4, maxIterations = 2000} = {}) {
    const n = owner(hash);
    const targetFrac = Math.max(0.05, Math.min(1, n.params['Material (%)'] / 100));
    job.progress = 'Voxelizing'; refresh();
    const cap = await captureAndVoxelize(hash, checkCurrent);
    cap.assertFresh();
    const model = cap.model, {elemCount, elemNodes, elemMat, matrices, dofs, elemLocked, elemOptSpace, hasOptSpace} = model;

    // Determine design variables: Optimize Space minus locked, or all material minus locked if no Optimize Space
    const designElems = [];
    for (let e = 0; e < elemCount; e++) {
      if (elemLocked[e]) continue;
      if (hasOptSpace && !elemOptSpace[e]) continue;
      designElems.push(e);
    }
    if (!designElems.length) throw failure('NO_DESIGN_DOMAIN', 'No optimizable voxels available (all voxels are Preserve, Fixture or outside Optimize Space).');

    const cases = loadCases && loadCases.length ? loadCases : [{frame: cap.frame, loadsExternal: model.loadsExternal}];
    const rho = new Float64Array(elemCount).fill(1);
    for (const e of designElems) rho[e] = targetFrac;
    const filter = buildConeFilter(model, 1.5);
    const pen = 3, eMin = 1e-3, move = 0.2;
    const solver = await createGPUSolverSession(cap.device, model, checkCurrent);
    const elemScale = new Float32Array(elemCount);
    const dc = new Float64Array(elemCount), dcFilt = new Float64Array(elemCount);
    const cellVol = model.domain.spacingM[0] * model.domain.spacingM[1] * model.domain.spacingM[2];

    let lastSol = null;
    try {
      for (let iter = 0; iter < maxOptIterations; iter++) {
        checkCurrent();
        job.progress = `Opt ${iter + 1}/${maxOptIterations}`; refresh();
        for (let e = 0; e < elemCount; e++) elemScale[e] = eMin + (1 - eMin) * (rho[e] ** pen);

        // Assemble density-weighted gravity once per iteration
        const gravNow = new Float64Array(dofs);
        for (let e = 0; e < elemCount; e++) {
          const m = model.materials[elemMat[e]], em = m.density * rho[e] * cellVol;
          const fx = em * model.gGrid[0] / 8, fy = em * model.gGrid[1] / 8, fz = em * model.gGrid[2] / 8;
          const base = 8 * e;
          for (let a = 0; a < 8; a++) {
            const nid = elemNodes[base + a];
            gravNow[3*nid] += fx; gravNow[3*nid+1] += fy; gravNow[3*nid+2] += fz;
          }
        }

        dc.fill(0);
        for (const lc of cases) {
          checkCurrent();
          const rhs = new Float64Array(dofs);
          for (let i = 0; i < dofs; i++) rhs[i] = lc.loadsExternal[i] + gravNow[i];
          const sol = await solver.solveWithContact({loads: rhs, elemScale, warmStart: iter > 0 && cases.length === 1, tolerance, maxIterations});
          lastSol = sol;
          // Element compliance sensitivity + exact gravity sensitivity
          const u = sol.u;
          for (const e of designElems) {
            const K = matrices[elemMat[e]], base = 8 * e;
            let ce = 0;
            for (let a = 0; a < 24; a++) {
              const ua = u[3*elemNodes[base + (a/3|0)] + (a%3)];
              let s = 0;
              for (let b = 0; b < 24; b++) s += K[a*24+b] * u[3*elemNodes[base + (b/3|0)] + (b%3)];
              ce += ua * s;
            }
            // Self-weight derivative term
            const m = model.materials[elemMat[e]], em1 = m.density * cellVol / 8;
            let gravDot = 0;
            for (let a = 0; a < 8; a++) {
              const nid = elemNodes[base + a];
              gravDot += u[3*nid]*model.gGrid[0] + u[3*nid+1]*model.gGrid[1] + u[3*nid+2]*model.gGrid[2];
            }
            dc[e] += -pen * (1 - eMin) * (rho[e] ** (pen - 1)) * ce + 2 * em1 * gravDot;
          }
        }

        // Mesh-independent sensitivity filter
        for (const e of designElems) {
          const list = filter[e];
          let num = 0, den = 0;
          for (let k = 0; k < list.length; k += 2) {
            const j = list[k], w = list[k + 1];
            num += w * rho[j] * dc[j];
            den += w;
          }
          dcFilt[e] = Math.min(-1e-30, num / Math.max(1e-12, rho[e] * den));
        }

        // Optimality Criteria bisection for target Material (%) with scale-independent bracket
        let maxNegDc = 0;
        for (const e of designElems) if (-dcFilt[e] > maxNegDc) maxNegDc = -dcFilt[e];
        let l1 = 0, l2 = Math.max(1e-30, maxNegDc * 4), maxChange = 0;
        const next = rho.slice();
        const evalOC = lmid => {
          let sumDesign = 0;
          for (const e of designElems) {
            const cand = rho[e] * Math.sqrt(Math.max(0, -dcFilt[e] / Math.max(1e-300, lmid)));
            const val = Math.max(0.01, Math.max(rho[e] - move, Math.min(1, Math.min(rho[e] + move, cand))));
            next[e] = val;
            sumDesign += val;
          }
          return sumDesign / designElems.length;
        };
        for (let expand = 0; expand < 40 && evalOC(l2) > targetFrac; expand++) l2 *= 4;
        for (let bi = 0; bi < 50 && (l2 - l1) / Math.max(1e-300, l1 + l2) > 1e-5; bi++) {
          const lmid = 0.5 * (l1 + l2);
          if (evalOC(lmid) > targetFrac) l1 = lmid; else l2 = lmid;
        }
        evalOC(0.5 * (l1 + l2));
        for (const e of designElems) { maxChange = Math.max(maxChange, Math.abs(next[e] - rho[e])); rho[e] = next[e]; }

        // Yield to UI between SIMP iterations
        await new Promise(r => setTimeout(r, 0));
        if (iter >= 5 && maxChange < 0.015) break;
      }

      // Extract crisp binary topology matching target Material (%), ensure locked/load regions stay connected to supports, and verify with exact full stiffness!
      job.progress = 'Verifying'; refresh();
      const sorted = designElems.slice().sort((a, b) => rho[b] - rho[a]);
      let keepCount = Math.max(1, Math.round(targetFrac * designElems.length));
      const buildConnectedMask = count => {
        const m = new Uint8Array(elemCount);
        for (let e = 0; e < elemCount; e++) if (elemLocked[e] || (hasOptSpace && !elemOptSpace[e])) m[e] = 1;
        for (let i = 0; i < Math.min(count, sorted.length); i++) m[sorted[i]] = 1;
        return keepConnectedToSupports(model, m);
      };
      let solidMask = buildConnectedMask(keepCount);
      // If any locked (Preserve/Force) voxel was disconnected from supports, grow keepCount until connected
      const allLockedConnected = m => {
        for (let e = 0; e < elemCount; e++) if (elemLocked[e] && !m[e]) return false;
        return true;
      };
      while (!allLockedConnected(solidMask) && keepCount < sorted.length) {
        keepCount = Math.min(sorted.length, keepCount + Math.max(1, Math.ceil(sorted.length * 0.08)));
        solidMask = buildConnectedMask(keepCount);
      }

      // Final exact full-stiffness verification solve on kept solid ONLY (0.0 void, void-only DOFs clamped -> zero artificial air stiffness!)
      const finalScale = new Float32Array(elemCount);
      const finalGrav = new Float64Array(dofs);
      const activeNode = new Uint8Array(model.nodeCount);
      for (let e = 0; e < elemCount; e++) {
        if (!solidMask[e]) continue;
        finalScale[e] = 1.0;
        const m = model.materials[elemMat[e]], em = m.density * cellVol;
        const fx = em * model.gGrid[0] / 8, fy = em * model.gGrid[1] / 8, fz = em * model.gGrid[2] / 8;
        for (let a = 0; a < 8; a++) {
          const nid = elemNodes[8*e + a];
          activeNode[nid] = 1;
          finalGrav[3*nid] += fx; finalGrav[3*nid+1] += fy; finalGrav[3*nid+2] += fz;
        }
      }
      const voidFixed = new Uint8Array(dofs);
      for (let nid = 0; nid < model.nodeCount; nid++) {
        if (!activeNode[nid]) voidFixed[3*nid] = voidFixed[3*nid+1] = voidFixed[3*nid+2] = 1;
      }
      const a = getArchive(hash);
      if (cases.length > 1) { a.frames.clear(); a.version++; a.series.clear(); }
      let worstEval = null, worstSol = null;
      for (const lc of cases) {
        const rhs = new Float64Array(dofs);
        for (let i = 0; i < dofs; i++) rhs[i] = voidFixed[i] ? 0 : (lc.loadsExternal[i] + finalGrav[i]);
        const sol = await solver.solveWithContact({loads: rhs, elemScale: finalScale, extraFixed: voidFixed, tolerance: 1e-4, maxIterations});
        const ev = evaluateElements(model, sol.u, solidMask);
        recordFrameArchive(hash, lc.frame, ev);
        if (!worstEval || ev.safetyFactor < worstEval.safetyFactor) { worstEval = ev; worstSol = sol; }
      }
      cap.assertFresh();

      const st = states.get(hash);
      Object.assign(st, {
        device: cap.device, model, signature: cap.signature,
        frame: cap.frame, participatingHashes: cap.participatingHashes,
        u: worstSol.u, eval: worstEval,
        density: Float32Array.from(rho), solidMask,
        optimized: true, mode: 'Safety factor'
      });
      rebuildDisplayBuffer(hash);
      return {
        state: 'optimized', frame: cap.frame,
        safetyFactor: worstEval.safetyFactor,
        maxStressMPa: worstEval.maxStressMPa,
        maxDispMm: worstEval.maxDispMm,
        massG: worstEval.massG,
        initialMassG: model.totalMassKg * 1000,
        solidVoxels: solidMask.reduce((s, v) => s + v, 0),
        initialVoxels: elemCount,
        loadCases: cases.length
      };
    } finally {
      await solver.dispose();
    }
  }

  function runOptimizeFrame(hash, args = {}) {
    return startJob(hash, 'optimize-frame', (job, checkCurrent) => runSIMP(hash, job, checkCurrent, args));
  }

  function runOptimizeAnimation(hash, {firstFrame = 0, lastFrame, maxOptIterations = 16} = {}) {
    const tl = context.animation.timeline();
    lastFrame ??= tl.total;
    if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame) || firstFrame < 0 || lastFrame < firstFrame || lastFrame > tl.total)
      throw failure('INVALID_ARGUMENT', 'Invalid animation frame interval.');
    context.document.pause();
    return startJob(hash, 'optimize-animation', async (job, checkCurrent) => {
      const initialFrame = context.document.frame;
      const animInfo = context.animation.inspect(gatherRelevantHashes(hash));
      const frameList = collectAnimationFrames(animInfo, firstFrame, lastFrame);
      const loadCases = [];
      let baseNodeCount = null;
      try {
        for (let idx = 0; idx < frameList.length; idx++) {
          const f = frameList[idx];
          checkCurrent();
          job.progress = `Case ${idx + 1}/${frameList.length} (f${f})`; refresh();
          await seekForSweep(f, context.document.frame, checkCurrent);
          const cap = await captureAndVoxelize(hash, checkCurrent);
          if (baseNodeCount === null) baseNodeCount = cap.model.nodeCount;
          if (cap.model.nodeCount === baseNodeCount) {
            loadCases.push({frame: f, loadsExternal: cap.model.loadsExternal});
          }
        }
      } finally {
        if (context.document.frame !== initialFrame) {
          try { await context.animation.seek(initialFrame, context.document.frame); } catch {}
        }
      }
      return await runSIMP(hash, job, checkCurrent, {maxOptIterations, loadCases});
    });
  }

  async function runResultToObject(hash) {
    owner(hash);
    const st = states.get(hash);
    if (!st?.optimized || !st.model || !st.solidMask)
      throw failure('NO_OPTIMIZED_RESULT', 'Run Optimize Frame or Optimize Animation before creating a Result object.');
    const extracted = extractOptimizedMesh(st.model, st.solidMask);
    const published = await context.document.createMesh({
      name: 'Structural Result',
      vertices: extracted.vertices,
      indices: extracted.indices,
      creaseAngle: 44
    });
    return {created: published};
  }

  function statusOf(hash) {
    const n = owner(hash), st = states.get(hash);
    const a = archives.get(hash);
    return {
      stage: 'ready',
      state: st?.job?.state || 'idle',
      authoringOnly: false,
      numericalAvailable: true,
      autoSize: !!n.params['Auto size'],
      voxelSizeMm: n.params['Voxel size'],
      materialPercent: n.params['Material (%)'],
      deformationScale: getDeformation(hash),
      displayMode: st?.mode || null,
      optimized: !!st?.optimized,
      resultAvailable: !!st?.eval,
      voxelsAvailable: !!st?.model,
      job: st?.job ? {id: st.job.id, kind: st.job.kind, state: st.job.state, progress: st.job.progress, error: st.job.error} : null,
      error: st?.error || null,
      grid: st?.model?.domain.cells || null,
      stats: st?.model?.stats || null,
      result: st?.eval ? {
        frame: st.frame,
        safetyFactor: st.eval.safetyFactor,
        maxStressMPa: st.eval.maxStressMPa,
        maxDispMm: st.eval.maxDispMm,
        massG: st.eval.massG,
        iterations: st.iterations ?? null,
        relativeResidual: st.relativeResidual ?? null
      } : null,
      archivedFrames: a ? a.frames.size : 0
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
    // Look up cell or nearest active 1-ring neighbor (boundary hit lies right on surface face)
    let e = -1, bestDist = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      if (cx < 0 || cx >= nx || cy < 0 || cy >= ny || cz < 0 || cz >= nz) continue;
      const cand = st.model.cellElem[cellIdx(cx, cy, cz)];
      if (cand < 0) continue;
      if (st.solidMask && !st.solidMask[cand]) continue;
      const dist = Math.hypot(g[0] - (cx + 0.5), g[1] - (cy + 0.5), g[2] - (cz + 0.5));
      if (dist < bestDist) { bestDist = dist; e = cand; }
    }
    if (e < 0 || bestDist > 1.75) return null;
    const mat = st.model.materials[st.model.elemMat[e]];
    if (st.mode === 'Voxels' || !st.eval) {
      const role = ROLE_LABELS[st.model.cellRole[e]] || 'Material';
      return {text: `${mat.name} · ${role}`};
    }
    const sf = st.eval.elemSF[e], stressMPa = st.eval.elemStressPa[e] * 1e-6, dispMm = st.eval.elemDispM[e] * M_TO_MM;
    const densTxt = st.density ? ` · ρ ${Math.round(st.density[e]*100)}%` : '';
    return {text: `SF ${fmtNum(sf)} · ${fmtNum(stressMPa)} MPa · ${fmtNum(dispMm)} mm${densTxt}`};
  }

  // ---------- Operations Registry ----------

  const frameRangeSchema = {
    type: 'object',
    properties: {
      firstFrame: {type: 'integer', minimum: 0},
      lastFrame:  {type: 'integer', minimum: 0},
      tolerance:  {type: 'number', minimum: 1e-7, maximum: 1e-2},
      maxIterations: {type: 'integer', minimum: 10, maximum: 10000}
    },
    additionalProperties: false
  };

  context.operations.register([
    {id: 'status', description: 'Inspect Structural domain, job progress, grid stats and current Safety factor / Stress / Displacement / Mass results.', inputSchema: emptySchema, readOnly: true, run: statusOf},
    {id: 'show-voxels', description: 'Voxelize tagged geometry inside the Structural domain and display contact/weld/cut/preserve voxel roles.', inputSchema: emptySchema, readOnly: false, run: runShowVoxels},
    {id: 'solve-frame', description: 'Run GPU matrix-free Hex8 FEM with gravity, conserved forces/torques, cut-boundary fixing and frictionless contact at the current frame.', inputSchema: {type:'object', properties:{tolerance:{type:'number',minimum:1e-7,maximum:1e-2}, maxIterations:{type:'integer',minimum:10,maximum:10000}}, additionalProperties:false}, readOnly: false, run: runSolveFrame},
    {id: 'solve-animation', description: 'Solve independent static load cases across keyframes and changed frames in the timeline range.', inputSchema: frameRangeSchema, readOnly: false, run: runSolveAnimation},
    {id: 'optimize-frame', description: 'Run SIMP topology optimization at the current frame to match Material (%) while keeping Preserve/Fixture/Force regions intact.', inputSchema: {type:'object', properties:{maxOptIterations:{type:'integer',minimum:1,maximum:60}}, additionalProperties:false}, readOnly: false, run: runOptimizeFrame},
    {id: 'optimize-animation', description: 'Run multi-load-case SIMP topology optimization finding one shared topology across animation keyframes and changed frames.', inputSchema: {type:'object', properties:{firstFrame:{type:'integer',minimum:0}, lastFrame:{type:'integer',minimum:0}, maxOptIterations:{type:'integer',minimum:1,maximum:60}}, additionalProperties:false}, readOnly: false, run: runOptimizeAnimation},
    {id: 'stop', description: 'Cancel any active Structural job.', inputSchema: emptySchema, readOnly: false, run: hash => { owner(hash); cancelJob(hash); return statusOf(hash); }},
    {id: 'result-object', description: 'Publish the optimized Structural topology as a native polygon mesh object.', inputSchema: emptySchema, readOnly: false, run: runResultToObject},
    {id: 'deformation', description: 'Set transient deformation visualization multiplier without re-solving or mutating authoring.', inputSchema: {type:'object', properties:{scale:{type:'number', minimum:0, maximum:10000}}, required:['scale'], additionalProperties:false}, readOnly: false, run: (hash, {scale}) => { owner(hash); deformations.set(hash, scale); rebuildDisplayBuffer(hash); refresh(); return {deformationScale: scale}; }},
    ...['Safety factor','Stress','Displacement','Voxels','Density'].map(mode => ({
      id: 'map-' + mode.toLowerCase().replace(/\s+/g, '-'),
      description: 'Switch Structural Attributes display map to ' + mode + '.',
      inputSchema: emptySchema, readOnly: false,
      run: hash => {
        owner(hash);
        const st = states.get(hash);
        if (!st?.model) throw failure('NO_RESULT', 'Run Show Voxels, Solve or Optimize first.');
        if (mode === 'Density' && !st.density) throw failure('NO_RESULT', 'Density map requires an Optimize result.');
        if (['Safety factor','Stress','Displacement'].includes(mode) && !st.eval) throw failure('NO_RESULT', 'Solve or Optimize first.');
        st.mode = mode;
        rebuildDisplayBuffer(hash);
        refresh();
        return {mode};
      }
    }))
  ]);

  // ---------- Editor Hooks & Attributes ----------

  function syncLiveOwners() {
    const live = new Set(context.document.nodes.filter(n => n.type === 'structural').map(n => n.nativeHash));
    for (const hash of [...states.keys()]) if (!live.has(hash)) retireOwner(hash);
    for (const hash of live) {
      const st = states.get(hash);
      const busy = st?.job && ['queued','solving','optimizing'].includes(st.job.state);
      if (st?.model && !busy && st.signature) {
        try {
          const curSig = context.scene.signature(hash, CAPTURE_KEYS, {includeTags: true}) + '|' + context.document.world(hash).map(v => Math.round(v*1e6)).join(',');
          if (curSig !== st.signature) {
            st.displayBuf?.destroy(); st.displayBuf = null; st.displayVerts = 0;
            st.model = null; st.u = null; st.eval = null; st.density = null; st.solidMask = null; st.optimized = false;
            updateSurfaceFilter(hash);
          }
        } catch {}
      }
      rebuildForceArrowBuffer(hash);
    }
  }

  context.editor.register({
    documentChanged: () => { syncLiveOwners(); refresh(); },
    frames: () => { for (const hash of states.keys()) rebuildForceArrowBuffer(hash); },
    parameters: (n, changes) => { if (n.type !== 'structural') return null; validateParameters({...n.params, ...changes}); return {}; },
    rowColor: n => n.type === 'structural' && (states.get(n.nativeHash)?.job?.state === 'failed' || states.get(n.nativeHash)?.error) ? '#ee554b' : null,
    surfaceFilter: meshHash => {
      for (const entry of filterCache.values()) {
        if (entry.hashes?.has(meshHash)) return entry;
      }
      return null;
    },
    bounds: hash => {
      const n = context.document.nodes.find(x => x.nativeHash === hash && x.type === 'structural');
      if (!n) return null;
      if (n.params['Auto size']) {
        const st = states.get(hash);
        if (!st?.model) return false;
        const d = st.model.domain, inv = context.math.inv(context.document.world(hash));
        const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
        for (let k = 0; k < 8; k++) {
          const pW = gridPointToWorldMm(d, k&1?d.cells[0]:0, k&2?d.cells[1]:0, k&4?d.cells[2]:0);
          const pL = context.math.point(inv, pW);
          for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pL[a]); max[a] = Math.max(max[a], pL[a]); }
        }
        return {min, max};
      }
      return null;
    }
  });

  context.attributes.register(hash => {
    owner(hash);
    const st = states.get(hash);
    const job = st?.job;
    const busy = job && ['queued','solving','optimizing'].includes(job.state);
    const errText = job?.state === 'failed' ? (job.error?.code === 'UNCONSTRAINED_RIGID_BODY' ? 'Unconstrained' : job.error?.code === 'GRID_CAPACITY' ? 'Grid too dense' : 'Failed') : '';
    const hasModel = !!st?.model, hasEval = !!st?.eval, hasOpt = !!st?.optimized;

    const mapActions = [
      {id: 'map-safety-factor', row: 'Display', label: 'SF',     hidden: !hasEval, active: hasEval && st.mode === 'Safety factor'},
      {id: 'map-stress',        row: 'Display', label: 'Stress', hidden: !hasEval, active: hasEval && st.mode === 'Stress'},
      {id: 'map-displacement',  row: 'Display', label: 'Disp',   hidden: !hasEval, active: hasEval && st.mode === 'Displacement'},
      {id: 'map-voxels',        row: 'Display', label: 'Voxels', hidden: !hasModel, active: hasModel && st.mode === 'Voxels'},
      {id: 'map-density',       row: 'Display', label: 'Density',hidden: !hasOpt,   active: hasOpt && st.mode === 'Density'}
    ];

    return {
      actions: [
        {id: 'show-voxels',        row: 'Grid',     label: 'Show Voxels', cancel: 'stop', busy: busy && job.kind === 'show-voxels', disabled: busy && job.kind !== 'show-voxels', progress: job?.kind === 'show-voxels' ? (busy ? job.progress : errText) : ''},
        {id: 'solve-frame',        row: 'Solve',    label: 'Frame',       cancel: 'stop', busy: busy && job.kind === 'solve-frame', disabled: busy && job.kind !== 'solve-frame', progress: job?.kind === 'solve-frame' ? (busy ? job.progress : errText) : ''},
        {id: 'solve-animation',    row: 'Solve',    label: 'Animation',   cancel: 'stop', busy: busy && job.kind === 'solve-animation', disabled: busy && job.kind !== 'solve-animation', progress: job?.kind === 'solve-animation' ? (busy ? job.progress : errText) : ''},
        {id: 'optimize-frame',     row: 'Optimize', label: 'Frame',       cancel: 'stop', busy: busy && job.kind === 'optimize-frame', disabled: busy && job.kind !== 'optimize-frame', progress: job?.kind === 'optimize-frame' ? (busy ? job.progress : errText) : ''},
        {id: 'optimize-animation', row: 'Optimize', label: 'Animation',   cancel: 'stop', busy: busy && job.kind === 'optimize-animation', disabled: busy && job.kind !== 'optimize-animation', progress: job?.kind === 'optimize-animation' ? (busy ? job.progress : errText) : ''},
        ...mapActions,
        {id: 'result-object', label: 'Result to Object', placement: 'bottom', hidden: !hasOpt, disabled: busy}
      ],
      numbers: [
        {id: 'deformation', label: 'Deformation (×)', visible: hasEval, value: getDeformation(hash), min: 0, max: 10000, set: v => { deformations.set(hash, v); rebuildDisplayBuffer(hash); refresh(); }}
      ],
      readouts: [
        {id: 'safety-factor', label: 'Safety factor', columns: [''], values: hasEval ? [fmtNum(st.eval.safetyFactor)] : null, series: () => readoutSeries(hash, 'safetyFactor', 'Safety factor', '')},
        {id: 'stress',        label: 'Stress (MPa)',  columns: [''], values: hasEval ? [fmtNum(st.eval.maxStressMPa)] : null, series: () => readoutSeries(hash, 'maxStressMPa', 'Max stress', 'MPa')},
        {id: 'displacement',  label: 'Displacement (mm)', columns: [''], values: hasEval ? [fmtNum(st.eval.maxDispMm)] : null, series: () => readoutSeries(hash, 'maxDispMm', 'Max displacement', 'mm')},
        {id: 'mass',          label: 'Mass (g)',      columns: [''], values: hasEval ? [fmtNum(st.eval.massG)] : (hasModel ? [fmtNum(st.model.totalMassKg * 1000)] : null), series: () => readoutSeries(hash, 'massG', 'Mass', 'g')},
        {id: 'grid',          label: 'Grid',          columns: [''], values: hasModel ? [`${st.model.domain.cells.join('×')} (${st.model.elemCount})`] : null}
      ]
    };
  });

  // ---------- Viewport Registration (100mm Box Helper hidden on Auto size + Opaque Shaded Display + Force Arrows) ----------

  const lines = [];
  for (let axis = 0; axis < 3; axis++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    const p = [-50, -50, -50], q = [-50, -50, -50];
    p[(axis+1)%3] = q[(axis+1)%3] = a ? 50 : -50;
    p[(axis+2)%3] = q[(axis+2)%3] = b ? 50 : -50;
    q[axis] = 50;
    lines.push(...p, ...q);
  }

  await context.viewport.register({
    retire: retireOwner,
    renderKind: 'overlay',
    renderStage: 'opaque',
    surfaceWarnings: false,
    surfaceOrder: 'selected-smallest',
    showHelper: (_hash, params) => !params['Auto size'],
    surfaceProbe,
    render: ({pass, camera, orthographic, hash, device, format}) => {
      const pipes = ensureRenderPipelines(device, format);
      if (!pipes) return;
      let st = states.get(hash);
      if (!st || st.arrowBuf === undefined) { rebuildForceArrowBuffer(hash); st = states.get(hash); }
      if (!st || (!st.displayVerts && !st.arrowVerts)) return;
      let camGroup = renderState.camGroups.get(camera);
      if (!camGroup) {
        camGroup = device.createBindGroup({layout: renderState.camLayout, entries: [{binding: 0, resource: {buffer: camera}}]});
        renderState.camGroups.set(camera, camGroup);
      }
      pass.setPipeline(pipes[orthographic ? 1 : 0]);
      pass.setBindGroup(0, camGroup);
      if (st.displayBuf && st.displayVerts > 0) {
        pass.setVertexBuffer(0, st.displayBuf);
        pass.draw(st.displayVerts);
      }
      if (st.arrowBuf && st.arrowVerts > 0) {
        pass.setVertexBuffer(0, st.arrowBuf);
        pass.draw(st.arrowVerts);
      }
    },
    bounds: {min: [-50, -50, -50], max: [50, 50, 50]},
    lines: new Float32Array(lines),
    color: [0.875, 0.667, 0.408, 1],
    selectedColor: [1, 0.8, 0.55, 1],
    settings: () => [0, 0, 0, 0],
    shader: 'fn pluginSurface(local:vec3f, normal:vec3f, build:vec3f, settings:vec4f)->vec4f { discard; return vec4f(0.0); }'
  });
}
