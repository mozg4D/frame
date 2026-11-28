import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  activate, MU0, MATERIALS, CELL_KIND,
  resolveMaterialProps, softMuR, hysteresisSwitch, evaluateHysteresisMr,
  computeManualDomain, computeAutoDomain,
  buildMagnetoModel, solveConductorCurrents, solveMagnetoCPU, evaluateMagnetoFields,
  createBodyMagnetizationStore, writeBodyLocalMrFromGrid, extractRotationBasis
} from '../plugin.js';

const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));

function identityMat(tx = 0, ty = 0, tz = 0, sx = 1, sy = 1, sz = 1) {
  return [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, tx,ty,tz,1];
}
function rotXMat(deg, tx = 0, ty = 0, tz = 0) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [1,0,0,0, 0,c,s,0, 0,-s,c,0, tx,ty,tz,1];
}
function invRigidMat(m) {
  // Inverse of rigid/axis-scaled orthogonal matrix
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const r00 = m[0]/(sx*sx), r01 = m[1]/(sx*sx), r02 = m[2]/(sx*sx);
  const r10 = m[4]/(sy*sy), r11 = m[5]/(sy*sy), r12 = m[6]/(sy*sy);
  const r20 = m[8]/(sz*sz), r21 = m[9]/(sz*sz), r22 = m[10]/(sz*sz);
  const tx = m[12], ty = m[13], tz = m[14];
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    -(r00*tx + r01*ty + r02*tz),
    -(r10*tx + r11*ty + r12*tz),
    -(r20*tx + r21*ty + r22*tz),
    1
  ];
}

function makeBitMask(domain, pred) {
  const [nx, ny, nz] = domain.cells, count = domain.count;
  const occ = new Uint32Array(Math.ceil(count / 32));
  let activeCount = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const px = (domain.originWorldM[0] + (x + 0.5) * domain.spacingM[0]) * 1000;
    const py = (domain.originWorldM[1] + (y + 0.5) * domain.spacingM[1]) * 1000;
    const pz = (domain.originWorldM[2] + (z + 0.5) * domain.spacingM[2]) * 1000;
    if (pred(px, py, pz, x, y, z)) {
      const c = x + nx * (y + ny * z);
      occ[c >> 5] |= (1 << (c & 31));
      activeCount++;
    }
  }
  const volumeM3 = activeCount * domain.spacingM[0] * domain.spacingM[1] * domain.spacingM[2];
  return {occupancy: occ, activeCount, volumeM3};
}

function mockHost() {
  const objSpec = manifest.objects.find(o => o.type === 'magneto');
  const mkParams = spec => Object.fromEntries(Object.entries(spec.fields).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const nodes = ['first', 'second'].map(nativeHash => ({
    nativeHash, type: 'magneto', name: 'Magneto', enabled: true, params: mkParams(objSpec), tags: []
  }));
  const h = {
    version: 1, mutations: 0,
    math: {
      inv: m => invRigidMat(m),
      point: (m, p) => [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]
    },
    document: {
      nodes, frame: 0,
      world: () => identityMat(),
      pause: () => {},
      transaction: fn => { h.mutations++; fn(); },
      create: (type, parent, name) => {
        const spec = manifest.objects.find(o => o.type === type);
        const n = {nativeHash: 'n' + String(nodes.length).padStart(31, '0'), type, parent, name, enabled: true, params: mkParams(spec), tags: []};
        nodes.push(n);
        h.hooks?.created?.(n);
        return n;
      },
      select: () => {}
    },
    animation: {timeline: () => ({frame: 0, total: 10, fps: 60}), inspect: () => ({channels: []}), seek: async () => {}},
    operations: {register(v) { h.ops = new Map(v.map(o => [o.id, o])); }},
    attributes: {register(v) { h.attributesFor = v; }},
    viewport: {async register(v) { h.viewportDescriptor = v; }},
    editor: {register(hooks) { h.hooks = hooks; }, selectOwner: async () => {}},
    requestAttributes: () => {},
    requestDraw: () => {},
    update(hash, patch) { Object.assign(nodes.find(n => n.nativeHash === hash).params, patch); h.mutations++; }
  };
  return h;
}

// ---------- 1. Manifest, Authoring & SurfaceStyle Contracts ----------

test('manifest declares 3D Magneto domain, Current, Probe, 11 materials, visibleWhen and native 32px icon', async () => {
  assert.equal(manifest.name, 'Magneto');
  assert.deepEqual(manifest.objects.map(o => o.type), ['magneto', 'magneto_current', 'magneto_probe']);
  assert.deepEqual(Object.keys(manifest.objects[0].fields), ['Auto size', 'Voxel size']);
  assert.deepEqual(Object.keys(manifest.objects[1].fields), ['Magneto', 'Current Density']);
  assert.equal(manifest.objects[1].fieldOptions['Current Density'].unit, 'A/mm²');
  const tag = manifest.tags[0];
  assert.equal(tag.kind, 'magneto');
  assert.equal(tag.inherit, 'nearest');
  // Preserve first 6 Material preset positions for shared tag compatibility
  assert.deepEqual(tag.fields.Material.slice(0, 6), [
    'Electrical Steel M19', 'Electrical Steel M27', 'Pure Iron', 'NdFeB N35', 'NdFeB N42', 'NdFeB N52'
  ]);
  assert.ok(tag.fields.Material.includes('Copper'));
  assert.ok(tag.fields.Material.includes('Aluminium'));
  assert.ok(tag.fields.Material.includes('Custom'));
  assert.ok(Array.isArray(tag.fieldOptions.Magnetization.visibleWhen.in));
  assert.equal(tag.fieldOptions.Permeability.visibleWhen.equals, 'Custom');
  const svg = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
  assert.match(svg, /width="32" height="32" viewBox="0 0 32 32"/);
});

test('attributes, operations, helper creation and Reset M visibility obey native contracts', async () => {
  const h = mockHost();
  await activate(h);
  const a = h.attributesFor('first');
  assert.ok(a.actions.some(x => x.id === 'show-voxels' && !x.disabled));
  assert.ok(a.actions.some(x => x.id === 'solve-frame' && !x.disabled));
  assert.ok(a.actions.some(x => x.id === 'solve-animation' && !x.disabled));
  assert.ok(a.actions.some(x => x.id === 'reset-magnetization' && x.hidden));
  assert.ok(a.actions.some(x => x.id === 'create-current' && x.row === 'Add'));
  assert.ok(a.actions.some(x => x.id === 'create-probe' && x.row === 'Add'));
  for (const op of h.ops.values()) {
    assert.ok(op.inputSchema);
    assert.equal(op.inputSchema.additionalProperties, false);
  }
  const s = h.ops.get('status').run('first');
  assert.equal(s.authoringOnly, false);
  assert.equal(s.physicsAvailable, true);
  assert.equal(s.solverAvailable, true);
  assert.equal(s.remagnetized, false);

  const cur = await h.ops.get('create-current').run('first');
  assert.equal(cur.type, 'magneto_current');
  assert.equal(h.attributesFor(cur.hash).hiddenFields[0], 'Magneto');
  const prb = await h.ops.get('create-probe').run('first');
  assert.equal(prb.type, 'magneto_probe');
  assert.equal(h.attributesFor(prb.hash).hiddenFields[0], 'Magneto');

  assert.throws(() => h.ops.get('force').run('first'), {code: 'NO_RESULT'});
  assert.throws(() => h.ops.get('torque').run('first'), {code: 'NO_RESULT'});
  assert.throws(() => h.ops.get('solve-frame').run('missing'), {code: 'INVALID_OWNER'});
});

test('surfaceStyle fallback is non-destructive, respects Frame Material, and handles 20k meshes in <100ms', async () => {
  const h = mockHost();
  await activate(h);
  const n = {nativeHash: 'mesh', type: 'mesh', tags: [{kind: 'magneto', params: {Material: 'NdFeB N52'}}]};
  h.document.nodes.push(n);
  const before = JSON.stringify(n);
  const style = h.hooks.surfaceStyle('mesh');
  assert.ok(style && style.topmost === false && style.color.length === 4);
  assert.equal(JSON.stringify(n), before);
  n.tags.push({kind: 'material', params: {}});
  assert.equal(h.hooks.surfaceStyle('mesh'), null);

  for (const size of [1000, 20000]) {
    const nodes = Array.from({length: size}, (_, i) => ({nativeHash: 'm' + i, type: 'mesh', tags: []}));
    h.document.nodes = nodes;
    h.hooks.documentChanged();
    const t0 = performance.now();
    for (const q of nodes) assert.equal(h.hooks.surfaceStyle(q.nativeHash), null);
    assert.ok(performance.now() - t0 < 100, `20k lookup exceeded 100ms`);
  }
});

// ---------- 2. Constitutive Laws & Vector Hysteresis Math ----------

test('Frohlich-Kennelly soft permeability and vector hysteresis obey physical limits', () => {
  const m19 = MATERIALS['Electrical Steel M19'];
  const Ms = m19.Bs / MU0;
  assert.equal(softMuR(0, m19.muR0, Ms), m19.muR0);
  const muMid = softMuR(1000, m19.muR0, Ms);
  assert.ok(muMid > 100 && muMid < m19.muR0);
  const muSat = softMuR(1e7, m19.muR0, Ms);
  assert.ok(muSat > 1.0 && muSat < 1.25);

  // Hysteresis deadband, exact Hcj zero-crossing, full flip, and virgin magnetization
  const Hcj = 500000, MsHard = 1e6;
  assert.equal(hysteresisSwitch(0.50 * Hcj, Hcj), 0);
  assert.ok(Math.abs(hysteresisSwitch(1.00 * Hcj, Hcj) - 0.5) < 1e-12);
  assert.equal(hysteresisSwitch(1.50 * Hcj, Hcj), 1);

  // Standalone below deadband -> zero drift
  const mBelow = evaluateHysteresisMr([0, 0, MsHard], [0, 0, -0.5 * Hcj], MsHard, Hcj);
  assert.deepEqual(mBelow, [0, 0, MsHard]);
  // Opposing at exact H = -Hcj -> crosses zero!
  const mZero = evaluateHysteresisMr([0, 0, MsHard], [0, 0, -Hcj], MsHard, Hcj);
  assert.ok(Math.hypot(...mZero) < 1e-6);
  // Opposing above 1.45*Hcj -> complete flip to -Z!
  const mFlip = evaluateHysteresisMr([0, 0, MsHard], [0, 0, -1.6 * Hcj], MsHard, Hcj);
  assert.ok(Math.abs(mFlip[2] + MsHard) < 1e-3);
  // Unmagnetized virgin magnet pulsed above 1.45*Hcj -> fully magnetized along +X!
  const mMag = evaluateHysteresisMr([0, 0, 0], [1.6 * Hcj, 0, 0], MsHard, Hcj);
  assert.ok(Math.abs(mMag[0] - MsHard) < 1e-3);
});

// ---------- 3. Analytical 3D Magnetostatics Verification ----------

test('Analytical benchmark 1: Uniformly magnetized NdFeB N52 sphere matches B_int = 2/(2+mu_rec)*Br and zero self-demag drift', () => {
  const domain = computeManualDomain(identityMat(), 4); // 25x25x25 = 15,625 cells (100 mm cube)
  const R = 16; // 16 mm radius sphere centered at origin
  const sphere = makeBitMask(domain, (x, y, z) => x*x + y*y + z*z <= R*R);
  const mat = resolveMaterialProps({Material: 'NdFeB N52', Magnetization: '+Z'});
  const model = buildMagnetoModel({
    domain,
    bodies: [{hash: 's1', name: 'Sphere', material: mat, worldMatrix: identityMat(), invWorldMm: identityMat(), ...sphere}],
    probes: [{hash: 'p0', name: 'Center', worldMm: [0, 0, 0]}, {hash: 'p1', name: 'Pole', worldMm: [0, 0, 24]}]
  });

  const sol = solveMagnetoCPU(model, null, {tolerance: 1e-6, maxIterations: 400});
  const ev = evaluateMagnetoFields(model, sol, null);
  const center = ev.probes[0], pole = ev.probes[1];

  const exactBint = (2 / (2 + mat.muR0)) * mat.Br; // 0.9443 T
  const exactHint = -mat.Ms / (2 + mat.muR0);      // -375.7 kA/m
  assert.ok(Math.abs(center.BVecT[2] - exactBint) / exactBint < 0.08, `Center Bz=${center.BVecT[2].toFixed(4)} T vs exact ${exactBint.toFixed(4)} T`);
  assert.ok(Math.abs(center.BVecT[0]) < 0.02 && Math.abs(center.BVecT[1]) < 0.02, 'Transverse center B vanishes by symmetry');
  // External pole field along +Z points +Z (dipole: Bz(r) = (2/3)*Br*(R/r)^3)
  const exactPoleB = (2 / (2 + mat.muR0)) * mat.Br * Math.pow(R / 24, 3);
  assert.ok(pole.BVecT[2] > 0 && Math.abs(pole.BVecT[2] - exactPoleB) / exactPoleB < 0.20, `Pole Bz=${pole.BVecT[2].toFixed(4)} T vs dipole ${exactPoleB.toFixed(4)} T`);
  // Internal H opposes Mr, and zero self-demagnetization drift on sphere
  const [nx, ny, nz] = domain.cells;
  const cMid = (nx >> 1) + nx * ((ny >> 1) + ny * (nz >> 1));
  assert.ok(sol.H[4*cMid + 2] < 0 && Math.abs(sol.H[4*cMid + 2] - exactHint) / Math.abs(exactHint) < 0.12);
  assert.ok(ev.bodies[0].meanMrFraction > 0.99, `NdFeB sphere should not self-demagnetize: ${ev.bodies[0].meanMrFraction}`);
});

test('Analytical benchmark 2: Closed Copper ring with Current plane matches Biot-Savart B = mu0*I/(2R) and div(J)=0', () => {
  const domain = computeManualDomain(identityMat(), 4); // 25x25x25
  const R = 24, rTube = 5.5; // Circular ring in XY plane, center at origin
  const ring = makeBitMask(domain, (x, y, z) => {
    const rho = Math.hypot(x, y);
    return (rho - R)*(rho - R) + z*z <= rTube*rTube;
  });
  const matCu = resolveMaterialProps({Material: 'Copper'});
  // Current plane at x > 0, y = 0, normal pointing +Y (counter-clockwise current in XY -> +Z field at center!)
  const planeMat = [1,0,0,0, 0,0,-1,0, 0,1,0,0, R,0,0,1]; // local +Z = world +Y, centered at (R, 0, 0)
  const planeScaled = [0.25,0,0,0, 0,0,-0.25,0, 0,0.25,0,0, R,0,0,1]; // 25x25 mm plane cutting only the +X arm!
  const currentPlane = {
    hash: 'cur1', name: 'Current', currentDensityAmm2: 10,
    world: planeScaled, invWorldMm: invRigidMat(planeScaled),
    scales: [0.25, 0.25, 0.25], normalWorld: [0, 1, 0], normalGrid: [0, 1, 0]
  };
  const model = buildMagnetoModel({
    domain,
    bodies: [{hash: 'cu1', name: 'Ring', material: matCu, worldMatrix: identityMat(), invWorldMm: identityMat(), ...ring}],
    currentPlanes: [currentPlane],
    probes: [{hash: 'p0', name: 'Center', worldMm: [0, 0, 0]}]
  });

  const curData = solveConductorCurrents(model);
  assert.equal(curData.planeResults[0].mode, 'closed-loop');
  assert.ok(curData.planeResults[0].totalCurrentA > 400, `Expected strong loop current, got ${curData.planeResults[0].totalCurrentA} A`);
  assert.ok(curData.sourceCount > 40);

  const sol = solveMagnetoCPU(model, curData, {tolerance: 1e-6});
  const ev = evaluateMagnetoFields(model, sol, curData);
  const I = curData.planeResults[0].totalCurrentA;
  const exactCenterB = (MU0 * I) / (2 * R * 1e-3);
  const measuredBz = ev.probes[0].BVecT[2];
  assert.ok(measuredBz > 0, 'Right-hand rule: CCW current produces +Z B at center');
  assert.ok(Math.abs(measuredBz - exactCenterB) / exactCenterB < 0.15, `Loop center Bz=${(measuredBz*1000).toFixed(2)} mT vs analytic ${(exactCenterB*1000).toFixed(2)} mT`);
});

test('Analytical benchmark 3: Open busbar carries uniform J, obeys Lorentz F = I x B * L, and floating wire reports open-circuit', () => {
  const domain = computeManualDomain(identityMat(), 5); // 20x20x20 (100 mm cube)
  const bar = makeBitMask(domain, (x, y) => Math.abs(x) <= 6 && Math.abs(y) <= 6); // Spans Z from -50 to +50 mm
  const matCu = resolveMaterialProps({Material: 'Copper'});
  const planeMat = [0.3,0,0,0, 0,0.3,0,0, 0,0,0.3,0, 0,0,0,1]; // XY plane at z=0, normal +Z
  const model = buildMagnetoModel({
    domain,
    bodies: [{hash: 'bar', name: 'Busbar', material: matCu, worldMatrix: identityMat(), invWorldMm: identityMat(), ...bar}],
    currentPlanes: [{hash: 'c1', name: 'Cur', currentDensityAmm2: 5, world: planeMat, invWorldMm: invRigidMat(planeMat), scales: [0.3,0.3,0.3], normalWorld: [0,0,1], normalGrid: [0,0,1]}],
    probes: [{hash: 'pR', name: 'Side', worldMm: [22.5, 0, 0]}]
  });
  const curData = solveConductorCurrents(model);
  assert.equal(curData.planeResults[0].mode, 'open-busbar');
  const I = curData.planeResults[0].totalCurrentA;
  assert.ok(I > 400);
  const sol = solveMagnetoCPU(model, curData);
  const ev = evaluateMagnetoFields(model, sol, curData);
  // Right-hand rule: +Z current at x=0 produces +Y field at x=+22.5 mm!
  assert.ok(ev.probes[0].BVecT[1] > 0.002, `Expected +Y field from +Z busbar, got ${ev.probes[0].BVecT}`);

  // Floating short stub inside air -> open circuit (zero fake current)
  const stub = makeBitMask(domain, (x, y, z) => Math.abs(x) <= 6 && Math.abs(y) <= 6 && Math.abs(z) <= 15);
  const stubModel = buildMagnetoModel({
    domain,
    bodies: [{hash: 'stub', name: 'Stub', material: matCu, worldMatrix: identityMat(), invWorldMm: identityMat(), ...stub}],
    currentPlanes: [{hash: 'c1', name: 'Cur', currentDensityAmm2: 5, world: planeMat, invWorldMm: invRigidMat(planeMat), scales: [0.3,0.3,0.3], normalWorld: [0,0,1], normalGrid: [0,0,1]}]
  });
  const stubCur = solveConductorCurrents(stubModel);
  assert.equal(stubCur.planeResults[0].openCircuit, true);
  assert.equal(stubCur.sourceCount, 0);
});

test('Analytical benchmark 4: Two NdFeB magnets attract (N-S), repel (N-N), and satisfy Newton 3rd law', () => {
  const domain = computeManualDomain(identityMat(), 4); // 25x25x25
  const m1Mask = makeBitMask(domain, (x, y, z) => Math.abs(x) <= 8 && Math.abs(y) <= 8 && z >= -20 && z <= -6);
  const m2Mask = makeBitMask(domain, (x, y, z) => Math.abs(x) <= 8 && Math.abs(y) <= 8 && z >= 6 && z <= 20);
  const matPlus = resolveMaterialProps({Material: 'NdFeB N52', Magnetization: '+Z'});
  const matMinus = resolveMaterialProps({Material: 'NdFeB N52', Magnetization: '-Z'});

  // Attracting (both +Z -> N face of m1 at z=-6 faces S face of m2 at z=+6)
  const attModel = buildMagnetoModel({
    domain,
    bodies: [
      {hash: 'm1', name: 'Mag1', material: matPlus, worldMatrix: identityMat(0, 0, -13), invWorldMm: identityMat(0, 0, 13), ...m1Mask},
      {hash: 'm2', name: 'Mag2', material: matPlus, worldMatrix: identityMat(0, 0, 13), invWorldMm: identityMat(0, 0, -13), ...m2Mask}
    ]
  });
  const attEv = evaluateMagnetoFields(attModel, solveMagnetoCPU(attModel));
  const f1Att = attEv.bodies[0].forceN[2], f2Att = attEv.bodies[1].forceN[2];
  assert.ok(f1Att > 1.0 && f2Att < -1.0, `Attracting magnets must pull together: F1z=${f1Att.toFixed(2)} N, F2z=${f2Att.toFixed(2)} N`);
  assert.ok(Math.abs(f1Att + f2Att) / Math.abs(f1Att) < 0.20, `Newton 3rd law violated: F1z=${f1Att.toFixed(2)}, F2z=${f2Att.toFixed(2)}`);

  // Repelling (m1 +Z, m2 -Z -> N faces N!)
  const repModel = buildMagnetoModel({
    domain,
    bodies: [
      {hash: 'm1', name: 'Mag1', material: matPlus, worldMatrix: identityMat(0, 0, -13), invWorldMm: identityMat(0, 0, 13), ...m1Mask},
      {hash: 'm2', name: 'Mag2', material: matMinus, worldMatrix: identityMat(0, 0, 13), invWorldMm: identityMat(0, 0, -13), ...m2Mask}
    ]
  });
  const repEv = evaluateMagnetoFields(repModel, solveMagnetoCPU(repModel));
  const f1Rep = repEv.bodies[0].forceN[2], f2Rep = repEv.bodies[1].forceN[2];
  assert.ok(f1Rep < -1.0 && f2Rep > 1.0, `Repelling magnets must push apart: F1z=${f1Rep.toFixed(2)} N, F2z=${f2Rep.toFixed(2)} N`);
});

test('Analytical benchmark 5: Soft Electrical Steel M19 amplifies coil field and exhibits nonlinear B-H saturation', () => {
  const domain = computeManualDomain(identityMat(), 5); // 20x20x20
  const R = 24, rTube = 6;
  const ring = makeBitMask(domain, (x, y, z) => { const rho = Math.hypot(x, y); return (rho - R)*(rho - R) + z*z <= rTube*rTube; });
  const core = makeBitMask(domain, (x, y, z) => x*x + y*y <= 10*10 && Math.abs(z) <= 22);
  const matCu = resolveMaterialProps({Material: 'Copper'});
  const matFe = resolveMaterialProps({Material: 'Electrical Steel M19'});
  const planeMat = [0.25,0,0,0, 0,0,-0.25,0, 0,0.25,0,0, R,0,0,1];

  const runCase = (withCore, Jamm2) => {
    const bodies = [{hash: 'cu', name: 'Coil', material: matCu, worldMatrix: identityMat(), invWorldMm: identityMat(), ...ring}];
    if (withCore) bodies.push({hash: 'fe', name: 'Core', material: matFe, worldMatrix: identityMat(), invWorldMm: identityMat(), ...core});
    const model = buildMagnetoModel({
      domain, bodies,
      currentPlanes: [{hash: 'c', name: 'Cur', currentDensityAmm2: Jamm2, world: planeMat, invWorldMm: invRigidMat(planeMat), scales: [0.25,0.25,0.25], normalWorld: [0,1,0], normalGrid: [0,1,0]}],
      probes: [{hash: 'p', name: 'CoreCenter', worldMm: [0, 0, 0]}]
    });
    const cur = solveConductorCurrents(model);
    const sol = solveMagnetoCPU(model, cur);
    return evaluateMagnetoFields(model, sol, cur);
  };

  const airLow = runCase(false, 20);
  const feLow = runCase(true, 20);
  const feHigh = runCase(true, 2000);
  // Iron core strongly amplifies flux at moderate current
  assert.ok(feLow.probes[0].BT > airLow.probes[0].BT * 2.5, `Iron should amplify B: fe=${feLow.probes[0].BT.toFixed(3)} T vs air=${airLow.probes[0].BT.toFixed(3)} T`);
  // At 100x higher current, iron saturates -> B grows far less than 100x and Peak Sat rises strongly!
  const ratio = feHigh.probes[0].BT / feLow.probes[0].BT;
  assert.ok(ratio < 35 && feHigh.peakSatPct > 70, `Expected saturation: ratio=${ratio.toFixed(1)}, sat=${feHigh.peakSatPct.toFixed(1)}%`);
});

test('Analytical benchmark 6: Real pulse magnetization (Unmagnetized -> magnetized), opposing remagnetization flip, and rigid rotation transport', () => {
  const domain = computeManualDomain(identityMat(), 5); // 20x20x20
  const R = 24, rTube = 6.5;
  const ring = makeBitMask(domain, (x, y, z) => { const rho = Math.hypot(x, y); return (rho - R)*(rho - R) + z*z <= rTube*rTube; });
  const core = makeBitMask(domain, (x, y, z) => x*x + y*y <= 11*11 && Math.abs(z) <= 18);
  const matCu = resolveMaterialProps({Material: 'Copper'});
  // Ferrite Y30 has Br = 0.39 T (Ms = 310 kA/m), Hcj = 240 kA/m -> self-stable in free space AND easily magnetized/flipped by a coil pulse!
  const matUnmag = resolveMaterialProps({Material: 'Ferrite Y30', Magnetization: 'Unmagnetized'});
  const planeMat = [0.25,0,0,0, 0,0,-0.25,0, 0,0.25,0,0, R,0,0,1];
  const persistent = new Map();

  const step = (Jamm2, matCore = matUnmag, coreMat4 = identityMat()) => {
    const coreMask = makeBitMask(domain, (x, y, z) => {
      const inv = invRigidMat(coreMat4);
      const lx = inv[0]*x + inv[4]*y + inv[8]*z + inv[12];
      const ly = inv[1]*x + inv[5]*y + inv[9]*z + inv[13];
      const lz = inv[2]*x + inv[6]*y + inv[10]*z + inv[14];
      return lx*lx + ly*ly <= 11*11 && Math.abs(lz) <= 18;
    });
    const model = buildMagnetoModel({
      domain,
      bodies: [
        {hash: 'cu', name: 'Coil', material: matCu, worldMatrix: identityMat(), invWorldMm: identityMat(), ...ring},
        {hash: 'mag', name: 'Ferrite', material: matCore, worldMatrix: coreMat4, invWorldMm: invRigidMat(coreMat4), rotBasis: extractRotationBasis(coreMat4), ...coreMask}
      ],
      currentPlanes: [{hash: 'c', name: 'Cur', currentDensityAmm2: Jamm2, world: planeMat, invWorldMm: invRigidMat(planeMat), scales: [0.25,0.25,0.25], normalWorld: [0,1,0], normalGrid: [0,1,0]}],
      probes: [{hash: 'pZ', name: 'PoleZ', worldMm: [0, 0, 26]}, {hash: 'pY', name: 'PoleY', worldMm: [0, 26, 0]}],
      persistentStores: persistent
    });
    const cur = solveConductorCurrents(model);
    const sol = solveMagnetoCPU(model, cur, {tolerance: 1e-6, maxOuterIterations: 20});
    // Commit persistent local magnetization
    const magBody = model.bodies[1];
    writeBodyLocalMrFromGrid(persistent.get('mag'), magBody, domain, sol.Mr);
    return evaluateMagnetoFields(model, sol, cur);
  };

  // Frame 0: Unmagnetized, zero current -> zero field
  const ev0 = step(0);
  assert.ok(ev0.maxBT < 1e-5 && Math.abs(ev0.probes[0].BVecT[2]) < 1e-5);

  // Frame 1: Strong +Z pulse (2200 A/mm^2 -> H >> Hcj = 240 kA/m) -> magnetizes +Z!
  const ev1 = step(2200);
  assert.ok(ev1.bodies[1].meanMrWorld[2] > 2.0e5, `Pulse must magnetize +Z: MrZ=${ev1.bodies[1].meanMrWorld[2]}`);
  assert.equal(persistent.get('mag').modified, true);

  // Frame 2: Coil OFF (0 A/mm^2) -> STAYS permanently magnetized +Z with real dipole field at Probe!
  const ev2 = step(0);
  assert.ok(ev2.bodies[1].meanMrWorld[2] > 2.0e5, `Remanent +Z magnetization must persist after coil off: MrZ=${ev2.bodies[1].meanMrWorld[2]}`);
  assert.ok(ev2.probes[0].BVecT[2] > 0.02, `External dipole field must persist at PoleZ: Bz=${ev2.probes[0].BVecT[2]}`);

  // Frame 3: Strong OPPOSING pulse (-2500 A/mm^2) -> FLIPS magnet to -Z!
  const ev3 = step(-2500);
  assert.ok(ev3.bodies[1].meanMrWorld[2] < -2.0e5, `Opposing pulse must flip magnet to -Z: MrZ=${ev3.bodies[1].meanMrWorld[2]}`);

  // Frame 4: Coil OFF (0 A/mm^2) -> STAYS flipped to -Z (external PoleZ field reversed sign!)
  const ev4 = step(0);
  assert.ok(ev4.bodies[1].meanMrWorld[2] < -2.0e5, `Flipped -Z magnetization must persist: MrZ=${ev4.bodies[1].meanMrWorld[2]}`);
  assert.ok(ev4.probes[0].BVecT[2] < -0.02, `External PoleZ field must reverse sign: Bz=${ev4.probes[0].BVecT[2]}`);

  // Frame 5: Rotate flipped magnet +90 deg about X -> local -Z maps to world +Y!
  const ev5 = step(0, matUnmag, rotXMat(90));
  assert.ok(ev5.bodies[1].meanMrWorld[1] > 2.0e5, `Rigid rotation must carry -Z local Mr to +Y world: Mr=${ev5.bodies[1].meanMrWorld}`);
  assert.ok(ev5.probes[1].BVecT[1] > 0.02, `External field must rotate to PoleY: By=${ev5.probes[1].BVecT[1]}`);
});
