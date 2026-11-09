export async function pluginChecks(page){
  const checks=[],timings=[],call=(name,args={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[name,args]);
  const check=(name,pass,detail)=>{checks.push({name:'RF: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
  const command=(id,operation,args={})=>call('plugins.command',{id,operation,args}),objects=async()=>(await call('scene.inspect')).objects;
  const timed=async(name,fn)=>{const start=performance.now(),result=await fn();timings.push({name,ms:performance.now()-start,limit:5000});return result;};
  try{
    await call('scene.new');
    const list=await call('plugins.list');check('RF catalogue entry exists',list.some(p=>p.id==='rf'&&p.types.includes('rf_terminal')));
    await page.locator('#tabPlugins').click();
    const icon=await page.locator('[data-plugin="rf"] img').evaluate(async image=>{await image.decode();const r=image.getBoundingClientRect();return [r.width,r.height,image.naturalWidth,image.naturalHeight,getComputedStyle(image).transform];});
    check('native unscaled 32px icon',JSON.stringify(icon)==='[32,32,32,32,"none"]',icon);
    await timed('RF native icon creation',async()=>{await page.locator('[data-plugin="rf"]').click();await call('scene.inspect');});
    const first=(await objects()).find(n=>n.type==='rf');check('icon creates RF',!!first);
    await call('scene.select',{ids:[first.hash]});
    await timed('RF Add Terminal native button',async()=>{await page.locator('[data-plugin-action-button="add-terminal"]').click();await call('scene.inspect');});
    const terminal=(await objects()).find(n=>n.type==='rf_terminal');check('Terminal is selected child',terminal?.parent===first.hash&&terminal.selected,terminal);
    await page.locator('[data-plugin-action-button="toggle-rx"]').click();await call('scene.inspect');
    check('TX and RX can both be active',(await command(terminal.hash,'status')).params.TX&&(await command(terminal.hash,'status')).params.RX);
    await page.locator('[data-plugin-action-button="toggle-matching"]').click();await call('scene.inspect');
    check('fixed load fields appear',await page.locator('[data-field="Load resistance"]').count()===1&&await page.locator('[data-field="Load reactance"]').count()===1);
    await command(terminal.hash,'settings',{Bands:'2.4–2.5, 5.15–5.85',Power:2,Phase:90,'Load reactance':-12});
    const section=await command(first.hash,'add-section');
    const second=await call('plugins.create',{plugin:'rf'}),other=await command(second.hash,'add-terminal');
    const a=await command(first.hash,'status'),b=await command(second.hash,'status');
    check('RF ownership is independent',a.terminals.length===1&&a.terminals[0]===terminal.hash&&a.sections.includes(section.hash)&&b.terminals[0]===other.hash,{a,b});
    await call('scene.select',{ids:[terminal.hash]});
    await timed('RF native Terminal transform',()=>call('transform.set',{channel:'position',axis:0,value:15,coordinates:'world'}));
    const moved=(await objects()).find(n=>n.hash===terminal.hash);check('native transform affects Terminal only',moved.worldMatrix[12]===15&&(await objects()).find(n=>n.hash===first.hash).worldMatrix[12]===0,moved.worldMatrix);
    await call('edit.history',{action:'undo'});check('native transform Undo',Math.abs((await objects()).find(n=>n.hash===terminal.hash).worldMatrix[12])<1e-9);
    await call('edit.history',{action:'redo'});
    const geometry=await call('scene.create',{type:'cube',name:'RF target'});
    await call('tag.set',{ids:[geometry.hash],kind:'rf_target',enabled:true,params:{Polarization:'RHCP',Coverage:'Uniform'}});
    await call('tag.set',{ids:[geometry.hash],kind:'rf_dielectric',enabled:true,params:{Material:'PTFE'}});
    check('tag fields are native',(await call('tag.read',{ids:[geometry.hash],kind:'rf_target'})).objects[0].tags[0].params.Polarization==='RHCP');
    const saved=await call('scene.export',{includeData:true});await call('scene.new');await call('scene.open',{name:'rf-foundation.hash',base64:saved.base64});
    const reopened=await command(first.hash,'status'),loadedTerminal=await command(terminal.hash,'status');
    check('HASH restores ownership and independent bands',reopened.terminals.includes(terminal.hash)&&reopened.sections.includes(section.hash)&&loadedTerminal.params.Bands==='2.4–2.5, 5.15–5.85'&&loadedTerminal.params['Load reactance']===-12,{reopened,loadedTerminal});
    check('HASH restores target tag',(await call('tag.read',{ids:[geometry.hash],kind:'rf_target'})).objects[0].tags[0].params.Polarization==='RHCP');
    const before=JSON.stringify(await objects());
    for(const operation of ['solve','optimize','results']){let error;try{await command(first.hash,operation);}catch(e){error=e.message;}check(operation+' rejects numerical request',!!error&&error.includes('not implemented'),error);}
    check('unavailable operations leave authoring unchanged',JSON.stringify(await objects())===before);
    const status=await command(first.hash,'status');check('no invented results',status.resultsAvailable===false&&status.solverAvailable===false&&status.optimizationAvailable===false&&!Object.hasOwn(status,'field'),status);
    await call('scene.select',{ids:[terminal.hash]});await call('scene.delete',{ids:[terminal.hash]});
    check('deletion removes Terminal membership',(await command(first.hash,'status')).terminals.length===0);
    await call('edit.history',{action:'undo'});check('deletion Undo restores Terminal membership',(await command(first.hash,'status')).terminals.includes(terminal.hash));
    const frames=(await call('diagnostics.frame',{frames:3})).frames;
    for(const key of ['cpuMs','gpuMs'])timings.push({name:'RF helper '+key,ms:Math.max(...frames.map(f=>f[key])),limit:50});
    check('completed operations and helper frames meet budgets',timings.every(t=>Number.isFinite(t.ms)&&t.ms<t.limit),timings);
    await call('scene.new');return {pass:true,checks,timings};
  }catch(e){return {pass:false,checks,timings,error:e.stack};}
}
