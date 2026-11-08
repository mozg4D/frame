// Exact reversal for historical release proofs. Current-field tests execute current shipped code.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';
const layer=JSON.parse(await readFile(new URL('scene-field-layer.json',import.meta.url)));
const sha=text=>createHash('sha256').update(text).digest('hex');
export function fieldBase(path,text){const file=layer.files[path];if(!file)return text;assert.equal(sha(text),file.releaseSHA256,'Exact common field runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact common field predecessor: '+path);return base;}
