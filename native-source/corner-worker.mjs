import {buildCornerScene,clipAt,exactOccludes,pointBounds,gpuBounds,exactProjectPacket} from './exact-corner.mjs';
export function installCornerVisibilityWorker(port){
let scene=null,query=null;
/** Separate worker keeps sorting and exact arithmetic off the input thread.
 * Captures are private transferred copies; original authored data is untouched. */
port.onmessage=({data:m})=>{
  try {
    if(m.kind==='build'){
      scene=buildCornerScene(m.captures);
      const raw=exactProjectPacket(m.targetPacket),vc=m.targetPacket.positions.length/3,logical=m.representatives?.length??vc,count=vc?raw.length/vc*logical:0,points=new Float32Array(count*4);query=[];
      for(let i=0;i<count;i++){const q=raw[Math.floor(i/logical)*vc+(m.representatives?m.representatives[i%logical]:i%logical)];query.push(q);const b=pointBounds(q);points.set(b?gpuBounds(b):[1,1,-1,-1],i*4);}
      const {nodeBounds,nodeMeta,order,triangleBounds}=scene;
      port.postMessage({id:m.id,result:{nodeBounds,nodeMeta,order,triangleBounds,points,nodeCount:scene.nodes.length,triangleCount:scene.triangles.length}},[nodeBounds.buffer,nodeMeta.buffer,order.buffer,triangleBounds.buffer,points.buffer]);
    }else if(m.kind==='refine'){
      if(!scene)throw Error('Corner scene not prepared');
      const {admitted,vertexCount,instanceCount,offsets,candidates}=m;
      if(query.length!==vertexCount*instanceCount||admitted.length!==vertexCount*instanceCount||offsets.length!==admitted.length+1||offsets.at(-1)!==candidates.length)throw Error('Corner refinement packet mismatch');
      const vertices=admitted;let tests=0,contactVertices=0;
      for(let i=0;i<vertices.length;i++){
        if(!vertices[i])continue;
        const q=query[i];
        if(!pointBounds(q)){vertices[i]=0;continue;}
        for(let j=offsets[i];j<offsets[i+1];j++){
          const id=candidates[j],tri=scene.triangles[id];if(!tri)throw Error('Invalid GPU candidate ID');
          const a=clipAt(scene.vertices,tri[0]),b=clipAt(scene.vertices,tri[1]),c=clipAt(scene.vertices,tri[2]);tests++;
          if([a,b,c].some(p=>p.e===q.e&&p.v.every((v,k)=>v===q.v[k])))contactVertices++;
          if(exactOccludes(q,a,b,c)){vertices[i]=0;break;}
        }
      }
      port.postMessage({id:m.id,result:{vertices,tests,contactVertices}},[vertices.buffer]);
    }else if(m.kind==='clear'){scene=null;query=null;port.postMessage({id:m.id,result:true});}
    else throw Error('Unknown corner worker operation');
  }catch(e){port.postMessage({id:m.id,error:String(e?.stack??e)});}
};

return ()=>{scene=null;query=null;port.onmessage=null;};
}
if(typeof self!=='undefined'&&typeof document==='undefined'&&typeof self.postMessage==='function')installCornerVisibilityWorker(self);
