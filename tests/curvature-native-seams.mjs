import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const from=html.indexOf('function framePredictBend('),to=html.indexOf('\n}\n',from)+2;
assert.ok(from>=0&&to>from);
const predict=Function(html.slice(from,to)+';return framePredictBend;')();
const crease=Uint32Array.of(0,1),smooth=new Uint32Array(),ix=Uint32Array.of(0,1,2,1,0,3);
const shallow=Float32Array.of(0,0,0,10,0,0,0,10,0,0,-10,1);
const steep=Float32Array.of(0,0,0,10,0,0,0,10,0,0,-1,10);
const spline=(p,patchHardEdges,angle=null)=>predict(p,ix,null,angle,{policy:'analytic-seams',patchHardEdges});
assert.equal(predict(shallow,ix,null,44).diagnostics.hard,0);
assert.equal(predict(steep,ix,null,44).diagnostics.hard,1);
const hard=spline(shallow,crease);
assert.equal(hard.diagnostics.hardPairs,1);
assert.equal(hard.diagnostics.hard,1);
assert.equal(hard.diagnostics.validFans,0);
for(const result of [spline(steep,smooth),spline(steep,smooth,0),spline(steep,smooth,180)]){
 assert.equal(result.diagnostics.policy,'analytic-seams');
 assert.equal(result.diagnostics.hardPairs,0);
 assert.equal(result.diagnostics.hard,0);
}
assert.deepEqual(spline(shallow,crease,180).values,hard.values);
for(const bad of [undefined,[],Uint32Array.of(0),Uint32Array.of(1,0),Uint32Array.of(0,4),Uint32Array.of(0,1,0,1)]){
 assert.throws(()=>spline(shallow,bad),/spline seam/);
}
console.log('Native Curvature predictor obeys analytic seam identity independently of the polygon threshold.');
