import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function cameraViewStateChecks(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const definition=/^\s*render:\['Camera','camera',(.+?)\],$/m.exec(html);
  const [fields,{quality}]=Function('return ['+definition[1]+']')();
  assert.deepEqual(fields.renderer,['Viewport']);
  assert.deepEqual(Object.keys(fields).slice(0,3),['resolution x','resolution y','quality']);
  assert.equal(fields.quality,50);
  assert.deepEqual([quality.minimum,quality.maximum,quality.integer],[1,100,true]);
  assert.ok(!Object.hasOwn(fields,'denoiser'));
  const codecCode=/^function createFrameSplineCodec\([\s\S]+?^\}/m.exec(html)[0];
  const codec=Function('definitions','defaults','FrameParameters',codecCode+';return createFrameSplineCodec(["render"]);')(
    {render:['Camera','camera',fields]},()=>({}),{validate(_,p){assert.ok(Number.isInteger(p.quality)&&p.quality>=1&&p.quality<=100);}});
  const roundTrip=params=>codec.decode(codec.encode({type:'render',params}).slice()).params;
  const retained={'resolution x':123,'resolution y':77,quality:67,renderer:'Viewport',environment:'image','environment image':'sky',realtime:'off','realtime during navigation':false};
  for(const renderer of ['Path tracer','Interactive PI','Interactive GI','Cached GI','Viewport']){
    const migrated=roundTrip({...retained,renderer,denoiser:'off',samples:16});
    assert.deepEqual(migrated,retained);assert.deepEqual(roundTrip(migrated),retained);
  }
  assert.throws(()=>roundTrip({...retained,quality:101}));
  return {pass:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await cameraViewStateChecks();console.log('Camera attributes and legacy HASH settings passed');}
