import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  activate, MATERIALS, MEDIA, CELL_TYPE, ROLE, DEFAULT_MATERIAL_NAME,
  FAN_CREATION_FRAME, PROBE_CREATION_FRAME,
  resolveMaterialProps, validateThermalParameters, validateFanParameters,
  computeManualDomain, computeAutoDomain, gridPointToWorldMm, worldMmToGrid,
  buildThermalModel, evaluateThermalFields, samplePointReading, nativeFanMetadata
} from '../plugin.js';

const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));

function makeMockContext() {
  let seq = 0, transactions = 0;
  const nodes = [];
  const locals = new Map();
  const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const unpack = p => [p[0],p[1],p[2],0, p[3],p[4],p[5],0, p[6],p[7],p[8],0, p[9],p[10],p[11],1];
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k];
    return o;
  };
  const inv = m => {
    // Orthogonal + translation inverse (exact for non-sheared frames)
    const sx2 = m[0]*m[0]+m[1]*m[1]+m[2]*m[2];
    const sy2 = m[4]*m[4]+m[5]*m[5]+m[6]*m[6];
    const sz2 = m[8]*m[8]+m[9]*m[9]+m[10]*m[10];
    const o = [
      m[0]/sx2, m[4]/sy2, m[8]/sz2, 0,
      m[1]/sx2, m[5]/sy2, m[9]/sz2, 0,
      m[2]/sx2, m[6]/sy2, m[10]/sz2, 0,
      0, 0, 0, 1
    ];
    const tx = m[12], ty = m[13], tz = m[14];
    o[12] = -(o[0]*tx + o[4]*ty + o[8]*tz);
    o[13] = -(o[1]*tx + o[5]*ty + o[9]*tz);
    o[14] = -(o[2]*tx + o[6]*ty + o[10]*tz);
    return o;
  };
  const point = (m, p) => [
    m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],
    m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],
    m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]
  ];
  const world = hash => {
    const n = nodes.find(x => x.nativeHash === hash);
    if (!n) return I();
    const loc = locals.get(hash) || I();
    if (!n.parent) return loc;
    const p = nodes.find(x => x.id === n.parent);
    return p ? mul(world(p.nativeHash), loc) : loc;
  };
  let operations = [], attributesFn = null, editorHooks = null, viewportReg = null;
  const defs = Object.fromEntries(manifest.objects.map(o => [o.type, o.fields]));
  const doc = {
    get nodes() { return nodes; },
    get frame() { return 0; },
    pause() {},
    world,
    local: hash => locals.get(hash) || I(),
    transaction(fn) { transactions++; fn(); },
    create(type, parentHash = null, name = type) {
      const hash = (++seq).toString(16).padStart(32, '0');
      const parent = parentHash ? nodes.find(x => x.nativeHash === parentHash)?.id || null : null;
      const params = Object.fromEntries(Object.entries(defs[type]).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      const n = {id: 'n' + seq, nativeHash: hash, type, parent, name, enabled: true, visible: true, params, tags: []};
      editorHooks?.created?.(n);
      if (n.creationFrame) { locals.set(hash, unpack(n.creationFrame)); delete n.creationFrame; }
      else locals.set(hash, I());
      nodes.push(n);
      return n;
    },
    select() {}
  };
  const context = {
    version: 1, device: null, document: doc,
    math: {I, mul, inv, point},
    operations: {register: ops => operations = ops},
    attributes: {register: fn => attributesFn = fn},
    editor: {register: h => editorHooks = h, selectOwner: async () => {}},
    viewport: {register: async v => viewportReg = v},
    animation: {timeline: () => ({fps: 60, total: 120}), inspect: () => ({channels: []}), seek: async () => {}},
    requestAttributes() {}, requestDraw() {}
  };
  return {
    context, doc, locals,
    get operations() { return operations; },
    get attributes() { return attributesFn; },
    get editor() { return editorHooks; },
    get viewport() { return viewportReg; },
    get transactions() { return transactions; }
  };
}

test('manifest declares Thermal objects, 3 tags, Custom material visibleWhen and 32 px icon', async () => {
  assert.deepEqual(manifest.objects.map(o => o.type), ['thermal', 'thermal_probe', 'thermal_fan']);
  assert.deepEqual(manifest.tags.map(t => t.kind), ['thermal_material', 'thermal_heater', 'thermal_temperature']);
  const matTag = manifest.tags[0];
  assert.ok(matTag.fields.Material.includes('Custom'));
  assert.equal(matTag.fields.Material[0], DEFAULT_MATERIAL_NAME);
  for (const key of ['Conductivity', 'Density', 'Specific heat', 'Emissivity']) {
    assert.deepEqual(matTag.fieldOptions[key].visibleWhen, {field: 'Material', equals: 'Custom'});
  }
  const fanSpec = manifest.objects.find(o => o.type === 'thermal_fan');
  assert.equal(fanSpec.fields['Shutoff pressure'], 25);
  assert.equal(fanSpec.fields['Free flow'], 0.005);
  const icon = await readFile(new URL('../icon.svg', import.meta.url), 'utf8');
  assert.match(icon, /width="32" height="32" viewBox="0 0 32 32"/);
});

test('resolveMaterialProps supports presets, fallback Aluminium 6061 and Custom attributes', () => {
  const fb = resolveMaterialProps(null);
  assert.equal(fb.name, DEFAULT_MATERIAL_NAME);
  assert.equal(fb.fallback, true);
  assert.equal(fb.k, MATERIALS[DEFAULT_MATERIAL_NAME].k);

  const cu = resolveMaterialProps({Material: 'Copper'});
  assert.equal(cu.k, 398);
  assert.equal(cu.fallback, false);

  const custom = resolveMaterialProps({Material: 'Custom', Conductivity: 12.5, Density: 1800, 'Specific heat': 750, Emissivity: 0.42});
  assert.equal(custom.name, 'Custom');
  assert.equal(custom.custom, true);
  assert.equal(custom.k, 12.5);
  assert.equal(custom.rho, 1800);
  assert.equal(custom.cp, 750);
  assert.equal(custom.emissivity, 0.42);

  assert.throws(() => resolveMaterialProps({Material: 'Custom', Conductivity: 0, Density: 1000, 'Specific heat': 500, Emissivity: 0.5}), e => e.code === 'INVALID_MATERIAL');
  assert.throws(() => resolveMaterialProps({Material: 'Custom', Conductivity: 10, Density: 1000, 'Specific heat': 500, Emissivity: 1.5}), e => e.code === 'INVALID_MATERIAL');
});

test('Thermal parameter validation and domain calculation (manual, sheared rejection, reflection, Auto size)', () => {
  assert.doesNotThrow(() => validateThermalParameters({'Auto size': false, 'Voxel size': 2, Medium: 'Air', Ambient: 20, Initial: 20, 'Time scale': 1}));
  assert.throws(() => validateThermalParameters({'Auto size': false, 'Voxel size': 0, Medium: 'Air', Ambient: 20, Initial: 20, 'Time scale': 1}));
  assert.throws(() => validateThermalParameters({'Auto size': false, 'Voxel size': 2, Medium: 'Plasma', Ambient: 20, Initial: 20, 'Time scale': 1}));
  assert.throws(() => validateThermalParameters({'Auto size': false, 'Voxel size': 2, Medium: 'Air', Ambient: -300, Initial: 20, 'Time scale': 1}));

  const id = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const d = computeManualDomain(id, 5);
  assert.deepEqual(d.cells, [20, 20, 20]);
  assert.equal(d.count, 8000);
  const pW = gridPointToWorldMm(d, 10, 10, 10);
  assert.ok(pW.every(v => Math.abs(v) < 1e-9));
  const pG = worldMmToGrid(d, pW);
  assert.ok(pG.every((v, i) => Math.abs(v - 10) < 1e-9));

  const sheared = [1,0,0,0, 0.2,1,0,0, 0,0,1,0, 0,0,0,1];
  assert.throws(() => computeManualDomain(sheared, 5), e => e.code === 'SHEARED_DOMAIN');

  const autoAir = computeAutoDomain({min: [-10, -10, -10], max: [10, 10, 10]}, 5, 'Air');
  assert.equal(autoAir.autoSize, true);
  assert.ok(autoAir.lengthsM[1] > 0.06, 'Air auto domain adds buoyancy headroom');
  const autoVac = computeAutoDomain({min: [-10, -10, -10], max: [10, 10, 10]}, 5, 'Vacuum');
  assert.ok(autoVac.count < autoAir.count, 'Vacuum auto domain uses tight padding');
});

test('buildThermalModel handles fallback material, additive heaters, fixed temperature, Fan rasterization and Probe sampling', () => {
  const d = computeManualDomain([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], 10); // 10x10x10 (10mm cells)
  const words = Math.ceil(d.count / 32);
  const occSolid = new Uint32Array(words);
  const occFixed = new Uint32Array(words);
  const setBit = (arr, x, y, z) => { const i = x + 10*(y + 10*z); arr[i >> 5] |= 1 << (i & 31); };
  // 2x2x2 block in center (x=4..5, y=4..5, z=4..5)
  for (let z = 4; z <= 5; z++) for (let y = 4; y <= 5; y++) for (let x = 4; x <= 5; x++) setBit(occSolid, x, y, z);
  setBit(occFixed, 3, 4, 4);

  // Fan box centered at [-25, 0, 0] mm, 10x40x40 mm blowing +X
  const fanWorld = [0.1,0,0,0, 0,0.4,0,0, 0,0,0.4,0, -25,0,0,1];
  const invFan = [10,0,0,0, 0,2.5,0,0, 0,0,2.5,0, 250,0,0,1];
  const model = buildThermalModel({
    domain: d, mediumName: 'Air', ambientC: 20, initialC: 20,
    solidBodies: [
      {material: resolveMaterialProps(null), fixedTempC: null, occupancy: occSolid, activeCount: 8, volumeM3: 8 * d.spacingM[0]**3},
      {material: resolveMaterialProps({Material: 'Copper'}), fixedTempC: 80, occupancy: occFixed, activeCount: 1, volumeM3: d.spacingM[0]**3}
    ],
    heaterSources: [
      {ownerHash: 'h1', uid: 'u1', powerW: 16, occupancy: occSolid, totalVolumeM3: 8 * d.spacingM[0]**3},
      {ownerHash: 'h2', uid: 'u2', powerW: -4, occupancy: occSolid, totalVolumeM3: 8 * d.spacingM[0]**3}
    ],
    fans: [{hash: 'f1', name: 'Fan', shutoffPressure: 25, freeFlow: 0.005, direction: 1, areaM2: 0.0016, thicknessM: 0.01, scales: [0.1, 0.4, 0.4], world: fanWorld, invWorld: invFan, axisWorld: [1,0,0], axisGrid: [1,0,0]}]
  });

  assert.equal(model.stats.solidCount, 9);
  assert.equal(model.stats.fixedCount, 1);
  assert.equal(model.stats.fallbackCount, 8);
  assert.ok(Math.abs(model.stats.totalHeaterPowerW - 12) < 1e-6);
  assert.ok(model.fans.length === 1 && model.fans[0].cellCount > 0, 'Fan cells rasterized into fluid');

  // Test post-processing and Probe sampling (no air-solid bleed)
  const theta = new Float32Array(d.count);
  for (let i = 0; i < d.count; i++) theta[i] = model.cellType[i] >= CELL_TYPE.SOLID ? 50 : 5;
  const ev = evaluateThermalFields(model, theta, null, [{hash: 'p1', name: 'Probe', worldMm: [0, 0, 0]}], 20);
  assert.ok(Math.abs(ev.maxSolidTempC - 70) < 1e-5);
  assert.equal(ev.probes[0].inside, true);
  assert.equal(ev.probes[0].isSolid, true);
  assert.ok(Math.abs(ev.probes[0].tempC - 70) < 1e-5, 'Probe in solid does not bleed cool air');
  const outRead = samplePointReading(model, ev.tempsC, ev.fluxWPerM2, null, [200, 0, 0]);
  assert.equal(outRead.inside, false);
});

test('activate registers operations, Attributes, helpers and allows arbitrarily rotated Fans', async () => {
  const m = makeMockContext();
  await activate(m.context);
  const owner = m.doc.create('thermal', null, 'Thermal');
  const createFan = m.operations.find(o => o.id === 'create-fan').run;
  const createProbe = m.operations.find(o => o.id === 'create-probe').run;
  const fanRes = await createFan(owner.nativeHash, {});
  const probeRes = await createProbe(owner.nativeHash, {});

  assert.equal(m.transactions, 2);
  const fanNode = m.doc.nodes.find(n => n.nativeHash === fanRes.hash);
  const probeNode = m.doc.nodes.find(n => n.nativeHash === probeRes.hash);
  assert.equal(fanNode.params.Thermal, owner.nativeHash);
  assert.equal(probeNode.params.Thermal, owner.nativeHash);
  assert.equal(fanNode.params['Shutoff pressure'], 25);
  assert.equal(fanNode.params['Free flow'], 0.005);

  // Rotate Fan by 45 degrees around Z -> still solverEligible!
  const c = Math.SQRT1_2, s = Math.SQRT1_2;
  m.locals.set(fanNode.nativeHash, [0.1*c, 0.1*s, 0, 0, -0.4*s, 0.4*c, 0, 0, 0, 0, 0.4, 0, -20, 5, 0, 1]);
  const meta = nativeFanMetadata(m.context, fanNode);
  assert.equal(meta.mapping.status, 'supported-frame');
  assert.equal(meta.mapping.solverEligible, true);
  assert.ok(Math.abs(meta.normalizedWorldAxis[0] - c) < 1e-9 && Math.abs(meta.normalizedWorldAxis[1] - s) < 1e-9);

  // Attributes checks
  const attrOwner = m.attributes(owner.nativeHash);
  assert.ok(attrOwner.actions.some(a => a.id === 'solve-steady' && a.label === 'Steady'));
  assert.ok(attrOwner.actions.some(a => a.id === 'solve-animation' && a.label === 'Animation'));
  assert.ok(attrOwner.actions.some(a => a.id === 'show-voxels'));
  assert.ok(attrOwner.actions.some(a => a.id === 'create-fan'));
  assert.ok(attrOwner.actions.some(a => a.id === 'create-probe'));
  assert.ok(attrOwner.numbers.some(x => x.id === 'slice-pos'));
  const attrFan = m.attributes(fanNode.nativeHash);
  assert.deepEqual(attrFan.hiddenFields, ['Thermal', 'Direction']);
  assert.equal(attrFan.labels['Shutoff pressure'], 'Pressure');
  const attrProbe = m.attributes(probeNode.nativeHash);
  assert.deepEqual(attrProbe.hiddenFields, ['Thermal']);

  // Viewport custom helpers include Fan arrow and Probe crosshair
  assert.ok(m.viewport.helpers.thermal_fan.lines.length > m.viewport.lines.length);
  assert.ok(m.viewport.helpers.thermal_probe.lines.length > m.viewport.lines.length);
  assert.equal(m.viewport.showHelper(owner.nativeHash, {'Auto size': false}), true);
  assert.equal(m.viewport.showHelper(owner.nativeHash, {'Auto size': true}), false);
});
