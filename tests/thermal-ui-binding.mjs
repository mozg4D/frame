// Exact outer layer for historical proofs; browser gates always use shipped bytes.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {reverseAuthorLayer} from './scene-data-runtime.mjs';
export const thermalUILayer=JSON.parse(await readFile(new URL('thermal-ui-layer.json',import.meta.url)));const sha=value=>createHash('sha256').update(value).digest('hex');
export function thermalUIBase(path,text){const file=thermalUILayer.files[path];if(!file)return text;assert.equal(sha(text),file.releaseSHA256,'Exact Thermal UI runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact Thermal UI predecessor: '+path);return base;}
