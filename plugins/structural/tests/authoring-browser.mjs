import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, ready} from '../../../tools/browser.mjs';
import {isHardwareAdapter, isDecodedNativeIcon, hasBoundedFrameTimings} from './browser-gates.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function pluginChecks(parent) {
  const checks = [], timings = [], errors = [], consoleErrors = [], requests = [];
  const check = (name, pass, detail) => {
    checks.push({name: 'Structural: ' + name, pass: !!pass, detail});
    if (!pass) throw Error(name + ': ' + JSON.stringify(detail));
  };
  const timed = async (name, limit, fn) => {
    const start = performance.now(), r = await fn(), ms = performance.now() - start;
    timings.push({name, ms, limit});
    check(name + ' latency', ms < limit, {ms, limit});
    return r;
  };
  const context = await parent.context().browser().newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  const page = await context.newPage();
  let evidence = {};
  page.on('pageerror', e => errors.push(e.stack));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', r => { if (r.url().includes('/plugins/structural/')) requests.push(new URL(r.url()).pathname); });

  try {
    await page.goto(parent.url());
    await ready(page);
    const hardware = await page.evaluate(() => {
      const d = frameEngine.renderer.device;
      window.__structuralErrors = [];
      window.__structuralLost = null;
      d.addEventListener('uncapturederror', e => __structuralErrors.push(e.error.message));
      d.lost.then(e => __structuralLost = {reason: e.reason, message: e.message});
      d.pushErrorScope('validation');
      return d.adapterInfo ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, d.adapterInfo[k]])) : null;
    });
    check('requires real hardware WebGPU without fallback', isHardwareAdapter(hardware), hardware);

    const call = (name, args = {}) => page.evaluate(([name, args]) => frameAI.call(name, args), [name, args]);
    const inspect = async () => (await call('scene.inspect')).objects;
    const clearScene = async () => {
      const rows = await inspect();
      if (rows.length) await call('scene.delete', {ids: rows.filter(n => !n.parent).map(n => n.hash)});
    };
    const waitJob = async (id, timeoutMs = 20000) => {
      const t0 = performance.now();
      for (;;) {
        const s = await call('plugins.command', {id, operation: 'status', args: {}});
        if (!['queued', 'solving', 'optimizing'].includes(s.state)) return s;
        if (performance.now() - t0 > timeoutMs) throw Error('Structural job timed out: ' + JSON.stringify(s));
        await new Promise(r => setTimeout(r, 40));
      }
    };

    await clearScene();

    // 1. Lazy discovery, 32px native icon, 5 tags metadata
    const plugins = await call('plugins.list');
    check('installed catalogue remains lazy', plugins.some(p => p.id === 'structural' && !p.loaded), plugins);
    const tags = (await call('tag.list')).filter(t => t.plugin === 'structural');
    check('all five Structural tags registered with exact metadata', equal(tags.map(t => t.kind), [
      'structural_material', 'structural_fixture', 'structural_force', 'structural_optimize_space', 'structural_preserve'
    ]) && tags.find(t => t.kind === 'structural_force').multiple === true && tags.find(t => t.kind === 'structural_optimize_space').fields && Object.keys(tags.find(t => t.kind === 'structural_optimize_space').fields).length === 0, tags);

    await page.locator('#tabPlugins').click();
    const icon = await page.locator('[data-plugin="structural"] img').evaluate(async img => {
      await img.decode(); const r = img.getBoundingClientRect();
      return {decoded: true, complete: img.complete, width: img.width, height: img.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, rect: {width: r.width, height: r.height}};
    });
    check('icon decodes at genuine native 32 px dimensions', isDecodedNativeIcon(icon), icon);

    // 2. Create Structural object & check Attributes (Auto size, Voxel size, Material (%), Result to Object hidden)
    await timed('native Structural creation', 10000, async () => {
      await page.locator('[data-plugin="structural"]').click();
      await call('scene.inspect');
    });
    const structural = (await inspect()).find(n => n.type === 'structural');
    check('Structural owner created and selected', structural?.selected, structural);
    await page.locator('#tabAttributes').click();
    const resBtnHidden = await page.locator('#attrContent [data-plugin-action-button="result-object"]').evaluate(el => el.style.display === 'none');
    check('Result to Object button hidden before Optimize', resBtnHidden);

    // Toggle Auto size button ON -> hides helper box hit path; toggle OFF -> shows it again
    await call('scene.update', {id: structural.hash, params: {'Auto size': true, 'Voxel size': 10}});
    await call('diagnostics.frame', {frames: 2});
    const hitsHidden = await page.evaluate(h => !document.querySelector(`.frame-plugin-hit[data-hash="${h}"]`), structural.hash);
    check('Auto size ON hides box helper completely', hitsHidden);
    await call('scene.update', {id: structural.hash, params: {'Auto size': false}});
    await call('diagnostics.frame', {frames: 2});

    // 3. Build Cantilever Beam (100x20x20 mm) with overlapping Fixture at left end and TWO additive Force tags!
    const beam = await call('scene.create', {type: 'cube', name: 'Beam', params: {'size x': 100, 'size y': 20, 'size z': 20}});
    await call('transform.set', {ids: [beam.hash], channel: 'position', axis: 0, value: 0, coordinates: 'world'});
    await call('transform.set', {ids: [beam.hash], channel: 'position', axis: 1, value: 0, coordinates: 'world'});
    await call('transform.set', {ids: [beam.hash], channel: 'position', axis: 2, value: 0, coordinates: 'world'});

    const clamp = await call('scene.create', {type: 'cube', name: 'Clamp', params: {'size x': 20, 'size y': 24, 'size z': 24}});
    await call('transform.set', {ids: [clamp.hash], channel: 'position', axis: 0, value: -10, coordinates: 'world'});
    await call('transform.set', {ids: [clamp.hash], channel: 'position', axis: 1, value: -2, coordinates: 'world'});
    await call('transform.set', {ids: [clamp.hash], channel: 'position', axis: 2, value: -2, coordinates: 'world'});

    const tipLoad = await call('scene.create', {type: 'cube', name: 'TipLoad', params: {'size x': 20, 'size y': 20, 'size z': 20}});
    await call('transform.set', {ids: [tipLoad.hash], channel: 'position', axis: 0, value: 80, coordinates: 'world'});
    await call('transform.set', {ids: [tipLoad.hash], channel: 'position', axis: 1, value: 0, coordinates: 'world'});
    await call('transform.set', {ids: [tipLoad.hash], channel: 'position', axis: 2, value: 0, coordinates: 'world'});

    // Assign Material, Fixture, Preserve, Optimize Space, and TWO independent Force instances
    await call('tag.set', {ids: [beam.hash, tipLoad.hash], kind: 'structural_material', enabled: true, params: {Material: 'Steel'}});
    await call('tag.set', {ids: [clamp.hash], kind: 'structural_fixture', enabled: true});
    await call('tag.set', {ids: [tipLoad.hash], kind: 'structural_preserve', enabled: true});
    await call('tag.set', {ids: [beam.hash], kind: 'structural_optimize_space', enabled: true});
    await call('tag.set', {ids: [tipLoad.hash], kind: 'structural_force', enabled: true, add: true, params: {'Force Y': -400}});
    await call('tag.set', {ids: [tipLoad.hash], kind: 'structural_force', enabled: true, add: true, params: {'Force Y': -600, 'Force X': 100}});
    const forceTags = (await call('tag.read', {ids: [tipLoad.hash], kind: 'structural_force'})).objects[0].tags;
    check('two independent Force instances coexist with distinct UIDs', forceTags.length === 2 && forceTags[0].uid !== forceTags[1].uid, forceTags);

    // Check Force tag vector UI in Attributes
    const tipRow = (await inspect()).find(n => n.hash === tipLoad.hash);
    await page.locator('#tabObjects').click();
    await page.locator(`[data-id="${tipRow.id}"] .ob-tag.structural_force`).first().click();
    await page.locator('#tabAttributes').click();
    const forceLabels = await page.locator('#attrContent .attr-lab').allTextContents();
    check('Force tag renders compact Force (N) and Torque (Nm) vector rows', equal(forceLabels, ['Force (N)', 'Torque (Nm)']), forceLabels);

    // Enable Auto size on Structural with 10 mm voxels -> Show Voxels
    await call('scene.select', {ids: [structural.hash]});
    await call('scene.update', {id: structural.hash, params: {'Auto size': true, 'Voxel size': 10, 'Material (%)': 50}});
    await timed('GPU Show Voxels', 10000, async () => {
      await call('plugins.command', {id: structural.hash, operation: 'show-voxels', args: {}});
      const st = await waitJob(structural.hash);
      check('Show Voxels detects welded Fixture and welded Body overlap', st.state === 'ready' && st.stats.activeVoxels > 0 && st.stats.weldedFixtureCells > 0 && st.stats.weldedBodyCells > 0, st);
    });

    // 4. Solve Frame on real WebGPU PCG
    const solved = await timed('GPU Solve Frame (cantilever + gravity + 2 Forces)', 15000, async () => {
      await call('plugins.command', {id: structural.hash, operation: 'solve-frame', args: {}});
      const st = await waitJob(structural.hash);
      check('Solve Frame converges with finite Safety factor, Stress, Displacement and Mass',
        st.state === 'ready' && st.resultAvailable &&
        Number.isFinite(st.result.safetyFactor) && st.result.safetyFactor > 0.5 && st.result.safetyFactor < 200 &&
        st.result.maxStressMPa > 1 && st.result.maxDispMm > 0 && st.result.massG > 100, st);
      return st;
    });
    // Deformation transient display scale works without mutating authoring
    await call('plugins.command', {id: structural.hash, operation: 'deformation', args: {scale: 25}});
    check('Deformation transient display scale updates cleanly', (await call('plugins.command', {id: structural.hash, operation: 'status'})).deformationScale === 25);

    // Cursor surfaceProbe under viewport hover shows SF / MPa / mm and Voxels role
    await call('scene.select', {ids: [beam.hash]});
    await call('view.set', {index: 0, single: true, shading: 'solid'});
    await page.keyboard.press('z'); // frame beam in viewport so pointer lands cleanly on surface
    await call('scene.select', {ids: []}); // clear gizmo so pointer hits viewport canvas
    await call('diagnostics.frame', {frames: 4});
    const probePoint = await page.evaluate(() => frameEngine.pluginProject([50, 10, 10]));
    check('beam center projects inside viewport', Array.isArray(probePoint) && probePoint.every(Number.isFinite), probePoint);
    await page.mouse.move(probePoint[0], probePoint[1]);
    await page.waitForFunction(() => {
      const el = document.querySelector('.frame-surface-probe');
      return el && !el.hidden && el.textContent.includes('SF ') && el.textContent.includes('MPa');
    }, null, {timeout: 5000});
    const probeText = await page.locator('.frame-surface-probe').textContent();
    check('Cursor surfaceProbe displays live SF / MPa / mm over solved geometry',
      probeText.includes('SF ') && probeText.includes('MPa') && probeText.includes('mm'), probeText);
    // Switch to Voxels display map and check material + role readout
    await call('plugins.command', {id: structural.hash, operation: 'map-voxels'});
    await call('diagnostics.frame', {frames: 2});
    await page.mouse.move(probePoint[0] + 2, probePoint[1] + 2);
    await page.waitForFunction(() => {
      const el = document.querySelector('.frame-surface-probe');
      return el && !el.hidden && el.textContent.includes('Steel');
    }, null, {timeout: 5000});
    const voxProbeText = await page.locator('.frame-surface-probe').textContent();
    check('Cursor surfaceProbe shows Material and voxel role in Voxels mode', voxProbeText.includes('Steel'), voxProbeText);
    await call('scene.select', {ids: [structural.hash]});

    // Display map switches live in Attributes
    for (const op of ['map-stress', 'map-displacement', 'map-voxels', 'map-safety-factor']) {
      await call('plugins.command', {id: structural.hash, operation: op});
    }
    // Result to Object MUST still be hidden after Solve Frame (only shown after Optimize!)
    await page.locator('#tabAttributes').click();
    const stillHiddenAfterSolve = await page.locator('#attrContent [data-plugin-action-button="result-object"]').evaluate(el => el.style.display === 'none');
    check('Result to Object remains hidden after Solve Frame', stillHiddenAfterSolve);

    // 5. Optimize Frame (SIMP) + Result to Object + Undo/HASH
    const optRes = await timed('GPU Optimize Frame (SIMP)', 25000, async () => {
      await call('plugins.command', {id: structural.hash, operation: 'optimize-frame', args: {maxOptIterations: 8}});
      const st = await waitJob(structural.hash, 25000);
      check('Optimize Frame converges, reduces mass and verifies Safety factor',
        st.state === 'ready' && st.optimized && st.result.massG < solved.result.massG && Number.isFinite(st.result.safetyFactor), st);
      return st;
    });
    await page.locator('#tabAttributes').click();
    const visibleAfterOpt = await page.locator('#attrContent [data-plugin-action-button="result-object"]').evaluate(el => el.style.display !== 'none');
    check('Result to Object becomes visible after Optimize Frame', visibleAfterOpt);

    const createdObj = await timed('Result to Object native polygon publication', 5000, () =>
      call('plugins.command', {id: structural.hash, operation: 'result-object', args: {}})
    );
    check('Result to Object publishes native polygon mesh', createdObj.created?.vertices > 0 && createdObj.created?.triangles > 0, createdObj);
    const meshNode = (await inspect()).find(n => n.hash === createdObj.created.hash);
    check('published result is an ordinary editable mesh', meshNode?.type === 'mesh' && meshNode.mesh?.triangles === createdObj.created.triangles, meshNode);
    await call('edit.history', {action: 'undo'});
    check('Undo removes published Result object', !(await inspect()).some(n => n.hash === createdObj.created.hash));
    await call('edit.history', {action: 'redo'});
    check('Redo restores published Result object', (await inspect()).some(n => n.hash === createdObj.created.hash));
    await call('scene.delete', {ids: [createdObj.created.hash]});

    // 6. Box Cut Fixing ("Срез фиксируется") without any Fixture + Proportional Force outside box
    await call('tag.set', {ids: [clamp.hash], kind: 'structural_fixture', enabled: false});
    await call('scene.delete', {ids: [clamp.hash]});
    // Manual box covers X in [10..100] (size X = 90 mm, pos X = 55), slicing beam at X=10 while keeping right end X=100 free!
    await call('scene.update', {id: structural.hash, params: {'Auto size': false, 'Voxel size': 10}});
    await call('transform.set', {ids: [structural.hash], channel: 'size', axis: 0, value: 90, coordinates: 'world'});
    await call('transform.set', {ids: [structural.hash], channel: 'position', axis: 0, value: 55, coordinates: 'world'});
    await call('transform.set', {ids: [structural.hash], channel: 'position', axis: 1, value: 10, coordinates: 'world'});
    await call('transform.set', {ids: [structural.hash], channel: 'position', axis: 2, value: 10, coordinates: 'world'});
    let cutFullDisp = 0;
    await timed('Box cut-boundary fixed solve without Fixture', 15000, async () => {
      await call('plugins.command', {id: structural.hash, operation: 'solve-frame', args: {}});
      const st = await waitJob(structural.hash);
      cutFullDisp = st.result?.maxDispMm || 0;
      check('Manual box cut fixes sliced beam face and solves cleanly', st.state === 'ready' && st.stats.cutFixedCells > 0 && Number.isFinite(st.result.safetyFactor), st);
    });
    // Replace tipLoad's Force with a Force-only helper cube overlapping X in [80..100] (100% inside) vs [90..110] (50% outside box)
    for (const ft of forceTags) await call('tag.set', {ids: [tipLoad.hash], kind: 'structural_force', uid: ft.uid, enabled: false});
    const loadVol = await call('scene.create', {type: 'cube', name: 'LoadVol', params: {'size x': 20, 'size y': 20, 'size z': 20}});
    await call('transform.set', {ids: [loadVol.hash], channel: 'position', axis: 0, value: 80, coordinates: 'world'});
    await call('tag.set', {ids: [loadVol.hash], kind: 'structural_force', enabled: true, add: true, params: {'Force Y': -1000}});
    await call('plugins.command', {id: structural.hash, operation: 'solve-frame', args: {}});
    const fullVolSt = await waitJob(structural.hash);
    await call('transform.set', {ids: [loadVol.hash], channel: 'position', axis: 0, value: 90, coordinates: 'world'});
    await call('plugins.command', {id: structural.hash, operation: 'solve-frame', args: {}});
    const halfVolSt = await waitJob(structural.hash);
    check('Outside-box Force fraction is discarded proportionally (~50% load -> ~50% displacement)',
      fullVolSt.state === 'ready' && halfVolSt.state === 'ready' &&
      halfVolSt.result.maxDispMm > fullVolSt.result.maxDispMm * 0.35 &&
      halfVolSt.result.maxDispMm < fullVolSt.result.maxDispMm * 0.75,
      {fullDisp: fullVolSt.result?.maxDispMm, halfDisp: halfVolSt.result?.maxDispMm});
    await call('transform.set', {ids: [loadVol.hash], channel: 'position', axis: 0, value: 80, coordinates: 'world'});

    // 6b. Multi-load-case Optimize Animation (shared topology across 2 distinct load directions)
    const tipUid0 = (await call('tag.read', {ids: [loadVol.hash], kind: 'structural_force'})).objects[0].tags[0].uid;
    await call('animation.key', {id: loadVol.hash, path: `tag:${tipUid0}:Force Y`, frame: 0, value: -500});
    await call('animation.key', {id: loadVol.hash, path: `tag:${tipUid0}:Force Z`, frame: 0, value: 0});
    await call('animation.key', {id: loadVol.hash, path: `tag:${tipUid0}:Force Y`, frame: 1, value: 0});
    await call('animation.key', {id: loadVol.hash, path: `tag:${tipUid0}:Force Z`, frame: 1, value: -500});
    await timed('GPU Optimize Animation (2-case multi-load SIMP)', 25000, async () => {
      await call('plugins.command', {id: structural.hash, operation: 'optimize-animation', args: {firstFrame: 0, lastFrame: 1, maxOptIterations: 6}});
      const st = await waitJob(structural.hash, 25000);
      check('Optimize Animation converges shared topology across load cases',
        st.state === 'ready' && st.optimized && Number.isFinite(st.result.safetyFactor) && st.archivedFrames >= 2, st);
    });

    // 7. Unconstrained rejection (Auto size ON with no Fixture -> fails explicitly, no fake stress!)
    await call('scene.update', {id: structural.hash, params: {'Auto size': true}});
    await call('plugins.command', {id: structural.hash, operation: 'solve-frame', args: {}});
    const failedUnconstrained = await waitJob(structural.hash);
    check('Unconstrained body fails explicitly with UNCONSTRAINED_RIGID_BODY',
      failedUnconstrained.state === 'failed' && failedUnconstrained.error?.code === 'UNCONSTRAINED_RIGID_BODY', failedUnconstrained);

    // 8. Frictionless Fixture contact (block resting on non-overlapping floor Fixture under gravity + downward Force)
    await clearScene();
    const s2 = await call('plugins.create', {plugin: 'structural', type: 'structural'});
    await call('scene.update', {id: s2.hash, params: {'Auto size': true, 'Voxel size': 10}});
    const floorFix = await call('scene.create', {type: 'cube', name: 'Floor', params: {'size x': 40, 'size y': 10, 'size z': 40}});
    await call('transform.set', {ids: [floorFix.hash], channel: 'position', axis: 1, value: -10, coordinates: 'world'});
    const sideWall = await call('scene.create', {type: 'cube', name: 'Backstop', params: {'size x': 10, 'size y': 20, 'size z': 40}});
    await call('transform.set', {ids: [sideWall.hash], channel: 'position', axis: 0, value: -10, coordinates: 'world'});
    const sideZ = await call('scene.create', {type: 'cube', name: 'SideStop', params: {'size x': 40, 'size y': 20, 'size z': 10}});
    await call('transform.set', {ids: [sideZ.hash], channel: 'position', axis: 2, value: -10, coordinates: 'world'});
    const block = await call('scene.create', {type: 'cube', name: 'Block', params: {'size x': 30, 'size y': 20, 'size z': 30}});
    await call('tag.set', {ids: [floorFix.hash, sideWall.hash, sideZ.hash], kind: 'structural_fixture', enabled: true});
    await call('tag.set', {ids: [block.hash], kind: 'structural_material', enabled: true, params: {Material: 'PLA'}});
    await call('tag.set', {ids: [block.hash], kind: 'structural_force', enabled: true, add: true, params: {'Force X': -200, 'Force Y': -500, 'Force Z': -150}});
    await timed('Frictionless contact active-set GPU solve', 15000, async () => {
      await call('plugins.command', {id: s2.hash, operation: 'solve-frame', args: {}});
      const st = await waitJob(s2.hash);
      check('Frictionless touching Fixture solves without welding',
        st.state === 'ready' && st.stats.weldedFixtureCells === 0 && st.stats.contactFixtureCells > 0 && Number.isFinite(st.result.safetyFactor), st);
    });

    // 9. Animation Load Cases + General Curves 2D Y(X) & 3D Z(X,Y) Surface Dependencies!
    const fUid = (await call('tag.read', {ids: [block.hash], kind: 'structural_force'})).objects[0].tags[0].uid;
    // Create 2D grid of (Force X, Force Y) samples across frames 0..8 so 3D Curves builds a real triangulated surface!
    const gridSamples = [
      [0, -100, -200], [1, -300, -200], [2, -500, -200],
      [3, -100, -500], [4, -300, -500], [5, -500, -500],
      [6, -100, -800], [7, -300, -800], [8, -500, -800]
    ];
    for (const [f, fx, fy] of gridSamples) {
      await call('animation.key', {id: block.hash, path: `tag:${fUid}:Force X`, frame: f, value: fx});
      await call('animation.key', {id: block.hash, path: `tag:${fUid}:Force Y`, frame: f, value: fy});
    }
    await timed('Solve Animation load cases (9 changed frames, skips 9..120)', 25000, async () => {
      await call('plugins.command', {id: s2.hash, operation: 'solve-animation', args: {firstFrame: 0, lastFrame: 120}});
      const st = await waitJob(s2.hash, 25000);
      check('Solve Animation solves 9 load cases and archives them', st.state === 'ready' && st.archivedFrames === 9, st);
    });

    // Open Safety factor readout in Curves, Shift-add Force X & Force Y, test 2D and 3D Surface!
    await call('scene.select', {ids: [s2.hash]});
    await page.locator('#tabAttributes').click();
    await page.locator('#attrContent [data-plugin-readout="safety-factor"]').click();
    await page.evaluate(({hash, uid}) => {
      const n = nodes.find(x => x.nativeHash === hash);
      frameCurvesChooseContext([{h: n.id, path: `tag:${uid}:Force X`}, {h: n.id, path: `tag:${uid}:Force Y`}], true);
      frameDrawCurves();
    }, {hash: block.hash, uid: fUid});
    await page.waitForFunction(() => frameCurves.open && frameCurvesChannels().length >= 3);

    const c2d = await call('curves.view', {mode: '2d', axes: [0, 2]});
    check('Curves 2D dependency mode plots Y(X) across solved frames', c2d.mode === '2d' && c2d.samples === 9, c2d);
    const c3d = await call('curves.view', {mode: '3d', axes: [0, 1, 2]});
    check('Curves 3D surface dependency mode triangulates Z(X,Y) surface', c3d.mode === '3d' && c3d.samples === 9 && c3d.triangles >= 4, c3d);
    const cInsp = await call('curves.inspect');
    check('curves.inspect reports 3D surface state cleanly', cInsp.open && cInsp.mode === '3d' && cInsp.triangles >= 4, cInsp);
    // Capture live visual preview while Solved SF heatmap, Force arrow and 3D Curves surface are all visible!
    await call('scene.select', {ids: [block.hash]});
    await page.keyboard.press('z');
    await call('scene.select', {ids: [s2.hash]});
    await call('diagnostics.frame', {frames: 3});
    await mkdir(new URL('../../../tests/results/', import.meta.url), {recursive: true});
    await page.screenshot({path: fileURLToPath(new URL('../../../tests/results/structural-full-preview.png', import.meta.url))});

    // HASH round-trip retains Structural owner, Auto size, tags and animation
    const saved = await timed('HASH export with Structural authoring', 4000, () => call('scene.export', {includeData: true}));
    await timed('HASH reopen with Structural authoring', 10000, () => call('scene.open', {name: 'structural-full.hash', base64: saved.base64}));
    const reopened = await inspect();
    check('HASH retains Structural owner and multi-instance Force tag',
      reopened.some(n => n.type === 'structural' && n.params['Auto size'] === true) &&
      reopened.some(n => n.tags.some(t => t.kind === 'structural_force' && t.uid === fUid)), reopened);

    // Frame budget & GPU error hygiene
    await call('view.set', {index: 0, single: true});
    await call('diagnostics.frame', {frames: 6});
    const frames = await call('diagnostics.frame', {frames: 12});
    check('native viewport CPU/GPU frame budget stays bounded', hasBoundedFrameTimings(frames), frames);
    const gpu = await page.evaluate(async () => {
      await frameEngine.renderer.device.queue.onSubmittedWorkDone();
      return {validation: (await frameEngine.renderer.device.popErrorScope())?.message || null, uncaptured: __structuralErrors, lost: __structuralLost};
    });
    check('zero WebGPU validation, uncaptured, JS or console errors',
      !gpu.validation && !gpu.uncaptured.length && !gpu.lost && !errors.length && !consoleErrors.length,
      {gpu, errors, consoleErrors});
    check('only installed Structural plugin assets requested',
      requests.every(p => ['plugin.json', 'icon.svg', 'plugin.js'].some(n => p === '/plugins/structural/' + n)), requests);

    evidence = {hardware, gpu, frames, requests, solved: solved.result, optimized: optRes.result, curves3d: c3d};
    return {pass: true, checks, timings, evidence, hardwareVerified: true};
  } catch (e) {
    return {pass: false, checks, timings, evidence, errors, consoleErrors, error: e.stack, hardwareVerified: false};
  } finally {
    await context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let session, result;
  try {
    session = await launch({headless: process.argv.includes('--headless')});
    result = await pluginChecks(session.page);
  } catch (e) {
    result = {pass: false, checks: [], timings: [], hardwareVerified: false, error: e.stack};
  } finally {
    await session?.close();
  }
  result.sources = {};
  for (const p of ['index.html', 'plugins/index.json', 'plugins/structural/plugin.json', 'plugins/structural/plugin.js', 'plugins/structural/icon.svg', 'plugins/structural/tests/authoring-browser.mjs']) {
    result.sources[p] = createHash('sha256').update(await readFile(new URL('../../../' + p, import.meta.url))).digest('hex');
  }
  await mkdir(new URL('../../../tests/results/', import.meta.url), {recursive: true});
  await writeFile(new URL('../../../tests/results/structural-authoring-preview.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
