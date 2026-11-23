// Exercise the shipped packager and its bootstrap in an actual offline file: document.
// These checks do not qualify native WebGPU rendering or simulation.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {H} from './hash-codec-fixture.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const begin = html.indexOf('function createFrameHTMLPackage(');
const end = html.indexOf('// End self-contained HTML package.', begin);
assert.ok(begin >= 0 && end > begin, 'The shipped HTML packager has an explicit extraction boundary');
const packagerSource = html.slice(begin, end);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {
  pass: false,
  scope: 'HTML package, offline file bootstrap, local modules and workers; no native GPU rendering',
  indexSHA256: digest(html),
  checks: [],
  attemptedRequests: [],
};
const check = (name, result, detail) => {
  assert.ok(result, name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
  report.checks.push({name, pass: true, ...(detail === undefined ? {} : {detail})});
};
const sourceURL = 'https://frame.example/releases/test/index.html';
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta name="frame-version" content="HTML package test">
<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="frame.ico">
<title>Fixture</title><script>window.__playerInHead = !!window.frameHTMLPlayer;window.__playerAttrInHead = document.documentElement.hasAttribute('data-frame-player');</script></head><body><main id="fixture">Packaged fixture</main>
<script>window.__packageFixture = {started: true, playerAtStart: !!window.frameHTMLPlayer};</script></body></html>`;
const directory = await mkdtemp(join(tmpdir(), 'frame-html-player-'));
let browser, builder, buildInputUnchanged;
async function build(scene, resources = [], options = {}) {
  const payload = {
    source: fixture, name: 'test.hash', sourceURL, ...options,
    scene: Buffer.from(await scene.arrayBuffer()).toString('base64'),
    resources: await Promise.all(resources.map(async ({path, blob}) => ({path, type: blob.type, base64: Buffer.from(await blob.arrayBuffer()).toString('base64')}))),
  };
  const result = await builder.evaluate(async payload => {
    const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const scene = new Blob([decode(payload.scene)], {type: 'application/octet-stream'});
    const resources = payload.resources.map(({path, type, base64}) => ({path, blob: new Blob([decode(base64)], {type})}));
    const inputs = resources.map(resource => ({...resource}));
    const output = await window.__testPackager.build({...payload, scene, resources});
    return {html: await output.text(), type: output.type, unchanged: resources.every((resource, i) => resource.path === inputs[i].path && resource.blob === inputs[i].blob)};
  }, payload);
  buildInputUnchanged = result.unchanged;
  return new Blob([result.html], {type: result.type});
}

try {
  const module = await import('playwright').catch(async error => {
    const root = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!root) throw error;
    return import(pathToFileURL(join(root, 'playwright/index.mjs')).href);
  });
  const executablePath = process.env.FRAME_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await module.chromium.launch({headless: true, executablePath, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'], args: process.platform === 'linux' ? ['--no-sandbox', '--no-process-singleton', '--disable-dev-shm-usage'] : []});
  const context = await browser.newContext({deviceScaleFactor: 1, offline: true});
  const transmitted = [];
  await context.route(/^https?:/, route => {transmitted.push(route.request().url());return route.abort('blockedbyclient');});
  builder = await context.newPage();
  const builderPath = join(directory, 'builder.html');
  await writeFile(builderPath, '<!doctype html><meta charset="utf-8"><title>Package test builder</title>');
  await builder.goto(pathToFileURL(builderPath).href);
  await builder.evaluate(source => {window.__testPackager = Function(source + '\nreturn createFrameHTMLPackage;')()();}, packagerSource);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/.test(request.url())) report.attemptedRequests.push(request.url());});
  let serial = 0;
  async function open(blob) {
    const path = join(directory, 'player-' + (++serial) + '.html');
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    await page.goto(pathToFileURL(path).href);
    await page.waitForFunction(() => !!window.frameHTMLPlayer);
    await page.evaluate(() => Promise.resolve(frameHTMLPlayer.ready));
    return path;
  }
  const sceneDigest = () => page.evaluate(async () => {
    const bytes = await (await frameHTMLPlayer.scene).arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return {bytes: bytes.byteLength, hash: Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')};
  });

  // Around both base64 triples and common streaming chunk boundaries; compare byte hashes,
  // not a copy of the encoding algorithm under test.
  for (const size of [0, 1, 2, 3, 4, 65535, 65536, 65537, 196607, 196608, 196609, 1048575, 1048576, 1048577]) {
    const bytes = randomBytes(size);
    const scene = new Blob([bytes], {type: 'application/octet-stream'});
    await open(await build(scene));
    const decoded = await sceneDigest();
    check('Binary scene round-trip at ' + size + ' bytes', decoded.bytes === size && decoded.hash === digest(bytes), decoded);
    assert.equal(await scene.arrayBuffer().then(value => digest(Buffer.from(value))), digest(bytes), 'Export preserves the input Blob');
  }
  check('Player payload exists before the original application script runs', await page.evaluate(() => __packageFixture.playerAtStart));
  check('Player payload and layout flag exist before original head scripts run', await page.evaluate(() => __playerInHead && __playerAttrInHead));
  check('Bootstrap leaves original application markup usable', await page.locator('#fixture').textContent() === 'Packaged fixture');
  const identity = await builder.evaluate(source => __testPackager.sourceIdentity(source), fixture);
  await build(new Blob(['identity']), [], {expectedIdentity: identity});
  await assert.rejects(() => build(new Blob(['identity']), [], {expectedIdentity: '0'.repeat(64)}), /Frame changed|identity|source|build|version/i);
  await assert.rejects(() => build(new Blob(['identity']), [], {expectedIdentity: identity, source: fixture.replace('HTML package test', 'Different release')}), /Frame changed|identity|source|build|version/i);
  await assert.rejects(() => build(new Blob(['identity']), [], {expectedIdentity: identity, source: fixture.replace('started: true', 'started: false')}), /Frame changed|identity|source|build|version/i);
  check('Source identity accepts the exact source and rejects changed code or release', true);

  const records = [
    {id: H.K.version, type: H.T.uint32, value: new Uint32Array([1])},
    {id: H.K.all, type: H.T.ids, value: []},
    {id: H.K.parameters, type: H.T.value, value: {unicode: 'Frame — сцена 🧩', source: '</script><script>globalThis.__escaped=false</script>', zero: -0}},
    {id: H.K.name, type: H.T.text, value: 'A native HASH fixture'},
  ];
  const native = new Blob((await Promise.all(records.map(record => H.pack(record)))).map(record => record.blob));
  const dangerousName = 'Scene </script><script>window.__injected=1</script> & " \' 🧩.hash';
  const resourceBytes = randomBytes(65537);
  const resources = [
    {path: 'plugins/fixture/plugin.js', blob: new Blob(['export const answer = 42;'], {type: 'text/javascript'})},
    {path: 'plugins/fixture/worker.js', blob: new Blob(['onmessage=({data})=>postMessage({received:data,answer:17});'], {type: 'text/javascript'})},
    {path: 'models/fixture.bin', blob: new Blob([resourceBytes], {type: 'application/octet-stream'})},
  ];
  await open(await build(native, resources, {name: dangerousName}));
  const restored = await sceneDigest();
  check('Native HASH bytes survive without decode/re-encode', restored.hash === digest(Buffer.from(await native.arrayBuffer())));
  const restoredBytes = await page.evaluate(async () => [...new Uint8Array(await (await frameHTMLPlayer.scene).arrayBuffer())]);
  const reader = H.reader(new Blob([Uint8Array.from(restoredBytes)])), index = await reader.index();
  for (const record of records) assert.deepEqual(await reader.read(index.get(record.id)), record.value);
  check('Native typed HASH records retain their exact values', true);
  check('Names containing HTML/script delimiters are inert', await page.evaluate(expected => frameHTMLPlayer.name === expected && !window.__injected, dangerousName));
  const result = await page.evaluate(async () => {
    const bundle = frameHTMLPlayer;
    const mod = await import(bundle.resource('plugins/fixture/plugin.js'));
    const binary = await fetch(bundle.resource('models/fixture.bin')).then(response => response.arrayBuffer());
    const worker = new Worker(bundle.resource('plugins/fixture/worker.js'));
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Embedded Worker did not respond')), 3000);
      worker.onmessage = event => {clearTimeout(timeout); resolve(event.data);};
      worker.onerror = error => {clearTimeout(timeout); reject(Error(error.message));};
      worker.postMessage('local');
    }).finally(() => worker.terminate());
    const hash = await crypto.subtle.digest('SHA-256', binary);
    return {answer: mod.answer, response, bytes: binary.byteLength, hash: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')};
  });
  check('Embedded ESM module runs from a local Blob', result.answer === 42);
  check('Embedded Worker runs offline and exchanges messages', result.response.answer === 17 && result.response.received === 'local');
  check('Binary resource resolves without HTTP or file neighbors', result.bytes === resourceBytes.length && result.hash === digest(resourceBytes));
  check('Resource records are not mutated by export', buildInputUnchanged);
  const missing = await page.evaluate(() => {try {frameHTMLPlayer.resource('models/absent.bin');return null;} catch (error) {return error.message;}});
  check('Absent embedded dependencies fail explicitly', typeof missing === 'string' && missing.length > 0, missing);
  check('Successful player bootstrap attempts no HTTP requests', report.attemptedRequests.length === 0, report.attemptedRequests);
  check('Successful bootstrap has no uncaught JavaScript errors', errors.length === 0, errors);
  const blocked = await page.evaluate(async () => {
    const denied = [];
    document.addEventListener('securitypolicyviolation', event => denied.push({directive: event.effectiveDirective, uri: event.blockedURI}));
    let rejected = false;
    try {await fetch('https://must-not-contact.invalid/frame-player-test');} catch {rejected = true;}
    await new Promise(resolve => setTimeout(resolve, 30));
    return {rejected, denied};
  });
  check('Self-contained document blocks accidental network fetches by policy', blocked.rejected && blocked.denied.some(event => event.directive === 'connect-src'), blocked);
  check('No HTTP request reaches the browser transport', transmitted.length === 0, transmitted);
  await context.close();
  report.pass = true;
} finally {
  await browser?.close();
  await rm(directory, {recursive: true, force: true});
  console.log(JSON.stringify(report, null, 2));
}
