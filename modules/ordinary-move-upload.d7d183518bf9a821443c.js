import {rigidGpuBufferUsage} from "./gpu-island-preview.dc9be973a4cfd7c146a1.js";

const installed = new WeakSet();

// Historical reconstruction inputs remain unchanged. The ordinary Move layer
// installs this on the actual runtime pool and its same-module usage registry.
export function installOrdinaryMoveUpload(Type, {usageForData = rigidGpuBufferUsage} = {}) {
  if (installed.has(Type)) return Type;
  const borrow = Type.prototype.borrow, dispose = Type.prototype.dispose;
  Type.prototype.borrow = function(data, usage, label, minBytes = 4) {
    const size = Math.max(minBytes, 4, Math.ceil(data.byteLength / 4) * 4);
    const key = `${usageForData(data, usage)}:${size}`;
    if (this.ordinaryUploads?.get(data)?.has(key)) throw new DOMException('GPU source upload is not published', 'InvalidStateError');
    return borrow.call(this, data, usage, label, minBytes);
  };
  Type.prototype.borrowAsync = async function(data, usage, label = 'Frame staged buffer', {
    isCurrent = () => true, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), sliceBytes = 262144, minBytes = 4
  } = {}) {
    if (this.disposed) throw Error('GPU pool disposed');
    if (!ArrayBuffer.isView(data) || data instanceof DataView) throw Error('Typed source view required');
    if (!Number.isSafeInteger(sliceBytes) || sliceBytes < 4) throw Error('Positive bounded GPU upload slice required');
    usage = usageForData(data, usage);
    const byteLength = data.byteLength, size = Math.max(minBytes, 4, Math.ceil(byteLength / 4) * 4), key = `${usage}:${size}`;
    if (size > this.device.limits.maxBufferSize || ((usage & GPUBufferUsage.STORAGE) && size > this.device.limits.maxStorageBufferBindingSize)) throw Error(`${label}: buffer limit; explicit batching required`);
    const existing = this.entries.get(data)?.get(key);
    if (existing) {
      if (!isCurrent()) throw new DOMException('GPU upload owner changed', 'AbortError');
      existing.refs++;
      return existing;
    }
    const shared = this.ordinaryUploads?.get(data)?.get(key);
    if (shared) {
      await shared.promise;
      if (!isCurrent()) throw new DOMException('GPU upload owner changed', 'AbortError');
      return this.borrow(data, usage, label, minBytes);
    }
    this.ordinaryUploads ??= new Map();
    let variants = this.ordinaryUploads.get(data);
    if (!variants) this.ordinaryUploads.set(data, variants = new Map());
    const upload = {buffer: null, destroyed: false, promise: null};
    variants.set(key, upload);
    upload.promise = (async () => {
      const check = () => {
        if (this.disposed || data.byteLength !== byteLength || !isCurrent()) throw new DOMException('GPU upload owner changed', 'AbortError');
      };
      let published = false;
      try {
        check();
        upload.buffer = this.device.createBuffer({label, size, usage, mappedAtCreation: true});
        const target = new Uint8Array(upload.buffer.getMappedRange()), source = new Uint8Array(data.buffer, data.byteOffset, byteLength);
        for (let offset = 0; offset < byteLength; offset += sliceBytes) {
          check(); target.set(source.subarray(offset, Math.min(offset + sliceBytes, byteLength)), offset); await yieldTask();
        }
        check(); upload.buffer.unmap();
        let rows = this.entries.get(data);
        if (!rows) this.entries.set(data, rows = new Map());
        const row = {pool: this, buffer: upload.buffer, data, usage, size, key, refs: 1, freed: false};
        rows.set(key, row); this.bytes += size; published = true;
        return row;
      } finally {
        if (!published && upload.buffer && !upload.destroyed) {upload.buffer.destroy(); upload.destroyed = true;}
        variants.delete(key); if (!variants.size) this.ordinaryUploads.delete(data);
      }
    })();
    return upload.promise;
  };
  Type.prototype.dispose = function() {
    for (const variants of this.ordinaryUploads?.values() || []) for (const upload of variants.values()) {
      if (upload.buffer && !upload.destroyed) {upload.buffer.destroy(); upload.destroyed = true;}
    }
    return dispose.call(this);
  };
  installed.add(Type);
  return Type;
}
