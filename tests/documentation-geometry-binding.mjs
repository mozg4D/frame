// Exact geometry release reversal, without relaxing prior runtime invariants.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';
export const geometryLayer=JSON.parse(await readFile(new URL('documentation-geometry-layer.json',import.meta.url)));
export function geometryBase(path,text){const layer=geometryLayer.files[path];if(!layer)return text;const base=reverseAuthorLayer(text,layer);assert.equal(createHash('sha256').update(base).digest('hex'),layer.baseSHA256,'Geometry reversal: '+path);return base;}
for(const [path,expected] of Object.entries(geometryLayer.newFiles))assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),expected,'Geometry module binding: '+path);
