import {reviewURL} from '../source-paths.mjs';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {root,T,diff} from './connected-support.mjs';
const {AffineCornerWorkspace,orderedAffinePositions}=await import(reviewURL('../candidate/native-source/affine-corner-worker.mjs',import.meta.url));
import {stockCornerOracle,orderedPositionOracle,stockCompactOracle as compactOracle} from './stock-oracle.mjs';
let seed=934379;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;};
const worlds=[['identity',new T.Matrix4()],['nonuniform',new T.Matrix4().compose(new T.Vector3(31,-27,14),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(2,.5,3))],['reflection',new T.Matrix4().compose(new T.Vector3(31,-27,14),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(-2,.5,3))],['large-translated',new T.Matrix4().compose(new T.Vector3(1e10,-1e10,3e10),new T.Quaternion().setFromEuler(new T.Euler(.7,.4,-.8)),new T.Vector3(2,.5,3))]];
const rows=[];let all=0;for(let fixture=0;fixture<12;fixture++){
 const N=12,p=new Float32Array(N*3);for(let i=0;i<p.length;i++)p[i]=(random()-.5)*10;
 // Coincident and near-coincident vertices, a non-manifold fan, reversed and degenerate faces.
 p.set(p.subarray(0,3),27);p.set(p.subarray(3,6),30);p.set(p.subarray(0,3),33);p[35]+=4e-8;
 const ix=Uint32Array.from([0,1,2,1,0,3,0,1,4,9,10,5,0,0,6,7,8,11,4,3,2,2,3,4]);
 for(const [worldName,W]of worlds){let base=p.slice();const ws=new AffineCornerWorkspace(base,ix);for(let op=0;op<12;op++){
 const D=op===0?new T.Matrix4():op===1?new T.Matrix4().makeScale(-1.2,.7,1.1):op===2?new T.Matrix4().makeScale(1,0,1):op===3?new T.Matrix4().makeScale(0,0,0):new T.Matrix4().compose(new T.Vector3(random(),random(),random()),new T.Quaternion().setFromEuler(new T.Euler(random(),random(),random())),new T.Vector3(.5+random(),.2+random(),.1+random()));
 const q=ws.compute(W.elements,D.elements,W.clone().invert().elements),expected=stockCornerOracle({positions:base,indices:ix,selectedIDs:Array.from({length:N},(_,i)=>i),world:W,delta:D});
 assert.equal(diff(q.positions,orderedPositionOracle(base,Array.from({length:N},(_,i)=>i),W,D)),0,`positions ${fixture}/${worldName}/${op}`);
 assert.equal(diff(q.cornerPositions,expected.positions),0,`corner positions ${fixture}/${worldName}/${op}`);assert.equal(diff(q.cornerNormals,expected.normals),0,`corner normals ${fixture}/${worldName}/${op}`);
 const comp=ws.compact(),want=compactOracle(q.positions,ix,Math.cos(46*Math.PI/180));for(const k of['positions','normals','indices'])assert.equal(diff(comp[k],want[k]),0,`compact ${k} ${fixture}/${worldName}/${op}`);all++;
 if(op===6){base=q.positions.slice();ws.rebase(base);}
 }rows.push({fixture,world:worldName,poses:12,passed:true});}
}
const result={passed:true,cases:all,rawPositionAndCornerNormalBitDifferences:0,compactPositionNormalIndexBitDifferences:0,stockSource:'fixtures/stock-editor-functions.js (see stock-editor-provenance.json)',controls:['nonuniform owner','reflected owner','large translated owner','local reflection','one-axis collapse','total collapse','degenerate source faces','nonmanifold shared edges','reversed coincident faces','workspace repeated poses and rebase'],rows};console.log(JSON.stringify({...result,rows:undefined},null,2));
