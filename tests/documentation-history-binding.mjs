// Exact Undo reversal before unchanged historical release proofs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';
export const historyLayer=JSON.parse(await readFile(new URL('documentation-history-layer.json',import.meta.url)));
const sha=text=>createHash('sha256').update(text).digest('hex');
export function historyBase(path,text){const layer=historyLayer.files[path];if(!layer)return text;assert.equal(sha(text),layer.releaseSHA256,'Exact Undo release source: '+path);const base=reverseAuthorLayer(text,layer);assert.equal(sha(base),layer.baseSHA256,'Exact Undo predecessor: '+path);return base;}
for(const [path,expected] of Object.entries(historyLayer.newFiles))assert.equal(sha(await readFile(new URL('../'+path,import.meta.url))),expected,'History module binding: '+path);
