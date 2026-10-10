'use strict';
const fs=require('fs'),assert=require('assert/strict'),{createTLocalMaterialAtlas}=require('../experiments/T-local-material-atlas.cjs'),{createTRedistributedCentralCourses}=require('../experiments/T-redistributed-central-courses.cjs'),{compileTExecution}=require('../experiments/T-runtime-commands.cjs');
const start=performance.now(),atlas=createTLocalMaterialAtlas(fs.readFileSync('fixtures/T-local-material-certified-projection-v1.json')),built=performance.now(),g=createTRedistributedCentralCourses(),rows=[];
for(const [width,left,height,W,turn]of [[36,14,28,1,0],[32,13,25,.5,1],[60,24,40,2,3]]){
 let source=[[0,0],[width,0],[width,7],[left+7,7],[left+7,height],[left,height],[left,7],[0,7]].map(p=>p.map(v=>v*W));for(let i=0;i<turn;i++)source=source.map(([x,y])=>[-y,x]);
 const t=performance.now(),a=g.generate({source,W,runtimeOnly:true}),r=compileTExecution(a),generated=performance.now(),q=atlas.qualify(source,a,r),end=performance.now();assert(q.passed&&q.wholeSourceBodyExactCoverage&&q.sourceOriginalCAndPUnchanged&&!q.completeContourCacheUsed&&!q.pointSamplingUsed);
 rows.push({width,left,height,W,turn,commands:r.commands.length,cells:r.cells.length,newSource:true,generationAndRuntimeMS:generated-t,completeLocalMaterialCertificateMS:end-generated,totalMS:end-t,certificate:q});console.log(JSON.stringify({...rows.at(-1),certificate:{matched:q.localMatchedPolygons,errorW:q.totalUpperBoundW,bodyWork:q.wholeStraightSourceDomains.map(b=>b.work)}}));
}
const out={passed:true,scenes:3,atlasBuiltMS:built-start,rows,totalMS:performance.now()-start,completeOriginalPForNewContours:true,wholeContourQualificationNotRun:true};
fs.writeFileSync('evidence/T-local-material-atlas-light.json',JSON.stringify(out,null,2));console.log(JSON.stringify({passed:true,scenes:3,totalMS:out.totalMS}));
