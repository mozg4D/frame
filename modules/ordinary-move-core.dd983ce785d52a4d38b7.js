import {orderedAffinePositions, stockCreaseReference} from "./affine-corner-worker.d91f5ae84673b0868284.js";
import {sameCheckpointGeometry} from "./ordinary-move-history.b78f5eaa319c090a5606.js";

const CREASE_COS = Math.cos(46 * Math.PI / 180);
const abort = message => new DOMException(message, 'AbortError');
const logicalKey = (p, id) => {
  const k = id * 3;
  return `${Math.round(p[k] * 1e5)},${Math.round(p[k + 1] * 1e5)},${Math.round(p[k + 2] * 1e5)}`;
};
const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const logicalEdge = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

function matrix(value, name) {
  if (!value || value.length !== 16 || !Array.from(value).every(Number.isFinite)) {
    throw Error(`Finite ${name} matrix required`);
  }
  return Float64Array.from(value);
}

function validateGeometry({positions, normals, indices}) {
  if (!(positions instanceof Float32Array) || positions.length % 3 ||
      !(normals instanceof Float32Array) || normals.length !== positions.length ||
      !(indices instanceof Uint32Array || indices instanceof Uint16Array) || indices.length % 3) {
    throw Error('Indexed Float32 position/normal geometry required');
  }
  for (const value of positions) if (!Number.isFinite(value)) throw Error('Nonfinite position');
  for (const value of normals) if (!Number.isFinite(value)) throw Error('Nonfinite normal');
  for (const id of indices) if (id >= positions.length / 3) throw Error('Index out of range');
}

function selection(value = {}) {
  const vertices = new Set(value.vertices || []), faces = new Set(value.faces || []);
  const edges = new Set();
  for (const edge of value.edges || []) {
    const pair = typeof edge === 'string' ? edge.split(':').map(Number) : edge;
    if (!pair || pair.length !== 2 || !pair.every(Number.isSafeInteger)) throw Error('Raw edge pair required');
    edges.add(edgeKey(pair[0], pair[1]));
  }
  return {vertices, edges, faces};
}

function validateSelection(s, vertexCount, faceCount) {
  for (const id of s.vertices) if (!Number.isSafeInteger(id) || id < 0 || id >= vertexCount) throw Error('Vertex out of range');
  for (const id of s.faces) if (!Number.isSafeInteger(id) || id < 0 || id >= faceCount) throw Error('Face out of range');
  for (const edge of s.edges) for (const id of edge.split(':').map(Number)) {
    if (id < 0 || id >= vertexCount) throw Error('Edge endpoint out of range');
  }
}

// These are the ordinary editing rules, not the bounded affine certificate.
// Vertex IDs remain explicit; edge and polygon endpoints expand their 1e-5 groups.
export function ordinarySelectedIDs(snapshot, input) {
  const s = selection(input), p = snapshot.positions, ix = snapshot.indices;
  validateSelection(s, p.length / 3, ix.length / 3);
  const ids = new Set(s.vertices);
  if (!s.edges.size && !s.faces.size) return ids;
  const groups = new Map();
  for (let id = 0; id < p.length / 3; id++) {
    const key = logicalKey(p, id);
    let group = groups.get(key);
    if (!group) groups.set(key, group = []);
    group.push(id);
  }
  const expanded = new Set();
  const take = id => {
    const key = logicalKey(p, id);
    if (expanded.has(key)) return;
    expanded.add(key);
    for (const raw of groups.get(key)) ids.add(raw);
  };
  for (const edge of s.edges) for (const id of edge.split(':').map(Number)) take(id);
  for (const face of s.faces) for (let c = 0; c < 3; c++) take(ix[face * 3 + c]);
  return ids;
}

function cornerSelection(snapshot, input) {
  const s = selection(input), ix = snapshot.indices, p = snapshot.positions;
  validateSelection(s, p.length / 3, ix.length / 3);
  const positions = new Float32Array(ix.length * 3), normals = new Float32Array(positions.length);
  const vertices = new Set(), edges = new Set(), cornersOf = new Map();
  for (let at = 0; at < ix.length; at++) {
    const id = ix[at], source = id * 3;
    positions.set(p.subarray(source, source + 3), at * 3);
    normals.set(snapshot.normals.subarray(source, source + 3), at * 3);
    if (s.vertices.has(id)) {
      let corners = cornersOf.get(id);
      if (!corners) cornersOf.set(id, corners = []);
      corners.push(at);
    }
  }
  for (const id of s.vertices) for (const corner of cornersOf.get(id) || []) vertices.add(corner);
  if (s.edges.size) for (let face = 0; face < ix.length; face += 3) for (let c = 0; c < 3; c++) {
    const a = face + c, b = face + (c + 1) % 3;
    if (s.edges.has(edgeKey(ix[a], ix[b]))) edges.add(edgeKey(a, b));
  }
  const indices = Uint32Array.from({length: ix.length}, (_, i) => i);
  const expanded = {positions, normals, indices};
  const remapped = {vertices, edges, faces: new Set(s.faces)};
  const ids = ordinarySelectedIDs(expanded, remapped);
  const faceIDs = [], faceSlots = new Int32Array(ix.length / 3);
  let wholeFaces = true;
  for (let face = 0; face < ix.length / 3; face++) {
    let inside = 0;
    for (let c = 0; c < 3; c++) inside += ids.has(face * 3 + c) ? 1 : 0;
    if (inside && inside !== 3) wholeFaces = false;
    if (inside === 3) { faceSlots[face] = faceIDs.length + 1; faceIDs.push(face); }
  }
  return {expanded, selection: remapped, ids, faceIDs: Uint32Array.from(faceIDs), faceSlots, wholeFaces};
}

function captureLogical(p, s) {
  const vertices = new Set(Array.from(s.vertices, id => logicalKey(p, id))), edges = new Set();
  for (const edge of s.edges) {
    const [a, b] = edge.split(':').map(Number);
    edges.add(logicalEdge(logicalKey(p, a), logicalKey(p, b)));
  }
  return {vertices, edges, faces: new Set(s.faces)};
}

function restoreLogical(snapshot, logical, keptFaces) {
  const p = snapshot.positions, ix = snapshot.indices, vertices = [], edges = [];
  const groups = new Map();
  for (let id = 0; id < p.length / 3; id++) {
    const key = logicalKey(p, id);
    let group = groups.get(key);
    if (!group) groups.set(key, group = []);
    group.push(id);
  }
  for (const [key, group] of groups) if (logical.vertices.has(key)) for (const id of group) vertices.push(id);
  const seen = new Set(), logicalEdges = new Map();
  if (logical.edges.size) for (let face = 0; face < ix.length; face += 3) for (let c = 0; c < 3; c++) {
    const a = ix[face + c], b = ix[face + (c + 1) % 3], raw = edgeKey(a, b);
    if (seen.has(raw)) continue;
    seen.add(raw);
    const ka = logicalKey(p, a), kb = logicalKey(p, b);
    if (ka === kb) continue;
    const key = logicalEdge(ka, kb);
    let group = logicalEdges.get(key);
    if (!group) logicalEdges.set(key, group = []);
    group.push(raw);
  }
  for (const [key, group] of logicalEdges) if (logical.edges.has(key)) for (const raw of group) edges.push(raw);
  const faces = [];
  for (let next = 0; next < keptFaces.length; next++) if (logical.faces.has(keptFaces[next])) faces.push(next);
  return {vertices: Uint32Array.from(vertices), edges, faces: Uint32Array.from(faces)};
}

export function numericGeometry(snapshot) {
  const n = snapshot.positions.length / 3, positions = snapshot.positions.slice(), extras = new Float32Array(n * 9);
  for (let id = 0; id < n; id++) {
    extras.set(snapshot.normals.subarray(id * 3, id * 3 + 3), id * 9);
    extras[id * 9 + 5] = extras[id * 9 + 6] = extras[id * 9 + 7] = extras[id * 9 + 8] = 1;
  }
  return {positions, extras, indices: snapshot.indices.slice(), vertexCount: n, hasNormals: true, hasUV: false, hasColors: false};
}

// Face/corner lineage survives Stock's changed raw layout. History must remap the
// current selection; the selection captured by the old Move is not its owner.
export function remapMoveSelection(before, after, input) {
  const s = selection(input);
  validateSelection(s, before.positions.length / 3, before.indices.length / 3);
  const targetFaces = new Map();
  for (let f = 0; f < after.originFaces.length; f++) targetFaces.set(after.originFaces[f], f);
  const logical = {vertices: new Set(), edges: new Set(), faces: new Set()};
  for (let f = 0; f < before.indices.length / 3; f++) {
    const next = targetFaces.get(before.originFaces[f]);
    if (next === undefined) continue;
    if (s.faces.has(f)) logical.faces.add(next);
    for (let c = 0; c < 3; c++) {
      const at = f * 3 + c, id = before.indices[at], to = after.indices[next * 3 + c];
      if (s.vertices.has(id)) logical.vertices.add(logicalKey(after.positions, to));
      const j = (c + 1) % 3, other = before.indices[f * 3 + j];
      if (s.edges.has(edgeKey(id, other))) {
        const toOther = after.indices[next * 3 + j];
        logical.edges.add(logicalEdge(logicalKey(after.positions, to), logicalKey(after.positions, toOther)));
      }
    }
  }
  return restoreLogical(after, logical, Uint32Array.from({length: after.indices.length / 3}, (_, i) => i));
}

function displaySelection(prepared) {
  const corners = prepared.faceIDs.length * 3, positions = new Float32Array(corners * 3), extras = new Float32Array(corners * 9);
  let out = 0;
  for (const face of prepared.faceIDs) for (let c = 0; c < 3; c++, out++) {
    const from = (face * 3 + c) * 3;
    positions.set(prepared.expanded.positions.subarray(from, from + 3), out * 3);
    extras.set(prepared.expanded.normals.subarray(from, from + 3), out * 9);
    extras[out * 9 + 5] = extras[out * 9 + 6] = extras[out * 9 + 7] = extras[out * 9 + 8] = 1;
  }
  return {positions, extras, indices: null, ids: Uint32Array.from({length: corners}, (_, i) => i), vertexCount: corners, hasNormals: true, hasUV: false, hasColors: false};
}

export class OrdinaryMoveStore {
  constructor(input, {takeOwnership = false, ownerVersion = 1, historyLimit = 64} = {}) {
    validateGeometry(input);
    if (!Number.isSafeInteger(ownerVersion) || !Number.isSafeInteger(historyLimit) || historyLimit < 1) throw Error('Owner/history limits required');
    const positions = takeOwnership ? input.positions : input.positions.slice();
    const normals = takeOwnership ? input.normals : input.normals.slice();
    const indices = takeOwnership ? input.indices : input.indices.slice();
    this.snapshot = {positions, normals, indices, groups: (input.groups || []).map(q => ({...q})), drawRange: {...(input.drawRange || {start: 0, count: Infinity})}, userData: {...input.userData}, originFaces: Uint32Array.from({length: indices.length / 3}, (_, i) => i)};
    this.ownerVersion = ownerVersion;
    this.version = 0;
    this.gestureSerial = 0;
    this.active = null;
    this.undo = [];
    this.redo = [];
    this.historyLimit = historyLimit;
    this.retired = false;
  }

  check({baseVersion = this.version, ownerVersion = this.ownerVersion} = {}) {
    if (this.retired || baseVersion !== this.version || ownerVersion !== this.ownerVersion) throw abort('Move owner/version changed');
  }

  prepare(input, context = {}) {
    this.check(context);
    const prepared = cornerSelection(this.snapshot, input);
    if (!prepared.ids.size) throw Error('Nonempty ordinary component selection required');
    const rawIDs = Uint32Array.from(ordinarySelectedIDs(this.snapshot, input)).sort();
    const rawMask = new Uint8Array(this.snapshot.positions.length / 3);
    for (const id of rawIDs) rawMask[id] = 1;
    return {prepared, display: displaySelection(prepared), faceSlots: prepared.faceSlots.slice(), rawIDs, rawMask,
      baseVersion: this.version, ownerVersion: this.ownerVersion};
  }

  begin(input, context = {}) {
    this.check(context);
    if (this.active || this.historyPrepared) throw abort('Move gesture/history already owns the worker basis');
    const prepared = cornerSelection(this.snapshot, input);
    if (!prepared.ids.size) throw Error('Nonempty ordinary component selection required');
    const gesture = ++this.gestureSerial;
    this.active = {gesture, baseVersion: this.version, ownerVersion: this.ownerVersion, prepared, beforeSelection: selection(input), world: matrix(context.world, 'world'), inverse: matrix(context.inverse, 'inverse'), revision: -1};
    return {gesture, baseVersion: this.version, ownerVersion: this.ownerVersion, wholeFaces: prepared.wholeFaces};
  }

  pose({gesture, revision, delta, baseVersion = this.version, ownerVersion = this.ownerVersion}) {
    this.check({baseVersion, ownerVersion});
    const active = this.active;
    if (!active || active.gesture !== gesture || !Number.isSafeInteger(revision) || revision <= active.revision) throw abort('Move gesture/revision changed');
    active.delta = matrix(delta, 'delta');
    active.revision = revision;
    return {gesture, revision, baseVersion, ownerVersion};
  }

  compute(request) {
    this.pose(request);
    const active = this.active, before = this.snapshot, {prepared} = active;
    const ids = Uint32Array.from(prepared.ids), source = new Float32Array(ids.length * 3);
    for (let k = 0; k < ids.length; k++) source.set(prepared.expanded.positions.subarray(ids[k] * 3, ids[k] * 3 + 3), k * 3);
    const values = orderedAffinePositions(source, active.world, active.delta, active.inverse);
    const positions = prepared.expanded.positions.slice();
    for (let k = 0; k < ids.length; k++) positions.set(values.subarray(k * 3, k * 3 + 3), ids[k] * 3);
    const logical = captureLogical(positions, prepared.selection);
    // Frozen r247 rebuildCreaseRender uses normalizeCreaseTopology's default
    // preserveFaces=true, including degenerate faces, groups and drawRange.
    const stock = stockCreaseReference(positions, prepared.expanded.indices, CREASE_COS, null, 1, false, true);
    const groups = before.groups.map(q => ({...q}));
    const userData = {...before.userData};
    for (const key of ['splineBVH', 'splineWire', 'splineWireSource', '_polygonDragCorners']) delete userData[key];
    if (!before.userData._polygonDragCorners && (before.positions.length / 3 !== before.indices.length || !before.indices.every((v, i) => v === i))) delete userData._faceSources;
    const after = {positions: stock.positions, normals: stock.normals, indices: stock.indices, groups, userData, drawRange: {...before.drawRange}, originFaces: Uint32Array.from(stock.keptFaces, f => before.originFaces[f])};
    const afterSelection = restoreLogical(after, logical, stock.keptFaces);
    const token = `${active.gesture}:${active.revision}`;
    active.pending = {token, before, after, beforeSelection: active.beforeSelection, afterSelection};
    return {token, baseVersion: active.baseVersion, version: active.baseVersion + 1, ownerVersion: this.ownerVersion,
      gesture: active.gesture, revision: active.revision, snapshot: after, selection: afterSelection, keptFaces: Uint32Array.from(stock.keptFaces)};
  }

  accept({token, gesture, revision, baseVersion = this.version, ownerVersion = this.ownerVersion, retainHistory = true}) {
    this.check({baseVersion, ownerVersion});
    const active = this.active, row = active?.pending;
    if (!row || row.token !== token || active.gesture !== gesture || active.revision !== revision) throw abort('Move result ownership changed');
    const {after} = row;
    this.snapshot = after;
    this.version++;
    this.active = null;
    if(retainHistory){this.undo.push(row);if (this.undo.length > this.historyLimit) this.undo.shift();}
    else this.undo.length=0;
    this.redo.length = 0;
    return {version: this.version, ownerVersion: this.ownerVersion, gesture, revision};
  }

  commit(request) {
    const computed = this.compute(request);
    this.accept(computed);
    return computed;
  }

  cancel({gesture, ownerVersion = this.ownerVersion}) {
    if (this.retired || ownerVersion !== this.ownerVersion || this.active?.gesture !== gesture) return false;
    this.active = null;
    return true;
  }

  history(direction, context = {}, currentSelection = null) {
    const prepared = this.prepareHistory(direction, context, currentSelection);
    if (!prepared) return null;
    this.acceptHistory(prepared);
    return prepared;
  }

  prepareHistory(direction, context = {}, currentSelection = null) {
    this.check(context);
    const from = direction === 'undo' ? this.undo : direction === 'redo' ? this.redo : null;
    if (!from) throw Error('Undo or redo required');
    const row = from.at(-1);
    if (!row) return null;
    if(context.operationToken && context.operationToken !== row.token) throw abort('History operation owner changed');
    const before = this.snapshot, after = direction === 'undo' ? row.before : row.after;
    const remapped = currentSelection ? remapMoveSelection(before, after, currentSelection) : null;
    const token = `history:${this.version}:${direction}:${row.token}`;
    this.historyPrepared = {token, direction, row, before, after, baseVersion: this.version, ownerVersion: this.ownerVersion};
    return {token, baseVersion:this.version, version: this.version+1, ownerVersion: this.ownerVersion, snapshot: after,
      selection: remapped,
      operationSelection: direction === 'undo' ? row.beforeSelection : row.afterSelection};
  }

  acceptHistory({token,baseVersion,ownerVersion}) {
    this.check({baseVersion,ownerVersion});
    const q=this.historyPrepared,from=q?.direction==='undo'?this.undo:this.redo;
    if(!q || q.token!==token || this.snapshot!==q.before || q.kind!=='checkpoint'&&from.at(-1)!==q.row)throw abort('Prepared history changed');
    if(q.kind==='checkpoint')this.undo.length=this.redo.length=0;else{from.pop();(q.direction==='undo'?this.redo:this.undo).push(q.row);}this.snapshot=q.after;this.version++;this.active=null;this.historyPrepared=null;
    return {version:this.version,ownerVersion:this.ownerVersion};
  }

  cancelHistory({token}) {if(this.historyPrepared?.token!==token)return false;this.historyPrepared=null;return true;}

  prepareCheckpoint(expected,after,{operationID,direction,...context}) {
    this.check(context);if(this.active||this.historyPrepared)throw abort('Move gesture/history already owns the worker basis');
    if(!operationID||!['undo','redo'].includes(direction))throw Error('Owned checkpoint operation required');
    validateGeometry(expected);validateGeometry(after);
    for(const q of [expected,after])if(!(q.originFaces instanceof Uint32Array)||q.originFaces.length!==q.indices.length/3)throw Error('Checkpoint face lineage required');
    if(!sameCheckpointGeometry(expected,this.snapshot))throw abort('History checkpoint does not match current canonical geometry');
    const token=`checkpoint:${this.version}:${direction}:${operationID}`;
    this.historyPrepared={kind:'checkpoint',token,direction,before:this.snapshot,after,remapBefore:expected,baseVersion:this.version,ownerVersion:this.ownerVersion};
    return{token,baseVersion:this.version,version:this.version+1,ownerVersion:this.ownerVersion,snapshot:after};
  }

  retire() {
    this.retired = true;
    this.ownerVersion++;
    this.active = this.snapshot = this.historyPrepared = null;
    this.undo.length = this.redo.length = 0;
  }
}
