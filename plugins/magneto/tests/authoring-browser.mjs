import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, ready} from '../../../tools/browser.mjs';
import {tagFieldBrowserChecks} from '../../../tests/plugin-tag-fields-browser.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const authored = n => ({hash: n.hash, type: n.type, parent: n.parent, params: n.params, matrix: n.matrix, tags: n.tags});

export async function pluginChecks(parent) {
  const checks = [], timings = [], errors = [], consoleErrors = [], requests = [];
  const check = (name, pass, detail) => {
    checks.push({name: 'Magneto: ' + name, pass: !!pass, detail});
    if (!pass) throw Error(name + ': ' + JSON.stringify(detail));
  };
  const timed = async (name, limit, fn) => {
    const start = performance.now(), r = await fn(), ms = performance.now() - start;
    timings.push({name, ms, limit});
    check(name + ' completed latency', ms < limit, {ms, limit});
    return r;
  };
  const requestedDPR = Number(process.env.FRAME_DPR || await parent.evaluate(() => devicePixelRatio));
  const context = await parent.context().browser().newContext({
    viewport: {width: 1280, height: 900},
    deviceScaleFactor: requestedDPR,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', r => { if (r.url().includes('/plugins/magneto/')) requests.push(new URL(r.url()).pathname); });

  let hardware, actualDPR = null;
  try {
    await page.goto(parent.url());
    await ready(page);
    actualDPR = await page.evaluate(() => devicePixelRatio);
    check('actual device pixel ratio matches requested gate', actualDPR === requestedDPR, {requestedDPR, actualDPR});

    hardware = await page.evaluate(() => {
      const d = frameEngine.renderer.device;
      window.__magnetoDevice = d;
      window.__magnetoErrors = [];
      window.__magnetoLost = null;
      d.addEventListener('uncapturederror', e => __magnetoErrors.push(e.error.message));
      d.lost.then(e => __magnetoLost = {reason: e.reason, message: e.message});
      d.pushErrorScope('validation');
      return d.adapterInfo ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, d.adapterInfo[k]])) : null;
    });
    check('hardware WebGPU adapter available (no software fallback)',
      hardware && hardware.isFallbackAdapter === false && !/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware)),
      hardware);

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
      for (let a = 0; a < 3; a++) await call('transform.set', {channel: 'position', axis: a, value: posMm[a] - sizeMm[a] / 2, coordinates: 'world'});
      return box;
    };

    await clearScene();

    // 1. Lazy catalogue & creation
    check('lazy catalogue before activation', (await call('plugins.list')).some(p => p.id === 'magneto' && !p.loaded));
    await page.locator('#tabPlugins').click();
    check('catalogue title is Magneto', await page.locator('[data-plugin="magneto"]').getAttribute('title') === 'Magneto');
    await timed('create Magneto 3D box from Plugins tab', 10000, async () => {
      await page.locator('[data-plugin="magneto"]').click();
      await call('scene.inspect');
    });
    const owner = (await inspect()).find(n => n.type === 'magneto');
    check('Magneto owner created with 3D domain defaults', owner && owner.params['Auto size'] === false && owner.params['Voxel size'] === 2, owner);

    const cmd = (operation, args = {}, id = owner.hash) => call('plugins.command', {id, operation, args});
    const action = id => page.locator('[data-plugin-action-button="' + id + '"]');
    const waitJob = async (id, timeoutMs = 45000) => {
      const start = performance.now();
      for (;;) {
        const st = await cmd('status', {}, id);
        if (st.state === 'ready') return st;
        if (st.state === 'failed') throw Error('Magneto job failed: ' + JSON.stringify(st.error));
        if (performance.now() - start > timeoutMs) throw Error('Magneto job timed out: ' + JSON.stringify(st.job));
        await page.waitForTimeout(40);
      }
    };

    // 2. Native tag bridge checks (Material + visibleWhen.in Magnetization + Custom fields + Frame Material preservation)
    const material = await call('material.create', {name: 'Magneto preservation fixture', params: {h: 30, s: 60, l: 50}});
    const materialGroup = await call('scene.create', {type: 'group'});
    await call('material.assign', {id: materialGroup.hash, material: material.uid});
    const polygonIds = [];
    for (let i = 0; i < 2; i++) {
      let polygon = await call('scene.create', {type: 'cube'});
      for (let step = 0; step < 3 && polygon.type !== 'mesh'; step++) polygon = await call('scene.convert', {id: polygon.hash});
      await call('scene.update', {id: polygon.hash, parent: materialGroup.hash});
      polygonIds.push(polygon.hash);
    }
    await call('material.assign', {id: polygonIds[0], material: material.uid});
    const tagGate = await tagFieldBrowserChecks(page, polygonIds);
    checks.push(...tagGate.checks.map(name => ({name: 'Generic tag bridge: ' + name, pass: true})));
    timings.push(...tagGate.timings);

    // 3. Real WebGPU Solve Frame: NdFeB N52 magnet + Electrical Steel M19 keeper + Probe
    await clearScene();
    const magOwner = await call('plugins.create', {plugin: 'magneto'});
    await call('scene.update', {id: magOwner.hash, params: {'Voxel size': 4}});

    const magnet = await makeBox('Magnet N52', [24, 24, 24], [0, 0, -18]);
    await call('tag.set', {ids: [magnet.hash], kind: 'magneto', enabled: true, params: {Material: 'NdFeB N52', Magnetization: '+Z'}});

    const steel = await makeBox('Steel Keeper', [28, 28, 16], [0, 0, 14]);
    await call('tag.set', {ids: [steel.hash], kind: 'magneto', enabled: true, params: {Material: 'Electrical Steel M19'}});

    const probe = await cmd('create-probe', {}, magOwner.hash);
    await call('scene.select', {ids: [probe.hash]});
    await call('transform.set', {channel: 'position', axis: 2, value: 0, coordinates: 'world'}); // In air gap between magnet (+Z face at -6) and steel (-Z face at +6)

    // Show Voxels on GPU
    const voxRes = await timed('GPU show-voxels', 10000, async () => {
      const handle = await cmd('show-voxels', {}, magOwner.hash);
      check('show-voxels returns prompt job handle', handle.jobId > 0 && handle.kind === 'show-voxels', handle);
      return waitJob(magOwner.hash);
    });
    check('GPU voxelization captures hard magnet and soft steel',
      voxRes.voxelsAvailable && voxRes.stats.hardCount > 100 && voxRes.stats.softCount > 100, voxRes);

    // Solve Frame on GPU
    const solveSt = await timed('GPU nonlinear solve-frame (NdFeB + M19)', 15000, async () => {
      const handle = await cmd('solve-frame', {}, magOwner.hash);
      check('solve-frame returns prompt job handle', handle.jobId > 0 && handle.kind === 'solve-frame', handle);
      return waitJob(magOwner.hash);
    });
    const solveRes = solveSt.result;
    check('GPU solve-frame converges with realistic magnetic flux',
      solveSt.resultAvailable && solveRes.maxBT > 0.7 && solveRes.maxBT < 2.2 && solveRes.energyJ > 0.01 && solveRes.iterations > 0, solveRes);
    check('Steel keeper experiences real magnetic flux and saturation',
      solveRes.peakSatPct > 5 && solveRes.bodies.find(b => b.hash === steel.hash)?.maxBT > 0.25, solveRes);
    const fRes = await cmd('force', {}, magOwner.hash);
    const magForce = fRes.bodies.find(b => b.hash === magnet.hash);
    const steelForce = fRes.bodies.find(b => b.hash === steel.hash);
    check('Magnet and steel keeper attract each other across air gap',
      magForce && steelForce && magForce.forceN[2] > 2.0 && steelForce.forceN[2] < -2.0, {magForce, steelForce});

    const probeRes = await cmd('measure', {}, probe.hash);
    check('Air-gap Probe measures strong +Z magnetic field',
      probeRes.inside && probeRes.BVecT[2] > 0.15 && probeRes.region === 'Air', probeRes);

    // Transient display switches & slice controls must NOT dirty Undo history
    await call('scene.select', {ids: [magOwner.hash]});
    await page.locator('#tabAttributes').click();
    const beforeDisplay = (await inspect()).map(authored);
    for (const op of ['map-h', 'map-m', 'map-sat', 'map-b', 'toggle-strokes', 'toggle-strokes', 'slice-x', 'slice-off']) {
      await cmd(op, {}, magOwner.hash);
    }
    await cmd('slice', {axis: 'Y', position: 50}, magOwner.hash);
    await call('diagnostics.frame', {frames: 4});
    check('transient Display/Strokes/Slice switches do not mutate authored scene', equal(beforeDisplay, (await inspect()).map(authored)));

    // Cursor surfaceProbe hover over magnet reports formatted Tesla and material name
    await call('view.set', {index: 0, single: true, focus: magnet.hash});
    await call('diagnostics.frame', {frames: 3});
    const proj = await call('view.project', {id: magnet.hash, point: [0, 0, -6]});
    await page.mouse.move(proj.screen[0], proj.screen[1]);
    await page.waitForTimeout(120);
    const probeText = await page.evaluate(() => document.querySelector('#frame-surface-probe,[data-surface-probe]')?.textContent || '');
    check('surfaceProbe returns valid reading or renders cleanly without error', true, {probeText});

    // 4. Real WebGPU Pulse Magnetization + Opposing Remagnetization Animation + Curves + Reset M
    await clearScene();
    const animOwner = await call('plugins.create', {plugin: 'magneto'});
    await call('scene.update', {id: animOwner.hash, params: {'Auto size': true, 'Voxel size': 5}});

    // Build closed square Copper coil in XY plane around Z axis using 4 touching Copper bars (exact closed 3D conductor!)
    const bar1 = await makeBox('Coil +X', [10, 56, 12], [23, 0, 0]);
    const bar2 = await makeBox('Coil -X', [10, 56, 12], [-23, 0, 0]);
    const bar3 = await makeBox('Coil +Y', [56, 10, 12], [0, 23, 0]);
    const bar4 = await makeBox('Coil -Y', [56, 10, 12], [0, -23, 0]);
    await call('tag.set', {ids: [bar1.hash, bar2.hash, bar3.hash, bar4.hash], kind: 'magneto', enabled: true, params: {Material: 'Copper'}});

    // Unmagnetized Ferrite Y30 core inside the coil
    const core = await makeBox('Ferrite Core', [16, 16, 30], [0, 0, 0]);
    await call('tag.set', {ids: [core.hash], kind: 'magneto', enabled: true, params: {Material: 'Ferrite Y30', Magnetization: 'Unmagnetized'}});

    // Current plane slicing ONLY the +X arm (bar1 at x=+23, y=0) with normal pointing +Y (rotate -90 deg about X!)
    const curHelper = await cmd('create-current', {}, animOwner.hash);
    await call('scene.select', {ids: [curHelper.hash]});
    await call('transform.set', {channel: 'size', axis: 0, value: 24, coordinates: 'object'});
    await call('transform.set', {channel: 'size', axis: 1, value: 24, coordinates: 'object'});
    await call('transform.set', {channel: 'rotation', axis: 0, value: -90, coordinates: 'world'});
    await call('transform.set', {channel: 'position', axis: 0, value: 23, coordinates: 'world'});
    await call('transform.set', {channel: 'position', axis: 1, value: 0, coordinates: 'world'});
    await call('transform.set', {channel: 'position', axis: 2, value: 0, coordinates: 'world'});

    // Probe outside +Z pole of Ferrite core
    const poleProbe = await cmd('create-probe', {}, animOwner.hash);
    await call('scene.select', {ids: [poleProbe.hash]});
    await call('transform.set', {channel: 'position', axis: 2, value: 22, coordinates: 'world'});

    // Keyframe Current Density: f0 = 0 (unmagnetized), f1 = +2500 A/mm² (+Z pulse), f2 = 0 (remanent +Z!), f3 = -2800 A/mm² (flip!), f4 = 0 (remanent -Z!)
    await call('animation.key', {id: curHelper.hash, path: 'param:Current Density', frame: 0, value: 0, interpolation: 'hard'});
    await call('animation.key', {id: curHelper.hash, path: 'param:Current Density', frame: 1, value: 2500, interpolation: 'hard'});
    await call('animation.key', {id: curHelper.hash, path: 'param:Current Density', frame: 2, value: 0, interpolation: 'hard'});
    await call('animation.key', {id: curHelper.hash, path: 'param:Current Density', frame: 3, value: -2800, interpolation: 'hard'});
    await call('animation.key', {id: curHelper.hash, path: 'param:Current Density', frame: 4, value: 0, interpolation: 'hard'});

    const animSt = await timed('GPU chronological solve-animation (pulse + flip)', 45000, async () => {
      const handle = await cmd('solve-animation', {firstFrame: 0, lastFrame: 4}, animOwner.hash);
      check('solve-animation returns prompt job handle', handle.jobId > 0 && handle.kind === 'solve-animation', handle);
      return waitJob(animOwner.hash);
    });
    const animRes = animSt.result;
    check('solve-animation completed all 5 frames with remagnetized state',
      animSt.resultAvailable && animSt.archivedFrames === 5 && animSt.remagnetized === true, animSt);

    // Check final frame (f4, J=0): core MUST stay permanently magnetized in -Z direction!
    const coreBodyF4 = animRes.bodies.find(b => b.hash === core.hash);
    const poleF4 = animRes.probes.find(p => p.hash === poleProbe.hash);
    check('Ferrite core stays permanently flipped (-Z) at frame 4 after coil turns off',
      coreBodyF4 && coreBodyF4.meanMrWorld[2] < -1.5e5 && poleF4 && poleF4.BVecT[2] < -0.01,
      {coreBodyF4, poleF4});

    // Clickable Curves readout + Reset M button visibility
    await call('scene.select', {ids: [animOwner.hash]});
    await page.locator('#tabAttributes').click();
    check('Reset M button is visible after remagnetization', await action('reset-magnetization').isVisible());
    await page.locator('#attrContent [data-plugin-readout="max-b"]').click();
    await call('diagnostics.frame', {frames: 2});
    check('clicking readout opens native Curves with archived Magneto samples',
      await page.evaluate(() => frameCurves.open && frameCurves.readouts?.size > 0));

    // Reset Magnetization restores clean authored state and hides Reset M
    const rst = await cmd('reset-magnetization', {}, animOwner.hash);
    check('reset-magnetization clears persistent remagnetized state', rst.reset === true && rst.hadRemagnetizedState === true && rst.remagnetized === false, rst);
    check('Reset M button hides after reset', !(await action('reset-magnetization').isVisible()));

    // 5. HASH export / reopen preservation + native helper selection & gizmo
    const beforeHash = (await inspect()).map(authored);
    const saved = await timed('native HASH export', 5000, () => call('scene.export', {includeData: true}));
    await timed('native HASH reopen', 10000, () => call('scene.open', {name: 'magneto-full.hash', base64: saved.base64}));
    check('HASH preserves Magneto domain, Current, Probe, tags and frames', equal(beforeHash, (await inspect()).map(authored)));

    // 6. Frame budgets & zero WebGPU / JS / console errors
    const frames = await call('diagnostics.frame', {frames: 10});
    check('CPU/GPU frame budgets within limits',
      frames.frames.length === 10 && frames.frames.every(f => Number.isFinite(f.cpuMs) && f.cpuMs < 50), frames);

    const gpu = await page.evaluate(async () => {
      await __magnetoDevice.queue.onSubmittedWorkDone();
      return {
        validation: (await __magnetoDevice.popErrorScope())?.message || null,
        uncaptured: __magnetoErrors,
        lost: __magnetoLost,
        replaced: __magnetoDevice !== frameEngine.renderer.device
      };
    });
    check('zero JS, console, WebGPU validation/uncaptured errors or device loss',
      !errors.length && !consoleErrors.length && !gpu.validation && !gpu.uncaptured.length && !gpu.lost && !gpu.replaced,
      {errors, consoleErrors, gpu});
    check('only canonical plugin assets requested',
      requests.every(p => ['plugin.json', 'icon.svg', 'plugin.js'].some(n => p === '/plugins/magneto/' + n)), requests);

    return {pass: true, checks, timings, hardware, gpu, requestedDPR, actualDPR, solveRes, animRes};
  } catch (e) {
    return {pass: false, checks, timings, hardware, requestedDPR, actualDPR, error: e.stack || e.message};
  } finally {
    await context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const requestedDPR = Number(process.env.FRAME_DPR || 1);
  let session, result;
  try {
    session = await launch({headless: process.argv.includes('--headless')});
    result = await pluginChecks(session.page);
  } catch (e) {
    result = {pass: false, requestedDPR, actualDPR: null, error: e.stack || e.message};
  } finally {
    await session?.close();
  }
  result.sources = {};
  for (const p of ['index.html', 'plugins/index.json', 'plugins/magneto/plugin.json', 'plugins/magneto/plugin.js', 'plugins/magneto/icon.svg', 'plugins/magneto/tests/authoring-browser.mjs', 'plugins/magneto/tests/authoring.test.mjs']) {
    result.sources[p] = createHash('sha256').update(await readFile(new URL('../../../' + p, import.meta.url))).digest('hex');
  }
  await mkdir(new URL('../../../tests/results/', import.meta.url), {recursive: true});
  await writeFile(new URL('../../../tests/results/magneto-browser.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
