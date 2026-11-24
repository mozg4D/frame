import {fileURLToPath} from 'node:url';
import {runReport} from './slicer.mjs';

export async function axisGuideChecks(page){
  const checks=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  try{
    await call('scene.new');
    const printer=await call('plugins.create',{plugin:'3d-printer'});
    await page.waitForFunction(()=>[...frameEngine.renderer.pluginViewports?.entries()||[]].some(([entry,state])=>entry.manifest.id==='3d-printer'&&state.loaded));
    await call('transform.apply',{ids:[printer.hash],position:[-430,25,-410]});
    const state=await call('scene.inspect'),world=state.objects.find(o=>o.hash===printer.hash).worldMatrix;
    const visibleAxes=[[0,1,2],[0,2],[0,1],[1,2]];
    async function axisPixel(point,axis){
      const {screen}=await call('view.project',{point}),points=[];
      for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)points.push([screen[0]+dx,screen[1]+dy]);
      const {colors}=await call('diagnostics.pixels',{points});
      const saturation=c=>c[axis]-Math.max(c[(axis+1)%3],c[(axis+2)%3]);
      const rgb=colors.reduce((a,b)=>saturation(a)>=saturation(b)?a:b).slice(0,3);
      return {rgb,saturation:saturation(rgb)};
    }
    for(const [index,axes] of visibleAxes.entries())for(const shading of ['solid','off']){
      await call('view.set',{index,single:true,shading,focus:printer.hash});
      for(const selected of [false,true]){
        await call('scene.select',{ids:selected?[printer.hash]:[]});
        await call('diagnostics.frame',{frames:3});
        for(const axis of axes){
          const local=[-500,0,-500],reference=[0,0,0];local[axis]+=264;reference[axis]=397;
          const edge=await axisPixel(local.map((v,k)=>v+world[12+k]),axis);
          const guide=await axisPixel(reference,axis);
          const pass=guide.saturation>20&&edge.rgb.every((v,k)=>v===guide.rgb[k]);
          const name='Printer '+['X','Y','Z'][axis]+' edge matches the world axis in view '+index+', '+shading+', selected='+selected;
          checks.push({name,pass,detail:{edge:edge.rgb,guide:guide.rgb}});
          if(!pass)throw Error(name+' '+JSON.stringify({edge,guide}));
        }
      }
    }
    return {pass:true,checks,timings:[]};
  }catch(error){return {pass:false,checks,timings:[],error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runReport('printer-axis-guides',axisGuideChecks);
