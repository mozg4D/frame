import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {sampleRectangleSource as emit} from './source-sampling.mjs';
import {evaluatePowerLedger} from '../../plugins/optics/validation/power-ledger.js';

const source = Object.freeze({widthMm:12, heightMm:8, wavelengthNm:550, powerW:8, distribution:'lambertian'});
const samples = Object.freeze({areaU:0.25, areaV:0.75, directionU:0.75, directionV:0.25});
const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const unitSamples = (u, v) => ({areaU:u, areaV:v, directionU:u, directionV:v});

test('explicit local rectangle mapping, wavelength, cosine direction and PDF units', () => {
  const ray = emit(source, 32, samples);
  assert.deepEqual(ray.originMm, [-3, 2, 0]);
  close(ray.direction[0], 0);
  close(ray.direction[1], Math.sqrt(3) / 2);
  close(ray.direction[2], 0.5);
  close(ray.pdfSolidAngle, 0.5 / Math.PI);
  assert.equal(ray.angularDiscreteMass, null);
  assert.equal(ray.pdfAreaPerMm2, 1 / 96);
  assert.equal(ray.powerW, 0.25);
  assert.equal(ray.wavelengthNm, 550);
  // Doubling each side quadruples area and quarters the PDF; nm is independent.
  const scaled = emit({...source, widthMm:24, heightMm:16, wavelengthNm:660}, 32, samples);
  assert.equal(scaled.pdfAreaPerMm2, ray.pdfAreaPerMm2 / 4);
  assert.deepEqual(scaled.originMm, [-6, 4, 0]);
  assert.equal(scaled.wavelengthNm, 660);
  assert.deepEqual(scaled.direction, ray.direction);
});

test('four sample channels affect area and angle independently and reproducibly', () => {
  const ray = emit(source, 1, samples);
  assert.deepEqual(emit(source, 1, samples), ray);
  const moved = emit(source, 1, {...samples, areaU:0.9, areaV:0.1});
  assert.notDeepEqual(moved.originMm, ray.originMm);
  assert.deepEqual(moved.direction, ray.direction);
  const turned = emit(source, 1, {...samples, directionU:0.1, directionV:0.9});
  assert.deepEqual(turned.originMm, ray.originMm);
  assert.notDeepEqual(turned.direction, ray.direction);
  const original = structuredClone(ray);
  ray.originMm[0] = 123;
  ray.direction[0] = 123;
  assert.deepEqual(emit(source, 1, samples), original);
  assert.equal(source.widthMm, 12);
  assert.equal(samples.areaU, 0.25);
});

test('unit-sample boundaries stay on finite rectangle and emitting hemisphere', () => {
  for (const u of [0, Number.MIN_VALUE, 0.5, 1 - Number.EPSILON / 2]) {
    for (const v of [0, 0.5, 1 - Number.EPSILON / 2]) {
      const ray = emit(source, 1, unitSamples(u, v));
      assert.ok(ray.originMm[0] >= -6 && ray.originMm[0] <= 6);
      assert.ok(ray.originMm[1] >= -4 && ray.originMm[1] <= 4);
      assert.equal(ray.originMm[2], 0);
      close(Math.hypot(...ray.direction), 1);
      assert.ok(ray.direction[2] > 0 && ray.direction[2] <= 1);
      assert.ok(ray.pdfSolidAngle > 0);
    }
  }
});

test('midpoint refinements converge to analytic Lambertian moments and cone power', t => {
  let previousError = Infinity;
  const angles = [13, 30, 50, 75].map(degrees => degrees * Math.PI / 180);
  for (const m of [8, 32, 128]) {
    let z = 0, z2 = 0, x = 0, y = 0, x2 = 0, y2 = 0;
    const cones = angles.map(() => 0), count = m * m;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const ray = emit(source, count, unitSamples((i + 0.5) / m, (j + 0.5) / m));
      const [dx, dy, dz] = ray.direction;
      close(Math.hypot(dx, dy, dz), 1);
      close(ray.pdfSolidAngle, dz / Math.PI);
      x += dx; y += dy; z += dz; x2 += dx * dx; y2 += dy * dy; z2 += dz * dz;
      for (let k = 0; k < angles.length; k++) if (dz >= Math.cos(angles[k])) cones[k]++;
    }
    const error = Math.abs(z / count - 2 / 3);
    assert.ok(error < previousError / 2, 'E[z] must converge on refinement');
    assert.ok(error < 0.1 / m, 'analytic E[z] = 2/3');
    close(z2 / count, 1 / 2);
    close(x2 / count, 1 / 4);
    close(y2 / count, 1 / 4);
    close(x / count, 0); close(y / count, 0);
    for (let k = 0; k < angles.length; k++)
      close(cones[k] / count, Math.sin(angles[k]) ** 2, 0.5 / m + 1e-12);
    const coneErrors = cones.map((hits, k) => Math.abs(hits / count - Math.sin(angles[k]) ** 2));
    t.diagnostic(`${m}x${m} angular strata: errors E[z]=${error.toExponential(4)}, ` +
      `E[z^2]=${Math.abs(z2 / count - 0.5).toExponential(2)}, ` +
      `E[x^2]=${Math.abs(x2 / count - 0.25).toExponential(2)}, ` +
      `E[y^2]=${Math.abs(y2 / count - 0.25).toExponential(2)}; ` +
      `cone errors (13,30,50,75 degrees)=${coneErrors.map(e => e.toExponential(4)).join(',')}`);
    previousError = error;
  }
  // Independent solid-angle integration: dOmega = 2*pi*dz, not dtheta*dphi.
  let integral = 0;
  for (let i = 0; i < 128; i++) integral += ((i + 0.5) / 128 / Math.PI) * 2 * Math.PI / 128;
  close(integral, 1);
});

test('rectangle centroid and second moments converge to uniform finite-area values', t => {
  let previousError = Infinity;
  for (const m of [8, 32, 128]) {
    let x = 0, y = 0, x2 = 0, y2 = 0, xy = 0;
    const count = m * m;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const ray = emit(source, count, unitSamples((i + 0.5) / m, (j + 0.5) / m));
      const [px, py, pz] = ray.originMm;
      assert.ok(Math.abs(px) < 6 && Math.abs(py) < 4);
      assert.equal(pz, 0);
      x += px; y += py; x2 += px * px; y2 += py * py; xy += px * py;
    }
    close(x / count, 0); close(y / count, 0); close(xy / count, 0);
    const error = Math.abs(x2 / count - source.widthMm ** 2 / 12);
    assert.ok(error < previousError / 4, 'uniform-area second moment must converge');
    close(x2 / count, source.widthMm ** 2 / 12, source.widthMm ** 2 / (12 * m * m) + 1e-12);
    close(y2 / count, source.heightMm ** 2 / 12, source.heightMm ** 2 / (12 * m * m) + 1e-12);
    t.diagnostic(`${m}x${m} area strata: E[x^2] error ${error.toExponential(4)} mm^2`);
    previousError = error;
  }
});

test('collimated emission is an angular delta mass with continuous area density', () => {
  const collimated = {...source, distribution:'collimated'};
  for (const directionU of [0, 0.25, 1 - Number.EPSILON / 2]) {
    const ray = emit(collimated, 8, {...samples, directionU});
    assert.deepEqual(ray.direction, [0, 0, 1]);
    assert.equal(ray.pdfSolidAngle, null);
    assert.equal(ray.angularDiscreteMass, 1);
    assert.equal(ray.pdfAreaPerMm2, 1 / 96);
    assert.equal(ray.powerW, 1);
  }
  assert.equal(emit(source, 8, samples).angularDiscreteMass, null);
});

test('fixed total source watts survive sample-count refinement without an extra cosine', () => {
  for (const distribution of ['lambertian', 'collimated']) for (const count of [1, 16, 1024]) {
    let emitted = 0, cosineWeighted = 0;
    for (let i = 0; i < count; i++) {
      const ray = emit({...source, distribution}, count, unitSamples((i + 0.5) / count, 0.37));
      assert.equal(ray.powerW, source.powerW / count);
      emitted += ray.powerW;
      cosineWeighted += ray.powerW * ray.direction[2];
    }
    assert.equal(emitted, source.powerW);
    if (distribution === 'lambertian' && count > 1) assert.ok(cosineWeighted < 0.7 * emitted);
    const hash = '0'.repeat(31) + '1';
    const ledger = evaluatePowerLedger({sources:[{hash, emittedWatts:source.powerW}],
      terminals:[{sourceHash:hash, usefulWatts:0, unwantedWatts:0, absorbedWatts:0, escapedWatts:0, unresolvedWatts:emitted}],
      tolerance:{absoluteWatts:0, relative:0}});
    assert.equal(ledger.balanced, true);
    assert.equal(ledger.totals.unresolvedWatts, source.powerW);
    assert.equal(ledger.physicalQualified, false);
    assert.equal(ledger.solverCertified, false);
  }
  assert.equal(emit({...source, powerW:0}, 1024, samples).powerW, 0);
});

test('analytic collimated free-flight footprint retains finite extent and area power', () => {
  // This is an analytic free-flight check of emitted rays, not scene intersection.
  const m = 64, count = m * m, collimated = {...source, distribution:'collimated'};
  for (const distanceMm of [1, 1000]) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, centralPower = 0;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const ray = emit(collimated, count, unitSamples((i + 0.5) / m, (j + 0.5) / m));
      const t = distanceMm / ray.direction[2];
      const x = ray.originMm[0] + t * ray.direction[0], y = ray.originMm[1] + t * ray.direction[1];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (Math.abs(x) < source.widthMm / 4 && Math.abs(y) < source.heightMm / 4) centralPower += ray.powerW;
    }
    close(maxX - minX, source.widthMm * (1 - 1 / m));
    close(maxY - minY, source.heightMm * (1 - 1 / m));
    assert.equal(centralPower, source.powerW / 4);
  }
});

test('invalid source, count and all four sample inputs reject before emission', () => {
  for (const bad of [null, undefined, [], 1, 'source']) assert.throws(() => emit(bad, 1, samples), TypeError);
  for (const bad of [null, undefined, [], 1]) assert.throws(() => emit(source, 1, bad), TypeError);
  for (const key of ['widthMm', 'heightMm', 'wavelengthNm']) {
    for (const bad of [0, -0, -1, NaN, Infinity, -Infinity, null, undefined, '1', true, 1n])
      assert.throws(() => emit({...source, [key]:bad}, 1, samples), RangeError);
  }
  for (const bad of [-1, NaN, Infinity, -Infinity, null, undefined, '1', true, 1n])
    assert.throws(() => emit({...source, powerW:bad}, 1, samples), RangeError);
  for (const bad of ['', 'Lambertian', 'COLLIMATED', null, undefined, 0])
    assert.throws(() => emit({...source, distribution:bad}, 1, samples), RangeError);
  for (const bad of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', 1n, null])
    assert.throws(() => emit(source, bad, samples), RangeError);
  for (const distribution of ['lambertian', 'collimated']) for (const key of Object.keys(samples)) {
    for (const bad of [-Number.MIN_VALUE, -1, 1, NaN, Infinity, -Infinity, null, undefined, '0', true, 0n])
      assert.throws(() => emit({...source, distribution}, 1, {...samples, [key]:bad}), RangeError);
  }
});

test('derived arithmetic rejects overflow, underflow and collapsed half extents', () => {
  for (const [widthMm, heightMm] of [[1e308, 2], [1e-200, 1e-200], [1e-160, 1e-160],
    [Number.MIN_VALUE, 1e308], [1e308, Number.MIN_VALUE]])
    assert.throws(() => emit({...source, widthMm, heightMm}, 1, samples), RangeError);
  assert.throws(() => emit({...source, powerW:Number.MIN_VALUE}, 2, samples), RangeError);
  for (const patch of [{widthMm:Number.MAX_VALUE, heightMm:1}, {widthMm:1e-300, heightMm:1e300},
    {widthMm:1e-154, heightMm:1e-154}, {powerW:Number.MAX_VALUE}, {powerW:Number.MIN_VALUE}]) {
    const ray = emit({...source, ...patch}, 1, samples);
    assert.ok([...ray.originMm, ...ray.direction, ray.pdfAreaPerMm2, ray.pdfSolidAngle, ray.powerW].every(Number.isFinite));
    assert.ok(ray.pdfAreaPerMm2 > 0);
  }
  const ray = emit(source, Number.MAX_SAFE_INTEGER, samples);
  assert.ok(ray.powerW > 0);
  assert.equal(emit({...source, powerW:-0}, 1, samples).powerW, 0);
});

test('100000 completed streaming emissions have fixed output size and bounded CPU time', t => {
  let seed = 20261109, checksum = 0;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const expectedKeys = ['originMm', 'direction', 'wavelengthNm', 'powerW', 'pdfAreaPerMm2', 'pdfSolidAngle', 'angularDiscreteMass'];
  const collimated = {...source, distribution:'collimated'}, count = 100000;
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    const ray = emit(i % 2 ? source : collimated, count,
      {areaU:random(), areaV:random(), directionU:random(), directionV:random()});
    assert.equal(ray.originMm.length, 3);
    assert.equal(ray.direction.length, 3);
    assert.deepEqual(Object.keys(ray), expectedKeys);
    close(Math.hypot(...ray.direction), 1);
    checksum += ray.powerW + ray.direction[2] + ray.originMm[0];
  }
  const elapsed = performance.now() - start;
  assert.ok(Number.isFinite(checksum) && checksum > 0);
  assert.ok(elapsed < 5000, `100000 completed streaming samples exceed 5 seconds: ${elapsed} ms`);
  t.diagnostic(`100000 completed mixed emissions plus shape/unit checks: ${elapsed.toFixed(2)} ms; checksum ${checksum.toFixed(6)}`);
});
