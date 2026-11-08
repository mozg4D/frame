// Reverse only this release's exact cache stamp for immutable predecessor proofs.
// Native browser gates always exercise the current, unmodified runtime.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';

export const iconReleaseLayer = JSON.parse(await readFile(new URL('icon-release-layer.json', import.meta.url)));
const sha = text => createHash('sha256').update(text).digest('hex');

export function iconStampBase(path, text) {
  const file = iconReleaseLayer.files[path];
  if (!file) return text;
  assert.equal(sha(text), file.releaseSHA256, 'Exact icon release source: ' + path);
  const base = reverseAuthorLayer(text, file);
  assert.equal(sha(base), file.baseSHA256, 'Exact icon release predecessor: ' + path);
  return base;
}
