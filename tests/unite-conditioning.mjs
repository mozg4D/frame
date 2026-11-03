import {boxMesh,combineMeshes,meshMetrics} from './unite-fixtures.mjs';

// Test-only exact-coordinate connectivity and translation-stable volumes.
// This detects a tiny disconnected solid even when its volume is below the
// rounding error of the large component's aggregate signed volume.
function components(mesh){
 const vertices=mesh.vertices,indices=mesh.indices,ids=new Uint32Array(vertices.length/3),keys=new Map(),points=[];
 for(let i=0;i<ids.length;i++){const p=vertices.slice(i*3,i*3+3),key=p.join(',');if(!keys.has(key)){keys.set(key,points.length);points.push(p);}ids[i]=keys.get(key);}
 const parent=Uint32Array.from(points,(_,i)=>i),root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 for(let i=0;i<indices.length;i+=3){const a=root(ids[indices[i]]);for(let j=1;j<3;j++){const b=root(ids[indices[i+j]]);parent[b]=a;}}
 const groups=new Map();for(let i=0;i<indices.length;i+=3){const id=root(ids[indices[i]]);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(...indices.slice(i,i+3));}
 return[...groups.values()].map(faces=>{const ids=[...new Set(faces)],used=ids.map(i=>vertices.slice(i*3,i*3+3)),origin=used[0],local=vertices.map((v,i)=>v-origin[i%3]),geometry={vertices:local,indices:faces},metrics=meshMetrics(geometry);return{faces,metrics,bounds:{min:[0,1,2].map(k=>Math.min(...used.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...used.map(p=>p[k])))}};});
}

export async function uniteConditioningChecks(page){
 const checks=[],timings=[],results=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));},raw=hash=>page.evaluate(async hash=>{const r=await frameEngine.readGeometry(hash);return{vertices:Array.from(r.vertices),indices:Array.from(r.indices)};},hash),small=Math.fround(1e-8),cases=[
  {name:'tiny disconnected solid beside a distant large solid',geometry:combineMeshes([boxMesh([0,0,0],[small,small,small]),boxMesh([1000,-50,-50],[1100,50,50])]),expectedComponents:2,inspect:parts=>{const tiny=parts.find(p=>p.bounds.max.every((v,k)=>v<=small*1.001&&p.bounds.min[k]>=-small*.001));check('Tiny solid cannot silently disappear',!!tiny&&tiny.bounds.min.every(v=>v===0)&&tiny.bounds.max.every(v=>Math.abs(v-small)<small*1e-5),parts.map(p=>({bounds:p.bounds,triangles:p.metrics.triangles,volume:p.metrics.signedVolume})));check('Tiny solid retains its independent positive volume',Math.abs(tiny.metrics.signedVolume/small**3-1)<1e-4,{actual:tiny.metrics.signedVolume,expected:small**3});}},
  {name:'far translated valid Float32 unit solid',geometry:boxMesh([1e6,1e6,1e6],[1e6+1,1e6+1,1e6+1]),expectedComponents:1,inspect:parts=>{check('Far unit solid preserves exact representable coordinates and volume',parts[0].bounds.min.every(v=>v===1e6)&&parts[0].bounds.max.every(v=>v===1e6+1)&&Math.abs(parts[0].metrics.signedVolume-1)<1e-6,{bounds:parts[0].bounds,volume:parts[0].metrics.signedVolume});}},
  ...[1e-8,1e-10,1e-25].map(size=>({name:'tiny solid crossing a large plane at scale '+size,geometry:combineMeshes([boxMesh([-size,-size,-size],[size,size,size]),boxMesh([0,-50,-50],[1000,50,50])]),expectedComponents:1,inspect:(parts,geometry)=>{
   check('Crossing tiny solid retains its protruding boundary at scale '+size,parts[0].bounds.min[0]===Math.fround(-size),parts[0].bounds);
   const internal=[];for(let i=0;i<geometry.indices.length;i+=3){const center=[0,1,2].map(k=>geometry.indices.slice(i,i+3).reduce((s,j)=>s+geometry.vertices[j*3+k]/3,0));if(center[0]>0&&center[0]<1000&&Math.abs(center[1])<50&&Math.abs(center[2])<50)internal.push(i/3);}
   check('Crossing tiny solid has no facets inside the large solid at scale '+size,internal.length===0,internal);
  }})),
  {name:'normalization cannot silently underflow captured coordinates',geometry:combineMeshes([boxMesh([0,0,0],[1e-30,1e-30,1e-30]),boxMesh([1e30,0,0],[2e30,1e30,1e30])]),expectedComponents:2,inspect:()=>check('Unrepresentable normalized source must reject',false)}
 ];
 try{
  for(const [index,test]of cases.entries()){
   await call('scene.new');await call('render.stop');const owner=await call('mesh.create',{name:test.name,...test.geometry}),before=await call('diagnostics.mesh',{id:owner.hash,geometry:true}),sceneBefore=JSON.stringify((await call('scene.inspect')).objects);let result,error;const started=performance.now();
   try{result=await call('geometry.unite',{ids:[owner.hash],selectedIslands:false});}catch(e){error={code:e.code,message:e.message};}
   const ms=performance.now()-started,limit=index===0?2000:1000;timings.push({name:test.name,ms,limit});check(test.name+' bounded complete operation or rejection',ms<limit,{ms,limit});
   if(error){
    check(test.name+' rejects with an explicit numerical conditioning diagnostic',error.code==='PRECISION_LIMIT'||/precision|conditioning|numerically ambiguous|numerical.*(?:limit|resolution|ambig)/i.test(error.message),error);
    const after=await call('diagnostics.mesh',{id:owner.hash,geometry:true});check(test.name+' precision rejection leaves exact source geometry and owners unchanged',JSON.stringify((await call('scene.inspect')).objects)===sceneBefore&&before.positionsSHA256===after.positionsSHA256&&before.indicesSHA256===after.indicesSHA256,{before,after});results.push({name:test.name,outcome:'atomic-precision-rejection',error,ms});
   }else{
    check(test.name+' publishes an explicit polygon result',result.object?.type==='mesh'&&result.object.mesh?.triangles>0,result);const geometry=await raw(result.object.hash),parts=components(geometry);check(test.name+' preserves every solid with exact closed oriented topology',parts.length===test.expectedComponents&&parts.every(p=>p.metrics.triangles>0&&p.metrics.finite&&p.metrics.indicesValid&&p.metrics.boundaryEdges===0&&p.metrics.nonmanifoldEdges===0&&p.metrics.inconsistentEdges===0&&p.metrics.degenerate===0&&p.metrics.duplicates===0&&p.metrics.signedVolume>0),parts.map(p=>({bounds:p.bounds,metrics:p.metrics})));
    test.inspect(parts,geometry);results.push({name:test.name,outcome:'preserved',components:parts.map(p=>({bounds:p.bounds,metrics:p.metrics})),report:result.report,ms});
   }
  }
  // Sweep the side-probe rounding boundary, including the former seven-ULP
  // empty-result bug. These are representable closed cavities, so a silent
  // empty/filled result or loss of either shell is always a regression.
  for(let steps=1;steps<=32;steps++){
   await call('scene.new');await call('render.stop');const inner=Math.fround(5-steps*2**-21),expected=1000-(inner*2)**3,name='Hollow box wall at '+steps+' Float32 ULP',owner=await call('mesh.create',{name,...combineMeshes([boxMesh([-5,-5,-5],[5,5,5]),boxMesh([-inner,-inner,-inner],[inner,inner,inner])])}),started=performance.now(),result=await call('geometry.unite',{ids:[owner.hash],selectedIslands:false}),ms=performance.now()-started;timings.push({name,ms,limit:1000});
   check(name+' completed-operation latency',ms<1000,{ms,limit:1000});check(name+' retains both polygon shells',result.object?.mesh?.triangles===24,result);
   const geometry=await raw(result.object.hash),metrics=meshMetrics(geometry);check(name+' closed oriented cavity volume',metrics.boundaryEdges===0&&metrics.nonmanifoldEdges===0&&metrics.inconsistentEdges===0&&metrics.degenerate===0&&Math.abs(metrics.signedVolume-expected)<Math.max(1e-10,expected*1e-7),{metrics,expected});check(name+' preserves every captured coordinate',geometry.vertices.length===48&&geometry.vertices.every(v=>Math.abs(v)===5||Math.abs(v)===inner),geometry.vertices);
   results.push({name,outcome:'preserved-cavity',steps,expectedVolume:expected,metrics,report:result.report,ms});
  }
  await call('scene.new');return{pass:true,checks,timings,results};
 }catch(error){return{pass:false,checks,timings,results,error:error.stack||error.message};}
}
