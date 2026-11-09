/** Independent CPU reference only. Directions are dimensionless; powers are watts. */
export function unit(v) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError('Expected finite 3-vector');
  const scale = Math.max(...v.map(Math.abs));
  if (!scale) throw new RangeError('Zero vector');
  const q = v.map(x => x / scale), length = Math.hypot(...q);
  return q.map(x => x / length);
}
const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
/** Normal must point into the incident medium; incoming propagation must oppose it. */
export function interfaceResponse(direction, normal, nIncident, nTransmitted) {
  if (![nIncident,nTransmitted].every(x => Number.isFinite(x) && x > 0)) throw new RangeError('Indices must be finite and positive');
  const d = unit(direction), n = unit(normal), projection = dot(d,n);
  if (projection > 1e-14) throw new RangeError('Normal must oppose incoming propagation');
  const ci = Math.min(1, Math.max(0, -projection));
  const reflected = unit(d.map((x,i) => x+2*ci*n[i]));
  if (nIncident === nTransmitted) return {reflected, transmitted:d, reflectance:0, transmittance:1, tir:false};
  // Tangential vector avoids cancellation in 1-cos(theta)^2 near normal incidence.
  const tangent = d.map((x,i) => x+ci*n[i]);
  const si = Math.hypot(...tangent), ratio = nIncident/nTransmitted;
  const st = si === 0 ? 0 : ratio*si;
  if (st >= 1) return {reflected, transmitted:null, reflectance:1, transmittance:0, tir:st>1};
  const ct = Math.sqrt((1-st)*(1+st));
  const transmitted = unit(n.map((x,i) => (si === 0 ? 0 : tangent[i]/si*st)-ct*x));
  // Scale indices before Fresnel products to avoid overflowing large valid indices.
  const scale = Math.max(nIncident,nTransmitted), a = nIncident/scale, b = nTransmitted/scale;
  const rs = (a*ci-b*ct)/(a*ci+b*ct), rp = (b*ci-a*ct)/(b*ci+a*ct);
  const reflectance = Math.min(1, Math.max(0,(rs*rs+rp*rp)/2));
  return {reflected, transmitted, reflectance, transmittance:1-reflectance, tir:false};
}
/** Lossless interface power split; no radiance/irradiance Jacobian is implied. */
export function splitPower(power, response) {
  if (!Number.isFinite(power) || power < 0) throw new RangeError('Power must be finite and nonnegative');
  const r = response.reflectance;
  if (!Number.isFinite(r) || r < 0 || r > 1) throw new RangeError('Invalid reflectance');
  const reflected = power*r;
  return {incident:power, reflected, transmitted:power-reflected};
}
/** Explicit accounting only; this does not trace or absorb rays. */
export function powerResidual(incident, {escaped=0, absorbed=0, active=0, discarded=0}={}) {
  const values = [incident,escaped,absorbed,active,discarded];
  if (!values.every(x => Number.isFinite(x) && x >= 0)) throw new RangeError('Powers must be finite and nonnegative');
  return incident-escaped-absorbed-active-discarded;
}
