const OPERATION = Object.freeze({union: 0, subtract: 1, intersect: 2});

export class FrameBooleanRuntime {
  constructor(options = {}) {
    this.workerUrl = options.workerUrl || new URL('./boolean-worker.js?v=production-6-js-r2', import.meta.url);
    this.WorkerClass = options.WorkerClass || globalThis.Worker;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.jobsSubmitted = 0;
    this.jobsCompleted = 0;
    this.workersCreated = 0;
    this.workersTerminated = 0;
    this.wasmHeapBytes = 0;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    if (!this.WorkerClass) throw new Error('Boolean Worker is unavailable');
    const worker = new this.WorkerClass(this.workerUrl, {type: 'module', name: 'frame-boolean'});
    this.workersCreated++;
    worker.onmessage = event => {
      const message = event.data || {};
      const job = this.pending.get(message.id);
      if (!job) return;
      this.pending.delete(message.id);
      this.jobsCompleted++;
      if (Number.isFinite(message.wasmHeapBytes)) this.wasmHeapBytes = message.wasmHeapBytes;
      if (message.ok) job.resolve(message);
      else job.reject(new Error(message.error || 'Boolean worker failed'));
    };
    worker.onerror = event => {
      const error = new Error(event?.message || 'Boolean worker failed');
      for (const job of this.pending.values()) job.reject(error);
      this.pending.clear();
      worker.terminate?.();
      this.workersTerminated++;
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  evaluate(a, b, operation) {
    const op = OPERATION[operation];
    if (op === undefined) return Promise.reject(new Error(`Unknown Boolean operation: ${operation}`));
    const positionsA = a.positions instanceof Float32Array ? a.positions : new Float32Array(a.positions);
    const indicesA = a.indices instanceof Uint32Array ? a.indices : new Uint32Array(a.indices);
    const positionsB = b.positions instanceof Float32Array ? b.positions : new Float32Array(b.positions);
    const indicesB = b.indices instanceof Uint32Array ? b.indices : new Uint32Array(b.indices);
    const id = this.nextId++;
    this.jobsSubmitted++;
    const worker = this.ensureWorker();
    const promise = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
    worker.postMessage({id, cmd: 'run', op, positionsA, indicesA, positionsB, indicesB}, [
      positionsA.buffer, indicesA.buffer, positionsB.buffer, indicesB.buffer,
    ]);
    return promise;
  }

  classify(mesh, points) {
    const positions = mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions);
    const indices = mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
    const queryPoints = points instanceof Float32Array ? points : new Float32Array(points);
    if (queryPoints.length % 3) return Promise.reject(new Error('Classification points must be xyz triples'));
    const id = this.nextId++;
    this.jobsSubmitted++;
    const worker = this.ensureWorker();
    const promise = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
    worker.postMessage({id, cmd: 'classify', positions, indices, points: queryPoints}, [
      positions.buffer, indices.buffer, queryPoints.buffer,
    ]);
    return promise;
  }

  surfaceClip(mesh, points, lines, tolerance=0, options={}) {
    // Keep the installed result mesh owned by the main thread. Surface clipping is a
    // display-only follow-up, so transfer private copies to the Worker.
    const positions = mesh.positions instanceof Float32Array ? mesh.positions.slice() : new Float32Array(mesh.positions);
    const indices = mesh.indices instanceof Uint32Array ? mesh.indices.slice() : new Uint32Array(mesh.indices);
    const queryPoints = points instanceof Float32Array ? points : new Float32Array(points);
    const lineRanges = lines instanceof Uint32Array ? lines : new Uint32Array(lines);
    if (queryPoints.length % 3 || lineRanges.length % 2) return Promise.reject(new Error('Surface clip payload is invalid'));
    const id = this.nextId++;
    this.jobsSubmitted++;
    const worker = this.ensureWorker();
    const promise = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
    worker.postMessage({id, cmd:'surfaceClip', positions, indices, points:queryPoints, lines:lineRanges, tolerance:+tolerance||0, steps:options.steps||32, refine:options.refine||16}, [positions.buffer, indices.buffer, queryPoints.buffer, lineRanges.buffer]);
    return promise;
  }

  dispose() {
    if (this.worker) { this.worker.terminate?.(); this.workersTerminated++; }
    this.worker = null;
    const error = new Error('Boolean runtime disposed');
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }

  stats() {
    return {
      workerActive: !!this.worker,
      pending: this.pending.size,
      jobsSubmitted: this.jobsSubmitted,
      jobsCompleted: this.jobsCompleted,
      workersCreated: this.workersCreated,
      workersTerminated: this.workersTerminated,
      wasmHeapBytes: this.wasmHeapBytes,
    };
  }
}

export {OPERATION as FRAME_BOOLEAN_OPERATIONS};
