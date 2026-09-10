// Verify the actual generated worker program without DOM, network or modules.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function section(a,b){const start=html.indexOf(a);assert(start>=0,a);const end=html.indexOf(b,start);assert(end>start,b);return html.slice(start,end);}
const factories=section('function createFrameSurfaceKernel()', 'const FrameSurfaceKernel=')
 +section('function createFrameCageCells()', 'const FrameCageCells=')
 +section('function createSplineSurfaceBuilder(', 'const buildSplineSurface=')
 +section('function prepareSplineBVH(', 'const splineSurfaceWorkers=');
const pool=section('const splineSurfaceWorkers=', 'async function buildSplineSurfaceAsync(');
const start=pool.indexOf('    const source=`'),end=pool.indexOf('\n    url=URL.createObjectURL',start);
const source=new Function(factories+pool.slice(start,end)+';return source;')();
assert(!/\bimport\s|\bimportScripts\s*\(|\bfetch\s*\(/.test(source),'worker must not load dependencies');
assert(!/type:\s*['"]module/.test(pool),'worker must be classic');
let reply;
const context=vm.createContext({self:{postMessage:value=>{reply=value;}},performance});
vm.runInContext(source,context);
const vertices={a:[0,0,0],b:[10,0,0],c:[10,10,0],d:[0,10,0],e:[3,3,0],f:[7,3,0],g:[7,7,0],h:[3,7,0]};
const segments={};const loop=ids=>ids.map((a,i)=>{const b=ids[(i+1)%ids.length],id=a+b;segments[id]={id,a,b,ha:[0,0,0],hb:[0,0,0]};return {edge:id,reversed:false};});
const loops=[loop(['a','b','c','d']),loop(['e','h','g','f'])],samples={};
for(const e of Object.values(segments))samples[e.id]=[{t:0,position:vertices[e.a],exactTangent:[1,0,0]},{t:1,position:vertices[e.b],exactTangent:[1,0,0]}];
context.self.onmessage({data:{id:1,kind:'cell',data:{vertices,segments},fill:{planar:true,sides:8,loops},angle:10,samples}});
assert(!reply.error,reply.error);assert(reply.value.indices.length>0);
let area=0;const {positions:p,indices:ix}=reply.value;
for(let i=0;i<ix.length;i+=3){const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;area+=Math.abs((p[b]-p[a])*(p[c+1]-p[a+1])-(p[b+1]-p[a+1])*(p[c]-p[a]))/2;}
assert.equal(area,84,'hole must remain unfilled');
console.log('PASS: actual classic worker starts without DOM/network/imports; planar cell with hole has exact area 84.');

// Deferred repair must reuse the computed mesh, preserve its boundary and avoid a second front build.
(async()=>{
 const core=section('var v3 =','function approximateSpline(');
 const api=new Function(factories+core+';return {resolver:createFrameCageCells(),builder:createSplineSurfaceBuilder(createFrameSurfaceKernel(),createFrameCageCells(),createSplinePlanarTools()),sample:sampleSplineSegment};')();
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/deformed-sphere.json'),'utf8'));data.vertices.v3[1]=-49.9;
 const cells=api.builder.resolve(data),samples=Object.fromEntries(Object.keys(data.segments).map(id=>[id,api.sample(data,id)]));let deferred=0,changed=0;
 for(let i=0;i<cells.fills.length;i++){
  const ticket=100+i;await context.self.onmessage({data:{id:ticket,owner:7,ticket,kind:'cell',data,fill:cells.fills[i],angle:10,samples,creaseCos:Math.cos(Math.PI/4)}});assert(!reply.error,reply.error);
  if(!reply.value.refinable)continue;deferred++;
  const before=vm.runInContext('retained.get('+ticket+')',context),positions=Array.from(before.positions),boundary=JSON.stringify(before.boundary);
  // Fail loudly if refinement attempts to generate another cell/front.
  vm.runInContext('savedBuildCell=builder.cell;builder.cell=()=>{throw Error("front rebuilt during refinement")}',context);
  await context.self.onmessage({data:{id:1000+ticket,owner:7,ticket:1000+ticket,sourceTicket:ticket,kind:'refine',creaseCos:Math.cos(Math.PI/4)}});
  vm.runInContext('builder.cell=savedBuildCell',context);assert(!reply.error,reply.error);
  if(!reply.value.unchanged){changed++;const after=vm.runInContext('retained.get('+(1000+ticket)+')',context);assert.deepEqual(Array.from(after.positions),positions);assert.equal(JSON.stringify(after.boundary),boundary);assert.equal(after.indices.length,before.indices.length);}
 }

 // Exercise the real worker ticket transport, not just the assembler directly.
 const tickets=[];
 for(let i=0;i<cells.fills.length;i++){
  const ticket=2000+i;await context.self.onmessage({data:{id:ticket,owner:9,ticket,kind:'cell',data,fill:cells.fills[i],angle:10,samples,creaseCos:Math.cos(Math.PI/4)}});assert(!reply.error,reply.error);tickets.push(reply.value);
 }
 await context.self.onmessage({data:{id:3000,owner:9,kind:'assemble',cells,tickets,creaseCos:Math.cos(Math.PI/4),baseGeneration:0}});assert(!reply.error,reply.error);assert.equal(reply.value.chunks.filter(c=>c.positions).length,cells.fills.length);let generation=reply.value.chunkGeneration;
 const ticket=4000;await context.self.onmessage({data:{id:ticket,owner:9,ticket,kind:'cell',data,fill:cells.fills[0],angle:10,samples,creaseCos:Math.cos(Math.PI/4)}});tickets[0]=reply.value;
 await context.self.onmessage({data:{id:4001,owner:9,kind:'assemble',cells,tickets,creaseCos:Math.cos(Math.PI/4),baseGeneration:generation}});assert(!reply.error,reply.error);assert.equal(reply.value.chunks.filter(c=>c.positions).length,1,'changed ticket must upload exactly one new cell');
 console.log('PASS: actual worker transport preserves cell versions and uploads changed geometry.');
 assert(deferred>0,'fixture must exercise deferred quality');assert.equal(changed,0,'deferred checks must not change diagonals');
 // A successful no-swap QA pass updates metadata without retransmitting geometry.
 await context.self.onmessage({data:{id:5000,owner:11,ticket:5000,kind:'cell',data:{vertices,segments},fill:{planar:false,sides:4,loops:[loops[0]]},angle:10,samples:Object.fromEntries(Object.values(segments).map(e=>[e.id,[{t:0,position:vertices[e.a]},{t:1,position:vertices[e.b]}]])),creaseCos:Math.cos(Math.PI/4)}});
 assert(!reply.error,reply.error);assert(reply.value.refinable);const same=vm.runInContext('retained.get(5000).positions',context);
 await context.self.onmessage({data:{id:5001,owner:11,ticket:5001,sourceTicket:5000,kind:'refine',creaseCos:Math.cos(Math.PI/4)}});
 assert(!reply.error,reply.error);assert(reply.value.unchanged);assert.equal(reply.value.report.qualityStage,'refined');assert.equal(vm.runInContext('retained.get(5000).positions',context),same);assert.equal(vm.runInContext('retained.get(5000).report.qualityStage',context),'refined');
 await context.self.onmessage({data:{kind:'trimQuality',owner:7,keep:[]}});await context.self.onmessage({data:{kind:'trimQuality',owner:9,keep:[]}});assert.equal(vm.runInContext('qualities.size',context),0);
 console.log('PASS: '+deferred+' deferred cells; '+changed+' refined without another front build; boundaries preserved; retained quality data released.');
})().catch(e=>{console.error(e);process.exitCode=1;});
