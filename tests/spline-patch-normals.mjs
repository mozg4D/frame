import {launch,ready} from '../tools/browser.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Independent corner-star oracle: union only the endpoints of two-face edges
// whose dihedral is at most 44 degrees, then area-weight each connected star.
export function normalOracle({positions:p,indices:ix,aliases,normals}){
 const parents=ix.map((_,i)=>i),root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;},join=(a,b)=>{parents[root(b)]=root(a);},faces=[],edges=new Map(),dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0),unit=a=>{const l=Math.hypot(...a);return a.map(x=>x/(l||1));};
 for(let c=0;c<ix.length;c+=3){const [a,b,d]=ix.slice(c,c+3).map(i=>p.slice(i*3,i*3+3)),u=b.map((x,k)=>x-a[k]),v=d.map((x,k)=>x-a[k]);faces.push([u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]);for(let k=0;k<3;k++){const a=ix[c+k],b=ix[c+(k+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),e=edges.get(key)||[];e.push(c+k);edges.set(key,e);}}
 for(const e of edges.values())if(e.length===2){const [a,b]=e;if(dot(unit(faces[Math.floor(a/3)]),unit(faces[Math.floor(b/3)]))>=Math.cos(44*Math.PI/180)){for(const c of [a,Math.floor(a/3)*3+(a+1)%3])join(c,ix[c]===ix[b]?b:Math.floor(b/3)*3+(b+1)%3);}}
 const sums=new Map();for(let c=0;c<ix.length;c++){const key=root(c),sum=sums.get(key)||[0,0,0],face=faces[Math.floor(c/3)];for(let k=0;k<3;k++)sum[k]+=face[k];sums.set(key,sum);}
 const snorm=v=>Math.max(-1,(v<<16>>16)/32767),decode=bits=>{let x=snorm(bits&65535),y=snorm(bits>>>16),z=1-Math.abs(x)-Math.abs(y);if(z<0){const a=x;x=(1-Math.abs(y))*(a>=0?1:-1);y=(1-Math.abs(a))*(y>=0?1:-1);}return unit([x,y,z]);};
 let maxDegrees=0,bad=0,invalidAliases=0,logicalVertexMismatches=0;for(let c=0;c<ix.length;c++){if(aliases[c]*2>=normals.length){invalidAliases++;continue;}if(normals[aliases[c]*2]!==ix[c])logicalVertexMismatches++;const expected=unit(sums.get(root(c)));if(!Math.hypot(...expected))continue;const actual=decode(normals[aliases[c]*2+1]),degrees=Math.acos(Math.max(-1,Math.min(1,dot(actual,expected))))*180/Math.PI;maxDegrees=Math.max(degrees,maxDegrees);if(degrees>.05)bad++;}
 return {maxDegrees,bad,invalidAliases,logicalVertexMismatches,invalidEdges:[...edges.values()].filter(e=>e.length!==2).length};
}

export async function shading(page,id){return page.evaluate(async hash=>{
 const {scene,renderer}=frameEngine,mesh=scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix),d=renderer.device;
 async function read(b,n){const r=d.createBuffer({size:n*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),e=d.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,n*4);d.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);const a=new Uint32Array(r.getMappedRange()).slice();r.unmap();r.destroy();return a;}
 const raw=await frameEngine.readGeometry(mesh),aliases=[],normals=[];for(const part of mesh.parts||[mesh]){const offset=normals.length/2,a=await read(part.renderIndices,part.count),n=await read(part.normals,part.normalCount*2);for(const x of a)aliases.push(x+offset);for(const word of n)normals.push(word);}
 return {positions:Array.from(raw.vertices),indices:Array.from(raw.indices),aliases,normals};
 },id);}

export async function splinePatchNormalChecks(page,{baseline=false}={}){
const checks=[],timings=[],errors=[],skipped=[],check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass||!name.startsWith('Meltus '))console.log(JSON.stringify({name,pass:!!pass,...!pass?{detail}:{}}));if(!pass)throw Error(name);};
let result;
try{
 if(baseline){const html=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace(/    async function withNormalWorkspace\(gpu,work\)\{[\s\S]*?\n    \}/,'    async function withNormalWorkspace(gpu,work){return work();}');await page.route('**/index.html',route=>route.fulfill({contentType:'text/html',body:html}));await page.reload();}
 await ready(page);page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]),timed=async(name,fn)=>{const start=performance.now(),value=await fn(),ms=performance.now()-start;timings.push({name,ms,limit:5000});check(name+' latency',ms<5000,{ms});return value;},digest=id=>call('diagnostics.mesh',{id,geometry:true}),normals=async(id,label)=>{const oracle=normalOracle(await shading(page,id));check(label+' matches independent 44-degree corner-star normals',oracle.bad===0&&oracle.invalidAliases===0&&oracle.logicalVertexMismatches===0,oracle);if(!baseline){const d=await call('diagnostics.normals',{id,corners:[0,1,2]});check(label+' native alias diagnostics',d.invalidAliases===0&&d.logicalVertexMismatches===0&&d.samples.length===3,d);}return oracle;};
 await page.evaluate(()=>{window.__normalGPU=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__normalGPU.push(e.error.message));frameEngine.renderer.device.pushErrorScope('validation');});
 const files={};for(const name of ['hgr15-normal-bug','nema23-normals'])files[name]=(await readFile(new URL('scenes/'+name+'.hash',import.meta.url))).toString('base64');
 for(const [name,base64]of Object.entries(files)){
  const scene=await timed('Open '+name,()=>call('scene.open',{name:name+'.hash',base64})),patch=scene.objects.find(n=>n.type==='spline_patch'&&n.name==='NEMA23')||scene.objects.find(n=>n.type==='spline_patch'&&n.mesh?.visible)||scene.objects.find(n=>n.type==='spline_patch');check(name+' healthy native Patch',patch?.mesh?.triangles>0&&!patch.buildError,patch?.mesh);
  const before=await digest(patch.hash);await normals(patch.hash,name+' cold open');
  if(name==='hgr15-normal-bug')check('Rail points and physical volume are preserved with outward winding',before.positionsSHA256==='f5b84b7a4d70aa00b9aee437e7c3510eeb9daf8d849aa54db0f9b17cc2ccf1d6'&&Math.abs(before.signedVolume-327836.06903844624)<1e-5,before);
  await timed('Rebuild '+name,()=>call('spline.rebuild',{id:patch.hash}));const rebuilt=await digest(patch.hash);check(name+' rebuild preserves coordinates and winding',rebuilt.positionsSHA256===before.positionsSHA256&&rebuilt.indicesSHA256===before.indicesSHA256,{before,rebuilt});await normals(patch.hash,name+' rebuild');
  const saved=await call('scene.export',{includeData:true});await timed('Reopen '+name,()=>call('scene.open',{name:name+'.hash',base64:saved.base64}));const reopened=await digest(patch.hash);check(name+' HASH round trip preserves coordinates and winding',reopened.positionsSHA256===before.positionsSHA256&&reopened.indicesSHA256===before.indicesSHA256,reopened);await normals(patch.hash,name+' reopen');
 }
 // Force a realistic delayed metadata map so another cold build can overwrite
 // the shared scratch unless its lease covers dense packing as well.
 await call('scene.open',{name:'hgr15-normal-bug.hash',base64:files['hgr15-normal-bug']});await call('scene.merge',{url:'tests/scenes/nema23-normals.hash'});const mixed=await call('scene.export',{includeData:true});
 await page.evaluate(()=>{const original=GPUBuffer.prototype.mapAsync;GPUBuffer.prototype.mapAsync=async function(...args){await original.apply(this,args);if(this.label==='temporary metadata readback'){const mapped=this.getMappedRange();this.getMappedRange=()=>mapped;if(new Uint32Array(mapped)[17]===1520&&!window.__normalDelayed){window.__normalDelayed=true;await new Promise(resolve=>setTimeout(resolve,400));}}};});
 const mixedScene=await timed('Parallel cold Patch uploads with delayed metadata',()=>call('scene.open',{name:'mixed-normal-race.hash',base64:mixed.base64}));check('Motor metadata delay exercises the shared scratch lease',await page.evaluate(()=>!!__normalDelayed));for(const patch of mixedScene.objects.filter(n=>n.type==='spline_patch').sort((a,b)=>Number(b.name==='NEMA23')-Number(a.name==='NEMA23')))await normals(patch.hash,'Parallel '+patch.name);
 // The full assembly is a local user fixture, deliberately excluded from Git.
 let assemblyBase64;try{assemblyBase64=(await readFile(new URL('scenes/meltus8-normals.hash',import.meta.url))).toString('base64');}catch(error){if(error.code!=='ENOENT')throw error;skipped.push({fixture:'meltus8-normals.hash',reason:'Optional full user assembly is retained locally, not published'});}const assemblyBefore=new Map();let assemblyFrames=null;
 if(assemblyBase64){
 for(let attempt=0;attempt<3;attempt++){
  const scene=await timed('Meltus assembly open '+attempt,()=>call('scene.open',{name:'meltus8-normals.hash',base64:assemblyBase64})),canonical=new Set(await page.evaluate(()=>frameEngine.scene.meshes.filter(m=>!m.replicaMatrix).map(m=>m.hashId)));
  check('Meltus '+attempt+' evaluates every surface',scene.objects.every(n=>!n.buildError),scene.objects.filter(n=>n.buildError));
  for(const n of scene.objects.filter(n=>n.mesh&&canonical.has(n.hash))){const d=await digest(n.hash);if(!attempt)assemblyBefore.set(n.hash,d);else{const before=assemblyBefore.get(n.hash);check('Meltus '+attempt+' retains '+n.name+' geometry',before.positionsSHA256===d.positionsSHA256&&before.indicesSHA256===d.indicesSHA256,{before,after:d});}await normals(n.hash,'Meltus '+attempt+' '+n.name);}
 }
 assemblyFrames=await call('diagnostics.frame',{frames:3});check('Meltus assembly CPU/GPU frame budgets',assemblyFrames.timestampQueries&&assemblyFrames.frames.every(f=>f.cpuMs<35&&f.gpuMs>0&&f.gpuMs<80),assemblyFrames);
 }
 // An all-CPU closed cage exercises incremental GPU index remapping after the
 // raw resolver orientation has been reversed by closed-shell assembly.
 await call('scene.new');const patch=await call('scene.create',{type:'spline_patch'}),data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),v=[[0,0,0],[30,0,0],[0,20,0],[0,0,40]].map(p=>K.addSplineVertex(d,p));for(const [a,b]of [[0,1],[1,2],[2,0],[0,3],[1,3],[2,3]])K.addSplineSegment(d,K.addSplineSequence(d),v[a],v[b]);return d;});
 await call('spline.replace',{id:patch.hash,data});const source=(await call('scene.inspect')).objects.find(n=>n.parent===patch.hash),cage=(await call('spline.inspect',{id:source.hash})).data;cage.vertices[Object.keys(cage.vertices)[1]][0]+=2;
 await call('spline.replace',{id:source.hash,data:cage});const edited=await digest(patch.hash),evaluation=(await call('scene.inspect')).objects.find(n=>n.hash===patch.hash).evaluation;check('Closed CPU-cell edit uses outward incremental assembly',edited.signedVolume>0&&evaluation.report.gpuAssembly,{edited,report:evaluation.report});await normals(patch.hash,'Incremental tetrahedron');await call('spline.rebuild',{id:patch.hash});const rebuilt=await digest(patch.hash);check('Incremental winding equals fresh assembly',edited.positionsSHA256===rebuilt.positionsSHA256&&edited.indicesSHA256===rebuilt.indicesSHA256,{edited,rebuilt});
 const frames=await call('diagnostics.frame',{frames:3});check('Hardware CPU/GPU frame budgets',frames.timestampQueries&&frames.frames.every(f=>f.cpuMs<35&&f.gpuMs>0&&f.gpuMs<80),frames);
 // Paged shading still uses the same logical-vertex contract and diagnostics.
 const paged=await call('mesh.create',{vertices:[0,0,0,30,0,0,0,20,0,0,0,40],indices:[0,2,1,0,1,3,1,2,3,2,0,3],storage:'texture'});await normals(paged.hash,'Texture-backed tetrahedron');
 const gpu=await page.evaluate(async()=>({validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:__normalGPU}));check('No browser or GPU errors',!errors.length&&!gpu.validation&&!gpu.uncaptured.length,{errors,gpu});result={pass:true,checks,timings,gpu,frames,assemblyFrames,skipped};
}catch(error){result={pass:false,checks,timings,errors,skipped,error:error.stack};}return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const baseline=process.argv.includes('--negative-control'),session=await launch({headless:true});let result;try{result=await splinePatchNormalChecks(session.page,{baseline});}finally{await session.close();}
 result.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');result.negativeControl=baseline;await mkdir(new URL('results/',import.meta.url),{recursive:true});await writeFile(new URL('results/spline-patch-normals'+(baseline?'-negative-control':'')+'.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,checks:result.checks.length,failed:result.checks.filter(c=>!c.pass),error:result.error}));process.exitCode=result.pass?0:1;
}
