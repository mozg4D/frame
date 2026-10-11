import vm from 'node:vm';
import assert from 'node:assert/strict';
import {loadInputs,sha} from '../inputs.mjs';
const {baseline,candidate,baseSource,candidateSource,sourceHashes}=await loadInputs();
const compactStart=candidateSource.indexOf('function* compactEdgePickerTablesWork(');
const compactEnd=candidateSource.indexOf('\nclass NativeEdgeTableCache',compactStart);
assert.ok(compactStart>=0&&compactEnd>compactStart,'Actual compact declarations are present');
const declarations=candidateSource.slice(compactStart,compactEnd);
const context={Uint32Array,Number,Map,Math,Object,fail:m=>{throw Error(m);}};
const {compactEdgePickerTablesWork,materializeEdgePickerGroup}=vm.runInNewContext(declarations+'\n({compactEdgePickerTablesWork,materializeEdgePickerGroup})',context);
const normalize=x=>JSON.parse(JSON.stringify(x));
const drain=g=>{let steps=0;for(;;){const q=g.next();if(q.done)return {value:q.value,steps};steps++;}};
const fixture=(n,edges,group)=>({vertexCount:n,edges:Uint32Array.from(edges),group:Uint32Array.from(group??Array.from({length:n},(_,i)=>i))});
// Independent oracle deliberately has no numeric packed key and no typed offset table.
function stringOracle(t){
 const map=new Map(),groups=[];
 for(let i=0;i<t.edges.length;i+=2){
  const a=t.edges[i],b=t.edges[i+1],ga=t.group[a],gb=t.group[b];
  const key=ga<=gb?`${ga}:${gb}`:`${gb}:${ga}`;
  if(!map.has(key)){map.set(key,groups.length);groups.push({a,b,rawEdgeIds:[],keys:[]});}
  const q=groups[map.get(key)];q.rawEdgeIds.push(i/2);q.keys.push(a<=b?`${a}:${b}`:`${b}:${a}`);
 }
 return {pairs:Uint32Array.from(groups.flatMap(q=>[q.a,q.b])),groups};
}
let fixtures=0,groupsChecked=0,aliasesChecked=0,cooperativeYields=0;
function check(t,label,batch=7){
 const stock=drain(baseline.edgePickerTablesWork(t,{batch})).value,independent=stringOracle(t);
 assert.deepEqual(stock,independent,label+' stock/string oracle');
 const {value:compact,steps}=drain(compactEdgePickerTablesWork(t,{batch}));
 assert.deepEqual(compact.pairs,stock.pairs,label+' pairs');
 assert.equal(compact.offsets.length,stock.groups.length+1,label+' offset length');
 assert.equal(compact.offsets[0],0,label+' offset start');
 assert.equal(compact.offsets.at(-1),t.edges.length/2,label+' complete offset range');
 assert.equal(compact.rawEdgeIds.length,t.edges.length/2,label+' alias count');
 assert.equal(compact.sourceEdges,t.edges,label+' direct generator raw source');
 assert.equal(Object.isFrozen(compact),true,label+' descriptor');
 for(let i=0;i<stock.groups.length;i++){
  const got=normalize(materializeEdgePickerGroup(compact,i));
  assert.deepEqual(got,stock.groups[i],label+' group '+i);
  // Legacy compatibility branch returns the exact legacy group object.
  assert.equal(materializeEdgePickerGroup(stock,i),stock.groups[i]);
  groupsChecked++;aliasesChecked+=got.rawEdgeIds.length;
 }
 fixtures++;cooperativeYields+=steps;return {compact,stock};
}
const sections=[];
let before=fixtures;
check(fixture(0,[]),'empty');
check(fixture(1,[0,0,0,0,0,0],[0]),'one vertex repeated self-edge',1);
check(fixture(6,[5,4,2,3,1,0,4,5,3,2,0,1,4,4,0,0,2,2],[0,1,0,1,0,1]),'orientation first representative and alias interleave',1);
check(fixture(6,[5,4,2,3,1,0,4,5,3,2,0,1,4,4,0,0,2,2],[4294967295,4294967294,4294967295,4294967294,4294967295,4294967294]),'uint32 group IDs beyond vertex count',2);
const offsetEdges=new Uint32Array([999,999,3,2,1,0,2,3,999,999]).subarray(2,8);
const offsetGroups=new Uint32Array([999,0,1,0,1,999]).subarray(1,5);
check({vertexCount:4,edges:offsetEdges,group:offsetGroups},'nonzero typed-array byte offsets');
sections.push({name:'hand-built degenerate, alias orientation, out-of-range logical IDs and offset views',fixtures:fixtures-before,pass:true});

before=fixtures;
for(const ga of [0,1,2,4294967295])for(const gb of [0,1,2,4294967295]){
 for(let len=0;len<=5;len++)for(let seq=0;seq<4**len;seq++){
  let code=seq;const edges=[];for(let k=0;k<len;k++){const e=code%4;code=Math.floor(code/4);edges.push(e>>1,e&1);}
  check(fixture(2,edges,[ga,gb]),`exhaustive two vertices ${ga},${gb}/${len}/${seq}`,3);
 }
}
for(let g=0;g<27;g++)for(let seq=0;seq<729;seq++){
 let code=seq;const edges=[];for(let k=0;k<3;k++){const e=code%9;code=Math.floor(code/9);edges.push(Math.floor(e/3),e%3);}
 check(fixture(3,edges,[g%3,Math.floor(g/3)%3,Math.floor(g/9)]),`exhaustive three vertices ${g}/${seq}`,2);
}
sections.push({name:'exhaustive two/three-vertex logical partitions and edge encounter order',fixtures:fixtures-before,pass:true});

before=fixtures;let rng=0x76319bd;
const random=n=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return (rng>>>0)%n;};
for(let i=0;i<5000;i++){
 const n=1+random(128),e=random(512),group=Array.from({length:n},()=>{const mode=random(8);return mode===0?4294967295:mode===1?2147483648:mode===2?n+random(n+1):random(n);});
 const edges=Array.from({length:e*2},()=>random(n));
 check(fixture(n,edges,group),`deterministic adversarial random ${i}`,1+random(4096));
}
const denseEdges=[];for(let i=0;i<100003;i++)denseEdges.push(i%8,(i*3+1)%8);
check(fixture(8,denseEdges,[0,1,0,1,0,1,0,1]),'100003 interleaved aliases spanning many cooperative batches',4096);
sections.push({name:'deterministic adversarial random and long interleaved alias run',fixtures:fixtures-before,pass:true});

before=fixtures;
const precisionRows=[];
// Large valid Uint32Array lengths are zero-initialized virtual storage. These tests
// exercise the real generator and its shape-validated stock oracle without
// copying/scanning the unreferenced hundreds of MB through the cache wrapper.
for(const n of [94906264,94906265,94906266]){
 const group=new Uint32Array(n);group.set([n-1,n-2,n-3,n-4,0,1,4294967295,4294967294]);
 const edges=Uint32Array.from([0,0,1,0,0,1,1,1,2,0,0,2,3,0,4,5,5,4,6,7,7,6,0,6,6,0]);
 const {stock}=check({vertexCount:n,group,edges},`numeric pair safety threshold ${n}`,2);
 const maximum=(BigInt(n)-1n)*BigInt(n)+BigInt(n)-1n;
 if(n<=94906265)assert.ok(maximum<=BigInt(Number.MAX_SAFE_INTEGER));
 else assert.ok(maximum>BigInt(Number.MAX_SAFE_INTEGER));
 precisionRows.push({vertexCount:n,numericGuard:n<=94906265,maximumPairKey:maximum.toString(),groups:stock.groups.length});
}
sections.push({name:'actual numeric-key threshold and string fallback with valid large typed-array shape',fixtures:fixtures-before,precisionRows,pass:true});

before=fixtures;
const meshInputs=[
 {name:'nonmanifold shared edge, opposite winding, duplicate face and degenerate triangles',xyz:[0,0,0,1,0,0,0,1,0,0,-1,0,0,0,1],indices:[0,1,2,1,0,3,0,1,4,0,1,2,0,0,1,1,1,1]},
 {name:'quantization threshold and negative zero',xyz:[1.000004999,0,-0,1.000005001,0,0,0,1,0,-.000004999,0,0,-.000005001,0,0,0,0,1],indices:[0,2,3,1,2,4,0,1,5]},
 {name:'Float64 distinguishable vertices collapse in Float32',xyz:[16777216,0,0,16777217,0,0,16777218,0,0,0,1,0],indices:[0,1,3,1,2,3]},
 {name:'large finite quantization fallback',xyz:[1e100,0,0,1e100,0,0,-1e100,1,0,0,0,0],indices:[0,2,3,1,2,3]},
 {name:'unindexed raw alias corners',xyz:[0,0,0,1,0,0,0,1,0,1,0,0,0,0,0,0,-1,0],indices:null}
];
const floatRows=[];
for(const m of meshInputs)for(const Type of [Float32Array,Float64Array]){
 const positions=Type.from(m.xyz);if(!positions.every(Number.isFinite))continue;
 const input={positions,indices:m.indices?Uint32Array.from(m.indices):null};
 for(const packedTables of [false,true]){
  const topology=drain(baseline.buildTopologyWork(input,{batch:2,packedTables})).value;
  const actualTopology=drain(candidate.buildTopologyWork(input,{batch:2,packedTables})).value;
  // r241 adds this metadata; all previously reviewed topology fields stay exact.
  const {edgeFirstCorners,...legacyFields}=actualTopology;
  assert.ok(edgeFirstCorners instanceof Uint32Array,'r241 first-corner metadata type');
  assert.equal(edgeFirstCorners.length,topology.edgeCount,'r241 first-corner metadata shape');
  assert.deepEqual(legacyFields,topology,'all legacy topology fields unchanged');
  const {stock}=check(topology,`${m.name}/${Type.name}/packed:${packedTables}`,2);
  floatRows.push({name:m.name,type:Type.name,packedTables,groups:Array.from(topology.group),rawEdges:topology.edges.length/2,pickerGroups:stock.groups.length});
 }
}
assert.notDeepEqual(floatRows.find(x=>x.name.includes('distinguishable')&&x.type==='Float32Array').groups,floatRows.find(x=>x.name.includes('distinguishable')&&x.type==='Float64Array').groups,'fixture genuinely distinguishes Float32 and Float64');
sections.push({name:'source-precision, nonmanifold and degenerate topology with exact legacy-field parity',fixtures:fixtures-before,rows:floatRows,pass:true});

const host=()=>({state:'ready',renderDomain:'canonical',epoch:1,jobs:new Set(),release(){},releaseDepth(){}});
const malformed=[
 ['missing topology',undefined],['null topology',null],['missing fields',{}],
 ['array edges',{vertexCount:2,group:new Uint32Array(2),edges:[0,1]}],
 ['uint16 edges',{vertexCount:2,group:new Uint32Array(2),edges:new Uint16Array([0,1])}],
 ['array group',{vertexCount:2,group:[0,1],edges:new Uint32Array([0,1])}],
 ['float64 group',{vertexCount:2,group:new Float64Array([0,1]),edges:new Uint32Array([0,1])}],
 ['odd edges',{vertexCount:2,group:new Uint32Array(2),edges:new Uint32Array([0])}],
 ['group length mismatch',{vertexCount:2,group:new Uint32Array(1),edges:new Uint32Array()}],
 ['negative vertex count',{vertexCount:-1,group:new Uint32Array(),edges:new Uint32Array()}],
 ['noninteger vertex count',{vertexCount:1.5,group:new Uint32Array(1),edges:new Uint32Array()}],
 ['NaN vertex count',{vertexCount:NaN,group:new Uint32Array(),edges:new Uint32Array()}],
 ['string vertex count',{vertexCount:'0',group:new Uint32Array(),edges:new Uint32Array()}],
 ['outside endpoint',fixture(2,[0,2])],['uint32 maximum endpoint',fixture(2,[0,4294967295])],['edge with zero vertices',fixture(0,[0,0])]
];
const errorRows=[];
for(const [label,t]of malformed){
 let old;try{drain(baseline.edgePickerTablesWork(t));}catch(e){old=e;}
 assert.ok(old,label+' stock rejects');
 const owner=new candidate.FrameNativePickers(host());let got;
 try{await owner.edgeTableCache.get(t);}catch(e){got=e;}
 assert.ok(got,label+' cache rejects');assert.equal(got.name,old.name,label+' exception class');assert.equal(got.message,old.message,label+' exception message');
 assert.equal(owner.edgeTableCache.retainedBytes,0,label+' no retention');await owner.dispose();
 errorRows.push({name:label,error:got.name,message:got.message});
}
sections.push({name:'malformed input via actual public owner/cache matches stock rejection',cases:errorRows.length,rows:errorRows,pass:true});

let integrated=0;
for(let i=0;i<100;i++){
 const n=1+random(64),edges=Array.from({length:random(256)*2},()=>random(n)),t=fixture(n,edges,Array.from({length:n},()=>random(3)?random(n):4294967295));
 const owner=new candidate.FrameNativePickers(host()),cached=await owner.edgeTableCache.get(t),expected=drain(baseline.edgePickerTablesWork(t)).value;
 assert.deepEqual(cached.pairs,expected.pairs);for(let k=0;k<expected.groups.length;k++)assert.deepEqual(normalize(materializeEdgePickerGroup(cached,k)),expected.groups[k]);
 assert.equal(await owner.edgeTableCache.get(t),cached);assert.equal(owner.edgeTableCache.stats.hits,1);await owner.dispose();integrated++;
}
sections.push({name:'actual owner/cache integration and stable repeated hit',fixtures:integrated,pass:true});
const output={pass:true,sourceHashes,baselineSHA256:sha(baseSource),candidateSHA256:sha(candidateSource),declarationsSHA256:sha(declarations),fixtures,groupsChecked,aliasesChecked,cooperativeYields,sections,browserAcceptance:false,performanceMeasurement:false,notes:['Read-only execution; baseline reconstructed and hash-verified in memory from current production.','Arithmetic threshold fixtures run the actual private generator and original exported validation/oracle; cache integration separately uses ordinary-sized valid arrays.','The string-key oracle is independent of numeric-key and offset implementation.','Only the explicitly added edgeFirstCorners metadata is excluded from legacy topology equality; its typed shape is separately checked.']};
console.log(JSON.stringify(output,null,2));
