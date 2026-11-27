// Focused regression coverage for wall-modeled Shape with sealed cut-cell
// pockets, full-triangle Shape probing/streamlines, oversized mesh clipping,
// and asynchronous failure feedback/recovery.
export async function verifyWallModeledHardening(){
  const call=(name,args={})=>frameAI.call(name,args);
  const wait=ms=>new Promise(ok=>setTimeout(ok,ms));

  async function waitTerminal(op,limitMs=300000){
    const start=performance.now();
    for(;;){
      await wait(120);
      const s=await op('results');
      if(['ready','unconverged','failed','stopped'].includes(s.state))return s;
      if(performance.now()-start>limitMs)throw Error('Timed out waiting for CFD solve: '+JSON.stringify(s.job));
    }
  }

  // 1. Default Cube at y=150 (wall-modeled SST-DDES with sealed cut-cell pocket):
  // verify finite-time discrete adjoint convergence, full-triangle Shape probing,
  // distinct Shape map pixels, and scaled Shape streamlines.
  await call('scene.new');
  const box=await call('scene.create',{type:'cfd',params:{Speed:20}});
  const cube=await call('scene.create',{type:'cube'});
  await call('transform.set',{ids:[cube.hash],channel:'position',axis:1,value:150,coordinates:'world'});
  await call('view.set',{index:1,single:true,shading:'solid',focus:cube.hash});
  const op=(operation,args={})=>call('plugins.command',{id:box.hash,operation,args});

  await op('solve-frame',{fidelityBudget:'preview'});
  const cubeRun=await waitTerminal(op);
  const cr=cubeRun.result;
  if(!['ready','unconverged'].includes(cubeRun.state)||cr?.shape?.state!=='ready')
    throw Error('Cube wall-modeled Shape failed: '+JSON.stringify({state:cubeRun.state,job:cubeRun.job,shape:cr?.shape}));

  const triCount=cr.surfaceFields?.occurrences?.[0]?.triangles??0;
  const probes=[];
  for(let t=0;t<triCount;t++)probes.push(await op('probe',{occurrence:0,triangle:t}));
  const densities=probes.map(p=>p.shapeDensityNPerM3),patches=probes.map(p=>p.shapePatchNPerMm);
  const cubeOk=triCount===12&&cr.validity.maxDivergencePerS<1e-6&&
    cr.shape.pressureDefect<=3e-6&&cr.shape.inletDefect<=3e-6&&
    densities.every(Number.isFinite)&&patches.every(Number.isFinite)&&
    new Set(densities).size>4&&(cr.surfaceColorScale?.shapeNPerM3??0)>0;

  // Verify Shape map renders visibly differently from Drag map and streamlines
  // carry finite non-negative physical adjoint magnitudes.
  await call('diagnostics.frame',{frames:2});
  const rect=[...document.querySelectorAll('canvas')].map(c=>c.getBoundingClientRect()).find(r=>r.width>0&&r.height>0);
  const pts=[];
  for(const x of [15,50,85])for(const z of [15,50,85]){
    const h=await call('view.project',{id:cube.hash,point:[x,100,z]});
    if(h?.screen&&(!rect||h.screen[0]>rect.left+2&&h.screen[0]<rect.right-2&&h.screen[1]>rect.top+2&&h.screen[1]<rect.bottom-2))pts.push(h.screen);
  }
  if(pts.length<4)throw Error('Expected projected cube points inside active view: '+JSON.stringify({pts,rect}));
  const dragPixels=(await call('diagnostics.pixels',{points:pts})).colors;
  await op('shape-map');
  await call('diagnostics.frame',{frames:3});
  const shapePixels=(await call('diagnostics.pixels',{points:pts})).colors;
  const mapChanged=dragPixels.filter((c,i)=>c.slice(0,3).some((v,k)=>Math.abs(v-shapePixels[i][k])>8)).length;

  await op('flow-lines',{density:24});
  await call('diagnostics.frame',{frames:2});
  let maxAdjoint=0,flowSamples=0,invalidFlow=0;
  for(let seed=0;seed<12;seed++)for(const backward of [false,true]){
    const line=await op('flow-line',{seed,backward});
    for(const pt of line.points){
      flowSamples++;
      if(!Number.isFinite(pt.adjointMagnitude)||pt.adjointMagnitude<0)invalidFlow++;
      else maxAdjoint=Math.max(maxAdjoint,pt.adjointMagnitude);
    }
  }
  await op('flow-lines',{density:0});

  // 2. Oversized 200 m x 200 m floor slab intersecting the 1 m CFD box:
  // exercises 2D band clipping in rasterize when raw fixed-point span overflows.
  await call('scene.new');
  const box2=await call('scene.create',{type:'cfd',params:{Speed:.02}});
  const floor=await call('scene.create',{type:'cube'});
  await call('transform.set',{ids:[floor.hash],channel:'size',axis:0,value:200000,coordinates:'object'});
  await call('transform.set',{ids:[floor.hash],channel:'size',axis:1,value:20,coordinates:'object'});
  await call('transform.set',{ids:[floor.hash],channel:'size',axis:2,value:200000,coordinates:'object'});
  await call('transform.set',{ids:[floor.hash],channel:'position',axis:0,value:-100000,coordinates:'world'});
  await call('transform.set',{ids:[floor.hash],channel:'position',axis:1,value:100,coordinates:'world'});
  await call('transform.set',{ids:[floor.hash],channel:'position',axis:2,value:-100000,coordinates:'world'});
  const op2=(operation,args={})=>call('plugins.command',{id:box2.hash,operation,args});
  await op2('solve-frame',{fidelityBudget:'preview'});
  const floorRun=await waitTerminal(op2);
  const floorOk=['ready','unconverged'].includes(floorRun.state)&&
    floorRun.result?.validity?.maxDivergencePerS<1e-6&&
    floorRun.result?.forceWorld?.every(Number.isFinite);

  // 3. Asynchronous failure UI feedback and recovery upon input edit.
  await call('scene.new');
  const box3=await call('scene.create',{type:'cfd',params:{Speed:150}});
  await call('scene.create',{type:'cube'});
  await call('scene.select',{ids:[box3.hash]});
  document.querySelector('#tabAttributes')?.click();
  await call('diagnostics.frame',{frames:2});
  const op3=(operation,args={})=>call('plugins.command',{id:box3.hash,operation,args});
  await op3('solve-frame',{fidelityBudget:'preview'});
  const failed=await waitTerminal(op3,60000);
  await call('diagnostics.frame',{frames:2});
  const findCfdColor=()=>[...document.querySelectorAll('.ob-name')].find(el=>el.textContent.trim()==='CFD')?.style.getPropertyValue('--object-color')?.trim()??'';
  const failProgress=document.querySelector('[data-plugin-action-button="solve-frame"]')?.previousElementSibling?.textContent?.trim()??'';
  const failColor=findCfdColor();

  await call('scene.update',{id:box3.hash,params:{Speed:20}});
  await call('diagnostics.frame',{frames:2});
  const recovered=await op3('results');
  const recProgress=document.querySelector('[data-plugin-action-button="solve-frame"]')?.previousElementSibling?.textContent?.trim()??'';
  const recColor=findCfdColor();

  const uiOk=failed.state==='failed'&&failed.job?.error?.code==='FLOW_REGIME'&&
    failProgress==='Mach > 0.25'&&failColor==='#ee554b'&&
    recovered.state==='stale'&&recovered.job?.error===null&&
    recProgress===''&&recColor!=='#ee554b';

  return {
    pass:cubeOk&&mapChanged>0&&flowSamples>0&&invalidFlow===0&&maxAdjoint>0&&floorOk&&uiOk,
    cube:{state:cubeRun.state,shape:cr.shape,triCount,distinctDensities:new Set(densities).size,
      shapeScale:cr.surfaceColorScale?.shapeNPerM3??null,mapChanged,flowSamples,maxAdjoint,invalidFlow},
    floor:{state:floorRun.state,mass:floorRun.result?.validity?.maxDivergencePerS??null,
      force:floorRun.result?.forceWorld??null},
    ui:{failedState:failed.state,errorCode:failed.job?.error?.code??null,failProgress,failColor,
      recoveredState:recovered.state,recoveredError:recovered.job?.error??null,recProgress,recColor}
  };
}
