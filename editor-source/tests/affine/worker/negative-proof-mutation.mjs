import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sources,buildManifest,reviewURL} from '../source-paths.mjs';

const tempRoot = fs.realpathSync(os.tmpdir());
const tmp = fs.mkdtempSync(path.join(tempRoot, 'frame-v4-proof-negative-'));
const testRoot = path.join(tmp, 'editor-source/tests/affine');
let report;
try {
  // Build an isolated minimal source tree. Never mutate production or the oracle.
  function copy(from, to) { fs.mkdirSync(path.dirname(to), {recursive:true}); fs.copyFileSync(from, to); }
  copy(new URL('../source-paths.mjs', import.meta.url), path.join(testRoot, 'source-paths.mjs'));
  for (const name of ['connected-support-blob.mjs', 'stock-oracle.mjs', 'selected-face-oracle.mjs', 'proof-isolation-controls.mjs']) {
    copy(new URL(name, import.meta.url), path.join(testRoot, 'worker', name));
  }
  for (const name of ['three-core.mjs', 'stock-editor-functions.js']) {
    copy(new URL('../fixtures/' + name, import.meta.url), path.join(testRoot, 'fixtures', name));
  }
  for (const [role, field, prefix] of [
    ['editor', 'productionEditor', ''], ['native', 'productionNative', ''],
    ['three', 'threeCore', ''], ['helper', 'affineHelper', 'editor-source'],
    ['known', 'affineKnown', 'editor-source']
  ]) copy(sources[role], path.join(tmp, prefix, buildManifest[field]));
  copy(reviewURL('../candidate/native-source/affine-corner-worker.mjs', import.meta.url), path.join(tmp, 'native-source/affine-corner-worker.mjs'));
  const p = path.join(tmp, buildManifest.productionNative);
  const original = fs.readFileSync(p, 'utf8'), at = 'const start=performance.now(),q=canonical.compute';
  assert.equal(original.split(at).length, 2);
  const mutated = original.replace(at, 'if(m.readOnly&&canonical.proof)canonical.proof.outsideHashes.fill(0n);' + at);
  const sha = text => createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(p, mutated);
  // Only the deliberate isolated mutation gets an updated integrity pin. The
  // child must reach the unchanged behavioral assertions, not fail on loading.
  for (const name of ['source-paths.mjs', 'worker/connected-support-blob.mjs']) {
    const file = path.join(testRoot, name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(sha(original), sha(mutated)));
  }
  fs.writeFileSync(path.join(tmp, 'editor-source/build-manifest.json'), JSON.stringify({...buildManifest, nativeSHA256:sha(mutated), nativeBytes:Buffer.byteLength(mutated)}));
  const result = spawnSync(process.execPath, [path.join(testRoot, 'worker/proof-isolation-controls.mjs')], {encoding:'utf8', timeout:15000});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AssertionError/);
  assert.match(result.stderr, /proof-isolation-controls\.mjs/);
  assert(!result.error && !result.signal, 'Negative control must reach its behavioral assertion');
  report = {passed:true, negativeControlDetected:true, mutation:'Read-only canonical pose corrupts the private outside weld certificate', expectedFailure:'Subsequent contact incorrectly admits the fast stock path', actualGeneratedBlobWorkerThread:true, exitCode:result.status};
} finally {
  const resolved = fs.realpathSync(tmp);
  assert(path.dirname(resolved).toLowerCase() === tempRoot.toLowerCase() && path.basename(resolved).startsWith('frame-v4-proof-negative-'));
  fs.rmSync(resolved, {recursive:true, force:true});
}
console.log(JSON.stringify(report));
