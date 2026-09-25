/* Run in a disposable Frame tab. Replaces the scene and requires WebGPU.
   await runFrameRenderScaleRegression(frameAI) */
async function runFrameRenderScaleRegression(api, options = {}) {
  const results = [], width = options.width || 256, samples = options.samples || 16;
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const close = (a, b) => Math.abs(a - b) <= 1e-5 * Math.max(Math.abs(a), Math.abs(b), 1e-12);
  const idle = () => api.waitForIdle(30000);
  async function test(name, fn) {
    const start = performance.now();
    try { const detail = await fn(); results.push({name, ok:true, ms:performance.now()-start, detail}); }
    catch (error) { results.push({name, ok:false, ms:performance.now()-start, error:error.stack || String(error)}); }
  }
  async function emptyRender() {
    // Establish an independent image reference with a fresh cache origin.
    // The later deletion/new-scene tests deliberately retain the old domain.
    api.resetScene(); const camera = api.createCamera({}).object; await idle();
    await api.renderImage({camera, width:8, height:8, samples:1});
  }
  async function fixture(view = 0, scale = 1) {
    api.resetScene(); api.setUnits('mm'); api.rescaleScene('mm'); api.setView('single', view);
    api.createPrimitive('cube', 'floor', {sizeX:240*scale, sizeY:8*scale, sizeZ:240*scale}, {position:[0,-54*scale,0]});
    const box = api.createPrimitive('cube', 'box', {size:80*scale}).object;
    // Slot 1 is the fixed top view; its target does not rotate the projection.
    api.setViewCamera({view, position:(view ? [0,300,0] : [280,220,300]).map(v=>v*scale), target:[0,-10*scale,0]});
    const camera = api.createCamera(view ? {orthoHeight:320*scale} : {}).object;
    await idle();
    return {box, camera};
  }
  async function render(camera, size = width) {
    const png = await api.renderImage({camera, width:size, height:size, samples});
    assert(png.encoding === 'base64' && !png.payloadOmitted, 'missing PNG');
    const bytes = Uint8Array.from(atob(png.payload), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
    const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const state = api.getRenderState();
    assert(!state.errors?.length, 'renderer errors: '+state.errors);
    assert(state.normalization?.scaleMillimetres > 0, 'missing scene normalization');
    return {pixels:ctx.getImageData(0,0,size,size).data, state};
  }
  function compare(reference, actual, scale) {
    const a = reference.state.normalization, b = actual.state.normalization;
    for (const key of ['scaleMillimetres','extentMillimetres','minLightCellMillimetres','rayEpsilonMillimetres']) {
      assert(close(b[key], a[key]*scale), key+' does not follow geometry scale');
    }
    assert(b.centerMillimetres.every((v,k) => close(v,a.centerMillimetres[k]*scale)), 'stale normalization center');
    const ratio = actual.state.requestedProbes / reference.state.requestedProbes;
    assert(ratio > .95 && ratio < 1.05, 'light-cache density changed: '+ratio);
    let error = 0, changed = 0;
    for (let i=0; i<actual.pixels.length; i++) if (i%4 !== 3) {
      const delta = Math.abs(actual.pixels[i]-reference.pixels[i]);
      error += delta; if (delta) changed++;
    }
    const meanAbsoluteError = error/(actual.pixels.length*.75);
    // Allow FP32 rounding and GPU scheduling variation, not changed framing/light.
    assert(meanAbsoluteError < 1, 'render differs: RGB MAE '+meanAbsoluteError+'/255');
    return {meanAbsoluteError, changedChannels:changed, probes:actual.state.requestedProbes, normalization:b};
  }
  for (const view of [0,1]) {
    const label = view ? 'orthographic' : 'perspective';
    let scene, reference;
    await test(label+' / baseline mm', async () => {
      await emptyRender();
      scene = await fixture(view); reference = await render(scene.camera);
      assert(reference.state.requestedProbes > 100, 'fixture has no meaningful light cache');
      return {normalization:reference.state.normalization, probes:reference.state.requestedProbes};
    });
    if (!reference) continue;
    await test(label+' / display units only', async () => {
      api.setUnits('um'); await idle(); return compare(reference, await render(scene.camera), 1);
    });
    for (const [unit, scale] of [['um',.001],['nm',.000001],['mm',1]]) {
      await test(label+' / rescale '+unit, async () => {
        api.rescaleScene(unit); await idle(); return compare(reference, await render(scene.camera), scale);
      });
    }
    await test(label+' / small edit keeps cache coordinates', async () => {
      api.setObjectTransform(scene.box, {position:[1,0,0]}); await idle();
      const actual = await render(scene.camera), n = actual.state.normalization;
      assert(n.retained && close(n.scaleMillimetres,reference.state.normalization.scaleMillimetres), 'ordinary edit rebased cache');
      api.undo(); await idle(); return compare(reference, await render(scene.camera), 1);
    });
  }
  let lightScene, lightReference;
  await test('emissive geometry / baseline mm', async () => {
    await emptyRender();
    lightScene = await fixture();
    const lamp = api.createPrimitive('cube', 'area emitter', {size:40}, {position:[0,130,0]}).object;
    const material = api.createMaterial('emitter', {s:0, l:100, emm:100});
    api.assignMaterial([lamp], material.hash); await idle();
    lightReference = await render(lightScene.camera);
    assert(lightReference.state.emitters > 0, 'fixture has no area emitters');
    return {emitters:lightReference.state.emitters, probes:lightReference.state.requestedProbes};
  });
  if (lightReference) for (const [unit, scale] of [['um',.001],['nm',.000001]]) {
    await test('emissive geometry / rescale '+unit, async () => {
      api.rescaleScene(unit); await idle(); const actual = await render(lightScene.camera);
      assert(actual.state.emitters === lightReference.state.emitters, 'lost area emitter');
      return compare(lightReference, actual, scale);
    });
  }
  await test('delete large object / retain tiny scene', async () => {
    const scene = await fixture(0,.001);
    const large = api.createPrimitive('cube', 'temporary large object', {size:1000}).object;
    await idle(); await render(scene.camera,64);
    api.deleteObjects([large]); await idle(); const actual = await render(scene.camera);
    assert(close(actual.state.normalization.scaleMillimetres,.24), 'deleted object still sets light-cache scale');
    return actual.state.normalization;
  });
  await test('new microscopic scene after millimetre scene', async () => {
    let scene = await fixture(); await render(scene.camera,64);
    scene = await fixture(0,.001); const actual = await render(scene.camera);
    assert(close(actual.state.normalization.scaleMillimetres,.24), 'previous scene still sets light-cache scale');
    return actual.state.normalization;
  });
  await test('interactive BVH refit / invalidate old light coordinates', async () => {
    await fixture(); const diagnostics = window.frameRenderDiagnostics;
    async function preview() {
      assert(await diagnostics.start({interactivePreview:true, outputSize:[128,128], sampleLimit:4}), 'preview did not start');
      const start = performance.now();
      while (diagnostics.engine.running) {
        assert(performance.now()-start < 30000, 'preview timeout');
        await new Promise(resolve => setTimeout(resolve,20));
      }
      assert(diagnostics.engine.completed, 'preview did not complete');
      return api.getRenderState();
    }
    await preview(); api.rescaleScene('um'); await idle();
    const actual = await preview();
    assert(close(actual.normalization.scaleMillimetres,.24), 'preview kept old scale');
    assert(actual.bvhRefitted, 'fixture did not exercise BVH refit');
    assert(actual.cacheResetReason === 'scene normalization', 'old light-cache coordinates were not invalidated');
    api.stopRender(); return {normalization:actual.normalization, reason:actual.cacheResetReason};
  });
  api.stopRender(); api.resetScene(); api.setUnits('mm'); api.rescaleScene('mm'); api.setView('single',0); await idle();
  return {passed:results.filter(r=>r.ok).length, failed:results.filter(r=>!r.ok).length, results};
}
