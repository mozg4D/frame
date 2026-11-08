// Exact cache-stamp reversal for the reference-based Benchy icon release.
// Current browser gates use the current runtime directly.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';

export const benchyReleaseLayer = JSON.parse(await readFile(new URL('benchy-release-layer.json', import.meta.url)));
const sha = value => createHash('sha256').update(value).digest('hex');

export function benchyStampBase(path, text) {
  const file = benchyReleaseLayer.files[path];
  if (!file) return text;
  assert.equal(sha(text), file.releaseSHA256, 'Exact Benchy release source: ' + path);
  const base = reverseAuthorLayer(text, file);
  assert.equal(sha(base), file.baseSHA256, 'Exact Benchy release predecessor: ' + path);
  return base;
}
