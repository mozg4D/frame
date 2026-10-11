import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Only paths are adapted. Independent arithmetic oracles and all source assertions
// retain their reviewed behavior; the manifest cannot silently select other bytes.
export const testRoot = new URL('./', import.meta.url);
export const projectRoot = new URL('../../../', testRoot);
export const editorSourceRoot = new URL('../../', testRoot);
export const buildManifest = JSON.parse(fs.readFileSync(new URL('build-manifest.json', editorSourceRoot), 'utf8'));
const pins = {
  editor: '58183ac11616b64a5e67f3dde8294a7a127d26ab4efab0f1301eb2b3fdb41014',
  native: '4ab552e1b39abbd2b4bab7ebfdb8f6f9ae6245c862bcdd8e687a25e20e0b9463',
  helper: '48cc27ad8d9025f81d190225ec3a1940dede02f8d8f12684b5246e53523d929f',
  known: '82c9bc56798024f49d50158f9d7ad290c64055783de938344b9dc74a28e1c979',
  three: '9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6'
};
function manifestPath(field, base) {
  const path = buildManifest[field];
  assert.equal(typeof path, 'string', `Missing build manifest ${field}`);
  assert(path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), `Unsafe manifest ${field}`);
  const url = new URL(path, base);
  assert(url.href.startsWith(base.href), `Manifest ${field} escapes its source root`);
  return url;
}
export const sources = {
  editor: manifestPath('productionEditor', projectRoot),
  native: manifestPath('productionNative', projectRoot),
  helper: manifestPath('affineHelper', editorSourceRoot),
  known: manifestPath('affineKnown', editorSourceRoot),
  three: manifestPath('threeCore', projectRoot)
};
assert.equal(buildManifest.productionSHA256, pins.editor, 'Reviewed production editor pin');
assert.equal(buildManifest.nativeSHA256, pins.native, 'Reviewed production native pin');
// The tiny ESM adapter exports this existing production dependency to the frozen
// oracles without changing their bytes or shipping another Three.js bundle.
assert.equal(buildManifest.threeCore, 'modules/frame-three-core.9edde002b066a9a05676.js');
for (const [role, url] of Object.entries(sources)) {
  const bytes = fs.readFileSync(url);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), pins[role], `Reviewed ${role} source`);
  if (role === 'editor') assert.equal(bytes.length, buildManifest.productionBytes, 'Production editor byte length');
  if (role === 'native') assert.equal(bytes.length, buildManifest.nativeBytes, 'Production native byte length');
}
for (const name of ['FRAME_PIVOT_EDITOR', 'FRAME_SAVE_CONTROL_EDITOR']) {
  if (process.env[name]) assert.equal(fs.realpathSync(process.env[name]), fs.realpathSync(sources.editor), `${name} must identify the reviewed production editor`);
}
const aliases = new Map([
  ['candidate/editor-affine-ui-v2c.mjs', sources.editor],
  ['candidate/native-affine-ui-v2b.mjs', sources.native],
  ['candidate/frame-affine-helper-v2b.mjs', sources.helper],
  ['candidate/frame-affine-known-v2.mjs', sources.known],
  ['fixtures/three-core.mjs', sources.three]
]);
export function reviewURL(input, base = testRoot) {
  const url = new URL(input, base);
  if (!url.href.startsWith(testRoot.href)) return url;
  const name = url.href.slice(testRoot.href.length);
  if (aliases.has(name)) return new URL(aliases.get(name));
  if (name.startsWith('candidate/native-source/') && !name.endsWith('/')) {
    return new URL(name.slice('candidate/'.length), projectRoot);
  }
  return url;
}
