import {launch,ready} from '../tools/browser.mjs';
import assert from 'node:assert/strict';
const session=await launch({headless:true}),page=session.page;
const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
async function add(label,h,x,depth){
 const m=await call('mesh.create',{name:label+' source',vertices:[-3,-3,0,3,-3,0,0,3,0,-2,-2,2],indices:[0,2,1,0,1,3,1,2,3,2,0,3]});
 const obj=await call('scene.create',{type:'cloner',name:label,inputs:[m.hash],params:{type:'matrix','count x':1,'count y':1,'count z':depth,'spacing x':8,'spacing y':8,'spacing z':8}});
 await call('transform.apply',{ids:[obj.hash],position:[x,0,0]});
 return obj;
}
const stat=async id=>{
 const r=await call('diagnostics.replicas',{id,limit:0});
 const native=await page.evaluate(id=>{const n=frameNodeByHash(id);return {error:n?.splineError??null,authored:[n?.params['count x'],n?.params['count y'],n?.params['count z']]};},id);
 return {count:r.count,visible:r.visible,batch:r.resources?.batchedDraws,...native};
};
async function pixels(ids){
 await call('diagnostics.frame',{frames:1});
 return page.evaluate(async()=>{
  const r=frameEngine.renderer,d=r.device,w=r.width,h=r.height,stride=Math.ceil(w*4/256)*256,b=d.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:r.cachedColor},{buffer:b,bytesPerRow:stride},[w,h]);d.queue.submit([e.finish()]);await b.mapAsync(GPUMapMode.READ);
   const a=new Uint8Array(b.getMappedRange()),v=[0,0];
   for(let y=Math.round(h*.12);y<Math.round(h*.88);y++)for(let x=8;x<w-8;x++){
    const i=y*stride+x*4,rr=a[i],g=a[i+1],bb=a[i+2];
    if(Math.max(rr,g,bb)>45)v[x<w/2?0:1]++;
   }
   return {width:w,height:h,coloredHalves:v};
  }finally {if(b.mapState==='mapped')b.unmap();b.destroy();}
 });
}
const start=performance.now(),dialogs=[];page.on('dialog',d=>{dialogs.push([d.type(),d.message()]);d.dismiss();});
try{
 await ready(page);
 const runs=[];
 for(const reversed of [false,true]){
   await call('scene.new');
   const order=reversed?[['Second',110,1300,1],['First',0,-1300,1]]:[['First',0,-1300,1],['Second',110,1300,1]];
   const map={};for(const q of order)map[q[0]]=await add(...q);
   const a=map.First.hash,b=map.Second.hash;
   await call('scene.select',{ids:[a,b]});
   await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focusSelection:true});
   await call('scene.select',{ids:[]});
   for(const id of [a,b])await call('scene.update',{id,params:{'count x':250,'count y':200}});
   const before={reversed,phase:'below-native',a:await stat(a),b:await stat(b)};
   console.log(JSON.stringify(before));
   const below={reversed,phase:'50000+50000',a:await stat(a),b:await stat(b),pixels:await pixels([a,b]),ms:Math.round(performance.now()-start)};
   runs.push(below);console.log(JSON.stringify(below));
   await call('scene.update',{id:a,params:{'count z':2}});
   const diagnostic={reversed,phase:'over-native',a:await stat(a),b:await stat(b)};
   console.log(JSON.stringify(diagnostic));
   const above={reversed,phase:'100000+50000',a:await stat(a),b:await stat(b),pixels:await pixels([a,b]),ms:Math.round(performance.now()-start)};
   runs.push(above);console.log(JSON.stringify(above));
   if(!process.argv.includes('--legacy-baseline')){
    assert.deepEqual([above.a.count,above.b.count],[100000,50000]);
    assert.ok(above.pixels.coloredHalves.every(n=>n>10000),JSON.stringify(above.pixels));
    const scoped=await page.evaluate(hash=>{const owner=frameNodeByHash(hash);return frameEngine.syncReplicas(new Set([owner.id]));},a);
    assert.deepEqual([(await stat(a)).count,(await stat(b)).count],[100000,50000],'Scoped publication preserves unrelated Cloner');
    await call('scene.select',{ids:[a,b]});
    await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focusSelection:true});
    await call('scene.select',{ids:[]});
    const focused=await pixels([a,b]);assert.ok(focused.coloredHalves.every(n=>n>8000),JSON.stringify(focused));
    if(!reversed){
     const saved=await call('scene.export',{includeData:true,name:'qa-cloner-150000.hash'});
     await call('scene.open',{base64:saved.base64,name:'qa-cloner-150000.hash'});
     assert.deepEqual([(await stat(a)).count,(await stat(b)).count],[100000,50000],'HASH preserves both large Cloners');
     const loaded=await pixels([a,b]);assert.ok(loaded.coloredHalves.every(n=>n>8000),JSON.stringify(loaded));
     console.log('150000 aggregate scoped/focus/HASH actual pixels',JSON.stringify({focused,loaded}));
    }else{
     await call('scene.update',{id:b,params:{'count x':1,'count y':1}});
     await call('scene.select',{ids:[a]});await page.locator('#tabAttributes').click();
     const depth=page.locator('#attrContent input[data-field="count z"]');await depth.fill('3');await depth.press('Enter');
     await page.waitForFunction(id=>frameNodeByHash(id).params['count z']===3,a,{timeout:12000});
     assert.equal(await page.locator('#dialog').isVisible(),false,'Real 150,000-copy Attributes commit does not prompt');
     assert.deepEqual([(await stat(a)).count,(await stat(b)).count],[150000,1],'A single Cloner no longer has the old fixed count cap');
     await call('scene.select',{ids:[a,b]});
     await call('view.set',{index:2,single:true,shading:'solid',mode:'object',focusSelection:true});
     await call('scene.select',{ids:[]});
     const only=await pixels([a,b]);assert.ok(only.coloredHalves.some(n=>n>10000),JSON.stringify(only));
     console.log('150000 single Cloner actual viewport',JSON.stringify(only));
    }
   }
 }
 for(const r of runs.filter(x=>x.phase==='50000+50000'))assert.deepEqual([r.a.count,r.b.count],[50000,50000]);
 const desired=!process.argv.includes('--legacy-baseline');
 for(const r of runs.filter(x=>x.phase==='100000+50000')){
  const result=desired?[100000,50000]:r.reversed?[100000,0]:[0,50000];
  assert.deepEqual([r.a.count,r.b.count],result);
  if(desired)assert.ok(r.pixels.coloredHalves.every(n=>n>100),JSON.stringify(r.pixels));
 }
 assert.deepEqual(dialogs,[],'150000 copy tests must not prompt');
 console.log('Dual large Cloner native test completed; zero prompts.');
}finally{await session.close();}
