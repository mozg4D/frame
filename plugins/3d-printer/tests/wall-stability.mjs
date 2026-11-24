import {fileURLToPath} from 'node:url';
import {box,shifted,waitForSlice,runReport} from './slicer.mjs';

export async function wallStabilityChecks(page){
  const checks=[],call=(name,args={})=>page.evaluate(([name,args])=>frameAI.call(name,args),[name,args]);
  function check(name,pass,detail){
    checks.push({name,pass,detail});
    if(!pass)throw Error(name+' '+JSON.stringify(detail));
  }
  try{
    await call('scene.new');
    const printer=await call('plugins.create',{plugin:'3d-printer'});
    const block=await call('mesh.create',shifted(box(100,24,100),-170,0,50));
    const sphere=await call('scene.create',{type:'sphere',params:{diameter:34,'angle approximation':10}});
    await call('transform.apply',{ids:[sphere.hash],position:[-114,12,55]});
    for(const {hash} of [block,sphere])await call('scene.update',{id:hash,visible:false});
    await call('scene.update',{id:printer.hash,params:{'Line width':1,'Layer height':.3,'Initial layer height':.6}});
    await call('scene.select',{ids:[]});
    const counts=[];
    for(let run=0;run<2;run++){
      await call('plugins.command',{id:printer.hash,operation:'slice'});
      const s=await waitForSlice(call,printer.hash);
      check('Overlapping flat and curved sections finish slicing',s.state==='complete'&&s.result.preview.state==='complete'&&s.total>80,s.state);
      counts.push(s.result.preview.segments);
    }
    check('Reslicing identical sections preserves the compact segment count',counts[0]===counts[1]&&counts[0]>100,counts);
    const camera=[-1.87,1.03,1,0,0,-145,5,76,-26,212,113,242];
    const world=[];
    // Stay below the top silhouette, where different camera angles legitimately expose different layers.
    for(let j=0;j<8;j++)for(let i=0;i<4;i++){
      world.push([-120,3.13+j*1.41,80+i*4.03],[-202+i*14.03,3.18+j*1.37,100]);
    }
    const frames=[];
    for(const angle of [-.002,0,.002]){
      const rotated=camera.slice();rotated[0]+=angle;
      await call('view.set',{index:0,single:true,shading:'solid',camera:rotated});
      await call('diagnostics.frame',{frames:2});
      const points=await page.evaluate(world=>world.map(p=>frameEngine.pluginProject(p)),world);
      frames.push((await call('diagnostics.pixels',{points})).colors.map(c=>c[0]));
    }
    const changes=[];
    for(let i=0;i<world.length;i++)for(let f=1;f<frames.length;f++)changes.push(Math.abs(frames[f][i]-frames[f-1][i]));
    changes.sort((a,b)=>a-b);
    const p90=changes[Math.floor(changes.length*.9)],onWall=frames[1].filter(v=>v>20&&v<155).length;
    check('Subpixel rotation keeps the exposed flat walls stable',onWall>=world.length*.9&&p90<=2,{onWall,samples:world.length,p90});
    return {pass:true,checks,timings:[]};
  }catch(error){return {pass:false,checks,timings:[],error:error.stack};}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runReport('printer-wall-stability',wallStabilityChecks);
