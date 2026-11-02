import {launch,ready} from '../../../tools/browser.mjs';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {invalidPlanarFill} from './planar-fill-oracle.mjs';

function capCage({angle=20,radii=[1],centers=[[0,0]],oblique=false,arcs=4}={}){
 const data={version:2,approximation:{angle},next:10000,vertices:{},segments:{},sequences:[],freeHandles:{}};
 const point=([x,y])=>[x,y,oblique?x+y:0];
 for(let ring=0;ring<radii.length;ring++){
  const r=radii[ring],[cx,cy]=centers[ring]||centers[0],prefix='r'+ring,ids=[],handle=arcs===4?.5:4/3*Math.tan(Math.PI/(2*arcs));
  const samples=Array.from({length:arcs},(_,i)=>arcs===4?[[1,0],[0,1],[-1,0],[0,-1]][i]:[Math.cos(i*2*Math.PI/arcs),Math.sin(i*2*Math.PI/arcs)]);
  for(let i=0;i<arcs;i++)data.vertices[prefix+'v'+i]=point([cx+r*samples[i][0],cy+r*samples[i][1]]);
  for(let i=0;i<arcs;i++){
   const a=samples[i],b=samples[(i+1)%arcs],id=prefix+'s'+i,ha=point([-r*handle*a[1],r*handle*a[0]]),hb=point([r*handle*b[1],-r*handle*b[0]]);
   data.segments[id]={id,a:prefix+'v'+i,b:prefix+'v'+((i+1)%arcs),ha,hb,sequence:prefix,soft:true};ids.push(id);
  }
  data.sequences.push({id:prefix,closed:true,first:prefix+'v0',segments:ids});
 }
 return data;
}

// Independent sampled distance/winding oracle, using the authored cubics and
// the actual native GPU triangles. It does not reuse evaluator error formulas.
function capDistances({vertices,indices,data,cells}){
 const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=a=>Math.hypot(...a);
 const segment=(p,a,b)=>{const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/dot(d,d)));return length(sub(p,a.map((x,i)=>x+t*d[i])));};
 const triangle=(p,a,b,c)=>{const u=sub(b,a),v=sub(c,a),w=sub(p,a),uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),wu=dot(w,u),wv=dot(w,v),den=uu*vv-uv*uv,s=(wu*vv-wv*uv)/den,t=(wv*uu-wu*uv)/den;if(s>=0&&t>=0&&s+t<=1)return length(w.map((x,i)=>x-s*u[i]-t*v[i]));return Math.min(segment(p,a,b),segment(p,b,c),segment(p,c,a));};
 const points=Array.from({length:vertices.length/3},(_,i)=>vertices.slice(3*i,3*i+3)),triangles=Array.from({length:indices.length/3},(_,i)=>indices.slice(3*i,3*i+3).map(j=>points[j]));
 let normal=null,origin=null;const loops=[];
 for(const refs of cells[0].loops){const loop=[];for(const ref of refs){const e=data.segments[ref.edge],a=data.vertices[e.a],b=data.vertices[e.b],cp=[a,a.map((x,i)=>x+e.ha[i]),b.map((x,i)=>x+e.hb[i]),b];if(ref.reversed)cp.reverse();if(!origin)origin=cp[0];for(let i=0;i<512;i++){const t=i/512,s=1-t;loop.push([0,1,2].map(k=>s**3*cp[0][k]+3*s*s*t*cp[1][k]+3*s*t*t*cp[2][k]+t**3*cp[3][k]));}}loops.push(loop);}
 for(let i=1;i+1<loops[0].length&&!normal;i++){const n=cross(sub(loops[0][i],origin),sub(loops[0][i+1],origin));if(length(n)>1e-8)normal=n;}
 let drop=0;for(let i=1;i<3;i++)if(Math.abs(normal[i])>Math.abs(normal[drop]))drop=i;const axes=[0,1,2].filter(k=>k!==drop),inside=p=>{let value=false;for(const loop of loops)for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];if(a[axes[1]]>p[axes[1]]!==b[axes[1]]>p[axes[1]]&&p[axes[0]]<(b[axes[0]]-a[axes[0]])*(p[axes[1]]-a[axes[1]])/(b[axes[1]]-a[axes[1]])+a[axes[0]])value=!value;}return value;};
 const nativeDistance=p=>Math.min(...triangles.map(t=>triangle(p,...t))),authoredDistance=p=>inside(p)?Math.abs(dot(sub(p,origin),normal))/length(normal):Math.min(...loops.map(loop=>Math.min(...loop.map((a,i)=>segment(p,a,loop[(i+1)%loop.length])))));
 let toNative=0,toAuthored=0;
 for(const loop of loops)for(let i=0;i<loop.length;i+=4)toNative=Math.max(toNative,nativeDistance(loop[i]));
 const bounds=axes.map(k=>[Math.min(...loops.flat().map(p=>p[k])),Math.max(...loops.flat().map(p=>p[k]))]);
 for(let i=0;i<=24;i++)for(let j=0;j<=24;j++){const p=[0,0,0];p[axes[0]]=bounds[0][0]+i/24*(bounds[0][1]-bounds[0][0]);p[axes[1]]=bounds[1][0]+j/24*(bounds[1][1]-bounds[1][0]);p[drop]=origin[drop]-axes.reduce((s,k)=>s+normal[k]*(p[k]-origin[k]),0)/normal[drop];if(inside(p))toNative=Math.max(toNative,nativeDistance(p));}
 for(const t of triangles)for(const weights of [[1,0,0],[.5,.5,0],[0,.5,.5],[.5,0,.5],[1/3,1/3,1/3]]){const p=[0,1,2].map(k=>weights.reduce((s,w,i)=>s+w*t[i][k],0));toAuthored=Math.max(toAuthored,authoredDistance(p));}
 return {toNative,toAuthored,maximum:Math.max(toNative,toAuthored),triangles:triangles.length};
}

export async function planarAccuracyChecks(page){
 const checks=[],timings=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),check=(name,pass,detail)=>{checks.push({name:'Mill planar source: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const reset=async()=>{await call('scene.new');return call('plugins.create',{plugin:'mill'});};
 const patch=async data=>{const source=await call('scene.create',{type:'spline'});await call('spline.replace',{id:source.hash,data});const start=performance.now(),owner=await call('scene.create',{type:'spline_patch',inputs:[source.hash]});timings.push({name:'Mill curved planar native build',ms:performance.now()-start,limit:1500});return {source,owner};};
 const capture=(cnc,owner,geometry=false)=>page.evaluate(async({cnc,owner,geometry})=>{const n=nodes.find(n=>n.nativeHash===owner),state=FrameSpline.states.get(n.id),mesh=frameEngine.pluginSnapshot(cnc,[]).meshes.find(m=>m.hash===owner),raw=geometry?await frameEngine.readGeometry(owner):null;return {accuracy:mesh?.sourceAccuracy,report:state?.report,data:geometry?state.data:null,cells:geometry?FrameSpline.K().buildSplineSurface.resolve(state.data).fills:null,...raw?{vertices:Array.from(raw.vertices),indices:Array.from(raw.indices)}:{}};},{cnc:cnc.hash,owner:owner.hash,geometry});
 try{
  const fault=await invalidPlanarFill();check('nested filled disks cannot masquerade as an even-odd cap',!fault.accuracy.surfaceCertified&&fault.accuracy.reason==='SOURCE_PLANAR_TRIANGULATION',fault);
  let coarse;
  for(const angle of [60,6]){
   const cnc=await reset(),{owner}=await patch(capCage({angle})),r=await capture(cnc,owner,true),distance=capDistances(r);
   check(angle+' degree curved cap has a proved source bound',!owner.buildError&&r.accuracy.surfaceCertified&&r.accuracy.surfaceError>0,r.accuracy);
   check(angle+' degree cap bound encloses both independent distance directions',distance.maximum>0&&distance.maximum<r.accuracy.surfaceError,{accuracy:r.accuracy,...distance});
   check(angle+' degree open cap never becomes a solid certificate',!r.accuracy.solidEnvelopeCertified&&r.accuracy.reason==='SOURCE_OPEN_PARAMETERIZATION',r.accuracy);
   if(coarse)check('finer cap sampling reduces actual and proved error',r.accuracy.surfaceError<coarse.error&&distance.maximum<coarse.distance,{coarse,fine:{error:r.accuracy.surfaceError,...distance}});else coarse={error:r.accuracy.surfaceError,distance:distance.maximum};
  }
  for(const options of [{angle:20,oblique:true},{angle:30,radii:[2,1.95]}]){
   const cnc=await reset(),{owner}=await patch(capCage(options)),r=await capture(cnc,owner,true),distance=capDistances(r),label=options.oblique?'oblique plane':'narrow curved hole';
   check(label+' has a proved filled-cap envelope',r.accuracy.surfaceCertified&&distance.maximum<r.accuracy.surfaceError,{accuracy:r.accuracy,...distance});
   if(!options.oblique){const hole=r.cells[0].loops[1].map(ref=>{const e=r.data.segments[ref.edge];return r.data.vertices[ref.reversed?e.b:e.a];}),p=[0,1,2].map(k=>hole.reduce((sum,q)=>sum+q[k]/hole.length,0)),sub=(a,b)=>a.map((x,k)=>x-b[k]),dot=(a,b)=>a.reduce((sum,x,k)=>sum+x*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],inHole=r.indices.some((_,i)=>i%3===0&&(()=>{const tri=r.indices.slice(i,i+3).map(id=>r.vertices.slice(id*3,id*3+3)),n=cross(sub(tri[1],tri[0]),sub(tri[2],tri[0]));return tri.every((a,j)=>dot(cross(sub(tri[(j+1)%3],a),sub(p,a)),n)>=-1e-12);})());check('a cap hole is absent from actual native triangles',!inHole,{center:p});}
  }
  {
   const cnc=await reset(),data={version:2,approximation:{angle:20},next:10,vertices:{a:[-1,0,0],b:[1,0,0]},segments:{ab:{id:'ab',a:'a',b:'b',ha:[0,1,0],hb:[0,1,0],sequence:'lens'},ba:{id:'ba',a:'b',b:'a',ha:[0,-1,0],hb:[0,-1,0],sequence:'lens'}},sequences:[{id:'lens',closed:true,first:'a',segments:['ab','ba']}],freeHandles:{}},built=await patch(data),r=await capture(cnc,built.owner,true),distance=capDistances(r);
   check('a two-curve lens has a proved filled-cap bound',r.accuracy.surfaceCertified&&distance.maximum>0&&distance.maximum<r.accuracy.surfaceError,{accuracy:r.accuracy,...distance});
  }
  let cnc=await reset(),data=capCage({radii:[1,1],centers:[[-3,0],[3,0]]}),built=await patch(data),before=await capture(cnc,built.owner,true);
  data.segments.r0s0.ha[1]=.9;await call('spline.replace',{id:built.source.hash,data});const changed=await capture(cnc,built.owner,true);
  check('an edited cell and retained cap proofs share the native incremental path',changed.accuracy.surfaceCertified&&changed.report.cachedCells>=1&&changed.report.cpuTriangleCacheBytes===0,{accuracy:changed.accuracy,report:changed.report});
  check('source edits invalidate their cap proof and actual geometry',JSON.stringify(before.vertices)!==JSON.stringify(changed.vertices)&&changed.accuracy.surfaceError>before.accuracy.surfaceError,{before:before.accuracy,changed:changed.accuracy});
  await call('spline.rebuild',{id:built.owner.hash});const fresh=await capture(cnc,built.owner,true);
  check('incremental cap proof agrees with a fresh source build',JSON.stringify(changed.vertices)===JSON.stringify(fresh.vertices)&&Math.abs(changed.accuracy.surfaceError-fresh.accuracy.surfaceError)<1e-12,{changed:changed.accuracy,fresh:fresh.accuracy});
  cnc=await reset();data=capCage({angle:30});data.segments.r0s0.ha=[.5,0,0];built=await patch(data);const unsupported=await capture(cnc,built.owner);
  check('unproved curve topology receives only a coarse enclosing-domain surface bound',!!built.owner.buildError||unsupported.accuracy?.solidBand==='enclosing-reference-domain'&&unsupported.accuracy.surfaceError>1&&!unsupported.accuracy.solidEnvelopeCertified,{error:built.owner.buildError,accuracy:unsupported.accuracy});
  cnc=await reset();data=capCage();data.segments.r0s0.ha[2]=2**-40;built=await patch(data);const nearlyPlanar=await capture(cnc,built.owner);
  check('tolerant planar recognition cannot certify nonplanar cubic controls',!built.owner.buildError&&!nearlyPlanar.accuracy.surfaceCertified&&nearlyPlanar.accuracy.reason==='SOURCE_NONPLANAR_CONTROLS',nearlyPlanar.accuracy);
  cnc=await reset();data=capCage({radii:[1,1],centers:[[-3,0],[3,0]]});data.segments.r0s0.ha=[.75,0,0];built=await patch(data);const unproved=await capture(cnc,built.owner);check('unproved leading cells retain an explicit coarse enclosing-domain bound',!built.owner.buildError&&unproved.accuracy.solidBand==='enclosing-reference-domain'&&unproved.accuracy.surfaceError>1&&!unproved.accuracy.solidEnvelopeCertified,unproved.accuracy);
  data.segments.r0s0.ha=[0,.5,0];await call('spline.replace',{id:built.source.hash,data});const repaired=await capture(cnc,built.owner);
  check('repairing a source certifies unchanged neighbouring cap cells without Rebuild',repaired.accuracy.surfaceCertified&&repaired.report.cachedCells>=1&&repaired.report.cpuTriangleCacheBytes===0,{accuracy:repaired.accuracy,report:repaired.report});
  cnc=await reset();built=await patch(capCage({arcs:68,angle:45}));const limited=await capture(cnc,built.owner);
  check('cap proof capacity is explicit',!built.owner.buildError&&limited.accuracy.solidBand==='enclosing-reference-domain'&&limited.accuracy.coarseReasons.includes('SOURCE_ACCURACY_WORK_LIMIT')&&!limited.accuracy.solidEnvelopeCertified,limited.accuracy);
  cnc=await reset();const short=await call('scene.create',{type:'cylinder',params:{diameter:2,height:2,'angle approximation':10}}),tall=await call('scene.create',{type:'cylinder',params:{diameter:2,height:200,'angle approximation':10}}),a=await capture(cnc,short),b=await capture(cnc,tall);
  check('native cylinders combine curved caps with a closed source contract',a.accuracy.surfaceCertified&&a.accuracy.solidEnvelopeCertified&&b.accuracy.solidEnvelopeCertified,{short:a.accuracy,tall:b.accuracy});
  check('straight rail speed does not inflate the geometric error',Math.abs(a.accuracy.tessellationError-b.accuracy.tessellationError)<1e-10&&b.accuracy.surfaceError<.1,{short:a.accuracy,tall:b.accuracy});
  check('curved cap source operations meet their wall-time budgets',timings.every(t=>t.ms<t.limit),timings);
  cnc=await reset();const generated=[];for(let i=0;i<2;i++){const object=await call('scene.create',{type:'cylinder',params:{diameter:2,height:2,'angle approximation':20}});await call('scene.select',{ids:[object.hash]});await call('transform.set',{channel:'position',axis:2,value:-3,coordinates:'world'});generated.push(object);}await call('tag.set',{ids:[generated[0].hash],kind:'stock',enabled:true});
  const cmd=(operation,args={})=>call('plugins.command',{id:cnc.hash,operation,args});await cmd('settings',{Tool:'Flat',Diameter:1,Tolerance:1,'Step Down':1,'Step Over':.8,'Safe Dist':.2,'Ramp Angle':5,Feed:600,Plunge:100,Spindle:10000,'Start G-code':'G21\nG90','Tool Change G-code':'M5\nM0'});
  const started=performance.now();await cmd('slice');let status;do{await page.waitForTimeout(10);status=await cmd('status');}while(status.state==='running'&&performance.now()-started<45000);
  check('public CAM accepts independently validated native cylinder source bands',status.state==='complete'&&status.accuracy.sourceAccuracyCertified&&status.accuracy.sourceErrorBound>0,{error:status.error,source:status.source});
  for(let i=0;!status.partAudit.complete&&i<16&&performance.now()-started<45000;i++){await cmd('audit',{scope:'part'});do{await page.waitForTimeout(10);status=await cmd('status');}while(status.audit.running&&performance.now()-started<45000);}
  check('a complete curved-cap part can certify authored surface tolerance',status.state==='complete'&&status.partAudit.complete&&status.accuracy.finishedSurfaceCertified&&status.partAudit.authoringDistanceUpperBound<=1,{accuracy:status.accuracy,part:status.partAudit});
  timings.push({name:'Mill complete curved-cap authoring certificate',ms:performance.now()-started,limit:45000});check('curved-cap CAM meets its completed-operation budget',timings.at(-1).ms<timings.at(-1).limit,timings.at(-1));
  await call('scene.new');return {pass:true,checks,timings};
 }catch(error){return {pass:false,checks,timings,error:error.stack};}
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const session=await launch({headless:process.argv.includes('--headless')});
 try{
  await ready(session.page);await session.page.evaluate(()=>frameEngine.renderer.device.pushErrorScope('validation'));
  const result=await planarAccuracyChecks(session.page);result.validation=await session.page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message||null);result.pass&&=!result.validation;
  result.sources={};for(const path of ['index.html','plugins/mill/plugin.js'])result.sources[path]=createHash('sha256').update(await readFile(new URL('../../../'+path,import.meta.url))).digest('hex');
  await mkdir(new URL('../../../tests/results/',import.meta.url),{recursive:true});await writeFile(new URL('../../../tests/results/mill-planar-accuracy.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:1;
 }finally{await session.close();}
}
