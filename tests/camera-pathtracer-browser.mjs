import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function cameraPathTracerChecks(page){
  const errors=[],checks=[],timings=[];
  const call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
  const onPageErr=e=>errors.push(e.message),onConsole=m=>{if(m.type()==='error')errors.push(m.text());};
  page.on('pageerror',onPageErr);page.on('console',onConsole);
  try{
    const adapter=await page.evaluate(()=>{
      const d=frameEngine.renderer.device;
      window.__ptUncaptured=[];
      d.addEventListener('uncapturederror',e=>window.__ptUncaptured.push(e.error.message));
      d.pushErrorScope('validation');
      const a=d.adapterInfo;
      return {vendor:a.vendor,description:a.description,architecture:a.architecture,fallback:a.isFallbackAdapter};
    });
    assert.equal(adapter.fallback,false);

    // 1. Auto-start when clicking #btnRender (add Camera)
    await call('scene.new');
    const floor=await call('scene.create',{type:'cube',name:'Floor',params:{'size x':600,'size y':10,'size z':600}});
    await call('scene.select',{ids:[floor.hash]});
    await call('transform.set',{channel:'position',axis:1,value:-55});
    const sphere=await call('scene.create',{type:'sphere',name:'Hero',params:{diameter:80}});
    await call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms',focus:sphere.hash});
    await call('scene.select',{ids:[]});

    const tAdd=performance.now();
    await page.locator('#btnRender').click();
    await page.waitForFunction(()=>frameEngine.renderState().hasImage&&frameEngine.renderState().visible,{},{timeout:15000});
    const addMs=performance.now()-tAdd;
    timings.push({name:'Auto-start Path tracer on Camera add',ms:addMs});
    const firstState=await call('render.inspect');
    check('Camera add auto-starts Path tracer on shared WebGPU device',
      firstState.renderer==='Path tracer'&&firstState.visible&&firstState.hasImage&&firstState.sharedDevice&&!firstState.errors.length,
      firstState);
    const camNode=(await call('scene.inspect')).objects.find(n=>n.type==='render'&&n.enabled);
    check('New Camera defaults to realtime on and realtime during navigation true',
      camNode.params.renderer==='Path tracer'&&camNode.params.realtime==='on'&&camNode.params['realtime during navigation']===true,
      camNode.params);

    // Verify progressive convergence while idle
    await page.waitForFunction(()=>frameEngine.renderState().samples>=4,{},{timeout:15000});
    const refined=await call('render.inspect');
    check('Path tracer progressively accumulates samples when idle',refined.samples>=4&&!refined.interactive,refined);

    // 2. realtime during navigation = true covers BOTH camera navigation AND object transforms
    const rect=await page.locator('#frame-engine-canvas').boundingBox();
    const ox=rect.x+rect.width*.75,oy=rect.y+rect.height*.35;
    await page.mouse.move(ox,oy);
    await page.mouse.down({button:'right'});
    await page.mouse.move(ox+45,oy-18,{steps:5});
    const duringOrbitOn=await call('render.inspect');
    await page.mouse.up({button:'right'});
    check('Camera navigation stays live in Path tracer when realtime during navigation is true',
      duringOrbitOn.visible&&duringOrbitOn.interactive,duringOrbitOn);
    await page.waitForFunction(()=>!frameEngine.renderState().interactive&&frameEngine.renderState().samples>=4,{},{timeout:15000});

    // Object gizmo transform with realtime during navigation = true
    await call('scene.select',{ids:[sphere.hash]});
    await call('diagnostics.frame',{frames:2});
    const beforeX=(await call('scene.inspect')).objects.find(n=>n.hash===sphere.hash).worldMatrix[12];
    const gBox=await page.locator('#frame-gizmo [data-part="move0"]').boundingBox();
    assert.ok(gBox,'Transform gizmo visible over active Path tracer');
    const gx=gBox.x+gBox.width*.6,gy=gBox.y+gBox.height*.5;
    await page.mouse.move(gx,gy);
    await page.mouse.down();
    await page.mouse.move(gx+50,gy+6,{steps:6});
    const duringDragOn=await call('render.inspect');
    await page.mouse.up();
    await page.waitForFunction(()=>!frameEngine.transforming&&!frameEngine.renderState().interactive&&frameEngine.renderState().samples>=4,{},{timeout:15000});
    const afterX=(await call('scene.inspect')).objects.find(n=>n.hash===sphere.hash).worldMatrix[12];
    check('Object transform stays live in Path tracer with fast TLAS refit when realtime during navigation is true',
      duringDragOn.visible&&duringDragOn.interactive&&duringDragOn.bvhMs<25&&Math.abs(afterX-beforeX)>5,
      {duringDragOn,beforeX,afterX});

    // 3. realtime during navigation = false yields during BOTH camera navigation AND object transforms, then resumes!
    await call('scene.update',{id:camNode.hash,params:{'realtime during navigation':false}});
    await page.mouse.move(ox,oy);
    await page.mouse.down({button:'right'});
    await page.mouse.move(ox-40,oy+15,{steps:5});
    const duringOrbitOff=await call('render.inspect');
    await page.mouse.up({button:'right'});
    check('Camera navigation yields to modeling viewport when realtime during navigation is false',
      !duringOrbitOff.visible,duringOrbitOff);
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=3,{},{timeout:15000});

    const gBox2=await page.locator('#frame-gizmo [data-part="move0"]').boundingBox();
    assert.ok(gBox2,'Gizmo remains available for transform test with realtime during navigation false');
    const gx2=gBox2.x+gBox2.width*.6,gy2=gBox2.y+gBox2.height*.5;
    await page.mouse.move(gx2,gy2);
    await page.mouse.down();
    await page.mouse.move(gx2-45,gy2,{steps:6});
    const duringDragOff=await call('render.inspect');
    await page.mouse.up();
    check('Object transform yields to modeling viewport when realtime during navigation is false',
      !duringDragOff.visible,duringDragOff);
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=3,{},{timeout:15000});
    const resumedAfterDrag=await call('render.inspect');
    check('Path tracer resumes automatically after object transform ends',resumedAfterDrag.visible&&resumedAfterDrag.samples>=3,resumedAfterDrag);

    // 3b. Quad-view isolation: navigating in ortho views (Top/Front/Right) must NOT restart or hide Perspective Path tracer!
    await call('scene.select',{ids:[]});
    await call('view.set',{single:false,index:0});
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=4,{},{timeout:15000});
    for(const rtDuringNav of [true,false]){
      await call('scene.update',{id:camNode.hash,params:{'realtime during navigation':rtDuringNav}});
      await call('view.set',{index:1});
      const beforeOrtho=await call('render.inspect');
      const topCanvas=await page.locator('.view[data-view="1"]').boundingBox();
      assert.ok(topCanvas,'Quad Top view visible');
      const tx=topCanvas.x+topCanvas.width*.5,ty=topCanvas.y+topCanvas.height*.5;
      await page.mouse.move(tx,ty);
      await page.mouse.down({button:'middle'});
      await page.mouse.move(tx+110,ty-45,{steps:6});
      const duringOrthoPan=await call('render.inspect');
      await page.mouse.up({button:'middle'});
      await page.mouse.wheel(0,-180);
      await page.waitForTimeout(80);
      const afterOrthoWheel=await call('render.inspect');
      check('Quad ortho navigation (rtDuringNav='+rtDuringNav+') never hides or restarts Perspective Path tracer',
        duringOrthoPan.visible&&!duringOrthoPan.interactive&&duringOrthoPan.samples>=beforeOrtho.samples&&
        afterOrthoWheel.visible&&!afterOrthoWheel.interactive&&afterOrthoWheel.samples>=beforeOrtho.samples,
        {rtDuringNav,beforeOrtho,duringOrthoPan,afterOrthoWheel});
    }
    await call('view.set',{single:true,index:0});
    await call('scene.update',{id:camNode.hash,params:{'realtime during navigation':true}});

    // 3c. Exiting sub-resolution interactive drag to static full-res must NEVER leave a quarter-screen top-left ghost!
    await call('scene.new');
    const centerBall=await call('scene.create',{type:'sphere',name:'GhostCheck',params:{diameter:120}});
    const neonMat=await call('material.create',{name:'NeonGreen',params:{h:120,s:100,l:50,emm:100,rough:100}});
    await call('material.assign',{id:centerBall.hash,material:neonMat.uid});
    await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:centerBall.hash});
    await call('scene.create',{type:'render',params:{realtime:'on',quality:30,environment:'off','realtime during navigation':true}});
    await call('scene.select',{ids:[]});
    await page.waitForFunction(()=>frameEngine.renderState().hasImage&&frameEngine.renderState().visible,{},{timeout:15000});
    // Start windowed, drag interactively, release to static accumulation, then read live Path tracer pixels via view export!
    const gRect=await page.locator('#frame-engine-canvas').boundingBox();
    const gox=gRect.x+gRect.width*.82,goy=gRect.y+gRect.height*.82;
    await page.mouse.move(gox,goy);
    await page.mouse.down({button:'left'});
    await page.mouse.move(gox+25,goy-12,{steps:4});
    await page.mouse.up({button:'left'});
    await page.waitForFunction(()=>!frameEngine.renderState().interactive&&frameEngine.renderState().samples>=2,{},{timeout:15000});
    const pngBuf=await page.locator('#frame-engine-canvas').screenshot();
    const cornerPx=await page.evaluate(async b64=>{
      const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
      const c=new OffscreenCanvas(img.width,img.height),ctx=c.getContext('2d');ctx.drawImage(img,0,0);
      const at=(u,v)=>[...ctx.getImageData(Math.floor(u*img.width),Math.floor(v*img.height),1,1).data];
      return {colors:[at(0.25,0.25),at(0.5,0.5)]};
    },pngBuf.toString('base64'));
    check('No quarter-screen ghost in top-left quadrant after exiting interactive navigation',
      cornerPx.colors[0][1]<35&&cornerPx.colors[1][1]>140,cornerPx);

    // 4. Optics & lighting: emissive bounce in environment off, Infinite Light, dielectric glass, deterministic export
    await call('scene.new');
    const wall=await call('scene.create',{type:'cube',name:'Wall',params:{'size x':220,'size y':220,'size z':10}});
    const wallMat=await call('material.create',{name:'Matte white',params:{h:0,s:0,l:85,rough:90,metal:0}});
    await call('material.assign',{id:wall.hash,material:wallMat.uid});
    await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:wall.hash});
    const cam=await call('scene.create',{type:'render',params:{realtime:'off',quality:12,environment:'off','resolution x':128,'resolution y':96}});
    await call('scene.select',{ids:[]});

    await call('render.export',{kind:'image',download:false});
    const darkLin=(await call('render.pixels',{points:[[.5,.5]],linear:true})).colors[0];
    check('Environment off without lights renders dark wall',darkLin[0]<0.03&&darkLin[1]<0.03&&darkLin[2]<0.03,darkLin);

    // Add Infinite Light illuminating the wall -> brightness increases strongly
    const sun=await call('scene.create',{type:'infinite'});
    await call('scene.select',{ids:[sun.hash]});
    await call('transform.set',{channel:'rotation',axis:1,value:-35});
    await call('scene.select',{ids:[]});
    await call('render.export',{kind:'image',download:false});
    const litLin=(await call('render.pixels',{points:[[.5,.5]],linear:true})).colors[0];
    const litRgba1=(await call('render.pixels',{points:[[.5,.5],[.25,.5],[.75,.5]]})).colors;
    await call('render.export',{kind:'image',download:false});
    const litRgba2=(await call('render.pixels',{points:[[.5,.5],[.25,.5],[.75,.5]]})).colors;
    check('Infinite Light illuminates scene in linear HDR path tracer',litLin[0]>0.12&&litLin[1]>0.12&&litLin[2]>0.12,litLin);
    check('Offline Path tracer exports are bit-deterministic',JSON.stringify(litRgba1)===JSON.stringify(litRgba2),{litRgba1,litRgba2});

    // Dielectric glass block in front of emissive red backing transmits light (IOR refraction!)
    await call('scene.delete',{ids:[sun.hash]});
    const redEm=await call('material.create',{name:'Red emitter',params:{h:0,s:100,l:50,emm:200,rough:100}});
    await call('material.assign',{id:wall.hash,material:redEm.uid});
    const glassCube=await call('scene.create',{type:'cube',name:'Glass',params:{'size x':90,'size y':90,'size z':30}});
    await call('scene.select',{ids:[glassCube.hash]});
    const camPos=(await call('scene.inspect')).view.frame.position;
    await call('transform.set',{channel:'position',axis:0,value:camPos[0]*.35});
    await call('transform.set',{channel:'position',axis:1,value:camPos[1]*.35});
    await call('transform.set',{channel:'position',axis:2,value:camPos[2]*.35});
    const glassMat=await call('material.create',{name:'Clear glass',params:{h:0,s:0,l:98,rough:2,metal:0,opac:95,ior:1.5}});
    await call('material.assign',{id:glassCube.hash,material:glassMat.uid});
    await call('scene.select',{ids:[]});
    await call('render.export',{kind:'image',download:false});
    const glassLin=(await call('render.pixels',{points:[[.5,.5]],linear:true})).colors[0];
    check('Dielectric glass refracts and transmits red emissive backing',glassLin[0]>0.35&&glassLin[0]>glassLin[1]*3,glassLin);

    // 5. HASH persistence restores active Path tracer Camera & auto-starts it
    await call('scene.update',{id:cam.hash,params:{realtime:'on',environment:'default'}});
    const saved=await call('scene.export',{includeData:true});
    await call('scene.open',{name:'pt-roundtrip.hash',base64:saved.base64});
    await page.waitForFunction(()=>frameEngine.renderState().hasImage&&frameEngine.renderState().visible,{},{timeout:15000});
    const reopened=await call('render.inspect');
    check('HASH reload restores active Path tracer Camera and auto-starts rendering',
      reopened.renderer==='Path tracer'&&reopened.visible&&reopened.hasImage,reopened);

    await call('scene.new');
    const gpu=await page.evaluate(async()=>{
      await frameEngine.renderer.device.queue.onSubmittedWorkDone();
      return {validation:(await frameEngine.renderer.device.popErrorScope())?.message||null,uncaptured:window.__ptUncaptured||[]};
    });
    check('Zero WebGPU validation or uncaptured errors',!gpu.validation&&!gpu.uncaptured.length,gpu);
    check('Zero JavaScript errors',!errors.length,errors);
    return {pass:true,adapter,checks:checks.length,timings,gpu};
  }finally{
    page.off('pageerror',onPageErr);page.off('console',onConsole);
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const session=await launch({headless:true});
  try{
    await ready(session.page);
    console.log(JSON.stringify(await cameraPathTracerChecks(session.page),null,2));
  }finally{await session.close();}
}
