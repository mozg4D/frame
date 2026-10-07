/** Converts the cached topology result into Frame's existing selection contract.
 * The authored model is never transferred; edge keys stay numeric inside topology,
 * and are materialised as the existing ':' keys only at the editing boundary.
 */
import {connectedMaskWork, edgeIdFromRaw, drainCooperatively} from './topology-islands.mjs';
const abort = () => new DOMException('Connected source changed', 'AbortError');
export function* connectedRawWork(topology, domain, source, {batch = 2048} = {}) {
  if (!['vertex', 'edge', 'face'].includes(domain)) throw Error('Unknown component domain');
  const seeds = []; let count = 0;
  for (const raw of source) {
    if (domain === 'edge') {
      if (typeof raw === 'string') {
        const parts = raw.split(':');
        if (parts.length === 2) { const id = edgeIdFromRaw(topology, Number(parts[0]), Number(parts[1])); if (id >= 0) seeds.push(id); }
      }
    } else if (Number.isInteger(raw)) seeds.push(raw);
    if (++count % batch === 0) yield;
  }
  const connected = yield* connectedMaskWork(topology, domain, seeds, {batch});
  const output = new Set(); count = 0;
  for (const id of connected.ids) {
    output.add(domain === 'edge' ? topology.edges[id * 2] + ':' + topology.edges[id * 2 + 1] : id);
    if (++count % batch === 0) yield;
  }
  return output;
}
export async function expandConnectedRaw(cache, geometry, domain, source, {signal, isCurrent = () => true, yieldTask} = {}) {
  if (signal?.aborted || !isCurrent()) throw abort();
  // Cache ownership is independent of any one foreground query. Escape cancels
  // the query, not a topology build still useful to a later double-click.
  const build = cache.get(geometry);
  const ready = await abortable(build, signal);
  const current = () => ready.isCurrent() && isCurrent();
  if (!current()) throw abort();
  return drainCooperatively(connectedRawWork(ready.topology, domain, source), {signal, isCurrent: current, yieldTask});
}
export function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abort());
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(abort()); };
    const cleanup = () => signal.removeEventListener('abort', cancel);
    signal.addEventListener('abort', cancel, {once: true});
    Promise.resolve(promise).then(x => { cleanup(); resolve(x); }, e => { cleanup(); reject(e); });
  });
}
/** A task scheduler with no nested-timer 4 ms clamp; never an unbounded microtask chain. */
export function createYieldQueue() {
  let channel = null, timer = null, closed = false, pending = [];
  const tick = () => { timer = null; const jobs = pending; pending = []; for (const done of jobs) done(); };
  const closePorts = () => { const c = channel; channel = null; if (!c) return; c.port1.onmessage = null; try { c.port1.close(); } catch {} try { c.port2.close(); } catch {} };
  try { channel = new MessageChannel(); channel.port1.onmessage = tick; } catch { closePorts(); }
  return {
    yield() {
      if (closed) return Promise.reject(new DOMException('Task queue disposed', 'AbortError'));
      return new Promise(resolve => {
        pending.push(resolve); if (pending.length !== 1) return;
        if (channel) { try { channel.port2.postMessage(0); return; } catch { closePorts(); } }
        timer = setTimeout(tick, 0);
      });
    },
    dispose() { if (closed) return; closed = true; clearTimeout(timer); closePorts(); tick(); },
  };
}
