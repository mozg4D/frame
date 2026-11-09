/** SI, CPU-only phenomenological reference laws. Not calibrated material presets. */
const issued = new WeakSet();
const vec = (v, name) => {
  if ((!Array.isArray(v) && !ArrayBuffer.isView(v)) || v.length !== 3 ||
      !Array.from(v).every(x => typeof x === 'number' && Number.isFinite(x))) {
    throw new TypeError(`${name} must contain three finite numbers`);
  }
  const copy = Array.from(v);
  if (!Number.isFinite(Math.hypot(...copy))) throw new RangeError(`${name} norm overflow`);
  return copy;
};
const scalar = (v, name, positive = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive ? v <= 0 : v < 0)) {
    throw new RangeError(`${name} must be finite and ${positive ? 'positive' : 'nonnegative'}`);
  }
  return v;
};
const cap = (v, limit) => {
  const n = Math.hypot(...v);
  return n > limit ? v.map(x => x / n * limit) : v;
};
const frozenVector = v => Object.freeze(v.map(x => x === 0 ? 0 : x));

export function createMaterial(parameters = {}) {
  if (!parameters || typeof parameters !== 'object') throw new TypeError('Material parameters required');
  const { kind } = parameters;
  if (kind !== 'soft' && kind !== 'hard') throw new TypeError('kind must be soft or hard');
  const names = ['kind', 'saturationMagnetization', 'reversibleSusceptibility'];
  if (kind === 'hard') names.push('remanentMagnetization', 'initialRemanenceFraction', 'coerciveField', 'irreversibleSusceptibility');
  for (const key of Object.keys(parameters)) if (!names.includes(key)) throw new TypeError(`Unknown material parameter ${key}`);
  const m = {kind,
    saturationMagnetization: scalar(parameters.saturationMagnetization, 'saturationMagnetization', true),
    reversibleSusceptibility: scalar(parameters.reversibleSusceptibility, 'reversibleSusceptibility'),
  };
  // Keep vector additions and all derived scales finite, rejecting pathological input.
  if (m.saturationMagnetization > Number.MAX_VALUE / 8) throw new RangeError('Magnetization scale too large');
  if (kind === 'hard') {
    m.remanentMagnetization = scalar(parameters.remanentMagnetization, 'remanentMagnetization', true);
    m.initialRemanenceFraction = scalar(parameters.initialRemanenceFraction, 'initialRemanenceFraction');
    m.coerciveField = scalar(parameters.coerciveField, 'coerciveField', true);
    m.irreversibleSusceptibility = scalar(parameters.irreversibleSusceptibility, 'irreversibleSusceptibility', true);
    if (m.remanentMagnetization > m.saturationMagnetization || m.initialRemanenceFraction > 1) throw new RangeError('Remanence exceeds bounds');
    const radius = m.coerciveField * m.irreversibleSusceptibility;
    if (!Number.isFinite(radius) || radius < m.remanentMagnetization || radius > Number.MAX_VALUE / 8) {
      throw new RangeError('coerciveField * irreversibleSusceptibility must be finite and >= remanentMagnetization');
    }
  }
  Object.freeze(m);
  issued.add(m);
  return m;
}

export function validateMaterial(material) {
  if (!issued.has(material)) throw new TypeError('Use createMaterial to validate and own material parameters');
  return true;
}

/** Initial/reset state in object-local axes; one independent record per sample. */
export function createInitialState(material) {
  validateMaterial(material);
  return Object.freeze({remanence: frozenVector([material.kind === 'hard' ?
    material.remanentMagnetization * material.initialRemanenceFraction : 0, 0, 0])});
}

/** Pure trial evaluation. Always supply the fixed physical-step baseline, not a prior trial. */
export function evaluateMaterial(material, {H, baselineRemanence} = {}) {
  validateMaterial(material);
  const field = vec(H, 'H');
  const baseline = vec(baselineRemanence, 'baselineRemanence');
  const h = Math.hypot(...field), ms = material.saturationMagnetization;
  const maxRemanence = material.kind === 'hard' ? material.remanentMagnetization : 0;
  if (Math.hypot(...baseline) > maxRemanence * (1 + 8 * Number.EPSILON)) throw new RangeError('Baseline remanence exceeds material bounds');
  let remanence = cap(baseline, maxRemanence);
  if (material.kind === 'hard' && h > 0) {
    // Vector play: project baseline into the ball centered on chi_ir * H,
    // radius chi_ir * Hc, then project into the remanence saturation ball.
    // Scale first to avoid overflow in chi_ir * H for large finite fields.
    const chi = material.irreversibleSusceptibility;
    const scale = Math.max(h, material.coerciveField, maxRemanence / chi);
    const offset = field.map((x, i) => x / scale - baseline[i] / chi / scale);
    const distance = Math.hypot(...offset), radius = material.coerciveField / scale;
    if (distance > radius) {
      const delta = (distance - radius) * scale * chi;
      // Saturate enormous excursions without constructing overflowing components.
      const blendScale = Math.max(maxRemanence, delta);
      if (!Number.isFinite(delta)) {
        remanence = offset.map(x => x / distance * maxRemanence);
      } else {
        const candidate = baseline.map((x, i) => x / blendScale + offset[i] / distance * (delta / blendScale));
        const length = Math.hypot(...candidate);
        const magnitude = Math.min(maxRemanence, length * blendScale);
        remanence = length ? candidate.map(x => x / length * magnitude) : [0, 0, 0];
      }
    }
  }
  const response = h === 0 || material.reversibleSusceptibility === 0 ? 0 :
    ms * Math.tanh(h / ms * material.reversibleSusceptibility);
  const reversible = h ? field.map(x => x / h * response) : [0, 0, 0];
  const M = cap(remanence.map((x, i) => x + reversible[i]), ms);
  return Object.freeze({M: frozenVector(M), remanence: frozenVector(remanence),
    saturation: Math.min(1, Math.hypot(...M) / ms)});
}
