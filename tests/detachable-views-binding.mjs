// Exact reversal for unchanged historical CPU proofs. Native gates test the new runtime directly.
import assert from 'node:assert/strict';
import {placementBase} from './viewport-placement-binding.mjs';
import {fieldBase} from './scene-field-binding.mjs';
import {copiesBase} from './viewport-copies-binding.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {reverseAuthorLayer} from './scene-data-runtime.mjs';
const layer=JSON.parse(await readFile(new URL('detachable-views-layer.json',import.meta.url)));
const sha=text=>createHash('sha256').update(text).digest('hex');
export function detachableBase(path,text){text=copiesBase(path,fieldBase(path,placementBase(path,text)));const file=layer.files[path];if(!file)return text;assert.equal(sha(text),file.releaseSHA256,'Exact detachable runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact detachable predecessor: '+path);return base;}
