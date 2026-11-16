import {fileURLToPath} from 'node:url';
import {box,runReport} from './slicer.mjs';

export async function warningStyleChecks(page){
 const checks=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
 const check=(name,pass,detail)=>{checks.push({name:'Printer warning style: '+name,pass:!!pass,detail});if(!pass)throw Error(name+': '+JSON.stringify(detail));};
 const distance=(a,b)=>Math.max(...a.slice(0,3).map((v,i)=>Math.abs(v-b[i])));
 try{
  for(const kind of ['buffer','texture','generated']){
   const old=await call('scene.inspect');if(old.objects.length)await call('scene.delete',{ids:old.objects.filter(n=>!n.parent).map(n=>n.hash)});
   const printer=await call('plugins.create',{plugin:'3d-printer'}),source=kind==='generated'?await call('scene.create',{type:'cube',params:{'size x':40,'size y':30,'size z':40}}):await call('mesh.create',{...box(),storage:kind==='texture'?'texture':'auto',name:kind+' warning fixture'});
   await call('transform.set',{channel:'position',axis:1,value:100});await call('scene.select',{ids:[]});
   await page.evaluate(async()=>{await [...frameEngine.renderer.pluginViewports].find(([entry])=>entry.manifest.id==='3d-printer')[1].ready;});
   await call('view.set',{index:0,single:true,mode:'object',shading:'solid',focus:source.hash});
   const scene=await call('scene.inspect'),bounds=scene.objects.find(n=>n.hash===source.hash).bounds,camera=scene.view.camera;camera[1]=-Math.PI/2;await call('view.set',{camera,focus:source.hash});
   const point=(x,z)=>[bounds.min[0]+(bounds.max[0]-bounds.min[0])*x,bounds.min[1],bounds.min[2]+(bounds.max[2]-bounds.min[2])*z];
   const projected=await Promise.all([[.61,.32],[.63,.63],[.63,.37],[.52,0]].map(async([x,z])=>(await call('view.project',{point:point(x,z)})).screen));
   const points=[projected[0]];for(const [x,y]of projected.slice(1))for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)points.push([Math.floor(x)+dx+.5,Math.floor(y)+dy+.5]);
   const sample=async(shading,angle)=>{await call('scene.update',{id:printer.hash,params:{'Overhang angle':angle}});await call('view.set',{shading});if(kind!=='generated'&&shading.startsWith('solid-'))await page.waitForFunction(()=>frameEngine.renderer.plainWireSurfaces?.get('false:false')?.pipeline);if(['wireframe','isoparms'].includes(shading))await page.waitForFunction(()=>frameEngine.renderer.wireRaster?.pixels);await page.waitForFunction(shading=>document.querySelector('#frame-engine-canvas').dataset.shadingMode===shading,shading);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await call('diagnostics.frame',{frames:2});return (await call('diagnostics.pixels',{points})).colors;};
   const solid=await sample('solid',90),tinted=await sample('solid',45),expected=solid[0].slice(0,3).map((v,i)=>v*.7+[255,30.6,30.6][i]*.3);
   check(kind+' blends warning at 30 percent over the existing surface',distance(tinted[0],expected)<=2,{base:solid[0],warning:tinted[0],expected});
   for(const mode of ['solid-wire','solid-isoparms','wireframe','isoparms']){
    const before=await sample(mode,90),after=await sample(mode,45);
    check(kind+' '+mode+' retains a soft warning inside the face',after[0][0]-after[0][1]>40&&after[0][0]<240,after[0]);
    const linePixels=before.map((c,i)=>i&&(['wireframe','isoparms'].includes(mode)?distance(c,[16,16,16])>8:distance(c,solid[i])>5)?i:0).filter(Boolean);
    check(kind+' '+mode+' samples visible native lines',linePixels.length>=2,{count:linePixels.length});
    let errors;if(kind!=='generated'&&mode.startsWith('solid'))errors=linePixels.map(i=>distance(after[i],tinted[i].slice(0,3).map((v,c)=>v*before[i][c]/Math.max(1,solid[i][c]))));
    else errors=linePixels.map(i=>distance(after[i],before[i]));
    check(kind+' '+mode+' keeps warning beneath native lines',Math.max(...errors)<=3,{count:linePixels.length,maxError:Math.max(...errors),pixels:linePixels.map(i=>({i,before:before[i],after:after[i]}))});
   }
  }
  return {pass:true,checks,timings:[]};
 }catch(e){return {pass:false,checks,timings:[],error:e.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runReport('printer-warning-style',warningStyleChecks);
