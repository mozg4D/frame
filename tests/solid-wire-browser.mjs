// Focused native regression: shaded wire colours, filtering and shared instances.
import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';
import {isOrthoWirePixel} from './diagnostic-pixels.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const app=await launch({headless:true}),page=app.page,report={checks:[],errors:[]};
const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,detail});assert.ok(pass,name+': '+JSON.stringify(detail));console.log('PASS '+name);};
page.on('pageerror',e=>report.errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
const cyan=c=>c[1]>c[0]+10&&c[2]>c[1]+5;
async function samples(points){
 const screens=await Promise.all(points.map(point=>call('view.project',{point}))),pixels=screens.flatMap(({screen:[x,y]})=>[-1,0,1].flatMap(dy=>[-1,0,1].map(dx=>[x+dx,y+dy])));
 const colors=(await call('diagnostics.pixels',{points:pixels,presentation:true})).colors;return points.map((_,i)=>colors.slice(i*9,i*9+9));
}
async function checkOrthoParts(){
 await call('scene.new');
 const part=await call('mesh.create',{vertices:[-24,-13,-19,24,13,19,0,30,-12],indices:[0,1,2]});
 await call('scene.select',{ids:[]});await call('view.set',{index:2,single:true,mode:'object',shading:'off',focus:part.hash});
 const minor=await page.evaluate(()=>JSON.parse(document.querySelector('#frame-engine-canvas').dataset.grid).minor);
 const grid=await samples([[0,-minor*.45,0],[minor,-minor*.45,0]]);
 const levels=grid.map(row=>Math.max(...row.filter(c=>c[0]===c[1]&&c[1]===c[2]).map(c=>c[0])));
 check('Native major and minor grid strokes can be measured',levels[0]>levels[1]&&levels[1]>16,levels);
 const getTint=async()=>((await samples([[0,0,0]]))[0].find(isOrthoWirePixel)||[]).slice(0,3);
 let original;
 for(const index of [2,1,3]){
  await call('view.set',{index,shading:'isoparms',focus:part.hash});const tint=await getTint();
  const luma=.2126*tint[0]+.7152*tint[1]+.0722*tint[2];
  check('Plain edges sit just above the major grid in view '+index,luma-levels[0]>16&&luma-levels[0]<30&&(!original||String(tint)===String(original)),{tint,levels});
  original=tint;
 }
 const material=await call('material.create',{params:{h:240,s:100,l:5}});
 await call('material.assign',{id:part.hash,material:material.uid});await call('view.set',{index:2,shading:'wireframe'});
 const blue=await getTint();check('Deep blue material stays softly blue above the grid',blue.length===3&&blue[2]>blue[0]+28&&blue[0]===blue[1],blue);
 await page.evaluate(()=>{const r=frameEngine.renderer;window.savedOrthoRaster=r.wireRaster;r.wireRaster=null;});
 try{
  for(const shading of ['wireframe','isoparms']){
   await call('view.set',{shading});await call('diagnostics.frame',{frames:2});const fallback=await getTint();
   check(shading+' indexed fallback matches the compute tint',fallback.length===3&&blue.every((v,i)=>Math.abs(v-fallback[i])<=1),{blue,fallback});
  }
 }finally{await page.evaluate(()=>{frameEngine.renderer.wireRaster=window.savedOrthoRaster;delete window.savedOrthoRaster;});}
 const gray=await call('material.create',{params:{h:240,s:0,l:80}});await call('material.assign',{id:part.hash,material:gray.uid});
 const neutral=await getTint();check('Neutral material uses the stable part hue',String(neutral)===String(original),{original,neutral});
 const group=await call('scene.create',{type:'cloner',inputs:[part.hash],params:{'count x':5,'count y':1,'count z':1,'spacing x':110}});
 await call('scene.select',{ids:[]});await call('view.set',{index:2,shading:'isoparms',focus:group.hash});
 const centers=await page.evaluate(hash=>frameEngine.scene.meshes.filter(m=>m.hashId===hash&&m.replicaMatrix).map(m=>Array.from(m.frameWorld.slice(12,15))),group.hash);
 const readCopies=async()=>(await samples(centers)).map(row=>row.find(isOrthoWirePixel)?.slice(0,3));
 const copies=await readCopies();
 check('Five neutral occurrences get individual tints',copies.length===5&&copies.every(Boolean)&&new Set(copies.map(String)).size>=3,{centers,copies});
 const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'tinted-parts.hash',base64:saved.base64});
 const reopened=await readCopies();check('Occurrence tints survive saving and reopening HASH',JSON.stringify(copies)===JSON.stringify(reopened),{copies,reopened});
 await call('scene.new');const cube=await call('scene.create',{type:'cube'});
 const clones=await call('scene.create',{type:'cloner',inputs:[cube.hash],params:{'count x':4,'count y':1,'count z':1,'spacing x':150}});
 await call('scene.select',{ids:[]});await call('view.set',{index:2,single:true,shading:'isoparms',focus:clones.hash});
 const edges=await page.evaluate(({cube,clones})=>{
  const lines=frameEngine.splineDisplays.get(cube).lineValues;
  return frameEngine.scene.meshes.filter(m=>m.hashId===clones&&m.replicaMatrix).map(m=>{
   const f=m.frameWorld,world=i=>[0,1,2].map(k=>lines[i]*f[k]+lines[i+1]*f[4+k]+lines[i+2]*f[8+k]+f[12+k]);
   let longest=-1,mid;
   for(let i=0;i<lines.length;i+=6){
    const a=world(i),b=world(i+3),p=frameEngine.pluginProject(a),q=frameEngine.pluginProject(b),length=Math.hypot(p[0]-q[0],p[1]-q[1]);
    if(length>longest){longest=length;mid=a.map((v,k)=>(v+b[k])/2);}
   }
   return mid;
  });
 },{cube:cube.hash,clones:clones.hash});
 const readContours=async()=>(await samples(edges)).map(row=>row.find(isOrthoWirePixel)?.slice(0,3));
 const cages=await readContours();await call('view.set',{shading:'wireframe'});const wires=await readContours();
 check('Generated occurrences keep their own tint in both cage and polygon draws',cages.length===4&&cages.every(Boolean)&&new Set(cages.map(String)).size>=2&&JSON.stringify(cages)===JSON.stringify(wires),{cages,wires});
}
try{
 await ready(page);report.indexSHA256=createHash('sha256').update(await readFile(new URL('../index.html',import.meta.url))).digest('hex');
 report.adapter=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;window.wireErrors=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>wireErrors.push(e.error.message));return Object.fromEntries(['vendor','architecture','description','isFallbackAdapter'].map(k=>[k,a[k]]));});
 assert.equal(report.adapter.isFallbackAdapter,false);assert.ok(!/swiftshader|software|llvmpipe/i.test(JSON.stringify(report.adapter)));
 await call('scene.new');await call('view.set',{index:2,single:true,shading:'solid-isoparms'});
 const data=await page.evaluate(()=>{const K=FrameSpline.K(),d=K.createSplineData(),seq=K.addSplineSequence(d,true),v=[[-80,-80,0],[20,-80,0],[120,-80,0],[120,80,0],[20,80,0],[-80,80,0]].map(p=>K.addSplineVertex(d,p));v.forEach((a,i)=>K.addSplineSegment(d,seq,a,v[(i+1)%v.length]));K.addSplineSegment(d,K.addSplineSequence(d,false),v[1],v[4]);return d;});
 const source=await call('scene.create',{type:'spline'});await call('spline.replace',{id:source.hash,data});
 const started=performance.now(),patch=await call('scene.create',{type:'spline_patch',inputs:[source.hash]});check('Patch builds with edge masks',!patch.buildError&&performance.now()-started<2500,{ms:performance.now()-started,error:patch.buildError});
 await call('scene.select',{ids:[]});
 await page.evaluate(()=>{const p=GPURenderPassEncoder.prototype,labels=new WeakMap(),set=p.setPipeline,draw=p.draw;window.cageOverlayDraws=0;p.setPipeline=function(v){labels.set(this,v.label);return set.call(this,v);};p.draw=function(...a){if(labels.get(this)==='spline cage')cageOverlayDraws++;return draw.apply(this,a);};});
 const points=Array.from({length:7},(_,i)=>[20,-60+i*20,0]);
 for(const index of [2,0]){
  await call('view.set',{index,single:true,mode:'object',shading:'solid-isoparms',focus:patch.hash});
  if(index===0)await call('view.set',{camera:[0,0,1,0,0,0,0,0,0,0,-600,600]});
  for(const shading of ['solid-isoparms','solid-wire']){
   await call('view.set',{shading});await call('diagnostics.frame',{frames:2});const blue=(await samples(points)).map(row=>row.some(cyan));check(shading+' continuous cyan in view '+index,blue.every(Boolean),blue);
  }
 }
 check('Solid modes use no separate cyan cage draws',(await page.evaluate(()=>cageOverlayDraws))===0);
 await call('view.set',{index:2,shading:'wireframe',focus:patch.hash});await page.waitForFunction(()=>!!frameEngine.renderer.wireRaster);await call('diagnostics.frame',{frames:2});
 const unpainted=await samples(points),partTint=unpainted[0].find(isOrthoWirePixel);
 const sameTint=(a,b)=>a&&b&&a.slice(0,3).every((v,i)=>Math.abs(v-b[i])<=1);
 check('Orthographic unpainted classified edges share a subdued tint',partTint&&unpainted.every(row=>row.some(c=>sameTint(c,partTint))),unpainted);
 const wireFrames=await call('diagnostics.frame',{frames:4});check('Material wire retains bounded native CPU/GPU frame time',wireFrames.timestampQueries&&wireFrames.frames.every(f=>f.cpuMs<50&&f.gpuMs<30),wireFrames);
 await call('view.set',{shading:'isoparms'});const contour=await samples(points);check('Orthographic Isoparms uses the same part tint on the generated contour',contour.every(row=>row.some(c=>sameTint(c,partTint))),contour);
 await call('view.set',{index:2,shading:'solid-isoparms'});
 const before=(await samples([[20,20,0]]))[0];await call('view.set',{shading:'solid'});check('Solid + None hides cyan',(await samples([[20,20,0]]))[0].every(c=>!cyan(c)),before);
 await call('view.set',{shading:'off'});const off=await page.evaluate(()=>({solid:document.querySelector('#btnSolid').classList.contains('on'),lines:document.querySelector('#btnShading').classList.contains('on'),iconOpacity:document.querySelector('#btnShading svg').style.opacity,buttonOpacity:document.querySelector('#btnShading').style.opacity}));check('Off controls change icons without active button backgrounds',!off.solid&&!off.lines&&Number(off.iconOpacity)===.4&&!off.buttonOpacity,off);
 check('Both off hides surface and spline lines',(await samples([[20,20,0]]))[0].every(c=>!cyan(c)));
 for(const storage of ['auto','texture']){
  const poly=await call('mesh.create',{name:'Plain '+storage,storage,vertices:[220,-80,0,380,-80,0,380,80,0,220,80,0],indices:[0,1,2,0,2,3]});
  await call('scene.select',{ids:[]});await call('view.set',{index:2,shading:'solid',focus:poly.hash});const solid=(await samples([[300,0,0]]))[0];await call('view.set',{shading:'solid-isoparms'});const wire=(await samples([[300,0,0]]))[0];check('Plain '+storage+' retains diagonal wire in Solid + Isoparms',wire.some((c,i)=>c.slice(0,3).some((v,k)=>v<solid[i][k]-10)),{solid,wire});
  await call('scene.delete',{ids:[poly.hash]});
 }
 const material=await call('material.create',{name:'Wire test',params:{h:20,s:60,l:60}});await call('material.assign',{id:patch.hash,material:material.uid});await call('scene.select',{ids:[]});await call('view.set',{index:2,shading:'solid-isoparms',focus:patch.hash});await call('diagnostics.frame',{frames:3});const materialPixels=await samples(points);check('Material shader uses the same cyan edges',materialPixels.every(row=>row.some(c=>c[2]>c[0]-10&&c[1]>80&&c[2]>80)),{pixels:materialPixels,gpu:await page.evaluate(()=>wireErrors),state:await page.evaluate(h=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===h);return {mask:!!m.splineWireEdges,shade:frameEngine.shadingMode,keys:[...frameEngine.renderer.materialState.pipelines.keys()],pending:[...frameEngine.renderer.materialState.pending.keys()]};},patch.hash)});
 for(const shading of ['isoparms','wireframe']){
  await call('view.set',{shading});const painted=await samples(points);
  check('Orthographic '+shading+' follows the warm material hue',painted.every(row=>row.some(c=>isOrthoWirePixel(c)&&c[0]>c[1]+15&&c[1]>c[2]+5)),painted);
 }
 await call('view.set',{index:0,shading:'wireframe'});const expectedWire=await page.evaluate(()=>hsl2rgb(20,.6,.6).map(v=>Math.round(v*255)));const perspective=await samples(points);
 check('Perspective Wire retains the full material colour',perspective.every(row=>row.some(c=>sameTint(c,expectedWire))),perspective);
 await call('view.set',{index:2,shading:'solid-isoparms'});
 // Independent source display, texture-backed GPU topology, same classifier.
 await call("scene.update",{id:patch.hash,visible:false});
 const paged=await call('mesh.create',{name:'Texture classifier',storage:'texture',vertices:[-80,-80,0,20,-80,0,120,-80,0,120,80,0,20,80,0,-80,80,0],indices:[0,1,4,0,4,5,1,2,3,1,3,4]});
 await page.evaluate(async({hash,data})=>frameEngine.setSplineDisplay(hash,data,true),{hash:paged.hash,data});await call('scene.select',{ids:[]});await call('view.set',{shading:'solid-isoparms',focus:paged.hash});check('Texture-backed surface classifies cyan edges',(await samples(points)).every(row=>row.some(cyan)));await call('view.set',{shading:'wireframe'});const textureWire=await samples(points);check('Texture-backed wire tints classified edges',textureWire.every(row=>row.some(isOrthoWirePixel)),textureWire);await call('scene.delete',{ids:[paged.hash]});
 await call('scene.update',{id:patch.hash,visible:true});await call('scene.convert',{id:patch.hash});check('Make Editable clears spline edge filtering',await page.evaluate(h=>!frameEngine.scene.meshes.find(m=>m.hashId===h).splineWireEdges,patch.hash));
 await call('scene.new');const sphere=await call('scene.create',{type:'sphere'}),cloner=await call('scene.create',{type:'cloner',inputs:[sphere.hash],params:{'count x':3,'count y':1,'count z':1,'spacing x':130}});await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,shading:'solid-isoparms',focus:cloner.hash});await call('diagnostics.frame',{frames:3});
 for(const shading of ['solid-isoparms','solid-wire']){
  await call('view.set',{shading});report.frames=await call('diagnostics.frame',{frames:3});const state=await page.evaluate(()=>{const meshes=frameEngine.scene.meshes.filter(m=>m.replicaMatrix),source=meshes[0].replicaSource;return {copies:meshes.length,shared:meshes.every(m=>m.splineWireEdges===source.splineWireEdges),draws:frameEngine.renderer.replicaDraws.get(0),mask:!!source.splineWireEdges};});check(shading+' instances share masks and batch their surface draw',state.copies===3&&state.shared&&state.mask&&state.draws?.instances===3&&state.draws.calls===1,state);
 }
 check('Focused CPU/GPU frame times',report.frames.timestampQueries&&report.frames.frames.every(f=>f.cpuMs<50&&f.gpuMs<100),report.frames.frames);
 await checkOrthoParts();
 report.gpuErrors=await page.evaluate(()=>wireErrors);check('No GPU or page errors',!report.errors.length&&!report.gpuErrors.length,{errors:report.errors,gpu:report.gpuErrors});report.pass=true;
}catch(error){report.pass=false;report.error=error.stack;console.error(error.stack);}
finally{await mkdir(new URL('results/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('results/solid-wire.png',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).catch(()=>{});await app.close();await writeFile(new URL('results/solid-wire.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass),error:report.error}));process.exitCode=report.pass?0:1;}
