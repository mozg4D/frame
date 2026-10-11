import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';

// Installed layout: editor-source/tests/edge-selection/support/source-paths.mjs.
// An explicit checkout is useful when running this suite before packaging it.
const args=process.argv.slice(2);
assert(args.length <= 1, 'Usage: node run-review.mjs [checkout-root]');
const override=args[0] || process.env.FRAME_REVIEW_ROOT;
export const editorSourceRoot=override
  ? pathToFileURL(path.resolve(override,'editor-source')+path.sep)
  : new URL('../../../',import.meta.url);
export const projectRoot=new URL('../',editorSourceRoot);
process.env.FRAME_REVIEW_ROOT=fileURLToPath(projectRoot);
export const testRoot=new URL('../',import.meta.url);
export const buildManifest=JSON.parse(fs.readFileSync(new URL('build-manifest.json',editorSourceRoot),'utf8'));
export const sha=s=>createHash('sha256').update(s).digest('hex');
export const pins={
  editor:'4a5ef2cdfe5c6b0bfe062d1a7cc5970a269e855f0a1cef9df2ab2ddad5ede74b',
  editorBase:'df08be98af28f6898ae0bd76b1f99de09009b23ca0676c0afaadd25ca5afaf17',
  native:'2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85',
  nativeBase:'2e10321a8de53806ff34fc7591ce38353cd17a2812cecc6c95f0eefc41741eef',
  helper:'95340c90cff1ab942eba7a6b25ec689b74df26a005d4e57f7ee72975e319adaf',
  math:'f6766572fef8bdb90988fa42a18d24300076b1910a0591080f7a5931e5b5afb9',
  three:'ed200c36396533a895a276bdf539ca86bd7ec8909d483de4f6eb5bda32cb24ec',
  core:'9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6'
};
function sourceURL(value,base,label){
  assert.equal(typeof value,'string',`Missing ${label}`);
  assert(value && !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..') && !/[?#:]/.test(value),`Unsafe ${label}`);
  const url=new URL(value,base);assert(url.href.startsWith(base.href),`${label} escapes source root`);return url;
}
const manifestURL=(key,base)=>sourceURL(buildManifest[key],base,`build manifest ${key}`);
const html=fs.readFileSync(new URL('index.html',projectRoot),'utf8');
const assetTag=html.match(/<script\b[^>]*\bid=["']frame-assets["'][^>]*>([\s\S]*?)<\/script>/);
assert(assetTag,'Current checkout has no frame-assets manifest');
const assets=JSON.parse(assetTag[1]).assets;
export const sources={
  editor:manifestURL('productionEditor',projectRoot),
  native:manifestURL('productionNative',projectRoot),
  helper:manifestURL('edgeSelectionHelper',editorSourceRoot),
  math:manifestURL('edgeSelectionMath',editorSourceRoot),
  core:manifestURL('threeCore',projectRoot),
  three:sourceURL(assets.three?.path,projectRoot,'frame-assets three'),
  topology:new URL('native-source/topology-islands.mjs',projectRoot)
};
assert.equal(buildManifest.productionSHA256,pins.editor,'Reviewed production editor pin');
assert.equal(buildManifest.nativeSHA256,pins.native,'Reviewed production native pin');
assert.equal(assets.three.sha256,pins.three,'Reviewed production Three wrapper pin');
assert.equal(assets['frame-three-core'].sha256,pins.core,'Reviewed production Three core pin');
assert.equal(sourceURL(assets['frame-three-core'].path,projectRoot,'frame-assets Three core').href,sources.core.href);
const texts={};
for(const role of ['editor','native','helper','math','three','core']){
  const bytes=fs.readFileSync(sources[role]);assert.equal(sha(bytes),pins[role],`Reviewed ${role} SHA256`);texts[role]=bytes.toString('utf8');
  if(role==='editor')assert.equal(bytes.length,buildManifest.productionBytes,'Production editor bytes');
  if(role==='native')assert.equal(bytes.length,buildManifest.nativeBytes,'Production native bytes');
}
const edits={editor:JSON.parse(fs.readFileSync(new URL('../fixtures/EXACT-EDITOR-EDITS.json',import.meta.url),'utf8')),native:JSON.parse(fs.readFileSync(new URL('../fixtures/EXACT-NATIVE-EDITS.json',import.meta.url),'utf8'))};
for(const role of ['editor','native']){
  let value=texts[role];
  for(const row of edits[role].toReversed()){
    row.newText=value.slice(row.newStart,row.newEnd);
    assert.equal(sha(row.newText),row.newSHA256,`Reverse-edit source slice ${role}: ${row.label}`);
    assert.equal(value.split(row.newText).length-1,1,`Unique reverse ${role}: ${row.label}`);
    value=value.replace(row.newText,row.oldText);
  }
  assert.equal(sha(value),pins[role+'Base'],`Whole-source historical ${role} SHA256 after reverse edits`);
  texts[role+'Base']=value;
}
// Check the repository's compact reverse-build delta against the independently
// retained exact-edit proof. Both must reconstruct the same complete old editor.
const extraction=JSON.parse(fs.readFileSync(manifestURL('edgeSelectionExtraction',editorSourceRoot),'utf8'));
assert.equal(extraction.schema,'frame-exact-line-delta-v1');
assert.equal(extraction.beforeSHA256,pins.editor);assert.equal(extraction.afterSHA256,pins.editorBase);
assert.equal(extraction.beforeBytes,Buffer.byteLength(texts.editor));
const reverseLines=texts.editor.match(/[^\n]*\n|[^\n]+$/g)||[];
for(const op of extraction.operations.toReversed())reverseLines.splice(op.startLine,op.deleteLines,...op.insert);
assert.equal(reverseLines.join(''),texts.editorBase,'Manifest extraction equals all twelve original reverse edits');
assert.equal(extraction.afterBytes,Buffer.byteLength(texts.editorBase));
// Native bundling removes just the export token, preserving its following space.
// The exact source module is used by lifecycle and worker controls only after
// proving that its complete factory body occurs verbatim in the pinned runtime.
export const topologySource=fs.readFileSync(sources.topology,'utf8');
export const topologyFactory='\n'+topologySource.replace(/\bexport\b/g,'')+'\n';
assert.equal(texts.native.split(topologyFactory).length-1,1,'Exact native-source topology factory in production runtime');
const exports=['topologyStamp','captureTopology','buildTopologyWork','topologyTransfer','connectedMaskWork','edgeIdFromRaw','drainCooperatively'];
export const topologyModule=topologyFactory+'\nexport{'+exports.join(',')+'};';
// This legacy spelling exists only to retain the original migration comparison.
const migrationModule=topologyFactory+'\nexport {'+exports.join(',')+'};\n';
export const nodeThreeSource=texts.three.replaceAll("'frame-three-core'",JSON.stringify(sources.core.href));
assert.notEqual(nodeThreeSource,texts.three,'Three wrapper core import must be rebound');
export const threeURL=new URL('data:text/javascript;base64,'+Buffer.from(nodeThreeSource).toString('base64'));
const aliases=new Map([
  ['editor-candidate.mjs',texts.editor],['editor-baseline-r239.mjs',texts.editorBase],
  ['native-candidate.mjs',texts.native],['native-on-cache-baseline.mjs',texts.nativeBase],
  ['edge-cm-helpers.inc.js',texts.helper],['cm-generated-math.inc.js',texts.math],
  ['three-baseline.mjs',texts.three],['three-core-baseline.mjs',texts.core],
  ['three-node-adapter.mjs',nodeThreeSource],['migration/topology-islands.mjs',migrationModule],
  ['EXACT-EDITOR-EDITS.json',JSON.stringify(edits.editor)],['EXACT-NATIVE-EDITS.json',JSON.stringify(edits.native)]
]);
export function read(name){assert(aliases.has(name),`Unknown source alias: ${name}`);return aliases.get(name);}
