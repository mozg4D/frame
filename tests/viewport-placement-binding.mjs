// Exact predecessor reversal. Current placement tests execute current runtime bytes.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {reverseAuthorLayer} from './scene-data-runtime.mjs';
const layer=JSON.parse(await readFile(new URL('viewport-placement-layer.json',import.meta.url))),sha=s=>createHash('sha256').update(s).digest('hex');
export function placementBase(path,text){const file=layer.files[path];if(!file)return text;assert.equal(sha(text),file.releaseSHA256,'Exact placement runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact placement predecessor: '+path);return base;}
