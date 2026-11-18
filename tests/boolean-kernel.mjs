import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function booleanKernelChecks(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const body=html.match(/<script id="frame-boolean-worker" type="text\/plain">([\s\S]*?)<\/script>/)[1];
  const worker=new Function('self',body+'\nreturn {booleanFloatMeshCheck,prepareMeshFlat,buildFaceTopo,edgeNeighbor,booleanRayTree,booleanRayLeaves,triangulatePSLGCore};')({});
  const checks=[];
  function check(name,run){run();checks.push({name,pass:true});}
  const pos=Float32Array.of(0,0,0,2,0,0,0,2,0,0,0,2);
  const faces=[0,2,1,0,1,3,1,2,3,2,0,3];
  const validate=(p,ix,closed=true)=>worker.booleanFloatMeshCheck(p,Uint32Array.from(ix),closed);

  check('Exact Float32 validation rejects invalid positions, triangles and edge winding',()=>{
    for(const point of [[-0,0,0],[NaN,0,0],[0,Infinity,0]])
      assert.equal(validate(Float32Array.of(...pos,...point),faces),null);
    for(const ix of [[0,1,1],[0,1,8],[0,1,2,0,2,1],[0,1,2,2,0,3]])
      assert.equal(validate(pos,ix,false),null);
    assert.equal(validate(Float32Array.of(0,0,0,1,1,1,2,2,2),[0,1,2],false),null);
    assert.equal(validate(Float32Array.of(...pos,0,3,4),[0,1,2,1,0,3,0,1,4],false),null);
    assert.equal(validate(pos,faces.slice(3)),null);
    assert.equal(validate(pos,faces.slice(3),false).boundaryEdges,3);
    assert.ok(validate(Float32Array.of(...pos,2**-149,0,0),faces).topologyValid);
  });

  check('Shared edges retain the first directed corner across multiple bitset words',()=>{
    const vertices=[],indices=[];
    for(let copy=0;copy<5;copy++){
      vertices.push(...pos.map((v,i)=>v+(i%3===0?copy*4:0)));
      indices.push(...faces.map(v=>v+copy*4));
    }
    const checked=validate(Float32Array.from(vertices),indices),seen=new Set();
    assert.ok(checked.topologyValid);
    for(let i=0;i<indices.length;i++){
      const a=indices[i],b=indices[i-i%3+(i+1)%3],edge=[Math.min(a,b),Math.max(a,b)].join(',');
      assert.equal((checked.repeatCorners[i>>>5]>>>(i&31))&1,Number(seen.has(edge)));
      seen.add(edge);
    }
    assert.equal(seen.size,30);
  });

  check('Repaired winding and nonmanifold input keep stable edge IDs and face neighbors',()=>{
    function verify(p,ix){
      const {mesh,stats}=worker.prepareMeshFlat(p,Uint32Array.from(ix)),edges=new Map();
      const offset=31,top=worker.buildFaceTopo(mesh,offset);
      for(let i=0;i<mesh.triV.length;i++){
        const a=mesh.triV[i],b=mesh.triV[i-i%3+(i+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');
        if(!edges.has(key))edges.set(key,{id:edges.size,incidents:[]});
        assert.equal(mesh.triE[i],edges.get(key).id);
        edges.get(key).incidents.push({a,b,face:Math.floor(i/3)});
      }
      for(const {incidents} of edges.values())for(const [j,{a,b,face}] of incidents.entries()){
        const neighbor=j<2?incidents[1-j]?.face:-1;
        assert.equal(worker.edgeNeighbor(top,offset+b,offset+a,face),neighbor??-1);
      }
      return stats;
    }
    assert.ok(verify(pos,[0,1,2,...faces.slice(3)]).windingRepairs>0);
    assert.equal(verify(Float32Array.of(...pos,0,3,4),[...faces,0,1,4]).nonManifoldEdges,1);
  });

  check('A classification ray partitions only the branches it reaches',()=>{
    const pos=[],ids=[];
    for(let i=0;i<192;i++){pos.push(i,0,0,i+.5,1,0,i,0,1);ids.push(i*3,i*3+1,i*3+2);}
    const tree=worker.booleanRayTree({triCount:192,pos:Float64Array.from(pos),triV:Uint32Array.from(ids)});
    assert.equal(tree.nodes.length,1);
    assert.equal([...worker.booleanRayLeaves(tree,-1,-1,-1,-1,-1,-1)].length,0);
    assert.equal(tree.nodes.length,1);
    assert.ok([...worker.booleanRayLeaves(tree,.05,-1,.1,1e-8,1,1e-8)].length);
    assert.ok(tree.nodes.length>1&&tree.nodes.length<15);
  });

  check('Constrained flips preserve triangle order and reject crossing constraints',()=>{
    const points=[[0,0],[4,0],[4,3],[0,3],[2,0],[.8,1.6],[3.2,.7],[2.9,2.4],[1,2.6]].map(([x,y])=>({x,y}));
    const outer=[0,4,1,2,3],seg=[[5,2],[5,6],[5,7],[5,4],[6,1]];
    assert.deepEqual(worker.triangulatePSLGCore(points,outer,seg),{ok:true,tris:[[0,4,5],[1,2,6],[4,1,6],[5,8,3],[3,0,5],[2,3,8],[6,5,4],[5,6,7],[6,2,7],[5,7,2],[2,8,5]]});
    assert.equal(worker.triangulatePSLGCore(points.slice(0,4),[0,1,2,3],[[0,2],[1,3]]).ok,false);
  });
  return {pass:true,checks};
}

if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await booleanKernelChecks()));
