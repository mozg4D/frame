// Real DOM/input lifecycle checks for the shipped Player Scene Control host.
// The renderer is deliberately absent: this is not a hardware WebGPU gate.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const begin = html.indexOf('const FrameSceneControl=(()=>{');
const end = html.indexOf('/* Scene Control runtime.', begin);
assert.ok(begin >= 0 && end > begin, 'Shipped Scene Control factory boundary');
const controlSource = html.slice(begin, end);
const inputBegin = html.indexOf('function on(kind,type,listener,options){');
const inputEnd = html.indexOf('function off(kind,type,listener,options){', inputBegin);
assert.ok(inputBegin >= 0 && inputEnd > inputBegin, 'Shipped input registration boundary');
const inputSource = html.slice(inputBegin, inputEnd);
const report = {pass: false, scope: 'Native DOM, registration, input and cleanup; renderer absent', indexSHA256: createHash('sha256').update(html).digest('hex'), checks: []};
const check = (name, value, detail) => {assert.ok(value, name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));report.checks.push({name, pass: true});};
const directory = await mkdtemp(join(tmpdir(), 'frame-player-dom-'));
let browser;
try {
  const {chromium} = await import('playwright').catch(async error => {
    const root = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (!root) throw error;
    return import(pathToFileURL(join(root, 'playwright/index.mjs')).href);
  });
  const executablePath = process.env.FRAME_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({headless: true, executablePath, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'], args: process.platform === 'linux' ? ['--no-sandbox', '--no-process-singleton', '--disable-dev-shm-usage'] : []});
  const context = await browser.newContext({offline: true, deviceScaleFactor: 1});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const path = join(directory, 'control.html');
  await writeFile(path, '<!doctype html><meta charset="utf-8"><title>Scene Control host test</title><canvas id="viewport" width="400" height="100"></canvas>');
  await page.goto(pathToFileURL(path).href);
  await page.evaluate(({controlSource, inputSource}) => {
    globalThis.frameHTMLPlayer = {scene: new Blob(), name: 'test.hash'};
    const state = window.__playerTest = {mounts: 0, cleaned: 0, lateCleaned: 0, editor: 0, clicks: 0, lifecycle: 0, popup: 0, close: 0, geometry: 0, keys: [], pointers: 0};
    window.open = () => {state.popup++; throw Error('Player attempted to open a popup');};
    window.close = () => {state.close++;};
    const geometry = () => ({installDocumentationGeometry() {state.geometry++;}, documentationWindowFeatures() {state.geometry++;return '';}});
    window.__control = Function('createFrameDocumentationGeometry', 'framePopupDocumentURL', 'frameTrackPopupURL', controlSource + '\nreturn FrameSceneControl;')(geometry, () => {throw Error('Popup factory invoked');}, () => {throw Error('Popup URL tracked');});
    const subscriptions = [];
    const on = Function('subscriptions', 'targets', inputSource + '\nreturn on;')(subscriptions, kind => [kind === 'document' ? document : window]);
    for (const event of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel', 'click', 'contextmenu']) on('document', event, () => {state.editor++;}, true);
    on('window', 'frame-engine-scene', () => {state.lifecycle++;});
    window.addEventListener('keydown', event => {state.keys.push(event.key);});
    document.getElementById('viewport').addEventListener('pointerdown', () => {state.pointers++;});
    window.__mount = ({root, document: doc, window: hostWindow, host}) => {
      state.mounts++;
      if (doc !== document || hostWindow !== window || host !== window) throw Error('Inline Scene Control received a foreign host');
      const button = doc.createElement('button');
      button.textContent = 'Game action';
      button.className = 'game-action';
      button.onclick = () => {state.clicks++;};
      root.append(button);
      return () => {state.cleaned++;};
    };
    window.__unregisterA = __control.register(__mount);
    window.__unregisterB = __control.register(__mount);
  }, {controlSource, inputSource});

  check('Registered Scene Control panels mount in the current file document', await page.locator('#frame-player-control .game-action').count() === 2);
  check('Identical mount callbacks keep separate registration identities', await page.evaluate(() => __control.inspect().panels === 2 && __playerTest.mounts === 2));
  await page.locator('.game-action').first().click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await page.locator('#viewport').click({position: {x: 10, y: 10}});
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('frame-engine-scene')));
  let state = await page.evaluate(() => ({...__playerTest}));
  check('Scene Control button and canvas pointer listeners receive normal input', state.clicks === 1 && state.pointers === 1, state);
  check('Scene Control receives Delete and Undo keys without editor subscriptions', state.keys.includes('Delete') && state.keys.includes('z') && state.editor === 0, state);
  check('Player keeps non-input scene lifecycle subscriptions', state.lifecycle === 1, state);
  check('Inline registration needs no popup or popup geometry setup', state.popup === 0 && state.geometry === 0, state);

  await page.evaluate(() => {__unregisterA();__unregisterA();});
  check('Unregister removes only its own panel and disposes once', await page.locator('.game-action').count() === 1 && await page.evaluate(() => __playerTest.cleaned === 1 && __control.inspect().panels === 1));
  await page.evaluate(() => {__control.open();__control.open();});
  check('Repeated open does not duplicate mounts', await page.evaluate(() => __playerTest.mounts === 2));
  await page.evaluate(() => __control.close());
  check('Closing inline Scene Control disposes its UI without closing the player tab', !page.isClosed() && await page.evaluate(() => __playerTest.close === 0 && __playerTest.cleaned === 2 && !__control.inspect().open) && await page.locator('.game-action').count() === 0);
  await page.evaluate(() => __control.open());
  check('Reopening remounts retained registrations exactly once', await page.locator('.game-action').count() === 1 && await page.evaluate(() => __playerTest.mounts === 3));
  await page.evaluate(() => {
    const remove = __control.register(async ({root}) => {
      root.textContent = 'Pending initialization';
      await new Promise(resolve => {window.__finishLate = resolve;});
      return () => {__playerTest.lateCleaned++;};
    });
    remove();
    __finishLate();
  });
  await page.waitForFunction(() => __playerTest.lateCleaned === 1);
  check('Late asynchronous cleanup executes once after its panel has been removed', await page.locator('#frame-player-control').textContent() === 'Game action');
  await page.evaluate(() => {__control.reset();__control.reset();__unregisterB();});
  check('Document reset clears panels and avoids duplicate disposal', await page.evaluate(() => __control.inspect().panels === 0 && __playerTest.cleaned === 3) && await page.locator('#frame-player-control section').count() === 0);
  await page.evaluate(() => {__control.register(__mount);window.dispatchEvent(new PageTransitionEvent('pagehide'));});
  check('Page retirement disposes the panel without window.close', await page.evaluate(() => __playerTest.cleaned === 4 && __playerTest.close === 0 && __control.inspect().panels === 0));
  check('No uncaught DOM or lifecycle errors', errors.length === 0, errors);
  await context.close();
  report.pass = true;
} finally {
  await browser?.close();
  await rm(directory, {recursive: true, force: true});
  console.log(JSON.stringify(report, null, 2));
}
