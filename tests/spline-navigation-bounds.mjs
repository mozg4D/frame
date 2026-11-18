// Exact owning navigation loop versus the same loop with its broadphase omitted.
// No browser/GPU, fixtures on disk, alternate sampling or polygon scene.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

function runtime(html){
 const a=html.indexOf('    const splineNavigationSampleBoxes='),b=html.indexOf('    function splineSnapPoint(',a),p=html.indexOf('    function projectSplineCached('),q=html.indexOf('    function curveReplicaDisplays(',p);assert(a>=0&&b>a&&p>=0&&q>p);
 const fm=html.indexOf('const FM='),FM=Function('return '+html.slice(fm+9,html.indexOf('\n    })();',fm)+11))();
 const env={scene:{center:[0,0,0],scale:1},splineDisplays:new Map(),viewIndex:0,shadingMode:'isoparms',elementMode:'object',selected:new Set(),projectionCalls:0,reference:false,navigationScene:null,FM,
  frameNodeByHash:hash=>({id:hash}),splineShown:d=>d.visible!==false,FrameSpline:{isEditable:()=>true},objectWorld:hash=>env.splineDisplays.get(hash).world,splineProjectionKey:()=>'',splineProjection:d=>d.cache,frameViewKind:()=>env.ortho?2:0,
  cameraRay:(x,y)=>env.ortho?{origin:[x,-y,3.2],direction:[0,0,-1]}:{origin:[0,0,3.2],direction:[x,-y,-1]}};
 let source=html.slice(p,q)+html.slice(a,b);assert.equal(source.split('if(!splineNavigationBoxHit(d,cache,x,y,8,undefined,true))continue;').length,2);
 source=source.replace('if(!splineNavigationBoxHit(d,cache,x,y,8,undefined,true))continue;','if(!reference&&!splineNavigationBoxHit(d,cache,x,y,8,undefined,true))continue;').replace('of navigationSegmentRows(d,cache,x,y)','of (reference?d.samples:navigationSegmentRows(d,cache,x,y))').replace('function projectedSplineSegment(cache,id,samples){','function projectedSplineSegment(cache,id,samples){projectionCalls++;');
 const api=Function('env',`with(env){${source};return {point:splineNavigationPoint,box:splineNavigationSampleBox,screen:splineNavigationScreenBox,hit:splineNavigationBoxHit,round:splineNavigationRound,project:projectSplineCached,tree:navigationTree,query:queryNavigationTree};}`)(env);
 const cache=(frame=FM.I(),options={})=>({frame,cx:0,cy:0,pixels:1,ortho:true,segments:new Map(),controls:new Map(),...options});
 const display=(hash,points,c=cache())=>({hash,world:c.frame,wireVersion:0,lineValues:new Float32Array(Math.max(0,points.length-1)*6),samples:new Map([['edge',points.map((position,i)=>({t:i/Math.max(1,points.length-1),position:[...position]}))]]),cache:c});
 const parity=(displays,x,y)=>{env.splineDisplays=new Map(displays.map(d=>[d.hash,d]));env.ortho=displays[0]?.cache.ortho;env.reference=true;env.projectionCalls=0;const original=api.point(x,y),before=env.projectionCalls;env.reference=false;env.projectionCalls=0;const fast=api.point(x,y),after=env.projectionCalls;assert.deepEqual(fast,original,'exact hash/segment/point/depth/distance');return {original,before,after};};
 return {api,env,FM,cache,display,parity};
}

export async function splineNavigationBoundsChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),f=runtime(html),checks=[],details={},check=(name,fn)=>{fn();checks.push({name,pass:true});};
 check('Median partitions retain authored hit order, tied boxes and conservative nonfinite leaves',()=>{
  const points=Array.from({length:8193},(_,i)=>[i%7===0?0:i%53,i%3===0?0:i%17,0]);points.at(-1)[0]=NaN;
  const rows=points.map((p,order)=>({min:p,max:p,order,value:order})),leaves=[];
  const tree=f.api.tree(rows.slice(),(node,entries)=>{assert(entries.length<=8);leaves.push(node);});
  assert.equal(leaves.reduce((sum,leaf)=>sum+leaf.rows.length,0),rows.length);
  for(const leaf of leaves){let depth=0;for(let n=leaf;n.parent;n=n.parent)depth++;assert(depth<=11);}
  for(let x=0;x<55;x+=3){
   const hit=b=>b.max[0]>=x&&b.min[0]<=x+4&&b.max[1]>=3&&b.min[1]<=11;
   const accepts=id=>!Number.isFinite(points[id][0])||hit(rows[id]);
   assert.deepEqual(f.api.query(tree,hit).filter(accepts),rows.map(r=>r.value).filter(accepts));
  }
 });
 check('Outward Float64 steps enclose the adjacent representable number including subnormals and cancellation scales',()=>{
  const data=new DataView(new ArrayBuffer(8)),adjacent=(value,up)=>{if(value===0)return up?Number.MIN_VALUE:-Number.MIN_VALUE;data.setFloat64(0,value);let bits=data.getBigUint64(0);bits+=(value>0)===up?1n:-1n;data.setBigUint64(0,bits);return data.getFloat64(0);};
  for(const n of [0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,1,-1,1e-300,-1e-300,1e20,-1e20,Number.MAX_VALUE,-Number.MAX_VALUE]){assert(f.api.round(n,1)>=adjacent(n,true));assert(f.api.round(n,-1)<=adjacent(n,false));}
 });
 check('Unclamped queries preserve exact hits outside each viewport edge and at the8CSS-pixel boundary',()=>{
  for(const points of [[[-12,0,0],[-10,0,0]],[[1010,0,0],[1012,0,0]],[[0,12,0],[0,10,0]],[[0,-1010,0],[0,-1012,0]]]){const d=f.display('outside',points);for(const offset of [-8,-7.999,0,7.999,8]){const p=new Float64Array(3);f.api.project(d.cache,points[0],p);const x=p[0]+(points[0][0]?offset:0),y=p[1]+(points[0][0]?0:offset);f.parity([d],x,y);}}
 });
 check('Bounds use actual double samples rather than scaled-handle extents or Float32 line copies',()=>{
  const d=f.display('double',[[1e12+.125,40,0],[1e12+.5,40,0]],f.cache(f.FM.I(),{cx:-1e12}));d.min=[1e12,0,0];d.max=[1e12,0,0];d.lineValues.fill(Math.fround(1e12));const out=f.parity([d],.25,-40);assert(out.original);assert.equal(out.original.hash,d.hash);assert(f.api.box(d).max[1]>d.max[1]);assert.notEqual(Math.fround(d.samples.get('edge')[0].position[0]),d.samples.get('edge')[0].position[0]);
 });
 check('Perspective near-eye crossing, uncertain depth and non-finite values fail open',()=>{
  for(const points of [[[0,0,3],[1,1,4]],[[0,0,3.2-Number.EPSILON*4],[1,1,3.2-Number.EPSILON*8]],[[Infinity,0,0],[1,1,0]]]){const d=f.display('eye',points,f.cache(f.FM.I(),{ortho:false,pixels:500}));assert.equal(f.api.hit(d,d.cache,1e6,-1e6),true);assert.equal(f.api.screen(d,d.cache).valid,false);}
  const rear=f.display('behind',[[0,0,5],[1,1,6]],f.cache(f.FM.I(),{ortho:false,pixels:500}));assert.equal(f.api.hit(rear,rear.cache,0,0,8,undefined,true),false);assert.equal(f.parity([rear],0,0).original,null);
  const d=f.display('nonfinite',[[0,0,0],[1,1,0]]);d.cache.frame[0]=NaN;assert.equal(f.api.hit(d,d.cache,1e6,1e6),true);assert.equal(f.api.hit(d,d.cache,NaN,0),true);
 });
 check('Display revision, line identity/length, sample-map replacement and mutable previews invalidate exact local bounds',()=>{
  let reads=0;const d=f.display('mutable',[[0,0,0],[1,1,0]]);for(const sample of d.samples.get('edge')){const p=sample.position;Object.defineProperty(sample,'position',{get(){reads++;return p;}});}const first=f.api.box(d);assert.equal(reads,2);for(let i=0;i<100;i++)assert.equal(f.api.box(d),first);assert.equal(reads,2);
  d.samples.get('edge')[0].position[0]=-90;d.wireVersion++;const second=f.api.box(d);assert.notEqual(second,first);assert.equal(second.min[0],-90);assert.equal(reads,5);
  for(const mutate of [()=>d.lineValues=new Float32Array(d.lineValues.length),()=>d.lineValues=new Float32Array(d.lineValues.length+6),()=>d.samples=new Map(d.samples),()=>d.samples.set('added',[{position:[400,0,0],t:0},{position:[401,0,0],t:1}])]){const old=f.api.box(d);mutate();assert.notEqual(f.api.box(d),old);}
  const old=f.api.screen(d,d.cache);d.samples.get('edge')[1].position[1]=500;d.wireVersion++;assert.notEqual(f.api.screen(d,d.cache),old);const projected=f.api.screen(d,{...d.cache,frame:f.FM.translation([100,0,0])});assert.notEqual(projected,old);
 });
 check('A cached projected box conservatively contains all actual sample and interior projections under shear/reflection/nonuniform frames',()=>{
  let seed=0x8923abcd;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};let projected=0;
  for(let test=0;test<100;test++){
   const scale=f.FM.I();scale[0]=(test%2?-1:1)*(random()*3+.01);scale[5]=random()*4+.01;scale[10]=random()*2+.01;const frame=f.FM.mul(f.FM.translation([(random()-.5)*300,(random()-.5)*300,-1000-random()*1000]),f.FM.mul(f.FM.rotation([.3,.7,.2],random()*6),f.FM.mul(f.FM.shear([1,0,0],[0,1,0],random()*3-1.5),scale))),points=Array.from({length:12},()=>[(random()-.5)*100,(random()-.5)*100,(random()-.5)*100]),d=f.display('random',points,f.cache(frame,{cx:(random()-.5)*1000,cy:(random()-.5)*1000,pixels:100+random()*10000,ortho:test%2===0})),box=f.api.screen(d,d.cache);assert.equal(box.valid,true);
   for(let j=0;j<40;j++){const p=j<points.length?points[j]:[0,1,2].map(k=>box.local.min[k]+random()*(box.local.max[k]-box.local.min[k])),q=new Float64Array(3);f.api.project(d.cache,p,q);assert(q[0]>=box.minX&&q[0]<=box.maxX&&q[1]>=box.minY&&q[1]<=box.maxY);projected++;}
   for(let j=0;j<points.length-1;j++){const a=new Float64Array(3),b=new Float64Array(3);f.api.project(d.cache,points[j],a);f.api.project(d.cache,points[j+1],b);for(const offset of [-8,0,8])f.parity([d],(a[0]+b[0])*.5+offset,(a[1]+b[1])*.5);}
  }details.randomProjectedPoints=projected;
 });
 check('Far cages skip their actual segment scans while the full closest-hit result remains exact',()=>{
  const displays=Array.from({length:200},(_,i)=>f.display('cage'+i,[[i*1000,0,0],[i*1000+1,0,0]])),result=f.parity(displays,.5,0);assert(result.original);assert.equal(result.original.hash,'cage0');assert.equal(result.before,200);assert.equal(result.after,1);details.segmentCalls=result;
 });
 return {pass:true,native:false,sourceSHA256:createHash('sha256').update(html).digest('hex'),checks,details};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{const report=await splineNavigationBoundsChecks();await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/spline-navigation-bounds-cpu.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}catch(error){console.error(error.stack);process.exitCode=1;}
}
