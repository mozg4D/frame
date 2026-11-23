// Execute the shipped Player host/startup/camera/link helpers with CPU host fixtures.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash, webcrypto} from 'node:crypto';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const extract = (first, next, from = 0) => {
  const start = html.indexOf(first, from), end = html.indexOf(next, start);
  assert.ok(start >= 0 && end > start, 'Source boundary: ' + first);
  return html.slice(start, end);
};
const checks = [], check = (name, value) => {assert.ok(value, name);checks.push({name, pass: true});};
class Element extends EventTarget {
  constructor(tag, document) {super();this.tagName = tag.toUpperCase();this.ownerDocument = document;this.children = [];this.parentNode = null;this.attributes = {};this.textContent = '';}
  append(...children) {for (const child of children) {child.remove();child.parentNode = this;this.children.push(child);}}
  remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);this.parentNode = null;}
  setAttribute(name, value) {this.attributes[name] = value;}
}
class Document extends EventTarget {
  constructor() {super();this.body = new Element('body', this);this.title = 'Frame';}
  createElement(tag) {return new Element(tag, this);}
  getElementById(id) {const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean);return visit(this.body) || null;}
}
const controlSource = extract('const FrameSceneControl=(()=>{', '/* Scene Control runtime.');
const inputSource = extract('function on(kind,type,listener,options){', 'function off(kind,type,listener,options){');
const document = new Document(), window = Object.assign(new EventTarget(), {document, closed: false});
const state = {mounts: 0, cleanup: 0, late: 0, popup: 0, close: 0, geometry: 0, editor: 0, game: 0, lifecycle: 0};
window.open = () => {state.popup++;throw Error('Unexpected popup');};window.close = () => {state.close++;};
const context = vm.createContext({window, document, frameHTMLPlayer: {}, Promise, console, Event, createFrameDocumentationGeometry: () => ({installDocumentationGeometry() {state.geometry++;}, documentationWindowFeatures() {state.geometry++;}})});
const control = vm.runInContext(controlSource + '\nFrameSceneControl', context);
const mount = host => {
  assert.equal(host.window, window);assert.equal(host.host, window);assert.equal(host.document, document);
  state.mounts++;host.root.append(document.createElement('button'));return () => {state.cleanup++;};
};
const first = control.register(mount), second = control.register(mount);
await Promise.resolve();
check('Scene Control creates one inline root with independent panel registrations', document.getElementById('frame-player-control').children.length === 2 && state.mounts === 2 && control.inspect().panels === 2);
first();first();
check('Unregister removes one panel and disposes once', state.cleanup === 1 && control.inspect().panels === 1);
control.open();control.open();
check('Opening an inline panel again does not remount existing content', state.mounts === 2 && state.popup === 0 && state.geometry === 0);
control.close();
check('Closing inline panels never closes the player window', state.cleanup === 2 && state.close === 0 && !control.inspect().open);
control.open();await Promise.resolve();
check('Reopen remounts retained registrations once', state.mounts === 3 && control.inspect().panels === 1);
let finish;
const remove = control.register(() => new Promise(resolve => {finish = () => resolve(() => {state.late++;});}));
remove();finish();await Promise.resolve();await Promise.resolve();
check('A late cleanup runs after an asynchronous mount was removed', state.late === 1);
control.reset();control.reset();second();
check('Document reset is idempotent and clears all panels', state.cleanup === 3 && control.inspect().panels === 0 && document.getElementById('frame-player-control').children.length === 0);
context.subscriptions = [];context.targets = kind => [kind === 'document' ? document : window];
const on = vm.runInContext(inputSource + '\non', context);
for (const name of ['keydown', 'keyup', 'click', 'pointerdown', 'pointerup', 'wheel', 'contextmenu']) on('document', name, () => {state.editor++;}, true);
on('window', 'frame-engine-scene', () => {state.lifecycle++;});
document.addEventListener('keydown', () => {state.game++;});
document.dispatchEvent(new Event('keydown'));document.dispatchEvent(new Event('pointerdown'));window.dispatchEvent(new Event('frame-engine-scene'));
check('Player skips editor input while retaining direct scene input and lifecycle events', state.editor === 0 && state.game === 1 && state.lifecycle === 1);
control.register(mount);await Promise.resolve();window.dispatchEvent(new Event('pagehide'));
check('Page retirement cleans inline UI without closing its host', state.cleanup === 4 && state.close === 0 && control.inspect().panels === 0);

const startSource = extract('async function start(){', 'const zipCRC32=', html.indexOf('async function newFile(){'));
let releaseResources, releaseScene, releaseLoad;
const loadCalls = [], startContext = vm.createContext({frameHTMLPlayer: {name: 'Example.hash', ready: new Promise(resolve => {releaseResources = resolve;}), scene: new Promise(resolve => {releaseScene = resolve;})}, document: {title: 'Frame'}, loadHash: async (...args) => {loadCalls.push(args);await new Promise(resolve => {releaseLoad = resolve;});}});
const start = vm.runInContext(startSource + '\nstart', startContext), pendingStart = start();
await Promise.resolve();check('Player waits for packaged resources before loading HASH', loadCalls.length === 0);
releaseResources();await Promise.resolve();check('Player waits for the embedded HASH Blob', loadCalls.length === 0);
const embeddedScene = new Blob(['scene']);releaseScene(embeddedScene);await new Promise(resolve => setImmediate(resolve));
check('Player forwards the original Blob and name exactly once', loadCalls.length === 1 && loadCalls[0][0] === embeddedScene && loadCalls[0][1] === 'Example.hash');
check('Title is not published before HASH loading completes', startContext.document.title === 'Frame');
releaseLoad();await pendingStart;
check('Player startup completes with the scene title', startContext.document.title === 'Example');
const failure = Error('WebGPU unavailable');startContext.loadHash = async () => {throw failure;};
await assert.rejects(start, error => error === failure);
check('Player startup propagates renderer/HASH loading failures', true);
const catchSource = html.match(/api\.ready=start\(\)\.catch\(error=>\{[^\n]+\}\);/)?.[0];
assert.ok(catchSource, 'Shipped ready error handler');
const readyContext = vm.createContext({api: {}, start: () => Promise.reject(failure), frameHTMLPlayer: {}, canvas: {dataset: {}}, status: {hidden: true}, fileOperationError() {}});
vm.runInContext(catchSource, readyContext);
await assert.rejects(readyContext.api.ready, error => error === failure);
check('API readiness rejects and exposes a visible player failure', readyContext.canvas.dataset.ready === 'error' && !readyContext.status.hidden && readyContext.status.textContent === failure.message);

const cameraSource = extract('function applyNativeCamera(v,preservePerspective=false){', 'function nativeSceneEvent(', html.indexOf('async function getRenderer('));
const camera = vm.createContext({frameHTMLPlayer: {}, scene: {center: [0, 0, 0], scale: 1}, viewStates: [[], [], [], []], rotatePoint: point => point, defaultCamera: () => new Array(12).fill(0), viewIndex: 3, activeView: 3, mainActiveView: 3, single: false, viewShadings: [], viewShadingNames: ['solid', 'solid-wire', 'wire', 'off'], defaultViewShadings: [], shadingMode: '', restoreCamera(value) {camera.restored = value;}, orbitGeneration: 0, renderViews() {}, window: {dispatchEvent() {}}, CustomEvent: class {}, elementMode: 'object'});
const applyCamera = vm.runInContext(cameraSource + '\napplyNativeCamera', camera);
const saved = new Float64Array(27);saved[2] = 2;saved[11] = 5;saved[14] = saved[17] = saved[20] = 1;saved[21] = 3;saved[22] = 0;saved.set([1, 2, 0, 3], 23);
applyCamera(saved);
check('Player restores the saved Perspective camera in a single viewport', camera.single && camera.viewIndex === 0 && camera.activeView === 0 && camera.mainActiveView === 0 && camera.restored === camera.viewStates[0] && camera.viewStates[0][2] === saved[2]);
check('Player preserves authored per-view shading', Array.from(camera.viewShadings).join(',') === 'solid-wire,wire,solid,off');

const fileStart = html.indexOf('const FrameFileSources=(()=>{');
const exportSource = extract('async function exportResources(add){', 'function inspect(){', fileStart);
const sha256 = async bytes => createHash('sha256').update(bytes).digest('hex');
function linkedHarness() {
  const author = {documentToken: 'one'}, files = new Map(), entries = new Map(), data = new Map(), nodes = [
    {nativeHash: 'owner-a', type: 'instance', params: {file: 'a.hash'}},
    {nativeHash: 'owner-a-again', type: 'instance', params: {file: 'a.hash'}},
    {nativeHash: 'owner-b', fileSource: 'source-a', fileMount: 'nested', type: 'instance', params: {file: 'b.gltf'}},
    {nativeHash: 'owner-b-top', fileMount: 'asset-folder', type: 'instance', params: {file: 'b.gltf'}},
  ];
  const a = {descriptor: 'a', root: 'root-a', token: 'source-a', primaryVersion: 'a-version', dependencies: []};
  const b = {descriptor: 'b', root: 'root-b', token: 'source-b', primaryVersion: 'b-version', dependencies: [{descriptor: 'data', uri: 'buffer.bin', digest: createHash('sha256').update('binary data').digest('hex')}]};
  files.set('a', new File(['native a'], 'a.hash'));files.set('b', new File(['native b'], 'b.gltf'));files.set('data', new File(['binary data'], 'buffer.bin'));
  entries.set('a.hash', a);entries.set('b.gltf', b);
  const host = {nodes, Blob, FrameAuthorData: author, flush: async () => {}, entry: node => entries.get(node.params.file), fileAt: async descriptor => files.get(descriptor), createFrameFileIndex: () => ({read: async () => ({version: 'a-version'})}), fingerprint: async () => 'b-version', sha256};
  const capture = Function('host', 'with(host){' + exportSource + ';return exportResources;}')(host);
  return {author, files, nodes, entries, data, host, capture, add: async (path, blob) => {assert.ok(!data.has(path));data.set(path, blob);}};
}
const linked = linkedHarness(), before = JSON.stringify(linked.nodes), links = await linked.capture(linked.add);
check('Repeated file instances share one embedded source', links.files.length === 2 && links.roots[JSON.stringify(['', 'a.hash'])] === 0 && links.roots[JSON.stringify(['asset-folder', 'b.gltf'])] === 1);
check('Nested file instances retain source-specific resolution', links.files[0].children[JSON.stringify(['nested', 'b.gltf'])] === 1 && links.files[1].dependencies['buffer.bin'] === '__frame_files__/1/resource-0');
check('Linked source and companion bytes are captured exactly', await linked.data.get('__frame_files__/0/a.hash').text() === 'native a' && await linked.data.get('__frame_files__/1/b.gltf').text() === 'native b' && await linked.data.get('__frame_files__/1/resource-0').text() === 'binary data');
check('Linked-file export does not rewrite authored owner paths', JSON.stringify(linked.nodes) === before);
const changed = linkedHarness();changed.files.set('data', new File(['changed bytes'], 'buffer.bin'));
await assert.rejects(() => changed.capture(changed.add), /Linked resource changed/);
const stale = linkedHarness();stale.entries.get('a.hash').primaryVersion = 'old-version';
await assert.rejects(() => stale.capture(stale.add), /Linked file changed/);
const replaced = linkedHarness();replaced.host.fileAt = async descriptor => {replaced.author.documentToken = 'replacement';return replaced.files.get(descriptor);};
await assert.rejects(() => replaced.capture(replaced.add), /Scene changed/);
const unresolved = linkedHarness();unresolved.entries.get('a.hash').root = null;
await assert.rejects(() => unresolved.capture(unresolved.add), /not ready/);
check('Unresolved, changed companion, stale source and replaced document reject export', true);

const descriptorSource = extract('function descriptor(n){', 'function watch(){', fileStart);
const playbackHost = {
  framePlayer: true, window: {frameHTMLPlayer: {links}}, definitions: new Map([['source-a', {descriptor: {kind: 'embedded', index: 0}}]]),
  frameIsModelFile: value => /\.(?:hash|gltf)$/.test(value),
};
const descriptor = Function('host', 'with(host){' + descriptorSource + '\nreturn descriptor;}')(playbackHost);
const switched = {nativeHash: 'copied-owner', params: {file: 'a.hash'}};
assert.equal(descriptor(switched).index, 0);
switched.params.file = 'b.gltf';switched.fileMount = 'asset-folder';
assert.equal(descriptor(switched).index, 1);
switched.params.file = 'unknown.gltf';assert.throws(() => descriptor(switched), /not embedded/);
switched.params.file = 'b.gltf';delete switched.fileMount;assert.throws(() => descriptor(switched), /not embedded/);
check('Player file selection uses the captured path and mount, including copied and switched instances', true);
assert.equal(descriptor({fileSource: 'source-a', fileMount: 'nested', params: {file: 'b.gltf'}}).index, 1);
assert.throws(() => descriptor({fileSource: 'source-a', fileMount: 'other', params: {file: 'b.gltf'}}), /not embedded/);
check('Nested player file selection cannot reuse a different child path or grant', true);

const fileReadSource = extract('async function fileAt(d){', 'async function sha256(bytes){', fileStart);
const dependencySource = extract('async function readDependency(descriptor,uri,signature){', 'async function ensureChildren(', fileStart);
const ensureSource = extract('async function ensure(e,ancestry,visited){', 'let flushPromise=', fileStart);
function readHarness(uri) {
  const source = new File(['linked glTF'], 'fixture.gltf', {lastModified: 1}), calls = [], captures = new Map();
  const e = {descriptor: {kind: 'picked', mount: 'picked-folder', path: source.name, key: 'fixture'}, dependencies: [], dirty: true};
  const host = {
    File, Blob, URL, crypto: webcrypto, DOMException, sha256, FrameAuthorData: {documentToken: 'original'},
    FrameHash: {newId: () => 'native-root'}, frameUTF8: new TextEncoder(),
    nodes: [{type: 'instance', params: {file: source.name}}], definitions: new Map(), picked: new Map(), ownedMaterials: new Set(), ownedAssets: new Set(),
    pickedFile: descriptor => {if (descriptor.path === source.name) return source;throw new DOMException('Image does not exist', 'NotFoundError');},
    relativeLocal: (descriptor, path) => ({...descriptor, path, key: path}),
    fetch: async url => {calls.push(String(url));assert.ok(String(url).startsWith('blob:'));return fetch(url);},
    fingerprint: async () => 'fixture-version', ensureChildren: async () => {},
    FrameSpline: {request() {}, flush: async () => {}}, frameSyncEngineVisibility() {}, errorText: error => error.message,
    window: {frameEngine: {
      loadFileSource: async (file, options) => {
        assert.equal(file, source);
        try {const bytes = await options.readResource(uri);assert.ok(bytes.length);await options.readResource(uri);}
        catch (error) {if (error.name !== 'NotFoundError') throw error;}
        return {materials: [], assets: []};
      }, loadLibraryObjects: async () => {}, replicaQueue: Promise.resolve(), draw: async () => {},
    }},
    entry: () => e,
  };
  const helpers = Function('host', 'with(host){' + fileReadSource + dependencySource + ensureSource + exportSource + '\nreturn {fileAt,metadata,resourceDescriptor,ensure,exportResources};}')(host);
  host.flush = () => helpers.ensure(e, new Set(), new Set());
  return {e, calls, captures, helpers, host, capture: () => helpers.exportResources(async (path, blob) => {captures.set(path, blob);})};
}
const oldBlob = URL.createObjectURL(new Blob(['ephemeral companion bytes']));
let blobLinked;
try {
  blobLinked = readHarness(oldBlob);
  const packagedLinks = await blobLinked.capture();
  check('Linked loading records blob companions once with an immutable key and exact digest', blobLinked.e.dependencies.length === 1 && blobLinked.e.dependencies[0].descriptor.kind === 'blob' && blobLinked.e.dependencies[0].signature === oldBlob && blobLinked.e.dependencies[0].digest === await sha256(Buffer.from('ephemeral companion bytes')) && blobLinked.calls.length === 2);
  const resource = packagedLinks.files[0].dependencies[oldBlob];
  check('Linked export captures session blob bytes under an embedded resource path', await blobLinked.captures.get(resource).text() === 'ephemeral companion bytes');
  URL.revokeObjectURL(oldBlob);
  const restore = {File, window: {frameHTMLPlayer: {links: packagedLinks, blob: path => blobLinked.captures.get(path)}}, fetch: () => {throw Error('Unexpected external fetch');}};
  const helpers = Function('host', 'with(host){' + fileReadSource + '\nreturn {fileAt,metadata,resourceDescriptor};}')(restore);
  const resolved = helpers.resourceDescriptor({kind: 'embedded', index: 0}, oldBlob);
  check('Player resolves an expired original blob URL from packaged companion bytes', resolved.kind === 'embedded-resource' && await (await helpers.fileAt(resolved)).text() === 'ephemeral companion bytes' && await helpers.metadata(resolved) === resolved.key);
  assert.equal(helpers.resourceDescriptor({kind: 'embedded', index: 0}, 'data:image/png;base64,AA=='), null);
  assert.throws(() => helpers.resourceDescriptor({kind: 'embedded', index: 0}, 'blob:unpackaged'), /not embedded/);
  check('Inline data remains self-contained and an unknown blob dependency fails visibly', true);
} finally {URL.revokeObjectURL(oldBlob);}
const missingImage = readHarness('missing.png');
await assert.rejects(missingImage.capture, /Linked resources are missing: missing\.png/);
check('A missing optional glTF image accepted by the loader is recorded and blocks HTML export', missingImage.e.root === 'native-root' && missingImage.e.missing.join(',') === 'missing.png' && missingImage.captures.size === 0);

const assetsSource = extract('function framePlayerAssets(root,owners){', 'async function frameSaveHTML(');
const playerAssets = Function(assetsSource + '\nreturn framePlayerAssets;')();
const declaration = data => ({kind: 'opaque', name: 'Game assets', payload: {format: 'frame.player-assets', version: 1, data}});
const declared = playerAssets({records: [declaration({resources: ['game/one.bin'], plugins: ['atomic'], stock: ['human']})]}, [
  {authorData: {records: [declaration({resources: ['game/one.bin', 'game/two.bin'], plugins: ['atomic'], stock: ['car']})]}},
  {fileSource: 'inert-linked-source', authorData: {records: [declaration({resources: ['unreachable.bin']})]}},
]);
assert.deepEqual(declared, {resources: ['game/one.bin', 'game/two.bin'], plugins: ['atomic'], stock: ['human', 'car']});
for (const data of [{resources: null}, {plugins: ['BAD']}, {stock: ['unknown']}, {resources: ['a\\b']}, {unexpected: []}]) assert.throws(() => playerAssets({records: [declaration(data)]}, []), /Invalid Player/);
check('Dynamic asset declarations deduplicate, exclude inert linked programs and validate their shape', true);

const saveSource = extract('async function frameSaveHTML(', 'async function saveSceneFile(');
function exportHarness() {
  const calls = [], requests = [], packed = [], source = 'current-source', scene = new Blob(['native scene']), root = {records: [declaration({resources: ['game/one.bin'], plugins: ['atomic']})]};
  const host = {
    Blob, URL, sceneFileName: 'original.hash', document: {baseURI: 'https://frame.example/app/index.html'}, frameHTMLSourceIdentity: Promise.resolve('same-build'),
    framePlayerAssets: playerAssets,
    fetch: async url => {url = String(url);requests.push(url);return {ok: true, type: 'basic', url, text: async () => url.endsWith('index.html') ? source : 'resource', blob: async () => new Blob(['resource'])};},
    FrameHTMLPackage: {sourceIdentity: async value => value === source ? 'same-build' : 'different-build', build: async data => {packed.push(data);return new Blob(['standalone html'], {type: 'text/html'});}},
    FrameAuthorData: {documentToken: 'original-document', root: () => root},
    nodes: [{type: 'cube', params: {}, tags: []}],
    FrameScenePrograms: {exportPlans: () => [{name: 'Game', availability: 'available'}]},
    FrameFileSources: {flush: async () => {calls.push('files-ready');}, exportResources: async add => {calls.push('files');await add('__frame_files__/0/part.hash', new Blob(['part']));return {roots: {}, files: []};}},
    FramePlugins: {flush: async () => {calls.push('plugins-ready');}, exportResources: async (add, extra) => {calls.push('plugins:' + extra.join(','));await add('plugins/index.json', new Blob(['[]'], {type: 'application/json'}));}},
    frameMaterialState: () => ({assets: [{path: 'textures/one.png'}]}), frameMaterialAssets: new Map(),
    window: {frameEngine: {fileEditStamp: 11, animationFlush: async () => {calls.push('animation-ready');}, saveHash: async () => {calls.push('hash');return scene;}}},
  };
  const context = vm.createContext(host), save = vm.runInContext(saveSource + '\nframeSaveHTML', context);
  return {host, calls, requests, packed, source, scene, root, save};
}
const exported = exportHarness();const exportedBlob = await exported.save('Exported.html');
check('HTML export captures the native HASH after readiness and carries plugin/link assets', exported.calls.join(',') === 'files-ready,animation-ready,plugins-ready,hash,files,plugins:atomic' && exported.packed[0].scene === exported.scene && exportedBlob.type === 'text/html' && exported.packed[0].name === 'Exported.hash');
check('HTML export includes declared dynamic assets and material paths', exported.packed[0].resources.some(resource => resource.path === 'game/one.bin') && exported.packed[0].resources.some(resource => resource.path === 'textures/one.png'));
const mismatch = exportHarness();mismatch.host.FrameHTMLPackage.sourceIdentity = async () => 'different-build';
await assert.rejects(mismatch.save, /Frame changed/);check('Source mismatch stops export before scene serialization', mismatch.calls.length === 0);
const cached = exportHarness();cached.host.fetch = async url => {if (String(url).endsWith('index.html')) throw Error('offline');return {ok: true, type: 'basic', url: String(url), blob: async () => new Blob(['cached resource'])};};
cached.host.caches = {keys: async () => ['frame-cached'], open: async () => ({match: async () => ({ok: true, text: async () => cached.source})})};
await cached.save();check('The exact cached Frame build can provide an offline source', cached.packed.length === 1);
const changing = exportHarness();changing.host.window.frameEngine.saveHash = async () => {changing.host.window.frameEngine.fileEditStamp++;return changing.scene;};
await assert.rejects(changing.save, /Scene changed/);check('Editing during HASH capture rejects the export before packaging', changing.packed.length === 0);
const invalidProgram = exportHarness();invalidProgram.host.FrameScenePrograms.exportPlans = () => [{name: 'Broken', availability: 'unavailable', error: {message: 'Missing source'}}];
await assert.rejects(invalidProgram.save, /Scene Control Broken: Missing source/);check('Unavailable executable programs reject before exporting an incomplete player', !invalidProgram.calls.includes('hash'));
const outside = exportHarness();outside.root.records = [declaration({resources: ['https://elsewhere.invalid/resource.bin']})];
await assert.rejects(outside.save, /must stay inside/);check('Dynamic asset declarations cannot escape the captured application', !outside.requests.some(url => url.includes('elsewhere.invalid')));

const saveFileSource = extract('async function saveSceneFile(', "$('btnNew').onclick=");
function saveFileHarness(mode = 'picker') {
  const original = {name: 'original.hash'}, writes = [], errors = [], calls = {saved: 0, close: 0, abort: 0, reset: 0, recent: 0, clicked: 0}, timers = [];
  const output = new Blob(['html'], {type: 'text/html'}), chosen = {name: 'player.html', createWritable: async () => ({write: async blob => {writes.push(blob);}, close: async () => {calls.close++;}, abort: async () => {calls.abort++;}})};
  const picker = async () => {if (mode === 'cancel') throw Object.assign(Error('Cancelled'), {name: 'AbortError'});return chosen;};
  const host = {
    URL, Blob, Promise, sceneFileName: original.name, sceneFileHandle: original, lastSavedFormat: 'hash', closeMenu() {},
    window: {showSaveFilePicker: mode === 'download' ? undefined : picker}, showSaveFilePicker: picker,
    frameSaveHTML: async () => {calls.saved++;return output;},
    frameNativeFileTask: async (operation, options) => {await options?.prepare?.();return operation();},
    fileOperationError: error => {errors.push(error);},
    FrameProjectFile: {reset: () => {calls.reset++;}}, rememberSceneFile: () => {calls.recent++;}, frameSetSceneFileName: name => {host.sceneFileName = name;},
    document: {createElement: () => ({click: () => {calls.clicked++;}, remove() {}}), body: {append() {}}},
    setTimeout: callback => {timers.push(callback);},
  };
  const run = Function('host', 'with(host){' + saveFileSource + '\nreturn saveSceneFile;}')(host);
  return {host, run, calls, writes, errors, original, output, timers};
}
for (const mode of ['picker', 'download']) {
  const target = saveFileHarness(mode);await target.run({as: true, format: 'html', download: mode === 'download'});
  check('HTML ' + mode + ' export preserves the bound HASH, title and save format', target.errors.length === 0 && target.host.sceneFileHandle === target.original && target.host.sceneFileName === 'original.hash' && target.host.lastSavedFormat === 'hash' && target.calls.reset === 0 && target.calls.recent === 0);
  check('HTML ' + mode + ' export writes/downloads exactly once', target.calls.saved === 1 && (mode === 'picker' ? target.writes[0] === target.output && target.calls.close === 1 : target.calls.clicked === 1));
  for (const callback of target.timers) callback();
}
const cancelled = saveFileHarness('cancel');await cancelled.run({as: true, format: 'html'});
check('Cancelled HTML picker preserves binding and performs no serialization', cancelled.calls.saved === 0 && cancelled.host.sceneFileHandle === cancelled.original && cancelled.errors[0]?.name === 'AbortError');

console.log(JSON.stringify({pass: true, scope: 'CPU host fixtures; no browser or native GPU claim', indexSHA256: createHash('sha256').update(html).digest('hex'), checks}, null, 2));
