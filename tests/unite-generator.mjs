import assert from 'node:assert/strict';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
import {regionKernelChecks,regionBrowserChecks} from './unite-regions.mjs';
import {surfaceDeviation} from './unite-deviation.mjs';
import {upperToolbarChecks} from './file-controls.mjs';

function box(lo,hi,storage='auto'){
  const [x,y,z]=lo,[X,Y,Z]=hi;
  return {vertices:[x,y,z,X,y,z,X,Y,z,x,Y,z,x,y,Z,X,y,Z,X,Y,Z,x,Y,Z],
    indices:[2,1,0,3,2,0,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7],storage};
}
async function audit(page,id,probes){
  return page.evaluate(async({id,probes})=>{
    const {vertices:v,indices:t}=await frameEngine.readGeometry(id),edges=new Map(),hits=probes.map(()=>0);let sixVolume=0;
    for(let i=0;i<t.length;i+=3){
      const a=t[i],b=t[i+1],c=t[i+2],n=v.length/3;
      for(const [u,w] of [[a,b],[b,c],[c,a]]){
        const k=Math.min(u,w)*n+Math.max(u,w),entry=edges.get(k)||[0,0];entry[0]++;entry[1]+=u<w?1:-1;edges.set(k,entry);
      }
      const A=a*3,B=b*3,C=c*3,by=v[B+1]-v[A+1],bz=v[B+2]-v[A+2],cy=v[C+1]-v[A+1],cz=v[C+2]-v[A+2],det=by*cz-bz*cy;
      sixVolume+=v[A]*det+v[A+1]*(bz*(v[C]-v[A])-(v[B]-v[A])*cz)+v[A+2]*((v[B]-v[A])*cy-by*(v[C]-v[A]));
      if(!det)continue;
      for(const [j,[x,y,z]] of probes.entries()){
        const dy=y-v[A+1],dz=z-v[A+2],u=(dy*cz-dz*cy)/det,w=(by*dz-bz*dy)/det;
        if(u>=0&&w>=0&&u+w<=1&&x<v[A]+u*(v[B]-v[A])+w*(v[C]-v[A]))hits[j]++;
      }
    }
    return {manifold:[...edges.values()].every(([n,balance])=>n===2&&balance===0),inside:hits.map(h=>!!(h%2)),volume:sixVolume/6,faces:t.length/3};
  },{id,probes});
}
export async function uniteGeneratorChecks(page){
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const inspect=async()=>(await call('scene.inspect')).objects;
  const controls=page.locator('#attrContent input[data-field]');
  for(const tab of ['#tabObjects','#tabMaterials']){
    await page.locator(tab).click();await page.locator('#btnUnite').click();
    assert.equal(await page.locator('#tabAttributes').getAttribute('aria-selected'),'true');
    assert.deepEqual(await controls.evaluateAll(es=>es.map(e=>e.dataset.field)),['resolution','smoothing','optimize','fast']);
    assert.ok(await controls.first().isVisible());
  }
  await call('scene.new');
  await upperToolbarChecks(page,(name,pass,detail)=>assert.ok(pass,name+' '+JSON.stringify(detail)));
  const cam=page.locator('#btnRender');
  await cam.click();let rows=await inspect();assert.deepEqual(rows.map(r=>r.type),['render']);
  const rect=await cam.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+8,{steps:4});
  const target=page.getByRole('menuitem',{name:'Target',exact:true});await target.waitFor();
  assert.equal(await page.locator('#menu button').count(),1);
  const menuBox=await page.locator('#menu').evaluate(menu=>{
    const r=menu.getBoundingClientRect(),button=menu.firstElementChild.getBoundingClientRect();
    return [r.width,r.height,button.width,button.height,menu.scrollWidth-menu.clientWidth,menu.scrollHeight-menu.clientHeight,getComputedStyle(menu).overflow];
  });
  assert.deepEqual(menuBox,[32,32,32,32,0,0,'clip']);
  assert.ok(await cam.evaluate(c=>parseFloat(getComputedStyle(c,'::after').borderBottomWidth)>=9));
  const option=await target.boundingBox();await page.mouse.move(option.x+16,option.y+16,{steps:3});await page.mouse.up();
  rows=await inspect();assert.deepEqual(rows.map(r=>r.type).sort(),['render','target']);
  await cam.focus();await page.keyboard.press('ArrowDown');await target.waitFor();await page.keyboard.press('Escape');
  assert.equal(await target.isVisible(),false);
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+9);await target.waitFor();
  await page.mouse.move(x+90,y+65);await page.mouse.up();assert.equal(await target.isVisible(),false);
  const touch=await page.context().newCDPSession(page);
  try{
    await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    const dispatch=(type,x,y)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
    await dispatch('touchStart',x,y);await dispatch('touchMove',x,y+10);await target.waitFor();
    await dispatch('touchMove',option.x+16,option.y+16);await dispatch('touchEnd');
  }finally{await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await touch.detach();}
  assert.deepEqual((await inspect()).map(o=>o.type).sort(),['render','target','target']);
  await page.locator('#btnUnite').click();
  rows=await inspect();const empty=rows.find(r=>r.type==='unite');assert.equal(empty.params.resolution,512);assert.equal(empty.sources.length,0);
  assert.equal(await page.locator('#tabAttributes').getAttribute('aria-selected'),'true');
  assert.deepEqual(await page.locator('#attrContent input[data-field]').evaluateAll(es=>es.map(e=>e.dataset.field)),['resolution','smoothing','optimize','fast']);
  assert.ok(!/cell size/i.test(await page.locator('#attrContent').innerText()));
  assert.ok(rows.every(r=>!r.parent));assert.equal(await page.locator('#btnBoolean + #btnUnite').count(),1);
  const operand=await call('mesh.create',{name:'Dragged box',...box([0,0,0],[5,5,5])});
  const from=await page.locator('#row-'+operand.id+' .ob-name').boundingBox(),to=await page.locator('#row-'+empty.id).boundingBox();
  await page.mouse.move(from.x+8,from.y+6);await page.mouse.down();await page.mouse.move(from.x+18,from.y+6,{steps:3});
  await page.mouse.move(to.x+46,to.y+8,{steps:5});await page.mouse.up();
  rows=await inspect();assert.equal(rows.find(r=>r.hash===operand.hash).parent,empty.hash);
  assert.equal(rows.find(r=>r.hash===empty.hash).evaluation.report.triangles,12);
  await copyInputs(page,call,empty,operand);
  console.log('Camera click, drag to Target, keyboard and empty Unite passed');
  await call('scene.new');
  const a=await call('mesh.create',box([0,0,0],[10,10,10]));
  const b=await call('mesh.create',box([6,.8,.5],[15,9,9.4],'texture'));
  const cavity=await call('mesh.create',box([7,2,2],[9,8,8]));
  const island=await call('mesh.create',box([7.5,4,4],[8.5,6,6]));
  const g=await call('scene.create',{type:'group'});
  await call('scene.update',{id:island.hash,parent:g.hash});
  let u=await call('scene.create',{type:'unite',inputs:[a.hash,b.hash,cavity.hash,g.hash],params:{resolution:64}});
  assert.ifError(u.buildError);assert.equal(u.evaluation?.report?.nestingLevels,3,JSON.stringify(u));
  assert.equal(u.evaluation.report.backend,'Exact rectilinear');
  assert.ok(u.evaluation.report.perimeterPatches>0&&u.evaluation.report.triangles<u.evaluation.report.rawTriangles);
  const probes=[[1,3.123,4.27],[6.5,4.13,5.24],[7.3,4.31,5.11],[8,4.97,5.31],[12,4.53,4.71],[16,4.23,5.36]];
  const expected=[true,true,false,true,true,false];
  const result=await audit(page,u.hash,probes);assert.ok(result.manifold);assert.deepEqual(result.inside,expected);
  const coplanar=await call('scene.update',{id:u.hash,params:{fast:false}});
  assert.ifError(coplanar.buildError);assert.ok(coplanar.evaluation.report.triangles===result.faces);
  const compact=await audit(page,u.hash,probes);
  assert.ok(compact.manifold&&Math.abs(compact.volume-result.volume)<1e-5);assert.deepEqual(compact.inside,expected);
  await call('scene.update',{id:u.hash,params:{fast:true}});
  const volume=1000+5*8.2*8.9-2*6*6+1*2*2;
  assert.ok(Math.abs(result.volume-volume)<.001);
  let visible=await page.evaluate(()=>frameEngine.scene.meshes.filter(m=>m.frameVisible!==false).map(m=>m.hashId));
  assert.deepEqual(visible,[u.hash]);
  console.log('Solid overlaps, closed cavity, island, grouped and texture-backed inputs passed',u.evaluation.report);
  const exactOptimized=await call('scene.update',{id:u.hash,params:{optimize:75}});
  assert.ifError(exactOptimized.buildError);
  const planar=await audit(page,u.hash,probes);assert.deepEqual(planar.inside,expected);
  assert.ok(planar.manifold&&planar.faces===result.faces&&Math.abs(planar.volume-result.volume)<.001);
  u=exactOptimized;
  const created=u.evaluation.report.totalMs;
  await call('transform.apply',{ids:[u.hash],position:[17,3,2]});
  u=(await inspect()).find(r=>r.hash===u.hash);assert.equal(u.evaluation.report.totalMs,created);
  await call('scene.update',{id:u.hash,enabled:false});
  visible=await page.evaluate(()=>frameEngine.scene.meshes.filter(m=>m.frameVisible!==false).map(m=>m.hashId));
  assert.ok(visible.includes(a.hash)&&!visible.includes(u.hash));
  await call('scene.update',{id:u.hash,enabled:true});
  await call('scene.update',{id:u.hash,params:{resolution:72}});
  assert.ok((await audit(page,u.hash,probes)).manifold);
  const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'unite.hash',base64:saved.base64});
  rows=await inspect();u=rows.find(r=>r.type==='unite');assert.equal(u.params.resolution,72);assert.ifError(u.buildError);
  assert.deepEqual((await audit(page,u.hash,probes)).inside,expected);
  const mesh=await call('scene.convert',{id:u.hash});assert.equal(mesh.type,'mesh');assert.deepEqual((await inspect()).map(o=>o.type),['mesh']);
  assert.deepEqual((await audit(page,mesh.hash,probes)).inside,expected);
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>nodes.some(n=>n.type==='unite'));
  rows=await inspect();const restored=rows.find(n=>n.type==='unite');assert.ifError(restored.buildError);
  assert.deepEqual((await audit(page,restored.hash,probes)).inside,expected);
  await page.keyboard.press('Control+y');await page.waitForFunction(()=>nodes.length===1&&nodes[0].type==='mesh');
  console.log('Transforms, disable/enable, resolution, HASH and editable Undo/Redo passed');
  await call('scene.new');
  const shear=(geometry)=>{for(let i=0;i<geometry.vertices.length;i+=3)geometry.vertices[i]+=.07*geometry.vertices[i+1];return geometry;};
  const bodies=[];
  for(const [lo,hi] of [[[0,0,0],[10,10,10]],[[6,.8,.5],[15,9,9.4]],[[7,2,2],[9,8,8]],[[7.5,4,4],[8.5,6,6]]]){
    const geometry=shear(box(lo,hi));geometry.indices.push(...geometry.indices.slice(0,3).reverse(),0,0,0);
    const m=await call('mesh.create',geometry);bodies.push(m.hash);
  }
  const general=await call('scene.create',{type:'unite',inputs:bodies,params:{resolution:120}});
  assert.ifError(general.buildError);assert.equal(general.evaluation.report.backend,'WebGPU / WASM');
  const skewProbes=probes.map(([x,y,z])=>[x+.07*y,y,z]);
  const generalResult=await audit(page,general.hash,skewProbes);
  assert.ok(generalResult.manifold);assert.deepEqual(generalResult.inside,expected);assert.ok(Math.abs(generalResult.volume/volume-1)<.005);
  const multiSlab=await call('scene.update',{id:general.hash,params:{resolution:384}});
  assert.ifError(multiSlab.buildError);assert.equal(multiSlab.evaluation.report.backend,'WebGPU / WASM');
  assert.ok(multiSlab.evaluation.report.gpuScratchBytes>180*1024*1024,JSON.stringify(multiSlab.evaluation.report));
  const multiSlabResult=await audit(page,general.hash,skewProbes);
  assert.ok(multiSlabResult.manifold);assert.deepEqual(multiSlabResult.inside,expected);assert.ok(Math.abs(multiSlabResult.volume/volume-1)<.002);
  await call('transform.apply',{ids:[bodies[1]],position:[20,0,0]});
  const moved=await audit(page,general.hash,[skewProbes[4]]);
  assert.deepEqual(moved.inside,[false]);
  await call('scene.new');
  const left=await call('mesh.create',box([0,0,0],[5,5,5])),right=await call('mesh.create',box([5,0,0],[10,5,5]));
  const faceContact=await call('scene.create',{type:'unite',inputs:[left.hash,right.hash],params:{resolution:48}});
  assert.ifError(faceContact.buildError);
  const contact=await audit(page,faceContact.hash,[[4.95,2.17,2.52],[5.05,2.17,2.52]]);
  assert.ok(contact.manifold);assert.deepEqual(contact.inside,[true,true]);assert.ok(Math.abs(contact.volume/250-1)<.01);
  await call('scene.new');
  const source=await call('scene.create',{type:'cube'}),instance=await call('scene.create',{type:'instance',params:{object:source.hash}});
  const owner=await call('scene.create',{type:'unite',inputs:[instance.hash],params:{resolution:32}});
  assert.ifError(owner.buildError);assert.ok(owner.evaluation.report.triangles);
  const width=id=>page.evaluate(async id=>{const {vertices}=await frameEngine.readGeometry(id);let min=Infinity,max=-Infinity;for(let i=0;i<vertices.length;i+=3){min=Math.min(min,vertices[i]);max=Math.max(max,vertices[i]);}return max-min;},id);
  assert.equal(await width(owner.hash),100);
  await call('scene.update',{id:source.hash,params:{'size x':37}});
  const changed=(await inspect()).find(n=>n.hash===owner.hash);
  assert.ifError(changed.buildError);assert.equal(await width(owner.hash),37);
  const helper=await call('scene.create',{type:'target',parent:owner.hash});
  await call('scene.convert',{id:owner.hash});const remaining=await inspect();
  assert.equal(remaining.find(r=>r.hash===helper.hash).parent,owner.hash);assert.ok(remaining.some(r=>r.hash===source.hash));
  console.log('Sampled dirty shells, edited operands, native cube and linked Instance passed');
  await surfaceControls(page,call);
  return {pass:true,checks:[{name:'Camera click, pointer and touch Target gestures',pass:true},
    {name:'Unite hierarchy, publication, fill, editable and persistence',pass:true},
    {name:'Surface attributes, sharp features, sub-cell components and final topology',pass:true}],timings:[]};
}
async function copyInputs(page,call,owner,input){
  // Read only the already published result. An API settle/flush here could
  // accidentally make the test itself schedule the missing rebuild.
  await call('scene.update',{id:owner.hash,params:{fast:false,optimize:75}});
  const published=n=>page.waitForFunction(({hash,n})=>{
    const u=frameNodeByHash(hash);
    return FrameSpline.states.get(u.id)?.report?.inputTriangles===n;
  },{hash:owner.hash,n},{timeout:12000});
  const select=id=>call('scene.select',{ids:[id],mode:'object'});
  await select(input.hash);await page.locator('#frame-engine-canvas').focus();
  await page.keyboard.press('Control+d');await published(24);
  await page.keyboard.press('Control+z');await published(12);
  await page.keyboard.press('Control+y');await published(24);
  await select(input.hash);await page.keyboard.press('Control+c');
  await select(owner.hash);await page.keyboard.press('Control+v');await published(36);
  let copy=await page.evaluate(()=>current().nativeHash);
  assert.equal((await call('scene.inspect')).objects.find(n=>n.hash===copy).parent,owner.hash);
  await select(input.hash);
  const handle=await page.evaluate(()=>frameEngine.gizmoState.handles.find(h=>h.part==='move0')?.suggested);
  assert.ok(handle,'Copy drag requires an object move handle');
  await page.keyboard.down('Control');
  try{
    await page.mouse.move(...handle);await page.mouse.down();await page.mouse.move(handle[0]+65,handle[1],{steps:8});
    await page.waitForFunction(()=>current()?.name==='Dragged box'&&nodes.filter(n=>n.name==='Dragged box').length===4);
    await page.mouse.move(handle[0]+87,handle[1],{steps:3});
    await page.waitForFunction(id=>{
      const u=frameNodeByHash(id),r=FrameSpline.states.get(u.id)?.report;
      return r?.inputTriangles===48&&r.fast===true&&u.params.fast===false;
    },owner.hash,{timeout:12000});
    await page.mouse.up();
  }finally{await page.keyboard.up('Control');}
  await published(48);
  await page.waitForFunction(id=>FrameSpline.states.get(frameNodeByHash(id).id)?.report?.fast===false,owner.hash);
  const extent=await page.evaluate(async id=>{
    const {vertices}=await frameEngine.readGeometry(id);let lo=Infinity,hi=-Infinity;
    for(let i=0;i<vertices.length;i+=3){lo=Math.min(lo,vertices[i]);hi=Math.max(hi,vertices[i]);}return hi-lo;
  },owner.hash);
  assert.ok(extent>5.1,'The released drag must publish the displaced copy');
  await page.keyboard.press('Control+z');await published(36);
  await page.keyboard.press('Control+y');await published(48);
  await select(input.hash);await call('edit.copy');
  const receiver=await page.context().newPage();
  try{
    await receiver.goto(page.url());await ready(receiver);
    const command=(name,args={})=>receiver.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
    await command('scene.new');const dest=await command('scene.create',{type:'unite'});
    await command('transform.apply',{ids:[dest.hash],position:[13,4,2]});
    await command('scene.select',{ids:[dest.hash],mode:'object'});
    const pasted=await command('edit.paste');
    assert.equal(pasted.objects[0].parent,dest.hash);
    const hits=await frontAt(receiver,dest.hash,[[-1.8,.7]]);assert.ok(Math.abs(hits[0]+13)<1e-5,JSON.stringify(hits));
    await command('edit.copy');const sibling=await command('edit.paste');assert.equal(sibling.objects[0].parent,dest.hash);
    assert.equal((await command('scene.inspect')).objects.find(n=>n.hash===dest.hash).evaluation.report.inputTriangles,24);
  }finally{await receiver.close();await page.bringToFront();}
  console.log('Duplicate, local and cross-tab Paste, Ctrl-drag, Undo and Redo published automatically');
}

async function frontAt(page,hash,samples){
  return page.evaluate(async({hash,samples})=>{
    const {vertices:p,indices:t}=await frameEngine.readGeometry(hash);
    return samples.map(([y,z])=>{
      let first=Infinity;
      for(let i=0;i<t.length;i+=3){
        const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3;
        const by=p[b+1]-p[a+1],bz=p[b+2]-p[a+2],cy=p[c+1]-p[a+1],cz=p[c+2]-p[a+2],det=by*cz-bz*cy;
        if(!det)continue;
        const u=((y-p[a+1])*cz-(z-p[a+2])*cy)/det,v=(by*(z-p[a+2])-bz*(y-p[a+1]))/det;
        if(u>=0&&v>=0&&u+v<=1)first=Math.min(first,p[a]+u*(p[b]-p[a])+v*(p[c]-p[a]));
      }
      return first;
    });
  },{hash,samples});
}
async function cornerChecks(page,call){
  await call('scene.new');
  const material=await call('mesh.create',box([0,0,0],[20,20,20]));
  const cavity=await call('mesh.create',box([5,5,5],[15,15,15]));
  const u=await call('scene.create',{type:'unite',inputs:[material.hash,cavity.hash],params:{resolution:20}});
  const probes=[[.12,.12,9.731],[.49,.49,9.731],[5.12,5.12,9.731],[5.49,5.49,9.731]];
  assert.deepEqual((await audit(page,u.hash,probes)).inside,[true,true,false,false]);
  const flat=[[4.131,9.731],[8.473,7.217],[17.236,15.491]],edge=[[.12,9.731]];
  const cut=[];
  for(const smoothing of [.16,.32,.65]){
    const result=await call('scene.update',{id:u.hash,params:{smoothing,optimize:75}});assert.ifError(result.buildError);
    const [x]=await frontAt(page,u.hash,edge);cut.push(x);
    for(const v of await frontAt(page,u.hash,flat))assert.ok(Math.abs(v)<1e-6,'Flat plane drift '+v);
  }
  const rounded=await audit(page,u.hash,probes);assert.ok(rounded.manifold);
  assert.deepEqual(rounded.inside,[false,true,true,false]);assert.ok(cut[2]>cut[1]&&cut[1]>cut[0]&&cut[2]<.81,JSON.stringify(cut));
  const [nearTangent,onPlane]=await frontAt(page,u.hash,[[.60,9.731],[.80,9.731]]);
  assert.ok(nearTangent>=-1e-6&&nearTangent<.015&&Math.abs(onPlane)<1e-6,JSON.stringify({nearTangent,onPlane}));
  const physical=[];
  for(const resolution of [32,96]){
    const settings=await call('scene.update',{id:u.hash,params:{smoothing:1.4,resolution}});
    assert.ifError(settings.buildError);physical.push(...await frontAt(page,u.hash,[[.18,9.731]]));
  }
  assert.ok(physical[0]>.3&&Math.abs(physical[0]-physical[1])<.015,JSON.stringify(physical));
  await call('scene.new');
  const wedge=box([0,0,0],[20,20,20]);for(let i=0;i<wedge.vertices.length;i+=3)wedge.vertices[i]+=.37*wedge.vertices[i+1]+.21*wedge.vertices[i+2];
  const w=await call('mesh.create',wedge),sampled=await call('scene.create',{type:'unite',inputs:[w.hash],params:{resolution:64}});
  const ray=[[4.136,8.241],[8.713,9.532],[13.247,7.847],[15.131,15.349]];
  const curves=[];
  for(const resolution of [64,128]){
    const raw=await call('scene.update',{id:sampled.hash,params:{smoothing:0,resolution,optimize:0}});
    const pitch=raw.evaluation.report.pitch,wedgeEdge=[[.20,9.731],[.45,9.731]];
    const originalEdge=await frontAt(page,sampled.hash,wedgeEdge);
    const filtered=await call('scene.update',{id:sampled.hash,params:{smoothing:2,optimize:0}});
    assert.ifError(filtered.buildError);
    const curve=await frontAt(page,sampled.hash,wedgeEdge);curves.push(curve);
    assert.ok(curve.every((v,i)=>v>originalEdge[i]+.05),JSON.stringify({originalEdge,curve}));
    let fastFaces;
    for(const fast of [true,false]){
      const trial=await call('scene.update',{id:sampled.hash,params:{smoothing:2,optimize:75,fast}});
      assert.ifError(trial.buildError);assert.ok(trial.evaluation.report.reusedVolume&&trial.evaluation.report.reusedField);
      if(fast)fastFaces=trial.evaluation.report.triangles;else assert.ok(trial.evaluation.report.triangles<fastFaces);
      const hits=await frontAt(page,sampled.hash,ray);
      const error=Math.max(...hits.map((x,i)=>Math.abs(x-.37*ray[i][0]-.21*ray[i][1])));
      assert.ok(error<pitch*.10,'Oblique plane deviation '+error);assert.ok((await audit(page,sampled.hash,[])).manifold);
    }
  }
  assert.ok(curves[0].every((v,i)=>Math.abs(v-curves[1][i])<.22),JSON.stringify(curves));
  console.log('Physical rounding on convex, concave and oblique faces',JSON.stringify({cut,physical,curves}));
  await call('scene.new');
  const shear=([x,y,z])=>[x+.27*y+.11*z,y,z];
  const shells=[];
  for(const [lo,hi] of [[[0,0,0],[20,16,10]],[[5,7,2],[15,7.8,8]],[[0,18,0],[20,18.75,10]]]){
    const b=box(lo,hi);for(let i=0;i<b.vertices.length;i+=3)b.vertices.splice(i,3,...shear(b.vertices.slice(i,i+3)));
    shells.push((await call('mesh.create',b)).hash);
  }
  const thin=await call('scene.create',{type:'unite',inputs:shells,params:{resolution:128}});
  const points=[[10,6.8,5],[10,7.4,5],[10,8,5],[10,17.8,5],[10,18.35,5],[10,18.95,5]].map(shear);
  for(const smoothing of [0,.75,2.5]){
    for(const fast of [true,false]){
      const state=await call('scene.update',{id:thin.hash,params:{smoothing,optimize:75,fast}});
      assert.ifError(state.buildError);const result=await audit(page,thin.hash,points);
      assert.ok(result.manifold);assert.deepEqual(result.inside,[true,false,true,false,true,false]);
    }
  }
  console.log('Thin wall and slit retained in both modes at 0, 0.75 and 2.5 mm');
}

async function surfaceControls(page,call){
  const combine=(parts)=>{
    const vertices=[],indices=[];
    for(const part of parts){const base=vertices.length/3;vertices.push(...part.vertices);indices.push(...part.indices.map(i=>i+base));}
    return {vertices,indices};
  };
  const inverted=part=>({...part,indices:part.indices.slice().reverse()});
  // Feed final surface sheets directly to cover debris born during contouring.
  // A nested void in a discarded speck goes with it, a void in the body survives.
  const boundary=combine([box([0,0,0],[8,8,8]),inverted(box([2,2,2],[2.6,2.6,2.6])),
    box([2.1,2.1,2.1],[2.3,2.3,2.3]),box([12,0,0],[12.6,.6,.6]),inverted(box([12.1,.1,.1],[12.4,.4,.4])),
    box([16,0,0],[17,.5,.5]),box([19,0,0],[22,.1,.1])]);
  const filtered=await page.evaluate(async({vertices,indices})=>{
    const module=Uint8Array.from(atob(document.getElementById('frame-unite-wasm').textContent.trim()),x=>x.charCodeAt(0));
    const {instance}=await WebAssembly.instantiate(module,{env:{emscripten_notify_memory_growth(){}},wasi_snapshot_preview1:{fd_close:()=>8,fd_seek:()=>8,fd_write:()=>8}});
    const api=instance.exports;api._initialize();const mesh=api.begin_surface(),ptr=api.malloc(32);
    try{
      api.resize_surface(mesh,vertices.length/3,indices.length);
      new Float32Array(api.memory.buffer,api.surface_vertices(mesh),vertices.length).set(vertices);
      new Uint32Array(api.memory.buffer,api.surface_indices(mesh),indices.length).set(indices);
      api.finish_surface(mesh,1,ptr);api.surface_counts(mesh,ptr+16);
      const stats=new Uint32Array(api.memory.buffer,ptr,8);
      return {input:stats[0],discarded:stats[1],result:stats[5]/3};
    }finally{api.free(ptr);api.end_surface(mesh);}
  },boundary);
  assert.deepEqual(filtered,{input:84,discarded:2,result:48});
  await call('scene.new');
  const solids=combine([
    box([0,0,0],[16,8,8]),box([2,9,1],[2.5,9.5,1.5]),box([2.1,9.1,1.1],[2.4,9.4,1.4]),
    box([6,9,1],[7,9.45,1.4]),box([9,9,1],[12,9.15,1.15]),box([12,7.8,1],[12.5,8.3,1.4]),
    box([3,2,2],[3.5,2.5,2.5]),box([3.14,2.14,2.14],[3.4,2.4,2.4])
  ]);
  const source=await call('mesh.create',solids);
  const initial=await call('scene.create',{type:'unite',inputs:[source.hash],params:{resolution:16}});
  const probes=[[2.04,9.23,1.28],[2.2,9.22,1.27],[6.5,9.2,1.22],[10.4,9.08,1.07],
    [12.22,8.15,1.24],[3.05,2.22,2.31],[3.25,2.22,2.31],[1.5,1.47,2.57]];
  const inside=[false,false,true,true,true,false,false,true],raw=await audit(page,initial.hash,probes);
  assert.ifError(initial.buildError);assert.equal(initial.evaluation.report.droppedInputSolids,2);
  assert.deepEqual(raw.inside,inside);assert.ok(raw.manifold);
  await page.locator('#tabAttributes').click();
  for(const key of ['smoothing','optimize']){
    const input=page.locator('#attrContent input[data-field="'+key+'"]');await input.fill(key==='smoothing'?'.45':'100');await input.press('Enter');
  }
  const owner=(await call('scene.inspect')).objects.find(n=>n.hash===initial.hash);
  assert.deepEqual(owner.params,{resolution:16,smoothing:.45,optimize:100,fast:true});assert.ifError(owner.buildError);
  for(const name of ['smoothing','optimize']){
    const field=await call('fields.read',{owner:owner.hash,field:'param:'+name});assert.equal(field.unit,name==='smoothing'?'mm':'%');assert.equal(field.access,'read-write');
  }
  await page.locator('#attrContent input:focus').evaluateAll(es=>es.forEach(e=>e.blur()));
  await page.keyboard.press('Control+z');await page.waitForFunction(id=>frameNodeByHash(id).params.optimize===0,owner.hash);
  assert.equal((await call('scene.inspect')).objects.find(n=>n.hash===owner.hash).params.smoothing,.45);
  await page.keyboard.press('Control+y');await page.waitForFunction(id=>frameNodeByHash(id).params.optimize===100,owner.hash);
  const redone=(await call('scene.inspect')).objects.find(n=>n.hash===owner.hash);
  assert.ifError(redone.buildError);assert.ok(redone.evaluation.report.adaptivePatches>0);
  const exact=await audit(page,owner.hash,probes);assert.ok(exact.manifold);assert.deepEqual(exact.inside,inside);
  assert.ok(Math.abs(raw.volume-exact.volume)<raw.volume*.012,JSON.stringify({raw,exact}));assert.equal(exact.faces,redone.evaluation.report.triangles);
  assert.ok(exact.faces<redone.evaluation.report.rawTriangles);
  const toggle=page.getByRole('checkbox',{name:'Fast',exact:true});
  assert.ok(await toggle.isChecked());await toggle.uncheck();
  const final=(await call('scene.inspect')).objects.find(n=>n.hash===owner.hash);
  assert.equal(final.params.fast,false);assert.ok(final.evaluation.report.reusedField);
  assert.ok(final.evaluation.report.triangles<=exact.faces);assert.ok((await audit(page,owner.hash,probes)).manifold);
  const file=await call('scene.export',{includeData:true});await call('scene.open',{name:'unite-controls.hash',base64:file.base64});
  const loaded=(await call('scene.inspect')).objects.find(n=>n.type==='unite');assert.deepEqual(loaded.params,final.params);
  await assert.rejects(call('scene.update',{id:loaded.hash,params:{optimize:101}}));
  const oldFile=await page.evaluate(async id=>{
    const n=frameNodeByHash(id);n.params={resolution:n.params.resolution};frameSyncEngineVisibility();
    return (await frameAI.call('scene.export',{includeData:true})).base64;
  },loaded.hash);
  await call('scene.open',{name:'legacy-unite.hash',base64:oldFile});
  assert.deepEqual((await call('scene.inspect')).objects.find(n=>n.type==='unite').params,{resolution:16,smoothing:0,optimize:0,fast:true});
  const percentFile=await page.evaluate(async()=>{
    const n=nodes.find(n=>n.type==='unite');n.params={resolution:16,smoothing:50,optimize:25};frameSyncEngineVisibility();
    return (await frameAI.call('scene.export',{includeData:true})).base64;
  });
  await call('scene.open',{name:'percent-unite.hash',base64:percentFile});
  const migrated=(await call('scene.inspect')).objects.find(n=>n.type==='unite');
  assert.equal(migrated.params.fast,true);assert.ok(Math.abs(migrated.params.smoothing-.325)<1e-8,JSON.stringify(migrated.params));
  await call('scene.new');
  const dust=await call('mesh.create',combine([box([0,0,0],[.4,.4,.4]),box([16,0,0],[16.4,.4,.4])]));
  const cleared=await call('scene.create',{type:'unite',inputs:[dust.hash],params:{resolution:8}});
  assert.ifError(cleared.buildError);assert.equal(cleared.evaluation.report.triangles,0);assert.equal(cleared.evaluation.report.droppedInputSolids,2);
  await call('scene.new');
  // A smooth closed surface with a small, deterministic radial ripple.
  const vertices=[0,0,-10],indices=[],rings=17,sides=32;
  for(let j=1;j<=rings;j++){
    const theta=Math.PI*j/(rings+1);
    for(let i=0;i<sides;i++){
      const phi=i*2*Math.PI/sides,r=10+.18*Math.sin(8*theta)*Math.cos(9*phi);
      vertices.push(r*Math.sin(theta)*Math.cos(phi),r*Math.sin(theta)*Math.sin(phi),-r*Math.cos(theta));
    }
  }
  const end=vertices.length/3;vertices.push(0,0,10);
  for(let i=0;i<sides;i++){
    const a=1+i,b=1+(i+1)%sides;indices.push(0,b,a);
    for(let j=0;j<rings-1;j++){const A=a+j*sides,B=b+j*sides;indices.push(A,B,B+sides,A,B+sides,A+sides);}
    indices.push(a+(rings-1)*sides,b+(rings-1)*sides,end);
  }
  const sphere=await call('mesh.create',{vertices,indices}),u=await call('scene.create',{type:'unite',inputs:[sphere.hash],params:{resolution:60}});
  assert.ifError(u.buildError);
  const roughness=id=>page.evaluate(async id=>{
    const {vertices:v,indices:t}=await frameEngine.readGeometry(id),axis=new Float64Array(v.length),lap=new Float64Array(v.length),degree=new Uint32Array(v.length/3);
    for(let i=0;i<t.length;i+=3){
      const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3,dx=v[b]-v[a],dy=v[b+1]-v[a+1],dz=v[b+2]-v[a+2],ex=v[c]-v[a],ey=v[c+1]-v[a+1],ez=v[c+2]-v[a+2];
      const n=[dy*ez-dz*ey,dz*ex-dx*ez,dx*ey-dy*ex],l=Math.hypot(...n);
      for(let j=0;j<3;j++){const p=t[i+j]*3,q=t[i+(j+1)%3]*3;degree[p/3]++;for(let k=0;k<3;k++){axis[p+k]+=n[k]/l;lap[p+k]+=v[q+k]-v[p+k];}}
    }
    let sum=0;for(let i=0;i<v.length;i+=3){const len=Math.hypot(axis[i],axis[i+1],axis[i+2]);if(len)sum+=((lap[i]*axis[i]+lap[i+1]*axis[i+1]+lap[i+2]*axis[i+2])/(degree[i/3]*len))**2;}
    return Math.sqrt(sum/degree.length);
  },id);
  const before=await audit(page,u.hash,[]),noise=await roughness(u.hash);
  const rounded=await call('scene.update',{id:u.hash,params:{smoothing:.50}});
  assert.ifError(rounded.buildError);assert.ok(rounded.evaluation.report.triangles>0);
  const afterNoise=await roughness(u.hash);assert.ok(afterNoise<noise,'roughness '+noise+' -> '+afterNoise);
  const reduced=await call('scene.update',{id:u.hash,params:{optimize:75}});
  assert.ifError(reduced.buildError);
  const after=await audit(page,u.hash,[[0,.713,.627],[15,.457,.319]]);
  assert.ok(after.manifold);assert.deepEqual(after.inside,[true,false]);assert.ok(after.faces<before.faces*.65,JSON.stringify(reduced.evaluation.report));
  assert.ok(Math.abs(after.volume/before.volume-1)<.015);
  console.log('Sub-cell solids, retained cavities and ribs, numeric attributes, field smoothing and adaptive tessellation passed',
    {before:before.faces,after:after.faces,noise,afterNoise});
  await cornerChecks(page,call);
  await regionKernelChecks();await regionBrowserChecks(page,call);
}
if(fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const session=await launch({headless:process.argv.includes('--headless')}),{page}=session,errors=[];
  try{
    page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
    await ready(page);
    const device=await page.evaluate(()=>{const a=frameEngine.renderer.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,description:a.description,hardware:!a.isFallbackAdapter,dpr:devicePixelRatio};});
    console.log('Device',JSON.stringify(device));assert.ok(device.hardware);
    await page.evaluate(()=>{window.__uniteGpuErrors=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>__uniteGpuErrors.push(e.error.message));});
    await uniteGeneratorChecks(page);
    for(const path of process.argv.slice(2).filter(p=>/\.stl$/i.test(p))){
      const name=basename(path),url=session.url+'/unite-fixture.stl';
      await page.route(url,route=>route.fulfill({path:resolve(path),contentType:'application/octet-stream'}));
      await page.evaluate(({url,name})=>frameAI.call('scene.open',{url,name}),{url,name});
      let owner=null,pitch=0,fastFaces=0,warm=null;
      const compare=process.argv.includes('--compare');
      const modes=compare?['default','fast','qualityWarm','reference','qualityCold']:['default'];
      await page.evaluate(()=>{window.__uniteMeasurements={};});
      for(const mode of modes){
        if(mode==='fast'||mode==='qualityCold'){
          await page.evaluate(({url,name})=>frameAI.call('scene.open',{url,name}),{url,name});owner=null;
        }
        const params=mode==='default'?{}:{smoothing:1.5*pitch,optimize:mode==='reference'?0:75,fast:!mode.startsWith('quality')};
        const result=await page.evaluate(async({name,params,owner,mode})=>{
          const objects=(await frameAI.call('scene.inspect')).objects;
          const start=performance.now(),u=owner?await frameAI.call('scene.update',{id:owner,params}):
            await frameAI.call('scene.create',{type:'unite',inputs:objects.filter(o=>!o.parent).map(o=>o.hash),params});
          if(u.buildError||!u.evaluation?.report?.triangles)throw Error(u.buildError||'Missing mesh');
          const ms=performance.now()-start;
          const {vertices:v,indices}=await frameEngine.readGeometry(u.hash),nv=v.length/3,invalid=0xffffffff;
          const slots=new Uint32Array(2**Math.ceil(Math.log2(Math.max(4,indices.length)))),mate=new Uint32Array(indices.length);
          const next=c=>c%3===2?c-2:c+1;
          let sixVolume=0,thinTriangles=0;
          for(let i=0;i<indices.length;i+=3){
            for(let j=0;j<3;j++){
              const c=i+j,a=indices[c],b=indices[next(c)],lo=Math.min(a,b),hi=Math.max(a,b);
              let hash=Math.imul(lo+1,0x9e3779b1)^Math.imul(hi+1,0x85ebca6b);hash=Math.imul(hash^(hash>>>16),0x7feb352d);
              let k=(hash^(hash>>>15))&(slots.length-1);
              while(slots[k]){
                const p=slots[k]-1,x=indices[p],y=indices[next(p)];
                if(Math.min(x,y)===lo&&Math.max(x,y)===hi){
                  if(mate[p]||x===a)mate[p]=invalid;
                  else{mate[p]=c+1;mate[c]=p+1;}break;
                }
                k=(k+1)&(slots.length-1);
              }
              if(!slots[k])slots[k]=c+1;
            }
            const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
            const bx=v[b]-v[a],by=v[b+1]-v[a+1],bz=v[b+2]-v[a+2],cx=v[c]-v[a],cy=v[c+1]-v[a+1],cz=v[c+2]-v[a+2];
            const ab=bx*bx+by*by+bz*bz,ac=cx*cx+cy*cy+cz*cz,bc=(bx-cx)**2+(by-cy)**2+(bz-cz)**2;
            const area2=(by*cz-bz*cy)**2+(bz*cx-bx*cz)**2+(bx*cy-by*cx)**2;
            if(area2<.030153689608*Math.max(ab*ac,ab*bc,ac*bc))thinTriangles++; // minimum angle < 10 degrees
            sixVolume+=(v[a]-v[0])*(by*cz-bz*cy)+(v[a+1]-v[1])*(bz*cx-bx*cz)+(v[a+2]-v[2])*(bx*cy-by*cx);
          }
          let badEdges=0,badVertexLinks=0;
          for(const entry of slots)if(entry&&(!mate[entry-1]||mate[entry-1]===invalid))badEdges++;
          if(!badEdges){
            const seen=new Uint8Array(indices.length),fan=new Uint8Array(nv);
            for(let i=0;i<indices.length;i++)if(!seen[i]){
              const v=indices[i];if(fan[v])badVertexLinks++;fan[v]=1;
              let c=i;do{seen[c]=1;c=next(mate[c]-1);}while(!seen[c]);
            }
          }
          if(['fast','qualityWarm','reference'].includes(mode))window.__uniteMeasurements[mode]={vertices:v,indices};
          return {owner:u.hash,name,mode,ms,thinTriangles,badEdges,badVertexLinks,volume:sixVolume/6,...u.evaluation.report};
        },{name,params,owner,mode});owner=result.owner;pitch=result.pitch;
        if(mode==='fast'){fastFaces=result.triangles;assert.equal(result.reusedVolume,false);}
        if(mode==='qualityWarm'){
          assert.equal(result.reusedVolume,true);assert.equal(result.reusedField,true);assert.ok(result.triangles<=fastFaces);
          warm=result;
        }
        if(mode==='qualityCold'){
          for(const k of ['triangles','perimeterPatches','perimeterCells','interiorCrossingsSkipped'])
            assert.equal(result[k],warm[k],name+' cold and cached '+k);
        }
        console.log('STL',JSON.stringify(result));
        assert.equal(result.badEdges,0,'Every edge has two opposing faces in '+name);
        assert.equal(result.badVertexLinks,0,'Every vertex has one closed fan in '+name);assert.ok(result.volume>0);
      }
      if(compare){
        for(const model of ['fast','qualityWarm']){
          const forward=await page.evaluate(surfaceDeviation,{from:'reference',to:model,pitch});
          const reverse=await page.evaluate(surfaceDeviation,{from:model,to:'reference',pitch});
          console.log('Deviation',JSON.stringify({name,model,pitch,referenceToMesh:forward,meshToReference:reverse}));
          assert.ok(Math.max(forward.distanceMm.p99,reverse.distanceMm.p99)<pitch*.5,'Sampled 99th percentile deviation exceeds half a cell');
        }
      }
      await page.evaluate(()=>{delete window.__uniteMeasurements;});
      await page.unroute(url);
    }
    assert.deepEqual(await page.evaluate(()=>__uniteGpuErrors),[]);assert.deepEqual(errors,[]);
  }finally{await session.close();}
}
