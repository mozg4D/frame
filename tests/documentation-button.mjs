// Default: native Frame. --host-only: actual Docs modules/native CAS in an
// isolated browser fixture; not a WebGPU or native HASH qualification.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {serve, ready} from '../tools/browser.mjs';

const hostOnly = process.argv.includes('--host-only');
const files = ['index.html', 'core/documentation-window.mjs', 'core/documentation-editor.mjs', 'core/documentation-sync.mjs', 'documentation.html', 'frame-sw.js', 'tests/documentation-button.mjs'];
const contents = Object.fromEntries(await Promise.all(files.map(async p => [p, await readFile(new URL('../' + p, import.meta.url), 'utf8')])));
const sha = value => createHash('sha256').update(value).digest('hex');
const report = {pass: false, scope: hostOnly ? 'Browser Docs host fixture; not native WebGPU/HASH qualification' : 'Native Frame browser', sources: Object.fromEntries(files.map(p => [p, sha(contents[p])])), checks: [], pageErrors: [], timings: []};
const check = (name, value) => {report.checks.push({name, pass: !!value}); assert.ok(value, name);};
const timed = async (name, fn) => {const start = performance.now(); const result = await fn(); const ms = performance.now() - start; report.timings.push({name, ms, budgetMs: 3000}); check(name + ' completes within 3000 ms', ms < 3000); return result;};
const server = await serve(); let browser;
try {
  browser = await chromium.launch({headless: process.argv.includes('--headless'), channel: 'chromium', ignoreDefaultArgs: ['--enable-unsafe-swiftshader'], executablePath: process.env.FRAME_BROWSER || undefined, args: ['--enable-unsafe-webgpu']});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  const page = await context.newPage();
  const watch = page => page.on('pageerror', e => report.pageErrors.push(e.message)); watch(page);
  if (hostOnly) {
    const html = contents['index.html'];
    const button = html.match(/<button\b[^>]*id="btnDocs"[^>]*>[\s\S]*?<\/button>/)?.[0]; assert.ok(button);
    const start = html.indexOf('const FrameDocumentation='), end = html.indexOf('const FramePlugins=', start); assert.ok(start >= 0 && end > start);
    // Bind the extracted native CAS to one transient text value, not a scene model.
    const fixture = `<!doctype html><meta charset="utf-8">${button}<script type="module">
      import {installDocumentationWindow} from '/core/documentation-window.mjs';
      ${html.slice(start, end)}
      let text = '';
      const docs = FrameDocumentation.create({read: () => text, write: value => {text = value;}, notify: state => dispatchEvent(new CustomEvent('frame-documentation-change', {detail: state}))});
      window.frameDocumentation = docs;
      window.frameAI = {call: async (name, args = {}) => {
        if (name === 'scene.new') {text = ''; docs.reset(); return docs.get();}
        const key = name.replace(/^docs\\./, ''); if (!(key in docs)) throw Error('Unsupported fixture call'); return docs[key](args);
      }};
      installDocumentationWindow({button: document.getElementById('btnDocs'), read: () => docs.get(), write: async (args, guard) => {guard(); return docs.update(args);}});
      window.docsReady = true;
    </script>`;
    await page.route('**/tests/documentation-host.html', route => route.fulfill({contentType: 'text/html', body: fixture}));
    await page.goto(server.url + '/tests/documentation-host.html'); await page.waitForFunction(() => window.docsReady);
  } else {
    await page.goto(server.url + '/index.html'); await ready(page);
    report.gpu = await page.evaluate(() => frameEngine.renderer.device.adapterInfo && Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k => [k, frameEngine.renderer.device.adapterInfo[k]])));
    check('Native WebGPU adapter is not a software fallback', report.gpu && !report.gpu.isFallbackAdapter && !/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(report.gpu)));
  }
  const call = (name, args = {}) => page.evaluate(([n,a]) => frameAI.call(n,a), [name,args]);
  const get = () => call('docs.get');
  const waitText = text => page.waitForFunction(text => frameDocumentation.get().text === text, text, {timeout: 3000});
  const visible = async name => check(name, await page.locator('#btnDocs').isVisible());
  const open = async label => timed(label, async () => {
    const opened = page.waitForEvent('popup', {timeout: 3000});
    await page.locator('#btnDocs').click(); const child = await opened; watch(child);
    await child.locator('textarea').waitFor({state: 'visible', timeout: 3000});
    await child.waitForFunction(() => !document.querySelector('textarea').disabled && !document.querySelector('textarea').readOnly, {}, {timeout: 3000}); return child;
  });
  check('Fresh scene has no documentation', (await get()).text === '');
  await visible('Docs visible before first documentation exists');
  let editor = await open('Open empty editor');
  check('Empty editor opens with empty editable text', (await editor.locator('textarea').inputValue()) === '');
  await timed('Create first documentation by typing', async () => {await editor.locator('textarea').fill('First documentation Ω'); await waitText('First documentation Ω');});
  const pages = context.pages().length; await page.locator('#btnDocs').click(); check('Repeated Docs click reuses current editor', context.pages().length === pages);
  await timed('Clear documentation', async () => {await editor.locator('textarea').fill(''); await waitText('');});
  await visible('Docs stays visible after clearing the editor');
  await timed('Write again after clearing', async () => {await editor.locator('textarea').fill('Written again'); await waitText('Written again');});
  await call('docs.delete', {version: (await get()).version});
  await editor.waitForFunction(() => document.querySelector('textarea').value === '');
  await visible('Docs stays visible after API deletion');
  check('Deleted documentation leaves current editor editable', await editor.locator('textarea').isEditable());
  await editor.close(); editor = await open('Reopen empty editor after deletion'); check('Reopened editor is empty', (await editor.locator('textarea').inputValue()) === '');
  await editor.close(); await call('scene.new'); await visible('Docs stays visible after New File');
  editor = await open('Open empty editor after New File');
  await timed('Write first documentation after New File', async () => {await editor.locator('textarea').fill('New scene documentation'); await waitText('New scene documentation');});
  await editor.close(); await call('docs.delete', {version: (await get()).version}); await visible('Final empty scene keeps Docs visible');
  check('No JavaScript errors', report.pageErrors.length === 0);
  report.pass = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
finally {
  await browser?.close(); await server.close();
  report.sourcesAfter = Object.fromEntries(await Promise.all(files.map(async p => [p, sha(await readFile(new URL('../' + p, import.meta.url)))])));
  if (JSON.stringify(report.sources) !== JSON.stringify(report.sourcesAfter)) {report.pass = false; report.error = 'Tested source changed during the run'; process.exitCode = 1;}
  await mkdir(new URL('./results/', import.meta.url), {recursive: true});
  await writeFile(new URL('./results/documentation-button-' + (hostOnly ? 'host' : 'native') + '.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
