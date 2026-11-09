/**
 * Independent CPU emission reference; no scene tracing, RNG, native adapter or
 * transforms. The caller supplies an independently validated physical rectangle.
 * Local XY is centered at the origin in mm; the emitting normal is local +Z.
 * This is an ideal monochromatic, uniform, one-sided finite-area source.
 *
 * sampleRectangleSource(
 *   {widthMm, heightMm, wavelengthNm, powerW, distribution}, sampleCount,
 *   {areaU, areaV, directionU, directionV}
 * )
 * distribution is 'lambertian' or ideal 'collimated'. All four caller-supplied
 * independent uniform unit samples must be finite in [0, 1), even for collimated.
 * sampleCount is a positive safe integer; it never sizes an allocation or loop.
 *
 * pdfAreaPerMm2 is a density in mm^-2. pdfSolidAngle is a density in sr^-1 for
 * Lambertian emission (cos(theta)/pi), and null for collimated delta emission.
 * angularDiscreteMass is null for Lambertian and 1 for collimated emission.
 * Each ray carries powerW/sampleCount watts: cosine is already in Lambertian
 * sampling and must not multiply the ray's power a second time.
 *
 * Reject unrepresentable area, reciprocal area, half extents and positive ray
 * power rounded to zero. Other IEEE-754 rounding remains; no arbitrary scale or
 * exact real-arithmetic guarantee is made. Work and output storage are O(1).
 * Cosine sampling reference: PBRT 4e, A.5.3,
 * https://pbr-book.org/4ed/Sampling_Algorithms/Sampling_Multidimensional_Functions
 */
export function sampleRectangleSource(source, sampleCount, samples) {
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new TypeError('Expected a source record');
  if (!samples || typeof samples !== 'object' || Array.isArray(samples))
    throw new TypeError('Expected a unit-sample record');
  const {widthMm, heightMm, wavelengthNm, powerW, distribution} = source;
  const {areaU, areaV, directionU, directionV} = samples;
  for (const value of [widthMm, heightMm, wavelengthNm]) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError('Dimensions and wavelength must be finite and positive');
  }
  if (!Number.isFinite(powerW) || powerW < 0)
    throw new RangeError('Source power must be finite and nonnegative');
  if (distribution !== 'lambertian' && distribution !== 'collimated')
    throw new RangeError('Expected lambertian or collimated distribution');
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0)
    throw new RangeError('Sample count must be a positive safe integer');
  for (const value of [areaU, areaV, directionU, directionV]) {
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new RangeError('Unit samples must be finite in [0, 1)');
  }

  const area = widthMm * heightMm, pdfAreaPerMm2 = 1 / area;
  if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(pdfAreaPerMm2) || pdfAreaPerMm2 <= 0 ||
      widthMm / 2 === 0 || heightMm / 2 === 0)
    throw new RangeError('Rectangle area, area PDF and half extents must be representable');
  const rayPowerW = powerW === 0 ? 0 : powerW / sampleCount;
  if (!Number.isFinite(rayPowerW) || (powerW > 0 && rayPowerW === 0))
    throw new RangeError('Ray power must be representable');

  const originMm = [(areaU - 0.5) * widthMm, (areaV - 0.5) * heightMm, 0];
  let direction = [0, 0, 1], pdfSolidAngle = null, angularDiscreteMass = 1;
  if (distribution === 'lambertian') {
    const r = Math.sqrt(directionU), phi = 2 * Math.PI * directionV, z = Math.sqrt(1 - directionU);
    direction = [r * Math.cos(phi), r * Math.sin(phi), z];
    pdfSolidAngle = z / Math.PI;
    angularDiscreteMass = null;
  }
  return {originMm, direction, wavelengthNm, powerW:rayPowerW, pdfAreaPerMm2, pdfSolidAngle, angularDiscreteMass};
}
