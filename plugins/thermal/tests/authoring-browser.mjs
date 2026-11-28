import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, ready} from '../../../tools/browser.mjs';
import {isHardwareAdapter, isDecodedNativeIcon, hasBoundedFrameTimings} from './browser-gates.mjs';
import {nativeProbeBrowserChecks} from './native-probe-browser.mjs';
import {helperNavigationChecks} from './navigation-browser.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FAN_FRAME = [0.1, 0, 0, 0, 0.4, 0, 0, 0, 0.4, -30, 0, 0];
const STEFAN_BOLTZMANN = 5.670374419e-8;

export async function thermalBrowserChecks(parent, check, timed) {
  const context = await parent.context().browser().newContext({
    viewport: {width: 1280, height: 900},
    deviceScaleFactor: Number(process.env.FRAME_DPR || 1),
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));

  try {
    await page.goto(parent.url());
    await ready(page);

    const hardware = await page.evaluate(() => {
      const d = frameEngine.renderer.device;
      window.__thermalGPU = [];
      window.__thermalLost = null;
      d.addEventListener('uncapturederror', e => __thermalGPU.push(e.error.message));
      d.lost.then(e => __thermalLost = {reason: e.reason, message: e.message});
      d.pushErrorScope('validation');
      return d.adapterInfo ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, d.adapterInfo[k]])) : null;
    });
    check('Thermal uses identifiable hardware WebGPU', isHardwareAdapter(hardware), hardware);

    const call = (name, args = {}) => page.evaluate(([name, args]) => frameAI.call(name, args), [name, args]);
    const inspect = async () => (await call('scene.inspect')).objects;
    const clearScene = async () => {
      const objs = await inspect();
      const roots = objs.filter(n => !n.parent).map(n => n.hash);
      if (roots.length) await call('scene.delete', {ids: roots});
    };
    const makeBox = async (name, sizeMm, posMm) => {
      const box = await call('scene.create', {type: 'cube', name});
      await call('scene.select', {ids: [box.hash]});
      for (let a = 0; a < 3; a++) await call('transform.set', {channel: 'size', axis: a, value: sizeMm[a], coordinates: 'object'});
      // Cube primitive origin is minimum corner -> center at posMm
      for (let a = 0; a < 3; a++) await call('transform.set', {channel: 'position', axis: a, value: posMm[a] - sizeMm[a] / 2, coordinates: 'world'});
      return box;
    };

    await clearScene();

    // 1. Lazy catalogue + 32px native icon
    const catalogue = await call('plugins.list');
    check('catalogue contains lazy Thermal plugin', catalogue.some(p => p.id === 'thermal' && !p.loaded), catalogue);
    await page.locator('#tabPlugins').click();
    const icon = await page.locator('[data-plugin="thermal"] img').evaluate(async img => {
      await img.decode();
      const rect = img.getBoundingClientRect();
      return {decoded: true, complete: img.complete, width: img.width, height: img.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, rect: {width: rect.width, height: rect.height}};
    });
    check('native Thermal icon decodes at 32x32', isDecodedNativeIcon(icon), icon);

    // 2. Owner, Fan, Probe creation + Custom Material tag visibleWhen UI
    const owner = await timed('Thermal owner creation', 10000, () => call('plugins.create', {plugin: 'thermal'}));
    const cmd = (operation, args = {}, id = owner.hash) => call('plugins.command', {id, operation, args});

    const fanRes = await timed('Fan creation', 5000, () => cmd('create-fan'));
    const fanObj = (await inspect()).find(n => n.hash === fanRes.hash);
    check('Fan has 10x40x40 mm frame and realistic 25 Pa / 0.005 m3/s defaults',
      fanObj && equal(fanObj.matrix, FAN_FRAME) && fanObj.params['Shutoff pressure'] === 25 && fanObj.params['Free flow'] === 0.005, fanObj);

    const probeRes = await cmd('create-probe');
    await call('scene.select', {ids: [fanRes.hash]});
    await page.locator('#tabAttributes').click();
    const fanUI = await page.locator('#attrContent').evaluate(el => ({
      hidden: el.querySelectorAll('[data-field="Thermal"],[data-field="Direction"]').length,
      pressure: el.querySelector('[data-field="Shutoff pressure"]')?.closest('.attr-row')?.querySelector('.attr-lab')?.textContent
    }));
    check('Fan UI hides Thermal/Direction and labels Pressure (Pa)', fanUI.hidden === 0 && fanUI.pressure === 'Pressure (Pa)', fanUI);

    // Verify Custom Material tag conditional fields in Attributes UI (real click on tag badge!)
    const testCube = await makeBox('MatTest', [20, 20, 20], [0, 0, 0]);
    await call('tag.set', {ids: [testCube.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Aluminium 6061'}});
    await page.locator('.ob-tag.thermal_material').first().click();
    const hiddenPreset = await page.locator('#attrContent').evaluate(el => ({
      mat: el.querySelector('[data-field="Material"]')?.textContent,
      customFields: el.querySelectorAll('[data-field="Conductivity"],[data-field="Density"],[data-field="Specific heat"],[data-field="Emissivity"]').length
    }));
    check('Custom material fields are hidden for preset Aluminium 6061', hiddenPreset.mat === 'Aluminium 6061' && hiddenPreset.customFields === 0, hiddenPreset);

    await call('tag.set', {ids: [testCube.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 120, Density: 3000, 'Specific heat': 800, Emissivity: 0.5}});
    await page.locator('.ob-tag.thermal_material').first().click();
    const shownCustom = await page.locator('#attrContent').evaluate(el => ({
      mat: el.querySelector('[data-field="Material"]')?.textContent,
      customFields: el.querySelectorAll('[data-field="Conductivity"],[data-field="Density"],[data-field="Specific heat"],[data-field="Emissivity"]').length
    }));
    check('Custom material reveals all 4 attribute inputs', shownCustom.mat === 'Custom' && shownCustom.customFields === 4, shownCustom);

    // HASH roundtrip with tags + Fan + Probe
    const saved = await call('scene.export', {includeData: true});
    await call('scene.open', {name: 'thermal-roundtrip.hash', base64: saved.base64});
    const afterOpen = await inspect();
    check('HASH preserves Thermal owner, Fan, Probe and Custom Material tag',
      afterOpen.some(n => n.hash === owner.hash && n.type === 'thermal') &&
      afterOpen.some(n => n.hash === fanRes.hash && n.params.Thermal === owner.hash) &&
      afterOpen.some(n => n.hash === probeRes.hash && n.params.Thermal === owner.hash), afterOpen);

    // 3. PHYSICS ORACLE 1: 1D Composite Two-Material Steady Conduction in Vacuum (emissivity = 0)
    // Left Fixed 100°C [-40..-30], Half A k=200 [-30..0], Half B k=100 [0..30], Right Fixed 20°C [30..40]
    // Analytic interface T(x=0) = (200*100 + 100*20) / (200 + 100) = 73.333 °C!
    await clearScene();
    const th1 = await call('plugins.create', {plugin: 'thermal'});
    await call('scene.update', {id: th1.hash, params: {'Auto size': true, 'Voxel size': 5, Medium: 'Vacuum', Ambient: 20, Initial: 20}});
    const leftEnd = await makeBox('HotEnd', [10, 20, 20], [-35, 0, 0]);
    const halfA = await makeBox('BarA', [30, 20, 20], [-15, 0, 0]);
    const halfB = await makeBox('BarB', [30, 20, 20], [15, 0, 0]);
    const rightEnd = await makeBox('ColdEnd', [10, 20, 20], [35, 0, 0]);
    await call('tag.set', {ids: [leftEnd.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 200, Density: 2700, 'Specific heat': 900, Emissivity: 0}});
    await call('tag.set', {ids: [leftEnd.hash], kind: 'thermal_temperature', enabled: true, params: {Temperature: 100}});
    await call('tag.set', {ids: [halfA.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 200, Density: 2700, 'Specific heat': 900, Emissivity: 0}});
    await call('tag.set', {ids: [halfB.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 100, Density: 2700, 'Specific heat': 900, Emissivity: 0}});
    await call('tag.set', {ids: [rightEnd.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 100, Density: 2700, 'Specific heat': 900, Emissivity: 0}});
    await call('tag.set', {ids: [rightEnd.hash], kind: 'thermal_temperature', enabled: true, params: {Temperature: 20}});

    const pInt = await call('plugins.command', {id: th1.hash, operation: 'create-probe', args: {}});
    // Probe sits at x=0, y=0, z=0 right at the k=200 / k=100 interface!
    const res1 = await timed('Oracle 1: composite 1D conduction steady solve', 15000, () => call('plugins.command', {id: th1.hash, operation: 'solve-steady', args: {}}));
    const mInt = await call('plugins.command', {id: pInt.hash, operation: 'measure', args: {}});
    const expectedInt = (200 * 100 + 100 * 20) / (200 + 100); // 73.333 °C
    const expectedFluxW = (80 / (0.03 / 200 + 0.03 / 100)) * (0.02 * 0.02); // ~71.11 W
    check('Oracle 1: harmonic interface temperature matches analytic 73.33 °C within 2.5 °C',
      mInt.inside && Math.abs(mInt.tempC - expectedInt) < 2.5, {measured: mInt.tempC, expected: expectedInt});
    check('Oracle 1: steady-state energy balance heatIn ≈ heatOut',
      res1.heatInW > 30 && Math.abs(res1.heatInW - res1.heatOutW) / res1.heatInW < 0.03,
      {heatInW: res1.heatInW, heatOutW: res1.heatOutW, expectedFluxW});

    // 4. PHYSICS ORACLE 2: Stefan-Boltzmann Radiation in Vacuum + NO_HEAT_SINK guard
    await clearScene();
    const th2 = await call('plugins.create', {plugin: 'thermal'});
    await call('scene.update', {id: th2.hash, params: {'Auto size': true, 'Voxel size': 5, Medium: 'Vacuum', Ambient: 20, Initial: 20}});
    const radBox = await makeBox('RadCube', [40, 40, 40], [0, 0, 0]);
    await call('tag.set', {ids: [radBox.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 200, Density: 2700, 'Specific heat': 900, Emissivity: 0}});
    await call('tag.set', {ids: [radBox.hash], kind: 'thermal_heater', enabled: true, params: {Power: 20}});
    const noSinkErr = await page.evaluate(async id => {
      try { await frameAI.call('plugins.command', {id, operation: 'solve-steady', args: {}}); return null; }
      catch (e) { return e.code || e.message; }
    }, th2.hash);
    check('Oracle 2a: Vacuum with Emissivity=0 and no Temperature boundary rejects cleanly', !!noSinkErr, noSinkErr);

    await call('tag.set', {ids: [radBox.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Anodized Aluminium'}}); // eps = 0.85
    const res2 = await timed('Oracle 2b: Stefan-Boltzmann radiation steady solve', 15000, () => call('plugins.command', {id: th2.hash, operation: 'solve-steady', args: {}}));
    // Surface area of 40mm cube = 6 * 0.04^2 = 0.0096 m^2; T_K = (293.15^4 + 20 / (0.85 * sigma * 0.0096))^0.25
    const tAmbK = 293.15, areaM2 = 6 * 0.04 * 0.04;
    const expectedRadC = Math.pow(Math.pow(tAmbK, 4) + 20 / (0.85 * STEFAN_BOLTZMANN * areaM2), 0.25) - 273.15;
    check('Oracle 2b: Vacuum radiation temperature matches Stefan-Boltzmann analytic equilibrium',
      Math.abs(res2.maxTempC - expectedRadC) < 12 && Math.abs(res2.radiatedOutW - 20) / 20 < 0.05,
      {measuredC: res2.maxTempC, expectedC: expectedRadC, radiatedOutW: res2.radiatedOutW});

    // 5. PHYSICS ORACLE 3: Adiabatic Transient Calorimetry (solve-animation) + Fallback Default Material
    await clearScene();
    const th3 = await call('plugins.create', {plugin: 'thermal'});
    await call('scene.update', {id: th3.hash, params: {'Auto size': true, 'Voxel size': 5, Medium: 'Vacuum', Ambient: 20, Initial: 20, 'Time scale': 10}});
    const calBox = await makeBox('CalCube', [40, 40, 40], [0, 0, 0]);
    await call('tag.set', {ids: [calBox.hash], kind: 'thermal_material', enabled: true, params: {Material: 'Custom', Conductivity: 150, Density: 2700, 'Specific heat': 900, Emissivity: 0}});
    await call('tag.set', {ids: [calBox.hash], kind: 'thermal_heater', enabled: true, params: {Power: 50}});
    const pCal = await call('plugins.command', {id: th3.hash, operation: 'create-probe', args: {}});
    const res3 = await timed('Oracle 3: transient calorimetry solve-animation (30 frames)', 20000, () => call('plugins.command', {id: th3.hash, operation: 'solve-animation', args: {firstFrame: 0, lastFrame: 30}}));
    // V = 0.04^3 = 6.4e-5 m^3; C = 2700 * 900 * 6.4e-5 = 155.52 J/K; t = 30/60 * 10 = 5 s; E = 250 J -> dT = 1.6075 °C -> T = 21.6075 °C
    const expectedCalC = 20 + (50 * res3.elapsedSeconds) / (2700 * 900 * Math.pow(0.04, 3));
    const st3 = await call('plugins.command', {id: th3.hash, operation: 'status', args: {}});
    check('Oracle 3: adiabatic transient calorimetry matches analytic dT = P*t/(rho*cp*V)',
      Math.abs(res3.maxTempC - expectedCalC) < 0.15 && st3.archivedFrames === 31,
      {measuredC: res3.maxTempC, expectedC: expectedCalC, elapsedS: res3.elapsedSeconds, archivedFrames: st3.archivedFrames});
    const mCal = await call('plugins.command', {id: pCal.hash, operation: 'measure', args: {}});
    check('Oracle 3: Probe measures transient calorimetry temperature', mCal.inside && Math.abs(mCal.tempC - expectedCalC) < 0.15, mCal);

    // 6. PHYSICS ORACLE 4: Air CHT — Fallback Default Material + Natural Convection vs Rotated Fan Cooling + Slice & Display Modes
    await clearScene();
    const th4 = await call('plugins.create', {plugin: 'thermal'});
    await call('scene.update', {id: th4.hash, params: {'Auto size': true, 'Voxel size': 5, Medium: 'Air', Ambient: 20, Initial: 20}});
    const chip = await makeBox('HeatedBlock', [30, 30, 30], [0, 0, 0]);
    // Deliberately NO Material tag -> tests fallback Aluminium 6061!
    await call('tag.set', {ids: [chip.hash], kind: 'thermal_heater', enabled: true, params: {Power: 15}});

    const voxRes = await timed('Show Voxels with fallback material', 10000, () => call('plugins.command', {id: th4.hash, operation: 'show-voxels', args: {}}));
    check('Fallback default material activates when Heater lacks Material tag',
      voxRes.stats.solidCount > 0 && voxRes.stats.fallbackCount === voxRes.stats.solidCount, voxRes.stats);

    const resNat = await timed('Oracle 4a: Air natural convection CHT steady solve', 20000, () => call('plugins.command', {id: th4.hash, operation: 'solve-steady', args: {}}));
    check('Oracle 4a: Natural convection heats solid above Ambient with buoyant airflow',
      resNat.maxTempC > 35 && resNat.maxTempC < 400 && resNat.maxFlowMs > 0.02, resNat);

    // Add a Fan (rotated 15° to test arbitrary 3D orientation!) blowing across the heated block
    const fan4 = await call('plugins.command', {id: th4.hash, operation: 'create-fan', args: {}});
    await call('scene.select', {ids: [fan4.hash]});
    await call('transform.set', {channel: 'position', axis: 0, value: -35, coordinates: 'world'});
    await call('transform.set', {channel: 'rotation', axis: 2, value: 15, coordinates: 'object'});
    await call('scene.update', {id: fan4.hash, params: {'Shutoff pressure': 40, 'Free flow': 0.008}});
    const fanMeta = await call('plugins.command', {id: fan4.hash, operation: 'fan-inputs', args: {}});
    check('Rotated Fan reports solverEligible: true', fanMeta.solverEligible === true, fanMeta);

    const resFan = await timed('Oracle 4b: Air forced Fan CHT steady solve', 20000, () => call('plugins.command', {id: th4.hash, operation: 'solve-steady', args: {}}));
    check('Oracle 4b: Forced Fan airflow cools solid strictly below natural convection and increases maxFlowMs',
      resFan.maxFlowMs > resNat.maxFlowMs * 1.5 && resFan.maxTempC < resNat.maxTempC - 2.0,
      {natural: {T: resNat.maxTempC, v: resNat.maxFlowMs}, forced: {T: resFan.maxTempC, v: resFan.maxFlowMs}});

    // Exercise every display mode + Slice axes + live rendering frames
    for (const op of ['map-temp', 'map-flux', 'map-flow', 'map-voxels', 'map-temp']) {
      await call('plugins.command', {id: th4.hash, operation: op, args: {}});
      await call('diagnostics.frame', {frames: 2});
    }
    for (const axis of ['X', 'Y', 'Z', 'Off']) {
      await call('plugins.command', {id: th4.hash, operation: 'slice', args: {axis, position: 50}});
      await call('diagnostics.frame', {frames: 2});
    }
    await call('view.set', {index: 0, single: true, focus: th4.hash});
    const afterFrames = await call('diagnostics.frame', {frames: 12});
    check('Thermal smooth 3D-texture + slice rendering keeps bounded CPU/GPU frame timings', hasBoundedFrameTimings(afterFrames), afterFrames);

    const gpu = await page.evaluate(async () => {
      await frameEngine.renderer.device.queue.onSubmittedWorkDone();
      return {
        validation: (await frameEngine.renderer.device.popErrorScope())?.message || null,
        errors: __thermalGPU,
        lost: __thermalLost
      };
    });
    check('Zero WebGPU validation, uncaptured or page errors across full Thermal CHT suite',
      !gpu.validation && !gpu.errors.length && !gpu.lost && !errors.length, {gpu, errors});

    return {hardware, gpu, res1, res2, res3, resNat, resFan, afterFrames};
  } finally {
    await context.close();
  }
}

export async function pluginChecks(page) {
  const checks = [], timings = [];
  const check = (name, pass, detail) => {
    checks.push({name: 'Thermal: ' + name, pass: !!pass, detail});
    if (!pass) throw Error(name + ': ' + JSON.stringify(detail));
  };
  const timed = async (name, limit, fn) => {
    const started = performance.now(), value = await fn(), ms = performance.now() - started;
    timings.push({name, ms, limit});
    check(name + ' latency', ms < limit, {ms, limit});
    return value;
  };
  try {
    const cht = await thermalBrowserChecks(page, check, timed);
    const probe = await nativeProbeBrowserChecks(page, check, timed);
    const navigation = await helperNavigationChecks(page, check, timed);
    return {pass: true, checks, timings, evidence: {cht, probe, navigation}, hardwareVerified: true};
  } catch (error) {
    return {pass: false, checks, timings, error: error.stack, hardwareVerified: false};
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let session, result;
  try {
    session = await launch({headless: process.argv.includes('--headless')});
    result = await pluginChecks(session.page);
  } catch (error) {
    result = {pass: false, checks: [], timings: [], hardwareVerified: false, error: error.stack};
  } finally {
    await session?.close();
  }
  result.sources = {};
  for (const p of ['index.html', 'plugins/index.json', 'plugins/thermal/plugin.js', 'plugins/thermal/plugin.json', 'plugins/thermal/tests/authoring-browser.mjs']) {
    result.sources[p] = createHash('sha256').update(await readFile(new URL('../../../' + p, import.meta.url))).digest('hex');
  }
  await mkdir(new URL('../../../tests/results/', import.meta.url), {recursive: true});
  await writeFile(new URL('../../../tests/results/thermal-cht-browser.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
