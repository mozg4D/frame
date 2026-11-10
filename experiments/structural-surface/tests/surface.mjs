import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSurfaceWGSL,prepareNativeSurfaceWork} from '../surface-work.js';
import {captureStructuralDomain} from '../../structural-capture/capture.js';
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture({cells=[4,4,4],triangles=600,storage='buffer'}={}){
 let current=true,touched=0;const count=cells.reduce((a,b)=>a*b,1),positions={kind:'texture',format:'r32uint',channels:1,count:24,width:24,height:1,layers:1,size:8*12,view:{},mapAsync(){touched++;throw Error('MAP');},destroy(){touched++;throw Error('DESTROY');}},indices={...positions,count:triangles*3,width:triangles*3,size:triangles*12};
 const mesh={solid:0,matrix:[...matrix],storage,vertexCount:8,triangleCount:triangles,positions,indices};
 const capture={descriptor:{domain:{min:[-50,-50,-50],max:[50,50,50],cells,count,spacingLocal:cells.map(n=>100/n)}},assertCurrent(){if(!current)throw Error('STALE CAPTURE');},borrowGeometry(){this.assertCurrent();return [mesh];}};
 return {capture,mesh,get touched(){return touched;},stale(){current=false;},restore(){current=true;}};
}
test('native buffer batches cover every triangle once with bounded cell-pair work',()=>{
 const f=fixture(),plan=prepareNativeSurfaceWork(f.capture);assert.equal(plan.summary.batches,3);assert.equal(plan.summary.pairs,64*600);assert.equal(plan.summary.labelBytes,256);
 let next=0;for(let i=0;i<3;i++){const b=plan.borrowBatch(i),u=new Uint32Array(b.config),floats=new Float32Array(b.config);assert.equal(b.triangleStart,next);next=b.triangleEnd;assert.ok((b.triangleEnd-b.triangleStart)*64<=262144);assert.equal(u[24],4);assert.equal(u[27],64);assert.equal(u[30],8);assert.equal(floats[19],100);assert.equal(floats[20],.25);assert.equal(b.positions,f.mesh.positions);}
 assert.equal(next,600);assert.equal(f.touched,0);plan.retire();
});
test('configs are copied on borrow and retirement never destroys native resources',()=>{
 const f=fixture(),p=prepareNativeSurfaceWork(f.capture),b=p.borrowBatch(0);new Float32Array(b.config)[0]=99;assert.equal(new Float32Array(p.borrowBatch(0).config)[0],1);
 p.retire();p.retire();assert.throws(()=>p.borrowBatch(0),/Retired/);assert.equal(f.touched,0);
});
test('stale work cannot revive after a source observation returns to baseline',()=>{
 const f=fixture(),p=prepareNativeSurfaceWork(f.capture);f.stale();assert.throws(()=>p.assertCurrent(),/STALE/);f.restore();assert.throws(()=>p.borrowBatch(0),/Retired/);
});
test('paged texture work uses native views without geometry conversion',()=>{
 const f=fixture({storage:'texture'}),p=prepareNativeSurfaceWork(f.capture),b=p.borrowBatch(0);assert.equal(b.storage,'texture');assert.equal(b.positions.view,f.mesh.positions.view);assert.equal(f.touched,0);p.retire();
});
test('actual capture handle feeds native surface recipe and revokes it on owner edits',()=>{
 const owner='a'.repeat(32),f=fixture({triangles:12});let revision=0;
 const context={device:{},document:{nodes:[{nativeHash:owner,type:'structural',params:{'Voxel size':25}}],frame:0,world:()=>[...matrix]},fields:{authoringStamp:()=>({epoch:'native',revision})},scene:{transforming:false,signature:()=> 'snapshot',capture(){return {device:context.device,signature:'snapshot',params:{'Voxel size':25},meshes:[{...f.mesh,hash:'b'.repeat(32)}]};}}};
 const capture=captureStructuralDomain(context,owner),plan=prepareNativeSurfaceWork(capture);assert.equal(plan.summary.cells,64);assert.equal(plan.borrowBatch(0).positions,f.mesh.positions);revision++;
 assert.throws(()=>plan.borrowBatch(0),/Stale/);plan.retire();capture.retire();assert.equal(f.touched,0);
});
test('count, buffer, texture, precision and total-work admission reject unsupported inputs',()=>{
 for(const mutate of [f=>f.mesh.triangleCount=65537,f=>f.mesh.positions.size=1,f=>f.mesh.storage='unknown',f=>f.mesh.matrix[0]=.1,f=>f.mesh.matrix[0]=Infinity,f=>f.mesh.vertexCount=2**32]){const f=fixture();mutate(f);assert.throws(()=>prepareNativeSurfaceWork(f.capture));assert.equal(f.touched,0);}
 const t=fixture({storage:'texture'});delete t.mesh.positions.view;assert.throws(()=>prepareNativeSurfaceWork(t.capture),/layout/);
 const big=fixture({cells:[16,16,16],triangles:2000});assert.throws(()=>prepareNativeSurfaceWork(big.capture),/8000000/);
});
test('native paged scalar metadata rejects truncation and non-r32uint layouts',()=>{
 for(const mutate of [m=>m.positions.count=1,m=>m.indices.count=1,m=>m.positions.width=0,m=>m.indices.format='rgba32uint',m=>m.positions.channels=4,m=>m.indices.size=0,m=>m.positions.layers=Infinity]){const f=fixture({storage:'texture'});mutate(f.mesh);assert.throws(()=>prepareNativeSurfaceWork(f.capture),/capacity\/layout/);assert.equal(f.touched,0);}
});
test('source kernels reuse packed XYZ/indices and native paged scalar addressing',()=>{
 const buffer=nativeSurfaceWGSL('buffer'),texture=nativeSurfaceWGSL('texture');
 assert.match(buffer,/positions:array<f32>/);assert.match(buffer,/value\(3u\*i\)/);assert.match(buffer,/cfg\.matrix\*vec4f/);assert.match(texture,/texture_2d_array<u32>/);assert.match(texture,/textureLoad/);
 for(const s of [buffer,texture]){assert.match(s,/max\(ia,max\(ib,ic\)\)>=cfg\.range\.z/);assert.match(s,/id>=cfg\.dims\.w/);assert.match(s,/labels\[id\]=2u/);assert.doesNotMatch(s,/labels\[id\]=1u|fn ray|normal|hash|serialize/i);}
 assert.throws(()=>nativeSurfaceWGSL('other'));
});
test('generated source delimiter check catches the reviewed missing-parenthesis defect',()=>{
 const balanced=code=>{const stack=[],pairs={')':'(',']':'[','}':'{'};for(const c of code.replace(/\/\/[^\n]*/g,'')){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);};
 for(const kind of ['buffer','texture']){const code=nativeSurfaceWGSL(kind);balanced(code);const bad=code.replace('coordinateMagnitude))/cfg.origin.w','coordinateMagnitude)/cfg.origin.w');assert.notEqual(bad,code);assert.throws(()=>balanced(bad));}
});

// Independent CPU fixture oracle: repeated Sutherland-Hodgman triangle clipping
// against six cell half-spaces. No GPU source geometry is read or mirrored.
function clip(poly,axis,edge,sign){
 const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=sign*(a[axis]-edge),db=sign*(b[axis]-edge);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,k)=>v+t*(b[k]-v)));}}return out;
}
function surfaceOracle(triangles,cells=[4,4,4]){
 const labels=[];for(let z=0;z<cells[2];z++)for(let y=0;y<cells[1];y++)for(let x=0;x<cells[0];x++){
  const lo=[x,y,z].map((v,k)=>-1+2*v/cells[k]),hi=lo.map((v,k)=>v+2/cells[k]);let hit=false;
  for(const triangle of triangles){let p=triangle;for(let k=0;k<3&&p.length;k++){p=clip(p,k,lo[k],1);p=clip(p,k,hi[k],-1);}if(p.length){hit=true;break;}}
  labels.push(hit?2:0);
 }return labels;
}
const plane=[[[.1,-2,-2],[.1,2,-2],[.1,2,2]],[[.1,-2,-2],[.1,2,2],[.1,-2,2]]];
test('independent clipped-plane oracle covers only the in-domain surface slab',()=>{
 const labels=surfaceOracle(plane);assert.equal(labels.filter(v=>v===2).length,16);for(let i=0;i<64;i++)assert.equal(labels[i],i%4===2?2:0);
});
test('surface oracle is invariant under reversed winding and duplicate faces',()=>{
 assert.deepEqual(surfaceOracle(plane),surfaceOracle(plane.map(t=>[...t].reverse())));assert.deepEqual(surfaceOracle(plane),surfaceOracle([...plane,...plane]));
});
test('distant surfaces do not become in-box material through their bounds',()=>{
 const distant=plane.map(t=>t.map(p=>[2,p[1],p[2]]));assert.ok(surfaceOracle(distant).every(v=>v===0));
 // Zero here means no source surface in the cell; it is never certified air.
 assert.equal(prepareNativeSurfaceWork(fixture().capture).summary.geometryClassified,false);
});
test('200 complete CPU work preparations and retirement fit 1 second',()=>{
 const f=fixture(),start=performance.now();for(let i=0;i<200;i++){const p=prepareNativeSurfaceWork(f.capture);p.borrowBatch(0);p.retire();}const ms=performance.now()-start;assert.ok(ms<1000,`${ms}ms`);console.log(JSON.stringify({operation:'200 native surface dispatch preparations',ms,limitMs:1000,hardwareValidated:false}));
});
