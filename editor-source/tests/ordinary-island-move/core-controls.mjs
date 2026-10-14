import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {OrdinaryMoveStore, ordinarySelectedIDs, numericGeometry} from '../../../native-source/ordinary-move-core.mjs';
import * as THREE from '../../../modules/frame-three-core.9edde002b066a9a05676.js';

const require = createRequire(import.meta.url);
const ts = require(process.env.FRAME_TYPESCRIPT || 'typescript');
const root = new URL('../../../', import.meta.url);
const bytes = fs.readFileSync(new URL('modules/editor.b46b7edb7b8fab6c0f1e.js', root));
assert.equal(createHash('sha256').update(bytes).digest('hex'), 'b46b7edb7b8fab6c0f1e17e4c9d82608c7dc0c9ad7a63fc9ae495e2868ee9f28');
const source = bytes.toString('utf8'), ast = ts.createSourceFile('r247.js', source, 99, true, 1);
const frozen = name => {
  const f = ast.statements.findLast(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert(f, 'Frozen r247 function ' + name);
  return f.getText(ast);
};

function geometry(snapshot) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(snapshot.positions.slice(), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(snapshot.normals.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(snapshot.indices.slice(), 1));
  g.groups = (snapshot.groups || []).map(q => ({...q}));
  g.userData = {...snapshot.userData};
  if (snapshot.drawRange) g.setDrawRange(snapshot.drawRange.start, snapshot.drawRange.count);
  return g;
}

function oracle(snapshot, input, world, delta) {
  const h = 'public-fixture', mesh = new THREE.Mesh(geometry(snapshot));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(world);
  mesh.updateMatrixWorld(true);
  const entry = {vertices: new Set(input.vertices || []), edges: new Set(input.edges || []), faces: new Set(input.faces || [])};
  const ctx = vm.createContext({THREE2: THREE, CREASE_COS: Math.cos(46 * Math.PI / 180),
    polySelection: {items: new Map([[h, entry]])}, pickMeshes: new Map([[h, mesh]]), meshToHash: new WeakMap([[mesh, h]]),
    vertexTools: {soft: {active: false, weights: new Map()}}, polyExactEdgeVertices: null,
    vertexGroupCache: new WeakMap(), vertexGroupOfCache: new WeakMap(), logicalEdgeCache: new WeakMap(),
    frameRigidSelectedIDs: () => null, framePolygonDragSelectedIDs: () => null, frameCurrentNativeEdgeCM: () => null,
    frameRigidApplyDelta: () => false, frameMorphInterceptPoly: () => false, frameMorphModelChanged: () => {},
    polygonShadingAllowed: () => true, packedGeometryAttribute: a => a.array, markPolygonCreaseGeometry: () => {},
    replaceEditedGeometry: (m, g) => {m.geometry = g;}, remapSoftAfterTopology: () => {},
    refreshWireOverlay: () => {}, rebuildPolySelection: () => {}, updateSoftPreview: () => {},
    frameContourOrigins: {get: () => null, bind: () => {}}, polyPointOverlays: new Map(),
    assignMeshMat: () => {}, framePolygonAttributeArray: a => a.array
  });
  for (const name of ['polyEdgeKey', 'logicalVertexGroups', 'logicalEdges', 'polySelectedVertexIds',
    'preparePolygonDragTopology', 'capturePolySelection', 'capturePolyLogicalSelection', 'restorePolyLogicalSelection',
    'framePolygonHash', 'framePolygonWeldBits', 'framePolygonNormalWorkspace', 'frameFastPolygonDragNormals',
    'updatePolygonDragNormals', 'applyPolyDelta', 'polygonCreaseData', 'normalizeCreaseTopology', 'rebuildCreaseRender']) vm.runInContext(frozen(name), ctx);
  const captured = ctx.capturePolySelection();
  ctx.applyPolyDelta(delta, captured);
  const logical = ctx.capturePolyLogicalSelection();
  ctx.rebuildCreaseRender(mesh, false);
  const built = {positions: mesh.geometry.attributes.position.array, normals: mesh.geometry.attributes.normal.array, indices: mesh.geometry.index.array};
  ctx.restorePolyLogicalSelection(logical);
  const s = ctx.polySelection.items.get(h) || {vertices: [], edges: [], faces: []};
  return {positions: built.positions, normals: built.normals, indices: built.indices,
    groups: mesh.geometry.groups, drawRange: mesh.geometry.drawRange, userData: mesh.geometry.userData,
    selection: {vertices: Array.from(s.vertices), edges: Array.from(s.edges), faces: Array.from(s.faces)}};
}

const wordBytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const sameGeometry = (a, b) => {
  for (const name of ['positions', 'normals', 'indices']) assert.deepEqual(wordBytes(a[name]), wordBytes(b[name]), name + ' exact words');
};
function fixture(offset = 0) {
  const positions = Float32Array.from([offset, 0, 0, offset + .04, 0, 0, offset, .03, 0,
    offset + .04, 0, 0, offset + .04, .03, 0, offset, .03, 0,
    offset + .2, 0, .02, offset + .24, 0, .02, offset + .2, .03, .02]);
  const normals = new Float32Array(positions.length);
  for (let id = 0; id < positions.length / 3; id++) normals[id * 3 + 2] = 1;
  return {positions, normals, indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8])};
}

const rows = [];
function test(name, run) {run(); rows.push({name, pass: true});}
for (const offset of [0, -2]) for (const rotated of [false, true]) for (const domain of ['vertex', 'edge', 'face']) {
  test(`frozen Stock ${domain}, offset=${offset}, rotated owner=${rotated}`, () => {
    const input = domain === 'vertex' ? {vertices: [5, 2, 4, 3, 1, 0]} : domain === 'edge' ? {edges: ['0:1', '1:2', '0:2', '3:4', '4:5', '3:5']} : {faces: [0, 1]};
    const snapshot = fixture(offset), world = new THREE.Matrix4().compose(new THREE.Vector3(17, -3, 8),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotated ? .2 : 0, rotated ? -.4 : 0, .1)), new THREE.Vector3(1000, 700, 1300));
    const delta = new THREE.Matrix4().makeTranslation(.37, -.11, .09), inverse = world.clone().invert();
    const expected = oracle(snapshot, input, world, delta), store = new OrdinaryMoveStore(snapshot);
    const begin = store.begin(input, {world: world.elements, inverse: inverse.elements});
    const got = store.commit({...begin, revision: 0, delta: delta.elements});
    sameGeometry(got.snapshot, expected);
    assert.deepEqual(Array.from(got.selection.vertices), expected.selection.vertices);
    assert.deepEqual(got.selection.edges, expected.selection.edges);
    assert.deepEqual(Array.from(got.selection.faces), expected.selection.faces);
    const undo = store.history('undo'); sameGeometry(undo.snapshot, snapshot);
    const redo = store.history('redo'); sameGeometry(redo.snapshot, got.snapshot);
  });
}

test('worker history owns immutable caller snapshots and publishing buffers', () => {
  const input = fixture(), store = new OrdinaryMoveStore(input), before = store.snapshot.positions[0];
  input.positions[0] = 99;
  assert.equal(store.snapshot.positions[0], before);
  const packet = numericGeometry(store.snapshot); packet.positions.fill(42);
  assert.equal(store.snapshot.positions[0], before);
});
test('stale owner, base, and gesture revisions are rejected without authoring', () => {
  const store = new OrdinaryMoveStore(fixture()), world = new THREE.Matrix4(), snapshot = store.snapshot;
  assert.throws(() => store.begin({vertices: [0]}, {ownerVersion: 99, world: world.elements, inverse: world.elements}), {name: 'AbortError'});
  const begin = store.begin({vertices: [0]}, {world: world.elements, inverse: world.elements});
  store.pose({...begin, revision: 1, delta: world.elements});
  assert.throws(() => store.pose({...begin, revision: 1, delta: world.elements}), {name: 'AbortError'});
  assert.equal(store.snapshot, snapshot);
  assert.equal(store.cancel({gesture: begin.gesture + 1}), false);
  assert.equal(store.cancel(begin), true);
  assert.equal(store.snapshot, snapshot);
});
test('explicit vertex selection does not acquire near/unused coordinate aliases', () => {
  const snapshot = fixture();
  assert.deepEqual(Array.from(ordinarySelectedIDs(snapshot, {vertices: [1]})), [1]);
  assert.deepEqual(Array.from(ordinarySelectedIDs(snapshot, {edges: ['0:1']})), [0, 1, 3]);
});
test('partial-face selection is recognized and still has an exact worker fallback', () => {
  const snapshot = fixture(), input = {vertices: [0]}, world = new THREE.Matrix4(), delta = new THREE.Matrix4().makeTranslation(.01, .02, 0);
  const store = new OrdinaryMoveStore(snapshot), prepared = store.prepare(input);
  assert.equal(prepared.prepared.wholeFaces, false);
  const begin = store.begin(input, {world: world.elements, inverse: world.elements});
  sameGeometry(store.commit({...begin, revision: 0, delta: delta.elements}).snapshot, oracle(snapshot, input, world, delta));
});
test('retired worker ownership cannot publish or reuse history', () => {
  const store = new OrdinaryMoveStore(fixture()); store.retire();
  assert.throws(() => store.prepare({vertices: [0]}), {name: 'AbortError'});
  assert.throws(() => store.history('undo'), {name: 'AbortError'});
});
test('computed-but-cancelled result cannot advance geometry or history', () => {
  const store = new OrdinaryMoveStore(fixture()), identity = new THREE.Matrix4(), before = store.snapshot;
  const begin = store.begin({vertices: [0, 1, 2, 3, 4, 5]}, {world: identity.elements, inverse: identity.elements});
  const computed = store.compute({...begin, revision: 0, delta: new THREE.Matrix4().makeTranslation(.01, 0, 0).elements});
  assert.equal(store.version, 0); assert.equal(store.snapshot, before); assert.equal(store.undo.length, 0);
  assert(store.cancel(begin));
  assert.throws(() => store.accept(computed), {name: 'AbortError'});
  assert.equal(store.version, 0); assert.equal(store.snapshot, before);
});
test('new pose revision retires the old computed result', () => {
  const store = new OrdinaryMoveStore(fixture()), identity = new THREE.Matrix4();
  const begin = store.begin({faces: [0, 1]}, {world: identity.elements, inverse: identity.elements});
  const old = store.compute({...begin, revision: 0, delta: identity.elements});
  store.pose({...begin, revision: 1, delta: identity.elements});
  assert.throws(() => store.accept(old), {name: 'AbortError'});
  assert.equal(store.version, 0);
});
test('second island action uses preceding exact Stock and Undo remaps current singleton', () => {
  const input = fixture(), store = new OrdinaryMoveStore(input), identity = new THREE.Matrix4();
  let begin = store.begin({faces: [0, 1]}, {world: identity.elements, inverse: identity.elements});
  store.commit({...begin, revision: 0, delta: new THREE.Matrix4().makeTranslation(.015, 0, 0).elements});
  const afterA = store.snapshot, deltaB = new THREE.Matrix4().makeTranslation(0, .01, 0);
  const expectedB = oracle(afterA, {faces: [2]}, identity, deltaB);
  begin = store.begin({faces: [2]}, {world: identity.elements, inverse: identity.elements});
  store.commit({...begin, revision: 0, delta: deltaB.elements}); sameGeometry(store.snapshot, expectedB);
  const current = {vertices: [store.snapshot.indices[6]]};
  const undoB = store.history('undo', {}, current); sameGeometry(undoB.snapshot, afterA);
  assert(undoB.selection.vertices.length > 0);
  const undoA = store.history('undo', {}, undoB.selection); sameGeometry(undoA.snapshot, input);
  for (const id of undoA.selection.vertices) assert.equal(undoA.snapshot.positions[id * 3], input.positions[6 * 3]);
});
test('invalid live selection rejects history atomically', () => {
  const store = new OrdinaryMoveStore(fixture()), identity = new THREE.Matrix4();
  const begin = store.begin({faces: [0, 1]}, {world: identity.elements, inverse: identity.elements});
  store.commit({...begin, revision: 0, delta: identity.elements});
  const before = store.snapshot, version = store.version;
  assert.throws(() => store.history('undo', {}, {vertices: [999999]}));
  assert.equal(store.snapshot, before); assert.equal(store.version, version); assert.equal(store.undo.length, 1);
});

test('actual pointerup preserves degenerate faces, material groups and drawRange; Undo keeps Uint16', () => {
  const input = fixture(); input.indices = Uint16Array.from(input.indices);
  input.positions.set(input.positions.subarray(0, 3), 3);
  input.groups = [{start: 0, count: 6, materialIndex: 3}, {start: 6, count: 3, materialIndex: 8}];
  input.drawRange = {start: 3, count: 6}; input.userData = {label: 'public', splineBVH: 'old', _polygonDragCorners: true};
  const store = new OrdinaryMoveStore(input), identity = new THREE.Matrix4(), selected = {faces: [2]};
  const begin = store.begin(selected, {world: identity.elements, inverse: identity.elements});
  const delta = new THREE.Matrix4().makeTranslation(.01, 0, 0), expected = oracle(input, selected, identity, delta);
  const got = store.commit({...begin, revision: 0, delta: delta.elements});
  sameGeometry(got.snapshot, expected);
  assert.equal(got.snapshot.indices.length, input.indices.length);
  assert.deepEqual(got.snapshot.groups, expected.groups); assert.deepEqual(got.snapshot.drawRange, expected.drawRange);
  assert.deepEqual(got.snapshot.userData, JSON.parse(JSON.stringify(expected.userData)));
  const undo = store.history('undo'); assert(undo.snapshot.indices instanceof Uint16Array); sameGeometry(undo.snapshot, input);
});
console.log(JSON.stringify({pass: true, cases: rows.length, rows, privateGeometryIncluded: false,
  scope: 'Worker-core exact Stock/frozen r247 source oracle; no browser integration or UI performance acceptance'}));
