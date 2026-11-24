import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function extractPathtracerContracts(html){
  const match=/<script id="frame-pathtracer" type="text\/plain">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match,'Expected #frame-pathtracer script in index.html');
  const aa=/<script id="frame-camera-aa" type="text\/plain">([\s\S]*?)<\/script>/.exec(html)?.[1]||'';
  const fakeDoc={getElementById:id=>id==='frame-camera-aa'?{textContent:aa}:{textContent:''}};
  const fakeDevice={
    lost:new Promise(()=>{}),
    createShaderModule:()=>({}),
    createBindGroupLayout:()=>({}),
    createPipelineLayout:()=>({}),
  };
  const programs=new Function('document','GPUShaderStage','GPUTextureUsage','GPUBufferUsage','return ('+match[1]+')')(
    fakeDoc,
    {VERTEX:1,FRAGMENT:2,COMPUTE:4},
    {COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16},
    {MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512}
  )(null,fakeDevice);
  assert.ok(programs?.contracts,'Expected contracts on cameraPrograms()');
  return programs.contracts;
}

export async function giContractsChecks(){
  const checks=[];
  const check=(name,fn)=>{fn();checks.push({name,pass:true});};
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const c=extractPathtracerContracts(html);

  check('planFilm allocates compact 20 B/px single and multi-page films',()=>{
    const hd=c.planFilm(1920,1080);
    assert.equal(hd.pageCount,1);
    assert.equal(hd.pixelCount,1920*1080);
    assert.equal(hd.filmBytesPerPixel,16);
    assert.equal(hd.m2BytesPerPixel,4);
    assert.equal(hd.totalFilmBytes,1920*1080*20);
    assert.equal(hd.pages[0].pixelOffset,0);
    assert.equal(hd.pages[0].pixelCount,1920*1080);
    assert.equal(hd.pages[0].filmBytes,1920*1080*16);
    assert.equal(hd.pages[0].m2Bytes,1920*1080*4);

    const split=c.planFilm(256,256,{maxStorageBufferBindingSize:65536});
    assert.ok(split.pageCount>1,'Expected multiple pages under 64 KiB storage binding');
    let offset=0;
    for(let i=0;i<split.pages.length;i++){
      const p=split.pages[i];
      assert.equal(p.pageIndex,i);
      assert.equal(p.pixelOffset,offset);
      assert.ok(p.filmBytes<=65536);
      offset+=p.pixelCount;
    }
    assert.equal(offset,256*256);
    assert.throws(()=>c.planFilm(16384,16384,{maxTextureDimension2D:8192}),RangeError);
  });

  check('validateMRT enforces <= 32 B/sample and gbufferPlan matches',()=>{
    const cost=c.validateMRT(['rg32uint','rg16float','rgba8unorm','rgba8unorm','rg16float']);
    assert.equal(cost,32);
    assert.throws(()=>c.validateMRT(['rg32uint','rg16float','rgba8unorm','rgba8unorm','rgba16float']),RangeError);
    assert.throws(()=>c.validateMRT(Array(9).fill('r8uint')),RangeError);
    const gp=c.gbufferPlan(1280,720);
    assert.equal(gp.colorAttachmentCost,28);
    assert.equal(gp.bytes,1280*720*24);
    assert.equal(gp.pixels,1280*720);
    assert.ok(c.hiZMipBytes(640,360)>0);
  });

  check('dispatch2D shards workgroups cleanly past 65535',()=>{
    const small=c.dispatch2D(640*64,64,65535);
    assert.equal(small.groupsX,640);
    assert.equal(small.groupsY,1);
    const large=c.dispatch2D(70000*64,64,65535);
    assert.ok(large.groupsX<=65535&&large.groupsY===2);
    assert.ok(large.groupsX*large.groupsY*64>=70000*64);
    const zero=c.dispatch2D(0,64,65535);
    assert.equal(zero.totalWorkgroups,0);
  });

  check('validateDisplayAliases forbids frozen/scratch overlap',()=>{
    const p={},a={},b={};
    assert.equal(c.validateDisplayAliases(p,a,b,1),true);
    assert.throws(()=>c.validateDisplayAliases(p,a,a,0),/alias/i);
    assert.throws(()=>c.validateDisplayAliases(a,a,b,1),/Frozen preview/i);
    assert.equal(c.validateDisplayAliases(a,a,b,0),true);
  });

  check('RevisionGate enforces 250ms settle and stale fencing',()=>{
    const gate=new c.RevisionGate({settleMs:250});
    const t0=gate.token();
    assert.equal(gate.mode(100),'interactive');
    assert.equal(gate.presentPreview(t0),true);
    assert.equal(gate.mode(100),'interactive');
    assert.equal(gate.mode(249),'interactive');
    assert.equal(gate.mode(250),'progressive');

    gate.changeView(300);
    assert.equal(gate.presentPreview(t0),false,'Stale preview token must be rejected');
    assert.equal(gate.mode(450),'interactive');
    const t1=gate.token();
    assert.equal(gate.presentPreview(t1),true);
    assert.equal(gate.mode(549),'interactive');
    assert.equal(gate.mode(550),'progressive');

    const ticket=gate.beginBuild(560);
    assert.equal(gate.mode(900),'interactive','In-flight build keeps mode interactive');
    assert.ok(gate.publish(ticket,910));
    assert.equal(gate.publish(ticket,920),null,'Double publish rejected');
    const t2=gate.token();
    assert.equal(gate.presentPreview(t2),true);
    assert.equal(gate.mode(1159),'interactive');
    assert.equal(gate.mode(1160),'progressive');
  });

  check('TelemetryMailbox, AgeClock and AdaptiveQualityController behave monotonically',()=>{
    const mb=new c.TelemetryMailbox(4);
    const snap={transport:2,view:3,estimator:1,series:5};
    assert.equal(mb.record({snapshot:snap,frame:1,gpuMs:-1,collectedAt:100}),false);
    assert.equal(mb.record({snapshot:snap,frame:1,gpuMs:8.5,collectedAt:100}),true);
    assert.equal(mb.record({snapshot:{...snap,view:2},frame:1,gpuMs:8.5,collectedAt:100}),true);
    assert.equal(mb.consume(snap,200,250).length,1);
    assert.equal(mb.consume(snap,200,250).length,0);

    const clk=new c.AgeClock(100,16);
    assert.equal(clk.advance(108),0);
    assert.equal(clk.advance(120),1);
    assert.equal(clk.advance(10000),255);
    clk.reset(50);
    assert.equal(clk.advance(66),1);

    const qc=new c.AdaptiveQualityController();
    assert.equal(qc.tier,0);
    qc.observe(16.0);assert.equal(qc.tier,0);
    qc.observe(16.0);assert.equal(qc.tier,1);
    for(let i=0;i<9;i++){qc.observe(10.0);assert.equal(qc.tier,1);}
    qc.observe(10.0);assert.equal(qc.tier,0);
  });

  check('fresnelDielectric, thinSheetRT and atrousIterations satisfy physical laws',()=>{
    const f0=c.fresnelDielectric(1,1,1.5);
    assert.ok(Math.abs(f0-0.04)<1e-6);
    assert.equal(c.fresnelDielectric(0,1,1.5),1);
    assert.equal(c.fresnelDielectric(Math.cos(60*Math.PI/180),1.5,1.0),1,'TIR');
    const rtLossless=c.thinSheetRT(0.08,[1,1,1]);
    for(let i=0;i<3;i++)assert.ok(Math.abs(rtLossless.r[i]+rtLossless.t[i]-1)<1e-12);
    const rtAbs=c.thinSheetRT(0.1,[0.6,0.8,0.9]);
    for(let i=0;i<3;i++)assert.ok(rtAbs.r[i]+rtAbs.t[i]<1);
    assert.deepEqual([0,1,3,4,15,16,63,64,128].map(c.atrousIterations),[3,3,3,2,2,1,1,0,0]);
  });

  return {pass:true,checks};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await giContractsChecks();
  console.log(JSON.stringify(result,null,2));
  process.exitCode=result.pass?0:1;
}
