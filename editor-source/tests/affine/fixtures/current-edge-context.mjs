import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildManifest, editorSourceRoot, sources} from '../source-paths.mjs';

// Current stock CM functions call the private edge receipt accessor even when
// there is no edge receipt. Install the actual declarations in isolated affine
// fixtures with their production initial null state, rather than mocking them.
const editor=fs.readFileSync(sources.editor,'utf8');
const parts=[['edgeSelectionMath','f6766572fef8bdb90988fa42a18d24300076b1910a0591080f7a5931e5b5afb9'],['edgeSelectionHelper','95340c90cff1ab942eba7a6b25ec689b74df26a005d4e57f7ee72975e319adaf']].map(([field,pin])=>{
  const name=buildManifest[field];assert.equal(typeof name,'string');assert(!name.startsWith('/')&&!name.includes('..'));
  const source=fs.readFileSync(new URL(name,editorSourceRoot),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),pin);assert.equal(editor.split(source).length,2);
  return source;
});
export function installCurrentEdgeContext(context){vm.runInContext(parts.join('\n'),context);}
