import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const indexText=fs.readFileSync(new URL('./source-index.json',import.meta.url),'utf8');
assert.equal(hash(indexText),'49e92992564b172c13e398835c609d831ab9075c014b55fd93751eee21ec0026','Frozen parser-free source index');
const index=JSON.parse(indexText);
const entry=s=>{const key=hash(s);assert(index[key],`No frozen source index for SHA ${key}`);return index[key]};
export function declarations(s){return new Map(entry(s).functions.map(([name,start,end])=>{const text=s.slice(start,end);assert(new RegExp('^(?:async\\s+)?function\\s*\\*?\\s*'+name+'\\s*\\(').test(text),`Indexed declaration name: ${name}`);return[name,text]}));}
export function extractTopology(s){const q=entry(s).topology;assert(q,'No frozen topology factory');return s.slice(q.start,q.end)+'\nexport{'+q.exports.join(',')+'};';}
