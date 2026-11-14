// Execute the shipped embedded helpers; fixtures supply only host state/DOM/ports.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8').then(s=>s.replaceAll('\r\n','\n'));
const block=id=>{const source=html.match(new RegExp('<script id="'+id+'" type="text/plain">([\\s\\S]*?)<\\/script>'))?.[1];assert.ok(source,'Embedded source '+id);return source;};
export const inlineSource=block('frame-documentation-editor');
export const documentationPopupMarkup='<base href="/">'+['frame-documentation-shell','frame-documentation-editor'].map(id=>'<script id="'+id+'" type="text/plain">'+block(id)+'</script>').join('\n');
const hostStart=html.indexOf('// Embedded popup documents.'),hostEnd=html.indexOf('const FrameViewWindows=',hostStart);assert.ok(hostStart>=0&&hostEnd>hostStart);
export const documentationHostSource=html.slice(hostStart,hostEnd);
const boundary='// Editor UI.\n',at=inlineSource.indexOf(boundary);assert.ok(at>=0,'Embedded editor UI boundary exists');
export const editorSource=inlineSource.slice(at+boundary.length);
const helpers=inlineSource.slice(0,at);
const api=await import('data:text/javascript;base64,'+Buffer.from(helpers+'\n'+documentationHostSource+'\nconst {documentationWindowFeatures,installDocumentationGeometry}=createFrameDocumentationGeometry();\nexport {edit,selectionAfter,presentation,rebase,draftLimit,rescueRecord,readRescue,session,history,documentationWindowFeatures,installDocumentationGeometry,installDocumentationWindow};').toString('base64'));
export const {edit,selectionAfter,presentation,rebase,draftLimit,rescueRecord,readRescue,session,history,documentationWindowFeatures,installDocumentationGeometry,installDocumentationWindow}=api;
