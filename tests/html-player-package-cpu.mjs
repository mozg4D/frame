// Execute the shipped packager/bootstrap with native Blob/URL/crypto and a small HTML DOM adapter.
// HTML parsing uses Python's stdlib parser. Browser CSP, ESM, Workers and WebGPU are separate gates.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomBytes, createHash, webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {H} from './hash-codec-fixture.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function createFrameHTMLPackage('), end = html.indexOf('// End self-contained HTML package.', start);
assert.ok(start >= 0 && end > start, 'Shipped package helper boundary');
const parser = String.raw`import sys,json
from html.parser import HTMLParser
class Parser(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True); self.rows=[]; self.capture=None; self.inhead=False
 def handle_starttag(self,tag,attrs):
  if tag=='head': self.inhead=True
  row={'tag':tag,'attrs':dict(attrs),'text':'','head':self.inhead};self.rows.append(row)
  if tag in ('script','style'): self.capture=row
 def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs)
 def handle_endtag(self,tag):
  if self.capture is not None and self.capture['tag']==tag:self.capture=None
  if tag=='head':self.inhead=False
 def handle_data(self,data):
  if self.capture is not None:self.capture['text']+=data
p=Parser();p.feed(sys.stdin.read());print(json.dumps(p.rows,ensure_ascii=True))`;

class Element {
  constructor(row) {this.row = row; this.tagName = row.tag.toUpperCase(); this.textContent = row.text; this.removed = false; this.dataset = {};for (const [key, value] of Object.entries(row.attrs)) {if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;}}
  getAttribute(name) {return Object.hasOwn(this.row.attrs, name) ? this.row.attrs[name] : null;}
  setAttribute(name, value) {this.row.attrs[name] = String(value);}
  get id() {return this.getAttribute('id') || '';}
  get rel() {return this.getAttribute('rel') || '';}
  get content() {return this.getAttribute('content') || '';}
  remove() {this.removed = true;}
}
class Document {
  constructor(source) {
    this.rows = JSON.parse(execFileSync('python3', ['-c', parser], {input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})).map(row => new Element(row));
    this.documentElement = this.rows.find(element => element.tagName === 'HTML');
    this.head = {querySelectorAll: selector => this.querySelectorAll(selector).filter(element => element.row.head)};
  }
  querySelectorAll(selector) {
    const choices = selector.split(',').map(value => value.trim());
    return this.rows.filter(element => !element.removed && choices.some(choice => {
      const match = /^([\w-]+)(?:\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\])?$/.exec(choice);
      assert.ok(match, 'Fixture supports this DOM selector: ' + choice);
      return element.row.tag === match[1] && (!match[2] || Object.hasOwn(element.row.attrs, match[2]) && (match[3] === undefined || element.getAttribute(match[2]) === match[3]));
    }));
  }
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  getElementById(id) {return this.rows.find(element => !element.removed && element.id === id) || null;}
}
class DOMParser {parseFromString(source) {return new Document(source);}}
const globals = {Blob, URL, TextEncoder, Uint8Array, Map, Set, atob, btoa, crypto: webcrypto, DOMParser};
const factoryContext = vm.createContext(globals);
const packager = vm.runInContext(html.slice(start, end) + '\ncreateFrameHTMLPackage()', factoryContext);
const source = '<!doctype html><html><head><meta charset="utf-8"><meta name="frame-version" content="Player test"><link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="frame.ico"><style>body{margin:0}</style><script>window.headBoot = !!window.frameHTMLPlayer;</script></head><body><script>window.appBoot = !!window.frameHTMLPlayer;</script></body></html>';
const sourceURL = 'https://frame.example/releases/current/index.html';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = {pass: false, scope: 'CPU packaging/bootstrap; browser APIs and native rendering not qualified', indexSHA256: digest(html), checks: []};
const check = (name, value, detail) => {assert.ok(value, name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));report.checks.push({name, pass: true});};
const build = (scene, options = {}) => packager.build({source, sourceURL, scene, name: 'scene.hash', ...options});
function boot(text) {
  const document = new Document(text), context = vm.createContext({...globals, document, location: new URL('file:///offline/project/player.html')});
  context.window = context;
  for (const script of document.querySelectorAll('script')) if (!script.getAttribute('type') || script.getAttribute('type') === 'text/javascript') vm.runInContext(script.textContent, context, {timeout: 3000});
  return context;
}

for (const size of [0, 1, 2, 3, 4, 16383, 16384, 16385, 196607, 196608, 196609, 1048577]) {
  const bytes = randomBytes(size), result = boot(await (await build(new Blob([bytes]))).text());
  const restored = Buffer.from(await result.frameHTMLPlayer.scene.arrayBuffer());
  check('Binary scene bytes round-trip at size ' + size, restored.length === size && digest(restored) === digest(bytes));
  check('Player flag precedes original head and body scripts at size ' + size, result.headBoot && result.appBoot && result.document.documentElement.getAttribute('data-frame-player') === '');
  assert.equal(result.document.querySelectorAll('script[data-frame-player-bytes]').length, 0, 'Bootstrap releases encoded DOM chunks');
}
const values = {source: '</script><script>window.injected=true</script>', unicode: 'Сцена 🧩', number: -0};
const records = [
  {id: H.K.version, type: H.T.uint32, value: new Uint32Array([1])},
  {id: H.K.parameters, type: H.T.value, value: values},
  {id: H.K.name, type: H.T.text, value: 'Native HASH'},
];
const scene = new Blob((await Promise.all(records.map(record => H.pack(record)))).map(record => record.blob));
const name = 'Scene </script><script>window.injected=true</script> " \' & 🧩.hash';
const bytes = randomBytes(196609), resources = [
  {path: 'models/data.bin', blob: new Blob([bytes])},
  {path: 'plugins/test/plugin.js', blob: new Blob(['export const value = 23;'])},
];
const originalResources = resources.map(resource => ({...resource}));
const links = {roots: {'./assembly.hash': 'parts/assembly.hash'}, values: ['</script>', '🧩']};
const output = await build(scene, {name, resources, links}), text = await output.text(), result = boot(text), player = result.frameHTMLPlayer;
check('Package has the HTML MIME type', output.type === 'text/html');
check('Hostile name remains exact inert data', player.name === name && !result.injected);
check('Embedded link metadata remains exact inert data', JSON.stringify(player.links) === JSON.stringify(links));
check('Native HASH survives packaging byte for byte', digest(Buffer.from(await scene.arrayBuffer())) === digest(Buffer.from(await player.scene.arrayBuffer())));
const reader = H.reader(player.scene), index = await reader.index();
for (const record of records) assert.deepEqual(await reader.read(index.get(record.id)), record.value);
check('Native HASH typed values survive bootstrap', true);
check('Resource inputs retain identity and paths', resources.every((resource, i) => resource.path === originalResources[i].path && resource.blob === originalResources[i].blob));
check('Resource resolves by relative, original absolute and relocated file URL', ['models/data.bin', sourceURL.replace('index.html', 'models/data.bin'), 'file:///offline/project/models/data.bin'].every(path => player.blob(path).size === bytes.length));
const resourceURL = player.resource('models/data.bin');
check('Resource URL is reused for its canonical path', resourceURL.startsWith('blob:') && resourceURL === player.resource('./models/data.bin'));
check('Native fetch reads exact bytes from the generated Blob URL', digest(Buffer.from(await (await fetch(resourceURL)).arrayBuffer())) === digest(bytes));
check('JavaScript resources have an executable MIME', player.blob('plugins/test/plugin.js').type === 'text/javascript');
assert.throws(() => player.resource('missing.bin'), /not embedded/i);
assert.throws(() => player.blob('https://other.invalid/secret'), /not embedded/i);
assert.throws(() => player.blob('../outside.bin'), /not embedded/i);
check('Missing, foreign and outside-root resource lookups fail explicitly', true);
const policy = result.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '';
check('Output declares local-only resource policy', /default-src 'none'/.test(policy) && /connect-src blob: data:/.test(policy) && /worker-src blob: data:/.test(policy));
check('Manifest and remote favicon links are absent', !result.document.querySelectorAll('link[href]').some(element => !element.getAttribute('href').startsWith('data:')));
const identity = await packager.sourceIdentity(source);
await build(scene, {expectedIdentity: identity});
await assert.rejects(() => build(scene, {expectedIdentity: '0'.repeat(64)}), /Frame changed/);
for (const changed of [source.replace('Player test', 'Different version'), source.replace('margin:0', 'margin:1px'), source.replace('window.appBoot =', 'window.otherBoot =')]) await assert.rejects(() => build(scene, {source: changed, expectedIdentity: identity}), /Frame changed/);
check('Exact build identity succeeds and changed release, style or script rejects', true);
await assert.rejects(() => build(scene, {resources: [{path: 'same.js', blob: new Blob(['a'])}, {path: './same.js', blob: new Blob(['b'])}]}), /Duplicate/);
for (const path of ['https://other.invalid/a.js', '../outside.js', 'one.js#fragment']) await assert.rejects(() => build(scene, {resources: [{path, blob: new Blob(['a'])}]}), /Invalid embedded resource/);
check('Conflicting aliases and resources outside the bundle reject before output', true);
await assert.rejects(() => build(scene, {source: source.replace('</head>', '<script src="remote.js"></script></head>')}), /external resource/);
await assert.rejects(() => build(scene, {source: source.replace('</body>', '<img src="remote.png"></body>')}), /external resource/);
await assert.rejects(() => build(scene, {source: source.slice(0, -7)}), /Incomplete/);
await assert.rejects(() => build(scene, {source: text}), /original Frame build/);
check('External shell resources, incomplete HTML and re-exported players reject', true);
// The real application shell must satisfy the same packaging contract; no renderer is invoked.
const nativeIdentity = await packager.sourceIdentity(html);
const full = await packager.build({source: html, sourceURL, scene, expectedIdentity: nativeIdentity});
check('The complete current Frame shell can be packaged', full.type === 'text/html' && full.size > html.length);
report.pass = true;
console.log(JSON.stringify(report, null, 2));
