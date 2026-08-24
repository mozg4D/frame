// Frozen R2 coplanar runtime for JS.
// Fast path: boundary-noded planar overlay + direct Boolean boundary extraction.
// Safety path: generic fully-noded arrangement used only when the fast boundary graph or
// triangulation certification rejects the case. Both feed the same R2 contribution contract.
import {buildCoplanarPairs,buildCoplanarDisplaySeam,resolveCoplanarFast,CoplanarVertexKind} from './frame-boolean-coplanar-r2-fast.js?v=production-6-js-r2';
import {resolveCoplanar as resolveCoplanarGeneric} from './frame-boolean-coplanar-r2-generic.js?v=production-6-js-r2';
export {buildCoplanarPairs,CoplanarVertexKind};
export function resolveCoplanar(A,B,ca,cb,op,pairs){
  const f=resolveCoplanarFast(A,B,ca,cb,op,pairs);
  if(f.ok){f.path='fast';return f;}
  const g=resolveCoplanarGeneric(A,B,ca,cb,op,pairs);
  if(g.ok){const d=buildCoplanarDisplaySeam(A,B,ca,cb,op,pairs);if(d){g.out.displaySeamPositions=Array.from(d.positions);g.out.displaySeamIndices=Array.from(d.indices);}}
  g.path='generic';g.fastRejected=true;return g;
}
