import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function sceneRefreshWorkChecks(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),checks=[];
 const line=start=>{const a=html.indexOf(start);assert.ok(a>=0,'Native source exists: '+start);return html.slice(a,html.indexOf('\n',a));};
 const counts={},count=name=>(...args)=>{counts[name]=(counts[name]||0)+1;return args;};
 const dependencies={
  window:{frameEngine:{draw:count('draw'),requestLibrary:count('library')},FrameSpline:{request:count('spline')}},document:{},definitions:{},FrameSceneControl:{},FrameAuthorData:{},FrameFields:{},FrameParameters:{},FramePlugins:{dispatch:count('dispatch')},
  frameReadHierarchy:run=>run(),renderTree:count('tree'),renderAttributes:count('attributes'),frameSyncMaterialUV:count('uv'),syncHUD:count('hud'),refreshTabActions:count('actions'),frameRefreshAnimationUI:count('animation'),frameSyncEngineVisibility:count('visibility'),frameSyncMaterials:count('materials')
 };
 const core=Function(...Object.keys(dependencies),line('function render(){')+'\n'+line(' const core={get engine(){')+';return core;')(...Object.values(dependencies));
 core.refresh();
 assert.equal(counts.tree,1,'One refresh renders the Objects Browser once');
 assert.equal(counts.visibility,1,'One refresh synchronizes native authoring exactly once');
 assert.equal(counts.materials,1,'One refresh retains material synchronization');
 assert.equal(counts.spline,1,'One refresh retains spline evaluation request');
 assert.equal(counts.library,1,'One refresh retains library evaluation request');
 assert.equal(counts.draw,1,'One refresh retains viewport redraw');
 checks.push({name:'Actual Scene Control refresh retains one complete render and native synchronization',pass:true});
 for(let i=1;i<100;i++)core.refresh();
 assert.equal(counts.visibility,100,'Repeated refreshes never duplicate native serialization/synchronization');
 assert.equal(counts.tree,100);assert.equal(counts.materials,100);assert.equal(counts.draw,100);
 checks.push({name:'100 Scene Control refreshes perform exactly 100 native synchronizations',pass:true});
 return {pass:true,checks,counts,indexSHA256:createHash('sha256').update(html).digest('hex'),browserVerified:false,gpuVerified:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await sceneRefreshWorkChecks(),null,2));
