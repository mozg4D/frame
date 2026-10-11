import assert from 'node:assert/strict';
import { helpers, helper } from './source-loader.mjs';
import { frameParseSTLPositions } from './fixtures/stock-stl-oracle.mjs';
const begin=helper.indexOf('function frameSTLCoordinateHash('),end=helper.indexOf('\nfunction frameSTLScalarKey',begin);assert(begin>=0&&end>begin);
const forced=Function(helper.slice(0,begin)+'function frameSTLCoordinateHash(){return 0;}'+helper.slice(end)+'\nreturn frameSTLCoordinateClasses;')();
const positions=new Float32Array(4500);for(let v=0;v<1500;v++){const n=v<1200?v:1499-v;positions[v*3]=Math.fround(n/1500);positions[v*3+1]=v%13===0?-0:Math.fround(4e-8);positions[v*3+2]=Math.fround(-n/1500);}
const actual=helpers.frameSTLCoordinateClasses(positions),colliding=forced(positions);assert.deepEqual(colliding.coords,actual.coords);assert.equal(colliding.count,actual.count);assert(actual.tableCapacity>1024);
const binary=new ArrayBuffer(134),dv=new DataView(binary);dv.setUint32(80,1,true);dv.setFloat32(96,Infinity,true);assert.throws(()=>frameParseSTLPositions(binary),/non-finite/);
const ascii=new TextEncoder().encode('solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 1e999 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid fixture').buffer;assert.throws(()=>frameParseSTLPositions(ascii),/non-finite/);
export default {pass:true,forcedPrivateHashCollisionWithGrowth:true,orderedClassIDsExact:true,syntheticVertices:1500,nonfiniteBinaryRejected:true,nonfiniteASCIIRejected:true};
