import {programBase} from './scene-program-binding.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {benchyStampBase, benchyReleaseLayer as layer} from './benchy-release-binding.mjs';
import {iconStampBase, iconReleaseLayer} from './icon-release-binding.mjs';
import {detachableBase} from './detachable-views-binding.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const checks = [];
assert.equal(layer.format, 'frame-benchy-stamp-layer-v1');
assert.equal(layer.timeZone, 'Europe/Moscow');
assert.equal(layer.baseCommit, '30af410d7f25aeaa5d34b4261849429f41642f58');
assert.deepEqual(Object.keys(layer.files).sort(), ['frame-sw.js', 'index.html']);
checks.push('Paired shell/cache stamp only, on the previous verified icon release');

const predecessor = JSON.parse(await readFile(new URL('detachable-views-layer.json', import.meta.url)));
for (const [path, file] of Object.entries(layer.files)) {
  const current = programBase(path,await readFile(new URL('../' + path, import.meta.url), 'utf8'));
  assert.equal(file.patches.length, 1);
  const patch = file.patches[0];
  assert.equal(patch.count, 1);
  assert.equal(patch.after, patch.before.replaceAll(layer.baseVersion, layer.releaseVersion));
  const base = benchyStampBase(path, current);
  assert.equal(sha(base), file.baseSHA256);
  assert.equal(base.split(patch.before).length - 1, 1);
  assert.equal(base.replace(patch.before, patch.after), current);
  checks.push(path + ': exact stamp-only forward and reverse');
  for (const changed of [current + ' ', current.replace(layer.releaseVersion, layer.baseVersion), current + patch.after]) {
    assert.throws(() => benchyStampBase(path, changed), /Exact (Benchy release source|Scene program runtime)/);
  }
  checks.push(path + ': additional bytes, old stamp and duplicate patch rejected');
  assert.equal(sha(iconStampBase(path, base)), iconReleaseLayer.files[path].baseSHA256);
  assert.equal(sha(detachableBase(path, current)), predecessor.files[path].baseSHA256);
  checks.push(path + ': previous icon and full historical binding chains preserved');
}
for (const [path, expected] of Object.entries({...layer.immutableLayers, ...layer.unchangedAssets})) {
  assert.equal(sha(await readFile(new URL('../' + path, import.meta.url))), expected, path);
}
checks.push('Every predecessor layer and the Thermal SVG are byte-identical');
assert.equal(benchyStampBase('unrelated.txt', 'unaltered'), 'unaltered');
checks.push('Unrelated source is not rewritten');
console.log(JSON.stringify({pass:true, checks:checks.length, names:checks, version:layer.releaseVersion, hardwareGPUValidated:false}, null, 2));
