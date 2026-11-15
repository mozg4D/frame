import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {H} from './hash-codec-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),paths=execFileSync('git',['ls-files','-z','--','*.hash'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
let metadataRecords=0;
for(const path of paths){const input=H.reader(new Blob([await readFile(join(root,path))])),index=await input.index(),owners=index.get(H.K.all)?await input.read(index.get(H.K.all)):[],addresses=[H.K.parameters,...owners.map(h=>H.address(h,'parameters'))];
 for(const address of addresses){const record=index.get(address);if(!record)continue;assert.equal(record.type,H.T.value,path+': authoring must be native binary data');const value=await input.read(record);assert(value&&typeof value==='object'&&!Array.isArray(value),path+': authoring must decode as a binary structure');metadataRecords++;}}
const html=await readFile(join(root,'index.html'),'utf8'),start=html.indexOf('    async function nativeDecodePlan(file){'),end=html.indexOf('    async function nativeDecodeMesh(file,o){',start),reader=html.slice(start,end);
assert(!/JSON\.(?:parse|stringify)/.test(reader),'HASH admission cannot contain a JSON codec');assert(!html.includes('binaryValues'),'No legacy plugin JSON migration is retained');
console.log({pass:true,files:paths.length,binaryMetadataRecords:metadataRecords});
