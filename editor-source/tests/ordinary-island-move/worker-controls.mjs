import {Worker} from 'node:worker_threads';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const worker = new Worker(new URL('../../../native-source/ordinary-move-worker.mjs', import.meta.url));
const pending = new Map(); let serial = 0;
worker.on('message', q => {
  const row = pending.get(q.id); if (!row) return;
  pending.delete(q.id); clearTimeout(row.timer);
  q.kind === 'error' ? row.reject(Object.assign(Error(q.error.message), {name: q.error.name})) : row.resolve(q);
});
worker.on('error', error => {for (const row of pending.values()) row.reject(error);});
const request = (kind, data = {}, transfer = []) => new Promise((resolve, reject) => {
  const id = ++serial, timer = setTimeout(() => {pending.delete(id); reject(Error('Worker request timeout'));}, 20000);
  pending.set(id, {resolve, reject, timer}); worker.postMessage({id, kind, ...data}, transfer);
});
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(faces) {
  const positions = new Float32Array(faces * 9), normals = new Float32Array(positions.length), indices = new Uint32Array(faces * 3);
  for (let face = 0; face < faces; face++) {
    const at = face * 9, x = face * 2;
    positions.set([x,0,0,x+1,0,0,x,1,0], at);
    normals[at+2] = normals[at+5] = normals[at+8] = 1;
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return {positions, normals, indices};
}
async function upload(input, ownerVersion) {
  await request('upload-start', {ownerVersion, lengths: Object.fromEntries(Object.entries(input).map(([k,a]) => [k,a.length]))});
  for (const [field, a] of Object.entries(input)) for (let start = 0; start < a.length; start += 4096) {
    const chunk = a.slice(start, start + 4096), length = chunk.length;
    await request('upload-chunk', {ownerVersion, field, start, chunk}, [chunk.buffer]);
    assert.equal(chunk.byteLength, 0, 'Only owned communication chunk is detached');
    assert(length > 0); assert(a.byteLength > 0, 'Authoring fixture retained');
  }
  return request('upload-finish', {ownerVersion});
}
const rows = [];
async function test(name, run) {await run(); rows.push({name, pass: true});}
try {
  await test('ordered chunk ownership rejects an out-of-order upload', async () => {
    await request('upload-start', {ownerVersion: 7, lengths: {positions: 9, normals: 9, indices: 3}});
    await assert.rejects(request('upload-chunk', {ownerVersion: 7, field: 'positions', start: 3, chunk: new Float32Array(3)}));
    await assert.rejects(request('upload-finish', {ownerVersion: 7}));
    await request('retire', {ownerVersion: 7});
  });
  const input = fixture(10000); await upload(input, 8);
  await test('pinned descriptor survives more than sixteen later reads and stale render revision is rejected',async()=>{
    const context={domain:'vertex',space:'world',world:identity,inverse:identity,ownerFrame:identity};
    const first=(await request('prepare-read',{ownerVersion:8,renderVersion:0,selectionRevision:1,selection:{vertices:[0]},context})).result;
    await request('descriptor-claim',{ownerVersion:8,token:first.token});
    for(let i=0;i<20;i++){const q=(await request('prepare-read',{ownerVersion:8,renderVersion:0,selectionRevision:i+2,selection:{vertices:[3]},context})).result;await request('descriptor-release',{ownerVersion:8,token:q.token});}
    const preview=(await request('preview-begin',{ownerVersion:8,token:first.token,renderVersion:0})).result.preview;await request('preview-cancel',{ownerVersion:8,preview});
    await request('descriptor-release',{ownerVersion:8,token:first.token});await request('descriptor-release',{ownerVersion:8,token:first.token});
    await assert.rejects(request('prepare-read',{ownerVersion:8,renderVersion:99,selection:{vertices:[0]},context}),{name:'AbortError'});
  });
  await test('prepare response transfers render packets without transferring authored source', async () => {
    const q = await request('prepare', {baseVersion: 0, ownerVersion: 8, selection: {faces: [0,1]}});
    assert(q.result.wholeFaces); assert.equal(q.result.display.vertexCount, 6);
    assert.equal(input.positions.byteLength, 360000);
  });
  let computed;
  await test('exact Stock runs on another thread while the parent heartbeat continues', async () => {
    const begin = (await request('begin', {baseVersion: 0, ownerVersion: 8, selection: {faces: [0,1]}, world: identity, inverse: identity})).result;
    let beats = 0, gap = 0, last = performance.now();
    const timer = setInterval(() => {const t=performance.now();gap=Math.max(gap,t-last);last=t;beats++;}, 10);
    const started = performance.now(), delta = identity.slice(); delta[12] = .125;
    try {
      const running = request('compute', {...begin, revision: 0, delta});
      const readStarted = performance.now();
      const read = (await request('read', {baseVersion: 0, ownerVersion: 8, ids: [0, 6]})).result;
      assert(read.computing, 'Independent read was serviced while exact computation still owned its thread');
      assert.equal(read.positions[0], 0); assert.equal(read.version, 0);
      rows.push({name: 'independent owned read during exact computation', pass: true, readRoundTripMs: performance.now() - readStarted});
      computed = (await running).result;
    } finally {clearInterval(timer);}
    assert(beats >= 3, 'Parent received heartbeats during worker computation');
    assert.equal(computed.version, 1); assert.equal(computed.geometry.positions[0], .125);
    rows.push({name: 'parent heartbeat evidence', pass: true, beats, maxGapMs: gap, workerRoundTripMs: performance.now()-started});
  });
  await test('computed response is not accepted until the owner acknowledges it', async () => {
    await assert.rejects(request('accept', {...computed, token: 'wrong-token'}), {name: 'AbortError'});
    const q = await request('accept', {token: computed.token, gesture: computed.gesture, revision: computed.revision, baseVersion: 0, ownerVersion: 8});
    assert.equal(q.result.version, 1);
    await assert.rejects(request('begin', {baseVersion: 0, ownerVersion: 8, selection: {faces: [0]}, world: identity, inverse: identity}), {name: 'AbortError'});
  });
  await test('prepared history can fail publication or cancel without changing the canonical revision',async()=>{
    await assert.rejects(request('history-prepare',{direction:'undo',baseVersion:1,ownerVersion:8,operationToken:'other-operation',selection:{vertices:[0]}}),{name:'AbortError'});
    const q=(await request('history-prepare',{direction:'undo',baseVersion:1,ownerVersion:8,operationToken:computed.token,selection:{vertices:[0]}})).result;
    assert.equal(q.version,2);assert.equal(q.geometry.positions[0],0);
    const read=(await request('read',{baseVersion:1,ownerVersion:8,ids:[0]})).result;assert.equal(read.version,1);assert.equal(read.positions[0],.125);
    await request('history-cancel',{ownerVersion:8,token:q.token});
    const after=(await request('read',{baseVersion:1,ownerVersion:8,ids:[0]})).result;assert.equal(after.version,1);assert.equal(after.positions[0],.125);
  });
  await test('Undo and Redo keep current other-island selection after changed raw layout', async () => {
    const singleton = {vertices: [computed.geometry.indices[6]]};
    const undo = (await request('history', {direction: 'undo', baseVersion: 1, ownerVersion: 8, selection: singleton})).result;
    assert.equal(undo.version, 2); assert.equal(undo.geometry.positions[0], 0); assert(undo.selection.vertices.length);
    const redo = (await request('history', {direction: 'redo', baseVersion: 2, ownerVersion: 8, selection: undo.selection})).result;
    assert.equal(redo.geometry.positions[0], .125); assert(redo.selection.vertices.length);
  });
  await test('retired owner cannot reuse old worker results', async () => {
    await request('retire', {ownerVersion: 8});
    await assert.rejects(request('prepare', {baseVersion: 3, ownerVersion: 8, selection: {faces: [0]}}), {name: 'AbortError'});
  });
  console.log(JSON.stringify({pass: true, cases: rows.length, rows, privateGeometryIncluded: false,
    scope: 'Real Node worker transport, chunk ownership, exact Stock, parent responsiveness and history; not browser/GPU acceptance'}));
} finally {await worker.terminate();}
