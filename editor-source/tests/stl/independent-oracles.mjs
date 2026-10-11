import assert from 'node:assert/strict';
import { helpers as home } from './source-loader.mjs';
import * as stock from './fixtures/stock-stl-oracle.mjs';
import { scalarKeyFromFiniteFloat32 as proofKey, classifyCoordinates as proofClasses } from './fixtures/independent-coordinate-proof.mjs';
let seed=0x31415926;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
const one=new Float32Array(1),bits=new Uint32Array(one.buffer);let scalarChecks=0,tripleChecks=0,meshPassChecks=0;
const scalar=raw=>{bits[0]=raw;const x=one[0];if(Number.isFinite(x)){assert.equal(home.frameSTLScalarKey(x,raw),proofKey(x,raw));scalarChecks++;}};
for(let i=0;i<2000000;i++)scalar(next());
for(let n=1;n<256;n+=2)for(const sign of[-1,1]){one[0]=sign*n/256;const at=bits[0];for(let j=-3;j<=3;j++)scalar(at+j);}
function classes(p){const a=home.frameSTLCoordinateClasses(p),b=proofClasses(p);assert.deepEqual(a.coords,b.coords);assert.equal(a.count,b.coordCount);tripleChecks++;}
function same(a,b,label){for(const f of['positions','normals','indices'])assert(Buffer.from(a[f].buffer,a[f].byteOffset,a[f].byteLength).equals(Buffer.from(b[f].buffer,b[f].byteOffset,b[f].byteLength)),label+': '+f);meshPassChecks++;}
const sensitive=[0,-0,2**-149,-(2**-149),4e-8,-4e-8,1/256,-1/256,.9999999403953552,-.9999999403953552,1,-1,1e21,-1e21];
for(let sample=0;sample<150;sample++){
 const p=new Float32Array(360),scale=[1e-8,1e-4,.001,1,256,1e8][sample%6];
 for(let j=0;j<p.length;j++)p[j]=j%11===0?sensitive[next()%sensitive.length]:(next()%101-50)*scale;
 const ix=new Uint32Array(900);for(let j=0;j<ix.length;j++)ix[j]=next()%(p.length/3);
 classes(p);
 const cosine=[Math.cos(46*Math.PI/180),Math.cos(45*Math.PI/180),1,-1,1-1e-7][sample%5];
 const a=stock.polygonCreaseData(p,ix,cosine,null,1,false,true),b=home.frameSTLCreaseData(p,ix,cosine,null,1,false,true);same(a,b,'first');
 same(stock.polygonCreaseData(a.positions,a.indices,cosine,null,1,false,true),home.frameSTLCreaseData(b.positions,b.indices,cosine,null,1,false,true),'second');
}
// All exact subunit ties in one triple fixture, preserving signs and duplicated ids.
const ties=[];for(let n=1;n<256;n+=2)for(const sign of[-1,1])ties.push(sign*n/256,-0,-4e-8);
classes(new Float32Array(ties.concat(ties)));

export default {pass:true,independentFiniteScalarChecks:scalarChecks,independentTripleCases:tripleChecks,twoPassPNIComparisons:meshPassChecks};
