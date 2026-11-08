// Explicit bounded release gate. Never imports tests/run.mjs or plugin test discovery.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {auditNonUnite} from './release-non-unite-audit.mjs';
const args = process.argv.slice(2);
if (args.some(arg => !['--headless', '--stress'].includes(arg))) throw Error('Only --headless and --stress are supported; no fixtures or extra suites');
const root = fileURLToPath(new URL('../', import.meta.url)), output = join(root, 'tests/results');
await mkdir(output, {recursive:true});
const audit = await auditNonUnite(); // No test module or browser is loaded before this gate.
const {launch, ready} = await import('../tools/browser.mjs');
const {syntax} = await import('./syntax.mjs');
const {simdChecks} = await import('./simd.mjs');
const {uiChecks} = await import('./ui.mjs');
const {nextInteractionChecks} = await import('./next-interaction.mjs');
const {viewLiveChecks} = await import('./view-live.mjs');
const {mcpChecks} = await import('./mcp.spec.mjs');
const report = {profile:args.includes('--stress') ? 'release-non-unite-stress' : 'release-non-unite', started:new Date().toISOString(), indexSHA256:audit.sources['index.html'], sources:audit.sources, audit, stages:{}, excluded:audit.excluded, errors:[], consoleErrors:[], pass:false};
let session, timer;
const stage = async (name, run) => {
  console.log('[non-unite] ' + name);
  const start = performance.now();
  let result;
  try {result = await run();} catch (error) {
    report.stages[name] = {pass:false, elapsedMs:performance.now() - start, error:error.stack || error.message, ...(error.checks ? {checks:error.checks} : {})};
    throw error;
  }
  report.stages[name] = {...result, elapsedMs:performance.now() - start};
  if (result?.pass === false) throw Error(name + ': ' + (result.error || 'Failed assertions'));
  return result;
};
try {
  await stage('syntax', async () => ({pass:true, ...await syntax()}));
  await stage('simd', simdChecks);
  session = await launch({headless:args.includes('--headless')});
  const page = session.page;
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
  await ready(page);
  await stage('hardware', async () => {
    const adapter = await page.evaluate(() => {
      const info = frameEngine.renderer.device.adapterInfo;
      return info ? Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(key => [key,info[key]])) : null;
    });
    const pass = !!adapter && Object.values(adapter).some(value => typeof value === 'string' && value) && adapter.isFallbackAdapter === false && !/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(adapter));
    return {pass, adapter, error:pass ? undefined : 'Identifiable native hardware with explicit no-fallback attestation is required', checks:[{name:'Native hardware without software fallback', pass}]};
  });
  await page.evaluate(() => {
    window.__releaseGPU = [];
    window.__releaseDevice = frameEngine.renderer.device;
    window.__releaseLost = null;
    __releaseDevice.lost.then(info => window.__releaseLost = {reason:info.reason, message:info.message});
    __releaseDevice.addEventListener('uncapturederror', event => __releaseGPU.push(event.error.message));
    __releaseDevice.pushErrorScope('validation');
  });
  const timeout = new Promise((_, reject) => {timer = setTimeout(() => reject(Error('Shared suite exceeded 10 minutes')), 600000);});
  await stage('suite', () => Promise.race([page.evaluate(async stress => {
    const {runSuite} = await import('./tests/suite.js');
    return runSuite(frameAI, {stress, progress:name => console.log('[tests] ' + name)});
  }, args.includes('--stress')), timeout]));
  clearTimeout(timer);
  await stage('ui', () => uiChecks(page));
  await stage('next', () => nextInteractionChecks(page));
  report.gpu = await page.evaluate(async () => {
    await frameAI.call('scene.inspect');
    await __releaseDevice.queue.onSubmittedWorkDone();
    return {validation:(await __releaseDevice.popErrorScope())?.message || null, uncaptured:__releaseGPU, lost:__releaseLost, changed:__releaseDevice !== frameEngine.renderer.device};
  });
  if (report.gpu.validation || report.gpu.uncaptured.length || report.gpu.lost || report.gpu.changed) throw Error('WebGPU validation or device identity failed');
  // This unchanged module owns its validation scopes across its page navigation.
  await stage('viewLive', () => viewLiveChecks(page));
  await page.goto(session.url + '/index.html');
  await ready(page);
  const startup = await page.evaluate(() => frameAI.call('scene.inspect'));
  await stage('startup', async () => ({pass:startup.objects.length === 0, checks:[{name:'Fresh native startup is empty', pass:startup.objects.length === 0}]}));
  await stage('mcp', mcpChecks);
  report.pass = !report.errors.length && !report.consoleErrors.length;
} catch (error) {
  report.errors.push(error.stack || error.message);
  if (session) report.startupDiagnostics = await session.page.evaluate(() => ({canvas:{...document.querySelector('#frame-engine-canvas')?.dataset}})).catch(error => ({captureError:error.message}));
} finally {
  clearTimeout(timer);
  try {await session?.close();} catch (error) {report.pass = false; report.errors.push('Cleanup: ' + error.message);}
  try {report.sourcesAfter = (await auditNonUnite()).sources;} catch (error) {report.pass = false; report.errors.push('Source binding after run: ' + error.message);}
  report.indexSHA256After = createHash('sha256').update(await readFile(join(root, 'index.html'))).digest('hex');
  report.finished = new Date().toISOString();
  report.assertions = Object.values(report.stages).reduce((sum, value) => sum + (value.assertions || value.checks?.length || 0), 0);
  const file = join(output, report.profile + '-latest.json');
  await writeFile(file, JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, report.profile + '-' + report.started.replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({pass:report.pass, profile:report.profile, assertions:report.assertions, indexSHA256:report.indexSHA256, errors:report.errors, consoleErrors:report.consoleErrors, excluded:report.excluded, report:file}, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}
