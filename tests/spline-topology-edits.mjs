import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

function cageWithOverlappingSpans(base,source,target){
  const old=structuredClone(base);
  for(const e of Object.values(old.segments)){
    if(e.a===source)e.a=target;
    if(e.b===source)e.b=target;
  }
  for(const q of old.sequences)if(q.first===source)q.first=target;
  delete old.vertices[source];
  return old;
}

export async function splineTopologyEditChecks(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const K=Function('return ('+html.match(/<script id="frame-spline-kernel"[^>]*>([\s\S]*?)<\/script>/)[1]+')')()();
  const checks=[],check=(name,fn)=>{fn();checks.push({name,pass:true});};
  function chain(count,closed=false){
    const data=K.createSplineData(),seq=K.addSplineSequence(data,closed),v=[],s=[];
    for(let i=0;i<count;i++)v.push(K.addSplineVertex(data,closed?[50*Math.cos(2*Math.PI*i/count),50*Math.sin(2*Math.PI*i/count),0]:[10*i,i%2,0]));
    for(let i=0;i<count-Number(!closed);i++)s.push(K.addSplineSegment(data,seq,v[i],v[(i+1)%count]));
    return {data,v,s,seq};
  }
  function valid(data){
    const result=K.validateSpline(data);assert.deepEqual(result.errors,[]);
    assert.deepEqual(data.sequences.flatMap(q=>q.segments).sort(),Object.keys(data.segments).sort());
  }
  check('Deleting interior runs preserves endpoints, exterior cubic handles, Border and accuracy',()=>{
    const {data,v,s}=chain(7);
    data.segments[s[0]].ha=[2,3,0];data.segments[s[3]].hb=[-1,2,0];
    data.segments[s[2]].boundary=true;data.segments[s[1]].approximation={angle:3};
    K.deleteSplineElements(data,{vertices:[v[3],v[1],v[2],v[5]]});
    valid(data);assert.deepEqual(Object.keys(data.vertices),[v[0],v[4],v[6]]);
    const [a,b]=data.sequences[0].segments.map(id=>data.segments[id]);
    assert.deepEqual([a.a,a.b,b.a,b.b],[v[0],v[4],v[4],v[6]]);
    assert.deepEqual([a.ha,a.hb,a.boundary,a.approximation.angle],[[2,3,0],[-1,2,0],true,3]);
  });
  check('Closed runs wrap across the first point and collapse cleanly to one straight edge',()=>{
    const {data,v}=chain(6,true);
    K.deleteSplineElements(data,{vertices:[v[5],v[0]]});valid(data);
    assert.equal(data.sequences.length,1);assert.equal(data.sequences[0].closed,true);
    assert.equal(data.sequences[0].segments.length,4);
    K.deleteSplineElements(data,{vertices:[v[1],v[2]]});valid(data);
    assert.equal(Object.keys(data.segments).length,1);assert.equal(data.sequences[0].closed,false);
    K.deleteSplineElements(data,{vertices:[v[3]]});valid(data);assert.deepEqual(data.sequences,[]);
  });
  check('Explicit edge cuts and deleted junctions leave gaps',()=>{
    const {data,v,s}=chain(8);
    const spur=K.addSplineVertex(data,[0,5,0]);K.addSplineSegment(data,K.addSplineSequence(data),v[5],spur);
    K.deleteSplineElements(data,{vertices:[v[2],v[5]],segments:[s[2]]});valid(data);
    assert.deepEqual(Object.keys(data.segments),[s[0],s[3],s[6]]);
    assert.deepEqual(data.sequences.map(q=>q.segments),[[s[0]],[s[3]],[s[6]]]);
  });
  check('Two reversed sequence ends join through their shared degree-two point',()=>{
    const {data,v,s}=chain(2),c=K.addSplineVertex(data,[20,0,0]);
    K.addSplineSegment(data,K.addSplineSequence(data),c,v[1],[1,2,0]);
    data.segments[s[0]].ha=[3,4,0];K.deleteSplineElements(data,{vertices:[v[1]]});valid(data);
    const [e]=Object.values(data.segments);assert.deepEqual([e.a,e.b,e.ha,e.hb],[v[0],c,[3,4,0],[1,2,0]]);
  });
  check('Dissolving exact subdivisions reconstructs the cubic, including a stationary join',()=>{
    for(const stationary of [false,true]){
      const {data,v,s}=chain(2),edge=data.segments[s[0]];
      if(stationary){data.vertices[v[0]]=[-1,0,0];data.vertices[v[1]]=[1,0,0];edge.ha=[2,0,0];edge.hb=[-2,0,0];}
      else{edge.ha=[3,8,0];edge.hb=[-1,-2,4];}
      const original=K.segmentPoints(data,edge),a=K.splitSplineSegment(data,edge.id,stationary?.5:.23),b=K.splitSplineSegment(data,a.right,.61);
      K.deleteSplineElements(data,{vertices:[b.vertex,a.vertex]});valid(data);
      const [bridge]=Object.values(data.segments),restored=K.segmentPoints(data,bridge);
      assert.ok(restored.every((p,i)=>p.every((x,k)=>Math.abs(x-original[i][k])<1e-12)));
    }
  });
  check('Weld keeps the destination span and its sequence, and preserves distinct curved parallel arcs',()=>{
    const {data,v,s}=chain(2),moving=K.addSplineVertex(data,data.vertices[v[1]]);
    const duplicate=K.addSplineSegment(data,K.addSplineSequence(data),moving,v[0]),arc=K.addSplineSegment(data,K.addSplineSequence(data),moving,v[0],[0,2,0]);
    data.segments[duplicate].boundary=true;
    K.weldSplineVertices(data,v[1],moving);valid(data);assert.deepEqual(Object.keys(data.segments),[s[0],arc]);
    assert.equal(data.segments[s[0]].boundary,true);assert.equal(data.segments[arc].a,v[1]);
  });
  check('Closing a single curved span retains its finite-area lobe',()=>{
    const {data,v,s}=chain(2),edge=data.segments[s[0]];
    edge.ha=[15,5,0];edge.hb=[-2,13,0];K.weldSplineVertices(data,v[0],v[1]);valid(data);
    assert.equal(data.sequences.length,1);assert.equal(data.sequences[0].closed,true);
    assert.equal(data.sequences[0].segments.length,2);
    assert.equal(K.buildSplineSurface.resolve(data).fills.length,1);
  });
  check('Every directed cube weld retains exactly the surviving face boundaries and a closed oriented mesh',()=>{
    const cube=K.primitive('cube',{'size x':30,'size y':55,'size z':80}),ids=Object.keys(cube.vertices);
    const corners=(data,f)=>f.loops[0].map(ref=>data.segments[ref.edge][ref.reversed?'b':'a']);
    const faces=K.buildSplineSurface.resolve(cube).fills.map(f=>corners(cube,f));
    for(const target of ids)for(const source of ids){
      if(source===target)continue;
      const data=structuredClone(cube);K.weldSplineVertices(data,target,source);valid(data);
      // Opposite corners of the same face fold its two sides back on themselves.
      const expected=faces.filter(face=>!face.includes(source)||face[(face.indexOf(source)+2)%4]!==target)
        .map(face=>[...new Set(face.map(id=>id===source?target:id))]);
      const surface=K.buildSplineSurface(data),mesh=surface.report.meshValidation;
      assert.deepEqual(surface.cells.map(f=>corners(data,f).sort().join('|')).sort(),expected.map(face=>face.sort().join('|')).sort());
      assert.equal(surface.report.closed,true);assert.ok(mesh.volume>0);
      assert.deepEqual([mesh.boundaryEdges,mesh.nonManifoldEdges,mesh.windingErrors,mesh.degenerate],[0,0,0,0]);
    }
  });
  check('A pinched component can coexist with an open sheet, and marked rims stay open',()=>{
    const cube=K.primitive('cube',{'size x':30,'size y':55,'size z':80}),ids=Object.keys(cube.vertices);
    K.weldSplineVertices(cube,ids[0],ids[7]);
    const isolated=K.buildSplineSurface.resolve(cube);
    assert.equal(isolated.diagnostics.pinchedVertices,1);assert.equal(isolated.diagnostics.vertexManifold,false);
    const corners=[[200,0,0],[250,0,0],[250,50,0],[200,50,0]].map(p=>K.addSplineVertex(cube,p)),q=K.addSplineSequence(cube,true);
    const rim=corners.map((v,i)=>K.addSplineSegment(cube,q,v,corners[(i+1)%4]));
    const combined=K.buildSplineSurface.resolve(cube);
    assert.deepEqual(combined.boundaryEdges.sort(),rim.sort());assert.equal(combined.fills.length,7);
    for(const e of Object.values(cube.segments))if(![e.a,e.b].includes(ids[0]))e.boundary=true;
    const open=K.buildSplineSurface.resolve(cube);
    assert.equal(open.diagnostics.pinchedVertices,0);assert.equal(open.fills.filter(f=>f.sides===3).length,6);
  });
  check('Previously welded cages resolve coincident spans without modifying their authored records',()=>{
    const cube=K.primitive('cube',{'size x':30,'size y':55,'size z':80}),ids=Object.keys(cube.vertices);
    const data=cageWithOverlappingSpans(cube,ids[0],ids[3]),original=structuredClone(data);
    const result=K.buildSplineSurface(data);
    assert.equal(result.cells.length,5);assert.equal(result.report.topologyDiagnostics.coincidentSpans,2);
    assert.equal(result.report.meshValidation.boundaryEdges,0);assert.deepEqual(data,original);
  });
  return {pass:true,checks};
}

export async function splineTopologyBrowserChecks(page){
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  const data=async id=>(await call('spline.inspect',{id})).data,checks=[],timings=[];
  const check=async(name,fn)=>{await fn();checks.push({name,pass:true});};
  const digest=id=>call('diagnostics.mesh',{id,geometry:true});
  const signature=g=>[g.positionsSHA256,g.indicesSHA256];
  const checkClosed=async id=>{
    const defects=await page.evaluate(async id=>{
      const {indices}=await frameEngine.readGeometry(id),edges=new Map();
      for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
        const a=indices[i+k],b=indices[i+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b);
        const counts=edges.get(key)||[0,0];counts[Number(a<b)]++;edges.set(key,counts);
      }
      return [...edges.values()].filter(([a,b])=>a!==1||b!==1).length;
    },id);
    assert.equal(defects,0);
  };
  const timed=async(name,fn)=>{const at=performance.now();await fn();const ms=performance.now()-at;timings.push({name,ms,limit:2500});assert.ok(ms<2500,name+' took '+ms+' ms');};
  await call('scene.new');
  const cube=await call('scene.create',{type:'cube'}),patch=await call('scene.convert',{id:cube.hash}),source=patch.sources[0],base=await data(source);
  const atPoint=p=>Object.keys(base.vertices).find(id=>p.every((v,k)=>v===base.vertices[id][k]));
  const a=atPoint([0,0,100]),b=atPoint([100,100,100]);
  const before=signature(await digest(patch.hash));
  await check('Viewport snap across a cube face, undo, redo, rebuild and HASH reload',async()=>{
    await call('view.set',{index:2,single:true,mode:'vertex',focus:patch.hash,snap:true,pivot:false});
    await call('scene.select',{ids:[source],mode:'vertex',components:[a]});
    const xy=async v=>(await call('view.project',{id:source,point:base.vertices[v]})).screen;
    await call('diagnostics.frame',{frames:1});const from=await xy(a),to=await xy(b);
    await timed('Pointer weld and completed Patch publication',async()=>{
      await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:6});await page.mouse.up();
      await page.waitForFunction(()=>!frameEngine.transforming&&!FrameSpline.isEditing());await call('scene.inspect');
    });
    const q=await call('spline.inspect',{id:patch.hash,cells:true});
    assert.equal(Object.keys(q.data.vertices).length,7,JSON.stringify({from,to,vertices:q.data.vertices,selection:(await call('scene.inspect')).selection}));assert.ok(q.data.vertices[b]&&!q.data.vertices[a]);assert.equal(q.report.cells,5);
    const edited=signature(await digest(patch.hash));assert.notDeepEqual(edited,before);await checkClosed(patch.hash);
    await call('edit.history',{action:'undo'});assert.deepEqual(signature(await digest(patch.hash)),before);
    await call('edit.history',{action:'redo'});assert.deepEqual(signature(await digest(patch.hash)),edited);
    await call('spline.rebuild',{id:patch.hash});assert.deepEqual(signature(await digest(patch.hash)),edited);
    const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'weld.hash',base64:saved.base64});
    assert.deepEqual(signature(await digest(patch.hash)),edited);
  });
  await check('Space-diagonal weld publishes six cells through the native worker',async()=>{
    const cage=await page.evaluate(({base,a,b})=>{FrameSpline.K().weldSplineVertices(base,b,a);return base;},{base,a:atPoint([0,0,0]),b});
    await call('spline.replace',{id:source,data:cage});const q=await call('spline.inspect',{id:patch.hash,cells:true});
    assert.equal(q.report.cells,6);assert.ok((await digest(patch.hash)).signedVolume>0);await checkClosed(patch.hash);
  });
  await check('Opening a saved cage with overlapping spans recovers the missing faces',async()=>{
    const old=cageWithOverlappingSpans(base,a,b);await call('spline.replace',{id:source,data:old});
    const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'previous-weld.hash',base64:saved.base64});
    const q=await call('spline.inspect',{id:patch.hash,cells:true});
    assert.equal(q.report.cells,5);assert.equal(Object.keys(q.data.segments).length,12);await checkClosed(patch.hash);
  });
  await check('Keyboard Delete dissolves a spline point and one Undo restores it',async()=>{
    await call('scene.new');const spline=await call('scene.create',{type:'spline'}),chain=await page.evaluate(()=>{
      const K=FrameSpline.K(),d=K.createSplineData(),q=K.addSplineSequence(d),v=[[0,0,0],[20,15,0],[50,0,0]].map(p=>K.addSplineVertex(d,p));
      K.addSplineSegment(d,q,v[0],v[1]);K.addSplineSegment(d,q,v[1],v[2]);return {d,v};
    });
    await call('spline.replace',{id:spline.hash,data:chain.d});const original=await data(spline.hash);
    await call('view.set',{index:2,single:true,mode:'vertex',focus:spline.hash});
    await call('scene.select',{ids:[spline.hash],mode:'vertex',components:[chain.v[1]]});
    await page.mouse.move(400,350);await page.locator('#frame-engine-canvas').focus();
    await timed('Delete and completed spline publication',async()=>{await page.keyboard.press('Delete');await call('scene.inspect');});
    const edited=await data(spline.hash),edges=Object.values(edited.segments);
    assert.deepEqual(edges.map(e=>[e.a,e.b]),[[chain.v[0],chain.v[2]]]);
    await call('edit.history',{action:'undo'});assert.deepEqual(await data(spline.hash),original);
    await call('edit.history',{action:'redo'});assert.deepEqual(await data(spline.hash),edited);
    await assert.rejects(call('spline.delete',{id:spline.hash,vertices:['missing']}));
    assert.deepEqual(await data(spline.hash),edited);
    const last=await call('spline.delete',{id:spline.hash,segments:[edges[0].id]});assert.equal(last.removed,true);
    await call('edit.history',{action:'undo'});assert.deepEqual(await data(spline.hash),edited);
  });
  return {pass:true,checks,timings};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  console.log(await splineTopologyEditChecks());
  if(!process.argv.includes('--cpu')){
    const s=await launch({headless:true}),errors=[];
    try{
      s.page.on('pageerror',e=>errors.push(e.message));await ready(s.page);
      await s.page.evaluate(()=>{if(frameEngine.renderer.device.adapterInfo.isFallbackAdapter)throw Error('Hardware GPU required');frameEngine.renderer.device.pushErrorScope('validation');});
      console.log(await splineTopologyBrowserChecks(s.page));
      assert.equal(await s.page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message||null),null);assert.deepEqual(errors,[]);
    }finally{await s.close();}
  }
}
