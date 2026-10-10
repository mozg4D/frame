const assert=require('assert/strict'),fs=require('fs'),path=require('path');const {createCore,canonicalRing,sliceWithScheduler}=require('../core/contour-core.cjs');const core=createCore();const base=JSON.parse(fs.readFileSync(path.join(__dirname,'../evidence/baseline.json')));const rows=[];let assertions=0;
for(const q of base){if(!q.result)continue;const r=q.result; // source fixtures are regenerated independently below
}
const rect=g=>[[0,0],[20,0],[20,g],[0,g]];const scenes=[['wall-1.7',[rect(1.7)]],['thin-0.69',[rect(.69)]],['wide-1.41',[rect(1.41)]],['wedge-dyadic',[[[0,-.34375],[20,-.703125],[20,.703125],[0,.34375]]]],['fork',[[[0,0],[12,0],[12,1],[7,1],[7,8],[6,8],[6,1],[0,1]]]],['ring-1.41',[rect(12),[[1.41,1.41],[1.41,10.59],[18.59,10.59],[18.59,1.41]]]]];
const split=r=>r.flatMap((a,i)=>[a,a.map((v,k)=>(v+r[(i+1)%r.length][k])/2)]);
for(const [name,rings]of scenes){const a=core.sliceContours(rings,1,2);for(let level=1;level<=3;level++){let input=rings;for(let i=0;i<level;i++)input=input.map(split);const t=performance.now(),b=core.sliceContours(input,1,2),wallMS=performance.now()-t;assert.deepEqual(b.geometry,a.geometry);assert.equal(b.maximumSourceDeviationMM,0);assert.deepEqual(b.source,input);assert.equal(b.sourceEdgeChains.flat(2).length,input.flat().length);assertions+=4;rows.push({name,level,status:b.geometry.status,contourAdapterWallMS:wallMS});}}
for(const W of [.5,1,2])for(const count of [1,2,3,7])for(const reversed of [false,true]){
 const ring=[[0,-.34375],[20,-.703125],[20,.703125],[0,.34375]].map(p=>p.map(v=>v*W));if(reversed)ring.reverse();const a=core.sliceContours([ring],W,count),b=core.sliceContours([split(ring)],W,count);assert.deepEqual(b.geometry,a.geometry);assert.equal(b.maximumSourceDeviationMM,0);assertions+=2;rows.push({name:'dyadic-scale-count-direction',W,count,reversed,status:b.geometry.status});
}
const wall=core.sliceContours([rect(1.7)],1,2).geometry;assert(Math.abs(wall.pathVertexMetadata[0][0].feedWidth-1)<1e-12);assert(Math.abs(wall.pathVertexMetadata[1][0].feedWidth-.7)<1e-12);assertions+=2;
// Almost collinear points must remain; reversing spikes must remain; duplicates are diagnosed.
assert.equal(canonicalRing([[0,0],[1,1e-15],[2,0],[2,2],[0,2]]).ring.length,5);assert.equal(canonicalRing([[0,0],[2,0],[1,0],[2,2],[0,2]]).ring.length,5);assert.throws(()=>canonicalRing([[0,0],[0,0],[1,1]]));assertions+=3;
(async()=>{let calls=0;const scheduler={run:async(job,fn)=>{calls++;await new Promise(r=>setImmediate(r));return fn();}};await sliceWithScheduler(core,{rings:[rect(1.7)],W:1,count:2},scheduler);assert.equal(calls,1);await assert.rejects(sliceWithScheduler(core,{rings:[]},scheduler,{aborted:true}));assertions+=2;fs.writeFileSync(path.join(__dirname,'../evidence/regression.json'),JSON.stringify({pass:true,assertions,rows,scope:'contour adapter including exact normalization and placement; excludes mesh sectioning, commands, UI and paint'},null,2));console.log('PASS',assertions,'assertions',rows.length,'retessellation cases');})();



