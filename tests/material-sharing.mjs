import assert from 'node:assert/strict';

export async function materialSharingChecks(page){
  const checks=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  const state=()=>call('scene.inspect'),update=(id,color)=>call('scene.update',{id,params:{'color preset':color}});
  const slots=(s,id)=>s.objects.find(o=>o.hash===id).tags.filter(t=>t.kind==='material').map(t=>t.materialUID);
  const check=(name,result)=>{assert.ok(result,name);checks.push({name,pass:true});};
  const card=i=>page.locator('#matList [data-material="'+i+'"]');
  async function inspectName(uid){return (await state()).materials.find(m=>m.uid===uid)?.name;}
  async function editValue(id,value){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).press('Enter');}
  async function merge(file,bytes){
    const url='**/'+file;await page.route(url,r=>r.fulfill({status:200,body:bytes}));
    try{return await call('scene.merge',{url:file});}finally{await page.unroute(url);}
  }
  try{
    await call('scene.new');
    const car=(await call('scene.create',{type:'car'})).hash,one=await state(),blue=slots(one,car);
    const second=(await call('scene.create',{type:'car'})).hash;
    let s=await state();check('Two new blue cars share all ten material UIDs',blue.length===10&&one.materials.length===s.materials.length&&slots(s,second).every((id,i)=>id===blue[i]));
    await update(second,'red');s=await state();
    const red=slots(s,second);
    check('A different preset creates exactly two finishes',s.materials.length===one.materials.length+2&&red.filter((id,i)=>id!==blue[i]).length===2&&slots(s,car).every((id,i)=>id===blue[i]));
    await update(car,'red');s=await state();
    check('Matching the other car reuses both existing red UIDs',s.materials.length===one.materials.length&&slots(s,car).every((id,i)=>id===red[i]));
    await call('edit.history',{action:'undo'});s=await state();
    check('Undo restores the original blue and red assignments',s.materials.length===one.materials.length+2&&slots(s,car).every((id,i)=>id===blue[i])&&slots(s,second).every((id,i)=>id===red[i]));
    await update(second,'blue');s=await state();
    check('Returning to blue restores all shared UIDs',s.materials.length===one.materials.length&&slots(s,second).every((id,i)=>id===blue[i]));
    const original=await call('scene.export',{includeData:true});
    await merge('identical-cars.hash',Buffer.from(original.base64,'base64'));s=await state();
    check('Merging two more compact cars retains one palette',s.objects.length===4&&s.materials.length===one.materials.length&&s.objects.every(o=>slots(s,o.hash).every((id,i)=>id===blue[i])));

    const paint=s.materials.find(m=>m.name==='Paint'),paintIndex=s.materials.indexOf(paint),label=card(paintIndex).locator('input');
    const longName='Midnight blue hatchback paint';
    await page.locator('#tabMaterials').click();await label.dblclick();
    check('Double-clicking a shelf name selects its text and keeps Materials open',await label.evaluate(i=>!i.readOnly&&i===document.activeElement&&i.selectionEnd===i.value.length));
    await label.fill(longName);await label.press('Enter');
    check('Enter renames the shared material without creating another',await inspectName(paint.uid)===longName&&(await state()).materials.length===one.materials.length);
    await page.mouse.move(2,2);await card(paintIndex).hover();const tip=page.locator('#materialNameTip');
    check('Clipped material names wait before appearing at the cursor',!(await tip.isVisible()));
    await tip.waitFor({state:'visible',timeout:2500});
    check('The hover tooltip contains the entire material name',await tip.textContent()===longName);
    await card(s.materials.findIndex(m=>m.name==='Trim')).hover();await page.waitForTimeout(650);
    check('A name that fits has no tooltip',!(await tip.isVisible()));
    await label.dblclick();await label.fill('Discard');await label.press('Escape');
    check('Escape keeps the last committed name',await inspectName(paint.uid)===longName);
    await page.locator('#tabMaterialMgr').click();const editorName=page.locator('#matName');
    await editorName.dblclick();await editorName.fill('Night');await page.locator('#inpRough').click();
    check('Leaving the editor name commits the rename',await inspectName(paint.uid)==='Night');
    await call('edit.history',{action:'undo'});check('Rename Undo restores the shared label',await inspectName(paint.uid)===longName);
    await call('edit.history',{action:'redo'});check('Rename Redo restores the short label',await inspectName(paint.uid)==='Night');
    const renamed=await call('scene.export',{includeData:true});await call('scene.open',{name:'renamed.hash',base64:renamed.base64});
    check('A shared rename survives saving and opening',await inspectName(paint.uid)==='Night'&&(await state()).materials.length===one.materials.length);

    for(const type of ['tree','human']){
      await call('scene.new');const first=await call('scene.create',{type}),initial=await state();
      const next=await call('scene.create',{type});s=await state();
      check('A second '+type+' shares its complete stock palette',s.materials.length===initial.materials.length&&slots(s,next.hash).every((id,i)=>id===slots(initial,first.hash)[i]));
    }
    await call('scene.new');
    const first=await call('scene.create',{type:'cube'}),other=await call('scene.create',{type:'sphere'});
    const material=name=>call('material.create',{name,params:{h:47,s:40,l:30,rough:37}});
    const a=await material('Bronze'),b=await material('Another label');
    const assign=(id,m)=>call('material.assign',{id,material:m.uid});
    await assign(first.hash,a);await assign(other.hash,b);s=await state();
    check('Different primitive types reuse matching properties regardless of label',slots(s,first.hash)[0]===a.uid&&slots(s,other.hash)[0]===a.uid&&!s.materials.some(m=>m.uid===b.uid));
    await page.locator('#tabObjects').click();await page.locator('#row-'+other.id+' .ob-tag.material').click();await editValue('inpRough',38);s=await state();
    const altered=slots(s,other.hash)[0];
    check('Editing an object material tag forks only its shared assignment',altered!==a.uid&&s.materials.find(m=>m.uid===altered)?.rough===38&&s.materials.find(m=>m.uid===a.uid)?.rough===37);
    await editValue('inpRough',37);s=await state();
    check('Restoring the exact finish rejoins the original material',slots(s,other.hash)[0]===a.uid&&!s.materials.some(m=>m.uid===altered));
    const img=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle='#957451';ctx.fillRect(0,0,1,1);return c.toDataURL().split(',')[1];});
    await call('material.texture',{material:a.uid,slot:'roughness',base64:img,channel:'r'});
    const c=await material('Same image');await call('material.texture',{material:c.uid,slot:'roughness',base64:img,channel:'g'});
    await assign(other.hash,c);s=await state();
    check('Distinct texture channels keep otherwise matching materials separate',slots(s,other.hash)[0]===c.uid&&slots(s,first.hash)[0]===a.uid);
    await call('material.texture',{material:c.uid,slot:'roughness',base64:img,channel:'r'});s=await state();
    check('Separate imports of the same image match by exact bytes',slots(s,other.hash)[0]===a.uid&&!s.materials.some(m=>m.uid===c.uid));
    const name=await call('material.rename',{material:a.uid,name:'Bronze R'});check('The automation rename updates the shared label',name.name==='Bronze R'&&await inspectName(a.uid)==='Bronze R');
    let rejected=false;try{await call('material.rename',{material:a.uid,name:'  '});}catch{rejected=true;}
    check('An invalid rename preserves the current label',rejected&&await inspectName(a.uid)==='Bronze R');
    const hash=await call('scene.export',{includeData:true});await merge('textured-shapes.hash',Buffer.from(hash.base64,'base64'));s=await state();
    check('Repeated textured HASH imports retain the existing label and UID',s.objects.length===4&&s.objects.every(o=>slots(s,o.hash)[0]===a.uid)&&s.materials.length===2);
    const glb=await call('scene.export',{format:'glb',includeData:true}),glbBytes=Buffer.from(glb.base64,'base64');
    await call('scene.new');await merge('textured-shapes.glb',glbBytes);const once=await state();
    await merge('textured-shapes.glb',glbBytes);s=await state();
    const ids=new Set(once.objects.flatMap(o=>slots(once,o.hash)));
    check('Repeated GLB imports reuse existing material UIDs',ids.size>0&&s.materials.length===once.materials.length&&s.objects.length===once.objects.length*2&&s.objects.every(o=>slots(s,o.hash).every(uid=>ids.has(uid))));

    await call('scene.new');
    const left=await call('scene.create',{type:'cube'}),right=await call('scene.create',{type:'cube'});
    const slow=await material('Slow'),fast=await material('Fast');
    const key=(m,frame,value)=>call('animation.key',{id:'mat:'+m.uid,path:'material:rough',frame,value,interpolation:'hard'});
    for(const m of [slow,fast]){await key(m,0,37);await key(m,10,m===slow?41:42);}
    await assign(left.hash,slow);await assign(right.hash,fast);s=await state();
    check('Equal values at the playhead keep distinct animated finishes',slots(s,left.hash)[0]===slow.uid&&slots(s,right.hash)[0]===fast.uid);
    const animated=await call('scene.export',{includeData:true});await merge('animated.hash',Buffer.from(animated.base64,'base64'));s=await state();
    check('HASH merge reuses materials with the same complete animation',s.materials.length===3&&s.objects.filter(o=>slots(s,o.hash)[0]===slow.uid).length===2&&s.objects.filter(o=>slots(s,o.hash)[0]===fast.uid).length===2);
    await call('scene.new');await merge('animated.hash',Buffer.from(animated.base64,'base64'));await call('animation.seek',{frame:10});s=await state();
    check('Newly merged materials retain distinct animation keys',s.materials.find(m=>m.name==='Slow')?.rough===41&&s.materials.find(m=>m.name==='Fast')?.rough===42);
    await call('animation.seek',{frame:0});
    const importedSlow=s.materials.find(m=>m.name==='Slow'),importedFast=s.materials.find(m=>m.name==='Fast');
    const matching=await key(importedFast,10,41);s=await state();
    check('Making the last key identical rejoins its matching animated material',matching.id===importedSlow.uid&&s.objects.every(o=>slots(s,o.hash)[0]===importedSlow.uid));
    await call('scene.new');return {pass:true,checks};
  }catch(error){return {pass:false,checks,error:error.stack};}
}
