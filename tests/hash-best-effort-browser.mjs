import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {launch, ready} from '../tools/browser.mjs';

const sourcePaths = ['index.html', 'tests/hash-best-effort-browser.mjs', 'tools/browser.mjs', 'plugins/index.json'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex')])));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = Object.fromEntries(['group', 'mesh', 'known', 'instance', 'external', 'tag'].map((key, i) => [key, String(i + 1).repeat(32)]));
const knownID = 'hash-known-fixture', knownType = 'hash_known_fixture';
const missingID = 'hash-unavailable-fixture', missingType = 'hash_unavailable_fixture', missingMeshType = 'hash_unavailable_mesh';
const missingTag = 'hash_unavailable_tag';
const recordKeys = Object.fromEntries(['bytes', 'uint32', 'ids', 'float32', 'float64', 'text'].map((key, i) => [key, (i + 10).toString(16).repeat(32)]));
// A field key can equal an object identity without becoming an object reference.
recordKeys.text = ids.mesh;
const fixtureConfig = {ids, knownID, knownType, missingID, missingType, missingMeshType, missingTag, recordKeys};

// HASH completion diagnostics are published after the GPU scene is installed.
// dataset.scene can contain counts without a filename. Content is checked separately
// through scene.inspect below; neither a recent filename nor an idle UI suffices.
function nativeOpenComplete({fileBytes, previousHashLoad}) {
  const app = document.querySelector('#app'), canvas = document.querySelector('#frame-engine-canvas');
  if (!app || !canvas || app.inert || !globalThis.frameEngine?.idle || canvas.dataset.ready !== 'true' || canvas.dataset.operationError) return false;
  const raw = canvas.dataset.hashLoad;
  if (!raw || raw === previousHashLoad) return false;
  let load; try { load = JSON.parse(raw); } catch { return false; }
  return load?.fileBytes === fileBytes && Number.isFinite(load.elapsedMs) && load.elapsedMs >= 0;
}

// Executed in the actual application page. This uses the shipped codec, including
// compression, and bounded authored records rather than a parallel HASH encoder.
async function fixtureInPage({config: c, variant = 'normal'}) {
  const {K, T} = FrameHash, h = c.ids, key = c.recordKeys, records = new Map();
  const put = (id, type, value) => records.set(id, {id, type, value});
  const property = (id, field, type, value) => put(FrameHash.address(id, field), type, value);
  const matrix = (x, y, z, sy = 1) => [1, 0, 0, 0, sy, 0, 0, 0, 1, x, y, z];
  const matrices = {group: matrix(3, 5, -7), mesh: matrix(-4, 6, 8, 2), known: matrix(0, 1, 0), instance: matrix(10, 0, 0), external: matrix(-12, 0, 0)};
  const track = (base, value) => ({kind: 'number', dimensions: Array.isArray(base) ? base.length : 1, base, keys: [[0, {v: base, mode: 'hard'}], [10, {v: value, mode: 'hard'}]]});
  const groupAuthoring = {
    version: 1,
    plugin: {id: c.missingID, type: c.missingType, params: {Owner: h.mesh, Note: h.group, Path: 'pose:' + h.mesh + ':x', Value: 7, Nested: {Owner: h.group, list: [h.mesh]}}},
    tags: [{uid: h.tag, kind: c.missingTag, params: {Owner: h.mesh, Note: h.group, Value: 12}, poses: 'future-shape'}],
    animation: [['position', track([3, 5, -7], [31, 5, -7])], ['param:Value', track(7, 77)], ['tag:' + h.tag + ':Value', track(12, 120)]],
    pluginRecords: Object.entries(key).map(([name, key]) => ({key, type: T[name]}))
  };
  const meshAuthoring = {version: 1, plugin: {id: c.knownID, type: c.missingMeshType, params: {Owner: h.group, Note: h.mesh, Value: 3}}, tags: [], animation: []};
  const knownAuthoring = {version: 1, plugin: {id: c.knownID, type: c.knownType, params: {Owner: h.group, Note: h.group, Value: 2}}, tags: [], animation: []};
  const payloads = {
    bytes: new Uint8Array([0, 1, 127, 128, 255]),
    uint32: new Uint32Array([0, 1, 2147483648, 4294967295]),
    ids: [h.mesh, h.external],
    float32: new Float32Array([0, -0, 1.25, -3.5, 1 / 3]),
    float64: new Float64Array([0, -0, Math.PI, 1 / 3, 1e-200, -1e200]),
    text: h.group + '|pose:' + h.mesh + ':x|opaque UTF-8 \u03a9'
  };
  const vertices = new Float32Array([0, 0, 0, 12, 0, 0, 0, 9, 0]), indices = new Uint32Array([0, 1, 2]);
  const expected = {matrices, groupAuthoring: structuredClone(groupAuthoring), meshAuthoring: structuredClone(meshAuthoring), payloads: {}};
  for (const [name, value] of Object.entries(payloads)) expected.payloads[key[name]] = {type: T[name], value: typeof value === 'string' ? value : Array.from(value), rawHex: ArrayBuffer.isView(value) ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), n => n.toString(16).padStart(2, '0')).join('') : null};
  put(K.version, T.uint32, new Uint32Array([1]));
  put(K.all, T.ids, ['group', 'mesh', 'known', 'instance', 'external'].map(n => h[n]));
  put(K.parameters, T.text, JSON.stringify({version: 1, frame: 0, total: 10, materials: []}));
  for (const name of ['group', 'mesh', 'known', 'instance', 'external']) {
    property(h[name], 'type', T.bytes, new Uint8Array([name === 'mesh' ? 1 : 0]));
    property(h[name], 'name', T.text, 'Best effort ' + name);
    property(h[name], 'matrix', T.float64, new Float64Array(matrices[name]));
    if (['mesh', 'known', 'instance'].includes(name)) property(h[name], 'parent', T.ids, [h.group]);
  }
  property(h.mesh, 'positions', T.float32, vertices);
  property(h.mesh, 'indices', T.uint32, indices);
  property(h.instance, 'spline', T.bytes, FrameSpline.encodeShape({type: 'instance', params: {object: h.mesh}}));
  for (const [name, value] of Object.entries(payloads)) property(h.group, key[name], T[name], value);
  const extensions = ['fedcba98765432100123456789abcdef', '0123456789abcdeffedcba9876543210'];
  put(extensions[0], T.bytes, new Uint8Array([9, 8, 7]));
  // FrameHash.pack accepts typed bytes; the unknown low type is only addressed
  // extension data, never a replacement for a required native property.
  put(extensions[1], 77, new Uint8Array([6, 5, 4, 3]));
  switch (variant) {
    case 'foreign-id-installed-type': groupAuthoring.plugin.type = c.knownType; break;
    case 'bad-known-parameters': knownAuthoring.plugin.params.Value = 'not a number'; break;
    case 'bad-known-tag': knownAuthoring.tags = [{uid: h.tag, kind: 'morph', params: {mode: 'Solve'}, poses: 'invalid'}]; break;
    case 'bad-unknown-params-array': groupAuthoring.plugin.params = []; break;
    case 'bad-unknown-id': groupAuthoring.plugin.id = 12; break;
    case 'bad-unknown-type': groupAuthoring.plugin.type = 'invalid type'; break;
    case 'bad-unknown-tag': groupAuthoring.tags[0].params = []; break;
    case 'bad-unknown-tag-uid': groupAuthoring.tags[0].uid = 'invalid'; break;
    case 'bad-animation': groupAuthoring.animation[1][1].dimensions = 4; break;
    case 'bad-plugin-record-type': groupAuthoring.pluginRecords[0].type = 77; break;
    case 'bad-plugin-record-value': property(h.group, key.float64, T.float64, new Float64Array([NaN])); break;
    case 'inline-record-values': groupAuthoring.recordValues = {[key.float64]: {type: T.float64, value: [1, 2]}}; break;
    case 'bad-index': property(h.mesh, 'indices', T.uint32, new Uint32Array([0, 1, 100])); break;
    case 'bad-position': property(h.mesh, 'positions', T.float32, new Float32Array([0, 0, 0, NaN, 0, 0, 0, 9, 0])); break;
    case 'missing-positions': records.delete(FrameHash.address(h.mesh, 'positions')); break;
    case 'wrong-position-type': property(h.mesh, 'positions', T.float64, new Float64Array(vertices)); break;
    case 'hierarchy-cycle': property(h.group, 'parent', T.ids, [h.mesh]); break;
    case 'missing-parent': property(h.group, 'parent', T.ids, ['9'.repeat(32)]); break;
    case 'singular-matrix': property(h.group, 'matrix', T.float64, new Float64Array(12)); break;
    case 'future-required-type': put(K.version, 77, new Uint8Array([1, 0, 0, 0])); break;
    case 'bad-version': put(K.version, T.uint32, new Uint32Array([2])); break;
    case 'bad-flags': property(h.group, 'flags', T.bytes, new Uint8Array([255])); break;
  }
  property(h.group, 'parameters', T.text, JSON.stringify(groupAuthoring));
  property(h.mesh, 'parameters', T.text, JSON.stringify(meshAuthoring));
  property(h.known, 'parameters', T.text, JSON.stringify(knownAuthoring));
  const parts = [];
  for (const record of records.values()) parts.push((await FrameHash.pack(record)).blob);
  if (variant === 'duplicate-address') parts.push(parts[0]);
  if (variant === 'truncated-header') parts.push(new Uint8Array([0, 1, 2]));
  let bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  if (variant === 'truncated-payload') bytes = bytes.slice(0, -1);
  if (variant === 'oversized-header') new DataView(bytes.buffer).setBigUint64(18, BigInt(bytes.length + 1), true);
  if (bytes.length > 65536) throw Error('The best-effort fixture must remain below 64 KiB');
  return {base64: btoa(String.fromCharCode(...bytes)), bytes: bytes.length, records: records.size, expected, extensions, variant};
}

// Inspect an exported file through the same shipped codec, not live internals.
async function decodeInPage(base64) {
  const file = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]), index = await FrameHash.index(file), out = {};
  for (const [id, record] of index) {
    const value = await FrameHash.read(file, record);
    out[id] = {type: record.type, value: typeof value === 'string' ? value : Array.from(value), rawHex: ArrayBuffer.isView(value) ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), n => n.toString(16).padStart(2, '0')).join('') : null};
  }
  return {records: out, objects: out[FrameHash.K.all].value.map(hash => ({hash, authoring: out[FrameHash.address(hash, 'parameters')] ? JSON.parse(out[FrameHash.address(hash, 'parameters')].value) : null,
    pluginRecords: Object.fromEntries((out[FrameHash.address(hash, 'parameters')] ? JSON.parse(out[FrameHash.address(hash, 'parameters')].value).pluginRecords || [] : []).map(r => [r.key, out[FrameHash.address(hash, r.key)]]))}))};
}

// Isolated context: shared-suite callers' working scenes are never modified.
export async function hashBestEffortBrowserChecks(parent) {
  const sources = await sourceHashes(), checks = [], timings = [], cases = [], errors = [], consoleErrors = [], diagnostics = {};
  const context = await parent.context().browser().newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  const page = await context.newPage();
  const observe = p => { p.on('pageerror', e => errors.push(e.stack || e.message)); p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); }); };
  observe(page);
  const callOn = (p, name, args = {}) => p.evaluate(([n, a]) => frameAI.call(n, a), [name, args]);
  const call = (name, args = {}) => callOn(page, name, args);
  const state = () => call('scene.inspect');
  const make = variant => page.evaluate(fixtureInPage, {config: fixtureConfig, variant});
  const decode = base64 => page.evaluate(decodeInPage, base64);
  const exported = async () => decode((await call('scene.export', {includeData: true})).base64);
  let currentCase = null, result, scoped = false, lateInstalled = false;
  const check = (name, pass, detail) => { checks.push({name, pass: !!pass, ...(detail === undefined ? {} : {detail})}); assert.ok(pass, name + (detail === undefined ? '' : ': ' + JSON.stringify(detail))); };
  const equal = (name, actual, expected) => check(name, same(actual, expected), same(actual, expected) ? undefined : {actual, expected});
  const timed = async (operation, budgetMs, fn) => { const start = performance.now(); const value = await fn(), ms = performance.now() - start; timings.push({operation, ms, budgetMs}); check(operation + ' latency', ms < budgetMs, {ms, budgetMs}); return value; };
  const runCase = async (name, fn) => { currentCase = {name, pass: false}; cases.push(currentCase); await fn(); currentCase.pass = true; currentCase = null; };
  const attachGPU = async p => p.evaluate(() => {
    const device = frameEngine.renderer.device;
    window.__hashBestGPU = {device, errors: [], lost: null};
    device.addEventListener('uncapturederror', e => __hashBestGPU.errors.push(e.error.message));
    device.lost.then(e => { __hashBestGPU.lost = {reason: e.reason, message: e.message}; });
    device.pushErrorScope('validation');
    return device.adapterInfo ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, device.adapterInfo[k]])) : null;
  });
  const finishGPU = p => p.evaluate(async () => { const s = __hashBestGPU; await s.device.queue.onSubmittedWorkDone(); return {validation: (await s.device.popErrorScope())?.message || null, uncaptured: s.errors, lost: s.lost, changed: s.device !== frameEngine.renderer.device}; });
  const gpuOK = g => !g.validation && !g.uncaptured.length && !g.lost && !g.changed;
  const checkHardware = (name, h) => check(name, h && Object.values(h).some(v => typeof v === 'string' && v) && !h.isFallbackAdapter && !/swiftshader|llvmpipe|lavapipe|software/i.test(JSON.stringify(h)), h);
  let fixture, saved, remappedSave, copiedHashes;
  try {
    const catalogue = JSON.parse(await readFile(new URL('../plugins/index.json', import.meta.url), 'utf8'));
    const declaration = type => ({type, name: 'HASH fixture', fields: {Owner: '', Note: '', Value: 1}, textFields: ['Note']});
    await context.route('**/plugins/index.json', route => route.fulfill({json: [...catalogue, knownID + '/plugin.json', ...(lateInstalled ? [missingID + '/plugin.json'] : [])]}));
    await context.route('**/plugins/' + knownID + '/plugin.json', route => route.fulfill({json: {id: knownID, name: 'HASH known fixture', icon: '../mill/icon.svg', module: 'plugin.js', objects: [declaration(knownType), ...(lateInstalled ? [declaration(missingMeshType)] : [])]}}));
    await context.route('**/plugins/' + missingID + '/plugin.json', route => route.fulfill({json: {id: missingID, name: 'HASH formerly unavailable fixture', icon: '../mill/icon.svg', module: 'plugin.js', objects: [declaration(missingType)], tags: [{kind: missingTag, name: 'Formerly unavailable tag', text: 'HT', fields: {Value: 12}}]}}));
    const module = `export function activate(context) { context.operations.register([{id:'probe',description:'Read known HASH fixture',inputSchema:{type:'object',properties:{},additionalProperties:false},readOnly:true,run(hash) { const n=context.document.object(hash); return {hash:n.nativeHash,type:n.type,params:n.params}; }}]); }`;
    for (const id of [knownID, missingID]) await context.route('**/plugins/' + id + '/plugin.js', route => route.fulfill({contentType: 'text/javascript', body: module}));
    await page.goto(parent.url());
    await ready(page);
    diagnostics.hardware = await attachGPU(page); scoped = true;
    checkHardware('Real identifiable hardware WebGPU with no software fallback', diagnostics.hardware);
    fixture = await timed('Build bounded fixture with shipped FrameHash codec', 2000, () => make('normal'));
    diagnostics.fixture = {bytes: fixture.bytes, records: fixture.records, sha256: createHash('sha256').update(Buffer.from(fixture.base64, 'base64')).digest('hex')};

    const assertShells = async (label, groupHash = ids.group, meshHash = ids.mesh) => {
      const s = await state(), group = s.objects.find(n => n.hash === groupHash), mesh = s.objects.find(n => n.hash === meshHash);
      check(label + ' preserves native group and mesh shells', group?.type === 'group' && mesh?.type === 'mesh' && mesh.mesh?.triangles === 1);
      check(label + ' keeps unavailable tags out of active tags', !group.tags.some(t => t.kind === missingTag));
      check(label + ' creates no unavailable plugin parameters on native shells', !Object.hasOwn(group.params, 'Value') && !Object.hasOwn(mesh.params, 'Value'));
      return {s, group, mesh};
    };
    const assertRecords = (label, actual, expectedIDs = [ids.mesh, ids.external]) => {
      for (const [key, expected] of Object.entries(fixture.expected.payloads)) equal(label + ' retains binary/text record type ' + expected.type, actual[key], expected.type === 4 ? {...expected, value: expectedIDs} : expected);
    };

    await runCase('Real Open chooser, native shells, supported children and references', async () => {
      await timed('Native Open file input completion', 6000, async () => {
        const previousHashLoad = await page.locator('#frame-engine-canvas').getAttribute('data-hash-load');
        await page.locator('#frameSceneFile').setInputFiles({name: 'best-effort.hash', mimeType: 'application/x-frame-hash', buffer: Buffer.from(fixture.base64, 'base64')});
        await page.waitForFunction(nativeOpenComplete, {fileBytes: fixture.bytes, previousHashLoad}, {timeout: 6000});
        await state();
      });
      const {s} = await assertShells('Open');
      equal('Open preserves every authored hash and owner count', s.objects.map(n => n.hash).sort(), ['group', 'mesh', 'known', 'instance', 'external'].map(k => ids[k]).sort());
      for (const key of ['group', 'mesh', 'known', 'instance', 'external']) {
        const object = s.objects.find(n => n.hash === ids[key]);
        equal('Open preserves ' + key + ' local affine transform', object.matrix, fixture.expected.matrices[key]);
        equal('Open preserves ' + key + ' native parent', object.parent, ['mesh', 'known', 'instance'].includes(key) ? ids.group : null);
      }
      const known = s.objects.find(n => n.hash === ids.known), instance = s.objects.find(n => n.hash === ids.instance);
      check('Installed child retains type and canonical link to unavailable parent', known.type === knownType && known.params.Owner === ids.group);
      check('Native Instance retains link to unavailable mesh shell', instance.type === 'instance' && instance.params.object === ids.mesh);
      const probe = await call('plugins.command', {id: ids.known, operation: 'probe'});
      check('Installed child plugin is active and callable', probe.type === knownType && probe.params.Value === 2);
      const report = await call('diagnostics.import'); diagnostics.import = report;
      check('HASH import diagnostics expose unavailable plugin identities', report?.format === 'hash' && Array.isArray(report.unavailablePlugins) && report.unavailablePlugins.some(p => p.hash === ids.group && p.id === missingID && p.type === missingType) && report.unavailablePlugins.some(p => p.hash === ids.mesh && p.id === knownID && p.type === missingMeshType), report);
      check('HASH import diagnostics expose unavailable tag identity', Array.isArray(report.unavailableTags) && report.unavailableTags.some(t => t.hash === ids.group && t.uid === ids.tag && t.kind === missingTag), report?.unavailableTags);
      equal('Unknown supported and future addressed records are diagnosed', [...report.ignoredExtensionRecords].sort(), [...fixture.extensions].sort());
    });

    await runCase('Unavailable animation quarantine with live native PSR', async () => {
      const animation = await call('animation.inspect', {id: ids.group});
      equal('Only native PSR track remains active on unavailable owner', animation.channels.map(c => c.path), ['position']);
      await timed('Native PSR seek with unavailable plugin animation', 2000, () => call('animation.seek', {frame: 10}));
      const {group} = await assertShells('Animated');
      equal('Native PSR evaluates the expected frame', group.matrix.slice(9), [31, 5, -7]);
      await call('animation.seek', {frame: 0});
      const decoded = await exported(), owner = decoded.objects.find(n => n.hash === ids.group);
      equal('Quarantined plugin parameters remain authored instead of evaluated', owner.authoring.plugin, fixture.expected.groupAuthoring.plugin);
      equal('Quarantined unknown tag payload remains authored', owner.authoring.tags, fixture.expected.groupAuthoring.tags);
      for (const path of ['param:Value', 'tag:' + ids.tag + ':Value']) equal('Quarantined animation survives canonical authoring: ' + path, owner.authoring.animation.find(r => r[0] === path), fixture.expected.groupAuthoring.animation.find(r => r[0] === path));
      assertRecords('Open', owner.pluginRecords);
      check('Unknown addressed extension payloads are omitted, not retained as blobs', fixture.extensions.every(id => !Object.hasOwn(decoded.records, id)));
    });

    await runCase('Native Save write and API HASH Open round trip', async () => {
      await page.evaluate(() => {
        window.__hashSave = {closed: false, parts: [], name: null};
        window.showSaveFilePicker = async options => ({name: __hashSave.name = options.suggestedName, createWritable: async () => ({write: async part => __hashSave.parts.push(new Blob([part])), close: async () => { __hashSave.closed = true; }, abort: async () => { throw Error('Unexpected Save abort'); }})});
      });
      await timed('Native Save button completed HASH write', 5000, async () => {
        await page.locator('#btnSave').click();
        await page.waitForFunction(() => __hashSave.closed && frameEngine.idle, null, {timeout: 5000});
      });
      saved = await page.evaluate(async () => { const bytes = new Uint8Array(await new Blob(__hashSave.parts).arrayBuffer()); return {base64: btoa(String.fromCharCode(...bytes)), name: __hashSave.name}; });
      check('Native Save chooses a HASH filename', saved.name?.endsWith('.hash'));
      const before = await decode(saved.base64);
      assertRecords('Native Save', before.objects.find(n => n.hash === ids.group).pluginRecords);
      await timed('API HASH Open of completed native Save', 5000, () => call('scene.open', {name: 'best-effort-saved.hash', base64: saved.base64}));
      await assertShells('Save/Open');
      const after = await exported(), group = after.objects.find(n => n.hash === ids.group);
      equal('Save/Open retains ordinary unknown plugin descriptor', group.authoring.plugin, fixture.expected.groupAuthoring.plugin);
      check('Ordinary Open does not mark identities unresolved', !group.authoring.pluginReferencesUnresolved && !group.authoring.tags[0].referencesUnresolved);
      assertRecords('Save/Open', group.pluginRecords);
    });

    const verifyRemap = async (label, roots, externalCopied) => {
      const list = (await state()).objects, group = roots.find(n => n.name === 'Best effort group');
      check(label + ' creates a fresh native root', group && group.hash !== ids.group);
      const mesh = list.find(n => n.name === 'Best effort mesh' && n.parent === group.hash), known = list.find(n => n.name === 'Best effort known' && n.parent === group.hash), instance = list.find(n => n.name === 'Best effort instance' && n.parent === group.hash);
      const external = externalCopied ? roots.find(n => n.name === 'Best effort external')?.hash : ids.external;
      check(label + ' retains children and remaps supported references', mesh && known && instance && mesh.hash !== ids.mesh && known.type === knownType && known.params.Owner === group.hash && known.params.Note === ids.group && instance.params.object === mesh.hash && external);
      await assertShells(label, group.hash, mesh.hash);
      equal(label + ' preserves copied local transforms', [group.matrix, mesh.matrix], [fixture.expected.matrices.group, fixture.expected.matrices.mesh]);
      const decoded = await exported(), owner = decoded.objects.find(n => n.hash === group.hash), meshOwner = decoded.objects.find(n => n.hash === mesh.hash);
      equal(label + ' preserves opaque plugin JSON strings and nested values verbatim', owner.authoring.plugin, fixture.expected.groupAuthoring.plugin);
      check(label + ' keeps an ordinary plugin descriptor plus unresolved-reference flag', owner.authoring.pluginReferencesUnresolved === true && meshOwner.authoring.pluginReferencesUnresolved === true);
      const tag = owner.authoring.tags.find(t => t.kind === missingTag);
      check(label + ' follows native owner-scoped tag identity and marks it unresolved', tag && (externalCopied ? tag.uid !== ids.tag : tag.uid === ids.tag) && tag.referencesUnresolved === true);
      equal(label + ' does not guess references inside unknown tag payload', tag.params, fixture.expected.groupAuthoring.tags[0].params);
      equal(label + ' does not interpret unknown tag poses as Morph data', tag.poses, 'future-shape');
      check(label + ' preserves the quarantined tag animation at its native tag identity', owner.authoring.animation.some(row => row[0] === 'tag:' + tag.uid + ':Value'));
      assertRecords(label, owner.pluginRecords, [mesh.hash, external]);
      const original = decoded.objects.find(n => n.hash === ids.group);
      if (original) {
        assertRecords(label + ' original source', original.pluginRecords);
        equal(label + ' leaves source opaque plugin metadata unchanged', original.authoring.plugin, fixture.expected.groupAuthoring.plugin);
        check(label + ' does not quarantine unchanged source identities', !original.authoring.pluginReferencesUnresolved && !original.authoring.tags[0].referencesUnresolved);
      }
      const active = await call('animation.inspect', {id: group.hash});
      equal(label + ' leaves unknown parameter/tag animation inactive', active.channels.map(c => c.path), ['position']);
      return {group: group.hash, mesh: mesh.hash, known: known.hash, instance: instance.hash, external};
    };

    await runCase('Duplicate, same-tab clipboard, HASH Merge and Undo/Redo', async () => {
      let copied = await timed('Native duplicate of unavailable owner subtree', 3500, () => call('scene.duplicate', {ids: [ids.group]}));
      copiedHashes = await verifyRemap('Duplicate', copied.objects, false);
      await timed('Duplicate Undo', 2500, () => call('edit.history', {action: 'undo'}));
      check('Duplicate Undo removes the copied owner and children', !(await state()).objects.some(n => [copiedHashes.group, copiedHashes.mesh, copiedHashes.known, copiedHashes.instance].includes(n.hash)));
      await timed('Duplicate Redo', 3500, () => call('edit.history', {action: 'redo'}));
      equal('Duplicate Redo keeps the same allocated identities', await verifyRemap('Duplicate Redo', (await state()).objects.filter(n => n.hash === copiedHashes.group), false), copiedHashes);
      await call('scene.delete', {ids: [copiedHashes.group]});
      await call('scene.select', {ids: [ids.group]});
      await timed('Native clipboard capture of unavailable owner', 2500, () => call('edit.copy'));
      copied = await timed('Native clipboard paste of unavailable owner', 3500, () => call('edit.paste'));
      copiedHashes = await verifyRemap('Clipboard', copied.objects, false);
      await call('scene.delete', {ids: [copiedHashes.group]});
      await context.route('**/best-effort-merge.hash', route => route.fulfill({contentType: 'application/x-frame-hash', body: Buffer.from(saved.base64, 'base64')}));
      const prior = (await state()).objects.map(n => n.hash).sort();
      copied = await timed('HASH Merge of unavailable plugin owners', 6000, () => call('scene.merge', {url: 'best-effort-merge.hash'}));
      copiedHashes = await verifyRemap('HASH Merge', copied.objects, true);
      await timed('HASH Merge Undo', 3000, () => call('edit.history', {action: 'undo'}));
      equal('HASH Merge is one Undo transaction', (await state()).objects.map(n => n.hash).sort(), prior);
      await timed('HASH Merge Redo', 3500, () => call('edit.history', {action: 'redo'}));
      const restored = (await state()).objects.filter(n => [copiedHashes.group, copiedHashes.external].includes(n.hash));
      equal('HASH Merge Redo retains remapped identities and quarantine', await verifyRemap('HASH Merge Redo', restored, true), copiedHashes);
      // Only remapped objects are kept in this file. An original, now available
      // descriptor must not obscure whether the unresolved flag prevents activation.
      await call('scene.delete', {ids: [ids.group, ids.external]});
      remappedSave = await call('scene.export', {includeData: true});
      await timed('Reopen remapped unknown descriptors', 5000, () => call('scene.open', {name: 'unresolved.hash', base64: remappedSave.base64}));
      await assertShells('Reopened remap', copiedHashes.group, copiedHashes.mesh);
      const reopened = (await exported()).objects.find(n => n.hash === copiedHashes.group);
      check('Unresolved flag survives HASH Save/Open', reopened.authoring.pluginReferencesUnresolved === true && reopened.authoring.tags[0].referencesUnresolved === true);
      assertRecords('Reopened remap', reopened.pluginRecords, [copiedHashes.mesh, copiedHashes.external]);
    });

    await runCase('Foreign plugin ID cannot inherit an installed type schema', async () => {
      const collision = await make('foreign-id-installed-type');
      await timed('Open foreign plugin ID with an installed type name', 5000, () => call('scene.open', {name: 'foreign-id.hash', base64: collision.base64}));
      await assertShells('Foreign ID');
      const owner = (await exported()).objects.find(n => n.hash === ids.group);
      equal('Foreign ID payload is retained without installed-schema reinterpretation', owner.authoring.plugin, {...fixture.expected.groupAuthoring.plugin, type: knownType});
    });

    await runCase('Corrupt required data still rejects atomically', async () => {
      await call('scene.open', {name: 'atomic-baseline.hash', base64: saved.base64});
      const marker = await call('scene.create', {type: 'group', name: 'History sentinel'});
      const before = (await state()).objects, priorReport = await call('diagnostics.import'), beforeGeometry = await call('diagnostics.mesh', {id: ids.mesh, geometry: true});
      const rejected = ['bad-known-parameters', 'bad-known-tag', 'bad-unknown-params-array', 'bad-unknown-id', 'bad-unknown-type', 'bad-unknown-tag', 'bad-unknown-tag-uid', 'bad-animation', 'bad-plugin-record-type', 'bad-plugin-record-value', 'inline-record-values', 'bad-index', 'bad-position', 'missing-positions', 'wrong-position-type', 'hierarchy-cycle', 'missing-parent', 'singular-matrix', 'future-required-type', 'bad-version', 'bad-flags', 'duplicate-address', 'truncated-header', 'truncated-payload', 'oversized-header'];
      diagnostics.rejections = [];
      for (const variant of rejected) {
        const input = await make(variant); let message = null;
        await timed('Reject ' + variant + ' before scene replacement', 3000, async () => { try { await call('scene.open', {name: variant + '.hash', base64: input.base64}); } catch (error) { message = error.message; } });
        check(variant + ' rejects rather than reporting partial success', !!message);
        equal(variant + ' preserves every current object', (await state()).objects, before);
        equal(variant + ' preserves previous successful import diagnostics', await call('diagnostics.import'), priorReport);
        diagnostics.rejections.push({variant, error: message});
        await page.evaluate(() => { const canvas = document.querySelector('#frame-engine-canvas'); delete canvas.dataset.operationError; delete canvas.dataset.operationStack; });
      }
      const afterGeometry = await call('diagnostics.mesh', {id: ids.mesh, geometry: true});
      equal('All rejection cases preserve canonical GPU positions', afterGeometry.positionsSHA256, beforeGeometry.positionsSHA256);
      equal('All rejection cases preserve canonical GPU indices', afterGeometry.indicesSHA256, beforeGeometry.indicesSHA256);
      await call('edit.history', {action: 'undo'});
      check('Rejected files do not create history entries', !(await state()).objects.some(n => n.hash === marker.hash));
    });

    await runCase('Plugin installation cannot reactivate remapped opaque references', async () => {
      lateInstalled = true;
      const late = await context.newPage(); observe(late); let lateScoped = false;
      try {
        await late.goto(parent.url()); await ready(late);
        diagnostics.lateHardware = await attachGPU(late); lateScoped = true;
        checkHardware('Late-plugin context uses hardware WebGPU', diagnostics.lateHardware);
        const available = await callOn(late, 'app.describe');
        check('Both formerly unavailable object types are now installed', Object.hasOwn(available.objects, missingType) && Object.hasOwn(available.objects, missingMeshType));
        check('Formerly unavailable tag kind is now installed', (await callOn(late, 'tag.list')).some(tag => tag.kind === missingTag));
        const opened = await timed('Open unresolved file with newly installed plugins', 6000, () => callOn(late, 'scene.open', {name: 'unresolved-installed.hash', base64: remappedSave.base64}));
        const group = opened.objects.find(n => n.hash === copiedHashes.group), mesh = opened.objects.find(n => n.hash === copiedHashes.mesh);
        check('Persisted unresolved flags keep group/mesh shells inactive after installation', group?.type === 'group' && mesh?.type === 'mesh' && !Object.hasOwn(group.params, 'Value'));
        check('Persisted unresolved flag keeps the now-installed tag inactive', !group.tags.some(tag => tag.kind === missingTag));
        const report = await callOn(late, 'diagnostics.import');
        check('Now-installed unresolved descriptors are still diagnosed', report.unavailablePlugins.some(p => p.hash === copiedHashes.group) && report.unavailablePlugins.some(p => p.hash === copiedHashes.mesh));
        const lateSaved = await callOn(late, 'scene.export', {includeData: true}), lateDecoded = await late.evaluate(decodeInPage, lateSaved.base64), owner = lateDecoded.objects.find(n => n.hash === copiedHashes.group);
        equal('New plugin availability cannot alter opaque authored parameters', owner.authoring.plugin, fixture.expected.groupAuthoring.plugin);
        check('New plugin availability cannot clear unresolved-reference flag', owner.authoring.pluginReferencesUnresolved === true);
        equal('New tag availability cannot reinterpret opaque tag payload', owner.authoring.tags[0].params, fixture.expected.groupAuthoring.tags[0].params);
        check('New tag availability retains the opaque poses field and unresolved flag', owner.authoring.tags[0].poses === 'future-shape' && owner.authoring.tags[0].referencesUnresolved === true);
        assertRecords('Late installation', owner.pluginRecords, [copiedHashes.mesh, copiedHashes.external]);
        diagnostics.lateGPU = await finishGPU(late); lateScoped = false;
        check('Late-plugin context has no GPU validation, uncaptured, loss or replacement error', gpuOK(diagnostics.lateGPU), diagnostics.lateGPU);
      } finally { if (lateScoped) await finishGPU(late).catch(() => {}); await late.close(); }
    });

    diagnostics.frames = await timed('Bounded imported-scene frame measurement', 3000, () => call('diagnostics.frame', {frames: 3}));
    check('Imported scene has measured bounded CPU and GPU frame times', diagnostics.frames.frames.length === 3 && diagnostics.frames.frames.every(f => Number.isFinite(f.cpuMs) && Number.isFinite(f.gpuMs) && f.cpuMs < 100 && f.gpuMs < 100), diagnostics.frames);
    diagnostics.gpu = await finishGPU(page); scoped = false;
    check('No unexpected JavaScript, console, GPU validation, device loss or replacement errors', !errors.length && !consoleErrors.length && gpuOK(diagnostics.gpu), {errors, consoleErrors, gpu: diagnostics.gpu});
    check('No unexpected operation diagnostic remains', !(await page.locator('#frame-engine-canvas').getAttribute('data-operation-error')));
    result = {pass: true, browserVerified: true, gpuVerified: true};
  } catch (error) {
    if (currentCase) currentCase.error = error.message;
    result = {pass: false, browserVerified: false, gpuVerified: false, error: error.stack || String(error)};
  } finally {
    if (scoped) { try { diagnostics.gpu = await finishGPU(page); } catch (error) { diagnostics.gpuCaptureError = error.message; } }
    await context.close();
  }
  const sourcesAfter = await sourceHashes();
  Object.assign(result, {indexSHA256: sources['index.html'], sources, sourcesAfter, checks, cases, timings, diagnostics, errors, consoleErrors});
  if (!same(sources, sourcesAfter)) { result.pass = false; result.browserVerified = false; result.gpuVerified = false; result.error = (result.error || '') + '\nBest-effort HASH test sources changed during the run'; }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sources = await sourceHashes(); let session, result;
  try {
    session = await launch({headless: process.argv.includes('--headless')});
    await ready(session.page);
    result = await hashBestEffortBrowserChecks(session.page);
  } catch (error) {
    result = {pass: false, browserVerified: false, gpuVerified: false, indexSHA256: sources['index.html'], checks: [], cases: [], timings: [], error: error.stack || String(error)};
  } finally { await session?.close(); }
  result.sources = sources; result.sourcesAfter = await sourceHashes();
  if (!same(result.sources, result.sourcesAfter)) { result.pass = false; result.browserVerified = false; result.gpuVerified = false; result.error = (result.error || '') + '\nBest-effort HASH test sources changed during the run'; }
  await mkdir(new URL('./results/', import.meta.url), {recursive: true});
  await writeFile(new URL('./results/hash-best-effort-browser.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
}
