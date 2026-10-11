import assert from 'node:assert/strict';
import { helpers } from './source-loader.mjs';
import { polygonCreaseData,frameParseSTLPositions,frameSTLGeometryBounds,prepareSplineBVH,frameWireIndices } from './fixtures/stock-stl-oracle.mjs';
const {frameSTLCoordinateClasses,frameSTLScalarKey,frameSTLCreaseData}=helpers;
const report={pass:false,scalarChecks:0,classFixtures:0,geometryFixtures:0,passComparisons:0,guards:0,parserFixtures:0,privateGeometryIncluded:false,actualBrowserAcceptance:false};let seed=0xa28d091c;const rng=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;},one=new Float32Array(1),ub=new Uint32Array(one.buffer),fromBits=b=>{ub[0]=b;return one[0];};
const words=a=>new Uint32Array(a.buffer,a.byteOffset,a.byteLength/4),equal=(a,b,label)=>{assert.equal(a.byteLength,b.byteLength,label+' length');const x=words(a),y=words(b);for(let i=0;i<x.length;i++)assert.equal(x[i],y[i],label+' word '+i);};
function scalarCheck(raw){const x=fromBits(raw),text=x.toFixed(7);let expected;if(!Number.isFinite(x))expected=text==='NaN'?0x7fc00000:raw;else if(x===0)expected=0;else if(Math.abs(x)>=1){one[0]=Number(text);expected=ub[0];}else{const negative=text[0]==='-',digits=text.replace('-','').replace('.',''),integer=Number(digits);expected=negative?(integer|0x80000000)>>>0:integer;}assert.equal(frameSTLScalarKey(x,raw),expected,'Scalar stock equality '+raw.toString(16));report.scalarChecks++;}
function stockClasses(p){const coords=new Uint32Array(p.length/3),m=new Map();for(let v=0;v<coords.length;v++){const o=v*3,key=p[o].toFixed(7)+','+p[o+1].toFixed(7)+','+p[o+2].toFixed(7);let id=m.get(key);if(id===undefined){id=m.size;m.set(key,id);}coords[v]=id;}return{coords,count:m.size};}
function classes(p,label){const stock=stockClasses(p);for(const f of[frameSTLCoordinateClasses]){const actual=f(p);equal(actual.coords,stock.coords,label+' ordered ids');assert.equal(actual.count,stock.count);}report.classFixtures++;}
function compare(a,b,label){for(const key of['positions','normals','indices'])equal(a[key],b[key],label+' '+key);report.passComparisons++;}
function geometry(p,ix,cos,label){const stock1=polygonCreaseData(p,ix,cos,null,1,false,true),stock2=polygonCreaseData(stock1.positions,stock1.indices,cos,null,1,false,true);for(const f of[frameSTLCreaseData]){const one=f(p,ix,cos,null,1,false,true),two=f(one.positions,one.indices,cos,null,1,false,true);compare(one,stock1,label+' pass1');compare(two,stock2,label+' pass2');assert.deepEqual(Object.keys(one).sort(),['indices','normals','positions']);}report.geometryFixtures++;}
try{
 for(let i=0;i<2000000;i++)scalarCheck(rng());
 for(let exponent=0;exponent<256;exponent++)for(const mantissa of[0,1,2,3,0x3ffffe,0x3fffff,0x400000,0x400001,0x7ffffd,0x7ffffe,0x7fffff])for(const sign of[0,0x80000000])scalarCheck((sign|(exponent<<23)|mantissa)>>>0);
 for(const x of[0,-0,5e-8,-5e-8,1/256,-1/256,1,-1,256,-256,214.7483647,-214.7483647,1e21,-1e21,Infinity,-Infinity,NaN]){one[0]=x;const raw=ub[0];for(let delta=-4;delta<=4;delta++)scalarCheck((raw+delta)>>>0);}
 const stats={boundary:0,signedZero:0,nonfinite:0};for(const x of[-0,1/256,-1/256,Infinity,-Infinity,NaN]){one[0]=x;frameSTLScalarKey(one[0],ub[0],stats);}assert(stats.boundary>=2&&stats.signedZero>=1&&stats.nonfinite>=3);report.explicitFallbackCounters=stats;
 const special=new Float32Array([0,0,0,-0,0,0,-1e-10,0,0,1e-10,0,0,NaN,0,0,NaN,0,0,Infinity,0,0,-Infinity,0,0,1/256,0,0,-1/256,0,0,.99999994,0,0,1,0,0]);classes(special,'special');
 const offsetBuffer=new Float32Array(300009);for(let i=0;i<offsetBuffer.length;i++)offsetBuffer[i]=i%9===0?-1e-10:fromBits(rng());classes(offsetBuffer.subarray(3,300003),'offset-large-rehash');
 classes(new Float64Array([.99999999,0,0,1,0,0,5e-8,0,0,-5e-8,0,0,-0,0,0]),'Float64 exact fallback');classes(new Float32Array(0),'empty');
 const base=[0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,-1,0];
 for(let k=0;k<160;k++){const p=new Float32Array(base);for(let i=0;i<p.length;i++)p[i]=p[i]*(k%3===0?1e-7:k%3===1?1:256)+(k%5===0?Math.fround(5e-8):0);if(k%7===0){p[9]=p[10]=p[11]=-0;}const ix=k%4===0?null:Uint32Array.from({length:9},(_,i)=>k%2?8-i:i),cos=[Math.cos(Math.PI/3),1,1-1e-7,0,-1,NaN][k%6];classes(p,'ordered-'+k);geometry(p,ix,cos,'geometry-'+k);}
 geometry(new Float32Array([0,0,0,0,0,0,0,0,0,NaN,1,2,Infinity,2,3,-Infinity,3,4]),null,.5,'degenerate-nonfinite');
 geometry(new Float64Array(base),null,.5,'Float64 unsupported fast classification');
 for(let k=0;k<16;k++){const p=new Float32Array(9000);for(let i=0;i<p.length;i++)p[i]=Math.fround((rng()%50000-25000)/1e7);const ix=Uint32Array.from({length:9000},(_,i)=>i%37===0?0:i/3%13===0?i-1:i);geometry(p,ix,.5,'seeded-nonmanifold-'+k);}
 for(const args of[[new Uint32Array(9),1,false,true],[null,2,false,true],[null,1,true,true],[null,1,false,false]]){assert.throws(()=>frameSTLCreaseData(new Float32Array(base),null,.5,...args),/STL-only/);report.guards++;}
 const binary=new ArrayBuffer(84+2*50),dv=new DataView(binary);dv.setUint32(80,2,true);const vertices=[0,0,0,1,0,0,0,1,0,0,0,0,0,1,0,0,0,1];for(let f=0;f<2;f++)for(let i=0;i<9;i++)dv.setFloat32(84+f*50+12+i*4,vertices[f*9+i],true);
 const ascii=new TextEncoder().encode('solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nfacet normal 1 0 0\nouter loop\nvertex 0 0 0\nvertex 0 1 0\nvertex 0 0 1\nendloop\nendfacet\nendsolid fixture\n').buffer;
 for(const [name,buffer]of[['binary',binary],['ASCII',ascii]]){const p=frameParseSTLPositions(buffer,()=>{});for(let i=0;i<p.length;i+=3){const y=p[i+1],z=p[i+2];p[i+1]=z;p[i+2]=-y;}geometry(p,Uint32Array.from({length:p.length/3},(_,i)=>i),.5,name+' parser');report.parserFixtures++;}
 const topology=new Float32Array(base),st=polygonCreaseData(topology,null,.5,null,1,false,true),fast=frameSTLCreaseData(topology,null,.5);assert.deepEqual(frameSTLGeometryBounds(fast.positions),frameSTLGeometryBounds(st.positions));for(const key of['bvhBounds','bvhChildren','bvhOrder'])equal(prepareSplineBVH(fast.positions,fast.indices)[key],prepareSplineBVH(st.positions,st.indices)[key],'BVH '+key);equal(frameWireIndices({count:fast.positions.length/3},{count:fast.indices.length,getX:i=>fast.indices[i]}),frameWireIndices({count:st.positions.length/3},{count:st.indices.length,getX:i=>st.indices[i]}),'wire');report.pass=true;
}catch(e){report.reason=String(e);report.stack=e.stack;process.exitCode=1;}finally{}

if(!report.pass)throw Error(report.reason);
export default report;
