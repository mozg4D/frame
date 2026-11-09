export async function fixtureTransformChecks(page,state){
 const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]),meshes=state.objects.filter(n=>n.mesh),center=[0,1,2].map(i=>(Math.min(...meshes.map(n=>n.bounds.min[i]))+Math.max(...meshes.map(n=>n.bounds.max[i])))/2),n=meshes.reduce((best,n)=>Math.hypot(...n.bounds.center.map((v,i)=>v-center[i]))<Math.hypot(...best.bounds.center.map((v,i)=>v-center[i]))?n:best);
 await call('view.set',{index:0,single:true,mode:'object',shading:'solid'});
 // The aggregate runner previously focused a corner owner. Frame the entire fixture,
 // not just the selected owner, so the drag still renders the full heavy workload.
 await call('scene.select',{ids:meshes.map(n=>n.hash)});await page.evaluate(()=>frameEngine.focusSelection());await call('scene.select',{ids:[n.hash]});await call('diagnostics.frame',{frames:2});
 const canvas=await page.locator('#frame-engine-canvas').boundingBox(),centers=await page.evaluate(async points=>{const result=[];for(const point of points)result.push((await frameAI.call('view.project',{point})).screen);return result;},meshes.map(n=>n.bounds.center));
 if(!canvas||!centers.every(p=>p[0]>=canvas.x&&p[0]<=canvas.x+canvas.width&&p[1]>=canvas.y&&p[1]<=canvas.y+canvas.height))throw Error('Full heavy fixture is not framed for native object drag');
 const results=[];
 for(let i=0;i<3;i++){
  await call('diagnostics.frame',{frames:1});const before=await call('scene.inspect'),frame=before.stats.frame?.id||0,object=before.objects.find(o=>o.hash===n.hash);
  const point=await page.evaluate(()=>{const p=frameEngine.gizmoState.handles.find(h=>h.part==='move0')?.suggested;if(!p)throw Error('Missing visible native object move handle');const c=document.querySelector('#frame-engine-canvas').getBoundingClientRect();for(let r=0;r<=4;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const q=[p[0]+dx,p[1]+dy];if(q[0]>=c.left&&q[0]+18<=c.right&&q[1]>=c.top&&q[1]<=c.bottom&&document.elementFromPoint(...q)?.closest('[data-part]')?.dataset.part==='move0')return q;}throw Error('Object move target is not a visible native move0 hit');});
  await page.mouse.move(...point);const started=Date.now();let next;
  try{await page.mouse.down();await page.mouse.move(point[0]+18,point[1],{steps:1});do{next=await call('scene.inspect');if(Date.now()-started>10000)throw Error('Object drag did not publish');}while(!next.objects.find(o=>o.hash===n.hash).matrix.some((v,k)=>Math.abs(v-object.matrix[k])>1e-9)||next.stats.frame?.id<=frame);results.push({elapsedMs:Date.now()-started,cpuMs:next.stats.frame.cpuMs,gpuMs:next.stats.frame.gpuMs});}finally{await page.mouse.up();}
  await call('edit.history',{action:'undo'});const restored=(await call('scene.inspect')).objects.find(o=>o.hash===n.hash);if(!restored||restored.matrix.some((v,k)=>Math.abs(v-object.matrix[k])>1e-9))throw Error('Heavy object drag Undo did not restore its matrix');
 }
 return {pass:true,object:n.hash,triangles:state.stats.triangles,framedOwners:centers.length,drags:results};
}
