import {holdCameraReadback} from './camera-view.mjs';
import assert from 'node:assert/strict';
import {launch,ready} from '../tools/browser.mjs';

const app=await launch({headless:true}),page=app.page;
const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
const project=async(hash,point)=>(await call('view.project',{id:hash,point})).screen;
const state=()=>call('scene.inspect');
const historyKey=async key=>{await page.keyboard.press(key);await page.waitForFunction(()=>frameEngine.idle);await page.evaluate(()=>frameEngine.draw(true));};
const geometry=async hash=>page.evaluate(async h=>{
  const mesh=frameEngine.scene.meshes.find(m=>m.hashId===h),raw=await frameEngine.readGeometry(mesh);
  return {vertices:Array.from(raw.vertices),indices:Array.from(raw.indices)};
},hash);
const quad={vertices:[-60,-60,0,60,-60,0,60,60,0,-60,60,0],indices:[0,1,2,0,2,3]};
const gap={vertices:[-100,-40,0,-40,-40,0,-40,40,0,-100,40,0,40,-40,0,100,-40,0,100,40,0,40,40,0],indices:[0,1,2,0,2,3,4,5,6,4,6,7]};
const errors=[],failures=[];
page.on('pageerror',e=>{errors.push(e.stack||e.message);console.error('Browser error '+(e.stack||e.message));});
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
async function checkPointGizmo(owner,g){
  const id=g.vertices.length/3-1,point=g.vertices.slice(-3);
  const selected=await page.evaluate(h=>frameEngine.polygonSelection(h),owner.hash);
  const xy=await project(owner.hash,point),gizmo=await page.evaluate(()=>frameEngine.gizmoState?.at);
  assert.deepEqual(selected.vertices,[id],'the added vertex is the only component selected');
  assert.ok(gizmo&&Math.hypot(gizmo[0]-xy[0],gizmo[1]-xy[1])<1,'added vertex '+xy+' and gizmo '+gizmo);
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
    for(const view of [2,0])await test(storage+' Ctrl Add Point '+(view?'orthographic':'perspective'),async()=>{
      const data={vertices:[-50,-50,-12,50,-50,4,50,50,12,-50,50,-4],indices:[0,1,2,0,2,3]};
      for(const [where,point,triangles] of [['shared edge',[-25,-25,-6],4],['face',[22,-10,2.72],4],['boundary',[50,-21,6.32],3]]){
        const n=await fixture(data,'vertex',storage,view),at=await project(n.hash,point);
        await call('scene.select',{ids:[n.hash],mode:'vertex',components:[3]});
        await page.keyboard.down('Control');await page.mouse.click(...at);await page.keyboard.up('Control');
        const edited=(await state()).objects.find(o=>o.id===n.id),g=await geometry(edited.hash);
        assert.equal(g.vertices.length,15,where);assert.equal(g.indices.length/3,triangles,where);
        await checkPointGizmo(edited,g);const screen=await project(edited.hash,g.vertices.slice(-3));
        assert.ok(Math.hypot(screen[0]-at[0],screen[1]-at[1])<1.5,where+' click '+at+' created '+screen);
        await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),data);
        assert.deepEqual((await page.evaluate(h=>frameEngine.polygonSelection(h),n.hash)).vertices,[3]);
        await call('edit.history',{action:'redo'});assert.deepEqual(await geometry(edited.hash),g);await checkPointGizmo(edited,g);
      }
    });
    await test(storage+' Ctrl Add Point on a transformed mesh',async()=>{
      const n=await fixture(quad,'vertex',storage,0),parent=await call('scene.group',{ids:[n.hash]});
      await call('transform.apply',{ids:[parent.hash],position:[160,70,-35],rotation:[21,15,29]});
      await call('view.set',{index:0,focus:n.hash,mode:'vertex'});await call('scene.select',{ids:[n.hash],mode:'vertex',components:[]});
      const target=await project(n.hash,[-32,-32,0]);await page.keyboard.down('Control');await page.mouse.click(...target);await page.keyboard.up('Control');
      const owner=(await state()).objects.find(o=>o.id===n.id),g=await geometry(owner.hash);assert.equal(g.indices.length,12);
      assert.ok(vertexAt(g,[-32,-32,0],.6)>=0);await checkPointGizmo(owner,g);
      await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),quad);
      await call('edit.history',{action:'redo'});await checkPointGizmo(owner,g);
      const start=await project(owner.hash,g.vertices.slice(-3)),view=(await state()).view.camera;
      await drag(start,[start[0]+19,start[1]-15]);await state();const moved=await geometry(owner.hash);
      assert.deepEqual(moved.vertices.slice(0,-3),g.vertices.slice(0,-3));assert.notDeepEqual(moved.vertices.slice(-3),g.vertices.slice(-3));
      assert.deepEqual((await state()).view.camera,view);
    });
    await test(storage+' Ctrl click through a gizmo handle and near an edge',async()=>{
      const n=await fixture(quad,'vertex',storage);await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0,1,2,3]});await call('diagnostics.frame',{frames:1});
      const handle=await page.evaluate(()=>frameEngine.gizmoState.handles.find(h=>h.part==='move0').suggested);
      await page.keyboard.down('Control');await page.mouse.click(...handle);await page.keyboard.up('Control');
      let owner=(await state()).objects.find(o=>o.id===n.id),g=await geometry(owner.hash),xy=await project(owner.hash,g.vertices.slice(-3));
      assert.equal(g.vertices.length,15);assert.ok(Math.hypot(xy[0]-handle[0],xy[1]-handle[1])<1.5);await call('edit.history',{action:'undo'});
      const near=await project(n.hash,[-8,-6.6,0]),onEdge=await project(n.hash,[-7.3,-7.3,0]);
      await page.mouse.move(...near);await page.keyboard.down('Control');
      const marker=page.locator('#frame-spline-insert');await marker.waitFor({state:'visible',timeout:3000});
      const box=await marker.boundingBox(),at=[box.x+box.width/2,box.y+box.height/2];
      assert.ok(Math.hypot(at[0]-onEdge[0],at[1]-onEdge[1])<1.5,'preview snaps to edge '+at+' vs '+onEdge);
      await page.mouse.click(...near);await page.keyboard.up('Control');
      owner=(await state()).objects.find(o=>o.id===n.id);g=await geometry(owner.hash);xy=await project(owner.hash,g.vertices.slice(-3));
      assert.equal(g.vertices.length,15);assert.equal(g.indices.length/3,4);assert.ok(Math.hypot(xy[0]-at[0],xy[1]-at[1])<1.5);await call('edit.history',{action:'undo'});
    });
    await test(storage+' component rotation, scale and geodesic soft move',async()=>{
      const data={vertices:[-60,-30,0,-20,-30,0,-60,10,0,40,0,0,60,0,0,40,20,0],indices:[0,1,2,3,4,5]},n=await fixture(data,'polygon',storage);
      const at=await project(n.hash,[-50,-18,0]);await page.mouse.click(...at);await state();
      for(const [channel,axis,value]of [['rotation',2,35],['size',0,65]]){
        await call('transform.set',{channel,axis,value,coordinates:'world'});const g=await geometry(n.hash);
        assert.deepEqual(g.vertices.slice(9),data.vertices.slice(9));assert.notDeepEqual(g.vertices.slice(0,9),data.vertices.slice(0,9));assert.deepEqual(g.indices,data.indices);
        await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),data);
      }
      await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0]});await call('selection.soft',{enabled:true,radius:80});
      const weights=await call('diagnostics.softSelection',{id:n.hash,vertices:[0,1,2,3]});assert.deepEqual(weights.weights,[1,.5,.5,0]);
      await call('transform.set',{channel:'position',axis:2,value:10,coordinates:'world'});const moved=await geometry(n.hash);
      assert.deepEqual(moved.vertices.filter((v,i)=>i%3===2),[10,5,5,0,0,0]);
      await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),data);await call('selection.soft',{enabled:false});
    });
    await test(storage+' collinear weld preserves a thin adjacent face',async()=>{
      const data={vertices:[0,30,0,0,0,0,-30,0,0,30,0,0,30,.001,0,-30,-30,0],indices:[0,2,3,0,3,4,1,5,2]};
      const n=await fixture(data,'vertex',storage);await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0]});await call('view.set',{snap:true});
      await drag(await project(n.hash,[0,30,0]),await project(n.hash,[0,0,0]));await state();const g=await geometry(n.hash);
      assert.equal(g.indices.length,6);const triangles=[];
      for(let i=0;i<g.indices.length;i+=3){const [a,b,c]=g.indices.slice(i,i+3).map(v=>g.vertices.slice(v*3,v*3+3));triangles.push(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])));}
      assert.ok(triangles.every(a=>a>0)&&triangles.some(a=>a<.04));await call('edit.history',{action:'undo'});assert.equal((await geometry(n.hash)).indices.length,9);
    });
    await test(storage+' immediate Loop and Close Hole',async()=>{
      const data={vertices:[-60,-40,0,0,-40,0,60,-40,0,-60,40,0,0,40,0,60,40,0],indices:[0,1,4,0,4,3,1,2,5,1,5,4]},n=await fixture(data,'edge',storage);
      const at=await project(n.hash,[-37,-40,0]);at[1]+=5;await choose(at,'Loop Selection');await page.mouse.click(...at);
      await state();assert.deepEqual((await page.evaluate(h=>frameEngine.polygonSelection(h),n.hash)).edges.sort(),['0:1','1:2']);
      const open={vertices:[-60,-50,0,60,-50,0,0,55,0,0,0,-45],indices:[1,0,3,2,1,3,0,2,3]},hole=await fixture(open,'edge',storage);
      const rim=await project(hole.hash,[-22,-50,0]);rim[1]+=5;await choose(rim,'Close Polygonal Hole');
      await page.mouse.click(rim[0],rim[1]+45);assert.equal((await state()).selection.tool,'closeHole');
      await page.mouse.click(...rim);const edited=(await state()).objects.find(o=>o.id===hole.id);
      assert.equal(edited.mesh.triangles,4);assert.deepEqual((await geometry(edited.hash)).indices.slice(-3).sort(),[0,1,2]);
      await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(hole.hash),open);
    });
    for(const soft of [false,true])await test(storage+' snap drops collapsed faces and orphans'+(soft?' with isolated Soft Selection':''),async()=>{
      const data={vertices:[-30,-30,0,30,-30,0,30,30,0,-30,30,0,-60,-56,0],indices:[0,1,2,0,2,3,1,0,4]},n=await fixture(data,'vertex',storage);
      await call('scene.select',{ids:[n.hash],mode:'vertex',components:[0]});await call('view.set',{snap:true});
      if(soft)await call('selection.soft',{enabled:true,radius:1});
      const from=await project(n.hash,[-30,-30,0]),to=await project(n.hash,[30,-30,0]);await drag(from,[to[0]+3,to[1]-2]);
      if(soft)await call('selection.soft',{enabled:false});
      const edited=(await state()).objects.find(o=>o.id===n.id),g=await geometry(edited.hash);
      assert.equal(g.indices.length,3,JSON.stringify(g));assert.equal(g.vertices.length,9);
      assert.deepEqual(g.indices.map(v=>g.vertices.slice(v*3,v*3+3)),[[30,-30,0],[30,30,0],[-30,30,0]]);
      await historyKey('Control+z');await state();assert.deepEqual(await geometry(n.hash),data);
      await historyKey('Control+Shift+z');await state();assert.deepEqual(await geometry(edited.hash),g);
    });
    await test(storage+' weld the last polygon, Undo and Redo',async()=>{
      const data={vertices:[-40,-40,0,40,-40,0,0,40,0],indices:[0,1,2]},n=await fixture(data,'vertex',storage);
      await call('scene.select',{ids:[n.hash],mode:'vertex',components:[1]});await call('view.set',{snap:true});
      const a=await project(n.hash,[40,-40,0]),b=await project(n.hash,[-40,-40,0]);await drag(a,b);
      const empty=(await state()).objects.find(o=>o.id===n.id);assert.ok(empty?.type==='mesh'&&!empty.mesh?.triangles,JSON.stringify(empty));
      await historyKey('Control+z');await state();assert.deepEqual(await geometry(n.hash),data);
      assert.deepEqual((await page.evaluate(h=>frameEngine.polygonSelection(h),n.hash)).vertices,[1]);
      await historyKey('Control+Shift+z');const again=(await state()).objects.find(o=>o.id===n.id);assert.ok(again?.type==='mesh'&&!again.mesh?.triangles);
    });
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
  await test('weld preserves surviving material masks and corner UVs',async()=>{
    const n=(await call('scene.open',{url:'tests/scenes/material-selects.gltf'})).objects.find(o=>o.mesh);
    const data=await geometry(n.hash),appearance=(hash,corners,faces)=>call('diagnostics.appearance',{id:hash,corners,faces});
    const before=await appearance(n.hash,[0,1,2,3,4,5],[0,1]),shared=data.indices.slice(0,3).filter(v=>data.indices.slice(3).includes(v));
    const source=data.indices.slice(0,3).find(v=>!shared.includes(v)),target=shared[0],at=v=>project(n.hash,data.vertices.slice(v*3,v*3+3));
    await call('view.set',{index:2,single:true,mode:'vertex',focus:n.hash,snap:true});await call('scene.select',{ids:[n.hash],mode:'vertex',components:[source]});
    await drag(await at(source),await at(target));await state();
    const g=await geometry(n.hash),after=await appearance(n.hash,[0,1,2],[0]);assert.equal(g.indices.length,3);
    assert.deepEqual(after.uv.samples.map(q=>q.value),before.uv.samples.slice(3).map(q=>q.value));
    assert.deepEqual(after.materials.map(q=>q.samples[0].selected),before.materials.map(q=>q.samples[1].selected));
    await call('edit.history',{action:'undo'});assert.deepEqual(await geometry(n.hash),data);assert.deepEqual(await appearance(n.hash,[0,1,2,3,4,5],[0,1]),before);
    await call('edit.history',{action:'redo'});assert.deepEqual(await appearance(n.hash,[0,1,2],[0]),after);
    const saved=await call('scene.export',{includeData:true});await call('scene.open',{name:'welded.hash',base64:saved.base64});
    assert.deepEqual(await geometry(n.hash),g);const loaded=await appearance(n.hash,[0,1,2],[0]);
    assert.deepEqual(loaded.uv.samples,after.uv.samples);assert.deepEqual(loaded.materials.map(m=>m.samples),after.materials.map(m=>m.samples));
  });
  await test('Perspective orbit keeps visible inside-corner vertices and hides covered vertices',async()=>{
    const folded={vertices:[],indices:[]};
    for(const y of [-60,0,60])for(const x of [-60,0,60])folded.vertices.push(x,y,-Math.abs(x));
    for(const i of [0,1,3,4])folded.indices.push(i,i+1,i+4,i,i+4,i+3);
    const n=await fixture(folded,'vertex','auto',0);
    const cover=await call('mesh.create',{vertices:[-80,-80,-30,80,-80,-30,80,80,-30,-80,80,-30],indices:[0,1,2,0,2,3]});
    const bounds=await page.locator('#frame-engine-canvas').boundingBox(),start=[bounds.x+bounds.width*.13,bounds.y+bounds.height*.24];
    for(const shading of ['solid-wire','solid'])for(const selected of [false,true]){
      for(const covered of [false,true]){
        await call('scene.update',{id:cover.hash,visible:covered});
        await call('view.set',{index:0,single:true,mode:'vertex',shading,camera:[0,0,1,0,0,0,0,0,0,0,-300,300]});
        await call('scene.select',{ids:[n.hash],mode:'vertex',components:selected?[4]:[]});
        await page.mouse.move(...start);await page.mouse.down();
        const wrong=[],angles=new Set();
        try{for(let i=1;i<=18;i++){
          await page.mouse.move(start[0]+i*3,start[1]+Math.sin(i/3)*3);
          const p=await project(n.hash,[0,0,0]),color=(await call('diagnostics.pixels',{points:[p]})).colors[0];
          const marker=selected?color[0]>248&&Math.abs(color[1]-122)<=2&&color[2]<25:[153,163,179].every((v,k)=>Math.abs(color[k]-v)<=2);
          angles.add(await page.evaluate(()=>frameEngine.viewCamera(0).camera[0]));
          if(marker===covered)wrong.push({frame:i,color,point:p});
        }}finally{await page.mouse.up();}
        assert.ok(angles.size>=12,'native drag must orbit the camera');
        assert.equal(wrong.length,0,JSON.stringify({shading,selected,covered,wrong}));
      }
    }
  });
  await test('Perspective framing survives polygon cuts, vertex moves and Undo key repeats',async()=>{
    async function checkViewDuringShortcut(keys){
      await page.evaluate(()=>{
        const read=()=>[...frameEngine.viewCamera(0).camera,...frameEngine.pluginProject([23,17,5])];
        const before=read();let changed=null,frames=0,ticket;
        function sample(){const view=read();frames++;if(!changed&&view.some((v,k)=>v!==before[k]))changed=view;}
        function tick(){sample();ticket=requestAnimationFrame(tick);}
        ticket=requestAnimationFrame(tick);
        window.finishHistoryViewSample=()=>{cancelAnimationFrame(ticket);sample();return {before,changed,frames};};
      });
      const start=performance.now();let sample;
      try{
        await keys();await page.waitForFunction(()=>frameEngine.idle);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      }finally{sample=await page.evaluate(()=>{const result=window.finishHistoryViewSample();delete window.finishHistoryViewSample;return result;});}
      assert.ok(performance.now()-start<2500,'camera and polygon history must settle within 2500 ms');
      assert.ok(sample.frames>=2);assert.equal(sample.changed,null,JSON.stringify(sample));
    }
    const cutOwner=await fixture(quad,'polygon','auto',0);
    const a=await project(cutOwner.hash,[-32,12,0]),b=await project(cutOwner.hash,[23,20,0]);
    await choose(a,'Line Cut');await page.mouse.click(...a);await page.mouse.click(...b);
    await checkViewDuringShortcut(()=>page.keyboard.press('Control+z'));
    assert.equal((await state()).objects.find(o=>o.id===cutOwner.id)?.hash,cutOwner.hash,'immediate Undo must keep the original editable mesh');
    assert.deepEqual(await geometry(cutOwner.hash),quad);
    await checkViewDuringShortcut(()=>page.keyboard.press('Control+Shift+z'));
    const cut=(await state()).objects.find(o=>o.id===cutOwner.id);
    assert.ok((await geometry(cut.hash)).indices.length>quad.indices.length);

    const source=[-34,-11,0],target=[23.4,16.6,9];
    const mesh={vertices:[...source,-70,-18,0,-48,-52,0,...target,51,8,-15,33,52,-10],indices:[0,1,2,3,4,5]};
    const owner=await fixture(mesh,'vertex','auto',0),original=await geometry(owner.hash);
    await call('scene.select',{ids:[owner.hash],mode:'vertex',components:[0]});await call('view.set',{snap:true});
    const from=await project(owner.hash,source),to=await project(owner.hash,target);
    await drag(from,[to[0]+7,to[1]-4]);await state();
    assert.equal((await geometry(owner.hash)).vertices.length,15);
    await checkViewDuringShortcut(async()=>{
      await page.keyboard.down('Control');await page.keyboard.down('z');await page.keyboard.up('Control');
      // A held key repeats with the current modifiers after Control is released.
      await page.keyboard.down('z');await page.keyboard.up('z');
    });
    assert.deepEqual(await geometry(owner.hash),original);
    await call('view.set',{snap:false});await call('scene.select',{ids:[owner.hash],mode:'vertex',components:[0]});
    await drag(from,[from[0]+22,from[1]-19]);
    await checkViewDuringShortcut(()=>page.keyboard.press('Control+z'));
    assert.deepEqual(await geometry(owner.hash),original);
    const beforeFocus=(await state()).view.frame;
    await page.keyboard.press('z');
    assert.notDeepEqual((await state()).view.frame,beforeFocus,'a fresh Z press must still frame the selection');
  });
  await test('immediate Undo after Ctrl Add Point leaves the Camera and navigation intact',async()=>{
    const n=await fixture(quad,'vertex','auto',0),cam=await call('scene.create',{type:'render',params:{realtime:'off'}});
    await call('scene.select',{ids:[n.hash],mode:'vertex',components:[]});
    const at=await project(n.hash,[-25,12,0]),before=(await state()).view;
    await page.keyboard.down('Control');await page.mouse.click(...at);await page.keyboard.press('z');await page.keyboard.up('Control');
    await state();await page.waitForFunction(()=>frameEngine.idle);const latest=await state(),owner=latest.objects.find(o=>o.id===n.id);
    assert.ok(latest.objects.some(o=>o.id===cam.id),'Undo reverted Camera creation instead of Add Point');
    assert.deepEqual(await geometry(owner.hash),quad);assert.deepEqual(latest.view.frame,before.frame);
    await historyKey('Control+Shift+z');const edited=(await state()).objects.find(o=>o.id===n.id);assert.equal(edited.mesh.vertices,5);
  });
  await test('modeling and Undo keep the navigated Camera pose',async()=>{
    const n=await fixture(gap,'edge','auto',0);
    const cam=await call('scene.create',{type:'render',params:{realtime:'on'}});
    try{
      await call('scene.select',{ids:[n.hash],mode:'edge'});await call('diagnostics.frame',{frames:1});
      const a=await project(n.hash,[-40,0,0]),b=await project(n.hash,[40,0,0]);await choose(a,'Bridge');await drag(a,b);
      let edited=(await state()).objects.find(o=>o.id===n.id);assert.equal(edited.mesh.triangles,6);await call('diagnostics.frame',{frames:1});
      await call('view.set',{mode:'vertex'});await call('scene.select',{ids:[edited.hash],mode:'vertex',components:[]});
      const at=await project(edited.hash,[-82,-10,0]);await page.keyboard.down('Control');await page.mouse.click(...at);await page.keyboard.up('Control');
      edited=(await state()).objects.find(o=>o.id===n.id);assert.equal(edited.mesh.triangles,8);await call('diagnostics.frame',{frames:1});
      const added=(await geometry(edited.hash)).vertices.slice(-3);await call('scene.select',{ids:[edited.hash],mode:'vertex',components:[8]});await call('view.set',{snap:true});
      await drag(await project(edited.hash,added),await project(edited.hash,[-100,-40,0]));
      const welded=(await state()).objects.find(o=>o.id===n.id),afterWeld=await geometry(welded.hash);assert.equal(afterWeld.indices.length/3,6);await call('diagnostics.frame',{frames:1});
      await call('view.set',{mode:'polygon'});await call('scene.select',{ids:[welded.hash],mode:'polygon',components:[]});
      const A=await project(welded.hash,[-80,17,0]),B=await project(welded.hash,[-55,21,0]);await choose(A,'Line Cut');await page.mouse.click(...A);await page.mouse.click(...B);await state();await page.keyboard.press('Enter');
      const cut=(await state()).objects.find(o=>o.id===n.id),afterCut=await geometry(cut.hash);assert.ok(afterCut.indices.length>afterWeld.indices.length);await call('diagnostics.frame',{frames:1});
      const rect=await page.locator('#frame-engine-canvas').boundingBox(),p=[rect.x+rect.width*.8,rect.y+rect.height*.3],before=(await state()).view.frame;
      await drag(p,[p[0]+42,p[1]+25]);await page.mouse.wheel(0,-80);await call('diagnostics.frame',{frames:3});
      const viewed=(await state()).view;assert.notDeepEqual(viewed.frame,before);
      for(const [key,hash,g]of [['Control+z',welded.hash,afterWeld],['Control+Shift+z',cut.hash,afterCut]]){
        await historyKey(key);await state();assert.deepEqual(await geometry(hash),g);await call('diagnostics.frame',{frames:1});
        const after=(await state()).view;assert.deepEqual(after.camera,viewed.camera);assert.deepEqual(after.frame,viewed.frame);
      }
    }finally{await call('scene.update',{id:cam.hash,params:{realtime:'off'}});await call('render.stop');}
  });
  for(const output of ['Image','Video'])await test('manual '+output+' render permits Ctrl Add Point and Undo at the displayed Camera',async()=>{
    const n=await fixture(quad,'vertex','texture',0),cam=await call('scene.create',{type:'render',params:{realtime:'off','resolution x':512,'resolution y':320}});
    await call('scene.select',{ids:[cam.hash]});await page.locator('#tabAttributes').click();await holdCameraReadback(page);await page.locator('#frameRender'+output).click();
    try{
      await page.waitForFunction(kind=>{const r=frameEngine.renderState();return r.exportKind===kind&&r.running;},output.toLowerCase());
      await call('scene.select',{ids:[n.hash],mode:'vertex',components:[]});const before=(await state()).view,at=await project(n.hash,[-24,17,0]);
      await page.keyboard.down('Control');await page.mouse.click(...at);await page.keyboard.up('Control');
      const owner=(await state()).objects.find(o=>o.id===n.id);assert.equal(owner.mesh.vertices,5);
      await historyKey('Control+z');const after=await state();assert.deepEqual(await geometry(n.hash),quad);
      assert.deepEqual(after.view.frame,before.frame);assert.deepEqual(after.view.camera,before.camera);
      const film=await call('render.inspect');assert.equal(film.exportKind,output.toLowerCase());assert.ok(film.running);
    }finally{await page.evaluate(()=>{frameEngine.renderStop();releaseCameraReadback();});await page.waitForFunction(()=>!frameEngine.renderState().exportKind);}
  });
  await test('rapid Undo and Redo still restore two authored Camera moves',async()=>{
    await fixture(quad,'vertex','auto',0);const cam=await call('scene.create',{type:'render',params:{realtime:'off'}});
    const initial=cam.matrix,original=cam.matrix.slice(-3);const pose=async()=>{await page.evaluate(()=>frameEngine.draw(true));return (await state()).objects.find(o=>o.id===cam.id).matrix;};
    for(const dx of [11,29])await call('transform.apply',{ids:[cam.hash],position:original.map((v,i)=>v+(i===0?dx:0))});
    const moved=await pose();assert.notDeepEqual(moved,initial);await page.keyboard.press('Control+z');await historyKey('Control+z');assert.deepEqual(await pose(),initial);
    await page.keyboard.press('Control+Shift+z');await historyKey('Control+Shift+z');assert.deepEqual(await pose(),moved);
  });
  await test('Undo and Redo at the current animated Camera frame',async()=>{
    const n=await fixture(quad,'vertex','auto',0),cam=await call('scene.create',{type:'render',params:{realtime:'off'}});
    const pos=cam.matrix.slice(-3);
    for(const [frame,delta] of [[0,0],[25,35]])await call('animation.key',{id:cam.hash,path:'position',frame,value:pos.map((v,i)=>v+(i===0?delta:0))});
    await call('animation.seek',{frame:0});const edit=await call('mesh.edit',{id:n.hash,op:'addPoint',face:0});
    await call('animation.seek',{frame:25});await page.evaluate(()=>frameEngine.draw(true));const before=(await state()).view;
    for(const [key,hash,triangles] of [['Control+z',n.hash,2],['Control+Shift+z',edit.id,4]]){
      await historyKey(key);const current=await state();assert.equal((await geometry(hash)).indices.length/3,triangles);
      assert.equal(await page.evaluate(()=>timelineFrame),25);assert.deepEqual(current.view.frame,before.frame);assert.deepEqual(current.view.camera,before.camera);
    }
  });
  assert.deepEqual(await page.evaluate(()=>gestureGPUErrors),[]);assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
}finally{await app.close();}
