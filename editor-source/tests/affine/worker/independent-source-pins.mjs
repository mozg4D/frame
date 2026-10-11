import {reviewURL} from '../source-paths.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const pins={
 './stock-oracle.mjs':'d4cb223df32788c6990b3033d69481e58a3333015fb8eb9fd2ec5c8177e171a5',
 './selected-face-oracle.mjs':'666729639f6a4cc8e96b430ad1c14c1d219fc94a52495f2c7b682430f6ef93bd',
 '../candidate/editor-affine-ui-v2c.mjs':'4a5ef2cdfe5c6b0bfe062d1a7cc5970a269e855f0a1cef9df2ab2ddad5ede74b',
 '../candidate/frame-affine-helper-v2b.mjs':'48cc27ad8d9025f81d190225ec3a1940dede02f8d8f12684b5246e53523d929f',
 '../candidate/native-affine-ui-v2b.mjs':'2e5af192ec3642b662cb54e98483b224dc6f124a68709ad0d0cfdc76b0fb0c85',
 '../candidate/native-source/affine-corner-worker.mjs':'d91f5ae84673b08682845b1165b3fcac9715470fe0a9842ca0db3f3e912990e1',
 '../candidate/native-source/affine-stock-proof.mjs':'45f000c23e5122b841af1216f7339f48979ba0bccf7036dbb6cd3f8df45a02d0',
 '../candidate/native-source/affine-stock-worker.mjs':'9448ff98f4025b4971022ef4c9b6c50ddfca02eda250033620eba21ca02b85ba',
 '../candidate/native-source/affine-versioned-base.mjs':'827c7b589da8353b12f964cf1a53aabf48ddf2288720e2cafda6fd7a81071782',
 '../fixtures/stock-editor-functions.js':'73a9f2d193646e5a2b4eb882a314541c411d3e19f2692e56264915eb9bdef648',
 '../fixtures/stock-editor-provenance.json':'5f1dccf35b9ecc4e9fb0e757e70709bde0adb60ae0a799e1503f4fa5869ae1e9',
 '../fixtures/three-core.mjs':'9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6'
};
for(const[name,expected]of Object.entries(pins))assert.equal(createHash('sha256').update(fs.readFileSync(reviewURL(name,import.meta.url))).digest('hex'),expected,name);
export const verifiedPins=pins;
