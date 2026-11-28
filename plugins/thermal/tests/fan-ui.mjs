import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activate, FAN_CREATION_FRAME, PROBE_CREATION_FRAME, nativeFanMetadata} from '../plugin.js';

const core = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));

async function makeFixture() {
  let seq = 0, operations = [], attributesFn = null, editorHooks = null, viewportReg = null;
  const nodes = [], locals = new Map();
  const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const unpack = p => [p[0],p[1],p[2],0, p[3],p[4],p[5],0, p[6],p[7],p[8],0, p[9],p[10],p[11],1];
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c=0;c<4;c++) for (let r=0;r<4;r++) for (let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k]; return o; };
  const inv = m => {
    const sx2 = m[0]*m[0]+m[1]*m[1]+m[2]*m[2], sy2 = m[4]*m[4]+m[5]*m[5]+m[6]*m[6], sz2 = m[8]*m[8]+m[9]*m[9]+m[10]*m[10];
    const o = [m[0]/sx2, m[4]/sy2, m[8]/sz2, 0, m[1]/sx2, m[5]/sy2, m[9]/sz2, 0, m[2]/sx2, m[6]/sy2, m[10]/sz2, 0, 0,0,0,1];
    o[12] = -(o[0]*m[12]+o[4]*m[13]+o[8]*m[14]); o[13] = -(o[1]*m[12]+o[5]*m[13]+o[9]*m[14]); o[14] = -(o[2]*m[12]+o[6]*m[13]+o[10]*m[14]);
    return o;
  };
  const world = hash => {
    const n = nodes.find(x => x.nativeHash === hash);
    if (!n) return I();
    const loc = locals.get(hash) || I();
    const p = n.parent ? nodes.find(x => x.id === n.parent) : null;
    return p ? mul(world(p.nativeHash), loc) : loc;
  };
  const defs = Object.fromEntries(manifest.objects.map(o => [o.type, o.fields]));
  const doc = {
    get nodes() { return nodes; },
    world, local: h => locals.get(h) || I(),
    transaction(fn) { fn(); },
    create(type, parentHash = null, name = type) {
      const hash = (++seq).toString(16).padStart(32, '0');
      const parent = parentHash ? nodes.find(x => x.nativeHash === parentHash)?.id || null : null;
      const params = Object.fromEntries(Object.entries(defs[type]).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      const n = {id: 'n' + seq, nativeHash: hash, type, parent, name, enabled: true, visible: true, params, tags: []};
      editorHooks?.created?.(n);
      locals.set(hash, n.creationFrame ? unpack(n.creationFrame) : I());
      delete n.creationFrame;
      nodes.push(n);
      return n;
    },
    select() {}
  };
  const context = {
    version: 1, device: null, document: doc, math: {I, mul, inv},
    operations: {register: ops => operations = ops},
    attributes: {register: fn => attributesFn = fn},
    editor: {register: h => editorHooks = h, selectOwner: async () => {}},
    viewport: {register: async v => viewportReg = v},
    requestAttributes() {}, requestDraw() {}
  };
  await activate(context);
  const owner = doc.create('thermal', null, 'Thermal');
  const command = (id, args = {}, hash = owner.nativeHash) => operations.find(o => o.id === id).run(hash, args);
  return {context, doc, locals, owner, command, attributes: h => attributesFn(h), viewport: viewportReg};
}

test('Fan and Probe hide owner controls; Pressure aliases native Shutoff pressure with realistic defaults', async () => {
  const f = await makeFixture();
  const fan = await f.command('create-fan');
  const probe = await f.command('create-probe');
  assert.deepEqual(f.attributes(fan.hash).hiddenFields, ['Thermal', 'Direction']);
  assert.deepEqual(f.attributes(probe.hash).hiddenFields, ['Thermal']);
  assert.deepEqual(f.attributes(fan.hash).labels, {'Shutoff pressure': 'Pressure'});
  assert.equal(f.attributes(fan.hash).units['Shutoff pressure'], 'Pa');
  const fanNode = f.doc.nodes.find(n => n.nativeHash === fan.hash);
  assert.equal(fanNode.params.Thermal, f.owner.nativeHash);
  assert.equal(fanNode.params['Shutoff pressure'], 25);
  assert.equal(fanNode.params['Free flow'], 0.005);
  assert.deepEqual(Array.from(f.locals.get(fan.hash)).filter((_, i) => i % 4 !== 3), Array.from(FAN_CREATION_FRAME));
  assert.deepEqual(Array.from(f.locals.get(probe.hash)).filter((_, i) => i % 4 !== 3), Array.from(PROBE_CREATION_FRAME));
});

test('Reverse direction and arbitrary rotated Fan remain solver-eligible', async () => {
  const f = await makeFixture();
  const fan = await f.command('create-fan');
  const n = f.doc.nodes.find(x => x.nativeHash === fan.hash);
  n.params.Direction = 'Reverse';
  n.params['Shutoff pressure'] = 17;
  const meta = nativeFanMetadata(f.context, n);
  assert.deepEqual(meta.directionLocal, [-1, 0, 0]);
  assert.equal(meta.mapping.solverEligible, true);
  assert.deepEqual(meta.normalizedWorldAxis, [-1, 0, 0]);
});

test('Plugin helper hit geometry never captures native pointer, wheel or context events', async () => {
  const a = core.indexOf('    function drawPluginHits('), b = core.indexOf('    function pluginSurfaceStyle(', a), body = core.slice(a, b);
  assert.match(body, /path\.style\.pointerEvents='none'/);
  assert.doesNotMatch(body, /onclick|addEventListener|stopPropagation|preventDefault/);
  const plugin = await readFile(new URL('../plugin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(plugin, /addEventListener|interceptsPointer|contextMenu|pointerdown|wheel/);
});
