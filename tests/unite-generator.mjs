import assert from 'node:assert/strict';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';
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
  await call('scene.new');
  await upperToolbarChecks(page,(name,pass,detail)=>assert.ok(pass,name+' '+JSON.stringify(detail)));
  const cam=page.locator('#btnRender');
  await cam.click();let rows=await inspect();assert.deepEqual(rows.map(r=>r.type),['render']);
  const rect=await cam.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+8,{steps:4});
  const target=page.getByRole('menuitem',{name:'Target',exact:true});await target.waitFor();
  assert.equal(await page.locator('#menu button').count(),1);
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
  assert.ok(rows.every(r=>!r.parent));assert.equal(await page.locator('#btnBoolean + #btnUnite').count(),1);
  const operand=await call('mesh.create',{name:'Dragged box',...box([0,0,0],[5,5,5])});
  const from=await page.locator('#row-'+operand.id+' .ob-name').boundingBox(),to=await page.locator('#row-'+empty.id).boundingBox();
  await page.mouse.move(from.x+8,from.y+6);await page.mouse.down();await page.mouse.move(from.x+18,from.y+6,{steps:3});
  await page.mouse.move(to.x+46,to.y+8,{steps:5});await page.mouse.up();
  rows=await inspect();assert.equal(rows.find(r=>r.hash===operand.hash).parent,empty.hash);
  assert.equal(rows.find(r=>r.hash===empty.hash).evaluation.report.triangles,12);
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
  assert.equal(u.evaluation.report.backend,'Exact rectilinear');assert.ok(u.evaluation.report.triangles<1000);
  const probes=[[1,3.123,4.27],[6.5,4.13,5.24],[7.3,4.31,5.11],[8,4.97,5.31],[12,4.53,4.71],[16,4.23,5.36]];
  const expected=[true,true,false,true,true,false];
  const result=await audit(page,u.hash,probes);assert.ok(result.manifold);assert.deepEqual(result.inside,expected);
  const volume=1000+5*8.2*8.9-2*6*6+1*2*2;
  assert.ok(Math.abs(result.volume-volume)<.001);
  let visible=await page.evaluate(()=>frameEngine.scene.meshes.filter(m=>m.frameVisible!==false).map(m=>m.hashId));
  assert.deepEqual(visible,[u.hash]);
  console.log('Solid overlaps, closed cavity, island, grouped and texture-backed inputs passed',u.evaluation.report);
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
  return {pass:true,checks:[{name:'Camera click, pointer and touch Target gestures',pass:true},
    {name:'Unite hierarchy, publication, fill, editable and persistence',pass:true}],timings:[]};
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
      const result=await page.evaluate(async({url,name})=>{
        await frameAI.call('scene.open',{url,name});
        const objects=(await frameAI.call('scene.inspect')).objects;
        const start=performance.now(),u=await frameAI.call('scene.create',{type:'unite',inputs:objects.filter(o=>!o.parent).map(o=>o.hash)});
        if(u.buildError||!u.mesh?.triangles&&!u.evaluation?.report?.triangles)throw Error(u.buildError||'Missing mesh');
        const ms=performance.now()-start;
        const {vertices,indices}=await frameEngine.readGeometry(u.hash),edges=new Float64Array(indices.length),nv=vertices.length/3;
        for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){
          const a=indices[i+j],b=indices[i+(j+1)%3];edges[i+j]=2*(Math.min(a,b)*nv+Math.max(a,b))+Number(a>b);
        }
        edges.sort();let badEdges=0;
        for(let i=0;i<edges.length;){
          const e=Math.floor(edges[i]/2)*2;let j=i+1;
          while(j<edges.length&&edges[j]<=e+1)j++;
          if(j!==i+2||edges[i]!==e||edges[i+1]!==e+1)badEdges++;i=j;
        }
        return {name,ms,badEdges,...u.evaluation.report};
      },{url,name});console.log('STL',JSON.stringify(result));await page.unroute(url);
      assert.equal(result.badEdges,0,'Every edge has two opposing faces in '+name);
    }
    assert.deepEqual(await page.evaluate(()=>__uniteGpuErrors),[]);assert.deepEqual(errors,[]);
  }finally{await session.close();}
}
