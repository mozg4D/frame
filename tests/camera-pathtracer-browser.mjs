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
    await call('scene.create',{type:'render',params:{realtime:'on',samples:24,environment:'off','realtime during navigation':true}});
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
    const cam=await call('scene.create',{type:'render',params:{realtime:'off',samples:8,environment:'off','resolution x':128,'resolution y':96}});
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
    await call('scene.update',{id:cam.hash,params:{realtime:'on',environment:'default',samples:500}});
    const saved=await call('scene.export',{includeData:true});
    await call('scene.open',{name:'pt-roundtrip.hash',base64:saved.base64});
    await page.waitForFunction(()=>frameEngine.renderState().hasImage&&frameEngine.renderState().visible,{},{timeout:15000});
    const reopened=await call('render.inspect');
    check('HASH reload restores active Path tracer Camera with unlimited samples and auto-starts rendering',
      reopened.renderer==='Path tracer'&&reopened.visible&&reopened.hasImage&&reopened.targetSamples===500,reopened);

    // 6. Unlimited samples + Attribute Editor progress replaces "render" during active render and restores "render" when complete
    await call('scene.select',{ids:[cam.hash]});
    await page.locator('#tabAttributes').click();
    await call('scene.update',{id:cam.hash,params:{samples:2000}});
    await page.waitForFunction(()=>{
      const t=document.getElementById('frameRenderLabel')?.textContent||'';
      return /^\d+%$/.test(t);
    },{},{timeout:15000});
    const progressLabel=await page.locator('#frameRenderLabel').textContent();
    const highState=await call('render.inspect');
    check('Unlimited samples (>256) accepted and Attribute Editor replaces render label with percentage progress',
      highState.targetSamples===2000&&highState.running&&/^\d+%$/.test(progressLabel),{progressLabel,highState});
    // Lower samples to current or small count -> completes and restores label to "render"
    await call('scene.update',{id:cam.hash,params:{samples:4}});
    await page.waitForFunction(()=>!frameEngine.renderState().running&&document.getElementById('frameRenderLabel')?.textContent==='render',{},{timeout:15000});
    check('Attribute Editor restores render label once rendering completes',
      (await page.locator('#frameRenderLabel').textContent())==='render',await call('render.inspect'));
    // Increase samples mid-session -> seamlessly continues accumulating without resetting to 0
    const beforeBoost=(await call('render.inspect')).samples;
    await call('scene.update',{id:cam.hash,params:{samples:400}});
    await page.waitForFunction(prev=>frameEngine.renderState().samples>prev&&/^\d+%$/.test(document.getElementById('frameRenderLabel')?.textContent||''),beforeBoost,{timeout:15000});
    check('Increasing samples resumes progressive accumulation and progress display',
      (await call('render.inspect')).samples>beforeBoost&&/^\d+%$/.test(await page.locator('#frameRenderLabel').textContent()),
      {beforeBoost,after:await call('render.inspect'),label:await page.locator('#frameRenderLabel').textContent()});

    // 7. Detached view render inheritance & isolation
    // 7a. Detaching view 0 WHILE render IS running -> detached view ALSO runs Path tracer!
    await call('scene.update',{id:cam.hash,params:{samples:16}});
    await page.waitForFunction(()=>frameEngine.renderState().hasImage&&frameEngine.renderState().visible,{},{timeout:15000});
    const beforeDetachBytes=(await call('view.windows')).resources.trackedGPUBytes;
    const pop1=page.waitForEvent('popup');
    await page.locator('[data-open-view="0"]').click();
    const detachedRenderPage=await pop1;
    await detachedRenderPage.waitForSelector('.view');
    const detachedRenderIdx=await detachedRenderPage.locator('.view').getAttribute('data-view').then(Number);
    await page.waitForFunction(idx=>{
      const v=frameEngine.renderState().views?.find(x=>x.index===idx);
      return !!v&&v.hasImage&&v.samples>=2;
    },detachedRenderIdx,{timeout:15000});
    const renderWinInfo=(await call('view.windows')).views.find(v=>v.index===detachedRenderIdx);
    const detachedPx=await call('render.pixels',{points:[[.5,.5]],view:detachedRenderIdx,linear:true});
    check('Detaching view 0 while rendering also runs Path tracer on the detached view',
      !!renderWinInfo?.rendering&&detachedPx.colors[0].every(Number.isFinite)&&detachedPx.samples>=2,
      {renderWinInfo,detachedPx});
    await detachedRenderPage.close();
    await page.waitForFunction(i=>!FrameViewWindows.detached(i),detachedRenderIdx);
    await page.evaluate(async()=>{await frameEngine.draw(true);await frameEngine.renderer.device.queue.onSubmittedWorkDone();});
    const afterCloseBytes=(await call('view.windows')).resources.trackedGPUBytes;
    check('Closing detached rendering view releases its per-view Path tracer GPU targets',
      afterCloseBytes<=beforeDetachBytes+2*1024*1024,{beforeDetachBytes,afterCloseBytes});

    // 7b. Detaching view 0 when render is NOT running -> detached view does NOT run render, AND starting render does NOT start it there!
    await call('scene.new');
    await call('scene.create',{type:'cube',name:'PlainBox'});
    await call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms'});
    const pop2=page.waitForEvent('popup');
    await page.locator('[data-open-view="0"]').click();
    const detachedPlainPage=await pop2;
    await detachedPlainPage.waitForSelector('.view');
    const detachedPlainIdx=await detachedPlainPage.locator('.view').getAttribute('data-view').then(Number);
    const plainBeforeWin=(await call('view.windows')).views.find(v=>v.index===detachedPlainIdx);
    check('Detaching view 0 when render is off does not run render on detached view',
      !plainBeforeWin?.rendering&&(await call('render.inspect')).views.every(v=>v.index!==detachedPlainIdx),
      {plainBeforeWin,renderState:await call('render.inspect')});
    // Now start render in main view by adding a Path tracer Camera!
    await page.bringToFront();
    await page.locator('#btnRender').click();
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().hasImage,{},{timeout:15000});
    const afterStartState=await call('render.inspect');
    const afterStartWindows=await call('view.windows');
    const mainWinAfter=afterStartWindows.views.find(v=>v.index===0);
    const plainAfterWin=afterStartWindows.views.find(v=>v.index===detachedPlainIdx);
    check('Starting render starts on main view 0 only and NEVER starts on previously detached non-rendering view',
      !!mainWinAfter?.rendering&&!plainAfterWin?.rendering&&
      afterStartState.views.some(v=>v.index===0)&&!afterStartState.views.some(v=>v.index===detachedPlainIdx),
      {mainWinAfter,plainAfterWin,views:afterStartState.views});
    // Also verify calling render.start explicitly still keeps detached plain view non-rendering!
    await call('render.start');
    const afterExplicitStart=await call('view.windows');
    check('Explicit render.start still does not start render on previously detached non-rendering view',
      !afterExplicitStart.views.find(v=>v.index===detachedPlainIdx)?.rendering,
      afterExplicitStart.views);
    await detachedPlainPage.close();
    await page.waitForFunction(i=>!FrameViewWindows.detached(i),detachedPlainIdx);

    // 8. Render shading mode (#btnSolid: solid -> render -> off) works WITHOUT a Camera, in Perspective & Ortho, with full modeling overlays!
    await call('scene.new');
    const polyBox=await call('mesh.create',{name:'RenderBox',vertices:[-50,-50,-50,50,-50,-50,50,50,-50,-50,50,-50,-50,-50,50,50,-50,50,50,50,50,-50,50,50],indices:[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,2,3,7,2,7,6,0,4,7,0,7,3,1,2,6,1,6,5]});
    const curveRing=await call('scene.create',{type:'circle',name:'RenderRing',params:{diameter:180}});
    const sunHelper=await call('scene.create',{type:'infinite',name:'RenderLight'});
    await call('view.set',{index:0,single:true,mode:'object',shading:'solid-wire',focus:polyBox.hash});
    await call('scene.select',{ids:[]});
    // Cycle #btnSolid: solid-wire -> render-wire -> wireframe -> solid-wire
    await page.locator('#btnSolid').click();
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().hasImage&&frameEngine.renderState().samples>=2,{},{timeout:15000});
    const renderModeState=await call('scene.inspect');
    const renderBtnTitle=await page.locator('#btnSolid').getAttribute('title');
    const lightHelperVisibleInRender=await page.locator(`.frame-light-helpers[data-view="0"] .frame-infinite-direction[data-hash="${sunHelper.hash}"]`).isVisible();
    check('Clicking #btnSolid enters Render shading without a Camera, preserves Wire, and keeps helpers visible',
      renderModeState.view.shading==='render-wire'&&renderBtnTitle==='Render'&&lightHelperVisibleInRender,
      {shading:renderModeState.view.shading,renderBtnTitle,lightHelperVisibleInRender});

    // Verify wireframe + spline overlays are actually composited over Path tracer output
    const boxEdgePt=(await call('view.project',{id:polyBox.hash,point:[0,50,50]})).screen;
    const ringVert=Object.values((await call('spline.inspect',{id:curveRing.hash})).data.vertices)[0];
    const splinePt=(await call('view.project',{id:curveRing.hash,point:ringVert})).screen;
    const edgeRing=[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>[boxEdgePt[0]+dx,boxEdgePt[1]+dy]));
    const splineRing=[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>[splinePt[0]+dx,splinePt[1]+dy]));
    const wirePx=(await call('diagnostics.pixels',{points:[...edgeRing,...splineRing]})).colors;
    await call('view.set',{shading:'render'});
    await page.waitForFunction(()=>frameEngine.renderState().samples>=2,{},{timeout:15000});
    const plainRenderPx=(await call('diagnostics.pixels',{points:[...edgeRing,...splineRing]})).colors;
    const edgeDiff=wirePx.slice(0,9).some((c,i)=>c.slice(0,3).some((v,k)=>Math.abs(v-plainRenderPx[i][k])>4));
    const splineCyan=plainRenderPx.slice(9).some(c=>c[2]>c[0]+15);
    check('Render+Wire composites wireframe over Path tracer and retains spline curves',
      edgeDiff&&splineCyan,{edgeDiff,splineCyan,wireEdge:wirePx.slice(0,9),plainEdge:plainRenderPx.slice(0,9),spline:plainRenderPx.slice(9)});

    // Verify Vertex & Polygon component modes (vertices, selected polygon, hover) work in Render mode!
    await call('view.set',{shading:'render-wire'});
    await call('scene.select',{ids:[polyBox.hash],mode:'vertex',components:[6]});
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=2,{},{timeout:15000});
    const vtxPt=(await call('view.project',{id:polyBox.hash,point:[50,50,50]})).screen;
    const vtxColor=(await call('diagnostics.pixels',{points:[vtxPt]})).colors[0];
    check('Selected vertex marker renders over active Path tracer in Vertex mode',
      vtxColor[0]>180&&vtxColor[1]>80&&vtxColor[2]<70,vtxColor);

    await call('scene.select',{ids:[polyBox.hash],mode:'polygon',components:[0]});
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=2,{},{timeout:15000});
    const facePt=(await call('view.project',{id:polyBox.hash,point:[15,-15,-50]})).screen;
    const faceSelColor=(await call('diagnostics.pixels',{points:[facePt]})).colors[0];
    await call('scene.select',{ids:[polyBox.hash],mode:'polygon',components:[]});
    await page.waitForFunction(()=>frameEngine.renderState().samples>=2,{},{timeout:15000});
    const faceUnselColor=(await call('diagnostics.pixels',{points:[facePt]})).colors[0];
    check('Selected polygon highlight renders over active Path tracer in Polygon mode',
      faceSelColor[0]-faceSelColor[2]>(faceUnselColor[0]-faceUnselColor[2])+25,
      {faceSelColor,faceUnselColor});

    // Verify Orthographic Top view (index 1) supports Render mode & HASH persistence!
    await call('view.set',{index:1,single:true,mode:'object',shading:'render-isoparms',focus:polyBox.hash});
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=2,{},{timeout:15000});
    const orthoPt=(await call('render.pixels',{points:[[0.5,0.5]],view:1,linear:true}));
    const savedRenderHash=await call('scene.export',{includeData:true});
    await call('scene.open',{name:'render-shading.hash',base64:savedRenderHash.base64});
    const reopenedRender=(await call('scene.inspect')).view;
    check('Orthographic view renders in Path tracer and HASH preserves render-isoparms shading',
      orthoPt.colors[0].every(Number.isFinite)&&orthoPt.samples>=2&&reopenedRender.index===1&&reopenedRender.shading==='render-isoparms',
      {orthoPt,reopenedRender});

    // 9. Clicking objects (viewport or Objects Browser) with realtime during navigation = true NEVER restarts render!
    await call('scene.new');
    const objA=await call('scene.create',{type:'cube',name:'PickA'});
    const objB=await call('scene.create',{type:'sphere',name:'PickB',params:{diameter:80}});
    await call('scene.select',{ids:[objB.hash]});
    await call('transform.set',{channel:'position',axis:0,value:160});
    await call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms',focus:objA.hash});
    await call('scene.create',{type:'render',params:{realtime:'on',samples:64,'realtime during navigation':true}});
    await call('scene.select',{ids:[]});
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=6,{},{timeout:15000});
    const pickScreen=(await call('view.project',{id:objA.hash,point:[50,50,50]})).screen;
    const beforeClickSamples=await page.evaluate(()=>frameEngine.renderState().samples);
    await page.mouse.move(pickScreen[0],pickScreen[1]);
    await page.mouse.down({button:'left'});
    await page.waitForTimeout(85);
    const duringClickState=await page.evaluate(()=>({samples:frameEngine.renderState().samples,interactive:frameEngine.renderState().interactive}));
    await page.mouse.up({button:'left'});
    await page.waitForTimeout(85);
    const afterClickState=await page.evaluate(()=>({samples:frameEngine.renderState().samples,interactive:frameEngine.renderState().interactive,selected:frameEngine.selectedIndices.length}));
    const rowB=page.locator('#row-'+objB.id+' .ob-namebox');
    await rowB.click();
    await page.waitForTimeout(60);
    const afterBrowserSelect=await page.evaluate(()=>({samples:frameEngine.renderState().samples,interactive:frameEngine.renderState().interactive}));
    check('Viewport and Objects Browser selection never restart Path tracer accumulation',
      !duringClickState.interactive&&duringClickState.samples>=beforeClickSamples&&
      !afterClickState.interactive&&afterClickState.samples>=beforeClickSamples&&afterClickState.selected>0&&
      !afterBrowserSelect.interactive&&afterBrowserSelect.samples>=afterClickState.samples,
      {beforeClickSamples,duringClickState,afterClickState,afterBrowserSelect});

    // 10. Finishing navigation NEVER renders/presents the previous camera position first (rtDuringNav true & false)!
    const camFresh=(await call('scene.inspect')).objects.find(n=>n.type==='render'&&n.enabled);
    for(const rtDuringNav of [true,false]){
      await call('scene.update',{id:camFresh.hash,params:{'realtime during navigation':rtDuringNav,samples:24}});
      await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=2,{},{timeout:15000});
      const preNavSig=await page.evaluate(()=>frameEngine.renderState().views?.find(v=>v.index===0)?.presentedCamSig||'');
      const cvBox=await page.locator('#frame-engine-canvas').boundingBox();
      const nx=cvBox.x+cvBox.width*.6,ny=cvBox.y+cvBox.height*.5;
      await page.mouse.move(nx,ny);
      await page.mouse.down({button:'middle'});
      await page.mouse.move(nx+130,ny-55,{steps:5});
      await page.mouse.up({button:'middle'});
      const postNavCheck=await page.evaluate(async oldSig=>{
        const stale=[];
        const start=performance.now();
        let sawVisible=false;
        while(performance.now()-start<8000){
          await new Promise(r=>requestAnimationFrame(r));
          const st=frameEngine.renderState(),v0=st.views?.find(v=>v.index===0);
          if(st.visible&&v0?.hasImage){
            sawVisible=true;
            if(oldSig&&v0.presentedCamSig===oldSig)stale.push({t:Math.round(performance.now()-start),s:st.samples,inter:st.interactive});
          }
          if(st.visible&&!st.interactive&&st.samples>=2)break;
        }
        const final=frameEngine.renderState(),finalV0=final.views?.find(v=>v.index===0);
        return {sawVisible,staleCount:stale.length,stale,finalSig:finalV0?.presentedCamSig||'',final};
      },preNavSig);
      check('Post-navigation render (rtDuringNav='+rtDuringNav+') NEVER presents stale previous camera position',
        postNavCheck.sawVisible&&postNavCheck.staleCount===0&&postNavCheck.finalSig!==preNavSig&&
        postNavCheck.final.visible&&!postNavCheck.final.interactive&&postNavCheck.final.samples>=2,
        {rtDuringNav,preNavSig,postNavCheck});
    }

    // 11. Starting a new navigation right as full static render starts must preempt cleanly without micro-freeze!
    await call('scene.update',{id:camFresh.hash,params:{'realtime during navigation':true,samples:64}});
    await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=2,{},{timeout:15000});
    const mfBox=await page.locator('#frame-engine-canvas').boundingBox();
    const mx=mfBox.x+mfBox.width*.65,my=mfBox.y+mfBox.height*.45;
    await page.mouse.move(mx,my);
    await page.mouse.down({button:'left'});
    await page.mouse.move(mx+40,my-20,{steps:4});
    await page.mouse.up({button:'left'});
    // Wait right into the start of full-res static settle (~105ms), then start a second navigation drag and measure RAF cadence!
    await page.waitForTimeout(105);
    const preemptTiming=await page.evaluate(()=>{
      window.__rafGaps=[];let last=performance.now(),run=true;
      const tick=now=>{if(!run)return;window.__rafGaps.push(now-last);last=now;requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
      window.__stopRaf=()=>{run=false;return window.__rafGaps;};
      return true;
    });
    await page.mouse.down({button:'left'});
    await page.mouse.move(mx-35,my+25,{steps:6});
    const midSecondNav=await page.evaluate(()=>({inter:frameEngine.renderState().interactive,gpuMs:frameEngine.renderState().frameGpuMs}));
    await page.mouse.up({button:'left'});
    const rafGaps=await page.evaluate(()=>window.__stopRaf());
    const maxGap=Math.max(0,...rafGaps);
    check('Preempting static render with a new navigation drag stays responsive without long GPU freeze',
      preemptTiming&&midSecondNav.inter&&maxGap<250,
      {midSecondNav,maxGap:Math.round(maxGap),rafGaps:rafGaps.map(v=>Math.round(v))});

    // 12. Sliced static refinement & sub-res->full-res transitions must NEVER flash wrong colors or display half-denoised frames!
    const prevViewport=page.viewportSize();
    await page.setViewportSize({width:1920,height:1080});
    try{
      await call('scene.new');
      const blueCube=await call('scene.create',{type:'cube',name:'CenterBlue',params:{'size x':320,'size y':320,'size z':320}});
      const redCorner=await call('scene.create',{type:'cube',name:'CornerRed',params:{'size x':450,'size y':450,'size z':450}});
      await call('scene.select',{ids:[redCorner.hash]});
      await call('transform.set',{channel:'position',axis:0,value:-420});
      await call('transform.set',{channel:'position',axis:1,value:320});
      const floorBig=await call('scene.create',{type:'cube',name:'FloorBig',params:{'size x':3000,'size y':40,'size z':3000}});
      await call('scene.select',{ids:[floorBig.hash]});
      await call('transform.set',{channel:'position',axis:1,value:-200});
      for(let i=0;i<16;i++){
        const sp=await call('scene.create',{type:'sphere',name:'Sph'+i,params:{diameter:90}});
        await call('scene.select',{ids:[sp.hash]});
        await call('transform.set',{channel:'position',axis:0,value:-500+(i%4)*330});
        await call('transform.set',{channel:'position',axis:2,value:-450-Math.floor(i/4)*280});
      }
      const mBlue=await call('material.create',{name:'VividBlue',params:{h:220,s:85,l:45,rough:75}});
      const mRed=await call('material.create',{name:'VividRed',params:{h:0,s:95,l:50,rough:70}});
      await call('material.assign',{id:blueCube.hash,material:mBlue.uid});
      await call('material.assign',{id:redCorner.hash,material:mRed.uid});
      await call('view.set',{index:0,single:true,mode:'object',shading:'solid-isoparms',focus:blueCube.hash});
      await call('scene.select',{ids:[]});
      await call('scene.create',{type:'render',name:'CamStable',params:{renderer:'Path tracer',realtime:'on','realtime during navigation':true,samples:10}});
      await page.waitForFunction(()=>frameEngine.renderState().visible&&frameEngine.renderState().samples>=2,{},{timeout:25000});
      const sigCheck=await call('render.inspect');
      check('Camera signature encodes envMode cleanly without NaN',
        (sigCheck.views?.[0]?.presentedCamSig||'').endsWith(':default'),
        {presentedCamSig:sigCheck.views?.[0]?.presentedCamSig});

      await page.evaluate(()=>{
        const canvas=document.getElementById('frame-engine-canvas');
        const c2=document.createElement('canvas');c2.width=160;c2.height=90;
        const ctx=c2.getContext('2d',{willReadFrequently:true});
        const q=frameEngine.renderer.device.queue;
        window.__origSubmit=q.submit.bind(q);
        window.__stabFrames=[];window.__stabPrev=null;window.__stabActive=false;
        let lastFc=0;
        q.submit=function(cmds){
          const res=window.__origSubmit(cmds);
          if(window.__stabActive){
            const fc=Number(canvas.dataset.frameCount||0);
            if(fc!==lastFc){
              lastFc=fc;
              ctx.drawImage(canvas,0,0,c2.width,c2.height);
              const img=ctx.getImageData(0,0,c2.width,c2.height).data;
              let rS=0,gS=0,bS=0,n=0;
              for(let y=38;y<=52;y++)for(let x=72;x<=88;x++){const idx=(y*c2.width+x)*4;rS+=img[idx];gS+=img[idx+1];bS+=img[idx+2];n++;}
              const snap=new Uint8Array(img.length);snap.set(img);
              let maxDiff=0;
              if(window.__stabPrev){
                for(let i=0;i<snap.length;i+=4){
                  const d=Math.max(Math.abs(snap[i]-window.__stabPrev[i]),Math.abs(snap[i+1]-window.__stabPrev[i+1]),Math.abs(snap[i+2]-window.__stabPrev[i+2]));
                  if(d>maxDiff)maxDiff=d;
                }
              }
              window.__stabPrev=snap;
              const rs=frameEngine.renderState();
              window.__stabFrames.push({fc,samples:rs.samples,slicing:rs.slicing,inter:rs.interactive,rgb:[Math.round(rS/n),Math.round(gS/n),Math.round(bS/n)],maxDiff});
            }
          }
          return res;
        };
      });

      const analyzeFrames=(frames)=>{
        // Find first non-interactive frame after motion (skipping initial hook warmup before interactive starts)
        const firstInter=frames.findIndex(f=>f.inter);
        const postMotion=firstInter>=0?frames.slice(firstInter).filter(f=>!f.inter):frames.filter(f=>!f.inter);
        const sliceFrames=postMotion.filter(f=>f.slicing);
        const maxSliceDiff=sliceFrames.reduce((m,f)=>Math.max(m,f.maxDiff),0);
        const badColor=postMotion.filter(f=>f.rgb[2]<=f.rgb[0]+40);
        return {total:frames.length,postMotion:postMotion.length,sliceCount:sliceFrames.length,maxSliceDiff,badColorCount:badColor.length,sampleMax:Math.max(0,...postMotion.map(f=>f.samples)),badColorSample:badColor.slice(0,3)};
      };

      // 12a. Post-navigation stability through 4-pass -> 3-pass denoiser transition (samples 0..9)
      const sBox=await page.locator('#frame-engine-canvas').boundingBox();
      await page.evaluate(()=>{window.__stabFrames=[];window.__stabPrev=null;window.__stabActive=true;});
      await page.mouse.move(sBox.x+sBox.width*.72,sBox.y+sBox.height*.5);
      await page.mouse.down({button:'left'});
      await page.mouse.move(sBox.x+sBox.width*.64,sBox.y+sBox.height*.45,{steps:6});
      await page.mouse.up({button:'left'});
      await page.waitForFunction(()=>frameEngine.renderState().samples>=9,{},{timeout:30000});
      const navStab=analyzeFrames(await page.evaluate(()=>{window.__stabActive=false;return window.__stabFrames;}));
      check('Post-navigation sliced refinement keeps displayed denoised frame pixel-identical without wrong-color flash',
        navStab.postMotion>=8&&navStab.maxSliceDiff===0&&navStab.badColorCount===0,navStab);

      // 12b. Post-object-transform stability through 4-pass -> 3-pass denoiser transition (samples 0..9)
      await call('scene.select',{ids:[blueCube.hash]});
      await page.waitForFunction(()=>!!document.querySelector('#frame-gizmo [data-part="move0"]'),{},{timeout:5000});
      const hBox=await page.locator('#frame-gizmo [data-part="move0"]').boundingBox();
      await page.evaluate(()=>{window.__stabFrames=[];window.__stabPrev=null;window.__stabActive=true;});
      await page.mouse.move(hBox.x+hBox.width*.6,hBox.y+hBox.height*.5);
      await page.mouse.down({button:'left'});
      await page.mouse.move(hBox.x+hBox.width*.6+70,hBox.y+hBox.height*.5,{steps:6});
      await page.mouse.up({button:'left'});
      await page.waitForFunction(()=>frameEngine.renderState().samples>=9,{},{timeout:30000});
      const xformStab=analyzeFrames(await page.evaluate(()=>{window.__stabActive=false;return window.__stabFrames;}));
      check('Post-transform sliced refinement keeps displayed denoised frame pixel-identical without wrong-color flash',
        xformStab.postMotion>=8&&xformStab.maxSliceDiff===0&&xformStab.badColorCount===0,xformStab);

      await page.evaluate(()=>{if(window.__origSubmit){frameEngine.renderer.device.queue.submit=window.__origSubmit;delete window.__origSubmit;}});
    }finally{
      await page.evaluate(()=>{if(window.__origSubmit){frameEngine.renderer.device.queue.submit=window.__origSubmit;delete window.__origSubmit;}}).catch(()=>{});
      if(prevViewport)await page.setViewportSize(prevViewport);
    }

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
