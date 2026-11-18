import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const app=await launch({headless:true}),page=app.page;
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const project=async(hash,point)=>(await call('view.project',{id:hash,point})).screen;
const state=()=>call('scene.inspect');
const geometry=async hash=>page.evaluate(async h=>{
  const mesh=frameEngine.scene.meshes.find(m=>m.hashId===h),raw=await frameEngine.readGeometry(mesh);
  return {vertices:Array.from(raw.vertices),indices:Array.from(raw.indices)};
},hash);
const quad={vertices:[-60,-60,0,60,-60,0,60,60,0,-60,60,0],indices:[0,1,2,0,2,3]};
const gap={vertices:[-100,-40,0,-40,-40,0,-40,40,0,-100,40,0,40,-40,0,100,-40,0,100,40,0,40,40,0],indices:[0,1,2,0,2,3,4,5,6,4,6,7]};
const errors=[],failures=[];
page.on('pageerror',e=>errors.push(e.message));
async function fixture(data,mode,storage,view=2){
  await page.keyboard.press('Escape');
  await call('scene.new');
  const n=await call('mesh.create',{...data,storage});
  await call('view.set',{index:view,single:true,mode,shading:'solid-wire',focus:n.hash,snap:false,quantize:false,pivot:false});
  await call('scene.select',{ids:[n.hash],mode,...mode==='edge'?{}:{components:[]}});
  return n;
}
async function choose(at,name){
  await page.mouse.click(...at,{button:'right'});
  await page.getByRole('menuitem',{name,exact:true}).click();
}
async function drag(a,b){
  await page.mouse.move(...a);await page.mouse.down();
  await page.mouse.move(...b,{steps:5});await page.mouse.up();
}
function vertexAt(g,p,tolerance=.001){
  for(let i=0;i<g.vertices.length;i+=3)if(Math.hypot(...p.map((x,k)=>x-g.vertices[i+k]))<tolerance)return i/3;
  return -1;
}
// The two endpoints must be connected by actual mesh edges on the finite segment.
function seam(g,a,b,tolerance=.001){
  const start=vertexAt(g,a,tolerance),end=vertexAt(g,b,tolerance),dir=b.map((x,k)=>x-a[k]),length=dir.reduce((s,x)=>s+x*x,0);
  if(start<0||end<0)return false;
  const on=v=>{const d=a.map((x,k)=>g.vertices[v*3+k]-x),t=d.reduce((s,x,k)=>s+x*dir[k],0)/length;return t>=-.001&&t<=1.001&&Math.hypot(...d.map((x,k)=>x-t*dir[k]))<tolerance;};
  const neighbours=new Map();
  for(let i=0;i<g.indices.length;i+=3)for(let k=0;k<3;k++){
    const v=g.indices[i+k],w=g.indices[i+(k+1)%3];if(!on(v)||!on(w))continue;
    for(const [x,y] of [[v,w],[w,v]]){if(!neighbours.has(x))neighbours.set(x,[]);neighbours.get(x).push(y);}
  }
  const seen=new Set([start]);for(const v of seen)for(const w of neighbours.get(v)||[])seen.add(w);
  return seen.has(end);
}
async function test(name,fn){
  if(process.argv[2]&&!name.includes(process.argv[2]))return;
  try{const start=performance.now();await fn();console.log('PASS '+name+' ('+Math.round(performance.now()-start)+' ms)');}
  catch(error){console.error('FAIL '+name+' '+error.message);failures.push(name);}
}
try{
  await ready(page);
  assert.equal(await page.evaluate(()=>frameEngine.renderer.device.adapterInfo.isFallbackAdapter),false);
  await page.evaluate(()=>{window.gestureGPUErrors=[];frameEngine.renderer.device.addEventListener('uncapturederror',e=>gestureGPUErrors.push(e.error.message));});
  for(const storage of ['auto','texture']){
    for(const gesture of ['Shift selection','two clicks','one preselected','drag','retry']){
      await test(storage+' Bridge '+gesture,async()=>{
        const n=await fixture(gap,'edge',storage),a=await project(n.hash,[-40,0,0]),b=await project(n.hash,[40,0,0]);
        // Inside the hover radius on the empty side of both silhouette edges.
        a[0]+=7;b[0]-=7;
        if(gesture==='Shift selection'||gesture==='one preselected')await page.mouse.click(...a);
        if(gesture==='Shift selection'){await page.keyboard.down('Shift');await page.mouse.click(...b);await page.keyboard.up('Shift');}
        if(gesture==='retry'){
          await choose(a,'Bridge');await page.mouse.move(...a);await page.mouse.down();await page.mouse.move(...b);
          await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await geometry(n.hash),gap);
        }
        await choose(a,'Bridge');const started=performance.now();
        if(gesture==='two clicks'){await page.mouse.click(...a);await page.mouse.click(...b);}
        if(gesture==='retry'){await page.mouse.click(...a);await page.mouse.click(...a);await page.mouse.click((a[0]+b[0])/2,a[1]);await page.mouse.click(...b);}
        if(gesture==='one preselected')await page.mouse.click(...b);
        if(gesture==='drag')await drag(a,b);
        const edited=(await state()).objects.find(o=>o.id===n.id);
        assert.equal(edited.mesh.triangles,6);assert.ok(performance.now()-started<2000);
        const g=await geometry(edited.hash);
        assert.ok(g.indices.slice(12).includes(1)&&g.indices.slice(12).includes(2)&&g.indices.slice(12).includes(4)&&g.indices.slice(12).includes(7));
        await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),gap);
        if(gesture==='Shift selection')assert.deepEqual((await page.evaluate(h=>frameEngine.polygonSelection(h),n.hash)).edges.sort(),['1:2','4:7']);
      });
    }
    await test(storage+' Bridge adjoining edges and occupied faces',async()=>{
      const data={vertices:[-80,0,0,0,0,0,0,80,0,-80,-80,0,80,80,0],indices:[1,0,3,2,1,4]},n=await fixture(data,'edge',storage);
      const a=await project(n.hash,[-40,0,0]),b=await project(n.hash,[0,40,0]);await choose(a,'Bridge');await drag(b,a);
      const edited=(await state()).objects.find(o=>o.id===n.id);assert.equal(edited.mesh.triangles,3);
      assert.deepEqual((await geometry(edited.hash)).indices.slice(-3).sort(),[0,1,2]);
      const sheet=await fixture(quad,'edge',storage);
      await assert.rejects(call('mesh.edit',{id:sheet.hash,op:'bridge',edges:['0:1','2:3']}),/Bridge/);
      assert.deepEqual(await geometry(sheet.hash),quad);
    });
    for(const gesture of ['highlighted vertices','highlighted edges','two face interiors','drag across face']){
      await test(storage+' Line Cut '+gesture,async()=>{
        const snapped=gesture==='highlighted vertices',edge=gesture==='highlighted edges',n=await fixture(quad,snapped?'vertex':edge?'edge':'polygon',storage);
        const a=snapped?[60,-60,0]:edge?[-60,10,0]:[-32,12,0],b=snapped?[-60,60,0]:edge?[60,-10,0]:[23,20,0];
        const A=await project(n.hash,a),B=await project(n.hash,b);
        await choose(A,'Line Cut');
        if(snapped){A[0]+=4;A[1]+=3;B[0]-=4;B[1]-=3;}
        if(edge){A[0]-=7;B[0]+=7;}
        const started=performance.now();
        if(gesture.startsWith('drag'))await drag(A,B);else{await page.mouse.click(...A);await page.mouse.click(...B);}
        const edited=(await state()).objects.find(o=>o.id===n.id),g=await geometry(edited.hash);
        assert.ok(seam(g,a,b,snapped?.001:.5),'missing cut edge chain '+JSON.stringify(g));
        assert.ok(performance.now()-started<2000);
        await page.keyboard.press('Enter');await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),quad);
      });
    }
    await test(storage+' Line Cut continuous strokes and background',async()=>{
      const n=await fixture(quad,'polygon',storage),a=[-45,30,0],bend=[-13,8,0],b=[33,22,0];
      await call('scene.select',{ids:[n.hash],mode:'polygon',components:[0]});
      const points=await Promise.all([a,bend,b].map(p=>project(n.hash,p)));await choose(points[0],'Line Cut');
      for(const p of points)await page.mouse.click(...p);
      await page.mouse.click(...points.at(-1),{button:'right'});
      const edited=(await state()).objects.find(o=>o.id===n.id),g=await geometry(edited.hash);
      assert.ok(seam(g,a,bend,.5)&&seam(g,bend,b,.5),'both spans must be connected across the surface');
      const junction=vertexAt(g,bend,.5);assert.equal(g.vertices.filter((v,i)=>i%3===0&&Math.hypot(...g.vertices.slice(i,i+3).map((x,k)=>x-g.vertices[junction*3+k]))<.001).length,1);
      const miss=await Promise.all([[-70,-70,0],[-79,-67,0]].map(p=>project(edited.hash,p))),before=await page.evaluate(()=>undoStack.length);
      await choose(miss[0],'Line Cut');for(const p of miss)await page.mouse.click(...p);await state();
      assert.equal(await page.evaluate(()=>undoStack.length),before);assert.deepEqual(await geometry(edited.hash),g);
      await page.keyboard.press('Escape');await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),quad);
      await call('edit.history',{action:'redo'});assert.deepEqual(await geometry(edited.hash),g);
    });
    for(const immediate of [false,true])await test(storage+' deselect after vertex move '+(immediate?'immediate':'settled'),async()=>{
      const n=await fixture(quad,'vertex',storage);await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0]});
      const a=await project(n.hash,[-60,-60,0]),b=[a[0]+24,a[1]-15],blank=await project(n.hash,[-78,-68,0]);
      await drag(a,b);if(!immediate)await state();await page.mouse.click(...blank);
      const after=await state(),g=await geometry(after.objects.find(o=>o.id===n.id).hash);
      assert.ok(vertexAt(g,[-60,-60,0])<0,'move must have completed');
      assert.ok(after.selection.counts.every(n=>!n)&&!await page.evaluate(()=>frameEngine.gizmoState),'selection or gizmo survived');
    });
    for(const view of [2,0])await test(storage+' vertex snap '+(view?'orthographic':'perspective'),async()=>{
      const source=[-34,-11,0],target=[23.4,16.6,view?0:9],fixtureData={vertices:[...source,-70,-18,0,-48,-52,0,...target,51,8,-15,33,52,-10],indices:[0,1,2,3,4,5]};
      const n=await fixture(fixtureData,'vertex',storage,view);
      await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0]});await call('view.set',{snap:true});
      const a=await project(n.hash,source),b=await project(n.hash,target),end=[b[0]+7,b[1]-4];
      await drag(a,end);await page.mouse.move(27,55);
      const after=await state(),g=await geometry(after.objects.find(o=>o.id===n.id).hash),id=vertexAt(g,target);
      assert.equal(g.vertices.length/3,5,'expected a weld at the stationary vertex '+JSON.stringify(g));
      assert.ok(id>=0&&g.indices.filter(v=>v===id).length===2);
    });
    await test(storage+' snap to a second mesh and release a previous target',async()=>{
      const source=[-34,-11,0],target=[18.7,14.3,0],n=await fixture({vertices:[...source,-65,-35,0,-54,46,0],indices:[0,1,2]},'vertex',storage);
      const second=await call('mesh.create',{vertices:[...target,30,-23,0,52,20,0],indices:[0,1,2],storage});
      const group=await call('scene.group',{ids:[n.hash,second.hash]});await call('view.set',{snap:true,focus:group.hash});await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0]});
      const a=await project(n.hash,source),b=await project(n.hash,target);
      await drag(a,[b[0]+4,b[1]+2]);await state();let g=await geometry(n.hash);
      assert.equal(vertexAt(g,target),0,JSON.stringify({g,a,b,target,snap:await page.locator('#frame-engine-canvas').getAttribute('data-snap'),canvas:await page.locator('#frame-engine-canvas').boundingBox()}));assert.equal(g.vertices.length/3,3);
      await page.mouse.move(...b);await page.mouse.down();await page.mouse.move(b[0]+4,b[1]+2);
      await page.mouse.move(b[0]+36,b[1]+27,{steps:3});await page.mouse.up();await state();g=await geometry(n.hash);
      assert.ok(vertexAt(g,target)<0);assert.ok(Math.hypot(...g.vertices.slice(0,3).map((x,k)=>x-target[k]))>2);
    });
  }
  assert.deepEqual(await page.evaluate(()=>gestureGPUErrors),[]);assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await app.close();}
