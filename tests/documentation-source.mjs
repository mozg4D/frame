// Execute the shipped inline helpers; CPU fixtures inject only editor DOM/ports.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../documentation.html',import.meta.url),'utf8').then(s=>s.replaceAll('\r\n','\n'));
export const inlineSource=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineSource,'Documentation has one inline editor module');
const boundary='// Editor UI.\n',at=inlineSource.indexOf(boundary);
assert.ok(at>=0,'Inline editor UI boundary exists');
export const editorSource=inlineSource.slice(at+boundary.length);
const helpers=inlineSource.slice(0,at).replace(/^import[^\n]*\n/gm,'');
const api=await import('data:text/javascript;base64,'+Buffer.from(helpers+'\nexport {edit,selectionAfter,presentation,rebase,draftLimit,rescueRecord,readRescue,session,history};').toString('base64'));
export const {edit,selectionAfter,presentation,rebase,draftLimit,rescueRecord,readRescue,session,history}=api;
