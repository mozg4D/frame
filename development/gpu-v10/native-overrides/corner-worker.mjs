import {buildCornerScene,clipAt,exactOccludes,pointBounds,gpuBounds,exactProjectPacket} from './exact-corner.mjs';
// Only private exact tuples with a proved valid query and common positive w.
// Dividing Cramer's homogeneous determinants by that same w leaves exact 2D
// barycentric numerators. No rounded depth, epsilon, or altered boundary test.
function frameOrthographicCornerOccludes(q,a,b,c,queryValid){
 if(!queryValid||!q?.v||!a?.v||!b?.v||!c?.v||q.e!==a.e||q.e!==b.e||q.e!==c.e)return null;
 const Q=q.v,A=a.v,B=b.v,C=c.v,w=Q[3];
 if(!(w>0n)||A[3]!==w||B[3]!==w||C[3]!==w)return null;
 // Nonnegative barycentrics cannot produce a strictly nearer depth than all
 // three corners. Exact equal depth remains unoccluded, including coplanarity.
 if(A[2]>=Q[2]&&B[2]>=Q[2]&&C[2]>=Q[2])return false;
 const d=(B[0]-A[0])*(C[1]-A[1])-(B[1]-A[1])*(C[0]-A[0]);if(d===0n)return false;
 const positive=d>0n,ea=(B[0]-Q[0])*(C[1]-Q[1])-(B[1]-Q[1])*(C[0]-Q[0]);
 if(positive?ea<0n:ea>0n)return false;
 const eb=(C[0]-Q[0])*(A[1]-Q[1])-(C[1]-Q[1])*(A[0]-Q[0]);
 if(positive?eb<0n:eb>0n)return false;
 const ec=d-ea-eb;if(positive?ec<0n:ec>0n)return false;
 const n=ea*A[2]+eb*B[2]+ec*C[2];if(positive?n<0n:n>0n)return false;
 return positive?n<d*Q[2]:n>d*Q[2];
}

export function installCornerVisibilityWorker(port){
let scene=null,query=null,queryValidity=null,contactShortcutEnabled=false;
/** Separate worker keeps sorting and exact arithmetic off the input thread.
 * Captures are private transferred copies; original authored data is untouched. */
port.onmessage=({data:m})=>{
  try {
    if(m.kind==='build'){
      contactShortcutEnabled=false;
      scene=buildCornerScene(m.captures,{packedSort:true,packedProjection:true,filteredProjection:true});
      // Captures are private native transfer copies. After the unchanged scene
      // build succeeds, share only a proved exact capture's existing tuple span.
      // Keep every surface/triangle/candidate and the original fallback ordering.
      const shared=(()=>{
        try{
          const data=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object,key);return d&&'value'in d?d:null;};
          const view=(a,type)=>a instanceof type&&a.buffer instanceof ArrayBuffer&&!a.buffer.resizable&&a.byteOffset===0&&a.byteLength===a.buffer.byteLength;
          const packet=p=>{
            if(!p||Object.getPrototypeOf(p)!==Object.prototype)return null;
            const pd=data(p,'positions'),md=data(p,'clipMatrices'),id=data(p,'indices');if(!pd||!md||!id)return null;
            const positions=pd.value,clipMatrices=md.value,indices=id.value;
            if(!view(positions,Float32Array)||!view(clipMatrices,Float32Array)||positions.length%3||clipMatrices.length%16||!(indices==null||view(indices,Uint16Array)||view(indices,Uint32Array)))return null;
            return {positions,clipMatrices,indices};
          };
          const equal=(a,b)=>{
            if(a==null||b==null)return a==null&&b==null;
            if(a.constructor!==b.constructor||a.byteLength!==b.byteLength)return false;
            const x=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),y=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);
            for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;
          };
          const target=packet(m.targetPacket);if(!target||!Array.isArray(m.captures))return null;
          const captures=[];
          for(let i=0;i<m.captures.length;i++){
            const cd=data(m.captures,String(i));if(!cd)return null;const capture=cd.value;
            if(!capture||Object.getPrototypeOf(capture)!==Object.prototype)return null;
            const pd=data(capture,'packet'),clips=Object.getOwnPropertyDescriptor(capture,'clips');
            if(!pd||clips&&(!('value'in clips)||clips.value!=null))return null;
            const p=packet(pd.value);if(!p)return null;captures.push(p);
          }
          let base=0;
          for(const p of captures){
            const count=p.positions.length/3*(p.clipMatrices.length/16);
            if(equal(target.positions,p.positions)&&equal(target.clipMatrices,p.clipMatrices)&&equal(target.indices,p.indices))return {base,count};
            base+=count;
          }
        }catch{} // Unproved layouts retain the original exact target projection.
        return null;
      })();
      const raw=shared?scene.vertices:exactProjectPacket(m.targetPacket),vc=m.targetPacket.positions.length/3,logical=m.representatives?.length??vc,rawCount=shared?shared.count:raw.length,rawBase=shared?shared.base:0,count=vc?rawCount/vc*logical:0,points=new Float32Array(count*4);query=[];queryValidity=null;const validity=new Uint8Array(count);
      for(let i=0;i<count;i++){const q=raw[rawBase+Math.floor(i/logical)*vc+(m.representatives?m.representatives[i%logical]:i%logical)];query.push(q);const b=pointBounds(q);validity[i]=b?1:0;points.set(b?gpuBounds(b):[1,1,-1,-1],i*4);}
      // Query tuples stay private and immutable until the next build/clear.
      // Publish metadata only after every exact bounds calculation succeeds.
      queryValidity=validity;
      const {nodeBounds,nodeMeta,order,triangleBounds}=scene;
      port.postMessage({id:m.id,result:{nodeBounds,nodeMeta,order,triangleBounds,points,nodeCount:scene.nodes.length,triangleCount:scene.triangles.length}},[nodeBounds.buffer,nodeMeta.buffer,order.buffer,triangleBounds.buffer,points.buffer]);
      // Enable only after the completed, proved shared build is delivered.
      contactShortcutEnabled=!!shared;
    }else if(m.kind==='refine'){
      if(!scene)throw Error('Corner scene not prepared');
      const {admitted,vertexCount,instanceCount,offsets,candidates}=m;
      if(query.length!==vertexCount*instanceCount||admitted.length!==vertexCount*instanceCount||offsets.length!==admitted.length+1||offsets.at(-1)!==candidates.length)throw Error('Corner refinement packet mismatch');
      const vertices=admitted;let tests=0,contactVertices=0;
      for(let i=0;i<vertices.length;i++){
        if(!vertices[i])continue;
        const q=query[i];
        if(!(queryValidity?queryValidity[i]:pointBounds(q))){vertices[i]=0;continue;}
        for(let j=offsets[i];j<offsets[i+1];j++){
          const id=candidates[j],tri=scene.triangles[id];if(!tri)throw Error('Invalid GPU candidate ID');
          const a=clipAt(scene.vertices,tri[0]),b=clipAt(scene.vertices,tri[1]),c=clipAt(scene.vertices,tri[2]);tests++;
          const contact=[a,b,c].some(p=>p.e===q.e&&p.v.every((v,k)=>v===q.v[k]));
          if(contact){contactVertices++;if(contactShortcutEnabled)continue;}
          const orthographic=frameOrthographicCornerOccludes(q,a,b,c,queryValidity?.[i]===1);
          if(orthographic===null?exactOccludes(q,a,b,c):orthographic){vertices[i]=0;break;}
        }
      }
      port.postMessage({id:m.id,result:{vertices,tests,contactVertices}},[vertices.buffer]);
    }else if(m.kind==='clear'){scene=null;query=null;queryValidity=null;contactShortcutEnabled=false;port.postMessage({id:m.id,result:true});}
    else throw Error('Unknown corner worker operation');
  }catch(e){port.postMessage({id:m.id,error:String(e?.stack??e)});}
};

return ()=>{scene=null;query=null;queryValidity=null;contactShortcutEnabled=false;port.onmessage=null;};
}
if(typeof self!=='undefined'&&typeof document==='undefined'&&typeof self.postMessage==='function')installCornerVisibilityWorker(self);
