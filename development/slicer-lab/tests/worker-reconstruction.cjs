'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { prepareWorkers } = require('../scripts/prepare-workers.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-worker-reconstruction-'));
const target = path.join(temp, 'development', 'slicer-lab');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'worker-deltas.json'), 'utf8'));
const targetManifest = path.join(target, 'worker-deltas.json');
const targetSource = path.join(temp, manifest.upstream.repositoryPath);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let checks = 0;
try {
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(root, 'worker-deltas.json'), targetManifest);
  assert.throws(() => prepareWorkers(target), /Pinned runtime module is missing/); checks++;
  fs.mkdirSync(path.dirname(targetSource), { recursive: true });
  fs.writeFileSync(targetSource, 'wrong source');
  assert.throws(() => prepareWorkers(target), /checksum mismatch/); checks++;
  assert(!fs.existsSync(path.join(target, 'core'))); checks++;
  fs.copyFileSync(path.resolve(root, '../..', manifest.upstream.repositoryPath), targetSource);
  const results = prepareWorkers(target);
  assert.equal(results.length, 3); checks++;
  for (const entry of manifest.workers) {
    const generated = path.join(target, 'core', entry.file);
    assert.equal(sha(fs.readFileSync(generated)), entry.sha256); checks++;
    assert.deepEqual(fs.readFileSync(generated), fs.readFileSync(path.join(root, 'core', entry.file))); checks++;
  }
  const before = manifest.workers.map(entry => fs.statSync(path.join(target, 'core', entry.file)).mtimeMs);
  prepareWorkers(target);
  assert.deepEqual(manifest.workers.map(entry => fs.statSync(path.join(target, 'core', entry.file)).mtimeMs), before); checks++;
  const modified = path.join(target, 'core', manifest.workers[1].file);
  fs.appendFileSync(modified, '\n// local edit\n');
  assert.throws(() => prepareWorkers(target), /Generated worker differs/); checks++;
  assert(fs.readFileSync(modified, 'utf8').endsWith('// local edit\n')); checks++;
  fs.rmSync(path.join(target, 'core'), { recursive: true });
  const changed = structuredClone(manifest);
  changed.workers[1].edits[0].insert += '\n// altered delta\n';
  fs.writeFileSync(targetManifest, JSON.stringify(changed));
  assert.throws(() => prepareWorkers(target), /Reconstructed worker checksum mismatch/); checks++;
  assert(!fs.existsSync(path.join(target, 'core'))); checks++;
  changed.workers[1].file = '../outside.js';
  fs.writeFileSync(targetManifest, JSON.stringify(changed));
  assert.throws(() => prepareWorkers(target), /Invalid worker delta manifest/); checks++;
  fs.writeFileSync(targetManifest, JSON.stringify(manifest));
  const wrongAnchor = structuredClone(manifest);
  wrongAnchor.workers[1].edits[0].remove = 'invalid anchor';
  fs.writeFileSync(targetManifest, JSON.stringify(wrongAnchor));
  assert.throws(() => prepareWorkers(target), /does not match pinned source/); checks++;
  console.log('PASS worker reconstruction', checks, 'checks');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
