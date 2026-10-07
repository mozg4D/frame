/** One low-priority worker, one current topology job. No frame/camera state enters it. */
import {buildTopologyWork, connectedMaskWork, drainCooperatively, topologyTransfer} from './topology-islands.mjs';
export function installTopologyWorker(port) {
  let active = null, cache = null;
  const send = (data, transfer = []) => port.postMessage(data, transfer);
  port.onmessage = async ({data: m}) => {
    if (m.type === 'cancel') { if (active?.id === m.id) active.controller.abort(); return; }
    if (m.type === 'clear') { active?.controller.abort(); cache = null; return; }
    if (!['build', 'connected'].includes(m.type)) return;
    active?.controller.abort(); const job = {id: m.id, controller: new AbortController()}; active = job;
    try {
      if (m.type === 'build') {
        const value = await drainCooperatively(buildTopologyWork(m.input), {signal: job.controller.signal, sliceMs: 3});
        if (active !== job) return;
        cache = {key: m.key, topology: value};
        // Return labels once. Main owns them thereafter; no hidden second copy in this worker.
        send({type: 'built', id: m.id, key: m.key, result: value}, topologyTransfer(value)); cache = null;
      } else {
        if (!m.topology) throw Error('Transferred topology is required for standalone connected query');
        const result = await drainCooperatively(connectedMaskWork(m.topology, m.domain, m.seeds), {signal: job.controller.signal});
        if (active === job) send({type: 'connected', id: m.id, result}, [result.ids.buffer, result.components.buffer]);
      }
    } catch (e) { send({type: e.name === 'AbortError' ? 'cancelled' : 'error', id: m.id, name: e.name, message: e.message}); }
    finally { if (active === job) active = null; }
  };
  return () => { active?.controller.abort(); cache = null; port.onmessage = null; };
}
if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) installTopologyWorker(self);
