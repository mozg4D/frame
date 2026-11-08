import {thermalUIBase,thermalUILayer} from './thermal-ui-binding.mjs';
// Exact successor reversal for historical proofs; native gates use shipped bytes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';
export const selectionGizmoLayer=JSON.parse(await readFile(new URL('selection-gizmo-layer.json',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
export function selectionGizmoBase(path,text){if(sha(text)===thermalUILayer.files[path]?.releaseSHA256)text=thermalUIBase(path,text);const file=selectionGizmoLayer.files[path];if(!file)return text;assert.equal(sha(text),file.releaseSHA256,'Exact selection gizmo runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact selection gizmo predecessor: '+path);return base;}
