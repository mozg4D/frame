/** One WebGPU device shared by the viewport and camera integrator.
 * A consumer releases its lease, never another consumer's device or buffers.
 * No WebGL fallback and no retry loop after loss; a new request starts a new generation.
 */
import {FrameGpuDevice} from './gpu-resources.mjs';

export class FrameDeviceBroker {
  constructor({gpu = () => globalThis.navigator?.gpu, powerPreference = 'high-performance', onLoss = () => {}} = {}) {
    this.gpuProvider = gpu; this.powerPreference = powerPreference; this.onLoss = onLoss;
    this.current = null; this.opening = null; this.generation = 0; this.disposed = false;
    this.leases = new Set();
  }
  async _open() {
    if (this.disposed) throw Error('Frame GPU broker has been disposed');
    if (this.current?.state === 'ready') return this.current;
    if (this.opening) return this.opening;
    const generation = ++this.generation;
    const operation = (async () => {
      const gpu = this.gpuProvider();
      if (!gpu) throw Error('Frame requires WebGPU in a secure context. There is no WebGL fallback.');
      const adapter = await gpu.requestAdapter({powerPreference: this.powerPreference});
      if (!adapter) throw Error('No WebGPU adapter is available');
      const limits = adapter.limits;
      // The existing camera integrator uses eight storage bindings. Request the
      // supported size once so it need not open a second, larger device later.
      if (limits.maxStorageBuffersPerShaderStage < 8) throw Error('Frame requires eight storage buffers per shader stage');
      const storage = Math.min(limits.maxStorageBufferBindingSize, 1024 ** 3);
      const buffer = Math.min(limits.maxBufferSize, 1024 ** 3);
      const features = adapter.features.has('timestamp-query') ? ['timestamp-query'] : [];
      const device = await adapter.requestDevice({requiredFeatures: features, requiredLimits: {
        maxStorageBufferBindingSize: Math.min(storage, buffer), maxBufferSize: buffer,
        maxStorageBuffersPerShaderStage: 8,
      }});
      if (this.disposed || generation !== this.generation) { device.destroy(); throw new DOMException('GPU initialization superseded', 'AbortError'); }
      const owner = new FrameGpuDevice(device, {ownsDevice: true}); owner.adapter = adapter; owner.generation = generation;
      owner.onLoss(info => {
        if (this.current === owner) this.current = null;
        for (const lease of this.leases) if (lease.owner === owner) lease.lost = true;
        try { this.onLoss(info, generation); } catch (error) { console.error('Frame device loss notification', error); }
      });
      this.current = owner; return owner;
    })();
    this.opening = operation;
    try { return await operation; } finally { if (this.opening === operation) this.opening = null; }
  }
  async acquire(kind = 'viewport') {
    const owner = await this._open();
    if (this.disposed || owner.state !== 'ready') throw new DOMException('GPU unavailable before lease', 'AbortError');
    const lease = {owner, device: owner.device, adapter: owner.adapter, kind, generation: owner.generation, released: false, lost: false};
    lease.isCurrent = () => !lease.released && !lease.lost && !this.disposed && this.current === owner && owner.state === 'ready';
    lease.release = () => { if (lease.released) return; lease.released = true; this.leases.delete(lease); };
    this.leases.add(lease); return lease;
  }
  diagnostics() {
    return {backend: 'WebGPU', generation: this.generation, state: this.disposed ? 'disposed' : this.current?.state ?? (this.opening ? 'initializing' : 'idle'),
      leases: [...this.leases].map(x => ({kind: x.kind, generation: x.generation, lost: x.lost})),
      sharedBufferBytes: this.current?.pool.bytes ?? 0};
  }
  async dispose() {
    if (this.disposed) return; this.disposed = true; ++this.generation;
    const owner = this.current; this.current = null;
    for (const lease of [...this.leases]) lease.release();
    await this.opening?.catch(() => {});
    if (owner) { await owner.device.queue.onSubmittedWorkDone().catch(() => {}); owner.dispose(); }
  }
}
export const frameGpuBroker = new FrameDeviceBroker();
