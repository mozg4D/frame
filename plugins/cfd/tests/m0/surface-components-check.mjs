import {captureFlowSurfaces,gpuScope,nativeSurfaceComponents} from '../../plugin.js';
import {researchSceneContext} from './native-geometry.mjs';

// Independent whole-triangle clipping in physical xy and a CPU flood fill
// over known native indices. The GPU uses three barycentric corner patches.
function clippedTriangle(a,b,c){
  let polygon=[a,b,c];
  for(const sign of [-1,1]){
    const inside=p=>.5-sign*p[0],out=[];let last=polygon.at(-1);
    for(const p of polygon){const u=inside(last),v=inside(p);
      if(u*v<0)out.push(p.map((x,j)=>last[j]+(x-last[j])*u/(u-v)));
      if(v>=0)out.push(p);last=p;
    }polygon=out;
  }
  let area=0;const first=polygon[0],sum=[0,0,0];
  for(let i=2;i<polygon.length;i++){const u=polygon[i-1],v=polygon[i];
    const s=.5*Math.abs((u[0]-first[0])*(v[1]-first[1])-(u[1]-first[1])*(v[0]-first[0]));area+=s;
    for(let k=0;k<3;k++)sum[k]+=s*(first[k]+u[k]+v[k])/3;
  }
  return {area,sum,polygon};
}

export async function verifySurfaceComponents(device){
  const vertices=[],faces=[],segments=11;
  for(let i=0;i<=segments;i++)vertices.push([-.55+.1*i,.16,.03],[-.55+.1*i,.24,.03]);
  for(let i=0;i<segments;i++)faces.push([2*i,2*i+2,2*i+1],[2*i+1,2*i+2,2*i+3]);
  // Disconnected logical islands inside the same spatial neighbourhood.
  for(let j=0;j<13;j++){const i=vertices.length,x=-.42+.001*j,z=.040+.0003*j;
    vertices.push([x,.18,z],[x+.027,.18,z],[x,.20,z]);faces.push([i,i+1,i+2]);}
  const frame={axes:[[0,1,0],[-1,0,0],[0,0,1]],originWorldM:[1,2,3]},world=([x,y,z])=>[1-y,2+x,3+z];
  const inverse=[1000,0,0,0,0,1000,0,0,0,0,1000,0,0,0,0,1],f={U:1,omega:0,maxSpeed:1};
  const call=(name,args={})=>frameAI.call(name,args),cases=[];
  for(const storage of ['auto','texture']){
    await call('scene.new');const box=await call('scene.create',{type:'cfd'});
    await call('mesh.create',{name:'Disconnected surface patches',storage,vertices:vertices.flat().map(v=>1000*v),indices:faces.flat()});
    await call('diagnostics.frame',{frames:3});
    const capture=captureFlowSurfaces(device,researchSceneContext(frameEngine),box.hash),mesh=capture.meshes[0];
    if(mesh.vertexCount!==vertices.length||mesh.storage!==(storage==='texture'?'texture':'buffer'))throw Error('Expected original logical indices and storage');
    const gpu=gpuScope(device);
    try{
      let previous=null;const runs=[];
      for(const edited of [false,true]){
        const chunks=[],shown=[],rows=[];
        for(const [i,ids] of faces.entries()){
          const points=ids.map(id=>vertices[id]),[a,b,c]=points,seg=Math.floor(i/2),island=i-2*segments;
          const area=.5*Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])),clip=clippedTriangle(a,b,c);
          const first=edited?seg>=1&&seg<=3:seg<=2;
          const density=island>=0?5+.17*island:first?8+(edited?1:0):seg>=9?11:1;
          const gamma=island>=0?0:seg<=2?.7:seg>=7?.4:.08,shape=island>=0?0:seg<4?20:seg<6?-25:seg<8?23:1;
          rows.push({i,ids,points,area,clip,density,gamma,shape,watts:density*clip.area});
        }
        for(const [first,last] of [[0,3],[3,7],[7,16],[16,faces.length]]){
          const count=last-first,sites=new Float32Array(48*count),field=new Float32Array(4*count),loss=new Float32Array(4*count),shape=new Float32Array(4*count);
          for(const r of rows.slice(first,last)){
            const j=r.i-first;
            for(let k=0;k<3;k++){const p=r.points[k].map((x,d)=>(x+r.points.reduce((s,v)=>s+v[d],0)/3)/2);
              sites.set([...p,r.area/3,0,0,1,1],48*j+16*k);}
            field.set([0,r.gamma,1,r.clip.area/r.area],4*j);
            loss.set([.37*r.density,r.watts,r.clip.area,0],4*j);shape.set([r.shape,.001*r.shape*r.clip.area,r.clip.area,0],4*j);
          }
          chunks.push({mesh,first,triangles:count,site:gpu.buffer('Analytic patch positions and area',sites),cover:true});
          shown.push({occurrence:0,visible:gpu.buffer('Analytic reversal',field),loss:gpu.buffer('Analytic dissipation',loss),shape:gpu.buffer('Analytic derivative',shape)});
        }
        const total=rows.reduce((s,r)=>s+r.watts,0),totalArea=rows.reduce((s,r)=>s+r.clip.area,0);
        const statistics={surfaceColorScale:{lossDensity:1.8,shapeNPerM3:15},separationStats:{sampledAreaM2:totalArea}};
        const measured=await nativeSurfaceComponents(device,chunks,shown,statistics,{inverse},frame,f,
          {attributedPowerW:total,forceNormalizationN:.37*total},previous,capture.assertCurrent,edited);
        const sets=[measured.dragHotspots,measured.separationZones,measured.shapeSensitivitySummary];
        const expected=[[],[],[]];
        for(let mode=0;mode<4;mode++){
          const active=new Set(rows.filter(r=>r.clip.area>0&&[.37*r.density>=1.8,r.gamma>=.2,r.shape>=15,r.shape<=-15][mode])),groups=[];
          while(active.size){const q=[active.values().next().value],cluster=[];active.delete(q[0]);
            while(q.length){const r=q.pop();cluster.push(r);for(const t of active)if(t.ids.some(id=>r.ids.includes(id))){q.push(t);active.delete(t);}}
            const area=cluster.reduce((s,r)=>s+r.clip.area,0),weights=cluster.map(r=>[r.watts,r.clip.area,r.shape*.001*r.clip.area,r.shape*.001*r.clip.area][mode]);
            const strength=Math.abs(weights.reduce((s,x)=>s+x,0)),points=cluster.flatMap(r=>r.clip.polygon.map(world));
            const centroid=world([0,1,2].map(k=>cluster.reduce((s,r)=>s+r.clip.sum[k],0)/area));
            groups.push({mode,root:Math.min(...cluster.flatMap(r=>r.ids)),area,strength,centroid,gamma:cluster.reduce((s,r)=>s+r.clip.area*r.gamma,0)/area,
              bbox:[...centroid.map((_,k)=>Math.min(...points.map(p=>p[k]))),...centroid.map((_,k)=>Math.max(...points.map(p=>p[k])))]});
          }expected[Math.min(2,mode)].push(...groups);
        }
        let maxRelative=0,maxPosition=0;
        const check=(a,b)=>{maxRelative=Math.max(maxRelative,Math.abs(a-b)/Math.max(1e-12,Math.abs(b)));};
        for(const [i,list] of sets.entries()){
          const ref=expected[i].sort((a,b)=>b.strength-a.strength||a.root-b.root).slice(0,8);
          if(list.length!==ref.length)throw Error('Unexpected component count '+i+' '+list.length+'/'+ref.length);
          for(const r of list){
            const e=ref.find(v=>v.mode===r.mode&&v.root===r.anchorVertex);if(!e)throw Error('Unexpected native patch root '+r.anchorVertex);
            check(r.areaM2,e.area);check(r.strength,e.strength);
            if(i===0){check(r.sharePercent,100*e.strength/total);check(r.forceN,.37*e.strength);}
            if(i===1){check(r.meanGammaRev,e.gamma);check(r.areaFraction,e.area/totalArea);}
            if(i===2){check(r.sensitivityNPerMm,(e.mode===2?1:-1)*e.strength);if(r.action!==(e.mode===2?'push_in':'pull_out'))throw Error('Wrong derivative sign');}
            maxPosition=Math.max(maxPosition,...r.centroid.map((x,k)=>Math.abs(x-e.centroid[k])),...r.bbox.map((x,k)=>Math.abs(x-e.bbox[k])),
              ...r.meanNormal.map((x,k)=>Math.abs(x-Number(k===2))));
          }
        }
        const main=measured.dragHotspots.find(r=>r.anchorVertex===(edited?2:0));let match=true;
        if(edited){const old=previous.dragHotspots.find(r=>r.anchorVertex===0);
          match=main.persistentId===old.persistentId&&main.matchedAnchorCount>0&&Math.abs(main.deltaFromPrevN-(main.forceN-old.forceN))<1e-10;}
        const unique=sets.every(list=>new Set(list.map(r=>r.persistentId)).size===list.length);
        runs.push({edited,maxRelative,maxPosition,counts:sets.map(s=>s.length),trackedId:main.persistentId,anchor:main.anchorVertex,
          matchedAnchorCount:main.matchedAnchorCount,pass:unique&&match&&maxRelative<1e-5&&maxPosition<5e-6});
        previous=measured;
      }cases.push({storage:mesh.storage,runs});
    }finally{gpu.close();}
  }
  return {pass:cases.every(c=>c.runs.every(r=>r.pass)),cases};
}
