const {load}=require('../core/adapter.cjs');const fs=require('fs');const {placement}=load();
const split=r=>r.flatMap((a,i)=>[a,a.map((v,k)=>(v+r[(i+1)%r.length][k])/2)]);
const rect=g=>[[0,0],[20,0],[20,g],[0,g]];
const wedge=[[0,-.345],[20,-.705],[20,.705],[0,.345]];
const cases=[['wall-1.7',[rect(1.7)]],['thin-0.69',[rect(.69)]],['wide-1.41',[rect(1.41)]],['wedge',[wedge]],['triangle',[[[0,0],[20,0],[0,6]]]],['ring-1.41',[rect(12),[[1.41,1.41],[1.41,10.59],[18.59,10.59],[18.59,1.41]]]],['fork',[[[0,0],[12,0],[12,1],[7,1],[7,8],[6,8],[6,1],[0,1]]]]];
let rows=[];for(const [name,rings] of cases)for(const dense of [false,true]){let input=dense?rings.map(split):rings;let t=performance.now();try{const q=placement(input,1,2);rows.push({name,dense,wallMS:performance.now()-t,status:q.status,reason:q.reason,paths:q.paths?.length,widths:q.pathVertexMetadata?.map(v=>v.map(x=>x.feedWidth)),result:q});}catch(e){rows.push({name,dense,error:e.stack});}}
fs.writeFileSync(require('path').join(__dirname,'../evidence/baseline.json'),JSON.stringify(rows,null,2));console.log(rows.map(({result,widths,...r})=>r));
