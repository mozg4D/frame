import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULTS,
  signedArea2D,
  ensureCW,
  extractWorkFrame,
  extractMeshFootprint2D,
  clipPolylineToAllowed,
  planCutContours,
  pointInRegion2D,
  segmentDistanceToRegion2D
} from '../plugin.js';

const started = performance.now();

// Load real FrameSplineKernel + FrameGeometryKernel from index.html so kerf offset
// tests exercise the exact shared Outline implementation!
const html = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const extractScript = id => {
  const open = `<script id="${id}" type="text/plain">`;
  const a = html.indexOf(open);
  assert.ok(a >= 0, 'Missing script ' + id);
  const b = html.indexOf('</script>', a);
  return html.slice(a + open.length, b);
};
const cellLoopStart = html.indexOf('function frameCellLoops(');
const cellLoopEnd = html.indexOf('\n', cellLoopStart);
const frameCellLoopsSrc = html.slice(cellLoopStart, cellLoopEnd);

const K = new Function(extractScript('frame-spline-kernel') + '; return FrameSplineKernel();')();
const G = new Function('K', frameCellLoopsSrc + '\n' + extractScript('frame-geometry-kernel') + '; return FrameGeometryKernel(K);')(K);

function makeRectSplineData(x0, z0, x1, z1) {
  const d = K.createSplineData({ angle: 10 });
  const q = K.addSplineSequence(d, true);
  const pts = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]];
  const vs = pts.map(p => K.addSplineVertex(d, p));
  for (let i = 0; i < 4; i++) K.addSplineSegment(d, q, vs[i], vs[(i + 1) % 4], [0, 0, 0], [0, 0, 0]);
  return d;
}

async function sharedOutlineOffset(src, signedDist, isHole) {
  if (!src.splineData2D) return { loops: [src.points] };
  const segIds = Object.keys(src.splineData2D.segments);
  const runOnce = dist => {
    const res = G.outline(src.splineData2D, segIds, { distance: dist, normal: [0, 1, 0] });
    const loops = [];
    for (const comp of res.generated.components) {
      const pts = [];
      for (let i = 0; i < comp.segments.length; i++) {
        const raw = K.sampleSplineSegment(res.data, comp.segments[i]);
        for (let j = i === 0 ? 0 : 1; j < raw.length; j++) pts.push([raw[j].position[0], raw[j].position[2]]);
      }
      if (pts.length >= 3) loops.push(pts);
    }
    return loops;
  };
  let loops = runOnce(signedDist);
  if (!loops.length) return isHole ? { loops: [], collapsed: true } : { loops: [src.points], error: 'empty' };
  const totalArea = loops.reduce((s, l) => s + Math.abs(signedArea2D(l)), 0);
  const wantLarger = !isHole;
  if ((wantLarger && totalArea + 1e-4 < src.absArea) || (!wantLarger && totalArea > src.absArea + 1e-4)) {
    const flipped = runOnce(-signedDist);
    if (flipped.length) loops = flipped;
  }
  return { loops };
}

function parseGcodeMoves(code) {
  const moves = [];
  let x = 0, y = 0, toolOn = false;
  for (const line of code.split('\n')) {
    const t = line.trim();
    if (t === 'M3') { toolOn = true; continue; }
    if (t === 'M5') { toolOn = false; continue; }
    const m = /^(G0|G1)\s+X(-?\d+(?:\.\d+)?)\s+Y(-?\d+(?:\.\d+)?)/.exec(t);
    if (m) {
      const nx = +m[2], ny = +m[3];
      moves.push({ cmd: m[1], from: [x, y], to: [nx, ny], toolOn });
      x = nx; y = ny;
    }
  }
  return moves;
}

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };

// 1. CW orientation & Work Frame scaling/shear
await check('CW orientation from head side -Y has negative signed area', () => {
  const ccw = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.ok(signedArea2D(ccw) > 0);
  const cw = ensureCW(ccw);
  assert.ok(signedArea2D(cw) < 0);
});

await check('Work frame scales bed size without shearing error and orthogonalizes sheared frames best-effort', () => {
  const scaled = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 10, 20, 30, 1];
  const wf = extractWorkFrame(scaled);
  assert.equal(wf.valid, true);
  assert.equal(wf.areaW, 2000);
  assert.equal(wf.areaH, 500);
  assert.equal(wf.warnings.length, 0);

  const sheared = [1, 0, 0, 0, 0, 1, 0, 0, 0.3, 0, 1, 0, 0, 0, 0, 1];
  const swf = extractWorkFrame(sheared);
  assert.equal(swf.valid, true);
  assert.equal(swf.sheared, true);
  assert.ok(swf.warnings.some(w => w.code === 'SHEARED_FRAME'));

  const zero = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.equal(extractWorkFrame(zero).valid, false);
});

// 2. Kerf compensation + Hole-before-Outer + Continuous Multi-pass + Always CW + Pure G0/G1
await check('Closed Cut offsets outer outward and hole inward via shared FrameGeometryKernel, cuts hole before outer CW', async () => {
  const outerPts = [[100, 100], [200, 100], [200, 200], [100, 200]]; // 100x100
  const holePts = [[130, 130], [170, 130], [170, 170], [130, 170]];  // 40x40 inside outer
  const params = {
    ...DEFAULTS,
    Mode: 'Cut',
    Speed: 1200,
    Passes: 3,
    'Line width': 2.0, // halfWidth = 1.0 mm -> outer 102x102, hole 38x38
    'Lead-in': 3.0,
    'Start G-code': '; café 日本語\n',
    'Tool on G-code': 'M3',
    'Tool off G-code': 'M5',
    'Finish G-code': 'M2'
  };
  const plan = await planCutContours({
    areaW: 1000, areaH: 1000, params,
    contours: [
      { id: 'outer', sourceHash: 'a', closed: true, points2D: outerPts, splineData2D: makeRectSplineData(100, 100, 200, 200) },
      { id: 'hole', sourceHash: 'b', closed: true, points2D: holePts, splineData2D: makeRectSplineData(130, 130, 170, 170) }
    ],
    avoidRegions: [],
    noCutRegions: [],
    offsetLoop: sharedOutlineOffset
  });

  assert.ok(!/\bG0?[23]\b/.test(plan.code), 'Must not emit G2/G3 arcs');
  assert.ok(plan.code.includes('; café 日本語'), 'Must preserve Unicode Start block');
  assert.equal(plan.code.split('\n').length, plan.lineCount);
  assert.equal(plan.lineStates.length, plan.lineCount);

  // Exactly 2 Tool-on / Tool-off pairs because continuous multi-pass runs all 3 passes per closed loop!
  const lines = plan.code.split('\n');
  assert.equal(lines.filter(l => l === 'M3').length, 2, 'Continuous multi-pass uses one Tool on per closed loop');
  assert.equal(lines.filter(l => l === 'M5').length, 2);

  // Extract first and second cut contours from G1 segments
  const cutGroups = [];
  let cur = [];
  for (const s of plan.segments) {
    if (s.kind === 'cut') cur.push(s);
    else if (cur.length) { cutGroups.push(cur); cur = []; }
  }
  if (cur.length) cutGroups.push(cur);
  assert.equal(cutGroups.length, 2);

  // First group MUST be the hole (38x38 -> x in [131, 169], 3 passes = 3*4*38 = 456 mm)!
  const holeSegs = cutGroups[0];
  const outerSegs = cutGroups[1];
  const xs0 = holeSegs.flatMap(s => [s.from[0], s.to[0]]);
  const xs1 = outerSegs.flatMap(s => [s.from[0], s.to[0]]);
  assert.ok(Math.abs((Math.max(...xs0) - Math.min(...xs0)) - 38) < 0.05, 'Hole shrunk inward by Line width');
  assert.ok(Math.abs((Math.max(...xs1) - Math.min(...xs1)) - 102) < 0.05, 'Outer expanded outward by Line width');

  // Verify BOTH hole and outer are CW (signed area < 0)
  const firstPassHole = holeSegs.slice(0, Math.round(holeSegs.length / 3)).map(s => s.from);
  const firstPassOuter = outerSegs.slice(0, Math.round(outerSegs.length / 3)).map(s => s.from);
  assert.ok(signedArea2D(firstPassHole) < 0, 'Hole must be CW');
  assert.ok(signedArea2D(firstPassOuter) < 0, 'Outer must be CW');

  // Verify Lead-in segments exist for both loops and start at distance Lead-in from entry
  const leadGroups = [];
  let cl = [];
  for (const s of plan.segments) {
    if (s.kind === 'lead-in') cl.push(s);
    else if (cl.length) { leadGroups.push(cl); cl = []; }
  }
  if (cl.length) leadGroups.push(cl);
  assert.equal(leadGroups.length, 2);
  for (const lg of leadGroups) {
    const d = Math.hypot(lg[0].from[0] - lg.at(-1).to[0], lg[0].from[1] - lg.at(-1).to[1]);
    assert.ok(Math.abs(d - 3.0) < 0.05, `Lead-in start distance should be 3mm, got ${d}`);
  }
});

// 3. Mark mode: uncompensated, CW, no lead-in
await check('Mark mode stays uncompensated, CW, and omits Lead-in', async () => {
  const plan = await planCutContours({
    areaW: 1000, areaH: 1000,
    params: { ...DEFAULTS, Mode: 'Mark', 'Line width': 2.0, 'Lead-in': 5.0 },
    contours: [{ id: 'm1', sourceHash: 'm', closed: true, points2D: [[100, 100], [200, 100], [200, 200], [100, 200]] }],
    avoidRegions: [], noCutRegions: [], offsetLoop: sharedOutlineOffset
  });
  assert.equal(plan.segments.filter(s => s.kind === 'lead-in').length, 0);
  const markSegs = plan.segments.filter(s => s.kind === 'mark');
  assert.equal(markSegs.length, 4, 'Straight square Mark stays exactly 4 G1 segments (no extra tessellation)');
  const xs = markSegs.flatMap(s => [s.from[0], s.to[0]]);
  assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - 100) < 1e-4, 'Mark must stay uncompensated');
  assert.ok(signedArea2D(markSegs.map(s => s.from)) < 0, 'Closed Mark must be CW');
});

// 4. Best-effort Avoid clipping + Visibility-graph Avoid detour routing
await check('Avoid clips overlapping cuts and detours G0 travel cleanly without rejecting', async () => {
  const avoidWall = {
    id: 'av1', kind: 'Avoid', sourceHash: 'clamp',
    outer: [[250, 0], [300, 0], [300, 400], [250, 400]], holes: []
  };
  const plan = await planCutContours({
    areaW: 1000, areaH: 1000,
    params: { ...DEFAULTS, Mode: 'Cut', 'Line width': 0.2, 'Lead-in': 0, 'Tool on G-code': 'M3', 'Tool off G-code': 'M5' },
    contours: [
      { id: 'left', sourceHash: 's1', closed: true, points2D: [[50, 50], [150, 50], [150, 150], [50, 150]] },
      { id: 'right', sourceHash: 's2', closed: true, points2D: [[400, 50], [500, 50], [500, 150], [400, 150]] },
      // Overlapping contour right across the Avoid wall! Best effort clips it without failing!
      { id: 'cross', sourceHash: 's3', closed: false, points2D: [[200, 200], [350, 200]] }
    ],
    avoidRegions: [avoidWall],
    noCutRegions: []
  });

  assert.equal(plan.unsafeTravels, 0, 'All travels must detour cleanly around Avoid wall');
  assert.ok(plan.sourceIssueHashes.has('s3'), 'Overlapping source flagged for red tint');
  // Every single segment (BOTH G0 travel AND G1 cut!) must stay outside Avoid!
  for (const seg of plan.segments) {
    const d = segmentDistanceToRegion2D(seg.from, seg.to, avoidWall, 0.1);
    assert.ok(d > 1e-4, `Segment (${seg.kind}) must not enter Avoid, dist=${d}`);
  }
  // Crossing line must still cut its surviving left [200..250] and right [300..350] halves!
  const crossCuts = plan.segments.filter(s => s.kind === 'cut' && Math.abs(s.from[1] - 200) < 1e-3 && Math.abs(s.to[1] - 200) < 1e-3);
  assert.equal(crossCuts.length, 2, 'Overlapping line must retain both surviving halves outside Avoid');
});

// 5. No-cut bridge splits closed loop with swept half-width protection and merges wrap-around seam
await check('No-cut holding bridge splits closed loop with width/2 clearance and merges seam into 1 chain', async () => {
  const noCutTab = {
    id: 'nc1', kind: 'No-cut', sourceHash: 'tab',
    outer: [[140, 190], [160, 190], [160, 210], [140, 210]], holes: []
  };
  const plan = await planCutContours({
    areaW: 1000, areaH: 1000,
    params: { ...DEFAULTS, Mode: 'Cut', 'Line width': 2.0, 'Lead-in': 0, 'Tool on G-code': 'M3', 'Tool off G-code': 'M5' },
    contours: [
      { id: 'sq', sourceHash: 'sq', closed: true, points2D: [[100, 100], [200, 100], [200, 200], [100, 200]] }
    ],
    avoidRegions: [],
    noCutRegions: [noCutTab]
  });

  // One single unbroken chain around the other 3.8 sides (merged wrap-around!) -> only 1 M3 / M5!
  const lines = plan.code.split('\n');
  assert.equal(lines.filter(l => l === 'M3').length, 1, 'Wrap-around seam should merge into 1 continuous chain');
  for (const seg of plan.segments) {
    if (seg.kind === 'cut') {
      const d = segmentDistanceToRegion2D(seg.from, seg.to, noCutTab, 2.0);
      assert.ok(d >= 1.0 - 1e-3, `Active cut must respect No-cut swept radius 1.0mm, got ${d}`);
    }
  }
});

// 6. Best-effort unsafe Lead-in (tightly enclosed tiny box still succeeds without throwing!)
await check('Best-effort Lead-in succeeds even when surrounded tightly with no clear lead-in room', async () => {
  // Tiny 4x4 hole with huge 20mm Lead-in requested -> cannot fit safely, must fall back without failing!
  const plan = await planCutContours({
    areaW: 1000, areaH: 1000,
    params: { ...DEFAULTS, Mode: 'Cut', 'Line width': 0, 'Lead-in': 20 },
    contours: [
      { id: 'outer', sourceHash: 'o', closed: true, points2D: [[10, 10], [50, 10], [50, 50], [10, 50]] },
      { id: 'tinyHole', sourceHash: 'h', closed: true, points2D: [[28, 28], [32, 28], [32, 32], [28, 32]] }
    ],
    avoidRegions: [], noCutRegions: []
  });
  assert.equal(plan.contourCount, 2);
  assert.ok(plan.warnings.some(w => w.code === 'LEAD_IN_UNSAFE'), 'Should record LEAD_IN_UNSAFE warning');
  assert.ok(plan.sourceIssueHashes.has('h'), 'Tight hole flagged for red tint');
  assert.ok(plan.segments.filter(s => s.kind === 'cut').length >= 8, 'Both contours still cut cleanly');
});

// 7. Smart route optimizer reduces air travel significantly vs naive order
await check('Smart route optimizer significantly reduces travel length on scrambled grid', async () => {
  const pts = [];
  // Scrambled 3x3 grid of squares
  const coords = [[0, 0], [2, 2], [0, 2], [2, 0], [1, 1], [2, 1], [0, 1], [1, 2], [1, 0]];
  coords.forEach(([gx, gz], idx) => {
    const x = 50 + gx * 300, z = 50 + gz * 300;
    pts.push({ id: 'p' + idx, sourceHash: 's' + idx, closed: true, points2D: [[x, z], [x + 40, z], [x + 40, z + 40], [x, z + 40]] });
  });
  const plan = await planCutContours({
    areaW: 1000, areaH: 1000,
    params: { ...DEFAULTS, Mode: 'Mark', 'Line width': 0, 'Lead-in': 0 },
    contours: pts, avoidRegions: [], noCutRegions: []
  });
  // Naive scrambled travel is > 4000mm; optimal 3x3 snake traversal is ~2200-2500mm
  assert.ok(plan.metrics.travelLengthMm < 2700, `Optimized travel should be < 2700mm, got ${plan.metrics.travelLengthMm.toFixed(1)}`);
});

// 8. 3D mesh footprint extraction for Avoid/No-cut cubes
await check('3D cube mesh extracts exact 2D rectangle footprint for Avoid and No-cut', () => {
  // Unit cube [0,100]^3 (8 verts, 12 tris)
  const v = new Float32Array([
    0,0,0, 100,0,0, 100,0,100, 0,0,100,
    0,100,0, 100,100,0, 100,100,100, 0,100,100
  ]);
  const idx = new Uint32Array([
    0,1,2, 0,2,3, // bottom (-Y)
    4,6,5, 4,7,6, // top (+Y)
    0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0
  ]);
  const wf = extractWorkFrame([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const mat = [1,0,0,0, 0,1,0,0, 0,0,1,0, 200,0,300,1]; // shifted to X=[200..300], Z=[300..400]
  for (const kind of ['Avoid', 'No-cut']) {
    const regs = extractMeshFootprint2D(v, idx, mat, wf, kind, 'cube1', K.FrameOutline?.arrangement);
    assert.equal(regs.length, 1);
    assert.equal(regs[0].outer.length, 4);
    assert.ok(Math.abs(Math.abs(signedArea2D(regs[0].outer)) - 10000) < 1e-2);
    assert.equal(pointInRegion2D([250, 350], regs[0]), 1);
    assert.equal(pointInRegion2D([150, 350], regs[0]), -1);
  }
});

const ms = performance.now() - started;
console.log(JSON.stringify({ pass: true, checks, count: checks.length, ms: Math.round(ms * 10) / 10 }));
