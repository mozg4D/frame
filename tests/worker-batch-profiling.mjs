import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Test-only worker timing. It annotates each returned chunk once and sums only
// newly supplied parts, so cached cell records cannot count an old build twice.
const batchAnchor='function buildBatch(state,indices){',reportAnchor='result.report.affectedCells=state.dirty.length;';
const wrapper='function buildBatch(state,indices){const start=performance.now(),parts=buildBatchUnprofiled(state,indices),ms=performance.now()-start;if(parts.length)Object.assign(parts[0],{__benchmarkBatchMs:ms,__benchmarkBatchCount:1,__benchmarkBatchCells:indices.length});return parts;}\n';
const report='result.report.cpuBatchMs=parts.reduce((sum,p)=>sum+(p.__benchmarkBatchMs||0),0);result.report.cpuBatchCount=parts.reduce((sum,p)=>sum+(p.__benchmarkBatchCount||0),0);result.report.cpuBatchCells=parts.reduce((sum,p)=>sum+(p.__benchmarkBatchCells||0),0);';
export function instrumentSplineWorkerBatches(source){
 assert.equal(source.split(batchAnchor).length,2,'One native worker batch builder is required');assert.equal(source.split(reportAnchor).length,2,'One native worker assembly report is required');
 return source.replace(batchAnchor,wrapper+'function buildBatchUnprofiled(state,indices){').replace(reportAnchor,report+reportAnchor);
}
export async function workerBatchProfilingChecks(){
 const source=await readFile(new URL('../index.html',import.meta.url),'utf8'),instrumented=instrumentSplineWorkerBatches(source),original=source.slice(source.indexOf(batchAnchor)).split(/\r?\n/)[0],profiled=instrumented.slice(instrumented.indexOf('function buildBatch(state,indices){')).split(/\r?\n/).slice(0,2).join('\n');
 const K={buildSplineSurface:{cell:()=>({positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2]),boundary:[['a',0],['b',1],['c',2]],report:{builder:'frame-planar'},enclosure:null})}},state={quads:[{},null],data:{approximation:{angle:10}},cells:{fills:[{},{}]},samples:new Map()},ordinary=Function('K',original+';return buildBatch;')(K)(state,[0,1]),timed=Function('K',profiled+';return buildBatch;')(K)(state,[0,1]);
 const plain=structuredClone(timed);for(const p of plain){delete p.__benchmarkBatchMs;delete p.__benchmarkBatchCount;delete p.__benchmarkBatchCells;}assert.deepEqual(plain,ordinary);assert.ok(Number.isFinite(timed[0].__benchmarkBatchMs)&&timed[0].__benchmarkBatchMs>=0);assert.equal(timed[0].__benchmarkBatchCells,2);
 const aggregated=Function('parts','result',report+';return result.report;')(timed,{report:{}});assert.equal(aggregated.cpuBatchCount,1);assert.equal(aggregated.cpuBatchCells,2);assert.equal(aggregated.cpuBatchMs,timed[0].__benchmarkBatchMs);
 return {pass:true,checks:[{name:'Timing annotation preserves native batch geometry and ordering',pass:true},{name:'One timing covers an entire worker chunk',pass:true},{name:'Assembly aggregates only newly supplied chunk timing',pass:true}]};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){console.log(JSON.stringify(await workerBatchProfilingChecks(),null,2));}
