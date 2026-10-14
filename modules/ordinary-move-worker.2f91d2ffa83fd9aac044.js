import {OrdinaryMoveStore, numericGeometry, ordinarySelectedIDs, remapMoveSelection} from "./ordinary-move-core.dd983ce785d52a4d38b7.js";
import {orderedAffinePositions} from "./affine-corner-worker.d91f5ae84673b0868284.js";
import {moveReadPacket, moveDerivedPacket} from "./ordinary-move-kernels.06b12922940fdd76742a.js";
import {buildTopologyWork} from "./topology-islands.58b33b3eb8d5488469a5.js";
import {connectedRawWork,createYieldQueue} from "./connected-selection.65bdcdb810ce4d9cf77f.js";
import {vertexPickWork,vertexPickPage,vertexPickGroup} from "./ordinary-move-picking.4d392a9aa1df2ba9c309.js";
import {moveCheckpoint,checkpointFields,checkpointSnapshot} from "./ordinary-move-history.b78f5eaa319c090a5606.js";
import {selectionFields,selectionChunkWords,selectionFromWire,selectionToWire} from "./ordinary-move-selection.76a7c0c8f044c78d6ca6.js";

const abort = message => new DOMException(message, 'AbortError');
const types = {positions: Float32Array, normals: Float32Array, indices: Uint32Array};
const ComputeWorker = typeof Worker !== 'undefined' ? Worker : (await import('node:worker_threads')).Worker;

function transfers(value) {
  const buffers = new Set();
  const visit = item => {
    if (ArrayBuffer.isView(item)) buffers.add(item.buffer);
    else if (item && typeof item === 'object') for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return Array.from(buffers);
}

function publishedGeometry(snapshot) {
  const numeric = numericGeometry(snapshot);
  return {geometry: {positions: numeric.positions, normals: snapshot.normals.slice(), indices: numeric.indices,
    groups: snapshot.groups.map(q => ({...q})), drawRange: {...snapshot.drawRange}, userData: {...snapshot.userData}, originFaces: snapshot.originFaces.slice()}, numeric};
}

export function installOrdinaryMoveWorker(port) {
  let store = null, upload = null, historyUpload=null, renderSnapshot = null, renderVersion=0, descriptorSerial = 0, previewSerial=0;
  const previews = new Map(), descriptors = new Map(),selectionUploads=new Map();
  const vertexPicks=new Map(),pickTasks=createYieldQueue();let pickSerial=0;
  const pickRow=m=>{store.check({ownerVersion:m.ownerVersion});const q=vertexPicks.get(m.pickToken);if(!q?.ready||q.store!==store||q.renderVersion!==renderVersion||m.renderVersion!==renderVersion)throw abort('Vertex picker revision changed');return q.result;};
  const takeSelection=m=>{if(m.selectionToken===undefined)return m.selection;const q=selectionUploads.get(m.selectionToken);selectionUploads.delete(m.selectionToken);if(!q?.ready||q.renderVersion!==renderVersion||m.renderVersion!==renderVersion)throw abort('Selection upload revision changed');return selectionFromWire(q.arrays);};
  const drain = work => {let step; do {step = work.next();} while (!step.done); return step.value;};
  const rendered = () => {
    if (!previews.size) return renderSnapshot;
    const positions = renderSnapshot.positions.slice();
    for (const row of previews.values()) {
      if (!row.delta) continue;
      const source = new Float32Array(row.ids.length * 3);
      for (let k = 0; k < row.ids.length; k++) source.set(positions.subarray(row.ids[k]*3,row.ids[k]*3+3), k*3);
      const values = orderedAffinePositions(source, row.world, row.delta, row.inverse);
      for (let k = 0; k < row.ids.length; k++) positions.set(values.subarray(k*3,k*3+3),row.ids[k]*3);
    }
    return {...renderSnapshot, positions};
  };
  const jobs = new Set();
  const retireJobs = () => {for (const job of jobs) {job.worker.terminate(); port.postMessage({id: job.id, kind: 'error', error: {name: 'AbortError', message: 'Move computation retired'}});} jobs.clear();};
  const send = (id, kind, result) => port.postMessage({id, kind, result}, transfers(result));
  port.onmessage = ({data: m}) => {
    try {
      if (!Number.isSafeInteger(m?.id) || typeof m.kind !== 'string') throw Error('Worker request identity required');
      if (m.kind === 'upload-start') {
        if (upload) throw abort('Another upload owns the worker');
        const arrays = {}, uploadTypes = {...types, indices: m.indexType === 'Uint16Array' ? Uint16Array : Uint32Array};
        for (const [name, Type] of Object.entries(uploadTypes)) {
          const count = m.lengths?.[name];
          if (!Number.isSafeInteger(count) || count < 0 || count > 0x3ffffff) throw Error('Upload length outside supported bounds');
          arrays[name] = new Type(count);
        }
        upload = {ownerVersion: m.ownerVersion, arrays, types: uploadTypes, groups: m.groups || [], drawRange: m.drawRange, userData: m.userData, cursors: {positions: 0, normals: 0, indices: 0}};
        send(m.id, 'upload-started', {ownerVersion: upload.ownerVersion});
        return;
      }
      if (m.kind === 'upload-chunk') {
        if (!upload || m.ownerVersion !== upload.ownerVersion) throw abort('Upload owner changed');
        const Type = upload.types[m.field], destination = upload.arrays[m.field], chunk = m.chunk;
        if (!Type || !(chunk instanceof Type) || m.start !== upload.cursors[m.field] || m.start + chunk.length > destination.length) throw Error('Ordered typed upload chunk required');
        destination.set(chunk, m.start);
        upload.cursors[m.field] += chunk.length;
        send(m.id, 'upload-chunked', {field: m.field, end: upload.cursors[m.field]});
        return;
      }
      if (m.kind === 'upload-finish') {
        if (!upload || m.ownerVersion !== upload.ownerVersion) throw abort('Upload owner changed');
        for (const name of Object.keys(types)) if (upload.cursors[name] !== upload.arrays[name].length) throw Error('Incomplete geometry upload');
        store?.retire();
        store = new OrdinaryMoveStore({...upload.arrays, groups: upload.groups, drawRange: upload.drawRange, userData: upload.userData}, {takeOwnership: true, ownerVersion: upload.ownerVersion});
        upload = null;
        renderSnapshot = store.snapshot;renderVersion=store.version; previews.clear(); descriptors.clear();selectionUploads.clear();
        send(m.id, 'uploaded', {version: store.version, ownerVersion: store.ownerVersion});
        return;
      }
      if (m.kind === 'retire') {
        retireJobs();
        historyUpload=null;selectionUploads.clear();vertexPicks.clear();
        if (upload && upload.ownerVersion === m.ownerVersion) upload = null;
        if (store && store.ownerVersion === m.ownerVersion) {store.retire(); store = null;}
        send(m.id, 'retired', {});
        return;
      }
      if (!store) throw abort('Owned worker geometry required');
      if(m.kind==='selection-start'){
        store.check({ownerVersion:m.ownerVersion});if(!Number.isSafeInteger(m.selectionToken)||m.selectionToken<1||m.renderVersion!==renderVersion||selectionUploads.has(m.selectionToken))throw abort('Selection upload owner changed');const arrays={},cursors={};for(const field of selectionFields){const length=m.lengths?.[field];if(!Number.isSafeInteger(length)||length<0||length>0x3ffffff||field==='edges'&&length%2)throw Error('Bounded typed selection length required');arrays[field]=new Uint32Array(length);cursors[field]=0;}selectionUploads.set(m.selectionToken,{arrays,cursors,renderVersion,ready:false});send(m.id,'selection-started',{});
      }else if(m.kind==='selection-chunk'){
        store.check({ownerVersion:m.ownerVersion});const q=selectionUploads.get(m.selectionToken),destination=q?.arrays[m.field];if(!q||q.ready||q.renderVersion!==renderVersion||m.renderVersion!==renderVersion)throw abort('Selection upload revision changed');if(!(m.chunk instanceof Uint32Array)||!destination||m.chunk.length>selectionChunkWords||m.start!==q.cursors[m.field]||m.start+m.chunk.length>destination.length)throw Error('Ordered bounded selection chunk required');destination.set(m.chunk,m.start);q.cursors[m.field]+=m.chunk.length;send(m.id,'selection-chunked',{});
      }else if(m.kind==='selection-finish'){
        store.check({ownerVersion:m.ownerVersion});const q=selectionUploads.get(m.selectionToken);if(!q||q.renderVersion!==renderVersion||m.renderVersion!==renderVersion)throw abort('Selection upload revision changed');for(const field of selectionFields)if(q.cursors[field]!==q.arrays[field].length)throw Error('Incomplete selection upload');q.ready=true;send(m.id,'selection-ready',{});
      }else if(m.kind==='vertex-pick-start'){
        store.check({ownerVersion:m.ownerVersion});if(m.renderVersion!==renderVersion||vertexPicks.size>=2)throw abort('Vertex picker owner changed');
        const pickToken=++pickSerial,row={store,renderVersion,ready:false};vertexPicks.set(pickToken,row);
        (async()=>{const work=vertexPickWork(rendered(),m.context);let step;do{if(vertexPicks.get(pickToken)!==row||row.store!==store||row.renderVersion!==renderVersion)throw abort('Vertex picker source changed');step=work.next();if(!step.done)await pickTasks.yield();}while(!step.done);row.result=step.value;row.ready=true;send(m.id,'vertex-pick',{pickToken,...vertexPickPage(row.result,0)});})().catch(error=>{vertexPicks.delete(pickToken);port.postMessage({id:m.id,kind:'error',error:{name:error.name,message:error.message}});});
      }else if(m.kind==='vertex-pick-next'){send(m.id,'vertex-pick',vertexPickPage(pickRow(m),m.start));
      }else if(m.kind==='vertex-pick-group'){send(m.id,'vertex-pick-group',vertexPickGroup(pickRow(m),m.representative,m.start));
      }else if(m.kind==='vertex-pick-cancel'){store.check({ownerVersion:m.ownerVersion});vertexPicks.delete(m.pickToken);send(m.id,'vertex-pick-cancelled',{});
      }else if(m.kind==='selection-cancel'){
        store.check({ownerVersion:m.ownerVersion});selectionUploads.delete(m.selectionToken);send(m.id,'selection-cancelled',{});
      }else if(m.kind==='checkpoint-start'){
        store.check(m);if(historyUpload||store.active||store.historyPrepared||jobs.size)throw abort('Another operation owns history upload');
        const snapshots={},constructors={Float32Array,Uint16Array,Uint32Array,Uint8Array};
        for(const role of ['expected','target']){const arrays={},cursors={};for(const key of checkpointFields){const shape=m[role]?.[key],Type=constructors[shape?.type];if(!Type||!Number.isSafeInteger(shape.length)||shape.length<0||shape.length>0x3ffffff)throw Error('Bounded typed checkpoint required');arrays[key]=new Type(shape.length);cursors[key]=0;}snapshots[role]={arrays,cursors};}
        historyUpload={...snapshots,operationID:m.operationID,direction:m.direction,baseVersion:m.baseVersion,ownerVersion:m.ownerVersion};send(m.id,'checkpoint-started',{});
      }else if(m.kind==='checkpoint-chunk'){
        store.check(m);const q=historyUpload;if(!q||q.operationID!==m.operationID||q.baseVersion!==store.version)throw abort('Checkpoint upload owner changed');
        const row=q[m.role],destination=row?.arrays[m.field],chunk=m.chunk;if(!destination||!(chunk instanceof destination.constructor)||m.start!==row.cursors[m.field]||chunk.length>65536||m.start+chunk.length>destination.length)throw Error('Ordered bounded checkpoint chunk required');
        destination.set(chunk,m.start);row.cursors[m.field]+=chunk.length;send(m.id,'checkpoint-chunked',{});
      }else if(m.kind==='checkpoint-finish'){
        store.check(m);const q=historyUpload;if(!q||q.operationID!==m.operationID||q.baseVersion!==store.version)throw abort('Checkpoint upload owner changed');
        for(const role of ['expected','target'])for(const key of checkpointFields)if(q[role].cursors[key]!==q[role].arrays[key].length)throw Error('Incomplete checkpoint upload');
        const result=store.prepareCheckpoint(checkpointSnapshot(q.expected.arrays),checkpointSnapshot(q.target.arrays),q);historyUpload=null;const{snapshot,...metadata}=result;
        send(m.id,'history',{...metadata,...publishedGeometry(snapshot),derived:moveDerivedPacket(snapshot)});
      }else if(m.kind==='checkpoint-cancel'){
        store.check({ownerVersion:m.ownerVersion});if(historyUpload?.operationID===m.operationID)historyUpload=null;send(m.id,'checkpoint-cancelled',{});
      }else if (m.kind === 'capture') {
        store.check(m); send(m.id, 'captured', {...publishedGeometry(store.snapshot), checkpoint:moveCheckpoint(store.snapshot), derived: moveDerivedPacket(store.snapshot)});
      } else if (m.kind === 'prepare-read') {
        store.check({ownerVersion: m.ownerVersion});
        if(m.renderVersion!==renderVersion)throw abort('Read render revision changed');
        const snapshot = rendered(), input = takeSelection(m);
        if (m.connected) {
          const topology = drain(buildTopologyWork({positions: snapshot.positions, indices: snapshot.indices},{packedTables:true}));
          const field = m.context.domain === 'vertex' ? 'vertices' : m.context.domain === 'edge' ? 'edges' : 'faces';
          input[field] = [...drain(connectedRawWork(topology,m.context.domain,input[field]||[]))];
        }
        const packet = moveReadPacket(snapshot,input,m.context), token = ++descriptorSerial;
        descriptors.set(token,{ids: packet.rawIDs.slice(), selection:input, selectionRevision:m.selectionRevision??0,world: m.context.world, inverse: m.context.inverse, renderVersion, references:1});
        send(m.id,'read-prepared',{...packet,token,selection:m.selectionToken===undefined?input:selectionToWire(input),renderVersion:m.renderVersion,selectionRevision:m.selectionRevision??0,ownerVersion:store.ownerVersion});
      } else if(m.kind==='descriptor-claim'||m.kind==='descriptor-release') {
        store.check({ownerVersion:m.ownerVersion});const descriptor=descriptors.get(m.token);if(!descriptor||descriptor.renderVersion!==renderVersion)throw abort('Read descriptor owner changed');
        if(m.kind==='descriptor-claim')descriptor.references++;else if(--descriptor.references===0)descriptors.delete(m.token);send(m.id,'descriptor-owned',{});
      } else if (m.kind === 'preview-begin') {
        store.check({ownerVersion:m.ownerVersion});const descriptor=descriptors.get(m.token);if(!descriptor)throw abort('Read selection descriptor retired');
        if(descriptor.renderVersion!==renderVersion||m.renderVersion!==renderVersion)throw abort('Display render revision changed');
        const preview=++previewSerial;previews.set(preview,{...descriptor,token:m.token});send(m.id,'preview-began',{preview});
      } else if (m.kind === 'preview-pose') {
        store.check({ownerVersion:m.ownerVersion});const row=previews.get(m.preview);if(!row)throw abort('Display gesture retired');
        row.delta=m.delta;send(m.id,'preview-posed',{});
      } else if (m.kind === 'preview-cancel') {
        store.check({ownerVersion:m.ownerVersion});const keys=[...previews.keys()],index=keys.indexOf(m.preview);if(index>=0)for(const key of keys.slice(index))previews.delete(key);
        send(m.id,'preview-cancelled',{});
      } else if (m.kind === 'publish-read') {
        store.check(m);
        const target=m.historyToken?store.historyPrepared?.token===m.historyToken?store.historyPrepared.after:null:store.snapshot;
        if(!target)throw abort('Prepared history target changed');
        const current = remapMoveSelection(m.historyToken&&store.historyPrepared?.remapBefore||renderSnapshot,target,takeSelection(m));
        send(m.id,'publish-read',{...moveReadPacket(target,current,m.context),selection:m.selectionToken===undefined?current:selectionToWire(current),version:store.version+(m.historyToken?1:0),ownerVersion:store.ownerVersion});
      } else if (m.kind === 'ack-render') {
        store.check(m); renderSnapshot=store.snapshot;renderVersion=store.version;previews.clear();descriptors.clear();selectionUploads.clear();vertexPicks.clear();send(m.id,'render-acknowledged',{version:store.version});
      } else if(m.kind==='history-accept') {
        const result=store.acceptHistory(m);renderSnapshot=store.snapshot;renderVersion=store.version;previews.clear();descriptors.clear();selectionUploads.clear();vertexPicks.clear();send(m.id,'history-accepted',result);
      } else if(m.kind==='history-cancel') {send(m.id,'history-cancelled',{cancelled:store.cancelHistory(m)});
      } else if (m.kind === 'read') {
        store.check(m);
        const ids = m.ids || [], positions = new Float32Array(ids.length * 3);
        for (let k = 0; k < ids.length; k++) {
          if (!Number.isSafeInteger(ids[k]) || ids[k] < 0 || ids[k] >= store.snapshot.positions.length / 3) throw Error('Read ID outside owned geometry');
          positions.set(store.snapshot.positions.subarray(ids[k] * 3, ids[k] * 3 + 3), k * 3);
        }
        send(m.id, 'read', {version: store.version, ownerVersion: store.ownerVersion, positions, computing: jobs.size > 0,selectionUploadCount:selectionUploads.size,vertexPickCount:vertexPicks.size});
      } else if (m.kind === 'prepare') {
        const q = store.prepare(m.selection, m);
        send(m.id, 'prepared', {baseVersion: q.baseVersion, ownerVersion: q.ownerVersion,
          wholeFaces: q.prepared.wholeFaces, faceIDs: q.prepared.faceIDs.slice(), faceSlots: q.faceSlots,
          rawIDs: q.rawIDs, rawMask: q.rawMask, display: q.display});
      } else if (m.kind === 'begin-descriptor') {store.check(m);if(historyUpload)throw abort('History upload owns the worker basis');const descriptor=descriptors.get(m.token),preview=previews.get(m.preview);if(!descriptor||preview?.token!==m.token||descriptor.renderVersion!==renderVersion||m.renderVersion!==renderVersion||m.selectionRevision!==descriptor.selectionRevision)throw abort('Pinned selection descriptor changed');send(m.id,'began',store.begin(remapMoveSelection(renderSnapshot,store.snapshot,descriptor.selection),{...m,world:descriptor.world,inverse:descriptor.inverse}));
      } else if (m.kind === 'begin') {if(historyUpload)throw abort('History upload owns the worker basis');send(m.id, 'began', store.begin(m.renderSelection ? remapMoveSelection(renderSnapshot,store.snapshot,m.selection) : m.selection, m));}
      else if (m.kind === 'pose') send(m.id, 'posed', store.pose(m));
      else if (m.kind === 'compute') {
        store.pose(m);
        const active = store.active, basis = store.snapshot, ownedStore = store;
        const worker = new ComputeWorker(new URL("./ordinary-move-compute.45cbb3a76d12de5a56cc.js", import.meta.url), {type: 'module'});
        const job = {worker, id: m.id}; jobs.add(job);
        const complete = data => {
          if (!jobs.delete(job)) return;
          worker.terminate();
          try {
            if (data.error) throw Object.assign(Error(data.error.message), {name: data.error.name});
            const {computed: q, packet} = data.result;
            if (store !== ownedStore || store.active !== active || store.snapshot !== basis || active.revision !== q.revision) throw abort('Computed Move owner changed');
            store.check(q);
            active.pending = {token: q.token, before: basis, after: q.snapshot, beforeSelection: active.beforeSelection,
              afterSelection: {vertices: q.selection.vertices.slice(), edges: q.selection.edges.slice(), faces: q.selection.faces.slice()}};
            const {snapshot, ...metadata} = q;
            send(m.id, 'computed', {...metadata, ...packet});
          } catch (error) {port.postMessage({id: m.id, kind: 'error', error: {name: error.name, message: error.message}});}
        };
        const failed = error => complete({error: {name: error.name, message: error.message}});
        if (worker.on) {worker.on('message', complete); worker.on('error', failed);}
        else {worker.onmessage = e => complete(e.data); worker.onerror = failed;}
        worker.postMessage({snapshot: basis, selection: active.beforeSelection, request: m, world: active.world, inverse: active.inverse});
      } else if (m.kind === 'accept') send(m.id, 'accepted', store.accept(m));
      else if (m.kind === 'cancel') {const cancelled = store.cancel(m); if (cancelled) retireJobs(); send(m.id, 'cancelled', {cancelled});}
      else if (m.kind === 'history'||m.kind==='history-prepare') {
        const current = m.renderSelection && m.selection ? remapMoveSelection(renderSnapshot,store.snapshot,m.selection) : m.selection;
        const q = m.kind==='history-prepare'?store.prepareHistory(m.direction,m,current):store.history(m.direction, m, current);
        if (!q) send(m.id, 'history', null);
        else {const {snapshot, operationSelection, ...metadata} = q; send(m.id, 'history', {...metadata, ...publishedGeometry(snapshot), derived: moveDerivedPacket(snapshot)});}
      } else throw Error('Unknown ordinary Move worker operation');
    } catch (error) {
      port.postMessage({id: m?.id, kind: 'error', error: {name: error.name, message: error.message}});
    }
  };
  return () => {retireJobs();selectionUploads.clear();vertexPicks.clear();pickTasks.dispose(); store?.retire(); store = upload = historyUpload = null; port.onmessage = null;};
}

if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  installOrdinaryMoveWorker(self);
} else if (typeof process !== 'undefined' && process.versions?.node) {
  const {parentPort} = await import('node:worker_threads');
  if (parentPort) {
    const port = {postMessage: (value, transfer) => parentPort.postMessage(value, transfer), onmessage: null};
    parentPort.on('message', data => port.onmessage?.({data}));
    installOrdinaryMoveWorker(port);
  }
}
