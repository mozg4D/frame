import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch,ready} from '../tools/browser.mjs';

export async function giStage5GlassAlphaBrowserChecks(page){
  const errors=[],checks=[];
  const call=(n,a={})=>page.evaluate(([n,a])=>frameAI.call(n,a),[n,a]);
  try{
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.evaluate(()=>{
      const device=frameEngine.renderer.device;
      if(device.adapterInfo?.isFallbackAdapter)throw Error('Hardware adapter required');
      device.pushErrorScope('validation');
      const sc=document.querySelector('#frame-pathtracer');
      window.giS5={factory:Function('return ('+sc.textContent+')')()};
      sc.textContent=sc.textContent.replace('return new FrameRenderer(container,changed);','return giS5.tracer=new FrameRenderer(container,changed);');
    });

    // 1. Open thin glass sheet (auto thinWalled=true) + closed solid glass cube (thinWalled=false) in front of emissive backing
    await call('scene.new');
    const bgWall=await call('scene.create',{type:'cube',params:{'size x':600,'size y':300,'size z':20}});
    await call('transform.set',{ids:[bgWall.hash],channel:'position',axis:0,value:-300});
    await call('transform.set',{ids:[bgWall.hash],channel:'position',axis:1,value:-150});
    await call('transform.set',{ids:[bgWall.hash],channel:'position',axis:2,value:-180});
    const emMat=await call('material.create',{params:{h:50,s:20,l:90,emm:200,rough:100}});
    await call('material.assign',{id:bgWall.hash,material:emMat.uid});

    const sheet=await call('mesh.create',{
      name:'ThinSheet',
      vertices:[-120,-60,40, -30,-60,40, -30,60,40, -120,60,40],
      indices:[0,1,2, 0,2,3],
    });
    const thinGlassMat=await call('material.create',{params:{h:0,s:0,l:98,opac:95,rough:2}});
    await call('material.assign',{id:sheet.hash,material:thinGlassMat.uid});

    const solidBlock=await call('scene.create',{type:'cube',params:{'size x':80,'size y':120,'size z':80}});
    await call('transform.set',{ids:[solidBlock.hash],channel:'position',axis:0,value:30});
    await call('transform.set',{ids:[solidBlock.hash],channel:'position',axis:1,value:-60});
    const solidGlassMat=await call('material.create',{params:{h:195,s:75,l:65,opac:95,rough:2}});
    await call('material.assign',{id:solidBlock.hash,material:solidGlassMat.uid});

    await call('view.set',{index:0,single:true,focus:solidBlock.hash});
    await call('scene.create',{type:'render',params:{realtime:'on',samples:4,environment:'off'}});
    await page.waitForFunction(()=>!!giS5.tracer?.giBuffers&&frameEngine.renderState().hasImage,{timeout:45000});

    const glassRes=await page.evaluate(async()=>{
      const orig=giS5.tracer,dev=orig.device;
      const host=document.createElement('div');document.body.append(host);
      const t=giS5.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      try{
        const cam={position:[0,0,260],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],fov:45,aspect:240/160};
        const base={...orig.options,camera:cam,onSamples:()=>{},outputSize:[240,160],viewKey:'s5_g'};
        await t.start({...base,interactivePreview:true,lightingReuse:true});
        const giStats={...t.stats.gi,faults:t.stats.filmFaults,meshStates:t.scene.meshStates};
        const giLin=await t.readLinearPixels([[0.5,0.5],[0.35,0.5],[0.65,0.5]]);

        // Replay the presentation passes on the same lighting history. Every exposure
        // tap must match the full image, including glass and edges on an odd-sized frame.
        const width=191,height=117,pitch=Math.ceil(width*8/256)*256,plane=pitch*height;
        const read=dev.createBuffer({size:plane*2,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        const meter=t.meterExposure;
        let meters=0,compared=0;
        try{
          t.meterExposure=function(enc){
            if(++meters===2){
              const gb=this.giBuffers;
              const copy=offset=>enc.copyTextureToBuffer({texture:this.hdrFinalTex},{buffer:read,offset,bytesPerRow:pitch},[width,height]);
              copy(0);
              enc.clearBuffer(this.uniform,224*4,4); // Params.meterOnly
              const run=(pipeline,scene,aux,dispatch)=>{
                const pass=enc.beginComputePass();
                pass.setPipeline(pipeline);pass.setBindGroup(0,scene);pass.setBindGroup(1,aux);dispatch(pass);pass.end();
              };
              run(this.giDiscontinuityDirect,this.sceneBindGroup,gb.directGroup,p=>p.dispatchWorkgroupsIndirect(gb.giIndirect,0));
              run(this.giComposite,this.sceneBindGroup,gb.compAuxGroup,p=>p.dispatchWorkgroups(Math.ceil(width/8),Math.ceil(height/8)));
              run(this.giGlass,this.sceneNoLightsGroup,gb.glassAuxGroup,p=>p.dispatchWorkgroupsIndirect(gb.giIndirect,16));
              copy(plane);
            }
            meter.call(this,enc);
          };
          await t.start({...base,camera:{...cam,aspect:width/height},outputSize:[width,height],
            interactivePreview:true,lightingReuse:true,cachedOutput:true,previewPresentation:false});
          if(t.stats.phase!=='complete'||t.stats.gi.glassCount===0||t.stats.gi.discCount===0)throw Error('Missing cached edge or glass output');
          if(meters!==32||t.stats.presentedFrames!==2)throw Error('Expected 32 metered passes and two complete presentations');
          await read.mapAsync(GPUMapMode.READ);
          const hdr=new Uint16Array(read.getMappedRange());
          for(let y=0;y<32;y++)for(let x=0;x<32;x++){
            const sx=Math.floor((2*x+1)*width/64),sy=Math.floor((2*y+1)*height/64),at=sy*pitch/2+sx*4;
            for(let ch=0;ch<4;ch++)if(hdr[at+ch]!==hdr[plane/2+at+ch])throw Error('HDR exposure sample differs at '+sx+','+sy);
            compared++;
          }
        }finally{
          t.meterExposure=meter;
          if(read.mapState==='mapped')read.unmap();
          read.destroy();
        }

        // Progressive PT through thin & solid glass + camera inside solid cube
        await t.start({...base,interactivePreview:false,lightingReuse:false,sampleLimit:4,maxBounces:6,viewKey:'s5_pt'});
        const ptFaults=t.stats.filmFaults;
        const ptLin=await t.readLinearPixels([[0.35,0.5],[0.65,0.5]]);

        // Camera strictly inside solid glass block ([70, 0, 40])
        const insideCam={position:[70,0,40],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],fov:45,aspect:160/120};
        await t.start({...base,camera:insideCam,interactivePreview:false,lightingReuse:false,sampleLimit:2,outputSize:[160,120],maxBounces:6,viewKey:'s5_in'});
        const insideFaults=t.stats.filmFaults;
        const insideLin=await t.readLinearPixels([[0.5,0.5],[0.25,0.5]]);
        return {giStats,giLin,ptFaults,ptLin,insideFaults,insideLin,compared};
      }finally{t.dispose();host.remove();}
    });

    assert.equal(glassRes.compared,1024);
    checks.push({name:'Cached exposure matches all 1024 full-resolution HDR samples on an odd-sized glass and edge fixture',pass:true});
    const states=glassRes.giStats.meshStates;
    const thinState=states.find(s=>s.thinWalled===true);
    const solidState=states.find(s=>s.thinWalled===false&&states.indexOf(s)>0);
    assert.ok(thinState,'detectOpenThinShell must mark open glass sheet thinWalled=true: '+JSON.stringify(states));
    assert.ok(solidState,'Closed meshes must stay thinWalled=false');
    assert.ok(glassRes.giStats.glassCount>0,'Interactive giGlass must dispatch for transmissive pixels: '+glassRes.giStats.glassCount);
    assert.equal(glassRes.giStats.faults,0);
    assert.equal(glassRes.ptFaults,0);
    assert.equal(glassRes.insideFaults,0);
    for(const pt of [...glassRes.giLin,...glassRes.ptLin,...glassRes.insideLin]){
      assert.ok(pt.color.every(v=>Number.isFinite(v)&&v>=0));
    }
    const maxInside=Math.max(...glassRes.insideLin.map(p=>p.color[0]+p.color[1]+p.color[2]));
    assert.ok(maxInside>0.01,'Camera-inside medium fallback renders non-black finite glass: '+maxInside);
    checks.push({name:'Thin glass MIS, solid medium stack and camera-inside fallback verified',pass:true});

    // 2. Binary alpha cutout opacity texture + alphaCoverageTexture mip chain
    await call('render.stop');
    const alphaBase64=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=16;c.height=16;
      const ctx=c.getContext('2d');
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){
        const opaque=x<8;
        ctx.fillStyle=opaque?'#ffffff':'#000000';
        ctx.fillRect(x,y,1,1);
      }
      return c.toDataURL('image/png').split(',')[1];
    });
    const cutQuad=await call('mesh.create',{
      name:'CutoutQuad',
      vertices:[-80,-80,60, 80,-80,60, 80,80,60, -80,80,60],
      indices:[0,1,2, 0,2,3],
    });
    const replacedQuad=await call('mesh.replace',{
      id:cutQuad.hash,
      vertices:[-80,-80,60, 80,-80,60, 80,80,60, -80,80,60],
      indices:[0,1,2, 0,2,3],
      uv:[0,0, 1,0, 1,1, 0,0, 1,1, 0,1],
    });
    const cutMat=await call('material.create',{params:{h:120,s:80,l:40,rough:80}});
    await call('material.texture',{material:cutMat.uid,slot:'opacity',base64:alphaBase64,channel:'r'});
    await call('material.assign',{id:replacedQuad.object.hash,material:cutMat.uid});

    const alphaCheck=await page.evaluate(async()=>{
      const orig=giS5.tracer,dev=orig.device;
      const host=document.createElement('div');document.body.append(host);
      const t=giS5.factory(host,dev,()=>{},frameEngine.renderer.cameraShaders||{});
      try{
        const cam={position:[0,0,260],right:[1,0,0],up:[0,1,0],forward:[0,0,-1],fov:45,aspect:200/150};
        const snap=orig.options.getScene;
        const cutoutGetScene=async c=>{
          const sc=await snap(c);
          for(const m of sc.materials)if(m.opacityTexture>=0)m.alphaModeCode=2;
          return sc;
        };
        await t.start({...orig.options,getScene:cutoutGetScene,camera:cam,onSamples:()=>{},interactivePreview:true,lightingReuse:true,outputSize:[200,150],viewKey:'s5_cut'});
        const hasCovTex=t.alphaCoverageTexture&&t.alphaCoverageTexture!==t.alphaFallback;
        const maxMip=t.alphaMaxMip;
        const giFaults=t.stats.filmFaults;
        await t.start({...orig.options,getScene:cutoutGetScene,camera:cam,onSamples:()=>{},interactivePreview:false,lightingReuse:false,sampleLimit:4,outputSize:[200,150],viewKey:'s5_cut_pt'});
        const lin=await t.readLinearPixels([[0.42,0.5],[0.58,0.5]]);
        return {hasCovTex,maxMip,giFaults,ptFaults:t.stats.filmFaults,lin};
      }finally{t.dispose();host.remove();}
    });
    assert.ok(alphaCheck.hasCovTex,'alphaCoverageTexture must be built for cutout material');
    assert.ok(alphaCheck.maxMip>=1,'alphaCoverageTexture must have >=2 mip levels: '+alphaCheck.maxMip);
    assert.equal(alphaCheck.giFaults,0);assert.equal(alphaCheck.ptFaults,0);
    for(const pt of alphaCheck.lin)assert.ok(pt.color.every(Number.isFinite));
    checks.push({name:'Binary alpha coverage mip chain verified across GI and PT',pass:true});

    const val=await page.evaluate(async()=>(await frameEngine.renderer.device.popErrorScope())?.message);
    assert.equal(val,undefined);assert.deepEqual(errors,[]);
    return {pass:true,glass:{glassCount:glassRes.giStats.glassCount,inside:maxInside},alpha:alphaCheck,checks};
  }catch(error){
    return {pass:false,error:error.stack||error.message,errors,checks};
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const s=await launch({headless:true});
  try{await ready(s.page);const r=await giStage5GlassAlphaBrowserChecks(s.page);console.log(JSON.stringify(r,null,2));process.exitCode=r.pass?0:1;}
  finally{await s.close();}
}
