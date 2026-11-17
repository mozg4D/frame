// Additional native editor operations in the same full 10k workload. Every edit
// is restored through normal Undo before the fixture is exported or reopened.
const near=(a,b)=>a?.length===b?.length&&a.every((x,i)=>Math.abs(x-b[i])<1e-7*Math.max(1,Math.abs(x),Math.abs(b[i])));

export async function zooAdditionalOperationChecks(page,metadata,{call,check,stage,measure,history,state,get,frameSample,originalCamera}){
 const h=metadata.handles,sourceData=async hash=>(await call('spline.inspect',{id:hash})).data;
 const schema=await page.evaluate(()=>Object.fromEntries(frameAI.listTools().filter(t=>['spline.lineCut','spline.outline','geometry.bevel','edit.copy','edit.paste'].includes(t.name)).map(t=>[t.name,t.schema||t.inputSchema])));
 for(const name of ['spline.lineCut','spline.outline','geometry.bevel','edit.copy','edit.paste'])check('Current API exposes '+name,Object.hasOwn(schema,name));
 check('Benchmark uses DPR1',await page.evaluate(()=>devicePixelRatio===1));
 await stage('All six shading modes and single/quad layout');
 await call('scene.select',{ids:[]});
 for(const shading of ['solid','wireframe','solid-wire','isoparms','solid-isoparms','off']){
  await measure('view.shading.'+shading,()=>call('view.set',{index:0,single:true,camera:originalCamera,mode:'object',shading}));await frameSample('allModes.'+shading,4);
 }
 await measure('view.quad',()=>call('view.set',{index:0,single:false,shading:'solid-isoparms'}));check('Native quad layout is active',!(await call('view.set',{})).single);await frameSample('quad',4);
 await measure('view.single',()=>call('view.set',{index:0,single:true,camera:originalCamera,shading:'solid-isoparms'}));

 await stage('Native viewport click and Alt marquee');
 await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:h.primitive});await call('scene.select',{ids:[]});
 const primitive=await get(h.primitive),at=(await call('view.project',{point:primitive.bounds.center})).screen;
 await measure('selection.nativeClick',async()=>{await page.mouse.click(...at);await call('diagnostics.frame',{frames:1});});check('Native viewport click selects its visible primitive',(await state()).selection.objects.includes(h.primitive));
 await call('scene.select',{ids:[]});const rect=await page.locator('#frame-engine-canvas').boundingBox();
 await measure('selection.nativeMarquee',async()=>{await page.keyboard.down('Alt');try{await page.mouse.move(rect.x+12,rect.y+12);await page.mouse.down();await page.mouse.move(rect.x+rect.width-12,rect.y+rect.height-12,{steps:12});await page.mouse.up();}finally{await page.keyboard.up('Alt');}await call('diagnostics.frame',{frames:1});});check('Native marquee selects visible owners',(await state()).selection.objects.includes(h.primitive));
 await call('scene.select',{ids:[h.primitive]});const visibleBefore=(await state()).objects.map(n=>[n.hash,n.visible]);await measure('view.solo.enable',()=>call('view.solo',{enabled:true}));check('Solo isolates the current selection',(await state()).view.solo);await measure('view.solo.disable',()=>call('view.solo',{enabled:false}));check('Solo leaves authored visibility unchanged',JSON.stringify((await state()).objects.map(n=>[n.hash,n.visible]))===JSON.stringify(visibleBefore));

 await stage('Objects Browser folding and scrolling');
 await call('scene.select',{ids:[]});
 const ancestry=await page.evaluate(hash=>{const byHash=new Map(nodes.map(n=>[n.nativeHash,n])),byId=new Map(nodes.map(n=>[n.id,n])),chain=[];for(let n=byHash.get(hash);n;n=byId.get(n.parent))chain.push({id:n.id,folded:n.folded});return chain.reverse();},h.densePatch);
 for(const n of ancestry){const button=page.locator('#row-'+n.id+' [data-action="fold"]');if(await button.count()&&await page.locator('#row-'+n.id).getAttribute('aria-expanded')==='false')await measure('browser.expand',()=>button.click());}
 const browser=page.locator('#obScroll');await browser.evaluate(e=>e.scrollTop=0);const browserRect=await browser.boundingBox(),beforeScroll=await browser.evaluate(e=>({top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}));check('Expanded dense Patch exposes a scrollable native hierarchy',beforeScroll.total>beforeScroll.height,beforeScroll);
 await measure('browser.scroll',async()=>{await page.mouse.move(browserRect.x+browserRect.width*.5,browserRect.y+browserRect.height*.5);await page.mouse.wheel(0,650);await page.waitForFunction(()=>document.querySelector('#obScroll').scrollTop>0);});check('Browser wheel changes native scroll position',await browser.evaluate(e=>e.scrollTop>0));
 await browser.evaluate(e=>e.scrollTop=0);
 for(const n of ancestry.toReversed()){const row=page.locator('#row-'+n.id),button=row.locator('[data-action="fold"]');if(n.folded&&await button.count()&&await row.getAttribute('aria-expanded')==='true')await measure('browser.collapse',()=>button.click());}

 await stage('Selected child spline controls: Position, Rotation and Size');
 const child=h.denseChildSpline,original=await sourceData(child),controls=Object.keys(original.vertices);
 for(const [label,channel,axis,value]of [['position','position',0,100],['rotation','rotation',2,17],['scale','size',0,80]]){
  await call('scene.select',{ids:[child],mode:'vertex',components:controls});
  await measure('components.transform.'+label,()=>call('transform.set',{channel,axis,value,coordinates:'object'}));check('Child control '+label+' changes the authored cage',JSON.stringify(await sourceData(child))!==JSON.stringify(original));await history('undo');check('Child control '+label+' Undo restores exact cage',JSON.stringify(await sourceData(child))===JSON.stringify(original));
 }

 await stage('Native cubic split, Outline, Bevel, Line Cut and tangents');
 const curve=h.freeSpline,curveBefore=await sourceData(curve),segment=Object.keys(curveBefore.segments)[0],mid=await page.evaluate(({data,segment})=>{const K=FrameSpline.K();return K.cubicPoint(K.segmentPoints(data,segment),.47);},{data:curveBefore,segment});
 await call('view.set',{index:2,single:true,mode:'vertex',shading:'isoparms',focus:curve});await call('scene.select',{ids:[curve],mode:'vertex',components:[]});const splitAt=(await call('view.project',{id:curve,point:mid})).screen;
 await measure('spline.split.nativeCtrlClick',async()=>{await page.keyboard.down('Control');try{await page.mouse.click(...splitAt);}finally{await page.keyboard.up('Control');}await call('diagnostics.frame',{frames:1});});const split=await sourceData(curve);check('Native Ctrl-click splits the original cubic once',Object.keys(split.vertices).length===Object.keys(curveBefore.vertices).length+1&&Object.keys(split.segments).length===Object.keys(curveBefore.segments).length+1);await history('undo');check('Native split Undo restores the exact cubic cage',JSON.stringify(await sourceData(curve))===JSON.stringify(curveBefore));
 await measure('spline.outline',()=>call('spline.outline',{id:curve,distance:.5,segments:Object.keys(curveBefore.segments)}));check('Outline changes native source geometry',JSON.stringify(await sourceData(curve))!==JSON.stringify(curveBefore));await history('undo');check('Outline Undo restores exact cage',JSON.stringify(await sourceData(curve))===JSON.stringify(curveBefore));
 const bevelBefore=await sourceData(child),corner=Object.keys(bevelBefore.vertices).find(v=>Object.values(bevelBefore.segments).filter(e=>e.a===v||e.b===v).length===2);check('Dense child has a native corner eligible for Bevel',!!corner);
 await measure('spline.bevel',()=>call('geometry.bevel',{id:child,size:.25,vertices:[corner],round:true}));check('Bevel changes the selected native child corner',JSON.stringify(await sourceData(child))!==JSON.stringify(bevelBefore));await history('undo');check('Bevel Undo restores exact dense child cage',JSON.stringify(await sourceData(child))===JSON.stringify(bevelBefore));
 await call('view.set',{index:2,single:true,shading:'isoparms',mode:'vertex',focus:curve});await call('scene.select',{ids:[curve],mode:'vertex',components:[]});
 const xs=Object.values(curveBefore.vertices).map(p=>p[0]),ys=Object.values(curveBefore.vertices).map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2+.7,radius=Math.max(...xs)-Math.min(...xs),line=await Promise.all([[cx-radius,cy,0],[cx+radius,cy,0]].map(point=>call('view.project',{id:curve,point}).then(r=>r.screen)));
 const cut=await measure('spline.lineCut',()=>call('spline.lineCut',{id:curve,line,visibleOnly:false}));check('Line Cut intersects and subdivides the native cubic cage',cut.changed&&Object.keys((await sourceData(curve)).vertices).length>Object.keys(curveBefore.vertices).length,cut);await history('undo');check('Line Cut Undo restores exact cubic controls',JSON.stringify(await sourceData(curve))===JSON.stringify(curveBefore));
 await measure('spline.tangents',()=>call('spline.tangents',{id:curve,vertices:Object.keys(curveBefore.vertices),action:'hard'}));check('Hard Tangents changes the cubic source',JSON.stringify(await sourceData(curve))!==JSON.stringify(curveBefore));await history('undo');check('Tangent Undo restores exact authored handles',JSON.stringify(await sourceData(curve))===JSON.stringify(curveBefore));

 await stage('Hierarchy clipboard, generator enable and Instance reference edits');
 await call('view.set',{mode:'object',index:0,single:true,camera:originalCamera,shading:'solid'});await call('scene.select',{ids:[h.deepGroup]});const beforeCopy=await state();
 const codecStats={},codecMeasured=async(name,fn)=>{
  await page.evaluate(()=>{const stats={shapeCalls:0,shapeBytes:0,shapeMs:0,types:{},textCalls:0,textBytes:0,textMs:0},shape=FrameSpline.encodeShape,text=TextEncoder.prototype.encode;window.__zooCodecStats=stats;window.__zooCodecRestore={shape,text};FrameSpline.encodeShape=function(s){const t=performance.now(),bytes=shape.apply(this,arguments);stats.shapeCalls++;stats.shapeBytes+=bytes.byteLength;stats.shapeMs+=performance.now()-t;stats.types[s?.type]=(stats.types[s?.type]||0)+1;return bytes;};TextEncoder.prototype.encode=function(){const t=performance.now(),bytes=text.apply(this,arguments);stats.textCalls++;stats.textBytes+=bytes.byteLength;stats.textMs+=performance.now()-t;return bytes;};});
  let result,stats;try{result=await measure(name,fn);}finally{stats=await page.evaluate(()=>{const r=__zooCodecRestore;FrameSpline.encodeShape=r.shape;TextEncoder.prototype.encode=r.text;return __zooCodecStats;});}
  codecStats[name]=stats;console.log('[zoo-codec] '+JSON.stringify({name,...stats}));return result;
 };
 await codecMeasured('clipboard.copy.hierarchy',()=>call('edit.copy'));const pasted=await codecMeasured('clipboard.paste.hierarchy',()=>call('edit.paste'));check('Native clipboard pastes independent hierarchy owners',pasted.objects.length>0&&pasted.objects.every(n=>!beforeCopy.objects.some(old=>old.hash===n.hash)),codecStats);await history('undo');check('Clipboard Paste Undo restores the exact authored count',(await state()).objects.length===beforeCopy.objects.length);
 const extrudeBefore=await get(h.extrude);await measure('generator.disable',()=>call('scene.update',{id:h.extrude,enabled:false}));check('Generator can be disabled natively',!(await get(h.extrude)).enabled);await history('undo');check('Generator enable Undo restores authored state',(await get(h.extrude)).enabled===extrudeBefore.enabled);
 const instanceBefore=await get(h.instance);await measure('instance.reference',()=>call('scene.update',{id:h.instance,params:{object:h.primitive}}));const instanceAfter=await get(h.instance);check('Instance reference changes without changing occurrence affine frame',instanceAfter.params.object===h.primitive&&near(instanceBefore.matrix,instanceAfter.matrix));await history('undo');check('Instance reference Undo restores original dependency',(await get(h.instance)).params.object===instanceBefore.params.object);

 await stage('Native material numeric edit and texture upload');
 const materialUid=h.texturedMaterial||h.material,materialBefore=(await state()).materials.find(m=>m.uid===materialUid),index=await page.evaluate(uid=>materials.findIndex(m=>m.uid===uid),materialUid);
 await page.locator('#tabMaterials').click();await page.locator('[data-material="'+index+'"] canvas').click();await page.locator('#tabMaterialMgr').click();
 const roughness=materialBefore.rough===37?38:37;await measure('material.numeric',async()=>{await page.locator('#inpRough').fill(String(roughness));await page.locator('#inpRough').press('Enter');await call('diagnostics.frame',{frames:1});});check('Material numeric editor updates the native material',(await state()).materials.find(m=>m.uid===materialUid).rough===roughness);await history('undo');check('Material numeric Undo restores original scalar',(await state()).materials.find(m=>m.uid===materialUid).rough===materialBefore.rough);
 const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='#d63e79';ctx.fillRect(0,0,16,16);return canvas.toDataURL('image/png').split(',')[1];});
 await measure('texture.upload',()=>call('material.texture',{material:materialUid,slot:'baseColor',base64:image,name:'Zoo editor regression texture.png'}));check('Texture upload replaces the edited material asset',(await state()).materials.find(m=>m.uid===materialUid).colorAsset!==materialBefore.colorAsset);await history('undo');check('Texture Undo restores original image identity',(await state()).materials.find(m=>m.uid===materialUid).colorAsset===materialBefore.colorAsset);
 if(h.densePatch&&h.denseChildSpline){
  await stage('Dense multi-source Patch cell material assignment');const before=await get(h.densePatch);await page.evaluate(hash=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix);window.__zooMaterialGeometry={positions:m.positions,indices:m.indices};},h.densePatch);
  await measure('components.cell',()=>call('scene.select',{ids:[h.denseChildSpline],mode:'polygon',components:['cell:0']}));await measure('material.assign.cell',()=>call('material.assign',{id:h.denseChildSpline,material:materialUid,selection:true}));const after=await get(h.densePatch);check('Cell material assignment changes only its native material tags',JSON.stringify(after.tags)!==JSON.stringify(before.tags)&&after.sources.length===before.sources.length);check('Cell material assignment retains native geometry buffers',await page.evaluate(hash=>{const m=frameEngine.scene.meshes.find(m=>m.hashId===hash&&!m.replicaMatrix),old=__zooMaterialGeometry;window.__zooMaterialGeometry=null;return m.positions===old.positions&&m.indices===old.indices;},h.densePatch));await history('undo');check('Cell material Undo restores every original material tag',JSON.stringify((await get(h.densePatch)).tags)===JSON.stringify(before.tags));
 }
 await page.locator('#tabAttributes').click();await call('scene.select',{ids:[]});await call('view.set',{index:0,single:true,mode:'object',camera:originalCamera,shading:'solid-isoparms'});
}
