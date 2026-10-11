import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as stock from './fixtures/stock-stl-oracle.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const own=fileURLToPath(new URL('./',import.meta.url));
const at=process.argv.indexOf('--repository');
if(at>=0)assert(process.argv[at+1],'--repository requires an absolute or relative checkout path');
const repository=at>=0?path.resolve(process.argv[at+1]):fileURLToPath(new URL('../../../',import.meta.url));
const editorSource=path.join(repository,'editor-source');
const manifest=JSON.parse(fs.readFileSync(path.join(editorSource,'build-manifest.json'),'utf8'));
for(const field of ['productionEditor','productionSHA256','stlHelper','stlIntegration'])assert.equal(typeof manifest[field],'string','Missing build manifest '+field);
export const editor=fs.readFileSync(path.join(repository,manifest.productionEditor),'utf8');
assert.equal(sha(editor),manifest.productionSHA256,'Manifest-selected editor hash');
assert.equal(Buffer.byteLength(editor),manifest.productionBytes,'Manifest-selected editor bytes');
export const helper=fs.readFileSync(path.join(editorSource,manifest.stlHelper),'utf8');
JSON.parse(fs.readFileSync(path.join(editorSource,manifest.stlIntegration),'utf8'));
for(const field of ['stlPostprocessHelper','stlPostprocessIntegration'])assert.equal(typeof manifest[field],'string','Missing build manifest '+field);
// Undo only the later edge-selection stage for the frozen STL whole-editor oracle.
const edgeExtraction=JSON.parse(fs.readFileSync(path.join(editorSource,manifest.edgeSelectionExtraction),'utf8'));
assert.equal(sha(editor),edgeExtraction.beforeSHA256);assert.equal(Buffer.byteLength(editor),edgeExtraction.beforeBytes);
const edgeLines=editor.match(/[^\n]*\n|[^\n]+$/g)||[];
for(const operation of [...edgeExtraction.operations].reverse())edgeLines.splice(operation.startLine,operation.deleteLines,...operation.insert);
const stlEditor=edgeLines.join('');assert.equal(sha(stlEditor),edgeExtraction.afterSHA256);assert.equal(Buffer.byteLength(stlEditor),edgeExtraction.afterBytes);
assert.equal(sha(stlEditor),'df08be98af28f6898ae0bd76b1f99de09009b23ca0676c0afaadd25ca5afaf17');
export const postRuntime=fs.readFileSync(path.join(editorSource,manifest.stlPostprocessHelper),'utf8');
const postIntegration=JSON.parse(fs.readFileSync(path.join(editorSource,manifest.stlPostprocessIntegration),'utf8'));
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Unique postprocess reverse anchor');return s.replace(a,b);};
let reverted=once(stlEditor,postRuntime+'\n','');
for(const [a,b]of [
 ['async function framePrepareSTLCoordinator(buffer, activity, deferPostprocess) {','async function framePrepareSTLWorker(buffer, activity) {'],
 ['worker.postMessage({ buffer, creaseCos: CREASE_COS, deferPostprocess }, [buffer]);','worker.postMessage({ buffer, creaseCos: CREASE_COS }, [buffer]);'],
 ['if (!data.deferPostprocess && installed.indices.length >= 30000) {','if (installed.indices.length >= 30000) {']
])reverted=once(reverted,a,b);
export const prePostEditor=reverted;
assert.equal(sha(prePostEditor),postIntegration.beforeSHA256);assert.equal(Buffer.byteLength(prePostEditor),postIntegration.beforeBytes);
const lines=prePostEditor.match(/[^\n]*\n|[^\n]+$/g)||[];
for(const operation of [...postIntegration.operations].reverse())lines.splice(operation.startLine,operation.deleteLines,...operation.insert);
const tokenized=lines.join('');assert.equal(sha(tokenized),postIntegration.afterSHA256);assert.equal(Buffer.byteLength(tokenized),postIntegration.afterBytes);
assert.equal(once(tokenized,'/* FRAME_CURRENT_STL_POSTPROCESS */',postRuntime),stlEditor,'Exact manifest integration reproduces pinned STL stage');
const provenance=JSON.parse(fs.readFileSync(path.join(own,'fixtures/provenance.json'),'utf8'));
for(const [file,expected]of Object.entries(provenance.fixtures))assert.equal(sha(fs.readFileSync(path.join(own,file))),expected,'Frozen oracle modified: '+file);
assert.equal(sha(editor),provenance.reviewedEditorSHA256,'Independently reviewed editor');
assert.equal(sha(prePostEditor),provenance.prePostEditorSHA256,'Exact published r238 reverse');
assert.equal(sha(postRuntime),provenance.postRuntimeSHA256,'Reviewed guarded runtime');
assert.equal(sha(helper),provenance.privateHelperSHA256,'Reviewed private helper bytes');
assert.equal(editor.split(helper).length-1,1,'Helper must appear exactly once verbatim');
const names=['frameSTLCoordinateHash','frameSTLScalarKey','frameSTLCoordinateClasses','frameSTLEdgeHash','frameSTLEdgeTable','frameSTLEdgeCapacity','frameSTLCreaseData'];
export const helpers=Function(helper+'\nreturn {'+names.join(',')+'};')();
for(const name of names){assert.equal(typeof helpers[name],'function');assert.equal(editor.split((name==='frameSTLEdgeTable'?'class ':'function ')+name+(name==='frameSTLEdgeTable'?' {':'(')).length-1,1,'Private declaration count '+name);}
const frozenBody=fs.readFileSync(path.join(own,'fixtures/stock-worker-body.txt'),'utf8').trim();
const expectedBody=frozenBody.replaceAll('polygonCreaseData(','frameSTLCreaseData(');
const start=prePostEditor.indexOf('function frameSTLWorkerMain()'),end=prePostEditor.indexOf('\nasync function framePrepareSTLWorker',start);
assert(start>=0&&end>start,'Actual STL worker boundaries');
export const body=prePostEditor.slice(start,end).trim();
assert.equal(body,expectedBody,'Only the two intended worker calls may change');
const cStart=prePostEditor.indexOf('async function framePrepareSTLWorker('),cEnd=prePostEditor.indexOf('\nfunction frameClonePreparedSTLGeometry(',cStart);
assert(cStart>=0&&cEnd>cStart,'Actual STL coordinator boundaries');
export const coordinator=prePostEditor.slice(cStart,cEnd).trim();
const before='[frameParseSTLPositions, frameSTLGeometryBounds, polygonCreaseData, prepareSplineBVH, frameWireIndices]';
const after='[frameParseSTLPositions, frameSTLGeometryBounds, frameSTLCoordinateHash, frameSTLScalarKey, frameSTLCoordinateClasses, frameSTLEdgeHash, frameSTLEdgeTable, frameSTLEdgeCapacity, frameSTLCreaseData, prepareSplineBVH, frameWireIndices]';
assert.equal(coordinator.split(after).length-1,1,'Exact private dependency list');
assert.equal(prePostEditor.split(after).length-1,1);
const inserted=helper+'\n'+body;
assert.equal(prePostEditor.split(inserted).length-1,1,'Exact insertion with original whitespace');
const reverse=prePostEditor.replace(inserted,frozenBody).replace(after,before);
assert.equal(sha(reverse),provenance.baselineEditorSHA256,'Whole-editor exact reverse to published baseline');
for(const name of names)assert(!reverse.includes(name),'Private name already existed or leaked: '+name);
for(const [name,fn]of Object.entries(stock))assert(reverse.includes(fn.toString()),'Frozen stock function must match baseline: '+name);
assert.equal(prePostEditor.split('frameSTLCoordinateHash').length-1,helper.split('frameSTLCoordinateHash').length-1+1,'Hash only binds inside helper and serialized dependency list');
export const sourceResult={pass:true,editorSHA256:sha(editor),privateHelperSHA256:sha(helper),wholeEditorReverseExact:true,privateHashBindingVerified:true,stockGlobalUnchanged:true,actualSourceUnnormalized:true,postprocessReverseExact:true,postprocessRuntimeSHA256:sha(postRuntime)};

for(const [name,hash]of Object.entries(provenance.unchangedCoordinateFunctions))assert.equal(sha(helpers[name].toString()),hash,'Unchanged r237 coordinate function '+name);
const preEdge=helpers.frameSTLCreaseData.toString().replace('edges=new frameSTLEdgeTable(coordCount,{initialCapacity:frameSTLEdgeCapacity(faces)});','edges=new Map();').replace('const edge=edges.locate(ca,cb),head=edges.head(edge);','const edge=key(ca,cb),head=edges.get(edge);');
assert.equal(sha(preEdge),provenance.preEdgeCreaseSHA256,'Only two allowed lookup changes inside crease body');
export const preEdgeHelper=helper.replace(helpers.frameSTLCreaseData.toString(),preEdge);

const mainAt=editor.indexOf('function frameSTLWorkerMain()'),coordAt=editor.indexOf('\nasync function framePrepareSTLCoordinator(',mainAt);
assert(mainAt>=0&&coordAt>mainAt);
export const actualBody=editor.slice(mainAt,coordAt).trim();
const runtimeAt=editor.indexOf(postRuntime,coordAt);assert(runtimeAt>coordAt);
export const actualCoordinator=editor.slice(coordAt,runtimeAt).trim();
assert.equal(actualBody,body.replace('if (installed.indices.length >= 30000) {','if (!data.deferPostprocess && installed.indices.length >= 30000) {'));
assert.equal(actualCoordinator,coordinator.replace('framePrepareSTLWorker(buffer, activity)','framePrepareSTLCoordinator(buffer, activity, deferPostprocess)').replace('worker.postMessage({ buffer, creaseCos: CREASE_COS }, [buffer]);','worker.postMessage({ buffer, creaseCos: CREASE_COS, deferPostprocess }, [buffer]);'));
export const postFunctions=Function(postRuntime+';return {frameSTLPostprocessWorkerMain,frameSTLPostprocessTask,framePrepareSTLWorker};')();
for(const fn of Object.values(postFunctions))assert.equal(editor.split(fn.toString()).length,2,'Actual postprocess function unique');
