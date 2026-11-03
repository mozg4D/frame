// CPU arrangement audit with an independent 2D clipping/volume oracle.
// Completion and explicit rejection remain separate outcomes. GPU/editor
// completion is measured by unite-run.mjs and unite-benchmark.mjs instead.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {meshMetrics,boundaryOracle,occupancyOracle} from './unite-fixtures.mjs';

export async function uniteCellRegressions(){
 const started=performance.now(),source=await readFile(new URL('../index.html',import.meta.url)),body=source.toString('utf8').match(/<script id="frame-boolean-worker" type="text\/plain">([\s\S]*?)<\/script>/)[1],K=Function('self','postMessage',body+'\nreturn {unitePrepare,uniteSplit,uniteFinish};')({},()=>{}),ring=[[3,0],[2,2],[0,3],[-2,2],[-3,0],[-2,-2],[0,-3],[2,-2]],tetra=(u,v)=>({vertices:[0,0,-1,0,0,1,...u,0,...v,0],indices:[0,1,2,0,3,1,0,2,3,1,3,2]}),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;
 const clip=(a,b)=>{let p=a;for(let j=0;j<3;j++){const q=[];for(let i=0;i<p.length;i++){const x=p[i],y=p[(i+1)%p.length],dx=cross(b[j],b[(j+1)%3],x),dy=cross(b[j],b[(j+1)%3],y);if(dx>=0)q.push(x);if(dx<0&&dy>0||dx>0&&dy<0){const t=dx/(dx-dy);q.push(x.map((v,k)=>v+(y[k]-v)*t));}}p=q;}return area(p);},results=[],checks=[];
 for(let j=0;j<8;j++)for(let width=1;width<=3;width++)for(const fillRule of ['union','even-odd'])for(const sameOwner of [false,true]){
  // One-owner identical faces are explicitly idempotent, rather than two
  // historical bodies whose interiors could cancel under global parity.
  if(sameOwner&&j===0&&width===2)continue;
  const a=[[0,0],ring[0],ring[2]],b=[[0,0],ring[j],ring[(j+width)%8]],expectedVolume=(area(a)+area(b)-(fillRule==='even-odd'?2:1)*clip(a,b))*2/3,positions=[],indices=[],owners=[];
  for(const [k,t]of [tetra(a[1],a[2]),tetra(b[1],b[2])].entries()){const base=positions.length/3;positions.push(...t.vertices);indices.push(...t.indices.map(x=>x+base));owners.push(...Array(4).fill(sameOwner?0:k));}
  const row={j,width,fillRule,sameOwner,expectedVolume},input={positions:Float32Array.from(positions),indices:Uint32Array.from(indices),faceOwners:Uint32Array.from(owners),fillRule},before=JSON.stringify(input);
  try{
   const p=K.unitePrepare(input),pairs=[];for(let x=0;x<p.indices.length/3;x++)for(let y=x+1;y<p.indices.length/3;y++)pairs.push(x,y);const s=K.uniteSplit({pairs:Uint32Array.from(pairs)}),r=K.uniteFinish({decisions:new Uint32Array(s.queryCount).fill(3)}),geometry={vertices:Array.from(r.positions),indices:Array.from(r.indices)},metrics=meshMetrics(geometry),fixture={bounds:{min:[Math.min(...a.map(p=>p[0]),...b.map(p=>p[0])),Math.min(...a.map(p=>p[1]),...b.map(p=>p[1])),-1],max:[Math.max(...a.map(p=>p[0]),...b.map(p=>p[0])),Math.max(...a.map(p=>p[1]),...b.map(p=>p[1])),1]},inside:p=>{const h=1-Math.abs(p[2]);if(h<=0)return false;const q=[p[0]/h,p[1]/h],contains=T=>T.every((v,k)=>cross(v,T[(k+1)%3],q)>0),first=contains(a),second=contains(b);return fillRule==='union'?first||second:first!==second;}},orientation=metrics.triangles?boundaryOracle(geometry,fixture):{pass:expectedVolume===0},occupancy=occupancyOracle(geometry,fixture,{count:64});
   Object.assign(row,{outcome:'completed',actualVolume:metrics.signedVolume,triangles:metrics.triangles,volumeError:Math.abs(metrics.signedVolume-expectedVolume),orientation,occupancy,pass:Math.abs(metrics.signedVolume-expectedVolume)<1e-5&&metrics.finite&&metrics.indicesValid&&metrics.boundaryEdges===0&&metrics.inconsistentEdges===0&&metrics.degenerate===0&&orientation.pass&&occupancy.pass});
  }catch(error){Object.assign(row,{outcome:'rejected',error:error.message,sourceUnchanged:JSON.stringify(input)===before,pass:JSON.stringify(input)===before&&/precision limit:|no closed volume remains/.test(error.message)});}
  results.push(row);checks.push({name:`Shared-edge cell ${j}/${width}/${fillRule}/${sameOwner}`,pass:row.pass,detail:row});
 }
 const completed=results.filter(r=>r.outcome==='completed').length,rejected=results.length-completed,ms=performance.now()-started;
 checks.push({name:'Shared-edge family retains at least 78 completed correct volumes',pass:completed>=78,detail:{completed,rejected}},{name:'Completed CPU regression-family latency',pass:ms<2000,detail:{ms,limit:2000}});
 return{pass:checks.every(c=>c.pass),indexSHA256:createHash('sha256').update(source).digest('hex'),method:'Production worker with exhaustive triangle pairs and Float64 side decisions; independent test-only 2D convex clipping gives exact cross-section volumes. Not a completed GPU/editor benchmark.',completed,rejected,checks,results,ms};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await uniteCellRegressions();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/unite-cells.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,completed:result.completed,rejected:result.rejected,ms:result.ms,failures:result.checks.filter(c=>!c.pass)},null,2));process.exitCode=result.pass?0:1;}
