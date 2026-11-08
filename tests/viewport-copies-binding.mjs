// Exact predecessor reversal for historical CPU proofs; hardware tests use current runtime bytes.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {reverseAuthorLayer} from './scene-data-runtime.mjs';
const layer=JSON.parse(await readFile(new URL('viewport-copies-layer.json',import.meta.url))),sha=text=>createHash('sha256').update(text).digest('hex');
export function copiesBase(path,text){const file=layer.files[path];if(!file)return text;assert.equal(sha(text),file.releaseSHA256,'Exact independent-views runtime: '+path);const base=reverseAuthorLayer(text,file);assert.equal(sha(base),file.baseSHA256,'Exact independent-views predecessor: '+path);return base;}
