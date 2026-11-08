import {thermalUIBase,thermalUILayer} from './thermal-ui-binding.mjs';
import {selectionGizmoBase,selectionGizmoLayer} from './selection-gizmo-binding.mjs';
// Exact predecessor reversal for historical proofs. Native gates use shipped bytes.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {reverseAuthorLayer} from './scene-data-runtime.mjs';
export const programLayer=JSON.parse(await readFile(new URL('scene-program-layer.json',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function programBase(path,text){if(sha(text)===thermalUILayer.files[path]?.releaseSHA256)text=thermalUIBase(path,text);if(sha(text)===selectionGizmoLayer.files[path]?.releaseSHA256)text=selectionGizmoBase(path,text);const file=programLayer.files[path];if(!file)return text;if(sha(text)===file.baseSHA256)return text;assert.equal(sha(text),file.releaseSHA256,'Exact Scene program runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact Scene program predecessor: '+path);return base;}
