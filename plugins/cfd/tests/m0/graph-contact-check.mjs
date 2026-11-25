import {gpuScope} from './gpu.mjs';
import {graphEdgeTree,graphIntersections} from './graph-contact.mjs';
import {fitNativeGraphAnchors} from './graph-anchors.mjs';

// Two oblique physical sheets separated by less than the normal spacing.
// Compare both intersection parameters, including links that pierce both.
export async function verifyNativeGraphLinks(device){
  const gpu=gpuScope(device),pos=[],linkFace=[],nbr=[],kind=[],offset=[0],expect=[];
  const low=.0037,high=.0043,cut=p=>p[0]-.41*p[1]+.22*p[2];
  for(let k=0;k<241;k++){
    const a=[.008*Math.sin(k*.43),.013*Math.cos(k*.71),.011*Math.sin(k*.25)];
    const b=a.map((v,j)=>v+.009*Math.cos(k*(j+2)*.19+.4*j));
    const i=pos.length/4;pos.push(...a,1,...b,1);linkFace.push(k,~k);nbr.push(i+1,i);kind.push(0,0);offset.push(2*k+1,2*k+2);
    const d=cut(a),s=cut(b)-d;expect.push([low,high].map(v=>(v-d)/s).filter(u=>u>=0&&u<=1).sort((a,b)=>a-b));
  }
  const g={pos:Float32Array.from(pos),offset,kind,linkFace,nbr},tree=graphEdgeTree(g),vertices=[],indices=[];
  for(const d of [low,high]){
    const k=vertices.length/3;
    for(const [y,z] of [[-.06,-.06],[.06,-.06],[.06,.06],[-.06,.06]])vertices.push(d+.41*y-.22*z,y,z);
    indices.push(k,k+1,k+2,k,k+2,k+3);
  }
  try{
    const mesh={storage:'buffer',positions:gpu.buffer('CFD native thin wall vertices',Float32Array.from(vertices)),
      indices:gpu.buffer('CFD native thin wall indices',Uint32Array.from(indices)),triangleCount:4,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
    const capture={meshes:[mesh],assertCurrent(){}}, {values}=await graphIntersections(device,g,tree,capture,expect.length);
    let missed=0,falseHits=0,twoCrossings=0,maxParameterError=0;
    for(let k=0;k<expect.length;k++){const ref=expect[k],first=values[2*k],last=values[2*k+1];
      if(ref.length===2)twoCrossings++;
      if(!ref.length){if(Number.isFinite(first))falseHits++;continue;}
      if(!Number.isFinite(first)){missed++;continue;}
      maxParameterError=Math.max(maxParameterError,Math.abs(first-ref[0]),Math.abs(last-ref.at(-1)));
    }
    const length=Math.hypot(1,.41,.22),normal=[1,-.41,.22].map(x=>x/length),seeds=[],truth=[],layers=[.00012,.00034,.001,.004];
    // Project from both sides and from the gap. For inward-pointing hints
    // the growing layer must stop at the opposite sheet. Reverse the normal
    // hints independently of triangle winding.
    for(let i=0;i<53;i++){
      const d=i%2?high:low,y=.035*Math.sin(i*.83),z=.034*Math.cos(i*.37),point=[d+.41*y-.22*z,y,z];
      const delta=.00019*Math.cos(i*.23),s=i%3===0?-1:1,n=normal.map(v=>s*v);
      seeds.push({p:point.map((v,a)=>v+delta*normal[a]),n});truth.push({point,n,d,s});
    }
    const fit=await fitNativeGraphAnchors(device,seeds,layers,capture);
    let maxAnchorErrorM=0,maxNormalError=0,visibilityErrors=0;
    for(const [i,a] of fit.anchors.entries()){
      const {point,n,d,s}=truth[i],toOther=((d===low?high:low)-d)/(s*length);
      maxAnchorErrorM=Math.max(maxAnchorErrorM,Math.hypot(...a.p.map((v,k)=>v-point[k])));
      maxNormalError=Math.max(maxNormalError,Math.hypot(...a.n.map((v,k)=>v-n[k])));
      for(const [k,offset] of [-layers[0],...layers].entries()){
        if(a.clear[k]!==(offset*toOther<=0||Math.abs(offset)<Math.abs(toOther)))visibilityErrors++;
      }
    }
    return {segments:expect.length,twoCrossings,missed,falseHits,maxParameterError,anchors:seeds.length,maxAnchorErrorM,maxNormalError,visibilityErrors,
      pass:twoCrossings>0&&missed===0&&falseHits===0&&maxParameterError<3e-5&&maxAnchorErrorM<1e-7&&maxNormalError<1e-5&&visibilityErrors===0};
  }finally{gpu.close();}
}
