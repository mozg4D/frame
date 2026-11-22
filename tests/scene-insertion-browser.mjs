import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function sceneInsertionChecks(page){
  const checks=[],timings=[];
  const call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  const check=(name,value,detail)=>{assert.ok(value,name+(detail?' '+JSON.stringify(detail):''));checks.push({name,pass:true});};
  const add=async type=>{await page.locator('#tabObjects').click();await page.locator('#objectsPanel [data-type="'+type+'"]').click();};
  const project=async(hash,point)=>(await call('view.project',{id:hash,point})).screen;
  const marker=page.locator('#frame-spline-insert');
  await call('scene.new');await call('view.set',{index:0,single:true,mode:'object',shading:'solid'});
  // Observe the material bind group on the recorded native draw, including bundle draws.
  await page.evaluate(()=>{
    window.insertFrames=[];window.restoreInsertProbes=[];const recordings=new WeakMap(),bundles=new WeakMap();
    const record=(m,pipeline)=>insertFrames.push({hash:m.hashId,posed:m.posed,materials:m.materialTags.length,pipeline,cards:document.querySelectorAll('#matList .mat-card').length});
    for(const proto of [GPURenderPassEncoder.prototype,GPURenderBundleEncoder.prototype]){
      const set=proto.setBindGroup,pipe=proto.setPipeline,pipelines=new WeakMap();
      proto.setPipeline=function(p){pipelines.set(this,p);return pipe.call(this,p);};
      proto.setBindGroup=function(i,group,...args){
        if(i===1){const m=frameEngine.scene?.meshes.find(m=>m.materialBindings?.groups.get(m)?.group===group||m.shadingBindGroup===group);
          const p=pipelines.get(this),r=frameEngine.renderer;
          if(m&&p&&(p.label.startsWith('native material')||[r.pipeline,r.ortho?.pipeline,r.posed?.pipeline,r.posedOrtho?.pipeline].includes(p))){
            if(proto===GPURenderPassEncoder.prototype)record(m,p.label);
            else{if(!recordings.has(this))recordings.set(this,[]);recordings.get(this).push([m,p.label]);}}
        }
        return set.call(this,i,group,...args);
      };
      restoreInsertProbes.push(()=>{proto.setBindGroup=set;proto.setPipeline=pipe;});
    }
    const bundle=GPURenderBundleEncoder.prototype,pass=GPURenderPassEncoder.prototype,finish=bundle.finish,execute=pass.executeBundles;
    bundle.finish=function(...args){const result=finish.apply(this,args);bundles.set(result,recordings.get(this)||[]);return result;};
    pass.executeBundles=function(items){for(const b of items)for(const [m,pipeline] of bundles.get(b)||[])record(m,pipeline);return execute.call(this,items);};
    restoreInsertProbes.push(()=>{bundle.finish=finish;pass.executeBundles=execute;});
  });
  try{
    const start=performance.now();await add('car');await page.locator('#tabMaterials').click();
    await page.waitForFunction(()=>document.querySelectorAll('#matList .mat-card').length===10&&frameEngine.gizmoState?.handles.length);
    const car=await page.evaluate(()=>current().nativeHash);
    const first=await page.evaluate(hash=>insertFrames.find(f=>f.hash===hash),car);
    check('First stock car material draw precedes all ten shelf cards',first?.materials===10&&first.pipeline.startsWith('native material')&&first.cards===0,first||{frames:await page.evaluate(()=>insertFrames.slice(0,3))});
    await call('view.set',{focus:car});const handle=await page.evaluate(()=>frameEngine.gizmoState.handles.find(h=>h.part==='move0').suggested);
    await page.mouse.move(...handle);await page.mouse.down();await page.mouse.move(handle[0]+36,handle[1],{steps:4});await page.mouse.up();
    const moved=(await call('scene.inspect')).objects.find(n=>n.hash===car);
    await page.waitForFunction(hash=>insertFrames.some(f=>f.hash===hash&&f.posed),car,{timeout:3000});
    const draws=await page.evaluate(hash=>insertFrames.filter(f=>f.hash===hash&&f.posed),car);
    check('First gizmo move changes the car frame with its original material pipeline',Math.abs(moved.worldMatrix[12])>0.001&&draws.length&&draws.every(f=>f.pipeline===first.pipeline),{matrix:moved.worldMatrix,handle,first,draws:draws.slice(-5),recent:await page.evaluate(()=>insertFrames.slice(-3))});
    const ms=performance.now()-start;timings.push({name:'Cold car insertion, shelf and first pointer move',ms,budgetMs:5000});check('Cold insertion and first move latency',ms<5000);
  }finally{await page.evaluate(()=>restoreInsertProbes.forEach(restore=>restore()));}

  await call('scene.new');const camera=await call('scene.create',{type:'render',params:{realtime:'off',samples:2}});
  await page.evaluate(()=>{
    const fetchModel=window.fetch,gate=new Promise(r=>window.releaseStock=r);window.restoreFetch=()=>{window.fetch=fetchModel;};
    window.fetch=async function(input,...args){if(String(input).includes('models/human-')){window.stockRequested=true;await gate;}return fetchModel.call(this,input,...args);};
  });
  try{
    await add('human');await page.waitForFunction(()=>window.stockRequested,null,{timeout:5000});
    await page.evaluate(()=>{window.insertView=frameEngine.renderStart();releaseStock();});
    const film=await page.evaluate(()=>insertView);
    check('Camera View started during stock loading includes the completed Human',film.phase==='complete'&&film.snapshot.meshes===1&&film.triangles>0);
  }finally{await page.evaluate(()=>{releaseStock();restoreFetch();});}
  await call('scene.update',{id:camera.hash,params:{samples:12}});
  await page.evaluate(()=>{window.insertView=frameEngine.renderStart();});
  await page.waitForFunction(()=>frameEngine.renderState().running);
  await add('tree');const changed=await page.evaluate(()=>insertView);
  check('An in-flight Camera View finishes with the added Tree',changed.phase==='complete'&&changed.snapshot.meshes===2&&changed.triangles>0,changed);
  await call('scene.update',{id:camera.hash,params:{realtime:'on'}});
  await add('cube');
  await page.waitForFunction(()=>{const r=frameEngine.renderState();return r.phase==='complete'&&r.snapshot?.meshes===3;},null,{timeout:60000});
  check('Realtime Camera picks up a newly evaluated primitive',await page.evaluate(()=>frameEngine.renderState().triangles===frameEngine.scene.triangleCount));

  await call('scene.new');const mesh=await call('mesh.create',{vertices:[-60,-40,0,60,-40,0,60,40,0,-60,40,0],indices:[0,1,2,0,2,3]});
  await call('view.set',{index:2,single:true,mode:'vertex',shading:'solid-wire',focus:mesh.hash});
  await call('scene.select',{ids:[mesh.hash],mode:'vertex',components:[]});
  for(const [name,point,bias] of [['face',[25,0,0],0],['edge',[-17,-40,0],0.7],['near-outside edge',[-17,-40,0],5],['near-inside edge',[-17,-40,0],-5]]){
    const xy=await project(mesh.hash,point);await page.mouse.move(xy[0],xy[1]+bias);await page.keyboard.down('Control');
    await marker.waitFor({state:'visible',timeout:3000});const box=await marker.boundingBox(),at=[box.x+box.width/2,box.y+box.height/2];
    check('Ctrl hover marks the actual polygon '+name,Math.hypot(at[0]-xy[0],at[1]-xy[1])<1.2);
    await page.mouse.click(xy[0],xy[1]+bias);await page.keyboard.up('Control');await marker.waitFor({state:'hidden'});
    const v=(await call('scene.inspect')).objects.find(n=>n.id===mesh.id);check('Click inserts exactly one vertex on the '+name,v.mesh.vertices===5);
    const pivot=await page.evaluate(()=>frameEngine.gizmoState?.pivot);const actual=await project(v.hash,pivot);
    check('New '+name+' vertex projects onto the preview',Math.hypot(actual[0]-at[0],actual[1]-at[1])<1.2);
    await call('edit.history',{action:'undo'});
  }
  await call('view.set',{shading:'wireframe'});
  const wfFace=await project(mesh.hash,[25,0,0]),wfEdge=await project(mesh.hash,[-17,-40,0]);
  await page.mouse.move(wfEdge[0],wfEdge[1]+5);await page.keyboard.down('Control');await marker.waitFor({state:'visible',timeout:3000});
  const wfBox=await marker.boundingBox();
  check('Wireframe Ctrl hover snaps onto the edge',Math.hypot(wfBox.x+wfBox.width/2-wfEdge[0],wfBox.y+wfBox.height/2-wfEdge[1])<1.2);
  await page.mouse.move(...wfFace);await marker.waitFor({state:'hidden',timeout:3000});
  check('Wireframe Ctrl hover hides marker inside empty face interior',true);
  await page.keyboard.up('Control');await call('view.set',{shading:'solid-wire'});
  await call('view.set',{single:false,index:2,focus:mesh.hash});const passive=await project(mesh.hash,[25,0,0]);
  await call('view.set',{index:0});await page.mouse.move(...passive);await page.keyboard.down('Control');await marker.waitFor({state:'visible'});
  const box=await marker.boundingBox();
  check('Ctrl previews the point in the passive viewport without activating it',Math.hypot(box.x+box.width/2-passive[0],box.y+box.height/2-passive[1])<1.2&&await page.evaluate(()=>frameEngine.pluginView().index===0));
  await page.keyboard.up('Control');await marker.waitFor({state:'hidden'});
  await add('cube');const added=await call('scene.inspect'),primitive=added.objects.find(n=>n.type==='cube');
  const selection=await page.evaluate(()=>({hash:current()?.nativeHash,mode:document.getElementById('frame-engine-canvas').dataset.elementMode,handles:frameEngine.gizmoState?.handles.length}));
  check('Adding a primitive from Vertex mode gives it the Object gizmo',added.selection.nativeObjects.length===1&&added.selection.nativeObjects[0]===primitive.hash&&selection.hash===primitive.hash&&selection.mode==='object'&&selection.handles>0,selection);
  await call('scene.new');const source=await call('scene.create',{type:'spline'});
  const data=await page.evaluate(()=>{
    const K=FrameSpline.K(),d=K.createSplineData(),ring=K.addSplineSequence(d,true),tail=K.addSplineSequence(d);
    const v=[[-40,-30,0],[10,-30,0],[10,30,0],[-40,30,0],[65,45,0]].map(p=>K.addSplineVertex(d,p));
    for(let i=0;i<4;i++)K.addSplineSegment(d,ring,v[i],v[(i+1)%4]);K.addSplineSegment(d,tail,v[2],v[4]);return d;
  });
  await call('spline.replace',{id:source.hash,data});
  const patch=await call('scene.create',{type:'spline_patch',inputs:[source.hash]});await call('view.set',{index:2,single:true,mode:'object',focus:source.hash});await call('scene.select',{ids:[]});
  const [x,y]=await project(source.hash,[37.5,37.5,0]);
  const pixel=await page.evaluate(()=>document.getElementById('frame-engine-canvas').clientWidth/frameEngine.renderer.width);
  const points=[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>[x+dx*pixel,y+dy*pixel]));
  for(const shading of ['solid','solid-wire','solid-isoparms','wireframe','isoparms']){
    await call('view.set',{shading});const {colors}=await call('diagnostics.pixels',{points,presentation:true});
    check('Loose patch span remains visible in '+shading,colors.some(c=>c[1]>c[0]+20&&c[2]>c[0]+30),colors);
    await page.mouse.click(x,y);const chosen=(await call('scene.inspect')).objects.filter(n=>n.selected);
    check('Click on loose span selects its patch in '+shading,chosen.length===1&&chosen[0].hash===patch.hash);await call('scene.select',{ids:[]});
  }
  const copy=await call('scene.create',{type:'instance',params:{object:patch.hash}});
  await call('transform.set',{ids:[copy.hash],channel:'position',axis:0,value:140,coordinates:'world'});
  await call('view.set',{shading:'solid',focus:copy.hash});await call('scene.select',{ids:[]});
  const copyPoint=await page.evaluate(([source,copy])=>{
    const m=frameEngine.splineOccurrenceFrame(source,copy,[frameNodeByHash(copy)]);
    return [0,1,2].map(k=>m[k]*37.5+m[k+4]*37.5+m[k+12]);
  },[source.hash,copy.hash]);
  const [cx,cy]=await project(copy.hash,copyPoint),copyPixels=await call('diagnostics.pixels',{points:points.map(([px,py])=>[cx+px-x,cy+py-y]),presentation:true});
  check('An instanced loose span is visible at its transformed position',copyPixels.colors.some(c=>c[1]>c[0]+20&&c[2]>c[0]+30),{copyPoint,cx,cy,colors:copyPixels.colors});
  await page.mouse.click(cx,cy);const picked=(await call('scene.inspect')).selection.nativeObjects;
  check('Picking an instanced loose span selects that occurrence',picked.length===1&&picked[0]===copy.hash,picked);
  return {pass:true,checks,timings};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=await launch({headless:process.argv.includes('--headless')});
  try{await ready(app.page);console.log(JSON.stringify(await sceneInsertionChecks(app.page),null,2));}finally{await app.close();}
}
