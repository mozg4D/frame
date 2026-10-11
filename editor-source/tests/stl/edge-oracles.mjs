import assert from 'node:assert/strict';
import {fixtures} from './edge-fixtures.mjs';
import {polygonCreaseData} from './fixtures/stock-stl-oracle.mjs';
import {helpers as actual,helper as helpers,preEdgeHelper as baseline,sourceResult} from './source-loader.mjs';
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b);};
function load(candidate,options={}){let code=candidate?helpers:baseline;const record={lookups:[],pairs:[],joins:[],before:null,after:null,next:null,table:null};
 if(candidate)code=replace(code,'edges=new frameSTLEdgeTable(coordCount,{initialCapacity:frameSTLEdgeCapacity(faces)});','edges=new frameSTLEdgeTable(coordCount,{initialCapacity:frameSTLEdgeCapacity(faces),...options});');
 const look=candidate?'const edge=edges.locate(ca,cb),head=edges.head(edge);':'const edge=key(ca,cb),head=edges.get(edge);';
 code=replace(code,look,look+'record.lookups.push([f,k,ca,cb,head??-1]);');code=replace(code,'const other=Math.floor(e/3),o=other*3;','record.pairs.push([i,e]);const other=Math.floor(e/3),o=other*3;');code=replace(code,'const join=(a,b)=>{','const join=(a,b)=>{record.joins.push([a,b]);');code=replace(code,'edges.clear();','record.before=Array.from(parent);record.next=Array.from(next);record.table=edges.stats?{...edges.stats}:null;edges.clear();');code=replace(code,'return {positions:outP.slice','record.after=Array.from(parent);return {positions:outP.slice');return {fn:new Function('options','record',code+';return frameSTLCreaseData;')(options,record),record};}
const compare=(a,b)=>{for(const key of['positions','normals','indices'])assert.deepEqual(Buffer.from(a[key].buffer,a[key].byteOffset,a[key].byteLength),Buffer.from(b[key].buffer,b[key].byteOffset,b[key].byteLength));};
const report={pass:false,candidateEditorSHA256:sourceResult.editorSHA256,privateGeometryIncluded:false,syntheticSourceGate:true,fixtures:[],PNIComparisons:0,traceComparisons:0,allocationFaultChecks:0};
for(const input of fixtures()){const stock1=polygonCreaseData(input.positions,input.index,input.cos,null,1,false,true),stock2=polygonCreaseData(stock1.positions,stock1.indices,input.cos,null,1,false,true),bs=[load(false),load(false)];bs[0].fn(input.positions,input.index,input.cos,null,1,false,true);bs[1].fn(stock1.positions,stock1.indices,input.cos,null,1,false,true);const rows=[];
 for(const[name,options]of[['production-policy',{}],['forced-collision',{hash:()=>0,initialCapacity:16,maxCapacity:2048}],['bounded-fallback',{hash:()=>0,initialCapacity:8,maxCapacity:32}]]){let previous=null;const tables=[];for(let pass=0;pass<2;pass++){const c=load(true,options),result=c.fn(pass?previous.positions:input.positions,pass?previous.indices:input.index,input.cos,null,1,false,true);compare(result,pass?stock2:stock1);report.PNIComparisons++;for(const key of['lookups','pairs','joins','before','after','next'])assert.deepEqual(c.record[key],bs[pass].record[key],input.name+' '+name+' '+pass+' '+key);report.traceComparisons++;tables.push(c.record.table);previous=result;}rows.push({name,tables});}
 report.fixtures.push({name:input.name,rows});}
// Allocation fault gates use the exact candidate class and hash. Fail initial
// allocation and a grow allocation independently, preserving existing heads.
for(const failAt of[1,2,3,4,5,6]){let calls=0;const Native=Uint32Array;function Failing(n){if(++calls===failAt)throw new RangeError('controlled allocation pressure');return new Native(n);}const Table=new Function('Uint32Array',actual.frameSTLEdgeHash.toString()+'\n'+actual.frameSTLEdgeTable.toString()+';return frameSTLEdgeTable;')(Failing),t=new Table(200,{initialCapacity:4,maxCapacity:16,hash:()=>0});for(let i=0;i<30;i++){const slot=t.locate(i,i+1);assert.equal(t.head(slot)??-1,-1);t.set(slot,i);}for(let i=0;i<30;i++)assert.equal(t.head(t.locate(i+1,i)),i);assert.equal(t.stats.fallbacks,1);report.allocationFaultChecks++;}
report.largeCoordinateCountChecks=[];
for(const coordCount of [94906265,94906266,0x100000000]){
 const t=new actual.frameSTLEdgeTable(coordCount,{initialCapacity:4,maxCapacity:8,hash:()=>0});
 const pairs=[[0,1],[0,coordCount-1],[1,coordCount-1],[coordCount-2,coordCount-1],[7,19],[12,17],[2,3]];
 for(let i=0;i<pairs.length;i++){const slot=t.locate(...pairs[i]);assert.equal(t.head(slot)??-1,-1);t.set(slot,i);}
 for(let i=0;i<pairs.length;i++)assert.equal(t.head(t.locate(...pairs[i].slice().reverse())),i);
 assert.equal(t.stats.fallbacks,1);for(const [a,b]of pairs){if(coordCount<=94906265)assert.equal(BigInt(t.key(a,b)),BigInt(a)*BigInt(coordCount)+BigInt(b));else assert.equal(t.key(a,b),a+':'+b);}report.largeCoordinateCountChecks.push(coordCount);
}
const edge=new actual.frameSTLEdgeTable(4),slot=edge.locate(0,1);edge.set(slot,0x7fffffff);assert.equal(edge.head(slot),0x7fffffff);
for(const bad of [-1,.5,0x80000000])assert.throws(()=>edge.set(slot,bad),/signed Int32/);
report.cornerDomain='existing signed Int32 domain, head+1 exact';
for(const faces of [0,1,7,8,100,1571149,715827882]){
 const c=actual.frameSTLEdgeCapacity(faces),estimate=Math.min(4194304,Math.ceil(faces*15/7));
 assert(c>=16&&c<=4194304&&(c&(c-1))===0);assert(c>=estimate);if(c>16)assert(c/2<estimate);
}
assert.equal(actual.frameSTLEdgeCapacity(1571149),4194304);
assert(BigInt(94906265)**2n-1n<=BigInt(Number.MAX_SAFE_INTEGER));assert(BigInt(94906266)**2n-1n>BigInt(Number.MAX_SAFE_INTEGER));
report.nonAllocationErrorChecks=0;
for(const failAt of [2,5]){let calls=0;const error=new TypeError('controlled nonallocation error');function Failing(n){if(++calls===failAt)throw error;return new Uint32Array(n);}
 const Table=Function('Uint32Array',actual.frameSTLEdgeHash.toString()+'\n'+actual.frameSTLEdgeTable.toString()+';return frameSTLEdgeTable;')(Failing);let t;
 assert.throws(()=>{t=new Table(100,{initialCapacity:4,maxCapacity:16});for(let i=0;i<3;i++)t.set(t.locate(i,i+1),i);},e=>e===error);
 if(t){assert.equal(t.capacity,4);assert.equal(t.head(t.locate(0,1)),0);assert.equal(t.head(t.locate(1,2)),1);assert.equal(t.stats.fallbacks,0);}report.nonAllocationErrorChecks++;
}
report.pass=true;
export default report;
