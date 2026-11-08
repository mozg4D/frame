import {benchyStampBase} from './benchy-release-binding.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {iconStampBase, iconReleaseLayer as layer} from './icon-release-binding.mjs';
import {detachableBase} from './detachable-views-binding.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const checks = [];
assert.equal(layer.format, 'frame-icon-stamp-layer-v1');
assert.equal(layer.timeZone, 'Europe/Moscow');
assert.equal(layer.baseCommit, '17d701a056c8cdbce2da2e55d3cf88dd50d13a80');
assert.deepEqual(Object.keys(layer.files).sort(), ['frame-sw.js', 'index.html']);
checks.push('Only the paired shell/cache stamp is changed on the verified prompt release');

const predecessor = JSON.parse(await readFile(new URL('detachable-views-layer.json', import.meta.url)));
for (const [path, file] of Object.entries(layer.files)) {
  const current = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  const raw = benchyStampBase(path, current);
  assert.equal(file.patches.length, 1);
  const patch = file.patches[0];
  assert.equal(patch.count, 1);
  assert.equal(patch.after, patch.before.replaceAll(layer.baseVersion, layer.releaseVersion));
  const base = iconStampBase(path, raw);
  assert.equal(sha(base), file.baseSHA256);
  assert.equal(base.split(patch.before).length - 1, 1);
  assert.equal(base.replace(patch.before, patch.after), raw);
  checks.push(path + ': exact stamp-only forward and backward round trip');
  for (const mutated of [raw + ' ', raw.replace(layer.releaseVersion, layer.baseVersion), raw + patch.after]) {
    assert.throws(() => iconStampBase(path, mutated), /Exact icon release source/);
  }
  checks.push(path + ': extra bytes, stale version and duplicate patch rejected');
  assert.equal(sha(detachableBase(path, current)), predecessor.files[path].baseSHA256);
  checks.push(path + ': complete historical binding chain remains exact');
}
for (const [path, expected] of Object.entries(layer.immutableLayers)) {
  assert.equal(sha(await readFile(new URL('../' + path, import.meta.url))), expected, path);
}
checks.push('All predecessor layer files remain byte-identical');
assert.equal(iconStampBase('unrelated.txt', 'unaltered'), 'unaltered');
checks.push('Unrelated source is not rewritten');
console.log(JSON.stringify({pass:true, checks:checks.length, names:checks, version:layer.releaseVersion, hardwareGPUValidated:false}, null, 2));
