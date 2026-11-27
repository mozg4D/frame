import { ready } from '../../../tools/browser.mjs';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

// Each run owns its scene/browser context; no user or parent fixture is edited.
export async function pluginChecks(parent) {
  const context = await parent.context().browser().newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const checks = [], timings = [];
  const check = (name, pass, detail) => {
    checks.push({ name: 'Cut: ' + name, pass: !!pass, detail });
    if (!pass) throw Error(name + ': ' + JSON.stringify(detail));
  };
  const call = (name, args = {}) => page.evaluate(([name, args]) => frameAI.call(name, args), [name, args]);
  const timed = async (name, fn) => {
    const t = performance.now();
    const value = await fn();
    const ms = performance.now() - t;
    timings.push({ name, ms, limit: 8000 });
    check(name + ' latency', ms < 8000, { ms });
    return value;
  };
  const command = (id, operation, args = {}) => call('plugins.command', { id, operation, args });
  const waitComplete = async (id, timeoutMs = 10000) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const st = await command(id, 'status');
      if (st.state === 'complete' || st.state === 'error') return st;
      await page.waitForTimeout(25);
    }
    throw Error('Cut generate timed out');
  };

  try {
    await page.goto(parent.url());
    await ready(page);

    const hardware = await page.evaluate(() => {
      const d = frameEngine.renderer.device;
      window.__cutErrors = [];
      d.addEventListener('uncapturederror', e => __cutErrors.push(e.error.message));
      d.pushErrorScope('validation');
      const h = d.adapterInfo;
      return h ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, h[k]])) : null;
    });
    check('real hardware WebGPU', hardware && hardware.isFallbackAdapter === false && !/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(hardware)), hardware);

    await call('scene.new');
    await page.evaluate(() => localStorage.removeItem('frame.cut.settings'));

    // Verify unified window.frameCore exposes spline & geometry for plugins
    const coreReady = await page.evaluate(() => !!(window.frameCore?.engine && window.frameCore?.spline && window.frameCore?.geometry && window.frameCore?.nodes));
    check('unified core exposed to plugins', coreReady);

    // 1. Authoring, settings persistence, Undo/Redo, CAS, HASH roundtrip
    await page.locator('#tabPlugins').click();
    const icon = page.locator('[data-plugin="cut"] img');
    check('native 32px icon', await icon.evaluate(async e => {
      await e.decode();
      const r = e.getBoundingClientRect();
      return e.naturalWidth === 32 && e.naturalHeight === 32 && r.width === 32 && r.height === 32;
    }));
    await timed('native icon create', () => page.locator('[data-plugin="cut"]').click());
    const rows = async () => (await call('scene.inspect')).objects;
    const a = (await rows()).find(n => n.type === 'cut');
    const id = a.hash;

    const s0 = await command(id, 'status');
    check('ready CAM status', !s0.authoringOnly && s0.generationAvailable && !s0.resultAvailable && s0.job === null, s0);
    check('native initial identity frame', a.matrix && a.matrix.every((v, i) => v === [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0][i]), a);
    check('native origin pivot', JSON.stringify(a.pivot) === JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), a.pivot);

    await page.locator('#tabAttributes').click();
    check('Generate enabled before first run', !(await page.locator('[data-plugin-action-button="generate"]').isDisabled()));
    check('Save hidden before first result', !(await page.locator('[data-plugin-action-button="save"]').isVisible()));

    const text = 'G21\n; café 日本語\n\nM8\n';
    const input = page.locator('textarea[data-field="Start G-code"]');
    await input.fill(text);
    await input.blur();
    check('native multiline editing', (await rows()).find(n => n.hash === id).params['Start G-code'] === text);
    await call('edit.history', { action: 'undo' });
    check('text Undo', (await rows()).find(n => n.hash === id).params['Start G-code'] === '');
    await call('edit.history', { action: 'redo' });

    const field = await call('fields.read', { owner: id, field: 'param:Tool on G-code' });
    await timed('native text CAS', () => call('fields.write', { writes: [{ owner: id, field: 'param:Tool on G-code', value: 'M3', epoch: field.epoch, revision: field.revision }] }));
    for (const params of [{ Passes: 1.2 }, { Passes: 0 }, { Speed: 0 }]) {
      const rejected = await page.evaluate(async ({ id, params }) => {
        try { await frameAI.call('scene.update', { id, params }); return false; } catch { return true; }
      }, { id, params });
      check('invalid parameter rejected', rejected, params);
    }

    await call('scene.update', { id, params: { Passes: 2, Mode: 'Mark', Speed: 321, 'Tool off G-code': 'M5' } });
    await call('scene.select', { ids: [id] });
    const original = (await rows()).find(n => n.hash === id);
    await timed('native Cut rotation', () => call('transform.set', { channel: 'rotation', axis: 1, value: 35, coordinates: 'object' }));
    const rotated = (await rows()).find(n => n.hash === id);
    check('rotation changes native frame', JSON.stringify(rotated.matrix) !== JSON.stringify(original.matrix));
    await call('edit.history', { action: 'undo' });
    check('rotation Undo', JSON.stringify((await rows()).find(n => n.hash === id).matrix) === JSON.stringify(original.matrix));
    await call('edit.history', { action: 'redo' });

    const duplicate = await call('scene.duplicate', { ids: [id] });
    const copy = duplicate.objects.find(n => n.type === 'cut');
    check('duplicate retains independent settings', copy.hash !== id && JSON.stringify(copy.params) === JSON.stringify(rotated.params));
    await call('scene.delete', { ids: [copy.hash] });

    await call('plugins.create', { plugin: 'cut' });
    const second = (await rows()).find(n => n.type === 'cut' && n.hash !== id);
    check('new owner inherits last applied settings', second.params.Speed === 321 && second.params['Start G-code'] === text, second);
    const explicit = await call('scene.create', { type: 'cut', params: { Speed: 456 } });
    check('explicit create params override local defaults', (await rows()).find(n => n.hash === explicit.hash).params.Speed === 456);
    await call('scene.delete', { ids: [explicit.hash] });

    await call('scene.update', { id: second.hash, params: { Speed: 654 } });
    await call('scene.select', { ids: [id] });
    const cubeTagTest = await call('scene.create', { type: 'cube' });
    for (const kind of ['cut_avoid', 'cut_no_cut']) {
      await call('tag.set', { ids: [cubeTagTest.hash], kind, enabled: true });
      const tags = await call('tag.read', { ids: [cubeTagTest.hash], kind });
      check('native ' + kind + ' tag', tags.objects[0].tags.length === 1, tags);
    }
    await call('tag.set', { ids: [cubeTagTest.hash], kind: 'cut_avoid', enabled: false });
    await call('scene.select', { ids: [id] });
    const before = await rows();
    const saved = await timed('HASH export', () => call('scene.export', { includeData: true }));
    await timed('HASH reopen', () => call('scene.open', { name: 'cut-authoring.hash', base64: saved.base64 }));
    for (const n of before.filter(n => n.type === 'cut')) {
      check('HASH exact strings/settings', JSON.stringify((await rows()).find(x => x.hash === n.hash).params) === JSON.stringify(n.params));
    }
    check('removed Avoid stays absent after HASH', (await call('tag.read', { ids: [cubeTagTest.hash], kind: 'cut_avoid' })).objects[0].tags.length === 0);
    const inherited = await call('plugins.create', { plugin: 'cut' });
    check('selected HASH Cut determines subsequent defaults', (await rows()).find(n => n.hash === inherited.hash).params.Speed === 321);
    await call('scene.delete', { ids: [inherited.hash, second.hash, cubeTagTest.hash] });
    check('cancel idle returns no phantom job', (await command(id, 'cancel')).job === null);

    // 2. Real End-to-End 2D CAM: Outer Square + Inner Hole + Circle + 3D Avoid Cube + No-cut Bridge + Extrude!
    await call('scene.select', { ids: [id] });
    await call('transform.set', { channel: 'rotation', axis: 1, value: 0, coordinates: 'object' });
    await call('scene.update', {
      id,
      params: {
        Mode: 'Cut',
        Speed: 1200,
        Passes: 2,
        'Line width': 2.0, // 1mm half-width kerf
        'Lead-in': 3.0,
        'Start G-code': '; Cut CAM Test café',
        'Tool on G-code': 'M3',
        'Tool off G-code': 'M5',
        'Finish G-code': 'M2'
      }
    });
    // Switch to Top view so newly created Square/Circle spawn right on XZ (Y=0)
    await call('view.set', { index: 1, single: true, focus: id });

    const outerSq = await call('scene.create', { type: 'square', params: { 'side 1': 200, 'side 2': 200 } });
    await call('scene.select', { ids: [outerSq.hash] });
    await call('transform.set', { channel: 'position', axis: 0, value: 100, coordinates: 'world' });
    await call('transform.set', { channel: 'position', axis: 2, value: 100, coordinates: 'world' });

    const holeSq = await call('scene.create', { type: 'square', params: { 'side 1': 60, 'side 2': 60 } });
    await call('scene.select', { ids: [holeSq.hash] });
    await call('transform.set', { channel: 'position', axis: 0, value: 170, coordinates: 'world' });
    await call('transform.set', { channel: 'position', axis: 2, value: 170, coordinates: 'world' });

    const circ = await call('scene.create', { type: 'circle', params: { diameter: 80 } });
    await call('scene.select', { ids: [circ.hash] });
    await call('transform.set', { channel: 'position', axis: 0, value: 600, coordinates: 'world' });
    await call('transform.set', { channel: 'position', axis: 2, value: 200, coordinates: 'world' });

    // Place a 3D cube tagged Avoid directly between the Square [100..300] and the Circle [560..640]
    const avoidCube = await call('scene.create', { type: 'cube', params: { 'size x': 80, 'size y': 80, 'size z': 80 } });
    await call('scene.select', { ids: [avoidCube.hash] });
    await call('transform.set', { channel: 'position', axis: 0, value: 380, coordinates: 'world' });
    await call('transform.set', { channel: 'position', axis: 2, value: 100, coordinates: 'world' });
    await call('tag.set', { ids: [avoidCube.hash], kind: 'cut_avoid', enabled: true });

    // Place a small No-cut square holding tab across top edge of Circle (Z ~ 240, X ~ 600)
    const noCutSq = await call('scene.create', { type: 'square', params: { 'side 1': 20, 'side 2': 20 } });
    await call('scene.select', { ids: [noCutSq.hash] });
    await call('transform.set', { channel: 'position', axis: 0, value: 590, coordinates: 'world' });
    await call('transform.set', { channel: 'position', axis: 2, value: 230, coordinates: 'world' });
    await call('tag.set', { ids: [noCutSq.hash], kind: 'cut_no_cut', enabled: true });

    // Also create a sheet-metal Extrude whose child Square is consumed -> Cut extracts its exact profile!
    const ext = await call('scene.create', { type: 'extrude', params: { offset: 5 } });
    const extProf = await call('scene.create', { type: 'square', parent: ext.hash, params: { 'side 1': 80, 'side 2': 80 } });
    await call('scene.select', { ids: [ext.hash] });
    await call('transform.set', { channel: 'position', axis: 0, value: 100, coordinates: 'world' });
    await call('transform.set', { channel: 'position', axis: 2, value: 450, coordinates: 'world' });

    // Wait for spline + extrude evaluation
    await page.evaluate(() => window.FrameSpline.flush());

    const srcInfo = await command(id, 'sources');
    check('sources captured splines + Extrude profile + Avoid cube + No-cut square',
      srcInfo.valid && srcInfo.contours.length === 4 && srcInfo.avoidRegions.length === 1 && srcInfo.noCutRegions.length === 1,
      srcInfo);

    await call('scene.select', { ids: [id] });
    const genHandle = await command(id, 'generate');
    check('generate returns running job handle', genHandle.state === 'running' && !!genHandle.jobId, genHandle);
    const doneStatus = await timed('Cut generate', () => waitComplete(id));
    check('Cut generation completed cleanly', doneStatus.state === 'complete' && doneStatus.resultAvailable, doneStatus);

    const res = await command(id, 'result');
    check('G-code emits pure G0/G1 without G2/G3', !/\bG0?[23]\b/.test(res.code) && res.code.includes('G0 ') && res.code.includes('G1 '));
    check('G-code preserves Unicode Start/Tool/Finish blocks',
      res.code.includes('; Cut CAM Test café') && res.code.includes('\nM3\n') && res.code.includes('\nM5\n') && res.code.trim().endsWith('M2'));
    check('Circle not over-tessellated (reasonable compact line count)', res.lineCount > 30 && res.lineCount < 300, { lineCount: res.lineCount });

    // Verify hole (60x60 -> 58x58) is cut BEFORE outer square (200x200 -> 202x202) and kerf offset worked!
    const g1Coords = res.code.split('\n').map(l => /^G1\s+X(-?\d+(?:\.\d+)?)\s+Y(-?\d+(?:\.\d+)?)/.exec(l)).filter(Boolean).map(m => [+m[1], +m[2]]);
    const holeIdx = g1Coords.findIndex(([x, y]) => Math.abs(x - 171) < 0.2 || Math.abs(x - 229) < 0.2);
    const outerIdx = g1Coords.findIndex(([x, y]) => Math.abs(x - 99) < 0.2 || Math.abs(x - 301) < 0.2);
    check('shared Outline kerf offset applied (+1mm outer, -1mm hole) and hole cut before outer',
      holeIdx >= 0 && outerIdx > holeIdx, { holeIdx, outerIdx });

    // Verify no travel or cut segment passes through Avoid cube X=[380..460], Z=[100..180]
    const allMoves = [];
    let mx = 0, my = 0;
    for (const l of res.code.split('\n')) {
      const m = /^(G0|G1)\s+X(-?\d+(?:\.\d+)?)\s+Y(-?\d+(?:\.\d+)?)/.exec(l);
      if (m) { allMoves.push({ from: [mx, my], to: [+m[2], +m[3]] }); mx = +m[2]; my = +m[3]; }
    }
    const hitsAvoid = allMoves.some(({ from, to }) => {
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const x = from[0] + t * (to[0] - from[0]);
        const y = from[1] + t * (to[1] - from[1]);
        if (x > 380.2 && x < 459.8 && y > 100.2 && y < 179.8) return true;
      }
      return false;
    });
    check('all G0/G1 moves avoid 3D Avoid cube', !hitsAvoid);

    // 3. UI controls: Save G-code visible, transient G-code position scrubber does NOT dirty Undo/HASH!
    await page.locator('#tabAttributes').click();
    check('Save G-code visible after completion', await page.locator('[data-plugin-action-button="save"]').isVisible());
    check('G-code position transient input visible', await page.locator('input[data-plugin-number="gcode-position"]').isVisible());
    const midLine = Math.floor(res.lineCount / 2);
    const posRes = await command(id, 'position', { line: midLine });
    check('position updates transient cursor and head state', posRes.cursor === midLine && posRes.head.line === midLine, posRes);

    // Save command returns downloadable metadata cleanly
    const saveMeta = await command(id, 'save');
    check('save returns nonempty G-code metadata', saveMeta.bytes > 100 && saveMeta.lineCount === res.lineCount && saveMeta.name.endsWith('.gcode'), saveMeta);

    // 4. GPU preview pixels: local red X / blue Z axes + amber Cut path pixels!
    await command(id, 'position', { line: res.lineCount });
    await call('view.set', { index: 1, single: true, focus: id });
    await call('diagnostics.frame', { frames: 4 });
    const frames = await call('diagnostics.frame', { frames: 8 });
    check('bounded native helper + toolpath CPU/GPU frames', frames.timestampQueries === true && frames.frames.every(f => f.cpuMs < 50 && f.gpuMs < 50), frames);
    const vpStatus = (await command(id, 'status')).viewport;
    check('axis & toolpath pipeline ready', vpStatus.ready, vpStatus);

    const projected = [];
    for (const point of [[0, 0, 0], [500, 0, 0], [0, 0, 500]]) projected.push((await call('view.project', { id, point })).screen);
    check('Top local positive X right and Z up', projected[1][0] > projected[0][0] && projected[2][1] < projected[0][1], projected);
    for (const [i, name] of [[1, 'red X'], [2, 'blue Z']]) {
      const p = projected[i], points = [];
      for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) points.push([p[0] + x, p[1] + y]);
      const colors = (await call('diagnostics.pixels', { points })).colors;
      check('actual ' + name + ' axis pixels', colors.some(c => i === 1 ? c[0] > c[1] * 1.5 && c[0] > c[2] * 1.5 : c[2] > c[0] * 1.5 && c[2] > c[1] * 1.2), colors);
    }

    // Check actual bright amber Cut toolpath pixels along outer offset square bottom edge (X=200, Z=99)!
    const cutScreen = (await call('view.project', { id, point: [200, 0, 99] })).screen;
    const cutPts = [];
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) cutPts.push([cutScreen[0] + dx, cutScreen[1] + dy]);
    const cutColors = (await call('diagnostics.pixels', { points: cutPts })).colors;
    check('actual bright amber Cut toolpath pixels rendered on GPU',
      cutColors.some(c => c[0] > 180 && c[1] > 110 && c[0] > c[2] * 2.0), cutColors);

    // Scrub G-code position to 0 -> executed bright amber dims to pending without rebuilding geometry!
    await command(id, 'position', { line: 0 });
    await call('diagnostics.frame', { frames: 2 });
    const dimColors = (await call('diagnostics.pixels', { points: cutPts })).colors;
    check('scrubbing cursor to 0 dims pending toolpath immediately on GPU',
      !dimColors.some(c => c[0] > 180 && c[1] > 110 && c[0] > c[2] * 2.0), dimColors);
    await command(id, 'position', { line: res.lineCount });
    await call('diagnostics.frame', { frames: 2 });

    await mkdir(new URL('../../../tests/results/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../../../tests/results/cut-cam.png', import.meta.url)) });

    // 5. Parameter change invalidates result & switches to Mark cleanly
    await call('scene.update', { id, params: { Mode: 'Mark' } });
    const staleSt = await command(id, 'status');
    check('parameter edit invalidates previous result', !staleSt.resultAvailable && staleSt.state === 'stale', staleSt);

    await command(id, 'generate');
    const markDone = await waitComplete(id);
    check('Mark mode regenerates cleanly', markDone.state === 'complete' && markDone.resultAvailable, markDone);

    const gpu = await page.evaluate(async () => {
      await frameEngine.renderer.device.queue.onSubmittedWorkDone();
      return { validation: (await frameEngine.renderer.device.popErrorScope())?.message || null, uncaptured: __cutErrors };
    });
    check('no GPU/page errors', !gpu.validation && !gpu.uncaptured.length && !errors.length, { gpu, errors });

    await call('scene.new');
    return { pass: true, checks, timings, evidence: { hardware, gpu, frames } };
  } catch (e) {
    return { pass: false, checks, timings, error: e.stack };
  } finally {
    await context.close();
  }
}
