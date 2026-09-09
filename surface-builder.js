import { extractCells } from "./cage-cells.mjs";

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = length(a); return n > 1e-12 ? mul(a, 1 / n) : [0, 0, 0]; };
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function cubicPoint(cp, t) {
  const u = 1 - t, u2 = u * u, t2 = t * t;
  return [
    u * u2 * cp[0][0] + 3 * u2 * t * cp[1][0] + 3 * u * t2 * cp[2][0] + t2 * t * cp[3][0],
    u * u2 * cp[0][1] + 3 * u2 * t * cp[1][1] + 3 * u * t2 * cp[2][1] + t2 * t * cp[3][1],
    u * u2 * cp[0][2] + 3 * u2 * t * cp[1][2] + 3 * u * t2 * cp[2][2] + t2 * t * cp[3][2]
  ];
}

function cubicDerivative(cp, t) {
  const u = 1 - t;
  return [
    3 * u * u * (cp[1][0] - cp[0][0]) + 6 * u * t * (cp[2][0] - cp[1][0]) + 3 * t * t * (cp[3][0] - cp[2][0]),
    3 * u * u * (cp[1][1] - cp[0][1]) + 6 * u * t * (cp[2][1] - cp[1][1]) + 3 * t * t * (cp[3][1] - cp[2][1]),
    3 * u * u * (cp[1][2] - cp[0][2]) + 6 * u * t * (cp[2][2] - cp[1][2]) + 3 * t * t * (cp[3][2] - cp[2][2])
  ];
}

function segmentControlPoints(data, sid) {
  const segment = data.segments[sid], a = segment && data.vertices[segment.a], b = segment && data.vertices[segment.b];
  if (!segment || !a || !b) return null;
  return [a.slice(), add(a, segment.ha || [0, 0, 0]), add(b, segment.hb || [0, 0, 0]), b.slice()];
}

function tangent(cp, t) {
  let d = cubicDerivative(cp, t);
  if (length(d) > 1e-10) return unit(d);
  const h = t < 0.5 ? 1e-4 : -1e-4;
  d = sub(cubicPoint(cp, clamp01(t + h)), cubicPoint(cp, clamp01(t - h)));
  return unit(d);
}

function angleBetween(a, b) {
  const la = length(a), lb = length(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  return Math.atan2(length(cross(a, b)), dot(a, b));
}

// The cage approximation is an angle budget. It adds only points already
// requested by the spline approximation; Surface Builder never welds or moves
// these boundary samples.
function approximateSegment(data, sid, angle, cache, sampleSegment) {
  const cached = cache.get(sid);
  if (cached) return cached;
  if (sampleSegment) {
    const existing = sampleSegment(sid) || [];
    if (existing.length >= 2) {
      const result = existing.map((q, index) => ({
        t: Number.isFinite(q.t) ? q.t : index / (existing.length - 1),
        p: (q.position || q.p).slice(),
        tangent: (q.exactTangent || q.tangent || [0, 0, 0]).slice(),
        index
      }));
      cache.set(sid, result);
      return result;
    }
  }
  const cp = segmentControlPoints(data, sid);
  if (!cp) return [];
  const steps = 128, turns = [0];
  let previous = cubicDerivative(cp, 0), total = 0;
  for (let i = 1; i <= steps; i++) {
    const current = cubicDerivative(cp, i / steps);
    total += angleBetween(previous, current);
    turns.push(total);
    previous = current;
  }
  const stepAngle = Math.max(1, Math.min(180, +angle || 10)) * Math.PI / 180;
  const count = Math.max(1, Math.ceil(total / stepAngle));
  const sample = (target) => {
    if (target <= 0) return 0;
    if (target >= total) return 1;
    if (total <= 1e-12) return 1;
    let lo = 0, hi = turns.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (turns[mid] < target) lo = mid; else hi = mid;
    }
    const span = turns[hi] - turns[lo];
    return (lo + (span > 1e-12 ? (target - turns[lo]) / span : 0)) / steps;
  };
  const result = [];
  for (let i = 0; i <= count; i++) {
    const t = i === 0 ? 0 : i === count ? 1 : sample(total * i / count);
    result.push({ t, p: cubicPoint(cp, t), tangent: tangent(cp, t), index: i });
  }
  cache.set(sid, result);
  return result;
}

function orientSegment(data, ref, angle, cache, sampleSegment) {
  const source = approximateSegment(data, String(ref.edge), angle, cache, sampleSegment);
  if (!ref.reversed) return source.map((q) => ({ ...q, p: q.p.slice(), tangent: q.tangent.slice() }));
  return source.slice().reverse().map((q) => ({ ...q, t: 1 - q.t, p: q.p.slice(), tangent: mul(q.tangent, -1), index: source.length - 1 - q.index }));
}

function splineCageInput(data) {
  return {
    nodes: Object.entries(data.vertices || {}).map(([id, p]) => ({ id, p: p.slice() })),
    edges: Object.values(data.segments || {}).map((s) => ({
      id: s.id,
      a: s.a,
      b: s.b,
      // The application stores cubic control-point offsets; cage-cells takes
      // Hermite derivatives and converts them to the same cubic representation.
      ta: mul(s.ha || [0, 0, 0], 3),
      tb: mul(s.hb || [0, 0, 0], -3)
    }))
  };
}

function cornersForSideCount(n) {
  if (n === 3) return [[0, 0], [1, 0], [0, 1]];
  if (n === 4) return [[0, 0], [1, 0], [1, 1], [0, 1]];
  return Array.from({ length: n }, (_, i) => {
    const t = -Math.PI / 2 + TAU * i / n;
    return [(1 + Math.cos(t)) * 0.5, (1 + Math.sin(t)) * 0.5];
  });
}

function orient2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pathLength(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) total += length(sub(samples[i].p, samples[i - 1].p));
  return total;
}

function interpolatePath(samples, fraction) {
  if (samples.length === 0) return [0, 0, 0];
  if (samples.length === 1) return samples[0].p.slice();
  const target = clamp01(fraction) * pathLength(samples);
  let travelled = 0;
  for (let i = 1; i < samples.length; i++) {
    const span = length(sub(samples[i].p, samples[i - 1].p));
    if (travelled + span >= target) return lerp(samples[i - 1].p, samples[i].p, span > 1e-12 ? (target - travelled) / span : 0);
    travelled += span;
  }
  return samples.at(-1).p.slice();
}

function normalizedFractions(samples) {
  const fractions = [0];
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += length(sub(samples[i].p, samples[i - 1].p));
    fractions.push(total);
  }
  return fractions.map((value) => total > 1e-12 ? value / total : value / Math.max(1, samples.length - 1));
}

function polygonCentroid(points) {
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], q = a[0] * b[1] - b[0] * a[1];
    area += q;
    x += (a[0] + b[0]) * q;
    y += (a[1] + b[1]) * q;
  }
  if (Math.abs(area) < 1e-12) return points.reduce((p, q) => [p[0] + q[0] / points.length, p[1] + q[1] / points.length], [0, 0]);
  return [x / (3 * area), y / (3 * area)];
}

function average(points) {
  if (!points.length) return [0, 0, 0];
  return points.reduce((sum, p) => add(sum, p), [0, 0, 0]).map((x) => x / points.length);
}

function makeLoop(data, refs, angle, sampleCache, pointIndex, positions, sampleSegment) {
  const samples = [], keys = [], sideRanges = [];
  for (const ref of refs) {
    const segment = data.segments[String(ref.edge)];
    if (!segment) throw new Error("Surface Builder: missing segment " + ref.edge);
    const oriented = orientSegment(data, ref, angle, sampleCache, sampleSegment);
    const from = ref.reversed ? segment.b : segment.a;
    const to = ref.reversed ? segment.a : segment.b;
    // Keep the shared corner as the first sample of every side. It is stored
    // only once in the global loop, but each side evaluator needs that endpoint.
    const sideSamples = [], sideKeys = [];
    for (let i = 0; i < oriented.length; i++) {
      const sample = oriented[i], isStart = i === 0, isEnd = i === oriented.length - 1;
      const key = isStart ? "v:" + from : isEnd ? "v:" + to : "s:" + ref.edge + ":" + sample.index;
      let id = pointIndex.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        pointIndex.set(key, id);
        positions.push(sample.p[0], sample.p[1], sample.p[2]);
      }
      sideSamples.push(sample);
      sideKeys.push(id);
      if (!(samples.length && i === 0)) {
        samples.push(sample);
        keys.push(id);
      }
    }
    sideRanges.push({ samples: sideSamples, keys: sideKeys, refs: [ref] });
  }
  if (samples.length > 1 && length(sub(samples[0].p, samples.at(-1).p)) < 1e-8) samples.pop(), keys.pop();
  if (samples.length < 3) throw new Error("Surface Builder: cell boundary is degenerate");
  return { samples, keys, sideRanges, fractions: normalizedFractions(samples) };
}

function sideCurve(loop, range) {
  const samples = range.samples;
  const distances = [0];
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += length(sub(samples[i].p, samples[i - 1].p));
    distances.push(total);
  }
  return {
    samples,
    eval: (t) => {
      if (samples.length === 1) return samples[0].p.slice();
      const target = clamp01(t) * total;
      for (let i = 1; i < samples.length; i++) {
        if (distances[i] >= target) {
          const span = distances[i] - distances[i - 1];
          return lerp(samples[i - 1].p, samples[i].p, span > 1e-12 ? (target - distances[i - 1]) / span : 0);
        }
      }
      return samples.at(-1).p.slice();
    }
  };
}

function coonsQuad(curves, uv) {
  const [u, v] = uv, a = curves[0].eval(0), b = curves[0].eval(1), c = curves[1].eval(1), d = curves[3].eval(0);
  const bottom = curves[0].eval(u), right = curves[1].eval(v), top = curves[2].eval(1 - u), left = curves[3].eval(1 - v);
  const blend = add(add(mul(bottom, 1 - v), mul(right, u)), add(mul(top, v), mul(left, 1 - u)));
  const bilinear = add(add(mul(a, (1 - u) * (1 - v)), mul(b, u * (1 - v))), add(mul(c, u * v), mul(d, (1 - u) * v)));
  return sub(blend, bilinear);
}

function patchCenter(loop, n, ranges) {
  const curves = ranges.map((range) => sideCurve(loop, range));
  if (n === 4) return coonsQuad(curves, [0.5, 0.5]);
  return average(curves.map((curve) => curve.eval(0.5)));
}

function addOrientedTriangle(indices, uv, a, b, c) {
  const get = (id) => uv instanceof Map ? uv.get(id) : uv[id];
  if (orient2(get(a), get(b), get(c)) > 0) indices.push(a, b, c);
  else indices.push(a, c, b);
}

function buildSingleLoopPatch(loop, n, positions, indices, uv) {
  const corners = cornersForSideCount(n);
  const centerUV = polygonCentroid(corners);
  const center = patchCenter(loop, n, loop.sideRanges);
  const centerId = positions.length / 3;
  positions.push(center[0], center[1], center[2]);
  uv[centerId] = centerUV;
  const localUV = new Map([[centerId, centerUV]]);
  const boundaryUV = [];
  for (let side = 0; side < n; side++) {
    const range = loop.sideRanges[side], a = corners[side], b = corners[(side + 1) % n], span = Math.max(1, range.keys.length - 1);
    for (let i = 0; i < range.keys.length; i++) {
      const t = i / span;
      boundaryUV.push({ id: range.keys[i], uv: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
    }
  }
  const seen = new Set();
  for (const item of boundaryUV) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    uv[item.id] = item.uv;
    localUV.set(item.id, item.uv);
  }
  for (let i = 0; i < loop.keys.length; i++) {
    const a = loop.keys[i], b = loop.keys[(i + 1) % loop.keys.length];
    addOrientedTriangle(indices, localUV, a, b, centerId);
  }
  return { vertices: loop.keys.length + 1, centerId };
}

function ringAlignment(outer, inner) {
  const n = outer.keys.length, m = inner.keys.length;
  if (!n || !m) return inner;
  const center = average(outer.samples.concat(inner.samples).map((q) => q.p));
  const candidates = [];
  const variants = [inner.keys, inner.keys.slice().reverse()];
  for (let reverse = 0; reverse < variants.length; reverse++) {
    const ids = variants[reverse], points = reverse ? inner.samples.slice().reverse() : inner.samples.slice();
    const limit = Math.min(m, n);
    for (let shift = 0; shift < m; shift++) {
      let score = 0;
      for (let i = 0; i < limit; i++) {
        const a = unit(sub(outer.samples[Math.floor(i * n / limit)].p, center));
        const b = unit(sub(points[(Math.floor(i * m / limit) + shift) % m].p, center));
        score += 1 - dot(a, b);
      }
      candidates.push({ score, ids, points, shift });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  const ids = [], points = [];
  for (let i = 0; i < best.ids.length; i++) {
    const at = (i + best.shift) % best.ids.length;
    ids.push(best.ids[at]);
    points.push(best.points[at]);
  }
  return { ...inner, keys: ids, samples: points };
}

function addRingStrip(outer, inner, positions, indices, uv) {
  inner = ringAlignment(outer, inner);
  const n = outer.keys.length, m = inner.keys.length;
  if (n !== m) {
    // This path is only a safety fallback for mixed approximations. It keeps
    // every original boundary point and advances the longer chain without
    // inserting a boundary vertex.
    const count = n + m, outerAt = (i) => outer.keys[i % n], innerAt = (i) => inner.keys[i % m];
    for (let i = 0; i < count; i++) {
      const a = outerAt(Math.floor(i * n / count)), b = outerAt(Math.floor((i + 1) * n / count));
      const c = innerAt(Math.floor((i + 1) * m / count)), d = innerAt(Math.floor(i * m / count));
      if (a !== b && c !== d) indices.push(a, b, c, a, c, d);
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const a = outer.keys[i], b = outer.keys[(i + 1) % n], c = inner.keys[(i + 1) % m], d = inner.keys[i];
    indices.push(a, b, c, a, c, d);
  }
}

function addCapLoopUV(loop, uv) {
  const points = loop.samples.map((q) => q.p), origin = average(points);
  let normal = [0, 0, 0];
  for (let i = 1; i + 1 < points.length && length(normal) < 1e-9; i++) normal = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
  normal = unit(normal);
  const axis = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(axis, normal)), v = cross(normal, u);
  for (let i = 0; i < loop.keys.length; i++) {
    const p = sub(points[i], origin);
    uv[loop.keys[i]] = [dot(p, u), dot(p, v)];
  }
}

function buildFill(data, fill, angle, sampleCache, pointIndex, positions, indices, uv, sampleSegment) {
  if (!fill.loops?.length) return { sides: 0, loops: 0, boundary: 0, interior: 0 };
  const loops = fill.loops.map((loop) => makeLoop(data, loop, angle, sampleCache, pointIndex, positions, sampleSegment));
  if (loops.length > 1) {
    addCapLoopUV(loops[0], uv);
    addCapLoopUV(loops[1], uv);
    addRingStrip(loops[0], loops[1], positions, indices, uv);
    return { sides: loops.reduce((n, loop) => n + loop.keys.length, 0), loops: loops.length, boundary: loops.reduce((n, loop) => n + loop.keys.length, 0), interior: 0 };
  }
  const loop = loops[0], n = fill.sides || loop.sideRanges.length;
  if (n < 3 || n > 6) {
    addCapLoopUV(loop, uv);
    const center = average(loop.samples.map((q) => q.p)), centerId = positions.length / 3;
    positions.push(center[0], center[1], center[2]);
    uv[centerId] = [0, 0];
    for (let i = 0; i < loop.keys.length; i++) indices.push(loop.keys[i], loop.keys[(i + 1) % loop.keys.length], centerId);
    return { sides: n, loops: 1, boundary: loop.keys.length, interior: 1 };
  }
  const before = positions.length / 3;
  buildSingleLoopPatch(loop, n, positions, indices, uv);
  return { sides: n, loops: 1, boundary: loop.keys.length, interior: positions.length / 3 - before };
}

export function buildSplineSurface(data, options = {}) {
  const started = performance.now();
  const primitiveType = options.primitiveType || "spline";
  const angle = Math.max(1, Math.min(180, Math.round(+options.angle || +data?.approximation?.angle || 10)));
  if (!data?.vertices || !data?.segments) throw new Error("Surface Builder: invalid spline cage");
  const cage = splineCageInput(data);
  const cells = extractCells(cage, {
    maxSides: 6,
    maxCandidateSides: primitiveType === "sphere" ? 6 : 12,
    maxCycleVisits: 500000,
    maxSearchNodes: 200000,
    spatialOnly: primitiveType === "sphere"
  });
  if (!cells.fills?.length) throw new Error("Surface Builder: cage cells unresolved (" + cells.status + ")");
  const positions = [], indices = [], uv = [], pointIndex = new Map(), sampleCache = new Map(), fillReports = [];
  for (const fill of cells.fills) fillReports.push(buildFill(data, fill, angle, sampleCache, pointIndex, positions, indices, uv, options.sampleSegment));
  if (!indices.length) throw new Error("Surface Builder: no triangles generated");
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    cells: cells.fills,
    uv,
    report: {
      builder: "surface-unified-r6e91",
      adapter: "spline-cage",
      status: cells.status,
      closed: cells.status === "closed-candidate",
      patchCells: cells.fills.length,
      boundarySamples: pointIndex.size,
      interiorVertices: positions.length / 3 - pointIndex.size,
      triangles: indices.length / 3,
      loops: cells.fills.reduce((n, fill) => n + fill.loops.length, 0),
      fillReports,
      topologyDiagnostics: cells.diagnostics,
      buildMilliseconds: performance.now() - started
    }
  };
}

export { extractCells };
