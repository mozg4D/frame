import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  activate, MATERIALS, ROLE, validateParameters,
  computeManualDomain, computeAutoDomain,
  regionWrench, buildMechanicalModel, solveHex8CPU, evaluateElements,
  extractOptimizedMesh, collectAnimationFrames
} from '../plugin.js';
import {isHardwareAdapter, isDecodedNativeIcon, hasBoundedFrameTimings} from './browser-gates.mjs';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
const core = await readFile(new URL('index.html', root), 'utf8');

function packBits(count, fn) {
  const arr = new Uint32Array(Math.ceil(count / 32));
  for (let i = 0; i < count; i++) if (fn(i)) arr[i >> 5] |= 1 << (i & 31);
  return arr;
}

test('manifest declares all five Structural tags, Auto size, fixed Voxel size and fieldless Optimize Space', async () => {
  assert.equal(manifest.id, 'structural');
  assert.deepEqual(manifest.objects.map(o => o.type), ['structural']);
  assert.deepEqual(Object.keys(manifest.objects[0].fields), ['Auto size', 'Voxel size', 'Material (%)']);
  assert.equal(manifest.objects[0].fields['Auto size'], false);
  assert.deepEqual(manifest.tags.map(t => t.kind), [
    'structural_material', 'structural_fixture', 'structural_force',
    'structural_optimize_space', 'structural_preserve'
  ]);
  const matTag = manifest.tags.find(t => t.kind === 'structural_material');
  const forceTag = manifest.tags.find(t => t.kind === 'structural_force');
  const optTag = manifest.tags.find(t => t.kind === 'structural_optimize_space');
  assert.equal(matTag.inherit, 'nearest');
  assert.deepEqual(matTag.fields.Material, Object.keys(MATERIALS));
  assert.equal(forceTag.multiple, true);
  assert.equal(forceTag.inherit, 'additive');
  assert.equal(forceTag.vectors.length, 2);
  assert.equal(optTag.fields, undefined, 'Optimize Space must not own a material field');
  const catalogue = JSON.parse(await readFile(new URL('plugins/index.json', root), 'utf8'));
  assert.equal(catalogue.filter(s => s === 'structural/plugin.json').length, 1);
});

test('shared native field validators enforce Structural bounds before mutation', () => {
  const source = core.slice(core.indexOf('const FrameParameters=(()=>{'), core.indexOf('const FrameFields=', core.indexOf('const FrameParameters=(()=>{')));
  const body = source.slice(0, source.indexOf('\n})();') + 6);
  const definitions = {structural: ['Structural', 'plugin:structural', manifest.objects[0].fields]};
  const P = new Function('definitions', 'FramePlugins', 'FrameAuthorData', body + ';return FrameParameters;')(
    definitions, {owner: () => ({manifest})}, {error: m => { throw Error(m); }}
  );
  P.validateOptions(manifest.objects[0].fields, manifest.objects[0].fieldOptions);
  for (const [k, v] of [['Auto size', 1], ['Voxel size', 0], ['Voxel size', NaN], ['Material (%)', 0], ['Material (%)', 101]]) {
    assert.throws(() => P.validate('structural', {[k]: v}));
  }
  for (const patch of [{'Auto size': true}, {'Voxel size': 0.5}, {'Material (%)': 40}]) {
    assert.deepEqual(P.validate('structural', patch), patch);
  }
  validateParameters({'Auto size': false, 'Voxel size': 2, 'Material (%)': 30});
});

test('SI domain contract handles rotation, nonuniform scale, reflection and Auto size', () => {
  const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const d0 = computeManualDomain(I, 5);
  assert.deepEqual(d0.cells, [20, 20, 20]);
  assert.equal(d0.cutBoundaryEnabled, true);
  assert.ok(Math.abs(d0.spacingM[0] - 0.005) < 1e-12);
  // Rotated 90 deg around Y and scaled 2x along X
  const rotScaled = [0,0,-2,0, 0,1,0,0, 1,0,0,0, 10,20,30,1];
  const d1 = computeManualDomain(rotScaled, 10);
  assert.deepEqual(d1.cells, [20, 10, 10]);
  assert.ok(Math.abs(d1.lengthsM[0] - 0.2) < 1e-12);
  // Reflected frame remaps to right-handed basis
  const refl = [1,0,0,0, 0,1,0,0, 0,0,-1,0, 0,0,0,1];
  const d2 = computeManualDomain(refl, 25);
  assert.equal(d2.reflected, true);
  // Sheared frame rejects explicitly
  const sheared = [1,0,0,0, 0.5,1,0,0, 0,0,1,0, 0,0,0,1];
  assert.throws(() => computeManualDomain(sheared, 10), e => e.code === 'SHEARED_DOMAIN');
  // Auto size has cutBoundaryEnabled = false and exact voxel spacing
  const da = computeAutoDomain({min: [0, 0, 0], max: [40, 20, 20]}, 5);
  assert.equal(da.autoSize, true);
  assert.equal(da.cutBoundaryEnabled, false);
  assert.deepEqual(da.cells, [8, 4, 4]);
  assert.ok(Math.abs(da.spacingM[0] - 0.005) < 1e-12);
});

test('independent Float64 axial bar oracle matches exact analytic displacement, stress and Safety factor', () => {
  // Bar: L = 200 mm (X), 40x40 mm cross-section (Y, Z), Steel (E=200 GPa, nu=0.30, yield=250 MPa)
  const L = 0.2, W = 0.04, H = 0.04, A = W * H, F = 10000;
  const domain = computeAutoDomain({min: [0, 0, 0], max: [200, 40, 40]}, 20); // 10 x 2 x 2
  const [nx, ny, nz] = domain.cells;
  const full = packBits(domain.count, () => true);
  // Use cutFaces on x=0 face to clamp x=0 cleanly, plus zero gravity for pure uniaxial check
  const cutFaces = new Uint8Array(domain.count);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) cutFaces[0 + nx * (y + ny * z)] = 1;
  domain.cutBoundaryEnabled = true;

  const model = buildMechanicalModel({
    domain,
    materialBodies: [{hash: 'b1', solid: 0, material: 'Steel', occupancy: full, cutFaces}],
    fixtureMask: null, preserveMask: null, optSpaceMask: null, forceSources: [],
    includeGravity: false
  });
  // Apply pure uniform axial traction F on x = L face, with sliding lateral constraints at x=0 (release Y,Z on x=0 except to prevent rigid motion)
  model.fixedPermanent.fill(0);
  for (let n = 0; n < model.nodeCount; n++) {
    const x = model.nodePositionsM[3*n], y = model.nodePositionsM[3*n+1], z = model.nodePositionsM[3*n+2];
    if (x < 1e-9) model.fixedPermanent[3*n] = 1;
    if (y < 1e-9) model.fixedPermanent[3*n+1] = 1;
    if (z < 1e-9) model.fixedPermanent[3*n+2] = 1;
  }
  const loads = new Float64Array(model.dofs);
  const faceElems = [];
  for (let e = 0; e < model.elemCount; e++) if ((model.elemCell[e] % nx) === nx - 1) faceElems.push(e);
  for (const e of faceElems) for (let a = 0; a < 8; a++) {
    const n = model.elemNodes[8*e + a];
    if (Math.abs(model.nodePositionsM[3*n] - L) < 1e-9) loads[3*n] += F / (4 * faceElems.length);
  }
  const sol = solveHex8CPU(model, {loads, tolerance: 1e-10});
  const ev = evaluateElements(model, sol.u);
  const expectedU = F * L / (MATERIALS.Steel.young * A);
  const expectedStress = F / A;
  const expectedSF = MATERIALS.Steel.yieldStrength / expectedStress;
  // Exact uniaxial elongation on x = L nodes
  let maxErrU = 0;
  for (let n = 0; n < model.nodeCount; n++) {
    if (Math.abs(model.nodePositionsM[3*n] - L) < 1e-9) maxErrU = Math.max(maxErrU, Math.abs(sol.u[3*n] - expectedU) / expectedU);
  }
  assert.ok(maxErrU < 1e-6, `Uniaxial displacement relative error ${maxErrU}`);
  assert.ok(Math.abs(ev.maxStressMPa - expectedStress * 1e-6) / (expectedStress * 1e-6) < 1e-6);
  assert.ok(Math.abs(ev.safetyFactor - expectedSF) / expectedSF < 1e-6);
  assert.ok(Math.abs(ev.massKg - L * A * MATERIALS.Steel.density) < 1e-9);
});

test('conserved Force + Torque mapping preserves exact force and moment about native pivot across resolutions', () => {
  const F = [120, -350, 80], T = [15, -22, 9], pivot = [0.01, -0.02, 0.03];
  for (const pitchMm of [10, 5]) {
    const domain = computeAutoDomain({min: [0, 0, 0], max: [40, 20, 20]}, pitchMm);
    const full = packBits(domain.count, () => true);
    const cutFaces = new Uint8Array(domain.count);
    for (let z = 0; z < domain.cells[2]; z++) for (let y = 0; y < domain.cells[1]; y++) cutFaces[domain.cells[0] * (y + domain.cells[1] * z)] = 1;
    domain.cutBoundaryEnabled = true;
    const model = buildMechanicalModel({
      domain,
      materialBodies: [{hash: 'm', solid: 0, material: 'Steel', occupancy: full, cutFaces}],
      fixtureMask: null, preserveMask: null, optSpaceMask: null, forceSources: [], includeGravity: false
    });
    const elems = Array.from({length: model.elemCount}, (_, i) => i);
    const w = regionWrench(model.nodePositionsM, model.elemNodes, elems, {force: F, torque: T, pivot});
    const sumF = [0, 0, 0], sumM = [0, 0, 0];
    for (const [n, f] of w.loads) {
      const r = [model.nodePositionsM[3*n]-pivot[0], model.nodePositionsM[3*n+1]-pivot[1], model.nodePositionsM[3*n+2]-pivot[2]];
      for (let k = 0; k < 3; k++) sumF[k] += f[k];
      sumM[0] += r[1]*f[2] - r[2]*f[1];
      sumM[1] += r[2]*f[0] - r[0]*f[2];
      sumM[2] += r[0]*f[1] - r[1]*f[0];
    }
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(sumF[k] - F[k]) < 1e-10, `Force conservation pitch=${pitchMm} axis=${k}`);
      assert.ok(Math.abs(sumM[k] - T[k]) < 1e-10, `Moment conservation pitch=${pitchMm} axis=${k}`);
    }
  }
});

test('overlap welds bodies while non-overlapping face touch creates frictionless contact and unconstrained parts reject', () => {
  const domain = computeAutoDomain({min: [0, 0, 0], max: [40, 20, 20]}, 10); // 4 x 2 x 2
  const [nx, ny, nz] = domain.cells;
  const idx = (x, y, z) => x + nx * (y + ny * z);
  const bodyA = packBits(domain.count, c => (c % nx) <= 1);
  const bodyB_touch = packBits(domain.count, c => (c % nx) >= 2);
  const bodyB_overlap = packBits(domain.count, c => (c % nx) >= 1);
  const fixture_left = packBits(domain.count, c => (c % nx) === 0);

  // Overlapping material bodies -> 1 welded component, 0 body contacts
  const welded = buildMechanicalModel({
    domain,
    materialBodies: [
      {hash: 'a', solid: 0, material: 'Steel', occupancy: bodyA, cutFaces: null},
      {hash: 'b', solid: 1, material: 'Aluminium 6061', occupancy: bodyB_overlap, cutFaces: null}
    ],
    fixtureMask: fixture_left, preserveMask: null, optSpaceMask: null, forceSources: []
  });
  assert.equal(welded.stats.components, 1);
  assert.ok(welded.stats.weldedBodyCells > 0);
  assert.equal(welded.bodyContacts.length, 0);
  assert.ok(welded.stats.weldedFixtureCells > 0);

  // Touching non-overlapping material bodies -> 2 components with frictionless contact pairs
  const touching = buildMechanicalModel({
    domain,
    materialBodies: [
      {hash: 'a', solid: 0, material: 'Steel', occupancy: bodyA, cutFaces: null},
      {hash: 'b', solid: 1, material: 'Aluminium 6061', occupancy: bodyB_touch, cutFaces: null}
    ],
    fixtureMask: fixture_left, preserveMask: null, optSpaceMask: null, forceSources: []
  });
  assert.equal(touching.stats.components, 2);
  assert.ok(touching.bodyContacts.length > 0);
  assert.ok(touching.stats.contactBodyCells > 0);

  // Fixture touch on one flat frictionless wall leaves 3 tangential rigid modes -> rejects
  const bodyRight = packBits(domain.count, c => (c % nx) >= 1);
  assert.throws(() => buildMechanicalModel({
    domain,
    materialBodies: [{hash: 'r', solid: 0, material: 'Steel', occupancy: bodyRight, cutFaces: null}],
    fixtureMask: fixture_left, preserveMask: null, optSpaceMask: null, forceSources: []
  }), e => e.code === 'UNCONSTRAINED_RIGID_BODY');

  // Fixture touch on 3 orthogonal frictionless walls without overlap -> constrains all 6 rigid modes
  const cornerDom = computeAutoDomain({min: [0, 0, 0], max: [30, 30, 30]}, 10); // 3 x 3 x 3
  const [cx, cy] = cornerDom.cells;
  const cornerBody = packBits(cornerDom.count, c => {
    const x = c % cx, y = ((c / cx) | 0) % cy, z = (c / (cx * cy)) | 0;
    return x >= 1 && y >= 1 && z >= 1;
  });
  const cornerFix = packBits(cornerDom.count, c => {
    const x = c % cx, y = ((c / cx) | 0) % cy, z = (c / (cx * cy)) | 0;
    return x === 0 || y === 0 || z === 0;
  });
  const fixTouch = buildMechanicalModel({
    domain: cornerDom,
    materialBodies: [{hash: 'r', solid: 0, material: 'Steel', occupancy: cornerBody, cutFaces: null}],
    fixtureMask: cornerFix, preserveMask: null, optSpaceMask: null, forceSources: []
  });
  assert.equal(fixTouch.stats.weldedFixtureCells, 0);
  assert.ok(fixTouch.stats.contactFixtureCells > 0);
  assert.ok(fixTouch.fixtureContacts.length > 0);

  // Unconstrained body without Fixture or cut -> explicit UNCONSTRAINED_RIGID_BODY rejection
  assert.throws(() => buildMechanicalModel({
    domain,
    materialBodies: [{hash: 'free', solid: 0, material: 'Steel', occupancy: bodyA, cutFaces: null}],
    fixtureMask: null, preserveMask: null, optSpaceMask: null, forceSources: []
  }), e => e.code === 'UNCONSTRAINED_RIGID_BODY');
});

test('extractOptimizedMesh produces a closed watertight oriented manifold polygon mesh', () => {
  const domain = computeAutoDomain({min: [0, 0, 0], max: [30, 20, 20]}, 10); // 3 x 2 x 2
  const full = packBits(domain.count, () => true);
  const fix = packBits(domain.count, c => (c % 3) === 0);
  const model = buildMechanicalModel({
    domain,
    materialBodies: [{hash: 'm', solid: 0, material: 'PLA', occupancy: full, cutFaces: null}],
    fixtureMask: fix, preserveMask: null, optSpaceMask: null, forceSources: []
  });
  const mask = new Uint8Array(model.elemCount).fill(1);
  const mesh = extractOptimizedMesh(model, mask);
  assert.ok(mesh.vertexCount > 0 && mesh.triangleCount > 0);
  // Check closed manifold: every directed half-edge (u,v) has exactly one opposite half-edge (v,u)
  const edges = new Map();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i], mesh.indices[i+1], mesh.indices[i+2]];
    for (let k = 0; k < 3; k++) {
      const u = tri[k], v = tri[(k+1)%3], key = u + ':' + v;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  for (const [key, count] of edges) {
    assert.equal(count, 1, 'Non-manifold directed edge ' + key);
    const [u, v] = key.split(':');
    assert.equal(edges.get(v + ':' + u), 1, 'Open boundary edge ' + key);
  }
  // Positive enclosed volume in mm^3
  let vol = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = 3*mesh.indices[i], ib = 3*mesh.indices[i+1], ic = 3*mesh.indices[i+2];
    const ax = mesh.vertices[ia], ay = mesh.vertices[ia+1], az = mesh.vertices[ia+2];
    const bx = mesh.vertices[ib], by = mesh.vertices[ib+1], bz = mesh.vertices[ib+2];
    const cx = mesh.vertices[ic], cy = mesh.vertices[ic+1], cz = mesh.vertices[ic+2];
    vol += (ax*(by*cz-bz*cy) + ay*(bz*cx-bx*cz) + az*(bx*cy-by*cx)) / 6;
  }
  assert.ok(vol > 0, 'Extracted mesh must have positive outward volume, got ' + vol);
});

test('collectAnimationFrames picks keyframes plus changing intervals and skips unchanged tails', () => {
  const animInfo = {
    channels: [
      {id: 'a', path: 'tag:u1:Force Y', track: {kind: 'number', keys: [[0, {v: -100, mode: 'hard'}], [4, {v: -500, mode: 'hard'}], [10, {v: -500, mode: 'hard'}]]}},
      {id: 'a', path: 'tag:u2:Material', track: {kind: 'discrete', keys: [[0, {v: 0}], [20, {v: 2}]]}}
    ]
  };
  const frames = collectAnimationFrames(animInfo, 0, 120);
  // Expect 0,1,2,3,4 (changing linear range), 10 (keyframe), 20 (discrete keyframe) — NOT 5..9 or 21..120!
  assert.deepEqual(frames, [0, 1, 2, 3, 4, 10, 20]);
});

test('activation wires showHelper for Auto size, native 12-edge helper and no runtime sidecar imports', async () => {
  const nodes = [{nativeHash: 'a'.repeat(32), type: 'structural', params: {'Auto size': false, 'Voxel size': 2, 'Material (%)': 30}}];
  let ops, attrs, vp;
  const ctx = {
    version: 1, document: {nodes},
    operations: {register: v => ops = v},
    attributes: {register: v => attrs = v},
    editor: {register: () => {}},
    viewport: {cameraWGSL: '', register: async v => vp = v},
    requestAttributes: () => {}, requestDraw: () => {}
  };
  await activate(ctx);
  assert.equal(vp.lines.length, 72);
  assert.equal(vp.showHelper(nodes[0].nativeHash, {'Auto size': false}), true);
  assert.equal(vp.showHelper(nodes[0].nativeHash, {'Auto size': true}), false);
  const attrState = attrs(nodes[0].nativeHash);
  assert.equal(attrState.actions.find(a => a.id === 'result-object').hidden, true, 'Result to Object hidden before Optimize');
  assert.equal(attrState.numbers.find(n => n.id === 'deformation').visible, false);
  const source = await readFile(new URL('../plugin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s.+\bfrom\s+['"]\.\//m);
  const svg = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
  assert.match(svg, /width="32" height="32" viewBox="0 0 32 32"/);
  assert.doesNotMatch(svg, /transform=/);
  assert.equal(isHardwareAdapter({vendor: 'nvidia', description: 'RTX', isFallbackAdapter: false}), true);
  assert.equal(isHardwareAdapter({vendor: 'google', description: 'SwiftShader', isFallbackAdapter: true}), false);
  assert.equal(isDecodedNativeIcon({decoded: true, complete: true, width: 32, height: 32, naturalWidth: 32, naturalHeight: 32, rect: {width: 32, height: 32}}), true);
  assert.equal(hasBoundedFrameTimings({timestampQueries: true, frames: Array.from({length: 12}, () => ({cpuMs: 1, gpuMs: 2}))}), true);
  await assert.rejects(() => activate({version: 2}), e => e.code === 'API_VERSION');
});
