// Numerical oracles for shared job material; these do not use Mill's interval kernels.
export async function jobStockChecks({page,call,command,check,reset,create,build,wait,rays,box,timings}){
 await page.evaluate(()=>{const d=frameEngine.renderer.device,create=d.createBuffer;window.__millOwnership={device:d,create,entries:[]};d.createBuffer=function(options){const b=create.call(this,options);if(options.label?.startsWith('Mill ')){const entry={buffer:b,destroyed:false},destroy=b.destroy;__millOwnership.entries.push(entry);b.destroy=function(){entry.destroyed=true;return destroy.call(this);};}return b;};});
 try{
 const close=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-4),solid=(s,role)=>s.solids.find(v=>v.role===role);
 const move=async(id,channel,axis,value)=>{await call('scene.select',{ids:[id]});await call('transform.set',{channel,axis,value,coordinates:'object'});};
 let root=await reset();
 const stock=await create('Actual stock beyond CNC',box(120,12,140,[20,0,-50]));await call('tag.set',{ids:[stock.hash],kind:'stock',enabled:true});
 const forbidden=await create('Protection outside every operation',box(8,6,10,[95,0,12]));await call('tag.set',{ids:[forbidden.hash],kind:'protected',enabled:true});
 const target=await create('Target clipped to operation',box(120,12,140,[20,0,-50]));
 let s=await build(root.hash),stockSolid=solid(s,'stock');
 check('job retains full stock past side, bottom and upper CNC planes',close(stockSolid.grid.min,[-40,-6,-120])&&close(stockSolid.grid.max,[80,6,20])&&stockSolid.scope==='job'&&stockSolid.space===root.hash,stockSolid);
 check('job retains forbidden geometry completely outside every CNC box',close(solid(s,'protected').grid.min,[91,-3,7])&&close(solid(s,'protected').grid.max,[99,3,17]),solid(s,'protected'));
 const clipped=s.operations[0].solids[0];check('Target alone uses the physical operation envelope',clipped.role==='target'&&clipped.scope==='operation'&&close(clipped.grid.min,[-40,-6,-100])&&close(clipped.grid.max,[50,6,0]),clipped);
 for(const [axis,range]of [['X',[-40,80]],['Y',[-6,6]],['Z',[-120,20]]]){
  const rows=await rays(root.hash,'stock',axis);check(axis+' full job stock matches analytic box beyond operation boundaries',rows.length>0&&rows.every(r=>!r.ambiguous&&r.intervals.length===1&&close(r.intervals[0],range)),rows.slice(0,2));
 }
 const outside=await command(root.hash,'inspect',{role:'protected',axis:'Z',count:1});check('bounded inspection labels root physical space for external protection',outside.space===root.hash&&outside.scope==='job'&&close(outside.rays[0].intervals[0],[7,17]),outside);
 const sharedBytes=s.gpu.retainedGPUBytes,stockBytes=stockSolid.retainedGPUBytes;
 await call('scene.update',{id:target.hash,visible:false});
 const group=await call('scene.create',{type:'group',name:'Intervening ordinary hierarchy',parent:root.hash}),child=await call('scene.create',{type:'cnc',name:'Rotated sibling operation',parent:group.hash});
 await command(child.hash,'settings',{Tolerance:1});await move(child.hash,'rotation',2,90);await move(child.hash,'size',0,200);await move(child.hash,'position',0,25);
 const nested=await call('scene.create',{type:'cnc',name:'Nested operation',parent:child.hash});await command(nested.hash,'settings',{Tolerance:.25});
 // A disabled/invalid operation's finer request must not allocate a finer job grid.
 const skipped=await call('scene.create',{type:'cnc',name:'Disabled CNC',parent:root.hash});await call('scene.update',{id:skipped.hash,enabled:false});await command(skipped.hash,'settings',{Tolerance:.0001});
 const tilted=await call('scene.create',{type:'cnc',name:'Incompatible axis CNC',parent:root.hash});await command(tilted.hash,'settings',{Tolerance:.0001});await move(tilted.hash,'rotation',0,30);
 s=await build(root.hash);stockSolid=solid(s,'stock');
 check('operations share one root stock and initial revision in native preorder',s.solids.length===2&&s.stockRevision===0&&s.operations.map(o=>o.hash).join(',')===[root.hash,child.hash,nested.hash].join(',')&&s.operations.every(o=>o.stockRevision===0&&o.solids.length===1&&o.solids[0].role==='target'),s.operations);
 check('shared job pitch honors the finest enabled valid operation',stockSolid.grid.requestedPitch===.25&&solid(s,'protected').grid.requestedPitch===.25&&stockSolid.grid.pitch.every(v=>v<=.25),stockSolid.grid);
 const state=await call('scene.inspect'),world=id=>state.objects.find(n=>n.hash===id).worldMatrix;
 const point=(m,p)=>[0,1,2].map(row=>m[12+row]+p.reduce((v,x,col)=>v+m[col*4+row]*x,0));
 for(const op of s.operations){
  const w=world(op.hash),scales=[0,4,8].map(i=>Math.hypot(...w.slice(i,i+3))),p=[7,-3,-9],actual=point(op.toJob,p),expected=point(w,p.map((v,i)=>v/scales[i]));
  check('physical operation transform agrees with native frame: '+op.hash,close(actual,expected)&&close(op.bounds.min,[-50*scales[0],-50*scales[1],-100*scales[2]])&&close(op.bounds.max,[50*scales[0],50*scales[1],0]),{actual,expected,bounds:op.bounds});
 }
 const rootRay=await command(root.hash,'inspect',{axis:'Z',count:1}),childRay=await command(child.hash,'inspect',{axis:'Z',count:1});
 check('nested inspection addresses shared job rays without reimport or local clipping',rootRay.space===root.hash&&childRay.space===root.hash&&childRay.operation===child.hash&&JSON.stringify(rootRay.rays)===JSON.stringify(childRay.rays),childRay);
 const all=[...s.solids,...s.operations.flatMap(o=>o.solids)],retained=all.reduce((n,v)=>n+(v.retainedGPUBytes||0),0),reads=all.reduce((n,v)=>n+v.metadataReadBytes,0);
 check('GPU accounting counts shared stock once and bounds multi-operation memory',s.gpu.retainedGPUBytes===retained&&retained<8*1024*1024&&s.gpu.peakGPUBytes<64*1024*1024&&reads===184&&s.gpu.metadataReadBytes===reads,{...s.gpu,sharedBytes,stockBytes});
 const live=await page.evaluate(()=>__millOwnership.entries.filter(e=>!e.destroyed).reduce((n,e)=>n+e.buffer.size,0));check('retained GPU bytes agree with actual undestroyed buffers',live===retained,{live,retained});
 const stale=await call('scene.update',{id:stock.hash,name:'Renamed stock'});check('metadata rename preserves shared stock',stale.name==='Renamed stock'&&(await command(root.hash,'status')).state==='geometry-ready');
 await move(stock.hash,'position',0,300);s=await command(root.hash,'status');check('external source changes retire every shared result atomically',s.state==='stale'&&s.solids.length===0&&s.operations.length===0&&s.stockRevision===null&&s.gpu===null,s);
 check('staleness destroys every owned shared GPU buffer',await page.evaluate(()=>__millOwnership.entries.every(e=>e.destroyed)));
 await call('edit.history',{action:'undo'});await command(root.hash,'settings',{Tolerance:.5});await command(nested.hash,'settings',{Tolerance:.5});await command(root.hash,'slice');s=await command(root.hash,'status');check('running job exposes no partial shared or per-operation publication',s.state==='running'&&s.solids.length===0&&s.operations.length===0&&s.stockRevision===null,s);
 await command(root.hash,'cancel');s=await wait(root.hash);check('cancel retires full job solids without publishing a revision',s.state==='cancelled'&&s.solids.length===0&&s.operations.length===0&&s.stockRevision===null,s);
 check('cancellation destroys every owned shared GPU buffer',await page.evaluate(()=>__millOwnership.entries.every(e=>e.destroyed)));
 s=await build(root.hash);check('rebuild starts from one fresh source stock revision',s.stockRevision===0&&s.operations.every(o=>o.stockRevision===0)&&solid(s,'stock').grid.requestedPitch===.5,s.stockRevision);
 // Root computation can be disabled while valid descendant operations still use its frame.
 await call('scene.update',{id:root.hash,enabled:false});s=await build(root.hash);check('disabled root retains shared stock for valid descendant operations',s.operations.length===2&&s.operations.every(o=>o.hash!==root.hash)&&solid(s,'stock').space===root.hash,s.operations.map(o=>o.hash));
 const disabledRoot=await command(root.hash,'inspect',{count:1});check('disabled root can inspect the shared job material',disabledRoot.scope==='job'&&disabledRoot.space===root.hash&&disabledRoot.operation===null&&disabledRoot.rays.length===1,disabledRoot);
 await call('scene.update',{id:child.hash,enabled:false});await call('scene.update',{id:nested.hash,enabled:false});s=await build(root.hash);check('all ignored operations allocate no stock or revision',s.operations.length===0&&s.solids.length===0&&s.stockRevision===null&&s.gpu.retainedGPUBytes===0,s);
 root=await reset();const scaled=await create('Stock in affine assembly',box(16,10,8));await call('scene.update',{id:scaled.hash,parent:root.hash});await call('tag.set',{ids:[scaled.hash],kind:'stock',enabled:true});
 await move(root.hash,'size',0,150);await move(root.hash,'size',1,75);await move(root.hash,'size',2,160);await move(root.hash,'rotation',0,21);await move(root.hash,'rotation',1,37);
 const affineChild=await call('scene.create',{type:'cnc',parent:root.hash});await command(affineChild.hash,'settings',{Tolerance:.5});await move(affineChild.hash,'rotation',2,90);await move(affineChild.hash,'position',0,25);s=await build(root.hash);
 const affine=await call('scene.inspect'),rw=affine.objects.find(n=>n.hash===root.hash).worldMatrix,rootScales=[0,4,8].map(i=>Math.hypot(...rw.slice(i,i+3)));
 for(const op of s.operations){const w=affine.objects.find(n=>n.hash===op.hash).worldMatrix,scales=[0,4,8].map(i=>Math.hypot(...w.slice(i,i+3))),p=[3,5,-7],pw=point(w,p.map((v,i)=>v/scales[i])),expected=[0,1,2].map(col=>[0,1,2].reduce((sum,row)=>sum+(pw[row]-rw[12+row])*rw[col*4+row]/rootScales[col],0));check('scaled rotated root preserves physical operation-to-job mapping: '+op.hash,close(point(op.toJob,p),expected),{actual:point(op.toJob,p),expected});}
 const affineJob=s.id,affineRays=await command(affineChild.hash,'inspect',{axis:'Z',count:1});await move(root.hash,'position',0,345);s=await command(root.hash,'status');check('common assembly motion preserves full shared stock and physical transforms',s.state==='geometry-ready'&&s.id===affineJob&&JSON.stringify((await command(affineChild.hash,'inspect',{axis:'Z',count:1})).rays)===JSON.stringify(affineRays.rays),{state:s.state,id:s.id});
 root=await reset();const remote=await create('Full stock exceeds grid despite a small CNC overlap',box(2100,2,2,[1000,0,-2]));await call('tag.set',{ids:[remote.hash],kind:'stock',enabled:true});await command(root.hash,'settings',{Tolerance:.5});await command(root.hash,'slice');s=await wait(root.hash);check('out-of-box stock cannot bypass full-domain capacity checks',s.state==='failed'&&s.error.code==='RESOLUTION_LIMIT'&&s.solids.length===0&&s.stockRevision===null,s);
 root=await reset();const good=await create('Stock imported before a later failure',box(2,2,2));await call('tag.set',{ids:[good.hash],kind:'stock',enabled:true});const tooBig=await create('Protection fails after stock allocation',box(2100,2,2));await call('tag.set',{ids:[tooBig.hash],kind:'protected',enabled:true});await command(root.hash,'slice');s=await wait(root.hash);check('failure after shared stock import retires all earlier solids',s.state==='failed'&&s.solids.length===0&&s.stockRevision===null&&await page.evaluate(()=>__millOwnership.entries.every(e=>e.destroyed)),s);
 root=await reset();const material=await create('Deletion retires shared GPU resources');await call('tag.set',{ids:[material.hash],kind:'stock',enabled:true});await call('scene.update',{id:root.hash,visible:false});await build(root.hash);await call('scene.delete',{ids:[root.hash]});check('hidden root deletion retires shared solids and preserves source geometry',(await call('scene.inspect')).objects.some(n=>n.hash===material.hash));
 const remaining=await page.evaluate(()=>__millOwnership.entries.filter(e=>!e.destroyed).map(e=>({label:e.buffer.label,size:e.buffer.size})));check('failure, scene replacement and deletion leave no owned GPU buffers',remaining.length===0,remaining);
 }finally{await page.evaluate(()=>{__millOwnership.device.createBuffer=__millOwnership.create;delete window.__millOwnership;});}
}
