import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {intrinsicChecks,residualChecks} from './camera-transport-replay.mjs';
import {fileURLToPath} from 'node:url';

export async function cameraLightingContracts(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const definition=/^\s*render:\['Camera','camera',(.+?)\],$/m.exec(html);
  assert.ok(definition);
  const tuple=Function('return ['+definition[1]+']')();
  const fields=tuple[0],options=tuple[1].quality;
  assert.deepEqual(fields.renderer,['Path tracer','Viewport']);assert.deepEqual(fields.denoiser,['on','off']);assert.equal(fields.quality,50);
  const cameraSource=html.split('<script id="frame-pathtracer"')[1].split('</script>')[0];
  assert.doesNotMatch(cameraSource,/buildTlas|CWBVH|intersectGeometry|previousBVH|useRayGBuffer/);
  for(const name of ['samples','rays per pixel','idle refinement'])assert.ok(!(name in fields));
  const policy=Function(html.slice(html.indexOf('function cameraQuality('),html.indexOf('function cameraProgramGroup('))+';return cameraQuality;')();
  let last;
  for(let q=1;q<=100;q++){
    const p=policy(q,3840*2160);assert.equal(p.quality,q);assert.ok(p.passes>=2&&p.stride>=1);
    if(last)assert.ok(p.stride<=last.stride&&p.passes>=last.passes&&p.orders>=last.orders&&p.candidates>=last.candidates);last=p;
  }
  assert.equal(policy(NaN,1).quality,50);assert.equal(policy(Infinity,1).quality,50);
  const bake=Function(/^function cameraAngularEmitters\([\s\S]+?^\}/m.exec(html)[0]+';return cameraAngularEmitters;')();
  for(const angle of [0,1e-8,.003,.2,Math.PI/4]){
    const {map}=bake([{direction:[0,1,0],angle,intensity:3,color:[1,.5,.25]}]);
    const energy=[0,0,0];for(let y=0;y<32;y++)for(let x=0;x<64;x++){
      const omega=(2*Math.PI/64)*(Math.cos(y*Math.PI/32)-Math.cos((y+1)*Math.PI/32));
      for(let k=0;k<3;k++)energy[k]+=omega*map[4*(y*64+x)+k];
    }
    for(let k=0;k<3;k++)assert.ok(Math.abs(energy[k]-6/2**k)<.0001);
  }
  assert.deepEqual([options.minimum,options.maximum,options.integer],[1,100,true]);
  const codecCode=/^function createFrameSplineCodec\([\s\S]+?^\}/m.exec(html)[0];
  const codec=Function('definitions','defaults','FrameParameters',codecCode+';return createFrameSplineCodec(["render"]);')(
    {render:['Camera','camera',fields]},()=>({}),{validate(_,p){assert.ok(Number.isInteger(p.quality)&&p.quality>=1&&p.quality<=100);}});
  const reload=params=>codec.decode(codec.encode({type:'render',params}).slice());
  assert.deepEqual(reload({quality:67,environment:'off'}).params,{quality:67,environment:'off'});
  for(const renderer of ['Cached GI','Interactive GI','Interactive PI','Path tracer']){
    assert.deepEqual(reload({samples:512,'rays per pixel':8,'gi trace scale':'1.0',renderer}).params,{renderer:'Path tracer'});
  }
  assert.deepEqual(reload({denoiser:'off'}).params,{denoiser:'off'});
  const resolveParameter=Function('definitions',/^function frameParameter\([^\n]+/m.exec(html)[0]+';return frameParameter;')({render:['Camera','camera',fields]});
  const slots=resolveParameter({type:'render',params:{}},'param:renderer').spec;
  assert.deepEqual(slots,['Path tracer','Path tracer','Viewport'],'Previously saved discrete camera keys retain their numeric slots');
  assert.throws(()=>reload({unrelated:1}),/Unknown spline parameter/);
  const residual=residualChecks();assert.ok(residual.rankLost&&residual.fineSteps>0&&residual.residual<1e-8);
  assert.deepEqual(residual.hdr,{unquantized:1,quantized:0});
  const intrinsic=intrinsicChecks();assert.equal(intrinsic.convex,0);assert.ok(intrinsic.opposed>0&&intrinsic.relativeRigidError<1e-10);
  assert.ok(intrinsic.partiallyBlockedFraction>0&&intrinsic.partiallyBlockedFraction<1);assert.equal(intrinsic.unobstructedFraction,1);
  return {pass:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await cameraLightingContracts();console.log('Camera quality, legacy HASH, strict field validation and signed transport controls passed');}
