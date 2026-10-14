import {OrdinaryMoveStore, numericGeometry} from './ordinary-move-core.mjs';
import {moveDerivedPacket} from './ordinary-move-kernels.mjs';
import {moveCheckpoint} from './ordinary-move-history.mjs';

export function computeMoveJob({snapshot, selection, request, world, inverse}) {
  const store = new OrdinaryMoveStore(snapshot, {takeOwnership: true, ownerVersion: request.ownerVersion});
  store.snapshot = snapshot;
  store.version = request.baseVersion;
  store.gestureSerial = request.gesture - 1;
  store.begin(selection, {...request, world, inverse});
  const computed = store.compute(request), numeric = numericGeometry(computed.snapshot);
  const geometry = {...computed.snapshot, positions: numeric.positions, normals: computed.snapshot.normals.slice(),
    indices: numeric.indices, originFaces: computed.snapshot.originFaces.slice()};
  return {computed, packet: {geometry, numeric, checkpoint:moveCheckpoint(computed.snapshot), derived: moveDerivedPacket(computed.snapshot)}};
}

function transferList(value) {
  const buffers = new Set();
  const visit = q => {if (ArrayBuffer.isView(q)) buffers.add(q.buffer); else if (q && typeof q === 'object') for (const v of Object.values(q)) visit(v);};
  visit(value); return [...buffers];
}
function install(port) {
  port.onmessage = ({data}) => {
    try {const result = computeMoveJob(data); port.postMessage({result}, transferList(result));}
    catch (e) {port.postMessage({error: {name: e.name, message: e.message}});}
  };
}
if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) install(self);
else if (typeof process !== 'undefined' && process.versions?.node) {
  const {parentPort} = await import('node:worker_threads');
  if (parentPort) {const port = {postMessage: (v, t) => parentPort.postMessage(v, t), onmessage: null}; parentPort.on('message', data => port.onmessage?.({data})); install(port);}
}
