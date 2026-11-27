// Flat 2D cutting and marking CAM plugin for Frame.
// Best-effort planner: preserves user spline approximation, always outputs CW closed paths
// (head side -Y), uses shared FrameGeometryKernel Outline for kerf compensation, clips/routes
// around Avoid and No-cut regions, optimizes route order and entry points, and emits G0/G1 G-code.

export const STORAGE_KEY = 'frame.cut.settings';
export const BLOCKS = Object.freeze(['Start G-code', 'Finish G-code', 'Tool on G-code', 'Tool off G-code']);
export const DEFAULTS = Object.freeze({
  Mode: 'Cut',
  Speed: 1000,
  Passes: 1,
  'Line width': 0.2,
  'Lead-in': 1,
  ...Object.fromEntries(BLOCKS.map(k => [k, '']))
});

export const failure = (code, message) => Object.assign(new Error(message), { code });

export function validate(params) {
  if (!['Cut', 'Mark'].includes(params.Mode)) throw failure('INVALID_ARGUMENT', 'Invalid Cut mode.');
  if (!Number.isFinite(params.Speed) || params.Speed < 0.001) throw failure('INVALID_ARGUMENT', 'Speed must be at least 0.001 mm/min.');
  if (!Number.isSafeInteger(params.Passes) || params.Passes < 1) throw failure('INVALID_ARGUMENT', 'Passes must be a positive safe integer.');
  for (const k of ['Line width', 'Lead-in']) {
    if (!Number.isFinite(params[k]) || params[k] < 0) throw failure('INVALID_ARGUMENT', k + ' must be nonnegative.');
  }
  for (const k of BLOCKS) {
    if (typeof params[k] !== 'string' || params[k].length > 16384 || !params[k].isWellFormed()) {
      throw failure('INVALID_ARGUMENT', k + ' must be valid Unicode text of at most 16384 code units.');
    }
  }
  return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, params[k]]));
}

export function loadSettings(storage, codec) {
  try {
    const record = codec.fromStorage(storage.getItem(STORAGE_KEY));
    if (record?.version === 1) return { params: validate({ ...DEFAULTS, ...record.params }), source: 'local', storageAvailable: true };
  } catch {}
  return { params: { ...DEFAULTS }, source: 'factory', storageAvailable: !!storage };
}

export function settingsObserver(context, storage) {
  let last = loadSettings(storage, context.hash.values);
  let seen = new Map();
  let references = new Map();
  let queued = false;

  function observe(exclude = null) {
    const owners = context.document.nodes.filter(n => n.type === 'cut' && n !== exclude);
    const next = new Map();
    const changed = [];
    const restored = owners.some(n => references.has(n.nativeHash) && references.get(n.nativeHash) !== n);
    for (const n of owners) {
      try {
        const p = validate(n.params);
        const key = context.hash.values.key(p);
        next.set(n.nativeHash, key);
        if (restored || seen.get(n.nativeHash) !== key) changed.push({ n, p });
      } catch {}
    }
    seen = next;
    references = new Map(owners.map(n => [n.nativeHash, n]));
    if (!changed.length) return;
    const selected = context.document.selected.filter(n => n.type === 'cut');
    const chosen = (changed.length > 1 && selected.length === 1 ? changed.find(x => x.n === selected[0]) : null) || changed.at(-1);
    last = { params: chosen.p, source: 'native', owner: chosen.n.nativeHash, storageAvailable: !!storage };
    try {
      storage?.setItem(STORAGE_KEY, context.hash.values.storage({ version: 1, params: last.params }));
    } catch {
      last.storageAvailable = false;
    }
  }

  return {
    observe,
    schedule() {
      if (!queued) {
        queued = true;
        queueMicrotask(() => { queued = false; observe(); });
      }
    },
    created(n) {
      if (n.type === 'cut') {
        observe(n);
        Object.assign(n.params, last.params);
      }
    },
    status() {
      return { ...last, params: { ...last.params } };
    }
  };
}

// ============================================================================
// Pure 2D / 3D Geometric Utilities
// ============================================================================

const EPS = 1e-6;
const DIST2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const DIST = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DOT3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const CROSS3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const NORM3 = a => Math.hypot(a[0], a[1], a[2]);
const UNIT3 = a => { const l = NORM3(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const ORIENT2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

export function signedArea2D(pts) {
  if (!pts || pts.length < 3) return 0;
  const x0 = pts[0][0], y0 = pts[0][1];
  let sum = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    sum += (pts[i][0] - x0) * (pts[i + 1][1] - y0) - (pts[i][1] - y0) * (pts[i + 1][0] - x0);
  }
  return sum * 0.5;
}

export function cleanPolyline(pts, closed, tol = 1e-6) {
  const out = [];
  for (const p of pts) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (!out.length || DIST(out.at(-1), p) > tol) out.push([p[0], p[1]]);
  }
  if (closed && out.length > 1 && DIST(out[0], out.at(-1)) <= tol) out.pop();
  return out;
}

// In Cut physical (X right, Z up) viewed from head side (-Y), CW has signedArea < 0.
export function ensureCW(pts) {
  const clean = cleanPolyline(pts, true);
  if (clean.length < 3) return clean;
  if (signedArea2D(clean) > 0) clean.reverse();
  return clean;
}

export function polylineLength(pts, closed = false) {
  if (!pts || pts.length < 2) return 0;
  let len = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) len += DIST(pts[i], pts[(i + 1) % pts.length]);
  return len;
}

export function bounds2D(pts) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minZ) minZ = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxZ) maxZ = p[1];
  }
  return { minX, minZ, maxX, maxZ };
}

export function pointSegmentDistance2D(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const d2 = dx * dx + dy * dy;
  if (d2 <= 1e-24) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointInRing2D(p, ring, tol = EPS) {
  let inside = false;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    if (pointSegmentDistance2D(p, a, b) <= tol) return 0; // on boundary
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside ? 1 : -1;
}

export function pointInRegion2D(p, region, tol = EPS) {
  if (region.bounds) {
    if (p[0] < region.bounds.minX - tol || p[0] > region.bounds.maxX + tol ||
        p[1] < region.bounds.minZ - tol || p[1] > region.bounds.maxZ + tol) return -1;
  }
  const o = pointInRing2D(p, region.outer, tol);
  if (o !== 1) return o;
  for (const h of region.holes || []) {
    const hl = pointInRing2D(p, h, tol);
    if (hl === 0) return 0;
    if (hl === 1) return -1;
  }
  return 1;
}

function segmentsIntersectParam(a, b, c, d, tol = 1e-11) {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  const qpx = c[0] - a[0], qpy = c[1] - a[1];
  if (Math.abs(denom) <= tol) return null;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
    return Math.max(0, Math.min(1, t));
  }
  return null;
}

function segmentSegmentDistance2D(a, b, c, d) {
  if (segmentsIntersectParam(a, b, c, d) !== null) return 0;
  return Math.min(
    pointSegmentDistance2D(a, c, d),
    pointSegmentDistance2D(b, c, d),
    pointSegmentDistance2D(c, a, b),
    pointSegmentDistance2D(d, a, b)
  );
}

export function segmentDistanceToRegion2D(a, b, region, pad = 0) {
  if (region.bounds) {
    const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
    const minZ = Math.min(a[1], b[1]), maxZ = Math.max(a[1], b[1]);
    if (maxX + pad < region.bounds.minX || minX - pad > region.bounds.maxX ||
        maxZ + pad < region.bounds.minZ || minZ - pad > region.bounds.maxZ) {
      return Infinity;
    }
  }
  if (pointInRegion2D(a, region, EPS) >= 0 || pointInRegion2D(b, region, EPS) >= 0) return 0;
  let best = Infinity;
  const rings = [region.outer, ...(region.holes || [])];
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const d = segmentSegmentDistance2D(a, b, ring[i], ring[(i + 1) % n]);
      if (d < best) {
        best = d;
        if (best <= 0) return 0;
      }
    }
  }
  return best;
}

// Analytical 1D interval [t0, t1] where P(t) = a + t*(b - a) lies within radius r of disk(q) or strip(c, d).
function addDiskInterval(a, dx, dy, q, r, out) {
  const wx = a[0] - q[0], wy = a[1] - q[1];
  const aa = dx * dx + dy * dy;
  const rr = r * r;
  if (aa <= 1e-24) {
    if (wx * wx + wy * wy <= rr) out.push([0, 1]);
    return;
  }
  const bb = wx * dx + wy * dy;
  const cc = wx * wx + wy * wy - rr;
  const disc = bb * bb - aa * cc;
  if (disc < 0) return;
  const sq = Math.sqrt(Math.max(0, disc));
  const t0 = Math.max(0, (-bb - sq) / aa);
  const t1 = Math.min(1, (-bb + sq) / aa);
  if (t1 >= t0) out.push([t0, t1]);
}

function addLinearSlabIntersection(v0, v1, lo, hi, range) {
  if (Math.abs(v1) <= 1e-18) {
    return v0 >= lo && v0 <= hi ? range : null;
  }
  let t0 = (lo - v0) / v1;
  let t1 = (hi - v0) / v1;
  if (t0 > t1) [t0, t1] = [t1, t0];
  const a = Math.max(range[0], t0), b = Math.min(range[1], t1);
  return b >= a ? [a, b] : null;
}

function addEdgeCapsuleIntervals(a, dx, dy, c, d, r, out) {
  addDiskInterval(a, dx, dy, c, r, out);
  addDiskInterval(a, dx, dy, d, r, out);
  const fx = d[0] - c[0], fy = d[1] - c[1];
  const len = Math.hypot(fx, fy);
  if (len <= 1e-12) return;
  const ux = fx / len, uy = fy / len;
  const nx = -uy, ny = ux;
  const ax = a[0] - c[0], ay = a[1] - c[1];
  let rng = [0, 1];
  rng = addLinearSlabIntersection(ax * nx + ay * ny, dx * nx + dy * ny, -r, r, rng);
  if (!rng) return;
  rng = addLinearSlabIntersection(ax * ux + ay * uy, dx * ux + dy * uy, 0, len, rng);
  if (rng) out.push(rng);
}

function mergeIntervals(intervals, eps = 1e-7) {
  if (!intervals.length) return [];
  const sorted = intervals
    .map(([a, b]) => [Math.max(0, a), Math.min(1, b)])
    .filter(([a, b]) => b >= a)
    .sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const out = [];
  for (const iv of sorted) {
    if (!out.length || iv[0] > out.at(-1)[1] + eps) out.push([iv[0], iv[1]]);
    else if (iv[1] > out.at(-1)[1]) out.at(-1)[1] = iv[1];
  }
  return out;
}

// Clip a single segment [a, b] to stay inside work rect [0,W]x[0,H] AND strictly outside
// every exclusion region (with each region's clearance radius).
export function clipSegmentToAllowed(a, b, areaW, areaH, exclusions) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const segLen = Math.hypot(dx, dy);
  if (segLen <= 1e-9) return [];

  // 1. Clip to work area [0, areaW] x [0, areaH]
  let rect = [0, 1];
  rect = addLinearSlabIntersection(a[0], dx, 0, areaW, rect);
  if (!rect) return [];
  rect = addLinearSlabIntersection(a[1], dy, 0, areaH, rect);
  if (!rect || rect[1] - rect[0] <= 1e-9) return [];

  const forbidden = [];
  if (rect[0] > 0) forbidden.push([0, rect[0]]);
  if (rect[1] < 1) forbidden.push([rect[1], 1]);

  const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
  const minZ = Math.min(a[1], b[1]), maxZ = Math.max(a[1], b[1]);

  // 2. Subtract each exclusion region (interior + clearance capsule)
  for (const ex of exclusions) {
    const r = ex.radius || 0;
    const reg = ex.region;
    const pad = r + 1e-4;
    if (reg.bounds && (maxX + pad < reg.bounds.minX || minX - pad > reg.bounds.maxX ||
        maxZ + pad < reg.bounds.minZ || minZ - pad > reg.bounds.maxZ)) {
      continue;
    }
    const rings = [reg.outer, ...(reg.holes || [])];
    const ts = [0, 1];
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const c = ring[i], d = ring[(i + 1) % n];
        const t = segmentsIntersectParam(a, b, c, d);
        if (t !== null) ts.push(t);
        if (r > 0) addEdgeCapsuleIntervals(a, dx, dy, c, d, r + 1e-5, forbidden);
      }
    }
    ts.sort((u, v) => u - v);
    for (let i = 0; i + 1 < ts.length; i++) {
      if (ts[i + 1] - ts[i] <= 1e-10) continue;
      const tm = 0.5 * (ts[i] + ts[i + 1]);
      const mid = [a[0] + tm * dx, a[1] + tm * dy];
      if (pointInRegion2D(mid, reg, 1e-6) >= 0) forbidden.push([ts[i], ts[i + 1]]);
    }
  }

  const blocked = mergeIntervals(forbidden, 1e-7);
  const allowed = [];
  let cur = 0;
  for (const [b0, b1] of blocked) {
    if (b0 > cur + 1e-7) allowed.push([cur, b0]);
    if (b1 > cur) cur = b1;
  }
  if (1 > cur + 1e-7) allowed.push([cur, 1]);
  return allowed.filter(([t0, t1]) => (t1 - t0) * segLen > 1e-5);
}

// Clips a closed or open polyline against work rect and exclusions.
// Returns { intact: boolean, chains: Array<{ points, closed }>, clipped: boolean }.
export function clipPolylineToAllowed(pts, closed, areaW, areaH, exclusions) {
  const nSeg = closed ? pts.length : pts.length - 1;
  if (nSeg < 1) return { intact: false, chains: [], clipped: false };

  let anyClipped = false;
  const chains = [];
  let active = null;

  for (let i = 0; i < nSeg; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ivs = clipSegmentToAllowed(a, b, areaW, areaH, exclusions);
    if (ivs.length !== 1 || ivs[0][0] > 1e-6 || ivs[0][1] < 1 - 1e-6) anyClipped = true;
    for (const [t0, t1] of ivs) {
      const p0 = t0 <= 1e-9 ? [a[0], a[1]] : [a[0] + t0 * (b[0] - a[0]), a[1] + t0 * (b[1] - a[1])];
      const p1 = t1 >= 1 - 1e-9 ? [b[0], b[1]] : [a[0] + t1 * (b[0] - a[0]), a[1] + t1 * (b[1] - a[1])];
      if (active && DIST(active.at(-1), p0) <= 1e-4) {
        if (DIST(active.at(-1), p1) > 1e-6) active.push(p1);
      } else {
        active = [p0, p1];
        chains.push(active);
      }
      if (t1 < 1 - 1e-6) active = null;
    }
    if (!ivs.length) active = null;
  }

  if (!anyClipped && closed) {
    return { intact: true, chains: [{ points: pts.map(p => [p[0], p[1]]), closed: true }], clipped: false };
  }

  // Merge wrap-around piece if a clipped closed loop has surviving start and end meeting at vertex 0.
  if (closed && chains.length > 1 && DIST(chains.at(-1).at(-1), chains[0][0]) <= 1e-4) {
    const tail = chains.pop();
    chains[0] = tail.concat(chains[0].slice(1));
  }

  const finalChains = chains
    .map(c => cleanPolyline(c, false, 1e-5))
    .filter(c => c.length >= 2 && polylineLength(c, false) > 1e-4)
    .map(points => ({ points, closed: false }));

  return { intact: !anyClipped, chains: finalChains, clipped: anyClipped };
}

// ============================================================================
// Work Frame Extraction (Physical mm on Local XZ [0,1000]x[0,1000])
// ============================================================================

export function extractWorkFrame(worldMatrix) {
  const m = Array.from(worldMatrix || []);
  if (m.length !== 16 || !m.every(Number.isFinite)) {
    return { valid: false, code: 'DEGENERATE_FRAME', message: 'Cut transform is invalid.' };
  }
  const origin = [m[12], m[13], m[14]];
  const cx = [m[0], m[1], m[2]];
  const cy = [m[4], m[5], m[6]];
  const cz = [m[8], m[9], m[10]];
  const sx = NORM3(cx), sy = NORM3(cy), sz = NORM3(cz);
  if (!(sx > 1e-9 && sz > 1e-9)) {
    return { valid: false, code: 'DEGENERATE_FRAME', message: 'Cut work area has zero X or Z size.' };
  }
  const ux = [cx[0] / sx, cx[1] / sx, cx[2] / sx];
  const rawUz = [cz[0] / sz, cz[1] / sz, cz[2] / sz];
  const shear = Math.abs(DOT3(ux, rawUz));
  const warnings = [];
  let uz = rawUz;
  if (shear > 1e-4) {
    warnings.push({ code: 'SHEARED_FRAME', message: 'Cut frame is sheared; orthogonalized physical axes used.' });
    const proj = DOT3(rawUz, ux);
    const ortho = [rawUz[0] - proj * ux[0], rawUz[1] - proj * ux[1], rawUz[2] - proj * ux[2]];
    const ol = NORM3(ortho);
    if (ol <= 1e-9) return { valid: false, code: 'DEGENERATE_FRAME', message: 'Cut X and Z axes are collinear.' };
    uz = [ortho[0] / ol, ortho[1] / ol, ortho[2] / ol];
  }
  // Head normal = ux x uz (for identity frame, +X x +Z = -Y, head side -Y).
  const headNormal = UNIT3(CROSS3(ux, uz));
  const areaW = 1000 * sx;
  const areaH = 1000 * sz;

  const worldToCut3 = p => {
    const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
    return [
      dx * ux[0] + dy * ux[1] + dz * ux[2],
      dx * headNormal[0] + dy * headNormal[1] + dz * headNormal[2],
      dx * uz[0] + dy * uz[1] + dz * uz[2]
    ];
  };
  const vecWorldToCut3 = v => [
    v[0] * ux[0] + v[1] * ux[1] + v[2] * ux[2],
    v[0] * headNormal[0] + v[1] * headNormal[1] + v[2] * headNormal[2],
    v[0] * uz[0] + v[1] * uz[1] + v[2] * uz[2]
  ];
  const cut2ToLocal = p => [p[0] / sx, 0, p[1] / sz];

  return {
    valid: true,
    origin, ux, uz, headNormal,
    sx, sy, sz,
    areaW, areaH,
    sheared: shear > 1e-4,
    warnings,
    worldToCut3,
    vecWorldToCut3,
    cut2ToLocal
  };
}

// ============================================================================
// 2D Footprint Extraction from 3D Mesh (for Avoid / No-cut 3D objects)
// ============================================================================

function convexHull2D(pts) {
  if (pts.length <= 3) return cleanPolyline(pts, true, 1e-5);
  const sorted = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && ORIENT2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && ORIENT2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return cleanPolyline(lower.concat(upper), true, 1e-5);
}

function simplifyRDP(pts, tol) {
  if (pts.length <= 3) return pts;
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i + 1 < pts.length; i++) {
    const d = pointSegmentDistance2D(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const left = simplifyRDP(pts.slice(0, idx + 1), tol);
    const right = simplifyRDP(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function simplifyClosedRing(ring, maxVerts = 96, tol = 0.05) {
  if (ring.length <= maxVerts) return ring;
  let best = ring;
  let eps = tol;
  for (let iter = 0; iter < 5 && best.length > maxVerts; iter++) {
    // Split ring at farthest vertex from ring[0]
    let far = 1, maxD = -1;
    for (let i = 1; i < best.length; i++) {
      const d = DIST2(best[0], best[i]);
      if (d > maxD) { maxD = d; far = i; }
    }
    const a = simplifyRDP(best.slice(0, far + 1), eps);
    const b = simplifyRDP(best.slice(far).concat([best[0]]), eps);
    const merged = cleanPolyline(a.slice(0, -1).concat(b.slice(0, -1)), true, 1e-5);
    if (merged.length >= 3) best = merged;
    eps *= 2.5;
  }
  return best;
}

function traceDirectedEdgesToLoops(edgeMap, verts2) {
  const outAdj = new Map();
  for (const [key, count] of edgeMap) {
    if (count <= 0) continue;
    const sep = key.indexOf('>');
    const u = +key.slice(0, sep), v = +key.slice(sep + 1);
    let list = outAdj.get(u);
    if (!list) outAdj.set(u, list = []);
    for (let k = 0; k < count; k++) list.push(v);
  }
  const loops = [];
  for (const [startU, list] of outAdj) {
    while (list.length) {
      const firstV = list.pop();
      const chain = [startU, firstV];
      let cur = firstV;
      let guard = 0;
      while (cur !== startU && guard++ < 100000) {
        const nextList = outAdj.get(cur);
        if (!nextList || !nextList.length) break;
        const nextV = nextList.pop();
        chain.push(nextV);
        cur = nextV;
      }
      if (cur === startU && chain.length >= 4) {
        chain.pop();
        const pts = cleanPolyline(chain.map(idx => verts2[idx]), true, 1e-5);
        if (pts.length >= 3 && Math.abs(signedArea2D(pts)) > 1e-6) loops.push(pts);
      }
    }
  }
  return loops;
}

function classifyLoopsToRegions(loops, kind, idPrefix, sourceHash) {
  const valid = loops
    .map(r => cleanPolyline(r, true, 1e-5))
    .filter(r => r.length >= 3 && Math.abs(signedArea2D(r)) > 1e-6)
    .map(r => ({ ring: r, absArea: Math.abs(signedArea2D(r)), bounds: bounds2D(r) }))
    .sort((a, b) => b.absArea - a.absArea);

  const depth = new Int32Array(valid.length);
  const parent = new Int32Array(valid.length).fill(-1);
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i].ring[0];
    for (let j = i - 1; j >= 0; j--) {
      if (p[0] < valid[j].bounds.minX - EPS || p[0] > valid[j].bounds.maxX + EPS ||
          p[1] < valid[j].bounds.minZ - EPS || p[1] > valid[j].bounds.maxZ + EPS) continue;
      if (pointInRing2D(p, valid[j].ring, EPS) === 1) {
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  }

  const regions = [];
  const byOuter = new Map();
  for (let i = 0; i < valid.length; i++) {
    if (depth[i] % 2 === 0) {
      const reg = {
        id: `${idPrefix}:${regions.length}`,
        kind,
        sourceHash,
        outer: valid[i].ring,
        holes: [],
        bounds: valid[i].bounds
      };
      byOuter.set(i, reg);
      regions.push(reg);
    }
  }
  for (let i = 0; i < valid.length; i++) {
    if (depth[i] % 2 === 1) {
      const reg = byOuter.get(parent[i]);
      if (reg) reg.holes.push(valid[i].ring);
    }
  }
  return regions;
}

export function extractMeshFootprint2D(vertices, indices, worldMatrix, workFrame, kind, sourceHash, arrangement = null) {
  const vCount = vertices.length / 3;
  const tCount = indices.length / 3;
  if (vCount < 3 || tCount < 1) return [];

  const m = worldMatrix;
  const pts2 = new Array(vCount);
  const ys = new Float64Array(vCount);
  const qMap = new Map();
  const welded = new Int32Array(vCount);
  const weldedPts = [];

  for (let i = 0; i < vCount; i++) {
    const vx = vertices[i * 3], vy = vertices[i * 3 + 1], vz = vertices[i * 3 + 2];
    const wx = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
    const wy = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
    const wz = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
    const c3 = workFrame.worldToCut3([wx, wy, wz]);
    const p2 = [c3[0], c3[2]];
    pts2[i] = p2;
    ys[i] = c3[1];
    // Spatial weld in 2D to merge seam/hard-normal duplicate vertices
    const qk = Math.round(p2[0] * 1e4) + ',' + Math.round(p2[1] * 1e4);
    let wi = qMap.get(qk);
    if (wi === undefined) {
      wi = weldedPts.length;
      weldedPts.push(p2);
      qMap.set(qk, wi);
    }
    welded[i] = wi;
  }

  // Filter triangles: for No-cut prefer triangles touching/crossing Y=0; fallback to all if elevated.
  const useTris = [];
  if (kind === 'No-cut') {
    for (let t = 0; t < tCount; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      const yMin = Math.min(ys[a], ys[b], ys[c]);
      const yMax = Math.max(ys[a], ys[b], ys[c]);
      if (yMin <= 0.05 && yMax >= -0.05) useTris.push(t);
    }
  }
  const triList = useTris.length ? useTris : Array.from({ length: tCount }, (_, i) => i);

  // Separate positive-area vs negative-area projected triangles (for closed solids, one side gives exact silhouette)
  let posArea = 0, negArea = 0;
  const posTris = [], negTris = [];
  for (const t of triList) {
    const a = welded[indices[t * 3]], b = welded[indices[t * 3 + 1]], c = welded[indices[t * 3 + 2]];
    if (a === b || b === c || c === a) continue;
    const ar = ORIENT2(weldedPts[a], weldedPts[b], weldedPts[c]) * 0.5;
    if (ar > 1e-8) { posArea += ar; posTris.push([a, b, c]); }
    else if (ar < -1e-8) { negArea += -ar; negTris.push([a, c, b]); }
  }

  const chosen = posArea >= negArea ? posTris : negTris;
  if (!chosen.length) return [];

  // Cancel shared opposite half-edges -> exact 2D silhouette boundary for convex/prism/extrude/cylinder/tube!
  const edgeMap = new Map();
  const addHalf = (u, v) => {
    const rev = v + '>' + u;
    const rc = edgeMap.get(rev) || 0;
    if (rc > 0) {
      if (rc === 1) edgeMap.delete(rev);
      else edgeMap.set(rev, rc - 1);
    } else {
      const fwd = u + '>' + v;
      edgeMap.set(fwd, (edgeMap.get(fwd) || 0) + 1);
    }
  };
  for (const [a, b, c] of chosen) {
    addHalf(a, b);
    addHalf(b, c);
    addHalf(c, a);
  }

  let loops = traceDirectedEdgesToLoops(edgeMap, weldedPts);
  const totalVerts = loops.reduce((s, l) => s + l.length, 0);

  // If multiple potentially overlapping silhouette loops (e.g. non-convex 3D overhang), unite with shared FrameOutline.arrangement
  if (loops.length > 1 && arrangement && totalVerts <= 512) {
    try {
      const arranged = arrangement(loops.map(p => ({ p, traces: [] })), 'positive', {});
      if (arranged?.length) {
        const cleaned = arranged.map(l => cleanPolyline(l.p, true, 1e-5)).filter(r => r.length >= 3 && Math.abs(signedArea2D(r)) > 1e-6);
        if (cleaned.length) loops = cleaned;
      }
    } catch {}
  }

  if (!loops.length || totalVerts > 1024) {
    const hull = convexHull2D(weldedPts);
    loops = hull.length >= 3 ? [hull] : [];
  }

  return classifyLoopsToRegions(loops, kind, `${kind}:${sourceHash}`, sourceHash);
}

// ============================================================================
// Avoid Visibility Graph & Shortest Safe Detour Routing
// ============================================================================

function buildAvoidRouter(avoidRegions, areaW, areaH) {
  if (!avoidRegions.length) {
    return {
      route(from, to) { return { points: [from, to], length: DIST(from, to), safe: true }; },
      distance(from, to) { return DIST(from, to); }
    };
  }

  const clearance = 0.05; // keep travel strictly outside Avoid
  const padOut = 0.25;

  const isPointClear = p => {
    if (p[0] < -1e-6 || p[0] > areaW + 1e-6 || p[1] < -1e-6 || p[1] > areaH + 1e-6) return false;
    for (const reg of avoidRegions) {
      if (pointInRegion2D(p, reg, clearance * 0.5) >= 0) return false;
    }
    return true;
  };

  const isSegmentClear = (a, b) => {
    for (const reg of avoidRegions) {
      if (segmentDistanceToRegion2D(a, b, reg, clearance) <= clearance) return false;
    }
    return true;
  };

  // Extract outward-nudged waypoints around each Avoid polygon
  const waypoints = [];
  for (const reg of avoidRegions) {
    const rings = [
      { pts: simplifyClosedRing(reg.outer, 48, 0.1), isHole: false },
      ...(reg.holes || []).map(h => ({ pts: simplifyClosedRing(h, 32, 0.1), isHole: true }))
    ];
    for (const { pts, isHole } of rings) {
      // Orient outer CCW (area > 0) so outward is RIGHT of edge; hole CW (area < 0) so inward-to-hole is RIGHT
      const r = pts.slice();
      const sa = signedArea2D(r);
      if ((!isHole && sa < 0) || (isHole && sa > 0)) r.reverse();
      const n = r.length;
      for (let i = 0; i < n; i++) {
        const prev = r[(i - 1 + n) % n], cur = r[i], next = r[(i + 1) % n];
        const e1x = cur[0] - prev[0], e1y = cur[1] - prev[1];
        const e2x = next[0] - cur[0], e2y = next[1] - cur[1];
        const l1 = Math.hypot(e1x, e1y), l2 = Math.hypot(e2x, e2y);
        if (l1 <= 1e-7 || l2 <= 1e-7) continue;
        // Convex corner of CCW ring has cross(e1, e2) > 0
        const turn = (e1x * e2y - e1y * e2x) / (l1 * l2);
        if (turn < -1e-4) continue; // reflex corner isn't needed for shortest path outside
        // Right normals (outward for CCW outer)
        const n1x = e1y / l1, n1y = -e1x / l1;
        const n2x = e2y / l2, n2y = -e2x / l2;
        let bx = n1x + n2x, by = n1y + n2y;
        const bl = Math.hypot(bx, by);
        if (bl <= 1e-9) { bx = n1x; by = n1y; } else { bx /= bl; by /= bl; }
        const step = Math.min(padOut, 0.25 * Math.min(l1, l2));
        const wp = [
          Math.max(0.01, Math.min(areaW - 0.01, cur[0] + bx * Math.max(clearance * 2.2, step))),
          Math.max(0.01, Math.min(areaH - 0.01, cur[1] + by * Math.max(clearance * 2.2, step)))
        ];
        if (isPointClear(wp)) waypoints.push(wp);
      }
    }
  }

  // Cap waypoints for guaranteed interactive latency
  const capped = waypoints.length > 160 ? waypoints.filter((_, i) => i % Math.ceil(waypoints.length / 160) === 0) : waypoints;
  const W = capped.length;
  const adj = Array.from({ length: W }, () => []);
  for (let i = 0; i < W; i++) {
    for (let j = i + 1; j < W; j++) {
      if (isSegmentClear(capped[i], capped[j])) {
        const d = DIST(capped[i], capped[j]);
        adj[i].push([j, d]);
        adj[j].push([i, d]);
      }
    }
  }

  const distCache = new Map();

  function route(from, to) {
    const direct = DIST(from, to);
    if (direct <= 1e-6) return { points: [from, to], length: direct, safe: true };
    if (isSegmentClear(from, to)) return { points: [from, to], length: direct, safe: true };
    if (!W) return { points: [from, to], length: direct, safe: false };

    // A* on {start = W, goal = W + 1, 0..W-1 = waypoints}
    const START = W, GOAL = W + 1, N = W + 2;
    const gScore = new Float64Array(N).fill(Infinity);
    const fScore = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);

    const startAdj = [];
    const goalVis = new Uint8Array(W);
    for (let i = 0; i < W; i++) {
      if (isSegmentClear(from, capped[i])) startAdj.push([i, DIST(from, capped[i])]);
      if (isSegmentClear(capped[i], to)) goalVis[i] = 1;
    }

    gScore[START] = 0;
    fScore[START] = direct;
    const open = [START];

    while (open.length) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
      }
      const u = open[bestIdx];
      open[bestIdx] = open[open.length - 1];
      open.pop();

      if (u === GOAL) {
        const path = [];
        for (let cur = GOAL; cur !== -1; cur = prev[cur]) {
          path.push(cur === START ? from : cur === GOAL ? to : capped[cur]);
        }
        path.reverse();
        return { points: path, length: gScore[GOAL], safe: true };
      }
      if (closed[u]) continue;
      closed[u] = 1;

      const neighbors = u === START ? startAdj : adj[u];
      for (const [v, cost] of neighbors) {
        if (closed[v]) continue;
        const ng = gScore[u] + cost;
        if (ng < gScore[v]) {
          gScore[v] = ng;
          fScore[v] = ng + DIST(capped[v], to);
          prev[v] = u;
          open.push(v);
        }
      }
      if (u < W && goalVis[u]) {
        const ng = gScore[u] + DIST(capped[u], to);
        if (ng < gScore[GOAL]) {
          gScore[GOAL] = ng;
          fScore[GOAL] = ng;
          prev[GOAL] = u;
          open.push(GOAL);
        }
      }
    }

    // Best-effort fallback if Avoid walls off the entire bed
    return { points: [from, to], length: direct * 4, safe: false };
  }

  function distance(from, to) {
    const key = `${Math.round(from[0] * 10)},${Math.round(from[1] * 10)}>${Math.round(to[0] * 10)},${Math.round(to[1] * 10)}`;
    let d = distCache.get(key);
    if (d === undefined) {
      d = route(from, to).length;
      if (distCache.size < 20000) distCache.set(key, d);
    }
    return d;
  }

  return { route, distance, isSegmentClear };
}

// ============================================================================
// Lead-in Candidate Scoring & Best-Effort Generation (Closed Cut Loops)
// ============================================================================

// Rotate a closed CW loop so that it starts and ends at entryPoint (on edge index edgeIdx).
function rotateLoopToEntry(pts, edgeIdx, t) {
  const n = pts.length;
  const a = pts[edgeIdx], b = pts[(edgeIdx + 1) % n];
  const entry = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const out = [entry];
  if (t < 1 - 1e-7) {
    for (let k = 1; k <= n; k++) {
      const p = pts[(edgeIdx + k) % n];
      if (DIST(out.at(-1), p) > 1e-6) out.push([p[0], p[1]]);
    }
  } else {
    for (let k = 2; k <= n + 1; k++) {
      const p = pts[(edgeIdx + k) % n];
      if (DIST(out.at(-1), p) > 1e-6) out.push([p[0], p[1]]);
    }
  }
  if (DIST(out.at(-1), entry) > 1e-6) out.push([entry[0], entry[1]]);
  return out;
}

function buildLeadInGeometry(entry, tangent, wasteNormal, leadDist, style) {
  if (leadDist <= 1e-6 || style === 'none') return null;
  if (style === 'arc90') {
    // Quarter circle tangent to contour at entry; start-to-entry chord = leadDist -> R = leadDist / sqrt(2)
    const R = leadDist / Math.SQRT2;
    const cx = entry[0] + R * wasteNormal[0];
    const cz = entry[1] + R * wasteNormal[1];
    const steps = 6;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const ang = (i / steps) * (Math.PI * 0.5);
      // At ang=0: start = C - R*T; at ang=pi/2: end = C - R*Nw = entry
      const c = Math.cos(ang), s = Math.sin(ang);
      pts.push([
        cx - R * (c * tangent[0] + s * wasteNormal[0]),
        cz - R * (c * tangent[1] + s * wasteNormal[1])
      ]);
    }
    pts[steps] = [entry[0], entry[1]];
    return pts;
  }
  if (style === 'arc45') {
    const theta = Math.PI * 0.25;
    const R = leadDist / (2 * Math.sin(theta * 0.5));
    const cx = entry[0] + R * wasteNormal[0];
    const cz = entry[1] + R * wasteNormal[1];
    const steps = 4;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = theta * (1 - i / steps);
      pts.push([
        cx - R * (Math.sin(a) * tangent[0] + Math.cos(a) * wasteNormal[0]),
        cz - R * (Math.sin(a) * tangent[1] + Math.cos(a) * wasteNormal[1])
      ]);
    }
    pts[steps] = [entry[0], entry[1]];
    return pts;
  }
  if (style === 'diag45') {
    const s = leadDist / Math.SQRT2;
    return [
      [entry[0] + s * (wasteNormal[0] - tangent[0]), entry[1] + s * (wasteNormal[1] - tangent[1])],
      [entry[0], entry[1]]
    ];
  }
  // perpendicular straight
  return [
    [entry[0] + leadDist * wasteNormal[0], entry[1] + leadDist * wasteNormal[1]],
    [entry[0], entry[1]]
  ];
}

function evaluateLeadInClearance(leadPts, loopItem, allKeptRegions, exclusions, areaW, areaH, halfWidth) {
  if (!leadPts || leadPts.length < 2) return { safe: false, score: -1e6 };
  // Check bounds
  for (const p of leadPts) {
    if (p[0] < -1e-6 || p[0] > areaW + 1e-6 || p[1] < -1e-6 || p[1] > areaH + 1e-6) {
      return { safe: false, score: -1000 };
    }
  }
  // Check exclusions (Avoid + No-cut with halfWidth)
  for (let i = 0; i + 1 < leadPts.length; i++) {
    for (const ex of exclusions) {
      const d = segmentDistanceToRegion2D(leadPts[i], leadPts[i + 1], ex.region, ex.radius + 1e-4);
      if (d <= ex.radius + 1e-4) return { safe: false, score: -500 + d };
    }
  }
  // Check that lead-in stays strictly on waste side (does not enter kept part interior!)
  // Test start and midpoints (skip final endpoint which touches contour)
  const testPts = [leadPts[0]];
  for (let i = 0; i + 1 < leadPts.length; i++) {
    const a = leadPts[i], b = leadPts[i + 1];
    testPts.push([0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]);
  }
  // Must not cross own contour except at the final entry point
  const selfRing = loopItem.points;
  for (let i = 0; i + 1 < leadPts.length; i++) {
    const a = leadPts[i], b = leadPts[i + 1];
    const isLast = i + 2 === leadPts.length;
    for (let e = 0; e < selfRing.length; e++) {
      const c = selfRing[e], d = selfRing[(e + 1) % selfRing.length];
      const t = segmentsIntersectParam(a, b, c, d);
      if (t !== null && !(isLast && t > 1 - 1e-4)) {
        return { safe: false, score: -200 };
      }
    }
  }
  // Must stay outside kept part interiors (for outer: outside self; for hole: inside self)
  for (const p of testPts) {
    const locSelf = pointInRing2D(p, selfRing, 1e-4);
    if (!loopItem.isHole && locSelf >= 0) return { safe: false, score: -150 };
    if (loopItem.isHole && locSelf <= 0) return { safe: false, score: -150 };
    for (const kept of allKeptRegions) {
      if (kept.ownerId === loopItem.id || kept.holeIds?.has(loopItem.id)) continue;
      if (pointInRegion2D(p, kept, halfWidth + 1e-4) >= 0) return { safe: false, score: -100 };
    }
  }
  return { safe: true, score: 100 };
}

function buildEntryCandidates(loopItem, leadDist, mode, allKeptRegions, exclusions, areaW, areaH, halfWidth) {
  const pts = loopItem.points;
  const n = pts.length;
  // Pick up to 24 well-spaced candidate sites (preferring midpoints of longest edges + evenly spaced samples)
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = DIST(a, b);
    if (len > 1e-5) edges.push({ i, len, a, b });
  }
  edges.sort((u, v) => v.len - u.len);

  const sites = [];
  const seen = new Set();
  const addSite = (i, t) => {
    const k = i + ':' + Math.round(t * 100);
    if (seen.has(k)) return;
    seen.add(k);
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len <= 1e-7) return;
    const tx = dx / len, tz = dz / len;
    // CW loop: outer waste normal = left (-tz, tx); hole waste normal = right (tz, -tx)
    const wn = loopItem.isHole ? [tz, -tx] : [-tz, tx];
    const entry = [a[0] + t * dx, a[1] + t * dz];
    sites.push({ edgeIdx: i, t, entry, tangent: [tx, tz], wasteNormal: wn, edgeLen: len });
  };

  for (let k = 0; k < Math.min(12, edges.length); k++) addSite(edges[k].i, 0.5);
  const stride = Math.max(1, Math.floor(n / 16));
  for (let i = 0; i < n && sites.length < 24; i += stride) addSite(i, 0.5);
  if (!sites.length) addSite(0, 0);

  if (mode !== 'Cut' || leadDist <= 1e-6) {
    // Without Lead-in, start on actual loop vertices (t=0) so straight edges never split unnecessarily.
    const step = Math.max(1, Math.floor(n / 24));
    const vertCandidates = [];
    for (let i = 0; i < n && vertCandidates.length < 24; i += step) {
      const entry = pts[i];
      vertCandidates.push({
        edgeIdx: i,
        t: 0,
        entry,
        start: entry,
        exit: entry,
        leadPts: null,
        safe: true,
        style: 'none'
      });
    }
    return vertCandidates;
  }

  // Try tangent quarter-circle first, then 45deg arc, straight 45deg, straight perp, then shorter distances
  const tiers = [
    { style: 'arc90', scale: 1.0, prio: 5 },
    { style: 'arc45', scale: 1.0, prio: 4 },
    { style: 'diag45', scale: 1.0, prio: 3 },
    { style: 'perp', scale: 1.0, prio: 2 },
    { style: 'perp', scale: 0.5, prio: 1 },
    { style: 'perp', scale: 0.25, prio: 0.5 }
  ];

  const safeCandidates = [];
  let bestUnsafe = null;

  for (const s of sites) {
    let foundSafe = false;
    for (const tier of tiers) {
      const leadPts = buildLeadInGeometry(s.entry, s.tangent, s.wasteNormal, leadDist * tier.scale, tier.style);
      const ev = evaluateLeadInClearance(leadPts, loopItem, allKeptRegions, exclusions, areaW, areaH, halfWidth);
      if (ev.safe) {
        safeCandidates.push({
          ...s,
          start: leadPts[0],
          exit: s.entry,
          leadPts,
          safe: true,
          style: tier.style,
          prio: tier.prio
        });
        foundSafe = true;
        break;
      }
      if (!bestUnsafe || ev.score > bestUnsafe.score) {
        bestUnsafe = {
          ...s,
          start: leadPts[0],
          exit: s.entry,
          leadPts,
          safe: false,
          style: tier.style,
          prio: 0,
          score: ev.score
        };
      }
    }
    if (!foundSafe && !bestUnsafe) {
      bestUnsafe = { ...s, start: s.entry, exit: s.entry, leadPts: null, safe: false, style: 'direct', prio: -1, score: -1e5 };
    }
  }

  if (safeCandidates.length) {
    // Prefer full-distance tangent arcs if available, keeping up to 12 top-tier candidates for route optimization
    const maxPrio = Math.max(...safeCandidates.map(c => c.prio));
    return safeCandidates.filter(c => c.prio >= maxPrio - 1).slice(0, 12);
  }
  // Best-effort: never fail! Prefer direct entry inside bed over out-of-bounds lead-in
  const direct = sites[0];
  if (bestUnsafe && bestUnsafe.score >= -250) return [bestUnsafe];
  return [{
    ...direct,
    start: direct.entry,
    exit: direct.entry,
    leadPts: null,
    safe: false,
    style: 'direct'
  }];
}

// ============================================================================
// Smart Hierarchy-Constrained Route Optimizer (NN + 2-opt + Or-opt + Entry CD)
// ============================================================================

export function optimizeRoute(items, router, startPoint = [0, 0]) {
  const N = items.length;
  if (N === 0) return [];

  // Map id -> index and build children lists for precedence DAG
  const idToIdx = new Map(items.map((it, i) => [it.id, i]));
  const parentIdx = items.map(it => (it.parentId != null && idToIdx.has(it.parentId) ? idToIdx.get(it.parentId) : -1));
  const childrenCount = new Int32Array(N);
  const childrenOf = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    if (parentIdx[i] >= 0) {
      childrenCount[parentIdx[i]]++;
      childrenOf[parentIdx[i]].push(i);
    }
  }

  // Track chosen variant index per item (closed: entry candidate; open: 0=fwd, 1=rev)
  const variant = new Int32Array(N);
  const getStart = (i, v = variant[i]) => items[i].variants[v].start;
  const getExit = (i, v = variant[i]) => items[i].variants[v].exit;

  // Phase 1: Precedence-respecting Greedy Nearest Neighbor with sibling locality
  const remainingDeps = Int32Array.from(childrenCount);
  const scheduled = new Uint8Array(N);
  const order = [];
  let curPos = startPoint;
  let lastParent = -2;

  for (let step = 0; step < N; step++) {
    let bestI = -1, bestV = 0, bestScore = Infinity;
    for (let i = 0; i < N; i++) {
      if (scheduled[i] || remainingDeps[i] > 0) continue;
      const vars = items[i].variants;
      for (let v = 0; v < vars.length; v++) {
        let d = router.distance(curPos, vars[v].start);
        // Gentle locality bonus for finishing sibling holes inside the same parent part
        if (parentIdx[i] >= 0 && parentIdx[i] === lastParent) d *= 0.92;
        if (d < bestScore) {
          bestScore = d;
          bestI = i;
          bestV = v;
        }
      }
    }
    if (bestI < 0) {
      // Break any unexpected cycle deterministically
      for (let i = 0; i < N; i++) if (!scheduled[i]) { bestI = i; bestV = 0; break; }
    }
    scheduled[bestI] = 1;
    variant[bestI] = bestV;
    order.push(bestI);
    curPos = getExit(bestI, bestV);
    lastParent = parentIdx[bestI];
    const p = parentIdx[bestI];
    if (p >= 0) remainingDeps[p]--;
  }

  // Helper to verify precedence constraints (every child before its parent)
  const posOf = new Int32Array(N);
  const validOrder = seq => {
    for (let k = 0; k < N; k++) posOf[seq[k]] = k;
    for (let i = 0; i < N; i++) {
      if (parentIdx[i] >= 0 && posOf[i] > posOf[parentIdx[i]]) return false;
    }
    return true;
  };

  const totalTravel = seq => {
    let sum = router.distance(startPoint, getStart(seq[0]));
    for (let k = 0; k + 1 < N; k++) {
      sum += router.distance(getExit(seq[k]), getStart(seq[k + 1]));
    }
    return sum;
  };

  const optimizeEntries = seq => {
    let improved = false;
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let k = 0; k < N; k++) {
        const i = seq[k];
        const vars = items[i].variants;
        if (vars.length <= 1) continue;
        const prevPt = k === 0 ? startPoint : getExit(seq[k - 1]);
        const nextPt = k + 1 < N ? getStart(seq[k + 1]) : null;
        let bestV = variant[i];
        let bestCost = router.distance(prevPt, vars[bestV].start) + (nextPt ? router.distance(vars[bestV].exit, nextPt) : 0);
        for (let v = 0; v < vars.length; v++) {
          const cost = router.distance(prevPt, vars[v].start) + (nextPt ? router.distance(vars[v].exit, nextPt) : 0);
          if (cost + 1e-6 < bestCost) {
            bestCost = cost;
            bestV = v;
          }
        }
        if (bestV !== variant[i]) {
          variant[i] = bestV;
          changed = true;
          improved = true;
        }
      }
      if (!changed) break;
    }
    return improved;
  };

  optimizeEntries(order);

  // Phase 2: Precedence-preserving Or-opt (block sizes 1, 2, 3) + 2-opt local search
  if (N >= 3 && N <= 250) {
    let bestCost = totalTravel(order);
    let improved = true;
    let rounds = 0;
    while (improved && rounds++ < 15) {
      improved = false;

      // Or-opt: relocate block of length 1..3
      for (const blockLen of [1, 2, 3]) {
        if (blockLen >= N) continue;
        for (let i = 0; i + blockLen <= N; i++) {
          const block = order.slice(i, i + blockLen);
          const rest = order.slice(0, i).concat(order.slice(i + blockLen));
          for (let j = 0; j <= rest.length; j++) {
            if (j === i) continue;
            const cand = rest.slice(0, j).concat(block, rest.slice(j));
            if (!validOrder(cand)) continue;
            const c = totalTravel(cand);
            if (c + 1e-4 < bestCost) {
              order.splice(0, N, ...cand);
              bestCost = c;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }

      // 2-opt segment reversal
      if (!improved) {
        for (let i = 0; i + 1 < N; i++) {
          for (let j = i + 2; j < N; j++) {
            const cand = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
            if (!validOrder(cand)) continue;
            const c = totalTravel(cand);
            if (c + 1e-4 < bestCost) {
              order.splice(0, N, ...cand);
              bestCost = c;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }

      if (improved) {
        if (optimizeEntries(order)) bestCost = totalTravel(order);
      }
    }
  }

  return order.map(i => ({ item: items[i], variant: items[i].variants[variant[i]] }));
}

// ============================================================================
// Pure Complete Cut Planner + G-code Builder
// ============================================================================

function fmtCoord(v) {
  const r = Math.abs(v) < 5e-5 ? 0 : Math.round(v * 10000) / 10000;
  return String(r);
}

function splitBlockLines(text) {
  if (!text) return [];
  return text.split(/\r\n|\n|\r/);
}

export function formatClock(seconds, lowerBound = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--:--';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return (lowerBound ? '≥' : '') + `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Build exact G-code text, line-state cursor map, and GPU display segments in one pass.
export function buildGcodeProgram(plannedRoutes, params, router, startPoint = [0, 0]) {
  const lines = [];
  const lineStates = []; // 0-indexed: lineStates[k] corresponds to 1-based line k+1
  const segments = [];   // { from:[x,z], to:[x,z], kind: 'travel'|'lead-in'|'cut'|'mark', line: 1-based }
  const speedStr = fmtCoord(params.Speed);
  const modeKind = params.Mode === 'Mark' ? 'mark' : 'cut';

  let curX = startPoint[0], curZ = startPoint[1];
  let toolOn = false;
  let feedWritten = false;
  let workLengthMm = 0;
  let leadInLengthMm = 0;
  let travelLengthMm = 0;
  let unsafeTravels = 0;

  const pushLine = (text, kind) => {
    lines.push(text);
    const lineNo = lines.length;
    lineStates.push({ line: lineNo, x: curX, z: curZ, toolOn, kind });
    return lineNo;
  };

  const pushBlock = (text, kind, nextToolOn = toolOn) => {
    const raw = splitBlockLines(text);
    toolOn = nextToolOn;
    for (const l of raw) pushLine(l, kind);
  };

  const moveRapid = target => {
    if (DIST([curX, curZ], target) <= 1e-5) return;
    const routed = router.route([curX, curZ], target);
    if (!routed.safe) unsafeTravels++;
    for (let i = 1; i < routed.points.length; i++) {
      const p = routed.points[i];
      const segLen = DIST([curX, curZ], p);
      if (segLen <= 1e-6) continue;
      const from = [curX, curZ];
      curX = p[0]; curZ = p[1];
      travelLengthMm += segLen;
      const lineNo = pushLine(`G0 X${fmtCoord(curX)} Y${fmtCoord(curZ)}`, 'travel');
      segments.push({ from, to: [curX, curZ], kind: 'travel', line: lineNo });
    }
    feedWritten = false;
  };

  const moveFeed = (target, kind) => {
    const segLen = DIST([curX, curZ], target);
    if (segLen <= 1e-6) return;
    const from = [curX, curZ];
    curX = target[0]; curZ = target[1];
    if (kind === 'lead-in') leadInLengthMm += segLen;
    else workLengthMm += segLen;
    const fPart = feedWritten ? '' : ` F${speedStr}`;
    feedWritten = true;
    const lineNo = pushLine(`G1 X${fmtCoord(curX)} Y${fmtCoord(curZ)}${fPart}`, kind);
    segments.push({ from, to: [curX, curZ], kind, line: lineNo });
  };

  // 1. Start G-code verbatim
  pushBlock(params['Start G-code'], 'start', false);
  // 2. Modal metric absolute
  pushLine('G21', 'header');
  pushLine('G90', 'header');

  // 3. Execute planned contours/chains
  for (const { item, variant } of plannedRoutes) {
    if (item.closed) {
      // Closed intact loop: single lead-in + continuous multi-pass CW loop!
      const startPt = variant.start;
      moveRapid(startPt);
      pushBlock(params['Tool on G-code'], 'tool-on', true);
      if (variant.leadPts && variant.leadPts.length >= 2) {
        for (let i = 1; i < variant.leadPts.length; i++) moveFeed(variant.leadPts[i], 'lead-in');
      }
      const loopPts = rotateLoopToEntry(item.points, variant.edgeIdx, variant.t);
      for (let pass = 0; pass < params.Passes; pass++) {
        for (let i = 1; i < loopPts.length; i++) moveFeed(loopPts[i], modeKind);
      }
      pushBlock(params['Tool off G-code'], 'tool-off', false);
    } else {
      // Open path (or bridged contour): return tool-off between passes
      const pts = variant.reversed ? item.points.slice().reverse() : item.points;
      for (let pass = 0; pass < params.Passes; pass++) {
        moveRapid(pts[0]);
        pushBlock(params['Tool on G-code'], 'tool-on', true);
        for (let i = 1; i < pts.length; i++) moveFeed(pts[i], modeKind);
        pushBlock(params['Tool off G-code'], 'tool-off', false);
      }
    }
  }

  // 4. Finish G-code verbatim
  pushBlock(params['Finish G-code'], 'finish', false);

  const code = lines.join('\n');
  const activeLengthMm = workLengthMm + leadInLengthMm;
  const workSeconds = activeLengthMm > 0 ? (activeLengthMm / params.Speed) * 60 : 0;
  const hasOpaque = BLOCKS.some(k => params[k].length > 0);
  const lowerBound = travelLengthMm > 0 || hasOpaque;

  return {
    code,
    lineCount: lines.length,
    lineStates,
    segments,
    unsafeTravels,
    metrics: {
      workLengthMm,
      leadInLengthMm,
      travelLengthMm,
      activeLengthMm,
      workSeconds,
      lowerBound,
      timeText: formatClock(workSeconds, lowerBound)
    }
  };
}

// ============================================================================
// Pure High-Level Plan Function (testable in Node & used by runtime)
// ============================================================================

export async function planCutContours({
  areaW,
  areaH,
  params,
  contours,      // [{ id, sourceHash, closed, points2D, splineData2D?, offsetFn? }]
  avoidRegions,  // [{ id, kind:'Avoid', sourceHash, outer, holes, bounds }]
  noCutRegions,  // [{ id, kind:'No-cut', sourceHash, outer, holes, bounds }]
  offsetLoop = null,
  checkCancelled = null
}) {
  const warnings = [];
  const sourceIssues = new Map();
  const noteIssue = (hash, code, message) => {
    warnings.push({ sourceHash: hash || null, code, message });
    if (hash) {
      let list = sourceIssues.get(hash);
      if (!list) sourceIssues.set(hash, list = []);
      if (!list.some(x => x.code === code)) list.push({ code, message });
    }
  };

  const halfWidth = params['Line width'] * 0.5;
  const mode = params.Mode;

  // Normalize regions with bounds
  const normRegion = r => ({ ...r, bounds: r.bounds || bounds2D(r.outer) });
  const avoids = avoidRegions.map(normRegion);
  const noCuts = noCutRegions.map(normRegion);

  // Active cut exclusions: Avoid (at max(halfWidth, 1e-4)) + No-cut (at halfWidth)
  const activeExclusions = [
    ...avoids.map(region => ({ region, radius: Math.max(halfWidth, 1e-4), kind: 'Avoid' })),
    ...noCuts.map(region => ({ region, radius: halfWidth, kind: 'No-cut' }))
  ];

  // 1. Separate closed vs open contours, normalize closed contours to CW (head side -Y)
  const closedSources = [];
  const openSources = [];
  for (const c of contours) {
    if (c.closed) {
      const cw = ensureCW(c.points2D);
      const area = Math.abs(signedArea2D(cw));
      if (cw.length < 3 || area <= 1e-6) {
        noteIssue(c.sourceHash, 'DEGENERATE_CONTOUR', 'Skipped degenerate closed contour.');
        continue;
      }
      closedSources.push({ ...c, points: cw, absArea: area, bounds: bounds2D(cw) });
    } else {
      const clean = cleanPolyline(c.points2D, false, 1e-5);
      if (clean.length < 2 || polylineLength(clean, false) <= 1e-5) {
        noteIssue(c.sourceHash, 'DEGENERATE_CONTOUR', 'Skipped degenerate open path.');
        continue;
      }
      openSources.push({ ...c, points: clean, bounds: bounds2D(clean) });
    }
  }

  // 2. Build even-odd nesting tree for closed contours (largest area first)
  closedSources.sort((a, b) => b.absArea - a.absArea);
  const depth = new Int32Array(closedSources.length);
  const parentOf = new Int32Array(closedSources.length).fill(-1);
  for (let i = 0; i < closedSources.length; i++) {
    const p = closedSources[i].points[0];
    for (let j = i - 1; j >= 0; j--) {
      const b = closedSources[j].bounds;
      if (p[0] < b.minX - EPS || p[0] > b.maxX + EPS || p[1] < b.minZ - EPS || p[1] > b.maxZ + EPS) continue;
      if (pointInRing2D(p, closedSources[j].points, EPS) === 1) {
        parentOf[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  }

  // Kept part regions (depth even = outer part, children of depth+1 = holes) for Lead-in safety
  const keptRegions = [];
  const keptByOuter = new Map();
  for (let i = 0; i < closedSources.length; i++) {
    if (depth[i] % 2 === 0) {
      const reg = { ownerId: closedSources[i].id, outer: closedSources[i].points, holes: [], holeIds: new Set(), bounds: closedSources[i].bounds };
      keptByOuter.set(i, reg);
      keptRegions.push(reg);
    }
  }
  for (let i = 0; i < closedSources.length; i++) {
    if (depth[i] % 2 === 1 && keptByOuter.has(parentOf[i])) {
      const reg = keptByOuter.get(parentOf[i]);
      reg.holes.push(closedSources[i].points);
      reg.holeIds.add(closedSources[i].id);
    }
  }

  // 3. Apply kerf compensation (Line width / 2 on waste side) for closed Cut contours using shared Outline
  const workItems = [];
  const idMapForParent = new Map(); // closedSources index -> workItem id (if kept intact)

  for (let i = 0; i < closedSources.length; i++) {
    checkCancelled?.();
    const src = closedSources[i];
    const isHole = depth[i] % 2 === 1;
    let compensatedLoops = [src.points];

    if (mode === 'Cut' && halfWidth > 1e-6 && offsetLoop) {
      try {
        const res = await offsetLoop(src, isHole ? -halfWidth : halfWidth, isHole);
        checkCancelled?.();
        if (res?.loops?.length) {
          compensatedLoops = res.loops.map(l => ensureCW(l)).filter(l => l.length >= 3 && Math.abs(signedArea2D(l)) > 1e-6);
        } else if (res?.collapsed) {
          noteIssue(src.sourceHash, 'KERF_COLLAPSED', 'Hole smaller than Line width; skipped inner offset.');
          compensatedLoops = [];
        } else if (res?.error) {
          noteIssue(src.sourceHash, 'OFFSET_FALLBACK', 'Outline offset fallback to uncompensated contour: ' + res.error);
        }
      } catch (e) {
        if (e?.code === 'CUT_CANCELLED') throw e;
        noteIssue(src.sourceHash, 'OFFSET_FALLBACK', 'Outline offset fallback to uncompensated contour.');
      }
    }

    const parentSrcIdx = parentOf[i];
    const parentId = parentSrcIdx >= 0 ? closedSources[parentSrcIdx].id : null;

    compensatedLoops.forEach((loopPts, subIdx) => {
      const itemId = subIdx === 0 ? src.id : `${src.id}#${subIdx}`;
      const clipped = clipPolylineToAllowed(loopPts, true, areaW, areaH, activeExclusions);
      if (clipped.clipped) {
        noteIssue(src.sourceHash, 'PATH_CLIPPED', 'Contour clipped by work bounds, Avoid or No-cut region.');
      }
      if (!clipped.chains.length) {
        noteIssue(src.sourceHash, 'CONTOUR_EXCLUDED', 'Entire contour falls outside bed or inside Avoid/No-cut.');
        return;
      }
      if (clipped.intact) {
        const item = {
          id: itemId,
          sourceHash: src.sourceHash,
          closed: true,
          isHole,
          depth: depth[i],
          parentId,
          points: ensureCW(clipped.chains[0].points)
        };
        const candidates = buildEntryCandidates(item, params['Lead-in'], mode, keptRegions, activeExclusions, areaW, areaH, halfWidth);
        if (mode === 'Cut' && params['Lead-in'] > 0 && candidates.every(c => !c.safe)) {
          noteIssue(src.sourceHash, 'LEAD_IN_UNSAFE', 'No fully clear Lead-in found; used best available entry.');
        }
        item.variants = candidates;
        workItems.push(item);
        if (subIdx === 0) idMapForParent.set(i, itemId);
      } else {
        // Broken by No-cut/Avoid/bounds -> each surviving arc becomes an open work chain (preserving CW direction!)
        clipped.chains.forEach((ch, ci) => {
          workItems.push({
            id: `${itemId}:b${ci}`,
            sourceHash: src.sourceHash,
            closed: false,
            isHole,
            depth: depth[i],
            parentId,
            points: ch.points,
            variants: [
              { start: ch.points[0], exit: ch.points.at(-1), reversed: false }
            ]
          });
        });
      }
    });
  }

  // 4. Process open contours (Mark or open Cut - uncompensated centerline, clipped to bounds + exclusions)
  for (const src of openSources) {
    checkCancelled?.();
    // If open contour starts inside an enclosing closed Cut part, execute it BEFORE releasing that outer part!
    let enclosingParentId = null;
    if (mode === 'Cut') {
      const p0 = src.points[0];
      for (let j = closedSources.length - 1; j >= 0; j--) {
        if (depth[j] % 2 !== 0) continue;
        if (pointInRing2D(p0, closedSources[j].points, EPS) === 1) {
          enclosingParentId = closedSources[j].id;
          break;
        }
      }
    }

    const clipped = clipPolylineToAllowed(src.points, false, areaW, areaH, activeExclusions);
    if (clipped.clipped) {
      noteIssue(src.sourceHash, 'PATH_CLIPPED', 'Open path clipped by work bounds, Avoid or No-cut region.');
    }
    clipped.chains.forEach((ch, ci) => {
      workItems.push({
        id: `${src.id}:o${ci}`,
        sourceHash: src.sourceHash,
        closed: false,
        isHole: false,
        depth: 999,
        parentId: enclosingParentId,
        points: ch.points,
        variants: [
          { start: ch.points[0], exit: ch.points.at(-1), reversed: false },
          { start: ch.points.at(-1), exit: ch.points[0], reversed: true }
        ]
      });
    });
  }

  // 5. Build Avoid visibility-graph router & optimize route order + entry points
  const router = buildAvoidRouter(avoids, areaW, areaH);
  const routedItems = optimizeRoute(workItems, router, [0, 0]);

  // 6. Emit G-code & cursor table
  const program = buildGcodeProgram(routedItems, params, router, [0, 0]);
  if (program.segments.length === 0) {
    noteIssue(null, 'NO_CUT_PATHS', 'No eligible paths remained inside the Cut work plane.');
  }
  if (program.unsafeTravels > 0) {
    noteIssue(null, 'AVOID_ROUTING_PARTIAL', 'Some travel transitions could not completely detour around Avoid inside work bounds.');
  }

  return {
    ...program,
    contourCount: workItems.length,
    avoidCount: avoids.length,
    noCutCount: noCuts.length,
    warnings,
    sourceIssues: Object.fromEntries([...sourceIssues.entries()].map(([h, list]) => [h, list])),
    sourceIssueHashes: new Set(sourceIssues.keys())
  };
}

// ============================================================================
// Native Scene Capture (Splines, Extrudes, Replicas, 3D Avoid/No-cut)
// ============================================================================

function effectiveCutTags(node, byId, extraNode = null) {
  let avoid = false, noCut = false;
  const walk = start => {
    const seen = new Set();
    for (let p = start; p && !seen.has(p.id); p = byId.get(p.parent)) {
      seen.add(p.id);
      for (const t of p.tags || []) {
        if (t.kind === 'cut_avoid') avoid = true;
        else if (t.kind === 'cut_no_cut') noCut = true;
      }
    }
  };
  walk(node);
  if (extraNode && extraNode !== node) walk(extraNode);
  return { avoid, noCut };
}

function decomposeSplineChains(data) {
  const segs = data?.segments || {};
  const verts = data?.vertices || {};
  const segIds = Object.keys(segs);
  if (!segIds.length) return [];

  const used = new Set();
  const chains = [];

  // 1. Follow authored sequences first
  for (const seq of data.sequences || []) {
    const list = (seq.segments || []).filter(id => segs[id] && !used.has(id));
    if (!list.length) continue;
    const edges = [];
    let curV = null;
    let ok = true;
    for (let i = 0; i < list.length; i++) {
      const id = list[i], e = segs[id];
      if (i === 0) {
        if (list.length > 1) {
          const next = segs[list[1]];
          const rev = (e.a === next.a || e.a === next.b) && !(e.b === next.a || e.b === next.b);
          edges.push({ id, reversed: rev });
          curV = rev ? e.a : e.b;
        } else {
          edges.push({ id, reversed: false });
          curV = e.b;
        }
      } else {
        if (e.a === curV) { edges.push({ id, reversed: false }); curV = e.b; }
        else if (e.b === curV) { edges.push({ id, reversed: true }); curV = e.a; }
        else { ok = false; break; }
      }
    }
    if (ok && edges.length) {
      const first = segs[edges[0].id];
      const startV = edges[0].reversed ? first.b : first.a;
      const closed = !!seq.closed || (edges.length >= 2 && curV === startV);
      for (const ed of edges) used.add(ed.id);
      chains.push({ edges, closed });
    }
  }

  // 2. Walk any remaining unsequenced segments
  const adj = new Map();
  for (const id of segIds) {
    if (used.has(id)) continue;
    const e = segs[id];
    if (!verts[e.a] || !verts[e.b]) continue;
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a).push(id);
    adj.get(e.b).push(id);
  }

  const walkFrom = (startV, firstId) => {
    const edges = [];
    let v = startV, nextId = firstId;
    while (nextId && !used.has(nextId)) {
      used.add(nextId);
      const e = segs[nextId];
      const reversed = e.b === v;
      edges.push({ id: nextId, reversed });
      v = reversed ? e.a : e.b;
      const inc = (adj.get(v) || []).filter(id => !used.has(id));
      nextId = inc.length === 1 ? inc[0] : (v === startV ? null : inc[0] || null);
    }
    const closed = edges.length >= 2 && v === startV;
    if (edges.length) chains.push({ edges, closed });
  };

  // Start open chains from degree-1 vertices first
  for (const [v, list] of adj) {
    const avail = list.filter(id => !used.has(id));
    if (avail.length === 1) walkFrom(v, avail[0]);
  }
  // Then closed cycles / branched components
  for (const id of segIds) {
    if (!used.has(id)) walkFrom(segs[id].a, id);
  }

  return chains;
}

// Build single-chain splineData in Cut physical (x, 0, z) coordinates for shared FrameGeometryKernel Outline,
// preserving every segment's authored approximation angle.
function buildCutLocalSplineData(K, data, chain, worldMatrix, workFrame) {
  const m = worldMatrix;
  const xformPt = p => {
    const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const c3 = workFrame.worldToCut3([wx, wy, wz]);
    return [c3[0], 0, c3[2]];
  };
  const xformVec = v => {
    const wx = m[0] * v[0] + m[4] * v[1] + m[8] * v[2];
    const wy = m[1] * v[0] + m[5] * v[1] + m[9] * v[2];
    const wz = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
    const c3 = workFrame.vecWorldToCut3([wx, wy, wz]);
    return [c3[0], 0, c3[2]];
  };

  const out = K.createSplineData({ angle: data.approximation?.angle || 10 });
  const q = K.addSplineSequence(out, chain.closed);
  const vMap = new Map();
  const getV = origId => {
    let nv = vMap.get(origId);
    if (!nv) {
      nv = K.addSplineVertex(out, xformPt(data.vertices[origId]));
      vMap.set(origId, nv);
    }
    return nv;
  };
  for (const ed of chain.edges) {
    const e = data.segments[ed.id];
    const aOrig = ed.reversed ? e.b : e.a;
    const bOrig = ed.reversed ? e.a : e.b;
    const haOrig = ed.reversed ? e.hb : e.ha;
    const hbOrig = ed.reversed ? e.ha : e.hb;
    const sid = K.addSplineSegment(out, q, getV(aOrig), getV(bOrig), xformVec(haOrig), xformVec(hbOrig));
    out.segments[sid].soft = !!e.soft;
    out.segments[sid].approximation = { angle: e.approximation?.angle || data.approximation?.angle || 10 };
  }
  return out;
}

// Sample a spline chain using the user's exact existing approximation (no extra subdivision!).
function sampleChainToCut2D(K, data, chain, worldMatrix, workFrame, preSampled = null) {
  const m = worldMatrix;
  const pts2 = [];
  let maxPlanarityDev = 0;

  for (let ei = 0; ei < chain.edges.length; ei++) {
    const ed = chain.edges[ei];
    const raw = preSampled?.get(ed.id) || K.sampleSplineSegment(data, ed.id);
    const list = ed.reversed ? raw.slice().reverse() : raw;
    const startIdx = ei === 0 ? 0 : 1;
    for (let j = startIdx; j < list.length; j++) {
      const p = list[j].position;
      const wx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const wy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const wz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
      const c3 = workFrame.worldToCut3([wx, wy, wz]);
      const dev = Math.abs(c3[1]);
      if (dev > maxPlanarityDev) maxPlanarityDev = dev;
      pts2.push([c3[0], c3[2]]);
    }
  }
  const clean = cleanPolyline(pts2, chain.closed, 1e-6);
  return { points2D: clean, maxPlanarityDev };
}

function sampleOffsetSplineDataTo2DLoops(K, offsetResult) {
  const data = offsetResult?.data;
  const comps = offsetResult?.generated?.components;
  if (!data || !comps?.length) return [];
  const loops = [];
  for (const comp of comps) {
    if (!comp.segments?.length) continue;
    const pts = [];
    let prevV = null;
    for (let i = 0; i < comp.segments.length; i++) {
      const sid = comp.segments[i];
      const seg = data.segments[sid];
      if (!seg) continue;
      let raw = K.sampleSplineSegment(data, sid);
      if (prevV && seg.b === prevV && seg.a !== prevV) {
        raw = raw.slice().reverse();
        prevV = seg.a;
      } else {
        prevV = seg.b;
      }
      const start = i === 0 ? 0 : 1;
      for (let j = start; j < raw.length; j++) {
        const p = raw[j].position;
        pts.push([p[0], p[2]]);
      }
    }
    const clean = cleanPolyline(pts, true, 1e-5);
    if (clean.length >= 3 && Math.abs(signedArea2D(clean)) > 1e-6) loops.push(clean);
  }
  return loops;
}

function computeSceneFingerprint(context, cutNode, workFrame) {
  const core = context.core;
  const engine = core?.engine;
  const FM = context.math;
  if (!engine?.scene || !workFrame.valid) return 'invalid';

  const nodes = context.document.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const byHash = new Map(nodes.map(n => [n.nativeHash, n]));
  const cutInv = FM.inv(context.document.world(cutNode.nativeHash));
  const roundM = mat => Array.from(mat, v => Math.round(v * 1e6) / 1e6);

  const items = [
    cutNode.nativeHash,
    validate(cutNode.params),
    Math.round(workFrame.areaW * 1e5),
    Math.round(workFrame.areaH * 1e5),
    workFrame.sheared ? 1 : 0
  ];

  // Standalone spline displays
  for (const d of engine.splineDisplays?.values?.() || []) {
    if (!d.visible || d.consumed || d.generated) continue;
    const n = byHash.get(d.hash);
    if (!n) continue;
    const tags = effectiveCutTags(n, byId);
    const rel = FM.mul(cutInv, engine.pluginWorld(n.nativeHash));
    items.push(['sp', d.hash, d.topology, d.wireVersion || 0, tags.avoid ? 1 : 0, tags.noCut ? 1 : 0, roundM(rel), d.data?.approximation?.angle || 10]);
  }
  // Curve replicas
  for (const c of engine.scene.curveReplicas || []) {
    if (c.frameVisible === false) continue;
    let src = c;
    while (src.replicaSource) src = src.replicaSource;
    const d = c.display || engine.splineDisplays?.get(src.hashId);
    if (!d || d.generated) continue;
    const n = byHash.get(c.hashId), sn = byHash.get(src.hashId);
    const tags = effectiveCutTags(n, byId, sn);
    const world = FM.mul(engine.pluginWorld(c.hashId), c.replicaMatrix || FM.I());
    const rel = FM.mul(cutInv, world);
    items.push(['cr', c.hashId, c.replicaKey || '', d.topology, d.wireVersion || 0, tags.avoid ? 1 : 0, tags.noCut ? 1 : 0, roundM(rel)]);
  }
  // Meshes (Extrude sources + 3D Avoid/No-cut regions)
  for (const m of engine.scene.meshes || []) {
    if (m.frameVisible === false || !m.triangleCount) continue;
    let src = m;
    while (src.replicaSource) src = src.replicaSource;
    const n = byHash.get(m.hashId), sn = byHash.get(src.hashId);
    const tags = effectiveCutTags(n, byId, sn);
    const isExtrude = sn?.type === 'extrude';
    if (!tags.avoid && !tags.noCut && !isExtrude) continue;
    const world = m.frameWorld || FM.mul(engine.pluginWorld(m.hashId), m.replicaMatrix || FM.I());
    const rel = FM.mul(cutInv, world);
    items.push(['m', m.hashId, m.replicaKey || '', (m.version || 0) - (m.frameRevision || 0), tags.avoid ? 1 : 0, tags.noCut ? 1 : 0, isExtrude ? 1 : 0, roundM(rel)]);
  }

  return context.hash.values.key(items);
}

async function captureSceneForCut(context, cutNode, workFrame, checkCancelled) {
  const core = context.core;
  const engine = core.engine;
  const spline = core.spline;
  const K = spline.K();
  const FM = context.math;

  await spline.flush();
  engine.flushReplicaPublication?.();
  checkCancelled?.();

  const nodes = context.document.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const byHash = new Map(nodes.map(n => [n.nativeHash, n]));

  const contours = [];
  const avoidRegions = [];
  const noCutRegions = [];
  const captureWarnings = [];
  const captureIssueHashes = new Set();
  const noteCaptureIssue = (hash, code, message) => {
    captureWarnings.push({ sourceHash: hash || null, code, message });
    if (hash) captureIssueHashes.add(hash);
  };

  const planarityTol = Math.max(0.05, 1e-4 * Math.max(workFrame.areaW, workFrame.areaH));
  let seqId = 0;

  const ingestSplineData = (data, worldMatrix, sourceHash, tags, preSampled = null, isExtrudeProfile = false) => {
    if (!data || !Object.keys(data.segments || {}).length) return;
    const chains = decomposeSplineChains(data);
    for (const chain of chains) {
      const sampled = sampleChainToCut2D(K, data, chain, worldMatrix, workFrame, preSampled);
      if (sampled.points2D.length < (chain.closed ? 3 : 2)) continue;
      if (!isExtrudeProfile && sampled.maxPlanarityDev > planarityTol) {
        noteCaptureIssue(sourceHash, 'NON_PLANAR_PROJECTED', `Source deviates ${sampled.maxPlanarityDev.toFixed(2)} mm from Cut plane; projected onto bed (best effort).`);
      }
      if (tags.avoid || tags.noCut) {
        if (chain.closed) {
          const ring = cleanPolyline(sampled.points2D, true, 1e-5);
          if (ring.length >= 3 && Math.abs(signedArea2D(ring)) > 1e-6) {
            if (tags.avoid) avoidRegions.push({ id: `sp-avoid:${seqId++}`, kind: 'Avoid', sourceHash, outer: ring, holes: [], bounds: bounds2D(ring) });
            if (tags.noCut) noCutRegions.push({ id: `sp-nocut:${seqId++}`, kind: 'No-cut', sourceHash, outer: ring, holes: [], bounds: bounds2D(ring) });
          }
        } else {
          noteCaptureIssue(sourceHash, 'OPEN_EXCLUSION_IGNORED', 'Open spline tagged Avoid/No-cut has no enclosed area.');
        }
        continue; // Tagged exclusions never cut
      }
      contours.push({
        id: `c:${sourceHash}:${seqId++}`,
        sourceHash,
        closed: chain.closed,
        points2D: sampled.points2D,
        splineData2D: chain.closed ? buildCutLocalSplineData(K, data, chain, worldMatrix, workFrame) : null
      });
    }
  };

  // 1. Standalone visible non-consumed splines
  for (const d of engine.splineDisplays?.values?.() || []) {
    if (!d.visible || d.consumed || d.generated || !d.data) continue;
    const n = byHash.get(d.hash);
    if (!n) continue;
    const tags = effectiveCutTags(n, byId);
    const world = engine.pluginWorld(n.nativeHash);
    ingestSplineData(d.data, world, n.nativeHash, tags, d.samples);
  }

  // 2. Visible spline replicas (Instance / Cloner / Symmetry)
  for (const c of engine.scene.curveReplicas || []) {
    if (c.frameVisible === false) continue;
    let src = c;
    while (src.replicaSource) src = src.replicaSource;
    const d = c.display || engine.splineDisplays?.get(src.hashId);
    if (!d?.data || d.generated) continue;
    const n = byHash.get(c.hashId), sn = byHash.get(src.hashId);
    const tags = effectiveCutTags(n, byId, sn);
    const world = FM.mul(engine.pluginWorld(c.hashId), c.replicaMatrix || FM.I());
    ingestSplineData(d.data, world, c.hashId, tags, d.samples);
  }

  // 3. Visible meshes: Extrude profiles (when untagged) & 3D Avoid/No-cut regions
  const geometryCache = new Map();
  const readMeshCached = async m => {
    let src = m;
    while (src.replicaSource) src = src.replicaSource;
    let raw = geometryCache.get(src);
    if (!raw) {
      raw = await engine.readGeometry(src);
      checkCancelled?.();
      geometryCache.set(src, raw);
    }
    return raw;
  };

  for (const m of engine.scene.meshes || []) {
    if (m.frameVisible === false || !m.triangleCount) continue;
    let src = m;
    while (src.replicaSource) src = src.replicaSource;
    const n = byHash.get(m.hashId), sn = byHash.get(src.hashId);
    if (!sn) continue;
    const tags = effectiveCutTags(n, byId, sn);
    const world = m.frameWorld || FM.mul(engine.pluginWorld(m.hashId), m.replicaMatrix || FM.I());

    // 3a. Tagged Avoid / No-cut 3D objects
    if (tags.avoid || tags.noCut) {
      // Fast exact path for planar Extrude aligned with Cut bed
      let usedExtrudeProfile = false;
      if (sn.type === 'extrude') {
        const srcs = spline.generatorSources(sn);
        if (srcs.length) {
          const allPlanarAligned = srcs.every(({ node: pn, instances }) => {
            const pData = spline.states.get(pn.id)?.data || pn.splineData;
            if (!pData) return false;
            const localMat = engine.splineOccurrenceFrame(pn.nativeHash, sn.nativeHash, instances);
            const profWorld = FM.mul(world, localMat);
            const pts = Object.values(pData.vertices || {});
            if (pts.length < 3) return false;
            let minY = Infinity, maxY = -Infinity;
            for (const p of pts) {
              const wx = profWorld[0] * p[0] + profWorld[4] * p[1] + profWorld[8] * p[2] + profWorld[12];
              const wy = profWorld[1] * p[0] + profWorld[5] * p[1] + profWorld[9] * p[2] + profWorld[13];
              const wz = profWorld[2] * p[0] + profWorld[6] * p[1] + profWorld[10] * p[2] + profWorld[14];
              const y = workFrame.worldToCut3([wx, wy, wz])[1];
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
            return maxY - minY <= planarityTol;
          });
          if (allPlanarAligned) {
            usedExtrudeProfile = true;
            for (const { node: pn, instances } of srcs) {
              const pData = spline.states.get(pn.id)?.data || pn.splineData;
              const localMat = engine.splineOccurrenceFrame(pn.nativeHash, sn.nativeHash, instances);
              const profWorld = FM.mul(world, localMat);
              ingestSplineData(pData, profWorld, m.hashId, tags, null, true);
            }
          }
        }
      }
      if (!usedExtrudeProfile) {
        const raw = await readMeshCached(m);
        if (tags.avoid) {
          const regs = extractMeshFootprint2D(raw.vertices, raw.indices, world, workFrame, 'Avoid', m.hashId, K.FrameOutline?.arrangement);
          avoidRegions.push(...regs);
        }
        if (tags.noCut) {
          const regs = extractMeshFootprint2D(raw.vertices, raw.indices, world, workFrame, 'No-cut', m.hashId, K.FrameOutline?.arrangement);
          noCutRegions.push(...regs);
        }
      }
      continue;
    }

    // 3b. Untagged Extrude objects as Cut/Mark profile sources
    if (sn.type === 'extrude') {
      const srcs = spline.generatorSources(sn);
      for (const { node: pn, instances } of srcs) {
        const pData = spline.states.get(pn.id)?.data || pn.splineData;
        if (!pData || !Object.keys(pData.segments || {}).length) continue;
        const localMat = engine.splineOccurrenceFrame(pn.nativeHash, sn.nativeHash, instances);
        const profWorld = FM.mul(world, localMat);
        // Verify profile plane is parallel to Cut plane
        const pts = Object.values(pData.vertices || {});
        let minY = Infinity, maxY = -Infinity;
        for (const p of pts) {
          const wx = profWorld[0] * p[0] + profWorld[4] * p[1] + profWorld[8] * p[2] + profWorld[12];
          const wy = profWorld[1] * p[0] + profWorld[5] * p[1] + profWorld[9] * p[2] + profWorld[13];
          const wz = profWorld[2] * p[0] + profWorld[6] * p[1] + profWorld[10] * p[2] + profWorld[14];
          const y = workFrame.worldToCut3([wx, wy, wz])[1];
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (maxY - minY > planarityTol) {
          noteCaptureIssue(m.hashId, 'TILTED_EXTRUDE_PROJECTED', 'Extrude profile is tilted relative to Cut plane; projected best-effort.');
        }
        ingestSplineData(pData, profWorld, m.hashId, tags, null, true);
      }
    }
  }

  // Group concentric spline Avoid/No-cut loops from the same source into polygons with holes
  const packRegionList = (list, kind) => {
    const out = [];
    const bySource = new Map();
    for (const r of list) {
      if (r.holes?.length) { out.push(r); continue; }
      let grp = bySource.get(r.sourceHash);
      if (!grp) bySource.set(r.sourceHash, grp = []);
      grp.push(r.outer);
    }
    for (const [h, rings] of bySource) {
      out.push(...classifyLoopsToRegions(rings, kind, `${kind}:${h}`, h));
    }
    return out;
  };

  return {
    contours,
    avoidRegions: packRegionList(avoidRegions, 'Avoid'),
    noCutRegions: packRegionList(noCutRegions, 'No-cut'),
    captureWarnings,
    captureIssueHashes
  };
}

// ============================================================================
// GPU Viewport Renderer (Local Axes + Live Toolpath + Scrubbing Head Marker)
// ============================================================================

const axesShader = `
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
override orthographic:bool=false;
struct Output{@builtin(position) position:vec4f,@location(0) color:vec3f};
@vertex fn axes(@builtin(vertex_index) vertex:u32)->Output{
 let ends=array<vec3f,2>(vec3f(1000,0,0),vec3f(0,0,1000));
 let colors=array<vec3f,2>(vec3f(.82,.24,.22),vec3f(.28,.44,.85));
 let local=select(vec3f(0),ends[vertex/2u],vertex%2u!=0u);
 let p=(frameCameraRelative(camera.rotation)*vec4f(((frame.matrix*vec4f(local,1)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1)).xyz;
 let xy=p.xy+camera.viewport.zw;let depth=-p.z;var out:Output;out.color=colors[vertex/2u];
 if(orthographic){out.position=vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1);}
 else{out.position=vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);}return out;
}
@fragment fn fs(input:Output)->@location(0) vec4f{return vec4f(input.color,1);}`;

const pathShader = `
struct Camera{rotation:mat4x4f,centerScale:vec4f,viewport:vec4f,clip:vec4f,frame:vec4f,modes:vec4f};
struct Frame{matrix:mat4x4f,inverse:mat4x4f,color:vec4f,settings:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(1) @binding(0) var<uniform> frame:Frame;
override orthographic:bool=false;
struct PathOut{@builtin(position) position:vec4f,@location(0) color:vec4f};
fn projectLocal(local:vec3f)->vec4f{
 let p=(frameCameraRelative(camera.rotation)*vec4f(((frame.matrix*vec4f(local,1.0)).xyz-camera.centerScale.xyz)*camera.centerScale.w,1.0)).xyz;
 let xy=p.xy+camera.viewport.zw;let depth=-p.z;
 if(orthographic){return vec4f(xy.x*camera.viewport.y/camera.viewport.x,xy.y*camera.viewport.y,(depth-camera.clip.x)/(camera.clip.y-camera.clip.x),1.0);}
 return vec4f(xy.x*camera.clip.w/camera.viewport.x,xy.y*camera.clip.w,(camera.clip.y*depth-camera.clip.x*camera.clip.y)/(camera.clip.y-camera.clip.x),depth);
}
@vertex fn pathVS(@location(0) pos:vec3f,@location(1) segInfo:vec2f)->PathOut{
 var out:PathOut;
 out.position=projectLocal(pos);
 let lineNo=segInfo.x;
 let kind=i32(segInfo.y+0.5);
 let cursor=frame.settings.x;
 let done=lineNo<=cursor;
 var rgb=vec3f(0.55,0.58,0.62);
 var a:f32=select(0.28f,0.52f,done);
 if(kind==1){rgb=select(vec3f(0.25,0.55,0.38),vec3f(0.35,0.95,0.58),done);a=select(0.45f,1.0f,done);}
 else if(kind==2){rgb=select(vec3f(0.52,0.36,0.16),vec3f(1.0,0.72,0.22),done);a=select(0.42f,1.0f,done);}
 else if(kind==3){rgb=select(vec3f(0.22,0.42,0.52),vec3f(0.38,0.86,1.0),done);a=select(0.42f,1.0f,done);}
 out.color=vec4f(rgb,a);
 return out;
}
@vertex fn headVS(@builtin(vertex_index) vid:u32)->PathOut{
 let head=vec3f(frame.settings.y,0.0,frame.settings.z);
 let toolOn=frame.settings.w>0.5;
 let r:f32=select(5.0f,7.0f,toolOn);
 var offsets=array<vec3f,12>(
  vec3f(-r,0.0,0.0),vec3f(r,0.0,0.0),
  vec3f(0.0,0.0,-r),vec3f(0.0,0.0,r),
  vec3f(0.0,0.0,r),vec3f(r,0.0,0.0),
  vec3f(r,0.0,0.0),vec3f(0.0,0.0,-r),
  vec3f(0.0,0.0,-r),vec3f(-r,0.0,0.0),
  vec3f(-r,0.0,0.0),vec3f(0.0,0.0,r)
 );
 var out:PathOut;
 out.position=projectLocal(head+offsets[vid]);
 out.color=select(vec4f(0.85,0.92,1.0,1.0),vec4f(1.0,0.28,0.16,1.0),toolOn);
 return out;
}
@fragment fn pathFS(input:PathOut)->@location(0) vec4f{return input.color;}`;

export function createAxes(context, getDrawState = null) {
  let device = null;
  let pipelines = null;
  let pathPipelines = null;
  let headPipelines = null;
  let pending = null;
  let groups = new WeakMap();
  let layouts = null;
  let error = null;
  const pathBuffers = new Map();

  function releasePaths() {
    for (const row of pathBuffers.values()) row.buffer?.destroy();
    pathBuffers.clear();
  }

  function prepare(d, format) {
    if (pending) return;
    device = d;
    error = null;
    pending = (async () => {
      const targetFormat = format || navigator.gpu.getPreferredCanvasFormat();
      const moduleAxes = d.createShaderModule({ label: 'Cut local axes', code: context.viewport.cameraWGSL + axesShader });
      const modulePath = d.createShaderModule({ label: 'Cut toolpath', code: context.viewport.cameraWGSL + pathShader });
      const infoPath = await modulePath.getCompilationInfo();
      const errs = infoPath.messages.filter(m => m.type === 'error');
      if (errs.length) throw Error(errs.map(m => `L${m.lineNum}:${m.linePos} ${m.message}`).join('; '));
      layouts = [0, 1].map(() => d.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }]
      }));
      const layout = d.createPipelineLayout({ bindGroupLayouts: layouts });
      const blend = {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
      };
      const builtAxes = await Promise.all([false, true].map(orthographic =>
        d.createRenderPipelineAsync({
          label: 'Cut local axes',
          layout,
          vertex: { module: moduleAxes, entryPoint: 'axes', constants: { orthographic } },
          fragment: { module: moduleAxes, entryPoint: 'fs', targets: [{ format: targetFormat }] },
          primitive: { topology: 'line-list' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }
        })
      ));
      const builtPath = await Promise.all([false, true].map(orthographic =>
        d.createRenderPipelineAsync({
          label: 'Cut toolpath lines',
          layout,
          vertex: {
            module: modulePath,
            entryPoint: 'pathVS',
            constants: { orthographic },
            buffers: [{
              arrayStride: 20,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x3' },
                { shaderLocation: 1, offset: 12, format: 'float32x2' }
              ]
            }]
          },
          fragment: { module: modulePath, entryPoint: 'pathFS', targets: [{ format: targetFormat, blend }] },
          primitive: { topology: 'line-list' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }
        })
      ));
      const builtHead = await Promise.all([false, true].map(orthographic =>
        d.createRenderPipelineAsync({
          label: 'Cut head marker',
          layout,
          vertex: { module: modulePath, entryPoint: 'headVS', constants: { orthographic } },
          fragment: { module: modulePath, entryPoint: 'pathFS', targets: [{ format: targetFormat, blend }] },
          primitive: { topology: 'line-list' },
          depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }
        })
      ));
      if (device === d) {
        pipelines = builtAxes;
        pathPipelines = builtPath;
        headPipelines = builtHead;
        context.requestDraw();
      }
    })().catch(e => {
      pipelines = pathPipelines = headPipelines = null;
      error = { code: 'CUT_VIEWPORT_UNAVAILABLE', message: String(e.message) };
    }).finally(() => { pending = null; });
  }

  const group = (buffer, index) => {
    let g = groups.get(buffer);
    if (!g) {
      g = device.createBindGroup({ layout: layouts[index], entries: [{ binding: 0, resource: { buffer } }] });
      groups.set(buffer, g);
    }
    return g;
  };

  function ensurePathBuffer(hash, st) {
    if (!st?.vertexData?.length) {
      const old = pathBuffers.get(hash);
      if (old) { old.buffer?.destroy(); pathBuffers.delete(hash); }
      return null;
    }
    const existing = pathBuffers.get(hash);
    if (existing && existing.revision === st.revision && existing.device === device) return existing;
    existing?.buffer?.destroy();
    const buf = device.createBuffer({
      label: 'Cut toolpath buffer ' + hash,
      size: Math.max(4, st.vertexData.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(buf, 0, st.vertexData);
    const row = { device, revision: st.revision, buffer: buf, count: st.vertexCount };
    pathBuffers.set(hash, row);
    return row;
  }

  const render = ({ pass, camera, frame, orthographic, hash, device: d, format }) => {
    if (device !== d) {
      releasePaths();
      pipelines = pathPipelines = headPipelines = null;
      groups = new WeakMap();
      prepare(d, format);
    }
    if (!pipelines) return;
    const g0 = group(camera, 0);
    const g1 = group(frame, 1);

    // 1. Local X (red) and Z (blue) bed axes
    pass.setPipeline(pipelines[orthographic ? 1 : 0]);
    pass.setBindGroup(0, g0);
    pass.setBindGroup(1, g1);
    pass.draw(4);

    // 2. Completed toolpath & scrubbing head marker (zero upload on scrub!)
    const st = getDrawState?.(hash);
    if (st && pathPipelines && headPipelines) {
      const row = ensurePathBuffer(hash, st);
      if (row?.count) {
        pass.setPipeline(pathPipelines[orthographic ? 1 : 0]);
        pass.setBindGroup(0, g0);
        pass.setBindGroup(1, g1);
        pass.setVertexBuffer(0, row.buffer);
        pass.draw(row.count);
      }
      if (st.hasHead) {
        pass.setPipeline(headPipelines[orthographic ? 1 : 0]);
        pass.setBindGroup(0, g0);
        pass.setBindGroup(1, g1);
        pass.draw(12);
      }
    }
  };

  render.retire = hash => {
    const old = pathBuffers.get(hash);
    if (old) { old.buffer?.destroy(); pathBuffers.delete(hash); }
  };
  render.status = () => ({ ready: !!pipelines, pending: !!pending, error });
  return render;
}

// ============================================================================
// Plugin Activation
// ============================================================================

const empty = { type: 'object', properties: {}, additionalProperties: false };
const KIND_CODE = { travel: 0, 'lead-in': 1, cut: 2, mark: 3 };

export async function activate(context) {
  if (context.version !== 1) throw failure('API_VERSION', 'Unsupported Frame plugin API.');
  let storage;
  try { storage = globalThis.localStorage; } catch {}
  const defaults = settingsObserver(context, storage);
  const owner = hash => {
    const n = context.document.nodes.find(n => n.nativeHash === hash && n.type === 'cut');
    if (!n) throw failure('INVALID_OWNER', 'Select a Cut object.');
    return n;
  };

  // Per-Cut-owner runtime state (never persisted in HASH)
  const states = new Map();
  let jobCounter = 0;
  let gpuRevCounter = 0;

  const getState = hash => {
    let st = states.get(hash);
    if (!st) {
      st = {
        state: 'idle', // 'idle' | 'running' | 'complete' | 'stale' | 'error'
        job: null,
        result: null,
        cursor: 0,
        revision: 0,
        vertexData: null,
        vertexCount: 0,
        error: null,
        sourceIssueHashes: new Set(),
        signature: null
      };
      states.set(hash, st);
    }
    return st;
  };

  const getHeadState = st => {
    const res = st?.result;
    if (!res) return { x: 0, z: 0, localX: 0, localZ: 0, toolOn: false, line: 0, lineText: '' };
    const line = Math.max(0, Math.min(res.lineCount, Math.round(st.cursor)));
    if (line <= 0 || !res.lineStates.length) {
      return { x: 0, z: 0, localX: 0, localZ: 0, toolOn: false, line: 0, lineText: '' };
    }
    const ls = res.lineStates[line - 1];
    const loc = res.workFrame.cut2ToLocal([ls.x, ls.z]);
    return {
      x: ls.x,
      z: ls.z,
      localX: loc[0],
      localZ: loc[2],
      toolOn: ls.toolOn,
      line,
      lineText: res.lines[line - 1] ?? ''
    };
  };

  const packPathVertices = (segments, workFrame) => {
    if (!segments.length) return { data: null, count: 0 };
    const data = new Float32Array(segments.length * 10); // 2 verts * 5 floats
    let at = 0;
    for (const seg of segments) {
      const a = workFrame.cut2ToLocal(seg.from);
      const b = workFrame.cut2ToLocal(seg.to);
      const kc = KIND_CODE[seg.kind] ?? 0;
      data[at++] = a[0]; data[at++] = 0; data[at++] = a[2]; data[at++] = seg.line; data[at++] = kc;
      data[at++] = b[0]; data[at++] = 0; data[at++] = b[2]; data[at++] = seg.line; data[at++] = kc;
    }
    return { data, count: segments.length * 2 };
  };

  const retireResult = (hash, st, nextState = 'stale') => {
    st.result = null;
    st.vertexData = null;
    st.vertexCount = 0;
    st.cursor = 0;
    st.signature = null;
    st.sourceIssueHashes = new Set();
    if (st.state === 'complete') st.state = nextState;
    axes.retire(hash);
  };

  const cancelJob = (hash, reason = 'Cancelled') => {
    const st = states.get(hash);
    if (!st?.job || st.job.state !== 'running') {
      return { cancelled: false, job: null };
    }
    const j = st.job;
    j.cancelled = true;
    j.state = 'cancelled';
    try { j.outlineSession?.worker?.terminate(); } catch {}
    if (j.outlineSession) j.outlineSession.worker = null;
    st.job = null;
    if (st.state === 'running') st.state = st.result ? 'complete' : 'idle';
    context.requestAttributes();
    context.requestDraw();
    return { cancelled: true, job: { id: j.id, state: 'cancelled', reason } };
  };

  const checkFreshness = hash => {
    const n = context.document.nodes.find(x => x.nativeHash === hash && x.type === 'cut');
    const st = states.get(hash);
    if (!n || !st) return;
    if (st.state !== 'complete' || !st.result) return;
    const wf = extractWorkFrame(context.document.world(hash));
    const sig = wf.valid ? computeSceneFingerprint(context, n, wf) : 'invalid';
    if (sig !== st.signature) {
      retireResult(hash, st, 'stale');
      context.requestAttributes();
      context.requestDraw();
    }
  };

  let freshnessQueued = false;
  const scheduleFreshnessCheck = () => {
    if (freshnessQueued) return;
    freshnessQueued = true;
    queueMicrotask(() => {
      freshnessQueued = false;
      const alive = new Set(context.document.nodes.filter(x => x.type === 'cut').map(x => x.nativeHash));
      for (const hash of [...states.keys()]) {
        if (!alive.has(hash)) {
          cancelJob(hash, 'Owner removed');
          axes.retire(hash);
          states.delete(hash);
          continue;
        }
        checkFreshness(hash);
      }
    });
  };

  const axes = createAxes(context, hash => {
    const st = states.get(hash);
    if (!st || st.state !== 'complete' || !st.result) return null;
    return {
      revision: st.revision,
      vertexData: st.vertexData,
      vertexCount: st.vertexCount,
      hasHead: st.result.lineCount > 0
    };
  });

  // Shared non-mutating Outline runner via context.core.geometry.worker
  function createOutlineAdapter(core, job) {
    const K = core.spline.K();
    const geom = core.geometry;
    const session = { worker: null };
    job.outlineSession = session;

    return {
      async offset(src, signedDist, isHole) {
        if (!src.splineData2D) return { loops: [src.points] };
        const segIds = Object.keys(src.splineData2D.segments || {});
        if (!segIds.length) return { loops: [src.points] };

        const runOnce = async dist => {
          if (job.cancelled) throw failure('CUT_CANCELLED', 'Cancelled');
          const res = await geom.worker('outline', {
            data: src.splineData2D,
            segments: segIds,
            options: { distance: dist, normal: [0, 1, 0] }
          }, [], session);
          if (job.cancelled) throw failure('CUT_CANCELLED', 'Cancelled');
          return sampleOffsetSplineDataTo2DLoops(K, res);
        };

        let loops = await runOnce(signedDist);
        if (!loops.length) {
          return isHole ? { loops: [], collapsed: true } : { loops: [src.points], error: 'empty-offset' };
        }
        // Self-verify outward (larger total area) vs inward (smaller total area)
        const totalArea = loops.reduce((s, l) => s + Math.abs(signedArea2D(l)), 0);
        const wantLarger = !isHole;
        if ((wantLarger && totalArea + 1e-4 < src.absArea) || (!wantLarger && totalArea > src.absArea + 1e-4)) {
          const flipped = await runOnce(-signedDist);
          if (flipped.length) loops = flipped;
        }
        return { loops };
      },
      dispose() {
        try { session.worker?.terminate(); } catch {}
        session.worker = null;
      }
    };
  }

  const startGenerate = hash => {
    const n = owner(hash);
    defaults.observe();
    const params = validate({ ...n.params });
    const st = getState(hash);
    if (st.job?.state === 'running') cancelJob(hash, 'Superseded by new Generate');

    const workFrame = extractWorkFrame(context.document.world(hash));
    if (!workFrame.valid) {
      retireResult(hash, st, 'error');
      st.state = 'error';
      st.error = { code: workFrame.code, message: workFrame.message };
      context.requestAttributes();
      context.requestDraw();
      return { jobId: null, state: 'error', error: st.error };
    }

    const jobId = `cut-${++jobCounter}`;
    const job = {
      id: jobId,
      state: 'running',
      cancelled: false,
      progress: 'Capturing…',
      outlineSession: null,
      promise: null
    };
    st.job = job;
    st.state = 'running';
    st.error = null;
    context.requestAttributes();
    context.requestDraw();

    const checkCancelled = () => {
      if (job.cancelled || st.job !== job) throw failure('CUT_CANCELLED', 'Cut generation cancelled.');
      const curNode = context.document.nodes.find(x => x.nativeHash === hash && x.type === 'cut');
      if (!curNode) throw failure('CUT_CANCELLED', 'Cut owner retired.');
    };

    job.promise = (async () => {
      let outlineAdapter = null;
      try {
        // Yield once so UI shows busy/Stop state cleanly
        await new Promise(r => setTimeout(r, 0));
        checkCancelled();

        const captured = await captureSceneForCut(context, n, workFrame, checkCancelled);
        checkCancelled();

        const fingerprint = computeSceneFingerprint(context, n, workFrame);
        job.progress = 'Planning…';
        context.requestAttributes();

        const core = context.core;
        const needsOutline = params.Mode === 'Cut' && params['Line width'] > 0 && captured.contours.some(c => c.closed);
        if (needsOutline && core?.geometry?.worker) {
          outlineAdapter = createOutlineAdapter(core, job);
        }

        const planned = await planCutContours({
          areaW: workFrame.areaW,
          areaH: workFrame.areaH,
          params,
          contours: captured.contours,
          avoidRegions: captured.avoidRegions,
          noCutRegions: captured.noCutRegions,
          offsetLoop: outlineAdapter ? (src, d, isHole) => outlineAdapter.offset(src, d, isHole) : null,
          checkCancelled
        });
        checkCancelled();

        // Recheck freshness before atomic publication
        const afterFrame = extractWorkFrame(context.document.world(hash));
        const afterSig = afterFrame.valid ? computeSceneFingerprint(context, n, afterFrame) : 'invalid';
        if (afterSig !== fingerprint) {
          throw failure('CUT_STALE', 'Scene or Cut settings changed during generation.');
        }

        const allWarnings = [...workFrame.warnings, ...captured.captureWarnings, ...planned.warnings];
        const allIssueHashes = new Set([...captured.captureIssueHashes, ...planned.sourceIssueHashes]);
        const packed = packPathVertices(planned.segments, workFrame);

        st.result = {
          jobId,
          code: planned.code,
          lines: planned.code.split('\n'),
          lineCount: planned.lineCount,
          lineStates: planned.lineStates,
          segments: planned.segments,
          metrics: planned.metrics,
          contourCount: planned.contourCount,
          avoidCount: planned.avoidCount,
          noCutCount: planned.noCutCount,
          warnings: allWarnings,
          sourceIssues: planned.sourceIssues,
          workFrame,
          params: { ...params },
          areaMm: [workFrame.areaW, workFrame.areaH],
          signature: fingerprint
        };
        st.cursor = planned.lineCount;
        st.vertexData = packed.data;
        st.vertexCount = packed.count;
        st.revision = ++gpuRevCounter;
        st.signature = fingerprint;
        st.sourceIssueHashes = allIssueHashes;
        st.state = 'complete';
        st.error = null;
        job.state = 'complete';
        job.progress = '';
        st.job = null;
        context.requestAttributes();
        context.requestDraw();
      } catch (e) {
        if (e?.code === 'CUT_CANCELLED') {
          job.state = 'cancelled';
        } else {
          job.state = 'error';
          if (st.job === job) {
            st.job = null;
            st.state = 'error';
            st.error = { code: e?.code || 'CUT_FAILED', message: String(e?.message || e) };
          }
        }
        context.requestAttributes();
        context.requestDraw();
      } finally {
        outlineAdapter?.dispose();
        if (st.job === job) st.job = null;
      }
    })();

    return { jobId, state: 'running' };
  };

  const setCursor = (hash, value) => {
    owner(hash);
    const st = getState(hash);
    if (!st.result) return { cursor: 0, lineCount: 0, head: getHeadState(st) };
    const next = Math.max(0, Math.min(st.result.lineCount, Math.round(Number(value) || 0)));
    if (next !== st.cursor) {
      st.cursor = next;
      context.requestDraw();
      context.requestAttributes();
    }
    return { cursor: st.cursor, lineCount: st.result.lineCount, head: getHeadState(st) };
  };

  const status = hash => {
    const n = owner(hash);
    defaults.observe();
    checkFreshness(hash);
    const st = getState(hash);
    const wf = extractWorkFrame(context.document.world(hash));
    const hasResult = st.state === 'complete' && !!st.result;
    return {
      stage: 'ready',
      authoringOnly: false,
      state: st.state,
      generationAvailable: true,
      geometryEvaluated: hasResult,
      resultAvailable: hasResult,
      job: st.job ? { id: st.job.id, state: st.job.state, progress: st.job.progress } : null,
      viewport: axes.status(),
      parameters: { ...n.params },
      defaults: defaults.status(),
      plane: {
        axes: ['X', 'Z'],
        normal: [0, -1, 0],
        origin: [0, 0, 0],
        min: [0, 0, 0],
        max: [1000, 0, 1000],
        physicalMm: wf.valid ? [wf.areaW, wf.areaH] : null,
        valid: wf.valid,
        units: 'mm',
        dimensions: 'native transform scale',
        gcodeAxes: ['local X', 'local Z']
      },
      tags: {
        cut_avoid: 'Blocks head entry/travel; active cuts clipped and travel routed around',
        cut_no_cut: 'Tool-off bridge region on every pass; active swept width protected'
      },
      summary: hasResult ? {
        contourCount: st.result.contourCount,
        avoidCount: st.result.avoidCount,
        noCutCount: st.result.noCutCount,
        lineCount: st.result.lineCount,
        segmentCount: st.result.segments.length,
        metrics: st.result.metrics,
        warningCount: st.result.warnings.length
      } : null,
      warnings: hasResult ? st.result.warnings : (wf.valid ? wf.warnings : [{ code: wf.code, message: wf.message }]),
      cursor: hasResult ? st.cursor : 0,
      lineCount: hasResult ? st.result.lineCount : 0,
      head: hasResult ? getHeadState(st) : null,
      error: st.error
    };
  };

  const inspectSources = async hash => {
    const n = owner(hash);
    const wf = extractWorkFrame(context.document.world(hash));
    if (!wf.valid) return { valid: false, error: { code: wf.code, message: wf.message }, contours: [], avoidRegions: [], noCutRegions: [] };
    const cap = await captureSceneForCut(context, n, wf, null);
    return {
      valid: true,
      areaMm: [wf.areaW, wf.areaH],
      contours: cap.contours.map(c => ({
        id: c.id,
        sourceHash: c.sourceHash,
        closed: c.closed,
        pointCount: c.points2D.length,
        lengthMm: polylineLength(c.points2D, c.closed)
      })),
      avoidRegions: cap.avoidRegions.map(r => ({ id: r.id, sourceHash: r.sourceHash, vertices: r.outer.length, holes: r.holes.length })),
      noCutRegions: cap.noCutRegions.map(r => ({ id: r.id, sourceHash: r.sourceHash, vertices: r.outer.length, holes: r.holes.length })),
      warnings: [...wf.warnings, ...cap.captureWarnings]
    };
  };

  const readResult = hash => {
    owner(hash);
    checkFreshness(hash);
    const st = getState(hash);
    if (st.state !== 'complete' || !st.result) {
      throw failure('CUT_NO_RESULT', 'No current completed Cut result is available. Run Generate first.');
    }
    const r = st.result;
    return {
      jobId: r.jobId,
      signature: r.signature,
      areaMm: r.areaMm,
      params: r.params,
      code: r.code,
      lineCount: r.lineCount,
      cursor: st.cursor,
      head: getHeadState(st),
      metrics: r.metrics,
      contourCount: r.contourCount,
      avoidCount: r.avoidCount,
      noCutCount: r.noCutCount,
      segmentCount: r.segments.length,
      warnings: r.warnings,
      sourceIssues: r.sourceIssues
    };
  };

  const saveGcode = hash => {
    owner(hash);
    checkFreshness(hash);
    const st = getState(hash);
    if (st.state !== 'complete' || !st.result || !st.result.segments.length || !st.result.code.length) {
      throw failure('CUT_NO_RESULT', 'No current nonempty Cut result is available to save.');
    }
    const name = `frame-cut-${hash.slice(0, 8)}.gcode`;
    const code = st.result.code;
    if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
      const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return { name, bytes: new TextEncoder().encode(code).length, lineCount: st.result.lineCount };
  };

  const tagRole = node => {
    const byId = new Map(context.document.nodes.map(n => [n.id, n]));
    return effectiveCutTags(node, byId);
  };

  context.editor.register({
    created: n => defaults.created(n),
    documentChanged: () => { defaults.schedule(); scheduleFreshnessCheck(); },
    frames: () => { scheduleFreshnessCheck(); },
    restored: () => { defaults.schedule(); scheduleFreshnessCheck(); },
    parameters: (n, changes) => {
      if (n.type !== 'cut') return null;
      validate({ ...n.params, ...changes });
      defaults.schedule();
      scheduleFreshnessCheck();
      return {};
    },
    rowColor: n => {
      if (n.type === 'cut') {
        const st = states.get(n.nativeHash);
        if (st?.state === 'error') return '#ee554b';
        const wf = extractWorkFrame(context.document.world(n.nativeHash));
        if (!wf.valid || wf.sheared) return '#ee554b';
        return null;
      }
      // Best-effort visual feedback: tint source objects that had warnings red
      for (const st of states.values()) {
        if (st.state === 'complete' && st.sourceIssueHashes?.has(n.nativeHash)) return '#ee554b';
      }
      return null;
    },
    surfaceStyle: hash => {
      const n = context.document.nodes.find(x => x.nativeHash === hash);
      if (!n || n.tags?.some(t => t.kind === 'material')) return null;
      const r = tagRole(n);
      if (r.avoid) return { color: [0.95, 0.2, 0.16, 0.35], topmost: true };
      if (r.noCut) return { color: [0.92, 0.65, 0.18, 0.32], topmost: false };
      return null;
    }
  });

  context.operations.register([
    { id: 'status', description: 'Inspect Cut parameters, job state, diagnostics and cursor position without starting generation.', inputSchema: empty, readOnly: true, run: status },
    { id: 'generate', description: 'Asynchronously plan best-effort 2D CW toolpaths, kerf offset, lead-ins, Avoid/No-cut clipping/routing and G0/G1 G-code.', inputSchema: empty, readOnly: false, run: startGenerate },
    { id: 'cancel', description: 'Cancel an active Cut generation job, or report no active job.', inputSchema: empty, readOnly: false, run: hash => { owner(hash); return cancelJob(hash); } },
    { id: 'sources', description: 'Inspect captured planar spline/Extrude contours and Avoid/No-cut regions for this Cut bed.', inputSchema: empty, readOnly: true, run: inspectSources },
    { id: 'result', description: 'Read the current completed G-code text, metrics, warnings and cursor head state.', inputSchema: empty, readOnly: true, run: readResult },
    { id: 'position', description: 'Set the transient G-code line cursor (0..lineCount) for viewport scrubbing without mutating scene history.', inputSchema: { type: 'object', properties: { line: { type: 'integer', minimum: 0 } }, required: ['line'], additionalProperties: false }, readOnly: true, run: (hash, args) => setCursor(hash, args.line) },
    { id: 'save', description: 'Download the current nonempty completed G-code program.', inputSchema: empty, readOnly: true, run: saveGcode }
  ]);

  context.attributes.register(hash => {
    owner(hash);
    const st = getState(hash);
    const running = st.state === 'running' && st.job?.state === 'running';
    const hasResult = st.state === 'complete' && !!st.result;
    const wf = extractWorkFrame(context.document.world(hash));
    const timeText = hasResult ? st.result.metrics.timeText : '';
    const m = hasResult ? st.result.metrics : null;
    const fmtLen = v => Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '0';

    return {
      actions: [
        {
          id: 'generate',
          label: 'Generate',
          cancel: 'cancel',
          busy: running,
          disabled: !wf.valid,
          progress: running ? (st.job?.progress || 'Planning…') : timeText
        },
        {
          id: 'save',
          label: 'Save G-code',
          hidden: !hasResult || !st.result.segments.length,
          disabled: running || !hasResult || !st.result.segments.length
        }
      ],
      numbers: [
        {
          id: 'gcode-position',
          label: 'G-code position',
          visible: hasResult,
          value: hasResult ? st.cursor : 0,
          min: 0,
          max: hasResult ? st.result.lineCount : 0,
          integer: true,
          set: v => setCursor(hash, v)
        }
      ],
      readouts: [
        { id: 'cut-time', label: 'Time', columns: [''], values: hasResult ? [timeText] : null },
        { id: 'cut-length', label: 'Length (mm)', columns: ['Work', 'Travel'], values: hasResult ? [fmtLen(m.activeLengthMm), fmtLen(m.travelLengthMm)] : null },
        { id: 'cut-lines', label: 'Lines', columns: [''], values: hasResult ? [String(st.result.lineCount)] : null }
      ]
    };
  });

  await context.viewport.register({
    renderKind: 'helper',
    pivot: [0, 0, 0],
    bounds: { min: [0, 0, 0], max: [1000, 0, 1000] },
    lines: new Float32Array([0, 0, 0, 1000, 0, 0, 1000, 0, 0, 1000, 0, 1000, 1000, 0, 1000, 0, 0, 1000, 0, 0, 1000, 0, 0, 0]),
    color: [0.65, 0.58, 0.46, 1],
    selectedColor: [0.85, 0.74, 0.53, 1],
    colorFor: (hash, _p, selected) => {
      const st = states.get(hash);
      if (st?.state === 'error') return [0.93, 0.33, 0.29, 1];
      const wf = extractWorkFrame(context.document.world(hash));
      if (!wf.valid) return [0.93, 0.33, 0.29, 1];
      return selected ? [0.85, 0.74, 0.53, 1] : [0.65, 0.58, 0.46, 1];
    },
    settings: (_params, hash) => {
      const st = states.get(hash);
      if (!st || st.state !== 'complete' || !st.result) return [0, 0, 0, 0];
      const h = getHeadState(st);
      return [h.line, h.localX, h.localZ, h.toolOn ? 1 : 0];
    },
    render: axes,
    retire: hash => {
      cancelJob(hash, 'Owner retired');
      axes.retire(hash);
      states.delete(hash);
    },
    shader: 'fn pluginSurface(local:vec3f,normal:vec3f,build:vec3f,settings:vec4f)->vec4f { discard; return vec4f(0.0); }'
  });
}
