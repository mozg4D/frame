import {installOrdinaryMoveUpload} from "./ordinary-move-upload.d7d183518bf9a821443c.js";

const mutable = new WeakSet();
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const abort = () => new DOMException('Ordinary Move display owner changed', 'AbortError');
const matrix = value => {
  if (!value || value.length !== 16 || !Array.from(value).every(Number.isFinite)) throw Error('Finite Move matrix required');
  return Float64Array.from(value);
};
function point(p, m) {
  const [x,y,z] = p, w = 1 / (m[3]*x + m[7]*y + m[11]*z + m[15]);
  return [(m[0]*x+m[4]*y+m[8]*z+m[12])*w,(m[1]*x+m[5]*y+m[9]*z+m[13])*w,(m[2]*x+m[6]*y+m[10]*z+m[14])*w];
}

// Geometry ownership is deliberately independent of the current selection.
// All gestures share the display/pick position buffer, but each freezes its own
// selected source on the GPU. A released gesture survives a later island pick.
export class OrdinaryMoveDisplayRoot {
  constructor({native, mesh, numeric, device, pool, isCurrent, onRender = () => {}, aliases = [], primaryElements = null, yieldTask}) {
    if (!mesh?.geometry || !numeric || typeof isCurrent !== 'function' || pool?.device !== device) throw Error('Explicit same-device Move display ownership required');
    Object.assign(this, {native, mesh, numeric, device, pool, isCurrent, onRender, aliases, primaryElements, yieldTask});
    this.geometry = mesh.geometry;
    this.rows = [];
    this.uploadRows = [];
    this.closed = false;
    this.ready = false;
    this.serial = 0;
    this.revision = 0;
    this.transition = null;
    mutable.add(numeric.positions); mutable.add(numeric.extras);
    installOrdinaryMoveUpload(pool.constructor, {usageForData: (data, usage) => native.rigidGpuBufferUsage?.(data, usage) ?? (mutable.has(data) && (usage & 128) ? usage | 12 : usage)});
  }

  current() {return !this.closed && this.mesh.geometry === this.geometry && this.isCurrent();}

  async initialize() {
    if (!this.current()) throw abort();
    this.adapter = this.native.registerRigidGpuGeometry(this.geometry, this.numeric, {isCurrent: () => this.current()});
    if (this.adapter.ordinaryOwner && this.adapter.ordinaryOwner !== this) throw abort();
    this.adapter.ordinaryOwner = this;
    this.native.installRigidGpuAttributeViews(this.adapter);
    for (const alias of this.aliases) this.bindAlias(alias);
    if(this.primaryElements)this.adapter.rows.set(this.geometry,{lineIndices:new Map([[`points:${this.geometry.drawRange.start}:${this.primaryElements.length}`,this.primaryElements]])});
    try {
      for (const [data, label] of [[this.numeric.positions, 'Move shared positions'], [this.numeric.extras, 'Move shared normals']]) {
        this.uploadRows.push(await this.pool.borrowAsync(data, 128, label, {isCurrent: () => this.current(), yieldTask: this.yieldTask}));
      }
      this.uploadRows.push(await this.pool.borrowAsync(this.numeric.indices,16,'Move triangle indices',{isCurrent:()=>this.current(),yieldTask:this.yieldTask}));
      if(this.primaryElements)this.uploadRows.push(await this.pool.borrowAsync(this.primaryElements,136,'Move point elements',{minBytes:8,isCurrent:()=>this.current(),yieldTask:this.yieldTask}));
      for(const alias of this.aliases){this.uploadRows.push(await this.pool.borrowAsync(alias.extras,136,'Move wire attributes',{isCurrent:()=>this.current(),yieldTask:this.yieldTask}));if(alias.elements)this.uploadRows.push(await this.pool.borrowAsync(alias.elements,136,'Move wire elements',{minBytes:8,isCurrent:()=>this.current(),yieldTask:this.yieldTask}));}
      if (!this.current()) throw abort();
      this.adapter.positionView = (id, component) => this.position(id)[component];
      this.ready = true;
      return this;
    } catch (error) {await this.dispose(); throw error;}
  }

  bindAlias(alias){
    this.adapter.aliases.set(alias.geometry,{index:alias.geometry.index,version:alias.geometry.index?.version,extras:alias.extras});
    if(alias.elements)this.adapter.rows.set(alias.geometry,{lineIndices:new Map([[`segments:0:${alias.elements.length}`,alias.elements]])});
  }

  position(id) {
    let p = [this.geometry.attributes.position.array[id*3], this.geometry.attributes.position.array[id*3+1], this.geometry.attributes.position.array[id*3+2]];
    for (const row of this.rows) if (row.live && !row.retiring && row.mask[id]) {
      p = point(point(point(p, row.world), row.delta), row.inverse).map(Math.fround);
    }
    return p;
  }

  async begin({rawIDs, rawMask, world, inverse}) {
    if (!this.ready || !this.current() || this.transition || this.rows.some(r => r.live && !r.released)) throw abort();
    if (!(rawIDs instanceof Uint32Array) || !rawIDs.length || !(rawMask instanceof Uint8Array) || rawMask.length !== this.numeric.vertexCount) throw Error('Owned worker raw selection descriptor required');
    const transition = {};
    this.transition = transition;
    try {return await this._begin({rawIDs, rawMask, world, inverse});}
    finally {if (this.transition === transition) this.transition = null;}
  }

  async _begin({rawIDs, rawMask, world, inverse}) {
    const previous = this.rows.at(-1);
    if (previous) await previous.scheduler.whenIdle();
    if (!this.current()) throw abort();
    const row = {id: ++this.serial, live: true, released: false, mask: rawMask, ids: rawIDs,
      world: matrix(world), inverse: matrix(inverse), delta: Float64Array.from(identity), root: this};
    // The worker validated the sorted slots. Reuse transferred IDs and already
    // staged buffers instead of repeating a large admission scan/copy on input.
    await this.pool.borrowAsync(rawIDs, 128, 'Move selected slots', {isCurrent: () => row.live && this.current(), yieldTask: this.yieldTask}).then(r => row.idUpload = r);
    const gpu = Object.create(this.native.GpuAffineCornerPreview.prototype);
    Object.assign(gpu, {device: this.device, pool: this.pool, isCurrent: () => row.live && this.current(), ids: rawIDs, faces: rawIDs,
      version: 0, disposed: false, borrowed: [], cpuPositions: this.numeric.positions, cpuExtras: this.numeric.extras,
      base: null, gathered: false, last: null, pending: new Set(), stats: {submissions: 0, uniformBytes: 0, selectedVertices: rawIDs.length, selectedNormals: rawIDs.length}});
    try {
      gpu.position = gpu.borrow(this.numeric.positions, 128, 'Move shared position storage');
      gpu.normal = gpu.borrow(this.numeric.extras, 128, 'Move shared normal storage');
      gpu.id = gpu.borrow(rawIDs, 128, 'Move raw slots');
      gpu.face = gpu.borrow(rawIDs, 128, 'Move raw normal slots');
      gpu.base = this.device.createBuffer({label: 'Move frozen gesture source', size: Math.max(4, rawIDs.length*24), usage: 140});
      await gpu.initialize();
      if (!row.live || !this.current()) throw abort();
      row.gpu = gpu;
      row.scheduler = new this.native.BoundedPoseSubmit({isCurrent: () => row.live && this.current(),
        submit: (payload, current) => gpu.submitDisplayPose({...payload, isCurrent: current}),
        onSubmitted: () => {this.revision++; this.adapter.revision++; this.onRender();},
        onError: error => {row.error = error; this.onRender(error);}});
      this.rows.push(row);
      return row;
    } catch (error) {
      row.live = false; await gpu.dispose(); this.pool.release(row.idUpload); throw error;
    }
  }

  pose(row, delta, local) {
    if (row.root !== this || !row.live || row.retiring || row.released || !this.current()) return false;
    row.delta = matrix(delta);
    const localMatrix = matrix(local);
    this.adapter.revision++;
    this.onRender();
    return row.scheduler.request({matrix: localMatrix, world: row.world, basis: identity, normalMatrix: identity}, () => row.live && this.current());
  }

  release(row) {
    if (row.root !== this || !row.live || row.released || !this.current()) return false;
    row.released = true;
    return true;
  }

  async cancelFrom(row) {
    if (this.transition) throw abort();
    const index = this.rows.indexOf(row);
    if (index < 0) return false;
    const transition = {};
    this.transition = transition;
    const retired = this.rows.splice(index);
    for (const child of retired) child.retiring = true;
    try {for (const child of retired.toReversed()) {
      child.scheduler.close();
      await child.scheduler.whenIdle();
      try {if (this.current()) await child.gpu.restoreFrozenSource();}
      finally {child.live = false; await child.gpu.dispose(); this.pool.release(child.idUpload);}
    }} finally {if (this.transition === transition) this.transition = null;}
    this.adapter.revision++; this.onRender();
    return true;
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const row of this.rows.toReversed()) {
      row.live = false; row.scheduler.close(); await row.gpu.dispose(); await row.scheduler.whenIdle(); this.pool.release(row.idUpload);
    }
    this.rows.length = 0;
    if (this.adapter?.ordinaryOwner === this) this.native.unregisterRigidGpuGeometry(this.geometry, this.adapter);
    for (const row of this.uploadRows) this.pool.release(row);
    this.uploadRows.length = 0;
  }
}
