/**
 * Audit candidate only. Exact stock toFixed(7) equivalence classes for finite,
 * immutable, packed Float32 STL coordinates. No Float64/generic-array support.
 * Scalar tokens preserve negative rounded zero and exact-zero normalization.
 */
export function scalarKeyFromFiniteFloat32(value, bits) {
  // Caller must supply a finite Float32 value and its matching Uint32 bits.
  if (value === 0) return 0;
  if ((bits & 0x7fffffff) >= 0x3f800000) return bits;
  // 10^7 = 2^7 * 78125. The product has at most 41 significant binary bits.
  const scaled = Math.abs(value) * 1e7;
  const whole = Math.floor(scaled);
  const rounded = whole + (scaled - whole >= 0.5 ? 1 : 0);
  return value < 0 ? (rounded | 0x80000000) >>> 0 : rounded;
}

export function hashTriple(x, y, z) {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

export function classifyCoordinates(positions, { hashFunction = hashTriple } = {}) {
  // The optional hash injection is solely for deterministic collision tests.
  if (!ArrayBuffer.isView(positions) || Object.getPrototypeOf(positions) !== Float32Array.prototype || positions.length % 3) {
    throw new TypeError('Expected plain packed Float32 xyz positions');
  }
  if (typeof SharedArrayBuffer !== 'undefined' && positions.buffer instanceof SharedArrayBuffer) {
    throw new TypeError('Shared mutable coordinates are outside this contract');
  }
  const vertexCount = positions.length / 3;
  const coords = new Uint32Array(vertexCount);
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  let slots = new Uint32Array(16);
  let keys = new Uint32Array(24);
  let coordCount = 0;
  const grow = () => {
    if (slots.length >= 0x40000000) throw new RangeError('Coordinate table exceeds supported size');
    const next = new Uint32Array(slots.length * 2);
    for (let id = 0; id < coordCount; id++) {
      const offset = id * 3;
      let slot = hashFunction(keys[offset], keys[offset + 1], keys[offset + 2]) & (next.length - 1);
      while (next[slot]) slot = (slot + 1) & (next.length - 1);
      next[slot] = id + 1;
    }
    const expanded = new Uint32Array(next.length * 3 / 2);
    expanded.set(keys);
    keys = expanded;
    slots = next;
  };
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 3;
    const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new TypeError('STL contains a non-finite vertex');
    }
    const xKey = scalarKeyFromFiniteFloat32(x, bits[offset]);
    const yKey = scalarKeyFromFiniteFloat32(y, bits[offset + 1]);
    const zKey = scalarKeyFromFiniteFloat32(z, bits[offset + 2]);
    if ((coordCount + 1) * 2 > slots.length) grow();
    let slot = hashFunction(xKey, yKey, zKey) & (slots.length - 1);
    let id;
    while (slots[slot]) {
      const candidate = slots[slot] - 1;
      const keyOffset = candidate * 3;
      // Hashes select a bucket; exact triples decide equality.
      if (keys[keyOffset] === xKey && keys[keyOffset + 1] === yKey && keys[keyOffset + 2] === zKey) {
        id = candidate;
        break;
      }
      slot = (slot + 1) & (slots.length - 1);
    }
    if (id === undefined) {
      // IDs follow original vertex encounter order, never hash bucket order.
      id = coordCount++;
      const keyOffset = id * 3;
      keys[keyOffset] = xKey;
      keys[keyOffset + 1] = yKey;
      keys[keyOffset + 2] = zKey;
      slots[slot] = id + 1;
    }
    coords[vertex] = id;
  }
  return { coords, coordCount };
}
