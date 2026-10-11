/** Independent oracle expands global face corners and transforms selected faces only.
 * It deliberately does not share selection mapping, proof, merging, or worker code. */
import * as T from'../fixtures/three-core.mjs';import{stockCompactOracle}from'./stock-oracle.mjs';
export function selectedFaceOracle(positions,index,faces,world,delta,cos){const selected=new Set(faces),corners=new Float32Array(index.length*3),inverse=world.clone().invert(),v=new T.Vector3(),q=new T.Vector3();for(let at=0;at<index.length;at++){v.fromArray(positions,index[at]*3);if(selected.has(Math.floor(at/3))){q.copy(v).applyMatrix4(world).applyMatrix4(delta).applyMatrix4(inverse);v.lerp(q,1);}v.toArray(corners,at*3);}return stockCompactOracle(corners,Uint32Array.from({length:index.length},(_,i)=>i),cos);}
