'use strict';
// Reconstruct the exact checkpoint workers from the existing pinned Frame module.
// No network, dependencies, eval, shell commands, or production writes are used.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const names = ['upstream-worker.js', 'candidate-worker.js', 'optimized-worker.js'];
const runtimePath = 'modules/slicer-worker.e120c24f46831ec5c53d.js';

function prepareWorkers(root = path.resolve(__dirname, '..')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'worker-deltas.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.upstream?.repositoryPath !== runtimePath ||
      !Array.isArray(manifest.workers) || manifest.workers.length !== names.length ||
      manifest.workers.some((entry, i) => entry.file !== names[i])) {
    throw Error('Invalid worker delta manifest');
  }
  const sourcePath = path.resolve(root, '../..', runtimePath);
  if (!fs.existsSync(sourcePath)) {
    throw Error('Pinned runtime module is missing. Run from a Frame checkout containing ' + runtimePath);
  }
  const source = fs.readFileSync(sourcePath);
  if (source.length !== manifest.upstream.bytes || hash(source) !== manifest.upstream.sha256) {
    throw Error('Pinned runtime module checksum mismatch');
  }
  const outputs = manifest.workers.map(entry => {
    if (!Array.isArray(entry.edits)) throw Error('Invalid worker edit list');
    const chunks = [];
    let cursor = 0;
    for (const edit of entry.edits) {
      if (!Number.isSafeInteger(edit.offset) || edit.offset < cursor ||
          typeof edit.remove !== 'string' || typeof edit.insert !== 'string') {
        throw Error('Invalid worker edit');
      }
      const removed = Buffer.from(edit.remove, 'utf8');
      const end = edit.offset + removed.length;
      if (end > source.length || !source.subarray(edit.offset, end).equals(removed)) {
        throw Error('Worker edit does not match pinned source');
      }
      chunks.push(source.subarray(cursor, edit.offset), Buffer.from(edit.insert, 'utf8'));
      cursor = end;
    }
    chunks.push(source.subarray(cursor));
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) {
      throw Error('Reconstructed worker checksum mismatch: ' + entry.file);
    }
    const file = path.join(root, 'core', entry.file);
    if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) {
      throw Error('Generated worker differs from checkpoint; move it aside before rebuilding: ' + entry.file);
    }
    return { file, bytes, name: entry.file, sha256: entry.sha256 };
  });
  // Validate every output and pre-existing file before creating any worker.
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  for (const output of outputs) {
    if (!fs.existsSync(output.file)) fs.writeFileSync(output.file, output.bytes, { flag: 'wx' });
  }
  return outputs.map(({ name, sha256, bytes }) => ({ file: name, sha256, bytes: bytes.length }));
}

if (require.main === module) {
  for (const output of prepareWorkers()) console.log(output.sha256 + '  core/' + output.file);
}
module.exports = { prepareWorkers };
