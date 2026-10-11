// Synthetic inputs only. No user model or product source is embedded.
export const IMPORT_COS = Math.cos(46 * Math.PI / 180);
const f32 = x => Math.fround(x);
const u = new Uint32Array(1), f = new Float32Array(u.buffer);
const bits = x => { f[0] = x; return u[0]; };
const value = x => { u[0] = x; return f[0]; };
export const pack = triangles => new Float32Array(triangles.flat(2));
export function fan(angles, options = {}) {
  const A = [0, 0, 0], B = [1, 0, 0];
  return angles.map((angle, i) => {
    const theta = angle * Math.PI / 180, radius = options.radii?.[i] ?? 1;
    const C = [0, radius * Math.cos(theta), radius * Math.sin(theta)];
    return options.reverse?.has(i) ? [B, A, C.map(x => -x)] : [A, B, C];
  });
}
export function thresholdPairs() {
  const target = IMPORT_COS - 1e-7;
  const y0 = bits(Math.cos(46 * Math.PI / 180)), z0 = bits(Math.sin(46 * Math.PI / 180));
  let below = null, above = null, epsilonOnly = null;
  for (let dy = -24; dy <= 24; dy++) for (let dz = -24; dz <= 24; dz++) {
    const y = value(y0 + dy), z = value(z0 + dz);
    // This is the exact source order for the base face dotted with the second face.
    const dot = y * (1 / Math.hypot(z, y));
    const item = {y, z, dot, delta: dot - target};
    if (dot < target && (!below || dot > below.dot)) below = item;
    if (dot >= target && (!above || dot < above.dot)) above = item;
    if (dot >= target && dot < IMPORT_COS && (!epsilonOnly || Math.abs(dot-(target+IMPORT_COS)/2) < Math.abs(epsilonOnly.dot-(target+IMPORT_COS)/2))) epsilonOnly = item;
  }
  return {below, above, epsilonOnly};
}
function grid(n) {
  const out = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    out.push([[x,y,0],[x+1,y,0],[x+1,y+1,0]], [[x,y,0],[x+1,y+1,0],[x,y+1,0]]);
  }
  return out;
}
export function fixtures() {
  const pairs = thresholdPairs();
  const base = [[0,0,0],[1,0,0],[0,1,0]];
  const result = [
    {name:'single-triangle-head-zero', triangles:[base], expectedVertices:3},
    {name:'irregular-cross-products-float64-area', triangles:[[[-0.432526171207428,-0.12973995506763458,-0.9226974844932556],[-0.5582401752471924,-0.281145840883255,0.18048827350139618],[-0.2774381935596466,-0.3463001847267151,-0.840520977973938]]], expectedVertices:3},
    {name:'coplanar-shared-edge-opposite-directions', triangles:[base,[[1,0,0],[0,0,0],[0,-1,0]]], expectedVertices:4},
    {name:'duplicate-same-oriented', triangles:[base,base], expectedVertices:3},
    {name:'opposite-normal-exact-duplicates', triangles:[base,[base[1],base[0],base[2]]], expectedVertices:6},
    {name:'degenerate-isolated-collinear-duplicate', triangles:[base,[[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[1,0,0],[2,0,0]],[[0,0,0],[0,0,0],[0,1,0]]], expectedVertices:12},
    {name:'positive-area-below-1e-8', triangles:[[[0,0,0],[1,0,0],[0,1e-9,0]]], expectedVertices:2, expectedSecondVertices:3},
    {name:'near-alias-nonzero-self-edge', triangles:[[[0,0,0],[1e-8,0,0],[0,1,0]],[[0,0,0],[0,1,0],[-1e-8,0,0]]], expectedVertices:3, expectedSecondVertices:6},
    {name:'first-seen-near-alias-position', triangles:[base,[[1e-8,0,0],[1,0,0],[0,2,0]]]},
    {name:'nonmanifold-older-smooth-newest-sharp', triangles:fan([0,80,30]), expectedVertices:7},
    {name:'nonmanifold-transitive-bridge', triangles:fan([0,45,90]), expectedVertices:5},
    {name:'nonmanifold-bridge-last', triangles:fan([0,90,45]), expectedVertices:5},
    {name:'nonmanifold-reversed-mixed-directions', triangles:fan([0,80,30,45], {reverse:new Set([1,3])})},
    {name:'high-valence-192-shared-edge', triangles:fan(Array.from({length:192},(_,i)=>i*360/192), {radii:Array.from({length:192},(_,i)=>1+i/256)})},
    {name:'zero-signed-zero-weld', triangles:[base,[[-0,-0,-0],[1,0,0],[0,2,0]]], expectedVertices:4},
    {name:'collision-growth-grid-20', triangles:grid(20)},
  ];
  for(const [name, item] of Object.entries(pairs)) {
    if (!item) throw Error('Threshold search did not find '+name);
    result.push({name:'threshold-'+name, triangles:[base,[[0,0,0],[1,0,0],[0,item.y,item.z]]], expectedVertices:name==='below'?6:4, threshold:item});
  }
  return result.map(({triangles,...info})=>({...info,positions:pack(triangles),index:null,cos:IMPORT_COS}));
}
