import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function cameraViewStateChecks(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const definition=/^\s*render:\['Camera','camera',(.+?)\],$/m.exec(html);
  const [fields,{samples}]=Function('return ['+definition[1]+']')();
  assert.deepEqual(fields.renderer,['Path tracer','Viewport']);
  assert.deepEqual(Object.keys(fields).slice(0,3),['resolution x','resolution y','samples']);
  assert.equal(fields.samples,64);
  assert.deepEqual([samples.minimum,samples.maximum,samples.integer],[1,undefined,true]);
  assert.ok(!Object.hasOwn(fields,'denoiser')&&!Object.hasOwn(fields,'quality'));
  const codecCode=/^function createFrameSplineCodec\([\s\S]+?^\}/m.exec(html)[0];
  const codec=Function('definitions','defaults','FrameParameters',codecCode+';return createFrameSplineCodec(["render"]);')(
    {render:['Camera','camera',fields]},()=>({}),{validate(_,p){assert.ok(Number.isSafeInteger(p.samples)&&p.samples>=1);}});
  const roundTrip=params=>codec.decode(codec.encode({type:'render',params}).slice()).params;
  const base={'resolution x':123,'resolution y':77,samples:1024,renderer:'Path tracer',environment:'image','environment image':'sky',realtime:'off','realtime during navigation':false};
  assert.deepEqual(roundTrip(base),base);
  const vp={...base,renderer:'Viewport',samples:50000};
  assert.deepEqual(roundTrip(vp),vp);
  for(const legacy of ['Interactive PI','Interactive GI','Cached GI']){
    const migrated=roundTrip({...base,renderer:legacy,denoiser:'off',quality:85});
    assert.deepEqual(migrated,base);assert.deepEqual(roundTrip(migrated),base);
  }
  assert.throws(()=>roundTrip({...base,samples:0}));
  assert.throws(()=>roundTrip({...base,samples:1.5}));
  return {pass:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await cameraViewStateChecks();console.log('Camera attributes and legacy HASH settings passed');}
